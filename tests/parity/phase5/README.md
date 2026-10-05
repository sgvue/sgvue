# Phase 5 — design parity captures (visibility, the filter stack, activate, undo, viewpoints)

Same method as Phases 3 and 4: both sides captured **whole** (`SGVUE_BARE=0` on the prototype),
both driven through their own real click handlers by the same helper text, and the difference
measured **per surface** — chrome, the two left-lane cards, the temporary-state pill, the status
bar and the 3D stage separately — so the r170 / 0.186 hemisphere-light difference written up in
`../phase2a/README.md` stays where it belongs.

**The PNGs, the JPEGs and the `*.json` rectangle sidecars are git-ignored.** The commands and
the measured numbers below are what belongs in the repository.

Every Electron run goes through `scripts/safe-run.cjs`, which refuses to start a second dev
Electron and kills any survivor afterwards; the guard inside each run polls the GPU helper's
`phys_footprint` every 250 ms. See `CLAUDE.md` for the three kernel panics that put it there.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=filter-empty,filter-isolate-L2,filter-isolate-L2-hide-windows,frame-filter,filter-step-disabled,filter-highlight-walls,filter-three-highlights,filter-saved-set,activate-ARC,frame-manual,undo-after-hide,viewpoints-one-saved

# the app, on the design's own mock federation
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase5/app SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done

# the prototype, same states, same window, same clicks
python3 -m http.server 8765 --directory design-reference/design &
for T in dark light; do
  SGVUE_BARE=0 SGVUE_OUT=tests/parity/phase5/prototype SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs parity-prototype.cjs
