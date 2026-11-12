// MACHINES IQ + MACHINES POWER (Kai 11-12: "IQ = what they learn, how they progress with us NOT involved, with a graph;
// POWER = us improving the machines that improve the IQ").
//  IQ    — only what the machines learned by themselves from live data, averaged per machine:
//          knows   = long-term facts × strength (knowledge.json)
//          judged  = decisions they judged on their own (ledger wins/lessons/losses, branches kept/retired,
//                    hook tests ended, cost fixes + levers with a verdict, deploys judged, neurons with evidence)
//          evidence= data their models rest on (world page-days, neuron samples, bandit judged views)
//          fixed   = their own repairs that worked (fixer actions ok)
//          IQ = 70 + 15·log2(1 + E / machines), E = 10·knows + 10·judged + evidence/5 + 5·fixed.
//          A new machine that has learned nothing pulls the average DOWN until it learns — that is the point.
//  POWER — upgrades WE build into them: human (non-bot) commits to the machine code, cumulative.
// Writes data/machines/iq.json { at, points:[{t, iq, power, parts}] } (3-hour points; the current one rewritten each hour).
// `node scripts/iq.mjs --backfill` (local, full git history) rebuilds 3-hour points since 11-11 (engine birth) from git.
import fs from "node:fs";
import { execSync } from "node:child_process";

const OUT = "data/machines/iq.json", BOT = "crtlab-growth-bot";
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64e6 }); } catch { return null; } };
const parse = (t, p) => { if (t == null) return null; try { return p.endsWith(".jsonl") ? t.split("\n").filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(t); } catch { return null; } };
const reader = (sha) => (p) => parse(sha ? sh(`git show ${sha}:${p}`) : (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), p);

export function measure(R) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const facts = Object.values(R("data/machines/knowledge.json")?.facts ?? {});
  const knows = facts.reduce((t, f) => t + (+f.strength || 0), 0);
  const led = [...arr(R("data/machines/ledger.jsonl")), ...arr(R("data/traffic/ledger.jsonl"))];
  const ledJ = led.filter((l) => ["win", "loss", "lesson", "mistake"].includes(l.kind)).length;
  const br = [...arr(R("data/machines/spawned.json")?.branches), ...arr(R("data/traffic/branches.json")?.branches)];
  const brJ = br.filter((b) => b.state && b.state !== "alive").length;
  const hooksJ = arr(R("data/ai/hooks.json")?.experiments).filter((e) => e.ended || (e.status && !/run|live|on/.test(e.status))).length;
  const cost = R("data/cost/state.json") ?? {};
  const costJ = arr(cost.fixes).filter((f) => f.verdict).length + arr(cost.levers).filter((l) => l.verdict || l.judged).length;
  const depJ = arr(R("data/machines/deploys.jsonl")).filter((d) => d.verdict || d.judged).length + arr(R("data/cost/deploys.jsonl")).filter((d) => d.verdict || d.judged).length;
  const neurons = Object.values(R("data/traffic/brain.json")?.w ?? {});
  const nJ = neurons.filter((n) => (n.n ?? 0) > 0).length, nN = neurons.reduce((t, n) => t + (n.n ?? 0), 0);
  const cumJ = { ledJ, brJ, hooksJ, costJ, depJ };
  const fams = Object.values(R("data/ai/bandit.json")?.families ?? {});
  const banditN = fams.reduce((t, f) => t + (+f.judged || +f.views || +f.n || 0), 0);
  const evidence = (+R("data/world/credit.json")?.pageDays || 0) + nN + Math.min(5000, banditN) / 10;
  const fixed = arr(R("data/machines/fixer.json")?.actions).filter((a) => a.ok).length;
  const eco = R("data/machines/ecosystem.json");
  const machines = Math.max(1, eco?.totals?.machines ?? eco?.nodes?.length ?? 1);
  return { cumJ, nJ, knows, facts: facts.length, evidence, fixed, machines };
}
// RATCHET: pruned logs (old branches dropped, ledger trimmed) are not forgetting — cumulative judgements never count
// down. Facts and evidence CAN fall (a fact decays, a model loses its sample) and that is shown as it is.
function score(m, hi) {
  for (const [k, v] of Object.entries(m.cumJ)) hi[k] = Math.max(hi[k] ?? 0, v);
  hi.fixed = Math.max(hi.fixed ?? 0, m.fixed);
  const judged = Object.keys(m.cumJ).reduce((t, k) => t + hi[k], 0) + m.nJ, fixed = hi.fixed;
  const E = 10 * m.knows + 10 * judged + m.evidence / 5 + 5 * fixed;
  const iq = Math.round((70 + 15 * Math.log2(1 + E / m.machines)) * 10) / 10;
  return { iq, parts: { knows: +m.knows.toFixed(1), facts: m.facts, judged, evidence: Math.round(m.evidence), fixed, machines: m.machines } };
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
const ups = await upgrades();
const nowIso = new Date().toISOString(), cur = slot(nowIso);

if (process.argv.includes("--backfill")) {
  const last = new Map(); // slot → last commit in it
  for (const l of (sh(`TZ=UTC git log --reverse --format='%H|%cI'`) ?? "").split("\n").filter(Boolean)) { const [h, d] = l.split("|"); last.set(slot(d), [h, new Date(d).toISOString()]); }
  hi = {};
  for (const [t, [h, d]] of last) if (t < cur && t >= "2026-11-11") rows.set(t, { t, ...score(measure(reader(h)), hi), power: upTo(ups, d) });
}
const now = { t: cur, ...score(measure(reader(null)), hi), power: upTo(ups, nowIso) ?? [...rows.values()].at(-1)?.power ?? null };
rows.set(cur, now);
const points = [...rows.values()].sort((a, b) => a.t.localeCompare(b.t)).slice(-240); // 30 days of 3-hour points
fs.writeFileSync(OUT, JSON.stringify({ at: nowIso, hi, note: "IQ = what the machines learned by themselves, per machine (70 = nothing yet; each doubling of learning per machine = +15). POWER = upgrades we built into them (non-run commits, cumulative).", points }, null, 1));
console.log(`iq ${now.iq} power ${now.power} · ${JSON.stringify(now.parts)} · ${points.length} points`);
