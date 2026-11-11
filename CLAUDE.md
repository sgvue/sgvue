> **What this file is:** the working notes SGVue is built from with AI coding agents — loaded into every agent session: the fidelity contract, the rules, and an index of every decision and trap.
> **Human contributors start at [`CONTRIBUTING.md`](CONTRIBUTING.md).**

# SGVue Desktop — working notes

A read-only IFC model viewer for BIM coordination review, shipped as an Electron desktop app
for macOS and Windows. It loads real IFC files with web-ifc, renders them with three.js, and
answers questions about them through an AI assistant that can look but never touch.

**Read `docs/SYSTEM_SPEC.md` for what the app is.** This file is how we build it.

This file is loaded into every session, so it is kept short. The complete list of allowed
desktop deviations is **`docs/DEVIATIONS.md`**, every decision one line each is
**`docs/DECISIONS-INDEX.md`**, the reasoning and the measurements behind each decision are in
**`docs/DECISIONS.md`**, the parser and renderer traps in **`docs/TRAPS.md`**, and the
dev-utility commands in **`docs/COMMANDS.md`**. Nothing was dropped when they moved — the full
previous text is in git history at `cdd8256:CLAUDE.md` (and, before that, `814f155:CLAUDE.md`).

## Goal
- **Outcome:** a read-only IFC viewer for BIM coordination review, as a desktop app for Mac and Windows. It never edits the model.
- **For whom:** BIM coordinators reviewing models; publicly released (open source, Apache-2.0, installers on `sgvue/releases`).
- **Done when:** code signing and notarisation are done (`docs/SYSTEM_SPEC.md` §11), with end-to-end tests passing on Mac and Windows.

---

## Fidelity contract

The design is finished. We are porting it, not interpreting it.

**Specification of record for everything visible:** `design-reference/design/SGVue.dc.html`
(markup, tokens, spacing, radii, type scale, motion, copy, shortcuts, context menu, cards and
their order, chat panel, landing page, footer, status bar) and
`design-reference/design/viewer-core.js` (scene look: palette, lights, shadows, edges, fades,
camera easing, view cube, snapping markers, dimension labels, grid bubbles, level tags).
`design-reference/BUILD_PLAN.md` §5 gives the token values and §6 the pitfalls.

1. **Port, don't redesign.** Markup is translated from the design's template syntax to JSX one
   element at a time, keeping structure, class names, `data-role`s, copy and `data-tip` texts
   verbatim. The `<style>` block is copied as-is. The logic class is ported method by method
   into store slices and hooks, keeping names and semantics.
2. **Same behaviour, same numbers.** 220 ms crossfade · 16/11 px snap radii · 5 % scope guard ·
   cap 50 undo · cap 12 filter sets · 500 ms stagger · 1100 ms ready hold · 26 s grid drift ·
   148 px cube · 332 px right lane · z-order 14/13/12/6. Every one of them is kept.
3. **Internal implementation may differ only where it is invisible** — batched drawing, a
   scissor-viewport cube, worker parsing. The visible result must be identical.
4. **Design parity harness.** A dev-only adapter feeds the design's own `sample-model.js`
   federation through the app's contract, so we render the same mock the prototype does. Every
   Build Report carries side-by-side screenshots at the same size and state. Differences are
   defects.

### Allowed desktop deviations

Anything not on the list is a defect. **The complete list of record is `docs/DEVIATIONS.md` —
read it before changing anything visible.** One line per entry here, in its order:

- Undated: native Open and drop, `sgvue://` link, Preferences dialog, real-file Recent, self-hosted fonts
- 2026-09-20 — the Coordinate-system caption names the georeferencing method (amended 2026-10-08, 2026-11-07)
- 2026-09-20 — a grid bubble that would overprint its neighbour is hidden until the view zooms in
- 2026-09-20 — above six storeys the element tree keeps 40 % of the sidebar (amended 2026-11-07)
- 2026-09-20 — the Filter card's operator control gains one entry, `empty`
- 2026-09-21 — the landing page's footer strip is gone; its theme toggle stays
- 2026-09-24 — no Resume card, pills read "Recent", the landing fades out, a new pick replaces a load
- 2026-09-24 — Help › About tells a short story
- 2026-09-24 — the landing page shows the app version
- 2026-09-24 — sidebar sections resize in height (amended 2026-11-07: the STOREYS handle only)
- 2026-09-24 — the Ask suggestions take one line and fold once the conversation starts
- 2026-09-24 — a gridline runs on to its bubbles
- 2026-09-24 — dimensions between adjacent parallel gridlines
- 2026-09-24 — the ground is see-through from above (amended 2026-10-08)
- 2026-09-24 — the camera frames the building, not the site
- 2026-09-24 — grid bubbles sit at the grids' own extent (amended 2026-11-07)
- 2026-09-24 — a toolbar button toggles the canvas grid (off at start since 2026-11-07)
- 2026-09-24 — "Original materials" off colours each element by its IFC class
- 2026-09-24 — a double-click renames a saved viewpoint
- 2026-09-24 — the landing page offers the design's demo building
- 2026-09-24 — `IfcSpace` is see-through by default
- 2026-09-25 — Help › Check for updates… opens the product site in the browser
- 2026-09-25 — the Schedules window and its one toolbar button (amended up to 2026-11-08, 1.5.0)
- 2026-09-25 — on Windows the app draws on NVIDIA when present; a Preferences switch; About names it
- 2026-09-28 — a spot tag shows its level until clicked; the snap prefers the surface looked at
- 2026-09-28 — a section outlines what it cuts, 2.5 px wide (model colours since 2026-11-07)
- 2026-10-01 — undo, redo and markup counts are an action bar; the stage's bottom edge is one row
- 2026-10-01 — the toolbar is five groups with dividers; Schedules stands alone, last
- 2026-10-01 — the property card's clipped texts carry their full text as a hover title
- 2026-10-01 — the element tree is eye-first, like STOREYS and MODELS
- 2026-10-01 — a model's file path is its hover title (amended 2026-11-08: the whole row)
- 2026-10-01 — the landing page shows an update notice; one GitHub check at every start
- 2026-10-01 — two section cuts at once, gridline and level, each with its own controls, and Clear all
- 2026-10-01 — the assistant is Vee, with a 16 × 16 pixel mascot
- 2026-10-01 — Vee's thinking trace, the stop button, and `You` on the left
- 2026-10-02 — a reply's `revert` puts back everything that reply changed
- 2026-10-02 — the chat's pending row also confirms requests that reach outside the view
- 2026-10-08 — with the canvas grid off, the ground veil is not drawn
- 2026-10-08 — the Coordinate-system card's one-line note (amended 2026-11-07)
- 2026-10-08 — the Coordinate-system card is read-only
- 2026-10-08 — a laser measurement reads each side of its point
- 2026-10-08 — Vee's replies are laid out in paragraphs, lists and tables
- 2026-10-09 — the boot model's own unit at start, `ft` added, every readout follows the unit
- 2026-10-09 — a file refused for its size is told to split the model
- 2026-10-09 — a landing-page georeferencing line (removed 2026-11-07)
- 2026-11-07 — the IFC gridlines and the canvas grid are off at start
- 2026-11-07 — Ask Vee is a child window above the SGVue window
- 2026-11-07 — MODELS folds behind its header and, expanded, shows in full
- 2026-11-07 — each model's section-cut outline takes its MODELS row's colour
- 2026-11-07 — models line up origin to origin; only the camera turns to square the grids
- 2026-11-07 — File › Open / Save Project; the title marks unsaved changes; closing asks (amended 2026-11-08)
- 2026-11-08 — the sidebar's `library` popover is gone; the path title is on the whole MODELS row
- 2026-11-08 — the Ask Vee window is a messaging conversation (amended 2026-11-09)
- 2026-11-11 — right-click "similar · …" goes by the type's name; absent with no type and no ObjectType
- 2026-11-11 — an empty identity tile shows the em dash
- 2026-11-11 — the Spatial-structure card's site line names the file's own CRS
- 2026-11-12 — a federating indicator: a line along the stage's top edge and a caption in the bottom row

### No visible additions

