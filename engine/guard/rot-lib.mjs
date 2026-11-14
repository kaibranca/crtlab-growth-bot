// engine/guard/rot-lib.mjs — ROT: nothing may slowly get worse (Kai 11-14: "as time goes on machines can't produce bugs or
// failures, nothing must slowly break / get worse / clash / bottleneck").
// v1/v2 lesson: supervisor crept to 82 s p50 / 104 s max of a 150 s limit (re-fetching every GitHub run, every hour) and no
// machine noticed; hourly ran twice an hour for 2 days (11-12/13) before anyone saw it. Pass/fail checks can't see either.
// Practice (SRE): recent p95 vs a rolling baseline p95 + headroom to the hard limit; reliability drift; growth projected
// to the limit. Every check returns ok | warn | fail | learning (not enough history — said plainly). Pure, tested.

const DAY = 864e5;
const res = (id, what, state, detail) => ({ id, what, state, detail });
export function p95(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; }

// rows = runs.jsonl rows {at, plan, step, status, ms}; timeouts = {"plan/step": seconds}
export function durationRot(rows, timeouts, now, { recentDays = 3, baseDays = 14, minBase = 10, minRecent = 3, warnAt = 0.6, failAt = 0.85, creep = 1.5, minAddS = 10 } = {}) {
  const by = {};
  for (const r of rows) if (r.status === "ok" && r.ms > 0) (by[`${r.plan}/${r.step}`] ??= []).push(r);
  const out = [];
  for (const [k, rs] of Object.entries(by)) {
    const t = (r) => now - Date.parse(r.at);
    const recent = rs.filter((r) => t(r) <= recentDays * DAY).map((r) => r.ms / 1000);
    const base = rs.filter((r) => t(r) > recentDays * DAY && t(r) <= (recentDays + baseDays) * DAY).map((r) => r.ms / 1000);
    if (recent.length < minRecent) continue;
    const pr = p95(recent), limit = timeouts[k];
    // headroom (test 11-14: the real supervisor case was 104 s of 150 s = 69% — a single 70% line missed it)
    if (limit && pr >= warnAt * limit) { out.push(res(`dur|${k}`, `${k} runtime`, pr >= failAt * limit ? "fail" : "warn", `p95 ${pr.toFixed(0)} s = ${Math.round((pr / limit) * 100)}% of its ${limit} s limit`)); continue; }
    if (base.length < minBase) continue; // no baseline yet: headroom is still checked above
    const pb = p95(base);
    if (pr >= creep * pb && pr - pb >= minAddS) out.push(res(`dur|${k}`, `${k} runtime`, "warn", `p95 ${pb.toFixed(0)} s → ${pr.toFixed(0)} s (×${(pr / pb).toFixed(1)}) vs the ${baseDays}-day baseline`));
  }
  return out;
}

// Reliability drift: last 7 d ok-rate vs the 14 d before it. A step that used to work and now fails more often is rot.
export function reliabilityRot(rows, now, { minRuns = 5, drop = 0.1 } = {}) {
  const by = {};
  for (const r of rows) if (r.status !== "skipped") (by[`${r.plan}/${r.step}`] ??= []).push(r);
  const out = [];
  for (const [k, rs] of Object.entries(by)) {
    const age = (r) => (now - Date.parse(r.at)) / DAY, rate = (xs) => xs.filter((r) => r.status === "ok").length / xs.length;
    const a = rs.filter((r) => age(r) <= 7), b = rs.filter((r) => age(r) > 7 && age(r) <= 21);
    if (a.length < minRuns || b.length < minRuns) continue;
    const ra = rate(a), rb = rate(b);
    if (rb - ra >= drop && ra < 0.95) out.push(res(`rel|${k}`, `${k} reliability`, ra < 0.8 ? "fail" : "warn", `ok ${Math.round(rb * 100)}% → ${Math.round(ra * 100)}% (7 d vs the 14 d before)`));
  }
  return out;
}

// One clock: a plan must start at most once per slot. starts = ISO times a plan run began (first step's `at` per run).
export function doubleRuns(starts, plan, now, { hours = 48, slotMin = 50 } = {}) {
  const xs = starts.filter((s) => now - Date.parse(s) <= hours * 36e5).sort();
  let n = 0; for (let i = 1; i < xs.length; i++) if (Date.parse(xs[i]) - Date.parse(xs[i - 1]) < slotMin * 6e4) n++;
  return n ? res(`double|${plan}`, `${plan} runs once per slot`, n >= 3 ? "fail" : "warn", `${n} extra run(s) < ${slotMin} min apart in ${hours} h (double dispatch = races + waste)`) : null;
}

// Growth to a hard limit: hist = [{day, v}] (one point per day). Projects the 14-day slope to `limit`.
export function growth(id, what, hist, limit, { warnDays = 90, failDays = 30, minPoints = 7, unit = "" } = {}) {
  const h = [...hist].sort((a, b) => a.day.localeCompare(b.day)).slice(-15);
  const last = h.at(-1);
  if (!last) return res(id, what, "learning", "no measurement yet");
  if (last.v >= limit) return res(id, what, "fail", `${last.v}${unit} ≥ limit ${limit}${unit}`);
  if (h.length < minPoints) return res(id, what, "learning", `${last.v}${unit} now; ${h.length}/${minPoints} days of history for a trend`);
  const first = h[0], days = (Date.parse(last.day) - Date.parse(first.day)) / DAY, slope = days > 0 ? (last.v - first.v) / days : 0;
  if (slope <= 0) return res(id, what, "ok", `${last.v}${unit}, not growing`);
  const left = (limit - last.v) / slope;
  const st = left <= failDays ? "fail" : left <= warnDays ? "warn" : "ok";
  return res(id, what, st, `${last.v}${unit}, +${slope.toFixed(2)}${unit}/day → limit ${limit}${unit} in ~${Math.round(left)} days`);
}
