// OUTCOMES (11-11, Kai: "the ecosystem at its peak"). An audit that day found 50 of 59 machines with NO outcome number — the
// engine knew each one RAN, not whether it WORKED; the section leads' KPI was "machines alive". This gives every lead and
// every machine that moves something ONE outcome: this week vs last week, from data the bot already holds plus one
// read-only grouped scan (real visitors / sign-ups). Writes data/machines/outcomes.json {id: {label, now, before, change,
// lowerBetter}} — core.mjs puts them on the map and flags "running but not moving" (a KPI flat or worse two weeks running),
// which the fixer turns into a task. HOURLY, before the supervisor.
import fs from "node:fs";
import { readLines } from "./lib.mjs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/machines/outcomes.json", HIST = "data/machines/outcomes.jsonl";
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const k = (label, now, before, extra = {}) => ({ label, now: now == null ? null : +(+now).toFixed(2), before: before == null ? null : +(+before).toFixed(2),
  change: now != null && before ? +((now - before) / before).toFixed(2) : null, ...extra });
// sum a numeric field of jsonl rows with an `at` or `day` stamp over [from, to) days ago
const win = (rows, f, a, b) => rows.filter((r) => { const t = Date.parse(r.at ?? r.day); return NOW - t >= b * DAY && NOW - t < a * DAY; }).reduce((s, r) => s + (+(typeof f === "function" ? f(r) : r[f]) || 0), 0);
const out = {};

