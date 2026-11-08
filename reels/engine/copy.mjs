// COPY — on-screen words + platform captions. Every word true to the story's numbers.
// Hook families (an arm the brain learns): name · result · question · pov · time. Each family has several phrasings per model,
// picked by a hash, and the brain refuses any title used in the last 30 days, so no two reels read alike.
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYN = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const NICE = { XAUUSD: "Gold", XAGUSD: "Silver", USOIL: "Oil", NAS100: "Nasdaq", SP500: "S&P 500", US30: "Dow", EURUSD: "EURUSD", GBPUSD: "GBPUSD", USDJPY: "USDJPY", AUDUSD: "AUDUSD", BTCUSD: "Bitcoin", ETHUSD: "Ethereum" };
export const nice = (mk) => NICE[mk] || mk;
const money = (s, x) => (s.unit === "$" ? "$" + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) >= 100 ? 0 : 2 }) : s.unit === "pips" ? Math.round(Math.abs(x) / (s.mk.includes("JPY") ? .01 : .0001)) + " pips" : Math.round(Math.abs(x)).toLocaleString("en-US") + " pts");
const NAME = { ob: ["OB", "ENTRY"], fvg: ["FVG", "ENTRY"], crt: ["CRT", "SETUP"], asia: ["ASIA", "RANGE"], break: ["PDH", "BREAK"], news: ["NEWS", "SPIKE"], nyopen: ["NY OPEN", "BREAK"] };

export function titleOptions(s, fam) {
  const nm = [...NAME[s.model]]; if (s.model === "break" && s.side === "low") nm[0] = "PDL"; if (s.model === "news") nm[0] = s.event.name;
  const mv = (s.trade ? "+2R" : money(s, s.measure.to - s.measure.from)).toUpperCase(), n = nice(s.mk).toUpperCase();
  const trade = !!s.trade, verb = { asia: "BROKE", break: "BROKE", nyopen: "BROKE", crt: "SWEPT", news: "DROPPED" }[s.model];
  const F = {
    name: [nm, [nm[0], `${nm[1]} · ${n}`], [n, nm.join(" ")], [n, nm[0]]],
    result: trade ? [[mv, nm.join(" ")], [nm[0], `→ ${mv}`]] : [[nm[0], `→ ${mv}`], [`${n} ${nm[0]}`, `→ ${mv}`]],
    question: trade ? [[nm[0], "OR TRAP?"], ["WOULD YOU", "TAKE THIS?"], ["TAKE THIS", `${nm[0]}?`]] : [[nm[0], "OR TRAP?"], ["WOULD YOU", "TRADE THIS?"]],
    pov: trade ? [["POV:", `${nm[0]} TAPPED`], ["POV:", "YOU WAITED"]] : [["POV:", `${nm[0]} ${verb}`], ["POV:", "YOU MARKED IT"]],
    time: s.when9 ? [[s.when9, nm.join(" ")]] : [[DAYN[s.wd]?.toUpperCase() || n, nm.join(" ")]],
  }[fam] || [nm];
  // never a doubled word ("FVG FVG ENTRY"), never too long for one clean line
  return F.filter((x) => { if (!x[0]) return false; const w = (x[0] + " " + (x[1] || "")).toUpperCase().split(/\s+/).filter((y) => /[A-Z]/.test(y)); return new Set(w).size === w.length && (x[0] + " " + x[1]).length <= 20; });
}

export function copy(s, fam, avoid = new Set()) {
  const d = new Date(s.date + "T12:00:00Z"), when = `${s.wd} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`, kt = s.bars[s.kb].lab;
  s.when9 = s.model === "news" ? `${s.event.time} NY` : s.model === "nyopen" ? "9:30 NY" : null;
  const opts = titleOptions(s, fam), h = hash(s.id + fam); let title = null;
  for (let k = 0; k < opts.length; k++) { const c = opts[(h + k) % opts.length]; if (!avoid.has(c.join(" "))) { title = c; break; } }
  if (!title) return null;
  const up = s.trade ? s.trade.side === "long" : s.side === "high", mv = s.measure ? money(s, s.measure.to - s.measure.from) : null;
  const pct = s.measure ? ((s.measure.to - s.measure.from) / s.measure.from * 100) : 0;
  const C = {
    ob: { cap1: "Structure breaks.", cap2: `Price returns to the OB.`, cap3: ["Target hit.", "+2R"], win: "+2R" },
    fvg: { cap1: "Price leaves a gap.", cap2: "It comes back to fill.", cap3: ["Target hit.", "+2R"], win: "+2R" },
    crt: { cap1: `Yesterday's ${s.side}.`, cap2: "Swept. Then back inside.", cap3: [`${mv}`, "from the sweep."] },
    asia: { cap1: "Asia sets the range.", cap2: `The ${s.side} breaks first.`, cap3: [`${mv}`, `· ${(s.rel / 100).toFixed(1)}× a normal day.`] },
    break: { cap1: `Yesterday's ${s.side}.`, cap2: "Breaks. Never looks back.", cap3: [`${mv}`, "past the level."] },
    news: { cap1: `${s.event?.name} at ${s.event?.time} New York.`, cap2: `${kt}. It prints.`, cap3: [`${mv}`, `· ${s.ofDay}% of a day's range.`] },
    nyopen: { cap1: "First 15 minutes set the range.", cap2: `The ${s.side} breaks.`, cap3: [`${mv}`, "from the break."] },
  }[s.model];
  const win = C.win || `${pct >= 0 ? "+" : "−"}${mv} (${Math.abs(pct).toFixed(2)}%)`;
  return { title, when, win, fam, mv: mv || "" };
}