done
```

`UI`, `PROP_STATES`, `FILTER_STATES` and `RECTS` are written out **byte-identically** in both
scripts (3 135 / 1 302 / 1 578 / 3 449 bytes; the Build Report carries the `python3` check that
asserts it).

**Every state is driven through the designed controls by their own copy.** `+ add filter step`,
the property `<select>`, the value field, `isolate` / `hide` / `highlight`, the step eye, the
step on/off pill, `clear`, `save current`, the banner's `reset`, the status bar's `undo`, the
model row's activate target, `Save current view` — all found by visible text or by the `title` /
`data-tip` the port keeps verbatim, so the same selector finds the same control on both sides.
A `<select>` needs the *select* prototype's value setter plus a `change` event, for the same
reason `typeInto` needs the input prototype's and an `input` event; `pickOption` in the shared
`UI` block does that.

**Both sides clear `localStorage` before loading.** Saved filter sets and viewpoints are
persisted under the design's own keys (`ifc-viewer:filtersets`,
`ifc-viewer:viewpoints:<building>`), so without it a second run would open with the first run's
sets already in the card and save `Viewpoint 2` instead of `Viewpoint 1`.

The states run **in order**, each building on or undoing the last:

| state | what it does |
|---|---|
| `filter-empty` | opens the card: the "No filter steps" copy, `+ add filter step`, `saved sets` |
| `filter-isolate-L2` | one step, `Level = L2`, 92 matched |
| `filter-isolate-L2-hide-windows` | a second step, `IfcEntity = IfcWindow`, action `hide`, 55 matched |
| `frame-filter` | the card closed, so the **accent** frame and `2 filter steps — 334 hidden` are whole |
| `filter-step-disabled` | step 1's eye off — the badge goes faint, step 2 re-expands |
| `filter-highlight-walls` | `clear`, then one highlight step on `IfcEntity = IfcWall` |
| `filter-three-highlights` | two more highlight steps; where they overlap the later colour wins |
| `filter-saved-set` | `save current` — the chip appears under `saved sets` |
| `activate-ARC` | stack cleared, card closed, ARC activated: the others go inert |
| `frame-manual` | activate left, storey `L2` hidden by its eye — the **amber** frame |
| `undo-after-hide` | `L3` hidden too, then one `undo`: the status bar carries **both** links |
| `viewpoints-one-saved` | banner `reset`, then Viewpoints → `Save current view` |

## The mask, and what the sidecars answer

Each capture writes its surfaces' `getBoundingClientRect()`s beside the PNG. Phase 5 adds
`filter` and `views` (the left-lane cards, found by their own heading among the absolutely
positioned z-index-14 boxes) and the two halves of the temporary-state frame — `frame`, the
3 px border at z-index 6, and `framePill`, the pill at the same depth.

Four readbacks go with them, so a state that produced a *different view* is visible in the
sidecar rather than only in the pixels: `filterText` and `viewsText` (every line of the two
cards, the step rows and their live counts included), `frameLabel` (the banner's own copy) and
`frameTone` (the computed `border-top-color` of the frame — the amber/accent decision as a
number), plus `statusText`, where `undo` and `redo` appear.

**Both sides answered every one of them identically: 24 sidecars compared field by field, 0
differences** — every rectangle, every card line, both frame tones, both banner labels and the
status bar's tail. Worth naming a few:

| readback | both sides |
|---|---|
| step rows, two steps | `1 · isolate · Level = L2 · 92` and `2 · hide · IfcEntity = IfcWindow · 55` |
| three highlight steps | `IfcEntity = IfcWall · 80`, `Level = L2 · 92`, `IfcEntity = IfcSlab · 5` |
| the property `<select>` | the same 50 `propKeys` in the same order, `Model` first |
| frame tone, filter-driven | `rgb(53, 196, 182)` — `--accent` |
| frame tone, manual hide | `rgb(74, 58, 28)` — `--warn-line` |
| banner, filter-driven | `2 filter steps — 334 hidden` |
| banner, manual hide | `92 elements hidden` |
| status bar after one undo | `… · 320 / 412 · mm · SVY21 · undo redo` |
| the viewpoint | `Viewpoint 1` / `3D` |
| card boxes | filter 340 × 165…480, viewpoints 300 × 189 |

The measured regions are: `chrome` = everything outside the stage plus the toolbar, the
Spatial-structure card and the hint bar, minus the status bar, the two Phase 5 cards and the
banner pill; `card` = the union of the two sides' `filter` / `views` rectangles; `pill` = the
union of the two `framePill`s; `status` with only the backend name and the fps digits clipped
out, so `undo` / `redo` **are** measured; `stage 3D` = the stage minus every chrome surface —
which includes the frame's own 3 px border, since it is drawn over the viewport.

## Measured difference per state

`mean` is the mean absolute per-channel difference over the region (0–255); `>12` is the share
of its pixels differing by more than 12 in any channel. 1440 × 860 at devicePixelRatio 2.
`—` means neither side drew that surface in that state.

### dark

| state | chrome / >12 | card / >12 | pill | status | stage 3D / >12 |
|---|---|---|---|---|---|
| filter-empty | 0.02 / 0.03 % | 0.01 / 0.00 % | — | 0.01 | 2.73 / 5.19 % |
| filter-isolate-L2 | 0.02 / 0.03 % | 0.01 / 0.02 % | 0.19 | 0.01 | 1.83 / 3.15 % |
| filter-isolate-L2-hide-windows | 0.02 / 0.03 % | 0.01 / 0.02 % | 0.17 | 0.01 | 1.85 / 3.23 % |
| **frame-filter** | **0.05 / 0.33 %** | — | 0.17 | 0.01 | 1.74 / 2.78 % |
| filter-step-disabled | 0.02 / 0.03 % | 0.01 / 0.02 % | 0.24 | 0.01 | 2.92 / 5.83 % |
| filter-highlight-walls | 0.02 / 0.03 % | 0.01 / 0.02 % | — | 0.01 | 2.23 / 5.21 % |
| filter-three-highlights | 0.02 / 0.03 % | 0.01 / 0.02 % | — | 0.01 | 2.24 / 6.00 % |
| filter-saved-set | 0.02 / 0.03 % | 0.01 / 0.02 % | — | 0.01 | 2.25 / 6.08 % |
| activate-ARC | 0.02 / 0.03 % | — | — | 0.01 | 2.43 / 6.44 % |
| frame-manual | 0.02 / 0.03 % | — | 0.17 | 0.01 | 2.60 / 4.50 % |
| undo-after-hide | 0.02 / 0.03 % | — | 0.17 | 0.01 | 2.60 / 4.51 % |
| viewpoints-one-saved | 0.02 / 0.03 % | 0.03 / 0.06 % | — | 0.01 | 2.73 / 5.21 % |

### light

| state | chrome / >12 | card / >12 | pill | status | stage 3D / >12 |
|---|---|---|---|---|---|
| filter-empty | 0.02 / 0.03 % | 0.03 / 0.00 % | — | 0.06 | 7.18 / 6.28 % |
| filter-isolate-L2 | 0.02 / 0.03 % | 0.03 / 0.03 % | 0.58 | 0.05 | 7.10 / 4.71 % |
| filter-isolate-L2-hide-windows | 0.02 / 0.03 % | 0.03 / 0.03 % | 0.54 | 0.05 | 7.12 / 4.80 % |
| **frame-filter** | **0.08 / 0.33 %** | — | 0.54 | 0.05 | 7.00 / 4.18 % |
| filter-step-disabled | 0.02 / 0.03 % | 0.03 / 0.03 % | 0.65 | 0.05 | 7.19 / 6.95 % |
| filter-highlight-walls | 0.02 / 0.03 % | 0.03 / 0.02 % | — | 0.05 | 7.03 / 6.60 % |
| filter-three-highlights | 0.02 / 0.03 % | 0.02 / 0.02 % | — | 0.05 | 6.97 / 7.27 % |
| filter-saved-set | 0.02 / 0.03 % | 0.02 / 0.02 % | — | 0.05 | 6.96 / 7.36 % |
| activate-ARC | 0.02 / 0.04 % | — | — | 0.05 | 7.28 / 7.61 % |
| frame-manual | 0.02 / 0.03 % | — | 0.61 | 0.05 | 7.00 / 5.52 % |
| undo-after-hide | 0.02 / 0.03 % | — | 0.61 | 0.04 | 7.00 / 5.53 % |
| viewpoints-one-saved | 0.02 / 0.03 % | 0.04 / 0.07 % | — | 0.05 | 7.17 / 6.29 % |

**The Filter card and the Viewpoints card are 0.01–0.04 of 255 in every state**, both themes —
step rows, action badges in their fixed-ink highlight colours, the ↑ ↓ ×, the rule builder with
its two `<select>`s and its datalist field, the join pill, the colour chips, the saved-set chip,
the segmented control, the match line and the step on/off pill. The temporary-state pill is
0.17–0.24 (dark) / 0.54–0.65 (light), which is glyph antialiasing on a coloured ground. The
status bar is 0.01–0.06 **with `undo` and `redo` measured**. The 3D stage is the same
1.7–2.9 / 7.0–7.3 hemisphere-light band Phases 2a, 3 and 4 measured.

## Everything that is visibly different — the complete list

**One thing, in one state: the toolbar's Filter button in `frame-filter`.** It is a single
30 × 30 box at CSS x 706…736, y 18…47 — 3 456 of the 3 765 chrome pixels over 12; the remaining
309 are the same glyph-edge antialiasing every other state shows. Sampled at its centre:

| | app | prototype |
|---|---|---|
| dark | `rgb(26, 47, 45)` (`--sel-bg`) | `rgb(25, 31, 32)` (`--card`) |
| light | `rgb(229, 240, 238)` (`--sel-bg`) | `rgb(255, 255, 255)` (`--card`) |

This is the `tb.filter` decision, and it is deliberate. The design writes
`filter: on(s.card === 'filter' || s.filterOn)` (`SGVue.dc.html:1951`), but `filterOn` is one of
the undeclared state keys plan §3.5 defect 8 drops — nothing ever sets it, so in the prototype
the button lights **only** while its card is open. The intent is unmistakable from the control
one place over, `section: on(s.card === 'section' || !!s.section.kind)`: a live filter should
light its button the way a live section lights Section. So this build lights it when the card is
open **or** any step is switched on, which is why closing the card over two live steps leaves it
lit here and not there. In `filter-empty` — card open, no steps — both sides render the button
identically (`rgb(26, 47, 45)` on both).

Nothing else. In the other eleven states, in both themes, every rectangle matched, every
readback matched, and no region outside the 3D stage exceeded 0.07 % of pixels over 12.

## The mock-adapter change, and the proof it moved nothing

Phase 4's review left one mock-only difference open: the property card's Geometry row read
`4 solids` where the prototype read `1 solid`, because the adapter mapped **each box** to a
geometry part while `viewer-core.js:119` merges each colour group into one mesh with
`mergeBoxes`. `src/renderer/dev/mock-adapter.ts` now merges per colour group — one part per
group, its boxes concatenated in group-local space with the part matrix carrying the placement,
so the instancing the real pipeline is measured on is kept. The mock federation goes from 590
parts to **516**, and a wall split around its opening is one solid, as the prototype's is.

It changes no pixel. Recapturing Phase 3's `default` state and comparing against the
pre-merge PNG on disk:

| | pre-merge app vs post-merge app | post-merge app vs prototype | pre-merge app vs prototype |
|---|---|---|---|
| dark | mean **0.000**, 0.00 % over 12, max 13 | 2.005 / 3.73 % | 2.005 / 3.73 % |
| light | mean **0.000**, 0.00 % over 12, max 24 | 5.418 / 4.52 % | 5.418 / 4.52 % |

The app-vs-prototype figures are identical to three decimals before and after; the handful of
single-pixel differences are the sub-pixel re-registration a changed vertex order gives on an
edge, the same effect Phase 2b's merged-geometry change measured.

```sh
SGVUE_HASH=mock SGVUE_OUT=<scratch>/p5-spot SGVUE_THEMES=dark,light SGVUE_STATES=default \
  node scripts/safe-run.cjs screenshot.cjs
