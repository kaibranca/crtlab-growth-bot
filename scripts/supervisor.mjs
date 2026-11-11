// SUPERVISOR (11-11, Kai: "one machine monitoring all of them and refining them — I can't see it all, I lose track").
// DAILY, last step before summary.mjs. Reads every machine's own output (never the database, never the site) and writes
// ONE page of truth, data/machines/status.json, which the Growth board shows as "All machines":
//   ALIVE    each machine's last run vs its normal cadence → ok / late / STOPPED, and errors in its last runs
//   SCORE    each machine's headline number, this week vs last week (traffic → accounts first)
//   ALL IN   the moves the machines are pushing hardest right now (surges, climbers, sisters, radar wins), ranked
//   LEDGER   every decision the machines made from evidence — wins kept, losses dropped, lessons — appended once each to
//            data/machines/ledger.jsonl, so success AND failure are remembered across machines and sessions
//   FIX      what the supervisor would change next (a machine stopped, a learner starved of data, a test stuck), the
//            upgrade list for the next Claude session — it does not rewrite other machines itself (safe by design)
// Email only when a machine STOPS (once per machine per day). Counts, paths and hosts only (public repo).
import fs from "node:fs";
import { readLines, append } from "./lib.mjs";

const NOW = Date.now(), H = 3.6e6, DAY = 24 * H, iso = (t) => new Date(t).toISOString().slice(0, 10);
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const last = (f) => readLines(f).slice(-1)[0] ?? null;
const at = (x) => (x?.at ? Date.parse(x.at) : null);

// every machine: where its output lives, how often it should run (hours), its headline number
const ai = J("data/ai/plan.json"), score = readLines("data/ai/score.jsonl");
const wk = (rows, k, from, to) => rows.filter((r) => { const t = Date.parse(r.day + "T12:00:00Z"); return t >= NOW - from * DAY && t < NOW - to * DAY; }).reduce((s, r) => s + (r[k] ?? 0), 0);
const MACHINES = [
  { id: "ai", name: "AI referral machine", every: 1, t: at(ai), kpi: () => ({ label: "AI clicks / week", now: wk(score, "clicks", 7, 0), before: wk(score, "clicks", 14, 7) }) },
  { id: "ai-acc", name: "AI → accounts", every: 1, t: at(ai), kpi: () => ({ label: "AI accounts / week", now: wk(score, "accounts", 7, 0), before: wk(score, "accounts", 14, 7) }) },
  { id: "eyes", name: "Eyes (Bing index + Cloudflare)", every: 1, t: at(J("data/ai/edge.json")) },
  { id: "truth", name: "Truth gate", every: 6, t: at(J("data/ai/truth.json")), kpi: () => { const t = J("data/ai/truth.json"); return t && { label: "contradictions", now: (t.bad ?? t.contradictions ?? []).length ?? 0, lowerBetter: true }; } },
  { id: "factory", name: "Reaction factory", every: 24, t: (() => { const r = last("data/recap-runs.jsonl"); return at(r); })(), kpi: () => ({ label: "reaction pages", now: (J("data/events/react/index.json", []) ?? []).length }) },
  { id: "behaviour", name: "Behaviour machine", every: 24, t: at(J("data/behaviour/plan.json")) },
  { id: "radar", name: "AI radar", every: 24, t: at(J("data/radar/plan.json")), kpi: () => { const r = J("data/radar/plan.json"); return r && { label: "share of AI answers", now: r.sov?.all ?? r.sov ?? null }; } },
  { id: "devices", name: "Device QA", every: 24, t: at(J("data/mobile/report.json")) },
  { id: "mentions", name: "Mentions machine", every: 24, t: at(J("data/mentions/plan.json")), kpi: () => { const s = readLines("data/mentions/score.jsonl"); const x = s.slice(-1)[0]; return x && { label: "word-of-mouth visitors / week", now: x.wom7 }; } },
  { id: "health", name: "Health + watchdog", every: 1, t: at(J("data/health.json")) },
  { id: "shield", name: "Shield", every: 1, t: at(J("data/shield.json")) },
  { id: "indexnow", name: "IndexNow", every: 24, t: at(last("data/indexnow.jsonl")) },
];
const status = MACHINES.map((m) => {
  const age = m.t ? (NOW - m.t) / H : null, slack = Math.max(2, m.every * 0.5);
  const state = age == null ? "waiting" : age <= m.every + slack ? "ok" : age <= m.every * 3 + slack ? "late" : "STOPPED";
  let k = null; try { k = m.kpi?.() ?? null; } catch { k = null; }
  if (k && k.before != null) k.change = k.before ? +((k.now - k.before) / k.before).toFixed(2) : null;
  return { id: m.id, name: m.name, state, lastRunH: age == null ? null : +age.toFixed(1), everyH: m.every, kpi: k };
});

