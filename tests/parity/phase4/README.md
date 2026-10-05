# Phase 4 — design parity captures (selection, the property card, the context menu)

Same method as Phase 3: both sides captured whole (`SGVUE_BARE=0` on the prototype), the
difference measured **per surface** — chrome, property card, context menu, status bar and the
3D stage separately — so the r170 / 0.186 hemisphere-light difference written up in
`../phase2a/README.md` stays where it belongs and does not swamp this phase's numbers.

**The PNGs, the JPEGs and the `*.json` rectangle sidecars are git-ignored.** The commands and
the measured numbers below are what belongs in the repository.

Every Electron run goes through `scripts/safe-run.cjs`, which refuses to start a second dev
Electron and kills any survivor afterwards; the guard inside each run polls the GPU helper's
`phys_footprint` every 250 ms. See `CLAUDE.md` for the three kernel panics that put it there.

## Capturing

One theme per invocation on each side: the eleven states run **in order**, each undoing the
previous one's change, so a run leaves the app where it found it — but `propOpen` and the
selection are carried across a theme boundary otherwise, and a fresh process is the only honest
way to start the second theme.

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=select-wall,card-identifiers-open,card-related-open,card-geometry-open,multiselect-3,ctx-multi,ctx-single,select-similar,ctx-empty,hide-via-ctx,related-click

# the app, on the design's own mock federation
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase4/app SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done

# the prototype, same states, same window, same clicks
python3 -m http.server 8765 --directory design-reference/design &
for T in dark light; do
  SGVUE_BARE=0 SGVUE_OUT=tests/parity/phase4/prototype SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs parity-prototype.cjs
