// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// WORLD MODEL (11-12 — "the machines can't tell what's working": 0 verdicts anywhere, loops of 7–28 days, and no way to
// split "our push did it" from "ChatGPT grew anyway"). A predictive brain for the whole ecosystem, files only:
//   1. FORECAST every page, every day: expected people-fetches (ChatGPT-User / Claude-User / Perplexity-User) = the page's
//      last 7 days, shrunk to its family when thin (empirical Bayes) × THE SITE'S OWN TREND THAT DAY (so ChatGPT's growth is
//      never credited to a machine) × a release-day lift it learns from the residuals themselves.
//   2. RESIDUAL = ln((actual + ½) / (expected + ½)) — how far a page beat or missed its own forecast.
//   3. CREDIT, every day, for every ACTION the machines take — Bing send (48 h), brain boost, sister spread, lock-in: the
//      treated pages' residuals minus the untouched pages of the same family the same day; pooled with a bootstrap CI.
//      → one verdict per action per day (the learning pulse counts them), and the traffic brain's neurons learn daily.
//   4. TOMORROW: a forecast per page — pages expected to jump (a release, a trend) go to the AI machine before demand.
// Writes data/world/{credit.json, forecast.json, residuals.jsonl}. Never touches the site or the database.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/world";
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const lines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const iso = (t) => new Date(t).toISOString().slice(0, 10), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
fs.mkdirSync(OUT, { recursive: true });
const prev = J(`${OUT}/credit.json`, {});

const PEOPLE = /^(ChatGPT-User|Claude-User|Perplexity-User)$/, AIENG = /^(chatgpt|perplexity|copilot|gemini|claude)$/;
const norm = (p0) => (p0.split("?")[0].replace(/\/$/, "") || "/");
const skip = (p) => /^\/(api|_next|auth)|image|icon|\.(png|jpg|svg|xml|txt|ico)$/.test(p);
const family = (p) => { const s = p.split("/").filter(Boolean); if (!s.length) return "/"; if (s.length === 1) return /-challenge-simulator$/.test(s[0]) ? "/<firm>-sim" : /^backtest-/.test(s[0]) ? "/backtest-<x>" : "/<page>"; return `/${s[0]}/<${s.length > 2 ? "x/y" : "x"}>`; };

// ── DATA: people-fetches + AI clicks per page per day ────────────────────────────────────────────────────────────────
const months = [...new Set([0, 15, 30].map((d) => new Date(NOW - d * DAY).toISOString().slice(0, 7)))];
const F = new Map(), C = new Map(), siteDay = new Map(); // page → day → n
const add = (M, p, d, n) => { const m = M.get(p) ?? M.set(p, new Map()).get(p); m.set(d, (m.get(d) ?? 0) + n); };
for (const w of months.flatMap((m) => lines(`data/aicrawl/${m}.jsonl`))) { const d = iso(Date.parse(w.to) - 1); for (const [b, v] of Object.entries(w.bots ?? {})) if (PEOPLE.test(b)) for (const [p0, n] of v.top ?? []) { const p = norm(p0); if (skip(p)) continue; add(F, p, d, n); siteDay.set(d, (siteDay.get(d) ?? 0) + n); } }
for (const [k, v] of Object.entries(J("data/ai/clicks.json", {}))) { const [d, eng, p0] = k.split("|"); if (AIENG.test(eng)) add(C, norm(p0 || "/"), d, v[0] ?? 0); }
const days = [...siteDay.keys()].sort(), today = iso(NOW), full = days.filter((d) => d < today); // only finished days are judged

