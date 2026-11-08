import React, { useMemo } from "react";
import { AbsoluteFill, Img, useCurrentFrame, staticFile } from "remotion";
import { build, camera, partial, prog, EIO, OUT, FPS, W, L } from "./tl.mjs";
// THE REEL (v4) — a lesson on a real chart. The title is the hook (static: it is the loop seam). Candles replay from real
// 1-minute data, forming one way (no jitter). The camera eases onto each step. Each step's words sit NEXT TO what they describe,
// with an arrow from the words to it, so the eye never leaves the chart. Every label/callout position is solved ONCE per step
// against the candles and the other labels (no overlap, no jumping). Ends: type crtlab.pro → click the result → frame 0.
const C = { bg: "#050506", text: "#f2f2f4", dim: "#8f929b", axis: "#6c6f78", up: "#089981", dn: "#f23645", lvl: "#d1d4dc", tv: "#2962ff", acc: "#4d8dff", pill: "#24252b" };
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Roboto, sans-serif';
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), mix = (a, b, k) => a + (b - a) * k, eo = (t, a, d) => OUT((t - a) / d), ein = (t, a, d) => EIO((t - a) / d);
const ACC_TXT = { color: C.acc }; // solid blue highlight (Kai 11-09: no purple, no gradient text)
const fmt = (v, dp) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
function ticks(lo, hi, n = 7) { const raw = (hi - lo) / n, m = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((k) => k * m).find((k) => k >= raw); }
const ICON = { // 14px glyphs drawn inside pills
  check: (x, y) => <path d={`M${x} ${y + 7} l4.5 4.5 l8.5 -9`} fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />,
  x: (x, y) => <path d={`M${x + 1} ${y + 2} l10 10 M${x + 11} ${y + 2} l-10 10`} stroke="#fff" strokeWidth={2.6} strokeLinecap="round" />,
  bolt: (x, y) => <path d={`M${x + 8} ${y} L${x + 1} ${y + 8} L${x + 6} ${y + 8} L${x + 4} ${y + 15} L${x + 11} ${y + 6} L${x + 6} ${y + 6} Z`} fill="#fff" />,
  clock: (x, y) => <g fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round"><circle cx={x + 7} cy={y + 7.5} r={6.5} /><path d={`M${x + 7} ${y + 4} v4 l3 2`} /></g>,
};
const pillW = (text, size, icon) => text.length * size * .58 + 22 + (icon ? 20 : 0);
function Pill({ x, y, text, bg, size = 18, o = 1, icon }) {
  const w = pillW(text, size, icon), h = size * 1.6;
  return <g opacity={o}><rect x={x} y={y} width={w} height={h} rx={7} fill={bg} />
    {icon ? ICON[icon](x + 11, y + h / 2 - 7.5) : null}
    <text x={x + (icon ? 20 : 0) + (w - (icon ? 20 : 0)) / 2} y={y + h * .68} fill="#fff" fontSize={size} fontWeight={650} fontFamily={SANS} textAnchor="middle">{text}</text></g>;
}
const capSize = (text) => { const lines = text.length > 22 ? 2 : 1, w = Math.min(430, Math.ceil(text.length / lines) * 21 + 34); return { w, h: lines * 48 + 18, lines }; };

