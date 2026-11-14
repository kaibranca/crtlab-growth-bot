// AI RADAR — the "free backtesting answer" machine (11-10). WHY: one page, /backtest, sent 368 ChatGPT visitors (137 made
// accounts, 37%) — 170 in the week of 10-18 — then collapsed to 1/week after the 10-24 "paid only" copy. ChatGPT still READS
// CRTLAB ~1,200×/day but we were blind on the one thing that decides referrals: what the answer SAYS and who it recommends.
//
// EYES   asks an OpenAI model WITH web search the real buyer questions (data/radar/questions.json), like a trader would, no hint
//        of CRTLAB. Records: is CRTLAB mentioned, cited (crtlab.pro link), its rank among the tools named, every tool + domain
//        that wins, and what the answer claims about CRTLAB (an AI extractor checks it against the true facts).
// BRAIN  per question a mention rate with a cluster prior (empirical Bayes, K=4, half-life 14d); per cluster share of voice,
//        cited share, #1 share, trend; who wins each cluster and WHY (the reasons/pricing claims the answers give).
// SURGE / FAILURE  a question that flips (won / lost) is re-asked next run to confirm (answers are noisy) → events.jsonl,
//        emailed. Every action (page pushed because CRTLAB is absent / cited) is logged and judged at 7–14 days on the
//        cluster's mention share; action kinds that never help lose their weight; lost questions keep budget.
// EXPLORE/EXPLOIT  daily budget of searches (RADAR_CALLS, default 14) → 85% to the most valuable uncertain questions
//        (cluster value from REAL ChatGPT clicks + accounts per target page × posterior uncertainty × staleness), 15% to the
//        least-asked; every question at least weekly. Discovery: surging /answers + /news/<type>/<market> pages become
//        questions; Mondays the model proposes new phrasings for the most valuable clusters where CRTLAB is absent.
// HANDS  data/radar/boost.json → ai-machine.mjs pushes those pages to Bing first ("RADAR"); data/radar/gaps.json = per
//        question who wins + why + our page (the build list for Claude sessions; new pages still need Kai's OK).
// GATES  monthly cost cap (RADAR_BUDGET $, default 8) from real token usage; wrong/stale claims about CRTLAB email Kai once a
//        day; no user data anywhere (public repo): only questions, tool names, domains, ≤240-char snippets about CRTLAB.
// PROOF  data/radar/score.jsonl: daily share of voice (weighted), mentioned / cited / #1 share, per cluster → summary.json.
import fs from "node:fs";
import { append, readLines, BRAND } from "./lib.mjs";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.log("radar: no OPENAI_API_KEY"); process.exit(0); }
const D = "data/radar", DAY = 86400000, NOW = Date.now(), TODAY = new Date().toISOString().slice(0, 10);
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const W = (f, x) => fs.writeFileSync(f, JSON.stringify(x, null, 1));
fs.mkdirSync(D, { recursive: true });
const QF = `${D}/questions.json`, SF = `${D}/state.json`;
const bank = J(QF, { questions: [] }), state = J(SF, { q: {}, cost: {}, emailed: {}, lastDiscover: null, model: null });
// MONEY IS TIGHT (Kai 11-10: $5 credit, $10/month hard limit at OpenAI): default cap $2.50/month. The machine PACES itself:
// today's calls = (cap - spent this month) / days left / its own measured cost per answer -> it can never overrun, and an
// unused day rolls into the rest of the month. Hard ceiling RADAR_CALLS per day.
const CALLS = +(process.env.RADAR_CALLS || 10), BUDGET = +(process.env.RADAR_BUDGET || 2.5), PAR = 3;
// prices per 1M tokens / per search call (USD) — override by env if OpenAI changes them; cost is an ESTIMATE for the cap
// conservative (rounded UP) so the estimate errs on the side of spending less than the cap
const PRICE = { nano: [0.05, 0.4], mini: [0.25, 2], "4.1-mini": [0.4, 1.6], "4o-mini": [0.15, 0.6] };
const priceOf = (m) => PRICE[["4.1-mini", "4o-mini", "nano", "mini"].find((k) => m.endsWith(k)) || "mini"];
const searchFee = (m) => +(process.env.RADAR_P_SEARCH || (/^gpt-[5-9]/.test(m) ? 0.01 : 0.025));
const mon = TODAY.slice(0, 7); state.cost[mon] ??= 0;
const spend = (u, m, searches = 0) => { const [pi, po] = priceOf(m); const c = ((u?.input_tokens || 0) * pi + (u?.output_tokens || 0) * po) / 1e6 + searches * searchFee(m); state.cost[mon] += c; return c; };

