# Phase 2b — design parity captures

The fidelity contract (`CLAUDE.md` §"Design parity harness") requires every phase to be
reviewed side by side against the prototype at the same size and in the same state.

**The PNGs are git-ignored** (`.gitignore` carries the rule). Regenerate them with the two
commands below. Both drive the same Electron window at the same size **and send the same real
mouse events**, so the two sets are comparable pixel for pixel — 2b is about pointer
behaviour, so a capture that drove the app through a hook and the prototype through its own
handlers would prove nothing.

Every Electron run goes through `scripts/safe-run.cjs`, which refuses to start a second dev
Electron and kills any survivor afterwards; the guard inside each run watches the GPU helper's
`phys_footprint` every 250 ms. See `CLAUDE.md` for the three kernel panics that put it there.

```sh
# the app, on the design's own mock federation
VITE_SGVUE_DEVTOOLS=1 npm run build
SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase2b/app \
SGVUE_STATES=hover,select,multiselect,dblclick-frame,snap-corner,snap-measure,cube-hover,cube-click-east \
SGVUE_THEMES=dark,light node scripts/safe-run.cjs screenshot.cjs

# the prototype, same states, same window, same events
python3 -m http.server 8765 --directory design-reference/design &
SGVUE_OUT=tests/parity/phase2b/prototype \
SGVUE_STATES=hover,select,multiselect,dblclick-frame,snap-corner,snap-measure,cube-hover,cube-click-east \
SGVUE_THEMES=dark,light node scripts/safe-run.cjs parity-prototype.cjs
```

The states run **in order** and build on one another: `select` clicks what `hover` was over,
`multiselect` Ctrl-clicks a second element beside it, and `cube-click-east` clicks the zone
`cube-hover` was on. The view cube stays visible in both sets (2a hid it), because it is one
of the things 2b is responsible for.

**Coordinates**, in CSS pixels of the 1440 × 860 window — the stage fills it on both sides, so
one pair of numbers means the same place in both:

| name | point | what is there |
|---|---|---|
| `HOVER` | 620, 470 | the exposed edge of STR's *Floor Slab L3* |
| `SECOND` | 760, 505 | a beam on the east façade, for the Ctrl-click |
| `CORNER` | 750, 475 | the building's near vertical corner — inside the 16 px corner radius from both edges that meet there |
| `CUBE.e` | 1380, 93 | the **E** face zone of the 148 px cube (its box is x 1284…1432, y 8…156) |

**Size.** 1440 × 860 at devicePixelRatio 2 (2880 × 1720 captures) — the same reasoning as
Phase 2a: this Mac's work area is 1512 × 879, so a 1440 × 900 window is clamped by macOS and
the capture comes back short.

## Measured difference per state

`mean` is the mean absolute per-channel difference over the whole 2880 × 1720 frame (0–255);
`>12` is the share of pixels differing by more than 12 in any channel.

| state | dark: mean / >12 | light: mean / >12 |
|---|---|---|
| hover | 2.32 / 4.0 % | 6.95 / 5.0 % |
| select | 3.42 / 5.3 % | 6.85 / 4.7 % |
| multiselect | 2.24 / 3.7 % | 6.85 / 4.7 % |
| dblclick-frame | 4.31 / 12.2 % | 7.43 / 12.8 % |
| snap-corner | 2.23 / 3.7 % | 6.85 / 4.6 % |
| snap-measure | 2.44 / 3.8 % | 7.18 / 4.8 % |
| cube-hover | 2.24 / 3.7 % | 6.86 / 4.7 % |
| cube-click-east | 2.39 / 7.2 % | 8.09 / 44.6 % |

Regenerate the table and the `diff/*-3up.jpg` sheets with, from the repository root:

```sh
python3 - <<'EOF'
import os
import numpy as np
from PIL import Image
base = 'tests/parity/phase2b'
os.makedirs(f'{base}/diff', exist_ok=True)
for f in sorted(os.listdir(f'{base}/app')):
    if not f.endswith('.png'):
        continue
    a = Image.open(f'{base}/app/{f}').convert('RGB')
    b = Image.open(f'{base}/prototype/{f}').convert('RGB')
    d = np.abs(np.asarray(a).astype(np.int16) - np.asarray(b).astype(np.int16))
    amp = Image.fromarray(np.clip(d * 8, 0, 255).astype(np.uint8))
    w, h = a.size
    sheet = Image.new('RGB', (w * 3 // 2, h // 2))
    for i, img in enumerate((a, b, amp)):
        sheet.paste(img.resize((w // 2, h // 2), Image.LANCZOS), (i * w // 2, 0))
    sheet.save(f'{base}/diff/{f[:-4]}-3up.jpg', quality=82)
    print(f'{f[:-4]:26} {d.mean():6.2f} {(d.max(axis=2) > 12).mean() * 100:6.2f}%')
EOF
```

## What is left, and why

**Every number here is Phase 2a's floor**, not 2b's: it is the hemisphere-light difference
between the design's three r170 and our pinned 0.186, written up in full in
`../phase2a/README.md`. The pointer behaviour itself — what is hovered, what is selected,
where the camera lands, where the snap marker sits, which cube zone lights — is identical in
every pair. `dblclick-frame` proves it on numbers rather than by eye: the app and the
prototype, driven through the same mouse events, both select element `1000264` and both end
at

```
cam [37.51, -16.51, 28.1]   target [12, 9, 7.4]   dist 41.59   half 17.58
```

to the last digit printed.

**Why two states read higher.** The per-pixel difference on a lit surface is flat across all
of them; what changes is how much of the frame is lit surface. Measured on the same three
captures:

| state | lit surface, share of frame | mean \|diff\| **on** lit surface | > 12 within lit surface | > 12 over the whole frame |
|---|---|---|---|---|
| hover | 15.2 % | 9.84 | 25.8 % | 4.0 % |
| select | 15.2 % | 9.26 | 24.1 % | 3.7 % |
| dblclick-frame | 42.2 % | 9.49 | 28.6 % | 12.2 % |

So `dblclick-frame`'s 12 % is the identical difference seen over 2.8× as much surface, because
the double-click flew the camera from 70.31 m to 41.59 m and the building now fills the frame.
`cube-click-east` in light (44.6 %) is the same effect again and the same one as Phase 2a's
`section-C` light (41.1 %): an elevation view fills the frame with the white light-theme ground
and one flat façade, which is where the hemisphere term differs most. Its dark capture is
2.39 / 7.2 %, in the ordinary band.

## What 2b is measured on that a screenshot cannot show

| measurement | value | where |
|---|---|---|
| hover evaluation, 137.9 MB model (26 539 elements, 67 364 parts) | median **3.3 ms**, min 2.7, max 5.3 | `scripts/bench.cjs`, `debug().hoverMs` |
| hover evaluation, mock federation (412 elements) | median 0.10 ms | same |
| draw calls, 137.9 MB model | 87 | `debug().calls` |
| fps while orbiting, 137.9 MB model, WebGL2 | median 48–49, min 41 | `on.stats` |

Marumi's `Mesh.raycast` cost **222 ms** for one hover on a model this size (`CLAUDE.md`,
rendering traps). 3.3 ms is the element-box filter plus a triangle walk over the few parts
that survive it, with no acceleration structure at all — see `picking.ts` for why a
`MeshBVH` over a merged slot would be slower here, not faster.
