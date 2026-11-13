// FIXER MACHINE (11-11, Kai: "a machine that goes into each problem and actually solves it"). HOURLY, after the supervisor.
// The supervisor FINDS problems; this one ACTS on the ones that have a safe, proven fix — and only those:
//   1. LIVE DATA BEHIND      → start a daily-data retry (the job itself decides what is missing; gates still block)
//   2. A WORKFLOW RUN FAILED → look at WHY in its log; a transient cause (network, rate limit, 5xx, runner) gets ONE re-run;
//                              a real cause (a script error, the cost cap) is NOT retried — it is reported with the exact line
//   3. ANYTHING ELSE         → written up as a task (what, evidence, suggested fix) for Kai / the next build session
// Never edits code, never pushes, never spends: re-runs only, at most 3 per workflow per day, every action in the ledger.
import fs from "node:fs";

const NOW = Date.now(), H = 3600e3, day = new Date().toISOString().slice(0, 10);
const J = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const append = (f, o) => fs.appendFileSync(f, JSON.stringify(o) + "\n");
const ST = "data/machines/fixer.json", state = J(ST, { tries: {}, done: {} });
if (state.day !== day) { state.day = day; state.tries = {}; }
const status = J("data/machines/status.json", {});
const tok = process.env.GH_WATCH_TOKEN, hdr = { accept: "application/vnd.github+json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) };
const gh = (path, init = {}) => fetch(`https://api.github.com/${path}`, { ...init, headers: { ...hdr, ...(init.headers ?? {}) } });
const actions = [], tasks = [];
const act = (what, ok) => { actions.push({ at: new Date().toISOString(), what, ok }); append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `fixer|${what}|${day}`, machine: "fixer", kind: ok ? "win" : "lesson", what }); };
const canTry = (k, max = 3) => (state.tries[k] ?? 0) < max;
const tried = (k) => { state.tries[k] = (state.tries[k] ?? 0) + 1; };

