// DAILY PLAN — node reels/engine/plan.mjs [YYYY-MM-DD]  → data/reels/plan-<date>.json + reels/out/reel-<k>.json (render props)
// Two reels a day. Reel 1 = the cycle's model for the weekday, reel 2 = the brain's pick (different model, different market).
// Stories come from the last 7 recap days (fresher = better; never one already posted). Each platform gets its own 2 learned hours.
import fs from "node:fs";
import { candidates, recapDays, addDays } from "./stories.mjs";
import { copy, captions } from "./copy.mjs"; import { lesson, ANGLES } from "./lesson.mjs";
import { ARMS, music, rng, pick, cycleModel, fallback, hours, memory, brain, save, DIR } from "./brain.mjs";
import { champion } from "./pulse.mjs";

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
// v14 (11-14) CHAMPION / CHALLENGER + LOCK-IN. Kai: single-concept titles (OB ENTRY, FVG ENTRY, SMC, ICT) took his old accounts to
// 200k views / 19k followers; on 11-13 "OB ENTRY" did 5,930 FB plays (10× normal), matching the 10-18 IG best. So:
//   slot 1 = the CHAMPION formula (pulse.mjs keeps it: the latest breakout, prior = OB ENTRY) on a fresh chart, every day
//   slot 2 = a CHALLENGER the brain explores … unless LOCK-IN: a breakout in the last 7 days → slot 2 is the champion's sibling
//            (same concept-name family, the other zone model) so the abnormal week is fed, not diluted. 20% stays a test.
const CH = champion(), lockIn = CH.at && Date.now() - Date.parse(CH.at) < 7 * 864e5 && (CH.x || 0) >= 4;
const SIB = { ob: "fvg", fvg: "ob" };
let m1 = CH.model, s1 = best(m1, usedMk) || best(SIB[m1] || fallback(m1), usedMk) || best(cycleModel(WDN, B), usedMk);
if (s1) { chosen.push(s1); usedMk.add(s1.mk); }
const sib = SIB[s1?.model] || "fvg", exploit2 = lockIn && r() > .2;
const avail = ARMS.model.filter((m) => m !== s1?.model && best(m, usedMk));
const m2 = exploit2 && best(sib, usedMk) ? sib : pick("model", avail, r, { B }), s2 = m2 && best(m2, usedMk);
if (s2 && SLOTS > 1) chosen.push(s2);
while (chosen.length < SLOTS) { const s = pool.filter((x) => !chosen.some((c) => c.mk === x.mk || c.id === x.id)).sort((a, b) => b.rank - a.rank)[0]; if (!s) break; chosen.push(s); }
console.log("champion", JSON.stringify(CH), "lock-in", lockIn, "slot2", exploit2 ? "sibling" : "challenger");

const igH = hours("ig", r, B), fbH = hours("fb", r, B), at = (h, k) => {
  const base = new Date(today + "T00:00:00Z"); if (h < 9) base.setUTCDate(base.getUTCDate() + 1);   // 00–02 UTC = the same posting day, next calendar date
  base.setUTCHours(h, 3 + Math.floor(r() * 40), 0, 0); return base.toISOString();                    // minute jitter: never on the dot
};
const NAMEOF = { ob: "OB ENTRY", fvg: "FVG ENTRY", crt: "CRT SETUP", asia: "ASIA RANGE", nyopen: "NY OPEN BREAK" };
const plan = { date: today, wd: WDN, made: new Date().toISOString(), reels: [] }, titles = new Set(mem.titles);
fs.mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
for (const [k, s] of chosen.entries()) {
  // the look: learned arms, never the same look twice in a row
  let fam, angle, pace, cp = null;
  const champ = k === 0 || (k === 1 && exploit2);
  if (champ) { // the champion look: same title family, angle, pace; slot 1 keeps the exact title when it fits ("OB ENTRY")
    fam = CH.fam || "name"; angle = ANGLES[s.model].includes(CH.angle) ? CH.angle : "rule"; pace = CH.pace || "short";
    cp = copy(s, fam, new Set(), k === 0 && s.model === CH.model ? CH.title : NAMEOF[s.model]) || copy(s, "name", new Set(), NAMEOF[s.model]);
  }
  for (let tries = 0; tries < 12 && !cp; tries++) {
    fam = pick("fam", ARMS.fam, r, { B, explore: tries ? .5 : .2 }); angle = pick("angle", ANGLES[s.model], r, { B }); pace = pick("pace", ARMS.pace, r, { B });
    if (mem.lastLook.includes(`${fam}|${angle}|${pace}`) || plan.reels.some((x) => x.fam === fam && x.angle === angle)) continue;
    cp = copy(s, fam, titles);
  }
  if (!cp) { fam = "name"; angle = angle || "rule"; cp = copy(s, "name", new Set()); }
  titles.add(cp.title.join(" "));
  const tagset = pick("tagset", ARMS.tagset, r, { plat: "ig", B });
  // caption details: picked per platform from what each audience has rewarded (with exploration)
  const ch = { ig: { q: pick("q", ARMS.q, r, { plat: "ig", B }), save: pick("save", ARMS.save, r, { plat: "ig", B }), close: pick("close", ARMS.close, r, { plat: "ig", B }) },
               fb: { q: pick("q", ARMS.q, r, { plat: "fb", B }), close: pick("close", ARMS.close, r, { plat: "fb", B }) } };
  // music: learned (pooled IG+FB) but ROTATED — never a track used by the last 4 reels or by today's other reel (Kai 11-14: "music
  // repeats, sometimes annoying"); data/reels/music.json {"ban": ["414"]} drops a track for good. "none" is not in the rotation.
  const MB = fs.existsSync(`${DIR}/music.json`) ? JSON.parse(fs.readFileSync(`${DIR}/music.json`, "utf8")) : {}, banned = new Set(MB.ban || []);
  const fresh = ARMS.track.filter((x) => x !== "none" && !banned.has(x) && !mem.tracks.includes(x) && !plan.reels.some((y) => y.track === x));
  const track = pick("track", fresh.length ? fresh : ARMS.track.filter((x) => x !== "none" && !banned.has(x)), r, { B, explore: .3 });
  const les = lesson(s, angle, { quiz: fam === "quiz" }), caps = captions(s, cp, tagset, les, ch), props = { ...s, copy: cp, lesson: les, look: { pace, track } };
  fs.writeFileSync(new URL(`../out/reel-${k}.json`, import.meta.url), JSON.stringify(props));
  plan.reels.push({ k, story: s.id, date: s.date, mk: s.mk, model: s.model, title: cp.title.join(" "), fam, angle, pace, tagset,
    track, cycle: champ ? (k === 0 ? "champion" : "lock-in") : "brain", ig: { at: at(igH[k], k), hour: igH[k], caption: caps.ig, arms: ch.ig }, fb: { at: at(fbH[k], k), hour: fbH[k], caption: caps.fb, arms: ch.fb } });
  console.log(`reel ${k}: ${s.date} ${s.mk} ${s.model} "${cp.title.join(" ")}" ${fam}/${angle}/${pace} tags:${tagset} · IG ${igH[k]}:xx FB ${fbH[k]}:xx UTC`);
}
save(`plan-${today}.json`, plan);
