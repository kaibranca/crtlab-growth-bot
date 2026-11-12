// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE OTHER BRAINS (Kai 11-11: "new brains — all the important main cores we need"). MONEY · DATA · SECURITY · CONTENT,
// one framework, the same pyramid as the traffic brain: brain → managers → machines (the main engine's own nodes, re-parented)
// → watch branches. Hourly after the engine core; repo files + one light aggregate query (subscriptions) — never the web
// server (Kai's rule: Control must never lag, Railway budget first).
// EACH BRAIN: its own SENSORS (numbers, 24 h vs its own normal) · MODES from those numbers · an OUTCOME it is judged on —
// every mode episode is scored on that outcome and the mode's intensity learns (memory in data/brains/<id>/brain.json) ·
// AUTHORITY earned from its episodes (the super-core reads it) · a BIN (logs capped, stale lessons dropped).
// Writes data/brains/<id>/ecosystem.json — the same shape as the other engines, so /machine and the super-core draw it.
// Honest limit: these brains act through the machines that already exist (leak/cost branches, win-back, shield, data
// retries, factory); their own job is to sense, prioritise, judge and remember — and to say what only an admin can fix.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

const NOW = Date.now(), H = 3600e3, DAY = 24 * H, iso = (t) => new Date(t).toISOString();
const J = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const readLines = (p) => { try { return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), r1 = (v) => (v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(Math.abs(v) >= 10 ? 0 : 2));
const main = J("data/machines/ecosystem.json", {}), mainNode = new Map((main.nodes ?? []).map((n) => [n.id, n]));
const leak = J("data/leak/plan.json", {}), beh = J("data/behaviour/plan.json", {}), health = J("data/health.json", {}), cost = J("data/cost/plan.json", {});
const shield = J("data/shield.json", {}), tplan = J("data/traffic/plan.json", {}), ai = J("data/ai/plan.json", {}), sup = J("data/machines/status.json", {});
const mistakes = readLines("data/machines/mistakes.jsonl").filter((m) => NOW - Date.parse(m.at) < 7 * DAY);
const check = (name) => (health.checks ?? []).find((c) => c.name === name);

// one light DB read (aggregates only): paying subscriptions now / past due / new paid this week
let subs = null;
if (process.env.ANALYTICS_DB_URL) try {
  const pg = (await import("pg")).default, c = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 15000 }); await c.connect();
  try { // subscriptions has updated_at, not created_at: "new paid" = turned active in the last 7 days
    const r = await c.query(`select count(*) filter (where status='active' and tier<>'free')::int active, count(*) filter (where status='past_due')::int past_due,
      count(*) filter (where status='active' and tier<>'free' and updated_at > now() - interval '7 days')::int new7, count(*) filter (where status in ('canceled','incomplete_expired') and updated_at > now() - interval '7 days')::int lost7 from subscriptions`);
    subs = r.rows[0]; } finally { await c.end().catch(() => {}); }
} catch (e) { console.log("brains: subscriptions skipped (" + String(e.message).slice(0, 60) + ")"); }

// retention: of the people who signed up 8–14 days ago, how many were back in the last 7 days (vs the cohort before)
let ret = null;
if (process.env.ANALYTICS_DB_URL) try {
  const pg = (await import("pg")).default, c = new pg.Client({ connectionString: process.env.ANALYTICS_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, query_timeout: 15000 }); await c.connect();
  try { const r = await c.query(`select
      count(*) filter (where created_at between now() - interval '14 days' and now() - interval '7 days')::int c1,
      count(*) filter (where created_at between now() - interval '14 days' and now() - interval '7 days' and last_active > now() - interval '7 days')::int b1,
      count(*) filter (where created_at between now() - interval '21 days' and now() - interval '14 days')::int c0,
      count(*) filter (where created_at between now() - interval '21 days' and now() - interval '14 days' and last_active between now() - interval '14 days' and now() - interval '7 days')::int b0,
      count(*) filter (where created_at < now() - interval '1 day' and last_active > now() - interval '1 day')::int back24 from users`); ret = r.rows[0]; } finally { await c.end().catch(() => {}); }
} catch (e) { console.log("brains: retention skipped (" + String(e.message).slice(0, 60) + ")"); }
// speed: real visitors' page loads (Cloudflare Web Analytics, 24 h), the slowest 10% per page
let rum = null;
if (process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID) try {
  const q = `{ viewer { accounts(filter:{accountTag:"${process.env.CF_ACCOUNT_ID}"}) { rumPerformanceEventsAdaptiveGroups(limit: 25, filter:{siteTag:"029faa8748554349b362fc3789b58acc", datetime_geq:"${iso(NOW - DAY)}"}, orderBy:[count_DESC]) { count quantiles { pageLoadTimeP50 pageLoadTimeP90 } dimensions { requestPath } } } } }`;
  const j = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  rum = (j.data?.viewer?.accounts?.[0]?.rumPerformanceEventsAdaptiveGroups ?? []).map((x) => ({ p: x.dimensions.requestPath, n: x.count, p50: r1(x.quantiles.pageLoadTimeP50 / 1e6), p90: r1(x.quantiles.pageLoadTimeP90 / 1e6) }));
} catch (e) { console.log("brains: speed skipped (" + String(e.message).slice(0, 60) + ")"); }
// speed, BY DEVICE (11-12): the same 24 h of real loads split mobile / desktop / tablet — tells "slow phones" from "slow server"
let rumDev = null;
if (process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID) try {
  const q = `{ viewer { accounts(filter:{accountTag:"${process.env.CF_ACCOUNT_ID}"}) { rumPerformanceEventsAdaptiveGroups(limit: 60, filter:{siteTag:"029faa8748554349b362fc3789b58acc", datetime_geq:"${iso(NOW - DAY)}"}, orderBy:[count_DESC]) { count quantiles { pageLoadTimeP50 pageLoadTimeP90 } dimensions { deviceType countryName } } } } }`;
  const j = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  const segs = (j.data?.viewer?.accounts?.[0]?.rumPerformanceEventsAdaptiveGroups ?? []).map((x) => ({ d: x.dimensions.deviceType, c: x.dimensions.countryName, n: x.count, p50: x.quantiles.pageLoadTimeP50 / 1e6, p90: x.quantiles.pageLoadTimeP90 / 1e6 }));
  // per device: count-weighted p90 across countries (a quantile can't be summed exactly — close enough to rank, flagged as such)
  const by = {}; for (const x of segs) { const o = (by[x.d] ??= { n: 0, p50: 0, p90: 0 }); o.n += x.n; o.p50 += x.p50 * x.n; o.p90 += x.p90 * x.n; }
  rumDev = Object.entries(by).map(([d, o]) => ({ d, n: o.n, p50: r1(o.p50 / o.n), p90: r1(o.p90 / o.n) }));
  rumDev.segments = segs.filter((x) => x.n >= 10).sort((a, b) => b.p90 * b.n - a.p90 * a.n).slice(0, 4).map((x) => `${x.d}/${x.c} ${r1(x.p90)}s ×${x.n}`);
  if (j.errors?.length) console.log("brains: speed by device — " + JSON.stringify(j.errors).slice(0, 120));
} catch (e) { console.log("brains: speed by device skipped (" + String(e.message).slice(0, 60) + ")"); }
// speed, OWN PROBE (11-12): every hour, one chart page + one guest candle window from the runner — server time and whether
// Cloudflare serves the candles. Splits the slow 10% into "server/edge" vs "the visitor's device and the chart bundle".
const probe = {};
try { const t0 = Date.now(); const r = await fetch("https://crtlab.pro/xauusd", { headers: { "user-agent": "crtlab-growth-bot (speed probe)" }, signal: AbortSignal.timeout(15000) }); await r.arrayBuffer(); probe.pageS = r1((Date.now() - t0) / 1000);
  const t1 = Date.now(), c = await fetch("https://crtlab.pro/api/candles?pair=nas100&tf=5min&limit=3000", { headers: { "user-agent": "crtlab-growth-bot (speed probe)" }, signal: AbortSignal.timeout(15000) }); await c.arrayBuffer(); probe.candlesS = r1((Date.now() - t1) / 1000); probe.candlesCache = c.headers.get("cf-cache-status"); } catch (e) { probe.error = String(e.message).slice(0, 60); }
