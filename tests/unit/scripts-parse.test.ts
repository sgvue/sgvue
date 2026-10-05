/**
 * Every script under `scripts/` parses, and none carries a NUL byte.
 *
 * Most of what is there is loaded by no test: the guards, the parity and benchmark harnesses,
 * the assistant's audit and evaluation. Each needs Electron, a built app or a real model to run,
 * so a slip in one — an unclosed brace, a stray character — is found only on the day it is
 * needed. (`shell-sanity.cjs` could not be parsed for a week before anyone ran it.) Running them
 * is not a unit test's to do; **parsing** them is: `node --check` reads a file and compiles it
 * without executing a line. Node only — nothing here imports a script, runs one or starts
 * Electron.
 *
 * The NUL byte: `scripts/ai-eval.cjs` held two raw 0x00 bytes inside template literals until
 * 2026-10-02 — a legal string separator, and a file that every code search then skipped as
 * binary. They are the escape `\u0000` now, the same string at run time; a raw one may not come
 * back.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SCRIPTS = join(ROOT, 'scripts')

/** Every JavaScript file under `dir`, at any depth. */
function scriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return scriptFiles(full)
    return /\.(?:cjs|mjs|js)$/.test(entry.name) ? [full] : []
  })
}

const FILES = scriptFiles(SCRIPTS)
  .map((full) => relative(ROOT, full).split(sep).join('/'))
  .sort()

/**
 * How long one `node --check` may take — said in two places, on purpose. `execFileSync` stops
 * the child at it; and vitest is told to give a test that runs one the same, because its own
 * default is 5 s and is checked when a synchronous test returns. Without the second, a slow
 * start on a loaded machine fails the test at 5 s, and the child's bound can never be the one
 * that applies.
 */
const PARSE_TIMEOUT_MS = 30_000

/** What `node --check` says about a file: nothing when it parses, its error when it does not. */
function parseError(file: string): string {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe', timeout: PARSE_TIMEOUT_MS })
    return ''
  } catch (error) {
    const failed = error as { stderr?: Buffer; message?: string }
    return (failed.stderr?.toString() || failed.message || 'node --check failed').trim()
  }
}

describe('the scripts', () => {
  it('are found: the walk reaches the guards and the eval’s own folder', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(23)
    for (const known of [
      'scripts/safe-run.cjs',
      'scripts/safe-e2e.cjs',
      'scripts/safe-app.cjs',
      'scripts/ai-eval.cjs',
      'scripts/shell-sanity.cjs',
      'scripts/lib/electron-guard.cjs',
      'scripts/eval/graders.cjs'
    ]) {
      expect([known, FILES.includes(known)]).toEqual([known, true])
    }
  })

  it.each(FILES)('%s parses', { timeout: PARSE_TIMEOUT_MS }, (file) => {
    expect(parseError(join(ROOT, file)), `${file} does not parse`).toBe('')
  })

  it.each(FILES)('%s carries no NUL byte', (file) => {
    const at = readFileSync(join(ROOT, file)).indexOf(0)
    expect(at, `${file} holds a raw NUL at byte ${at} — write it as the escape \\u0000`).toBe(-1)
  })

  // (Three checks in one test, so three times the bound.)
  it('…and both checks have teeth: a file that does not parse, and one with a NUL in it, are caught', { timeout: 3 * PARSE_TIMEOUT_MS }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'sgvue-scripts-'))
    try {
      const broken = join(dir, 'broken.cjs')
      writeFileSync(broken, 'const key = `${id}\n')
      expect(parseError(broken)).toMatch(/SyntaxError/)
      // A raw NUL between the two parts of a template literal is legal JavaScript, which is why
      // parsing alone never caught it: the file parses, and the byte is there.
      const nul = join(dir, 'nul.cjs')
      writeFileSync(nul, Buffer.concat([Buffer.from('const key = `${1}'), Buffer.from([0]), Buffer.from('${2}`\n')]))
      expect(parseError(nul)).toBe('')
      expect(readFileSync(nul).indexOf(0)).toBe(17)
      // The escape is the same string, and no such byte.
      const escaped = join(dir, 'escaped.cjs')
      writeFileSync(escaped, 'const key = `${1}\\u0000${2}`\n')
      expect(parseError(escaped)).toBe('')
      expect(readFileSync(escaped).indexOf(0)).toBe(-1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
