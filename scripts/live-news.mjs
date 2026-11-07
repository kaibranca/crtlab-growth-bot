// SAME-DAY NEWS PAGES (11-07) — a release's page goes up about an hour after it prints, while people are still searching
// for it, instead of the next morning. $0: the actual/forecast come from the calendar (data/events/upcoming.json, TradingView,
// refreshed hourly) and the first-hour move from Coinbase's free 1-minute candles (Bitcoin, Ethereum). Gold, indices and
// forex need Databento, which our plan serves 8 hours late, so the page is written `partial: true` and hubs.mjs fills in all
// 12 markets ON THE SAME URL from the nightly buy it already makes — no extra data is bought, ever.
// Runs hourly (hourly.yml, after upcoming.mjs). A page is written once; it never overwrites a full page.
import fs from "node:fs";

const U = JSON.parse(fs.readFileSync("data/events/upcoming.json", "utf8"));
const idxF = "data/events/index.json", idx = JSON.parse(fs.readFileSync(idxF, "utf8"));
const ranges = fs.existsSync("data/recaps/ranges.json") ? JSON.parse(fs.readFileSync("data/recaps/ranges.json", "utf8")) : {};
// NOW=<ms> DRY=1: replay a past release without writing anything (testing)
const now = +(process.env.NOW || Date.now()), MIN = 60e3, DRY = !!process.env.DRY;
const CRYPTO = [["BTCUSD", "Bitcoin", "BTC-USD"], ["ETHUSD", "Ethereum", "ETH-USD"]];

// headline releases that printed 62 minutes to 6 hours ago, grouped by release minute + currency
const out = U.events.filter((e) => e.fam && e.actual != null && e.t <= now - 62 * MIN && e.t >= now - 6 * 3600e3);
const groups = new Map(); for (const e of out) { const k = `${e.t}|${e.cur}`; groups.set(k, [...(groups.get(k) ?? []), e]); }

async function candles(prod, a, b) { // Coinbase 1-minute, ≤300 per request
  const bars = [];
  for (let s = a; s < b; s += 300 * 60) {
    const e = Math.min(b, s + 300 * 60);
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fetch(`https://api.exchange.coinbase.com/products/${prod}/candles?granularity=60&start=${new Date(s * 1000).toISOString()}&end=${new Date(e * 1000).toISOString()}`, { headers: { "user-agent": "crtlab-growth-bot" } });
        if (r.ok) { for (const [t, l, h, o, c] of await r.json()) bars.push({ t, o, h, l, c }); break; }
      } catch { /* retry */ }
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  return [...new Map(bars.map((x) => [x.t, x])).values()].sort((x, y) => x.t - y.t);
}

let made = 0;
for (const evs of groups.values()) {
  const e0 = evs[0], t = Math.floor(e0.t / 1000), { date, time } = e0;
  if (!DRY && idx.some((x) => x.date === date && x.time === time)) continue; // a page for this minute already exists (full or same-day)
  const fams = [...new Set(evs.map((e) => e.fam))], famName = [...new Set(evs.map((e) => e.famName))].join(" & "), slug = `${fams.join("-")}-${date}`;
  if (!DRY && idx.some((x) => x.slug === slug)) continue;
  // every release of that currency at that minute (CPI prints headline, core, MoM and YoY together)
  const rel = U.events.filter((x) => x.t === e0.t && x.cur === e0.cur && !x.holiday && (x.fam || x.imp === 2));
  const markets = [];
  for (const [id, name, prod] of CRYPTO) {
    const B = await candles(prod, t - 26 * 3600, Math.min(Math.floor(now / 1000), t + 5400));
    const i0 = B.findIndex((b) => b.t >= t); if (i0 < 0 || B[i0].t - t > 120) continue;
    const w = B.filter((b) => b.t >= t && b.t < t + 3600); if (w.length < 50) continue;
    const pre = B.filter((b) => b.t >= t - 3600 && b.t < t), p0 = B[i0].o, at = (k) => B.find((b) => b.t >= t + k * 60) ?? null;
    const move = (b) => (b ? +(((b.c - p0) / p0) * 100).toFixed(3) : null), hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
    const past = (ranges[id] ?? []).filter((x) => x.d < date), y = past[past.length - 1], last20 = past.slice(-20);
    const avg = last20.length >= 10 ? last20.reduce((s, x) => s + x.r, 0) / last20.length : null;
    const before = B.filter((b) => b.t < t && b.t >= t - 86400), preHi = Math.max(-Infinity, ...before.map((b) => b.h)), preLo = Math.min(Infinity, ...before.map((b) => b.l));
    const swept = []; if (y) { if (hi > y.h && preHi <= y.h) swept.push("yesterday's high"); if (lo < y.l && preLo >= y.l) swept.push("yesterday's low"); }
    const m5 = move(at(5)), m60 = move(at(59));
    markets.push({ id, name, unit: "$", p0: +p0.toPrecision(8), m5, m15: move(at(15)), m60, upMax: +(((hi - p0) / p0) * 100).toFixed(3), dnMax: +(((lo - p0) / p0) * 100).toFixed(3),
      range60: +(hi - lo).toFixed(2), ofDay: avg ? Math.round(((hi - lo) / avg) * 100) : null, preRange: pre.length ? +(Math.max(...pre.map((b) => b.h)) - Math.min(...pre.map((b) => b.l))).toFixed(2) : null,
      reversed: m5 != null && m60 != null && Math.sign(m5) !== Math.sign(m60) && Math.abs(m60) > Math.abs(m5) * 0.5, swept, toClose: null,
      line: B.filter((b) => b.t >= t - 1800 && b.t < t + 5400).map((b) => +b.c.toPrecision(7)) });
  }
  if (!markets.length) { console.log("live", slug, "no crypto bars yet"); continue; }
  const h = evs[0], fig = h.forecast != null ? ` vs ${h.forecast} forecast` : "", top = markets[0];
  const headline = `${famName}: ${h.title} ${h.actual}${fig} — ${top.name} moved $${top.range60.toLocaleString("en-US")} in the first hour`;
  const day = { slug, date, time, t, fams, famName, title: rel.map((x) => x.title).join(" · "), partial: true,
    releases: rel.map((x) => ({ title: x.title, actual: x.actual, forecast: x.forecast, previous: x.previous })), headline, markets };
  if (DRY) { console.log(JSON.stringify({ ...day, markets: day.markets.map(({ line, ...m }) => ({ ...m, line: line.length })) }, null, 1)); continue; }
  fs.writeFileSync(`data/events/${slug}.json`, JSON.stringify(day));
  idx.push({ slug, date, time, fams, famName, title: day.title, headline, partial: true });
  made++; console.log("live", slug, "·", headline);
}
if (made) { idx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.time.localeCompare(a.time))); fs.writeFileSync(idxF, JSON.stringify(idx, null, 1)); }
console.log("live-news:", made, "same-day page(s)");
