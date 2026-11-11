// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// TRAFFIC BRAIN (Kai 11-11: "traffic needs its own ecosystem, huge — a brain: pyramid, managers, fractal, learns like
// neurons, holds what matters and bins the rest, modes and cycles, every traffic angle; it builds new machines"). Hourly,
// after the engine core. Repo files only (no database, no site calls) — zero backend load.
//
// PYRAMID (fractal — every level runs the same loop: SENSE vs its own normal → DECIDE → ACT → get JUDGED):
//   brain ── managers (AI answers · Search · Content · Social · Referrals · Brain) ── machines ── branches it builds
// NEURONS: one weight per (signal → action), e.g. "page surging → Bing first", "release tomorrow → pre-push", "page 1
//   bottom → rank push", "read but never clicked → hook test". A signal fires a branch only while its weight clears the
//   bar (+15% explore). Every judged branch moves its weight (reward − weight) × rate; weights not used drift back to
//   neutral (forgetting). MEMORY keeps weights, lessons (lift per release type, per channel), mode intensities and a
//   compact day history; the BIN drops retired branches > 60 d, caps every log, forgets dead weights.
// MODES: breakout (one channel ≥3× normal) · surge · event (big release ≤ 36 h) · stall (AI reads up, visits not) ·
//   dip (real visitors down) · hunt (normal → demand, rank, gaps). Each episode is judged on real visitors; the mode's
//   intensity (how hard its branches push) moves with its verdicts.
// OUTPUT: data/traffic/branches.json (alive branches carry a boost the AI machine applies to Bing sends) and
//   data/traffic/ecosystem.json — the same shape as the engine core's, so /machine draws it (Main ⇄ Traffic switch).
// GATES: max 14 alive branches, ≤4 new per run, boost within [1.2, 2.2], kill switch TRAFFIC_BRAIN=off.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

if (process.env.TRAFFIC_BRAIN === "off") { console.log("traffic brain: off"); process.exit(0); }
const NOW = Date.now(), H = 3600e3, DAY = 24 * H, OUT = "data/traffic", iso = (t) => new Date(t).toISOString();
fs.mkdirSync(OUT, { recursive: true });
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const readLines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const append = (p, o) => fs.appendFileSync(p, JSON.stringify(o) + "\n");
const cap = (p, n) => { const xs = readLines(p); if (xs.length > n) { fs.writeFileSync(p, xs.slice(-n).map((x) => JSON.stringify(x)).join("\n") + "\n"); return xs.length - n; } return 0; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => (v == null ? null : +(+v).toFixed(v >= 10 ? 0 : 2));
let seed = Math.floor(NOW / H); const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); // reproducible per hour

const main = J("data/machines/ecosystem.json", {}), ai = J("data/ai/plan.json", {}), tplan = J(`${OUT}/plan.json`, {}), hum = J("data/machines/humans.json", {});
const radar = J("data/radar/plan.json", {}), men = J("data/mentions/plan.json", {}), mode0 = J("data/machines/mode.json", {}), up = J("data/events/upcoming.json", { events: [] });
const brain = J(`${OUT}/brain.json`, { w: {}, modes: {}, lessons: {}, episode: null, born: iso(NOW) });
const B = J(`${OUT}/branches.json`, { branches: [] });
// PRIORS (empirical Bayes — "learned already"): the brain starts from what the AI machine has measured, not from zero.
// Release days lift AI reads ×learned.eventLift (4.8× on 11-11) → the pre-push neuron starts strong and every release
// type starts from that lift until its own verdicts replace it. Seeded once; real verdicts move it from there.
if (!brain.seeded) { const lift = +ai.learned?.eventLift || 0;
  if (lift > 1.2) { brain.w["event→prepush"] = { v: 0.7, n: 0, used: iso(NOW), prior: `release days ×${lift}` }; brain.lessons["event:*"] = { n: 3, lift: +lift.toFixed(2), prior: true }; }
  brain.seeded = iso(NOW); }
const feed = [], ledger = [];
const say = (m, text, kind = "do") => feed.push({ t: iso(NOW), m, text, kind });
const learn = (machine, kind, what, key) => { const row = { at: iso(NOW), key, machine, kind, what }; ledger.push(row); append(`${OUT}/ledger.jsonl`, row); };

// ── SENSE 1: AI reads per assistant (crawl history), per page, 24 h vs the 7 days before ─────────────────────────────
const months = [iso(NOW).slice(0, 7), iso(NOW - 15 * DAY).slice(0, 7)].filter((v, i, a) => a.indexOf(v) === i);
const crawl = months.flatMap((m) => readLines(`data/aicrawl/${m}.jsonl`)).filter((w) => NOW - Date.parse(w.to) < 15 * DAY);
// ChatGPT is TWO channels (11-11 correction): ChatGPT-User = a real person asking right now (drives the modes);
// OAI-SearchBot = ChatGPT building its search index (a leading signal: indexed today, answered tomorrow — not people).
const ASSIST = { chatgpt: /^ChatGPT-User$/, "chatgpt-index": /^OAI-SearchBot$/, perplexity: /^Perplexity-User$/, "perplexity-index": /^PerplexityBot$/, claude: /^Claude-(User|SearchBot)$/, bing: /^Bingbot$/, google: /^Googlebot$/, apple: /^Applebot$/, meta: /^Meta$/ };
const LIVE = /-User$|^OAI-SearchBot$|^Claude-SearchBot$|^PerplexityBot$|^Bingbot$/;
const chan = {};
for (const [c, re] of Object.entries(ASSIST)) { let d24 = 0, d7 = 0; const pages = new Map();
  for (const w of crawl) { const age = NOW - Date.parse(w.to); for (const [b, v] of Object.entries(w.bots ?? {})) { if (!re.test(b)) continue;
    if (age < DAY) { d24 += v.hits ?? 0; for (const [p, k] of v.top ?? []) pages.set(p.split("?")[0], (pages.get(p.split("?")[0]) ?? 0) + k); } else if (age < 8 * DAY) d7 += v.hits ?? 0; } }
  const normal = d7 / 7, z = (d24 - normal) / Math.sqrt(normal + 4);
  chan[c] = { reads24: d24, normal: r1(normal), x: normal ? r1(d24 / normal) : null, z: r1(z), top: [...pages].filter(([p]) => !/image|icon|\.(png|jpg|xml|txt)$/.test(p)).sort((a, b) => b[1] - a[1]).slice(0, 6) }; }
const readsOf = (prefix, from, to, re = LIVE) => { let n = 0; for (const w of crawl) { const t = Date.parse(w.to); if (t < from || t >= to) continue;
  for (const [b, v] of Object.entries(w.bots ?? {})) if (re.test(b)) for (const [p0, k] of v.top ?? []) { const q = p0.split("?")[0];
    if (q === prefix || q.startsWith(prefix.endsWith("/") ? prefix : prefix + "/") || q.startsWith(prefix + "-")) n += k; } } return n; };