// ── OpenAI ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function api(path, body) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.openai.com/v1/" + path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: body && JSON.stringify(body) }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    if (r.ok) return r.json();
    const t = (await r.text()).slice(0, 300);
    if ((r.status === 429 && !/insufficient_quota|billing/.test(t)) || r.status >= 500) { await new Promise((s) => setTimeout(s, 4000 * (i + 1))); continue; } // rate limit = wait; out of credit = stop now
    throw new Error(`OpenAI ${r.status}: ${t}`);
  }
  throw new Error("OpenAI: retries exhausted");
}
// the model ChatGPT-like answers come from: newest small GPT with web search (ChatGPT itself runs a bigger one — this is a
// cheap PROXY; it agrees with ChatGPT on who gets recommended far more than it disagrees, which is what we measure)
async function pickModel() {
  if (process.env.RADAR_MODEL) return { search: process.env.RADAR_MODEL, cheap: process.env.RADAR_MODEL };
  const ids = ((await api("models")).data || []).map((m) => m.id);
  const ver = (id) => +(/gpt-(\d+(?:\.\d+)?)/.exec(id)?.[1] || 0);
  const minis = ids.filter((id) => /^gpt-\d+(\.\d+)?-mini$/.test(id)).sort((a, b) => ver(b) - ver(a));
  const nanos = ids.filter((id) => /^gpt-\d+(\.\d+)?-nano$/.test(id)).sort((a, b) => ver(b) - ver(a));
  const search = minis[0] || ids.find((x) => x === "gpt-4.1-mini") || ids.find((x) => x === "gpt-4o-mini") || "gpt-4.1-mini";
  return { search, cheap: nanos[0] || search }; // searching needs the better model; READING an answer is a nano job
}
const reasoning = (m) => (/^(gpt-[5-9]|o\d)/.test(m) ? { reasoning: { effort: "low" } } : {});
let SEARCH_TOOL = "web_search", INCLUDE = true;
async function ask(model, q) {
  const body = () => ({ model, input: q, tools: [{ type: SEARCH_TOOL }], ...(INCLUDE ? { include: ["web_search_call.action.sources"] } : {}), ...reasoning(model) });
  let res;
  try { res = await api("responses", body()); }
  catch (e) {
    if (/include|sources/i.test(e.message)) INCLUDE = false; else if (/web_search/i.test(e.message)) SEARCH_TOOL = "web_search_preview"; else throw e;
    res = await api("responses", body());
  }
  let text = "", cites = [], sources = [], searches = 0;
  for (const o of res.output || []) {
    if (o.type?.startsWith("web_search")) { searches++; for (const s of o.action?.sources || []) if (s.url) sources.push(s.url); }
    if (o.type === "message") for (const c of o.content || []) if (c.type === "output_text") { text += c.text; for (const a of c.annotations || []) if (a.type === "url_citation" && a.url) cites.push({ url: a.url, at: a.start_index ?? 0 }); }
  }
  const cost = spend(res.usage, model, Math.max(1, searches));
  return { text, cites, sources, cost };
}
const FACTS = "CRTLAB (crtlab.pro) is a browser-based backtesting and market replay app (candle-by-candle replay, drawing tools, long/short positions, footprint/order flow and volume profile charts, economic news release replay, prop firm challenge simulator, measured strategy statistics). Markets: forex majors, gold, silver, oil, US and German indices, Bitcoin, Ethereum, Solana. It is FREE EVERY DAY: 2,000 candles a day, no card needed. Paid: Unlimited $14.99 a month, Lifetime $99 once. It is NOT paid-only, has no 'free sample' or 'free trial only', no weekly allowance.";
const SCHEMA = { type: "object", additionalProperties: false, required: ["tools", "crtlab"], properties: {
  tools: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "rank", "reason", "pricing"], properties: { name: { type: "string" }, rank: { type: "integer" }, reason: { type: "string" }, pricing: { type: "string" } } } },
  crtlab: { type: "object", additionalProperties: false, required: ["mentioned", "described_as", "pricing_claim", "wrong", "wrong_what"], properties: { mentioned: { type: "boolean" }, described_as: { type: "string" }, pricing_claim: { type: "string" }, wrong: { type: "boolean" }, wrong_what: { type: "string" } } } } };
