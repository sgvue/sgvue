# Handoff: Ask Vee — assistant mascot + thinking-process motion

## Overview
A redesign of the **Ask SGVue** assistant panel in the SGVue IFC viewer:
- The assistant gets a name, **Vee**, and a 16×16 pixel mascot (a hexagon creature from the SGVue mark).
- A new **thinking-process animation** replaces a static wait: Vee changes state, a one-line step ticker rolls through what it's doing, an element matrix shows the model being read, filtered and checked, and the findings fly into the answer.

## About the design files
The files here are **design references made in HTML**: a 16 s looping motion study and a mascot sheet. They show the intended look and behaviour. They are **not production code**. Rebuild them in the SGVue app's own UI stack and patterns. The HTML runs off a scripted timeline; the real app should drive the same states from actual assistant events (see *State management*).

Open `Ask Vee Thinking.dc.html` in a browser (serve the folder over a local HTTP server). It plays on a loop and has a scrubbable timeline. `Ask Vee Mascot Sheet.dc.html` shows all of Vee's states live (option **1a**, the one chosen).

## Fidelity
**High-fidelity.** Colours, type and motion timings are final. The panel was rebuilt from the `img/ask.webp` product screenshot with the tokens in `site.css`. **That screenshot is at 1.2× app scale**, so every size below is given in **app px**, already divided by 1.2.

---

## Screens / views

### 1. Ask Vee panel (dark theme)
Floating panel over the 3D viewport, docked bottom-right above the Ask button.

| Part | Spec (app px) |
|---|---|
| Panel | 419 × 533, radius 12, 1px border `#3C4646`, bg `#181F21`, overflow hidden |
| Header | height 60; 1px divider `#282F31` at the bottom |
| Corner bracket | top-left, 22 × 20 at (12.5, 13), 2px top+left border `#354544`, top-left radius 7.5 |
| Header mascot | Vee **idle**, 16-cell sprite at ~27px (1.67px per cell), left 13, top 15 |
| Title | `ASK VEE`, IBM Plex Sans 600 13px, letter-spacing .08em, `#A9B5B5`, left 46, vertically centred at 30 |
| Close | 12px X, stroke `#8B9496` 2.2/24, right ~24, centred at 30 |
| Thread | from 60 to 418 (height 358), clipped, scrolls up as content grows |
| Author label | row height 17, left 20, Plex Sans 400 12.5px, `#94A7A4`, gap 7.5: [Vee sprite ~23px] **Vee** [status] |
| Assistant bubble | left 17, width 386, radius 10, bg `#1F2827`, padding 11.7 / 14.2 / 10.8, Plex Sans 400 15px / 23.3px, `#E4ECEA` |
| User label | `You`, same style as the author label, no sprite |
| User bubble | same geometry, bg `#12302D` (sel-bg), width hugs the text (+28 horizontal padding), height 47 |
| Footer divider | 1px `#2B3335` at 419 |
| Suggestion chips | top 433, height 28, Plex Mono 400 13px `#A3B1B0`, padding 0 11, 1px `#262F30`, pill, gap 7.5; row fades out over the last 38px (mask) |
| Input | left 17, top 472.5, 334 × 44, radius 8.3, bg `#1F2827`, 1px `#2C3535` (focused `#2F6F68`), placeholder `#8A9493` 15px, text inset 13.3 |
| Send | left 361.5, top 476, 40 × 40, radius 8.3, bg `#12302E` (pressed `#1B4A45`), 1px `#3FA399`, arrow 18px stroke `#4FD3C4` 2/24 |
| Send · busy | arrow crossfades to a 10px stop square, radius 2.5, `#4FD3C4` |

**Copy:** title `ASK VEE` · intro `4 models, 412 elements, 6 storeys. No data-completeness issues found.` · placeholder `How many doors on L2?` · chips `Check ARC against STR`, `How many trees, by species?`

### 2. Ask Vee button (viewport, bottom-right)
Pill, height ~42, 1.25px `#35C4B6` border, bg `#171F20`, padding 0 17.5 0 11, gap 5, Vee **idle** sprite at ~20px, label `Ask Vee` Plex Sans 600 15px `#56D2C4`.

### 3. Thinking trace (inside the assistant bubble)
The assistant bubble appears as soon as the first step starts. Its height animates: **0 → 65** (ticker plus matrix) **→ 162** (answer). With the "Minimal" option there is no matrix and the height goes 0 → 40.

