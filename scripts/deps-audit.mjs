// DEPS AUDIT (11-12): the security brain read Dependabot alerts with a token that can't see them (404) → it was the last
// "needs you" (Kai: "they keep piling up, fix it"). Now the machine audits the site's own lockfile (sparse checkout via the
// deploy key, daily) against npm's public advisory DB — the same source `npm audit` uses. No token, no owner step.
// Output data/security/deps.json { at, open, high, critical, top: [{name, severity, title, fix}] } — read by brains.mjs.
import fs from "node:fs";
const LOCK = process.argv[2] || "site/package-lock.json", OUT = "data/security/deps.json";
if (!fs.existsSync(LOCK)) { console.log("deps-audit: no lockfile at", LOCK); process.exit(0); }
const lock = JSON.parse(fs.readFileSync(LOCK, "utf8")), body = {};
for (const [k, v] of Object.entries(lock.packages ?? {})) { if (!k || !v.version) continue; const n = k.split("node_modules/").pop(); (body[n] ??= []).includes(v.version) || body[n].push(v.version); }
const r = await fetch("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
if (!r.ok) { console.log("deps-audit: npm advisory API", r.status); process.exit(0); }
const j = await r.json(), seen = new Set(), adv = [];
for (const [name, xs] of Object.entries(j)) for (const x of xs) { const id = x.id ?? x.url; if (seen.has(id)) continue; seen.add(id); adv.push({ name, severity: x.severity, title: String(x.title ?? "").slice(0, 90), vulnerable: x.vulnerable_versions, url: x.url }); }
// direct deps get named first: those are the ones a build session upgrades (transitives follow their parent)
const direct = new Set([...Object.keys(lock.packages?.[""]?.dependencies ?? {}), ...Object.keys(lock.packages?.[""]?.devDependencies ?? {})]);
const rank = { critical: 4, high: 3, moderate: 2, low: 1 };
adv.sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0) || (direct.has(b.name) - direct.has(a.name)));
const out = { at: new Date().toISOString(), source: "npm advisory DB × site package-lock.json", packages: Object.keys(body).length, open: adv.length,
  high: adv.filter((x) => x.severity === "high").length, critical: adv.filter((x) => x.severity === "critical").length,
  direct: adv.filter((x) => direct.has(x.name)).length, top: adv.slice(0, 12).map((x) => ({ ...x, direct: direct.has(x.name) })) };
fs.mkdirSync("data/security", { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`deps-audit: ${out.packages} packages · ${out.open} advisories (${out.critical} critical, ${out.high} high, ${out.direct} on direct deps)`);
