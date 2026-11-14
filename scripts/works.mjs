// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE WORKS ENGINE (11-13, Kai: "the machines got it all wrong — study WHAT WORKS and DO MORE OF IT; see the base, find what
// works best, make more of it, study if that worked, focus more on whatever works better; work harder as they find it").
// Every machine before this was scored on READS. 90 days of real data (11-13): news 2 accounts from 2,110 pages, calendar 0
// from 356, prop sims 0 from 100 — while /xauusd, /backtest-gold, /backtest, the market + concept pages brought them all.
// This engine is the ecosystem's NORTH STAR: ACCOUNTS (replayed + paid weigh more), never reads. HOURLY, cheap (one query).
//
//   SEE      the BASE: accounts/day over 28 days (the floor we already have), per source and per landing page / family
//   RANK     every page and family: Gamma–Poisson posterior of WORTH per week (account 1 · replayed +0.5 · paid +10),
//            page shrunk toward its family, family toward the site — a page with 2 visitors can't fake a win
//   FOCUS    Thompson sampling over the posteriors picks the FOCUS (winners) + EXPLORE (uncertain but promising) set; the
//            size and the push grow with EFFORT
//   BIN      families with real exposure and 0 worth go in the bin (no new pages, Bing priority ×0.3); revived the moment
//            they produce accounts again (2 in 14 d) — nothing is deleted, nothing is kept on faith
//   HANDS    data/works/plan.json → mult per page/family (read by ai-machine for every Bing send, curator, builders),
//            promote list (the winners the site links from its most-read pages), build queue (what to make more of)
//   CYCLE    one cycle per UTC day: focus + base logged (data/works/cycles.jsonl); 7 days later JUDGED — focus pages' worth
//            in the 7 d after vs their own 7 d before AND vs the non-focus pages (difference-in-differences) → ledger
//   EFFORT   1…10. A cycle that beat both → effort +1 (more focus pages, harder push, more exploring); one that lost → −1;
//            3 losses in a row → the focus rule itself flips to explore-heavy for a cycle (it was wrong, go look elsewhere)
//   TALK     ledger wins/losses/lessons, self registration (core + supervisor + /machine), north star for the executive
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import { append, readLines } from "./lib.mjs";
import { family } from "./works-lib.mjs";

const NOW = Date.now(), DAY = 864e5, iso = (t) => new Date(t).toISOString().slice(0, 10);
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const OUT = "data/works/plan.json", ST = "data/works/state.json", CYC = "data/works/cycles.jsonl", LEDGER = "data/machines/ledger.jsonl";
fs.mkdirSync("data/works", { recursive: true });
fs.mkdirSync("data/machines/self", { recursive: true });
fs.writeFileSync("data/machines/self/works.json", JSON.stringify({ id: "works", name: "WORKS engine (north star)", group: "core", parent: "core", does: "Sees the base, ranks every page type by real accounts (not reads), focuses the push on what works, bins what doesn't, judges every daily cycle and works harder as it wins", every: 1, out: OUT, feeds: ["ai", "executive", "curator", "factory"] }));
if (!process.env.ANALYTICS_DB_URL) { console.log("works: no ANALYTICS_DB_URL — skipped"); process.exit(0); }
const pg = (await import("pg")).default;
const db = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
// A conversion counts only when it CREATED the account (user made within ±1 h of it) and only once per user (first row).
// 11-13: 144 of 758 "converted" guest rows in 28 d were existing users logging in on a new device — not new accounts.
// REAL = ENGAGED visitors only (the ecosystem's one standard, humans.mjs, 11-13): replayed ≥ 1 candle or made an account — bots and headless
// floods never count as exposure, so they can't push a page into focus or keep a dead family alive (values.json rule 7)
const raw = (await db.query(`select g.id, split_part(g.landing_path,'?',1) p, coalesce(g.source,'') s, g.created_at t, g.converted_at c0,
  (g.converted_at is not null or exists (select 1 from guest_meters m where m.device_key = g.device_key and m.candles_used > 0)) real,
  g.converted_user_id uid, u.created_at uc, coalesce(u.candles_used,0) used, coalesce(u.tier,'free') tier
  from guest_presence g left join users u on u.id::text = g.converted_user_id::text
  where g.created_at > now() - interval '120 days' and g.landing_path is not null`)).rows;
