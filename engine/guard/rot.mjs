// engine/guard/rot.mjs — GUARD loop (v2): ROT. Hourly, read-only, no hands. Catches slow decay the pass/fail checks can't:
// runtime creeping toward its limit, reliability drifting down, double runs, files/repo growing toward hard limits, GitHub
// minutes pace. Method + thresholds: rot-lib.mjs (tested).
//   in : data/guard/runs.jsonl (core runtime) · scripts/steps.mjs (timeouts) · data/guard/minutes.json · GitHub API repo size ·
//        tracked file sizes (git ls-files)
//   out: data/engine/rot.json (owner: hourly/rot; keeps 60 days of size history) · ledger + ONE email per check state change
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import * as R from "./rot-lib.mjs";
import { PLANS } from "../../scripts/steps.mjs";

const OUT = "data/engine/rot.json", LEDGER = "data/machines/ledger.jsonl", NOW = Date.now(), today = new Date(NOW).toISOString().slice(0, 10);
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const rows = (() => { try { return fs.readFileSync("data/guard/runs.jsonl", "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } })();
const prev = J(OUT) ?? {};

// 1. runtime + reliability + one clock
const timeouts = {}; for (const [p, v] of Object.entries(PLANS)) for (const s of v.steps) timeouts[`${p}/${s.name}`] = s.timeout;
const checks = [...R.durationRot(rows, timeouts, NOW), ...R.reliabilityRot(rows, NOW)];
for (const plan of Object.keys(PLANS)) { // a run = consecutive rows of one plan; a new run starts after a > 10 min gap
  const rs = rows.filter((r) => r.plan === plan && !r.partial).sort((a, b) => a.at.localeCompare(b.at)), starts = []; // manual --only runs aren't double dispatch
  for (let i = 0; i < rs.length; i++) if (!i || Date.parse(rs[i].at) - Date.parse(rs[i - 1].at) > 10 * 6e4) starts.push(rs[i].at);
  const d = R.doubleRuns(starts, plan, NOW, { slotMin: plan === "daily" ? 600 : 50 }); if (d) checks.push(d);
}

// 2. growth toward hard limits — one point per day (today's overwritten), 60 days kept
const hist = (prev.hist ?? []).filter((h) => h.day !== today && NOW - Date.parse(h.day) <= 60 * 864e5);
const point = { day: today };
try { // GitHub's own repo size (KB); public repo — a token only for the rate limit
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY || "kaibranca/crtlab-growth-bot"}`,
    { headers: { accept: "application/vnd.github+json", ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }, signal: AbortSignal.timeout(10000) });
  if (r.ok) point.repoMB = +((await r.json()).size / 1024).toFixed(1);
} catch {}
try {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\0").filter(Boolean);
  let data = 0, max = 0, maxF = "";
  for (const f of files) { let s = 0; try { s = fs.statSync(f).size; } catch { continue; } if (f.startsWith("data/")) data += s; if (s > max) { max = s; maxF = f; } }
  point.dataMB = +(data / 1048576).toFixed(1); point.maxFileMB = +(max / 1048576).toFixed(2); point.maxFile = maxF;
} catch {}
hist.push(point);
const series = (k) => hist.filter((h) => typeof h[k] === "number").map((h) => ({ day: h.day, v: h[k] }));
// limits: GitHub recommends repos < 1 GB and warns on files > 50 MB (blocks at 100 MB)
checks.push(R.growth("grow|repo", "repo size (GitHub)", series("repoMB"), 1000, { unit: " MB" }));
checks.push(R.growth("grow|data", "tracked data/ size", series("dataMB"), 500, { unit: " MB" }));
checks.push(R.growth("grow|file", `largest file (${point.maxFile ?? "?"})`, series("maxFileMB"), 50, { unit: " MB" }));

// 3. GitHub minutes pace (private repos, 2,000 free) — the governor's own verdict, as a state
const m = J("data/guard/minutes.json");
if (m?.mode) checks.push({ id: "minutes", what: "GitHub minutes pace", state: m.mode === "critical" ? "fail" : m.mode === "tight" ? "warn" : "ok", detail: m.why ?? `${m.used} used, projected ${m.projected}` });

// state changes only (alert once per change, recovery recorded as a lesson)
const was = Object.fromEntries((prev.checks ?? []).map((c) => [c.id, c.state]));
const turned = checks.filter((c) => (was[c.id] ?? "ok") !== c.state && c.state !== "learning" && !(c.state === "ok" && !(c.id in was)));
for (const id of Object.keys(was)) if (!checks.some((c) => c.id === id) && was[id] !== "ok" && was[id] !== "learning") turned.push({ id, what: id, state: "ok", detail: "cleared" });
fs.mkdirSync("data/engine", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ at: new Date(NOW).toISOString(), checks, hist }, null, 1));
for (const c of turned) fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date(NOW).toISOString(), key: `rot|${c.id}|${c.state}|${today}`, machine: "rot", kind: c.state === "ok" ? "lesson" : "loss", what: `${c.what}: ${c.state.toUpperCase()} — ${c.detail}` }) + "\n");
console.log(`rot: ${checks.filter((c) => c.state === "fail").length} fail · ${checks.filter((c) => c.state === "warn").length} warn · ${checks.length} checks`);
for (const c of checks) if (c.state !== "ok") console.log(`  ${c.state.padEnd(8)} ${c.what} — ${c.detail}`);
// minutes: the governor (scripts/minutes) already emails its own mode changes — state only here, never a second email
const bad = turned.filter((c) => (c.state === "fail" || c.state === "warn") && c.id !== "minutes");
if (bad.length && process.env.RESEND_API_KEY) {
  const { mail } = await import("../../reels/engine/alert.mjs");
  await mail(`CRTLAB rot: ${bad.map((c) => `${c.what} ${c.state}`).join(", ")}`, bad.map((c) => `${c.state.toUpperCase()} — ${c.what}: ${c.detail}`).join("\n") + "\n\nSlow decay caught before it breaks. One email per change. Detail: data/engine/rot.json");
}
