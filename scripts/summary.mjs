// builds data/summary.json — the one small file the Control "Growth" board reads
import fs from "node:fs";
import { readLines, month } from "./lib.mjs";
const months = [month(new Date(Date.now() - 32 * 86400000)), month()].filter((v, i, a) => a.indexOf(v) === i);
const wd = months.flatMap((m) => readLines(`data/watchdog/${m}.jsonl`));
const ai = months.flatMap((m) => readLines(`data/aicrawl/${m}.jsonl`));
const ix = readLines("data/indexnow.jsonl");
const since = (d) => Date.now() - d * 86400000;
const up = (d) => { const w = wd.filter((x) => new Date(x.at) >= since(d)); return w.length ? +(100 * w.filter((x) => x.ok).length / w.length).toFixed(2) : null; };
const byDay = {};
for (const a of ai) { const day = a.to.slice(0, 10); byDay[day] = byDay[day] || {}; for (const [b, v] of Object.entries(a.bots)) byDay[day][b] = (byDay[day][b] || 0) + v.hits; }
const pages = {};
for (const a of ai.filter((x) => new Date(x.to) >= since(7))) for (const v of Object.values(a.bots)) for (const [p, n] of v.top) pages[p] = (pages[p] || 0) + n;
const last = wd[wd.length - 1];
fs.writeFileSync("data/summary.json", JSON.stringify({
  updated: new Date().toISOString(),
  watchdog: { up24h: up(1), up7d: up(7), up30d: up(30), last, incidents: wd.filter((x) => !x.ok).slice(-20).map((x) => ({ at: x.at, failed: x.results.filter((r) => !r.ok).map((r) => `${r.name} ${r.status}`) })),
    speed: Object.fromEntries((last?.results || []).map((r) => [r.name, r.ms])) },
  aicrawl: { byDay: Object.fromEntries(Object.entries(byDay).sort().slice(-30)), topPages7d: Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 20) },
  indexnow: ix.slice(-30).map((x) => ({ at: x.at, submitted: x.submitted, status: x.status })),
}, null, 1));
console.log("summary written");
