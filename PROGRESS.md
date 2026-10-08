# SGVue Desktop — progress

> Commit hashes cited in these notes refer to the project's history before it was published on
> 2026-10-05, and do not resolve in this repository.

## 2026-10-08 — the laser meter reads each side of its point

**Did:** the owner's *"Also update the measurement to show left and right dimension from the
spot, rather than overall."* Per axis the laser now reads the distance along the axis from the
clicked point to the face on its − side and on its + side (`LaserRay.minus` / `plus`,
`MeasureRecord.sides`; `null` where a side hit nothing); the whole ray (`x` / `y` / `z`) is kept
for the assistant's result, the eval's observation and the fixtures, and is now exactly the sum
of the two. The 3D view: one label a side at the middle of its half, in the design's markup and
offsets (`laserLabelHtml`, moved with the live reading's `laserLiveHtml` into
`shared/annotate.ts`), where the design had one at the middle of the ray; lines, dots and the
origin mark unchanged. The live reading `X 1 200 + 2 300 · Y … mm`, the `+` in `--faint`. The
Markups row `X 1 200 + 2 300 mm` / `X 1.200 + 2.300 m`; a row that reads two sides somewhere wraps
between two axes' readings (`white-space:normal`, one `nowrap` span per axis inside the design's
span, `MarkupRow.axes`) — the one style string changed, because such rows measured up to 311 px
against the 220 px column and were cut off — and every other row is the design's span and text.
`manage_markups` adds `sides` in the card's unit; its description and `place_measure`'s sentence
say what the numbers are. Capture states `laser-sides-*` and `laser-onesided-*` in
`scripts/screenshot.cjs`. Docs: an allowed-deviation entry, a decision line and row, two
sentences in `SYSTEM_SPEC.md`, a dated note in `tests/parity/phase6/README.md`.

**After the deep review** (approved; six follow-ups, all done): the sides are measured along the
axis, not as straight lines from the point — the ray starts 3 mm off the surface, so a side
across a face had read that lift's hypotenuse — and `len` is their sum, so `minus + plus === len`
for every axis, pinned (a one-sided axis across a face included, where the design's
`a.distanceTo(b)` had measured from the point, off the ray); a row with no two-sided axis has no
`axes`, so the card draws the design's own span; the phase-6 chain run again; `SYSTEM_SPEC.md`;
the `CLAUDE.md` entry's wording, with the known limit named; `L382`, not `L381`.

