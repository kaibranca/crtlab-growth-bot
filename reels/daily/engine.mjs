// DAILY REEL ENGINE — reads the growth bot's recap for a day, picks the best stories, builds each reel's data from real 1-minute bars.
//   node reels/daily/engine.mjs <slot 1|2> [date]  → reels/out/props.json + reels/out/pick.json (what, why, the post caption)
//   on a thin day (fewer clean stories than slots) it falls back to an unposted story from the 4 days before
// Stories (only ones the day actually printed, every number from the bars):
//   asia — one side of the Asian range broke first and the other side held all day, on a big day
//   crt  — took yesterday's high/low and closed back inside (a daily CRT), the other side untouched
import fs from "node:fs";
const BOT = process.env.BOT_DIR || new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ICONS = new Set(fs.readdirSync(new URL("../public/m/", import.meta.url)).map((f) => f.replace(".webp", "")));
const NYF = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
const ny = (t) => { const p = Object.fromEntries(NYF.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour, m: +p.minute, wd: p.weekday }; };
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const tday = (t) => { const n = ny(t); return n.h >= 18 ? addDays(n.date, 1) : n.date; };
const lab = (t) => { const n = ny(t); return `${String(n.h).padStart(2, "0")}:${String(n.m).padStart(2, "0")}`; };
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function load(mk) {
  const dir = BOT + "/.cache/", f = fs.readdirSync(dir).filter((x) => x.startsWith(mk + "-")).sort().pop();
  return f ? JSON.parse(fs.readFileSync(dir + f, "utf8")) : null;
}

// one market, one day → TF-minute bars that keep their 1-minute path (so candles form exactly as they printed)
function dayBars(raw, D, TF = 15) {
  const day = raw.filter((b) => tday(b.t) === D && ny(b.t).h !== 17), agg = new Map();
  for (const b of day) { const k = Math.floor(b.t / (TF * 60)) * TF * 60, a = agg.get(k);
    if (!a) agg.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, m: [b] }); else { a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; a.m.push(b); } }
  return [...agg.values()].sort((a, b) => a.t - b.t);
}
// first minute that trades through a level → [bar index, minute index]
function cross(bars, from, level, side) {
  for (let i = from; i < bars.length; i++) for (const [j, m] of bars[i].m.entries()) if (side === "low" ? m.l < level : m.h > level) return [i, j];
  return null;
}

