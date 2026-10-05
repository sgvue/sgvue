# 2026-10-01 — five owner-requested changes to the main window

Not a parity phase: the design has none of these, so nothing here is differenced against the
prototype. It is a **before / after** of the app against itself — `before/` is `d16f393`,
`after/` is this change — on the design's mock federation at **1280 × 820**, the default
window, in both themes. `after-b/` is a second capture of the same build, which is how the
harness's own run-to-run noise is measured.

The five requests, in the owner's words, are in `CLAUDE.md` (allowed desktop deviations,
2026-10-01) and `docs/DECISIONS.md`:

1. undo / redo and the markup counts leave the status bar for an **action bar** above it;
2. the toolbar is **five groups with dividers**, Schedules alone and last;
3. the property card's clipped texts carry their **whole text on hover**;
4. the element tree is **eye-first**, like STOREYS and MODELS;
5. a model's **file path on hover** — its MODELS row, its library row, its Recent pill.

The PNGs and their `.json` sidecars are git-ignored, like every capture under `tests/parity/`;
this file is what is kept.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
for T in dark light; do
  for S in "default,view-plan,ui-tree-open,ui-propcard" "ui-marks,ui-actionbar,ui-laser"; do
    SGVUE_SIZE=1280x820 SGVUE_HASH=mock SGVUE_OUT=tests/parity/2026-10-01-ui/after \
    SGVUE_THEMES=$T SGVUE_STATES=$S node scripts/safe-run.cjs screenshot.cjs
  done
