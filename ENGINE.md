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
