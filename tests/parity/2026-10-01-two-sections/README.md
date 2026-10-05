# 2026-10-01 — two section planes: the gridline cut and the level cut

Not a parity phase: the design has one section plane, so the two-plane states here have nothing
in the prototype to be differenced against. This folder answers two questions about the app
against itself, on the design's mock federation:

1. **With one plane set, is every frame the build before's?** — `head-a/`, `head-b/`, `head-c/`
   are the base commit `60ec62b` captured three times; `new-a/`, `new-b/`, `new-c/` are this
   change captured three times; the phase-6 chain, 1440 × 860, both themes.
2. **What do two planes look like?** — `after/`: the new card and both planes cutting, 1280 × 820,
   both themes.

The owner's request and the chosen option are in `CLAUDE.md` (allowed desktop deviations,
2026-10-01) and `docs/DECISIONS.md` (four rows). The PNGs and their `.json` sidecars are
git-ignored, like every capture under `tests/parity/`; this file is what is kept.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=grids-iso,grids-plan,grids-north,levels-iso,section-grid-C,section-grid-C-preview,section-grid-C-flip-offset1500,section-level-L2,bubble-click-opens-section,measure-M1,spot-C1,dims-wall,markups-card,coords-card

# 1 — the phase-6 chain, whole window, each theme its own run
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=tests/parity/2026-10-01-two-sections/new-a SGVUE_THEMES=$T \
  SGVUE_STATES=$STATES node scripts/safe-run.cjs screenshot.cjs
done

# 2 — the two-plane states, one chain per theme
for T in dark light; do
  SGVUE_SIZE=1280x820 SGVUE_HASH=mock SGVUE_OUT=tests/parity/2026-10-01-two-sections/after \
  SGVUE_THEMES=$T \
  SGVUE_STATES=sections-card,sections-both-3d,sections-both-east,sections-grid-cut-level-preview,sections-level-cleared,sections-clear-all \
  node scripts/safe-run.cjs screenshot.cjs
