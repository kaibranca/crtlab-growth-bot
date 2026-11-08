// LESSONS — every reel teaches one thing, step by step, on the real chart. A step = replay to a bar → show an annotation →
// one plain caption → hold long enough to read. Each model has several ANGLES (an arm the brain learns): the same setup taught
// as the rule, as the why (liquidity), as the risk, or as the mistake to avoid — so two reels of one model never read alike.
// Words stay true to the data: every number comes from the story.
import { nice } from "./copy.mjs";
const money = (s, x) => (s.unit === "$" ? "$" + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 100 ? 0 : 2 }) : s.unit === "pips" ? Math.round(Math.abs(x) / (s.mk.includes("JPY") ? .01 : .0001)) + " pips" : Math.round(Math.abs(x)).toLocaleString("en-US") + " points");
const around = (s, i0, i1, a, b) => [Math.max(0, i0), Math.min(s.bars.length - 1, i1), a, b];

export const ANGLES = { ob: ["rule", "why", "mistake"], fvg: ["rule", "risk", "mistake"], crt: ["rule", "why"], asia: ["rule", "why"], break: ["rule", "mistake"], news: ["rule", "why"], nyopen: ["rule", "mistake"] };

export function lesson(s, angle) {
  const tr = s.trade, long = tr ? tr.side === "long" : s.side === "high", z = s.zone, B = s.bars;
  const hiLo = s.side === "high" ? "high" : "low", other = s.side === "high" ? "low" : "high";
  let res = tr ? { cap: "Target hit. +2R.", tone: "up", show: ["result"] } : null;
  const mv = s.measure ? money(s, s.measure.to - s.measure.from) : "", pct = s.measure ? Math.abs((s.measure.to - s.measure.from) / s.measure.from * 100).toFixed(2) : "";
  const entryFocus = tr && around(s, tr.iE - 5, tr.iE + 3, z ? (long ? z.top : z.bot) : tr.entry, tr.stop);
  // the trade frame: from a few bars before the entry to the exit, stop to target — risk + result steps stay framed on it
  const tradeFocus = tr && around(s, tr.iE - 6, Math.min(B.length - 1, tr.iX + 3), tr.stop, tr.target);
  if (res) res = { ...res, focus: around(s, tr.iE - 6, Math.min(B.length - 1, tr.iX + 3), tr.stop, tr.target) };
  let steps;
  switch (s.model) {
    case "ob": {
      const bos = { to: s.bos.i1, show: ["bos"], point: { i: s.bos.i1, price: s.bos.price }, focus: around(s, s.bos.i0 - 1, s.bos.i1 + 1, s.bos.price, B[s.bos.i1].c) };
      const obS = { to: s.bos.i1, show: ["zone"], point: { i: z.i0, price: (z.top + z.bot) / 2 }, focus: around(s, z.i0 - 2, s.bos.i1 + 2, z.top, z.bot) };
      const back = { to: tr.iE - 1, show: s.liq?.length ? ["liq"] : [] };
      const tap = { to: tr.iE, slow: true, show: ["entry"], focus: entryFocus, point: { i: tr.iE, price: tr.entry } };
      const risk = { show: ["tool"], hold: 2.1, focus: tradeFocus };
      if (angle === "why") steps = [
        { ...bos, cap: "Price breaks structure." },
        { ...obS, cap: `This ${long ? "down" : "up"} candle started the move. That's the order block.` },
        { ...back, cap: s.liq?.length ? `Stops sit ${long ? "under these lows" : "above these highs"}. Price takes them first.` : "Price drifts back toward it." },
        { ...tap, cap: "Then it taps the order block." },
        { ...risk, cap: `Stop ${long ? "under" : "over"} the block. Target 2R.` }, { to: tr.iX, ...res }];
      else if (angle === "mistake") steps = [
        { ...bos, cap: "Structure breaks. Most traders chase it here." },
        { ...obS, cap: `Better: wait for the last ${long ? "down" : "up"} candle before the break.` },
        { ...back, cap: "Let price come back to you." },
        { ...tap, cap: "Entry on the tap. Not the chase." },
        { ...risk, cap: "Tight stop. 2R target." }, { to: tr.iX, ...res }];
      else steps = [
        { ...bos, cap: "1. Price breaks structure." },
        { ...obS, cap: `2. The last ${long ? "down" : "up"} candle before the break = the order block.` },
        { ...back, cap: "3. Wait for price to come back." },
        { ...tap, cap: "4. It taps the block. Entry." },
        { ...risk, cap: `5. Stop past the block. Target 2R.` }, { to: tr.iX, ...res }];
      break;
    }
    case "fvg": {
      const three = { to: z.i0 + 2, show: ["three"], focus: around(s, z.i0 - 2, z.i0 + 4, Math.max(B[z.i0].h, B[z.i0 + 2].h), Math.min(B[z.i0].l, B[z.i0 + 2].l)) };
      const gap = { show: ["zone"], focus: three.focus, point: { i: z.i0 + 1, price: (z.top + z.bot) / 2 } };
      const tap = { to: tr.iE, slow: true, show: ["entry"], focus: entryFocus, point: { i: tr.iE, price: tr.entry } };
      const risk = { show: ["tool"], hold: 2.1, focus: tradeFocus };
      if (angle === "risk") steps = [
        { ...three, cap: "A big candle moves too fast." },
        { ...gap, cap: "It leaves a gap between candle 1 and candle 3." },
        { ...tap, cap: "Price comes back into the gap." },
        { ...risk, cap: `The stop goes past the gap. If it fills completely, you're wrong.` },
        { to: tr.iX, ...res }];
      else if (angle === "mistake") steps = [
        { ...three, cap: "Don't chase this candle." },
        { ...gap, cap: "Mark the gap it left: wick 1 to wick 3." },
        { ...tap, cap: "Wait for price to return to it." },
        { ...risk, cap: "Entry in the gap. Stop past it. 2R." }, { to: tr.iX, ...res }];
      else steps = [
        { ...three, cap: "1. Three candles. The middle one moves fast." },
        { ...gap, cap: "2. The gap between wick 1 and wick 3 is the FVG." },
        { ...tap, cap: "3. Price returns to the gap. Entry." },
        { ...risk, cap: "4. Stop past the gap. Target 2R." }, { to: tr.iX, ...res }];
      break;
    }
    case "crt": {
      const back = Math.min(B.length - 1, B.findIndex((b, i) => i > s.kb && (s.side === "low" ? b.c > s.level : b.c < s.level)));
      const k = back > 0 ? back : s.kb + 1;
      steps = [
        { to: 0, show: ["level"], cap: `Mark yesterday's ${hiLo}.`, hold: 1.6 },
        { to: s.kb, slow: true, show: ["cross"], point: { i: s.kb, price: s.level }, cap: angle === "why" ? `Stops sit past it. Price takes them…` : `Price trades through it…`, focus: around(s, s.kb - 6, s.kb + 3, s.level, s.side === "low" ? B[s.kb].l : B[s.kb].h) },
        { to: k, cap: "…and closes back inside. That's a CRT.", focus: around(s, s.kb - 6, k + 3, s.level, s.side === "low" ? B[s.kb].l : B[s.kb].h) },
        { to: s.bars.length - 1, show: ["measure"], cap: angle === "why" ? `The sweep was the turn: ${mv} the other way.` : `${mv} the other way.`, tone: s.side === "low" ? "up" : "dn", hold: 2 }];
      break;
    }
    case "asia":
      steps = [
        { to: z.i1, show: ["zone"], cap: angle === "why" ? "Asia is quiet. It builds a range." : "Mark the Asian range: 8pm to midnight New York.", focus: around(s, z.i0 - 1, z.i1 + 2, z.top, z.bot) },
        { to: s.kb, slow: true, show: ["level", "cross"], point: { i: s.kb, price: s.level }, cap: `The ${hiLo} breaks first.`, focus: around(s, s.kb - 8, s.kb + 3, z.top, z.bot) },
        { to: s.bars.length - 1, show: ["measure"], cap: angle === "why" ? `The ${other} never broke. The first break showed the day's direction.` : `The ${other} never breaks. ${mv} on a ${(s.rel / 100).toFixed(1)}× day.`, tone: s.side === "high" ? "up" : "dn", hold: 2.3 }];
      break;
    case "break":
      steps = [
        { to: 0, show: ["level"], cap: `Mark yesterday's ${hiLo}.`, hold: 1.6 },
        { to: s.kb, slow: true, show: ["cross"], point: { i: s.kb, price: s.level }, cap: "Price breaks it.", focus: around(s, s.kb - 8, s.kb + 3, s.level, s.side === "high" ? B[s.kb].h : B[s.kb].l) },
        { to: Math.min(s.bars.length - 1, s.kb + 6), cap: angle === "mistake" ? "Fading it here is the mistake: no close back inside." : "No close back inside. That's a break, not a sweep." },
        { to: s.bars.length - 1, show: ["measure"], cap: `${mv} past the level.`, tone: s.side === "high" ? "up" : "dn", hold: 2 }];
      break;
    case "news":
      steps = [
        { to: s.kb - 1, show: ["level"], cap: angle === "why" ? `Before ${s.event.name}: the market waits.` : `${s.event.name} at ${s.event.time} New York.` },
        { to: s.kb, slow: true, show: ["cross"], point: { i: s.kb, price: s.side === "high" ? B[s.kb].h : B[s.kb].l }, cap: s.event.actual != null && s.event.forecast != null ? `It prints ${s.event.actual} vs ${s.event.forecast} expected.` : "The release candle.", focus: around(s, s.kb - 6, s.kb + 4, B[s.kb].h, B[s.kb].l) },
        { to: s.bars.length - 1, show: ["measure"], cap: `First hour: ${mv}. ${s.ofDay}% of a normal day.`, tone: s.side === "high" ? "up" : "dn", hold: 2.2 }];
      break;
    case "nyopen":
      steps = [
        { to: z.i1, show: ["zone"], cap: "Mark the first 15 minutes of New York.", focus: around(s, z.i0 - 3, z.i1 + 3, z.top, z.bot) },
        { to: s.kb, slow: true, show: ["level", "cross"], point: { i: s.kb, price: s.level }, cap: angle === "mistake" ? `Don't guess the side. Wait for the ${hiLo} to break.` : `The ${hiLo} breaks.`, focus: around(s, s.kb - 8, s.kb + 3, z.top, z.bot) },
        { to: s.bars.length - 1, show: ["measure"], cap: `The ${other} never trades again. ${mv}.`, tone: s.side === "high" ? "up" : "dn", hold: 2.2 }];
      break;
  }
  return { angle, steps: steps.filter(Boolean) };
}
