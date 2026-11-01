import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, staticFile, spring } from "remotion";
import { build, partial, prog, EIO, FPS, W, CARD0, CARD1, PT, PB, PL, PR } from "./tld.mjs";
// the daily reel: one real story from yesterday's market (picked by daily/engine.mjs), drawn like CRTLAB's chart
const C = { bg: "#050506", text: "#f2f2f4", dim: "#9598a1", axis: "#787b86", up: "#089981", dn: "#f23645", lvl: "#d1d4dc", tv: "#2962ff" };
const SANS = 'BlinkMacSystemFont, -apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), mix = (a, b, k) => a + (b - a) * k, ein = (t, a, d) => EIO((t - a) / d);
const TXT = { color: C.text, fontWeight: 600, lineHeight: 1.14, letterSpacing: -.35, fontFamily: SANS };

const fmtP = (v, dp) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
function ticks(lo, hi) { const raw = (hi - lo) / 5, m = Math.pow(10, Math.floor(Math.log10(raw))), s = [1, 2, 2.5, 5, 10].map((k) => k * m).find((k) => k >= raw);
  const out = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(v); return out; }

function Candle({ x, b, w }) {
  const col = b[3] >= b[0] ? C.up : C.dn, yt = Math.min(b[4], b[5]), yb = Math.max(b[4], b[5]);
  return <g><line x1={x} x2={x} y1={b[6]} y2={b[7]} stroke={col} strokeWidth={1.3} /><rect x={x - w / 2} y={yt} width={w} height={Math.max(1.3, yb - yt)} fill={col} /></g>;
}

