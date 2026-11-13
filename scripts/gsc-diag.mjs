// ONE-OFF DIAGNOSIS (11-10): why does Google send almost nothing? sitemaps, 90-day trend, index coverage per page type.
import crypto from "node:crypto";
import fs from "node:fs";
const SA = JSON.parse(process.env.GSC_SA_JSON || "{}");
const b64 = (x) => Buffer.from(x).toString("base64url");
const t = Math.floor(Date.now() / 1000);
const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = b64(JSON.stringify({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: t, exp: t + 3600 }));
const sig = crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(SA.private_key, "base64url");
const tk = (await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${body}.${sig}` })).json()).access_token;
const H = { authorization: `Bearer ${tk}`, "content-type": "application/json" };
const PROP = "sc-domain:crtlab.pro", P = encodeURIComponent(PROP);
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const q = async (b) => (await (await fetch(`https://www.googleapis.com/webmasters/v3/sites/${P}/searchAnalytics/query`, { method: "POST", headers: H, body: JSON.stringify(b) })).json()).rows ?? [];
const out = {};
out.sitemaps = (await (await fetch(`https://www.googleapis.com/webmasters/v3/sites/${P}/sitemaps`, { headers: H })).json()).sitemap?.map((s) => ({ path: s.path, last: s.lastDownloaded, errors: s.errors, warnings: s.warnings, contents: s.contents }));
const days = await q({ startDate: day(120), endDate: day(2), dimensions: ["date"], rowLimit: 200 });
const wk = {}; for (const r of days) { const w = r.keys[0].slice(0, 8) + (r.keys[0].slice(8) < "15" ? "a" : "b"); (wk[w] ??= { impr: 0, clicks: 0 }); wk[w].impr += r.impressions; wk[w].clicks += r.clicks; }
out.halfMonths = wk;
out.topPages = (await q({ startDate: day(90), endDate: day(2), dimensions: ["page"], rowLimit: 40 })).map((r) => [r.keys[0].replace("https://crtlab.pro", ""), r.impressions, r.clicks, +r.position.toFixed(1)]);
out.topQueries = (await q({ startDate: day(90), endDate: day(2), dimensions: ["query"], rowLimit: 60 })).map((r) => [r.keys[0], r.impressions, r.clicks, +r.position.toFixed(1)]);
out.countries = (await q({ startDate: day(90), endDate: day(2), dimensions: ["country"], rowLimit: 10 })).map((r) => [r.keys[0], r.impressions, r.clicks]);
out.pagesWithImpr = (await q({ startDate: day(90), endDate: day(2), dimensions: ["page"], rowLimit: 25000 })).length;
// sitemap URLs → sample per section → URL inspection
const locs = async (u) => [...(await (await fetch(u)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
let urls = await locs("https://crtlab.pro/sitemap.xml");
if (urls.every((u) => u.endsWith(".xml"))) { const all = []; for (const s of urls) all.push(...(await locs(s))); urls = all; }
const sec = {}; for (const u of urls) { const s = new URL(u).pathname.split("/")[1] || "(home)"; (sec[s] ??= []).push(u); }
out.sitemapSections = Object.fromEntries(Object.entries(sec).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]));
out.sitemapTotal = urls.length;
const sample = Object.values(sec).flatMap((v) => v.filter((_, i) => i % Math.max(1, Math.floor(v.length / 4)) === 0).slice(0, 4)).slice(0, +(process.env.INSPECT ?? 160)); // INSPECT=0: sitemaps/trend/queries only (the inspection loop is slow)
const insp = [];
for (const u of sample) {
  const r = await (await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", headers: H, body: JSON.stringify({ inspectionUrl: u, siteUrl: PROP }) })).json();
  const x = r.inspectionResult?.indexStatusResult ?? {};
  insp.push({ u: u.replace("https://crtlab.pro", ""), verdict: x.verdict, cov: x.coverageState, crawled: x.lastCrawlTime?.slice(0, 10), canon: x.googleCanonical && x.googleCanonical !== x.userCanonical ? x.googleCanonical : undefined, err: r.error?.message });
}
out.inspection = insp;
const cov = {}; for (const i of insp) cov[i.cov ?? i.err] = (cov[i.cov ?? i.err] ?? 0) + 1;
out.coverageSummary = cov;
fs.writeFileSync("gsc-diag.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ sitemapTotal: out.sitemapTotal, pagesWithImpr: out.pagesWithImpr, coverageSummary: cov, halfMonths: wk }, null, 1));