```

## Regenerating the table

Phase 3's script with `base = 'tests/parity/phase5'`, the `filter` / `views` rectangles added to
the card region, `framePill` as its own region, and the status clip reduced to the backend name
and the fps digits (Phase 5 wants `undo` / `redo` measured). The Build Report carries the exact
variant used.

## The real-model run

`scripts/shell-sanity.cjs` grew a Phase 5 block: with the property card closed, build two filter
steps through the card — isolate the busiest storey, then highlight `IfcWall` — timing each one
from the keystroke that completes it to the frame that shows it, then orbit for four seconds.

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
SGVUE_IFC="samples/Sample Ifc Model.ifc" SGVUE_OUT=tests/parity/phase5/big-model.png \
  node scripts/safe-run.cjs shell-sanity.cjs
```

26 761 elements, 12 storeys, 15.98 s from file to a filled shell.

| step | rule | matched | apply → painted | status bar |
|---|---|---|---|---|
| 1 isolate | `Level = 1st Storey` | **6 924** of 26 761 | **55.3 ms** | `6924 / 26761 · mm · SVY21 · undo` |
| 2 highlight | `IfcEntity = IfcWall` | **3 314** of 26 761 | **65.1 ms** (rule) · **71.8 ms** (action) | `6924 / 26761` |

With both steps live: **45 fps median while orbiting** (58–62 fps stationary), **94 draw calls**
a frame, 6 865 of 26 539 renderable elements visible. The GPU helper sat at
**1 464–1 562 MB** through the filter block and the renderer at 1 412–1 595 MB; the guard's
2 500 / 6 000 MB limits were never approached and no run left a process behind.
`big-model-filter.png` beside this file is that frame.
