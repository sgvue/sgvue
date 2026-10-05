# Phase 7 — design parity captures (colour systems)

Colour by property and its legend, the per-model override palette, and the "Original materials"
toggle.

Same method as Phases 3–6: both sides captured **whole** (`SGVUE_BARE=0` on the prototype),
both driven through their own real click handlers, and the difference measured **per surface**
so the r170 / 0.186 hemisphere-light difference written up in `../phase2a/README.md` stays where
it belongs.

**One thing is driven through each side's own entry point rather than through a control, and it
is the point of the phase.** The design gives colour-by-property **no manual UI at all** — the
only writer is the assistant's `color_by_property` tool (`SGVue.dc.html:1547`), which is
Phase 9. Inventing a control would be a visible addition, so the scheme is set through
`window.__sgvueDev.colorBy` on the app side and through the prototype's **own** `colorBy`
method on the other, reached on the logic instance its template runtime keeps as `logic`
(`support.js`'s `StreamableComponent`). Everything else in the eight states is a designed
control clicked by its own copy or title on both sides: `+ add filter step`, `highlight`,
`clear`, the legend rows' `Select these elements`, `Clear colour scheme`,
`Override this model's colour`, the palette's own hex swatch, `Close (Esc)`, and the
Original-materials switch.

**The PNGs, the JPEGs and the `*.json` sidecars are git-ignored.** The commands and the
measured numbers below are what belongs in the repository.

Every Electron run goes through `scripts/safe-run.cjs`. See `CLAUDE.md` for the three kernel
panics that put it there.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=colorby-ifcentity,colorby-level,colorby-species,colorby-then-highlight,colorby-legend-row-click,colorby-cleared,model-override-with-glass,original-materials-toggle

# the app, on the design's own mock federation
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase7/app SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done

# the prototype, same states, same window, same clicks
python3 -m http.server 8765 --directory design-reference/design &
for T in dark light; do
  SGVUE_BARE=0 SGVUE_OUT=tests/parity/phase7/prototype SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs parity-prototype.cjs
done
```

`UI`, `CHROME_STATES`, `PROP_STATES`, `FILTER_STATES`, `ANNOTATION_STATES`, `COLOR_STATES` and
`RECTS` are written out **byte-identically** in both scripts (5 473 / 1 355 / 1 302 / 1 578 /
2 447 / 1 155 / 5 469 bytes; the Build Report carries the `python3` check that asserts it).

The states run **in order**, each building on or undoing the last:

| state | what it does |
|---|---|
| `colorby-ifcentity` | ten groups, largest first, `SCHEME[i % 11]`; the legend bottom-left at 230 px |
| `colorby-level` | the same by storey — six groups |
| `colorby-species` | **the design's flagship example**: `SpeciesCommonName` on the SIT model's sixteen trees, two groups of eight |
| `colorby-then-highlight` | back to `IfcEntity`, then a `highlight IfcWall` step built through the Filter card and the card closed again |
| `colorby-legend-row-click` | the step cleared, `SpeciesCommonName` again, then **the first legend row clicked** — eight Angsanas selected, the property card open and its 332 px lane reserved |
| `colorby-cleared` | the card closed, then the legend's **×** |
| `model-override-with-glass` | ARC's swatch → the palette → `#E05A6B`. The whole file is tinted and its windows are **still translucent** |
| `original-materials-toggle` | the switch back on: the file's own materials return and the override stays **remembered** (the row's swatch is still red) |

## The mask, and what the sidecars answer

Phase 7 adds three readbacks to the sidecar both scripts write beside every PNG:

- `legend` — its `getBoundingClientRect()`, found as the design's one absolutely-positioned
  **z-index-11** box (`SGVue.dc.html:413`);
- `legendText` — every line of it, so the property name and each row's value and count are
  compared as text;
- `legendRows` — each row's **swatch colour** as `getComputedStyle().backgroundColor`, so a
  scheme colour that differs by a single hex digit is named in the sidecar rather than left to
  the pixels.

**All three matched on every state, in both themes.** The legend box is `[312, 512, 230, 306]`
for `IfcEntity`, `[312, 716, 230, 102]` for the two-species scheme — identical on both sides —
and its rows read `IfcBeam 124 / IfcWall 80 / IfcColumn 80 / IfcWindow 55 / …` in
`rgb(53, 196, 182) / rgb(232, 163, 61) / rgb(224, 90, 107) / rgb(123, 140, 240)`, which is
`SCHEME[0..3]` on both sides.

`sel`, `propcard`, `filterText`, `frameLabel`, `frameTone`, `labels`, `panel`, `toolbar`,
`stage`, `cube`, `card` and `hint` matched everywhere too. **32 sidecar fields differed in
total, and every one of them is the status bar** — see the list at the end.

