// CORE RUNTIME — node scripts/run.mjs <plan> [--dry] [--only a,b]
// Replaces chains of `node x; node y || true` + continue-on-error, where a machine could fail for weeks behind a green run.
// Each step: own process, own timeout, ONLY its own secrets, output scrubbed before it is stored (public repo).
// Records → data/guard/runs.jsonl (30 d) + data/guard/steps.json (health per step: streak, 7-day success rate, last error).
// A step failing `alertAfter` times in a row → one email (deduped 20 h) + the workflow run turns red (output failed=N).
// Always exits 0 itself so the Save step still commits the records.
import fs from "node:fs"; import { spawnSync } from "node:child_process";
import { PLANS } from "./steps.mjs"; import { pickEnv, scrub, shouldSkip, health, alerting } from "./run-lib.mjs";

const [planName, ...rest] = process.argv.slice(2);
const plan = PLANS[planName];
if (!plan) { console.error(`unknown plan "${planName}" — one of: ${Object.keys(PLANS).join(", ")}`); process.exit(2); }
const dry = rest.includes("--dry");
const only = rest.includes("--only") ? new Set(rest[rest.indexOf("--only") + 1].split(",")) : null;
const steps = plan.steps.filter((x) => !only || only.has(x.name));
const allSecrets = [...new Set(plan.steps.flatMap((x) => x.env))].map((k) => process.env[k]).filter(Boolean);

const results = [];
for (const step of steps) {
  const at = new Date().toISOString();
  const skip = step.off ? "off (kill switch)" : shouldSkip(step, results);
  if (skip) { results.push({ at, plan: planName, step: step.name, status: "skipped", ms: 0, err: skip }); console.log(`⏭  ${step.name}: ${skip}`); continue; }
  if (dry) { console.log(`· ${step.name}  ${step.cmd.join(" ")}  env=[${step.env.join(",")}]  ${step.timeout}s`); results.push({ at, step: step.name, status: "ok" }); continue; }
  console.log(`::group::${step.name}`);
  const t0 = Date.now();
  const r = spawnSync(step.cmd[0], step.cmd.slice(1), { env: pickEnv(process.env, step.env), encoding: "utf8", timeout: step.timeout * 1000, maxBuffer: 32 << 20 });
  const ms = Date.now() - t0;
  process.stdout.write(scrub(r.stdout, allSecrets)); process.stderr.write(scrub(r.stderr, allSecrets));
  console.log("::endgroup::");
  const status = r.error?.code === "ETIMEDOUT" ? "timeout" : r.status === 0 ? "ok" : "fail";
  const err = status === "ok" ? null : scrub((r.stderr || r.error?.message || `exit ${r.status}`).trim().split("\n").slice(-4).join(" | "), allSecrets).slice(0, 400);
  results.push({ at, plan: planName, step: step.name, status, ms, code: r.status, err });
  console.log(`${status === "ok" ? "✓" : "✗"} ${step.name} ${status} ${(ms / 1000).toFixed(1)}s${err ? "  " + err : ""}`);
}
if (dry) process.exit(0);

// ── records ──
const D = "data/guard", LOG = `${D}/runs.jsonl`; fs.mkdirSync(D, { recursive: true });
const cutoff = Date.now() - 30 * 864e5;
const past = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && Date.parse(x.at) > cutoff) : [];
const rows = [...past, ...results];
fs.writeFileSync(LOG, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
const h = health(rows.filter((x) => x.plan === planName));
const SF = `${D}/steps.json`; let all = {}; try { all = JSON.parse(fs.readFileSync(SF, "utf8")); } catch {}
all[planName] = { at: new Date().toISOString(), steps: h };
fs.writeFileSync(SF, JSON.stringify(all, null, 1));

// ── alerts + visible red ──
const bad = alerting(h, steps, plan.alertAfter);
const failedNow = results.filter((x) => x.status === "fail" || x.status === "timeout");
console.log(`run ${planName}: ${results.filter((x) => x.status === "ok").length} ok · ${failedNow.length} failed · ${results.filter((x) => x.status === "skipped").length} skipped · ${bad.length} alerting`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["| step | status | s | streak | 7d ok |", "|---|---|---|---|---|",
  ...results.map((x) => `| ${x.step} | ${x.status} | ${((x.ms || 0) / 1000).toFixed(1)} | ${h[x.step]?.streak ?? 0} | ${h[x.step]?.rate7 ?? "-"} |`)].join("\n") + "\n");
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `failed=${bad.length}\n`);
if (bad.length) {
  try {
    const { send } = await import("../reels/engine/alert.mjs");
    await send(bad.map((b) => [`step-${planName}-${b.step}`, `${planName} → ${b.step} failed ${b.streak}× in a row. Last error: ${b.err || "?"}`]), "CRTLAB machine failing");
  } catch (e) { console.log("alert send failed:", String(e).slice(0, 160)); }
}
