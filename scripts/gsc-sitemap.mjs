// SITEMAP → GOOGLE (11-13). gsc-diag found NO sitemap submitted in Search Console (sitemaps: none) — 2,837 pages in
// https://crtlab.pro/sitemap.xml and Google reported "URL is unknown to Google" for ~3 of every 4 sampled pages: it only finds
// what it happens to crawl through links. This submits the sitemap (idempotent: re-submitting asks Google to re-read it) and
// records what Google says back (last downloaded, submitted/indexed counts, errors) → data/google/sitemaps.json, so the
// machines can see the moment Google starts reading it. Needs the service account as an OWNER/FULL user on sc-domain:crtlab.pro.
import crypto from "node:crypto";
import fs from "node:fs";
const SA = JSON.parse(process.env.GSC_SA_JSON || "{}");
if (!SA.client_email) { console.log("gsc-sitemap: no GSC_SA_JSON"); process.exit(0); }
const b64 = (x) => Buffer.from(x).toString("base64url"), t = Math.floor(Date.now() / 1000);
const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = b64(JSON.stringify({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/webmasters", aud: "https://oauth2.googleapis.com/token", iat: t, exp: t + 3600 }));
const sig = crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(SA.private_key, "base64url");
const tok = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${body}.${sig}` })).json();
if (!tok.access_token) { console.log("gsc-sitemap: token failed", JSON.stringify(tok).slice(0, 200)); process.exit(1); }
const H = { authorization: `Bearer ${tok.access_token}` };
const PROP = encodeURIComponent("sc-domain:crtlab.pro"), MAP = "https://crtlab.pro/sitemap.xml";
const put = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${PROP}/sitemaps/${encodeURIComponent(MAP)}`, { method: "PUT", headers: H });
const putTxt = put.ok ? "ok" : `${put.status} ${(await put.text()).slice(0, 300)}`;
console.log(`gsc-sitemap: submit ${MAP} → ${putTxt}`);
const list = await (await fetch(`https://www.googleapis.com/webmasters/v3/sites/${PROP}/sitemaps`, { headers: H })).json();
const maps = (list.sitemap ?? []).map((s) => ({ path: s.path, submitted: s.lastSubmitted, downloaded: s.lastDownloaded ?? null, pending: s.isPending, errors: +(s.errors ?? 0), warnings: +(s.warnings ?? 0), contents: (s.contents ?? []).map((c) => ({ type: c.type, submitted: +(c.submitted ?? 0), indexed: c.indexed != null ? +c.indexed : null })) }));
for (const m of maps) console.log(`  ${m.path} submitted ${m.submitted} · downloaded ${m.downloaded ?? "not yet"} · ${m.contents.map((c) => `${c.submitted} ${c.type}`).join(", ")} · errors ${m.errors}`);
fs.mkdirSync("data/google", { recursive: true });
const prev = (() => { try { return JSON.parse(fs.readFileSync("data/google/sitemaps.json", "utf8")); } catch { return {}; } })();
fs.writeFileSync("data/google/sitemaps.json", JSON.stringify({ at: new Date().toISOString(), submit: putTxt, sitemaps: maps, firstSubmitted: prev.firstSubmitted ?? (put.ok ? new Date().toISOString() : null) }, null, 1));
if (!put.ok) process.exit(1);