export const Reel = (d) => {
  const t = useCurrentFrame() / FPS, G = useMemo(() => build(d), [d]), { T, X, Y, B, BW, cw, beats } = G;
  const long = d.trade ? d.trade.side === "long" : d.side === "high";
  const PCX = (L.PL + L.PR) / 2, PCY = (L.PT + L.PB) / 2;
  const mpOf = (cam) => (x, y) => [PCX + (x - cam.cx) * cam.s, PCY + (y - cam.cy) * cam.s];

  // ── every label + callout, solved once ────────────────────────────────────────────────────────────────────────────
  const specs = useMemo(() => {
    const on = (key) => { const b = beats.find((x) => x.show?.includes(key)); return b ? b.t : Infinity; }, S = [];
    const lastX = X(T.last) + BW * .7, z = d.zone;
    if (z && isFinite(on("zone"))) { const range = d.model === "asia" || d.model === "nyopen", icon = range ? "clock" : null, w = pillW(z.label, 18, icon), h = 29, zh = (Y(z.bot) - Y(z.top));
      S.push({ key: "zone", t0: on("zone") + .2, anchor: [X(z.i0) - BW / 2, Y(z.top)], w, h, cands: (s) => [[0, -h - 6], [0, zh * s + 6], [-w - 8, 0], [6, 6]], draw: (x, y, o) => <Pill x={x} y={y} text={z.label} bg={range ? C.pill : C.acc} o={o} icon={icon} /> }); }
    if (isFinite(on("level")) && d.model !== "fvg" && d.model !== "ob") { const icon = d.model === "news" ? "bolt" : null, w = pillW(d.levelLabel, 18, icon), h = 29, x0 = d.model === "news" ? X(d.kb) - BW / 2 : X(0) - BW / 2;
      S.push({ key: "level", t0: on("level") + .25, anchor: [x0, Y(d.level)], w, h, hitCol: true, cands: (s) => [[8, -h - 6], [8, 6], [(lastX - x0) * s - w, -h - 6], [(lastX - x0) * s - w, 6]], draw: (x, y, o, hit) => <Pill x={x} y={y} text={d.levelLabel} bg={hit ? (d.side === "high" ? C.up : C.dn) : C.pill} o={o} icon={icon} /> }); }
    if (d.bos) { const w = pillW("BOS", 17), h = 27, mx = (X(d.bos.i0) + X(d.bos.i1)) / 2;
      S.push({ key: "bos", t0: on("bos") + .25, anchor: [mx, Y(d.bos.price)], w, h, cands: () => [[-w / 2, long ? -h - 8 : 8], [-w / 2, long ? 8 : -h - 8], [-w - 40, -h / 2]], draw: (x, y, o) => <Pill x={x} y={y} text="BOS" bg={C.pill} size={17} o={o} /> }); }
    if (d.trade && isFinite(on("tool"))) { const tr = d.trade, wT = pillW("Target", 16, "check"), wS = pillW("Stop", 16, "x"), h = 26;
      S.push({ key: "tgt", t0: on("tool") + .3, t1: T.tPay, anchor: [lastX, Y(tr.target)], w: wT, h, cands: () => [[8, -h / 2], [-wT - 6, long ? -h - 4 : 4], [-wT - 6, long ? 4 : -h - 4]], draw: (x, y, o) => <Pill x={x} y={y} text="Target" bg={C.up} size={16} o={o} icon="check" /> });
      S.push({ key: "stop", t0: on("tool") + .3, t1: T.tPay, anchor: [lastX, Y(tr.stop)], w: wS, h, cands: () => [[8, -h / 2], [-wS - 6, long ? 4 : -h - 4], [-wS - 6, long ? -h - 4 : 4]], draw: (x, y, o) => <Pill x={x} y={y} text="Stop" bg={C.dn} size={16} o={o} icon="x" /> }); }
    if (d.trade && isFinite(on("result"))) { const w = pillW("+2R", 22, "check"), h = 35, a = Math.max(on("result"), T.tPay ?? 0);
      S.push({ key: "res", t0: a, anchor: [X(d.trade.iX), Y(d.trade.target)], w, h, rise: true, cands: (s) => [[BW * s * .8 + 6, long ? -h - 8 : 8], [-w - BW * s * .8, long ? -h - 8 : 8], [BW * s + 6, -h / 2]], draw: (x, y, o) => <Pill x={x} y={y} text="+2R" bg={C.up} size={22} o={o} icon="check" /> }); }
    if (d.measure && isFinite(on("measure"))) { const m = d.measure, up = m.to > m.from, pct = Math.abs((m.to - m.from) / m.from * 100).toFixed(2), txt = `${up ? "+" : "−"}${d.copy.mv} (${pct}%)`, w = pillW(txt, 19), h = 30;
      S.push({ key: "meas", t0: on("measure") + .5, anchor: [(X(m.i0) + X(Math.min(m.i1, T.last))) / 2, Y(m.to)], w, h, cands: () => [[-w / 2, up ? -h - 10 : 10], [-w / 2, up ? 10 : -h - 10], [-w - 20, -h / 2], [20, -h / 2]], draw: (x, y, o) => <Pill x={x} y={y} text={txt} bg={C.tv} size={19} o={o} /> }); }
    // callouts: the words for each step, beside the thing they point at
    beats.forEach((b, j) => { if (!b.cap || !b.point) return; const { w, h } = capSize(b.cap), end = j + 1 < beats.length ? beats[j + 1].t - .05 : T.dim + .1;
      S.push({ key: "cap" + j, t0: b.t, t1: end, callout: b, anchor: [X(b.point.i), Y(b.point.price)], w, h,
        cands: () => [[-w - 70, -h - 56], [70, -h - 56], [-w - 70, 56], [70, 56], [-w / 2, -h - 92], [-w / 2, 92], [-w - 96, -h / 2], [96, -h / 2], [-w - 40, -h - 130], [40, 130]] }); });
    // solve: earliest first; each against the candles drawn at its moment, the camera settled, and every label alive with it
    const done = [];
    for (const sp of S.sort((a, b) => (a.callout ? 1 : 0) - (b.callout ? 1 : 0) || a.t0 - b.t0)) {   // fixed labels first, callouts flow around them
      const tRef = Math.min(sp.t0 + 1, (sp.t1 ?? Infinity) - .05), cam = camera(G, tRef), mp = mpOf(cam), [ax, ay] = mp(...sp.anchor);
      const rects = []; for (let i = 0; i <= T.last; i++) { if (prog(G.sch[i], tRef) <= 0) continue; const [cx] = mp(X(i), 0), hw = cw * cam.s / 2 + 8; rects.push([cx - hw, mp(0, Y(B[i].h))[1] - 8, cx + hw, mp(0, Y(B[i].l))[1] + 8]); }
      // shaded shapes alive at that moment count as obstacles too (zone, position tool, measure) so words never sit on them
      const wr = (x0, y0, x1, y1) => { const [a0, b0] = mp(x0, y0), [a1, b1] = mp(x1, y1); rects.push([Math.min(a0, a1) - 6, Math.min(b0, b1) - 6, Math.max(a0, a1) + 6, Math.max(b0, b1) + 6]); };
      if (z && tRef >= on("zone")) wr(X(z.i0) - BW / 2, Y(z.top), d.model === "asia" || d.model === "nyopen" ? X(z.i1) + BW / 2 : lastX, Y(z.bot));
      if (d.trade && tRef >= on("tool")) wr(X(d.trade.iE) - BW / 2, Y(d.trade.target), lastX, Y(d.trade.stop));
      if (d.measure && tRef >= on("measure")) wr(X(d.measure.i0), Y(d.measure.from), X(Math.min(d.measure.i1, T.last)), Y(d.measure.to));
      for (const o of done) if (o.t0 < (sp.t1 ?? Infinity) && (o.t1 ?? Infinity) > sp.t0) { const [ox, oy] = mpOf(camera(G, tRef))(...o.anchor); rects.push([ox + o.off[0] - 8, oy + o.off[1] - 8, ox + o.off[0] + o.w + 8, oy + o.off[1] + o.h + 8]); }
      const lim = sp.callout ? [L.PL - 30, L.PT - 60, L.PR + 6, L.PB + 40] : [L.PL - 4, L.PT - 6, L.PR + 4, L.PB + 6];
      const cost = ([dx, dy]) => { const x0 = ax + dx, y0 = ay + dy, x1 = x0 + sp.w, y1 = y0 + sp.h; let c = 0;
        if (x0 < lim[0] || y0 < lim[1] || x1 > lim[2] || y1 > lim[3]) c += 1e6;
        for (const r of rects) { const ix = Math.max(0, Math.min(x1, r[2]) - Math.max(x0, r[0])), iy = Math.max(0, Math.min(y1, r[3]) - Math.max(y0, r[1])); c += ix * iy; } return c; };
      const cs = sp.cands(cam.s); let best = cs[0], bc = Infinity; for (const c of cs) { const v = cost(c); if (v < bc - 1) { bc = v; best = c; } }
      done.push({ ...sp, off: best });
    }
    return done;
  }, [d]);

  // ── this frame ────────────────────────────────────────────────────────────────────────────────────────────────────
  const on = (key) => { const b = beats.find((x) => x.show?.includes(key)); return b ? b.t : Infinity; };
  const cam = camera(G, t), mp = mpOf(cam), tr = `translate(${PCX} ${PCY}) scale(${cam.s}) translate(${-cam.cx} ${-cam.cy})`;
  const dim = ein(t, T.dim, .55), chartA = 1 - .92 * dim, live = t < T.out, tt = Math.min(t, T.dim + .6);
  const drawn = []; for (let i = 0; i <= T.last; i++) { const b = partial(B[i], prog(G.sch[i], tt)); if (b) drawn.push([i, b]); }
  const lastB = drawn.length ? drawn[drawn.length - 1][1] : null, world = [];
  // shapes (world space, under the candles)
  const tz = on("zone");
  if (d.zone && t >= tz) { const range = d.model === "asia" || d.model === "nyopen", used = d.trade && t >= T.tCross, k = eo(t, tz, .6);
    const x0 = X(d.zone.i0) - BW / 2, xEnd = range ? X(d.zone.i1) + BW / 2 : X(T.last) + BW * .7, x1 = mix(x0 + BW * .5, xEnd, k);
    world.push(<rect key="z" x={x0} y={Y(d.zone.top)} width={x1 - x0} height={Math.max(2, Y(d.zone.bot) - Y(d.zone.top))} fill={range ? "#fff" : C.acc} fillOpacity={(range ? .07 : .22) * (used ? .7 : 1)} />); }
  const tl = on("level"), hit = t >= T.tCross && t >= on("cross");
  if (t >= tl && d.model !== "fvg" && d.model !== "ob") { const k = ein(t, tl, .6), y = Y(d.level), x0 = d.model === "news" ? X(d.kb) - BW / 2 : X(0) - BW / 2, col = hit ? (d.side === "high" ? C.up : C.dn) : C.lvl;
    world.push(<line key="l" x1={x0} x2={mix(x0, X(T.last) + BW * .7, k)} y1={y} y2={y} stroke={col} strokeOpacity={hit ? .95 : .65} strokeWidth={1.7 / cam.s} strokeDasharray={d.model === "news" ? `${6 / cam.s} ${6 / cam.s}` : undefined} />);
    if (d.model === "news") { const xv = X(d.kb) - BW / 2; world.push(<line key="nv" x1={xv} x2={xv} y1={Y(G.HI)} y2={Y(G.LO)} stroke="#fff" strokeOpacity={.2 * k} strokeWidth={1.2 / cam.s} strokeDasharray={`${3 / cam.s} ${5 / cam.s}`} />); } }
  const tb = on("bos");
  if (d.bos && t >= tb) { const k = ein(t, tb, .5), y = Y(d.bos.price), x0 = X(d.bos.i0);
    world.push(<line key="b" x1={x0} x2={mix(x0, X(d.bos.i1), k)} y1={y} y2={y} stroke={C.lvl} strokeOpacity={.8} strokeWidth={1.5 / cam.s} strokeDasharray={`${6 / cam.s} ${5 / cam.s}`} />); }
  const tt0 = on("tool");
  if (d.trade && t >= tt0) { const r = d.trade, k = eo(t, tt0, .55), x0 = X(r.iE) - BW / 2, x1 = mix(x0 + BW, X(T.last) + BW * .7, k), ye = Y(r.entry), yt = Y(r.target), ys = Y(r.stop), paid = T.tPay && t >= T.tPay ? ein(t, T.tPay, .45) : 0;
    world.push(<g key="p"><rect x={x0} y={Math.min(ye, yt)} width={x1 - x0} height={Math.abs(yt - ye)} fill={C.up} fillOpacity={.17 + .1 * paid} />
      <rect x={x0} y={Math.min(ye, ys)} width={x1 - x0} height={Math.abs(ys - ye)} fill={C.dn} fillOpacity={.17 * (1 - .5 * paid)} />
      <line x1={x0} x2={x1} y1={ye} y2={ye} stroke="#fff" strokeOpacity={.75} strokeWidth={1.3 / cam.s} /></g>); }
  const tm = on("measure");
  if (d.measure && t >= tm) { const m = d.measure, p = ein(t, tm, .65), x0 = X(m.i0), x1 = X(Math.min(m.i1, T.last)), y0 = Y(m.from), y1 = mix(y0, Y(m.to), p), lx = (x0 + x1) / 2;
    world.push(<g key="m"><rect x={x0} y={Math.min(y0, y1)} width={Math.max(4, x1 - x0)} height={Math.abs(y1 - y0)} fill={C.tv} fillOpacity={.16} /><line x1={lx} x2={lx} y1={y0} y2={y1} stroke={C.tv} strokeWidth={1.6 / cam.s} /></g>); }
  // marks (screen space, above the candles)
  const marks = [];
  if (d.zone && d.model === "fvg") { const a = on("three"), k3 = 1 - ein(t, on("entry") - .3, .4); if (t >= a && k3 > 0) [0, 1, 2].forEach((j) => { const i = d.zone.i0 + j, b = B[i], [sx, sy] = mp(X(i), Y(long ? b.l : b.h));
    marks.push(<text key={"n" + j} x={sx} y={long ? sy + 34 : sy - 14} fill={C.text} fontSize={24} fontWeight={750} fontFamily={SANS} textAnchor="middle" opacity={eo(t, a + j * .12, .35) * k3}>{j + 1}</text>); }); }
  if (d.liq && t >= on("liq")) d.liq.forEach((q, j) => { const k = eo(t, on("liq") + j * .18, .35), taken = t >= T.tCross ? ein(t, T.tCross, .5) : 0, [sx, sy] = mp(X(q.i), Y(q.price));
    marks.push(<text key={"q" + j} x={sx} y={long ? sy + 32 : sy - 14} fill={C.acc} fontSize={26} fontWeight={800} fontFamily={SANS} textAnchor="middle" opacity={k * (1 - .7 * taken)}>$</text>); });
  if (d.trade && t >= Math.max(on("entry"), T.tCross)) { const r = d.trade, b = B[r.iE], [ex, ey0] = mp(X(r.iE), Y(long ? b.l : b.h)), ey = long ? ey0 + 24 : ey0 - 24, s = 12 * eo(t, T.tCross, .3);
    marks.push(<path key="e" d={long ? `M${ex} ${ey - s} L${ex - s} ${ey + s * .85} L${ex + s} ${ey + s * .85} Z` : `M${ex} ${ey + s} L${ex - s} ${ey - s * .85} L${ex + s} ${ey - s * .85} Z`} fill={long ? C.up : C.dn} />); }
  for (const sp of specs) { if (sp.callout || t < sp.t0 || (sp.t1 != null && t > sp.t1 + .4)) continue; const [ax, ay] = mp(...sp.anchor), k = eo(t, sp.t0, .4), out = sp.t1 != null ? ein(t, sp.t1, .4) : 0;
    marks.push(<g key={sp.key} transform={sp.rise ? `translate(0 ${(1 - k) * 10})` : undefined}>{sp.draw(ax + sp.off[0], ay + sp.off[1], k * (1 - out), hit)}</g>); }
  // callout arrows: from the words' nearest edge to the target, drawn in (progressive geometry)
  const callouts = [];
  for (const sp of specs) { if (!sp.callout || t < sp.t0 || t >= sp.t1) continue; const [ax, ay] = mp(...sp.anchor), bx = ax + sp.off[0], by = ay + sp.off[1], o = 1 - ein(t, sp.t1 - .25, .25);
    const sx = cl(ax, bx + 14, bx + sp.w - 14), sy = ay < by ? by - 4 : ay > by + sp.h ? by + sp.h + 4 : by + sp.h / 2, ux = ax - sx, uy = ay - sy, ln = Math.hypot(ux, uy) || 1;
    const ex = ax - ux / ln * 16, ey = ay - uy / ln * 16, bend = (sx < ax ? 1 : -1) * Math.min(28, ln * .2), qx = (sx + ex) / 2 - uy / ln * bend, qy = (sy + ey) / 2 + ux / ln * bend, p = OUT((t - sp.t0 - .3) / .45), pts = [];
    for (let j = 0; j <= Math.round(24 * p); j++) { const u = j / 24, a1 = (1 - u) * (1 - u), b1 = 2 * (1 - u) * u, c1 = u * u; pts.push(`${(a1 * sx + b1 * qx + c1 * ex).toFixed(1)},${(a1 * sy + b1 * qy + c1 * ey).toFixed(1)}`); }
    const hx = ex - qx, hy = ey - qy, hl = Math.hypot(hx, hy) || 1, dx = hx / hl, dy = hy / hl, hk = cl((p - .8) / .2);
    if (pts.length > 1 && ln > 30) marks.push(<g key={"a" + sp.key} opacity={o}><polyline points={pts.join(" ")} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {hk > 0 ? <path d={`M${ex + dx * 2} ${ey + dy * 2} L${ex - dx * 13 * hk - dy * 8 * hk} ${ey - dy * 13 * hk + dx * 8 * hk} L${ex - dx * 13 * hk + dy * 8 * hk} ${ey - dy * 13 * hk - dx * 8 * hk} Z`} fill="#fff" /> : null}</g>);
    callouts.push(<Callout key={sp.key} t={t} sp={sp} x={bx} y={by} o={o} />); }

  // axes follow the camera with one fixed step (no popping)
  const span = (L.PB - L.PT) / 2 / cam.s, pv = (y) => G.HI - (y - L.PT) / (L.PB - L.PT) * (G.HI - G.LO), vTop = pv(cam.cy - span), vBot = pv(cam.cy + span), step = ticks(G.LO, G.HI);
  const tk = []; for (let v = Math.ceil(vBot / step) * step; v <= vTop; v += step) tk.push(+v.toFixed(10));
  const dpA = Math.max(0, Math.min(d.dp, Math.ceil(-Math.log10(step) + .3))), every = Math.max(1, Math.round(G.N / 4 / cam.s)), axisA = 1 - .9 * dim;
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: SANS }}>
      <svg width={W} height={1920} style={{ position: "absolute", inset: 0 }}>
        <defs><clipPath id="plot"><rect x={L.PL - 20} y={L.PT - 10} width={L.PR - L.PL + 40} height={L.PB - L.PT + 20} /></clipPath></defs>
        {live ? <g opacity={axisA}>
          {tk.map((v) => { const y = PCY + (Y(v) - cam.cy) * cam.s; if (y < L.PT + 10 || y > L.PB - 10) return null;
            return <g key={v}><line x1={L.PL} x2={L.PR} y1={y} y2={y} stroke="#fff" strokeOpacity={.05} strokeDasharray="1 5" /><text x={L.axisX} y={y + 7} fill={C.axis} fontSize={19} fontFamily={SANS}>{fmt(v, dpA)}</text></g>; })}
          {B.map((b, i) => { if (i % every) return null; const [x] = mp(X(i), 0); if (x < L.PL + 30 || x > L.PR - 30) return null; return <text key={i} x={x} y={L.timeY} fill={C.axis} fontSize={19} fontFamily={SANS} textAnchor="middle">{b.lab}</text>; })}
        </g> : null}
        {live ? <g opacity={chartA} clipPath="url(#plot)"><g transform={tr}>
          {world}
          {drawn.map(([i, b]) => { const col = b[3] >= b[0] ? C.up : C.dn, y0 = Y(Math.max(b[0], b[3])), y1 = Y(Math.min(b[0], b[3]));
            return <g key={i}><line x1={X(i)} x2={X(i)} y1={Y(b[1])} y2={Y(b[2])} stroke={col} strokeWidth={Math.max(1.3, cw * .1) / Math.sqrt(cam.s)} /><rect x={X(i) - cw / 2} y={y0} width={cw} height={Math.max(1.4 / cam.s, y1 - y0)} fill={col} /></g>; })}
        </g></g> : null}
        {lastB && live ? (() => { const col = lastB[3] >= lastB[0] ? C.up : C.dn, y = cl(PCY + (Y(lastB[3]) - cam.cy) * cam.s, L.PT + 6, L.PB - 6);
          return <g opacity={chartA}><line x1={L.PL} x2={L.PR} y1={y} y2={y} stroke={col} strokeOpacity={.72} strokeWidth={1.3} strokeDasharray="3 4" /><rect x={L.axisX - 8} y={y - 16} width={98} height={32} rx={5} fill={col} />
            <text x={L.axisX + 41} y={y + 7} fill="#fff" fontSize={18} fontWeight={650} fontFamily={SANS} textAnchor="middle">{fmt(lastB[3], d.dp)}</text></g>; })() : null}
        {live ? <g opacity={chartA}>{marks}</g> : null}
      </svg>
      {live ? <div style={{ position: "absolute", inset: 0, opacity: chartA }}>{callouts}</div> : null}
      <Title d={d} />
      <div style={{ position: "absolute", top: L.chip, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, opacity: axisA }}>
        <Img src={staticFile(`m/${d.mk}.webp`)} style={{ width: 36, height: 36 }} />
        <span style={{ color: C.text, fontSize: 29, fontWeight: 650 }}>{d.mk}</span>
        </div>
      <div style={{ position: "absolute", top: L.brand - 8, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 14, opacity: axisA }}>
        <Img src={staticFile("potion-glyph.png")} style={{ width: 42, height: 42 }} />
        <span style={{ color: "#fff", fontSize: 32, fontWeight: 800, letterSpacing: 5 }}>CRTLAB</span></div>
      <SignOff t={t} T={T} />
    </AbsoluteFill>
  );
};