// ── HOURLY: TRUE SURGES (11-12) — every other surge detector compared a page to its own 14-day average while the whole site
// grew +24 %/day, so nearly everything "surged" (history: surge→bing paid 0.38). A true surge beats a forecast that already
// includes the site's own growth: last 24 h vs (the page's 7-day pace, shrunk to family) × (site last 24 h ÷ site 7-day pace).
{ const r24 = new Map(); let site24 = 0;
  for (const w of months.flatMap((m) => lines(`data/aicrawl/${m}.jsonl`))) { if (NOW - Date.parse(w.to) > DAY) continue; for (const [b, v] of Object.entries(w.bots ?? {})) if (PEOPLE.test(b)) for (const [p0, n] of v.top ?? []) { const p = norm(p0); if (skip(p)) continue; r24.set(p, (r24.get(p) ?? 0) + n); site24 += n; } }
  const fullD = days.filter((d) => d < today).slice(-7), sitePace = fullD.reduce((a, d) => a + (siteDay.get(d) ?? 0), 0) / Math.max(1, fullD.length), trend24 = site24 / Math.max(1, sitePace);
  const famPace = new Map(); for (const [p, m] of F) { const f = family(p); const o = famPace.get(f) ?? { s: 0, n: 0 }; o.n++; for (const d of fullD) o.s += m.get(d) ?? 0; famPace.set(f, o); }
  const out = [];
  for (const [p, act] of r24) { let s7 = 0; for (const d of fullD) s7 += F.get(p)?.get(d) ?? 0; const fp = famPace.get(family(p)), fd = fp ? fp.s / fp.n / Math.max(1, fullD.length) : 0;
    const base = (s7 + 3 * fd) / (Math.max(1, fullD.length) + 3), exp = base * trend24, z = (act - exp) / Math.sqrt(exp + 1);
    if (act >= 6 && act >= 2.5 * Math.max(0.5, exp) && z >= 3) out.push({ p, last24h: act, expected: +exp.toFixed(1), x: +(act / Math.max(0.5, exp)).toFixed(1), z: +z.toFixed(1) }); }
  out.sort((a, b) => b.z - a.z);
  fs.writeFileSync(`${OUT}/surges.json`, JSON.stringify({ at: new Date().toISOString(), siteTrend24: +trend24.toFixed(2), pages: out.slice(0, 30) }, null, 1));
  console.log(`world surges: ${out.length} true surges (site trend ×${trend24.toFixed(2)} in 24 h)${out.length ? " — " + out.slice(0, 4).map((x) => `${x.p} ${x.last24h} vs ~${x.expected}`).join(", ") : ""}`); }
if (full.length < 9) { console.log(`world: ${full.length} finished days of reads — needs 9`); process.exit(0); }
if (prev.at && NOW - Date.parse(prev.at) < 20 * 3600e3 && !process.env.FORCE) { console.log(`world: model ran ${((NOW - Date.parse(prev.at)) / 3600e3).toFixed(1)} h ago — once a day`); process.exit(0); }

// ── ACTIONS (treatments) per page-day ─────────────────────────────────────────────────────────────────────────────────
const sends = lines(`${OUT}/sends.jsonl`), branches = J("data/traffic/branches.json", { branches: [] }).branches ?? [], sisters = lines("data/machines/sisters.jsonl");
const waves = lines("data/machines/waves.jsonl"), lock = J("data/machines/lockin.json", {});
const HO = J("data/ai/holdout.json", null), fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h % 100; };
const held = (p) => !!HO && p !== "/" && fnv(HO.salt + p) < HO.pct;
const sentBy = new Map(); for (const s of sends) (sentBy.get(norm(s.p)) ?? sentBy.set(norm(s.p), []).get(norm(s.p))).push(Date.parse(s.at));
const ACTIONS = {
  "bing-send": (p, d) => (sentBy.get(p) ?? []).some((t) => t < Date.parse(d + "T00:00:00Z") && t >= Date.parse(d + "T00:00:00Z") - 2 * DAY),
  "brain-boost": (p, d) => branches.some((b) => b.path !== false && b.boost && (p === b.target || p.startsWith(b.target + "/")) && iso(Date.parse(b.born)) < d && (!b.retired || iso(Date.parse(b.retired)) >= d)),
  "sister-spread": (p, d) => sisters.some((x) => norm(x.p) === p && x.d < d && Date.parse(d) - Date.parse(x.d) <= 3 * DAY),
  "lock-in": (p, d) => [...waves.map((w) => ({ a: w.since, b: w.at, t: w.targets })), ...(lock.on ? [{ a: lock.since, b: new Date().toISOString(), t: lock.targets }] : [])].some((w) => (w.t ?? []).includes(p) && iso(Date.parse(w.a)) <= d && iso(Date.parse(w.b)) >= d),
};

