// ENGINE CORE (11-11, Kai: "the ecosystem itself is one massive machine — linked, sharing data, surge mode on a surge, the
// opposite on a dip, every new machine added automatically; the frontend is run by an engine"). HOURLY, after the AI machine.
// Reads every machine's own output files (no database, no site request — zero backend strain) and writes:
//   data/machines/ecosystem.json  the whole web: machines as nodes (branches = fractal children), data links as edges with
//                                 live activity weights, a live activity feed, mode, ledger, mistakes, fix list → /machine
//   data/machines/mode.json       the GLOBAL MODE every machine reads next run: normal · SURGE · DIP (recovery), with the
//                                 bounded parameters it learned from past episodes
//   data/machines/modes.jsonl     each mode episode: start, end, reads/clicks before vs during → verdict → parameter nudge
// AUTO-ADD: a future machine registers itself by writing data/machines/self/<id>.json {id,name,group,parent,does,every,
// out,feeds}; any data/<dir>/plan.json nobody registered shows up as "discovered". No list to keep by hand.
import fs from "node:fs";
import { readLines, append } from "./lib.mjs";
import { splitNeeds } from "./needs.mjs";

const NOW = Date.now(), H = 3.6e6, DAY = 24 * H, iso = (t) => new Date(t).toISOString().slice(0, 10);
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const lastAt = (f) => { const l = readLines(f).slice(-1)[0]; return l?.at ? Date.parse(l.at) : null; };
const atOf = (f) => { const j = J(f), t = j?.at ?? j?.last?.at ?? j?.changed; return t ? Date.parse(t) : null; }; // last.at = holdout.json (11-12: it read "never")
const month = iso(NOW).slice(0, 7);

// ── 1. THE REGISTRY: every machine and branch, what it does, what it feeds ────────────────────────────────────────────
// group: core · traffic · content · people · guard. parent = the machine it is a branch of. t() = its last run.
const ai = J("data/ai/plan.json") ?? {}, men = J("data/mentions/plan.json"), sup = J("data/machines/status.json");
const aiT = atOf("data/ai/plan.json");
const REG = [
  { id: "core", name: "Engine core", group: "core", does: "Links every machine, sets the mode (normal / surge / dip), learns from each episode", every: 1, t: () => NOW, feeds: ["ai", "factory", "mentions"] },
  { id: "mode", name: "Mode engine", group: "core", parent: "core", does: "Surge → every machine pushes harder; dip → recovery: winners re-sent first", every: 1, t: () => NOW, feeds: ["bing", "sisters", "curator"] },
  { id: "supervisor", name: "Supervisor", group: "core", parent: "core", does: "Watches every machine: alive, late or stopped, and each one's score week on week", every: 1, t: () => atOf("data/machines/status.json"), feeds: ["core"] },
  { id: "mistakes", name: "Mistakes watch", group: "core", parent: "supervisor", does: "Every failed run or quietly failed step, counted; repeats are emailed", every: 1, t: () => atOf("data/machines/status.json"), feeds: ["supervisor"] },
  { id: "ledger", name: "Ledger", group: "core", parent: "supervisor", does: "Remembers every win, loss and lesson so no machine repeats a losing move", every: 1, t: () => atOf("data/machines/status.json"), feeds: ["ai", "core"] },

  { id: "ai", name: "AI referral machine", group: "traffic", does: "Learns which pages ChatGPT reads, clicks and turns into accounts, and spends Bing's quota on them", every: 1, t: () => aiT, feeds: ["bing", "curator", "factory"] },
  { id: "eyes", name: "Eyes", group: "traffic", parent: "ai", does: "Bing index status and Cloudflare's count of every AI read", every: 1, t: () => atOf("data/ai/edge.json"), feeds: ["ai"] },
  { id: "surge", name: "Surge detector", group: "traffic", parent: "ai", does: "A page read far above its own normal in 24 h → ×4 and Bing first", every: 1, t: () => aiT, feeds: ["sisters", "mode"] },
  { id: "rising", name: "Early traction", group: "traffic", parent: "ai", does: "Pages climbing over 3 days → ×2.5, re-sent while they climb", every: 1, t: () => aiT, feeds: ["sisters", "mode"] },
  { id: "sisters", name: "Sister spread", group: "traffic", parent: "ai", does: "A hot page lifts its neighbours: same release on other markets, same market on other releases", every: 1, t: () => aiT, feeds: ["bing"] },
  { id: "lift", name: "Release lift", group: "traffic", parent: "ai", does: "Learns how much each release is asked about around its day; pages go to Bing 3 days early", every: 1, t: () => aiT, feeds: ["bing"] },
  { id: "weekly", name: "Weekly cycle", group: "traffic", parent: "ai", does: "Which page types peak on which weekday; lifted the day before", every: 1, t: () => aiT, feeds: ["bing"] },
  { id: "trend", name: "4-week trend", group: "traffic", parent: "ai", does: "Page types growing for weeks get more quota, fading ones less", every: 1, t: () => aiT, feeds: ["bing"] },
  { id: "yield", name: "Failure learning", group: "traffic", parent: "ai", does: "Bing sends that led to no read cut that type's quota", every: 1, t: () => aiT, feeds: ["bing"] },
  { id: "hooks", name: "Hook tests", group: "traffic", parent: "ai", does: "A/B tests one sentence on page halves, judged by itself; losing wording never retried", every: 1, t: () => aiT, feeds: ["ledger"] },
  { id: "bing", name: "Bing sender", group: "traffic", parent: "ai", does: "Sends the day's most valuable pages to Bing — the index ChatGPT searches", every: 1, t: () => lastAt("data/ai/runs.jsonl") },
  { id: "curator", name: "llms.txt curator", group: "traffic", parent: "ai", does: "Puts the pages that matter right now at the top of llms.txt for AI assistants", every: 1, t: () => atOf("data/ai/llms.json") },
  { id: "truth", name: "Truth gate", group: "traffic", parent: "ai", does: "Reads key pages as ChatGPT does; contradictions hold every verdict until fixed", every: 6, t: () => atOf("data/ai/truth.json"), feeds: ["hooks"] },
  { id: "traffic-brain", link: "traffic", name: "Traffic brain ↗", group: "core", parent: "core", does: "The traffic engine's own brain: modes, neurons, convergence, memory + bin; builds and judges traffic branches hourly (its own web on /machine → Traffic)", every: 1, t: () => atOf("data/traffic/ecosystem.json"), feeds: ["bing"] },
  { id: "brains", name: "Brains (money · data · security · content · retention · speed)", group: "core", parent: "core", does: "Six more brains on the same framework as the traffic brain; each judged on its own outcome; all on /machine and the CRTLAB super-core", every: 1, t: () => atOf("data/brains/index.json") },
  { id: "analyst", name: "AI analyst", group: "core", does: "Reads every machine daily (gpt-4.1-mini, ~$0.10/month); findings tied to real numbers + ≤2 focus picks the core judges", every: 24, t: () => atOf("data/analyst/plan.json"), feeds: ["core"] },
  { id: "radar", name: "AI radar", group: "traffic", does: "Asks AI the real buyer questions daily; who wins the answer", every: 24, t: () => atOf("data/radar/plan.json"), feeds: ["ai"] },
  { id: "indexnow", name: "IndexNow", group: "traffic", does: "Tells Bing and others the moment a page changes", every: 24, t: () => lastAt("data/indexnow.jsonl") },
  { id: "seo", name: "Search console", group: "traffic", does: "Google + Bing weekly: queries, pages, title rewrites", every: 168, t: () => lastAt("data/gsc-weekly.jsonl"), feeds: ["factory"] },

  // 11-12 OVERCLOCK — the new machines, watched by the supervisor like every other (late / stopped → the Fixer)
  { id: "world", name: "World model", group: "core", parent: "core", does: "Forecasts every page every day and credits every action type against untouched pages (bootstrap CI) — a verdict per action per day; true surges hourly; the curve", every: 1, t: () => atOf("data/world/surges.json"), feeds: ["ai", "traffic-brain", "executive"] },
  { id: "executive", name: "Executive", group: "core", parent: "core", does: "Finds the funnel's constraint (reach → click → sign-up → pay) and turns every engine's knob toward it; judges each focus period", every: 24, t: () => atOf("data/machines/executive.json"), feeds: ["bandit", "ai", "traffic-brain"] },
  { id: "memory", name: "Long-term memory", group: "core", parent: "ledger", does: "Nightly: every engine's verdicts consolidated into durable facts (decay, contradictions flagged) — the analyst's memory", every: 24, t: () => atOf("data/machines/knowledge.json"), feeds: ["analyst"] },
  { id: "bandit", name: "Conversion bandit", group: "conversion", does: "ReplayHook wording per page × day on news + calendar, Thompson sampling on clicks per people-fetch, transfer across families", every: 1, t: () => atOf("data/ai/bandit.json"), feeds: ["ledger"] },
  { id: "holdout", name: "Holdout", group: "traffic", parent: "ai", does: "5% of pages never pushed — the honest measure of what pushing adds", every: 1, t: () => atOf("data/ai/holdout.json") },
  { id: "lockin", name: "Lock-in", group: "core", parent: "mode", does: "A wave of people, sign-ups or AI people-reads locks the whole system in: Bing all-in, hands off, deploys held", every: 1, t: () => (fs.existsSync("data/machines/lockin.json") ? fs.statSync("data/machines/lockin.json").mtimeMs : null) },
  { id: "selfcheck", name: "People self-check", group: "health", parent: "health", does: "Verifies the people number itself: heartbeat vs stay share per device, raw-surge composition (flood / instrument / leaving)", every: 1, t: () => atOf("data/machines/humans.json") },
  { id: "deployjudge", name: "Deploy judge", group: "health", parent: "health", does: "Every site deploy judged 24 h later on real people's stay share; regressions get the rollback in the Fixer queue", every: 1, t: () => atOf("data/machines/deploy-judge.json") },
  { id: "google", name: "Google machine", group: "traffic", parent: "seo", does: "Google search analytics + rotating index coverage per family, and why Google skips pages", every: 24, t: () => atOf("data/google/plan.json") },
  { id: "recommend", name: "Recommendation engine", group: "traffic", parent: "radar", does: "How often ChatGPT names CRTLAB in buyer answers, who it names instead, the sources it trusts; lost questions' pages go to Bing; judged on the naming rate", every: 1, t: () => atOf("data/radar/recommend.json"), feeds: ["ai", "executive"] },
  { id: "factory", name: "Reaction factory", group: "content", does: "How each market reacts to each release: 129 pages, rebuilt the morning after every release", every: 24, t: () => lastAt("data/recap-runs.jsonl"), feeds: ["ai", "indexnow"] },
  { id: "news", name: "News engine", group: "content", parent: "factory", does: "Every release measured on 12 markets minute by minute, same day", every: 24, t: () => lastAt("data/recap-runs.jsonl"), feeds: ["factory"] },
  { id: "recaps", name: "Daily recaps", group: "content", parent: "factory", does: "Each market's day written from the data", every: 24, t: () => lastAt("data/recap-runs.jsonl"), feeds: ["indexnow"] },
  { id: "linkcheck", name: "Link check", group: "content", does: "Every internal link on the site, weekly", every: 168, t: () => atOf("data/linkcheck.json") },
  { id: "social", name: "Reels", group: "content", does: "Instagram + Facebook reels from the day's biggest moves", every: 24, t: () => atOf("data/reels/status.json") ?? lastAt("data/reels/log.jsonl") },

  { id: "mentions", name: "Mentions machine", group: "traffic", does: "Who sends people, links to or talks about CRTLAB; rising sources and collab candidates", every: 24, t: () => atOf("data/mentions/plan.json"), feeds: ["core"] },
  { id: "behaviour", name: "Behaviour machine", group: "conversion", does: "First-day actions that bring people back, and where they leave, per device", every: 24, t: () => atOf("data/behaviour/plan.json") },
  { id: "devices", name: "Device QA", group: "conversion", does: "Every key page on phone, iPad and desktop, light and dark", every: 24, t: () => atOf("data/mobile/report.json") },

  { id: "health", name: "Health", group: "health", does: "Database, page weight and costs, hourly", every: 1, t: () => atOf("data/health.json") },
  { id: "watchdog", name: "Watchdog", group: "health", parent: "health", does: "Key pages answer and how fast", every: 1, t: () => lastAt(`data/watchdog/${month}.jsonl`) },
  { id: "load", name: "Load alert", group: "health", parent: "health", does: "Server queue and slow chart loads", every: 1, t: () => lastAt(`data/load/${month}.jsonl`) },
  { id: "shield", name: "Shield", group: "security", does: "Cloudflare patterns, bad bots banned", every: 1, t: () => atOf("data/shield.json") },
  { id: "security", name: "Login + key watch", group: "security", parent: "shield", does: "Admin logins and key exposure checks", every: 24, t: () => atOf("data/security-known.json") },
  { id: "datapull", name: "Data pull", group: "health", does: "Pulls every market's new 1-minute candles each morning so the replay is always current; health checks the newest candle", every: 24, t: () => { const c = (J("data/health.json")?.checks ?? []).find((x) => /market data/i.test(x.name)); return c ? atOf("data/health.json") : null; } },
  { id: "backup", name: "Nightly backup", group: "health", parent: "health", does: "Database backed up every night; restore test proves it comes back", every: 24, t: () => atOf("data/health.json") },
  { id: "calendar", name: "Economic calendar", group: "content", does: "Every upcoming release with forecasts, refreshed daily — what the release pages and Bing timing run on", every: 24, t: () => atOf("data/events/upcoming.json"), feeds: ["lift", "factory"] },
  { id: "indicators", name: "Indicator pages", group: "content", parent: "calendar", does: "346 indicator pages kept current from the calendar history", every: 24, t: () => atOf("data/indicators/index.json") },
  { id: "livenews", name: "Same-day news", group: "content", parent: "news", does: "A release page goes up the same day it drops, crypto measured live", every: 1, t: () => atOf("data/events/upcoming-run.json") ?? atOf("data/events/upcoming.json") },
  { id: "gaps", name: "Search gaps", group: "traffic", parent: "seo", does: "Queries people search where CRTLAB has no good page yet", every: 168, t: () => atOf("data/gaps.json"), feeds: ["factory"] },
  { id: "bingseo", name: "Bing webmaster", group: "traffic", parent: "seo", does: "Bing clicks, impressions and buyer queries weekly", every: 168, t: () => atOf("data/bing.json") },
  { id: "capacity", name: "Capacity", group: "health", parent: "health", does: "How many people the server holds at once: peak in flight, memory, requests shed — warns before a rush hits the ceiling", every: 1, t: () => lastAt(`data/load/${month}.jsonl`) },
  { id: "bin", name: "Bin", group: "core", parent: "core", does: "Throws out data no machine needs any more (old logs, stale history) so files stay small and every page stays fast", every: 1, t: () => NOW },
  { id: "wall", name: "Wall + checkout", group: "conversion", parent: "behaviour", does: "Daily limit hit → plan view → checkout: where buyers leak, by device", every: 24, t: () => atOf("data/behaviour/plan.json") },
  { id: "restore", name: "Restore test", group: "health", parent: "health", does: "Proves the database backup restores", every: 168, t: () => atOf("data/restore.json") },
];
// self-registered machines (future ones write data/machines/self/<id>.json) + discovered plan files
const selfDir = "data/machines/self";
for (const f of fs.existsSync(selfDir) ? fs.readdirSync(selfDir).filter((x) => x.endsWith(".json")) : []) {
  const m = J(`${selfDir}/${f}`); if (m?.id && !REG.some((r) => r.id === m.id)) REG.push({ ...m, t: () => (m.out ? atOf(m.out) ?? lastAt(m.out) : null) });
}
const covered = new Set(["ai", "behaviour", "radar", "mentions", "mobile", "machines", "reels", "events", "recaps", "cost", "leak", "world", "google"]);
for (const d of fs.readdirSync("data", { withFileTypes: true }).filter((x) => x.isDirectory() && !covered.has(x.name)))
  if (fs.existsSync(`data/${d.name}/plan.json`)) REG.push({ id: d.name, name: d.name, group: "core", does: "Discovered: writes a plan the core has not been told about yet", every: 24, t: () => atOf(`data/${d.name}/plan.json`), discovered: true });

