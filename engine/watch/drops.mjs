// engine/watch/drops.mjs — WATCH loop, step 1 (v2). Daily, after the day closes. One read-only query set, no hands.
//   in : prod analytics (ANALYTICS_DB_URL) — new accounts + real visitors per UTC day, by source · paywall funnel (wall_events,
//        unique non-staff people) · Stripe (STRIPE_READ_KEY, read-only) — NEW buyers = a customer's first successful charge
//   out: data/engine/drops.json + data/engine/series.json (owner: daily/drops) · ledger row + email ONLY when a metric's level CHANGES
// Method + thresholds: drops-lib.mjs (weekday-adjusted, measured dispersion, backtested Aug–Nov 2026).
import fs from "node:fs";
import { evaluate, gapTest, explain } from "./drops-lib.mjs";
import { googleUpdates, overlapping } from "../lib/external.mjs";
import { addDays, iso } from "../lib/stats.mjs";

const OUT = "data/engine/drops.json", LEDGER = "data/machines/ledger.jsonl", FROM_DAYS = 120;
const url = process.env.ANALYTICS_DB_URL;
if (!url) { console.log("drops: no ANALYTICS_DB_URL — skipped"); process.exit(0); }

// sources: one mapping for accounts and visitors, so the two are comparable
const SRC = `case when s ~ 'google' then 'google' when s ~ 'chatgpt|openai' then 'chatgpt' when s ~ 'bing' then 'bing'
  when s ~ 'instagram|facebook|^ig$|^fb$|tiktok|youtube|reddit|x\\.com|t\\.co' then 'social' when s in ('direct','none','') then 'direct' else 'other' end`;
export const METRICS = ["accounts", "accounts.google", "accounts.chatgpt", "accounts.bing", "accounts.direct", "accounts.social",
  "visitors", "visitors.google", "visitors.chatgpt", "visitors.bing", "paywall.seen", "paywall.packs", "buyers.new", "reads.chatgpt"];
// 11-14: the engine judged itself on accounts only — it could not see money. Pack clicks halved the week $99 lifetime hit
// the wall (21 vs ~33/wk) and nothing noticed; the DB has no purchase date at all → buyers come from Stripe (the truth).

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
const wall = (await db.query(`select to_char(created_at,'YYYY-MM-DD') d, type, count(distinct subject)::int n from wall_events
  where created_at >= $1 and created_at < $2::date + 1 and not coalesce(staff,false) and type in ('wall_view','pack_click') group by 1,2`, [since, end])).rows;
// WHY: accounts by source × landing page (the converting guest's first page), last 14 complete days vs the 28 before
const lp = (await db.query(`select ${SRC} src, page, count(*) filter (where created_at::date > $1::date - 14)::int recent,
  count(*) filter (where created_at::date <= $1::date - 14)::int prior from (select u.created_at,
  lower(coalesce(nullif(u.signup_utm_source,''), nullif(u.signup_source,''), 'none')) s, coalesce(regexp_replace(g.landing_path, '[?#].*', ''), '(unknown)') page
  from users u left join guest_presence g on g.converted_user_id = u.id where u.created_at::date > $1::date - 42 and u.created_at::date <= $1::date) x group by 1,2`, [end])).rows;
await db.end();