// latest run of a workflow (any status)
async function lastRun(repo, wf) { const r = await gh(`repos/${repo}/actions/workflows/${wf}/runs?per_page=1`).then((x) => x.json()).catch(() => ({})); return r.workflow_runs?.[0] ?? null; }
async function dispatch(repo, wf, inputs) { const r = await gh(`repos/${repo}/actions/workflows/${wf}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", ...(inputs ? { inputs } : {}) }) }); return r.status === 204; }

// TRANSIENT = worth one re-run; anything else is a real error a re-run would only repeat
const TRANSIENT = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|HTTP (429|5\d\d)|rate limit|timed out|runner .* lost|The operation was canceled|Service Unavailable|Bad Gateway/i;
async function why(repo, runId) {
  const jobs = await gh(`repos/${repo}/actions/runs/${runId}/jobs`).then((x) => x.json()).catch(() => ({}));
  const job = (jobs.jobs ?? []).find((j) => j.conclusion === "failure"); if (!job) return { transient: false, line: "no failed job found" };
  const log = await gh(`repos/${repo}/actions/jobs/${job.id}/logs`).then((x) => (x.ok ? x.text() : "")).catch(() => "");
  const lines = log.split("\n").map((l) => l.replace(/^\S+Z\s/, "")).filter((l) => /error|fail|abort|exception|refus|cap/i.test(l) && !/^##\[group\]/.test(l));
  const line = (lines.at(-1) ?? "").slice(0, 200);
  return { transient: TRANSIENT.test(lines.slice(-6).join("\n")), line };
}

if (!tok) { console.log("fixer: no GH_WATCH_TOKEN — can only write tasks"); }

// 1. live data behind
const behind = (status.fix ?? []).find((f) => /^DAILY DATA BEHIND/.test(f));
if (behind && tok) {
  const k = "daily-data:behind", r = await lastRun("kaibranca/crtlab-backtester", "daily-data.yml");
  const busy = r && r.status !== "completed", recent = r && NOW - Date.parse(r.created_at) < 45 * 60e3;
  if (!busy && !recent && canTry(k)) (state.verify ??= {})["data"] = { at: new Date().toISOString(), id: "daily-data", playbook: "data-retry" };
  if (busy || recent) actions.push({ at: new Date().toISOString(), what: `data behind — a daily-data run is ${busy ? "running" : "fresh"}, waiting for it`, ok: true });
  else if (canTry(k)) { tried(k); const ok = await dispatch("kaibranca/crtlab-backtester", "daily-data.yml", { retry: "1" }); act(`data behind → started a daily-data retry (${state.tries[k]}/3 today)`, ok); }
  else tasks.push({ what: "Daily data still behind after 3 retries today", evidence: behind, fix: "read the newest daily-data log: gh run list -R kaibranca/crtlab-backtester -w daily-data.yml" });
}

// 2. failed workflow runs (supervisor's list, both repos) — newest failure per workflow that has not gone green since
for (const m of status.mistakes ?? []) {
  if (!m.url || !/actions\/runs\/\d+/.test(m.url)) continue;
  const [, repo, runId] = m.url.match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/) ?? [];
  if (!repo || state.done[runId]) continue;
  state.done[runId] = true;
  const w = await why(repo, runId);
  const run = await gh(`repos/${repo}/actions/runs/${runId}`).then((x) => x.json()).catch(() => null);
  const wf = run?.path?.split("/").pop(), k = `${repo}:${wf}`;
  const newer = wf ? await lastRun(repo, wf) : null;
  if (newer && String(newer.id) !== runId && newer.conclusion === "success") continue; // already fixed by a later run
  if (w.transient && wf && canTry(k) && tok) { tried(k); const ok = await dispatch(repo, wf, wf === "daily-data.yml" ? { retry: "1" } : undefined); if (ok) (state.verify ??= {})[`rerun:${k}`] = { at: new Date().toISOString(), id: m.where, playbook: "rerun", repo, wf }; act(`${m.where} failed on a transient error ("${w.line.slice(0, 80)}") → re-ran it`, ok); }
  else tasks.push({ what: `${m.where} failed${m.repeating ? ` ${m.n}× this week` : ""}`, evidence: w.line || m.last, fix: w.transient ? "re-run budget used up today — look at the runner/network" : "a real error: a re-run would repeat it — fix the cause (see the log line)", url: m.url });
}

// 4. A MACHINE THAT RAN BEFORE AND STOPPED → start its workflow once (never-run machines are "waiting", not stopped)
const WF = { hourly: ["ai", "bing", "hooks", "curator", "truth", "surge", "rising", "sisters", "eyes", "humans", "leak", "outcomes", "shield", "cost", "core", "traffic-brain", "brains", "mode", "supervisor", "ledger", "mistakes", "bin", "fixer"],
  "daily.yml": ["indexnow", "behaviour", "mentions", "devices", "wall", "analyst", "calendar", "indicators", "linkcheck"], "radar.yml": ["radar"], "recap.yml": ["recaps", "factory", "news"], "health.yml": ["health", "watchdog", "load", "capacity", "backup", "datapull"], "reels-post.yml": ["social"] };
const wfOf = (id) => { for (const [wf, ids] of Object.entries(WF)) if (ids.includes(id)) return wf === "hourly" ? "hourly.yml" : wf; return null; };
for (const x of (status.status ?? []).filter((x) => x.state === "STOPPED" && x.lastRunH != null)) {
  const wf = wfOf(x.id), k = `restart:${x.id}`; if (!wf || !tok) { tasks.push({ what: `${x.name} stopped (last run ${x.lastRunH} h ago)`, evidence: "supervisor", fix: wf ? "no token to restart it" : "no workflow known for it — needs a look" }); continue; }
  if ((state.w?.restart?.v ?? 0.5) < 0.2 && (state.w?.restart?.n ?? 0) >= 3) { tasks.push({ what: `${x.name} stopped`, evidence: "restarts have not been fixing stops", fix: "read its last log" }); continue; }
  const r = await lastRun("kaibranca/crtlab-growth-bot", wf); if (r && r.status !== "completed") continue; // already running
  if (canTry(k, 2)) { tried(k); const ok = await dispatch("kaibranca/crtlab-growth-bot", wf); act(`${x.name} had stopped (${x.lastRunH} h) → restarted ${wf}`, ok); if (ok) (state.verify ??= {})[k] = { at: new Date().toISOString(), id: x.id, playbook: "restart" }; }
}
// VERIFY: every fix from an earlier run is checked now — did the problem actually go away? → the playbook's neuron learns
state.w ??= {};
for (const [k, v] of Object.entries(state.verify ?? {})) { if (NOW - Date.parse(v.at) < 50 * 60e3) continue;
  if (v.playbook === "rerun") { const lr = await lastRun(v.repo, v.wf); if (lr && lr.status !== "completed") continue; v.fixedRun = lr?.conclusion === "success"; }
  const now = (status.status ?? []).find((x) => x.id === v.id), fixed = v.playbook === "rerun" ? !!v.fixedRun : v.id === "daily-data" ? !(status.fix ?? []).some((f) => /^DAILY DATA BEHIND/.test(f)) : now ? now.state === "ok" : true;
  const w = (state.w[v.playbook] ??= { v: 0.5, n: 0 }); w.v = +Math.max(0.05, Math.min(0.95, w.v + 0.25 * ((fixed ? 1 : 0) - w.v))).toFixed(3); w.n++;
  append("data/machines/ledger.jsonl", { at: new Date().toISOString(), key: `fixer-verify|${k}|${v.at}`, machine: "fixer", kind: fixed ? "win" : "loss", what: `${v.playbook} on ${v.id}: ${fixed ? "fixed" : "did NOT fix it"} (playbook ${w.v})` });
  actions.push({ at: new Date().toISOString(), what: `checked: ${v.playbook} on ${v.id} ${fixed ? "worked" : "did not work"}`, ok: fixed }); delete state.verify[k]; }

// 2b. IDLE machines (core activity fingerprint): running but their output has not changed — a lever to add or a machine to retire
// LOST PEAKS (11-13): a source × landing that once worked and has been ≤ 35 % of its best week for 14+ days — biggest first
for (const r of (J("data/machines/peaks.json", {}).lost ?? []).slice(0, 3)) tasks.push({ what: `Lost peak: ${r.src} → ${r.page} ${r.now} clicks/wk vs ${r.peak} at its best (week to ${r.peakWeekEnd}) — −${r.lostAccountsPerWeek} accounts/wk`, evidence: "data/machines/peaks.json", fix: "find what changed on that page/source around the peak's end (git log, wording, blocks, ranking) and restore what worked", impact: Math.min(5, 1 + Math.round(r.lostAccountsPerWeek / 10)) });
for (const x of (J("data/machines/activity.json", {}).idle ?? []).slice(0, 5)) tasks.push({ what: `${x.name} idle: its output has not changed for ${x.quietDays} days`, evidence: x.files.join(", "), fix: "a build session: give it a lever that changes something, or retire it" });
// 3. the rest of the supervisor's fix list becomes tasks (word of mouth etc. are not machine-fixable)
for (const f of status.fix ?? []) if (!/^DAILY DATA BEHIND|failed \d+× this week/.test(f)) tasks.push({ what: f, evidence: "supervisor", fix: "needs a build or a decision" });

state.at = new Date().toISOString(); state.actions = [...actions, ...(state.actions ?? [])].slice(0, 30); state.tasks = tasks.slice(0, 12);
for (const id of Object.keys(state.done)) if (Object.keys(state.done).length > 200) delete state.done[id];
fs.mkdirSync("data/machines", { recursive: true }); fs.writeFileSync(ST, JSON.stringify(state, null, 1));
console.log(`fixer: ${actions.length} action(s), ${tasks.length} task(s)${actions.length ? "\n  - " + actions.map((a) => a.what).join("\n  - ") : ""}${tasks.length ? "\n  tasks:\n  - " + tasks.map((t) => `${t.what} — ${t.evidence}`).join("\n  - ") : ""}`);
