# Phase 6 — design parity captures (annotation)

Gridlines and their bubbles, level rings and tags, the Section card and its plane, the laser
meter, spot coordinates, selection dimensions, the Markups card and the Coordinate-system card.

Same method as Phases 3–5: both sides captured **whole** (`SGVUE_BARE=0` on the prototype),
both driven through their own real click handlers and the same real mouse events at the same
coordinates, and the difference measured **per surface** so the r170 / 0.186 hemisphere-light
difference written up in `../phase2a/README.md` stays where it belongs.

**One change to the prototype harness, and it is the point of the phase.** Until now
`scripts/parity-prototype.cjs` switched the prototype's own grid lines and level tags **off**
after boot, because the app recorded `grids: true` and drew nothing. The app draws them now, so
nothing is suppressed: both sides open with grids on and levels off, which is the designed
default. Earlier phases' numbers were measured with the suppression in place and are unchanged.

**The PNGs, the JPEGs and the `*.json` sidecars are git-ignored.** The commands and the
measured numbers below are what belongs in the repository.

Every Electron run goes through `scripts/safe-run.cjs`. See `CLAUDE.md` for the three kernel
panics that put it there.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=grids-iso,grids-plan,grids-north,levels-iso,section-grid-C,section-grid-C-preview,section-grid-C-flip-offset1500,section-level-L2,bubble-click-opens-section,measure-M1,spot-C1,dims-wall,markups-card,coords-card

# the app, on the design's own mock federation
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase6/app SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done

# the prototype, same states, same window, same clicks
python3 -m http.server 8765 --directory design-reference/design &
for T in dark light; do
  SGVUE_BARE=0 SGVUE_OUT=tests/parity/phase6/prototype SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs parity-prototype.cjs