Provenance (which entity a value came from, georeferencing source, SHA-256) is exposed only
through the assistant's tools and the exports — never as new UI. Inputs the design already has
(e.g. the Coordinate-system card, read-only since 2026-10-08) are pre-filled from the file when
the data exists and left blank when it does not. **Never a placeholder.**

The chat's pending row is such an input too. Since 2026-10-02 it also confirms a request that
is not a visibility change — a deletion, a copy, a recent file (and, until 2026-10-08, the base
point) — the allowed deviation of that date. The same row and the same two buttons: **no new
element.**

---

## Decisions

**Every decision, one line each, is in `docs/DECISIONS-INDEX.md`; the alternatives, the
reasoning and the measurements are in `docs/DECISIONS.md`.** Here: the stack, and the standing
constraints an ordinary task could break.

**The stack.**

- **Desktop shell** — Electron 44, bundled Chromium. Node is installed, Rust is not.
- **Build tooling** — electron-vite 5 + Vite 7 + TypeScript 5.9; one config for main, preload and renderer.
- **UI** — React 19 + Zustand 5; the renderer module is plain TypeScript.
- **3D** — three 0.186.0 (`three/webgpu` + `three/tsl`), WebGL2 by default, merged geometry per slot.
- **IFC parser** — web-ifc 0.0.77 in a Web Worker behind a read-only adapter; IfcOpenShell is ground truth in tests.
- **File access** — `sgvue-file://` read-only protocol with single-use tokens; the parser reads a Blob in chunks.
- **Power query for AI** — sql.js 1.15 in its own worker, `PRAGMA query_only`, SELECT-only gate, 10 s cap.
- **AI** — `@anthropic-ai/sdk` 0.137 in main only, `claude-sonnet-5-5` (since 2026-11-09; `claude-opus-5` before, and a stored model is kept), effort `medium`, key in `safeStorage`.
- **Persistence** — JSON in `userData`, written by main: settings, sessions, recents.
- **Share link** — `sgvue://s=<base64url>`, a scheme the app registers.
- **Packaging** — electron-builder 26: `.dmg` arm64 + x64 (ad-hoc signed), NSIS `.exe` x64 (unsigned), `.wasm` unpacked.
- **Reuse** — parser, georeferencing and property modules ported from Marumi, Aquila and ifcgref.

**Standing constraints.**

- Merged geometry per slot, never a `BatchedMesh`: one driver draw per instance floods the GPU process.
- Anything that changes what is drawn calls `invalidate()` — the frame loop draws on demand; a run of setters goes through `viewer.batch`.
- `backend: 'auto'` is WebGL2; WebGPU is opt-in by name only. Electron starts only through the guarded scripts.
- Every scene constant is the reference's value × (radius / 27.5 m). Nothing is sized to one model.
- Parsing stays in the worker, and geometry is a second worker request after the tree and cards.
- The assistant's tools are one catalogue in `shared/`, each `kind: 'read' | 'view'`; a view tool calls the store action its control calls.
- Every tool runs in the renderer; main holds the SDK, the key and the transcript, and never model data.
- The API key is encrypted by the OS and has no getter anywhere; the renderer learns `hasKey` and nothing else.
- The preload imports channel names, never the zod schemas — importing zod there kills `window.sgvue` silently.
- Only four modules write to disk (`settings`, `sessions`, `exports`, `projects`); a fifth is a design change (Rules).
- A file path is admitted by a user act through main's `admit()` before a `sgvue-file://` token is minted; a token is single-use.
- What reaches outside the view or cannot be undone is only asked for; only the user's Apply runs `performGated` (`GATED_CALLS` pinned).
- One request a turn, of any kind; a view call for a turn that is no longer live is not run.
- A tool that wraps a toggle compares first and calls the control only when the state differs.
- Every assistant result is bounded and says when it cut (`truncated`, `AI_JSON_MAX_CHARS`); ids it cannot find are counted, never dropped.
- Everything new that can hide runs `scopeCheck` (the 5 % guard); a blank view is refused outright.
- Federation ids are composed only by `fedId` and decoded only by `slotOfId` / `localOfId`; never stride arithmetic elsewhere.
- Models are drawn origin to origin at their files' world coordinates; no georeferencing moves or turns a model.
- The plan rotation turns only the camera; nothing is saved from it, and no model or readout moves.
- Subtract a shared origin in Float64; never `COORDINATE_TO_ORIGIN: true` in a federation.
- ObjectType is the occurrence's own attribute; the type object's Name is `typeName` — never shown as ObjectType.
- PredefinedType keeps the code as written (`predefinedType`) apart from the effective type (`effectivePredefinedType`).
- A value the file does not carry shows the design's em dash. Never a placeholder.
- Inline styles are the design's declaration strings (`app/css.ts`); a new one names its deviation (`design-style-strings.test.ts`).
- Untrusted text reaches markup only through `esc` (`shared/html.ts`); `dangerouslySetInnerHTML` is a lint error.
- The trap list in `eslint.config.mjs` (`TRAPS`) is errors; an exception takes out one entry, with its reason.
- A switch over a union names every member; a promise is never dropped (`void` is the one fire-and-forget marker).
- A post to the main page goes through `mainContents()`; main names the main window with `mainWindow()`, never "the focused one".
- The window never leaves the app's own page; only main opens a second window.
- The SQL worker is `PRAGMA query_only` behind a SELECT-only gate with a 10 s cap.
- A sum that must not depend on load order sorts its contributions first; ladders are unioned in model-key order.
- The undo stacks are module state; every filter-stack operation is a pure function returning the next stack.
- Old links, sessions, viewpoints and schedule files keep restoring (`tests/fixtures/compat/`); a format change adds a folder.
- `design-reference/` is pinned by SHA-256; the pin changes only with an owner's new handoff, in the same commit.
- Public commits are `Yong Yen <releases@sgvue.invalid>`; `npm run privacy` passes before every push.
- `sgvue/releases` is never renamed, moved, made private or deleted; installed copies ask it for updates.
- Dependabot proposes no major version update; a toolchain major is a measured change.