- **Status (author label):** `Thinking` in `#798C8A` with a shimmer: a gradient `#798C8A 36% → #E4ECEA 50% → #798C8A 64%` at background-size 300%, sweeping left to right every **1.6 s**, clipped to the text. When finished it rolls to `checked 86 walls · 7s` (`#798C8A`).
- **Ticker row:** top 11, height 18, Plex Sans 13px `#94A7A4`. A count sits on the right in Plex Mono 12.5px: number `#E4ECEA`, unit `#798C8A`, and the "missing" number `#4FD3C4`. Each new step **rolls**: it enters from +100% height to 0 (0.42 s, enter) while the old step leaves to −100% (0.32 s, enter).
  1. `Reading 4 models` · `412 elements`, counting up
  2. `Filtering IfcWall` (`IfcWall` in Mono, ink) · `86 walls`, counting down from 412
  3. `Checking Fire Rating` · `N missing`, ticking up as findings land
- **Element matrix:** top 37.5, width 357.5, height ~17.
  - *Read:* one cell per element, 4 rows, grouped by model with a 3.3px gap between groups (ARC 140 · STR 244 · SIT 20 · MEP 8 → 35/61/5/2 columns). Cells are 2.7px squares (radius 24%), colour `#354544`. They pop in as a left-to-right wave over 1.0 s, flashing `#7E9693` and settling over 0.45 s.
  - *Filter:* non-matching cells scale to 0 in a left-to-right wave (0.3 s each, 0.45 s spread). Matching cells (86 walls) glide to a 2 × 43 grid of 5.8px cells (pitch 8.3), 0.7 s glide, staggered 0.35 s.
  - *Check:* a scan beam crosses left to right in 1.7 s (linear). The beam is 2px `#35C4B6` with a glow `0 0 10px 2px rgba(53,196,182,.55)` and a 38px trailing gradient to `rgba(53,196,182,.16)`. Cells that pass flash `#7E9693`, then dim to `#2D3B3A`. Flagged cells turn `#35C4B6` with a glow, re-pop from scale 0.45 to 1 (pop), and throw a 1.4px ring that grows to 2.6× and fades out over 0.6 s.
- **Answer:** the ticker fades out (0.28 s). Unflagged cells shrink away. Answer words fade in one by one (65 ms apart, 0.36 s each, rising 7px → 0): `**9 of 86 walls** have no Fire Rating. All 9 are in SB_ARC_R25.` (`SB_ARC_R25.` is set in Mono). The flagged cells fly into per-level rows: x uses glide and y uses enter, so the path curves; 0.75 s each, 50 ms apart; they grow to 8.3px and land at a 11.7px pitch. The rows fade in from the left, 80 ms apart: Mono 12.5px, level `#94A7A4` on the left, `3 walls` on the right. A 1px `#282F31` rule sits above the rows. The thread scrolls up by 47 (glide, 0.8 s).

---

## Vee — pixel mascot
A 16 × 16 grid at **8 fps**. Draw it with crisp edges at integer device-pixel multiples where you can (canvas with `imageSmoothingEnabled = false`, or a box-shadow / SVG rect sprite).

**Palette:** `o #35C4B6` rim · `h #8AF0E4` highlight · `b #1E2827` body · `t #2B3B3A` top facet · `s #354544` dim · `e #E4ECEA` eyes · `k #0F1516` visor.

**Body** (12 × 12, placed at x 2, y 3 in the 16 grid):
```
....oooo....
..oottttoo..
.otttttttto.
obttttttttbo
obbbttttbbbo
obbbbttbbbbo
obbbbbbbbbbo
obbbbbbbbbbo
obbbbbbbbbbo
.obbbbbbbbo.
..oobbbboo..
....oooo....
```
**States** (coordinates are relative to the body; eyes are 2 × 2 at (2,6) and (8,6)):
| State | When | Drawing |
|---|---|---|
| idle | at rest (header, button, past replies) | eyes `e`; blinks for 2 of every 28 frames (eyes become 2 × 1 at y 7) |
| thinking | request sent, before the first tool result | eyes shifted up 1 and darting ±1 every 6 frames; a 3-cell `h` light runs round the rim, 2 cells per frame |
| reading | tool calls running / scanning | an 8 × 2 `k` visor at (2,6); an `h` pip with `s` side cells sweeps back and forth across it (14-frame ping-pong) |
| found | for 0.5 s after each finding | eyes `h`; hops (y offset 0,1,2,1,0,0,0,0); a `!` (cells y 0,1,2,4 at x 14) blinks |
| done | the answer is complete | top facet `t` turns to `o` (lit V); happy `^ ^` eyes; slow bob (0,0,1,1,0,0,0,0) |

