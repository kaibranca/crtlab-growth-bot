# CRTLAB MACHINE ENGINE — spec (11-14, replaces the 88-script era)

The old machines were vibe-coded: thresholds called "surge mode", self-scores called IQ, 88 scripts each reading raw files
others wrote, errors swallowed. They steered wrong because they read wrong data and had no real statistics. This is the
rebuild, built the way the CRTLAB chart engine was: one core, layers, tests, measured. Every rule here applies without Kai
having to ask.

## 1. The objective (the only thing the engine optimises)

    growth = traffic × conversion × retention        (new accounts → paid → still active)
    subject to: security · cost · stability · backend health · Google/ChatGPT trust   (hard constraints, never traded)

Scaling multiplies everything, the bad included, so the constraints live in the core, not in add-ons:
- more traffic → more attacks, more load, more cost, more pages Google judges → security, cost, stability are constraints
- more automation → more chances to break a live app → every action has a kill switch, a rate cap, a dry run, a record
- more time → accumulated debt (stale files, dead pages, silent failures) → cycles that clean up, not just add

## 2. Layers

| Layer | What | Status |
|---|---|---|
| 1 Core runtime | `scripts/run.mjs` — isolated steps, own secrets, timeouts, records, alerts, red runs, kill switch (`off`) | LIVE 11-14 (37/37 ok) |
| 2 Data contracts | measured IO map (`data/guard/io.json`) → one owner per file, shape + freshness checked, readers refuse stale/broken input | building |
| 3 Five loops | Data · Search+AI (traffic) · Social · Conversion · Guard (security/cost/stability) — tested functions, not blobs | next |
| 4 Decision core | the only place actions are chosen; scores each against the objective, checks constraints, runs experiments | next |
| 5 Dashboard | /machine = accounts vs normal, experiments, verdicts, failures, constraint status. Nothing decorative | last |

## 3. The algorithm (the edge)

- **Measure, don't threshold.** Rates are estimated with uncertainty (beta-binomial for conversion rates, Poisson for
  counts). "Up 40%" on 5 accounts is noise and the engine says so.
- **One change at a time per area, with a control.** Holdout or before/after with a matched control family. Sample size is
  computed up front; at ~14 accounts/day only large effects are readable, so the engine only tests large bets.
- **Confounds checked automatically.** Before any verdict: `changesNear(area, from, to)` from the timeline. A result with
  another change in the window is "unreadable", not a win.
- **Sequential, pre-registered verdicts.** Hypothesis, metric, minimum effect, verdict date are written BEFORE the change.
  No moving goalposts.
- **Losses count as much as wins.** Every verdict goes in the ledger; the engine learns priors per action type
  (what kinds of change have ever worked here) and ranks future bets by expected value × probability.
- **Explore small, exploit proven.** Most effort goes to what has proven account yield (works tiers); a fixed small slice
  explores. No auto-scaling of anything unproven.

## 4. System cycles (the app is live; automation must survive time)

| Cycle | Does |
|---|---|
| hourly | sense: pull numbers, guard checks, shield, failures recorded — no strategy changes |
| daily | data pull SLO, decide: at most the actions the decision core approved, constraints re-checked |
| weekly | judge: experiment verdicts, ledger, debt sweep (stale files, dead pages, flaky steps), one email to Kai |
| monthly | prune: machines/steps that moved nothing in 30 d are removed; token + cost + dependency review |

## 5. Engineering law

1. Tests for every pure function; CI on every push (`test.yml`); secret scan; nothing merges red.
2. Plain readable code: small functions, no 600-char lines, no names that overstate what code does.
3. One writer per state file; readers go through contracts; broken/stale input stops the decision, never silently feeds it.
4. Every action that touches production: kill switch, rate cap, dry run, record, test that it can't hit protected
   pages, real users or legit bots.
5. No new machine without: the decision it makes, the number it moves, how it is judged, what it replaces.
6. Delete > add. Merge duplicates. Engine work never changes a page Google/ChatGPT reads during a freeze.

## 6. Build rules for the rebuild (Kai 11-14)

- **New, not refined.** Loops are written fresh in `engine/` under this spec only. Old scripts are evidence of what worked
  (data pull, reels posting, works ranking, shield basics) — read for lessons, never copied, never their rules.
  The day a loop replaces an old script, the old script and its step are deleted. Nothing old and new run the same job.
- **Emergency stops on old code are allowed** (11-14: hands gate, fail-closed freeze, theatre inputs neutralised, crawler-safe
  bans) — they keep the live app safe until the replacement exists. They are not the rebuild.
