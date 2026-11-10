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
];
const text = lines.join("\n");
console.log(text);
const day = new Date().getUTCDay();
if ((day === 1 || process.env.FORCE) && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB AI engine: ${now.accounts} accounts from AI this week (${ch(now.accounts, prev.accounts)})`, text }) });
  console.log("emailed", e.status);
}
