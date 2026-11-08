// SOUND — node reels/engine/mix.mjs <props.json> <out.wav>   (offline, from the same timeline as the picture)
// Three layers, all quiet, nothing synthetic-sounding up front:
//   1. candle ticks — CRTLAB's own app candle sound (cand.f32), one soft tick per close, thinned when the replay runs fast
//   2. three cues only — a faint key click per typed letter (the same tick, higher), one soft bell when the setup pays
import fs from "node:fs"; import { build, FPS } from "../src/tl.mjs";
const SR = 48000;
export function mix(d) {
  const G = build(d), { T, sch, beats } = G, Ls = Math.ceil(G.DUR / FPS * SR) + SR, Lc = new Float32Array(Ls), Rc = new Float32Array(Ls);
  let seed = 0; for (const c of d.id || "x") seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cb = fs.readFileSync(new URL("./cand.f32", import.meta.url)), CAND = new Float32Array(cb.buffer, cb.byteOffset, cb.length / 4);
  // ── 1. the app's candle tick: 55 ms slice, gentle low-pass, resampled for pitch ─────────────────────────────────────
  function tick(t0, vol, rate = 1, pan = 0) {
    const s0 = Math.floor(t0 * SR), off = .045 * SR, n = Math.floor(.055 * SR / rate), c = Math.exp(-2 * Math.PI * 3200 / SR); let y = 0;
    for (let i = 0; i < n && s0 + i < Ls; i++) { const p = off + i * rate, k = Math.floor(p), f = p - k, x = (CAND[k] || 0) * (1 - f) + (CAND[k + 1] || 0) * f; y = (1 - c) * x + c * y;
      const v = vol * 22 * y * Math.min(1, (n - i) / 120) * Math.min(1, i / 12); Lc[s0 + i] += v * (1 - pan * .3); Rc[s0 + i] += v * (1 + pan * .3); }
  }
  const pitch = .9 + rnd() * .22; let last = -1; // each reel gets its own tick character
  for (let i = 0; i <= T.last; i++) { const s = sch[i]; if (!s) continue; const slow = s[1] - s[0] > .5;
    if (slow) { for (const j of [.34, .67, 1]) tick(s[0] + (s[1] - s[0]) * j, .22 * (.85 + .3 * rnd()), pitch * 1.06, .2); last = s[1]; continue; }
    if (s[1] - last < .13) continue; last = s[1]; tick(s[1], .3 * (.8 + .4 * rnd()), pitch * (.97 + .06 * rnd()), (rnd() - .5) * .6); }
  // ── 2. cues ────────────────────────────────────────────────────────────────────────────────────────────────────────
  T.keys.forEach(([s], i) => tick(s, .11 * (.8 + .4 * rnd()), pitch * 1.5 + .08 * rnd(), (i / 9 - .5) * .4));
  tick(T.click, .2, pitch * .8, 0); // the cursor click
  const bell = (t0, f, vol) => { const s0 = Math.floor(t0 * SR); for (let i = 0; i < SR * 1.6 && s0 + i < Ls; i++) { const u = i / SR, e = Math.min(1, u / .004) * Math.exp(-u * 3.2);
    const v = vol * e * (Math.sin(2 * Math.PI * f * u) + .25 * Math.sin(2 * Math.PI * f * 2.01 * u) * Math.exp(-u * 6) + .08 * Math.sin(2 * Math.PI * f * 3.02 * u) * Math.exp(-u * 9)); Lc[s0 + i] += v; Rc[s0 + i] += v; } };
  const pay = beats.find((b) => b.show?.includes("result") || b.show?.includes("measure"));
  if (pay) { const t = d.trade && T.tPay ? Math.max(T.tPay, pay.t) : pay.t + .5; bell(t, 1318.5, .0035); bell(t + .09, 1975.5, .0025); }
  // no music: Kai 11-08 — clean picture + subtle ticks reads better (and no audio-claim risk). Ticks + 2 cues only.
  const endN = Math.floor(G.DUR / FPS * SR);
  return { L: Lc.subarray(0, endN), R: Rc.subarray(0, endN) };
}
export function wav(file, { L, R }) {
  let pk = 1e-9; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = Math.min(1, .5 / pk), n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * g * 32767))), 44 + i * 4); b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * g * 32767))), 46 + i * 4); }
  fs.writeFileSync(file, b);
}
if (import.meta.url === `file://${process.argv[1]}`) { const d = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); wav(process.argv[3], mix(d)); console.log("wav", process.argv[3]); }
