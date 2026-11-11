# SGVue Desktop — progress

> Commit hashes cited in these notes from before the public repository's first commit (`27fb7ee`,
> 2026-10-05) refer to the project's private history and do not resolve in this repository;
> later ones do.

## 2026-11-12 — SGVue 1.6.0 prepared: everything since 1.5.0, checked in a window

The owner, away from the computer: *"make sure all sessions completed their works. Run quick security check. Then u run the final tests before building installers … After you completed everything, just merge and push. publish the latest version under v1.6.0. Ensure its a stable functional version."*

**Merged into `main`:** every open branch (the position, ObjectType and identity-tile fixes; the box tools; the offset hand-back; a project that settles; a replaced load; Locate… again; the save-swap fix; the audit's decisions 6 to 10 and its sure list; the federating indicator) and GitHub's dependency update (sql.js 1.15.2, zustand 5.1.0, four dev tools). The update fired the sql.js canary — a bare export now keeps `query_only` — and the two library tests pin the new behaviour (`docs/DECISIONS.md`).

**Quick security pass** (`reviewer-deep`, the diff since `v1.5.0`): PASS, no new IPC, preload key, disk write or HTML sink. Two older notes were fixed, checks first — a formula's function name and a display unit are own keys only. One older note is left: a filter's or sort level's `field` is not cleaned.

**Checked.** Headless: typecheck 0, lint 0, `npm test` 234 files / 4 898 passed / 3 skipped, privacy 0 findings, offline eval pass, build 0. In a window, through the guards, on this Mac: the end-to-end suite 71 passed / 11 skipped (Windows-only, real-model and screenshot tests) / 1 failed only because `dist/` still held a 1.4.0 package, peak footprint 1 138 MB; on a development-tools build `project-positions.spec.ts` 2 of 2 — a three-model project reopens with every element where it was, and the selection dimension and the card read a turned wall's own size; the packaged app (`dist:mac`, ad-hoc signed, `identityName=-`) 4 passed / 1 skipped, both `app.asar`s pass the packaging test, both apps hold the two licence files. Three stale window-test expectations were corrected on the way (`docs/DECISIONS.md`). A first run was stopped by the guard at memory pressure 2 while another session ran its tests; run alone it never tripped.

| File (built here, for the check) | Bytes | SHA-256 |
|---|--:|---|
| `SGVue-1.6.0-arm64.dmg` | 135 692 896 | `08641bff105cc98ef54ce51c9328e0be85de1943e6629edf7f9b0c3d454852cc` |
| `SGVue-1.6.0-x64.dmg` | 142 287 015 | `d7050354d4491857f66f5a24e418b4cc108000a070bc91f8647757f162c055d0` |

The published files are built by `release.yml` from the tag, not these. Installed, the Mac app is 336 MB (Apple silicon) and 343 MB (Intel).

**Not checked.** The Windows installer was not run (no Windows machine). The five live Ask Vee eval cases owed for the box tools were not re-run: they spend paid credits the owner had not approved. The owner's own saved federation was not opened: its files are not in this repository. Audit decisions 3 and 4 (slim `CLAUDE.md`, update `docs/SYSTEM_SPEC.md`) are still owed.

## 2026-11-12 — a save no longer swaps a missing project model for another file of the same name

**Did.** With a `.sgvue` open and one of its models missing (say `m2 STR.ifc`), opening a different `STR.ifc` as an ordinary pick and saving wrote that other file in `m2`'s place and dropped what the project stored for `m2` (hidden elements, viewpoint entries). Cause: `buildProject` dropped a carried model whenever any loaded model had its *key* — a rule older than Locate…. Now a carried model is left out only when a loaded model is bound to its *id*; the missing model is saved exactly as the project had it and the other file as a model of its own. One expression in `model/project.ts`, two comments. **The `.sgvue` format is unchanged** (two models of one name were always allowed; a 1.5.0 build opens what this saves). Fix mode, Risky lane: failing checks first by a separate run (the pure case and the pipeline case failing, five guards passing), builder, `reviewer-deep` PASS in one round. Main was merged in before the commit. Headless: typecheck, lint, the whole `npm test`, privacy and build pass.

**Known limits, recorded in `docs/DECISIONS.md`:** a `Model = STR` rule follows the file on screen while the other file is open; a project saved in that state, reopened, then located with Replace also hides on `m2` what was hidden in the other file (older fault in `mergeLocated`, easier to reach now — a follow-up). **Also read:** the slot question from the Locate… hand-over is not reachable in the app as it stands (the real `addModel` has no pause). **Owed:** nothing was seen in a window.

## 2026-11-12 — Locate… works again after a located model did not load

**Did.** In an open `.sgvue`, a file picked with Locate… that did not end up open stayed marked "being located", so picking it again was refused as `already open in this project` until the project was reopened. Five ways in: it fails to parse, its join fails, the project's batch it shares fails, the project's own failed boot unloads it after it joined, or "Replace model?" is cancelled (the fifth found while writing the checks). Now the mark is released when the pipeline queued the file, nothing holds it any more and it is not open (`releaseDead`, `locateOver`), and at once when nothing was queued. **Decided:** a located model is still unloaded when the project's own boot fails (that loop is the offset fix's); it can be located again, and the retry boots the project. Fix mode, Risky lane: failing checks first by a separate run (five ways failing at the refusal, two guards passing), builder — who stopped when the first design broke an existing check, rather than edit it; the design was changed so a load the pipeline never saw queued is never over — `reviewer-deep` PASS in one round, then a third guard for the half of the rule no test pinned. Headless: typecheck, lint, the whole unit suite, privacy. **Not seen in a window.** **Noticed, not changed** (row in `docs/DECISIONS.md`): with another file open under a missing model's key, a save writes that file's path for the project's model and drops its hidden references; a located model joining while the project's own model is still being put in the scene may share its slot (harness only so far); the failed-boot banner can name the wrong cause.

## 2026-11-12 — a federating indicator for a model added to an open view (the owner's pick "B")

The owner: *"create a new simple yet cool techy loading animation when model view is federating the new upload model."* **Before:** a model added to an open viewer showed progress only in the sidebar's upload row; the 3D view showed nothing, then the plain centre badge "Rebuilding federation…" for the last second. **Prototype first** (`prototypes/federating-animation/`, git-ignored): three variants and a "Today" comparison at the real window size; the owner picked *"B"* — Edge trace. **Built:** a 2 px five-segment line along the 3D view's top edge, one segment per real stage, and a caption in the bottom row's centre (`name · stage · n/5`, then a tick and `+N elements`, or `could not open — see Models`). Both read only the store's upload rows (`shared/fed-trace.ts`, pure; `model/fed-trace-store.ts`); `upload-pipeline.ts` is untouched. They replace "Rebuilding federation…" for these loads only and are gone 900 / 1 600 + 220 ms after the end; no frame loop, nothing reaches the viewer; the first load from the home page is unchanged. Normal lane: checks first (`tests/unit/fed-trace.test.ts`), builder, reviewer. **Seen in a window** on the owner's yes (`tests/e2e/fed-trace.spec.ts`, guarded, 34 s): six models added to an open view — both themes, a 520 px stage, the hint + reset pill + property card together, a file that cannot be opened, reduced motion — every stage in order, no overlap with any other piece, never with the centre badge, both pieces removed each time.

## 2026-11-11 — the repo audit's fixes: decisions 6 to 10, and the sure list

A read-only audit of the whole repository listed 80 sure fixes and 55 decisions for the owner; the owner approved decisions 6 to 10 (*"fix all the audit decisions 6 to 10"*) and then the sure list. All of it is on the branch `claude/repo-audit-48da55`, each change written against a check that failed first, reviewed, and committed apart; nothing is pushed or merged.

**Decisions 6 to 10.** Ask Vee: showing only some storeys is under the 5 % scope guard like every other way of hiding; a clash list cut short is still in order; a placed spot is quoted in the unit on screen; `copy csv` writes volumes; two messages reworded. Six small visible things: Preferences' Model box saves once, the Spatial-structure card names the file's own coordinate system, Schedules says when a limit or storage refused. Schedules redraws its table only for what can change it. The schedule engine reads `.5` and `1e3`, yes/no filters, a class named twice and an unknown operator correctly. Code only its tests used is removed.

**The sure list.** The assistant's model database stays read-only after it is built (sql.js's export had switched one of three safeguards off); a schedule file cannot name `constructor` as a field; dead code removed, the audit's 41 rows of stale comments and 17 rows of document facts corrected (one comment row skipped: its file is another session's); `.claude/launch.json` ignored.

