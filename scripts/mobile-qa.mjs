// MOBILE / DEVICE QA MACHINE (11-10, Kai: "a machine that fixes mobile passes over anything"; agreed scope = DETECT, RANK,
// GUARD — it never edits the site). Opens CRTLAB's pages like a real phone, iPad and laptop, in light and dark, and finds
// what makes a page feel broken. Read-only, as a visitor; ~a few page loads per check.
//   node scripts/mobile-qa.mjs            full run: key pages × 4 devices × 2 themes
//   GUARD=1 node scripts/mobile-qa.mjs    after a deploy: top pages, iPhone + desktop, only NEW issues email Kai
// Every issue is weighted by the real traffic that page gets (AI machine's reads/clicks + the device share of AI visitors),
// so the worst-for-visitors issue is first. An issue is only REPORTED once seen on two runs in a row (no false alarms).
// Output: data/mobile/report.json (counts + selectors, public repo safe) · screenshots → the run's artifact (7 days).
import fs from "node:fs";
import { chromium, devices } from "playwright";
import { SITE } from "./lib.mjs";

const GUARD = !!process.env.GUARD, NOW = new Date().toISOString();
const DEV = {
  iphone: { ...devices["iPhone 14"], share: 0.4 },             // 40% of ChatGPT visitors are on phones (11-10)
  android: { ...devices["Pixel 7"], share: 0.15 },
  ipad: { ...devices["iPad (gen 7)"], share: 0.03 },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: undefined, share: 0.58 },
};
const USE = GUARD ? ["iphone", "desktop"] : Object.keys(DEV), THEMES = GUARD ? ["dark"] : ["light", "dark"];
const J = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);

// pages: the ones that matter to traffic first (AI machine), then fixed key pages, one sample per factory family
const plan = J("data/ai/plan.json", {});
const KEY = ["/", "/backtest", "/economic-calendar", "/economic-calendar/us-core-inflation-rate-mom", "/news", "/news/cpi", "/learn", "/pricing",
  "/statistics/xauusd", "/tools/fair-value-gap-statistics", "/gold-fair-value-gaps", "/what-traders-backtest", "/daily-market-data", "/backtest-gold", "/blog", "/faq"];
const fromPlan = [...(plan.winners ?? []).map((x) => x.p), ...(plan.convert ?? []).map((x) => x.p), ...(plan.surges ?? []).filter((x) => x.kind === "page").map((x) => x.key)];
const pages = [...new Set([...fromPlan, ...KEY])].filter((p) => !/^\/(auth|api|admin|account)/.test(p)).slice(0, GUARD ? 12 : 28);
const weightOf = (p) => { const w = (plan.winners ?? []).find((x) => x.p === p), c = (plan.convert ?? []).find((x) => x.p === p); return 1 + (w ? w.accounts * 5 + w.clicks : 0) + (c ? c.reads7d / 10 : 0) + (KEY.includes(p) ? 1 : 0); };

