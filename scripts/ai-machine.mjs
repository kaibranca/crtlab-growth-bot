// AI REFERRAL MACHINE (11-10, Kai: "the one gate — engineer it to scale and learn, no ceiling, compounds with data").
//
// What it learns, every day, from data that already flows (no paid API, no new load on the site):
//   READS   assistants fetching a page LIVE for a person's question (ChatGPT-User, Claude-User, Perplexity-User) — proxy counts
//   INDEX   the crawlers that put pages into those assistants' search (OAI-SearchBot, PerplexityBot, Claude-SearchBot, Bingbot)
//   CLICKS  people an assistant actually sent, per landing page per day, and how many made an account (ai-pull.mjs)
// Every page belongs to a FAMILY (the template it was made from: a news release, a backtest-<market> page, a stats tool…).
// Each family's read→click and click→account rates are learned from all its pages; a page's own estimate starts from its
// family's and moves to its own numbers as evidence grows (empirical Bayes). So every new page, every day of reads and every
// click sharpens the estimates for its whole family: a learning curve with no ceiling, and a brand-new page gets a useful
// estimate on day one. Recent days count more (half-life 14 days), so the machine follows ChatGPT when it changes.
//
// What it does with that, every day:
//   1. SUBMIT  Bing (ChatGPT search reads Bing's index) gets the most valuable pages first: new or changed pages from the
//              sitemap ranked by their family's learned value, then the top pages not re-submitted for 7 days. 100 a day max.
//   2. SCORE   one line a day in data/ai/score.jsonl — reads, clicks, accounts, AI share: the curve that has to go up.
//   3. PLAN    data/ai/plan.json — CONVERT (read a lot, rarely clicked → give ChatGPT a reason to link), EXPAND (families whose
//              pages earn the most accounts per page → build more of them), INDEX GAPS (indexed, never read), WINNERS.
//   4. VERDICTS any change logged in data/ai/changes.jsonl ({at, path|family, what}) is judged 7 and 14 days later against the
//              same pages' prior rate: kept or flagged. That is how it learns what WORKS, not just what is read.
// Studies and new page types are never auto-published (Kai's rule): the plan proposes, Kai approves.
import fs from "node:fs";
import { SITE, readLines, append, month } from "./lib.mjs";

const DAY = 86400000, HALF = 14, NOW = Date.now();
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const w = (dayIso) => Math.pow(0.5, (NOW - Date.parse(dayIso + "T12:00:00Z")) / DAY / HALF); // recency weight
const LIVE = /^(ChatGPT-User|Claude-User|Perplexity-User)$/, INDEXER = /^(OAI-SearchBot|PerplexityBot|Claude-SearchBot|Bingbot)$/;
const SKIP = /^\/(api|_next|admin|account|auth|login|signup|unsubscribe|app)(\/|$)|\.(png|jpg|svg|ico|webp|xml|js|css)$|opengraph-image|twitter-image/;

// FAMILY = the page's template. Order matters: specific first.
const MKT = "xauusd|xagusd|eurusd|gbpusd|usdjpy|audusd|usdcad|usdchf|nzdusd|nas100|sp500|us30|ger40|usoil|btcusd|ethusd|solusd|gold|silver|oil|nasdaq|dax|bitcoin|ethereum|crypto|forex|stocks|[a-z]{1,5}";
const HUBS = new Set(["/backtest", "/pricing", "/features", "/faq", "/backtesting-software", "/market-replay-software", "/tradingview-bar-replay-alternative", "/daily-market-data", "/economic-calendar", "/news", "/recap", "/tools", "/statistics", "/answers", "/blog", "/learn"]);
export function family(p) {
  if (p === "/" || HUBS.has(p)) return p; // the site's key pages are each their own family
  const s = p.split("/").filter(Boolean);
  if (s[0] === "news") return !s[1] ? "/news" : s.length > 2 ? "/news/<type>/<market>" : /\d{4}-\d{2}-\d{2}$/.test(s[1]) ? "/news/<release>" : "/news/<type>";
  if (s[0] === "recap") return !s[1] ? "/recap" : /^\d{4}-\d{2}-\d{2}$/.test(s[1]) ? "/recap/<date>" : "/recap/<market>";
  if (s[0] === "economic-calendar") return s[1] ? "/economic-calendar/<event>" : "/economic-calendar";
  if (s[0] === "tools") return !s[1] ? "/tools" : /statistics$/.test(s[1]) ? "/tools/<stats>" : /calculator$/.test(s[1]) ? "/tools/<calculator>" : "/tools/<tool>";
  if (["statistics", "answers", "reference", "blog", "learn", "indicators", "hub"].includes(s[0])) return s[1] ? `/${s[0]}/<page>` : `/${s[0]}`;
  if (s.length === 1 && /-challenge-simulator$/.test(s[0])) return "/<firm>-challenge-simulator";
  if (s.length === 1 && new RegExp(`^backtest-(${MKT})$`).test(s[0])) return "/backtest-<market>";
  if (s.length === 1 && new RegExp(`^(${MKT})-[a-z-]+$`).test(s[0]) && !/backtest|replay|software/.test(s[0])) return "/<market>-<concept>";
  if (s.length === 1 && /(backtester|backtesting|backtest)/.test(s[0])) return "/<strategy>-backtester";
  if (s.length === 1 && new RegExp(`^(${MKT})(ny)?$`).test(s[0])) return "/<market> (app)";
  return s.length === 1 ? "/<landing>" : `/${s[0]}/<page>`;
}

