// MENTIONS MACHINE (11-11, Kai: "an engine that constantly looks for any outside mention of CRTLAB — word of mouth, collabs")
// DAILY. Four eyes, all free except one cheap weekly web search:
//   1. WHO SENDS PEOPLE — referrer hosts in guest_presence (read-only DB), per day: visitors + first accounts. Search engines,
//      AI assistants, payments, sign-in and CRTLAB itself are excluded (other machines own those). This is word of mouth.
//   2. WHO LINKS — Bing Webmaster inbound links (GetLinkCounts), so a new backlink shows the day Bing finds it.
//   3. WHO TALKS — Hacker News via its official public API (Algolia), newest first (read-only; never posts).
//   4. WEB — Mondays, one OpenAI web-search question "where is CRTLAB mentioned" (≈$0.03), so YouTube/X/forums show up too.
// LEARNS (machine standard): per source, visitors → accounts shrunk to the global rate (K 15 visitors); NEW sources and
// RISING sources (last 7 days vs its own 21 before, Poisson z ≥ 2.5, ≥ 2×, ≥ 5 visitors) — "go all in" picks; sources that
// sent people once and went quiet are remembered as FADED, not retried as picks. Creator / community hosts that send real
// people are listed as COLLAB candidates for Kai (the machine never contacts anyone). New mention or surge → one email/day.
// Public repo: hosts, public URLs and counts only — no visitor rows, no user text.
import fs from "node:fs";
import { readLines, append, BRAND } from "./lib.mjs";

const DIR = "data/mentions", DAY = 864e5, NOW = Date.now(), iso = (t) => new Date(t).toISOString().slice(0, 10);
fs.mkdirSync(DIR, { recursive: true });
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const state = J(`${DIR}/state.json`, { seen: {}, emailed: null, lastWeb: null, webCost: 0 });
const log = [];

// ── 1. referrers ──────────────────────────────────────────────────────────────────────────────────────────────────────
const NOT_WOM = /(^|\.)(crtlab\.pro|localhost|google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.[a-z.]+|yandex\.[a-z.]+|baidu\.com|ecosia\.org|brave\.com|search\.[a-z.]+|chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|stripe\.com|checkout\.stripe\.com|paypal\.com|accounts\.google\.com|appleid\.apple\.com|railway\.app|vercel\.app|github\.com\/login|statics\.teams\.cdn\.office\.net)$/i;
const CREATOR = /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com|t\.co|discord\.(com|gg)|reddit\.com|facebook\.com|fb\.com|linkedin\.com|telegram\.(org|me)|t\.me|substack\.com|medium\.com|forexfactory\.com|babypips\.com|tradingview\.com|whop\.com|skool\.com|patreon\.com|linktr\.ee|beacons\.ai)/i;
let refs = J(`${DIR}/referrers.json`, {}); // "day|host" → [visitors, accounts]
if (process.env.ANALYTICS_DB_URL) {
  try {
    const pg = (await import("pg")).default, db = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    // one grouped scan, 35 days; host = lower(referrer host) or utm_source when there is no referrer
    const r = await db.query(`
      SELECT to_char(g.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
             lower(coalesce(nullif(substring(g.referrer from '^[a-z-]+://(?:www\\.)?([^/:?#]+)'), ''), 'utm:' || nullif(lower(g.utm_source), ''))) AS host,
             count(DISTINCT g.id)::int AS visitors, count(DISTINCT g.converted_user_id)::int AS accounts
      FROM guest_presence g
      WHERE g.created_at >= now() - interval '35 days' AND (g.referrer IS NOT NULL OR g.utm_source IS NOT NULL)
      GROUP BY 1, 2`);
    await db.end();
    const fresh = new Set(r.rows.map((x) => x.day));
    for (const k of Object.keys(refs)) if (fresh.has(k.slice(0, 10))) delete refs[k];
    for (const x of r.rows) if (x.host && !NOT_WOM.test(x.host.replace(/^utm:/, "")) && !/chatgpt|openai|perplexity|copilot|gemini|claude|google|bing/i.test(x.host)) refs[`${x.day}|${x.host}`] = [x.visitors, x.accounts];
    const keep = iso(NOW - 400 * DAY); for (const k of Object.keys(refs)) if (k.slice(0, 10) < keep) delete refs[k];
    fs.writeFileSync(`${DIR}/referrers.json`, JSON.stringify(refs));
  } catch (e) { log.push("db: " + String(e).slice(0, 120)); }
} else log.push("db: no ANALYTICS_DB_URL");

