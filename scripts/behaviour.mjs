// BEHAVIOUR MACHINE (11-10, Kai: "the live feed is data being wasted — learn, react and act on every event, per device and
// country, spot patterns, no ceiling"). Daily: pulls each finished day from crtlab.pro/api/ops/behaviour (totals only,
// per device / country) into data/behaviour/days/, then learns from ALL days (recent ones count more, half-life 14 d):
//   GOLDEN ACTIONS  first-day clicks that predict coming back on day 7 / signing up — per device (empirical Bayes: every
//                   action starts at its device's baseline and moves to its own rate as people accumulate)
//   ANTI-PATTERNS   first-day actions followed by people NOT coming back
//   STALLS          what people click last before leaving, against how often it is clicked — per device
//   BREAKS / RISES  a well-used control whose daily users fall to < 40% of its normal (something broke) → email; one
//                   that jumps (z ≥ 3) → noted as rising
//   COUNTRIES       day-7 return and sign-up rate per country, shrunk to the global rate
//   WALL FUNNEL     free-limit funnel per device, each step's pass rate and trend
// Writes data/behaviour/plan.json (read by the Growth board + Monday email) and feeds the return machine (golden paths =
// what new users are steered to). Learns more with every day it sees; nothing to tune by hand.
import fs from "node:fs";
import { SITE, append, readLines } from "./lib.mjs";

const D = "data/behaviour/days", DAY = 86400000, NOW = Date.now(), HALF = 14;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
fs.mkdirSync(D, { recursive: true });
// one control = one key: labels carrying numbers, dates or a user's own text ("37% of today's free usage…", a session named
// "13 Sept – Oct 19 XAUUSD…") are folded to a shape, so a button is learned as one thing, and nobody's text is kept
const MON = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi;
const norm = (k) => String(k).length <= 10 ? String(k) : String(k).replace(MON, "<mon>").replace(/[−+$]?\d+([.,:]\d+)*\s*(%|r\b|×)?/gi, (m, _a, u) => (u ? `#${u}` : "#")).replace(/\s+/g, " ").trim().slice(0, 60);
// PUBLIC REPO: a day is stored only after every label is folded (no one's own text is ever written to disk)
const clean = (d) => { for (const t of ["features", "cohort", "exits"]) for (const x of d[t] ?? []) if (x.k !== "__all__") x.k = norm(x.k); return d; };

