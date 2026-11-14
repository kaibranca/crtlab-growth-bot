// engine/core/gate-lib.mjs — THE DECISION GATE (v2). Every machine that changes a live system asks here first. Pure, tested.
// v1 lesson: machines ACTED in ways nobody could measure — hook tests killed by our own deploys, 6 changes on one day, the
// surge machine pushing ×3.33 on 8 clicks. v2 so far had three separate brakes (hands.json, freeze.json, guard budget) that
// each machine had to remember to call, and nothing recorded what was held. One gate, one place, one log.
// Rules, in order (first that applies decides):
//   1. unknown machine → HOLD (every hand must declare what kind of change it makes)
//   2. security / infra / post / signal hands → need hands.json on (fail closed: broken or missing file = hold)
//   3. traffic hands (change what users or search engines SEE) → also: no freeze hold · change budget left ·
//      no Google ranking update rolling out (any result would be unreadable — acting is risk with nothing to learn)
export const KIND = {
  shield: "security", cost: "infra", reels: "post",
  "bing-send": "signal", "bing-submit": "signal", indexnow: "signal", "gsc-sitemap": "signal",
  hooks: "traffic", "home-hook": "traffic", bandit: "traffic", llms: "traffic", "sitemap-tiers": "traffic",
};

// ctx: { hands: {kind, data} (contract check), freeze: {kind, data}, budget: {used, of} | null, google: [{what, begin, end}] | null, now }
export function decide(machine, ctx) {
  const kind = KIND[machine];
  if (!kind) return { allow: false, kind: null, why: `"${machine}" is not registered in the gate (declare its kind first)` };
  if (kind !== "traffic") {
    if (ctx.hands?.kind !== "ok") return { allow: false, kind, why: `hands.json is ${ctx.hands?.kind ?? "unreadable"} — fail closed` };
    const h = ctx.hands.data?.[machine];
    return h?.on === true ? { allow: true, kind, why: "hands on" } : { allow: false, kind, why: `hands off${h?.why ? ": " + h.why.slice(0, 80) : ""}` };
  }
  const f = ctx.freeze;
  if (f && f.kind !== "missing") {
    if (f.kind !== "ok") return { allow: false, kind, why: `freeze.json is ${f.kind} — fail closed` };
    if (ctx.now < Date.parse(f.data.until) && machine in (f.data.holds ?? {})) return { allow: false, kind, why: `frozen until ${f.data.until.slice(0, 10)}: ${f.data.holds[machine]}` };
  }
  if (!ctx.budget) return { allow: false, kind, why: "change budget unknown (guard status unreadable) — fail closed for traffic changes" };
  if (ctx.budget.used >= ctx.budget.of) return { allow: false, kind, why: `change budget used (${ctx.budget.used}/${ctx.budget.of} traffic changes in 7 d) — another change now can't be judged` };
  if (ctx.google == null) return { allow: false, kind, why: "Google update status unknown — fail closed for traffic changes" };
  const live = ctx.google.filter((e) => Date.parse(e.begin) <= ctx.now && (e.end ? Date.parse(e.end) >= ctx.now : ctx.now - Date.parse(e.begin) < 21 * 864e5));
  if (live.length) return { allow: false, kind, why: `Google ${live.map((e) => e.what).join(", ")} is rolling out — a change now can't be read` };
  return { allow: true, kind, why: "clear: no freeze hold, budget left, no Google update rolling" };
}
