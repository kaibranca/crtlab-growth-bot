// LIVE HEADLINES (11-07) → data/events/headlines.json for crtlab.pro/economic-calendar's news panel. Public RSS only
// (headline + link back to the source, which is what RSS is published for): FXStreet news, the Fed, the ECB, the Bank
// of England. Kept to what CRTLAB traders trade (gold, USD/EUR/GBP/JPY/AUD, indices, oil, central banks, big data).
// Hourly; rewritten only when a new headline lands.
import fs from "node:fs";
const OUT = "data/events/headlines.json";
const FEEDS = [
  ["FXStreet", "https://www.fxstreet.com/rss/news"],
  ["Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"],
  ["ECB", "https://www.ecb.europa.eu/rss/press.html"],
  ["Bank of England", "https://www.bankofengland.co.uk/rss/news"],
];
const OFF = /taiwan|rupiah|ringgit|peso|rupee|\bwon\b|yuan|lira|\brand\b|zloty|forint|koruna|krona|krone|baht|\breal\b/i;
const RELEVANT = /gold|xau|silver|us dollar|dxy|usd|euro|eur\b|eur\/|pound|sterling|gbp|yen|jpy|aussie|aud|nasdaq|s&p|dow|stocks|oil|wti|brent|fed\b|fomc|powell|ecb|lagarde|boe|bailey|boj|ueda|rba|cpi|inflation|payroll|nfp|jobs|gdp|pmi|rate|yield|treasur|bitcoin|crypto/i;
const strip = (s) => (s ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const items = [];
for (const [src, url] of FEEDS) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (crtlab-growth-bot; +https://crtlab.pro)" } });
    if (!r.ok) { console.log(src, r.status); continue; }
    const xml = await r.text();
    for (const m of xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/g)) {
      const x = m[2], title = strip(x.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]);
      const link = strip(x.match(/<link>([\s\S]*?)<\/link>/)?.[1]) || x.match(/<link[^>]*href="([^"]+)"/)?.[1] || "";
      const t = Date.parse(strip(x.match(/<(pubDate|updated|published|dc:date)>([\s\S]*?)<\/\1>/)?.[2]));
      if (!title || !link.startsWith("http") || !Number.isFinite(t)) continue;
      if (src === "FXStreet" && (!RELEVANT.test(title) || OFF.test(title))) continue;
      items.push({ t, title: title.slice(0, 180), url: link, src });
    }
  } catch (e) { console.log(src, "fail", String(e).slice(0, 80)); }
}
if (!items.length) { console.log("no headlines — kept the old file"); process.exit(0); }
const list = [...new Map(items.map((x) => [x.url, x])).values()].sort((a, b) => b.t - a.t).slice(0, 40);
const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
if (old && JSON.stringify(old.items.map((x) => x.url)) === JSON.stringify(list.map((x) => x.url))) { console.log("headlines unchanged"); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify({ changed: new Date().toISOString(), items: list }));
console.log("headlines", list.length, "· newest:", list[0].src, "-", list[0].title.slice(0, 70));
