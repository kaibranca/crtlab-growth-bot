// STORY DETECTORS — every reel is a real setup that printed in the 1-minute data. Nothing invented, every number from the bars.
// One schema for the renderer (src/tl.mjs):
//   { model, mk, name, date, wd, tf, dp, unit, bars:[{t,lab,o,h,l,c,p:[[h,l,c]…]}], kb, keyMin, level, levelLabel,
//     zone?{top,bot,i0,i1,label}, liq?[{i,price}], bos?{price,i0,i1}, trade?{side,entry,stop,target,iE,jE,iX,jX,R}, measure?{from,to,i0,i1},
//     rel, score }
// Models: ob · fvg · crt · asia · break · news · nyopen
import fs from "node:fs";
export const BOT = process.env.BOT_DIR || new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ICONS = new Set(fs.readdirSync(new URL("../public/m/", import.meta.url)).map((f) => f.replace(".webp", "")));
const NYF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
export const ny = (t) => { const p = Object.fromEntries(NYF.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute, wd: p.weekday }; };
export const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const tday = (t) => { const n = ny(t); return n.h >= 18 ? addDays(n.date, 1) : n.date; };
const lab = (t) => { const n = ny(t); return `${String(n.h).padStart(2, "0")}:${String(n.m).padStart(2, "0")}`; };
const WD = (D) => new Date(D + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

const cache = new Map();
export function load(mk) {
  if (cache.has(mk)) return cache.get(mk);
  const dir = BOT + "/.cache/"; if (!fs.existsSync(dir)) return null;
  // several overlapping pulls can sit in the cache: merge them, newest wins
  const files = fs.readdirSync(dir).filter((x) => x.startsWith(mk + "-") && x.endsWith(".json")).sort(), m = new Map();
  for (const f of files) for (const b of JSON.parse(fs.readFileSync(dir + f, "utf8"))) m.set(b.t, b);
  let raw = files.length ? [...m.values()].sort((a, b) => a.t - b.t) : null;
  // the cache holds raw futures: 6J is JPY per USD inverted (same inversion as scripts/recap.mjs)
  if (raw && mk === "USDJPY" && raw[0].c < 1) raw = raw.map((b) => ({ t: b.t, o: 1 / b.o, h: 1 / b.l, l: 1 / b.h, c: 1 / b.c }));
  cache.set(mk, raw); return raw;
}
function agg(min, TF) {
  const a = new Map();
  for (const b of min) { const k = Math.floor(b.t / (TF * 60)) * TF * 60, x = a.get(k);
    if (!x) a.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, m: [b] }); else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.m.push(b); } }
  return [...a.values()].sort((p, q) => p.t - q.t);
}
const dayMin = (raw, D) => raw.filter((b) => tday(b.t) === D && ny(b.t).h !== 17);
// first minute at/after (i, j) that trades through a price → [bar, minute] or null
function touch(bars, i0, j0, price, dir) {
  for (let i = i0; i < bars.length; i++) for (let j = i === i0 ? j0 : 0; j < bars[i].m.length; j++) { const m = bars[i].m[j]; if (dir === "down" ? m.l <= price : m.h >= price) return [i, j]; }
  return null;
}
// walk a trade minute by minute from the entry: whichever of stop / target trades first. Same-minute both → counted as a loss.
function walk(bars, iE, jE, side, stop, target) {
  for (let i = iE; i < bars.length; i++) for (let j = i === iE ? jE + 1 : 0; j < bars[i].m.length; j++) { const m = bars[i].m[j];
    const sl = side === "long" ? m.l <= stop : m.h >= stop, tp = side === "long" ? m.h >= target : m.l <= target;
    if (sl) return { hit: "sl", i, j }; if (tp) return { hit: "tp", i, j }; }
  return null;
}
const dpOf = (mk, unit) => (unit === "pips" ? (mk.includes("JPY") ? 3 : 5) : mk === "US30" ? 0 : 2);
// crop a window of bars for the picture and re-index every pointer in the story
function crop(s, a, b) {
  const sh = (i) => (i == null ? i : i - a);
  s.bars = s.bars.slice(a, b + 1); s.kb = sh(s.kb);
  if (s.zone) { s.zone.i0 = sh(s.zone.i0); s.zone.i1 = s.zone.i1 == null ? null : sh(s.zone.i1); }
  if (s.bos) { s.bos.i0 = sh(s.bos.i0); s.bos.i1 = sh(s.bos.i1); }
  if (s.liq) s.liq = s.liq.map((x) => ({ ...x, i: sh(x.i) }));
  if (s.trade) Object.assign(s.trade, { iE: sh(s.trade.iE), iX: sh(s.trade.iX) });
  if (s.measure) Object.assign(s.measure, { i0: sh(s.measure.i0), i1: sh(s.measure.i1) });
  if (s.ext != null) s.ext = sh(s.ext);
  return s;
}

