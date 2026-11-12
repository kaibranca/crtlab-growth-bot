// SELF-MODEL (11-12, Kai: "the ecosystem should act alive, conscious in a way, like a brain — every part reads all the
// analytics on itself, understands its level, reads the front end, its own IQ and power"). Each hour, after iq.mjs:
//   SENSE   every machine reads itself: its IQ now and 7 d ago, what that IQ is made of, its run state, its outcome KPI,
//           the verdicts on the upgrades we gave it — the same numbers /machine shows (this file IS the page's numbers).
//   KNOW    a level (Blank 70 · Novice · Capable · Strong · Expert) and ONE limit: the thing capping its IQ right now
//           ("acts but never judges an outcome", "judges but rests on little evidence", "no outcome KPI to learn from" …).
//   ENGINES each engine (main + traffic + the 7 brains) knows its own IQ = its members' mean, its trend, its weakest and
//           strongest part, and says it in the first person in its briefing.
//   ACT     CURIOSITY: an engine whose IQ stalls (< +0.5 in 7 d) explores more — ×1.1 an hour up to ×1.6, easing back ×0.95
//           when it learns again. Real hands: the AI machine's explore share (15 % × traffic curiosity) and the conversion
//           bandit's explore rate (× money curiosity). Every curiosity episode is JUDGED when it ends: did IQ start climbing
//           again (win) or not (loss) → ledger, so the self-model learns whether its own curiosity pays.
// Light by design: it reads files the machines already wrote; no database, no network.
import fs from "node:fs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/machines/self.json";
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const append = (f, o) => fs.appendFileSync(f, JSON.stringify(o) + "\n");
const IQ = J("data/machines/iq.json", {}), HIST = J("data/machines/iq-machines.json", { days: {} }).days ?? {};
const eco = J("data/machines/ecosystem.json", {}), nodes = (eco.nodes ?? []).filter((n) => !n.id.startsWith("lead-"));
const KPI = J("data/machines/outcomes.json", {})?.kpi ?? {}, UPG = J("data/machines/upgrades.json", {}), prev = J(OUT, {});
const per = IQ.per ?? {}, parts = IQ.perParts ?? {}, iqOf = (id) => per[id] ?? 70;
const days = Object.keys(HIST).sort(), today = days.at(-1), wkAgo = new Date(NOW - 7 * DAY).toISOString().slice(0, 10);
const then = days.filter((d) => d <= wkAgo).at(-1) ?? days[0]; // the oldest we have until 7 days of history exist
const iqThen = (id) => (then ? HIST[then]?.[id] ?? 70 : null);
const fd = (d) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const level = (q) => (q < 72 ? "Blank" : q < 85 ? "Novice" : q < 100 ? "Capable" : q < 115 ? "Strong" : "Expert");

// ── every machine reads itself ──
const upgOf = (id) => { const j = (UPG.judged ?? []).filter((x) => x.machine === id && x.verdict !== "unjudgeable"), o = (UPG.open ?? []).filter((x) => x.machine === id);
  return { paid: j.filter((x) => x.verdict === "paid").length, hurt: j.filter((x) => x.verdict === "hurt").length, flat: j.filter((x) => x.verdict === "flat").length, waiting: o.length }; };
function limitOf(n, p, k) {
  if (!p) return n.kpi?.activity || !KPI[n.id] ? "acts but learns nothing from what happens next — no outcome to judge itself by" : "acts but never judges its outcome — it has a KPI it doesn't learn from";
  if (!p.v && p.e) return "collects evidence but hasn't reached a verdict yet";
  if (p.v && p.e < 20 && !p.k) return "judges, but on little evidence — verdicts rest on a handful of cases";
  if (k?.change != null && k.change < -0.1) return `its outcome is falling (${k.label} ${Math.round(k.change * 100)}%)`;
  if (!p.k) return "learns case by case but no lasting fact has formed yet";
  return "learning on every front — more data is the only limit";
}
const machines = {};
for (const n of nodes) {
  const q = iqOf(n.id), q0 = iqThen(n.id), k = KPI[n.id] && !KPI[n.id].activity ? KPI[n.id] : null;
  machines[n.id] = { name: n.name, iq: q, iqWas: q0, level: level(q), state: n.state, kpi: k ? { label: k.label, now: k.now, before: k.before, change: k.change } : null,
    made: parts[n.id] ?? null, upgrades: upgOf(n.id), limit: limitOf(n, parts[n.id], k) };
}

// ── engines read themselves ──
const ENG = { main: null, traffic: "data/traffic/ecosystem.json", money: "data/brains/money/ecosystem.json", data: "data/brains/data/ecosystem.json", security: "data/brains/security/ecosystem.json",
  content: "data/brains/content/ecosystem.json", retention: "data/brains/retention/ecosystem.json", speed: "data/brains/speed/ecosystem.json", fixer: "data/brains/fixer/ecosystem.json" };
