#!/usr/bin/env node
/**
 * Dev utility — NOT application code. **The only sanctioned way to run the Electron smoke
 * test.** `npm run test:e2e` is this file.
 *
 *   node scripts/safe-e2e.cjs [playwright args…]
 *
 * `scripts/safe-run.cjs` guards an Electron *this repository starts*. Playwright starts its
 * own, several times, and the in-process guard (`scripts/lib/electron-guard.cjs`) cannot be
 * installed in them — so the same footprint / pressure / time limits are applied from outside
 * instead:
 *
 * 1. **Refuse to start** while any dev Electron of this checkout is alive (matched on the
 *    executable path, never `pgrep -f` — see `safe-run.cjs` for why). A **packaged** SGVue the
 *    user already has open is not a reason to refuse: its pids *and its whole `.app` bundle* are
 *    snapshotted before the run and then never signalled and never measured. The bundle matters
 *    as much as the pids — an open app spawns and replaces helper processes while the user works
 *    (measured on 2026-09-19), and those would look new. This may only kill what it started
 *    itself, which means a bundle that was not already running.
 * 2. **Watch every Electron the run starts.** `phys_footprint` is polled through
 *    `/usr/bin/footprint`, which is the only number that sees what a runaway GPU process is
 *    actually holding (`getAppMetrics` and `ps rss` both read ~100 MB while it grows by
 *    gigabytes — measured, 2026-09-17). Over the limit, or over the wall-clock budget, the
 *    whole run is killed.
 * 3. **Prove nothing survived**, and say so either way.
 *
 * **On Windows** the three rules are the same and the instruments are not, because none of
 * `/bin/ps`, `/usr/bin/footprint` or `kern.memorystatus_vm_pressure_level` exists there. The
 * enumeration is PowerShell (`scripts/lib/win-procs.cjs`), a process belongs to this run when
 * its executable lives under `<ROOT>\node_modules\electron\dist\` or `<ROOT>\dist\win-unpacked\`
 * — a *directory* is what a Windows process belongs to, there being no `.app` bundle — and what
 * is measured is **working set per process and summed**, plus the GPU process's own
 * `\GPU Process Memory(pid_…)\Dedicated Usage` counter, best effort and every third poll
 * because one sample costs ~1.2 s. **There is no memory-pressure term on Windows**; the wall
 * clock and the two memory limits are the whole guard. Polling is every 1 500 ms rather than
 * 500, since each PowerShell call costs ~0.4 s. A kill is `taskkill /T /F`, so a helper tree
 * goes with its parent. Playwright is started as `node node_modules/@playwright/test/cli.js`,
 * because `node_modules/.bin/playwright` is an extension-less POSIX shim Windows cannot execute.
 *
 * Limits (overridable): SGVUE_MAX_GPU_MB 2500 · SGVUE_MAX_TOTAL_MB 9000 · SGVUE_MAX_SECONDS 600.
 * It writes nothing to disk.
 */
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const WIN = process.platform === 'win32'
const win = WIN ? require('./lib/win-procs.cjs') : null
const mac = WIN ? null : require('./lib/mac-procs.cjs')

const ROOT = join(__dirname, '..')
/**
 * Substrings of the *executable path* of anything this suite may start. The dev Electron of
 * this checkout, and — since Phase 10 put `tests/e2e/packaged.spec.ts` in the same directory —
 * a **packaged** SGVue and its `SGVue Helper (…)` children, which live under a different path
 * entirely and would otherwise run unwatched.
 */
const EXECUTABLES = ['node_modules/electron/dist/', '/SGVue.app/Contents/']
/** The one whose presence still refuses the run (see the header). */
const DEV_ELECTRON = 'node_modules/electron/dist/'

/**
 * win32: the same two things as directories, canonical and lower-cased, so an 8.3 short name
 * cannot hide one from the other. `WIN_ROOTS[0]` is the dev Electron — the one that refuses.
 */
const WIN_ROOTS = []
if (WIN) {
  const root = win.rootKey(ROOT)
  WIN_ROOTS.push(root + 'node_modules\\electron\\dist\\', root + 'dist\\win-unpacked\\')
}