// ── 1. load evidence ───────────────────────────────────────────────────────────────────────────────────────────────────
const months = [...new Set(Array.from({ length: 120 }, (_, i) => month(new Date(NOW - i * DAY))))].sort();
const crawl = months.flatMap((m) => readLines(`data/aicrawl/${m}.jsonl`));
const page = new Map(); // path → { reads, index, clicks, accounts, rawReads7, rawClicks7, lastRead }
const P = (p) => { let x = page.get(p); if (!x) page.set(p, (x = { reads: 0, index: 0, clicks: 0, accounts: 0, r7: 0, c7: 0, a7: 0, lastRead: null })); return x; };
const daily = {}; // day → totals, for the score curve
const D = (d) => (daily[d] ??= { reads: 0, index: 0, clicks: 0, accounts: 0, otherClicks: 0 });
for (const win of crawl) {
  const day = win.to.slice(0, 10), wt = w(day), recent = NOW - Date.parse(win.to) < 7 * DAY;
  for (const [bot, v] of Object.entries(win.bots)) {
    const live = LIVE.test(bot), idx = INDEXER.test(bot);
    if (!live && !idx) continue;
    if (live) D(day).reads += v.hits; else D(day).index += v.hits;
    for (const [p0, n] of v.top) {
      const p = p0.split("?")[0].replace(/\/$/, "") || "/";
      if (SKIP.test(p)) continue;
      const x = P(p);
      if (live) { x.reads += n * wt; if (recent) x.r7 += n; if (!x.lastRead || day > x.lastRead) x.lastRead = day; } else x.index += n * wt;
    }
  }
}
const FIRST_READ = crawl.length ? crawl[0].from.slice(0, 10) : "9999";
const clicks = fs.existsSync("data/ai/clicks.json") ? JSON.parse(fs.readFileSync("data/ai/clicks.json", "utf8")) : {};
const AIENG = /^(chatgpt|perplexity|copilot|gemini|claude)$/;
for (const [k, [vis, acc]] of Object.entries(clicks)) {
  const [day, eng, p0] = k.split("|"), p = p0.replace(/\/$/, "") || "/";
  if (!AIENG.test(eng)) { D(day).otherClicks += vis; continue; }
  D(day).clicks += vis; D(day).accounts += acc;
  if (SKIP.test(p) && !/^\/auth/.test(p)) continue;
  const x = P(p), wt = w(day);
  // clicks before the read log began have no reads to divide by: they teach accounts-per-click only, never read→click
  if (day >= FIRST_READ) x.clicks += vis * wt; else x.oldClicks = (x.oldClicks ?? 0) + vis * wt;
  x.accounts += acc * wt;
  if (NOW - Date.parse(day + "T23:59:59Z") < 7 * DAY) { x.c7 += vis; x.a7 += acc; }
}

// ── 2. learn: family priors → page posteriors ─────────────────────────────────────────────────────────────────────────
// Clicks on a page ChatGPT never read in our window still teach the family (the read happened before the log, or in its
// own index). CTR is clicks per live read; ACC is accounts per click. Pseudo-counts K set how fast a page's own numbers
// take over from its family's: after ~K reads the page is half its own evidence.
const K_CTR = 25, K_ACC = 6, K_FAM = 40;
const sitemap = await fetch(`${SITE}/sitemap.xml`).then((r) => r.text()).catch(() => "");
const lastmod = new Map([...sitemap.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => [new URL(m[1]).pathname.replace(/\/$/, "") || "/", m[2]]));
for (const p of lastmod.keys()) P(p);
const fam = new Map();
for (const [p, x] of page) { const f = family(p); x.fam = f; const F = fam.get(f) ?? { pages: 0, reads: 0, clicks: 0, accounts: 0, index: 0, inMap: 0 }; F.pages++; F.reads += x.reads; F.clicks += x.clicks; F.allClicks = (F.allClicks ?? 0) + x.clicks + (x.oldClicks ?? 0); F.accounts += x.accounts; F.index += x.index; if (lastmod.has(p)) F.inMap++; fam.set(f, F); }
const G = [...fam.values()].reduce((a, F) => ({ reads: a.reads + F.reads, clicks: a.clicks + F.clicks, all: a.all + F.allClicks, accounts: a.accounts + F.accounts }), { reads: 0, clicks: 0, all: 0, accounts: 0 });
const gCtr = G.reads ? Math.min(0.5, G.clicks / G.reads) : 0.05, gAcc = G.all ? G.accounts / G.all : 0.4;
for (const F of fam.values()) {
  F.ctr = (F.clicks + K_FAM * gCtr) / (F.reads + K_FAM);
  F.acc = (F.accounts + K_ACC * gAcc) / (F.allClicks + K_ACC);
  F.readsPerPage = F.reads / Math.max(1, F.pages);
  F.value = F.readsPerPage * F.ctr * F.acc; // expected (weighted) accounts per page in this family
}
for (const x of page.values()) {
  const F = fam.get(x.fam);
  x.ctr = (x.clicks + K_CTR * F.ctr) / (x.reads + K_CTR);
  x.acc = (x.accounts + K_ACC * F.acc) / (x.clicks + (x.oldClicks ?? 0) + K_ACC);
  x.conf = +(x.reads / (x.reads + K_CTR)).toFixed(2); // how much of the estimate is the page's own evidence
  // expected accounts from this page: its own read rate, or (no reads yet) its family's — so new pages rank on day one
  const readRate = x.reads > 0 ? x.reads : F.readsPerPage * 0.5;
  x.value = readRate * x.ctr * x.acc;
}

