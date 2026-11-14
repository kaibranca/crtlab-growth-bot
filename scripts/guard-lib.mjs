// GUARD rules shared by every machine (11-14). Kai: "how can we have automated machines that do stuff but just don't have that
// happen" — machines that made traffic worse by changing pages Google/ChatGPT read, too often, with no one owning stability.
// 1. PROTECT: page families that bring the accounts. No machine experiment, hook, title test or sitemap move ever touches them.
// 2. BUDGET: at most ONE traffic-facing change (any page family, sitemap, indexing, llms.txt) per 7 days, so every change can be
//    read before the next. Over budget → automatic freeze.
// 3. NO TOGGLING: indexing / sitemap membership never flips back and forth (flip-flops read as low quality and reset trust).
export const PROTECT = new Set(["/", "/backtest", "/backtest-<market>", "/<concept>-backtesting"]);
export const BUDGET_DAYS = 7, BUDGET = 1;