async function extract(model, q, text) {
  const res = await api("responses", { model, ...reasoning(model), input: [
    { role: "system", content: `You read an AI assistant's answer to a trader's question and return JSON. tools = every product/website/software the answer recommends or names as an option, in the order the answer presents them (rank 1 = first), with the answer's one-line reason (≤90 chars) and what it says about price ("free", "paid", "free plan", "$X/month", "" if nothing). Use the product's common name (e.g. "TradingView", "FX Replay", "Forex Tester"). crtlab: whether CRTLAB / crtlab.pro is mentioned, how it is described (≤120 chars), its pricing claim, and wrong=true if anything said about CRTLAB contradicts these facts (wrong_what says what): ${FACTS}` },
    { role: "user", content: `Question: ${q}\n\nAnswer:\n${text.slice(0, 9000)}` }],
    text: { format: { type: "json_schema", name: "radar", strict: true, schema: SCHEMA } } });
  const cost = spend(res.usage, model);
  const out = (res.output || []).flatMap((o) => o.content || []).find((c) => c.type === "output_text")?.text;
  return { ...JSON.parse(out || "{}"), cost };
}

// ── value of each cluster from REAL ChatGPT outcomes on its target pages (clicks + 3×accounts, all time) ────────────────
const clicks = J("data/ai/clicks.json", {});
const pageVal = new Map();
for (const [k, [c, a]] of Object.entries(clicks)) { const [, src, p] = k.split("|"); if (src === "chatgpt") pageVal.set(p, (pageVal.get(p) || 0) + c + 3 * a); }
const Qs = bank.questions.filter((q) => q.status !== "retired");
const cluVal = {};
for (const q of Qs) cluVal[q.cluster] = Math.max(cluVal[q.cluster] || 0, pageVal.get(q.target) || 0);
for (const c in cluVal) cluVal[c] = Math.sqrt(1 + cluVal[c]); // tempered: /backtest's 400+ shouldn't starve everything else

// ── posterior mention rate per question (half-life 14d), shrunk to its cluster (K=4) → cluster to global (K=6) ─────────
const HL = 14 * DAY, wOf = (at) => Math.pow(0.5, (NOW - Date.parse(at)) / HL);
const obs = (id) => state.q[id]?.asked || [];
function posteriors() {
  const g = { m: 0, n: 0 }, cl = {};
  for (const q of Qs) for (const o of obs(q.id)) { const w = wOf(o.at); g.m += w * o.m; g.n += w; (cl[q.cluster] ??= { m: 0, n: 0, c: 0, r1: 0 }); cl[q.cluster].m += w * o.m; cl[q.cluster].n += w; cl[q.cluster].c += w * (o.c || 0); cl[q.cluster].r1 += w * (o.r === 1 ? 1 : 0); }
  const gm = (g.m + 0.5) / (g.n + 5), clu = {}, qp = {};
  for (const c of new Set(Qs.map((q) => q.cluster))) { const x = cl[c] || { m: 0, n: 0, c: 0, r1: 0 }; clu[c] = { share: (x.m + 6 * gm) / (x.n + 6), cited: x.n ? x.c / x.n : 0, first: x.n ? x.r1 / x.n : 0, n: +x.n.toFixed(1), value: +(cluVal[c] || 1).toFixed(2) }; }
  for (const q of Qs) { let m = 0, n = 0; for (const o of obs(q.id)) { const w = wOf(o.at); m += w * o.m; n += w; }
    const a = m + 4 * clu[q.cluster].share, b = n - m + 4 * (1 - clu[q.cluster].share), p = a / (a + b);
    qp[q.id] = { p, sd: Math.sqrt((p * (1 - p)) / (a + b + 1)), n: obs(q.id).length }; }
  return { gm, clu, qp };
}

