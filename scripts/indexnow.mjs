// Tell Bing / Yandex / Seznam / Naver (IndexNow) about pages whose sitemap lastmod CHANGED since we last told them.
// ONLY changed URLs — resubmitting unchanged pages is what gets submissions ignored.
// 11-07: was "lastmod in the last 2 days", run once a day at 06:40 — before the 08:00 recap, so a new day's pages reached
// Bing a day late, and the same 27 URLs went twice a day. Now: remembered per URL (data/indexnow-state.json) and run every
// hour, so a page goes once, within the hour its date really moves. Safe to run from any workflow.
import fs from "node:fs";
import { SITE, get, append, now } from "./lib.mjs";
const KEY = "934e3b8740889949b737be3708df42e5";
const STATE = "data/indexnow-state.json";
const sm = await get(`${SITE}/sitemap.xml`);
const urls = [...sm.body.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1], mod: m[2] ?? "" }));
if (urls.length < 100) { console.log("sitemap looks broken:", urls.length, "urls — skipped"); process.exit(0); }
const first = !fs.existsSync(STATE);
const seen = first ? {} : JSON.parse(fs.readFileSync(STATE, "utf8"));
// first run: everything was submitted on 11-06, so only the last 2 days count as new
const cutoff = Date.now() - 2 * 86400000;
// 11-11: a few pages' lastmod moves EVERY HOUR (live "now" dates) → the same URLs went 24×/day, the pattern that gets a
// site's submissions ignored (the important ones with them). Each URL goes at most once per 20 h; the date is still tracked.
const SENT = "data/indexnow-sent.json", sent = (() => { try { return JSON.parse(fs.readFileSync(SENT, "utf8")); } catch { return {}; } })();
const changed = urls.filter((u) => u.mod && (first ? Date.parse(u.mod) >= cutoff : seen[u.loc] !== u.mod));
const fresh = changed.filter((u) => !sent[u.loc] || Date.now() - sent[u.loc] > 20 * 3600e3).map((u) => u.loc);
let status = "nothing new";
if (fresh.length) {
  const r = await fetch("https://api.indexnow.org/IndexNow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ host: "crtlab.pro", key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: fresh.slice(0, 10000) }) });
  status = `HTTP ${r.status}`;
  if (!r.ok) { console.log(status, "— state not saved, retried next run"); append("data/indexnow.jsonl", { at: now().toISOString(), sitemap: urls.length, submitted: 0, status }); process.exit(0); }
}
// a URL held back by the 20 h rule keeps its OLD date, so it still counts as changed and goes once the 20 h are up
fs.writeFileSync(STATE, JSON.stringify(Object.fromEntries(urls.map((u) => [u.loc, fresh.includes(u.loc) || !changed.some((c) => c.loc === u.loc) ? u.mod : seen[u.loc] ?? ""]))));
for (const u of fresh) sent[u] = Date.now(); for (const [k, t] of Object.entries(sent)) if (Date.now() - t > 30 * 86400e3) delete sent[k];
fs.writeFileSync(SENT, JSON.stringify(sent));
if (fresh.length) append("data/indexnow.jsonl", { at: now().toISOString(), sitemap: urls.length, submitted: fresh.length, status, urls: fresh.slice(0, 50) });
console.log(status, fresh.length, "of", urls.length);
