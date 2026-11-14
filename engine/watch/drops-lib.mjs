// engine/watch/drops-lib.mjs — WATCH: is a number really down (or up) against its own normal, or is it noise?
// v1 lessons this answers: the crash (ChatGPT→/backtest 126→5/wk) was seen 14 days late; "lock-in" fired on 4 spikes that
// were all noise. Rules: weekday-adjusted, dispersion measured from our own history, a call needs BOTH statistical
// clarity AND a size that matters AND enough volume to read. Pure, tested.
import { asSeries, dispersion, windowTest, addDays } from "../lib/stats.mjs";

export const RULES = {
  windows: [3, 7],
  minExpected: 10,          // below this the window is unreadable — say so, never guess
  // Tuned on the Aug–Nov backtest (11-14): our daily counts run ~10× Poisson noise, so z alone is weak; the call needs a
  // big size AND z. Missing a crash cost weeks; a false "watch" costs one email.
  drop: { z: -1.64, ratio: 0.6 },    // ~5% one-sided AND at least 40% down
  watch: { z: -1.28, ratio: 0.75 },  // ~10% one-sided AND at least 25% down
  rise: { z: 2.33, ratio: 1.3 },
};

// level for one window result
export function judge(t, rules = RULES) {
  if (!t) return "unknown";
  if (t.expected < rules.minExpected) return "thin";
  if (t.z <= rules.drop.z && t.ratio <= rules.drop.ratio) return "drop";
  if (t.z <= rules.watch.z && t.ratio <= rules.watch.ratio) return "watch";
  if (t.z >= rules.rise.z && t.ratio >= rules.rise.ratio) return "rise";
  return "normal";
}
const RANK = { drop: 4, watch: 3, rise: 2, normal: 1, thin: 0, unknown: 0 };

// Evaluate one metric as of `end` (last COMPLETE day). map = {ymd: count}, from = first day the data covers.
export function evaluate(map, from, end, rules = RULES) {
  const s = asSeries(map, from, end), phi = dispersion(s, addDays(end, -rules.windows[0] + 1));
  if (phi == null) return { level: "unknown", phi: null, windows: [] };
  const windows = rules.windows.map((w) => { const t = windowTest(s, end, w, phi); return t && { ...t, level: judge(t, rules) }; }).filter(Boolean);
  const worst = windows.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a), { level: "unknown" });
  return { level: worst.level, phi: +phi.toFixed(2), windows };
}

// Replay history day by day (the backtest that proves the detector before it is trusted). Returns the days a level fired.
export function replay(map, from, start, end, rules = RULES) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) { const r = evaluate(map, from, d, rules); if (r.level === "drop" || r.level === "watch" || r.level === "rise") out.push({ day: d, level: r.level, w: r.windows.find((x) => x.level === r.level) }); }
  return out;
}

// BUYERS — too rare (~1/week) for window tests ("thin" forever), but they are THE outcome, so they get their own test:
// how unlikely is the current dry spell at our recent rate? P(no new buyer in g days | Poisson λ/day) = e^(−λg).
// λ = the rate over the `lookback` days ENDING AT THE LAST BUYER (the normal before the gap). Tested 11-14: measuring it over
// days ending TODAY let the gap deflate its own rate — 23 dry days at a 1/week pace read "normal" (p 0.13 instead of 0.04).
// Levels: watch at ~2.4× the typical gap, drop at ~3.5×.
// map = {ymd: new buyers}. Needs ≥ minEvents buyers in the lookback, else "thin" (say so, never guess).
export const GAP = { lookback: 56, minEvents: 4, watchP: 0.1, dropP: 0.03 };
export function gapTest(map, end, g = GAP) {
  let last = null;
  for (const [d, k] of Object.entries(map)) if (d <= end && k && (!last || d > last)) last = d;
  if (!last) return { level: "unknown", windows: [] };
  const from = addDays(last, -g.lookback + 1);
  let n = 0; for (const [d, k] of Object.entries(map)) if (d >= from && d <= last && k) n += k;
  const gap = Math.round((Date.parse(end) - Date.parse(last)) / 864e5), rate = n / g.lookback;
  if (n < g.minEvents) return { level: "thin", gap, n, windows: [] };
  const p = Math.exp(-rate * gap);
  return { level: p < g.dropP ? "drop" : p < g.watchP ? "watch" : "normal", gap, n, typicalGap: +(1 / rate).toFixed(1), p: +p.toFixed(3), windows: [] };
}
