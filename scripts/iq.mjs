// MACHINES IQ + MACHINES POWER (Kai 11-12: "IQ = what they learn, how they progress with us NOT involved, with a graph;
// POWER = us improving the machines that improve the IQ").
//  IQ    — only what the machines learned by themselves from live data, averaged per machine:
//          knows   = long-term facts × strength (knowledge.json)
//          judged  = decisions they judged on their own (ledger wins/lessons/losses, branches kept/retired,
//                    hook tests ended, cost fixes + levers with a verdict, deploys judged, neurons with evidence)
//          evidence= data their models rest on (world page-days, neuron samples, bandit judged views)
//          fixed   = their own repairs that worked (fixer actions ok)
//          each credited to the machine that learned it; IQ per machine, MACHINES IQ = mean over every machine.
//          A machine that has learned nothing scores 70 and pulls the average DOWN until it learns — that is the point.
//  POWER — upgrades WE build into them: human (non-bot) commits to the machine code, cumulative.
// Writes data/machines/iq.json { at, points:[{t, iq, power, parts}] } (3-hour points; the current one rewritten each hour).
// `node scripts/iq.mjs --backfill` (local, full git history) rebuilds 3-hour points since 11-11 (engine birth) from git.
import fs from "node:fs";
import { execSync } from "node:child_process";

const OUT = "data/machines/iq.json", BOT = "crtlab-growth-bot";
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64e6 }); } catch { return null; } };
const parse = (t, p) => { if (t == null) return null; try { return p.endsWith(".jsonl") ? t.split("\n").filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(t); } catch { return null; } };
const reader = (sha) => (p) => parse(sha ? sh(`git show ${sha}:${p}`) : (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), p);

// WHO LEARNED IT: ledger "machine" names and fact ids → the /machine node that did the learning
const LED = { convergence: "traffic-brain", converter: "traffic-brain", neurons: "traffic-brain", rank: "traffic-brain", surges: "surge", supervisor: "mistakes", modes: "mode", events: "lift", demand: "lift" };
const FACT = [[/^(world|curve)/, "world"], [/^release-lift/, "lift"], [/^(prior|sign):/, "traffic-brain"], [/^cost/, "cost"], [/^google/, "google"]];
const n0 = (x) => (Array.isArray(x) ? x.length : 0);

