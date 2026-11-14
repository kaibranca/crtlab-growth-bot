import test from "node:test"; import assert from "node:assert/strict";
import { addDays } from "../engine/lib/stats.mjs";
import { effect, verdict, clusters, lessons, gradeAlarms, expectedBefore } from "../engine/learn/learn-lib.mjs";
import { asSeries } from "../engine/lib/stats.mjs";

// synthetic history like ours: weekdays 20, weekends 40, deterministic noise; from 2026-07-01, 140 days
const FROM = "2026-07-01", noise = (i) => [0, 3, -2, 4, -3, 1, -4, 2][i % 8];
const build = (f) => { const m = {}; for (let i = 0; i < 140; i++) { const d = addDays(FROM, i), w = new Date(d + "T12:00:00Z").getUTCDay(); m[d] = Math.max(0, Math.round(((w === 0 || w === 6) ? 40 : 20) * f(d) + noise(i))); } return m; };
const LAST = addDays(FROM, 139), CH = "2026-10-01";
const after = (k) => (d) => (d > CH ? k : 1);
const one = (where = "/backtest") => [{ at: CH + "T15:00:00Z", where, what: "x" }];

test("baseline never uses days after the anchor", () => {
  const s = asSeries(build(after(0.1)), FROM, LAST);
  const e = expectedBefore(s, addDays(CH, 10), CH);
  assert.ok(e > 15, "a post-change crash must not lower the pre-change normal");
});
test("verdicts: a real 40% fall = hurt, a 50% rise = helped, nothing = no clear effect", () => {
  const g = clusters(one())[0];
  assert.equal(verdict(build(after(0.6)), FROM, LAST, g).state, "hurt");
  assert.equal(verdict(build(after(1.5)), FROM, LAST, g).state, "helped");
  const flat = verdict(build(() => 1), FROM, LAST, g);
  assert.equal(flat.state, "no clear effect"); assert.ok(flat.windows[1].mde > 0 && flat.windows[1].mde < 1);
});
test("too recent = pending with a due date; tiny volume = thin", () => {
  const g = clusters([{ at: addDays(LAST, -3) + "T10:00:00Z", where: "/", what: "y" }])[0];
  const v = verdict(build(() => 1), FROM, LAST, g); assert.equal(v.state, "pending"); assert.ok(v.windows[0].due > LAST);
  const tiny = {}; for (const [d, n] of Object.entries(build(() => 1))) tiny[d] = n > 25 ? 1 : 0;
  assert.equal(verdict(tiny, FROM, LAST, clusters(one())[0]).state, "thin");
});
test("changes days apart are ONE group, judged from the last, baseline from before the first; lessons skip confounded", () => {
  const cs = [{ at: "2026-10-01T10:00Z", where: "/", what: "a" }, { at: "2026-10-04T10:00Z", where: "/backtest", what: "b" }, { at: "2026-10-20T10:00Z", where: "/", what: "c" }];
  const gs = clusters(cs); assert.equal(gs.length, 2); assert.equal(gs[0].changes.length, 2); assert.equal(gs[0].last, "2026-10-04");
  const m = build((d) => (d > "2026-10-01" ? 0.6 : 1));             // the fall starts after the FIRST change
  const v = verdict(m, FROM, LAST, gs[0]); assert.equal(v.state, "hurt"); assert.equal(v.clean, false);
  const L = lessons([v, verdict(m, FROM, LAST, gs[1])]);
  assert.equal(L.confounded.groups, 1); assert.equal(L.confounded.hurt, 1); assert.equal(L.areas["/backtest"], undefined);
});
test("self-grade: a lasting fall confirms the alarm; a 3-day dip is graded 'recovered'", () => {
  const lasting = gradeAlarms(build((d) => (d >= "2026-10-01" ? 0.5 : 1)), FROM, LAST);
  assert.ok(lasting.confirmed >= 1); assert.equal(lasting.enough, false);
  const dip = gradeAlarms(build((d) => (d >= "2026-10-01" && d <= "2026-10-03" ? 0.2 : 1)), FROM, LAST);
  assert.ok(dip.episodes.every((e) => e.state !== "confirmed"));
});
