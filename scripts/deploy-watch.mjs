// DEPLOY WATCH (11-10): hourly, reads the live site's build id; when it changed since last hour, starts the device QA
// GUARD run (device-qa.yml, GUARD=1) so a deploy that breaks a page on a phone or in dark mode is caught within the hour.
import fs from "node:fs";
import { SITE } from "./lib.mjs";
const F = "data/mobile/build.txt";
const html = await fetch(SITE + "/").then((r) => r.text()).catch(() => "");
const id = (html.match(/\/_next\/static\/([A-Za-z0-9_-]{6,})\/_(buildManifest|ssgManifest)/) || html.match(/"buildId":"([^"]+)"/) || [])[1] || (html.match(/\/_next\/static\/chunks\/(app\/layout-[a-f0-9]+)\.js/) || [])[1];
fs.mkdirSync("data/mobile", { recursive: true });
const prev = fs.existsSync(F) ? fs.readFileSync(F, "utf8").trim() : "";
// DEPLOY JUDGE (11-12 — the immune system): every deploy is logged; ~24 h later it is judged on what real people did after
// it — the humans machine's per-device stay share (flood-polluted devices excluded) and AI clicks per people-fetch, vs the
// days before. A regression → data/machines/deploy-judge.json → Data brain "Deploy regression" + the exact rollback in the
// Fixer queue. It never rolls back by itself (a false positive would revert good code — Kai decides with the evidence).
{ const DL = "data/machines/deploys.jsonl", rows = fs.existsSync(DL) ? fs.readFileSync(DL, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (id && id !== prev && prev) { let commit = null; try { const g = await fetch("https://api.github.com/repos/kaibranca/crtlab-standalone/commits/live", { headers: { Authorization: `Bearer ${process.env.GH_WATCH_TOKEN || process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" } }).then((r) => r.json()); commit = g.sha?.slice(0, 8) ?? null; } catch {}
    rows.push({ at: new Date().toISOString(), build: id, prevBuild: prev, commit, prevCommit: rows.at(-1)?.commit ?? null }); }
  const H24 = 24 * 3600e3, hum = fs.existsSync("data/machines/humans.json") ? JSON.parse(fs.readFileSync("data/machines/humans.json", "utf8")) : null, out = [];
  for (const r of rows) { if (r.verdict || Date.now() - Date.parse(r.at) < H24) continue;
    const next = rows.find((x) => Date.parse(x.at) > Date.parse(r.at)); if (next && Date.parse(next.at) - Date.parse(r.at) < H24) { r.verdict = "ambiguous (another deploy within 24 h — judged with it)"; continue; }
    const flood = new Set((hum?.selfCheck?.rawSurge ?? []).filter((x) => x.dim === "device" && x.stayShare != null && x.stayShare < 0.03).map((x) => x.seg));
    const bad = (hum?.selfCheck?.devices ?? []).filter((d) => !flood.has(d.dev) && d.stayNormal >= 0.1 && d.stay24 != null && d.stay24 < d.stayNormal * 0.5 && d.raw24 >= 15);
    r.verdict = bad.length ? `REGRESSION: stay share fell on ${bad.map((d) => `${d.dev} (${d.stay24} vs ${d.stayNormal})`).join(", ")} in the 24 h after this deploy` : "healthy";
    r.judged = new Date().toISOString(); if (bad.length) out.push(r); }
  fs.writeFileSync(DL, rows.slice(-200).map((x) => JSON.stringify(x)).join("\n") + "\n");
  const open = rows.filter((x) => /^REGRESSION/.test(x.verdict ?? "") && Date.now() - Date.parse(x.judged) < 3 * H24);
  fs.writeFileSync("data/machines/deploy-judge.json", JSON.stringify({ at: new Date().toISOString(), deploys24: rows.filter((x) => Date.now() - Date.parse(x.at) < H24).length, regressions: open.map((x) => ({ at: x.at, commit: x.commit, prevCommit: x.prevCommit, verdict: x.verdict, rollback: x.prevCommit ? `cd crtlab-standalone && git push origin ${x.prevCommit}:live --force-with-lease` : "find the previous live commit in deploys.jsonl" })) }, null, 1)); }
if (!id) { console.log("deploy watch: no build id found"); process.exit(0); }
if (id === prev) { console.log("deploy watch: same build", id); process.exit(0); }
fs.writeFileSync(F, id + "\n");
if (!prev) { console.log("deploy watch: first build seen", id); process.exit(0); }
const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/device-qa.yml/dispatches`, { method: "POST", headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" }, body: JSON.stringify({ ref: "main", inputs: { guard: "1", build: id } }) });
console.log("deploy watch: NEW build", prev, "→", id, "· guard run", r.status);
