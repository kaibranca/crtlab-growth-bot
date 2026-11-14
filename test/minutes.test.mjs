import test from "node:test"; import assert from "node:assert/strict";
import { govern, retryAllowed as libAllowed, CEILING } from "../scripts/minutes-lib.mjs";
import { retryAllowed as workerAllowed, retryNotNeeded, dataVersion } from "../cron-worker/worker.js";

test("governor: today's real numbers (453 used, 64.7/day, 11-14) → tight, never plans past the ceiling", () => {
  const g = govern({ used: 453, perDay7: 64.7, dayOfMonth: 14, daysInMonth: 30 });
  assert.equal(g.mode, "tight"); assert.ok(g.projected > CEILING); assert.deepEqual(g.retrySlots, [7, 11, 15]);
});
test("governor: low pace → normal; nearly spent → critical", () => {
  assert.equal(govern({ used: 300, perDay7: 30, dayOfMonth: 14, daysInMonth: 30 }).mode, "normal");
  assert.equal(govern({ used: 1300, perDay7: 30, dayOfMonth: 25, daysInMonth: 30 }).mode, "critical");
  assert.equal(govern({ used: 1700, perDay7: 0, dayOfMonth: 2, daysInMonth: 30 }).mode, "critical"); // over the ceiling = critical even at 0 pace
});
test("governor: following the allowance every day lands at or under the ceiling", () => {
  let used = 0; for (let d = 1; d <= 31; d++) { const g = govern({ used, perDay7: 50, dayOfMonth: d, daysInMonth: 31 }); used += Math.min(50, Math.max(35, g.allowPerDay)); }
  assert.ok(used <= CEILING + 35, `spent ${used}`);
});
test("retry slots: worker copy == lib copy, for every mode × hour, fresh and stale", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  for (const mode of ["normal", "tight", "critical", "weird"]) for (const age of [0, 7]) for (let h = 0; h < 24; h++) {
    const dec = { at: new Date(now - age * 3.6e6).toISOString(), mode };
    assert.equal(workerAllowed(dec, h, now), libAllowed(dec, h, now), `${mode} age ${age} h ${h}`);
  }
  assert.equal(workerAllowed(null, 9), true); // missing file = fail open
  assert.equal(workerAllowed({ at: new Date(now).toISOString(), mode: "critical" }, 9, now), false);
});
test("retry pre-check (11-14 bug: the code sat inside a comment → always dispatched)", async () => {
  assert.equal(retryNotNeeded({ end: "2026-11-13", due: "2026-11-13" }), true);
  assert.equal(retryNotNeeded({ end: "2026-11-12", due: "2026-11-13" }), false);
  assert.equal(retryNotNeeded(null), false); assert.equal(retryNotNeeded({ end: "2026-11-13" }), false);
  const fake = async (url, o) => { assert.equal(o.headers["x-crtlab-edge"], "S"); return new Response(JSON.stringify({ live: "d1", end: "2026-11-13", due: "2026-11-13" })); };
  assert.deepEqual(await dataVersion({ EDGE_SECRET: "S" }, fake), { live: "d1", end: "2026-11-13", due: "2026-11-13" }); // parsed JSON, not a Response
  assert.equal(await dataVersion({}, async () => new Response("no", { status: 403 })), null);
});