**Measured** (mock, 1280 × 820, DPR 1, both themes; the build before, saved and captured through
the same guarded harness and the same pointer events; a second run of this build for the
harness's noise): `Ext Wall E 1-2 L4` at (906, 440) — `Y 2 673 + 2 927 · Z 2 400 + 300 mm`,
before `Y 5 600 · Z 2 700 mm` — differs only in its own labels (3 289–9 666 px), the Markups
card (6 072–6 144 px; 112 → 122 px tall, the row on two lines) and what also differs between
two runs of one build (the grid bubbles' and grid dimensions' antialiasing, 950–4 141 px); with
3 s for the camera to arrive, the zoomed 3D frame is the build before's. `Floor Slab L2` at
(682, 560), one side on every axis, is byte-identical: dark 0 px in the whole window in all three
states, light only the grid-label band. The phase-6 chain (1440 × 860): the nine states before
`measure-M1` differ only in that band; from `measure-M1` to `coords-card` the two measurements
read two sides — M1 `X 60 + 2 280 · Z 1 380 + 60 mm` — so their labels differ (1 804–7 966 px)
and `markups-card`'s card is 225 px tall (was 205); in `coords-card` the Coordinate-system
card, status bar, sidebar and toolbar are 0 px apart. Label overlap in the default view: the
design's labels overlapped at 4 of 8 wall points, the new ones at 8 of 8 (1–6 pairs, up to
51.8 × 16.3 px, there always two axes' labels); and M1's 60 mm halves overprint their own axis's
other label (X 50 × 10 px, Z 60 × 6 px) — the known limit, not decluttered, as the brief asked.
Zoomed to the measurement, none. Tools block (strict) 54 494 → 54 684 B.

**Verified:** `npm run typecheck` exit 0; `npm test` **145 files passed / 2 skipped, 2 843 tests
passed / 3 skipped** (new: `laser-sides.test.ts`, the annotation layer itself on a stub host —
the record, `minus + plus === len` on every axis, every reading's text, anchor and offset, the
live reading, a deleted measurement's labels gone — and the label, live-reading and row formats
in `annotate.test.ts` and `markups.test.ts`, `manage_markups`' output in the parity tests);
`npm run build` exit 0; `npm run test:e2e` **63 passed, 6 skipped** in 7.9 m — peak one process
239 MB, all 785 MB, GPU dedicated 253 MB, `clean:`. Every guarded run ended `clean:`.

## 2026-10-08 — coordinates, part 2: the WorldCoordinateSystem, a note for a model that cannot be lined up, and a read-only Coordinate-system card

**Did:** rule 4 of the owner's five (*"Yes, all five"*), and the two things they chose for the
card — *"One-line note on screen"* and *"Maybe just make the coordinates system toggle a read
only, dont let user change anything."* **(A) The `WorldCoordinateSystem`.** Measured first:
web-ifc 0.0.77 applies the `Model` context's WCS to no placement, neither its move nor its turn
(a test pins it with an inline STEP file; `docs/TRAPS.md`). So `mapPlacement` applies it: with no
map conversion and a WCS that is not the identity, M = the WCS (its origin through the length
unit, its own turn), then `TrueNorth`'s turn, atan2(x, y), only when nothing else turns — the
sign is the one that puts the project's true north on map north, and equals the conversion the
same Revit export writes with an EPSG code. Beside a conversion the WCS is undone first, M = C ∘
WCS⁻¹ — IfcOpenShell's reading — and `get_model_info` says `ambiguous`. `placedBy` and the
caption's method gain `WorldCoordinateSystem` (`+ IfcSite placement`). The index builder reads
the 3D `Model` context's WCS (`readWcs`, `Georeference.wcs`; `placementMatrix`'s axis step
factored out as `axisMatrix`). Three fixtures: (i) Revit Project Base Point with no EPSG code,
(j) its IFC2X3 twin, (k) a WCS beside a conversion. **(B) The note.** `notLinedUp` / `lineUpNote`
(`selectors/status.ts`): a loaded model whose file states no map position while another's does,
or one the stream flagged `farPlacement` (now with its distance; recorded only for a model that
did not set the offset); a boot model with no map position is named, and no distance is. One
line under the caption row, the caption span's style string plus `nowrap` / `hidden` /
`ellipsis`, the whole text as its `title`; names are the sidebar's file line through
`labelText` (moved to `shared/fmt.ts`). `get_model_info` and `get_view_state` report
`notLinedUp`. **(C) Read-only.** The four fields are `readOnly`; `setCoord`, the `onChange`,
`request_user_action`'s `set_base_point` (zod, schema, `PendingAction`, `performGated`, the
gate — 13 calls — the ticker, the prompt, the eval case and its grader check), the `basePoint`
revert part, the `user` source and the dev hook `setCoords` are gone. The store keeps
`bootGeoref` — the declaration that defined P — beside `frame`; `setOffset` is the one place
`coords` is written, and the base point, both chips, the caption and the source are read off it,
so they stay right after the boot model is unloaded (the part-1 review's deferred item) and are
cleared with the frame. A session's `coords` is ignored on restore and still written, for older
builds. Docs: two allowed-deviation entries and four amended, five decision lines, three
decision rows and six amended, a trap, `SYSTEM_SPEC.md`, `AI_EVAL.md`, `COMMANDS.md`.

**Measured:** the eleven fixtures federate within 1 mm in all 110 ordered pairs, and IfcOpenShell
agrees product by product: `auto_xyz2enh` for (a), (b), (f) and (k), and its own `get_wcs` and
`get_true_north`, composed as Revit writes them, for (i) and (j) — `auto_xyz2enh` returns a file
with no conversion unmoved. Production builds against the
commit before (the real main process, files through the Open dialog's dev gate, 1280 × 820, both
themes): the demo's card byte-identical, its window byte-identical to one of this build's own
two renderings (overlay-label antialiasing alternates run to run, 1 802 / 1 729 px, in both
builds); `a-site-placement.ifc` + `b-map-conversion.ifc` — card byte-identical, no note;
`a-site-placement.ifc` + `tiny.ifc` — the note `tiny.ifc could not be lined up — it has no map
position.`, clipped (288 > 270 px) with its whole `title`, the card 294.2 → 323.0 px, the window
with the card closed byte-identical; (i) + (a) — 26 km apart before, one building after, and the
card's base point the synthetic position under `WorldCoordinateSystem + IfcSite placement`
(before: `E 4 · N -2.5 · Z 0` under `IfcSite placement`).

**Verified:** `npm run typecheck` exit 0; `npm test` **144 files passed / 2 skipped, 2 829 tests
passed / 3 skipped**; `npm run build` exit 0; `npm run test:e2e` **63 passed, 6 skipped** in
8.1 m (one new case: the card read-only with a fixture's base point, a value selectable, no note
for a pair that lines up, the note on one clipped line with its title for one that does not) —
peak one process 412 MB, all 802 MB, GPU dedicated 265 MB, `clean:`; the eval oracle **65 / 65**
and the null agent **0 / 65** (`ai-eval.cjs --dry-run` / `--null`, guarded). Nothing survived.

**After the deep review** (code approved; two stale doc statements): `SYSTEM_SPEC.md` counts
thirteen gated calls and thirteen `PendingAction` kinds, and drops the base point's stale-request
clause; a WCS tilted at the origin is the identity, as a tilted site is (a test each in
`georef.test.ts` and `render-selectors.test.ts`); the IfcOpenShell wording says what is its
reading and what is ours; the phase-6 parity chain's `spot-C1` types nothing into the read-only
card (`tests/parity/phase6/README.md` says why its states differ from there on); the rule-4 row
records two limits; the web-ifc probe closes its models. `npm run typecheck` exit 0; `npm test`
**2 831 passed / 3 skipped** (144 files / 2 skipped).

**Not verified:** a real Revit export with no EPSG code (none in `samples/`), macOS, and the
owner's own files.

## 2026-10-08 — coordinates, part 1: the federation is assembled in map space

**Did:** the owner's mixed federation — *"My ifc are based on site placement while other are
based on ifcmapconversion"* — and rules 1, 2, 3 and 5 of the five they approved (*"Yes, all
five"*). Each model gets its own world → map operation from its own declaration
(`mapPlacement`, `shared/georef.ts`: the `IfcMapConversion` on the 3D `Model` context or a
sub-context of it, else IFC2X3's `ePset_MapConversion`, else the identity; E / N / H × the map
unit; `Scale` never applied; `TrueNorth` never stacked). The federation's frame is the boot
model's project frame in map coordinates, **P = M_boot ∘ Site_boot** (`federationFrame`), and
each model streams through **M_i⁻¹ ∘ P** (`modelFrame`) — which is the boot's own site frame, not
recomputed, for every model placed the way the boot is, so a Revit "Shared Coordinates"
federation streams exactly as before. Grids and storeys go through the same frame (`metaOf`,
now exported). The index builder takes the conversion on the `Model` context, reads
`IfcProjectedCRS.MapUnit` (an SI prefix, a conversion factor) and IFC2X3's `ePset_ProjectedCRS`
map unit by name
(`lengthUnitFromLabel`, `shared/units.ts`). The base point is P: set once at boot from the boot
model (`federation-store.ts`), never from a model that joins later; the card, the chips and
`basePointSource` speak for the model whose declaration the fields are (`cardGeoref`).
`get_model_info` reports `placedBy`, `mapUnit` and `scaleApplied: false`. `frameKey` is P's —
unchanged for an identity-operation boot, new for a map-conversion boot. A boot model that
fails to prepare gives the frame back when nothing is loaded and no other model has been streamed
in it (the deep review's item; one that has stands in it, and keeps it). Eight synthetic
fixtures of one building (`scripts/make-tiny-ifc.py` → `tests/fixtures/georef/`, the
repository's coordinates only) and IfcOpenShell's own reading of three of them. No visible
change: no element, control or copy. Five decision rows (and three 2026-09-20 rows amended), two
traps, `SYSTEM_SPEC.md` §5 and §7. Rule 4 (the `WorldCoordinateSystem`), the on-screen note for
a model that cannot be lined up and a read-only Coordinate-system card are part 2.

**Measured:** every ordered pair of the eight fixtures (56) federates within 1 mm — vertices,
element boxes, grid segments, storey heights — through the real index builder and streamer under
Node, and IfcOpenShell's `util.geolocation` puts every product of (a), (b) and (f) where
`mapPlacement` does. Against the build before, streamed under Node: 21 of 81 streams
byte-identical — every model alone, every pair of identity-operation models, every pair sharing
the boot's operation — and the other 60 are the mixed pairs this fixes. In the built app (a
scratchpad harness under `safe-run.cjs`, 1280 × 820, ratio 1, everything but the 3D canvas
hidden, 60 fps throughout): the mock in 9 states and `high-first.ifc` in 6, both themes, every
bitmap identical to the build before, and `tiny.ifc` in 6 — 11 of 12 at the harness's 1.6 s
settle, the twelfth an ortho → perspective flight caught 2 px (≤ 2/255) short of where it lands,
and all 12 identical at a 5 s settle; the baseline captured twice and the final build twice, each
reproducing itself. The pairs (a) + (b), (b) + (a), (a) + (f) and (g) + (e) loaded into one
window put the two `Slab L1`s 25 524, 23 453, 25 524 and 13.8 m apart before and **0.0000 m**
apart after.

**Verified:** `npm run typecheck` exit 0; `npm test` **144 files passed / 2 skipped, 2 812 tests
passed / 3 skipped** (34 new: 18 in `georef.test.ts`, 3 in `units.test.ts`, 6 in
`federation-store.test.ts` with a fake parse bridge, 2 in `render-selectors.test.ts`, 1 in
`ai-executors.test.ts` (`get_model_info`'s new fields), and the 4 of the new
`georef-federation.fixture.test.ts`, which fails against the old single-frame rule, against a
map unit ignored and against `Scale` applied); `npm run build` exit 0; `npm run test:e2e` **62
passed, 6 skipped** in 7.8 m — peak one process 239 MB, all 782 MB, GPU dedicated 277 MB,
`clean:`; nothing survived. The deep review's five fixes after that — the sub-context, the
hand-back, the `bbox` schema sentence, no IfcOpenShell version in the committed JSON, the
`rotationDeg` comment — were checked by typecheck, `npm test` and the generator run twice.

**Not verified:** a real model (none in `samples/`), macOS, and the owner's own pair of files.

## 2026-10-08 — with the canvas grid off, the ground veil is not drawn

**Did:** the owner: *"When off the canvas grid, please dont show the semi-opacity plane filter."*
— 2026-09-24's ground veil, which draws an opaque part below grade at 40 % of its contrast.
`buildScene` builds the veil with `visible = groundGrid`, and the rig's `setGroundGrid` sets it
beside the grid helper (`viewer/scene.ts`): a theme change keeps it, and every rig rebuild takes
the flag from `buildRig`. The opaque ground under it stays and takes the building's shadow. The
toggle needs nothing more: `invalidate()` was already there, and the veil casts nothing, so the
shadow map is untouched; the dev draw count is one less with the grid off (`viewer-core.ts`). The
assistant's `toggle_display` `groundGrid` goes through the same button action. The reading
taken — only the veil goes — is recorded as one the owner may still correct. Because the veil
also carried the ground's depth, with the grid off what is below grade is drawn as it is, edges,
glass and annotations included. One allowed-deviation entry, one decision line and row; the two
2026-09-24 entries and the "two layers" decision line amended.

**Measured** (a scratchpad harness under `safe-run.cjs`, built from `electron-guard.cjs` and the
parity DOM helpers: the mock, 1280 × 820, ratio 1, the 3D view, the canvas alone, the build
before against this one, each theme its own run, 60 fps throughout): grid on, eight states
byte-identical; grid off, 1 586 px with the whole federation and 6 954 / 6 958 (dark / light)
with only ARC and STR shown — every pixel's ray cast with the app's own picker: the turf's rim
astride the ground plane, the eight footings (−1.0 … −0.5 m), the ground slab's rim and eight
column stubs below grade, or within 1–4 px of such a hit, but one pixel on a far IFC gridline.
On the bare ground, 258 px: the far IFC gridlines no longer lose samples to the veil's depth.
With the level rings on and only ARC and STR shown, the `Foundation` ring at −1 m now shows
through (2 112 px). With the grid off, unloading the site model rescaled the scene and rebuilt
the rig, and the new veil came up hidden. The building's shadow on the ground in the ARC + STR
view, 28 146 / 28 156 px, is the build before's, pixel for pixel. The tool's frame and the
button's are identical.

**Verified:** `npm run typecheck` exit 0; `npm test` **143 files passed / 2 skipped, 2 778 tests
passed / 3 skipped** (3 new in `ground-level.test.ts`, each failing against the old
`scene.ts`); `npm run build` exit 0; `npm run test:e2e` **62 passed, 6 skipped** in 8.0 m, the two
canvas-grid cases in `smoke.spec.ts` unchanged among them — peak one process 240 MB, all
786 MB, GPU dedicated 253 MB, `clean:`; nothing survived.

**Not verified:** a real model (none in `samples/`), macOS, and the owner's reading of the
request.

## 2026-10-05 — published as `sgvue/sgvue`; the first CI run's one error fixed, and the docs tidied

**Published.** SGVue is open source at https://github.com/sgvue/sgvue (Apache-2.0): one commit,
`27fb7ee` — this repository's first, and the one hash in these notes that resolves here — made
from the tree the entry below prepared, after its review, and authored as Yong Yen. The private
repository keeps the history before publication as an archive; it is not published. Switched on
in the repository's settings: private vulnerability reporting, secret scanning with push
protection, Dependabot alerts and security updates, CodeQL's default setup, a read-only default
token for workflows, and a ruleset, "Protect main", that blocks deleting `main` and
force-pushing to it. This PC's checkout now has the public repository as `origin`. The same day
the redesigned download page went live on the product site (commit `2772199` of the site's own
repository).

**The first CI run.** Windows passed; macOS and Ubuntu failed at `npm test` although every test
passed (142 files and 2 773 tests passed, 3 and 4 skipped): vitest reported one unhandled
`EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending`,
from `tests/unit/federation-store.test.ts`. **The cause:** every commit and every removal in
`FederationController` queues an SQL index build behind a timer (`rebuildSql`, behind
`afterPaint`'s `setTimeout`); Node has no `Worker`, so each build fails and logs
`[sgvue] SQL index unavailable`. The file's tests never wait on a timer, so its twelve builds
started only once vitest yielded after the last test: the CI log shows eight of their logs
arriving as the file finished and four after it, the last still on its way when the worker's
RPC was closed. **The fix, in the tests only:** `disposeFederation(fed)`
(`tests/unit/stub-viewer.ts`) asks the controller for a query — which waits for its newest
build — disposes it, so every build still waiting returns before it starts, and resolves once
that chain has run out. `federation-store.test.ts` calls it after each test, and so do the two
`FederationController` blocks of `replace-pick.test.ts`, whose six builds used to fail and log
inside a later test (P9). No app code changed.

**The other files.** A temporary audit — a vitest setup file, not committed — recorded every
real timer a test left behind, the handles still active at each file's end and any log after
its last test. Before: twelve late logs and eight pending timers in `federation-store.test.ts`;
four timers in `replace-pick.test.ts` whose builds logged in P9; flash timers still pending
when the file ended in `ai-parity-3.test.ts` (`link copied`, 1 600 ms; `Copied`, 1 400 ms),
`schedule/manage.test.ts` and `schedule/exporting.test.ts` (the Schedules window's 2.6 s
toast); and in `ai-parity.test.ts` a stub `openSchedules` that joined the window again on its
second call, on a 20 ms timer that fired in a later test — main's own call only brings an open
window forward, and the stub now does the same. The flashes and toasts now run on a fake clock
that their file's `afterEach` drops. None of those four logged, so none could have caused the
CI error. After: no test leaves a timer behind, no file ends with one pending, and nothing logs
after a file's last test. Four main-process test files still end with a file-system request
completing (`FSReqCallback`, `CloseReq`); the modules they test log nothing.

**Docs and settings.** `docs/COMMANDS.md` and `CLAUDE.md`: `npm run dist:mac` needs
`node node_modules/electron/install.js` first. `scripts/ai-eval.cjs`'s flag list names
`--no-report`. The citations of `eval-audit.md` and `build-eval.md`, documents of the external
evaluation toolkit, are gone from the code and from two of three places in `docs/AI_EVAL.md`;
the one kept, where the oracle and null modes are introduced, says it is external and not
included here. `CONTRIBUTING.md`: the tests make no network call, and only the first `npm test`
may download Electron's binary. `.github/dependabot.yml` proposes no major version update for
any dependency, npm or Actions — four major-upgrade pull requests (TypeScript, Vite,
`@types/node`, `@vitejs/plugin-react`) arrived within minutes of publishing; security updates
are unaffected. Two rows in `docs/DECISIONS.md` and their index lines; one new rule in
`CLAUDE.md`: the public repository is the source of truth.

**Found doing it.** vitest 5 runs in its agent mode when it finds an AI agent's environment
(`AI_AGENT`), and then prints no console output for passing tests — one reason the SQL warning
was not seen locally. The runs below used `--reporter=default`, as CI does, unless said
otherwise.

**Verified:** `npm run typecheck` exit 0. `npx vitest run tests/unit/federation-store.test.ts`
30 times: 30 clean — 10 passed, no unhandled error — and 30 more under the agent reporter.
`npm test` 5 times with the default workers and 5 with `--maxWorkers=3`: every run 143 files
passed / 2 skipped, 2 775 tests passed / 3 skipped, no unhandled error, no SQL log. **The race
reproduced here, and gone:** with the full suite running beside an old copy of the test and an
old-style test with a longer build chain, 3 of 6 runs ended in CI's error, each from the longer
chain; beside the same two in the new style, 0 of 6. With one more log at a file's end, the old
`federation-store.test.ts` failed 2 of 30 runs under the agent reporter and the longer chain 2
of 30 under the default one; their new versions 0 of 30 each. The Dependabot file parses
(js-yaml and PyYAML). **Not verified here:** GitHub's macOS and Ubuntu runners themselves.

This is the 22nd entry; as with the 21st, the oldest is not compressed, because the public
repository starts without the history that would hold its full text.

## 2026-10-05 — prepared for open source: Apache-2.0, notices generated and shipped, ad-hoc-signed macOS builds, the documents a stranger reads, CI

**Why:** the owner: *"prepare our sg vue repo for open source on github. propose license for me
and setup everything properly like a industry standard."* Of four questions the owner chose the
Apache License 2.0; a fresh public repository, `sgvue/sgvue`, whose first commit is this tree,
authored as Yong Yen (the private history stays private); and macOS installers built by GitHub
and tested by the owner. Prepared in a worktree from a read-only audit made the same day (not
part of the repository); **nothing was committed, pushed or published**, and no Electron was
started. Seven decision rows in `docs/DECISIONS.md` (2026-10-05) carry the reasoning.

**Did — privacy and provenance.** The real Windows profile name out of 19 lines in 7 files, as
`Jane Doe` / `JANEDO~1` (a long spelling with a space and its 8.3 short form, so each test means
what it meant); the real models' Revit proxy names, storey names and a long level name replaced
by synthetic ones of the same shape and length (`src/shared/site.ts`'s comment with them); the
earlier Mac's home paths, 31 of them, replaced by the projects' names — Marumi, Aquila, ifcgref.
Five vendored files of unknown licence removed — the design tool's runtime (twice) and two
starter components, and the eval's HTML report builder — with everything that used them still
working: the trace fixture writes out its three Penner easings and `clamp`, `ai-eval.cjs` writes
JSON only (`--no-report` still accepted, as a no-op), the design README says the prototypes are
read as source, the parity-prototype harness says it needs the runtime, and `.gitignore` keeps
all five out.
`design-reference/ask-vee/fonts/OFL.txt` beside the six IBM Plex fonts.

**Did — licence and notices.** `LICENSE` (Apache-2.0, byte-identical to three copies in
`node_modules`), `NOTICE` (the copyright line, the trademark line, ifcgref and three.js's
`LineSegmentsGeometry`), and `THIRD_PARTY_NOTICES.md` from the new
`scripts/third-party-notices.cjs` and its recorded data, `scripts/third-party-notices.json`: 104
components — MIT 87, ISC 6, BSD-3-Clause 3, OFL-1.1 3, MPL-2.0 2, and one each of MIT AND
BSD-3-Clause, MIT OR GPL-3.0-or-later and Unlicense — in 25 distinct texts: the nine packages in
`app.asar`, the eleven Vite bundles (equal to a source-mapped build's chunks), Vite's helper
code, exceljs's 68 embedded packages (41 read from registry tarballs), web-ifc.wasm's eight C++
libraries, Electron, `elevate.exe` and ifcgref. `tests/unit/third-party-notices.test.ts` holds
the file to the generator. `electron-builder.yml`: `extraResources` for the three files and, on
macOS only, for Electron's `LICENSE` (as `LICENSE.electron.txt`) and `LICENSES.chromium.html`,
which electron-builder deletes there; the new root documents kept out of the archive,
`copyright` stated; `package.json`: `license`, `homepage`, `repository`, `bugs`, `engines`
(`>=22.12`), with npm's four-line lockfile update.

**Did — macOS, documents, furniture.** `mac.identity: '-'` and `hardenedRuntime: false`
(ad-hoc signing). README rewritten for a stranger; CONTRIBUTING, CODE_OF_CONDUCT (Contributor
Covenant 2.1), SECURITY, SUPPORT, CHANGELOG and `docs/RELEASING.md` new; `docs/SYSTEM_SPEC.md`
§3's first-launch sentence (Open Anyway on macOS 15) and §11; two lines atop `CLAUDE.md` and
seven index lines; `docs/COMMANDS.md` and `docs/AI_EVAL.md` brought in line. `.gitattributes`,
`.editorconfig`, `.nvmrc`, issue and pull-request templates, Dependabot, and two workflows — CI
on Windows, macOS and Ubuntu, and release builds that publish nothing — every action pinned to
a commit SHA. The demo-building screenshot from the product site as `docs/images/`.

**Found doing it.** (1) A fresh Windows checkout is CRLF, and `tests/readonly-guard.test.ts`
failed one test on it at the baseline; `.gitattributes` (`eol=lf`) fixes it, and
`git add --renormalize .` changes nothing in the index. (2) On macOS electron-builder deletes
Electron's `LICENSE` and `LICENSES.chromium.html` from the build (`electronMac.js`); the
mac-only `extraResources` above puts both in `SGVue.app/Contents/Resources/` — to be confirmed
on the first `dist:mac` (`docs/RELEASING.md`, `docs/SYSTEM_SPEC.md` §11). (3) Upstream ifcgref's
`app.py` (tudelft3d/ifcgref, read today) has no `check_corenet_sg()`: the function SGVue ported
was in a modified copy; `NOTICE` credits "a copy of ifcgref".

**Verified:** `npm run typecheck` exit 0; `npm test` **143 files passed / 2 skipped, 2 775 tests
passed / 3 skipped** (the baseline at `31a2e88`: 142 / 2 773 — one new file, two new tests; the
script-parse test checks one script fewer and one more); `npm run build` exit 0;
`npx electron-builder --win --dir`: `resources/` holds `LICENSE`, `NOTICE` and
`THIRD_PARTY_NOTICES.md` byte-identical to the repository's, `app.asar`'s top level is
`node_modules`, `out`, `package.json` with the same nine packages, `asar-contents.test.ts`
passes, and `SGVue.exe` reads `Copyright © 2026 Yong Yen`. The privacy search over every file
that would be published found none of the private strings: the only hits are third parties'
addresses in the notices and three coincidental byte runs inside compressed image data.
**Not verified here:** a macOS build (no Mac), the two workflows (they run only on GitHub), an
NSIS installer build (`--dir` only) and the end-to-end suite (no Electron was started).

This is the 21st entry; the oldest is not compressed this time, because the public repository
starts without the history that would hold its full text.

## 2026-10-02 — 1.2.0 prepared: the version, the release notes, an installer verified without being run, the product site and the releases page

**Why:** the owner, 2026-10-01: *"Continue until you finish everything, then installer and push
both repo and releases. Add system specification on the release landing page as well."* — and,
of the reading that "system specification" means the requirements a user needs: *"correct. I
will test the installer myself"*. This run prepares and verifies; committing, tagging, pushing
and publishing follow its review, and the installer is the owner's to run. **No behaviour of
the app changed**: the only source change is the version number.

**Did — this repository.** Version **1.2.0** (`package.json`, both root entries of
`package-lock.json`). `docs/releases/1.2.0.md`, in a new folder: the release notes in 1.1.0's
voice — Vee and what it can now do, and that it asks first; two section cuts at once; the
tidier window; the update notice; four fixes — then the system requirements and 1.1.0's install
paragraph. `README.md`: the opening sentence names schedules, both cuts and Vee; the version;
the Windows installer described as the wizard it has been since 2026-09-28 (it still said
one-click, and "not yet run on a device"); `docs/releases/` in the table. `docs/SYSTEM_SPEC.md`:
the header's version (it read 0.1.0 · Phase 4); §3's file-size row states the per-file 600 MB
limit and its Memory row says which of its thresholds are not built; one dated 1.2.0 line in
§3's status note and one in §11's; and the two stale numbers — 2 773 tests in 142 files, and
thirty-six frame triggers, counted in the script (36 `trigger(` calls), in §11's command table
and in §7's prose, which said twenty-eight too. One Decisions line in `CLAUDE.md`, one row in
`docs/DECISIONS.md`. The oldest entry here, 2026-09-25's 1.0.3 merge, is compressed into
Earlier work.

**Did — outside this repository** (two working copies in the session's scratch folder; this run
committed and pushed nothing). *The product site:* a "System requirements" section between
"What it does" and "Install and update" — a label / value list in the page's own tokens, one
column on a phone; "Ask SGVue" → "Ask Vee" in the card, the privacy paragraph and the alt text;
the Sections card says a gridline cut and a level cut can be used together; step 4 says the
home page tells you when a newer version is out and that Check for updates opens that page; the
privacy paragraph says what the launch-time check shows GitHub — the IP address and which SGVue
version is asking, and nothing from the files or models. Its eight images — `hero`
(2160 × 1350) and `hero-1080`, `federation`, `schedules`, `ask`, `section`, `spot`, `og.jpg` —
are captured again, at the sizes and in the formats of the files they replace. *The releases
page:* the README's new text — the same system requirements, and Check for updates opening the
product site from 1.2.0.

**The pictures — how.** The **production build**, the real main process and the landing page's
own demo building, on a fresh profile, through the guarded e2e runner with a spec and a config
kept in the scratch folder (`npm run test:e2e -- --config <file>`: the later `--config` is the
one Playwright takes, the guard is unchanged, and the repository gains no file). This display
is 1×, and `capturePage` hands back 1× whatever the page drew, so each frame is taken through
the DevTools protocol at a device scale factor of 2 (`Emulation.setDeviceMetricsOverride`,
`Page.captureScreenshot`: 2560 × 1600 for a 1280 × 800 window), under `prefers-reduced-motion`
so that nothing is caught half-way; Pillow then crops, resizes with Lanczos and encodes WebP
(quality 84) and a progressive JPEG. Every state is reached through the app's own controls: a
click on a wall; the Filter card's highlight step for `IfcWindow` (55 of 412); the Section
card's grid C, `flip side` and level L2, then a drag to pan; the spot tool on the roof
(`▽ +14.500`); the Schedules button, `IfcWindow` in its rail, and the `Family` column — empty
on the demo building — taken out with its own ×. The reply in the Ask Vee picture is a
**scripted turn**, as `vee-trace.spec.ts` scripts one, with no API and no key: the question and
the answer's sentence are written, and `query_elements` ran on the demo building through the
app's own executor, so `checked 80 walls · 8s`, `24 found` and the five level rows are the
app's. Each of the eight files was decoded and looked at before it was kept: the demo
building's own names and nothing else (`Block 1`, `SB_ARC_R25.ifc` …), no recent file, no path,
no dev overlay, no frame caught half-drawn.

**Verified.** `npm run typecheck` exit 0; `npm test` **142 files passed / 2 skipped, 2 773
tests passed / 3 skipped** — the counts before the bump, and again once the package and the
documents were finished. **Fourteen full runs in all, twelve of them passing: two failed**, the
third and the fifth, in `tests/unit/settings.test.ts` only — three tests, then one — and each
time on the same line, `renameSync` in `src/main/settings.ts` answering `EPERM: operation not
permitted` (Found, 4). Both came within minutes of a 1.7 GB scratch folder being written and
deleted under the system temp directory, where that test writes too; the nine runs after them
passed, and the file alone 10 of 10. `npm run dist:win` exit 0 → `dist/SGVue-1.2.0-setup.exe`,
**115 432 324 bytes**, SHA-256
`966b4872ca85e8681e35359f1204242cb0763d967880068ad99e2b8886d8df3d`. It is packaged **before**
the e2e suite is run: `packaged.spec.ts` holds the packaged app's version to `package.json`'s,
so a stale `dist/` fails it. `npm run test:e2e`, two guarded runs: **62 passed, 6 skipped**
(smoke 30, 3.7 min; the other eight specs 32 + 6 skipped, 3.3 min) — peak one process 231 MB,
all 763 MB, GPU dedicated 283 MB, `clean:`. `npm run test:packaged` **1 passed, 2 skipped** —
185 MB one process, 532 MB all, GPU dedicated 208 MB, `clean:`. **The installer was not run.**
Its payload, extracted with electron-builder's own 7-Zip, is **75 of 75 files
SHA-256-identical** to `dist/win-unpacked` (409 159 247 bytes); the `.exe`'s version resource
reads FileVersion and ProductVersion `1.2.0` (`1.2.0.0`), product `SGVue`, company `Yong Yen`,
and it is `NotSigned`; `app.asar`'s own header lists `node_modules`, `out`, `package.json` and
nothing else, its `package.json` reads `1.2.0`, and both `.wasm` files are `unpacked`. `out/`
is the build that was packaged: 94 of 94 files identical to the archive's copies, and no
`__sgvueDev` in the bundle. The documents were finished after the package was made, and none
of them is in it: the final tree packaged again into a scratch folder (`electron-builder --win
--dir`, `out/` not rebuilt) gives all 2 903 entries of the built archive with identical
content and no `docs/` entry — that scratch archive also swallowed this repository's own
`dist/`, electron-builder leaving out only the output folder it is writing to, which is the
check's artefact and not the tree's. A case-insensitive byte scan of the 75 payload files and
of the setup `.exe`, as UTF-8 and as UTF-16LE, found **0** hits for the owner's private
identifiers — among them the Windows account name, the e-mail handle and both spellings of the
profile path; `Yong Yen`, the credited name and the scanner's control, was found (payload 4,
setup 2). *The site,* served from a static server on
127.0.0.1 and opened in one guarded window — light and dark at 1280 and at 380 px, light at
760, the `?v=` banner for an older, this and a malformed version, the 404 page, the theme
toggle: 0 console messages, nothing wider than the page, one external request (GitHub's latest
release, the one the page always made), the download button resolving to the published 1.1.0
asset, `?v=1.0.0` → "Update available", `?v=1.2.0` → "You're up to date … newer than the latest
release". Fifteen guarded runs in all, one at a time, the machine checked before each; none
tripped and nothing survived any of them.

**Found, not changed.** (1) `docs/SYSTEM_SPEC.md` §3 and §5 say a warning appears around 600 MB
of model data and loading is refused above 1.5 GB. Neither is in the code: what is enforced is
a per-file limit of 600 MB (`MAX_FILE_BYTES` — main's admission, the upload row's
`larger than 600 MB`, an `.ifczip`'s inner file). §3 now says so; §5's sentence and its Phase 1b
note stand as they were. Only the per-file limit is published. (2) In the Schedules window, in
the dark theme, a white 8 × 8 px square stands where the table's two scrollbars meet:
`design.css` styles `::-webkit-scrollbar`, its thumb and its track, and not
`::-webkit-scrollbar-corner`. The site's picture is cut above it. (3) Not the app's: a DevTools
emulation command sent through `webContents.debugger` to a window that has not yet loaded a
page ends Electron 44.3.0 natively — exit 127, no JavaScript error. Two runs of the scratch
site check died on it before that script loaded a page first; neither was a guard trip, and
nothing survived. (4) **`settings.ts` writes with one `renameSync` and no second try.** Its
`write()` puts the JSON in `settings.json.<pid>.tmp` and renames it over `settings.json`; on
Windows a rename onto a file another process still holds open answers `EPERM`, and nothing
catches it. Which process held it was not found out — most likely a virus scanner reading what
had been written a moment before. Seen only in the unit test, in 2 of 14 full runs, while the
machine was busy with a large temp folder; in the app the same throw would come out of a
Preferences save or a key being stored, and leave the `.tmp` beside the file. `sessions.ts`
keeps its queue going past a failed save and `exports.ts` removes its temp file and reports the
failure; `settings.ts` does neither. Not fixed: this run changes no behaviour.

**Not done, and limits.** The installer was not run. No macOS build was made, and nothing
public mentions one. No live assistant run, and nothing public says the assistant's answers
were tested. `frame-triggers.cjs` and the evaluation suite were not run again: no source
changed, and both need a dev-tools build, which would have replaced the `out/` that was
packaged. A packaged launch makes the one update request; this run's two packaged launches
were not watched on the wire, and with GitHub's latest at 1.1.0 no notice is drawn for 1.2.0
either way. The site's pictures were taken at one size and scale (1280 × 800 at 2×; the
Schedules window at 1084 × 760), in the dark theme only, as the pictures they replace were.
Nothing is committed, tagged, pushed or published.

## 2026-10-02 — the refactor pass: phase 4's review leftovers, two small fixes, and the survey's invisible items

**Why:** the owner: *"After you done, look for refactor opportunities."* A read-only survey at
`157bdfb` sorted what it found into three classes. This run is its class A — what is invisible
and behaviour-preserving — less the shared test harness, left for later; classes B (the owner's
choice) and C (leave) were not started. First, the nine non-blocking items the two reviewers of
phase 4 left, and two small fixes found on the way. Three parts, three rules: the leftovers and
the fixes change exactly what they say; the refactor changes nothing anyone can observe.

**Did — the leftovers.** (1) The gate-marker Decisions line and its row say fourteen gated
calls, three dialogs, three confirmations. (2) The guard refuses an **alias** of the store's
`up` under `renderer/ai/`: `.up` may be named only as the direct call `.up(` — `const u = s.up`,
`s.up.bind(s)` and `.up (` passed the three earlier rules. (3) The eval's `op-place-measure` is
graded on **where** the measurement was taken: the runner's observation carries each
measurement's point in the file's own metres (`VIEW_EXPR`, `p`), and `measureZ` is the spot
check's twin (`graders.cjs`). (4) The revert entry and the placed-markup row say that a turn
stopped, or failed, after it placed a markup leaves it in place with no reply to revert it.
(5) `manage_schedules`' operations that act at once answer `busy` while a **native** Save or
Open dialog of the Schedules window is up, as under its own confirm (`manage.ts`, `dialogUp()`).
(6) `export_schedule` is refused `busy` while that window's confirm or prompt is up
(`exportRefusal`; *amended before the release: or its native Open dialog is — it asks
`fileDialogUp() || dialogOpen()`*), so no Save dialog is raised over a question still waiting.
*Read, as asked:*
the user's own Export menu cannot be reached under that card — its scrim is `position:fixed;
inset:0` at z-index 60 over the header and over an open menu (z-index 10), and Tab is trapped in
the card — and its action calls `EXPORT_ACTIONS` directly, never `exportRefusal` (one caller:
`main.ts`' `exportFromChat`), so nothing changes for a click. (7) `apply_visibility`'s
blank-view refusal says what to check by what named the set: *the ids*, *the selection*, *what
the open schedule lists*. (8) The guard requires every `postMessage(` call in
`schedule-link.ts` to be one of the literal-typed ones its pinned list is read from (eight of
eight today). (9) A doubled comma in `docs/DECISIONS.md`.

**Did — two fixes.** The seven wall-clock bounds of `marks.test.ts`' "a long reply" are
1 000 ms, with the reason in a comment: they guard a regression three orders of magnitude over
(200 kB took 44 s; the work takes about 4 ms), and at 100 ms one failed once in a full run on a
busy machine. And `apply_visibility`'s `selection` input read *"true act ons what the user
currently has selected"*: `idTargets`' template put the third person's s on the end of the
phrase; it goes on the verb's first word now, and all three sentences are pinned
(`acts on` · `selects` · `colours`).

**Did — the refactor, eight items, none left undone.** *Every script parses*
(`tests/unit/scripts-parse.test.ts`, new): `node --check` on each of the 23 files under
`scripts/`, Node only, and no file holds a NUL byte. *The two raw NUL bytes* in
`scripts/ai-eval.cjs` — between the parts of the `done.set(…)` and `already.get(…)` keys — are
the escape `\u0000`: the same string, and the file is text again for git and for a search.
*`design.css` is pinned to the design's `<style>` block* (`tests/unit/design-css.test.ts`, new):
line for line, less exactly the three keyframes whose removal is recorded; the two files differ
by nothing else today. *The trace's layout planner is `ai/trace-plan.ts`* (386 lines; `trace.ts`
1 157 → 857): moved verbatim by a script, with the five leaf values both files need; `trace.ts`
re-exports every moved public name, so no importer changed, and the planner imports nothing
from `./trace`. *Four unreferenced exports are gone* — `visiblePredicate` (with two imports it
alone used), `hostileNotes`, `SchemaCategory`, `AttrKey` — each searched for first;
`schedule/ifc/entities.ts` was left alone. *The visibility frame is computed once*: the
selector counts in a loop, and `visibilityFrameOnce` — one remembered answer, keyed on the
identities of its five inputs — is what the frame and the pill both call in place of a
`useMemo` each. *`App` no longer renders for the screen-reader summary*: `SceneSummary`, in the
same file, holds that one subscription and returns the same `<p id="sgvue-scene">` in the same
place. *Docs that had drifted*: `SYSTEM_SPEC.md`'s deviations table points at `CLAUDE.md` as
the one complete list, its "three user-requested exceptions" sentence and its "copied verbatim"
sentence are current, installer names read `SGVue-<version>-…` in four files, and
`COMMANDS.md`'s "25 tools" is dated.

**Measured.** *The planner's move:* all 92 top-level declarations of the old `trace.ts` are in
exactly one of the two files with their text unchanged; the only edited lines are one doc
comment that described two constants, and `export` on four plan types and two functions;
`ai/trace` exported 73 names before and exports the same 73. *The summary's DOM, the build
before against this one* (mock federation, 1280 × 820; nothing selected, one element selected,
a storey isolated, reset): exactly one `#sgvue-scene`; parent `main[data-role=stage]`; index 1
among the stage's children (six at rest, seven with the property card or the frame up), between
`canvas[data-role=viewport]` and `div[data-role=overlay]`; attributes `id`, `class="sr-only"`;
one text child; 1 × 1 px; the
same markup, e.g. `A 3D view of Block 1: 4 models, 412 elements, 6 storeys. 412 of 412 visible.
Ext Wall S A-B L1 is selected.`; referred to by the canvas's `aria-describedby`, which resolves
to it — **identical in all four states.** *And what the change is for:* with another element
selected while the card stays open, and with other storeys isolated while the action bar
stays, `App` rendered before (the stage's props object was replaced) and does not now; it still
renders when a lane changes. *The cached prefix:* tools block 54 774 B, contract 21 497 B —
**before and after**; the typo's fix moved one letter, so the tools block is rewritten to the
cache once. *The eval's new check, in the built app*, through the runner's own expression and
the real grader: a measurement placed on the Ground Slab at `top` is observed at `p [12, 9, 0]`
and passes; at `centre` (z −0.1) and `base` (z −0.2) the count passes and `measure-level`
fails. *The bundles:* main renderer 1 637 kB, Schedules 123 kB, as before.

**Tested, on the final tree.** `npm run typecheck` exit 0. `npm test` **142 files passed / 2
skipped, 2 772 tests passed / 3 skipped** (140 / 2 710 before): `scripts-parse.test.ts` (new,
48), `design-css.test.ts` (new, 3), `ai-eval-graders.test.ts` (+5), `render-selectors.test.ts`
(+3), and one more each in `schedule/exporting.test.ts`, `ai-messages.test.ts` and
`ai-tools.test.ts`; the guard test's two new rules and `manage.test.ts`' native-dialog case sit
in existing tests. `npm run build` exit 0. `npm run test:e2e`, two guarded runs of the
production build: **62 passed, 6 skipped** (smoke 30, 4.1 min; the other eight specs 32 + 6
skipped, 3.6 min) — peak one process 236 MB, all 783 MB, GPU dedicated 270 MB. Evaluation
suite, no API, fresh scratch folders, no report: **oracle 66 / 66** — in two invocations, the
second resuming the first and skipping exactly its eight cases, which is the `\u0000` key at
work — **null 0 / 66**. `node scripts/safe-run.cjs frame-triggers.cjs`: all **36** triggers
repainted, at rest 0 renders, 410 trace frames with 0 scene renders, the loop idle after the
answer. Eleven guarded runs in all, one at a time, the machine checked before each; none
tripped and nothing survived any of them. `out/` holds the production build.

**Not done, and limits.** No live assistant run. The eval's runner, cases and graders changed,
so its harness sha did: the next live run needs `--approve-harness`. On the mock the scene's
offset is zero, so the runner's `point + offset` is by reading, not by measurement. The
frame's "one pass" is held by the unit test, not measured in the built app.
**Seen, and left for the orchestrator:** in `manage.ts` the four later `dialogUp()` checks can
no longer be true; the guard's `postMessage` count does not see an alias of the method;
`SYSTEM_SPEC.md`'s command table still says 832 tests and twenty-eight frame triggers; and
`marks.test.ts`' titles still say "well under 100 ms". (Two more stood here until the review —
`export_schedule`'s `busy` sentence, and `s['up']` — and are closed below.)

**After review — five small things, no behaviour but one sentence.** (1) `export_schedule`'s
words for `busy` are true of both its causes: *The Schedules window is busy — an export is
already under way (its Save dialog may be open), or one of that window's own dialogs is still
waiting for an answer. Nothing more was asked for; the user finishes or cancels that first.*
They said only that an export was under way — and since (6) above the same answer comes back
while that window's confirm or prompt is up, so the model would have sent the user to finish a
Save dialog that is not there (`executors/schedule.ts`; both pins in `ai-schedule.test.ts`; the
2026-09-28 row's meaning of `busy` carries the amendment). (2) `ChatPanel.tsx`'s comment says
where `J` is declared — `ai/trace-plan.ts`, re-exported by `ai/trace`. (3) The guard's `up`
rules see a **computed member** — `s['up']`, `s["up"]`, a template quote, with `?.` or spaces
— which has no `.up` and so passed all four; `['upload']` does not trip it, and nothing under
`renderer/ai/` did. (4) The `selection` pin's negative reads the one sentence that had the slip
(`act ons`), where it searched every description for the word `ons` and would have failed on a
legitimate "add-ons". (5) The tests that run `node --check` are given the child's own 30 s by
vitest (three times that for the one that runs three): vitest's 5 s default is checked when a
synchronous test returns, so `execFileSync`'s 30 s could never be the bound that applied.
**Measured:** a probe file under `renderer/ai/` calling `s['up']({ views: [] })` passed every
earlier rule and failed the new one; a test blocking for 5.6 s fails at 5 000 ms without the
option and passes with it (both probes removed). The cached prefix is unchanged — tools block
54 774 B, contract 21 497 B: (1) is a tool result, not a description. **Tested:** `npm run
typecheck` exit 0; `npm test` 142 files passed / 2 skipped, 2 772 tests passed / 3 skipped — the
same counts, since every change sits inside an existing test. No build and no e2e in this
round, so **`out/` is one string behind the source** — the `busy` sentence — until the next
build. *Left as it is:* the catalogue's description of `export_schedule` ends "Refused while
another export's dialog is open", which is still true and names one of the two reasons;
`exportRefusal` does not ask whether that window's native **Open** dialog is up (`opening`),
which `manage.ts` does through `fileDialogUp()`. (All three — these two and `marks.test.ts`'
titles, above — were closed before the release: `exportRefusal` as amended in (6), with a
test that fails without it; the description ends "Refused while the Schedules window is busy
with an export or one of its own dialogs." — tools block 54 774 → **54 810 B**, contract
21 497 B unchanged; the two titles say "well under a second". No build, so `out/` is behind by
these too.)

## 2026-10-02 — Assistant parity, phase 4 of 4: the Schedules window, and placing markups

**Why:** the owner, 2026-10-01: *"assistant should possess everything user can do on the app."*
The last of the audit's four phases: what the user does in the Schedules window that
`make_schedule` could only keep, the window's own controls, and placing a markup — which until
now needed a click on the model. First, the five leftovers of phase 3's review and the chat
table's `copy csv`, which the owner then asked for directly.

**Did.** *Leftovers:* a call for a turn that is no longer live is **not run when it would change
the view** — every `kind: 'view'` tool is answered *The turn was stopped, so nothing was
changed.* (`ai/bridge.ts`, `staleAnswer`; a read still runs); the guard also refuses a **bare**
`up(` under `renderer/ai/` (the action taken off the store by destructuring); the eval's
`NEGATION` takes the typographic apostrophe; two `\b` in the prompt's test were literal
backspaces since 20c55f2, so its "no shouting" check matched nothing — they are `\b` again.
(The consent gate's deviation entry already carried "reverting a reply takes its row with it"
— commit 157bdfb — so nothing was added there.)
*`copy csv`:* below.
*The Schedules window — its definition:* `make_schedule` gains `filterLogic`, `itemize`, per
column `hidden`, `decimals`, `unit`, `align` and a place (`after`), and `calculated` columns —
a formula in the engine's own grammar, or a share of a field's total — each by the tab's own
rule (`schedule/assistant.ts`, `buildSchedule`): a unit only from the list the Format tab offers
for what the column measures, decimals only on a number, a formula the calculated-value editor
would mark bad refused with **its** reason (`calcProblems`, moved into the engine so the editor
and the tool share it); `get_schedule` reads every one of them back.
*Its rows, as a set:* `schedule: true` beside `ids` and `selection` on `apply_visibility`,
`select_elements`, `color_by_property` and `request_user_action`'s `copy_guids`
(`ai/executors/targets.ts`) — the engine run in the main renderer over the open definition, then
the store's own guarded actions. **Never the port's `act` message**, which has no scope guard.
*Its own controls:* one new view tool, **`manage_schedules`** — `open`, `undo` / `redo`,
`templates` / `apply_template`, `saved_list` / `load` / `save` / `rename` / `duplicate`, and
three that only **ask**: `delete` (that window's own confirm, labelled `Ask Vee`), `print` (that
confirm too, before the print dialog — the follow-up, below) and `open_file` (the native Open
dialog). Two new port messages, `manage` and
`manageAck` (`schedule/messages.ts`), strict and bounded; the handler bodies moved out of
`schedule-ui/events.ts` into `schedule-ui/actions.ts`, unchanged, so a request and a click run
one function (`schedule-ui/manage.ts`). 37 tools; fourteen gated calls.
*Placing markups:* `manage_markups` gains `place_spot`, `place_measure` and `show`. The viewer's
click handler and two new `Viewer` methods share one commit each (`viewer-core.ts`,
`commitSpot` / `commitLaser`), so a placed markup is the record, the labels and the number a
click makes, and the laser's rays are the laser tool's. The point is named: the middle of an
element's bounding-box top, of the box, or of its underside (`shared/annotate.ts`, `boxPlace`),
or a project-frame point.
*Prompt:* two lines (37), and three added lines reworded where they had become false. *Ticker:*
a phrase for each new operation. *Eval:* three dry-run cases (66); the fingerprint sees the
markups. Nine rows in `docs/DECISIONS.md`; in `CLAUDE.md` the Schedules deviation, the consent
gate's and the revert's amended, nine new Decisions lines and eight amended ones;
`docs/SYSTEM_SPEC.md` §8, §9 and §10; `docs/AI_EVAL.md`; `docs/COMMANDS.md`.

**The chat table's `copy csv`** (owner-requested). *What was wrong:* the design's line for it
(`SGVue.dc.html:2029`) calls `navigator.clipboard.writeText`, which this app always refuses
(phase 3's measurement), so the control copied nothing and said nothing. *What changed:* the
button calls the store's `copyTable`, which goes through the one `copyText` from the user's
click. **No flash, as designed** — the control has none; a copy that did not reach the clipboard
is said in the panel's status line (`CLIPBOARD_REFUSED`), and a later success takes that
sentence away. No new element, no new control, the same copy and style string. *Shown by:*
`clipboard.test.ts` (+4) and, in the built app, `consent-gate.spec.ts`'s new test — a reply
carrying `summarize_elements`' table, a real click on its `copy csv`. **Measured:** the machine's
clipboard then holds exactly `tableCsv`'s text, 7 lines (`Level,count,quantity`,
`"L1",112,1773.48`, `"L2",92,502.76` …), and the status line stays empty; the same button
clicked by nobody (no user activation) leaves the clipboard as it was and the status line says
*The clipboard could not be written, so nothing was copied.*

**Not as briefed, on purpose.** (1) **`schedule: true` over the bound was refused whole**, with
the count it lists and how many over — never cut to the first 2 000. "Bounded as `ids` is" is
what `ids` does (`inputs.ts`: refused "rather than a half-applied view"), and a view of part of
what a schedule lists is a wrong answer to the question. *(The follow-up, below: the set is not
bounded at all.)* (2) **A save or a duplicate that would
take a saved setup away only asks** — found, as the brief told to look: a Save replaces the
setup the schedule was loaded from, and at the cap of a hundred the oldest is pushed out
(`forgottenBySave`, `forgottenByDuplicate`). The user's own Save is unchanged; one asked for from
chat raises that window's confirm first, and is re-checked at the click. (3) **A request carries
when it was asked** (`at`), and the Schedules window drops one older than 2 s while the asker
waits 3 s: a renderer held up by its print dialog works through its queue afterwards, and must
not then save or print for a turn that gave up. (4) **Only a name that can be shown crosses the
port** (`SafeName`: ≤ 200 characters, no control or direction character); a saved setup with any
other name is counted in `saved_list`, never sent. (5) **`load` and `apply_template` from chat
do not ask "Replace the current schedule setup?"** — as `make_schedule` never did: the
replacement is one step on that window's undo history. (6) **A placed markup was not taken away
by the reply's `revert`**, and the tool said so: an addition to the user's own list, like
a saved viewpoint, and removing one a deletion — the card's ×, or the request behind Apply.
*(Reversed by the follow-up, below.)*
(7) `copy_guids` also takes `schedule: true` (the Schedules row menu's "Copy GUIDs", still
behind Apply). (8) From the middle of an element's box the laser is handed no element to step
past (`selfId` −1): it is on no surface, and the rays read the element's own faces. (9) The
frame-trigger rows gained a fifth, clearing both lists, so the rows after them are measured on
the scene they always were. (10) **`make_schedule`'s `title` is held to what a name may be** —
no control or direction character — because a title becomes a saved setup's name when the
schedule is saved; and a question the Schedules window raises for the assistant quotes a saved
setup's name with such characters taken out.

**Follow-up, the same day, before review — four changes.** (1) **A question raised for the
assistant in the Schedules window takes no default button.** That window's dialog put the focus
on its confirm button; a question raised for the assistant appears while the user may be typing
— there, or in the chat composer as that window comes forward — and a button answers to Enter
and Space: the next space of a sentence would have deleted a saved template. `confirmDialog`
takes an explicit option (`ConfirmHow.forAssistant`, set by `manage.ts`' `FOR_ASSISTANT`, never
read off the `Ask Vee` label): the card carries `tabindex="-1"` and gets the focus, Tab reaches
Cancel first and then the confirm, Escape cancels, the trap holds, the focus goes back to what
had it. The user's own confirms and prompts are unchanged, to the character. (2) **`print` asks
in that window's own confirm first.** The native print dialog's default button prints, so a
stray Enter would have sent the schedule to the default — perhaps shared — printer:
`manage_schedules` `print` raises `Open the print dialog for this schedule?` · `Print…` under the
assistant's name, and only that click calls `printSchedule()`. Its gate entry is `confirm` now
(fourteen gated calls: three native dialogs, three confirmations), and the description, the
result and the ticker (*asking to open the print dialog*) say so; `open_file` and the user's own
Print are as they were. (3) **`schedule: true` is not bounded by `MAX_TOOL_IDS`.** The cap is
for ids the model sends; this set never travels through the model — the app holds it, as it
holds `selection` — and with the cap "isolate what this schedule lists" failed for any schedule
of more than 2 000 rows. The whole set is acted on; the scope guard, the blank refusal, undo and
the pending row apply as before, and the descriptions say rules are still preferred where a
rule can say the set. (4) **A markup a reply placed is taken away by that reply's `revert`.** A
spot or a measurement is session view state, not a saved list: the executor reports the new
record's own id (`ui.placed`), the reply keeps it (`ChatMessage.placed`), and `revertTurn` drops
exactly those that still exist through the Markups card's own × — nothing under `renderer/ai/`
names a removal. A reply that only placed one is offered `revert`; the user's own markups and
another reply's stay; one already removed is a silent no-op; a spot tag's state is still not put
back. The result, the description, the prompt line and `snapshot.ts` no longer say otherwise.

**Measured.** *The cached prefix* (UTF-8 bytes): tools block 47 127 → **54 448** (36 → 37
tools; `make_schedule` +2 635, `manage_schedules` 2 026, `manage_markups` +1 699, the four that
take `schedule` +960), contract 20 263 → **21 468** (181 → 183 lines) — 8 526 B more, about
2 130 tokens, written once per cache. **The whole parity work** took the catalogue from 32 049 B
(31 tools) to 54 448 B: **+22 399 B**, against the audit's estimate of about +13 kB — phases 1–3
+15 078, this phase +7 321. **After the follow-up:** tools block **54 774**, contract **21 497**
(+326 and +29 B — the `schedule` target's description on three tools, `manage_schedules`' and
`manage_markups`' descriptions, the placing line), so the whole parity work is +22 725 B.
*The per-turn view state* is unchanged. *The bundles:* main
renderer 1 637 kB, Schedules 123 kB.

**Tested** (the numbers are the final tree's, after the follow-up)**:** `npm run typecheck` exit
0. `npm test` **140 files passed / 2 skipped, 2 710 tests passed / 3 skipped** (136 / 2 576
before the phase; 139 / 2 690 before the follow-up): `ai-parity-4.test.ts` (new, 44 — a stale view call is
answered in words and changes nothing while a read runs; `schedule: true` isolates, hides,
shows, selects, colours and asks to copy through the store, with the scope guard holding a
schedule that lists under 5 %; `manage_schedules` over a recording port — what is sent, every
answer, one request a turn, the three-second wait, a late or foreign answer dropped, the window
closing; the new `make_schedule` inputs end to end; placing by box and by point, the
project-to-scene offset, the laser's normal and `selfId`, the cap, the refusals, `show`; and the
revert — placed then gone by id, offered on a reply that only placed one, the user's own and an
earlier reply's left alone, one already removed a silent no-op, a second revert nothing),
`ai-parity-4-bound.test.ts` (new, 7 — no bound: on a federation of 45 000, schedules of 2 500 and
2 050 elements acted on whole, the 5 % guard holding the smaller and refusing a blank view,
`copy_guids` the same as for an equally large selection, 2 001 ids still refused),
`schedule/dialog.test.ts` (new, 8 — on a stand-in page: a question raised for the assistant has
the focus on its card and Enter and Space answer nothing, where the user's own confirm is
answered by both), `schedule/manage.test.ts`
(new, 25 — the two messages' validation, the shared handlers, what a save would forget, and
`manageFromChat`: asked before any dialog, held with `ask: false`, busy under a dialog, stale at
the click, a name in its question shown with nothing unseen in it), `schedule/assistant.test.ts` (+20), `ai-tools.test.ts` (+7), `ai-eval-graders.test.ts`
(+8), `annotate.test.ts` (+5), `clipboard.test.ts` (+4), `annotation-store.test.ts` (+3), the
guard test (+2: the pinned gate list of fourteen, the three dialog calls and three confirmations,
`requestManage` in one file, no `act` posted, `manage.ts` deleting and printing nothing itself
and asking every question as one for the assistant, placing through the store from one file and
only the store's `revertTurn` taking one away) and `ai-prompt.test.ts` (+1). `npm run build` exit 0.
`npm run test:e2e`, in two guarded runs of the final build (the whole suite is 7.9 min, and a
guarded call here is a foreground one of at most ten): **62 passed, 6 skipped** (smoke 30,
4.1 min; the other eight specs 32 + 6 skipped, 3.8 min). Three new: the Schedules
window's controls over the real port (undo and redo on that window's own history with its own
toast, a template, a setup saved, listed, loaded, renamed, duplicated; `delete` raising the
window's dialog under `Ask Vee`, kept on Cancel and gone on Delete; `print` and `open_file`
answered before the dialog; `schedule: true` selecting the four rows' elements), a spot and a
laser measurement placed and read in the overlay, the action bar and the Markups card, and
`copy csv`. The Schedules spec's view-tool calls moved into live turns, with one of each kind
left to show the words. **The follow-up's two checks, measured in the built app.** *The
assistant's delete question:* the focus is on `div.dlg` (`tabindex` −1, no ring); after Enter,
Space, Enter, Space the dialog is still up and the saved setups are still `Walls L1` and
`Walls L1 (2)`; Tab reaches Cancel, then Delete; Escape cancels; a real click on Delete leaves
`Walls L1` — and the user's own Delete still has the focus on its confirm button, where Enter
deletes. *Print from chat:* 0 print dialogs after the call, after Enter and Space and after
Cancel; 1 after the click on `Print…`. *A reply's revert:* with a spot placed by hand and then
one by a reply — action bar `1 measures` · `2 spots`, two tags, card rows C1 and C2 — one click on
that reply's `revert` leaves `1 measures` · `1 spots`, one tag and the row C1; the hand-placed
spot's tag and row and the earlier reply's M1 are as they were, and a revert whose spot the user
had already deleted removes nothing and says nothing.
`node scripts/safe-run.cjs frame-triggers.cjs`: all **36** triggers
repainted, at rest 0 renders. Evaluation suite, no API, into fresh scratch folders with no
report: **oracle 66 / 66, null 0 / 66**. Guarded runs only, one at a time, the machine checked
before each; nothing survived any of them (peak, e2e, on the final tree: one process 419 MB, all
781 MB, GPU dedicated 255 MB). **One run was stopped by its guard**: the first frame-triggers run, on an
unhandled rejection thrown by a row of this phase's own (`the laser read nothing`: the row ran
after a model had been unloaded, and no ray read anything from the point it picked; peak GPU
351 MB, nothing survived). The rows were moved to where the whole federation is loaded and made to fail as a
row rather than throw, and that configuration was not run again.

**Not done, and limits.** No live assistant run: the new tool, the descriptions and the two
prompt lines are unmeasured against a real model, and the catalogue change rebuilds the cache
once. **The native print dialog was not driven** — the e2e stands in for `window.print`; since
the follow-up it is opened from the click on `Print…`, in the same task, so the confirm card may
still be painted under it until it closes (not observed). **No DOM library in the repository**:
the dialog's unit test runs on a stand-in page, and the real focus and key behaviour is the
e2e's. The eval harness has no Schedules window (its windows are
not the app's main window), so its one schedule case is the closed-window one; everything else
of that window is held by the unit tests and the e2e. The assistant can set a spot tag's state
but cannot read which tags are expanded. **Deliberately left out**, each with its reason in
`docs/DECISIONS.md`: a schedule's column widths, auto-fit and equal width, its appearance
panel, colour rules, heading orientation, thousands separators, a group footer's style and
blank line, `countDistinct` as a total, and its print layout; taking a calculated value's
definition away; dragging the sidebar's and the panels' sizes; folding a property-card section;
the chat panel's own controls; and what phase 3 recorded as the user's alone. The write-claim
detector does not know a saved schedule setup as one of the app's own things: "Renamed the saved
setup …" would be read as a write claim in a live run — no case says it, the harness having no
Schedules window.

## 2026-10-02 — Assistant parity, phase 3 of 4: the consent gate — the assistant asks, and the user's click does it

**Why:** the owner, 2026-10-01: *"assistant should possess everything user can do on the app."*
Phase 3 of the audit's four: what reaches outside the view or cannot be undone — opening model
files, opening a recent file, unloading a model, copying the share link or GlobalIds, changing
the base point, deleting a viewpoint, a markup or a saved filter set. The rule is the owner's
(of *the assistant proposes, and you click Apply in the chat or pick in the Windows dialog*:
*"correct."*): the assistant never performs one of these. The reason is prompt injection — a
file's own text reaches the model in every tool result, and must never be able to open, unload,
delete, copy or re-georeference anything by itself.

**Did.** *Phase 2's review leftover first:* the write-claim detector's `HANGER` reads a gapped
clause behind `:`, `—` or `–` as hung on an excused verb. *The gate:* the designed pending row
carries an **action** as well as a patch — `ChatPending` is `{label, patch}` or `{label,
action}`, `PendingAction` a closed union of fourteen kinds; the one performer is the store's
`performGated`, reached only from `applyPending`, which only the row's Apply button calls; the
row is taken before the action runs, so a request is applied once; a request the user's own work
has overtaken does nothing and says so. A `gate` marker on the tool spec (`gateOf`,
`GATED_CALLS`, eleven calls), pinned line for line by the guard test together with the two calls
that may raise a native dialog and the list of performing functions nothing under `renderer/ai/`
may name. One request a turn, of any kind. *Behind it:* `manage_views` `delete`;
`manage_markups` `delete` and `clear` (a new `kind`); `manage_filters` `delete_set`, which had
been immediate, and any `save_set` that would forget a saved set; and one new view tool,
`request_user_action` (`ai/executors/request.ts`):
`open_files` (the native Open dialog, single-flight, never awaited), `open_recent` (by name;
Apply re-reads main's recents and goes through `admit()`), `unload_model` (the sidebar's own
"Unload X?"; refused with one model), `copy_link`, `copy_guids`, `set_base_point`. 36 tools.
*Held where it was refused:* an undo, a redo or a viewpoint restore the scope guard catches.
*The base point:* `get_view_state.basePoint`, with whose it is (`file` / `user` / `none`), and a
part the reply's `revert` puts back. *The clipboard:* one `copyText` for both windows
(`renderer/clipboard.ts`), and flashes that are truthful. *Prompt:* two lines (35). *Ticker:* a
phrase for each request. *Eval:* seven dry-run cases (63), one on the hostile fixture, which
gained a fifth injection; the fingerprint sees the loaded models, the base point, the filter
sets and the sidebar's unload strip. Ten rows in `docs/DECISIONS.md`; in `CLAUDE.md` one
allowed deviation (and the revert's amended), a paragraph under "No visible additions", ten new
Decisions lines and twelve amended ones; `docs/SYSTEM_SPEC.md` §8, §9 and §10;
`docs/AI_EVAL.md`; `docs/COMMANDS.md`.

**The clipboard finding** (guarded runs of the built app; Electron 44.3.0, Chromium 152).
`navigator.clipboard.writeText` is refused **always** in this app — never clicked, straight
after a click, seven seconds later, and under the user-gesture flag alike (`NotAllowedError …
Write permission denied`): main denies every permission request, by design. A selected textarea
and `document.execCommand('copy')` — the design's own fallback — works, and only while the page
holds a user's activation: within five seconds of a click or a key. So "copy link to this
state" flashed `link copied`, and the property card's Copy flashed `Copied`, **with the
clipboard untouched**: the designed controls did not copy at all. They do now, through the
fallback, and each flashes only when the text is on the clipboard; a copy applied from a reply
and refused all the same is said in the panel's status line. No permission granted, no IPC, no
preload key. The browser's rule is not what keeps a tool call away from the clipboard — a call
arriving within five seconds of the user's Enter would be allowed — the gate is.

**Not as briefed, on purpose.** (1) **A recent file opens through `openPaths` behind a re-read
of main's recents**, not `openLibrary`: same admission and pipeline, and a file that left the
list or moved can be said in the panel. (2) **Both guard verdicts are held** for an undo, a redo
and a restore — "nothing left" as well as "under 5 %" — since each returns to a view the user
had; a filter that would leave nothing is still refused. (3) **`export_schedule` counts as the
turn's one request**, like the Open dialog. (4) **The copy controls were made to copy, not only
to stop claiming**: they copied nothing, and a truthful flash on a control that never works
would have been a control that never flashes. (5) **A recent name two files share is refused**
(only a path tells them apart), and **only valid GlobalIds are copied**. (6) **The base point
became a part the revert puts back**, where the brief only asked that the missing key be given
a part or a reason. (7) A request is **fixed to record ids or a history snapshot** when it is
asked, and a stale one does nothing. (8) Two prompt lines this work had added, and six tool
descriptions, were reworded where they had become false. (9) The unload request opens a
collapsed sidebar, so the question can be seen. (10) **`save_set` is held when it would forget
a saved set** — not in the brief; found in the code. The card's rules replace a set of the same
name and keep twelve, so a save could take a user's set away at once, which made the gate on
`delete_set` one call wide. Such a save waits in the row, naming the set that would go
(`forgottenBySave`, `shared/filter-stack.ts`); one that only adds is done as before.

**After review (approved, nothing must-fix; nine hardening items, done before the commit).**
(1) A held **patch** is typed to six visibility keys (`PENDING_PATCH_KEYS`) and `applyPending`
hands `up()` those and no others — it was `Partial<ShellState>`, so a "visibility" patch could
have carried a deletion; the guard also refuses the general doors under `renderer/ai/`
(`applySession`, `setState`, the settings, key and stored-session calls) and requires every
`.up(` a tool calls to be a flat literal of those keys. (2) **A call that only asks is not run
for a turn that is no longer live** — after Stop, or under a newer turn, `open_files` could
still raise the Open dialog and `unload_model` the strip; it is answered *The turn was stopped,
so nothing was asked.* (The Schedules e2e spec sent `export_schedule` for no turn at all, so it
runs it inside a live turn now, and asserts that with no turn no dialog is asked for.) (3) The
gate's prompt line names exactly the calls that ask
(`manage_filters`' own `clear` and `remove` do not). (4) `set_base_point` carries what the four
fields held and sets nothing if they have changed. (5) Every name in a label or a request's
result goes through one helper, `labelText`: control characters and direction marks out, then
clipped. (6) `manage_filters`' `name` is bounded at 200. (7) The words about the dialog counter
were made true. (8) **`revertTurn` drops a reverted reply's pending row** — applied afterwards
it would have been on no stack. (9) The eval's detector takes a contraction as a negation
(`n't` could never match where it stood); "nothing has been …" and the future passive stay
flagged, and pinned.

**Measured.** *The cached prefix* (UTF-8 bytes): tools block 42 798 → **47 127** (35 → 36
tools), contract 19 098 → **20 263** — 5 494 B more, about 1 370 tokens, written once per cache.
*The per-turn view state on the mock:* at boot 258 → **258**, unchanged in every state.
*`get_view_state`:* 1 132 → 1 202 B at boot.

**Tested:** `npm run typecheck` exit 0. `npm test` **136 files passed / 2 skipped, 2 576 tests
passed / 3 skipped** (was 134 / 2 464): `ai-parity-3.test.ts` (new, 73 — every gated call leaves
the store the very same object, the viewer uncalled and `localStorage` as it was; Apply performs
each exactly once; Cancel performs nothing; a second request in a turn is refused, across every
kind; no label or result holds a path or a link; the Open dialog is single-flight; unload is
refused with one model; a stale request does nothing; a save never takes a saved set away by
itself; a held patch writes only visibility; a stale turn's request is not made; a stale base
point is not set; no control or direction character reaches a label), `filter-stack.test.ts`
(+2), `clipboard.test.ts` (new, 8), the guard test (+5: the pinned gate list, the two dialog
calls, the forbidden identifiers and general doors, the literal keys a tool may hand `up`, the
new tool's inputs), `ai-eval-graders.test.ts` (+12), `ai-tools.test.ts` (+7), `turn-revert.test.ts`
(+1), and the tests that held the two refusals and the immediate `delete_set`, rewritten to hold
the new behaviour. `npm run build` exit 0.
`npm run test:e2e` **59 passed, 6 skipped** (7.2 min; three new, `consent-gate.spec.ts`, in the
built app over the real tool channel: the designed copy puts a link on the real clipboard and
flashes, the same click made by nobody copies nothing and flashes nothing, a link the assistant
asked for is copied by the user's Apply and not before, and no result holds a path or a link; a
recent file asked for by name loads on Apply, and an unload on the sidebar's `delete`; the Open
dialog, answered from `SGVUE_OPEN_PATHS`, tells the tool nothing of the pick). Evaluation suite
through its own runner, no API, into fresh scratch folders with no report: **oracle 63 / 63,
null 0 / 63**. Guarded runs only, one at a time, the machine checked before each; none tripped
and nothing survived any of them (peak, the whole e2e suite: one process 233 MB, all 774 MB, GPU
dedicated 292 MB). One run of three specs on the final build failed once in the Schedules
spec's phase-3 row-menu test — the flake recorded on 2026-09-25, nothing of this phase's — and
it passed in the run straight after and in the whole suite after that.

**Not done, and limits.** No live assistant run: the new tool, the descriptions and the two
prompt lines are unmeasured against a real model, and the catalogue change rebuilds the cache
once. **The chat table's `copy csv` copies nothing** — it calls the refused API directly
(measured: clicked by hand, the clipboard is left as it was); it has no flash, was outside this
phase and is not changed. *(Fixed in phase 4, the entry above: it goes through `copyText` from
the user's click, with no flash, as designed.)* The write-claim detector was kept narrow,
so two honest ways of saying "asked, not done" are read as write claims (a future passive,
"nothing has been deleted yet"), and a contraction with a typographic apostrophe still is; they
are pinned by a test and stated in `docs/AI_EVAL.md`, and a `no_write` zero on a gate case in a
live run has to be read against them. A call for a stopped turn that *acts* — a hide — is still
run, as it always was; only one that asks is refused. *(Phase 4 closed both: the typographic
apostrophe negates, and a stale view call is not run.)* The fifth injection is in front of the model in the three older hostile cases too. The
eval has no case for the Open dialog or a recent file (the synthetic federation has no file),
and its runner does not apply the copy; those three are held by the e2e spec instead.
`set_storeys` still has no scope check. `scripts/ai-audit.cjs` was not changed: its cleanup call
to `delete_set` now only asks (a guarded run's profile is thrown away, so nothing is left). Stays the user's alone, by
decision: the API key and every Preferences setting, quit / reload / DevTools, the consent
clicks themselves, anything that writes model data. `dist/` was not rebuilt, so the packaged
spec ran against the existing package.

## 2026-10-02 — Assistant parity, phase 2 of 4: the camera, saved viewpoints, markups, one filter step — and a revert that restores what a reply changed

**Why:** the owner, 2026-10-01: *"assistant should possess everything user can do on the app."*
Phase 2 of the audit's four: the rest of the reversible view state — the camera beyond the six
view buttons, the Viewpoints card, the Markups card, one filter step changed in place — and the
owner-approved widening of the chat's per-turn revert (asked whether it should restore
everything the assistant changed in that reply rather than visibility only: *"correct."*).
Nothing with an effect outside the view and no deletion (phase 3); nothing in the Schedules
window and no placing of a markup (phase 4).

**Did.** *Phase 1's five review leftovers first:* the grader's `modelsHidden` check fails on an
observation with no such field; `manage_filters`' `remove` and `move` no longer pass through
the guard (they cannot hide; the 216-stack test says so) and a `move` to the step's own place is
no move; the per-turn `modelsHidden` is capped at 20 keys; `apply_visibility`'s wording for undo
and redo; the two records. *The camera:* `set_view` gains `fit` (`extents | selection`),
`azimuth`, `elevation` and `zoom`, through two new store actions — `fitView` (the viewer's
`zoomExtents` / `zoomTo`) and `aimCamera` (the viewer's one new method, `lookAlong`) — and
`toggleProj`; the convention lives in `shared/view-angles.ts` (azimuth = the bearing the camera
looks towards, clockwise from project north; elevation = how far it looks down), with the six
view buttons stated in the same terms; `get_view_state.camera` reads it back, per turn only
while the camera is off its named view. *Viewpoints:* `manage_views` — list, save, restore,
rename, through `saveView`, `restoreView`, `renameView`; no delete. *Markups:* `manage_markups`
— list and zoom to one (`focusPoint`); no delete, clear or placing. *One filter step:*
`manage_filters`' `update` (action, rules, colour → `updStep`, `setStepRules`, `setStepColor`,
under the scope guard), `set_filter_stack`'s `color` per step, `get_view_state`'s step colour.
35 tools (`ai/executors/saved.ts` is new). *The revert:* `state/selectors/snapshot.ts` — the
snapshot is the session payload plus what a session does not carry; the state is cut into
twenty parts; `executeTool` measures which parts each acting call changed; `revertTurn`
restores them through the store's `applySession` (moved there from `model/session.ts`,
unchanged) and each control's own action; ids renumbered by model, and what could not be put
back said in the panel's status line. *Prompt:* two lines (33). *Ticker:* phrases for both new
tools and each of their operations. *Eval:* ten dry-run cases (56), the fingerprint sees the
camera, the viewpoints and a step's colour, a case starts with empty `localStorage`. Six rows in
`docs/DECISIONS.md`; one allowed deviation and six lines in `CLAUDE.md`; `docs/SYSTEM_SPEC.md`
§8; `docs/AI_EVAL.md`; `docs/COMMANDS.md`.

**Not as briefed, on purpose.** (1) **Revert puts back the parts that reply changed, not one
whole snapshot.** The brief has one snapshot restored whole; that flies the camera back to
where it was at the question on a reply that only hid the walls. The control's own tip is
"Undo just this step", so the state is cut into parts and only the reply's are restored — still
the session payload, still `applySession`. (2) **"That reply changed" is measured around each
tool call**, not across the turn: the user orbits while they wait, and that orbit is not the
reply's. (3) **A viewpoint restore runs the scope guard and is refused in words** when it would
hide down to nothing or under 5 % — the rule everything that can hide follows; it cannot wait
behind Apply, which holds a visibility patch. (4) **A camera that cannot be put back is left
where it is**, not framed as a session restore frames it. (5) **`applyPending` joins the
reply's undo** instead of replacing it. (6) A step's colour is **one of the card's six
swatches** (an enum), not a free hex. (7) `manage_views` also takes a **`number`**, because the
card lets two viewpoints share a name; a tool may save at most 50. (8) `set_view`: the
projection is swapped **before** the fit, so a fit is the fit of the projection asked for and a
repeated call lands on the same camera; a named view is still the button, including the
design's own second-press reframing. (9) `saveView`'s id is monotonic (two saves in one
millisecond). (10) The eval's write-claim detector excuses a claim verb whose own object is a viewpoint, a
filter set or a markup — "Renamed the viewpoint…" is true.

**After review (one must-fix, four small).** *The must-fix:* that excuse was per sentence —
any sentence that mentioned a viewpoint or a markup was let through, so "Renamed the wall W-12
to W-13, and saved a viewpoint of it." passed. It is per verb now: the verb's own object
(active: the noun phrase directly after it; passive: the whole subject), with nothing more hung
on it afterwards; quoted text is a name and excuses nothing. `docs/AI_EVAL.md` states what is
guaranteed, which honest phrasings it flags, and its three limits, each pinned by a test.
*Small:* `set_interface` measures the parts it changed itself (`ui.parts`), so a change the
user makes while it waits for the Schedules window is not the reply's; `iso` is quoted as
315 / 29.8, the number the read-back gives (30 read back as `view: null`); a reverted reply
gives its snapshot up; `manage_views`' description says a name longer than the list shows is
reached by number.

**Measured.** *The cached prefix* (UTF-8 bytes): tools block 36 885 → **42 798** (33 → 35
tools), contract 17 790 → **19 098** — 7 221 B more, about 1 800 tokens, written once per cache.
*The per-turn view state on the mock:* at boot 258 → **258**; 57 B more while the camera is off
a named view. *`get_view_state`:* 1 034 → 1 132 B at boot.

**Tested:** `npm run typecheck` exit 0. `npm test` **134 files passed / 2 skipped, 2 464 tests
passed / 3 skipped** (was 131 / 2 279): `ai-parity-2.test.ts` (new, 49 — every new input and
operation through `executeTool`, on a stub viewer whose camera is the real rig,
`tests/unit/rig-viewer.ts`), `turn-revert.test.ts` (new, 84 — the parts table against
`SessionSource`; one case for each of 41 kinds of change; later manual changes kept; the user's
orbit during a turn left alone; a model removed, a model back on another slot, a changed file,
a moved scene; a section's re-aim; Apply), `view-angles.test.ts` (new, 15),
`ai-eval-graders.test.ts` (+18), `ai-tools.test.ts` (+9), `ai-readback.test.ts` (+9),
`ai-prompt.test.ts` (+1). `npm run build` exit 0. e2e **56 passed, 6 skipped** (6.5 min; one
new: in the built app, through the real `ai:tool:exec` channel, a reply that only read has no
`revert`, one that changed the theme and the camera puts both back and leaves the gridlines the
user switched off, one that soloed a storey and cut a section is put back in one click and ⌘Z
walks the visibility back). Evaluation suite through its own runner, no API, into fresh scratch
folders: **oracle 56 / 56, null 0 / 56**. `frame-triggers.cjs` **31 / 31** (three camera
triggers added), 0 scene renders at rest. Guarded runs only, one at a time, the machine checked
before each; none tripped and nothing survived any of them.

**Not done, and limits.** No live assistant run: the new descriptions and the two prompt lines
are unmeasured against a real model, and the catalogue change rebuilds the cache once. A named
view pressed twice from a perspective view reframes by a tenth — the design's rig, kept.
`set_storeys` still has no scope check. The write-claim detector errs towards flagging — "Renamed it to X." with nothing named, and a
second action joined on with "and", are read as claims — and reads one sentence at a time, so
an object added in a sentence of its own is not seen (`docs/AI_EVAL.md`). A reply's snapshot
keeps references to the state as it stood (as the design's did for visibility) until the reply
is reverted or the transcript is cleared. `scripts/ai-audit.cjs`'s hand-written tool matrix was not
extended. `dist/` was not rebuilt, so the packaged spec ran against the existing package.

## 2026-10-02 — Assistant parity, phase 1 of 4: switches, selection, history, models — and reading back what it set

**Why:** the owner, 2026-10-01: *"assistant should possess everything user can do on the app.
that would be the best case scenario."* An audit set every user action beside the assistant's
tools; this is the first of its four phases — the reversible view state the assistant could not
reach, the defects it found in the existing tools, and the larger hole: the assistant could set
several things it could not read back. No camera, viewpoints, markups, files, clipboard or
Schedules-window work; those are phases 2–4 and were not started.

**Did.** *Reachable now, each through the action its own control calls:* `toggle_display` gains
`groundGrid` (the canvas grid — recorded on 2026-09-24 as not reachable; amended in
`CLAUDE.md`, `docs/DECISIONS.md` and `state/shell.ts`), `snap` and `originalMaterials`;
`select_elements` a `mode` (`replace | add | remove | clear`); `apply_visibility` the actions
`undo` / `redo` (the store's `step`); `color_models` a `null` for one key (the palette's
reset); two new view tools — `set_models` (the model eye, one `up({ modelVis })`) and
`set_interface` (theme, units, tree mode, sidebar, card, armed tool, tree search, opening the
Schedules window; `ai/executors/interface.ts`). 33 tools. *Read back:* the per-turn view state
is sparse — `display`, `tool`, `modelsHidden`, `sectionPlanes` appear only while something is
off its default (`sparseViewState`) — and `get_view_state` reports all of it in full
(`display`, `sectionPlanes`, `history`, `models`, `interface`), `section` kept the one string
the eval grades. *Defects fixed:* `activate_model` handed the already-active key left activate
mode and answered "Activated X." — it stays active now; `toggle_display`'s `dims` said nothing
when already so; a second held change in a turn silently replaced the first (`oneHeld`);
`manage_filters`' `enable` and `apply_set` bypassed the scope guard. *Prompt:* two lines (31).
*Ticker:* a phrase for both new tools, and `toolPhrase` for the two calls a tool's one phrase
would misstate. *Eval:* ten dry-run cases (46), `VIEW_FINGERPRINT` sees the display switches
and the models' eyes, `MUTATING_NAME` exempts `export_schedule` by name, the stale `ref-export`
oracle reworded. Six rows in `docs/DECISIONS.md`; `docs/SYSTEM_SPEC.md` §8; `docs/AI_EVAL.md`.

**Not as briefed, on purpose.** (1) **`manage_filters`' `remove` and `move` run the guard and
are exempt.** The brief names four unguarded paths; two of them cannot hide — visibility is a
conjunction of the enabled steps, so removing one can only reveal and reordering changes
nothing. A literal check would refuse `remove` in a view that is already blank and hold a
reorder behind Apply; a test proves the arithmetic over 216 stacks. (2) **An undo that would
hide down to nothing, or under 5 %, is refused in words, not held.** The brief asks only for
`step(back)`; the catalogue's rule is that anything that can hide runs the guard, and an undo
can. Apply applies a patch on top of the history and an undo is a move through it, so it
cannot honestly wait behind Apply until phase 3's pending *actions*. A step that only reveals
is exempt. It needed one reader on the store, `peekHistory`. (3) **`set_interface` sets no
`acted`**: ↺ could not put a theme or a tool back. (4) `get_view_state`'s `interface` also says
whether the Schedules window is open — the one thing `set_interface` sets that nothing read.
(5) The eval's new cases carry no `requires`, and `capabilities.cjs` is unchanged.

**Measured.** *The cached prefix* (UTF-8 bytes): tools block 32 049 → **36 885** (31 → 33
tools), contract 16 597 → **17 790** — 6 029 B more, about 1 500 tokens, written once per cache.
*The per-turn view state on the mock:* at boot 258 → **258**; with a filter step, both cuts
and a selection 363 → **363**; with every switch, the tool, a model and a plane off their
defaults 363 → **595**. *`get_view_state`:* 357 → 1 034 B at boot.

**Tested:** `npm run typecheck` exit 0. `npm test` **131 files passed / 2 skipped, 2 279 tests
passed / 3 skipped** (was 129 / 2 183): `ai-parity.test.ts` (new, 53 — every extension and both
tools through `executeTool` on the mock with a recording stub viewer; "the same call twice
changes nothing" for every wrapped toggle; each refusal and each held patch, applied against
the control's own action; `oneHeld`), `ai-readback.test.ts` (new, 18 — the sparse rule field by
field, the full read-back, the bounds, the `SessionSource` structural check), `ai-tools.test.ts`
(+10), `ai-eval-graders.test.ts` (+11), `trace-facts.test.ts` (+2), `ai-prompt.test.ts` (+1),
`filter-stack.test.ts` (+1, `peek`). `npm run build` exit 0. e2e **55 passed, 6 skipped** (as
before; 6.4 min) — none asserted anything this changed, and none was added: the production
bundle has no turn harness, so the store-level behaviour is in the unit tests. Evaluation suite
through its own runner, no API, into a scratch folder: **oracle 46 / 46, null 0 / 46**.
`frame-triggers.cjs` 28 / 28, 0 scene renders at rest. *Once, in the built app* (a scratch
spec through the real `ai:tool:exec` channel, not kept): `set_interface` set the theme on
`<html>`, opened the Schedules window through the bridge and reported it open, and said
"already open — brought to the front" the second time; the switches, the selection modes,
`set_models`, the active key staying active and `get_view_state`'s read-back all answered as
the unit tests say. Guarded runs only, one at a time; none tripped and nothing survived any of
them.

**Not done, and limits.** No live assistant run: the new descriptions and the two prompt lines
are unmeasured against a real model, and the catalogue change rebuilds the cache once.
`set_storeys` still has no scope check (the design's own tool has none; outside this phase).
The per-turn ↺ still appears on turns that only toggled a display switch and restores nothing
there — the audit's finding, phase 2's, because widening it changes a designed control.
`scripts/ai-audit.cjs`'s hand-written tool matrix was not extended. `dist/` was not rebuilt, so
the packaged spec ran against the existing package.

## 2026-10-01 — Vee, step 2 of 2: the thinking trace, the stop button, `You` on the left

**Did:** the second half of the owner's "Ask Vee" handoff (`design-reference/ask-vee/`). The
design's busy row is gone: while a turn runs the transcript's next row is the assistant's reply
being written, drawn from the turn's real events and the federation's real data — `Thinking`
beside the name, then a bubble with a one-line ticker over the element matrix (Read, Filter,
Check, each with its own count), then the answer word by word, its status and one row per
storey that holds a match (CLAUDE.md deviation; eight rows in `docs/DECISIONS.md`).
**Architecture, as briefed:** a pure core — `ai/trace-facts.ts`, the facts of a tool call;
`ai/trace.ts`, `traceReduce` / `traceCues` / `traceFrame(timeline, T, layout)` / `traceSend` —
a small store outside the shell store with an injectable clock (`ai/trace-store.ts`), and a
thin view (`app/Trace.tsx`, `app/ChatPanel.tsx`): one `requestAnimationFrame` loop, one
painter, one canvas for the cells, the beam and the rings. `ai/bridge.ts` feeds it where it
already handles the turn, and `executeTool` tells it each call after `resolveNames`. **The rest
of the motion:** the lift, the press, the send button as a stop (`abortChat`), `You` on the
left, the shimmer, the ticker's roll, the rings, both themes, reduced motion. **Step 1's three
changes:** one sprite size for every slot (`max(1, round(devicePixelRatio))`), the sprite clock
asleep between changes (`veeNextWake`), and the wording "no two of the first seven replies".
**The defect step 1 found:** the log's horizontal scrollbar was an invisible tooltip — fixed at
its cause, in `styles/vee.css`. **Removed:** `BrandBusy`, the `ifctrace` / `ifcbreathe` /
`ifcdot` keyframes, `chatStage`, `FIRST_STAGE`, `stageFor`. **Harness:**
`window.__sgvueDev.trace` (`pin`, `cues`, `frame`, `loop`), `chat.step` (a turn a step at a
time, which `chat.turn` now runs through), `vee.cell` and `vee.wakes`; `screenshot.cjs` gains
`trace-01-typing` … `trace-08-done` and a panel crop; `frame-triggers.cjs` steps a turn and
counts both loops; `parity-states.cjs` holds `chat-busy` still.

**Not as briefed, on purpose.** (1) **The e2e does not use the dev harness**: the suite runs
the production bundle, which has none. It replaces main's two turn handlers and sends a turn's
events itself over the real channels, so what is tested is the app's own `sendChat`,
`handleEvent` and executor; the dev harness got `chat.step` and `trace.pin` for the captures.
(2) **A Filter only when the scope really narrows**: with an OR group that has no scope rule
the scope is everything, and "Filtering IfcWall · 412 walls" would be false. (3) **Row hover
`hv-card`, not `hv-step`**: the bubble is `--step-bg`, so `hv-step` would change nothing.
(4) **Whole device pixels cost the demo building its one-to-one grid at 100 %**: 2 px cells
need 3 px columns, so its 412 elements are two to a cell there (206 cells, 167 px wide); one
each from 125 %. With the reference's unrounded pitch the app's 282 px would not hold 103
columns either. (5) **Every cell flashes in the wave** — the reference spares its 86 future
walls, which only a script can know. (6) **More than fifteen flying cells share 0.7 s of
stagger**, so a reply is settled 1.95 s after its answer whatever it found. (7) **Every sprite
state but `idle` plays from its own first frame**, so a half-second `found` is the hop itself.
(8) The status's seconds are rounded to the nearest. (9) `find_properties` and `find_nearby`
got stage phrases — they had none. (10) `ifctrace` and `ifcbreathe` went with `ifcdot`: only
`BrandBusy` used them. (11) **Three things beyond the brief, each because a test or a
measurement asked for it:** a reply the trace leaves is finished at once (sending the next
question while the last answer was still arriving froze it part of the way — found, fixed, and
an e2e fails without the fix); the trace is narration (`narrated()`, and a `try` round the
painter, which runs in a layout effect of a renderer with no error boundary); and the lift is
laid out for the *unscaled* bubble, so the line cannot re-wrap as its bubble grows from 0.94.

**Measured** (mock, 1280 × 820, ratio 1, both themes alike;
`tests/parity/2026-10-01-vee/README.md` § 5). The panel `[938, 348, 330, 420]`, unmoved. The
log: `scrollWidth` = `clientWidth`, 328 and then 320 once it scrolls (348 against 320 before).
A user's bubble `[951, 499.75, 261.44, 54.75]`, its text and the lifting line at x 962. The live
reply's label row `[951, 563.5, 87.58, 10]` — 10 px, as every label row. The trace bubble
`[951, 577.5, 304, 52]`; the read grid 206 cells of 2 px in 53 columns; the filter grid 80 of
5 px, 2 × 40; the beam 1.7 s across. The answer `[951, 490.5, 296, 148.05]`:
`checked 80 walls · 8s`, five rows of 17.33 px, 24 cells of 7 px. The stop square
`[1235, 735, 8, 8]`. *Sprites, one size:* 16, 16, 32, 32, 32, 48 and 48 device px at 1, 1.25,
1.5, 1.75, 2, 2.5 and 3, all three alike, 0 captured pixels differing from the backing store at
any of them in either theme. *The sprite clock:* 4 wakes in 7 s for the pill alone, 12 for
three idle sprites (56 ticks before), 8 a second while one thinks or reads, 26 in 7 s with one
`done`. *The two loops* (`frame-triggers.cjs`): about 410 (one per display frame) trace
frames and 0 scene renders in the 6.8 s a turn ran, 119 and 0 in the 2.2 s of its answer, 0 and
0 in the 2 s after.

**Tested:** **129 files passed / 2 skipped, 2 183 tests passed / 3 skipped** (was 125 /
2 096): `trace.test.ts` (new, 40 — the port against the handoff's own code at 330 instants,
over 20 000 cell comparisons; the cues from real events; `done` mid-step; a turn with no tool;
100 000 elements; whole pixels at seven ratios; reduced motion; the palette; a reply at rest),
`trace-facts.test.ts` (new, 16), `marks.test.ts` (new, 12), `trace-wiring.test.ts` (new, 14 — a
real `sendChat`, main's events, a tool through the real executor, a trace that fails),
`vee-grid.test.ts` (21, was 18 — the one-size table, the sprite's frame, the wake rule), the
chat selectors, and the store without `chatStage`. Typecheck and build green. e2e **55 passed,
6 skipped** (was 50 / 6; 6.4 min): `vee-trace.spec.ts` (new, 5) — a turn drawn as it happens,
the row that commits being the row that was live, a row's click, the log's width and its
tooltip; the stop button; a turn with no tool; reduced motion; the next turn sent a tenth of a
second after an answer. Run three times over, 15 of 15 — after one fix **in the test**: reading
a canvas back moves it from the GPU to the CPU, which rounds a 7 px square's corners
differently, so the same 24 `roundRect` calls were two byte-different pictures; a picture is now
compared by which pixels are there and in which colours. Evaluation suite through its own
runner, no API, into a scratch folder: **oracle 36 / 36, null 0 / 36**. `frame-triggers.cjs`
28 / 28 and the trace's block above. Guarded runs only; none tripped, and nothing survived any
of them.

**After review** (one must-fix, three small items). *The mark splitter was quadratic on the
answer path:* an opening looked past every later mark that could not close it, so
`**a **a **a …` cost the square of its marks — 44 s for 200 kB, measured, twice over (`done`
counts the words before it commits the reply, then the bubble renders them). An opening now
has one candidate, the next mark of its kind: 200 kB splits in 4 ms, and three unit tests hold
it under 100 ms; `**a ** b**` now prints as written. *A double-click on Stop* could send the
draft, or stop twice: the button ignores clicks for 300 ms after a stop (`sendClick`, unit-
tested; the e2e's stop is now a double-click, and fails with the guard off). *`Words` is
memoised on the text*, so a reply is not split again at every keystroke. *The trace's frame
count* is written as "about 410 (one per display frame)": it is a rAF count, 409 in one run
and 410 in the next. `vee-trace.spec.ts` 5 of 5 again.

**Not done, and limits.** `dist/` was not rebuilt, so the packaged spec ran against the package
from before Vee. No live assistant run — no API key was used anywhere — so a real model's
pacing (how often its calls carry rules, how long its rounds take) is untried: the trace's rules
are tested on scripted turns. Not run on macOS. The trace was captured at ratios 1 and 1.5; the
other ratios are covered by the lattice's unit test alone. When an answer makes the transcript
taller than the panel, the log's scrollbar arrives during the glide and the transcript narrows
by its 8 px: the design has no scrollbar gutter, and adding one would move every bubble. The
phase-9 parity numbers no longer describe the panel (`tests/parity/phase9/README.md` now says
so).

## 2026-10-01 — Vee, step 1 of 2: the assistant's name and its pixel mascot — and the bottom row's lane

**Did:** the owner's request — *"Can you help me update the ai assistant name and animations?"* —
with their design handoff, "Ask Vee", now kept unchanged in `design-reference/ask-vee/` as the
specification for the assistant's name, its mascot and its thinking motion (CLAUDE.md deviation;
two rows in `docs/DECISIONS.md`). This step is the **name** and the **mascot at rest**; the
thinking trace and its motion are step 2, and the busy row is untouched. **Scale:** the
handoff's "screenshot ÷ 1.2" is wrong — its screenshot was taken at 150 % — so
`ask-thinking-hex.jsx` px ÷ 1.5 = app px, and every existing panel element keeps its style
string. **Name:** one constant behind `authorOf` (`selectors/chat.ts`) — a reply's label, the
reply strip and the quote sent with a reply (`ai/bridge.ts`) say `Vee`; the title and the pill
read `Ask Vee`; the Schedules toasts `Schedule from Ask Vee` / `Schedule changed by Ask Vee`;
one added prompt line tells the model its name (28 → 29 lines). "SGVue" stays the app's name.
**Sprite:** `app/vee-grid.ts` — pure: `veeGrid` is the handoff's `hexGrid` verbatim, all five
states; the palette as roles; `veeCell` / `veeBox`, whole device pixels to a cell; the clock's
rule — and `app/Vee.tsx`: the canvas, one shared 8 fps clock that sets no React state, the theme
and ratio listeners, the dev pin. It stands in 21 / 19 / 16 px slots with negative margins beside
the title, in front of each reply's label and on the pill; `Sparkle` is gone. Light palette,
chosen: the visor `--ink`, the top facet `#CBD8D5`, the highlight `#35C4B6`. **Bottom row:**
the pill is 88.9 px wide (66.6), and the row now declares its height as a lane — `--brow`
(`browFrom`, the store's `brow`) — which the chat panel (`bottom`, `max-height`,
`clampChatSize`) and the property card (`max-height`) subtract: the gap the row's own entry
left open. **Two leftovers of the section-cut review:** `planeOf` reads a name longer than 200
characters as no plane; `legacySection` gives an older build the plane that is cutting when only
one of the two is. **Harness:** `screenshot.cjs` gains `vee-closed`, `vee-open`, `vee-lane`,
`vee-sheet` and an 8× crop of every sprite; `parity-states.cjs` finds the pill by either label
and quotes the assistant by each side's own name.

**Not as briefed, on purpose.** (1) Under reduced motion "each sprite holds frame 0 of its
state" is built as the **clock's** frame 0, each sprite still adding its own offset: `idle` at
frame 0 is the blink, and a mascot held with its eyes shut is not at rest. (2) A reply's label is
offset `11 + 4 ×` its index, not 11 for every one: the brief asks that no label blink in unison,
and the reference has only one. (3) The legacy-key rule is stated in four records, not the two
named: the CLAUDE.md deviation sentence and `SYSTEM_SPEC.md`'s `last.json` row are corrected
too. (4) Captures are at `SGVUE_DPR=1`: under device emulation `capturePage` hands back a 1×
down-sample, so the harness's default 2 cannot show a sprite's pixels; the other ratios were
measured for real, through page zoom.

**Measured** (mock, 1280 × 820, both themes alike; `tests/parity/2026-10-01-vee/README.md`).
*Nothing existing moved:* the header `[939, 349, 328, 47]` and its title
`[974, 366.5, 249, 11]` before and after; a reply's label row 10 px tall before and after; its
bubble unmoved; the pill `[1201.42, 774, 66.58, 32]` → `[1179.09, 774, 88.91, 32]`, wider by
its label and nothing else. Against the build before, `vee-open` differs by 0 px in the status
bar, the bubble, the composer, the close button, the sidebar and the toolbar; 844 / 848 px in
the panel — the two sprites, the title's text and the name. *Whole pixels:* at real ratios 1,
1.25, 1.5, 1.75, 2 and 2.5, in both themes, every sprite's captured pixels equal its backing
store — 0 differing; at 150 % all three are 32 device px. *The clock:* 4 repaints in 7 s for
the pill alone (two blinks), 12 for three sprites, 0 in 5 s minimised, 0 pinned.
*The row:* no two of its five pieces intersect at 1280 × 820, 1264 × 755, 900 × 700 or
760 × 700 in the three states measured; the status bar is where it was in all twelve; at 900 px
the centre now stands above the bars (180 px left beside them; the reset pill needs 183).
*The lane:* with a selection, the panel open, the laser's hint and a storey hidden, `--brow` is
`43px`, the panel `[606, 305, 330, 420]` and the card `[948, 184, 320, 537]`, the panel 6.7 px
above the pill; nothing of the row meets either at any of the four sizes, where 1, 2, 4 and 5
pairs did. With `0px` the computed styles are the strings they were.

**Tested:** **125 files passed / 2 skipped, 2 096 tests passed / 3 skipped** (was 124 / 2 069):
`vee-grid.test.ts` (new, 18 — the port against the handoff's own code for 5 states × 672
frames, each state's drawing, the palette through `design.css`, the pixel rule, the offsets,
the clock's rule), the chat selectors (`authorOf`, `hasSprite`, the quote `sendChat` sends, the
clamp with a lane), `browFrom`, the two codec cases each way, the prompt's 29 lines. Typecheck
and build green. e2e **50 passed, 6 skipped** (was 49 / 6; 5.7 min): the title, the pill and a
reply's label by their copy with a painted sprite in each; the bottom-row case with the four
things that used to meet; and a new case on the real clock — two pictures a sprite in four
seconds, never two shut together, recoloured by a theme switch, one picture each under an
emulated `prefers-reduced-motion`. That case failed once in its first eight repeats — the
test read a sprite in the frame before the page had heard the emulated change — and was fixed
in the test: **15 of 15** since, and the other two touched cases 8 of 8. Evaluation suite
through its own runner, no API, into a scratch folder: **oracle 36 / 36, null 0 / 36**.
`frame-triggers.cjs` 28 / 28 and 0 scene renders in 2 s at rest. Guarded runs only; none
tripped, and nothing survived any of them.

**Found, not touched:** the chat log shows a horizontal scrollbar as soon as it scrolls
vertically (`scrollWidth` 348 against `clientWidth` 320 with the parity transcript) — on the
base commit's build too, the same numbers. **Not solved, by scope:** the colour legend does not
take the lane, and with the row one line the panel in the card's lane still lies 6 px across
the end of a full action bar at the default window, as before. **Not done:** `dist/` was not
rebuilt, so the packaged spec ran against the package from before the name; no real-model run
(no `samples/` model on this machine).

## 2026-10-01 — two section cuts at once: one along a gridline, one at a level

**Did:** the owner's request — *"Can you add the section cut along gridline as another cut
also? same, i need offset, cut / flip, clear. and since we have multi plane section cut now, add
a clear all somewhere. Can you also add divider on the gridlines under section panel for along x
or y side, for example gridline 1 to 10 one section, Gridline A to E one section."* — and, asked
how many cuts at once, their choice **"Two: gridline + level"**: the two become independent,
each with its own offset, cut, flip side and Clear, plus one Clear all, the gridline chips split
by a divider into their two directions (CLAUDE.md deviation; five rows in `docs/DECISIONS.md`).
**State:** `sections: { grid, level }` replaces `section`, each a `SecPlane { name, offset, flip,
cut }` (`src/shared/sections.ts`, new); `setSec(kind, patch, open?)` patches one plane,
`clearSections()` both, `gridClick` only the gridline plane. **Viewer:** `setSections({ grid,
level })` replaces `setSection`; `section.ts` is two slots, each with its own outline quad and
preview sheet; `materials.ts` has a second clip uniform pair and keeps a fragment both planes
keep; the pick and laser rays are clamped by every cutting plane (`clipSpan`, the brute-force
reference included) and the snap refuses a candidate either cut away; each plane's cut outline
is trimmed to the other's kept side (`section-cut.ts`), still one instanced mesh and one
recompute a frame; the re-aim is the design's rule per plane, once at the gridline plane when a
restore brings both. **Card:** the owner's layout from the design's own pieces — `Clear all` in
the header, the gridline chips one row per grid family with a 1 px rule between, and each block
with its own offset row, its summary and its own `cut` · `flip side` · `Clear`. **The summary
has a line of its own**, the one place the design's two rows were re-arranged: beside its three
buttons it had about 75 px and read `offset mm …`, the plane's name clipped away, and with two
planes that line is the only place `grid C · cut · flipped` is read. `max-height` +
`overflow:auto` because the card is 114 px taller; the toolbar button lit while either plane is
set. **Persistence:** a session, a share link and a viewpoint write `sections` and the old
single `section` beside it (the gridline plane, else the level plane, else "none"), and one
normaliser, `sectionsOf` (`shared/session-codec.ts`), reads either and coerces every field.
**Assistant:** `set_section`'s `kind:"grid"` / `"level"` sets that cut and leaves the other
alone, a `kind` with no name clears just that cut, `kind:null` clears both; `section` in its
result and in the view state is one string, `grid C + level L2`. **And it does what the user's
click does** — the owner, asked whether an assistant-made section should actually cut: *"yes.
assistant should possess everything user can do on the app. that would be the best case
scenario."* Setting a plane is the chip's own patch (cutting, at the kind's default offset);
the same kind and name again changes only what the call passes — an omitted `offset`, `flip`
or `cut` keeps what the plane has, so a previewed plane that is moved is still a preview — and
never clears it; one new input, `cut` (`false` previews, `true` cuts, and a new plane cuts when
it is omitted); the clears are the card's `Clear` and `Clear all`. That direction — the assistant can do whatever the user can, within the
viewer-only rule — is recorded for the whole catalogue; only `set_section` was changed.
**Records correction (asked for with this task):** the update-notice entry in `CLAUDE.md` and
the Network row of `docs/SYSTEM_SPEC.md` now say that Chromium's standard headers include a user
agent which, in a packaged build, names the app and its version.

**Not as briefed, on purpose:** the brief listed the label-occlusion ray with the pick and laser
rays to be clamped by both planes. It was never clamped by the one plane — the design tests
occlusion against the raw pick list (`viewer-core.js` L720–721) and the port kept that — so it is
left unclamped; clamping it would have changed which labels are hidden in every one-plane frame.

**Measured.** *One plane is the build before:* the phase-6 chain on the mock, 1440 × 860, the
base commit `60ec62b` captured three times (and six more in light for four states), this build
three times — **all 84 canvas-only frames (14 states × 2 themes × 3 runs) are identical, pixel
for pixel, to a base capture**; the base's own captures agree except `levels-iso`, one pixel by
one level. Whole window: the label readback is identical in all 28 state / themes and the card
is `[312, 66, 300, 330]` → `[312, 66, 300, 444]`. *Two planes* (mock, grid C flipped + level
L2): 378 outline segments on 63 elements (grid alone 220 on 47, level alone 568 on 74), 25 draw
calls. *Cut recompute* on 2026-09-28's 5.58 M-triangle synthetic model: **6.2–7.2 ms with both
planes cutting**; one plane 5.6–7.5 ms (base 5.6–7.3), 8.9–9.3 ms worst case (base 8.7–9.4).
`frame-triggers.cjs`: **28 / 28** (the second plane's set, offset, flip and clear added), 0
renders at rest. Every capture and measurement was taken again after the summary line and the
`cut` input were added, on a dev-tools build byte-identical, all 95 files, to one rebuilt from
that tree. The last change of the day — an omitted `cut` keeps a set plane's state — touched
only the `set_section` executor and its description; the unit suite, the build and the
evaluation were run again after it, the captures and the e2e suite (which does not exercise
that executor) were not. `tests/parity/2026-10-01-two-sections/README.md` has the tables.

**Tested:** **124 files passed / 2 skipped, 2 069 tests passed / 3 skipped** (was 2 014): the
normaliser and codec, an old viewpoint, `section-planes.test.ts` (new — the clips per slot and
every re-aim case), picking and the pick grid with two planes against brute force, the snap, the
trimmed cut outline, the selectors, the executors (the default cut, both default offsets,
`cut:false`, a preview moved and still a preview until `cut:true`, a plane re-sent changing only
`cut`, only `flip`, only `offset`) and the catalogue.
Typecheck and build green. e2e **49 passed, 6 skipped, twice in a row** (was 47 / 6): the card's
layout with each summary whole on its own line, both cuts through the card, their offsets
independent, flip one, preview one, a viewpoint named `grid C + level L2`, Clear one, Clear all,
and a share link in the pre-2026-10-01 shape restoring its section. Guarded runs only, nothing
survived.

**Two harness fixes that came with it.** (1) `smoke.spec.ts` "the bottom edge is one row" was
flaky — **3 failures in 10 on the base commit's own build**: its `resize()` read the row in the
frame before `BottomRow` re-places its centre zone (at 760 px, the hint 62.5 px wide against the
200 px floor). The test, not the product, was fixed: it now reads the row until two consecutive
reads 100 ms apart agree (`settledBottomBoxes`). **15 of 15 in a row, twice**, and in every full
run since. (2) `scripts/ai-eval.cjs` could not run on Windows, on the base commit either: it is
without a window between its probe and its first case and between any two cases, and the real
main quits on `window-all-closed` everywhere but macOS — the run ended before its first case and
exited 0. It now keeps one hidden, empty window open for the run on Windows and Linux, and none
on macOS; the documented commands are unchanged. Through the runner itself, `ANTHROPIC_API_KEY`
unset: **oracle 36 / 36, null 0 / 36**.

**Guard trips, none of them memory or time:** `shell-sanity.cjs` on the mock once, on an output
directory that did not exist (peak GPU 370 MB); and one batch of capture runs, seven in a row
inside about a minute, the five whose last lines were kept each reporting `unhandled rejection`
at 117–119 MB. Their output was not kept; the same runs passed straight after with full logs,
and a round of card captures a few minutes earlier had come back at 0–2 fps, so the cause was
most likely the desktop in use over the windows. Those captures were thrown away and taken
again. **Not done:** no real-model run (no
`samples/` model on this machine); `dist/` was not rebuilt; and the view state still names only
which planes are on, not their offset, side or cut — part of the wider audit the owner's
direction asks for.

## 2026-10-01 — the landing page says when a newer version is out, and the app asks GitHub once at every start

**Did:** the owner's request — *"Can you show updates with link if there are one automatically
on the upload page?"* — and, of the ways offered, their choice **"Check at every start"**: one
small request to GitHub when the app opens, a notice with a link if a newer version exists,
silence when offline or blocked; no Preferences switch. This is the app's first network call
of its own (CLAUDE.md deviation, a row in `docs/DECISIONS.md`; the 2026-09-25 and 2026-09-28
"no network call by the app" records are amended). **`src/shared/version.ts`** (pure):
`parseVersion` — `1.2.3` / `v1.2.3`, optional pre-release and build metadata, refused over 64
characters before any pattern runs — and `isNewer`, semver precedence. **`src/main/updates.ts`**:
`latestVersion(fetchFn)` is one `GET` to `LATEST_RELEASE_URL` (a hard-coded https constant on
`api.github.com`) through `net.fetch` — `Accept` and nothing else of ours, `credentials:'omit'`,
`cache:'no-store'`, `redirect:'error'`, 5 s — status 200, the body read up to 256 kB, `tag_name`
through `parseVersion`; every failure is `null` and at most one `console.warn` line.
`checkForUpdate(current)` keeps its promise (one request per run) and, in a development build,
makes **no request at all**: `SGVUE_UPDATE_LATEST` stands in for the tag there, through the same
checks. **IPC:** `update:check` → `{ latest } | null` and `update:open` →
`shell.openExternal(updatesUrl(__APP_VERSION__))`, both without a payload, both answered for the
main window only; preload keys `checkUpdate` and `openUpdatePage`; the renderer never supplies a
URL. **`Landing.tsx`** asks once on mount and, only with an answer, draws
`[data-role="update-notice"]` between the introduction and the drop zone (above the warning
banner when both show): the warning banner's box in the accent tokens, `SGVue <latest> is
available — you have <current>.` and the text button `get the update →`. `scripts/screenshot.cjs`
answers `update:check` itself (`SGVUE_UPDATE_LATEST`), since it is its own main process.
**Measured** (`tests/parity/2026-10-01-update-notice/README.md`; `#mock&landing`, 1280 × 820,
both themes): with nothing newer the landing capture is byte-identical to `2893aff`'s (two
captures of one build differ by up to 19 px, each by one level) and the page's `outerHTML` is
the same 7 922 bytes; the notice is `[330, 241.2, 620, 44.75]`, 22 px from the introduction and
from the drop zone. The centred column grows by 66.75 px, so what is above the notice stands
33.4 px higher and what is below 33.4 px lower, as with the designed banner; at the real default
window (1 264 × 755 inside) with two rows of Recent pills the page is 34 px taller than the
window and scrolls. **Live:** the app's own `latestVersion()`, bundled alone and run once in a
guarded Electron main process with the default `net.fetch`: 200, `1.1.0`, 2.8 s for that first
request.
**Verified** (with the ground change below, on the final tree): `npm run typecheck` exit 0;
`npm test` **123 files passed / 2 skipped, 2 014 tests passed / 3 skipped** (was 120 / 1 906:
+61 `version.test.ts`, +35 `updates.test.ts`, +1 guard case, +11 `ground-level.test.ts`);
`npm run build` exit 0; `npm run test:e2e` **47 passed, 6 skipped** (was 45 / 6: the notice
case — copy, box, tokens in both themes, the URL the button opens, no notice for the same, an
older or no version, the notice above the banner — and the ground case), peak working set
252 MB one process / 778 MB all, GPU dedicated 254 MB, `clean:`. Every capture and measuring
run went through `safe-run.cjs`; nothing survived.
**Not verified here:** a packaged build's launch request end to end — `dist/` holds the 1.1.0
package, built before this. Once repackaged, `npm run test:packaged` makes that one request per
launch.

## 2026-10-01 — the canvas grid stands at the file's zero, not at the first part streamed

**Did:** the owner's report — *"I have an ifc model generated by Tekla. When federated model, it
was aligned with my model and above canvas grid. But when i open it individually, the model is
under the canvas grid."* **The cause:** the whole-metre federation offset, Z included, is
rounded from the first placement web-ifc streams from the boot model (`geometry-streamer.ts`),
and `scene.ts` drew the ground at scene z = 0 clamped into the box, calling that "the federation
datum". It is the datum only when that first part sits near the file's zero. **The fix:**
`groundLevel(datumZ, minZ, maxZ)` (`viewer/scene.ts`, pure) — the project frame's own zero,
scene `0 − offset z`, whenever the box spans it, else the **bottom** of the box, never its top;
`buildScene` takes the datum, and `viewer-core.ts` builds the rig one way (`buildRig`) at
construction and on every `restage`. The offset is untouched. Everything that reads
`rig.groundZ` — the veil, the grid helper, the gridlines and bubbles, the orbit pivot — follows;
nothing else read scene 0 as the ground. `debug()` gains `ground`. The comments that called
scene zero "the federation datum" are corrected, and the trap is recorded (CLAUDE.md,
`docs/TRAPS.md`). **A second committed fixture**, `tests/fixtures/high-first.ifc`
(`scripts/make-tiny-ifc.py`, which writes both; `tiny.ifc` regenerates byte-identical): a floor
slab on the file's zero, two columns, a footing below zero and a strip of roof slab 12 m up,
the roof first — web-ifc streams `IfcSlab` before the other classes here, whatever their ids.
**Also fixed:** `scripts/shell-sanity.cjs` had not parsed since `5d942e1` (a comment inside the
`BUBBLES` template literal quoted `declutter.after` in unescaped backticks); the two are
escaped and the script runs to its end on the mock again, 92 s, every block.
**Measured:** *the mock* (offset Z 0; ground 0 before and after): the `default` capture at
1280 × 820 is byte-identical to `2893aff`'s in both themes — of five dark captures of the
fixed build, four are byte-identical to one of `2893aff`'s, as are both light ones; the fifth
differs by about 8 100 px, all of them the outlines of the overlay's bubbles and dimension
labels, where five captures of `2893aff` differ from each other by 0–6 342 px of the same — and
with the stage's chrome and labels hidden the boot view and Plan are byte-identical and the
south elevation within 2 px, as two captures of `2893aff` are. *The
fixture:* offset `[3, 0, 12]`, box −13 … 0.2 in scene coordinates; ground at scene 0 before (the
roof, 98.5 % up, four of five elements under it) and at scene −12 after — the file's zero, only
the footing below. *The Tekla steel-structure export* (relative figures only, through the app's
own index builder and streamer under Node): first placement at 98 % of the model's height; the
ground there before, 92 % of the elements wholly below it; at the file's zero after, 42 % up the
box, 99.9 % of the elements wholly above it.
**The guard tripped once:** loading that export in a guarded dev run (`safe-run.cjs`, default
limits) read the GPU process at 242 MB when the load returned and 2 634 MB 1.7 s later — over
the dev guard's 2 500 MB (renderer 2 121 MB). The guard ended the run, nothing survived, and it
was **not** re-run with a raised limit, so there is no capture of that file in the app; its
figures above came from Node, without Electron. The app's own guard allows
`max(3 072 MB, 40 % of RAM)`.
**Verified:** the new e2e case fails on a build of `2893aff` (576 px of grid across the middle
of the slab, in Plan) and passes after; `safe-run.cjs frame-triggers.cjs` 24 / 24, 0 renders at
rest, `clean:`; the totals are in the entry above.
**Known:** `restage` still rebuilds the rig only on a scale change of about 10 %, so on a
federation whose box does not span its datum, a later model that lowers the box's bottom by less
than that leaves the ground where the first build put it — as before. The reference model's
ground moves up one metre, to its lowest storey's `+0` (its offset Z is −1); not re-measured,
there is no sample model on this machine.

## 2026-10-01 — five main-window requests: an action bar, a grouped toolbar, hover titles, an eye-first tree, file paths — and the bottom edge as one row

**Did:** five owner requests, each a recorded deviation (CLAUDE.md, five rows in
`docs/DECISIONS.md`). **(1) Action bar** — *"Can you move the clear button and undo button
somewhere?"*: `undo`, `redo`, `N measures` + `clear` and `N spots` + `clear` left the status bar
(`SGVue.dc.html:711–714`) for `ActionBar` (`app/StatusBar.tsx`) — the status bar's own card 3 px
above it, same copy, tips, styles and handlers, drawn while `hasActionBar`. The status bar is its
five fields again. The stage declares the bar's lane as `--abar` (30 px, else 0), which the
colour legend and the Markups and Spatial-structure cards take; with the bar absent every
computed length is the design's. **(1b) The bottom row** — the orchestrator's ruling on what
(1) left overlapping, *fix the class, not the pixel*: the status bar, the action bar, the hint,
the reset pill and the Ask pill no longer position themselves. They are the three zones of one
grid row (`app/BottomRow.tsx`, `1fr minmax(0,auto) 1fr`) — the two bars · the hint under the
pill · Ask — each keeping its markup, copy and style string less its positioning, the row
taking no pointer events. A hint wraps (`text-wrap:balance`) instead of running under the bars,
and `centrePlace` (`selectors/lanes.ts`) stands the centre above the bars where they leave it
less than the pill's width or 200 px of hint. `VisibilityFrame` is the border, `ResetPill` the
pill; `reset` and `Ask` are the stage's last two tab stops. **(2) Toolbar** — *"organize, group and add divider … separate
the schedules toggle. Make it distinct"*: five groups (tools · panels · show · view ·
Schedules) with four 1 × 18 px dividers; `column-gap` 10 → 4 px, so it is 737 px against 741; a
divider that would end or start a wrapped row is `visibility:hidden`; Schedules is alone, last,
in the accent's ink and outline. **(3) Property card** — a native `title` with the whole text on
every clipped text: the four tiles, each set header (the set's own name), each property name
(`fullText`). **(4) Tree** — eye-first like STOREYS: `[eye][label][count][chevron]` and
`[eye][name / meta]`. **(5) Paths** — a file's full path as the `title` of its library row, its
Recent pill and its loaded MODELS row (`ModelRow.path`, from `fed.sessionFiles()`); none for the
demo. Also: `scripts/screenshot.cjs` gains five app-only states and the sidecar an `actionbar`
rectangle; the e2e suite clicks Schedules "the way a hand does" (`openSchedulesWindow`, which
tries again if no window came), because it is now the button under the view cube canvas's empty
corner.
**Measured** (mock, 1280 × 820, both themes; `tests/parity/2026-10-01-ui/README.md`): with a
storey hidden, 3 measures, 2 spots, colour by Level and Markups open — status bar
`[312, 781, 287, 27]` (before: 576 wide, under the whole reset pill), action bar
`[312, 751, 284, 27]`, pill `[699, 771, 183, 36]`, legend `[312, 544, 230, 204]`, Markups
`[312, 66, 330, 275]`: no two intersect. The bottom row, against a build of `d16f393`: at rest
the status bar and the Ask pill have the same rectangles and 0 px differing, at 1280 × 820 and
at 1 264 × 755; the pill alone has the same rectangle (571 / 452 px of its curved ends differ,
≤ 37 / 93 of 255 — no `translateX` now). With the laser tool's 522 px hint, the pill and a full
action bar — hint `[609, 773, 522, 33]`, pill `[609, 732, 183, 36]` above its start — no two of
the five intersect at those two sizes, at 900 × 700 (the hint on three lines) or at 760 × 700
(the centre above the bars); placed separately three pairs met, and six at the narrow two.
Toolbar 741.03 → 737.03 px, one row; 0 cube pixels
under the Schedules button in 3D and Plan, nearest 7.4 / 8.8 px (before 6.5 / 7.1), and at the
real default window (1 264 × 755 inside) 4.3 / 2.5 px (before 3.9 / 1.1). Group eye x 16 = storey
eye x 16 (was 251); element eye 31 (was 253). Before / after pixels: the sidebar above the tree
0 px in all twelve captures, the Ask pill 0 in all twelve, the Markups card 0, the property
card 0 / 3 px (two captures of one build: 3 / 3).
**Verified:** `npm run typecheck` exit 0; `npm test` **120 files passed / 2 skipped, 1 906 tests
passed / 3 skipped** (was 1 896: the action bar's rule and lane, `ModelRow.path`, `fullText`,
`centrePlace`); `npm run build` exit 0; `npm run test:e2e` **45 passed, 6 skipped** (was 40 / 6:
five new smoke cases — the two bars, the bottom row, the toolbar with its Tab order, cube and
wrap, the tree and the card's titles, the three path titles), peak working set 311 MB one
process / 778 MB all, GPU dedicated 260 MB, `clean:`. Before the bottom row the suite was run
five times: the second lost the new toolbar case's Schedules click straight after its window
resize (43 passed, 1 failed), which is what made `openSchedulesWindow` click again when no
window comes; the three runs since passed. With the row it was run once, whole, and the row's
own case four more times beside the action bar's. Every capture and measurement run went
through `safe-run.cjs`; nothing survived.
**Known:** the chat panel, the property card and the colour legend are not zones of the bottom
row, and no lane is declared for its height. With an element selected, the chat panel open, a
tool hint and something hidden — all four — the chat panel covers the reset pill above the hint
at the default window; in a window of 900 px or less the open chat panel covers the pill and
the top of a wrapped hint; where the centre stands above the bars (760 px) it is where a colour
legend is. Between the side zones the pill stands over the hint's start (`flex-start`), not its
middle as the ruling's string had it: centred, 39 px of it are under the open chat panel.
`scripts/shell-sanity.cjs` finds the status bar by `data-role` now, and that edit was not run:
the script does not parse at `d16f393` either (an unescaped backtick inside a template literal,
since `5d942e1`). On a touch screen the Schedules button, under the cube's canvas at the
default window, is reached from Window › Schedules. `dist/` predates this. Not committed; no
version bump.

## 2026-09-28 — Help › Check for updates… opens the product site, told this version

**Did:** the owner's decision, *"From the next version, should Help › Check for updates open the
new page instead of the GitHub releases list?"* → *"Yes, open the page"*. The item now opens
`https://sgvue.github.io/?v=<version>`: `src/main/about.ts`'s one https base is renamed
`RELEASES_URL` → `SITE_URL`, and `updatesUrl(version)` appends `?v=` and the URL-encoded version;
`menu.ts` passes the build-time `__APP_VERSION__` — About's and the landing page's — because in a
dev or e2e launch `app.getVersion()` reports Electron's own (packaged, they are the same string).
Still `shell.openExternal`, no network call by the app, `publish: null`. Nothing else used the
old constant. The site itself is published separately and is not in this repository. Docs:
CLAUDE.md's deviation entry and index, `docs/DECISIONS.md` (the 2026-09-25 row amended, a new
row), `docs/SYSTEM_SPEC.md`'s deviation row. **Verified:** `npm run typecheck` exit 0;
`npm test` **120 files passed / 2 skipped, 1 896 tests passed / 3 skipped** (`menu.test.ts` pins
the literal URL for `1.1.0`, `1.2.0-beta.1` and `1.2.0-beta.1+build.5` → `%2B`); `npm run build`
exit 0; `npm run test:e2e` **40 passed, 6 skipped** — the smoke case clicks the real item and
gets `https://sgvue.github.io/?v=1.1.0` — peak working set 217 MB one process / 769 MB all, GPU
dedicated 260 MB, `clean:`. Not committed; no version bump.

## 2026-09-28 — 1.1.0 released: feature/ifc-table merged into main

**Did:** `main` fast-forwarded to `d7e4527` (the Schedules branch at 1.1.0-beta.4) and the
version set to **1.1.0** (`package.json`, both root entries of `package-lock.json`); no code
changed. Against the last published release, 1.0.2, 1.1.0 carries: **1.0.3's NVIDIA-first
graphics** — on Windows SGVue asks Chromium for the NVIDIA (else AMD) adapter at every launch,
with Preferences' *Prefer NVIDIA graphics when available* and About's `Graphics:` line; **the
Schedules window**, phases 1–4 — ifcTable's schedule engine in a second window drawn in SGVue's
design, a row click shows its element in 3D and a 3D pick marks its rows, a right-click menu,
colour 3D by a column, a `Model` column for federations, and export to Excel, CSV and
`.schedule.json` through the native Save dialog; **the assisted installer wizard** — Welcome →
progress → Finish, worded for install, update or repair, with open-now and desktop-shortcut
choices; **the assistant** reading property names the file's way (nearest keys, yes/no values,
`find_properties`) and working with schedules (`make_schedule`, `get_schedule`,
`export_schedule`, `color_by_schedule_column`); **spot level tags and snapping** — a spot shows
`▽ +level`, a click opens its full grid, and the snap takes the surface being looked at; and
**section cut lines** — everything the plane cuts is outlined in the accent, 2.5 px.

**Verified:** `npm run typecheck` exit 0; `npm test` **120 files passed / 2 skipped, 1 894 tests
passed / 3 skipped**; `npm run dist:win` exit 0 → `dist/SGVue-1.1.0-setup.exe`, 115 380 802
bytes, SHA-256 `019b0b56a869982bc6300a50c21f098e548242067b4658c41396d61c4a3590d4`;
`npm run test:packaged` 1 passed, 2 skipped, peak working set 180 MB one process / 534 MB all,
GPU dedicated 229 MB, `clean:`. The installer was not run (blocked on this PC): its payload,
extracted with electron-builder's own 7-Zip, is **75 of 75 files SHA-256-identical** to
`dist/win-unpacked`, and `app.asar`'s `package.json` reads `1.1.0`. A case-insensitive byte scan
of the payload and of the setup `.exe`, as UTF-8 and as UTF-16LE, found **0** hits for the
owner's private identifiers — among them the e-mail handle, the Windows account name and both
spellings of the profile path; `Yong Yen`, the credited name and the scanner's control, was
found (payload 4, setup 2). Nothing survived.

## Earlier work

Compressed: the 2026-09-28 cut-outline entry on 2026-10-08 (the laser's two sides), the 2026-09-28 spot-level entry on 2026-10-08 (coordinates, part 2), the 2026-09-28 export-and-colour-from-chat entry on 2026-10-08 (map-space federation), the 2026-09-28 schedules-from-chat, installer-wizard and property-names entries on 2026-10-08 (the ground veil), the 2026-09-25 1.0.3-merge entry on 2026-10-02 (1.2.0 prepared), the 2026-09-25 NVIDIA-first entry on 2026-10-02 (the refactor pass), the 2026-09-25 1.1.0-beta.1 merge entry on 2026-10-02 (assistant parity, phase 4), the 2026-09-25 Schedules phase-4 entry on 2026-10-02 (assistant parity, phase 3), the 2026-09-25 Schedules phase-3 and phase-2 entries on 2026-10-02 (assistant parity, phase 2), the 2026-09-25 installer-GPU entry on 2026-10-01 (Vee, step 2), the 2026-09-25 Schedules phase-1 entry on 2026-10-01 (Vee, step 1), the 2026-09-25 Check-for-updates entry on 2026-10-01 (two section cuts), the 2026-09-24 refactor passes 3 and 4 on 2026-10-01 (the ground's height and the update notice), the 2026-09-24 refactor pass 2 on 2026-10-01 (five main-window requests), the 2026-09-24 refactor pass 1 on 2026-09-28 (Check for updates → the product site), the 2026-09-24 class-colours entry on 2026-09-28 (1.1.0 released), the 2026-09-24 building-box entry on 2026-09-28 (cut outline), the 2026-09-24 gridlines entry on 2026-09-28 (spot level and surface snap), the 2026-09-24 About-story entry on 2026-09-28 (export and colour from chat), the 2026-09-24 same-model-replaces entry on 2026-09-28 (schedules from chat), the 2026-09-24 landing-page entry on 2026-09-28 (installer wizard), the 2026-09-21 launch-link entry on 2026-09-28 (property names), the 2026-09-21 guards-on-Windows entry and the 2026-09-21 six Windows findings on 2026-09-25 (main's 1.0.3 merged), the 2026-09-21 footer entry and the 2026-09-21 first Windows run on 2026-09-25 (main's 1.0.2 merged), the 2026-09-20 packaged-archive entry on 2026-09-25 (Schedules phase 4), the 2026-09-20 Stage C on 2026-09-25 (Schedules phase 3), the 2026-09-20 evaluation suite on 2026-09-25 (Schedules phase 2), the 2026-09-20 Stage B defects and the assistant audit on 2026-09-25, the 2026-09-20 `solidCount` entry on the seventh 2026-09-24 pass, the 2026-09-20 split of the working notes on the sixth, the 2026-09-20 bounding boxes on the fifth, the 2026-09-20 project frame on the fourth, the 2026-09-19 frame
budget on the third, Phase 10 and the GPU-guard entry on the second, Phase 9b on the first, the
rest on 2026-09-20 — one paragraph each, with the numbers that mattered. **The full text is in
git history** (the cut-outline entry at `d5a4b4c:PROGRESS.md`, the spot-level entry at `e00abee:PROGRESS.md`, the export-and-colour entry at `e006857:PROGRESS.md`, the three 2026-09-28 entries in this repository's own history, at any commit before 2026-10-08's, the 1.0.3 merge at `a82a5a7:PROGRESS.md`, the NVIDIA-first entry at `a661418:PROGRESS.md`, the 1.1.0-beta.1 merge at `157bdfb:PROGRESS.md`, Schedules phase 4 at `9b6e092:PROGRESS.md`, Schedules phases 3 and 2 at `eb9e22e:PROGRESS.md`, the installer-GPU entry at `193a6eb:PROGRESS.md`, Schedules phase 1 at `1f6b787:PROGRESS.md`, the Check-for-updates entry at `60ec62b:PROGRESS.md`, refactor passes 3 and 4 at `2893aff:PROGRESS.md`, refactor pass 2 at `d16f393:PROGRESS.md`, refactor pass 1 at `a195f14:PROGRESS.md`, the class colours at `d7e4527:PROGRESS.md`, the building-box entry at `ad2cd9b:PROGRESS.md`, the gridlines entry at `f71c5c5:PROGRESS.md`, the About story at `abe3ead:PROGRESS.md`, the same-model entry at `47c2eb8:PROGRESS.md`, the landing page at `20c55f2:PROGRESS.md`, the launch link at `18606c8:PROGRESS.md`, the guards on Windows and the six findings at `22c13fc:PROGRESS.md`, the footer and the first Windows run at `a568676:PROGRESS.md`, the packaged archive at `4153e81:PROGRESS.md`, Stage C at `7c1120a:PROGRESS.md`, the evaluation suite at `47480e4:PROGRESS.md`, Stage B and the assistant audit at `4814c5d:PROGRESS.md`, `solidCount` at `9c94265:PROGRESS.md`, the notes split at `8a7086f:PROGRESS.md`, the bounding boxes at `354292c:PROGRESS.md`, the project frame at `c648cc3:PROGRESS.md`, the frame budget at
`5d942e1:PROGRESS.md`, Phase 10 and the GPU guard at `de38150:PROGRESS.md`, Phase 9b at
`d55d989:PROGRESS.md`, the rest at `814f155:PROGRESS.md`), and every decision each phase took
is a row in `docs/DECISIONS.md`.

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
