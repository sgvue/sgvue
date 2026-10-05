/**
 * Dev utility — NOT application code. A memory and wall-clock guard for every script in
 * `scripts/` that starts an Electron window.
 *
 * ## Why this exists
 *
 * On 2026-09-17 this Mac kernel-panicked **three times** (`watchdog timeout: no checkins from
 * watchdogd`, memory compressor at 100 %). Every panic report
 * (`/Library/Logs/DiagnosticReports/…/panic-full-2026-09-17-*.panic`, field `processByPid`)
 * names the dev Electron **GPU helper process at ~168–170 GB**. The third one happened on the
 * WebGL2 backend, *after* a first safety attempt — so this is not a WebGPU problem and not a
 * slow leak.
 *
 * ## The metric — and why the obvious ones are blind
 *
 * `app.getAppMetrics()` reports `memory.workingSetSize` (kilobytes; `privateBytes` is
 * Windows-only in Electron 44 and reads 0 on macOS). `ps -o rss` reports the resident set.
 * **Neither sees this memory.** Measured at the moment the reviewer's external watchdog killed
 * a run whose GPU process had gone from 634 MB to 5 461 MB inside one 0.5 s poll, the old
 * guard's own reading was `gpu=106 MB`. IOAccelerator / Metal allocations are charged to the
 * process's *physical footprint* ledger, not to its working set.
 *
 * So this guard reads **`phys_footprint`** out of `/usr/bin/footprint -p <pid>`, which is the
 * same number `memory_pressure` and the panic report's `processByPid` use, plus
 * `kern.memorystatus_vm_pressure_level` — 1 normal, 2 warning, 4 critical. Level ≥ 2 means the
 * compressor is already working, which is the state that precedes a watchdog timeout.
 *
 * A `footprint` call costs ~25 ms, so a 250 ms poll over the GPU process and the renderer
 * spends about a fifth of the main process's time watching. That is the correct trade for a
 * dev script whose main process otherwise does nothing.
 *
 * ## Why `app.exit`, not `app.quit`
 *
 * `app.quit()` runs the close handshake and waits on the renderer — and a renderer that is
 * saturating the GPU process is exactly the one that will not answer. `app.exit(code)` ends
 * the process group immediately, which is the whole point of a guard.
 *
 *   const guard = require('./lib/electron-guard.cjs').installGuard({ label: 'bench' })
 *   …
 *   guard.sample('after load')      // one labelled reading
 *   guard.stop()                    // before a clean app.exit(0)
 *
 * Every limit may be lowered by the caller or by the environment (`SGVUE_MAX_GPU_MB`,
 * `SGVUE_MAX_RENDERER_MB`, `SGVUE_MAX_SECONDS`); none of them is a suggestion.
 */
const { app } = require('electron')
const { execFileSync } = require('node:child_process')
// One `footprint(1)` parser for every guard; `tests/unit/gpu-guard.test.ts` holds it equal to the app's.
const { parseFootprintMB } = require('./mac-procs.cjs')

/** Defaults. Deliberately tight: a run that needs more must say so in its own limits. */
const DEFAULTS = {
  maxGpuMB: 2500,
  maxRendererMB: 6000,
  /** `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical. */
  maxPressure: 1,
  maxSeconds: 25,
  pollMs: 250,
  logEveryMs: 1000,
  label: 'run'
}

const IS_MAC = process.platform === 'darwin'

