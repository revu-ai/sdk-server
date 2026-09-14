/**
 * @file Transport: one POST of one batch, with a hard timeout, classified into
 * an outcome the reporter can act on. No retries, queueing or timers live
 * here. This module only answers "what happened to this request?".
 */

import { VERSION } from "./version.js";

/** SDK identity sent with every batch. */
export const SDK_INFO = Object.freeze({ name: "@revu-ai/server", version: VERSION });

/**
 * What the reporter should do after a send.
 *
 * - `ok`: accepted (any 2xx, the API answers 202).
 * - `unauthorized`: 401 or 403, the key is wrong or revoked. Stop sending.
 * - `too_large`: 413, the batch was too big. Drop it and send smaller batches.
 * - `throttled`: 429, keep the batch and pause (honoring `Retry-After`).
 * - `retryable`: network error, timeout, 408 or 5xx. Worth one retry.
 * - `rejected`: any other 4xx. The batch will never be accepted. Drop it.
 *
 * @typedef {object} SendOutcome
 * @property {"ok" | "unauthorized" | "too_large" | "throttled" | "retryable" | "rejected"} kind
 * @property {number} [status] HTTP status, when a response arrived.
 * @property {number} [retryAfterMs] Parsed `Retry-After`, when present and valid.
 * @property {unknown} [result] The parsed 2xx body (REVU's per-hit counts),
 *   only when the send asked for it with `readResult`.
 */

/**
 * Parse a `Retry-After` header (delta seconds or an HTTP date) into ms.
 * @param {string | null} value
 * @returns {number | undefined}
 */
export function parseRetryAfter(value) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}

/**
 * Map an HTTP status to an outcome kind.
 * @param {number} status
 * @returns {SendOutcome["kind"]}
 */
export function classifyStatus(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 413) return "too_large";
  if (status === 429) return "throttled";
  if (status === 408 || status >= 500) return "retryable";
  return "rejected";
}

/**
 * POST one batch of events.
 *
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {string} options.url Full ingest URL.
 * @param {string} options.serverKey
 * @param {import("./types.js").CrawlEvent[]} options.events
 * @param {number} options.timeoutMs
 * @param {boolean} [options.readResult] Read and parse a 2xx body into
 *   `result` (debug mode). Otherwise the body is never read.
 * @returns {Promise<SendOutcome>} Never rejects.
 */
export async function sendBatch({
  fetch: fetchImpl,
  url,
  serverKey,
  events,
  timeoutMs,
  readResult = false,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${serverKey}`,
      },
      // `sent_at` is this server's clock at send time. The API uses it to
      // correct the event timestamps for clock skew.
      body: JSON.stringify({ sdk: SDK_INFO, sent_at: new Date().toISOString(), events }),
      signal: controller.signal,
    });
    const kind = classifyStatus(response.status);
    /** @type {SendOutcome} */
    const outcome = { kind, status: response.status };
    if (kind === "ok" && readResult) {
      // Debug only: REVU's counts explain hits it accepted but did not store.
      try {
        outcome.result = await response.json();
      } catch {}
    } else {
      // Otherwise the body is never needed. Release the connection unread.
      try {
        response.body?.cancel().catch(() => {});
      } catch {}
    }
    if (kind === "throttled") {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      if (retryAfterMs !== undefined) outcome.retryAfterMs = retryAfterMs;
    }
    return outcome;
  } catch {
    return { kind: "retryable" };
  } finally {
    clearTimeout(timer);
  }
}