// ── 2b. learn the calendar: ChatGPT is asked about a release in the days around it ─────────────────────────────────────
// Each calendar/news page is tied to its release dates. From the read log the machine learns how many times more a page
// is read in the ±1 day around its release than on other days (LIFT, smoothed toward 2 until it has seen enough), and
// pages with a release in the next 3 days are pushed to Bing BEFORE the questions come. More releases seen = sharper lift.
const slug = (t) => t.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const CC = { USD: ["us", "united-states"], EUR: ["ez", "euro-area", "eurozone", "de", "germany"], GBP: ["uk", "united-kingdom"], JPY: ["jp", "japan"], AUD: ["au", "australia"] };
const upcoming = fs.existsSync("data/events/upcoming.json") ? JSON.parse(fs.readFileSync("data/events/upcoming.json", "utf8")).events ?? [] : [];
const calPages = [...lastmod.keys()].filter((p) => p.startsWith("/economic-calendar/"));
const evDates = new Map(); // path → Set(yyyy-mm-dd)
const tie = (p, d) => { if (!p) return; let x = evDates.get(p); if (!x) evDates.set(p, (x = new Set())); x.add(d); };
for (const e of upcoming) {
  const sl = slug(e.title), pre = CC[e.cur] ?? [];
  tie(calPages.find((p) => { const leaf = p.split("/")[2]; return pre.some((c) => leaf === `${c}-${sl}`); }), e.date);
  for (const c of pre.slice(1)) if (calPages.includes(`/economic-calendar/${c}`)) tie(`/economic-calendar/${c}`, e.date);
  if (e.fam) { tie(`/news/${e.fam}`, e.date); for (const p of lastmod.keys()) if (p.startsWith(`/news/${e.fam}/`)) tie(p, e.date); }
  if (e.imp >= 2) tie("/economic-calendar", e.date);
}
const near = (d, set) => { const t = Date.parse(d); for (const x of set) if (Math.abs(Date.parse(x) - t) <= DAY) return true; return false; };
let nearR = 0, farR = 0, nearN = 0, farN = 0;
const daysSeen = [...new Set(crawl.map((c) => c.to.slice(0, 10)))];
const readsBy = new Map(); // path|day → live reads
for (const win of crawl) { const d = win.to.slice(0, 10); for (const [bot, v] of Object.entries(win.bots)) if (LIVE.test(bot)) for (const [p0, n] of v.top) { const p = p0.split("?")[0].replace(/\/$/, "") || "/"; if (evDates.has(p)) readsBy.set(p + "|" + d, (readsBy.get(p + "|" + d) ?? 0) + n); } }
for (const [p, set] of evDates) for (const d of daysSeen) { const n = readsBy.get(p + "|" + d) ?? 0; if (near(d, set)) { nearR += n; nearN++; } else { farR += n; farN++; } }
const K_LIFT = 30; // reads of evidence before the learned lift outweighs the prior of 2
const rawLift = farN && nearN ? (nearR / nearN) / Math.max(0.05, farR / farN) : 2;
const LIFT = +(((nearR * rawLift) + K_LIFT * 2) / (nearR + K_LIFT)).toFixed(2);
const soon = (p) => { const set = evDates.get(p); if (!set) return null; for (const d of [...set].sort()) { const dd = (Date.parse(d) - Date.parse(iso(NOW))) / DAY; if (dd >= 0 && dd <= 3) return d; } return null; };

