# 2026-10-01 — Vee: the assistant's name, its pixel mascot and its thinking trace

Not a parity phase against `SGVue.dc.html`: the specification here is the owner's second
handoff, **"Ask Vee"**, kept unchanged in `design-reference/ask-vee/` (its `README.md` is the
spec, `ask-thinking-hex.jsx` the reference code, `screenshots/` its stills). It was built in two
steps. **§§ 1–4 are step 1** — the **name** and the **mascot at rest** (`01-at-rest-typing.jpg`
and `09-vee-states.jpg`), with § 2 amended by step 2's one-size rule. **§ 5 is step 2** — the
**thinking trace** and its motion, beside the stills `01`–`08`.

`before/` is `1f6b787`, `after/` is step 1, on the design's mock federation at **1280 × 820**,
both themes; `ratios/` is that build at real device pixel ratios. `trace/`, `trace-150/` and
`ratios-one-size/` are step 2. The PNGs and their `.json` sidecars are git-ignored, like every
capture under `tests/parity/`; this file is what is kept.

## Scale

The handoff's README says its sizes are "app px (screenshot ÷ 1.2)". They are not: the
screenshot it was traced from was taken at 150 % display scaling. Measured against the real
panel — 330 × 420, bubble text 12.5 px, send button 32 px — **`ask-thinking-hex.jsx` px ÷ 1.5 =
app px** (its README's px ÷ 1.25). The panel in the handoff is today's panel, so every existing
element keeps its style string; only what is new is sized from the handoff:

| | reference (jsx) | ÷ 1.5 | built |
|---|---|---|---|
| header sprite | `px={2}` → 32 px | 21.3 | slot **21 px** |
| reply-label sprite | `px={1.75}` → 28 px | 18.7 | slot **19 px** |
| pill sprite | `px={1.5}` → 24 px | 16 | slot **16 px** |
| frame offsets | `hexF + 5`, `+ 11`, `+ 17` | — | 5, 11 (+ 4 a message), 17 |

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
for T in dark light; do
  SGVUE_DPR=1 SGVUE_SIZE=1280x820 SGVUE_HASH=mock SGVUE_OUT=tests/parity/2026-10-01-vee/after \
  SGVUE_THEMES=$T SGVUE_STATES=vee-closed,vee-open,vee-lane,vee-sheet \
  node scripts/safe-run.cjs screenshot.cjs
done
```

One chain on a fresh window per theme (`scripts/screenshot.cjs`, `APP_ONLY_STATES`). Every state
pins the sprite clock at frame 0 first (`window.__sgvueDev.vee.pin(0)`), so the header's sprite,
the label's and the pill's stand at their own frames 5, 11 and 17 — eyes open — on every run.

**`SGVUE_DPR=1`, not the harness's default 2.** Device emulation changes what the page draws,
not what `capturePage` returns: at an emulated 2 the PNG is still 1280 × 820, a down-sample. At
1 — this display's own ratio — one PNG pixel is one device pixel, which is what a sprite has to
be judged on.

| state | what it shows |
|---|---|
| `vee-closed` | the stage at rest: the pill, closed, reading `Ask Vee` |
| `vee-open` | the panel opened from the pill, the boot audit as its one message: the title `ASK VEE`, the label `Vee`, the pill lit |
| `vee-lane` | … then a storey hidden, an element selected and the laser tool: the panel and the property card stop above the reset pill (§ 4) |
| `vee-sheet` | all five states of the sprite, on `--card` and on `--step-bg`, with the seven roles' colours (§ 3) |

Each of the first three also writes one crop per mounted sprite, 6 px of its surroundings
included, enlarged 8× without smoothing: `<state>-<theme>-sprite-<n>-<slot>px.png`, in document
order — the header's (`21px`), the label's (`19px`), the pill's (`16px`). `before/` was captured
with the same command and the first three states; that build has no sprite, so it has no crops.

## 1 — the header, the first label row and the pill

CSS pixels `[x, y, w, h]`, read from the DOM at 1280 × 820; the same in both themes, before and
after.

| | before (`1f6b787`) | after |
|---|---|---|
| panel | `[938, 348, 330, 420]` | the same |
| header | `[939, 349, 328, 47]` | **the same** |
| header icon | sparkle `[951, 364.5, 15, 15]` | sprite slot `[949, 360, 21, 21]` — 15 px of flow |
| title | `ASK SGVUE` `[974, 366.5, 249, 11]` | `ASK VEE` `[974, 366.5, 249, 11]` — **the same box, so the same baseline** |
| close button | `[1231, 360, 24, 24]` | the same |
| first message | `[951, 408, 304, 68.75]` | the same |
| its label row | `[951, 408, 81.41, 10]` | `[951, 408, 84.83, 10]` — **10 px before and after** |
| label: sprite | — | slot `[949, 402, 19, 19]` — 10 px of flow each way, its left edge on the header slot's |
| label: name | `SGVue` `[954, 408, 31.23, 10]` | `Vee` `[971, 408, 17.66, 10]` |
| label: `reply` | `[992.23, 408, 37.17, 10]` | `[995.66, 408, 37.17, 10]` |
| bubble | `[951, 422, 304, 54.75]` | the same |
| pill | `[1201.42, 774, 66.58, 32]` | `[1179.09, 774, 88.91, 32]` |
| pill icon | sparkle `[1214.42, 783, 14, 14]` | sprite slot `[1191.09, 781, 16, 16]` — 14 px of flow |
| pill label | `Ask` `[1235.42, 784.25, 19.58, 11.5]` | `Ask Vee` `[1213.09, 784.25, 41.91, 11.5]` — 34 px from the pill's left edge, as before |

So: the header did not grow and its title did not move; the label row did not grow (the brief
allowed 2 px); the pill is **22.33 px wider**, which is the label's own width and nothing else —
its right edge (1268, `right:12px`), its top, its height, its padding and gap are what they were,
and its colours closed and open are the same `getComputedStyle` values as before in both themes.
At the real default window (1264 × 755 inside) it is `[1163.09, 709, 88.91, 32]`, was
`[1185.42, 709, 66.58, 32]`; the header there is `[923, 284, 328, 47]` before and after.

Each slot overhangs its row and is pulled in by negative margins, as the reference's are
(`ask-thinking-hex.jsx:315`, `:367`): header `-4px -4px -1px -2px`, label `-6px -4px -3px -5px`,
pill `-3px -1px -1px -1px`. The 16 × 16 grid has three empty rows above the 12 × 12 body and one
below, so the larger top margin is what puts the **body** on the row's centre line: at this
ratio the body's centre is on the title's (y 372), on the label row's (y 413) and on the pill's
(y 790) exactly.

**What did not change**, `before/` against `after/`, pixels differing in `vee-open` (dark /
light): the status bar 0 / 0 · the header right of its title text 0 / 0 · the close button 0 / 0
· the bubble 0 / 0 · the log below it 0 / 0 · the suggestions and the composer 0 / 0 · the
sidebar 0 / 0 · the toolbar 0 / 0. The whole panel differs by 844 / 848 px: the two sprites, the
title's text and the name.

Against the handoff's still `01-at-rest-typing.jpg` (150 %): `ratios/panel-150.png` (and
`panel-150-light.png`, `pill-150-<theme>.png`) is the same corner of the app at a real 1.5
ratio. The differences are the ones this step is allowed: the label's sprite and the pill's are
32 device pixels where the reference draws 28 and 24 (1.75 and 1.5 px a cell — the first is not
a whole number of pixels, and the rule below rounds both to 2); and the app's existing geometry
(the pill's padding and 7 px gap, the label row's 10 px line) is kept where the reference
re-drew it. § 5 has the same still beside step 2's capture, with the question being typed.

## 2 — whole device pixels

**One size for every sprite** (amended at step 1's review, built in step 2):
`k = max(1, round(devicePixelRatio))` device pixels to a cell (`veeCell`) — whatever slot the
sprite stands in — the canvas's backing store `16 k` square, its CSS size `16 k ÷ ratio` and its
place centred in the slot on a whole device pixel (`veeBox`). The slot is what the layout sees,
so nothing in § 1 changes with the ratio.

Step 1 rounded each slot on its own, `k = max(1, round(slot × devicePixelRatio / 16))`. That is
the same number at 100, 150, 175 and 250 %; at 125 % and 200 % it drew the header's sprite a
step larger than the two beside it.

Measured at **real** ratios — page zoom, which to the renderer is exactly what display scaling
is, and with which `capturePage` returns the real device pixels (a 1900 × 1000 window; a scratch
harness under `safe-run.cjs`, `webContents.setZoomFactor`; `ratios-one-size/<theme>-<ratio>.png`
are its captures, in both themes — `ratios/` is step 1's, under the per-slot rule). The clock
was pinned once, before the first ratio: every redraw after it came from the app's own
`(resolution: …dppx)` listener.

| ratio | every sprite — header (slot 21), label (19), pill (16) | step 1, where it differed |
|---|---|---|
| 1 | 16 px, 1 a cell — 16 CSS px | |
| 1.25 | 16, 1 — 12.8 | header 32, 2 — 25.6 |
| 1.5 | 32, 2 — 21.33 | |
| 1.75 | 32, 2 — 18.29 | |
| 2 | 32, 2 — 16 | header 48, 3 — 24 |
| 2.5 | 48, 3 — 19.2 | |
| 3 | 48, 3 — 16 | header and label 64, 4 — 21.33 |

At every ratio from 1 to 3, in both themes, **each sprite's captured device pixels equal its
backing store, pixel for pixel — 0 of its opaque pixels differ** (116, 464 or 1 044 of them),
including where the canvas's origin falls between two device pixels (429.75, 937.5 …), which
Chromium snaps — the harness tries the pixel either side and takes the placement that matches.
The label's sprite could be read at 3 this time (it stood at y 716 of the 1000).

## 3 — the palette, and the light theme

`vee-sheet`: each state at two frames at 5 px a cell, then its first frame at the three sizes
the app draws, on `--card` and on `--step-bg`, with the resolved colour of each role under it.

| role | dark (the handoff's `HPAL`) | light (the port's) |
|---|---|---|
| `o` rim | `--accent` `#35C4B6` | `--accent` `#0E8A80` |
| `h` highlight | `#8AF0E4` (new constant) | **`#35C4B6`** (chosen) |
| `b` body | `--step-bg` `#1E2827` | `--step-bg` `#EDF3F2` |
| `t` top facet | `#2B3B3A` (new constant) | **`#CBD8D5`** (chosen) |
| `s` dim | `--border-strong` `#354544` | `--border-strong` `#BFCFCC` |
| `e` eyes | `--ink` `#E4ECEA` | `--ink` `#1B2A2C` |
| `k` visor | `--ground` `#0F1516` | **`--ink`** `#1B2A2C` (chosen) |

Dark is the handoff's seven values exactly, five of them through the app's own tokens. The
owner designed dark only; the three light values were chosen for the same roles:

- **`k` = `--ink`** — the visor is the darkest thing on a light face (13.2 : 1 against the body),
  as `--ground` is the darkest on a dark one.
- **`t` = `#CBD8D5`** — one step darker than the body, at the contrast the dark facet has against
  its body (1.31 : 1 against 1.29 : 1); it lies between `--border` and `--border-strong`, as the
  dark one does.
- **`h` = `#35C4B6`** — lighter than the light rim (1.96 : 1) and darker than the page (1.92 : 1
  on `--step-bg`, 2.16 : 1 on `--card`): the value that balances the two, and the dark theme's
  own accent. On the visor it is the bright pip (6.9 : 1).

What the light sheet shows, state by state: `idle` and `done` read as the dark ones do; the
`thinking` light is a lighter stretch of rim; the `reading` visor is a dark band with a teal pip;
`found` has teal eyes on the pale body — the weakest contrast of the set (1.92 : 1), carried by
the `!` in `--ink` and the hop. In `reading` the pip's two side cells are `--border-strong`,
which on a dark visor is lighter than the pip itself, where the dark theme's are dimmer: the
role is the token the brief names, and the pip still reads as the coloured centre of the bar.

## 4 — the bottom row, now that the pill is wider

The five pieces of the row (`tests/parity/2026-10-01-ui/README.md` § 1b), in the three states and
four sizes that README lists. CSS pixels, both themes alike; the sidebar is open.

**At rest.** The status bar is `[312, 781, 286.91, 27]`, `[312, 716, …]`, `[312, 661, …]`,
`[312, 661, …]` — where it was at all four. The Ask pill is `[1179.09, 774, 88.91, 32]`,
`[1163.09, 709, …]`, `[799.09, 654, …]`, `[659.09, 654, …]`: `right:12px; bottom:14px` at all
four, 22.33 px wider.

**The reset pill alone** (a storey hidden; the action bar is `undo`):

| window | reset pill before | after |
|---|---|---|
| 1280 × 820 | `[698.63, 770.5, 182.73, 35.5]` | the same — on the stage's centre line |
| 1264 × 755 | `[690.63, 705.5, 182.73, 35.5]` | the same |
| 900 × 700 | `[608.91, 650.5, 182.73, 35.5]` — between the zones | `[508.63, 589.5, 182.73, 35.5]` — **above the bars**, centred |
| 760 × 700 | `[438.63, 589.5, 182.73, 35.5]` — above the bars | the same |

**The laser tool, a full action bar, the reset pill** (all five):

| window | status bar | action bar | hint | reset pill | Ask pill |
|---|---|---|---|---|---|
| 1280 × 820 | `[312, 781, 286.91, 27]` | `[312, 751, 284.05, 27]` | `[608.91, 773.2, 522.25, 32.8]` — 1 line | `[608.91, 731.7, 182.73, 35.5]` | `[1179.09, 774, 88.91, 32]` |
| 1264 × 755 | `[312, 716, 286.91, 27]` | `[312, 686, 284.05, 27]` | `[608.91, 708.2, 522.25, 32.8]` — 1 line | `[608.91, 666.7, 182.73, 35.5]` | `[1163.09, 709, 88.91, 32]` |
| 900 × 700 | `[312, 661, 286.91, 27]` | `[312, 631, 284.05, 27]` | `[338.88, 592.2, 522.25, 32.8]` — 1 line, above the bars | `[508.63, 550.7, 182.73, 35.5]` | `[799.09, 654, 88.91, 32]` |
| 760 × 700 | `[312, 661, 286.91, 27]` | `[312, 631, 284.05, 27]` | `[312, 575.41, 436, 49.59]` — 2 lines | `[438.63, 533.91, 182.73, 35.5]` | `[659.09, 654, 88.91, 32]` |

**No two of the five intersect**, in any of the twelve readings, in either theme.

- At 1280 and 1264 px nothing but the Ask pill moved: the laser's 522 px hint still has room for
  one line (544 px between the zones at 1264, where it had 566).
- **At 900 px the centre now stands above the bars.** The bars leave it 180.2 px beside them —
  576 − 286.91 − 88.91 − 2 × 10 — which is less than the reset pill is wide (182.73) and less than
  a hint may be wrapped to (200). With the 66.58 px pill there were 202.5: the pill stood between
  the zones and the hint wrapped to three lines there (`[608.91, 619.61, 202.52, 66.39]`). The
  rule is unchanged (`centrePlace`); the pill's width is what it is given.
- At rest with no room left: the status bar and the Ask pill fit side by side at their own
  offsets down to a 400 px stage — a 700 px window; it was 378 px, a 678 px one. At 701 × 700 the
  pill is `[600.09, 654, 88.91, 32]`; at 690 × 700 it stands against the status bar's end,
  `[598.91, …]`, 2.2 px from the stage's edge instead of 12.

### The row's lane — the gap `2026-10-01-ui` records as not solved

The chat panel stops `bottom:52px` above the stage's foot and the property card 56 px — room
for the row's one line. When the centre zone is taller, the row now says by how much:
`--brow` on the stage (`browFrom`, `selectors/lanes.ts`) is `0px` while the centre zone's top is
within those 52 px — a hint alone (46.8), the reset pill alone (49.5): the design's own layout —
and otherwise what it takes to keep the design's 6 px above it, in whole pixels. The panel's
`bottom` and `max-height`, its resize clamp and the card's `max-height` subtract it.

`vee-lane` is the state that README names: an element selected, the panel open, a tool hint,
something hidden. Meetings are of any of the five with the panel or the card.

| state | window | `--brow` | chat panel before → after | property card before → after | meets, before → after |
|---|---|---|---|---|---|
| laser + panel | 1280 × 820 | `43px` | `[938, 348, 330, 420]` → `[938, 305, 330, 420]` | — | none → none |
| | 1264 × 755 | `43px` | `[922, 283, 330, 420]` → `[922, 240, 330, 420]` | — | none → none |
| | 900 × 700 | `104px` | `[558, 228, 330, 420]` → `[558, 124, 330, 420]` | — | action bar, hint, pill → **none** |
| | 760 × 700 | `121px` | `[418, 228, 330, 420]` → `[418, 113, 330, 414]` | — | action bar, hint, pill → **none** |
| + a selection | 1280 × 820 | `43px` | `[606, 348, 330, 420]` → `[606, 305, 330, 420]` | `[948, 184, 320, 580]` → `[948, 184, 320, 537]` | pill × panel → **none** |
| | 1264 × 755 | `43px` | `[590, 283, 330, 420]` → `[590, 240, 330, 420]` | `[932, 184, 320, 515]` → `[932, 184, 320, 472]` | action bar, pill × panel → **none** |
| | 900 × 700 | `104px` | `[312, 228, 244, 420]` → `[312, 124, 244, 420]` | `[568, 184, 320, 460]` → `[568, 184, 320, 356]` | 4 pairs → **none** |
| | 760 × 700 | `121px` | `[176, 228, 240, 420]` → `[176, 113, 240, 414]` | `[428, 184, 320, 460]` → `[428, 184, 320, 339]` | 5 pairs → **none** |
| the hint gone: pill, panel, card | 1280 × 820 | `0px` | `[606, 348, 330, 420]` → the same | `[948, 184, 320, 580]` → the same | none → none |
| | 1264 × 755 | `0px` | `[590, 283, 330, 420]` → the same | `[932, 184, 320, 515]` → the same | action bar × panel → the same (below) |
| | 900 × 700 | `65px` | `[312, 228, 244, 420]` → `[312, 163, 244, 420]` | `[568, 184, 320, 460]` → `[568, 184, 320, 395]` | 2 pairs → **none** |
| | 760 × 700 | `65px` | `[176, 228, 240, 420]` → `[176, 163, 240, 420]` | `[428, 184, 320, 460]` → `[428, 184, 320, 395]` | 3 pairs → **none** |

- The panel ends 6.7 px above the pill at 1280 × 820 (725 against 731.7): the lane is whole
  pixels, so the clearance is the design's 6 and under 7.
- **With the lane at `0px` every computed style is what it was**: the panel's `bottom` is `52px`
  and its `max-height` `calc(100% - 130px)`; the card's `max-height` `calc(100% - 240px)` — read
  before and after, the same strings. With `43px` they are `95px`, `calc(100% - 173px)` and
  `calc(100% - 283px)`.
- The row's own rectangles are the same with the panel and the card open as without: nothing in
  the row reads the lane, so it cannot feed back into what was measured.

**Not solved, and not in this step.** (1) With the row one line, the chat panel in the card's
lane still lies 6 px across the end of a **full action bar** at the default window
(`[590, 283, …]` over `[312, 686, 284.05, 27]`, whose last 10 px are padding) — as it did
before the row; the lane is the centre zone's, not the bars'. (2) The **colour legend** does not
take the lane: where the centre stands above the bars it is where a legend is, as before.

## 5 — the thinking trace, beside the handoff's stills

`trace/` — one turn on the mock federation, **stepped through with the trace's clock pinned**
(`window.__sgvueDev.trace.pin`, `chat.step`; `scripts/screenshot.cjs`, the `trace-*` states), so
every capture is the same on every run. 1280 × 820, ratio 1, both themes. The sprite clock is
pinned at frame 0 throughout, so a sprite shows the first frame of whatever state the trace
puts it in.

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=trace-01-typing,trace-02-lift,trace-03-thinking,trace-04-reading,trace-05-filtering,trace-06-checking,trace-07-answer,trace-08-done
for T in dark light; do
  SGVUE_MAX_SECONDS=150 SGVUE_DPR=1 SGVUE_SIZE=1280x820 SGVUE_HASH=mock \
  SGVUE_OUT=tests/parity/2026-10-01-vee/trace SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done
```

Each state writes the whole window (`<state>-<theme>.png`, with its `.json`), the panel alone
with the pill under it (`-panel.png`), and that crop enlarged 3× without smoothing
(`-panel-3x.png`) — the stills are frames of a video zoomed onto the panel, and the 3× crop is
what stands beside them.

**The turn.** The handoff asks "Which walls have no fire rating?" of invented numbers — 86
walls, 9 of them. On the mock every wall has a fire rating, so that question would end on
`0 missing`; the same shape of question with a real answer is **"Which walls have no thermal
transmittance?"**: `query_elements` with `IfcEntity = IfcWall` and `ThermalTransmittance is
empty`, run by the real executor — 412 elements, 80 walls, 24 with none, on five storeys. The
turn's events are placed where the reference's are: Send; the first `tool_start` 2.4 s later
(its Read), the call's data 0.1 s after that; `done` 8.2 s after Send (its Answer). The Filter
and the Check are not placed — they start where the trace's own rule puts them, 1.8 s and
3.4 s after Read, which is where the reference's are.

| capture | instant | the handoff's still | what the capture shows |
|---|---|---|---|
| `trace-01-typing` | before Send | `01-at-rest-typing.jpg` | `Which wall` in the composer with the caret after it; the boot audit under `Vee`; the send arrow |
| `trace-02-lift` | Send + 0.45 s | `02-send-lift.jpg` | the typed line 69 % of its way up, at the x its bubble's text will have; its bubble at 41 % and 0.965 of its size; the composer empty, its placeholder not yet back; the button a stop |
| `trace-03-thinking` | Send + 1.9 s | — the folder has no `03` | `You` and the question in place; `Vee`, with `Thinking` mid-shimmer; no bubble yet |
| `trace-04-reading` | Read + 1.3 s | `04-reading.jpg` — its own instant: the count reads 356 | `Reading 4 models · 356 elements`; the wave 95 % across, its last columns still light; Vee `reading` |
| `trace-05-filtering` | Filter + 1.1 s | `05-filtering.jpg` | `Filtering IfcWall · 80 walls`, `IfcWall` in the mono face; two rows of larger cells, the last quarter still landing |
| `trace-06-checking` | Check + 1.35 s | `06-checking-found.jpg` | `Checking Thermal Transmittance · 6 missing`, the 6 in the accent; the beam 62 % across with its trail, three pairs lit behind it, a ring round the pair just found; Vee `found`, its `!` up |
| `trace-07-answer` | Answer + 0.6 s | `07-answer.jpg` — its own instant: three words in, the fourth half way | the status `checked 80 walls · 8s`; `24 of 80` in and `walls` half in; the first four flagged cells leaving for their rows; Vee `done` |
| `trace-08-done` | Answer + 3 s | `08-done.jpg` | the answer with its bold lead and two names in the mono face; the rule; five rows — `L1 5 walls` … `Roof 4 walls` — with their cells; the chip `24 found` |

`trace-150/` is the same chain at a **real ratio of 1.5** — the stills' own scale — through page
zoom on a 1900 × 1000 window (a scratch harness, as § 2's), both themes, `<nn>-<name>-<theme>.png`:
the sprites are 32 device px, and the read grid is one cell per element across the whole bubble,
as in the stills.

### Every difference from the stills

**The adaptations the brief fixes.**

1. **Real numbers.** The question, and everything counted: 80 walls (the stills: 86), 24 with no
   thermal transmittance (9 with no fire rating), five rows `L1`–`L4` and `Roof` (four), and an
   answer written to those numbers. The 412 elements in 4 models are the reference's own. The
   status says `8s`, which is the turn's 8.2 s; the reference's label is the literal `7s` for
   the same 8.2 s.
2. **Bucketing, on whole device pixels.** At ratio 1 the read grid is 206 cells of 2 px at a
   3 px pitch, two elements to a cell, 167 px of the bubble's 282 (the stills: 412 of 2.13 px at
   2.7 px across 278 px); the filter grid's cells are 5 px at 7 px (4.67 at 6.65), the rows'
   7 px at 9 px (6.67 at 9.33); a square under 5 px has square corners. At 1.5 (`trace-150/`)
   they are the reference's numbers rounded — 3 at 4, 7 at 10, 10 at 14 device px — and one
   element a cell.
3. **The existing panel.** The panel is the app's 330 × 420 with its resize corner, and its
   bubble is 282 px inside (the tracing: 286). The label row is the app's 10 px row with its
   `reply` control, on `You` and on `Vee` (the reference draws none). The suggestions are the
   app's own, and fold to one `▸ suggestions` chip once the conversation has a user turn
   (2026-09-24), where the stills keep two pills. A user's bubble keeps its 86 %, so the longer
   question takes two lines. The chip `24 found` under the reply is the tool's own (the
   reference has no chips). Once the answer makes the transcript taller than the panel the log
   scrolls, the boot audit leaves the top, and the log's scrollbar takes its 8 px — the
   bubble is 304 px wide while the trace runs and 296 once it has answered.
4. **The light theme.** The handoff is dark only: the `-light` captures have no still.

**Decided in this build** — each a row in `docs/DECISIONS.md`.

5. **Every cell flashes in the wave.** The reference's 86 future walls do not: its script knows
   what the question will filter to, and overwrites their colour before the wave is over.
6. **The cells of a row start clear of the longest storey name**: 33 px from the text's edge for
   `Roof`, where the stills' `L4` leaves them at 29.3.
7. **24 cells leave 30 ms apart**, not 50: more than fifteen flyers share 0.7 s of stagger, so
   the last has landed 1.95 s after the answer. In `trace-07` four have left; in the still, two
   of nine.
8. **The composer keeps the app's focus ring** (the brief); the reference animates its border.
9. **No camera.** The stills are frames of a camera that zooms onto the panel and dims the
   scene behind it — the video's, the handoff says, not the product's. The captures are the
   panel where it stands.
10. **The sprite's frame.** Pinned at clock frame 0, each state shows its first frame; the
    stills show wherever the video's one frame counter was. At ratio 1 a sprite is 16 px (the
    stills: 28 px at 150 %; `trace-150/`: 32, the nearest whole size).

**Instants.** `02`, `04` and `07` are held where the stills themselves are (read off the stills:
the line's height, the count 356, the fourth word half in). `06` is 0.08 s later than its still
— the beam at 62 % rather than 57 — so that a ring is on screen, as it is in the still.

### Measured (ratio 1, both themes alike; CSS px `[x, y, w, h]`)

| | |
|---|---|
| panel | `[938, 348, 330, 420]` in all eight — where it was |
| log | `clientWidth` = `scrollWidth`: 328, and 320 once it scrolls (before this step: 348 against 320) |
| `You` row, settled | label `[951, 485.75, 67.83, 10]`; bubble `[951, 499.75, 261.44, 54.75]`; its text `[962, 507.75, 239.44, 38.75]` |
| the lift, `trace-02` | the line `[962, 576.95, 239.44, 38.75]`, on its way from y 727.56 to 507.75 — x 962 throughout, the composer's text x (951 + 1 + 10) and the bubble's (951 + 11); its bubble `[951, 500.71, 252.24, 52.82]` at opacity 0.414 and scale 0.965; the stop square at 0.988 |
| send button | `[1223, 723, 32, 32]`; the stop square `[1235, 735, 8, 8]`, radius 2 px |
| live reply, `trace-03` | row `[951, 563.5, 304, 14]`; label `[951, 563.5, 87.58, 10]` — **10 px, as every label row**; sprite slot `[949, 557.5, 19, 19]`; `Thinking` 39.92 px wide |
| trace bubble, `trace-04`–`06` | `[951, 577.5, 304, 52]`; ticker `[962, 586.16, 282, 14.66]`; canvas 304 × 52 device px |
| read grid | 206 cells of 2 px, pitch 3 px, 53 columns (18 + 31 + 3 + 1), rows at y 31 / 34 / 37 / 40 from the bubble's top, x 0–167 |
| filter grid | 80 cells of 5 px, pitch 7 px, 2 × 40, rows at y 31 / 38, x 0–278 |
| beam, `trace-06` | x 175.1 of 282, 6 cells lit of the 24 |
| answered, `trace-08` | label `[951, 476.5, 192.42, 10]`; status `checked 80 walls · 8s` 100.59 px wide; bubble `[951, 490.5, 296, 148.05]`; text `[962, 498.5, 274, 38.75]`; rule `[962, 541.25, 274, 1]`; rows `[962, 545.25, 274, 17.33]` … `[962, 614.56, 274, 17.33]`; 24 cells of 7 px at a 9 px pitch from x 33 |

The same rows read back from the built app, with no dev harness, in
`tests/e2e/vee-trace.spec.ts`: the steps in order with their counts (`Reading 4 models` up to
412, `Filtering IfcWall` down to 80, `Checking Thermal Transmittance` up to 24), the bubble at
52 px and the log's width, the rows `L1 5 walls` … `Roof 4 walls`, a click on `Roof` selecting
4.

## What was run

Step 1: `npm run typecheck` · `npm test` · `npm run build` · `npm run test:e2e` · the evaluation
suite's oracle and null runs (no API) · `scripts/frame-triggers.cjs` (28 of 28; 0 scene renders
in 2 s at rest — the sprite clock does not draw the 3D scene).

Step 2: the same six, and `frame-triggers.cjs` gains the trace — a turn stepped in real time:
about 410 (one per display frame) trace frames and 0 scene renders in the 6.8 s it ran, 119 and
0 in the 2.2 s of the answer, 0 and 0 in the 2 s after it, the loop idle. `PROGRESS.md` has the
numbers.

The sprite clock, counted (`window.__sgvueDev.vee.wakes()` — it sleeps between the frames at
which a mounted sprite's drawing changes, where step 1's ticked 8 times a second): the pill
alone, 7 s — **4 wakes**, one at each end of two blinks; three idle sprites, 7 s — **12**, where
it was 56 ticks for the same 12 repaints; a reply's sprite `thinking`, 2 s — 17 (16, and one
blink's edge); `reading`, 1 s — 8; one `done` beside three idle, 7 s — 26. Step 1's counts still
hold: the window minimised, 5 s — 0; pinned — 0; a theme switch — one repaint each.