// ── SENSE 2: real visitors per source (humans machine), clicks per assistant (ai-pull) ───────────────────────────────
const seg = Object.fromEntries((hum.segments ?? []).filter((s) => s.dim === "source").map((s) => [s.seg, s]));
const clicks = J("data/ai/clicks.json", {}); const clk = {};
for (const [k, v] of Object.entries(clicks)) { const [d, src] = k.split("|"); const age = NOW - Date.parse(d + "T12:00:00Z"); if (age > 15 * DAY) continue;
  const o = (clk[src] ??= { d7: 0, prev: 0 }); if (age < 7.5 * DAY) o.d7 += v[0] ?? 0; else o.prev += v[0] ?? 0; }

// ── SENSE 3: THE BOTTLENECK, PER PAGE — people who got the page through ChatGPT (ChatGPT-User fetches, 7 d) vs the
// ones who clicked through (ai-pull, src chatgpt). Pages that convert attention get pushed; pages that never do get fixed.
const liveF = new Map(), liveC = new Map();
for (const w of crawl) { if (NOW - Date.parse(w.to) > 7 * DAY) continue; const v = w.bots?.["ChatGPT-User"]; for (const [p0, k] of v?.top ?? []) { const p = p0.split("?")[0]; liveF.set(p, (liveF.get(p) ?? 0) + k); } }
for (const [k, v] of Object.entries(clicks)) { const [d, src, p] = k.split("|"); if (src !== "chatgpt" || NOW - Date.parse(d + "T12:00:00Z") > 7.5 * DAY) continue; liveC.set(p, (liveC.get(p) ?? 0) + (v[0] ?? 0)); }
const liveTotF = [...liveF.values()].reduce((a, b) => a + b, 0), liveTotC = [...liveC.values()].reduce((a, b) => a + b, 0), liveCtr0 = liveTotF ? liveTotC / liveTotF : 0.015;
// empirical-Bayes rate per page (prior = the site rate, worth 40 fetches) — small pages don't swing on one click
const liveRows = [...liveF].filter(([p, f]) => f >= 8 && !/image|icon|\.(png|jpg|xml|txt)$/.test(p)).map(([p, f]) => { const c = liveC.get(p) ?? 0, r = (c + liveCtr0 * 40) / (f + 40); return { p, fetches: f, clicks: c, rate: +r.toFixed(4), lift: +(r / Math.max(1e-4, liveCtr0)).toFixed(2) }; }).sort((a, b) => b.fetches - a.fetches);
const liveWin = liveRows.filter((x) => x.clicks >= 2 && x.lift >= 1.3).slice(0, 5), liveLose = liveRows.filter((x) => x.fetches >= 25 && x.clicks === 0).slice(0, 5);

// ── MODES (several can be on; the first decides the intensity) ──────────────────────────────────────────────────────
const M = (id) => (brain.modes[id] ??= { intensity: 1, episodes: 0, wins: 0, losses: 0 });
const modes = [];
const PEOPLE = new Set(["chatgpt", "perplexity", "claude"]);
const breakout = Object.entries(chan).filter(([k, c]) => PEOPLE.has(k) && c.reads24 >= 30 && c.normal > 0 && c.x >= 3 && c.z >= 3).sort((a, b) => b[1].z - a[1].z);
if (breakout.length) modes.push({ id: "breakout", label: "Breakout", level: "good", why: `${breakout.map(([c, v]) => `${c} ${v.x}× normal (${v.reads24} reads in 24 h)`).join(", ")} — all in on that channel` });
if (mode0.mode === "surge") modes.push({ id: "surge", label: "Surge", level: "good", why: mode0.why ?? "AI reads well above normal" });
const soon = (up.events ?? []).filter((e) => e.fam && e.imp >= 2 && e.t > NOW && e.t < NOW + 36 * H);
if (soon.length) modes.push({ id: "event", label: "Event", level: "info", why: `${soon.slice(0, 3).map((e) => e.title).join(", ")} within 36 h — pre-pushing their pages` });
const aiSeg = seg["AI answers"]; const aiReadsX = chan.chatgpt?.x ?? 1;
if (aiReadsX >= 1.5 && aiSeg && aiSeg.ratio <= 1) modes.push({ id: "stall", label: "Stall", level: "warn", why: `people asking ChatGPT ${aiReadsX}× normal but AI visitors ${aiSeg.now} vs ~${r1(aiSeg.normal)} — read, not clicked: hook tests get the top pages` });
if (hum.state === "dip") modes.push({ id: "dip", label: "Recovery", level: "warn", why: `real visitors ${hum.visitors?.now} vs ~${r1(hum.visitors?.normal)} in 24 h — pushing the pages that already convert` });
if (!modes.length) modes.push({ id: "hunt", label: "Hunt", level: "info", why: "normal day — hunting demand: page-1-bottom pages, gaps, ghosts" });
const lead = modes[0];
// episodes: a new lead mode closes the old one, judged on real visitors (during vs before)
const ep = brain.episode;
if (!ep || ep.mode !== lead.id) {
  if (ep && NOW - Date.parse(ep.since) > 3 * H) { const now0 = hum.visitors?.now ?? 0, ratio = ep.startVisitors ? now0 / ep.startVisitors : 1, m = M(ep.mode); m.episodes++;
    const good = ep.mode === "dip" || ep.mode === "stall" ? ratio >= 1.1 : ratio >= 1;
    if (good) { m.wins++; m.intensity = +clamp(m.intensity + 0.1, 0.6, 1.6).toFixed(2); } else { m.losses++; m.intensity = +clamp(m.intensity - 0.1, 0.6, 1.6).toFixed(2); }
    append(`${OUT}/modes.jsonl`, { at: iso(NOW), mode: ep.mode, since: ep.since, ratio: r1(ratio), verdict: good ? "paid" : "did not pay", intensity: m.intensity });
    learn("modes", good ? "win" : "loss", `${ep.mode} episode ${good ? "paid" : "did not pay"} (visitors ×${r1(ratio)}) → intensity ${m.intensity}`, `ep|${ep.mode}|${ep.since}`); }
  brain.episode = { mode: lead.id, since: iso(NOW), startVisitors: hum.visitors?.now ?? 0 }; say("modes", `switched to ${lead.label}: ${lead.why}`, "hot");
}
// steady modes learn too: every 24 h inside the same lead mode, the day is judged on real visitors and the next day starts
else if (NOW - Date.parse(brain.episode.segAt ?? brain.episode.since) >= DAY) { const m = M(lead.id), a0 = brain.episode.segVisitors ?? brain.episode.startVisitors ?? 0, b0 = hum.visitors?.now ?? 0;
  const good = a0 ? b0 / a0 >= (lead.id === "dip" ? 1.05 : 1) : b0 > 0; m.episodes++; good ? m.wins++ : m.losses++; m.intensity = +clamp(m.intensity + (good ? 0.05 : -0.05), 0.6, 1.6).toFixed(2);
  append(`${OUT}/modes.jsonl`, { at: iso(NOW), mode: lead.id, since: brain.episode.segAt ?? brain.episode.since, ratio: a0 ? r1(b0 / a0) : null, verdict: good ? "day paid" : "day did not pay", intensity: m.intensity });
  say("modes", `a day in ${lead.label}: visitors ${a0} → ${b0} (${good ? "paid" : "did not pay"}) → intensity ${m.intensity}`, good ? "win" : "bad");
  brain.episode.segAt = iso(NOW); brain.episode.segVisitors = b0; }
