// post one finished reel to Instagram (Reels) + the Facebook Page, then log it. node reels/daily/post.mjs <reel.mp4> <pick.json> <slot>
// secrets: META_TOKEN (the Page's never-expiring token), IG_USER_ID, FB_PAGE_ID. Missing → dry run (the reel still lands as an Actions artifact)
import fs from "node:fs";
const [MP4, PICK, SLOT] = process.argv.slice(2), V = "v21.0", G = `https://graph.facebook.com/${V}`;
const { META_TOKEN: TOK, IG_USER_ID: IG, FB_PAGE_ID: PAGE } = process.env, pick = JSON.parse(fs.readFileSync(PICK, "utf8")), bytes = fs.readFileSync(MP4);
const LOG = new URL("../../data/reels/log.jsonl", import.meta.url);
const j = async (r) => { const t = await r.text(); let x; try { x = JSON.parse(t); } catch { x = { raw: t }; } if (!r.ok || x.error) throw new Error(`${r.status} ${JSON.stringify(x.error || x).slice(0, 300)}`); return x; };
const post = (u, q) => fetch(`${u}?${new URLSearchParams({ ...q, access_token: TOK })}`, { method: "POST" }).then(j);
const get = (u, q) => fetch(`${u}?${new URLSearchParams({ ...q, access_token: TOK })}`).then(j);
const upload = (url) => fetch(url, { method: "POST", headers: { Authorization: `OAuth ${TOK}`, offset: "0", file_size: String(bytes.length) }, body: bytes }).then(j);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function instagram() {
  const c = await post(`${G}/${IG}/media`, { media_type: "REELS", upload_type: "resumable", caption: pick.caption, share_to_feed: "true" });
  await upload(`https://rupload.facebook.com/ig-api-upload/${V}/${c.id}`);
  for (let i = 0; i < 60; i++) { const s = await get(`${G}/${c.id}`, { fields: "status_code,status" }); if (s.status_code === "FINISHED") break; if (s.status_code === "ERROR") throw new Error("ig processing: " + s.status); await wait(5000); }
  const m = await post(`${G}/${IG}/media_publish`, { creation_id: c.id });
  const info = await get(`${G}/${m.id}`, { fields: "permalink" }).catch(() => ({}));
  return { id: m.id, permalink: info.permalink };
}
async function facebook() {
  const s = await post(`${G}/${PAGE}/video_reels`, { upload_phase: "start" });
  await upload(`https://rupload.facebook.com/video-upload/${V}/${s.video_id}`);
  await post(`${G}/${PAGE}/video_reels`, { upload_phase: "finish", video_id: s.video_id, video_state: "PUBLISHED", description: pick.caption });
  return { id: s.video_id };
}

const entry = { ...pick, slot: +SLOT, postedAt: new Date().toISOString() };
delete entry.caption;
if (!TOK || !IG) { console.log("DRY RUN (no META_TOKEN / IG_USER_ID) —", pick.mk, pick.story, pick.hook); process.exit(0); }
const res = await Promise.allSettled([instagram(), PAGE ? facebook() : Promise.resolve(null)]);
entry.ig = res[0].status === "fulfilled" ? res[0].value : { error: String(res[0].reason).slice(0, 300) };
entry.fb = res[1].status === "fulfilled" ? res[1].value : { error: String(res[1].reason).slice(0, 300) };
fs.mkdirSync(new URL(".", LOG), { recursive: true }); fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");
console.log("posted", JSON.stringify({ ig: entry.ig, fb: entry.fb }));
if (entry.ig.error && entry.fb?.error !== undefined && entry.fb?.error) process.exit(1);