const MAX_ONE_MB = Number(process.env.SGVUE_MAX_GPU_MB || 2500)
const MAX_TOTAL_MB = Number(process.env.SGVUE_MAX_TOTAL_MB || 9000)
const MAX_SECONDS = Number(process.env.SGVUE_MAX_SECONDS || 600)
const POLL_MS = WIN ? 1500 : 500
/** win32: `Get-Counter` costs ~1.2 s, so the GPU reading is taken on every third poll. */
const GPU_EVERY = 3

/** macOS only: could the last listing be made at all? Set by `matching`, read by `finish`. */
let macListed = true

/**
 * `[pid, comm]` for every match, so a bundle can be read off the executable path. A `/bin/ps`
 * that failed or timed out is empty here, and `macListed` says so — `finish` never calls it clean.
 */
function matching() {
  const listed = mac.psListing()
  macListed = listed.ok
  return mac.rowsMatching(listed.procs, EXECUTABLES, process.pid)
}

/**
 * The `.app` bundle (or dev-Electron directory) an executable path belongs to: everything up to
 * and including the first `.app/`, so a helper inside `Frameworks/` resolves to its outer bundle.
 */
function bundleOf(comm) {
  const app = comm.indexOf('.app/')
  if (app >= 0) return comm.slice(0, app + 5)
  const dev = comm.indexOf(DEV_ELECTRON)
  return dev >= 0 ? comm.slice(0, dev + DEV_ELECTRON.length) : comm
}

/**
 * win32: every SGVue/electron process under one of this checkout's roots, each carrying the
 * canonical key its root is matched on. Enumeration is by *name*; ownership is by *path*.
 *
 * `{ ok, procs }`, because an empty `procs` with `ok: false` means the listing could not be
 * made — never that the machine is clear.
 */
const winUnder = (procs) =>
  procs
    .map((p) => ({ ...p, key: win.realKey(p.exe) }))
    .filter((p) => win.isUnderRoots(p.key, WIN_ROOTS))

const winMatching = () => {
  const listed = win.listProcessesResult()
  return { ok: listed.ok, procs: winUnder(listed.procs) }
}

/**
 * What was alive before this started — the user's own packaged SGVue, almost always. Its pids
 * and its bundles are excluded from every kill and every reading for the rest of the run. (A pid
 * that dies and is reused by one of ours would be spared; that costs a kill we would have made,
 * which is the safe direction to be wrong in.)
 */
const macSnapshot = WIN ? null : mac.startupListing()
const already = WIN ? [] : mac.rowsMatching(macSnapshot.procs, EXECUTABLES, process.pid)
const PRE_EXISTING = new Set(already.map(([pid]) => pid))
const PRE_EXISTING_BUNDLES = new Set(already.map(([, comm]) => bundleOf(comm)))

/**
 * win32: the same snapshot on the same rule — pids, and the directories they came from — taken
 * **once**, and fail-closed. `start: false` means the listing could not be made even on a
 * retry; the verdict block below then refuses the run rather than mistake silence for a clear
 * machine, because an empty snapshot would both hide a dev Electron this must refuse and make
 * the user's own SGVue look like ours to kill.
 */
const winSnapshot = WIN ? win.startupListing() : null
const winAll = WIN ? winSnapshot.procs : []
const winAlready = WIN ? winUnder(winAll) : []
const WIN_PRE_PIDS = new Set(winAlready.map((p) => p.pid))
const WIN_PRE_ROOTS = new Set(winAlready.map((p) => win.bundleRootOf(p.key, WIN_ROOTS)))

/** win32: matching, not pre-existing, and not from a directory that was already running. */
const winOurs = () => {
  const matched = winMatching()
  return {
    ok: matched.ok,
    procs: matched.procs.filter(
      (p) => !WIN_PRE_PIDS.has(p.pid) && !WIN_PRE_ROOTS.has(win.bundleRootOf(p.key, WIN_ROOTS))
    )
  }
}

/** The processes this run is responsible for: matching, and from a bundle it started itself. */
const devElectronPids = () =>
  matching()
    .filter(([pid, comm]) => !PRE_EXISTING.has(pid) && !PRE_EXISTING_BUNDLES.has(bundleOf(comm)))
    .map(([pid]) => pid)

