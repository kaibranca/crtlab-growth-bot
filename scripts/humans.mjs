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
      coalesce(country, '?') cc, coalesce(device, '?') dev,
      -- REAL = ENGAGED visitors (11-13, Kai: "bots sometimes stay 30 s — count people who DO something"): replayed ≥ 1 candle
      -- (guest_meters, per device) or made an account. Was "stayed 30 s+" (11-11): 188 guests / 28 d sat 30 s+ and did nothing.
      count(*) filter (where converted_at is not null or exists (select 1 from guest_meters m where m.device_key = guest_presence.device_key and m.candles_used > 0))::int n,
      count(*)::int raw, count(*) filter (where converted_at is not null)::int acc,
      count(*) filter (where last_active > created_at + interval '2 seconds')::int beat
    from guest_presence where created_at > now() - interval '15 days' and country is distinct from 'SG'
    group by 1, 2, 3, 4, 5`);
  const su = await db.query(`select floor(extract(epoch from (now() - created_at)) / 86400)::int d, count(*)::int n from users where created_at > now() - interval '15 days' group by 1`);
  // WAVE SENSOR (11-12, Kai: "a spike or a wave is our golden ticket — the whole system locks in"): the last 3 h vs the same
  // 3 h of each of the 14 days before (time of day can't fake it), REAL visitors + sign-ups, per source and landing type.
  let wv = { rows: [] }, wsu = { rows: [] };
  try {
  wv = await db.query(`select floor(extract(epoch from (now() - created_at)) / 86400)::int d, ${seg} src, ${land} lp,
      count(*) filter (where converted_at is not null or exists (select 1 from guest_meters m where m.device_key = guest_presence.device_key and m.candles_used > 0))::int n, count(*) filter (where converted_at is not null)::int acc
    from guest_presence where created_at > now() - interval '15 days' and country is distinct from 'SG'
      and mod(extract(epoch from (now() - created_at))::bigint, 86400) < 10800 group by 1, 2, 3`);
  wsu = await db.query(`select floor(extract(epoch from (now() - created_at)) / 86400)::int d, count(*)::int n from users
    where created_at > now() - interval '15 days' and mod(extract(epoch from (now() - created_at))::bigint, 86400) < 10800 group by 1`);
  } catch (e) { console.log("humans: wave sensor skipped (" + String(e.message).slice(0, 80) + ")"); }
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
  // a dip needs REAL people down AND sign-ups not holding up (sign-ups at ≥ 85% of normal = the drop was noise, not people)
  const drop = visitors.normal >= 15 && (visitors.ratio ?? 1) <= 0.7 && (signups.ratio ?? 0) < 0.85;
  const rise = visitors.normal >= 15 && (visitors.ratio ?? 1) >= 1.4;
  const top = why.filter((w) => w.gap < 0).slice(0, 4);
  const rawDay = new Array(15).fill(0); for (const r of rows) if (r.d >= 0 && r.d < 15) rawDay[r.d] += r.raw;
  const wDay = (pred) => { const a = new Array(15).fill(0); for (const r of wv.rows) if (r.d >= 0 && r.d < 15 && pred(r)) a[r.d] += r.n; return a; };
  const wsArr = new Array(15).fill(0); for (const r of wsu.rows) if (r.d >= 0 && r.d < 15) wsArr[r.d] += r.n;
  const wSegs = []; for (const [dim, key] of [["source", "src"], ["landing", "lp"]]) for (const v of [...new Set(wv.rows.map((r) => r[key]))]) { const x = stat(wDay((r) => r[key] === v)); if (x.now >= 3) wSegs.push({ dim, seg: v, ...x, gain: +(x.now - x.normal).toFixed(1) }); }
  const wave = { window: "3h", visitors: stat(wDay(() => true)), signups: stat(wsArr), riding: wSegs.sort((a, b) => b.gain - a.gain).slice(0, 3) };
  // SELF-CHECK (11-12 — "am I measuring right?"): every engine trusts "real visitors" (stayed 30 s+). Per device, today vs
  // the 14 days before: the share of guests whose heartbeat fired at all (beat/raw) and the share who stayed (real/raw).
  // Heartbeat share collapsing = the INSTRUMENT broke (a deploy, a script error) — not people leaving; flagged as such.
  const dv = {}; for (const r of rows) { if (r.d < 0 || r.d > 14) continue; const o = ((dv[r.dev] ??= Array.from({ length: 15 }, () => ({ raw: 0, beat: 0, n: 0 }))))[r.d]; o.raw += r.raw; o.beat += r.beat ?? 0; o.n += r.n; }
  const check = Object.entries(dv).map(([dev, a]) => { const b = a.slice(1).reduce((x, y) => ({ raw: x.raw + y.raw, beat: x.beat + y.beat, n: x.n + y.n }), { raw: 0, beat: 0, n: 0 });
    const sh = (o, k) => (o.raw ? +(o[k] / o.raw).toFixed(3) : null); return { dev, raw24: a[0].raw, beat24: sh(a[0], "beat"), beatNormal: sh(b, "beat"), stay24: sh(a[0], "n"), stayNormal: sh(b, "n") }; })
    .filter((x) => x.raw24 >= 10);
  const broken = check.filter((x) => x.beatNormal >= 0.2 && x.beat24 != null && x.beat24 < x.beatNormal * 0.4);
  const leaving = check.filter((x) => !broken.includes(x) && x.stayNormal >= 0.05 && x.stay24 != null && x.stay24 < x.stayNormal * 0.5);
  // RAW COMPOSITION: what the raw surge is made of (country / source / landing / device, raw today vs normal) — one network
  // or country with a huge raw gain and ~0 stays = a headless flood (the shield's job), not people leaving
  const rawSeg = []; for (const [dim, key] of [["country", "cc"], ["source", "src"], ["landing", "lp"], ["device", "dev"]]) for (const v of [...new Set(rows.map((r) => r[key]))]) {
    const a = new Array(15).fill(0), st = new Array(15).fill(0); for (const r of rows) if (r[key] === v && r.d >= 0 && r.d < 15) { a[r.d] += r.raw; st[r.d] += r.n; }
    const mu = a.slice(1).reduce((x, y) => x + y, 0) / 14; if (a[0] - mu >= 15) rawSeg.push({ dim, seg: v, raw24: a[0], rawNormal: +mu.toFixed(1), stayed24: st[0], stayShare: a[0] ? +(st[0] / a[0]).toFixed(3) : null }); }
  rawSeg.sort((x, y) => (y.raw24 - y.rawNormal) - (x.raw24 - x.rawNormal));
  const flood = rawSeg.filter((x) => x.dim === "country" && x.stayShare != null && x.stayShare < 0.03 && x.raw24 >= 3 * Math.max(5, x.rawNormal));
  const selfCheck = { devices: check, rawSurge: rawSeg.slice(0, 6), flood: flood.map((x) => `${x.seg}: ${x.raw24} raw vs ~${x.rawNormal}, ${x.stayed24} stayed`), verdict: flood.length && !broken.length ? `FLOOD: the raw surge is ${flood.map((x) => `${x.seg} (${x.raw24} vs ~${x.rawNormal}, ${x.stayed24} stayed)`).join(", ")} — headless traffic, not people leaving` : broken.length ? `INSTRUMENT: heartbeat share collapsed on ${broken.map((x) => `${x.dev} (${x.beat24} vs ${x.beatNormal})`).join(", ")} — "real visitors" is under-counted, not a real dip`
    : leaving.length ? `PEOPLE LEAVING: heartbeats fine, but the share who stay 30 s fell on ${leaving.map((x) => `${x.dev} (${x.stay24} vs ${x.stayNormal})`).join(", ")}` : "measuring right" };
  const out = {
    at: new Date().toISOString(), selfCheck, wave, visitors, rawVisitors: stat(rawDay), signups, state: broken.length ? "instrument" : drop ? "dip" : rise ? "up" : "normal",
    why: top.map((w) => `${w.dim} ${w.seg}: ${w.now} vs ~${w.normal}/day`),
    gainers: why.filter((w) => w.gap > 0).sort((a, b) => b.gap - a.gap).slice(0, 3).map((w) => `${w.dim} ${w.seg}: ${w.now} vs ~${w.normal}/day`),
    segments: why.slice(0, 40),
  };
  fs.mkdirSync("data/machines", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`humans: ${visitors.now} real visitors in 24 h (raw ${out.rawVisitors.now} vs ~${out.rawVisitors.normal}) vs ~${visitors.normal} (×${visitors.ratio}) · sign-ups ${signups.now} vs ~${signups.normal} · ${out.state}${top.length ? " · down most: " + out.why.join("; ") : ""} · 3 h: ${wave.visitors.now} vs ~${wave.visitors.normal} (×${wave.visitors.ratio}) · self-check: ${selfCheck.verdict}`);
} finally { await db.end(); }