// learn per source
const src = {}; let gV = 0, gA = 0;
for (const [k, [v, a]] of Object.entries(refs)) { const [d, h] = k.split("|"), age = (NOW - Date.parse(d + "T12:00:00Z")) / DAY;
  const o = (src[h] ??= { host: h, visitors: 0, accounts: 0, v7: 0, vPrev: 0, first: d, last: d }); o.visitors += v; o.accounts += a; gV += v; gA += a;
  if (age < 7) o.v7 += v; else if (age < 28) o.vPrev += v; if (d < o.first) o.first = d; if (d > o.last) o.last = d; }
const gAcc = (gA + 1) / (gV + 4), K = 15;
const sources = Object.values(src).map((o) => { const mu = 7 * Math.max(0.1, o.vPrev / 21), z = (o.v7 - mu) / Math.sqrt(mu);
  return { ...o, acc: +((o.accounts + K * gAcc) / (o.visitors + K)).toFixed(3), creator: CREATOR.test(o.host),
    rising: o.v7 >= 5 && o.v7 >= 2 * mu && z >= 2.5, isNew: NOW - Date.parse(o.first) < 7 * DAY, faded: o.visitors >= 5 && NOW - Date.parse(o.last) > 14 * DAY }; })
  .sort((a, b) => b.accounts - a.accounts || b.visitors - a.visitors);

// ── 2. Bing inbound links ─────────────────────────────────────────────────────────────────────────────────────────────
let links = [];
if (process.env.BING_API_KEY) {
  try {
    const u = `https://ssl.bing.com/webmaster/api.svc/json/GetLinkCounts?apikey=${process.env.BING_API_KEY}&siteUrl=${encodeURIComponent("https://crtlab.pro/")}&page=0`;
    const j = await fetch(u).then((r) => r.json()); links = (j.d?.Links ?? []).map((l) => ({ url: l.Url, count: l.Count })).slice(0, 200);
  } catch (e) { log.push("bing links: " + String(e).slice(0, 80)); }
}

// ── 3. talk: HN + Reddit ──────────────────────────────────────────────────────────────────────────────────────────────
const found = []; // { url, where, title, at }
const UA = { "user-agent": "crtlab-mentions/1.0 (read-only)" };
try { const j = await fetch("https://hn.algolia.com/api/v1/search_by_date?query=crtlab&tags=(story,comment)", { headers: UA }).then((r) => r.json());
  for (const h of j.hits ?? []) { const t = h.title || h.comment_text || ""; if (BRAND.test(t + " " + (h.url || ""))) found.push({ url: `https://news.ycombinator.com/item?id=${h.objectID}`, where: "hackernews", title: t.replace(/<[^>]+>/g, "").slice(0, 140), at: h.created_at }); } }
catch (e) { log.push("hn: " + String(e).slice(0, 80)); }
// Reddit: NOT scraped — its terms require the official OAuth API for automated reads (Kai 11-11: nothing shady, ever).
// Reddit posts that link to us still show up through (1) referrers and (4) web search.

