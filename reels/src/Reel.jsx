import React, { useMemo } from "react";
import { AbsoluteFill, Img, useCurrentFrame, staticFile } from "remotion";
import { build, camera, partial, prog, EIO, OUT, FPS, W, L } from "./tl.mjs";
// THE REEL (v6, 11-09) — a lesson on a real chart, built to look like TradingView and feel like CRTLAB.
// RULES (Kai): nothing ever snaps (every element eases in AND out) · blue only for the title's highlight word and the
// execution arrow · no purple, no gradients, no colons/dots/arrows in text · captions live in ONE fixed line under the
// chart (never on candles, never wrapping into an axis) · TradingView-style flat labels
// (TP/SL with prices, BOS, OB) · one consistent entrance for words, no rotating gimmicks · use the space: tall chart, no time axis.
const C = { bg: "#050506", text: "#f2f2f4", dim: "#8f929b", axis: "#6a6d78", grid: "#ffffff", up: "#089981", dn: "#f23645", lvl: "#e1e3ea", tv: "#2962ff", acc: "#4d8dff", label: "#30343f" };
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Roboto, sans-serif';
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), mix = (a, b, k) => a + (b - a) * k, eo = (t, a, d) => OUT((t - a) / d), ein = (t, a, d) => EIO((t - a) / d);
const fmt = (v, dp) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
function ticks(lo, hi, n = 6) { const raw = (hi - lo) / n, m = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((k) => k * m).find((k) => k >= raw); }
// fade in over `a` seconds from t0, out over `b` seconds ending at t1 (never a hard cut)
const life = (t, t0, t1 = Infinity, a = .35, b = .3) => Math.min(eo(t, t0, a), 1 - ein(t, t1 - b, b));

// TradingView-style flat label: small, square-ish, no icons
const labW = (text, size) => text.length * size * .6 + 18;
function Label({ x, y, text, bg, size = 17, o = 1, fg = "#fff" }) {
  const w = labW(text, size), h = size * 1.55;
  return <g opacity={o}><rect x={x} y={y} width={w} height={h} rx={4} fill={bg} />
    <text x={x + w / 2} y={y + h * .69} fill={fg} fontSize={size} fontWeight={600} fontFamily={SANS} textAnchor="middle">{text}</text></g>;
}

