// CORE RUNTIME — pure logic (tested in test/run-lib.test.mjs). scripts/run.mjs is the thin shell around it.

// Non-secret variables every step may see. Secrets are NEVER inherited: each step lists the ones it uses.
// CONFIG = non-secret knobs scripts read (switches, model names, paths); safe to pass to every step.
export const CONFIG = ["DRY", "FORCE", "NOW", "BOT_DIR", "TRAFFIC_BRAIN", "UPG_API", "IQ_API", "MENTIONS_MODEL", "FUNNEL_BASE", "SPIKE", "NODE_TEST_CONTEXT"];
const BASE = new RegExp(`^(PATH|HOME|LANG|LC_\\w+|TZ|TMPDIR|CI|RUNNER_\\w+|NODE_\\w+|npm_\\w+|${CONFIG.join("|")})$`);
const GITHUB_SAFE = /^GITHUB_(?!TOKEN$)\w+$/;

export function pickEnv(all, keys = []) {
  const out = {};
  for (const [k, v] of Object.entries(all)) if (BASE.test(k) || GITHUB_SAFE.test(k)) out[k] = v;
  for (const k of keys) if (all[k] != null && all[k] !== "") out[k] = all[k];
  return out;
}

// Logs land in a PUBLIC repo: remove every secret value we hold plus anything that looks like a credential.
// [pattern, replacement] — $1 keeps the harmless prefix so the log still says what was there.
export const SECRET_PATTERNS = [
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})\b/g, "***"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "***"],
  [/\bre_[A-Za-z0-9_]{20,}\b/g, "***"],
  [/\bEAA[A-Za-z0-9]{40,}\b/g, "***"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "***"],
  [/\b(Bearer)\s+[^\s"']+/gi, "$1 ***"],
  [/(postgres(?:ql)?:\/\/)[^\s"'@/]+@/gi, "$1***@"],
  [/([?&](?:key|apikey|api_key|token|access_token|secret)=)[^&\s"']+/gi, "$1***"],
];
export function scrub(text, secrets = []) {
  let s = String(text ?? "");
  for (const v of secrets) if (v && v.length >= 6) s = s.split(v).join("***");
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
  return s;
}

// Topological check: a step whose `needs` failed or was skipped is skipped.
export function shouldSkip(step, results) {
  if (!step.needs) return null;
  const dep = results.find((r) => r.step === step.needs);
  if (!dep) return `needs ${step.needs} (not run)`;
  return dep.status === "ok" ? null : `needs ${step.needs} (${dep.status})`;
}

// Health per step from the run history (newest last). streak = consecutive failures ending now.
export function health(rows, now = Date.now()) {
  const by = {};
  for (const r of rows) (by[r.step] ??= []).push(r);
  const out = {};
  for (const [step, rs] of Object.entries(by)) {
    const done = rs.filter((r) => r.status !== "skipped");
    let streak = 0;
    for (let i = done.length - 1; i >= 0 && done[i].status !== "ok"; i--) streak++;
    const week = done.filter((r) => now - Date.parse(r.at) < 7 * 864e5);
    const ok7 = week.filter((r) => r.status === "ok").length;
    const last = rs.at(-1);
    out[step] = { last: last.status, at: last.at, streak, runs7: week.length, ok7, rate7: week.length ? +(ok7 / week.length).toFixed(3) : null,
      lastError: [...done].reverse().find((r) => r.status !== "ok")?.err ?? null, ms: last.ms, missingEnv: last.missingEnv ?? [] };
  }
  return out;
}

// Which steps deserve an alert: a streak at or over the step's threshold (hourly default 2 = one blip is not news).
export function alerting(h, steps, defAfter) {
  return steps.filter((s) => h[s.name] && h[s.name].streak >= (s.alertAfter ?? defAfter))
    .map((s) => ({ step: s.name, streak: h[s.name].streak, err: h[s.name].lastError }));
}

// Data map from measured IO. multiWriter = a file two machines both write (one silently overwrites the other's truth).
// unowned = read by a machine but written by no traced step (owner outside the runner, or dead input = machine reads stale).
// sharedLog = append-only logs (.jsonl) with several writers are normal; JSON state with several writers is not.
export function ioReport(io) {
  const writers = {}, readers = {};
  for (const [step, { reads = [], writes = [] }] of Object.entries(io)) {
    for (const f of writes) (writers[f] ??= []).push(step);
    for (const f of reads) (readers[f] ??= []).push(step);
  }
  const multi = Object.entries(writers).filter(([f, w]) => w.length > 1);
  return {
    files: new Set([...Object.keys(writers), ...Object.keys(readers)]).size,
    multiWriter: Object.fromEntries(multi.filter(([f]) => !f.endsWith(".jsonl"))),
    sharedLog: Object.fromEntries(multi.filter(([f]) => f.endsWith(".jsonl"))),
    unowned: Object.fromEntries(Object.entries(readers).filter(([f]) => !writers[f]).map(([f, r]) => [f, r.length])),
  };
}

// OUTPUT CHECK (11-14): exit 0 is not "job done". traffic exited 0 for a day without writing data/traffic/plan.json (the
// sitemap had split under its 500-page guard) and the core called it "ok". A step that owns a refreshed contract
// (contracts.mjs: owner "<plan>/<step>" + fresh) must have rewritten that file in THIS run, else the step is a failure.
export function ownedOutputs(contracts, planName, stepName) {
  return contracts.filter((c) => c.owner === `${planName}/${stepName}` && typeof c.fresh === "function").map((c) => c.path);
}
export function unwritten(paths, before, after) {
  return paths.filter((p) => after[p] == null || after[p] === before[p]);
}

// SILENT SKIPS (11-14): STRIPE_READ_KEY was never set → buyers + security's Stripe guards silently never ran for weeks.
// Every declared secret a step got EMPTY is recorded; the jobs check fails on required ones. OPTIONAL = has a fallback.
export const OPTIONAL_ENV = new Set(["GH_TOKEN", "ALERT_FROM", "RAILWAY_PROJECT_ID" /* hardcoded fallback */, "RAILWAY_PROJECT_TOKEN" /* falls back to RAILWAY_API_TOKEN */]);
export const missingEnv = (keys, env) => keys.filter((k) => !env[k]);
