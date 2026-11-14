import test from "node:test"; import assert from "node:assert/strict";
import { mdeBeforeAfter, mdeSplit, splitDays, plan, judge } from "../engine/learn/plan-lib.mjs";
import { addDays } from "../engine/lib/stats.mjs";
const FROM = "2026-07-01", noise = (i) => [0, 3, -2, 4, -3, 1, -4, 2][i % 8];
const m = {}; for (let i = 0; i < 120; i++) { const d = addDays(FROM, i), w = new Date(d + "T12:00Z").getUTCDay(); m[d] = (w === 0 || w === 6 ? 40 : 20) + noise(i); }
const END = addDays(FROM, 119);
test("before/after MDE shrinks with a longer window", () => {
  const a = mdeBeforeAfter(m, FROM, END, 14), b = mdeBeforeAfter(m, FROM, END, 28);
  assert.ok(a.mde >= b.mde && b.mde >= 0.15); assert.ok(a.expected > 300);
});
test("split maths: more visitors → smaller MDE; days to see an effect", () => {
  assert.ok(mdeSplit(0.1, 4000) < mdeSplit(0.1, 1000)); assert.equal(mdeSplit(0, 10), null);
  const d = splitDays(0.1, 200, 0.2); assert.ok(d > 10 && d < 60, String(d));
});
test("plan picks the cheapest design that can see the hoped effect, else says not learnable", () => {
  const ba14 = { mde: 0.31 }, ba28 = { mde: 0.23 };
  assert.equal(plan({ ba14, ba28, expect: 0.4 }).design, "before-after");
  assert.equal(plan({ ba14, ba28, expect: 0.25 }).days, 28);
  assert.equal(plan({ ba14, ba28, expect: 0.1, split: { p: 0.1, v: 400, days: 30 } }).design, "split");
  const no = plan({ ba14, ba28, expect: 0.05, split: { p: 0.1, v: 50, days: 900 } });
  assert.equal(no.design, "not learnable"); assert.match(no.why.at(-1), /NEVER credit/);
  assert.match(plan({ ba14, ba28, expect: 0.4, gate: { allow: false, why: "frozen" } }).why[0], /gate holds/);
});
test("judge against the PRE-REGISTERED direction", () => {
  assert.equal(judge({ expect: 0.2 }, { state: "helped" }), "confirmed");
  assert.match(judge({ expect: 0.2 }, { state: "hurt" }), /refuted/);
  assert.match(judge({ expect: -0.2 }, { state: "no clear effect", mde: 0.3 }), /inconclusive.*30/);
  assert.equal(judge({ expect: 0.2 }, { state: "pending" }), "pending");
});
