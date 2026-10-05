/**
 * Dev utility — NOT application code. **Windows only**, and only for the three guard wrappers.
 *
 * `safe-run.cjs`, `safe-e2e.cjs` and `safe-app.cjs` are built on three macOS facilities
 * Windows does not have: `/bin/ps` for the executable path of every process,
 * `/usr/bin/footprint` for `phys_footprint`, and `kern.memorystatus_vm_pressure_level` for
 * machine-wide memory pressure. This is what they read here instead, and it is deliberately
 * **less** — the difference is stated rather than papered over:
 *
 * - **Working set** (`WorkingSet64`) per process, and the sum across them. It is not
 *   `phys_footprint`, and nothing on Windows is; what it misses on macOS is the GPU process's
 *   own memory, which is read separately below.
 * - **GPU dedicated memory**, best effort, from the `\GPU Process Memory(pid_<pid>_*)\Dedicated
 *   Usage` performance counter. One sample costs ~1.2 s on this machine, so the callers take it
 *   every third poll; when the counter set is not present at all, `gpuDedicatedMB` says so once
 *   (`gpu=n/a`) and stops paying for it.
 * - **No memory-pressure signal.** Windows exposes no equivalent of
 *   `kern.memorystatus_vm_pressure_level`, so that term is simply absent from the Windows
 *   guards. Wall clock and the two memory limits are what bound a run here.
 *
 * Every PowerShell call is one `spawnSync` with an **argument array** — never `shell: true` —
 * and the script text uses single quotes only, because Node wraps any argument containing a
 * space in double quotes and nested double quotes do not survive that round trip. **No file
 * path is ever interpolated into PowerShell**; the only thing that ever is, is a numeric pid.
 * That is what lets these guards watch a checkout whose path holds spaces, quotes or a `$`.
 *
 * **Every call is bounded, and a listing that could not be made says so.** `spawnSync` blocks
 * the guard's single thread, so an unbounded one freezes the poll and `SGVUE_MAX_SECONDS` —
 * the backstop the whole guard exists for — is never evaluated. Hence the two timeouts below,
 * and hence `listProcessesResult`, which answers *whether it listed* as well as *what it
 * found*: an empty list is **none** only when the call actually ran, and **unknown** otherwise.
 * `Get-Process` matching nothing prints `[]` and exits 0 (measured here), so no output at all
 * is a failure, never an empty machine. `startupSnapshot` is where that matters most — a guard
 * that could not see what was already running must not start anything at all.
 *
 * Paths are compared as **keys**: `realpathSync.native` first, so the 8.3 short name
 * `C:\Users\JANEDO~1\…` (which is what `%TEMP%` is for a user whose name has a space in it) and
 * the long spelling become one string; then lower-cased, because Windows is case-blind; and
 * every root carries a trailing separator, so `C:\dir` cannot claim a process running from
 * `C:\dir2`. A process whose `Path` is null — a protected process, or one that exited between
 * the enumeration and the read — is never *ours*.
 *
 * It writes nothing to disk.
 */
const { spawnSync } = require('node:child_process')
const { realpathSync } = require('node:fs')
const { resolve } = require('node:path')

/* ─────────────────────────── paths, as comparable keys ─────────────────────────── */

/** Pure. One spelling for comparison: backslashes, lower case. No disk access, no `path.sep`. */
function pathKey(p) {
  return String(p || '')
    .replace(/\//g, '\\')
    .toLowerCase()
}

/** The key of a path that exists: its long, real-case form first, then `pathKey`. */
function realKey(p) {
  if (!p) return ''
  try {
    return pathKey(realpathSync.native(p))
  } catch {
    // Not on disk (a `dist/` that was never built). `resolve` is still a usable prefix.
    return pathKey(resolve(p))
  }
}

/** The key of a directory, with the trailing separator that makes `startsWith` a real test. */
function rootKey(dir) {
  const key = realKey(dir)
  return !key || key.endsWith('\\') ? key : key + '\\'
}

/**
 * Pure. Is this executable key inside one of these root keys? A process with no path never is,
 * and an empty root never claims anything.
 */
function isUnderRoots(exeKey, rootKeys) {
  return !!exeKey && rootKeys.some((root) => !!root && exeKey.startsWith(root))
}

/**
 * Pure. The root one executable belongs to — on Windows there is no `.app` bundle, so the
 * watched directory itself is the bundle — or `''` when it belongs to none of them.
 */
function bundleRootOf(exeKey, rootKeys) {
  if (!exeKey) return ''
  return rootKeys.find((root) => !!root && exeKey.startsWith(root)) || ''
}

/* ─────────────────────────────── the process list ─────────────────────────────── */

/**
 * Pure. The rows `Get-Process … | ConvertTo-Json` produced, as `{ pid, exe, workingSetMB,
 * privateMB }`. Three shapes have to be survived: an **array** for several matches, a **single
 * object** for one (PowerShell unwraps a one-element array — hence `@($p)` at the other end,
 * and this belt as well as that brace), and **nothing at all**, from a call that did not run.
 * Anything that is not a row with a numeric `Id` is dropped rather than thrown over.
 *
 * This answers rows only, so it cannot tell "none" from "could not ask" — measured here, a
 * `Get-Process` matching nothing prints `[]` and exits 0, so empty output is the second of
 * those. A caller that acts on an empty list wants `readProcessList` below.
 */
function parseProcesses(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return []
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }
  return rowsOf(parsed)
}

