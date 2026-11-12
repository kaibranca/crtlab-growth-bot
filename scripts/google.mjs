// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// GOOGLE MACHINE (11-12 — the ecosystem's biggest blind spot): Google sent 49 clicks / 27 accounts in 14 days (more accounts
// than Bing) while Search Console showed CRTLAB on ~25 of 2,834 pages. Nothing watched Google daily; the one diagnosis
// (gsc-diag, 11-10) hung on 160 untimed inspections and was cancelled. This one is bounded and cumulative:
//   EYES  search analytics, 28 d by page and page+query → where Google shows us, the position, the near-misses (8–20)
//   EYES  index coverage: 40 sitemap URLs a run, oldest-inspected first, spread over families; 12 s per call, 120 s total.
//         The verdicts accumulate in data/google/index.json, so coverage per family + WHY (each reason = a different fix)
//         sharpens every day without a big run.
//   BRAIN data/google/plan.json — totals, coverage by family, the top reason Google skips each family, rank targets, queries.
//         The content + traffic brains and the Fixer read it. Read-only API scope; never touches the site.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import crypto from "node:crypto";
import fs from "node:fs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/google", T0 = Date.now();
if (!process.env.GSC_SA_JSON) { console.log("google: no GSC_SA_JSON — skipped"); process.exit(0); }
const J = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const SA = JSON.parse(process.env.GSC_SA_JSON);
const b64 = (x) => Buffer.from(x).toString("base64url"), t = Math.floor(NOW / 1000);
const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = b64(JSON.stringify({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: t, exp: t + 3600 }));
const sig = crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(SA.private_key, "base64url");
const tk = (await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${body}.${sig}`, signal: AbortSignal.timeout(15000) })).json()).access_token;
if (!tk) { console.log("google: no token"); process.exit(0); }
const H = { authorization: `Bearer ${tk}`, "content-type": "application/json" };
const PROP = "sc-domain:crtlab.pro", P = encodeURIComponent(PROP), day = (n) => new Date(NOW - n * DAY).toISOString().slice(0, 10);
const q = async (b) => { try { const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${P}/searchAnalytics/query`, { method: "POST", headers: H, body: JSON.stringify(b), signal: AbortSignal.timeout(30000) }); const j = await r.json(); if (j.error) console.log("google: query error", j.error.message?.slice(0, 120)); return j.rows ?? []; } catch (e) { console.log("google: query failed", String(e).slice(0, 80)); return []; } };
const strip = (u) => u.replace(/^https:\/\/(www\.)?crtlab\.pro/, "") || "/";
const family = (p) => { const s = p.split("/").filter(Boolean); if (!s.length) return "/"; if (s.length === 1) return /^[a-z]{3,6}usd$|^(nas100|us30|sp500|ger40|usoil)$/.test(s[0]) ? "/<market>" : /-backtest/.test(s[0]) ? "/<x>-backtest…" : `/${s[0]}`; return `/${s[0]}/<…>`; };
fs.mkdirSync(OUT, { recursive: true });

// ── 1. SEARCH ANALYTICS (28 d; Google's data lags ~2 days) ────────────────────────────────────────────────────────────
const range = { startDate: day(30), endDate: day(2) };
const byPage = (await q({ ...range, dimensions: ["page"], rowLimit: 5000 })).map((r) => ({ p: strip(r.keys[0]), impr: r.impressions, clicks: r.clicks, pos: +r.position.toFixed(1) }));
const byPQ = (await q({ ...range, dimensions: ["page", "query"], rowLimit: 5000 })).map((r) => ({ p: strip(r.keys[0]), q: r.keys[1], impr: r.impressions, clicks: r.clicks, pos: +r.position.toFixed(1) }));
// CTR by position (a standard curve, conservative) → clicks a page would get at #3 = what it is missing
const ctrAt = (pos) => (pos <= 1 ? 0.28 : pos <= 2 ? 0.16 : pos <= 3 ? 0.11 : pos <= 5 ? 0.07 : pos <= 10 ? 0.03 : 0.01);
const rank = byPage.filter((x) => x.pos > 3.5 && x.pos <= 20 && x.impr >= 10).map((x) => ({ page: x.p, pos: x.pos, impr: x.impr, clicks: x.clicks, missed: +Math.max(0, x.impr * ctrAt(3) - x.clicks).toFixed(1),
  queries: byPQ.filter((r) => r.p === x.p).sort((a, b) => b.impr - a.impr).slice(0, 3).map((r) => r.q) })).sort((a, b) => b.missed - a.missed).slice(0, 25);

