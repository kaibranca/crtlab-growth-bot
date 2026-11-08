import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Img, Sequence, useCurrentFrame, staticFile, interpolate } from "remotion";
import { build, partial, prog, EIO, OUT, FPS, W, L } from "./tl.mjs";
// THE REEL — built on what actually performed on @crtlab.pro: "OB ENTRY" (3,003 views, 63% watched, 8.6s):
// a big two-word model name at the top, a clean chart, liquidity $ marks, entry arrow, BOS, a fast payoff, CRTLAB mark.
// Brand rules: TradingView candles, shades not outlines, white type, one accent; ends on the typed domain and loops to frame 0.
const C = { bg: "#050506", text: "#f2f2f4", dim: "#8f929b", axis: "#6f727c", up: "#089981", dn: "#f23645", lvl: "#d1d4dc", tv: "#2962ff", acc: "#9d7bff", acc2: "#7e57c2" };
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Roboto, sans-serif';
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), mix = (a, b, k) => a + (b - a) * k, ein = (t, a, d) => EIO((t - a) / d), eo = (t, a, d) => OUT((t - a) / d);
const ACC_TXT = { backgroundImage: `linear-gradient(180deg, #c3adff, ${C.acc2})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" };
const fmt = (v, dp) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
function ticks(lo, hi) { const raw = (hi - lo) / 6, m = Math.pow(10, Math.floor(Math.log10(raw))), s = [1, 2, 2.5, 5, 10].map((k) => k * m).find((k) => k >= raw); const o = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) o.push(+v.toFixed(10)); return o; }

function Candle({ x, w, b, Y }) {
  const col = b[3] >= b[0] ? C.up : C.dn, y0 = Y(Math.max(b[0], b[3])), y1 = Y(Math.min(b[0], b[3]));
  return <g><line x1={x} x2={x} y1={Y(b[1])} y2={Y(b[2])} stroke={col} strokeWidth={Math.max(1.2, w * .1)} /><rect x={x - w / 2} y={y0} width={w} height={Math.max(1.4, y1 - y0)} fill={col} /></g>;
}
const Pill = ({ x, y, text, bg, fg = "#fff", size = 19, anchor = "start", o = 1 }) => {
  const w = text.length * size * .6 + 22, x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
  return <g opacity={o}><rect x={x0} y={y - size * .95} width={w} height={size * 1.55} rx={6} fill={bg} /><text x={x0 + w / 2} y={y + size * .1} fill={fg} fontSize={size} fontWeight={650} fontFamily={SANS} textAnchor="middle">{text}</text></g>;
};

// everything on the chart at time t
function World({ t, d, G }) {
  const { B, X, Y, sch, T, N, BW, cw } = G, out = [], long = d.trade ? d.trade.side === "long" : d.side === "high";
  for (let i = 0; i <= T.last; i++) { const b = partial(B[i], prog(sch[i], t)); if (b) out.push(<Candle key={i} x={X(i)} w={cw} b={b} Y={Y} />); }
  const xR = X(T.last) + BW * .6, layers = [];
  // zone (FVG / OB / Asia / opening range): a shade that grows to the right as time passes, label tucked inside
  if (d.zone && t >= T.zone) {
    const k = eo(t, T.zone, .45), x0 = X(d.zone.i0) - BW / 2, x1 = mix(x0 + BW, xR, k), y0 = Y(d.zone.top), y1 = Y(d.zone.bot), used = d.trade && t >= T.tCross;
    const fill = d.model === "asia" || d.model === "nyopen" ? "#ffffff" : C.acc;
    layers.push(<g key="z"><rect x={x0} y={y0} width={x1 - x0} height={Math.max(2, y1 - y0)} fill={fill} fillOpacity={(fill === C.acc ? .2 : .07) * (used ? .75 : 1)} />
      <Pill x={x0 + 6} y={y0 - 14} text={d.zone.label} bg={fill === C.acc ? C.acc2 : "#2a2b31"} size={17} o={eo(t, T.zone + .15, .3)} /></g>);
  }
  // key level line (PDH / PDL / Asia / OR / release price)
  if (T.level != null && t >= T.level && d.model !== "fvg" && d.model !== "ob") {
    const k = ein(t, T.level, .5), hit = t >= T.tCross, flash = hit ? Math.exp(-(t - T.tCross) * 3) : 0, y = Y(d.level), x0 = d.model === "news" ? X(d.kb) - BW / 2 : L.PL;
    const col = hit ? (d.side === "high" ? C.up : C.dn) : C.lvl;
    layers.push(<g key="l"><line x1={x0} x2={mix(x0, xR, k)} y1={y} y2={y} stroke={col} strokeOpacity={hit ? .95 : .6} strokeWidth={1.6 + 1.4 * flash} strokeDasharray={d.model === "news" ? "6 6" : undefined} />
      <Pill x={x0 + 6} y={d.side === "high" ? y - 14 : y + 32} text={d.levelLabel} bg={hit ? col : "#2a2b31"} size={17} o={eo(t, T.level + .2, .3)} /></g>);
    if (d.model === "news") { const xr = X(d.kb) - BW / 2; layers.push(<line key="nv" x1={xr} x2={xr} y1={L.PT} y2={L.PB} stroke="#fff" strokeOpacity={.22 * k} strokeWidth={1.2} strokeDasharray="3 5" />); }
  }
  // break of structure
  if (d.bos && t >= T.bos) {
    const k = ein(t, T.bos, .4), y = Y(d.bos.price), x0 = X(d.bos.i0), x1 = mix(x0, X(d.bos.i1), k);
    layers.push(<g key="b"><line x1={x0} x2={x1} y1={y} y2={y} stroke={C.lvl} strokeOpacity={.75} strokeWidth={1.4} strokeDasharray="5 4" />
      <text x={(x0 + X(d.bos.i1)) / 2} y={long ? y - 12 : y + 28} fill={C.lvl} fontSize={19} fontWeight={700} fontFamily={SANS} textAnchor="middle" opacity={eo(t, T.bos + .2, .3)}>BOS</text></g>);
  }
  // liquidity: a $ on each pullback swing as it prints; it's taken on the way into the entry
  if (d.liq) d.liq.forEach((q, j) => { const a = T.liq[j]; if (t < a) return; const k = eo(t, a, .3), taken = t >= T.tCross ? ein(t, T.tCross, .4) : 0, y = Y(q.price) + (long ? 30 : -14);
    layers.push(<text key={"q" + j} x={X(q.i)} y={y} fill={C.acc} fontSize={24} fontWeight={800} fontFamily={SANS} textAnchor="middle" opacity={k * (1 - .65 * taken)} transform={`translate(0 ${(1 - k) * 8})`}>$</text>); });
  // position tool at the entry: target shade, stop shade, entry line (TradingView long/short tool, flat fills)
  if (d.trade && t >= T.tCross) {
    const tr = d.trade, k = eo(t, T.tCross, .35), x0 = X(tr.iE) - BW / 2, x1 = mix(x0, xR, k), ye = Y(tr.entry), yt = Y(tr.target), ys = Y(tr.stop);
    const paid = tr && T.tPay && t >= T.tPay ? ein(t, T.tPay, .35) : 0;
    layers.push(<g key="p">
      <rect x={x0} y={Math.min(ye, yt)} width={x1 - x0} height={Math.abs(yt - ye)} fill={C.up} fillOpacity={.16 + .1 * paid} />
      <rect x={x0} y={Math.min(ye, ys)} width={x1 - x0} height={Math.abs(ys - ye)} fill={C.dn} fillOpacity={.16 * (1 - .5 * paid)} />
      <line x1={x0} x2={x1} y1={ye} y2={ye} stroke="#fff" strokeOpacity={.7} strokeWidth={1.3} /></g>);
    // entry marker: solid triangle under (long) / over (short) the entry minute
    const ex = X(tr.iE), ey = long ? Y(B[tr.iE].l) + 22 : Y(B[tr.iE].h) - 22, s = 11 * eo(t, T.tCross, .25);
    layers.push(<path key="e" d={long ? `M${ex} ${ey - s} L${ex - s} ${ey + s * .8} L${ex + s} ${ey + s * .8} Z` : `M${ex} ${ey + s} L${ex - s} ${ey - s * .8} L${ex + s} ${ey - s * .8} Z`} fill={long ? C.up : C.dn} />);
  }
  // TradingView price-range tool over a measured move
  if (d.measure && t >= T.measure) {
    const m = d.measure, p = ein(t, T.measure, .5), x0 = X(m.i0), x1 = X(Math.min(m.i1, T.last)), y0 = Y(m.from), y1 = mix(y0, Y(m.to), p), lx = (x0 + x1) / 2, below = y1 > y0;
    layers.push(<g key="m"><rect x={x0} y={Math.min(y0, y1)} width={Math.max(4, x1 - x0)} height={Math.abs(y1 - y0)} fill={C.tv} fillOpacity={.16} />
      <line x1={lx} x2={lx} y1={y0} y2={y1} stroke={C.tv} strokeWidth={1.6} />
      <path d={below ? `M${lx - 7} ${y1 - 9} L${lx} ${y1} L${lx + 7} ${y1 - 9}` : `M${lx - 7} ${y1 + 9} L${lx} ${y1} L${lx + 7} ${y1 + 9}`} fill="none" stroke={C.tv} strokeWidth={1.6} opacity={p} /></g>);
  }
  return <g>{layers}{out}</g>;
}

// results that sit above the camera (never scaled): +2R / measured move label
function Result({ t, d, G, mp }) {
  const { T, X, Y, BW } = G;
  if (t < T.result) return null;
  const k = eo(t, T.result, .4), pop = 1 + .06 * Math.sin(cl((t - T.result) / .35) * Math.PI);
  // +2R sits on the target line just past the end of the position tool, in the gap before the price axis: never on a candle
  if (d.trade) { const [x, y] = mp(X(T.last) + BW * .6, Y(d.trade.target));
    return <g opacity={k} transform={`translate(${Math.min(x + 8, L.PR - 70)} ${y}) scale(${pop})`}><Pill x={0} y={8} text={d.copy.win} bg={C.up} size={22} /></g>; }
  const m = d.measure, [x, y0] = mp((X(m.i0) + X(Math.min(m.i1, T.last))) / 2, Y(m.to)), below = m.to < m.from, lx = Math.min(L.PR - 120, Math.max(L.PL + 120, x)), y = Math.min(L.PB - 50, Math.max(L.PT + 30, y0));
  return <g opacity={k} transform={`translate(${lx} ${y}) scale(${pop})`}><Pill x={0} y={below ? 42 : -18} text={d.copy.win} bg={C.tv} size={22} anchor="middle" /></g>;
}

function Axes({ d, G, o }) {
  const tk = ticks(G.LO, G.HI).filter((v) => G.Y(v) > L.PT + 12 && G.Y(v) < L.PB - 12), step = tk[1] - tk[0] || 1, dpA = Math.max(0, Math.min(d.dp, Math.ceil(-Math.log10(step) + .3)));
  const every = Math.max(1, Math.round(G.N / 4)), times = G.B.map((b, i) => [b.lab, i]).filter(([, i]) => i % every === Math.floor(every / 2) && i < G.N - 1);
  return <g opacity={o}>
    {tk.map((v) => <g key={v}><line x1={L.PL} x2={L.PR} y1={G.Y(v)} y2={G.Y(v)} stroke="#fff" strokeOpacity={.05} strokeDasharray="1 5" />
      <text x={L.axisX} y={G.Y(v) + 7} fill={C.axis} fontSize={19} fontFamily={SANS}>{fmt(v, dpA)}</text></g>)}
    {times.map(([s, i]) => <text key={i} x={G.X(i)} y={L.timeY} fill={C.axis} fontSize={19} fontFamily={SANS} textAnchor="middle">{s}</text>)}
  </g>;
}

function PriceTag({ b, y, dp, o }) {
  const col = b[3] >= b[0] ? C.up : C.dn;
  return <g opacity={o}><line x1={L.PL} x2={L.PR} y1={y} y2={y} stroke={col} strokeOpacity={.5} strokeWidth={1} strokeDasharray="2 4" />
    <rect x={L.axisX - 8} y={y - 16} width={96} height={32} rx={5} fill={col} /><text x={L.axisX + 40} y={y + 7} fill="#fff" fontSize={18} fontWeight={650} fontFamily={SANS} textAnchor="middle">{fmt(b[3], dp)}</text></g>;
}

// the title — present from frame 0 to the last frame (it IS the loop seam), never animates
function Title({ d }) {
  // one line, always: the size comes from the length (bold caps ≈ .64em per character, 940px to fill)
  const [a, b] = d.copy.title, len = (a + (b ? " " + b : "")).length, size = Math.min(96, Math.floor(940 / (len * .64)));
  return <div style={{ position: "absolute", top: L.title + (96 - size) * .5, left: 40, right: 40, textAlign: "center", whiteSpace: "nowrap", fontFamily: SANS, fontSize: size, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05, color: C.text }}>
    <span style={{ ...ACC_TXT, paddingBottom: 6 }}>{a}</span>{b ? <span> {b}</span> : null}</div>;
}
function Chip({ d, o }) {
  return <div style={{ position: "absolute", top: L.chip, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, fontFamily: SANS, opacity: o }}>
    <Img src={staticFile(`m/${d.mk}.webp`)} style={{ width: 34, height: 34 }} />
    <span style={{ color: C.text, fontSize: 28, fontWeight: 650 }}>{d.mk}</span>
    <span style={{ color: C.dim, fontSize: 26, fontWeight: 500 }}>· {d.tf} · {d.copy.when}</span></div>;
}
function Brand({ o }) {
  return <div style={{ position: "absolute", top: L.brand, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, opacity: o }}>
    <Img src={staticFile("potion-glyph.png")} style={{ width: 34, height: 34 }} />
    <span style={{ color: "#fff", opacity: .92, fontFamily: SANS, fontSize: 26, fontWeight: 800, letterSpacing: 4 }}>CRTLAB</span></div>;
}

// one caption at a time in the band under the chart: one quiet entrance, a short exit
function Cap({ t, a, b, children, style }) {
  if (t < a || t >= b) return null;
  const k = eo(t, a, .38), out = ein(t, b - .25, .25);
  return <div style={{ position: "absolute", top: L.cap, left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontSize: 46, fontWeight: 680, letterSpacing: -.5, color: C.text,
    opacity: k * (1 - out), transform: `translateY(${(1 - k) * 12 - out * 8}px)`, ...style }}>{children}</div>;
}

// the end: chart dims, a search bar rises and types crtlab.pro, the CRTLAB result unfolds, a pointer clicks it → frame 0
function SignOff({ t, T }) {
  const a = T.dim + .15; if (t < a || t >= T.end) return null;
  const k = eo(t, a, .5), out = ein(t, T.out, .4), n = T.keys.reduce((m, [s, c]) => (t >= s ? c : m), 0), caret = t < T.typed + .1 ? 1 : Math.floor((t - T.typed) / .45) % 2 === 0 ? 1 : 0;
  const row = eo(t, T.row, .4), pm = ein(t, T.row + .2, .55), hover = eo(t, T.click - .25, .2), press = t >= T.click ? Math.sin(cl((t - T.click) / .18) * Math.PI) : 0;
  const px = mix(830, 700, pm), py = mix(560, 318, pm);
  return <div style={{ position: "absolute", left: 0, right: 0, top: 690, display: "flex", flexDirection: "column", alignItems: "center", fontFamily: SANS, opacity: k * (1 - out), transform: `translateY(${(1 - k) * 18}px) scale(${1 + .04 * out})` }}>
    <div style={{ width: 700, height: 96, borderRadius: 48, background: "linear-gradient(180deg, #1d1d21, #16161a)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.06), 0 30px 60px -20px #000", display: "flex", alignItems: "center", gap: 18, padding: "0 32px", boxSizing: "border-box" }}>
      <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#9a9ca6" strokeWidth={2.2} strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 L20.5 20.5" /></svg>
      <div style={{ display: "flex", alignItems: "center", fontSize: 42, fontWeight: 560, color: "#ececf1", whiteSpace: "pre" }}>{"crtlab.pro".slice(0, n)}
        <span style={{ display: "inline-block", width: 3, height: 44, marginLeft: 3, borderRadius: 2, background: C.acc, opacity: caret * (1 - row) }} /></div>
    </div>
    <div style={{ marginTop: 14, width: 700, height: 92, borderRadius: 30, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 20, padding: "0 32px", opacity: row,
      background: hover > 0 ? `rgb(${mix(29, 36, hover)},${mix(29, 38, hover)},${mix(33, 52, hover)})` : "#1d1d21", boxShadow: "inset 0 1px 0 rgba(255,255,255,.06), 0 30px 60px -20px #000",
      transform: `translateY(${(1 - row) * -12}px) scale(${(.97 + .03 * row) * (1 - .015 * press)})` }}>
      <span style={{ fontSize: 32, fontWeight: 760, backgroundImage: "linear-gradient(180deg, #8fd0ff, #3b8bf6)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>CRTLAB</span>
      <span style={{ width: 2, height: 34, background: "rgba(255,255,255,.16)" }} />
      <span style={{ fontSize: 28, fontWeight: 560, color: "#d9dbe2" }}>Backtesting &amp; Market Replay</span>
    </div>
    {pm > 0 ? <svg width={40} height={40} viewBox="0 0 24 24" style={{ position: "absolute", left: px, top: py, opacity: Math.min(1, pm * 3), transform: `scale(${1 - .12 * press})`, filter: "drop-shadow(0 4px 8px rgba(0,0,0,.6))" }}>
      <path d="M5 3 L5 19 L9.5 15 L12.5 21.5 L15 20.4 L12.1 14 L18 14 Z" fill="#fff" stroke="#0b0b0e" strokeWidth={1.2} strokeLinejoin="round" /></svg> : null}
  </div>;
}

// sound: the approved effect set (no synthesized blips), plus an optional quiet music bed
const at = (s) => Math.max(0, Math.round(s * FPS));
function Sfx({ d, G }) {
  const { T } = G, fx = (s, f, v) => <Sequence key={f + s} from={at(s)}><Audio src={staticFile(`sfx/${f}.wav`)} volume={v} /></Sequence>, o = [];
  if (d.zone && T.zone) o.push(fx(T.zone - .02, "draw", .22));
  if (T.level != null && !d.zone) o.push(fx(T.level, "draw", .2));
  if (d.bos) o.push(fx(T.bos, "pop", .2));
  (T.liq || []).forEach((s) => o.push(fx(s, "pop", .16)));
  o.push(fx(T.tCross - .02, "hit", .3));
  if (d.measure) o.push(fx(T.measure, "draw", .2));
  o.push(fx(T.result - .02, "chime", .3));
  T.keys.forEach(([s]) => o.push(fx(s, "k1", .45)));
  o.push(fx(T.click - .02, "e1", .5));
  if (d.music) { const dur = G.DUR; o.push(<Audio key="mus" src={staticFile(`music/${d.music}`)} volume={(f) => .16 * interpolate(f, [0, 18, dur - 30, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />); }
  return <>{o}</>;
}

export const Reel = (d) => {
  const t = useCurrentFrame() / FPS, G = useMemo(() => build(d), [d]), { T, X, Y } = G, cp = d.copy, cam = d.look?.cam || "lean";
  // camera: lean = a gentle push onto the entry and back · push = slow drift in across the build · still. Always exactly 1 before the end.
  let s = 1, fx = X(d.kb), fy = Y(d.level);
  if (cam === "lean") s = 1 + .075 * (t < T.tCross + .2 ? ein(t, T.tKey0 - .4, T.tCross - T.tKey0 + .6) : 1 - ein(t, T.tCross + .7, .8));
  if (cam === "push") { s = 1 + .045 * (t < T.hold ? ein(t, 0, T.hold) : 1 - ein(t, T.hold, .6)); fx = (L.PL + L.PR) / 2; fy = (L.PT + L.PB) / 2; }
  const tr = s !== 1 ? `translate(${fx} ${fy}) scale(${s}) translate(${-fx} ${-fy})` : undefined, mp = (x, y) => [fx + (x - fx) * s, fy + (y - fy) * s];
  // end: everything except the title dims under the search bar, then the chart returns empty = frame 0
  const dim = ein(t, T.dim, .5), back = ein(t, T.out + .05, .45), chartA = t >= T.out ? 0 : 1 - .9 * dim, emptyA = back;
  const tt = Math.min(t, T.out);
  let lastB = null; for (let i = 0; i <= T.last; i++) { const b = partial(G.B[i], prog(G.sch[i], tt)); if (b) lastB = b; }
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: SANS }}>
      <svg width={W} height={1920} style={{ position: "absolute", inset: 0 }}>
        <defs><clipPath id="plot"><rect x={L.PL - 30} y={L.PT - 40} width={L.PR - L.PL + 60} height={L.PB - L.PT + 80} /></clipPath></defs>
        <Axes d={d} G={G} o={1 - .9 * dim * (1 - back) } />
        <g clipPath="url(#plot)">
          {chartA > 0 ? <g opacity={chartA} transform={tr}><World t={tt} d={d} G={G} /></g> : null}
        </g>
        {chartA > 0 && lastB ? <PriceTag b={lastB} y={mp(0, Y(lastB[3]))[1]} dp={d.dp} o={chartA} /> : null}
        {chartA > 0 ? <g opacity={chartA}><Result t={t} d={d} G={G} mp={mp} /></g> : null}
      </svg>
      <Title d={d} />
      <Chip d={d} o={1 - .9 * dim * (1 - back)} />
      <Brand o={1 - .9 * dim * (1 - back)} />
      <Cap t={t} a={T.cap1[0]} b={T.cap1[1]}>{cp.cap1}</Cap>
      <Cap t={t} a={T.cap2[0]} b={T.cap2[1]}>{cp.cap2}</Cap>
      <Cap t={t} a={T.cap3[0]} b={T.cap3[1]}><span style={{ color: d.trade || d.side === "high" ? "#3fd1a8" : "#ff6b7d" }}>{cp.cap3[0]}</span>{cp.cap3[1] ? ` ${cp.cap3[1]}` : ""}</Cap>
      <SignOff t={t} T={T} />
      <Sfx d={d} G={G} />
    </AbsoluteFill>
  );
};
