/**
 * The pure half of `scripts/lib/win-procs.cjs` — the Windows guards' process arithmetic.
 *
 * The impure half (PowerShell, `Get-Counter`, `taskkill`) can only be exercised on Windows and
 * is exercised there by running the guards themselves. What is checked here is everything that
 * is just data, so it is checked on every machine: the three shapes `ConvertTo-Json` produces,
 * the path rule that decides whether a process belongs to this checkout, and — since the guard
 * bounded every call it makes — the difference between **listed, none** and **could not list**.
 * All three were real traps: a single match serialises as an object rather than an array,
 * `%TEMP%` for a user whose name has a space in it is the 8.3 short name `C:\Users\JANEDO~1\…`,
 * a plain `startsWith` lets `C:\dir` claim a process running from `C:\dir2`, and an empty list
 * from a PowerShell call that timed out would otherwise be reported as `clean:` — or, at
 * startup, let a run begin that cannot tell the user's own SGVue from its own (`startupSnapshot`).
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const req = createRequire(__filename)
const { pathKey, isUnderRoots, bundleRootOf, parseProcesses, readProcessList, startupSnapshot } = req(
  '../../scripts/lib/win-procs.cjs'
)

const row = (over: Record<string, unknown> = {}) => ({
  Id: 4242,
  Path: 'C:\\Users\\Someone\\SGVue\\dist\\win-unpacked\\SGVue.exe',
  WorkingSet64: 209_715_200, // 200 MB
  PrivateMemorySize64: 104_857_600, // 100 MB
  ...over
})

describe('parseProcesses', () => {
  it('reads an array of rows into pid, exe and megabytes', () => {
    expect(parseProcesses(JSON.stringify([row(), row({ Id: 7, WorkingSet64: 0 })]))).toEqual([
      {
        pid: 4242,
        exe: 'C:\\Users\\Someone\\SGVue\\dist\\win-unpacked\\SGVue.exe',
        workingSetMB: 200,
        privateMB: 100
      },
      {
        pid: 7,
        exe: 'C:\\Users\\Someone\\SGVue\\dist\\win-unpacked\\SGVue.exe',
        workingSetMB: 0,
        privateMB: 100
      }
    ])
  })

  it('reads a single object, because PowerShell unwraps a one-element array', () => {
    expect(parseProcesses(JSON.stringify(row())).map((p: { pid: number }) => p.pid)).toEqual([4242])
  })

  it('reads nothing as no processes — Get-Process exits non-zero when it matches none', () => {
    for (const text of ['', '   ', '\n', null, undefined]) expect(parseProcesses(text)).toEqual([])
  })

  it('reads garbage and an empty array as no processes rather than throwing', () => {
    for (const text of ['[]', 'not json', '{', '<#< CLIXML', 'null', '"a string"', '42']) {
      expect(parseProcesses(text)).toEqual([])
    }
  })

  it('drops a row without a numeric Id', () => {
    const text = JSON.stringify([row(), row({ Id: '4243' }), row({ Id: null }), { Path: 'x' }])
    expect(parseProcesses(text).map((p: { pid: number }) => p.pid)).toEqual([4242])
  })

  it('reads a null Path as no path, and missing sizes as zero', () => {
    expect(parseProcesses(JSON.stringify([row({ Path: null, WorkingSet64: null })]))).toEqual([
      { pid: 4242, exe: '', workingSetMB: 0, privateMB: 100 }
    ])
  })
})

describe('readProcessList', () => {
  const ran = (stdout: string) => readProcessList({ ok: true, stdout })

  it('tells "listed, none" from "could not list" — the whole point of it', () => {
    // `Get-Process` matching nothing prints `[]` and exits 0, measured on Windows 11. So `[]` is
    // an answer, and no output at all is a call that did not happen.
    expect(ran('[]')).toEqual({ ok: true, procs: [] })
    expect(ran('')).toEqual({ ok: false, procs: [] })
  })

  it('reads rows when the call ran, in both shapes PowerShell produces', () => {
    expect(ran(JSON.stringify([row(), row({ Id: 7 })])).procs.map((p: { pid: number }) => p.pid)).toEqual([
      4242, 7
    ])
    expect(ran(JSON.stringify(row())).procs.map((p: { pid: number }) => p.pid)).toEqual([4242])
    expect(ran(JSON.stringify([row()])).ok).toBe(true)
  })

  it('calls a timeout, a spawn failure or a killed call "could not list", whatever it printed', () => {
    expect(readProcessList({ ok: false, stdout: '' })).toEqual({ ok: false, procs: [] })
    // Half a listing from a call that was killed mid-write is not a listing.
    expect(readProcessList({ ok: false, stdout: '[]' })).toEqual({ ok: false, procs: [] })
    expect(readProcessList({ ok: false, stdout: JSON.stringify([row()]) })).toEqual({ ok: false, procs: [] })
  })

  it('calls nothing, whitespace and a missing result "could not list" rather than none', () => {
    for (const stdout of ['', '   ', '\r\n']) expect(ran(stdout)).toEqual({ ok: false, procs: [] })
    for (const res of [null, undefined, {}]) expect(readProcessList(res)).toEqual({ ok: false, procs: [] })
  })

  it('calls garbage and a truncated or CLIXML reply "could not list"', () => {
    for (const stdout of ['not json', '{', '[{"Id":1}', '<#< CLIXML', '#< CLIXML<Objs']) {
      expect(ran(stdout)).toEqual({ ok: false, procs: [] })
    }
  })

  it('calls valid JSON that is not a listing "could not list" — `@(…)` never prints these', () => {
    for (const stdout of ['null', '"a string"', '42', 'true']) {
      expect(ran(stdout)).toEqual({ ok: false, procs: [] })
    }
  })

  it('is "listed, none" for an array whose rows are all unusable, as `@($null)` would be', () => {
    expect(ran('[null]')).toEqual({ ok: true, procs: [] })
    expect(ran(JSON.stringify([{ Path: 'x' }, { Id: '4243' }]))).toEqual({ ok: true, procs: [] })
  })

  it('agrees with parseProcesses about the rows whenever it says it listed', () => {
    for (const stdout of ['[]', '[null]', JSON.stringify([row(), row({ Id: 7 })]), JSON.stringify(row())]) {
      expect(ran(stdout).procs).toEqual(parseProcesses(stdout))
    }
  })
})

describe('startupSnapshot', () => {
  const one = { pid: 4242, exe: 'x', workingSetMB: 1, privateMB: 1 }
  const listed = (procs: unknown[] = []) => ({ ok: true, procs })
  const failed = { ok: false, procs: [] }

  it('starts on a listing that happened, and carries exactly what it found', () => {
    expect(startupSnapshot(listed([one]))).toEqual({ start: true, procs: [one] })
    // "Listed, nothing running" is the ordinary case and must still start.
    expect(startupSnapshot(listed())).toEqual({ start: true, procs: [] })
  })

  it('refuses when the only attempt could not list — an empty snapshot is not a clear machine', () => {
    expect(startupSnapshot(failed)).toEqual({ start: false, procs: [] })
  })

  it('refuses when both attempts failed, and carries nothing it cannot vouch for', () => {
    expect(startupSnapshot(failed, { ok: false, procs: [one] })).toEqual({ start: false, procs: [] })
  })

  it('starts on the retry when the first attempt failed — a cold PowerShell start can be slow', () => {
    expect(startupSnapshot(failed, listed([one]))).toEqual({ start: true, procs: [one] })
    expect(startupSnapshot(failed, listed())).toEqual({ start: true, procs: [] })
  })

  it('takes the first attempt that listed, not the last', () => {
    expect(startupSnapshot(listed([one]), listed())).toEqual({ start: true, procs: [one] })
  })

  it('refuses on no attempts at all, and on results that are not results', () => {
    expect(startupSnapshot()).toEqual({ start: false, procs: [] })
    for (const bad of [null, undefined, {}, { ok: 'yes', procs: [one] }, { ok: 1, procs: [one] }]) {
      expect(startupSnapshot(bad)).toEqual({ start: false, procs: [] })
    }
  })

  it('answers an empty list for an attempt that says it listed but carries nothing', () => {
    expect(startupSnapshot({ ok: true })).toEqual({ start: true, procs: [] })
  })
})

describe('pathKey', () => {
  it('lower-cases and normalises the separator, so one path is one string', () => {
    expect(pathKey('C:/Users/Jane Doe/SGVue/Dist/Win-Unpacked/SGVue.exe')).toBe(
      'c:\\users\\jane doe\\sgvue\\dist\\win-unpacked\\sgvue.exe'
    )
  })

  it('answers an empty string for nothing', () => {
    for (const p of ['', null, undefined]) expect(pathKey(p)).toBe('')
  })
})

const DIST = 'c:\\repo\\dist\\win-unpacked\\'
const DEV = 'c:\\repo\\node_modules\\electron\\dist\\'
const ROOTS = [DIST, DEV]

describe('isUnderRoots', () => {
  it('claims an executable inside a root', () => {
    expect(isUnderRoots(DIST + 'sgvue.exe', ROOTS)).toBe(true)
    expect(isUnderRoots(DEV + 'electron.exe', ROOTS)).toBe(true)
  })

  it('is case-blind through pathKey, as Windows is', () => {
    expect(isUnderRoots(pathKey('C:\\Repo\\Dist\\Win-Unpacked\\SGVue.exe'), ROOTS)).toBe(true)
  })

  it('does not let C:\\dir claim a process running from C:\\dir2 — the trailing separator', () => {
    expect(isUnderRoots('c:\\dir2\\sgvue.exe', ['c:\\dir\\'])).toBe(false)
    expect(isUnderRoots('c:\\dir\\sgvue.exe', ['c:\\dir\\'])).toBe(true)
  })

  it('never claims a process with no path — a protected one, or one that has just gone', () => {
    for (const exe of ['', null, undefined]) expect(isUnderRoots(exe, ROOTS)).toBe(false)
  })

  it('is never claimed by an empty root, and never by no roots at all', () => {
    expect(isUnderRoots(DIST + 'sgvue.exe', ['', undefined])).toBe(false)
    expect(isUnderRoots(DIST + 'sgvue.exe', [])).toBe(false)
  })
})

describe('bundleRootOf', () => {
  it('answers the root an executable belongs to — on Windows the directory is the bundle', () => {
    expect(bundleRootOf(DIST + 'sgvue.exe', ROOTS)).toBe(DIST)
    expect(bundleRootOf(DEV + 'electron.exe', ROOTS)).toBe(DEV)
  })

  it('answers an empty string for an outsider, and for a process with no path', () => {
    expect(bundleRootOf('c:\\program files\\other\\sgvue.exe', ROOTS)).toBe('')
    expect(bundleRootOf('', ROOTS)).toBe('')
  })

  it('answers the first matching root when one root is inside another', () => {
    const outer = 'c:\\repo\\'
    expect(bundleRootOf(DIST + 'sgvue.exe', [DIST, outer])).toBe(DIST)
    expect(bundleRootOf(DIST + 'sgvue.exe', [outer, DIST])).toBe(outer)
  })
})
