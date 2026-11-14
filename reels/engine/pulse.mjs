// PULSE — node reels/engine/pulse.mjs   (HOURLY, inside reels-post; ~2 Graph GETs per reel under 4 days old, nothing else)
// The daily learn.mjs only looks once a day and only scores reels ≥ 2 days old, so on 11-13 a reel ran to 5,930 FB plays (10× the
// page's normal) and no machine noticed. PULSE watches every fresh reel hourly and does three things:
//   1. velocity: plays/views per hour since posting, per platform, into metrics.json (field "pulse")
//   2. BREAKOUT: a reel at ≥ 4× its platform's median AND ≥ 1,000 views → email Kai once, ledger win, and it becomes the CHAMPION
//   3. CHAMPION (data/reels/champion.json): the winning formula (model, title, title family, angle, pace, length). Both platforms
//      plan from it: slot 1 every day repeats the champion on a fresh chart (exploit), slot 2 tests (explore). A breakout on EITHER
//      platform crowns it for BOTH — that is how the FB machine and the IG machine talk to each other.
import fs from "node:fs";
import { DIR, readLog, save } from "./brain.mjs";
const G = "https://graph.facebook.com/v21.0", TOK = process.env.META_PAGE_TOKEN;
const J = (f, d) => (fs.existsSync(`${DIR}/${f}`) ? JSON.parse(fs.readFileSync(`${DIR}/${f}`, "utf8")) : d);
const M = J("metrics.json", {}), get = (u) => fetch(u).then((r) => r.json()).catch((e) => ({ error: String(e) }));
const log = readLog().filter((x) => x.id && !x.dry && x.postedAt), hrs = (x) => (Date.now() - Date.parse(x.postedAt)) / 3.6e6;
const views = (x) => { const m = M[x.id]; return m ? (x.plat === "ig" ? m.views : m.plays) ?? m.pulse?.v ?? null : null; };

export async function pull(x) {
  if (x.plat === "ig") { const r = await get(`${G}/${x.id}/insights?metric=views,reach,saved,shares,likes,ig_reels_avg_watch_time&access_token=${TOK}`);
    if (!r.data) return null; const v = Object.fromEntries(r.data.map((d) => [d.name, d.values?.[0]?.value ?? 0]));
    return { v: v.views, reach: v.reach, saves: v.saved, shares: v.shares, likes: v.likes, watch: v.ig_reels_avg_watch_time }; }
  const r = await get(`${G}/${x.id}/video_insights?metric=fb_reels_total_plays,post_video_avg_time_watched,post_video_followers,fb_reels_replay_count,post_video_social_actions&access_token=${TOK}`);
  if (!r.data) return null; const v = Object.fromEntries(r.data.map((d) => [d.name, d.values?.[0]?.value]));
  return { v: v.fb_reels_total_plays, watch: v.post_video_avg_time_watched, follows: v.post_video_followers, replays: v.fb_reels_replay_count, shares: (v.post_video_social_actions || {}).SHARE || 0 };
}

// the champion formula = what the plan copies into slot 1. PRIOR (until a newer breakout): the 11-13 FB winner, which matched the
// 10-18 IG all-time best (also "OB ENTRY") and Kai's manual-era titles (OB ENTRY / SMC ENTRY / FVG ENTRY / XAU/USD).
export const PRIOR = { model: "ob", title: "OB ENTRY", fam: "name", angle: "mistake", pace: "short", from: "fb 1461633655300997 (5,930 plays, 11-13) + ig 10-18 OB ENTRY (3,003)", x: 10 };
export const champion = () => J("champion.json", { ...PRIOR, at: "2026-11-14T00:00:00Z" });

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!TOK) { console.log("pulse: no token"); process.exit(0); }
  const fresh = log.filter((x) => hrs(x) > .5 && hrs(x) < 96), alerts = [];
  for (const x of fresh) { const p = await pull(x); if (!p || p.v == null) continue; const h = hrs(x);
    M[x.id] = { ...(M[x.id] || {}), pulse: { ...p, h: +h.toFixed(1), perH: +(p.v / h).toFixed(1), at: new Date().toISOString() } };
    if (x.plat === "ig") M[x.id].views = Math.max(M[x.id].views ?? 0, p.v); else M[x.id].plays = Math.max(M[x.id].plays ?? 0, p.v); }
  save("metrics.json", M);
  // breakout: vs the median of the same platform's other reels (all ages)
  const ch = champion(), LG = "data/machines/ledger.jsonl";
  for (const plat of ["ig", "fb"]) {
    const ps = log.filter((x) => x.plat === plat && views(x) != null), vs = ps.map(views).sort((a, b) => a - b), med = vs[Math.floor(vs.length / 2)] || 1;
    for (const x of ps.filter((y) => hrs(y) < 96)) { const v = views(x), k = v / med;
      if (v < 1000 || k < 4) continue;
      const key = `breakout-${x.id}`; alerts.push([key, `BREAKOUT on ${plat.toUpperCase()}: "${x.title}" (${x.mk} ${x.model}) has ${v.toLocaleString("en-US")} ${plat === "ig" ? "views" : "plays"}, ${k.toFixed(1)}× the normal ${med}. ${x.permalink || ""}\nIt is now the champion: every day's first reel repeats this formula (${x.model} · "${x.title}" · ${x.angle} · ${x.pace}) on a fresh chart, on both IG and FB.`]);
      if (!ch.id || ch.id === x.id || k > (ch.x || 0) || Date.parse(ch.at) < Date.now() - 21 * 864e5) {
        save("champion.json", { model: x.model, title: x.title, fam: x.fam, angle: x.angle, pace: x.pace, track: x.track, id: x.id, plat, views: v, x: +k.toFixed(1), from: `${plat} ${x.id}`, at: ch.id === x.id ? ch.at : new Date().toISOString() }); } // lock-in clock starts at the FIRST detection
      const have = fs.existsSync(LG) && fs.readFileSync(LG, "utf8").includes(`"reel-breakout|${x.id}"`);
      if (!have) fs.appendFileSync(LG, JSON.stringify({ at: new Date().toISOString(), key: `reel-breakout|${x.id}`, machine: "social", kind: "win", what: `${plat} reel "${x.title}" broke out: ${v} views, ${k.toFixed(1)}× normal → champion formula` }) + "\n");
    }
  }
  console.log("pulse:", fresh.length, "fresh reels;", alerts.length, "breakouts; champion:", JSON.stringify(champion()));
  const sent = J("alerted.json", {}); for (let i = alerts.length - 1; i >= 0; i--) if (sent[alerts[i][0]]) alerts.splice(i, 1); // a breakout emails ONCE
  if (alerts.length) await (await import("./alert.mjs")).send(alerts, "CRTLAB reels");
}
