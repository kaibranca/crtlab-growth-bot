// REEL LAYOUT + TIMELINE (v3: lessons) — a story (engine/stories.mjs) + a lesson (engine/lesson.mjs: steps) + a look → every beat.
// Picture (Reel.jsx), sound (engine/mix.mjs) and QA (engine/qa.mjs) all read this file, so they can never drift apart.
//
// SAFE ZONES (1080×1920, IG + FB Reels UI): nothing above y 250, nothing below y 1500, nothing right of x 960 below y 900.
export const FPS = 60, W = 1080, H = 1920;
export const SAFE = { top: 250, bottom: 1500, right: 960, rightFrom: 900, left: 64 };
// v6 (11-09): taller chart, no time axis, one fixed caption line under the chart, symbol top-left like TradingView
export const L = { title: 330, sym: 438, PT: 512, PB: 1262, PL: 64, PR: 846, axisX: 860, cap: 1300, brand: 1440 };
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const EIO = (t) => { t = cl(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const OUT = (t) => 1 - Math.pow(1 - cl(t), 4);
export const SMOOTH = (t) => { t = cl(t); return t * t * t * (t * (t * 6 - 15) + 10); }; // camera: zero velocity AND acceleration at both ends

export function build(d) {
  const pace = d.look?.pace === "long" ? 1.12 : 1, N = d.bars.length, steps = d.lesson.steps;
  // bad-tick wicks (a lone spike many times a normal candle) would squash the whole chart: cap them at 4× the median range
  const med = [...d.bars].map((b) => b.h - b.l).sort((a, b) => a - b)[Math.floor(d.bars.length / 2)] || 0;
  const B = d.bars.map((b) => { const top = Math.max(b.o, b.c), bot = Math.min(b.o, b.c), cap = med * 4; return b.h - top > cap || bot - b.l > cap ? { ...b, h: Math.min(b.h, top + cap), l: Math.max(b.l, bot - cap) } : b; });
  const lv = [...B.map((b) => b.h), ...B.map((b) => b.l), d.level];
  if (d.trade) lv.push(d.trade.stop, d.trade.target); if (d.zone) lv.push(d.zone.top, d.zone.bot); if (d.measure) lv.push(d.measure.from, d.measure.to);
  const mx = Math.max(...lv), mn = Math.min(...lv), sp = mx - mn || 1, HI = mx + sp * .1, LO = mn - sp * .1;
  const BW = (L.PR - L.PL) / (N + 1.6), X = (i) => L.PL + BW * (i + .8), Y = (v) => L.PT + (HI - v) / (HI - LO) * (L.PB - L.PT);
  const cw = Math.min(26, Math.max(3, BW * .66));

  // walk the lesson: replay bars up to each step, then the step's annotation + caption, then hold so it can be read
  const sch = [], beats = []; let t = .55, cur = -1; // candles start once the intro has fallen into place
  for (const [si, st] of steps.entries()) {
    const ts = t, to = Math.min(N - 1, st.to ?? cur), n = to - cur; // ts = when this step's candles start drawing
    if (n > 0) {
      const slowLast = st.slow ? 1 : 0, fastN = n - slowLast, v = Math.min(.1, 2.8 / Math.max(1, fastN)) * pace;
      for (let i = cur + 1; i <= to - slowLast; i++) { sch[i] = [t, t + v - .004]; t += v; }
      if (slowLast) { const kd = 1.25 * pace; sch[to] = [t + .12, t + .12 + kd]; t += .12 + kd; }
      cur = to;
    }
    const words = (st.cap || "").split(" ").length, hold = (st.hold ? Math.min(st.hold, 1.8) : Math.max(1.25, .7 + words * .16)) * pace; // tight: every second earns its place
    beats.push({ ...st, i: si, ts, t: t + .1, end: t + .1 + hold, to: cur });
    t += .1 + hold;
  }
  // the key minute inside the slow bar (the entry tap / the sweep / the break), for the hit sound + marker
  const kbS = sch[d.kb], tCross = kbS ? kbS[0] + (kbS[1] - kbS[0]) * touchQ(B[d.kb], d.level) : beats[0].t;
  const tPay = d.trade && sch[d.trade.iX] ? sch[d.trade.iX][0] + (sch[d.trade.iX][1] - sch[d.trade.iX][0]) * touchQ(B[d.trade.iX], d.trade.target) : null;
  const last = cur, tEnd0 = t;
  // camera states: each beat may focus a region (bars i0..i1 + prices) → ease there; the final beats ease back to the full chart
  // RULE (Kai 11-09): candles NEVER leave the screen. The camera starts easing BEFORE a step's candles draw, and every framing
  // holds every candle printed up to that step (focus window stretched to b.to), so nothing forms off-screen or gets cropped.
  const cams = beats.map((b) => ({ t: Math.max(.3, b.ts - .2), f: b.focus || null, to: b.to }));
  // the end: dim, type the domain, show the result row, fade back to the empty chart = frame 0
  const T = { tCross, tPay, last, dim: tEnd0 + .15 };
  const k0 = T.dim + .5, KEY = .1; T.keys = [...Array(10)].map((_, i) => [k0 + i * KEY, i + 1]);
  T.typed = T.keys.at(-1)[0]; T.row = T.typed + .2; T.ptr = T.row + .25; T.click = T.ptr + .85; T.out = T.click + .1; T.end = T.out + .55;
  const DUR = Math.ceil((T.end + .03) * FPS);
  return { N, B, HI, LO, BW, cw, X, Y, sch, T, beats, cams, DUR, pace };
}

// camera at time t → { s, cx, cy } (world point cx,cy is drawn at the plot centre, scaled by s). s = 1 → the whole chart.
export function camera(G, t) {
  const PCX = (L.PL + L.PR) / 2, PCY = (L.PT + L.PB) / 2, full = { s: 1, cx: PCX, cy: PCY };
  const state = (f, to) => {
    if (!f) return full;
    f = [0, Math.max(f[1], to ?? f[1]), f[2], f[3]]; // from the FIRST candle: nothing already printed may slide off-screen
    // the focus always holds every candle in its window (never crop a wick) plus the prices the step talks about
    let hi = Math.max(f[2], f[3]), lo = Math.min(f[2], f[3]);
    for (let i = f[0]; i <= f[1]; i++) { hi = Math.max(hi, G.B[i].h); lo = Math.min(lo, G.B[i].l); }
    const pad = (hi - lo) * .14, x0 = G.X(f[0]) - G.BW * 1.2, x1 = G.X(f[1]) + G.BW * 1.6, y0 = G.Y(hi + pad), y1 = G.Y(lo - pad);
    const s = cl(Math.min((L.PR - L.PL) / ((x1 - x0) * 1.25), (L.PB - L.PT) / ((y1 - y0) * 1.1)) * .95, 1, 1.7); // 5% margin: never touch the edge
    // keep the view inside the chart: no empty margins past the first/last candle or the price range
    const hw = (L.PR - L.PL) / 2 / s, hh = (L.PB - L.PT) / 2 / s;
    return { s, cx: cl((x0 + x1) / 2, L.PL + hw, L.PR - hw), cy: cl((y0 + y1) / 2, L.PT + hh, L.PB - hh) };
  };
  let a = full, b = full, k = 1;
  const cs = [...G.cams, { t: G.T.dim - .9, f: null }];
  for (let i = 0; i < cs.length; i++) if (t >= cs[i].t) { a = i ? state(cs[i - 1].f, cs[i - 1].to) : full; b = state(cs[i].f, cs[i].to); k = SMOOTH((t - cs[i].t) / .95); }
  return { s: a.s + (b.s - a.s) * k, cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k };
}

// ONE-WAY formation (the style approved on the FVG reel): the wick that printed first (from the real minutes) reaches out
// while the body waits at the open; then the body grows straight to its close — never reversing — and the other wick follows.
// Calm, no flicker, no back-and-forth. At q = 1 it is exactly the real OHLC.
const SM = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const firstLow = (b) => { let mh = 0, ml = 0; b.p.forEach((m, k) => { if (m[0] > b.p[mh][0]) mh = k; if (m[1] < b.p[ml][1]) ml = k; }); return ml < mh; };
export function partial(b, q) {
  if (q <= 0) return null; if (q >= 1) return [b.o, b.h, b.l, b.c];
  const P1 = .36, fl = firstLow(b), a = SM(q / P1), body = SM((q - P1) / (1 - P1));
  const c = b.o + (b.c - b.o) * body;
  let h = b.o, l = b.o;
  if (fl) { l = b.o + (b.l - b.o) * a; h = b.o + (b.h - b.o) * body; } else { h = b.o + (b.h - b.o) * a; l = b.o + (b.l - b.o) * body; }
  return [b.o, Math.max(h, c, b.o), Math.min(l, c, b.o), c];
}
// the moment a forming candle first touches a price (for the tap / sweep / break cue)
export function touchQ(b, price) { for (let i = 1; i <= 200; i++) { const x = partial(b, i / 200); if (x && x[2] <= price && x[1] >= price) return i / 200; } return 1; }
export const prog = (s, t) => (!s ? 0 : t < s[0] ? 0 : cl((t - s[0]) / (s[1] - s[0])));

// QA RULE: every printed candle, every frame, fully inside the chart area. Returns the worst overshoot in px (0 = clean).
export function offscreen(G) {
  const PCX = (L.PL + L.PR) / 2, PCY = (L.PT + L.PB) / 2; let worst = 0, at = null;
  for (let f = 0; f < G.DUR; f += 2) { const t = f / FPS; if (t >= G.T.dim) break; const c = camera(G, t);
    for (let i = 0; i <= G.T.last; i++) { const p = prog(G.sch[i], t); if (p <= 0) continue; const b = partial(G.B[i], p), x = PCX + (G.X(i) - c.cx) * c.s, yh = PCY + (G.Y(b[1]) - c.cy) * c.s, yl = PCY + (G.Y(b[2]) - c.cy) * c.s;
      const o = Math.max(L.PL - x, x - L.PR, L.PT - yh, yl - L.PB, 0); if (o > worst) { worst = o; at = +t.toFixed(2); } } }
  return { worst: +worst.toFixed(1), at };
}