/**
 * Megabytes of `phys_footprint` for one pid, or 0 when it has gone — through the one parser the
 * in-process guard and the app use (`scripts/lib/mac-procs.cjs`), and under a timeout.
 */
const footprintMB = (pid) => mac.footprintMB(pid) ?? 0

/** Pressure level: 1 normal, 2 warn, 4 critical. Anything above 1 means the machine is hurting. */
const pressureLevel = () => mac.pressureLevel() ?? 1

function killAll(reason) {
  const pids = devElectronPids()
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
  }
  if (pids.length) console.log(`[safe-e2e] KILLED ${pids.length} Electron process(es) — ${reason}`)
  return pids
}

/** win32: the same, through `taskkill /T /F`, so each helper tree goes with its parent. */
function winKillAll(reason) {
  const found = winOurs().procs
  for (const p of found) win.taskkill(p.pid)
  if (found.length) {
    console.log(`[safe-e2e] KILLED ${found.length} Electron process(es) — ${reason}`)
    for (const p of found) console.log(`[safe-e2e]   ${p.pid}  ${p.exe}`)
  }
  return found
}

/**
 * macOS: fail-closed, as on Windows. A `/bin/ps` that could not run even on a retry leaves the
 * snapshot empty, which would both hide a dev Electron this must refuse and make the user's own
 * SGVue look like ours to kill.
 */
if (!WIN && !macSnapshot.ok) {
  console.error(
    `[safe-e2e] REFUSED: could not list running processes (/bin/ps failed or timed out), so what ` +
      `was already running cannot be told apart from what this run starts. Nothing was started.  ` +
      `Check by hand:  ${mac.CHECK_BY_HAND}`
  )
  process.exit(69)
}
const devAlready = already.filter(([, comm]) => comm.includes(DEV_ELECTRON))
if (devAlready.length) {
  console.error(
    `[safe-e2e] REFUSED: ${devAlready.length} dev Electron process(es) already running ` +
      `(${devAlready.map(([pid]) => pid).join(', ')}). Kill them first:  ` +
      `kill -9 ${devAlready.map(([pid]) => pid).join(' ')}`
  )
  process.exit(69)
}
if (already.length) {
  console.log(
    `[safe-e2e] ${already.length} SGVue process(es) were already running ` +
      `(${already.map(([pid]) => pid).join(', ')}) — not this run's, so they and anything else from ` +
      `${[...PRE_EXISTING_BUNDLES].join(', ')} are left alone and not measured`
  )
}

/** win32: the same two verdicts — a dev Electron of this checkout refuses, everything else is left alone. */
if (WIN) {
  if (!winSnapshot.start) {
    console.error(
      `[safe-e2e] REFUSED: could not list running processes (PowerShell timed out or did not run), ` +
        `so what was already running cannot be told apart from what this run starts. Nothing was ` +
        `started.  Check by hand:  ${win.CHECK_BY_HAND}`
    )
    process.exit(69)
  }
  const devRunning = winAlready.filter((p) => p.key.startsWith(WIN_ROOTS[0]))
  if (devRunning.length) {
    console.error(
      `[safe-e2e] REFUSED: ${devRunning.length} dev Electron process(es) already running ` +
        `(${devRunning.map((p) => p.pid).join(', ')}). Kill them first:  ` +
        `taskkill /PID ${devRunning.map((p) => p.pid).join(' /PID ')} /T /F`
    )
    process.exit(69)
  }
  if (winAll.length) {
    console.log(
      `[safe-e2e] ${winAll.length} SGVue/electron process(es) were already running ` +
        `(${winAll.map((p) => p.pid).join(', ')}) — not this run's, so they` +
        (winAlready.length ? ` and anything else from ${[...WIN_PRE_ROOTS].join(', ')}` : '') +
        ' are left alone and not measured'
    )
  }
}

if (!existsSync(join(ROOT, 'out/main/index.js'))) {
  console.error('[safe-e2e] out/main/index.js is missing — run `npm run build` first')
  process.exit(66)
}
if (!existsSync(join(ROOT, 'tests/fixtures/tiny.ifc'))) {
  console.error('[safe-e2e] tests/fixtures/tiny.ifc is missing — run `python3 scripts/make-tiny-ifc.py`')
  process.exit(66)
}

