/**
 * Dev utility — NOT application code. **macOS only**, and only for the guards: the three
 * macOS instruments they read — `/bin/ps` for the executable path of every process,
 * `/usr/bin/footprint` for `phys_footprint`, and `kern.memorystatus_vm_pressure_level` — each
 * behind one bounded `spawnSync`, with the parsing kept pure so `tests/unit/mac-procs.test.ts`
 * can check it on a machine that has none of them.
 *
 * Electron-free on purpose: `safe-run.cjs`, `safe-e2e.cjs` and `safe-app.cjs` run under plain
 * Node, and `scripts/lib/electron-guard.cjs` re-exports `parseFootprintMB` from here so the
 * in-process guard and the outer guards read `footprint(1)` with one parser.
 *
 * **Every call is bounded**, for the reason `scripts/lib/win-procs.cjs` gives: a `spawnSync`
 * blocks the guard's single thread, and an unbounded one would freeze the poll so that
 * `SGVUE_MAX_SECONDS` is never evaluated. **A listing that could not be made says so**: `/bin/ps
 * -Ao` always lists at least itself, so an empty, failed or timed-out call is *unknown*, never
 * an empty machine.
 *
 * It writes nothing to disk.
 */
const { spawnSync } = require('node:child_process')

const PS_TIMEOUT_MS = 5000
const FOOTPRINT_TIMEOUT_MS = 4000
const SYSCTL_TIMEOUT_MS = 2000

/** What to run by hand when a listing could not be made. */
const CHECK_BY_HAND = 'ps -Ao pid=,comm= | grep -e node_modules/electron/dist/ -e /SGVue.app/Contents/'

/** One bounded call. Without `killSignal` a timed-out child is only sent SIGTERM. */
const run = (cmd, args, timeout) =>
  spawnSync(cmd, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'] })

/**
 * Pure. Pull `phys_footprint:` out of `footprint(1)`'s auxiliary data and return megabytes, or
 * `null` when the line is missing. `phys_footprint_peak:` is a different line and never matches.
 * `src/main/gpu-guard.ts` has the same function; `tests/unit/gpu-guard.test.ts` holds them equal.
 */
function parseFootprintMB(text) {
  const m = /phys_footprint:\s*([\d.,]+)\s*([KMGB]+)/i.exec(text || '')
  if (!m) return null
  const value = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  const unit = m[2].toUpperCase()
  if (unit === 'GB') return value * 1024
  if (unit === 'MB') return value
  if (unit === 'KB') return value / 1024
  if (unit === 'B') return value / 1048576
  return null
}

/**
 * Pure. Judge one `spawnSync('/bin/ps', ['-Ao', 'pid=,comm='])` result: `{ ok, procs }`, each
 * row `{ pid, comm }`. `ok` is false when the call errored, was killed (a timeout), exited
 * non-zero or printed no row at all — never an empty list passed off as an empty machine.
 */
function readPsListing(res) {
  const procs = String((res && res.stdout) || '')
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*?)\s*$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), comm: m[2] }))
    .filter((p) => p.pid > 0)
  const ran = !!res && !res.error && res.signal == null && res.status === 0
  return { ok: ran && procs.length > 0, procs: ran ? procs : [] }
}

/**
 * Pure. `[pid, comm]` of every row whose executable path contains one of `executables` — matched
 * on the path and never with `pgrep -f`, see `scripts/safe-run.cjs` — and never `selfPid`.
 */
function rowsMatching(procs, executables, selfPid) {
  return procs
    .filter((p) => p.pid !== selfPid && executables.some((e) => p.comm.includes(e)))
    .map((p) => [p.pid, p.comm])
}

/** Every process's pid and executable path, and whether the listing could be made at all. */
function psListing() {
  return readPsListing(run('/bin/ps', ['-Ao', 'pid=,comm='], PS_TIMEOUT_MS))
}

/**
 * The startup snapshot, retried once. The caller refuses to start anything when `ok` is false:
 * an empty snapshot would hide a dev Electron it must refuse, and make a packaged SGVue the
 * user already had open look like this run's to kill. `list` is injectable for the tests.
 */
function startupListing(list = psListing) {
  const first = list()
  return first.ok ? first : list()
}

/** `phys_footprint` of one pid in MB, or `null` when it cannot be read (gone, or timed out). */
function footprintMB(pid) {
  if (!pid) return null
  const res = run('/usr/bin/footprint', ['-p', String(pid)], FOOTPRINT_TIMEOUT_MS)
  return res.error || res.signal != null ? null : parseFootprintMB(res.stdout)
}

/** `kern.memorystatus_vm_pressure_level`: 1 normal · 2 warning · 4 critical; `null` unread. */
function pressureLevel() {
  const res = run('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], SYSCTL_TIMEOUT_MS)
  const level = Number(String(res.stdout || '').trim())
  return res.error || res.signal != null || !(level > 0) ? null : level
}

module.exports = {
  CHECK_BY_HAND,
  PS_TIMEOUT_MS,
  FOOTPRINT_TIMEOUT_MS,
  SYSCTL_TIMEOUT_MS,
  parseFootprintMB,
  readPsListing,
  rowsMatching,
  psListing,
  startupListing,
  footprintMB,
  pressureLevel
}
