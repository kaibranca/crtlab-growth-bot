// SECURITY WATCH — read-only, every 3 hours. Looks for the signs of a break-in and emails Kai the moment one appears.
// It changes nothing on the site. PUBLIC REPO: only salted hashes and public script hosts are stored here; details go in the email.
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { SITE } from "./lib.mjs";

const STATE = "data/security-known.json";
const known = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const firstRun = !known.seeded;
const alerts = [];
const salt = process.env.OPS_KEY || "";
const hash = (x) => crypto.createHash("sha256").update(salt + x).digest("hex").slice(0, 16);
/** Anything not seen before is a finding, except on the first run, which only learns today's normal. */
const novel = (bucket, value, text) => {
  known[bucket] ??= [];
  if (known[bucket].includes(value)) return;
  known[bucket].push(value);
  if (!firstRun) alerts.push(text);
};
const browser = (ua = "") => `${/iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "other"} ${/Edg\//.test(ua) ? "Edge" : /Firefox/.test(ua) ? "Firefox" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "other"}`;

// ── DATABASE ──
const db = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s) => (await db.query(s)).rows;
for (const r of await q(`select rolname from pg_roles where rolname not like 'pg\\_%' and rolcanlogin`))
  novel("roles", hash(r.rolname), `A new database login appeared: "${r.rolname}". Nobody should be adding these.`);
for (const r of await q(`select id, email from users where is_admin`))
  novel("admins", hash(r.id), `A new ADMIN account appeared: ${r.email}. If that isn't you, treat it as a break-in.`);
for (const r of await q(`select u.email, s.user_agent ua, s.ip, s.created_at from sessions s join users u on u.id = s.user_id where u.is_admin and s.created_at > now() - interval '7 days'`))
  novel("adminDevices", hash(r.email + browser(r.ua)), `New device on admin account ${r.email}: ${browser(r.ua)}, IP ${r.ip ?? "unknown"}, at ${new Date(r.created_at).toISOString()}. If that wasn't you, change the password and log out everywhere now.`);

const [free] = await q(`select count(*)::int n from users u where tier <> 'free' and not is_admin and not exists (select 1 from subscriptions s where s.user_id = u.id and s.status in ('active','trialing','past_due'))`);
if (known.freePro != null && free.n > known.freePro) alerts.push(`Accounts on Pro with no paying subscription went from ${known.freePro} to ${free.n}. If you didn't comp anyone, someone may have edited the database.`);
known.freePro = free.n;

const [spike] = await q(`select
  (select count(*)::int from sessions where created_at > now() - interval '1 hour') logins,
  (select count(*)::int from users where created_at > now() - interval '1 hour') signups,
  (select count(*)::int from wall_events where type = 'account_deleted' and created_at > now() - interval '24 hours') deleted,
  (select count(*)::int from sessions where revoked_at > now() - interval '1 hour') revoked`);
if (spike.logins > 150) alerts.push(`${spike.logins} logins in the last hour, far above normal. Could be password guessing that worked, or a bot.`);
if (spike.signups > 100) alerts.push(`${spike.signups} signups in the last hour, far above normal. Probably a bot.`);
if (spike.deleted > 15) alerts.push(`${spike.deleted} accounts deleted in 24 hours, far above normal.`);
if (spike.revoked > 100) alerts.push(`${spike.revoked} logins were ended in the last hour, far above normal.`);
await db.end();

// ── THE LIVE SITE: a skimmer usually arrives as one new script on the page ──
for (const path of ["/", "/pricing", "/backtest"]) {
  const r = await fetch(SITE + path, { headers: { "user-agent": "Mozilla/5.0 crtlab-security-watch" } });
  const html = await r.text();
  for (const m of html.matchAll(/<script[^>]+src=["'](?:https?:)?\/\/([^/"']+)/g))
    novel("scriptHosts", m[1], `A new outside script is loading on ${path}: ${m[1]}. If you didn't add it, this is how card-stealing attacks start.`);
  if (path === "/pricing") for (const h of ["strict-transport-security", "x-frame-options", "x-content-type-options"])
    if (!r.headers.get(h)) alerts.push(`Security header ${h} is missing from the live site.`);
}
const mustBlock = { "/.env": [404], "/.git/config": [404], "/api/admin/stats": [401, 403, 404], "/api/admin/overview": [401, 403, 404], "/api/cron/prune": [401, 403] };
for (const [path, ok] of Object.entries(mustBlock)) {
  const r = await fetch(SITE + path, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 crtlab-security-watch" } });
  if (!ok.includes(r.status)) alerts.push(`${path} should be blocked but answered HTTP ${r.status}.`);
}

// ── STRIPE (only with a read-only restricted key): where the money and the events go ──
if (process.env.STRIPE_READ_KEY) {
  const g = async (p) => (await fetch("https://api.stripe.com/v1/" + p, { headers: { Authorization: "Bearer " + process.env.STRIPE_READ_KEY } })).json();
  const hooks = await g("webhook_endpoints?limit=20");
  for (const w of hooks.data || []) novel("stripeHooks", hash(w.url), `A new Stripe webhook appeared: ${w.url}.`);
  const payouts = await g("payouts?limit=5");
  for (const p of payouts.data || []) if (p.destination) novel("payoutBanks", hash(p.destination), `Stripe payouts are going to a NEW bank account (${p.destination}). If you didn't change it, call Stripe now.`);
}

// ── THE RESTORE TEST must keep passing ──
try {
  const rs = JSON.parse(fs.readFileSync("data/restore.json", "utf8"));
  if ((Date.now() - Date.parse(rs.at)) / 864e5 > 10) alerts.push(`The backup restore test hasn't run for over 10 days.`);
} catch { /* not run yet */ }

// ── EMAIL: one per problem per 20 hours ──
known.alerted ??= {};
const fresh = alerts.filter((t) => { const k = hash(t.replace(/\d+/g, "#")); if (known.alerted[k] && Date.now() - Date.parse(known.alerted[k]) < 20 * 3.6e6) return false; known.alerted[k] = new Date().toISOString(); return true; });
if (fresh.length && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: "CRTLAB SECURITY ALERT",
      text: fresh.map((t) => "• " + t).join("\n\n") + "\n\nRecovery steps: ~/crtlab-growth/INCIDENT.md" }) });
  console.log("emailed", r.status);
}
known.seeded = true;
known.at = new Date().toISOString();
fs.writeFileSync(STATE, JSON.stringify(known, null, 1));
console.log(firstRun ? "first run: learned today's normal" : `checked: ${alerts.length} finding(s)`);
