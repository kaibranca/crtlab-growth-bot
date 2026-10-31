# crtlab-growth-bot

Scheduled jobs that keep [crtlab.pro](https://crtlab.pro) discoverable and watched — run by GitHub Actions, no server, no cost to the site.

| Job | When | What |
|---|---|---|
| Watchdog | hourly | the money path (home, chart, pricing, candles API) and every AI crawler's access; fails → email |
| AI crawl | hourly | which AI assistants / search crawlers read which pages |
| IndexNow | daily | pushes only CHANGED pages to Bing, Yandex, Seznam, Naver |

Results: `data/` — `data/summary.json` feeds the CRTLAB Control "Growth" board.