// ── captions: IG and FB read differently ─────────────────────────────────────────────────────────────────────────────
// IG: the first line is all the feed shows → hook line; short story; one comment question; save line; 3–5 hashtags (IG caps at 5).
// FB: Reels on FB push to non-followers on watch time + shares; keywords in plain text matter more than tags → longer plain story, 2–3 tags.
const MTAG = { XAUUSD: "#xauusd", XAGUSD: "#silver", USOIL: "#crudeoil", NAS100: "#nasdaq", SP500: "#sp500", US30: "#us30", EURUSD: "#eurusd", GBPUSD: "#gbpusd", USDJPY: "#usdjpy", AUDUSD: "#audusd", BTCUSD: "#bitcoin", ETHUSD: "#ethereum" };
const CTAG = { ob: "#orderblock", fvg: "#fairvaluegap", crt: "#crt", asia: "#asiansession", break: "#liquidity", news: "#forexnews", nyopen: "#openingrange" };
export const TAGPOOLS = { smc: ["#smc", "#ict"], day: ["#daytrading", "#trading"], fx: ["#forex", "#forextrader"], pa: ["#priceaction", "#tradingview"], bt: ["#backtesting", "#tradingstrategy"] };
const EXPLAIN = {
  ob: (s) => `An order block is the last opposite candle before price breaks structure. ${nice(s.mk)} broke structure, pulled back into it, and paid 2R.`,
  fvg: (s) => `A fair value gap is a 3-candle imbalance. ${nice(s.mk)} left one, came back into it, and paid 2R.`,
  crt: (s) => `Candle range theory: price takes yesterday's ${s.side}, closes back inside, and runs the other way.`,
  asia: (s) => `The Asian session sets a range. On ${s.wdLong}, ${nice(s.mk)} broke the ${s.side} first and the other side never broke.`,
  break: (s) => `${nice(s.mk)} took yesterday's ${s.side} and never closed back inside.`,
  news: (s) => `${s.event?.name} printed at ${s.event?.time} New York${s.event?.actual != null && s.event?.forecast != null ? ` (actual ${s.event.actual} vs ${s.event.forecast} forecast)` : ""}. ${nice(s.mk)} moved ${s.ofDay}% of a normal day.`,
  nyopen: (s) => `The first 15 minutes of New York set the opening range. One side broke and ${nice(s.mk)} never came back.`,
};
const Q = {
  ob: ["Do you wait for the BOS before the OB?", "Would you take this entry?", "OB or no OB — what do you see?"],
  fvg: ["Do you trade the gap fill?", "Would you enter at the top of the gap or the middle?", "FVG entry or wait for confirmation?"],
  crt: ["Would you take the sweep?", "Do you wait for the close back inside?", "Do you mark yesterday's high and low?"],
  asia: ["Do you mark the Asian range?", "Asia high or low — which do you trade?", "Would you take the break?"],
  break: ["Retest or break — how do you trade it?", "Would you have faded it?", "Do you mark yesterday's high and low?"],
  news: ["Do you trade the release or wait?", "Would you fade the spike?", "Flat into news or in it?"],
  nyopen: ["Do you trade the opening range?", "Break or fakeout — what's your rule?", "First 15 minutes: trade or wait?"],
};
export function captions(s, cp, tagset, les) {
  const h = hash(s.id + "c"); s.wdLong = DAYN[s.wd];
  const hook = `${cp.title.join(" ").replace(/\s+/g, " ")} — ${nice(s.mk)}, ${cp.when}`;
  const pool = TAGPOOLS[tagset] || TAGPOOLS.smc, igTags = [MTAG[s.mk] || "#trading", CTAG[s.model], ...pool, "#crtlab"].slice(0, 5);
  const q = Q[s.model][h % 3], save = ["Save this for your next session.", "Save it and replay it yourself.", "Save this — it repeats."][h % 3];
  // the lesson's steps as a short how-to (what people save, and what search + AI crawlers read)
  const how = (les?.steps || []).filter((x) => x.cap && !x.show?.includes("result")).map((x) => `→ ${x.cap.replace(/…/g, "")}`).join("\n");
  const ig = `${hook}\n\n${EXPLAIN[s.model](s)}\n\n${how ? `The steps:\n${how}\n\n` : ""}${q} 👇\n${save}\n\nReal 1-minute data. Replay this exact day bar by bar at crtlab.pro (link in bio).\n\n${igTags.join(" ")}`;
  const fb = `${hook}\n\n${EXPLAIN[s.model](s)} Real 1-minute data, New York time.\n\n${how ? `${how}\n\n` : ""}${q}\n\nReplay this exact day bar by bar, free: https://crtlab.pro\n\n${[MTAG[s.mk] || "#trading", CTAG[s.model], "#trading"].join(" ")}`;
  return { ig, fb, tags: igTags };
}
