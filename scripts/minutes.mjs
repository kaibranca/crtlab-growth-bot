// MINUTES — node scripts/minutes.mjs   (hourly; GitHub API only). Kai 11-14: "nothing should accumulate and hit GitHub's free
// stuff, at all — we stay free." Private repos share 2,000 free Actions minutes a month; past that, GitHub STOPS the runs
// (the daily data pull would die near month end). Public repos (this bot) are free and unlimited. This watches month-to-date
// billed minutes (each job rounds UP to a whole minute) on the private repos, projects the month, and alerts EARLY.
import fs from "node:fs";
const TOK = process.env.GH_WATCH_TOKEN, REPOS = ["kaibranca/crtlab-backtester", "kaibranca/crtlab-standalone"], FREE = 2000;
if (!TOK) { console.log("minutes: no GH_WATCH_TOKEN"); process.exit(0); }
const now = new Date(), m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
const H = { authorization: `Bearer ${TOK}`, accept: "application/vnd.github+json", "user-agent": "crtlab-minutes" };
let used = 0, wk = 0; const per = {}, w0 = Date.now() - 7 * 864e5;
for (const r of REPOS) { let page = 1, n = 0;
  for (;;) { const j = await (await fetch(`https://api.github.com/repos/${r}/actions/runs?per_page=100&page=${page}&created=>=${m0.toISOString().slice(0, 10)}`, { headers: H })).json();
    const runs = j.workflow_runs || []; for (const x of runs) { if (!x.run_started_at || !x.updated_at) continue; const min = Math.max(1, Math.ceil((Date.parse(x.updated_at) - Date.parse(x.run_started_at)) / 6e4)); used += min; n += min; if (Date.parse(x.run_started_at) > w0) wk += min; }
    if (runs.length < 100) break; page++; }
  per[r.split("/")[1]] = n; }
const day = (now - m0) / 864e5, rate = wk / 7, proj = Math.round(used + rate * (days - day)), // projected from the LAST 7 DAYS' pace (a new job mid-month would hide in a month average)
  _r = 0, st = { at: now.toISOString(), used, perDay7: +rate.toFixed(1), projected: proj, free: FREE, perRepo: per };
fs.mkdirSync("data/guard", { recursive: true }); fs.writeFileSync("data/guard/minutes.json", JSON.stringify(st, null, 1));
console.log(`minutes: ${used} used this month, projected ${proj} of ${FREE} free`, JSON.stringify(per));
if (proj > FREE * .75 || used > FREE * .7) { const { send } = await import("../reels/engine/alert.mjs");
  await send([[`minutes-${now.toISOString().slice(0, 7)}-${proj > FREE ? "over" : "high"}`, `GitHub Actions minutes on PRIVATE repos: ${used} used, projected ${proj} of ${FREE} free this month (${JSON.stringify(per)}). Past ${FREE} GitHub stops the runs — the daily data pull would stop. Trim retries / job time now.`]], "CRTLAB minutes"); }