done
```

`UI`, `PROP_STATES` and `RECTS` are written out **byte-identically** in both scripts, and a
`python3` check in the Build Report asserts it. The viewport is driven by real mouse events
through `webContents.sendInputEvent` at the same coordinates on both sides:

| point | CSS px | what it is |
|---|---|---|
| `WALL` | 812, 462 | ARC's `Ext Wall S C-D L3` on the south façade (`SGVUE_WALL` overrides it) |
| `SECOND` | 760, 505 | Phase 2b's second pick — SIT's `Tree T03 Angsana` |
| `HOVER` | 620, 470 | Phase 2b's first pick — SIT's `Tree T01 Angsana` |
| `EMPTY` | 420, 180 | open sky west of the site: a right-click that hits nothing |

The card's own sections, the menu's items and the temporary-state frame's `reset` are clicked
**through the DOM**, exactly as Phase 3 drives the chrome — every one of them is found by copy
the port keeps verbatim (`Identifiers`, `Related`, `Geometry`, `Hide`, `Select similar`,
`Same ObjectType`, `reset`), so the same selector finds the same control on both sides.

Three harness details, each one a real finding:

1. **Two clicks in one state are separated by `await sleep(300)`.** The prototype's
   `psOpen.<k>.toggle` closes over the `propOpen` it was *rendered* with
   (`SGVue.dc.html:1978–1981`), so two toggles inside a single tick both write from the same
   stale copy and the first is lost — `card-geometry-open` left Related open there and closed
   here. No person can reach that at 300 ms apart, and reproducing it would be reproducing a
   defect rather than a look. The port's `toggleProp` reads the live store, so it is correct
   either way.
2. **`cardScroll(9999)` after opening a section.** On a 620 px card the three collapsibles sit
   below the fold, so without it the three `card-*-open` states capture the top of the scroll
   and prove nothing. `multiselect-3` puts it back to 0.
3. **`after`** — JavaScript run *after* the input steps, because `hide-via-ctx` and
   `related-click` have to open something with the mouse and then choose from it.

## The mask

Each capture writes its surfaces' `getBoundingClientRect()`s beside the PNG. Phase 4 adds
`propcard` (by its `data-role`) and `ctx` (the one element that is `position: fixed`,
`z-index: 10`, `min-width: 200px` — `SGVue.dc.html:834`), plus two text readbacks so a state
that clicked a *different element* is visible in the sidecar rather than only in the pixels:
`sel` (the card's first six lines) and `ctxItems` (every menu label). **Both sides answered
every one of them identically**, including the two menu widths (350 px with three-name labels,
214 px with one) and the card's 320 × 620 box in all eleven states.

The measured regions are: `chrome` = everything outside the stage plus the toolbar, the
Spatial-structure card and the hint bar, minus the status bar, the property card and the menu;
`card` and `menu` = the union of the two sides' rectangles; `status` with the backend name, the
fps digits and Phase 5's `undo` clipped out; `stage 3D` = the stage minus every chrome surface.

## Measured difference per state

`mean` is the mean absolute per-channel difference over the region (0–255); `>12` is the share
of its pixels differing by more than 12 in any channel. 1440 × 860 at devicePixelRatio 2.
`—` means neither side drew that surface in that state.

| state | dark: chrome / >12 | light: chrome / >12 | dark: card / >12 | light: card / >12 | dark: menu | light: menu | dark: status | light: status | dark: stage 3D | light: stage 3D |
|---|---|---|---|---|---|---|---|---|---|---|
| select-wall | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.02 / 0.04 % | 0.03 / 0.04 % | — | — | 0.00 | 0.03 | 2.94 / 5.99 % | 7.04 / 6.81 % |
| card-identifiers-open | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.01 / 0.01 % | 0.01 / 0.01 % | — | — | 0.00 | 0.03 | 2.94 / 5.99 % | 7.04 / 6.81 % |
| card-related-open | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.01 / 0.01 % | 0.01 / 0.01 % | — | — | 0.00 | 0.03 | 2.94 / 5.99 % | 7.04 / 6.81 % |
| **card-geometry-open** | 0.02 / 0.03 % | 0.02 / 0.03 % | **9.73 / 10.41 %** | **10.45 / 14.42 %** | — | — | 0.00 | 0.03 | 2.94 / 5.99 % | 7.04 / 6.81 % |
| multiselect-3 | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.03 / 0.06 % | 0.04 / 0.06 % | — | — | 0.00 | 0.03 | 2.93 / 6.09 % | 6.99 / 6.88 % |
| ctx-multi | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.03 / 0.06 % | 0.04 / 0.06 % | 0.00 | 0.00 | 0.00 | 0.03 | 2.49 / 5.91 % | 6.77 / 6.63 % |
| ctx-single | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.02 / 0.04 % | 0.03 / 0.04 % | 0.00 | 0.00 | 0.00 | 0.03 | 2.47 / 4.67 % | 6.84 / 5.50 % |
| select-similar | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.03 / 0.05 % | 0.03 / 0.06 % | — | — | 0.00 | 0.03 | 2.74 / 3.33 % | 6.75 / 4.10 % |
| ctx-empty | 0.02 / 0.03 % | 0.02 / 0.03 % | — | — | 0.00 | 0.02 | 0.00 | 0.03 | 2.64 / 4.96 % | 7.11 / 6.00 % |
| hide-via-ctx | 0.02 / 0.04 % | 0.03 / 0.04 % | — | — | — | — | 0.00 | 0.03 | 2.61 / 4.80 % | 7.00 / 5.81 % |
| related-click | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.03 / 0.05 % | 0.03 / 0.06 % | — | — | 0.00 | 0.03 | 2.75 / 3.34 % | 6.75 / 4.11 % |

**The context menu is 0.00–0.02 of 255 in every state it is drawn in** — twelve items, three
separators, both widths, both themes. The property card is **0.01–0.04** everywhere except
`card-geometry-open`. The chrome is 0.02–0.03, which is glyph-edge antialiasing, and the stage
is the same 2.5–2.9 / 6.8–7.1 band Phase 3 measured for the hemisphere light.

## `card-geometry-open` — the one state that differs, and why

Row for row, with the same wall selected on both sides:

| row | app | prototype |
|---|---|---|
| Bounding box | 5 600 mm × 200 mm × 3 300 mm | *same* |
| Footprint | 1.12 m² | *same* |
| Box volume | 3.696 m³ | *same* |
| Base / top | 7 500 mm → 10 800 mm | *same* |
| **Centroid** | **—** | **28514.644 E · 30203.247 N · 111.650 Z** |
| **Geometry** | **4 solids** | **1 solid** |

1. **Centroid.** The prototype's `coords` is a typed-in base point
   (`{ E: 28500, N: 30200, Z: 102.5, angle: 12.5 }`, `SGVue.dc.html:849`), so it always prints a
   map coordinate — for a mock federation that is not georeferenced at all. The fidelity
   contract forbids inventing one ("never a placeholder"), so this build fills `coords` from
   `IfcMapConversion` / `IfcSite` and shows the design's own em dash when the file states
   nothing. **On a real file the row fills in** — `big-model-card.png` beside this file reads
   `12454.374 E · 23317.117 N · 5.550 Z` off a georeferenced SVY21 export. Same rule, same
   consequence and the same single row, as Phase 3's `project-card` GlobalIds.
2. **Geometry: 4 solids against 1.** The design's mock composes one *physical* solid out of
   several axis-aligned boxes (`wallBoxes` splits a wall around its opening,
   `sample-model.js:26–33`) and its renderer merges each colour group into one mesh
   (`viewer-core.js:119`), so it counts groups — one. The mock adapter maps each box to one
   geometry part, so the viewer counts four. Neither number is the design's intent for a real
   file, where the row is the count of tessellated solids web-ifc reports for the product; the
   same wall on the 137.9 MB model reads **1 solid**, which is what the prototype's number
   means. Closing it on the mock would mean merging boxes per colour group inside
   `dev/mock-adapter.ts` — a change to the geometry pipeline Phases 1b and 2 were measured on,
   for one line of text in one state. **Left as a known mock-only difference; the reviewer's
   call.**
3. **A 16 px vertical offset, which follows from (1).** Both sides are scrolled to the bottom
   of the card, and the prototype's Centroid value wraps to two lines where the app's em dash
   does not, so its scrollable content is ~16 px taller and every row above sits 16 px higher.
   That offset, not the content, is what makes the whole-card number 9.73 / 10.45: shift the
   prototype's card back by 16 px and the residual over the card body is **1.71 (dark) /
   1.81 (light)**, confined to the partial row the scroll reveals at the top of the viewport
   and to the two rows above.

`card-identifiers-open` is the check the brief asked for on GlobalId: the mock adapter passes
the design's own `guid` field through untouched, so both sides read
`Q2ADvqKqKqKqKqKqKqKqKq`, `Tag 200365`, `Model ARC`, `Material Clay brick, plastered` — card
mean **0.01 of 255**. Nothing is hashed or regenerated on either side.

## Everything else that is visibly different

Nothing. Across the other ten states, in both themes, every rectangle matched, every readback
matched, and no region exceeded 0.04 of 255 outside the 3D stage.

Regenerate the table and the `diff/*-3up.jpg` sheets with the script in
`../phase3/README.md`, changing `base` to `tests/parity/phase4` and adding `propcard` and `ctx`
to the union list (the Build Report carries the exact variant used).

## The real-model run

`scripts/shell-sanity.cjs` grew a Phase 4 block: open `IfcWall`, click its first row, open all
three collapsibles and read the card back out of the DOM.

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
SGVUE_IFC="samples/Sample Ifc Model.ifc" SGVUE_OUT=tests/parity/phase4/big-model.png \
  node scripts/safe-run.cjs shell-sanity.cjs
```

26 761 elements, 16.25 s from file to a filled shell. Selecting
`Basic Wall:300mm Parapet Wall (Warehouse):2864673` took **100.5 ms** from click to painted
frame. The card box is 620 px, its scrolling body 544 px, its content **1 287 px** — so it
scrolls internally, is scrollable to the bottom, and nothing overflows the box: five property
sets in the designed order (`SGPset_Wall` first, then three `Pset_`, then
`Qto_WallBaseQuantities`), Identifiers with a real 22-character GlobalId, Related reading
33 / 4 044, and Geometry with the Centroid filled from the file's own georeferencing.
`big-model-card.png` is that frame.
