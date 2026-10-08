# SGVue — System Specification

SGVue is a desktop application for **reading** IFC building models. This document is the
technical record of what it is, how it is put together, and what it promises. It is written
to be read by a person who has to trust the app with a real project model, not only by the
people building it.

Every section carries a **Status** line. Phase 0 is the scaffold, so most sections describe
the agreed design and say plainly which parts are not built yet. The document is updated at
the end of every phase.

- Version: 1.2.0 · all ten phases built (`docs/releases/1.2.0.md` is what changed since 1.1.0)
- Last updated: 2026-10-02
- Specification of record for everything visible: `design-reference/design/SGVue.dc.html`
  and `design-reference/design/viewer-core.js`

---

## 1. Purpose and non-goals

SGVue loads one or more IFC files, merges them into a single **federation**, and lets a
reviewer isolate by storey, entity or rule, cut sections along gridlines, measure with
corner snapping, read IFC property sets, colour by any property, and drive all of it in
plain language through an AI assistant.

**It is a viewer.** It never edits the model.

| Non-goal | What this means in practice |
|---|---|
| No editing | No tool, menu item, keyboard shortcut or assistant command writes a name, property, classification or geometry back into an IFC file. There is no "save model". |
| No uploading | IFC files never leave the machine. Parsing, indexing and rendering all happen locally. |
| No authoring | SGVue does not create IFC files, and does not export IFC. |
| No compliance verdict | It reports what a file contains, including georeferencing and IFC-SG property sets. It does not certify a submission. |

**What the assistant sends.** The model itself is never sent anywhere. When you ask the
assistant a question, what leaves the machine is: your question, a description of the model's
*vocabulary* (entity types, property names, and up to 150 values per category, with counts),
a small JSON summary of the current view, and the results of the read-only tools it calls.
The exact payload of the last request is visible in Preferences → "Data sent to AI". If no
API key is set, nothing is sent at all and the assistant is inert.

> **Status: Phase 0.** Purpose and non-goals are fixed and are enforced from Phase 0 by the
> read-only guard test (§6). The assistant itself arrives in Phase 9.

---

## 2. Fidelity contract and the desktop-necessary deviations

SGVue is a port of a finished high-fidelity design, not a fresh interpretation of it.

**The rules the build follows:**

1. **Port, don't redesign.** Markup is translated from the design's template syntax to JSX one
   element at a time, keeping structure, class names, `data-role`s, copy and `data-tip` texts
   verbatim. The design's `<style>` block is copied as-is. The design's logic class is ported
   method by method, keeping names and semantics.
2. **Same behaviour, same numbers.** Every timing, radius, size, opacity, threshold and
   shortcut is kept (220 ms crossfade, 16/11 px snap radii, 5 % scope guard, cap 50 undo,
   cap 12 filter sets, 500 ms stagger, 1100 ms ready hold, 26 s grid drift, 148 px cube,
   332 px right lane, z-order 14/13/12/6, …).
3. **Internal implementation may differ only where it is invisible** — batched drawing instead
   of one mesh per part, a scissor-viewport view cube instead of a second renderer, parsing in
   a worker. The visible result must be identical.
4. **Design parity harness.** A development-only adapter turns the design's own mock model
   generator into the app's data contract, so the app can render the exact same mock
   federation as the prototype. Every phase is reviewed with side-by-side screenshots:
   prototype in Chrome versus the app at the same window size and state. Differences are
   defects.

**Allowed deviations.** The one complete list is `CLAUDE.md`'s — *Allowed desktop deviations —
the complete list* — and anything not on **that** list is a defect; each entry's reasoning and
measurements are its row in `docs/DECISIONS.md`. The table below holds ten of them — the five
the port began with and five of the dated ones — and is kept for their reasons, not as the
list. The rest are recorded there and not here: among them the landing page's Recent pills,
demo building and update notice, the sidebar's resizable sections, the toolbar's groups and
the bottom row, the two section cuts, the Schedules window, and the assistant's name, its
thinking trace, its per-reply revert and its consent gate.

| Deviation | Why it is necessary |
|---|---|
| The designed upload / drop-zone controls keep their copy and look, but files arrive from Electron's native Open dialog or native drag-and-drop rather than a browser file input. | A desktop app has no browser file input. |
| "Copy link" keeps its control, copy and 1 600 ms flash; the link is `sgvue://s=…` (the app registers the scheme) and reopens the exact view when the referenced files are available. | A desktop app has no URL bar. |
| Settings the design has no surface for — API key, model, effort, "Data sent to AI" — live behind the native application menu (Preferences…) in a small dialog built from the design tokens. No designed surface changes. | The design predates these settings; adding them to a designed surface would break fidelity. |
| The sample library is backed by real IFC files the user provides — same pills, same "open all N" copy, rendered only when the list is non-empty. | The prototype's samples were fake. |
| Fonts are self-hosted (the design says to); there is no `<head>` SEO metadata; window chrome is the operating system's. | Not a web page. |
| **2026-09-20** — the Coordinate-system card's caption keeps `project base point` verbatim and appends ` · ` plus the detected georeferencing method (`IfcSite placement`, `IfcMapConversion`, `IfcMapConversion + IfcSite placement`, `ePset_MapConversion`, and since 2026-10-08 `WorldCoordinateSystem` and `WorldCoordinateSystem + IfcSite placement`), inside the same span and the same style. Nothing is appended when the file carries no georeferencing (or, until the card became read-only on 2026-10-08, once the four fields stopped showing what the file said); when something is appended the row gains `flex-wrap:wrap` so the caption takes its own line under the CRS chip. | Asked for by the user in these words: *"auto detect which way the model is using and show it"*. A real file may be placed by its site placement, by a map conversion, by both, or by an IFC2X3 pset, and the four numbers mean different things in each case. |
| **2026-09-20** — a grid bubble that would overprint its neighbour is not drawn, and reappears as the view zooms in. `shared/annotate.ts`'s `declutterBubbles` keeps the first bubble of each row in the grid's own axis order and drops any whose measured box comes within 2 px of one already kept; a row is one family at one end. A dropped bubble is hidden through the same path an occluded one takes — same `display`, no new element, no new class — and is no more clickable. | Asked for by the user in these words: *"apply your recommendations for both"*. The design has no rule because its mock grid is nine well-spaced axes; the reference model's numbered family is 24, which in plan puts 26 px bubbles about 20 px apart, so they overprint and their labels clip. |
| **2026-09-20** — **above six storeys** (the design's own count) the element tree keeps a `min-height` of 40 % of the aside; the STOREYS rows wrapper gives way first (`flex:0 1000000 auto`, a three-row `min-height`, `overflow:auto` — the factor is that large so the shortage shared by `flex-shrink × base size` leaks less than a 1/64 px `LayoutUnit` to the other list) and the MODELS rows wrapper is the last resort (`flex:0 1 auto;overflow:auto`), both using the design's own global scrollbar rule. At six storeys or fewer every style string is the design's, byte for byte. No new element, no new control, no class. | The design's aside is a column flexbox in which the tree is the only item that can give (`:64`, `:176`), so a real storey ladder starves it: twelve storeys left the tree **one row** at the launch window size. The user's rule: *"go with the 40 percent split"*. The gate is what keeps the design's own four-model mock untouched — its tree is only 18.1 % of the aside at the parity window — and what stops a single-model federation's MODELS list being squeezed for no reason. |
| **2026-09-21** — the landing page's footer strip (`SGVue.dc.html:817–829`) is not in the port: no `© <year> SGVue`, no `·`, no `Parsed locally, never uploaded`, no spacer, no `Privacy` / `Terms` / `Support` links and no `border-top` divider. Its **theme toggle is kept unchanged** — same `onClick`, `data-tip`, `hv-accent-both` class, style string and both SVGs — right-aligned in the same 1080 px container at the same vertical position, in a plain `<div>` rather than a `<footer>`. No new element, no new control. | Asked for by the user in these words: *"remove footer. Not valid for desktop app."* A desktop app has no site-level legal surface, and the three hrefs were the prototype's placeholders (`#privacy`, `#terms`, `#support`) with nowhere to point; the landing page's own body copy already says files stay on this machine. The toggle stays because it is the only theme control a person can reach before a model is open — the toolbar's own is mounted from the first frame but sits under the landing page's full-viewport opaque overlay until a model is loaded (the user's choice: *"Keep just the button"*). |
| **2026-09-25** — Help › Check for updates…, under About SGVue on both platforms, opens a page in the user's browser through `shell.openExternal`: the releases list until **2026-09-28**, and since then the product site told this version, `https://sgvue.github.io/?v=<version>` (`SITE_URL`, one hard-coded https constant, + the build-time version, URL-encoded), which says whether it is the latest. A native menu item, like About; no designed surface changes; the item downloads nothing and makes no network call (since **2026-10-01** the app itself makes one, at launch — the update check, §3 "Network" and §10 — and the landing page's notice opens this same page). | Asked for by the owner in these words: *"add the check for updates menu item."* The repository is private and the builds are unsigned, so there is no auto-updater (`publish: null`); the user checks and installs by hand. 2026-09-28: *"From the next version, should Help › Check for updates open the new page instead of the GitHub releases list?"* → *"Yes, open the page"*. |

**No visible additions.** Provenance (which entity a value came from, the georeferencing
source, the SHA-256 of the file) is reachable only through the assistant's tools and through
exports — never as new UI, except where the owner asked for it in so many words: each such case
is a dated entry of the allowed-deviations list in `CLAUDE.md`, of which the dated rows above
are five. Inputs
the design already has, such as the Coordinate-system card, are pre-filled from the file when
the data exists and left blank when it does not. Never a placeholder. (Since 2026-10-08 the
Coordinate-system card is read-only, the owner's: its fields are the file's and nothing else.)

> **Status: Phase 0.** The contract is in force. The design bundle is vendored at
> `design-reference/`, and the design's `<style>` block is copied verbatim to
> `src/renderer/styles/design.css` — since 2026-10-01 less three keyframes, `ifctrace`,
> `ifcbreathe` and `ifcdot`, which went with the design's busy row (`docs/DECISIONS.md`);
> `tests/unit/design-css.test.ts` holds the file to the block, line for line, less exactly
> those. Markup porting begins in Phase 3.

---

## 3. Platforms and requirements

