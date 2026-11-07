// DAILY (weekdays, after the 17:00 New York close): what each market did today, from real 1-minute bars.
//   futures/FX/metals/oil/indices: Databento GLBX continuous front month (the same supplier as CRTLAB's chart data,
//   ~5¢ a day) · crypto: Coinbase public candles (free). Writes data/recaps/<date>.json + index.json, which the site's
//   /recap pages read. Never touches CRTLAB's chart data.
//   node scripts/recap.mjs                → today's (most recent completed) New York trading day
//   node scripts/recap.mjs --backfill 25  → the last 25 trading days (first run: also seeds the 20-day ranges)
import fs from "node:fs";

const KEY = process.env.DATABENTO_API_KEY;
const MARKETS = [
  { id: "XAUUSD", name: "Gold", src: "GC.v.0", unit: "$", step: 1, dp: 2 },
  { id: "XAGUSD", name: "Silver", src: "SI.v.0", unit: "$", step: 1, dp: 3 },
  { id: "USOIL", name: "Oil", src: "CL.v.0", unit: "$", step: 1, dp: 2 },
  { id: "NAS100", name: "NAS100", src: "NQ.v.0", unit: "pts", step: 1, dp: 1 },
  { id: "SP500", name: "S&P 500", src: "ES.v.0", unit: "pts", step: 1, dp: 1 },
  { id: "US30", name: "US30", src: "YM.v.0", unit: "pts", step: 1, dp: 0 },
  { id: "EURUSD", name: "EURUSD", src: "6E.v.0", unit: "pips", step: 0.0001, dp: 5 },
  { id: "GBPUSD", name: "GBPUSD", src: "6B.v.0", unit: "pips", step: 0.0001, dp: 5 },
  { id: "USDJPY", name: "USDJPY", src: "6J.v.0", unit: "pips", step: 0.01, dp: 3, invert: true },
  { id: "AUDUSD", name: "AUDUSD", src: "6A.v.0", unit: "pips", step: 0.0001, dp: 5 },
  { id: "BTCUSD", name: "Bitcoin", cb: "BTC-USD", unit: "$", step: 1, dp: 0 },
  { id: "ETHUSD", name: "Ethereum", cb: "ETH-USD", unit: "$", step: 1, dp: 1 },
];

// ── New York time ──
const NYF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
const ny = (t) => { const p = Object.fromEntries(NYF.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute, wd: p.weekday }; };
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** the New York trading day a bar belongs to: 18:00 NY starts the next day */
const tday = (t) => { const n = ny(t); return n.h >= 18 ? addDays(n.date, 1) : n.date; };
const hm = (t) => { const n = ny(t); return `${String(n.h).padStart(2, "0")}:${String(n.m).padStart(2, "0")}${n.h >= 18 ? " the evening before" : ""}`; };
const session = (t) => { const h = ny(t).h; return h < 2 ? "Asia" : h < 7 ? "London" : h < 12 ? "the New York morning" : "the New York afternoon"; };

// ── data ──
// 11-07: one 504 from Databento dropped a market for the day (XAGUSD 11-06, USDJPY 11-05). Retry 429/5xx/network errors;
// Databento only bills a request that returns data, so a retry never pays twice.
async function rfetch(url, opts) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, opts); if (r.ok || (r.status !== 429 && r.status < 500) || i === 3) return r; console.error("retry", r.status, url.slice(0, 60)); }
    catch (e) { if (i === 3) throw e; console.error("retry", String(e).slice(0, 80)); }
    await new Promise((res) => setTimeout(res, [5000, 15000, 30000][i]));
  }
}
async function databento(sym, start, end) {
  const r = await rfetch("https://hist.databento.com/v0/timeseries.get_range", { method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(KEY + ":").toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ dataset: "GLBX.MDP3", schema: "ohlcv-1m", stype_in: "continuous", symbols: sym, start, end, encoding: "json", pretty_px: "true", pretty_ts: "true" }) });
  if (!r.ok) throw new Error(`databento ${sym} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.text()).trim().split("\n").filter(Boolean).map((l) => { const j = JSON.parse(l); return { t: Date.parse(j.hd.ts_event) / 1000, o: +j.open, h: +j.high, l: +j.low, c: +j.close }; });
}
async function coinbase(prod, startSec, endSec) {
  const out = [];
  for (let a = startSec; a < endSec; a += 300 * 900) {
    const b = Math.min(endSec, a + 300 * 900);
    const r = await rfetch(`https://api.exchange.coinbase.com/products/${prod}/candles?granularity=900&start=${new Date(a * 1000).toISOString()}&end=${new Date(b * 1000).toISOString()}`, { headers: { "user-agent": "crtlab-growth-bot" } });
    if (!r.ok) throw new Error(`coinbase ${prod} ${r.status}`);
    for (const [t, l, h, o, c] of await r.json()) out.push({ t, o, h, l, c });
    await new Promise((res) => setTimeout(res, 250));
  }
  return [...new Map(out.map((b) => [b.t, b])).values()].sort((x, y) => x.t - y.t);
}
const inv = (b) => ({ t: b.t, o: 1 / b.o, h: 1 / b.l, l: 1 / b.h, c: 1 / b.c });