const GROUP = { traffic: "traffic", money: "conversion", content: "content", security: "security" }; // a machine's section joins its engine too
const LED = fs.existsSync("data/machines/ledger.jsonl") ? fs.readFileSync("data/machines/ledger.jsonl", "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : [];
const engines = {};
for (const [e, f] of Object.entries(ENG)) {
  const ids = e === "main" ? nodes.map((n) => n.id) : [...new Set([...(J(f, {})?.nodes ?? []).map((n) => n.id), ...nodes.filter((n) => n.group === GROUP[e]).map((n) => n.id)])].filter((id) => machines[id] && id !== "core");
  // the engine's own brain: its verdicts in the ledger are its learning (money, data, … write as themselves)
  const brB = e === "main" || e === "traffic" ? [] : (J(`data/brains/${e}/branches.json`, {})?.branches ?? []);
  const brainV = e === "main" ? 0 : LED.filter((l) => l.machine === e && ["win", "loss", "lesson"].includes(l.kind)).length + brB.filter((b) => b.state && !/open|alive/.test(b.state)).length;
  const brainIQ = 70 + 10 * Math.log2(1 + brainV);
  const qs = ids.map((id) => machines[id].iq), q = ids.length ? (e === "main" ? IQ.points?.at(-1)?.iq ?? 70 : (qs.reduce((a, b) => a + b, 0) + brainIQ) / (qs.length + 1)) : brainIQ;
  const q0s = ids.map((id) => machines[id].iqWas ?? 70), q0 = e === "main" ? (IQ.points ?? []).find((p) => p.t.slice(0, 10) >= (then ?? "")) ?.iq ?? null : ids.length ? (q0s.reduce((a, b) => a + b, 0) + 70 + 10 * Math.log2(1 + LED.filter((l) => l.machine === e && ["win", "loss", "lesson"].includes(l.kind) && l.at.slice(0, 10) <= (then ?? "")).length)) / (q0s.length + 1) : null;
  const sorted = ids.map((id) => ({ id, name: machines[id].name, iq: machines[id].iq, limit: machines[id].limit })).sort((a, b) => a.iq - b.iq);
  const d = q0 == null ? null : +(q - q0).toFixed(1), learners = sorted.filter((x) => x.iq > 70).length;
  // CURIOSITY: stalls → explore more; learning again → ease back. Needs 3 days of history before it moves.
  const P = prev.engines?.[e] ?? {}, c0 = P.curiosity ?? 1, histDays = days.length;
  const stalled = histDays >= 3 && d != null && d < 0.5;
  const c = +(stalled ? Math.min(1.6, c0 * 1.1) : Math.max(1, c0 * 0.95)).toFixed(3);
  const ep = P.episode ?? null;
  let episode = ep;
  if (c > 1.05 && !ep) episode = { since: new Date().toISOString(), iq0: +q.toFixed(1) };
  if (c <= 1.0001 && ep) { // the episode ended: did curiosity get it learning again?
    const gain = +(q - ep.iq0).toFixed(1), paid = gain >= 1;
    append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `self|${e}|${ep.since}`, machine: "self", kind: paid ? "win" : "loss", what: `${e} engine curiosity episode (${((NOW - Date.parse(ep.since)) / 3.6e6).toFixed(0)} h): IQ ${ep.iq0} → ${q.toFixed(1)} (${gain >= 0 ? "+" : ""}${gain})` });
    episode = null;
  }
  const weakest = sorted.filter((x) => x.iq <= 72).slice(0, 3), strongest = [...sorted].reverse().slice(0, 2);
  const say = `My IQ is ${q.toFixed(1)} (${level(q)}${d != null ? `, ${d >= 0 ? "+" : "−"}${Math.abs(d)} since ${fd(then)}` : ""}) — ${learners} of ${ids.length} parts learn on their own` +
    (weakest.length ? `; weakest: ${weakest.map((x) => x.name).join(", ")} (${weakest[0].limit})` : "") + (c > 1.05 ? `; I'm stalling, so I explore ×${c} harder` : "") + ".";
  engines[e] = { iq: +q.toFixed(1), iqWas: q0 == null ? null : +q0.toFixed(1), since: then, level: level(q), members: ids.length, learners, brainVerdicts: brainV, curiosity: c, episode, weakest, strongest, say };
}