// the chart at time t (t = 0 is the empty chart the hook sits on)
function World({ t, d, L }) {
  const { B, X, Y, sch, T, N, BW } = L, keyAcc = d.story === "crt" ? (d.side === "low" ? C.up : C.dn) : (d.side === "low" ? C.dn : C.up);
  const cw = Math.max(3, BW * .66), out = [];
  let last = null;
  for (let i = 0; i < N; i++) { const q = prog(sch[i], t); if (q <= 0) continue; const b = q >= 1 ? [B[i].o, B[i].h, B[i].l, B[i].c] : partial(B[i], q);
    last = b; out.push(<Candle key={i} x={X(i)} w={cw} b={[...b, Y(b[0]), Y(b[3]), Y(b[1]), Y(b[2])]} />); }
  const yl = Y(d.level), crossK = t >= T.cross ? 1 : 0, ring = cl((t - T.cross) / .85), flash = t >= T.cross ? Math.exp(-(t - T.cross) * 2.4) : 0;
  // the level: Asia's box grows with its candles then locks into two lines · yesterday's level draws in before the day starts
  let level = null;
  if (d.story === "asia") {
    const vis = []; for (let i = d.a0; i <= d.a1; i++) { const q = prog(sch[i], t); if (q > 0) vis.push(q >= 1 ? [B[i].h, B[i].l] : partial(B[i], q).slice(1, 3)); }
    if (vis.length) {
      const h = Math.max(...vis.map((v) => v[0])), l = Math.min(...vis.map((v) => v[1])), x0 = X(d.a0) - BW / 2, xa = X(Math.min(d.a1, d.a0 + vis.length - 1)) + BW / 2;
      const lk = t >= T.lock ? ein(t, T.lock, .7) : 0, xe = mix(xa, PR, lk), yH = Y(h), yL = Y(l);
      const brokeY = d.side === "low" ? yL : yH;
      level = <g>
        <rect x={x0} y={yH} width={xa - x0} height={yL - yH} fill="#fff" fillOpacity={.045} />
        <line x1={x0} x2={xe} y1={yH} y2={yH} stroke={C.lvl} strokeOpacity={.55} strokeWidth={1.2} strokeDasharray={lk > 0 ? "5 5" : undefined} />
        <line x1={x0} x2={xe} y1={yL} y2={yL} stroke={C.lvl} strokeOpacity={.55} strokeWidth={1.2} strokeDasharray={lk > 0 ? "5 5" : undefined} />
        <text x={x0 + 6} y={yH - 9} fill={C.dim} fontSize={17} fontWeight={600} fontFamily={SANS} opacity={ein(t, sch[d.a0][0], .4)}>Asia</text>
        {crossK ? <line x1={X(d.kb) - BW / 2} x2={PR} y1={brokeY} y2={brokeY} stroke={keyAcc} strokeWidth={1.6 + 1.2 * flash} strokeOpacity={.9} /> : null}
      </g>;
    }
  } else if (t >= T.lv0) {
    const p = ein(t, T.lv0, T.lv1 - T.lv0), name = d.side === "high" ? "Yesterday's high" : "Yesterday's low", tagY = d.side === "high" ? yl - 10 : yl + 24;
    level = <g>
      <line x1={PL} x2={mix(PL, PR, p)} y1={yl} y2={yl} stroke={crossK ? keyAcc : C.lvl} strokeOpacity={crossK ? .95 : .7} strokeWidth={1.4 + 1.2 * flash} />
      <g opacity={ein(t, T.lv0 + .25, .4)}><rect x={PR - 150} y={yl - 14} width={146} height={28} rx={4} fill={C.bg} stroke={crossK ? keyAcc : C.lvl} strokeOpacity={.5} />
        <text x={PR - 77} y={yl + 6} fill={crossK ? keyAcc : C.lvl} fontSize={16} fontWeight={600} fontFamily={SANS} textAnchor="middle">{name}</text></g>
    </g>;
  }
  // TradingView's price-range tool over the move
  let measure = null;
  if (t >= T.tm) {
    const p = ein(t, T.tm, .55), x0 = d.story === "crt" ? X(d.ext) : X(d.kb), x1 = d.story === "crt" ? X(N - 1) : X(d.ext), y0 = Y(d.from), y1 = mix(y0, Y(d.to), p);
    const pct = (d.to - d.from) / d.from * 100, lab = `${d.copy.measure}  (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%)`, below = y1 > y0, lw = lab.length * 9.6 + 28, lx = (x0 + x1) / 2;
    const xm = Math.min(PR - lw / 2 - 4, Math.max(PL + lw / 2 + 4, lx));
    measure = <g>
      <rect x={x0} y={Math.min(y0, y1)} width={x1 - x0} height={Math.abs(y1 - y0)} fill={C.tv} fillOpacity={.16} />
      <line x1={lx} x2={lx} y1={y0} y2={y1} stroke={C.tv} strokeWidth={1.5} />
      <path d={below ? `M${lx - 6} ${y1 - 8} L${lx} ${y1} L${lx + 6} ${y1 - 8}` : `M${lx - 6} ${y1 + 8} L${lx} ${y1} L${lx + 6} ${y1 + 8}`} fill="none" stroke={C.tv} strokeWidth={1.5} opacity={p} />
      <g opacity={ein(t, T.tm + .35, .3)}><rect x={xm - lw / 2} y={below ? y1 + 10 : y1 - 44} width={lw} height={34} rx={4} fill={C.tv} />
        <text x={xm} y={below ? y1 + 33 : y1 - 21} fill="#fff" fontSize={18} fontWeight={600} fontFamily={SANS} textAnchor="middle">{lab}</text></g>
    </g>;
  }
  return <g>
    {level}{measure}{out}
    {crossK && ring < 1 ? <circle cx={X(d.kb)} cy={yl} r={4 + 30 * EIO(ring)} fill="none" stroke={keyAcc} strokeOpacity={.75 * (1 - ring)} strokeWidth={1.6} /> : null}
  </g>;
}

function PriceTag({ b, Y, dp }) {
  const col = b[3] >= b[0] ? C.up : C.dn, y = Y(b[3]);
  return <g><line x1={PL} x2={PR} y1={y} y2={y} stroke={col} strokeOpacity={.55} strokeWidth={1} strokeDasharray="2 3" />
    <rect x={PR + 4} y={y - 15} width={W - PR - 12} height={30} rx={4} fill={col} /><text x={(PR + W - 8) / 2 + 2} y={y + 6} fill="#fff" fontSize={17} fontWeight={600} fontFamily={SANS} textAnchor="middle">{fmtP(b[3], dp)}</text></g>;
}

