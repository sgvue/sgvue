# Phase 10 — design parity: the re-capture that proves nothing moved

Phase 10 adds no surface. Its two visible-risk changes are **accessibility attributes** on
designed markup (roles, `aria-*`, `tabindex`, one `@media (pointer: coarse)` block) and
**shadows rendered on change instead of every frame** (`viewer/scene.ts`,
`sun.shadow.autoUpdate = false`). Both are claims about pixels, so both are measured against
the same prototype frames the earlier phases used.

Two states are re-captured, one per kind of risk:

| state | why this one |
|---|---|
| `default` (Phase 3) | the whole designed shell: sidebar, tree, toolbar, status bar — everything the ARIA attributes are attached to |
| `chat-transcript` (Phase 9) | the assistant panel, the newest surface, and the one that gained `role="log"` and a labelled composer |

Both are on the design's own mock federation, in both themes, at 1440 × 860, devicePixelRatio 2.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase10/app SGVUE_THEMES=$T \
  SGVUE_STATES=default,chat-pill,chat-empty,chat-transcript \
  node scripts/safe-run.cjs screenshot.cjs
done
```

The prototype side is **not** re-run: the frames in `tests/parity/phase3/prototype` and
`tests/parity/phase9/prototype` are the specification and have not changed. `app-b/` is a
second capture of the same build, which is how the harness's own run-to-run noise is measured
below.

## 1 — the designed chrome is unchanged

Against the prototype, with Phase 3's own mask (everything outside the stage, plus the toolbar,
cards and hint bar; the status bar measured separately):

| state | chrome / >12 | Phase 3 recorded |
|---|---|---|
| `default-dark` | **0.02 / 0.03 %** | 0.02 / 0.03 % |
| `default-light` | **0.02 / 0.03 %** | 0.02 / 0.03 % |

And the panel, against the prototype with Phase 9's own `chat` rect:

| state | chat / >12 | Phase 9 recorded |
|---|---|---|
| `chat-transcript-dark` | **0.00 / 0.01 %** | 0.00 / 0.01 % |
| `chat-transcript-light` | **0.01 / 0.01 %** | 0.01 / 0.01 % |

Identical to the recorded figures. The roles, the `aria-*` attributes and the roving
`tabindex` are invisible, and the 44 px touch rule is inside `@media (pointer: coarse)`, which
a synthetic mouse never matches.

## 2 — the 3D, with shadows rendered on change only

Same mask on both sides (the stage minus toolbar, cards, hint bar, status bar and panel), same
prototype frame, measured against the **pre-Phase-10 capture** (`tests/parity/phase9/app`,
taken at the Phase 9b commit) and the post-Phase-10 one:

| state | before | after |
|---|---|---|
| `chat-transcript-dark` | 2.77 / 5.68 % | **2.77 / 5.68 %** |
| `chat-transcript-light` | 6.88 / 6.29 % | **6.88 / 6.29 %** |

The same number to two decimals, in both themes. The band it sits in is Phase 2a's
hemisphere-light difference, documented in `../phase2a/README.md`; nothing in it is Phase 10's.

**Why a shadow map computed on change is the same picture.** The sun is aimed at the model's
own centre and stands off it by a fixed offset (`scene.ts`), so the shadow camera's view does
not depend on the view camera at all — orbiting cannot change the map. What can is the scene:
geometry arriving or leaving, a part hidden, ghosted, faded or recoloured, the section plane,
the shadow toggle and the theme. Each of those calls `rig.invalidateShadows()`, and the
per-part alpha case is covered by the frame loop itself, because `partState.flush()` now
reports whether it uploaded and an upload is exactly when the shadow pass's own `maskNode`
discard could differ.

## 3 — the harness's own noise, for scale

Two captures of the **same build**, same states, taken back to back (`app/` and `app-b/`):

| state | mean over the whole window | pixels > 12 | max |
|---|---|---|---|
| `default-dark` | 0.0082 | 0.017 % (855 px of 4.95 M) | 82 |
| `chat-transcript-dark` | 0.0049 | 0.010 % (508 px) | 82 |

All of it is inside the 3D, in one band (x 556–1200, y 438–738 CSS px) — the label-occlusion
raycasts and the stage's own antialiasing, which land a frame differently each run. The
before/after difference for `chat-transcript-dark` is **0.0076 mean / 641 px**, i.e. inside
that noise, and the aggregate stage figure in §2 is identical either way.

`default` against its Phase 3 capture is larger (0.14 mean, 11 349 px) and none of it is this
phase's: that frame predates the gridline bubbles Phase 6 draws and the `Ask` pill Phase 9
adds, both of which the prototype draws too — which is why §1 and §2 measure against the
**prototype**, not against an old capture of ourselves.