## Measured difference per state

`mean` is the mean absolute per-channel difference over the region (0–255); `>12` is the share
of its pixels differing by more than 12 in any channel. 1440 × 860 at devicePixelRatio 2.
`—` means neither side drew that surface in that state. The status bar is clipped to its first
140 CSS px, as in Phase 6.

### dark

| state | chrome / >12 | legend / >12 | propcard / >12 | status / >12 | stage / >12 / >40 / >80 |
|---|---|---|---|---|---|
| colorby-ifcentity | 0.02 / 0.03 % | **0.00 / 0.00 %** | — | 1.29 / 1.59 % | 2.76 / 9.55 % / 0.053 % / 0.012 % |
| colorby-level | 0.02 / 0.03 % | **0.00 / 0.00 %** | — | 6.10 / 6.95 % | 2.62 / 9.07 % / 0.044 % / 0.012 % |
| colorby-species | 0.02 / 0.03 % | **0.01 / 0.00 %** | — | 2.13 / 2.73 % | 2.77 / 8.36 % / 0.034 % / 0.012 % |
| colorby-then-highlight | 0.05 / 0.33 % † | **0.00 / 0.00 %** | — | 1.29 / 1.59 % | 2.18 / 5.06 % / 0.023 % / 0.012 % |
| colorby-legend-row-click | 0.02 / 0.03 % | **0.01 / 0.00 %** | 0.03 / 0.06 % | 2.13 / 2.73 % | 3.07 / 8.00 % / 0.066 % / 0.015 % |
| colorby-cleared | 0.02 / 0.03 % | — | — | 1.29 / 1.59 % | 2.67 / 5.02 % / 0.032 % / 0.011 % |
| model-override-with-glass | 0.02 / 0.03 % | — | — | 1.29 / 1.59 % | 2.49 / 5.11 % / 0.029 % / 0.011 % |
| original-materials-toggle | 0.02 / 0.03 % | — | — | 1.29 / 1.59 % | 2.67 / 5.02 % / 0.032 % / 0.011 % |

### light

| state | chrome / >12 | legend / >12 | propcard / >12 | status / >12 | stage / >12 / >40 / >80 |
|---|---|---|---|---|---|
| colorby-ifcentity | 0.02 / 0.03 % | **0.01 / 0.00 %** | — | 6.63 / 6.88 % | 7.08 / 10.58 % / 0.173 % / 0.042 % |
| colorby-level | 0.02 / 0.03 % | **0.01 / 0.01 %** | — | 6.64 / 6.94 % | 7.00 / 10.11 % / 0.164 % / 0.041 % |
| colorby-species | 0.02 / 0.03 % | **0.04 / 0.01 %** | — | 2.94 / 3.12 % | 7.20 / 9.39 % / 0.138 % / 0.025 % |
| colorby-then-highlight | 0.08 / 0.33 % † | **0.01 / 0.00 %** | — | 1.52 / 1.64 % | 6.93 / 6.31 % / 0.030 % / 0.013 % |
| colorby-legend-row-click | 0.02 / 0.03 % | **0.04 / 0.01 %** | 0.04 / 0.06 % | 2.62 / 2.91 % | 6.99 / 8.73 % / 0.150 % / 0.030 % |
| colorby-cleared | 0.02 / 0.03 % | — | — | 1.52 / 1.64 % | 7.15 / 6.05 % / 0.134 % / 0.025 % |
| model-override-with-glass | 0.02 / 0.03 % | — | — | 1.52 / 1.64 % | 6.97 / 6.16 % / 0.131 % / 0.025 % |
| original-materials-toggle | 0.02 / 0.03 % | — | — | 1.52 / 1.64 % | 7.15 / 6.05 % / 0.134 % / 0.025 % |

**The legend is 0.00–0.04 of 255 and at most 0.01 % of its pixels over 12, in every state and
both themes** — the same band the Section, Markups and Coordinate-system cards measured in
Phase 6, and the smallest a new surface has come in at so far. The chrome is the usual
0.02 / 0.03 % everywhere except the two † states. The property card is 0.03–0.04 with eight
elements selected from a legend row.

`colorby-cleared` and `original-materials-toggle` have **identical** stage figures
(2.67 / 5.02 % / 0.032 % / 0.011 % dark, 7.15 / 6.05 % light). They are two different routes to
the same picture — one clears a colour scheme, the other hands the model back to its own
materials — and that they land on the same numbers is the measurement that says both undid
themselves completely.

### The 3D stage

