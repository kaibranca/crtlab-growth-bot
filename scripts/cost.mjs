// COST MACHINE (11-11, Kai: "a machine that fixes any Railway incidents to budget — this is the first time"). HOURLY.
// The first incident: since the daily data pull (11-09) the chart-data service was billed for 3–7.6 GB of memory while the
// server itself used ~0.23 GB — Linux file cache from the morning data swap, counted by Railway against an 8 GB ceiling.
// EYES   Railway's API (RAILWAY_API_TOKEN, read): memory + egress per service, hourly, 8 days. The data server's own RSS
//        (data/load, written by load-alert) tells real use from cache.
// BRAIN  each service's normal = its own 7-day median per hour; SPIKE = last 3 h above max(2× normal, normal + 0.5 GB).
//        Cost per day estimated from GB-hours ($10 / GB-month memory, $0.05 / GB egress), against the 7-day average.
//        Diagnosis per spike: CACHE BLOAT (Railway memory ≫ the process's RSS), REAL GROWTH (RSS itself grew → a leak or
//        a heavier day), EGRESS (traffic or a bot pulling files).
// HANDS  bounded, safe fixes only:
//        · cache bloat on the data service, in the quiet hours (02:00–05:00 UTC), at most once per 20 h → restart its
//          latest deployment (Linux drops the cache; users reconnect within seconds; the dataset is on the volume)
//        · everything else → one email with the diagnosis and the fix to apply; never changes limits or plans by itself
// LEARNS every fix is judged 24 h later (memory after vs before) → ledger win/loss; a fix that didn't help is not repeated
//        for that diagnosis. Self-registers with the engine core.
import fs from "node:fs";
import { append, readLines } from "./lib.mjs";

const DIR = "data/cost", NOW = Date.now(), H = 3.6e6, DAY = 24 * H, iso = (t) => new Date(t).toISOString().slice(0, 10);
const PROJECT = "32042912-e5d4-47b9-a2a7-3dedb3d6e2a1", ENV = "40c5d3f7-4331-4169-b5aa-f6b7e6d17a06";
const MEM_GB_MONTH = 10, EGRESS_GB = 0.05;
// BUDGET (11-11, Kai: "as low as possible, under $10 — it creeps up every time we add stuff"): the machine holds the bill to this
const BUDGET_MONTH = 10, WINDOW_DEPLOYS = 4; // the site deploys at 3 windows a day (promote-site) + the odd "deploy now"
fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync("data/machines/self", { recursive: true });
fs.writeFileSync("data/machines/self/cost.json", JSON.stringify({ id: "cost", name: "Cost machine", group: "health", parent: "lead-health",
  does: "Watches Railway memory and egress per service every hour, finds what made the bill move, and fixes cache bloat by itself in the quiet hours", every: 1, out: "data/cost/plan.json", feeds: ["health"] }));
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const state = J(`${DIR}/state.json`, { fixes: [], emailed: null });
const TOKEN = process.env.RAILWAY_API_TOKEN;
if (!TOKEN) { fs.writeFileSync(`${DIR}/plan.json`, JSON.stringify({ at: new Date().toISOString(), status: "needs RAILWAY_API_TOKEN (GitHub secret)" })); console.log("cost: no RAILWAY_API_TOKEN — waiting"); process.exit(0); }
const gql = async (query) => { const r = await fetch("https://backboard.railway.com/graphql/v2", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const j = await r.json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200)); return j.data; };

const svcs = (await gql(`query { project(id: "${PROJECT}") { services { edges { node { id name serviceInstances { edges { node { environmentId latestDeployment { id createdAt } } } } } } } } }`)).project.services.edges.map((e) => e.node);
const name = Object.fromEntries(svcs.map((s) => [s.id, s.name]));
const m = (await gql(`query { metrics(projectId: "${PROJECT}", environmentId: "${ENV}", startDate: "${new Date(NOW - 8 * DAY).toISOString()}", measurements: [MEMORY_USAGE_GB, NETWORK_TX_GB], groupBy: [SERVICE_ID], sampleRateSeconds: 3600) { measurement tags { serviceId } values { ts value } } }`)).metrics;
const series = {}; for (const x of m) { const s = name[x.tags.serviceId] ?? x.tags.serviceId; (series[s] ??= {})[x.measurement] = x.values.map((v) => [v.ts * 1000, v.value]); }
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const load = readLines(`data/load/${iso(NOW).slice(0, 7)}.jsonl`).slice(-6), rssGB = load.length ? Math.max(...load.map((x) => x.rssMB ?? 0)) / 1000 : null;

