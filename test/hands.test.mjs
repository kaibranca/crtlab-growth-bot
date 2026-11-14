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

test("COVERAGE: every file that writes to a production system passes the hands gate", async () => {
  const fs = await import("node:fs");
  const PROD = [/SubmitUrlBatch|SubmitFeed/, /api\.indexnow\.org/, /sitemaps\/\$\{[^`]*`, \{ method: "PUT"/, /rupload\.facebook\.com|media_publish/,
    /mutation \{ (deploymentRestart|deploymentRedeploy|variableUpsert|variableDelete|serviceInstanceLimitsUpdate)/, /rules\/lists\/[^`]*items[^;]*method: "POST"/];
  const files = [...fs.readdirSync("scripts").map((f) => `scripts/${f}`), ...fs.readdirSync("reels/engine").map((f) => `reels/engine/${f}`)].filter((f) => f.endsWith(".mjs"));
  const KNOWN_OFF = new Set(["scripts/bing.mjs", "scripts/gsc.mjs"]); // not in any plan; checked below
  const ungated = files.filter((f) => { const s = fs.readFileSync(f, "utf8"); return PROD.some((re) => re.test(s)) && !/handsOn\(/.test(s); });
  const { PLANS } = await import("../scripts/steps.mjs"), planned = new Set(Object.values(PLANS).flatMap((p) => p.steps.filter((x) => !x.off).map((x) => x.cmd[1])));
  for (const f of ungated) assert.ok(!planned.has(f), `${f} writes to production without handsOn() and is scheduled`);
  assert.deepEqual(ungated.filter((f) => !KNOWN_OFF.has(f)), [], `ungated production writers: ${ungated.join(", ")}`);
});