Unchanged from Phase 6 and from every phase since 2a: **at >40 the stage difference is at most
0.173 % of its pixels and at >80 at most 0.042 %**, and the means sit inside the 2.2–3.1 (dark)
and 6.9–7.2 (light) bands recorded there. The >12 column is the r170 / 0.186 hemisphere light
on large flat lit areas, which `../phase2a/README.md` measures at 17 of 255 — just over the
threshold, so it counts almost every pixel of the ground plane while the mean barely moves.
No legend swatch, no tinted surface and no ghosted element is missing, extra or displaced.

## Everything that is visibly different — the complete list

Four things. **Three are pre-existing and already recorded**; one is the Phase 5 decision.

**1. The status bar's backend name: `WebGL2` against `WebGPU`.** Recorded since Phase 2a. Six
monospace characters either way, so it changes no width. It is the *whole* of the status-bar
difference in the eight state/theme pairs where the two sides' live fps digits happened to
agree at the capture instant: the differing columns there are **38.0 … 49.5 only** — the `L2`
against the `PU`. In the other eight pairs the fps number itself differed at the moment
`capturePage()` ran (measured: app `120 fps`, prototype `84 fps` in `colorby-level-dark`), which
is not a parity property; the `statusText` sidecar shows both sides reading `120 fps` a
fraction of a second later.

**2. The status bar's CRS chip: `—` against `SVY21`.** Recorded in Phase 6 (`shared/georef.ts`
names the file's declared CRS; the mock federation has none). It is why the `statusText`
sidecar differs in all sixteen captures, and why the status column is measured over a 140 px
clip rather than the whole bar.

**3. The "Ask" chat pill, bottom right of the prototype's stage.** Phase 9. Listed in
`../phase3/README.md`'s "what Phase 3 does not draw yet" table and still outstanding; it sits
inside the compared stage region and contributes a small part of its >12 share.

**4. †The toolbar's Filter button lights for a live step** in `colorby-then-highlight`, which is
the whole of that state's 0.33 % chrome difference — one 30 × 30 button. This is the
2026-09-18 decision in `CLAUDE.md`: the design writes `on(s.card === 'filter' || s.filterOn)`
and `filterOn` is one of the keys plan §3.5 defect 8 drops, so the prototype's button only ever
lit for the open card. The control one place over settles the intent.

Nothing else. In all eight states, in both themes, the legend's rectangle, its text and every
row's swatch colour matched exactly, the property card matched, and no region outside the 3D
stage exceeded 0.06 % of pixels over 12.

## The real-model run

One guarded run, `SGVUE_ONLY=colors`:

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
SGVUE_ONLY=colors SGVUE_IFC="samples/Sample Ifc Model.ifc" \
  SGVUE_OUT=tests/parity/phase7/big-model.png node scripts/safe-run.cjs shell-sanity.cjs
```

`scripts/shell-sanity.cjs` grew a `colors` block, and the Phase 6 block is now gated by
`wants('annotate')` so the two can be run apart. The property-set key is **discovered from the
file** — the key the most elements carry — rather than named, so nothing in the harness is
sized to one model.

26 761 elements, 197 distinct property keys.

| what | by `IfcEntity` | by `Reference` (the file's widest pset key, carried by all 26 761) |
|---|---|---|
| groups | **29** | **1 306** |
| elements coloured | 26 761 | 26 755 (six carry an empty `Reference`) |
| largest groups | `IfcMember 6805 · IfcPlate 4516 · IfcWall 3314 · IfcColumn 2122 · IfcSpace 1960` | `Facade Cladding_Left Right - Dark Grey 2967 · Rectangular Mullion Trellis 1719 · Stringer - 100mm Width, 300mm Depth 1444` |
| call to painted frame | **19.9 ms** | **100.2 ms** |
| legend rows drawn | 29 | 1 306 |

Clearing the scheme through the legend's own × took **14.4 ms** and left 0 rows.

| what | measured |
|---|---|
| fps orbiting with the 29-group scheme live | **26 fps**, 126 draw calls (gridlines on) |
| GPU helper footprint | **1 428–1 796 MB** across the whole run; renderer 1 665–1 788 MB |
| guard | 2 500 / 6 000 MB limits never approached; no process survived the run |

`big-model-colorby.png` beside this file is that frame: the legend at 29 rows, scrolling inside
its `calc(100% - cardTop - 60px)` box, over a 26 761-element model coloured by entity.

**The 1 306-row legend is the one number a reviewer may want to act on.** The design caps
nothing here — `colorBy` makes a group per distinct value and the legend renders them all —
and 100 ms is the cost of the DOM, not of the colouring (the same 26 761 writes take 19.9 ms
for 29 groups). It is inside the box, it scrolls, and it is what the design specifies; a cap
would be a design change.

## Regenerating the tables

Phase 6's script with `base = 'tests/parity/phase7'`, `legend` added as its own region (the
z-index-11 box), the `cards` region kept for the Filter card, and the `>40` / `>80` stage pass.
The Build Report carries the exact variant used.
