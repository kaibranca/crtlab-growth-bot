// TIMELINE — node scripts/timeline.mjs   (hourly; a few GitHub API calls, cached; no cost)
// Kai 11-14: "machines only go through the data they can get, not everything on CRTLAB — give them context so they make better
// decisions." Each machine saw its own slice: the works engine judged a page family without knowing a deploy or a hook test hit
// it that week, so causes got mixed (10-24 could never be traced). THE TIMELINE is one record of every change in the ecosystem —
// what changed, when, where, traffic-facing or not — that every machine and the AI analyst read:
//   site deploys (commits that reached branch live, with the page areas they touched) · data releases · bot traffic-facing
//   changes (hooks, sitemap tiers) · freeze on/off · Google noindex / sitemap submits · reels posted · guard/failures verdicts
// → data/machines/timeline.json (45 days). scripts/timeline-lib.mjs: changesNear(area, from, to) so a verdict can say
//   "confounded: something else changed here" instead of crediting the wrong cause.
import fs from "node:fs";
const OUT = "data/machines/timeline.json", NOW = Date.now(), DAY = 864e5, KEEP = 45 * DAY;
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const L = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const prev = J(OUT, { events: [], seen: {} }), seen = prev.seen || {}, ev = (prev.events || []).filter((e) => NOW - Date.parse(e.at) < KEEP);
const add = (e) => { const k = `${e.kind}|${e.at}|${e.what}`.slice(0, 200); if (seen[k]) return; seen[k] = 1; ev.push(e); };

// 1. site deploys: commits on branch live (private repo, GH_WATCH_TOKEN); files fetched once per new commit
const TOK = process.env.GH_WATCH_TOKEN;
const AREA = (f) => /^app\/\(site\)\/page|^app\/page|components\/home|lib\/aiHooks|lib\/bandit/.test(f) ? "/" : /backtest/.test(f) ? "/backtest*" : /next\.config|sitemap|robots|llms/.test(f) ? "indexing" :
  /^app\/\(site\)\/([^/]+)/.test(f) ? "/" + f.match(/^app\/\(site\)\/([^/]+)/)[1] : /^app\/\(bt\)|components\/chart|lib\/chart/.test(f) ? "app" : /^app\/api|^lib\/emails|scripts\//.test(f) ? "backend" : "other";
if (TOK) { const H = { authorization: `Bearer ${TOK}`, accept: "application/vnd.github+json", "user-agent": "crtlab-timeline" };
  try { const cs = await (await fetch(`https://api.github.com/repos/kaibranca/crtlab-standalone/commits?sha=live&per_page=40&since=${new Date(NOW - KEEP).toISOString()}`, { headers: H })).json();
    let calls = 0;
    for (const c of Array.isArray(cs) ? cs : []) { const k = `site|${c.sha}`; if (seen[k] || calls >= 15) continue; calls++;
      const d = await (await fetch(c.url, { headers: H })).json(), files = (d.files || []).map((f) => f.filename), areas = [...new Set(files.map(AREA))];
      seen[k] = 1; ev.push({ at: c.commit.committer.date, kind: "site-deploy", where: areas.join(" "), what: c.commit.message.split("\n")[0].slice(0, 140), traffic: areas.some((a) => !["app", "backend", "other"].includes(a)) }); } }
  catch (e) { console.log("timeline: site commits skipped", String(e).slice(0, 80)); } }
// 2. data releases (the live data version changes once a day)
try { const v = await (await fetch("https://crtlab.pro/api/data-version", { headers: { "User-Agent": "crtlab-timeline" }, signal: AbortSignal.timeout(8000) })).json();
  if (v?.live) add({ at: new Date(NOW).toISOString().slice(0, 13) + ":00:00Z", kind: "data-release", where: "data", what: `data ${v.live} through ${v.end}`, traffic: false, key: v.live }); } catch {}
// dedupe data releases by version
{ const byV = new Map(); for (const e of ev.filter((x) => x.kind === "data-release")) if (!byV.has(e.key) || e.at < byV.get(e.key).at) byV.set(e.key, e); for (let i = ev.length - 1; i >= 0; i--) if (ev[i].kind === "data-release" && byV.get(ev[i].key) !== ev[i]) ev.splice(i, 1); }
// 3. bot traffic-facing changes, as the guard measured them
for (const c of J("data/guard/status.json", {}).budget?.changes || []) add({ at: c.at, kind: "machine-change", where: c.what.includes("plan") ? "sitemap" : "hooks", what: c.what, traffic: true });
// 4. freeze, sitemap submits
const fz = J("data/machines/freeze.json", null); if (fz?.until) add({ at: (fz.set || "").slice(0, 10) + "T00:00:00Z", kind: "freeze", where: "all traffic-facing", what: `freeze until ${fz.until.slice(0, 10)}`, traffic: true });
for (const m of J("data/google/sitemaps.json", {}).maps || []) if (m.submitted) add({ at: m.submitted, kind: "sitemap-submit", where: "indexing", what: `submitted ${m.path}`, traffic: true });
// 5. reels posted
for (const x of L("data/reels/log.jsonl").filter((x) => x.id && x.postedAt)) add({ at: x.postedAt, kind: "reel", where: x.plat, what: `"${x.title}" ${x.mk} ${x.model}`, traffic: false });
// 6. verdicts (ledger wins/losses)
for (const x of L("data/machines/ledger.jsonl").filter((x) => x.kind === "win" || x.kind === "loss")) add({ at: x.at, kind: x.kind, where: x.machine, what: String(x.what || "").slice(0, 140), traffic: false });

ev.sort((a, b) => a.at.localeCompare(b.at));
const traffic7 = ev.filter((e) => e.traffic && NOW - Date.parse(e.at) < 7 * DAY);
fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), note: "Every change in the ecosystem, 45 days. Read it before judging any result: was it this, or something else that changed here?", traffic7: traffic7.length, events: ev.slice(-600), seen: Object.fromEntries(Object.keys(seen).slice(-3000).map((k) => [k, 1])) }, null, 1));
console.log(`timeline: ${ev.length} events (45 d), ${traffic7.length} traffic-facing in 7 d; by kind`, JSON.stringify(ev.reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {})));