// ── 1+2. FORECAST + RESIDUALS for every page-day with 7 days behind it ──────────────────────────────────────────────
const get = (M, p, d) => M.get(p)?.get(d) ?? 0;
const back = (d, k) => iso(Date.parse(d + "T12:00:00Z") - k * DAY);
const famDaily = (f, d) => { let s = 0, n = 0; for (const [p, m] of F) if (family(p) === f) { n++; for (let k = 1; k <= 7; k++) s += m.get(back(d, k)) ?? 0; } return n ? s / n / 7 : 0; };
const famCache = new Map(), famOf = (f, d) => { const k = f + d; if (!famCache.has(k)) famCache.set(k, famDaily(f, d)); return famCache.get(k); };
const siteAvg7 = (d) => { let s = 0; for (let k = 1; k <= 7; k++) s += siteDay.get(back(d, k)) ?? 0; return s / 7; };
const rows = [];
for (const d of full.slice(7)) {
  const G = (siteDay.get(d) ?? 0) / Math.max(1, siteAvg7(d)); // the site's own trend that day
  for (const [p, m] of F) { let s7 = 0; for (let k = 1; k <= 7; k++) s7 += m.get(back(d, k)) ?? 0;
    const f = family(p), fd = famOf(f, d), base = (s7 + 3 * fd) / (7 + 3); if (base < 0.15 && !(m.get(d) > 0)) continue; // never-read pages carry no signal
    const exp = base * G, act = get(F, p, d);
    rows.push({ p, d, f, exp, act, lr: Math.log((act + 0.5) / (exp + 0.5)), clk: get(C, p, d), held: held(p), acts: Object.fromEntries(Object.entries(ACTIONS).map(([k, fn]) => [k, !!fn(p, d)])) }); }
}
// release-day lift, learned from the residuals of the release family's pages on its release day (vs the same pages' other days)
const idx = J("data/events/index.json", []), relDays = new Map(); for (const x of Array.isArray(idx) ? idx : []) for (const fam of x.fams ?? []) (relDays.get(fam) ?? relDays.set(fam, new Set()).get(fam)).add(x.date);
const relFam = (p) => { const m = p.match(/^\/news\/([a-z-]+?)(?:-\d{4}-\d{2}-\d{2})?(?:\/|$)/); return m ? m[1] : null; };
let rOn = [], rOff = []; for (const r of rows) { const fam = relFam(r.p); if (!fam || !relDays.has(fam)) continue; (relDays.get(fam).has(r.d) || relDays.get(fam).has(back(r.d, -1)) ? rOn : rOff).push(r.lr); }
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const relLift = rOn.length >= 10 ? +Math.exp(mean(rOn) - mean(rOff)).toFixed(2) : 1;
for (const r of rows) { const fam = relFam(r.p); if (fam && relDays.get(fam)?.has(r.d) && relLift !== 1) { r.exp *= relLift; r.lr = Math.log((r.act + 0.5) / (r.exp + 0.5)); } }

