// AI ANALYST (11-11) — reads every machine's own output once a day and writes what a human analyst would: findings tied to
// real numbers + at most 2 FOCUS proposals the core runs and judges like any other branch (owner "analyst"; kept at ×1.2
// AI reads/day after 7 days, else retired and not retried for 28 days). OpenAI gpt-4.1-mini with the radar's key, ~$0.003
// a run (~$0.10/month), hard cap $0.50/month. (GitHub Models was the free plan — retired 2026-07-30.) Repo files only.
// GUARDS: a finding whose numbers are not in the digest is dropped (no invented numbers); a proposal must name a page from
// the candidate list (no invented pages); ≤1 explore pick. LEARNS: its own kept/retired record goes into the prompt, its
// rank (wins − losses) sets the boost its branches get, and the reject rate is tracked per model.
import fs from "node:fs";

const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const readL = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const readLines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const NOW = Date.now(), DAY = 864e5, OUT = "data/analyst";
fs.mkdirSync(OUT, { recursive: true });
const prev = J(`${OUT}/plan.json`, {});
if (prev.at && NOW - Date.parse(prev.at) < 20 * 3600e3 && !process.env.FORCE) { console.log(`analyst: ran ${((NOW - Date.parse(prev.at)) / 3600e3).toFixed(1)} h ago — once a day`); process.exit(0); }

