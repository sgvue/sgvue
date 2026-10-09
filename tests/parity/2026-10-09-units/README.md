# 2026-10-09 — the display unit: the boot model's own, `ft`, and every readout follows it

The owner: *"Why model units not automatically using the units provided by model? in other
countries are feets"* — *"auto unit + feet"* — and, mid-build, *"and also the laser measurement
unit, and review any other similar situation."* (`CLAUDE.md`, allowed desktop deviations, and
`docs/DECISIONS.md`.) What has to hold:

- **mm is what it was.** On the design's mock — a millimetre model, so it boots in `mm` — every
  readout prints what HEAD printed; the only new pixels are the Markups card's third button.
- **m and ft read right, and fit.** The same chains with the unit switched first, and the
  committed fixture in feet, `tests/fixtures/feet.ifc`, booting in `ft`.

Every Electron run went through `scripts/safe-run.cjs`, one at a time, in the foreground. The PNGs and the
`.json` beside each one (`RECTS` — the chrome's rectangles, the cards' texts and every overlay
label's text and box) are git-ignored; this file is what is kept.

## Builds

`HEAD` is `7685cf2`, built with `VITE_SGVUE_DEVTOOLS=1` from a clean tree (the work stashed and
popped around the build); **this** is the working tree, built the same way. Each capture run copies
the build it is for into `out/`.

## Commands

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build

# A — the phase-6 annotation chain (1440 × 860): gridlines, levels, both section planes, a laser
#     measurement, a spot, selection dimensions, the Markups card (it switches to m), the
#     Coordinate-system card
A=grids-iso,grids-plan,grids-north,levels-iso,section-grid-C,section-grid-C-preview,section-grid-C-flip-offset1500,section-level-L2,bubble-click-opens-section,measure-M1,spot-C1,dims-wall,markups-card,coords-card
# B — the laser's two sides (1280 × 820, DPR 1): the live reading, the labels, the Markups card in
#     mm, then m, then back in mm
B=laser-sides-hover,laser-sides,laser-sides-markups,laser-sides-markups-m,laser-sides-zoom
# C — the chat panel with a table that carries no units (the design's literal m²), 1440 × 860
C=chat-pill,chat-empty,chat-transcript
# F, T — a reply's own format and the thinking trace (1280 × 820, DPR 1)
F=fmt-plain,fmt-mid,fmt-done,fmt-rows
T=trace-01-typing,trace-02-lift,trace-03-thinking,trace-04-reading,trace-05-filtering,trace-06-checking,trace-07-answer,trace-08-done

for T_ in dark light; do
  SGVUE_MAX_SECONDS=400 SGVUE_SETTLE=3000 SGVUE_HASH=mock SGVUE_THEMES=$T_ SGVUE_STATES=$A \
    SGVUE_OUT=tests/parity/2026-10-09-units/after-a node scripts/safe-run.cjs screenshot.cjs
  SGVUE_MAX_SECONDS=400 SGVUE_SETTLE=3000 SGVUE_SIZE=1280x820 SGVUE_DPR=1 SGVUE_HASH=mock \
    SGVUE_THEMES=$T_ SGVUE_STATES=$B SGVUE_OUT=tests/parity/2026-10-09-units/after-b \
    node scripts/safe-run.cjs screenshot.cjs
  # …and C, F, T the same way, into after-c, after-f2, after-t2
done

# m and ft: the same chains with the unit set first, through the Markups card's own toggle
AU=grids-iso,grids-plan,grids-north,levels-iso,section-grid-C,section-grid-C-preview,section-level-L2,bubble-click-opens-section,measure-M1,spot-C1,dims-wall
#   after-a-m:  SGVUE_STATES=units-m,$AU            after-b-m:  units-m,laser-sides-hover,laser-sides,laser-sides-markups
#   after-a-ft: SGVUE_STATES=units-ft,$AU,units-spot-full
#   after-b-ft: units-ft,laser-sides-hover,laser-sides,laser-sides-markups
#   after-m-spot: units-m,section-grid-C,section-level-L2,bubble-click-opens-section,measure-M1,spot-C1,units-spot-full

# the fixture in feet, booted from its own file (no SGVUE_HASH)
SGVUE_IFC=tests/fixtures/feet.ifc SGVUE_SIZE=1280x820 SGVUE_DPR=1 SGVUE_OUT=tests/parity/2026-10-09-units/after-feet \
  SGVUE_STATES=shell,units-levels,units-section-level,units-coords-card,units-place-laser,units-place-spot \
  node scripts/safe-run.cjs screenshot.cjs
```

`section-grid-C-flip-offset1500` types `1500` into the offset field, which in `m` is 1.5 km, so
the m and ft chains leave it out. The `units-*` states are new in `scripts/screenshot.cjs`.

## Folders

| Folder | Build | What |
|---|---|---|
| `before-a`, `before-a2` | HEAD | chain A, two runs per theme — the noise floor |
| `before-b`, `before-b2` | HEAD | chain B, two runs per theme |
| `before-c`, `before-f`, `before-t` | HEAD | chains C, F, T |
| `after-a`, `after-b`, `after-c` | this | the same, in `mm` |
| `after-f2`, `after-t2` | this | chains F and T (`after-f`, `after-t` are a first run whose suggestions chip was hovered by the OS pointer — the owner was using the machine — so are not compared) |
| `after-a-m`, `after-b-m`, `after-m-spot` | this | in `m` |
| `after-a-ft`, `after-b-ft` | this | in `ft` |
| `after-feet` | this | `tests/fixtures/feet.ifc`, which boots in `ft` |

## Measured — mm, against HEAD

**Two runs of one build are not byte-identical here**: the grid bubbles' and grid dimensions'
labels antialias differently from run to run. HEAD against HEAD, chain A: **0–9 518 px** differ a
frame, chain B 1 262–4 852 px — between 95 % and 100 % of them inside the overlay labels' own
boxes (±2 px), at most 391 px outside — and in every state **the chrome is 0 px** (the sidebar,
the toolbar, the status bar, the action bar, every card, the hint, the Ask pill: the rectangles
`RECTS` reports) and **every overlay label reads back the same text in the same box**.

This build against HEAD, **in every mm state** of chains A and B: **chrome 0 px** — the status bar
and the three Section-card states among them — and **every label the same text in the same box**;
the 3D frame differs by **622–8 332 px** (chain A) and **3 091–5 787 px** (chain B), 95 % or more
of it inside the labels' boxes and at most 489 px outside — the same noise. Chain C (the chat
panel, its table with no units printing the design's `m²`): chrome 0 px in all six frames. Chains F
and T (a reply's format, the thinking trace — `fmt-done` and `trace-08-done` among them): the chat
panel alone is **identical** in all 24 crops, and chrome 0 px but for the composer's caret in
`trace-08-done` (16 px, a 1 × 16 px column).

**The Markups card** gains its `ft` button and nothing else. Probed in the DOM (mock,
1280 × 820, two measurements on the card): the card `[312, 66, 330, 167.38]`, its header
`[327, 81, 292, 24]`, the title `[327, 87.5, 59.36, 11]` and the × `[595, 81, 24, 24]` are HEAD's
to the hundredth; the toggle group grows left from `[533.19, 81, 53.81, 24]` to
`[503.98, 81, 83.02, 24]`, its buttons `mm [504.98, 82, 29.20, 22]`, `m [534.19, 82, 22.61, 22]`
and the new **`ft [556.80, 82, 29.20, 22]`** — the mm and m buttons 29.21 px further left. In the
captures the card is `[312, 66, 330, 122]` before and after, and the pixels that differ are all in
**(504, 81)–(578, 105): 1 429 px dark, 1 431 light** (`laser-sides-markups`, `laser-sides-zoom` —
the latter with 3–4 px of the action bar's left edge besides, which two HEAD runs differ by too).

## Measured — m

`levels-iso`: the level tags `L2 +4.000`, `Foundation −1.000`; the sidebar's storeys `+4.000`; the
grid dimensions `6.000 m` (56 px wide, against `6 000 mm`'s 58); `measure-M1`: `X 0.060 m`,
`X 2.280 m`, `Z 1.380 m`; the live reading `Y 2.673 + 2.927 · Z 2.400 + 0.300 m`; the selection
dimensions `3.500 m`, `0.400 m`; the spot's level `+8.400`, as in mm, and opened (`after-m-spot`)
its E / N / Z the design's em dash — the mock has no base point — and its xyz row
`13.800, 0.100, 8.400` (HEAD: `13800, 100, 8400`). The Section card: the field `1.2` for the level
cut, its buttons `−0.5` / `+0.5` (titles `−0.5 m` / `+0.5 m`), the summary
`offset m · level L2 · cut`; a nudge reads `1.7`. Status bar `m`. Against HEAD's own
`laser-sides-markups-m`, the Markups card differs only in the toggle, (504, 81)–(586, 105):
1 198 px dark, 1 204 light — and the frame by the 3D labels, now in metres, and the sidebar's
storey column (199, 495)–(239, 663), 632 px.

## Measured — ft

On the mock (`after-a-ft`, `after-b-ft`): level tags `L2 +13'-1 1/2"`, `Foundation −3'-3 3/8"`
(the widest, 159 px against mm's 128); grid dimensions `19'-8 1/4"` (80 px); the laser
`X 0'-2 3/8"`, `Z 4'-6 5/16"`, the live reading
`Y 8'-9 1/4" + 9'-7 1/4" · Z 7'-10 1/2" + 0'-11 13/16"` with no unit after it; the selection
dimensions `11'-5 13/16"`, `1'-3 3/4"`; the spot opened: xyz `45.276, 0.328, 27.559` decimal
feet; status bar `ft`.

- **No overprint, and the declutter holds:** in every state of chains A (mm, m and ft), the level
  tags do not touch one another, no grid dimension touches a bubble or another dimension, and each
  state shows the same number of bubbles and of grid dimensions in all three units (18 / 7 in plan,
  11 / 4 in 3D, 5 / 0 in an elevation).
- **Laser readings overprint as they always did, a little more:** the laser's labels are not
  decluttered (2026-10-08, by choice). The same pairs touch in every unit, wider in ft:
  `laser-sides` 1 pair, 40 px² mm → 60 m → 520 ft; `measure-M1` 5 pairs, 1 595 → 1 881 → 2 422 px².
- **The Markups rows wrap between axes, never inside one:** every axis reading is one box
  (`getClientRects().length === 1`) in all three units, `3'-11 1/4"` included.
- **The Section card stays usable:** the nudges are `−2'-0"` / `+2'-0"` (65.2 px wide, against
  50.81), the field 127.59 px wide and its text `3'-11 1/4"` fits it (`scrollWidth` 126 =
  `clientWidth` 126); a nudge reads `5'-11 1/4"`; the summary `offset ft · level L2 · cut` keeps
  its ellipsis style and fits (270 = 270).
- **The Markups card's header can widen by 8 px in any unit:** the card is `overflow:auto` with
  content of fractional height, and HEAD's card already shows a 3 px overflow and an 8 px vertical
  scrollbar with two two-line rows. With rows of other heights — three lines each, in ft here — the
  overflow goes, the scrollbar with it, and the header is 300 px wide rather than 292: the toggle
  and the × stand 8 px further right. Not this change's; recorded because it shows in ft.

The fixture in feet (`after-feet`; probed as well): it boots in **ft** — status bar
`5 / 5 · ft · Synthetic test CRS`; level tags `Level 2 +10'-6"`, `Level 1 +0'-0"`; grid
dimensions `20'-0"` and `30'-0"`; a laser from the slab's top `X 19'-6"   Y 14'-6"   Z 9'-6"`;
a spot `40528.305 E · 76955.046 N · 17.568 Z` in the Markups card and, opened,
`E 40 528.305 N 76 955.046 Z 17.568 xyz 20.000, 15.000, 1.000`; the Section card `3'-11 1/4"`
for Level 2's cut. **The Coordinate-system card** reads `Easting US ft 40503.387`,
`Northing US ft 76957.74`, `Elevation US ft 16.568`, `True north ° -43.4103` — the same in `mm`
and `ft`, because it speaks the file's map unit — and each label fits its column (131 = 131).

## The e2e suite

`npm run test:e2e`, in two guarded runs (one would pass the shell's ten-minute limit):
`smoke.spec.ts` + `feet.spec.ts` **32 passed** (4.5 m), the other specs **33 passed, 6 skipped**
(3.8 m) — 65 passed, 6 skipped. One smoke case was updated: `tiny.ifc` is drawn in metres, so it
now boots in `m` and its Section-card summary reads `offset m · …` and its field `1.5`.
