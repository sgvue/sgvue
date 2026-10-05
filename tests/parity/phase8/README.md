# Phase 8 — design parity captures (landing, uploads, session, share link)

The landing page, its drop zone, its upload rows, the Resume card, the warning banner, the
sample pills, the sidebar's own upload rows, the library popover and the share link's
"link copied" flash.

Same method as Phases 3–7: both sides captured **whole** (`SGVUE_BARE=0` on the prototype),
both driven through their own real handlers, and the difference measured **per surface**.

**Two things are set through each side's own state API rather than clicked, and both are
forced by the phase.** The design's five upload stages are a `setTimeout` chain over a mock;
ours are a real worker on a real file, so a row's stage at any instant is a race between the
two rather than a parity property (the numbers themselves — 500 ms stagger, the five stage
percentages, the 420 ms minimum, the 1 100 ms hold — are asserted in
`tests/unit/upload.test.ts` against the design's own source lines). The same is true of the
1 600 ms "link copied" flash. So `setUploads`, `setDragging`, `setInitErr`, `setSession` and
`setLinkCopied` write the row state on both sides — `window.__sgvueDev` on ours, the logic
instance's own `setState` on the prototype's, reached the way Phase 7 reached its `colorBy`.
**Everything else is a designed control clicked by its own copy on both sides**: the drop
zone, `open all four as a federation →`, `library`, `Unload model` / `delete`,
`Saved viewpoints` and `copy link to this state`.

**The backdrop is frozen with `animation: none`, not `animation-play-state: paused`.** Pausing
freezes each side wherever its own 26 s survey-grid drift happened to be when the capture
started — a different phase on every run. Removing the animation puts both at phase 0, which is
what "so pixels compare" actually requires. The pointer is then placed at one fixed point
(720, 430) with a synthetic `pointermove`, because the parallax is written straight to CSS
custom properties from the pointer position (`SGVue.dc.html:1116`) and is otherwise wherever
the mouse last was.

**The PNGs, the JPEGs and the `*.json` sidecars are git-ignored.** The commands and the
measured numbers below are what belongs in the repository.

Every Electron run goes through `scripts/safe-run.cjs`. See `CLAUDE.md` for the three kernel
panics that put it there.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=landing,landing-dragover,landing-rejections,upload-midstage,upload-ready,landing-samples-open-all,landing-error-banner,sidebar-upload-rows,library-popover,link-copied

# the app, on the design's own mock federation, stopped at the landing page
for T in dark light; do
  SGVUE_HASH='mock&landing' SGVUE_OUT=tests/parity/phase8/app SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done

# the prototype, same states, same window, same clicks, auto-boot suppressed
python3 -m http.server 8765 --directory design-reference/design &
for T in dark light; do
  SGVUE_LANDING=1 SGVUE_BARE=0 SGVUE_OUT=tests/parity/phase8/prototype SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs parity-prototype.cjs
done
```

`#mock&landing` registers the design's four sample files as the app's library and **stops**,
leaving the landing page on screen; `SGVUE_LANDING=1` does the same on the prototype side by
suppressing the harness's own "open all four" click. Both are new in Phase 8 and mirror each
other, so the two harnesses stop in the same place. Without them, `#mock` and the prototype
harness both open the federation as they have since Phase 2, which is what every earlier
phase's states still need.

`UI`, `LANDING_STATES` and `RECTS` are written out **byte-identically** in both scripts
(9 104 / 1 945 / 5 940 bytes; the Build Report carries the `python3` check that asserts it).

The states run **in order**, each building on or undoing the last:

| state | what it does |
|---|---|
| `landing` | the page as it opens: hero, drop zone, four sample pills, footer |
| `landing-dragover` | `dragging` — the accent dashed border, the `--sel-bg` fill, "Release to load" |
| `landing-rejections` | three rejected rows carrying the design's own three reasons |
| `upload-midstage` | one row at `building geometry`, 64 %, spinner and shimmer |
| `upload-ready` | the same row at `ready`, 100 %, bar green, spinner replaced by the tick |
| `landing-resume-card` | rows cleared, "Resume last session · 1 model · 1 hidden" — **retired 2026-09-24**: the card is not in the port, so the state and its `setSession` hook are gone; the measurements below are the record |
| `landing-samples-open-all` | the pointer on the "Site & Landscape" pill — its hover state, with "open all four as a federation →" below it (the Resume card from the previous state is still up: the states are cumulative, as in every phase) |
| `landing-error-banner` | the warning banner carrying the design's own boot-failure sentence |
| `sidebar-upload-rows` | the federation opened through the design's own button, then three rows in the sidebar: busy, done, rejected |
| `library-popover` | one model unloaded, then `library` — the popover the design shows when something is addable |
| `link-copied` | the Viewpoints card, `copy link to this state` clicked, the flash standing |

## What the sidecars answer

Phase 8 adds two readbacks to the sidecar both scripts write beside every PNG:

- `landing` — the landing page's `getBoundingClientRect()`, found by its own `data-role`;
- `landingText` — every line of it, so the hero copy, the drop zone's two lines, each upload
  row's name and reason, the Resume card's sub-line, every pill, the "open all N" copy and the
  footer are compared as **text** rather than left to the pixels;
- `linkLabel` — whichever of `copy link to this state` / `link copied` is on the button.

**All three matched on every state, in both themes.** `landingText` is 29 lines in the
rejection state and identical line for line, including `not an IFC file` / `file is empty` /
`larger than 600 MB`, `open all four as a federation →` and `Parsed locally, never uploaded`.

## Measured difference per state

`mean` is the mean absolute per-channel difference over the region (0–255); `>12` is the share
of its pixels differing by more than 12 in any channel. 1440 × 860 at devicePixelRatio 2.
`—` means neither side drew that surface in that state. The status bar is clipped to its first
140 CSS px, as in Phases 6 and 7.

### dark

| state | landing / >12 | panel / >12 | views / >12 | status / >12 | stage / >12 / >40 / >80 |
|---|---|---|---|---|---|
| landing | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.02 % / 0.008 % / 0.000 % |
| landing-dragover | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.02 % / 0.006 % / 0.000 % |
| landing-rejections | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.009 % / 0.000 % |
| upload-midstage | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.02 % / 0.008 % / 0.000 % |
| upload-ready | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.02 % / 0.008 % / 0.000 % |
| landing-resume-card | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.009 % / 0.000 % |
| landing-samples-open-all | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.009 % / 0.000 % |
| landing-error-banner | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.009 % / 0.000 % |
| sidebar-upload-rows | — | **0.03 / 0.05 %** | — | 1.29 / 1.59 % | 2.55 / 4.76 % / 0.051 % / 0.027 % |
| library-popover | — | **0.02 / 0.04 %** | — | 1.29 / 1.59 % | 2.55 / 4.76 % / 0.058 % / 0.030 % |
| link-copied | — | 0.02 / 0.04 % | **0.01 / 0.00 %** | 1.29 / 1.59 % | 2.50 / 4.76 % / 0.058 % / 0.030 % |

### light

| state | landing / >12 | panel / >12 | views / >12 | status / >12 | stage / >12 / >40 / >80 |
|---|---|---|---|---|---|
| landing | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.010 % / 0.000 % |
| landing-dragover | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.02 % / 0.008 % / 0.000 % |
| landing-rejections | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.012 % / 0.000 % |
| upload-midstage | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.010 % / 0.000 % |
| upload-ready | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.010 % / 0.000 % |
| landing-resume-card | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.012 % / 0.000 % |
| landing-samples-open-all | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.012 % / 0.000 % |
| landing-error-banner | **0.01 / 0.02 %** | 0.00 / 0.00 % | — | 0.00 / 0.00 % | 0.01 / 0.03 % / 0.012 % / 0.000 % |
| sidebar-upload-rows | — | **0.03 / 0.05 %** | — | 1.52 / 1.64 % | 6.84 / 5.80 % / 0.161 % / 0.039 % |
| library-popover | — | **0.02 / 0.05 %** | — | 1.52 / 1.64 % | 6.84 / 5.81 % / 0.163 % / 0.040 % |
| link-copied | — | 0.02 / 0.04 % | **0.04 / 0.00 %** | 1.52 / 1.64 % | 6.52 / 5.80 % / 0.163 % / 0.040 % |

**The landing page measures 0.01 of 255 with 0.02–0.03 % of its pixels over 12, in all eight
states and both themes** — the whole 1440 × 860 window, not a card, and the tightest figure any
new surface has come in at. The sidebar with upload rows and the library popover measure
0.02–0.03; the Viewpoints card with the flash standing measures 0.01–0.04 with **0.00 % of its
pixels over 12**.

The `stage` column on the landing states measures the 3D viewport *behind* the landing overlay,
which is why it reads 0.01 there rather than the usual 2.5 / 6.8: nothing of it is visible. On
the three booted states it is the same hemisphere-light band every phase since 2a has measured.

## Each state really is a different picture, and it changed the same way on both sides

Measuring **within** each side — one state against the previous one — is a stronger check than
the cross-side diff: it says the same control produced the same change. Dark theme:

| pair | app | prototype |
|---|---|---|
| `landing` → `landing-dragover` | 1.072 mean, 8.062 % >12 | 1.072 mean, 8.062 % >12 |
| `landing` → `landing-rejections` | 4.814 mean, 4.409 % >12 | 4.814 mean, 4.407 % >12 |
| `landing` → `landing-samples-open-all` | 4.115 mean, 3.290 % >12 | 4.115 mean, 3.289 % >12 |
| `upload-midstage` → `upload-ready` | 0.141 mean, 0.212 % >12 | 0.141 mean, 0.212 % >12 |

Identical to three decimals in every pair: the accent drop-zone border, the three rejection
rows, the pill hover and the spinner→tick swap are the same change on both sides, not merely
the same end state.

## Everything that is visibly different — the complete list

**Nothing on the landing page.** All eight landing states matched pixel for pixel to
0.01 of 255, and `landingText` matched line for line in all sixteen captures.

The three booted states carry the three differences already recorded, and no others:

**1. The status bar's backend name: `WebGL2` against `WebGPU`.** Recorded since Phase 2a.
**2. The status bar's CRS chip: `—` against `SVY21`.** Recorded in Phase 6 — `shared/georef.ts`
names the file's own declared CRS and the mock federation has none.
**3. The "Ask" chat pill**, bottom right of the prototype's stage. Phase 9.

Both status-bar differences are also reported by the sidecar for the **landing** states, and
they are invisible there: the status bar sits behind the landing overlay at z-index 30 and does
not appear in a single pixel of those captures. 44 sidecar fields differed in total across the
22 captures and **every one of them is `statusText` or the status bar's width**.

**The expected sample-name difference did not happen, and that is deliberate.** Real recents
would give the app's pills different names from the prototype's fixed four; `#mock&landing`
registers the design's own `SAMPLE_FILES` as the library instead, so both sides render
`Architecture SB_ARC_R25.ifc / Structure SB_STR_R25.ifc / Site & Landscape SB_SIT_R25.ifc /
Mechanical SB_MEP_R25.ifc` and both read `open all four as a federation →`.

## The real-model run

One guarded run, through the **real** pipeline in the **real** app — the injected dialog answer
→ `admit` → a single-use token → the `sgvue-file://` stream → the parse worker → the designed
rows → the federation → the session → a relaunch and a resume:

```sh
npm run build
SGVUE_IFC="samples/Sample Ifc Model.ifc" SGVUE_MAX_SECONDS=900 \
  npm run test:e2e -- tests/e2e/big-model.spec.ts
```

137.9 MB, 26 761 elements.

| stage, as the row showed it | first seen, ms after the click |
|---|---|
| `reading file` | 487 |
| `parsing entities` | 2 771 |
| `building geometry` | 5 680 |
| `indexing properties` | 12 485 |
| `federating` | 12 917 |
| `ready` | 13 350 |

Every stage held for far longer than the 420 ms minimum except `federating`, which held for
exactly it (433 ms) — which is the scheduler doing its job at both ends. **Landing → viewer
18.05 s**, of which the last 4.7 s is the design's own 1 100 ms ready hold plus the federation
join, during which the designed loading badge reads "Building federation…".

Status bar: `WebGL2 · 25 fps · 26761 / 26761 · mm · SVY21`. Hiding `1st Storey` through its own
eye took it to `19837 / 26761 · mm · SVY21 · undo`.

Relaunch → "Resume last session" → **18.48 s to the restored camera**, matching the saved one
exactly, with the file's SHA-256 `0000aaaa…bbbb0000` identical on both runs. Peak
single-process footprint **2 132 MB** against the guard's 2 500 MB limit; no Electron process
survived the run.
