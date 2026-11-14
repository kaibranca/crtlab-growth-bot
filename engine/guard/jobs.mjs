// engine/guard/jobs.mjs — GUARD loop (v2): hourly outcome + truth checks. Read-only everywhere.
//   in : crtlab.pro/api/data-version · data/reels (plan + log) · data/indexnow.jsonl · data/google/sitemaps.json ·
//        data/guard/steps.json · data/works/plan.json · analytics DB (read-only role)
//   out: data/engine/jobs.json (owner: hourly/jobs) · ledger + ONE email per check when it turns fail (and when it recovers)
import fs from "node:fs";
import * as L from "./jobs-lib.mjs";

const OUT = "data/engine/jobs.json", LEDGER = "data/machines/ledger.jsonl", NOW = Date.now();
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const lines = (p) => { try { return fs.readFileSync(p, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const today = new Date(NOW).toISOString().slice(0, 10);

const dv = await fetch("https://crtlab.pro/api/data-version", { headers: { "User-Agent": "crtlab-bot jobs" }, signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const sitemaps = J("data/google/sitemaps.json"), works = J("data/works/plan.json");

const checks = [
  L.checkData(dv, NOW),
  L.checkReels(J(`data/reels/plan-${today}.json`), lines("data/reels/log.jsonl"), NOW),
  L.checkIndexNow(lines("data/indexnow.jsonl"), NOW),
  L.checkSitemap(sitemaps, NOW),
  L.checkCore(J("data/guard/steps.json"), NOW),
  L.checkBuyers(J("data/engine/drops.json"), NOW),
  L.checkAiPrice(J("data/radar/plan.json"), NOW),
  L.checkSecrets(J("data/guard/steps.json"), (await import("../../scripts/run-lib.mjs")).OPTIONAL_ENV),
];

if (process.env.ANALYTICS_DB_URL) {
  const pg = (await import("pg")).default, db = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    await db.connect();
    const live = (await db.query("select max(created_at) t from guest_presence")).rows[0]?.t;
    // same window as works base.last7: the 7 complete UTC days before today
    const u7 = (await db.query("select count(*)::int n from users where created_at >= (now() at time zone 'utc')::date - 7 and created_at < (now() at time zone 'utc')::date")).rows[0]?.n;
    const a = (await db.query(`select count(*) filter (where lower(coalesce(nullif(g.source,''),'none')) in ('direct','none'))::int d, count(*)::int n
      from guest_presence g where g.created_at > now() - interval '7 days'
      and (g.converted_at is not null or exists (select 1 from guest_meters m where m.device_key = g.device_key and m.candles_used > 0))`)).rows[0];
    checks.push(L.checkDbLive(live && new Date(live).toISOString(), NOW), L.checkNorthStar(works?.base?.last7 ?? null, u7), L.checkAttribution(a.d, a.n));
  } catch (e) { checks.push({ id: "truth-db", job: "analytics DB readable", state: "unknown", detail: String(e).slice(0, 120) }); }
  finally { await db.end().catch(() => {}); }
}

const prev = J(OUT), was = Object.fromEntries((prev?.checks ?? []).map((c) => [c.id, c.state]));
const turned = checks.filter((c) => (was[c.id] ?? "ok") !== c.state && c.state !== "unknown");
fs.mkdirSync("data/engine", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ at: new Date(NOW).toISOString(), summary: L.summarise(checks), checks }, null, 1));
for (const c of turned) fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date(NOW).toISOString(), key: `jobs|${c.id}|${c.state}`, machine: "jobs", kind: c.state === "fail" ? "loss" : "lesson", what: `${c.job}: ${c.state.toUpperCase()} — ${c.detail}` }) + "\n");
const s = L.summarise(checks);
console.log(`jobs: ${s.ok}/${s.of} ok, ${s.fail} fail, ${s.unknown} unknown`); for (const c of checks) console.log(`  ${c.state.padEnd(7)} ${c.job} — ${c.detail}`);
if (turned.length && process.env.RESEND_API_KEY) {
  const { mail } = await import("../../reels/engine/alert.mjs");
  const urgent = turned.some((c) => c.state === "fail" && ["data-live", "truth-db-live"].includes(c.id)); // users see stale charts / engine blind
  await mail(`CRTLAB jobs: ${turned.map((c) => `${c.job} ${c.state}`).join(", ")}`, turned.map((c) => `${c.state.toUpperCase()} — ${c.job}: ${c.detail}`).join("\n") + "\n\nOne email per change. Detail: data/engine/jobs.json", { level: urgent ? "urgent" : "info" });
}
