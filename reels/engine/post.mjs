// POST — publish one reel to ONE platform, verify it, log it.
//   node reels/engine/post.mjs <plan-date> <k> <ig|fb> [--dry]   (dry = upload + process, never publish: safe API test)
// HARD LOCK: only the crtlab.pro Page (1381191398412761) and @crtlab.pro (17841423032556857). Anything else → refuse.
import fs from "node:fs";
import { DIR, readLog } from "./brain.mjs";
const [D, K, PLAT, DRY] = process.argv.slice(2), V = "v21.0", G = `https://graph.facebook.com/${V}`;
const LOCK = { ig: "17841423032556857", fb: "1381191398412761" };
const TOK = process.env.META_PAGE_TOKEN, IG = process.env.IG_USER_ID || LOCK.ig, PAGE = process.env.FB_PAGE_ID || LOCK.fb;
if (IG !== LOCK.ig || PAGE !== LOCK.fb) { console.error("REFUSING: account ids don't match the crtlab.pro lock"); process.exit(9); }
if (!TOK) { console.error("no META_PAGE_TOKEN"); process.exit(1); }
const plan = JSON.parse(fs.readFileSync(`${DIR}/plan-${D}.json`, "utf8")), R = plan.reels[+K], mp4 = new URL(`../out/reel-${K}.mp4`, import.meta.url);
if (!R) { console.error("no reel", K); process.exit(1); }
if (readLog().some((x) => x.plan === D && x.k === +K && x.plat === PLAT && x.id)) { console.log("already posted", D, K, PLAT); process.exit(0); }
const bytes = fs.readFileSync(mp4);

const j = async (r) => { const t = await r.text(); let x; try { x = JSON.parse(t); } catch { x = { raw: t }; } if (!r.ok || x.error) throw new Error(`${r.status} ${JSON.stringify(x.error || x).slice(0, 300)}`); return x; };
const post = (u, q) => fetch(`${u}?${new URLSearchParams({ ...q, access_token: TOK })}`, { method: "POST" }).then(j);
const get = (u, q) => fetch(`${u}?${new URLSearchParams({ ...q, access_token: TOK })}`).then(j);
const upload = (url) => fetch(url, { method: "POST", headers: { Authorization: `OAuth ${TOK}`, offset: "0", file_size: String(bytes.length) }, body: bytes }).then(j);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const retry = async (f, n = 3) => { for (let i = 1; ; i++) { try { return await f(); } catch (e) { if (i >= n || /\b(100|190|200|10)\b/.test(String(e).slice(0, 40))) throw e; await wait(8000 * i); } } };

async function instagram() {
  const c = await retry(() => post(`${G}/${IG}/media`, { media_type: "REELS", upload_type: "resumable", caption: R.ig.caption, share_to_feed: "true" }));
  await retry(() => upload(`https://rupload.facebook.com/ig-api-upload/${V}/${c.id}`));
  for (let i = 0; ; i++) { const s = await get(`${G}/${c.id}`, { fields: "status_code,status" }); if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || i > 60) throw new Error("ig processing: " + (s.status || "timeout")); await wait(5000); }
  if (DRY) return { dry: true, container: c.id };
  const m = await retry(() => post(`${G}/${IG}/media_publish`, { creation_id: c.id }));
  // verify: it exists, it's a reel, it's on our account
  const info = await get(`${G}/${m.id}`, { fields: "permalink,media_product_type,owner,username" });
  if (info.username && info.username !== "crtlab.pro") throw new Error("posted to unexpected account " + info.username);
  return { id: m.id, permalink: info.permalink, type: info.media_product_type };
}
async function facebook() {
  const s = await retry(() => post(`${G}/${PAGE}/video_reels`, { upload_phase: "start" }));
  await retry(() => upload(`https://rupload.facebook.com/video-upload/${V}/${s.video_id}`));
  if (DRY) return { dry: true, video: s.video_id };
  await retry(() => post(`${G}/${PAGE}/video_reels`, { upload_phase: "finish", video_id: s.video_id, video_state: "PUBLISHED", description: R.fb.caption }));
  let st = null; for (let i = 0; i < 24; i++) { st = await get(`${G}/${s.video_id}`, { fields: "status,permalink_url,from" }).catch(() => null);
    if (st?.status?.video_status === "ready" || st?.status?.publishing_phase?.status === "complete") break; if (st?.status?.video_status === "error") throw new Error("fb processing error"); await wait(5000); }
  if (st?.from?.id && st.from.id !== PAGE) throw new Error("posted to unexpected page " + st.from.id);
  return { id: s.video_id, permalink: st?.permalink_url ? `https://www.facebook.com${st.permalink_url}` : null, status: st?.status?.video_status };
}

const t0 = Date.now(), entry = { plan: D, k: +K, plat: PLAT, story: R.story, date: D, mk: R.mk, model: R.model, title: R.title, fam: R.fam, angle: R.angle, pace: R.pace,
  tagset: R.tagset, music: R.music, hour: R[PLAT].hour, cycle: R.cycle, dur: JSON.parse(fs.readFileSync(new URL("../out/qa.json", import.meta.url), "utf8"))[K]?.info?.dur };
try {
  Object.assign(entry, await (PLAT === "ig" ? instagram() : facebook()));
  entry.postedAt = new Date().toISOString(); entry.secs = Math.round((Date.now() - t0) / 1000);
  console.log("OK", PLAT, JSON.stringify(entry));
  if (!DRY) fs.appendFileSync(`${DIR}/log.jsonl`, JSON.stringify(entry) + "\n");
} catch (e) {
  console.error("POST FAILED", PLAT, String(e));
  fs.appendFileSync(`${DIR}/alerts.jsonl`, JSON.stringify({ at: new Date().toISOString(), kind: "post", plat: PLAT, plan: D, k: +K, err: String(e).slice(0, 400) }) + "\n");
  process.exit(1);
}
