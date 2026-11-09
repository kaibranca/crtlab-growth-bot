// builds data/summary.json — the one small file the Control "Growth" board reads
import fs from "node:fs";
import { readLines, month } from "./lib.mjs";
// every month touched by the last 35 days (on 1 November that is Sep, Oct AND Nov — the old two-point pick skipped October)
const months = [...new Set(Array.from({ length: 36 }, (_, i) => month(new Date(Date.now() - i * 86400000))))].sort();
const wd = months.flatMap((m) => readLines(`data/watchdog/${m}.jsonl`));
const ai = months.flatMap((m) => readLines(`data/aicrawl/${m}.jsonl`));
const ix = readLines("data/indexnow.jsonl");
const rr = readLines("data/recap-runs.jsonl");
const seo = readLines("data/seo-changes.jsonl"), gw = readLines("data/gsc-weekly.jsonl"), bw = readLines("data/bing-weekly.jsonl");
const gaps = fs.existsSync("data/gaps.json") ? JSON.parse(fs.readFileSync("data/gaps.json", "utf8")).gaps : [];
const since = (d) => Date.now() - d * 86400000;
const up = (d) => { const w = wd.filter((x) => new Date(x.at) >= since(d)); return w.length ? +(100 * w.filter((x) => x.ok).length / w.length).toFixed(2) : null; };
const byDay = {};
for (const a of ai) { const day = a.to.slice(0, 10); byDay[day] = byDay[day] || {}; for (const [b, v] of Object.entries(a.bots)) byDay[day][b] = (byDay[day][b] || 0) + v.hits; }
const pages = {};
for (const a of ai.filter((x) => new Date(x.to) >= since(7))) for (const v of Object.values(a.bots)) for (const [p, n] of v.top) pages[p] = (pages[p] || 0) + n;
const last = wd[wd.length - 1];
const health = fs.existsSync("data/health.json") ? JSON.parse(fs.readFileSync("data/health.json", "utf8")) : null;
const links = fs.existsSync("data/linkcheck.json") ? JSON.parse(fs.readFileSync("data/linkcheck.json", "utf8")) : null;
// ACTIVITY: one line per thing the bot did, newest first — the Control board's live log
const act = [];
for (const w of wd) { const bad = w.results.filter((r) => !r.ok); const avg = Math.round(w.results.reduce((a, r) => a + r.ms, 0) / w.results.length);
  act.push({ at: w.at, job: "watchdog", ok: !bad.length, text: bad.length ? `${bad.length} of ${w.results.length} checks FAILED: ${bad.map((r) => r.name).join(", ")}` : `${w.results.length}/${w.results.length} checks pass · avg ${avg} ms` }); }
for (const a of ai) { const e = Object.entries(a.bots).sort((x, y) => y[1].hits - x[1].hits), n = e.reduce((s2, [, v]) => s2 + v.hits, 0);
  act.push({ at: a.to, job: "ai-crawl", ok: true, text: n ? `${n} crawler visits · ${e.slice(0, 4).map(([b, v]) => `${b} ${v.hits}`).join(" · ")}` : "no crawler visits this hour" }); }
