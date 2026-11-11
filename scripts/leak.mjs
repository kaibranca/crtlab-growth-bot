// CONVERSION LEAK MACHINE (11-11, Kai: "a machine for the conversion leak"). DAILY. Reads the site's funnel
// (/api/ops/funnel, 14 finished days: source × landing page → visitors → accounts → first replay within a day → paid now)
// and finds WHERE each source and each page type leaks, in people:
//   per stage (land→account, account→replay, replay→paid), each segment's rate is shrunk toward the overall rate (K = 20
//   people at that stage) so small samples can't scream; the gap to the best segment's rate × its volume = people lost.
//   The biggest losses are the leaks, ranked; each leak names the stage, the segment and the fix family to try.
// LEARNS: every run is kept (data/leak/score.jsonl); a leak that shrinks after a change is a WIN in the ledger, one that
// grows is flagged. Self-registers with the engine core (data/machines/self/leak.json) — no hand-wiring.
import fs from "node:fs";
import { SITE, get, append, readLines } from "./lib.mjs";
import { family } from "./ai-machine-family.mjs";

const DIR = "data/leak", NOW = Date.now(), iso = (t) => new Date(t).toISOString().slice(0, 10);
fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync("data/machines/self", { recursive: true });
fs.writeFileSync("data/machines/self/leak.json", JSON.stringify({ id: "leak", name: "Conversion leak", group: "conversion", parent: "lead-conversion",
  does: "Follows every source and landing page from visit → account → first replay → paid, and ranks where people are lost", every: 24, out: "data/leak/plan.json", feeds: ["behaviour", "ai"] }));
const r = await get(`${process.env.FUNNEL_BASE || SITE}/api/ops/funnel?days=14`, { headers: { "x-ops-key": process.env.OPS_KEY || "" } });
if (r.status !== 200) { console.log("funnel not available yet", r.status); process.exit(0); }
const { rows } = JSON.parse(r.body);
const seg = {}; const T = { visitors: 0, accounts: 0, activated: 0, paid: 0 };
const add = (k, x) => { const o = (seg[k] ??= { key: k, visitors: 0, accounts: 0, activated: 0, paid: 0 }); for (const f of ["visitors", "accounts", "activated", "paid"]) o[f] += x[f]; };
for (const x of rows) { add(`source:${x.src}`, x); add(`page:${family(x.path)}`, x); add(`ai-page:${x.src === "chatgpt" || x.src === "other ai" ? family(x.path) : "-"}`, x); for (const f in T) T[f] += x[f]; }
delete seg["ai-page:-"];
const STAGES = [["land → account", "visitors", "accounts", "the first screen: what they see and can do before signing up"], ["account → first replay", "accounts", "activated", "the first chart: a ready-to-play move, play highlighted"], ["replay → paid", "activated", "paid", "the wall and checkout: offer, price, payment method"]];
const K = 20, leaks = [];
for (const [stage, a, b, fix] of STAGES) {
  const g = T[b] / Math.max(1, T[a]);
  const segs = Object.values(seg).filter((s) => s[a] >= 5).map((s) => ({ ...s, rate: (s[b] + K * g) / (s[a] + K) }));
  const best = Math.max(g, ...segs.filter((s) => s[a] >= 20).map((s) => s.rate));
  for (const s of segs) { const lost = (best - s.rate) * s[a]; if (lost >= 1) leaks.push({ stage, segment: s.key, base: s[a], rate: +s.rate.toFixed(3), overall: +g.toFixed(3), best: +best.toFixed(3), lost: +lost.toFixed(1), fix }); }
}
leaks.sort((x, y) => y.lost - x.lost);
const overall = { ...T, landToAccount: +(T.accounts / Math.max(1, T.visitors)).toFixed(3), accountToReplay: +(T.activated / Math.max(1, T.accounts)).toFixed(3), replayToPaid: +(T.paid / Math.max(1, T.activated)).toFixed(4) };
// learning: compare with the last run a week ago — leaks that shrank are wins, that grew are flagged
const prev = readLines(`${DIR}/score.jsonl`).filter((x) => NOW - Date.parse(x.at) > 6 * 864e5).slice(-1)[0];
const verdicts = [];
if (prev) for (const l of leaks.slice(0, 10)) { const p = prev.top.find((x) => x.stage === l.stage && x.segment === l.segment); if (!p) continue; const d = l.lost - p.lost;
  if (Math.abs(d) >= 2) { verdicts.push({ ...l, was: p.lost, change: +d.toFixed(1) }); append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `leak|${l.stage}|${l.segment}|${iso(NOW)}`, machine: "leak", kind: d < 0 ? "win" : "lesson", what: `${l.segment} at ${l.stage}: ${d < 0 ? "leak shrank" : "leak grew"} ${p.lost} → ${l.lost} people / 14 d` }); } }
const plan = { at: new Date().toISOString(), days: 14, overall, sources: Object.values(seg).filter((s) => s.key.startsWith("source:")), leaks: leaks.slice(0, 15), verdicts };
fs.writeFileSync(`${DIR}/plan.json`, JSON.stringify(plan, null, 1));
append(`${DIR}/score.jsonl`, { at: plan.at, overall, top: leaks.slice(0, 15).map(({ stage, segment, lost }) => ({ stage, segment, lost })) });
console.log(`leak: ${T.visitors} visitors → ${T.accounts} accounts → ${T.activated} replayed → ${T.paid} paid · top leak: ${leaks[0] ? `${leaks[0].segment} at ${leaks[0].stage} (${leaks[0].lost} people)` : "none"}`);