done
```

**The base commit** was built with `VITE_SGVUE_DEVTOOLS=1` from the clean tree before the first
edit. Its whole-window captures (`head-*`) were made then, with the first command above. A copy
of that `out/` and of its `scripts/lib/parity-states.cjs` was kept beside the work, and its
canvas-only captures were made from that copy.

**Canvas-only captures.** A whole-window capture carries the DOM overlay — bubbles, tags,
dimension labels — whose text antialiasing differs between two captures of one build by up to
8 036 px a frame (the table below), which is more than a regression in the 3D drawing could be
told apart from. So each state of the chain was also captured with everything but the 3D canvas
hidden — one style rule, `[data-role="stage"] > *:not([data-role="viewport"]){visibility:hidden}`,
for the capture and removed after it — which leaves exactly what the renderer drew:
1140 × 860 px, the stage without the sidebar. Those frames are compared pixel for pixel. The
harness for that is the phase-6 chain itself (`ANNOTATION_STATES` from
`scripts/lib/parity-states.cjs`, under `scripts/lib/electron-guard.cjs`); it lives outside the
repository, as do its captures.

**A capture counts only if its window was painting.** The desktop was in use while these were
made, and a window that is covered by another one is throttled by Chromium: one round of
`after/` came back with `0 fps`–`2 fps` in every sidecar's status text, the card caught
mid-fade at y = 69 and stale frames in the PNGs, and was thrown away and captured again. Every
sidecar kept here reads 58 to 60 fps, and every canvas-only frame is confirmed by being
identical to a base capture.

Since 2026-10-01 the chain clears the section with `secClear()` — the card's `Clear all` when it
has one (the app), its `Clear` when it does not (the prototype). With one plane set the two do
the same thing.

## 1 — with one plane set, every frame is the build before's

### Canvas only (1140 × 860 = 980 400 px)

**Every one of this build's 84 frames — 14 states × 2 themes × 3 runs — is identical, pixel for
pixel, to a capture of the base commit.**

The base commit was captured three times in full, and six more times in light for the first four
states, because its own captures of one state do not all agree: `levels-iso` comes in **two
versions**, one pixel apart — (775, 823), RGB (81, 104, 72) or (81, 105, 72). In dark one of its
three captures reads 105 and two read 104; in light two of its nine read 104 and seven read
105. This build's three captures are each one of those two versions (dark 105, 105, 105;
light 105, 104, 105). Every other state is one frame, whichever build and whichever run.

The cut statistics (`debug().cut`) and the draw calls are the base commit's in every state, so
the same segments are drawn by the same number of draws.

| state | theme | base captures | distinct base frames | this build, 3 runs: identical to a base capture | cut: segments / elements / triangles | draw calls |
|---|---|---|---|---|---|---|
| `grids-iso` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 22 |
| `grids-iso` | light | 9 | 1 | 3 of 3 | 0 / 0 / 0 | 22 |
| `grids-plan` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 22 |
| `grids-plan` | light | 9 | 1 | 3 of 3 | 0 / 0 / 0 | 22 |
| `grids-north` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 25 |
| `grids-north` | light | 9 | 1 | 3 of 3 | 0 / 0 / 0 | 25 |
| `levels-iso` | dark | 3 | 2 | 3 of 3 | 0 / 0 / 0 | 28 |
| `levels-iso` | light | 9 | 2 | 3 of 3 | 0 / 0 / 0 | 28 |
| `section-grid-C` | dark | 3 | 1 | 3 of 3 | 220 / 47 / 960 | 23 |
| `section-grid-C` | light | 3 | 1 | 3 of 3 | 220 / 47 / 960 | 23 |
| `section-grid-C-preview` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 23 |
| `section-grid-C-preview` | light | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 23 |
| `section-grid-C-flip-offset1500` | dark | 3 | 1 | 3 of 3 | 248 / 46 / 2 052 | 23 |
| `section-grid-C-flip-offset1500` | light | 3 | 1 | 3 of 3 | 248 / 46 / 2 052 | 23 |
| `section-level-L2` | dark | 3 | 1 | 3 of 3 | 568 / 74 / 3 360 | 24 |
| `section-level-L2` | light | 3 | 1 | 3 of 3 | 568 / 74 / 3 360 | 24 |
| `bubble-click-opens-section` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 24 |
| `bubble-click-opens-section` | light | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 24 |
| `measure-M1` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 25 |
| `measure-M1` | light | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 25 |
| `spot-C1` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 24 |
| `spot-C1` | light | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 24 |
| `dims-wall` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 27 |
| `dims-wall` | light | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 27 |
| `markups-card` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 28 |
| `markups-card` | light | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 28 |
| `coords-card` | dark | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 28 |
| `coords-card` | light | 3 | 1 | 3 of 3 | 0 / 0 / 0 | 28 |

The chain covers one plane in every form it takes: a gridline cut (`section-grid-C`), its
preview (`-preview`), flipped with an offset (`-flip-offset1500`), a level cut
(`section-level-L2`), a bubble's preview (`bubble-click-opens-section`), and — in the five states
after it — the laser, the snap and the spot, which read the clip through the picker.

### Whole window (1440 × 860 = 1 238 400 px)

The label readback — the text and the box of every overlay label — is **identical in all 28
state / themes** (0 mismatches against a base capture). The one designed change is the Section
card: `[312, 66, 300, 330]` → `[312, 66, 300, 444]`, 114 px taller.

The pixel columns are the worst pair of captures. *Residual* is what is left once the Section
card (either build's box, grown 40 px for its shadow), every overlay label (its box, grown
3 px) and the status bar (the live frame rate) are taken out — pixels of the 3D canvas or the
rest of the chrome. The base commit differs from itself by as much as this build differs from
it, which is the DOM label antialiasing the canvas-only captures exist to step around; in the
three `section-grid-C*` states, where the camera faces the cut and few labels are up, the
residual is 0 either way.

| state | theme | labels | label text + box mismatches | Section card, base → this build | base ~ base, worst pair: all px / residual | this build ~ base, worst pair: all px / outside the card / residual |
|---|---|---|---|---|---|---|
| `grids-iso` | dark | 15 | 0 | — | 7 084 / 103 | 6 555 / 6 555 / 101 |
| `grids-iso` | light | 15 | 0 | — | 7 373 / 34 | 7 431 / 7 431 / 34 |
| `grids-plan` | dark | 25 | 0 | — | 7 051 / 143 | 6 500 / 6 500 / 138 |
| `grids-plan` | light | 25 | 0 | — | 8 036 / 123 | 8 330 / 8 330 / 123 |
| `grids-north` | dark | 5 | 0 | — | 2 120 / 515 | 1 902 / 1 902 / 515 |
| `grids-north` | light | 5 | 0 | — | 2 153 / 517 | 2 251 / 2 251 / 619 |
| `levels-iso` | dark | 21 | 0 | — | 6 087 / 68 | 9 483 / 9 483 / 70 |
| `levels-iso` | light | 21 | 0 | — | 5 804 / 1 | 5 657 / 5 657 / 1 |
| `section-grid-C` | dark | 4 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 990 / 0 | 50 635 / 1 047 / 0 |
| `section-grid-C` | light | 4 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 968 / 0 | 50 738 / 1 053 / 0 |
| `section-grid-C-preview` | dark | 4 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 955 / 0 | 49 128 / 988 / 0 |
| `section-grid-C-preview` | light | 4 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 968 / 0 | 49 119 / 1 053 / 0 |
| `section-grid-C-flip-offset1500` | dark | 4 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 971 / 0 | 51 017 / 976 / 0 |
| `section-grid-C-flip-offset1500` | light | 4 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 1 029 / 0 | 50 748 / 1 052 / 0 |
| `section-level-L2` | dark | 25 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 6 106 / 148 | 58 554 / 7 894 / 118 |
| `section-level-L2` | light | 25 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 7 230 / 8 | 55 755 / 5 833 / 7 |
| `bubble-click-opens-section` | dark | 25 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 6 220 / 209 | 56 563 / 8 153 / 210 |
| `bubble-click-opens-section` | light | 25 | 0 | `[312, 66, 300, 330]` → `[312, 66, 300, 444]` | 7 374 / 154 | 53 986 / 6 012 / 154 |
| `measure-M1` | dark | 24 | 0 | — | 4 962 / 115 | 7 086 / 7 086 / 119 |
| `measure-M1` | light | 24 | 0 | — | 6 769 / 34 | 6 828 / 6 828 / 34 |
| `spot-C1` | dark | 25 | 0 | — | 4 962 / 115 | 7 086 / 7 086 / 119 |
| `spot-C1` | light | 25 | 0 | — | 6 769 / 34 | 6 828 / 6 828 / 34 |
| `dims-wall` | dark | 27 | 0 | — | 4 590 / 116 | 6 794 / 6 794 / 120 |
| `dims-wall` | light | 27 | 0 | — | 6 428 / 34 | 6 487 / 6 487 / 34 |
| `markups-card` | dark | 36 | 0 | — | 4 962 / 115 | 7 086 / 7 086 / 119 |
| `markups-card` | light | 36 | 0 | — | 6 769 / 34 | 6 583 / 6 583 / 79 |
| `coords-card` | dark | 36 | 0 | — | 4 962 / 115 | 7 086 / 7 086 / 119 |
| `coords-card` | light | 36 | 0 | — | 6 769 / 34 | 5 702 / 5 702 / 35 |

Sum of the residuals over the 28 rows: 2 902 px for this build against the base, 2 769 px for
the base against itself.

## 2 — two planes

`after/`, 1280 × 820, both themes, one chain per theme (`scripts/screenshot.cjs`,
`APP_ONLY_STATES`). Every state is driven through the card's own controls, a plane's controls
found inside its block (`[role="group"][aria-label="Along a gridline"]`, `…"At a level"`).

| state | what it shows | summaries | planes cutting | outline: segments / elements / triangles | draw calls |
|---|---|---|---|---|---|
| `sections-card` | the card as it opens, no plane chosen | `no section` · `no section` | 0 | 0 / 0 / 0 | 22 |
| `sections-both-3d` | grid `C`, `flip side`, then level `L2`; back in 3D | `grid C · cut · flipped` · `level L2 · cut` | 2 | 378 / 63 / 2 220 | 25 |
| `sections-both-east` | the same from the east elevation, orthographic | the same | 2 | 378 / 63 / 2 220 | 24 |
| `sections-grid-cut-level-preview` | the level plane's `cut` off: its sheet, the gridline cut still cutting; 3D | `grid C · cut · flipped` · `level L2 · plane only` | 1 | 220 / 47 / 960 | 26 |
| `sections-level-cleared` | the level block's `Clear`: the gridline cut exactly as it was | `grid C · cut · flipped` · `no section` | 1 | 220 / 47 / 960 | 24 |
| `sections-clear-all` | `Clear all`: the model whole | `no section` · `no section` | 0 | 0 / 0 / 0 | 22 |

Each summary is prefixed `offset mm · ` on the card, and **each is read whole**: a plane's
summary has a line of its own, the block's full width, and its three buttons stand in a row of
their own under it, right-aligned. On the single card the summary shared a line with those
buttons, which left it about 75 px — it read `offset mm …`, the plane's name clipped away
(`head-a/section-grid-C-dark.png` shows it), and the first build of this change kept that. It
is the one place the design's two rows were re-arranged; the summary keeps its own style
string, so it would still ellipsise if it ever overflowed, and carries a native `title` with
its whole text.

**The card** is `[312, 66, 300, 444]` in every one of the six states and both themes — its
height does not depend on what is chosen. It was `[312, 66, 300, 400]` with the summary still
beside its buttons, and the single card is `[312, 66, 300, 330]` in the chain above. Its text,
read back in order (31 lines): `SECTION` · `Clear all` · `Along a gridline` · `A` `B` `C` `D` `E` · `1` `2` `3` `4`
· `−500` `+500` · `offset mm · …` · `cut` `flip side` `Clear` · `At a level` · `Foundation` `L1`
`L2` `L3` `L4` `Roof` · `−500` `+500` · `offset mm · …` · `cut` `flip side` `Clear`. The mock's
nine grids are two families, so the gridline block is two chip rows with one 1 px rule between
them. The e2e suite asserts all of it on the production build: the rule 1 px tall and as wide
as the block, `A…E` on one row above it and `1…4` on one row below; each summary as wide as its
block, 6 px above its buttons, not clipped — `offset mm · grid C · cut · flipped` included —
with a `title` equal to its text; and the three buttons in the design's order, the last one
ending where the block does.

**The planes**, with both cutting: the gridline plane `[−1, 0, 0, 12]` (grid `C` at x = 12 m,
flipped, so x ≤ 12 is kept) and the level plane `[0, 0, −1, 5.2]` (L2 at +4.000 plus the
design's 1 200 mm, so z ≤ 5.2 is kept); each is `dot(p, n) + c ≥ 0`. A plane that is not cutting
is parked at `[0, 0, 1, 100000]`, which keeps everything.

**The outline** (canvas only, 1140 × 860, the Home 3D view unless said; accent pixels within
±6 of `#35C4B6` dark / `#0E8A80` light):