// ── THE PYRAMID (11-11): the supervisor watched 12 machines; the core knows 59. Every machine the core registered (last
// hour's ecosystem.json) now has the same contract here: RAN ON TIME (else late / STOPPED → email + fixer) and its OUTCOME
// not getting worse (outcomes.json: 20%+ the wrong way on a real base = HURTING → fix list, judged by its section lead).
{ const eco = J("data/machines/ecosystem.json"), have = new Set(status.map((x) => x.id));
  for (const n of eco?.nodes ?? []) {
    if (have.has(n.id) || n.id.startsWith("lead-") || n.spawned) continue;
    const st = n.state === "ok" ? "ok" : n.state === "late" ? "late" : n.state === "waiting" ? "waiting" : n.state ? "STOPPED" : "ok";
    status.push({ id: n.id, name: n.name ?? n.id, state: st, lastRunH: n.lastRunH ?? null, everyH: n.every ?? null, kpi: n.kpi ?? null, from: "core" });
  }
}
const OUTC = J("data/machines/outcomes.json")?.kpi ?? {};
const hurting = Object.entries(OUTC).filter(([, k]) => k && !k.neutral && k.change != null && (k.before ?? 0) >= 10 && (k.lowerBetter ? k.change >= 0.2 : k.change <= -0.2)).map(([id, k]) => ({ id, label: k.label, now: k.now, before: k.before, change: k.change }));
const seenH = new Set();

// ── ALL IN: what the machines are pushing hardest, one ranked list ────────────────────────────────────────────────────
const allIn = [];
for (const s of ai?.surges ?? []) if (s.kind === "page") allIn.push({ move: "surge", what: s.key, why: `${s.last24h} AI reads in 24 h vs ~${s.normal}/day`, z: s.z });
for (const s of ai?.rising ?? []) allIn.push({ move: "climbing", what: s.key, why: `${s.last3d} reads in 3 days vs ~${s.normal3d}`, z: s.z });
for (const s of (ai?.sisters ?? []).slice(0, 6)) allIn.push({ move: "sister", what: s.p, why: `next to ${s.of}`, z: 1 });
const rad = J("data/radar/plan.json"); for (const e of (rad?.events ?? []).filter((e) => /won/i.test(e.what ?? e.kind ?? "")).slice(-3)) allIn.push({ move: "radar win", what: e.page ?? e.q ?? "", why: "an AI answer started recommending it", z: 5 });
const men = J("data/mentions/plan.json"); for (const s of men?.rising ?? []) allIn.push({ move: "word of mouth", what: s.host, why: `${s.v7} visitors this week`, z: 4 });
allIn.sort((a, b) => b.z - a.z);

// ── LEDGER: decisions from evidence, remembered once ─────────────────────────────────────────────────────────────────
const LED = "data/machines/ledger.jsonl", known = new Set(readLines(LED).map((x) => x.key));
const add = (key, machine, kind, what) => { if (known.has(key)) return; known.add(key); append(LED, { at: new Date().toISOString(), key, machine, kind, what }); };
for (const v of ai?.verdicts ?? []) if (/WORKS|WORSE/.test(v.verdict ?? "")) add(`verdict|${v.at}|${v.path ?? v.family}`, "ai", /WORKS/.test(v.verdict) ? "win" : "loss", `${v.what} → ${v.verdict}`);
for (const e of ai?.experiments ?? []) if (/won|lost/i.test(e.status ?? "")) add(`hook|${e.id}|${e.status}`, "ai", /won/i.test(e.status) ? "win" : "loss", `hook test ${e.id}: ${e.status}`);
for (const [k, v] of Object.entries(J("data/ai/lessons.json", {}) ?? {})) if (v && typeof v === "object" && (v.lost || v.won)) add(`lesson|${k}|${v.won ?? 0}|${v.lost ?? 0}`, "ai", "lesson", `${k}: won ${v.won ?? 0}, lost ${v.lost ?? 0}`);
for (const s of ai?.surges ?? []) if (s.kind === "page") add(`surge|${s.key}|${iso(NOW)}`, "ai", "surge", `${s.key} surged (${s.last24h} vs ${s.normal}/day)`);
for (const s of men?.faded ?? []) add(`faded|${s}`, "mentions", "loss", `${s} stopped sending people`);
const ledger = readLines(LED).slice(-30).reverse();

