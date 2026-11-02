// WEEKLY: Bing Webmaster → the Bing / ChatGPT pipeline, measured and tuned. No AI, no dependencies.
//
// WHY BING (Kai 11-02). 7 of CRTLAB's 15 buyers came through Bing's index: 3 from Bing search, 4 from ChatGPT, whose
// search runs on Bing. Bing turns signups into buyers at about twice Google's rate, and it also feeds Copilot,
// DuckDuckGo and Yahoo. Until now there was no Bing data at all.
//
//  1. traffic, searches and pages from Bing (28 days, brand searches left out) → data/bing.json + bing-weekly.jsonl
//  2. pages Bing SHOWS but people don't CLICK → the same title rewrite as the Google job (lib.mjs `rewrite`), on
//     pages neither job has touched (an existing override is Google's; the two loops never fight). Max 5 a week.
//  3. every Bing change is measured 28 days later on Bing's own numbers: CTR down >20% → reverted
//  4. BUYER INTENT: searches about the markets and the work buyers do (forex, gold, indices, backtesting, prop) are
//     pulled out separately — that is the traffic to grow
//  5. DEMAND: Bing's keyword tool gives a free, SAMPLED count of searches (small numbers — a relative index, not a
//     monthly volume) → ranks each /answers question and each gap against the others, so the next pages are chosen by
//     demand, not guesswork (data/bing-keywords.json)
import fs from "node:fs";
import { SITE, append, readLines, now, BRAND, NEVER, expected, liveMeta, rewrite } from "./lib.mjs";

