// DUE — node reels/engine/due.mjs → prints "<plan> <k> <plat>" lines for posts due now (hourly tick; cheap, no rendering).
// A slot is due from its time until 3h after (GitHub cron drops runs; the next tick catches it). Older than 3h → logged as missed.
import fs from "node:fs"; import { DIR, readLog } from "./brain.mjs";
const now = Date.now(), log = readLog(), done = new Set(log.map((x) => `${x.plan}|${x.k}|${x.plat}`));
const live = fs.existsSync(`${DIR}/live.json`) && JSON.parse(fs.readFileSync(`${DIR}/live.json`, "utf8")).live === true;
const plans = fs.readdirSync(DIR).filter((f) => /^plan-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().slice(-3).map((f) => JSON.parse(fs.readFileSync(`${DIR}/${f}`, "utf8")));
for (const p of plans) for (const r of p.reels) for (const plat of ["ig", "fb"]) {
  const key = `${p.date}|${r.k}|${plat}`, t = Date.parse(r[plat].at); if (done.has(key) || t > now) continue;
  if (now - t > 3 * 3.6e6) { if (live) { fs.appendFileSync(`${DIR}/log.jsonl`, JSON.stringify({ plan: p.date, k: r.k, plat, story: r.story, missed: true, at: new Date().toISOString() }) + "\n");
    fs.appendFileSync(`${DIR}/alerts.jsonl`, JSON.stringify({ at: new Date().toISOString(), kind: "missed", plat, plan: p.date, k: r.k, note: "slot passed without a post (render failed or runs dropped)" }) + "\n"); } continue; }
  console.log(`${p.date} ${r.k} ${plat}`);
}
if (!live) console.error("(engine not live: data/reels/live.json → {\"live\": true} to start posting)");
