// LEARN — node reels/engine/learn.mjs   (daily; cheap: a few dozen Graph API GETs)
//  1. pull insights for every post 1–30 days old, per platform (IG media insights / FB video insights)
//  2. rebuild data/reels/brain.json from scratch: each post's reward (vs the account's own history) credited to every arm it used
//  3. watch for problems → alerts.jsonl (+ email): reach collapse (possible suppression), token near expiry, missed / failed posts
import fs from "node:fs";
import { DIR, readLog, reward, save, ARMS } from "./brain.mjs";
const V = "v21.0", G = `https://graph.facebook.com/${V}`, TOK = process.env.META_PAGE_TOKEN;
const M = fs.existsSync(`${DIR}/metrics.json`) ? JSON.parse(fs.readFileSync(`${DIR}/metrics.json`, "utf8")) : {};
const log = readLog().filter((x) => x.id && !x.dry), age = (x) => (Date.now() - Date.parse(x.postedAt)) / 864e5, alerts = [];
const get = (u) => fetch(u).then((r) => r.json()).catch((e) => ({ error: String(e) }));

if (TOK) {
  for (const x of log) {
    if (age(x) < .9 || age(x) > 30 || M[x.id]?.final) continue;
    let m = null;
    if (x.plat === "ig") {
      const r = await get(`${G}/${x.id}/insights?metric=views,reach,saved,shares,likes,comments,total_interactions,ig_reels_avg_watch_time&access_token=${TOK}`);
      if (r.data) { const v = Object.fromEntries(r.data.map((d) => [d.name, d.values?.[0]?.value ?? 0]));
        m = { views: v.views, reach: v.reach, saves: v.saved, shares: v.shares, likes: v.likes, comments: v.comments, avg_watch_ms: v.ig_reels_avg_watch_time }; }
      else alerts.push(["insights-ig", `IG insights failed for ${x.id}: ${JSON.stringify(r.error).slice(0, 160)}`]);
    } else {
      const r = await get(`${G}/${x.id}/video_insights?access_token=${TOK}`), v = {};
      for (const d of r.data || []) v[d.name] = d.values?.[0]?.value;
      const s = await get(`${G}/${x.id}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)&access_token=${TOK}`), soc = v.post_video_social_actions || {};
      if (r.data) m = { plays: v.blue_reels_play_count ?? v.fb_reels_total_plays ?? v.post_video_views ?? null, reach: v.post_impressions_unique ?? v.post_video_reach ?? null,
        avg_watch_ms: v.post_video_avg_time_watched ?? null, shares: soc.SHARE ?? soc.share ?? 0, comments: s.comments?.summary?.total_count ?? 0, likes: s.likes?.summary?.total_count ?? 0,
        follows: v.post_video_followers ?? 0, names: Object.keys(v) };
      else alerts.push(["insights-fb", `FB insights failed for ${x.id}: ${JSON.stringify(r.error).slice(0, 160)}`]);
    }
    if (m) M[x.id] = { ...m, at: new Date().toISOString(), age: +age(x).toFixed(1), final: age(x) > 8 };
  }
  save("metrics.json", M);
  // token: the Page token never expires, but Meta's data access does (~90 days) → warn 21 days ahead
  const app = process.env.META_APP_ID, sec = process.env.META_APP_SECRET;
  if (app && sec) { const d = (await get(`${G}/debug_token?input_token=${TOK}&access_token=${app}|${sec}`)).data;
    if (!d?.is_valid) alerts.push(["token", "Meta token is INVALID — posting has stopped. Regenerate in Graph API Explorer (2 min)."]);
    else if (d.data_access_expires_at && d.data_access_expires_at * 1000 - Date.now() < 21 * 864e5) alerts.push(["token-soon", `Meta data access expires ${new Date(d.data_access_expires_at * 1000).toDateString()} — re-login in Graph API Explorer to renew.`]); }
}

// rebuild the brain: rewards only from posts ≥ 2 days old (numbers have settled)
const B = { ig: {}, fb: {}, at: new Date().toISOString(), n: { ig: 0, fb: 0 }, hist: {} };
for (const plat of ["ig", "fb"]) {
  const ps = log.filter((x) => x.plat === plat && M[x.id] && age(x) >= 2).sort((a, b) => a.postedAt.localeCompare(b.postedAt)), hist = [];
  for (const x of ps) {
    const rw = reward(M[x.id], x.dur || 10, plat, hist.slice(-30)); if (!rw) continue;
    hist.push(rw.raw); if (hist.length < 4) continue; // need a baseline before scoring
    B.n[plat]++; x.r = rw.r;
    for (const arm of [...Object.keys(ARMS), "music"]) { const v = x[arm]; if (v == null) continue; const s = ((B[plat][arm] ??= {})[v] ??= { n: 0, sum: 0 }); s.n++; s.sum += rw.r; }
  }
  // reach collapse: the last 3 settled posts all under 25% of the median of the 10 before → possible suppression / spam flag
  const v = ps.map((x) => (plat === "ig" ? M[x.id].views : M[x.id].plays) ?? 0);
  if (v.length >= 13) { const prev = v.slice(-13, -3).sort((a, b) => a - b), med = prev[5]; if (v.slice(-3).every((y) => y < med * .25)) alerts.push([`reach-${plat}`, `${plat.toUpperCase()} reach collapsed: last 3 reels ${v.slice(-3).join(", ")} views vs median ${med}. Possible suppression — engine will slow to 1/day.`]); }
  B.hist[plat] = { posts: ps.length, medianViews: v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null };
}
save("brain.json", B);

// failed / missed posts in the last day
const recentAlerts = fs.existsSync(`${DIR}/alerts.jsonl`) ? fs.readFileSync(`${DIR}/alerts.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => Date.now() - Date.parse(a.at) < 864e5) : [];
for (const a of recentAlerts) alerts.push([`${a.kind}-${a.plat || ""}-${a.plan || ""}-${a.k ?? ""}`, `${a.kind} ${a.plat || ""} ${a.plan || ""} reel ${a.k ?? ""}: ${a.err || a.note || ""}`]);
fs.writeFileSync(`${DIR}/status.json`, JSON.stringify({ at: B.at, n: B.n, hist: B.hist, alerts }, null, 1));
console.log("learned", JSON.stringify(B.n), "alerts", alerts.length);
await (await import("./alert.mjs")).send(alerts);
