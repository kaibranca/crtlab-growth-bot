// THE TUNER (11-12, Kai: "something always running, upgrading the machines every day — not Claude — they scale on their own as
// data comes in, a trend that slowly spikes"). Every machine runs on constants someone picked once (explore 15 %, top-5
// sisters…). The tuner turns each one into a live experiment that never ends:
//   SWITCHBACK  each 2-day block of the calendar runs either the CHAMPION value or a CHALLENGER (one step up or down),
//               by a hash of (knob, challenge, block) — every knob has its own random schedule, so several run at once
//               without confounding (a factorial design).
//   JUDGE       regression per day: log KPI = level + trend + release-day effect + δ·challenger (growth and release spikes
//               fitted out); block bootstrap → P(δ > 0). ≥ 5 blocks per arm before any verdict.
//   ACT         P ≥ 0.9 → challenger PROMOTED, the next step in the same direction is tried (hill-climbing);
//               P ≤ 0.1 → champion kept, the other direction is tried next; 14 blocks per arm with no answer → "no effect",
//               the other direction, then it settles and re-opens after 30 days (the world changes).
//   LEARN       every verdict → ledger (the owner machine's win / loss / lesson) → IQ; the knob's history is its memory.
// Machines read today's value from data/machines/knobs.json → active[knob]. Light: files only.
import fs from "node:fs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/machines/knobs.json";
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };

// KPIs: one number per finished UTC day
const score = new Map(lines("data/ai/score.jsonl").map((r) => [r.day, r]));
const KPI = {
  reads: (d) => score.get(d)?.reads ?? null, // people asking AI about our pages (ChatGPT-User etc.) — the reach the AI machine buys with Bing sends
  ctr: (d) => { const r = score.get(d); return r && r.reads ? (r.clicks ?? 0) / r.reads : null; }, // AI clicks per read — the conversion constraint
};
// THE OBJECTIVE UPGRADES ITSELF: "auto" judges on reads while clicks are too few to see (< 25 a day over 14 days), then on
// click-through — the real constraint — once traffic can carry it. The tuner gets a sharper goal as the data grows.
const last14 = [...score.values()].slice(-14), clicksDay = last14.reduce((a, r) => a + (r.clicks ?? 0), 0) / Math.max(1, last14.length);
const AUTO_KPI = clicksDay >= 25 ? "ctr" : "reads";
// THE KNOBS (owner = the machine whose IQ the verdicts feed). Values are the ladder the tuner climbs.
const BUILTIN = [
  { id: "ai.exploreShare", owner: "ai", ladder: [0.08, 0.12, 0.15, 0.2, 0.27, 0.35], start: 0.15, kpi: "reads", what: "share of Bing sends spent exploring pages the machine knows least about" },
  { id: "ai.resendDays", owner: "bing", ladder: [3, 5, 7, 10, 14], start: 7, kpi: "reads", what: "days before an unchanged page is re-sent to Bing (where the limited quota goes)" },
  // (sisterTop / surgeCap are NOT here: the core's mode episodes already tune them — one tuner per knob, never two)
];

// + every knob a machine REGISTERED by using lib.mjs knob() — new constants join the loop by themselves
const ladderFor = (d) => { const xs = [0.5, 0.75, 1, 1.33, 2].map((m) => d * m); return Number.isInteger(d) ? [...new Set(xs.map((x) => Math.max(1, Math.round(x))))] : xs.map((x) => +x.toPrecision(3)); };
const REG = J("data/machines/knob-registry.json", {}) ?? {};
const KNOBS = [...BUILTIN];
for (const [id, r] of Object.entries(REG)) { if (typeof r.start !== "number") continue; const b = KNOBS.find((k) => k.id === id);
  const K = { id, owner: r.owner, ladder: r.ladder ?? ladderFor(r.start), start: r.start, kpi: r.kpi ?? "auto", what: r.what ?? id };
  if (b) Object.assign(b, { ...K, ladder: r.ladder ?? b.ladder }); else KNOBS.push(K); }
for (const K of KNOBS) if (K.kpi === "auto") K.kpi = AUTO_KPI;
const REL = new Map(); for (const e of J("data/events/index.json", []) ?? []) if (e.date) REL.set(e.date, (REL.get(e.date) ?? 0) + 1); // releases per day
const S = J(OUT, { knobs: {} }); S.knobs ??= {};
const days = [...score.keys()].sort(), today = iso(NOW), blockOf = (d) => Math.floor(Date.parse(d + "T12:00:00Z") / (2 * DAY));
const norm = (d) => { const i = days.indexOf(d); if (i < 7) return null; const prev = days.slice(i - 7, i).map((x) => KPI_FN(x)).filter((v) => v != null);
  const m = prev.reduce((a, b) => a + b, 0) / Math.max(1, prev.length), v = KPI_FN(d); return v == null || !m ? null : Math.log((v + 1) / (m + 1)); };
let KPI_FN = null;
const led = (o) => fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify(o) + "\n");
const active = {};