/** Pure. The rows of an already-parsed listing, one shape or the other. */
function rowsOf(parsed) {
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows
    .filter((row) => row && typeof row === 'object' && typeof row.Id === 'number' && row.Id > 0)
    .map((row) => ({
      pid: row.Id,
      exe: typeof row.Path === 'string' ? row.Path : '',
      workingSetMB: (Number(row.WorkingSet64) || 0) / 1048576,
      privateMB: (Number(row.PrivateMemorySize64) || 0) / 1048576
    }))
}

/**
 * Pure. The *outcome* of one listing, not just its rows: `{ ok, procs }`.
 *
 * `ok: false` is **unknown**, never **none** — the call timed out, PowerShell never started, or
 * what came back was not a listing at all. `procs` is then empty, so a caller that ignores `ok`
 * behaves exactly as it did before; a caller that reads it must not call that an all-clear.
 * `ok: true` with an empty `procs` is the real "nothing is running", which is what `[]` means.
 *
 * The shape test is deliberately narrow: `ConvertTo-Json -InputObject @($p)` produces an array
 * (or, when PowerShell unwraps a one-element array, one object). A bare `null`, string or
 * number is valid JSON and is still not a process listing, so it is a failure.
 */
function readProcessList(res) {
  if (!res || res.ok !== true) return { ok: false, procs: [] }
  const trimmed = String(res.stdout || '').trim()
  if (!trimmed) return { ok: false, procs: [] }
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, procs: [] }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, procs: [] }
  return { ok: true, procs: rowsOf(parsed) }
}

const PROC_SCRIPT =
  '$p = Get-Process -Name SGVue,electron -ErrorAction SilentlyContinue | ' +
  'Select-Object Id,Path,WorkingSet64,PrivateMemorySize64; ' +
  'ConvertTo-Json -Compress -InputObject @($p)'

/**
 * The ceiling on one PowerShell call. `spawnSync` blocks this process, so an unbounded call is
 * an unbounded freeze: a corrupt performance-counter registry under `Get-Counter`, or AV /
 * AppLocker stalling process start, would stop the poll and with it the wall-clock check. The
 * slowest call measured here is `Get-Counter` at ~1.2 s, so 8 s is failure, not slowness.
 */
const POWERSHELL_TIMEOUT_MS = 8000
/** The same reason, shorter: `taskkill` does one thing and has no counters to walk. */
const TASKKILL_TIMEOUT_MS = 5000

/** What the docs tell a human to run when a guard could not list for itself. */
const CHECK_BY_HAND =
  'powershell -NoProfile -Command "Get-Process -Name SGVue,electron -ErrorAction SilentlyContinue | Select Id,Path"'

/**
 * One PowerShell call, argument array: `{ ok, stdout }`, where `ok: false` means it timed out,
 * could not start or was killed. The **exit status is deliberately not part of `ok`** — with
 * `-ErrorAction SilentlyContinue` a `Get-Process` that matches nothing still prints `[]` and
 * exits 0, but nothing here depends on that, and a non-zero status with usable JSON is still a
 * listing. What `ok` reports is whether the call happened at all; `readProcessList` judges the
 * output.
 */
function powershellResult(script) {
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: POWERSHELL_TIMEOUT_MS,
    // Without this the timed-out child is only sent SIGTERM; it must actually be gone.
    killSignal: 'SIGKILL'
  })
  return { ok: !out.error && out.signal == null, stdout: out.stdout || '' }
}

