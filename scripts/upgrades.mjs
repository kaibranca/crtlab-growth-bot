// UPGRADE JUDGE (11-12, Kai: "POWER = us improving the machines that improve the IQ"). Every upgrade we ship to a machine
// (a non-run commit touching its script) is judged BY THAT MACHINE'S OWN OUTCOME: its KPI the day before the first upgrade
// of that day vs 7 days later (outcomes.jsonl daily snapshots of a 7-day window → the two windows don't overlap).
//   change ≥ +10 % (or ≤ −10 % when lower is better) → "paid" · the other way → "hurt" · in between → "flat".
// Verdicts go to data/machines/upgrades.json and the ledger (win / loss / lesson) — so XP, long-term memory ("which
// machines pay") and MACHINES IQ learn from them, and POWER can say how much of what we build actually works.
// Machines without an outcome KPI are not judged (said, not guessed). Several upgrades the same day = one verdict.
import fs from "node:fs";
import { execSync } from "node:child_process";

const NOW = Date.now(), DAY = 864e5, OUT = "data/machines/upgrades.json", BOT = "crtlab-growth-bot";
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64e6 }); } catch { return null; } };
const AUTO = /^(hourly|health|daily|weekly|recap|reels plan|reels post|device qa|restore test|radar|google|analyst|ai eyes|ledger:)\b/i;
// script → the machine (node id on /machine) it upgrades
const MAP = { "ai-eyes": "eyes", "ai-machine": "ai", "ai-machine-family": "ai", "ai-pull": "ai", aicrawl: "ai", "ai-radar": "radar", "ai-truth": "truth", analyst: "analyst",
  bandit: "bandit", behaviour: "behaviour", bing: "bing", "bing-submit": "bing", brains: "brains", core: "core", cost: "cost", executive: "executive", fixer: "fixer",
  google: "google", gsc: "google", headlines: "livenews", "live-news": "livenews", health: "health", humans: "humans", indexnow: "indexnow", indicators: "indicators",
  leak: "leak", linkcheck: "linkcheck", memory: "memory", mentions: "mentions", "mobile-qa": "devices", outcomes: "outcomes", "react-pages": "factory", recap: "recaps",
  recommend: "recommend", "restore-test": "restore", security: "security", shield: "shield", supervisor: "supervisor", "traffic-core": "traffic-brain", traffic: "traffic",
  upcoming: "calendar", watchdog: "watchdog", world: "world", "deploy-watch": "deployjudge" };

const S = J(OUT, { seen: {}, open: [], judged: [] });
S.seen ??= {}; S.open ??= []; S.judged ??= [];

