import test from "node:test"; import assert from "node:assert/strict";
import { classify, redact, digest, slug } from "../engine/core/mail-lib.mjs";
test("urgent only for broken-now subjects; tags win", () => {
  for (const s of ["CRTLAB SECURITY ALERT", "CRTLAB alert: data-stale, site-down", "CRTLAB UNDER ATTACK — shield on", "CRTLAB ALERT: backup restore test failed", "CRTLAB load alert: 2 issue(s)"]) assert.equal(classify(s), "urgent", s);
  for (const s of ["CRTLAB watch: visitors watch", "CRTLAB rot: supervisor warn", "CRTLAB AI radar: 3 change(s)", "CRTLAB cost: web above normal", "CRTLAB supervisor: 1 machine problem(s) — IndexNow", "CRTLAB shield: 1 possible person banned — check", "CRTLAB mentions: 2 new"]) assert.equal(classify(s), "info", s);
  assert.equal(classify("CRTLAB watch: x", [{ name: "level", value: "urgent" }]), "urgent");
  assert.equal(classify("CRTLAB SECURITY ALERT", [{ name: "level", value: "info" }]), "info");
});
test("redact: no IPs, emails or money detail in the public inbox", () => {
  const r = redact("CRTLAB shield: banned 91.239.154.58", "from 2403:6200:8814:1::9 by a@b.com");
  assert.ok(!/91\.239|2403:|a@b/.test(r.subject + r.text));
  assert.equal(redact("CRTLAB watch: buyers.new watch", "12 days since the last buyer").text, null);
});
test("digest groups repeats by sender + subject shape", () => {
  const d = digest([{ by: "rot", subject: "CRTLAB rot: 1 warn", at: "2026-11-14T10:00Z" }, { by: "rot", subject: "CRTLAB rot: 2 warn", at: "2026-11-14T11:00Z" }, { by: "drops", subject: "CRTLAB watch: x", at: "2026-11-14T09:00Z" }]);
  assert.equal(d.length, 2); assert.equal(d[0].n, 2); assert.equal(d[0].subject, "CRTLAB rot: 2 warn");
  assert.equal(slug("Reels: post"), "reels-post"); assert.equal(slug(""), "local");
});
