// WEEKLY: Google Search Console → better titles, found gaps, measured outcomes. No AI, no dependencies.
//  1. pull 28 days of page × query data (service account in GSC_SA_JSON)
//  2. pages Google SHOWS but people don't CLICK (CTR well under what their position should get) → rewrite the title and
//     description from the exact words people search, into site/lib/seo-overrides.json (max 8 pages a week)
//  3. every change is measured 28 days later: CTR up → kept; CTR down >20% → reverted automatically
//  4. searches CRTLAB shows up for with no page that answers them → data/gaps.json (what to build next)
import { worksMul, worksTier } from "./works-lib.mjs"; // 11-13 WORKS north star
import fs from "node:fs";
import crypto from "node:crypto";
import { append, readLines, now, BRAND, NEVER, expected, liveMeta, rewrite } from "./lib.mjs";

const SA = JSON.parse(process.env.GSC_SA_JSON || "{}");
if (!SA.client_email) { console.log("GSC_SA_JSON not set — skipping (see README: connect Search Console)"); process.exit(0); }
const OV_FILE = "site/lib/seo-overrides.json";
const b64 = (x) => Buffer.from(x).toString("base64url");
async function token() {
  const t = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = b64(JSON.stringify({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: t, exp: t + 3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(SA.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${body}.${sig}` });
  const j = await r.json(); if (!j.access_token) throw new Error("token: " + JSON.stringify(j)); return j.access_token;
}
const tk = await token();
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
async function query(prop, body) {
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/searchAnalytics/query`, { method: "POST", headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.ok ? (await r.json()).rows ?? [] : null;
}
let PROP = "sc-domain:crtlab.pro", rows = await query(PROP, { startDate: day(30), endDate: day(3), dimensions: ["page", "query"], rowLimit: 25000 });
if (!rows) { PROP = "https://crtlab.pro/"; rows = await query(PROP, { startDate: day(30), endDate: day(3), dimensions: ["page", "query"], rowLimit: 25000 }); }
if (!rows) throw new Error("Search Console refused — is the service account added as a user on the property?");

// brand searches are left out of every page's numbers; hand-set pages are never touched (BRAND / NEVER in lib.mjs)
// per page (non-brand searches only)
const pages = new Map();
for (const r of rows) {
  if (BRAND.test(r.keys[1])) continue;
  const path = new URL(r.keys[0]).pathname.replace(/\/$/, "") || "/";
  const p = pages.get(path) ?? { path, impr: 0, clicks: 0, posW: 0, queries: [] };
  p.impr += r.impressions; p.clicks += r.clicks; p.posW += r.position * r.impressions; p.queries.push({ q: r.keys[1], impr: r.impressions, clicks: r.clicks, pos: r.position });
  pages.set(path, p);
}
for (const p of pages.values()) { p.ctr = p.impr ? p.clicks / p.impr : 0; p.pos = p.impr ? p.posW / p.impr : 99; p.queries.sort((a, b) => b.impr - a.impr); }

const ov = fs.existsSync(OV_FILE) ? JSON.parse(fs.readFileSync(OV_FILE, "utf8")) : {};
const log = readLines("data/seo-changes.jsonl");
const at = now().toISOString(), stamp = Date.now();
// 3. MEASURE changes made 28+ days ago, once
const done = new Set(log.filter((x) => x.kind === "outcome").map((x) => x.path + x.changedAt));
for (const c of log.filter((x) => x.kind === "change" && x.source !== "bing" && stamp - new Date(x.at).getTime() > 28 * 86400000 && !done.has(x.path + x.at))) {
  const p = pages.get(c.path); if (!p || p.impr < 50) continue;
  const better = p.ctr >= c.before.ctr, worse = p.ctr < c.before.ctr * 0.8;
  if (worse) delete ov[c.path];
  append("data/seo-changes.jsonl", { kind: "outcome", at, path: c.path, changedAt: c.at, ctrBefore: c.before.ctr, ctrAfter: +p.ctr.toFixed(4), verdict: worse ? "reverted" : better ? "kept (better)" : "kept (no worse)" });
}
// 2. FIX titles
const recent = new Set(log.filter((x) => x.kind === "change" && stamp - new Date(x.at).getTime() < 28 * 86400000).map((x) => x.path));
const cands = [...pages.values()].filter((p) => !NEVER.test(p.path) && worksTier(p.path) !== "DEAD" && p.impr >= 100 && p.pos <= 15 && p.ctr < expected(p.pos) * 0.6 && !recent.has(p.path) && !p.path.startsWith("/api"))
  .sort((a, b) => worksMul(b.path) * b.impr * (expected(b.pos) - b.ctr) - worksMul(a.path) * a.impr * (expected(a.pos) - a.ctr)).slice(0, 8); // 11-13 WORKS: pages that bring accounts first
const changes = [];
for (const p of cands) {
  const cur = await liveMeta(p.path);
  const q = p.queries.find((x) => !BRAND.test(x.q) && x.impr >= 20 && x.q.length >= 6 && x.q.split(" ").length <= 6)?.q; if (!q || !cur.title) continue;
  const next = rewrite(q, cur, ov[p.path]); if (!next) continue;
  ov[p.path] = next;
  const c = { kind: "change", at, path: p.path, query: q, source: "google", before: { title: cur.title, impr: p.impr, clicks: p.clicks, ctr: +p.ctr.toFixed(4), pos: +p.pos.toFixed(1) }, after: next };
  append("data/seo-changes.jsonl", c); changes.push(c);
}
fs.writeFileSync(OV_FILE, JSON.stringify(ov, null, 1) + "\n");
// 4. GAPS — searched, shown low, and no page title covers it
const titles = [...pages.keys()].join(" ").toLowerCase().replace(/[-/]/g, " ");
const byQ = new Map(); for (const r of rows) { if (BRAND.test(r.keys[1])) continue; const x = byQ.get(r.keys[1]) ?? { q: r.keys[1], impr: 0, pos: 99 }; x.impr += r.impressions; x.pos = Math.min(x.pos, r.position); byQ.set(r.keys[1], x); }
const gaps = [...byQ.values()].filter((x) => x.impr >= 20 && x.pos > 15 && !x.q.split(" ").filter((w) => w.length > 3).every((w) => titles.includes(w))).sort((a, b) => b.impr - a.impr).slice(0, 40);
fs.writeFileSync("data/gaps.json", JSON.stringify({ at, gaps }, null, 1));
// totals for the board's trend
const tot = [...pages.values()].reduce((a, p) => ({ impr: a.impr + p.impr, clicks: a.clicks + p.clicks }), { impr: 0, clicks: 0 });
append("data/gsc-weekly.jsonl", { at, prop: PROP, pages: pages.size, impr: tot.impr, clicks: tot.clicks, changes: changes.length, gaps: gaps.length });
console.log(`GSC ${PROP}: ${pages.size} pages, ${tot.impr} impressions, ${tot.clicks} clicks · ${changes.length} titles rewritten · ${gaps.length} gaps`);