// 1. pull missing finished days (up to 21 back; the endpoint answers one day per call)
if (process.env.OPS_KEY) {
  for (let i = 21; i >= 1; i--) {
    const day = iso(NOW - i * DAY), f = `${D}/${day}.json`;
    if (fs.existsSync(f) && i > 1) continue; // yesterday is re-read once (late events)
    const r = await fetch(`${SITE}/api/ops/behaviour?day=${day}`, { headers: { "x-ops-key": process.env.OPS_KEY } }).catch(() => null);
    if (!r || r.status !== 200) { if (r?.status === 404) { console.log("behaviour endpoint not live yet"); break; } continue; }
    fs.writeFileSync(f, JSON.stringify(clean(await r.json())));
  }
}
const days = fs.readdirSync(D).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map((f) => { const d = clean(JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8"))); fs.writeFileSync(`${D}/${f}`, JSON.stringify(d)); return d; });
if (!days.length) { console.log("behaviour: no days yet"); process.exit(0); }
const w = (day) => Math.pow(0.5, (NOW - Date.parse(day + "T12:00:00Z")) / DAY / HALF);
const DEV = (d) => (/mobile|phone/i.test(d) ? "mobile" : /tablet|ipad/i.test(d) ? "tablet" : /desktop/i.test(d) ? "desktop" : "other");
const r2 = (x) => +x.toFixed(2), pct = (x) => +(100 * x).toFixed(1);

// 2. golden actions / anti-patterns per device
const base = {}, act = {}, ccs = {};
for (const d of days) { const wt = w(d.day);
  for (const c of d.cohort ?? []) { const dev = DEV(c.dev);
    if (c.k === "__all__") { const b = (base[dev] ??= { u: 0, back: 0, signed: 0 }); b.u += c.users * wt; b.back += c.back * wt; b.signed += c.signed * wt;
      const g = (ccs[c.cc] ??= { u: 0, back: 0, signed: 0 }); g.u += c.users * wt; g.back += c.back * wt; g.signed += c.signed * wt; continue; }
    const a = (act[`${dev}|${c.k}`] ??= { dev, k: c.k, u: 0, back: 0, signed: 0, raw: 0 }); a.u += c.users * wt; a.back += c.back * wt; a.signed += c.signed * wt; a.raw += c.users; } }
const K = 20, rate = (x, n, b) => (x + K * b) / (n + K);
const golden = {}, anti = {};
for (const dev of Object.keys(base)) {
  const b = base[dev], bBack = b.back / Math.max(1, b.u), bSign = b.signed / Math.max(1, b.u);
  const rows = Object.values(act).filter((a) => a.dev === dev && a.raw >= 15).map((a) => ({ k: a.k, people: Math.round(a.raw), backLift: r2(rate(a.back, a.u, bBack) / Math.max(1e-6, bBack)), signLift: r2(rate(a.signed, a.u, bSign) / Math.max(1e-6, bSign)), conf: r2(a.u / (a.u + K)) }));
  golden[dev] = { baselineBack7: pct(bBack), baselineSignup: pct(bSign), top: rows.filter((r) => r.backLift >= 1.3).sort((x, y) => y.backLift * y.conf - x.backLift * x.conf).slice(0, 12) };
  anti[dev] = rows.filter((r) => r.backLift <= 0.7).sort((x, y) => x.backLift - y.backLift).slice(0, 8);
}
// 3. stalls per device: last click before leaving vs uses
const use = {}, ex = {};
for (const d of days) { const wt = w(d.day);
  for (const f of d.features ?? []) { const k = `${DEV(f.dev)}|${f.k}`; use[k] = (use[k] ?? 0) + f.people * wt; }
  for (const e of d.exits ?? []) { const k = `${DEV(e.dev)}|${e.k}`; ex[k] = (ex[k] ?? 0) + e.exits * wt; } }
const stalls = {};
for (const dev of ["desktop", "mobile", "tablet"]) {
  const keys = Object.keys(ex).filter((k) => k.startsWith(dev + "|") && (use[k] ?? 0) >= 10);
  const shares = keys.map((k) => ex[k] / use[k]).sort((a, b) => a - b), med = shares[Math.floor(shares.length / 2)] ?? 0.1;
  stalls[dev] = keys.map((k) => ({ k: k.split("|")[1], exits: Math.round(ex[k]), people: Math.round(use[k]), exitShare: pct((ex[k] + 10 * med) / (use[k] + 10)), vsNormal: r2(((ex[k] + 10 * med) / (use[k] + 10)) / Math.max(1e-6, med)) }))
    .filter((x) => x.vsNormal >= 1.5).sort((a, b) => b.exits * b.vsNormal - a.exits * a.vsNormal).slice(0, 10);
}
// 4. breaks / rises: each control's daily people vs its own previous 14 days
const series = {};
for (const d of days) for (const f of d.features ?? []) { const s = (series[f.k] ??= {}); s[d.day] = (s[d.day] ?? 0) + f.people; }
const last = days[days.length - 1].day, breaks = [], rises = [];
for (const [k, s] of Object.entries(series)) {
  const prev = Object.entries(s).filter(([d]) => d < last && Date.parse(last) - Date.parse(d) <= 14 * DAY).map(([, v]) => v);
  if (prev.length < 5) continue;
  const mu = prev.reduce((a, b) => a + b, 0) / prev.length, now = s[last] ?? 0, z = (now - mu) / Math.sqrt(Math.max(1, mu));
  // a RENAME is not a break: a label that dropped while a same-letters variant took its users ("1H" → "1h")
  const renamed = Object.keys(series).some((o) => o !== k && o.toLowerCase().replace(/\s+/g, "") === k.toLowerCase().replace(/\s+/g, "") && (series[o][last] ?? 0) >= 0.6 * mu);
  // a BREAK is sudden: normal use the day before, then (almost) none — a control phased out earlier is not a break
  const dPrev = iso(Date.parse(last + "T12:00:00Z") - DAY), before = s[dPrev] ?? 0;
  if (mu >= 30 && now < 0.4 * mu && before >= 0.6 * mu && !renamed) breaks.push({ k, day: last, people: now, normal: Math.round(mu) });
  else if (z >= 3 && now >= 20) rises.push({ k, day: last, people: now, normal: Math.round(mu), z: r2(z) });
}
// 5. countries (≥ 15 new people weighted), shrunk to global
const G = Object.values(ccs).reduce((a, g) => ({ u: a.u + g.u, back: a.back + g.back, signed: a.signed + g.signed }), { u: 0, back: 0, signed: 0 });
const gB = G.back / Math.max(1, G.u), gS = G.signed / Math.max(1, G.u);
const countries = Object.entries(ccs).filter(([cc, g]) => g.u >= 15 && cc !== "?").map(([cc, g]) => ({ cc, people: Math.round(g.u), back7: pct(rate(g.back, g.u, gB)), signup: pct(rate(g.signed, g.u, gS)) })).sort((a, b) => b.people - a.people).slice(0, 20);
// 6. wall funnel per device (last 14 days, raw)
const STEPS = ["wall_view", "pack_click", "pay_method", "card_form_ready", "card_details_entered", "pay_click"];
const funnel = {};
for (const d of days.filter((x) => NOW - Date.parse(x.day) <= 15 * DAY)) for (const x of d.wall ?? []) { const dev = DEV(x.dev); (funnel[dev] ??= {}); funnel[dev][x.type] = (funnel[dev][x.type] ?? 0) + x.n; }
// steps are not strictly sequential in the log (a card form can load without a pay_method event), so each is shown as a
// share of everyone who saw the wall, not of the step before
const wall = Object.fromEntries(Object.entries(funnel).map(([dev, f]) => [dev, STEPS.map((s) => ({ step: s, n: f[s] ?? 0, ofWall: f.wall_view ? pct((f[s] ?? 0) / f.wall_view) : null }))]));

const plan = { at: new Date().toISOString(), daysLearned: days.length, from: days[0].day, to: last, golden, anti, stalls, breaks, rises: rises.sort((a, b) => b.z - a.z).slice(0, 10), countries, wall };
fs.mkdirSync("data/behaviour", { recursive: true });
fs.writeFileSync("data/behaviour/plan.json", JSON.stringify(plan, null, 1));
append("data/behaviour/runs.jsonl", { at: plan.at, days: days.length, golden: Object.fromEntries(Object.entries(golden).map(([k, v]) => [k, v.top.length])), breaks: breaks.length, rises: rises.length });

// 7. a control that broke → email once per control per day
const sent = new Set(readLines("data/behaviour/alerts.jsonl").filter((x) => x.day === last).map((x) => x.k));
const fresh = breaks.filter((b) => !sent.has(b.k));
if (fresh.length && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const text = ["The behaviour machine saw well-used controls suddenly stop being used — usually something broke:", "", ...fresh.map((b) => `• "${b.k}": ${b.people} people on ${b.day}, normally ~${b.normal}/day`), "", "Ask Claude: \"behaviour alert\"."].join("\n");
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB: ${fresh.length} control(s) suddenly unused — check for a break`, text }) });
  console.log("emailed", e.status);
  for (const b of fresh) append("data/behaviour/alerts.jsonl", { at: plan.at, ...b });
}
console.log(`behaviour: ${days.length} days (${plan.from} → ${last}) · golden ${Object.entries(golden).map(([k, v]) => `${k} ${v.top.length}`).join(", ")} · stalls ${Object.entries(stalls).map(([k, v]) => `${k} ${v.length}`).join(", ")} · breaks ${breaks.length} · rises ${rises.length} · countries ${countries.length}`);