**Corrections to the audit itself.** Two "dead" items are live (`moveItem`'s re-export, `data-act="col-handle"`), the georef "leftovers" are called by live code, and the first check for an empty yes/no filter was wrong — the window stores nothing until the user picks, so an unfilled filter reads as it always has.

**Owed.** Nothing here was seen in a window: the e2e specs and the live eval were not run. Open for the owner, in `docs/DECISIONS.md`'s rows of this date: the yes/no dropdown that shows "true" while the chip reads "equals No", and three more places where a crafted schedule file can name built-in JavaScript words.

## 2026-11-11 — a project opened while another still loads (follow-up to "a project settles", below)

**Did.** A second `.sgvue` opened while the first one's models still loaded read as loaded at once — its own fresh start cleared the first one's rows, and the "every file failed" fallback took that for its own load ending; until its restore ran it could show as changed, Save Project answered that no model was open, and Locate… acted on a project not yet restored. Three guards: the project's own fresh start no longer reads as its files failing (`project.ts`); a replaced batch's failed join undoes nothing and resolves `false` (`federation-store.ts`); a replaced load's failure no longer calls `bootFailed` (`upload-pipeline.ts`). Only the first is reachable by a user today; the other two are hardening — the shipped scene takes a model in one go, so a replaced join cannot fail late — and are pinned by holding the stand-in scene's `addModel`. Fix mode, Risky lane: failing checks first by a separate run (three sequences and a guard that a project whose every file fails still settles on the landing page), builder, each guard watched failing alone, `reviewer-deep` PASS in one round with sweeps of other timings. Checks: typecheck, lint, vitest 4 612 passed / 4 skipped, privacy 0 findings. **Not seen in a window.** **Noticed, not changed** (row in `docs/DECISIONS.md`): a replaced join that *succeeds* late would remove the newer load's model of the same key from the scene (same hardening-only reach); `openDemo` / `openLibrary` still call `bootFailed` unguarded.

## 2026-11-11 — Ask Vee's box tools and SQL read a turned building square with it (option A)

Asked whether Vee's box answers should be square with the building as the selection dimension and the card now are, the owner: *"Yes, option A"*. **Measured first** on the synthetic reference model and the demo building turned −43.4103°: a 6.0 × 0.1 m wall's world box is 4.4 × 4.2 m; clash candidates ARC × STR 251 where the unturned building gives 80, ARC × MEP 30 where it gives 0; `find_nearby` lists about 20 % too long; side-by-side gaps under-read by a median 0.7–1.7 m. **Built:** `model/plan-boxes.ts` hands `clash_check`, `find_nearby`, `measure_between` and `get_element` the box `Viewer.elementPlanBox` gives the card; SQL gains `plan_box` and `plan_frame`; `IfcElement.bbox`, the `bbox` table, the project file and markup placing are unchanged, and with the plan rotation at 0 every result is byte for byte what it was (golden files). Risky lane: checks first by a separate run, builder, `reviewer-deep` PASS. Headless: typecheck, lint, the whole unit suite, `eval:offline`, privacy. **Owed:** a live re-run of `ana-clash`, `ana-proximity`, `ana-tallest`, `op-place-spot`, `op-place-measure` (wording changed, truths did not; paid and windowed, the owner's yes); the plan-box gather timed on a model of several million triangles in the guarded benchmark. Exact surface-to-surface clash tests are a separate piece, with the parked clash review.

## 2026-11-11 — a project settles when its own batch fails to join (follow-up to the entry below)

**Did.** A `.sgvue` whose own models failed to open while others were brought in with Locate… read "loading" for good: the Locate… rows stayed beside loaded models, nothing the project stored for them was restored, Save Project refused. The project settled only when its batch joined, and the one fallback (no row in flight, not booted) never fires once a located model is loading. `AfterJoin` gains an optional `failed`, called from `join`'s catch for the load still current; `project.ts` answers with `settle()`, so the located models' batch does the full restore. Fix mode, Risky lane: failing checks first (three sequences, 27 failing assertions, and a guard that nothing changes with nothing located), builder, `reviewer-deep` PASS in one round (two extras no check needed were taken out). One assertion of the new checks was corrected before the fix was accepted: it expected a save to keep the file's model order, which no save does (`carryForward` writes loaded models first). **Not seen in a window.** **Noticed, not changed** (row in `docs/DECISIONS.md`): a project opened over another's load still in flight settles at once; a located model that does not end up loaded stays "being located", so the same file cannot be located again until the project is reopened; a save lists a missing model last.

## 2026-11-11 — the offset is handed back only when nobody stands with it (follow-up to the entry below)

**Did.** Closed the path the earlier fix's review left open. `FederationController` now keeps the models on their way to joining (`onTheWay`) and hands the scene offset back only when nothing is loaded and that set is empty; before, emptying the federation (`resetBoot`) handed it back at once, so a model already loading kept the old origin and the next chose its own. Review round 1 then reproduced a second old route — a project boot refused for "no geometry" while a located model waited — closed by unloading that boot through `removeModel` instead of `resetUnshown` (`upload-pipeline.ts`). Fix mode, Risky lane: failing checks first (three pipeline cases: 29.6 m, 29.6 m and 26.5 km off before), builder, `reviewer-deep` twice. **Left, with reasons in `docs/DECISIONS.md`:** a first model with no meshes still reports `[0, 0, 0]` (not small, not safe: needs a re-base of what is on screen). **Noticed, not changed:** the display unit is still handed back early in the same races; after a project's own model fails to boot, located models load but the project still reads as loading and the missing rows stay. Nothing visible changed for an ordinary load; `.sgvue` format unchanged; nothing auto-aligns.

## Earlier work

- **2026-11-11** — two position bugs from the owner's 1.5.0 test: a reopened project, and the selection DIM
- **2026-11-11** — ObjectType is the element's own; the type's Name kept apart
- **2026-11-09** — SGVue 1.5.0 published
- **2026-11-09** — 1.5.0 now includes Ask Vee: notes folded, installers built locally
- **2026-11-09** — Ask Vee after the owner's try-out: Sonnet 5.5 by default, and its confirm run
- **2026-11-09** — Ask Vee as a messaging conversation: stages 1 and 2, the live eval, and the first window run made ready
- **2026-11-08** — 1.5.0 prepared: ifcTable's table-first Schedules window and the storey rule, recorded
- **2026-11-08** — SGVue 1.4.0 published
- **2026-11-08** — the sidebar's library popover removed; the path title on the whole model row
- **2026-11-08** — the full e2e suite before 1.4.0
- **2026-11-08** — 1.4.0 prepared: the version and the release notes
- **2026-11-08** — the packaged checks run: `.sgvue` declared and opened, on a buildingSMART model
- **2026-11-08** — two audit fixes: the SQL tool's result size, and copy csv's file text
- **2026-11-08** — Windows CI: four tests assumed POSIX paths
- **2026-11-08** — Dependabot #27 cleared: minimatch forced to 11 where 9 and 10 were used
- **2026-11-08** — the project e2e runs, and passes
- **2026-11-08** — `.sgvue` project file, phase 5: double-click and drop
- **2026-11-08** — `.sgvue` project file, phase 4: changed and missing models
- **2026-11-07** — `.sgvue` project file, phase 3: lists and markups live in the project
- **2026-11-07** — `.sgvue` project file, phase 2: Save and Open
- **2026-11-07** — `.sgvue` project file, phase 1: format and codec
- **2026-11-07** — a real file's MODELS row takes its Recent pill's colour
- **2026-11-07** — the eval graders are checked offline on every push
- **2026-11-07** — Float64 at 32.5 km is a test
- **2026-11-07** — the inline style strings are held to the design
- **2026-11-07** — seven more traps are lint errors, and the tests are linted
- **2026-11-07** — federations are simulated; the grid and storey ladders no longer follow load order
- **2026-11-07** — the store is simulated with seeded action sequences
- **2026-11-07** — old links, sessions, viewpoints and schedule files are a test corpus
- **2026-11-07** — render on demand and viewer.batch are tested headlessly
- **2026-11-07** — release builds run lint, the tests and the app.asar test
- **2026-11-07** — the privacy search is npm run privacy
- **2026-11-07** — design-reference/ is pinned by SHA-256
- **2026-11-07** — a synthetic reference model; the conformance tests run in CI
- **2026-11-07** — the rest of the "Object has been destroyed" class
- **2026-11-07** — promises are never dropped
- **2026-11-07** — switches over a union name every member
- **2026-11-07** — untrusted text and markup
- **2026-11-07** — the known traps are lint errors
- **2026-11-07** — ESLint with type-aware parsing, rules-of-hooks on
- **2026-11-07** — noImplicitAny on
- **2026-11-07** — the stage cannot be scrolled
- **2026-11-07** — Ask Vee in its own window
- **2026-11-07** — PredefinedType is two values: the code as written and the effective type
- **2026-11-07** — models line up origin to origin, and only the camera turns to square the grids
- **2026-11-07** — gridlines and the canvas grid off by default
- **2026-11-07** — the sidebar's MODELS section folds, and expanded it is always full
- **2026-11-07** — the section cut outline in each model's own colour
- **2026-11-07** — 21 Dependabot security alerts cleared, six Dependabot PRs folded in
- **2026-11-07** — the private history's Mac test fixes and its Goal section brought over
- **2026-10-17** — the assistant's errors are told apart by the SDK's own classes
- **2026-10-17** — two Dependabot alerts closed: `source-map-js` 1.2.2, and exceljs's `uuid` forced to 11.1.1
- **2026-10-17** — 1.3.0 for Mac: the disk images tested on a Mac and published
- **2026-10-09** — 1.3.0 prepared: the version, the release notes, a line on the landing page, an installer verified without being run — and two local folders kept out of it
- **2026-10-09** — the id fix checked in the app and against 1.2.0; a file over 600 MB is told to split the model; an `.ifczip` opens from the Open dialog
- **2026-10-09** — federation ids past a million lines, and the Open dialog's silent refusal
- **2026-10-09** — the display unit: the boot model's own, a third value `ft`, and every readout follows it
- **2026-10-08** — Vee's replies are laid out in paragraphs, lists and tables
- **2026-10-08** — the laser meter reads each side of its point
- **2026-10-08** — coordinates, part 2: the WorldCoordinateSystem, a note for a model that cannot be lined up, and a read-only Coordinate-system card
- **2026-10-08** — coordinates, part 1: the federation is assembled in map space
- **2026-10-08** — with the canvas grid off, the ground veil is not drawn
- **2026-10-05** — published as `sgvue/sgvue`; the first CI run's one error fixed, and the docs tidied
- **2026-10-05** — prepared for open source: Apache-2.0, notices generated and shipped, ad-hoc-signed macOS builds, the documents a stranger reads, CI
- **2026-10-02** — 1.2.0 prepared: the version, the release notes, an installer verified without being run, the product site and the releases page
- **2026-10-02** — the refactor pass: phase 4's review leftovers, two small fixes, and the survey's invisible items
- **2026-10-02** — Assistant parity, phase 4 of 4: the Schedules window, and placing markups
- **2026-10-02** — Assistant parity, phase 3 of 4: the consent gate — the assistant asks, and the user's click does it

The full text of each entry in the list above is in git history at `cdd8256:PROGRESS.md`.

Compressed: the 2026-10-02 assistant-parity phase-2 entry on 2026-11-09 (Ask Vee as a messaging conversation), the 2026-10-02 assistant-parity phase-1 entry on 2026-11-08 (1.5.0 prepared), the four 2026-10-01 entries (Vee steps 1 and 2, two section cuts, the update notice) on 2026-11-07 (origin to origin), the 2026-10-01 canvas-grid-at-the-file's-zero entry on 2026-10-09 (1.3.0 prepared), the 2026-10-01 five-main-window-requests entry on 2026-10-09 (federation ids), the 2026-09-28 Check-for-updates → product-site entry on 2026-10-09 (the display unit), the 2026-09-28 1.1.0-release entry on 2026-10-08 (Vee's reply format), the 2026-09-28 cut-outline entry on 2026-10-08 (the laser's two sides), the 2026-09-28 spot-level entry on 2026-10-08 (coordinates, part 2), the 2026-09-28 export-and-colour-from-chat entry on 2026-10-08 (map-space federation), the 2026-09-28 schedules-from-chat, installer-wizard and property-names entries on 2026-10-08 (the ground veil), the 2026-09-25 1.0.3-merge entry on 2026-10-02 (1.2.0 prepared), the 2026-09-25 NVIDIA-first entry on 2026-10-02 (the refactor pass), the 2026-09-25 1.1.0-beta.1 merge entry on 2026-10-02 (assistant parity, phase 4), the 2026-09-25 Schedules phase-4 entry on 2026-10-02 (assistant parity, phase 3), the 2026-09-25 Schedules phase-3 and phase-2 entries on 2026-10-02 (assistant parity, phase 2), the 2026-09-25 installer-GPU entry on 2026-10-01 (Vee, step 2), the 2026-09-25 Schedules phase-1 entry on 2026-10-01 (Vee, step 1), the 2026-09-25 Check-for-updates entry on 2026-10-01 (two section cuts), the 2026-09-24 refactor passes 3 and 4 on 2026-10-01 (the ground's height and the update notice), the 2026-09-24 refactor pass 2 on 2026-10-01 (five main-window requests), the 2026-09-24 refactor pass 1 on 2026-09-28 (Check for updates → the product site), the 2026-09-24 class-colours entry on 2026-09-28 (1.1.0 released), the 2026-09-24 building-box entry on 2026-09-28 (cut outline), the 2026-09-24 gridlines entry on 2026-09-28 (spot level and surface snap), the 2026-09-24 About-story entry on 2026-09-28 (export and colour from chat), the 2026-09-24 same-model-replaces entry on 2026-09-28 (schedules from chat), the 2026-09-24 landing-page entry on 2026-09-28 (installer wizard), the 2026-09-21 launch-link entry on 2026-09-28 (property names), the 2026-09-21 guards-on-Windows entry and the 2026-09-21 six Windows findings on 2026-09-25 (main's 1.0.3 merged), the 2026-09-21 footer entry and the 2026-09-21 first Windows run on 2026-09-25 (main's 1.0.2 merged), the 2026-09-20 packaged-archive entry on 2026-09-25 (Schedules phase 4), the 2026-09-20 Stage C on 2026-09-25 (Schedules phase 3), the 2026-09-20 evaluation suite on 2026-09-25 (Schedules phase 2), the 2026-09-20 Stage B defects and the assistant audit on 2026-09-25, the 2026-09-20 `solidCount` entry on the seventh 2026-09-24 pass, the 2026-09-20 split of the working notes on the sixth, the 2026-09-20 bounding boxes on the fifth, the 2026-09-20 project frame on the fourth, the 2026-09-19 frame
budget on the third, Phase 10 and the GPU-guard entry on the second, Phase 9b on the first, the
rest on 2026-09-20 — one paragraph each, with the numbers that mattered. **The full text is in
git history** (assistant parity phase 2 at `d1aed8c:PROGRESS.md`, assistant parity phase 1 at `49a3e97:PROGRESS.md`, the four 2026-10-01 entries at `40c8a1d:PROGRESS.md`, the canvas grid at the file's zero at `e214dea:PROGRESS.md`, the five main-window requests at `7e2fcc9:PROGRESS.md`, the Check-for-updates → product-site entry at `7685cf2:PROGRESS.md`, the 1.1.0 release at `16c1561:PROGRESS.md`, the cut-outline entry at `d5a4b4c:PROGRESS.md`, the spot-level entry at `e00abee:PROGRESS.md`, the export-and-colour entry at `e006857:PROGRESS.md`, the three 2026-09-28 entries in this repository's own history, at any commit before 2026-10-08's, the 1.0.3 merge at `a82a5a7:PROGRESS.md`, the NVIDIA-first entry at `a661418:PROGRESS.md`, the 1.1.0-beta.1 merge at `157bdfb:PROGRESS.md`, Schedules phase 4 at `9b6e092:PROGRESS.md`, Schedules phases 3 and 2 at `eb9e22e:PROGRESS.md`, the installer-GPU entry at `193a6eb:PROGRESS.md`, Schedules phase 1 at `1f6b787:PROGRESS.md`, the Check-for-updates entry at `60ec62b:PROGRESS.md`, refactor passes 3 and 4 at `2893aff:PROGRESS.md`, refactor pass 2 at `d16f393:PROGRESS.md`, refactor pass 1 at `a195f14:PROGRESS.md`, the class colours at `d7e4527:PROGRESS.md`, the building-box entry at `ad2cd9b:PROGRESS.md`, the gridlines entry at `f71c5c5:PROGRESS.md`, the About story at `abe3ead:PROGRESS.md`, the same-model entry at `47c2eb8:PROGRESS.md`, the landing page at `20c55f2:PROGRESS.md`, the launch link at `18606c8:PROGRESS.md`, the guards on Windows and the six findings at `22c13fc:PROGRESS.md`, the footer and the first Windows run at `a568676:PROGRESS.md`, the packaged archive at `4153e81:PROGRESS.md`, Stage C at `7c1120a:PROGRESS.md`, the evaluation suite at `47480e4:PROGRESS.md`, Stage B and the assistant audit at `4814c5d:PROGRESS.md`, `solidCount` at `9c94265:PROGRESS.md`, the notes split at `8a7086f:PROGRESS.md`, the bounding boxes at `354292c:PROGRESS.md`, the project frame at `c648cc3:PROGRESS.md`, the frame budget at
`5d942e1:PROGRESS.md`, Phase 10 and the GPU guard at `de38150:PROGRESS.md`, Phase 9b at
`d55d989:PROGRESS.md`, the rest at `814f155:PROGRESS.md`), and every decision each phase took
is a row in `docs/DECISIONS.md`.

**2026-10-02 — Assistant parity, phase 2 of 4: the camera, saved viewpoints, markups, one filter step — and a revert that restores what a reply changed.** `set_view` gains `fit`, `azimuth`, `elevation` and `zoom` (`shared/view-angles.ts`: the bearing the camera looks towards, clockwise from project north, and how far it looks down); `manage_views` lists, saves, restores and renames; `manage_markups` lists and zooms; `manage_filters` `update` changes one step in place; 35 tools. The per-reply revert was widened, owner-approved (*"correct."*): the snapshot is the session payload cut into parts, and only the parts that reply's own calls changed are put back, through the store's `applySession`. 2 464 tests passed / 3 skipped; eval oracle 56 / 56, null 0 / 56.

**2026-10-02 — Assistant parity, phase 1 of 4: switches, selection, history, models — and reading back what it set.** The owner's *"assistant should possess everything user can do on the app"*, first phase: `toggle_display` gains `groundGrid`, `snap` and `originalMaterials`, `select_elements` a `mode`, `apply_visibility` `undo` / `redo`, `color_models` a reset; two new tools, `set_models` and `set_interface` (33); a sparse per-turn view state and a full `get_view_state`; `activate_model`, `dims`, a second held change and two unguarded filter paths fixed. 2 279 tests passed / 3 skipped; eval oracle 46 / 46, null 0 / 46.

**2026-10-01 — Vee, step 2 of 2: the thinking trace, the stop button, `You` on the left.** The assistant's reply is drawn while its turn runs from the turn's real events and data — `Thinking`, a ticker over the element matrix (Read, Filter, Check), the answer word by word, its status and a row per storey — on a pure core (`ai/trace-facts.ts`, `ai/trace.ts`) and one painter; the send button stops a turn; `You` stands on the left. 2 183 tests passed / 3 skipped.

**2026-10-01 — Vee, step 1 of 2: the assistant's name and its pixel mascot — and the bottom row's lane.** The assistant is Vee (`Ask Vee`), its 16 × 16 Hex sprite on a shared 8 fps clock that sleeps between changes, one cell size per display ratio; the handoff's px ÷ 1.5 = app px; the bottom row declares `--brow`, which the chat panel and property card clear. 2 096 tests passed / 3 skipped.

**2026-10-01 — two section cuts at once: one along a gridline, one at a level.** The owner's "Two: gridline + level": each with its own offset, cut, flip side and Clear, plus Clear all; grid chips split by family; the clip is the intersection of the kept sides; every outline trimmed to the other plane's kept side; with one plane set, the 84 canvas-only phase-6 frames are pixel-identical to the build before. 2 069 tests passed / 3 skipped.

**2026-10-01 — the landing page says when a newer version is out, and the app asks GitHub once at every start.** The owner's "Check at every start": one `GET` to GitHub's latest release in a packaged build, silent on any failure; a notice with `get the update →` when newer; the app's first network call of its own. 2 014 tests passed / 3 skipped.

**2026-10-01 — the canvas grid stands at the file's zero, not at the first part streamed.** The
owner's report: a Tekla model opened alone hung under the canvas grid. The whole-metre offset's
Z is rounded from the first placement web-ifc streams, and the ground was drawn at scene z = 0;
`groundLevel` (`viewer/scene.ts`, pure) now stands it at the project frame's own zero whenever
the box spans it, else at the box's bottom, and `viewer-core.ts` builds the rig one way
(`buildRig`) at construction and on every `restage`; the offset is untouched. A second fixture,
`tests/fixtures/high-first.ifc`, streams its roof first: its ground stands at scene −12, not 0,
with only the footing below it. The mock is byte-identical; on the Tekla export the ground moved
from 98 % to 42 % up the box. `scripts/shell-sanity.cjs` parses again. One guarded dev run
tripped at 2 634 MB of GPU memory on that export and was not re-run.

**2026-10-01 — five main-window requests: an action bar, a grouped toolbar, hover titles, an
eye-first tree, file paths — and the bottom edge as one row.** Five owner requests, each a
recorded deviation. Undo, redo and the markup counts left the status bar for an action bar above
it (`ActionBar`, its lane `--abar`); the status bar, the action bar, the hint, the reset pill and
the Ask pill became the three zones of one grid row (`BottomRow`, `centrePlace`), so no two of
the five meet at 1280 × 820, 1 264 × 755, 900 × 700 or 760 × 700; the toolbar became five groups
with four dividers (737 px, one row), Schedules alone and last in the accent; every clipped text
on the property card carries its whole text as a `title`; the element tree is eye-first like
STOREYS; a file's path is the `title` of its library row, its Recent pill and its MODELS row.
1 906 unit tests; e2e 45 passed, 6 skipped. Left open then: the chat panel, the property card and
the colour legend were not zones of the row — the first two took its lane, `--brow`, the same day.

**2026-09-28 — Help › Check for updates… opens the product site, told this version.** The owner: *"Yes, open the page"*. The item opens `https://sgvue.github.io/?v=<version>` — `SITE_URL` (was `RELEASES_URL`) plus the URL-encoded build-time `__APP_VERSION__` — through `shell.openExternal`, with no network call by the app and `publish: null`. 1 896 unit tests (`menu.test.ts` pins the URL for three versions); e2e 40 passed, 6 skipped — the smoke case clicks the real item.

**2026-09-28 — 1.1.0 released: feature/ifc-table merged into main.** `main` fast-forwarded to the
Schedules branch and the version set to 1.1.0; no code changed. Against 1.0.2 it carries
NVIDIA-first graphics on Windows, the Schedules window (phases 1–4), the assisted installer
wizard, the assistant reading property names the file's way and working with schedules, spot
level tags with the surface snap, and section cut lines. 1 894 unit tests;
`dist/SGVue-1.1.0-setup.exe` built and verified without being run — its payload 75 of 75 files
identical to `dist/win-unpacked`, and none of the owner's private identifiers in it.

**2026-09-28 — a section outlines everything it cuts, in the accent.** The owner: *"Also
highlight and thicken the line of all geometry that are cut in cut section."* — the accent, about
2.5 px. While a section cuts, where the plane meets every element whose edges are drawn (glass
included, no space) is one instanced fat-line mesh in `--accent`, depth-tested, computed from the
batch store's own triangles (`viewer/section-cut.ts`, pure) at most once a frame — 5.6–8.9 ms on
a 5.58 M-triangle model, so on the main thread; a preview or a cleared section draws none. On the
phase-6 chain the outline is 37 653 px in `section-grid-C`; hidden, the frames are HEAD's.
1 894 unit tests; e2e 40 passed, 6 skipped.

**2026-09-28 — a spot shows its level only, and the snap takes the surface being looked at.** The
owner: *"I need the spot coordinate to show level only most of the time and prioritize on the
surface camera is watching on."* A new spot's tag is one line, `▽ +110.900` — a drawn triangle,
then the map Z, or with no base point the file's own z — a click opens the design's E / N / Z
grid byte for byte and a second folds it, per spot for the session, and the click never reaches
the canvas. The snap, spot and laser alike, never takes a corner or edge hidden behind the face
under the cursor or cut away by the section, tries on-plane candidates first, and gives an edge
whose foot is hidden its nearest visible point within 11 px (`SnapDepth`); without the depth view
it is the design's rule. 1 884 unit tests; e2e 39 passed, 6 skipped; on the phase-6 parity chain
the spot moved from a hidden corner 900 mm below to the sill face under the cursor.

**2026-09-28 — the assistant exports a schedule and colours the model by one of its columns.**
The owner's last two schedule abilities. `export_schedule` (view, `{format}` of `xlsx` · `csv` ·
`all_saved` · `schedule_file`) makes the Schedules window run its Export menu's own action — its
native Save dialog, its toast — and answers at once, or refuses by the menu's rules; the tool is
never told whether a file was saved. `color_by_schedule_column` (view, `{column | null}`) is the
heading menu's "Colour 3D by this column", the grouping shared by the menu and the tool; like
the menu's, it is not on ⌘Z. Tools block 28 870 → 30 857 B (29 → 31 tools). 1 870 unit tests;
e2e 38 passed, 6 skipped.

