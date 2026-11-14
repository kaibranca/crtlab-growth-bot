// CORE RUNTIME — what runs, in order, with ONLY the secrets each step uses (mapped from each script's process.env reads, 11-14).
// Fields: name, cmd (node script + args), env (secret names), needs (skip if that step did not succeed), timeout (s),
// alertAfter (consecutive failures before an email; plan default otherwise), off (kill switch: true = never runs).
const MAIL = ["RESEND_API_KEY", "ALERT_TO", "ALERT_FROM"];
const DB = ["ANALYTICS_DB_URL"];
const CF = ["CF_API_TOKEN", "CF_ZONE_ID", "CF_ACCOUNT_ID"];
const s = (name, env = [], o = {}) => ({ name, cmd: o.cmd ?? ["node", `scripts/${name}.mjs`], env, timeout: 150, ...o });

export const PLANS = {
  hourly: { alertAfter: 2, steps: [
    s("aicrawl", ["OPS_KEY"]),
    s("deploy-watch", ["GH_TOKEN", "GH_WATCH_TOKEN", "RAILWAY_API_TOKEN", "RAILWAY_PROJECT_ID"]),
    s("works", DB, { timeout: 240 }),
    s("ai-pull", ["OPS_KEY"]),
    s("ai-eyes", ["BING_API_KEY", "CF_API_TOKEN", "CF_ZONE_ID"], { needs: "ai-pull" }),
    s("recommend", [], { needs: "ai-eyes" }),
    s("ai-machine", ["BING_API_KEY"], { timeout: 240 }),
    s("bandit", DB),
    s("ai-truth", MAIL),
    s("timeline", ["GH_WATCH_TOKEN"]),
    s("guard", MAIL, { alertAfter: 1 }),
    // v2 GUARD: did each machine do its JOB + are machines reading the TRUTH (engine/guard/jobs-lib.mjs, tested)
    s("jobs", [...DB, ...MAIL], { cmd: ["node", "engine/guard/jobs.mjs"], alertAfter: 1 }),
    // v2 GUARD ROT: slow decay (runtime creep/headroom, reliability drift, double runs, growth to limits, minutes pace)
    s("rot", ["GH_TOKEN", ...MAIL], { cmd: ["node", "engine/guard/rot.mjs"] }),
    s("minutes", ["GH_WATCH_TOKEN", ...MAIL]),
    s("load-alert", ["OPS_KEY", ...MAIL]),
    s("shield", [...CF, "CF_BAN_LIST", "OPS_KEY", ...MAIL, ...DB], { alertAfter: 1 }),
    s("watchdog", [], { alertAfter: 1 }),
    s("upcoming"), s("indicators"), s("live-news"), s("headlines"), s("indexnow"),
    s("cost", ["OPS_KEY", "RAILWAY_API_TOKEN", "RAILWAY_PROJECT_TOKEN", ...MAIL]),
    s("humans", DB), s("outcomes", DB),
    s("supervisor", ["GH_TOKEN", "GH_WATCH_TOKEN", ...MAIL]),
    // 11-14: the 10 META / THEATRE steps (fixer, executive, upgrades, tuner, iq, self, core, traffic-core, brains, memory) were
    // DELETED with their code — self-scores and modes drove no measured result (ENGINE.md §7b). The v2 engine replaces them.
    s("peaks"), s("world"),
    s("summary", [], { alertAfter: 1 }),
  ] },
  daily: { alertAfter: 1, steps: [
    s("deps-audit", [], { cmd: ["node", "scripts/deps-audit.mjs", "site/package-lock.json"] }),
    s("upcoming"), s("failures", MAIL), s("cal-history"), s("indexnow"),
    s("behaviour", ["OPS_KEY", ...MAIL]),
    s("leak", ["OPS_KEY"]),
    s("mentions", [...DB, "BING_API_KEY", "OPENAI_API_KEY", ...MAIL]),
    s("google", ["GSC_SA_JSON"], { timeout: 240 }),
    s("expiry", ["GH_WATCH_TOKEN", "CF_API_TOKEN", "CF_ACCOUNT_ID", "META_PAGE_TOKEN", "META_APP_ID", "META_APP_SECRET", ...MAIL], { timeout: 120 }),
    s("gsc-sitemap", ["GSC_SA_JSON"], { timeout: 120 }),
    s("traffic", [...DB, "BING_API_KEY"]),
    // v2 ENGINE (engine/, ENGINE.md §6 build-new): WATCH — weekday-adjusted drop/rise detector, backtested Aug–Nov
    s("drops", [...DB, ...MAIL, "STRIPE_READ_KEY"], { cmd: ["node", "engine/watch/drops.mjs"] }),
    // v2 LEARN: verdict per change group (accounts after vs the normal BEFORE it), confounds, learnability, WATCH self-grade
    s("learn", [], { cmd: ["node", "engine/learn/learn.mjs"], needs: "drops" }),
    // v2 MAIL: the ONE daily email — every non-urgent bot mail since yesterday, grouped (urgent ones went out immediately)
    s("digest", MAIL, { cmd: ["node", "engine/core/digest.mjs"] }),
    s("summary"),
  ] },
};
