import { test } from "node:test"; import assert from "node:assert/strict";
import { pickEnv, scrub, shouldSkip, health, alerting, CONFIG, ioReport } from "../scripts/run-lib.mjs";
import { PLANS } from "../scripts/steps.mjs";
import fs from "node:fs";

test("pickEnv: secrets only when listed, GITHUB_TOKEN never inherited", () => {
  const all = { PATH: "/bin", OPS_KEY: "a", BING_API_KEY: "b", GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "x/y" };
  assert.deepEqual(pickEnv(all, ["OPS_KEY"]), { PATH: "/bin", OPS_KEY: "a", GITHUB_REPOSITORY: "x/y" });
  assert.equal(pickEnv(all, []).BING_API_KEY, undefined);
});

test("scrub: known values and credential shapes never reach the public log", () => {
  const out = scrub("key=hunter2secret ghp_abcdefghijklmnopqrstuvwx Bearer abc.def postgres://u:pw@host/db ?token=zz&x=1 sk-ABCDEFGHIJKLMNOPQRSTUV",
    ["hunter2secret"]);
  for (const leak of ["hunter2secret", "ghp_abc", "abc.def", "u:pw", "zz", "sk-ABC"]) assert.ok(!out.includes(leak), `${leak} leaked: ${out}`);
  assert.ok(out.includes("postgres://***@host") && out.includes("Bearer ***") && out.includes("&x=1"));
});

test("shouldSkip: dependency must have succeeded", () => {
  assert.equal(shouldSkip({ name: "b" }, []), null);
  assert.match(shouldSkip({ name: "b", needs: "a" }, [{ step: "a", status: "fail" }]), /fail/);
  assert.equal(shouldSkip({ name: "b", needs: "a" }, [{ step: "a", status: "ok" }]), null);
});

test("health: streak counts consecutive failures, skips don't reset or count", () => {
  const now = Date.parse("2026-11-14T12:00:00Z"), at = (h) => new Date(now - h * 3.6e6).toISOString();
  const rows = [{ step: "x", status: "ok", at: at(4) }, { step: "x", status: "fail", at: at(3), err: "e1" },
    { step: "x", status: "skipped", at: at(2) }, { step: "x", status: "timeout", at: at(1), err: "e2" }];
  const h = health(rows, now).x;
  assert.equal(h.streak, 2); assert.equal(h.lastError, "e2"); assert.equal(h.rate7, 0.333);
  assert.equal(health([...rows, { step: "x", status: "ok", at: at(0) }], now).x.streak, 0);
});

test("alerting: one blip is not news on hourly, is on daily", () => {
  const h = { a: { streak: 1, lastError: "e" }, b: { streak: 2, lastError: "e" } };
  assert.deepEqual(alerting(h, [{ name: "a" }, { name: "b" }], 2).map((x) => x.step), ["b"]);
  assert.deepEqual(alerting(h, [{ name: "a" }], 1).map((x) => x.step), ["a"]);
  assert.deepEqual(alerting(h, [{ name: "a", alertAfter: 1 }], 2).map((x) => x.step), ["a"]);
});

test("steps: every planned script exists, names unique, needs point backwards", () => {
  for (const [plan, { steps }] of Object.entries(PLANS)) {
    const seen = new Set();
    for (const s of steps) {
      assert.ok(!seen.has(s.name), `${plan}: duplicate ${s.name}`);
      assert.ok(fs.existsSync(s.cmd[1]), `${plan}: missing ${s.cmd[1]}`);
      if (s.needs) assert.ok(seen.has(s.needs), `${plan}: ${s.name} needs ${s.needs} which runs later or never`);
      seen.add(s.name);
    }
  }
});

test("steps: each step gets every secret its script reads (no silent blind runs)", () => {
  const SECRETISH = (k) => !CONFIG.includes(k) && !/^GITHUB_/.test(k);
  const reads = (file, seen = new Set()) => {
    if (seen.has(file) || !fs.existsSync(file)) return [];
    seen.add(file); const src = fs.readFileSync(file, "utf8"), dir = file.replace(/[^/]+$/, "");
    const own = [...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
    const deps = [...src.matchAll(/from "(\.\.?\/[^"]+)"|import\("(\.\.?\/[^"]+)"\)/g)].map((m) => new URL(m[1] || m[2], "file:///" + dir).pathname.slice(1));
    return [...own, ...deps.flatMap((d) => reads(d, seen))];
  };
  for (const [plan, { steps }] of Object.entries(PLANS)) for (const s of steps) {
    const missing = [...new Set(reads(s.cmd[1]))].filter((k) => SECRETISH(k) && !s.env.includes(k));
    assert.deepEqual(missing, [], `${plan} → ${s.name} reads ${missing.join(",")} but is not given it`);
  }
});

test("ioReport: flags two writers of one state file, tolerates shared logs, finds unowned inputs", () => {
  const r = ioReport({ "h/a": { reads: ["data/x.json"], writes: ["data/s.json", "data/log.jsonl"] }, "h/b": { reads: ["data/s.json"], writes: ["data/s.json", "data/log.jsonl"] } });
  assert.deepEqual(r.multiWriter, { "data/s.json": ["h/a", "h/b"] });
  assert.deepEqual(Object.keys(r.sharedLog), ["data/log.jsonl"]);
  assert.deepEqual(r.unowned, { "data/x.json": 1 });
});