// ── 1. DIGEST: the numbers, compact (every claim must come from here) ────────────────────────────────────────────────
const ai = J("data/ai/plan.json", {}), out = J("data/machines/outcomes.json", {}), hum = J("data/machines/humans.json", {});
const leak = J("data/leak/plan.json", {}), radar = J("data/radar/plan.json", {}), mode = J("data/machines/mode.json", {});
const sup = J("data/machines/status.json", {}), spawned = J("data/machines/spawned.json", { branches: [] });
const r1 = (x) => (typeof x === "number" ? +x.toFixed(x >= 10 ? 0 : 2) : x);
const kpi = Object.fromEntries(Object.entries(out.kpi ?? {}).filter(([id]) => !id.startsWith("lead-")).map(([id, k]) => [id, { label: k.label, now: r1(k.now), before: r1(k.before) }]));
const digest = {
  week: kpi,
  today: { realVisitors24h: hum.visitors?.now, normal: r1(hum.visitors?.normal), signups24h: hum.signups?.now, signupsNormal: r1(hum.signups?.normal), state: hum.state, downMost: hum.why, upMost: hum.gainers },
  funnel14d: leak.overall && { visitors: leak.overall.visitors, accounts: leak.overall.accounts, firstReplay: leak.overall.activated, paid: leak.overall.paid },
  leaks: (leak.leaks ?? []).slice(0, 5).map((l) => ({ stage: l.stage, segment: l.segment, people: l.base, rate: r1(l.rate), overall: r1(l.overall), lost: r1(l.lost) })),
  aiFamilies: (ai.families ?? []).slice(0, 14).map((f) => ({ family: f.family, pages: f.pages, reads: r1(f.reads), clicks: r1(f.clicks), accounts: r1(f.accounts) })),
  readNoClick: (ai.convert ?? []).slice(0, 12).map((c) => ({ p: c.p, reads7d: c.reads7d, clicks7d: c.clicks7d })),
  surges: (ai.surges ?? []).filter((s) => s.kind === "page").slice(0, 6).map((s) => ({ p: s.key, last24h: s.last24h, normal: r1(s.normal) })),
  aiTests: (ai.experiments ?? []).map((e) => ({ id: e.id, family: e.family, days: e.days, A: { reads: e.A?.reads, clicks: e.A?.clicks }, B: { reads: e.B?.reads, clicks: e.B?.clicks }, status: e.status })),
  radar: { shareOfVoice: radar.sov, missing: (radar.gaps ?? []).slice(0, 5).map((g) => ({ q: g.q, ourPage: g.ourPage, winners: (g.winners ?? []).slice(0, 3) })) },
  mode: { mode: mode.mode, why: mode.why },
  machines: { ok: sup.ok, total: sup.total, fix: (sup.fix ?? []).slice(0, 5) },
  focusAlive: spawned.branches.filter((b) => b.state === "alive").map((b) => ({ target: b.target, owner: b.owner ?? "core", why: b.why })),
  // the other brains + the traffic brain's per-page people→click (11-11): the analyst sees the whole system
  brains: (J("data/brains/index.json", { brains: [] }).brains ?? []).map((b) => ({ brain: b.name, mode: b.mode, outcome: `${b.outcome?.label}: ${b.outcome?.v}`, openBranches: b.open })),
  peopleClick: (() => { const t = J("data/traffic/ecosystem.json", {}).live; return t ? { siteRatePct: t.rate, fetches7: t.fetches7, clicks7: t.clicks7, best: (t.best ?? []).slice(0, 3).map((x) => ({ p: x.p, fetches: x.fetches, clicks: x.clicks })), neverClicked: (t.never ?? []).slice(0, 3).map((x) => ({ p: x.p, fetches: x.fetches })) } : null; })(),
  // 11-12 overclock signals: the system-wide wave mode, the last waves and their verdicts, the 3 h pulse, the holdout's
  // measured push lift (the truth about whether pushing works), every hook test incl. the homepage switchback
  lockIn: (() => { const l = J("data/machines/lockin.json", {}); return { on: !!l.on, kind: l.kind ?? null, why: l.why ?? null, bars: l.bars ?? null, lastWaves: readL("data/machines/waves.jsonl").slice(-4).map((w) => ({ kind: w.kind, hours: w.hours, verdict: w.verdict, ratio: w.ratio })) }; })(),
  pulse3h: hum.wave && { visitors: hum.wave.visitors, signups: hum.wave.signups, riding: hum.wave.riding },
  // LONG-TERM MEMORY (memory.mjs): the ecosystem's consolidated facts — the analyst's memory across days
  recommendation: (() => { const r = J("data/radar/recommend.json", null); return r ? { namedRate: r.namedRate, citedRate: r.citedRate, asked: r.asked, clusters: Object.fromEntries(Object.entries(r.clusters ?? {}).map(([k, c]) => [k, { named: c.namedRate, instead: c.namedInstead, trusted: c.trusted.slice(0, 3).map((x) => x.d) }])), trusted: r.trustedTop } : null; })(),
  // 11-13 THE NORTH STAR + CORE VALUES: what works (accounts by page family, deduped), the bin, effort, cycles — judge every
  // machine against THIS, never against reads (data/machines/values.json)
  values: J("data/machines/values.json", null)?.rules ?? null,
  // 11-14 CONTEXT (Kai: machines must see everything, not their own slice): every change in the ecosystem (site deploys with the
  // page areas they touched, machine changes, freeze, data releases, reels, verdicts) + the guard, failures, minutes. Before
  // crediting any result, check what ELSE changed in that window.
  timeline: (() => { const t = J("data/machines/timeline.json", null); return t ? { traffic7: t.traffic7, last: (t.events || []).slice(-40).map((e) => `${e.at.slice(0, 16)} ${e.kind} [${e.where}] ${e.what}${e.traffic ? " (TRAFFIC)" : ""}`) } : null; })(),
  guard: J("data/guard/status.json", null),
  failures: (() => { const f = J("data/guard/failures.json", null); return f ? { lessons: f.lessons, spent: f.spent?.map((x) => x.what), lost: f.lost?.slice(0, 10).map((x) => x.what), retire: f.retire, watch: f.watch } : null; })(),
  freeze: J("data/machines/freeze.json", null),
  minutes: J("data/guard/minutes.json", null),
  works: (() => { const w = J("data/works/plan.json", null); return w ? { northStar: w.northStar, base: w.base, effort: w.effort, focus: w.focus, explore: w.explore, families: (w.families ?? []).map((f) => ({ fam: f.fam, tier: f.tier, pages: f.pages, accounts90: f.accounts90, accounts28: f.accounts28, perPageWeek: f.worthPerPageWeek })), dead: w.bin, cycles: w.cycles } : null; })(),
  executive: (() => { const e = J("data/machines/executive.json", null); return e ? { constraint: e.constraint, why: e.why, rates: e.rates, gaps: e.gaps, knobs: e.knobs, strength: e.strength, history: (e.history ?? []).slice(-5) } : null; })(),
  knowledge: (() => { const k = J("data/machines/knowledge.json", null); return k ? { facts: k.count, strongest: k.top, contradicted: Object.values(k.facts ?? {}).filter((f) => f.contradicted).map((f) => `${f.claim} (was: ${f.was})`).slice(0, 5) } : null; })(),
  world: (() => { const w = J("data/world/credit.json", null); return w ? { fitError: w.fitError, releaseLift: w.releaseLift, trendTomorrow: w.siteTrendTomorrow, credit: w.credit } : null; })(),
  google: (() => { const g = J("data/google/plan.json", null); return g ? { totals: g.totals, reasons: g.reasons?.slice(0, 3), nonBrand: (g.topQueries ?? []).filter((x) => !/crt ?lab/i.test(x.q)).slice(0, 8), rank: (g.rank ?? []).slice(0, 5) } : null; })(),
  // 11-12: the ecosystem reading itself — every engine's IQ + limit, live experiments, the ranked build queue, the tuner
  selfModel: (() => { const S = J("data/machines/self.json", null); return S ? { whole: S.whole, engines: Object.fromEntries(Object.entries(S.engines ?? {}).map(([e, x]) => [e, { iq: x.iq, level: x.level, learners: `${x.learners}/${x.members}`, curiosity: x.curiosity, weakest: (x.weakest ?? []).map((w) => `${w.name}: ${w.limit}`) }])) } : null; })(),
  experiments: (J("data/machines/experiments.json", {}).experiments ?? []).map((x) => `${x.name} · ${x.status} · next ${x.next ?? "—"} · ${x.read ?? ""}`),
  buildQueue: (J("data/machines/build-queue.json", {}).items ?? []).slice(0, 6).map((x) => `${x.what} (${x.why})`),
  tuner: (() => { const k = J("data/machines/knobs.json", null); return k ? { objective: k.objective, knobs: Object.fromEntries(Object.entries(k.knobs ?? {}).map(([id, v]) => [id, { champion: v.champion, challenger: v.challenge?.value ?? null, read: v.challenge?.read ?? null, history: (v.history ?? []).slice(-3) }])) } : null; })(),
  holdout: (() => { const h = J("data/ai/holdout.json", null); return h?.last ? { days: h.last.days, pushLift: h.last.pushLift, provisional: h.last.provisional, heldPages: h.last.heldPages } : null; })(),
  hookFile: (J("data/ai/hooks.json", { experiments: [] }).experiments ?? []).map((e) => ({ id: e.id, family: e.family, template: e.template, mode: e.mode ?? "pages", grain: e.grain ?? null, status: e.status, last: e.last && { units: e.last.units ?? e.last.days, pBbeatsA: e.last.pBbeatsA, A: e.last.A, B: e.last.B } })),
  needsKai: (J("data/brains/fixer/ecosystem.json", {}).briefing?.watch ?? []).filter((w) => /^Admin: \d/.test(w)).slice(0, 5).map((w) => w.replace(/^Admin: /, "").slice(0, 140)),
};
const DIG = JSON.stringify(digest);