const isChart = (p) => /^\/(xauusd|nas100|btcusd|us30|sp500|eurusd|gbpusd|usdjpy|ethusd|solusd|xagusd|usoil|ger40|[a-z]{3,6}usd)$/.test(p);
// dependency alerts, MEASURED every run (was a number typed in once — Kai's truth rule): open Dependabot alerts by severity
let deps = null;
if (process.env.GH_WATCH_TOKEN || process.env.GH_TOKEN) try {
  const r = await fetch("https://api.github.com/repos/kaibranca/crtlab-standalone/dependabot/alerts?state=open&per_page=100", { headers: { Authorization: `Bearer ${process.env.GH_WATCH_TOKEN || process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15000) });
  if (r.ok) { const xs = await r.json(); deps = { open: xs.length, high: xs.filter((x) => /high|critical/.test(x.security_advisory?.severity ?? "")).length }; } else deps = { open: null, error: r.status };
} catch (e) { deps = { open: null, error: String(e.message).slice(0, 40) }; }
// BRAINS TALK: every brain reads every other brain's mode from the last run (and the traffic + main engines')
const peers = J("data/brains/index.json", { brains: [] }).brains ?? [];
const trafficEco = J("data/traffic/ecosystem.json", {}), trafficBranches = J("data/traffic/branches.json", { branches: [] }).branches;

// the wall → checkout steps (behaviour machine), all devices
const wallSteps = (() => { const out = {}; for (const rows of Object.values(beh.wall ?? {})) for (const s of rows ?? []) out[s.step] = (out[s.step] ?? 0) + (s.n ?? 0); return out; })();
const lastData = mistakes.filter((m) => m.where === "daily-data").length, lastData24 = mistakes.filter((m) => m.where === "daily-data" && NOW - Date.parse(m.at) < DAY).length;

// ── THE FOUR BRAINS (spec = managers → machines from the main engine + sensors + modes + the outcome it is judged on) ──
const BRAINS = [
  { id: "money", name: "Money brain", color: "#22ab94",
    managers: [
      { id: "funnel", label: "Funnel", machines: ["leak", "behaviour"], does: "visit → account → first replay → paid, per source and page" },
      { id: "wall", label: "Wall + checkout", machines: ["wall", "devices"], does: "daily limit → plans → card → pay, by device" },
      { id: "recover", label: "Recovery", machines: ["health"], does: "declines, past-due cards, win-back emails" },
    ],
    sensors: () => ({ paidNow: subs?.active ?? null, newPaid7: subs?.new7 ?? null, pastDue: subs?.past_due ?? null, lost7: subs?.lost7 ?? null,
      landToAccount: r1((leak.overall?.landToAccount ?? 0) * 100), replayToPaid: r1((leak.overall?.replayToPaid ?? 0) * 100), paid14: leak.overall?.paid ?? null,
      wallViews: wallSteps.wall_view ?? null, packClicks: wallSteps.pack_click ?? null, cardEntered: wallSteps.card_details_entered ?? null, payClicks: wallSteps.pay_click ?? null,
      paymentsOk: check("payments")?.ok ?? null }),
    outcome: (s) => ({ label: "new paying customers / 7 d", v: s.newPaid7 ?? s.paid14 ?? 0, higher: true }),
    signals: (s) => [s.packClicks >= 20 && { key: "checkout-step", target: "pack → card", v: r1((s.cardEntered / s.packClicks) * 100), higher: true, days: 7, why: `${s.cardEntered} of ${s.packClicks} pack-pickers typed a card` },
      s.pastDue > 0 && { key: "past-due", info: true, target: "past-due cards", v: s.pastDue, higher: false, days: 5, why: `${s.pastDue} customer card(s) declined on renewal — Stripe retries + win-back email (a business event, tracked, never an alarm)` },
      ...(leak.leaks ?? []).filter((l) => l.rate < l.overall).slice(0, 2).map((l) => ({ key: "leak", target: `${l.segment} @ ${l.stage}`, v: r1(l.rate * 100), higher: true, days: 7, why: `${l.base} people, ${r1(l.rate * 100)}% vs ${r1(l.overall * 100)}% overall` }))].filter(Boolean),
    measureOf: (b, s) => b.key === "checkout-step" ? (s.packClicks ? r1((s.cardEntered / s.packClicks) * 100) : null) : b.key === "past-due" ? s.pastDue : r1(((leak.leaks ?? []).find((l) => `${l.segment} @ ${l.stage}` === b.target)?.rate ?? NaN) * 100),
    modes: (s) => [
      s.paymentsOk === false && { id: "money-alert", label: "Money alert", level: "critical", why: `payments check failing (${check("payments")?.note ?? "failed payment"})${s.pastDue ? ` · ${s.pastDue} past due` : ""}` },
      s.packClicks >= 20 && s.cardEntered != null && s.cardEntered / s.packClicks < 0.15 && { id: "checkout-leak", label: "Checkout leak", level: "warn", why: `${s.packClicks} picked a pack, only ${s.cardEntered} typed card details, ${s.payClicks} pressed pay` },
    ].filter(Boolean),
    admin: (s) => [s.packClicks && s.cardEntered != null && s.cardEntered / s.packClicks < 0.15 ? `Only ${s.cardEntered} of ${s.packClicks} people who picked a pack typed a card — the step between pack and card is the money leak (wallets/PayPal first? fewer fields?).` : null,
      s.paymentsOk === false ? "Several renewals failed at once — check Stripe + the webhook (billing itself may be broken)." : null,
      s.pastDue > 0 ? "Optional, one-time: Stripe Smart Retries + failed-payment emails make declined renewals recover by themselves (5 min) — not an alarm." : null].filter(Boolean) },
  { id: "data", name: "Data brain", color: "#ff9800",
    managers: [
      { id: "pull", label: "Daily pull", machines: ["datapull"], does: "every market's new day, published 07:00 UTC" },
      { id: "safety", label: "Backups", machines: ["backup", "restore"], does: "nightly backup + restore test" },
      { id: "budget", label: "Railway budget", machines: ["cost", "capacity", "load"], does: "cost pace, memory, capacity" },
    ],
    sensors: () => ({ dataFresh: check("market data fresh")?.ok ?? null, dataNote: check("market data fresh")?.note ?? null, pullFails7: lastData, pullFails24: lastData24,
      backupOk: check("nightly backup")?.ok ?? null, monthPace: r1(cost.monthPace), budget: cost.budget ?? 10, deploys24: cost.deploys ?? null }),
    outcome: (s) => ({ label: "Railway $ / month pace", v: s.monthPace ?? 0, higher: false }),
    signals: (s) => [s.monthPace > s.budget && { key: "budget", target: "Railway pace", v: s.monthPace, higher: false, days: 3, why: `$${s.monthPace}/month vs $${s.budget}` },
      s.pullFails24 >= 2 && { key: "pull", target: "daily-data failures (24 h)", v: s.pullFails24, higher: false, days: 2, why: `${s.pullFails24} failures in the last 24 h` },
      ...(cost.incidents ?? []).slice(0, 2).map((i) => ({ key: "cost-incident", target: `${i.svc} ${i.kind}`, v: i.memGB ?? i.n ?? 1, higher: false, days: 2, why: i.why }))].filter(Boolean),
    measureOf: (b, s) => b.key === "budget" ? s.monthPace : b.key === "pull" ? s.pullFails24 : (cost.incidents ?? []).some((i) => `${i.svc} ${i.kind}` === b.target) ? (cost.incidents.find((i) => `${i.svc} ${i.kind}` === b.target).memGB ?? 1) : 0,
    modes: (s) => [
      s.dataFresh === false && { id: "data-late", label: "Data late", level: "critical", why: `market data not fresh (${s.dataNote})` },
      s.backupOk === false && { id: "backup", label: "Backup failing", level: "critical", why: "nightly backup check failing" },
      s.monthPace > s.budget * 1.5 && { id: "over-budget", label: "Over budget", level: "warn", why: `Railway pace $${s.monthPace}/month vs $${s.budget} target` },
      s.pullFails24 >= 2 && { id: "pull-flaky", label: "Pull flaky", level: "warn", why: `daily-data failed ${s.pullFails24}× in the last 24 h` },
    ].filter(Boolean),
    admin: (s) => [s.monthPace > s.budget * 1.5 ? `Railway pace $${s.monthPace}/mo vs $${s.budget}: fewer direct deploys (use the 07:15/13:00/19:00 windows), then check web memory once the heap tuner has 24 h of samples.` : null].filter(Boolean) },
  { id: "security", name: "Security brain", color: "#f7525f",
    managers: [
      { id: "edge", label: "Edge", machines: ["shield"], does: "Cloudflare: bans, scanner rules, cloud-crawler challenge" },
      { id: "app", label: "App", machines: ["security"], does: "secrets, headers, exposed paths" },
      { id: "watch", label: "Watchdogs", machines: ["watchdog", "health"], does: "independent uptime + data checks" },
    ],
    sensors: () => ({ crawlersChallengedHour: shield.lastHour?.crawlersChallenged ?? null, blockedHour: shield.lastHour?.blocked ?? null, bannedList: shield.lastHour?.listSize ?? null, shieldMode: shield.lastHour?.mode ?? null,
      blocked24: (shield.history ?? []).filter((h) => NOW - Date.parse(h.at) < DAY).reduce((a, h) => a + (h.blocked ?? 0), 0), deps: deps?.open ?? null, depsHigh: deps?.high ?? null, depsUnmeasured: deps?.open == null ? (deps?.error ?? "no token") : null }),
    outcome: (s) => ({ label: "attacks blocked / 24 h", v: s.blocked24 ?? 0, higher: false }),
    signals: (s) => [s.blocked24 >= 1000 && { key: "attack-volume", target: "blocked / 24 h", v: s.blocked24, higher: false, days: 3, why: `${s.blocked24} blocked in 24 h` },
      s.deps > 0 && { key: "deps", target: "Dependabot alerts", v: s.deps, higher: false, days: 7, why: `${s.deps} open dependency alerts on crtlab-standalone (${s.depsHigh} high)` }].filter(Boolean),
    measureOf: (b, s) => b.key === "attack-volume" ? s.blocked24 : s.deps,
    modes: (s) => [
      s.shieldMode && s.shieldMode !== "medium" && s.shieldMode !== "low" && { id: "under-attack", label: "Under attack", level: "critical", why: `Cloudflare in ${s.shieldMode} mode` },
      s.blockedHour >= 200 && { id: "attack", label: "Attack", level: "warn", why: `${s.blockedHour} blocked in the last hour` },
    ].filter(Boolean),
    admin: (s) => [s.deps > 0 ? `Dependabot: ${s.deps} open alerts on crtlab-standalone (${s.depsHigh} high) — dependency upgrades are an admin job (they need a build + test).` : s.depsUnmeasured ? `Dependabot alerts can't be read (${s.depsUnmeasured}) — give the bot token "Dependabot alerts: read" on crtlab-standalone.` : null,
      "Rotate the Cloudflare + Railway tokens that were pasted in chat; turn on 2FA."].filter(Boolean) },
  { id: "content", name: "Content brain", color: "#ffd166",
    managers: [
      { id: "factory", label: "Page factory", machines: ["factory", "news", "recaps"], does: "release, reaction and recap pages, the morning after" },
      { id: "reference", label: "Reference", machines: ["calendar", "indicators"], does: "calendar + indicator pages" },
      { id: "quality", label: "Quality", machines: ["linkcheck"], does: "dead links, broken pages" },
    ],
    sensors: () => { const fam = (f) => (ai.families ?? []).find((x) => x.family === f); const react = fam("/news/<type>/<market>");
      return { reactPages: react?.pages ?? null, reactReads: r1(react?.reads), reactClicks: r1(react?.clicks), gaps: (tplan.gaps ?? []).length, topGap: tplan.gaps?.[0]?.q ?? null }; },
    outcome: (s) => ({ label: "AI clicks on factory pages (decayed)", v: s.reactClicks ?? 0, higher: true }),
    signals: () => (tplan.gaps ?? []).slice(0, 3).map((g) => ({ key: "gap", target: g.q, v: 0, higher: true, days: 14, why: `Bing shows us for it (${g.impr} impressions, #${g.pos}) with no page` })),
    measureOf: (b) => ((tplan.demand ?? []).find((d) => d.q === b.target)?.page ? 1 : 0),
    modes: (s) => [s.gaps >= 5 && { id: "gaps", label: "Gaps", level: "info", why: `${s.gaps} searches Bing shows us for with no page (top: "${s.topGap}")` }].filter(Boolean),
    admin: (s) => [s.topGap ? `Bing shows CRTLAB for "${s.topGap}" with no page that fits — a page for it is the content brain's top request.` : null].filter(Boolean) },
  { id: "retention", name: "Retention brain", color: "#5b8cff",
    managers: [
      { id: "firstday", label: "First day", machines: ["behaviour"], does: "first-day actions that bring people back" },
      { id: "return", label: "Coming back", machines: ["humans"], does: "returners, cohorts, streaks" },
    ],
    sensors: () => ({ cohort: ret?.c1 ?? null, backWeek2: ret ? r1((ret.b1 / Math.max(1, ret.c1)) * 100) : null, backWeek2Before: ret ? r1((ret.b0 / Math.max(1, ret.c0)) * 100) : null, returners24: ret?.back24 ?? null }),
    outcome: (s) => ({ label: "% of a week's sign-ups back in week 2", v: s.backWeek2 ?? 0, higher: true }),
    signals: (s) => [s.backWeek2 != null && s.backWeek2 < 30 && { key: "week2", target: "week-2 return", v: s.backWeek2, higher: true, days: 7, why: `${s.backWeek2}% of a cohort back in week 2` }].filter(Boolean),
    measureOf: (b, s) => s.backWeek2,
    modes: (s) => [s.backWeek2 != null && s.backWeek2Before != null && s.cohort >= 20 && s.backWeek2 < s.backWeek2Before * 0.8 && { id: "churn", label: "Churn up", level: "warn", why: `${s.backWeek2}% of last cohort came back in week 2 vs ${s.backWeek2Before}% before` }].filter(Boolean),
    // 11-12 audit (read in the site code): since the 11-06 daily switch NO retention email runs — runLifecycle skips on
    // dailyOn(), runWeeklyReset skips on sampleOn(). The one machine that reaches a sign-up who left is off.
    admin: (s) => [s.backWeek2 != null && s.backWeek2 < 25 ? `Only ${s.backWeek2}% of the people who signed up 8–14 days ago came back this week — the first session decides it (behaviour machine: golden actions).` : null,
      "No retention email has run since the 11-06 daily switch (sample + weekly-reset emails both skip in daily mode) — nothing reaches a sign-up who left. A daily-era \"your 2,000 candles are back\" email needs Kai's wording."].filter(Boolean) },
  { id: "speed", name: "Speed brain", color: "#00c2a8",
    managers: [
      { id: "charts", label: "Chart pages", machines: ["capacity", "load"], does: "real visitors' load time on the replay pages" },
      { id: "pages", label: "Site pages", machines: ["linkcheck"], does: "load time on the pages search and AI send people to" },
    ],
    sensors: () => { const ch = (rum ?? []).filter((x) => isChart(x.p) && x.n >= 5), pg2 = (rum ?? []).filter((x) => !isChart(x.p) && x.n >= 5);
      const w = (xs) => (xs.length ? r1(xs.reduce((a, x) => a + x.p90 * x.n, 0) / xs.reduce((a, x) => a + x.n, 0)) : null);
      const worst = [...ch].sort((a, b) => b.p90 - a.p90)[0];
      const dv = (k) => (rumDev ?? []).find((x) => x.d === k);
      return { chartP90: w(ch), pageP90: w(pg2), worstChart: worst ? `${worst.p} ${worst.p90}s` : null, loads24: (rum ?? []).reduce((a, x) => a + x.n, 0) || null,
        mobileP90: dv("mobile")?.p90 ?? null, desktopP90: dv("desktop")?.p90 ?? null, mobileShare: rumDev?.length ? r1((dv("mobile")?.n ?? 0) / rumDev.reduce((a, x) => a + x.n, 0) * 100) : null,
        slowSegments: rumDev?.segments?.join(", ") || null, serverPageS: probe.pageS ?? null, candlesS: probe.candlesS ?? null, candlesCache: probe.candlesCache ?? null }; },
    outcome: (s) => ({ label: "chart pages: slowest 10% load (s)", v: s.chartP90 ?? 0, higher: false }),
    signals: () => (rum ?? []).filter((x) => x.n >= 8 && x.p90 > 5).sort((a, b) => b.p90 * b.n - a.p90 * a.n).slice(0, 3).map((x) => { const pushed = (trafficBranches ?? []).some((t) => t.state === "alive" && t.target === x.p);
      return { key: "slow-page", target: x.p, v: x.p90, higher: false, days: 7, why: `slowest 10% load ${x.p90}s (${x.n} loads)${pushed ? " — and the traffic brain is pushing it" : ""}` }; }),
    measureOf: (b) => (rum ?? []).find((x) => x.p === b.target)?.p90 ?? null,
    modes: (s) => [s.chartP90 != null && s.chartP90 > 6 && { id: "slow", label: "Slow charts", level: "warn", why: `slowest 10% of chart loads take ${s.chartP90}s (worst ${s.worstChart})` }].filter(Boolean),
    // the fix text follows the MEASUREMENT (truth rule) — 11-11 it blamed the candles; 11-12 they measured 0.46 s and edge-cached
    admin: (s) => { if (!(s.chartP90 > 4)) return [];
      const serverOk = s.serverPageS != null && s.serverPageS < 1.5 && s.candlesS != null && s.candlesS < 1.5;
      const dev = s.mobileP90 != null && s.desktopP90 != null ? ` — phones ${s.mobileP90}s vs desktop ${s.desktopP90}s (${s.mobileShare}% of loads on phones)` : "";
      // only what was measured: server/edge vs the visitor side, and WHERE the slow loads sit (device × country)
      const where = s.slowSegments ? ` Most slow-load time sits in: ${s.slowSegments}.` : "";
      const side = s.mobileP90 != null && s.desktopP90 != null ? (s.desktopP90 > s.mobileP90 * 1.3 ? " Desktops are slower than phones, so it is not phone CPU — something desktop loads (more candles, panels, a far country) is the lead." : s.mobileP90 > s.desktopP90 * 1.3 ? " Phones are the slow side — the chart bundle on weak CPUs is the lead." : "") : "";
      return [serverOk ? `Chart pages: the slowest 10% of real loads take ${s.chartP90}s${dev}; the server answers in ${s.serverPageS}s and candles in ${s.candlesS}s (${s.candlesCache}) — the time is on the visitor's side.${side}${where} Needs a build session to profile one slow load.`
        : `Chart pages: the slowest 10% of real loads take ${s.chartP90}s${dev}; the server probe took ${s.serverPageS ?? "?"}s, candles ${s.candlesS ?? "?"}s (${s.candlesCache ?? "?"}) — server/edge side is slow, check web memory + the data service.`]; } },
  { id: "fixer", name: "Fixer brain", color: "#e2b93b",
    managers: [
      { id: "auto", label: "Auto-fix", machines: ["fixer", "supervisor"], does: "data retries, transient re-runs, restarting stopped machines — each fix verified the next hour" },
      { id: "queue", label: "Needs you", machines: ["mistakes"], does: "what no machine can do, with the exact steps — one queue for every engine" },
    ],
    sensors: () => { const q = needQueue(); const fx = J("data/machines/fixer.json", {}); return { humanOpen: q.length, autoActions24: (fx.actions ?? []).filter((a) => NOW - Date.parse(a.at) < DAY).length,
      playbooks: Object.entries(fx.w ?? {}).map(([k, w]) => `${k} ${w.v}`).join(", ") || null, top: q[0]?.what ?? null }; },
    outcome: (s) => ({ label: "things that need you", v: s.humanOpen ?? 0, higher: false }),
    signals: () => needQueue().slice(0, 6).map((x) => ({ key: x.kind, target: x.what.slice(0, 60), v: 1, higher: false, days: 3, why: x.steps })),
    measureOf: (b) => (needQueue().some((x) => x.what.slice(0, 60) === b.target) ? 1 : 0),
    modes: (s) => [s.humanOpen >= 6 && { id: "backlog", label: "Backlog", level: "warn", why: `${s.humanOpen} things need you — top: ${s.top}` }].filter(Boolean),
    admin: () => needQueue().slice(0, 5).map((x, i) => `${i + 1}. ${x.what} → ${x.steps}`) },
];

// THE NEED-YOU QUEUE (Fixer brain): every engine's "needs you" in one list, the same thing said twice merged, each with
// the exact steps. Only what no machine can do lands here (auto-fixable things are the fixer's, verified next hour).
function needQueue() {
  const raw = [];
  for (const id of ["money", "data", "security", "content", "retention", "speed"]) for (const w of J(`data/brains/${id}/ecosystem.json`, {}).briefing?.watch ?? []) if (/^(Admin|Escalated):/.test(w) && !/Optional|not an alarm/i.test(w)) raw.push({ from: id, text: w.replace(/^(Admin|Escalated):\s*/, "") });
  for (const t of J("data/machines/fixer.json", {}).tasks ?? []) raw.push({ from: "fixer", text: `${t.what} — ${t.fix}` });
  // MOST SPECIFIC FIRST (11-12 fix: "no token" took the token-rotation steps and "candles are back" took chart speed)
  const KNOWN = [[/retention email/i, "retention-email", "approve the wording of a daily-era \"your candles are back\" email (people who replayed, gone 2+ days) — then it's a build + switchback test"],
    [/can't be read|Dependabot alerts: read/i, "deps-token", "GitHub → Settings → Developer settings → the bot's fine-grained token → add crtlab-standalone with \"Dependabot alerts: Read\" (2 min)"],
    [/Smart Retries|failed-payment/i, "stripe", "Stripe dashboard → Settings → Billing → turn on Smart Retries + failed-payment emails (5 min)"],
    [/Rotate|2FA/i, "tokens", "Cloudflare + Railway: roll the tokens pasted in chat, update GH secrets CF_API_TOKEN; turn on 2FA (10 min)"],
    [/Dependabot/i, "deps", "say \"fix dependabot\" — upgrades need a build + test session"],
    [/pack|card|checkout/i, "checkout", "decide the checkout fix (wallets/PayPal first, fewer fields) — a build session"],
    [/Chart pages|slowest 10%/i, "speed", "say \"chart speed\" — edge-cache immutable candle windows (a build session)"],
    [/Railway pace|deploys/i, "budget", "fewer direct deploys (use the windows); heap tuner after 24 h of samples"],
    [/came back|week 2|first session/i, "retention", "decide a first-session change (golden actions from the behaviour machine)"],
    [/no page|Bing shows/i, "gap", "approve a page for the search (content brain's top gap)"]];
  const out = new Map();
  for (const r of raw) { const k = KNOWN.find(([re]) => re.test(r.text)); const kind = k?.[1] ?? "other", key = kind === "other" ? r.text.slice(0, 50) : kind;
    if (!out.has(key)) out.set(key, { kind, what: r.text.split(" — ")[0].slice(0, 140), steps: k?.[2] ?? "needs a look in a build session", from: new Set([r.from]) }); else out.get(key).from.add(r.from); }
  return [...out.values()].map((x) => ({ ...x, from: [...x.from] })).sort((a, b) => b.from.length - a.from.length);
}

// ── RUN EACH BRAIN: sense → modes → judge last episode on its outcome → learn intensity → write its pyramid ───────────
const index = [];
for (const S of BRAINS) try {
  const DIR = `data/brains/${S.id}`; fs.mkdirSync(DIR, { recursive: true });
  const mem = J(`${DIR}/brain.json`, { modes: {}, episode: null, born: iso(NOW), days: [] });
  let sens = {}; try { sens = S.sensors(); } catch (e) { sens = { error: String(e.message).slice(0, 80) }; }
  const out = S.outcome(sens);
  const modes = (() => { try { return S.modes(sens); } catch { return []; } })();
  const lead = modes[0] ?? { id: "normal", label: "Normal", level: "info", why: "nothing out of line" };
  const M = (id) => (mem.modes[id] ??= { intensity: 1, episodes: 0, wins: 0, losses: 0 });
  const feed = [];
  if (!mem.episode || mem.episode.mode !== lead.id) {
    if (mem.episode && NOW - Date.parse(mem.episode.since) > 3 * H) { const m = M(mem.episode.mode), a = mem.episode.start ?? 0, b = out.v ?? 0;
      const good = out.higher ? b >= a : b <= a; m.episodes++; good ? m.wins++ : m.losses++; m.intensity = +clamp(m.intensity + (good ? 0.1 : -0.1), 0.6, 1.6).toFixed(2);
      feed.push({ t: iso(NOW), m: `${S.id}-modes`, text: `${mem.episode.mode} ended: ${out.label} ${a} → ${b} (${good ? "better" : "worse"})`, kind: good ? "win" : "bad" }); }
    mem.episode = { mode: lead.id, since: iso(NOW), start: out.v ?? 0 }; feed.push({ t: iso(NOW), m: `${S.id}-modes`, text: `now ${lead.label}: ${lead.why}`, kind: lead.level === "critical" ? "bad" : "hot" });
  }
  // STEADY MODES LEARN TOO: every 24 h inside the same mode the day is judged (outcome now vs the day's start) and the
  // next day starts from here — a brain in one mode for a week still learns seven times
  else if (NOW - Date.parse(mem.episode.segAt ?? mem.episode.since) >= DAY) { const m = M(lead.id), a = mem.episode.segStart ?? mem.episode.start ?? 0, b = out.v ?? 0;
    const good = out.higher ? b >= a : b <= a; m.episodes++; good ? m.wins++ : m.losses++; m.intensity = +clamp(m.intensity + (good ? 0.05 : -0.05), 0.6, 1.6).toFixed(2);
    feed.push({ t: iso(NOW), m: `${S.id}-modes`, text: `day in ${lead.label}: ${out.label} ${a} → ${b} (${good ? "better" : "worse"})`, kind: good ? "win" : "bad" });
    mem.episode.segAt = iso(NOW); mem.episode.segStart = b; }
  const ep = Object.values(mem.modes).reduce((a, m) => ({ e: a.e + m.episodes, w: a.w + m.wins }), { e: 0, w: 0 });
  const authority = ep.e >= 4 ? +clamp(0.85 + 0.5 * (ep.w / ep.e), 0.85, 1.25).toFixed(2) : 1;
  // BRANCHES (new parts made from what the brain finds) + NEURONS ("does this kind of problem fix itself?") + ESCALATION
  const BR = J(`${DIR}/branches.json`, { branches: [] }), W = (mem.w ??= {});
  const wOf = (k) => (W[k] ??= { v: 0.5, n: 0 });
  let sig = []; try { sig = (S.signals?.(sens) ?? []).filter((x) => x && x.v != null && Number.isFinite(+x.v)); } catch { sig = []; }
  for (const x of sig) { const id = `${x.key}-${x.target}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
    if (BR.branches.some((b) => b.id === id && (b.state === "open" || NOW - Date.parse(b.closed ?? 0) < 14 * DAY))) continue;
    if (BR.branches.filter((b) => b.state === "open").length >= 8) break;
    BR.branches.push({ id, key: x.key, target: x.target, base: x.v, higher: x.higher, days: x.days, why: x.why, born: iso(NOW), state: "open", ...(x.info ? { info: true } : {}) });
    feed.push({ t: iso(NOW), m: "core", text: `opened a branch: ${x.target} (${x.why})`, kind: "hot" }); }
  for (const b of BR.branches.filter((b) => b.state === "open")) {
    let v = null; try { v = S.measureOf?.(b, sens); } catch { v = null; } if (v != null && Number.isFinite(+v)) b.now = v;
    const age = (NOW - Date.parse(b.born)) / DAY; if (age < b.days || b.now == null) continue;
    const better = b.higher ? b.now >= b.base * 1.15 || (b.base === 0 && b.now > 0) : b.now <= b.base * 0.85; const w = wOf(b.key);
    w.v = +clamp(w.v + 0.25 * ((better ? 1 : 0) - w.v), 0.05, 0.95).toFixed(3); w.n++;
    if (better) { b.state = "resolved"; b.closed = iso(NOW); feed.push({ t: iso(NOW), m: "core", text: `resolved: ${b.target} (${b.base} → ${b.now})`, kind: "win" }); }
    else { b.judged = iso(NOW); b.base = b.base; b.born = iso(NOW); b.stuck = (b.stuck ?? 0) + 1; feed.push({ t: iso(NOW), m: "core", text: `still open: ${b.target} (${b.now}) — ${b.stuck}× judged`, kind: "bad" }); }
  }
  BR.branches = BR.branches.filter((b) => b.state === "open" || NOW - Date.parse(b.closed ?? b.born) < 45 * DAY); // bin
  fs.writeFileSync(`${DIR}/branches.json`, JSON.stringify(BR, null, 1));
  // ESCALATION: kinds that don't fix themselves (neuron < .35 after 2 verdicts) or branches stuck 2+ windows → admin, first
  const escalate = BR.branches.filter((b) => b.state === "open" && !b.info && ((W[b.key]?.n ?? 0) >= 2 && W[b.key].v < 0.35 || (b.stuck ?? 0) >= 2)).map((b) => `${b.target}: ${b.why} — open ${b.stuck ?? 0}× windows; this kind doesn't fix itself → needs an admin`);
  const day = iso(NOW).slice(0, 10); mem.days = [...(mem.days ?? []).filter((d) => d.day !== day), { day, outcome: out.v, mode: lead.id }].slice(-120); // memory: 120 days, the rest binned
  fs.writeFileSync(`${DIR}/brain.json`, JSON.stringify(mem, null, 1));

  const nodes = [], seen = new Set();
  const push = (n) => { if (seen.has(n.id)) return; seen.add(n.id); nodes.push({ state: "ok", lastRunH: 0, act24: 0, hot: false, discovered: false, recent: [], every: 1, ...n }); };
  push({ id: "core", name: S.name, group: "core", parent: null, does: `Authority ×${authority}. Judged on ${out.label}: ${out.v ?? "—"}. ${S.managers.map((m) => m.label).join(" · ")}`, kpi: { label: out.label, now: out.v ?? null, lowerBetter: !out.higher } });
  push({ id: "traffic-engine", link: "traffic", name: "Traffic brain ↗", group: "core", parent: "core", does: `Mode ${trafficEco.modes?.[0]?.label ?? "—"}: ${trafficEco.modes?.[0]?.why ?? ""}`.slice(0, 200), kpi: null });
  push({ id: "main-engine", link: "main", name: "Main engine ↗", group: "core", parent: "core", does: "The engine core this brain reads its machines from", kpi: { label: "main machines running", now: main.totals?.ok ?? null, before: main.totals?.machines ?? null } });
  push({ id: `${S.id}-modes`, name: "Modes", group: "core", parent: "core", does: `Lead mode ${lead.label} (×${M(lead.id).intensity}); episodes judged on ${out.label}`, kpi: { label: "episodes that paid", now: ep.w, before: ep.e }, recent: feed.slice(0, 3) });
  for (const g of S.managers) {
    const lid = `lead-${g.id}`, kids = g.machines.map((id) => mainNode.get(id)).filter(Boolean);
    push({ id: lid, name: `${g.label} manager`, group: g.id, parent: "core", does: g.does, kpi: { label: "machines running", now: kids.filter((k) => k.state === "ok").length, before: kids.length }, act24: kids.reduce((a, k) => a + (k.act24 ?? 0), 0) });
    for (const k of kids) push({ ...k, group: g.id, parent: lid, link: undefined });
    for (const b of (main.spawned ?? []).filter((b) => b.state === "alive" && g.machines.some((m) => b.id.startsWith(m + "-")))) push({ id: b.id, name: b.target.slice(0, 26), group: g.id, parent: g.machines.find((m) => b.id.startsWith(m + "-")), does: `Branch: ${b.why}`, spawned: true, born: b.born, kpi: null });
  }
  const KEYMGR = { stripe: "lead-queue", tokens: "lead-queue", deps: "lead-queue", checkout: "lead-queue", speed: "lead-queue", budget: "lead-queue", retention: "lead-queue", gap: "lead-queue", other: "lead-queue", "checkout-step": "lead-wall", "past-due": "lead-recover", leak: "lead-funnel", budget: "lead-budget", pull: "lead-pull", "cost-incident": "lead-budget", "attack-volume": "lead-edge", deps: "lead-app", gap: "lead-factory", week2: "lead-return", "slow-page": "lead-charts" };
  for (const b of BR.branches.filter((b) => b.state === "open")) push({ id: `br-${b.id}`, name: b.target.length > 24 ? b.target.slice(0, 23) + "…" : b.target, group: nodes.find((n) => n.id === (S.id === "fixer" ? "lead-queue" : KEYMGR[b.key]))?.group ?? "core", parent: (S.id === "fixer" ? "lead-queue" : KEYMGR[b.key]) ?? "core", spawned: true, born: b.born,
    does: `Branch opened by ${S.name}: ${b.why}. Judged after ${b.days} d on its own number; neuron "${b.key}" = ${W[b.key]?.v ?? 0.5} (chance this kind fixes itself)`, kpi: { label: b.target, now: b.now ?? b.base, before: b.base, lowerBetter: !b.higher } });
  const ids = new Set(nodes.map((n) => n.id)); for (const n of nodes) if (n.parent && !ids.has(n.parent)) n.parent = "core";
  const edges = nodes.filter((n) => n.parent).map((n) => ({ a: n.parent, b: n.id, kind: "branch", w: Math.min(1, (n.act24 ?? 0) / 10) }));
  const good = [], watch = [], next = [];
  for (const [k, v] of Object.entries(sens)) if (v != null && typeof v !== "object") (k === "error" ? watch : good).push(`${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`);
  for (const e of escalate) watch.push(`Escalated: ${e}`);
  for (const a of S.admin(sens)) watch.push(`Admin: ${a}`);
  for (const m of modes) next.push(`${m.label}: ${m.why}`);
  // what the OTHER brains are saying (they all talk through data/brains/index.json + the traffic engine)
  const heard = [...peers.filter((p) => p.id !== S.id && p.mode && p.mode !== "Normal").map((p) => `${p.name}: ${p.mode}`), ...(trafficEco.modes?.[0] && trafficEco.modes[0].id !== "hunt" ? [`Traffic brain: ${trafficEco.modes[0].label}`] : [])];
  if (heard.length) good.unshift(`Other brains: ${heard.join(" · ")}`);
  const mainFeed = (main.feed ?? []).filter((f) => ids.has(f.m) && f.m !== "core").slice(0, 30);
  const eco = { at: iso(NOW), engine: S.id, color: S.color, modes: modes.length ? modes : [lead], sensors: sens, authority,
    briefing: { key: S.id + lead.id, changed: mem.episode.since, headline: `${S.name}: ${lead.label}`, good: good.slice(0, 8), watch, next, conclusion: `${lead.label === "Normal" ? "All steady" : lead.label}: ${lead.why}. Judged on ${out.label} (${out.v ?? "—"}).` },
    mode: { mode: lead.level === "critical" ? "dip" : "normal", since: mem.episode.since, why: lead.why, z: 0, r24: 0, normal: 0 },
    nodes, edges, feed: [...feed, ...mainFeed], totals: { machines: nodes.length, ok: nodes.filter((n) => n.state === "ok").length, late: nodes.filter((n) => n.state === "late").length, stopped: nodes.filter((n) => n.state === "stopped").length, actions24: feed.length + mainFeed.length },
    widgets: main.widgets, rules: [...Object.entries(W).filter(([, w]) => w.n >= 1).map(([k, w]) => `${k.replace(/-/g, " ")} problems ${w.v >= 0.6 ? "usually fix themselves" : w.v <= 0.35 ? "do NOT fix themselves → escalated to an admin" : "sometimes fix themselves"} (${w.v} after ${w.n})`),
      ...Object.entries(mem.modes).filter(([, m]) => m.episodes >= 2).map(([id, m]) => `${id}: ${m.wins}/${m.episodes} periods better → intensity ×${m.intensity}`),
      ...(S.id === "fixer" ? Object.entries(J("data/machines/fixer.json", {}).w ?? {}).map(([k, w]) => `${k} playbook: ${w.v >= 0.6 ? "works" : w.v <= 0.35 ? "doesn't work → stopped" : "mixed"} (${w.v} after ${w.n})`) : []),
      "Judged on one outcome number; mode intensity learns from every episode", "A business event (a declined card, a cancel) is information, not an alarm", "Never touches the web server"],
    allIn: [], fix: watch.slice(0, 4), mistakes: [], ledger: [], episodes: [], score: main.score ?? [],
    spawned: BR.branches.slice(-12).map((b) => ({ id: b.id, target: b.target, state: b.state, born: b.born, why: b.why, verdict: b.state === "resolved" ? "resolved" : b.stuck ? `open ${b.stuck}×` : "measuring", ratio: b.now })),
    neurons: Object.entries(W).map(([k, w]) => ({ k, v: w.v, n: w.n })) };
  fs.writeFileSync(`${DIR}/ecosystem.json`, JSON.stringify(eco));
  index.push({ id: S.id, name: S.name, color: S.color, mode: lead.label, level: lead.level, outcome: out, authority, open: BR.branches.filter((b) => b.state === "open").length, escalated: escalate.length });
  console.log(`${S.name}: [${BR.branches.filter((b) => b.state === "open").length} branches] ${lead.label}${modes.length > 1 ? ` +${modes.length - 1}` : ""} · ${out.label} ${out.v ?? "—"} · authority ×${authority} · ${nodes.length} nodes${S.admin(sens).length ? ` · admin: ${S.admin(sens)[0].slice(0, 90)}` : ""}`);
} catch (e) { // ONE BRAIN FAILING NEVER TAKES THE OTHERS DOWN — it is reported (the supervisor/fixer read the log + index)
  console.log(`${S.name}: FAILED — ${String(e?.stack ?? e).split("\n").slice(0, 2).join(" | ").slice(0, 220)}`);
  index.push({ id: S.id, name: S.name, color: S.color, mode: "Failed", level: "critical", outcome: { label: "brain run", v: null }, authority: 1, error: String(e?.message ?? e).slice(0, 160) }); }
fs.writeFileSync("data/brains/index.json", JSON.stringify({ at: iso(NOW), brains: index }, null, 1));
