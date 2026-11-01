// daily reel — layout + timeline from one engine story (daily/engine.mjs). picture and sound share this file
export const FPS = 60, W = 1080, CARD0 = 300, CARD1 = 1500, PT = 650, PB = 1320, PL = 56, PR = 918;
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const EIO = (t) => { t = cl(t); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

export function build(d) {
  const N = d.bars.length, B = d.bars, dn = d.close < d.open;
  const lv = [d.hi, d.lo, d.level], span = Math.max(...lv) - Math.min(...lv), HI = Math.max(...lv) + span * .07, LO = Math.min(...lv) - span * .07;
  const BW = (PR - PL) / (N + 1), X = (i) => PL + BW * (i + .5), Y = (v) => PT + (HI - v) / (HI - LO) * (PB - PT);
  // when each bar starts / ends forming
  const sch = [], hookOut = 1.6, tb = .1; // candles move from the first frames, under the hook (a still opening = a scroll)
  const dtS = d.kb ? cl(2.0 / d.kb, .035, .13) : 0;
  for (let i = 0; i < d.kb; i++) sch[i] = [tb + i * dtS, tb + (i + 1) * dtS - .004];
  const tS = tb + d.kb * dtS;
  const T = { hookOut, tb, tS };
  if (d.story === "asia") { T.lock = sch[d.a1][1]; T.cap1 = T.lock + .15; }
  else { T.lv0 = .05; T.lv1 = .55; T.cap1 = Math.max(1.75, tS - .9); }
  const Tk = Math.max(tS + .12, T.cap1 + .95), keyDur = 1.6, nk = B[d.kb].p.length;
  sch[d.kb] = [Tk, Tk + keyDur];
  const cross = Tk + keyDur * (d.keyMin + 1) / nk;
  const rest = N - d.kb - 1, Tr0 = Tk + keyDur + .12, Tr = cl(rest * .032, 1.7, 2.8), dtR = Tr / rest;
  for (let i = d.kb + 1; i < N; i++) sch[i] = [Tr0 + (i - d.kb - 1) * dtR, Tr0 + (i - d.kb) * dtR - .003];
  const tm = Tr0 + Tr + .12;
  Object.assign(T, { Tk, keyDur, cross, cap2: [cross - .04, Math.min(cross + 1.35, Tr0 + .35)], Tr0, Tr, cap3: [Tr0 + .45, Tr0 + Tr], tm, cap4: [tm + .35, tm + 2.15], end: [tm + 2.3, tm + 3.9] });
  T.reset = T.end[1]; T.hookIn = T.reset + .3;
  const DUR = Math.ceil((T.hookIn + .1 * 4 + .42 + .25) * FPS);
  // where the eye is free: away from where the day finished
  const region = dn ? "top" : "bottom";
  return { N, B, dn, HI, LO, BW, X, Y, sch, T, DUR, region, nk };
}

// a candle forms along its real 1-minute path: after k minutes its high/low/close are exactly what had printed
export function partial(b, q) {
  const n = b.p.length, k = Math.max(0, Math.min(n, Math.ceil(q * n)));
  if (k === 0) return [b.o, b.o, b.o, b.o];
  let h = b.o, l = b.o; for (let j = 0; j < k; j++) { h = Math.max(h, b.p[j][0]); l = Math.min(l, b.p[j][1]); }
  return [b.o, h, l, b.p[k - 1][2]];
}
export const prog = (s, t) => (!s ? 0 : t < s[0] ? 0 : cl((t - s[0]) / (s[1] - s[0])));