**2026-09-28 — the assistant makes and reads schedules: `make_schedule`, `get_schedule`.** The
owner: *"wire the schedules with the AI. Improve AI abilities."* `make_schedule` (view) takes a
simplified schedule — classes, columns, filters in the engine's thirteen operators, sort, group,
grand totals, title — builds it through `parseScheduleDef`, opens the Schedules window when it
is closed and shows it there as the current, unsaved schedule on that window's own undo history;
`base:"open"` changes the open schedule and keeps what the simple shape cannot say (calculated
columns, formats, colour rules, widths). `get_schedule` (read) reads it back, bounded. Both run
the ported engine in the main renderer over a store built the first time either runs — never by
a chat turn — and released when the federation changes or Schedules closes; field names resolve
as rule names do, and an unknown or ambiguous one refuses the call with the nearest names. The
Schedules window reports its schedule (`current`, at most one per 250 ms) and accepts one
(`define`). Tools block 23 523 → 28 870 B (27 → 29 tools). 1 849 unit tests; e2e 37 passed,
6 skipped.

**2026-09-28 — the Windows installer is a wizard that says install, update or repair.** The
owner asked for a proper install and update. `nsis.oneClick: false` gives Welcome → progress →
Finish, per-user, with no install-mode, folder or licence page; `customInit` reads the uninstall
entry's `DisplayVersion` and words every page Install, Update or Repair; Finish offers "Open
SGVue now" and "Create a desktop shortcut", which decides that shortcut. Bitmaps from
`scripts/make-installer-images.py`; English only. makensis `-WX` clean, the payload's 75 files
SHA-256-identical to `dist/win-unpacked`, and the old one-click installs update in place; running
it was left to the owner.

