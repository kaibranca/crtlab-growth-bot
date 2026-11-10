// HEALTH — the "is CRTLAB OK" check, every few hours. Read-only everywhere: a SELECT-only database role, a list of the
// backup bucket, public pages. It never writes to the site or the database; its only output is data/health.json and,
// when something is wrong, ONE email to Kai per problem per 20 hours.
//
// PUBLIC REPO: health.json carries sizes and ok/alert flags only — no signup or guest numbers, no emails. Those go in the
// alert email and nowhere else.
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { SITE, get, append, month } from "./lib.mjs";

const out = { at: new Date().toISOString(), checks: [] };
const alerts = []; // [key, text] — key dedupes the email, text is what Kai reads
const check = (name, ok, note) => out.checks.push({ name, ok, note });

// ── 1. DATABASE: size vs the 500 MB volume (pg_database_size is ~60% of the volume; WAL + overhead is the rest) ────────
const DB_WARN_MB = 1300; // ≈ 75% of the 2 GB volume (11-09: db 254 MB ↔ volume 385 MB, ~130 MB WAL/system overhead). Email well before it fills
let db;
try {
  db = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const q = async (s) => (await db.query(s)).rows;
  const mb = Math.round((await q(`select pg_database_size(current_database()) b`))[0].b / 1e6);
  const tables = (await q(`select relname t, pg_total_relation_size(relid) b from pg_catalog.pg_statio_user_tables order by 2 desc limit 5`))
    .map((r) => [r.t, Math.round(r.b / 1e6)]);
  out.db = { mb, tables };
  check("database size", mb < DB_WARN_MB, `${mb} MB`);
  if (mb >= DB_WARN_MB) alerts.push(["db-size", `Database is ${mb} MB (warn at ${DB_WARN_MB}). Biggest: ${tables.map(([t, b]) => `${t} ${b} MB`).join(", ")}. The volume is 500 MB — if it fills, Postgres stops and the site goes down.`]);

  // ── 2. MONEY + PEOPLE: catches "the site is up but nobody can sign up / pay" — the failure the watchdog cannot see ────
  const h = new Date().getUTCHours();
  const s6 = +(await q(`select count(*) n from users where created_at > now() - interval '6 hours'`))[0].n;
  const g = (await q(`select
      count(*) filter (where created_at >= date_trunc('day', now())) today,
      count(*) filter (where created_at >= date_trunc('day', now()) - interval '7 days' and created_at < now() - interval '7 days') lastweek
    from guest_presence where created_at >= date_trunc('day', now()) - interval '7 days'`))[0];
  const today = +g.today, lastweek = +g.lastweek;
  const pay = +(await q(`select count(*) n from subscriptions where status in ('past_due','unpaid') and updated_at > now() - interval '24 hours'`))[0].n;
  const quiet = h >= 10 && h <= 22 && s6 === 0; // daytime for most of the audience (UTC)
  const drop = h >= 10 && lastweek >= 30 && today < lastweek * 0.5;
  check("signups flowing", !quiet, quiet ? "none in 6h" : "ok");
  check("visitors vs last week", !drop, drop ? "down >50%" : "ok");
  check("payments", pay === 0, pay ? "failed payment" : "ok");
  if (quiet) alerts.push(["no-signups", `No signups in the last 6 hours (it is ${h}:00 UTC). Check that signup + Google login work on crtlab.pro.`]);
  if (drop) alerts.push(["guest-drop", `Visitors today: ${today} so far vs ${lastweek} by this time last week (−${Math.round(100 - (100 * today) / lastweek)}%).`]);
  if (pay) alerts.push(["payment-failed", `${pay} subscription(s) went past_due/unpaid in the last 24h — see Stripe.`]);
} catch (e) {
  check("database reachable", false, String(e.message || e).slice(0, 120));
  alerts.push(["db-down", `The health check could not query the database: ${String(e.message || e).slice(0, 200)}`]);
} finally { try { await db?.end(); } catch { /* ignore */ } }

