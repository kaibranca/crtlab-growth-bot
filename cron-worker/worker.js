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
  ["daily-data.yml", 24, 6, "*", "kaibranca/crtlab-backtester"], // 06:24 (11-14, was 06:15): build takes ~32 min → ready ~06:56, released 07:00:00; a long day releases the moment it is verified (job.mjs). The old start idled ~13 billed minutes a day waiting for 07:00
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
  const key = `alert:${why.map((w) => w.replace(/[\d.]+ h\b/g, "")).join("|").slice(0, 300)}`;
  if (await kvGet(env, key)) { console.log(`${d.toISOString()} watchdog: same problem already emailed < 12 h — skipped`); return; }
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/watchdog-alert.yml/dispatches`, {
    method: "POST", headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "crtlab-cron", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { why: why.join(" | ").slice(0, 900) } }),
  });
  console.log(`${d.toISOString()} watchdog: ${why.join(" | ")} → alert ${r.status}`);
  if (r.ok || r.status === 204) await kvPut(env, key, 1, 43200);
}

// DURABLE STATE (11-12): KV, not the Cache API — caches.default is a silent no-op in cron triggers (no zone route), which
// meant the sentinel's baseline never persisted and the watchdog's "emailed < 12 h" dedupe never held (repeat emails)
const kvGet = async (env, k) => { try { return env.SENTINEL ? JSON.parse((await env.SENTINEL.get(k)) ?? "null") : null; } catch { return null; } };
const kvPut = async (env, k, v, ttl) => { try { if (env.SENTINEL) await env.SENTINEL.put(k, JSON.stringify(v), ttl ? { expirationTtl: ttl } : undefined); } catch {} };

// THE SENTINEL (11-12 — reaction speed: every engine was triggered hourly, so a wave was seen up to an hour late). Every 5
// minutes, Cloudflare's own edge counts of people asking AI assistants (ChatGPT-User / Claude-User / Perplexity-User) for
// CRTLAB pages over the last 15 minutes, per page, against a rolling baseline the worker keeps in its own cache. A spike
// (total ≥ 3× its baseline and ≥ 15, or one page ≥ 4× and ≥ 6) starts hourly.yml AT ONCE with the spike attached → the
// engine locks in on those pages within minutes. 45-min cooldown. Free: no GitHub run on a normal day, no site load.
// Secrets: CF_API_TOKEN (Analytics: read) + CF_ZONE_ID. Without them it does nothing.
async function sentinel(env, d) {
  if (d.getUTCMinutes() < 5) console.log(`${d.toISOString()} sentinel: run (kv ${env.SENTINEL ? "on" : "off"})`);
  if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) { console.log(`${d.toISOString()} sentinel: off — missing ${!env.CF_API_TOKEN ? "CF_API_TOKEN " : ""}${!env.CF_ZONE_ID ? "CF_ZONE_ID" : ""} (wrangler secret put)`); return; }
  const since = new Date(d.getTime() - 15 * 60e3).toISOString(), until = d.toISOString(), pages = {};
  let total = 0;
  for (const ua of ["ChatGPT-User", "Claude-User", "Perplexity-User"]) {
    const q = `{viewer{zones(filter:{zoneTag:"${env.CF_ZONE_ID}"}){httpRequestsAdaptiveGroups(limit:60,filter:{datetime_geq:"${since}",datetime_lt:"${until}",userAgent_like:"%${ua}%"},orderBy:[count_DESC]){count dimensions{clientRequestPath}}}}}`;
    const j = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query: q }) }).then((r) => r.json()).catch((e) => ({ errors: [String(e)] }));
    if (j?.errors?.length) { console.log(`${d.toISOString()} sentinel: Cloudflare API error (${ua}) — ${JSON.stringify(j.errors).slice(0, 200)}`); return; } // never read an error as "0 fetches"
    for (const r of j?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []) { const p = r.dimensions.clientRequestPath.split("?")[0]; if (/^\/(api|_next)|\.(png|jpg|svg|ico|xml|txt)$/.test(p)) continue; pages[p] = (pages[p] ?? 0) + r.count; total += r.count; }
  }
  // rolling baseline (EWMA per 15-min window, total + per page), kept in the worker's edge cache for 3 days
  let base = await kvGet(env, "baseline");
  base ??= { total: total || 5, pages: {}, n: 0 };
  const hot = Object.entries(pages).filter(([p, n]) => n >= 6 && n >= 4 * Math.max(1, base.pages[p] ?? 0.5)).sort((a, b) => b[1] - a[1]);
  const spike = base.n >= 12 && ((total >= 15 && total >= 3 * base.total) || hot.length);
  // learn the baseline AFTER judging (a spike moves it slowly, so a long wave stays visible)
  const a = spike ? 0.05 : 0.15; base.total = base.total * (1 - a) + total * a; base.n++;
  for (const p of new Set([...Object.keys(base.pages), ...Object.keys(pages)])) { const v = (base.pages[p] ?? 0) * (1 - a) + (pages[p] ?? 0) * a; if (v < 0.05) delete base.pages[p]; else base.pages[p] = +v.toFixed(3); }
  await kvPut(env, "baseline", base, 259200);
  if (d.getUTCMinutes() === 2 || base.n <= 2) console.log(`${d.toISOString()} sentinel ok: ${total} people-fetches in 15 min vs ~${base.total.toFixed(1)} baseline (${base.n} windows learned, ${Object.keys(base.pages).length} pages tracked)`); // hourly heartbeat
  if (!spike) return;
  if (await kvGet(env, "cooldown")) { console.log(`${d.toISOString()} sentinel: spike (${total} vs ~${base.total.toFixed(1)}) — cooling down`); return; }
  const top = (hot.length ? hot : Object.entries(pages).sort((x, y) => y[1] - x[1])).slice(0, 8).map(([p]) => p);
  const why = `${total} people-fetches in 15 min vs ~${base.total.toFixed(1)} normal${hot.length ? ` · hot: ${hot.slice(0, 3).map(([p, n]) => `${p} ${n}`).join(", ")}` : ""}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/hourly.yml/dispatches`, { method: "POST",
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "crtlab-cron", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { spike: JSON.stringify({ why, pages: top }).slice(0, 900) } }) });
  console.log(`${d.toISOString()} sentinel: SPIKE ${why} → hourly ${r.status}`);
  await kvPut(env, "cooldown", 1, 2700);
}

export default {
  async scheduled(event, env, ctx) {
    const d = new Date(event.scheduledTime), m = d.getUTCMinutes(), h = d.getUTCHours(), w = d.getUTCDay();
    if (m === 7 && h % 3 === 0) ctx.waitUntil(guard(env, d));
    if (m % 5 === 2) await sentinel(env, d).catch((e) => console.log("sentinel error " + String(e).slice(0, 80))); // awaited: its logs + KV writes finish inside the event
    const due = JOBS.filter(([, mm, hh, ww]) => hit(mm, m) && hit(hh, h) && hit(ww, w));
    for (const [wf, , , , repo = REPO, inputs] of due) {
      // 11-14 MINUTES: a retry slot that would find nothing to do still bills a full GitHub minute (private repo, 2,000 free/month;
      // the pull was on pace for ~2,200). Ask the site first: every market already through its due session → skip the dispatch.
      // Fails OPEN: if the site can't answer, the retry runs as before (the pull must never be missed to save a minute).
      if (inputs?.retry && !(h === 11 || h === 15)) { try { // 11:30 + 15:30 always run (held markets get their retry); the rest skip when current const v = await (await fetch("https://crtlab.pro/api/data-version", { headers: { "User-Agent": "crtlab-cron" }, signal: AbortSignal.timeout(8000) })).json();
        if (v?.end && v?.due && v.end >= v.due) { console.log(`${d.toISOString()} ${wf} retry skipped: live ${v.live} through ${v.end} (due ${v.due})`); continue; } } catch (e) { console.log("retry pre-check failed, dispatching: " + String(e).slice(0, 60)); } }
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
