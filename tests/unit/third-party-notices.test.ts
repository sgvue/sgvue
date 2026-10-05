/**
 * `THIRD_PARTY_NOTICES.md` is exactly what `scripts/third-party-notices.cjs` writes from the
 * installed dependency tree (2026-10-05).
 *
 * Every installer ships the file (`electron-builder.yml`, `extraResources`), so a dependency
 * added, upgraded or removed without writing it again would ship notices that are no longer
 * true. This is the check that makes that loud. When it fails, run
 * `node scripts/third-party-notices.cjs` and read the diff before committing it.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const req = createRequire(__filename)
const ROOT = join(__dirname, '..', '..')
const notices = req('../../scripts/third-party-notices.cjs') as {
  render: () => string
  collect: () => { name: string; version: string; license: string; where: string[] }[]
  bundledRoots: () => string[]
}

/** Reading the tree and parsing `src/` takes a second or two; a cold CI runner, longer. */
const SLOW = 60_000

describe('THIRD_PARTY_NOTICES.md', () => {
  it('is what the generator writes — run `node scripts/third-party-notices.cjs` when it is not', { timeout: SLOW }, () => {
    const file = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8').replace(/\r\n/g, '\n')
    const fresh = notices.render()
    expect(file === fresh, 'THIRD_PARTY_NOTICES.md is out of date: run `node scripts/third-party-notices.cjs`').toBe(
      true
    )
  })

  it('covers what ships: the runtime dependencies, the bundled packages and the recorded rest', { timeout: SLOW }, () => {
    const components = notices.collect()
    const named = (name: string) => components.find((c) => c.name === name)
    // Everything package.json says the main process loads at run time…
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    for (const name of Object.keys(pkg.dependencies)) {
      expect([name, named(name)?.where.includes('app.asar: node_modules')]).toEqual([name, true])
    }
    // …everything the app's own code imports for Vite to bundle, found by parsing src/…
    const roots = notices.bundledRoots()
    for (const name of ['react', 'react-dom', 'three', 'web-ifc', 'sql.js', 'exceljs', 'zod', '@fontsource/ibm-plex-sans']) {
      expect([name, roots.includes(name)]).toEqual([name, true])
    }
    // …never Electron's own module, a Node built-in or the renderer's path alias…
    expect(roots.filter((r) => r === 'electron' || r.startsWith('node:') || r.startsWith('@renderer'))).toEqual([])
    // …and the licences that carry a duty beyond a notice say where it is met.
    expect(named('web-ifc')?.license).toBe('MPL-2.0')
    const file = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(file).toContain('https://github.com/ThatOpen/engine_web-ifc/tree/0.77')
    expect(file).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(file).toContain('LICENSES.chromium.html')
  })
})