{ const seenIds = new Set(); for (let i = REG.length - 1; i >= 0; i--) { if (seenIds.has(REG[i].id)) REG.splice(i, 1); else seenIds.add(REG[i].id); } }
// ── 2. LIVE ACTIVITY: what each machine just did ─────────────────────────────────────────────────────────────────────
const feed = []; const ev = (t, m, text, kind = "do") => { if (t && NOW - t < 3 * DAY) feed.push({ t: new Date(t).toISOString(), m, text, kind }); };
for (const r of readLines("data/ai/runs.jsonl").slice(-60)) if (r.submitted) ev(Date.parse(r.at), "bing", `sent ${r.submitted} pages to Bing`);
for (const s of readLines("data/ai/surges.jsonl").slice(-40)) ev(Date.parse(s.at), s.kind === "rising" ? "rising" : "surge", s.kind === "rising" ? `${s.key} climbing — ${s.last3d} reads in 3 days` : `${s.key} surging — ${s.last24h} reads vs ${s.normal}/day`, "hot");
for (const x of (ai.sisters ?? []).slice(0, 8)) ev(aiT, "sisters", `lifted ${x.p} (next to ${x.of})`);
for (const x of readLines(`data/watchdog/${month}.jsonl`).slice(-48)) if (!x.ok) ev(Date.parse(x.at), "watchdog", `a key page failed: ${(x.results ?? []).filter((r) => !r.ok).map((r) => r.name).join(", ")}`, "bad");
for (const x of readLines("data/indexnow.jsonl").slice(-10)) if (x.submitted) ev(Date.parse(x.at), "indexnow", `${x.submitted} changed pages announced (${x.status})`);
for (const x of readLines("data/recap-runs.jsonl").slice(-6)) ev(Date.parse(x.at), "recaps", `published ${x.published ?? 0} recap(s)${x.latest?.headline ? " — " + x.latest.headline.slice(0, 70) : ""}`);
for (const x of readLines("data/machines/ledger.jsonl").slice(-30).filter((y) => y.kind !== "surge")) ev(Date.parse(x.at), x.machine === "supervisor" ? "mistakes" : "ledger", x.what, x.kind === "win" ? "win" : x.kind === "loss" || x.kind === "mistake" ? "bad" : "do");
for (const x of men?.fresh ?? []) ev(Date.parse(men.at), "mentions", `${x.where}: ${x.url}`, "win");
for (const x of readLines("data/ai/changes.jsonl").slice(-10)) ev(Date.parse(x.at), "factory", x.what);
for (const x of readLines("data/machines/modes.jsonl").slice(-10)) ev(Date.parse(x.at), "mode", x.text, x.mode === "surge" ? "hot" : x.mode === "dip" ? "bad" : "do");
{ const t = J("data/ai/truth.json"); if (t) ev(Date.parse(t.at), "truth", (t.bad ?? []).length ? `${t.bad.length} contradiction(s) found` : "site consistent — no contradictions", (t.bad ?? []).length ? "bad" : "do"); }
for (const x of readLines("data/reels/log.jsonl").slice(-5)) ev(Date.parse(x.at ?? x.t ?? 0), "social", x.what ?? x.msg ?? "reel step", "do");
// LIVE AI READS: every logged window of ChatGPT / Claude / Perplexity reading CRTLAB pages (last 12 h) — the real pulse
{ const BOT = { "ChatGPT-User": "ChatGPT", "Claude-User": "Claude", "Perplexity-User": "Perplexity", "MistralAI-User": "Mistral", OAI_SearchBot: "ChatGPT search", "OAI-SearchBot": "ChatGPT search", bingbot: "Bing", Googlebot: "Google" };
  const wins = [month, iso(NOW - DAY).slice(0, 7)].filter((v, i, x) => x.indexOf(v) === i).flatMap((m) => readLines(`data/aicrawl/${m}.jsonl`)).filter((w) => NOW - Date.parse(w.to) < 12 * 3600e3);
  for (const w of wins) for (const [bot, v] of Object.entries(w.bots ?? {})) { const who = BOT[bot]; if (!who) continue;
    for (const [p0, n] of (v.top ?? []).slice(0, 2)) { const p = p0.split("?")[0]; if (/^\/(api|_next|favicon)/.test(p)) continue;
      feed.push({ t: w.to, m: /Bing|Google/.test(who) ? "eyes" : "ai", text: `${who} read ${p}${n > 1 ? ` ×${n}` : ""}`, kind: /ChatGPT$|Claude|Perplexity/.test(who) ? "hot" : "do" }); } } }
// every machine run in the last 24 h is an event too
for (const m of REG) { let t = null; try { t = m.t(); } catch { t = null; } if (t && NOW - t < DAY && t < NOW - 60e3 && m.every >= 1) feed.push({ t: new Date(t).toISOString(), m: m.id, text: "ran", kind: "run" }); }
feed.sort((a, b) => (a.t < b.t ? 1 : -1));

