/**
 * The last line of defence against a runaway GPU process.
 *
 * On 2026-09-17 this machine kernel-panicked **three times** while the dev app rendered a real
 * model (`watchdog timeout: no checkins from watchdogd`, compressor at 100 %). Every panic
 * report names the Electron **GPU helper process at ~168–170 GB**, with the renderer at
 * ~1.4 GB. The third happened on the WebGL2 backend, so it is not a backend problem: three
 * 0.186 issues one driver-level draw per visible `BatchedMesh` instance on both ANGLE/Metal
 * and Dawn, and ~67 000 instances a frame flood the GPU process by gigabytes per second.
 * `src/renderer/viewer/batches.ts` no longer draws per instance — but a default is a choice,
 * and a choice can be changed by a preference, a driver or a future backend. This watches the
 * actual number.
 *
 * ## The metric — and why the obvious ones are blind
 *
 * `app.getAppMetrics()` reports `memory.workingSetSize`, and `ps` reports RSS. **Neither sees
 * this memory.** Measured at the instant a run's GPU process went from 634 MB to 5 461 MB,
 * `getAppMetrics` still said 106 MB: IOAccelerator / Metal allocations are charged to the
 * process's *physical footprint* ledger, not to its working set. So on macOS this reads
 * `phys_footprint` from `/usr/bin/footprint -p <pid>` — the number the panic report itself
 * uses — and `kern.memorystatus_vm_pressure_level` (1 normal, 2 warning, 4 critical). On every
 * other platform it falls back to `getAppMetrics`, which is accurate there.
 *
 * It is deliberately small and deliberately blunt:
 *
 * 1. Read the GPU helper's footprint every second, without blocking the main thread.
 * 2. Over the limit (or the system already under memory pressure): tell the renderer once,
 *    over `gpu:guard-tripped`. The renderer stops its frame loop and disposes the viewer,
 *    which is what actually releases the pressure.
 * 3. Still over it `GPU_GRACE_MS` later: `webContents.forcefullyCrashRenderer()`. A blank
 *    window the user can reload is a far better outcome than a kernel panic.
 *
 * ## The limit — a floor, not a constant
 *
 * `max(3 072 MB, 40 % of os.totalmem())`, decided once at startup by `gpuLimitMB()`.
 *
 * A flat 3 072 MB was too tight to ship. The packaged app peaked at **2 242–2 353 MB** of GPU
 * `phys_footprint` on the 137.9 MB reference model (`PROGRESS.md`, `docs/SYSTEM_SPEC.md` §3),
 * and 50–200 MB files are the stated design target — so a *legitimate* model would have
 * tripped the guard and had its viewer stopped and then crashed, which is the one failure this
 * module must not cause.
 *
 * The two terms answer two different machines. A legitimate peak scales with the file, and the
 * files a machine is asked to open scale with the machine: 24 GB here gives 9 830 MB, where a
 * 200 MB federation has room; an 8 GB machine stays near the floor, where a 3 GB GPU footprint
 * genuinely is trouble. Raising the ceiling costs nothing against the case the guard exists
 * for, because a runaway does not creep up on it — it climbs by **gigabytes per second**
 * (measured: 634 → 5 461 MB inside one 0.5 s poll), so it is caught within a poll or two at
 * any of these limits.
 *
 * This is the *shipped* guard. The dev-script guard (`scripts/lib/electron-guard.cjs`) keeps
 * its tighter fixed defaults: a bounded run may fail loudly, a user's session may not.
 *
 * This module writes nothing to disk — it only reads two system counters — and holds no state
 * outside the watcher it returns.
 */
import { execFile } from 'node:child_process'
import { totalmem } from 'node:os'
import { app, type WebContents } from 'electron'
import { GPU_GUARD_CHANNEL, type GpuGuardTrip } from '../shared/gpu-guard-channel'

export { GPU_GUARD_CHANNEL }
export type { GpuGuardTrip }

/** The lowest the ceiling ever goes, in megabytes — a small machine's whole budget. */
export const GPU_FLOOR_MB = 3072
/** The share of installed RAM a big machine is allowed to hand the GPU helper. */
export const GPU_RAM_SHARE = 0.4

/**
 * The ceiling on the GPU helper process, in megabytes, from the installed RAM in bytes.
 * Pure, so the arithmetic is testable without an OS reading; see the header for why it is a
 * floor rather than a constant. A machine that reports nothing usable gets the floor.
 */
export function gpuLimitMB(totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return GPU_FLOOR_MB
  return Math.max(GPU_FLOOR_MB, Math.round((totalBytes * GPU_RAM_SHARE) / 1048576))
}

/** The ceiling this machine gets, decided once at startup. */
export const GPU_LIMIT_MB = gpuLimitMB(totalmem())
/** How often the reading is taken. */
export const GPU_POLL_MS = 1000
/** How long the renderer is given to come back under the limit before it is crashed. */
export const GPU_GRACE_MS = 3000
/** `kern.memorystatus_vm_pressure_level`: 2 is "warning", i.e. the compressor is working. */
export const GPU_PRESSURE_LIMIT = 2

/**
 * `none` — under the limit; `warn` — first over it; `wait` — still over it, inside the grace
 * period; `crash` — still over it once the grace period has passed.
 */
