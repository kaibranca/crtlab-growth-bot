// engine/guard/jobs-lib.mjs — did each machine DO ITS JOB, and are the machines reading the TRUTH? Pure, tested.
// v1/v2 lesson: the core said "37/37 ok" — that only meant no script crashed. A reel that never posted, a sitemap Google
// never fetched, a north star counting the wrong rows all looked "ok". Every check here compares an OUTCOME (or an input)
// with independent evidence. Result per check: ok | fail | unknown (evidence missing — said plainly, never assumed ok).
const H = 3.6e6;
const res = (id, job, state, detail) => ({ id, job, state, detail });

// ── JOBS (outcomes) ──────────────────────────────────────────────────────────────────────────────────────────────────

// Daily data must be live (end ≥ due) by 07:10 UTC. Before 07:10 an old day is expected, not a failure.
export function checkData(dv, now) {
  if (!dv || !dv.end || !dv.due) return res("data-live", "daily data pull", "unknown", "crtlab.pro/api/data-version unreadable");
  const t = new Date(now), m = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (dv.end >= dv.due) return res("data-live", "daily data pull", "ok", `live ${dv.live} through ${dv.end}`);
  return m < 7 * 60 + 10 ? res("data-live", "daily data pull", "ok", `release window: through ${dv.end}, ${dv.due} due at 07:00`)
    : res("data-live", "daily data pull", "fail", `site data through ${dv.end}, should be ${dv.due}`);
}

// Every reel slot whose time passed > 25 min ago has a posted id in the log (per platform).
export function checkReels(plan, log, now) {
  if (!plan || !Array.isArray(plan.reels)) return res("reels-posted", "reels posting", "unknown", "no plan for today");
  const due = [], missing = [];
  for (const r of plan.reels) for (const plat of ["ig", "fb"]) {
    const at = r?.[plat]?.at; if (!at || now - Date.parse(at) < 25 * 60e3) continue;
    due.push(`${plat}#${r.k}`);
    if (!log.some((l) => l.plan === plan.date && l.k === r.k && l.plat === plat && l.id)) missing.push(`${plat}#${r.k} (${at.slice(11, 16)})`);
  }
  if (!due.length) return res("reels-posted", "reels posting", "ok", "no slot due yet today");
  return missing.length ? res("reels-posted", "reels posting", "fail", `not posted: ${missing.join(", ")}`) : res("reels-posted", "reels posting", "ok", `${due.length}/${due.length} due slots posted`);
}

// IndexNow: no rejected batch in the last 24 h (a non-200 means Bing never got those pages).
export function checkIndexNow(rows, now) {
  const day = rows.filter((r) => now - Date.parse(r.at) < 24 * H);
  const bad = day.filter((r) => !/^HTTP 20\d$/.test(r.status ?? ""));
  if (bad.length) return res("indexnow", "IndexNow submits", "fail", `${bad.length} rejected batch(es) in 24 h: ${bad[0].status}`);
  return res("indexnow", "IndexNow submits", "ok", `${day.reduce((a, r) => a + (r.submitted ?? 0), 0)} URLs accepted in 24 h`);
}

// Sitemap: submitted OK within 30 h, 0 errors, and Google actually FETCHED it within 7 days of the submit.
// (GSC's sitemap "indexed" count is a dead API field — always 0 — so it is never read as coverage. See checkDeadFields.)
export function checkSitemap(s, now) {
  if (!s?.at) return res("sitemap", "sitemap → Google", "unknown", "no sitemap state");
  if (now - Date.parse(s.at) > 30 * H) return res("sitemap", "sitemap → Google", "fail", `last check ${Math.round((now - Date.parse(s.at)) / H)} h ago`);
  const main = (s.sitemaps ?? [])[0];
  if (s.submit !== "ok" || !main) return res("sitemap", "sitemap → Google", "fail", `submit ${s.submit ?? "missing"}`);
  if (main.errors > 0) return res("sitemap", "sitemap → Google", "fail", `${main.errors} sitemap errors in Search Console`);
  const fetched = main.downloaded ? Date.parse(main.downloaded) : null;
  if (!fetched && now - Date.parse(s.firstSubmitted ?? s.at) > 7 * 24 * H) return res("sitemap", "sitemap → Google", "fail", "Google has not fetched the sitemap 7 days after submit");
  return res("sitemap", "sitemap → Google", "ok", `Google fetched ${main.downloaded?.slice(0, 16) ?? "not yet (pending)"}, 0 errors`);
}