// ── 2. INDEX COVERAGE, ROTATING (bounded — the 11-10 diagnosis hung on 160 untimed calls) ────────────────────────────
const IX = J(`${OUT}/index.json`, {});
const locs = async (u) => { try { return [...(await (await fetch(u, { signal: AbortSignal.timeout(20000) })).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]); } catch { return []; } };
let urls = await locs("https://crtlab.pro/sitemap.xml");
if (urls.length && urls.every((u) => u.endsWith(".xml"))) { const all = []; for (const s of urls) all.push(...(await locs(s))); urls = all; }
const fams = {}; for (const u of urls) (fams[family(strip(u))] ??= []).push(u);
// oldest-inspected first, round-robin over families so every family's picture fills in
const queues = Object.values(fams).map((v) => [...v].sort((a, b) => (Date.parse(IX[strip(a)]?.at ?? 0) - Date.parse(IX[strip(b)]?.at ?? 0))));
const pick = []; for (let i = 0; pick.length < 40 && queues.some((qq) => qq.length > i); i++) for (const qq of queues) if (qq[i] && NOW - Date.parse(IX[strip(qq[i])]?.at ?? 0) > 14 * DAY && pick.length < 40) pick.push(qq[i]);
let inspected = 0, inspErr = null;
for (const u of pick) {
  if (Date.now() - T0 > 120000) break;
  try { const r = await (await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", headers: H, body: JSON.stringify({ inspectionUrl: u, siteUrl: PROP }), signal: AbortSignal.timeout(12000) })).json();
    if (r.error) { inspErr = r.error.message?.slice(0, 120); if (/quota|rate/i.test(inspErr)) break; continue; }
    const x = r.inspectionResult?.indexStatusResult ?? {};
    IX[strip(u)] = { at: new Date().toISOString(), verdict: x.verdict ?? null, cov: x.coverageState ?? null, crawled: x.lastCrawlTime?.slice(0, 10) ?? null, ...(x.googleCanonical && x.userCanonical && x.googleCanonical !== x.userCanonical ? { canon: strip(x.googleCanonical) } : {}) }; inspected++;
  } catch { /* one slow call never stops the run */ }
}
const live = new Set(urls.map(strip)); for (const k of Object.keys(IX)) if (!live.has(k)) delete IX[k]; // bin pages that left the sitemap
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(IX));

// ── 3. BRAIN: coverage by family + WHY, rank targets, totals ─────────────────────────────────────────────────────────
const shown = new Set(byPage.filter((x) => x.impr > 0).map((x) => x.p));
const coverage = Object.entries(fams).map(([f, v]) => { const ins = v.map(strip).filter((p) => IX[p]); const ok = ins.filter((p) => IX[p].verdict === "PASS").length; const why = {};
  for (const p of ins) if (IX[p].verdict !== "PASS") why[IX[p].cov ?? "unknown"] = (why[IX[p].cov ?? "unknown"] ?? 0) + 1;
  const top = Object.entries(why).sort((a, b) => b[1] - a[1])[0];
  return { family: f, pages: v.length, inspected: ins.length, indexed: ok, indexedPct: ins.length ? Math.round((ok / ins.length) * 100) : null, shownByGoogle: v.map(strip).filter((p) => shown.has(p)).length, topReason: top ? `${top[0]} (${top[1]})` : null, canonicalMismatch: ins.filter((p) => IX[p].canon).length };
}).sort((a, b) => b.pages - a.pages);
const insAll = Object.values(IX), reasons = {}; for (const x of insAll) if (x.verdict !== "PASS") reasons[x.cov ?? "unknown"] = (reasons[x.cov ?? "unknown"] ?? 0) + 1;
const plan = { at: new Date().toISOString(), window: `${range.startDate}..${range.endDate}`,
  totals: { impr: byPage.reduce((a, x) => a + x.impr, 0), clicks: byPage.reduce((a, x) => a + x.clicks, 0), pagesShown: shown.size, sitemapPages: urls.length, inspected: insAll.length, indexed: insAll.filter((x) => x.verdict === "PASS").length },
  reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ reason: k, n })), coverage, rank, pagePos: Object.fromEntries(byPage.map((x) => [x.p, x.pos])),
  topQueries: [...byPQ].sort((a, b) => b.impr - a.impr).slice(0, 30).map((r) => ({ q: r.q, p: r.p, impr: r.impr, clicks: r.clicks, pos: r.pos })), run: { inspected, inspErr } };
fs.writeFileSync(`${OUT}/plan.json`, JSON.stringify(plan, null, 1));
fs.appendFileSync(`${OUT}/days.jsonl`, JSON.stringify({ day: day(0), impr: plan.totals.impr, clicks: plan.totals.clicks, shown: plan.totals.pagesShown, indexedPct: insAll.length ? Math.round((plan.totals.indexed / insAll.length) * 100) : null, inspected: insAll.length }) + "\n");
console.log(`google: ${plan.totals.impr} impressions / ${plan.totals.clicks} clicks (28 d) on ${shown.size} of ${urls.length} sitemap pages · inspected ${inspected} this run (${insAll.length} total, ${plan.totals.indexed} indexed)${inspErr ? ` · inspect error: ${inspErr}` : ""} · top reasons: ${plan.reasons.slice(0, 3).map((r) => `${r.reason} ${r.n}`).join(", ") || "—"} · ${rank.length} rank targets`);