// ── 2c. what the eyes saw (ai-eyes.mjs) ───────────────────────────────────────────────────────────────────────────────
// Bing's copy vs the live page: a page changed AFTER Bing's last crawl is an old page to ChatGPT → it jumps the queue.
// Per family: hours from sending to Bing crawling it (median), so the machine knows how fast each family pays off.
// Cloudflare: share of ChatGPT's live reads the site's own counter saw (edge total vs counter) — read counts are scaled by it.
const IXD = fs.existsSync("data/ai/index.json") ? JSON.parse(fs.readFileSync("data/ai/index.json", "utf8")) : {};
const bingOld = (p) => { const c = IXD[p]?.crawled, lm = lastmod.get(p); return !!(c && lm && Date.parse(lm) > Date.parse(c) + 3.6e6); };
const lagBy = {}; for (const [p, x] of Object.entries(IXD)) if (x.lagH != null) (lagBy[family(p)] ??= []).push(x.lagH);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
const famLagH = Object.fromEntries(Object.entries(lagBy).map(([f, a]) => [f, { medianH: med(a), n: a.length }]));
const EDGE = fs.existsSync("data/ai/edge.json") ? JSON.parse(fs.readFileSync("data/ai/edge.json", "utf8")) : null;
const ours24 = crawl.filter((c) => NOW - Date.parse(c.to) < DAY).reduce((t, c) => t + (c.bots["ChatGPT-User"]?.hits ?? 0), 0);
const edge24 = EDGE?.bots?.["ChatGPT-User"]?.total ?? null;
const COVER = edge24 ? +Math.min(1, ours24 / edge24).toFixed(2) : null;

// ── 2d. SURGE DETECTOR (Kai 11-10: "if it sees anything abnormal in a good way, focus on it and power it to the max") ────
// Every hour: each page's and each family's last 24 h of live AI reads (+ clicks × click worth) against its own previous
// 14-day daily average. Poisson z-score; a surge = z ≥ 3 and ≥ 2.5× its normal and ≥ 8 events. A surging page gets ×4 value
// and its family's other pages ×1.5 (Bing first, plan top), so a question ChatGPT has started asking gets every related
// page fresh in Bing while it is hot. Surges are logged once each (data/ai/surges.jsonl) and listed at the top of the plan.
const CW = Math.round(1 / Math.max(0.005, gCtr));
const ev24 = new Map(), evBase = new Map(); // path → events
for (const win of crawl) { const age = NOW - Date.parse(win.to); if (age > 15 * DAY) continue;
  for (const [bot, v] of Object.entries(win.bots)) if (LIVE.test(bot)) for (const [p0, n] of v.top) { const p = p0.split("?")[0].replace(/\/$/, "") || "/"; if (SKIP.test(p)) continue; const m = age < DAY ? ev24 : evBase; m.set(p, (m.get(p) ?? 0) + n); } }
for (const [k, [vis]] of Object.entries(clicks)) { const [d, eng, p0] = k.split("|"); if (!AIENG.test(eng)) continue; const age = NOW - Date.parse(d + "T12:00:00Z"); if (age > 15 * DAY) continue; const p = p0.replace(/\/$/, "") || "/"; const m = age < DAY ? ev24 : evBase; m.set(p, (m.get(p) ?? 0) + vis * CW); }
const baseDays = Math.max(1, Math.min(14, (NOW - (crawl.length ? Date.parse(crawl[0].from) : NOW)) / DAY - 1));
const zOf = (now, base) => { const mu = Math.max(0.5, base / baseDays); return { mu: +mu.toFixed(1), x: (now - mu) / Math.sqrt(mu) }; };
const surges = [];
for (const [p, n] of ev24) { const { mu, x } = zOf(n, evBase.get(p) ?? 0); if (x >= 3 && n >= 2.5 * mu && n >= 8) surges.push({ kind: "page", key: p, family: family(p), last24h: n, normal: mu, z: +x.toFixed(1) }); }
const famNow = new Map(), famBase = new Map();
for (const [p, n] of ev24) famNow.set(family(p), (famNow.get(family(p)) ?? 0) + n);
for (const [p, n] of evBase) famBase.set(family(p), (famBase.get(family(p)) ?? 0) + n);
for (const [f, n] of famNow) { const { mu, x } = zOf(n, famBase.get(f) ?? 0); if (x >= 3 && n >= 2.5 * mu && n >= 12) surges.push({ kind: "family", key: f, family: f, last24h: n, normal: mu, z: +x.toFixed(1) }); }
surges.sort((a, b) => b.z - a.z);
const surgePage = new Set(surges.filter((x) => x.kind === "page").map((x) => x.key)), surgeFam = new Set(surges.map((x) => x.family));
const boost = (p) => (surgePage.has(p) ? 4 : surgeFam.has(family(p)) ? 1.5 : 1);
{ const seen = new Set(readLines("data/ai/surges.jsonl").filter((x) => NOW - Date.parse(x.at) < 2 * DAY).map((x) => x.kind + x.key));
  for (const x of surges) if (!seen.has(x.kind + x.key)) append("data/ai/surges.jsonl", { at: new Date().toISOString(), ...x }); }