export function candidates(D, loose = 1) {
  const rec = JSON.parse(fs.readFileSync(`${BOT}/data/recaps/${D}.json`, "utf8")), out = [];
  for (const r of rec.markets) {
    if (!ICONS.has(r.id) || r.rel == null) continue;
    const raw = load(r.id); if (!raw) continue;
    const bars = dayBars(raw, D); if (bars.length < 60) continue;
    const prevD = [...new Set(raw.map((b) => tday(b.t)))].filter((d) => d < D).sort().pop(), pb = prevD && dayBars(raw, prevD);
    const hi = Math.max(...bars.map((b) => b.h)), lo = Math.min(...bars.map((b) => b.l)), open = bars[0].o, close = bars.at(-1).c, dn = close < open;
    const base = { mk: r.id, name: r.name, date: D, wd: ny(bars[0].t + 86400).wd, unit: r.unit, chg: r.chg, rel: r.rel, open, close, hi, lo, dp: r.unit === "pips" ? (r.id.includes("JPY") ? 3 : 5) : r.unit === "pts" ? (r.id === "US30" ? 0 : 2) : 2 };
    // asia: the side that broke first is the side the day went, the other never broke, big day
    const ai = bars.map((b, i) => (ny(b.t).h >= 20 && ny(b.t).h < 24 ? i : -1)).filter((i) => i >= 0);
    if (ai.length >= 12 && r.rel >= 150 * loose) {
      const a0 = ai[0], a1 = ai.at(-1), aH = Math.max(...ai.map((i) => bars[i].h)), aL = Math.min(...ai.map((i) => bars[i].l));
      const cl = cross(bars, a1 + 1, aL, "low"), ch = cross(bars, a1 + 1, aH, "high"), side = dn ? "low" : "high", k = dn ? cl : ch, other = dn ? ch : cl;
      if (k && !other) {
        const ext = dn ? bars.findIndex((b) => b.l === lo) : bars.findIndex((b) => b.h === hi), level = dn ? aL : aH;
        if (ext > k[0]) out.push({ ...base, story: "asia", side, level, a0, a1, aH, aL, kb: k[0], keyMin: k[1], ext, from: level, to: dn ? lo : hi, bars,
          score: r.rel / 100 + Math.abs(r.chg) * 1.5 + 1 });
      }
    }
    // crt: swept yesterday's extreme, closed back inside, the other extreme untouched
    if (pb?.length >= 20 && r.crt && r.rel >= 80 * loose) {
      const pH = Math.max(...pb.map((b) => b.h)), pL = Math.min(...pb.map((b) => b.l)), bull = r.crt === "bullish", level = bull ? pL : pH;
      const k = cross(bars, 0, level, bull ? "low" : "high"), other = cross(bars, 0, bull ? pH : pL, bull ? "high" : "low");
      const ext = bull ? bars.findIndex((b) => b.l === lo) : bars.findIndex((b) => b.h === hi);
      // clean: the sweep is the turn — back inside within 6 bars, barely any closes beyond it after, and it moves away
      const beyond = (b) => (bull ? b.c < level : b.c > level), back = k && bars.slice(k[0], k[0] + 7).some((b) => !beyond(b)), stay = k ? bars.slice(k[0]).filter(beyond).length : 99;
      const away = Math.abs(close - level) / (hi - lo);
      if (k && !other && back && stay <= 6 && away > .25 && k[0] >= 2 && ext >= k[0] && ext - k[0] <= 10 && ext < bars.length - 12) out.push({ ...base, story: "crt", side: bull ? "low" : "high", level, pH, pL, kb: k[0], keyMin: k[1], ext,
        from: bull ? lo : hi, to: close, bars, score: r.rel / 100 + Math.abs(close - (bull ? lo : hi)) / (hi - lo) * 2 + .8 });
    }
    // break: took yesterday's high/low and never closed back inside, the other side untouched, a real day
    if (pb?.length >= 20 && r.rel >= 100 * loose) {
      const pH = Math.max(...pb.map((b) => b.h)), pL = Math.min(...pb.map((b) => b.l)), up = !dn, level = up ? pH : pL;
      const k = cross(bars, 0, level, up ? "high" : "low"), other = cross(bars, 0, up ? pL : pH, up ? "low" : "high");
      const ext = up ? bars.findIndex((b) => b.h === hi) : bars.findIndex((b) => b.l === lo);
      const inside = k ? bars.slice(k[0] + 1).filter((b) => (up ? b.c < level : b.c > level)).length : 99, beyondClose = up ? close > level : close < level;
      if (k && !other && k[0] >= 3 && inside <= 3 && beyondClose && ext > k[0] + 3) out.push({ ...base, story: "break", side: up ? "high" : "low", level, pH, pL, kb: k[0], keyMin: k[1], ext,
        from: level, to: up ? hi : lo, bars, score: r.rel / 100 + Math.abs((up ? hi : lo) - level) / (hi - lo) * 2 + .6 });
    }
  }
  // learning: stories/markets that held attention get weighted up, a market posted in the last 2 days steps back
  const W = fs.existsSync(`${BOT}/data/reels/weights.json`) ? JSON.parse(fs.readFileSync(`${BOT}/data/reels/weights.json`, "utf8")) : {};
  const recent = fs.existsSync(`${BOT}/data/reels/log.jsonl`) ? fs.readFileSync(`${BOT}/data/reels/log.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.date < D && x.date >= addDays(D, -3)).map((x) => x.mk) : [];
  for (const c of out) c.score *= (W.story?.[c.story] ?? 1) * (W.market?.[c.mk] ?? 1) * (recent.includes(c.mk) ? .8 : 1);
  return out.sort((a, b) => b.score - a.score);
}

// the copy: a few true phrasings per story, picked by a hash of the day + market so no two reels read alike
const DAY = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const money = (c, x) => c.unit === "$" ? "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : c.unit === "pips" ? Math.round(x / (c.mk.includes("JPY") ? .01 : .0001)).toLocaleString("en-US") + " pips" : Math.round(x).toLocaleString("en-US") + " points";
function copy(c, skip = -1) {
  const h = hash(c.date + c.mk), pick = (a) => { let i = h % a.length; if (i === skip) i = (i + 1) % a.length; c.hv = i; return a[i]; }, mv = money(c, Math.abs(c.to - c.from)), up = c.side === "high";
  if (c.story === "asia") return {
    hook: pick([[`${c.name} ${up ? "rose" : "fell"} ${Math.abs(c.chg).toFixed(2)}% on ${DAY[c.wd]}.`, "Asia called it."], [`${c.name} ${up ? "rose" : "fell"} ${mv} after one break.`, "Asia drew the line."], [`Watch ${c.name}'s Asian ${c.side}.`, "That was the whole day."]]),
    setup: "Asia sets the range.", key: `The ${c.side} breaks first.`, after: `The ${up ? "low" : "high"} never breaks.`,
    stat: [`${(c.rel / 100).toFixed(1)}×`, " a normal day."], measure: `${up ? "+" : "−"}${mv}`, end: "Replay this day on CRTLAB." };
  const y = up ? "high" : "low";
  if (c.story === "break") return {
    hook: pick([[`${c.name} broke yesterday's ${y}.`, "It never came back."], [`Yesterday's ${y} was the line.`, `${c.name} went straight through.`], [`${c.name} ${up ? "rose" : "fell"} ${mv} past yesterday's ${y}.`, "One clean break."]]),
    setup: `Yesterday's ${y}.`, key: "Breaks.", after: "Never closes back inside.", stat: [`${(c.rel / 100).toFixed(1)}×`, " a normal day."], measure: `${up ? "+" : "−"}${mv}`, end: "Replay this day on CRTLAB." };
  return {
    hook: pick([[`${c.name} took yesterday's ${y}…`, "then reversed."], [`Stops sat at yesterday's ${y}.`, `${c.name} took them.`], [`One sweep of yesterday's ${y}.`, "The whole day turned."]]),
    setup: `Yesterday's ${y}.`, key: "Swept.", after: "Closes back inside.", stat: ["That's a CRT.", ""], measure: `${up ? "−" : "+"}${mv}`, end: "Replay this day on CRTLAB." };
}