// ── 3. MODE: the whole ecosystem's state, from live AI reads (24 h vs its own 14-day normal) ──────────────────────────
const LIVE = /ChatGPT-User|Claude-User|Perplexity-User|MistralAI-User/;
const crawl = [month, iso(NOW - 15 * DAY).slice(0, 7)].filter((v, i, a) => a.indexOf(v) === i).flatMap((m) => readLines(`data/aicrawl/${m}.jsonl`));
let r24 = 0, rBase = 0; const t0 = crawl.length ? Date.parse(crawl[0].from) : NOW;
for (const w of crawl) { const age = NOW - Date.parse(w.to); if (age > 15 * DAY) continue; let n = 0; for (const [b, v] of Object.entries(w.bots)) if (LIVE.test(b)) n += v.hits ?? 0; if (age < DAY) r24 += n; else rBase += n; }
const baseDays = Math.max(1, Math.min(14, (NOW - t0) / DAY - 1)), mu = Math.max(1, rBase / baseDays), z = +((r24 - mu) / Math.sqrt(mu)).toFixed(1);
const pageSurges = (ai.surges ?? []).filter((s) => s.kind === "page").length;
const old = J("data/machines/mode.json", { mode: "normal", since: new Date(0).toISOString(), params: {} });
const P = { surgeCap: 0.8, sisterTop: 5, recoveryN: 20, ...(old.params ?? {}) };
// PEOPLE FIRST (11-11): AI crawler reads can surge while real visitors fall (that day the engine said "surge" with people
// down 30%). A people dip from humans.mjs puts the engine in RECOVERY whatever the reads do — and says which segment fell.
const HU = (() => { try { return JSON.parse(fs.readFileSync("data/machines/humans.json", "utf8")); } catch { return null; } })();
const peopleDip = !!HU && HU.state === "dip" && NOW - Date.parse(HU.at) < 3 * H;
let mode = peopleDip ? "dip" : z >= 3 || pageSurges >= 3 ? "surge" : z <= -2.5 && mu >= 30 ? "dip" : "normal";
// hysteresis: stay in a mode at least 3 hours, so one quiet hour doesn't flip it back
if (mode !== old.mode && NOW - Date.parse(old.since) < 3 * H) mode = old.mode;
const why = peopleDip ? `people down: ${HU.visitors.now} visitors in 24 h vs ~${HU.visitors.normal} (sign-ups ${HU.signups.now} vs ~${HU.signups.normal})${HU.why.length ? " — fell most: " + HU.why.slice(0, 3).join("; ") : ""}${z >= 3 ? ` · AI reads still ${r24} vs ~${Math.round(mu)}` : ""}` : mode === "surge" ? `${pageSurges} pages surging · AI reads ${r24} in 24 h vs ~${Math.round(mu)}/day (z ${z})` : mode === "dip" ? `AI reads ${r24} in 24 h vs ~${Math.round(mu)}/day (z ${z}) — recovery: winners first` : `AI reads ${r24} in 24 h vs ~${Math.round(mu)}/day`;
// episode learning: when a surge/dip ends, compare reads per hour during it vs the 24 h before it started → nudge the
// bounded parameter that mode controls (surge: Bing share + sister reach; dip: how many winners are re-sent)
if (mode !== old.mode) {
  const ep = { at: new Date().toISOString(), mode, from: old.mode, text: `mode ${old.mode} → ${mode}: ${why}`, r24, mu: Math.round(mu) };
  if (old.mode !== "normal" && old.startMu != null) {
    const hrs = Math.max(1, (NOW - Date.parse(old.since)) / H), during = (old.startR24 != null ? r24 : 0) / 24, before = old.startMu / 24, paid = before ? during / before : 1;
    ep.verdict = paid >= 1.2 ? "paid" : paid <= 0.9 ? "did not pay" : "flat"; ep.ratio = +paid.toFixed(2); ep.hours = +hrs.toFixed(1);
    const step = ep.verdict === "paid" ? 1 : ep.verdict === "did not pay" ? -1 : 0;
    if (old.mode === "surge") { P.surgeCap = +Math.max(0.6, Math.min(0.9, P.surgeCap + 0.05 * step)).toFixed(2); P.sisterTop = Math.max(3, Math.min(8, P.sisterTop + step)); }
    if (old.mode === "dip") P.recoveryN = Math.max(10, Math.min(40, P.recoveryN + 5 * step));
    ep.text += ` · last ${old.mode} ${ep.verdict} (×${ep.ratio})`;
  }
  append("data/machines/modes.jsonl", ep);
}
// ── 3a. THE ENGINE LEARNS FROM ITSELF (meta-learning, bounded, logged) ───────────────────────────────────────────────
// SURGE PRECISION: of the page surges it pushed (≥ 48 h ago, last 30 days), how many brought at least one AI click within
// 2 days? Precision (shrunk toward 50% with K 10) sets how hard surges are pushed next: surgeBoost 2…6 (default 4).
{ const CL = J("data/ai/clicks.json", {}), clickDays = new Map();
  for (const [k, [vis]] of Object.entries(CL)) { if (!vis) continue; const [d, , p0] = k.split("|"); const p = (p0 || "/").replace(/\/$/, "") || "/"; (clickDays.get(p) ?? clickDays.set(p, new Set()).get(p)).add(d); }
  const judged = readLines("data/ai/surges.jsonl").filter((x) => x.kind === "page" && NOW - Date.parse(x.at) > 2 * DAY && NOW - Date.parse(x.at) < 30 * DAY);
  const hit = judged.filter((x) => { const d0 = Date.parse(x.at); const ds = clickDays.get(x.key); if (!ds) return false; for (const d of ds) { const t = Date.parse(d + "T12:00:00Z"); if (t >= d0 - DAY / 2 && t <= d0 + 2 * DAY) return true; } return false; }).length;
  const prec = (hit + 5) / (judged.length + 10), boost = +Math.max(2, Math.min(6, 2 + prec * 4)).toFixed(2);
  if (judged.length >= 3 && Math.abs(boost - (P.surgeBoost ?? 4)) >= 0.25) append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `meta|surge|${iso(NOW)}`, machine: "core", kind: "lesson", what: `surges brought clicks ${hit}/${judged.length} times → surge push set to ×${boost}` });
  P.surgeBoost = judged.length >= 3 ? boost : P.surgeBoost ?? 4; P.surgePrecision = +prec.toFixed(2); P.surgeJudged = judged.length; }
// SISTER PAYOFF: every sister page the AI machine lifted is logged; 3 days later its live AI reads (3 d after vs 3 d before)
// say whether spreading paid. Paid more than half the time → reach one more sister group (max 8); less than a quarter → one fewer (min 3).
{ const SL = "data/machines/sisters.jsonl", logged = readLines(SL), seenK = new Set(logged.map((x) => x.p + x.d));
  for (const x of ai.sisters ?? []) if (!seenK.has(x.p + iso(NOW))) append(SL, { d: iso(NOW), p: x.p, of: x.of });
  const readsIn = (p, from, to) => { let n = 0; for (const w of crawl) { const t = Date.parse(w.to); if (t < from || t >= to) continue; for (const [b, v] of Object.entries(w.bots)) if (LIVE.test(b)) for (const [p0, k] of v.top) if (p0.split("?")[0] === p) n += k; } return n; };
  const due = readLines(SL).filter((x) => !x.judged && NOW - Date.parse(x.d + "T12:00:00Z") > 3 * DAY);
  let paid = 0; for (const x of due) { const t0 = Date.parse(x.d + "T12:00:00Z"), after = readsIn(x.p, t0, t0 + 3 * DAY), before = readsIn(x.p, t0 - 3 * DAY, t0); x.judged = after > before ? "paid" : "flat"; if (after > before) paid++; }
  if (due.length) { const all = readLines(SL).map((x) => due.find((y) => y.p === x.p && y.d === x.d) ?? x); fs.writeFileSync(SL, all.slice(-3000).map((x) => JSON.stringify(x)).join("\n") + "\n");
    const rate = paid / due.length, was = P.sisterTop; if (due.length >= 5) { if (rate > 0.5) P.sisterTop = Math.min(8, P.sisterTop + 1); else if (rate < 0.25) P.sisterTop = Math.max(3, P.sisterTop - 1); }
    append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `meta|sisters|${iso(NOW)}`, machine: "core", kind: rate > 0.5 ? "win" : rate < 0.25 ? "loss" : "lesson", what: `sister pages paid ${paid}/${due.length} times${P.sisterTop !== was ? ` → spread to ${P.sisterTop} hot pages` : ""}` }); }
  P.sisterPaid = due.length ? +(paid / due.length).toFixed(2) : P.sisterPaid ?? null; }

