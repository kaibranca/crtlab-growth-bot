// engine/core/gate.mjs — the gate's IO shell: gathers the context, asks gate-lib.decide(), records every CHANGE of decision.
//   in : data/machines/hands.json + freeze.json (contracts) · data/guard/status.json budget (hourly/guard) ·
//        data/engine/drops.json google (daily/drops: Google ranking updates; stale > 30 h = unknown)
//   out: data/engine/gate.jsonl (shared append-only log: a row only when a machine's decision or reason changes)
// scripts/hands.mjs handsOn() and scripts/lib.mjs frozen() are thin wrappers over this, so every existing hand is gated.
import fs from "node:fs";
import { check } from "../../scripts/store.mjs";
import { C } from "../../scripts/contracts.mjs";
import { decide } from "./gate-lib.mjs";

const LOG = "data/engine/gate.jsonl";
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

export function context(now = Date.now()) {
  const st = J("data/guard/status.json"), dr = J("data/engine/drops.json");
  const budget = st?.budget && typeof st.budget.used === "number" && now - Date.parse(st.at) < 3 * 36e5 ? { used: st.budget.used, of: st.budget.of } : null;
  const google = dr?.at && now - Date.parse(dr.at) < 30 * 36e5 && Array.isArray(dr.google) ? dr.google : null;
  return { hands: check(C.hands), freeze: check(C.freeze), budget, google, now };
}

export function gate(machine, what = "", ctx = context()) {
  const d = decide(machine, ctx);
  if (!process.env.NODE_TEST_CONTEXT) try { // log only when this machine's decision or reason changed; tests never write the production log
    let last = null;
    if (fs.existsSync(LOG)) for (const l of fs.readFileSync(LOG, "utf8").trim().split("\n").reverse()) { try { const r = JSON.parse(l); if (r.machine === machine) { last = r; break; } } catch {} }
    if (!last || last.allow !== d.allow || last.why !== d.why) {
      fs.mkdirSync("data/engine", { recursive: true });
      fs.appendFileSync(LOG, JSON.stringify({ at: new Date(ctx.now).toISOString(), machine, kind: d.kind, allow: d.allow, why: d.why, ...(what ? { what: String(what).slice(0, 120) } : {}) }) + "\n");
    }
  } catch {} // logging must never change the decision
  if (!d.allow) console.log(`GATE HOLD (${machine}): ${d.why}`);
  return d;
}
