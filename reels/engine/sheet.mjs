// dev: contact sheet of key beats → out/sheet.png (one bundle, many stills)
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
import { bundle } from "@remotion/bundler"; import { selectComposition, renderStill } from "@remotion/renderer";
import { build, FPS } from "../src/tl.mjs";
const P = process.argv[2] || "out/try.json", d = JSON.parse(fs.readFileSync(P, "utf8")), { T, DUR } = build(d);
const ts = process.argv[3] ? process.argv[3].split(",").map(Number) : [0, T.cap1[0] + .5, T.tKey0 + .3, T.tCross + .5, T.result + .5, T.hold, T.typed + .1, T.click, (DUR - 1) / FPS];
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.jsx"), publicDir: path.resolve("public") });
const comp = await selectComposition({ serveUrl, id: "Reel", inputProps: d, port: 3123 });
fs.rmSync("out/st", { recursive: true, force: true }); fs.mkdirSync("out/st", { recursive: true });
for (const [i, t] of ts.entries()) await renderStill({ composition: comp, serveUrl, output: `out/st/${i}.png`, inputProps: d, frame: Math.min(DUR - 1, Math.round(t * FPS)), port: 3123 });
execSync(`ffmpeg -v error -y -i out/st/%d.png -vf "scale=360:-1,tile=${ts.length}x1:padding=6:color=gray" out/sheet.png`);
console.log("DUR", (DUR / FPS).toFixed(1) + "s", ts.map((x) => x.toFixed(2)).join(" "));
