# Protecting the core — plan

*2026-11-07 · status: **approved** (the owner: *"Approve the recommended defaults for both plans"*); Tier 1 recommended, fast-check added.*

## Where we stand

CI (Windows + macOS + Ubuntu) runs **typecheck → lint → 3,131 unit tests → build** on every push.
The read-only guard test pins the three disk writers, the IPC channels, the preload keys, the
assistant's gated calls and its performers; the design's `<style>` block is pinned line for line.

Seven things a future change could break **without any check failing**:

1. **The two IfcOpenShell ground-truth tests always skip** — in CI and on this Mac — because the real models and their expected data are git-ignored.
2. **Nothing stops editing `design-reference/`** to match a bug, and nothing checks the inline style strings against the design.
3. **Old share links and sessions** are only tested with payloads built inside the tests, never with real old ones.
4. **`invalidate()` after a change** (or the 3D view goes stale) is checked only by a manual window script.
5. **Ids composed without `fedId`**, most web-ifc traps (`.slice()`, the `getPropertySets` loop) and the three.js traps have no rule.
6. **Release builds skip lint and tests**, and the `app.asar` contents test never runs in CI.
7. **No visual baseline, no performance budget, no automatic privacy scan.**

## Proposal, in priority order

### Tier 1 — headless, runs in CI, no window (recommended: all of these)

| # | Check | Kind | Catches |
|---|---|---|---|
| 1 | **Synthetic reference model + committed IfcOpenShell truth** — a generated ~2 000-element IFC (walls, slabs, doors, spaces, grids, storeys, psets, type properties, a far shared origin) and its `expected.json`, both committed | deterministic test | Parser, property and geometry regressions — the two skipping tests run in CI again. |
| 2 | **Design-reference hash pin** — a committed SHA-256 list of every file under `design-reference/` | structural pin | Someone "fixing" the spec to match the code. |
| 3 | **Style strings verbatim** — every `s('…')` literal in `src/renderer/app/` must appear in `SGVue.dc.html`, except an allow-list that names its deviation entry | structural pin | Silent drift from the fidelity contract. |
| 4 | **Compatibility corpus** — committed real old share links, `last.json` sessions, viewpoints and `.schedule.json` files from past builds; each decoded and restored to a recorded state | golden test | Breaking links and saved work people already have. (The project file joins it.) |
| 5 | **Store simulation** — seeded random sequences of 200 user actions (hide, isolate, filter, section, undo, redo, viewpoints, colour) checked after every step: undo returns the exact earlier state, visibility equals the filter rule, caps hold (50 undo, 12 sets), the 5 % guard never lets the assistant blank the view | model-based simulation | Logic bugs no hand-written test thought of. |
| 6 | **Federation simulation** — seeded random synthetic federations (1–6 models, shared and far origins, duplicate stems, all load orders): ids unique and decodable, every element in the tree once, session round-trip identical, result independent of load order | model-based simulation | The id, offset and ordering traps. |
| 7 | **Viewer stub that counts `invalidate()`** — every viewer setter called through the shell must invalidate once; multi-setter actions must go through `viewer.batch` | deterministic test | The stale-frame and over-render bugs, headless. |
| 8 | **Float64 at 33 km** — a part placed 33 km out survives offset subtraction to 0.1 mm | deterministic test | Float32 creeping into the coordinate path. |
| 9 | **More lint traps** — `ID_STRIDE` arithmetic outside `federate.ts`; `GetVertexArray`/`GetIndexArray` without `.slice()`; `getPropertySets` inside a loop; `opacityNode`, `depthNode`, `PCFSoftShadowMap`, `rotation.x = -Math.PI/2`; turn on `reportUnusedDisableDirectives`; lint `tests/` | lint | The rest of `docs/TRAPS.md`. |
| 10 | **Release gate** — `release.yml` runs lint and tests, and the `app.asar` test runs against the installers it builds | CI | Shipping something CI never checked. |
| 11 | **AI eval oracle and null modes in CI** — free, no key: the graders must score 100 % on the oracle and 0 % on the null | CI | A grader change that makes the eval meaningless. |
| 12 | **Privacy scan as a script** — the search I run before every push (emails, home paths, account names, real-coordinate ranges), as `npm run privacy` and a CI step | CI + pre-push | A personal detail reaching the public repo. |

### Tier 2 — needs a window, runs on your yes before a release

| # | Check | Notes |
|---|---|---|
| 13 | **Visual baselines** — the parity states captured once, stored, and a committed diff script with a threshold (mean channel difference, share of pixels over 12) | Baselines stay local (they are large); the README records their hashes. |
| 14 | **Performance budget** — `bench.cjs` exits 1 past a budget (load time, hover ms, orbit fps, draw calls, GPU memory) on the synthetic model of #1 | Budgets set from three runs, with a margin. |
| 15 | **The full e2e suite** before every release | As today, guarded. |

### Not recommended now

- **A self-hosted Mac runner for e2e in CI** — real GPU, always on; worth it only once releases are frequent.
- **A live AI eval in CI** — costs money every push, ±12 points of noise at one repetition.

## Tools

Seeded simulations use the project's existing `mulberry32`. A top team would use **fast-check**
(property-based testing: it also *shrinks* a failing case to the smallest one that still fails).
Recommendation: add fast-check for #5 and #6 — one devDependency, exact pin.

## Order of work

#1, #2, #10 and #12 first (small, high value), then #4 and #7, then the simulations #5 and #6,
then #3, #8, #9, #11. Tier 2 when the next release is prepared.
