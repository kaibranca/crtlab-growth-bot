import test from "node:test"; import assert from "node:assert/strict";
import { decide } from "../engine/core/gate-lib.mjs";
const NOW = Date.parse("2026-11-15T12:00:00Z");
const ok = (data) => ({ kind: "ok", data });
const base = { hands: ok({ shield: { on: true }, indexnow: { on: false, why: "test" } }), freeze: { kind: "missing" }, budget: { used: 0, of: 1 }, google: [], now: NOW };

test("unregistered machines are held", () => assert.equal(decide("mystery", base).allow, false));
test("non-traffic hands follow hands.json and fail closed", () => {
  assert.equal(decide("shield", base).allow, true);
  assert.equal(decide("indexnow", base).allow, false);
  assert.equal(decide("reels", base).allow, false);                                   // not listed = off
  assert.equal(decide("shield", { ...base, hands: { kind: "broken" } }).allow, false);
});
test("traffic hands: freeze, budget, Google rollout, unknown Google — each holds", () => {
  assert.equal(decide("hooks", base).allow, true);
  const fz = { kind: "ok", data: { until: "2026-11-21T00:00:00Z", holds: { hooks: "paused" } } };
  assert.match(decide("hooks", { ...base, freeze: fz }).why, /frozen/);
  assert.equal(decide("bandit", { ...base, freeze: fz }).allow, true);                 // not a listed hold
  assert.equal(decide("hooks", { ...base, freeze: { kind: "broken" } }).allow, false);
  assert.match(decide("hooks", { ...base, budget: { used: 1, of: 1 } }).why, /budget/);
  assert.match(decide("hooks", { ...base, google: [{ what: "core", begin: "2026-11-10T18:00Z", end: null }] }).why, /rolling/);
  assert.equal(decide("hooks", { ...base, google: [{ what: "core", begin: "2026-10-01T00:00Z", end: null }] }).allow, true); // open > 21 d = stale
  assert.equal(decide("hooks", { ...base, google: [{ what: "spam", begin: "2026-11-01T00:00Z", end: "2026-11-05T00:00Z" }] }).allow, true);
  assert.equal(decide("hooks", { ...base, google: null }).allow, false);
  assert.equal(decide("hooks", { ...base, budget: null }).allow, false);
});
