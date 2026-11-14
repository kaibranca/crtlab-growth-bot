// engine/lib/stats.mjs — the statistics every v2 machine uses. Pure, tested (test/engine-stats.test.mjs).
// Counts (accounts, visitors) are modelled as over-dispersed Poisson: variance = phi × mean, phi measured from our own
// history (never assumed 1 — real traffic is burstier than Poisson, and assuming phi = 1 is how v1 cried wolf).

export const DAY = 864e5;
export const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (ymd, n) => iso(Date.parse(ymd + "T00:00:00Z") + n * DAY);

// standard normal CDF (Abramowitz–Stegun 7.1.26 via erf; |error| < 1.5e-7)
export function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// Expected count for `day` = trimmed mean of the same weekday over the previous `weeks` weeks (weekday-adjusted: a Saturday is
// compared with Saturdays). Returns null when fewer than `minWeeks` of those days exist in the series.
export function weekdayExpected(series, day, weeks = 4, minWeeks = 3) {
  const vals = [];
  for (let k = 1; k <= weeks; k++) { const d = addDays(day, -7 * k); if (d in series.__known) vals.push(series[d] ?? 0); }
  if (vals.length < minWeeks) return null;
  // ROBUST: drop the highest and lowest week when there are 4 (one freak week — a surge, a crash day — must not drag the
  // normal for a month; test "robust to one regime change"). With 3 weeks, the plain mean.
  vals.sort((a, b) => a - b);
  const core = vals.length >= 4 ? vals.slice(1, -1) : vals;
  return core.reduce((a, b) => a + b, 0) / core.length;
}

// Wrap a {ymd: count} map so missing days inside the covered range count as 0 and days outside it are "unknown".
export function asSeries(map, from, to) {
  const s = { __known: {} };
  for (let d = from; d <= to; d = addDays(d, 1)) { s.__known[d] = true; s[d] = map[d] ?? 0; }
  return s;
}

// Dispersion phi, ROBUST: median of (obs − exp)² / exp over the history before `until`, divided by 0.455 (the median of a
// χ²₁ — so pure Poisson gives phi ≈ 1), floored at 1. Median, not mean: one regime change in the history (Aug guest mode,
// a September surge) must not convince the detector that everything is noise. Backtest 11-14: the mean version saw the
// 10-24 crash only on 11-03 and never saw ChatGPT accounts fall 109 → 26 / week.
export function dispersion(series, until, lookback = 56) {
  const r = [];
  for (let i = 1; i <= lookback; i++) {
    const d = addDays(until, -i), e = weekdayExpected(series, d);
    if (e == null || e < 1 || !(d in series.__known)) continue;
    r.push((series[d] - e) ** 2 / e);
  }
  if (r.length < 14) return null;
  r.sort((a, b) => a - b);
  const med = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2;
  return Math.max(1, med / 0.455);
}

// Window test: observed vs expected over the `w` complete days ending `end`. z = (O − E) / √(φE·(1 + 1/weeks)) — the
// baseline is itself an average of `weeks` noisy weeks, so its uncertainty is added (otherwise z overstates certainty).
export function windowTest(series, end, w, phi, weeks = 4) {
  let O = 0, E = 0;
  for (let i = 0; i < w; i++) {
    const d = addDays(end, -i), e = weekdayExpected(series, d);
    if (e == null || !(d in series.__known)) return null;
    O += series[d]; E += e;
  }
  const z = E > 0 ? (O - E) / Math.sqrt(phi * E * (1 + 1 / weeks)) : 0;
  return { end, w, observed: O, expected: +E.toFixed(1), ratio: E > 0 ? +(O / E).toFixed(2) : null, z: +z.toFixed(2), p: +normCdf(z).toFixed(4) };
}