for (const b of bw) act.push({ at: b.at, job: "bing", ok: true, text: `Bing: ${b.impr.toLocaleString()} impressions · ${b.clicks} clicks (28d) · ${b.buyerQueries} buyer-intent searches · ${b.changes} titles rewritten` });
for (const g of gw) act.push({ at: g.at, job: "search-console", ok: true, text: `${g.impr.toLocaleString()} impressions · ${g.clicks} clicks (28d) · ${g.changes} titles rewritten · ${g.gaps} gaps found` });
for (const c of seo) act.push({ at: c.at, job: c.kind === "change" ? "seo.title" : "seo.outcome", ok: c.verdict !== "reverted", text: c.kind === "change" ? `${c.path} → "${c.after.title ?? c.before.title}" (for "${c.query}")` : `${c.path}: CTR ${(c.ctrBefore * 100).toFixed(1)}% → ${(c.ctrAfter * 100).toFixed(1)}% · ${c.verdict}` });
for (const r of rr) act.push({ at: r.at, job: "recap", ok: !!r.latest, text: r.latest ? `published ${r.latest.date} · ${r.latest.headline}` : "no closed day to publish" });
for (const x of ix) act.push({ at: x.at, job: "indexnow", ok: !/HTTP [45]/.test(x.status), text: x.submitted ? `submitted ${x.submitted} changed pages · ${x.status}` : "no changed pages to submit" });
if (health) act.push({ at: health.at, job: "health", ok: !health.alerts.length, text: health.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}`).join(" · ") });
if (links) act.push({ at: links.at, job: "links", ok: !links.broken.length, text: `${links.checked} sitemap pages checked · ${links.broken.length} broken` });
// REELS + SHIELD (11-09): counts only (public repo) — the Growth board's "Reels" and "Shield" rows
const RD = "data/reels", jr = (f) => (fs.existsSync(`${RD}/${f}`) ? JSON.parse(fs.readFileSync(`${RD}/${f}`, "utf8")) : null);
const rlog = readLines(`${RD}/log.jsonl`).filter((x) => x.id), rmet = jr("metrics.json") || {}, rlive = !!(jr("live.json") || {}).live;
const plans = fs.existsSync(RD) ? fs.readdirSync(RD).filter((f) => /^plan-\d{4}-\d\d-\d\d\.json$/.test(f)).map((f) => jr(f)) : [];
const doneK = new Set(readLines(`${RD}/log.jsonl`).map((x) => `${x.plan}|${x.k}|${x.plat}`)), upcoming = [];
for (const p of plans) for (const r of p.reels || []) for (const plat of ["ig", "fb"]) if (!doneK.has(`${p.date}|${r.k}|${plat}`) && Date.parse(r[plat].at) > Date.now() - 3 * 3.6e6) upcoming.push({ plat, at: r[plat].at, title: r.title, mk: r.mk });
upcoming.sort((a, b) => a.at.localeCompare(b.at));
const views = (x) => { const m = rmet[x.id]; return m ? (x.plat === "ig" ? m.views : m.plays) ?? null : null; };
const r7 = rlog.filter((x) => Date.parse(x.postedAt) >= since(7));
const reels = { live: rlive, posted7d: { ig: r7.filter((x) => x.plat === "ig").length, fb: r7.filter((x) => x.plat === "fb").length },
  views7d: r7.reduce((s, x) => s + (views(x) || 0), 0), site7d: +r7.reduce((s, x) => s + (rmet[x.id]?.site || 0), 0).toFixed(1), signups7d: +r7.reduce((s, x) => s + (rmet[x.id]?.signups || 0), 0).toFixed(1),
  next: upcoming.slice(0, 4), last: rlog.slice(-6).reverse().map((x) => ({ at: x.postedAt, plat: x.plat, title: x.title, mk: x.mk, views: views(x), site: rmet[x.id]?.site ?? null, link: x.permalink })) };
for (const x of rlog.slice(-30)) act.push({ at: x.postedAt, job: "reels", ok: true, text: `posted "${x.title}" (${x.mk}) to ${x.plat === "ig" ? "Instagram" : "Facebook"}` });
const sh = fs.existsSync("data/shield.json") ? JSON.parse(fs.readFileSync("data/shield.json", "utf8")) : null;
const shield = sh && { at: sh.at, lastHour: sh.lastHour, blocked24h: (sh.history || []).filter((h) => Date.parse(h.at) >= since(1)).reduce((s, h) => s + h.blocked, 0), banned7d: (sh.history || []).filter((h) => Date.parse(h.at) >= since(7)).reduce((s, h) => s + h.banned, 0) };
if (sh) for (const h of (sh.history || []).slice(-24)) if (h.blocked || h.banned) act.push({ at: h.at, job: "shield", ok: true, text: `Cloudflare blocked ${h.blocked} attack request${h.blocked === 1 ? "" : "s"}${h.banned ? ` · banned ${h.banned} IP${h.banned === 1 ? "" : "s"} for 7 days` : ""}` });
act.sort((x, y) => (x.at < y.at ? 1 : -1));
fs.writeFileSync("data/summary.json", JSON.stringify({
  updated: new Date().toISOString(),
  watchdog: { up24h: up(1), up7d: up(7), up30d: up(30), last, incidents: wd.filter((x) => !x.ok).slice(-20).map((x) => ({ at: x.at, failed: x.results.filter((r) => !r.ok).map((r) => `${r.name} ${r.status}`) })),
    speed: Object.fromEntries((last?.results || []).map((r) => [r.name, r.ms])) },
  aicrawl: { byDay: Object.fromEntries(Object.entries(byDay).sort().slice(-30)), topPages7d: Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 20) },
  activity: act.slice(0, 80),
  seo: { bing: bw.slice(-26), weekly: gw.slice(-26), changes: seo.filter((c) => c.kind === "change").slice(-20), outcomes: seo.filter((c) => c.kind === "outcome").slice(-20), gaps: gaps.slice(0, 15) },
  health: health && { at: health.at, alerts: health.alerts, checks: health.checks, db: health.db, backup: health.backup, data: health.data, weight: health.weight, heavier: health.heavier },
  links: links && { at: links.at, checked: links.checked, broken: links.broken.slice(0, 20) },
  indexnow: ix.slice(-30).map((x) => ({ at: x.at, submitted: x.submitted, status: x.status })),
  reels, shield,
}, null, 1));
console.log("summary written");
