// RESTORE TEST — a backup you've never restored is only a hope. Weekly: takes the newest dump, restores it into a throwaway
// database on this runner, and checks real rows came back. Never touches production. Logs carry pass/fail only (public repo).
import fs from "node:fs";
import { execSync } from "node:child_process";
import pg from "pg";

const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
const started = Date.now();
const result = { at: new Date().toISOString(), ok: false, step: "start" };
try {
  const env = { AWS_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION: "auto", AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required" };
  Object.assign(process.env, env);
  const ep = `--endpoint-url https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket = process.env.R2_BUCKET;
  result.step = "list";
  const newest = sh(`aws s3 ls s3://${bucket}/backups/ ${ep}`).trim().split("\n").map((l) => l.trim().split(/\s+/).pop()).filter((f) => f.endsWith(".dump")).sort().pop();
  if (!newest) throw new Error("no dump");
  result.step = "download";
  sh(`aws s3 cp s3://${bucket}/backups/${newest} /tmp/d.dump ${ep}`);
  result.step = "start database";
  sh(`docker run -d --name r -e POSTGRES_PASSWORD=x postgres:${process.env.PG_MAJOR}`);
  for (let i = 0; i < 40; i++) { try { sh(`docker exec r pg_isready -U postgres`); break; } catch { await new Promise((r) => setTimeout(r, 2000)); } }
  result.step = "restore";
  sh(`docker cp /tmp/d.dump r:/d.dump`);
  try { sh(`docker exec r pg_restore -U postgres -d postgres --no-owner --no-acl /d.dump`); } catch { /* warnings exit non-zero; the row check below decides */ }
  result.step = "check rows";
  const count = (t) => +sh(`docker exec r psql -U postgres -d postgres -tAc "select count(*) from ${t}"`).trim();
  const live = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false } });
  await live.connect();
  for (const t of ["users", "subscriptions", "user_stores"]) {
    const now = +(await live.query(`select count(*) n from ${t}`)).rows[0].n;
    if (count(t) < now * 0.9) throw new Error(`${t} short`);
  }
  await live.end();
  result.ok = true; result.step = "done";
} catch (e) { result.error = String(e.message || e).replace(/s3:\/\/\S+|https:\/\/\S+/g, "…").slice(0, 120); }
fs.rmSync("/tmp/d.dump", { force: true });
result.minutes = +((Date.now() - started) / 6e4).toFixed(1);
fs.writeFileSync("data/restore.json", JSON.stringify(result, null, 1));
console.log(result.ok ? "RESTORE TEST PASSED" : `RESTORE TEST FAILED at ${result.step}`, result.minutes, "min");
if (!result.ok && process.env.RESEND_API_KEY && process.env.ALERT_TO)
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: "CRTLAB ALERT: backup restore test failed", text: `Your newest backup could not be restored (failed at: ${result.step}). ${result.error ?? ""}` }) });
