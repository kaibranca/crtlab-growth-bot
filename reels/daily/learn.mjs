// the learning loop: pull each posted reel's Instagram numbers (2 to 30 days old), then weight the engine toward what held people.
//   data/reels/metrics.json — per reel: views, reach, avg watch time, saves, shares, likes, comments (+ Facebook plays)
//   data/reels/weights.json — story / market / hook-variant / slot multipliers the engine reads (0.7–1.4, only once a group has 3+ reels)
import fs from "node:fs";
const V = "v21.0", G = `https://graph.facebook.com/${V}`, TOK = process.env.META_TOKEN, D = new URL("../../data/reels/", import.meta.url);
const log = fs.existsSync(new URL("log.jsonl", D)) ? fs.readFileSync(new URL("log.jsonl", D), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const M = fs.existsSync(new URL("metrics.json", D)) ? JSON.parse(fs.readFileSync(new URL("metrics.json", D), "utf8")) : {};
if (!TOK) { console.log("no META_TOKEN — skip"); process.exit(0); }
const age = (x) => (Date.now() - Date.parse(x.postedAt)) / 864e5;
for (const x of log) {
  if (!x.ig?.id || age(x) > 30 || (M[x.ig.id]?.final)) continue;
  const q = new URLSearchParams({ metric: "views,reach,saved,shares,likes,comments,total_interactions,ig_reels_avg_watch_time", access_token: TOK });
  const r = await fetch(`${G}/${x.ig.id}/insights?${q}`).then((r) => r.json()).catch(() => null);
  if (!r?.data) { console.log("insights fail", x.ig.id, JSON.stringify(r?.error || r).slice(0, 200)); continue; }
  const m = Object.fromEntries(r.data.map((d) => [d.name, d.values?.[0]?.value ?? 0]));
  if (x.fb?.id) { const f = await fetch(`${G}/${x.fb.id}/video_insights?metric=blue_reels_play_count&access_token=${TOK}`).then((r) => r.json()).catch(() => null); m.fb_plays = f?.data?.[0]?.values?.[0]?.value ?? null; }
  M[x.ig.id] = { ...m, at: new Date().toISOString(), final: age(x) > 7 };
}
fs.writeFileSync(new URL("metrics.json", D), JSON.stringify(M, null, 1));
// score = views × watch time (seconds) + 30 per save + 50 per share — what the algorithm itself rewards
const scored = log.filter((x) => x.ig?.id && M[x.ig.id] && age(x) >= 2).map((x) => { const m = M[x.ig.id]; return { ...x, s: (m.views || 0) * ((m.ig_reels_avg_watch_time || 0) / 1000 + 1) + 30 * (m.saved || 0) + 50 * (m.shares || 0) }; });
const mean = (a) => a.reduce((p, x) => p + x.s, 0) / (a.length || 1), all = mean(scored), W = { n: scored.length, at: new Date().toISOString() };
for (const key of ["story", "mk", "hv", "slot"]) { const g = {}; for (const x of scored) (g[x[key]] ??= []).push(x);
  W[key === "mk" ? "market" : key] = Object.fromEntries(Object.entries(g).filter(([, a]) => a.length >= 3 && all > 0).map(([k, a]) => [k, +Math.min(1.4, Math.max(.7, Math.sqrt(mean(a) / all))).toFixed(2)])); }
fs.writeFileSync(new URL("weights.json", D), JSON.stringify(W, null, 1));
console.log("learned from", scored.length, "reels", JSON.stringify(W));
