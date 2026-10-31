// HOURLY: does the money path work for a real visitor, and can every AI crawler read the site?
// Writes data/watchdog/<month>.jsonl; exits 1 on any failure so GitHub emails the owner.
import { SITE, get, append, month, now } from "./lib.mjs";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const BOT = (n) => `Mozilla/5.0 (compatible; ${n}; +https://example.com/bot)`;
const checks = [
  ["home", "/", UA, (r) => r.body.includes("CRTLAB")],
  ["backtest page", "/backtest", UA, (r) => r.body.includes("CRTLAB")],
  ["pricing", "/pricing", UA, (r) => r.status === 200],
  ["chart app", "/backtester", UA, (r) => r.status === 200],
  ["statistics", "/statistics/nas100", UA, (r) => r.body.includes("Statistics")],
  ["calculator", "/tools/position-size-calculator", UA, (r) => r.status === 200],
  ["candles API", "/api/candles?pair=nas100&tf=1hour&limit=50&v=q8", UA, (r) => { try { return JSON.parse(r.body).candles.length > 0; } catch { return false; } }],
  ["llms.txt", "/llms.txt", UA, (r) => r.body.includes("CRTLAB")],
  ["robots.txt", "/robots.txt", UA, (r) => r.body.includes("GPTBot")],
  ["sitemap", "/sitemap.xml", UA, (r) => (r.body.match(/<loc>/g) || []).length >= 200],
  ...["GPTBot/1.1", "OAI-SearchBot/1.0", "ChatGPT-User/1.0", "ClaudeBot/1.0", "PerplexityBot/1.0", "Googlebot/2.1", "bingbot/2.0", "Applebot/0.1"].map((b) => [`AI: ${b.split("/")[0]}`, "/backtest", BOT(b), (r) => r.status === 200]),
];
const results = [];
for (const [name, path, ua, ok] of checks) {
  const r = await get(SITE + path + (path.includes("?") ? "&" : "?") + "wd=" + Date.now(), { headers: { "user-agent": ua } });
  results.push({ name, path, status: r.status, ms: r.ms, ok: r.status >= 200 && r.status < 400 && ok(r) });
}
const failed = results.filter((r) => !r.ok);
append(`data/watchdog/${month()}.jsonl`, { at: now().toISOString(), ok: !failed.length, results });
console.table(results);
if (failed.length) { console.error("FAILED:", failed.map((f) => `${f.name} (${f.status})`).join(", ")); process.exitCode = 1; }