// in-page checks (run inside the browser) — objective things only
const CHECK = () => {
  const W = innerWidth, out = [], sel = (el) => { if (!el || el === document.body) return "body"; let s = el.tagName.toLowerCase(); if (el.id) return `${s}#${el.id}`; const c = [...el.classList].filter((x) => !/^(is-|has-)/.test(x)).slice(0, 2).join("."); return c ? `${s}.${c}` : s; };
  const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05; };
  // 1. sideways scroll: the page is wider than the screen
  const sw = document.documentElement.scrollWidth;
  if (sw > W + 2) { const wide = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > W + 2 && r.width > 0 && vis(el); }).filter((el, _, a) => !a.some((p) => p !== el && p.contains(el))).slice(0, 4).map(sel); out.push({ kind: "sideways-scroll", detail: `page is ${sw}px on a ${W}px screen`, where: wide.join(", ") || "?" }); }
  // 2. cut off: text running out of a box that hides overflow (excluding intentional one-line ellipsis)
  for (const el of document.querySelectorAll("body *")) {
    if (out.filter((x) => x.kind === "cut-off").length >= 4) break;
    const cs = getComputedStyle(el); if (!/(hidden|clip)/.test(cs.overflowX + cs.overflowY) || cs.textOverflow === "ellipsis" || !vis(el)) continue;
    if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 40 && el.innerText?.trim().length > 3 && !/(scroll|auto)/.test(cs.overflowX)) out.push({ kind: "cut-off", detail: `content ${el.scrollWidth}px in a ${el.clientWidth}px box`, where: sel(el) });
  }
  // 3. tap targets (touch screens): buttons/links smaller than 32×32 that are not plain links inside a sentence
  if (matchMedia("(pointer: coarse)").matches) {
    const small = [...document.querySelectorAll("a, button, [role=button], input, select")].filter((el) => { if (!vis(el)) return false; const r = el.getBoundingClientRect(); if (r.width >= 32 && r.height >= 32) return false; return !(el.tagName === "A" && el.closest("p, li, td") && getComputedStyle(el).display === "inline"); });
    if (small.length >= 3) out.push({ kind: "small-tap-targets", detail: `${small.length} controls under 32px`, where: [...new Set(small.slice(0, 5).map(sel))].join(", ") });
  }
  // 4. text too small to read on a phone
  if (W < 600) { let tiny = 0, ex = ""; for (const el of document.querySelectorAll("p, span, li, td, a, small, em, b, div")) { if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2) || !vis(el)) continue; if (parseFloat(getComputedStyle(el).fontSize) < 10.5) { tiny++; ex ||= sel(el); } } if (tiny >= 5) out.push({ kind: "tiny-text", detail: `${tiny} text blocks under 10.5px`, where: ex }); }
  // 5. invisible text: text colour almost equal to the background behind it (the classic dark/light mode glitch)
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || +m[3] > 0.6)) return m.slice(0, 3).map(Number); } return [255, 255, 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let ghost = 0, gx = "";
  for (const el of document.querySelectorAll("h1, h2, h3, p, a, button, li, td, span")) { if (ghost > 50) break; if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2) || !vis(el)) continue; const fg = (getComputedStyle(el).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number); if (fg.length < 3) continue; const a = lum(fg), b = lum(bgOf(el)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); if (ratio < 1.6) { ghost++; gx ||= sel(el); } }
  if (ghost >= 2) out.push({ kind: "invisible-text", detail: `${ghost} text blocks nearly the colour of their background`, where: gx });
  // 6. something important is off the screen (a fixed bar or dialog wider/taller than the view)
  const fixed = [...document.querySelectorAll("body *")].filter((el) => { const cs = getComputedStyle(el); if (cs.position !== "fixed" || !vis(el)) return false; const r = el.getBoundingClientRect(); return r.left < -2 || r.right > W + 2; }).slice(0, 3).map(sel);
  if (fixed.length) out.push({ kind: "fixed-offscreen", detail: "a fixed bar/panel sticks out of the screen", where: fixed.join(", ") });
  return out;
};

const browser = await chromium.launch();
const found = [], shots = [], errors = [];
fs.mkdirSync("shots", { recursive: true });
for (const d of USE) for (const theme of THEMES) {
  const { share, ...ctxOpts } = DEV[d];
  const ctx = await browser.newContext({ ...ctxOpts, colorScheme: theme, userAgent: ctxOpts.userAgent ?? undefined });
  // INVISIBLE TO ANALYTICS (11-10: Kai saw "an American user spamming pages" in the live feed — it was this robot on GitHub's US
  // servers). Every tracking call is blocked, so the robot never appears in the activity feed, visits, guests, meters or events.
  await ctx.route(/\/api\/(track|events|wall-event|stats|candles-meter|system-updates)(\/|\?|$)/, (r) => r.abort());
  for (const p of pages) {
    const page = await ctx.newPage(), consoleErr = [];
    page.on("pageerror", (e) => { const t = String(e.message); if (!/Failed to fetch|NetworkError|Load failed/i.test(t)) consoleErr.push(t.slice(0, 140)); });
    // errors the robot causes itself (it blocks tracking + meter calls) are not the site's: dropped
    const OWN = /favicon|Failed to load resource|429|ERR_BLOCKED|ERR_FAILED|Failed to fetch|NetworkError|Load failed|candles-meter|\/api\/(track|events|wall-event|stats|system-updates)/i;
    page.on("console", (m) => { if (m.type() === "error" && !OWN.test(m.text())) consoleErr.push(m.text().slice(0, 140)); });
    const t0 = Date.now();
    try {
      // not "networkidle": CRTLAB pages poll (live data, counters), so the network is never idle and every page waited the full
      // 30 s — the run hit its time limit (11-10). Load, then give the page 2.5 s to settle.
      const r = await page.goto(SITE + p + (p.includes("?") ? "&" : "?") + "qa=1", { waitUntil: "load", timeout: 25000 });
      await page.waitForTimeout(2500);
      const ms = Date.now() - t0;
      if (!r || r.status() >= 400) { found.push({ p, d, theme, kind: "http", detail: `HTTP ${r?.status()}`, where: "page", share }); await page.close(); continue; }
      const issues = await page.evaluate(CHECK);
      if (ms > 8000) issues.push({ kind: "slow", detail: `${(ms / 1000).toFixed(1)} s to settle`, where: "page" });
      if (consoleErr.length) issues.push({ kind: "js-error", detail: consoleErr[0], where: `${consoleErr.length} error(s)` });
      for (const x of issues) found.push({ p, d, theme, ...x, share });
      if (issues.length) { const f = `shots/${d}-${theme}${p.replace(/\//g, "_") || "_home"}.png`; await page.screenshot({ path: f, fullPage: false }); shots.push(f); }
    } catch (e) { errors.push(`${d}/${theme} ${p}: ${String(e.message).slice(0, 100)}`); }
    await page.close();
  }
  await ctx.close();
}
await browser.close();

