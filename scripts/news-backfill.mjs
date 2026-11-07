// NEWS ARCHIVE BACKFILL (one-off, run on Kai's Mac) — every CPI, NFP, FOMC, PCE and GDP release since mid-2016 as a
// news-day page, in exactly the format hubs.mjs writes for new releases, so the site renders them with no change.
//
//   events : crtlab.pro/api/econ-calendar (TradingView history: actual / forecast / previous)
//   bars   : CRTLAB's own 1-minute data from the local backtester (BARS=http://localhost:4010) — $0, never production
//
// Day context the nightly recap normally supplies (yesterday's high/low, the Asian range, the close, a normal day's range)
// is computed here from the same bars. Existing slugs are never overwritten. Usage: node scripts/news-backfill.mjs [fromYear]
import fs from "node:fs";
import { xfamTv, famMk } from "./fams.mjs";

const SITE = "https://crtlab.pro", BARS = process.env.BARS || "http://localhost:4010";
const FROM_YEAR = +(process.argv[2] || 2016);
const MK = [["XAUUSD", "Gold", "$"], ["XAGUSD", "Silver", "$"], ["USOIL", "Oil", "$"], ["NAS100", "NAS100", "pts"], ["SP500", "S&P 500", "pts"], ["US30", "US30", "pts"],
  ["EURUSD", "EURUSD", "pips"], ["GBPUSD", "GBPUSD", "pips"], ["USDJPY", "USDJPY", "pips"], ["AUDUSD", "AUDUSD", "pips"], ["BTCUSD", "Bitcoin", "$"], ["ETHUSD", "Ethereum", "$"]];
const FAM = [[/^(Core )?Inflation Rate (MoM|YoY)$|^CPI/i, "cpi", "CPI"], [/^Non Farm Payrolls$/i, "nfp", "NFP"], [/^Fed Interest Rate Decision$/i, "fomc", "FOMC"],
  [/PCE Price Index/i, "pce", "PCE"], [/^GDP Growth Rate/i, "gdp", "GDP"]];
// 11-07: the five families the live bot already tracks (hubs.mjs) but this backfill never measured, so /news/ppi etc. 404'd.
// TradingView rates them medium, so they match on exact title at any impact. Claims are weekly: from 2025 only.
const FAM2 = [[/^(Core )?PPI MoM$/i, "ppi", "PPI"], [/^Retail Sales (Ex Autos )?MoM$/i, "retail-sales", "Retail Sales"], [/^ISM (Manufacturing|Services) PMI$/i, "ism", "ISM"],
  [/^JOLTs Job Openings$/i, "jolts", "JOLTS"], [/^Initial Jobless Claims$/i, "claims", "Jobless Claims", Date.UTC(2025, 0, 1)]];

const NYF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ny = (t) => { const p = Object.fromEntries(NYF.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, h: +p.hour }; };
// the UTC second of a New York wall-clock time on a given date (DST-safe: search the two candidate offsets)
const nyTime = (date, hh) => { for (const off of [4, 5]) { const t = Date.parse(`${date}T${String(hh + off).padStart(2, "0")}:00:00Z`) / 1000; if (ny(t).h === hh && ny(t).date === date) return t; } return null; };
const getJ = async (u) => { for (let i = 0; i < 4; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { /* retry */ } await new Promise((r) => setTimeout(r, 800 * (i + 1))); } return null; };

// 1. the releases
const cal = [];
for (let y = FROM_YEAR; y <= 2026; y++) for (let m = 0; m < 12; m++) {
  const a = Date.UTC(y, m, 1), b = Date.UTC(y, m + 1, 1); if (a > Date.now()) break;
  const d = await getJ(`${SITE}/api/econ-calendar?from=${a}&to=${b}&countries=US,GB,EU,JP,AU`);
  for (const e of d?.events ?? []) {
    if (e.time > Date.now() - 2 * 86400e3) continue;
    const x = e.currency === "USD" ? null : xfamTv(e.currency, e.title);
    const f = e.currency === "USD" ? (e.impact === "high" && FAM.find(([re]) => re.test(e.title))) || FAM2.find(([re, , , from]) => re.test(e.title) && (!from || e.time >= from)) : x && [x.tv, x.fam, x.name]; if (!f) continue;
    cal.push({ t: Math.floor(e.time / 1000), title: e.title, fam: f[1], famName: f[2], actual: e.actual ?? null, forecast: e.forecast ?? null, previous: e.previous ?? null });
  }
  process.stdout.write(`\rcalendar ${y}-${String(m + 1).padStart(2, "0")} · ${cal.length} releases`);
}
console.log();
const groups = new Map(); for (const e of cal) { const g = groups.get(e.t) ?? []; if (!g.some((x) => x.title === e.title)) g.push(e); groups.set(e.t, g); }

// 2. daily bars per market (for "a normal day's range") — once
const daily = {};
for (const [id] of MK) { const d = await getJ(`${BARS}/candles?pair=${id.toLowerCase()}&tf=daily&limit=5000`); daily[id] = (d?.candles ?? []).map(([t, o, h, l, c]) => ({ t, h, l })); }