/**
 * Every running `SGVue` / `electron` process on the machine, whoever started it, **and whether
 * the question could be asked at all**. Matched by **name** only to enumerate; what makes one
 * *ours* is its path (`isUnderRoots`), never its name — the user's own installed SGVue is in
 * this list and must survive the run untouched.
 */
function listProcessesResult() {
  return readProcessList(powershellResult(PROC_SCRIPT))
}

/**
 * Pure. The startup verdict from up to two listing attempts: `{ start, procs }`.
 *
 * A guard's snapshot of *what was already running* is what lets it promise to kill only what it
 * started. A listing that could not be made leaves that snapshot empty, and an empty snapshot is
 * not "the machine is clear" — it means a dev Electron this run must refuse would go unseen, and
 * the user's **own** SGVue would be taken for this run's and killed at the end. So the first
 * attempt that actually listed wins, and if none did the answer is `start: false`: do not start
 * anything. `procs` is then empty, because there is nothing trustworthy to carry.
 */
function startupSnapshot(...attempts) {
  const listed = attempts.find((a) => a && a.ok === true)
  return listed ? { start: true, procs: listed.procs || [] } : { start: false, procs: [] }
}

/** The startup listing itself, retried once — a cold PowerShell start can outrun the timeout. */
function startupListing() {
  const attempts = [listProcessesResult()]
  if (!attempts[0].ok) attempts.push(listProcessesResult())
  return startupSnapshot(...attempts)
}

/* ─────────────────────────── GPU dedicated memory ─────────────────────────── */

let gpuUnavailable = false

/**
 * Megabytes of `\GPU Process Memory(pid_<pid>_*)\Dedicated Usage`, summed per pid and taken at
 * the worst pid — the shape of the number the macOS guards trip on. `null` means *no reading*:
 * no pids to ask about, or the counter set is missing on this machine, in which case it is
 * asked for only once. `0` is a real reading — the counters exist and this app holds no
 * dedicated memory yet.
 */
function gpuDedicatedMB(pids) {
  if (!pids.length || gpuUnavailable) return null
  const counters = pids.map((pid) => `'\\GPU Process Memory(pid_${pid}_*)\\Dedicated Usage'`).join(',')
  const res = powershellResult(
    `$s = (Get-Counter -Counter ${counters} -ErrorAction SilentlyContinue).CounterSamples | ` +
      'Select-Object InstanceName,CookedValue; ConvertTo-Json -Compress -InputObject @($s)'
  )
  const text = res.stdout.trim()
  // `@($s)` always serialises to at least `[]`, so *no output at all* means the query itself
  // could not run — the counter set is not on this machine. A call that timed out says the same
  // thing the only way it can, and latches for the same reason the others do: a `Get-Counter`
  // that hangs on a damaged counter registry would otherwise cost the timeout every third poll.
  // Say it once, then stop paying.
  if (!res.ok || !text) {
    gpuUnavailable = true
    return null
  }
  let rows
  try {
    rows = JSON.parse(text)
  } catch {
    return 0
  }
  const perPid = new Map()
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    const m = /^pid_(\d+)_/.exec(String((row && row.InstanceName) || ''))
    if (!m) continue
    perPid.set(m[1], (perPid.get(m[1]) || 0) + (Number(row.CookedValue) || 0))
  }
  let peak = 0
  for (const bytes of perPid.values()) peak = Math.max(peak, bytes / 1048576)
  return peak
}

/* ─────────────────────────────── killing ─────────────────────────────── */

/**
 * `taskkill /T /F`: the pid and its whole tree, which is what a helper-spawning app needs.
 * Bounded, because this blocks the guard exactly as a PowerShell call does.
 */
function taskkill(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: TASKKILL_TIMEOUT_MS,
    killSignal: 'SIGKILL'
  })
}

/** A synchronous pause, so a guard can let a dying helper leave before calling it a survivor. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

module.exports = {
  CHECK_BY_HAND,
  pathKey,
  realKey,
  rootKey,
  isUnderRoots,
  bundleRootOf,
  parseProcesses,
  readProcessList,
  powershellResult,
  listProcessesResult,
  startupSnapshot,
  startupListing,
  gpuDedicatedMB,
  taskkill,
  sleepSync
}
