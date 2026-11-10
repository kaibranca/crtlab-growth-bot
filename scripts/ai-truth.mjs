// AI MACHINE — TRUTH GATE (11-10). On 10-24 one copy change ("paid only, free sample") made ChatGPT stop recommending
// /backtest: 260 → 65 real visitors per two weeks. Assistants recommend what every page agrees on, so this reads the pages
// they read most — as ChatGPT-User, from the live site — every 6 hours and checks the facts are identical everywhere:
//   MUST say  (on the pages that carry the price): free every day · 2,000 candles a day · $14.99 a month · $99 once
//   MUST NOT  say anywhere: paid only · free sample · weekly allowance · no free plan · "CRTLAB Pro" (renamed Unlimited 11-09)
// A failure emails Kai once per problem per day and is written to data/ai/truth.json (the machine shows it on the plan).
// Learns nothing by itself — it is the gate that protects everything the machine learns.
import fs from "node:fs";
import { SITE } from "./lib.mjs";
const F = "data/ai/truth.json", prev = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, "utf8")) : {};
if (prev.at && Date.now() - Date.parse(prev.at) < 6 * 3.6e6 - 120e3 && !process.env.FORCE) { console.log("truth gate: checked", prev.at, "· next in ≤6h"); process.exit(0); }
const UA = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot";
const PRICE_PAGES = ["/", "/pricing", "/llms.txt", "/faq", "/backtest"];
const PAGES = [...PRICE_PAGES, "/features", "/llms-full.txt", "/daily-market-data", "/tradingview-bar-replay-alternative", "/backtesting-software", "/market-replay-software", "/best-backtesting-software", "/crt-strategy-backtester", "/backtest-gold", "/backtest-nas100"];
const MUST = [[/free every day|free, every day|free plan you can use every day/i, "says it's free every day"], [/2,000 (free )?candles/i, "2,000 candles a day"], [/\$14\.99/, "$14.99 a month"], [/\$99\b/, "$99 once"]];
const NEVER = [[/paid[- ]only/i, "paid only"], [/free sample/i, "free sample"], [/weekly (free )?allowance/i, "weekly allowance"], [/no free (plan|tier)/i, "no free plan"], [/\bCRTLAB Pro\b/, "CRTLAB Pro (old name)"]];
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const problems = [], checked = {};
for (const p of PAGES) {
  const r = await fetch(SITE + p, { headers: { "user-agent": UA } }).catch(() => null);
  if (!r || r.status !== 200) { problems.push(`${p}: HTTP ${r?.status ?? "unreachable"} for ChatGPT`); continue; }
  const t = text(await r.text()); checked[p] = t.length;
  // a page may QUOTE an old claim to correct it ("…is outdated", "no longer exists") — that helps the assistants, not a problem
  for (const [re, what] of NEVER) { const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"); let m; while ((m = g.exec(t))) { const near = t.slice(Math.max(0, m.index - 200), m.index + 200); if (/outdated|no longer|not true|is wrong|was wrong|used to|formerly|since 6 November/i.test(near)) continue; break; } if (m) problems.push(`${p}: says "${what}" — "…${t.slice(Math.max(0, m.index - 60), m.index + 60).trim()}…"`); }
  if (PRICE_PAGES.includes(p)) for (const [re, what] of MUST) if (!re.test(t)) problems.push(`${p}: missing "${what}"`);
  // 11-10: the daily data date must be current wherever it is stated (llms.txt said "2 November" for an hour after a deploy).
  // Session markets: Friday's data stands until Tuesday morning, plus a holiday → stale only when > 5 days old.
  { const m = /Data through (?:\w+day, )?(\d{1,2} \w+ \d{4})/i.exec(t) || /through (?:\w{3} )?(\d{1,2} \w{3,9})(?: (\d{4}))?/i.exec(t);
    if (m && /llms|^\/$|daily-market-data|backtest$/.test(p)) { const d = Date.parse(m[1].includes(" 20") ? m[1] : `${m[1]} ${new Date().getUTCFullYear()}`);
      if (Number.isFinite(d) && Date.now() - d > 5.5 * 86_400_000) problems.push(`${p}: says data through ${m[1]} — stale (contradicts the daily update)`); } }
}
const at = new Date().toISOString(), today = at.slice(0, 10);
const sentToday = new Set(prev.emailed?.day === today ? prev.emailed.keys : []);
// email only CONTRADICTIONS and pages ChatGPT can't open; a fact merely missing from one page is logged (plan) but not emailed
const fresh = problems.filter((x) => !sentToday.has(x) && !/: missing "/.test(x));
if (fresh.length && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const body = ["The AI truth gate found pages that disagree on CRTLAB's facts. ChatGPT stops recommending a site whose pages contradict each other (that is what dropped /backtest on 10-24).", "", ...fresh.map((x) => "• " + x), "", "Fix the copy (ask Claude: \"truth gate alert\")."].join("\n");
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB truth gate: ${fresh.length} page(s) contradict the price/free facts`, text: body }) });
  console.log("emailed", e.status);
  for (const x of fresh) sentToday.add(x);
}
fs.mkdirSync("data/ai", { recursive: true });
fs.writeFileSync(F, JSON.stringify({ at, ok: !problems.length, problems, checked: Object.keys(checked).length, emailed: { day: today, keys: [...sentToday] } }, null, 1));
console.log(`truth gate: ${Object.keys(checked).length}/${PAGES.length} pages read as ChatGPT · ${problems.length ? problems.length + " PROBLEM(S):\n" + problems.join("\n") : "all agree"}`);
