# Phase 9b — design parity captures (the assistant panel)

The pill, the panel, its transcript — bubbles with their notches, chips, a result table with
`copy csv`, a change the scope guard held back with apply / cancel — the busy row, the reply
strip and the quote it leaves in a bubble, the four contextual suggestions, the composer, and
the panel stepping out of the property card's lane.

Same method as Phases 3–8: both sides captured **whole** (`SGVUE_BARE=0` on the prototype),
both driven through their own real handlers, and the difference measured **per surface**.

> **2026-10-01 — the numbers below are the panel as Phase 9 built it.** Since the owner's "Ask
> Vee" handoff (`design-reference/ask-vee/`, the specification for the assistant's panel) the
> app differs from the prototype here **by design**: the assistant is `Vee` with its pixel
> mascot, a user's row stands on the left with the assistant's corner, and `chat-busy` is no
> longer the busy row — the brand mark, `totalling quantities`, three dots — but the reply
> being written: `Vee`, a shimmering `Thinking`, and the send button as a stop. The states still
> run on both sides (`chat-busy` holds the app's trace clock three seconds into the turn and
> its sprite clock at frame 0, so the capture is the same on every run); what they measure now
> is that difference. `tests/parity/2026-10-01-vee/README.md` compares the new panel with the
> handoff's own stills.

**One thing is set through each side's own state API rather than clicked, and the phase forces
it.** A transcript, a busy row and a reply cannot be produced without an API key, and this
build never asks for one. So `setChat` writes the **messages** on both sides —
`window.__sgvueDev.chat.setState` on ours, the logic instance's own `setState` on the
prototype's, reached the way Phase 7 reached its `colorBy` and Phase 8 its upload rows.
**Everything else in these captures is a designed control clicked by its own copy on both
sides**: the `Ask` pill opens the panel, and a wall in the viewport is clicked at the same
coordinates through Chromium's own input pipeline for the property-card state.

The transcript itself is invented — two turns, two chips, three table rows, one pending change
— and is byte-identical in both scripts, so the two sides are asked to render the same thing.

**The animations are frozen with `animation: none`.** The busy row's three dots, its brand mark
tracing itself (`ifctrace`) and its breathing outline (`ifcbreathe`) are animations, as is the
26 s survey-grid drift behind them; which frame each side happens to be on when `capturePage()`
runs is a race rather than a parity property. `freeze()` removes the animations, so both sides
render each element's base style — the Phase 8 decision, applied to three more keyframes.

**The PNGs and the `*.json` sidecars are git-ignored.** The commands and the measured numbers
below are what belongs in the repository.

Every Electron run goes through `scripts/safe-run.cjs`. See `CLAUDE.md` for the three kernel
panics that put it there.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
STATES=chat-pill,chat-empty,chat-transcript,chat-busy,chat-reply,chat-with-card,chat-corner-hover

# the app, on the design's own mock federation
for T in dark light; do
  SGVUE_HASH=mock SGVUE_OUT=tests/parity/phase9/app SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs screenshot.cjs
done

# the prototype, same states, same window, same clicks, chrome in frame
python3 -m http.server 8765 --directory design-reference/design &
for T in dark light; do
  SGVUE_BARE=0 SGVUE_OUT=tests/parity/phase9/prototype SGVUE_THEMES=$T SGVUE_STATES=$STATES \
  node scripts/safe-run.cjs parity-prototype.cjs
