// PRODUCTION HANDS — every machine passes ONE gate before changing a live system (engine/core/gate: hands + freeze + change
// budget + Google rollouts, every change of decision logged). Fails CLOSED. `r` (a hands contract result) is for tests.
import { decide } from "../engine/core/gate-lib.mjs";
import { gate } from "../engine/core/gate.mjs";
export function handsOn(machine, r) {
  if (r) return decide(machine, { hands: r, now: Date.now() }).allow;
  return gate(machine).allow;
}
export class HandsOff extends Error { constructor(machine, what) { super(`HANDS OFF (${machine}): would ${what}`); this.handsOff = true; } }
