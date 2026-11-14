// AI MACHINE — MONDAY REPORT (11-10). One plain email: is the engine winning, what it learned, what it did, what it
// wants next. Reads only the machine's own files. Runs in weekly.yml (Mon 05:00 UTC); FORCE=1 sends now.
import fs from "node:fs";
import { readLines } from "./lib.mjs";
const J = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const plan = J("data/ai/plan.json"); if (!plan) { console.log("no plan yet"); process.exit(0); }
const sc = readLines("data/ai/score.jsonl"), DAY = 86400000, NOW = Date.now();
const wk = (a, b) => sc.filter((s) => { const t = NOW - Date.parse(s.day + "T12:00:00Z"); return t >= a * DAY && t < b * DAY; }).reduce((t, s) => ({ reads: t.reads + s.reads, clicks: t.clicks + s.clicks, accounts: t.accounts + s.accounts }), { reads: 0, clicks: 0, accounts: 0 });
const now = wk(0, 7), prev = wk(7, 14), ch = (a, b) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "new");
const surges = readLines("data/ai/surges.jsonl").filter((x) => NOW - Date.parse(x.at) < 7 * DAY);
const runs = readLines("data/ai/runs.jsonl").filter((x) => NOW - Date.parse(x.at) < 7 * DAY);
const sent = runs.reduce((t, r) => t + (r.submitted || 0), 0);
const L = plan.learned;
const R = J("data/radar/plan.json"), rs = readLines("data/radar/score.jsonl").filter((s) => !s.invalid), /* 11-14: rows marked invalid never trend */ rw = (a, b) => { const x = rs.filter((s) => { const t = NOW - Date.parse(s.day + "T12:00:00Z"); return t >= a * DAY && t < b * DAY; }); return x.length ? x.at(-1).sov : null; };
const radarLines = R ? [``, `AI RADAR — what AI answers recommend (share of voice, value-weighted)`, `  Now ${(R.sov * 100).toFixed(0)}%${rw(7, 14) != null ? ` (a week ago ${(rw(7, 14) * 100).toFixed(0)}%)` : ""} · spend this month ~$${R.monthCost} of $${R.budget}`,
  ...Object.entries(R.clusters).sort((a, b) => b[1].value - a[1].value).map(([c, x]) => x.n < 1 ? `  ${c.padEnd(7)} not asked yet` : `  ${c.padEnd(7)} ${(x.share * 100).toFixed(0).padStart(3)}% mentioned · ${(x.cited * 100).toFixed(0)}% cited · ${(x.first * 100).toFixed(0)}% first (${Math.round(x.n)} answers)`),
  ...(R.events.filter((e) => NOW - Date.parse(e.at) < 7 * DAY).map((e) => `  ${e.kind}: "${e.q}"`)),
  ...(R.gaps.slice(0, 4).map((g) => `  GAP: "${g.q}" → wins: ${g.winners.slice(0, 3).join(", ")} · our page ${g.ourPage}`)),
  ...([...new Set(R.wrong.map((w) => w.what))].slice(0, 3).map((w) => `  WRONG about CRTLAB: ${w}`))] : [];
const lines = [
  `AI REFERRALS, last 7 days vs the 7 before`,
  `  Accounts from AI answers: ${now.accounts} (${ch(now.accounts, prev.accounts)})`,
  `  People sent by AI:        ${now.clicks} (${ch(now.clicks, prev.clicks)})`,
  `  Live AI reads:            ${now.reads.toLocaleString()} (${ch(now.reads, prev.reads)})`,
  ``,
  `WHAT IT LEARNED`,
  `  Read → click ${(L.globalCtr * 100).toFixed(1)}% · click → account ${(L.globalAcc * 100).toFixed(0)}% · ${L.pagesRead} pages read by AI · ${L.families} page families`,
  `  Release pages are read ${L.eventLift}x more around their release · read coverage ${L.readCoverage ?? "–"}`,
  `  Bing send yield ${L.sendYield ? (L.sendYield.overall * 100).toFixed(0) + "% (" + L.sendYield.judged + " sends judged)" : "–"} · ${L.bingOldCopies ?? 0} pages Bing still holds an old copy of`,
  ``,
  `WHAT IT DID`,
  `  ${sent} pages sent to Bing · ${surges.length} surges caught${surges.length ? ": " + surges.slice(0, 5).map((s) => `${s.key} (${s.last24h} vs ${s.normal}/day)`).join(", ") : ""}`,
  ...(plan.experiments ?? []).map((e) => `  Test ${e.id}: ${e.status} · P(hook wins) ${e.pBbeatsA} · day ${e.days}`),
  ...(plan.truth && !plan.truth.ok ? [`  TRUTH GATE: ${plan.truth.problems.length} problem(s): ${plan.truth.problems.slice(0, 3).join(" | ")}`] : [`  Truth gate: every page agrees on the facts`]),
  ``,
  `WHAT IT WANTS NEXT`,
  `  Convert (read a lot, rarely clicked): ${plan.convert.slice(0, 4).map((x) => x.p).join(", ") || "–"}`,
  `  Expand (best accounts per page): ${plan.expand.slice(0, 4).map((x) => x.family).join(", ") || "–"}`,
  `  Winners to protect: ${plan.winners.slice(0, 4).map((x) => x.p).join(", ") || "–"}`,
  ...radarLines,
  // budget advice (Kai 11-10): $2.50 until the radar proves a fix works; then $5 doubles learning speed. Never guess.
  ...(R ? [R.events.some((e) => e.kind === "WON" && NOW - Date.parse(e.at) < 14 * DAY)
    ? `  BUDGET: a confirmed win in the last 14 days — raising the radar to $5/month (RADAR_BUDGET) now doubles how fast it learns.`
    : `  BUDGET: keep $2.50/month — no confirmed win yet, so more money would only watch the scoreboard more closely.`] : []),
];
// 11-13 NORTH STAR leads the weekly email: new accounts vs a normal week (WORKS), what it pushes, what it froze, whether the
// machines' effort is aimed right, the cycle verdicts — then the AI engine detail below
const WK = (() => { try { return JSON.parse(fs.readFileSync("data/works/plan.json", "utf8")); } catch { return null; } })();
const nsLines = WK ? [`THE NORTH STAR — new accounts`, `  This week ${WK.northStar.now} vs ~${Math.round(WK.northStar.normal)} normal (${WK.northStar.trend >= 0 ? "+" : ""}${Math.round(WK.northStar.trend * 100)}%) · base ${WK.base.perDay}/day`,
  `  Pushing (WORKS focus, effort ${WK.effort}/10): ${(WK.focus ?? []).map((f) => `${f.path} (${f.acc28} acc / 28 d)`).join(", ")}`,
  `  Frozen (dead page types): ${Object.keys(WK.bin ?? {}).join(", ") || "none"}`,
  `  Aim: ${WK.audit?.say ?? "—"}${WK.audit && !WK.audit.aligned ? " — MISALIGNED" : ""}`,
  `  Cycles: ${(WK.cycles?.judged ?? []).map((c) => `${c.day} ${c.verdict} ×${c.lift}`).join(", ") || "first verdicts pending"}`, ``] : [];
const text = [...nsLines, ...lines].join("\n");
console.log(text);
const day = new Date().getUTCDay();
if ((day === 1 || process.env.FORCE) && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: WK ? `CRTLAB week: ${WK.northStar.now} new accounts (normal ~${Math.round(WK.northStar.normal)}) · ${now.accounts} from AI` : `CRTLAB AI engine: ${now.accounts} accounts from AI this week (${ch(now.accounts, prev.accounts)})`, text }) });
  console.log("emailed", e.status);
}