// ── 2. CANDIDATES: the only pages a proposal may name (real pages the machines already measure) ──────────────────────
const blocked = new Set(spawned.branches.filter((b) => b.state === "alive" || NOW - Date.parse(b.retired ?? 0) < 28 * DAY).map((b) => b.target));
const cand = new Map();
// proven = already turns AI reads into clicks, or is surging now. A focus branch buys more AI reads (Bing first), so only a
// page that converts reads is a safe pick; zero-click pages and answer gaps may only be the one EXPLORE pick (~15% rule).
const addC = (p, why, proven) => { if (!p || typeof p !== "string" || !p.startsWith("/") || p === "/" || blocked.has(p) || p.includes("<")) return;
  const c = cand.get(p); if (!c) cand.set(p, { why, proven }); else if (proven && !c.proven) cand.set(p, { why: why + "; " + c.why, proven }); };
for (const w of ai.winners ?? []) addC(w.p, `winner: ${r1(w.accounts)} accounts, ${r1(w.clicks)} clicks, ${r1(w.reads)} reads`, (w.clicks ?? 0) > 0);
for (const s of ai.surges ?? []) if (s.kind === "page") addC(s.key, `surging: ${s.last24h} reads in 24 h vs ~${r1(s.normal)}`, true);
for (const c of ai.convert ?? []) addC(c.p, `${c.reads7d} AI reads / 7 d, ${c.clicks7d} clicks`, (c.clicks7d ?? 0) > 0);
for (const g of radar.gaps ?? []) addC(g.ourPage, `AI answer gap: "${g.q}"`, false);
// the demand miner's page-1-bottom pages (Bing #4–20 with missed clicks): proven if Bing already sends a click
for (const r of J("data/traffic/plan.json")?.rank ?? []) addC(r.page, `Bing #${r.pos}, ${r.missed} clicks missed / 28 d (${(r.queries ?? []).slice(0, 2).join(", ")})`, (J("data/traffic/plan.json")?.demand ?? []).some((d) => d.page === r.page && d.clicks > 0));
const CANDS = [...cand].slice(0, 30).map(([p, c]) => ({ p, why: c.why, proven: c.proven }));