/** `phys_footprint` of one pid in MB, or `null` when the process is gone or not macOS. */
function footprintMB(pid) {
  if (!IS_MAC || !pid) return null
  try {
    return parseFootprintMB(
      execFileSync('/usr/bin/footprint', ['-p', String(pid)], {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    )
  } catch {
    return null
  }
}

/** 1 normal · 2 warning · 4 critical. `0` when it cannot be read. */
function pressureLevel() {
  if (!IS_MAC) return 0
  try {
    return (
      Number(
        execFileSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {
          encoding: 'utf8',
          timeout: 2000,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
      ) || 0
    )
  } catch {
    return 0
  }
}

/** `workingSetSize` is in KB. The non-macOS fallback, and the "blind" number for comparison. */
const mb = (kb) => Math.round((kb || 0) / 1024)

/**
 * One reading of every process Electron owns. On macOS `gpuMB` / `rendererMB` are
 * `phys_footprint`; `gpuBlindMB` is what `getAppMetrics` claims, kept in the log because the
 * gap between the two is the whole reason this file was rewritten.
 */
function readMetrics() {
  let metrics = []
  try {
    metrics = app.getAppMetrics()
  } catch {
    return { gpuMB: 0, rendererMB: 0, gpuBlindMB: 0, pressure: 0, gpuPid: 0, n: 0 }
  }
  let gpuPid = 0
  let gpuBlindMB = 0
  let gpuMB = 0
  let rendererMB = 0
  for (const m of metrics) {
    const blind = mb(m.memory && (m.memory.privateBytes || m.memory.workingSetSize))
    if (m.type === 'GPU') {
      gpuPid = m.pid
      gpuBlindMB += blind
      gpuMB += footprintMB(m.pid) ?? blind
    } else if (m.type === 'Tab') {
      rendererMB = Math.max(rendererMB, footprintMB(m.pid) ?? blind)
    }
  }
  return {
    gpuMB: Math.round(gpuMB),
    rendererMB: Math.round(rendererMB),
    gpuBlindMB,
    pressure: pressureLevel(),
    gpuPid,
    n: metrics.length
  }
}

/**
 * The pure part: given a reading and the limits, what (if anything) has been breached. Kept
 * separate so `tests/unit/gpu-guard.test.ts` can check the same thresholds without Electron.
 */
function breachOf(reading, elapsedSeconds, limits) {
  if (reading.gpuMB > limits.maxGpuMB) {
    return `GPU process ${reading.gpuMB} MB > ${limits.maxGpuMB} MB (phys_footprint)`
  }
  if (reading.rendererMB > limits.maxRendererMB) {
    return `renderer ${reading.rendererMB} MB > ${limits.maxRendererMB} MB (phys_footprint)`
  }
  if (reading.pressure > limits.maxPressure) {
    return `system memory pressure level ${reading.pressure} > ${limits.maxPressure}`
  }
  if (elapsedSeconds > limits.maxSeconds) {
    return `elapsed ${elapsedSeconds.toFixed(0)} s > ${limits.maxSeconds} s`
  }
  return null
}

const envNumber = (name, fallback) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function installGuard(options = {}) {
  const limits = { ...DEFAULTS, ...options }
  limits.maxGpuMB = envNumber('SGVUE_MAX_GPU_MB', limits.maxGpuMB)
  limits.maxRendererMB = envNumber('SGVUE_MAX_RENDERER_MB', limits.maxRendererMB)
  limits.maxSeconds = envNumber('SGVUE_MAX_SECONDS', limits.maxSeconds)

  const t0 = Date.now()
  const since = () => (Date.now() - t0) / 1000
  const line = (reading, tag) =>
    `[guard] gpu=${reading.gpuMB}MB renderer=${reading.rendererMB}MB` +
    ` pressure=${reading.pressure} blind=${reading.gpuBlindMB}MB t=${since().toFixed(1)}s` +
    (tag ? `  ${tag}` : '')

  let timer = null
  let lastLog = -1
  let peakGpu = 0
  let peakRenderer = 0

  const die = (why, code) => {
    console.log(`[guard] TRIPPED: ${why}  (${limits.label}, peak gpu ${peakGpu} MB)`)
    if (timer) clearInterval(timer)
    timer = null
    app.exit(code)
  }

  const poll = () => {
    const reading = readMetrics()
    if (reading.gpuMB > peakGpu) peakGpu = reading.gpuMB
    if (reading.rendererMB > peakRenderer) peakRenderer = reading.rendererMB
    const elapsed = since()
    if (elapsed * 1000 - lastLog >= limits.logEveryMs) {
      lastLog = elapsed * 1000
      console.log(line(reading))
    }
    const breach = breachOf(reading, elapsed, limits)
    if (breach) {
      console.log(line(reading, '<<< at trip'))
      die(breach, 2)
    }
  }

  // A script error must never leave a window rendering forever.
  process.on('uncaughtException', (err) => {
    console.log(`[guard] uncaughtException: ${(err && err.stack) || err}`)
    die('uncaught exception', 1)
  })
  process.on('unhandledRejection', (err) => {
    console.log(`[guard] unhandledRejection: ${(err && err.stack) || err}`)
    die('unhandled rejection', 1)
  })

  console.log(
    `[guard] armed for "${limits.label}" on ${IS_MAC ? 'phys_footprint' : 'getAppMetrics'}: ` +
      `gpu ≤ ${limits.maxGpuMB} MB, renderer ≤ ${limits.maxRendererMB} MB, ` +
      `pressure ≤ ${limits.maxPressure}, ≤ ${limits.maxSeconds} s, every ${limits.pollMs} ms`
  )
  timer = setInterval(poll, limits.pollMs)
  // Node keeps the process alive for a pending interval; the guard must not be the reason a
  // script that has finished its work hangs around.
  if (timer.unref) timer.unref()

  return {
    limits,
    /** One labelled reading, logged and returned — the readouts the Build Report quotes. */
    sample(tag) {
      const reading = readMetrics()
      if (reading.gpuMB > peakGpu) peakGpu = reading.gpuMB
      if (reading.rendererMB > peakRenderer) peakRenderer = reading.rendererMB
      console.log(line(reading, tag ? `— ${tag}` : ''))
      return { ...reading, seconds: +since().toFixed(1) }
    },
    get peakGpuMB() {
      return peakGpu
    },
    get peakRendererMB() {
      return peakRenderer
    },
    get secondsLeft() {
      return Math.max(0, limits.maxSeconds - since())
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}

module.exports = {
  installGuard,
  breachOf,
  readMetrics,
  footprintMB,
  parseFootprintMB,
  pressureLevel,
  DEFAULTS
}