// NEW buyers from Stripe: first successful, unrefunded, live charge per customer (full history, so renewals never count as new).
async function stripeBuyers() {
  const key = process.env.STRIPE_READ_KEY; if (!key) return { err: "no STRIPE_READ_KEY" };
  const first = new Map(); let after = null, pages = 0;
  do {
    const r = await fetch(`https://api.stripe.com/v1/charges?limit=100${after ? "&starting_after=" + after : ""}`,
      { headers: { Authorization: "Bearer " + key }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r?.ok) return { err: `Stripe charges ${r ? r.status : "unreachable"}` };
    const j = await r.json();
    for (const ch of j.data) {
      if (ch.status !== "succeeded" || !ch.paid || ch.refunded || !ch.livemode) continue;
      const who = ch.customer || ch.billing_details?.email || ch.id, d = iso(ch.created * 1000); // who stays in memory only
      if (!first.has(who) || d < first.get(who)) first.set(who, d);
    }
    after = j.has_more ? j.data.at(-1)?.id : null;
  } while (after && ++pages < 50);
  if (after) return { err: "Stripe: more than 5,000 charges — raise the page cap" };
  const map = {}; for (const d of first.values()) map[d] = (map[d] ?? 0) + 1;
  return { map };
}
const buyers = await stripeBuyers();
if (buyers.err) console.log("drops: buyers unknown — " + buyers.err);

const series = Object.fromEntries(METRICS.map((m) => [m, {}]));
const put = (k, d, n) => { if (series[k]) series[k][d] = (series[k][d] ?? 0) + n; };
for (const r of acc) { put("accounts", r.d, r.n); put("accounts." + r.src, r.d, r.n); }
for (const r of vis) { put("visitors", r.d, r.n); put("visitors." + r.src, r.d, r.n); }
for (const r of wall) put(r.type === "wall_view" ? "paywall.seen" : "paywall.packs", r.d, r.n);
// TOP of the AI funnel: ChatGPT-User fetches (a live chat reading our page) from the aicrawl log in this repo. 11-14: reads of
// / and /backtest ROSE (208 → 681, 126 → 235 a week) while ChatGPT accounts from them fell — the loss is between citing and
// signing up, which only reads + visits + accounts side by side can show. Log starts 11-01 → "unknown" until ~3 weeks exist.
for (const f of fs.readdirSync("data/aicrawl").filter((x) => x.endsWith(".jsonl")))
  for (const l of fs.readFileSync(`data/aicrawl/${f}`, "utf8").split("\n")) { let j; try { j = JSON.parse(l); } catch { continue; }
    const d = String(j.to).slice(0, 10), n = j.bots?.["ChatGPT-User"]?.hits ?? 0; if (n && d >= since && d <= end) put("reads.chatgpt", d, n); }
const readsFrom = Object.keys(series["reads.chatgpt"]).sort()[0];

const metrics = {};
for (const m of METRICS) if (m !== "buyers.new") metrics[m] = evaluate(series[m], m === "reads.chatgpt" ? (readsFrom ?? end) : since, end); // reads: no zeros before the log began
metrics["buyers.new"] = buyers.err ? { level: "unknown", why: buyers.err, windows: [] } : gapTest(buyers.map, end);

let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
const changed = METRICS.filter((m) => (prev?.metrics?.[m]?.level ?? "normal") !== metrics[m].level && ["drop", "watch", "rise", "normal"].includes(metrics[m].level));
fs.mkdirSync("data/engine", { recursive: true });
// ONE reader of user analytics, many consumers: the daily outcome series (no buyers — public repo) for LEARN and any machine
// that needs "what did users do", so every machine uses the same definitions (real visitor, source mapping) instead of its own SQL.
fs.writeFileSync("data/engine/series.json", JSON.stringify({ at: new Date().toISOString(), from: since, end, starts: readsFrom ? { "reads.chatgpt": readsFrom } : {}, series })); // starts: a series whose source began later — days before it are UNKNOWN, not 0
// WHERE each moving accounts metric moved (shift-share by landing page) — only for watch/drop/rise, the rest is noise
const why = {};
for (const m of METRICS.filter((m) => m.startsWith("accounts") && ["watch", "drop", "rise"].includes(metrics[m].level))) {
  const src = m.split(".")[1], by = new Map();
  for (const r of lp) if (!src || r.src === src) { const o = by.get(r.page) ?? { page: r.page, recent: 0, prior: 0 }; o.recent += r.recent; o.prior += r.prior; by.set(r.page, o); }
  why[m] = explain([...by.values()]);
}
// Google ranking updates live in the last 14 days — named next to any Google metric, so nobody blames our own change first
const G = await googleUpdates({ since: addDays(end, -60) }), activeG = G == null ? null : overlapping(G, addDays(end, -14), end);
const pub = { ...metrics, "buyers.new": { level: metrics["buyers.new"].level, p: metrics["buyers.new"].p ?? null, why: metrics["buyers.new"].why } }; // public repo: no buyer counts
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), end, method: "weekday-adjusted 4-week baseline, robust dispersion, windows 3+7 d; buyers = gap test vs the 56-day rate before the last buyer", google: activeG, why, metrics: pub }, null, 1));

const line = (m) => { const r = metrics[m]; if (m === "buyers.new") return `buyers.new: ${r.level.toUpperCase()} — ${r.gap} days since the last new buyer; normal gap ~${r.typicalGap} d (${r.n} in the 56 d before it), chance of a gap this long ${Math.round((r.p ?? 0) * 100)}%`;
  const w = r.windows.find((x) => x.level === r.level) ?? r.windows[r.windows.length - 1];
  return `${m}: ${r.level.toUpperCase()}${w ? ` — ${w.w} d ${w.observed} vs ${w.expected} normal (×${w.ratio}, z ${w.z})` : ""}`; };
for (const m of changed) fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), key: `drops|${m}|${end}`, machine: "drops", kind: metrics[m].level === "rise" || metrics[m].level === "normal" ? "lesson" : "loss", what: m === "buyers.new" ? `buyers.new: ${metrics[m].level.toUpperCase()} (p ${metrics[m].p})` : line(m) }) + "\n"); // public repo: no buyer counts
console.log(`drops ${end}: ` + METRICS.map((m) => `${m}=${metrics[m].level}`).join(" "));

const bad = changed.filter((m) => metrics[m].level === "drop" || metrics[m].level === "watch");
if (bad.length && process.env.RESEND_API_KEY) {
  const { mail } = await import("../../reels/engine/alert.mjs");
  await mail(`CRTLAB watch: ${bad.map((m) => `${m} ${metrics[m].level}`).join(", ")}`,
    ["Compared with the same weekdays over the last 4 weeks (complete days to " + end + "):", "", ...bad.map(line), "",
      ...bad.filter((m) => why[m]).flatMap((m) => [`WHERE (${m}, last 14 d vs the 28 before, by landing page):`,
        ...why[m].losers.map((p) => `  ↓ ${p.page}  ${p.expected} → ${p.recent}${p.share != null ? `  (${Math.round(p.share * 100)}% of the change)` : ""}`),
        ...why[m].gainers.slice(0, 3).map((p) => `  ↑ ${p.page}  ${p.expected} → ${p.recent}`), ""]),
      ...(bad.some((m) => m.includes("google")) && activeG?.length ? [`OUTSIDE: Google ${activeG.map((e) => `${e.what} (from ${e.begin.slice(0, 10)}${e.end ? " to " + e.end.slice(0, 10) : ", still rolling out"})`).join("; ")} — Google numbers move for everyone; don't credit or blame our own changes for it.`, ""] : []),
      "Levels only change when the number does — no repeat emails. Detail: data/engine/drops.json"].join("\n"));
}
