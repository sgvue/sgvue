# Releasing SGVue

How a release is made, from 2026-10-05 on. The maintainer makes releases; nothing here is
automatic beyond building the installers.

## Where releases live — and the rule that protects them

Installers are published as GitHub releases of **`sgvue/releases`**, a public repository that
holds release pages and no code. The source is **`sgvue/sgvue`**.

**`sgvue/releases` must stay public, and must never be renamed, transferred or deleted.** Every
installed copy of SGVue from 1.2.0 on asks
`https://api.github.com/repos/sgvue/releases/releases/latest` for the newest version once at
each launch (`src/main/updates.ts`). That request refuses redirects — a renamed or transferred
repository answers with a redirect — and counts only a `200`, so a renamed, moved, private or
deleted repository silently stops every installed copy from hearing about updates. Changing the
URL in a later version helps only the copies installed from that version on. The product site,
https://sgvue.github.io/, reads the same endpoint, and Help › Check for updates… opens the site
with `?v=<version>`.

## Versions and tags

- Versions are `X.Y.Z` (Semantic Versioning), from `package.json`'s `version`.
  `npm version X.Y.Z --no-git-tag-version` sets it, and both root entries of
  `package-lock.json` with it.
- Each release is tagged **`vX.Y.Z`** — in `sgvue/sgvue` on the commit it was built from, and
  as the tag of the release in `sgvue/releases`. The app reads the release's `tag_name` as
  `v?X.Y.Z(-pre)?(+build)?` and ignores anything else.
- **A pre-release** (`vX.Y.Z-beta.N`) is marked *pre-release* on GitHub. GitHub's "latest"
  skips pre-releases, so installed copies are not told about betas; and a `-suffix` sorts below
  the same `X.Y.Z`, so a beta never looks newer than its release.

## Steps

1. **Prepare on `main`.** Set the version. Write `docs/releases/X.Y.Z.md` — what changed, for
   users, and the system requirements — and the version's entry in `CHANGELOG.md`. If a
   dependency changed, run `node scripts/third-party-notices.cjs` (`npm test` fails until the
   notices match); a Dependabot pull request has its notices written on its own branch before
   it is merged, as [CONTRIBUTING.md](../CONTRIBUTING.md) describes. Run `npm run typecheck`,
   `npm test`, `npm run build` and, through its guard, `npm run test:e2e`; CI must be green.
2. **Commit and tag.** Public commits are authored and committed as
   **`Yong Yen <releases@sgvue.invalid>`** — set it in the clone with
   `git config user.name "Yong Yen"` and `git config user.email releases@sgvue.invalid` — and
   never with a personal address. Push the commit, then the tag `vX.Y.Z`.
3. **Build.** The tag starts `.github/workflows/release.yml` (it can also be started by hand,
   from the Actions tab). On GitHub's own runners it builds the Windows installer
   (`npm run dist:win` → `SGVue-X.Y.Z-setup.exe`) and the two macOS disk images
   (`npm run dist:mac` → `SGVue-X.Y.Z-arm64.dmg` and `SGVue-X.Y.Z-x64.dmg`), uploads each as a
   workflow artifact, writes their SHA-256 into the run's summary, and records a
   build-provenance attestation for each. **It publishes nothing.**
4. **Test.** Download the artifacts from the run. Check each file's SHA-256 against the run's
   summary, and its provenance with `gh attestation verify <file> --repo sgvue/sgvue`. The owner
   tests the macOS build on a Mac: it is ad-hoc signed and not notarised, so the first launch
   needs **System Settings → Privacy & Security → Open Anyway**, and the build log's `signing`
   line should read `identityName=-`. `SGVue.app/Contents/Resources/` must hold
   `LICENSES.chromium.html` and `LICENSE.electron.txt` beside `LICENSE`, `NOTICE` and
   `THIRD_PARTY_NOTICES.md` — confirm it on the first macOS build. electron-builder copies those
   two from `node_modules/electron/dist/`, which exists only once Electron's binary is installed
   (`node node_modules/electron/install.js` — `npm ci` alone does not install it); without it the
   build log says `file source doesn't exist` and the build goes on without them. So the release
   workflow runs that command before `npm run dist:mac`, and fails if either file is missing from
   `dist/mac-arm64/SGVue.app` (arm64) or `dist/mac/SGVue.app` (x64). **Building on a Mac yourself,
   run it after `npm ci` and before `npm run dist:mac`**; it returns at once when Electron's
   binary is already installed. Install the Windows build over the previous version, open a
   model, and uninstall it.
5. **Publish, by hand, on `sgvue/releases`.** Create the release with the tag `vX.Y.Z` and the
   title `SGVue X.Y.Z`; paste the notes from `docs/releases/X.Y.Z.md`, with the **SHA-256 of
   each file** at the end; upload the installers; tick *pre-release* for a beta.
6. **Check.** https://sgvue.github.io/?v=X.Y.Z says "You're up to date", and an installed copy
   of the previous version shows the update notice on its home page at its next launch.

The account that pushes, or that creates a release, is shown publicly in the repository's
activity and as the release's author — the same release data the update check reads.

## Signing

- **macOS:** ad-hoc signed (`mac.identity: '-'`, `hardenedRuntime: false` in
  `electron-builder.yml`), not notarised.
- **Windows:** not signed: SmartScreen shows *"Windows protected your PC"* until the user
  chooses **More info → Run anyway**.
- Owed: an Apple Developer ID with notarisation, and a Windows code-signing certificate. The
  release workflow sets `CSC_IDENTITY_AUTO_DISCOVERY=false`, so no certificate is picked up by
  accident until then.