| what cuts | segments / elements | accent px, dark | accent px, light |
|---|---|---|---|
| grid `C` flipped, alone | 220 / 47 | 12 231 | 11 837 |
| level `L2`, alone | 568 / 74 | 16 584 | 15 001 |
| **both** | **378 / 63** | **10 469** | **9 771** |
| both, east elevation | 378 / 63 | 8 457 | 8 294 |
| both, grid `C` not flipped, plan | 414 / 64 | 11 154 | 10 819 |
| neither (`Clear all`) | 0 / 0 | 0 | 0 |

Both planes together draw **fewer** segments than the level plane alone, because each plane's
outline is trimmed to what the other kept: 378 against 220 + 568. Adding the level plane to the
gridline cut changes 13.7 % of the canvas's pixels (134 247 dark, 134 292 light).

## 3 — the cut recompute, with both planes

On what produced 2026-09-28's numbers: the 5.58 M-triangle synthetic model (17 600 elements,
5 577 600 triangles), the warm median of 11 recomputes, on this machine (Windows 11, RTX 3070 Ti,
WebGL2). Seven runs of this build — five before the summary line and the assistant's `cut`
input were added, two after; neither touches the viewer — and four of the base commit,
milliseconds.

| | this build | base commit |
|---|---|---|
| level cut alone (12 280 segments on 693 elements, 206 544 triangles walked) | 6.6 · 6.0 · 6.7 · 5.9 · 5.6 · 6.2 · 6.3 | 5.6 · 6.1 · 6.3 · 5.6 |
| gridline cut alone (9 200 on 550, 513 000) | 7.2 · 7.4 · 7.5 · 7.5 · 7.4 · 7.3 · 7.5 | 6.6 · 7.2 · 7.3 · 6.8 |
| gridline cut lying on a face — the worst case (11 300 on 1 350, 754 800) | 9.3 · 9.2 · 9.1 · 9.3 · 9.3 · 9.1 · 8.9 | 8.7 · 8.8 · 9.4 · 9.4 |
| **both planes cutting** (8 334 on 490, 222 968) | **6.5 · 6.6 · 7.1 · 6.9 · 6.2 · 7.2 · 6.3** | — |
| both, the gridline plane lying on a face (8 510 on 671, 277 040) | 6.9 · 7.4 · 7.4 · 7.1 · 6.7 · 7.1 · 6.6 | — |
| both, one plane's offset moving while the other stays | 6.5 · 6.2 · 6.8 · 6.2 · 5.7 · 6.4 · 5.7 | — |