// ── 3b. LOCK-IN (11-12, Kai: "anything abnormal — a spike or a wave — is our golden ticket: the WHOLE system locks in") ──
// One detector, one file every engine obeys (data/machines/lockin.json). Triggers on REAL people (3 h vs the same 3 h of
// 14 days — never raw hits: a bot flood is the shield's, not a ticket), on sign-ups, or on a people-fetch surge in AI
// answers. While on: Bing all-in on the wave's pages, the traffic brain pushes harder, the cost machine keeps its hands
// off, deploy windows hold, the shield needs 3× the flood to challenge anyone, Kai gets one email. Every wave is
// remembered (waves.jsonl) and judged on sign-ups during it vs normal; each trigger's bar learns from its own record.
{ const LF = "data/machines/lockin.json", L0 = J(LF, { on: false, bars: {} }), bars = { people: 2, signups: 2.5, ai: 2, spike: 1, ...(L0.bars ?? {}) };
  const W = HU?.wave, fresh = W && NOW - Date.parse(HU.at) < 2 * H, trig = [];
  if (fresh && W.visitors.now >= 6 && (W.visitors.ratio ?? 0) >= bars.people && W.visitors.z >= 3) trig.push({ kind: "people", why: `${W.visitors.now} real visitors in 3 h vs ~${W.visitors.normal} (×${W.visitors.ratio})${W.riding?.[0] ? ` — riding ${W.riding[0].dim} ${W.riding[0].seg} (${W.riding[0].now} vs ~${W.riding[0].normal})` : ""}` });
  // 11-12: the sign-up trigger had no strength test (people/AI need z ≥ 3–4) — 7 vs ~2.1 at z 1.8 (ordinary day-to-day
  // noise) held lock-in on for 7 h while real visitors were BELOW normal. Now it needs z ≥ 2.5 like a real wave.
  if (fresh && W.signups.now >= 3 && (W.signups.ratio ?? 0) >= bars.signups && (W.signups.z ?? 0) >= 2.5) trig.push({ kind: "signups", why: `${W.signups.now} sign-ups in 3 h vs ~${W.signups.normal} (×${W.signups.ratio})` });
  // AI: a RATIO to normal, not z alone — reads grew ×20 in a month, so z vs the 14-day mean stays high on ordinary days
  // SENTINEL (cron worker, every 5 min at the edge): a 15-minute people-fetch spike arrives as SPIKE — locks in within minutes,
  // aimed at the spiking pages (the 24 h numbers would take hours to move)
  let SP = null; try { SP = process.env.SPIKE ? JSON.parse(process.env.SPIKE) : null; } catch { SP = null; }
  if (SP?.pages?.length) trig.unshift({ kind: "spike", why: `edge sentinel: ${String(SP.why ?? "people-fetch spike").slice(0, 160)}`, pages: SP.pages.slice(0, 8) });
  if (r24 >= mu * bars.ai && z >= 4 && !peopleDip) trig.push({ kind: "ai", why: `people asking AI about CRTLAB pages: ${r24} in 24 h vs ~${Math.round(mu)} (×${(r24 / mu).toFixed(1)})` });
  const signNow = HU?.signups?.now ?? 0, minH = 6;
  let L = { ...L0, bars };
  if (trig.length && !L0.on) { L = { on: true, since: new Date().toISOString(), kind: trig[0].kind, triggers: trig.map((t) => t.kind), why: trig.map((t) => t.why).join(" · "), bars,
      startSignups24: signNow, normalSignups24: HU?.signups?.normal ?? null, peak: W?.visitors?.ratio ?? null, targets: [...new Set([...(trig.find((t) => t.pages)?.pages ?? []), ...(ai.surges ?? []).filter((x) => x.kind === "page").map((x) => x.key), ...(old.targets ?? [])])].slice(0, 12), emailed: false };
    append("data/machines/ledger.jsonl", { at: L.since, key: `lockin|${L.since}`, machine: "core", kind: "lesson", what: `LOCK-IN on (${L.kind}): ${L.why}` }); }
  else if (L0.on) { L.peak = Math.max(L0.peak ?? 0, W?.visitors?.ratio ?? 0); L.why = trig.length ? trig.map((t) => t.why).join(" · ") : L0.why; L.quiet = trig.length ? 0 : (L0.quiet ?? 0) + 1;
    // ends after 6 h minimum and 2 quiet hours; judged on sign-ups in the 24 h since it began vs the normal day
    // SAFETY: 48 h hard cap — a stuck trigger can never hold deploys for days; hitting it counts as a false alarm (bar rises)
    const capped = NOW - Date.parse(L0.since) >= 48 * H;
    if ((NOW - Date.parse(L0.since) >= minH * H && L.quiet >= 2) || capped) { const hrs = (NOW - Date.parse(L0.since)) / H, normal = Math.max(1, L0.normalSignups24 ?? 1), got = signNow, ratio = +(got / normal).toFixed(2);
      const verdict = capped && ratio < 1.3 ? "false alarm" : ratio >= 1.3 ? "paid" : ratio <= 0.9 ? "false alarm" : "flat";
      bars[L0.kind] = +Math.max(1.5, Math.min(4, bars[L0.kind] + (verdict === "paid" ? -0.1 : verdict === "false alarm" ? 0.25 : 0))).toFixed(2);
      append("data/machines/waves.jsonl", { at: new Date().toISOString(), since: L0.since, hours: +hrs.toFixed(1), kind: L0.kind, triggers: L0.triggers, why: L0.why, peak: L.peak, signups24: got, normal: normal, ratio, verdict, bar: bars[L0.kind] });
      append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `lockin|end|${L0.since}`, machine: "core", kind: verdict === "paid" ? "win" : verdict === "false alarm" ? "loss" : "lesson", what: `LOCK-IN ${L0.kind} over after ${hrs.toFixed(0)} h: sign-ups ${got} vs ~${normal} (×${ratio}) — ${verdict}; ${L0.kind} bar → ×${bars[L0.kind]}` });
      L = { on: false, bars, last: { since: L0.since, kind: L0.kind, verdict, ratio } }; } }
  // ONE email to Kai when it starts (Resend, the alert address the other machines use)
  if (L.on && !L.emailed && process.env.RESEND_API_KEY && process.env.ALERT_TO) try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB LOCK-IN — ${L.kind} wave`, text: `${L.why}\n\nThe whole system is locked in: Bing all-in on ${L.targets.slice(0, 5).join(", ") || "the wave's pages"}, brains pushing harder, no restarts, deploys held, shield relaxed (3× flood).\nIt ends by itself after 2 quiet hours (min 6 h) and is judged on sign-ups.` }) });
    if (r.ok) L.emailed = true; } catch { /* next run retries */ }
  fs.writeFileSync(LF, JSON.stringify(L, null, 1));
  if (L.on) feed.unshift({ t: new Date().toISOString(), m: "core", text: `LOCK-IN (${L.kind}): ${L.why}`, kind: "hot" });
  console.log(`lock-in: ${L.on ? `ON (${L.kind}) since ${L.since} — ${L.why}` : `off · bars people ×${bars.people} signups ×${bars.signups} ai ×${bars.ai}${L.last ? ` · last ${L.last.kind} ${L.last.verdict}` : ""}`}`); }

const modeOut = { mode, since: mode === old.mode ? old.since : new Date().toISOString(), why, z, r24, normal: Math.round(mu), pageSurges, params: P,
  startMu: mode === old.mode ? old.startMu ?? Math.round(mu) : Math.round(mu), startR24: mode === old.mode ? old.startR24 ?? r24 : r24,
  targets: mode === "surge" ? (ai.surges ?? []).filter((s) => s.kind === "page").slice(0, 8).map((s) => s.key) : mode === "dip" ? (ai.winners ?? []).slice(0, P.recoveryN).map((w) => w.p) : [] };
fs.mkdirSync("data/machines", { recursive: true });
fs.writeFileSync("data/machines/mode.json", JSON.stringify(modeOut, null, 1));

const watchExtra = [];
// ── 3b. MACHINES BUILD MACHINES (bounded): a page type or release that surges again and again gets its own FOCUS branch —
// a small machine made of data (data/machines/spawned.json) that the AI machine runs: its pages get ×1.5 and go to Bing
// before the normal queue. Each branch is born with the 7 days before as its baseline, judged after 7 days on live AI reads
// per day (during vs before): ×1.2 or better = KEEP (judged again weekly), otherwise RETIRED and remembered — a retired
// target is not respawned for 28 days. At most 8 alive at once, so they can never take over the quota.
const SP = "data/machines/spawned.json", spawned = J(SP, { branches: [] });
// AUTHORITY (earned rank, last run): a branch's boost = 1.5 × its owner's authority, inside [1.2, 2] — proven owners get leverage
const RANKS0 = J("data/machines/ranks.json", { ranks: {} }).ranks ?? {};
const AUTH = (owner) => RANKS0[owner]?.authority ?? 1;
const boostFor = (owner) => +Math.min(2, Math.max(1.2, 1.5 * AUTH(owner))).toFixed(2);
const famOf = (p) => { const s0 = p.split("/").filter(Boolean); if (s0[0] === "news" && s0.length === 3) return `/news/${s0[1]}/`; if (s0[0] === "news" && s0.length === 2) return `/news/${s0[1].replace(/-\d{4}-\d{2}-\d{2}$/, "")}`; if (s0[0] === "economic-calendar" && s0[1]) return `/economic-calendar/${s0[1]}`; return s0.length === 1 ? `/${s0[0]}` : `/${s0[0]}/`; };
const recentSurges = readLines("data/ai/surges.jsonl").filter((x) => x.kind === "page" && NOW - Date.parse(x.at) < 7 * DAY);
const surgeDays = {}; for (const x of recentSurges) { const k = famOf(x.key); (surgeDays[k] ??= new Set()).add(x.at.slice(0, 10)); }
const readsOf = (prefix, from, to) => { let n = 0; for (const w of crawl) { const t = Date.parse(w.to); if (t < from || t >= to) continue; for (const [b, v] of Object.entries(w.bots)) if (LIVE.test(b)) for (const [p0, k] of v.top) { const q = p0.split("?")[0]; if (q === prefix || q.startsWith(prefix.endsWith("/") ? prefix : prefix + "/") || q.startsWith(prefix + "-")) n += k; } } return n; };
for (const b of spawned.branches) if (b.state === "alive" && b.boost != null) b.boost = boostFor(b.owner ?? "core");
for (const b of spawned.branches) if (b.state === "alive" && NOW - Date.parse(b.judged ?? b.born) >= 7 * DAY) {
  const days = (NOW - Date.parse(b.born)) / DAY, during = readsOf(b.target, Date.parse(b.born), NOW) / Math.max(1, days), ratio = during / Math.max(1, b.before ?? 0);
  b.judged = new Date().toISOString(); b.ratio = +ratio.toFixed(2);
  if (ratio >= 1.2) { b.verdict = "kept"; append("data/machines/ledger.jsonl", { at: b.judged, key: `spawn|${b.id}|${iso(NOW)}`, machine: b.owner ?? "core", kind: "win", what: `focus branch ${b.target} kept (×${b.ratio} reads/day)` }); }
  else { b.state = "retired"; b.verdict = "retired"; b.retired = b.judged; append("data/machines/ledger.jsonl", { at: b.judged, key: `spawn|${b.id}|${iso(NOW)}`, machine: b.owner ?? "core", kind: "loss", what: `focus branch ${b.target} retired (×${b.ratio}) — not respawned for 28 days` }); }
}
for (const [target, ds] of Object.entries(surgeDays).sort((a, b) => b[1].size - a[1].size)) {
  if (ds.size < 2 || spawned.branches.filter((b) => b.state === "alive").length >= 8) continue;
  if (spawned.branches.some((b) => b.target === target && (b.state === "alive" || NOW - Date.parse(b.retired ?? 0) < 28 * DAY))) continue;
  const id = "focus-" + target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40);
  const before = readsOf(target, NOW - 7 * DAY, NOW) / 7;
  spawned.branches.push({ id, owner: "core", target, born: new Date().toISOString(), state: "alive", boost: boostFor("core"), before: +before.toFixed(1), why: `surged on ${ds.size} days this week` });
  append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `spawn|${id}|born`, machine: "core", kind: "lesson", what: `spawned focus branch for ${target} (surged on ${ds.size} days)` });
  feed.unshift({ t: new Date().toISOString(), m: "core", text: `built a new branch: focus on ${target}`, kind: "win" });
}
// AI ANALYST picks (scripts/analyst.mjs, daily): ≤2 focus proposals on pages from its candidate list → same branch, owner
// "analyst", same 7-day judge; its wins/losses go to ITS rank, which sets the boost its branches get. Shares the cap of 8.
{ const an = J("data/analyst/plan.json");
  if (an?.at && NOW - Date.parse(an.at) < 30 * 3600e3) for (const pr of (an.proposals ?? []).slice(0, 2)) {
    const target = pr.target; if (!target || spawned.branches.filter((b) => b.state === "alive").length >= 8) continue;
    if (spawned.branches.some((b) => b.target === target && (b.state === "alive" || NOW - Date.parse(b.retired ?? 0) < 28 * DAY))) continue;
    const id = "focus-" + target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (spawned.branches.some((b) => b.id === id && b.state === "alive")) continue;
    spawned.branches.push({ id, owner: "analyst", target, born: new Date().toISOString(), state: "alive", boost: boostFor("analyst"), before: +(readsOf(target, NOW - 7 * DAY, NOW) / 7).toFixed(1), why: `AI analyst: ${pr.why || pr.evidence}`.slice(0, 160), explore: !!pr.explore });
    append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `spawn|${id}|born`, machine: "analyst", kind: "lesson", what: `AI analyst picked ${target} (${pr.evidence})` });
    feed.unshift({ t: new Date().toISOString(), m: "analyst", text: `AI analyst picked a focus: ${target}`, kind: "win" });
  } }
// THE BUILDER, GENERAL (Kai 11-11: "the machine that builds machines can be anything"). Besides surge focus branches, any
// signal another machine raises can spawn a branch: each TEMPLATE says what triggers it, what it measures, when it is
// judged and what counts as success. Branches are data (same spawned.json), shown on the web under their section, and
// judged by the core: kept while they pay, retired (and not respawned for 28 days) when they don't. Max 12 alive in all.
const TEMPLATES = [
  { kind: "leak", group: "conversion", parent: "leak", src: () => (J("data/leak/plan.json")?.leaks ?? []).slice(0, 2).filter((l) => l.lost >= 5).map((l) => ({ target: `${l.segment} @ ${l.stage}`, why: `${l.lost} people lost in 14 days`, base: l.lost })),
    measure: (b) => (J("data/leak/plan.json")?.leaks ?? []).find((l) => `${l.segment} @ ${l.stage}` === b.target)?.lost ?? 0, better: "lower", days: 7, does: "Watches one leak the leak machine found until it shrinks; escalates in the briefing while it doesn't" },
  { kind: "cost", group: "health", parent: "cost", src: () => (J("data/cost/plan.json")?.incidents ?? []).map((i) => ({ target: `${i.svc} ${i.kind}`, why: i.why, base: i.memGB })),
    measure: (b) => (J("data/cost/plan.json")?.services ?? []).find((x) => b.target.startsWith(x.svc + " "))?.memGB ?? 0, better: "lower", days: 2, does: "Watches one Railway cost incident until the service is back near its normal" },
  { kind: "source", group: "traffic", parent: "mentions", src: () => (men?.rising ?? []).map((x) => ({ target: x.host, why: `${x.v7} visitors this week`, base: x.v7 })),
    measure: (b) => (men?.sources ?? []).find((x) => x.host === b.target)?.v7 ?? 0, better: "higher", days: 7, does: "Tracks one outside source that started sending people: does it keep sending people who sign up?" },
];
for (const T of TEMPLATES) {
  let found = []; try { found = T.src(); } catch { found = []; }
  for (const f of found) { const id = `${T.kind}-${f.target}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
    if (spawned.branches.filter((b) => b.state === "alive").length >= 12) break;
    if (spawned.branches.some((b) => b.id === id && (b.state === "alive" || NOW - Date.parse(b.retired ?? 0) < 28 * DAY))) continue;
    spawned.branches.push({ id, kind: T.kind, target: f.target, born: new Date().toISOString(), state: "alive", base: f.base, why: f.why, better: T.better, days: T.days });
    append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `spawn|${id}|born`, machine: "core", kind: "lesson", what: `built a ${T.kind} branch: ${f.target} (${f.why})` });
    feed.unshift({ t: new Date().toISOString(), m: "core", text: `built a new ${T.kind} branch: ${f.target}`, kind: "win" }); }
  for (const b of spawned.branches.filter((x) => x.kind === T.kind && x.state === "alive" && NOW - Date.parse(x.judged ?? x.born) >= T.days * DAY)) {
    let v = 0; try { v = T.measure(b); } catch { v = 0; }
    const ok = T.better === "lower" ? v < b.base * 0.8 : v > b.base * 0.8; b.judged = new Date().toISOString(); b.now = v;
    if (T.better === "lower" && ok) { b.state = "retired"; b.verdict = "solved"; b.retired = b.judged; append("data/machines/ledger.jsonl", { at: b.judged, key: `spawn|${b.id}|${iso(NOW)}`, machine: "core", kind: "win", what: `${T.kind} branch ${b.target}: ${b.base} → ${v} — solved, retired` }); }
    else if (T.better === "higher" && !ok) { b.state = "retired"; b.verdict = "faded"; b.retired = b.judged; append("data/machines/ledger.jsonl", { at: b.judged, key: `spawn|${b.id}|${iso(NOW)}`, machine: "core", kind: "loss", what: `${T.kind} branch ${b.target}: ${b.base} → ${v} — faded, retired` }); }
    else { b.verdict = T.better === "lower" ? "still open" : "keeps paying"; if (T.better === "lower") watchExtra.push(`${T.kind === "leak" ? "Leak" : "Cost"} still open after ${T.days} days: ${b.target} (${b.base} → ${v}).`); }
  }
  for (const b of spawned.branches.filter((x) => x.kind === T.kind && x.state === "alive")) REG.push({ id: b.id, name: b.target.replace(/^(source|page|ai-page):/, "").slice(0, 26), group: T.group, parent: T.parent, does: `Built by the core. ${T.does}. ${b.why}.`, every: 24, t: () => NOW, spawned: true });
}
fs.writeFileSync(SP, JSON.stringify(spawned, null, 1));
for (const b of spawned.branches.filter((x) => x.state === "alive" && (!x.kind || x.kind === "focus"))) REG.push({ id: b.id, name: `Focus ${b.target}`, group: "core", parent: "core", does: `Built by the core: ${b.why}. Pages under ${b.target} ×${b.boost}, Bing first; judged weekly`, every: 1, t: () => NOW, feeds: ["bing"], spawned: true });

