// engine/core/digest.mjs — the ONE daily email (11-14, Kai: "I'm getting spammed by the crtlab bot"). Daily, last real step.
//   in : data/engine/inbox/*.jsonl (every bot mail, one file per workflow — scripts/mailguard.mjs)
//        data/engine/{drops,learn,jobs,rot}.json + gate.jsonl → the ENGINE BRIEF on top (brief-lib: deterministic, replaces the
//        v1 LLM analyst)
//   out: ONE email a day (level digest): the brief + every non-urgent note since the last one · data/engine/digest.json
// Urgent mail was already sent the moment it happened; the digest only counts it.
import fs from "node:fs";
import "../../scripts/mailguard.mjs";
import { digest } from "./mail-lib.mjs";
import { brief } from "./brief-lib.mjs";

const OUT = "data/engine/digest.json", DIR = "data/engine/inbox";
const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { return {}; } })();
const since = prev.last ?? new Date(Date.now() - 864e5).toISOString(), now = new Date().toISOString();
const rows = [];
if (fs.existsSync(DIR)) for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".jsonl")))
  for (const l of fs.readFileSync(`${DIR}/${f}`, "utf8").split("\n")) { try { const r = JSON.parse(l); if (r.at > since && r.at <= now) rows.push(r); } catch {} }
const info = rows.filter((r) => r.level === "info"), urgent = rows.filter((r) => r.level === "urgent");
const groups = digest(info);
console.log(`digest: ${info.length} notes in ${groups.length} groups since ${since}; ${urgent.length} urgent (already sent)`);
const JJ = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const gateRows = (() => { try { return fs.readFileSync("data/engine/gate.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } })();
const B = brief({ drops: JJ("data/engine/drops.json"), learn: JJ("data/engine/learn.json"), jobs: JJ("data/engine/jobs.json"), rot: JJ("data/engine/rot.json"), gateRows });
console.log(B.join("\n"));
if (process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const lines = groups.map((g) => `• [${g.by}] ${g.subject}${g.n > 1 ? `  (×${g.n})` : ""}${g.text ? "\n    " + g.text.split("\n").filter(Boolean).slice(0, 3).join("\n    ").slice(0, 300) : ""}`);
  const text = [...B, "", `NOTES — ${info.length} note(s) from ${new Set(info.map((r) => r.by)).size} machine(s) since ${since.slice(0, 16).replace("T", " ")} UTC.`,
    urgent.length ? `${urgent.length} urgent mail(s) were sent immediately: ${[...new Set(urgent.map((r) => r.subject))].slice(0, 5).join(" · ")}` : "Nothing urgent.",
    "", ...lines, "", "Full log: data/engine/inbox/ (Claude reads it every session)."].join("\n");
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB daily — accounts ${(JJ("data/engine/drops.json")?.metrics?.accounts?.level ?? "unknown").toUpperCase()} · ${groups.length} note(s)${urgent.length ? ` · ${urgent.length} urgent sent` : ""}`, text, tags: [{ name: "level", value: "digest" }] }) });
  console.log("digest email", r.status);
}
fs.mkdirSync("data/engine", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ at: now, last: now, notes: info.length, groups: groups.length, urgent: urgent.length }, null, 1));
