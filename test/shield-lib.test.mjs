import { test } from "node:test"; import assert from "node:assert/strict";
import { banEligible } from "../scripts/shield-lib.mjs";
const x = (o) => ({ n: 10, asn: 64500, uas: new Set(["python-requests/2.31"]), ...o });

test("bans a repeat scripted attacker over the threshold", () => assert.equal(banEligible(x(), { banAt: 6 }).ban, true));
test("never bans below threshold or twice", () => {
  assert.equal(banEligible(x({ n: 5 }), { banAt: 6 }).ban, false);
  assert.equal(banEligible(x(), { banAt: 6, already: true }).ban, false);
});
test("never bans shared networks (WARP, iCloud Relay)", () => assert.equal(banEligible(x({ asn: 13335 }), { banAt: 6 }).ban, false));
test("never bans search or AI crawlers, even mixed with other agents", () => {
  for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "OAI-SearchBot/1.0", "GPTBot/1.1", "PerplexityBot/1.0", "ClaudeBot/1.0"])
    assert.equal(banEligible(x({ asn: 15169, uas: new Set(["curl/8", ua]) }), { banAt: 6 }).ban, false, ua);
});
