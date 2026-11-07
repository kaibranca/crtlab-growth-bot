// INDICATOR PAGES (11-07) → data/indicators/index.json + data/indicators/<slug>.json: every release of every medium/high
// economic indicator for 10 economies since 2016 (actual, forecast, previous), its next scheduled release, and what it
// measures. Feeds crtlab.pro/economic-calendar/<slug> (one page per indicator with 12+ releases) and the country hubs.
// TradingView's public calendar, nothing billed. First run backfills 2016→now (~4 min); later runs re-read the last 10
// days (actuals land, revisions) + the next 60 days (next release, consensus) and rewrite ONLY files that changed, so the
// sitemap lastmod / IndexNow only move for indicators that really released. Slugs never change once given.
// Usage: node scripts/indicators.mjs            (incremental; backfills automatically if the index is missing)
//        node scripts/indicators.mjs 2016       (force a full backfill from that year)
import fs from "node:fs";
const DIR = "data/indicators", IDX = `${DIR}/index.json`, DAY = 86400000, now = Date.now();
const COUNTRIES = { US: ["us", "United States"], EU: ["ez", "Eurozone"], GB: ["uk", "United Kingdom"], JP: ["jp", "Japan"], AU: ["au", "Australia"], CA: ["ca", "Canada"], NZ: ["nz", "New Zealand"], CH: ["ch", "Switzerland"], CN: ["cn", "China"], DE: ["de", "Germany"] };
const NOISE = /Auction|Bid-to-Cover|Allotted|Total Accepted|Truck Sales|Car Sales|Money Supply|Foreign Bond|Bond Investment|Stock Investment|Reserve Assets|Exchange Reserves|USDA|Pork|Baker Hughes|Rig Count|^MBA|Redbook|Cushing|Gasoline|Distillate|Refinery|Heating Oil|Natural Gas Stocks|Overall Comprehensive Risk|Speech|Testimony|Minutes|Press Conference|Hearing|Meeting|Holiday|Election|Summit|Report$|Statement|Projections|Bulletin|Ethanol|Commitments|CFTC|NOPA|WASDE|Soybean|Poultry|Livestock|Cattle|Hogs|Corn|Wheat|Cotton|Crop/i;
const MONEY = new Set(["$", "€", "£", "¥", "A$"]);
const num = (x) => (typeof x !== "number" ? x : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : Math.abs(x) >= 100 && !Number.isInteger(x) ? +x.toFixed(1) : +x.toFixed(3));
const fmt = (x, e) => (x == null || x === "" ? null : MONEY.has(e.unit) ? `${+x < 0 ? "-" : ""}${e.unit}${num(Math.abs(+x))}${e.scale ?? ""}` : `${num(x)}${e.unit && e.unit.length <= 2 ? e.unit : ""}${e.scale ?? ""}`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// one indicator, several reads: TradingView files GDP Adv / 2nd Est / 3rd Est, Michigan Prel / Final, EZ CPI Flash / Final
// under ONE ticker. One page per indicator, the stage marked on each row — never a near-copy page per stage.
const STAGE = /\s+(Prel|Prelim|Preliminary|Final|Flash|Adv|Advance|2nd Est|3rd Est|Second Estimate|Third Estimate|Revised)$/i;
const stageOf = (t) => (t.match(STAGE)?.[1] ?? null);
const base = (t) => t.replace(STAGE, "");
const slugify = (s) => s.toLowerCase().replace(/&/g, " and ").replace(/%/g, " pct ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
fs.mkdirSync(DIR, { recursive: true });

const force = process.argv[2] && /^\d{4}$/.test(process.argv[2]) ? Date.parse(`${process.argv[2]}-01-01`) : null;
const prev = fs.existsSync(IDX) ? JSON.parse(fs.readFileSync(IDX, "utf8")) : null;
const from = force ?? (prev ? now - 10 * DAY : Date.parse("2016-01-01"));
// state: key → full record, read back from the per-indicator files
const ind = {}, slugOf = {};
for (const x of prev?.list ?? []) {
  slugOf[x.key] = x.slug;
  try { ind[x.key] = JSON.parse(fs.readFileSync(`${DIR}/${x.slug}.json`, "utf8")); } catch {}
}
const before = Object.fromEntries(Object.entries(ind).map(([k, v]) => [k, JSON.stringify(v)]));

async function week(a, b) {
  for (let tries = 0; tries < 4; tries++) {
    try {
      const r = await fetch(`https://economic-calendar.tradingview.com/events?from=${iso(a)}T00:00:00.000Z&to=${iso(b)}T23:59:59.000Z&countries=${Object.keys(COUNTRIES).join(",")}`, { headers: { origin: "https://www.tradingview.com", "user-agent": "Mozilla/5.0 (crtlab-growth-bot)" } });
      if (r.ok) return (await r.json()).result ?? [];
      if (r.status !== 429 && r.status < 500) { console.log("tv", r.status); return null; }
    } catch (err) { if (tries === 3) console.log("tv fail", String(err).slice(0, 80)); }
    await new Promise((res) => setTimeout(res, 1500 * (tries + 1)));
  }
  return null;
}
const keyOf = (e) => e.ticker || `${e.country}|${e.indicator || e.title}`;
let ok = 0, fail = 0;
const future = [];
const end = now + 60 * DAY;
for (let a = from; a < end; a += 7 * DAY) {
  const res = await week(a, Math.min(end, a + 6 * DAY));
  if (!res) { fail++; continue; }
  ok++;
  for (const e of res) {
    const t = Date.parse(e.date); if (!COUNTRIES[e.country] || NOISE.test(e.title)) continue;
    const k = keyOf(e);
    if (t > now || e.actual == null) { if (t > now) future.push({ k, t, period: e.period ?? null, st: stageOf(e.title), f: fmt(e.forecast, e), p: fmt(e.previous, e), imp: e.importance }); continue; }
    const g = (ind[k] ??= { key: k, country: e.country, cur: e.currency, rows: [] });
    if (t >= (g.titleAt ?? 0)) { g.title = base(e.title); g.name = e.indicator || g.title; g.titleAt = t; } // latest name wins
    g.cur = e.currency; g.category = e.category ?? g.category ?? null;
    if (t >= now - 3 * 365 * DAY) g.imp = Math.max(g.imp ?? -1, e.importance ?? -1); // importance from the last 3 years only
    if (e.comment) g.about = String(e.comment).replace(/\s+/g, " ").trim().slice(0, 900);
    if (e.source) g.source = e.source; if (e.source_url) g.url = e.source_url;
    if (e.unit) g.unit = e.unit; if (e.scale) g.scale = e.scale;
    const row = { t, period: e.period ?? null, st: stageOf(e.title), a: fmt(e.actual, e), f: fmt(e.forecast, e), p: fmt(e.previous, e), an: e.actual, fn: e.forecast ?? null, pn: e.previous ?? null };
    const i = g.rows.findIndex((x) => x.t === t); if (i >= 0) g.rows[i] = row; else g.rows.push(row);
  }
  if (force || !prev) process.stdout.write(ok % 26 === 0 ? `${iso(a)} ${Object.keys(ind).length}\n` : "");
  await new Promise((res) => setTimeout(res, 250));
}
if (!ok || fail > ok / 4) { console.log(`TradingView answered ${ok}, failed ${fail} — kept the old files`); process.exit(0); }

// derived numbers the pages print (one place, so every page and FAQ says the same thing)
const r2 = (x) => Math.round(x * 100) / 100;
function stats(g) {
  const rows = g.rows, n = rows.length, wf = rows.filter((r) => typeof r.an === "number" && typeof r.fn === "number");
  const side = (rs) => { let up = 0, dn = 0, eq = 0; for (const r of rs) r.an > r.fn ? up++ : r.an < r.fn ? dn++ : eq++; return { n: rs.length, above: up, below: dn, inline: eq }; };
  let streak = 0, dir = null;
  for (const r of wf) { const d = r.an > r.fn ? "above" : r.an < r.fn ? "below" : "inline"; if (dir == null) dir = d; if (d !== dir) break; streak++; }
  const vals = rows.filter((r) => typeof r.an === "number");
  const hi = vals.reduce((m, r) => (m == null || r.an > m.an ? r : m), null), lo = vals.reduce((m, r) => (m == null || r.an < m.an ? r : m), null);
  const absSurp = wf.slice(0, 24).map((r) => Math.abs(r.an - r.fn)), avgSurp = absSurp.length ? r2(absSurp.reduce((a, b) => a + b, 0) / absSurp.length) : null;
  const y5 = vals.filter((r) => r.t >= now - 5 * 365 * DAY), avg5 = y5.length ? r2(y5.reduce((a, r) => a + r.an, 0) / y5.length) : null;
  const gaps = rows.slice(0, 13).map((r, i, a) => (i ? (a[i - 1].t - r.t) / DAY : null)).filter((x) => x != null).sort((a, b) => a - b);
  const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const freq = gap == null ? null : gap <= 8 ? "weekly" : gap <= 20 ? "twice a month" : gap <= 45 ? "monthly" : gap <= 70 ? "every 6–8 weeks" : gap <= 110 ? "quarterly" : gap <= 200 ? "twice a year" : "yearly";
  return { n, since: iso(rows.at(-1).t), withForecast: wf.length, all: side(wf), last12: side(wf.slice(0, 12)), streak: dir && dir !== "inline" && streak >= 2 ? { dir, n: streak } : null,
    high: hi && { a: hi.a, t: hi.t, period: hi.period }, low: lo && { a: lo.a, t: lo.t, period: lo.period }, avgSurprise: avgSurp, avg5y: avg5, freq };
}
const SLUG_TAKEN = new Set(Object.values(slugOf));
const list = [];
for (const [k, g] of Object.entries(ind)) {
  g.rows.sort((x, y) => y.t - x.t);
  const nx = future.filter((f) => f.k === k).sort((a, b) => a.t - b.t)[0];
  g.next = nx ? { t: nx.t, period: nx.period, st: nx.st, f: nx.f, p: nx.p } : null;
  if (nx) g.imp = Math.max(g.imp ?? -1, nx.imp ?? -1);
  g.stats = stats(g);
  if (!slugOf[k]) { // first time seen: give it a slug for life
    let s = `${COUNTRIES[g.country][0]}-${slugify(g.title)}`;
    if (SLUG_TAKEN.has(s)) s = `${s}-${slugify(k.replace(/^ECONOMICS:/, ""))}`;
    slugOf[k] = s; SLUG_TAKEN.add(s);
  }
  g.slug = slugOf[k];
  const last = g.rows[0];
  // a page exists only with real depth: 12+ releases, medium/high importance, still being released (last one < ~14 months)
  const page = g.rows.length >= 12 && (g.imp ?? -1) >= 0 && now - last.t < 425 * DAY;
  list.push({ key: k, slug: g.slug, country: g.country, cur: g.cur, title: g.title, name: g.name, imp: g.imp ?? -1, category: g.category, n: g.rows.length, since: g.stats.since,
    last: { t: last.t, a: last.a, f: last.f, p: last.p, period: last.period }, next: g.next, freq: g.stats.freq, page });
}
// same economy + same name under two tickers (prel/final filed separately, a renamed series): one page — the one with the
// most history — so two pages never carry the same H1. Filtered titles never get a page either.
const best = {};
for (const x of list) { const k = `${x.country}|${x.title.toLowerCase()}`; if (NOISE.test(x.title)) x.page = false; if (x.page && (!best[k] || x.n > best[k].n)) best[k] = x; }
for (const x of list) if (x.page && best[`${x.country}|${x.title.toLowerCase()}`] !== x) x.page = false;
let wrote = 0;
for (const [k, g] of Object.entries(ind)) {
  const s = JSON.stringify(g);
  if (before[k] === s) continue;
  fs.writeFileSync(`${DIR}/${g.slug}.json`, s); wrote++;
}
list.sort((a, b) => a.country.localeCompare(b.country) || b.imp - a.imp || a.title.localeCompare(b.title));
const body = JSON.stringify(list);
if (prev && JSON.stringify(prev.list) === body) { console.log("indicators unchanged"); process.exit(0); }
fs.writeFileSync(IDX, JSON.stringify({ changed: new Date(now).toISOString(), list }));
console.log("indicators", list.length, "· pages", list.filter((x) => x.page).length, "· files written", wrote, "· weeks read", ok, "failed", fail);