**2026-09-28 — the assistant reads property names the file's way.** The owner: *"Sometimes when
i ask it check area with includesGFA, it never check the shared parameters Includes As GFA."*
One pass in `executeTool` (`executors/names.ts` on `shared/prop-names.ts`) reads every property
name a tool input carries: the exact key, else the one key equal but for case, spaces and
punctuation — never a merely similar one, never one of two alike — and a yes/no on `=` / `!=`
becomes the key's stored spelling; a name still not a key answers with its 8 nearest names, a
value that matched nothing with its key's 15 commonest values. New read tool `find_properties`;
property names got their own schema cap, 1 000 (22 653 B at 1 000 names). 1 784 unit tests;
e2e 36 passed, 6 skipped.

**2026-09-25 — main's 1.0.3 merged into `feature/ifc-table`; version 1.1.0-beta.2.** `main`
(`1403365`: the NVIDIA-first GPU choice, 1.0.3) merged into the Schedules branch with both
features whole. In `index.ts`, `chooseGpu()` and `watchGpuCrash` run before `whenReady` in the
lock holder as on main, and the Schedules handlers and `mainWindow()` are the branch's; one
conflict git did not flag — main's `[gpu] drawing on …` block named a local `mainWindow`, which
on the branch is the imported function, so it became `win.webContents.once(…)`. In `menu.ts`,
About is main's (the `Graphics:` line) and still opens on `targetWindow()`; Help keeps About and
Check for updates, Window keeps Schedules. The Schedules window needs nothing for the GPU
choice: `--use-adapter-luid` is app-wide and both windows share one GPU process. **1 743 unit
tests**; guarded e2e 35 passed, 6 skipped, 1 failed — `packaged.spec.ts`'s `getVersion()`
against a `dist/win-unpacked` still at 1.1.0-beta.1, no installer having been rebuilt; nothing
survived.