done
```

`UI`, `CHAT_STATES` and `RECTS` are written out **byte-identically** in both scripts
(10 731 / 866 / 6 572 bytes, asserted with `python3` in the Build Report).

The states run **in order**, each building on the last:

| state | what it does |
|---|---|
| `chat-pill` | the shell with the panel closed: the `Ask` pill, bottom right |
| `chat-empty` | the pill clicked — the panel, its empty-state copy and four suggestions |
| `chat-transcript` | one finished turn: a user bubble, an assistant bubble, two chips, a three-row `Level` table with `copy csv`, and a held-back change with apply / cancel |
| `chat-busy` | the transcript a turn actually has while it runs — the question alone — and the busy row: the brand mark, `totalling quantities`, the three dots |
| `chat-reply` | `chatReplyTo` on the assistant turn: the composer's reply strip, and the quote block inside the user bubble that answers it |
| `chat-with-card` | a wall clicked in the viewport: the property card opens and the panel steps out of its lane, `right` 12 → 344 |
| `chat-corner-hover` | the pointer on the resize corner: the design's one hover that travels through a custom property (`--grab`), turning both strokes accent |

## What the sidecars answer

Phase 9 adds three readbacks to the sidecar both scripts write beside every PNG:

- `chat` — the panel's `getBoundingClientRect()`, found as the design's one absolutely
  positioned z-index-12 box (`SGVue.dc.html:431`);
- `chatText` — every line of it, so the labels, the bubbles' copy, each chip, each table row,
  the pending sentence, `apply` / `cancel` and the four suggestions are compared as **text**
  rather than left to the pixels;
- `pill` — the pill's rect, which is a `<button>` and so is not among the boxes.

**All three matched on every state, in both themes.** `chatText` is 27 lines in the transcript
state and identical line for line, including `742.5 m²` / `610.3 m²` / `388.0 m²`,
`isolate 140 elements — leaves 140 of 412 visible` and the suggestion set the design's own
rules produce for that state (`Break that down by level instead`, `Isolate those elements`,
`Check Architecture against Structure`, `How many trees, by species?`).

The panel's rect is the same pair of numbers on both sides in every state:
`[1098, 388, 330, 420]`, and `[766, 388, 330, 420]` with the property card open — the 332 px
step the design's `chatRight` takes (`:2049`).

## Measured difference per state

`mean` is the mean absolute per-channel difference over the region (0–255); `>12` is the share
of its pixels differing by more than 12 in any channel. 1440 × 860 at devicePixelRatio 2.
`—` means neither side drew that surface in that state. The status bar is clipped to its first
140 CSS px, as in Phases 6–8.

### dark

| state | chat / >12 | pill / >12 | propcard / >12 | panel / >12 | status / >12 | stage / >12 |
|---|---|---|---|---|---|---|
| chat-pill | — | **0.12 / 0.01 %** | — | 0.02 / 0.03 % | 1.29 / 1.59 % | 2.53 / 4.73 % |
| chat-empty | **0.00 / 0.00 %** | 0.13 / 0.01 % | — | 0.02 / 0.03 % | 1.29 / 1.59 % | 2.30 / 4.69 % |
| chat-transcript | **0.00 / 0.01 %** | 0.13 / 0.01 % | — | 0.02 / 0.03 % | 1.29 / 1.59 % | 2.30 / 4.69 % |
| chat-busy | **0.00 / 0.01 %** | 0.13 / 0.01 % | — | 0.02 / 0.03 % | 1.29 / 1.59 % | 2.30 / 4.69 % |
| chat-reply | **0.01 / 0.02 %** | 0.13 / 0.01 % | — | 0.02 / 0.03 % | 1.29 / 1.59 % | 2.30 / 4.69 % |
| chat-with-card | **0.01 / 0.02 %** | 0.13 / 0.01 % | 0.02 / 0.04 % | 0.02 / 0.03 % | 2.25 / 2.81 % | 1.21 / 1.62 % |
| chat-corner-hover | **0.01 / 0.02 %** | 0.13 / 0.01 % | 0.02 / 0.04 % | 0.02 / 0.03 % | 1.29 / 1.59 % | 1.21 / 1.62 % |

### light

| state | chat / >12 | pill / >12 | propcard / >12 | panel / >12 | status / >12 | stage / >12 |
|---|---|---|---|---|---|---|
| chat-pill | — | **0.85 / 0.05 %** | — | 0.02 / 0.03 % | 1.52 / 1.64 % | 6.77 / 5.62 % |
| chat-empty | **0.01 / 0.00 %** | 0.85 / 0.05 % | — | 0.02 / 0.03 % | 1.52 / 1.64 % | 5.69 / 5.25 % |
| chat-transcript | **0.01 / 0.01 %** | 0.85 / 0.05 % | — | 0.02 / 0.03 % | 1.52 / 1.64 % | 5.69 / 5.25 % |
| chat-busy | **0.01 / 0.01 %** | 0.85 / 0.05 % | — | 0.02 / 0.03 % | 1.52 / 1.64 % | 5.69 / 5.25 % |
| chat-reply | **0.02 / 0.02 %** | 0.85 / 0.05 % | — | 0.02 / 0.03 % | 1.52 / 1.64 % | 5.69 / 5.25 % |
| chat-with-card | **0.01 / 0.02 %** | 0.85 / 0.05 % | 0.03 / 0.04 % | 0.02 / 0.03 % | 1.52 / 1.64 % | 4.05 / 2.04 % |
| chat-corner-hover | **0.01 / 0.02 %** | 0.85 / 0.05 % | 0.03 / 0.04 % | 0.02 / 0.03 % | 1.52 / 1.64 % | 4.05 / 2.04 % |

**The panel measures 0.00–0.02 of 255 with at most 0.02 % of its pixels over 12**, in all six
states that draw it and in both themes — the whole 330 × 420 box, chrome included.

`chat-with-card`'s status-bar figure is 2.25 in dark rather than the usual 1.29 because the two
sides' fps counters happened to read differently in that pair of frames; the field is one of the
two already-recorded status-bar differences and it varies with the run.

The pill's figure is a handful of edge pixels: over its 67 × 32 box at ×2 there is **one**
pixel over 12 in dark (max difference 29) and **four** in light (max 33), all on the rounded
border and the sparkle's strokes. The light theme's 0.85 mean is the box shadow, sub-threshold
across the whole pill.

## Each state really is a different picture, and it changed the same way on both sides

Measuring **within** each side — one state against the previous one, over the whole window —
says the same control produced the same change, which is a stronger check than the cross-side
diff. Dark theme:

| pair | app | prototype |
|---|---|---|
| `chat-pill` → `chat-empty` | 1.189 mean, 1.629 % >12 | 1.226 mean, 1.635 % >12 |
| `chat-empty` → `chat-transcript` | 0.958 mean, 2.669 % >12 | 0.958 mean, 2.669 % >12 |
| `chat-transcript` → `chat-busy` | 1.072 mean, 3.219 % >12 | 1.072 mean, 3.219 % >12 |
| `chat-busy` → `chat-reply` | 0.926 mean, 2.527 % >12 | 0.926 mean, 2.527 % >12 |
| `chat-reply` → `chat-with-card` | 9.063 mean, 12.703 % >12 | 9.420 mean, 12.716 % >12 |
| `chat-with-card` → `chat-corner-hover`, corner only | 4.78 mean, 5.41 % >12, max 124 | 4.78 mean, 5.41 % >12, max 124 |

Identical to three decimals on the three pairs that change only the panel. The two that differ
are the two that uncover or re-cover the 3D stage — opening the panel over it, and moving the
panel 332 px left — where the difference is Phase 2a's hemisphere-light band, not this phase's.

## Everything that is visibly different — the complete list

**Nothing in the panel, the pill or the suggestions.** Every `chatText` line matched in all
fourteen captures, and the panel's rect matched in all twelve that draw it.

The last row above is the hover check, measured over the 34 × 34 corner alone and **within**
each side: the design's `--grab` custom property lands identically on both, to two decimals and
to the same maximum channel difference (124 in dark, 131 in light).

The two differences the sidecar reports are the two already recorded, and they are both in the
status bar:

**1. The backend name: `WebGL2` against `WebGPU`.** Recorded since Phase 2a — `backend: 'auto'`
is WebGL2 here by decision, and the prototype creates its own WebGPU renderer.
**2. The CRS chip: `—` against `SVY21`.** Recorded in Phase 6 — `shared/georef.ts` names the
file's own declared CRS and the mock federation declares none.

52 sidecar fields differed in total across the 14 captures and **every one of them is
`statusText` or the status bar's width**.

**Phase 8's third difference is gone.** Its list ended with "**3. The 'Ask' chat pill**, bottom
right of the prototype's stage. Phase 9." — the pill is now on both sides, to one pixel.

## The side-by-sides

`<state>-<theme>.png` in this directory, app on the left and prototype on the right, each side
downscaled to 1440 × 860 with an 8 px red seam between them. Git-ignored; regenerate them from
the two capture sets with any image tool, or re-run the two commands above.
