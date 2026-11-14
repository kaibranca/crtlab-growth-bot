// GUARD — node scripts/guard.mjs   (hourly; 2 small GETs a day + git log; no cost)
// The machine that owns STABILITY of what Google and ChatGPT see. Every other machine optimises its own number; this one makes
// sure their hands never add up to a site that changes constantly or grows thin pages (the spike-then-crash pattern).
//   CHANGE BUDGET  counts traffic-facing changes in the last 7 days (hook tests started/flipped, works tiers, llms list, site
//                  deploys that touched page code). More than BUDGET → writes data/machines/freeze.json for 7 days + emails Kai.
//   INVENTORY      once a day: URLs in /sitemap.xml and /sitemap-archive.xml → data/guard/inventory.jsonl. Alert when the
//                  indexable page count jumps (> 10% in a day or > 150 new URLs in 7 days) — scaled-content risk.
//   REPORT         data/guard/status.json (summary + /machine read it).
import fs from "node:fs"; import { execSync } from "node:child_process";
import { BUDGET, BUDGET_DAYS } from "./guard-lib.mjs";
const D = "data/guard", NOW = Date.now(), DAY = 864e5; fs.mkdirSync(D, { recursive: true });
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
const alerts = [];

// ── change budget: diff the page-affecting part of each file between its versions over the window ─────────────────────
const since = new Date(NOW - BUDGET_DAYS * DAY).toISOString();
const sig = { "data/ai/hooks.json": (j) => JSON.stringify((j.experiments || []).filter((e) => ["running", "won"].includes(e.status)).map((e) => [e.family, e.template, e.status, e.split, e.grain]).sort()),
  "data/works/plan.json": (j) => JSON.stringify(j.tiers || {}), "data/ai/llms.json": (j) => JSON.stringify((j.picks || []).map((p) => p.path || p).sort()) };
const changes = [];
for (const [f, fn] of Object.entries(sig)) {
  const revs = sh(`git log --since="${since}" --format="%H|%cI" -- ${f}`).trim().split("\n").filter(Boolean).reverse(); let prev = null;
  const base = sh(`git log -1 --before="${since}" --format=%H -- ${f}`).trim(); if (base) { try { prev = fn(JSON.parse(sh(`git show ${base}:${f}`))); } catch {} }
  for (const r of revs) { const [h, at] = r.split("|"); let s; try { s = fn(JSON.parse(sh(`git show ${h}:${f}`))); } catch { continue; } if (prev != null && s !== prev) changes.push({ at, what: f.split("/").pop() }); prev = s; }
}
// a RUNNING switchback flips a page every block by itself = a change every 2h/day → it alone exceeds any budget
for (const e of (J("data/ai/hooks.json", {}).experiments || []).filter((e) => e.status === "running" && e.mode === "switchback")) changes.push({ at: new Date().toISOString(), what: `switchback ${e.family} (flips every ${e.grain || "day"})` });
// llms.txt picks rotate by design (a "right now" list) — counted, but only hooks/tiers/deploys spend the budget
const spend = changes.filter((c) => c.what !== "llms.json");
// site deploys that touched page code (promote-site runs that actually deployed) — read from the bot's own deploy log if present
for (const x of (J("data/deploys.json", {}).list || []).filter((x) => Date.parse(x.at) > NOW - BUDGET_DAYS * DAY && x.pages)) spend.push({ at: x.at, what: "site deploy" });
// site deploys that touched traffic-facing areas (the timeline reads the live branch's commits + files)
for (const e of (J("data/machines/timeline.json", {}).events || []).filter((e) => e.kind === "site-deploy" && e.traffic && Date.parse(e.at) > NOW - BUDGET_DAYS * DAY)) spend.push({ at: e.at, what: `site deploy [${e.where}] ${e.what.slice(0, 50)}` });
const fz = J("data/machines/freeze.json", null), frozenNow = fz && NOW < Date.parse(fz.until);
if (spend.length > BUDGET && !frozenNow) {
  fs.writeFileSync("data/machines/freeze.json", JSON.stringify({ until: new Date(NOW + 7 * DAY).toISOString(), set: `${new Date().toISOString()} by guard (budget ${spend.length}/${BUDGET} in ${BUDGET_DAYS} d)`,
    why: "Too many traffic-facing changes to read any of them. Holding everything steady for 7 days.", holds: { hooks: "", bandit: "", llms: "", "sitemap-tiers": "" } }, null, 1));
  alerts.push(["guard-freeze", `GUARD froze traffic-facing machines for 7 days: ${spend.length} changes in ${BUDGET_DAYS} days (budget ${BUDGET}): ${spend.map((c) => c.what + " " + c.at.slice(5, 16)).join(", ")}.`]);
}

