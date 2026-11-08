// WEEKLY REPORT — node reels/engine/report.mjs (Sundays) → data/reels/report.md + email: what won, what's next, suggested bio.
// The IG API can't edit the bio, so the engine writes it from the winning model each week and Kai pastes it (10 seconds).
import fs from "node:fs"; import { DIR, readLog, brain, mean, ARMS, CYCLE } from "./brain.mjs"; import { mail } from "./alert.mjs";
const B = brain(), M = fs.existsSync(`${DIR}/metrics.json`) ? JSON.parse(fs.readFileSync(`${DIR}/metrics.json`, "utf8")) : {};
const wk = readLog().filter((x) => x.id && Date.now() - Date.parse(x.postedAt) < 7 * 864e5), L = [];
const NAMES = { ob: "order block", fvg: "FVG", crt: "CRT", asia: "Asian range", break: "PDH/PDL break", news: "news spike", nyopen: "NY open" };
L.push(`# CRTLAB reels — week to ${new Date().toISOString().slice(0, 10)}`, "");
for (const plat of ["ig", "fb"]) {
  const ps = wk.filter((x) => x.plat === plat), v = (x) => (plat === "ig" ? M[x.id]?.views : M[x.id]?.plays) ?? 0, tot = ps.reduce((s, x) => s + v(x), 0);
  L.push(`## ${plat === "ig" ? "Instagram" : "Facebook"}: ${ps.length} reels, ${tot.toLocaleString()} views`);
  for (const x of [...ps].sort((a, b) => v(b) - v(a)).slice(0, 3)) L.push(`- ${v(x)} views · "${x.title}" (${x.mk} ${x.model}, ${x.fam}/${x.cam}/${x.pace}, ${x.hour}:00 UTC) ${x.permalink || ""}`);
  for (const arm of ["model", "fam", "cam", "pace", "hour", "music"]) {
    const vals = (arm === "music" ? Object.keys(B[plat]?.music || {}) : ARMS[arm]).map((a) => [a, mean(B, plat, arm, a)]).filter(([, s]) => s.n).sort((a, b) => b[1].avg - a[1].avg);
    if (vals.length) L.push(`  - ${arm}: ${vals.map(([a, s]) => `${a} ${s.avg >= 0 ? "+" : ""}${s.avg.toFixed(2)} (${s.n})`).join(" · ")}`);
  }
  L.push("");
}
const top = ARMS.model.map((m) => [m, mean(B, "ig", "model", m)]).sort((a, b) => b[1].avg - a[1].avg)[0][0];
L.push(`## Suggested IG bio (paste it in)`, "", "```", `Backtest ${NAMES[top]}s on real 1-minute data 📊`, "Replay any day, bar by bar — free every day", "↓ crtlab.pro", "```", "");
L.push(`Cycle: ${Object.entries(CYCLE).map(([d, m]) => `${d} ${m}`).join(" · ")}. Learned from ${B.n?.ig ?? 0} IG / ${B.n?.fb ?? 0} FB scored posts.`);
fs.writeFileSync(`${DIR}/report.md`, L.join("\n"));
await mail("CRTLAB reels — weekly report", L.join("\n"));
console.log(L.join("\n"));
