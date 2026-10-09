# 2026-10-09 — a file refused for its size is told to split the model

Not a parity phase: the design has no such advice, so nothing here is differenced against the
prototype. It is the app's own row, on every route that refuses a file for its size, at the
**default window** — 1280 × 820 outside, **1264 × 755 inside** on Windows — in both themes.

The owner: *"add consider splitting into multiple models message for files over 600mb."*
(`CLAUDE.md`, allowed desktop deviations, and `docs/DECISIONS.md`.) What has to hold:

- **Every route says the same.** The design's reason, `larger than 600 MB`, keeps its words and
  gains ` — consider splitting it into several models` (`TOO_LARGE`, `src/shared/upload.ts`):
  a drop, the Open dialog on the landing page and after boot, a Recent pill, a share link — and an
  `.ifczip` whose one `.ifc` declares more than 600 MB, in its row and in the landing page's
  banner.
- **It fits the designed row.** No element, no control and no style string changes. The stage
  line is the design's own, which wraps and never clips, so it carries no `title` (the
  2026-10-01 `fullText` rule is for text that is clipped).

The PNGs are git-ignored, like every capture under `tests/parity/`; this file is what is kept.

## Capturing

```sh
VITE_SGVUE_DEVTOOLS=1 npm run build
RF_BIG=<the 610 MB file> RF_TWIN=<a small valid file of the same name> \
RF_ZIP=<oversize-inside.ifczip> RF_GOODZIP=<tiny-zipped.ifczip> \
RF_OUT=<result.json> RF_SHOTS=tests/parity/2026-10-09-split \
SGVUE_MAX_SECONDS=400 node scripts/safe-run.cjs <harness>
```

The harness is a one-off, kept outside the repository: it runs the real `out/main/index.js`
inside the in-process guard and takes each route the way a person does — the drop zone clicked
with `SGVUE_OPEN_PATHS` set (main reads it at each click; development builds only) for the Open
dialog, a `DragEvent('drop')` carrying a `File` of the same name and size for a drop, the pill
itself for Recent, the page reloaded at `#s=<payload>` for a share link (the hash a launch link
arrives in), and the sidebar's `upload` after boot. At each capture it sets the theme
(`__sgvueDev.setTheme`), waits 900 ms, measures the row in the DOM, and takes
`webContents.capturePage` of the row's box (with the banner, when there is one) plus 16 px, and
of the whole window.

The inputs: the capacity measurement's synthetic 610 MB file (639 475 090 bytes) and a small valid
file of the same name; `oversize-inside.ifczip`, `tests/fixtures/tiny.ifc` zipped and its central
directory then made to declare 700 MB (1 576 bytes on disk); `tiny-zipped.ifczip`, the same file
zipped as it is (1 574 bytes).

| Route | What it showed |
|---|---|
| Open dialog, landing page | the row; no banner |
| drop | the row |
| Recent pill | the row |
| share link naming the file and one that has moved | the row; the banner names only the moved file |
| Open dialog after boot, a model of that key open | the sidebar's row; no "Replace model?" |
| `oversize-inside.ifczip`, Open dialog | the row and the banner, both ending with the advice |
| `tiny-zipped.ifczip`, Open dialog | opens — 6 elements, the archive's hash (below) |

## Files

| File | What |
|---|---|
| `landing-row-{dark,light}.png` | the landing page's row, from the Open dialog |
| `sidebar-row-{dark,light}.png` | the sidebar's row, from the Open dialog after boot |
| `ifczip-banner-row-{dark,light}.png` | the `.ifczip` refusal: the landing page's banner and its row |
| `*-window.png` | each of those moments, the whole window |

## Measured — the fit

CSS px, both themes alike:

| Where | Row | Stage line | Lines | Overflows · clipped |
|---|---|---|---|---|
| landing page — `larger than 600 MB — consider splitting it into several models` | 590 × 59.19 | 515 × 14.30 | 1 | no · no |
| sidebar after boot — the same | 277 × 64.53 | 231 × 27.28 | 2 | no · no |
| landing page — `the .ifc file in the archive is larger than 600 MB — consider splitting it into several models` | 590 × 73.48 | 515 × 28.59 | 2 | no · no |
| the landing page's banner — `Could not open that model — the .ifc file in the archive is …` | 620 × 63.5 | — | 2 | no · no |

Each stage line's style string is the design's, read back from the DOM: `font: 400 11px/1.3
var(--mono); color: var(--warn-ink);` on the landing page, `font: 400 10.5px/1.3 var(--mono);
color: var(--faint); animation: … ifcpulse` in the sidebar — `white-space: normal`,
`text-overflow: clip`, no `title`, nothing in the row overflowing. In the sidebar the reason takes
two lines where the design's bare one takes one, so that row is one line — 13.65 px, 10.5 px ×
1.3 — taller.

## Found while capturing: an `.ifczip` from the Open dialog never opened

From the Open dialog, a Recent pill or a share link the parse worker is handed a `Blob` named by
the model key — the file name without its extension — so its `.ifczip` test never matched there
and the archive went whole to web-ifc. On `57801eb`, from the Open dialog: `tiny-zipped.ifczip`
took the renderer to 4.2 GB before web-ifc aborted with `bad_alloc`, the row reading
`Aborted(native code called abort())`, and `oversize-inside.ifczip` did the same at 4.1 GB. The
worker now knows an archive by its first four bytes as well as by its name (`isIfczip`,
`src/worker/ifczip.ts`), and both routes above show what they should. `docs/DECISIONS.md` and
`docs/TRAPS.md` have the rest.
