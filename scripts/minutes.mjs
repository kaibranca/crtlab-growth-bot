// MINUTES — node scripts/minutes.mjs   (hourly; GitHub API only). Kai 11-14: "nothing should accumulate and hit GitHub's free
// stuff, at all — we stay free." Private repos share 2,000 free Actions minutes a month; past that, GitHub STOPS the runs
// (the daily data pull would die near month end). Public repos (this bot) are free and unlimited. This watches month-to-date
// billed minutes (each job rounds UP to a whole minute) on the private repos, projects the month, and alerts EARLY.
import fs from "node:fs";
import { govern, FREE as FREE_ } from "./minutes-lib.mjs";
const TOK = process.env.GH_WATCH_TOKEN, REPOS = ["kaibranca/crtlab-backtester", "kaibranca/crtlab-standalone"], FREE = FREE_;
if (!TOK) { console.log("minutes: no GH_WATCH_TOKEN"); process.exit(0); }
const now = new Date(), m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
const H = { authorization: `Bearer ${TOK}`, accept: "application/vnd.github+json", "user-agent": "crtlab-minutes" };
let used = 0, wk = 0; const per = {}, w0 = Date.now() - 7 * 864e5;
for (const r of REPOS) { let page = 1, n = 0;
  for (;;) { const j = await (await fetch(`https://api.github.com/repos/${r}/actions/runs?per_page=100&page=${page}&created=>=${m0.toISOString().slice(0, 10)}`, { headers: H })).json();
    const runs = j.workflow_runs || []; for (const x of runs) { if (!x.run_started_at || !x.updated_at) continue; const min = Math.max(1, Math.ceil((Date.parse(x.updated_at) - Date.parse(x.run_started_at)) / 6e4)); used += min; n += min; if (Date.parse(x.run_started_at) > w0) wk += min; }
    if (runs.length < 100) break; page++; }
  per[r.split("/")[1]] = n; }
const rate = wk / 7, g = govern({ used, perDay7: +rate.toFixed(1), dayOfMonth: now.getUTCDate(), daysInMonth: days, essentialPerDay: 35 });
let prev = null; try { prev = JSON.parse(fs.readFileSync("data/guard/minutes.json", "utf8")); } catch {}
const st = { at: now.toISOString(), used, perDay7: +rate.toFixed(1), perRepo: per, ...g };
fs.mkdirSync("data/guard", { recursive: true }); fs.writeFileSync("data/guard/minutes.json", JSON.stringify(st, null, 1));
console.log(`minutes: ${used} used, projected ${g.projected}, ceiling ${g.ceiling}/${FREE} → ${g.mode} (${g.why})`, JSON.stringify(per));
// email on every mode CHANGE (incl. back to normal) and whenever projected crosses the ceiling
if ((prev?.mode ?? "normal") !== g.mode || g.projected > g.ceiling) { const { send } = await import("../reels/engine/alert.mjs");
  await send([[`minutes-${now.toISOString().slice(0, 10)}-${g.mode}`, `GitHub minutes governor: ${g.mode.toUpperCase()} — ${g.why}. Used ${used} this month, projected ${g.projected}, own ceiling ${g.ceiling} (GitHub free ${FREE}). Retry slots allowed: ${g.retrySlots ? g.retrySlots.map((h) => h + ":30").join(", ") : "all"}. The daily pull always runs.`]], "CRTLAB minutes"); }
