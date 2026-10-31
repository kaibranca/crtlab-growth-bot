// HOURLY: collect the site's in-memory AI crawler counts (drained by /api/ops/aicrawl, answered by proxy.ts)
import { SITE, get, append, month } from "./lib.mjs";
const r = await get(`${SITE}/api/ops/aicrawl`, { headers: { "x-ops-key": process.env.OPS_KEY || "" } });
if (r.status !== 200) { console.error("aicrawl drain failed", r.status, r.body.slice(0, 200)); process.exit(0); } // not an outage — the watchdog covers that
const j = JSON.parse(r.body);
append(`data/aicrawl/${month()}.jsonl`, j);
console.log(JSON.stringify(Object.fromEntries(Object.entries(j.bots).map(([k, v]) => [k, v.hits]))));