// ── models ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// a 2R trade off a zone (FVG or OB): first touch = entry, stop just past the zone, target 2R, must win, must be quick
function zoneTrade(bars, zone, side, from, maxBars = 18) {
  const entry = side === "long" ? zone.top : zone.bot, size = zone.top - zone.bot, stop = side === "long" ? zone.bot - size * .12 : zone.top + size * .12;
  const e = touch(bars, from, 0, entry, side === "long" ? "down" : "up"); if (!e || e[0] - from > 14) return null;
  // the zone must still be untouched until that touch: no close beyond the far side before
  for (let i = from; i < e[0]; i++) if (side === "long" ? bars[i].c < zone.bot : bars[i].c > zone.top) return null;
  const risk = Math.abs(entry - stop), target = side === "long" ? entry + 2 * risk : entry - 2 * risk, w = walk(bars, e[0], e[1], side, stop, target);
  if (!w || w.hit !== "tp" || w.i - e[0] > maxBars) return null;
  // how far it really ran from the entry before the stop or the day ran out (used for score, not the picture)
  let run = 0; for (let i = e[0]; i < Math.min(bars.length, w.i + 12); i++) run = Math.max(run, side === "long" ? bars[i].h - entry : entry - bars[i].l);
  return { side, entry, stop, target, iE: e[0], jE: e[1], iX: w.i, jX: w.j, R: 2, run: run / risk };
}

function fvg(bars, base, range) {
  const out = [];
  for (let i = 1; i < bars.length - 3; i++) {
    const a = bars[i - 1], b = bars[i], c = bars[i + 1];
    for (const side of ["long", "short"]) {
      const top = side === "long" ? c.l : a.l, bot = side === "long" ? a.h : c.h, gap = top - bot;
      if (gap <= range * .06 || gap > range * .35) continue;
      if (side === "long" ? b.c <= b.o : b.c >= b.o) continue; // the middle candle drives the gap
      const zone = { top, bot, i0: i - 1, label: "FVG" }, tr = zoneTrade(bars, zone, side, i + 2);
      if (!tr) continue;
      zone.i1 = tr.iX;
      out.push({ ...base, model: "fvg", zone, trade: tr, kb: tr.iE, keyMin: tr.jE, level: tr.entry, levelLabel: "FVG", win: [i - 9, tr.iX + 4],
        score: 2 + Math.min(3, tr.run) * .4 + base.rel / 120 + (gap / range) * 2 });
    }
  }
  return out;
}

