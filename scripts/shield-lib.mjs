// SHIELD rules (pure, tested in test/shield-lib.test.mjs). A 7-day edge ban is the strongest hand any machine has:
// a wrong one locks out Google / Bing / ChatGPT (de-indexing, lost AI answers) or a real person (11-12: Kai's own IP).
// Not banning is always the safe direction: the WAF rules still block bad requests one by one.
export const SHARED_ASN = new Set([13335, 209242, 36183, 714, 6185]); // Cloudflare WARP, iCloud Relay (Akamai), Apple — many people share one IP
// Search + AI crawlers. Any matching user agent on an IP = never banned (a spoofer only escapes the ban, not the per-request block).
export const CRAWLER_UA = /googlebot|google-inspectiontool|googleother|google-extended|storebot-google|apis-google|adsbot|mediapartners-google|bingbot|adidxbot|msnbot|bingpreview|gptbot|chatgpt-user|oai-searchbot|perplexity|claudebot|claude-user|claude-searchbot|anthropic|applebot|duckduckbot|yandex|baiduspider|petalbot|amazonbot|meta-externalagent|facebookexternalhit|linkedinbot|twitterbot/i;
// The SAME network key the site stores per visitor (crtlab-standalone lib/tokens-fingerprint.ts ipPrefix): IPv4 /24, IPv6 /48.
export function ipPrefix(ip) {
  if (!ip) return null;
  if (ip.includes(":")) { const p = ip.split(":").filter(Boolean); return p.length < 3 ? null : p.slice(0, 3).join(":") + "::/48"; }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\./.exec(ip); return m ? `${m[1]}.${m[2]}.${m[3]}.0/24` : null;
}
// 11-14: the shield judged IPs only by Cloudflare events and then emailed Kai "check it isn't a real user". The analytics DB
// KNOWS real users: `users` = network prefixes of real visitors (replayed or signed up) + logged-in sessions, 90 days.
// A network a real user is on is never banned (spared, logged); others are banned silently — no human check needed.
export function banEligible(x, { banAt, already = false, ip = null, users = null }) {
  if (already || x.n < banAt) return { ban: false, why: already ? "already banned" : "below threshold" };
  if (users && ip && users.has(ipPrefix(ip))) return { ban: false, why: "a real user's network (analytics)" };
  if (SHARED_ASN.has(x.asn)) return { ban: false, why: "shared network (many people per IP)" };
  if ([...(x.uas || [])].some((u) => CRAWLER_UA.test(u || ""))) return { ban: false, why: "search / AI crawler" };
  return { ban: true };
}