// ── FIX: what to improve next (for the next session) ─────────────────────────────────────────────────────────────────
const fix = [];
for (const h of hurting) { const key = h.label + h.now; if (seenH.has(key)) continue; seenH.add(key); fix.push(`${h.label} getting worse: ${h.now} vs ${h.before} last week (${h.id})`); }
for (const s of status) if (s.state !== "ok") fix.push(`${s.name} is ${s.state} (last run ${s.lastRunH ?? "never"} h ago, normal every ${s.everyH} h)`);
// Bing: the daily quota can be spent early (fine); a problem is no accepted send at all for 30 h
const runs = readLines("data/ai/runs.jsonl").filter((r) => NOW - Date.parse(r.at) < 30 * H);
if (runs.length >= 12 && !runs.some((r) => r.submitted > 0)) fix.push(`AI machine had no accepted Bing send in 30 h (${runs.length} runs, last: ${runs.at(-1)?.bing}) — check the Bing key/quota`);
const exps = ai?.experiments ?? []; for (const e of exps) if ((e.days ?? 0) > 21 && /running/i.test(e.status ?? "")) fix.push(`hook test ${e.id} still undecided after ${e.days} days — too little traffic on that family; widen it`);
const sk = status.find((s) => s.id === "ai")?.kpi; if (sk && sk.before > 0 && sk.change <= -0.3) fix.push(`AI clicks down ${Math.round(-sk.change * 100)}% week on week — check the radar for lost answers`);
if (men && (men.sources?.length ?? 0) < 5) fix.push("word of mouth is near zero (under 5 outside sources in 35 days) — nothing links to CRTLAB yet; mentions machine will flag the first ones");

