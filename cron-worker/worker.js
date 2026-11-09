// CRTLAB CRON — Cloudflare Worker (11-09). GitHub's own `schedule:` drops runs under load (11-09: reels-post ran 3 times in 24h,
// the 12:18 UTC reel slot was missed until started by hand). Cloudflare Cron Triggers fire every minute reliably; this worker
// matches the minute against the same schedules the workflows declare and starts the due ones via workflow_dispatch.
// Free plan. Secret: GH_TOKEN = fine-grained PAT, crtlab-growth-bot only, Actions read+write. Nothing else.
const REPO = "kaibranca/crtlab-growth-bot";
// [workflow file, minute, hour rule, weekday rule] — keep in step with .github/workflows/*.yml
const JOBS = [
  ["reels-post.yml", "*/10", "*", "*"],  // every 10 min: a slot posts ≤10 min after its time (idempotent: the log blocks doubles)
  ["hourly.yml", 17, "*", "*"],          // shield + hourly checks
  ["health.yml", 41, "*/3", "*"],        // every 3h health
  ["daily.yml", 40, 6, "*"],             // daily growth jobs
  ["recap.yml", 0, 8, "2-6"],            // Tue–Sat 08:00 market recap (bars for reels)
  ["reels.yml", 40, 8, "*"],             // 08:40 plan + render today's reels
  ["restore.yml", 17, 5, 0],             // Sun 05:17 backup restore test
  ["weekly.yml", 0, 5, 1],               // Mon 05:00 weekly SEO
  ["daily-data.yml", 30, 6, "*", "kaibranca/crtlab-backtester"], // 06:30 daily market data (token needs crtlab-backtester, Actions RW)
];
const hit = (rule, v) => rule === "*" || (typeof rule === "number" ? rule === v : rule.startsWith("*/") ? v % +rule.slice(2) === 0 : rule.includes("-") ? v >= +rule.split("-")[0] && v <= +rule.split("-")[1] : +rule === v);

export default {
  async scheduled(event, env, ctx) {
    const d = new Date(event.scheduledTime), m = d.getUTCMinutes(), h = d.getUTCHours(), w = d.getUTCDay();
    const due = JOBS.filter(([, mm, hh, ww]) => hit(mm, m) && hit(hh, h) && hit(ww, w));
    for (const [wf, , , , repo = REPO] of due) {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "crtlab-cron", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref: "main" }),
      });
      console.log(`${d.toISOString()} ${wf} → ${r.status}`); // 204 = started
    }
  },
  // health probe only: shows what is scheduled, never starts anything
  async fetch() { return Response.json({ jobs: JOBS.map((j) => j[0]) }); },
};
