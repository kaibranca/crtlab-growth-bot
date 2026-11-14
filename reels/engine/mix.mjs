// SOUND (v6, 11-09) — node reels/engine/mix.mjs <props.json> <out.wav>   (offline, from the same timeline as the picture)
// Every sound is a REAL recording (Kenney CC0 in ./sfx, CRTLAB's own app candle tick in cand.f32), softened with a gentle
// high-cut so nothing is harsh, and fires on the exact frame its thing happens. Nothing synthesized, nothing for decoration.
//   candles   — the app tick on EVERY candle close (never skipped); fast runs get softer, not dropped
//   entry     — the app tick, lower and firmer (same family, dry)
//   target    — CRTLAB "three notes" chime (original, TradingView-alert feel), short soft room
//   typing    — minimal soft keys while crtlab.pro types (4 recordings rotated, slight pitch/level variation)
//   click     — a warm mouse press + release on the result
//   music     — if reels/music has tracks (fetched from Mixkit at render time, never committed: public repo): one per reel (picked by story), from 20% in, low under the SFX with a
//               gentle duck on each cue, faded in/out. Royalty-free tracks only (Kai picks them).
import fs from "node:fs"; import { execSync } from "node:child_process"; import { build, FPS } from "../src/tl.mjs";
const SR = 48000;
const smp = (name) => { const b = fs.readFileSync(new URL(`./sfx/${name}.f32`, import.meta.url)); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
export function musicFiles() { const dir = new URL("../music/", import.meta.url); return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(mp3|m4a|wav|aac|ogg)$/i.test(f)).sort().map((f) => new URL(f, dir).pathname) : []; }
export function mix(d) {
  const G = build(d), { T, sch, beats } = G, Ls = Math.ceil(G.DUR / FPS * SR) + SR, Lc = new Float32Array(Ls), Rc = new Float32Array(Ls);
  let seed = 0; for (const c of d.id || "x") seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cues = []; // times of the cues (music ducks around them)
  // place a mono buffer, resampled by `rate` (pitch), panned slightly
  const place = (buf, t0, vol, rate = 1, pan = 0) => { const s0 = Math.floor(t0 * SR), n = Math.floor(buf.length / rate);
    for (let i = 0; i < n && s0 + i < Ls; i++) { const p = i * rate, k = Math.floor(p), f = p - k, x = (buf[k] || 0) * (1 - f) + (buf[k + 1] || 0) * f; Lc[s0 + i] += x * vol * (1 - pan * .25); Rc[s0 + i] += x * vol * (1 + pan * .25); } };
  // ── candles: the app's tick (55 ms slice, softened) on every close ────────────────────────────────────────────────
  const cb = fs.readFileSync(new URL("./cand.f32", import.meta.url)), CAND = new Float32Array(cb.buffer, cb.byteOffset, cb.length / 4);
  const tick = (t0, vol, rate) => { const s0 = Math.floor(t0 * SR), off = .045 * SR, n = Math.floor(.05 * SR / rate), c = Math.exp(-2 * Math.PI * 2600 / SR); let y = 0;
    for (let i = 0; i < n && s0 + i < Ls; i++) { const p = off + i * rate, k = Math.floor(p), f = p - k, x = (CAND[k] || 0) * (1 - f) + (CAND[k + 1] || 0) * f; y = (1 - c) * x + c * y;
      const v = vol * 22 * y * Math.min(1, (n - i) / 140) * Math.min(1, i / 16); Lc[s0 + i] += v; Rc[s0 + i] += v; } };
  const pitch = .94 + rnd() * .1;
  for (let i = 0; i <= T.last; i++) { const s = sch[i]; if (!s) continue; const dur = s[1] - s[0];
    const vol = dur > .5 ? .2 : dur > .09 ? .16 : .1; // the slow key candle is clearest; fast runs are softer, never dropped
    tick(s[1], vol * (.9 + .2 * rnd()), pitch * (.98 + .04 * rnd())); }
  // ── TP chime: CRTLAB's own "three notes" (TradingView-style alert feel, original): marimba-like C6 E6 G6, 75 ms apart,
  // mallet partial at 4x that dies fast, gentle exponential decay, and a short soft room (two damped echoes) — no long tail
  const chime = (t0) => { const notes = [1046.5, 1318.5, 1568], tail = .55;
    for (const [j, f] of notes.entries()) { const s0 = Math.floor((t0 + j * .075) * SR), n = Math.floor(tail * SR), v = .085 * (1 - j * .08);
      for (let i = 0; i < n && s0 + i < Ls; i++) { const u = i / SR, att = Math.min(1, u / .003);
        const x = att * (Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 11) + .22 * Math.sin(2 * Math.PI * f * 3.98 * u) * Math.exp(-u * 32) + .06 * Math.sin(2 * Math.PI * f * 9.9 * u) * Math.exp(-u * 60));
        for (const [dl, g] of [[0, 1], [.041, .08]]) { const k = s0 + i + Math.floor(dl * SR); if (k < Ls) { Lc[k] += x * v * g * (dl ? .9 : 1); Rc[k] += x * v * g * (dl ? 1.1 : 1); } } } } };
  // ── entry + target ────────────────────────────────────────────────────────────────────────────────────────────────
  // entry + TP use the SAME family as the candles (Kai: the app tick is perfect; the glass/drop rang = "wet"): dry, branded
  if (d.trade && T.tCross) { tick(T.tCross, .42, pitch * .82); cues.push(T.tCross); }
  const pay = beats.find((b) => b.show?.includes("result") || b.show?.includes("measure"));
  if (pay) { const tp = d.trade && T.tPay ? T.tPay : pay.t + .4; if (fs.existsSync(new URL("./sfx/tp.f32", import.meta.url))) place(smp("tp"), tp, .38); else chime(tp); /* a TP sound file dropped in as sfx/tp.f32 replaces the double tick */ cues.push(tp); }
  // ── drawing the position tool: a soft press as the cursor grabs, a release as it lets go ─────────────────────────
  const tool = beats.find((b) => b.show?.includes("tool"));
  if (d.trade && tool) { /* every cursor click uses the same clean click as the domain (Kai): tool icon click, grab, release */
    const clk = (at) => { place(smp("click_001"), at, .42); place(smp("click_003"), at + .09, .22); };
    /* v14: no cursor draws the tool any more, so no clicks */ void clk; }
  // ── typing: minimal, soft, real keys ──────────────────────────────────────────────────────────────────────────────
  const KEYS = ["click1", "click2", "select_001", "select_002"].map(smp);
  T.keys.forEach(([s], i) => place(KEYS[(i * 3 + (seed & 3)) % 4], s + (rnd() - .5) * .012, .14 * (.8 + .35 * rnd()), .96 + .08 * rnd(), (rnd() - .5) * .3));
  // ── the click: warm press, release ~90 ms later ───────────────────────────────────────────────────────────────────
  place(smp("click_001"), T.click, .42); place(smp("click_003"), T.click + .09, .22); cues.push(T.click);
  const endN = Math.floor(G.DUR / FPS * SR), L = Lc.subarray(0, endN), R = Rc.subarray(0, endN);
  // ── music (optional) ──────────────────────────────────────────────────────────────────────────────────────────────
  const want = d.look?.track, all = musicFiles(), files = want === "none" ? [] : all; let music = null;
  if (files.length) {
    const f = (want && files.find((x) => x.endsWith(`mixkit-${want}.mp3`))) || files[seed % files.length]; // the planned (learned) track
    const raw = execSync(`ffmpeg -v error -i "${f}" -ac 2 -ar ${SR} -f f32le -`, { maxBuffer: 1 << 30 }), M = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), frames = M.length / 2;
    const start = Math.floor(frames * .2), need = endN; let rms = 0, cnt = 0;
    for (let i = 0; i < need && start + i < frames; i += 7) { rms += M[(start + i) * 2] ** 2; cnt++; } rms = Math.sqrt(rms / Math.max(1, cnt)) || 1e-4;
    const g = .055 / rms; /* subtle (Kai 11-09) */ // music sits ~-21 dBFS RMS, well under the cues
    for (let i = 0; i < need; i++) { const j = start + (i % Math.max(1, frames - start)), u = i / SR;
      let duck = 1; for (const c of cues) { const dt = u - c; if (dt > -.06 && dt < .7) duck = Math.min(duck, 1 - .35 * (dt < 0 ? (dt + .06) / .06 : 1 - dt / .7)); }
      const fade = Math.min(1, u / .5, (need / SR - u) / .6);
      L[i] += M[j * 2] * g * duck * fade; R[i] += M[j * 2 + 1] * g * duck * fade; }
    music = f.split("/").pop();
  }
  return { L, R, music };
}
export function wav(file, { L, R }) {
  let pk = 1e-9; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g = Math.min(1, .5 / pk) /* headroom only; the final level is set in make.mjs */, n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * g * 32767))), 44 + i * 4); b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * g * 32767))), 46 + i * 4); }
  fs.writeFileSync(file, b);
}
if (import.meta.url === `file://${process.argv[1]}`) { const d = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); const m = mix(d); wav(process.argv[3], m); console.log("wav", process.argv[3], m.music || "(no music)"); }
