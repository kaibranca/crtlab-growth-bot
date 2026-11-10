// AI MACHINE — EYES (11-10). What the machine could not see before, all free APIs:
//  A. BING INDEX per page (GetUrlInfo): when Bing last crawled each page that matters. ChatGPT search reads Bing's index, so a
//     page Bing hasn't re-crawled since a change is still the OLD page to ChatGPT (10-24: "paid only" copy → /backtest dropped).
//     Learns per family how long sent → crawled takes. Checks /backtest + / every run, then winners, convert targets and
//     the pages sent most recently (≤ 40 a run).
//  B. CLOUDFLARE: AI assistant requests per path at the EDGE, incl. those served from Cloudflare's cache that never reach
//     the site's own counter — so the machine's read counts can be corrected (coverage ratio).
// Writes data/ai/index.json + data/ai/edge.json; ai-machine.mjs reads both. Never touches the site.
import fs from "node:fs";
import { SITE, append } from "./lib.mjs";
const DAY = 86400000, NOW = Date.now(), iso = (t) => new Date(t).toISOString();
fs.mkdirSync("data/ai", { recursive: true });
const J = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);

// ── A. Bing index ─────────────────────────────────────────────────────────────────────────────────────────────────────
const IX = "data/ai/index.json", ix = J(IX, {});
const plan = J("data/ai/plan.json", null), sub = J("data/ai/submitted.json", {});
if (process.env.BING_API_KEY) {
  const want = new Set(["/backtest", "/"]);
  for (const x of plan?.winners ?? []) want.add(x.p);
  for (const x of plan?.convert ?? []) want.add(x.p);
  // recently sent, not yet seen crawled after the send
  for (const [p, at] of Object.entries(sub).sort((a, b) => b[1].localeCompare(a[1]))) { if (want.size >= 40) break; const c = ix[p]?.crawled; if (!c || c < at) want.add(p); }
  // anything checked less recently than 3 days, oldest first, to fill the run
  for (const p of Object.keys(ix).sort((a, b) => (ix[a].checkedAt ?? "").localeCompare(ix[b].checkedAt ?? ""))) { if (want.size >= 40) break; if (NOW - Date.parse(ix[p].checkedAt ?? 0) > 3 * DAY) want.add(p); }
  let ok = 0, fail = 0;
  for (const p of [...want].slice(0, 40)) {
    const url = SITE + (p === "/" ? "/" : p);
    const r = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/GetUrlInfo?siteUrl=${encodeURIComponent(SITE + "/")}&url=${encodeURIComponent(url)}&apikey=${process.env.BING_API_KEY}`).catch(() => null);
    const d = r && r.ok ? (await r.json()).d : null;
    if (!d) { fail++; if (fail <= 3) console.log("GetUrlInfo failed", p, r?.status, r ? (await r.text().catch(() => "")).slice(0, 200) : "network"); await new Promise((z) => setTimeout(z, 1500)); continue; }
    await new Promise((z) => setTimeout(z, 400)); // gentle: Bing throttles bursts
    ok++;
    const ms = (s) => { const m = /\/Date\((-?\d+)/.exec(s ?? ""); return m && +m[1] > 0 ? iso(+m[1]) : null; };
    const prev = ix[p] ?? {}, crawled = ms(d.LastCrawledDate), found = ms(d.DiscoveryDate);
    const hist = prev.hist ?? []; if (crawled && hist[hist.length - 1] !== crawled) hist.push(crawled);
    ix[p] = { crawled, found, http: d.HttpStatus ?? null, kb: d.DocumentSize ? Math.round(d.DocumentSize / 1024) : null, anchors: d.AnchorCount ?? null, checkedAt: iso(NOW), hist: hist.slice(-12), sentAt: sub[p] ?? null,
      // sent → crawled latency, the moment Bing crawls after a send
      lagH: sub[p] && crawled && crawled >= sub[p] ? +((Date.parse(crawled) - Date.parse(sub[p])) / 3.6e6).toFixed(1) : prev.lagH ?? null };
  }
  fs.writeFileSync(IX, JSON.stringify(ix));
  const bt = ix["/backtest"];
  console.log(`bing index: ${ok} checked, ${fail} failed · /backtest last crawled ${bt?.crawled ?? "?"} (found ${bt?.found ?? "?"}, http ${bt?.http ?? "?"})`);
} else console.log("bing index: no key");

// ── B. Cloudflare edge view of AI assistants ──────────────────────────────────────────────────────────────────────────
const T = process.env.CF_API_TOKEN, Z = process.env.CF_ZONE_ID;
if (T && Z) {
  const since = iso(NOW - 24 * 3.6e6), until = iso(NOW);
  const q = (ua) => `{viewer{zones(filter:{zoneTag:"${Z}"}){httpRequestsAdaptiveGroups(limit:500,filter:{datetime_geq:"${since}",datetime_lt:"${until}",userAgent_like:"%${ua}%"},orderBy:[count_DESC]){count dimensions{clientRequestPath cacheStatus}}}}}`;
  const out = { at: iso(NOW), window: "24h", bots: {} };
  for (const ua of ["ChatGPT-User", "OAI-SearchBot", "PerplexityBot", "Perplexity-User", "Claude-User", "bingbot"]) {
    const g = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { authorization: `Bearer ${T}`, "content-type": "application/json" }, body: JSON.stringify({ query: q(ua) }) }).then((r) => r.json()).catch((e) => ({ errors: [String(e)] }));
    if (g.errors?.length) { out.bots[ua] = { error: JSON.stringify(g.errors).slice(0, 240) }; continue; }
    const rows = g.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
    const paths = {}, cache = {}; let total = 0;
    for (const r of rows) { const p = r.dimensions.clientRequestPath; total += r.count; paths[p] = (paths[p] ?? 0) + r.count; cache[r.dimensions.cacheStatus] = (cache[r.dimensions.cacheStatus] ?? 0) + r.count; }
    out.bots[ua] = { total, cache, top: Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 60) };
  }
  fs.writeFileSync("data/ai/edge.json", JSON.stringify(out));
  append("data/ai/edge.jsonl", { at: out.at, totals: Object.fromEntries(Object.entries(out.bots).map(([k, v]) => [k, v.total ?? null])) });
  console.log("edge 24h:", JSON.stringify(Object.fromEntries(Object.entries(out.bots).map(([k, v]) => [k, v.error ? "ERR " + v.error.slice(0, 120) : { total: v.total, cache: v.cache }]))));
} else console.log("edge: no Cloudflare token");
