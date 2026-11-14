// SHIELD — hourly. Reads Cloudflare's block log and BANS repeat attackers at the edge for 7 days (crtlab_banned list,
// enforced by the first custom WAF rule). Also flips "Under Attack" on during a flood and back off when it's quiet.
// Never bans shared networks (iCloud Private Relay / WARP / Apple): one bad user there would lock out thousands (10-31 lesson).
// PUBLIC REPO: only counts and salted hashes are written here; IPs live in the Cloudflare list and the alert email.
import "./mailguard.mjs";
import fs from "node:fs";
import crypto from "node:crypto";

const T = process.env.CF_API_TOKEN, Z = process.env.CF_ZONE_ID, ACC = process.env.CF_ACCOUNT_ID, LIST = process.env.CF_BAN_LIST;
if (!T || !Z || !ACC || !LIST) { console.log("shield: no Cloudflare secrets, skip"); process.exit(0); }
const API = "https://api.cloudflare.com/client/v4", H = { Authorization: `Bearer ${T}`, "Content-Type": "application/json" };
const cf = async (path, opts = {}) => { const r = await fetch(API + path, { ...opts, headers: H }); const j = await r.json(); if (!j.success) throw new Error(path + " " + JSON.stringify(j.errors).slice(0, 300)); return j; };
const STATE = "data/shield.json", st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const hash = (x) => crypto.createHash("sha256").update((process.env.OPS_KEY || "") + x).digest("hex").slice(0, 12);

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
// the cloud-crawler rule (11-11: Huawei/Tencent/Alibaba headless crawlers get a challenge) is a FILTER working, not an
// attack — its events are counted on their own and never score an IP or the flood total (truth rule)
const CRAWLER_RULE = "6ada962bdf364810b175d41c8f427012", crawlerEv = ev.filter((e) => e.ruleId === CRAWLER_RULE);
const per = new Map();
for (const e of ev) {
  // 11-12: the homepage flood challenge is a CHALLENGE, never ban evidence — it banned the owner's own home IP (7 test hits)
  if (e.ruleId && (e.ruleId === banRule || e.ruleId === CRAWLER_RULE || e.ruleId === "24a2d4af18f843f1a86340aeb2f581a4")) continue;
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
// 11-14: eligibility is one tested rule (shield-lib) — never shared networks, never search / AI crawlers; HANDS gate fails closed
const { banEligible } = await import("./shield-lib.mjs"), { handsOn } = await import("./hands.mjs"), HANDS = handsOn("shield");
const spared = [...per.entries()].filter(([ip, x]) => x.n >= BAN_AT && !have.has(ip) && !banEligible(x, { banAt: BAN_AT }).ban);
if (spared.length) console.log(`shield: spared ${spared.length} over-threshold IP(s):`, spared.slice(0, 5).map(([ip, x]) => `${ip} (${banEligible(x, { banAt: BAN_AT }).why})`).join(", "));
const fresh = HANDS ? [...per.entries()].filter(([ip, x]) => banEligible(x, { banAt: BAN_AT, already: have.has(ip) }).ban).sort((a, b) => b[1].n - a[1].n).slice(0, MAX_NEW) : [];
if (!HANDS) console.log("shield: HANDS OFF — no new bans (expired ones are still lifted)");
if (fresh.length) await cf(`/accounts/${ACC}/rules/lists/${LIST}/items`, { method: "POST",
  body: JSON.stringify(fresh.map(([ip, x]) => ({ ip, comment: `auto|${Object.entries(x.src).map(([k, v]) => `${k}:${v}`).join(",")}|asn=${x.asn}|exp=${exp}` }))) });

// 5. flood → Under Attack (JS check for everyone) ; quiet for 2 runs → back to medium
const floodRuleEv = ev.filter((e) => e.ruleId === "24a2d4af18f843f1a86340aeb2f581a4").length; // 11-12 homepage challenge: judged on its own below
const total = ev.length - crawlerEv.length - floodRuleEv, FLOOD = 4000; // attacks only
const lvl = (await cf(`/zones/${Z}/settings/security_level`)).result.value;
let mode = lvl;
// LOCK-IN (core.mjs): a wave of real people is arriving — "Under Attack" would put a 5-second check on every one of them,
// so it needs 3× the flood while lock-in is on (bans and WAF rules still work as normal)
const LOCKED = false; // 11-14: lock-in retired — it was stuck on and blocked flood protection
if (total >= FLOOD * (LOCKED ? 3 : 1) && lvl !== "under_attack") { await cf(`/zones/${Z}/settings/security_level`, { method: "PATCH", body: JSON.stringify({ value: "under_attack" }) }); mode = "under_attack"; st.attackSince = new Date().toISOString(); st.quiet = 0; }
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

// FLOOD-RULE JUDGE (11-12): the homepage managed challenge (cookieless, no referer, US/CN/GB/CA, AI/search crawlers exempt)
// must cost no real people. EYES: challenges it issued vs SOLVED (a solve = a real browser) per hour, the humans self-check
// (homepage raw hits vs normal), and AI clicks landing on "/" (data/ai/clicks-hourly.json) before vs since the rule.
// HANDS: AI clicks on "/" below 40 % of their pre-rule rate over ≥ 24 h (with ≥ 6 before), or more than half the challenged
// solving it (people, not bots) → the rule is DISABLED by itself + a loss in the ledger. Judged once; re-enabling is a decision.
{
  const FR = (st.floodRule ??= { id: "24a2d4af18f843f1a86340aeb2f581a4", since: "2026-11-12T14:30:00Z", hours: [] });
  if (FR.state !== "disabled") try {
    // free plan: no grouped firewall dataset — the raw event list (the same one the bans read) counted per action
    const q2 = `{viewer{zones(filter:{zoneTag:"${Z}"}){firewallEventsAdaptive(limit:10000,filter:{datetime_gt:"${since}",ruleId:"${FR.id}"}){action}}}}`;
    const r2 = await (await fetch(API + "/graphql", { method: "POST", headers: H, body: JSON.stringify({ query: q2 }) })).json();
    if (r2.errors) throw new Error("graphql " + JSON.stringify(r2.errors).slice(0, 120));
    const evs = r2.data?.viewer?.zones?.[0]?.firewallEventsAdaptive ?? [], issued = evs.filter((e) => e.action === "managed_challenge").length, solved = evs.filter((e) => /solved|bypassed/.test(e.action)).length;
    const HUm = (() => { try { return JSON.parse(fs.readFileSync("data/machines/humans.json", "utf8")); } catch { return {}; } })();
    const home = (HUm.selfCheck?.rawSurge ?? []).find((x) => x.dim === "landing" && x.seg === "home");
    FR.hours = [...FR.hours, { at: new Date().toISOString(), issued, solved, homeRaw24: home?.raw24 ?? null, homeNormal: home?.rawNormal ?? null }].slice(-24 * 14);
    const CH = (() => { try { return JSON.parse(fs.readFileSync("data/ai/clicks-hourly.json", "utf8")).rows ?? {}; } catch { return {}; } })();
    const t0 = Date.parse(FR.since), onHome = (from, to) => Object.entries(CH).filter(([k]) => { const [h, eng, path] = k.split("|"), t = Date.parse(h + ":00:00Z"); return path === "/" && eng !== "bing" && eng !== "google" && t >= from && t < to; }).reduce((n, [, v]) => n + (v[0] ?? 0), 0);
    const hrsSince = (Date.now() - t0) / 3.6e6, before = onHome(t0 - 48 * 3.6e6, t0), after = onHome(t0, Date.now());
    const sumI = FR.hours.reduce((n, x) => n + x.issued, 0), sumS = FR.hours.reduce((n, x) => n + x.solved, 0);
    FR.read = { hrsSince: +hrsSince.toFixed(1), aiHomeClicksBefore48h: before, aiHomeClicksSince: after, issued: sumI, solved: sumS, solveShare: sumI ? +(sumS / sumI).toFixed(2) : null, homeRaw24: home?.raw24 ?? null, homeNormal: home?.rawNormal ?? null };
    const clicksLost = hrsSince >= 24 && before >= 6 && after / Math.min(hrsSince, 48) < 0.4 * (before / 48);
    const peopleHit = sumI >= 40 && sumS / sumI > 0.5;
    if (clicksLost || peopleHit) {
      await cf(`/zones/${Z}/rulesets/${(await cf(`/zones/${Z}/rulesets/phases/http_request_firewall_custom/entrypoint`)).result.id}/rules/${FR.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
      FR.state = "disabled"; FR.why = clicksLost ? `AI clicks on / fell ${before}→${after} since the rule` : `${sumS} of ${sumI} challenged visitors solved it — people, not bots`;
      fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: new Date().toISOString(), key: `shield|floodrule|off`, machine: "shield", kind: "loss", what: `homepage flood challenge DISABLED by itself: ${FR.why}` }) + "\n");
      console.log("shield: flood rule DISABLED — " + FR.why);
    } else if (hrsSince >= 72 && !FR.verdict) {
      FR.verdict = "kept"; fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: new Date().toISOString(), key: `shield|floodrule|kept`, machine: "shield", kind: "win", what: `homepage flood challenge kept after 3 days: ${sumI} challenged, ${sumS} solved; AI clicks on / ${before} (48 h before) → ${after} since; home raw ${home?.raw24 ?? "?"}/24 h vs ~${home?.rawNormal ?? "?"}` }) + "\n");
    }
    console.log(`shield: flood rule ${FR.state ?? "on"} · ${issued} challenged / ${solved} solved this hour · AI clicks on / ${before} (48 h before) → ${after} in ${hrsSince.toFixed(0)} h`);
  } catch (e) { console.log("shield: flood-rule judge skipped — " + String(e.message || e).slice(0, 120)); }
}
st.at = new Date().toISOString(); st.lastHour = { crawlersChallenged: crawlerEv.length, blocked: total, ips: per.size, banned: fresh.length, unbanned: expired.length, listSize: items.length - expired.length + fresh.length, mode };
st.history = [...(st.history || []), { at: st.at, blocked: total, banned: fresh.length }].slice(-24 * 14);
st.bannedHashes = [...new Set([...(st.bannedHashes || []), ...fresh.map(([ip]) => hash(ip))])].slice(-2000);
fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
console.log(`shield: ${total} blocks / ${per.size} IPs in the last hour · +${fresh.length} banned · −${expired.length} expired · mode ${mode}`);