// ── 3. CREDIT per action: treated − untouched, same family + same day; bootstrap over treated units ──────────────────
const cells = new Map(); for (const r of rows) { const k = r.f + "|" + r.d; (cells.get(k) ?? cells.set(k, []).get(k)).push(r); }
const credit = {};
for (const a of Object.keys(ACTIONS)) {
  const units = []; // one per treated page-day: its residual minus the mean residual of untouched pages in its cell
  const perDay = {};
  for (const [, rs] of cells) { const ctl = rs.filter((r) => !Object.values(r.acts).some(Boolean)); if (ctl.length < 3) continue; const mc = mean(ctl.map((r) => r.lr)), mcc = mean(ctl.map((r) => r.clk / Math.max(0.5, r.exp)));
    for (const r of rs.filter((x) => x.acts[a])) { units.push({ d: r.lr - mc, c: r.clk / Math.max(0.5, r.exp) - mcc }); perDay[r.d] = (perDay[r.d] ?? 0) + 1; } }
  if (units.length < 5) { credit[a] = { units: units.length, lift: null, note: "not enough treated page-days yet" }; continue; }
  const m = mean(units.map((u) => u.d)), boots = [];
  for (let i = 0; i < 1000; i++) { let s = 0; for (let j = 0; j < units.length; j++) s += units[Math.floor(Math.random() * units.length)].d; boots.push(s / units.length); }
  boots.sort((x, y) => x - y);
  const lo = Math.exp(boots[25]), hi = Math.exp(boots[974]), lift = Math.exp(m);
  credit[a] = { units: units.length, days: Object.keys(perDay).length, lift: +lift.toFixed(2), ci: [+lo.toFixed(2), +hi.toFixed(2)], clicksPerFetchDiff: +mean(units.map((u) => u.c)).toFixed(4),
    verdict: lo > 1.05 ? "WORKS" : hi < 0.95 ? "HURTS" : "no clear effect yet" };
}
// CONTEXT: the same credit split by FAMILY (where does each push pay?) — the AI machine allocates the Bing quota by it.
// Shrunk to 1 by sample size (K 30) so a thin family can't swing; only families with 8+ treated page-days are reported.
for (const a of ["bing-send", "brain-boost"]) { const byF = {};
  for (const [k, rs] of cells) { const ctl = rs.filter((r) => !Object.values(r.acts).some(Boolean)); if (ctl.length < 3) continue; const mc = mean(ctl.map((r) => r.lr)), f = k.split("|")[0];
    for (const r of rs.filter((x) => x.acts[a])) (byF[f] ??= []).push(r.lr - mc); }
  credit[a] && (credit[a].byFamily = Object.fromEntries(Object.entries(byF).filter(([, xs]) => xs.length >= 8).map(([f, xs]) => { const raw = Math.exp(mean(xs)); return [f, { units: xs.length, lift: +raw.toFixed(2), weight: +(1 + (raw - 1) * xs.length / (xs.length + 30)).toFixed(3) }]; }))); }
// the holdout's view through the same model (held pages vs the rest, same cells) — a second, independent read on pushing
{ const u = []; for (const [, rs] of cells) { const h = rs.filter((r) => r.held), o = rs.filter((r) => !r.held); if (h.length && o.length >= 3) for (const r of h) u.push(r.lr - mean(o.map((x) => x.lr))); }
  credit["held-out (not pushed)"] = { units: u.length, lift: u.length >= 5 ? +Math.exp(mean(u)).toFixed(2) : null }; }

// ── 4. TOMORROW: forecast per page (trend = the site's last 3 days vs its 7-day pace; release tomorrow × the learned lift) ──
const last = full.at(-1), trend = clamp(((siteDay.get(last) ?? 0) + (siteDay.get(back(last, 1)) ?? 0) + (siteDay.get(back(last, 2)) ?? 0)) / 3 / Math.max(1, siteAvg7(back(last, -1))), 0.5, 2);
const up = J("data/events/upcoming.json", { events: [] }).events ?? [], tom = iso(NOW + DAY), relTom = new Set(up.filter((e) => e.fam && iso(e.t) === tom).map((e) => e.fam));
const fc = []; for (const [p, m] of F) { let s7 = 0; for (let k = 0; k < 7; k++) s7 += m.get(back(today, k)) ?? 0; const base = (s7 + 3 * famOf(family(p), today)) / 10; if (base < 0.3) continue;
  const rel = relTom.has(relFam(p) ?? "~") ? relLift : 1; fc.push({ p, base: +base.toFixed(2), tomorrow: +(base * trend * rel).toFixed(2), why: rel > 1 ? `release tomorrow ×${relLift}` : null }); }
fc.sort((a, b) => b.tomorrow - a.tomorrow);

