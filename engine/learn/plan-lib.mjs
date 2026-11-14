// engine/learn/plan-lib.mjs — EXPERIMENT PLANNER (v2). Decide BEFORE a change whether it can teach us anything. Pure, tested.
// 11-14 measured on our real series: to see a change in total accounts over 14 days it must move them ≥ ±31 % (ChatGPT
// accounts ±41 %) — daily counts swing ~10× more than pure chance (traffic waves, weekdays, Google). Most site tweaks move
// < 10 %, so a before/after read can never see them: that is why v1 "learned" nothing. Standard practice for low traffic:
// power the test up front (one-sided α 5 %, power 80 % → z 1.645 + 0.842), prefer a CONCURRENT split (both arms see the same
// traffic, weekday, Google update — the noise cancels), and say "not learnable" out loud instead of crediting noise.
import { asSeries, dispersion, weekdayExpected, addDays } from "../lib/stats.mjs";
export const Z = 1.645 + 0.842, MIN_EFFECT = 0.15;

// before/after on a daily count: relative effect detectable with 80 % power over `days` after the change
export function mdeBeforeAfter(map, from, end, days) {
  const s = asSeries(map, from, end), phi = dispersion(s, end);
  if (phi == null) return null;
  let E = 0; for (let i = 0; i < days; i++) { const e = weekdayExpected(s, addDays(end, -i)); if (e == null) return null; E += e; }
  if (E <= 0) return null;
  return { expected: +E.toFixed(1), phi: +phi.toFixed(1), mde: +Math.max(MIN_EFFECT, (Z * Math.sqrt(phi * E * 1.25)) / E).toFixed(2) };
}
// concurrent split (two-proportion, equal arms): relative lift on a conversion rate `p` with `n` visitors per arm
export function mdeSplit(p, n) {
  if (!(p > 0 && p < 1) || !(n > 0)) return null;
  return +((Z * Math.sqrt((2 * p * (1 - p)) / n)) / p).toFixed(2);
}
// days a split needs to see `effect` (relative) with visitors/day `v` split 50/50 at rate p
export function splitDays(p, v, effect) {
  if (!(p > 0 && p < 1) || !(v > 0) || !(effect > 0)) return null;
  return Math.ceil(((Z ** 2) * 2 * p * (1 - p)) / ((effect * p) ** 2) / (v / 2));
}
// the plan: which design (if any) can see `expect` (the effect the change is hoped to have, relative, e.g. 0.2 = +20 %)
export function plan({ ba14, ba28, split, expect, gate }) {
  const why = [];
  if (gate && !gate.allow) why.push(`gate holds it now: ${gate.why}`);
  if (ba14 && expect >= ba14.mde) return { design: "before-after", days: 14, mde: ba14.mde, why: [...why, `±${Math.round(ba14.mde * 100)} % visible in 14 d ≤ hoped ${Math.round(expect * 100)} %`] };
  if (ba28 && expect >= ba28.mde) return { design: "before-after", days: 28, mde: ba28.mde, why: [...why, `needs 28 d (±${Math.round(ba28.mde * 100)} %); no other traffic change in that window`] };
  if (split && split.days != null && split.days <= 42) return { design: "split", days: split.days, mde: expect, why: [...why, `before/after can't see ${Math.round(expect * 100)} %; a 50/50 split at ${(split.p * 100).toFixed(1)} % conversion, ${split.v}/day sees it in ${split.days} d`] };
  return { design: "not learnable", days: null, mde: ba28?.mde ?? null, why: [...why, `no design sees ${Math.round(expect * 100)} % at our volume — ship on judgment if it's right for users, NEVER credit or blame it`] };
}
// verdict for a registered experiment vs its pre-registered direction, from a LEARN effect window {state, ratio, mde}
export function judge(exp, w) {
  if (!w || w.state === "pending" || w.state === "unknown") return "pending";
  if (w.state === "thin") return "inconclusive (too little data)";
  const up = exp.expect > 0;
  if ((up && w.state === "helped") || (!up && w.state === "hurt")) return "confirmed";
  if ((up && w.state === "hurt") || (!up && w.state === "helped")) return "refuted (moved the other way)";
  return `inconclusive (no effect ≥ ±${Math.round((w.mde ?? 0) * 100)} % — smaller effects are invisible here)`;
}
