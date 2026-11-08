// DAILY PLAN — node reels/engine/plan.mjs [YYYY-MM-DD]  → data/reels/plan-<date>.json + reels/out/reel-<k>.json (render props)
// Two reels a day. Reel 1 = the cycle's model for the weekday, reel 2 = the brain's pick (different model, different market).
// Stories come from the last 7 recap days (fresher = better; never one already posted). Each platform gets its own 2 learned hours.
import fs from "node:fs";
import { candidates, recapDays, addDays } from "./stories.mjs";
import { copy, captions } from "./copy.mjs"; import { lesson, ANGLES } from "./lesson.mjs";
import { ARMS, music, rng, pick, cycleModel, fallback, hours, memory, brain, save, DIR } from "./brain.mjs";

const today = process.argv[2] || new Date().toISOString().slice(0, 10);
const WDN = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const r = rng("plan" + today), B = brain(), mem = memory(today);
if (fs.existsSync(`${DIR}/plan-${today}.json`) && !process.env.FORCE) { console.log("plan exists", today); process.exit(0); }

// the pool: last 7 New York days we have recaps for, scored × freshness × how big the day was (what traders are talking about)
const days = recapDays().filter((d) => d < today && d >= addDays(today, -8)).slice(-7);
const age = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
let pool = days.flatMap((d) => candidates(d).map((s) => ({ ...s, rank: s.score * Math.pow(.82, Math.max(0, age(d) - 1)) })));
pool = pool.filter((s) => !mem.stories.has(s.id) && !mem.mkModel.has(`${s.mk}|${s.model}`));
console.log("pool", pool.length, "stories from", days.join(","));
if (!pool.length) { console.log("NO STORIES"); process.exit(3); }

// safety valve: if learn.mjs saw reach collapse on either platform, drop to 1 reel a day until it recovers
const status = fs.existsSync(`${DIR}/status.json`) ? JSON.parse(fs.readFileSync(`${DIR}/status.json`, "utf8")) : {}, SLOTS = (status.alerts || []).some(([k]) => k.startsWith("reach-")) ? 1 : 2;
const chosen = [];
const best = (model, used) => pool.filter((s) => s.model === model && !used.has(s.mk) && !mem.mkToday.has(s.mk)).sort((a, b) => b.rank - a.rank)[0];
const usedMk = new Set();
// reel 1: the cycle
let m1 = cycleModel(WDN, B), s1 = best(m1, usedMk) || best(fallback(m1), usedMk);
// reel 2: the brain (Thompson over the models that have a story today)
if (s1) { chosen.push(s1); usedMk.add(s1.mk); }
const avail = ARMS.model.filter((m) => m !== s1?.model && best(m, usedMk));
const m2 = pick("model", avail, r, { B }), s2 = m2 && best(m2, usedMk);
if (s2 && SLOTS > 1) chosen.push(s2);
while (chosen.length < SLOTS) { const s = pool.filter((x) => !chosen.some((c) => c.mk === x.mk || c.id === x.id)).sort((a, b) => b.rank - a.rank)[0]; if (!s) break; chosen.push(s); }

const igH = hours("ig", r, B), fbH = hours("fb", r, B), at = (h, k) => {
  const base = new Date(today + "T00:00:00Z"); if (h < 9) base.setUTCDate(base.getUTCDate() + 1);   // 00–02 UTC = the same posting day, next calendar date
  base.setUTCHours(h, 3 + Math.floor(r() * 40), 0, 0); return base.toISOString();                    // minute jitter: never on the dot
};
const plan = { date: today, wd: WDN, made: new Date().toISOString(), reels: [] }, titles = new Set(mem.titles);
fs.mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
for (const [k, s] of chosen.entries()) {
  // the look: learned arms, never the same look twice in a row
  let fam, angle, pace, cp = null;
  for (let tries = 0; tries < 12 && !cp; tries++) {
    fam = pick("fam", ARMS.fam, r, { B, explore: tries ? .5 : .15 }); angle = pick("angle", ANGLES[s.model], r, { B }); pace = pick("pace", ARMS.pace, r, { B });
    if (mem.lastLook.includes(`${fam}|${angle}|${pace}`) || plan.reels.some((x) => x.fam === fam && x.angle === angle)) continue;
    cp = copy(s, fam, titles);
  }
  if (!cp) { fam = "name"; angle = angle || "rule"; cp = copy(s, "name", new Set()); }
  titles.add(cp.title.join(" "));
  const tagset = pick("tagset", ARMS.tagset, r, { plat: "ig", B });
  const caps = captions(s, cp, tagset);
  const props = { ...s, copy: cp, lesson: lesson(s, angle), look: { pace } };
  fs.writeFileSync(new URL(`../out/reel-${k}.json`, import.meta.url), JSON.stringify(props));
  plan.reels.push({ k, story: s.id, date: s.date, mk: s.mk, model: s.model, title: cp.title.join(" "), fam, angle, pace, tagset,
    cycle: k === 0 ? WDN : "brain", ig: { at: at(igH[k], k), hour: igH[k], caption: caps.ig }, fb: { at: at(fbH[k], k), hour: fbH[k], caption: caps.fb } });
  console.log(`reel ${k}: ${s.date} ${s.mk} ${s.model} "${cp.title.join(" ")}" ${fam}/${angle}/${pace} tags:${tagset} · IG ${igH[k]}:xx FB ${fbH[k]}:xx UTC`);
}
save(`plan-${today}.json`, plan);
