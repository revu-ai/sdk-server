# REVU API contract

The request this package sends and how it reacts to each answer. The package and its tests are built against it, and any stack can post to it directly, see [Plain HTTP](./plain-http.md).

## Request

```http
POST https://api.revu.ai/v1/behavior/server-events
Authorization: Bearer revu_sk_prod_...
Content-Type: application/json
```

```json
{
  "sdk": { "name": "@revu-ai/server", "version": "0.3.0" },
  "sent_at": "<ISO-8601>",
  "events": [
    {
      "event_type": "$crawl",
      "event_id": "<uuid>",
      "timestamp": "<ISO-8601>",
      "host": "shop.example",
      "path": "/pricing",
      "method": "GET",
      "status": 200,
      "user_agent": "...",
      "ip": "203.0.113.7",
      "referer_host": null
    }
  ]
}
```

The event fields are described in [Privacy and data](./privacy.md#the-event).

## Rules

- **At most 500 events and 1 MB** per request.
- **Each event is checked on its own.** An invalid event is dropped and the rest of the batch is kept. `event_id` must be a UUID, `path` must start with `/`, `user_agent` must not be empty, and `status` may be `null`.
- **`host` must belong to the key's environment**: that environment's domain or a subdomain of it, and also `localhost` for a development key. When domains overlap, the most specific one decides (`staging.acme.com` is staging even under `acme.com`). A port is ignored. Hits for any other host are dropped, for example `localhost` sent with a production key.
- **Hits REVU does not recognize as automated are dropped**, and their IP is not stored. That covers browsers and user agents that match no known crawler, bot or HTTP client.
- **`ip` is how REVU verifies the crawler**, against its vendor's published addresses or by reverse DNS. The check runs after the response, so a hit from an address the vendor does not use is still accepted and counted in `accepted`, then left out of AI visibility as spoofed. A missing `ip`, an address on a CDN edge network (Cloudflare, Fastly or Akamai), or a crawler whose vendor documents no way to check leaves the hit unverifiable, and it still counts. The IP is cleared after 30 days, and the hit itself is kept.
- **`event_id` is an idempotency key.** A batch sent twice is stored once, so a retry after a timeout is safe.
- **`sent_at` is optional**: the sender's clock at send time, used to correct event timestamps for clock skew. A timestamp more than 5 minutes ahead is replaced by the time of receipt. A hit more than 7 days old is rejected as invalid.

## Responses

A `202` counts what happened to each event:

```json
{ "accepted": 2, "duplicates": 0, "rejected": { "invalid": 0, "unknown_host": 1, "not_crawler": 0 } }
```

| Response | Meaning | Client behavior |
| --- | --- | --- |
| `202` (any 2xx) | Accepted. | Done. |
| `401` | Missing, malformed, public or unknown key, or the key's environment is turned off on the touchpoint. | Stop sending until restart, logged once in debug. |
| `403` | Revoked key, its touchpoint is archived or is not a website, or the request came from a browser (it carried an `Origin` header). | Stop sending until restart, logged once in debug. |
| `413` | More than 500 events or 1 MB. | Drop the batch, halve the batch size, back off. |
| `429` | The key's rate limit, or too many requests with unknown keys from your address, with `Retry-After` in seconds. | Keep the batch, pause for `Retry-After` (or the backoff). |
| `408` / `5xx` / network error / timeout | Temporary failure. | One retry after `retryDelayMs`, then drop and back off. |
| other `4xx` | A malformed request body. | Drop the batch, no retry. |
