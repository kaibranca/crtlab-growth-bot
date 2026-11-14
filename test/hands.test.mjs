import { test } from "node:test"; import assert from "node:assert/strict";
import { handsOn } from "../scripts/hands.mjs";
import { check } from "../scripts/store.mjs"; import { C } from "../scripts/contracts.mjs";

test("hands FAIL CLOSED: broken, missing, unlisted, or not exactly true = no hands", () => {
  assert.equal(handsOn("cost", { kind: "broken" }), false);
  assert.equal(handsOn("cost", { kind: "missing" }), false);
  assert.equal(handsOn("shield", { kind: "ok", data: { cost: { on: true } } }), false);
  assert.equal(handsOn("cost", { kind: "ok", data: { cost: { on: "yes" } } }), false);
  assert.equal(handsOn("cost", { kind: "ok", data: { cost: { on: true, why: "" } } }), true);
});
test("live hands file passes its contract and cost has NO hands", () => {
  assert.equal(check(C.hands).kind, "ok");
  assert.equal(handsOn("cost"), false);
});
test("cost.mjs: every Railway mutation goes through the gate", async () => {
  const src = (await import("node:fs")).readFileSync("scripts/cost.mjs", "utf8");
  assert.equal((src.match(/fetch\("https:\/\/backboard\.railway\.com/g) || []).length, 1, "one fetch to Railway, inside gql0");
  assert.match(src, /const gql = async \(query\) => \{\s*if \(\/\^\\s\*mutation\/\.test\(query\) && !HANDS && !SAFE\)/);
});
