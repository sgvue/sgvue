#!/usr/bin/env node
/**
 * Dev utility — NOT application code. **The only sanctioned way to start Electron in this
 * repository.**
 *
 *   node scripts/safe-run.cjs bench.cjs
 *   SGVUE_IFC=mock node scripts/safe-run.cjs bench.cjs
 *   SGVUE_MAX_SECONDS=70 SGVUE_MAX_GPU_MB=3000 node scripts/safe-run.cjs bench.cjs
 *
 * Three dev runs kernel-panicked this Mac on 2026-09-17, every one of them with the Electron
 * GPU helper at ~168 GB. `scripts/lib/electron-guard.cjs` watches a live run from inside; this
 * wrapper covers the two things an in-process guard cannot:
 *
 * 1. **Refuse to start a second one.** Two dev Electrons on one machine is how the second
 *    panic happened — the first run's window was still rendering when the next was launched.
 * 2. **Prove the first one is gone afterwards.** A guard that calls `app.exit` normally takes
 *    the helpers with it, but a wedged GPU process can outlive its parent. This kills any
 *    survivor and *says so*, so a run that left something behind is visible rather than
 *    inherited by the next one.
 *
 * It runs the target in the foreground, forwards its output, and exits with its code
 * (2 = the guard tripped).
 *
 * 3. **Isolate `userData`.** Every script here is its own Electron main process, so none of
 *    them loads `src/main/index.ts` and none takes the single-instance lock — but they all
 *    default to the *installed* app's `userData` (`~/Library/Application Support/sgvue`; the
 *    file system is case-insensitive, so `SGVue` and `sgvue` are one directory). That is the
 *    same Chromium profile the user's own window is using: the same `Local Storage` — which
 *    is where the design's saved filter sets and viewpoints live — the same GPUCache, the
 *    same Cookies. A dev run must not read or write any of it. So each run gets a fresh
 *    `--user-data-dir` under the system temp directory and it is removed afterwards. The four
 *    Playwright specs under `tests/e2e/` already do this for themselves
 *    (`mkdtemp` + `--user-data-dir`, e.g. `tests/e2e/smoke.spec.ts:35`); this is the same
 *    guarantee for everything launched through here.
 *
 * The only thing it writes is that temp profile directory, which it also removes.
 *
 * **On Windows** both halves that need the process table are the same rules through different
 * instruments (`scripts/lib/win-procs.cjs`): there is no `/bin/ps`, so the enumeration is one
 * PowerShell `Get-Process` call and a dev Electron is one whose executable lives under
 * `<ROOT>\node_modules\electron\dist\` — compared as a canonical, lower-cased path with a
 * trailing separator, so an 8.3 short name and `…\dist2` both behave. A kill is
 * `taskkill /T /F`, so a helper tree goes with its parent, and an orderly shutdown is given a
 * bounded two seconds before anything is called a survivor. The **in-process** guard this
 * pairs with (`scripts/lib/electron-guard.cjs`) already works here and is untouched: off macOS
 * it reads `getAppMetrics` instead of `phys_footprint`, and its memory-pressure term is
 * always 0 because Windows exposes no equivalent.
 */
const { spawn } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const WIN = process.platform === 'win32'
const win = WIN ? require('./lib/win-procs.cjs') : null
const mac = WIN ? null : require('./lib/mac-procs.cjs')

const ROOT = join(__dirname, '..')
/** Substring of the *executable path* of a dev Electron of this checkout. */
const EXECUTABLE = 'node_modules/electron/dist/'
/** win32: the same thing as a canonical directory key, which is what a path is compared to there. */
const WIN_DEV_ROOT = WIN ? win.rootKey(ROOT) + 'node_modules\\electron\\dist\\' : ''
/** Could the last listing be made at all? Set by `devElectronPids`, read by `finish`. */
let listed = true
/** What to run by hand when it could not. */
const CHECK_BY_HAND = WIN ? win.CHECK_BY_HAND : mac.CHECK_BY_HAND
/** win32: the dev Electrons among one listing's rows — this checkout's, and not this process. */
const winDevPids = (procs) =>
  procs
    .filter((p) => win.isUnderRoots(win.realKey(p.exe), [WIN_DEV_ROOT]))
    .map((p) => p.pid)
    .filter((pid) => pid > 0 && pid !== process.pid)
/** macOS: the same, off `/bin/ps` rows, matched on the executable path. */
const macDevPids = (procs) => mac.rowsMatching(procs, [EXECUTABLE], process.pid).map(([pid]) => pid)

/**
 * Pids of dev Electron processes currently alive.
 *
 * Matched on `comm` — the executable path — and **not** with `pgrep -f`, which matches whole
 * command lines: a shell whose command happens to mention `node_modules/electron` (say,
 * because it starts with a `pkill`) is then reported as a running Electron, and this refuses
 * to start for ever. Worse, the paired `pkill -f` would kill that shell.
 */
