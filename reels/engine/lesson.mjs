// LESSONS — every reel teaches one setup, step by step, on the real chart. A step = replay to a bar → an annotation →
// a SHORT callout placed next to the thing it talks about, with an arrow from the words to it (the eye never leaves the chart).
// Each model has several ANGLES (an arm the brain learns): the rule, the why (liquidity), the risk, the mistake to avoid.
// Every number comes from the story.
const money = (s, x) => (s.unit === "$" ? "$" + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 100 ? 0 : 2 }) : s.unit === "pips" ? Math.round(Math.abs(x) / (s.mk.includes("JPY") ? .01 : .0001)) + " pips" : Math.round(Math.abs(x)).toLocaleString("en-US") + " pts");
const around = (s, i0, i1, a, b) => [Math.max(0, i0), Math.min(s.bars.length - 1, i1), a, b];
const at = (i, price) => ({ i, price });

export const ANGLES = { ob: ["rule", "why", "mistake"], fvg: ["rule", "risk", "mistake"], crt: ["rule", "why"], asia: ["rule", "why"], break: ["rule", "mistake"], news: ["rule", "why"], nyopen: ["rule", "mistake"] };

export function lesson(s, angle) {
  const tr = s.trade, long = tr ? tr.side === "long" : s.side === "high", z = s.zone, B = s.bars, N = B.length - 1;
  const hiLo = s.side === "high" ? "high" : "low", other = s.side === "high" ? "low" : "high", Cap = (w) => w[0].toUpperCase() + w.slice(1);
  const mv = s.measure ? money(s, s.measure.to - s.measure.from) : "";
  const pick = (o) => o[angle] ?? o.rule;
  let steps;
  if (tr) {
    const entryFocus = around(s, tr.iE - 5, tr.iE + 3, z ? (long ? z.top : z.bot) : tr.entry, tr.stop);
    const tradeFocus = around(s, tr.iE - 6, Math.min(N, tr.iX + 3), tr.stop, tr.target);
    const tap = { to: tr.iE, slow: true, show: ["entry"], focus: entryFocus, point: at(tr.iE, tr.entry) };
    const risk = { show: ["tool"], hold: 2, focus: tradeFocus, point: at(Math.min(N, tr.iE + 1), tr.stop) };
    const res = { to: tr.iX, show: ["result"], focus: tradeFocus, point: at(tr.iX, tr.target), tone: "up", hold: 1.8 };
    if (s.model === "ob") {
      const bos = { to: s.bos.i1, show: ["bos"], focus: around(s, s.bos.i0 - 1, s.bos.i1 + 1, s.bos.price, B[s.bos.i1].c), point: at(s.bos.i1, s.bos.price) };
      const obS = { to: s.bos.i1, show: ["zone"], focus: around(s, z.i0 - 2, s.bos.i1 + 2, z.top, z.bot), point: at(z.i0, (z.top + z.bot) / 2) };
      const lp = s.liq?.length ? s.liq[0] : { i: tr.iE - 1, price: long ? B[tr.iE - 1].l : B[tr.iE - 1].h };
      const back = { to: tr.iE - 1, show: s.liq?.length ? ["liq"] : [], point: at(lp.i, lp.price) };
      const c = long ? "down" : "up";
      steps = [
        { ...bos, cap: pick({ rule: "Structure breaks", why: "Structure breaks", mistake: "Most traders chase here" }) },
        { ...obS, cap: pick({ rule: `Last ${c} candle is the OB`, why: "This candle started the move", mistake: "Use the candle before it" }) },
        { ...back, cap: pick({ rule: "Wait for the pullback", why: s.liq?.length ? `Stops ${long ? "under" : "over"} these get taken` : "Price drifts back", mistake: "Let price come to you" }) },
        { ...tap, cap: pick({ rule: "The tap is the entry", why: "Back into the OB", mistake: "Enter on the tap" }) },
        { ...risk, cap: pick({ rule: `Stop ${long ? "under" : "over"} the OB`, why: "Risk 1 to make 2", mistake: "Tight stop, 2R target" }) },
        { ...res, cap: "Target hit" }];
    } else {
      const mid = z.i0 + 1, three = { to: z.i0 + 2, show: ["three"], focus: around(s, z.i0 - 2, z.i0 + 4, B[mid].h, B[mid].l), point: at(mid, (B[mid].o + B[mid].c) / 2) };
      const gap = { show: ["zone"], focus: three.focus, point: at(z.i0 + 2, (z.top + z.bot) / 2) };
      steps = [
        { ...three, cap: pick({ rule: "One candle moves too fast", risk: "Big candle, no pullback", mistake: "Don't chase this candle" }) },
        { ...gap, cap: pick({ rule: "The gap between wick 1 and 3", risk: "It leaves a gap", mistake: "Mark the gap it left" }) },
        { ...tap, cap: pick({ rule: "Entry on the return", risk: "Back into the gap", mistake: "Wait for the return" }) },
        { ...risk, cap: pick({ rule: "Stop past the gap", risk: "A full fill means you're wrong", mistake: "Stop past the gap" }) },
        { ...res, cap: "Target hit" }];
    }
  } else {
    const end = at(Math.min(s.measure.i1, N), s.measure.to), tone = s.side === "high" ? "up" : "dn", lvl = at(Math.min(3, N), s.level);
    const cross = { to: s.kb, slow: true, show: ["cross"], point: at(s.kb, s.level) };
    switch (s.model) {
      case "crt": {
        const k = Math.max(s.kb + 1, B.findIndex((b, i) => i > s.kb && (s.side === "low" ? b.c > s.level : b.c < s.level)));
        const kk = Math.min(N, k), f = around(s, s.kb - 6, Math.min(N, kk + 3), s.level, s.side === "low" ? B[s.kb].l : B[s.kb].h);
        steps = [
          { to: 0, show: ["level"], point: lvl, cap: `Yesterday's ${hiLo}`, hold: 1.5 },
          { ...cross, focus: f, cap: pick({ rule: "Swept", why: "Stops taken" }) },
          { to: kk, focus: f, point: at(kk, B[kk].c), cap: "Then closes back inside" },
          { to: N, show: ["measure"], point: end, tone, cap: pick({ rule: `${mv} the other way`, why: "The sweep was the turn" }), hold: 2 }];
        break;
      }
      case "asia":
        steps = [
          { to: z.i1, show: ["zone"], focus: around(s, z.i0 - 1, z.i1 + 2, z.top, z.bot), point: at(z.i1, (z.top + z.bot) / 2), cap: pick({ rule: "Asia's range", why: "Quiet Asia builds a range" }) },
          { ...cross, show: ["level", "cross"], focus: around(s, s.kb - 8, s.kb + 3, z.top, z.bot), cap: `${Cap(hiLo)} breaks first` },
          { to: N, show: ["measure"], point: end, tone, cap: pick({ rule: `${Cap(other)} never breaks`, why: "The first break sets the day" }), hold: 2.2 }];
        break;
      case "break":
        steps = [
          { to: 0, show: ["level"], point: lvl, cap: `Yesterday's ${hiLo}`, hold: 1.5 },
          { ...cross, focus: around(s, s.kb - 8, s.kb + 3, s.level, s.side === "high" ? B[s.kb].h : B[s.kb].l), cap: "Breaks" },
          { to: Math.min(N, s.kb + 6), point: at(Math.min(N, s.kb + 6), B[Math.min(N, s.kb + 6)].c), cap: pick({ rule: "No close back inside", mistake: "Don't fade it here" }) },
          { to: N, show: ["measure"], point: end, tone, cap: `${mv} past it`, hold: 2 }];
        break;
      case "news":
        steps = [
          { to: s.kb - 1, show: ["level"], point: at(s.kb - 1, s.level), cap: pick({ rule: `${s.event.name} at ${s.event.time} New York`, why: `Waiting for ${s.event.name}` }) },
          { ...cross, point: at(s.kb, s.side === "high" ? B[s.kb].h : B[s.kb].l), focus: around(s, s.kb - 6, s.kb + 4, B[s.kb].h, B[s.kb].l),
            cap: s.event.actual != null && s.event.forecast != null ? `${s.event.actual} vs ${s.event.forecast} expected` : "The release" },
          { to: N, show: ["measure"], point: end, tone, cap: `${mv}, ${s.ofDay}% of a day`, hold: 2.2 }];
        break;
      case "nyopen":
        steps = [
          { to: z.i1, show: ["zone"], focus: around(s, z.i0 - 3, z.i1 + 3, z.top, z.bot), point: at(z.i1, (z.top + z.bot) / 2), cap: "The first 15 minutes set the range" },
          { ...cross, show: ["level", "cross"], focus: around(s, s.kb - 8, s.kb + 3, z.top, z.bot), cap: pick({ rule: `${Cap(hiLo)} breaks`, mistake: "Wait for the break" }) },
          { to: N, show: ["measure"], point: end, tone, cap: `${Cap(other)} never trades, ${mv}`, hold: 2.2 }];
        break;
    }
  }
  return { angle, steps };
}