const idxF = "data/events/index.json", idx = fs.existsSync(idxF) ? JSON.parse(fs.readFileSync(idxF, "utf8")) : [];
const pr = (x) => +(+x).toPrecision(8);
let made = 0, skipped = 0;
for (const [t, evs] of [...groups].sort((a, b) => a[0] - b[0])) {
  const { date, hm } = ny(t), fams = [...new Set(evs.map((e) => e.fam))], slug = `${fams.join("-")}-${date}`;
  // a release time that already has a page (e.g. claims at 8:30 on a CPI day) keeps that page: no second page for the same hour
  if (idx.some((x) => x.slug === slug || (x.date === date && x.time === hm)) || fs.existsSync(`data/events/${slug}.json`)) { skipped++; continue; }
  const dayEnd = nyTime(date, 17), dayStart = dayEnd - 86400, prevStart = dayStart - 86400;
  const out = [];
  // the 12 markets' bars in parallel (was one at a time: ~12 round trips per release)
  const got = await Promise.all(MK.map(([id]) => getJ(`${BARS}/candles?pair=${id.toLowerCase()}&tf=1min&from=${prevStart}&to=${dayEnd}&limit=5000`)));
  for (const [k, [id, name, unit]] of MK.entries()) {
    const d = got[k];
    const B = (d?.candles ?? []).map(([bt, o, h, l, c]) => ({ t: bt, o, h, l, c }));
    const i0 = B.findIndex((b) => b.t >= t); if (i0 < 0 || B[i0].t - t > 120) continue;
    const w = B.filter((b) => b.t >= t && b.t < t + 3600), pre = B.filter((b) => b.t >= t - 3600 && b.t < t);
    if (w.length < 30) continue;
    const prev = B.filter((b) => b.t >= prevStart && b.t < dayStart), today = B.filter((b) => b.t >= dayStart && b.t < dayEnd);
    if (!prev.length || !today.length) continue;
    const asia = B.filter((b) => b.t >= dayStart + 7200 && b.t < dayStart + 7 * 3600); // 19:00–00:00 New York, the evening before
    const at = (k) => B.find((b) => b.t >= t + k * 60) ?? null, p0 = B[i0].o, hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
    const unitK = unit === "pips" ? (id === "USDJPY" ? 100 : 10000) : 1;
    const dr = daily[id].filter((x) => x.t < dayStart).slice(-20), avgRange = dr.length >= 10 ? (dr.reduce((s, x) => s + (x.h - x.l), 0) / dr.length) * unitK : null;
    const move = (b) => (b ? +(((b.c - p0) / p0) * 100).toFixed(3) : null);
    const pH = Math.max(...prev.map((b) => b.h)), pL = Math.min(...prev.map((b) => b.l)), aH = asia.length ? Math.max(...asia.map((b) => b.h)) : null, aL = asia.length ? Math.min(...asia.map((b) => b.l)) : null;
    const before = B.filter((b) => b.t < t && b.t >= t - 86400), preHi = Math.max(-Infinity, ...before.map((b) => b.h)), preLo = Math.min(Infinity, ...before.map((b) => b.l));
    const swept = [];
    if (hi > pH && preHi <= pH) swept.push("yesterday's high"); if (lo < pL && preLo >= pL) swept.push("yesterday's low");
    if (aH != null && hi > aH && preHi <= aH) swept.push("the Asian high"); if (aL != null && lo < aL && preLo >= aL) swept.push("the Asian low");
    const m5 = move(at(5)), m60 = move(at(59)), close = today[today.length - 1].c;
    out.push({ id, name, unit, p0: pr(p0), m5, m15: move(at(15)), m60, upMax: +(((hi - p0) / p0) * 100).toFixed(3), dnMax: +(((lo - p0) / p0) * 100).toFixed(3),
      range60: +((hi - lo) * unitK).toFixed(2), ofDay: avgRange ? Math.round((((hi - lo) * unitK) / avgRange) * 100) : null,
      preRange: pre.length ? +((Math.max(...pre.map((b) => b.h)) - Math.min(...pre.map((b) => b.l))) * unitK).toFixed(2) : null,
      reversed: m5 != null && m60 != null && Math.sign(m5) !== Math.sign(m60) && Math.abs(m60) > Math.abs(m5) * 0.5, swept, toClose: +(((close - p0) / p0) * 100).toFixed(3),
      line: B.filter((b) => b.t >= t - 1800 && b.t < t + 5400).map((b) => +b.c.toPrecision(7)) });
  }
  if (out.length < 6) { skipped++; continue; }
  out.sort((a, b) => (b.ofDay ?? 0) - (a.ofDay ?? 0));
  const mk = famMk(fams), top = out.find((m) => m.id === mk) ?? out[0], fmt = (x) => (top.unit === "$" ? `$${x}` : `${x} ${top.unit}`), title = evs.map((e) => e.title).join(" · "), famName = [...new Set(evs.map((e) => e.famName))].join(" & ");
  const headline = `${famName}: ${top.name} moved ${fmt(top.range60)} in the first hour${top.ofDay ? ` — ${top.ofDay}% of a normal day` : ""}`;
  const ev = { slug, date, time: hm, t, fams, famName, title, releases: evs.map((e) => ({ title: e.title, actual: e.actual, forecast: e.forecast, previous: e.previous })), headline, markets: out };
  fs.writeFileSync(`data/events/${slug}.json`, JSON.stringify(ev));
  idx.push({ slug, date, time: hm, fams, famName, title, headline });
  made++; process.stdout.write(`\r${made} made · ${skipped} skipped · ${slug}            `);
}
idx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
fs.writeFileSync(idxF, JSON.stringify(idx, null, 1));
console.log(`\ndone: ${made} new news days, ${skipped} skipped, index ${idx.length}`);
