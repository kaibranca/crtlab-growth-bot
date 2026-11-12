// MAIL GUARD (11-12, Kai: "my Resend hit 80% of its free limit today"). Resend free = 100 mails / day for EVERYTHING —
// the site's login / welcome / payment mail must always get through, so the bot's own alerts get a budget:
//   ≤ 15 bot mails a UTC day (critical subjects — down / STOPPED / failed / behind / attack — may use up to 25),
//   the same subject twice within 6 h = one mail. Everything is counted in data/machines/mail.json (per script, held).
// Works by wrapping fetch for POST api.resend.com/emails, so every script that imports lib.mjs is covered without edits.
import fs from "node:fs";

const F = "data/machines/mail.json", CAP = 15, CRIT_CAP = 25, DEDUPE_H = 6;
const CRIT = /down|stopped|failed|failing|behind|attack|breach|banned|error/i;
const me = (process.argv[1] ?? "").split("/").pop().replace(/\.mjs$/, "") || "bot";
const J = () => { try { return JSON.parse(fs.readFileSync(F, "utf8")); } catch { return {}; } };

if (!globalThis.__mailguard) {
  globalThis.__mailguard = true;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url?.url ?? url);
    if (!/^https:\/\/api\.resend\.com\/emails\/?$/.test(u) || (opts.method ?? "GET").toUpperCase() !== "POST") return real(url, opts);
    const day = new Date().toISOString().slice(0, 10);
    let s = J(); if (s.day !== day) s = { day, n: 0, by: {}, held: 0, heldBy: {}, recent: (s.recent ?? []).filter((r) => Date.now() - Date.parse(r.at) < DEDUPE_H * 3600e3) };
    let subject = ""; try { subject = JSON.parse(opts.body ?? "{}").subject ?? ""; } catch { /* not json */ }
    const crit = CRIT.test(subject), dup = s.recent.some((r) => r.subject === subject && Date.now() - Date.parse(r.at) < DEDUPE_H * 3600e3);
    const over = s.n >= (crit ? CRIT_CAP : CAP);
    if (dup || over) {
      s.held++; s.heldBy[me] = (s.heldBy[me] ?? 0) + 1; s.last = { at: new Date().toISOString(), by: me, subject: subject.slice(0, 120), why: dup ? "same subject < 6 h" : "day budget" };
      try { fs.mkdirSync("data/machines", { recursive: true }); fs.writeFileSync(F, JSON.stringify(s, null, 1)); } catch { /* fine */ }
      console.log(`mailguard: held "${subject.slice(0, 60)}" (${dup ? "duplicate" : `budget ${s.n}/${crit ? CRIT_CAP : CAP}`})`);
      return new Response(JSON.stringify({ id: "held-by-mailguard" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const res = await real(url, opts);
    if (res.ok) { s.n++; s.by[me] = (s.by[me] ?? 0) + 1; s.recent.push({ at: new Date().toISOString(), subject }); s.recent = s.recent.slice(-50);
      try { fs.mkdirSync("data/machines", { recursive: true }); fs.writeFileSync(F, JSON.stringify(s, null, 1)); } catch { /* fine */ } }
    return res;
  };
}
