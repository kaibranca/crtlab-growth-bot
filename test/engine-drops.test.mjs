import test from "node:test"; import assert from "node:assert/strict";
import { normCdf, weekdayExpected, asSeries, dispersion, windowTest, addDays } from "../engine/lib/stats.mjs";
import { evaluate, judge, replay } from "../engine/watch/drops-lib.mjs";

// synthetic history: weekdays 20, weekends 40 (our real shape: weekends ~2×), deterministic ±noise
const build = (from, days, f) => { const m = {}; for (let i = 0; i < days; i++) { const d = addDays(from, i), w = new Date(d + "T12:00:00Z").getUTCDay(); m[d] = f(i, w); } return m; };
const noise = (i) => [0, 3, -2, 4, -3, 1, -4, 2][i % 8];
const base = (i, w) => (w === 0 || w === 6 ? 40 : 20) + noise(i);

test("normCdf matches known values", () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6); assert.ok(Math.abs(normCdf(-1.645) - 0.05) < 1e-3); assert.ok(Math.abs(normCdf(2.326) - 0.99) < 1e-3);
});
test("weekday baseline compares Saturday with Saturdays", () => {
  const m = build("2026-09-01", 60, base), s = asSeries(m, "2026-09-01", "2026-10-30");
  const sat = "2026-10-24", mon = "2026-10-26";
  assert.ok(weekdayExpected(s, sat) > 35 && weekdayExpected(s, mon) < 25);
  assert.equal(weekdayExpected(s, "2026-09-05"), null); // no history yet → unknown, never a guess
});
test("dispersion ≈ 1 for calm data, large for wild data; robust to one regime change", () => {
  const calm = asSeries(build("2026-08-01", 90, base), "2026-08-01", "2026-10-29");
  assert.ok(dispersion(calm, "2026-10-29") < 2);
  const shock = build("2026-08-01", 90, (i, w) => base(i, w) * (i >= 30 && i < 37 ? 5 : 1)); // one wild week
  assert.ok(dispersion(asSeries(shock, "2026-08-01", "2026-10-29"), "2026-10-29") < 3, "one bad week must not make everything noise");
});
test("steady weekly cycle is NORMAL every day — weekends never look like wins, Mondays never like losses", () => {
  const m = build("2026-08-01", 100, base);
  assert.equal(replay(m, "2026-08-01", "2026-09-15", "2026-11-08").length, 0);
});
test("a 60% crash is caught within 3 days as a DROP", () => {
  const m = build("2026-08-01", 100, (i, w) => base(i, w) * (i >= 80 ? 0.4 : 1)), crash = addDays("2026-08-01", 80);
  const calls = replay(m, "2026-08-01", "2026-09-15", "2026-11-08"), first = calls.find((c) => c.level === "drop");
  assert.ok(first, "crash not detected");
  assert.ok(Date.parse(first.day) - Date.parse(crash) <= 2 * 864e5, `detected ${first.day}, crash ${crash}`);
});
test("thin volume says THIN, never DROP", () => {
  const m = build("2026-08-01", 100, (i) => (i % 7 === 0 ? 1 : 0)); // ~1 a week
  assert.ok(["thin", "unknown"].includes(evaluate(m, "2026-08-01", "2026-11-08").level));
});
test("judge needs BOTH size and certainty", () => {
  assert.equal(judge({ expected: 100, ratio: 0.9, z: -3 }), "normal"); // certain but small → not a drop
  assert.equal(judge({ expected: 100, ratio: 0.3, z: -1 }), "normal"); // big but uncertain → not a drop
  assert.equal(judge({ expected: 100, ratio: 0.4, z: -2 }), "drop");
  assert.equal(judge({ expected: 5, ratio: 0, z: -3 }), "thin");
});

import { gapTest } from "../engine/watch/drops-lib.mjs";
test("buyers gap test: normal gap ok, long dry spell flagged, too few buyers = thin, none = unknown", () => {
  const weekly = {}; for (let i = 0; i < 8; i++) weekly[addDays("2026-09-01", i * 7)] = 1; // 1 buyer / week to 10-20
  assert.equal(gapTest(weekly, "2026-10-23").level, "normal");            // 3 days after a buyer
  const r = gapTest(weekly, "2026-11-12");                                 // 23 dry days at 1/week → p ≈ 0.04
  assert.equal(r.gap, 23); assert.equal(r.level, "watch"); assert.equal(r.typicalGap, 7);
  assert.equal(gapTest(weekly, "2026-11-03").level, "normal");            // 14 days = 2× typical: still normal
  assert.equal(gapTest(weekly, "2026-11-15").level, "drop");              // 26 days ≈ 3.7× typical
  assert.equal(gapTest({ "2026-11-01": 1, "2026-11-05": 1 }, "2026-11-30").level, "thin");
  assert.equal(gapTest({}, "2026-11-30").level, "unknown");
  assert.equal(gapTest({ "2026-12-01": 3 }, "2026-11-30").level, "unknown"); // future rows never count
});
