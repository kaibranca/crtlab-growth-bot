// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// LONG-TERM MEMORY (11-12 — every engine kept its own ledger and forgot on its own; the AI analyst woke up stateless every
// day). Once a day, like sleep: every engine's verdicts are consolidated into ONE knowledge base of durable facts —
// data/machines/knowledge.json. A fact = { id, topic, claim, n (evidence), strength, first, last, source, contradicted }.
//   • re-confirmed facts get stronger; unconfirmed ones decay (half-life 30 days) and are binned below 0.05
//   • a fact whose direction flips is kept with contradicted: true (the analyst sees the doubt, never a silent rewrite)
// Read by the AI analyst (its memory across days) and shown on /machine. Files only.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/machines/knowledge.json";
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const lines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const KB = J(OUT, { facts: {} });
if (KB.at && NOW - Date.parse(KB.at) < 20 * 3600e3 && !process.env.FORCE) { console.log("memory: consolidated < 20 h ago"); process.exit(0); }
const seen = new Set();
// dir: +1 / −1 / 0 — the fact's direction; a flip marks it contradicted
const fact = (id, topic, claim, n, dir, source) => { seen.add(id); const f = KB.facts[id];
  if (!f) { KB.facts[id] = { id, topic, claim, n, dir, strength: Math.min(1, 0.3 + 0.1 * Math.log2(1 + n)), first: new Date().toISOString(), last: new Date().toISOString(), source }; return; }
  const flip = f.dir && dir && f.dir !== dir; Object.assign(f, { claim, n: Math.max(f.n, n), last: new Date().toISOString(), source, ...(flip ? { contradicted: true, was: f.claim } : {}) });
  f.dir = dir; f.strength = Math.min(1, (flip ? 0.4 : f.strength) + 0.1 * Math.log2(1 + n) / 4); };

// 1. WORLD MODEL credit per action (and per family)
const W = J("data/world/credit.json", null);
for (const [a, c] of Object.entries(W?.credit ?? {})) { if (c.lift == null || !c.units) continue;
  fact(`world:${a}`, "what our actions do", `${a}: ×${c.lift}${c.ci ? ` [${c.ci.join("–")}]` : ""} vs untouched pages (${c.units} page-days) — ${c.verdict ?? "measuring"}`, c.units, c.verdict === "WORKS" ? 1 : c.verdict === "HURTS" ? -1 : 0, "world");
  for (const [fam, x] of Object.entries(c.byFamily ?? {})) fact(`world:${a}:${fam}`, "where our actions pay", `${a} on ${fam}: ×${x.lift} (${x.units} page-days)`, x.units, x.lift > 1.1 ? 1 : x.lift < 0.9 ? -1 : 0, "world"); }