// ── 3. TRACK RECORD (learning): what its own past proposals did ──────────────────────────────────────────────────────
const mine = spawned.branches.filter((b) => b.owner === "analyst");
const record = { proposed: mine.length, alive: mine.filter((b) => b.state === "alive").length, kept: mine.filter((b) => b.verdict === "kept").length, retired: mine.filter((b) => b.verdict === "retired").length,
  history: mine.slice(-8).map((b) => ({ target: b.target, verdict: b.verdict ?? "measuring", ratio: b.ratio ?? null, why: b.why })) };
const runs = readLines(`${OUT}/runs.jsonl`).slice(-14);

// ── 4. ASK: GitHub Models (free), OpenAI fallback ────────────────────────────────────────────────────────────────────
const SYS = `You are the growth analyst for CRTLAB, a free-every-day trading backtest / bar-replay web app. The one goal (DATA.values, DATA.works — the north star since 11-13): more NEW ACCOUNTS from real people, deduped, judged by page family — never reads. DATA.works shows the base (accounts/day), which families WIN / are DEAD, the focus and each daily cycle's verdict: judge every machine against it, flag any machine still spending effort on a DEAD family, and say what to do MORE of. The known bottleneck: AI tools read our pages thousands of times but few readers click through, and most pages (news, calendar) bring 0 accounts.
DATA.selfModel / experiments / buildQueue / tuner are the machines reading themselves (IQ, what limits each engine, live tests, what they want built): when two experiments point opposite ways, or an engine's weakest part blocks the executive's constraint, that is a finding. Rules: use ONLY numbers that appear in DATA, copied exactly. No guessing, no generic advice, no new pages or features — you can only point machines at existing pages. Be blunt and short.
Return JSON: {"findings":[{"claim":"<one sentence, plain words>","numbers":[<each number you used, exactly as in DATA>],"so":"<what the machines should do, one short sentence>"}] (max 5, most important first),
"proposals":[{"target":"<exact p from CANDIDATES>","why":"<one sentence citing a number>","explore":<true if a long shot>}] (0-2; a candidate with proven:false MUST be explore:true; at most 1 explore; propose nothing rather than something weak; never pick a page your own findings call a problem),
"knobs":[{"id":"<a knob id from KNOB LADDERS>","value":<one number from that knob's ladder, not its champion>,"why":"<one sentence citing a number from DATA>"}] (0-1: the setting you think should be tested next — the tuner tests it on live data and promotes it only if it wins; propose none if nothing in DATA points to one),
"headline":"<the single most important thing today, max 14 words>"}`;
// KNOB LADDERS (11-12): the self-tuning settings and the values the tuner may test — the analyst can pick the next experiment
const ladderFor = (d) => { const xs = [0.5, 0.75, 1, 1.33, 2].map((m) => d * m); return Number.isInteger(d) ? [...new Set(xs.map((x) => Math.max(1, Math.round(x))))] : xs.map((x) => +x.toPrecision(3)); };
const KREG = J("data/machines/knob-registry.json", {}) ?? {}, KST = J("data/machines/knobs.json", {})?.knobs ?? {};
const LADDERS = Object.fromEntries(Object.entries(KREG).filter(([, r]) => typeof r.start === "number").map(([id, r]) => [id, { what: r.what, ladder: r.ladder ?? ladderFor(r.start), champion: KST[id]?.champion ?? r.start, testing: KST[id]?.challenge?.value ?? null, history: (KST[id]?.history ?? []).slice(-3).map((h) => `${h.challenger} vs ${h.champion}: ${h.verdict}${h.source === "analyst" ? " (your idea)" : ""}`) }]));
const USER = `DATA ${DIG}\n\nCANDIDATES ${JSON.stringify(CANDS)}\n\nKNOB LADDERS ${JSON.stringify(LADDERS)}\n\nYOUR TRACK RECORD (your past proposals, judged by AI reads/day after 7 days: kept at ×1.2+, else retired) ${JSON.stringify(record)}\nLearn from it: if your picks were retired, change what kind of page you pick.`;