| | Requirement |
|---|---|
| macOS | 13 (Ventura) or later. Universal coverage via two builds: Apple silicon (arm64) and Intel (x64). Delivered as a `.dmg`. |
| Windows | 10 or 11, 64-bit. Delivered as an NSIS installer (`.exe`). |
| Graphics | **WebGL2.** WebGPU is opt-in by name only, since 2026-09-17 — see §7 and §10. A fallback GPU adapter forces WebGL2 in any case. |
| Typical file size | 50–200 MB IFC files are the design target. **A single file larger than 600 MB is not opened** — refused when it is admitted, and again by the upload row, with the design's own copy `larger than 600 MB` (`MAX_FILE_BYTES`, `shared/upload.ts`; §4), and so is an `.ifczip` whose `.ifc` is that large. |
| Memory | Hard ceiling 3.5 GB. A warning appears around 600 MB of model data; loading is refused above 1.5 GB. The **GPU helper process** is watched separately, at `max(3 072 MB, 40 % of installed RAM)` of `phys_footprint` — 3 277 MB on an 8 GB machine, 9 830 MB on a 24 GB one (§10). *(Read against the code on 2026-10-02, for 1.2.0's published system requirements: the warning at 600 MB of model data and the refusal above 1.5 GB are **not built** — nothing in `src/` measures either. What is enforced is the per-file limit in the row above, web-ifc's 3.5 GB `MEMORY_LIMIT`, and the GPU guard.)* |
| RAM guidance | 8 GB is workable for files up to ~100 MB. 16 GB is recommended for 200 MB files or a federation of several models. |
| Network | Not required. Two things use it. **The launch-time update check** (2026-10-01, the owner's choice "Check at every start"; packaged builds only): one `GET` from the main process to GitHub's "latest release" of the public releases repository, once per start, to learn the newest version number — no query, no body, no cookie, nothing about the user or the models (it is a web request, so GitHub sees what any server sees, the IP address and Chromium's standard headers — whose user agent, in a packaged build, names the app and its version); a newer version puts a notice with a link on the landing page, and offline, blocked or unanswered within 5 s it is silent. Nothing is downloaded and there is no auto-updater. **The AI assistant**, only when an API key is configured. |

Neither installer is signed with a developer certificate. The Windows installer is unsigned;
the macOS build is **ad-hoc signed** since 2026-10-05 — `mac.identity` is `'-'`, with
`hardenedRuntime: false` — because Apple-silicon code must carry at least an ad-hoc signature
and an unsigned download is reported as "damaged". It is explicit either way, or
electron-builder signs with whatever certificate happens to be in the developer's keychain.
macOS and Windows both warn on first launch: on macOS 15 and later the user opens SGVue once,
then **System Settings → Privacy & Security → Open Anyway** (on macOS 13 and 14, Control-click →
**Open**; macOS 15 removed that shortcut); on Windows, **More info → Run anyway**. A Developer
ID with notarisation, and Windows code signing, are owed before launch (§11).

**Measured, on this machine** (Apple silicon, macOS 15, Electron 44, WebGL2). `phys_footprint`
is the only number that sees GPU memory — `workingSetSize` and `ps rss` do not (§10) — and the
GPU helper starts around 850 MB before anything is loaded, which is Chromium's own baseline:

| Model | Elements / parts | Load to first frame | fps orbiting | Renderer | GPU helper (peak) | JS heap |
|---|---|---|---|---|---|---|
| The design's mock federation | 412 / 516 | immediate | 120 (display-capped) | 156 MB | 1 037 MB | 22 MB |
| `tests/fixtures/tiny.ifc` | 6 | < 1 s | — | 865 MB peak, whole app | 127 MB | — |
| A real project model, 137.9 MB | 26 761 / 67 364 | **10.4 s** (13.1 s from launch, packaged) | **38–39** | 1 622–1 631 MB | **2 121–2 353 MB** | 712 MB |

The 137.9 MB model is therefore comfortable on a 16 GB machine and tight on 8 GB. A hover
costs 2.2 ms on it, a section along a gridline 10.5 ms from click to painted frame, and
colouring all 26 761 elements by a property 96.5 ms. The shipped GPU guard trips at
`max(3 072 MB, 40 % of installed RAM)` (§10) — 9 830 MB on this 24 GB machine, which leaves
7.5 GB of headroom over the worst reading above. A flat 3 072 MB left only ~700 MB, and the
design target goes to 200 MB files: a legitimate model would have tripped it.

> **Status: Phase 10.** Both DMGs and the Windows installer have been produced from this
> tree: `dist/SGVue-1.0.0-arm64.dmg` (128 MB), `dist/SGVue-1.0.0-x64.dmg` (130 MB) and
> `dist/SGVue-1.0.0-setup.exe` (110 MB). The arm64 `.app` has been run under the guard —
> `npm run test:packaged` — including on the 137.9 MB model. The Windows installer **cannot be
> tested here**: no Windows machine (§11). **2026-09-21:** the build and the packaged app were
> exercised on a Windows 11 machine, where `dist:win` writes a 115 MB installer of its own
> (`PROGRESS.md` under that date, §11); the installer itself was still not executed.
> **2026-10-02, version 1.2.0:** built on Windows 11. `dist:win` wrote
> `dist/SGVue-1.2.0-setup.exe` — 115 432 324 bytes (110 MB as Windows counts it), unsigned, the
> assisted NSIS wizard of 2026-09-28 — and its payload, extracted without running it, is 75 of 75
> files SHA-256-identical to `dist/win-unpacked` (409 159 247 bytes: 390 MB installed), on which
> `npm run test:packaged` passes. The installer is run by the owner, never by a build here. No
> macOS build was made for 1.2.0 and none is published. *(2026-10-05: the two disk images —
> ad-hoc signed, built by the release workflow from `sgvue/sgvue` (`docs/RELEASING.md`) — are
> published with 1.2.0 on `sgvue/releases`, and `docs/releases/1.2.0.md` gives their
> requirements.)* The system requirements published with it — the product site, the release
> notes (`docs/releases/1.2.0.md`) and the releases page — are the table above, said for a user.

---

## 4. Architecture

SGVue runs as four cooperating parts. The split exists so that no single part can both hold
the model and write to disk.

```
┌──────────────────────── Electron main (Node) ──────────────────────────┐
│ window · native menu (Preferences…) · Open dialog · recents            │
│ API key in the OS keychain (safeStorage)                               │
│ sgvue-file:// protocol: single-use tokens → streamed, never buffered   │
│ sgvue:// scheme handler (share links)                                  │
│ AI gateway: every tool call is FORWARDED to the renderer to execute    │
│ the only three writers: settings.ts · sessions.ts · exports.ts         │
│ holds NO model data                                                    │
└───────────────┬────────────────────────────────────────▲───────────────┘
      preload (contextBridge, typed + validated IPC)      │ tool result
┌───────────────▼────── renderer (sandboxed, no Node) ────┴───────────────┐
│ React UI ported from the design · view state (ids and view only)       │
│ viewer-core (three.js) · model store (frozen chunks)                   │
│ AI tool executors (read | view only) · design-parity mock adapter      │
└───────┬──────────────────────────────────────────┬─────────────────────┘
        │ Blob + postMessage                        │ query(sql)
┌───────▼────── parse worker ──────────┐  ┌─────────▼────── sql worker ────┐
│ web-ifc read-only adapter · SHA-256  │  │ sql.js database from the index │
│ index chunks · geometry + edges      │  │ query_only · SELECT-only gate  │
│ raw STEP lines on demand             │  │ 10 s timeout → restart worker  │
└──────────────────────────────────────┘  └────────────────────────────────┘
```

**Data flow when a file is opened.** The main process hands the renderer a single-use token,
not bytes. The renderer opens the file as a Blob through the `sgvue-file://` protocol and
passes it to the parse worker. The worker reads the Blob in chunks — hashing as it goes — and
streams back the index and the geometry in pieces, so progress is real rather than animated.
The renderer freezes each chunk as it arrives. The main process never sees model data, which
is why a 600 MB file never crosses an IPC boundary.

Step by step, from the click to the first frame:

| # | Where | What happens |
|---|---|---|
| 1 | renderer | The designed drop zone or the `upload` control calls `openDialog()`. |
| 2 | main | `dialog.showOpenDialog` (multi-select, `.ifc` / `.ifczip`). Every chosen path is **admitted**: `realpath`, extension, regular file, size ≤ 600 MB. Only what passes comes back. |
| 3 | renderer | Each file is validated again with the design's own copy (`not an IFC file` / `file is empty` / `larger than 600 MB`, plus `ifcXML is not supported`), a row appears per file, and the rest start 500 ms apart. |
| 4 | renderer → main | `fileUrl(path)` mints a **single-use** `sgvue-file://t/<uuid>` for that admitted path. |
| 5 | renderer | `fetch` on that URL. Main re-checks the path at fetch time, spends the token, and streams the bytes with `net.fetch` — it never buffers them. The response becomes a `Blob`. |
| 6 | parse worker | The Blob is read in slices inside `OpenModelFromCallback` while the same bytes are hashed forward. A `.ifczip` is unzipped first and the hash stays the **archive's**, because that is the file on disk. |
| 7 | parse worker → renderer | The index in chunks, then (a second request) the geometry and its crease edges. |
| 8 | renderer | The index is deep-frozen into the model store, the models are federated as **one batch** so the camera is framed once, the SQL property index is built, and the viewer is given the geometry. |

A native drag-drop skips steps 4 and 5: the `File` already carries the bytes, and the preload's
`webUtils.getPathForFile` carries the path so the file is still resumable from a session. It
does **not** skip step 2 — that raw path is admitted first, through `admitPaths`, and it is the
path main gives back that is stored. The recents list, a stored session and a `sgvue://s=…`
share link all re-enter at step 2 the same way.

**Every path the renderer stores or compares has passed through `admit()`.** Admission answers
with the path's own `realpath`, which need not be the spelling that was asked for — a directory
junction, an 8.3 short name, a mapped drive — so a path kept in any other spelling can never be
matched against one main returns. A session or a link is therefore probed one file at a time,
and the admitted spelling is what is opened, what the SHA-256 is compared against, and what is
written back. A file main refuses is still refused **by name**, unchanged.

**The five stage rows are driven by the worker, not by a timer.** Each of the design's five
stages is unlocked by a real milestone — the bytes arriving, web-ifc opening the model, the
geometry stream starting, the index freezing, the models joining — and then shown under two
rules (`src/shared/upload.ts`): a stage is never displayed **ahead of** real progress, and never
for **less than** the design's own 420 ms minimum. On a 137.9 MB file the minimum never binds
and the row reports the parse; on a 5 KB file it does, and the animation reads as designed.

**Every failure returns to the landing page** with the reason in the designed warning banner:
a boot with no models, a model with no geometry, a file that will not parse, a renderer that
will not start, and the in-app GPU guard tripping. The user is never left on a broken viewer.

**The boundary between UI and renderer is imperative.** The UI never touches the scene graph.
It calls a fixed set of methods (`setVisibility`, `setSelected`, `setSections`, `zoomTo`, …)
and receives a fixed set of callbacks (`on.select`, `on.hover`, `on.measure`, …). This is the
design's own boundary and it is kept.

### 4.1 The UI layer

The design is one component with one `state` object and one `renderVals()`. The port keeps that
shape and splits it three ways, along lines that are invisible in the result:

```
src/renderer/state/shell.ts          the design's state keys and its methods, in one Zustand
                                     store — `up()` / `applyVis()` / `select()` / `activate()` …
src/renderer/state/selectors/        what `renderVals()` derives, as pure functions:
                                     tree · storeys · models · spatial · status · visibility ·
                                     lanes · props (the property card) · ctx (the right-click menu)
src/renderer/state/keys.ts           `onKey`, split into a pure decision and a dispatcher
src/renderer/app/                    the markup, one file per designed surface, with the
                                     declaration strings kept byte-identical (`app/css.ts`)
src/renderer/model/federation-store  frozen indexes + parse worker + SQL + the live Viewer handle;
                                     the only place the federation changes shape
```

Three rules hold the port to the design:

1. **Markup keeps its text.** `app/css.ts`'s `s('display:flex;gap:9px')` turns a declaration
   string into a React style object at render time, so every inline style in `app/` is the
   design's own string and can be diffed against `SGVue.dc.html` directly. The design's
   `style-hover` / `style-focus` attributes become one class per distinct declaration set in
   `styles/hover.css`, each quoting the line it came from.
2. **Derived values are pure.** Nothing in `selectors/` touches the DOM, the store or the
   viewer, so every rule in `renderVals()` — the tree's two-line meta, the storey elevations,
   the model rows, the toolbar's active states — is unit-tested against the design's wording.
3. **Visibility has one path.** Every mutation of the design's `VIS_KEYS`
   (`hidden · storeyVis · modelVis · stack · active`) goes through `up()`, which calls
   `pushUndo()` and then `applyVis()`. §4.3 is what that path now carries.
4. **The camera is framed once, at boot.** The design builds the whole federation and *then*
   creates the viewer; every later `setModels` reads the camera, rebuilds and puts it back.
   Streaming the models in loses that unless it is stated: `viewer.addModel` never frames, and
   `FederationController.addBatch` calls `frameExtents()` only for the batch that takes the
   federation from empty.
5. **The selection is the shell's, and the viewer answers to it.** A click, a Ctrl/⌘-click, a
   double-click, a tree row and every context-menu item all end in one `select(id, zoom, mode)`;
   the viewer never holds a selection of its own except to draw one. It reports back in exactly
   one case, which is the design's (`viewer-core.js:529`): hiding a selected element trims it
   from the selection and says so, which is why the property card closes behind `Hide`.

### 4.2 The property card and the context menu

The card is `selectors/props.ts` (`renderVals()`'s `sel` object) plus `app/PropertyCard.tsx`
(`SGVue.dc.html:313–410`). Order is the design's and it is load-bearing: four identity tiles →
containment chips → **property sets** under a 2 px rule, open by default → Identifiers → Related
→ Geometry, collapsed and remembered in `propOpen`. Sets are ordered SGPset → Pset → Qto and
then alphabetically, with the prefix stripped and camelCase split; an inherited (type-level) set
is shown like any other, because a badge for it would be a visible addition.

Two values in the card cannot be the prototype's, for the same reason the Spatial-structure card
could not be (§2, "never a placeholder"):

- **Centroid** is a map coordinate. It is composed from the file's own `IfcMapConversion` /
  `IfcSite` base point, and shows the design's em dash when the file is not georeferenced —
  never the prototype's typed-in `{ E: 28500, N: 30200, Z: 102.5, angle: 12.5 }`.
- **Base / top and Centroid are in the file's own coordinates.** The renderer works in scene
  coordinates, with the federation offset already subtracted (§7), so the card adds it back.
  Sizes, footprint and volume are differences and are unaffected either way.

`selectors/ctx.ts` is `ctxItems` (`:1898–1921`): the twelve items, their shortcuts, their three
separators, the `(n)` suffix, the "more than two names becomes a count" rule, the
"acts on the whole selection when the right-clicked element is part of it" rule, and the
`innerWidth − 220` / `innerHeight − 260` clamp. Each item carries an `action` rather than a
closure, so the list is a pure function of state and is unit-tested item by item.

> **Status: Phase 4 — selection and the property card are the designed ones.** Eleven states ×
> two themes captured against the prototype (`tests/parity/phase4/README.md`): the context menu
> is within 0.02 of 255 everywhere it is drawn, the card within 0.04 except the Geometry section,
> whose Centroid row is the documented difference above. The filter and section cards (5),
> annotation (6), the landing page and upload pipeline (8) and the assistant (9) are the surfaces
> still to come; the toolbar buttons that open them already carry their state, and
> "Ask about this" already writes the designed composer pre-fill into `chatInput` for Phase 9.
> The main process is still the Phase 0 scaffold: `sgvue-file://`'s handler, the native Open
> dialog and the AI gateway are Phases 8 and 9.

### 4.3 Visibility, the filter stack and undo

What you can see is **one derived predicate** over five state keys, and nothing else writes
visibility. `src/shared/rules.ts` is that predicate; `src/shared/filter-stack.ts` is the stack
arithmetic; `src/shared/undo.ts` is the history.

```
hidden        ids hidden by hand (the eyes, Hide, Isolate)
storeyVis     a storey switched off, or soloed
modelVis      a model switched off
stack         the ordered filter steps
active        activate mode: one model owns the lists and the picker
```

**An element is visible when** it is not in `hidden`, its model is on, its storey is on, and
every **enabled** `isolate` step matches it while no enabled `hide` step does. That is a
conjunction, so isolate/hide steps give the same visible set in any order — `isolate L2 → hide
windows` and `hide windows → isolate L2` are the same view, and a property test asserts it on
the mock federation.

**A rule is `{prop, op, val, join}`.** `prop` is one of the seven named attributes or any
property-set key; `op` is `=`, `!=`, `~` (contains), `>`, `<` or **`absent`**; `join` applies
between this rule and the previous one, and `or` binds looser than `and`. `absent` — "the
property has no value at all: missing, null, or an empty or whitespace string" — is the one
operator the design does not have; the Filter card's 64 px operator control shows it as
`empty` and the phrase `is empty` is used wherever there is room for it — the step row's
summary and badge, the option's tooltip, and every label the assistant reads back. It exists
because a missing attribute matches only `!=`, which **also** matches every element whose
value is merely different, so a completeness question could not be asked.
It ignores `val`; while it is chosen the card's value field keeps its exact shape and is
`disabled`.

**Colour is where order matters.** `applyColors` composes one `id → hex` map: the colour-by
scheme underneath, then each enabled `highlight` step's own colour over every element it matches
**and** that is visible, walked in stack order — so where two highlight steps overlap the
**later** step wins. Step colours are auto-picked from the six-colour `HL` palette, next unused
first, and the action badge that shows one is inked in a fixed `#0F1516`, never a theme token:
`HL` is the same hex in both themes.

**Colour by property** is the third colour system and the layer under the other two. Given a
property name it buckets the federation by that property's value — through the **same `attr`
resolver** the filter rules use, so any property-set key is groupable and not just the seven
named attributes — skips elements that do not carry it, orders the buckets largest first and
gives bucket *i* `SCHEME[i % 11]`, an eleven-colour fixed palette that opens with the six
highlight colours. The **legend** bottom-left names the property and lists every group with its
swatch, value and count; a row selects that group's elements and the × clears the scheme.
Nothing carrying the property is answered with "no scheme" and leaves any live one alone. It is
cleared whenever the federation changes, because its groups hold ids from the federation that
has just been replaced, and it is **not** one of the undoable keys — it changes nothing about
what you can see. The design gives it no manual control at all: the assistant's
`color_by_property` tool is its only writer, so the store exposes `setColorBy` / `clearColorBy`
and Phase 9 wires the tool to them.

**Undo covers exactly those five keys**, as JSON snapshots, **outside reactive state** — two
arrays of strings on the module, with only `canUndo` / `canRedo` in the store, so pushing a
snapshot re-renders nothing. Cap 50 on both sides; a push clears the redo branch; ⌘Z / ⇧⌘Z and
the action bar's `undo` / `redo` (the status bar's until 2026-10-01, when they moved to a bar
of their own above it) are the same call. The camera, the section planes, the selection and
the theme are deliberately **not** undoable, so ⌘Z never moves the view. A snapshot older than
the current federation can name a model that has since been unloaded; `active` is clamped to a
loaded model on restore, because reinstating a dead one would make every remaining model inert.

**The temporary-state frame** reads the same five keys: amber (`--warn-line`) with
`N elements hidden` for hides made by hand, accent with `N filter steps — N hidden` once a step
drives it. `reset` is the design's `showAll()` — it empties `hidden`, `storeyVis` and `modelVis`
and switches every step **off** without deleting it.

**Activate mode** is the fifth key: the sidebar's lists scope to one model, the others stay
rendered but are drawn inert (8 % grey, edges off) and drop out of hit-testing through
`setPickable`, the selection is pruned to the active model, and the activation is dropped when
its model unloads.

**Saved filter sets and viewpoints** are the two things Phase 5 remembers between runs. A set is
the live steps plus a label built from the first of them, capped at twelve, re-applied with
fresh ids and colours. A viewpoint keeps the camera (projection included), both section planes
(since 2026-10-01 — and the old single `section` beside them, for an older build) and all
five visibility keys — **the filter stack among them**, which the prototype lost (plan §3.5
defect 1) — under a key per building. Both are `localStorage` under the design's own key names
**for now**; §9 is where they move in Phase 8.

> **Status: Phase 7 — all three colour systems are the designed ones.** Twelve states × two
> themes for Phase 5 (`tests/parity/phase5/README.md`) and eight more for Phase 7
> (`tests/parity/phase7/README.md`): the legend within **0.04 of 255** and 0.01 % of its pixels
> over 12 in both themes, its rectangle, every line of its text and every row's swatch colour
> identical on both sides in all sixteen captures. One deliberate difference, carried from
> Phase 5: the toolbar's Filter button also lights for a live step, which the prototype's
> dropped `filterOn` key never did. The landing page (8) and the assistant (9) — which is what
> *sets* a colour scheme — are still to come.

---

## 5. IFC conformance, units, georeferencing, provenance, memory

"Follows the industry standard" means the parser is driven by buildingSMART schema semantics
(ISO 16739) and its output is checked against **IfcOpenShell**, the reference implementation
buildingSMART's own validation service uses. The table below is the contract.

| Area | Standard rule the index follows |
|---|---|
| Files | ISO 10303-21 STEP; header `FILE_DESCRIPTION` (incl. the MVD `ViewDefinition[...]` string), `FILE_NAME`, `FILE_SCHEMA`; SHA-256 recorded |
| Schemas | IFC2X3 TC1, IFC4 ADD2 TC1, IFC4X3 ADD2 — schema-specific attribute names respected (e.g. `IfcClassificationReference.ItemReference` in 2X3 vs `Identification` in 4) |
| Identity | `IfcRoot.GlobalId` verbatim (22-char base64 alphabet `0-9A-Za-z_$`, validated, never regenerated); `expressId` kept; `Name`, `Description`, `Tag`, `ObjectType` |
| Entity typing | Exact `IfcEntity`; `PredefinedType` incl. `USERDEFINED` → `ObjectType` / type's `ElementType`; type object via `IfcRelDefinesByType` (`IfcTypeObject.Name` as the type family) |
| Spatial structure | `IfcProject › IfcSite › IfcBuilding › IfcBuildingStorey › IfcSpace` by `IfcRelAggregates`; elements by `IfcRelContainedInSpatialStructure`; storey `Elevation`; `IfcSpatialStructureElement.CompositionType` (`COMPLEX`/`ELEMENT`/`PARTIAL`) as authored, absent when the file leaves the optional attribute unset; `IfcZone` and other `IfcGroup`/`IfcSystem` memberships via `IfcRelAssignsToGroup` |
| Decomposition | `IfcRelAggregates` (assemblies), `IfcRelNests`, `IfcRelVoidsElement` (openings), `IfcRelFillsElement` (doors/windows in openings) |
| Property sets | `IfcRelDefinesByProperties` → `IfcPropertySet`; value types per `IfcValue`: `IfcPropertySingleValue`, `EnumeratedValue`, `ListValue`, `BoundedValue`, `TableValue`, `ReferenceValue`, `IfcComplexProperty` (nested); values kept **as authored** with their measure type and unit; type-level psets (`IfcTypeObject.HasPropertySets`) inherited and **overridden by occurrence psets**, flagged `inherited`; `Pset_*` (buildingSMART) vs `SGPset_*` (IFC-SG) vs other prefixes distinguished |
| Quantities | `IfcElementQuantity` → `IfcQuantityLength/Area/Volume/Count/Weight/Time`, `IfcPhysicalComplexQuantity`; `MethodOfMeasurement` kept; `Qto_*` naming |
| Units | `IfcProject.UnitsInContext` → `IfcUnitAssignment`: `IfcSIUnit` with prefixes, `IfcConversionBasedUnit` (feet, inches…), `IfcDerivedUnit`; per measure kind (length, area, volume, angle, mass, time); display conversion only |
| Materials | `IfcRelAssociatesMaterial` → `IfcMaterial`, `IfcMaterialLayerSet(Usage)`, `IfcMaterialProfileSet(Usage)`, `IfcMaterialConstituentSet`, `IfcMaterialList`; layer names/thicknesses kept |
| Classification | `IfcRelAssociatesClassification` → `IfcClassificationReference` (system, identification, name) incl. Uniclass/OmniClass/IFC-SG codes |
| Georeferencing | IFC4/4X3: `IfcMapConversion` + `IfcProjectedCRS` (the conversion on the 3D `Model` context or a sub-context of it; Eastings, Northings, OrthogonalHeight in the CRS's `MapUnit` — the metre when it names none — XAxisAbscissa/Ordinate → rotation, `Scale` recorded as written and never applied, CRS name e.g. EPSG:3414); the **spatial-root** `IfcSite` (the one `IfcProject` aggregates) — RefLatitude/RefLongitude (DMS lists), RefElevation, and its `ObjectPlacement` read as a **full transform**: translation, rotation about `+Z`, and whether that rotation is a pure one; the `Model` context's `TrueNorth`; **CORENET X convention**: SVY21 coordinates *and the rotation to true north* on `IfcSite.ObjectPlacement`; IFC2X3: `ePset_MapConversion` / `ePSet_MapConversion` psets. Every readout names its source, and `method` names which declaration is in force |
| Geometry | Tessellated by web-ifc in metres (it applies the length prefix and Z-up conversion — never applied twice); placements composed in Float64; `IfcSpace` included via `StreamAllMeshesWithTypes`; surface styles (`IfcStyledItem`, transparency) from the file |
| Grids | `IfcGrid` / `IfcGridAxis` with axis curves; axis-aligned lines drawn, others recorded. The index keeps the file's own axis order; the **federation's** list is ordered once where it is unioned (`shared/federate.ts`) — by the grid's own `u`/`v`/`w` family, then naturally on the name — so the Section card's chips, the assistant's schema and `get_model_info` agree. A Revit export lists axes in creation order, which on the reference model starts at `L` and `22`. |
| Nothing invented | No default origin, no synthetic GUIDs, no fabricated counts; missing data is reported as missing |

**Units.** Geometry from web-ifc is in metres. Property and quantity values are stored exactly
as the file authored them, together with their measure type and unit, and converted only for
display, following the design's millimetre/metre rules.

**Georeferencing.** Every readout names where it came from — `IfcMapConversion`, an
`ePset_MapConversion` property set, or `IfcSite` placement — so a reader can tell a declared
CRS from an inferred one. Singapore's CORENET X convention (SVY21 / EPSG:3414 on the
`IfcSite` placement) is recognised explicitly.

`source` / `sources` say what was **found**. `method` says what is **in force**, because a file
can declare an `IfcMapConversion` that converts nothing while its site placement carries the
real position — which is exactly what the reference model does. A map conversion is identity
when Eastings, Northings and OrthogonalHeight are zero or absent and the X axis is `(1, 0)` or
absent; a site placement is identity when it neither translates nor rotates. The four methods
are `IfcSite placement`, `IfcMapConversion`, `IfcMapConversion + IfcSite placement` and
`ePset_MapConversion` — six since 2026-10-08, with `WorldCoordinateSystem` and
`WorldCoordinateSystem + IfcSite placement` (rule 4, below) — and a file with none reports
`none`. They are the strings the
Coordinate-system card's caption appends and `get_model_info` reports — one spelling, in
`shared/model-index.types.ts`.

**The project frame.** A file's world coordinates need not be the frame the building was drawn
in. On the CORENET X convention the spatial-root `IfcSite.ObjectPlacement` carries both the
position and the rotation to true north, so the file's world axes are map axes and the building
stands at an angle to them — 43.41° on the reference model. The app therefore renders the
**project** frame: `geometry-streamer.ts` composes the inverse of that placement on the left of
every placement, beside the Y-up → Z-up rotation it already composes, and grid segments and
storey placements go through the same transform before anything draws them.

**The federation is assembled in map space** (since 2026-10-08). One exporter writes a model's
map position on its site placement, another in an `IfcMapConversion` over a site at the file's
zero; both are compliant, and by world coordinates they land kilometres apart. So each model
gets its own world → map operation from its own declaration — `T(E·u, N·u, H·u) · Rz(θ)`, θ the
conversion's X axis, u the map unit, `Scale` never applied, `TrueNorth` never stacked on it,
identity when there is none — and the federation's frame is the boot model's project frame
expressed in map coordinates, **P = M_boot ∘ Site_boot**, chosen once like the offset. Each model
streams through its own frame **M_i⁻¹ ∘ P**, so it lands where its own declaration puts it on the
map, read in the boot building's project frame. For a model placed the way the boot model is —
every model of a Revit "Shared Coordinates" federation — that frame is the boot model's site
frame itself, so nothing about such a federation changed. `shared/georef.ts` owns it all
(`ProjectFrame`, `projectFrame`, `mapPlacement`, `federationFrame`, `modelFrame`, `toProject`,
`toWorld`, `frameKey`) and is pure and unit-tested; `tests/unit/georef-federation.fixture.test.ts`
federates one synthetic building written eleven ways, every pair within a millimetre.

**Rule 4 — the `WorldCoordinateSystem`** (coordinates part 2, the same day). A Revit export from
the Survey Point, Project Base Point or Internal Origin with no EPSG code, and every Revit IFC2X3
export, writes no map conversion: the chosen point's Easting, Northing and Elevation are the
`Location` of the 3D `Model` context's `WorldCoordinateSystem`, in project length units, and for
the Project Base Point and the Internal Origin the turn to true north is only in `TrueNorth`.
web-ifc 0.0.77 applies that `WorldCoordinateSystem` to no placement (measured, and pinned by a
test), so with no conversion and a `WorldCoordinateSystem` that is not the identity, M is the
`WorldCoordinateSystem` — its origin through the length unit, its own turn if it has one — then,
only when nothing else states a turn (no site turn, no turn of its own), the turn `TrueNorth`
implies: atan2(x, y) of its direction, which puts the project's true north on the map's north.
`placedBy` and the caption's method are `WorldCoordinateSystem` (`+ IfcSite placement` when the
site placement moves the project too). Beside a map conversion — which current Revit never
writes, and IFC leaves ambiguous — the `WorldCoordinateSystem` is undone before the conversion,
M = C ∘ WCS⁻¹, as IfcOpenShell reads it, and `get_model_info` marks the pair `ambiguous`.
`TrueNorth` still never stacks on a conversion. Three more fixtures — (i) Project Base Point with
no EPSG code, (j) its IFC2X3 twin, (k) a `WorldCoordinateSystem` beside a conversion — federate
with the other eight within a millimetre in all 110 ordered pairs, and IfcOpenShell agrees
product by product: `auto_xyz2enh` for (k), and its own `get_wcs` and `get_true_north`, composed
as Revit writes them, for (i) and (j) — `auto_xyz2enh` returns a file with no conversion unmoved.

**A model that cannot be lined up** is said so in one line under the Coordinate-system card's
caption (the owner's choice, 2026-10-08): one whose file states no map position while another
loaded model's does, or whose geometry landed more than 5 km from the offset another model set
(`farPlacement`). When the boot model is the one with no map position, it is named and no
distance is. `get_model_info` and `get_view_state` report the same (`notLinedUp`).

**Federation and precision.** Every model is opened without recentring. The first streamed
mesh defines a whole-metre federation offset, and placements are composed in 64-bit floating
point before the offset is subtracted. This matters: Revit shared coordinates routinely put a
model tens of kilometres from the file origin, where 32-bit vertices resolve to about 4 mm —
enough to crack thin geometry. A model landing more than 5 km from the others raises a visible
warning; beyond 10 km the file is flagged for precision loss.

**Provenance.** Every file's SHA-256 is recorded on load and stamped on every export.

**Memory.** Hard limit 3.5 GB; warning at 600 MB of model data; refusal above 1.5 GB. *(Read
against the code on 2026-10-02, as §3 notes: the warning at 600 MB of model data and the refusal
above 1.5 GB are **not built** — nothing in `src/` measures either — and what is enforced
instead is a per-file limit of 600 MB (`MAX_FILE_BYTES`, `src/shared/upload.ts`).)* Every
web-ifc geometry object is explicitly released, and every vertex and index array is copied out
of the WASM heap rather than referenced.

**Verification.** For each sample file, an `expected.json` is generated **independently by
IfcOpenShell** — entity counts by type, storeys and elevations, unit assignment, property and
quantity sets of three elements as authored, GlobalId↔expressId, classification and material
of one element, georeferencing presence and values, one bounding box in millimetres ± 1 mm —
and the index must match. Divergence between web-ifc and IfcOpenShell is a defect to fix or
document, never to hide.

> **Status: Phase 1a — the matrix is implemented and checked.** `src/worker/index-builder.ts`
> builds a `ModelIndex` per the table above: header (with the MVD string), schema, units,
> spatial tree by aggregation, containment, elements (every `IfcElement` subtype except
> `IfcOpeningElement`, plus `IfcSpace` flagged `isSpace`), GlobalId verbatim and validated,
> `PredefinedType` with `USERDEFINED` resolved, type objects, property and quantity sets in
> one forward pass (type first, occurrence overriding, each set flagged `inherited` and
> carrying its source line), materials, classifications, systems, decomposition, grids with
> their placement chain applied, georeferencing that always names its source, `propKeys` and
> the SHA-256. Values stay as authored; numbers carry their IFC measure type so
> `src/shared/units.ts` can convert only for display.
>
> **Verified against IfcOpenShell 0.8.4.** `scripts/expected-from-ifcopenshell.py` writes
> `tests/fixtures/<stem>.expected.json` and `tests/unit/index-builder.fixture.test.ts`
> compares the index against it — schema, header, units, counts by entity type, storeys and
> elevations, georeferencing, and three deterministically chosen elements with their psets and
> qtos as authored. On the 144 MB reference model the two agree on every field. Both the model
> and the generated `expected.json` are git-ignored: the model is a real project file and the
> ground truth carries its metadata. The test skips with a visible notice when either is
> absent, so a machine without them still passes.
>
> **Status: Phase 1b — geometry, recentring and memory.** `src/worker/geometry-streamer.ts`
> implements the Geometry row of the table. `flatTransformation` is used exactly as web-ifc
> gives it (the length unit and the Z-up → Y-up conversion are already in it and are never
> re-applied); vertices stay in each geometry's own local space and the part matrix carries
> the placement; `IfcSpace` is streamed separately with `StreamAllMeshesWithTypes` and
> flagged; and surface-style transparency is resolved by walking `IfcStyledItem`, because
> web-ifc does not fold it into the placed colour's alpha.
>
> **Recentring.** `COORDINATE_TO_ORIGIN` stays `false`, so `GetCoordinationMatrix` is
> reported (identity) rather than relied on. The first streamed mesh's translation, rounded
> to whole metres, becomes the federation offset; every later model is given the same one;
> `T(−offset) × flatTransformation` is composed in Float64 and only then written as Float32.
> On the reference model the offset is `[12520, 4, −23186] m` and the file's own coordinates
> sit 32.88 km out, which raises the `precision` warning — the exact case the rule exists for.
> A bbox centre more than 5 km from the offset raises `farPlacement`.
>
> **Memory.** `MEMORY_LIMIT` is 3.5 GB. Every `IfcGeometry` is deleted and every placement
> vector freed inside `ifc-source.ts` before the streamer sees a mesh; every vertex and index
> array is `.slice()`d off the wasm heap. Streaming the 137.9 MB reference model in Electron
> leaves the renderer heap at 111 MB. The warn-at-600 MB and refuse-above-1.5 GB thresholds
> are UI behaviour and arrive with the upload pipeline in Phase 8.
>
> **Status: Phase 6 — what the georeferencing is actually used for.** Three readouts, and one
> rule shared by all of them (`src/shared/georef.ts`):
>
> · **The project base point** — the Coordinate-system card's Easting, Northing, Elevation and
>   True north. **Superseded on 2026-09-20** by the §5 "project frame" rule above:
>   `coordsFromGeoref` composes `IfcMapConversion` **over** the site placement and returns the
>   map coordinates of the project frame's origin together with the total rotation from project
>   north to true north. Taking a present-but-zero map conversion first, as it used to, handed
>   the card `0 / 0 / 0 / 0` for a file whose position and 43.41° rotation were sitting on its
>   site. It still returns nothing at all for a file that states none, which leaves the four
>   fields blank; the design's own literal base point
>   (`{ E: 28500, N: 30200, Z: 102.5, angle: 12.5 }`) is never a fallback.
> · **Map coordinates** — `toMap(base, x, y, z)` is the design's own expression
>   (`viewer-core.js` L409) and is the single implementation behind both the spot-coordinate
>   labels and the property card's Centroid row, so the two cannot drift. Its input is the point
>   in the **project** frame: the renderer works in scene coordinates with the whole-metre
>   federation offset removed, and every absolute readout adds it back. Because the base point
>   is the project origin's map coordinates, `toMap` over a project point is exactly the file's
>   own world coordinate for it — checked against IfcOpenShell on a named vertex of the
>   reference model: **0.092 mm**.
> · **The CRS chip** — the design writes `SVY21` in the status bar and `SVY21 · EPSG:3414` in
>   the Coordinate-system card, true of its own Singapore subject and a placeholder otherwise.
>   `crsChip` keeps both of those verbatim when the file's `IfcProjectedCRS` is SVY21 /
>   EPSG:3414 (the reference model's is: `('EPSG:3414','SVY21 / Singapore TM','SVY21',…)`),
>   names the file's own CRS when it is something else, and shows the design's em dash when
>   there is none. (Until 2026-10-08 it kept the design's status chip for a base point typed
>   into the card; the card is read-only since then, and the chip is the boot file's.)
>
> Nothing about provenance or georeferencing became new UI: these are the inputs and readouts
> the design already has.

---

## 6. Read-only guarantees and their tests

Six mechanisms, each enforced and each tested.

| # | Guarantee | How it is enforced |
|---|---|---|
| 1 | **No IFC write path.** | `src/worker/ifc-source.ts` is the only module that may import web-ifc. Immediately after initialising, it overwrites the write methods on the web-ifc API object with functions that throw. The forbidden names live in `src/shared/readonly-list.ts`: `WriteLine`, `WriteLines`, `DeleteLine`, `SaveModel`, `SaveModelToCallback`, `CreateModel`, `CreateIfcEntity`, `setPropertySets`, `setMaterialsProperties`, `ExportFileAsIFC`. |
| 2 | **Guard test.** | `tests/readonly-guard.test.ts` walks every `.ts`/`.tsx` file under `src/` and fails the build on: (a) any forbidden name outside `readonly-list.ts`; (b) any filesystem write outside the three enumerated writers; (c) `nodeIntegration: true`, `sandbox: false`, `webSecurity: false`, or `@electron/remote`; (d) any change to the preload's exposed API key names; (e) — from Phase 9 — any AI tool that does not declare `kind: 'read' \| 'view'`. |
| 3 | **Immutable model.** | Index types are `readonly` behind a deep-readonly boundary, and the renderer deep-freezes every chunk as it arrives (a structured clone strips freezing, so it is re-applied on receipt). The view store holds ids and view state only — never model data. |
| 4 | **The assistant has no filesystem and no data-write tools.** | Every tool is declared read-or-view. Tool inputs are re-validated against their schema immediately before execution. The main process runs the conversation loop but never sees the index. |
| 5 | **Enumerated writes.** | Exactly three modules may write to disk (§9) — the third, `exports.ts`, only to a path the user picked in a native Save dialog — and guard (b) fails the build if a fourth appears. |
| 6 | **Provenance.** | SHA-256 per file, recorded on load, stamped on every export. |

> **Status: Phase 1a.** Guarantee 1 is now enforced at runtime as well as by the guard:
> `createReadOnlyIfcSource()` replaces every name in `FORBIDDEN_IFC_WRITE_API` on the web-ifc
> instance — and on `api.properties` for the two `set*` names — with a non-writable,
> non-configurable stub that throws `ReadOnlyViolation`, and
> `tests/unit/readonly-source.test.ts` calls each one to prove it. Guarantee 3 has landed:
> `src/renderer/model/store.ts` deep-freezes every chunk on arrival — element, its property
> sets, and the values inside them — skipping typed arrays and already-frozen subtrees, and
> `tests/unit/model-store.test.ts` covers it. The guard test still passes unchanged, with
> `src/worker/ifc-source.ts` the only module importing web-ifc. Guarantee (2e) is added in
> Phase 9 with the tools themselves.

---

## 7. Renderer and geometry contract

**The frame is IFC Z-up, metres, and it is the model's own PROJECT frame.** `+z` is up,
storey elevations are `z`, and the design's renderer, its mock federation and IFC itself all
agree. web-ifc is the one producer that does not — its `flatTransformation` folds a Z-up → Y-up
swap into every placement — so `geometry-streamer.ts` composes the single inverse rotation
`(x, y, z)_Yup → (x, −z, y)_Zup` on the left of the placement, once, and nothing downstream
rotates anything again.

Composed on the left beside it is the inverse of the federation's **project frame** — the boot
model's spatial-root `IfcSite.ObjectPlacement`, read as project → world (§5). A Revit
shared-coordinates export states its position *and* its rotation to true north there, so its
world axes are map axes and the building stands at an angle to them; without this every
axis-aligned thing the app draws is wrong by that angle, and the reference model's sample wall
reads `87.489 × 82.787 m` instead of the `120.150 × 0.300 m` its own `Qto_WallBaseQuantities`
states. The federation's frame P is a constant, exactly like the offset: the boot model fixes
it — since 2026-10-08 its project frame expressed in map coordinates (§5) — and every model is
streamed through its own frame against it, M_i⁻¹ ∘ P, so models federate by their **map**
coordinates. `null` is the identity — every file that leaves its site at the origin and states
no map conversion, and the design's own mock federation, whose code path is then byte for byte
the one before the frame existed.

`geometry-streamer.ts` remains **the only place the frames meet**. Grid segments and storey
placements come out of the index in world metres and go through the same transform in
`renderer/model/federation-store.ts`'s `metaOf` before the viewer sees them; the offset is then
chosen and subtracted in the project frame, so it is the number every readout adds back. On the
reference model it falls from `[12520, 23186, 4]` to `[313, −76, −1]`, and the `precision`
warning goes with it: the vertices sit 400 m from the project origin rather than 33 km, where
float32 resolves about 0.05 mm instead of 4 mm.

Everything that reports an absolute position states its frame. Element boxes in the index and
the SQL `bbox` table are **project** metres, Z-up; the property card's Base / top is a project
elevation (matching the storey ladder) and its Centroid is a **map** coordinate through
`toMap`; spot labels print both; and `get_element`, `measure_between` and `clash_check` name
`frame: 'project'` in their JSON. Picking, the pick grid, snapping and the section planes are
scene-space and are unaffected. A session, a share link and a saved viewpoint carry
`frameKey(frame)` beside their camera, and a payload from another frame restores everything
except the camera, framing the extents instead.

**One box per element, and it is where the two halves of the model meet.** The parse and the
geometry are two worker requests (the index is usable while the geometry is still streaming),
so neither one can fill `IfcElement.bbox` on its own: the parse has no geometry and the
streamer has no index. `renderer/model/element-boxes.ts` unions the chunks' part boxes by
element id and adds the federation offset back — one pure function, one pass over the parts
already in hand, no second transfer and no new field on the geometry contract — and
`FederationController.prepare` writes the result onto the index **before** it is frozen into
the model store. `IfcElement.solidCount` comes out of the same walk: it is that element's
number of **parts**, counted across both draw families exactly as `viewer/batches.ts` counts
them, so the number `get_element` reports and the number the property card's Geometry row
shows are one number. Measured over every boxed element of the reference model: 26 524
checked, **0 mismatches**, min 1 · median 1 · max 921. The dev mock federation composes the same box from its own boxes, in the same
frame (the identity) and the same units, and a unit test holds the two to the last bit. On the
137.9 MB reference model that is **26 524 boxes for 26 761 elements**; the other 237 carry no
geometry and get no box, never a placeholder, which is what every consumer already tests for.

The box is an **axis-aligned approximation, and a conservative one**: a part's box is the AABB
of its *transformed local* AABB, so a part rotated about anything but `+Z` reports a box at
least as large as the exact one. Measured against IfcOpenShell's own tessellation on the
reference model, in the project frame: the sample wall and door agree to **0 mm on every
face**, and the sample slab — a plate whose outline is not square to the building — is
conservative by **33 mm** on each of its two `y` faces and 1 mm on top. Every consumer says it
is box arithmetic, and the SQL schema the assistant reads says so in the table's own comment.

**What the worker sends the renderer**, per chunk (about one million vertices, or five
thousand parts): vertex positions, normals and indices; a deduplicated geometry table per
model, so a window that repeats two hundred times is stored once and instanced; a parts table
giving each part its element id, its geometry, its 64-bit-composed placement matrix, its
colour and its bounding box; and **crease edges** — line segments generated per geometry at a
20° threshold, which is what reproduces the design's drawn-edge look; plus a header carrying
the chunk number and total, so the progress bar reflects real work.

**A federation offset**, whole metres, is subtracted from every placement so the scene sits
near the origin: Revit shared coordinates routinely place a model tens of kilometres out,
where a float32 vertex resolves about 4 mm. It is chosen in the Z-up frame from the first
streamed mesh of the first model and then fixed. Storey elevations and grid coordinates read
from the index are in the file's own coordinates, so anything drawn alongside geometry
subtracts it first.

**How the renderer draws it.** Per model, geometry is split into two families: `solid`, which
casts shadows, and `glass` for anything the file marks transparent, which never casts and does
not write depth. Each family's parts are **baked into federation space with their own
placement matrix and merged** into one `BufferGeometry` per slot — one `Mesh`, one draw. The
137.9 MB reference model is 35 slots and 87 draws a frame.

Merging is not an optimisation of batching; it is the correction of it. A `BatchedMesh` costs
one *driver-level* draw per visible instance on every backend available here — WebGPU has no
multi-draw in three 0.186, and macOS ANGLE/Metal emulates `WEBGL_multi_draw` by replaying per
draw — and at 67 364 instances that grows the Electron GPU helper process by gigabytes per
second (§10). Merging loses deduplication: 5 754 413 stored vertices become 14 621 800.

Edges are one world-space line buffer per chunk with per-element index ranges, so hiding an
element is an index rewrite and a draw range rather than a rebuilt mesh, and a selection is a
second small index over the same positions.

**A frame is drawn only when something changed.** The design renders every frame because its
own federation is 590 parts; a real one is 14.6 million vertices and 2.7 million edge segments,
and drawing that again unchanged costs about 8 ms of GPU time for a picture nobody asked for.
The frame *loop* is untouched — it runs at the display's rate, the clock ticks, the status
bar's frame rate counts frame callbacks, `on.camera` fires — and only the drawing is skipped:
`renderer.render`, the grid-view update, the occlusion sweep, the labels and the view cube. The
rule is one sentence: **anything that changes what is drawn calls `invalidate()`**, and two
frames are drawn after the last invalidation rather than one, so an upload landing between the
frame and the compositor cannot leave a stale image. The camera reports its own state — an
ease, a flight, a drag, the wheel, a projection swap — by comparing what it placed this frame
with what it placed last, and snaps onto its goal once it is within a microradian, because
`1 − exp(−dt·rate)` never arrives on its own. `scripts/frame-triggers.cjs` drives thirty-six
classes of change (at 1.2.0, 2026-10-02 — its own last line prints the count, and
`docs/COMMANDS.md` says what each addition was) with the camera at rest and compares what the
*compositor* holds before and after, which is the only way to catch a setter that changed the
scene without asking for a frame.

**A pick ray tests only the candidates along it.** Every ray — hover, click, the laser meter's
six, and the label occlusion sweep's one per grid bubble — filters by element bounding box
before it walks a triangle, and that filter was a scan of all 26 539 elements: 1.1 ms a ray,
83.8 ms for a sweep of 78 bubbles, on one frame in four, with the camera standing still.
`pick-grid.ts` bins the same boxes into a uniform grid walked with a 3D DDA. It is a *filter*,
not an answer: each candidate still goes through the same box interval, the same sort and the
same triangle walk, and a box is inserted into every cell it touches, so the surviving
candidate set is identical to the flat scan's rather than an approximation of it. Measured on
the reference model: **0.099 ms against 1.098 ms a ray, and 2 000 random rays plus the 78 real
bubble rays at three camera poses answer identically — same element, same distance to the
last bit** (`scripts/pick-parity.cjs`, `tests/unit/pick-grid.test.ts`).

**Colour, opacity and state are per part,** not per material. Every vertex carries its part's
index in a `partIndex` attribute, and one small `Float32` RGBA texture holds that part's state;
the material fetches it with `textureLoad`. One material per family therefore replaces the
reference's bank of them. The alpha channel carries more than opacity: 0 is hidden, above 1 is
opaque and glowing by the excess (selection 1.35, highlight 1.15, keeping the design's emissive
lift), below 0.5 is see-through, and `+4` on top tags the hovered part.

**The see-through mesh** is a second `Mesh` over the *same* `BufferGeometry` with the
see-through material. `depthWrite` belongs to a material and a merged mesh has one material for
thousands of parts, so this is what keeps the reference's structure exactly: three's `maskNode`
makes each material discard what the other draws, so a part is rasterised by precisely one of
them; the solid mesh is opaque, writes depth and casts, and the see-through one blends over it
afterwards writing none and casting none. Ghost, inert and both fade materials are one material
there, because only their opacity differed. `maskNode` reaches the shadow pass too, which is
what stops a hidden part casting. Nothing in the renderer uses a private field of three's.

**Visibility is one derived predicate**, never a flag stored per element. An element is visible
if it passes all of: not manually hidden, its storey is on, its model is on, and every enabled
filter step accepts it.

**The filter is an ordered stack**, not a single rule set. Steps combine as a conjunction;
disabling step 1 re-expands step 2 rather than clearing it. Highlight precedence runs by step
order, so overlapping highlights resolve to the later colour.

**Colours compose in one pass**, in this precedence: the file's own colours, then a per-model
override, then colour-by-property, then highlight steps, then hover and selection. An override
keeps the source opacity, so glass and railings still read correctly. The precedence itself is
a **pure function** (`elementColour` in `viewer/materials.ts`) with a unit test per layer pair,
so it is checked against the reference's own branch order rather than inferred from a
screenshot; the renderer only feeds it the element's state and writes what it returns.

**Crossfades** animate per-part alpha across the whole changed set for 220 ms, out .3 → 0
and in .02 → .3, and are instant under reduced motion or when the changed set is larger than
the fade budget.

**Scene extents derive from the federation's bounding box.** A literal 40 m clip constant once
sliced the roof off a 56 m warehouse. The design's scene constants — a ±48 m shadow frustum, a
600 m ground, a 240 m grid, the zoom and clip limits, the sun's stand-off — were authored for
its own mock federation, whose bounding sphere is 27.5 m; each is kept as *that value × radius
/ 27.5*, so the mock renders with the reference's exact numbers and a 425 m model gets
proportional ones.

**Undo** snapshots a named set of visibility keys outside reactive state, capped at 50 steps.

**Picking** never brute-forces the scene. Candidates are filtered by each element's world
bounding box, sorted by entry distance, and only then are triangles walked — one part's
contiguous index range at a time, in world space, stopping as soon as a confirmed hit is nearer
than the next box could be. A section plane is applied by clamping the ray *before* the walk,
never by filtering hits afterwards, which is what lets the box filter prune with it; with two
planes cutting (2026-10-01) the ray is kept where both keep it (`clipSpan`). There is
no acceleration structure: the merged form makes one hover 3.3 ms on a 26 539-element model,
where three's own `Mesh.raycast` cost 222 ms.

**The pointer model, the snap marker, the DOM label overlay and the view cube** are ported
method for method from the design's own `viewer-core.js`: one finger orbits and two pinch, a
press that moves less than 3 px is a click, Ctrl (⌘) toggles rather than replaces, a
double-click frames and selects what is under it, a corner within 16 px beats an edge within
11 px beats the face point, labels clamp 6 px inside the viewport and test occlusion on one
frame in four *while the camera is moving* — at rest the sweep runs once, when its answer can
have changed — and the 148 px cube is a 3 × 3 × 3 lattice minus its centre — 26 zones, six of
them labelled.

> **Status: Phase 2b — the contract is final and the renderer is complete: scene, merged
> slots, edges, materials, camera, picking, the pointer model, snapping, the label overlay and
> the view cube.** `src/shared/geometry-contract.types.ts` is the whole contract. Per
> chunk: `positions` and `normals` de-interleaved from web-ifc's six-float layout, `indices`,
> `edges` (crease line segments, two vertices per segment, in the same local space), `geoms`
> (deduplicated by `geometryExpressID`, each recording its slice of all four buffers), and
> `parts` (`elementId`, `geomIdx`, `matrix16`, `rgba`, `bbox6`, `isSpace`). A chunk is capped
> at one million vertices or five thousand parts, and its four buffers are transferred, not
> copied. `elementId` is the model-local `expressId`; the federation id is
> `slot * 1 000 000 + elementId`.
>
> **Crease edges** are computed once per unique geometry, in local space, by replicating
> three.js's `EdgesGeometry(geo, 20)` exactly, checked segment for segment against three.js
> itself. **The Z-up swap** is checked on numbers (`tests/unit/zup.test.ts`) and against a
> real file: on the 137.9 MB reference model the offset is `[12520, 23186, 4] m` and the
> recentred box −317.9…107.1 × −122.5…289.8 × **−4.9…56.0**, i.e. a 425 × 412 m footprint
> with the 61 m height on `z`, and the twelve storey elevations the index reads from
> `IfcBuildingStorey` land inside it.
>
> **The renderer** is `src/renderer/viewer/`: `viewer-core.ts` (API, state, frame loop),
> `scene.ts` (renderer, lights, ground, grid, extents), `batches.ts` (merged slots),
> `part-state.ts` (the per-part RGBA table), `edges.ts`, `materials.ts` (palette, TSL clipping
> and cut-face shading), `camera.ts`, and 2b's `picking.ts`, `input.ts`, `snap.ts`,
> `overlay.ts` and `cube.ts`. On the 137.9 MB model it builds **35 merged slots** for 26 539
> elements and 67 364 parts (14 621 800 expanded vertices), draws **87 calls a frame**, holds
> **41–51 fps** while orbiting on WebGL2, answers a hover in **3.3 ms**, and reaches the first
> frame 16.5 s after the file is handed over (5.3 s parse, 6.9 s geometry, 0.9 s upload, 3.3 s
> SQL index). The GPU helper process is flat at 1.74–1.79 GB across 48 s of orbiting.
>
> **Design parity** is captured state by state against the prototype in the same window at the
> same size, and for 2b through the same real mouse events:
> `tests/parity/phase2a/README.md` and `tests/parity/phase2b/README.md` carry the tables and
> what is left. Everything left is the r170 → 0.186 hemisphere-light change.
>
> **Status: Phase 6 — the annotation layer.** `src/renderer/viewer/annotations.ts` draws
> everything that is not the model and `section.ts` owns the cut plane, with
> `src/shared/annotate.ts` holding the arithmetic so the rules are unit-tested on numbers
> rather than on a screenshot. Three-dimensional geometry is three.js; every readable label is
> a DOM element in the design's own overlay, which is what gives it the shell's type, borders
> and shadows.
>
> **Gridlines** extend past the footprint by `pad = max(2.5 m, 6 % of the footprint)` and carry
> a 26 px bubble 1.1 m beyond each end. In an elevation view (`|phi − π/2| < 0.25`) only the
> family whose lines run along the view direction is drawn — the other family's members all
> project to one screen position and would overprint — its bubbles lift to `bbox.max.z + pad`
> on a vertical stem, and only the near-side one is kept. Bubbles are DOM and have no depth
> test, so each anchor is raycast against the visible set — on one frame in four while the
> camera moves, and once when it comes to rest — and the occluded ones are hidden. Clicking one sections that grid, previewed, and opens the Section card.
>
> **A grid is a segment, not a constant coordinate.** The design's model carries
> `{ name, axis: 'x' | 'y', v }` because its mock federation is axis-aligned; a real
> `IfcGridAxis` is a curve, and the 137.9 MB reference model's grid has **39 axes in two
> families at 46.59° and 136.59°, not one of them axis-aligned**. So the drawn line is the
> grid's own infinite line clipped to the padded footprint (which for an axis-aligned grid is
> the design's literal endpoints), the family is a direction group within 10° rather than an
> axis letter, the near-side bubble is the end further along the camera's plan direction, and a
> **section along a grid** is a vertical plane through the segment with its normal perpendicular
> to it in plan and the offset measured along that normal. The one thing that cannot be derived
> is handedness — the design's offset moves the plane along **+x** for an `axis: 'x'` grid and
> **+y** for an `axis: 'y'` one, two perpendiculars of opposite handedness — so `planNormal`
> states the convention: of a segment's two plan normals, the one pointing into the positive
> half-plane, which is exactly those two for the axis-aligned cases.
>
> **Levels** are a ring on the same padded rectangle per storey plus a tag at its `(min x,
> max y)` corner, nudged 30 px left, **clamped** 6 px inside the viewport and **stacked** with a
> minimum vertical gap — because the camera frames the model, not the annotation.
>
> **The laser meter** fires ±X ±Y ±Z from a snapped surface point to the nearest visible faces,
> skipping any ray that points into the surface it sits on (`d · n < −0.5`) and stepping past a
> self-hit within 5 cm; an axis with no reading on either side is dropped. Since 2026-10-08 each
> axis reads its two sides of the point, along the axis — one label at the middle of each half
> that reached a face, where the design had one for the whole ray; the live reading and the
> Markups card read `X 1 200 + 2 300` — and the whole ray is their sum. **Spot coordinates**
> pin a point and print its map coordinates and its coordinates in the file's own frame.
> **Selection dimensions** (`D`) draw the selection's bounding box and three dimension runs
> with ticks and millimetre labels, placed by a screen-space search: each anchor position along
> the run crossed with each push direction, then the whole set again in whole label heights up
> and down, rejected against the measured rectangles of the property card and the view cube and
> against every label already placed in the same pass.
>
> **Status: 2026-10-01 — two section planes.** The design has one section; since 2026-10-01
> (owner-requested; `CLAUDE.md`, allowed desktop deviations) there are two, and they are
> independent: **the gridline cut and the level cut**. The store holds
> `sections: { grid, level }`, each `{ name, offset, flip, cut }` with an empty name for "none"
> (`shared/sections.ts`), and the viewer takes both in one call, `setSections({ grid, level })`.
> What is kept is what **both** cutting planes keep — a second clip uniform pair, the same
> test — and a plane whose `cut` is off clips nothing and shows its own preview sheet. Each
> plane has its own accent outline; the 2026-09-28 cut outline is drawn for both, each plane's
> segments trimmed to the other's kept side (`viewer/section-cut.ts`), still one instanced mesh
> recomputed at most once a frame. The pick and laser rays are clamped by every cutting plane
> and the snap refuses a candidate any of them cut away; the label-occlusion ray is unclipped,
> as it always was. The camera re-aims at a plane when that plane starts cutting, or its
> gridline, level or side changes while it cuts — never for an offset, a clear or the other
> plane — and once, at the gridline plane, when a restore brings both. **The Section card** is
> two blocks, "Along a gridline" and "At a level", each with its own offset row, its summary on
> a line of its own (the one place the design's two rows were re-arranged: beside its buttons
> the summary was clipped to `offset mm …`) and its own `cut` · `flip side` · `Clear` under it,
> right-aligned; the header has `Clear all`; the gridline chips are one row per grid family
> with a 1 px rule between. A grid bubble's click previews or clears the gridline plane only. With one plane set every frame of the phase-6 chain is the build before's —
> `tests/parity/2026-10-01-two-sections/README.md` has the measurements.
>
> **Status: 2026-09-19 — the frame budget.** Four invisible fixes, measured on the 137.9 MB
> model at 1512 × 982, device pixel ratio 2, WebGL2, before and after in one session. A fifth
> was measured and refused.
>
> | | before | after |
> |---|---|---|
> | orbiting with defaults | 26.44 ms mean · p95 83.4 · **37.8 fps** | 8.44 ms mean · p95 10.3 · **118.5 fps** |
> | pointer moving over the model | 27.17 ms · js 4.30 | 8.80 ms · js 1.10 |
> | camera still, nothing changing | 26.17 ms · still drawing | 8.37 ms · **nothing drawn at all** |
> | the label occlusion sweep | 83.8 ms, one frame in four | 0.1 ms, only when its answer can change |
> | one pick ray | 1.098 ms | 0.099 ms |
> | draw calls · triangles submitted | 105 · 5 573 656 | 105 · 5 573 656, unchanged |
> | hide a model, click to painted | 73.7 ms | 55.5 / 54.9 ms |
> | the 220 ms crossfade | max 33.5 ms · js max 35.8 | max 10.3 ms · js max 0.2 |
>
> The four: the occlusion sweep runs when the camera, the occluders or the label set have
> changed rather than unconditionally; the pick ray walks a uniform grid; the frame loop draws
> on demand; and hover is not evaluated during a camera gesture, extending the design's own
> `down.on` rule (L566) to the pinch and the wheel.
>
> **Two candidates were measured and refused, both because the pixel is the specification.**
> *The edges*: with the sweep gated, 2 691 699 blended segments cost 0.11 ms of an 8.44 ms
> frame, and turning their blending off — which could never ship, since the design's edge is
> 0.45 alpha over the lit surface — made the frame *slower* (8.83 ms), so the cost is
> rasterisation and there is nothing safe to win. *`forceSinglePass` on the glass material*:
> a `DoubleSide` transparent material is submitted twice, so the flag would remove 14 draw
> calls and 365 019 triangles a frame (105 · 5 573 656 → 91 · 5 208 637) — worth 0.14 ms of an
> 8.4 ms frame — but the back-then-front order those passes produce is part of the drawn
> result: measured in a band of pure façade it changes **about 300 pixels of the glazing by at
> most 4 of 255**, identically on every run. Small, systematic, and the wrong way round for
> 0.14 ms, so the glass renders exactly as it has since Phase 2a.
>
> **What the four cost in pixels: nothing that is drawn.** The mock parity set (fifteen states
> × two themes) was captured before and after. In the 3D scene itself — measured at a 4 s
> settle in a band of façade, and over the whole stage — **not one pixel differs**. What does
> differ, by a few tens of levels on glyph edges, is the *antialiasing of the grid bubbles'
> text*: they are DOM elements positioned by a transform rounded to 0.1 px, and the camera now
> snaps onto its goal instead of approaching it for ever, which can round one bubble's
> transform the other way. The same glyphs also differ between two runs of the *same* build.
> Nothing in the canvas moves.
>
> **Design parity** is `tests/parity/phase6/README.md`: fourteen states × two themes, with
> **every drawn annotation label compared by text and position — 484 of them, 0 differences**.
> The three new cards measure 0.00–0.01 of 255, the chrome 0.02, and the 3D stage is at most
> 0.211 % of pixels different by more than 40, which is antialiasing; everything larger is the
> r170 / 0.186 hemisphere light. The four remaining visible differences are all data rather
> than drawing and are enumerated there.

---

## 8. AI assistant

The assistant changes what is *shown* and reports what is *there*.

**Where it runs.** The conversation loop runs in the Electron main process, so the API key
never reaches the renderer. Tools are executed by the renderer, which is the only part that
holds the model; results travel back to main as JSON.

**What is sent.** A cached system prompt (the design's own assistant instructions plus a
description of the SQL schema), a cached vocabulary summary of the federation rebuilt only
when the federation changes, the conversation so far, and a small JSON snapshot of the current
view each turn. Model data is not sent; the assistant reaches it only by calling tools.

**Caching.** Stable content is marked cacheable so a follow-up question re-reads the cache
instead of re-sending the prompt. A second identical turn should report a non-zero cache read.

**Tools.** The design's fifteen view-and-report tools, kept with their names and schemas, plus
read-only additions: `get_element`, `get_entity_raw`, `list_values`, `find_properties`, `search`,
`get_spatial_tree`, `get_relationships`, `get_model_info` (header, MVD, schema, units,
georeferencing with the CORENET X check — and, since 2026-10-08, which declaration placed each
model in the federation's map space, in which map unit, and that `Scale` was not applied —
counts, SHA-256), `get_view_state`, `measure_between`,
`find_nearby` and `query_sql`; and, since 2026-09-28, four for the Schedules window:
`make_schedule` builds a schedule (or changes the open one) and shows it there,
`get_schedule` reads the one that is open — rows, subtotals and totals computed by the ported
engine in the main renderer — `export_schedule` runs one entry of that window's Export menu,
which opens the native Save dialog there (the user picks the place; only their Save writes, and
the tool is never told whether they did), and `color_by_schedule_column` does what a column
heading's "Colour 3D by this column" does. Every tool declares `kind: 'read'` or
`kind: 'view'`, and the guard test fails the build if one does not.

**Parity with the user (2026-10-02, phase 1 of 4).** The owner's direction of 2026-10-01 —
*"assistant should possess everything user can do on the app"* — applied to the reversible view
state the tools could not reach. Each goes through the store action the control itself calls:
`toggle_display` gains the canvas grid, snap and original materials; `select_elements` a `mode`
(replace, add, remove, clear); `apply_visibility` `undo` and `redo`; `color_models` a `null`
that resets one model; and two new view tools — **`set_models`**, the eye beside each model, and
**`set_interface`**, the app's own settings (theme, units, tree mode, sidebar, card, armed tool,
tree search, opening the Schedules window). `set_interface` changes how the app looks and never
what is in the model, and the model is told to use it only when the user asks. Not in this
phase: the camera, viewpoints, markups, files, the clipboard and anything inside the Schedules
window.

**Phase 2 of 4, the same day — the camera, saved viewpoints, markups, one filter step.**
`set_view` reaches what the user's own camera does: any direction, as **azimuth** (the compass
bearing the camera looks towards, clockwise from project north — the model's own +Y, not true
north) and **elevation** (how far it looks down from level); a **fit** of the building or the
selection that does not turn; and a **zoom** on that fit. **`manage_views`** is the Viewpoints
card — list, save, restore, rename — and **`manage_markups`** the Markups card, read: its two
lists, and zooming to one. `manage_filters` gains **`update`**, which changes one step's action,
rules or highlight colour where it stands. Nothing in the phase deletes, clears or places
anything — a removed viewpoint or markup cannot be brought back, so those wait for the consent
rule of phase 3 — and nothing reaches outside the view or into the Schedules window.

**Phase 3 of 4, the same day — the consent gate.** Some of what the user can do reaches outside
the view or cannot be undone: opening model files, opening a recent file, unloading a model,
copying the share link or GlobalIds, changing the base point (until 2026-10-08, when the card
became read-only and nobody could change it), deleting a viewpoint, a markup or a saved filter
set. The owner's rule for these — of the recommendation *the assistant proposes,
and you click Apply in the chat or pick in the Windows dialog*: *"correct."* — is that **the
assistant never performs them. It asks**, through a surface the app already has — the chat's own
pending row, the sidebar's own "Unload …?" strip, the native Open dialog — and the user's click
is what does it. The reason is prompt injection: text authored inside an IFC file reaches the
model through tool results, and must never be able to open, unload, delete, copy or
re-georeference anything by itself. `manage_views`, `manage_markups` and `manage_filters` carry
the deletions as requests, and one new view tool, **`request_user_action`**, asks for the rest
(§8.5); §8.7 is the gate and §10 what it protects. **What stays the user's alone, by decision —
not built:** the API key and every Preferences setting; quit, reload and DevTools; the consent
clicks themselves (Apply, Save, Open, Replace, the sidebar's `delete`); and anything that writes
model data.

**Phase 4 of 4, the same day — the Schedules window, and placing markups.** The last of what
the user can do that the tools could not reach. *In the Schedules window:* `make_schedule` sets
what that window's Filter, Sorting and Format tabs and its calculated-value editor set — the
filter logic, itemise, a column hidden, aligned, given decimals and a unit and put in its place,
and calculated columns in the engine's own formula grammar, refused with the engine's reason
when one does not parse; the rows of the open schedule are a set the view tools act on
(**`schedule: true`**), resolved in the main renderer and acted on through the store's own
guarded actions; and one new view tool, **`manage_schedules`**, works that window's own controls
— open it, undo and redo, the template gallery, My templates — each run in that window by the
control's own handler. Deleting a saved setup, printing and opening a schedule file are only
**asked for** — that window's own confirmation before a deletion and before its print dialog is
opened, its native Open dialog — and so is a save or a duplicate that would forget a saved setup;
a question raised there for the assistant takes no default button. *In the main window:*
**`manage_markups` places** a
spot coordinate or a laser measurement — the click with the spot tool or the laser meter,
committed by the viewer's own function for that click, at a point that is named because a tool
has no pointer: the middle of an element's bounding-box top, of the box or of its underside, or
a project-frame point; that reply's `revert` takes it away again. And a call for a turn that is
no longer live is no longer run when it
would change the view (§8.7). **Deliberately left out** (`docs/DECISIONS.md` has each reason): a
schedule's column widths, auto-fit and equal width, its appearance panel, colour rules and print
layout; dragging the sidebar's and the panels' sizes; folding a property-card section; the chat
panel's own controls; and a markup on a picked surface.

**Reading back what it set (2026-10-02).** *Sparse per turn, full on demand.* The view state
sent with every turn gains a field only while something is **not at its default** — a display
switch, the armed tool, a hidden model, a section's offset, side or preview, and since phase 2
the camera's direction while it is not standing on a named view — so a view at its defaults
costs exactly the bytes it did before; `get_view_state` reports all of it in full (§8.2 and
§8.6).

**Acting on what it found.** `query_sql`, `search` and `find_nearby` can find a set no rule
describes. `select_elements`, `apply_visibility` and `color_by_property` therefore accept
**`ids`** (a capped list of element ids), **`selection: true`** or — since phase 4 —
**`schedule: true`** (the elements the open schedule lists) as well as `rules`, and act
on them through the same store actions the right-click menu's Hide, Isolate and Select call —
so undo, the temporary-state banner and the scope guard behave identically. Rules stay the
preferred way to name a set, because only a rule step can be saved as a filter set, travel in
a share link and be re-evaluated when another model is added. Element ids are per session, and
one the federation does not carry is reported by count rather than dropped.

**Rules.** `{prop, op, val, join}` with `op` one of `=`, `!=`, `~`, `>`, `<` and **`absent`**.
`absent` means the property has no value at all — missing, null, or an empty or whitespace
string — and it ignores `val`. It is the one operator the design does not have and the one
visible change the assistant work made: the Filter card's operator control gains a single
entry — `empty` in the 64 px control, `is empty` wherever the phrase fits. It exists because
`!=` also matches every element whose value is merely *different*, so "the walls with no fire
rating" could not be said.

**Guards.** Twelve tool rounds and 120 seconds per turn — the model is told both — and the wall
clock **aborts a request that is still in flight**, not only the gap between rounds; tool execution
is sequential with a 20-second budget (60 seconds for SQL and clash checks); the user can
abort at any point and the main process rolls the transcript back cleanly. SQL runs in its own
worker in query-only mode behind a SELECT-only gate, capped at 201 rows, and a query that
overruns 10 seconds is killed by restarting the worker — it cannot hang or damage the model.

**Privacy.** The key is stored in the operating system keychain. Preferences shows the exact
payload of the most recent request. With no key configured, nothing is sent.

**The panel.** The design's own chat panel: a pill on the stage opens it, the transcript
carries bubbles with chips, result tables and changes the scope guard held back, the assistant's
reply is drawn while its turn runs — a thinking trace, where the design had a busy row — and
each reply can be reverted on its own: since 2026-10-02 everything that reply changed, not only
what is visible. §8.9 has the detail.

**Its name and its mascot (2026-10-01).** The assistant is **Vee** — the panel's title and the
pill read `Ask Vee`, a reply is labelled `Vee`, and the model is told the name is its own —
while the app is still SGVue. Its mascot is a 16 × 16 pixel sprite (`app/vee-grid.ts`,
`app/Vee.tsx`), drawn at a whole number of device pixels to a cell — one size for every sprite —
beside the title, in front of each reply's label and on the pill, blinking at rest on one 8 fps
clock that sleeps between changes and does not run under reduced motion. The specification for
both, and for the thinking trace below, is the owner's "Ask Vee" handoff in
`design-reference/ask-vee/`, whose px ÷ 1.5 are app px (`CLAUDE.md`, allowed deviations).

**Its thinking trace (2026-10-01).** While a turn runs, the transcript's next row is the reply
being written, drawn from the turn's own events: `Thinking` beside the name; once a tool has
started, a bubble with a one-line ticker over a matrix of the federation's elements — *Reading*
them, *Filtering* to the scope a tool's rules name, *Checking* what its other rules ask, each
with its real count; then the answer, word by word, its status (`checked 80 walls · 8s`) and one
row per storey that holds a match, each of which selects what it counts. The answer is never
delayed by any of it, every number is the federation's own, and nothing animates once the reply
has settled. The send button stops a running turn. Under `prefers-reduced-motion` every state
shows at its end with nothing in between. §8.9 has the pieces; `ai/trace.ts` is the arithmetic
— a pure function of the turn's timeline and a time, which asks `ai/trace-plan.ts` where each
cell stands — and `docs/DECISIONS.md` has the rules.

> **Status: Phase 9 complete.** The gateway, the prompt, the tool catalogue, the executors,
> the settings and the panel are all in. What is owed is Phase 10's: the accessibility pass
> over the new surface and a run of the acceptance prompts against the real API.

### 8.1 Where each piece runs

| Piece | Where | Why there |
|---|---|---|
| `@anthropic-ai/sdk`, the API key, the API transcript | `src/main/ai/gateway.ts`, `src/main/settings.ts` | The key must not reach a sandboxed renderer, and one process has to own a byte-stable transcript. |
| Prompt assembly | `src/main/ai/prompt.ts` | Pure and deterministic, so the cached prefix can be asserted byte for byte. |
| Per-window session and the tool bridge | `src/main/ai/session.ts` | One conversation per window; every tool call is forwarded to that window. |
| The tool catalogue | `src/shared/tool-schemas.ts` | Both sides need the same names; the guard test reads it. |
| Executors | `src/renderer/ai/executors/` | **Main never holds model data.** The frozen index, the SQL worker and the view store are all here. |
| Analysis (audit, summarise, clash) | `src/renderer/ai/analysis.ts` | Arithmetic, run locally — never asked of a language model. |

### 8.2 The request, and where the cache breakpoints sit

The API renders a request as **tools → system → messages**, and prompt caching is a prefix
match: one byte different anywhere in the prefix and everything after it is charged in full.

| Position | Content | Cached | Changes when |
|---|---|---|---|
| `tools` | All 37 tools, **sorted by name** | — | the catalogue changes |
| `system[0]` | The design's eighteen instruction lines + one paragraph on the extra read tools + the SQL schema DDL | breakpoint 1 | this file changes |
| `system[1]` | `Model schema: {…}` — the design's `chatSchema()` | breakpoint 2 | the federation changes |
| `messages[…]` | The conversation so far, with its own breakpoints stripped | — | every turn |
| `messages[n]` | The current user turn (`[replying to …]` prefix when it is a reply) | breakpoint 3 | every turn |
| `messages[n+1]` | `{ role: 'system', content: 'Current view state: {…}' }` | — | every turn |

Three breakpoints, never more: the API allows four, and a fourth would arrive on the second
turn if the previous turn's breakpoint were not stripped as it becomes history.

**The view state, field by field.** Always there — the design's ten and the Schedules line:
`filterStack`, `visibleElements`, `totalElements`, `hiddenManually`, `storeysShown`,
`activeModel`, `view`, `projection`, `section` (one string for both planes), `selectedCount`,
and `schedule` (the Schedules window's open schedule, or `null`). **There only while not at its
default (2026-10-02):** `display` — just the switches that differ from `grids` on, `levels` off,
`shadows` on, `dims` off, `groundGrid` on, `snap` on, `originalMaterials` on; `tool` — when it is
not `select`; `modelsHidden` — the keys of loaded models whose eye is off, at most twenty, with
`modelsHiddenMore` counting the rest; `sectionPlanes` — for a set plane, whichever of `offsetMm`,
`flip` and `cut` is not the Section card's default (0 mm for a gridline, 1 200 mm for a level,
not flipped, cutting); and, since phase 2, `camera` — `{view, azimuthDeg, elevationDeg}`, only
while the camera is **not** standing on the view the `view` field names, which is where a view
button leaves it (a direction asked for, a drag, a click on the view cube, a section's re-aim
and a restored viewpoint all take it off). Keys, booleans and numbers only: a model's *name* is
file text, and a viewpoint's is the user's, and both are reported by `get_view_state`, on
demand, never here. One instruction line tells the model that whatever the view state does not
list is at its default.
On the design's mock the message is **258 B** at boot and **363 B** with a filter step, both cuts
and a selection — both exactly what they were — and **595 B** with every switch, the tool, a
model and a plane off their defaults at once (363 B before, when none of that was said at all).
A camera turned to a direction of its own adds 57 B.

The live view state is a **mid-conversation `role:'system'` message**, which is supported on
`claude-opus-5` with no beta header. It must follow a user message and may not be
`messages[0]`; earlier ones stay in history. If the API ever refuses the role, the gateway
falls back **once**, for the rest of the session, to a second text block inside the user turn.

The model schema caps each category at 150 values, **with a count for each**, and ends a
truncated category with `… N more — use list_values`.

Request parameters: `model` from settings (default `claude-opus-5`), `max_tokens: 64000`
(the streaming guidance for this model, on which thinking shares the ceiling),
`thinking: { type: 'adaptive' }`, `output_config: { effort }` (default `medium`),
`tool_choice: { type: 'auto' }`. The SDK client is built with `timeout: 50 000 ms` and
`maxRetries: 1`, so two attempts at one request fit inside the 120-second turn.
`eager_input_streaming: true` rides on every strict tool: the request always streams, and
client-side zod validation (`executors/inputs.ts`) is what makes it safe to take the input
before the API has validated it. `budget_tokens`, `temperature`, `top_p` and `top_k` are
never sent — they are 400s on this model. A policy refusal is re-routed server side through
`betas: ['server-side-fallback-2026-07-01']` with `fallbacks: 'default'`.

### 8.3 The loop

`end_turn` finishes. `tool_use` pushes the assistant content back **unchanged** (thinking
blocks included), runs the calls **sequentially, in order**, and pushes **one** user message
carrying **every** result — a failed tool comes back as `is_error: true` and is never dropped.
`pause_turn` pushes the content and continues. `refusal` reads `stop_details` and surfaces the
category and explanation. `max_tokens` says the reply was cut off.

Caps: **12 tool rounds**, **120 s** wall clock, **20 s** per tool (**60 s** for `query_sql`
and `clash_check`). Abort is available at any point. The 120 s is enforced by a timer that
**aborts the live stream**, so a request that never answers cannot outlive it; a user's own
abort reports `aborted` and the deadline reports `timeout`, and both roll the transcript back
the same way.

**The transcript is rolled back to its pre-turn length on abort, on error and at every cap.**
The one thing it may never contain is a `tool_use` with no `tool_result` after it: the next
turn would 400 for ever and the only way out would be losing the conversation.

Three recoveries, each taken at most once: a 400 naming the `system` role, a 400 naming the
tool schema (which drops `strict` from every tool), and a context overflow (which drops the
oldest messages once and retries, trimming further if that would leave an orphan
`tool_result` first).

### 8.4 IPC

| Channel | Direction | Payload |
|---|---|---|
| `ai:turn:start` | renderer → main | `{ turnId, userText, quote?, viewState, schema? }` — `schema` only when the federation changed |
| `ai:turn:abort` | renderer → main | `{ turnId }` |
| `ai:event` | main → renderer | `text_delta \| tool_start{name} \| tool_done{name,ms,ok} \| usage \| request_snapshot \| done \| aborted \| error{kind,message}` |
| `ai:tool:exec` | main → renderer | `{ turnId, callId, name, input }` |
| `ai:tool:result` | renderer → main | `{ turnId, callId, ok, result? , message? }` |
| `settings:get` / `settings:set` | renderer → main | the settings **minus the key** |
| `settings:setKey` / `settings:clearKey` | renderer → main | write-only; there is no getter |
| `settings:open` | main → renderer | the native menu's Preferences… (⌘,) |

Every payload is validated with the same zod schema on both ends
(`src/shared/ipc-contract.ts`).

### 8.5 The tool catalogue

Fifteen from the design; **twelve** read-only additions; **six** view tools for parity with
the user (2026-10-02: two in phase 1, two in phase 2, one each in phases 3 and 4); **four** for
the Schedules window (2026-09-28) — 37 in all. Every one
declares `kind`, and
`tests/readonly-guard.test.ts` fails the build if a tool is neither `read` nor `view`, if a
tool name contains a mutating verb, or if a tool takes a file-system-shaped input — a path, a
file name or file content, at any depth. The one owner-approved exception to the verb rule is
`export_schedule`, by that exact name: it takes a format and nothing else and may only *open*
the native Save dialog, through the Schedules window's own Export menu action; the write is the
user's Save, through `main/exports.ts`.

Since 2026-10-02 a tool's spec may also carry a **`gate`**: which of its calls only *ask* the
user, and through which surface — `apply` (the chat's pending row), `dialog` (a native dialog) or
`confirm` (a confirmation the app draws beside the thing it is about: the sidebar's unload strip,
and since phase 4 the Schedules window's own dialog). `gateOf(name, input)` reads it,
`GATED_CALLS` is the flat list, and the guard test pins that list — thirteen calls (since
2026-10-08; fourteen before, with `set_base_point`) — line for line, together with the
**three** that may raise a native dialog — `request_user_action`'s `open_files` (Open),
`export_schedule` (Save) and `manage_schedules`' `open_file`, in the Schedules window — and
the **three** that raise a confirmation of the app's own (`unload_model`, and
`manage_schedules`' `delete` and `print`: the print dialog's own default button prints, so no
call raises it — it opens on the user's click in that window's confirm). There are still two
kinds; a gated call is a `view` call that changes nothing by itself.

| Tool | Kind | Input |
|---|---|---|
| `summarize_elements` | read | `rules?`, `groupBy` |
| `audit_model` | read | — |
| `clash_check` | read | `modelA`, `modelB`, `tolerance?` |
| `set_filter_stack` | view | `steps[{action, rules, color?}]`, `combine?` |
| `manage_filters` | view | `op`, `step?`, `to?`, `name?` (a filter set's, ≤ 200 characters); for `update`: `action?`, `rules?`, `color?` (one of the card's six swatches) |
| `query_elements` | read | `rules` |
| `apply_visibility` | view | `rules?`, `action?` (`isolate` / `hide` / `highlight` / `show` / `reset` / `undo` / `redo`), `combine?`, `ids?`, `selection?`, `schedule?` |
| `select_elements` | view | `rules?`, `zoom?`, `mode?` (`replace` / `add` / `remove` / `clear`), `ids?`, `selection?`, `schedule?` |
| `set_storeys` | view | `visible[]` |
| `activate_model` | view | `key` (nullable) |
| `set_view` | view | `view?`, `projection?`, `fit?` (`extents` / `selection`), `azimuth?` (°, ±360), `elevation?` (°, ±90), `zoom?` (0.1–20) |
| `set_section` | view | `kind` (nullable), `name?`, `offset?`, `flip?`, `cut?` |
| `toggle_display` | view | `grids?`, `levels?`, `shadows?`, `dims?`, `groundGrid?`, `snap?`, `originalMaterials?` |
| `color_by_property` | view | `property` (nullable), `rules?`, `ids?`, `selection?`, `schedule?` |
| `color_models` | view | `map` (model key → hex, or `null` to clear that one; `{}` clears all) |
| `get_element` | read | `id?`, `guid?` |
| `get_entity_raw` | read | `model?`, `expressId?`, `guid?` |
| `list_values` | read | `attr`, `contains?`, `limit?` (≤ 200), `offset?`, `rules?` |
| `find_properties` | read | `text`, `rules?`, `limit?` (≤ 50) |
| `search` | read | `text`, `limit?` (≤ 100) |
| `get_spatial_tree` | read | `model?`, `counts?`, `spaces?`, `depth?` |
| `get_relationships` | read | `id?`, `guid?` |
| `get_model_info` | read | `model?` |
| `get_view_state` | read | — |
| `measure_between` | read | `a`, `b` |
| `find_nearby` | read | `id?`, `ids?` (≤ 25), `distance?`, `spaces?`, `limit?` (≤ 100) |
| `query_sql` | read | `sql` |
| `set_models` | view | `visible[]` (model keys, ≤ 200; `[]` shows every model) |
| `set_interface` | view | `theme?` (`dark` / `light`), `units?` (`mm` / `m`), `treeMode?` (`entity` / `type`), `sidebar?` (`open` / `collapsed`), `card?` (`project` / `section` / `filter` / `coords` / `views` / `measure` / `none`), `tool?` (`select` / `measure` / `spot`), `search?` (≤ 200 characters), `schedulesWindow?` (`open`) |
| `manage_views` | view | `op` (`list` / `save` / `restore` / `rename` / `delete`), `name?` (≤ 80 characters to give one; a lookup by name), `number?` (its place in the list), `to?` (the new name, ≤ 80) |
| `manage_markups` | view | `op` (`list` / `focus` / `place_spot` / `place_measure` / `show` / `delete` / `clear`), `name?` (`M2`, `C1` — as the card names it), `kind?` (`measures` / `spots`, for `clear`); for placing: `id?` (an element) with `at?` (`top` / `centre` / `base` of its bounding box), or `point?` (`{x, y, z}`, project-frame metres, ±10⁷); `show?` (`level` / `full`, a spot tag's state) |
| `request_user_action` | view | `action` (`open_files` / `open_recent` / `unload_model` / `copy_link` / `copy_guids`; `set_base_point` until 2026-10-08), `recent?` (a file's **name** on the recent list, ≤ 255 characters, never a path), `model?` (a loaded model's key), `ids?` (≤ 2 000), `selection?` or `schedule?` |
| `manage_schedules` | view | `op` (`open` / `undo` / `redo` / `templates` / `apply_template` / `saved_list` / `load` / `save` / `rename` / `duplicate` / `delete` / `print` / `open_file`), `name?` (a saved setup's, or a template's name or id, ≤ 200 characters, no control or direction character), `to?` (for `rename`, the same bound) |
| `make_schedule` | view | `base?` (`new` / `open`), `title?`, `category?` (≤ 12), `columns?` (≤ 40; each `field`, `heading?`, `total?`, and since phase 4 `hidden?`, `decimals?` (0–6), `unit?`, `align?`, `after?`), `removeColumns?`, `calculated?` (≤ 20; each `name`, `formula?` or `percentageOf?`, `result?`), `filters?` (≤ 8), `filterLogic?` (`and` / `or`), `sortBy?`, `groupBy?` (≤ 4 with `sortBy`), `itemize?`, `grandTotals?` |
| `get_schedule` | read | `limit?` (≤ 50), `offset?` |
| `export_schedule` | view | `format` (`xlsx` / `csv` / `all_saved` / `schedule_file`) |
| `color_by_schedule_column` | view | `column` (a heading or field of the open schedule; `null` clears) |

`set_section` acts on one of two independent cuts (2026-10-01): `kind:"grid"` sets the gridline
cut and leaves the level cut alone, `kind:"level"` the reverse, a `kind` with `name:""` or no
name clears just that cut, and `kind:null` clears both; an unknown name changes nothing and
returns the valid list. Its result's `section` and `get_view_state`'s `section` are one string
— `grid C`, `level L2`, `grid C + level L2` — or `null`. **It does what the user's click does**
(the owner, the same day: *"assistant should possess everything user can do on the app"* — the
direction for the catalogue, bounded by the viewer-only rule, of which this tool is the first
application). Setting a plane is the chip's own patch: cutting, at offset 0 for a gridline and
1 200 mm for a level when `offset` is omitted, not flipped. On the plane already set at that
name a call changes only what it passes — an omitted `offset`, `flip` or `cut` keeps what the
plane has, one rule with no exception — and never clears it. `cut:false` shows the plane as a
preview, the card's `cut` button off, and `cut:true` cuts; so a previewed plane that is moved is
still a preview until a call says `cut:true`. The two clears are the card's `Clear` and
`Clear all`.

`manage_filters`' `op` is `list | enable | disable | move | remove | clear | update` plus
`save_set | apply_set | delete_set | list_sets`, which reach the designed Filter card's own
named filter sets through the card's own store action — its cap of twelve and its
"a repeated name replaces the older set" rule included. A set holds rules, never element ids,
and never anything from the model file. Since phase 3 `delete_set` **only asks**: a forgotten set
cannot be brought back, so it waits behind the pending row's Apply (it had been immediate, and
unguarded, since 2026-09-20). So does a `save_set` that would **forget** a set — under a name
already in use, which the card's rule replaces, or as a thirteenth, which pushes the oldest out:
it waits in the row and saves nothing until the user clicks, while a save that only adds is done
at once. `update` (2026-10-02) changes one step where it stands —
its action, its rules, its highlight colour — through the card's own `updStep`, `setStepRules`
and `setStepColor`, so the step keeps its id and its place and the rest of the stack its colours
and its off switches, none of which a rebuilt stack keeps. A `move` to the position the step
already has is no move.

**What phase 1 of the parity work added (2026-10-02), tool by tool.** Each is the control's own
action, compared first where the control is a toggle — so a call is idempotent, and a setting
already as asked is reported in `already`, never flipped:

- `toggle_display` — `groundGrid` (`setGroundGrid`, the toolbar's canvas-grid button), `snap`
  (`toggleSnap`) and `originalMaterials` (`toggleNative`, the sidebar's switch). Its result is
  `{message, changed, already, display}`; `dims`, which said nothing when it was already so, is
  in `already` like the rest.
- `select_elements` — `mode`: `replace` (the default) selects exactly the set; `add` and
  `remove` are a Ctrl-click for a whole set — the selection with the set added or taken out,
  handed to the store's `select` in one call; `clear` is Esc (`select(null)`) and needs no set.
  `zoom` defaults to true for `replace` only. Every result carries `selectionCount`.
- `apply_visibility` — `action:"undo"` / `"redo"` are the action bar's two buttons, the store's
  `step(back)`. The result carries `historyBefore` and `history` (`canUndo`, `canRedo`); with
  nothing to step to it says so and changes nothing.
- `color_models` — a `null` value is the palette's own `reset` for that one model
  (`setModelColor(key, null)`); the empty map still clears every override and turns Original
  materials back on.
- `activate_model` — handed the key that is already active, it now stays active and says so.
  The store's `activate` toggles, and the tool used to pass the key straight through: it left
  activate mode and answered "Activated X.".
- `set_models` — the model eye. `visible` names the models to leave showing, `[]` all of them;
  it is written as one `up({ modelVis })`, the call `toggleModel` itself makes, so one request
  is one undo step. An unknown key changes nothing and returns the valid list.
- `set_interface` — `setTheme`, `setUnits`, `setTreeMode`, `togglePanel`, `openCard` /
  `closeCard`, `setTool`, `setSearch`, and the toolbar's own `window.sgvue.openSchedules()`.
  Its result is `{message, changed, already, interface}`. Until phase 2 it did not mark the turn
  as having changed the view, because the per-turn ↺ restored the five visibility keys and could
  not put a theme or an armed tool back; since the revert was widened it does, for every setting
  but the Schedules window. Arming the laser meter or the spot tool places nothing: the user's
  click does.

**What phase 2 added (2026-10-02), tool by tool.** The same rules: the control's own action,
compared first, idempotent, bounded — and nothing that deletes, clears or places.

- `set_view` — the camera, freely (`shared/view-angles.ts`). `azimuth` is the bearing the camera
  **looks towards**, clockwise from project north (0 north, 90 east, 180 south, 270 west);
  `elevation` is how far it looks **down** (0 level, 90 straight down, −90 up). In these terms
  the six view buttons are south 0 / 0, west 90 / 0, north 180 / 0, east 270 / 0, top 0 / 90 and
  iso 315 / 29.8 — the numbers the read-back gives, so that sent back they are that view — and
  the description says so. A direction turns the camera where it stands —
  about what it is looking at, at its present distance — and lights no view button (the store's
  new `aimCamera`, which is the viewer's new `lookAlong`); either angle alone keeps the other.
  `fit` frames without turning: `extents` is a double-click on empty space, `selection` is F
  (the store's new `fitView`: the viewer's `zoomExtents` / `zoomTo`); with a direction it is a
  click on the view cube. `zoom` is a factor on the fit, stopped where a dolly stops, and alone
  fits the building. The projection goes through the persp / ortho button's own `toggleProj`,
  only when it differs, after a named view and before any framing. A named view together with a
  direction is refused in words, and so is `fit:"selection"` with nothing selected. The result
  reads the camera back (`camera`, below). It marks the turn only when the camera, the lit view
  or the projection is different afterwards.
- `manage_views` — the Viewpoints card: `list` (at most twenty, each `{number, name, sub,
  active}`, with the total and `truncated`); `save` (`saveView`, and a `name` is the rename of
  the new row; refused past fifty viewpoints); `restore` (`restoreView`, a click on the row: it
  pushes undo as the click does); `rename` (`renameView`). A viewpoint is named exactly, then
  case-insensitively, or by its number — the only way to reach one whose name two share, or
  whose name is longer than the 80 characters the list shows; a name two share, or one that
  matches nothing, changes nothing and returns the list. **A restore can hide**, so it runs the scope guard as an undo
  does: one that would take elements out of view and leave nothing, or under 5 %, is refused in
  words. There is no delete. *(Phase 3: such a restore is held behind Apply instead of refused,
  and `delete` exists as a request — below.)*
- `manage_markups` — the Markups card, read: `list` returns the laser measurements (`M1 {x, y,
  z}`, the lengths its rays read, in the card's unit — since 2026-10-08 with `sides {minus,
  plus}` per axis, each length split at the point, a side that reached no face left out) and
  the spot coordinates (`C1 {E, N, Z}`, or `{level}` where the model has no base point), at most
  fifty of each with the totals and `truncated`; `focus` zooms to one (`focusPoint`). Nothing is
  placed, changed or removed. *(Phase 3: `delete` and `clear` ask for a removal — below.)*
- `manage_filters` — `update`, above; it runs the scope guard, and an update that takes nothing
  out of view is exempt. `set_filter_stack` — a `color` per step, one of the card's six
  swatches; a step with none still takes the next unused one.

**What phase 3 added (2026-10-02), tool by tool.** None of these performs anything. Each puts a
request in front of the user and returns at once — `applied:false`, and `pending:true`,
`dialog:true` or `asked:true` — with the same sentence every time: *asked, not done … this turn
is not told whether they do — so tell them what is waiting, and never say it was done.*

- `manage_views` — `delete` asks to delete one viewpoint, found as `restore` finds it. The row
  reads `delete the viewpoint "Lobby" (3D) — it cannot be brought back`; Apply is the row's own ×
  (`dropView`), on that record's id.
- `manage_markups` — `delete` asks to delete one measurement or spot, named as the card lists it
  (`M2`, `C1`). A markup is named by its position and a delete shifts the names, so the request
  is fixed to the **record** and the label says so, with the row's own reading: `delete laser
  measurement M2 (X 1 234 mm), as the Markups card lists it now — it cannot be brought back`. `clear` with
  `kind` asks to delete all of one list — `delete all 3 laser measurements (M1–M3) — they cannot
  be brought back` — and Apply clears only while the list is exactly the one that was counted.
- `manage_filters` — `delete_set`, above: `forget the filter set "No windows" (1 step) — it
  cannot be brought back`. And `save_set`, when the save would forget a set already saved
  (`forgottenBySave`, `shared/filter-stack.ts`): `save the live filter as "No windows" — it
  replaces the saved set of that name (1 step), which cannot be brought back`, or `… — only 12
  are kept, so "s0" (1 step) would be forgotten, and cannot be brought back`. Apply is the
  card's own Save, run only while a save would still forget exactly those sets.
- `apply_visibility` `undo` / `redo` and `manage_views` `restore` — one the scope guard catches is
  **held** in the row (`undo one change — leaves 5 of 412 visible`, `restore the viewpoint "L2
  plan" — leaves 5 of 412 visible`) where phases 1 and 2 refused it in words; Apply takes the
  real step, or restores the real viewpoint.
- `request_user_action` — six things, one per call:
  `open_files` raises the native Open dialog — the designed `upload` control's own call — and
  returns without waiting; the user's pick loads as any upload does, and the tool is told only
  that the dialog was raised (as `export_schedule` is never told whether a file was saved).
  Refused while a dialog is already up.
  `open_recent` asks to open one file of the app's recent list, **by name**: `open the recent
  file "Tower A.ifc"`. The name is matched against the list — exactly, then without regard to
  case or extension — and is never opened as given; one with a path separator in it is refused
  before any executor runs, one that is not on the list returns the list of names, and one that
  two files in different folders share is refused rather than told apart by a path. Apply opens
  it as the Recent pill does (§10, File access).
  `unload_model` raises the sidebar's own "Unload X?" strip beside that model — a model's ×,
  `askRemove` — where `delete` is the user's click; a collapsed sidebar is opened first. Refused
  while one model is loaded, as the sidebar draws no × then.
  `copy_link` asks to copy the share link — `copy a link to this view to the clipboard — the view
  as it stands when you click` — and `copy_guids` the GlobalIds of `ids` or of the selection, one
  per line: `copy the GlobalIds of 12 elements to the clipboard, one per line`. Only a **valid**
  GlobalId is copied, because what lands on a clipboard is pasted somewhere. The result never
  holds the link, which carries the files' paths.
  `set_base_point` asked to change the Coordinate-system card's fields — any of `E`, `N`, `Z`
  (metres) and `angle` — and Apply typed each number into its field (`setCoord`), the change
  joining that reply's `revert`. **Removed on 2026-10-08**, when the owner made the card
  read-only (*"dont let user change anything"*): what nobody can change, the assistant cannot ask
  to change.
- `export_schedule` — unchanged, and now counted as the turn's one request (§8.7).
- `get_view_state` — reports the base point (§8.6).

**What phase 4 added (2026-10-02), tool by tool.**

- `make_schedule` — what the Schedules window's tabs set, each by the tab's own rule
  (`schedule/assistant.ts`, `buildSchedule`). `filterLogic` is the Filter tab's every-rule /
  any-rule switch; `itemize: false` collapses rows that read alike into one with a Count. Per
  column: `hidden`; `align`; `decimals`, on a number only; `unit`, one the Format tab offers for
  what the column measures (a length: mm, cm, m, km, in, ft; `m2` and `m3` are read as m² and
  m³) — anything else is refused with that list; and `after`, the heading or field of the column
  it goes directly behind (`""` puts it first; a column already shown is moved). `calculated`
  defines columns worked out per row — a formula over the other columns' headings in the
  engine's own grammar (`+ - * /`, comparisons, `&&` `||`, `round`, `floor`, `ceil`, `abs`,
  `sqrt`, `min`, `max`, `if`, `contains`, `starts`, `ends`, `number`, `len`; measures read in SI,
  as a filter reads them), or `percentageOf` a field's total — and shows each at the right unless
  `columns` places it; one whose name the schedule already has is redefined where it stands. A
  formula the calculated-value editor would mark bad — it does not parse, it names a heading no
  column has, its units cannot be added — **refuses the whole call with the editor's own reason**
  and the headings it may name (`calcProblems`, the one check both use). With no `result` a
  formula is what its units work out to (a width times a height is an area); `yes_no` and `text`
  are the caller's to say. A filter on a percentage is refused: the engine works one out over
  the rows the filters leave. `get_schedule` and `make_schedule`'s own result read every one of
  these back (§8.6).
- `apply_visibility`, `select_elements`, `color_by_property`, and `request_user_action`'s
  `copy_guids` — **`schedule: true`**: the elements the schedule open in the Schedules window
  lists. The engine runs in the main renderer, uncapped, over the definition that window last
  reported (`scheduleElementIds`), and the tool then acts on those ids exactly as on `ids` —
  the store's own actions, the scope guard, the undo stack, the pending row. Precedence: `ids`,
  `selection`, `schedule`, `rules`. **Not bounded by `MAX_TOOL_IDS`:** that cap is for ids the
  model sends, and this set never travels through the model — the app holds it, as it holds
  `selection`, which has no cap either — so a schedule of any length is acted on whole, and the
  scope guard holds or refuses as for any set. (Phase 4 bounded it and refused an over-long
  schedule whole: "isolate what this schedule lists" then failed for every wall of a real
  model.) Rules stay preferred where a rule can say the set: only a rule can be saved and shared.
  With no Schedules window, or none shown in it, it says so and changes nothing. **It never goes
  through the port's `act` message**, which has no scope guard (§10).
- `manage_schedules` — the Schedules window's own controls (`ai/executors/schedule.ts` asks,
  `schedule-ui/manage.ts` answers; §10 has the two messages). `open` is the toolbar button's own
  call; every other operation needs the window open and is refused in words without it.
  `undo` / `redo` step that window's own history — where `make_schedule`'s changes land — and
  report the steps left. `templates` lists the gallery's cards for the loaded models (`id`,
  `name`, `classes`, `columns`, `fit`, `elements`, `inUse`); `apply_template` starts the
  schedule from one, by name or id. `saved_list` lists My templates (`name`, `classes`,
  `columns`, `saved`, `inUse`, `lacks`), and counts the setups whose names cannot be shown;
  `load` makes one the open schedule; `save` saves the open schedule under its own title — a
  name another setup has is never replaced, the copy is numbered; `rename` and `duplicate` are
  the panel's own two actions. Each is the control's own handler (`schedule-ui/actions.ts`), so
  its toast, its markers and its undo entry are the click's. **Three only ask**, in that window:
  `delete` raises its own confirm for one saved setup (`Delete the saved template “…”? This
  cannot be undone.`, labelled `Ask Vee`), `print` raises that confirm too (`Open the print
  dialog for this schedule?` · `Print…`) — the native print dialog, whose own default button
  prints, opens only on that click — and `open_file` its native
  Open dialog for a `.schedule.json`; the tool is answered `asked` before any of them is
  raised, brings the window forward, and is never told what the user chose. **A question raised
  for the assistant takes no default button** (`schedule-ui/dialog.ts`, `ConfirmHow.forAssistant`
  — an explicit option, never read off the label): it appears while the user may be typing,
  there or in the chat as that window comes forward, and a focused button answers to Enter and
  Space — so the focus goes to the dialog's card, Tab reaches Cancel first and then the
  confirm, Escape cancels, and the user's own confirms and prompts are unchanged. **And so does a
  `save` or a `duplicate` that would take a saved setup away** — a save over the setup the
  schedule was loaded from, or one that pushes the oldest of a hundred off the list — which the
  user's own Save does without a question: that window's confirm asks first, and it is held
  (nothing raised, nothing saved) when the turn already has a request waiting. While one of that
  window's dialogs is up, everything that would change it answers that it is busy.
- `manage_markups` — `place_spot` and `place_measure` place a spot coordinate or a laser
  measurement **exactly as a click with that tool does**: the viewer's own commit for the click
  (`viewer-core.ts`, `commitSpot` / `commitLaser`), so the record, its labels, its number in the
  card and — for a measurement — its rays (the same picker, the same section clipping) are a
  click's. The point is named: `id` and `at` — `top` (the default), `centre` or `base`: the
  middle of that element's **bounding-box** top face, of the box, or of its underside — or
  `point`, in project-frame metres. The box is axis-aligned and conservative, not a picked
  surface, and the description, the result (`on: "bounding box"`) and the prompt all say so. From
  `top` and `base` the laser does not fire into the element; from `centre` it reads the
  element's own faces. The result carries the new markup's name (`C3`, `M1`), what the card's
  row reads, and the point. At most fifty of a kind are added by a tool. **A placed markup is
  taken away again by the reply's `revert`** (§8.9) — it is session view state, not a saved list —
  and the result says so; the executor only reports the new record's id, and `delete` and `clear`
  still only ask. `show` sets a spot tag to
  its `full` E / N / Z or back to its `level` alone, for one spot (`name`) or every one; it is
  the tag's own toggle, and idempotent.

**Departures from the design's schemas**, all invisible (a tool schema is sent to the model,
never rendered):

1. **One `combine` enum.** The design writes `replace|append` on `set_filter_stack` and
   `replace|add` on `apply_visibility`, so the same word meant two things. Both are
   `replace|append`, and the instruction line and the tool description say `append`
   (plan §3.5 defect 3).
2. **`additionalProperties: false`** on every object schema, which `strict: true` requires.
   `color_models` is the one tool that is **not** strict: its `map` is a free-form
   `{modelKey: hex}` object, and a strict object with no declared properties would reject
   every key it exists to carry.

3. **The `absent` operator** in the shared rule schema, and the **`ids` / `selection` inputs**
   — since phase 4 also **`schedule`** — on the three view tools that can act on a found set.
   `select_elements` therefore no longer requires `rules`: there are four ways to name a set
   and any one of them will do.
4. **Fuller descriptions** on the eight tools the audit found under-described (`select_elements`
   was eight words). The behaviour is unchanged; a description is where *when to call it*
   belongs.

Optional properties stay optional: Anthropic's strict mode copies `required` through as given
rather than expanding it to every property (checked against the SDK's own strict transform in
`node_modules/@anthropic-ai/sdk/lib/transform-json-schema.js`).

### 8.6 What an executor returns

`{ forModel, ui? }`. **Only `forModel` crosses IPC** — JSON with real counts in it: per-OR-group
counts, samples capped at five or ten with `truncated`, and `valid_values` whenever a guess
matched nothing, so a wrong entity name costs one round instead of a sentence of apology. The
design's own reply sentence is kept as `message`, because the reply the user reads is
unchanged (plan §3.5 defect 9).

`ui` never leaves the renderer: chips (**≤ 6, and there is no second cap** — the design's
`groups.slice(0, 8)` feeds a colour legend's chip list and six of them survive, here as
there), the table, the pending patch — or, since 2026-10-02, a pending **action**, and a note of
what the turn asked of the user outside the row (`asked`) — and the "this turn changed
something" flag, accumulated per turn exactly as `SGVue.dc.html:1591–1619` accumulates them.

**Every result is bounded, and says so when it cut.** `get_spatial_tree` stops above the
`IfcSpace` leaves and at `depth` levels, giving every node its own `childCount`;
`color_by_property` reports the fifty largest groups to the model while the legend keeps all of
them; `valid_values` pages at forty with a total; and `truncated` is never `false` when
something was left out. Nothing in a 70-call sweep of the reference model exceeds 8 000 tokens
(`docs/AI_REVIEW.md` §10).

**A quantity total carries its unit and its coverage.** `summarize_elements` labels each total
with the file's **own** unit, read from `IfcUnitAssignment` — a Revit export writes lengths in
millimetres beside areas in square metres — and reports `areaFrom` / `volumeFrom` / `lengthFrom`
beside each group's `count`, because a total summed from 94 of 134 slabs is not the group's
area. Nothing is converted, and a metric whose unit cannot be settled is left unlabelled.
`list_values` reports `pool`, `carrying` and `missing` beside the values, so a property 83 % of
the matched elements do not carry reads as absent rather than as one tidy value.

**`get_view_state` reads back everything the assistant can set (2026-10-02).** Beside what it
always reported — the filter stack with a live count per step, the visible and total counts,
storeys, the active model, the camera view and projection, `section`, the colour scheme and the
first ten selected ids — it returns, in full and whether or not they are at their defaults:
`display` (the seven switches `toggle_display` takes, by the same names); `sectionPlanes`
(`grid` and `level`, each `{name, offsetMm, flip, cut}` or `null`; `section` stays the one
string it was, which the evaluation suite grades); `history` (`canUndo`, `canRedo`); `models`
(each loaded model's `key`, `name` as its sidebar row shows it, `visible`, `color` override or
`null`, `active` — at most fifty, each name clipped at 120 characters, with `modelsTruncated`
when cut); and `interface` (`theme`, `units`, `treeMode`, `sidebar`, `card`, `tool`, `search`
clipped at 200 characters, and `schedulesWindow` `open` / `closed`). **Since phase 2:**
`camera` — `{view, projection, azimuthDeg, elevationDeg}`, the named view the camera is actually
standing on (or `null`), and its two angles to one decimal, in `set_view`'s own terms;
`filterStack[].color` on each **highlight** step, the card's swatch; and `viewpoints` — the
saved viewpoints as `{name, sub, active}`, at most twenty, a name clipped at 80 characters, with
`viewpointsTotal` when there are more. **Since phase 3:** `basePoint` — `{E, N, Z, angle,
source}`, the Coordinate-system card's four fields as numbers (a blank one is `null`, never a
zero, which would read as a coordinate) and whose they are: `file` while the boot file states
them, `none` while all four are blank (`user`, for numbers typed into the card or applied from a
reply, until 2026-10-08, when the card became read-only). **Since 2026-10-08:** `notLinedUp` —
`{model, reason, km}` for each loaded model the card's note names. On the mock that is
1 202 B at boot (1 132 B after phase 2, 1 034 B after phase 1, 357 B before it); the view state
sent with every turn is unchanged, byte for byte. `tests/unit/ai-readback.test.ts` holds it to the session's own list of
review state: every key of `SessionSource` (`shared/session-codec.ts`) is either reported — the
test changes that key and requires a different result — or excluded by name with its reason.
None is excluded any more: `coords`, the base point, was until phase 3, when the assistant
became able to ask for a change to it. (`hlColor`, the last highlight colour pushed to the
renderer, was excluded until a step's own colour was reported.) Markups are not in `get_view_state`; `manage_markups` lists them.

**What the three spatial tools report, and what they do not.** All three read the same
per-element box — project-frame metres, Z-up, the union of the element's placed part boxes —
and all three say so in structure as well as in prose, because a box distance is not a
surface-to-surface distance:

- `get_element` returns `bboxMetres` with `bboxFrame: 'project'`, `boxSizeMetres`,
  `boxVolumeM3`, `boxCentreMetres`, the centre's **map** coordinates through `toMap` when the
  file georeferences (`boxCentreMap`, else `null`), and `boxMethod`, which names the
  approximation. Every field is `null` for an element with no geometry. It also returns
  `solidCount` — the element's **tessellated parts**, opaque and transparent together, which is
  the same number `viewer.solidCount(id)` gives the property card's Geometry row — with
  `solidCountMethod` beside it, because "solids" would otherwise read as the file's own
  representation items. An element with no geometry carries no count at all, never a zero.
- `measure_between` returns `centreToCentreMetres`, `boxGapMetres` per axis (negative is an
  overlap), `boxClearanceMetres`, `boxesOverlap`, both boxes, `frame: 'project'` and `method` —
  and its `message` is the design's own sentence, ending "Bounding-box arithmetic, not solid
  geometry."
- `clash_check` is unchanged: it already named `method` and `frame: 'project'` and already
  called its results candidates for review. What changed is that on a real model it now has
  boxes to sweep at all.

`query_sql` reaches the same numbers through the `bbox` table — one row per element **with
geometry**, so a count of elements needs a `LEFT JOIN`. The table's comment in the schema the
assistant is given states the frame, the units, the approximation and that an authored `Qto`
quantity is to be preferred when one exists.

### 8.7 Guards

- **The scope guard.** A stack that would leave **nothing** visible is refused outright —
  by `set_filter_stack` **and** by `apply_visibility`, which is what an appended second
  `isolate` produces; one that would leave **under 5 %** becomes a pending patch with an Apply
  button. `highlight` is
  exempt, because it changes no element's visibility. The pending entry carries the **patch**,
  which goes to `up()` — never a label and a patch that can drift apart. **A patch is
  visibility and nothing else** (2026-10-02, the gate's review): it is typed to six keys —
  `hidden`, `storeyVis`, `modelVis`, `stack`, `stepSel`, `ctx` (`PENDING_PATCH_KEYS`,
  `shared/undo.ts`) — and Apply hands `up()` those keys and no others, whatever the object
  carries, so a row labelled "leaves 9 of 412 visible" cannot also delete a viewpoint.
  **Since 2026-10-02 it covers everything else that can hide:** `set_models` (a call that only
  brings models back is exempt, as `show` is); `manage_filters`' `enable`, `apply_set` and
  `update`, the first two of which wrote their stacks unchecked until then (`remove` and `move`
  are not checked, because they cannot hide — visibility is a conjunction of the enabled steps,
  so removing one can only reveal and reordering changes nothing, and a test proves it over
  every stack of three); and `undo` / `redo`, which are asked what they would restore before
  they step (`peekHistory`). An undo that would take something out of view and leave nothing, or
  under 5 %, is **refused in words** rather than held: the Apply button applies a patch on top
  of the history, and an undo is a move through it. Restoring a saved viewpoint
  (`manage_views`) is held to the same rule and refused in the same way — a viewpoint is a
  section and a camera as well as what is hidden, not a patch Apply could hold.
  **Since phase 3 both are held, as an action** (below): the row's Apply takes the real step —
  only while the history still holds the entry the request was fixed to — or restores the real
  viewpoint. Both verdicts are held, "nothing left" too: each returns to a view the user
  themselves had. A filter or a hide that would leave nothing is still refused outright.
- **The consent gate (2026-10-02).** What reaches outside the view or cannot be undone is asked
  for, never done. The pending row's entry is a patch **or an action** — `PendingAction`, a
  closed list of thirteen kinds (since 2026-10-08; fourteen before, with `set_base_point`)
  (`ai/executors/context.ts`) — and an executor only *describes*
  one: the kind, and what it was fixed to when it was asked (a record's own id, the history
  entry, the GlobalIds' text). **It is performed in one place**, the store's `performGated`,
  reached only from `applyPending`, which only the row's `apply` button calls; each branch is
  the action that thing's own control calls. The row is taken before the action runs, so a
  request is applied **once**; `cancel` drops it; nothing brings one back, and a later turn
  cannot apply an earlier turn's. A request the user's own work has overtaken — the viewpoint
  already gone, the markup list changed, the history moved on — does **nothing**, and the
  panel's status line says so. Two requests have a surface of their own: the sidebar's unload
  strip and the native Open dialog. (Phase 4: three more, in the Schedules window — that
  window's own confirm, before a deletion and before its print dialog, and its Open dialog —
  raised by that window's own controls after it has answered the tool, which is never told what
  the user chose; a question raised there for the assistant takes no default button.) **No label
  and no result holds a file's path or the share
  link** — a result is read by the model, and both are things a hostile file could ask it to
  repeat. **Every name in a label or a request's result goes through one helper** (`labelText`):
  control characters and Unicode's invisible direction and width marks are taken out before it
  is clipped, so a newline or a right-to-left override in a viewpoint's, a filter set's or a
  file's name cannot make the row read as something it is not. `tests/readonly-guard.test.ts` holds all of it: the pinned list of gated calls; that
  no file under `renderer/ai/` — where every tool runs — names any of the performing functions
  (`dropView`, `clearSpots`, `forgetFilterSet`, `setCoord`, `copyLink`, `openRecent`,
  `removeModel`, `applyPending` and the rest, by identifier); that `applyPending` is called from
  the Apply button and the dev harness alone; and that `request_user_action` has no input that
  could carry a path. Since its review it also refuses the **general** doors by name —
  `applySession`, the store's raw `setState`, the settings and API-key calls, the stored session
  — and requires every call a tool makes to the store's `up` to be a flat literal of the six
  pending-patch keys.
- **One request per turn.** The panel has one Apply button a turn, and a turn asks the user for
  one thing of any kind: a change the guard held, a gated request, the Open dialog, the
  Schedules window's Save dialog or the sidebar's confirmation. A second is refused in words —
  "a request is already waiting" — before its executor runs when the catalogue marks the call as
  gated, so no second dialog is raised to find out; a second *held change* is caught after its
  executor has looked, as before. The first keeps its row, its dialog or its strip. (Before
  2026-10-02 a second held change replaced the first in silence.) An Open dialog is single-flight
  besides: while one is up — the user's own included — a request for another is refused.
  **A call that only asks is not run at all for a turn that is no longer live** — after Stop, or
  once a newer turn has begun: main still gets its answer, in words (*The turn was stopped, so
  nothing was asked.*), and no dialog, strip or row is raised for a turn nobody is waiting on.
  **Since phase 4 no view call is**: one that would change the view is answered *The turn was
  stopped, so nothing was changed.* — a late isolate, camera move or theme switch used to land
  with no reply to say so and no `revert` to put it back. A read still runs.
- **Undo.** Every view tool goes through the store actions the buttons call — or the control's
  own handler, where it has none (in the Schedules window, that window's own, on its own undo
  history) — so an assistant action lands on the same 50-deep undo stack
  as a manual one. Each turn also keeps its own pre-turn snapshot, so ↺ reverts that reply alone
  — since 2026-10-02 everything it changed (§8.9).
- **SQL.** Its own worker, `PRAGMA query_only = 1`, a SELECT/WITH/EXPLAIN-only gate outside
  string literals, 200 rows with a `truncated` flag, and a ten-second limit enforced by
  terminating the worker and rebuilding from bytes the renderer kept.
- **Clash and proximity.** One uniform spatial hash on bounding-box centres, shared by
  `clash_check` and `find_nearby` and asserted equal to a flat scan on random boxes; both state
  that they are box arithmetic in the project frame rather than solid geometry, and clash
  results are always described as *candidates for review*, never as clashes. `find_nearby`
  leaves `IfcSpace` out unless asked, because a space overlaps everything standing in it.
- **No file system.** There is no tool that reads, writes, names or accepts a path.
  `request_user_action`'s `recent` is a file's **name** as the app's own recent list has it: it
  is compared with that list and never opened as given, a name with a path separator is refused
  by its schema, and the path that is opened on Apply is the list's own.

### 8.8 Privacy

The key is encrypted by the OS (`safeStorage`: Keychain on macOS, DPAPI on Windows) and stored
as ciphertext in `settings.json`. It is **never returned** to the renderer — `hasKey: boolean`
is all the renderer ever learns, and there is no getter on the bridge or in main's IPC table.
`ANTHROPIC_API_KEY` in the environment wins over the stored one, so a development run never
touches it.

Preferences → **Data sent to AI** shows the exact last request, held in renderer memory and
written nowhere. The note above it reads: *"The assistant sends a summary of the model's
schema and the results of read-only queries to Anthropic's API. The IFC file itself never
leaves this computer."* With no key configured, nothing is sent at all.

`scripts/ai-acceptance.cjs` exercises the whole path against the real API — but **only when
`ANTHROPIC_API_KEY` is already in the environment**. It never asks for a key and never reads
one from disk; with none set it prints that it is skipped and exits 0.

### 8.9 The panel

Ported from `SGVue.dc.html:430–540` and its logic at `:1591–1656`, `:1127` and `:2015–2051`.

| Piece | What it does |
|---|---|
| The pill | Bottom right of the stage, always there, lights while the panel is open. It is the only way to open the panel — the design gives it no keyboard shortcut and no menu item. |
| The panel | 330 × 420 by default, resized by dragging the stroke at its **top-left** corner: width grows leftward, height upward, clamped to 240 px and to the stage less the lane it has to clear. It steps out of the property card's column instead of painting over it (`right` 12 → 344 when the card is up and the stage is at least 420 px wide). |
| Messages | "You" and "Vee", both on the left with the notch at the bottom left (2026-10-01, the owner's handoff; the design: "You" on the right, "SGVue" on the left, each with the notch on its own side); a reverted turn stays in the transcript at half opacity. Every message carries a `reply` control; a reply that changed something a revert can put back also carries `revert` (below). A reply that came from a turn carries a status beside its name — `checked 80 walls · 8s`, `found 12 doors · 3s` or `4s` — and renders `**bold**` and `` `code` `` as elements, never as HTML. |
| Chips | At most six under a reply. Click selects what the chip names, double-click zooms to it. |
| Tables | The grouping as the header, one row per group with its count and its area or volume, `copy csv` beside it. A row selects and zooms its elements. `copy csv` puts the table on the clipboard as CSV (since 2026-10-02 through the store's `copyTable` and the one `copyText`; the design's line, `SGVue.dc.html:2029`, called the API this app refuses and copied nothing). It has no flash, as designed; a copy that did not reach the clipboard is said in the status line. |
| Pending changes | What the 5 % scope guard held back, with `apply` and `cancel`. Apply pushes the **patch** through the same `up()` a button uses, so it lands on the ordinary undo stack, and what it changed joins what the reply's `revert` puts back (until 2026-10-02 it replaced it). **Since 2026-10-02 (owner-approved) the same row also holds a request** — a deletion, a copy, a recent file, a guarded undo or restore (and the base point, until the card became read-only on 2026-10-08): the same element and the same two buttons, with a label that says exactly what `apply` will do (`delete the viewpoint "Lobby" (3D) — it cannot be brought back`). Nothing it names happens without the click; a request that can no longer be honoured says so in the status line and does nothing. |
| The live reply (2026-10-01; the design: a busy row — the brand mark drawing itself, a stage text, three dots) | While a turn runs the transcript's next row **is** the reply being written, at the index its message will get, and the same element when it commits. `Thinking` shimmers beside the name from one second after Send. The stream's first `tool_start` — the tool's name arrives before its arguments have finished generating — opens a bubble 52 px tall: a one-line ticker over the element matrix. **Read**: `Reading 4 models`, the element count counting up, the cells arriving as a wave, grouped by model. For each executed tool whose input carries live rules: **Filter** — `Filtering IfcWall`, from the rules on `Model`, `IfcEntity`, `PredefinedType`, `ObjectType` and `Level`: the count falls to the scope's and its cells regroup, larger; and **Check** — `Checking Fire Rating`, from every other rule: a beam scans the grid, each flagged cell lights as it passes and the count rises with it (`missing` when every such rule is `is empty`, else `found`). Any other tool is a note in its own words (`ai/stages.ts`). One cell is one element while the grid has room, else `ceil(count / capacity)`; every count is exact. At `done` whatever is in flight is finished at once: the words come in one by one, the status rolls in, and the flagged cells fly into **rows** — one per storey that holds a match, at most eight, each a button that selects its elements; none beside a result table. A turn with no tool opens no trace. Vee's sprite is `thinking`, `reading`, `found` at each finding and `done` while the reply is the newest message. A failed or stopped turn takes the row away and leaves the transcript as it was. |
| Suggestions | Four, rebuilt from the conversation and the view: what is selected, what the last reply carried, whether anything is filtered or hidden, how many models are loaded. Clicking one fills the composer; it does not send. |
| The composer | Enter sends, Shift+Enter does not. A trimmed-empty question, a second question while one is running, and any question with no federation are all ignored, exactly as the design ignores them. On Send the typed line lifts out of the composer to its bubble. **While a turn runs the send button is a stop button** (2026-10-01): its arrow cross-fades to a square, its tip reads `Stop`, and a click stops the turn — the panel then says `Stopped.` |
| Reply | `reply` on a message aims the next question at it; the strip above the composer names the target and can cancel it, and the question carries the quote inline so the model resolves "those" against the right turn. |
| "Ask about this" | The context menu's item opens the panel with the composer pre-filled and focused, caret at the end. |
| The boot audit | A fresh federation is greeted by one assistant turn — model, element and storey counts plus the data-completeness findings as chips. It is local arithmetic; no request is made and no key is needed. |

**`revert`, widened (2026-10-02, owner-approved).** The design's `revert` restores the five
visibility keys — all its assistant could change. Asked whether it should restore everything
the assistant changed in that reply, the owner: *"correct."* The control is the design's own —
same button, same `Undo just this step` tip, the reverted reply dimmed — and what it does is
(`state/selectors/snapshot.ts`, the store's `revertTurn`):

- **The snapshot is the session payload** — what a session and a share link save
  (`sessionPayload`, §9) — plus the few things a session does not carry and the assistant can
  change (the selection, the colour-by scheme, the canvas grid, the units, the sidebar, the open
  card, the armed tool, the tree's search, the viewpoint marked as restored), plus each model's
  key, digest and slot. It is put back through the same `applySession` path a session restores
  through, in the same order; there is no second mechanism.
- **Only what that reply changed.** The state is cut into parts — what is visible (the five
  keys, together), the sections, the camera (with its projection and the lit view button), each
  display switch, the canvas grid, the model colours, a highlight step's colour, colour-by, the
  selection, the theme, the tree's grouping, the units, the sidebar, the card, the tool, the
  search. `executeTool` measures which parts each call changed (an executor that waits after
  its change measures itself and hands the parts back), so a part the reply left alone — or that
  the user changed by hand while the reply was being written — is not touched: a reply that hid
  the walls does not fly the camera back.
- **Offered exactly when there is something to put back**: not on a reply that only read, that
  changed something and changed it back, or that only saved or renamed a viewpoint — and, since
  phase 4's follow-up, on one that only placed a markup. Used once: a reverted reply gives its
  snapshot up with the control, and with it the record of what it placed.
- **The undo stack** takes the visibility part, as it always did, and nothing else.
- **When the federation changed in between**, a session restore's rules: element ids are
  renumbered onto the slots their models have now; a model no longer loaded takes its ids, its
  eye, its colour and activate mode with it; a camera recorded where the model stood somewhere
  else is left where it is. What could not be put back is said in the panel's status line.
- **A markup the reply placed is taken away** (phase 4's follow-up; phase 4 had left it
  standing). A spot or a measurement drawn in the 3D view is the most visible thing a reply can
  add, and it is session view state, not a saved list. No session carries the markups, so they
  are in no snapshot: the reply keeps the ids of the records its own calls placed
  (`ChatMessage.placed` — the viewer's own ids, which the executor reports and nothing else),
  and `revertTurn` removes the ones that still exist through the Markups card's own × — in the
  same click as the parts, never a markup the user or another reply placed, and with nothing
  said for one the user has already removed. Nothing under `renderer/ai/` names a removal.
- **Never put back:** the loaded models, the saved lists — viewpoints, filter sets, saved
  schedule setups — anything in the Schedules window, and a spot tag's state. *(Until phase 3 the base
  point was on this list. It is a part now: a change
  to it can only come from a request the user applied, and that joins the reply's `revert`.)*
- **A request the reply left waiting goes with it** (2026-10-02): reverting a reply drops its
  pending row. The request was part of the reply, and applied afterwards it would have been on
  no stack — a reverted reply is not offered `revert` again.

**Two things the design does not have, and the port does not add**: nothing is disabled while
a turn runs — the re-entry guard is the `chatBusy` test inside `chatSend` — and closing the
panel does not abort the turn in flight. Adding either would be a visible addition. **A third it
did not have, the panel now has**: a stop control. The design's `chatSend` has no companion,
and until 2026-10-01 neither had the port; the owner's "Ask Vee" handoff — the specification
for the assistant's panel since — makes the send button one while a turn runs.

**Motion.** The trace runs one frame loop from Send until the reply has settled — never more
than 1.95 s after the answer — and none between turns; the 3D scene is not re-rendered by it
(`scripts/frame-triggers.cjs`). Under `prefers-reduced-motion: reduce` there is no lift,
shimmer, roll, wave, beam, fly-in, count-up or word-by-word reveal: each state is shown at its
end the moment its cue is reached, and each sprite holds one frame. The matrix, the beam and
the ticker are `aria-hidden`; one visually hidden line says the assistant is working while a
turn runs, and the committed reply is announced by the log, as before.

`tests/parity/phase9/README.md` measures the panel against the prototype at **0.00–0.02 of
255** across six states in both themes, with every line of its text identical — as built in
Phase 9. Since 2026-10-01 the assistant's name, its mascot, the side a user's row stands on and
the running state differ from the prototype by design; `tests/parity/2026-10-01-vee/README.md`
measures those against the handoff instead.

> `query_sql`'s database was built early, in Phase 1b, because the federation had to exist
> first: `src/worker/sql.worker.ts` holds an in-memory SQLite copy of the index in its own
> worker, and `src/worker/sql-schema.ts` carries the twelve-table DDL as one documented
> string — which is the string `system[0]` now ends with.

---

## 9. Persistence — exactly what is written, and nothing else

Three modules may write to disk. There are no others, and the guard test fails the build if a
fourth appears.

| Module | Writes | Where | When |
|---|---|---|---|
| `src/main/settings.ts` | Preferences: AI model, effort, prompt-cache TTL, renderer backend, prefer-NVIDIA (Windows) — and the API key as **`safeStorage` ciphertext**, never as plaintext. | `userData/settings.json` | On change |
| `src/main/sessions.ts` | The session: file paths (not file contents), view state, filter stack, viewpoints, markups, and the recent-files list. | Application data folder | On change, debounced 600 ms |
| `src/main/exports.ts` | The Schedules window's exports: an Excel workbook (`.xlsx`), a CSV, or a schedule definition (`.schedule.json`). | **Only** the path the user picked in the native Save dialog, in the same call | When the user exports |

**Nothing else is written.** No IFC file is ever modified, moved or re-saved. No telemetry.
No caches of model content on disk. Sessions store *paths*, so a session reopens a model only
if the file is still where it was.

> **Status: Phase 8.** `src/main/sessions.ts` is the first of the two writers to exist. It
> writes exactly two files, both under `app.getPath('userData')/sessions/`, and both atomically
> (a temporary file, then one rename), so a crash mid-save cannot leave half a session:
>
> | File | Contents |
> |---|---|
> | `last.json` | `{ payload, savedAt }`. `payload` is the design's own `sessionPayload()` — `models, uploadNames, hidden, storeyVis, modelVis, active, modelColors, nativeMats, treeMode, grids, levels, shadows, theme, snap, dims, section, sections, stack, hlColor, view, coords, cam` — **plus** `files`: one `{ key, path, name, sha256 }` per loaded model, **and since 2026-10-01** `sections: { grid, level }`, the two section planes (each `{ name, offset, flip, cut }`). `section` is still written beside it, in its old single-plane shape — the plane that is cutting when only one of the two is, else the gridline plane if it is set, else the level plane, else "none" — so an older build restores one plane; reading takes `sections` when present, else the old `section` onto the plane of its `kind`, through one normaliser that coerces every field — a plane name longer than 200 characters is no plane — (`sectionsOf`, `shared/session-codec.ts`). A share link and a saved viewpoint follow the same rule. Written by the renderer, debounced 600 ms, exactly as `SGVue.dc.html:1685` debounces its own write. Capped at 4 MB; anything larger is refused. |
> | `recents.json` | Up to six `{ path, name, size, sha256, openedAt }`, newest first. This is what the designed sample library is backed by on the desktop: the same pills, the same "open all N" copy, rendered only when the list is non-empty. Six, because the design's own count-in-words list stops there. |
>
> **File contents are never written — only paths and hashes.** A session or a share link that
> names a file which has moved, or whose bytes no longer match the recorded SHA-256, is refused
> by name in the landing page's warning banner; it never silently opens a different file.
>
> **Filter sets and viewpoints stay in the renderer's `localStorage`**, under the design's own
> key names (`ifc-viewer:filtersets`, `ifc-viewer:viewpoints:<building>`), through
> `src/renderer/state/persist.ts`. They carry no paths and no model data, they are scoped to a
> building rather than to a session, and they are the design's own storage. Moving them behind
> `sessions.ts` would add a writer's worth of surface for no property gained.
>
> **The Schedules window's saved setups and inspector width stay in that window's own
> `localStorage`** (2026-09-25), under `sgvue.schedules.saved.v1` (My templates: up to 100
> `{ name, def, savedAt }`, a save never overwriting anything but the entry it was loaded from)
> and `sgvue.schedules.inspectorW`. Like the filter sets they carry no paths and no model data.
> Phase 4 left them there: a setup moves between machines as a `.schedule.json` the user
> exports and opens, not through a file the app keeps.
>
> **Phase 9a adds the second writer**, `src/main/settings.ts`, which writes one file the same
> way — a temporary file, then one rename:
>
> | File | Contents |
> |---|---|
> | `settings.json` | `{ model, effort, cacheOneHour, backend, preferNvidia, gpuSwitchFailed?, apiKeyEnc? }`. `model` defaults to `claude-opus-5`, `effort` to `medium`, `cacheOneHour` to `false`, `backend` to `auto` (`webgpu` is not offered — see §7), `preferNvidia` to `true` (Windows only, read once before `ready`: run on an NVIDIA adapter, else AMD, else let Windows decide — `src/main/gpu-choice.ts`; anything but `false` reads as `true`). `gpuSwitchFailed` is **absent** until the GPU process fails on a launch that asked for an adapter; it is `{ at, vendorId, deviceId }`, main-only (never in the renderer's view), stops that adapter being asked for, and is deleted when `preferNvidia` is set again or the adapter changes. `apiKeyEnc` is base64 `safeStorage` ciphertext and is **absent** until a key is saved. The plaintext key is never written, and never returned to the renderer: `hasKey: boolean` is all it learns. A hand-edited or corrupt file falls back to the defaults rather than refusing to start. |
>
> When the OS has no usable secret store, nothing is stored at all and the dialog says so —
> losing a key silently would be worse than refusing it.
>
> **2026-09-25 (phase 4 of the Schedules port) adds the third writer**, `src/main/exports.ts` —
> owner-approved in phase 1: *export adds ONE writer, limited to paths the user picks in a
> native Save dialog*. No designed control of the main window produces a file (its panel's
> `copy csv` is a clipboard control — one that, measured on 2026-10-02, copied nothing, and
> since phase 4 of the same day copies through the app's one clipboard helper: §10,
> Permissions); the Schedules window's Export menu and My templates do.
> What it writes, and how:
>
> | Kind | Bytes | Extension forced to |
> |---|---|---|
> | `xlsx` | ifcTable's workbook (exceljs, built in the Schedules page): one sheet, or one per saved setup; a numeric cell is a number holding the displayed value under a format that reproduces the screen | `.xlsx` |
> | `csv` | ifcTable's CSV, UTF-8 with a BOM, formula-leading cells defused | `.csv` |
> | `schedule` | the schedule definition as JSON | `.schedule.json` |
>
> The page sends a kind, a suggested file name and the bytes (`export:save`); it **never names a
> path**. Main shows the Save dialog attached to the Schedules window — Documents, or the folder
> last used this session, with the page's `<name> — YYYY-MM-DD.<ext>` as the default name — and
> writes only to the path that dialog returned, atomically (a uniquely named temporary file
> beside it, then one rename; a temporary file it made is removed if the write fails). When
> forcing the extension changed the name the user confirmed and a file of that name exists, a
> native box asks before it is replaced. At most **50 MB** (`EXPORT_MAX_BYTES`, the measurement
> is in `docs/DECISIONS.md`). Cancel writes nothing. The one read beside it, `scheduleFile:open`,
> shows the Open dialog and returns the text of the `.schedule.json` picked — at most 1 MB — which
> the page parses with ifcTable's strict `parseScheduleDef`.
>
> The allow-list that governs all three writers is in `src/shared/readonly-list.ts` and has
> been enforced since Phase 0.


---

## 10. Security

| Control | Setting |
|---|---|
| Renderer sandbox | `app.enableSandbox()` plus `sandbox: true` on both windows — the main window and, since 2026-09-25, the on-demand Schedules window (`main/schedules-window.ts`, at most one, closed with the main window). No renderer has Node.js access. |
| Context isolation | On. `nodeIntegration` off, `webviewTag` off, `@electron/remote` absent — and all four are pinned by the guard test. |
| Preload surface | Two preloads. The Schedules window's (`preload/schedule.ts`) re-posts the private `MessagePort` main hands it into the page, imports only `electron`, and since phase 4 (2026-09-25) exposes exactly two calls as `window.sgvueSchedule` — `saveExport({kind, suggestedName, bytes})` → `{saved}` and `openScheduleFile()` → `{text}` or `null` — neither of which takes a path; its keys are snapshot-tested too, and the main window's preload names neither channel. The main window's is one object, `window.sgvue`. Its key names are snapshot-tested, so widening the bridge is a deliberate, reviewed change. Twenty-six keys: 2026-10-01's `checkUpdate` (nothing in; `{ latest }` or `null` out) and `openUpdatePage` (nothing in, nothing out — main builds the URL it opens), 2026-09-25's `openSchedules` (no payload in, nothing out), and the other twenty-three: `platform`, `versions`, `onGpuGuardTripped`, `openDialog`, `admitPaths`, `pathForFile`, `fileUrl`, `confirmReplace` (2026-09-24: a file name in, yes or no out), `saveSession`, `clearSession`, `listRecents`, `addRecent`, `onDeepLink`, and Phase 9a's `aiTurn`, `aiAbort`, `onAiEvent`, `onAiToolExec`, `aiToolResult`, `getSettings`, `setSettings`, `setApiKey`, `clearApiKey`, `onOpenSettings`. None of them can reach a path the user did not choose; the four `on*` keys are one-way, main → renderer; `setApiKey` is **write-only** and there is no getter anywhere for the stored key. The preload imports **channel names only**, never the zod schemas: it is sandboxed, so a `require("zod")` there takes the whole bridge down silently. |
| GPU memory | The Electron **GPU helper process** is watched from the main process (`src/main/gpu-guard.ts`): `phys_footprint` every second, plus the system memory-pressure level. Over the limit, or at pressure "warning", the renderer is told to stop drawing and dispose the viewer; still over three seconds later, `forcefullyCrashRenderer()`. A blank window the user can reload is a better outcome than a kernel panic. The limit is `max(3 072 MB, 40 % of os.totalmem())`, decided once at startup by the pure `gpuLimitMB()` — 3 277 MB on an 8 GB machine, 9 830 MB on a 24 GB one. A *legitimate* peak scales with the file (2 242–2 353 MB on the 137.9 MB model, against a 200 MB design target), so a fixed 3 072 MB would have crashed the viewer on a model the app is meant to open; a runaway does not creep, it climbs by gigabytes per second (634 → 5 461 MB inside one 0.5 s poll, measured), so it is still caught within a poll or two at the wider limit. The dev-script guard (`scripts/lib/electron-guard.cjs`) keeps its tighter fixed defaults — a bounded run may fail loudly, a user's session may not. |
| Content Security Policy | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' sgvue-file: blob:; object-src 'none'; base-uri 'none'` — set as a meta tag in the renderer HTML. In development the same policy is relaxed only to allow the dev server's inline bootstrap script and its hot-reload websocket. |
| Permissions | Every permission request — camera, microphone, location, notifications — is denied. A viewer needs none. **That includes the clipboard** (measured 2026-10-02, Electron 44.3.0 / Chromium 152): `navigator.clipboard.writeText` is refused always, with or without a click, so a page script cannot write the clipboard through it at all. A copy lands only through `document.execCommand('copy')` on a selected field, which Chromium allows only while the page holds a user's activation — a click or a key press in the last five seconds. The copy controls go through one helper that says whether it copied (`renderer/clipboard.ts`): "copy link to this state", the property card's Copy and the Schedules window's Copy GUIDs — and each flashes its confirmation only when it did; until then the first two flashed over an untouched clipboard. The chat table's `copy csv` called the refused API directly (the design's own line, `SGVue.dc.html:2029`) and copied nothing; since phase 4 of the same day it goes through the same helper from the user's click (`copyTable`). It has no flash, as designed, and a copy that did not reach the clipboard is said in the panel's status line. Measured in the built app: a real click leaves exactly the table's CSV on the clipboard; the same button clicked by nobody leaves the clipboard as it was. |
| The consent gate | **The assistant cannot, by itself, open or unload a file, delete anything of the user's, write the clipboard or move the base point** (2026-10-02, owner-approved; since 2026-10-08 nobody can move the base point — the Coordinate-system card is read-only). The threat is prompt injection: an IFC file's own text — a name, a property value, an object type in the cached vocabulary — reaches the model, and the per-reply revert cannot put any of those back. So each is a *request*: the chat's pending row, the sidebar's unload strip or the native Open dialog shows what is asked, and only the user's click performs it (§8.7). What that rests on: **(1)** the code that performs each is in the store and the model layer and is not named anywhere under `renderer/ai/`, where tools run — held by the guard test, by identifier, together with the general doors (`applySession`, `setState`, the settings and key calls) and the keys a tool may hand the store's `up`; a held patch is cut down to six visibility keys when it is applied; **(2)** `applyPending` has one caller in the app, the row's Apply button; **(3)** one request a turn, taken once, never re-armed, never made for a turn that is no longer live, and dropped when its reply is reverted; **(4)** a request is fixed to record ids when it is asked, and a stale one does nothing; **(5)** no tool input can carry a path, and no result or label carries a path or the link; **(6)** the gated calls are a pinned list of thirteen (since 2026-10-08; fourteen before), three of which may raise a native dialog (phase 4 added the Schedules window's delete, print and open-file, each raised by that window's own control after it has answered — the first two in that window's own confirm, which for the assistant takes no default button, so that no key press already under way answers it; the print dialog itself opens only on the user's click there). The browser's own rule is **not** one of them — a tool call that arrived within five seconds of the user's Enter would be allowed to copy — which is why a copy needs the Apply click and not merely an activation. The Schedules port's `act` has no such gate and is never used by the assistant: the rows of a schedule are resolved to ids in the main renderer and acted on through the store (`schedule: true`), and the guard test pins the message types the main window posts. Not changed by any of this, phase 4 included: no IPC channel, no preload key, no permission. |
| File access | `sgvue-file://` is registered as a privileged scheme before startup and serves **single-use tokens**; there is no general file-read bridge. A path becomes mintable only by being *admitted* — chosen through the native dialog, dropped on the window, or named by the recents list, the stored session or a share link — and admission applies `realpath`, an extension check, a regular-file check and the 600 MB cap. (2026-10-02: a recent file the assistant asked for is admitted by **the user's Apply**, and only then — the request holds the path the app's own list gave it, `openRecent` reads main's recents again at the click and opens nothing that is no longer on it, and the path then goes through `file:admit` exactly as a Recent pill's does. The assistant supplies a name to be matched; no path of its making is ever admitted. The Open dialog it can ask for is the same `file:open` the `upload` control calls.) Minting issues a UUID bound to that real path; the first fetch spends it and every later one is a bare **403**. The handler re-runs all four checks at fetch time, because a symlink can be repointed between admission and fetch, and a token older than five minutes is refused. Nothing is ever buffered in main: the bytes leave through `net.fetch` on a `file://` URL. |
| IPC allow-list | Exactly twenty channels. 2026-10-01 adds two for the landing page's update notice, both with no payload and both answered **for the main window's `webContents` only**: `update:check` → `{ latest }` or `null` (main asks GitHub for the newest version number at most once per run, and never in a development build — `src/main/updates.ts`), and `update:open`, on which main opens the product site in the browser from its own constant and version — the renderer never supplies a URL. Phase 4 of the Schedules port (2026-09-25) adds `export:save` (`{kind, suggestedName, bytes}`: a kind enum, a name with no path or Windows-illegal character, at most 50 MB of bytes) and `scheduleFile:open` (no payload), both answered **for the Schedules window's `webContents` only** and refused for any other sender before the payload is read; 2026-09-25 also added `schedules:open` (no payload, accepted from the main window only); `schedule:port` is a main → renderer post carrying a `MessagePort`, and the Schedules window's traffic then runs renderer to renderer over it, never through main. The fifteen before it are enumerated in `src/shared/ipc-channels.ts` as `IPC_CHANNELS`: `file:open`, `file:admit`, `file:token`, `file:confirmReplace`, `session:save`, `session:clear`, `recents:list`, `recents:add`, `ai:turn:start`, `ai:turn:abort`, `ai:tool:result`, `settings:get`, `settings:set`, `settings:setKey` and `settings:clearKey` (`link:open`, `ai:event`, `ai:tool:exec` and `settings:open` are main → renderer sends, which need no handler). `tests/readonly-guard.test.ts` holds that list equal to the channels main registers. Anything else has no handler at all. Every request is validated in **main** with its zod schema from `src/shared/ipc-contract.ts` — the preload imports channel names and types only, never zod — because the preload runs in the renderer's process. The session payload crosses as opaque JSON — main neither inspects nor acts on it — bounded by size rather than by shape. |
| Schedules port | What crosses the private `MessagePort` between the main window and Schedules (`src/schedule/messages.ts`), each message validated with zod **in the renderer that receives it**; main creates the pair and sees none of it. Main window → Schedules: `store` (the snapshot, on connect and on every federation or model-name change), `theme`, `selection {ids, quiet}` (the main selection, at most one post a frame), `vis {hidden, total, storeysClean, allShown}` (what the row menu enables) and `colours {live, key, entries}` (the colour-by map, each colour a `#rrggbb` hex before it may reach a `style` attribute). Schedules → main window: `select {ids, zoom}`, `act {kind, ids}` with `kind` one of `select`, `zoom`, `isolate`, `hide`, `show`, `showAll` — the main right-click menu's own store actions, on its undo stack — `colourBy {label, key, groups}` (at most 100 values, `MAX_COLOUR_GROUPS`, as `colours` carries) and `clearColours`. Since 2026-09-28 a schedule definition crosses both ways for the assistant — `define {kind, def}` to Schedules (`kind` `made` or `edited`, which picks its toast) and `current {def, rowCount}` back (the schedule on screen, or a `null` def, with the rows its table shows, at most one post per 250 ms — the assistant's per-turn view state is built from it alone) — each bounded by `DefShape` (every field reference one of the engine's three kinds, at most 200 columns, 8 filters and 4 sort levels, 200 000 characters in all) and then read by `parseScheduleDef` on the receiving side before anything uses it. Also since 2026-09-28, for `export_schedule`: `export {n, format}` to Schedules — a request number and one of the Export menu's four entries, and no other key — which runs that menu's own action, and `exportAck {n, refused}` back at once (`refused` null, or the menu's reason: `busy`, `no_schedule`, `nothing_saved`); nothing about the file ever crosses. `color_by_schedule_column` is applied through the same function as `colourBy`. Since 2026-10-02, for `manage_schedules`: `manage {n, at, op, name?, to?, ask}` to Schedules — `.strict()`: one of twelve operations (`undo`, `redo`, `templates`, `apply_template`, `saved_list`, `load`, `save`, `rename`, `duplicate`, `delete`, `print`, `open_file`), a request number, when it was asked, at most two names and whether that window may raise a question of its own for it, and no other key — which runs that window's own handler for the control (`schedule-ui/actions.ts`); and `manageAck {n, result, …}` back at once — `.strict()`: one of nine results (`done`, `asked`, `held`, `nothing`, `missing`, `taken`, `failed`, `busy`, `no_schedule`) and, per operation, a name, the undo and redo depths, or one of two lists, at most 60 templates or 100 saved setups with at most 12 classes each. A name crosses in either direction only as `SafeName` — at most 200 characters, no control character and none of Unicode's direction or width marks; a saved setup with any other name is counted and not sent. The main window waits 3 s for the answer, one request at a time; the Schedules window drops a request older than 2 s, so one held up behind its print dialog does nothing for a turn that gave up. Deleting, printing and opening a file are answered `asked` and only then raised, in that window, where the user's click decides; nothing of the choice crosses back. **The assistant causes no `act`.** Every id is admitted against the federation first: a list longer than it is ignored whole, duplicates and unknown ids are dropped, and an `act` left with none is refused. No message writes anything to disk; `Copy GUIDs` writes the clipboard. |
| External links | Any attempt by a page to open a window is denied (main alone opens Schedules); `http(s)` links are handed to the operating system browser instead. |
| Deep links | `sgvue://` is registered only in a packaged build, so a development run cannot hijack the scheme. |
| API key | Encrypted with Electron `safeStorage` (Keychain on macOS, DPAPI on Windows) and stored as ciphertext in `userData/settings.json`. Read by exactly one module in main. Never returned to the renderer — `hasKey: boolean` is all it learns. |
| IPC | Typed and schema-validated in both directions, with an explicit allow-list of channels. |

> **Status: Phase 9a.** Everything in this table is implemented and verified, API-key storage
> included. The `sgvue-file://` handler and the IPC allow-list landed in Phase 8 and
> are covered by `tests/unit/file-protocol.test.ts` (sixteen cases: admission, symlink
> resolution, the extension, size and regular-file gates, single use, an unminted token, a
> malformed URL, a file deleted between minting and fetching) and by the Electron smoke test,
> which fetches a bogus token from the **real** renderer under the **production** CSP and gets a
> 403.
>
> One development-only seam exists and is gated by `app.isPackaged`: with `SGVUE_OPEN_PATHS`
> set, `file:open` answers with those paths instead of showing the native dialog, because a
> native dialog cannot be driven by an automated test. It is absent from any packaged build,
> and it grants nothing the dialog would not — the paths still go through `admit`.
>
> **The consent gate (2026-10-02)** is covered by `tests/unit/ai-parity-3.test.ts` (every gated
> call leaves the store exactly as it was; Apply performs it once; Cancel performs nothing; a
> second request in a turn is refused; no label or result holds a path), by four cases of the
> guard test (the pinned lists and the forbidden identifiers), and by
> `tests/e2e/consent-gate.spec.ts` in the built app: the clipboard — the designed control copies,
> the same click made by nobody copies nothing and claims nothing, and a link the assistant asked
> for reaches the clipboard on the user's Apply and not before; a recent file loads on Apply and
> an unload on the sidebar's `delete`; and the Open dialog, answered from `SGVUE_OPEN_PATHS`,
> tells the tool nothing of the pick.
>
> **Phase 4 (2026-10-02)** is covered by `tests/unit/ai-parity-4.test.ts` (a stale view call
> changes nothing; `schedule: true` through the store and its guard;
> `manage_schedules` over a recording port; placing by box and by point; a reply's revert
> taking away what that reply placed, and nothing else), `tests/unit/ai-parity-4-bound.test.ts`
> (a schedule of more than 2 000 rows acted on whole),
> `tests/unit/schedule/manage.test.ts` (the two port messages field by field; the shared
> handlers; that nothing is deleted, printed or opened before the user's click in that window),
> `tests/unit/schedule/dialog.test.ts` (a question raised for the assistant takes no default
> button: neither Enter nor Space answers it),
> two more cases of the guard test, and in the built app by `tests/e2e/schedules.spec.ts` (that
> window's controls over the real port, its dialog raised under the assistant's name, left up
> by Enter and Space and answered by a click; printing only after its `Print…`),
> `tests/e2e/assistant-markups.spec.ts` (a placed spot and measurement in
> the overlay, the action bar and the Markups card, and a reply's `revert` removing the spot it
> placed while one placed by hand stays) and `tests/e2e/consent-gate.spec.ts`'s
> `copy csv` test (the real clipboard).
>
> The production CSP was verified in a packaged-mode run with a clean console, and the smoke
> test asserts the meta tag byte for byte against the constant in `electron.vite.config.ts`.
>
> **Why the GPU row exists.** On 2026-09-17 this Mac kernel-panicked three times — `watchdog
> timeout: no checkins from watchdogd`, memory compressor at 100 % — while a development
> window rendered the 137.9 MB reference model. Every panic report's `processByPid` names the
> Electron GPU helper at ~168–170 GB, with the renderer at ~1.4 GB. The cause was one
> driver-level draw per `BatchedMesh` instance (§7); the renderer no longer draws that way, and
> this guard is what makes a future regression a reloadable window rather than a lost machine.
>
> **The metric matters as much as the limit.** `app.getAppMetrics().memory.workingSetSize` —
> the number every earlier benchmark sampled — is **blind** to this memory: measured at the
> instant one run's GPU process went from 634 MB to 5 461 MB, it still read 106 MB. Only
> `phys_footprint` (`/usr/bin/footprint -p <pid>`, the same field the panic report uses) and
> `kern.memorystatus_vm_pressure_level` see it. Both guards read those two and nothing else on
> macOS; on other platforms they fall back to `getAppMetrics`, which is accurate there.
>
> Development runs are bounded separately and more tightly: `scripts/safe-run.cjs` is the only
> sanctioned way to start Electron in this repository, it refuses to start a second one, and
> the guard inside every run (`scripts/lib/electron-guard.cjs`) samples every 250 ms and exits
> the process group over 2 500 MB GPU, 6 000 MB renderer, memory pressure, or 25 seconds.

---

## 11. Build, test and packaging

**Commands**

| Command | What it does |
|---|---|
| ~~`npm run dev`~~ | **Suspended.** It starts an unguarded Electron window, which kernel-panicked the development Mac three times on 2026-09-17 (§10). Use the guarded scripts below. |
| `npm run build` | Type-checks the Node and web projects, then builds main, preload and renderer into `out/`. The renderer is minified |
| `npm run preview` | Runs the built app without the dev server |
| `npm run typecheck` | Type-checks the Node side and the web side |
| `npm test` | Unit and guard tests (vitest) — 2 773 tests in 142 files at 1.2.0 (2026-10-02; two more files and three more tests skip without a real model in `samples/`). The count grows with every change: `PROGRESS.md`'s newest entry has the current one |
| `npm run test:e2e` | The Electron suite through `scripts/safe-e2e.cjs`: the smoke tests, the keyboard/ARIA walk and the packaged tests, all guarded. On Windows too, on the instruments Windows has |
| `npm run test:packaged` | The **packaged** tree through `scripts/safe-app.cjs` — `dist/mac-arm64/SGVue.app` on macOS, `dist/win-unpacked` on Windows — which watches `SGVue Helper (…)` the way the other guards watch a dev Electron. Neither wrapper ever signals an SGVue that was already running, or anything later from its `.app` bundle (on Windows, its directory): a run may kill only what it started |
| `npm run dist:mac` | `dist/SGVue-<version>-arm64.dmg` and `dist/SGVue-<version>-x64.dmg`, ad-hoc signed and not notarised (§3) — `<version>` is `package.json`'s, which `electron-builder.yml` builds the name from |
| `npm run dist:win` | `dist/SGVue-<version>-setup.exe` (NSIS, x64), unsigned |
| `node scripts/safe-run.cjs <script>` | The only sanctioned way to start a development Electron: one at a time, bounded in GPU `phys_footprint` and wall clock, with any survivor killed and reported. On Windows the enumeration and the kill are PowerShell and `taskkill /T /F`, and the bound is working set rather than `phys_footprint` |
| `node scripts/safe-run.cjs frame-triggers.cjs` | Drives thirty-six classes of change (at 1.2.0, 2026-10-02; the script's last line prints the count) with the camera at rest and proves the compositor's pixels moved for each, that a still scene is not re-rendered while the status bar still reports a frame rate, that the assistant's thinking trace animates without the scene drawing a frame, and that a wheel gesture does not hover |
| `SGVUE_IFC=… node scripts/safe-run.cjs pick-parity.cjs` | The accelerated picker against the flat scan on a real model: the 78 real bubble rays at three camera poses and 2 000 random ones, compared by element id and distance |
| `SGVUE_IFC=… node scripts/safe-run.cjs profile-frame.cjs` | Where a frame's time goes, one condition at a time (`SGVUE_PHASE=frames\|latency\|probe\|landing`) |
| `python3 scripts/make-icons.py` | Redraws `build/icon.icns`, `icon.ico` and `icon.png` from the design's own brand mark |

**Test layers**

1. **Design parity** — side-by-side screenshots, prototype versus app, on the same mock
   federation at the same size and state, reviewed every phase. Phase 10 re-captures two
   earlier states to prove its accessibility and shadow changes moved nothing
   (`tests/parity/phase10/README.md`).
2. **Unit tests (vitest, Node)** — attribute reading, rule evaluation, colour precedence,
   federation maths, units, filter stack, undo, formatting, session encoding, the SQL gate,
   tool schemas, prompt assembly, the tree's keyboard reducer, the context-menu clamp, the
   read-only guard and the preload snapshot.
3. **IFC conformance fixtures** — real files in `samples/`, with `expected.json` generated
   independently by IfcOpenShell.
4. **Benchmark** — a 137.9 MB, 26 761-element model: parse time, frame rate, hover cost and
   the GPU helper's `phys_footprint`, measured before and after every renderer change.
5. **End-to-end (Playwright `_electron`)** — the built app on `tests/fixtures/tiny.ifc`:
   landing, upload pipeline, session resume, share links, Preferences, the assistant panel, a
   keyboard walk through the tree, the context menu and the dialogs, and the **packaged** app
   opened from a `sgvue://` share link.

**Packaging.** electron-builder 26; macOS `.dmg` for arm64 and x64, Windows NSIS for x64;
`asarUnpack` of every `.wasm`, since web-ifc and sql.js both instantiate from a URL and a file
inside an archive has none. The packaged test asserts that from both sides: the two files exist
under `app.asar.unpacked`, and the archive's own index marks them `unpacked` with no offset.
Icons come from the design's brand mark (`scripts/make-icons.py`).

**Owed before launch**

- **Code signing and notarisation on macOS**, and a signed Windows installer. Since 2026-10-05
  the macOS build is ad-hoc signed (`mac.identity: '-'`, §3), which lets a download open after
  one **Open Anyway**, but it is not signed with a Developer ID or notarised; the Windows
  installer is unsigned.
- **Electron's and Chromium's licence files in the macOS build — to be confirmed on the first
  `dist:mac`.** On Windows `LICENSE.electron.txt` and `LICENSES.chromium.html` sit beside
  `SGVue.exe`; on macOS electron-builder deletes both from the app's output (`app-builder-lib`,
  `out/electron/electronMac.js:219–220`), so since 2026-10-05 a mac-only `extraResources` in
  `electron-builder.yml` copies them from the installed Electron (`node_modules/electron/dist/`)
  into `SGVue.app/Contents/Resources/`, under the same two names, and `THIRD_PARTY_NOTICES.md`
  says they are there. No macOS build was made to look: that both files are in
  `SGVue.app/Contents/Resources/` is checked on the first `dist:mac` from the release workflow
  (`docs/RELEASING.md`).
- ~~**The licence and the third-party notices.**~~ **Done 2026-10-05:** open source under the
  Apache License 2.0 — `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`, generated by
  `scripts/third-party-notices.cjs` from the installed tree and the recorded data beside it and
  held to it by `npm test` — and all three ship in every installer's resources folder
  (`extraResources`; measured in `dist/win-unpacked/resources/`, byte-identical).
- **The Windows build tested on a real device.** `dist:win` produces the installer on macOS —
  including the executable's icon and version resources, which needed no wine — but nothing
  here can run it. **Partly settled 2026-09-21:** on a Windows 11 machine this tree installs,
  builds and packages, `dist:win` writes its installer there too, the packaged app passes
  everything `tests/e2e/packaged.spec.ts` asserts on macOS, and the installer's payload is
  byte-identical to the tree that was tested — 76 files, all 76 SHA-256-equal to
  `dist/win-unpacked`. **All seven findings from that run are now fixed.** Six went the same
  day — `npm test`'s timer race, the path-spelling refusal, the two single-instance defects and
  the three small ones — and the probe that scored 41/1 now scores **42/0**; **finding 1 went on
  2026-09-21 as well**: the three guard wrappers run on Windows, on the instruments Windows has
  (working set per process and summed, the GPU dedicated-memory performance counter, no
  pressure term), and `tests/e2e/packaged.spec.ts` and `tests/unit/asar-contents.test.ts` read
  this platform's packaged tree, so on Windows they test `dist/win-unpacked` instead of
  skipping. Measured there: `npm test` 62 files / 1 042 tests, `npm run test:e2e` 13 passed and
  3 skipped, `npm run test:packaged` 1 passed and 2 skipped, and a forced trip killing every
  process it started and exiting 2. Still owed: running the installer and the uninstaller on a
  device; and a real model on Windows.
- ~~**Real URLs for the footer's Privacy, Terms and Support links, and a support email.**~~
  **Settled 2026-09-21:** the links no longer exist. The footer strip was removed at the user's
  request (*"remove footer. Not valid for desktop app."*, §2's deviation table), so there is
  nothing left to point anywhere and no URLs are owed. A support email is likewise not owed:
  there was no surface asking for one once the three links went, and adding one would be a new
  control the design does not have.
- **WebGPU, reconsidered with real measurements.** On the 590-part mock the two backends are
  indistinguishable (120 fps both, 1 007 MB against 1 037 MB of GPU footprint), so that
  measurement settles nothing; the case that matters is a real model, and a real model on
  WebGPU is what panicked the development Mac twice. `auto` stays WebGL2.
- **The assistant's acceptance prompts against the real API.** `scripts/ai-acceptance.cjs`
  exists and is key-gated; it has never been run here, because this repository never asks for
  or stores a key.
- Optional: the IFC-SG audit pack from the earlier Aquila corpus.

> **Status: Phase 10 — all ten phases built.** `typecheck`, `test` (832 tests across 58 files),
> `build`, `test:e2e` (14 tests, 2 skipped without a real model) and `test:packaged` all pass,
> and every installer above has been produced from this tree. The installers in `dist/` predate
> the 2026-09-19 frame-budget work and have not been rebuilt for it.
> **2026-10-02, version 1.2.0 (Windows 11):** `typecheck`, `test` (2 773 tests in 142 files; 3
> tests and 2 files more skip without a real model), `build`, `test:e2e` (62 passed, 6 skipped,
> as two guarded runs) and `test:packaged` (1 passed, 2 skipped) all pass, and `dist:win` wrote
> `dist/SGVue-1.2.0-setup.exe` from this tree (§3). No macOS build was made. `test` passed in
> twelve of fourteen runs that day; the two that did not failed in `settings.test.ts` on an
> `EPERM` from `renameSync` while the machine was busy in its temp directory (`PROGRESS.md`
> under that date).
