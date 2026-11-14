// MINUTES GOVERNOR (11-14, Kai: "something inside the core that tracks the limit and ALWAYS stays under").
// Pure: given month-to-date billed minutes on the private repos and the last 7 days' pace, decide how much the rest of the
// month may spend. The cron worker reads the decision (data/guard/minutes.json → mode) before it starts anything on a
// private repo. The daily data pull itself is never shed — it is what the minutes are for; retries and extras are.
export const FREE = 2000, CEILING = 1500; // 500 kept back for incidents / manual reruns — we never plan to touch 2,000
export const RETRY_SLOTS = { normal: null, tight: [7, 11, 15], critical: [11] }; // null = every slot (still pre-checked)

export function govern({ used, perDay7, dayOfMonth, daysInMonth, essentialPerDay = 35 }) {
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1); // today counts as a day still to spend
  const left = CEILING - used, allowPerDay = +(left / daysLeft).toFixed(1);
  const projected = Math.round(used + perDay7 * daysLeft);
  let mode = "normal", why = `pace ${perDay7}/day ≤ allowance ${allowPerDay}/day`;
  if (left < essentialPerDay * daysLeft * 1.1) { mode = "critical"; why = `${left} left for ${daysLeft} d — only the daily pull + 1 retry slot`; }
  else if (perDay7 > allowPerDay || projected > CEILING) { mode = "tight"; why = `pace ${perDay7}/day > allowance ${allowPerDay}/day (projected ${projected} > ${CEILING})`; }
  return { mode, why, allowPerDay, projected, ceiling: CEILING, free: FREE, daysLeft, retrySlots: RETRY_SLOTS[mode] };
}

// worker side: may this retry slot (UTC hour) run? A stale/missing decision (> 6 h old) = normal (fail open: the pull must
// never die because the governor's file is late; the slot still has its own "data already current" pre-check).
export function retryAllowed(decision, hour, now = Date.now()) {
  if (!decision || !decision.at || now - Date.parse(decision.at) > 6 * 3.6e6) return true;
  const slots = decision.retrySlots ?? RETRY_SLOTS[decision.mode] ?? null;
  return slots == null || slots.includes(hour);
}
