// SHIELD EXPLAIN (11-10) — read-only. For every IP the shield banned in the last HOURS (default 6): what it sent (blocked
// requests: path, method, rule source, UA) and whether the same IP ALSO browsed normally (a real trader's footprint: chart
// pages, /api/candles, 200s). PUBLIC REPO LOGS → the IP is printed only as the shield's salted hash (matches shield.json).
// Verdict: ATTACKER (only probes) / CHECK (probes + normal browsing → could be a real user behind it) — never unbans by itself.
import crypto from "node:crypto";
const T = process.env.CF_API_TOKEN, Z = process.env.CF_ZONE_ID, ACC = process.env.CF_ACCOUNT_ID, LIST = process.env.CF_BAN_LIST;
if (!T || !Z || !ACC || !LIST) { console.log("no Cloudflare secrets"); process.exit(0); }
const API = "https://api.cloudflare.com/client/v4", H = { Authorization: `Bearer ${T}`, "Content-Type": "application/json" };
const hash = (x) => crypto.createHash("sha256").update((process.env.OPS_KEY || "") + x).digest("hex").slice(0, 12);
const HOURS = +(process.env.HOURS || 6), since = new Date(Date.now() - (HOURS + 1) * 3.6e6).toISOString();
const gql = async (q) => { const j = await (await fetch(API + "/graphql", { method: "POST", headers: H, body: JSON.stringify({ query: q }) })).json(); if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300)); return j.data.viewer.zones[0]; };
const items = []; let cursor = "";
do { const j = await (await fetch(`${API}/accounts/${ACC}/rules/lists/${LIST}/items${cursor ? `?cursor=${cursor}` : ""}`, { headers: H })).json(); items.push(...(j.result || [])); cursor = j.result_info?.cursors?.after || ""; } while (cursor);
const recent = items.filter((i) => Date.now() - Date.parse(i.created_on) < HOURS * 3.6e6);
console.log(`${items.length} IPs on the ban list · ${recent.length} added in the last ${HOURS}h`);
for (const it of recent) {
  const ip = it.ip;
  console.log(`\n=== ${hash(ip)}  added ${it.created_on}  ${it.comment}`);
  const fw = await gql(`{viewer{zones(filter:{zoneTag:"${Z}"}){firewallEventsAdaptive(limit:60,orderBy:[datetime_ASC],filter:{datetime_gt:"${since}",clientIP:"${ip}"}){datetime action source clientRequestHTTPMethodName clientRequestPath clientRequestQuery userAgent clientCountryName clientASNDescription}}}}`);
  const ev = fw.firewallEventsAdaptive || [];
  if (ev[0]) console.log(`network: ${ev[0].clientASNDescription} · ${ev[0].clientCountryName} · UA: ${(ev[0].userAgent || "").slice(0, 110)}`);
  const paths = {}; for (const e of ev) { const k = `${e.action}/${e.source} ${e.clientRequestHTTPMethodName} ${e.clientRequestPath}${e.clientRequestQuery ? "?" + e.clientRequestQuery.slice(0, 60) : ""}`; paths[k] = (paths[k] || 0) + 1; }
  console.log(`blocked requests (${ev.length}):`); for (const [k, n] of Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(3)}× ${k}`);
  const ok = await gql(`{viewer{zones(filter:{zoneTag:"${Z}"}){httpRequestsAdaptiveGroups(limit:40,orderBy:[count_DESC],filter:{datetime_gt:"${new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19)}Z",clientIP:"${ip}"}){count dimensions{clientRequestPath edgeResponseStatus}}}}}`).catch((e) => ({ err: e.message }));
  const g = ok.httpRequestsAdaptiveGroups || [];
  const normal = g.filter((x) => x.dimensions.edgeResponseStatus < 400);
  const human = normal.filter((x) => /^\/(backtester|api\/candles|api\/auth|account|xauusd|nas100|eurusd|[a-z0-9]+$)/.test(x.dimensions.clientRequestPath));
  console.log(`all requests from this IP, 7 days (top): ${ok.err ? "n/a " + ok.err.slice(0, 100) : ""}`); for (const x of g.slice(0, 20)) console.log(`  ${String(x.count).padStart(4)}× ${x.dimensions.edgeResponseStatus} ${x.dimensions.clientRequestPath}`);
  console.log(`VERDICT: ${human.length ? "CHECK — this IP also browsed normally (" + human.reduce((t, x) => t + x.count, 0) + " ok requests to app/chart pages): could be a real user behind a shared/infected connection" : "ATTACKER — no normal browsing, only blocked probes"}`);
}