// ── discovery: surging question-shaped pages become questions; Mondays the model proposes new phrasings ─────────────────
const known = new Set(bank.questions.map((q) => q.id)), norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const addQ = (q, cluster, target, source) => { const id = norm(q); if (known.has(id) || bank.questions.length >= 120 || (source === "surge" && bank.questions.some((x) => x.target === target && x.status !== "retired"))) return false; known.add(id); bank.questions.push({ id, q, cluster, target, source, added: TODAY }); Qs.push(bank.questions.at(-1)); return true; };
const MK = { xauusd: "gold", gold: "gold", nas100: "NAS100", us30: "US30", sp500: "the S&P 500", eurusd: "EURUSD", gbpusd: "GBPUSD", usdjpy: "USDJPY", btcusd: "Bitcoin", bitcoin: "Bitcoin", ger40: "the DAX", xagusd: "silver", usoil: "oil" };
let discovered = 0;
for (const s of readLines("data/ai/surges.jsonl").filter((x) => x.kind === "page" && NOW - Date.parse(x.at) < 7 * DAY)) {
  let m;
  if ((m = /^\/answers\/([a-z0-9-]+)$/.exec(s.key))) { const t = m[1].replace(/-/g, " ").replace(/\b830\b/, "8:30"); discovered += addQ(t[0].toUpperCase() + t.slice(1) + "?", "stats", s.key, "surge"); }
  else if ((m = /^\/news\/([a-z0-9-]+)\/([a-z0-9]+)$/.exec(s.key)) && MK[m[2]]) discovered += addQ(`How does ${MK[m[2]]} react to ${m[1].toUpperCase().replace(/-/g, " ")}?`, "news", s.key, "surge");
}
const models = await pickModel(), model = models.search, cheap = models.cheap; state.model = models;
console.log(`radar: models ${model} (search) + ${cheap} (reading) · month spend ~$${state.cost[mon].toFixed(2)} of $${BUDGET}`);
if (state.cost[mon] >= BUDGET + (+(process.env.RADAR_FLEX || 1))) { console.log("radar: monthly budget + flex reached — eyes closed until next month (raise RADAR_BUDGET to continue)"); W(SF, state); process.exit(0); }
let { clu, qp } = posteriors();
if (new Date().getUTCDay() === 1 && state.lastDiscover !== TODAY) {
  state.lastDiscover = TODAY;
  const hot = new Set(readLines(`${D}/events.jsonl`).filter((e) => e.kind === "WON" && NOW - Date.parse(e.at) < 14 * DAY).map((e) => e.cluster));
  const gapsC = Object.entries(clu).filter(([c, x]) => hot.has(c) || x.share < 0.5).sort((a, b) => +hot.has(b[0]) - +hot.has(a[0]) || b[1].value - a[1].value).slice(0, 2);
  for (const [c] of gapsC) {
    const ex = Qs.filter((q) => q.cluster === c).slice(0, 6).map((q) => "- " + q.q).join("\n");
    try {
      const r = await api("responses", { model: cheap, ...reasoning(cheap), input: `Retail traders ask an AI assistant questions like:\n${ex}\nWrite 6 NEW questions real traders ask about the same need, worded differently (beginner wording, specific markets, specific tools they want to replace, price worries). One per line, no numbering, no brand names except well-known platforms.`, });
      spend(r.usage, cheap);
      const t = (r.output || []).flatMap((o) => o.content || []).find((x) => x.type === "output_text")?.text || "";
      const tgt = Qs.find((q) => q.cluster === c && q.source === "bank")?.target;
      for (const line of t.split("\n").map((s) => s.replace(/^[-•\d.\s]+/, "").trim()).filter((s) => s.length > 12 && s.length < 140).slice(0, 6)) discovered += addQ(line, c, tgt, "ai");
    } catch (e) { console.log("discovery:", e.message); }
  }
}
if (discovered) { W(QF, bank); ({ clu, qp } = posteriors()); console.log("radar: +" + discovered + " discovered questions"); }

// ── choose today's questions: confirm flips first, then exploit (value × uncertainty × staleness) 85% / explore 15% ─────
const daysSince = (id) => { const a = obs(id).at(-1); return a ? (NOW - Date.parse(a.at)) / DAY : 99; };
const pending = Qs.filter((q) => state.q[q.id]?.confirm && daysSince(q.id) > 0.5);
const score = (q) => (cluVal[q.cluster] || 1) * (qp[q.id].sd + 0.03) * Math.min(3, Math.max(0.2, daysSince(q.id) / 2)) * (daysSince(q.id) > 7 ? 5 : 1);
const exploitL = [...Qs].sort((a, b) => score(b) - score(a)), exploreL = [...Qs].sort((a, b) => obs(a.id).length - obs(b.id).length || daysSince(b.id) - daysSince(a.id));
const today = [], used = new Set(), take = (q, why) => { if (!used.has(q.id) && today.length < CALLS + 6) { used.add(q.id); today.push({ q, why }); } };
for (const q of pending) take(q, "confirm");
const nX = Math.max(1, Math.round(CALLS * 0.15));
for (const q of exploitL) { if (today.length >= CALLS + 6 - nX) break; take(q, "exploit"); }
for (const q of exploreL) take(q, "explore");
// already asked today (re-run of the workflow) → skip, the day's budget is spent once
const asked = today.filter(({ q }) => daysSince(q.id) > 0.6 || state.q[q.id]?.confirm);