export function props(c, skip) {
  const cp = copy(c, skip), { bars, ...rest } = c;
  return { ...rest, copy: cp, bars: bars.map(({ t, o, h, l, c: cc, m }) => ({ t, lab: lab(t), o, h, l, c: cc, p: m.map((x) => [x.h, x.l, x.c]) })) };
}

// two slots a day: the best story, then the best one on a different market (a different story type when there is one)
export function pick(D, slots = 2) {
  let cs = candidates(D); if (new Set(cs.map((c) => c.mk)).size < slots) cs = [...cs, ...candidates(D, .7).filter((c) => !cs.some((x) => x.mk === c.mk && x.story === c.story)).map((c) => ({ ...c, score: c.score * .6 }))];
  const out = [];
  for (let s = 0; s < slots && cs.length; s++) {
    const used = new Set(out.map((o) => o.mk)), types = new Set(out.map((o) => o.story));
    const c = cs.find((x) => !used.has(x.mk) && !types.has(x.story)) || cs.find((x) => !used.has(x.mk)); if (!c) break; out.push(c);
  }
  return out;
}

// the post text, written for reach: the hook is the first line (it's all the feed shows), plain-words story, one question that invites a comment,
// one save line, then 5 hashtags — Instagram caps a post at 5 now, so they're the market + the concept + trading
const TAG = { XAUUSD: "#xauusd", XAGUSD: "#silver", USOIL: "#crudeoil", NAS100: "#nasdaq", SP500: "#sp500", US30: "#us30", EURUSD: "#eurusd", GBPUSD: "#gbpusd", USDJPY: "#usdjpy", AUDUSD: "#audusd", ETHUSD: "#ethereum" };
const CONCEPT = { asia: "#asiansession", crt: "#crt", break: "#liquidity" };
function caption(c, p) {
  const h = hash(c.mk + c.date + "q"), day = DAY[c.wd], px = (v) => v.toLocaleString("en-US", { minimumFractionDigits: c.dp, maximumFractionDigits: c.dp });
  const what = c.story === "asia" ? `${day}, ${c.name}: the Asian ${c.side} at ${px(c.level)} broke first. The other side never broke. ${p.copy.measure} from the break, on a day ${(c.rel / 100).toFixed(1)}× the normal range.`
    : c.story === "crt" ? `${day}, ${c.name}: price swept yesterday's ${c.side} at ${px(c.level)}, then closed back inside. ${p.copy.measure} from the sweep. Sweep + close back inside = a CRT.`
    : `${day}, ${c.name}: yesterday's ${c.side} at ${px(c.level)} broke and price never closed back inside. ${p.copy.measure} past the level.`;
  const q = { asia: ["Do you mark the Asian range every day?", "Would you have taken the break?", "Asia high or low — which do you trade?"],
    crt: ["Would you have shorted the sweep?", "Do you wait for the close back inside?", "Sweep or no sweep — what's your entry?"],
    break: ["Do you trade the break or wait for the retest?", "Would you have faded it?", "Do you mark yesterday's high and low?"] }[c.story];
  const save = ["Save this for your next session.", "Save this — it happens more than you think.", "Save this and replay it yourself."][h % 3];
  return `${p.copy.hook.join(" ")}\n\n${what}\n\n${q[h % q.length]} 👇\n${save}\n\nReal 1-minute data, New York time. Replay this exact day bar by bar on CRTLAB, link in bio.\n\n${TAG[c.mk] || "#forex"} ${CONCEPT[c.story]} #trading #daytrading #ict`;
}
const readLog = () => (fs.existsSync(`${BOT}/data/reels/log.jsonl`) ? fs.readFileSync(`${BOT}/data/reels/log.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const latest = () => fs.readdirSync(`${BOT}/data/recaps`).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort().pop().slice(0, 10);

export function choose(slot, D = latest()) {
  const done = new Set(readLog().map((x) => `${x.date}|${x.mk}|${x.story}`));
  let ps = pick(D, 2), c = ps[slot - 1], skip = slot === 2 && c && ps[0].story === c.story ? (props(ps[0]), ps[0].hv) : -1;
  if (c && done.has(`${c.date}|${c.mk}|${c.story}`)) c = null;
  for (let back = 1; !c && back <= 4; back++) { const d = fs.existsSync(`${BOT}/data/recaps/${addDays(D, -back)}.json`) && addDays(D, -back); if (!d) continue;
    const today = new Set(ps.map((x) => x.mk)); c = pick(d, 3).find((x) => !done.has(`${x.date}|${x.mk}|${x.story}`) && !today.has(x.mk)) || null; }
  if (!c) return null;
  const p = props(c, skip);
  return { props: p, pick: { date: c.date, mk: c.mk, story: c.story, side: c.side, hook: p.copy.hook.join(" "), hv: c.hv, score: +c.score.toFixed(2), caption: caption(c, p) } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slot = +(process.argv[2] || 1), r = choose(slot, process.argv[3] || undefined), out = new URL("../out/", import.meta.url);
  fs.mkdirSync(out, { recursive: true });
  if (!r) { console.log("no story"); process.exit(3); }
  fs.writeFileSync(new URL("props.json", out), JSON.stringify(r.props)); fs.writeFileSync(new URL("pick.json", out), JSON.stringify(r.pick, null, 1));
  console.log(slot, r.pick.date, r.pick.mk, r.pick.story, r.pick.hook);
}
