// QA GATE — a reel that fails never posts. Checks the file AND the picture:
//   format (1080×1920, h264, has audio, 6–20s, < 90 MB) · safe zones (nothing drawn under the IG/FB UI: top bar, caption area,
//   right-hand button column) · no blank stretch · the loop seam (last frame ≈ first frame) · the chart actually drew.
import fs from "node:fs"; import { execSync } from "node:child_process"; import { SAFE } from "../src/tl.mjs";
const S = 4, w = 1080 / S, h = 1920 / S; // scan at quarter size, 4 fps
export function qa(mp4, props) {
  const problems = [], info = {};
  const pr = JSON.parse(execSync(`ffprobe -v error -show_entries stream=codec_type,codec_name,width,height:format=duration,size -of json "${mp4}"`).toString());
  const v = pr.streams.find((s) => s.codec_type === "video"), a = pr.streams.find((s) => s.codec_type === "audio"), dur = +pr.format.duration, mb = pr.format.size / 1e6;
  Object.assign(info, { dur: +dur.toFixed(2), mb: +mb.toFixed(1) });
  if (!v || v.width !== 1080 || v.height !== 1920 || v.codec_name !== "h264") problems.push("format");
  if (!a) problems.push("no audio");
  if (dur < 6 || dur > 20) problems.push(`duration ${dur.toFixed(1)}s`);
  if (mb > 90) problems.push("too big");
  const buf = execSync(`ffmpeg -v error -i "${mp4}" -vf "fps=4,scale=${w}:${h}:flags=area,format=gray" -f rawvideo -`, { maxBuffer: 1 << 28 });
  const n = Math.floor(buf.length / (w * h)), px = (f, x, y) => buf[f * w * h + y * w + x];
  let zoneHits = 0, blank = 0, maxBlank = 0, drew = 0, lit0 = 0, peak = 0;
  for (let f = 0; f < n; f++) {
    let hit = 0, lit = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = px(f, x, y); if (p > 40) lit++;
      const X = x * S, Y = y * S, danger = Y < SAFE.top - 20 || Y > SAFE.bottom + 10 || (Y > SAFE.rightFrom && X > SAFE.right + 8);
      if (danger && p > 40) hit++; }
    if (hit > 6) zoneHits++;
    blank = lit < 400 ? blank + 1 : 0; maxBlank = Math.max(maxBlank, blank);
    if (f === 0) lit0 = lit; peak = Math.max(peak, lit);
  }
  if (zoneHits) problems.push(`safe-zone breach in ${zoneHits} frames`);
  if (maxBlank > 2) problems.push(`blank ${(maxBlank / 4).toFixed(1)}s`);
  // the chart must add real ink over the empty frame (title + axes) — catches a story that rendered as nothing
  info.ink = +(peak / Math.max(1, lit0)).toFixed(2); if (peak < lit0 * 1.5) problems.push("chart barely drew");
  let seam = 0; for (let i = 0; i < w * h; i++) seam += Math.abs(px(0, i % w, Math.floor(i / w)) - px(n - 1, i % w, Math.floor(i / w)));
  info.seam = +(seam / (w * h)).toFixed(2); if (info.seam > 4) problems.push(`loop seam ${info.seam}`);
  return { ok: !problems.length, problems, info };
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(qa(process.argv[2], {}));