// ── ask ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const results = [], errors = [];
// self-paced budget: measured cost per answer (EMA of real runs; first guess = search fee + tokens) -> today's affordable calls
const daysLeft = Math.round((Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1) - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) / DAY);
const perAnswer = state.perAnswer || searchFee(model) + 0.006;
// FLEX (Kai 11-10: "adapt to over/under spend EVER SO SLIGHTLY; a dollar only if the return is huge"):
//  UNDER: when every question is settled (posterior sd < 0.08) and nothing needs confirming, ask half — the saving rolls on.
//  OVER:  a confirmed WIN in the last 7 days, or real ChatGPT clicks this week >= 2x the week before (>= 6), unlocks up to
//         +$0.10 today from a +$1/month flex pot (RADAR_FLEX). Never beyond the pot; the base cap stays the base cap.
const FLEX = +(process.env.RADAR_FLEX || 1);
const settled = !pending.length && Qs.every((q) => qp[q.id].n >= 2 && qp[q.id].sd < 0.08);
const ck = (a, b) => { let t = 0; for (const [k, [c]] of Object.entries(clicks)) { const [d, src] = k.split("|"); const age = (NOW - Date.parse(d + "T12:00:00Z")) / DAY; if (src === "chatgpt" && age >= a && age < b) t += c; } return t; };
const wonRecent = readLines(`${D}/events.jsonl`).some((e) => e.kind === "WON" && NOW - Date.parse(e.at) < 7 * DAY);
const clickSurge = ck(0, 7) >= 6 && ck(0, 7) >= 2 * Math.max(1, ck(7, 14));
const baseLeft = Math.max(0, BUDGET - state.cost[mon]), flexLeft = Math.max(0, BUDGET + FLEX - state.cost[mon]) - baseLeft;
let dayMoney = baseLeft / Math.max(1, daysLeft), mode = "normal";
if (settled) { dayMoney /= 2; mode = "settled: half speed"; }
if ((wonRecent || clickSurge) && flexLeft > 0) { dayMoney += Math.min(0.1, flexLeft); mode = `FLEX +$${Math.min(0.1, flexLeft).toFixed(2)} (${wonRecent ? "confirmed win" : "ChatGPT clicks surging"})`; }
const afford = Math.floor(dayMoney / perAnswer);
const nToday = Math.max(0, Math.min(CALLS + (mode.startsWith("FLEX") ? 6 : 0), afford, asked.length));
asked.splice(nToday); // confirmations sit first in the list: they decide WON/LOST, so they always get the scarce calls
console.log(`radar: ${daysLeft} day(s) left · ~$${perAnswer.toFixed(4)}/answer · ${mode} · asking ${nToday} today`);
async function run({ q, why }) {
  if (state.cost[mon] >= BUDGET + FLEX) return;
  try {
    const a = await ask(model, q.q);
    const x = await extract(cheap, q.q, a.text).catch((e) => ({ tools: [], crtlab: { mentioned: false }, err: e.message }));
    const mentioned = BRAND.test(a.text) || !!x.crtlab?.mentioned;
    const cited = a.cites.some((c) => /crtlab\.pro/.test(c.url)), seen = a.sources.some((u) => /crtlab\.pro/.test(u)) || cited;
    const tools = (x.tools || []).sort((p, r) => p.rank - r.rank);
    const ri = tools.findIndex((t) => BRAND.test(t.name)), rank = ri >= 0 ? ri + 1 : mentioned ? tools.length + 1 : null;
    const at0 = a.text.search(BRAND), snippet = at0 >= 0 ? a.text.slice(Math.max(0, at0 - 80), at0 + 160).replace(/\s+/g, " ").trim() : "";
    const stale = /paid[- ]only|free (sample|trial)|no free|subscription required|weekly allowance/i.test(snippet + " " + (x.crtlab?.pricing_claim || ""));
    const row = { at: new Date().toISOString(), id: q.id, cluster: q.cluster, why, model, m: mentioned ? 1 : 0, c: cited ? 1 : 0, seen: seen ? 1 : 0, r: rank,
      tools: tools.slice(0, 8).map((t) => ({ n: t.name.slice(0, 40), r: t.rank, why: (t.reason || "").slice(0, 90), $: (t.pricing || "").slice(0, 40) })),
      domains: [...new Set(a.cites.map((c) => host(c.url)).filter(Boolean))].slice(0, 10), crtUrls: [...new Set(a.cites.filter((c) => /crtlab\.pro/.test(c.url)).map((c) => new URL(c.url).pathname))],
      crt: mentioned ? { as: (x.crtlab?.described_as || "").slice(0, 120), $: (x.crtlab?.pricing_claim || "").slice(0, 60), wrong: !!x.crtlab?.wrong || stale, what: (x.crtlab?.wrong_what || (stale ? "stale pricing" : "")).slice(0, 120), snippet: snippet.slice(0, 240) } : null };
    results.push(row); append(`${D}/answers.jsonl`, row);
    append(`${D}/raw/${mon}.jsonl`, { at: row.at, id: q.id, q: q.q, model, text: a.text, cites: a.cites, sources: [...new Set(a.sources)].slice(0, 40), extract: { tools: x.tools, crtlab: x.crtlab } });
    { const c = a.cost + (x.cost || 0); state.perAnswer = +(state.perAnswer ? 0.8 * state.perAnswer + 0.2 * c : c).toFixed(5); }
    console.log(`  ${mentioned ? (rank === 1 ? "#1 " : "✓  ") : "✗  "}${cited ? "cited " : "      "}[${q.cluster}] ${q.q}  → ${tools.slice(0, 4).map((t) => t.name).join(", ")}`);
  } catch (e) { errors.push(e.message.slice(0, 160)); console.log(`  ! ${q.q}: ${e.message}`); if (/401|insufficient_quota|billing/i.test(e.message)) throw e; }
}
try { for (let i = 0; i < asked.length; i += PAR) await Promise.all(asked.slice(i, i + PAR).map(run)); }
catch (e) { console.log("radar: stopped —", e.message); }
// run log: one line per run (the health check and the board read it; a failing radar can never fail silently)
append(`${D}/runs.jsonl`, { at: new Date().toISOString(), planned: asked.length, asked: results.length, errors: errors.length, error: errors[0] || null, cost: +state.cost[mon].toFixed(3), mode });