// ── real people (one grouped scan; same "real" rule as the people machine) ──
if (process.env.ANALYTICS_DB_URL) {
  const pg = (await import("pg")).default, db = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await db.connect();
    const { rows } = await db.query(`select (created_at > now() - interval '7 days') wk,
        count(*) filter (where converted_at is not null or exists (select 1 from guest_meters m where m.device_key = guest_presence.device_key and m.candles_used > 0))::int real,
        count(*) filter (where (converted_at is not null or exists (select 1 from guest_meters m where m.device_key = guest_presence.device_key and m.candles_used > 0)) and (referrer ilike '%chatgpt%' or utm_source ilike '%chatgpt%' or referrer ilike '%perplexity%' or referrer ilike '%copilot%' or referrer ilike '%gemini%'))::int ai,
        count(*) filter (where converted_at is not null)::int acc
      from guest_presence where created_at > now() - interval '14 days' and country is distinct from 'SG' group by 1`);
    const su = await db.query(`select (created_at > now() - interval '7 days') wk, count(*)::int n from users where created_at > now() - interval '14 days' group by 1`);
    const a = rows.find((r) => r.wk) ?? {}, b = rows.find((r) => !r.wk) ?? {}, sa = su.rows.find((r) => r.wk)?.n ?? 0, sb = su.rows.find((r) => !r.wk)?.n ?? 0;
    out["lead-traffic"] = k("real visitors / week", a.real ?? 0, b.real ?? 0);
    out["humans"] = out["lead-traffic"];
    out["ai"] = k("AI-referred real visitors / week", a.ai ?? 0, b.ai ?? 0);
    out["lead-conversion"] = k("sign-ups / week", sa, sb);
    out["leak"] = k("guests → account %", a.real ? (100 * (a.acc ?? 0)) / a.real : null, b.real ? (100 * (b.acc ?? 0)) / b.real : null);
    // THE PRODUCT ITSELF (11-12, Kai: "the ecosystem needs access to as much data as possible") — user_events (406k rows, read
    // by no machine before) logs replay seconds per user/market/TF. North star: replay hours a week + people who really
    // replayed (≥ 10 min). SOURCE QUALITY: of each source's sign-ups 7–21 days old, the share that replayed ≥ 10 min in
    // their first 7 days → data/machines/quality.json (11-12 first read: ChatGPT 11 % vs Google 25 % — reach ≠ value).
    const rp = await db.query(`select (created_at > now() - interval '7 days') wk, coalesce(sum(seconds), 0)::float secs, count(distinct user_id)::int users from user_events where type in ('replay', 'backtest') and created_at > now() - interval '14 days' group by 1`);
    const ra = rp.rows.find((r) => r.wk) ?? {}, rb = rp.rows.find((r) => !r.wk) ?? {};
    out["lead-product"] = k("replay hours / week", (ra.secs ?? 0) / 3600, (rb.secs ?? 0) / 3600);
    out["replayers"] = k("people who replayed / week", ra.users ?? 0, rb.users ?? 0);
    const q = await db.query(`with s as (select u.id, coalesce(nullif(lower(u.signup_source), ''), 'direct') src, u.created_at from users u where u.created_at between now() - interval '21 days' and now() - interval '7 days' and u.is_admin is not true),
        e as (select s.id, s.src, coalesce(sum(ev.seconds), 0)::float secs from s left join user_events ev on ev.user_id = s.id and ev.type in ('replay', 'backtest') and ev.created_at < s.created_at + interval '7 days' group by 1, 2)
        select src, count(*)::int n, count(*) filter (where secs >= 600)::int engaged, avg(secs)::float avgsecs from e group by 1 order by 2 desc limit 12`);
    const all = q.rows.reduce((t, r) => ({ n: t.n + r.n, e: t.e + r.engaged }), { n: 0, e: 0 }), base = all.n ? all.e / all.n : 0;
    // shrunk to the site rate with 20 sign-ups so a 2-person source can't read as 0 % or 100 %
    const quality = Object.fromEntries(q.rows.map((r) => [r.src, { signups: r.n, engaged: r.engaged, rate: +((r.engaged + base * 20) / (r.n + 20)).toFixed(3), rawRate: r.n ? +(r.engaged / r.n).toFixed(3) : null, avgMin: +(r.avgsecs / 60).toFixed(1), value: base ? +(((r.engaged + base * 20) / (r.n + 20)) / base).toFixed(2) : 1 }]));
    fs.writeFileSync("data/machines/quality.json", JSON.stringify({ at: new Date().toISOString(), window: "sign-ups 7–21 days old · engaged = ≥ 10 min replay in their first 7 days", siteRate: +base.toFixed(3), sources: quality }, null, 1));
    // LANDING QUALITY (11-12): of the real visitors each landing page brought (guests 7–35 days old, so each had a week),
    // how many made an account and how many really replayed (≥ 10 min in their first 7 days). The AI machine weights a
    // family's Bing value by it — pages whose visitors become real users get pushed, not just pages that get read.
    try { const lq = await db.query(`with g as (select coalesce(nullif(split_part(landing_path, '?', 1), ''), '/') lp, converted_user_id u, created_at from guest_presence
          where created_at between now() - interval '35 days' and now() - interval '7 days' and country is distinct from 'SG' and (converted_at is not null or exists (select 1 from guest_meters m where m.device_key = guest_presence.device_key and m.candles_used > 0))),
        e as (select g.lp, g.u, coalesce((select sum(seconds) from user_events ev where ev.user_id = g.u and ev.type in ('replay', 'backtest') and ev.created_at < g.created_at + interval '7 days'), 0) secs from g)
        select lp, count(*)::int guests, count(u)::int accounts, count(*) filter (where secs >= 600)::int engaged from e group by 1 order by 2 desc limit 400`);
      const T = lq.rows.reduce((t, r) => ({ g: t.g + r.guests, e: t.e + r.engaged, a: t.a + r.accounts }), { g: 0, e: 0, a: 0 });
      fs.writeFileSync("data/machines/landing.json", JSON.stringify({ at: new Date().toISOString(), window: "real guests 7–35 days old · engaged = ≥ 10 min replay in their first 7 days", site: { guests: T.g, accounts: T.a, engaged: T.e, rate: T.g ? +(T.e / T.g).toFixed(4) : null },
        pages: Object.fromEntries(lq.rows.map((r) => [r.lp.replace(/\/$/, "") || "/", { guests: r.guests, accounts: r.accounts, engaged: r.engaged }])) }));
    } catch (e) { console.log("outcomes: landing quality skipped (" + String(e.message).slice(0, 60) + ")"); }
    out["quality-ai"] = k("ChatGPT sign-ups who really replay %", quality.chatgpt ? quality.chatgpt.rawRate * 100 : null, null);
  } catch (e) { console.log("outcomes: db", String(e).slice(0, 80)); } finally { await db.end().catch(() => {}); }
}

