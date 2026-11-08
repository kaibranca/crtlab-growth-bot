// REEL LAYOUT + TIMELINE — one story (engine/stories.mjs) + one look (engine/brain.mjs) → every position and every beat.
// Picture (Reel.jsx), sound (Reel.jsx <Sfx>) and the QA safe-zone check (engine/qa.mjs) all read this file.
//
// SAFE ZONES (1080×1920, IG + FB Reels UI): nothing that matters above y 250 (top bar), below y 1500 (caption, username, audio row),
// or right of x 960 below y 900 (like / comment / share / audio column). The chart, labels and brand all live inside.
export const FPS = 60, W = 1080, H = 1920;
export const SAFE = { top: 250, bottom: 1500, right: 960, rightFrom: 900, left: 64 };
export const L = { title: 268, chip: 432, PT: 540, PB: 1236, PL: 80, PR: 846, axisX: 862, timeY: 1276, cap: 1318, brand: 1430 };
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const EIO = (t) => { t = cl(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const OUT = (t) => 1 - Math.pow(1 - cl(t), 4);

export function build(d) {
  const look = d.look || {}, pace = look.pace === "long" ? 1.32 : 1;
  const N = d.bars.length, B = d.bars;
  // price scale: every bar + every level the story draws, padded so nothing touches the edges
  const lv = [...B.map((b) => b.h), ...B.map((b) => b.l), d.level];
  if (d.trade) lv.push(d.trade.stop, d.trade.target);
  if (d.zone) lv.push(d.zone.top, d.zone.bot);
  if (d.measure) lv.push(d.measure.from, d.measure.to);
  const mx = Math.max(...lv), mn = Math.min(...lv), sp = mx - mn || 1, HI = mx + sp * .08, LO = mn - sp * .08;
  const BW = (L.PR - L.PL) / (N + 1.4), X = (i) => L.PL + BW * (i + .7), Y = (v) => L.PT + (HI - v) / (HI - LO) * (L.PB - L.PT);
  const cw = Math.min(24, Math.max(3, BW * .66));

  // schedule: [start, end] seconds for each bar to form along its real minutes
  const sch = [], t0 = .06, kb = d.kb;
  const Tpre = cl(kb * .072, 1.5, 2.5) * pace, dtA = Tpre / Math.max(1, kb);
  for (let i = 0; i < kb; i++) sch[i] = [t0 + i * dtA, t0 + (i + 1) * dtA - .004];
  const tKey0 = t0 + Tpre + .3 * pace, keyDur = 1.05 * pace, nk = B[kb].p.length;
  sch[kb] = [tKey0, tKey0 + keyDur];
  const tCross = tKey0 + keyDur * (d.keyMin + 1) / nk;
  // after the key bar: trades stop once they've paid (+3 bars), measured moves run to the last bar
  const last = d.trade ? Math.min(N - 1, d.trade.iX + 3) : N - 1, rest = Math.max(1, last - kb);
  const Tpost = cl(rest * .05, 1.1, 2.1) * pace, tP0 = tKey0 + keyDur + .08, dtB = Tpost / rest;
  for (let i = kb + 1; i <= last; i++) sch[i] = [tP0 + (i - kb - 1) * dtB, tP0 + (i - kb) * dtB - .003];
  const close = (i) => (sch[i] ? sch[i][1] : 0);
  // the moment the trade pays: the target minute inside the exit bar
  const tPay = d.trade ? (d.trade.iX === kb ? tKey0 + keyDur * (d.trade.jX + 1) / nk : sch[d.trade.iX][0] + (sch[d.trade.iX][1] - sch[d.trade.iX][0]) * (d.trade.jX + 1) / B[d.trade.iX].p.length) : null;
  const tDone = close(last) + .1;

  const T = { t0, Tpre, tKey0, keyDur, tCross, tP0, Tpost, tPay, tDone, last };
  // annotation beats: each appears the moment the market made it knowable
  if (d.zone) T.zone = d.model === "fvg" ? close(d.zone.i0 + 2) : d.model === "ob" ? close(d.bos.i1) : close(d.zone.i1);
  if (d.bos) T.bos = close(d.bos.i1);
  if (d.liq) T.liq = d.liq.map((x) => close(x.i));
  if (["crt", "break"].includes(d.model)) T.level = .25;              // yesterday's level is known before the day starts
  if (d.model === "asia" || d.model === "nyopen") T.level = T.zone;   // the range locks when its last bar closes
  if (d.model === "news") T.level = Math.max(.3, close(d.kb - 1) - .25);
  if (d.measure) T.measure = Math.max(close(Math.min(d.measure.i1, last)), tCross + .4) + .12;
  T.result = (d.trade ? tPay : T.measure + .55) + .05;
  // captions: setup → key → result (one at a time, nothing moving at rest)
  T.cap1 = [Math.max(.9, Math.min(T.zone ?? T.level ?? 1.2, tKey0 - .9)), tKey0 - .02];
  T.cap2 = [tKey0, Math.max(tKey0 + 1, tCross + .8)];
  T.cap3 = [Math.max(T.result, T.cap2[1] + .05), 0];
  // the end: hold the result, dim, type the domain, click → straight back to frame 0 (the loop)
  T.hold = Math.max(tDone, T.result + .9);
  T.dim = T.hold + .25;
  T.cap3[1] = T.dim + .2;
  const k0 = T.dim + .55, KEY = .085; T.keys = [...Array(10)].map((_, i) => [k0 + i * KEY + (i > 6 ? .03 : 0), i + 1]);
  T.typed = T.keys.at(-1)[0]; T.row = T.typed + .14; T.click = T.typed + 1.05; T.out = T.click + .12; T.end = T.out + .55;
  const DUR = Math.ceil((T.end + .04) * FPS);
  return { N, B, HI, LO, BW, cw, X, Y, sch, T, DUR, nk, pace };
}

// a candle forming along its real minutes, smoothly: the close glides between minute closes, the wicks only ever grow
export function partial(b, q) {
  const n = b.p.length; if (q <= 0) return null; if (q >= 1) return [b.o, b.h, b.l, b.c];
  const x = q * n, k = Math.floor(x), u = x - k;
  let h = b.o, l = b.o; for (let j = 0; j < k; j++) { h = Math.max(h, b.p[j][0]); l = Math.min(l, b.p[j][1]); }
  const c0 = k ? b.p[k - 1][2] : b.o, nx = b.p[Math.min(n - 1, k)], c = c0 + (nx[2] - c0) * u;
  h = Math.max(h, c, h + (Math.max(h, nx[0]) - h) * u); l = Math.min(l, c, l - (l - Math.min(l, nx[1])) * u);
  return [b.o, h, l, c];
}
export const prog = (s, t) => (!s ? 0 : t < s[0] ? 0 : cl((t - s[0]) / (s[1] - s[0])));
