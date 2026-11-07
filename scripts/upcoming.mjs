// ECONOMIC CALENDAR (11-07) → data/events/upcoming.json, read by crtlab.pro/news (the calendar) and /news/<type> ("next CPI").
// Sources, both public, nothing billed, no CRTLAB backend: TradingView's economic calendar (the feed the chart's news tags
// use) and the Fed's own FOMC calendar (the whole year; TradingView lists a meeting only weeks before).
// Holds: every high + medium impact release for USD, EUR, GBP, JPY, AUD from 8 days back (with actuals) to 15 days ahead,
// plus the headline US releases (CPI, NFP, FOMC…) as far ahead as they are scheduled, plus `react`: how markets moved on
// each release type, measured from the bot's own news-day files. Rewritten ONLY when something really changed (a date, an
// actual landing): `changed` moves with it and is the site's lastmod, so it is never a fake "updated".
import fs from "node:fs";
const OUT = "data/events/upcoming.json";
const FAM = [ // US headline row per release type → its /news/<type> page
  [/^Inflation Rate YoY$/, "cpi", "CPI"], [/^Non Farm Payrolls$/, "nfp", "NFP"], [/^Core PCE Price Index MoM$/, "pce", "PCE"],
  [/^GDP Growth Rate QoQ/, "gdp", "GDP"], [/^PPI MoM$/, "ppi", "PPI"], [/^Retail Sales MoM$/, "retail-sales", "Retail Sales"],
  [/^ISM Manufacturing PMI$/, "ism", "ISM"], [/^ISM Services PMI$/, "ism", "ISM"], [/^JOLTs Job Openings$/, "jolts", "JOLTS"], [/^Initial Jobless Claims$/, "claims", "Jobless Claims"],
  [/^Fed Interest Rate Decision$/, "fomc", "FOMC"],
];
const COUNTRIES = "US,EU,GB,JP,AU";
const NYF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ny = (ms) => { const p = Object.fromEntries(NYF.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
// the way a release is quoted: "3.9%", "165K", "$87.1B", "A$3.5B"
const MONEY = new Set(["$", "€", "£", "¥", "A$"]);
const num = (x) => (typeof x !== "number" ? x : Math.abs(x) >= 1000 ? Math.round(x).toLocaleString("en-US") : Math.abs(x) >= 100 && !Number.isInteger(x) ? +x.toFixed(1) : +x.toFixed(3));
const fmt = (x, e) => (x == null || x === "" ? null : MONEY.has(e.unit) ? `${+x < 0 ? "-" : ""}${e.unit}${num(Math.abs(+x))}${e.scale ?? ""}` : `${num(x)}${e.unit && e.unit.length <= 2 ? e.unit : ""}${e.scale ?? ""}`);
// noise no trader acts on (ForexFactory hides most of it too)
const NOISE = /Auction|Bid-to-Cover|Allotted|Total Accepted|Truck Sales|Car Sales|Money Supply|Foreign Bond|Bond Investment|Stock Investment|Reserve Assets|Exchange Reserves|USDA|Pork|Baker Hughes|Rig Count|^MBA|Redbook|Cushing|Gasoline|Distillate|Refinery|Heating Oil|Natural Gas Stocks/i;
const DAY = 86400000, nowMs = Date.now(), FROM = nowMs - 8 * DAY, NEAR = nowMs + 15 * DAY, events = [];
const key = (e) => `${e.t}|${e.cur}|${e.title}`;

// 1. TradingView, one week per request (it answers at most 400 events)
let tvOk = 0;
for (let a = FROM; a < nowMs + 100 * DAY; a += 7 * DAY) {
  const near = a < NEAR;
  try {
    const r = await fetch(`https://economic-calendar.tradingview.com/events?from=${iso(a)}T00:00:00.000Z&to=${iso(a + 7 * DAY)}T00:00:00.000Z&countries=${near ? COUNTRIES : "US"}`, { headers: { origin: "https://www.tradingview.com", "user-agent": "Mozilla/5.0 (crtlab-growth-bot)" } });
    if (!r.ok) { console.log("tv", r.status); continue; }
    tvOk++;
    for (const e of (await r.json()).result ?? []) {
      const t = Date.parse(e.date); if (!(t >= FROM)) continue;
      const f = e.country === "US" ? FAM.find(([re]) => re.test(e.title)) : null;
      if (e.importance < 0 || NOISE.test(e.title) || (!near || t > NEAR) && !f) continue; // far ahead: headline US releases only
      const row = { t, ...ny(t), cur: e.currency, imp: e.importance === 1 ? 2 : 1, title: e.title, fam: f?.[1] ?? null, famName: f?.[2] ?? null,
        period: e.period ?? null, actual: fmt(e.actual, e), forecast: fmt(e.forecast, e), previous: fmt(e.previous, e) };
      if (!events.some((x) => key(x) === key(row))) events.push(row);
    }
  } catch (err) { console.log("tv fail", String(err).slice(0, 120)); }
  await new Promise((res) => setTimeout(res, 300));
}
// 2. The Fed: "<year> FOMC Meetings" panels, decision 14:00 New York on the meeting's last day ("*" = projections)
let fedOk = false;
try {
  const html = await (await fetch("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", { headers: { "user-agent": "Mozilla/5.0 (crtlab-growth-bot)" } })).text();
  const parts = html.split(/(\d{4}) FOMC Meetings/);
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  for (let i = 1; i < parts.length; i += 2) {
    const y = +parts[i];
    for (const m of parts[i + 1].matchAll(/fomc-meeting__month[^>]*><strong>([A-Za-z/]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g)) {
      const mon = m[1].split("/").pop(), days = m[2].trim(), last = +(days.match(/(\d+)\D*$/)?.[1] ?? 0), mi = MON.indexOf(mon);
      if (mi < 0 || !last || /notation vote|unscheduled/i.test(days)) continue;
      fedOk = true;
      const guess = Date.UTC(y, mi, last, 19), t = ny(guess).time === "14:00" ? guess : guess - 3600000; // 14:00 NY = 19:00/18:00 UTC
      if (t < FROM) continue;
      const tv = events.find((x) => x.fam === "fomc" && x.date === ny(t).date);
      if (tv) { tv.projections = days.includes("*"); continue; } // TradingView already has it (with forecast/actual)
      events.push({ t, ...ny(t), cur: "USD", imp: 2, title: "Fed Interest Rate Decision", fam: "fomc", famName: "FOMC", period: null, actual: null, forecast: null, previous: null, projections: days.includes("*") });
    }
  }
} catch (err) { console.log("fed fail", String(err).slice(0, 120)); }

// 2b. Bank holidays (Nager.Date, free public API): thin liquidity, early closes — ForexFactory shows them as their own rows
let holOk = false;
for (const [cc, cur] of [["US", "USD"], ["DE", "EUR"], ["GB", "GBP"], ["JP", "JPY"], ["AU", "AUD"]]) {
  for (const y of new Set([new Date(FROM).getUTCFullYear(), new Date(NEAR).getUTCFullYear()])) {
    try {
      const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`); if (!r.ok) continue; holOk = true;
      for (const h of await r.json()) {
        if (!h.global && cc !== "DE") continue; // national days only (Germany: the federal ones are global too)
        if (cc === "DE" && !h.global) continue;
        const t = Date.parse(h.date + "T12:00:00Z"); if (t < FROM || t > NEAR) continue;
        events.push({ t, date: h.date, time: "All day", cur, imp: 0, title: `Bank Holiday · ${h.name}`, fam: null, famName: null, period: null, actual: null, forecast: null, previous: null, holiday: true });
      }
    } catch {}
  }
}
// 3. How markets moved on each release type — the bot's own measured news days (scripts/hubs.mjs), newest 24 per type
const react = {};
const idx = fs.existsSync("data/events/index.json") ? JSON.parse(fs.readFileSync("data/events/index.json", "utf8")) : [];
for (const fam of new Set(idx.flatMap((x) => x.fams))) {
  const agg = {}; let n = 0;
  for (const x of idx.filter((x) => x.fams.includes(fam)).slice(0, 24)) {
    const f = `data/events/${x.slug}.json`; if (!fs.existsSync(f)) continue; n++;
    for (const m of JSON.parse(fs.readFileSync(f, "utf8")).markets) { if (m.ofDay == null) continue; const g = (agg[m.id] ??= { id: m.id, name: m.name, s: 0, k: 0, rev: 0 }); g.s += m.ofDay; g.k++; g.rev += m.reversed ? 1 : 0; }
  }
  if (n) react[fam] = { n, last: idx.find((x) => x.fams.includes(fam)).slug, rows: Object.values(agg).map((g) => ({ id: g.id, name: g.name, ofDay: Math.round(g.s / g.k), rev: g.rev, k: g.k })).sort((a, b) => b.ofDay - a.ofDay) };
}

events.sort((a, b) => a.t - b.t || b.imp - a.imp);
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
if (!tvOk && !fedOk) { console.log("no source answered — kept the old file"); process.exit(0); }
// a source that failed this run keeps its old rows, so one bad night never empties the calendar
const keep = (old?.events ?? []).filter((e) => e.t >= FROM && (e.title === "Fed Interest Rate Decision" && !e.forecast ? !fedOk : !tvOk));
const all = [...events, ...keep].sort((a, b) => a.t - b.t || b.imp - a.imp);
if (old && JSON.stringify(old.events) === JSON.stringify(all) && JSON.stringify(old.react) === JSON.stringify(react)) { console.log("calendar unchanged", all.length); process.exit(0); }
fs.mkdirSync("data/events", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ changed: new Date(nowMs).toISOString(), events: all, react }));
console.log("calendar", all.length, "events,", Object.keys(react).length, "reaction sets; next:", [...new Set(all.filter((e) => e.fam && e.t > nowMs).map((e) => e.fam))].map((f) => `${f} ${all.find((e) => e.fam === f && e.t > nowMs).date}`).join(", "));