function Axes({ d, L }) {
  const tk = ticks(L.LO, L.HI).filter((v) => L.Y(v) > PT + 10 && L.Y(v) < PB - 10), dpA = Math.max(0, Math.min(d.dp, -Math.floor(Math.log10((tk[1] - tk[0]) || 1)) + 1));
  const times = L.B.map((b, i) => [b.lab, i]).filter(([s, i]) => s.endsWith(":00") && +s.slice(0, 2) % 4 === 0 && i > 1 && i < L.N - 2);
  return <g>
    {tk.map((v) => <g key={v}><line x1={PL} x2={PR} y1={L.Y(v)} y2={L.Y(v)} stroke="#fff" strokeOpacity={.045} strokeDasharray="1 4" />
      <text x={PR + 16} y={L.Y(v) + 6} fill={C.axis} fontSize={17} fontFamily={SANS}>{fmtP(v, dpA)}</text></g>)}
    {times.map(([s, i]) => <text key={i} x={L.X(i)} y={PB + 40} fill={C.axis} fontSize={17} fontFamily={SANS} textAnchor="middle">{s}</text>)}
  </g>;
}

function Hi({ c, p, children }) {
  return <span style={{ color: c, padding: "0 8px", margin: "0 -2px", borderRadius: 8, background: `linear-gradient(${c}2b, ${c}2b) no-repeat left / ${EIO(p) * 100}% 100%` }}>{children}</span>;
}

// a caption: one quiet entrance, a short exit, nothing moving at rest
function Cap({ t, a, b, x, y, right, size = 40, w = 520, anim = "rise", lines }) {
  if (t < a || t >= b) return null;
  const u = t - a, out = ein(t, b - .3, .3);
  const line = (n, j) => {
    const k = EIO((u - .05 - j * .12) / .5);
    if (k >= 1) return <div key={j}>{n}</div>;
    if (anim === "mask") return <div key={j} style={{ overflow: "hidden", paddingBottom: 4 }}><div style={{ transform: `translateY(${(1 - k) * 105}%)` }}>{n}</div></div>;
    if (anim === "slide") return <div key={j} style={{ opacity: k, transform: `translateX(${(1 - k) * (right ? 22 : -22)}px)` }}>{n}</div>;
    return <div key={j} style={{ opacity: k, transform: `translateY(${(1 - k) * 10}px)` }}>{n}</div>;
  };
  return <div style={{ position: "absolute", top: y, ...(right ? { right: W - x, textAlign: "right" } : { left: x }), width: w, opacity: 1 - out, transform: out > 0 ? `translateY(${-out * 10}px)` : undefined, ...TXT, fontSize: size }}>{lines(u).map(line)}</div>;
}

function Hook({ t, T, lines, acc }) {
  const st = { position: "absolute", left: 72, top: 372, ...TXT, fontSize: 60 };
  const word = (wd, k, key, hi) => <span key={key} style={{ display: "inline-block", opacity: k, transform: k < 1 ? `translateY(${(1 - k) * 14}px)` : undefined, marginRight: hi ? 0 : ".26em" }}>{hi ? <Hi c={acc} p={1}>{wd}</Hi> : wd}</span>;
  const render = (kf) => { let n = 0; return lines.map((l, j) => <div key={j}>{j === 1 ? word(l, kf(n++), 0, true) : l.split(" ").map((wd, i) => word(wd, kf(n++), i))}</div>); };
  if (t < T.hookOut + .3) { const o = EIO((t - T.hookOut) / .3); if (o >= 1) return null; return <div style={{ ...st, opacity: 1 - o, transform: o > 0 ? `translateY(${-o * 12}px)` : undefined }}>{render(() => 1)}</div>; }
  if (t < T.hookIn) return null;
  return <div style={st}>{render((n) => EIO((t - T.hookIn - .1 * n) / .42))}</div>;
}

