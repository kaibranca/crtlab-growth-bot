// the daily reel's sound, from the same timeline as the picture: CRTLAB's candle tick per close, a latch on the break, a ratchet as the range tool draws, a soft chime on the stat
import fs from "node:fs"; import { build, FPS } from "../src/tld.mjs";
const [IN, OUT] = process.argv.slice(2), d = JSON.parse(fs.readFileSync(IN, "utf8")), { T, sch, DUR, N } = build(d);
const SR = 48000, L = Math.round(DUR / FPS * SR), a = new Float32Array(L);
const cb = fs.readFileSync(new URL("../cand.f32", import.meta.url)), CAND = new Float32Array(cb.buffer, cb.byteOffset, cb.length / 4);
let seed = 11; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280) * 2 - 1;
let r = 5; const jit = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
function crtTick(t0, vol = 1, rate = .85, subHz = 180, subDrop = 120, subPeak = .013, subDur = .045) {
  const s0 = Math.floor(t0 * SR), off = .045 * SR, n = Math.floor(.055 * SR / rate), c = Math.exp(-2 * Math.PI * 2200 / SR); let y = 0;
  for (let i = 0; i < n && s0 + i < L; i++) { const p = off + i * rate, k = Math.floor(p), f = p - k, x = (CAND[k] || 0) * (1 - f) + (CAND[k + 1] || 0) * f; y = (1 - c) * x + c * y; a[s0 + i] += vol * 6.7 * y * Math.min(1, (n - i) / 96); }
  let ph = 0; for (let i = 0; i < (subDur + .02) * SR && s0 + i < L; i++) { const u = i / SR, fr = subHz * Math.pow(subDrop / subHz, Math.min(1, u / subDur)); ph += 2 * Math.PI * fr / SR;
    const g = u < .004 ? subPeak * u / .004 : subPeak * Math.pow(.0001 / subPeak, Math.min(1, (u - .004) / (subDur - .004))); a[s0 + i] += vol * g * Math.sin(ph); }
}
function click(t0, v, f, q, len) { const s0 = Math.floor(t0 * SR), n = Math.floor(len * SR), w = 2 * Math.PI * f / SR, al = Math.sin(w) / (2 * q), a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n && s0 + i < L; i++) { const x = i < 90 ? rnd() * Math.exp(-i / 18) : 0, y = (al * x - al * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; a[s0 + i] += v * y * 6 * Math.min(1, (n - i) / (SR * .008)); } }
const ratchet = (t0, dur, n, v, f = 4600) => { for (let k = 0; k < n; k++) click(t0 + dur * k / n, v * (.7 + .3 * jit()), f + 300 * jit(), 2.4, .006); };
function tone(t0, f0, f1, dur, vol, att = .002) { const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR); let ph = 0;
  for (let i = 0; i < n && s0 + i < L; i++) { const u = i / n, f = f0 * Math.pow(f1 / f0, u); ph += 2 * Math.PI * f / SR; const env = Math.min(1, i / (att * SR)) * Math.pow(1 - u, 2.2); a[s0 + i] += vol * env * Math.sin(ph); } }
function tap(t0, vol, fc = 2400, dur = .006) { const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR), c = Math.exp(-2 * Math.PI * fc / SR); let y = 0, z = 0;
  for (let i = 0; i < n + 200 && s0 + i < L; i++) { const x = i < n ? rnd() * (1 - i / n) : 0; y = (1 - c) * x + c * y; z = (1 - c) * y + c * z; a[s0 + i] += vol * (y - z) * 3; } }
const V = 5, P = .02 * V;
const latch = (t, k = 1) => { tap(t, P * 1.3 * k, 3000); tone(t, 400 * k, 190 * k, .06, P * 1.0); tone(t + .045, 200 * k, 96 * k, .14, P * 1.4); };
// candle closes: full ticks while the day builds, the key candle ticks softly per minute, the fast run thins out so it never rattles
let lastT = -1;
for (let i = 0; i < N; i++) { const s = sch[i]; if (!s) continue; const fast = i > d.kb, t = s[1];
  if (i === d.kb) { const n = d.bars[i].p.length; for (let j = 1; j <= n; j++) crtTick(s[0] + (s[1] - s[0]) * j / n, V * .32 * (.9 + .2 * jit()), .95); continue; }
  if (t - lastT < (fast ? .085 : .07)) continue; lastT = t; crtTick(t, V * (fast ? .55 : .85) * (.92 + .16 * jit()), .85 * (.98 + .04 * jit())); }
if (d.story === "asia") { tone(T.lock, 540, 300, .07, P * .8); latch(T.lock + .04, .9); }
else { tone(T.lv0 + .05, 300, 150, .5, P * .3); ratchet(T.lv0, T.lv1 - T.lv0, 10, P * .8); }
latch(T.cross, 1.05); tone(T.cross + .05, d.side === "low" ? 300 : 520, d.side === "low" ? 160 : 700, .22, P * .7); // the break
tone(T.Tk - .35, 220, 300, .5, P * .22);                                                                           // lean in
ratchet(T.tm, .55, 12, P * .85);                                                                                    // the range tool draws
tap(T.cap4[0] + .2, P * 1.1, 3400); tone(T.cap4[0] + .2, 660, 520, .09, P * .6); tone(T.cap4[0] + .27, 880, 700, .14, P * .5); // the stat
tone(T.end[0] + .05, 523, 523, .5, P * .35, .01); tone(T.end[0] + .2, 784, 784, .6, P * .3, .01);                  // end line
let pk = 0; for (const v of a) pk = Math.max(pk, Math.abs(v)); const g = .2 / pk; // quiet: a bed under the picture, never louder than speech
const b = Buffer.alloc(44 + L * 4); b.write("RIFF", 0); b.writeUInt32LE(36 + L * 4, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(L * 4, 40);
for (let i = 0; i < L; i++) { const v = (a[i] * g * 32767) | 0; b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4); }
fs.writeFileSync(OUT, b); console.log("sfx", OUT, (DUR / FPS).toFixed(1) + "s");
