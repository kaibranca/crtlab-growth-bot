# BUILDER — how a Claude session upgrades the machines

The machines say what would make them smarter; a builder (a Claude session, or the daily builder routine) builds ONE thing;
the machines judge whether it paid. That closes the loop: **power → IQ → better build queue → power**.

## 0 · The north star (11-13) — read first
- `data/machines/values.json` — the core rules. The whole system is judged on NEW ACCOUNTS (deduped), never reads.
- `data/works/plan.json` — what works: base accounts/day, families WIN / OK / WEAK / DEAD, focus + explore, MORE jobs,
  daily cycles + verdicts, effort. Never build in a DEAD family; `works: true` items in the queue come first.
- Shared rule for every script: `scripts/works-lib.mjs` (`family`, `worksMul`, `worksTier`, `canBuild`).

## 1 · Read (cheap, files only)
- `data/machines/build-queue.json` — ranked items (top first). Take the highest item you can FINISH this run.
- `data/machines/self.json` — every machine's IQ, level, limit, KPI, upgrade verdicts; every engine's IQ and curiosity.
- `data/machines/upgrades.json` — which past upgrades paid / hurt / were flat. Don't repeat what hurt.
- `data/machines/iq.json` — MACHINES IQ + POWER over time.

## 2 · Build (one item, small, real)
- "Teach X to judge itself": give the machine a verdict loop on its own outcome — record what it did, judge it after a fixed
  window against a baseline or held-out set, write win / loss / lesson to `data/machines/ledger.jsonl` with
  `machine: "<its node id>"`, and let the verdicts change what it does next (its "hands"). IQ credits it automatically.
- "Outcome falls": read its inputs and KPI, find the missing signal, fix the cause (not the number).
- Every machine self-learns by default (7-point standard); measured, not guessed; nothing kept on faith.
- Test in a scratch copy (`rsync -a --exclude .git --exclude reels ./ $TMP/bt/`) before committing; macOS has no `timeout`.

## 3 · Guardrails (never)
- Never take items that need Kai (accounts, payments, keys, 2FA, wording he owns). Never touch checkout or prices.
- Never add pages to the site's analytics, never invent UI, never send email beyond the mail guard.
- Bot repo: commit + push (`git pull --rebase -X theirs && git push`). Site repo: commit on `rebuild-integration` only — it
  deploys at the 07:15 / 13:00 / 19:00 UTC windows; never push `live`.
- Probing crtlab.pro from Kai's network counts against the shield — 1–2 requests max.
- One item per run. If it can't be finished, leave a note in the queue item's `why`, don't half-ship.

## 4 · Report
- Commit message = what changed + which machine + what verdict loop it now has. The upgrade judge grades it 7 days later on
  that machine's KPI; `self.mjs` and IQ pick it up within the hour.