export function measure(R) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const M = {}; // id → { judged (cumulative), knows, evidence, fixed }
  const at = (id) => (M[id] ??= { judged: 0, knows: 0, evidence: 0, fixed: 0 });
  // knows: long-term facts × strength, credited to the machine whose data taught it (else the memory machine)
  const facts = Object.entries(R("data/machines/knowledge.json")?.facts ?? {});
  for (const [id, f] of facts) at(FACT.find(([re]) => re.test(id))?.[1] ?? "memory").knows += +f.strength || 0;
  // judged: verdicts they reached on their own
  for (const l of [...arr(R("data/machines/ledger.jsonl")), ...arr(R("data/traffic/ledger.jsonl"))]) if (["win", "loss", "lesson", "mistake"].includes(l.kind)) at(LED[l.machine] ?? l.machine).judged++;
  for (const b of arr(R("data/machines/spawned.json")?.branches)) if (b.state && b.state !== "alive") at("core").judged++;
  for (const b of arr(R("data/traffic/branches.json")?.branches)) if (b.state && b.state !== "alive") at("traffic-brain").judged++;
  const hooks = arr(R("data/ai/hooks.json")?.experiments);
  at("hooks").judged += hooks.filter((e) => e.ended || (e.status && !/run|live|on/.test(e.status))).length;
  at("hooks").evidence += hooks.reduce((t, e) => t + (e.last?.A?.reads ?? e.last?.A?.fetches ?? 0) + (e.last?.B?.reads ?? e.last?.B?.fetches ?? 0), 0);
  const cost = R("data/cost/state.json") ?? {};
  at("cost").judged += arr(cost.fixes).filter((f) => f.verdict).length + arr(cost.levers).filter((l) => l.verdict && l.verdict !== "judging").length;
  at("deployjudge").judged += arr(R("data/machines/deploys.jsonl")).filter((d) => d.verdict || d.judged).length;
  at("cost").judged += arr(R("data/cost/deploys.jsonl")).filter((d) => d.verdict || d.judged).length;
  const neurons = Object.values(R("data/traffic/brain.json")?.w ?? {});
  at("traffic-brain").judged += neurons.filter((n) => (n.n ?? 0) > 0).length; // live: a neuron can lose its sample
  // evidence: the rows their models rest on
  at("traffic-brain").evidence += neurons.reduce((t, n) => t + (n.n ?? 0), 0);
  at("world").evidence += (+R("data/world/credit.json")?.pageDays || 0) + n0(R("data/world/sends.jsonl"));
  { const SKL = arr(R("data/world/skill.jsonl")); at("world").evidence += SKL.length * 10; // graded forecasts — predicting is intelligence
    if (SKL.length >= 7) at("world").judged += 1 + SKL.filter((r) => r.skill > 0).length; } // each day it beat "same as last week" = a verdict won
  at("surge").evidence += n0(R("data/ai/surges.jsonl"));
  at("sisters").evidence += n0(R("data/machines/sisters.jsonl"));
  at("radar").evidence += n0(R("data/radar/answers.jsonl"));
  at("recommend").evidence += +R("data/radar/recommend.json")?.asked || 0;
  at("mentions").evidence += n0(R("data/mentions/mentions.jsonl"));
  at("google").evidence += n0(R("data/google/days.jsonl"));
  at("leak").evidence += n0(R("data/leak/score.jsonl"));
  at("holdout").evidence += +R("data/ai/holdout.json")?.last?.heldPages || 0;
  for (const f of Object.values(R("data/ai/bandit.json")?.families ?? {})) for (const a of Object.values(f.stats?.arms ?? {})) at("bandit").evidence += (a.views ?? 0) / 10 + (a.fetches ?? 0);
  // the AI referral machine's own learned model (data/ai/plan.json): page-family values, weekday peaks, release lift,
  // Bing yield, crawl lag — each credited to the machine named for it on /machine
  const P = R("data/ai/plan.json") ?? {}, L = P.learned ?? {};
  at("ai").evidence += n0(P.families) * 10;
  at("ai").judged += arr(P.verdicts).filter((v) => v.verdict && !/measuring|waiting/i.test(v.verdict)).length;
  at("weekly").evidence += (L.weekly?.daysSeen ?? []).reduce((t, v) => t + v, 0) * n0(L.weekly?.peaks);
  at("lift").evidence += Object.keys(P.releaseLift?.byRelease ?? {}).length * 5;
  at("yield").judged += +L.sendYield?.judged || 0;
  at("rising").evidence += n0(P.rising) * 5;
  at("eyes").evidence += (+L.bingChecked || 0) + Object.values(L.famLagH ?? {}).reduce((t, f) => t + (f.n ?? 0), 0) * 5;
  for (const r of Object.values(R("data/machines/rhythm.json") ?? {})) at("supervisor").evidence += (r.gaps?.length ?? 0) * 5 + (r.learned ? 20 : 0); // learned cadences
  // behaviour: which first-day actions bring people back — each confident finding (conf ≥ 0.8) is a verdict, days = evidence
  { const B = R("data/behaviour/plan.json") ?? {};
    for (const g of ["golden", "anti", "stalls"]) for (const dev of Object.values(B[g] ?? {})) at("behaviour").judged += arr(dev?.top).filter((x) => (x.conf ?? 0) >= 0.8).length;
    at("behaviour").evidence += (+B.daysLearned || 0) * 10; }
  at("humans").evidence += n0(R("data/machines/humans.json")?.segments) * 5; // segments it learned the normal of
  { const L2 = R("data/leak/plan.json") ?? {}; at("leak").evidence += n0(L2.leaks) * 5; at("leak").judged += n0(L2.verdicts); }
  // THE WORLD MODEL JUDGES EVERY ACTING MACHINE (treated page-days vs untouched pages, same family + day, bootstrap CI):
  // the machine that took the action owns the result — a settled WORKS / HURTS is its verdict, treated page-days its evidence
  { const WC = R("data/world/credit.json")?.credit ?? {}, OWN = { "bing-send": "bing", "llms-listed": "curator", "brain-boost": "traffic-brain", "sister-spread": "sisters", "lock-in": "lockin", "indexnow-send": "indexnow" };
    for (const [a, id] of Object.entries(OWN)) { const c = WC[a]; if (!c?.units) continue; at(id).evidence += c.units; if (c.verdict === "WORKS" || c.verdict === "HURTS") at(id).judged += 1 + Object.values(c.byFamily ?? {}).filter((f) => f.verdict === "WORKS" || f.verdict === "HURTS").length; } }
  // self-tuning knobs: blocks judged so far are evidence for the knob's owner (verdicts reach it through the ledger)
  { for (const [id, k] of Object.entries(R("data/machines/knobs.json")?.knobs ?? {})) { const o = k.owner; if (o) at(o).evidence += ((k.challenge?.read?.blocksA ?? 0) + (k.challenge?.read?.blocksB ?? 0)) * 5 + (k.history?.length ?? 0) * 20; } }
  // fixed: its own repairs that worked
  at("fixer").fixed += arr(R("data/machines/fixer.json")?.actions).filter((a) => a.ok).length;
  // every machine counts in the average, also the ones that learned nothing (lead summaries are not machines)
  const eco = R("data/machines/ecosystem.json");
  const ids = (eco?.nodes ?? []).map((n) => n.id).filter((id) => !id.startsWith("lead-"));
  return { M, ids, facts: facts.length };
}
// PER MACHINE: IQ_i = 70 + 10·log2(1 + E_i/10), E_i = 10·knows + 10·judged + evidence/5 + 5·fixed
//   70 = learned nothing · one verdict ≈ 80 · ten ≈ 105 · a hundred ≈ 137. MACHINES IQ = the mean over every machine.
// RATCHET: pruned logs are not forgetting — a machine's cumulative verdicts never count down (hi[id]). Facts, evidence
// and neurons CAN fall (a fact decays, a model loses its sample) and that is shown as it is.
function score(m, hi) {
  const per = {}, parts = {};
  const ids = m.ids, lost = Object.keys(m.M).filter((id) => !ids.includes(id) && Object.values(m.M[id]).some(Boolean));
  if (lost.length && !score.warned) { score.warned = 1; console.log(`iq: learning credited to unknown machines (map them): ${lost.join(", ")}`); }
  if (!m.ids.length) return { iq: 70, per, parts: { knows: 0, facts: 0, judged: 0, evidence: 0, fixed: 0, machines: 0, learners: 0 } };
  let k = 0, j = 0, ev = 0, fx = 0, learners = 0, sum = 0;
  for (const id of ids) {
    const x = m.M[id] ?? { judged: 0, knows: 0, evidence: 0, fixed: 0 };
    const judged = (hi[id] = Math.max(hi[id] ?? 0, x.judged)), fixed = (hi["fix:" + id] = Math.max(hi["fix:" + id] ?? 0, x.fixed));
    const E = 10 * x.knows + 10 * judged + x.evidence / 5 + 5 * fixed, q = 70 + 10 * Math.log2(1 + E / 10);
    sum += q; if (E > 0) { learners++; per[id] = Math.round(q); }
    if (E > 0) parts[id] = { v: judged, k: +x.knows.toFixed(2), e: Math.round(x.evidence), f: fixed };
    k += x.knows; j += judged; ev += x.evidence; fx += fixed;
  }
  score.parts = parts; // what each learner's IQ is made of (v verdicts · k facts · e evidence · f fixes) — the self-model reads it
  return { iq: Math.round((sum / ids.length) * 10) / 10, per, parts: { knows: +k.toFixed(1), facts: m.facts, judged: j, evidence: Math.round(ev), fixed: fx, machines: ids.length, learners } };
}