export const Reel = (d) => {
  const t = useCurrentFrame() / FPS, G = useMemo(() => build(d), [d]), { T, X, Y, B, BW, cw, beats } = G;
  const long = d.trade ? d.trade.side === "long" : d.side === "high";
  const PCX = (L.PL + L.PR) / 2, PCY = (L.PT + L.PB) / 2;
  const mpOf = (cam) => (x, y) => [PCX + (x - cam.cx) * cam.s, PCY + (y - cam.cy) * cam.s];
  const on = (key) => { const b = beats.find((x) => x.show?.includes(key)); return b ? b.t : Infinity; };

  // ── labels: placed ONCE per label against the candles + shapes alive at its moment (no jumping, no overlap) ─────────
  const specs = useMemo(() => {
    const S = [], lastX = X(T.last) + BW * .7, z = d.zone;
    if (z && isFinite(on("zone"))) { const range = d.model === "asia" || d.model === "nyopen", w = labW(z.label, 17), h = 27;
      S.push({ key: "zone", t0: on("zone") + .25, anchor: [X(z.i0) - BW / 2, Y(z.top)], w, h, cands: () => [[4, 4], [0, -h - 6], [4, (Y(z.bot) - Y(z.top)) + 6]], draw: (x, y, o) => <Label x={x} y={y} text={z.label} bg={C.label} fg={C.lvl} size={17} o={o} /> }); }
    if (isFinite(on("level")) && d.model !== "fvg" && d.model !== "ob") { const w = labW(d.levelLabel, 16), h = 25, x0 = d.model === "news" ? X(d.kb) - BW / 2 : X(0) - BW / 2;
      S.push({ key: "level", t0: on("level") + .3, anchor: [x0, Y(d.level)], w, h, hitCol: true, cands: (s) => [[6, -h - 5], [6, 5], [(lastX - x0) * s - w, -h - 5], [(lastX - x0) * s - w, 5]], draw: (x, y, o, hit) => <Label x={x} y={y} text={d.levelLabel} bg={hit ? (d.side === "high" ? C.up : C.dn) : C.label} size={16} o={o} /> }); }
    if (d.bos) { const w = labW("BOS", 17), h = 27, mx = (X(d.bos.i0) + X(d.bos.i1)) / 2;
      S.push({ key: "bos", t0: on("bos") + .3, anchor: [mx, Y(d.bos.price)], w, h, cands: () => [[-w / 2, long ? -h - 6 : 6], [-w / 2, long ? 6 : -h - 6], [-w - 30, -h / 2]], draw: (x, y, o) => <Label x={x} y={y} text="BOS" bg={C.label} fg={C.lvl} size={17} o={o} /> }); }
    if (d.trade && isFinite(on("tool"))) { const tr = d.trade, tT = `TP ${fmt(tr.target, d.dp)}`, tS = `SL ${fmt(tr.stop, d.dp)}`, wT = labW(tT, 17), wS = labW(tS, 17), h = 27;
      S.push({ key: "tgt", t0: on("tool") + .35, t1: T.tPay + .6, anchor: [X(tr.iE) - BW / 2, Y(tr.target)], w: wT, h, cands: (s) => [[4, long ? 4 : -h - 4], [4, long ? -h - 4 : 4], [(X(T.last) + BW * .7 - X(tr.iE) + BW / 2) * s - wT - 4, long ? 4 : -h - 4]], draw: (x, y, o) => <Label x={x} y={y} text={tT} bg={C.up} size={17} o={o} /> });
      S.push({ key: "stop", t0: on("tool") + .35, t1: T.tPay + .6, anchor: [X(tr.iE) - BW / 2, Y(tr.stop)], w: wS, h, cands: (s) => [[4, long ? -h - 4 : 4], [4, long ? 4 : -h - 4], [(X(T.last) + BW * .7 - X(tr.iE) + BW / 2) * s - wS - 4, long ? -h - 4 : 4]], draw: (x, y, o) => <Label x={x} y={y} text={tS} bg={C.dn} size={17} o={o} /> }); }
    if (d.trade && isFinite(on("result"))) { const w = labW("+2.0R", 22), h = 34, a = Math.max(on("result"), T.tPay ?? 0);
      S.push({ key: "res", t0: a + .05, anchor: [X(d.trade.iX), Y(d.trade.target)], w, h, rise: true, cands: (s) => [[BW * s + 8, -h / 2], [BW * s * .8 + 6, long ? -h - 8 : 8], [-w - BW * s, long ? -h - 8 : 8]], draw: (x, y, o, _h, tn) => <Label x={x} y={y} text={`+${(2 * eo(tn, a, .55)).toFixed(1)}R`} bg={C.up} size={22} o={o} /> }); }
    if (d.measure && isFinite(on("measure"))) { const m = d.measure, up = m.to > m.from, pct = Math.abs((m.to - m.from) / m.from * 100).toFixed(2), txt = `${up ? "+" : "−"}${d.copy.mv} (${pct}%)`, w = labW(txt, 18), h = 28;
      S.push({ key: "meas", t0: on("measure") + .5, anchor: [(X(m.i0) + X(Math.min(m.i1, T.last))) / 2, Y(m.to)], w, h, cands: () => [[-w / 2, up ? -h - 10 : 10], [-w / 2, up ? 10 : -h - 10], [-w - 20, -h / 2], [20, -h / 2]], draw: (x, y, o) => <Label x={x} y={y} text={txt} bg={C.tv} size={18} o={o} /> }); }
    // CAPTIONS go where the viewer is already looking: next to the thing they describe, only in empty chart space
    const capsB = beats.filter((b) => b.cap);
    capsB.forEach((b, j) => { const size = 40, w = Math.min(760, b.cap.length * size * .52 + 24), h = Math.round(size * 1.3), t1 = j + 1 < capsB.length ? capsB[j + 1].t : T.dim + .1;
      const pi = b.point ? b.point.i : Math.min(b.to ?? T.last, T.last), pp = b.point ? b.point.price : B[pi].c;
      S.push({ key: "cap" + j, cap: b, j, t0: j ? b.t + .14 : b.t, t1, anchor: [X(pi), Y(pp)], w, h,
        cands: () => [[-w / 2, -h - 70], [-w / 2, 70], [-w / 2, -h - 130], [-w / 2, 130], [-w - 60, -h / 2], [60, -h / 2], [-w - 40, -h - 60], [40, -h - 60], [-w - 40, 60], [40, 60], [-w / 2, -h - 200], [-w / 2, 200]] }); });
    const done = [];
    for (const sp of S.sort((a, b) => a.t0 - b.t0)) {
      const tRef = Math.min(sp.t0 + 1, (sp.t1 ?? Infinity) - .05), cam = camera(G, tRef), mp = mpOf(cam), [ax, ay] = mp(...sp.anchor);
      const rects = []; for (let i = 0; i <= T.last; i++) { if (prog(G.sch[i], tRef) <= 0) continue; const [cx] = mp(X(i), 0), hw = cw * cam.s / 2 + 6; rects.push([cx - hw, mp(0, Y(B[i].h))[1] - 6, cx + hw, mp(0, Y(B[i].l))[1] + 6]); }
      for (const o of done) if (o.t0 < (sp.t1 ?? Infinity) && (o.t1 ?? Infinity) > sp.t0) { const [ox, oy] = mp(...o.anchor); rects.push([ox + o.off[0] - 6, oy + o.off[1] - 6, ox + o.off[0] + o.w + 6, oy + o.off[1] + o.h + 6]); }
      // shaded shapes alive at that moment are obstacles too (zone, position tool, measure)
      const wr = (x0, y0, x1, y1) => { const [a0, b0] = mp(x0, y0), [a1, b1] = mp(x1, y1); rects.push([Math.min(a0, a1) - 8, Math.min(b0, b1) - 8, Math.max(a0, a1) + 8, Math.max(b0, b1) + 8]); }, lx = X(T.last) + BW * .7;
      if (z && tRef >= on("zone")) wr(X(z.i0) - BW / 2, Y(z.top), d.model === "asia" || d.model === "nyopen" ? X(z.i1) + BW / 2 : lx, Y(z.bot));
      if (d.trade && tRef >= on("tool")) wr(X(d.trade.iE) - BW / 2, Y(d.trade.target), lx, Y(d.trade.stop));
      if (d.measure && tRef >= on("measure")) wr(X(d.measure.i0), Y(d.measure.from), X(Math.min(d.measure.i1, T.last)), Y(d.measure.to));
      const lim = sp.cap ? [L.PL + 4, L.PT + 6, L.PR - 4, L.PB - 6] : [L.PL - 4, L.PT - 4, L.PR + 4, L.PB + 4];
      const cost = ([dx, dy]) => { const x0 = ax + dx, y0 = ay + dy, x1 = x0 + sp.w, y1 = y0 + sp.h; let c = 0;
        if (x0 < lim[0] || y0 < lim[1] || x1 > lim[2] || y1 > lim[3]) c += 1e6;
        for (const r of rects) { const ix = Math.max(0, Math.min(x1, r[2]) - Math.max(x0, r[0])), iy = Math.max(0, Math.min(y1, r[3]) - Math.max(y0, r[1])); c += ix * iy; } return c; };
      const cs = sp.cands(cam.s); let best = cs[0], bc = Infinity; for (const c of cs) { const v = cost(c); if (v < bc - 1) { bc = v; best = c; } }
      done.push({ ...sp, off: best, fixed: !!sp.cap && bc >= 1e6 }); // no room anywhere → the clean line under the chart
    }
    return done;
  }, [d]);

  // ── this frame ────────────────────────────────────────────────────────────────────────────────────────────────────
  const cam = camera(G, t), mp = mpOf(cam), tr = `translate(${PCX} ${PCY}) scale(${cam.s}) translate(${-cam.cx} ${-cam.cy})`;
  const END = 1 - ein(t, T.out, .5), dim = ein(t, T.dim, .6), chartA = (1 - .94 * dim) * END, live = t < T.out + .5, tt = Math.min(t, T.dim + .6);
  // INTRO: the screen falls into place, one section after another (like a page revealing on scroll). Frame 0 is empty,
  // and so is the last frame (the outro eases everything out) → the loop is seamless and nothing lingers.
  const IN = (i) => eo(t, .04 + i * .09, .5), RISE = (i) => (1 - IN(i)) * 18;
  const drawn = []; for (let i = 0; i <= T.last; i++) { const b = partial(B[i], prog(G.sch[i], tt)); if (b) drawn.push([i, b]); }
  const lastB = drawn.length ? drawn[drawn.length - 1][1] : null, world = [];
  // shapes (world space, under the candles) — all grow in, none pop
  const tz = on("zone");
  if (d.zone && t >= tz) { const range = d.model === "asia" || d.model === "nyopen", used = d.trade && t >= T.tCross, k = eo(t, tz, .7);
    const x0 = X(d.zone.i0) - BW / 2, xEnd = range ? X(d.zone.i1) + BW / 2 : X(T.last) + BW * .7, x1 = mix(x0 + BW * .5, xEnd, k);
    world.push(<rect key="z" x={x0} y={Y(d.zone.top)} width={x1 - x0} height={Math.max(2, Y(d.zone.bot) - Y(d.zone.top))} fill={range ? "#fff" : "#d1d4dc"} fillOpacity={(range ? .07 : .13) * (used ? .75 : 1) * k} />); }
  const tl = on("level"), hit = t >= T.tCross && t >= on("cross");
  if (t >= tl && d.model !== "fvg" && d.model !== "ob") { const k = ein(t, tl, .65), y = Y(d.level), x0 = d.model === "news" ? X(d.kb) - BW / 2 : X(0) - BW / 2, hk = hit ? eo(t, T.tCross, .4) : 0;
    world.push(<line key="l" x1={x0} x2={mix(x0, X(T.last) + BW * .7, k)} y1={y} y2={y} stroke={hk > 0 ? (d.side === "high" ? C.up : C.dn) : C.lvl} strokeOpacity={.6 + .35 * hk} strokeWidth={1.6 / cam.s} strokeDasharray={d.model === "news" ? `${6 / cam.s} ${6 / cam.s}` : undefined} />);
    if (d.model === "news") { const xv = X(d.kb) - BW / 2; world.push(<line key="nv" x1={xv} x2={xv} y1={Y(G.HI)} y2={Y(G.LO)} stroke="#fff" strokeOpacity={.18 * k} strokeWidth={1.2 / cam.s} strokeDasharray={`${3 / cam.s} ${5 / cam.s}`} />); } }
  const tb = on("bos");
  if (d.bos && t >= tb) { const k = ein(t, tb, .55), y = Y(d.bos.price), x0 = X(d.bos.i0);
    world.push(<line key="b" x1={x0} x2={mix(x0, X(d.bos.i1), k)} y1={y} y2={y} stroke={C.lvl} strokeOpacity={.75} strokeWidth={1.4 / cam.s} strokeDasharray={`${6 / cam.s} ${5 / cam.s}`} />); }
  // the position tool — TradingView's long/short: green target box, red stop box, entry line; grows out from the entry
  const tt0 = on("tool");
  if (d.trade && t >= tt0) { const r = d.trade, k = eo(t, tt0, .6), x0 = X(r.iE) - BW / 2, x1 = mix(x0 + BW, X(T.last) + BW * .7, k), ye = Y(r.entry), yt = Y(r.target), ys = Y(r.stop), paid = T.tPay && t >= T.tPay ? ein(t, T.tPay, .5) : 0, vk = eo(t, tt0, .45);
    world.push(<g key="p" opacity={vk}><rect x={x0} y={Math.min(ye, yt)} width={x1 - x0} height={Math.abs(yt - ye)} fill={C.up} fillOpacity={.2 + .08 * paid} />
      <rect x={x0} y={Math.min(ye, ys)} width={x1 - x0} height={Math.abs(ys - ye)} fill={C.dn} fillOpacity={.2 * (1 - .45 * paid)} />
      <line x1={x0} x2={x1} y1={ye} y2={ye} stroke="#d1d4dc" strokeOpacity={.8} strokeWidth={1.2 / cam.s} /></g>); }
  // a cursor drags the position tool out, like drawing it on TradingView: appears at the entry, presses, drags, releases, fades
  let toolCursor = null;
  // the TradingView way: a long/short position icon appears, the cursor clicks it, glides to the entry, drags the box out
  if (d.trade && t >= tt0 - 1.05 && t < tt0 + 1.1) { const r = d.trade, k = eo(t, tt0, .6), x0 = X(r.iE) - BW / 2, x1 = mix(x0 + BW, X(T.last) + BW * .7, k), [dx, dy] = mp(x1, Y(r.entry));
    const chip = [L.PL + 36, L.PT + 30], chipA = eo(t, tt0 - 1.05, .3) * (1 - ein(t, tt0 + .1, .3)), chipOn = t >= tt0 - .62 ? 1 : 0;
    const travel = ein(t, tt0 - .55, .5), sx = mix(chip[0] + 6, dx, travel), sy = mix(chip[1] + 8, dy, travel);
    const a = eo(t, tt0 - .95, .25) * (1 - ein(t, tt0 + .72, .35)), press = (t >= tt0 - .66 && t < tt0 - .56) || (t >= tt0 && t < tt0 + .62) ? 1 : 0, s = r.side === "long";
    toolCursor = <g key="tc">
      <g opacity={chipA} transform={`translate(${chip[0] - 24} ${chip[1] - 24})`}><rect width={48} height={48} rx={10} fill={chipOn ? "#2a2e39" : "#1b1d24"} />
        <rect x={13} y={s ? 12 : 24} width={22} height={12} rx={1.5} fill={C.up} /><rect x={13} y={s ? 24 : 12} width={22} height={12} rx={1.5} fill={C.dn} /></g>
      <g opacity={a} transform={`translate(${sx - 5} ${sy - 3}) scale(${1.5 - .12 * press})`}><path d="M5 3 L5 19 L9.5 15 L12.5 21.5 L15 20.4 L12.1 14 L18 14 Z" fill="#fff" stroke="#0b0b0e" strokeWidth={1.2} strokeLinejoin="round" /></g></g>; }
  // the key candle (entry tap / sweep / break) gets a brief soft selection band behind it once it prints
  if (G.sch[d.kb]) { const k0 = G.sch[d.kb][1], hk = life(t, k0, k0 + 1.4, .25, .5); if (hk > 0) world.unshift(<rect key="hl" x={X(d.kb) - cw * 1.25} y={Y(G.HI)} width={cw * 2.5} height={Y(G.LO) - Y(G.HI)} fill="#ffffff" fillOpacity={.035 * hk} />); }
  const tm = on("measure");
  if (d.measure && t >= tm) { const m = d.measure, p = ein(t, tm, .7), x0 = X(m.i0), x1 = X(Math.min(m.i1, T.last)), y0 = Y(m.from), y1 = mix(y0, Y(m.to), p), lx = (x0 + x1) / 2;
    world.push(<g key="m" opacity={eo(t, tm, .3)}><rect x={x0} y={Math.min(y0, y1)} width={Math.max(4, x1 - x0)} height={Math.abs(y1 - y0)} fill={C.tv} fillOpacity={.15} /><line x1={lx} x2={lx} y1={y0} y2={y1} stroke={C.tv} strokeWidth={1.5 / cam.s} /></g>); }

  // marks (screen space, above the candles)
  const marks = [];
  if (d.zone && d.model === "fvg") { const a = on("three"), k3 = 1 - ein(t, on("entry") - .35, .45); if (t >= a && k3 > 0) [0, 1, 2].forEach((j) => { const i = d.zone.i0 + j, b = B[i], [sx, sy] = mp(X(i), Y(long ? b.l : b.h));
    marks.push(<text key={"n" + j} x={sx} y={long ? sy + 30 : sy - 12} fill={C.dim} fontSize={21} fontWeight={600} fontFamily={SANS} textAnchor="middle" opacity={eo(t, a + j * .12, .35) * k3}>{j + 1}</text>); }); }
  if (d.liq && t >= on("liq")) d.liq.forEach((q, j) => { const k = eo(t, on("liq") + j * .16, .35), taken = t >= T.tCross ? ein(t, T.tCross, .55) : 0, [sx, sy] = mp(X(q.i), Y(q.price));
    marks.push(<text key={"q" + j} x={sx} y={long ? sy + 28 : sy - 12} fill={C.lvl} fontSize={21} fontWeight={600} fontFamily={SANS} textAnchor="middle" opacity={k * .7 * (1 - .75 * taken)}>$</text>); });
  // execution marker — a clean chevron, green under a buy / red over a sell, rises in
  if (d.trade && t >= Math.max(on("entry"), T.tCross)) { const r = d.trade, b = B[r.iE], [ex, ey0] = mp(X(r.iE), Y(long ? b.l : b.h)), k = eo(t, T.tCross, .45), dy = (1 - k) * (long ? 12 : -12);
    const y = long ? ey0 + 18 + dy : ey0 - 18 + dy, s = long ? 1 : -1; // a clean chevron only: ^ under a buy, v over a sell
    marks.push(<path key="e" opacity={k} d={`M${ex - 10} ${y + 9 * s} L${ex} ${y} L${ex + 10} ${y + 9 * s}`} fill="none" stroke={long ? C.up : C.dn} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />); }
  for (const sp of specs) { if (sp.cap || t < sp.t0 || (sp.t1 != null && t > sp.t1 + .5)) continue; const [ax, ay] = mp(...sp.anchor), o = life(t, sp.t0, sp.t1 ?? Infinity, .4, .45);
    marks.push(<g key={sp.key} transform={sp.rise ? `translate(0 ${(1 - eo(t, sp.t0, .45)) * 10})` : undefined}>{sp.draw(ax + sp.off[0], ay + sp.off[1], o, hit, t)}</g>); }


  // price axis follows the camera with one fixed step; labels fade at the edges instead of popping
  const span = (L.PB - L.PT) / 2 / cam.s, pv = (y) => G.HI - (y - L.PT) / (L.PB - L.PT) * (G.HI - G.LO), vTop = pv(cam.cy - span), vBot = pv(cam.cy + span), step = ticks(G.LO, G.HI);
  const tk = []; for (let v = Math.floor(vBot / step) * step; v <= vTop + step; v += step) tk.push(+v.toFixed(10));
  const dpA = Math.max(0, Math.min(d.dp, Math.ceil(-Math.log10(step) + .3))), axisA = 1 - .92 * dim * (1 - ein(t, T.out, .5)); // the chart frame never animates in; it is simply there (Kai)
  const edge = (y) => cl((y - L.PT) / 40) * cl((L.PB - y) / 40);
  // captions: ONE fixed line under the chart, cross-faded (the old line eases out while the new one eases in)
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 45% at 50% 46%, #0d0e12 0%, ${C.bg} 72%)`, fontFamily: SANS }}>
      <svg width={W} height={1920} style={{ position: "absolute", inset: 0 }}>
        <g opacity={.6 * axisA}>{[1, 2, 3, 4, 5].map((j) => { const x = L.PL + (L.PR - L.PL) * j / 6; return <line key={"vg" + j} x1={x} x2={x} y1={L.PT} y2={L.PB} stroke="#fff" strokeOpacity={.03} />; })}</g>
        <defs><clipPath id="plot"><rect x={L.PL - 16} y={L.PT - 8} width={L.PR - L.PL + 32} height={L.PB - L.PT + 16} /></clipPath></defs>
        {live ? <g opacity={axisA}>
          {tk.map((v) => { const y = PCY + (Y(v) - cam.cy) * cam.s, e = edge(y); if (e <= 0) return null;
            return <g key={v} opacity={e}><line x1={L.PL} x2={L.PR} y1={y} y2={y} stroke={C.grid} strokeOpacity={.045} /><text x={L.axisX} y={y + 6} fill={C.axis} fontSize={18} fontFamily={SANS}>{fmt(v, dpA)}</text></g>; })}
        </g> : null}
        {live ? <g opacity={chartA} clipPath="url(#plot)"><g transform={tr}>
          {world}
          {drawn.map(([i, b]) => { const col = b[3] >= b[0] ? C.up : C.dn, y0 = Y(Math.max(b[0], b[3])), y1 = Y(Math.min(b[0], b[3]));
            return <g key={i}><line x1={X(i)} x2={X(i)} y1={Y(b[1])} y2={Y(b[2])} stroke={col} strokeWidth={Math.max(1.3, cw * .1) / Math.sqrt(cam.s)} /><rect x={X(i) - cw / 2} y={y0} width={cw} height={Math.max(1.4 / cam.s, y1 - y0)} fill={col} /></g>; })}
        </g></g> : null}
        {lastB && live ? (() => { const col = lastB[3] >= lastB[0] ? C.up : C.dn, y = cl(PCY + (Y(lastB[3]) - cam.cy) * cam.s, L.PT + 6, L.PB - 6);
          return <g opacity={chartA * eo(t, .05, .4)}><line x1={L.PL} x2={L.PR} y1={y} y2={y} stroke={col} strokeOpacity={.6} strokeWidth={1.2} strokeDasharray="2 3" /><rect x={L.axisX - 8} y={y - 15} width={96} height={30} rx={3} fill={col} />
            <text x={L.axisX + 40} y={y + 6} fill="#fff" fontSize={17} fontWeight={600} fontFamily={SANS} textAnchor="middle">{fmt(lastB[3], d.dp)}</text></g>; })() : null}
        {live ? <g opacity={chartA}>{marks}{toolCursor}</g> : null}
      </svg>
      {specs.filter((sp) => sp.cap).map((sp) => { const b = sp.cap, o = life(t, sp.t0, sp.t1, .32, .18) * (1 - dim); if (o <= 0) return null; const k = eo(t, sp.t0, .45);
        const col = b.tone === "up" ? "#22c39b" : b.tone === "dn" ? "#ff5a6e" : C.text;
        if (sp.fixed) return <div key={sp.key} style={{ position: "absolute", left: 60, right: 60, top: L.cap, textAlign: "center", whiteSpace: "nowrap", fontSize: 44, fontWeight: 700, letterSpacing: -.4, color: col, opacity: o, transform: `translateY(${(1 - k) * 10}px)` }}>{b.cap}</div>;
        const [ax, ay] = mp(...sp.anchor), x = cl(ax + sp.off[0], L.PL + 4, L.PR - 4 - sp.w), y = cl(ay + sp.off[1], L.PT + 6, L.PB - 6 - sp.h);
        return <div key={sp.key} style={{ position: "absolute", left: x, top: y, width: sp.w, height: sp.h, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", fontSize: 40, fontWeight: 700, letterSpacing: -.3, color: col, opacity: o, transform: `translateY(${(1 - k) * 10}px)`,
          textShadow: "0 0 18px rgba(5,5,6,.95), 0 0 6px rgba(5,5,6,.95), 0 2px 2px rgba(0,0,0,.8)" }}>{b.cap}</div>; })}
      <Title d={d} t={t} o={1 - dim} />
      <div style={{ position: "absolute", top: L.brand, left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 12, opacity: (1 - .92 * dim) * END * eo(t, .34, .5) }}>
        <Img src={staticFile("potion-glyph.png")} style={{ width: 46, height: 46 }} />
        <span style={{ color: "#fff", fontSize: 35, fontWeight: 800, letterSpacing: 5.5 }}>CRTLAB</span></div>
      <SignOff t={t} T={T} />
    </AbsoluteFill>
  );
};

