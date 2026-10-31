# crtlab-growth-bot

Scheduled jobs that keep [crtlab.pro](https://crtlab.pro) discoverable and watched — run by GitHub Actions, no server, no cost to the site.

| Job | When | What |
|---|---|---|
| Watchdog | hourly | the money path (home, chart, pricing, candles API) and every AI crawler's access; fails → email |
| AI crawl | hourly | which AI assistants / search crawlers read which pages |
| IndexNow | daily | pushes only CHANGED pages to Bing, Yandex, Seznam, Naver |
| Search Console | weekly (Mon) | rewrites titles of pages Google shows but people skip (max 8/week, into the site's lib/seo-overrides.json), measures each change 28 days later and reverts losers, lists search gaps |

Results: `data/` — `data/summary.json` feeds the CRTLAB Control "Growth" board.

## Connect Search Console (one time)
1. Google Cloud console → create a project → enable "Google Search Console API" → create a service account → Keys → add key (JSON).
2. Search Console → Settings → Users and permissions → add the service account's email (Restricted is enough).
3. Save the JSON as this repo's `GSC_SA_JSON` secret.