// POWER: cumulative upgrades WE committed to the machines. My upgrades are pushed under the bot's name too, so the
// split is by message: the machines' own run commits ("hourly 2026-…", "health …", "reels post …") are not upgrades.
const AUTO = /^(hourly|health|daily|weekly|recap|reels plan|reels post|device qa|restore test|radar|google|analyst|ai eyes|ledger:)\b/i;
async function upgrades() {
  const at = [];
  const log = sh(`TZ=UTC git log --format='%cI|%s'`);
  if (!process.env.IQ_API && log && log.split("\n").length > 50) {
    for (const l of log.split("\n").filter(Boolean)) { const i = l.indexOf("|"); if (!AUTO.test(l.slice(i + 1))) at.push(new Date(l.slice(0, i)).toISOString()); }
    return at;
  }
  const H = { Accept: "application/vnd.github+json", "User-Agent": "crtlab-machines", ...((process.env.GITHUB_TOKEN || process.env.GH_TOKEN) ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}` } : {}) };
  for (let p = 1; p <= 15; p++) {
    const r = await fetch(`https://api.github.com/repos/kaibranca/${BOT}/commits?per_page=100&page=${p}`, { headers: H }).catch(() => null);
    if (!r?.ok) return null;
    const xs = await r.json(); if (!xs.length) break;
    for (const c of xs) if (!AUTO.test(c.commit?.message ?? "")) at.push(c.commit.committer.date);
    if (xs.length < 100) break;
  }
  return at;
}
const upTo = (ups, t) => (ups ? ups.filter((x) => x <= t).length : null);
const slot = (t) => { const d = new Date(t); d.setUTCMinutes(0, 0, 0); d.setUTCHours(d.getUTCHours() - (d.getUTCHours() % 3)); return d.toISOString().slice(0, 13); }; // 3-hour points