const intensity = M(lead.id).intensity;

// ── NEURONS: weight per signal→action, judged outcomes move it ──────────────────────────────────────────────────────
const W = (k) => (brain.w[k] ??= { v: 0.5, n: 0, used: iso(NOW) });
// SELF-TUNING SELECTIVITY (learning to learn): the firing bar follows the brain's own recent hit rate — most of the last 20
// judged branches paid → bolder (bar down to .32), most failed → pickier (bar up to .55). Starts at .42 until 6 verdicts.
const judged20 = B.branches.filter((b) => b.verdict && b.verdict !== "measuring").slice(-20), hit = judged20.filter((b) => b.verdict === "paying" || b.verdict === "graduated").length;
const RATE = 0.25, BAR = judged20.length >= 6 ? +clamp(0.42 - (hit / judged20.length - 0.5) * 0.3, 0.32, 0.55).toFixed(3) : 0.42;
const fire = (k) => { const w = W(k); w.used = iso(NOW); return w.v >= BAR || rnd() < 0.15; };
const reward = (k, r) => { const w = W(k); w.v = +clamp(w.v + RATE * (r - w.v), 0.05, 0.95).toFixed(3); w.n++; w.used = iso(NOW); };

// ── SHARED LEARNING (engines teach each other): the main engine's focus-branch verdicts (core + AI analyst picks) are the
// same action as this brain's surge/convergence branches (pages Bing-first) → each new verdict moves "surge→bing" at half
// strength. Every verdict anywhere teaches the brain that does the same kind of thing.
{ const seenV = (brain.sharedSeen ??= {}); const mainLed = readLines("data/machines/ledger.jsonl").filter((l) => /^spawn\|focus-/.test(l.key ?? "") && (l.kind === "win" || l.kind === "loss") && NOW - Date.parse(l.at) < 14 * DAY);
  for (const l of mainLed) { if (seenV[l.key]) continue; seenV[l.key] = 1; const w = W("surge→bing"); w.v = +clamp(w.v + (RATE / 2) * ((l.kind === "win" ? 1 : 0) - w.v), 0.05, 0.95).toFixed(3); w.used = iso(NOW);
    say("neurons", `learned from the main engine: ${l.what} → surge→bing ${w.v}`, l.kind === "win" ? "win" : "bad"); }
  for (const k of Object.keys(seenV)) if (Object.keys(seenV).length > 400) delete seenV[k]; }

// ── JUDGE every branch that is due (fractal: the same judge for every kind) ─────────────────────────────────────────
const pagePos = { ...(tplan.pagePos ?? {}), ...(tplan.pagePos7 ?? {}) }; // last-7-day position wins where Bing has it
const KIND = {
  rank: { days: 7, judge: (b) => { const p = pagePos[b.target]; if (p == null) return null; return { v: p, win: p <= b.base - 1.5 || p <= 3.5 }; } },
  channel: { days: 5, judge: (b) => { const re = ASSIST[b.chan] ?? LIVE, d = (NOW - Date.parse(b.born)) / DAY, v = readsOf(b.target, Date.parse(b.born), NOW, re) / Math.max(1, d); return { v: r1(v), win: v >= Math.max(1, b.base) * 1.2 }; } },
  event: { days: 3, judge: (b) => { const v = readsOf(b.target, Date.parse(b.born), NOW) / 3; return { v: r1(v), win: v >= Math.max(1, b.base) * 1.3 }; } },
  surge: { days: 4, judge: (b) => { const d = (NOW - Date.parse(b.born)) / DAY, v = readsOf(b.target, Date.parse(b.born), NOW) / Math.max(1, d); return { v: r1(v), win: v >= Math.max(1, b.base) * 1.2 }; } },
  stall: { days: 7, judge: (b) => { let c = 0; for (const [k, v] of Object.entries(clicks)) { const [d, , p] = k.split("|"); if (p === b.target && Date.parse(d + "T23:59:59Z") >= Date.parse(b.born)) c += v[0] ?? 0; } return { v: c, win: c > 0 }; } },
  gap: { days: 14, judge: (b) => { const d = (tplan.demand ?? []).find((x) => x.q === b.target); return { v: d?.page ? 1 : 0, win: !!d?.page && d.impr >= b.base } } },
  source: { days: 7, judge: (b) => { const s = (men.sources ?? []).find((x) => x.host === b.target); return { v: s?.v7 ?? 0, win: (s?.v7 ?? 0) >= Math.max(2, b.base * 0.8) }; } },
};
// EARN (Kai: "everything must earn"): reads alone don't pay. A branch's neuron reward = 0.6 if its own number won +
// 0.4 if its pages got real clicks from AI answers / search while it ran — so the brain learns to fire what brings PEOPLE.
const clicksOn = (target, from) => { let c = 0, a = 0; for (const [k, v] of Object.entries(clicks)) { const [d, , p] = k.split("|"); if (!p || Date.parse(d + "T23:59:59Z") < from) continue;
  if (p === target || p.startsWith(target.endsWith("/") ? target : target + "/") || p.startsWith(target + "-")) { c += v[0] ?? 0; a += v[1] ?? 0; } } return { c, a }; };