// ── 2e. LEARNING FROM FAILURE — Bing sends that went nowhere ─────────────────────────────────────────────────────────
// Every page sent ≥ 7 days ago either got a live AI read within 7 days of the send (a hit) or not (a miss). Per family:
// YIELD = Beta-smoothed hit rate. The family's value is scaled by its yield relative to the overall yield, so quota moves
// away from families whose sends don't pay and toward those that do — automatically, as evidence comes in.
const readDays = new Map(); // path → sorted read days
for (const win of crawl) { const d = win.to.slice(0, 10); for (const [bot, v] of Object.entries(win.bots)) if (LIVE.test(bot)) for (const [p0] of v.top) { const p = p0.split("?")[0].replace(/\/$/, "") || "/"; const a = readDays.get(p) ?? []; if (a[a.length - 1] !== d) a.push(d); readDays.set(p, a); } }
const SUBD = fs.existsSync("data/ai/submitted.json") ? JSON.parse(fs.readFileSync("data/ai/submitted.json", "utf8")) : {};
const yHit = {}, yMiss = {}; let tH = 0, tM = 0;
for (const [p, at] of Object.entries(SUBD)) { const t = Date.parse(at); if (NOW - t < 7 * DAY) continue; const f = family(p), d0 = iso(t), d1 = iso(t + 7 * DAY);
  const hit = (readDays.get(p) ?? []).some((d) => d >= d0 && d <= d1); if (hit) { yHit[f] = (yHit[f] ?? 0) + 1; tH++; } else { yMiss[f] = (yMiss[f] ?? 0) + 1; tM++; } }
const gYield = (tH + 1) / (tH + tM + 2);
const famYield = (f) => ((yHit[f] ?? 0) + 4 * gYield) / ((yHit[f] ?? 0) + (yMiss[f] ?? 0) + 4); // prior worth 4 sends
const yieldMul = (f) => Math.max(0.25, Math.min(3, famYield(f) / gYield));

// ── 3. submit to Bing, most valuable first ────────────────────────────────────────────────────────────────────────────
const SUB = "data/ai/submitted.json";
const sub = fs.existsSync(SUB) ? JSON.parse(fs.readFileSync(SUB, "utf8")) : {};
const queue = [...lastmod.entries()].map(([p, lm]) => {
  const x = page.get(p), last = sub[p] ? Date.parse(sub[p]) : 0, ev = soon(p);
  const changed = Date.parse(lm) > last, stale = NOW - last > 7 * DAY, evDue = ev && NOW - last > 2 * DAY;
  const old = bingOld(p) && NOW - last > DAY, hot = surgePage.has(p) && NOW - last > 6 * 3.6e6;
  return { p, value: x.value * (ev ? LIFT : 1) * (old ? 2 : 1) * boost(p) * yieldMul(x.fam), conf: x.conf, fam: x.fam, why: hot ? "SURGE" : evDue ? `release ${ev}` : old ? "Bing has an old copy" : !last ? "new" : changed ? "changed" : stale ? "refresh" : null };
}).filter((q) => q.why && !SKIP.test(q.p));
// EXPLOIT ~85%: releases due first, then by learned value. EXPLORE ~15%: pages the machine knows least about, spread over
// families, so families it has never seen read still get their chance and the estimates keep improving (no local optimum).
const urgent = (q) => (q.why === "SURGE" ? 3 : q.why.startsWith("release") ? 2 : q.why.startsWith("Bing has") ? 1 : 0);
const rank = (a, b) => urgent(b) - urgent(a) || b.value - a.value;
const exploit = [...queue].sort(rank);
const seenFam = new Set(), explore = [];
for (const q of [...queue].sort((a, b) => a.conf - b.conf || (Math.sin(a.p.length * 7 + NOW / DAY) - Math.sin(b.p.length * 7 + NOW / DAY)))) if (!seenFam.has(q.fam)) { seenFam.add(q.fam); explore.push({ ...q, why: q.why + " · explore" }); }
const pick = (n) => { const nX = Math.round(n * 0.15), out = [], used = new Set();
  for (const q of exploit) { if (out.length >= n - nX) break; out.push(q); used.add(q.p); }
  for (const q of explore) { if (out.length >= n) break; if (!used.has(q.p)) { out.push(q); used.add(q.p); } }
  for (const q of exploit) { if (out.length >= n) break; if (!used.has(q.p)) { out.push(q); used.add(q.p); } }
  return out; };
let submitted = [], bingStatus = "no key";
if (process.env.DRY) { const b = pick(100); console.log("DRY batch:", b.length, b.slice(0, 30).map((q) => `${q.p} [${q.why}]`).join("\n")); }
if (process.env.BING_API_KEY && queue.length) {
  const api = (m) => `https://ssl.bing.com/webmaster/api.svc/json/${m}?apikey=${process.env.BING_API_KEY}`;
  const quota = await fetch(api("GetUrlSubmissionQuota") + `&siteUrl=${encodeURIComponent(SITE + "/")}`).then((r) => r.json()).then((j) => j.d?.DailyQuota ?? 0).catch(() => 0);
  // paced over the day (it runs hourly): releases due go at once, the rest share what is left of today's quota over the hours
  // left, so pages created later today (a fresh release, a new recap) still find room
  const hoursLeft = Math.max(1, 24 - new Date().getUTCHours()), due = queue.filter((q) => q.why.startsWith("release")).length;
  const batch = pick(Math.min(quota, Math.max(Math.min(due, quota), Math.ceil(quota / hoursLeft))));
  if (batch.length) {
    const r = await fetch(api("SubmitUrlBatch"), { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ siteUrl: SITE + "/", urlList: batch.map((q) => SITE + (q.p === "/" ? "" : q.p)) }) }).catch((e) => ({ status: String(e) }));
    bingStatus = `HTTP ${r.status}`;
    if (r.status === 200) { const at = new Date().toISOString(); for (const q of batch) sub[q.p] = at; submitted = batch; }
  } else bingStatus = "quota used";
}
fs.mkdirSync("data/ai", { recursive: true });
fs.writeFileSync(SUB, JSON.stringify(sub));

