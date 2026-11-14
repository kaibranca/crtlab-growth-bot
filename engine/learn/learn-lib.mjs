// engine/learn/learn-lib.mjs — LEARN (v2): what did each change actually do to users, and how often is the WATCH right?
// v1 lesson: 0 decisions were ever proven. Machines scored their own actions ("sent", "started"), tests were killed by our own
// deploys, and the 10-24 crash came from six changes at once that nobody could untangle. Rules here:
//   · the outcome is what USERS did (accounts first), never what a machine did
//   · the baseline comes ONLY from before the change (same weekdays, trimmed), so the change can't contaminate its own normal
//   · overlapping changes are judged as ONE group and never credited to a single change ("confounded" is a real answer)
//   · every verdict carries the smallest effect we could have seen at this volume — "no clear effect" ≠ "no effect"
//   · thresholds are fixed up front (pre-registered), not tuned to make a change look good
// Pure, tested (test/engine-learn.test.mjs).
import { addDays, normCdf, dispersion, asSeries } from "../lib/stats.mjs";
import { replay } from "../watch/drops-lib.mjs";

export const RULES = {
  windows: [7, 14],
  minExpected: 10,                         // below this the window is unreadable → "thin"
  helped: { z: 1.64, ratio: 1.15 },        // ~5% one-sided AND ≥ 15% up
  hurt: { z: -1.64, ratio: 0.85 },         // ~5% one-sided AND ≥ 15% down
  clusterDays: 6,                          // changes this close (or inside another's window) are one group
  alarmSkip: 3, alarmHorizon: 14, alarmConfirm: 0.9, // CONFIRMED = days +4..+17 after the alarm still < 90% of the pre-alarm
                                           // normal (a lasting fall). The first 3 days are skipped: a short dip's own tail must not confirm it (test 11-14).
};

const ymd = (t) => new Date(t).toISOString().slice(0, 10);

// Expected count for `day`: trimmed mean of the same weekday in the 4 most recent weeks that are ON OR BEFORE `anchor`.
export function expectedBefore(series, day, anchor, weeks = 4, minWeeks = 3) {
  const vals = [];
  for (let k = 1; k <= 12 && vals.length < weeks; k++) { const d = addDays(day, -7 * k); if (d <= anchor && d in series.__known) vals.push(series[d] ?? 0); }
  if (vals.length < minWeeks) return null;
  vals.sort((a, b) => a - b);
  const core = vals.length >= 4 ? vals.slice(1, -1) : vals;
  return core.reduce((a, b) => a + b, 0) / core.length;
}

// Effect over the `w` days AFTER `day0`, vs the normal measured up to `anchor` (the day BEFORE the first change in its group —
// the change day itself is excluded: a deploy at 18:00 already moves that day).
export function effect(series, day0, w, lastDay, rules = RULES, anchor = addDays(day0, -1)) {
  const endDay = addDays(day0, w);
  if (endDay > lastDay) return { w, state: "pending", due: endDay };
  const phi = dispersion(series, addDays(anchor, 1));
  if (phi == null) return { w, state: "unknown", why: "not enough history before the change" };
  let O = 0, E = 0;
  for (let i = 1; i <= w; i++) { const d = addDays(day0, i), e = expectedBefore(series, d, anchor); if (e == null || !(d in series.__known)) return { w, state: "unknown", why: "baseline gap" }; O += series[d]; E += e; }
  if (E < rules.minExpected) return { w, state: "thin", observed: O, expected: +E.toFixed(1) };
  const sd = Math.sqrt(phi * E * 1.25), z = (O - E) / sd, ratio = O / E;
  const state = z >= rules.helped.z && ratio >= rules.helped.ratio ? "helped" : z <= rules.hurt.z && ratio <= rules.hurt.ratio ? "hurt" : "no clear effect";
  // smallest change this window could have called (both the z and the size rule must pass)
  const mde = Math.max(rules.helped.ratio - 1, (rules.helped.z * sd) / E);
  return { w, state, observed: O, expected: +E.toFixed(1), ratio: +ratio.toFixed(2), z: +z.toFixed(2), p: +normCdf(z).toFixed(4), phi: +phi.toFixed(2), mde: +mde.toFixed(2) };
}

