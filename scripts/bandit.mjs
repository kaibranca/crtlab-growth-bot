// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CONVERSION BANDIT (11-12 — "reads ×20, clicks flat": the machines had no hands on the pages ChatGPT reads most). The site's
// ReplayHook title (news family / release / market pages, calendar pages) varies between approved wordings (site
// lib/bandit.ts ARMS — the bot never writes text). This machine:
//   • reconstructs which wording every page showed on every day: arm = weighted pick of fnv(salt + path + "|" + day) under
//     that day's shares — the same function as the site; shares for a day are written BEFORE it starts, so it is exact
//   • scores each wording on AI clicks per people-fetch (ChatGPT-User / Claude-User / Perplexity-User), per family
//   • Thompson sampling: P(best) per wording from Gamma posteriors (prior = the family's pooled rate, worth 200 fetches)
//     → tomorrow's shares = 85% × P(best) + 15% spread over the live wordings (never stops exploring)
//   • retires a wording that clearly loses (P(best) < 2% after 400+ fetches) and records a leader (P(best) ≥ 95% after 600+)
//     in the ledger — real wins and losses the learning pulse counts.
// Writes data/ai/bandit.json (the site reads it, cached 10 min). Files only.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

const NOW = Date.now(), DAY = 864e5, F_OUT = "data/ai/bandit.json";
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const lines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h % 100; };
const ARMS = ["plain", "practise", "minute", "yourtrade", "free"]; // = site lib/bandit.ts ARM_ORDER
const COUNTRY = /^(united-states|united-kingdom|euro-area|germany|france|italy|spain|japan|china|canada|australia|new-zealand|switzerland|india|brazil|mexico|south-korea)$/;
const famOf = (p) => { let m;
  if ((m = p.match(/^\/economic-calendar\/([a-z0-9-]+)$/))) return COUNTRY.test(m[1]) ? null : "calendar";
  if (/^\/news\/[a-z0-9-]+\/[a-z0-9-]+$/.test(p)) return "news-market";
  if (/^\/news\/[a-z-]+-\d{4}-\d{2}-\d{2}$/.test(p)) return "news-release";
  if (/^\/news\/[a-z-]+$/.test(p)) return "news-family";
  return null; };
const FAMS = ["news-family", "news-release", "news-market", "calendar"];
const st = J(F_OUT, { families: {} });
for (const f of FAMS) st.families[f] ??= { salt: `b1-${f}-`, probs: {}, written: {}, retired: [], leader: null };
const pick = (salt, p, d, probs) => { const u = fnv(salt + p + "|" + d); let acc = 0; for (const k of ARMS) { acc += Math.max(0, probs[k] ?? 0) * 100; if (u < acc) return k; } return null; };

// people-fetches per page per day, AI clicks per page per day
const PEOPLE = /^(ChatGPT-User|Claude-User|Perplexity-User)$/, AIENG = /^(chatgpt|perplexity|copilot|gemini|claude)$/;
const norm = (p0) => (p0.split("?")[0].replace(/\/$/, "") || "/");
const months = [...new Set([0, 15, 30, 45].map((d) => new Date(NOW - d * DAY).toISOString().slice(0, 7)))];
const fetches = new Map(); for (const w of months.flatMap((m) => lines(`data/aicrawl/${m}.jsonl`))) { const d = iso(Date.parse(w.to) - 1); for (const [b, v] of Object.entries(w.bots ?? {})) if (PEOPLE.test(b)) for (const [p0, n] of v.top ?? []) { const p = norm(p0); if (!famOf(p)) continue; const k = p + "|" + d; fetches.set(k, (fetches.get(k) ?? 0) + n); } }
const clicks = new Map(); for (const [k, v] of Object.entries(J("data/ai/clicks.json", {}))) { const [d, eng, p0] = k.split("|"); if (!AIENG.test(eng)) continue; const p = norm(p0 || "/"); if (!famOf(p)) continue; clicks.set(p + "|" + d, (clicks.get(p + "|" + d) ?? 0) + (v[0] ?? 0)); }

