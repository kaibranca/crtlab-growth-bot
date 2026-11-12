// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXECUTIVE (11-12 — every engine optimised its own number; nothing decided where the WHOLE system's constraint is).
// Theory of constraints, once a day:
//   SENSE  the funnel from the world model's curve + the leak machine: reach (people asking AI about our pages / day) →
//          click-through (AI clicks per people-fetch) → sign-up (accounts per AI click) → pay (paid per account)
//   DECIDE the constraint = the stage falling furthest behind the stage above it (growth gap, %/day; for the slow money stages
//          the 14-day rate vs its own normal)
//   ACT    bounded knobs every engine reads (data/machines/executive.json → knobs):
//            conversion-bound → bandit explores harder (15 → 25 %), reach branches ease (×0.85), converting pages lead
//            reach-bound      → Bing urgent cap up (+0.15), traffic pushes harder (×1.15), more sister reach
//            sign-up / pay    → the site-side fix goes to the top of the Fixer queue (impact ×1.5)
//   JUDGE  each focus period (≥ 3 days) on whether the constraint's own rate rose → ledger win / loss; the knob STRENGTH
//          learns (0.5…1.5): a focus that keeps paying is pushed harder, one that doesn't is softened.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

const NOW = Date.now(), DAY = 864e5, OUT = "data/machines/executive.json";
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const E = J(OUT, { strength: 1, history: [] });
if (E.at && NOW - Date.parse(E.at) < 20 * 3600e3 && !process.env.FORCE) { console.log(`executive: ${E.constraint} (decided < 20 h ago)`); process.exit(0); }
const W = J("data/world/credit.json", null), leak = J("data/leak/plan.json", {}), hum = J("data/machines/humans.json", {});
const cv = W?.curve;
if (!cv) { console.log("executive: no world-model curve yet"); process.exit(0); }
// stage rates now (for judging) and growth gaps (for deciding)
const rate = { reach: cv.reads.now, click: cv.reads.now ? cv.clicks.now / Math.max(1, cv.reads.now) : null, signup: cv.clicks.now ? cv.accounts.now / Math.max(0.5, cv.clicks.now) : null, pay: leak.overall?.replayToPaid ?? null };
const gaps = { click: cv.reads.perDay - cv.clicks.perDay, signup: cv.clicks.perDay - cv.accounts.perDay };
const reachWeak = cv.reads.perDay < 2; // reach itself barely growing
const payWeak = leak.overall?.paid != null && (leak.overall.paid ?? 0) < 2; // under 2 paid in the leak window
let constraint, why;
if (reachWeak && !(gaps.click > 5)) { constraint = "reach"; why = `people asking AI about us grow only ${cv.reads.perDay}%/day`; }
else if (gaps.click >= gaps.signup && gaps.click > 2) { constraint = "conversion"; why = `reads +${cv.reads.perDay}%/day but AI clicks ${cv.clicks.perDay}%/day — the click-through stage falls ${gaps.click.toFixed(1)}%/day behind reach`; }
else if (gaps.signup > 2) { constraint = "signup"; why = `AI clicks ${cv.clicks.perDay}%/day but accounts ${cv.accounts.perDay}%/day — visitors arrive and don't sign up`; }
else if (payWeak) { constraint = "pay"; why = `${leak.overall?.paid ?? 0} paid in the leak window — the checkout is the constraint`; }
else { constraint = "reach"; why = "the funnel is balanced — more reach compounds everything below it"; }
// JUDGE the last focus period
const last = E.history.at(-1);
if (last && last.constraint !== constraint || (last && NOW - Date.parse(last.since) >= 7 * DAY)) {
  if (last && NOW - Date.parse(last.since) >= 3 * DAY && last.rate0 != null && rate[last.stage] != null) { const paid = rate[last.stage] > last.rate0;
    E.strength = +Math.max(0.5, Math.min(1.5, E.strength * (paid ? 1.1 : 0.9))).toFixed(2); last.verdict = paid ? "paid" : "did not pay"; last.rate1 = rate[last.stage]; last.ended = new Date().toISOString();
    fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: last.ended, key: `exec|${last.constraint}|${last.since}`, machine: "executive", kind: paid ? "win" : "loss", what: `focus on ${last.constraint} for ${((NOW - Date.parse(last.since)) / DAY).toFixed(0)} d: ${last.stage} rate ${last.rate0} → ${rate[last.stage]} — ${last.verdict}; knob strength → ×${E.strength}` }) + "\n"); }
}
const stageOf = { reach: "reach", conversion: "click", signup: "signup", pay: "pay" }[constraint];
if (!last || last.constraint !== constraint || last.ended) E.history.push({ constraint, stage: stageOf, since: new Date().toISOString(), rate0: rate[stageOf] != null ? +(+rate[stageOf]).toFixed(5) : null });
E.history = E.history.slice(-40);
const k = E.strength;
E.knobs = constraint === "conversion" ? { banditExplore: +(0.15 + 0.1 * k).toFixed(3), reachIntensity: +(1 - 0.15 * k).toFixed(3), urgentCapAdd: 0, sisterAdd: 0, fixerSiteBoost: 1 }
  : constraint === "reach" ? { banditExplore: 0.15, reachIntensity: +(1 + 0.15 * k).toFixed(3), urgentCapAdd: +(0.15 * k).toFixed(3), sisterAdd: 1, fixerSiteBoost: 1 }
  : { banditExplore: 0.15, reachIntensity: 1, urgentCapAdd: 0, sisterAdd: 0, fixerSiteBoost: +(1 + 0.5 * k).toFixed(2) };
// RECOMMENDATION STAGE (recommend.mjs): how often ChatGPT names CRTLAB in buyer answers — upstream of every stage above;
// machines push the pages, the earned mentions on its trusted sources are Kai's (reported, never a knob)
const RC = J("data/radar/recommend.json", null);
E.recommendation = RC ? { namedRate: RC.namedRate, citedRate: RC.citedRate, asked: RC.asked, trusted: (RC.trustedTop ?? []).slice(0, 5).map((x) => x.d) } : null;
Object.assign(E, { at: new Date().toISOString(), constraint, why, rates: Object.fromEntries(Object.entries(rate).map(([a, v]) => [a, v == null ? null : +(+v).toFixed(5)])), gaps: Object.fromEntries(Object.entries(gaps).map(([a, v]) => [a, +v.toFixed(1)])) });
fs.writeFileSync(OUT, JSON.stringify(E, null, 1));
console.log(`executive: constraint = ${constraint} (${why}) · knobs ${JSON.stringify(E.knobs)} · strength ×${E.strength}`);
