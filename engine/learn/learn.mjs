// engine/learn/learn.mjs — LEARN loop (v2). Daily, after WATCH. Read-only everywhere, no hands.
//   in : data/engine/series.json (WATCH: what users did, per day) · data/machines/timeline.json (traffic-facing changes) ·
//        data/engine/learn.json (its own permanent change registry — the timeline prunes, this never forgets)
//   out: data/engine/learn.json (owner: daily/learn) · ledger "lesson" row once per group when its 14-day verdict lands
// Method: learn-lib.mjs (tested). Backtest 11-14 on Jul–Nov: 297 traffic-facing site commits on 75 different days → every
// change overlapped another → NOTHING since July could be judged alone. Learnability is therefore the first number here:
// the share of change groups that are clean (one change alone). It only rises if changes are spaced (guard budget 1 / 7 d).
import fs from "node:fs";
import { clusters, verdict, lessons, gradeAlarms } from "./learn-lib.mjs";

const OUT = "data/engine/learn.json", LEDGER = "data/machines/ledger.jsonl";
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const S = J("data/engine/series.json");
if (!S?.series?.accounts) { console.error("learn: no data/engine/series.json — WATCH did not run"); process.exit(1); } // fail loud
const prev = J(OUT) ?? {};

// 1. permanent registry of traffic-facing changes (site deploys that touched pages/indexing, machine traffic changes,
//    sitemap submits). Reels/data releases are not traffic-facing changes to the site; the freeze is a state, not a change.
const KINDS = new Set(["site-deploy", "machine-change", "sitemap-submit"]);
const reg = new Map((prev.changes ?? []).map((c) => [c.at + "|" + c.what, c]));
for (const e of J("data/machines/timeline.json")?.events ?? [])
  if (e.traffic && KINDS.has(e.kind)) { const at = new Date(e.at).toISOString(), what = String(e.what).slice(0, 140); // one key form: timeline mixes +01:00 and Z
    reg.set(at + "|" + what, { at, kind: e.kind, where: e.where, what }); }
const changes = [...reg.values()].filter((c) => c.at.slice(0, 10) >= S.from).sort((a, b) => a.at.localeCompare(b.at));

// 2. verdicts per group — primary outcome = accounts; per-source + pack clicks as detail (same windows, same rules)
const DETAIL = ["accounts.google", "accounts.chatgpt", "paywall.packs"].filter((m) => S.series[m]);
const groups = clusters(changes).map((g) => {
  const v = verdict(S.series.accounts, S.from, S.end, g);
  v.detail = Object.fromEntries(DETAIL.map((m) => { const d = verdict(S.series[m], S.from, S.end, g), w = d.windows.at(-1); return [m, { state: d.state, ratio: w.ratio ?? null, z: w.z ?? null }]; }));
  return v;
});
const judged = groups.filter((g) => !["pending", "unknown"].includes(g.state));
const learnability = { groups: groups.length, judged: judged.length, clean: judged.filter((g) => g.clean).length,
  share: judged.length ? +(judged.filter((g) => g.clean).length / judged.length).toFixed(2) : null };

// 3. WATCH self-grade, every metric WATCH covers: are its alarms real (the fall lasted) or noise? n ≥ 30 before any tuning.
//    COMPOUNDS: graded episodes are kept forever in `alarms` (metric|day) — the series is a rolling 120 days, the record is not.
const alarms = { ...(prev.alarms ?? {}) };
for (const m of Object.keys(S.series)) for (const e of gradeAlarms(S.series[m], S.from, S.end).episodes) {
  const k = m + "|" + e.day, old = alarms[k];
  if (!old || old.state === "pending" || old.state === "unknown") alarms[k] = { metric: m, day: e.day, level: e.level, state: e.state, ratio: e.ratio ?? null };
}
const grade = {};
for (const a of Object.values(alarms)) { const g = (grade[a.metric] ??= { graded: 0, confirmed: 0, pending: 0 });
  if (a.state === "confirmed" || a.state === "recovered") { g.graded++; if (a.state === "confirmed") g.confirmed++; } else if (a.state === "pending") g.pending++; }
for (const g of Object.values(grade)) { g.precision = g.graded ? +(g.confirmed / g.graded).toFixed(2) : null; g.enough = g.graded >= 30; }

const out = { at: new Date().toISOString(), end: S.end,
  method: "after-change window (7/14 d) vs same-weekday trimmed normal from BEFORE the group's first change; groups = changes ≤ 6 d apart; helped/hurt need z ±1.64 AND ±15%",
  learnability, lessons: lessons(groups), groups: groups.slice(-40), grade, alarms, changes };
// 4. ledger: one lesson per group when its final (14-day) verdict lands — the memory every machine + session reads
const done = new Set((prev.groups ?? []).filter((g) => g.final).map((g) => g.day0 + "|" + g.n));
for (const g of groups) {
  const w14 = g.windows.find((w) => w.w === 14);
  if (!w14 || w14.state === "pending" || w14.state === "unknown") continue;
  g.final = true;
  if (done.has(g.day0 + "|" + g.n)) continue;
  const what = `${g.n} change${g.n > 1 ? "s" : ""} ${g.day0}→${g.last} (${[...new Set(g.changes.map((c) => c.where))].join(", ")}): accounts ${g.state.toUpperCase()} over 14 d` +
    (w14.ratio != null ? ` (×${w14.ratio}, z ${w14.z}, smallest visible ±${Math.round(w14.mde * 100)}%)` : "") + (g.clean ? "" : " — CONFOUNDED: cannot credit any single change");
  fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), key: `learn|${g.day0}|${g.n}`, machine: "learn", kind: g.state === "hurt" ? "loss" : g.state === "helped" ? "win" : "lesson", what }) + "\n");
}
fs.mkdirSync("data/engine", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); // groups carry their final flags (same objects)

console.log(`learn ${S.end}: ${changes.length} changes → ${groups.length} groups; judged ${learnability.judged}, clean ${learnability.clean} (learnability ${learnability.share ?? "n/a"}); ` +
  `accounts alarms graded ${grade.accounts?.graded ?? 0}, precision ${grade.accounts?.precision ?? "n/a"}`);
for (const g of groups.slice(-6)) console.log(`  ${g.day0}→${g.last} n=${g.n} ${g.state}${g.clean ? "" : " (confounded)"}`);
