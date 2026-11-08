// RENDER — node reels/engine/make.mjs  → reels/out/reel-<k>.mp4 for every reels/out/reel-<k>.json, each through the QA gate.
// One bundle, renders in sequence (light: one Chrome, concurrency 2), then a loudness pass + faststart for clean upload.
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
import { bundle } from "@remotion/bundler"; import { selectComposition, renderMedia } from "@remotion/renderer";
import { qa } from "./qa.mjs"; import { mix, wav } from "./mix.mjs";
const OUT = path.resolve(new URL("../out/", import.meta.url).pathname), only = process.argv[2];
const jobs = fs.readdirSync(OUT).filter((f) => /^reel-\d+\.json$/.test(f) && (!only || f === `reel-${only}.json`)).sort();
const serveUrl = await bundle({ entryPoint: path.resolve(OUT, "../src/index.jsx"), publicDir: path.resolve(OUT, "../public") });
const report = {};
for (const f of jobs) {
  const k = f.match(/\d+/)[0], props = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8")), raw = path.join(OUT, `raw-${k}.mp4`), mp4 = path.join(OUT, `reel-${k}.mp4`);
  const comp = await selectComposition({ serveUrl, id: "Reel", inputProps: props, port: 3123 });
  await renderMedia({ composition: comp, serveUrl, codec: "h264", crf: 16, outputLocation: raw, inputProps: props, concurrency: 2, port: 3123, pixelFormat: "yuv420p", muted: true });
  // sound is mixed offline from the same timeline, then levelled quiet and clean (-21 LUFS, peaks ≤ -6 dBFS)
  const w = path.join(OUT, `mix-${k}.wav`); wav(w, mix(props));
  execSync(`ffmpeg -v error -y -i "${raw}" -i "${w}" -map 0:v -map 1:a -c:v copy -af loudnorm=I=-21:TP=-6:LRA=14 -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart "${mp4}"`);
  fs.rmSync(w);
  fs.rmSync(raw);
  report[k] = qa(mp4, props);
  console.log(`reel ${k}:`, report[k].ok ? "QA PASS" : "QA FAIL", report[k].problems.join("; "), report[k].info);
}
fs.writeFileSync(path.join(OUT, "qa.json"), JSON.stringify(report, null, 1));
if (Object.values(report).some((x) => !x.ok)) process.exitCode = 2;