export type GpuGuardAction = 'none' | 'warn' | 'wait' | 'crash'

/**
 * The whole decision, as a pure function of the reading and how long ago we warned.
 * `warnedAt` is `null` while nothing has been sent. Unit-tested in
 * `tests/unit/gpu-guard.test.ts`; the polling around it is a dozen lines.
 */
export function gpuGuardAction(
  gpuMB: number,
  limitMB: number,
  warnedAt: number | null,
  now: number,
  graceMs: number = GPU_GRACE_MS,
  pressure: number = 0
): GpuGuardAction {
  const over = gpuMB > limitMB || pressure >= GPU_PRESSURE_LIMIT
  if (!over) return 'none'
  if (warnedAt === null) return 'warn'
  return now - warnedAt >= graceMs ? 'crash' : 'wait'
}

/**
 * One poll: the action, and the `warnedAt` the next poll starts from. The warning is forgotten
 * **only** when the reading is back under the limit — forgetting it while still over (the
 * 2026-09-24 defect: `wait` and `none` were one value) re-warned every poll and never crashed.
 */
export function gpuGuardStep(
  gpuMB: number,
  limitMB: number,
  warnedAt: number | null,
  now: number,
  pressure: number = 0
): { action: GpuGuardAction; warnedAt: number | null } {
  const action = gpuGuardAction(gpuMB, limitMB, warnedAt, now, GPU_GRACE_MS, pressure)
  return { action, warnedAt: action === 'warn' ? now : action === 'none' ? null : warnedAt }
}

/** `workingSetSize` is in kilobytes. The non-macOS reading, and the macOS fallback. */
export function gpuProcessMB(
  metrics: readonly { type: string; memory?: { workingSetSize?: number } }[]
): number {
  let kb = 0
  for (const m of metrics) if (m.type === 'GPU') kb += m.memory?.workingSetSize ?? 0
  return Math.round(kb / 1024)
}

/**
 * Pull `phys_footprint:` out of `footprint(1)`'s auxiliary data and return megabytes, or
 * `null` when the line is absent. Pure, and the same parser
 * `scripts/lib/electron-guard.cjs` uses — the two guards must agree on the number.
 */
export function parseFootprintMB(text: string): number | null {
  const m = /phys_footprint:\s*([\d.,]+)\s*([KMGB]+)/i.exec(text)
  if (!m) return null
  const value = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  switch (m[2].toUpperCase()) {
    case 'GB':
      return value * 1024
    case 'MB':
      return value
    case 'KB':
      return value / 1024
    case 'B':
      return value / 1048576
    default:
      return null
  }
}

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 4000 }, (error, stdout) => resolve(error ? '' : stdout))
  })

/** The GPU helper's pid, or 0 when there is none yet. */
function gpuPid(): number {
  try {
    for (const m of app.getAppMetrics()) if (m.type === 'GPU') return m.pid
  } catch {
    /* metrics unavailable */
  }
  return 0
}

interface GpuGuard {
  stop(): void
}

export function watchGpu(contents: WebContents, limitMB: number = GPU_LIMIT_MB): GpuGuard {
  let warnedAt: number | null = null
  let stopped = false
  let busy = false

  const read = async (): Promise<{ gpuMB: number; pressure: number }> => {
    if (process.platform !== 'darwin') {
      return { gpuMB: gpuProcessMB(app.getAppMetrics()), pressure: 0 }
    }
    const pid = gpuPid()
    const [foot, level] = await Promise.all([
      pid ? run('/usr/bin/footprint', ['-p', String(pid)]) : Promise.resolve(''),
      run('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])
    ])
    const mb = parseFootprintMB(foot)
    return {
      // A failed reading falls back to the blind number rather than to zero: it under-reports,
      // but it never silently disarms the guard.
      gpuMB: Math.round(mb ?? gpuProcessMB(app.getAppMetrics())),
      pressure: Number(level.trim()) || 0
    }
  }

  const timer = setInterval(() => {
    if (stopped || busy || contents.isDestroyed()) return
    busy = true
    void read()
      .then(({ gpuMB, pressure }) => {
        if (stopped || contents.isDestroyed()) return
        const now = Date.now()
        const step = gpuGuardStep(gpuMB, limitMB, warnedAt, now, pressure)
        warnedAt = step.warnedAt
        switch (step.action) {
          case 'warn':
            console.error(
              `[gpu-guard] GPU process ${gpuMB} MB (limit ${limitMB} MB, pressure ${pressure}) — stopping the viewer`
            )
            contents.send(GPU_GUARD_CHANNEL, { gpuMB, limitMB } satisfies GpuGuardTrip)
            break
          case 'crash':
            console.error(`[gpu-guard] still ${gpuMB} MB after the grace period — crashing the renderer`)
            stopped = true
            clearInterval(timer)
            contents.forcefullyCrashRenderer()
            break
          // `wait`: still over, inside the grace period. `none`: back under, and the step has
          // already forgotten the warning, so a later spike warns again.
        }
      })
      .finally(() => {
        busy = false
      })
  }, GPU_POLL_MS)

  contents.once('destroyed', () => {
    stopped = true
    clearInterval(timer)
  })
  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    }
  }
}