// replay DEMAND per market (distinct users, 30 d) — what people actually use, for the MORE stage
const demand = (await db.query(`select upper(pair) pair, count(distinct user_id)::int users from user_events
  where created_at > now() - interval '30 days' and pair ~ '^[A-Z0-9]{3,8}$' and type not like 'IND:%' group by 1 order by 2 desc limit 40`).catch(() => ({ rows: [] }))).rows;
const botRows = raw.filter((r) => !r.real).length;
const firstOf = new Map(); // uid → earliest converting row
for (const r of raw) if (r.c0 && r.uid && (!firstOf.has(r.uid) || new Date(r.c0) < new Date(firstOf.get(r.uid).c0))) firstOf.set(r.uid, r);
const rows = raw.filter((r) => r.real).map((r) => ({ ...r, c: r.c0 && r.uc && firstOf.get(r.uid) === r && Math.abs(new Date(r.uc) - new Date(r.c0)) < 3600e3 ? r.c0 : null }));
await db.end();
// how many pages EXIST per family (the sitemap) — exposure, so a family of 2,110 pages with 12 visitors reads as dead, not small
// both sitemaps: /sitemap.xml (live families) + /sitemap-archive.xml (frozen DEAD families, site lib/works.ts, 11-13)
const sm = (u) => fetch(u, { headers: { "user-agent": "crtlab-growth-bot works" } }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
const SITEMAP = (await sm("https://crtlab.pro/sitemap.xml")) + (await sm("https://crtlab.pro/sitemap-archive.xml"));
const mapPaths = [...SITEMAP.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => { try { return new URL(m[1]).pathname.replace(/\/$/, "") || "/"; } catch { return null; } }).filter(Boolean);

// ── page families: one rule, in works-lib.mjs (every machine uses the same one) ─────────────────────────────────────────
const SRC = (s) => (s === "chatgpt" ? "chatgpt" : s === "google" ? "google" : s === "bing" || s === "search" ? "search" : !s || s === "direct" || s === "none" ? "direct" : "other");
const worth = (r) => (r.c ? 1 + (r.used > 0 ? 0.5 : 0) + (r.tier !== "free" ? 10 : 0) : 0);

// ── SEE: tally pages and families over windows ─────────────────────────────────────────────────────────────────────────
const W = { w7: 7, w28: 28, w90: 90 };
const pages = new Map(), fams = new Map(), byDay = new Map(), bySrc = {};
const T = (m, k, extra) => { let o = m.get(k); if (!o) m.set(k, (o = { key: k, v: {}, acc: {}, worth: {}, paid: 0, src: {}, ...extra })); return o; };
for (const r of rows) {
  const age = (NOW - new Date(r.t).getTime()) / DAY, f = family(r.p), s = SRC(r.s), w = worth(r);
  const P = T(pages, r.p, { fam: f }), F = T(fams, f, { pages: new Set() });
  F.pages.add(r.p);
  F.landed = F.pages.size;
  for (const [k, d] of Object.entries(W)) if (age <= d) for (const o of [P, F]) { o.v[k] = (o.v[k] ?? 0) + 1; if (r.c) { o.acc[k] = (o.acc[k] ?? 0) + 1; o.worth[k] = (o.worth[k] ?? 0) + w; } }
  if (r.c && age <= 90) { if (r.tier !== "free") { P.paid++; F.paid++; } F.src[s] = (F.src[s] ?? 0) + 1; }
  if (r.c) { const d = iso(new Date(r.c).getTime()); byDay.set(d, (byDay.get(d) ?? 0) + 1); if (age <= 28) bySrc[s] = (bySrc[s] ?? 0) + 1; }
}
for (const p of mapPaths) { const f = family(p); T(fams, f, { pages: new Set() }).pages.add(p); } // exposure = every page that exists
// the BASE: accounts per day (28 d, excluding today) — mean, spread, and per source
const days28 = [...Array(28)].map((_, i) => byDay.get(iso(NOW - (i + 1) * DAY)) ?? 0);
const mean = days28.reduce((a, b) => a + b, 0) / 28, sd = Math.sqrt(days28.reduce((a, b) => a + (b - mean) ** 2, 0) / 27);
const last7 = days28.slice(0, 7).reduce((a, b) => a + b, 0), prev21 = days28.slice(7).reduce((a, b) => a + b, 0) / 3;
const acc24 = rows.filter((r) => r.c && NOW - new Date(r.c).getTime() < DAY).length; // rolling 24 h (the page's headline number)
// the north star as a line: for each of the last 42 full days, accounts in the 7 days ending that day (same count as last7)
const weekly = [...Array(42)].map((_, i) => { const end = NOW - (42 - i) * DAY; let v = 0; for (let k = 0; k < 7; k++) v += byDay.get(iso(end - k * DAY)) ?? 0; return { t: iso(end), v }; });
const base = { weekly, last24: acc24, realVisitorShare: +((raw.length - botRows) / Math.max(1, raw.length)).toFixed(2), botRowsDropped: botRows, perDay: +mean.toFixed(1), sd: +sd.toFixed(1), floor: +Math.max(0, mean - sd).toFixed(1), last7, normalWeek: +prev21.toFixed(1), trend: prev21 ? +(last7 / prev21 - 1).toFixed(2) : null, today: byDay.get(iso(NOW)) ?? 0, zeroDays28: days28.filter((x) => !x).length, bySource28: bySrc };

// ── RANK: Gamma–Poisson posteriors of worth per week (28-day window, page shrunk to family, family to site) ────────────
const K_FAM = 2, K_PAGE = 2; // prior strength in weeks of evidence
const POOL = [...fams.values()].filter((F) => !["/", "(in-app)", "(chart)", "/backtest"].includes(F.key)); // one-page giants would set the bar
const siteRate = POOL.reduce((a, F) => a + (F.worth.w28 ?? 0), 0) / Math.max(1, POOL.reduce((a, F) => a + F.pages.size, 0)) / 4;
for (const F of fams.values()) {
  const n = F.pages.size; F.a = (F.worth.w28 ?? 0) + K_FAM * siteRate * n; F.b = 4 * n + K_FAM * n; // per page-week
  F.rate = F.a / F.b; // expected worth per page per week
}
for (const P of pages.values()) {
  const F = fams.get(P.fam); P.a = (P.worth.w28 ?? 0) + K_PAGE * F.rate; P.b = 4 + K_PAGE; P.rate = P.a / P.b;
  P.conf = +((P.v.w28 ?? 0) / ((P.v.w28 ?? 0) + 10)).toFixed(2);
}
// Gamma sampler (Marsaglia–Tsang) for Thompson sampling
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const gamma = (a) => { if (a < 1) return gamma(a + 1) * Math.pow(Math.random(), 1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = randn(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = Math.random(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
const draw = (o) => gamma(Math.max(0.05, o.a)) / o.b;

// ── STATE: effort, bin, cycles ─────────────────────────────────────────────────────────────────────────────────────────
const S = J(ST, { effort: 3, bin: {}, losses: 0, wins: 0, cycleDay: null, flips: 0 });
const L = (kind, what, key) => append(LEDGER, { at: new Date().toISOString(), key: `works|${key}`, machine: "works", kind, what });

// BIN: real exposure and nothing to show for it. Exposure = ≥ 5 pages and ≥ 20 visitors in 90 d, OR a big family (≥ 50
// pages) that can't even draw 20 visitors (made, never found). Revive on 2 accounts in 14 d (checked on the 28-d window).
const recent = (F) => rows.filter((r) => r.c && family(r.p) === F.key && NOW - new Date(r.c).getTime() < 14 * DAY).length;
for (const F of fams.values()) {
  if (F.key === "/" || F.key === "(in-app)" || F.key === "(chart)") continue;
  const n = F.pages.size, v90 = F.v.w90 ?? 0, w90 = F.worth.w90 ?? 0, inBin = !!S.bin[F.key];
  // dead = real exposure and nothing for it: (≥ 5 pages, ≥ 20 visitors, 0 worth) OR (≥ 30 pages that together made ≤ 1 account
  // per 30 pages in 90 d — made at scale, never converted)
  const dead = (n >= 5 && v90 >= 20 && w90 === 0) || (n >= 30 && (F.acc.w90 ?? 0) <= n / 30 && w90 <= 2);
  if (!inBin && dead) { S.bin[F.key] = { since: iso(NOW), why: `${n} landing pages, ${v90} visitors, ${w90} worth in 90 d` }; L("lesson", `BINNED ${F.key}: ${S.bin[F.key].why} — no new pages, Bing priority ×0.3 until it produces accounts`, `bin|${F.key}|${iso(NOW)}`); }
  else if (inBin && recent(F) >= 2) { L("win", `REVIVED ${F.key}: ${recent(F)} accounts in 14 d after the bin (${S.bin[F.key].since})`, `unbin|${F.key}|${iso(NOW)}`); delete S.bin[F.key]; }
}
// big families the site has but no visitor ever landed on (news hubs, calendar): known from the sitemap families in data/google
const cov = J("data/google/plan.json", {})?.coverage ?? [];
for (const c of cov) {
  const key = c.family.startsWith("/news") ? "/news/<release>" : c.family.startsWith("/economic-calendar") ? "/economic-calendar/<x>" : c.family.startsWith("/recap") ? "/recap/<x>" : c.family.startsWith("/answers") ? "/answers/<x>" : null;
  if (!key || S.bin[key]) continue; const F = fams.get(key);
  if (c.pages >= 15 && (F?.worth.w90 ?? 0) <= 1) { S.bin[key] = { since: iso(NOW), why: `${c.pages} pages in the sitemap, ${F?.v.w90 ?? 0} landing visitors and ${F?.worth.w90 ?? 0} worth in 90 d; Google indexed ${c.indexedPct}%` }; L("lesson", `BINNED ${key}: ${S.bin[key].why}`, `bin|${key}|${iso(NOW)}`); }
}

// ── CYCLE: judge cycles that are ≥ 7 days old (DiD: focus after/before vs rest after/before) ───────────────────────────
const pageWorthBetween = (set, from, to) => rows.reduce((a, r) => { if (!r.c) return a; const t = new Date(r.c).getTime(); if (t < from || t >= to) return a; const inF = set.has(r.p); return inF === (set.mode !== "rest") ? a + worth(r) : a; }, 0);
const cycles = readLines(CYC);
for (const cy of cycles.filter((c) => !c.verdict && NOW - Date.parse(c.at) >= 7 * DAY)) {
  const t0 = Date.parse(cy.at), focus = new Set(cy.focus), rest = Object.assign(new Set(cy.focus), { mode: "rest" });
  const fB = pageWorthBetween(focus, t0 - 7 * DAY, t0), fA = pageWorthBetween(focus, t0, t0 + 7 * DAY);
  const rB = pageWorthBetween(rest, t0 - 7 * DAY, t0), rA = pageWorthBetween(rest, t0, t0 + 7 * DAY);
  const lift = (fA + 1) / (fB + 1) / ((rA + 1) / (rB + 1));
  cy.verdict = lift >= 1.1 && fA >= fB ? "win" : lift <= 0.9 ? "loss" : "flat"; cy.judged = { fB, fA, rB, rA, lift: +lift.toFixed(2) };
  if (cy.verdict === "win") { S.wins++; S.losses = 0; S.effort = Math.min(10, S.effort + 1); }
  else if (cy.verdict === "loss") { S.losses++; S.effort = Math.max(1, S.effort - 1); }
  L(cy.verdict === "win" ? "win" : cy.verdict === "loss" ? "loss" : "lesson", `cycle ${cy.day}: focus worth ${fB}→${fA} vs rest ${rB}→${rA} (×${cy.judged.lift}) → ${cy.verdict}; effort now ${S.effort}`, `cycle|${cy.day}`);
}
if (cycles.some((c) => c.verdict)) fs.writeFileSync(CYC, cycles.map((c) => JSON.stringify(c)).join("\n") + "\n");
const flip = S.losses >= 3; // the focus rule has been wrong 3 cycles running → go explore
if (flip && S.cycleDay !== iso(NOW)) { S.flips++; L("lesson", `3 losing cycles in a row — next cycle explores (the winners list stopped predicting)`, `flip|${iso(NOW)}`); }

// ── FOCUS + EXPLORE by Thompson sampling (sizes grow with effort) ───────────────────────────────────────────────────────
const E = S.effort, nFocus = 3 + E, nExplore = Math.max(2, Math.round((flip ? 0.6 : 0.2 + 0.02 * E) * nFocus));
const APP = new Set(["(in-app)", "(chart)"]); // the app itself: people already in, not pages to push
const live = [...pages.values()].filter((P) => !APP.has(P.fam) && P.key !== "/" && !S.bin[P.fam] && (P.v.w90 ?? 0) >= 1);
const ranked = live.map((P) => ({ P, s: draw(P) })).sort((a, b) => b.s - a.s);
const focus = (flip ? [] : ranked.filter((x) => (x.P.v.w28 ?? 0) >= 10).slice(0, nFocus)).map((x) => x.P); // ≥ 10 visitors: evidence, not luck
const unc = live.filter((P) => !focus.includes(P)).map((P) => ({ P, s: draw(P) * (1 + (1 - P.conf)) })).sort((a, b) => b.s - a.s);
const explore = unc.slice(0, flip ? nFocus : nExplore).map((x) => x.P);

// TIERS — the one word every machine reads: WIN (≥ 1.5× the pooled rate), OK (≥ 0.5×), WEAK (below), DEAD (binned)
// Absolute bars (worth per page per week), so a sea of dead pages can't make everything look good: WIN ≥ 0.25 (≈ 1 account
// per page per month) · OK ≥ 0.05 (≈ 1 per page per 5 months) · WEAK below · DEAD = binned. REF 0.1 = multiplier 1.
const REF = 0.1;
const tierOf = (F) => (S.bin[F.key] ? "DEAD" : F.rate >= 0.25 ? "WIN" : F.rate >= 0.05 ? "OK" : "WEAK");
// MULTIPLIERS the hands read (bounded): family = its rate vs site, page = its posterior vs family; focus × (1 + 0.15·effort)
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const famMult = Object.fromEntries([...fams.values()].map((F) => [F.key, +(S.bin[F.key] ? 0.3 : clamp(Math.sqrt(F.rate / REF), 0.4, 3)).toFixed(2)]));
const tiers = Object.fromEntries([...fams.values()].map((F) => [F.key, tierOf(F)]));
const pageMult = {};
for (const P of focus) pageMult[P.key] = +(clamp(Math.sqrt(P.rate / Math.max(1e-6, fams.get(P.fam).rate)), 1.2, 2.5) * (1 + 0.1 * E)).toFixed(2);
for (const P of explore) pageMult[P.key] = Math.max(pageMult[P.key] ?? 0, +(1.3 + 0.05 * E).toFixed(2));

// log today's cycle once per UTC day
if (S.cycleDay !== iso(NOW)) { S.cycleDay = iso(NOW); append(CYC, { at: new Date().toISOString(), day: iso(NOW), effort: E, flip, focus: [...focus, ...explore].map((P) => P.key), base: base.perDay }); }

// BUILD QUEUE — what to make MORE of. The winning families, with the evidence, and what "more" means there. Builders (a
// Claude session, the factory) take from the top; binned families never get new pages.
const famRows = [...fams.values()].filter((F) => F.key !== "(in-app)" && F.key !== "(chart)").map((F) => ({ fam: F.key, pages: F.pages.size, landed: F.landed ?? 0, visitors90: F.v.w90 ?? 0, accounts90: F.acc.w90 ?? 0, accounts28: F.acc.w28 ?? 0, accounts7: F.acc.w7 ?? 0, paid90: F.paid, worthPerPageWeek: +F.rate.toFixed(3), mult: famMult[F.key], tier: tiers[F.key], sources90: F.src, bin: S.bin[F.key] ?? null })).sort((a, b) => b.worthPerPageWeek - a.worthPerPageWeek);
const MORE = { "/backtest-<market>": "rank the winners higher (titles, depth, internal links); new only for a market with replay demand and no page", "/<concept>-backtesting": "concepts that convert → their best market version first", "/backtest": "the AI-recommended page: protect it, link to it, measure it", "/tools/<x>": "tools that convert: link them from the market pages" };
const queue = famRows.filter((r) => !r.bin && r.accounts90 >= 3 && r.fam !== "/").slice(0, 6).map((r, i) => ({ rank: i + 1, fam: r.fam, why: `${r.accounts90} accounts from ${r.pages} pages in 90 d (${r.worthPerPageWeek}/page/wk, ×${r.mult} vs site)`, more: MORE[r.fam] ?? "make the next page of this type where real demand exists; judged 14 d after it ships" }));
// ── MORE (11-13): what to make more of — only where the family WINS and real demand exists, never in a DEAD family ──────
//   rank jobs  winner-family pages Google already shows (impressions) but below the top 3 → titles / depth / internal links
//   new pages  a market people replay (≥ 10 users / 30 d) with no backtest-<market> page; capped 2 / week (no spam)
const GP = J("data/google/plan.json", {}), mapSet = new Set(mapPaths);
// brand searches ("crtlab") already land on the home page — a rank job only counts NON-brand impressions (Google topQueries)
const BRANDQ = /crt\s*-?\s*labs?|crtlab/i, nb = {}; for (const q of GP.topQueries ?? []) if (!BRANDQ.test(q.q)) nb[q.p] = (nb[q.p] ?? 0) + q.impr;
const rankJobs = [...(Array.isArray(GP.rank) ? GP.rank : [])].map((r) => ({ ...r, impr: nb[r.page] ?? Math.round(r.impr * ((r.queries ?? []).filter((q) => !BRANDQ.test(q)).length / Math.max(1, (r.queries ?? []).length)) * 0.5) })).filter((r) => r.page && r.impr >= 20 && r.pos > 3 && ["WIN", "OK"].includes(tiers[family(r.page)]))
  .filter((r, i, a) => a.findIndex((x) => x.page === r.page) === i).sort((a, b) => b.impr * (1 / Math.max(1, a.pos)) - a.impr * (1 / Math.max(1, b.pos))).slice(0, 4)
  .map((r) => ({ kind: "rank", page: r.page, why: `Google shows it ~${r.impr}× / 28 d for non-brand searches at position ${r.pos} (${tiers[family(r.page)]} family) — top 3 gets ~3× the clicks` }));
const SLUG = { XAUUSD: "gold", XAGUSD: "silver", USOIL: "oil", BTCUSD: "bitcoin", ETHUSD: "ethereum", SOLUSD: "solana", GER40: "dax" };
const weekNew = readLines(CYC).filter((c) => NOW - Date.parse(c.at) < 7 * DAY).flatMap((c) => c.queued ?? []).length;
const newJobs = tiers["/backtest-<market>"] === "WIN" || tiers["/backtest-<market>"] === "OK" ? demand.filter((d) => d.users >= 10).map((d) => ({ d, slug: `/backtest-${SLUG[d.pair] ?? d.pair.toLowerCase()}` }))
  .filter((x) => !mapSet.has(x.slug)).slice(0, Math.max(0, 2 - weekNew)).map((x) => ({ kind: "new", page: x.slug, why: `${x.d.users} people replayed ${x.d.pair} in 30 d and it has no backtest page; the family converts (${famRows.find((f) => f.fam === "/backtest-<market>")?.accounts90} accounts / 90 d)` })) : [];
const more = { rankJobs, newJobs, demand: demand.slice(0, 15), note: newJobs.length ? null : "every market with real replay demand already has its page — the lever is REACH for the winners (rank jobs, links, Bing), not more pages" };
// ── ALIGNMENT AUDIT (11-13, Kai: "why couldn't you figure out the machines were wrong?") — the review that would have caught
// it, run every hour: where did the machines' EFFORT actually go (Bing sends, 7 d) vs where ACCOUNTS come from? More than a
// third of the effort on WEAK/DEAD families = misaligned → ledger loss once a day + a build-queue item, until it's fixed.
const SUBM = J("data/ai/submitted.json", {}), eff = { WIN: 0, OK: 0, WEAK: 0, DEAD: 0, other: 0 };
for (const [p, t] of Object.entries(SUBM)) if (NOW - Date.parse(t) < 7 * DAY) eff[tiers[family(p)] ?? "other"]++;
const effTot = Object.values(eff).reduce((a, b) => a + b, 0), wasted = effTot ? (eff.WEAK + eff.DEAD) / effTot : 0;
const audit = { bingSends7: eff, wastedShare: +wasted.toFixed(2), aligned: wasted <= 0.34, at: new Date().toISOString(),
  say: effTot ? `${Math.round(wasted * 100)}% of the last 7 days' Bing sends went to WEAK/DEAD families (${eff.WEAK + eff.DEAD} of ${effTot})` : "no sends in 7 d" };
if (!audit.aligned && S.auditDay !== iso(NOW)) { S.auditDay = iso(NOW); L("loss", `MISALIGNED: ${audit.say} — effort is going where accounts don't come from`, `audit|${iso(NOW)}`); }
const promote = focus.slice(0, 6).map((P) => ({ path: P.key, fam: P.fam, accounts28: P.acc.w28 ?? 0 }));

const plan = {
  at: new Date().toISOString(),
  northStar: { metric: "accounts / week (worth: account 1, replayed +0.5, paid +10)", now: last7, normal: base.normalWeek, trend: base.trend },
  base, effort: E, wins: S.wins, losses: S.losses, flip,
  focus: focus.map((P) => ({ path: P.key, fam: P.fam, acc28: P.acc.w28 ?? 0, v28: P.v.w28 ?? 0, rate: +P.rate.toFixed(2), mult: pageMult[P.key] })),
  explore: explore.map((P) => ({ path: P.key, fam: P.fam, acc28: P.acc.w28 ?? 0, v28: P.v.w28 ?? 0, conf: P.conf, mult: pageMult[P.key] })),
  families: famRows, bin: S.bin, tiers, famMult, pageMult, queue, promote, more, audit,
  cycles: { total: readLines(CYC).length, judged: readLines(CYC).filter((c) => c.verdict).slice(-5).map((c) => ({ day: c.day, verdict: c.verdict, lift: c.judged?.lift })) },
  say: `Base ${base.perDay} accounts/day (floor ${base.floor}); this week ${last7} vs normal ${base.normalWeek}. Effort ${E}/10. Focus: ${focus.slice(0, 4).map((P) => P.key).join(", ")}. Bin: ${Object.keys(S.bin).join(", ") || "none"}. Audit: ${audit.say}.`,
};
// FREEZE: keep the tiers the site last used (no family moved in/out of the main sitemap); fresh `at` so the site doesn't treat it as stale
{ const { frozen } = await import("./lib.mjs"); if (frozen("sitemap-tiers") && fs.existsSync(OUT)) { const prev = JSON.parse(fs.readFileSync(OUT, "utf8")); if (prev.tiers) { plan.liveTiers = plan.tiers; plan.tiers = prev.tiers; plan.frozen = true; console.log("works: tiers FROZEN (traffic freeze)"); } } }
fs.writeFileSync(OUT, JSON.stringify(plan, null, 1));
fs.writeFileSync(ST, JSON.stringify(S, null, 1));
console.log("works:", plan.say);
