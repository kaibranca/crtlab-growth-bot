// SHIELD — hourly. Reads Cloudflare's block log and BANS repeat attackers at the edge for 7 days (crtlab_banned list,
// enforced by the first custom WAF rule). Also flips "Under Attack" on during a flood and back off when it's quiet.
// Never bans shared networks (iCloud Private Relay / WARP / Apple): one bad user there would lock out thousands (10-31 lesson).
// PUBLIC REPO: only counts and salted hashes are written here; IPs live in the Cloudflare list and the alert email.
import fs from "node:fs";
import crypto from "node:crypto";

const T = process.env.CF_API_TOKEN, Z = process.env.CF_ZONE_ID, ACC = process.env.CF_ACCOUNT_ID, LIST = process.env.CF_BAN_LIST;
if (!T || !Z || !ACC || !LIST) { console.log("shield: no Cloudflare secrets, skip"); process.exit(0); }
const API = "https://api.cloudflare.com/client/v4", H = { Authorization: `Bearer ${T}`, "Content-Type": "application/json" };
const cf = async (path, opts = {}) => { const r = await fetch(API + path, { ...opts, headers: H }); const j = await r.json(); if (!j.success) throw new Error(path + " " + JSON.stringify(j.errors).slice(0, 300)); return j; };
const STATE = "data/shield.json", st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const hash = (x) => crypto.createHash("sha256").update((process.env.OPS_KEY || "") + x).digest("hex").slice(0, 12);

const SHARED_ASN = new Set([13335, 209242, 36183, 714, 6185]);   // Cloudflare WARP, iCloud Relay (Akamai), Apple
const BAN_DAYS = 7, MAX_NEW = 50;
// thresholds per IP in the last hour: scanner/WAF blocks are unambiguous; rate-limit trips mean login brute force
const SCORE = { firewallCustom: 1, firewallManaged: 1, ratelimit: 2 };
const BAN_AT = 6;

// 1. the last hour of blocks
const since = new Date(Date.now() - 65 * 60e3).toISOString();
const gq = `{viewer{zones(filter:{zoneTag:"${Z}"}){firewallEventsAdaptive(limit:10000,filter:{datetime_gt:"${since}",action_in:["block","challenge_failed","managed_challenge"]}){action clientIP clientAsn clientASNDescription source ruleId userAgent clientRequestPath}}}}`;
const g = await (await fetch(API + "/graphql", { method: "POST", headers: H, body: JSON.stringify({ query: gq }) })).json();
if (g.errors) throw new Error("graphql " + JSON.stringify(g.errors).slice(0, 300));
const ev = g.data.viewer.zones[0]?.firewallEventsAdaptive || [];

// 2. score IPs (blocks from the ban list itself don't count — they're already banned)
const banRule = st.banRuleId;
const per = new Map();
for (const e of ev) {
  if (e.ruleId && e.ruleId === banRule) continue;
  const s = SCORE[e.source]; if (!s) continue;
  const x = per.get(e.clientIP) || { n: 0, asn: e.clientAsn, org: e.clientASNDescription || "", src: {}, uas: new Set(), wp: 0, reqs: 0 }; x.n += s; x.src[e.source] = (x.src[e.source] || 0) + 1; x.uas.add(e.userAgent || ""); x.reqs++; if (/^\/(wp-|xmlrpc|\.env|\.git|cgi-bin|phpmyadmin|vendor\/phpunit)|\.php$/i.test(e.clientRequestPath || "")) x.wp++; per.set(e.clientIP, x);
}

// 3. current list: drop expired, collect what's already in
const items = []; let cursor = "";
do { const j = await cf(`/accounts/${ACC}/rules/lists/${LIST}/items${cursor ? `?cursor=${cursor}` : ""}`); items.push(...j.result); cursor = j.result_info?.cursors?.after || ""; } while (cursor);
const now = Date.now(), have = new Set(items.map((i) => i.ip));
const expired = items.filter((i) => { const m = /exp=([0-9T:.\-Z]+)/.exec(i.comment || ""); return m && Date.parse(m[1]) < now; });
if (expired.length) await cf(`/accounts/${ACC}/rules/lists/${LIST}/items`, { method: "DELETE", body: JSON.stringify({ items: expired.map((i) => ({ id: i.id })) }) });

// 4. new bans
const exp = new Date(now + BAN_DAYS * 864e5).toISOString();
const fresh = [...per.entries()].filter(([ip, x]) => x.n >= BAN_AT && !SHARED_ASN.has(x.asn) && !have.has(ip)).sort((a, b) => b[1].n - a[1].n).slice(0, MAX_NEW);
if (fresh.length) await cf(`/accounts/${ACC}/rules/lists/${LIST}/items`, { method: "POST",
  body: JSON.stringify(fresh.map(([ip, x]) => ({ ip, comment: `auto|${Object.entries(x.src).map(([k, v]) => `${k}:${v}`).join(",")}|asn=${x.asn}|exp=${exp}` }))) });

