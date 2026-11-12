// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE (11-12 — ChatGPT READS our data pages ~2,500×/week but NAMES CRTLAB in ~1% of buyer answers; the
// radar stored who it cites instead, and no machine acted on it). Files only, hourly (cheap):
//   SCORE   per buyer cluster: asked, CRTLAB named, CRTLAB cited, who is named instead → share of voice, logged daily
//   SOURCES the domains ChatGPT cites per cluster = where a mention changes its answer → earned-mention targets (Fixer)
//   ACT     every LOST question → its target page gets RECOMMEND urgency in the AI machine's Bing queue (Bing = the index
//           ChatGPT searches), re-sent every 3 days while it stays lost
//   JUDGE   7 days after a cluster's pages were pushed: did the cluster's naming rate rise? → ledger win / loss, and the
//           push intensity per cluster learns (0.5…2)
// Writes data/radar/recommend.json (+ sov.jsonl). Read by ai-machine (queue), executive (recommendation stage), brains,
// analyst, memory, /machine.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/radar/recommend.json";
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const lines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const iso = (t) => new Date(t).toISOString().slice(0, 10), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const bank = J("data/radar/questions.json", { questions: [] }).questions ?? [], qOf = new Map(bank.map((q) => [q.id, q]));
const ans = lines("data/radar/answers.jsonl").filter((a) => NOW - Date.parse(a.at) < 60 * DAY);
const prev = J(OUT, { clusters: {}, pushes: {} });
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";

// ── SCORE: per cluster (recent 30 d weighted 2× over 30–60 d) ──────────────────────────────────────────────────────────
const C = {};
for (const a of ans) { const k = a.cluster ?? qOf.get(a.id)?.cluster ?? "other", w = NOW - Date.parse(a.at) < 30 * DAY ? 2 : 1, c = (C[k] ??= { asked: 0, named: 0, cited: 0, w: 0, tools: {}, domains: {}, lost: new Map() });
  c.asked++; c.w += w; const named = truthy(a.m), cited = truthy(a.c) || (a.crtUrls ?? []).length > 0; if (named) c.named += w; if (cited) c.cited += w;
  for (const t of Array.isArray(a.tools) ? a.tools : []) { const n = typeof t === "string" ? t : t?.n ?? t?.name; if (n && !/crt ?lab/i.test(n)) c.tools[n] = (c.tools[n] ?? 0) + w; }
  for (const d of Array.isArray(a.domains) ? a.domains : []) if (d && !/crtlab\.pro/.test(d)) c.domains[d] = (c.domains[d] ?? 0) + w;
  if (!named && !cited) { const q = qOf.get(a.id); if (q?.target) c.lost.set(q.target, { q: q.q, id: a.id, at: a.at }); } }
const clusters = Object.fromEntries(Object.entries(C).map(([k, c]) => [k, { asked: c.asked, namedRate: +(c.named / Math.max(1, c.w)).toFixed(3), citedRate: +(c.cited / Math.max(1, c.w)).toFixed(3),
  namedInstead: Object.entries(c.tools).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n), trusted: Object.entries(c.domains).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, n]) => ({ d, n })),
  lostTargets: [...c.lost.entries()].slice(0, 6).map(([p, x]) => ({ page: p, q: x.q })) }]));
const asked = ans.length, namedAll = ans.filter((a) => truthy(a.m)).length, citedAll = ans.filter((a) => truthy(a.c) || (a.crtUrls ?? []).length).length;
const sov = J("data/radar/plan.json", {}).sov ?? null;

// ── JUDGE pushes 7 days on, learn intensity per cluster ─────────────────────────────────────────────────────────────
const intensity = prev.intensity ?? {}, pushes = prev.pushes ?? {};
for (const [k, p] of Object.entries(pushes)) { if (p.judged || NOW - Date.parse(p.at) < 7 * DAY || !clusters[k]) continue;
  const now = clusters[k].namedRate, paid = now > p.namedRate; p.judged = new Date().toISOString(); p.namedRate1 = now;
  intensity[k] = +clamp((intensity[k] ?? 1) * (paid ? 1.2 : 0.85), 0.5, 2).toFixed(2);
  fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: p.judged, key: `recommend|${k}|${p.at}`, machine: "recommend", kind: paid ? "win" : "loss", what: `cluster "${k}": ChatGPT named CRTLAB ${(p.namedRate * 100).toFixed(0)}% → ${(now * 100).toFixed(0)}% of answers a week after its pages were pushed — ${paid ? "rising" : "flat"}; intensity → ×${intensity[k]}` }) + "\n"); }
// ── ACT: targets for the AI machine's Bing queue (RECOMMEND urgency), weighted by learned intensity ──────────────────
const targets = [];
for (const [k, c] of Object.entries(clusters)) for (const t of c.lostTargets) targets.push({ page: t.page, cluster: k, q: t.q, weight: intensity[k] ?? 1 });
targets.sort((a, b) => b.weight - a.weight);
for (const k of new Set(targets.map((t) => t.cluster))) if (!pushes[k] || pushes[k].judged) pushes[k] = { at: new Date().toISOString(), namedRate: clusters[k].namedRate };
for (const k of Object.keys(pushes)) if (pushes[k].judged && NOW - Date.parse(pushes[k].judged) > 30 * DAY) delete pushes[k];

const out = { at: new Date().toISOString(), asked, namedRate: asked ? +(namedAll / asked).toFixed(3) : null, citedRate: asked ? +(citedAll / asked).toFixed(3) : null, sov, clusters, targets: targets.slice(0, 15), intensity, pushes,
  trusted: Object.values(C).flatMap((c) => Object.entries(c.domains)).reduce((m, [d, n]) => ((m[d] = (m[d] ?? 0) + n), m), {}) };
out.trustedTop = Object.entries(out.trusted).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d, n]) => ({ d, n })); delete out.trusted;
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const SV = "data/radar/sov.jsonl", rows = lines(SV), row = { day: iso(NOW), asked, named: out.namedRate, cited: out.citedRate, sov };
if (rows.at(-1)?.day === row.day) rows[rows.length - 1] = row; else rows.push(row); fs.writeFileSync(SV, rows.slice(-365).map((x) => JSON.stringify(x)).join("\n") + "\n");
console.log(`recommend: ${asked} buyer answers (60 d) · CRTLAB named ${((out.namedRate ?? 0) * 100).toFixed(1)}%, cited ${((out.citedRate ?? 0) * 100).toFixed(1)}% · ${targets.length} lost targets → Bing · trusted sources: ${out.trustedTop.slice(0, 5).map((x) => x.d).join(", ") || "—"}`);