// ── inventory: once a day ────────────────────────────────────────────────────────────────────────────────────────────────
const INV = `${D}/inventory.jsonl`, inv = fs.existsSync(INV) ? fs.readFileSync(INV, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const today = new Date().toISOString().slice(0, 10);
if (!inv.some((x) => x.day === today)) {
  const count = async (u) => { try { const t = await (await fetch(u, { headers: { "User-Agent": "crtlab-guard/1.0" } })).text(); return (t.match(/<loc>/g) || []).length; } catch { return null; } };
  const row = { day: today, main: await count("https://crtlab.pro/sitemap.xml"), archive: await count("https://crtlab.pro/sitemap-archive.xml") };
  if (row.main != null) { fs.appendFileSync(INV, JSON.stringify(row) + "\n"); inv.push(row); }
  const y = inv.at(-2), w = inv.find((x) => x.day <= new Date(NOW - 7 * DAY).toISOString().slice(0, 10) && x.day > new Date(NOW - 9 * DAY).toISOString().slice(0, 10));
  const tot = (x) => (x?.main ?? 0) + (x?.archive ?? 0);
  if (y && row.main != null && Math.abs(row.main - y.main) > y.main * .1) alerts.push([`guard-sitemap-${today}`, `GUARD: main sitemap moved ${y.main} → ${row.main} URLs in a day. Sitemap churn confuses Google — check which machine did it.`]);
  if (w && tot(row) - tot(w) > 150) alerts.push([`guard-pages-${today}`, `GUARD: ${tot(row) - tot(w)} new URLs in 7 days (${tot(w)} → ${tot(row)}). Mass auto pages = Google scaled-content risk.`]);
}
// ── broken files: a machine file that doesn't parse silently switches its readers off (11-14: values.json was invalid for 4 h —
// the AI analyst read NO values). Every JSON the machines read is checked hourly; a broken one emails at once.
const broken = [];
for (const dir of ["data/machines", "data/ai", "data/works", "data/reels", "data/guard", "data/radar", "data/google"]) { if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) { try { JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")); } catch (e) { broken.push(`${dir}/${f}`); } } }
if (broken.length) alerts.push([`guard-broken-${broken.join(",").slice(0, 80)}`, `GUARD: ${broken.length} machine file(s) are BROKEN JSON — every machine reading them is running blind: ${broken.join(", ")}`]);
const st = { at: new Date().toISOString(), budget: { used: spend.length, of: BUDGET, days: BUDGET_DAYS, changes: spend.slice(-8), llmsRotations: changes.length - spend.length }, frozen: frozenNow ? fz.until : null, inventory: inv.at(-1) || null, broken, alerts: alerts.map((a) => a[1]) };
fs.writeFileSync(`${D}/status.json`, JSON.stringify(st, null, 1));
console.log("guard:", JSON.stringify(st.budget), "frozen", st.frozen, "inventory", JSON.stringify(st.inventory));
if (alerts.length) { try { await (await import("../reels/engine/alert.mjs")).send(alerts, "CRTLAB guard"); } catch (e) { console.log(String(e).slice(0, 120)); } }
