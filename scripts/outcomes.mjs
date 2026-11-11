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
        count(*) filter (where last_active - created_at > interval '30 seconds' or converted_at is not null)::int real,
        count(*) filter (where (last_active - created_at > interval '30 seconds' or converted_at is not null) and (referrer ilike '%chatgpt%' or utm_source ilike '%chatgpt%' or referrer ilike '%perplexity%' or referrer ilike '%copilot%' or referrer ilike '%gemini%'))::int ai,
        count(*) filter (where converted_at is not null)::int acc
      from guest_presence where created_at > now() - interval '14 days' and country is distinct from 'SG' group by 1`);
    const su = await db.query(`select (created_at > now() - interval '7 days') wk, count(*)::int n from users where created_at > now() - interval '14 days' group by 1`);
    const a = rows.find((r) => r.wk) ?? {}, b = rows.find((r) => !r.wk) ?? {}, sa = su.rows.find((r) => r.wk)?.n ?? 0, sb = su.rows.find((r) => !r.wk)?.n ?? 0;
    out["lead-traffic"] = k("real visitors / week", a.real ?? 0, b.real ?? 0);
    out["humans"] = out["lead-traffic"];
    out["ai"] = k("AI-referred real visitors / week", a.ai ?? 0, b.ai ?? 0);
    out["lead-conversion"] = k("sign-ups / week", sa, sb);
    out["leak"] = k("guests → account %", a.real ? (100 * (a.acc ?? 0)) / a.real : null, b.real ? (100 * (b.acc ?? 0)) / b.real : null);
  } catch (e) { console.log("outcomes: db", String(e).slice(0, 80)); } finally { await db.end().catch(() => {}); }
}

// ── content: what AI reads and clicks (the AI machine's own daily score) ──
const ais = readLines("data/ai/score.jsonl");
out["lead-content"] = k("AI page reads / week", win(ais, "reads", 7, 0), win(ais, "reads", 14, 7));
out["bing"] = k("AI clicks / week", win(ais, "clicks", 7, 0), win(ais, "clicks", 14, 7));
out["surge"] = out["rising"] = out["sisters"] = out["curator"] = out["yield"] = out["trend"] = out["lift"] = out["weekly"] = out["bing"];
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
  const behind = Math.max(0, Math.round((d.getTime() - Date.parse(dv.end + "T00:00:00Z")) / DAY)); out["datapull"] = k("trading days behind", behind, null, { lowerBetter: true }); }
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
