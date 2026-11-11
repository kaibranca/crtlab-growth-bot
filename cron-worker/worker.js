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
  ["daily-data.yml", 15, 6, "*", "kaibranca/crtlab-backtester"], // 06:15: built + verified by ~06:45, RELEASED at 07:00:00 UTC (11-10)
  ["daily-data.yml", 30, 8, "*", "kaibranca/crtlab-backtester", { retry: "1" }],  // retry slot: skips itself if 06:30 already went live
  ["daily-data.yml", 30, 11, "*", "kaibranca/crtlab-backtester", { retry: "1" }], // second retry slot
  // 11-11 (Kai: "if it fails the counter won't refresh — it always has to"): a retry every 1–2 h through the afternoon. A
  // retry run exits in seconds when today's update already went live, so the extra slots cost nothing on a good day.
  ["daily-data.yml", 30, 7, "*", "kaibranca/crtlab-backtester", { retry: "1" }],
  ["daily-data.yml", 30, 9, "*", "kaibranca/crtlab-backtester", { retry: "1" }],
  ["daily-data.yml", 30, 13, "*", "kaibranca/crtlab-backtester", { retry: "1" }],
  ["daily-data.yml", 30, 15, "*", "kaibranca/crtlab-backtester", { retry: "1" }],
  ["daily-data.yml", 30, 17, "*", "kaibranca/crtlab-backtester", { retry: "1" }],
  // DEPLOY WINDOWS (11-11, Railway budget): the site goes live 3× a day instead of on every push; nothing new = no deploy
  ["promote-site.yml", 15, 7, "*", "kaibranca/crtlab-growth-bot"],
  ["promote-site.yml", 0, 13, "*", "kaibranca/crtlab-growth-bot"],
  ["promote-site.yml", 0, 19, "*", "kaibranca/crtlab-growth-bot"],
];
const hit = (rule, v) => rule === "*" || (typeof rule === "number" ? rule === v : rule.startsWith("*/") ? v % +rule.slice(2) === 0 : rule.includes("-") ? v >= +rule.split("-")[0] && v <= +rule.split("-")[1] : +rule === v);

// THE WATCHDOG OF THE WATCHDOG (11-11): every 3 h (minute 7) this worker — outside GitHub's scheduler — checks that the
// hourly engine itself ran (its status.json is < 3 h old) and that the live site's data is current. Read-only: public
// raw GitHub + crtlab.pro's public data-version. A problem starts watchdog-alert.yml, which emails with the key already in
// GitHub. Nothing else changes, no new secret.
async function guard(env, d) {
  const why = [];
  try {
    const s = await fetch(`https://raw.githubusercontent.com/${REPO}/main/data/machines/status.json?t=${d.getTime()}`, { headers: { "User-Agent": "crtlab-cron" } }).then((r) => (r.ok ? r.json() : null));
    const age = s?.at ? (d.getTime() - Date.parse(s.at)) / 3.6e6 : null;
    if (age == null || age > 3) why.push(`the hourly engine has not reported for ${age == null ? "an unknown time" : age.toFixed(1) + " h"} (supervisor + every machine behind it)`);
  } catch (e) { why.push("could not read the engine status: " + String(e).slice(0, 60)); }
  try {
    const v = await fetch("https://crtlab.pro/api/data-version", { headers: { "User-Agent": "crtlab-cron", ...(env.EDGE_SECRET ? { "x-crtlab-edge": env.EDGE_SECRET } : {}) } }) // WAF rule 3 403s an empty UA; a worker's own-zone fetch skips the transform rule, so it carries the edge header itself.then((r) => (r.ok ? r.json() : null));
    const x = new Date(d); x.setUTCHours(0, 0, 0, 0); if (d - x < 7.5 * 3.6e6) x.setUTCDate(x.getUTCDate() - 1);
    do x.setUTCDate(x.getUTCDate() - 1); while (x.getUTCDay() === 0 || x.getUTCDay() === 6);
    const want = x.toISOString().slice(0, 10);
    if (!v?.end || v.end < want) why.push(`live data through ${v?.end ?? "unknown"}, should be ${want}`);
  } catch (e) { why.push("could not read crtlab.pro data version: " + String(e).slice(0, 60)); }
  if (!why.length) return;
  // ONE EMAIL PER PROBLEM PER 12 H (11-11: the same "data through unknown" went 3× in a day). The edge cache remembers the
  // last alert per problem; a NEW problem still alerts at once. No storage to add — the worker's own cache.
  const key = new Request(`https://watchdog.crtlab.internal/alert/${encodeURIComponent(why.map((w) => w.replace(/[\d.]+ h\b/g, "")).join("|").slice(0, 300))}`);
  try { if (await caches.default.match(key)) { console.log(`${d.toISOString()} watchdog: same problem already emailed < 12 h — skipped`); return; } } catch {}
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/watchdog-alert.yml/dispatches`, {
    method: "POST", headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "crtlab-cron", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { why: why.join(" | ").slice(0, 900) } }),
  });
  console.log(`${d.toISOString()} watchdog: ${why.join(" | ")} → alert ${r.status}`);
  try { if (r.ok || r.status === 204) await caches.default.put(key, new Response("1", { headers: { "Cache-Control": "max-age=43200" } })); } catch {}
}

export default {
  async scheduled(event, env, ctx) {
    const d = new Date(event.scheduledTime), m = d.getUTCMinutes(), h = d.getUTCHours(), w = d.getUTCDay();
    if (m === 7 && h % 3 === 0) ctx.waitUntil(guard(env, d));
    const due = JOBS.filter(([, mm, hh, ww]) => hit(mm, m) && hit(hh, h) && hit(ww, w));
    for (const [wf, , , , repo = REPO, inputs] of due) {
      const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "crtlab-cron", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify(inputs ? { ref: "main", inputs } : { ref: "main" }),
      });
      console.log(`${d.toISOString()} ${wf} → ${r.status}`); // 204 = started
    }
  },
  // health probe only: shows what is scheduled, never starts anything
  async fetch() { return Response.json({ jobs: JOBS.map((j) => j[0]) }); },
};