for (const b of B.branches) {
  if (b.state !== "alive") continue; const K = KIND[b.kind]; if (!K) continue;
  // EARLY READ (learn faster, Kai 11-11): from day 2, a branch that is CLEARLY winning (×2 its start, or real clicks) or
  // CLEARLY losing (under half its start) moves its neuron at half strength once — the full verdict still comes at the end.
  const age = (NOW - Date.parse(b.born)) / DAY;
  if (!b.early && age >= 2 && age < K.days) { let r0 = null; try { r0 = K.judge(b); } catch { r0 = null; }
    if (r0) { const e0 = b.path === false ? { c: 0 } : clicksOn(b.target, Date.parse(b.born)), base = Math.max(1, b.base ?? 0), hi = (b.kind === "rank" ? r0.v <= base - 3 : r0.v >= base * 2) || e0.c > 0, lo = b.kind === "rank" ? r0.v >= base + 3 : r0.v < base * 0.5 && e0.c === 0;
      if (hi || lo) { const w = W(b.neuron), tgt = hi ? 1 : 0; w.v = +clamp(w.v + (RATE / 2) * (tgt - w.v), 0.05, 0.95).toFixed(3); w.used = iso(NOW); b.early = hi ? "strong" : "weak";
        say(b.owner, `early read on ${b.target}: ${hi ? "clearly working" : "clearly not"} (${b.base} → ${r0.v}${e0.c ? `, ${e0.c} clicks` : ""}) — neuron ${b.neuron} → ${w.v}`, hi ? "win" : "bad"); } } }
  if (NOW - Date.parse(b.judged ?? b.born) < K.days * DAY) continue;
  let res = null; try { res = K.judge(b); } catch { res = null; } b.judged = iso(NOW); if (!res) continue;
  b.now = res.v; const earned = b.path === false ? { c: 0, a: 0 } : clicksOn(b.target, Date.parse(b.born)); b.clicks = earned.c; b.accounts = earned.a;
  reward(b.neuron, b.path === false ? (res.win ? 1 : 0) : (res.win ? 0.6 : 0) + (earned.c > 0 ? 0.4 : 0));
  if (res.win) { b.wins = (b.wins ?? 0) + 1; if (b.wins >= 3 || b.kind === "event" || b.kind === "gap") { b.state = "retired"; b.verdict = "graduated"; b.retired = iso(NOW); } else b.verdict = "paying";
    learn(b.owner, "win", `${b.kind} branch ${b.target}: ${b.base} → ${res.v}${b.clicks ? `, ${b.clicks} clicks` : ""} — paid`, `tb|${b.id}|${iso(NOW).slice(0, 13)}`); say(b.owner, `${b.kind} branch on ${b.target} paid (${b.base} → ${res.v})`, "win"); }
  else { b.state = "retired"; b.verdict = "did not pay"; b.retired = iso(NOW);
    learn(b.owner, "loss", `${b.kind} branch ${b.target}: ${b.base} → ${res.v} — retired, not retried for 28 days`, `tb|${b.id}|${iso(NOW).slice(0, 13)}`); say(b.owner, `${b.kind} branch on ${b.target} retired (${b.base} → ${res.v})`, "bad"); }
  if (b.kind === "event") { const t = b.fam; const L = (brain.lessons[`event:${t}`] ??= { n: 0, lift: 1 }); const lift = Math.max(1, b.base) ? res.v / Math.max(1, b.base) : 1; L.lift = +((L.lift * L.n + lift) / (L.n + 1)).toFixed(2); L.n++; }
}

// ── CONVERGENCE (Kai: "put small signs together"): independent signals pointing at the same page add up. Each extra
// signal raises that page's boost (+0.25) and lets it fire even when no single neuron clears the bar on its own.
const famKey = (p) => { const s = p.split("/").filter(Boolean); return s.length > 1 ? `/${s[0]}/${s[1]}` : `/${s[0] ?? ""}`; };
const signs = new Map(); const sign = (p, what) => { if (!p || p === "/") return; for (const k of new Set([p, famKey(p)])) { const o = signs.get(k) ?? new Set(); o.add(what); signs.set(k, o); } };
for (const [c, v] of Object.entries(chan)) if ((v.x ?? 0) >= 1.5) for (const [p] of v.top) sign(p.split("?")[0], `${c} reading`);
for (const s of ai.surges ?? []) sign(s.key, "AI surge");
for (const r of ai.rising ?? []) sign(r.key ?? r.p, "rising");
for (const e of soon) sign(e.fam.startsWith("/") ? e.fam : `/news/${e.fam}`, "release soon");
for (const r of tplan.rank ?? []) sign(r.page, "Bing page 1 bottom");
for (const g of radar.gaps ?? []) sign(g.ourPage, "AI answer gap");
for (const w of (ai.winners ?? []).slice(0, 8)) sign(w.p, "converts");
for (const x of liveWin) sign(x.p, "people click it");
for (const x of liveRows.slice(0, 6)) sign(x.p, "people ask for it");
const nSigns = (p) => Math.max(signs.get(p)?.size ?? 0, signs.get(famKey(p))?.size ?? 0);
const convergent = [...signs].filter(([p, s]) => s.size >= 3 && p.split("/").filter(Boolean).length >= 1).sort((a, b) => b[1].size - a[1].size);

