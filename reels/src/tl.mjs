// REEL LAYOUT + TIMELINE (v3: lessons) — a story (engine/stories.mjs) + a lesson (engine/lesson.mjs: steps) + a look → every beat.
// Picture (Reel.jsx), sound (engine/mix.mjs) and QA (engine/qa.mjs) all read this file, so they can never drift apart.
//
// SAFE ZONES (1080×1920, IG + FB Reels UI): nothing above y 250, nothing below y 1500, nothing right of x 960 below y 900.
export const FPS = 60, W = 1080, H = 1920;
export const SAFE = { top: 250, bottom: 1500, right: 960, rightFrom: 900, left: 64 };
export const L = { title: 270, chip: 420, PT: 520, PB: 1180, PL: 72, PR: 846, axisX: 860, timeY: 1222, cap: 1262, brand: 1438 };
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const EIO = (t) => { t = cl(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const OUT = (t) => 1 - Math.pow(1 - cl(t), 4);
export const SMOOTH = (t) => { t = cl(t); return t * t * t * (t * (t * 6 - 15) + 10); }; // camera: zero velocity AND acceleration at both ends

export function build(d) {
  const pace = d.look?.pace === "long" ? 1.12 : 1, N = d.bars.length, B = d.bars, steps = d.lesson.steps;
  const lv = [...B.map((b) => b.h), ...B.map((b) => b.l), d.level];
  if (d.trade) lv.push(d.trade.stop, d.trade.target); if (d.zone) lv.push(d.zone.top, d.zone.bot); if (d.measure) lv.push(d.measure.from, d.measure.to);
  const mx = Math.max(...lv), mn = Math.min(...lv), sp = mx - mn || 1, HI = mx + sp * .1, LO = mn - sp * .1;
  const BW = (L.PR - L.PL) / (N + 1.6), X = (i) => L.PL + BW * (i + .8), Y = (v) => L.PT + (HI - v) / (HI - LO) * (L.PB - L.PT);
  const cw = Math.min(26, Math.max(3, BW * .66));

  // walk the lesson: replay bars up to each step, then the step's annotation + caption, then hold so it can be read
  const sch = [], beats = []; let t = .08, cur = -1;
  for (const [si, st] of steps.entries()) {
    const to = Math.min(N - 1, st.to ?? cur), n = to - cur;
    if (n > 0) {
      const slowLast = st.slow ? 1 : 0, fastN = n - slowLast, v = Math.min(.085, 2.6 / Math.max(1, fastN)) * pace;
      for (let i = cur + 1; i <= to - slowLast; i++) { sch[i] = [t, t + v - .004]; t += v; }
      if (slowLast) { const kd = 1.25 * pace; sch[to] = [t + .12, t + .12 + kd]; t += .12 + kd; }
      cur = to;
    }
    const words = (st.cap || "").split(" ").length, hold = (st.hold ?? Math.max(1.7, .9 + words * .19)) * pace;
    beats.push({ ...st, i: si, t: t + .1, end: t + .1 + hold, to: cur });
    t += .1 + hold;
  }
  // the key minute inside the slow bar (the entry tap / the sweep / the break), for the hit sound + marker
  const kbS = sch[d.kb], tCross = kbS ? kbS[0] + (kbS[1] - kbS[0]) * (d.keyMin + 1) / B[d.kb].p.length : beats[0].t;
  const tPay = d.trade && sch[d.trade.iX] ? sch[d.trade.iX][0] + (sch[d.trade.iX][1] - sch[d.trade.iX][0]) * (d.trade.jX + 1) / B[d.trade.iX].p.length : null;
  const last = cur, tEnd0 = t;
  // camera states: each beat may focus a region (bars i0..i1 + prices) → ease there; the final beats ease back to the full chart
  const cams = beats.map((b) => ({ t: b.t - .35, f: b.focus || null }));
  // the end: dim, type the domain, show the result row, fade back to the empty chart = frame 0
  const T = { tCross, tPay, last, dim: tEnd0 + .15 };
  const k0 = T.dim + .5, KEY = .1; T.keys = [...Array(10)].map((_, i) => [k0 + i * KEY, i + 1]);
  T.typed = T.keys.at(-1)[0]; T.row = T.typed + .2; T.out = T.row + 1.25; T.end = T.out + .6;
  const DUR = Math.ceil((T.end + .03) * FPS);
  return { N, B, HI, LO, BW, cw, X, Y, sch, T, beats, cams, DUR, pace };
}

// camera at time t → { s, cx, cy } (world point cx,cy is drawn at the plot centre, scaled by s). s = 1 → the whole chart.
export function camera(G, t) {
  const PCX = (L.PL + L.PR) / 2, PCY = (L.PT + L.PB) / 2, full = { s: 1, cx: PCX, cy: PCY };
  const state = (f) => {
    if (!f) return full;
    // the focus always holds every candle in its window (never crop a wick) plus the prices the step talks about
    let hi = Math.max(f[2], f[3]), lo = Math.min(f[2], f[3]);
    for (let i = f[0]; i <= f[1]; i++) { hi = Math.max(hi, G.B[i].h); lo = Math.min(lo, G.B[i].l); }
    const pad = (hi - lo) * .12, x0 = G.X(f[0]) - G.BW, x1 = G.X(f[1]) + G.BW, y0 = G.Y(hi + pad), y1 = G.Y(lo - pad);
    const s = cl(Math.min((L.PR - L.PL) / ((x1 - x0) * 1.25), (L.PB - L.PT) / ((y1 - y0) * 1.1)), 1, 1.7);
    // keep the view inside the chart: no empty margins past the first/last candle or the price range
    const hw = (L.PR - L.PL) / 2 / s, hh = (L.PB - L.PT) / 2 / s;
    return { s, cx: cl((x0 + x1) / 2, L.PL + hw, L.PR - hw), cy: cl((y0 + y1) / 2, L.PT + hh, L.PB - hh) };
  };
  let a = full, b = full, k = 1;
  const cs = [...G.cams, { t: G.T.dim - .9, f: null }];
  for (let i = 0; i < cs.length; i++) if (t >= cs[i].t) { a = i ? state(cs[i - 1].f) : full; b = state(cs[i].f); k = SMOOTH((t - cs[i].t) / .95); }
  return { s: a.s + (b.s - a.s) * k, cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k };
}

// a candle forming along its real minutes, smoothly (no jitter): the close follows a Catmull-Rom curve through the real minute
// closes (lightly smoothed), the wicks only ever grow and ease out to each new extreme. At q = 1 it is exactly the real OHLC.
const SM = (u) => u * u * (3 - 2 * u);
export function partial(b, q) {
  const n = b.p.length; if (q <= 0) return null; if (q >= 1) return [b.o, b.h, b.l, b.c];
  const c = [b.o, ...b.p.map((m) => m[2])], P = (j) => c[Math.max(0, Math.min(n, j))];
  const x = q * n, k = Math.min(n - 1, Math.floor(x)), u = x - k;
  const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
  let close = .5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  close = Math.max(Math.min(close, Math.max(p1, p2)), Math.min(p1, p2));                       // no overshoot past real prices
  let h = b.o, l = b.o; for (let j = 0; j < k; j++) { h = Math.max(h, b.p[j][0]); l = Math.min(l, b.p[j][1]); }
  const e = SM(u), nh = Math.max(h, b.p[k][0]), nl = Math.min(l, b.p[k][1]);
  h = Math.max(h + (nh - h) * e, close); l = Math.min(l + (nl - l) * e, close);
  return [b.o, h, l, close];
}
export const prog = (s, t) => (!s ? 0 : t < s[0] ? 0 : cl((t - s[0]) / (s[1] - s[0])));
