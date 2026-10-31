// DAILY: tell Bing / Yandex / Seznam / Naver (IndexNow) about pages whose sitemap lastmod changed in the last 2 days.
// ONLY changed URLs — resubmitting unchanged pages is what gets submissions ignored.
import { SITE, get, append, now } from "./lib.mjs";
const KEY = "934e3b8740889949b737be3708df42e5";
const sm = await get(`${SITE}/sitemap.xml`);
const urls = [...sm.body.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1], mod: m[2] ? new Date(m[2]) : null }));
const cutoff = Date.now() - 2 * 86400000;
const fresh = urls.filter((u) => u.mod && u.mod.getTime() >= cutoff).map((u) => u.loc);
let status = "nothing new";
if (fresh.length) {
  const r = await fetch("https://api.indexnow.org/IndexNow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ host: "crtlab.pro", key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: fresh.slice(0, 10000) }) });
  status = `HTTP ${r.status}`;
}
append("data/indexnow.jsonl", { at: now().toISOString(), sitemap: urls.length, submitted: fresh.length, status, urls: fresh.slice(0, 50) });
console.log(status, fresh.length, "of", urls.length);
