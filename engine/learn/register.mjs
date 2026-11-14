// engine/learn/register.mjs — REGISTER a visitor-facing change BEFORE it ships (Claude sessions + Kai; machines later).
// Sessions were the biggest change source (4 of 9 traffic changes in 3 days, 11-14) and none was ever judgeable. This asks the
// planner whether the change CAN teach us anything at our volume, records the hypothesis up front, and LEARN judges it later
// against exactly that — confirmed / refuted / inconclusive — never a story told after the fact.
// Usage: node engine/learn/register.mjs --what "homepage: replay demo above the fold" --area / --metric accounts.chatgpt --expect 0.25
//        [--by session|kai] [--dry]     (--expect = hoped relative effect: 0.25 = +25 %, -0.2 = −20 %)
import fs from "node:fs";
import { mdeBeforeAfter, mdeSplit, splitDays, plan } from "./plan-lib.mjs";
import { gate, context } from "../core/gate.mjs";
import { decide } from "../core/gate-lib.mjs";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const what = arg("what"), area = arg("area", "site"), metric = arg("metric", "accounts"), expect = Number(arg("expect")), by = arg("by", "session"), dry = process.argv.includes("--dry");
if (!what || !Number.isFinite(expect) || expect === 0) { console.error('usage: --what "..." --expect 0.2 [--area /backtest] [--metric accounts.chatgpt] [--by session|kai] [--dry]'); process.exit(2); }
const S = JSON.parse(fs.readFileSync("data/engine/series.json", "utf8"));
if (!S.series[metric]) { console.error(`unknown metric "${metric}" — one of: ${Object.keys(S.series).join(", ")}`); process.exit(2); }
const from = S.starts?.[metric] ?? S.from;
const ba14 = mdeBeforeAfter(S.series[metric], from, S.end, 14), ba28 = mdeBeforeAfter(S.series[metric], from, S.end, 28);
// split option, site-wide approximation until per-page visitors are trusted (attribution fixed 11-14): accounts / real visitors
const sum = (m, n) => Object.entries(S.series[m] ?? {}).filter(([d]) => d > new Date(Date.parse(S.end) - n * 864e5).toISOString().slice(0, 10)).reduce((a, [, v]) => a + v, 0);
const v = sum("visitors", 28) / 28, p = v ? sum("accounts", 28) / 28 / v : null;
const split = p && p < 1 ? { p: +p.toFixed(3), v: Math.round(v), days: splitDays(p, v, Math.abs(expect)) } : null;
const g = dry ? decide("session", context()) : gate("session", what); // --dry writes nothing, not even the gate log
const P = plan({ ba14, ba28, split, expect: Math.abs(expect), gate: g });
const exp = { id: `${new Date().toISOString().slice(0, 10)}-${what.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, at: new Date().toISOString(), by, what, area, metric, expect,
  plan: { design: P.design, days: P.days, mde: P.mde, why: P.why }, gate: { allow: g.allow, why: g.why }, verdictDue: P.days ? new Date(Date.now() + (P.days + 1) * 864e5).toISOString().slice(0, 10) : null, status: "planned" };
console.log(`\n${what}\n  hoped: ${expect > 0 ? "+" : ""}${Math.round(expect * 100)} % on ${metric}  →  DESIGN: ${P.design.toUpperCase()}${P.days ? ` (${P.days} d, verdict ${exp.verdictDue})` : ""}`);
for (const w of P.why) console.log("  · " + w);
console.log(`  smallest visible effect on ${metric}: 14 d ±${ba14 ? Math.round(ba14.mde * 100) : "?"} % · 28 d ±${ba28 ? Math.round(ba28.mde * 100) : "?"} %${split ? ` · split ${split.days} d at ${(split.p * 100).toFixed(1)} % conversion, ${split.v} real visitors/day` : ""}`);
if (!g.allow) console.log(`  GATE: ${g.why} — ship only if it's right for users regardless; it will be judged as confounded.`);
if (dry) process.exit(0);
const F = "data/engine/experiments.json", cur = (() => { try { return JSON.parse(fs.readFileSync(F, "utf8")); } catch { return { experiments: [] }; } })();
cur.experiments = [...cur.experiments.filter((e) => e.id !== exp.id), exp];
fs.mkdirSync("data/engine", { recursive: true }); fs.writeFileSync(F, JSON.stringify({ at: new Date().toISOString(), experiments: cur.experiments }, null, 1));
console.log(`  registered ${exp.id} → data/engine/experiments.json (commit + push it with the change)`);