export const Daily = (d) => {
  const frame = useCurrentFrame(), t = frame / FPS, L = useMemo(() => build(d), [d]), { T, X, Y } = L, cp = d.copy;
  const acc = d.story === "crt" ? (d.side === "low" ? C.up : C.dn) : (d.side === "low" ? C.dn : C.up);
  // the camera leans in on the break and settles back to exactly 1
  const k = t < T.cross ? ein(t, T.Tk - .35, T.cross - T.Tk + .35) : 1 - ein(t, T.cross + .9, .8), s = 1 + .07 * k, fx = X(d.kb), fy = Y(d.level);
  const tr = k > 0 ? `translate(${fx} ${fy}) scale(${s}) translate(${-fx} ${-fy})` : undefined, mp = (x, y) => [fx + (x - fx) * s, fy + (y - fy) * s];
  const xf = EIO((t - T.reset) / .55);
  // caption spots
  const top = L.region === "top", rY = top ? PT + 24 : PB - 150;
  const keyRight = X(d.kb) > 600, [kx, ky] = mp(keyRight ? X(d.kb) - 34 : X(d.kb) + 34, d.side === "low" ? Y(d.level) - 82 : Y(d.level) + 28);
  let c1x, c1y, c1r = false;
  if (d.story === "asia") { c1x = X(d.a1) + 40; c1y = (Y(d.aH) + Y(d.aL)) / 2 - 24; if (c1x > 560) { c1x = X(d.a0) - 30; c1r = true; } }
  else { c1x = PR - 8; c1r = true; c1y = d.side === "high" ? Y(d.level) - 70 : Y(d.level) + 24; }
  return (
    <AbsoluteFill style={{ background: "#111113", fontFamily: SANS }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: CARD0, height: CARD1 - CARD0, background: C.bg, boxShadow: "0 9px 16px -6px rgba(0,0,0,.6), 0 2px 4px rgba(0,0,0,.35)" }} />
      <svg width={W} height={1920} style={{ position: "absolute", inset: 0 }}>
        <defs><clipPath id="plot"><rect x={0} y={PT - 40} width={W} height={PB - PT + 80} /></clipPath></defs>
        <Axes d={d} L={L} />
        <g clipPath="url(#plot)">
          {xf < 1 ? <g opacity={1 - xf} transform={tr}><World t={Math.min(t, T.reset - .001)} d={d} L={L} /></g> : null}
          {xf > 0 ? <g opacity={xf}><World t={0} d={d} L={L} /></g> : null}
        </g>
        {(() => { const tt = Math.min(t, T.reset - .001); let b = null; for (let i = 0; i < L.N; i++) { const q = prog(L.sch[i], tt); if (q > 0) b = q >= 1 ? [L.B[i].o, L.B[i].h, L.B[i].l, L.B[i].c] : partial(L.B[i], q); }
          return b ? <g opacity={1 - xf}><PriceTag b={[b[0], b[1], b[2], b[3]]} Y={(v) => mp(0, Y(v))[1]} dp={d.dp} /></g> : null; })()}
        <image href={staticFile(`m/${d.mk}.webp`)} x={72} y={568} width={30} height={30} />
        <text x={113} y={592} fill={C.text} fontSize={25} fontWeight={600} fontFamily={SANS}>{d.mk}</text>
        <image href={staticFile("potion-glyph.png")} x={72} y={CARD1 - 82} width={40} height={40} />
        <text x={122} y={CARD1 - 51} fill="#fff" fillOpacity={.92} fontSize={30} fontWeight={800} letterSpacing={3.6} fontFamily={SANS}>CRTLAB</text>
      </svg>
      <Hook t={t} T={T} lines={cp.hook} acc={acc} />
      <Cap t={t} a={T.cap1} b={T.cap2[0] - .05} x={c1x} y={c1y} right={c1r} w={480} anim="slide" lines={() => [cp.setup]} />
      <Cap t={t} a={T.cap2[0]} b={T.cap2[1]} x={kx} y={ky} right={keyRight} w={520} size={44} anim="rise" lines={(u) => [<Hi c={acc} p={(u - .15) / .45}>{cp.key}</Hi>]} />
      <Cap t={t} a={T.cap3[0]} b={T.cap3[1]} x={PR - 8} y={rY} right w={620} anim="mask" lines={() => [cp.after]} />
      <Cap t={t} a={T.cap4[0]} b={T.cap4[1]} x={PR - 8} y={rY - 10} right w={700} size={cp.stat[1] ? 48 : 46} anim="rise" lines={(u) => [cp.stat[1] ? <><Hi c={acc} p={(u - .2) / .45}>{cp.stat[0]}</Hi>{cp.stat[1]}</> : <Hi c={acc} p={(u - .2) / .45}>{cp.stat[0]}</Hi>]} />
      <Cap t={t} a={T.end[0]} b={T.end[1]} x={72} y={400} w={900} size={52} anim="mask" lines={() => [cp.end]} />
    </AbsoluteFill>
  );
};
