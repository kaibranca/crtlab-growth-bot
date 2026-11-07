// "HOW <MARKET> REACTS TO <RELEASE>" (11-07) — one small file per searched pairing (gold × CPI, EUR/USD × ECB…) with
// every measured release for that market, so the site's /news/<release>/<market> page reads ONE file instead of ~120
// release files. Built from the news days this bot already measured (hubs.mjs, news-backfill.mjs, live-news.mjs).
// Runs daily after hubs.mjs (recap.yml) — a new release lands in its pages the morning after. Writes data/events/react/.
import fs from "node:fs";

// the pairings people search — must match lib/news-react-pages.ts on the site (it 404s anything else)
export const COMBOS = {
  XAUUSD: ["cpi", "nfp", "fomc", "pce", "ppi"], NAS100: ["cpi", "nfp", "fomc"], US30: ["cpi", "nfp", "fomc"], SP500: ["cpi", "nfp", "fomc"],
  EURUSD: ["cpi", "nfp", "fomc", "ecb"], GBPUSD: ["boe", "uk-cpi"], USDJPY: ["boj", "nfp"], AUDUSD: ["rba"], BTCUSD: ["cpi", "fomc"],
};
const HEAD = { cpi: /^(CPI|Inflation Rate) YoY$|^CPI y\/y$/i, "uk-cpi": /^(CPI|Inflation Rate) YoY$/i, nfp: /Non.?Farm/i, fomc: /Interest Rate|Federal Funds/i,
  ecb: /Interest Rate/i, boe: /Interest Rate/i, boj: /Interest Rate/i, rba: /Interest Rate/i, pce: /^Core PCE Price Index MoM$|PCE/i, ppi: /^PPI MoM$/i };
const DIR = "data/events", idx = JSON.parse(fs.readFileSync(`${DIR}/index.json`, "utf8"));
fs.mkdirSync(`${DIR}/react`, { recursive: true });
const day = new Map(); const load = (slug) => { if (!day.has(slug)) { const f = `${DIR}/${slug}.json`; day.set(slug, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null); } return day.get(slug); };
const out = [];
for (const [id, fams] of Object.entries(COMBOS)) for (const fam of fams) {
  const rows = [];
  for (const x of idx.filter((x) => x.fams.includes(fam))) {
    const d = load(x.slug); const m = d?.markets.find((m) => m.id === id); if (!m || m.ofDay == null) continue;
    // the headline figure people search for (CPI YoY, the payrolls number, the rate decision), else the first with an actual
    const hl = HEAD[fam], r = (hl && (d.releases.find((r) => hl.test(r.title) && r.actual != null) ?? d.releases.find((r) => hl.test(r.title)))) ?? d.releases.find((r) => r.actual != null) ?? d.releases[0] ?? {};
    rows.push({ slug: d.slug, date: d.date, time: d.time, title: r.title ?? null, actual: r.actual ?? null, forecast: r.forecast ?? null,
      m5: m.m5, m15: m.m15, m60: m.m60, range60: m.range60, ofDay: m.ofDay, reversed: m.reversed, swept: m.swept, upMax: m.upMax, dnMax: m.dnMax });
  }
  if (rows.length < 8) continue; // too few releases to state anything — the site 404s it
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const name = idx.length && load(rows[0].slug)?.markets.find((m) => m.id === id);
  const file = { id, fam, name: name?.name ?? id, unit: name?.unit ?? "", updated: new Date().toISOString().slice(0, 10), rows };
  const f = `${DIR}/react/${fam}--${id}.json`, body = JSON.stringify(file);
  // rewrite only when the rows changed, so the file (and the page's lastmod) moves only with real data
  const old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  if (!old || JSON.stringify(old.rows) !== JSON.stringify(rows)) fs.writeFileSync(f, body);
  out.push({ fam, id, n: rows.length, last: rows[0].date, updated: (old && JSON.stringify(old.rows) === JSON.stringify(rows)) ? old.updated : file.updated });
}
fs.writeFileSync(`${DIR}/react/index.json`, JSON.stringify(out, null, 1));
console.log("react pages:", out.length, out.map((x) => `${x.fam}×${x.id}:${x.n}`).join(" "));
