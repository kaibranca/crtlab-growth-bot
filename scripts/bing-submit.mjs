// Push key pages straight into Bing's index (ChatGPT search reads Bing). 11-10: ChatGPT→/backtest fell 263→33 after the
// 10-24 "paid only" copy; the site says free again, Bing must re-read it. Usage: node scripts/bing-submit.mjs (URLS env = extra, comma list)
const KEY = process.env.BING_API_KEY, SITE = "https://crtlab.pro";
const PATHS = ["/backtest", "/", "/pricing", "/faq", "/features", "/backtesting-software", "/market-replay-software", "/tradingview-bar-replay-alternative",
  "/candle-by-candle-replay", "/prop-firm-backtesting", "/multi-chart-backtesting", "/real-volume-backtesting", "/daily-market-data", "/review-your-trading-week",
  "/backtest-gold", "/backtest-nas100", "/backtest-us30", "/backtest-bitcoin", "/backtest-dax", "/backtest-oil", "/backtest-sp500", "/forex-backtesting-software",
  "/crt-strategy-backtester", "/footprint-chart-backtesting", "/smt-divergence-backtester", "/volume-profile-backtester", "/ict-backtesting-tool", "/smc-backtesting",
  "/fair-value-gap-backtester", "/order-block-backtester", "/liquidity-sweep-backtester", "/market-structure-backtester", "/order-flow-backtesting",
  "/tools/crt-statistics", "/economic-calendar", "/answers", "/llms.txt", "/llms-full.txt", "/blog/backtest-yesterdays-market"];
const urlList = [...PATHS, ...(process.env.URLS || "").split(",").filter(Boolean)].map((p) => SITE + p);
const api = (m) => `https://ssl.bing.com/webmaster/api.svc/json/${m}?apikey=${KEY}`;
const q = await (await fetch(api("GetUrlSubmissionQuota") + `&siteUrl=${encodeURIComponent(SITE + "/")}`)).text();
console.log("quota before:", q);
const r = await fetch(api("SubmitUrlBatch"), { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ siteUrl: SITE + "/", urlList: urlList.slice(0, 100) }) });
console.log("SubmitUrlBatch", r.status, await r.text(), urlList.length, "urls");
// 11-13 SITEMAP: Google had none submitted — make sure Bing has the sitemap too (Bing feeds ChatGPT search). Idempotent.
const feeds = await (await fetch(api("GetFeeds") + `&siteUrl=${encodeURIComponent(SITE + "/")}`)).json().catch((e) => ({ err: String(e) }));
const have = (feeds.d ?? []).map((f) => f.Url);
console.log("Bing feeds:", JSON.stringify((feeds.d ?? []).map((f) => ({ url: f.Url, status: f.Status, urls: f.UrlCount, crawled: f.LastCrawled }))) || JSON.stringify(feeds).slice(0, 200));
if (!have.some((u) => /crtlab\.pro\/sitemap\.xml$/.test(u))) {
  const s = await fetch(api("SubmitFeed"), { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ siteUrl: SITE + "/", feedUrl: SITE + "/sitemap.xml" }) });
  console.log("SubmitFeed sitemap.xml", s.status, (await s.text()).slice(0, 200));
}