const started = Date.now()
let peak = 0
let tripped = null
/** win32 only: the sum and the GPU reading have peaks of their own, and `null` gpu means n/a. */
let winPeakTotal = 0
let winPeakGpu = null
let winTicks = 0
let winSaidNa = false
/** win32 only: said once, when a poll could not list at all and measured nothing that tick. */
let winSaidListFail = false

if (WIN) {
  console.log(
    `[safe-e2e] armed on working set + the GPU dedicated-memory counter (no phys_footprint and ` +
      `no memory-pressure signal on Windows): one process ≤ ${MAX_ONE_MB} MB, all ≤ ` +
      `${MAX_TOTAL_MB} MB, gpu ≤ ${MAX_ONE_MB} MB, ≤ ${MAX_SECONDS} s, every ${POLL_MS} ms`
  )
}

// win32 cannot execute `node_modules/.bin/playwright` — it is an extension-less POSIX shim —
// so the CLI's own entry point is run with this Node.
const child = WIN
  ? spawn(
      process.execPath,
      [
        join(ROOT, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        'playwright.config.ts',
        ...process.argv.slice(2)
      ],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SGVUE_GUARDED: '1' }, windowsHide: true }
    )
  : spawn(
      join(ROOT, 'node_modules/.bin/playwright'),
      ['test', '--config', 'playwright.config.ts', ...process.argv.slice(2)],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SGVUE_GUARDED: '1' } }
    )

/** win32: working set per process and summed, the GPU counter every third tick, no pressure. */
function winMeasure() {
  const listed = winOurs()
  if (!listed.ok) {
    // The listing could not be made: *unknown*, not *none*. Skip this tick's measurement rather
    // than record a reassuring zero. The wall clock is checked by the caller either way.
    if (!winSaidListFail) {
      winSaidListFail = true
      console.log('[safe-e2e] could not list processes — skipping that measurement; the clock still runs')
    }
    return
  }
  const mine = listed.procs
  let total = 0
  for (const p of mine) {
    total += p.workingSetMB
    if (p.workingSetMB > peak) peak = p.workingSetMB
    if (p.workingSetMB > MAX_ONE_MB) {
      tripped = `process ${p.pid} working set ${Math.round(p.workingSetMB)} MB > ${MAX_ONE_MB} MB`
    }
  }
  if (total > winPeakTotal) winPeakTotal = total
  if (total > MAX_TOTAL_MB) tripped = `${mine.length} processes at ${Math.round(total)} MB > ${MAX_TOTAL_MB} MB`
  if (mine.length && winTicks % GPU_EVERY === 1) {
    const gpu = win.gpuDedicatedMB(mine.map((p) => p.pid))
    if (gpu === null) {
      if (!winSaidNa) {
        winSaidNa = true
        console.log('[safe-e2e] gpu=n/a — the GPU Process Memory counter is unavailable here')
      }
    } else {
      if (winPeakGpu === null || gpu > winPeakGpu) winPeakGpu = gpu
      if (gpu > MAX_ONE_MB) tripped = `gpu dedicated ${Math.round(gpu)} MB > ${MAX_ONE_MB} MB`
    }
  }
}

/**
 * win32: one poll. Every measurement is a `spawnSync` that blocks this process, so the wall
 * clock is read **before** the measuring as well as after it, and the measuring is wrapped: a
 * PowerShell call that hangs or throws must not be able to starve `SGVUE_MAX_SECONDS` — the one
 * backstop this guard exists for — and an exception escaping an interval callback would kill
 * the guard and orphan the run.
 */
function winTick() {
  winTicks += 1
  const elapsed = () => (Date.now() - started) / 1000 > MAX_SECONDS
  if (elapsed()) tripped = `over ${MAX_SECONDS} s`
  if (!tripped) {
    try {
      winMeasure()
    } catch (err) {
      if (!winSaidListFail) {
        winSaidListFail = true
        const why = (err && err.message) || err
        console.log(`[safe-e2e] could not measure this tick (${why}); the clock still runs`)
      }
    }
    if (elapsed()) tripped = `over ${MAX_SECONDS} s`
  }
  if (tripped) {
    clearInterval(poll)
    console.error(`[safe-e2e] GUARD TRIPPED — ${tripped}`)
    winKillAll('guard tripped')
    if (child.pid) win.taskkill(child.pid)
  }
}