// ── 4. web search (Mondays, or first run) ─────────────────────────────────────────────────────────────────────────────
if (process.env.OPENAI_API_KEY && (new Date().getUTCDay() === 1 || !state.lastWeb) && state.lastWeb !== iso(NOW)) {
  try {
    const body = { model: process.env.MENTIONS_MODEL || "gpt-5-mini", tools: [{ type: "web_search" }], include: ["web_search_call.action.sources"],
      input: "Find web pages, forum threads, YouTube videos, social posts or articles that mention CRTLAB (the trading backtesting / market replay tool at crtlab.pro), excluding crtlab.pro itself. List each as one line: URL — where — one short phrase on what it says. If you find none, say NONE." };
    const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); state.lastWeb = iso(NOW); state.webCost = +((state.webCost || 0) + 0.03).toFixed(2);
    const text = (j.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("\n");
    for (const m of text.matchAll(/https?:\/\/[^\s)\]]+/g)) { const url = m[0].replace(/[.,]+$/, ""); if (!/crtlab\.pro/i.test(url)) found.push({ url, where: "web " + new URL(url).hostname.replace(/^www\./, ""), title: (text.split("\n").find((l) => l.includes(url)) ?? "").replace(url, "").replace(/^[\s—–-]+/, "").slice(0, 140), at: new Date().toISOString() }); }
    if (!r.ok) log.push("web: HTTP " + r.status);
  } catch (e) { log.push("web: " + String(e).slice(0, 80)); }
}

// ── remember + alert ──────────────────────────────────────────────────────────────────────────────────────────────────
const fresh = [];
for (const f of found) if (!state.seen[f.url]) { state.seen[f.url] = iso(NOW); append(`${DIR}/mentions.jsonl`, { ...f, seen: iso(NOW) }); fresh.push(f); }
for (const l of links) { const k = "link:" + l.url; if (!state.seen[k]) { state.seen[k] = iso(NOW); if (Object.keys(state.seen).some((x) => x.startsWith("link:")) && state.linksBaselined) fresh.push({ url: l.url, where: "new backlink (Bing)", title: `${l.count} link(s)` }); } }
state.linksBaselined = true;
for (const s of sources.filter((x) => x.isNew && x.visitors >= 2)) { const k = "src:" + s.host; if (!state.seen[k]) { state.seen[k] = iso(NOW); fresh.push({ url: s.host, where: "new source sending people", title: `${s.visitors} visitors, ${s.accounts} accounts` }); } }
const rising = sources.filter((s) => s.rising);
const plan = { at: new Date().toISOString(), globalAcc: +gAcc.toFixed(3), sources: sources.slice(0, 40), rising, collab: sources.filter((s) => s.creator && s.visitors >= 2 && !s.faded).slice(0, 12),
  faded: sources.filter((s) => s.faded).slice(0, 10).map((s) => s.host), links: links.length, recent: readLines(`${DIR}/mentions.jsonl`).slice(-20), fresh, log, webCost: state.webCost };
fs.writeFileSync(`${DIR}/plan.json`, JSON.stringify(plan, null, 1));
append(`${DIR}/score.jsonl`, { day: iso(NOW), sources: sources.length, wom7: sources.reduce((t, s) => t + s.v7, 0), accounts: sources.reduce((t, s) => t + s.accounts, 0), mentions: Object.keys(state.seen).filter((k) => /^https?:/.test(k)).length, links: links.length });
if ((fresh.length || rising.length) && state.emailed !== iso(NOW) && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const text = [fresh.length ? `NEW (${fresh.length}):\n` + fresh.map((f) => `• ${f.where}: ${f.url}${f.title ? " — " + f.title : ""}`).join("\n") : "",
    rising.length ? `\nRISING sources (sending more people than their normal):\n` + rising.map((s) => `• ${s.host}: ${s.v7} visitors this week (normal ~${(s.vPrev / 3).toFixed(1)}/wk), ${s.accounts} accounts all-time`).join("\n") : "",
    plan.collab.length ? `\nCollab candidates (creators/communities already sending people):\n` + plan.collab.map((s) => `• ${s.host}: ${s.visitors} visitors, ${s.accounts} accounts`).join("\n") : ""].filter(Boolean).join("\n");
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB mentions: ${fresh.length} new${rising.length ? `, ${rising.length} rising` : ""}`, text }) }).catch(() => null);
  if (e?.ok) state.emailed = iso(NOW);
}
fs.writeFileSync(`${DIR}/state.json`, JSON.stringify(state));
console.log(`mentions: ${sources.length} sources (${rising.length} rising, ${plan.collab.length} collab) · ${found.length} found, ${fresh.length} new · ${links.length} link rows${log.length ? " · " + log.join(" | ") : ""}`);