done
```

`UI`, `CHROME_STATES`, `PROP_STATES`, `FILTER_STATES`, `ANNOTATION_STATES` and `RECTS` are
written out **byte-identically** in both scripts (3 905 / 1 354 / 1 301 / 1 577 / 2 446 / 4 809
bytes; the Build Report carries the `python3` check that asserts it).

Everything is driven through the designed controls by their own copy and by the `title` /
`data-tip` texts the port keeps verbatim: the view segmented control, `Gridlines (G)`,
`Levels (L)`, `Section from gridline / level`, the Section card's own grid and level chips,
`cut`, `flip side`, `Clear`, the offset field, `Laser meter (M)`, `Spot coordinate (C)`, the
four Coordinate-system fields, the property card's `dims` and `Close (Esc)`, the status bar's
`N measures`, and the Markups card's `m`. **A grid bubble is clicked by its own title**
(`Show plane of grid C`) — it is a DOM element with a real `click` listener on both sides, so
that is the designed control, not a pixel coordinate.

The states run **in order**, each building on or undoing the last:

| state | what it does |
|---|---|
| `grids-iso` | the default 3D view: nine gridlines past the footprint by `pad`, eighteen bubbles, the occluded ones hidden |
| `grids-plan` | plan: both families, all eighteen bubbles |
| `grids-north` | north elevation: **one family only**, its bubbles lifted to `bbox.max.z + pad` on vertical stems, near side only |
| `levels-iso` | back to 3D, `Levels (L)` on: six rings and six clamped, stacked tags |
| `section-grid-C` | levels off, the Section card open, grid `C` picked — cut, and the camera re-aimed square to the plane |
| `section-grid-C-preview` | `cut` off: the translucent preview sheet, the model whole |
| `section-grid-C-flip-offset1500` | `cut` on, `flip side`, offset typed to `1500` |
| `section-level-L2` | `Clear`, then level `L2` — the design's own 1 200 mm default offset |
| `bubble-click-opens-section` | `Clear`, the card closed, then **the bubble of grid C clicked**: it opens the card with that plane previewed |
| `measure-M1` | section cleared, 3D, the laser meter, one click on the building's near corner |
| `spot-C1` | the prototype's default base point typed into the Coordinate-system card on **both** sides, then one spot |
| `dims-wall` | the wall at 812, 462 selected and the property card's `dims` turned on |
| `markups-card` | the card closed, a second measurement, the Markups card opened from the status bar, unit toggled to `m` |
| `coords-card` | the Markups card closed and the Coordinate-system card opened |

**2026-10-01 — `Clear` is `secClear()`.** The app's Section card has two planes and a
`Clear all` in its header since that day; the prototype's has one plane and one `Clear`. The
three states above that clear the section do it through `secClear()`
(`scripts/lib/parity-states.cjs`): `Clear all` where the card has one, else `Clear` — the same
result with one plane set, which is all this chain ever sets. The app's frames of this chain
against the build before that change are in `tests/parity/2026-10-01-two-sections/README.md`.

**`spot-C1` types the prototype's own default base point into both sides.** The app reads the
base point from the file and the design's mock federation has no georeferencing at all, so
without it one side would print coordinates and the other the em dash and the numbers could not
be compared. The values are the prototype's: `28500 E · 30200 N · 102.5 Z · 12.5°`. They stay
typed for the three states that follow, which is why `coords-card` shows them on both sides.

**Not since 2026-10-08.** The owner made the app's Coordinate-system card read-only, so the app
refuses the typing and its base point is the boot file's — none, on the design's mock — and
`spot-C1` now places the spot and types nothing. From `spot-C1` on, the app's states therefore
differ from the captures measured below: its spot tag reads the level in the file's own metres,
the Markups list's E / N / Z and the four Coordinate-system fields are blank, and the status
bar's CRS chip stays the em dash, where the prototype keeps its own literal base point. The
numbers below are the phase-6 measurement and are not re-baselined.

**2026-10-08 — the laser reads each side of its point** (owner-requested; `CLAUDE.md`, allowed
deviations). The chain was run again, the build before against this one and this one twice
(`SGVUE_SETTLE=3000`, into `tests/parity/2026-10-08-laser-sides/phase6-*`). The nine states
before `measure-M1` place no measurement and are unchanged: what differs is only the grid
bubbles' and grid dimensions' antialiasing, which differs between two runs of one build as much.
**`measure-M1`, `spot-C1`, `dims-wall`, `markups-card` and `coords-card` differ**, because each
shows the measurements `measure-M1` and `markups-card` place, and both read two sides: M1
`X 60 + 2 280 · Z 1 380 + 60 mm` (was `X 2 340 · Z 1 440 mm`) and M2 `X 1 600 + 4 000 ·
Y 40 + 8 825 · Z 1 800 mm` (was `X 5 600 · Y 8 865 · Z 1 800 mm`) — four and five labels where
there were two and three (1 804–7 966 px). In `markups-card` both rows wrap in metres, so the
Markups card is 330 × 225 (was 330 × 205). Everything else is unchanged: in `coords-card` the
Coordinate-system card, the status bar, the sidebar and the toolbar are 0 px apart. At this
zoom M1's 60 mm halves overprint their own axis's other label (X 50 × 10 px, Z 60 × 6 px) —
not decluttered, by choice. The prototype keeps the design's one label a ray, so from
`measure-M1` on the label readback no longer matches it.

## The mask, and what the sidecars answer

Each capture writes its surfaces' `getBoundingClientRect()`s beside the PNG. Phase 6 adds
`section`, `markups` and `coords` (the three new left-lane cards, found by their own heading
among the absolutely positioned z-index-14 boxes), their text, the four Coordinate-system field
**values**, and — the readback this phase turns on — **every DOM annotation label that is
actually drawn**: its text and its position, sorted so creation order cannot read as a
difference.

One selector changed: the status bar used to be identified by the literal `SVY21`, which is
read from the file now (`shared/georef.ts`), so it is identified by the one field always in it
(`… fps`). It finds the same element on both sides.

**The label readback matched on every state, in both themes: 484 labels, 0 differences.**

| state | labels, app / prototype | what they are |
|---|---|---|
| `grids-iso` | 11 / 11 | nine grid bubbles' near side plus the two visible far ones |
| `grids-plan` | 18 / 18 | both ends of all nine |
| `grids-north` | 5 / 5 | `E D C B A`, lifted, near side only — the other family gone |
| `levels-iso` | 17 / 17 | eighteen bubbles less one occluded, plus six level tags |
| `section-grid-C` | 4 / 4 | `4 3 2 1` — the elevation the section re-aim produced |
| `section-level-L2` | 18 / 18 | plan view, both ends |
| `measure-M1` | 23 / 23 | `X 1 660 · Y 120 · Z 1 440 mm` live, three ray labels, six dots, one origin |
| `spot-C1` | 24 / 24 | `E 28 513.539 N 30 200.195 Z 109.880 xyz 13260, -2740, 7380` |
| `dims-wall` | 26 / 26 | `3 300 mm`, `5 600 mm`, `200 mm` |
| `markups-card` | 35 / 35 | two measurements, one spot |

Four more readbacks matched everywhere: `sectionText` (all 39 lines of the card, chips
included), `markupsText` (`M1 X 1.660 m Y 0.120 m Z 1.440 m`, `M2 X 6.000 m Y 6.000 m Z 2.040 m`,
`C1 28513.539 E · 30200.195 N · 109.880 Z`), `coordVals`
(`['28500', '30200', '102.5', '12.5']`) and every rectangle — the Section card at 300 × 330,
the Markups card at 330 × 205, the Coordinate-system card at 300 × 269 and the property card at
320 × 620, identical on both sides.

## Measured difference per state

`mean` is the mean absolute per-channel difference over the region (0–255); `>12` is the share
of its pixels differing by more than 12 in any channel. 1440 × 860 at devicePixelRatio 2.
`—` means neither side drew that surface in that state. `†` marks a status bar whose CRS chip
or unit field differs **by design** (see below), which shifts everything after it horizontally
and makes a pixel comparison of the tail meaningless; the sidecars name the text exactly.

### dark

| state | chrome / >12 | cards / >12 | propcard / >12 | status | stage 3D / >12 |
|---|---|---|---|---|---|
| grids-iso | 0.02 / 0.03 % | — | — | 3.01 † | 2.67 / 5.02 % |
| grids-plan | 0.02 / 0.03 % | — | — | 3.02 † | 0.67 / 0.35 % |
| grids-north | 0.02 / 0.03 % | — | — | 4.27 † | 2.02 / 9.38 % |
| levels-iso | 0.02 / 0.03 % | — | — | 3.01 † | 2.99 / 6.40 % |
| section-grid-C | 0.02 / 0.03 % | 0.01 / 0.01 % | — | 2.94 † | 2.00 / 3.92 % |
| section-grid-C-preview | 0.02 / 0.03 % | 0.01 / 0.01 % | — | 2.94 † | 3.10 / 10.78 % |
| section-grid-C-flip-offset1500 | 0.02 / 0.03 % | 0.01 / 0.01 % | — | 3.00 † | 3.22 / 10.33 % |
| section-level-L2 | 0.02 / 0.03 % | 0.01 / 0.01 % | — | 2.99 † | 0.82 / 1.42 % |
| bubble-click-opens-section | 0.02 / 0.03 % | 0.01 / 0.01 % | — | 2.99 † | 0.72 / 0.34 % |
| measure-M1 | 0.02 / 0.03 % | — | — | 8.34 † | 2.62 / 4.78 % |
| **spot-C1** | 0.02 / 0.03 % | — | — | **0.08** | 2.50 / 4.09 % |
| **dims-wall** | 0.02 / 0.03 % | — | 0.02 / 0.04 % | **0.08** | 2.77 / 5.04 % |
| markups-card | 0.02 / 0.03 % | 0.00 / 0.00 % | — | 7.79 † | 2.59 / 4.44 % |
| **coords-card** | 0.02 / 0.03 % | **1.42 / 1.51 %** | — | 7.79 † | 2.61 / 4.51 % |

### light

| state | chrome / >12 | cards / >12 | propcard / >12 | status | stage 3D / >12 |
|---|---|---|---|---|---|
| grids-iso | 0.02 / 0.03 % | — | — | 7.11 † | 7.15 / 6.04 % |
| grids-plan | 0.02 / 0.03 % | — | — | 7.04 † | 2.25 / 0.82 % |
| grids-north | 0.02 / 0.03 % | — | — | 4.23 † | 2.02 / 9.32 % |
| levels-iso | 0.02 / 0.03 % | — | — | 7.10 † | 7.10 / 7.12 % |
| section-grid-C | 0.02 / 0.03 % | 0.01 / 0.02 % | — | 7.29 † | 8.87 / 48.91 % |
| section-grid-C-preview | 0.02 / 0.03 % | 0.01 / 0.02 % | — | 7.29 † | 9.58 / 53.52 % |
| section-grid-C-flip-offset1500 | 0.02 / 0.03 % | 0.01 / 0.02 % | — | 7.29 † | 9.76 / 53.44 % |
| section-level-L2 | 0.02 / 0.03 % | 0.01 / 0.02 % | — | 6.99 † | 2.28 / 1.85 % |
| bubble-click-opens-section | 0.02 / 0.03 % | 0.01 / 0.02 % | — | 6.99 † | 2.30 / 0.76 % |
| measure-M1 | 0.02 / 0.03 % | — | — | 9.41 † | 7.06 / 5.78 % |
| **spot-C1** | 0.02 / 0.03 % | — | — | **0.09** | 6.95 / 5.11 % |
| **dims-wall** | 0.02 / 0.03 % | — | 0.03 / 0.04 % | **0.10** | 6.87 / 5.85 % |
| markups-card | 0.02 / 0.03 % | 0.01 / 0.00 % | — | 8.78 † | 6.98 / 5.52 % |
| **coords-card** | 0.02 / 0.03 % | **1.52 / 1.51 %** | — | 8.78 † | 6.98 / 5.60 % |

**The chrome is 0.02 / 0.03 % in every state, both themes** — identical to Phases 3, 4 and 5.
**The three new cards are 0.00–0.01 of 255** everywhere except `coords-card`, which is the CRS
chip and nothing else (see below). The property card is 0.02–0.03 with dimensions live. The
status bar is **0.08–0.10** in the two states where its text agrees on both sides.

### The 3D stage, and why `section-grid-C` light reads 49 % over 12

It is the r170 / 0.186 hemisphere light, and nothing else. Sampled at the median differing
pixel of `section-grid-C-light`: app `[217, 217, 217]`, prototype `[200, 201, 200]` — the white
ground plane, 17 apart, which is exactly the figure `CLAUDE.md` records for the section camera
("the prototype renders the same white ground plane at 220, 210 and 200 … where ours renders
218 / 218 / 217"). A 17-unit difference sits just above the 12 threshold, so over a large flat
lit area it counts almost every pixel while the mean stays inside the 7.0–9.8 light-theme band
every phase since 2a has measured. `grids-north` is the same effect on the green turf
(`[73, 90, 64]` against `[90, 109, 78]`).

Raising the threshold separates the two causes. Over the same stage region:

| threshold | worst state, dark | worst state, light |
|---|---|---|
| > 12 | 10.8 % | 53.5 % |
| **> 40** | **0.211 %** | **0.153 %** |
| **> 80** | **0.040 %** | **0.034 %** |

At >40 the stage difference is at most **0.211 %** of its pixels and at >80 at most **0.040 %**
— sub-pixel antialiasing on lines and edges. No gridline, bubble stem, level ring, section
outline, preview sheet, laser, dot or dimension tick is missing, extra or displaced anywhere.

## Everything that is visibly different — the complete list

Four things, all deliberate, all data rather than drawing.

**1. The status bar's CRS chip: `—` against `SVY21`.** The design writes `SVY21` as a literal
(`SGVue.dc.html:710`), which is true of its own Singapore subject and a placeholder for any
other file. `shared/georef.ts`'s `crsChip` names the file's declared `IfcProjectedCRS`, keeps
the design's own chip when that CRS is SVY21 / EPSG:3414 **or** the user has typed a base point
this session, and shows the design's em dash when there is neither. The mock federation has no
CRS at all, so the chip is the em dash in the nine states before `spot-C1` types a base point —
and `SVY21` on both sides from `spot-C1` onwards, which is why those two states measure 0.08.
It is 27 px of status-bar width (four monospace characters) and one field of text. On the
reference model, which declares `IFCPROJECTEDCRS('EPSG:3414','SVY21 / Singapore TM','SVY21',…)`,
the chip reads `SVY21` exactly as designed.

**2. The status bar's unit field: `m` against `mm`** in `markups-card` and `coords-card`. The
design hard-codes `mm` there while keeping a `units` state key (plan §3.5 defect 4); the port
shows the key, which the Markups card's own mm / m toggle sets. Six px of width, one character.
The two are identical in the twelve states where the toggle has not been touched.

**3. The Coordinate-system card's CRS chip: `—` against `SVY21 · EPSG:3414`** — the whole of
`coords-card`'s 1.42 / 1.52. The same rule as (1), in the card's own two-part form. This is
the one difference a reviewer may want to overturn: deliverable 4 scopes the data rule to the
status bar, and the card's chip could be left as the design's literal. It is composed from the
file here for consistency with the status bar and with Phase 3's `project-card` decision, and
reverting it is one line in `app/CoordsCard.tsx`.

**4. The backend name: `WebGL2` against `WebGPU`.** Pre-existing and recorded since Phase 2a —
the prototype creates its own WebGPU renderer, the app's `'auto'` has meant WebGL2 since the
kernel panics of 2026-09-17. Both are six monospace characters, so it changes no width at all
and shows up only inside the clipped head of the status bar.

Nothing else. In all fourteen states, in both themes, every rectangle matched, every one of the
484 drawn annotation labels matched in text and position, all three cards' text matched line for
line, and no region outside the 3D stage exceeded 0.04 % of pixels over 12 except the one CRS
chip named above.

## Regenerating the tables

Phase 5's script with `base = 'tests/parity/phase6'`, `section` / `markups` / `coords` added to
the card region, the status clip left at 140 CSS px from the bar's left edge (the backend name
and the fps digits), and the `>40` / `>80` stage pass. The Build Report carries the exact
variant used.

## The real-model run

`scripts/shell-sanity.cjs` grew a Phase 6 block, and `SGVUE_ONLY` so it can be run without
repeating Phases 3–5:

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
SGVUE_IFC="samples/Sample Ifc Model.ifc" SGVUE_OUT=tests/parity/phase6/big-model.png \
  node scripts/safe-run.cjs shell-sanity.cjs
SGVUE_ONLY=annotate SGVUE_IFC="samples/Sample Ifc Model.ifc" \
  SGVUE_OUT=tests/parity/phase6/big-model.png node scripts/safe-run.cjs shell-sanity.cjs
```

