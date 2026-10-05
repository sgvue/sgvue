# 2026-10-01 — the landing page's update notice

Not a parity phase: the design has no such notice, so nothing here is differenced against the
prototype. It is the app against itself, on the landing page with the design's four sample
pills (`#mock&landing`), at **1280 × 820**, in both themes:

| folder | what |
|---|---|
| `before/`, `before-b/` | `2893aff`, the commit before the notice — captured twice |
| `without/`, `without-b/` | this change, nothing newer out — captured twice |
| `with/` | this change, a newer version out (`99.0.0`): `landing`, and `landing-error-banner` with the warning banner under it |

The request, the owner's choice and what the check sends are in `CLAUDE.md` (allowed desktop
deviations, 2026-10-01) and `docs/DECISIONS.md`. The PNGs and their `.json` sidecars are
git-ignored, like every capture under `tests/parity/`; this file is what is kept.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
for T in dark light; do
  # nothing newer
  SGVUE_SIZE=1280x820 SGVUE_HASH='mock&landing' SGVUE_OUT=tests/parity/2026-10-01-update-notice/without \
  SGVUE_THEMES=$T SGVUE_STATES=landing node scripts/safe-run.cjs screenshot.cjs
  # a newer version
  SGVUE_UPDATE_LATEST=99.0.0 SGVUE_SIZE=1280x820 SGVUE_HASH='mock&landing' \
  SGVUE_OUT=tests/parity/2026-10-01-update-notice/with \
  SGVUE_THEMES=$T SGVUE_STATES=landing,landing-error-banner node scripts/safe-run.cjs screenshot.cjs
done
```

`scripts/screenshot.cjs` is its own main process, so it answers the page's `update:check`
itself and makes no request: `null`, or `{ latest }` when `SGVUE_UPDATE_LATEST` is set. The
real answer — `src/main/updates.ts`, with its validation and its comparison — is exercised by
`tests/unit/updates.test.ts` and by the smoke e2e, which launches the app's own main.
`before/` is the same command run against a build of `2893aff`.

## With nothing newer, the page is what it was

Differing pixels of 1 049 600, `landing`:

| | dark | light |
|---|---|---|
| `before` against `before-b` — the old build twice | 10 (≤ 1 of 255) | **0** |
| `without` against `without-b` — this build twice | 7 (≤ 1 of 255) | 19 (≤ 1 of 255) |
| `before-b` against `without` | **0**, the same bytes | **0**, the same bytes |
| `before` against `without` | 10 (≤ 1 of 255) | **0**, the same bytes |

Two captures of one build differ by up to 19 pixels, each by one level of one channel, in the
drifting backdrop; across the two builds there is a pair with identical bytes in each theme.

The DOM is the same too: the landing page's `outerHTML` is byte-identical between the two
builds (7 922 bytes), at 1280 × 820 and at 1264 × 755, and so is every rectangle below.

## With a newer version

The notice is `[data-role="update-notice"]`, the designed warning banner's box in the accent
tokens: `--sel-bg` under a 1 px `--accent` border, radius 10 px, padding 12 × 14 px; the text
`SGVue 99.0.0 is available — you have 1.1.0.` in `--sel-ink`, 12.5 px; the button
`get the update →` in the page's own text-button style, `--accent-ink`. No icon, no dismiss.

CSS pixels `[x, y, w, h]`, the same in both themes:

| window | | introduction | notice | drop zone | `Recent` | demo button | page scrolls |
|---|---|---|---|---|---|---|---|
| 1280 × 820 | without | `[330, 105.13, 620, 147.45]` | — | `[330, 274.58, 620, 163.3]` | y 492.88 | y 630.88 | no |
| 1280 × 820 | with | `[330, 71.75, 620, 147.45]` | `[330, 241.2, 620, 44.75]` | `[330, 307.95, 620, 163.3]` | y 526.25 | y 664.25 | no |
| 1264 × 755 | without | `[322, 72.63, 620, 147.45]` | — | `[322, 242.08, 620, 163.3]` | y 460.38 | y 598.38 | no |
| 1264 × 755 | with | `[318, 56, 620, 147.45]` | `[318, 225.45, 620, 44.75]` | `[318, 292.2, 620, 163.3]` | y 510.5 | y 648.5 | **by 34 px** |

- The notice is the column's width, a column gap (22 px) under the introduction and a column
  gap above the drop zone. With the warning banner up as well it is the first of the two, the
  banner 22 px under it (`with/landing-error-banner-*`).
- **The column grows by 66.75 px** — the notice's 44.75 and one gap — and the design centres
  that column in the page, so at 1280 × 820 what is above the notice stands 33.4 px higher and
  what is below it 33.4 px lower. The designed warning banner moves the page the same way.
- **At 1264 × 755** — what the default 1280 × 820 window measures inside on Windows — the
  page with four pills and the notice is 789 px tall, 34 px more than the window, so it
  scrolls (the page is `overflow:auto`, as designed) and the column stands 4 px to the left,
  beside the scrollbar. The four pills are two rows; a row is 39 px, so with one row the page
  would be 750 px and fit — computed, not captured.
