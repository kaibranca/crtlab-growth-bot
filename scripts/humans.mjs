// PEOPLE MACHINE (11-11, Kai: "traffic is low — why aren't the machines in recovery, looking at WHY it declined?").
// The mode engine only watched AI crawler reads, which surged while real visitors fell. This machine measures PEOPLE:
// new human visitors and sign-ups in the last 24 h against the same 24 h window over the previous 14 days, and when they
// fall it finds the SEGMENT that explains the drop (source, landing page type, country, device) — the largest shortfall
// against its own baseline. Writes data/machines/humans.json; core.mjs reads it (people dip → Recovery mode).
// Read-only, one grouped scan over 15 days (range predicates, one GROUP BY — the 11-09 pool lesson). No cost to the app.
import fs from "node:fs";

const OUT = "data/machines/humans.json";
const H = 3600e3, NOW = Date.now();
if (!process.env.ANALYTICS_DB_URL) { console.log("humans: no ANALYTICS_DB_URL — skipped"); process.exit(0); }
const pg = (await import("pg")).default;
const db = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  // day index 0 = the last 24 h, 1..14 = the 24 h windows before it (same hours of day, so time-of-day never fakes a dip)
  const seg = `case when referrer ilike '%chatgpt%' or utm_source ilike '%chatgpt%' or referrer ilike '%perplexity%' or referrer ilike '%copilot%' or referrer ilike '%gemini%' then 'AI answers'
    when referrer ilike '%bing%' then 'Bing' when referrer ilike '%google%' then 'Google' when referrer ilike '%instagram%' or referrer ilike '%facebook%' then 'Social'
    when coalesce(referrer, '') = '' then 'Direct' else 'Other sites' end`;
  const land = `case when landing_path like '/news%' then '/news' when landing_path like '/economic-calendar%' then '/economic-calendar'
    when landing_path like '/answers%' then '/answers' when landing_path like '/tools%' then '/tools' when landing_path like '/backtest%' then '/backtest pages'
    when landing_path like '/statistics%' then '/statistics' when landing_path = '/' then 'home' when landing_path like '/auth%' then 'sign-in'
    when landing_path ~ '^/[a-z0-9]+$' then 'chart' else 'other pages' end`;
  const { rows } = await db.query(`select floor(extract(epoch from (now() - created_at)) / 86400)::int d, ${seg} src, ${land} lp,
      coalesce(country, '?') cc, coalesce(device, '?') dev, count(*)::int n, count(*) filter (where converted_at is not null)::int acc
    from guest_presence where created_at > now() - interval '15 days' and country is distinct from 'SG'
    group by 1, 2, 3, 4, 5`);
  const su = await db.query(`select floor(extract(epoch from (now() - created_at)) / 86400)::int d, count(*)::int n from users where created_at > now() - interval '15 days' group by 1`);
  const day = (pred) => { const a = new Array(15).fill(0); for (const r of rows) if (r.d >= 0 && r.d < 15 && pred(r)) a[r.d] += r.n; return a; };
  const stat = (a) => { const b = a.slice(1), mu = b.reduce((x, y) => x + y, 0) / b.length, sd = Math.sqrt(b.reduce((x, y) => x + (y - mu) ** 2, 0) / Math.max(1, b.length - 1)) || 1; return { now: a[0], normal: +mu.toFixed(1), ratio: mu ? +(a[0] / mu).toFixed(2) : null, z: +((a[0] - mu) / sd).toFixed(1) }; };
  const visitors = stat(day(() => true));
  const sArr = new Array(15).fill(0); for (const r of su.rows) if (r.d >= 0 && r.d < 15) sArr[r.d] += r.n;
  const signups = stat(sArr);
  // which segment explains it: shortfall vs its own normal, biggest first (only segments that matter: normal ≥ 2/day)
  const why = [];
  for (const [dim, key] of [["source", "src"], ["landing", "lp"], ["country", "cc"], ["device", "dev"]]) {
    const vals = [...new Set(rows.map((r) => r[key]))];
    for (const v of vals) { const s = stat(day((r) => r[key] === v)); if (s.normal >= 2) why.push({ dim, seg: v, ...s, gap: +(s.now - s.normal).toFixed(1) }); }
  }
  why.sort((a, b) => a.gap - b.gap);
  const drop = visitors.normal >= 20 && (visitors.ratio ?? 1) <= 0.7;
  const rise = visitors.normal >= 20 && (visitors.ratio ?? 1) >= 1.4;
  const top = why.filter((w) => w.gap < 0).slice(0, 4);
  const out = {
    at: new Date().toISOString(), visitors, signups, state: drop ? "dip" : rise ? "up" : "normal",
    why: top.map((w) => `${w.dim} ${w.seg}: ${w.now} vs ~${w.normal}/day`),
    gainers: why.filter((w) => w.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 3).map((w) => `${w.dim} ${w.seg}: ${w.now} vs ~${w.normal}/day`),
    segments: why.slice(0, 40),
  };
  fs.mkdirSync("data/machines", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`humans: ${visitors.now} visitors in 24 h vs ~${visitors.normal} (×${visitors.ratio}) · sign-ups ${signups.now} vs ~${signups.normal} · ${out.state}${top.length ? " · down most: " + out.why.join("; ") : ""}`);
} finally { await db.end(); }