function ob(bars, base, range) {
  const out = [];
  for (let k = 8; k < bars.length - 6; k++) {
    for (const side of ["long", "short"]) {
      const o = bars[k]; if (side === "long" ? o.c >= o.o : o.c <= o.o) continue; // the last opposite candle
      const prev = bars.slice(k - 8, k), swing = side === "long" ? Math.max(...prev.map((b) => b.h)) : Math.min(...prev.map((b) => b.l));
      const si = k - 8 + prev.findIndex((b) => (side === "long" ? b.h : b.l) === swing);
      let bi = -1; for (let i = k + 1; i <= k + 3 && i < bars.length; i++) if (side === "long" ? bars[i].c > swing : bars[i].c < swing) { bi = i; break; }
      if (bi < 0) continue;
      const zone = { top: o.h, bot: o.l, i0: k, label: "OB" }, size = zone.top - zone.bot;
      if (size < range * .05 || size > range * .3) continue;
      // price has to leave first: at least 2 bars away before it comes back
      const tr = zoneTrade(bars, zone, side, bi + 2); if (!tr) continue;
      zone.i1 = tr.iX;
      // liquidity: the pullback's swing points on the way back to the OB (stops resting there get taken first)
      const liq = [];
      for (let i = bi + 1; i < tr.iE; i++) { const b = bars[i], L = bars[i - 1], R = bars[i + 1]; if (!R) break;
        const gap = size * .35; // clearly away from the zone, so the $ never sits on the shade
        if (side === "long" ? b.l < L.l && b.l <= R.l && b.l > zone.top + gap : b.h > L.h && b.h >= R.h && b.h < zone.bot - gap) liq.push({ i, price: side === "long" ? b.l : b.h }); }
      out.push({ ...base, model: "ob", zone, trade: tr, bos: { price: swing, i0: si, i1: bi }, liq: liq.slice(-3), kb: tr.iE, keyMin: tr.jE, level: tr.entry, levelLabel: "OB",
        win: [k - 9, tr.iX + 4], score: 2.2 + Math.min(3, tr.run) * .4 + base.rel / 120 + liq.length * .25 });
    }
  }
  return out;
}

// the old day stories (asia / crt / break): the whole day on 15m, a measured move
function dayStories(bars, pb, base, r) {
  const out = [], hi = Math.max(...bars.map((b) => b.h)), lo = Math.min(...bars.map((b) => b.l)), dn = bars.at(-1).c < bars[0].o, cr = (i0, lv, side) => touch(bars, i0, 0, lv, side === "low" ? "down" : "up");
  const ai = bars.map((b, i) => (ny(b.t).h >= 20 && ny(b.t).h < 24 ? i : -1)).filter((i) => i >= 0);
  if (ai.length >= 12 && r.rel >= 140) {
    const a0 = ai[0], a1 = ai.at(-1), aH = Math.max(...ai.map((i) => bars[i].h)), aL = Math.min(...ai.map((i) => bars[i].l));
    const side = dn ? "low" : "high", k = cr(a1 + 1, dn ? aL : aH, side), other = cr(a1 + 1, dn ? aH : aL, dn ? "high" : "low");
    const ext = dn ? bars.findIndex((b) => b.l === lo) : bars.findIndex((b) => b.h === hi);
    if (k && !other && ext > k[0]) out.push({ ...base, model: "asia", side, level: dn ? aL : aH, levelLabel: dn ? "Asia low" : "Asia high", zone: { top: aH, bot: aL, i0: a0, i1: a1, label: "Asia" },
      kb: k[0], keyMin: k[1], ext, measure: { from: dn ? aL : aH, to: dn ? lo : hi, i0: k[0], i1: ext }, score: r.rel / 100 + Math.abs(r.chg) * 1.5 + 1 });
  }
  if (pb?.length >= 20) {
    const pH = Math.max(...pb.map((b) => b.h)), pL = Math.min(...pb.map((b) => b.l));
    if (r.crt && r.rel >= 80) {
      const bull = r.crt === "bullish", level = bull ? pL : pH, k = cr(0, level, bull ? "low" : "high"), other = cr(0, bull ? pH : pL, bull ? "high" : "low");
      const ext = bull ? bars.findIndex((b) => b.l === lo) : bars.findIndex((b) => b.h === hi), beyond = (b) => (bull ? b.c < level : b.c > level);
      const back = k && bars.slice(k[0], k[0] + 7).some((b) => !beyond(b)), stay = k ? bars.slice(k[0]).filter(beyond).length : 99, close = bars.at(-1).c;
      if (k && !other && back && stay <= 6 && Math.abs(close - level) / (hi - lo) > .25 && k[0] >= 2 && ext >= k[0] && ext - k[0] <= 10 && ext < bars.length - 12)
        out.push({ ...base, model: "crt", side: bull ? "low" : "high", level, levelLabel: bull ? "PDL" : "PDH", kb: k[0], keyMin: k[1], ext,
          measure: { from: bull ? lo : hi, to: close, i0: ext, i1: bars.length - 1 }, score: r.rel / 100 + Math.abs(close - (bull ? lo : hi)) / (hi - lo) * 2 + .9 });
    }
    if (r.rel >= 100) {
      const up = !dn, level = up ? pH : pL, k = cr(0, level, up ? "high" : "low"), other = cr(0, up ? pL : pH, up ? "low" : "high");
      const ext = up ? bars.findIndex((b) => b.h === hi) : bars.findIndex((b) => b.l === lo), close = bars.at(-1).c;
      const inside = k ? bars.slice(k[0] + 1).filter((b) => (up ? b.c < level : b.c > level)).length : 99;
      if (k && !other && k[0] >= 3 && inside <= 3 && (up ? close > level : close < level) && ext > k[0] + 3)
        out.push({ ...base, model: "break", side: up ? "high" : "low", level, levelLabel: up ? "PDH" : "PDL", kb: k[0], keyMin: k[1], ext,
          measure: { from: level, to: up ? hi : lo, i0: k[0], i1: ext }, score: r.rel / 100 + Math.abs((up ? hi : lo) - level) / (hi - lo) * 2 + .7 });
    }
  }
  return out;
}

