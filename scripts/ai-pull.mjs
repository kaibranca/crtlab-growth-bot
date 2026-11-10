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
