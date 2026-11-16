/**
 * 2026-11-16 — can this machine make a symbolic link? Not a test itself (vitest matches
 * `*.test.ts` only).
 *
 * The tests that prove a path is followed to its real file need a real symlink. Windows lets an
 * ordinary user make one only with Developer Mode on (or as an administrator); otherwise
 * `symlink` throws `EPERM`. A hard link or a junction is not a stand-in: a hard link is not
 * followed by `realpath`, and a junction is for a directory. So on such a machine those tests
 * skip, and say why, once per file — and **on CI they never skip**: there a refused symlink
 * fails the run, so the checks always run somewhere (GitHub's Windows runners are
 * administrators).
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function probe(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'sgvue-symlink-probe-'))
  try {
    const target = join(dir, 'target.txt')
    writeFileSync(target, 'x')
    symlinkSync(target, join(dir, 'link.txt'))
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EACCES') throw e
    if (process.env.CI) {
      throw new Error(`symlink refused (${code}) on CI — the symlink checks must run here`, { cause: e })
    }
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** True when `symlink` works here; false only off CI, when the OS refuses it. */
export const CAN_SYMLINK: boolean = probe()

/** Says once, in the test output, which checks were skipped and why. */
export function noteSymlinkSkip(file: string): void {
  if (CAN_SYMLINK) return
  // Straight to stderr, as the fixture tests' notice is: vitest's default reporter swallows
  // `console` output from passing tests.
  process.stderr.write(
    `[${file}] symlink checks skipped: this OS refused to make a symbolic link ` +
      '(on Windows, turn on Developer Mode: Settings › System › For developers). They run on CI.\n'
  )
}
