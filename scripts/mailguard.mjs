// MAIL ROUTER (11-14; was MAIL GUARD 11-12). Every bot email to Kai passes here — it wraps fetch for POST api.resend.com/emails,
// so any script that imports lib.mjs, reels/engine/alert.mjs or this file is covered without edits.
//   URGENT (engine/core/mail-lib URGENT, or tag level=urgent): sent now — same subject twice within 6 h = one mail,
//     ≤ 25 a UTC day (Resend free = 100/day for EVERYTHING; the site's login / payment mail must always get through).
//   INFO (everything else): NOT emailed — written to the inbox and sent once a day in the digest (engine/core/digest.mjs).
//   DIGEST (tag level=digest): the one daily email, always sent.
// Every mail (sent or held) is logged to data/engine/inbox/<workflow>.jsonl — ONE file per workflow, because push.sh
// resolves conflicts with -X theirs and two workflows appending to one shared file silently lose rows. Claude reads the
// inbox every session. Public repo: subjects/text are redacted (no IPs, emails, money detail).
import fs from "node:fs";
import { classify, redact, slug } from "../engine/core/mail-lib.mjs";

const F = "data/machines/mail.json", CAP = 25, DEDUPE_H = 6;
const me = (process.argv[1] ?? "").split("/").pop().replace(/\.mjs$/, "") || "bot";
const WF = slug(process.env.GITHUB_WORKFLOW || "local"), INBOX = `data/engine/inbox/${WF}.jsonl`;
const J = () => { try { return JSON.parse(fs.readFileSync(F, "utf8")); } catch { return {}; } };
const inbox = (row) => { try {
  fs.mkdirSync("data/engine/inbox", { recursive: true }); fs.appendFileSync(INBOX, JSON.stringify(row) + "\n");
  const ls = fs.readFileSync(INBOX, "utf8").trim().split("\n"); if (ls.length > 3000) fs.writeFileSync(INBOX, ls.slice(-2000).join("\n") + "\n"); // bounded
} catch { /* logging never blocks mail */ } };

if (!globalThis.__mailguard) {
  globalThis.__mailguard = true;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url?.url ?? url);
    if (!/^https:\/\/api\.resend\.com\/emails\/?$/.test(u) || (opts.method ?? "GET").toUpperCase() !== "POST") return real(url, opts);
    let body = {}; try { body = JSON.parse(opts.body ?? "{}"); } catch { /* not json */ }
    const subject = body.subject ?? "", level = classify(subject, body.tags), at = new Date().toISOString(), red = redact(subject, body.text);
    const fake = () => new Response(JSON.stringify({ id: "held-by-mail-router" }), { status: 200, headers: { "content-type": "application/json" } });
    if (level === "info") { inbox({ at, wf: WF, by: me, level, sent: false, ...red }); console.log(`mail → inbox (digest): "${subject.slice(0, 70)}"`); return fake(); }
    const day = at.slice(0, 10);
    let s = J(); if (s.day !== day) s = { day, n: 0, by: {}, held: 0, heldBy: {}, recent: (s.recent ?? []).filter((r) => Date.now() - Date.parse(r.at) < DEDUPE_H * 3600e3) };
    const dup = level === "urgent" && (s.recent ?? []).some((r) => r.subject === subject && Date.now() - Date.parse(r.at) < DEDUPE_H * 3600e3);
    if (dup || s.n >= CAP) {
      s.held++; s.heldBy[me] = (s.heldBy[me] ?? 0) + 1;
      try { fs.mkdirSync("data/machines", { recursive: true }); fs.writeFileSync(F, JSON.stringify(s, null, 1)); } catch { /* fine */ }
      inbox({ at, wf: WF, by: me, level, sent: false, held: dup ? "same subject < 6 h" : "day cap", ...red });
      console.log(`mail router: held "${subject.slice(0, 60)}" (${dup ? "duplicate" : "day cap"})`); return fake();
    }
    const res = await real(url, opts);
    inbox({ at, wf: WF, by: me, level, sent: res.ok, ...red });
    if (res.ok) { s.n++; s.by[me] = (s.by[me] ?? 0) + 1; s.recent = [...(s.recent ?? []), { at, subject }].slice(-50);
      try { fs.mkdirSync("data/machines", { recursive: true }); fs.writeFileSync(F, JSON.stringify(s, null, 1)); } catch { /* fine */ } }
    return res;
  };
}
