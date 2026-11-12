// NEEDS — one classifier for every engine's "needs you" (11-12, Kai: "there's still so many needs you, they keep piling
// up, I said fix it"). A line is NEEDS YOU only when it needs Kai's own accounts or his call (who = kai) and he hasn't
// already done it (data/machines/kai-done.json). Everything else — build work for a Claude session, observations, FYIs —
// goes to `notes`: kept, read by the fixer queue, never shown or counted as "needs you".
import fs from "node:fs";
// MOST SPECIFIC FIRST (11-12 fix: "no token" took the token-rotation steps and "candles are back" took chart speed)
export const NEED_KNOWN = [[/retention email/i, "retention-email", "approve the wording of a daily-era \"your candles are back\" email (people who replayed, gone 2+ days) — then it's a build + switchback test"],
    [/can't be read|Dependabot alerts: read/i, "deps-token", "GitHub → Settings → Developer settings → the bot's fine-grained token → add crtlab-standalone with \"Dependabot alerts: Read\" (2 min)"],
    [/Smart Retries|failed-payment/i, "stripe", "Stripe dashboard → Settings → Billing → turn on Smart Retries + failed-payment emails (5 min)"],
    [/Headless flood/i, "flood", "Cloudflare → Security → WAF → custom rule: Managed Challenge, country = the flood's, not verified bots (5 min) — the shield brain judges it next hour"],
    [/Rotate|2FA/i, "tokens", "Cloudflare + Railway: roll the tokens pasted in chat, update GH secrets CF_API_TOKEN; turn on 2FA (10 min)"],
    [/Dependabot|^Dependencies:/i, "deps", "say \"fix dependabot\" — upgrades need a build + test session"],
    [/pack|card|checkout/i, "checkout", "decide the checkout fix (wallets/PayPal first, fewer fields) — a build session"],
    [/Chart pages|slowest 10%/i, "speed", "say \"chart speed\" — edge-cache immutable candle windows (a build session)"],
    [/Deploy regression/i, "regression", "check the deploy named (the evidence is in the line); roll back with the command given only if the site really broke"],
    [/INSTRUMENT|heartbeat/i, "sensor", "say \"fix the heartbeat\" — a build session on /api/stats + the newest deploy (every engine reads a wrong people number until then)"],
    [/Railway pace|deploys/i, "budget", "fewer direct deploys (use the windows); heap tuner after 24 h of samples"],
    [/came back|week 2|first session/i, "retention", "decide a first-session change (golden actions from the behaviour machine)"],
    [/names CRTLAB in/i, "recommend", "earned mentions on the sources ChatGPT trusts for buyer questions (listed in the line) — your call within the no-Reddit/paid/creator rule; the recommendation engine judges the naming rate"],
    [/Google shows only/i, "google", "earn links to /news + /economic-calendar (a mention from a site Google trusts beats 1,000 pages) — the google machine reports coverage daily"],
    [/no page|Bing shows/i, "gap", "build the page the search wants (content brain's top gap) — a build session, no approval needed"],
    [/ idle: its output/i, "idle", "a build session gives it a lever that changes something, or retires it"],
    [/word of mouth|outside sources/i, "mouth", "nothing to do today — the mentions machine flags the first outside links"],
    [/getting worse|hurting/i, "kpi", "a build session reads the machine's evidence and changes what it does"]];
// WHO (11-12, Kai: "the need-you list is wrong half the time and a lot of it is useless"): only things that need Kai's own
// accounts or his call are "kai"; build work is for a Claude session; the rest is FYI and never counted as "needs you".
export const NEED_WHO = { "deps-token": "kai", tokens: "kai", stripe: "kai", recommend: "kai", regression: "kai", mouth: "fyi", google: "fyi", budget: "fyi" };

const DONE = () => { try { return JSON.parse(fs.readFileSync("data/machines/kai-done.json", "utf8")).done ?? {}; } catch { return {}; } };
export function classifyNeed(text) {
  const t = String(text).replace(/^(Admin|Escalated|Traffic):\s*/, "").replace(/^(YOU|BUILD) \d+\.?( \(Claude session\)\.?)?\s*/, "");
  const k = NEED_KNOWN.find(([re]) => re.test(t)), kind = k?.[1] ?? "other";
  return { kind, who: NEED_WHO[kind] ?? (/^YOU \d/.test(String(text).replace(/^Admin:\s*/, "")) ? "kai" : "build"), done: !!DONE()[kind], steps: k?.[2] ?? null };
}
// split any watch list: [needs-you lines (Kai, not done), notes (everything else)]; optional / not-an-alarm lines are notes
export function splitNeeds(lines) {
  const watch = [], notes = [];
  for (const l of lines ?? []) { const c = classifyNeed(l); (c.who === "kai" && !c.done && !/Optional|not an alarm/i.test(l) ? watch : notes).push(l); }
  return { watch, notes: [...new Set(notes)] };
}