// ── 3. BACKUP: the ops service dumps to R2 at 03:00 UTC. Newest must be < 28h old and not much smaller than the one before ─
try {
  const { R2_ACCOUNT_ID: acc, R2_ACCESS_KEY_ID: ak, R2_SECRET_ACCESS_KEY: sk, R2_BUCKET: bucket } = process.env;
  const host = `${acc}.r2.cloudflarestorage.com`, qs = "list-type=2&max-keys=1000&prefix=backups%2F";
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""), date = amz.slice(0, 8);
  const H = (x) => crypto.createHash("sha256").update(x).digest("hex"), M = (k, x) => crypto.createHmac("sha256", k).update(x).digest();
  const ph = H(""), scope = `${date}/auto/s3/aws4_request`;
  const canon = `GET\n/${bucket}\n${qs}\nhost:${host}\nx-amz-content-sha256:${ph}\nx-amz-date:${amz}\n\nhost;x-amz-content-sha256;x-amz-date\n${ph}`;
  let k = M("AWS4" + sk, date); k = M(k, "auto"); k = M(k, "s3"); k = M(k, "aws4_request");
  const sig = crypto.createHmac("sha256", k).update(`AWS4-HMAC-SHA256\n${amz}\n${scope}\n${H(canon)}`).digest("hex");
  const r = await fetch(`https://${host}/${bucket}?${qs}`, { headers: { "x-amz-date": amz, "x-amz-content-sha256": ph,
    Authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${sig}` } });
  const xml = await r.text();
  const objs = xml.split("<Contents>").slice(1).map((c) => ({ at: c.match(/<LastModified>([^<]+)/)[1], mb: +c.match(/<Size>(\d+)/)[1] / 1e6 }))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const last = objs[objs.length - 1], prev = objs[objs.length - 2];
  const ageH = last ? (Date.now() - Date.parse(last.at)) / 3.6e6 : Infinity;
  const ok = r.status === 200 && ageH < 28 && (!prev || last.mb >= prev.mb * 0.7);
  out.backup = last ? { at: last.at, mb: +last.mb.toFixed(1), count: objs.length } : null;
  check("nightly backup", ok, last ? `${Math.round(ageH)}h old · ${last.mb.toFixed(1)} MB` : `none (HTTP ${r.status})`);
  if (!ok) alerts.push(["backup", last ? `Newest database backup is ${Math.round(ageH)}h old and ${last.mb.toFixed(1)} MB (previous ${prev?.mb.toFixed(1)} MB). The ops service's nightly pg_dump → R2 may have stopped.` : `No database backups found in R2 (HTTP ${r.status}).`]);
} catch (e) { check("nightly backup", false, String(e.message || e).slice(0, 120)); alerts.push(["backup", `Backup check failed: ${String(e.message || e).slice(0, 200)}`]); }

// ── 4. MARKET DATA: the newest daily candle the replay can reach. Pulls are manual, so this is a nudge, not a fire ──────
{
  const r = await get(`${SITE}/api/range?pair=xauusd`);
  let days = null; try { days = Math.floor((Date.now() / 1000 - JSON.parse(r.body).last) / 86400); } catch { /* bad body */ }
  out.data = { newestDays: days };
  const ok = days != null && days <= 21;
  check("market data fresh", ok, days == null ? `range HTTP ${r.status}` : `newest candle ${days}d old`);
  if (!ok) alerts.push(["data-stale", days == null ? `/api/range failed (HTTP ${r.status}).` : `Newest candle data is ${days} days old — time for a data pull (see the data-pull checklist).`]);
}

// ── 5. PAGE WEIGHT + SPEED: what a visitor downloads on the pages that matter. Logged so a heavier deploy shows up ───────
const PAGES = [["home", "/"], ["backtest", "/backtest"], ["chart app", "/backtester/session"], ["statistics", "/statistics/xauusd"]];
out.weight = {};
for (const [name, path] of PAGES) {
  const html = await get(SITE + path);
  const js = [...new Set([...html.body.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]))];
  let bytes = html.body.length;
  for (const src of js) { const r = await get(src.startsWith("http") ? src : SITE + src); bytes += r.body.length; }
  out.weight[name] = { kb: Math.round(bytes / 1024), scripts: js.length, ttfbMs: html.ms };
}
append(`data/health/${month()}.jsonl`, { at: out.at, db: out.db?.mb, weight: Object.fromEntries(Object.entries(out.weight).map(([k, v]) => [k, v.kb])) });
// a page that got >15% heavier than its 7-day median is worth a look (not an alert — a line on the board)
{
  { const rl = fs.existsSync("data/radar/runs.jsonl") ? fs.readFileSync("data/radar/runs.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const lr = rl.at(-1), ageH = lr ? (Date.now() - Date.parse(lr.at)) / 3.6e6 : null, ok = !lr || (ageH < 36 && !(lr.planned > 0 && lr.asked === 0));
    if (lr) { check("AI radar", ok, `${Math.round(ageH)}h ago · asked ${lr.asked}/${lr.planned}${lr.error ? " · " + lr.error.slice(0, 60) : ""}`);
      if (!ok) alerts.push(["radar", ageH >= 36 ? `The AI radar has not run for ${Math.round(ageH)}h (daily.yml dispatches radar.yml).` : `The AI radar ran but asked nothing: ${lr.error}`]); } }
  const hist = fs.existsSync(`data/health/${month()}.jsonl`) ? fs.readFileSync(`data/health/${month()}.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l)).slice(-60, -1) : [];
  out.heavier = Object.entries(out.weight).filter(([k, v]) => { const xs = hist.map((h) => h.weight?.[k]).filter(Boolean).sort((a, b) => a - b); return xs.length >= 6 && v.kb > xs[xs.length >> 1] * 1.15; }).map(([k]) => k);
}

// ── ALERTS: one email per problem per 20h; a cleared problem is forgotten so a relapse emails again ───────────────────
out.alerts = alerts.map(([k]) => k);
const STATE = "data/health/alerted.json";
const sent = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const fresh = alerts.filter(([k]) => !sent[k] || Date.now() - Date.parse(sent[k]) > 20 * 3.6e6);
for (const k of Object.keys(sent)) if (!out.alerts.includes(k)) delete sent[k];
if (fresh.length && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO,
      subject: `CRTLAB alert: ${fresh.map(([k]) => k).join(", ")}`,
      text: fresh.map(([, t]) => "• " + t).join("\n\n") + "\n\nAll checks: " + out.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name} (${c.note})`).join(" · ") }) });
  out.emailed = r.status;
  if (r.ok) for (const [k] of fresh) sent[k] = out.at;
}
fs.mkdirSync("data/health", { recursive: true });
fs.writeFileSync(STATE, JSON.stringify(sent));
fs.writeFileSync("data/health.json", JSON.stringify(out, null, 1));
console.table(out.checks);
console.log("weight", out.weight, "alerts", out.alerts, "emailed", out.emailed ?? "-");