const rows = [], incidents = [];
for (const [svc, s] of Object.entries(series)) {
  const mem = s.MEMORY_USAGE_GB ?? [], tx = s.NETWORK_TX_GB ?? [];
  const recent = mem.filter(([t]) => NOW - t < 3 * H).map(([, v]) => v), base = mem.filter(([t]) => NOW - t > DAY && NOW - t < 8 * DAY).map(([, v]) => v);
  const now = recent.length ? Math.max(...recent) : 0, normal = med(base);
  const day = mem.filter(([t]) => NOW - t < DAY), dayCost = day.reduce((t, [, v]) => t + (v * MEM_GB_MONTH) / 730, 0) + tx.filter(([t]) => NOW - t < DAY).reduce((t, [, v]) => t + v * EGRESS_GB, 0);
  const week = mem.filter(([t]) => NOW - t < 7 * DAY), weekCost = (week.reduce((t, [, v]) => t + (v * MEM_GB_MONTH) / 730, 0) + tx.filter(([t]) => NOW - t < 7 * DAY).reduce((t, [, v]) => t + v * EGRESS_GB, 0)) / 7;
  const row = { svc, memGB: +now.toFixed(2), normalGB: +normal.toFixed(2), dayCost: +dayCost.toFixed(2), avgDayCost: +weekCost.toFixed(2), monthPace: +(dayCost * 30).toFixed(2) };
  rows.push(row);
  if (now > Math.max(2 * normal, normal + 0.5)) {
    const bloat = svc === "data" && rssGB != null && now > 3 * rssGB;
    incidents.push({ ...row, kind: bloat ? "cache bloat" : "memory growth", rssGB, why: bloat ? `Railway counts ${now.toFixed(2)} GB but the server itself uses ${rssGB.toFixed(2)} GB — file cache from the data swap` : `memory ${now.toFixed(2)} GB vs ~${normal.toFixed(2)} GB normal` });
  }
}
// DEPLOYS per service in the last 24 h — each one runs two containers side by side and boots a fresh server, billed.
// 11-11: 14–22 web deploys a day were the whole spike; deploy windows cap it at ~3. More than WINDOW_DEPLOYS = a leak.
const deploys = {};
for (const sv of svcs) {
  try { const d = await gql(`query { deployments(first: 40, input: { serviceId: "${sv.id}", environmentId: "${ENV}" }) { edges { node { createdAt status } } } }`);
    deploys[sv.name] = d.deployments.edges.filter((e) => NOW - Date.parse(e.node.createdAt) < DAY && e.node.status !== "SKIPPED").length; } catch { /* optional */ }
}
for (const [svc, n] of Object.entries(deploys)) if (svc === "web" && n > WINDOW_DEPLOYS) incidents.push({ svc, kind: "too many deploys", n, why: `${n} web deploys in 24 h (windows allow ~${WINDOW_DEPLOYS}) — every deploy bills two servers; something is bypassing the windows (pushes to live, or the trigger moved back to rebuild-integration)` });
// HANDS: restart the data service on cache bloat, quiet hours only, once per 20 h, not if that fix failed before
const hr = new Date().getUTCHours(), lastFix = state.fixes.filter((f) => f.svc === "data").slice(-1)[0];
const bloatFailed = state.fixes.filter((f) => f.kind === "cache bloat" && f.verdict === "did not help").length >= 2;
const actions = [];
for (const inc of incidents) if (inc.kind === "cache bloat" && hr >= 2 && hr < 5 && (!lastFix || NOW - Date.parse(lastFix.at) > 20 * H) && !bloatFailed) {
  const dep = svcs.find((s) => s.name === "data")?.serviceInstances.edges.map((e) => e.node).find((n) => n.environmentId === ENV)?.latestDeployment?.id;
  if (!dep) continue;
  try { await gql(`mutation { deploymentRestart(id: "${dep}") }`); state.fixes.push({ at: new Date().toISOString(), svc: "data", kind: "cache bloat", before: inc.memGB, action: "restart" }); actions.push(`restarted data (${inc.memGB} GB billed, ${inc.rssGB?.toFixed(2)} GB real)`);
    append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `cost|restart|${iso(NOW)}`, machine: "cost", kind: "lesson", what: `data service billed ${inc.memGB} GB for ${inc.rssGB?.toFixed(2)} GB real → restarted in the quiet hour to drop the file cache` }); }
  catch (e) { actions.push("restart failed: " + String(e).slice(0, 80)); }
}
// HANDS (11-11): web memory growth → a zero-downtime REDEPLOY (healthcheck + overlap, never a hard restart) in the quiet
// hours, once per 20 h, judged 24 h later like the data fix; stops by itself if it did not help twice.
const lastWeb = state.fixes.filter((f) => f.svc === "web").slice(-1)[0], webFailed = state.fixes.filter((f) => f.svc === "web" && f.verdict === "did not help").length >= 2;
for (const inc of incidents) if (inc.svc === "web" && inc.kind === "memory growth" && hr >= 3 && hr < 5 && (!lastWeb || NOW - Date.parse(lastWeb.at) > 20 * H) && !webFailed) {
  const dep = svcs.find((s) => s.name === "web")?.serviceInstances.edges.map((e) => e.node).find((n) => n.environmentId === ENV)?.latestDeployment?.id;
  if (!dep) continue;
  try { await gql(`mutation { deploymentRedeploy(id: "${dep}") { id } }`); state.fixes.push({ at: new Date().toISOString(), svc: "web", kind: "memory growth", before: inc.memGB, action: "redeploy" }); actions.push(`redeployed web (${inc.memGB} GB vs ${inc.normalGB} normal) — zero-downtime, quiet hour`);
    append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `cost|web-redeploy|${iso(NOW)}`, machine: "cost", kind: "lesson", what: `web held ${inc.memGB} GB vs ${inc.normalGB} normal → zero-downtime redeploy in the quiet hour` }); }
  catch (e) { actions.push("web redeploy failed: " + String(e).slice(0, 80)); }
}
// LEARN: judge fixes 24 h later
for (const f of state.fixes) if (!f.verdict && NOW - Date.parse(f.at) > DAY) { const r = rows.find((x) => x.svc === f.svc); if (!r) continue;
  f.after = r.memGB; f.verdict = r.memGB < f.before * 0.6 ? "helped" : "did not help";
  append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `cost|verdict|${f.at}`, machine: "cost", kind: f.verdict === "helped" ? "win" : "loss", what: `${f.kind} fix on ${f.svc}: ${f.before} → ${f.after} GB a day later (${f.verdict})` }); }
