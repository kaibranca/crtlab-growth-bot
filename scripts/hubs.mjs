// AFTER EACH RECAP (recap.yml): two page feeds for crtlab.pro, built from data the recap already bought — no extra data bill.
//   1. market hubs   data/recaps/markets/<ID>.json — the last 60 trading days of one market + rolling 20-day stats
//                    (site: /recap/<market> "Gold today", and the "Last 20 trading days" block on /statistics/<market>)
//   2. news days     data/events/<slug>.json + index.json — every high-impact USD release (CPI, NFP, FOMC, PCE, GDP…):
//                    how 12 markets moved in the first 15 / 60 minutes, from the 1-minute bars (site: /news/<slug>, /news/<type>)
//   node scripts/hubs.mjs
import fs from "node:fs";

// ── 1. market hubs ──
const files = fs.readdirSync("data/recaps").filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
const recs = files.map((f) => JSON.parse(fs.readFileSync(`data/recaps/${f}`, "utf8")));
const byMk = {};
for (const r of recs) for (const m of r.markets) (byMk[m.id] ??= []).push({ date: r.date, chg: m.chg, range: m.range, rel: m.rel, unit: m.unit, name: m.name, open: m.open, high: m.high, low: m.low, close: m.close,
  asiaFirst: m.asia?.first ?? null, asiaBoth: !!m.asia?.both, pdh: !!m.prevDay.highTaken, pdl: !!m.prevDay.lowTaken, crt: m.crt, story: m.story, headline: m.headline });
fs.mkdirSync("data/recaps/markets", { recursive: true });
const pct = (a, f) => (a.length ? Math.round((a.filter(f).length / a.length) * 100) : null);
for (const [id, rows] of Object.entries(byMk)) {
  const last = rows.slice(-20), withAsia = last.filter((x) => x.asiaFirst !== undefined);
  const stats = { days: last.length, from: last[0]?.date, to: last.at(-1)?.date,
    upDays: pct(last, (x) => x.chg > 0), avgRange: +(last.reduce((a, x) => a + x.range, 0) / (last.length || 1)).toFixed(2),
    asiaOneSide: pct(withAsia, (x) => x.asiaFirst != null), asiaBoth: pct(withAsia, (x) => x.asiaBoth), asiaNone: pct(withAsia, (x) => x.asiaFirst == null),
    pdh: pct(last, (x) => x.pdh), pdl: pct(last, (x) => x.pdl), pdBoth: pct(last, (x) => x.pdh && x.pdl), pdNone: pct(last, (x) => !x.pdh && !x.pdl),
    crt: last.filter((x) => x.crt).length, bigDays: last.filter((x) => (x.rel ?? 0) >= 150).length };
  fs.writeFileSync(`data/recaps/markets/${id}.json`, JSON.stringify({ id, name: rows.at(-1).name, unit: rows.at(-1).unit, updated: rows.at(-1).date, stats, days: rows.slice(-60).reverse() }));
}
console.log("hubs", Object.keys(byMk).length, "markets");

// ── 2. news days ──
// the calendar: ForexFactory's public weekly feed (this week + next), high-impact USD only, remembered across runs
const FAM = [[/CPI/i, "cpi", "CPI"], [/Non-Farm/i, "nfp", "NFP"], [/Federal Funds Rate|FOMC Statement/i, "fomc", "FOMC"], [/PCE/i, "pce", "PCE"], [/GDP/i, "gdp", "GDP"],
  [/PPI/i, "ppi", "PPI"], [/Retail Sales/i, "retail-sales", "Retail Sales"], [/ISM/i, "ism", "ISM"], [/JOLTS/i, "jolts", "JOLTS"], [/Unemployment Claims/i, "claims", "Jobless Claims"], [/Unemployment Rate|Average Hourly/i, "nfp", "NFP"]];
fs.mkdirSync("data/events", { recursive: true });
const calF = "data/events/calendar.json", cal = fs.existsSync(calF) ? JSON.parse(fs.readFileSync(calF, "utf8")) : [];
for (const u of ["https://nfs.faireconomy.media/ff_calendar_thisweek.json", "https://nfs.faireconomy.media/ff_calendar_nextweek.json"]) {
  try {
    const r = await fetch(u, { headers: { "user-agent": "crtlab-growth-bot" } }); if (!r.ok) { console.log("calendar", u, r.status); continue; }
    for (const e of await r.json()) {
      if (e.country !== "USD" || e.impact !== "High") continue;
      const f = FAM.find(([re]) => re.test(e.title)); if (!f || /Press Conference/i.test(e.title)) continue;
      const t = Math.floor(Date.parse(e.date) / 1000), key = `${t}|${e.title}`;
      if (!cal.some((x) => x.key === key)) cal.push({ key, t, title: e.title, fam: f[1], famName: f[2], forecast: e.forecast || null, previous: e.previous || null });
    }
  } catch (e) { console.log("calendar fail", String(e).slice(0, 120)); }
}
cal.sort((a, b) => a.t - b.t); fs.writeFileSync(calF, JSON.stringify(cal.filter((x) => x.t > Date.now() / 1000 - 400 * 86400), null, 1));