// confirm across runs: an issue is real once it shows on two runs in a row; score = page weight × device share
fs.mkdirSync("data/mobile", { recursive: true });
const R = "data/mobile/report.json", prev = J(R, { seen: {} });
const key = (x) => `${x.p}|${x.d}|${x.theme}|${x.kind}`;
const seen = {}; for (const x of found) seen[key(x)] = (prev.seen?.[key(x)] ?? 0) + 1;
const confirmed = found.filter((x) => seen[key(x)] >= 2).map((x) => ({ ...x, score: +(weightOf(x.p) * x.share * (x.kind === "sideways-scroll" || x.kind === "http" || x.kind === "invisible-text" ? 3 : x.kind === "js-error" || x.kind === "cut-off" ? 2 : 1)).toFixed(2) })).sort((a, b) => b.score - a.score);
const fresh = confirmed.filter((x) => !(prev.confirmed ?? []).some((y) => key(y) === key(x)));
const firstSeen = found.filter((x) => seen[key(x)] === 1).slice(0, 60).map((x) => ({ p: x.p, d: x.d, theme: x.theme, kind: x.kind, detail: x.detail, where: x.where }));
const report = { at: NOW, firstSeen, mode: GUARD ? "guard" : "full", pages: pages.length, devices: USE, themes: THEMES, checked: pages.length * USE.length * THEMES.length, found: found.length, confirmed, newSinceLast: fresh.map(key), errors: errors.slice(0, 10), seen, build: process.env.BUILD_ID ?? null };
fs.writeFileSync(R, JSON.stringify(report, null, 1));
fs.appendFileSync("data/mobile/runs.jsonl", JSON.stringify({ at: NOW, mode: report.mode, checked: report.checked, found: found.length, confirmed: confirmed.length, fresh: fresh.length }) + "\n");

const byKind = {}; for (const x of confirmed) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
console.log(`device QA (${report.mode}): ${report.checked} page views · ${found.length} issues seen · ${confirmed.length} confirmed ${JSON.stringify(byKind)} · ${fresh.length} new`);
for (const x of confirmed.slice(0, 15)) console.log(`  ${x.score.toString().padStart(5)}  ${x.d}/${x.theme}  ${x.p}  ${x.kind}: ${x.detail}  [${x.where}]`);
if (errors.length) console.log("load errors:", errors.slice(0, 3).join(" | "));

// GUARD: a NEW confirmed issue after a deploy → email now (a regression); full runs report through the board / Monday email
if (fresh.length && process.env.RESEND_API_KEY && process.env.ALERT_TO && (GUARD || prev.confirmed)) {
  const text = [`The device check found ${fresh.length} new problem(s) on crtlab.pro${GUARD ? " right after a deploy" : ""}:`, "", ...confirmed.filter((x) => fresh.includes(key(x))).slice(0, 12).map((x) => `• ${x.p} on ${x.d} (${x.theme}): ${x.kind} — ${x.detail} [${x.where}]`), "", `Screenshots: ${process.env.RUN_URL ?? "the GitHub run"} (artifact "device-shots").`, "Ask Claude: \"device check alert\"."].join("\n");
  const e = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB device check: ${fresh.length} new problem(s)${GUARD ? " after a deploy" : ""}`, text }) });
  console.log("emailed", e.status);
}
