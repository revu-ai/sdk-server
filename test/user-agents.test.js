/**
 * The shared user agent fixture. `test/fixtures/user-agents.json` is a copy,
 * byte for byte, of the list the REVU API tests its classifier against. The
 * two rules have to agree, and neither repo can read the other at test time,
 * so each side tests its own half against its own copy.
 *
 * The contract, from the fixture's own `rules`:
 *
 * - Every user agent the API counts as non-human must be sent, or the hit is
 *   lost.
 * - Nothing sent may be classified human, or the send is wasted and shows in
 *   REVU as a refusal.
 * - Health probes are the one deliberate exception: human and never sent,
 *   since neither side treats a health check as a visitor.
 *
 * To add or change an entry, ask for it on the API side. The classifier owns
 * the verdicts, and both copies move together.
 *
 * The file's path and shape matter outside this repo too. The documentation
 * site's build reads `test/fixtures/user-agents.json` by that exact path,
 * expects the top-level `agents` array, and fails when the two copies differ.
 * Moving or reshaping the file is a change to coordinate, not a tidy-up.
 */

import { describe, expect, test } from "bun:test";
import { looksAutomated } from "../src/filter.js";
import fixture from "./fixtures/user-agents.json";

const agents = fixture.agents;

describe("shared user agent fixture", () => {
  test("carries the whole list, in the documented shape", () => {
    expect(agents.length).toBe(72);
    for (const entry of agents) {
      expect(typeof entry.ua).toBe("string");
      expect(Object.keys(fixture.groups)).toContain(entry.group);
      expect(["human", "bot", "ai_agent"]).toContain(entry.api);
      expect(["send", "skip"]).toContain(entry.sdk);
    }
  });

  test("the pre-filter returns the verdict the fixture expects", () => {
    const wrong = agents
      .filter((entry) => looksAutomated(entry.ua) !== (entry.sdk === "send"))
      .map((entry) => `${entry.group}: ${entry.note} (expected ${entry.sdk})`);
    expect(wrong).toEqual([]);
  });

  test("never drops a hit the API would count", () => {
    const lost = agents
      .filter((entry) => entry.api !== "human" && entry.sdk !== "send")
      .map((entry) => entry.note);
    expect(lost).toEqual([]);
  });

  test("never sends a hit the API classifies as human, apart from probes", () => {
    const wasted = agents
      .filter((entry) => entry.sdk === "send" && entry.api === "human")
      .map((entry) => entry.note);
    expect(wasted).toEqual([]);
    // The exception, stated so a change to it fails here rather than silently.
    const probes = agents.filter((entry) => entry.group === "probe");
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      expect(probe.api).toBe("human");
      expect(probe.sdk).toBe("skip");
    }
  });
});
