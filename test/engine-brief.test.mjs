import test from "node:test"; import assert from "node:assert/strict";
import { brief } from "../engine/core/brief-lib.mjs";
test("brief: every section from data, unknown when missing, only problems listed", () => {
  const empty = brief({});
  assert.match(empty[0], /unknown/); assert.ok(empty.some((l) => /LEARN: unknown/.test(l)));
  const b = brief({
    drops: { google: [{ what: "core update", end: null }], metrics: { accounts: { level: "normal", windows: [{ w: 7, observed: 138, expected: 140, ratio: 0.99 }] },
      "accounts.chatgpt": { level: "watch", windows: [{ w: 7, observed: 22, expected: 45, ratio: 0.49, level: "watch" }] }, "accounts.google": { level: "normal", windows: [] } },
      why: { "accounts.chatgpt": { losers: [{ page: "/", expected: 51.5, recent: 8 }], gainers: [{ page: "/footprint", expected: 0, recent: 7 }] } } },
    learn: { learnability: { groups: 1, judged: 0, clean: 0 }, groups: [] },
    jobs: { checks: [{ job: "data live", state: "ok" }, { job: "buyers measured", state: "fail" }] },
    rot: { checks: [{ what: "supervisor runtime", state: "warn" }, { what: "repo", state: "ok" }] },
    gateRows: [{ machine: "hooks", allow: true, why: "clear" }, { machine: "hooks", allow: false, why: "frozen until 2026-11-21: x" }, { machine: "shield", allow: true, why: "hands on" }],
  });
  const t = b.join("\n");
  assert.match(t, /138 in 7 d vs 140/); assert.match(t, /accounts.chatgpt: WATCH/); assert.match(t, /↓ \/ 51.5→8/); assert.match(t, /rolling out/);
  assert.match(t, /JOBS: buyers measured fail/); assert.ok(!/data live/.test(t)); assert.match(t, /ROT: supervisor runtime warn/); assert.ok(!/accounts.google/.test(t));
  assert.match(t, /HELD by the gate: hooks — frozen until 2026-11-21/); assert.ok(!/shield/.test(t));
});
