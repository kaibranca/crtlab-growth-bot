// PRODUCTION HANDS — the one gate every machine passes before changing a live system. Fails CLOSED.
import { check } from "./store.mjs"; import { C } from "./contracts.mjs";
export function handsOn(machine, r = check(C.hands)) {
  if (r.kind !== "ok") return false;
  return r.data[machine]?.on === true;
}
export class HandsOff extends Error { constructor(machine, what) { super(`HANDS OFF (${machine}): would ${what}`); this.handsOff = true; } }