- **Backend cost as low as possible, never by risking the live app.** Cost is a hard target of the Guard loop: Railway
  memory/egress per service measured, waste found (cache bloat, deploy count, idle services, heavy queries), fixes proposed
  with expected saving + load headroom, applied only inside deploy windows with a rollback. No self-applied memory caps
  without headroom proof (11-14: a 1.1 GB hard cap was one run away from live web).

## 7. Work list (live order)
1. Measured data map (`io.json`) → one writer per state file, owners for unowned inputs
2. Hands gate on every remaining production hand: Bing / IndexNow sends, sitemap submit, reels post, emails, cron worker
3. `engine/` loops, fresh: Guard (incl. cost) → Data → Search+AI → Conversion → Social; delete each replaced script
   (started 11-14: WATCH, LEARN, GUARD jobs+rot — next: rebuild the AI analyst on v2 files with "no causal claim without a
   LEARN verdict"; map external readers before deleting steps)
4. Decision core with real statistics (§3)
5. /machine rebuilt as a plain dashboard on the new data (site, deploy window, admin page)
6. Delete theatre code (already OFF 11-14)

## 7b. v2 so far + lessons (11-14) — read before building; each version must learn from the last
**Built (engine/):** WATCH `watch/drops` (weekday-adjusted levels + WHERE by landing page + buyers gap test from Stripe +
paywall + ChatGPT reads; writes `series.json` = the ONE shared user-analytics series) · LEARN `learn/learn` (verdict per
change group vs a pre-change baseline, confounds incl. Google updates, learnability, self-grade of WATCH alarms; permanent
records) · GUARD `guard/jobs` (job done + inputs true) · GUARD `guard/rot` (slow decay: runtime creep/headroom, reliability
drift, double runs, growth to limits, minutes) · `lib/external` (Google Search Status ranking updates) · runner OUTPUT CHECK.
**Also (11-14 PM):** ONE decision gate `core/gate` (hands + freeze + change budget + Google rollouts; handsOn/frozen wrap it) ·
mail router (`scripts/mailguard.mjs`: urgent now, else inbox `data/engine/inbox/<workflow>.jsonl` + ONE daily email
`core/digest` headed by the deterministic `core/brief`) · 10 theatre machines + the LLM analyst DELETED · union merge for
shared append-only logs (`.gitattributes`).
**Lessons (v1 + v2 mistakes — don't repeat):**
1. Exit 0 ≠ job done: a step that doesn't rewrite its owned output is a failure (traffic exited 0 for a day after a sitemap split).
2. A check that can't fail is theatre; a latent bug in a rarely-hit branch hides until the day it matters (guard `n` crash).
3. Truth of inputs before decisions: attribution was ~67% blind for 40 days (render-order bug); the radar's prior leaked
   brand answers into every cluster (fake 8× "win"). Reconcile every input with an independent source.
4. Learnability first: ~300 traffic-facing commits on 75 of ~136 days → no change since July was ever judgeable alone.
   Space traffic changes (≥ 7 d apart) or nothing can be learned. Outside updates (Google core/spam) confound too.
5. Baselines from BEFORE the change only; a short dip must not confirm its own alarm; the rate before a gap, not during it.
6. Measured maps have blind spots (IO tracer can't see raw-URL readers): never kill from an incomplete map.
7. Never trust a number that looks like a win until it is decomposed (by source, by page, by question type).
8. Bottleneck rule: if a machine emails Kai to "check", give it the evidence to decide itself (shield reads real-user networks).
9. Missing secrets fail SILENTLY in `if (process.env.X)` code: the runner records them; jobs fails (STRIPE_READ_KEY never existed).
10. Shared files + `-X theirs` lose rows: one writer per file, or union merge for append-only logs.
11. Don't build what has cons: measure first (recycle: engine state was 0.4 MB — the bulk is site content, a product call).

## 8. External tools (Kai 11-14: "CRTLAB runs on proven plugins — do the same")
Rule: a tool earns its place by closing a real gap, staying free, pinned in a lockfile, named here with its reason.
| Gap | Tool | Status |
|---|---|---|
| decision statistics (intervals, beta-binomial, tests) | simple-statistics / jstat | with the decision core |
| data contracts at scale | zod (engine/ only; scripts/store.mjs T stays for old code) | with engine/ |
| engine did not run at all | healthchecks.io free dead-man switch, pinged by run.mjs | next |
| dependency + code security | Dependabot, CodeQL (free on public repos), actions pinned by SHA | next |
| tests | node:test (built in) | live |
Rejected: workflow orchestrators (Temporal/Airflow — cost, GH Actions + CF cron suffice), paid APM, agent frameworks.