// ── 4. verdicts on logged changes ─────────────────────────────────────────────────────────────────────────────────────
// a change = {at, path?, family?, what}. Compare the 14 days before with the days after (7 and 14 days): reads and clicks per day.
const changes = readLines("data/ai/changes.jsonl");
const perDay = (match, from, to) => { // raw (unweighted) reads + clicks per day for matching pages between two dates
  let reads = 0, clk = 0, acc = 0;
  for (const win of crawl) { const d = win.to.slice(0, 10); if (d < from || d >= to) continue; for (const [bot, v] of Object.entries(win.bots)) if (LIVE.test(bot)) for (const [p, n] of v.top) if (match(p.split("?")[0].replace(/\/$/, "") || "/")) reads += n; }
  for (const [k, [vis, a]] of Object.entries(clicks)) { const [d, eng, p] = k.split("|"); if (d < from || d >= to || !AIENG.test(eng)) continue; if (match(p.replace(/\/$/, "") || "/")) { clk += vis; acc += a; } }
  const days = Math.max(1, (Date.parse(to) - Date.parse(from)) / DAY);
  return { reads: +(reads / days).toFixed(2), clicks: +(clk / days).toFixed(2), accounts: +(acc / days).toFixed(2) };
};
const verdicts = changes.map((c) => {
  const t = Date.parse(c.at), match = c.path ? (p) => p === c.path : (p) => family(p) === c.family;
  const before = perDay(match, iso(t - 14 * DAY), iso(t)), age = (NOW - t) / DAY;
  const after = age >= 7 ? perDay(match, iso(t), iso(Math.min(NOW, t + 14 * DAY))) : null;
  const lift = after ? (after.clicks + after.reads * gCtr) - (before.clicks + before.reads * gCtr) : null;
  return { ...c, before, after, verdict: !after ? `measuring (day ${Math.floor(age)} of 7)` : lift > 0.05 ? "WORKS — keep, apply to the family" : lift < -0.05 ? "WORSE — revert or rethink" : "no clear change yet" };
});