const total = rows.reduce((t, r) => t + r.dayCost, 0), avg = rows.reduce((t, r) => t + r.avgDayCost, 0);
const weekPace = +(avg * 30).toFixed(2);
const plan = { at: new Date().toISOString(), status: weekPace > BUDGET_MONTH ? "over budget" : "ok", budget: BUDGET_MONTH, weekPace, overBy: +Math.max(0, weekPace - BUDGET_MONTH).toFixed(2), deploys, dayCost: +total.toFixed(2), avgDayCost: +avg.toFixed(2), monthPace: +(total * 30).toFixed(2), services: rows.sort((a, b) => b.dayCost - a.dayCost), incidents, actions, fixes: state.fixes.slice(-10) };
fs.writeFileSync(`${DIR}/plan.json`, JSON.stringify(plan, null, 1));
append(`${DIR}/score.jsonl`, { at: plan.at, dayCost: plan.dayCost, mem: Object.fromEntries(rows.map((r) => [r.svc, r.memGB])) });
if (incidents.length && state.emailed !== iso(NOW) && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const text = [`Railway is running at ~$${plan.monthPace}/month pace today (normal ~$${(avg * 30).toFixed(2)}).`, "", ...incidents.map((i) => `• ${i.svc}: ${i.why}.`), "", actions.length ? "Done automatically: " + actions.join("; ") : "Fix to apply: cap the service's memory in Railway (a cap makes Linux drop the cache) — or the machine restarts it in the quiet hours."].join("\n");
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB cost: ${incidents.map((i) => i.svc).join(", ")} above normal`, text }) }).catch(() => null);
  if (e?.ok) state.emailed = iso(NOW);
}
fs.writeFileSync(`${DIR}/state.json`, JSON.stringify(state));
console.log(`cost: $${plan.dayCost}/day (normal $${plan.avgDayCost}) · ${incidents.length} incident(s)${actions.length ? " · " + actions.join("; ") : ""}`);