// ── learn: record, detect flips (confirm before believing), events ─────────────────────────────────────────────────────
const events = [];
for (const r of results) {
  const s = (state.q[r.id] ??= { asked: [] }), before = qp[r.id]?.p ?? 0.5;
  s.asked.push({ at: r.at, m: r.m, c: r.c, r: r.r }); s.asked = s.asked.slice(-60);
  const flip = (before < 0.35 && r.m === 1) || (before > 0.65 && r.m === 0);
  if (s.confirm) { // second look: two in a row the same way → believe it
    if (r.m === s.confirm.m) events.push({ at: r.at, id: r.id, cluster: r.cluster, kind: r.m ? "WON" : "LOST", q: Qs.find((q) => q.id === r.id)?.q, tools: r.tools.slice(0, 3).map((t) => t.n) });
    delete s.confirm;
  } else if (flip) s.confirm = { m: r.m, at: r.at };
}
for (const e of events) append(`${D}/events.jsonl`, e);
({ clu, qp } = posteriors());

// ── who wins each cluster + why (last 21 days), and the gaps list (our build list) ────────────────────────────────────────
const recent = readLines(`${D}/answers.jsonl`).filter((x) => NOW - Date.parse(x.at) < 21 * DAY);
const winners = {}, reasons = {};
for (const x of recent) { const w = (winners[x.cluster] ??= {}); for (const t of x.tools) { const k = t.n.toLowerCase().replace(/\s+/g, " ").trim(); (w[k] ??= { name: t.n, n: 0, first: 0, free: 0 }); w[k].n++; if (t.r === 1) w[k].first++; if (/free/i.test(t.$)) w[k].free++;
  if (t.why) ((reasons[k] ??= []).length < 6 && reasons[k].push(t.why)); } }
const per = (c) => recent.filter((x) => x.cluster === c).length || 1;
const who = Object.fromEntries(Object.entries(winners).map(([c, w]) => [c, Object.values(w).sort((a, b) => b.first - a.first || b.n - a.n).slice(0, 8).map((t) => ({ ...t, share: +(t.n / per(c)).toFixed(2), freeShare: +(t.free / Math.max(1, t.n)).toFixed(2), reasons: reasons[t.name.toLowerCase().replace(/\s+/g, " ").trim()] || [] }))]));
const lastBy = new Map(); for (const x of recent) lastBy.set(x.id, x);
const gaps = Qs.filter((q) => (qp[q.id]?.p ?? 1) < 0.5 && lastBy.has(q.id)).map((q) => { const l = lastBy.get(q.id);
  const seenN = recent.filter((x) => x.id === q.id && x.seen).length, n = recent.filter((x) => x.id === q.id).length;
  return { id: q.id, q: q.q, cluster: q.cluster, ourPage: q.target, value: +(cluVal[q.cluster] || 1).toFixed(2), p: +qp[q.id].p.toFixed(2), winners: l.tools.slice(0, 4), winningDomains: l.domains.slice(0, 5),
    diag: seenN / n >= 0.5 ? "found, not chosen" : "not found", fix: seenN / n >= 0.5 ? `content: winners say "${l.tools.slice(0, 2).map((t) => t.why).filter(Boolean).join('" / "')}" — our page must answer that` : "indexing: push our page to Bing" }; })
  .sort((a, b) => b.value * (1 - b.p) - a.value * (1 - a.p));