// ── THE CURVE (Kai: "project the curve"): log-linear fit over the finished days, site-wide — people-fetches, AI clicks,
// AI accounts → daily growth rate, doubling time, 7- and 30-day projection; and the GAP: reads compounding faster than clicks
// = the conversion bottleneck as one number.
const fit = (ys) => { const xs = ys.map((_, i) => i), n = ys.length, ly = ys.map((y) => Math.log(y + 0.5)), mx = mean(xs), my = mean(ly);
  const b = xs.reduce((a, x, i) => a + (x - mx) * (ly[i] - my), 0) / Math.max(1e-9, xs.reduce((a, x) => a + (x - mx) ** 2, 0)), a0 = my - b * mx;
  // DAMPED projection (growth fades 10 %/day — 11 days of +24 %/day can't be compounded for 30; truth rule)
  const now0 = Math.exp(a0 + b * (n - 1)) - 0.5, proj = (h) => { let v = Math.log(Math.max(0.5, now0 + 0.5)); for (let k = 1; k <= h; k++) v += b * 0.9 ** k; return Math.max(0, Math.exp(v) - 0.5); };
  return { perDay: +((Math.exp(b) - 1) * 100).toFixed(1), doublingDays: b > 0.005 ? +(Math.log(2) / b).toFixed(1) : null, now: +now0.toFixed(1), in7: +proj(7).toFixed(0), in30: +proj(30).toFixed(0) }; };
const cDay = (d) => { let c = 0; for (const [, m] of C) c += m.get(d) ?? 0; return c; };
const aDay = (d) => { let a = 0; for (const [k, v] of Object.entries(J("data/ai/clicks.json", {}))) { const [dd, eng] = k.split("|"); if (dd === d && AIENG.test(eng)) a += v[1] ?? 0; } return a; };
const span = full.slice(-14), curve = { days: span.length, reads: fit(span.map((d) => siteDay.get(d) ?? 0)), clicks: fit(span.map(cDay)), accounts: fit(span.map(aDay)) };
curve.gap = +(curve.reads.perDay - curve.clicks.perDay).toFixed(1); // % per day reads outgrow clicks

// ── OUT ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const fitErr = rows.length ? +Math.sqrt(mean(rows.map((r) => r.lr * r.lr))).toFixed(3) : null; // how good the forecast is (lower = sharper)
const C0 = { at: new Date().toISOString(), curve, days: full.length, pageDays: rows.length, fitError: fitErr, siteTrendTomorrow: +trend.toFixed(2), releaseLift: relLift, credit,
  verdicts: Object.values(credit).filter((c) => c.verdict && c.verdict !== "no clear effect yet").length };
fs.writeFileSync(`${OUT}/credit.json`, JSON.stringify(C0, null, 1));
fs.writeFileSync(`${OUT}/forecast.json`, JSON.stringify({ at: C0.at, for: tom, trend: C0.siteTrendTomorrow, pages: fc.slice(0, 300), jumps: fc.filter((x) => x.why).slice(0, 40) }));
fs.appendFileSync(`${OUT}/residuals.jsonl`, JSON.stringify({ day: today, fitError: fitErr, credit: Object.fromEntries(Object.entries(credit).map(([k, v]) => [k, v.lift])) }) + "\n");
console.log(`world curve (${curve.days} d): reads ${curve.reads.perDay}%/day → ${curve.reads.in30} in 30 d · clicks ${curve.clicks.perDay}%/day → ${curve.clicks.in30} · accounts ${curve.accounts.perDay}%/day · gap ${curve.gap}%/day`);
console.log(`world: ${rows.length} page-days over ${full.length} days · forecast error ${fitErr} · release lift ×${relLift} · tomorrow ×${C0.siteTrendTomorrow} · credit: ${Object.entries(credit).map(([k, v]) => `${k} ${v.lift ?? "—"}${v.ci ? ` [${v.ci.join("–")}] ${v.verdict}` : ""} (${v.units})`).join(" · ")}`);
