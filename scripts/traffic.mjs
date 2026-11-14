// TRAFFIC ENGINE (Kai 11-11: "a whole new branch just for traffic, tons of machines, scale ASAP"). The AI machine, radar
// and IndexNow push the pages we HAVE into the indexes. This engine turns DEMAND into traffic. Daily, light: Bing's free
// Webmaster API, the bot's own crawl history, one read of guest landing paths, ≤60 GETs to crtlab.pro. Four machines:
//
//  1. DEMAND   — every non-brand Bing search we were shown for (28 d): position, impressions, clicks, and the page that
//                answers it. Sorted into: page 1 bottom (4–10, a rank job), page 2 (11–20), and GAPS (no page fits).
//  2. RANK     — the best page-1-bottom / page-2 pages by missed clicks (impressions × the CTR of position 3 − actual).
//                Each becomes a core "rank" branch (Bing first ×1.5, judged on its Bing position after 7 days).
//  3. GHOSTS   — URLs that AI assistants, crawlers and people ask for but that don't exist (ChatGPT invents URLs).
//                Checked live; each 404 is mapped to the closest real page → data/traffic/redirects.json, which the
//                site's proxy serves as a 301. Recovered hits are counted, a mapping nobody uses again expires in 60 d.
//  4. LEARNING — every run is scored (missed clicks, ghost hits recovered, rank branches solved) in score.jsonl; the
//                rank threshold and how many branches it may run move with its verdicts (solved → more, stuck → fewer).
import fs from "node:fs";
import { SITE, append, readLines, BRAND } from "./lib.mjs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/traffic", UA = { "User-Agent": "crtlab-traffic-engine" };
fs.mkdirSync(OUT, { recursive: true });
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const prev = J(`${OUT}/plan.json`, {});
const state = J(`${OUT}/state.json`, { rankN: 3, minImpr: 5, ghosts: {} });

// ── 0. the site's real pages (sitemap) + tokens for matching ─────────────────────────────────────────────────────────
// 11-13 the site split its sitemap (main = WORKS families, /sitemap-archive.xml = the rest). Both are REAL pages — reading only
// the main one dropped below 500 and this step silently exited 0 for days ("ok" with no plan written). Read both; fail LOUD.
const getSm = (u) => fetch(u, { headers: UA }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
const sm = (await getSm(`${SITE}/sitemap.xml`)) + (await getSm(`${SITE}/sitemap-archive.xml`));
const PAGES = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => { try { return new URL(m[1]).pathname.replace(/\/$/, "") || "/"; } catch { return null; } }).filter(Boolean);
if (PAGES.length < 500) { console.log(`traffic: sitemap looked wrong (${PAGES.length} pages) — nothing changed`); process.exit(1); }
const REAL = new Set(PAGES);
fs.writeFileSync(`${OUT}/pages.json`, JSON.stringify({ at: new Date().toISOString(), pages: PAGES })); // the brain only ever pushes real pages
const SYN = { gold: "xauusd", xau: "xauusd", silver: "xagusd", oil: "usoil", wti: "usoil", crude: "usoil", nasdaq: "nas100", nq: "nas100", us100: "nas100", ustec: "nas100",
  dow: "us30", dj30: "us30", spx: "sp500", us500: "sp500", es: "sp500", dax: "ger40", de40: "ger40", bitcoin: "btcusd", btc: "btcusd", ethereum: "ethusd", eth: "ethusd",
  solana: "solusd", sol: "solusd", cable: "gbpusd", yen: "usdjpy", lot: "lot", lots: "lot", position: "position", backtester: "backtest", backtesting: "backtest", backtests: "backtest" };
