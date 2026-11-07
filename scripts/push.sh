#!/usr/bin/env bash
# Commit data/ and push, surviving the other workflows (11-07). Every workflow writes data/summary.json and the hourly job
# commits every hour, so a plain `pull --rebase && push` lost the race and the 08:00 recap failed every day (it only landed
# on GitHub's late ~15:30 cron). On a conflict our just-built file wins (-X theirs = the commit being replayed); the
# summary is rebuilt every run anyway. Usage: scripts/push.sh "recap 2026-11-07"
set -u
git config user.name "crtlab-growth-bot"; git config user.email "bot@crtlab.pro"
git add data
git commit -qm "$1" || { echo "nothing to commit"; exit 0; }
for i in 1 2 3 4 5; do
  if git pull -q --rebase -X theirs && git push -q; then echo "pushed (try $i)"; exit 0; fi
  git rebase --abort 2>/dev/null || true
  sleep $((i * 7))
done
echo "push failed after 5 tries"; exit 1
