/**
 * A test's temporary folder is resolved with the **native** realpath, the one `fs/promises` — and
 * so `admit()` and the project writer — use. On Windows the temporary folder can be an 8.3 short
 * name (`C:\Users\<name>~1\…`); `realpathSync` keeps it and only the native call spells it out, so
 * a test that resolved its folder with `realpathSync` expected paths the app never hands back
 * (Windows CI, 2026-11-07). macOS cannot show that, so this reads the tests for the call instead.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TESTS = join(__dirname, '..')

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|tsx|cjs|mjs|js)$/.test(e.name) ? [join(dir, e.name)] : []
  )
}

describe('temporary folders in tests', () => {
  it('are resolved with realpathSync.native, never realpathSync alone', () => {
    const bad = files(TESTS)
      .filter((f) => f !== __filename)
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => [line, i] as const)
          .filter(([line]) => /\brealpathSync\s*\(/.test(line))
          .map(([, i]) => `${f.slice(TESTS.length + 1).replace(/\\/g, '/')}:${i + 1}`)
      )
    expect(bad).toEqual([])
  })
})
