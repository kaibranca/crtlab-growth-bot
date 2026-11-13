// LOST PEAKS (11-13). Every other machine compares this week with last week — so a cliff that happened 3 weeks ago looks
// "flat" (ChatGPT → /backtest: 126 clicks / 63 accounts the week of 10-19, then 15 → 6 → 3, and no machine ever raised it).
// This one remembers: for every source (chatgpt, google, bing, perplexity…) and every landing family, the BEST 7 days of
// the last 75 vs the last 7. A collapse to ≤ 35 % of its peak that has lasted ≥ 14 days is the biggest prize on the board:
// it once worked, so it can work again. Ranked by clicks lost per week → data/machines/peaks.json → the Fixer queue.
// Self-learning: each lost peak is tracked until it recovers (≥ 70 % of peak) — recoveries and their dates go to the ledger,
// so the analyst/memory can learn which fixes brought a lost peak back.
import fs from "node:fs";
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const clicks = J("data/ai/clicks.json", {}); // "YYYY-MM-DD|source|/path" → [clicks, accounts]
const fam = (p) => p.replace(/\?.*$/, "")
  .replace(/^\/news\/.+/, "/news/*").replace(/^\/economic-calendar\/.+/, "/economic-calendar/*").replace(/^\/backtest-.+/, "/backtest-*")
  .replace(/^\/tools\/.+/, "/tools/*").replace(/^\/answers\/.+/, "/answers/*").replace(/^\/(indicators?|statistics|recap|learn|reference|blog)\/.+/, "/$1/*")
  .replace(/^\/.+-challenge-simulator$/, "/*-challenge-simulator");
const DAY = 864e5, today = new Date(new Date().toISOString().slice(0, 10)).getTime();
const series = new Map(); // key → Map(day → [c, a])
const add = (k, d, v) => { let m = series.get(k); if (!m) series.set(k, (m = new Map())); const x = m.get(d) ?? [0, 0]; x[0] += v[0] ?? 0; x[1] += v[1] ?? 0; m.set(d, x); };
for (const [k, v] of Object.entries(clicks)) {
  const [d, src, p0] = k.split("|"); const t = Date.parse(d); if (!(t > today - 80 * DAY)) continue;
  const p = fam(p0 || "/"); if (/^\/(auth|login|signup|account|checkout)/.test(p)) continue;
  add(`${src}|${p}`, t, v); add(`${src}|ALL`, t, v);
}
const sum7 = (m, end) => { let c = 0, a = 0; for (let t = end - 6 * DAY; t <= end; t += DAY) { const x = m.get(t); if (x) { c += x[0]; a += x[1]; } } return [c, a]; };
const last = today - DAY; // yesterday = last complete day
const rows = [];
for (const [k, m] of series) {
  let best = [0, 0], bestEnd = null;
  for (let e = last - 75 * DAY; e <= last; e += DAY) { const s = sum7(m, e); if (s[0] > best[0]) { best = s; bestEnd = e; } }
  const now = sum7(m, last), ratio = best[0] ? now[0] / best[0] : 1;
  // how long it has been down: days since the trailing 7 last stood ≥ 70 % of the peak
  let downSince = null; for (let e = last; e >= bestEnd; e -= DAY) { if (sum7(m, e)[0] >= 0.7 * best[0]) { downSince = e + DAY; break; } }
  const downDays = downSince ? Math.round((last - downSince) / DAY) : 0;
  const [src, page] = k.split("|");
  rows.push({ src, page, peak: best[0], peakAccounts: best[1], peakWeekEnd: bestEnd && new Date(bestEnd).toISOString().slice(0, 10), now: now[0], nowAccounts: now[1], ratio: +ratio.toFixed(2), downDays, lostPerWeek: best[0] - now[0], lostAccountsPerWeek: best[1] - now[1] });
}
const lost = rows.filter((r) => r.peak >= 15 && r.ratio <= 0.35 && r.downDays >= 14).sort((a, b) => b.lostAccountsPerWeek - a.lostAccountsPerWeek || b.lostPerWeek - a.lostPerWeek);
const prev = J("data/machines/peaks.json", { lost: [] });
const key = (r) => `${r.src}|${r.page}`, wasLost = new Set((prev.lost ?? []).map(key));
const recovered = rows.filter((r) => wasLost.has(key(r)) && r.ratio >= 0.7);
for (const r of recovered) fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: new Date().toISOString(), key: `peaks|${key(r)}|recovered|${new Date().toISOString().slice(0, 10)}`, machine: "peaks", kind: "win", what: `lost peak RECOVERED: ${r.src} → ${r.page} back to ${r.now}/wk (peak ${r.peak})` }) + "\n");
for (const r of lost.filter((r) => !wasLost.has(key(r)))) fs.appendFileSync("data/machines/ledger.jsonl", JSON.stringify({ at: new Date().toISOString(), key: `peaks|${key(r)}|lost|${new Date().toISOString().slice(0, 10)}`, machine: "peaks", kind: "loss", what: `lost peak: ${r.src} → ${r.page} ${r.now}/wk vs ${r.peak}/wk peak (week to ${r.peakWeekEnd}), down ${r.downDays} days` }) + "\n");
const out = { at: new Date().toISOString(), note: "best 7 days of the last 75 vs the last 7, per source × landing family (AI/search clicks from data/ai/clicks.json). lost = ≤ 35 % of peak for ≥ 14 days, peak ≥ 15 clicks/wk, ranked by accounts lost per week.", lost, sources: rows.filter((r) => r.page === "ALL").sort((a, b) => b.peak - a.peak) };
fs.writeFileSync("data/machines/peaks.json", JSON.stringify(out, null, 1));
console.log(`peaks: ${lost.length} lost peak(s)${lost.length ? " — " + lost.slice(0, 4).map((r) => `${r.src}→${r.page} ${r.now}/${r.peak} (−${r.lostAccountsPerWeek} acc/wk, ${r.downDays} d)`).join(" · ") : ""}${recovered.length ? ` · recovered: ${recovered.map(key).join(", ")}` : ""}`);