**2026-09-25 — on Windows SGVue picks NVIDIA itself, and version 1.0.3.** The owner: *"auto set
the highest graphic card if available? Nvidia as first choice"* — on another PC the 1.0.2
installer's GPU value still left SGVue on Intel. A guarded spike found that Chromium's
`--use-adapter-luid=<high>,<low>` moves ANGLE's device, and that a LUID changes at every boot: so
it is read fresh from `HKLM\SOFTWARE\Microsoft\DirectX` at each launch (one `reg query`,
35–42 ms), with no cache and no relaunch. `src/main/gpu-choice.ts` picks NVIDIA, else AMD, else
asks nothing; Preferences gained *Prefer NVIDIA graphics when available* (Windows only, on by
default) and the Windows About box a `Graphics:` line. After review: a GPU process that fails
on a launch that asked for an adapter is recorded once (`gpuSwitchFailed`) and later launches
ask for nothing. On the 134 MB model, orbiting: NVIDIA 16.7 ms a frame (60 fps, the display's
cap), Intel 66.5 ms (15.6 fps). 1 274 unit tests; `tests/e2e/gpu.spec.ts`.

**2026-09-25 — main's 1.0.2 merged into `feature/ifc-table`; version 1.1.0-beta.1.** `main`
(`af9d88d`: the Windows installer's GPU preference, 1.0.2) merged into the Schedules branch,
both sides of every conflict kept in commit order. electron-builder takes the prerelease as it
is (NSIS `1.1.0.0`, the exe's FileVersion `1.1.0.1` beside the string), so no `buildVersion` is
set. 1 718 unit tests; e2e 31 passed, 1 failed — `packaged.spec.ts` against a `dist/win-unpacked`
that still held the 1.0.1 build.

**2026-09-25 — Schedules window, phase 4: export, the schedule file, the third writer.** The
owner-approved third disk writer, `src/main/exports.ts`: it writes only to the path the native
Save dialog returned in the same call, the extension forced to the kind, atomically, at most
50 MB; the page sends a kind, a suggested name and the bytes, never a path. Two channels
(`export:save`, `scheduleFile:open`) answer the Schedules window alone. In that window: an
Export menu (Excel, CSV, all saved schedules, the schedule file) and, in My templates, `Open
schedule file…` and `Export…`. Excel cells are numbers under the column's display format;
exceljs 4.4.0 is a devDependency in one lazy chunk, and the production CSP did not change. On
the 134 MB model (4 082 rows): XLSX 1.81–1.83 s, CSV 194–203 ms. 1 717 unit tests; two e2e flows
through stubbed dialogs.

**2026-09-25 — Schedules window, phase 3: both ways, a right-click menu, models, colour 3D by a
column.** The owner's chosen extras. Two-way selection: the main window posts its selection at
most once a frame and the table marks the rows in place, scrolling only to a pick made in 3D. A
right-click menu on rows (Select in 3D, Zoom to, Isolate, Hide, Show, Show all, Copy GUIDs) in
the main ContextMenu's markup, each item the main menu's own store action, so the main window's
⌘Z reverts it. `Model` leads every schedule when more than one model is loaded. "Colour 3D by
this column" from a heading, through the legend's own colour-by; refused past 100 distinct
values. After review: an `act` left with no ids is refused (`isolate([])` hid everything), and
headings take keyboard focus. On the 134 MB model (4 082 rows): tree click → row marked
34–46 ms; a `scroll-margin` rule that doubled a repaint was found and removed. 1 677 unit tests.

**2026-09-25 — Schedules window, phase 2: the whole ifcTable interface, drawn in SGVue.** The
rest of ifcTable's UI in `src/renderer/schedule-ui/`, vanilla DOM, every visual decision SGVue's
(the owner: *"The UI everything must be closely harmony with the sgvue design"*): the five-tab
inspector, the field browser, the template gallery, My templates, the calculated-value editor,
column resize / reorder, the status line, undo / redo for this window, print. A header replaces
ifcTable's app bar; `confirm()` / `prompt()` became the window's own dialog. Not drawn then:
Export and the schedule file (phase 4). Saved setups and the inspector width are this window's
`localStorage`. On the 134 MB model the largest category repaints in 0.39–0.56 s, and a
`'panes'` scope keeps searches off the table (a field-browser keystroke 380–524 → 14–18 ms).
After review: one pending typed edit (`pending.ts`), and saved setups validated on read.

**2026-09-25 — the Windows installer asks for the high-performance GPU, and version 1.0.2.** On
the owner's dual-GPU laptop Windows ran SGVue on the integrated GPU and orbiting a large model
was choppy. `build/installer.nsh` writes `GpuPreference=2;SwapEffectUpgradeEnable=1;` for
`SGVue.exe` under `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, only when no value
exists; a real uninstall deletes it only while it is still exactly that string. Installer-only,
Windows-only, no pixel differs. Tested on the owner's machine over the installed 1.0.1: written
when absent, kept when the user had set one, and the installed app then reported the NVIDIA
adapter; the uninstaller's logic was read, not run. 1 233 unit tests.

**2026-09-25 — Schedules window, phase 1: plumbing, the ifcTable engine, a row click shows it in
3D.** The owner asked for ifcTable *"wired together with sgvue, but as separate window"*. Its pure
engine went into `src/schedule/` (284 of its test cases with it); its IFC extractor was replaced
by `schedule/adapter.ts`, which reads the federation and adds `rowIds`. Main opens one Schedules
window on demand (the toolbar button, Window › Schedules), with a preload that exposes nothing
and a private `MessagePort` pair so the snapshot, the theme and row clicks go renderer to
renderer; a row click selects through `select(ids, zoom)`; main names the main window
(`mainWindow()`). On the 134 MB model: 15 889 rows, a 16.8 MB snapshot, the first table 1.0 s
after the click, 21 MB of renderer heap.

**2026-09-25 — Help › Check for updates…, and version 1.0.1.** The owner asked to *"add the
check for updates menu item."* Help gains `Check for updates…` under `About SGVue`; its click was
`shell.openExternal(RELEASES_URL)`, one hard-coded https constant in `src/main/about.ts` (the
product site told this version since 2026-09-28). No download and no background check; no
auto-updater, because the repository is private and the builds unsigned (`publish: null`).
Version 1.0.1, and `packaged.spec.ts` reads the version from `package.json`. 1 251 unit tests;
e2e 24 passed.

**2026-09-24 — refactor pass 4: scripts and tests (nothing the app does changes).** Eight
surveyed items. `safe-e2e.cjs` and `safe-app.cjs` read `footprint(1)` with their own regex, which
matched only the peak line; both use the tested `parseFootprintMB` now (`scripts/lib/mac-procs.cjs`),
every `/bin/ps`, `footprint` and `sysctl` call is bounded, and on macOS a process listing that
could not be made refuses the run (exit 69) and prints `COULD NOT LIST` instead of `clean:`. The
parity state tables became one file, `scripts/lib/parity-states.cjs`; `tests/unit/stub-viewer.ts`
(`stubViewer`, `memoryStorage`, `resetShell`) and `tests/e2e/helpers.ts` replaced hand-kept
copies; fixed waits became waits for the thing waited for; `verify-worker.cjs` and an uncalled
`listProcesses` were removed. 1 249 unit tests (was 1 239); e2e 24 passed, 3 skipped, twice;
frame-triggers 24 / 24.

**2026-09-24 — refactor pass 3: renderer tidy (nothing drawn, shown or said changes).** Six
surveyed items. Dead code out — `Viewer.snapshot()`, `getProjection`, the preload's `loadSession`
key and its `session:load` channel (23 keys and 15 channels then) — stale comments fixed, one
`api()`, one `el()`, one `DEVTOOLS`; `pickableFor`, `notLoaded`, `scopeCheck`, `restoredVis` and
`coordsCaption` replaced hand-kept copies; `ctxItems` memoised and the tree's grouping split from
its selection; the seventeen whole-store `useShell()` calls pick exactly their fields. Renders per
component on the mock, before → after: a 10-key chat message 860 → 60, the sidebar divider's drag
810 → 430, a tree search 261 → 109, an fps change 162 → 2. 46 dark states within run-to-run label
noise, pick-parity identical. 1 239 unit tests (was 1 215); e2e 24 passed, 3 skipped.

**2026-09-24 — refactor pass 2: renderer bugs and performance (nothing drawn changes).** Thirteen
surveyed items. Performance: the autosave no longer rewrites an unchanged `last.json` (10 writes
in 10 s at rest → 0); `setStats` is state only when the frame rate or the backend changes;
`viewer.batch(fn)` repaints, rebuilds the edges and the picker once for a run of setters; an
unloaded model's CPU arrays and meshes are released. Bugs: a session's ids are renumbered onto the
slots its files have now; a real pick replaces the demo building; a batch whose join fails undoes
itself, and a failed replacement leaves the old model; a viewpoint rename does not survive its
card closing; the SQL bridge sends one build at a time. On the 134 MB model: hide 31.7 → 19.9 ms,
isolate 27.1 → 17.8 ms, JS heap after unloading it 516 → 25 MB; pixels within run-to-run noise,
pick-parity identical. 1 215 unit tests (was 1 189); e2e 24 passed, 3 skipped.

**2026-09-24 — refactor pass 1: main, preload, shared and worker (nothing visible).** A surveyed
hardening pass. Security: `admit()` refuses a UNC or device path before `realpath` unless the
user reached it (Open dialog, recents, admitted this session); one cap, `AI_JSON_MAX_CHARS` =
1 000 000, on a tool result, a turn's view state and its schema; the window never navigates off
its own page; an `.ifczip` with several `.ifc` entries or declaring over 600 MB is refused
without inflating a byte; `protocols:` registers `sgvue://` on macOS. Bugs: the GPU guard's
distinct `wait` (it re-warned a runaway renderer every poll and never crashed it), the gateway's
120 s timer armed inside the `try`, session and recents writes through one queue, a failed SQL
build freeing its statements. Clean-up: dead code and exports gone, the SDK client built once a
session, `exports.ts` off the writer allow-list. 1 189 unit tests (was 1 150); e2e 24 passed,
3 skipped.

**2026-09-24 — class colours, renaming a viewpoint, the demo building, see-through spaces.**
Four owner-requested deviations: "Original materials" off colours every element by its IFC class
(`classColors` is `colorBy(elements, 'IfcEntity')`, the hint `Coloured by IFC class`); a
double-click renames a saved viewpoint in place; `try the demo building →` loads the design's
four-model mock in production builds too (`model/demo.ts`, a 19 kB lazy chunk; the hostile
AI-eval fixture moved to `dev/hostile.ts`); `IfcSpace` is a third batch family — a 0.08 tint, no
depth write, shadow or grey edges, 0.3 with its accent outline when selected, and picked only
when nothing else is on the ray. Reference model frame 16.70 ms before and after; pick-parity
identical on 254 grid and 2 000 random rays; frame-triggers 24 / 24.

**2026-09-24 — the camera frames the building, bubbles at the grids' own extent, a canvas-grid
toggle.** Three owner-requested deviations: a building box (every element's but the site's,
`shared/site.ts`) is what the camera frames — boot, zoom extents, presets, cube, a section's
re-aim, a double-click — while the clip planes, shadows, ground, section sheet, occlusion and
laser keep the whole box; the gridlines span the grids' own authored extent, else the building's
footprint; a `canvas grid` toolbar button shows / hides the ground grid. After review: only
building elements hide a bubble, and the cube's canvas passes a mouse through where nothing is
drawn. Reference model 1.15 → 1.86 px a metre, bubbles 93–173 m → 31–36 m off the building; the
mock now frames its block (49 % of pixels differ). 1 125 tests; e2e 20 passed, 3 skipped.

**2026-09-24 — gridlines meet their bubbles, dimensions between gridlines, a see-through
ground.** Three owner-requested deviations: a gridline runs on to its bubbles' centres (the 77 px
gap on the mock gone at every zoom); dimensions between adjacent gridlines parallel within 0.5°,
at each family's start end, in the selection dimension's look, sharing the bubbles' declutter
sweep and occlusion (5 of 37 labels at the reference model's default framing); and the ground
see-through from above — opaque ground with no depth write, the batches, a 0.6 veil in the
opaque list — so a part below grade shows at 40 % contrast. Plain ground byte-identical.
1 108 tests; e2e 19 passed, 3 skipped.

**2026-09-24 — About story, version on the landing page, resizable sidebar, one-line
suggestions.** Four owner-requested deviations: Help › About shows `SGVue`, the version and the
owner's story (`ABOUT_STORY`; the native panel on macOS, a message box on Windows); `v1.0.0` on
the left of the theme toggle's strip (`__APP_VERSION__`); drag handles size the MODELS and
STOREYS lists (session-only, a double-click resets, undragged pixel-identical); the Ask SGVue
suggestions are one scrolling line, folded behind a chip after the first message. Also the
author is `Yong Yen` and `publish: null`. 1 096 tests; e2e 19 passed, 3 skipped.

**2026-09-24 — after boot, the same model again is confirmed and replaces, not `name (2)`.**
*"Dont do this. Just ask user to confirm then remove the old version."* A pick whose model key is
open or loading asks in a native message box (`file:confirmReplace`, preload key
`confirmReplace`); Cancel drops that file, Replace swaps the old model out only once the new one
has parsed, under the same key and with no reframe; a failed parse leaves the old one, and ` (2)`
survives only for two files of one stem in one pick. 1 080 tests; e2e 17 passed, 3 skipped.

**2026-09-24 — the landing page: no Resume card, "Recent", a smooth hand-off, a fresh load per
pick.** Four owner-approved changes: the Resume card and everything that only fed it gone (the
autosave still writes `last.json`); the pills' heading reads `Recent`; the federation builds
under the last tick's 1 100 ms hold, the page fades out over 220 ms and the SQL index builds
after the reveal; on the landing page a new pick replaces a load in flight. Tick → viewer
visible 1 489 / 1 991 / 5 521 ms → 1 133 / 1 145 / 2 219 ms on three real files, no dead gap.
1 065 tests; e2e 16 passed, 3 skipped.

**2026-09-21 — a launch link carries only its payload, and the backend switch is dev-only.**
`App.tsx` honoured `#backend=webgpu` in every build and `createWindow()` copied everything after
`sgvue:` into the hash, so `sgvue://s=<payload>&backend=webgpu` ran a real model on WebGPU — the
backend that kernel-panicked the Mac on 2026-09-17. The test came first and failed first (the
status bar read `WebGPU·48 fps·6 / 6`). The hash is now honoured only under `DEVTOOLS`, and
`launchHash(link)` (`main/deep-link.ts`) passes `s=<code>` or nothing. 1 064 tests; e2e 14
passed, 3 skipped; `test:packaged` 1 passed, 2 skipped; no survivors.

**2026-09-21 — the project's own guards run on Windows (finding 1).** The three guard
wrappers were macOS-only: `safe-e2e.cjs` and `safe-app.cjs` died on `spawn … ENOENT`, and
`safe-run.cjs`'s refusal and survivor sweep rested on `/bin/ps`, so its `clean:` line was
unchecked. Every Windows addition sits behind `process.platform === 'win32'`; the macOS lines are
byte-identical. `scripts/lib/win-procs.cjs` reads `WorkingSet64` per process and summed, plus the
GPU process's own `Dedicated Usage` counter (every third 1 500 ms poll) — no pressure term.
A process is ours by **directory** (realpath, lower case, trailing separator); PowerShell is one
argument array with no path interpolated; kills are `taskkill /T /F`. After review every call is
bounded (8 s PowerShell, 5 s `taskkill`), a listing that failed prints `COULD NOT LIST` rather
than `clean:`, and a startup snapshot that could not be made refuses the run, exit 69.
`packaged.spec.ts` and `asar-contents.test.ts` test `dist/win-unpacked`. 1 057 tests; e2e 13
passed, 3 skipped; a 5 s cap tripped, killed four and exited 2; a second dev Electron was refused
by all three wrappers and left alone. Found, not fixed: `verify-worker.cjs` is stale.

**2026-09-21 — six of the seven Windows findings, fixed.** `npm test` exits 0 again (the
`askAbout` 60 ms timer under fake timers; the settings tests clean `%TEMP%`). **Every path the
renderer stores or compares passes through `admit()`**, so a junction, an 8.3 short name or a
mapped drive no longer reads as "moved" and the SHA-256 check no longer skips in silence; a
pathless dropped file is never sent to `admit`. A second launch brings the window forward, and
the instance that loses the single-instance lock does nothing (Electron's own if/else). About
opened the platform panel instead of `https://github.com/`; `author` gained a name; README gained
*Install it — Windows*. Packaged probe 42 / 0, Playwright 12 passed, 4 skipped, 1 024 tests.
Finding 7 (`sgvue://` registered at every launch) unchanged.

**2026-09-21 — the landing page lost its footer, and kept its theme toggle.** *"remove footer.
Not valid for desktop app."* Gone: the `© <year> SGVue` line, the `·`, `Parsed locally, never
uploaded`, the spacer, the placeholder `Privacy` / `Terms` / `Support` links and the divider.
The theme toggle — the only theme control reachable before a model is open — stays unchanged in
the same place (*"Keep just the button"*), in a plain `<div>` rather than a `<footer>`. No new
element or control; the smoke test asserts both. Playwright 12 passed, 4 skipped; 1 002 tests.

**2026-09-21 — the Windows build ran on a real Windows machine.** The tree's first run on
Windows 11 (RTX 3070 Ti + Intel UHD 770), in a path with a space. `npm ci`, `build` and
`dist:win` pass there — a 115 MB unsigned per-user NSIS installer; the installer was not
executed (safety policy), so its payload was extracted and **76 of 76 files** matched
`dist/win-unpacked` by SHA-256. The packaged app under a temporary Windows guard: 41 checks
passed and 1 failed (finding 4) — CSP, share link, WebGL2 on ANGLE/D3D11, DPAPI `safeStorage`;
the `second-instance` deep-link path works; Windows opens links up to its 32 767-character
`CreateProcess` limit. Playwright 12 passed, 4 skipped. Seven findings, none fixed that day:
macOS-only guard wrappers, `npm test` exiting 1 on `shell.ts`'s 60 ms timer, a dropped path
that is not its own `realpath` refused as "moved", a second launch without a link doing
nothing, the losing instance starting a browser stack, small items, and `sgvue://` re-registered
by every packaged launch.

**2026-09-20 — the packaged archive stopped shipping the workshop.** `app.asar` carried
`.claude/` (eval traces, which on a real model hold project data), `.eval-builds/`,
`test-results/` and `playwright.config.ts`; one `!.*` pattern in `electron-builder.yml` plus
Playwright's output and config by name closed the class. Same 3 055 needed entries,
27 263 153 → 20 532 729 bytes; `tests/unit/asar-contents.test.ts` reads the archive's header and
names any stranger. 1 032 tests; `test:packaged` green, guard peak 877 MB.

**2026-09-20 — the assistant, Stage C: the five the user approved.** One new rule operator,
`absent` ("the property has no value"), the one visible change — `empty` in the Filter card's
64 px control, `is empty` everywhere with room, byte-identical captures otherwise; "walls with no
fire rating" 2 767 of 3 314, matching SQL. View tools act on a found set (`ids` capped at 2 000,
or `selection:true`) through the right-click menu's actions, unknown ids reported by count;
`find_nearby` on `clash_check`'s hash, proved equal to a flat scan (1 000 m: 26 s → 2 ms);
`manage_filters` reaches named filter sets; six plain instruction lines and eight rewritten tool
descriptions (request 50 001 B, ~$0.007 cold); `set_filter_stack` colours each new step against
the stack being built. Oracle 36/36, null 0/36; 1 029 tests.

**2026-09-20 — the assistant's evaluation suite.** `scripts/ai-eval.cjs`: thirty-six questions
in six groups (answer · tabulate · analyse · operate · refuse · resist), one window and one fresh
conversation per case through the real gateway, tools and store, graded programmatically with no
model judge (`scripts/eval/graders.cjs`, 39 unit tests); ground truth computed at grade time.
`--dry-run` scores 31/31 and `--null` 0/31 without a request; five cases for capabilities not yet
built report n/a; a hostile fixture (`#mock&hostile`) appends injection text to four values.
Dev-only seams only; 918 → 957 tests. `docs/AI_EVAL.md` has every case.

**2026-09-20 — Stage B: the assistant's nine fixable defects.** The audit's no-decision items:
`get_spatial_tree` bounded above the spaces with per-node `childCount` (138 373 → 3 756 B),
`color_by_property` to fifty groups with `omittedGroups` while the legend keeps all (74 314 →
3 696 B), `valid_values` paged at forty; `summarize_elements` labels totals with the file's own
`unitLabel()` and states partial coverage; `list_values` reports pool / carrying / missing;
`apply_visibility` refuses a blank view; `max_tokens` 64 000, eager input streaming on the 24
strict tools, the 120 s cap aborts the live stream, SDK bounded 50 s × 2. Chat-panel parity
PNGs byte-identical; 880 → 918 tests.

**2026-09-20 — the assistant, audited end to end (measure only).** `scripts/ai-audit.cjs` and
`docs/AI_REVIEW.md`: all 25 tools on the real 26 761-element model, no API key used. Ten
findings, four provable defects — `get_spatial_tree` at 34 593 tokens uncapped,
`color_by_property` at 18 578 with `truncated: false`, an Apply button for a view that leaves 0
of 26 761 visible, quantities in mixed file units labelled `m²` — plus two capability gaps: no
tool took element ids, and the rule grammar could not say "absent". Scope guard, revert, cache
breakpoints, SELECT-only gate and the 10 s SQL kill (10 007 ms, rebuilt in 37.7 ms) held up.
The proposed prompt diff stayed proposed. **880 tests.**

**2026-09-20 — `solidCount`.** `IfcElement.solidCount` was the last mock-only field, so
`get_element` said `null` where the property card showed a number. It is now the part count off
the same pass that unions the box — every part `viewer/batches.ts` counts, opaque and glass
alike, so a window's frame and pane count two — and `get_element` carries `solidCountMethod`.
On the reference model: 26 524 elements, **0 mismatches** against `viewer.solidCount`, min 1 ·
median 1 · max 921. **880 tests.**

**2026-09-20 — the working notes were split.** `CLAUDE.md` was 111 KB, loaded into every
session; its decision rows, traps and command table moved verbatim into `docs/DECISIONS.md`,
`docs/TRAPS.md` and `docs/COMMANDS.md` (114 895 → 20 435 bytes), and `PROGRESS.md` compressed
twelve entries into this section (127 622 → 43 197 bytes). Corrected in the move: two disk
writers, not three. A script diffed the new docs against `814f155:CLAUDE.md` — 143/143 rows,
42/42 trap bullets, 25/25 commands verbatim. **879 tests.**

**2026-09-20 — one bounding box per element, on real models.** `IfcElement.bbox` was filled
only by the mock, so on a real file `measure_between`, `clash_check`, `get_element`'s box and
the SQL `bbox` table (0 rows of 26 761) had nothing. `elementBoxes(chunks, offset)`
(`model/element-boxes.ts`) unions the parts' `bbox6` in `prepare()`, the one place the index and
the geometry meet, before the freeze; no consumer needed a second path, and each says the box is
conservative and in the project frame. Measured: 26 524 boxed (237 without geometry), SQL build
1 394 → 1 452 ms, index box = `viewer.elementBox()` to 0 mm, IfcOpenShell wall and door 0 mm.
**879 tests.**

**2026-09-20 — the project frame: the model stands square with itself.** A Revit / CORENET X
export states its position and its −43.41° rotation on the spatial-root `IfcSite.ObjectPlacement`
(its `IfcMapConversion` is an identity), so everything drawn axis-aligned was off by that angle
and the sample wall read 87.489 × 82.787 m against its own `Qto` 120.150 × 0.300 m. One
transform, `frame⁻¹`, composed in `geometry-streamer.ts` beside the axis swap; `shared/georef.ts`
is the pure core. Dividends: the offset fell to `[313, −76, −1]` and the precision warning went.
Level rings from each storey's own placement, the tag printing the authored `Elevation`; the
Coordinate-system caption names the detected method; grid bubbles declutter; the sidebar keeps
40 % for the tree above six storeys; gridline chips in natural order; sessions, links and
viewpoints carry `frameKey`. Measured: grid families 0.00° / 90.00°, rings 0 mm off on 10 of 12
storeys, wall box = its `Qto`, 0.092 mm on an IfcOpenShell vertex; parity worst mean 0.0133
against a 0.0216 noise floor. **858 tests.**

**2026-09-19 — the frame budget: four invisible fixes, two refusals.** Orbiting the 137.9 MB
model ran 37.8 fps (p95 83.4 ms) because the label occlusion sweep fired 78 bubble rays through
26 539 elements every fourth frame, moving or not (83.8 ms a sweep). **(1)** The sweep runs only
when its answer can have changed. **(2)** A pick ray walks a uniform grid (`pick-grid.ts`), a
*filter* whose survivors still take the flat scan's walk — 0.099 against 1.098 ms a ray, proved
identical by `pick-parity.cjs`. **(3)** The frame loop draws on demand: *anything that changes
what is drawn must call `invalidate()`*, checked by pixels in `frame-triggers.cjs`. **(4)** No
hover during a camera gesture. After: 118.5 fps, p95 10.3 ms, nothing drawn at rest; not one
scene pixel moved. **Refused:** opaque edges (the cost is rasterisation, 0.11 ms) and
`forceSinglePass` on glass (0.14 ms for ~300 changed glazing pixels). Also: the harnesses kill
only what they started, never the user's own SGVue. **832 tests.**

**2026-09-18 — the shipped GPU guard scales with the machine.** `gpu-guard.ts`'s flat 3 072 MB
was below the packaged app's own 2 242–2 353 MB peak on the 137.9 MB model; it is now
`max(3 072 MB, 40 % of RAM)` (`gpuLimitMB()`), safe because a runaway climbs by gigabytes a
second. Dev guards keep their fixed 2 500 MB. **821 tests.**

**Phase 10 — accessibility, performance, packaging.** Nothing visible moved (parity re-capture
identical to two decimals): tree / menu / dialog / log ARIA roles with roving focus
(`tree-keys.ts`), a 44 px coarse-pointer minimum, the context menu clamped by its measured
height; the shadow map rendered on change (126 → 105 draws, section 103.3 → 10.5 ms); the
design's brand-mark icons; `.dmg` × 2 and NSIS `.exe`; `safe-app.cjs` and
`npm run test:packaged` (share link, production CSP, unpacked `.wasm`, Preferences from the real
menu; 13.06 s to ready on the 137.9 MB model); the renderer minified (3.79 → 1.50 MB); no third
disk writer. **815 tests, 57 files; 14 e2e.**

**Phase 9b — the assistant panel.** `SGVue.dc.html:430–540` translated element by element in
`app/ChatPanel.tsx` — pill, bubbles, chips, result tables with `copy csv`, apply / cancel, ↺,
reply strip, busy row, composer — over 9a's `sendChat`, store actions and `chatSuggest` /
`seedAudit`. Every decision is a pure selector (`state/selectors/chat.ts`); no stop control,
no `disabled`, closing does not abort, as the design. Parity 0.00–0.02 of 255 over seven states
in both themes. **796 tests, 56 files**; six e2e tests.

**Phase 9a — the assistant's gateway, prompt, tools, settings** (`9a749a6`). SDK, key and API
transcript in main; twenty-five tools in the renderer over five zod-typed IPC channels. The
design's fifteen tools verbatim but for one `combine` enum and `additionalProperties: false`;
ten read-only additions; `color_models` the one non-strict tool; the transcript rolled back on
anything but success, so a `tool_use` is never left without its result. **772 tests, 55 files.**

**Phase 8 — landing, upload pipeline, sessions, share link** (`46bfd7f`). `SGVue.dc.html:721–831`
ported element by element with a real pipeline behind it: native Open dialog, native drag-drop,
`sgvue-file://` with admitted paths and single-use tokens, and `src/main/sessions.ts` as the
second permitted writer. The five designed stages are driven by worker milestones — on the
137.9 MB model, reading file 487 ms → federating 12 917 → ready 13 350. **647 tests, 48 files.**

**Phase 7 — colour systems** (`1166dc8`). The eleven-colour `SCHEME`, `colorBy` as a pure
function, the legend ported element by element, and `BUILD_PLAN` §1.4's five-layer precedence
lifted out of the reference's two closures into `elementColour`, one test per layer pair. The
design gives colour-by no manual control, so none was invented. **559 tests, 42 files.**

**Phase 6 — annotation** (`35384dd`). Gridlines, level rings and tags, the section plane, the
laser meter, spot coordinates, dimensions, and the Section, Markups and Coordinate-system
cards. A grid became a **segment**: the reference model's 39 axes run at 46.59° and 136.59°
with none axis-aligned, and every generalisation reduces to the design's own branch exactly.
`shared/annotate.ts` is the arithmetic. **517 tests, 39 files.**

**Phase 5 — visibility, filter stack, activate, undo, viewpoints** (`df0ac8b`). Cards ported
element by element, logic method by method. `shared/filter-stack.ts` (auto-picked colours, cap
twelve) and `shared/undo.ts` (five `VIS_KEYS`, cap 50 both sides, arrays outside reactive
state) carry the semantics; visibility is a conjunction, so two orders of the same two
operations give the same visible set. **436 tests, 35 files.**

**Phase 4 — selection, property card, context menu** (`d585b4c`). The designed card in the
designed order — identity tiles, containment chips, property sets first, then Identifiers,
Related and Geometry — plus the twelve-item menu, both as pure selectors carrying an `action`
rather than a closure. The Geometry rows add the federation offset back. **371 tests, 33 files.**

**Phase 3 — the shell, the sidebar, first pixel parity** (`c6e591b`). Sidebar, rail, toolbar,
spatial card, temporary-state frame, hint and status bars. `app/css.ts` keeps every inline
style as the design's own declaration string, `style-hover` becomes eight `!important` classes,
and `renderVals()` becomes pure selectors. **329 tests, 31 files.**

**Phase 2b — three kernel panics, then merged geometry** (`40799c0`). This Mac panicked three
times in one day, every report naming the Electron GPU helper at ~168–170 GB; the cause was
`BatchedMesh` — one *driver* draw per visible instance on both backends, measured at
634 → 5 461 MB inside one 0.5 s poll. Merged geometry per slot replaced it: **87 draws a frame,
GPU flat at 1.74–1.79 GB, 41–51 fps, 3.3 ms hover** against `Mesh.raycast`'s 222 ms. Picking,
input, snapping, overlay and view cube shipped with it. **259 tests.**

**Phase 2a — renderer core** (`a60137b`). `viewer-core.js` ported onto `three/webgpu` 0.186 —
scene, lights, ground, edges, materials, camera — and the geometry contract amended to IFC
**Z-up**, one constant rotation composed on the left of every placement and the offset chosen
after it (`[12520, 23186, 4] m`). Every scene constant became the reference's value ×
(radius / 27.5 m). **167 tests, 19 files.**

**Phase 1b — geometry, crease edges, federation, SQL** (`2857b73`). Vertices stay local with
the part matrix carrying the placement — **35 119 unique geometries for 67 364 parts** — crease
edges replicate `EdgesGeometry(geo, 20)` once per geometry, and an `IfcStyledItem` walk lifts
transparent parts from 2 565 to 3 627. The read-only SQL worker followed. **114 tests, 14 files.**

**Phase 1a — parser, ModelIndex, mock adapter, fixtures** (`26e7a13`). The whole read path to a
frozen `ModelIndex`, checked against IfcOpenShell on a real 144 MB Revit model. `ifc-source.ts`
is the only module that imports web-ifc and seals every forbidden write name; property and
quantity sets are built in **one** forward pass over the relations. **61 tests, 9 files.**

**Phase 0 — scaffold, docs, guards** (`6a7d5c7`). `git init`, the design bundle vendored
read-only as the specification of record, every package pinned to the plan's exact version, and
the security posture set at the start rather than retrofitted: sandbox, context isolation,
deny-all permissions, the privileged `sgvue-file` scheme, the production CSP. **5 tests.**