// the title — the hook. Only the first word is blue. Eases out while the domain types and back in as the click opens the loop.
const NICE = { XAUUSD: "GOLD", XAGUSD: "SILVER", USOIL: "OIL", NAS100: "NASDAQ", SP500: "S&P 500", US30: "DOW", BTCUSD: "BITCOIN", ETHUSD: "ETHEREUM" };
function Title({ d, t, o = 1 }) {
  const [a, b] = d.copy.title, len = (a + (b ? " " + b : "")).length + 1.6, size = Math.min(72, Math.floor(820 / (len * .6)));
  const isPair = a === d.mk || a === NICE[d.mk]; // the pair's name reads in white; its icon carries the colour
  return <div style={{ position: "absolute", top: L.title + (72 - size) * .5, left: 40, right: 40, textAlign: "center", whiteSpace: "nowrap", fontFamily: SANS, fontSize: size, fontWeight: 750, letterSpacing: -1.6, lineHeight: 1.05, color: C.text, opacity: o, display: "flex", alignItems: "center", justifyContent: "center", gap: size * .28 }}>
    {/* intro: the icon settles in (soft scale), the words rise out of a mask — two different entrances, nothing identical */}
    <Img src={staticFile(`m/${d.mk}.webp`)} style={{ width: size * .92, height: size * .92, opacity: eo(t, .18, .45), transform: `scale(${.82 + .18 * eo(t, .18, .5)})` }} />
    <span style={{ overflow: "hidden", display: "inline-block", paddingBottom: 6 }}><span style={{ display: "inline-block", transform: `translateY(${(1 - eo(t, .04, .55)) * 105}%)` }}>
      <span style={{ color: isPair ? C.text : C.acc }}>{a}</span>{b ? <span> {b}</span> : null}</span></span></div>;
}
// the end: chart dims, crtlab.pro types into a search bar, the CRTLAB result settles under it, a cursor glides in and clicks —
// and the click opens straight into frame 0 (the empty chart under the title): the loop IS the click. Neutral colours only.
function SignOff({ t, T }) {
  const a = T.dim + .2; if (t < a || t >= T.end) return null;
  const k = eo(t, a, .6), out = ein(t, T.out, .5), n = T.keys.reduce((m, [s, c]) => (t >= s ? c : m), 0), caret = t < T.typed + .2 ? .5 + .5 * Math.cos((t - a) * 9) : 0, row = eo(t, T.row, .55);
  const pm = ein(t, T.ptr, .8), hover = eo(t, T.click - .25, .22), press = t >= T.click ? Math.sin(cl((t - T.click) / .22) * Math.PI) : 0;
  const px = mix(900, 560, pm), py = mix(400, 160, pm);
  return <div style={{ position: "absolute", left: 0, right: 0, top: 720, height: 300, display: "flex", flexDirection: "column", alignItems: "center", fontFamily: SANS, opacity: k * (1 - out), transform: `translateY(${(1 - k) * 12}px) scale(${1 + .03 * out})` }}>
    <div style={{ width: 680, height: 92, borderRadius: 46, background: "#16161a", display: "flex", alignItems: "center", gap: 18, padding: "0 32px", boxSizing: "border-box" }}>
      <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#8d8f99" strokeWidth={2.2} strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 L20.5 20.5" /></svg>
      <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 560, color: "#ececf1", whiteSpace: "pre" }}>{"crtlab.pro".slice(0, n)}
        <span style={{ display: "inline-block", width: 3, height: 42, marginLeft: 3, borderRadius: 2, background: "#ececf1", opacity: caret }} /></div>
    </div>
    <div style={{ marginTop: 14, width: 680, height: 88, borderRadius: 28, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 20, padding: "0 32px", opacity: row,
      background: `rgb(${mix(22, 34, hover)},${mix(22, 34, hover)},${mix(26, 38, hover)})`, transform: `translateY(${(1 - row) * -10}px) scale(${1 - .016 * press})` }}>
      <span style={{ fontSize: 31, fontWeight: 760, color: "#fff" }}>CRTLAB</span>
      <span style={{ width: 2, height: 32, background: "rgba(255,255,255,.14)" }} />
      <span style={{ fontSize: 27, fontWeight: 560, color: "#d9dbe2" }}>Backtesting &amp; Market Replay</span>
    </div>
    {pm > 0 ? <svg width={40} height={40} viewBox="0 0 24 24" style={{ position: "absolute", left: px, top: py, opacity: Math.min(1, pm * 2.5), transform: `scale(${1 - .1 * press})`, transformOrigin: "5px 3px", filter: "drop-shadow(0 4px 8px rgba(0,0,0,.6))" }}>
      <path d="M5 3 L5 19 L9.5 15 L12.5 21.5 L15 20.4 L12.1 14 L18 14 Z" fill="#fff" stroke="#0b0b0e" strokeWidth={1.2} strokeLinejoin="round" /></svg> : null}
  </div>;
}
