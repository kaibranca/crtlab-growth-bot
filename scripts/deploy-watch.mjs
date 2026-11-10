// DEPLOY WATCH (11-10): hourly, reads the live site's build id; when it changed since last hour, starts the device QA
// GUARD run (device-qa.yml, GUARD=1) so a deploy that breaks a page on a phone or in dark mode is caught within the hour.
import fs from "node:fs";
import { SITE } from "./lib.mjs";
const F = "data/mobile/build.txt";
const html = await fetch(SITE + "/").then((r) => r.text()).catch(() => "");
const id = (html.match(/\/_next\/static\/([A-Za-z0-9_-]{6,})\/_(buildManifest|ssgManifest)/) || html.match(/"buildId":"([^"]+)"/) || [])[1] || (html.match(/\/_next\/static\/chunks\/(app\/layout-[a-f0-9]+)\.js/) || [])[1];
if (!id) { console.log("deploy watch: no build id found"); process.exit(0); }
fs.mkdirSync("data/mobile", { recursive: true });
const prev = fs.existsSync(F) ? fs.readFileSync(F, "utf8").trim() : "";
if (id === prev) { console.log("deploy watch: same build", id); process.exit(0); }
fs.writeFileSync(F, id + "\n");
if (!prev) { console.log("deploy watch: first build seen", id); process.exit(0); }
const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/device-qa.yml/dispatches`, { method: "POST", headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" }, body: JSON.stringify({ ref: "main", inputs: { guard: "1", build: id } }) });
console.log("deploy watch: NEW build", prev, "→", id, "· guard run", r.status);