// ── BUILD: signals → branches (the brain builds machines), gated by neuron weights ──────────────────────────────────
const alive = () => B.branches.filter((b) => b.state === "alive");
const blocked = (id) => B.branches.some((b) => b.id === id && (b.state === "alive" || NOW - Date.parse(b.retired ?? 0) < 28 * DAY));
let built = 0;
// AUTHORITY CASCADES DOWN (Kai 11-11: "the bigger branches, the big fractal going up, have more power over everything").
// Earned, never given: the ENGINE's authority = how often its mode episodes paid; a MANAGER's = its machines' judged wins −
// losses (30 d). A branch pushes with engine × manager × mode intensity — a proven manager's branches push harder, a
// failing one loses power over its machines until it earns it back.
const OWNER_GROUP = { channels: "ai", converter: "ai", surges: "ai", rank: "search", demand: "search", ghosts: "search", events: "content", referrals: "referral", convergence: "brain", modes: "brain" };
const led30 = readLines(`${OUT}/ledger.jsonl`).filter((l) => NOW - Date.parse(l.at) < 30 * DAY);
const tierOf = (sc) => (sc <= -2 ? 0.8 : sc < 2 ? 1 : sc < 5 ? 1.15 : sc < 10 ? 1.3 : 1.5);
const groupScore = {}; for (const l of led30) { const g = OWNER_GROUP[l.machine]; if (!g) continue; groupScore[g] = (groupScore[g] ?? 0) + (l.kind === "win" ? 1 : l.kind === "loss" ? -1 : 0); }
const AUTH = Object.fromEntries(["brain", "ai", "search", "content", "social", "referral"].map((g) => [g, tierOf(groupScore[g] ?? 0)]));
const epAll = Object.values(brain.modes).reduce((a, m) => ({ e: a.e + m.episodes, w: a.w + m.wins }), { e: 0, w: 0 });
const ENGINE_AUTH = epAll.e >= 4 ? +clamp(0.85 + 0.5 * (epAll.w / epAll.e), 0.85, 1.25).toFixed(2) : 1;
brain.authority = { engine: ENGINE_AUTH, managers: AUTH, scores: groupScore };
const boost = (p, owner) => +clamp(1.5 * intensity * ENGINE_AUTH * (AUTH[OWNER_GROUP[owner]] ?? 1) + 0.25 * Math.max(0, nSigns(p ?? "") - 1), 1.2, 2.2).toFixed(2);
const REALP = (() => { const x = J(`${OUT}/pages.json`); return x?.pages?.length > 500 ? new Set(x.pages) : null; })(); // sitemap, from the demand miner
const isReal = (p) => !REALP || REALP.has(p) || [...REALP].some((q) => q.startsWith(p.endsWith("/") ? p : p + "/")); // a family prefix counts if real pages sit under it
const build = (o) => { if (built >= 4 || alive().length >= 14) return false;
  if (o.path !== false && !isReal(o.target)) { say(o.owner, `refused a branch on ${o.target}: not a real page (sitemap)`, "bad"); return false; } const id = `${o.kind}-${o.target}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 52);
  if (blocked(id) || !(fire(o.neuron) || nSigns(o.target) >= 3)) return false;
  B.branches.push({ id, born: iso(NOW), state: "alive", boost: o.path === false ? null : boost(o.target, o.owner), signs: [...(signs.get(o.target) ?? signs.get(famKey(o.target)) ?? [])], ...o }); built++;
  learn(o.owner, "lesson", `built a ${o.kind} branch: ${o.target} (${o.why})`, `tb|${id}|born`); say(o.owner, `built a ${o.kind} branch: ${o.target}`, "win"); return true; };
// breakout: the pages that channel is reading right now
for (const [c, v] of breakout) for (const [p] of v.top.slice(0, 2)) if (p !== "/") build({ kind: "channel", owner: "channels", chan: c, target: p, neuron: `breakout:${c}→bing`, base: r1(readsOf(p, NOW - 8 * DAY, NOW - DAY, ASSIST[c]) / 7), why: `${c} reading it during a ${v.x}× breakout` });
// event pre-push: a big release's family pages, before people ask
for (const e of soon.slice(0, 3)) { const fam = e.fam.startsWith("/") ? e.fam : `/news/${e.fam}`; const L = brain.lessons[`event:${e.fam}`];
  if (L && L.n >= 2 && L.lift < 1.05) continue; // learned: this release never moves reads — skip it
  build({ kind: "event", owner: "events", fam: e.fam, target: fam, neuron: "event→prepush", base: r1(readsOf(fam, NOW - 7 * DAY, NOW) / 7), why: `${e.title} at ${iso(e.t).slice(11, 16)} UTC${L ? ` (past lift ×${L.lift})` : ""}` }); }
// surges the AI machine saw
for (const s of (ai.surges ?? []).filter((x) => x.kind === "page").slice(0, 2)) build({ kind: "surge", owner: "surges", target: s.key, neuron: "surge→bing", base: r1(s.normal), why: `${s.last24h} reads in 24 h vs ~${r1(s.normal)}` });
// rank: page-1-bottom pages with the most missed clicks
for (const r of (tplan.rank ?? []).slice(0, 3)) build({ kind: "rank", owner: "rank", target: r.page, neuron: "page1bottom→rank", base: r.pos, why: `Bing #${r.pos}, ${r.missed} clicks missed / 28 d (${(r.queries ?? []).slice(0, 2).join(", ")})` });
// stall: read a lot, never clicked → the hook machine's priority list (no Bing boost — more reads won't fix it)
const testOf = (fam) => (ai.experiments ?? []).find((e) => e.family === fam && e.status === "running");
const uncovered = [...new Set((ai.convert ?? []).filter((x) => x.reads7d >= 20 && !x.clicks7d && !testOf(x.family)).map((x) => x.family))];
const famOfP = (p) => (ai.convert ?? []).find((x) => x.p === p)?.family ?? (ai.families ?? []).find((f) => p.startsWith(f.family.split("<")[0]) && f.family !== "/")?.family ?? null;
for (const x of liveLose.slice(0, 1)) { const fam = famOfP(x.p), t = fam ? testOf(fam) : null;
  build({ kind: "stall", owner: "converter", target: x.p, neuron: "peoplenoclick→hook", base: 0, path: false, test: t?.id ?? null, why: `${x.fetches} people got it through ChatGPT in 7 d, 0 clicked${t ? ` — hook test ${t.template} running on ${fam}` : ` — no hook test covers it`}` }); }
if (modes.some((m) => m.id === "stall") || rnd() < 0.3) for (const c of (ai.convert ?? []).filter((x) => x.reads7d >= 20 && !x.clicks7d).slice(0, 1)) { const t = testOf(c.family);
  build({ kind: "stall", owner: "converter", target: c.p, neuron: "readnoclick→hook", base: 0, path: false, test: t?.id ?? null, why: `${c.reads7d} AI reads in 7 d, 0 clicks${t ? ` — hook test ${t.template} running on ${c.family}` : ` — NO hook test covers ${c.family}`}` }); }
// gaps: searches we're shown for with no page that fits (the factory backlog)
for (const g of (tplan.gaps ?? []).slice(0, 1)) build({ kind: "gap", owner: "demand", target: g.q, neuron: "gap→factory", base: g.impr, path: false, why: `Bing shows us for it (${g.impr} impressions, #${g.pos}) with no page that fits` });
// rising outside sources
for (const s of (men.rising ?? []).slice(0, 1)) build({ kind: "source", owner: "referrals", target: s.host, neuron: "rising→watch", base: s.v7, path: false, why: `${s.v7} visitors this week` });

// pages that turn people into clicks: more of that attention (Bing first)
for (const x of liveWin.slice(0, 2)) build({ kind: "surge", owner: "converter", target: x.p, neuron: "peopleclick→bing", base: r1(readsOf(x.p, NOW - 8 * DAY, NOW - DAY) / 7), why: `${x.clicks} of ${x.fetches} people who got it through ChatGPT clicked (×${x.lift} the site rate)` });
// convergence: 3+ independent signs on one page/family and nothing else covers it yet
for (const [p, s] of convergent.slice(0, 2)) if (!alive().some((b) => b.target === p)) build({ kind: "surge", owner: "convergence", target: p, neuron: "convergence→bing", base: r1(readsOf(p, NOW - 8 * DAY, NOW - DAY) / 7), why: `${s.size} signs at once: ${[...s].join(" + ")}` });

// ── MEMORY + BIN: hold what matters, drop the rest ──────────────────────────────────────────────────────────────────
let binned = 0;
const before = B.branches.length; B.branches = B.branches.filter((b) => b.state === "alive" || NOW - Date.parse(b.retired ?? b.born) < 60 * DAY); binned += before - B.branches.length;
for (const [k, w] of Object.entries(brain.w)) { const idle = (NOW - Date.parse(w.used)) / DAY; if (idle > 7) w.v = +(w.v + (0.5 - w.v) * 0.05).toFixed(3); if (idle > 60 && w.n === 0) { delete brain.w[k]; binned++; } }
binned += cap(`${OUT}/ledger.jsonl`, 1500) + cap(`${OUT}/modes.jsonl`, 300) + cap(`${OUT}/score.jsonl`, 400) + cap(`${OUT}/days.jsonl`, 180);
const today = iso(NOW).slice(0, 10), days = readLines(`${OUT}/days.jsonl`);
const dayRow = { day: today, chatgpt: chan.chatgpt?.reads24, bing: chan.bing?.reads24, perplexity: chan.perplexity?.reads24, visitors: hum.visitors?.now, aiVisitors: aiSeg?.now, mode: lead.id, alive: alive().length };
if (days.at(-1)?.day === today) { days[days.length - 1] = dayRow; fs.writeFileSync(`${OUT}/days.jsonl`, days.map((x) => JSON.stringify(x)).join("\n") + "\n"); } else append(`${OUT}/days.jsonl`, dayRow);
fs.writeFileSync(`${OUT}/branches.json`, JSON.stringify(B, null, 1));
fs.writeFileSync(`${OUT}/brain.json`, JSON.stringify(brain, null, 1));

// ── THE PYRAMID for /machine (same shape as data/machines/ecosystem.json) ───────────────────────────────────────────
const mainNode = new Map((main.nodes ?? []).map((n) => [n.id, n]));
const tl = readLines(`${OUT}/ledger.jsonl`), tLedger = (id) => tl.filter((l) => l.machine === id && NOW - Date.parse(l.at) < 30 * DAY);
const xpOf = (id, acts) => { const mine = tLedger(id), wins = mine.filter((l) => l.kind === "win").length, losses = mine.filter((l) => l.kind === "loss").length, lessons = mine.filter((l) => l.kind === "lesson").length;
  const xp = acts * 2 + wins * 40 + lessons * 25 + losses * 15, level = 1 + Math.floor(Math.log2(1 + xp / 50)), lo = 50 * (2 ** (level - 1) - 1), hi = 50 * (2 ** level - 1);
  return { xp, level, next: hi, progress: +((xp - lo) / Math.max(1, hi - lo)).toFixed(2), wins, lessons, losses, acts30: acts }; };
const GROUPS = [{ id: "brain", label: "Brain" }, { id: "ai", label: "AI answers" }, { id: "search", label: "Search" }, { id: "content", label: "Content" }, { id: "social", label: "Social" }, { id: "referral", label: "Referrals" }];
const nodes = [];
const own = (id, name, group, parent, does, every, kpi, extra = {}) => { const acts = feed.filter((f) => f.m === id).length + tLedger(id).length;
  nodes.push({ id, name, group, parent, does, every, state: "ok", lastRunH: 0, kpi, act24: feed.filter((f) => f.m === id).length, hot: false, discovered: false, recent: feed.filter((f) => f.m === id).slice(0, 5), xp: xpOf(id, acts), learns: extra.learns, born: extra.born, ...extra }); };
const reuse = (id, group, parent, rename) => { const n = mainNode.get(id); if (!n) return; nodes.push({ ...n, group, parent, name: rename ?? n.name }); };
own("core", "Traffic brain", "brain", null, `Authority ×${ENGINE_AUTH} (from its mode episodes). Runs every traffic machine in one hourly cycle: senses every channel, picks the mode, fires branches through its neurons, judges them, remembers what paid and bins the rest`, 1,
  { label: "real visitors / 24 h", now: hum.visitors?.now ?? null, before: r1(hum.visitors?.normal), change: hum.visitors?.ratio != null ? r1(hum.visitors.ratio - 1) : null });
// THE LINK to the main engine (both webs show it; click = open the other engine). Its numbers are the main engine's own.
own("main-engine", "Main engine ↗", "brain", "core", `The engine core: ${main.totals?.ok ?? "?"}/${main.totals?.machines ?? "?"} machines running. Two-way: the brain reads its machines, feed and ranks; it reads the brain's mode, branches and briefing`, 1,
  { label: "main machines running", now: main.totals?.ok ?? null, before: main.totals?.machines ?? null }, { link: "main", act24: (main.feed ?? []).filter((f) => NOW - Date.parse(f.t) < DAY).length });
for (const g of GROUPS) own(`lead-${g.id}`, `${g.label} manager`, g.id, "core", `Manages the ${g.label.toLowerCase()} machines: ranks them by what they earned, gives the proven ones more push`, 1, null);
// BRAIN modules
own("modes", "Modes", "brain", "lead-brain", `Breakout · surge · event · stall · recovery · hunt — one lead mode decides how hard branches push (now ${lead.label}, intensity ×${intensity})`, 1, { label: "episodes that paid", now: M(lead.id).wins, before: M(lead.id).episodes });
own("neurons", "Neurons", "brain", "lead-brain", `${Object.keys(brain.w).length} signal→action weights; a branch fires only above ${BAR} (15% explore); every verdict moves its weight`, 1, { label: "strongest weight", now: Math.max(0, ...Object.values(brain.w).map((w) => w.v)) });
own("memory", "Memory", "brain", "lead-brain", `Holds weights, ${Object.keys(brain.lessons).length} lessons, mode intensities and ${days.length + 1} days of history; bins retired branches > 60 d and dead weights`, 1, { label: "binned this run", now: binned });
own("convergence", "Convergence", "brain", "lead-brain", `Small signs added up: ${convergent.length} pages/families with 3+ independent signals right now${convergent[0] ? ` (top: ${convergent[0][0]} — ${[...convergent[0][1]].join(" + ")})` : ""}`, 1, { label: "pages with 3+ signs", now: convergent.length });
own("judge", "Judge", "brain", "lead-brain", "Judges every branch on its own number after its window: paid → keeps pushing (graduates after 3), didn't → retired, not retried 28 d", 1, { label: "branches alive", now: alive().length });
// AI ANSWERS
reuse("ai", "ai", "lead-ai", "AI referral machine"); for (const id of ["hooks", "curator", "truth", "surge", "rising", "sisters", "eyes"]) reuse(id, "ai", "ai");
reuse("radar", "ai", "lead-ai"); reuse("analyst", "ai", "lead-ai", "AI analyst");
own("channels", "Assistant channels", "ai", "lead-ai", `People vs indexing, per assistant, vs its own normal: ${Object.entries(chan).filter(([, c]) => c.reads24).map(([c, v]) => `${c} ${v.reads24}`).join(" · ")}; a ≥3× breakout gets its pages pushed`, 1,
  { label: "live ChatGPT fetches / 24 h", now: chan.chatgpt?.reads24 ?? 0, before: chan.chatgpt?.normal, change: chan.chatgpt?.x != null ? r1(chan.chatgpt.x - 1) : null });
own("converter", "People→click converter", "ai", "lead-ai", `Per page: people who got it through ChatGPT vs who clicked (7 d, site rate ${(liveCtr0 * 100).toFixed(1)}%). Best: ${liveWin.slice(0, 2).map((x) => `${x.p} ×${x.lift}`).join(", ") || "—"}. Never clicked: ${liveLose.slice(0, 2).map((x) => `${x.p} (${x.fetches})`).join(", ") || "—"}`, 1, { label: "people → click %", now: +(liveCtr0 * 100).toFixed(2) });
own("surges", "Surge rider", "ai", "lead-ai", "A page surging in AI reads gets a branch and Bing first while it lasts", 1, null);
// SEARCH
reuse("bing", "search", "lead-search", "Bing sender"); reuse("indexnow", "search", "lead-search"); reuse("seo", "search", "lead-search", "Google search console"); reuse("bingseo", "search", "seo"); reuse("gaps", "search", "seo");
own("demand", "Demand miner", "search", "lead-search", `Every non-brand Bing search we're shown for: ${tplan.score?.queries ?? 0} searches, ${tplan.score?.page1Bottom ?? 0} on page 1 bottom, ${tplan.score?.page2 ?? 0} on page 2, ${tplan.score?.gaps ?? 0} with no page`, 24, { label: "clicks missed / 28 d", now: tplan.score?.missed ?? null, lowerBetter: true });
own("rank", "Rank pusher", "search", "lead-search", "Pages on Bing page 1 bottom / page 2 with the most missed clicks get a rank branch: Bing first, judged on position after 7 days", 24, { label: "rank targets", now: (tplan.rank ?? []).length });
own("ghosts", "Ghost catcher", "search", "lead-search", "URLs AI assistants and people ask for that don't exist → 301 to the closest real page (2+ words must match; a wrong redirect is worse than a 404)", 24, { label: "ghost hits recovered / 14 d", now: tplan.score?.recovered ?? 0 });
// CONTENT
for (const [id, p] of [["factory", "lead-content"], ["news", "factory"], ["recaps", "factory"], ["calendar", "lead-content"], ["indicators", "calendar"], ["linkcheck", "lead-content"]]) reuse(id, "content", p);
own("events", "Event pre-push", "content", "lead-content", `Big releases ≤36 h away get their pages pushed before people ask; learns each release type's real lift (${Object.keys(brain.lessons).filter((k) => k.startsWith("event:")).length} types learned)`, 1, { label: "releases ≤ 36 h", now: soon.length });
// SOCIAL + REFERRALS
reuse("social", "social", "lead-social", "Reels (Instagram + Facebook)");
reuse("mentions", "referral", "lead-referral"); own("referrals", "Rising sources", "referral", "lead-referral", "A new outside source that starts sending people gets a branch: does it keep sending people who sign up?", 24, null);
// branches as their machine's children
for (const b of alive()) own(b.id, b.target.length > 26 ? b.target.slice(0, 25) + "…" : b.target, nodes.find((n) => n.id === b.owner)?.group ?? "brain", b.owner, `Built by the traffic brain (${b.kind}): ${b.why}${b.boost ? ` · Bing ×${b.boost}` : ""}`, 24, { label: b.kind === "rank" ? "Bing position" : "now vs start", now: b.now ?? null, before: b.base, lowerBetter: b.kind === "rank" }, { spawned: true, born: b.born });
// managers: what their machines earned → authority
for (const g of GROUPS) { const ms = nodes.filter((n) => n.group === g.id && !n.id.startsWith("lead-") && n.id !== "core"); const lead0 = nodes.find((n) => n.id === `lead-${g.id}`);
  lead0.kpi = { label: `authority ×${AUTH[g.id] ?? 1} · machines running`, now: ms.filter((n) => n.state === "ok").length, before: ms.length }; lead0.act24 = ms.reduce((a, n) => a + (n.act24 ?? 0), 0);
  lead0.does += ` Authority ×${AUTH[g.id] ?? 1} (earned: ${groupScore[g.id] ?? 0} net judged wins in 30 d) — scales how hard its machines' branches push.`; }
const ids = new Set(nodes.map((n) => n.id));
for (const n of nodes) if (n.parent && !ids.has(n.parent)) n.parent = `lead-${n.group}`;
const edges = nodes.filter((n) => n.parent).map((n) => ({ a: n.parent, b: n.id, kind: "branch", w: Math.min(1, (n.act24 ?? 0) / 10) }));
for (const [a, b] of [["demand", "rank"], ["rank", "bing"], ["surges", "bing"], ["channels", "bing"], ["events", "bing"], ["converter", "hooks"], ["radar", "ai"], ["analyst", "neurons"], ["judge", "neurons"], ["memory", "neurons"], ["modes", "judge"], ["ghosts", "bing"]])
  if (ids.has(a) && ids.has(b)) edges.push({ a, b, kind: "data", w: 0.5 });
const tFeed = [...feed, ...(main.feed ?? []).filter((f) => ids.has(f.m) && f.m !== "core")].sort((a, b) => Date.parse(b.t) - Date.parse(a.t)).slice(0, 60);
const good = [], watch = [], next = [];
const LBL = { chatgpt: "People asking ChatGPT", "chatgpt-index": "ChatGPT's search index", perplexity: "People asking Perplexity", "perplexity-index": "Perplexity's index", claude: "People asking Claude", bing: "Bing's crawler", google: "Google's crawler", apple: "Apple's crawler", meta: "Meta's crawler" };
for (const [c, v] of Object.entries(chan)) if (v.x != null && v.x >= 1.5 && v.reads24 >= 20) good.push(`${LBL[c] ?? c}: ${v.reads24} reads in 24 h, ${v.x}× normal${c.endsWith("-index") ? " (indexing — answers follow)" : ""}.`);
if (clk.chatgpt) (clk.chatgpt.d7 >= clk.chatgpt.prev ? good : watch).push(`ChatGPT clicks ${clk.chatgpt.d7} this week vs ${clk.chatgpt.prev} the week before.`);
if (aiReadsX >= 1.5 && (aiSeg?.ratio ?? 1) <= 1) watch.push("People asking ChatGPT are up but AI visitors aren't — the read→click step is the bottleneck.");
if (chan.chatgpt?.reads24) watch.push(`${chan.chatgpt.reads24} live ChatGPT fetches in 24 h → ~${clk.chatgpt ? Math.round(clk.chatgpt.d7 / 7) : 0} clicks a day: ${chan.chatgpt.reads24 && clk.chatgpt ? ((clk.chatgpt.d7 / 7 / chan.chatgpt.reads24) * 100).toFixed(1) : "?"}% of the people who ask come.`);
if (uncovered.length) watch.push(`Read but never clicked, and no hook test covers it: ${uncovered.slice(0, 3).join(", ")}.`);
if (radar.sov != null) watch.push(`AI answers mention CRTLAB in ${Math.round(radar.sov * 100)}% of buyer questions.`);
if (liveLose[0]) watch.push(`${liveLose[0].fetches} people got ${liveLose[0].p} through ChatGPT this week and none clicked.`);
if (liveWin[0]) good.push(`${liveWin[0].p}: ${liveWin[0].clicks} of ${liveWin[0].fetches} ChatGPT askers clicked — ×${liveWin[0].lift} the site rate.`);
// the other brains talk to this one (data/brains/index.json): their alerts lead the traffic briefing too
{ const peers = J("data/brains/index.json", { brains: [] }).brains ?? []; const heard = peers.filter((p) => p.mode && p.mode !== "Normal").map((p) => `${p.name}: ${p.mode}`); if (heard.length) watch.unshift(`Other brains: ${heard.join(" · ")}`); }
for (const b of alive().slice(0, 4)) next.push(`${b.kind} branch on ${b.target}: ${b.why}.`);
if (!alive().length) next.push("No branch alive yet — the brain builds its first ones as signals clear the neuron bar.");
const conclusion = lead.id === "breakout" ? `Breakout, Kai: ${lead.why}.` : lead.id === "stall" ? "Read but not clicked: AI is reading us more than it sends people. The brain is putting the hook tests on the most-read pages." : lead.id === "dip" ? "Quiet one: real visitors are under normal, so the brain is pushing the pages that already convert." : lead.id === "event" ? `Event mode: ${lead.why}.` : `Hunting: ${alive().length} branches alive, ${Object.keys(brain.w).length} neurons learning.`;
const RULE_NAME = { "surge→bing": "Bing-first on a page surging in AI reads", "convergence→bing": "Bing-first where 3+ signs meet", "event→prepush": "pre-pushing a big release's pages",
  "page1bottom→rank": "rank-pushing page-1-bottom pages", "readnoclick→hook": "hook tests on read-but-not-clicked pages", "peoplenoclick→hook": "hook tests on pages people get but never click",
  "peopleclick→bing": "Bing-first on pages people click through", "gap→factory": "asking the factory for a missing page", "rising→watch": "watching a rising outside source" };
const ruleOf = (k, w) => { const name = RULE_NAME[k] ?? (k.startsWith("breakout:") ? `riding a ${k.split(":")[1].split("→")[0]} breakout` : k), n = w.n ?? 0;
  if (!n) return w.prior ? `${name}: starts strong — ${w.prior} (prior, not yet judged here)` : null;
  return `${name}: ${w.v >= 0.6 ? "PAYS" : w.v <= 0.35 ? "doesn't pay → used less" : "mixed"} (${w.v} after ${n} verdict${n > 1 ? "s" : ""})`; };
// LEARNED RULES (the rules the brain builds for itself): every judged neuron, every learned lesson, every mode's record
const learnedRules = [...Object.entries(brain.w).map(([k, w]) => ruleOf(k, w)).filter(Boolean),
  ...Object.entries(brain.lessons).filter(([, L]) => L.n >= 1).map(([k, L]) => `${k.replace("event:", "release ")}${k === "event:*" ? " (any)" : ""} lifts AI reads ×${L.lift}${L.prior ? " (prior from the AI machine)" : ` over ${L.n} release${L.n > 1 ? "s" : ""}`}`),
  ...Object.entries(brain.modes).filter(([, m]) => m.episodes >= 2).map(([id, m]) => `${id} mode: ${m.wins}/${m.episodes} episodes paid → pushes ×${m.intensity}`)];
const eco = { at: iso(NOW), engine: "traffic", groups: GROUPS,
  widgets: main.widgets, modes, rules: [...learnedRules, "Every branch is judged on its own number; nothing is kept on faith", "A signal fires only above its neuron's bar (15% explore)", "Wrong redirects are worse than 404s", "No paid ads, no Reddit, no creator pitches — machines only"], learnedRules,
  briefing: { key: lead.id + alive().length, changed: "", headline: `${lead.label} · ${alive().length} branches · ${Object.keys(brain.w).length} neurons`, good, watch, next, conclusion },
  mode: { mode: lead.id === "dip" ? "dip" : ["breakout", "surge"].includes(lead.id) ? "surge" : "normal", since: brain.episode.since, why: lead.why, z: chan.chatgpt?.z ?? 0, r24: chan.chatgpt?.reads24 ?? 0, normal: chan.chatgpt?.normal ?? 0 },
  nodes, edges, feed: tFeed, totals: { machines: nodes.length, ok: nodes.filter((n) => n.state === "ok").length, late: nodes.filter((n) => n.state === "late").length, stopped: nodes.filter((n) => n.state === "stopped").length, actions24: tFeed.length },
  allIn: alive().filter((b) => b.boost).map((b) => ({ move: b.kind, what: b.target, why: `${b.why} · ×${b.boost}` })).slice(0, 10), fix: watch.slice(0, 3), mistakes: [],
  ledger: tl.slice(-30).reverse(), episodes: readLines(`${OUT}/modes.jsonl`).slice(-12).reverse().map((e) => ({ at: e.at, mode: e.mode, text: `${e.mode}: visitors ×${e.ratio}`, verdict: e.verdict })),
  spawned: B.branches.slice(-14).map((b) => ({ id: b.id, target: b.target, state: b.state, born: b.born, why: b.why, verdict: b.verdict, ratio: b.now })),
  score: main.score ?? [], channels: chan, live: { rate: +(liveCtr0 * 100).toFixed(2), fetches7: liveTotF, clicks7: liveTotC, best: liveWin, never: liveLose, top: liveRows.slice(0, 15) }, neurons: Object.entries(brain.w).map(([k, w]) => ({ k, v: w.v, n: w.n })).sort((a, b) => b.v - a.v) };
fs.writeFileSync(`${OUT}/ecosystem.json`, JSON.stringify(eco));
append(`${OUT}/score.jsonl`, { at: iso(NOW), mode: lead.id, alive: alive().length, built, binned, chatgpt24: chan.chatgpt?.reads24, visitors24: hum.visitors?.now });
console.log(`traffic brain: ${lead.label} (×${intensity})${modes.length > 1 ? " + " + modes.slice(1).map((m) => m.label).join(", ") : ""} · ${nodes.length} nodes · ${alive().length} branches alive (+${built}) · ${Object.keys(brain.w).length} neurons · binned ${binned}
  channels: ${Object.entries(chan).map(([c, v]) => `${c} ${v.reads24}${v.x != null ? ` (×${v.x})` : ""}`).join(" · ")}`);