const gamma = (k) => { if (k < 1) return gamma(k + 1) * Math.pow(Math.random(), 1 / k); const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { const u1 = Math.random(), u2 = Math.random(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = Math.random(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
const today = iso(NOW), tomorrow = iso(NOW + DAY), report = [];
// HIERARCHICAL TRANSFER (11-12 — every click teaches every family): pass 1 counts each wording's clicks/fetches in every
// family; a wording's LIFT across families (its pooled rate ÷ the pooled rate of all wordings, shrunk by its sample) becomes
// the prior every family starts that wording from. A family then moves away from it only on its own evidence.
const judged = (S, d) => d < today && S.written[d] && S.written[d] < d + "T00:00:00Z";
const ALL = Object.fromEntries(ARMS.map((a) => [a, { f: 0, c: 0 }]));
for (const f of FAMS) { const S = st.families[f]; for (const [d, probs] of Object.entries(S.probs)) { if (!judged(S, d)) continue;
  for (const [k, n] of fetches) { const [p, dd] = k.split("|"); if (dd !== d || famOf(p) !== f) continue; const a = pick(S.salt, p, d, probs); if (a) { ALL[a].f += n; ALL[a].c += clicks.get(k) ?? 0; } } } }
const allF = ARMS.reduce((x, a) => x + ALL[a].f, 0), allC = ARMS.reduce((x, a) => x + ALL[a].c, 0), allRate = (allC + 1) / (allF + 100);
const LIFT = Object.fromEntries(ARMS.map((a) => [a, (((ALL[a].c + allRate * 300) / (ALL[a].f + 300)) / allRate)])); // shrunk to 1 with 300 fetches
for (const f of FAMS) {
  const S = st.families[f], live = ARMS.filter((a) => !S.retired.includes(a));
  // 1. SCORE every judged day: shares written before the day began, day finished
  const A = Object.fromEntries(ARMS.map((a) => [a, { f: 0, c: 0, units: 0 }]));
  for (const [d, probs] of Object.entries(S.probs)) { if (d >= today || !S.written[d] || S.written[d] >= d + "T00:00:00Z") continue;
    for (const [k, n] of fetches) { const [p, dd] = k.split("|"); if (dd !== d || famOf(p) !== f) continue; const a = pick(S.salt, p, d, probs); if (!a) continue; A[a].f += n; A[a].c += clicks.get(k) ?? 0; A[a].units++; } }
  const totF = ARMS.reduce((s, a) => s + A[a].f, 0), totC = ARMS.reduce((s, a) => s + A[a].c, 0), pooled = (totC + 1) / (totF + 100), B0 = 200;
  // 2. THOMPSON: P(best) per live wording
  const wins = Object.fromEntries(live.map((a) => [a, 0])), N = 4000;
  for (let i = 0; i < N; i++) { let best = null, bv = -1; for (const a of live) { const v = gamma(A[a].c + pooled * LIFT[a] * B0) / (A[a].f + B0); if (v > bv) { bv = v; best = a; } } wins[best]++; }
  const pBest = Object.fromEntries(live.map((a) => [a, wins[a] / N]));
  // 3. RETIRE clear losers, record a clear leader (once) — real verdicts in the ledger
  for (const a of live) if (A[a].f >= 400 && pBest[a] < 0.02 && live.length > 2) { S.retired.push(a);
    fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: new Date().toISOString(), key: `bandit|${f}|${a}|retired`, machine: "bandit", kind: "loss", what: `${f}: wording "${a}" retired — ${A[a].c} clicks / ${A[a].f} people-fetches, P(best) ${(pBest[a] * 100).toFixed(1)}%` }) + "\n"); }
  const lead = live.filter((a) => !S.retired.includes(a)).sort((x, y) => pBest[y] - pBest[x])[0];
  if (lead && pBest[lead] >= 0.95 && A[lead].f >= 600 && S.leader !== lead) { S.leader = lead;
    fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: new Date().toISOString(), key: `bandit|${f}|${lead}|leader`, machine: "bandit", kind: "win", what: `${f}: wording "${lead}" leads — ${A[lead].c} clicks / ${A[lead].f} people-fetches, P(best) ${(pBest[lead] * 100).toFixed(0)}%` }) + "\n"); }
  // 4. TOMORROW'S SHARES (written once, before the day starts): 85% Thompson + 15% exploration spread over live wordings
  const live2 = ARMS.filter((a) => !S.retired.includes(a)), tot = live2.reduce((s, a) => s + (pBest[a] ?? 0), 0) || 1;
  // STABILITY: equal shares until the family has 100+ judged people-fetches; after that a share moves ≤ 0.15 a day from
  // the last day's (fast, never jumpy — Thompson on 5 clicks alone would swing half the traffic)
  if (!S.probs[tomorrow]) { const target = Object.fromEntries(ARMS.map((a) => [a, !live2.includes(a) ? 0 : totF < 100 ? 1 / live2.length : 0.15 / live2.length + 0.85 * ((pBest[a] ?? 0) / tot)]));
    const lastD = Object.keys(S.probs).filter((d) => d < tomorrow).sort().at(-1), prevP = lastD ? S.probs[lastD] : null;
    const step = Object.fromEntries(ARMS.map((a) => [a, !live2.includes(a) ? 0 : prevP ? Math.max(0.005, (prevP[a] ?? 1 / live2.length) + Math.max(-0.15, Math.min(0.15, target[a] - (prevP[a] ?? 1 / live2.length)))) : target[a]]));
    const z = Object.values(step).reduce((x, y) => x + y, 0) || 1;
    S.probs[tomorrow] = Object.fromEntries(ARMS.map((a) => [a, +(step[a] / z).toFixed(4)])); S.written[tomorrow] = new Date().toISOString(); }
  // bin: shares + stamps older than 60 days
  for (const d of Object.keys(S.probs)) if (d < iso(NOW - 60 * DAY)) { delete S.probs[d]; delete S.written[d]; }
  S.stats = { at: new Date().toISOString(), arms: Object.fromEntries(ARMS.map((a) => [a, { fetches: A[a].f, clicks: A[a].c, pageDays: A[a].units, pBest: pBest[a] ?? 0, share: S.probs[tomorrow]?.[a] ?? 0, retired: S.retired.includes(a) }])), pooledRate: +pooled.toFixed(4), judgedDays: Object.keys(S.probs).filter((d) => d < today && S.written[d] < d + "T00:00:00Z").length };
  report.push(`${f}: ${S.stats.judgedDays} judged days · ${totC}/${totF} · ${ARMS.map((a) => `${a} ${((pBest[a] ?? 0) * 100).toFixed(0)}%${S.retired.includes(a) ? "✗" : ""}`).join(" ")}`);
}
st.transfer = { at: new Date().toISOString(), fetches: allF, clicks: allC, lift: Object.fromEntries(ARMS.map((a) => [a, +LIFT[a].toFixed(3)])) };
st.at = new Date().toISOString(); st.note = "Conversion bandit: per family, tomorrow's share of each ReplayHook wording (site lib/bandit.ts). Shares are written before their day starts.";
fs.writeFileSync(F_OUT, JSON.stringify(st, null, 1));
console.log("bandit: " + report.join(" | "));
