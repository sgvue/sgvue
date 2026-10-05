# Phase 3 — design parity captures (the chrome)

Phases 2a and 2b captured the stage with the designed chrome **stripped**. From Phase 3 the
chrome *is* the subject, so both sides are captured whole (`SGVUE_BARE=0` on the prototype) and
the difference is reported **for the chrome only** — the 3D stage carries the r170 / 0.186
hemisphere-light difference written up in `../phase2a/README.md`, which is Phase 2's, not this
phase's.

**The PNGs, the JPEGs and the `*.json` rectangle sidecars are git-ignored.** The commands and
the measured numbers below are what belongs in the repository.

Every Electron run goes through `scripts/safe-run.cjs`, which refuses to start a second dev
Electron and kills any survivor afterwards; the guard inside each run polls the GPU helper's
`phys_footprint` every 250 ms. See `CLAUDE.md` for the three kernel panics that put it there.

## Capturing

One theme per invocation on each side: the states run **in order**, each undoing the previous
one's change, and the last one (`library-open`) unloads a model, so a fresh process is the only
honest way to start the second theme.

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=default,tree-predef,search-wall,group-expanded,storey-solo-L2,model-hidden-STR,palette-open,project-card,tool-measure-active,view-plan,rail,library-open

# the app, on the design's own mock federation
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase3/app SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done

# the prototype, same states, same window, same clicks
python3 -m http.server 8765 --directory design-reference/design &
for T in dark light; do
  SGVUE_BARE=0 SGVUE_OUT=tests/parity/phase3/prototype SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs parity-prototype.cjs