26 761 elements, 12 storeys, **39 grid axes and not one of them axis-aligned** — two families
at **46.59°** and **136.59°**, which is the case the design's own model cannot produce and the
whole reason a grid is a segment here.

| what | measured |
|---|---|
| footprint padding | `pad` **25.501 m** (6 % of the 425 m footprint; the 2.5 m floor never applies) |
| gridlines drawn | **39**, in 2 families |
| bubbles | **78** created, **31** drawn — the other 47 hidden behind the building by the occlusion pass |
| level rings and tags | **12**, tags clamped into the viewport and stacked |
| section along grid `L` (46.59°) | plane `n = [0.6872, 0.7265, 0]`, `c = 63.6994`; **7.4 / 10.8 ms** from chip click to painted frame |
| section along the lowest storey | plane `n = [0, 0, −1]`, `c = −2.8` — the storey at −4.0 m plus the design's 1 200 mm |
| fps, everything on | **31 fps** with 39 gridlines, 78 bubbles and 12 level rings live; **66 fps** with a section cutting |
| GPU helper footprint | **1 685–1 959 MB** across both runs; renderer 1 365–1 845 MB. The guard's 2 500 / 6 000 MB limits were never approached and no run left a process behind |

`big-model-grids.png`, `big-model-section-grid.png` and `big-model-section-level.png` beside
this file are those frames.

**The one item the two-run budget did not close: the laser measurement on the real model.**
Run 1 clicked the centre of the biggest `IfcSlab` from the top-down camera the level section
had left; the snap marker caught the face, but the reading was empty and correctly so — the
design does not fire the ray pointing **into** the surface (`viewer-core.js` L376), there was
nothing above the slab, and the ±X / ±Y rays ran along its top at z = 1.05 m between the
driveway slab and the first storey at +1.3 m, hitting nothing. Run 2 aimed at each side of the
slab's bounding box in turn and probed seven points on each: a 700 mm floor 167 m across whose
outline has a **1 546.6 m** perimeter has three AABB side faces in open air, so no probe landed
on it. The harness now probes the **live laser preview** over a coarse grid of the whole
viewport instead and takes the first point that reads all three axes — the same number the
click will commit. **That path is written but unrun**: the budget for this phase is two guarded
big-model runs and both are spent.

What the laser path *is* checked against: the mock states above, where the live reading, the
three ray labels, the six dots and the origin marker match the prototype's to the pixel; and
`dims-wall`, where the three dimension labels read **5 600 / 3 300 / 200 mm** against the
selected wall's own `Qto_WallBaseQuantities` — `Length 5600`, `Height 3300`, `Width 200`.