for (const K of KNOBS) {
  const k = (S.knobs[K.id] ??= { champion: K.start, dir: 1, challenge: null, history: [], settled: null });
  k.owner = K.owner; k.kpi = K.kpi; k.what = K.what;
  if (k.challenge && k.challenge.kpi && k.challenge.kpi !== K.kpi) k.challenge = null; // the objective upgraded: restart the test on it
  const L = K.ladder, ci = L.indexOf(k.champion) >= 0 ? L.indexOf(k.champion) : L.indexOf(K.start);
  // open a challenge if none is running (and not settled within 30 days)
  if (!k.challenge && !(k.settled && NOW - Date.parse(k.settled) < 30 * DAY)) {
    let ni = ci + k.dir; if (ni < 0 || ni >= L.length) { k.dir = -k.dir; ni = ci + k.dir; }
    if (ni >= 0 && ni < L.length) { k.challenge = { value: L[ni], dir: k.dir, since: today, id: `${K.id}:${L[ni]}:${today}`, kpi: K.kpi, tries: (k.triesInRow ?? 0) }; k.settled = null; }
  }
  const ch = k.challenge;
  const arm = (d) => (ch && d >= ch.since ? (fnv(ch.id + "|" + blockOf(d)) % 2 ? "B" : "A") : "A"); // B = challenger
  active[K.id] = ch && arm(today) === "B" ? ch.value : k.champion; // re-set below if a verdict lands this run
  if (!ch) continue;
  // judge: per block mean of the normalised KPI
  KPI_FN = KPI[K.kpi];
  // REGRESSION JUDGE (11-12): log KPI_d = level + trend·t + release-day effect + δ·[challenger day]. Growth and release spikes
  // are fitted out instead of being noise; δ is the knob's own effect. P(δ > 0) = share of block-bootstrap refits with δ > 0.
  const obs = [];
  for (const d of days.filter((x) => x >= ch.since && x < today)) { const v = KPI_FN(d); if (v == null) continue;
    obs.push({ d, b: blockOf(d), t: (Date.parse(d) - Date.parse(ch.since)) / DAY, rel: Math.log1p(REL.get(d) ?? 0), y: Math.log(v + (K.kpi === "ctr" ? 0.001 : 1)), x: arm(d) === "B" ? 1 : 0 }); }
  const bl = [...new Set(obs.map((o) => o.b))], armOf = (b) => obs.find((o) => o.b === b).x;
  const A = bl.filter((b) => !armOf(b)), B = bl.filter((b) => armOf(b));
  const fitD = (rows) => { // OLS on [1, t, rel, x] → δ (normal equations, 4×4)
    const X = rows.map((o) => [1, o.t, o.rel, o.x]), y = rows.map((o) => o.y), n = 4;
    const M = Array.from({ length: n }, (_, a) => Array.from({ length: n + 1 }, (_, c) => (c < n ? X.reduce((t, r) => t + r[a] * r[c], 0) : X.reduce((t, r, k) => t + r[a] * y[k], 0))));
    for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; if (Math.abs(M[c][c]) < 1e-9) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
    return M[3][n] / M[3][3]; };
  let P = null, delta = null;
  if (A.length >= 5 && B.length >= 5) { delta = fitD(obs); let w = 0, m = 0;
    const byB = new Map(bl.map((b) => [b, obs.filter((o) => o.b === b)]));
    for (let i = 0; i < 1000; i++) { const pick = [...A.map(() => A[Math.floor(Math.random() * A.length)]), ...B.map(() => B[Math.floor(Math.random() * B.length)])];
      const dd = fitD(pick.flatMap((b, k) => byB.get(b).map((o) => ({ ...o, b: k })))); if (dd == null) continue; m++; if (dd > 0) w++; }
    P = m ? w / m : null; }
  ch.read = { blocksA: A.length, blocksB: B.length, lift: delta != null ? +Math.exp(delta).toFixed(3) : null, P, at: new Date().toISOString(), model: "log KPI ~ trend + release + arm" };
  const done = P != null && (P >= 0.9 || P <= 0.1 || (A.length >= 14 && B.length >= 14));
  if (!done) continue;
  const verdict = P >= 0.9 ? "promoted" : P <= 0.1 ? "kept champion" : "no effect";
  k.history.push({ champion: k.champion, challenger: ch.value, since: ch.since, ended: today, ...ch.read, verdict });
  k.history = k.history.slice(-30);
  led({ at: new Date().toISOString(), key: `tune|${K.id}|${ch.since}`, machine: K.owner, kind: verdict === "promoted" ? "win" : verdict === "kept champion" ? "loss" : "lesson",
    what: `tuner: ${K.what} ${k.champion} vs ${ch.value} — ${K.kpi} ×${ch.read.lift} (P ${P.toFixed(2)}, ${A.length}+${B.length} blocks): ${verdict}` });
  if (verdict === "promoted") { k.champion = ch.value; k.triesInRow = 0; } // keep climbing the same way
  else { k.dir = -ch.dir; k.triesInRow = (k.triesInRow ?? 0) + 1; if (k.triesInRow >= 2) { k.settled = new Date().toISOString(); k.triesInRow = 0; } } // both ways tried → settle 30 d
  k.challenge = null;
  active[K.id] = k.champion; // the next challenge opens next run
}
S.active = active; S.at = new Date().toISOString(); S.objective = { kpi: AUTO_KPI, clicksPerDay: +clicksDay.toFixed(1), switchAt: 25 };
S.note = "Self-tuning knobs: champion vs challenger in 2-day switchback blocks, judged on the knob's KPI (normalised by its own 7-day mean). Machines read active[knob].";
fs.writeFileSync(OUT, JSON.stringify(S, null, 1));
console.log(`tuner: ${KNOBS.map((K) => { const k = S.knobs[K.id]; return `${K.id}=${active[K.id]} (champion ${k.champion}${k.challenge ? ` vs ${k.challenge.value}, ${k.challenge.read?.blocksA ?? 0}+${k.challenge.read?.blocksB ?? 0} blocks` : ""})`; }).join(" · ")}`);
