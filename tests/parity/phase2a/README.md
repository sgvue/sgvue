# Phase 2a — design parity captures

The fidelity contract (`CLAUDE.md` §"Design parity harness") requires every phase to be
reviewed side by side against the prototype at the same size and in the same state.

**The PNGs are git-ignored** (24 MB for this phase; `.gitignore` carries the rule). Regenerate
them with the two commands below — both drive the same Electron window at the same size, so
the two sets are comparable pixel for pixel rather than one browser against another.

```sh
# the app, on the design's own mock federation
VITE_SGVUE_DEVTOOLS=1 npm run build
SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase2a/app \
SGVUE_STATES=iso,plan,north,section-C,highlight,highlight-off,activate,activate-off,isolate,isolate-off \
SGVUE_THEMES=dark,light npx electron scripts/screenshot.cjs

# the prototype, same states, same window
python3 -m http.server 8765 --directory design-reference/design &
SGVUE_OUT=tests/parity/phase2a/prototype \
SGVUE_STATES=iso,plan,north,section-C,highlight,highlight-off,activate,activate-off,isolate,isolate-off \
SGVUE_THEMES=dark,light npx electron scripts/parity-prototype.cjs
```

The prototype is served over http because it loads its modules with dynamic `import()`, which
Chromium refuses from `file://`, and it fetches React and three from CDNs — so the machine has
to be online. `parity-prototype.cjs` hides the designed chrome (sidebar, rail, toolbar, cards,
status bar, view cube, DOM overlay) and turns the 3D grid axes off, because Phase 2a builds the
scene and nothing else; what is left in frame on both sides is exactly what 2a is responsible
for.

**Size.** 1440 × 860 at devicePixelRatio 2 (2880 × 1720 captures), not the 1440 × 900 the task
asks for: this Mac's work area is 1512 × 879, so a 1440 × 900 window is clamped by macOS and
the capture comes back short. Both sets use the same size, which is what the comparison needs.

## Measured difference per state

`mean` is the mean absolute per-channel difference over the whole 2880 × 1720 frame (0–255);
`>12` is the share of pixels differing by more than 12 in any channel. Rerun with the diff
script quoted in the Phase 2a Build Report.

Recaptured on 2026-09-17 after `batches.ts` stopped drawing per instance (`CLAUDE.md`, the
merged-geometry decision). The first pair of columns is the figure of record; the last is what
the same state measured while the renderer still used a `BatchedMesh`, kept so the change can
be seen not to have cost anything.

| state | dark: mean / >12 | light: mean / >12 | (was, batched) |
|---|---|---|---|
| iso | 2.27 / 3.8 % | 7.01 / 5.1 % | 2.20 / 6.86 |
| plan | 0.59 / 0.3 % | 2.43 / 1.3 % | 0.54 / 2.28 |
| north | 1.57 / 7.1 % | 1.57 / 7.0 % | 1.50 / 1.51 |
| section at grid C | 1.57 / 2.6 % | 7.49 / 41.3 % | 1.50 / 7.43 |
| highlight (STR matched) | 1.58 / 0.8 % | 6.47 / 1.5 % | 1.54 / 6.35 |
| activate (ARC active) | 2.12 / 5.0 % | 7.14 / 6.3 % | 2.06 / 7.01 |
| isolate (ARC + STR) | 1.99 / 4.6 % | 7.12 / 6.2 % | 1.93 / 6.98 |
| …-off (returned to normal) | 2.27 / 3.8 % | 7.01 / 5.1 % | 2.20 / 6.86 |

Every state moved by at most **0.15** of 255, and the merged captures differ from the batched
ones by at most 0.49 mean and 0.61 % of pixels — sub-pixel re-registration, because a vertex
is now transformed once in Float64 on the CPU rather than per frame in Float32 on the GPU.

Regenerate the table with, from the repository root:

```sh
python3 - <<'EOF'
import os
from PIL import Image
import numpy as np
base = 'tests/parity/phase2a'
for f in sorted(os.listdir(f'{base}/app')):
    if not f.endswith('.png'):
        continue
    a = np.asarray(Image.open(f'{base}/app/{f}').convert('RGB')).astype(np.int16)
    b = np.asarray(Image.open(f'{base}/prototype/{f}').convert('RGB')).astype(np.int16)
    d = np.abs(a - b)
    print(f'{f:26} {d.mean():6.2f} {(d.max(axis=2) > 12).mean() * 100:6.2f}%')
EOF
```

## What is left, and why

Essentially all of it is one upstream change. `HemisphereLightNode.setup()` is a single line
different between the design's three r170 and our pinned 0.186: r170
(`src/nodes/lighting/HemisphereLightNode.js:45`) computes `normalView.dot( lightDirectionNode )`
where 0.186 (`:76`) computes `normalWorld.dot( … )`. `lightPosition()` is byte-identical in
both and returns a **world**-space position (r170 `src/nodes/accessors/Lights.js:20–26`, 0.186
`:84–90`), so r170 dots a view-space normal with a world-space direction: its hemisphere term
depends on where the camera is standing.

That is measurable here, on the same white ground plane, same material, same two lights, with
only the camera moved:

| camera | prototype (r170) | app (0.186) |
|---|---|---|
| plan | 220, 220, 220 | 218, 218, 218 |
| iso | 210, 211, 210 | 218, 218, 218 |
| section at grid C | 200, 201, 200 | 217, 217, 217 |

So there is no single r170 "look" to match: the same surface is three different greys from
three angles. It is why plan view agrees to ±2/255 (there the two frames coincide) and
elevations do not, why the light theme reads worse than the dark one, and the whole of
`section-C-light`'s 41 % — the sky half of that frame is identical and the ground half is
uniformly 16/255 apart. Reproducing it would mean a wall that changes brightness as you orbit.
Kept as 0.186's, recorded in `CLAUDE.md`.

Nothing else is outstanding at the scene level. The highlight residual an earlier draft had —
a ghosted façade failing to tint the highlighted frame in front of it — is fixed by the ghost
twin (10.8 % → 0.6 % of pixels in dark). Grid lines, grid bubbles, level tags, the view cube,
the DOM annotation overlay, dimensions and snap markers are Phase 2b/6 and are switched off on
both sides of these captures.

---

## 2026-09-19 — the frame-budget re-capture

The four performance fixes of 2026-09-19 (`PROGRESS.md`) are all invisible by intent, so the
mock set was captured **before and after** and compared *app against app*, which is a stricter
question than app against prototype: the answer should be nothing at all. A fifth candidate —
`forceSinglePass` on the glass material — was measured here and **refused**, which is what the
second table below is.

Fifteen states × two themes — the Phase 2a scene states (`iso`, `plan`, `section-C`,
`section-off`, `highlight`, `highlight-off`), a Phase 3 sidebar state (`default`), the Phase 6
annotation states where bubbles hide behind the building (`grids-iso`, `grids-plan`,
`grids-north`, `levels-iso`), a Phase 7 colour state (`colorby-ifcentity`) and three Phase 9
panel states (`chat-pill`, `chat-empty`, `chat-transcript`):

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=iso,plan,section-C,section-off,highlight,highlight-off,default,grids-iso,grids-plan,\
grids-north,levels-iso,colorby-ifcentity,chat-pill,chat-empty,chat-transcript
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=<dir> SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done
```

**A whole-frame mean cannot answer this question, and finding out why took three experiments.**
Capturing the *same* build twice differs: worst mean **0.019 of 255** at the harness's standard
1 400 ms settle, and still **0.0067** at a 4 000 ms one in the dark theme. Every differing pixel
is in the **grid bubbles' glyphs**. They are DOM elements positioned by a transform rounded to
0.1 px (`overlay.ts`), so any sub-pixel camera difference re-renders their text — and the
camera's exponential ease is still arriving at 1 400 ms, while the snap that lets it come to
rest at all (`camera.ts`, `REST_ANGLE`) can round a bubble the other way at 4 000 ms. The
canvas behind them does not move.

So the scene is measured **in a band of pure façade** — device pixels x 1300…2150, y 820…1080 of
the 2880 × 1720 capture, 221 000 pixels of wall, windows and shadow with no bubble in it:

| 4 s settle, façade band | `iso` light | `iso` dark | `highlight` light | `highlight` dark |
|---|---|---|---|---|
| 1795bd6 → shipped | **0** | **0** | **0** | **0** |
| shipped → shipped, a second run | **0** | **0** | **0** | **0** |

Not one pixel, in any state, in either theme. The occlusion gate, the pick grid,
render-on-demand and the hover rule draw exactly what 1795bd6 drew.

## `forceSinglePass` on the glass material — measured, and refused

An intermediate build set it (the see-through material has carried it since Phase 2a; the glass
one never has). A `DoubleSide` transparent material is rendered twice, so the flag removes **14
draw calls and 365 019 triangles a frame** on the 137.9 MB model — 105 · 5 573 656 becomes
91 · 5 208 637. What it also does, at the same 4 s settle:

In the same façade band, at the same 4 s settle:

| 4 s settle, façade band | `iso` light | `iso` dark | `highlight` light | `highlight` dark |
|---|---|---|---|---|
| two-pass → the flag set | 298 px | 302 px | 396 px | 374 px |
| the largest difference | 4 of 255 | 4 of 255 | 1 of 255 | 1 of 255 |

Identical on every run, in both themes: about three hundred pixels of glazing, by at most four
levels. The back-then-front order those two passes produce is part of the drawn result, so
under the fidelity contract this is a difference rather than an optimisation — and it buys
0.14 ms of an 8.4 ms frame. **Not taken.** `scripts/profile-frame.cjs` condition `5b` turns it
on for four seconds if the number is ever wanted again.

**A correction, kept because the mistake is instructive.** The first measurement of this cost
reported **0.19 % of the frame, up to 90 levels, "all inside the glazing"**, from whole-frame
means at the 1 400 ms settle. Those pixels were the grid bubbles' glyph antialiasing — the
bubbles ring the building, so their bounding box looks like the façade's — and they move
between two runs of the same build. The flag's real cost is two orders of magnitude smaller
than that, and the reason it is refused is that it is systematic and buys 0.14 ms, not that it
is large.