// The core itself ran: hourly < 2 h, daily < 26 h.
export function checkCore(steps, now) {
  const h = steps?.hourly?.at, d = steps?.daily?.at;
  if (!h) return res("core", "engine core", "unknown", "no steps.json");
  const ah = (now - Date.parse(h)) / H, ad = d ? (now - Date.parse(d)) / H : null;
  if (ah > 2) return res("core", "engine core", "fail", `hourly last ran ${ah.toFixed(1)} h ago`);
  if (ad == null || ad > 26) return res("core", "engine core", "fail", `daily last ran ${ad == null ? "never" : ad.toFixed(1) + " h"} ago`);
  return res("core", "engine core", "ok", `hourly ${ah.toFixed(1)} h, daily ${ad.toFixed(1)} h ago`);
}

// ── TRUTH (inputs) ───────────────────────────────────────────────────────────────────────────────────────────────────

// The analytics DB is LIVE, not a frozen snapshot (the 08-25 Neon trap: the old role still connected, data 2 days stale).
export function checkDbLive(maxCreatedAt, now) {
  if (!maxCreatedAt) return res("truth-db-live", "analytics DB is live", "unknown", "no DB reading");
  const age = (now - Date.parse(maxCreatedAt)) / H;
  return age > 12 ? res("truth-db-live", "analytics DB is live", "fail", `newest guest row ${age.toFixed(1)} h old — snapshot or dead tracking?`)
    : res("truth-db-live", "analytics DB is live", "ok", `newest guest row ${age.toFixed(1)} h old`);
}

// The north star the machines steer by (works last7) agrees with an independent count of new users (±15 %, ±5 floor).
export function checkNorthStar(worksLast7, dbUsers7) {
  if (worksLast7 == null || dbUsers7 == null) return res("truth-north-star", "north star counts real accounts", "unknown", "missing reading");
  const tol = Math.max(5, 0.15 * dbUsers7), diff = worksLast7 - dbUsers7;
  return Math.abs(diff) > tol ? res("truth-north-star", "north star counts real accounts", "fail", `works says ${worksLast7}, users table says ${dbUsers7} new accounts in 7 d`)
    : res("truth-north-star", "north star counts real accounts", "ok", `works ${worksLast7} vs users ${dbUsers7}`);
}

// Source attribution: when most real visitors have no source, every per-source decision is blind.
export function checkAttribution(direct, total) {
  if (!total) return res("truth-attribution", "visitor sources are known", "unknown", "no visitors");
  const share = direct / total;
  return share > 0.6 ? res("truth-attribution", "visitor sources are known", "fail", `${Math.round(share * 100)}% of real visitors have no source (direct/none) — per-source visitor numbers are blind`)
    : res("truth-attribution", "visitor sources are known", "ok", `${Math.round(share * 100)}% unattributed`);
}

// Buyers are THE outcome. If the WATCH can't read them (no key, Stripe refused, stale file) the engine is blind on money — FAIL.
export function checkBuyers(drops, now) {
  if (!drops?.at) return res("truth-buyers", "new buyers are measured", "unknown", "no data/engine/drops.json yet");
  const ageH = (now - Date.parse(drops.at)) / 36e5, b = drops.metrics?.["buyers.new"];
  if (ageH > 30) return res("truth-buyers", "new buyers are measured", "fail", `WATCH is ${ageH.toFixed(0)} h old`);
  if (!b || b.level === "unknown") return res("truth-buyers", "new buyers are measured", "fail", `buyers unknown — ${b?.why ?? "metric missing"}`);
  return res("truth-buyers", "new buyers are measured", "ok", `level ${b.level}`);
}

export function summarise(checks) {
  const fail = checks.filter((c) => c.state === "fail"), unknown = checks.filter((c) => c.state === "unknown");
  return { ok: checks.length - fail.length - unknown.length, fail: fail.length, unknown: unknown.length, of: checks.length };
}
