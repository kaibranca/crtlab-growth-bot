// one reel end to end: node reels/daily/make.mjs <props.json> <out.mp4>  (render text-safe at concurrency 1, sound, mux, loudness-levelled)
import { execSync } from "node:child_process";
import path from "node:path"; import fs from "node:fs"; import { createRequire } from "node:module";
let FF = "ffmpeg"; try { FF = createRequire(import.meta.url)("ffmpeg-static") || FF; } catch {}
const [P0, O0] = process.argv.slice(2), P = path.resolve(P0), OUT = path.resolve(O0), base = path.basename(P, ".json"), sh = (c) => execSync(c, { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname });
fs.mkdirSync(new URL("../out/daily", import.meta.url), { recursive: true });
sh(`npx remotion render src/index.jsx Daily out/daily/${base}.mp4 --props=${P} --crf=15 --concurrency=1 --muted`);
sh(`node daily/sfx.mjs ${P} out/daily/${base}.wav`);
sh(`"${FF}" -y -loglevel error -i out/daily/${base}.mp4 -i out/daily/${base}.wav -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p -af loudnorm=I=-26:TP=-6:LRA=11 -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart ${OUT}`);
console.log("reel", OUT);