A new decision is **one line in `docs/DECISIONS-INDEX.md` and a full row in
`docs/DECISIONS.md`**; it also gets a short line here only if it is a standing constraint. A new
deviation goes in `docs/DEVIATIONS.md`, with a pointer line here.

---

## Commands

| Command | What it does |
|---|---|
| ~~`npm run dev`~~ | **Suspended since 2026-09-17.** It starts an unguarded Electron window, which is how this Mac was kernel-panicked three times. Use `safe-run.cjs` below. |
| `npm run build` | Typecheck, then build into `out/` |
| `npm run typecheck` | `tsc --noEmit` for the node and web projects |
| `npm run lint` | ESLint over `src/**/*.{ts,tsx}` and `tests/**/*.{ts,tsx}` with type-aware parsing (`eslint.config.mjs`); runs in CI after typecheck |
| `npm test` | vitest (unit + read-only guard) |
| `npm run privacy` | The privacy search before every push (`scripts/privacy.cjs`; a CI step): e-mails, home paths, private names (by hash only) and real-coordinate bands over every tracked file; masked `file:line`, exit 1 on a finding |
| `npm run test:e2e` | Electron smoke test through `scripts/safe-e2e.cjs` (the guarded wrapper — **never** a bare `npx playwright test`). Runs on Windows too: same limits, working set + the GPU dedicated-memory counter instead of `phys_footprint` |
| `npm run dist:mac` / `dist:win` | Installers. `dist:mac` writes `dist/SGVue-<version>-arm64.dmg` and `dist/SGVue-<version>-x64.dmg`; `dist:win` writes `dist/SGVue-<version>-setup.exe` (`<version>` is `package.json`'s). The DMGs ad-hoc signed (since 2026-10-05), the installer unsigned. Before `dist:mac`, run `node node_modules/electron/install.js` — Electron 44.10.0 has no install script, and without its binary the Mac build lacks Electron's and Chromium's notice files |
| **`npm run test:packaged`** | The **packaged** app — `dist/mac-arm64/SGVue.app` on macOS, `dist/win-unpacked` on Windows — through `scripts/safe-app.cjs`: a share link, the production CSP, the unpacked `.wasm`, Preferences from the real menu. Skips when there is no `dist/`; the `.icns` test is macOS-only |
| **`node scripts/safe-app.cjs -- <executable> [args]`** | **The only sanctioned way to start a *packaged* SGVue.** Same limits as the other guards, matched on `/SGVue.app/Contents/` as well as `node_modules/electron/dist/`, and it kills every `SGVue Helper (…)` afterwards. On Windows it matches on the directory instead — `dist\win-unpacked\`, `node_modules\electron\dist\`, and the directory of a `-- <executable>.exe` so an installed copy is guarded too — reads working set plus the GPU dedicated-memory counter, and kills with `taskkill /T /F`. With no `--` it runs the packaged Playwright spec |
| **`node scripts/safe-run.cjs <script.cjs> [args]`** | **The only sanctioned way to start Electron here.** Refuses to start a second dev Electron, runs the target in the foreground under the memory guard, kills any survivor afterwards and says whether it had to — on Windows too, through PowerShell and `taskkill` rather than `/bin/ps` and `kill -9`. On both platforms a listing that could not be made refuses the run outright rather than start blind, and one at the end prints `COULD NOT LIST` rather than `clean:`. Limits: `SGVUE_MAX_GPU_MB` (2 500), `SGVUE_MAX_RENDERER_MB` (6 000), `SGVUE_MAX_SECONDS` (25) |

Everything else — the frame profiler, the pick-parity and frame-trigger checks, the benchmark,
the parity harnesses, the AI acceptance run, the fixture and icon generators, `npm run preview`
— is in **`docs/COMMANDS.md`**.

---

## Phase status

All ten phases are built: parser and federation, renderer, shell and sidebar, selection,
visibility and the filter stack, annotation, colour systems, landing and sessions, the
assistant, and the robustness / accessibility / performance / packaging pass. `PROGRESS.md`
is the history, and `docs/SYSTEM_SPEC.md` §11 is what is still owed before a public release.

---

## Ownership (trial, review on 2026-11-25)

This codebase is yours: what it's for and how it's built are your call, and you'll keep building on it.

- Applies to Build tasks only, not Fix or Ship.
- Tidy only inside files the task already touches. The fidelity contract above and the Rules below still win.
- Never change what the owner sees or how an existing feature behaves unless the task says so.
- List every extra change in the Build Report.
- Reviewer: tidying inside touched files is allowed. An unrequested change in what the owner sees or how a feature behaves is BLOCKING, and so is any extra change the Build Report did not list.
- Trial: if reviews flag unrequested behaviour changes more than twice before 2026-11-25, remove this section.

---

## Rules

- **Viewer only. Never write model data.** No IFC write path, no "save model", no tool that
  edits a name, property, classification or geometry. `src/shared/readonly-list.ts` holds the
  forbidden names and `tests/readonly-guard.test.ts` fails the build if one appears.
- **Only four modules may write to disk**: `src/main/settings.ts`, `src/main/sessions.ts`,
  `src/main/exports.ts` (since 2026-09-25, Schedules phase 4, owner-approved) — which writes only to
  a path the user picked in the native Save dialog in the same call — and, since 2026-11-07 (the
  `.sgvue` project file, plan D11, owner-approved), `src/main/projects.ts`, which writes only to a
  path the user picked in its Save dialog in the same call or to the project file this run opened
  or saved. The page never names that path and never asks for a write: main pulls the project and
  re-reads it with `readProject` before writing. No designed control of the main window produces
  a file (its panel's `copy csv` writes the clipboard); the Schedules window's Export menu does —
  and, since 2026-09-28, the assistant's `export_schedule` can open that menu's Save dialog, where
  only the user's Save writes. Adding a fifth writer is a design change, not a convenience.
- **Every implementation task goes to the `builder` agent**, one phase or half-phase per run,
  ending in a Build Report.
- **The reviewer commits**, after reviewing the report against the diff and against the design.
  The builder never commits.
- **The public repository, `sgvue/sgvue`, is the source of truth, and every push is public at
  once.** Commit only as the project's public commit identity, `Yong Yen
  <releases@sgvue.invalid>`. Before every push, run the privacy search over what is pushed: no
  personal account, e-mail address, home path or real project may appear, and the owner appears
  only as Yong Yen. Installers are still published on `sgvue/releases`.
- **`samples/` is git-ignored.** Real project models never enter the repository. So is
  **`tests/fixtures/*.expected.json`**: the IfcOpenShell ground truth is generated *from*
  those models and carries their metadata. Regenerate it with
  `python3 scripts/expected-from-ifcopenshell.py`; the fixture tests skip with a visible
  notice when either is missing.
- **Real project coordinates never enter the repository.** Tests and docs use the synthetic, whole-metre-shifted set
  (site `12345.457 / 23456.766 / 5.05`, rotation `−43.4103°`). Never paste a value read from `samples/` into a tracked file;
  the history was rewritten once for this on 2026-09-20 (`docs/DECISIONS.md` has the note).
- **`design-reference/` is read-only.** It is the specification; never edit it to match the code.
- **Never start Electron except through a guard**: `node scripts/safe-run.cjs` for a dev
  Electron, `npm run test:e2e` (`scripts/safe-e2e.cjs`) for Playwright, and
  `node scripts/safe-app.cjs` for the **packaged** app. Not `npm run dev`, not `npx electron …`,
  never in the background, never two at once. Three kernel panics on 2026-09-17 came from an
  unguarded dev window; the guard inside every run watches the GPU helper's `phys_footprint`
  every 250 ms and exits the process group the moment it is over budget. A guarded run kills
  only what it started, so a packaged SGVue the user already had open is left alone. If a guard
  trips: stop, record the numbers, change the code — do not re-run the same configuration.
  Confirm nothing survived afterwards
  (`ps -Ao pid=,comm= | grep node_modules/electron/dist/`; on Windows
  `powershell -NoProfile -Command "Get-Process -Name SGVue,electron -ErrorAction SilentlyContinue | Select Id,Path"`).
  **On Windows the three wrappers read working set and the GPU dedicated-memory counter, and
  there is no memory-pressure term** — `phys_footprint` does not exist there.

---

## Traps

One line each. **Read `docs/TRAPS.md` before touching `src/worker/` or
`src/renderer/viewer/`** — every one of these was a real defect, and each cost a day.

**Geometry and units**

- `flatTransformation` already applies the length unit and the Z-up → Y-up swap; doing either again shrinks the model.
- `rotation.x = -π/2` double-rotates and lays the building on its side. Same trap, second project.
- Always `.slice()` `GetVertexArray` / `GetIndexArray` — they are views into the WASM heap.
- `IfcSpace` is excluded from `StreamAllMeshes`; stream it with `StreamAllMeshesWithTypes`.
- A stream callback's `FlatMesh` has no `delete` in 0.0.77 — free `mesh.geometries`, one vector per product.
- Surface-style transparency is not in the placed colour's alpha; walk `IfcStyledItem` or every window is opaque.
- Never `COORDINATE_TO_ORIGIN: true` in a federation — it recentres each model and loses the offsets between them.
- Revit shared coordinates sit ~33 km out, where float32 resolves ~4 mm. Subtract a shared origin in Float64.
- Grid points need `placementMatrix()` applied by hand, and a grid axis is a segment, not a coordinate.
- A Revit "Shared Coordinates" export puts the true-north rotation and the elevation on `IfcSite.ObjectPlacement`, not `IfcMapConversion`; its other Coordinate Base options put the position in `IfcMapConversion` (with an EPSG code) or the context's `WorldCoordinateSystem`.
- `IfcMapConversion.Scale` is written absent, 0.001 or 1000 for the same mm model in a metre CRS — never apply it; E / N / H × the map unit.
- Take the `IfcMapConversion` on the 3D `Model` context (a sub-context counts, by its `ParentContext`), not the first one in the file.
- web-ifc 0.0.77 applies the context's `WorldCoordinateSystem` to nothing — and since 2026-11-07 neither does the app; such a file is drawn at its local origin and named by the card's note.
- A float sum is not order-free — sort contributions canonically before summing anything that must not depend on load order.
- A file can hold many `IfcSite`s — 16 on the reference model. Only the one `IfcProject` aggregates is the position.
- The federation offset's Z is the first placement's, not the datum — never read scene z = 0 as the ground.

**Properties**

- `getPropertySets(…, includeTypeProperties=true)` REPLACES rather than adds; fetch both and merge, occurrence wins.
- Use shallow `GetLine` with manual reference resolution — `GetLine(id, true)` throws on real Revit exports.
- Never index properties with a per-element `getPropertySets` loop: O(N×M), ~3.1 billion visits, a permanent freeze.
- Free `GetLineIDsWithType` vectors in a `finally`.
- `GetTypeCodeFromName` hashes anything; round-trip through `GetNameFromTypeCode` and treat unknown as absent.
- Numeric attributes have no own `value` key — `.value` is a prototype getter, and `name` is the measure type.
- A reference handle and an enumeration look alike; only `type === REF` separates a pointer from an authored value.
- `OpenModelFromCallback` does not read the file in order — hash forward independently, trimming overlaps.
- Storey `Elevation` is in the file's own length unit; read `IfcUnitAssignment` and convert.
- Never use `getSpatialStructure` — walk `IfcRelAggregates` and `IfcRelContainedInSpatialStructure`.
- PredefinedType `USERDEFINED` means "see ObjectType"; never store the ObjectType text in the PredefinedType field — keep the code as written and the effective type apart; an IFC2X3 occurrence often has no PredefinedType, its type does.
- Never show the type object's `Name` as ObjectType — the occurrence's own attribute is ObjectType, the type's Name is `typeName`; and an oracle records raw readings only, or it inherits the defect it should catch.

**Streaming, workers and progress**

- The stream callback's `index` / `total` restart at every IFC type; count products up front instead.
- Two uploads in flight leak a worker — hold the handle locally and compare by identity before clearing it.
- Every parse stage should finish with a real value, not a percentage. Geometry is ~55 % of the wall clock.
- Parsing belongs in a worker: a synchronous `StreamAllMeshes` froze Aquila's tab for 4.7 s.
- Only a drop gives the worker the file's name; any other route hands it a `Blob` named by the model key. Never branch on the extension there.

**Rendering at real sizes**

- One mesh per product does not survive a real model — ~26 500 draw calls at ~12 fps.
- Never pick with `Mesh.raycast` (222 ms a hover); filter by element box first, and cut *inside* the walk.
- Nothing may be sized to the demo model: clip, zoom, fog, shadow frustum and ladder all come from the bbox.
- Deleting a model must remap element ids everywhere; ids come from a free-slot search, never `models.length`.
- A federation id must not overflow its stride — the design's 1 000 000 was a 60 MB file; compose ids only through `fedId`, which refuses rather than collides.
- Dispose discipline — seed the "still in use" set, or a shared geometry a later load needs is disposed.

**three.js 0.186 (the version we pin), against the design's r170**

- A `BatchedMesh` is one *driver* draw per visible instance on both backends; it kernel-panicked this Mac three times.
- `WebGLBackend.draw()` has its `info` parameter commented out, so `renderer.info.render.drawCalls` can read 0.
- `maskNode` is the supported per-fragment discard and it reaches the shadow pass; `opacityNode` does not.
- `batchColor` applies only on a `BatchedMesh` — a plain `Mesh` must supply its own `colorNode`.
- An interpolated vertex attribute used as an index must be rounded, not truncated: `int(a + 0.5)`.
- A `DoubleSide` *transparent* material is rendered twice, and the shadow pass copies `transparent` from it.
- `material.depthNode` renders the scene black under an orthographic camera.
- `HemisphereLightNode` changed frames between r170 and 0.186 (`normalView` → `normalWorld`).
- `PCFSoftShadowMap` was removed; both backends warn and fall back to `PCFShadowMap`.
- `BatchedMesh.sortObjects` and `perObjectFrustumCulled` walk every instance every frame.
- The per-part state texture is in the renderer's *working* colour space; convert an sRGB file colour before writing.
- A `DataTexture` whose dimensions change must be `dispose()`d before re-upload — keep the same `Texture` object.
- An object kept after its geometry is disposed must be `dispose()`d too — its render state holds the vertex buffers.
- A double-sided transparent's back-face pass draws before the whole transparent list; blend "before glass" from the opaque list (`CustomBlending`).
