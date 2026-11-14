// FAILURES — node scripts/failures.mjs   (daily; reads files only, no API, no cost)
// Kai 11-14: "we focus so much on what works that we forget a lot are experiments that spam dead stuff or are failures — learn
// more from failures." Measured that day: the machines' ledger held 124 entries, almost all wins or "other"; the biggest failure
// on the site (2,492 auto pages → 0 accounts in 90 d) was never written down as a loss by anyone. A failure no one records
// gets repeated. This machine writes every failure down, with what it cost and the lesson, once:
//   SPENT, NOTHING BACK  page families with ≥ 20 pages and 0 accounts in 90 d (and how much of the site they are)
//   TESTS THAT LOST      hook / title experiments that lost or were superseded, reels clearly under their platform's normal
//   NEVER JUDGED         actions older than 14 d with no verdict = the machine didn't learn anything from them
// → data/guard/failures.json (the /machine + summary read it), ledger LOSS entries (once per key), Sunday email.
import fs from "node:fs";
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const L = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const NOW = Date.now(), DAY = 864e5, out = { at: new Date().toISOString(), spent: [], lost: [], unjudged: [], lessons: [] };

// 1. spent, nothing back
const W = J("data/works/plan.json", {}), fams = Array.isArray(W.families) ? W.families : [];
const allPages = fams.reduce((s, f) => s + (f.pages || 0), 0) || 1;
for (const f of fams) if ((f.pages || 0) >= 20 && (f.accounts90 || 0) === 0)
  out.spent.push({ key: `fam|${f.fam}`, what: `${f.fam}: ${f.pages} pages (${Math.round(f.pages / allPages * 100)}% of the site) → ${f.visitors90 || 0} visitors, 0 accounts in 90 d`, cost: f.pages });
const deadShare = out.spent.reduce((s, x) => s + x.cost, 0) / allPages;
if (deadShare > .5) out.lessons.push(`${Math.round(deadShare * 100)}% of the site's pages bring no accounts. More auto pages of these kinds = more Google spam risk, not more traffic. Build pages only in families that bring accounts (/, /backtest, /backtest-<market>, concepts).`);

// 2. tests that lost
for (const e of J("data/ai/hooks.json", {}).experiments || []) if (["lost", "superseded"].includes(e.status))
  out.lost.push({ key: `hook|${e.id}`, what: `hook "${e.template}" on ${e.family}: ${e.status}${e.why ? " (" + e.why + ")" : ""}` });
const RM = J("data/reels/metrics.json", {}), rl = L("data/reels/log.jsonl").filter((x) => x.id && x.postedAt && NOW - Date.parse(x.postedAt) > 2 * DAY);
for (const plat of ["ig", "fb"]) { const ps = rl.filter((x) => x.plat === plat), v = (x) => (plat === "ig" ? RM[x.id]?.views : RM[x.id]?.plays) ?? null;
  const vs = ps.map(v).filter((y) => y != null).sort((a, b) => a - b), med = vs[Math.floor(vs.length / 2)] || 0;
  for (const x of ps) if (v(x) != null && med && v(x) < med * .6) out.lost.push({ key: `reel|${x.id}`, what: `${plat} reel "${x.title}" (${x.model}, ${x.fam}/${x.angle}): ${v(x)} vs normal ${med}` });
  const site = ps.reduce((s, x) => s + (RM[x.id]?.site || 0), 0); if (ps.length >= 10 && site < 1) out.lessons.push(`${plat.toUpperCase()}: ${ps.length} reels, ${Math.round(site)} tracked site visitors. Reels win views, not traffic, until there is a clickable path (pinned link comment / tracked bio link).`); }
const tl = {}; for (const x of out.lost.filter((y) => y.key.startsWith("reel|"))) { const k = x.what.match(/\((\w+), (\w+)\//); if (k) { const kk = `${k[1]} · ${k[2]}`; tl[kk] = (tl[kk] || 0) + 1; } }
for (const [k, n] of Object.entries(tl)) if (n >= 3) out.lessons.push(`Reels "${k}" lost ${n} times: the brain should stop spending slots on it.`);

// 3. never judged
for (const a of L("data/radar/actions.jsonl").filter((a) => !a.verdict && NOW - Date.parse(a.at) > 14 * DAY)) out.unjudged.push({ key: `radar|${a.page}|${a.at}`, what: `radar push "${a.kind}" on ${a.page} (${a.at.slice(0, 10)}): no verdict after 14 d` });
for (const a of L("data/ai/actions.jsonl").filter((a) => !a.verdict && a.at && NOW - Date.parse(a.at) > 14 * DAY)) out.unjudged.push({ key: `ai|${a.page || a.id}|${a.at}`, what: `AI machine action ${a.kind || ""} on ${a.page || a.id || "?"}: never judged` });
if (out.unjudged.length) out.lessons.push(`${out.unjudged.length} machine actions older than 14 days were never judged: work done, nothing learned. Every action needs a verdict day.`);

fs.mkdirSync("data/guard", { recursive: true }); fs.writeFileSync("data/guard/failures.json", JSON.stringify(out, null, 1));
// the ledger finally hears about losses (once per key)
const LG = "data/machines/ledger.jsonl", have = new Set(L(LG).map((x) => x.key));
for (const x of [...out.spent, ...out.lost]) if (!have.has(`fail|${x.key}`)) fs.appendFileSync(LG, JSON.stringify({ at: out.at, key: `fail|${x.key}`, machine: "failures", kind: "loss", what: x.what }) + "\n");
console.log(`failures: ${out.spent.length} families spent for nothing · ${out.lost.length} lost tests · ${out.unjudged.length} never judged · ${out.lessons.length} lessons`);
for (const l of out.lessons) console.log(" •", l);
if (new Date().getUTCDay() === 0 && process.env.RESEND_API_KEY) { const { mail } = await import("../reels/engine/alert.mjs");
  await mail(`CRTLAB failures this week: ${out.spent.length + out.lost.length} written down, ${out.lessons.length} lessons`, ["What didn't work, and what the machines should learn:", "", ...out.lessons.map((l) => "• " + l), "", "Spent for nothing:", ...out.spent.map((x) => "  " + x.what), "", "Tests that lost:", ...out.lost.slice(0, 20).map((x) => "  " + x.what)].join("\n")); }