// New York open: the first 15 minutes set a range, one side breaks, the other never does, and it runs
function nyopen(min, base) {
  const day = min.filter((b) => { const n = ny(b.t); return n.h * 60 + n.m >= 8 * 60 + 30 && n.h * 60 + n.m < 12 * 60; });
  if (day.length < 150) return [];
  const bars = agg(day, 5), orb = bars.filter((b) => { const n = ny(b.t); return n.h === 9 && n.m >= 30 && n.m < 45; });
  if (orb.length !== 3) return [];
  const i0 = bars.indexOf(orb[0]), i1 = i0 + 2, H = Math.max(...orb.map((b) => b.h)), L = Math.min(...orb.map((b) => b.l)), w = H - L;
  const up = touch(bars, i1 + 1, 0, H + 1e-9, "up"), dn = touch(bars, i1 + 1, 0, L - 1e-9, "down");
  const first = up && (!dn || up[0] < dn[0] || (up[0] === dn[0] && up[1] < dn[1])) ? "high" : dn ? "low" : null; if (!first) return [];
  const k = first === "high" ? up : dn, other = first === "high" ? dn : up, rest = bars.slice(k[0]);
  const exV = first === "high" ? Math.max(...rest.map((b) => b.h)) : Math.min(...rest.map((b) => b.l)), ext = k[0] + rest.findIndex((b) => (first === "high" ? b.h : b.l) === exV);
  if (other && other[0] <= ext) return [];
  const run = Math.abs(exV - (first === "high" ? H : L)); if (run < w * 1.5) return [];
  return [{ ...base, model: "nyopen", tf: "5m", bars, side: first, level: first === "high" ? H : L, levelLabel: first === "high" ? "OR high" : "OR low",
    zone: { top: H, bot: L, i0, i1, label: "9:30–9:45" }, kb: k[0], keyMin: k[1], ext, measure: { from: first === "high" ? H : L, to: exV, i0: k[0], i1: ext },
    score: 1.6 + Math.min(4, run / w) * .35 }];
}