// ── MISTAKES (Kai 11-11: "a machine monitoring any mistakes in the other machines, failed attempts") ───────────────────
// 1. every GitHub Actions run of the last 26 h → each FAILED step, incl. steps marked continue-on-error (they fail quietly)
// 2. machine-level failures they log themselves: Bing sends not accepted, mentions eyes that errored, truth contradictions
// Each mistake is counted per step over 7 days (data/machines/mistakes.jsonl), so a one-off is "once", a repeat is "REPEATING".
const mistakes = [];
/** newest SUCCESSFUL run per workflow name (11-11): a failure followed by a green run of the same workflow is fixed, not "repeating" */
const lastGreen = {};
const REPO = process.env.GITHUB_REPOSITORY || "kaibranca/crtlab-growth-bot", GH = { accept: "application/vnd.github+json", ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
// 11-11: the daily data pull lives in crtlab-backtester — it failed 3× on 11-10 and 11-11 and the supervisor never saw it
// (it only read this repo). Watched repos: this one (github.token) + the backtester (GH_WATCH_TOKEN = the cron worker's PAT).
const WATCH = [[REPO, GH], ["kaibranca/crtlab-backtester", { accept: GH.accept, ...(process.env.GH_WATCH_TOKEN ? { authorization: `Bearer ${process.env.GH_WATCH_TOKEN}` } : {}) }]];
for (const [REPO, GH] of WATCH) try {
  const since = new Date(NOW - 26 * H).toISOString();
  const r = { workflow_runs: [] };
  for (let pg = 1; pg <= 4; pg++) { const x = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=100&page=${pg}&created=>${since}`, { headers: GH }).then((y) => y.json());
    if (!Array.isArray(x.workflow_runs)) { if (pg === 1) { r.workflow_runs = null; r.message = x.message; } break; }
    r.workflow_runs.push(...x.workflow_runs); if (x.workflow_runs.length < 100) break; }
  if (!Array.isArray(r.workflow_runs)) throw new Error(r.message ?? "no runs in answer"); // never read "can't see" as "all fine"
  for (const run of (r.workflow_runs ?? []).filter((w) => w.status === "completed")) {
    if (run.conclusion === "success" && (!lastGreen[run.name] || run.updated_at > lastGreen[run.name])) lastGreen[run.name] = run.updated_at;
    if (run.conclusion === "success") { // a green run can still hide a quietly failed step
      const jb = await fetch(run.jobs_url, { headers: GH }).then((x) => x.json()).catch(() => ({}));
      for (const j of jb.jobs ?? []) for (const st of j.steps ?? []) if (st.conclusion === "failure") mistakes.push({ where: `${run.name} → ${st.name}`, what: "step failed (run continued)", at: st.completed_at ?? run.updated_at, url: run.html_url });
    } else if (run.conclusion !== "cancelled" && run.conclusion !== "skipped") mistakes.push({ where: run.name, what: `run ${run.conclusion}`, at: run.updated_at, url: run.html_url });
  }
} catch (e) { mistakes.push({ where: "supervisor", what: `could not read GitHub runs (${REPO.split("/")[1]}): ` + String(e).slice(0, 80), at: new Date().toISOString() }); }
// DATA FRESHNESS (11-11): the one outcome that matters, checked on the live site — not "did a run go green".
// After 07:30 UTC the site must have data through the last weekday before today; before 07:30, the weekday before that.
let dataStale = null;
try {
  const dv = await fetch("https://crtlab.pro/api/data-version", { headers: { "user-agent": "crtlab-supervisor" } }).then((r) => r.json());
  const d = new Date(NOW); d.setUTCHours(0, 0, 0, 0); if (NOW - d.getTime() < 7.5 * H) d.setUTCDate(d.getUTCDate() - 1);
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  const want = d.toISOString().slice(0, 10);
  if (!dv?.end || dv.end < want) { dataStale = { want, have: dv?.end ?? "unknown", live: dv?.live ?? "?" }; fix.unshift(`DAILY DATA BEHIND: site data through ${dataStale.have}, should be ${want} (live ${dataStale.live})`); mistakes.push({ where: "Daily data (live site)", what: `data through ${dataStale.have}, expected ${want}`, at: new Date(Math.floor(NOW / H) * H).toISOString() }); }
} catch (e) { fix.unshift("DAILY DATA: could not read crtlab.pro/api/data-version — " + String(e).slice(0, 60)); }
for (const r of readLines("data/ai/runs.jsonl").filter((r) => NOW - Date.parse(r.at) < 26 * H && /HTTP (?!200)/.test(r.bing ?? ""))) mistakes.push({ where: "AI machine → Bing", what: `send refused (${r.bing})`, at: r.at });
for (const l of men?.log ?? []) mistakes.push({ where: "Mentions machine", what: l, at: men.at });
const MK = "data/machines/mistakes.jsonl", seenM = new Set(readLines(MK).map((m) => m.where + "|" + m.at));
for (const m of mistakes) if (!seenM.has(m.where + "|" + m.at)) append(MK, m);
const week = readLines(MK).filter((m) => NOW - Date.parse(m.at) < 7 * DAY && !(lastGreen[m.where] && m.at < lastGreen[m.where])), per = {};
for (const m of week) (per[m.where] ??= []).push(m);
const mistakeRows = Object.entries(per).map(([where, xs]) => ({ where, n: xs.length, last: xs.at(-1).what, at: xs.at(-1).at, repeating: xs.length >= 3, url: xs.at(-1).url ?? null })).sort((a, b) => b.n - a.n);
for (const m of mistakeRows.filter((x) => x.repeating)) fix.push(`${m.where} failed ${m.n}× this week (last: ${m.last})`);
for (const m of mistakeRows) add(`mistake|${m.where}|${iso(Date.parse(m.at))}`, "supervisor", "mistake", `${m.where}: ${m.last}`);

const out = { at: new Date().toISOString(), ok: status.filter((s) => s.state === "ok").length, total: status.length, hurting, status, allIn: allIn.slice(0, 12), ledger: readLines(LED).slice(-30).reverse(), fix, mistakes: mistakeRows.slice(0, 12) };
fs.mkdirSync("data/machines", { recursive: true });
fs.writeFileSync("data/machines/status.json", JSON.stringify(out, null, 1));

// email when a machine stops (once per machine per day)
const ST = "data/machines/alerted.json", al = J(ST, {});
const stopped = [...status.filter((s) => s.state === "STOPPED" && al[s.id] !== iso(NOW)),
  ...(dataStale && al["m:data-fresh"] !== iso(NOW) ? [{ id: "m:data-fresh", name: "Daily data", lastRunH: `BEHIND — site data through ${dataStale.have}, should be ${dataStale.want} (live ${dataStale.live}). Check gh run list -R kaibranca/crtlab-backtester -w daily-data.yml`, everyH: "daily 06:15 UTC" }] : []),
  ...mistakeRows.filter((m) => m.repeating && al["m:" + m.where] !== iso(NOW)).map((m) => ({ id: "m:" + m.where, name: m.where, lastRunH: `failing (${m.n}× in 7 days: ${m.last})`, everyH: "–" }))];
if (stopped.length && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB supervisor: ${stopped.length} machine problem(s) — ${stopped.map((s) => s.name).join(", ").slice(0, 80)}`, text: stopped.map((s) => `• ${s.name}: ${typeof s.lastRunH === "string" ? s.lastRunH : `last run ${s.lastRunH ?? "never"} h ago (normal every ${s.everyH} h)`}`).join("\n") }) }).catch(() => null);
  if (e?.ok) { for (const s of stopped) al[s.id] = iso(NOW); fs.writeFileSync(ST, JSON.stringify(al)); }
}
console.log(`supervisor: ${out.ok}/${out.total} ok · ${mistakeRows.length} failing steps · ${out.allIn.length} all-in moves · ${fix.length} to fix${fix.length ? "\n  - " + fix.join("\n  - ") : ""}`);
