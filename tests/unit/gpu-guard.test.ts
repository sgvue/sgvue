/**
 * The in-app GPU guard's decision table and its metric (`src/main/gpu-guard.ts`).
 *
 * The polling around it is a dozen lines; the thresholds and the parser are what must not
 * drift, because they are the app's answer to the three kernel panics of 2026-09-17 — and to
 * the discovery that `workingSetSize` cannot see the memory that caused them.
 */
import { describe, expect, it, vi } from 'vitest'

// `gpu-guard.ts` imports `app` from electron for its polling half. The pure half under test
// touches none of it, so a stub is enough to let the module load under Node.
vi.mock('electron', () => ({ app: { getAppMetrics: () => [] } }))

const {
  GPU_FLOOR_MB,
  GPU_GRACE_MS,
  GPU_LIMIT_MB,
  GPU_PRESSURE_LIMIT,
  GPU_RAM_SHARE,
  GPU_POLL_MS,
  gpuGuardAction,
  gpuGuardStep,
  gpuLimitMB,
  gpuProcessMB,
  parseFootprintMB
} = await import('../../src/main/gpu-guard')

// The dev-script guard must read the same number the app's guard does, or a bounded run and a
// live session disagree about what is safe.
const scriptGuard = await import('../../scripts/lib/electron-guard.cjs')

describe('parseFootprintMB', () => {
  it('reads the phys_footprint line footprint(1) actually prints', () => {
    const real = [
      '======================================================================',
      'Electron Helper (GPU) [4390]: 64-bit    Footprint: 555 MB (16384 bytes per page)',
      '======================================================================',
      '',
      'Auxiliary data:',
      '    phys_footprint: 1440 KB'
    ].join('\n')
    expect(parseFootprintMB(real)).toBeCloseTo(1440 / 1024, 6)
  })

  it('handles every unit footprint(1) uses', () => {
    expect(parseFootprintMB('phys_footprint: 5461 MB')).toBe(5461)
    expect(parseFootprintMB('phys_footprint: 1.66 GB')).toBeCloseTo(1699.84, 2)
    expect(parseFootprintMB('phys_footprint: 1,048,576 KB')).toBe(1024)
    expect(parseFootprintMB('phys_footprint: 524288 B')).toBe(0.5)
  })

  it('returns null rather than 0 when the line is missing, so a failure cannot disarm', () => {
    expect(parseFootprintMB('')).toBeNull()
    expect(parseFootprintMB('Footprint: 555 MB')).toBeNull()
  })

  it('agrees with the dev-script guard, character for character', () => {
    const text = 'Auxiliary data:\n    phys_footprint: 170123 MB'
    expect(scriptGuard.parseFootprintMB(text)).toBe(parseFootprintMB(text))
    expect(parseFootprintMB(text)).toBe(170_123)
  })
})

describe('gpuProcessMB', () => {
  it('sums the GPU processes and converts kilobytes to megabytes', () => {
    expect(
      gpuProcessMB([
        { type: 'Browser', memory: { workingSetSize: 200_000 } },
        { type: 'Tab', memory: { workingSetSize: 1_400_000 } },
        { type: 'GPU', memory: { workingSetSize: 2_097_152 } }
      ])
    ).toBe(2048)
  })

  it('reads 0 when there is no GPU process and when the field is missing', () => {
    expect(gpuProcessMB([{ type: 'Tab', memory: { workingSetSize: 1024 } }])).toBe(0)
    expect(gpuProcessMB([{ type: 'GPU' }])).toBe(0)
  })

  it('would have caught the panic: 168 GB reads as 172 032 MB, far over the limit', () => {
    const panic = gpuProcessMB([{ type: 'GPU', memory: { workingSetSize: 168 * 1024 * 1024 } }])
    expect(panic).toBe(168 * 1024)
    expect(gpuGuardAction(panic, GPU_LIMIT_MB, null, 0)).toBe('warn')
  })
})

describe('gpuGuardAction', () => {
  it('does nothing at or below the limit', () => {
    expect(gpuGuardAction(0, 3072, null, 0)).toBe('none')
    expect(gpuGuardAction(3072, 3072, null, 0)).toBe('none')
  })

  it('warns once when the limit is first exceeded', () => {
    expect(gpuGuardAction(3073, 3072, null, 1000)).toBe('warn')
  })

  it('waits inside the grace period — which is not the same answer as being under', () => {
    expect(gpuGuardAction(9000, 3072, 1000, 1000 + GPU_GRACE_MS - 1)).toBe('wait')
  })

  it('crashes the renderer once the grace period has passed and it is still over', () => {
    expect(gpuGuardAction(9000, 3072, 1000, 1000 + GPU_GRACE_MS)).toBe('crash')
  })

  it('never crashes an already-recovered renderer, whatever the warning history', () => {
    expect(gpuGuardAction(100, 3072, 1000, 1_000_000)).toBe('none')
  })

  it('also trips on system memory pressure, whatever the GPU process reports', () => {
    expect(gpuGuardAction(10, 3072, null, 0, GPU_GRACE_MS, GPU_PRESSURE_LIMIT)).toBe('warn')
    expect(gpuGuardAction(10, 3072, null, 0, GPU_GRACE_MS, GPU_PRESSURE_LIMIT - 1)).toBe('none')
  })
})

