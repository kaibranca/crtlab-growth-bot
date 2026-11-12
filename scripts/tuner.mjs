// THE TUNER (11-12, Kai: "something always running, upgrading the machines every day — not Claude — they scale on their own as
// data comes in, a trend that slowly spikes"). Every machine runs on constants someone picked once (explore 15 %, top-5
// sisters…). The tuner turns each one into a live experiment that never ends:
//   SWITCHBACK  each 2-day block of the calendar runs either the CHAMPION value or a CHALLENGER (one step up or down),
//               by a hash of (knob, challenge, block) — every knob has its own random schedule, so several run at once
//               without confounding (a factorial design).
//   JUDGE       the knob's KPI per day, normalised by its own trailing 7-day mean (so growth and slumps cancel out), averaged
//               per block; bootstrap over blocks → P(challenger beats champion). ≥ 5 blocks per arm before any verdict.
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
};
// THE KNOBS (owner = the machine whose IQ the verdicts feed). Values are the ladder the tuner climbs.
const KNOBS = [
  { id: "ai.exploreShare", owner: "ai", ladder: [0.08, 0.12, 0.15, 0.2, 0.27, 0.35], start: 0.15, kpi: "reads", what: "share of Bing sends spent exploring pages the machine knows least about" },
  // (sisterTop / surgeCap are NOT here: the core's mode episodes already tune them — one tuner per knob, never two)
];

const S = J(OUT, { knobs: {} }); S.knobs ??= {};
const days = [...score.keys()].sort(), today = iso(NOW), blockOf = (d) => Math.floor(Date.parse(d + "T12:00:00Z") / (2 * DAY));
const norm = (d) => { const i = days.indexOf(d); if (i < 7) return null; const prev = days.slice(i - 7, i).map((x) => KPI_FN(x)).filter((v) => v != null);
  const m = prev.reduce((a, b) => a + b, 0) / Math.max(1, prev.length), v = KPI_FN(d); return v == null || !m ? null : Math.log((v + 1) / (m + 1)); };
let KPI_FN = null;
const led = (o) => fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify(o) + "\n");
const active = {};

for (const K of KNOBS) {
  const k = (S.knobs[K.id] ??= { champion: K.start, dir: 1, challenge: null, history: [], settled: null });
  const L = K.ladder, ci = L.indexOf(k.champion) >= 0 ? L.indexOf(k.champion) : L.indexOf(K.start);
  // open a challenge if none is running (and not settled within 30 days)
  if (!k.challenge && !(k.settled && NOW - Date.parse(k.settled) < 30 * DAY)) {
    let ni = ci + k.dir; if (ni < 0 || ni >= L.length) { k.dir = -k.dir; ni = ci + k.dir; }
    if (ni >= 0 && ni < L.length) { k.challenge = { value: L[ni], dir: k.dir, since: today, id: `${K.id}:${L[ni]}:${today}`, tries: (k.triesInRow ?? 0) }; k.settled = null; }
  }
  const ch = k.challenge;
  const arm = (d) => (ch && d >= ch.since ? (fnv(ch.id + "|" + blockOf(d)) % 2 ? "B" : "A") : "A"); // B = challenger
  active[K.id] = ch && arm(today) === "B" ? ch.value : k.champion; // re-set below if a verdict lands this run
  if (!ch) continue;
  // judge: per block mean of the normalised KPI
  KPI_FN = KPI[K.kpi];
  const blocks = new Map();
  for (const d of days.filter((x) => x >= ch.since && x < today)) { const v = norm(d); if (v == null) continue; const b = blockOf(d), o = blocks.get(b) ?? { arm: arm(d), s: 0, n: 0 }; o.s += v; o.n++; blocks.set(b, o); }
  const A = [...blocks.values()].filter((b) => b.arm === "A").map((b) => b.s / b.n), B = [...blocks.values()].filter((b) => b.arm === "B").map((b) => b.s / b.n);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  let P = null;
  if (A.length >= 5 && B.length >= 5) { let w = 0; for (let i = 0; i < 2000; i++) { const ra = A.map(() => A[Math.floor(Math.random() * A.length)]), rb = B.map(() => B[Math.floor(Math.random() * B.length)]); if (mean(rb) > mean(ra)) w++; } P = w / 2000; }
  ch.read = { blocksA: A.length, blocksB: B.length, lift: A.length && B.length ? +Math.exp(mean(B) - mean(A)).toFixed(3) : null, P, at: new Date().toISOString() };
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
S.active = active; S.at = new Date().toISOString();
S.note = "Self-tuning knobs: champion vs challenger in 2-day switchback blocks, judged on the knob's KPI (normalised by its own 7-day mean). Machines read active[knob].";
fs.writeFileSync(OUT, JSON.stringify(S, null, 1));
console.log(`tuner: ${KNOBS.map((K) => { const k = S.knobs[K.id]; return `${K.id}=${active[K.id]} (champion ${k.champion}${k.challenge ? ` vs ${k.challenge.value}, ${k.challenge.read?.blocksA ?? 0}+${k.challenge.read?.blocksB ?? 0} blocks` : ""})`; }).join(" · ")}`);