// Group changes whose windows overlap: a change within `clusterDays` of the previous one joins its group.
export function clusters(changes, rules = RULES) {
  const sorted = [...changes].sort((a, b) => a.at.localeCompare(b.at)), out = [];
  for (const c of sorted) {
    const g = out.at(-1), d = ymd(c.at);
    if (g && (Date.parse(d) - Date.parse(g.last)) / 864e5 <= rules.clusterDays) { g.changes.push(c); g.last = d; }
    else out.push({ day0: d, last: d, changes: [c] });
  }
  return out;
}

// Verdict for one group, judged from the day of its LAST change (everything in it had landed by then).
export function verdict(seriesMap, from, lastDay, group, rules = RULES) {
  const s = asSeries(seriesMap, from, lastDay);
  const windows = rules.windows.map((w) => effect(s, group.last, w, lastDay, rules, addDays(group.day0, -1)));
  const final = windows.find((x) => x.state !== "pending" && x.state !== "unknown" && x.w === Math.max(...rules.windows))
    ?? windows.find((x) => x.state !== "pending" && x.state !== "unknown") ?? windows[0];
  return { day0: group.day0, last: group.last, n: group.changes.length, clean: group.changes.length === 1,
    state: final.state, windows, changes: group.changes.map((c) => ({ at: c.at, where: c.where, what: String(c.what).slice(0, 120) })) };
}

// Lessons per area: only CLEAN verdicts (one change alone) count toward an area's record. Confounded groups are counted
// separately — the lesson there is the confounding itself.
export function lessons(verdicts) {
  const areas = {}, conf = { groups: 0, changes: 0, hurt: 0 };
  for (const v of verdicts) {
    if (v.state === "pending" || v.state === "unknown" || v.state === "thin") continue;
    if (!v.clean) { conf.groups++; conf.changes += v.n; if (v.state === "hurt") conf.hurt++; continue; }
    const a = (areas[v.changes[0].where] ??= { helped: 0, hurt: 0, "no clear effect": 0 }); a[v.state]++;
  }
  return { areas, confounded: conf };
}

// SELF-GRADE the WATCH: replay its alarms over history; each alarm EPISODE (first day of a run of alarm days) is confirmed if
// days +4..+17 stayed below `alarmConfirm` × the normal measured before the alarm, else it was a dip/noise.
export function gradeAlarms(seriesMap, from, lastDay, rules = RULES) {
  const start = addDays(from, 56), s = asSeries(seriesMap, from, lastDay);
  const days = replay(seriesMap, from, start, lastDay).filter((x) => x.level === "drop" || x.level === "watch");
  const episodes = []; let prev = null;
  for (const x of days) { if (!prev || (Date.parse(x.day) - Date.parse(prev)) / 864e5 > 3) episodes.push(x); prev = x.day; }
  const graded = episodes.map((e) => {
    const end = addDays(e.day, rules.alarmSkip + rules.alarmHorizon);
    if (end > lastDay) return { day: e.day, level: e.level, state: "pending" };
    let O = 0, E = 0;
    for (let i = rules.alarmSkip + 1; i <= rules.alarmSkip + rules.alarmHorizon; i++) { const d = addDays(e.day, i), x = expectedBefore(s, d, addDays(e.day, -3)); if (x == null) return { day: e.day, level: e.level, state: "unknown" }; O += s[d]; E += x; }
    const ratio = E > 0 ? O / E : null;
    return { day: e.day, level: e.level, ratio: ratio == null ? null : +ratio.toFixed(2), state: ratio != null && ratio < rules.alarmConfirm ? "confirmed" : "recovered" };
  });
  const done = graded.filter((g) => g.state === "confirmed" || g.state === "recovered"), ok = done.filter((g) => g.state === "confirmed").length;
  return { episodes: graded, graded: done.length, confirmed: ok, precision: done.length ? +(ok / done.length).toFixed(2) : null, enough: done.length >= 30 };
}
