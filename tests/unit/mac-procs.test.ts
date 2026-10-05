/**
 * The pure half of `scripts/lib/mac-procs.cjs` — the macOS guards' readings.
 *
 * The impure half (`/bin/ps`, `/usr/bin/footprint`, `sysctl`) only exists on macOS. What is
 * checked here is everything that is just data, so it is checked on every machine: the one
 * `footprint(1)` parser all three outer guards now share with the in-process guard (the outer
 * two used to carry their own regex, which read the *peak* line's digits after its thousands
 * separator — `048` of `2,048 MB` — or, with no peak line, 0),
 * and the difference between **listed, none** and **could not list** for `/bin/ps` — the
 * difference `safe-run.cjs` refuses a run on.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const req = createRequire(__filename)
const { parseFootprintMB, readPsListing, rowsMatching, startupListing } = req('../../scripts/lib/mac-procs.cjs')
const scriptGuard = req('../../scripts/lib/electron-guard.cjs')

/** `footprint -p <pid>` as it prints, with thousands separators and the peak line first. */
const FOOTPRINT = [
  '======================================================================',
  'Electron Helper (GPU) [4390]: 64-bit    Footprint: 1,234 MB (16384 bytes per page)',
  '======================================================================',
  '',
  '  Dirty      Clean  Reclaimable    Regions    Category',
  '    ---        ---          ---        ---    ---',
  '1,102 MB        0 B          0 B        120    IOAccelerator',
  '  98 MB      12 MB          0 B        842    MALLOC_SMALL',
  '    ---        ---          ---        ---    ---',
  '1,234 MB      12 MB          0 B       2345    TOTAL',
  '',
  'Auxiliary data:',
  '    phys_footprint_peak: 2,048 MB',
  '    phys_footprint: 1,234 MB',
  ''
].join('\n')

describe('parseFootprintMB', () => {
  it('reads phys_footprint, not the peak line above it, through the thousands separator', () => {
    expect(parseFootprintMB(FOOTPRINT)).toBe(1234)
  })

  it('reads a gigabyte reading the way a runaway GPU process prints it', () => {
    expect(parseFootprintMB(FOOTPRINT.replace('phys_footprint: 1,234 MB', 'phys_footprint: 166.1 GB'))).toBeCloseTo(
      170_086.4,
      1
    )
  })

  it('is null — never 0 — when the line is missing, so the caller decides what unread means', () => {
    expect(parseFootprintMB('')).toBeNull()
    expect(parseFootprintMB(FOOTPRINT.replace(/\s+phys_footprint: .*\n/, '\n'))).toBeNull()
  })

  it('is the very function the in-process guard exports', () => {
    expect(scriptGuard.parseFootprintMB).toBe(parseFootprintMB)
  })
})

describe('readPsListing', () => {
  const stdout = [
    '    1 /sbin/launchd',
    '  812 /Applications/SGVue.app/Contents/MacOS/SGVue',
    '  815 /Applications/SGVue.app/Contents/Frameworks/SGVue Helper (GPU).app/Contents/MacOS/SGVue Helper (GPU)',
    ' 4390 /Users/me/SGVue/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ' 5001 /bin/ps',
    ''
  ].join('\n')

  it('lists every row, keeping an executable path that holds spaces', () => {
    const listed = readPsListing({ status: 0, signal: null, stdout })
    expect(listed.ok).toBe(true)
    expect(listed.procs).toHaveLength(5)
    expect(listed.procs[2]).toEqual({
      pid: 815,
      comm: '/Applications/SGVue.app/Contents/Frameworks/SGVue Helper (GPU).app/Contents/MacOS/SGVue Helper (GPU)'
    })
  })

  it('is could-not-list — not an empty machine — on a timeout, an error, a failure or no output', () => {
    for (const res of [
      { status: null, signal: 'SIGKILL', stdout }, // killed at the timeout
      { status: null, signal: null, error: new Error('ETIMEDOUT'), stdout: '' },
      { status: 1, signal: null, stdout: '' },
      { status: 0, signal: null, stdout: '' }, // `ps -A` always lists at least itself
      undefined
    ]) {
      expect(readPsListing(res)).toEqual({ ok: false, procs: [] })
    }
  })
})

describe('rowsMatching', () => {
  const procs = [
    { pid: 812, comm: '/Applications/SGVue.app/Contents/MacOS/SGVue' },
    { pid: 4390, comm: '/Users/me/SGVue/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' },
    { pid: 77, comm: '/bin/zsh' }
  ]

  it('matches on the executable path, and never on this process', () => {
    expect(rowsMatching(procs, ['node_modules/electron/dist/'], 1)).toEqual([[4390, procs[1].comm]])
    expect(rowsMatching(procs, ['node_modules/electron/dist/', '/SGVue.app/Contents/'], 4390)).toEqual([
      [812, procs[0].comm]
    ])
  })
})

describe('startupListing', () => {
  const good = { ok: true, procs: [{ pid: 1, comm: '/sbin/launchd' }] }
  const bad = { ok: false, procs: [] }

  it('takes the first listing that was made, retrying once', () => {
    const calls: string[] = []
    const seq = [bad, good]
    expect(startupListing(() => (calls.push('ps'), seq.shift()))).toBe(good)
    expect(calls).toHaveLength(2)
  })

  it('does not retry a listing that was made', () => {
    let n = 0
    expect(startupListing(() => (n++, good))).toBe(good)
    expect(n).toBe(1)
  })

  it('reports could-not-list when neither attempt ran — the refusal safe-run acts on', () => {
    expect(startupListing(() => bad).ok).toBe(false)
  })
})