function devElectronPids() {
  if (WIN) {
    // `ok` is whether the listing could be made at all. An empty list from a call that timed out
    // or never ran is *unknown*, not *none*, and `finish` must not print it as an all-clear.
    const result = win.listProcessesResult()
    listed = result.ok
    return winDevPids(result.procs)
  }
  // The same on macOS: a `/bin/ps` that failed or timed out is *unknown*, not *none*.
  const result = mac.psListing()
  listed = result.ok
  return macDevPids(result.procs)
}

function killSurvivors() {
  const before = devElectronPids()
  if (WIN) {
    // A helper already on its way out is not a survivor, and calling it one would make the
    // line this prints worthless. Two seconds, then whatever is left really did outlive the run.
    let alive = before
    const deadline = Date.now() + 2000
    while (alive.length && Date.now() < deadline) {
      win.sleepSync(400)
      alive = devElectronPids()
    }
    for (const pid of alive) win.taskkill(pid)
    return alive
  }
  for (const pid of before) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
  return before
}

const [, , script, ...rest] = process.argv
if (!script) {
  console.error('usage: node scripts/safe-run.cjs <script.cjs> [args…]')
  process.exit(64)
}
// A bare name means `scripts/<name>`; anything with a separator in it is a path. On Windows
// that separator is usually a backslash, so it counts there too.
const target = resolve(
  ROOT,
  script.includes('/') || (WIN && script.includes('\\')) ? script : join('scripts', script)
)
if (!existsSync(target)) {
  console.error(`[safe-run] no such script: ${target}`)
  process.exit(66)
}

/**
 * Fail-closed on both platforms. The snapshot is taken once, with one retry, and a listing that
 * could not be made at all refuses the run — an empty list would otherwise read as "no dev
 * Electron is running", which is the one thing this refusal exists to catch.
 */
const snapshot = WIN ? win.startupListing() : mac.startupListing()
const already = WIN ? winDevPids(snapshot.procs) : macDevPids(snapshot.procs)
if (!(WIN ? snapshot.start : snapshot.ok)) {
  console.error(
    `[safe-run] REFUSED: could not list running processes (${WIN ? 'PowerShell' : '/bin/ps'} timed ` +
      `out or did not run), so what was already running cannot be told apart from what this run ` +
      `starts. Nothing was started.  Check by hand:  ${CHECK_BY_HAND}`
  )
  process.exit(69)
}
if (already.length) {
  console.error(
    `[safe-run] REFUSED: ${already.length} dev Electron process(es) already running ` +
      `(${already.join(', ')}). Kill them first:  ` +
      (WIN ? `taskkill /PID ${already.join(' /PID ')} /T /F` : `kill -9 ${already.join(' ')}`)
  )
  process.exit(69)
}

// The electron npm package's main export is the path to the executable when it is required
// from plain Node (inside Electron it is the API object — hence this wrapper being a
// separate process).
const electron = require('electron')
if (typeof electron !== 'string') {
  console.error('[safe-run] must be run with node, not with electron')
  process.exit(70)
}

// A fresh Chromium profile per run, so nothing here can read or write the installed app's.
// The switch follows the script path, which is where `tests/e2e/*.spec.ts` put it too.
const userData = mkdtempSync(join(tmpdir(), 'sgvue-run-'))

console.log(`[safe-run] ${target}`)
console.log(`[safe-run] userData ${userData}`)
const child = spawn(electron, [target, ...rest, `--user-data-dir=${userData}`], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Every script installs the guard itself; this only carries the limits through.
    SGVUE_GUARDED: '1'
  }
})

const finish = (code, signal) => {
  const killed = killSurvivors()
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* a wedged helper can still hold a file open; the temp directory is the OS's problem then */
  }
  if (killed.length) {
    console.log(`[safe-run] KILLED ${killed.length} surviving Electron process(es): ${killed.join(', ')}`)
  } else if (!listed) {
    // An empty list from a listing that never happened is not an all-clear, and must not be
    // printed as one. The exit code is unchanged; the claim is simply not made.
    console.log(
      `[safe-run] COULD NOT LIST processes (${WIN ? 'PowerShell' : '/bin/ps'} timed out or did not run) — check by hand:  ${CHECK_BY_HAND}`
    )
  } else {
    console.log('[safe-run] clean: no Electron process survived the run')
  }
  if (signal) console.log(`[safe-run] child ended on signal ${signal}`)
  process.exit(signal ? 1 : (code ?? 0))
}

child.on('exit', finish)
child.on('error', (err) => {
  console.error(`[safe-run] failed to start: ${err.message}`)
  finish(70, null)
})

// Ctrl-C must take the window with it, not orphan it.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill('SIGKILL')
    finish(1, null)
  })
}
