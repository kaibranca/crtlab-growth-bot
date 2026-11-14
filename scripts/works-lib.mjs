// WORKS — the shared read side (11-13). Every machine that sends, builds or links asks here first:
//   worksMul(path)  → the push multiplier (focus pages up to ×3.5, WIN families up, DEAD ×0.3); 1 when the engine has no plan
//   worksTier(path) → "WIN" | "OK" | "WEAK" | "DEAD" | null
//   canBuild(path)  → false for a DEAD (binned) family: no new pages there until it produces accounts again
// The engine itself is scripts/works.mjs (hourly). Family rule kept identical to it.
import { check } from "./store.mjs"; import { C } from "./contracts.mjs";
const NOTMKT = /^\/(learn|help|faq|features|pricing|blog|news|recap|tools|answers|terms|privacy|risk|company|markets|replay|login|signup|hub|account|analytics|backtester|reference|statistics|partnerships|refund|third-party|unsubscribe|week-ahead)$/;
export const family = (p) => {
  if (p === "/" || p === "") return "/";
  if (p === "/backtest") return "/backtest";
  if (/^\/news\/[^/]+\/[^/]+$/.test(p)) return "/news/<release>/<market>";
  if (/^\/news\//.test(p)) return "/news/<release>";
  if (/^\/economic-calendar/.test(p)) return "/economic-calendar/<x>";
  if (/^\/backtest-/.test(p)) return "/backtest-<market>";
  if (/-challenge-simulator$/.test(p)) return "/<firm>-challenge-simulator";
  if (/^\/(auth|app|analytics|hub|login|signup|account|backtester\/)/.test(p)) return "(in-app)";
  if (/^\/[a-z0-9]{3,6}$/.test(p) && !NOTMKT.test(p)) return "(chart)"; // /xauusd = the chart app itself (canonical "/"), not a page to push — 11-13
  if (/^\/tools\//.test(p)) return "/tools/<x>";
  if (/^\/(recap|statistics|answers|blog|learn|reference|indicators?)\//.test(p)) return `/${p.split("/")[1]}/<x>`;
  if (/^\/[a-z0-9]+-(fair-value-gaps|order-blocks|crt|previous-day-high-low|asian-range|footprint-chart|volume-profile)$/.test(p)) return "/<market>-<concept>";
  if (/(backtest|backtester|backtesting|alternative|replay|simulator)/.test(p)) return "/<concept>-backtesting";
  return "/<page>";
};
// Read through the "works" contract. Stale up to 72 h is still used for steering (works runs hourly; a few missed runs
// shouldn't zero every multiplier); broken / wrong shape / older = NO opinion, and the reason is exposed (worksStatus).
// Fail-safe directions: steering goes NEUTRAL (×1), building goes CLOSED (no new pages while blind = no spam risk).
let PLAN, STATUS;
const plan = () => {
  if (PLAN === undefined) {
    const r = check(C.works);
    const usable = r.kind === "ok" || (r.kind === "stale" && r.ageH < 72);
    PLAN = usable ? r.data : null; STATUS = { kind: r.kind, detail: r.detail || null, used: usable };
  }
  return PLAN;
};
export const worksStatus = () => (plan(), STATUS);
export const worksTier = (p) => plan()?.tiers?.[family(p)] ?? null;
export const worksMul = (p) => { const W = plan(); if (!W) return 1; const m = W.pageMult?.[p] ?? W.famMult?.[family(p)] ?? 1; return Math.max(0.3, Math.min(3.5, m)); };
export const canBuild = (p) => plan() != null && worksTier(p) !== "DEAD";
export const worksPlan = plan;
export const _reset = () => { PLAN = undefined; }; // tests
