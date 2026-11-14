// engine/lib/external.mjs — things OUTSIDE CRTLAB that move traffic. Research 11-14: in before/after reads on small sites the
// main threat is external — algorithm updates, seasonality. Google publishes its ranking updates (core / spam) as JSON on
// the Search Status Dashboard. 11-14 finding: the November 2026 core update began 11-10 (rollout ≤ 2 weeks) — exactly under
// the Google-visitors DROP and the freeze verdict day, and no machine knew; the August spam update (08-18→21) sits 3 days
// before the 08-24 crash that was blamed on guest mode alone.
const URL = "https://status.search.google.com/incidents.json";
// → [{ begin, end (null = ongoing), what }] for ranking incidents, or null when unreadable (never "no updates" by default)
export async function googleUpdates({ since = "2026-01-01" } = {}) {
  try {
    const r = await fetch(URL, { headers: { "User-Agent": "crtlab-bot engine" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const a = await r.json();
    return a.filter((i) => (i.begin || "") >= since && /update|ranking/i.test(`${i.external_desc} ${i.service_name ?? ""}`))
      .map((i) => ({ begin: i.begin, end: i.end ?? null, what: i.external_desc }));
  } catch { return null; }
}
// events overlapping [from, to] (ymd); an ongoing update overlaps everything after its begin. Rollouts are treated as
// lasting at least 14 days when still open (Google: "may take up to 2 weeks").
export function overlapping(events, from, to) {
  return (events ?? []).filter((e) => { const b = e.begin.slice(0, 10), en = (e.end ?? new Date(Date.parse(e.begin) + 14 * 864e5).toISOString()).slice(0, 10);
    return b <= to && (e.end ? en : "9999") >= from; });
}