// ── 4b. HOOK EXPERIMENTS — judge, decide, move on (site renders them: crtlab-standalone lib/aiHooks.ts) ─────────────
// Half of a family's pages carry the hook (arm B = bucket(id+path) < split·100, the site's own function). Metric: AI-sent
// value per page-day (live reads + clicks weighted by what a click is worth; exposure = pages × days running). Bayesian (Gamma–Poisson): the test
// stops the moment P(B beats A) is clear — ≥ 0.95 → WON (every page gets it), ≤ 0.05 → LOST — after at least 5 days, or
// at 28 days without a clear answer (lost: the simpler page stays). Then the next approved template for that family starts
// by itself, so the machine keeps testing forever. Templates (wording) are only ever ones Kai pushed in the site's code.
const HOOKS = "data/ai/hooks.json";
const LIBRARY = { "/economic-calendar/<event>": ["replay-last", "practise-next"], "/news/<release>": ["replay-last", "practise-next"] };
const bucket = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h % 100; };
const gamma = (k) => { // Marsaglia–Tsang, k > 0
  if (k < 1) return gamma(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { const u1 = Math.random(), u2 = Math.random(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = Math.random(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
};
const pBeats = (cB, eB, cA, eA) => { let n = 0; for (let i = 0; i < 4000; i++) if (gamma(cB + 0.5) / (eB + 1) > gamma(cA + 0.5) / (eA + 1)) n++; return n / 4000; };
// LESSONS: every finished test, won or lost, is remembered per wording. When a family needs its next test, the wording with
// the best record across ALL families goes first (Beta mean), and a wording that lost on a family is never retried there.
const LES = "data/ai/lessons.json", LESSONS = fs.existsSync(LES) ? JSON.parse(fs.readFileSync(LES, "utf8")) : {};
const winRate = (t) => ((LESSONS[t]?.won ?? 0) + 1) / ((LESSONS[t]?.won ?? 0) + (LESSONS[t]?.lost ?? 0) + 2);
const hk = fs.existsSync(HOOKS) ? JSON.parse(fs.readFileSync(HOOKS, "utf8")) : { experiments: [] };
const expReport = [];
for (const e of hk.experiments.filter((x) => x.status === "running" && x.started)) {
  const t0 = Date.parse(e.started), days = Math.max(0.5, (NOW - t0) / DAY), day0 = iso(t0);
  const fam = [...lastmod.keys()].filter((p) => family(p) === e.family);
  const armOf = (p) => (bucket(e.id + p) < e.split * 100 ? "B" : "A");
  // per page: PRE = the 14 days before the start, POST = since the start. Each page is its own baseline (difference in
  // differences), because pages differ hugely (a CPI page is read 50× more than a minor one) and a plain arm total would
  // just measure which arm happened to get the busy pages.
  const W = Math.round(1 / Math.max(0.005, gCtr));
  const logStart = crawl.length ? Date.parse(crawl[0].from) : t0, pre0 = Math.max(t0 - 14 * DAY, logStart), preDays = Math.max(0.5, (t0 - pre0) / DAY);
  const pg = new Map(fam.map((p) => [p, { arm: armOf(p), pre: 0, post: 0, clicks: 0, accounts: 0, reads: 0 }]));
  for (const win of crawl) { const t = Date.parse(win.to); if (t < pre0) continue; const post = t >= t0;
    for (const [bot, v] of Object.entries(win.bots)) if (LIVE.test(bot)) for (const [p0, n] of v.top) { const x = pg.get(p0.split("?")[0].replace(/\/$/, "") || "/"); if (!x) continue; if (post) { x.post += n; x.reads += n; } else x.pre += n; } }
  for (const [k, [vis, acc]] of Object.entries(clicks)) { const [d, eng, p0] = k.split("|"); if (!AIENG.test(eng)) continue; const x = pg.get(p0.replace(/\/$/, "") || "/"); if (!x) continue; const t = Date.parse(d + "T12:00:00Z"); if (t < pre0) continue;
    if (t >= t0) { x.post += vis * W; x.clicks += vis; x.accounts += acc; } else x.pre += vis * W; }
  const arms = { A: [], B: [] }; for (const x of pg.values()) if (x.pre + x.post > 0) arms[x.arm].push(x);
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const A = { pages: [...pg.values()].filter((x) => x.arm === "A").length, active: arms.A.length, reads: sum(arms.A, (x) => x.reads), clicks: sum(arms.A, (x) => x.clicks), accounts: sum(arms.A, (x) => x.accounts) };
  const B = { pages: [...pg.values()].filter((x) => x.arm === "B").length, active: arms.B.length, reads: sum(arms.B, (x) => x.reads), clicks: sum(arms.B, (x) => x.clicks), accounts: sum(arms.B, (x) => x.accounts) };
  // lift = (post per day) / (pre per day), +1 smoothing; P(B's lift > A's) by resampling PAGES (2,000 bootstrap draws)
  const lift = (a) => ((sum(a, (x) => x.post) + 1) / days) / ((sum(a, (x) => x.pre) + 1) / preDays);
  const draw = (a) => Array.from({ length: a.length }, () => a[Math.floor(Math.random() * a.length)]);
  let wins = 0; const N = 2000; for (let i = 0; i < N; i++) if (lift(draw(arms.B)) > lift(draw(arms.A))) wins++;
  const pr = arms.A.length && arms.B.length ? wins / N : 0.5;
  const enough = preDays >= 5 && sum(arms.A, (x) => x.pre) >= 30 && sum(arms.B, (x) => x.pre) >= 30 && sum(arms.A, (x) => x.post) + sum(arms.B, (x) => x.post) >= 60;
  A.lift = +lift(arms.A).toFixed(2); B.lift = +lift(arms.B).toFixed(2);
  let decision = null;
  // checked every hour, so the bar is high (0.99 / 0.01) to keep false wins rare; at least 7 days (a full week cycle)
  const truthBad = fs.existsSync("data/ai/truth.json") && JSON.parse(fs.readFileSync("data/ai/truth.json", "utf8")).problems?.some((x) => !/: missing "/.test(x));
  if (truthBad) decision = null; // the site contradicts itself → any lift or drop is not the hook's doing: no verdict until it agrees again
  else if (days >= 7 && enough && pr >= 0.99) decision = "won"; else if (days >= 7 && enough && pr <= 0.01) decision = "lost"; else if (days >= 28) decision = "lost";
  e.last = { at: new Date().toISOString(), days: +days.toFixed(1), A, B, clickWorth: W, preDays: +preDays.toFixed(1), pBbeatsA: +pr.toFixed(3), enough };
  if (decision) {
    e.status = decision; e.ended = new Date().toISOString();
    (LESSONS[e.template] ??= { won: 0, lost: 0, families: {} }); LESSONS[e.template][decision]++; LESSONS[e.template].families[e.family] = decision;
    append("data/ai/changes.jsonl", { at: e.ended, family: e.family, what: `hook test ${e.id} (${e.template}) ${decision.toUpperCase()} · P=${pr.toFixed(2)} after ${days.toFixed(0)}d · A ${A.clicks}/${A.pages}p · B ${B.clicks}/${B.pages}p` });
  }
  expReport.push({ id: e.id, family: e.family, template: e.template, ...e.last, status: e.status });
}
// keep every family testing: nothing running and nothing won → start the next approved template it hasn't tried
for (const [famName, tpls] of Object.entries(LIBRARY)) {
  const mine = hk.experiments.filter((x) => x.family === famName);
  if (mine.some((x) => x.status === "running" || x.status === "won" || x.status === "paused")) continue;
  const next = [...tpls].sort((a, b) => winRate(b) - winRate(a)).find((t) => !mine.some((x) => x.template === t));
  if (next) hk.experiments.push({ id: `${famName.replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}-${next}-${iso(NOW)}`, family: famName, template: next, split: 0.5, status: "running", started: new Date().toISOString() });
}
fs.writeFileSync(HOOKS, JSON.stringify(hk, null, 1));
fs.writeFileSync(LES, JSON.stringify(LESSONS, null, 1));

// ── 5. plan ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const pages = [...page.entries()].map(([p, x]) => ({ p, ...x }));
const r2 = (n) => +n.toFixed(2), r4 = (n) => +n.toFixed(4);
const famRows = [...fam.entries()].map(([f, F]) => ({ family: f, pages: F.pages, inSitemap: F.inMap, reads: r2(F.reads), clicks: r2(F.clicks), accounts: r2(F.accounts), readsPerPage: r2(F.readsPerPage), ctr: r4(F.ctr), acc: r4(F.acc), value: r4(F.value) }))
  .sort((a, b) => b.value - a.value);
const TRUTH = fs.existsSync("data/ai/truth.json") ? JSON.parse(fs.readFileSync("data/ai/truth.json", "utf8")) : null;
const plan = {
  at: new Date().toISOString(),
  truth: TRUTH && { at: TRUTH.at, ok: TRUTH.ok, problems: TRUTH.problems },
  surges: surges.slice(0, 15),
  learned: { sendYield: { overall: +gYield.toFixed(3), judged: tH + tM, byFamily: Object.fromEntries(Object.keys({ ...yHit, ...yMiss }).map((f) => [f, +famYield(f).toFixed(3)])) }, hookLessons: LESSONS, readCoverage: COVER, bingChecked: Object.keys(IXD).length, bingOldCopies: [...lastmod.keys()].filter(bingOld).length, famLagH, eventLift: LIFT, eventPages: evDates.size, releasesNext3d: [...lastmod.keys()].filter((p) => soon(p)).length, pagesKnown: page.size, pagesRead: pages.filter((x) => x.reads > 0).length, families: fam.size, globalCtr: r4(gCtr), globalAcc: r4(gAcc), halfLifeDays: HALF },
  // read a lot, clicked rarely: ChatGPT answers from these pages without sending the person → give it a reason to link
  convert: pages.filter((x) => x.r7 >= 5 && x.conf >= 0.3).map((x) => ({ p: x.p, family: x.fam, reads7d: x.r7, clicks7d: x.c7, ctr: r4(x.ctr), missedAccounts: r2(x.reads * Math.max(0, gCtr - x.ctr) * x.acc) }))
    .filter((x) => x.missedAccounts > 0).sort((a, b) => b.missedAccounts - a.missedAccounts).slice(0, 25),
  // families that earn the most accounts per page → more pages of these, first
  expand: famRows.filter((f) => f.reads + f.clicks > 2).slice(0, 12),
  // pages that send the most accounts → protect, never break, copy what they do
  winners: pages.filter((x) => x.accounts > 0 && !/^\/auth/.test(x.p)).sort((a, b) => b.accounts - a.accounts).slice(0, 15).map((x) => ({ p: x.p, family: x.fam, accounts: r2(x.accounts), clicks: r2(x.clicks), reads: r2(x.reads), ctr: r4(x.ctr) })),
  // the search crawler has it, but nobody's question has pulled it in 7 days: wording/intent problem, not indexing
  indexedNotRead: pages.filter((x) => x.index >= 3 && x.r7 === 0 && lastmod.has(x.p)).sort((a, b) => b.index - a.index).slice(0, 20).map((x) => ({ p: x.p, family: x.fam, index: r2(x.index) })),
  families: famRows,
  submitted: { status: bingStatus, count: submitted.length, top: submitted.slice(0, 15).map((q) => `${q.p} (${q.why})`), queueLeft: Math.max(0, queue.length - submitted.length) },
  verdicts,
  experiments: expReport,
};
fs.writeFileSync("data/ai/plan.json", JSON.stringify(plan, null, 1));

// ── 6. score: one line per finished day (re-written while the day can still change) ──────────────────────────────────
const SC = "data/ai/score.jsonl";
const old = readLines(SC).filter((s) => NOW - Date.parse(s.day + "T00:00:00Z") > 4 * DAY);
const have = new Set(old.map((s) => s.day));
const lines = [...old, ...Object.entries(daily).filter(([d]) => !have.has(d) && d < iso(NOW)).map(([day, v]) => ({ day, ...v, aiShare: v.clicks + v.otherClicks ? r2(v.clicks / (v.clicks + v.otherClicks)) : null }))].sort((a, b) => a.day.localeCompare(b.day));
fs.writeFileSync(SC, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
append("data/ai/runs.jsonl", { at: plan.at, pagesRead: plan.learned.pagesRead, gCtr: plan.learned.globalCtr, gAcc: plan.learned.globalAcc, submitted: submitted.length, bing: bingStatus });
console.log(JSON.stringify({ learned: plan.learned, submitted: plan.submitted, topConvert: plan.convert.slice(0, 5), topFamilies: famRows.slice(0, 6).map((f) => `${f.family} v=${f.value} ctr=${f.ctr} reads/pg=${f.readsPerPage}`) }, null, 1));