done
```

Both scripts define the **same** DOM helpers and the same state list (`UI` and `CHROME_STATES`,
written out identically in each), so each side is driven through its own real click handlers by
`title`, `data-tip` and visible copy — all of which the port keeps verbatim. A state that could
not find its control throws rather than capturing a frame that quietly did nothing.

Grid lines and level tags are switched off in the prototype's *scene* (they are Phase 6, and the
app records `grids: true` while drawing nothing). Neither toolbar is touched, so the Gridlines
button reads "on" on both sides, which is what this phase is judged on.

The prototype's theme is set by **clicking its own toolbar control**, not by writing
`dataset.theme`. Its `setModels` rebuilds the viewer with `this.state.theme`, so a theme set
behind the component's back reverts the scene to dark the moment `library-open` unloads a model,
while the CSS chrome stays light — a harness artefact that read as 144 of 255 over 81 % of the
stage until it was fixed.

## The mask

Beside every PNG each side writes a `*.json` of its chrome's `getBoundingClientRect()`s. The
diff is measured over

> everything outside `[data-role="stage"]`, plus the toolbar, the Spatial-structure card and the
> hint bar — taking the **union** of the two sides' rectangles, so a surface only one of them
> draws is still measured.

Each sidecar also carries the viewer's own `debug()` under `camera`, which is where the camera
table above comes from.

The status bar is measured separately, because three runs inside it are known differences rather
than defects: the backend name (`WebGL2` here, `WebGPU` in the prototype — `CLAUDE.md` Decisions),
the fps digits, and Phase 5's `undo` button, which the prototype grows and this build does not
yet have. Every rectangle matched between the two sides in every state **except** the status
bar's width, for that last reason (320 px here against 373 px there).

## Measured difference per state

`mean` is the mean absolute per-channel difference over the masked region (0–255); `>12` is the
share of masked pixels differing by more than 12 in any channel. 1440 × 860 at devicePixelRatio
2 (2880 × 1720 captures).

| state | dark: chrome / >12 | light: chrome / >12 | dark: status | light: status | dark: stage 3D | light: stage 3D |
|---|---|---|---|---|---|---|
| default | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.00 | 0.03 | 2.62 / 4.89 % | 7.10 / 5.92 % |
| tree-predef | 0.02 / 0.02 % | 0.02 / 0.03 % | 0.00 | 0.03 | 2.62 | 7.10 |
| search-wall | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.00 | 0.03 | 2.62 | 7.10 |
| group-expanded | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.00 | 0.03 | 2.62 | 7.10 |
| storey-solo-L2 | 0.02 / 0.03 % | 0.03 / 0.03 % | 0.00 | 0.03 | 1.73 | 6.99 |
| model-hidden-STR | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.00 | 0.03 | 2.96 | 7.44 |
| palette-open | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.00 | 0.03 | 2.62 | 7.10 |
| **project-card** | **0.70 / 0.47 %** | **0.65 / 0.47 %** | 0.00 | 0.03 | 3.10 | 7.17 |
| tool-measure-active | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.00 | 0.03 | 2.64 | 7.09 |
| view-plan | 0.02 / 0.03 % | 0.02 / 0.03 % | 0.00 | 0.01 | 0.68 | 2.30 |
| rail | 0.00 / 0.00 % | 0.01 / 0.00 % | 0.00 | 0.01 | 0.59 | 2.31 |
| library-open | 0.02 / 0.04 % | 0.02 / 0.04 % | 0.00 | 0.03 | 3.08 | 7.35 |

Everything except `project-card` is at or below **0.03** of 255 in both themes, which is
glyph-edge antialiasing.

The **stage 3D** column is the stage minus every chrome surface drawn on it — what Phase 2a is
measured on. `default` reads **2.62 / 7.10** against Phase 2a's `iso` **2.27 / 7.01**: the same
band, and the same single cause, the r170 / 0.186 hemisphere-light difference documented in
`../phase2a/README.md`. `view-plan` and `rail` are low because a plan view fills the frame with
the ground plane, where the hemisphere term barely differs; `library-open` is a shade higher
because one model has been unloaded and the remaining three are lit against more open ground.

## The camera

Phase 2a matched the prototype's camera to the last digit and the shell must not disturb it.
Every capture writes the viewer's own `debug()` into its sidecar; for `default`, in both themes:

| | cam | target | dist | half | proj |
|---|---|---|---|---|---|
| app | `[55.13, -34.13, 42.24]` | `[12, 9, 7.25]` | 70.31 | 29.72 | persp |
| prototype | `[55.13, -34.13, 42.24]` | `[12, 9, 7.25]` | 70.31 | 29.72 | persp |

That is the design's boot framing: `boot()` builds the whole federation, *then* creates the
viewer, so the fit happens once with every model present. Streaming the models in one at a time
lost it — the first model framed on its own bounding box and the rest inherited that camera, so
a four-discipline boot ended up framed on Architecture at `dist 63.73`. `viewer.addModel` no
longer frames at all; `FederationController.addBatch` frames once, at the end, and **only** for
the batch that takes the federation from empty. Every later addition and every removal preserves
the camera, which is the design's `setModels` (`getCamera` → rebuild → `setCamera`) and which a
streamed renderer gets for free. `tests/unit/federation-store.test.ts` is that rule.

Regenerate the table and the `diff/*-3up.jpg` sheets from the repository root:

```sh
python3 - <<'EOF'
import json, os
import numpy as np
from PIL import Image

base, DPR = 'tests/parity/phase3', 2
os.makedirs(f'{base}/diff', exist_ok=True)

def box(mask, rect, value=True, clip=None):
    if not rect: return
    x, y, w, h = [v * DPR for v in rect]
    if clip: x, w = x + clip[0] * DPR, (clip[1] - clip[0]) * DPR
    mask[y:y+h, x:x+w] = value

print(f"{'state':26} {'chrome':>8} {'>12':>7} {'status':>8} {'>12':>7} {'stage 3D':>9} {'>12':>7}")
for f in sorted(os.listdir(f'{base}/app')):
    if not f.endswith('.png'): continue
    name = f[:-4]
    a = Image.open(f'{base}/app/{f}').convert('RGB')
    b = Image.open(f'{base}/prototype/{f}').convert('RGB')
    ra = json.load(open(f'{base}/app/{name}.json'))
    rb = json.load(open(f'{base}/prototype/{name}.json'))
    W, H = a.size
    d = np.abs(np.asarray(a).astype(np.int16) - np.asarray(b).astype(np.int16))

    chrome = np.ones((H, W), bool)
    box(chrome, ra['stage'], False)
    for k in ('toolbar', 'card', 'hint'):       # union: a surface only one side draws still counts
        box(chrome, ra.get(k)); box(chrome, rb.get(k))
    status = np.zeros((H, W), bool)
    box(status, ra.get('status')); box(status, rb.get('status'))
    chrome &= ~status
    stage = np.zeros((H, W), bool)              # the 3D, i.e. the stage minus its chrome
    box(stage, ra['stage'])
    for k in ('toolbar', 'card', 'hint'):
        box(stage, ra.get(k), False); box(stage, rb.get(k), False)
    box(stage, ra.get('status'), False); box(stage, rb.get('status'), False)
    if ra.get('status'):                        # backend name, fps digits, Phase 5's undo
        box(status, ra['status'], False, clip=(30, 56))
        box(status, ra['status'], False, clip=(80, 100))
        box(status, ra['status'], False,
            clip=(ra['status'][2] - 16, max(ra['status'][2], rb['status'][2])))

    stat = lambda m: (d[m].mean(), (d[m].max(axis=1) > 12).mean() * 100) if m.any() else (0.0, 0.0)
    cm, cp = stat(chrome); sm, sp = stat(status); gm, gp = stat(stage)
    print(f'{name:26} {cm:8.2f} {cp:6.2f}% {sm:8.2f} {sp:6.2f}% {gm:9.2f} {gp:6.2f}%')

    amp = Image.fromarray(np.clip(d * 8, 0, 255).astype(np.uint8))
    sheet = Image.new('RGB', (W * 3 // 2, H // 2))
    for i, img in enumerate((a, b, amp)):
        sheet.paste(img.resize((W // 2, H // 2), Image.LANCZOS), (i * W // 2, 0))
    sheet.save(f'{base}/diff/{name}-3up.jpg', quality=82)
EOF
```

## `project-card`, and why it is the one state that differs

The Spatial-structure card differs in **seven horizontal bands and nothing else**: outside them
the card's mean difference is **0.0001** (dark) / **0.0009** (light), with a maximum
single-channel difference of 1 and 6.

Four of the bands are the `GlobalId` rows, one per loaded file. The prototype has no files behind
its mock, so it *manufactures* a GlobalId from a hash of the model key (`SGVue.dc.html:1740`,
`guid(seed)`) — and manufactures the same one twice, `aaHxiWHVaynpienN4qnBim` for both
Architecture and Site & Landscape. The fidelity contract forbids inventing a value the file does
not carry ("never a placeholder"), so this build reads `IfcProject.GlobalId` from the index and
shows the design's own em dash when, as in the mock, there is none. On a real file the row fills
in; `../phase3/big-model.png` is that same card over a 137.9 MB export.

The remaining three bands are the card's **scrollbar thumb**, which is a consequence of the same
thing: the prototype's `Easting / Northing` and `True north` rows carry its placeholder
coordinates and wrap to two lines, so its scrollable content is about 45 px taller and its thumb
is 439 px against this build's 455 px.

`CompositionType` is a third case of the same rule: the design writes `ELEMENT` as a constant,
`ModelIndex` does not carry it, and this build shows the dash. Both rows are below the fold in
the capture, so they do not appear in the measurement — but they are the reviewer's call, and
adding `compositionType` to `worker/index-builder.ts` is what would close them.

## What Phase 3 does not draw yet, and where it will come from

| in the prototype's frame | phase |
|---|---|
| `undo` / `redo` in the status bar | 5 |
| the "Ask" chat pill, bottom right | 9 |
| gridlines, level tags (switched off in both sides' scenes here) | 6 |
| the property card, and therefore the `--rlane` reservation | 4 |

## The real-model readout

`scripts/shell-sanity.cjs` is the one guarded run this phase made against a real file; the
numbers are in `PROGRESS.md`. `big-model.png` beside this file is its frame.

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
SGVUE_IFC="samples/Sample Ifc Model.ifc" node scripts/safe-run.cjs shell-sanity.cjs
# and, on the mock, with the row-windowing threshold lowered so the windowed path is exercised:
SGVUE_IFC=mock SGVUE_ROWS=50 node scripts/safe-run.cjs shell-sanity.cjs
```
