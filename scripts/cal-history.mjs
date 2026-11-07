// CALENDAR HISTORY (11-07) → data/events/history.json: the last 12 releases of every high/medium indicator for USD, EUR,
// GBP, JPY, AUD (actual, forecast, previous) + what it measures and its source. Feeds the row details on
// crtlab.pro/economic-calendar and the per-indicator pages. TradingView's public calendar, nothing billed.
// First run backfills 13 months; later runs only re-read the last 10 days and merge (an actual can be revised).
import fs from "node:fs";
const OUT = "data/events/history.json", DAY = 86400000, now = Date.now();
const NOISE = /Auction|Bid-to-Cover|Allotted|Total Accepted|Truck Sales|Car Sales|Money Supply|Foreign Bond|Bond Investment|Stock Investment|Reserve Assets|Exchange Reserves|USDA|Pork|Baker Hughes|Rig Count|^MBA|Redbook|Cushing|Gasoline|Distillate|Refinery|Heating Oil|Natural Gas Stocks/i;
const MONEY = new Set(["$", "€", "£", "¥", "A$"]);
const num = (x) => (typeof x !== "number" ? x : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : Math.abs(x) >= 100 && !Number.isInteger(x) ? +x.toFixed(1) : +x.toFixed(3));
const fmt = (x, e) => (x == null || x === "" ? null : MONEY.has(e.unit) ? `${+x < 0 ? "-" : ""}${e.unit}${num(Math.abs(+x))}${e.scale ?? ""}` : `${num(x)}${e.unit && e.unit.length <= 2 ? e.unit : ""}${e.scale ?? ""}`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { ind: {} };
const ind = old.ind; // key "USD|Inflation Rate YoY" → { cur, title, about, source, url, imp, rows: [{ t, period, a, f, p, an, fn }] }
const from = Object.keys(ind).length ? now - 10 * DAY : now - 400 * DAY;
let ok = 0;
for (let a = from; a < now; a += 7 * DAY) {
  try {
    const r = await fetch(`https://economic-calendar.tradingview.com/events?from=${iso(a)}T00:00:00.000Z&to=${iso(Math.min(now, a + 7 * DAY))}T23:59:59.000Z&countries=US,EU,GB,JP,AU`, { headers: { origin: "https://www.tradingview.com", "user-agent": "Mozilla/5.0 (crtlab-growth-bot)" } });
    if (!r.ok) { console.log("tv", r.status); continue; }
    ok++;
    for (const e of (await r.json()).result ?? []) {
      const t = Date.parse(e.date); if (e.importance < 0 || NOISE.test(e.title) || !(t <= now) || e.actual == null) continue;
      const k = `${e.currency}|${e.title}`;
      const g = (ind[k] ??= { cur: e.currency, title: e.title, rows: [] });
      g.imp = Math.max(g.imp ?? 0, e.importance === 1 ? 2 : 1);
      if (e.comment) g.about = String(e.comment).replace(/\s+/g, " ").trim().slice(0, 600);
      if (e.source) g.source = e.source; if (e.source_url) g.url = e.source_url;
      const row = { t, period: e.period ?? null, a: fmt(e.actual, e), f: fmt(e.forecast, e), p: fmt(e.previous, e), an: e.actual, fn: e.forecast ?? null };
      const i = g.rows.findIndex((x) => x.t === t); if (i >= 0) g.rows[i] = row; else g.rows.push(row);
      g.rows.sort((x, y) => y.t - x.t); g.rows = g.rows.slice(0, 12);
    }
  } catch (err) { console.log("tv fail", String(err).slice(0, 100)); }
  await new Promise((res) => setTimeout(res, 300));
}
if (!ok) { console.log("no answer — kept the old file"); process.exit(0); }
const next = JSON.stringify({ ind });
if (fs.existsSync(OUT) && JSON.stringify({ ind: old.ind }) === next && old.changed) { console.log("history unchanged"); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify({ changed: new Date(now).toISOString(), ind }));
console.log("history", Object.keys(ind).length, "indicators,", (fs.statSync(OUT).size / 1024).toFixed(0), "KB");
