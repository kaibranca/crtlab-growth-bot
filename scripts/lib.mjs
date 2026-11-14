import "./mailguard.mjs"; // every bot mail under one day budget (Resend free 100/day is shared with the site)
// shared helpers for the growth bot jobs (Node 20, no dependencies)
import fs from "node:fs"; import { check } from "./store.mjs"; import { C } from "./contracts.mjs";
export const SITE = "https://crtlab.pro";
// TRAFFIC FREEZE (11-14, Kai: "make sure all machines don't make edits that confuse / stall anything traffic-wise"): while
// data/machines/freeze.json is active, machines with hands on landing pages / sitemap / llms.txt HOLD their last state.
// FAILS CLOSED (11-14): a broken / wrong-shape freeze file means HOLD (the old version returned false = every machine
// un-frozen). Only a missing file means no freeze. The guard alerts on the broken file within the hour.
export const frozen = (hold, r = check(C.freeze)) => {
  if (r.kind === "missing") return false;
  if (r.kind !== "ok") return true;
  return Date.now() < Date.parse(r.data.until) && (!hold || hold in r.data.holds);
};
export const now = () => new Date();
export const month = (d = now()) => d.toISOString().slice(0, 7);
export const append = (file, obj) => { fs.mkdirSync(file.split("/").slice(0, -1).join("/"), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + "\n"); };
export const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
export async function get(url, opts = {}, ms = 25000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms), t0 = Date.now();
  try { const r = await fetch(url, { ...opts, signal: c.signal, redirect: "follow" }); const body = await r.text(); return { status: r.status, body, ms: Date.now() - t0 }; }
  catch (e) { return { status: 0, body: String(e), ms: Date.now() - t0 }; }
  finally { clearTimeout(t); }
}

// ── shared by the search jobs (gsc.mjs, bing.mjs) — one set of rules, so Google and Bing tune titles the same way ──
// BRAND searches ("crtlab") land on the homepage; a sub-page showing for them with a low CTR is normal, not a fault.
export const BRAND = /crt\s*-?\s*lab|crtlab/i;
// pages whose titles are hand-set (home, legal, indexes) are never touched
export const NEVER = /^\/(|terms|privacy|risk|refund|third-party|cookies|blog|tools|statistics|answers|hub|pricing|features|faq|reference|login|signup|auth.*|account.*|extension-privacy|discord-privacy|partnerships|unsubscribe)$/;
// what a result at this position normally gets (rough industry curve)
export const expected = (pos) => (pos < 1.5 ? 0.28 : pos < 2.5 ? 0.15 : pos < 3.5 ? 0.1 : pos < 4.5 ? 0.07 : pos < 5.5 ? 0.05 : pos < 10.5 ? 0.03 : pos < 15.5 ? 0.015 : 0.005);
export const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Xauusd|Nas100|Us30|Sp500|Eurusd|Gbpusd|Usdjpy|Btc|Ict|Smc|Crt|Fvg|Adr|Tradingview)\b/gi, (w) => w.toUpperCase().replace("TRADINGVIEW", "TradingView"));
export const cut = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n - 1)).replace(/[\s,·|–-]+$/, ""));
/** The page's live title (brand suffix dropped) and description, as a crawler sees them. */
export async function liveMeta(path) {
  const html = (await get(SITE + path, { headers: { "user-agent": "Googlebot/2.1" } })).body;
  return {
    title: (html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? "").replace(/&amp;/g, "&").replace(/\s*\|\s*CRTLAB\s*$/, ""),
    desc: (html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&"),
  };
}
/** The title / description rewrite both jobs use: lead with the exact search when the page does not already say it. */
export function rewrite(q, cur, prev = {}) {
  const has = (s) => q.toLowerCase().split(" ").every((w) => s.toLowerCase().includes(w));
  const next = { ...prev };
  if (!has(cur.title)) { const core = cur.title.split("|").map((x) => x.trim()).find((x) => !has(x) && x.length > 4) ?? ""; next.title = cut(`${titleCase(q)}${core ? " | " + core : ""}`, 55); }
  if (cur.desc && !has(cur.desc)) next.description = cut(`${titleCase(q)}: ${cur.desc}`, 155);
  return next.title || next.description ? next : null;
}

// KNOBS (11-12): a machine's constant, self-tuning. `knob(id, default, { ladder, kpi, owner, what })` returns today's value
// from the tuner (data/machines/knobs.json → active) and REGISTERS the knob (data/machines/knob-registry.json) the first time a
// machine runs with it — the tuner (scripts/tuner.mjs) then experiments on it forever. Any new constant written this way
// joins the loop by itself.
// 11-14: the tuner is retired (unvalidated self-tuning). A knob is its designed default until the decision core owns it.
export function knob(id, def) { return def; }
