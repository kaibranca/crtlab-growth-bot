# MACHINE AUDIT (started 11-14) — from 78 "machines" to ~5 serious loops

Kai 11-14: "the idea is right, we super overbuilt, made the frontend look cool and beneath it it's not good enough — build it like
a professional, proper engineering, smart, to scale." Honest state: 88 scripts (~9k dense lines), 0 tests, errors swallowed
(`|| true` ×8 in workflows), a values file broken for 4 h unnoticed, self-scoring theatre (IQ, levels, super-core, sparks).
They DO work — the learning/decision layer is shallow: ~14 accounts/day split across dozens of learners = noise.

## Rules for the rebuild
1. Every loop has ONE metric tied to new accounts, a baseline, and owns its output files (one writer per file).
2. Every decision = experiment: control/holdout, sample size up front (at ~14 accounts/day only big swings are readable),
   verdict date, ledger entry, confound check (`scripts/timeline-lib.mjs changesNear`).
3. Automations are judged on reliability (SLO) and learn from their own failures.
4. Engineering: tests per loop (node:test, fixtures in test/fixtures), JSON schema check on every data file, errors alert
   (no silent `|| true`), `--dry` mode, plain code (no 600-line one-liners).
5. Laws in `data/machines/values.json` rules 9–13 (traffic safety, protected pages, no spam, failures first, stay free).
6. Engine work during the freeze (to 11-21) changes NO page Google/ChatGPT reads.

## First-pass classification (verify each before cutting)

### Loop 1 · DATA (automation, SLO: data live by 07:05 UTC every trading day)
crtlab-backtester daily-data + data-audit · recap · hubs · upcoming · cal-history · live-news · headlines · indicators ·
react-pages · news-backfill (one-off → unschedule) · restore-test
- TODO: failure learning (why each hold/fail happened → rule), SLO record, one alert path.

### Loop 2 · SEARCH + AI (decision; metric: accounts from Google + Bing + ChatGPT)
works (north star — KEEP, core) · ai-machine (625 lines: split into hooks / curator / bing-priority) · bandit · ai-radar ·
ai-eyes · ai-pull · ai-truth · recommend · google · gsc · gsc-diag · gsc-sitemap · bing · bing-submit · indexnow · aicrawl ·
traffic · traffic-core (421 lines) · mentions · peaks
- Likely merges: traffic + traffic-core + recommend → one "search brain"; ai-eyes + ai-pull + ai-truth → one AI-readers feed.
- 11-14 finding: 86% of Bing sends went to WEAK/DEAD families → steer by works tiers.

### Loop 3 · SOCIAL (decision; metric: reel views → site visits → accounts)
reels/engine/* (stories, plan, brain, copy, lesson, make, mix, qa, post, due, learn, pulse, report, alert)
- KEEP. Next: clickable path (pinned link comment / tracked bio link), champion verdict ~11-18.

### Loop 4 · CONVERSION (decision; metric: visitor → account → paid)
humans · outcomes · behaviour · leak · world · retention/comeback emails · mailguard
- Likely merges: humans + outcomes + behaviour → one funnel reader.

### Loop 5 · GUARD (stability, cost, safety, failures)
guard · guard-lib · failures · timeline · timeline-lib · minutes · cost · expiry · deploy-watch · security · deps-audit ·
health · watchdog · load-alert · shield · shield-explain · linkcheck · mobile-qa · supervisor (keep the run-failure part)

### SECURITY (part of Guard — every machine that can affect CRTLAB, alone or combined)
- crtlab-standalone: GitHub reports 17 dependency vulnerabilities (14 high, 3 moderate) on the default branch → triage + patch.
- Public bot repo: secret scan in CI (no token/key/IP ever committed), workflow permissions least-privilege, pinned actions.
- Tokens: scope + expiry inventory (Meta data access ~2027-02-06, CF token can roll itself, GH_WATCH_TOKEN, Railway) in expiry.mjs.
- Machine hands on production (CF rules/bans, sitemap, hooks, emails, posting): each needs a kill switch, a rate cap, and a
  test that it can't hit protected pages, legit bots, or real users (11-12 it banned Kai's own IP; 11-14 it could ban Googlebot).
- Combined effects: the guard + timeline judge the SUM of machine actions, not each alone.

### META / THEATRE → merge or kill
core (625 lines, the /machine graph) · brains (420) · executive · tuner · iq · self · upgrades · fixer · memory · analyst ·
ai-report · ai-machine-family · fams · needs · summary (feeds the app board — keep, slim)
- Question for each: does it DECIDE something that moves accounts? No → kill or fold into a loop's report.
- /machine becomes a plain dashboard: accounts vs normal, experiments running, verdicts, failures, guard.

## Order
1. Guard loop first (tests + alerts — it protects everything else).
2. Data loop (SLO + failure learning).
3. Search + AI loop (biggest money, biggest mess).
4. Cut META/theatre.
5. Conversion, Social polish.
