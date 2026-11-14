import { test } from "node:test"; import assert from "node:assert/strict";
import { family, worksMul, worksStatus } from "../scripts/works-lib.mjs";

test("family: page → family rules (the unit every decision is made on)", () => {
  const cases = { "/": "/", "/backtest": "/backtest", "/backtest-xauusd": "/backtest-<market>", "/news/cpi": "/news/<release>",
    "/news/cpi/xauusd": "/news/<release>/<market>", "/economic-calendar/today": "/economic-calendar/<x>", "/ftmo-challenge-simulator": "/<firm>-challenge-simulator",
    "/xauusd": "(chart)", "/pricing": "/<page>", "/nas100-order-blocks": "/<market>-<concept>", "/forex-backtesting": "/<concept>-backtesting", "/app/x": "(in-app)" };
  for (const [p, f] of Object.entries(cases)) assert.equal(family(p), f, p);
});

test("works plan: read through its contract, multipliers stay inside the safe band", () => {
  const st = worksStatus();
  assert.ok(["ok", "stale", "missing", "broken", "shape"].includes(st.kind));
  for (const p of ["/", "/backtest", "/news/cpi", "/nope"]) { const m = worksMul(p); assert.ok(m >= 0.3 && m <= 3.5, `${p} ${m}`); }
});