// ── the whole: power vs IQ — is what we build making it smarter? ──
const pts = IQ.points ?? [], last = pts.at(-1), first = pts.find((p) => p.t.slice(0, 10) >= (then ?? "")) ?? pts[0];
const dIQ = last && first ? +(last.iq - first.iq).toFixed(1) : null, dP = last && first ? (last.power ?? 0) - (first.power ?? 0) : null;
const whole = { iq: last?.iq ?? null, power: last?.power ?? null, dIQ, dPower: dP, iqPerUpgrade: dIQ != null && dP ? +(dIQ / dP).toFixed(3) : null, upgrades: UPG.summary ?? null,
  say: last ? `Machines IQ ${last.iq} (${dIQ >= 0 ? "+" : ""}${dIQ} since ${fd(then)}) on ${dP} upgrades — ${dIQ != null && dP ? (dIQ / dP).toFixed(2) : "–"} IQ per upgrade. ${UPG.summary?.judged ? `${UPG.summary.paid} of ${UPG.summary.judged} judged upgrades paid.` : `Upgrades get their first verdicts ${UPG.summary?.next ? fd(UPG.summary.next) : "after 7 days"}.`}` : "" };

// ── BUILD QUEUE (the builder's input — a Claude session or the daily builder routine; BUILDER.md): what the machines say
// would make them smarter, ranked. Score = engine weight (the executive's constraint first) × how cheap the gain is.
const EX = J("data/machines/executive.json", {})?.constraint ?? "conversion";
const W = { traffic: EX === "reach" ? 3 : 2, money: EX === "conversion" || EX === "signup" || EX === "pay" ? 3 : 2, retention: 2, content: 1.5, speed: 1, data: 1, security: 1, fixer: 1 };
const engOf = (id) => Object.entries(engines).find(([e, x]) => e !== "main" && ((x.weakest ?? []).some((w) => w.id === id) || (x.strongest ?? []).some((w) => w.id === id)))?.[0]
  ?? Object.entries(ENG).find(([e, f]) => f && (J(f, {})?.nodes ?? []).some((n) => n.id === id))?.[0] ?? "main";
const queue = [];
for (const [id, m] of Object.entries(machines)) {
  if (m.iq > 72 && !/falling/.test(m.limit)) continue;
  const e = engOf(id), cheap = m.kpi ? 3 : /evidence but/.test(m.limit) ? 2 : 1; // a KPI it doesn't learn from = the cheapest win
  const falling = m.iq > 72;
  queue.push({ kind: falling ? "outcome" : "learn", machine: id, name: m.name, engine: e,
    what: falling ? `${m.name} (IQ ${m.iq}) learns, but its outcome falls — find what it's missing` : `Teach ${m.name} to judge itself on ${m.kpi ? `its KPI (${m.kpi.label})` : "an outcome it can measure"}`,
    why: m.limit, score: +((W[e] ?? 1) * (falling ? 2 : cheap)).toFixed(1) });
}
// IQ DROP WATCH: real learning doesn't vanish — a machine down ≥ 5 IQ on yesterday lost an input (file gone, read failing)
{ const yd = days.filter((d) => d < today).at(-1);
  if (yd) for (const [id, m] of Object.entries(machines)) { const was = HIST[yd]?.[id] ?? 70; if (was - m.iq >= 5) queue.push({ kind: "fix", machine: id, name: m.name, engine: engOf(id), what: `${m.name} lost ${was - m.iq} IQ since ${fd(yd)} (${was} → ${m.iq})`, why: "learning doesn't vanish — an input it learns from broke (file missing, read failing, reset state)", score: 5 }); } }
for (const t of J("data/machines/fixer.json", {})?.tasks ?? []) queue.push({ kind: "fix", what: t.what, why: t.fix, engine: "fixer", score: 4 });
const ADMIN = Object.keys(ENG).filter((e) => e !== "main" && e !== "traffic").flatMap((e) => (J(`data/brains/${e}/ecosystem.json`, {})?.briefing?.notes ?? []).filter((n) => /^BUILD|build/i.test(n)).slice(0, 2).map((n) => ({ kind: "build", what: n.replace(/^BUILD \d+ \([^)]*\)\.?\s*/, ""), why: `${e} brain asks for it`, engine: e, score: 3 })));
queue.push(...ADMIN);
// THE BUILDER LEARNS HOW TO UPGRADE: every judged upgrade (upgrades.json) is evidence about where building pays. Per engine,
// paid-rate Beta(1 + paid, 1 + hurt) with flats as half-misses → the queue's engine weight × (0.5 + rate): engines whose
// upgrades keep paying rise, ones whose upgrades hurt sink. Starts neutral (×1) until verdicts exist (from 11-19).
const payRate = {};
for (const j of (UPG.judged ?? []).filter((x) => x.verdict !== "unjudgeable")) { const e = engOf(j.machine), r = (payRate[e] ??= { paid: 0, miss: 0 }); if (j.verdict === "paid") r.paid++; else r.miss += j.verdict === "hurt" ? 1 : 0.5; }
for (const q of queue) { const r = payRate[q.engine]; q.buildPays = r ? +((1 + r.paid) / (2 + r.paid + r.miss)).toFixed(2) : 0.5; q.score = +(q.score * (0.5 + q.buildPays)).toFixed(2); }
queue.sort((a, b) => b.score - a.score);
fs.writeFileSync("data/machines/build-queue.json", JSON.stringify({ at: new Date().toISOString(), constraint: EX, buildPays: payRate, note: "Ranked by what makes the machines smarter where the constraint is. Builder: take the top item you can finish, see BUILDER.md.", items: queue.slice(0, 25) }, null, 1));

