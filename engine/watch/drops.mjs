// engine/watch/drops.mjs — WATCH loop, step 1 (v2). Daily, after the day closes. One read-only query set, no hands.
//   in : prod analytics (ANALYTICS_DB_URL) — new accounts + real visitors per UTC day, by source
//   out: data/engine/drops.json (owner: daily/drops) · ledger row + email ONLY when a metric's level CHANGES
// Method + thresholds: drops-lib.mjs (weekday-adjusted, measured dispersion, backtested Aug–Nov 2026).
import fs from "node:fs";
import { evaluate } from "./drops-lib.mjs";
import { addDays, iso } from "../lib/stats.mjs";

const OUT = "data/engine/drops.json", LEDGER = "data/machines/ledger.jsonl", FROM_DAYS = 120;
const url = process.env.ANALYTICS_DB_URL;
if (!url) { console.log("drops: no ANALYTICS_DB_URL — skipped"); process.exit(0); }

// sources: one mapping for accounts and visitors, so the two are comparable
const SRC = `case when s ~ 'google' then 'google' when s ~ 'chatgpt|openai' then 'chatgpt' when s ~ 'bing' then 'bing'
  when s ~ 'instagram|facebook|^ig$|^fb$|tiktok|youtube|reddit|x\\.com|t\\.co' then 'social' when s in ('direct','none','') then 'direct' else 'other' end`;
export const METRICS = ["accounts", "accounts.google", "accounts.chatgpt", "accounts.bing", "accounts.direct", "accounts.social",
  "visitors", "visitors.google", "visitors.chatgpt", "visitors.bing"];

const pg = (await import("pg")).default;
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("set time zone 'UTC'");
const since = iso(Date.now() - FROM_DAYS * 864e5), end = iso(Date.now() - 864e5); // last COMPLETE UTC day
const acc = (await db.query(`select to_char(created_at,'YYYY-MM-DD') d, ${SRC} src, count(*)::int n from (select created_at,
  lower(coalesce(nullif(signup_utm_source,''), nullif(signup_source,''), 'none')) s from users where created_at >= $1 and created_at < $2::date + 1) u group by 1,2`, [since, end])).rows;
// real visitor = replayed ≥ 1 candle or made an account (the ecosystem's one standard — bots never count)
const vis = (await db.query(`select to_char(g.created_at,'YYYY-MM-DD') d, ${SRC} src, count(*)::int n from (select created_at, device_key, converted_at,
  lower(coalesce(nullif(source,''),'none')) s from guest_presence where created_at >= $1 and created_at < $2::date + 1) g
  where g.converted_at is not null or exists (select 1 from guest_meters m where m.device_key = g.device_key and m.candles_used > 0) group by 1,2`, [since, end])).rows;
await db.end();

const series = Object.fromEntries(METRICS.map((m) => [m, {}]));
const put = (k, d, n) => { if (series[k]) series[k][d] = (series[k][d] ?? 0) + n; };
for (const r of acc) { put("accounts", r.d, r.n); put("accounts." + r.src, r.d, r.n); }
for (const r of vis) { put("visitors", r.d, r.n); put("visitors." + r.src, r.d, r.n); }

const metrics = {};
for (const m of METRICS) metrics[m] = evaluate(series[m], since, end);

let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
const changed = METRICS.filter((m) => (prev?.metrics?.[m]?.level ?? "normal") !== metrics[m].level && ["drop", "watch", "rise", "normal"].includes(metrics[m].level));
fs.mkdirSync("data/engine", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), end, method: "weekday-adjusted 4-week baseline, robust dispersion, windows 3+7 d", metrics }, null, 1));

const line = (m) => { const r = metrics[m], w = r.windows.find((x) => x.level === r.level) ?? r.windows[r.windows.length - 1];
  return `${m}: ${r.level.toUpperCase()}${w ? ` — ${w.w} d ${w.observed} vs ${w.expected} normal (×${w.ratio}, z ${w.z})` : ""}`; };
for (const m of changed) fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), key: `drops|${m}|${end}`, machine: "drops", kind: metrics[m].level === "rise" || metrics[m].level === "normal" ? "lesson" : "loss", what: line(m) }) + "\n");
console.log(`drops ${end}: ` + METRICS.map((m) => `${m}=${metrics[m].level}`).join(" "));

const bad = changed.filter((m) => metrics[m].level === "drop" || metrics[m].level === "watch");
if (bad.length && process.env.RESEND_API_KEY) {
  const { mail } = await import("../../reels/engine/alert.mjs");
  await mail(`CRTLAB watch: ${bad.map((m) => `${m} ${metrics[m].level}`).join(", ")}`,
    ["Compared with the same weekdays over the last 4 weeks (complete days to " + end + "):", "", ...bad.map(line), "",
      "Levels only change when the number does — no repeat emails. Detail: data/engine/drops.json"].join("\n"));
}
