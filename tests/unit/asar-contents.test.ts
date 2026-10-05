/**
 * What `app.asar` is allowed to contain.
 *
 * Packaging is a deny-list (`electron-builder.yml`'s `files`), so the failure mode is silent
 * and one-directional: a directory nobody thought to exclude is simply shipped. On 2026-09-20
 * the arm64, x64 and Windows archives each carried `.claude/` — the assistant evaluation
 * suite's flows, results and **traces**, and a trace holds a turn's tool results, which on a
 * real model is project data — and `.eval-builds/`, a whole saved developer build. 27.3 MB of
 * archive for 20.5 MB of app.
 *
 * So the rule is asserted rather than trusted: the top level is exactly the three entries the
 * app reads at run time, and `node_modules` holds the production dependencies and none of the
 * development ones. Read straight out of the archive's own header, so it needs no Electron and
 * runs in `npm test`; with no `dist/` it reports itself skipped, exactly as the fixture tests
 * do on a checkout with no model.
 *
 * The archive is **this platform's** packaged tree — `dist/mac-arm64/SGVue.app` on macOS,
 * `dist/win-unpacked` on Windows — the same one `tests/e2e/packaged.spec.ts` drives, so what is
 * asserted here is an archive that was just built rather than one left over from another
 * platform's run. `files` is one list for every platform, so whichever archive is present
 * settles the rule for all three.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const WIN = process.platform === 'win32'
const ASAR = join(
  ROOT,
  WIN ? 'dist/win-unpacked/resources/app.asar' : 'dist/mac-arm64/SGVue.app/Contents/Resources/app.asar'
)

/** `out/` is the build, `package.json` is `main` and the version, `node_modules` the deps. */
const ALLOWED = ['node_modules', 'out', 'package.json']

interface AsarEntry {
  files?: Record<string, AsarEntry>
}

/**
 * The archive's index, out of its own header — a pickled `uint32` length then a pickled JSON
 * string, the format `@electron/asar` writes. `tests/e2e/packaged.spec.ts` reads it the same
 * way for the two `asarUnpack`ed `.wasm` files.
 */
function asarHeader(path: string): AsarEntry {
  const fd = openSync(path, 'r')
  try {
    // Four `uint32`s: the outer pickle's payload size, the header pickle's size, that
    // pickle's own payload size, and the JSON string's length. Then the JSON.
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const json = Buffer.alloc(head.readUInt32LE(12))
    readSync(fd, json, 0, json.length, 16)
    return JSON.parse(json.toString('utf8')) as AsarEntry
  } finally {
    closeSync(fd)
  }
}

/** Every package name under `node_modules`, a scope resolved one level down. */
function packagesIn(nodeModules: AsarEntry): string[] {
  const names: string[] = []
  for (const [name, entry] of Object.entries(nodeModules.files ?? {})) {
    if (name.startsWith('@')) names.push(...Object.keys(entry.files ?? {}).map((c) => `${name}/${c}`))
    else names.push(name)
  }
  return names.sort()
}

if (!existsSync(ASAR)) {
  process.stderr.write(
    `[asar] skipped: no packaged app at ${ASAR} — run ` +
      (WIN
        ? '`npm run dist:win` (or `npx electron-builder --win dir --x64`, which writes only ' +
          'dist/win-unpacked)'
        : '`npm run dist:mac` (or `npx electron-builder --mac dir --arm64`, which writes only ' +
          'dist/mac-arm64)') +
      ' first\n'
  )
  describe('app.asar contents', () => {
    it.skip('skipped: no packaged app in dist/', () => {})
  })
} else {
  describe('app.asar contents', () => {
    const header = asarHeader(ASAR)
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const prod = Object.keys(pkg.dependencies)
    const devOnly = Object.keys(pkg.devDependencies).filter((d) => !prod.includes(d))

    it('holds exactly node_modules, out and package.json at the top level', () => {
      const top = Object.keys(header.files ?? {}).sort()
      const strangers = top.filter((name) => !ALLOWED.includes(name))
      expect(
        strangers,
        `app.asar ships ${strangers.length} top-level entr${strangers.length === 1 ? 'y' : 'ies'} ` +
          `no runtime code reads: ${strangers.join(', ')}. Exclude them in electron-builder.yml's ` +
          `\`files\`, then rebuild. Only ${ALLOWED.join(', ')} belong.`
      ).toEqual([])
      expect(top).toEqual(ALLOWED)
    })

    it('carries the production dependencies and none of the development ones', () => {
      const shipped = packagesIn(header.files!.node_modules)
      const dev = shipped.filter((name) => devOnly.includes(name))
      expect(
        dev,
        `app.asar ships development dependencies: ${dev.join(', ')}. electron-builder copies the ` +
          'production dependency tree only — a name here means package.json moved it.'
      ).toEqual([])
      // …and the check is not passing vacuously: everything `dependencies` names is present.
      expect(prod.filter((name) => !shipped.includes(name))).toEqual([])
    })
  })
}