// ── one market, one day ──
function analyse(mk, bars, D, prevD, adrHist, prevStored) {
  const day = bars.filter((b) => tday(b.t) === D), prev = bars.filter((b) => tday(b.t) === prevD);
  if (day.length < 20 || (prev.length < 20 && !(prevStored?.h != null && prevStored?.l != null))) return null;
  const u = (x) => (mk.unit === "pips" ? x / mk.step : x);
  const fmt = (x) => (mk.unit === "$" ? `$${u(x).toLocaleString("en-US", { maximumFractionDigits: mk.dp > 2 ? 2 : mk.dp })}` : `${Math.round(u(x)).toLocaleString("en-US")} ${mk.unit}`);
  const px = (x) => x.toFixed(mk.dp);
  const hi = Math.max(...day.map((b) => b.h)), lo = Math.min(...day.map((b) => b.l)), open = day[0].o, close = day[day.length - 1].c;
  // yesterday's high/low: from the bars when we have them, else remembered from the last run (so a nightly run buys ONE day)
  const pH = prev.length >= 20 ? Math.max(...prev.map((b) => b.h)) : prevStored.h, pL = prev.length >= 20 ? Math.min(...prev.map((b) => b.l)) : prevStored.l;
  const range = hi - lo, avg = adrHist.length >= 5 ? adrHist.slice(-20).reduce((a, x) => a + x, 0) / Math.min(20, adrHist.length) : null;
  const rel = avg ? Math.round((range / avg) * 100) : null;
  // Asian range: 20:00–00:00 New York, then the day to 17:00
  const asia = day.filter((b) => { const h = ny(b.t).h; return h >= 20 && h < 24; }), after = day.filter((b) => ny(b.t).h < 17 && ny(b.t).h >= 0 && tday(b.t) === D && ny(b.t).h < 18);
  let aH = null, aL = null, aFirst = null, aBoth = false, aT = {};
  if (asia.length >= 10) {
    aH = Math.max(...asia.map((b) => b.h)); aL = Math.min(...asia.map((b) => b.l));
    for (const b of after) { if (aT.high == null && b.h > aH) aT.high = b.t; if (aT.low == null && b.l < aL) aT.low = b.t; }
    aFirst = aT.high != null && (aT.low == null || aT.high <= aT.low) ? "high" : aT.low != null ? "low" : null; aBoth = aT.high != null && aT.low != null;
  }
  // yesterday's high / low
  let pT = {}; for (const b of day) { if (pT.high == null && b.h > pH) pT.high = b.t; if (pT.low == null && b.l < pL) pT.low = b.t; }
  // daily CRT: swept yesterday's extreme and closed back inside
  const crt = hi > pH && close < pH && close > pL ? "bearish" : lo < pL && close > pL && close < pH ? "bullish" : null;
  // busiest New York hour
  const byH = {}; for (const b of day) { const h = ny(b.t).h; (byH[h] ??= { h, hi: -Infinity, lo: Infinity }); byH[h].hi = Math.max(byH[h].hi, b.h); byH[h].lo = Math.min(byH[h].lo, b.l); }
  const busy = Object.values(byH).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))[0];
  const chg = ((close - open) / open) * 100;
  // the story, in plain words
  const s = [];
  s.push(`${mk.name} ${chg >= 0 ? "rose" : "fell"} ${Math.abs(chg).toFixed(2)}% on a ${fmt(range)} range${rel != null ? ` (${rel}% of its 20-day average)` : ""}.`);
  if (aFirst) s.push(`The Asian ${aFirst} went first, at ${hm(aT[aFirst])} New York in ${session(aT[aFirst])}${aBoth ? `, and the ${aFirst === "high" ? "low" : "high"} followed at ${hm(aT[aFirst === "high" ? "low" : "high"])}` : ", and the other side held all day"}.`);
  else if (aH != null) s.push("Neither side of the Asian range was taken.");
  if (pT.high != null || pT.low != null) s.push(pT.high != null && pT.low != null ? `Both yesterday's high and low were taken.` : `Yesterday's ${pT.high != null ? "high" : "low"} was taken at ${hm(pT.high ?? pT.low)}.`);
  else s.push("Price stayed inside yesterday's range.");
  if (crt) s.push(`It swept yesterday's ${crt === "bearish" ? "high" : "low"} and closed back inside — a ${crt} daily CRT.`);
  s.push(`The busiest hour was ${String(busy.h).padStart(2, "0")}:00 New York (${fmt(busy.hi - busy.lo)}).`);
  // how notable — for the day's headlines
  const score = (crt ? 3 : 0) + (rel != null && rel >= 150 ? 3 : 0) + (rel != null && rel <= 55 ? 1 : 0) + (aBoth ? 1 : 0) + (pT.high != null && pT.low != null ? 2 : 0) + Math.min(2, Math.abs(chg) / 1.5);
  const headline = crt ? `${mk.name}: a ${crt} daily CRT — swept yesterday's ${crt === "bearish" ? "high" : "low"}, closed back inside`
    : rel != null && rel >= 150 ? `${mk.name}: a ${rel}% day — ${fmt(range)} against a ${fmt(avg)} average`
    : pT.high != null && pT.low != null ? `${mk.name} took both yesterday's high and low`
    : aBoth ? `${mk.name} took both sides of the Asian range` : `${mk.name} ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
  return { id: mk.id, name: mk.name, unit: mk.unit, open: px(open), high: px(hi), low: px(lo), close: px(close), chg: +chg.toFixed(2), range: +u(range).toFixed(2), rel,
    asia: aH != null ? { high: px(aH), low: px(aL), first: aFirst, firstAt: aFirst ? hm(aT[aFirst]) : null, both: aBoth } : null,
    prevDay: { high: px(pH), low: px(pL), highTaken: pT.high != null ? hm(pT.high) : null, lowTaken: pT.low != null ? hm(pT.low) : null },
    crt, busiestHour: busy.h, story: s.join(" "), headline, score: +score.toFixed(2), _range: range, _h: hi, _l: lo };
}

// ── run ──
const back = process.argv.includes("--backfill") ? +process.argv[process.argv.indexOf("--backfill") + 1] : 0;
const nowS = Math.floor(Date.now() / 1000), today = ny(nowS);
const avail = KEY ? await fetch("https://hist.databento.com/v0/metadata.get_dataset_range?dataset=GLBX.MDP3", { headers: { Authorization: "Basic " + Buffer.from(KEY + ":").toString("base64") } }).then((r) => r.json()).then((j) => Date.parse(j.end ?? j.end_date)).catch(() => Date.now()) : Date.now();
const endMs = Math.min(Date.now(), avail);
// the newest New York day that has FULLY closed in the data (17:00 NY ≤ 22:00 UTC) — never a half-built day
let D = today.date;
while (Date.parse(D + "T22:00:00Z") > endMs) D = addDays(D, -1);
const isWk = (d) => { const w = new Date(d + "T12:00:00Z").getUTCDay(); return w > 0 && w < 6; };
while (!isWk(D)) D = addDays(D, -1);
const days = [D]; while (days.length < Math.max(1, back)) { let x = addDays(days[days.length - 1], -1); while (!isWk(x)) x = addDays(x, -1); days.push(x); }
days.reverse();
// COST (Kai: ~$1 a month): a nightly run buys ONLY the new day — from 21:00 UTC the evening before (covers the 18:00 NY
// open in summer and winter) — and remembers yesterday's high/low; only a backfill buys history (~4¢ a trading day)
const startMs = back ? endMs - (back * 1.45 + 8) * 86400000 : Date.parse(addDays(days[0], -1) + "T21:00:00Z");
const span = Math.ceil((Date.now() - startMs) / 86400000);
const startIso = new Date(startMs).toISOString().slice(0, 16), endIso = new Date(endMs).toISOString().slice(0, 16);
fs.mkdirSync("data/recaps", { recursive: true });
const rangesF = "data/recaps/ranges.json", ranges = fs.existsSync(rangesF) ? JSON.parse(fs.readFileSync(rangesF, "utf8")) : {};
const all = {};
for (const mk of MARKETS) {
  try {
    // bought bars are kept on disk, so a crash after the download never pays twice
    const cache = `.cache/${mk.id}-${startIso}-${endIso}.json`.replace(/:/g, "");
    let bars = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, "utf8"))
      : mk.cb ? await coinbase(mk.cb, Math.floor(startMs / 1000) - (back ? 0 : 86400), nowS) : KEY ? await databento(mk.src, startIso, endIso) : [];
    if (!fs.existsSync(cache) && bars.length) { fs.mkdirSync(".cache", { recursive: true }); fs.writeFileSync(cache, JSON.stringify(bars)); }
    if (mk.invert) bars = bars.map(inv);
    bars = bars.filter((b) => tday(b.t) <= D);
    all[mk.id] = bars; console.log(mk.id, bars.length, "bars");
  } catch (e) { console.error(mk.id, String(e).slice(0, 200)); all[mk.id] = []; }
}
const index = fs.existsSync("data/recaps/index.json") ? JSON.parse(fs.readFileSync("data/recaps/index.json", "utf8")) : [];
// every trading day in the pulled span, oldest first, so the 20-day ranges build up correctly
const spanDays = [...new Set(Object.values(all).flat().map((b) => tday(b.t)))].filter(isWk).sort();
for (const d of spanDays) {
  const stored = Object.values(ranges).flat().map((x) => x.d).filter((x) => x < d).sort();
  const prevD = spanDays[spanDays.indexOf(d) - 1] ?? stored[stored.length - 1]; if (!prevD) continue;
  const out = [];
  for (const mk of MARKETS) {
    const hist = (ranges[mk.id] ?? []).filter((x) => x.d < d).map((x) => x.r);
    const r = analyse(mk, all[mk.id], d, prevD, hist, (ranges[mk.id] ?? []).find((x) => x.d === prevD));
    if (!r) continue;
    ranges[mk.id] = [...(ranges[mk.id] ?? []).filter((x) => x.d !== d), { d, r: r._range, h: r._h, l: r._l }].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-40);
    delete r._range; delete r._h; delete r._l; out.push(r);
  }
  if (!days.includes(d) || out.length < 6) continue; // publish only the asked days, and only with most markets in
  out.sort((a, b) => b.score - a.score);
  const rec = { date: d, generated: new Date().toISOString(), source: "CME futures via Databento (continuous front month); crypto via Coinbase", headlines: out.slice(0, 3).map((x) => x.headline), markets: out };
  fs.writeFileSync(`data/recaps/${d}.json`, JSON.stringify(rec, null, 1));
  const i = index.findIndex((x) => x.date === d); const row = { date: d, headline: rec.headlines[0], markets: out.length };
  if (i >= 0) index[i] = row; else index.push(row);
  console.log("published", d, "·", rec.headlines[0]);
}
index.sort((a, b) => (a.date < b.date ? 1 : -1));
fs.writeFileSync("data/recaps/index.json", JSON.stringify(index, null, 1));
fs.writeFileSync(rangesF, JSON.stringify(ranges));
fs.appendFileSync("data/recap-runs.jsonl", JSON.stringify({ at: new Date().toISOString(), days: days.length, published: index.filter((x) => days.includes(x.date)).length, latest: index[0] ?? null }) + "\n");