// ── 3c. THE BIN: data no machine reads any more is thrown out (never what a learner needs: aicrawl 120 d, score, clicks
// stay). Each rule = file, how long its lines matter, a hard line cap. Old monthly logs beyond 3 months are deleted.
const BIN = [["data/ai/surges.jsonl", 60, 4000], ["data/ai/runs.jsonl", 30, 2000], ["data/machines/ledger.jsonl", 365, 3000], ["data/machines/mistakes.jsonl", 30, 2000],
  ["data/machines/modes.jsonl", 180, 500], ["data/indexnow.jsonl", 90, 1000], ["data/recap-runs.jsonl", 90, 500], ["data/mentions/score.jsonl", 400, 500]];
let freed = 0;
for (const [f, days, cap] of BIN) { if (!fs.existsSync(f)) continue; const before = fs.statSync(f).size;
  const keep = readLines(f).filter((x) => !x.at || NOW - Date.parse(x.at) < days * DAY).slice(-cap);
  const body = keep.map((x) => JSON.stringify(x)).join("\n") + (keep.length ? "\n" : ""); if (body.length < before) { fs.writeFileSync(f, body); freed += before - body.length; } }
for (const d of ["data/watchdog", "data/load", "data/health"]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d).filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x)))
  if (Date.parse(f.slice(0, 7) + "-01T00:00:00Z") < NOW - 100 * DAY) { freed += fs.statSync(`${d}/${f}`).size; fs.unlinkSync(`${d}/${f}`); }
if (freed >= 1024) feed.unshift({ t: new Date().toISOString(), m: "bin", text: `threw out ${(freed / 1024).toFixed(0)} KB nobody reads`, kind: "do" });

// ── 3d. CAPACITY: from the chart-data server's own hourly load counters (data/load) — peak requests in flight, memory,
// requests shed. A real "how many at once" number needs a load test; this watches the live margin and warns early.
const loadRows = readLines(`data/load/${month}.jsonl`).filter((x) => NOW - Date.parse(x.at) < 7 * DAY);
const cap = { peakActive: Math.max(0, ...loadRows.map((x) => x.peakActive ?? 0)), peakQueue: Math.max(0, ...loadRows.map((x) => x.peakQueue ?? 0)),
  rssMB: Math.max(0, ...loadRows.map((x) => x.rssMB ?? 0)), shed: loadRows.reduce((t, x) => t + (x.shed ?? 0), 0), slow: loadRows.reduce((t, x) => t + (x.slow ?? 0), 0), served: loadRows.reduce((t, x) => t + (x.served ?? 0), 0) };

// ── 3e. SECTION LEADS (the pyramid: core → section lead → machines → branches). Each lead ranks its machines every hour —
// who did the most, who is late or stopped — and keeps them on the CORE RULES below. Top machines report to their lead.
const LEADS = { traffic: "Traffic lead", conversion: "Conversion lead", content: "Content lead", security: "Security lead", health: "Health lead" };
for (const [g, name] of Object.entries(LEADS)) {
  if (!REG.some((m) => m.group === g)) continue;
  for (const m of REG) if (m.group === g && !m.parent) m.parent = `lead-${g}`;
  REG.push({ id: `lead-${g}`, name, group: g, parent: "core", lead: true, does: `Section lead: ranks every ${g} machine each hour (most useful, late, stopped) and keeps them on the core rules`, every: 1, t: () => NOW });
}
const CORE_RULES = ["Nothing shady: official APIs only, no scraping against terms, no cloaking, no fake reviews or links — CRTLAB must never be flagged",
  "No backend strain: machines read files and caches, never hammer the database or the site", "Every change is measured; losers are dropped and remembered",
  "Bounded: every learned setting has a floor and a ceiling; a bad week rolls it back", "Free every day stays; no feature gates", "Site pushes only on Kai's word"];

// ── 4. NODES + EDGES ─────────────────────────────────────────────────────────────────────────────────────────────────
const statusOf = (m) => { let t = null; try { t = m.t(); } catch { t = null; } const age = t ? (NOW - t) / H : null, slack = Math.max(2, m.every * 0.5);
  return { t, age, state: age == null ? "waiting" : age <= m.every + slack ? "ok" : age <= m.every * 3 + slack ? "late" : "stopped" }; };
