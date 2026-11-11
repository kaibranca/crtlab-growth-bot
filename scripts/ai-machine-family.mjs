// Page family (template) of a path — shared copy of ai-machine.mjs family(), so other machines can import it without running the AI machine.
// FAMILY = the page's template. Order matters: specific first.
const MKT = "xauusd|xagusd|eurusd|gbpusd|usdjpy|audusd|usdcad|usdchf|nzdusd|nas100|sp500|us30|ger40|usoil|btcusd|ethusd|solusd|gold|silver|oil|nasdaq|dax|bitcoin|ethereum|crypto|forex|stocks|[a-z]{1,5}";
const HUBS = new Set(["/backtest", "/pricing", "/features", "/faq", "/backtesting-software", "/market-replay-software", "/tradingview-bar-replay-alternative", "/daily-market-data", "/what-traders-backtest", "/week-ahead", "/economic-calendar", "/news", "/recap", "/tools", "/statistics", "/answers", "/blog", "/learn"]);
export function family(p) {
  if (p === "/" || HUBS.has(p)) return p; // the site's key pages are each their own family
  const s = p.split("/").filter(Boolean);
  if (s[0] === "news") return !s[1] ? "/news" : s.length > 2 ? "/news/<type>/<market>" : /\d{4}-\d{2}-\d{2}$/.test(s[1]) ? "/news/<release>" : "/news/<type>";
  if (s[0] === "recap") return !s[1] ? "/recap" : /^\d{4}-\d{2}-\d{2}$/.test(s[1]) ? "/recap/<date>" : "/recap/<market>";
  if (s[0] === "economic-calendar") return s[1] ? "/economic-calendar/<event>" : "/economic-calendar";
  if (s[0] === "tools") return !s[1] ? "/tools" : /statistics$/.test(s[1]) ? "/tools/<stats>" : /calculator$/.test(s[1]) ? "/tools/<calculator>" : "/tools/<tool>";
  if (["statistics", "answers", "reference", "blog", "learn", "indicators", "hub"].includes(s[0])) return s[1] ? `/${s[0]}/<page>` : `/${s[0]}`;
  if (s.length === 1 && /-challenge-simulator$/.test(s[0])) return "/<firm>-challenge-simulator";
  if (s.length === 1 && new RegExp(`^backtest-(${MKT})$`).test(s[0])) return "/backtest-<market>";
  // factory pages (11-10): one family per strategy, so the machine learns which strategy pages pay, across all markets
  { const m = new RegExp(`^(${MKT})-(fair-value-gaps|order-blocks|crt|previous-day-high-low|asian-range)$`).exec(s[0] ?? ""); if (s.length === 1 && m) return `/<market>-${m[2]}`; }
  if (s.length === 1 && new RegExp(`^(${MKT})-[a-z-]+$`).test(s[0]) && !/backtest|replay|software/.test(s[0])) return "/<market>-<concept>";
  if (s.length === 1 && /(backtester|backtesting|backtest)/.test(s[0])) return "/<strategy>-backtester";
  if (s.length === 1 && new RegExp(`^(${MKT})(ny)?$`).test(s[0])) return "/<market> (app)";
  return s.length === 1 ? "/<landing>" : `/${s[0]}/<page>`;
}
