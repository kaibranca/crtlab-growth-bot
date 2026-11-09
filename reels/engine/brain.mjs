// THE BRAIN — what to post, when, and how it should look, learned from the account's own numbers.
//   state: data/reels/log.jsonl (every post) · metrics.json (insights) · brain.json (arm stats) · plan-<date>.json (today)
// Learning: each post gets a reward per platform (IG and FB scored separately, their algorithms differ). Every choice is an "arm"
// (model, hook family, camera, pace, music, tag set, posting hour). Arms are picked by Thompson sampling: a noisy draw around each
// arm's average reward, noise shrinking as evidence grows — so it leans on what works and keeps testing the rest. 15% of picks are
// pure exploration so it never locks into a local favourite.
import fs from "node:fs";
import { BOT, addDays } from "./stories.mjs";
export const DIR = `${BOT}/data/reels`;
const J = (f, d) => (fs.existsSync(`${DIR}/${f}`) ? JSON.parse(fs.readFileSync(`${DIR}/${f}`, "utf8")) : d);
export const readLog = () => (fs.existsSync(`${DIR}/log.jsonl`) ? fs.readFileSync(`${DIR}/log.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
export const save = (f, x) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(`${DIR}/${f}`, JSON.stringify(x, null, 1)); };

export const ARMS = {
  model: ["ob", "fvg", "crt", "asia", "break", "news", "nyopen"],
  fam: ["name", "result", "question", "pov", "time"],
  angle: ["rule", "why", "mistake", "risk"],          // the lesson angle (engine/lesson.mjs); each model offers a subset
  pace: ["short", "long"],
  tagset: ["smc", "day", "fx", "pa", "bt"],
  // caption details, learned PER PLATFORM (IG and FB audiences answer differently): question style, save line, closing line
  q: [0, 1, 2], save: [0, 1, 2], close: [0, 1, 2],
  // the music bed is learned too (Mixkit ids, fetched per run) — including no music at all, so the data decides
  track: ["281", "293", "414", "296", "455", "375", "367", "1102", "none"],
  // posting hours (UTC). 09–23 + 00–02: London morning through the US evening. The plan picks 2 a day per platform, ≥3h apart.
  hour: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], // 00–02 UTC REMOVED (Kai 11-09): a "late" 2nd reel landed on the NEXT calendar day, so days got 1 or 3 posts; both now fall inside the same UTC day, ≥10h apart (9–13 + 19–23)
};
export const music = () => { const d = new URL("../public/music/", import.meta.url); return ["none", ...(fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.(mp3|wav|m4a)$/i.test(f)) : [])]; };
// the 7-day cycle: slot 1 each day is the day's model (a structured week); slot 2 is the brain's pick. A cycle model that keeps
// losing (≥4 posts, clearly below average) hands its day to the best model until it earns it back.
export const CYCLE = { Mon: "crt", Tue: "asia", Wed: "news", Thu: "break", Fri: "nyopen", Sat: "ob", Sun: "fvg" };
const FALLBACK = { news: "fvg", nyopen: "ob", asia: "break", crt: "ob", break: "fvg", ob: "fvg", fvg: "ob" };

// seeded randomness: same day → same plan if re-run (no double posts on retries)
export function rng(seed) { let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

// stats[platform][arm][value] = { n, sum } of rewards
export const brain = () => J("brain.json", { ig: {}, fb: {}, at: null, n: 0 });
function draw(B, plat, arm, value, r) {
  const s = B[plat]?.[arm]?.[value] || { n: 0, sum: 0 }, k = 2; // prior: 2 pseudo-posts at average (0)
  return s.sum / (s.n + k) + gauss(r) / Math.sqrt(s.n + 1) * .8;
}
// pick a value of an arm: blend IG (the bigger audience) with FB for content arms; hours are per platform only
export function pick(arm, values, r, { plat = null, explore = .15, B = brain() } = {}) {
  if (!values.length) return null;
  if (r() < explore) return values[Math.floor(r() * values.length)];
  let best = null, bv = -Infinity;
  for (const v of values) { const x = plat ? draw(B, plat, arm, v, r) : .7 * draw(B, "ig", arm, v, r) + .3 * draw(B, "fb", arm, v, r); if (x > bv) { bv = x; best = v; } }
  return best;
}
export const mean = (B, plat, arm, v) => { const s = B[plat]?.[arm]?.[v]; return s ? { n: s.n, avg: s.sum / (s.n + 2) } : { n: 0, avg: 0 }; };
export function cycleModel(wd, B = brain()) {
  const m = CYCLE[wd], s = mean(B, "ig", "model", m);
  if (s.n >= 4 && s.avg < -.35) return ARMS.model.map((x) => [x, mean(B, "ig", "model", x).avg]).sort((a, b) => b[1] - a[1])[0][0];
  return m;
}
export const fallback = (m) => FALLBACK[m];

// hours for one platform: 2 slots ≥ 10h apart, by Thompson draw (with 15% exploration on each)
export function hours(plat, r, B = brain()) {
  const gap = (h, a) => { const d = Math.abs(((h - a + 24) % 24)); return Math.min(d, 24 - d); };
  const pairable = ARMS.hour.filter((h) => ARMS.hour.some((x) => gap(x, h) >= 10)); // only first slots that HAVE a partner ≥10h away
  const a = pick("hour", pairable, r, { plat, B });
  const ok = ARMS.hour.filter((h) => { const d = Math.abs(((h - a + 24) % 24)); return Math.min(d, 24 - d) >= 10; }); /* Kai 11-09: the 2 daily reels ≥ 10h apart so each gets its full run */
  const b = pick("hour", ok, r, { plat, B });
  const ord = (h) => (h < 9 ? h + 24 : h); // 00–02 belong to the end of the posting day
  return [a, b].sort((x, y) => ord(x) - ord(y));
}

// uniqueness memory from the log: what can't be used again
export function memory(today) {
  const log = readLog(), recent = (days) => log.filter((x) => x.date >= addDays(today, -days));
  return {
    stories: new Set(log.map((x) => x.story)),                                    // a story is never posted twice
    titles: new Set(recent(30).map((x) => x.title)),                               // no title repeats inside 30 days
    mkModel: new Set(recent(5).map((x) => `${x.mk}|${x.model}`)),                  // same market+model rests 5 days
    lastLook: log.slice(-2).map((x) => `${x.fam}|${x.angle}|${x.pace}`),             // never the same look twice running
    mkToday: new Set(log.filter((x) => x.date === today).map((x) => x.mk)),
  };
}

// reward for one post on one platform, relative to the account's own history (so a growing account doesn't fool it)
export function reward(m, dur, plat, hist) {
  if (!m) return null;
  const views = plat === "ig" ? m.views : m.plays, reach = Math.max(1, m.reach || views || 1);
  if (views == null) return null;
  const watch = plat === "ig" ? (m.avg_watch_ms || 0) / 1000 : (m.avg_watch_ms || 0) / 1000, wr = Math.min(1.2, watch / Math.max(1, dur));
  const eng = ((m.shares || 0) * 3 + (m.saves || 0) * 2.5 + (m.comments || 0) * 1.5 + (m.likes || 0) * .5 + (m.follows || 0) * 5) / reach;
  const site = m.site != null ? Math.log1p((m.site || 0) + 4 * (m.signups || 0)) : null; // visitors to crtlab.pro (+ signups, weighted)
  const raw = { lv: Math.log1p(views), wr, eng, site };
  const z = (k) => { if (raw[k] == null) return 0; const a = hist.map((h) => h[k]).filter((x) => x != null); if (a.length < 3) return 0; const mu = a.reduce((s, x) => s + x, 0) / a.length, sd = Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / a.length) || 1; return (raw[k] - mu) / sd; };
  // views reach people, watch-through + engagement make the algorithm push it, site visits are the point
  return { raw, r: .35 * z("lv") + .25 * z("wr") + .2 * z("eng") + .2 * z("site") };
}
