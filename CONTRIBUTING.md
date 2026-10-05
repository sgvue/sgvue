# Contributing to SGVue

Thank you for helping. SGVue has a single maintainer, so please read this before you open a
pull request — it is short, and the rules in it are ones the project cannot bend.

- **Questions and bug reports** go to GitHub Issues — see [SUPPORT.md](SUPPORT.md). For anything
  larger than a fix, open an issue first, so the change is agreed before you spend time on it.
- **Security problems** never go in a public issue — see [SECURITY.md](SECURITY.md).
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## What you need

- **Windows 10 or 11, or macOS 13 or later.** Those are the platforms SGVue ships for. Linux is
  not a target: CI runs the unit tests there to catch portability slips, nothing more.
- **Node.js 22.12 or later** (`.nvmrc` says 24) with npm, and Git.
- Only for the generator scripts in `scripts/*.py` — the app icons, the installer images, the
  IFC test fixtures and their IfcOpenShell ground truth: **Python 3** with **Pillow** and
  **IfcOpenShell**.

## Set up

```bash
git clone https://github.com/sgvue/sgvue.git
cd sgvue
npm ci
```

Electron's own binary (about 100 MB) is downloaded the first time something needs it — the
first `npm test` does — or at once with `node node_modules/electron/install.js`.

## The commands

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc` over the Node side and the web side |
| `npm test` | The unit tests and the read-only guard (vitest). No Electron window and no GPU; the tests make no network call — only the first run may download Electron's binary, once (above) |
| `npm run build` | Type-check, then build main, preload and renderer into `out/` |
| `npm run test:e2e` | The Electron end-to-end suite (Playwright), through its guard. Needs a GPU with WebGL2 |
| `npm run dist:win` · `npm run dist:mac` | The installers, into `dist/`. Before `dist:mac`, run `node node_modules/electron/install.js` — the disk images copy Electron's licence and Chromium's notices from the binary it installs ([docs/RELEASING.md](docs/RELEASING.md)) |
| `npm run test:packaged` | The packaged app in `dist/`, through its guard |

[docs/COMMANDS.md](docs/COMMANDS.md) has every command, including the development utilities.

## Electron runs only under a guard

Never `npm run dev`. Never `npx electron …`. Never in the background, and never two at once.
Every Electron run goes through one of the three guards:

- `node scripts/safe-run.cjs <script.cjs>` — a development Electron;
- `npm run test:e2e` (`scripts/safe-e2e.cjs`) — the Playwright suite;
- `node scripts/safe-app.cjs` — the packaged app.

**Why:** an unguarded development window once let Chromium's GPU process allocate memory
without limit, and the development Mac crashed (a kernel panic) three times in one day. Each
guard samples the GPU process's memory — `phys_footprint` on macOS; working set and the GPU
dedicated-memory counter on Windows — stops the run when it goes over budget
(`SGVUE_MAX_GPU_MB`, `SGVUE_MAX_RENDERER_MB`, `SGVUE_MAX_SECONDS`), kills only what it started,
and reports whether anything survived. If a guard trips, stop, note the numbers and change the
code; do not run the same thing again.

## Tests, and what CI runs

- `npm run typecheck` and `npm test` must pass. CI runs `npm ci`, `npm run typecheck`,
  `npm test` and `npm run build` on Windows, macOS and Ubuntu for every pull request and every
  push to `main`.
- Tests that need a real model skip themselves without one (`samples/` is git-ignored), and the
  packaged-archive test skips without a `dist/`.
- The end-to-end suite needs a real GPU, so CI does not run it. If you change the interface or
  the renderer, run `npm run test:e2e` yourself and say so in the pull request.
- **Changed a dependency?** Run `node scripts/third-party-notices.cjs` and commit the
  `THIRD_PARTY_NOTICES.md` it writes — every installer ships that file, and `npm test` fails
  until it matches the installed tree.
- **A Dependabot pull request** that changes a package SGVue ships fails that same test, because
  Dependabot does not write the notices. The maintainer checks out the pull request's branch
  (`gh pr checkout <number>`), runs `npm ci` — the generator reads the installed tree, so it has
  to be the branch's — then `node scripts/third-party-notices.cjs`, reads the diff, commits
  `THIRD_PARTY_NOTICES.md`, pushes to the same branch, and merges once CI is green. Dependabot
  stops rebasing a pull request once someone else has pushed to it, and `@dependabot recreate`
  drops that commit: after a recreate, write the notices again.

## The rules the project cannot bend

### SGVue is a viewer, and never writes model data

There is no IFC write path, no "save model", and no tool — for the user or for the assistant —
that edits a name, a property, a classification or geometry. `src/shared/readonly-list.ts`
holds the forbidden names, and `tests/readonly-guard.test.ts` fails the build if one appears.
Only three modules write to disk: `src/main/settings.ts`, `src/main/sessions.ts` and
`src/main/exports.ts`, the last only to a path the user picked in the native Save dialog.

### The design is the specification

`design-reference/` is the specification of record for everything visible — markup, tokens,
spacing, copy, motion and the look of the 3D scene. The app is a port of it: the same
structure, class names, copy and numbers. **`design-reference/` is read-only**; never edit it
to match the code. A visible change is a design decision: propose it in an issue first, and
when it is accepted it is recorded as an allowed deviation in `CLAUDE.md`, with a dated row in
`docs/DECISIONS.md` and the measurements that show what moved. A pull request that changes what
the user sees without that record will be asked to add it.

### No real project data, anywhere

Never commit a real IFC model, real coordinates, project or client names, element or storey
names, GlobalIds, or anything else read from a real project — in code, tests, documents,
screenshots or commit messages. `samples/` and the IfcOpenShell ground truth are git-ignored
for exactly this reason. Tests use the synthetic fixtures in `tests/fixtures/` (written by
`scripts/make-tiny-ifc.py`) and the design's mock federation; documents use the synthetic,
whole-metre-shifted site (`12345.457 / 23456.766 / 5.05`).

### Dependencies are pinned

Versions are exact. Electron, three.js and web-ifc are upgraded only with a measured
comparison — `docs/TRAPS.md` and `docs/DECISIONS.md` say what each upgrade has broken before —
so Dependabot does not propose version updates for them. A new dependency needs a reason in the
pull request.

## Commits and pull requests

- Branch from `main`, make one change per pull request, and keep the diff as small as it can be.
- Write the commit's summary as one plain sentence about what changed; put the why in the body.
- Fill in the pull-request template. A decision that will outlive the change gets a dated row in
  `docs/DECISIONS.md`.

## Your contribution's licence

SGVue is licensed under the [Apache License 2.0](LICENSE). As its section 5 says, a contribution
you submit for inclusion is licensed under those same terms, with no further conditions. You
keep the copyright in what you wrote; there is no contributor licence agreement to sign.

## Releases

The maintainer makes them — [docs/RELEASING.md](docs/RELEASING.md) describes how.

## Working with AI coding agents

SGVue is built with AI coding agents, and [CLAUDE.md](CLAUDE.md) holds the notes they work from:
the fidelity contract, the rules above in full, and an index of every decision and trap. Read it
if you work the same way; the rules in this file apply either way.