Two planes cost no more than one: each plane's walk skips every element whose box does not
reach the other plane's kept side. One plane is a few tenths of a millisecond slower than it
was — the extra box test and the call that trims a segment. A cold first recompute is 8.0–12.0 ms
with both planes (the base commit's single plane: 11.7–13.4). The frame itself, drawn with one
plane cutting and with two, is 2.2–2.3 ms and 1.9–2.0 ms on that model (median of 40, read back).

## 4 — render on demand

`node scripts/safe-run.cjs frame-triggers.cjs` gained the second plane's four changes, each
driven with the camera at rest and proved against the compositor's pixels. **28 of 28 repainted;
0 scene renders in 2 s at rest.**

| change | pixels changed |
|---|---|
| section along grid C | 72.36 % |
| second plane: level L2 beside grid C | 72.05 % |
| second plane: its offset (grid C untouched) | 7.86 % |
| second plane: flipped | 72.03 % |
| second plane: cleared (grid C still cuts) | 42.11 % |
| section cleared | 33.48 % |

## Not captured

No real model: this machine has no `samples/` model, so the two planes were not run on the
reference model's 39 non-axis-aligned grids. The plane arithmetic per plane is the single
plane's (`planeFromSegment`, `planeFromLevel`), which phase 6 ran there.