done
```

Two chains, each on a fresh window per theme (`scripts/screenshot.cjs`, `APP_ONLY_STATES`):

| state | what it shows |
|---|---|
| `default` | the toolbar in the 3D view, beside the view cube |
| `view-plan` | the same in Plan, where the cube's compass ring is a full circle |
| `ui-tree-open` | the tree's first group open: a group row and its element rows |
| `ui-propcard` | a tree (`IfcGeographicElement`) selected: a clipped tile, clipped set headers |
| `ui-marks` | a storey hidden, colour by Level, three laser measures |
| `ui-actionbar` | … plus two spots and the Markups card open |
| `ui-laser` | … the card closed and the laser tool active: all five pieces of the bottom row (`after/` and `after-b/` only — the state came with the row, and `before/` was not captured again) |

The canvas points in `ui-marks` and `ui-actionbar` are the 1280 × 820 window's own CSS pixels.

## 1 — the bottom-left corner

`ui-actionbar`: a storey hidden (92 elements, so `undo` and the reset pill), three measures, two
spots, colour by Level, the Markups card open. CSS pixels `[x, y, w, h]`, the same in both
themes.

| | before | after |
|---|---|---|
| status bar | `[312, 781, 575.56, 27]` — `WebGL2 · 60 fps · 320 / 412 · mm · — · undo · 3 measures clear · 2 spots clear` | `[312, 781, 286.91, 27]` — `WebGL2 · 60 fps · 320 / 412 · mm · —` |
| action bar | — | `[312, 751, 284.05, 27]` — `undo · 3 measures clear · 2 spots clear` |
| reset pill | `[698.63, 770.5, 182.73, 35.5]` | the same |
| colour legend | `[312, 573.91, 230, 204.09]` | `[312, 543.91, 230, 204.09]` |
| Markups card | `[312, 66, 330, 275]` | the same |

**Before**, the status bar ran under the whole of the reset pill: its right edge at 887.6, past
the pill's own at 881.4. **After**, no two of the five rectangles intersect:

- the status bar is its five fields at any time — 286.91 px wide at rest and with everything
  above done — and ends 99.7 px left of the pill;
- the action bar is the status bar's own card, 27 px tall (the status bar's measured height),
  3 px above it (751 + 27 = 778 against 781), and ends 102.6 px left of the pill;
- the legend stands 3 px above the action bar (543.91 + 204.09 = 748 against 751): its
  computed `bottom` is `72px` and its `max-height` `calc(100% - 156px)`;
- the Markups card's `max-height` is `calc(100% - 140px)`; its bottom edge (341) is 203 px
  above the legend's top. The Spatial-structure card, opened in the same state, is
  `[312, 66, 340, 680]`: 5 px above the action bar, the 5 px it kept from the status bar before
  (`[312, 66, 340, 710]` against 781).

**With the bar absent every computed length is what it was**: `--abar` is `0px`, the legend's
`bottom` is `42px` and its `max-height` `calc(100% - 126px)` (`[312, 573.91, 230, 204.09]`),
and both cards' `max-height` is `calc(100% - 110px)` — read at rest, and again after `clear`
with the Markups card still open.

At the real default window on Windows (1264 × 755 inside): status bar
`[312, 716, 286.91, 27]`, action bar `[312, 686, 284.05, 27]`, reset pill
`[690.63, 705.5, 182.73, 35.5]` — the same gaps, 91.7 px and 94.6 px clear of the pill.

## 1b — the bottom row

The action bar alone left the rest of the bottom edge as the design has it: five pieces, each
positioned without knowing the others — the status bar and the action bar (`left:12px`), the
hint bar and the reset pill (both `bottom:14px; left:50%`, the pill drawn over the hint) and the
Ask pill (`right:12px`). Measured that way, with the laser tool active (its hint is 522 px on
one line), a storey hidden and the action bar full: at 1280 × 820 the status bar covered the
hint's left 70 px, the action bar 67 px of its top edge, and the pill 183 px of its middle; at
900 × 700 and 760 × 700 six pairs of the five met, and the pill alone lay across the status bar
by 90 px and 160 px.

They are now the three zones of one grid row (`app/BottomRow.tsx`) — the action bar above the
status bar · the hint, the reset pill above it · the Ask pill — and a grid's tracks cannot
overlap. `ui-laser` is the state with all five on screen. CSS pixels `[x, y, w, h]`, read in
both themes and the same in both; the sidebar is open, so the stage is the window less 300 px:

| window | status bar | action bar | hint | reset pill | Ask pill |
|---|---|---|---|---|---|
| 1280 × 820 | `[312, 781, 286.91, 27]` | `[312, 751, 284.05, 27]` | `[608.91, 773.2, 522.25, 32.8]` — 1 line | `[608.91, 731.7, 182.73, 35.5]` | `[1201.42, 774, 66.58, 32]` |
| 1264 × 755 | `[312, 716, 286.91, 27]` | `[312, 686, 284.05, 27]` | `[608.91, 708.2, 522.25, 32.8]` — 1 line | `[608.91, 666.7, 182.73, 35.5]` | `[1185.42, 709, 66.58, 32]` |
| 900 × 700 | `[312, 661, 286.91, 27]` | `[312, 631, 284.05, 27]` | `[608.91, 619.61, 202.52, 66.39]` — 3 lines | `[608.91, 578.11, 182.73, 35.5]` | `[821.42, 654, 66.58, 32]` |
| 760 × 700 | `[312, 661, 286.91, 27]` | `[312, 631, 284.05, 27]` | `[312, 575.41, 436, 49.59]` — 2 lines | `[438.63, 533.91, 182.73, 35.5]` | `[681.42, 654, 66.58, 32]` |

**No two of the five intersect**, at any of the four sizes, in this state or in the others
measured: at rest, the pill alone, the spot tool's 360 px hint with the pill and without it.

- The hint starts 10 px right of the wider bar (598.91 + 10) on the design's own `bottom:14px`
  line, instead of running under it; the pill stands 6 px above the hint, over its start.
- At 900 px the bars leave the centre 202.5 px, so the hint wraps to three lines there. It is
  never wrapped narrower than 200 px (`HINT_MIN`).
- At 760 px they leave 62.5 px, less than the pill is wide, and the pill does not wrap — a plain
  grid track let it overflow on to both neighbours, and wrapped the hint into a 62 px column of
  fifteen lines. So there the centre stands **above** the bars instead, on a row of its own
  (`centrePlace`, measured): the hint on two lines 6 px above the action bar, the pill 6 px above
  the hint.

**What did not move.** The status bar, the action bar and the Ask pill have the rectangle they
had before the row in every state and at every size measured (20 readings a theme). At rest,
against a build of `d16f393` driven the same way, the status bar's and the Ask pill's regions
differ by **0 px** at 1280 × 820 and at 1264 × 755, in both themes. The reset pill alone is
where the design centres it — `[698.63, 770.5, 182.73, 35.5]` and `[690.63, 705.5, 182.73,
35.5]`, the rectangles it has on `d16f393` — and the spot tool's hint alone is on the stage's
centre line at 1280 × 820 (`[609.84, 773.2, 360.3, 32.8]`, 609.85 before). Inside the pill's
unchanged rectangle 571 / 452 px (1280 × 820, dark / light) and 589 / 455 px (1264 × 755)
differ, by at most 37 / 93 of 255 in a channel, all of them in the rounded ends of the pill and
of its `reset` button: the two outlines are drawn at a layout position now and no longer through
`translateX(-50%)`. The label and the word `reset` are pixel-identical. Narrower, the pill alone
is 10 px right of the status bar at 900 px (`[608.91, 650.5, …]`, where `[508.63, …]` lay
across it) and above the bars at 760 px (`[438.63, 589.5, …]`).

With nothing in the centre no gap is kept for it: at 690 × 700 and 683 × 700 — a stage with
room for the status bar and the Ask pill and little more — both stand at the design's offsets
(`[312, 661, 286.91, 27]`; `[611.42, 654, 66.58, 32]` and `[604.42, …]`).

**What the row does not solve.** The chat panel, the property card and the colour legend are
not zones of it, and each stops a fixed distance above the stage's foot — 52 px, 56 px, and
3 px above the bars — which is room for the row's one line and not for a second level:

- **selection + the chat panel open + a tool hint + something hidden**, at the default window:
  the chat panel stands in the card's lane (`[590, 283, 330, 420]` at 1264 × 755) and covers the
  whole of the pill above the hint (`[608.91, 666.7, 182.73, 35.5]`). With the chat panel open
  and nothing selected (`[922, 283, 330, 420]`) the pill is 130 px clear of it — which is why it
  stands over the hint's start and not its middle, where 39 px of it would be under the panel;
- the chat panel open in a window of **900 px or less**: it covers the pill and the top 28 px
  of the wrapped hint (`[558, 228, 330, 420]` at 900 × 700), and 38 px of a full action bar as
  it did before the row; at 760 px, 178 px of it;
- the colour legend in a window where the centre stands **above** the bars (760 px): the
  hint and the pill are where the legend is (`[312, 423.91, 230, 204.09]`).

All three want the same thing: the row's height declared as a lane, the way `--abar` is, for
the chat panel, the card and the legend to clear. Not built — it is a decision, not a fix.

*(Later the same day: built for the chat panel and the property card — `--brow`, the centre
zone's height above one line — which closes the first two. The legend does not take it. The Ask
pill has read `Ask Vee` since then and is 88.91 px wide, so its rectangles above, and where the
centre stands at 900 px, are that change's "before": `tests/parity/2026-10-01-vee/README.md` § 4
has the row as it is now.)*

Below a stage of 378 px — a 678 px window with the sidebar open — the status bar and the Ask
pill no longer fit side by side at their own offsets. The design overlapped them there; the
row keeps the Ask pill against the status bar and lets it run past the stage's edge instead
(by 5.5 px at 660 × 700, 25.5 px at 640 × 700).

## 2 — the toolbar

`default` and `view-plan`. Before: four groups, `column-gap:10px`, **741.03 px**. After: five
groups and four 1 × 18 px dividers, `column-gap:4px`, **737.03 px** — 4 px narrower, one row.

| | before | after |
|---|---|---|
| toolbar | `[419.48, 12, 741.03, 42]` | `[421.48, 12, 737.03, 42]` |
| groups | 126 · 126 · 94 · 351.03 | 126 · 94 · 158 · 279.03 · 30 |
| dividers | — | x = 558.48, 661.48, 828.48, 1116.52 |
| last button | Light / dark `[1123.52, 18, 30, 30]` | Schedules `[1121.52, 18, 30, 30]` |

The cube's canvas is `[1124, 8, 148, 148]`, so 840 of the Schedules button's 900 px lie under
it. What the cube draws there is asked of the cube itself (`viewer/cube.ts` takes a mouse's
events only over its zones, compass ring, north kite and `N`), one probe per pixel:

| window | view | cube pixels under the last button | under the toolbar's whole box | nearest drawn pixel to the button |
|---|---|---|---|---|
| 1280 × 820 | 3D | **0** (before 0) | **0** (before 2) | 7.43 px (before 6.49) |
| 1280 × 820 | Plan | **0** (before 0) | **0** (before 4) | 8.83 px (before 7.14) |
| 1264 × 755 | 3D | **0** (before 0) | 17 (before 25) | 4.27 px (before 3.90) |
| 1264 × 755 | Plan | **0** (before 0) | 30 (before 45) | 2.49 px (before 1.11) |

1264 × 755 is what the default 1280 × 820 window measures inside on Windows; there the toolbar
is `[413.48, 12, 737.03, 42]`, the Schedules button `[1113.52, 18, 30, 30]` — wholly under the
canvas `[1108, 8, 148, 148]` — and the cube's drawing (its corner in 3D, its compass ring in
Plan) crosses the toolbar's bottom-right padding, as it did before, over fewer pixels.

Wrapped (the sidebar open, so the stage is the window less 300 px):

| window | rows | dividers hidden |
|---|---|---|
| 900 × 700 | tools · panels · show / view · Schedules — `[312, 12, 576, 77]` | 1 (after show) |
| 760 × 700 | the same — `[312, 12, 436, 77]` | 1 |
| 640 × 700 | tools · panels / show / view / Schedules — `[312, 12, 316, 147]` | 3 |

No visible divider ends a row or starts one. A hidden one keeps its 1 px and its two gaps, so
its row sits 2.5 px off centre.

Colours, read back: dividers `--border-strong` (`rgb(53, 69, 68)` dark, `rgb(191, 207, 204)`
light); the Schedules button `--accent-ink` on a 1 px `--accent` outline, no fill
(`rgb(79, 211, 196)` / `rgb(53, 196, 182)` dark, `rgb(10, 106, 98)` / `rgb(14, 138, 128)` light).

## 3 — the property card

`ui-propcard`: `Tree T01 Angsana`. Titles read back from the DOM: the four tiles
`IfcGeographicElement` (drawn `IfcGeographicEl…`), `VEGETATION`, `Angsana 200mm girth` (drawn
`Angsana 200mm g…`) and `L1`; the set headers `SGPset_Planting`,
`Pset_GeographicElementCommon`, `Qto_GeographicElementBaseQuantities` over the drawn
`Planting`, `Geographic Element Common`, `Geographic Element Base Quantities`; and each
property name, `Species Botanical Name` (drawn `Species Botanical Na…`) among them. No span the
card clips is left without one.

Nothing drawn moved: the card's own rectangle differs from `before/` by **0 px** (dark) and
**3 px** (light) — and `after/` from `after-b/`, the same build twice, by 3 and 3.

## 4 — the element tree

`ui-tree-open`, x of each 24 px eye button from the window's left edge:

| | before | after |
|---|---|---|
| MODELS eye | 14 | 14 |
| STOREYS eye | 16 | 16 |
| group eye | 251 (the row's right end) | **16** |
| element eye | 253 (the row's right end) | **31** |
| group chevron (14 px column) | 16 | 261 |

The group eye is on the storey eye's own x. The group row is still 269 × 34 px and an element
row 252 × 36.89 px.

## 5 — a file's path on hover

Native `title`s, so nothing to capture: `tests/e2e/smoke.spec.ts` reads them back on the
committed fixture — the model row's name block, the `library` popover's row and the Recent
pill all carry the path the session recorded — and checks that the demo building's rows, which
have no file, carry none.

## What did not change

Differing pixels, `before/` against `after/`, the twelve captures both sets have (`ui-laser` is
`after/`'s alone):

| region | px differing |
|---|---|
| the sidebar above the tree (brand, project, search, MODELS, STOREYS) | **0** in all twelve |
| the status bar, where nothing has been done (`default`, `view-plan`, `ui-tree-open`) | **0** in all six |
| the Ask pill — same rectangle, `[1201, 774, 67, 32]` | **0** in all twelve |
| the Markups card (`ui-actionbar`) | **0** |
| the property card (`ui-propcard`) | 0 / 3 |
| the legend, compared in its own box at its old and new place | 46 / 50 — its rounded corners over a different backdrop |

The toolbar (8 707–8 741 px), the tree (2 340–6 056 px) and the bottom-left corner of the two
`ui-marks` / `ui-actionbar` states differ, as intended. The rest is the 3D overlay's grid
bubbles and dimension labels, which differ by up to 7 032 px between `after/` and `after-b/` —
two captures of the same build. Between those two the sidebar, the tree, the legend, the
Markups card and the Ask pill are 0 in all twelve; the toolbar is 0 in eleven and 2 px in one
(two of its corner pixels, over the 3D); the status bar is 0 in eleven and 55 px in one (the
frame-rate digit, which is also all that separates `ui-propcard`'s status bar from `before/`'s:
`59 fps` against `60 fps`); the property card is 3 / 3 px. In `ui-laser` all five pieces of the
bottom row are 0 px between the two, in both themes.