const poll = setInterval(() => {
  if (WIN) return winTick()
  const pids = devElectronPids()
  let total = 0
  for (const pid of pids) {
    const mb = footprintMB(pid)
    total += mb
    if (mb > peak) peak = mb
    if (mb > MAX_ONE_MB) tripped = `process ${pid} at ${Math.round(mb)} MB > ${MAX_ONE_MB} MB`
  }
  if (total > MAX_TOTAL_MB) tripped = `${pids.length} processes at ${Math.round(total)} MB > ${MAX_TOTAL_MB} MB`
  const pressure = pressureLevel()
  if (pressure >= 2) tripped = `memory pressure level ${pressure}`
  if ((Date.now() - started) / 1000 > MAX_SECONDS) tripped = `over ${MAX_SECONDS} s`
  if (tripped) {
    clearInterval(poll)
    console.error(`[safe-e2e] GUARD TRIPPED — ${tripped}`)
    killAll('guard tripped')
    child.kill('SIGKILL')
  }
}, POLL_MS)

/** win32: the same report in the numbers Windows actually has, then the survivor sweep. */
function winFinish(code, signal) {
  // A packaged app's helpers outlive `app.close()` by a few hundred milliseconds, so give
  // anything of ours a bounded moment to leave before it is called a survivor.
  let listed = winOurs()
  const deadline = Date.now() + 5000
  while (listed.procs.length && Date.now() < deadline) {
    win.sleepSync(700)
    listed = winOurs()
  }
  const survivors = listed.procs
  console.log(
    `[safe-e2e] peak working set: one process ${Math.round(peak)} MB (limit ${MAX_ONE_MB} MB), ` +
      `all ${Math.round(winPeakTotal)} MB (limit ${MAX_TOTAL_MB} MB) · peak gpu dedicated ` +
      `${winPeakGpu === null ? 'n/a' : `${Math.round(winPeakGpu)} MB`}`
  )
  for (const p of survivors) win.taskkill(p.pid)
  if (survivors.length) {
    console.log(`[safe-e2e] KILLED ${survivors.length} Electron process(es) — survivor after the run`)
    for (const p of survivors) console.log(`[safe-e2e]   ${p.pid}  ${p.exe}`)
  } else if (!listed.ok) {
    // An empty list from a listing that never happened is not an all-clear, and must not be
    // printed as one. The exit code is unchanged; what changes is that the claim is not made.
    console.log(
      `[safe-e2e] COULD NOT LIST processes (PowerShell timed out or did not run) — check by hand:  ${win.CHECK_BY_HAND}`
    )
  } else {
    console.log('[safe-e2e] clean: no process this run started survived it')
  }
  if (signal) console.log(`[safe-e2e] child ended on signal ${signal}`)
  process.exit(tripped ? 2 : signal ? 1 : (code ?? 0))
}

const finish = (code, signal) => {
  clearInterval(poll)
  if (WIN) return winFinish(code, signal)
  console.log(`[safe-e2e] peak single-process footprint ${Math.round(peak)} MB (limit ${MAX_ONE_MB} MB)`)
  const survivors = killAll('survivor after the run')
  if (!survivors.length && !macListed) {
    // An empty list from a listing that never happened is not an all-clear. Exit code unchanged.
    console.log(`[safe-e2e] COULD NOT LIST processes (/bin/ps failed or timed out) — check by hand:  ${mac.CHECK_BY_HAND}`)
  } else if (!survivors.length) console.log('[safe-e2e] clean: no process this run started survived it')
  if (signal) console.log(`[safe-e2e] child ended on signal ${signal}`)
  process.exit(tripped ? 2 : signal ? 1 : (code ?? 0))
}

child.on('exit', finish)
child.on('error', (err) => {
  console.error(`[safe-e2e] failed to start playwright: ${err.message}`)
  finish(70, null)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (WIN && child.pid) win.taskkill(child.pid)
    child.kill('SIGKILL')
    finish(1, null)
  })
}
