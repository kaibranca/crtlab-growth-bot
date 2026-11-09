# CRTLAB REEL SPEC — the quality bar (Kai, 11-09). Every change is checked against this before Kai sees it.

## Structure (every reel, in this order)
1. **INTRO (0–1.0s)** — the frame falls into place: title, symbol line, chart frame and logo ease in one after another
   (staggered ~80 ms, short rise + fade, like a page section revealing on scroll). Never a static first frame.
2. **BUILD** — candles replay in sync with sound; one caption at a time in the fixed caption line; annotations draw in.
3. **PAYOFF** — the result lands (TP hit / move measured), one clean cue, a short hold to read it.
4. **OUTRO** — everything on screen eases OUT (title included, nothing lingers), crtlab.pro types in, click.
5. **LOOP** — the click lands on frame 0 of the intro, so the loop is seamless and nothing pops.

## Picture rules
- Nothing snaps. Every element eases in AND out. No pops, no jumps, no hard cuts.
- Candles ALWAYS stay inside the chart area. The camera never crops a candle; price range ignores spike outliers when framing.
- No circles/rings or decorative pointers. Annotations are TradingView-native only: zones, lines, TP/SL position tool, BOS/OB
  labels, execution arrow.
- Colour: background near-black, TradingView green #089981 / red #f23645, blue ONLY for the title's highlight word and the
  execution arrow. No purple, no gradients. Contrast checked: text ≥ 7:1, labels ≥ 4.5:1.
- Text: no colons, dots, arrows, "=" or ellipses. One caption line, never wrapping, never on candles or axes.
- Alignment: everything on one centre line or the chart's left edge. Equal spacing between sections.
- Animations: one consistent entrance (short rise + fade). No rotating effects, no bounces, nothing "vibe coded".

## Sound rules
- Real recordings only. Dry (no reverb tails) and short. Each sound fires on the exact frame its thing happens.
- Candles: a tick on every candle, in sync, never skipped.
- Entry, TP hit, typing, click: one clean cue each, TradingView feel, and audible on a phone without being harsh.
- Music under everything (royalty-free, Kai-picked), ducked under cues. Mixed, then levelled to social loudness.

## Process
- Iterate locally (reels/dev-props + engine/sheet.mjs / make.mjs). Kai sees only work that passes this spec.
- One section at a time: intro → build → payoff → outro → sound. Show stills/clip per section.