// a step's words — a soft dark shade behind (legible over any candle, no outline). Five entrances, rotated by step, so the
// text never moves the same way twice in a row: rise · mask · wipe · words · track
function Callout({ t, sp, x, y, o }) {
  const b = sp.callout, u = t - sp.t0, k = OUT(u / .45), mode = (b.i + (sp.callout.cap.length % 2)) % 5, col = b.tone === "up" ? "#3fd1a8" : b.tone === "dn" ? "#ff6b7d" : C.text;
  const box = { position: "absolute", left: x, top: y, width: sp.w, minHeight: sp.h, boxSizing: "border-box", padding: "9px 17px", borderRadius: 14, background: "rgba(5,5,6,.82)", fontFamily: SANS, fontSize: 38, fontWeight: 680, lineHeight: 1.22, letterSpacing: -.3, color: col, textAlign: "center", opacity: o * Math.min(1, u / .12) };
  const words = b.cap.split(" ");
  if (mode === 0) return <div style={{ ...box, transform: `translateY(${(1 - k) * 14}px)`, opacity: box.opacity * k }}>{b.cap}</div>;
  if (mode === 1) return <div style={{ ...box, overflow: "hidden" }}><div style={{ transform: `translateY(${(1 - k) * 110}%)` }}>{b.cap}</div></div>;
  if (mode === 2) return <div style={{ ...box, clipPath: `inset(0 ${(1 - k) * 100}% 0 0 round 14px)` }}>{b.cap}</div>;
  if (mode === 3) return <div style={box}>{words.map((w, i) => { const q = OUT((u - i * .07) / .35); return <span key={i} style={{ display: "inline-block", opacity: q, transform: `translateY(${(1 - q) * 10}px)`, marginRight: i < words.length - 1 ? ".26em" : 0 }}>{w}</span>; })}</div>;
  return <div style={{ ...box, letterSpacing: mix(6, -.3, k), opacity: box.opacity * k }}>{b.cap}</div>;
}
// the title — the hook. Identical on every frame (it is the loop seam). One line, sized to fit.
function Title({ d }) {
  const [a, b] = d.copy.title, len = (a + (b ? " " + b : "")).length, size = Math.min(96, Math.floor(940 / (len * .64)));
  return <div style={{ position: "absolute", top: L.title + (96 - size) * .5, left: 40, right: 40, textAlign: "center", whiteSpace: "nowrap", fontFamily: SANS, fontSize: size, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05, color: C.text }}>
    <span style={ACC_TXT}>{a}</span>{b ? <span> {b}</span> : null}</div>;
}
// the end: chart dims, crtlab.pro types into a search bar, the CRTLAB result settles under it, a cursor glides over and clicks —
// and the click opens straight into frame 0 (the empty chart under the title): the loop IS the click
function SignOff({ t, T }) {
  const a = T.dim + .2; if (t < a || t >= T.end) return null;
  const k = eo(t, a, .55), out = ein(t, T.out, .45), n = T.keys.reduce((m, [s, c]) => (t >= s ? c : m), 0), caret = t < T.typed + .15 ? 1 : 0, row = eo(t, T.row, .5);
  const pm = ein(t, T.ptr, .7), hover = eo(t, T.click - .2, .18), press = t >= T.click ? Math.sin(cl((t - T.click) / .2) * Math.PI) : 0;
  const px = mix(880, 560, pm), py = mix(380, 162, pm);
  return <div style={{ position: "absolute", left: 0, right: 0, top: 700, height: 300, display: "flex", flexDirection: "column", alignItems: "center", fontFamily: SANS, opacity: k * (1 - out), transform: `translateY(${(1 - k) * 14}px) scale(${1 + .035 * out})` }}>
    <div style={{ width: 680, height: 92, borderRadius: 46, background: "#18181c", display: "flex", alignItems: "center", gap: 18, padding: "0 32px", boxSizing: "border-box" }}>
      <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#8d8f99" strokeWidth={2.2} strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 L20.5 20.5" /></svg>
      <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 560, color: "#ececf1", whiteSpace: "pre" }}>{"crtlab.pro".slice(0, n)}
        <span style={{ display: "inline-block", width: 3, height: 42, marginLeft: 3, borderRadius: 2, background: C.acc, opacity: caret }} /></div>
    </div>
    <div style={{ marginTop: 14, width: 680, height: 88, borderRadius: 28, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 20, padding: "0 32px", opacity: row,
      background: `rgb(${mix(24, 34, hover)},${mix(24, 36, hover)},${mix(28, 48, hover)})`, transform: `translateY(${(1 - row) * -10}px) scale(${1 - .018 * press})` }}>
      <span style={{ fontSize: 31, fontWeight: 760, color: "#5aa9ff" }}>CRTLAB</span>
      <span style={{ width: 2, height: 32, background: "rgba(255,255,255,.14)" }} />
      <span style={{ fontSize: 27, fontWeight: 560, color: "#d9dbe2" }}>Backtesting &amp; Market Replay</span>
    </div>
    {pm > 0 ? <svg width={40} height={40} viewBox="0 0 24 24" style={{ position: "absolute", left: px, top: py, opacity: Math.min(1, pm * 3), transform: `scale(${1 - .12 * press})`, transformOrigin: "5px 3px", filter: "drop-shadow(0 4px 8px rgba(0,0,0,.6))" }}>
      <path d="M5 3 L5 19 L9.5 15 L12.5 21.5 L15 20.4 L12.1 14 L18 14 Z" fill="#fff" stroke="#0b0b0e" strokeWidth={1.2} strokeLinejoin="round" /></svg> : null}
  </div>;
}