const STOP = new Set(["the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "free", "best", "online", "how", "what", "is", "does", "do", "i", "my", "vs", "page", "crtlab", "com", "www", "tool", "app"]);
const tok = (s) => new Set(String(s).toLowerCase().replace(/&amp;/g, "&").split(/[^a-z0-9&]+/).filter((w) => w && !STOP.has(w)).map((w) => SYN[w] ?? w));
const PT = PAGES.map((p) => ({ p, t: tok(p), sec: p.split("/")[1] ?? "" }));
const score = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.max(1, Math.min(a.size, 6) + 0.5 * Math.max(0, b.size - n)); };
const raw = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const PR = new Map(PAGES.map((p) => [p, raw(p)]));
const nearest = (q, sec = null) => { const t = tok(q); if (!t.size) return null; const r = raw(q); let best = null;
  for (const c of PT) { let s = score(t, c.t); if (sec && c.sec === sec) s += 0.15;
    let tie = 0; for (const w of r) if (PR.get(c.p).has(w)) tie++; s += 0.04 * tie; // the small words decide between equal matches
    if (!best || s > best.s || (s === best.s && c.p.length < best.p.length)) best = { p: c.p, s }; }
  return best; };

// ── 1. DEMAND (Bing, 28 d, non-brand) ────────────────────────────────────────────────────────────────────────────────
const KEY = process.env.BING_API_KEY;
const bing = async (m) => { if (!KEY) return [];
  for (let i = 0; i < 3; i++) { const r = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/${m}?siteUrl=${encodeURIComponent(SITE + "/")}&apikey=${KEY}`).catch(() => null);
    if (r?.ok) return (await r.json()).d ?? []; await new Promise((res) => setTimeout(res, 3000)); } return []; };
const when = (d) => Number(String(d).match(/\d{10,}/)?.[0] ?? 0);
const agg = (rows, key) => { const m = new Map();
  for (const x of rows) { if (when(x.Date) < NOW - 28 * DAY) continue; const k = x[key]; const o = m.get(k) ?? { k, impr: 0, clicks: 0, posW: 0 };
    o.impr += x.Impressions; o.clicks += x.Clicks; o.posW += (x.AvgImpressionPosition > 0 ? x.AvgImpressionPosition : 99) * x.Impressions; m.set(k, o); }
  return [...m.values()].map((o) => ({ q: o.k, impr: o.impr, clicks: o.clicks, pos: o.impr ? +(o.posW / o.impr).toFixed(1) : 99 })).sort((a, b) => b.impr - a.impr); };
const qRows = agg(await bing("GetQueryStats"), "Query").filter((q) => !BRAND.test(q.q) && !/c\w?r\w?t\s*la?b|crtab|cartlab|crtlap/i.test(q.q));
const pageRaw = await bing("GetPageStats");
const pRows = agg(pageRaw, "Query").map((x) => { try { return { ...x, p: new URL(x.q).pathname.replace(/\/$/, "") || "/" }; } catch { return null; } }).filter(Boolean);
const pageStat = new Map(pRows.map((x) => [x.p, x]));
const ctrAt = (pos) => (pos < 1.5 ? 0.28 : pos < 2.5 ? 0.15 : pos < 3.5 ? 0.1 : pos < 4.5 ? 0.07 : pos < 5.5 ? 0.05 : pos < 10.5 ? 0.03 : pos < 20.5 ? 0.01 : 0.003);
const demand = qRows.filter((q) => q.impr >= 2).slice(0, 200).map((q) => {
  const n = nearest(q.q); const fit = n && n.s >= 0.45 ? n.p : null;
  const band = q.pos <= 3.5 ? "top" : q.pos <= 10.5 ? "page1-bottom" : q.pos <= 20.5 ? "page2" : "deep";
  return { ...q, page: fit, fit: n ? +n.s.toFixed(2) : 0, band, missed: +(q.impr * Math.max(0, ctrAt(3) - q.clicks / Math.max(1, q.impr))).toFixed(1) };
});
const gaps = demand.filter((d) => !d.page && d.impr >= 3).slice(0, 25);

// ── 2. RANK targets: the pages with the most clicks missed on page 1 bottom / page 2 ─────────────────────────────────
const byPage = new Map();
for (const d of demand) if (d.page && (d.band === "page1-bottom" || d.band === "page2") && d.impr >= state.minImpr) {
  const o = byPage.get(d.page) ?? { page: d.page, missed: 0, impr: 0, queries: [] }; o.missed += d.missed; o.impr += d.impr; o.queries.push(`${d.q} (#${d.pos})`); byPage.set(d.page, o); }
const rank = [...byPage.values()].map((o) => ({ ...o, missed: +o.missed.toFixed(1), pos: pageStat.get(o.page)?.pos ?? Math.min(...demand.filter((d) => d.page === o.page).map((d) => d.pos)), queries: o.queries.slice(0, 4) })) // no page stats yet → its searches' best position
  .filter((o) => o.pos != null && o.pos > 3.5).sort((a, b) => b.missed - a.missed).slice(0, state.rankN);

// ── 3. GHOSTS: requested URLs that don't exist ───────────────────────────────────────────────────────────────────────
const ASKERS = /^(GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|Googlebot|Bingbot|Applebot|DuckAssistBot|Meta|people)$/;
const CLEAN = /^\/[a-z0-9][a-z0-9\-\/]*$/; // lower-case words and dashes only — scanners (/Dockerfile, /proc/…, %2e) never qualify
const PROBE = /^\/(admin|cms|site|wp|login|config|backup|\.?env|var|proc|etc|server|debug|test|old|new|cgi)\b/;
const NOISE = /opengraph-image|twitter-image|icon|apple-touch|favicon|manifest|\.(png|jpe?g|webp|svg|ico|js|css|map|txt|xml|json|woff2?)$|^\/(api|_next|cdn-cgi|\.well-known)\b|wp-|\.php|\.env|\.git/i;
const asked = new Map(); // path → hits (14 d)
const addAsk = (p, n = 1, who = "bot") => { if (!p || typeof p !== "string") return; p = p.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";
  if (p.length > 120 || NOISE.test(p) || REAL.has(p) || !CLEAN.test(p) || PROBE.test(p) || !ASKERS.test(who)) return; const o = asked.get(p) ?? { hits: 0, who: new Set() }; o.hits += n; o.who.add(who); asked.set(p, o); };
for (const m of [new Date(NOW).toISOString().slice(0, 7), new Date(NOW - 14 * DAY).toISOString().slice(0, 7)].filter((v, i, a) => a.indexOf(v) === i))
  for (const w of readLines(`data/aicrawl/${m}.jsonl`)) { if (NOW - Date.parse(w.to) > 14 * DAY) continue; for (const [b, v] of Object.entries(w.bots ?? {})) for (const [p, k] of v.top ?? []) addAsk(p, k, b); }
if (process.env.ANALYTICS_DB_URL) try {
  const pg = (await import("pg")).default; const c = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  const r = await c.query(`select landing_path p, count(*)::int n from guest_presence where created_at > now() - interval '14 days' and landing_path is not null group by 1`);
  for (const x of r.rows) addAsk(x.p, x.n, "people"); await c.end();
} catch (e) { console.log("traffic: guest paths skipped (" + String(e.message).slice(0, 60) + ")"); }
// check the most-asked unknown paths live (≤40 a run), remember the answer 7 days
const G = state.ghosts;
const toCheck = [...asked].sort((a, b) => b[1].hits - a[1].hits).filter(([p]) => !G[p] || NOW - Date.parse(G[p].checked) > 7 * DAY).slice(0, 40);
for (const [p] of toCheck) {
  const r = await fetch(SITE + p, { headers: UA, redirect: "manual" }).catch(() => null); const st = r?.status ?? 0;
  if (st === 301 || st === 308) { if (!G[p]?.to) G[p] = { status: st, checked: new Date().toISOString() }; else G[p].checked = new Date().toISOString(); continue; } // already redirected (by us or the site)
  G[p] = { ...(G[p] ?? {}), status: st, checked: new Date().toISOString() };
  if (st === 404) { const n = tok(p).size >= 2 ? nearest(p, p.split("/")[1]) : null; /* one word is too little to be sure: a wrong 301 is worse than a 404 */ const parent = "/" + (p.split("/")[1] ?? "");
    const to = n && n.s >= 0.6 ? n.p : REAL.has(parent) && parent !== "/" ? parent : null;
    if (to && to !== p) { if (!G[p].to) { G[p].to = to; G[p].mapped = new Date().toISOString(); G[p].fit = +(n?.s ?? 0).toFixed(2); } }
    else delete G[p].to; }
  else delete G[p].to; // it exists now (or errors): never redirect a live page
}
for (const [p, g] of Object.entries(G)) { const a = asked.get(p); g.hits14 = a?.hits ?? 0; g.who = a ? [...a.who].slice(0, 4) : g.who ?? [];
  if (REAL.has(p)) delete g.to; // a real page took this URL → the redirect goes
  if (g.to && !REAL.has(g.to)) delete g.to; // its target was removed
  if (g.to && g.mapped && NOW - Date.parse(g.mapped) > 60 * DAY && !g.hits14) delete G[p]; // nobody asks any more
  else if (!g.to && NOW - Date.parse(g.checked) > 30 * DAY) delete G[p]; }
const redirects = Object.fromEntries(Object.entries(G).filter(([, g]) => g.to).map(([p, g]) => [p, g.to]));
fs.writeFileSync(`${OUT}/redirects.json`, JSON.stringify(redirects));
const recovered = Object.values(G).filter((g) => g.to && g.mapped && NOW - Date.parse(g.mapped) > DAY).reduce((a, g) => a + (g.hits14 ?? 0), 0);

// ── 4. LEARNING: score the run; rank branches solved → it may run more, stuck → fewer, and the bar moves ─────────────
const sp = J("data/machines/spawned.json", { branches: [] }).branches.filter((b) => b.kind === "rank");
const solved = sp.filter((b) => b.verdict === "solved").length, stuck = sp.filter((b) => b.verdict === "still open").length;
if (solved > stuck && state.rankN < 6) state.rankN++; else if (stuck > solved + 1 && state.rankN > 2) state.rankN--;
state.minImpr = rank.length < 2 ? Math.max(3, state.minImpr - 1) : state.minImpr;
fs.writeFileSync(`${OUT}/state.json`, JSON.stringify(state, null, 1));
const missedAll = +demand.filter((d) => d.page && d.band !== "top").reduce((a, d) => a + d.missed, 0).toFixed(1);
const sc = { at: new Date().toISOString(), queries: demand.length, impr: demand.reduce((a, d) => a + d.impr, 0), clicks: demand.reduce((a, d) => a + d.clicks, 0), missed: missedAll,
  page1Bottom: demand.filter((d) => d.band === "page1-bottom").length, page2: demand.filter((d) => d.band === "page2").length, gaps: gaps.length,
  ghosts: Object.keys(redirects).length, recovered, rankAlive: sp.filter((b) => b.state === "alive").length, solved, stuck };
append(`${OUT}/score.jsonl`, sc);

const pagePos = Object.fromEntries(pRows.filter((x) => REAL.has(x.p) && x.impr >= 3).map((x) => [x.p, x.pos]));
// the LAST 7 DAYS' position per page — what the rank judge needs (the 28-day average is three-quarters history before a branch)
const pagePos7 = (() => { const m = new Map(); for (const x of pageRaw) { if (when(x.Date) < NOW - 7 * DAY) continue; let p; try { p = new URL(x.Query).pathname.replace(/\/$/, "") || "/"; } catch { continue; }
  const o = m.get(p) ?? { impr: 0, posW: 0 }; o.impr += x.Impressions; o.posW += (x.AvgImpressionPosition > 0 ? x.AvgImpressionPosition : 99) * x.Impressions; m.set(p, o); }
  return Object.fromEntries([...m].filter(([p, o]) => REAL.has(p) && o.impr >= 2).map(([p, o]) => [p, +(o.posW / o.impr).toFixed(1)])); })();
const plan = { at: sc.at, score: sc, rankN: state.rankN, rank, gaps, demand: demand.slice(0, 60), pagePos, pagePos7,
  ghosts: Object.entries(G).filter(([, g]) => g.to).sort((a, b) => (b[1].hits14 ?? 0) - (a[1].hits14 ?? 0)).slice(0, 30).map(([p, g]) => ({ p, to: g.to, hits14: g.hits14, who: g.who, fit: g.fit })),
  prev: prev.score ?? null };
fs.writeFileSync(`${OUT}/plan.json`, JSON.stringify(plan, null, 1));
console.log(`traffic engine: ${sc.queries} Bing searches (${sc.impr} impressions, ${sc.clicks} clicks) · ${sc.missed} clicks/28 d missed below #3 · ${sc.page1Bottom} on page 1 bottom, ${sc.page2} on page 2, ${sc.gaps} gaps
  rank targets: ${rank.map((r) => `${r.page} (#${r.pos}, ${r.missed} missed)`).join(", ") || "none"}
  ghosts: ${sc.ghosts} redirected (${toCheck.length} checked this run, ${recovered} hits recovered) · top gaps: ${gaps.slice(0, 4).map((g) => g.q).join(" | ") || "none"}`);