// a high-impact release: the minute it printed and the first hour after
function news(raw, D, base, ev) {
  const m = ev.markets?.find((x) => x.id === base.mk); if (!m || (m.ofDay ?? 0) < 30) return [];
  const t0 = ev.t, win = raw.filter((b) => b.t >= t0 - 45 * 60 && b.t < t0 + 75 * 60); if (win.length < 90) return [];
  const bars = agg(win, 3), kb = bars.findIndex((b) => b.t <= t0 && b.t + 180 > t0); if (kb < 5) return [];
  const p0 = bars[kb].o, after = bars.slice(kb, kb + 20), up = after.reduce((s, b) => Math.max(s, b.h), -Infinity) - p0, dn = p0 - after.reduce((s, b) => Math.min(s, b.l), Infinity);
  const side = up >= dn ? "high" : "low", exV = side === "high" ? p0 + up : p0 - dn, ext = kb + after.findIndex((b) => (side === "high" ? b.h : b.l) === exV);
  const short = { "us-cpi": "CPI", "us-nfp": "NFP", "us-fomc": "FOMC", "us-pce": "PCE", "us-gdp": "GDP", "us-ppi": "PPI", "us-retail": "Retail Sales" }[ev.fams?.[0]] || ev.famName?.replace(/^US /, "") || "News";
  return [{ ...base, model: "news", tf: "3m", bars, side, level: p0, levelLabel: short, event: { name: short, title: ev.title, time: ev.time, actual: ev.releases?.[0]?.actual, forecast: ev.releases?.[0]?.forecast },
    kb, keyMin: 0, ext, measure: { from: p0, to: exV, i0: kb, i1: ext }, ofDay: m.ofDay, score: 1.5 + m.ofDay / 40 + (ev.fams?.some((f) => /cpi|nfp|fomc/.test(f)) ? 1 : 0) }];
}

// ── all candidates for one New York day ─────────────────────────────────────────────────────────────────────────────────
export function candidates(D) {
  const f = `${BOT}/data/recaps/${D}.json`; if (!fs.existsSync(f)) return [];
  const rec = JSON.parse(fs.readFileSync(f, "utf8")), out = [];
  const evs = fs.existsSync(`${BOT}/data/events`) ? fs.readdirSync(`${BOT}/data/events`).filter((x) => x.endsWith(`-${D}.json`)).map((x) => JSON.parse(fs.readFileSync(`${BOT}/data/events/${x}`, "utf8"))) : [];
  for (const r of rec.markets) {
    if (!ICONS.has(r.id) || r.rel == null) continue;
    const raw = load(r.id); if (!raw) continue;
    const min = dayMin(raw, D); if (min.length < 600) continue;
    const unit = r.unit, base = { mk: r.id, name: r.name, date: D, wd: WD(D), unit, dp: dpOf(r.id, unit), rel: r.rel, chg: r.chg };
    const b15 = agg(min, 15), range = Math.max(...b15.map((b) => b.h)) - Math.min(...b15.map((b) => b.l));
    const prevD = [...new Set(raw.map((b) => tday(b.t)))].filter((d) => d < D).sort().pop(), pb = prevD && agg(dayMin(raw, prevD), 15);
    for (const s of dayStories(b15, pb, base, r)) out.push({ ...base, ...s, tf: "15m", bars: b15 });
    // zone models on 5m in the active hours (02:00–12:00 NY): tighter, cleaner setups
    const act = min.filter((b) => { const h = ny(b.t).h; return h >= 2 && h < 12; }), b5 = agg(act, 5), r5 = act.length ? Math.max(...act.map((b) => b.h)) - Math.min(...act.map((b) => b.l)) : 0;
    if (b5.length > 40) for (const s of [...fvg(b5, { ...base, tf: "5m" }, r5), ...ob(b5, { ...base, tf: "5m" }, r5)]) { s.bars = b5; out.push(s); }
    if (["NAS100", "SP500", "US30", "XAUUSD"].includes(r.id)) out.push(...nyopen(min, base));
    for (const ev of evs) out.push(...news(raw, D, base, ev));
  }
  // windowed models: crop to the setup (about 30–40 candles reads best on a phone)
  for (const s of out) if (s.win) { const a = Math.max(0, s.win[0]), b = Math.min(s.bars.length - 1, s.win[1]); delete s.win; crop(s, a, b); }
  // day stories on 15m keep the whole day; long news/nyopen windows are fine as built
  return out.filter((s) => s.bars.length >= 18 && s.bars.length <= 100).map(finish);
}

function finish(s) {
  s.bars = s.bars.map(({ t, o, h, l, c, m }) => ({ t, lab: lab(t), o, h, l, c, p: m.map((x) => [x.h, x.l, x.c]) }));
  s.id = `${s.date}|${s.mk}|${s.model}|${s.kb}`;
  return s;
}

export const recapDays = () => fs.readdirSync(`${BOT}/data/recaps`).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