Entrance on the reply label: scale 0 → 1 with **pop** (easeOutBack), 0.5 s.

---

## Interactions & behaviour (timeline, from the reference)
| Phase | Duration | What happens |
|---|---|---|
| Open | 2.6 s | Input gains focus (border colour 0.3 s); the question types in over ~1.55 s; blinking caret |
| Send | 1.0 s | Send presses (scale 0.9 → 1, pop, 0.32 s). The typed line **lifts** from the input straight up to the user bubble (0.7 s glide, same x). The user bubble scales 0.94 → 1 and fades in; `You` fades in; the placeholder returns |
| Think | 1.4 s | Author row rises 6px and fades in; Vee pops in (thinking); `Thinking` shimmers; send turns to stop |
| Read | 1.8 s | Bubble opens; step 1; matrix wave; count 0 → 412 |
| Filter | 1.6 s | Step 2; non-walls drop out; walls regroup; count 412 → 86 |
| Check | 2.4 s | Step 3; beam scan; 9 findings, with Vee in **found** at each |
| Answer | 3.2 s | Trace folds; Vee **done**; status → `checked 86 walls · 7s`; answer streams; cells fly into level rows; stop → send |
| Hold | 2.4 s | Rest (the reference zooms the camera back out; that's video-only) |

**Motion curves** (only these three are used):
- **enter**: easeOutQuart, for arrivals and fades
- **glide**: easeInOutCubic, for moves, resizes and scroll
- **pop**: easeOutBack, for emphasis and entrances

**Reduced motion:** follow the site's `prefers-reduced-motion` rule. Show the states without the movement: no shimmer, no beam, no fly-in. The sprite holds the first frame of each state.

The camera moves and the background dimming in the HTML exist only for the video. Don't ship them.

## State management
- `assistantState`: `idle | thinking | reading | found | done`. It drives Vee, the status text and the send/stop button.
- `steps[]`: `{ label, count, unit }`, pushed as the assistant calls tools (for example read model → filter class → check property). The ticker shows only the latest step.
- `matrix`: the element IDs read, then the filtered subset, then the flagged subset. **Use real data where it exists**; the counts on screen should be the real counts.
- `found`: set for 0.5 s on each flagged result (one hop per finding).
- On completion: collapse the trace, stream the answer, map the flagged IDs to the grouped answer rows (per storey in the reference).
- `elapsed`: shown in the status as `checked {n} {class} · {s}s`.

## Design tokens (dark theme, from `site.css` and the screenshot)
`ground #0F1516` · `card #171F20` · panel bg `#181F21` · bubble/input `#1F2827` · `border #263332` · `border-strong #354544` · panel border `#3C4646` · divider `#282F31` / `#2B3335` · `ink #E4ECEA` · `muted #94A7A4` · `faint #798C8A` · `accent #35C4B6` · `accent-ink #4FD3C4` · `sel-ink #56D2C4` · `sel-bg #12302D` · send border `#3FA399` · mascot highlight `#8AF0E4`.
Type: IBM Plex Sans 400/500/600 and IBM Plex Mono 400/500 (`fonts/`, SIL OFL). Radii: panel 12 · bubble 10 · input/send 8.3 · pill 999.

## Assets
- `img/ask.webp`: the product screenshot used as the backdrop and as the measurement source.
- `fonts/*`: IBM Plex, from the sgvue.github.io repo.
- The close, reply and send icons were redrawn to match the screenshot. **Swap in the app's real icon set.**

## Screenshots
`screenshots/`: stills from the reference video, in order: `01-at-rest-typing` · `02-send-lift` · `03-thinking` · `04-reading` · `05-filtering` · `06-checking-found` · `07-answer` · `08-done` · `09-vee-states` (the mascot sheet, option 1a).

## Files
- `Ask Vee Thinking.dc.html`: the motion reference (entry point)
- `ask-thinking-hex.jsx`: all of its choreography, the panel layout and the Vee sprite code (`hexGrid`, `hexState`)
- `Ask Vee Mascot Sheet.dc.html`: the mascot states (option 1a = Vee)
- `animations-v3.jsx`, `tweaks-panel.jsx`, `support.js`: runtime for the HTML references only