const wrong = recent.filter((x) => x.crt?.wrong && NOW - Date.parse(x.at) < 3 * DAY).map((x) => ({ at: x.at, id: x.id, what: x.crt.what, said: x.crt.snippet }));

// ── hands: boost pages for the Bing queue + learn which kind of push helps (failure learning) ─────────────────────────────
const acts = readLines(`${D}/actions.jsonl`), kindW = { unseen: 2.5, unchosen: 1.2, cited: 1.5, won: 3, ...J(`${D}/kinds.json`, {}) };
const shareIn = (c, a, b) => { const xs = readLines(`${D}/answers.jsonl`).filter((x) => x.cluster === c && Date.parse(x.at) >= a && Date.parse(x.at) < b); return { n: xs.length, m: xs.reduce((t, x) => t + x.m, 0) }; };
const verdicts = [];
for (const a of acts.filter((a) => !a.verdict && NOW - Date.parse(a.at) >= 7 * DAY)) {
  const t = Date.parse(a.at), pre = shareIn(a.cluster, t - 14 * DAY, t), post = shareIn(a.cluster, t, Math.min(NOW, t + 14 * DAY));
  if (pre.n < 4 || post.n < 4) { if (NOW - t > 28 * DAY) a.verdict = "unclear"; continue; }
  const p1 = pre.m / pre.n, p2 = post.m / post.n, pp = (pre.m + post.m) / (pre.n + post.n), se = Math.sqrt(pp * (1 - pp) * (1 / pre.n + 1 / post.n)) || 1;
  const z = (p2 - p1) / se; a.verdict = z > 1.64 ? "helped" : z < -1.64 ? "hurt" : NOW - t > 14 * DAY ? "no change" : null;
  if (a.verdict) verdicts.push({ ...a, pre: +p1.toFixed(2), post: +p2.toFixed(2), z: +z.toFixed(2) });
}
if (verdicts.length) { fs.writeFileSync(`${D}/actions.jsonl`, acts.map((a) => JSON.stringify(a)).join("\n") + "\n");
  for (const k of Object.keys(kindW)) { const v = acts.filter((a) => a.kind === k && a.verdict && a.verdict !== "unclear"); if (v.length >= 3) { const h = v.filter((a) => a.verdict === "helped").length / v.length; kindW[k] = +Math.min(3, Math.max(1.05, 1 + 2 * h)).toFixed(2); } }
  W(`${D}/kinds.json`, kindW); }
const boost = {};
// GO ALL IN on a confirmed win (Kai: "if it finds something, go all in"): its page gets the biggest push for 14 days
for (const e of readLines(`${D}/events.jsonl`).filter((e) => e.kind === "WON" && NOW - Date.parse(e.at) < 14 * DAY)) { const q = Qs.find((x) => x.id === e.id); if (q?.target) boost[q.target] = { mul: kindW.won, why: "won", q: q.q }; }
for (const g of gaps.slice(0, 25)) if (g.ourPage && !boost[g.ourPage]) boost[g.ourPage] = g.diag === "not found" ? { mul: kindW.unseen, why: "unseen", q: g.q } : { mul: kindW.unchosen, why: "unchosen", q: g.q };
for (const x of recent.filter((x) => NOW - Date.parse(x.at) < 14 * DAY)) for (const p of x.crtUrls || []) if (!boost[p]) boost[p] = { mul: kindW.cited, why: "cited", q: x.id };
const active = new Set(acts.filter((a) => NOW - Date.parse(a.at) < 14 * DAY).map((a) => a.page));
for (const [p, b] of Object.entries(boost)) if (!active.has(p)) append(`${D}/actions.jsonl`, { at: new Date().toISOString(), page: p, kind: b.why, cluster: Qs.find((q) => q.target === p || q.id === b.q)?.cluster || "?" });
W(`${D}/boost.json`, { at: new Date().toISOString(), note: "ai-machine.mjs multiplies these pages' Bing value and marks them RADAR", pages: boost });
W(`${D}/gaps.json`, { at: new Date().toISOString(), note: "Questions where CRTLAB is usually NOT recommended: who wins, with what claim, and the CRTLAB page that should win. Build list for Claude sessions (new pages need Kai's OK).", gaps: gaps.slice(0, 40), wrong });