// New York date + the trading day a release belongs to
const NYF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ny = (t) => { const p = Object.fromEntries(NYF.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` }; };
// 1-minute bars: whatever the recap left in .cache (the nightly buy covers the whole New York day)
const INV = new Set(["USDJPY"]), barCache = {};
function bars(id) {
  if (barCache[id]) return barCache[id];
  const fs_ = fs.existsSync(".cache") ? fs.readdirSync(".cache").filter((f) => f.startsWith(id + "-")) : [];
  const m = new Map(); for (const f of fs_) for (const b of JSON.parse(fs.readFileSync(`.cache/${f}`, "utf8"))) m.set(b.t, INV.has(id) ? { t: b.t, o: 1 / b.o, h: 1 / b.l, l: 1 / b.h, c: 1 / b.c } : b);
  return (barCache[id] = [...m.values()].sort((a, b) => a.t - b.t));
}
// one release time → one page (GDP + Core PCE at 08:30 on the same morning are one event)
const groups = new Map(); for (const e of cal) { const g = groups.get(e.t) ?? []; g.push(e); groups.set(e.t, g); }
const idxF = "data/events/index.json", idx = fs.existsSync(idxF) ? JSON.parse(fs.readFileSync(idxF, "utf8")) : [];
const recapOf = (d) => recs.find((r) => r.date === d);
for (const [t, evs] of groups) {
  const { date, hm } = ny(t), fams = [...new Set(evs.map((e) => e.fam))], slug = `${fams.join("-")}-${date}`;
  if (idx.some((x) => x.slug === slug)) continue;
  const rec = recapOf(date); if (!rec) continue; // only once the day's recap (and its bars) exist
  const out = [];
  for (const m of rec.markets) {
    const B = bars(m.id), i0 = B.findIndex((b) => b.t >= t); if (i0 < 0 || B[i0].t - t > 120) continue;
    const at = (k) => B.find((b) => b.t >= t + k * 60) ?? null, p0 = B[i0].o, w = B.filter((b) => b.t >= t && b.t < t + 3600), pre = B.filter((b) => b.t >= t - 3600 && b.t < t);
    if (w.length < 30) continue;
    const b5 = at(5), b15 = at(15), b60 = at(59), hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
    const day = rec.markets.find((x) => x.id === m.id), avgRange = day.rel ? day.range / (day.rel / 100) : null, unitK = m.unit === "pips" ? (m.id === "USDJPY" ? 100 : 10000) : 1;
    const move = (b) => (b ? +(((b.c - p0) / p0) * 100).toFixed(3) : null);
    const swept = []; const pH = +day.prevDay.high, pL = +day.prevDay.low, aH = day.asia ? +day.asia.high : null, aL = day.asia ? +day.asia.low : null;
    const preHi = Math.max(-Infinity, ...B.filter((b) => b.t < t && b.t >= t - 86400).map((b) => b.h)), preLo = Math.min(Infinity, ...B.filter((b) => b.t < t && b.t >= t - 86400).map((b) => b.l));
    if (hi > pH && preHi <= pH) swept.push("yesterday's high"); if (lo < pL && preLo >= pL) swept.push("yesterday's low");
    if (aH != null && hi > aH && preHi <= aH) swept.push("the Asian high"); if (aL != null && lo < aL && preLo >= aL) swept.push("the Asian low");
    const m5 = move(b5), m60 = move(b60);
    out.push({ id: m.id, name: m.name, unit: m.unit, p0: +p0.toPrecision(8), m5, m15: move(b15), m60, upMax: +(((hi - p0) / p0) * 100).toFixed(3), dnMax: +(((lo - p0) / p0) * 100).toFixed(3),
      range60: +((hi - lo) * unitK).toFixed(2), ofDay: avgRange ? Math.round(((hi - lo) * unitK / avgRange) * 100) : null, preRange: pre.length ? +((Math.max(...pre.map((b) => b.h)) - Math.min(...pre.map((b) => b.l))) * unitK).toFixed(2) : null,
      reversed: m5 != null && m60 != null && Math.sign(m5) !== Math.sign(m60) && Math.abs(m60) > Math.abs(m5) * .5, swept, toClose: +(((+day.close - p0) / p0) * 100).toFixed(3),
      line: B.filter((b) => b.t >= t - 1800 && b.t < t + 5400).map((b) => +b.c.toPrecision(7)) });
  }
  if (out.length < 6) continue;
  out.sort((a, b) => (b.ofDay ?? 0) - (a.ofDay ?? 0));
  const top = out[0], fmt = (x) => (top.unit === "$" ? `$${x}` : `${x} ${top.unit}`), title = evs.map((e) => e.title).join(" · "), famName = [...new Set(evs.map((e) => e.famName))].join(" & ");
  const headline = `${famName}: ${top.name} moved ${fmt(top.range60)} in the first hour${top.ofDay ? ` — ${top.ofDay}% of a normal day` : ""}`;
  const ev = { slug, date, time: hm, t, fams, famName, title, releases: evs.map((e) => ({ title: e.title, forecast: e.forecast, previous: e.previous })), headline, markets: out };
  fs.writeFileSync(`data/events/${slug}.json`, JSON.stringify(ev));
  idx.push({ slug, date, time: hm, fams, famName, title, headline });
  console.log("news", slug, "·", headline);
}
idx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