// OUTCOMES (11-11): one real number per machine/lead from outcomes.mjs wins over the supervisor run-level KPI
const OUTC = (() => { try { return JSON.parse(fs.readFileSync("data/machines/outcomes.json", "utf8")).kpi ?? {}; } catch { return {}; } })();
const kpiOf = { ...Object.fromEntries((sup?.status ?? []).map((s) => [s.id, s.kpi])), ...OUTC };
// ACTIVITY (11-12, Kai: "they better not just sit there doing nothing"): 42 of 65 machines had NO outcome number, so a machine
// that ran every hour and changed nothing looked healthy. Every machine's output file (read from its own registry entry) is
// fingerprinted hourly with timestamps stripped (an "at" that moves is not work) — jsonl by line count. A machine whose
// output has not really changed for max(7 days, 3 runs) is IDLE → data/machines/activity.json idle[] → fixer build item.
// Machines without an outcome get "days its output changed (7 d)" as their KPI so the map and the supervisor can judge them.
{ const AF = "data/machines/activity.json", A0 = J(AF, { m: {} }), A = { at: new Date().toISOString(), m: A0.m ?? {}, idle: [] };
  const TIMEKEY = /^(at|changed|updated|updatedAt|ts|time|t|checkedAt|generated|written|since|last|lastRun|asOf|from|to)$/;
  const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !TIMEKEY.test(k)).map(([k, x]) => [k, strip(x)])) : v;
  const fpOf = (f) => { try { if (f.endsWith(".jsonl")) return "n" + readLines(f).length; const raw = fs.readFileSync(f, "utf8"); let x; try { x = JSON.parse(raw); } catch { x = raw; }
    const sx = JSON.stringify(strip(x)); let h = 0; for (let i = 0; i < sx.length; i++) h = (h * 31 + sx.charCodeAt(i)) | 0; return "h" + h + ":" + sx.length; } catch { return null; } };
  const today = iso(NOW).slice(0, 10), inDays = (d, a, b) => { const t = Date.parse(d + "T12:00:00Z"); return NOW - t < a * DAY && NOW - t >= b * DAY; };
  for (const m of REG) {
    const files = [...new Set((m.t?.toString().match(/data\/[A-Za-z0-9_./<>-]+\.jsonl?/g) ?? []))].filter((f) => !f.includes("<"));
    if (!files.length) continue;
    const fp = files.map(fpOf).join("|"), r = (A.m[m.id] ??= { first: today, days: [], fp: null });
    if (r.fp != null && fp !== r.fp && !r.days.includes(today)) r.days.push(today);
    r.fp = fp; r.files = files; r.days = r.days.filter((d) => inDays(d, 30, 0));
    const now7 = r.days.filter((d) => inDays(d, 7, 0)).length, prev7 = r.days.filter((d) => inDays(d, 14, 7)).length;
    if (!kpiOf[m.id]) kpiOf[m.id] = { label: "days its output changed (7 d)", now: now7, before: Date.parse(r.first + "T00:00:00Z") < NOW - 14 * DAY ? prev7 : null, change: null, activity: true };
    const quietDays = r.days.length ? Math.floor((NOW - Date.parse(r.days.at(-1) + "T12:00:00Z")) / DAY) : Math.floor((NOW - Date.parse(r.first + "T00:00:00Z")) / DAY);
    const limit = Math.max(7, Math.ceil((3 * (m.every ?? 24)) / 24));
    if (quietDays >= limit && Date.parse(r.first + "T00:00:00Z") < NOW - limit * DAY && !["core", "mode"].includes(m.id)) A.idle.push({ id: m.id, name: m.name, quietDays, files });
  }
  fs.writeFileSync(AF, JSON.stringify(A));
  if (A.idle.length) console.log(`activity: ${A.idle.length} idle — ${A.idle.map((x) => `${x.name} (${x.quietDays} d)`).join(", ")}`); else console.log(`activity: ${Object.keys(A.m).length} machines fingerprinted, none idle`);
}
const act = {}; for (const e of feed) if (NOW - Date.parse(e.t) < DAY && e.kind !== "run" && !/ read \//.test(e.text)) act[e.m] = (act[e.m] ?? 0) + 1;
const hotIds = new Set(mode === "surge" ? ["surge", "sisters", "bing", "curator", "mode", "ai", "rising"] : mode === "dip" ? ["mode", "bing", "curator", "ai"] : []);
const nodes = REG.map((m) => { const s = statusOf(m); return { id: m.id, ...(m.link ? { link: m.link } : {}), name: m.name, group: m.group, parent: m.parent ?? null, does: m.does, every: m.every,
  state: s.state, lastRunH: s.age == null ? null : +s.age.toFixed(1), kpi: kpiOf[m.id] ?? null, act24: act[m.id] ?? 0, hot: hotIds.has(m.id), discovered: !!m.discovered, spawned: !!m.spawned,
  recent: feed.filter((e) => e.m === m.id).slice(0, 6) }; });
for (const n of nodes) if (n.id.startsWith("lead-")) { const mine = nodes.filter((x) => x.group === n.group && x.id !== n.id);
  const ok = mine.filter((x) => x.state === "ok").length, best = [...mine].sort((a, b) => b.act24 - a.act24)[0], bad = mine.filter((x) => x.state === "stopped" || x.state === "late");
  n.kpi = OUTC[n.id] ?? { label: "machines alive", now: ok, before: mine.length, change: null }; n.act24 = mine.reduce((t, x) => t + x.act24, 0);
  n.recent = [{ t: new Date().toISOString(), m: n.id, text: `${ok}/${mine.length} alive${best?.act24 ? ` · busiest: ${best.name} (${best.act24})` : ""}${bad.length ? ` · needs help: ${bad.map((x) => x.name).join(", ")}` : ""}`, kind: bad.length ? "bad" : "do" }]; }
{ const c = nodes.find((n) => n.id === "capacity"); if (c) { c.kpi = { label: "peak requests in flight (7 d)", now: cap.peakActive }; c.recent = [{ t: new Date().toISOString(), m: "capacity", text: `7 days: ${cap.served.toLocaleString("en-US")} chart loads · peak ${cap.peakActive} at once · queue ${cap.peakQueue} · memory ${cap.rssMB} MB · ${cap.shed} shed · ${cap.slow} slow`, kind: cap.shed || cap.slow ? "bad" : "do" }]; } }
// NEW machines: first time the core saw each id (data/machines/seen.json) — the page tags anything under 48 h old as NEW
{ const SEEN = "data/machines/seen.json", seen = J(SEEN, {}), first = !Object.keys(seen).length;
  for (const n of nodes) { if (!seen[n.id]) { seen[n.id] = first ? "2026-11-01T00:00:00.000Z" : new Date().toISOString(); if (!first) feed.unshift({ t: seen[n.id], m: n.id, text: `new machine joined the engine: ${n.name}`, kind: "win" }); } n.born = seen[n.id]; }
  fs.writeFileSync(SEEN, JSON.stringify(seen)); }
const today0 = iso(NOW);
// HISTORY: each machine's actions per day (today's value is rewritten every beat), 30 days, for the page's bar charts
{ const HF = "data/machines/history.json", hist = J(HF, {}), keep = iso(NOW - 30 * DAY);
  for (const n of nodes) { const h = (hist[n.id] ??= {}); h[today0] = n.act24; for (const d of Object.keys(h)) if (d < keep) delete h[d]; }
  fs.writeFileSync(HF, JSON.stringify(hist));
  for (const n of nodes) { const h = hist[n.id] ?? {}; n.days = Array.from({ length: 14 }, (_, i) => { const d = iso(NOW - (13 - i) * DAY); return [d.slice(5), h[d] ?? 0]; }); } }
// XP + LEVELS (Kai 11-11: "see how much each machine learnt"). XP comes only from real learning events:
//   every action it took (×2, 30 days) · every WIN it proved (+40) · every LESSON it stored (+25) · every LOSS it learned
//   from (+15 — failure teaches too) · every day it ran (+5). Level = 1 + log2(1 + XP/50): fast early, slower at the top.
// The highest-level machine in a section TEACHES: its learned values are what its section's newer machines start from
// (shown as the "teaches" list; the machines already read each other's files — this makes the strongest one visible).
const LEDGER = readLines("data/machines/ledger.jsonl"), HIST = J("data/machines/history.json", {});
const ledMap = { ai: "ai", core: "core", mentions: "mentions", supervisor: "mistakes" };
const LEARNS = {
  ai: "Every hour: which pages AI reads, clicks and turns into accounts → shrinks small samples toward their page type → spends Bing's quota where the value is; drops what never pays",
  surge: "Compares each page's last 24 h with its own 14-day normal; learns what a real spike looks like for each page", rising: "3-day climb vs its own 11 days before — catches early traction before it becomes a surge",
  sisters: "Learns which neighbours rise when one page is hot (same release, same market, same idea)", lift: "Learns per release how much more it is asked about around its day",
  weekly: "Learns which page types peak on which weekday", trend: "4-week growth per page type; growing types earn more quota", yield: "Learns from every Bing send that led to no read: that type gets less next time",
  hooks: "A/B tests one sentence on page halves, judges itself, never retries a losing wording", radar: "Asks AI the real buyer questions daily; learns which answers name CRTLAB and which don't",
  mode: "Each surge/dip is an episode: if pushing harder paid, it pushes harder next time; if not, less", core: "Links every machine, runs the modes, builds focus branches and retires the ones that don't pay",
  mentions: "Learns which outside sources send people who sign up", behaviour: "Learns which first-day actions bring people back, per device", factory: "Builds a page only when 30+ measured releases exist; the machines tell it which pages pay",
  supervisor: "Learns each machine's normal rhythm and flags anything late or failing", mistakes: "Counts every failure; repeats get escalated", bin: "Learns which data no machine reads and throws it out",
};
for (const n of nodes) {
  const h = HIST[n.id] ?? {}, acts30 = Object.values(h).reduce((t, v) => t + v, 0), days = Object.values(h).filter((v) => v > 0).length + Math.min(30, Math.floor((NOW - Date.parse(n.born ?? new Date().toISOString())) / DAY));
  const mine = LEDGER.filter((l) => (ledMap[l.machine] ?? l.machine) === n.id || (n.id === "surge" && /surged/.test(l.what)));
  const wins = mine.filter((l) => l.kind === "win").length, lessons = mine.filter((l) => l.kind === "lesson" || l.kind === "surge").length, losses = mine.filter((l) => l.kind === "loss" || l.kind === "mistake").length;
  const xp = acts30 * 2 + wins * 40 + lessons * 25 + losses * 15 + days * 5, lv = 1 + Math.floor(Math.log2(1 + xp / 50));
  const lo = 50 * (2 ** (lv - 1) - 1), hi = 50 * (2 ** lv - 1);
  n.xp = { xp, level: lv, next: hi, progress: +((xp - lo) / Math.max(1, hi - lo)).toFixed(2), wins, lessons, losses, acts30 };
  n.learns = LEARNS[n.id] ?? (n.id.startsWith("lead-") ? "Ranks its section's machines every hour and keeps them on the core rules" : n.id.startsWith("focus-") ? "Built by the core for one surging target; judged after 7 days, kept or retired" : "Learns from its own runs: what changed since last time, what failed, what to repeat");
}
// EARNED RANK (11-11, Kai: "machines rank up — a pyramid"). XP above counts activity too, so a busy machine levels up even
// when it helps nothing. RANK counts only what was JUDGED: ledger wins minus losses (verdicts against a baseline), ±1 for its
// outcome improving / hurting this week (outcomes.json). Tiers set AUTHORITY — how much leverage the machine gets: the boost
// its focus branches carry in the AI machine's Bing sends, and how many it may run. Proven machines get more; failing ones
// are put on probation. Read by the branch builder next run (data/machines/ranks.json).
const TIERS = [[-99, "Probation", 0.5], [0, "Rookie", 1], [2, "Proven", 1.25], [5, "Trusted", 1.5], [10, "Elite", 2]];
const prevRanks = (() => { try { return JSON.parse(fs.readFileSync("data/machines/ranks.json", "utf8")).ranks ?? {}; } catch { return {}; } })();
const ranks = {};
for (const n of nodes) {
  const o = OUTC[n.id];
  const trend = !o || o.neutral || o.change == null || (o.before ?? 0) < 10 ? 0 : (o.lowerBetter ? -o.change : o.change) >= 0.1 ? 1 : (o.lowerBetter ? -o.change : o.change) <= -0.2 ? -1 : 0;
  const score = (n.xp?.wins ?? 0) - (n.xp?.losses ?? 0) + trend;
  const [, tier, authority] = [...TIERS].reverse().find(([min]) => score >= min);
  n.rank = { tier, score, authority, trend };
  ranks[n.id] = n.rank;
  const was = prevRanks[n.id]?.tier;
  if (was && was !== tier) {
    const up = TIERS.findIndex((t) => t[1] === tier) > TIERS.findIndex((t) => t[1] === was);
    feed.unshift({ t: new Date().toISOString(), m: n.id, text: `${n.name ?? n.id} ${up ? "ranked up" : "dropped"} to ${tier} (authority ×${authority})`, kind: up ? "win" : "loss" });
  }
}
fs.writeFileSync("data/machines/ranks.json", JSON.stringify({ at: new Date().toISOString(), ranks }, null, 1));
for (const g of ["traffic", "conversion", "content", "security", "health", "core"]) { const ms = nodes.filter((n) => n.group === g && !n.id.startsWith("lead-")).sort((a, b) => b.xp.xp - a.xp.xp);
  if (ms[0]) ms[0].teaches = ms.slice(1).map((m) => m.id); }
const ids = new Set(nodes.map((n) => n.id)), edges = [];
for (const m of REG) { if (m.parent && ids.has(m.parent)) edges.push({ a: m.parent, b: m.id, kind: "branch", w: (act[m.id] ?? 0) + 1 });
  for (const f of m.feeds ?? []) if (ids.has(f) && f !== m.parent) edges.push({ a: m.id, b: f, kind: "data", w: (act[m.id] ?? 0) + 1 }); }
for (const n of nodes) if (!n.parent && n.id !== "core") edges.push({ a: "core", b: n.id, kind: "branch", w: (act[n.id] ?? 0) + 1 });

// ── 4b. ALL MODES (Kai: "surge mode, money mode, security mode, critical mode — anything really bad"). Several can be on at
// once; each comes from a real signal, never a guess. Level: critical > warn > good > info. The page shows them all; the
// worst decides the page's colour. Traffic mode (surge / dip) is the one the machines act on (mode.json above).
const modes = [];
const wd = readLines(`data/watchdog/${month}.jsonl`).slice(-3), wdBad = wd.length && !wd[wd.length - 1].ok;
const hc = J("data/health.json"), hBad = (hc?.checks ?? []).filter((c) => !c.ok);
if (wdBad || hBad.some((c) => /database|backup|market data/i.test(c.name))) modes.push({ id: "critical", label: "Critical", level: "critical",
  why: [wdBad ? `key page down: ${(wd[wd.length - 1].results ?? []).filter((r) => !r.ok).map((r) => r.name).join(", ")}` : "", ...hBad.map((c) => `${c.name}: ${c.note}`)].filter(Boolean).join(" · ") });
const sh = J("data/shield.json"), shHist = (sh?.history ?? []).filter((x) => NOW - Date.parse(x.at) < 7 * DAY), shMu = Math.max(2, shHist.reduce((t, x) => t + (x.blocked ?? 0), 0) / Math.max(1, shHist.length));
if (sh && ((sh.lastHour?.blocked ?? 0) >= Math.max(30, shMu * 4) || (sh.lastHour?.banned ?? 0) >= 3)) modes.push({ id: "security", label: "Security mode", level: "warn", why: `${sh.lastHour.blocked} blocked in the last hour vs ~${Math.round(shMu)} normally · ${sh.lastHour.banned} banned · shield ${sh.lastHour.mode}` });
if (cap.shed > 0 || cap.slow > 0) modes.push({ id: "capacity", label: "Capacity mode", level: cap.shed > 0 ? "critical" : "warn", why: `7 days: ${cap.shed} requests shed, ${cap.slow} slow · peak ${cap.peakActive} at once · ${cap.rssMB} MB` });
const pay = (hc?.checks ?? []).find((c) => /payment/i.test(c.name)); if (pay && !pay.ok) modes.push({ id: "money", label: "Money alert", level: "critical", why: `payments: ${pay.note}` });
if (mode === "surge") modes.push({ id: "surge", label: "Surge mode", level: "good", why: modeOut.why });
if (mode === "dip") modes.push({ id: "dip", label: "Recovery mode", level: "warn", why: modeOut.why });
if (!modes.length) modes.push({ id: "normal", label: "Normal", level: "info", why: modeOut.why });
const LV = { critical: 3, warn: 2, good: 1, info: 0 }; modes.sort((a, b) => LV[b.level] - LV[a.level]);
{ const prev = J("data/machines/ecosystem.json"), was = new Set((prev?.modes ?? []).map((m) => m.id));
  for (const m of modes) { const old = (prev?.modes ?? []).find((x) => x.id === m.id); m.since = old?.since ?? new Date().toISOString(); if (!was.has(m.id) && m.id !== "normal") feed.unshift({ t: m.since, m: "mode", text: `${m.label} on: ${m.why}`, kind: m.level === "good" ? "hot" : "bad" }); } }

// ── 5. BRIEFING (Kai: "good evening Kai, explain what is happening, good news, a conclusion — updated when it matters").
// Written from the numbers above, never invented. Its KEY = mode + the top items; when the key changes, `changed` moves,
// and the page marks the briefing as updated. The greeting itself is set by the page from Kai's own clock.
const pct = (x) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
// Written the way Kai talks: short, plain, most important first. Every line is a number the machines measured.
const good = [], next = []; let watch = [];
const xN = r24 / Math.max(1, mu);
if (xN >= 1.5) good.push(`ChatGPT and co. are reading CRTLAB ${xN.toFixed(1)}× more than normal — ${r24} reads in 24 h vs ~${Math.round(mu)} a day.`);
for (const x of (ai.surges ?? []).filter((y) => y.kind === "page").slice(0, 4)) good.push(`${x.key} is flying: ${x.last24h} reads today vs ~${x.normal} normally.`);
for (const x of (ai.rising ?? []).slice(0, 3)) good.push(`${x.key} is climbing: ${x.last3d} reads in 3 days, normally ~${x.normal3d}.`);
for (const st of sup?.status ?? []) if (st.kpi?.change != null && st.kpi.change >= 0.15 && st.kpi.before >= 5) good.push(`${st.kpi.label} up ${pct(st.kpi.change)} on last week (${st.kpi.now}).`);
for (const l of readLines("data/machines/ledger.jsonl").filter((x) => x.kind === "win" && NOW - Date.parse(x.at) < DAY).slice(-2)) good.push(`Win: ${l.what}.`);
for (const f of men?.fresh ?? []) good.push(`Someone mentioned CRTLAB: ${f.where}.`);
const bad = nodes.filter((n) => n.state === "stopped" || n.state === "late");
for (const w of watchExtra) watch.push(w);
for (const m of modes.filter((x) => x.level === "critical" || (x.level === "warn" && x.id !== "dip"))) watch.push(`${m.label}: ${m.why}.`);
// OUTCOME RULES (11-11): the engine reads its own numbers. Reads up a lot while clicks stay flat = the step from an AI read
// to a visit is the bottleneck (that week: reads x5.6, clicks +3%); a lead outcome down 20%+ is called out; cost over target.
{ const rd = OUTC["lead-content"], ck = OUTC["bing"], co = OUTC["cost"];
  if (rd?.change != null && ck?.change != null && rd.change >= 0.5 && ck.change < 0.1) watch.push(`AI reads ×${(1 + rd.change).toFixed(1)} on last week (${rd.now}) but AI clicks ${ck.change >= 0 ? "+" : ""}${Math.round(ck.change * 100)}% (${ck.now}) — the read → visit step is the bottleneck: hooks on the read pages, not more pages.`);
  for (const id of ["lead-traffic", "lead-conversion"]) { const x = OUTC[id]; if (x?.change != null && x.before >= 10 && x.change <= -0.2) watch.push(`${x.label} down ${Math.round(-x.change * 100)}% on last week (${x.now} vs ${x.before}).`); if (x?.change != null && x.before >= 10 && x.change >= 0.2) good.push(`${x.label} up ${Math.round(x.change * 100)}% on last week (${x.now} vs ${x.before}).`); }
  if (co?.now != null && co.target && co.now > co.target * 1.2) watch.push(`Railway at ~$${co.now.toFixed(0)}/month pace vs the $${co.target} target — the budget machine is on it (deploy windows, caps, heap tuner).`); }
for (const st of sup?.status ?? []) if (st.kpi?.change != null && st.kpi.change <= -0.2 && st.kpi.before >= 5 && !st.kpi.lowerBetter) watch.push(`${st.kpi.label} down ${Math.abs(Math.round(st.kpi.change * 100))}% on last week (${st.kpi.now} vs ${st.kpi.before}). More readers, fewer sign-ups — that's the leak to look at.`);
if (bad.length) watch.push(`${bad.map((n) => n.name).join(", ")} ${bad.length === 1 ? "is" : "are"} behind.`);
for (const m of (sup?.mistakes ?? []).filter((x) => x.repeating)) watch.push(`${m.where} keeps failing (${m.n}× this week).`);
if (mode === "dip") watch.push(peopleDip ? `People are down (${HU.visitors.now} vs ~${HU.visitors.normal} a day) — ${HU.why.slice(0, 2).join("; ") || "no single segment"}. Recovery is on: the proven pages get pushed first.` : `Reads are down (${r24} vs ~${Math.round(mu)} a day). Recovery is on: the proven pages get pushed first.`);
{ const lk = J("data/leak/plan.json"), l = lk?.leaks?.[0]; if (l) watch.unshift(`Biggest leak: ${l.segment.replace(/^\w+:/, "")} at "${l.stage}" — ${l.lost} people lost in 14 days. Fix to try: ${l.fix}.`); }
if ((men?.sources?.length ?? 0) < 5) watch.push("Nobody outside links to CRTLAB yet — word of mouth is basically zero.");
if (mode === "surge") next.push(`Surge mode: the hottest pages get up to ${Math.round(P.surgeCap * 100)}% of today's Bing sends, and the top ${P.sisterTop} pull their sister pages up with them.`);
if (mode === "dip") next.push(`Recovery: the ${P.recoveryN} best pages go back to Bing first until reads come back.`);
{ const up = (J("data/events/upcoming.json", { events: [] }).events ?? []).filter((e) => e.t > NOW && e.t < NOW + 3 * DAY && e.imp >= 2 && e.fam);
  const seen = new Set(); for (const e of up) { if (seen.has(e.fam)) continue; seen.add(e.fam); if (seen.size > 3) break;
    next.push(`${e.title} drops ${new Date(e.t).toUTCString().slice(0, 11)} — its pages are already queued for Bing before people ask.`); } }
// LEARNING PULSE (11-12, admin view: "how strong is the learning?") — every engine's closed loops in one line + a daily row
// in data/machines/pulse.jsonl, so the curve is visible: verdicts per week (wins + losses anywhere), neurons with real
// experience, priors learned from history, tests running, holdout age, lock-in waves. 0 verdicts = the brains are guessing.
{ const wk = (f) => readLines(f).filter((l) => NOW - Date.parse(l.at) < 7 * DAY);
  const led = [...wk("data/machines/ledger.jsonl"), ...wk("data/traffic/ledger.jsonl")], wins = led.filter((l) => l.kind === "win").length, losses = led.filter((l) => l.kind === "loss").length;
  const tw = Object.values(J("data/traffic/brain.json", {}).w ?? {}), bw = (J("data/brains/index.json", { brains: [] }).brains ?? []).map((b) => Object.values(J(`data/brains/${b.id}/brain.json`, {}).w ?? {})).flat();
  const hooks = (J("data/ai/hooks.json", { experiments: [] }).experiments ?? []), ho = J("data/ai/holdout.json", null), waves = readLines("data/machines/waves.jsonl").filter((w) => NOW - Date.parse(w.at) < 30 * DAY);
  const WC = J("data/world/credit.json", null), wv = WC ? Object.values(WC.credit ?? {}).filter((c) => c.verdict && c.verdict !== "no clear effect yet").length : 0;
  const P = { day: iso(NOW).slice(0, 10), worldVerdicts: wv, worldFit: WC?.fitError ?? null, bingCredit: WC?.credit?.["bing-send"]?.lift ?? null, verdicts7: wins + losses, wins7: wins, losses7: losses, neurons: tw.length + bw.length, experienced: [...tw, ...bw].filter((w) => w.n > 0).length,
    fromHistory: tw.filter((w) => /^history/.test(w.prior ?? "")).length, testsRunning: hooks.filter((e) => e.status === "running").length, testsWaiting: hooks.filter((e) => e.status === "paused").length,
    holdoutDays: ho?.last?.days ?? null, pushLift: ho?.last?.pushLift ?? null, waves30: waves.length, wavesPaid: waves.filter((w) => w.verdict === "paid").length };
  const PF = "data/machines/pulse.jsonl", rowsP = readLines(PF); if (rowsP.at(-1)?.day === P.day) rowsP[rowsP.length - 1] = P; else rowsP.push(P);
  fs.writeFileSync(PF, rowsP.slice(-365).map((x) => JSON.stringify(x)).join("\n") + "\n");
  const prevP = rowsP.at(-8);
  { const EX = J("data/machines/executive.json", null); if (EX?.constraint) next.unshift(`Executive: the constraint is ${EX.constraint.toUpperCase()} — ${EX.why}. Every engine is tuned to it (knob strength ×${EX.strength}).`); }
  { const RC = J("data/radar/recommend.json", null); if (RC?.asked) next.push(`Recommendation: ChatGPT names CRTLAB in ${((RC.namedRate ?? 0) * 100).toFixed(0)}% of ${RC.asked} buyer answers (cited ${((RC.citedRate ?? 0) * 100).toFixed(0)}%) — ${RC.targets.length} lost pages pushed to Bing; it trusts ${(RC.trustedTop ?? []).slice(0, 4).map((x) => x.d).join(", ")}`); }
  { const KB = J("data/machines/knowledge.json", null); if (KB?.top?.length) next.push(`The ecosystem knows (${KB.count} facts): ${KB.top.slice(0, 3).join(" · ")}`); }
  if (WC?.curve) { const cv = WC.curve; next.push(`The curve (${cv.days} d): people asking AI about us ${cv.reads.perDay >= 0 ? "+" : ""}${cv.reads.perDay}%/day (→ ~${cv.reads.in30}/day in 30 d) · AI clicks ${cv.clicks.perDay >= 0 ? "+" : ""}${cv.clicks.perDay}%/day (→ ~${cv.clicks.in30}/day) · accounts ${cv.accounts.perDay >= 0 ? "+" : ""}${cv.accounts.perDay}%/day${cv.gap > 2 ? ` — reads outgrow clicks by ${cv.gap}%/day: conversion is the bottleneck` : ""}`); }
  next.push(`World model: ${WC ? `${WC.pageDays} page-days, forecast error ${WC.fitError}, ${Object.entries(WC.credit ?? {}).filter(([, c]) => c.lift != null).map(([k, c]) => `${k} ×${c.lift}${c.ci ? ` [${c.ci.join("–")}]` : ""}`).join(", ")}` : "warming up"}`);
  next.push(`Learning pulse: ${P.verdicts7} verdicts this week (${wins} won, ${losses} lost)${prevP ? ` vs ${prevP.verdicts7} a week before` : ""} · ${P.experienced}/${P.neurons} neurons with real experience, ${P.fromHistory} pre-trained from history · ${P.testsRunning} tests running${P.testsWaiting ? ` (+${P.testsWaiting} waiting)` : ""}${P.pushLift != null ? ` · push lift ×${P.pushLift} (holdout)` : P.holdoutDays != null ? ` · holdout day ${Math.floor(P.holdoutDays)} of 7` : ""}${P.waves30 ? ` · ${P.waves30} waves in 30 d, ${P.wavesPaid} paid` : ""}`); }
{ const an = J("data/analyst/plan.json"); if (an?.headline && NOW - Date.parse(an.at) < 30 * 3600e3) next.unshift(`AI analyst: ${an.headline}`); }
// THE TRAFFIC BRAIN talks back (two engines, one picture): its mode + what it is pushing lead the main briefing
{ const tb = J("data/traffic/ecosystem.json"); if (tb?.briefing && NOW - Date.parse(tb.at) < 3 * 3600e3) { next.unshift(`Traffic brain (${tb.modes?.[0]?.label ?? "on"}): ${tb.briefing.conclusion}`); for (const w of (tb.briefing.watch ?? []).slice(0, 1)) watch.push(`Traffic: ${w}`); } }
for (const b of (spawned.branches ?? []).filter((x) => x.state === "alive").slice(0, 2)) next.push(`Focus branch on ${b.target} is running (${b.why}).`);
const topSurge = (ai.surges ?? []).find((y) => y.kind === "page");
// 11-12: only what needs Kai is "needs you"; observations + build work go to notes (Kai: "they keep piling up")
const NW = splitNeeds(watch), allWatch = watch; watch = NW.watch;
const conclusion = mode === "surge" ? `Big day, Kai. AI is reading us ${xN.toFixed(1)}× normal${topSurge ? `, led by ${topSurge.key}` : ""}, and I've got every machine pushing it.${watch.length ? ` ${watch.length === 1 ? "One thing needs" : `${watch.length} things need`} you.` : " Nothing needs you."}`
  : mode === "dip" ? `Quiet one, Kai. Reads are under normal, so I switched to recovery and I'm pushing the pages that already work.${watch.length ? " Have a look below." : ""}`
  : `All steady, Kai. ${nodes.filter((n) => n.state === "ok").length} of ${nodes.length} machines running and learning.${watch.length ? ` ${watch.length === 1 ? "One thing to look at." : `${watch.length} things to look at.`}` : " Nothing needs you."}`;
const prevEco = J("data/machines/ecosystem.json"), bKey = [mode, ...good.slice(0, 3), ...watch.slice(0, 2)].join("|").replace(/\d+/g, "#");
const briefing = { key: bKey, changed: prevEco?.briefing?.key === bKey ? prevEco.briefing.changed : new Date().toISOString(), headline: modeOut.why, good: good.slice(0, 10), watch: watch.slice(0, 6), notes: NW.notes.slice(0, 8), next: next.slice(0, 6), conclusion };

// ── 6. WIDGETS: the live numbers the page shows as tiles (all from files the machines already wrote)
const today = iso(NOW), runsToday = readLines("data/ai/runs.jsonl").filter((r) => r.at.slice(0, 10) === today);
const sc = readLines("data/ai/score.jsonl"), sc7 = sc.slice(-7), scPrev = sc.slice(-14, -7), sum = (a, k) => a.reduce((t, x) => t + (x[k] ?? 0), 0);
const shw = J("data/shield.json"), radw = J("data/radar/plan.json"), menw = readLines("data/mentions/score.jsonl").slice(-1)[0];
// AI reads per hour, last 24 h (live readers only) — the top-right graph on /machine
const readsHourly = Array.from({ length: 24 }, () => 0);
for (const w of crawl) { const age = NOW - Date.parse(w.to); if (age < 0 || age >= DAY) continue; const h = 23 - Math.floor(age / H); let n = 0; for (const [b, v] of Object.entries(w.bots)) if (LIVE.test(b)) n += v.hits ?? 0; readsHourly[h] += n; }
const widgets = {
  readsHourly,
  aiReads24: r24, aiReadsNormal: Math.round(mu), aiReadsZ: z,
  aiClicks7: sum(sc7, "clicks"), aiClicksPrev: sum(scPrev, "clicks"), aiAccounts7: sum(sc7, "accounts"), aiAccountsPrev: sum(scPrev, "accounts"),
  bingToday: runsToday.reduce((t, r) => t + (r.submitted ?? 0), 0), bingStatus: runsToday.at(-1)?.bing ?? null,
  surging: (ai.surges ?? []).filter((x) => x.kind === "page").length, climbing: (ai.rising ?? []).length, sisters: (ai.sisters ?? []).length,
  reactionPages: (J("data/events/react/index.json", []) ?? []).length,
  blockedHour: shw?.lastHour?.blocked ?? null, bannedHour: shw?.lastHour?.banned ?? null, shieldMode: shw?.lastHour?.mode ?? null,
  capacity: cap, radarShare: typeof radw?.sov === "number" ? radw.sov : radw?.sov?.all ?? null,
  wom7: menw?.wom7 ?? 0, mentions: menw?.mentions ?? 0,
  wins7: readLines("data/machines/ledger.jsonl").filter((x) => x.kind === "win" && NOW - Date.parse(x.at) < 7 * DAY).length,
  losses7: readLines("data/machines/ledger.jsonl").filter((x) => (x.kind === "loss" || x.kind === "mistake") && NOW - Date.parse(x.at) < 7 * DAY).length,
};

// ── 7. SCOUT: what's missing — the machines the core would build next, each backed by data it already holds
const scout = [];
for (const n of nodes.filter((x) => x.discovered)) scout.push({ what: `Wire in ${n.name}`, why: "writes a plan nobody reads yet", kind: "wire" });
for (const c of (ai.convert ?? []).slice(0, 3)) scout.push({ what: `Convert hook for ${c.p}`, why: `${c.reads7d} AI reads in 7 days, ${c.clicks7d} clicks`, kind: "hook" });
for (const f of (ai.expand ?? []).filter((x) => x.pages >= 3).slice(0, 2)) scout.push({ what: `More ${f.family} pages`, why: `read→click ${(f.ctr * 100).toFixed(1)}% on ${f.pages} pages — the best-paying page type`, kind: "factory" });
{ const g = J("data/gaps.json"); const n = Array.isArray(g) ? g.length : (g?.gaps?.length ?? 0); if (n) scout.push({ what: "Pages for search gaps", why: `${n} searches with no good CRTLAB page`, kind: "factory" }); }
if ((men?.sources?.length ?? 0) < 5) scout.push({ what: "Word-of-mouth engine", why: "no outside site sends people yet", kind: "new" });
if (!(widgets.aiAccounts7 >= widgets.aiAccountsPrev)) scout.push({ what: "AI landing machine", why: `AI accounts ${widgets.aiAccounts7} vs ${widgets.aiAccountsPrev} last week while reads are up — the first screen leaks`, kind: "new" });
{ const lk = J("data/leak/plan.json"); for (const l of (lk?.leaks ?? []).slice(0, 2)) scout.unshift({ what: `Fix the leak: ${l.segment.replace(/^\w+:/, "")} at ${l.stage}`, why: `${l.lost} people lost in 14 days (${Math.round(l.rate * 100)}% vs ${Math.round(l.best * 100)}% best) — ${l.fix}`, kind: "leak" }); }
{ const per = J("data/machines/iq.json")?.per; if (per) { const dumb = nodes.filter((n) => !n.id.startsWith("lead-") && !per[n.id] && NOW - Date.parse(n.born ?? new Date().toISOString()) > 7 * DAY);
  if (dumb.length) scout.push({ what: `Teach ${dumb.length} machines to learn`, why: `IQ 70 after a week — they act but learn nothing from what happens: ${dumb.slice(0, 6).map((n) => n.name).join(", ")}${dumb.length > 6 ? "…" : ""}`, kind: "learn" }); } }
scout.push({ what: "Cost machine (Railway)", why: "budget watch + backend optimiser — Kai asked 11-11", kind: "new" });

// MACHINES IQ + POWER (scripts/iq.mjs): IQ = learned by themselves; POWER = upgrades we built in. 7-day change for the tiles.
function iqOut() {
  const d = J("data/machines/iq.json"), P = d?.points ?? [];
  if (!P.length) return null;
  const last = P.at(-1), wk = new Date(NOW - 7 * DAY).toISOString().slice(0, 13), ago = [...P].reverse().find((p) => p.t <= wk) ?? P[0];
  for (const n of nodes) if (!n.id.startsWith("lead-")) n.iq = d.per?.[n.id] ?? 70; // per machine (70 = learned nothing yet)
  return { iq: last.iq, iqWas: ago.iq, power: last.power, powerWas: ago.power, since: ago.t, parts: last.parts, points: P.map((p) => [p.t, p.iq, p.power]) };
}
const eco = { at: new Date().toISOString(), scout, widgets, modes, briefing, rules: CORE_RULES, capacity: cap, mode: modeOut, nodes, edges, feed: feed.slice(0, 160),
  totals: { machines: nodes.length, ok: nodes.filter((n) => n.state === "ok").length, late: nodes.filter((n) => n.state === "late").length, stopped: nodes.filter((n) => n.state === "stopped").length, actions24: Object.values(act).reduce((a, b) => a + b, 0) },
  allIn: sup?.allIn ?? [], fix: sup?.fix ?? [], mistakes: sup?.mistakes ?? [], ledger: (sup?.ledger ?? []).slice(0, 15), episodes: readLines("data/machines/modes.jsonl").slice(-8).reverse(),
  spawned: spawned.branches.slice(-12),
  score: readLines("data/ai/score.jsonl").slice(-30).map((s) => ({ day: s.day, reads: s.reads, clicks: s.clicks, accounts: s.accounts })), iq: iqOut() };
fs.writeFileSync("data/machines/ecosystem.json", JSON.stringify(eco));
console.log(`core: ${eco.totals.ok}/${eco.totals.machines} ok · mode ${mode} (${why}) · ${eco.totals.actions24} actions in 24 h`);