describe('gpuGuardStep — consecutive polls (the 2026-09-24 escalation defect)', () => {
  // Every poll feeds the next the `warnedAt` the last one returned, exactly as `watchGpu` does.
  const polls = (readings: number[], limitMB = 3072): string[] => {
    let warnedAt: number | null = null
    return readings.map((mb, i) => {
      const step = gpuGuardStep(mb, limitMB, warnedAt, i * GPU_POLL_MS)
      warnedAt = step.warnedAt
      return step.action
    })
  }

  it('escalates: over → warn → still over past the grace period → crash', () => {
    const over = Array.from({ length: GPU_GRACE_MS / GPU_POLL_MS + 1 }, () => 9000)
    const actions = polls(over)
    expect(actions[0]).toBe('warn')
    expect(actions.slice(1, -1).every((a) => a === 'wait')).toBe(true)
    expect(actions.at(-1)).toBe('crash')
    // Before the fix every poll after the first re-warned and none ever crashed.
    expect(actions.filter((a) => a === 'warn')).toHaveLength(1)
  })

  it('forgets the warning only once back under, so a later spike warns afresh', () => {
    expect(polls([9000, 9000, 100, 9000, 9000])).toEqual(['warn', 'wait', 'none', 'warn', 'wait'])
  })

  it('keeps the first warning time while waiting, so the grace period is not restarted', () => {
    const first = gpuGuardStep(9000, 3072, null, 5000)
    const second = gpuGuardStep(9000, 3072, first.warnedAt, 6000)
    expect([first.warnedAt, second.action, second.warnedAt]).toEqual([5000, 'wait', 5000])
  })
})

describe('gpuLimitMB', () => {
  const GB = 1024 * 1024 * 1024

  it('keeps a small machine at the floor, where a 3 GB GPU footprint genuinely is trouble', () => {
    expect(gpuLimitMB(4 * GB)).toBe(GPU_FLOOR_MB)
    expect(gpuLimitMB(8 * GB)).toBe(3277) // 40 % of 8 GB, barely above the floor
  })

  it('gives this 24 GB machine 9 830 MB — 40 % of installed RAM', () => {
    expect(gpuLimitMB(24 * GB)).toBe(9830)
    expect(gpuLimitMB(64 * GB)).toBe(Math.round((64 * GB * GPU_RAM_SHARE) / 1048576))
  })

  it('never returns less than the floor, whatever the machine reports', () => {
    for (const bytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 512 * 1024 * 1024]) {
      expect(gpuLimitMB(bytes)).toBeGreaterThanOrEqual(GPU_FLOOR_MB)
    }
    expect(GPU_LIMIT_MB).toBeGreaterThanOrEqual(GPU_FLOOR_MB)
  })

  it('leaves the reference model’s measured 2 353 MB peak alone on every machine size', () => {
    for (const gb of [4, 8, 16, 24, 64]) {
      expect(gpuGuardAction(2353, gpuLimitMB(gb * GB), null, 0)).toBe('none')
    }
  })

  it('still trips on a panic-scale reading at every machine size', () => {
    for (const gb of [4, 8, 16, 24, 64]) {
      expect(gpuGuardAction(168 * 1024, gpuLimitMB(gb * GB), null, 0)).toBe('warn')
    }
  })

  it('catches a runaway within a poll or two, because it climbs by gigabytes per second', () => {
    // 634 → 5 461 MB inside one 0.5 s poll is the climb that panicked this Mac on 2026-09-17.
    const perPoll = 5461 - 634
    const pollsToTrip = (limitMB: number): number => Math.ceil((limitMB - 634) / perPoll)
    expect(pollsToTrip(GPU_FLOOR_MB)).toBe(1)
    expect(pollsToTrip(gpuLimitMB(24 * GB))).toBe(2)
    expect(pollsToTrip(gpuLimitMB(64 * GB))).toBeLessThanOrEqual(6)
  })
})

describe('the dev-script guard thresholds', () => {
  it('is tighter than the in-app one, because a bounded run may fail loudly', () => {
    expect(scriptGuard.DEFAULTS.maxGpuMB).toBeLessThan(GPU_LIMIT_MB)
    expect(scriptGuard.DEFAULTS.maxSeconds).toBeLessThanOrEqual(25)
    expect(scriptGuard.DEFAULTS.pollMs).toBeLessThanOrEqual(250)
  })

  it('trips on the GPU footprint, the renderer footprint, the pressure level and the clock', () => {
    const limits = scriptGuard.DEFAULTS
    const flat = { gpuMB: 600, rendererMB: 900, gpuBlindMB: 106, pressure: 1 }
    expect(scriptGuard.breachOf(flat, 10, limits)).toBeNull()
    expect(scriptGuard.breachOf({ ...flat, gpuMB: 5461 }, 10, limits)).toMatch(/GPU process/)
    expect(scriptGuard.breachOf({ ...flat, rendererMB: 9000 }, 10, limits)).toMatch(/renderer/)
    expect(scriptGuard.breachOf({ ...flat, pressure: 2 }, 10, limits)).toMatch(/pressure/)
    expect(scriptGuard.breachOf(flat, 999, limits)).toMatch(/elapsed/)
  })
})