// ── EXPERIMENTS: every live test in the ecosystem, its read so far and when its next verdict lands (one place to look) ──
const ex = [], add = (name, owner, status, next, read) => ex.push({ name, owner, status, next: next ?? null, read: read ?? null });
const plusD = (t, d) => iso2(Date.parse(t) + d * DAY), iso2 = (t) => new Date(t).toISOString().slice(0, 10);
for (const [id, k] of Object.entries(J("data/machines/knobs.json", {})?.knobs ?? {})) if (k.challenge) add(`tuner ${id} ${k.champion} vs ${k.challenge.value}`, k.owner, "running", plusD(k.challenge.since + "T12:00:00Z", 20), k.challenge.read?.lift ? `×${k.challenge.read.lift} (P ${k.challenge.read.P ?? "—"})` : `${(k.challenge.read?.blocksA ?? 0) + (k.challenge.read?.blocksB ?? 0)} blocks`);
for (const e of (J("data/ai/hooks.json", {})?.experiments ?? []).filter((x) => x.status === "running")) add(`hook ${e.id}`, "hooks", "running", plusD(e.started, e.last?.grain === "2h" ? 5 : 7), e.last ? `${e.last.B?.clicks ?? 0}/${e.last.B?.fetches ?? 0} vs ${e.last.A?.clicks ?? 0}/${e.last.A?.fetches ?? 0} (P ${e.last.pBbeatsA})` : null);
{ const B = J("data/ai/bandit.json", {}); if (B.families) add(`conversion bandit (${Object.keys(B.families).length} families × 5 wordings)`, "bandit", "running", "2026-11-14", null); }
{ const H = J("data/ai/holdout.json", {}); if (H.last) add(`holdout ${H.pct}% of pages never pushed`, "holdout", "running", null, H.last.pushLift != null ? `push lift ×${H.last.pushLift}` : `provisional ×${H.last.provisional ?? "—"}`); }
{ const C = J("data/retention/comeback.json", {}); if (C.read) add(`comeback email (${C.read.sent} sent / ${C.read.held} held)`, "retention", C.on === false ? `paused (${C.pausedBy ?? "brain"})` : "running", "2026-11-19", C.read.pWin != null ? `P(sent wins) ${C.read.pWin}` : null); }
{ const X = J("data/machines/executive.json", {}).history?.at(-1); if (X && !X.ended) add(`executive focus: ${X.constraint}`, "executive", "running", plusD(X.since, 3), `click rate at start ${X.rate0}`); }
if (UPG.summary) add(`upgrade judge (${UPG.summary.waiting} waiting)`, "upgrades", "running", UPG.summary.next, UPG.summary.judged ? `${UPG.summary.paid}/${UPG.summary.judged} paid` : null);
{ const SK = fs.existsSync("data/world/skill.jsonl") ? fs.readFileSync("data/world/skill.jsonl", "utf8").split("\n").filter(Boolean).length : 0; add("forecast self-calibration (trend α)", "world", SK >= 3 ? "learning" : "grading", SK >= 3 ? null : plusD(new Date().toISOString(), 3 - SK + 1), `${SK} forecasts graded`); }
{ const Y = J("data/ai/plan.json", {})?.learned?.sendYield; add("Bing send yield (hit = live read in 3 d)", "yield", Y?.judged ? "learning" : "waiting", Y?.judged ? null : "2026-11-13", Y?.judged ? `${Y.judged} judged, ${Math.round(Y.overall * 100)}% hit` : null); }
ex.sort((a, b) => (a.next ?? "9") .localeCompare(b.next ?? "9"));
const soon = ex.filter((x) => x.next).slice(0, 4).map((x) => `${x.name.split(" (")[0]} ${fd(x.next)}`);
const exSay = `${ex.length} experiments live — next verdicts: ${soon.join(" · ")}.`;
fs.writeFileSync("data/machines/experiments.json", JSON.stringify({ at: new Date().toISOString(), say: exSay, experiments: ex }, null, 1));
whole.experiments = exSay;

fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), note: "Each machine and engine reading itself (IQ, level, limit, KPI, upgrades); engines' curiosity knobs. Read by core, traffic-core, brains, ai-machine, bandit.", whole, engines, machines }, null, 1));
console.log(`self: ${Object.entries(engines).map(([e, x]) => `${e} ${x.iq}${x.curiosity > 1.0001 ? ` c×${x.curiosity}` : ""}`).join(" · ")}`);