// 5. flood → Under Attack (JS check for everyone) ; quiet for 2 runs → back to medium
const total = ev.length, FLOOD = 4000;
const lvl = (await cf(`/zones/${Z}/settings/security_level`)).result.value;
let mode = lvl;
if (total >= FLOOD && lvl !== "under_attack") { await cf(`/zones/${Z}/settings/security_level`, { method: "PATCH", body: JSON.stringify({ value: "under_attack" }) }); mode = "under_attack"; st.attackSince = new Date().toISOString(); st.quiet = 0; }
else if (lvl === "under_attack" && st.attackSince) { st.quiet = total < FLOOD / 4 ? (st.quiet || 0) + 1 : 0;
  if (st.quiet >= 2) { await cf(`/zones/${Z}/settings/security_level`, { method: "PATCH", body: JSON.stringify({ value: "medium" }) }); mode = "medium"; delete st.attackSince; st.quiet = 0; } }

// 6. email ONLY when it matters to Kai (11-09: "only if it's a human ban"): a flood-mode change, or a ban on a network a PERSON
// could be on (home broadband / mobile). Cloud/hosting scanners are banned silently — they still count on the Growth board.
const HOSTING_ASN = new Set([14618, 16509, 8987, 15169, 396982, 19527, 8075, 8068, 14061, 16276, 24940, 63949, 20473, 51167, 45102, 37963,
  132203, 45090, 31898, 13335, 60781, 9009, 12876, 213230, 36352, 46606, 62567, 53667, 202425, 211252, 49981, 136787, 55286, 40021, 397423, 14627]);
const HOSTING_WORDS = /amazon|aws|google|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|choopa|contabo|alibaba|tencent|oracle|cloudflare|leaseweb|m247|scaleway|colocrossing|hostinger|hosting|host|server|cloud|data ?cent|datacamp|vps|dedicated|ionos|hostwinds|psychz|quadranet|frantech|ponynet|tzulo|serverion|hostroyale/i;
const SCRIPT_UA = /^$|go-http-client|python|curl|wget|libwww|okhttp|java\/|httpclient|axios|node-fetch|scrapy|zgrab|masscan|nuclei|nikto|sqlmap/i;
const scripted = (x) => [...(x.uas || [])].every((u) => SCRIPT_UA.test(u)) || (x.reqs >= 5 && x.wp === x.reqs);
const isHosting = (x) => HOSTING_ASN.has(x.asn) || HOSTING_WORDS.test(x.org || "") || scripted(x);
const humanBans = fresh.filter(([, x]) => !isHosting(x));
const changed = mode !== lvl;
if (fresh.length) console.log(`bans: ${fresh.length} (${fresh.length - humanBans.length} cloud/hosting, silent · ${humanBans.length} could be a person)`);
if ((humanBans.length || changed) && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const lines = [];
  if (changed) lines.push(mode === "under_attack" ? `FLOOD: ${total} blocked requests in the last hour. Cloudflare "Under Attack" mode is ON (every visitor gets a 5-second check). It turns off by itself after 2 quiet hours.` : `Flood over. Cloudflare is back to normal security.`);
  if (humanBans.length) lines.push(`Banned ${humanBans.length} IP(s) on a home/mobile network for ${BAN_DAYS} days (repeated exploit probes / login floods) — check it isn't a real user:\n` + humanBans.map(([ip, x]) => `  ${ip}  asn ${x.asn} ${x.org}  ${Object.entries(x.src).map(([k, v]) => `${k} ${v}`).join(", ")}`).join("\n") + (fresh.length > humanBans.length ? `\n(+${fresh.length - humanBans.length} cloud-server scanners banned silently)` : ""));
  lines.push(`To unban someone: Cloudflare → Manage Account → Configurations → Lists → crtlab_banned → delete the row.`);
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: changed && mode === "under_attack" ? "CRTLAB UNDER ATTACK — shield on" : changed ? "CRTLAB shield: flood over" : `CRTLAB shield: ${humanBans.length} possible person banned — check`, text: lines.join("\n\n") }) });
  console.log("emailed", r.status);
}

st.at = new Date().toISOString(); st.lastHour = { blocked: total, ips: per.size, banned: fresh.length, unbanned: expired.length, listSize: items.length - expired.length + fresh.length, mode };
st.history = [...(st.history || []), { at: st.at, blocked: total, banned: fresh.length }].slice(-24 * 14);
st.bannedHashes = [...new Set([...(st.bannedHashes || []), ...fresh.map(([ip]) => hash(ip))])].slice(-2000);
fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
console.log(`shield: ${total} blocks / ${per.size} IPs in the last hour · +${fresh.length} banned · −${expired.length} expired · mode ${mode}`);
