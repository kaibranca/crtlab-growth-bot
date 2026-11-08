import React, { useMemo } from "react";
import { AbsoluteFill, Img, useCurrentFrame, staticFile } from "remotion";
import { build, camera, partial, prog, EIO, OUT, FPS, W, L } from "./tl.mjs";
// THE REEL (v3) — a short lesson on a real chart. Title on top (the hook, never moves: it is the loop seam), the chart replays
// from real 1-minute data, the camera eases onto each step, one caption teaches each step, the domain is typed at the end and the
// picture returns to frame 0. Brand: TradingView candles, shades not outlines, white type, one violet accent. Sound is mixed
// offline (engine/mix.mjs) from the same timeline.
const C = { bg: "#050506", text: "#f2f2f4", dim: "#8f929b", axis: "#6c6f78", up: "#089981", dn: "#f23645", lvl: "#d1d4dc", tv: "#2962ff", acc: "#9d7bff", acc2: "#7e57c2", pill: "#24252b" };
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Roboto, sans-serif';
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), mix = (a, b, k) => a + (b - a) * k, eo = (t, a, d) => OUT((t - a) / d), ein = (t, a, d) => EIO((t - a) / d);
const ACC_TXT = { backgroundImage: `linear-gradient(180deg, #c6b2ff, ${C.acc2})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" };
const fmt = (v, dp) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
function ticks(lo, hi, n = 6) { const raw = (hi - lo) / n, m = Math.pow(10, Math.floor(Math.log10(raw))), s = [1, 2, 2.5, 5, 10].map((k) => k * m).find((k) => k >= raw); const o = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) o.push(+v.toFixed(10)); return { o, s }; }
const pillW = (text, size) => text.length * size * .58 + 22;

function Pill({ x, y, text, bg, size = 19, o = 1 }) { // x,y = top-left
  const w = pillW(text, size), h = size * 1.6;
  return <g opacity={o}><rect x={x} y={y} width={w} height={h} rx={6} fill={bg} /><text x={x + w / 2} y={y + h * .68} fill="#fff" fontSize={size} fontWeight={650} fontFamily={SANS} textAnchor="middle">{text}</text></g>;
}

export const Reel = (d) => {
  const t = useCurrentFrame() / FPS, G = useMemo(() => build(d), [d]), { T, X, Y, B, BW, cw, beats } = G;
  const on = (key) => { const b = beats.find((x) => x.show?.includes(key)); return b ? b.t : Infinity; };
  const cam = camera(G, t), PCX = (L.PL + L.PR) / 2, PCY = (L.PT + L.PB) / 2;
  const mp = (x, y) => [PCX + (x - cam.cx) * cam.s, PCY + (y - cam.cy) * cam.s];            // world → screen
  const tr = `translate(${PCX} ${PCY}) scale(${cam.s}) translate(${-cam.cx} ${-cam.cy})`;
  const dim = ein(t, T.dim, .55), chartA = 1 - .92 * dim, fade = t >= T.out ? 0 : 1;
  const tt = Math.min(t, T.dim + .6), long = d.trade ? d.trade.side === "long" : d.side === "high";

  // candles drawn so far (world space)
  const drawn = []; for (let i = 0; i <= T.last; i++) { const b = partial(B[i], prog(G.sch[i], tt)); if (b) drawn.push([i, b]); }
  const lastB = drawn.length ? drawn[drawn.length - 1][1] : null;
  // label placement: try spots in order, take the first whose screen box doesn't touch a drawn candle or leave the plot
  const free = (x, y, w, h) => { if (x < L.PL - 4 || x + w > L.PR + 4 || y < L.PT - 6 || y + h > L.PB + 6) return false;
    for (const [i, b] of drawn) { const [cx] = mp(X(i), 0), half = cw * cam.s / 2 + 6; if (cx + half < x || cx - half > x + w) continue; const yt = mp(0, Y(b[1]))[1] - 6, yb = mp(0, Y(b[2]))[1] + 6; if (yb > y && yt < y + h) return false; } return true; };
  const place = (spots, w, h) => spots.find(([x, y]) => free(x, y, w, h)) || spots[0];

  const world = [], labels = [];
  // zone shade (FVG / OB / Asia / opening range) — grows right, label placed clear of candles
  const tz = on("zone");
  if (d.zone && t >= tz) {
    const range = d.model === "asia" || d.model === "nyopen", used = d.trade && t >= T.tCross;
    // a session range covers its own hours only; a trading zone (FVG / OB) extends right until it's used
    const k = eo(t, tz, .55), x0 = X(d.zone.i0) - BW / 2, xEnd = range ? X(d.zone.i1) + BW / 2 : X(T.last) + BW * .7, x1 = mix(x0 + BW * .5, xEnd, k), y0 = Y(d.zone.top), y1 = Y(d.zone.bot);
    world.push(<rect key="z" x={x0} y={y0} width={x1 - x0} height={Math.max(2, y1 - y0)} fill={range ? "#fff" : C.acc} fillOpacity={(range ? .07 : .22) * (used ? .7 : 1)} />);
    const [sx0, sy0] = mp(x0, y0), [, sy1] = mp(x0, y1), w = pillW(d.zone.label, 18), h = 29;
    const [lx, ly] = place([[sx0, sy0 - h - 6], [sx0, sy1 + 6], [sx0 - w - 8, sy0], [sx0 + 4, sy0 + 4]], w, h);
    labels.push(<Pill key="zl" x={lx} y={ly} text={d.zone.label} bg={range ? C.pill : C.acc2} size={18} o={eo(t, tz + .2, .35)} />);
  }
  // FVG: number the three candles so "wick 1 to wick 3" reads
  const t3 = on("three");
  const t3off = on("entry"), k3 = 1 - ein(t, t3off - .3, .4); // numbers leave once the gap is marked and price heads back
  if (d.zone && d.model === "fvg" && t >= t3 && k3 > 0) [0, 1, 2].forEach((j) => { const i = d.zone.i0 + j, b = B[i], [sx, sy] = mp(X(i), Y(long ? b.l : b.h)), k = eo(t, t3 + j * .12, .35) * k3;
    labels.push(<text key={"n" + j} x={sx} y={long ? sy + 34 : sy - 14} fill={C.text} fontSize={24} fontWeight={750} fontFamily={SANS} textAnchor="middle" opacity={k}>{j + 1}</text>); });
  // key level (PDH / PDL / Asia / OR / release price)
  const tl = on("level");
  if (t >= tl && d.model !== "fvg" && d.model !== "ob") {
    const k = ein(t, tl, .6), hit = t >= T.tCross && on("cross") <= t + 2, y = Y(d.level), x0 = d.model === "news" ? X(d.kb) - BW / 2 : X(0) - BW / 2, x1 = mix(x0, X(T.last) + BW * .7, k);
    const col = hit ? (d.side === "high" ? C.up : C.dn) : C.lvl, flash = hit ? Math.exp(-(t - T.tCross) * 3) : 0;
    world.push(<line key="l" x1={x0} x2={x1} y1={y} y2={y} stroke={col} strokeOpacity={hit ? .95 : .65} strokeWidth={(1.6 + 1.4 * flash) / cam.s} strokeDasharray={d.model === "news" ? `${6 / cam.s} ${6 / cam.s}` : undefined} />);
    if (d.model === "news") { const xv = X(d.kb) - BW / 2; world.push(<line key="nv" x1={xv} x2={xv} y1={Y(G.HI)} y2={Y(G.LO)} stroke="#fff" strokeOpacity={.2 * k} strokeWidth={1.2 / cam.s} strokeDasharray={`${3 / cam.s} ${5 / cam.s}`} />); }
    const [sx, sy] = mp(x0, y), w = pillW(d.levelLabel, 18), h = 29;
    const [lx, ly] = place([[sx + 6, sy - h - 6], [sx + 6, sy + 6], [L.PR - w, sy - h - 6], [L.PR - w, sy + 6]], w, h);
    labels.push(<Pill key="ll" x={lx} y={ly} text={d.levelLabel} bg={hit ? col : C.pill} size={18} o={eo(t, tl + .25, .35)} />);
  }
  // break of structure
  const tb = on("bos");
  if (d.bos && t >= tb) {
    const k = ein(t, tb, .5), y = Y(d.bos.price), x0 = X(d.bos.i0), x1 = mix(x0, X(d.bos.i1), k);
    world.push(<line key="b" x1={x0} x2={x1} y1={y} y2={y} stroke={C.lvl} strokeOpacity={.8} strokeWidth={1.5 / cam.s} strokeDasharray={`${6 / cam.s} ${5 / cam.s}`} />);
    const [sa, sy] = mp((x0 + X(d.bos.i1)) / 2, y), w = pillW("BOS", 17), h = 27;
    const [lx, ly] = place([[sa - w / 2, long ? sy - h - 8 : sy + 8], [sa - w / 2, long ? sy + 8 : sy - h - 8], [mp(x0, 0)[0] - w - 6, sy - h / 2]], w, h);
    labels.push(<Pill key="bl" x={lx} y={ly} text="BOS" bg={C.pill} size={17} o={eo(t, tb + .25, .35)} />);
  }
  // liquidity $ on the pullback swings; dims once price takes it
  const tq = on("liq");
  if (d.liq && t >= tq) d.liq.forEach((q, j) => { const k = eo(t, tq + j * .18, .35), taken = t >= T.tCross ? ein(t, T.tCross, .5) : 0, [sx, sy] = mp(X(q.i), Y(q.price));
    labels.push(<text key={"q" + j} x={sx} y={long ? sy + 32 : sy - 14} fill={C.acc} fontSize={26} fontWeight={800} fontFamily={SANS} textAnchor="middle" opacity={k * (1 - .7 * taken)}>$</text>); });
  // entry marker at the tap
  const te = on("entry");
  if (d.trade && t >= Math.max(te, T.tCross)) { const tr0 = d.trade, b = B[tr0.iE], [ex, ey0] = mp(X(tr0.iE), Y(long ? b.l : b.h)), ey = long ? ey0 + 24 : ey0 - 24, s = 12 * eo(t, T.tCross, .3);
    labels.push(<path key="e" d={long ? `M${ex} ${ey - s} L${ex - s} ${ey + s * .85} L${ex + s} ${ey + s * .85} Z` : `M${ex} ${ey + s} L${ex - s} ${ey - s * .85} L${ex + s} ${ey - s * .85} Z`} fill={long ? C.up : C.dn} />); }
  // position tool: target + stop shades, labels on the right
  const tt0 = on("tool");
  if (d.trade && t >= tt0) {
    const tr0 = d.trade, k = eo(t, tt0, .5), x0 = X(tr0.iE) - BW / 2, x1 = mix(x0 + BW, X(T.last) + BW * .7, k), ye = Y(tr0.entry), yt = Y(tr0.target), ys = Y(tr0.stop), paid = T.tPay && t >= T.tPay ? ein(t, T.tPay, .4) : 0;
    world.push(<g key="p"><rect x={x0} y={Math.min(ye, yt)} width={x1 - x0} height={Math.abs(yt - ye)} fill={C.up} fillOpacity={.17 + .1 * paid} />
      <rect x={x0} y={Math.min(ye, ys)} width={x1 - x0} height={Math.abs(ys - ye)} fill={C.dn} fillOpacity={.17 * (1 - .5 * paid)} />
      <line x1={x0} x2={x1} y1={ye} y2={ye} stroke="#fff" strokeOpacity={.75} strokeWidth={1.3 / cam.s} /></g>);
    const [rx] = mp(x1, 0), [, syt] = mp(0, yt), [, sys] = mp(0, ys), o = eo(t, tt0 + .3, .35);
    const wT = pillW("Target 2R", 16), wS = pillW("Stop", 16), hP = 26;
    const [tx, ty] = place([[rx + 8, long ? syt - hP - 4 : syt + 4], [rx - wT - 4, long ? syt - hP - 4 : syt + 4], [mp(x0, 0)[0] - wT - 8, syt - hP / 2]], wT, hP);
    const [qx, qy] = place([[rx + 8, long ? sys + 4 : sys - hP - 4], [rx - wS - 4, long ? sys + 4 : sys - hP - 4], [mp(x0, 0)[0] - wS - 8, sys - hP / 2]], wS, hP);
    labels.push(<Pill key="tl" x={tx} y={ty} text="Target 2R" bg={C.up} size={16} o={o * (1 - paid)} />);
    labels.push(<Pill key="sl" x={qx} y={qy} text="Stop" bg={C.dn} size={16} o={o * (1 - paid)} />);
  }
  // results
  const tres = on("result");
  if (d.trade && t >= Math.max(tres, T.tPay ?? 0)) { const a = Math.max(tres, T.tPay), k = eo(t, a, .4), [sx, sy] = mp(X(d.trade.iX), Y(d.trade.target)), w = pillW("+2R", 22);
    labels.push(<g key="r" opacity={k} transform={`translate(0 ${(1 - k) * 8})`}><rect x={Math.min(L.PR - w, sx + BW * cam.s)} y={long ? sy - 42 : sy + 8} width={w} height={35} rx={8} fill={C.up} opacity={.6 * Math.sin(cl((t - a) / 1.4) * Math.PI)} filter="url(#glow)" /><Pill x={Math.min(L.PR - w, sx + BW * cam.s)} y={long ? sy - 42 : sy + 8} text="+2R" bg={C.up} size={22} /></g>); }
  const tm = on("measure");
  if (d.measure && t >= tm) {
    const m = d.measure, p = ein(t, tm, .6), x0 = X(m.i0), x1 = X(Math.min(m.i1, T.last)), y0 = Y(m.from), y1 = mix(y0, Y(m.to), p), lx = (x0 + x1) / 2;
    world.push(<g key="m"><rect x={x0} y={Math.min(y0, y1)} width={Math.max(4, x1 - x0)} height={Math.abs(y1 - y0)} fill={C.tv} fillOpacity={.16} />
      <line x1={lx} x2={lx} y1={y0} y2={y1} stroke={C.tv} strokeWidth={1.6 / cam.s} /></g>);
    const up = m.to > m.from, pct = Math.abs((m.to - m.from) / m.from * 100).toFixed(2), txt = `${up ? "+" : "−"}${d.copy.mv} (${pct}%)`, w = pillW(txt, 19);
    const [sx, sy] = mp(lx, Y(m.to)), py = up ? sy - 40 : sy + 10;
    labels.push(<Pill key="ml" x={cl(sx - w / 2, L.PL, L.PR - w)} y={cl(py, L.PT, L.PB - 30)} text={txt} bg={C.tv} size={19} o={eo(t, tm + .45, .35)} />);
  }

  // small finishing touches: one soft glow per moment, then gone (entry tap, level break, payoff)
  const glow = (key, x, y, r, col, a, len = .9) => { if (t < a || t > a + len) return; const k = Math.sin(cl((t - a) / len) * Math.PI);
    labels.unshift(<circle key={key} cx={x} cy={y} r={r} fill={col} opacity={.55 * k} filter="url(#glow)" />); };
  if (d.trade && isFinite(T.tCross)) { const [gx, gy] = mp(X(d.trade.iE), Y(d.trade.entry)); glow("ge", gx, gy, 16, long ? C.up : C.dn, T.tCross); }
  if (!d.trade && isFinite(T.tCross) && t >= on("cross")) { const [gx, gy] = mp(X(d.kb), Y(d.level)); glow("gl", gx, gy, 18, d.side === "high" ? C.up : C.dn, T.tCross); }
  if (d.trade && T.tPay && t >= tres) { const [gx, gy] = mp(X(d.trade.iX), Y(d.trade.target)); glow("gp", gx + 30, gy, 26, C.up, Math.max(tres, T.tPay), 1.2); }
  // pointer arrow: each step can point at the thing it teaches — draws itself in (progressive geometry, no dash tricks), leaves with the step
  const cur = beats.filter((b) => t >= b.t).pop();
  if (cur?.point && t < (beats[cur.i + 1]?.t ?? T.dim)) {
    const [tx, ty] = mp(X(cur.point.i), Y(cur.point.price)), end = beats[cur.i + 1]?.t ?? T.dim, p = OUT((t - cur.t - .15) / .45), o = 1 - ein(t, end - .3, .3);
    const opts = [[-110, -95], [110, -95], [-110, 95], [110, 95]].map(([dx, dy]) => [tx + dx, ty + dy]);
    const [sx, sy] = opts.find(([x, y]) => free(Math.min(x, tx) - 10, Math.min(y, ty) - 10, Math.abs(x - tx) * .6 + 20, Math.abs(y - ty) * .6 + 20) && y > L.PT + 10 && y < L.PB - 10 && x > L.PL && x < L.PR) || opts[0];
    const ux = tx - sx, uy = ty - sy, ln = Math.hypot(ux, uy), nx = ux / ln, ny = uy / ln, ex = tx - nx * 18, ey = ty - ny * 18, bend = (sx < tx ? 1 : -1) * 26;
    const qx = (sx + ex) / 2 - ny * bend, qy = (sy + ey) / 2 + nx * bend, pts = [];
    for (let j = 0; j <= 24 * p; j++) { const u = j / 24, a1 = (1 - u) * (1 - u), b1 = 2 * (1 - u) * u, c1 = u * u; pts.push(`${a1 * sx + b1 * qx + c1 * ex},${a1 * sy + b1 * qy + c1 * ey}`); }
    const hx = ex - qx, hy = ey - qy, hl = Math.hypot(hx, hy) || 1, ax = hx / hl, ay = hy / hl, hk = cl((p - .85) / .15);
    if (pts.length > 1) labels.push(<g key="ptr" opacity={o}><polyline points={pts.join(" ")} fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
      {hk > 0 ? <path d={`M${ex + ax * 2} ${ey + ay * 2} L${ex - ax * 14 * hk - ay * 9 * hk} ${ey - ay * 14 * hk + ax * 9 * hk} L${ex - ax * 14 * hk + ay * 9 * hk} ${ey - ay * 14 * hk - ax * 9 * hk} Z`} fill="#fff" /> : null}</g>);
  }

  // axes follow the camera (like TradingView): visible price / time range recomputed every frame
  const vTop = G.HI - ((cam.cy - (L.PB - L.PT) / 2 / cam.s) - L.PT) / (L.PB - L.PT) * (G.HI - G.LO), vBot = G.HI - ((cam.cy + (L.PB - L.PT) / 2 / cam.s) - L.PT) / (L.PB - L.PT) * (G.HI - G.LO);
  const step = ticks(G.LO, G.HI, 7).s, tk = { s: step, o: [] }; for (let v = Math.ceil(vBot / step) * step; v <= vTop; v += step) tk.o.push(+v.toFixed(10)); const _ = 0, dpA = Math.max(0, Math.min(d.dp, Math.ceil(-Math.log10(tk.s) + .3)));
  const every = Math.max(1, Math.round(G.N / 4 / cam.s));
  const axisA = 1 - .9 * dim;
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: SANS }}>
      <svg width={W} height={1920} style={{ position: "absolute", inset: 0 }}>
        <defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" /></filter><clipPath id="plot"><rect x={L.PL - 20} y={L.PT - 10} width={L.PR - L.PL + 40} height={L.PB - L.PT + 20} /></clipPath></defs>
        <g opacity={axisA * fade}>
          {tk.o.map((v) => { const y = PCY + (Y(v) - cam.cy) * cam.s; if (y < L.PT + 10 || y > L.PB - 10) return null;
            return <g key={v}><line x1={L.PL} x2={L.PR} y1={y} y2={y} stroke="#fff" strokeOpacity={.05} strokeDasharray="1 5" /><text x={L.axisX} y={y + 7} fill={C.axis} fontSize={19} fontFamily={SANS}>{fmt(v, dpA)}</text></g>; })}
          {B.map((b, i) => { if (i % every) return null; const [x] = mp(X(i), 0); if (x < L.PL + 30 || x > L.PR - 30) return null; return <text key={i} x={x} y={L.timeY} fill={C.axis} fontSize={19} fontFamily={SANS} textAnchor="middle">{b.lab}</text>; })}
        </g>
        <g opacity={chartA * fade} clipPath="url(#plot)"><g transform={tr}>
          {world}
          {drawn.map(([i, b]) => { const col = b[3] >= b[0] ? C.up : C.dn, y0 = Y(Math.max(b[0], b[3])), y1 = Y(Math.min(b[0], b[3]));
            return <g key={i}><line x1={X(i)} x2={X(i)} y1={Y(b[1])} y2={Y(b[2])} stroke={col} strokeWidth={Math.max(1.3, cw * .1) / Math.sqrt(cam.s)} /><rect x={X(i) - cw / 2} y={y0} width={cw} height={Math.max(1.4 / cam.s, y1 - y0)} fill={col} /></g>; })}
        </g></g>
        <g opacity={chartA * fade}>{labels}</g>
        {lastB && fade ? (() => { const col = lastB[3] >= lastB[0] ? C.up : C.dn, y = cl(PCY + (Y(lastB[3]) - cam.cy) * cam.s, L.PT + 6, L.PB - 6);
          return <g opacity={chartA}><line x1={L.PL} x2={L.PR} y1={y} y2={y} stroke={col} strokeOpacity={.45} strokeDasharray="2 4" /><rect x={L.axisX - 8} y={y - 16} width={98} height={32} rx={5} fill={col} />
            <text x={L.axisX + 41} y={y + 7} fill="#fff" fontSize={18} fontWeight={650} fontFamily={SANS} textAnchor="middle">{fmt(lastB[3], d.dp)}</text></g>; })() : null}
      </svg>
      <Title d={d} />
      <div style={{ position: "absolute", top: L.chip, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, opacity: axisA }}>
        <Img src={staticFile(`m/${d.mk}.webp`)} style={{ width: 34, height: 34 }} />
        <span style={{ color: C.text, fontSize: 28, fontWeight: 650 }}>{d.mk}</span>
        <span style={{ color: C.dim, fontSize: 26, fontWeight: 500 }}>· {d.tf} · {d.copy.when}</span></div>
      {beats.map((b, j) => <Caption key={j} t={t} a={b.t} z={j + 1 < beats.length ? beats[j + 1].t - .05 : T.dim + .1} b={b} />)}
      <div style={{ position: "absolute", top: L.brand, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, opacity: axisA * .9 }}>
        <Img src={staticFile("potion-glyph.png")} style={{ width: 30, height: 30 }} />
        <span style={{ color: "#fff", fontSize: 24, fontWeight: 800, letterSpacing: 4 }}>CRTLAB</span></div>
      <SignOff t={t} T={T} />
    </AbsoluteFill>
  );
};

// the title — the hook. Identical on every frame (it is the loop seam). One line, sized to fit.
function Title({ d }) {
  const [a, b] = d.copy.title, len = (a + (b ? " " + b : "")).length, size = Math.min(96, Math.floor(940 / (len * .64)));
  return <div style={{ position: "absolute", top: L.title + (96 - size) * .5, left: 40, right: 40, textAlign: "center", whiteSpace: "nowrap", fontFamily: SANS, fontSize: size, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05, color: C.text }}>
    <span style={{ ...ACC_TXT, paddingBottom: 6, filter: "drop-shadow(0 0 18px rgba(157,123,255,.28))" }}>{a}</span>{b ? <span> {b}</span> : null}</div>;
}
// one caption per step, in the band under the chart: soft rise in, soft fade out, nothing moving at rest; up to 2 lines
function Caption({ t, a, z, b }) {
  if (t < a || t >= z) return null;
  const k = eo(t, a, .4), out = ein(t, z - .22, .22), col = b.tone === "up" ? "#3fd1a8" : b.tone === "dn" ? "#ff6b7d" : C.text;
  return <div style={{ position: "absolute", top: L.cap, left: 130, right: 130, textAlign: "center", fontFamily: SANS, fontSize: 44, fontWeight: 650, lineHeight: 1.18, letterSpacing: -.4, color: col,
    opacity: k * (1 - out), transform: `translateY(${(1 - k) * 10}px)` }}>{b.cap}</div>;
}
// the end: the chart dims, a search bar types crtlab.pro, the CRTLAB result row settles under it, then it all fades to frame 0
function SignOff({ t, T }) {
  const a = T.dim + .2; if (t < a || t >= T.end) return null;
  const k = eo(t, a, .55), out = ein(t, T.out, .5), n = T.keys.reduce((m, [s, c]) => (t >= s ? c : m), 0), caret = t < T.typed + .15 ? 1 : 0, row = eo(t, T.row, .5);
  return <div style={{ position: "absolute", left: 0, right: 0, top: 700, display: "flex", flexDirection: "column", alignItems: "center", fontFamily: SANS, opacity: k * (1 - out), transform: `translateY(${(1 - k) * 14}px)` }}>
    <div style={{ width: 680, height: 92, borderRadius: 46, background: "#18181c", display: "flex", alignItems: "center", gap: 18, padding: "0 32px", boxSizing: "border-box" }}>
      <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#8d8f99" strokeWidth={2.2} strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 L20.5 20.5" /></svg>
      <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 560, color: "#ececf1", whiteSpace: "pre" }}>{"crtlab.pro".slice(0, n)}
        <span style={{ display: "inline-block", width: 3, height: 42, marginLeft: 3, borderRadius: 2, background: C.acc, opacity: caret }} /></div>
    </div>
    <div style={{ marginTop: 14, width: 680, height: 88, borderRadius: 28, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 20, padding: "0 32px", background: "#18181c", opacity: row, transform: `translateY(${(1 - row) * -10}px)` }}>
      <span style={{ fontSize: 31, fontWeight: 760, color: "#5aa9ff" }}>CRTLAB</span>
      <span style={{ width: 2, height: 32, background: "rgba(255,255,255,.14)" }} />
      <span style={{ fontSize: 27, fontWeight: 560, color: "#d9dbe2" }}>Backtesting &amp; Market Replay</span>
    </div>
  </div>;
}