// ── proof: score curve ───────────────────────────────────────────────────────────────────────────────────────────────
const cluS = Object.entries(clu).filter(([c]) => c !== "brand").map(([, c]) => c); // brand questions always name us: never in share of voice
const tot = cluS.reduce((t, c) => t + c.value, 0) || 1;
const sov = cluS.reduce((t, c) => t + c.share * c.value, 0) / tot;
const sc = readLines(`${D}/score.jsonl`).filter((s) => s.day !== TODAY);
const todayRows = readLines(`${D}/answers.jsonl`).filter((x) => x.at.startsWith(TODAY));
sc.push({ day: TODAY, asked: todayRows.length, mentioned: todayRows.filter((x) => x.m).length, cited: todayRows.filter((x) => x.c).length, first: todayRows.filter((x) => x.r === 1).length, sov: +sov.toFixed(3), clusters: Object.fromEntries(Object.entries(clu).map(([c, x]) => [c, +x.share.toFixed(2)])), cost: +state.cost[mon].toFixed(2) });
fs.writeFileSync(`${D}/score.jsonl`, sc.map((s) => JSON.stringify(s)).join("\n") + "\n");
W(`${D}/plan.json`, { at: new Date().toISOString(), model, sov: +sov.toFixed(3), clusters: clu, winners: who, gaps: gaps.slice(0, 12).map((g) => ({ q: g.q, ourPage: g.ourPage, p: g.p, diag: g.diag, winners: g.winners.map((t) => t.n) })), wrong, events: readLines(`${D}/events.jsonl`).slice(-20), boost: Object.keys(boost).length, kinds: kindW, verdicts: readLines(`${D}/actions.jsonl`).filter((a) => a.verdict).slice(-12), questions: Qs.length, monthCost: +state.cost[mon].toFixed(2), budget: BUDGET });

// ── alerts: wrong/stale claims about CRTLAB + confirmed wins/losses (once a day each) ───────────────────────────────────
const em = state.emailed[TODAY] ??= [];
const broken = asked.length > 0 && results.length === 0 && errors.length > 0; for (const d in state.emailed) if (d !== TODAY) delete state.emailed[d];
const news = [...wrong.filter((w) => !em.includes("w:" + w.id)).map((w) => ({ k: "w:" + w.id, line: `WRONG about CRTLAB — "${Qs.find((q) => q.id === w.id)?.q}": ${w.what}\n    it said: "${w.said}"` })),
  ...events.map((e) => ({ k: "e:" + e.id, line: `${e.kind === "WON" ? "WON" : "LOST"} [${e.cluster}] "${e.q}" — answer now leads with ${e.tools.join(", ") || "?"}` })),
  ...(broken ? [{ k: "broken", line: `RADAR CAN'T ASK: ${errors[0]} — ${/quota|billing|insufficient/i.test(errors[0]) ? "OpenAI credit ran out or limit hit (top up at platform.openai.com)" : /401|invalid/i.test(errors[0]) ? "the API key is wrong or revoked (gh secret set OPENAI_API_KEY)" : "OpenAI error — it retries tomorrow"}` }] : [])].filter((x) => !em.includes(x.k));
if (news.length && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: broken ? "CRTLAB AI radar is NOT running — action needed" : `CRTLAB AI radar: ${news.length} change(s) in what AI answers say`, text: ["What AI answers (with web search) now say to traders' questions:", "", ...news.map((x) => "• " + x.line), "", `Share of voice: ${(sov * 100).toFixed(0)}% (value-weighted). Ask Claude: "radar alert".`].join("\n") }) }).catch(() => null);
  console.log("radar: emailed", r?.status); em.push(...news.map((x) => x.k));
}
W(SF, state);
console.log(`radar: asked ${results.length}/${asked.length} · mentioned ${results.filter((r) => r.m).length} · cited ${results.filter((r) => r.c).length} · #1 ${results.filter((r) => r.r === 1).length} · share of voice ${(sov * 100).toFixed(1)}% · ${events.length} event(s) · ${wrong.length} wrong claim(s) · ${gaps.length} gaps · month ~$${state.cost[mon].toFixed(2)}`);