const KEY = process.env.BING_API_KEY;
if (!KEY) { console.log("BING_API_KEY not set — skipping"); process.exit(0); }
const API = "https://ssl.bing.com/webmaster/api.svc/json";
const SITE_URL = encodeURIComponent(SITE + "/");
async function call(method, params = "") {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${API}/${method}?siteUrl=${SITE_URL}${params}&apikey=${KEY}`).catch(() => null);
    if (r?.ok) return (await r.json()).d ?? [];
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`Bing ${method} kept failing`);
}
// Bing dates come as "/Date(1730000000000-0700)/"
const when = (d) => Number(String(d).match(/\d{10,}/)?.[0] ?? 0);
const DAY = 86400000, since = Date.now() - 28 * DAY;
const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/$/, "") || "/"; } catch { return null; } };

// 1. TRAFFIC / SEARCHES / PAGES
const traffic = (await call("GetRankAndTrafficStats")).map((x) => ({ t: when(x.Date), impr: x.Impressions, clicks: x.Clicks })).sort((a, b) => a.t - b.t);
const sum = (rows) => {
  const m = new Map();
  for (const x of rows) {
    if (when(x.Date) < since) continue;
    const k = x.Query; const o = m.get(k) ?? { k, impr: 0, clicks: 0, posW: 0 };
    o.impr += x.Impressions; o.clicks += x.Clicks; o.posW += (x.AvgImpressionPosition > 0 ? x.AvgImpressionPosition : 99) * x.Impressions;
    m.set(k, o);
  }
  return [...m.values()].map((o) => ({ ...o, pos: o.impr ? +(o.posW / o.impr).toFixed(1) : 99, ctr: o.impr ? o.clicks / o.impr : 0 })).sort((a, b) => b.impr - a.impr);
};
const queries = sum(await call("GetQueryStats")).filter((q) => !BRAND.test(q.k));
const pages = sum(await call("GetPageStats")).map((p) => ({ ...p, path: pathOf(p.k) })).filter((p) => p.path && !p.path.startsWith("/api"));

// 4. BUYER INTENT — the markets and the work CRTLAB's buyers do (desktop forex / gold / index traders, 5-minute replay)
const INTENT = /\b(backtest\w*|replay|forex|fx|gold|xau\w*|eur\s?usd|gbp\s?usd|aud\s?usd|usd\s?jpy|nas\s?100|nasdaq|us\s?30|dow|s&?p\s?500|spx|prop|ftmo|funded|challenge|ict|smc|crt|fvg|order block|scalp\w*|5\s?min\w*)\b/i;
const buyerQ = queries.filter((q) => INTENT.test(q.k)).slice(0, 40);

// 3. MEASURE Bing changes made 28+ days ago, once
const OV_FILE = "site/lib/seo-overrides.json";
const ov = fs.existsSync(OV_FILE) ? JSON.parse(fs.readFileSync(OV_FILE, "utf8")) : {};
const log = readLines("data/seo-changes.jsonl");
const at = now().toISOString(), stamp = Date.now();
const byPath = new Map(pages.map((p) => [p.path, p]));
const done = new Set(log.filter((x) => x.kind === "outcome").map((x) => x.path + x.changedAt));
for (const c of log.filter((x) => x.kind === "change" && x.source === "bing" && stamp - new Date(x.at).getTime() > 28 * DAY && !done.has(x.path + x.at))) {
  const p = byPath.get(c.path); if (!p || p.impr < 30) continue;
  const worse = p.ctr < c.before.ctr * 0.8;
  if (worse) delete ov[c.path];
  append("data/seo-changes.jsonl", { kind: "outcome", source: "bing", at, path: c.path, changedAt: c.at, ctrBefore: c.before.ctr, ctrAfter: +p.ctr.toFixed(4), verdict: worse ? "reverted" : p.ctr >= c.before.ctr ? "kept (better)" : "kept (no worse)" });
}

// 2. FIX titles Bing shows but nobody clicks — only on pages with no override yet, and none changed in 28 days
const recent = new Set(log.filter((x) => x.kind === "change" && stamp - new Date(x.at).getTime() < 28 * DAY).map((x) => x.path));
const cands = pages.filter((p) => !NEVER.test(p.path) && !ov[p.path] && !recent.has(p.path) && p.impr >= 50 && p.pos <= 15 && p.ctr < expected(p.pos) * 0.6)
  .sort((a, b) => b.impr * (expected(b.pos) - b.ctr) - a.impr * (expected(a.pos) - a.ctr)).slice(0, 5);
const changes = [];
for (const p of cands) {
  const pq = sum(await call("GetPageQueryStats", `&page=${encodeURIComponent(SITE + p.path)}`)).filter((x) => !BRAND.test(x.k));
  const q = pq.find((x) => x.impr >= 10 && x.k.length >= 6 && x.k.split(" ").length <= 6)?.k;
  const cur = await liveMeta(p.path);
  if (!q || !cur.title) continue;
  const next = rewrite(q, cur, ov[p.path]); if (!next) continue;
  ov[p.path] = next;
  const c = { kind: "change", source: "bing", at, path: p.path, query: q, before: { title: cur.title, impr: p.impr, clicks: p.clicks, ctr: +p.ctr.toFixed(4), pos: p.pos }, after: next };
  append("data/seo-changes.jsonl", c); changes.push(c);
}
if (fs.existsSync("site/lib")) fs.writeFileSync(OV_FILE, JSON.stringify(ov, null, 1) + "\n");

// GAPS — searched on Bing, shown low, and no page title covers every word
const titles = pages.map((p) => p.path).join(" ").toLowerCase().replace(/[-/]/g, " ");
const gaps = queries.filter((q) => q.impr >= 10 && q.pos > 15 && !q.k.split(" ").filter((w) => w.length > 3).every((w) => titles.includes(w))).slice(0, 40)
  .map((q) => ({ q: q.k, impr: q.impr, pos: q.pos }));

// 5. DEMAND — Bing's sampled search counts (US English), summed over every week it returns: a RELATIVE index only
async function volume(q) {
  const r = await fetch(`${API}/GetKeywordStats?q=${encodeURIComponent(q)}&country=us&language=en-US&apikey=${KEY}`).catch(() => null);
  if (!r?.ok) return null;
  return ((await r.json()).d ?? []).reduce((a, x) => a + (x.BroadImpressions ?? 0), 0);
}
const answerQs = (() => { try { return [...fs.readFileSync("site/lib/answers.ts", "utf8").matchAll(/keywords: \["([^"]+)"/g)].map((m) => m[1]); } catch { return []; } })();
const kw = [];
for (const q of [...new Set([...answerQs, ...gaps.slice(0, 10).map((g) => g.q)])]) { const v = await volume(q); if (v != null) kw.push({ q, demand: v, source: answerQs.includes(q) ? "answer" : "gap" }); }
kw.sort((a, b) => b.demand - a.demand);

// save + trend
const tot = pages.reduce((a, p) => ({ impr: a.impr + p.impr, clicks: a.clicks + p.clicks }), { impr: 0, clicks: 0 });
fs.writeFileSync("data/bing.json", JSON.stringify({ at, traffic: traffic.slice(-120), top: queries.slice(0, 40), buyerIntent: buyerQ, pages: pages.slice(0, 40).map(({ k, posW, ...p }) => p), gaps, changes }, null, 1));
fs.writeFileSync("data/bing-keywords.json", JSON.stringify({ at, keywords: kw }, null, 1));
append("data/bing-weekly.jsonl", { at, pages: pages.length, impr: tot.impr, clicks: tot.clicks, buyerQueries: buyerQ.length, changes: changes.length, gaps: gaps.length });
console.log(`Bing: ${pages.length} pages, ${tot.impr} impressions, ${tot.clicks} clicks (28d) · ${buyerQ.length} buyer-intent searches · ${changes.length} titles rewritten · ${gaps.length} gaps · ${kw.length} volumes`);
