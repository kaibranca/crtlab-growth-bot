// DAILY: AI referral clicks per landing page per day, from the site (/api/ops/ai-referrals, x-ops-key). Keeps one line per
// day+engine+path in data/ai/clicks.json (latest read wins: today's partial day is re-read tomorrow). Until the site
// route is deployed it answers 404 → skip quietly; the machine then learns from reads alone.
import fs from "node:fs";
import { SITE, get } from "./lib.mjs";
const F = "data/ai/clicks.json";
const r = await get(`${SITE}/api/ops/ai-referrals?days=3`, { headers: { "x-ops-key": process.env.OPS_KEY || "" } });
if (r.status !== 200) { console.log("ai-referrals not available yet", r.status); process.exit(0); }
const j = JSON.parse(r.body);
fs.mkdirSync("data/ai", { recursive: true });
const all = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, "utf8")) : {};
const fresh = new Set(j.rows.map((x) => x.day));
for (const k of Object.keys(all)) if (fresh.has(k.slice(0, 10))) delete all[k]; // re-read days replace old lines whole
for (const x of j.rows) all[`${x.day}|${x.engine}|${x.path}`] = [x.visitors, x.accounts];
const keep = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10); // a year+ of history: the machine's memory
for (const k of Object.keys(all)) if (k.slice(0, 10) < keep) delete all[k];
fs.writeFileSync(F, JSON.stringify(all));
console.log(`ai clicks: ${j.rows.length} rows for ${[...fresh].sort().join(", ")} · ${Object.keys(all).length} kept`);
// HOURLY GRAIN (11-12): the same funnel per UTC hour → data/ai/clicks-hourly.json (60 days). Feeds the 2-hour switchback
// tests. One more light grouped scan per run; an old site (no grain support) answers daily rows → ignored.
const FH = "data/ai/clicks-hourly.json";
const rh = await get(`${SITE}/api/ops/ai-referrals?days=2&grain=hour`, { headers: { "x-ops-key": process.env.OPS_KEY || "" } });
const jh = rh.status === 200 ? JSON.parse(rh.body) : null;
if (jh?.grain === "hour") {
  const allH = fs.existsSync(FH) ? JSON.parse(fs.readFileSync(FH, "utf8")) : { from: null, rows: {} };
  const freshH = new Set(jh.rows.map((x) => x.day));
  for (const k of Object.keys(allH.rows)) if (freshH.has(k.slice(0, 13))) delete allH.rows[k];
  for (const x of jh.rows) allH.rows[`${x.day}|${x.engine}|${x.path}`] = [x.visitors, x.accounts];
  // hours are only trustworthy from the first full hour this file saw (earlier hours were never read hour by hour)
  allH.from ??= new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 13);
  const keepH = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 13);
  for (const k of Object.keys(allH.rows)) if (k.slice(0, 13) < keepH) delete allH.rows[k];
  fs.writeFileSync(FH, JSON.stringify(allH));
  console.log(`ai clicks hourly: ${jh.rows.length} rows · ${Object.keys(allH.rows).length} kept since ${allH.from}`);
} else console.log("ai clicks hourly: site has no grain=hour yet", rh.status);
