import test from "node:test"; import assert from "node:assert/strict";
import { p95, durationRot, reliabilityRot, doubleRuns, growth } from "../engine/guard/rot-lib.mjs";
const NOW = Date.parse("2026-11-30T12:00:00Z"), ago = (d) => new Date(NOW - d * 864e5).toISOString();
const run = (d, ms, status = "ok", step = "supervisor") => ({ at: ago(d), plan: "hourly", step, status, ms });

test("p95", () => { assert.equal(p95([1, 2, 3, 4, 100]), 100); assert.equal(p95([]), null); });
test("runtime: near the hard limit = warn/fail even without a baseline (the 11-14 supervisor case)", () => {
  const rows = [run(1, 82e3), run(1.2, 104e3), run(0.5, 90e3)];
  assert.equal(durationRot(rows, { "hourly/supervisor": 150 }, NOW)[0].state, "warn");            // 104/150 = 69%
  assert.equal(durationRot([...rows, run(0.2, 140e3)], { "hourly/supervisor": 150 }, NOW)[0].state, "fail"); // 93%
});
test("runtime: creep vs baseline = warn; steady = nothing; small absolute growth ignored", () => {
  const base = Array.from({ length: 20 }, (_, i) => run(5 + i * 0.5, 10e3));
  assert.equal(durationRot([...base, run(1, 30e3), run(1.5, 31e3), run(2, 29e3)], { "hourly/supervisor": 150 }, NOW)[0].state, "warn");
  assert.equal(durationRot([...base, run(1, 10e3), run(1.5, 11e3), run(2, 10e3)], { "hourly/supervisor": 150 }, NOW).length, 0);
  const tiny = Array.from({ length: 20 }, (_, i) => run(5 + i * 0.5, 2e3));
  assert.equal(durationRot([...tiny, run(1, 5e3), run(1.5, 5e3), run(2, 5e3)], {}, NOW).length, 0); // ×2.5 but +3 s
});
test("reliability drift", () => {
  const old = Array.from({ length: 10 }, (_, i) => run(8 + i, 1e3));
  const bad = [run(1, 1e3, "fail"), run(2, 1e3, "fail"), run(3, 1e3), run(4, 1e3), run(5, 1e3)];
  assert.equal(reliabilityRot([...old, ...bad], NOW)[0].state, "fail");
  assert.equal(reliabilityRot([...old, ...Array.from({ length: 5 }, (_, i) => run(i + 1, 1e3))], NOW).length, 0);
});
test("double runs", () => {
  assert.equal(doubleRuns([ago(0.1), ago(0.1 + 1 / 24)], "hourly", NOW), null);
  assert.equal(doubleRuns([ago(0.1), ago(0.105), ago(0.5), ago(0.505), ago(1), ago(1.003)], "hourly", NOW).state, "fail");
});
test("growth projects the slope to the limit", () => {
  const h = (per) => Array.from({ length: 10 }, (_, i) => ({ day: ago(10 - i).slice(0, 10), v: 100 + per * i }));
  assert.equal(growth("x", "repo", h(0), 1000).state, "ok");
  assert.equal(growth("x", "repo", h(20), 1000).state, "warn");   // ~41 days left
  assert.equal(growth("x", "repo", h(50), 1000).state, "fail");   // ~13 days
  assert.equal(growth("x", "repo", h(5).slice(0, 3), 1000).state, "learning");
  assert.equal(growth("x", "repo", [{ day: "2026-11-30", v: 1200 }], 1000).state, "fail");
});