// ── 11-13 NORTH STAR: the WORKS engine's deduped new accounts / week (this week vs the normal of the 3 weeks before) ──
{ const WK = J("data/works/plan.json", null); if (WK?.northStar) out["works"] = k("new accounts / week (north star)", WK.northStar.now, WK.northStar.normal); }
// ── content: what AI reads and clicks (the AI machine's own daily score) ──
const ais = readLines("data/ai/score.jsonl");
out["lead-content"] = k("AI page reads / week", win(ais, "reads", 7, 0), win(ais, "reads", 14, 7));
out["bing"] = k("AI clicks / week", win(ais, "clicks", 7, 0), win(ais, "clicks", 14, 7));
// 11-13 values rule 1: the push machines are judged on the NORTH STAR (new accounts / week), not on AI clicks — a push that
// raises reads or clicks but not accounts has not won. AI clicks stay visible as the bing machine's leading signal.
out["surge"] = out["rising"] = out["sisters"] = out["curator"] = out["yield"] = out["trend"] = out["lift"] = out["weekly"] = out["works"] ?? out["bing"];
out["hooks"] = k("AI accounts / week", win(ais, "accounts", 7, 0), win(ais, "accounts", 14, 7));
const inx = readLines("data/indexnow.jsonl");
out["indexnow"] = k("pages submitted / week", win(inx, "submitted", 7, 0), win(inx, "submitted", 14, 7));

// ── health, money, data ──
const sum = J("data/summary.json", {});
out["lead-health"] = k("uptime 7 d %", sum.watchdog?.up7d ?? null, null);
out["watchdog"] = out["lead-health"];
const cp = J("data/cost/plan.json", {});
out["cost"] = k("Railway $ / month pace (7 d)", cp.weekPace ?? (cp.avgDayCost != null ? cp.avgDayCost * 30 : null), null, { lowerBetter: true, target: cp.budget ?? 10 });
const dv = await fetch("https://crtlab.pro/api/data-version").then((r) => r.json()).catch(() => null);
if (dv?.end) { const d = new Date(NOW); d.setUTCHours(0, 0, 0, 0); if (NOW - d.getTime() < 7.5 * 3.6e6) d.setUTCDate(d.getUTCDate() - 1); do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay()));
  const dueT = dv.due ? Date.parse(dv.due + "T00:00:00Z") : d.getTime(); // 11-12: holiday-aware due day from the site
  const behind = Math.max(0, Math.round((dueT - Date.parse(dv.end + "T00:00:00Z")) / DAY)); out["datapull"] = k("trading days behind", behind, null, { lowerBetter: true }); }
const sh = J("data/shield.json", {});
out["lead-security"] = k("attacks blocked / week", win(sh.history ?? [], "blocked", 7, 0), win(sh.history ?? [], "blocked", 14, 7), { neutral: true });
out["shield"] = out["lead-security"];
const fx = J("data/machines/fixer.json", {});
out["fixer"] = k("fixes started / 24 h", (fx.actions ?? []).filter((a) => NOW - Date.parse(a.at) < DAY && /→/.test(a.what)).length, null, { neutral: true });

fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), kpi: out }, null, 1));
// one line a day, so "flat two weeks running" can be judged from history
const last = readLines(HIST).slice(-1)[0];
if (!last || last.day !== new Date().toISOString().slice(0, 10)) fs.appendFileSync(HIST, JSON.stringify({ day: new Date().toISOString().slice(0, 10), kpi: Object.fromEntries(Object.entries(out).map(([id, v]) => [id, v.now])) }) + "\n");
console.log(`outcomes: ${Object.keys(out).length} machines with an outcome · ` + ["lead-traffic", "lead-conversion", "lead-content", "cost"].map((id) => out[id] && `${out[id].label} ${out[id].now}${out[id].before != null ? ` (was ${out[id].before})` : ""}`).filter(Boolean).join(" · "));