async function call(url, key, model) {
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYS }, { role: "user", content: USER }] }), signal: AbortSignal.timeout(60e3) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 140)}`);
  const j = await r.json(); return { text: j.choices?.[0]?.message?.content ?? "", usage: j.usage ?? null };
}
// BUDGET: $ per run from the real token usage (gpt-4.1-mini $0.40 in / $1.60 out per 1M); over $0.50 this month = skip
const MON = new Date().toISOString().slice(0, 7), BUDGET = 0.5;
const spent = readLines(`${OUT}/runs.jsonl`).filter((r) => r.at?.startsWith(MON)).reduce((a, r) => a + (r.cost ?? 0), 0);
if (spent >= BUDGET) { console.log(`analyst: month budget used ($${spent.toFixed(3)} of $${BUDGET})`); process.exit(0); }
const tries = process.env.OPENAI_API_KEY ? ["gpt-4.1-mini", "gpt-4o-mini"].map((model) => ({ via: "openai", url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY, model })) : [];
let res = null, via = null, errs = [];
for (const t of tries) { try { res = await call(t.url, t.key, t.model); via = `${t.via}:${t.model}`; break; } catch (e) { errs.push(`${t.via}: ${String(e.message ?? e).slice(0, 160)}`); } }
if (!res) { console.log(`analyst: no model answered (${errs.join(" | ") || "no OPENAI_API_KEY"})`); fs.appendFileSync(`${OUT}/runs.jsonl`, JSON.stringify({ at: new Date().toISOString(), ok: false, errs }) + "\n"); process.exit(0); }
let ans = {}; try { ans = JSON.parse(res.text); } catch { ans = {}; }

// ── 5. GUARDS: drop invented numbers and invented pages ──────────────────────────────────────────────────────────────
const nums = new Set((DIG.match(/-?\d+(\.\d+)?/g) ?? []).map((n) => String(+n)));
const okNum = (n) => { const v = +String(n).replace(/[^\d.-]/g, ""); if (!Number.isFinite(v)) return false; return nums.has(String(v)) || nums.has(String(+v.toFixed(2))) || nums.has(String(Math.round(v))); };
let rejected = 0;
const findings = (Array.isArray(ans.findings) ? ans.findings : []).slice(0, 5).filter((f) => {
  const ok = f && typeof f.claim === "string" && Array.isArray(f.numbers) && f.numbers.length > 0 && f.numbers.every(okNum)
    && ((f.claim + " " + (f.so ?? "")).match(/\d+(\.\d+)?/g) ?? []).every(okNum);
  if (!ok) rejected++; return ok;
}).map((f) => ({ claim: f.claim.slice(0, 240), numbers: f.numbers.slice(0, 6), so: String(f.so ?? "").slice(0, 200) }));
let explore = 0;
const proposals = (Array.isArray(ans.proposals) ? ans.proposals : []).filter((p) => {
  const c = p && cand.get(p.target); if (c && !c.proven) p.explore = true; // unproven = explore, whatever the model said
  const ok = !!c && !(p.explore && explore++ >= 1);
  if (!ok) rejected++; return ok;
}).slice(0, 2).map((p) => ({ target: p.target, why: String(p.why ?? "").slice(0, 200), explore: !!p.explore, evidence: cand.get(p.target).why }));

const knobs = (Array.isArray(ans.knobs) ? ans.knobs : []).filter((k) => { const L = LADDERS[k?.id]; const ok = !!L && L.ladder.includes(+k.value) && +k.value !== L.champion; if (!ok && k) rejected++; return ok; })
  .slice(0, 1).map((k) => ({ id: k.id, value: +k.value, why: String(k.why ?? "").slice(0, 200), at: new Date().toISOString() }));
const cost = +(((res.usage?.prompt_tokens ?? 0) * 0.4 + (res.usage?.completion_tokens ?? 0) * 1.6) / 1e6).toFixed(5);
const plan = { at: new Date().toISOString(), model: via, headline: String(ans.headline ?? findings[0]?.claim ?? "").slice(0, 120), findings, proposals, knobs, rejected, record, candidates: CANDS.length, usage: res.usage, fellBack: errs };
fs.writeFileSync(`${OUT}/plan.json`, JSON.stringify(plan, null, 1));
fs.appendFileSync(`${OUT}/runs.jsonl`, JSON.stringify({ at: plan.at, ok: true, model: via, cost, findings: findings.length, proposals: proposals.map((p) => p.target), rejected }) + "\n");
const rejRate = runs.length ? runs.reduce((a, r) => a + (r.rejected ?? 0), 0) / runs.length : null;
console.log(`analyst (${via}): ${plan.headline}\n  ${findings.length} findings · ${proposals.length} proposals${proposals.length ? " (" + proposals.map((p) => p.target).join(", ") + ")" : ""} · ${rejected} rejected by guards${rejRate != null ? ` (avg ${rejRate.toFixed(1)}/run)` : ""} · record ${record.kept} kept / ${record.retired} retired`);
for (const f of findings) console.log(`  - ${f.claim} → ${f.so}`);