// 1 · new upgrades → open entries (machine × day)
async function newUpgrades() {
  const out = []; // { sha, at, msg, files }
  const log = sh(`TZ=UTC git log --since=2026-11-11 --format='@@%H|%cI|%s' --name-only`);
  if (!process.env.UPG_API && log && log.split("@@").length > 20) {
    for (const blk of log.split("@@").slice(1)) { const [head, ...files] = blk.split("\n"); const [sha, at, ...m] = head.split("|"); out.push({ sha, at, msg: m.join("|"), files: files.filter(Boolean) }); }
    return out.filter((c) => !S.seen[c.sha]);
  }
  const H = { Accept: "application/vnd.github+json", "User-Agent": "crtlab-machines", ...((process.env.GITHUB_TOKEN || process.env.GH_TOKEN) ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}` } : {}) };
  for (let p = 1; p <= 5; p++) {
    const r = await fetch(`https://api.github.com/repos/kaibranca/${BOT}/commits?per_page=100&page=${p}&since=2026-11-11T00:00:00Z`, { headers: H }).catch(() => null);
    if (!r?.ok) break;
    const xs = await r.json(); if (!xs.length) break;
    let fresh = 0;
    for (const c of xs) {
      if (S.seen[c.sha]) continue; fresh++;
      if (AUTO.test(c.commit?.message ?? "")) { S.seen[c.sha] = 1; continue; }
      const d = await fetch(`https://api.github.com/repos/kaibranca/${BOT}/commits/${c.sha}`, { headers: H }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (d) out.push({ sha: c.sha, at: c.commit.committer.date, msg: c.commit.message.split("\n")[0], files: (d.files ?? []).map((f) => f.filename) });
    }
    if (!fresh || xs.length < 100) break;
  }
  return out;
}
const ups = await newUpgrades();
for (const c of ups) {
  S.seen[c.sha] = 1;
  if (AUTO.test(c.msg)) continue;
  const day = new Date(c.at).toISOString().slice(0, 10);
  const ms = [...new Set(c.files.map((f) => /^scripts\/([\w-]+)\.mjs$/.exec(f)?.[1]).filter(Boolean).map((s) => MAP[s]).filter(Boolean))];
  for (const m of ms) {
    const o = S.open.find((x) => x.machine === m && x.day === day);
    if (o) { if (!o.commits.some((y) => y.sha === c.sha.slice(0, 8))) o.commits.push({ sha: c.sha.slice(0, 8), msg: c.msg.slice(0, 120) }); }
    else S.open.push({ machine: m, day, commits: [{ sha: c.sha.slice(0, 8), msg: c.msg.slice(0, 120) }] });
  }
}

// 2 · judge the ones 7 days old with the machine's own KPI
const snaps = new Map(fs.existsSync("data/machines/outcomes.jsonl") ? fs.readFileSync("data/machines/outcomes.jsonl", "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.day, r.kpi]; }) : []);
const cur = J("data/machines/outcomes.json", {})?.kpi ?? {};
const dayAdd = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const near = (d, dir) => { for (let i = 0; i <= 2; i++) { const k = dayAdd(d, dir * i); if (snaps.has(k)) return snaps.get(k); } return null; };
// a machine without its own outcome is judged on its section's (core → the north star, replay hours) — said in the label
const NODES = J("data/machines/ecosystem.json", {})?.nodes ?? [], LEAD = { traffic: "lead-traffic", conversion: "lead-conversion", content: "lead-content", security: "lead-security", health: "lead-health", core: "lead-product" };
const kpiOf = (m) => { if (cur[m]?.label && !cur[m].activity) return [m, cur[m].label]; const g = NODES.find((n) => n.id === m)?.group, l = LEAD[g]; return l && cur[l]?.label && !cur[l].activity ? [l, `${cur[l].label} (via its section)`] : [null, null]; };
const keep = [];
for (const o of S.open) {
  delete o.note;
  const [kid, label] = kpiOf(o.machine);
  if (!kid) { o.note = "no outcome KPI — not judged"; if (NOW - Date.parse(o.day) < 30 * DAY) keep.push(o); continue; }
  if (NOW - Date.parse(o.day + "T23:59:59Z") < 7 * DAY) { keep.push(o); continue; }
  const b = near(dayAdd(o.day, -1), -1)?.[kid], a = near(dayAdd(o.day, 7), 1)?.[kid];
  if (b == null || a == null) { if (NOW - Date.parse(o.day) < 14 * DAY) { o.note = "waiting for KPI snapshots"; keep.push(o); } else S.judged.push({ ...o, label, verdict: "unjudgeable", why: "no KPI snapshot around it" }); continue; }
  // ABNORMAL change (11-12): the site grows fast, so raw before/after would call almost every upgrade "paid". Subtract the
  // median change of every machine's KPI over the same two days (the "market") — only what moved beyond everything is credited.
  const S0 = near(dayAdd(o.day, -1), -1) ?? {}, S1 = near(dayAdd(o.day, 7), 1) ?? {};
  const mkt = Object.keys(S0).filter((x) => x !== kid && S0[x] && S1[x] != null && !cur[x]?.activity).map((x) => (S1[x] - S0[x]) / Math.abs(S0[x])).sort((x, y) => x - y);
  const med = mkt.length >= 5 ? mkt[Math.floor(mkt.length / 2)] : 0;
  const lower = !!cur[kid]?.lowerBetter, raw = b ? (a - b) / Math.abs(b) : a > 0 ? 1 : 0, ch = raw - med, good = lower ? -ch : ch;
  const verdict = good >= 0.1 ? "paid" : good <= -0.1 ? "hurt" : "flat";
  const j = { ...o, label, before: b, after: a, change: +ch.toFixed(3), raw: +raw.toFixed(3), market: +med.toFixed(3), verdict, at: new Date().toISOString() };
  S.judged.push(j);
  fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: j.at, key: `upg|${o.machine}|${o.day}`, machine: o.machine, kind: verdict === "paid" ? "win" : verdict === "hurt" ? "loss" : "lesson",
    what: `upgrade ${o.day} (${o.commits.length} commit${o.commits.length > 1 ? "s" : ""}: ${o.commits[0].msg.slice(0, 60)}) → ${label} ${b} → ${a} (${raw >= 0 ? "+" : ""}${Math.round(raw * 100)}%, ${ch >= 0 ? "+" : ""}${Math.round(ch * 100)}% beyond the market's ${Math.round(med * 100)}%): ${verdict}` }) + "\n");
}
S.open = keep;
S.judged = S.judged.slice(-300);
const J7 = S.judged.filter((x) => x.verdict !== "unjudgeable");
S.summary = { judged: J7.length, paid: J7.filter((x) => x.verdict === "paid").length, hurt: J7.filter((x) => x.verdict === "hurt").length, flat: J7.filter((x) => x.verdict === "flat").length,
  waiting: S.open.filter((x) => !x.note || x.note === "waiting for KPI snapshots").length, unmeasured: S.open.filter((x) => x.note === "no outcome KPI — not judged").length,
  next: S.open.filter((x) => !x.note).map((x) => dayAdd(x.day, 8)).sort()[0] ?? null };
S.at = new Date().toISOString();
// seen: keep it bounded (old shas can't come back — the API reads since 11-11 only)
const sk = Object.keys(S.seen); if (sk.length > 3000) S.seen = Object.fromEntries(sk.slice(-3000).map((k) => [k, 1]));
fs.writeFileSync(OUT, JSON.stringify(S, null, 1));
console.log(`upgrades: ${ups.length} new commits · open ${S.open.length} · judged ${S.summary.judged} (paid ${S.summary.paid} / hurt ${S.summary.hurt} / flat ${S.summary.flat}) · next verdict ${S.summary.next ?? "—"}`);