if (W?.curve) fact("curve", "the curve", `reads ${W.curve.reads.perDay}%/day, AI clicks ${W.curve.clicks.perDay}%/day, accounts ${W.curve.accounts.perDay}%/day — gap ${W.curve.gap}%/day`, W.curve.days, W.curve.gap > 2 ? -1 : 1, "world");
if (W?.releaseLift && W.releaseLift !== 1) fact("release-lift", "demand", `release days lift a release's pages ×${W.releaseLift} (learned from residuals)`, W.pageDays ?? 0, 1, "world");
// 2. TRAFFIC BRAIN: pre-trained priors, learned sign weights, judged neurons
const TB = J("data/traffic/brain.json", {});
for (const [k, o] of Object.entries(TB.pretrain?.out ?? {})) if (o.samples) fact(`prior:${k}`, "what history says", `${k}: expected reward ${o.mean} over ${o.samples} past cases`, o.samples, o.mean >= 0.5 ? 1 : -1, "traffic-pretrain");
for (const [k, o] of Object.entries(TB.signW ?? {})) if (o.n) fact(`sign:${k}`, "what predicts clicks", `"${k}" → clicks ×${o.lift} vs any read page (${o.n} moments)`, o.n, o.lift >= 1.2 ? 1 : o.lift <= 0.8 ? -1 : 0, "traffic-pretrain");
for (const [k, w] of Object.entries(TB.w ?? {})) if (w.n >= 2) fact(`neuron:${k}`, "what pays (live)", `${k}: weight ${w.v} after ${w.n} verdicts`, w.n, w.v >= 0.55 ? 1 : w.v <= 0.4 ? -1 : 0, "traffic-brain");
// 3. CONVERSION: bandit wordings, hook lessons, homepage switchback
const BD = J("data/ai/bandit.json", null);
for (const [f, F] of Object.entries(BD?.families ?? {})) for (const [a, x] of Object.entries(F.stats?.arms ?? {})) if (x.fetches >= 100) fact(`wording:${f}:${a}`, "what wording converts", `${f} "${a}": ${x.clicks} clicks / ${x.fetches} people-fetches, P(best) ${(x.pBest * 100).toFixed(0)}%${x.retired ? " — retired" : ""}`, x.fetches, x.retired ? -1 : x.pBest >= 0.6 ? 1 : 0, "bandit");
for (const [t, L] of Object.entries(J("data/ai/lessons.json", {}))) if ((L.won ?? 0) + (L.lost ?? 0)) fact(`hook:${t}`, "what wording converts", `hook "${t}": won ${L.won}, lost ${L.lost}`, L.won + L.lost, L.won > L.lost ? 1 : -1, "hooks");
for (const e of J("data/ai/hooks.json", { experiments: [] }).experiments ?? []) if (e.status === "won" || e.status === "lost") fact(`test:${e.id}`, "what wording converts", `${e.family} "${e.template}": ${e.status}`, 1, e.status === "won" ? 1 : -1, "hooks");
// 4. WAVES, the holdout, the Fixer queue's judged human fixes, the cost machine's fixes, the Google machine
for (const w of lines("data/machines/waves.jsonl").slice(-20)) fact(`wave:${w.since}`, "waves", `${w.kind} wave ${w.since.slice(0, 10)}: sign-ups ×${w.ratio} — ${w.verdict}`, 1, w.verdict === "paid" ? 1 : w.verdict === "false alarm" ? -1 : 0, "lock-in");
const HO = J("data/ai/holdout.json", null); if (HO?.last?.pushLift != null) fact("holdout", "what our actions do", `pushing pages: ×${HO.last.pushLift} vs held-out pages after ${HO.last.days} days`, HO.last.heldPages, HO.last.pushLift > 1.05 ? 1 : HO.last.pushLift < 0.95 ? -1 : 0, "holdout");
for (const q of J("data/brains/fixer/queue.json", {}).queueLog ?? []) fact(`fix:${q.kind}`, "which human fixes pay", `fixing "${q.kind}" moved ${q.brain} ${q.from} → ${q.to} — ${q.paid ? "paid" : "didn't"}`, 1, q.paid ? 1 : -1, "fixer");
for (const x of J("data/cost/plan.json", {}).fixes ?? []) if (x.verdict) fact(`cost:${x.kind}`, "what fixes the servers", `${x.kind} → ${x.action}: ${x.verdict}`, 1, /did not/.test(x.verdict) ? -1 : 1, "cost");
const G = J("data/google/plan.json", null); if (G?.totals) fact("google-coverage", "Google", `Google shows ${G.totals.pagesShown} of ${G.totals.sitemapPages} pages; ${G.totals.indexed}/${G.totals.inspected} inspected indexed; top reason: ${G.reasons?.[0]?.reason ?? "—"}`, G.totals.inspected, G.totals.pagesShown / Math.max(1, G.totals.sitemapPages) > 0.3 ? 1 : -1, "google");
const RC = J("data/radar/recommend.json", null);
if (RC?.asked) { fact("recommend:all", "recommendation", `ChatGPT names CRTLAB in ${((RC.namedRate ?? 0) * 100).toFixed(0)}% of ${RC.asked} buyer answers`, RC.asked, (RC.namedRate ?? 0) >= 0.2 ? 1 : -1, "recommend");
  for (const [k, c] of Object.entries(RC.clusters ?? {})) if (c.asked >= 3) fact(`recommend:${k}`, "who ChatGPT recommends", `"${k}" questions: CRTLAB named ${(c.namedRate * 100).toFixed(0)}%; named instead: ${c.namedInstead.slice(0, 3).join(", ") || "—"}; trusted: ${c.trusted.slice(0, 3).map((x) => x.d).join(", ")}`, c.asked, c.namedRate >= 0.2 ? 1 : -1, "recommend"); }
// 5. EVERY ENGINE'S LEDGER wins/losses (machine + kind of action), last 30 days
const led = [...lines("data/machines/ledger.jsonl"), ...lines("data/traffic/ledger.jsonl")].filter((l) => (l.kind === "win" || l.kind === "loss") && NOW - Date.parse(l.at) < 30 * DAY);
const byM = {}; for (const l of led) { const k = `${l.machine}:${(l.key ?? "").split("|")[0]}`; const o = (byM[k] ??= { w: 0, l: 0 }); l.kind === "win" ? o.w++ : o.l++; }
for (const [k, o] of Object.entries(byM)) fact(`ledger:${k}`, "which machines pay", `${k.replace(":", " · ")}: ${o.w} won, ${o.l} lost (30 d)`, o.w + o.l, o.w > o.l ? 1 : o.l > o.w ? -1 : 0, "ledgers");

// DECAY + BIN: facts not re-confirmed fade (half-life 30 d); below 0.05 they're forgotten
let binned = 0;
for (const [id, f] of Object.entries(KB.facts)) { if (seen.has(id)) continue; const idle = (NOW - Date.parse(f.last)) / DAY; f.strength = +(f.strength * Math.pow(0.5, 1 / 30)).toFixed(3); if (f.strength < 0.05 || idle > 180) { delete KB.facts[id]; binned++; } }
for (const f of Object.values(KB.facts)) f.strength = +f.strength.toFixed(3);
KB.at = new Date().toISOString(); KB.count = Object.keys(KB.facts).length;
KB.top = Object.values(KB.facts).sort((a, b) => b.strength * Math.log2(2 + b.n) - a.strength * Math.log2(2 + a.n)).slice(0, 12).map((f) => `${f.contradicted ? "⚠ " : ""}${f.claim}`);
fs.writeFileSync(OUT, JSON.stringify(KB, null, 1));
console.log(`memory: ${KB.count} facts (${seen.size} confirmed today, ${binned} forgotten, ${Object.values(KB.facts).filter((f) => f.contradicted).length} contradicted) · strongest: ${KB.top.slice(0, 3).join(" | ")}`);
