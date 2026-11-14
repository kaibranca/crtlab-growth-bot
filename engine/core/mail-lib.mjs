// engine/core/mail-lib.mjs — the MAIL ROUTER's rules. Pure, tested.
// 11-14 (Kai: "I'm getting spammed by the crtlab bot"): 17 scripts called Resend directly, 10 more via reels alert.mjs, one
// workflow with curl; the only budget covered scripts that import lib.mjs, and its counter was written by several workflows
// at once (so even the count was wrong). Rule now: only URGENT mail is sent immediately; everything else goes to the inbox
// (data/engine/inbox/<workflow>.jsonl — read by Claude every session) and ONE daily digest email.
// URGENT = something is broken for users or money or security RIGHT NOW and a human may need to act today.
export const URGENT = /SECURITY ALERT|restore test failed|UNDER ATTACK|load alert|^CRTLAB alert:|expir|data pull|not live|site (is )?down|unreachable|payments? (fail|broken)|billing/i;
export function classify(subject, tags = []) {
  const t = Object.fromEntries((tags || []).map((x) => [x.name, x.value]));
  if (t.level === "urgent" || t.level === "info" || t.level === "digest") return t.level;
  return URGENT.test(subject || "") ? "urgent" : "info";
}
// The bot repo is PUBLIC: never store addresses, IPs or money detail in the inbox log.
const PRIVATE = /buyer|revenue|paid|payment|stripe|payout|invoice|refund/i;
export function redact(subject, text) {
  const clean = (s) => String(s || "").replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "<ip>").replace(/\b[0-9a-f]{1,4}(:[0-9a-f]{0,4}){3,7}\b/gi, "<ip>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>");
  return { subject: clean(subject).slice(0, 160), text: PRIVATE.test(`${subject} ${text}`) ? null : clean(text).slice(0, 700) };
}
export const slug = (s) => String(s || "local").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "local";
// Digest: group the day's info rows by sender + subject shape (numbers stripped), newest first, counts shown.
export function digest(rows) {
  const g = new Map();
  for (const r of rows) { const k = `${r.by}|${String(r.subject).replace(/\d+/g, "#")}`; const o = g.get(k) ?? { by: r.by, subject: r.subject, n: 0, last: r.at, text: r.text };
    o.n++; if (r.at >= o.last) { o.last = r.at; o.subject = r.subject; o.text = r.text; } g.set(k, o); }
  return [...g.values()].sort((a, b) => b.last.localeCompare(a.last));
}