const prev = parse(fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null, OUT) ?? { points: [] };
const rows = new Map((prev.points ?? []).map((r) => [r.t, r]));
let hi = prev.hi ?? {};
// PER-MACHINE history (data/machines/iq-machines.json, 90 days, a machine's IQ at the day's last read) — the self-model
// (scripts/self.mjs) reads its own trend from it; the /machine page never loads it (kept light).
const HF = "data/machines/iq-machines.json", HP = parse(fs.existsSync(HF) ? fs.readFileSync(HF, "utf8") : null, HF) ?? { days: {} };
const perDay = new Map(Object.entries(HP.days ?? {}));
const ups = await upgrades();
const nowIso = new Date().toISOString(), cur = slot(nowIso);

if (process.argv.includes("--backfill")) {
  const last = new Map(); // slot → last commit in it
  for (const l of (sh(`TZ=UTC git log --reverse --format='%H|%cI'`) ?? "").split("\n").filter(Boolean)) { const [h, d] = l.split("|"); last.set(slot(d), [h, new Date(d).toISOString()]); }
  hi = {};
  for (const [t, [h, d]] of last) if (t < cur && t >= "2026-11-11") { const { per, ...r } = score(measure(reader(h)), hi); rows.set(t, { t, ...r, power: upTo(ups, d) }); perDay.set(t.slice(0, 10), per); }
}
const { per, ...nowS } = score(measure(reader(null)), hi);
// SELF-MADE POWER: upgrades the machines made to themselves — tuner promotions + curiosity episodes that paid (self.mjs)
const selfUps = (() => { let n = 0; try { for (const k of Object.values(JSON.parse(fs.readFileSync("data/machines/knobs.json", "utf8")).knobs ?? {})) n += (k.history ?? []).filter((h) => h.verdict === "promoted").length; } catch { /* none yet */ }
  try { n += fs.readFileSync("data/machines/ledger.jsonl", "utf8").split("\n").filter((l) => l.includes('"machine":"self"') && l.includes('"kind":"win"')).length; } catch { /* none */ } return n; })();
const ourP = upTo(ups, nowIso) ?? [...rows.values()].at(-1)?.ours ?? null;
const now = { t: cur, ...nowS, ours: ourP, selfPower: selfUps, power: ourP == null ? null : ourP + selfUps };
rows.set(cur, now);
perDay.set(cur.slice(0, 10), per);
fs.writeFileSync(HF, JSON.stringify({ at: nowIso, note: "day → machine → IQ (70 = learned nothing; machines at 70 are left out)", days: Object.fromEntries([...perDay].sort((a, b) => a[0].localeCompare(b[0])).slice(-90)) }));
const points = [...rows.values()].sort((a, b) => a.t.localeCompare(b.t)).slice(-720); // 90 days of 3-hour points
fs.writeFileSync(OUT, JSON.stringify({ at: nowIso, hi, per, perParts: score.parts, note: "IQ = mean of every machine's IQ from what it learned by itself (70 = nothing yet; 1 verdict ≈ 80, 10 ≈ 105, 100 ≈ 137). POWER = upgrades we built into them (non-run commits, cumulative).", points }, null, 1));
console.log(`iq ${now.iq} power ${now.power} · ${JSON.stringify(now.parts)} · ${points.length} points`);
