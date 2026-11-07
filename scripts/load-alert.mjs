// LOAD ALERT (11-07, Kai: "email me if even 1 user gets issues with a higher user count, so I know when to make it better").
// Hourly: reads the last hour's chart-load counts from the app (/api/ops/load — the data server's queue + the app's own
// failures) and emails Kai if even ONE chart load was turned away, failed, or waited over 4 seconds. Logs every hour to
// data/load/<month>.jsonl (counts only — public repo). No email when everything was fine.
import fs from "node:fs";
import { SITE, append, month } from "./lib.mjs";

const r = await fetch(`${SITE}/api/ops/load`, { headers: { "x-ops-key": process.env.OPS_KEY ?? "" } }).catch(() => null);
const j = r?.ok ? await r.json() : null;
if (!j) { console.log("load: no answer", r?.status ?? "network"); process.exit(0); }
const d = j.data ?? {}, w = j.web ?? {};
const row = { at: new Date().toISOString(), served: d.served ?? null, shed: d.shed ?? null, slow: d.slow ?? null, worstMs: d.worstMs ?? null,
  peakQueue: d.peakQueue ?? null, peakActive: d.peakActive ?? null, rssMB: d.rssMB ?? null, busy: w.busy ?? 0, failed: w.failed ?? 0, dataError: d.error ?? null };
append(`data/load/${month()}.jsonl`, row);
console.log("load", JSON.stringify(row));

const problems = [];
if (row.dataError) problems.push(`The app could not read the data server at all (${row.dataError}).`);
if (row.shed > 0) problems.push(`${row.shed} chart load(s) were turned away by the data server because its queue was full (limit ${d.maxQueue}). The app retries these, but it means a crowd hit at once.`);
if (row.failed > 0) problems.push(`${row.failed} chart load(s) FAILED in the app (data server unreachable).`);
if (row.busy > 0 && !row.shed) problems.push(`${row.busy} chart load(s) came back "busy".`);
if (row.slow > 0) problems.push(`${row.slow} chart load(s) waited over 4 seconds (the slowest ${(row.worstMs / 1000).toFixed(1)}s).`);
if (!problems.length) process.exit(0);

const text = [
  "CRTLAB load alert — in the last hour, people felt the load:", "", ...problems.map((p) => "• " + p), "",
  `Last hour: ${row.served} chart loads served, busiest moment ${row.peakActive} building + ${row.peakQueue} waiting, data server memory ${row.rssMB} MB (of 512).`,
  "", "What it means: one alert is a spike worth knowing about. If it keeps coming, it is time to give the data server more room (ask Claude: \"load alert again\").",
].join("\n");
if (process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB load alert: ${problems.length} issue(s) in the last hour`, text }) });
  console.log("emailed", e.status);
} else console.log("no email keys —", text);
