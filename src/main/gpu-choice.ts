/**
 * Which graphics adapter SGVue draws on, on Windows — 2026-09-25, asked for by the owner:
 * *"auto set the highest graphic card if available? Nvidia as first choice."*
 *
 * No `electron` import here, so the whole decision is unit-testable; `index.ts` does the two
 * things that need Electron (read the setting, append the switch) and `menu.ts` shows the result.
 *
 * ## The mechanism
 *
 * Chromium's `--use-adapter-luid=<high>,<low>` (decimal) makes ANGLE create its Direct3D 11
 * device on the adapter with that LUID — the one device the compositor, WebGL and the viewer
 * all draw through. It must be on the command line before `ready`, because the GPU process reads
 * it once, at launch. Measured on the RTX 3070 Ti + UHD 770 desktop: the Intel LUID moves
 * `UNMASKED_RENDERER_WEBGL` to `ANGLE (Intel, …)`, the NVIDIA LUID moves it back, and the NVIDIA
 * LUID wins even over `--force_low_power_gpu`, which alone lands on Intel. A LUID that no
 * adapter has is ignored (Windows' own default is used); a value that is not two decimal numbers
 * crashes the GPU process until Chromium gives up on the GPU entirely — so the value is only
 * ever built here, from numbers.
 *
 * ## Where the LUID comes from
 *
 * `app.getGPUInfo` names the adapters but carries no LUID, and a LUID is not a hardware id: it
 * is handed out at boot, so the same card has a different one after every restart, and last
 * boot's NVIDIA LUID can be this boot's Microsoft Basic Render Driver. So nothing is cached. At
 * every launch `HKLM\SOFTWARE\Microsoft\DirectX` is read (`reg query`, ~40 ms, not PowerShell):
 * Windows' own `DXGIAdapterCache` task writes one subkey per adapter there — `AdapterLuid`,
 * `VendorId`, `DeviceId`, `Description`, `DedicatedVideoMemory`, `LastSeen` — a minute after
 * every boot and whenever an adapter comes or goes. **An entry last seen before this boot is
 * refused**, so the first minute after a restart simply leaves the choice to Windows.
 *
 * ## If it goes wrong
 *
 * When the GPU process crashes on a launch that asked for an adapter, `index.ts` records it
 * (`GpuSwitchFailure`, in `settings.json`), and later launches ask for nothing while it names the
 * adapter they would pick (`planGpu`). Toggling Preferences' checkbox clears it, and so does a
 * different adapter. Nothing relaunches, so nothing can loop.
 */

export const NVIDIA = 0x10de
export const AMD = 0x1002
export const INTEL = 0x8086
/** The Microsoft Basic Render Driver — software, never a choice. */
export const MICROSOFT = 0x1414

export interface DxAdapter {
  luid: bigint
  vendorId: number
  deviceId: number
  description: string
  dedicatedBytes: number
  /** `LastSeen` (a FILETIME), in epoch milliseconds; 0 when absent. */
  lastSeenMs: number
}

/** FILETIME (100 ns since 1601) → epoch milliseconds. */
const filetimeMs = (ft: bigint): number => Number(ft / 10000n) - 11644473600000

/** The two types `reg query` prints numbers as — `0x…` hex. Anything else is not a number here. */
const NUMERIC = new Set(['REG_DWORD', 'REG_QWORD'])

/**
 * Pure. The adapters in `reg query HKLM\SOFTWARE\Microsoft\DirectX /s`: one per subkey that has
 * an `AdapterLuid`. Value names and `REG_*` types are not localised, so this reads any Windows.
 * A numeric field is read only from a `REG_DWORD` / `REG_QWORD`: a `REG_BINARY` prints its bytes
 * as bare hex digits, which `BigInt` would happily read as a decimal number.
 */
export function parseDirectXAdapters(text: string): DxAdapter[] {
  const out: DxAdapter[] = []
  let cur: Map<string, { type: string; value: string }> | null = null
  const flush = (): void => {
    if (!cur) return
    const values = cur
    const num = (name: string): string | undefined => {
      const v = values.get(name)
      return v && NUMERIC.has(v.type) ? v.value : undefined
    }
    const luid = num('adapterluid')
    if (luid) {
      try {
        const lastSeen = num('lastseen')
        out.push({
          luid: BigInt(luid),
          vendorId: Number(num('vendorid') ?? NaN),
          deviceId: Number(num('deviceid') ?? NaN),
          description: values.get('description')?.value ?? '',
          dedicatedBytes: Number(num('dedicatedvideomemory') ?? 0) || 0,
          lastSeenMs: lastSeen ? filetimeMs(BigInt(lastSeen)) : 0
        })
      } catch {
        /* a value that is not a number: not an adapter we can name */
      }
    }
    cur = null
  }
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      flush()
      cur = new Map()
      continue
    }
    const m = /^\s+(\S+)\s+(REG_\w+)\s+(.*?)\s*$/.exec(line)
    if (m && cur) cur.set(m[1].toLowerCase(), { type: m[2].toUpperCase(), value: m[3] })
  }
  flush()
  return out
}

/**
 * Pure. The adapter to run on, or `null` for *let Windows decide*: NVIDIA if there is one, else
 * AMD, the one with the most dedicated memory within a vendor (a Radeon card over a Ryzen's
 * integrated Radeon). `first` puts one vendor ahead of both — a development override only.
 * Only entries seen since `bootMs` are trusted (see the header), and never the software adapter.
 */
export function chooseAdapter(
  adapters: readonly DxAdapter[],
  bootMs: number,
  first?: number
): DxAdapter | null {
  const live = adapters.filter(
    (a) => a.luid > 0n && a.vendorId !== MICROSOFT && a.lastSeenMs >= bootMs
  )
  for (const vendor of [first, NVIDIA, AMD]) {
    if (vendor === undefined) continue
    const same = live.filter((a) => a.vendorId === vendor)
    if (same.length) return same.reduce((a, b) => (b.dedicatedBytes > a.dedicatedBytes ? b : a))
  }
  return null
}

/**
 * Pure. `--use-adapter-luid`'s value: `HighPart,LowPart`, both decimal, as Chromium parses it —
 * or `null`, *ask for nothing*, when `HighPart` is not 0. Every LUID seen here had a zero high
 * part, and how Chromium reads a non-zero (signed) one was never measured; a value it cannot
 * read crashes the GPU process, so an unmeasured form is not sent.
 */
export function luidSwitch(luid: bigint): string | null {
  if (luid >> 32n !== 0n) return null
  return `0,${Number(BigInt.asUintN(32, luid))}`
}

/**
 * The failure `index.ts` records when the GPU process crashed on a launch that asked for an
 * adapter (`settings.ts` stores it): when, and which adapter, by vendor and device id.
 */
export interface GpuSwitchFailure {
  at: number
  vendorId: number
  deviceId: number
}

/**
 * The `child-process-gone` reasons that count as the GPU process failing — the ones the switch
 * could have caused. Not `oom`: a large model can run any adapter out of memory, and turning the
 * discrete GPU off for that would be backwards. Not `killed` (someone ended it — a guard, Task
 * Manager), `clean-exit`, `integrity-failure` (code signing) or `memory-eviction`.
 */
export const GPU_CRASH_REASONS: readonly string[] = ['crashed', 'abnormal-exit', 'launch-failed']

/** Pure. Is this `child-process-gone` a GPU process failure (`GPU_CRASH_REASONS`)? */
export function isGpuCrash(details: { type: string; reason: string }): boolean {
  return details.type === 'GPU' && GPU_CRASH_REASONS.includes(details.reason)
}

/**
 * Pure. Should this `child-process-gone` be recorded as the switch failing? Only a GPU failure
 * (`isGpuCrash`), only the first one this launch, and **only while the app runs** — a GPU process
 * that faults in driver teardown while the app quits says nothing about the adapter, and taking
 * it for one would turn NVIDIA-first off after the first session on such a machine.
 */
export function shouldRecordGpuCrash(state: {
  quitting: boolean
  recorded: boolean
  details: { type: string; reason: string }
}): boolean {
  return !state.quitting && !state.recorded && isGpuCrash(state.details)
}

/**
 * Pure. What this launch does with the adapter `chooseAdapter` picked and the failure an earlier
 * launch recorded. `ask` — append the switch; `clear` — forget the failure first.
 *
 * · Nothing picked: nothing asked, and a failure is kept — the first minute after a boot picks
 *   nothing, and that is not a new adapter.
 * · The failure names the picked adapter: **not asked** — Windows decides until the user turns
 *   Preferences' checkbox off and on (`settings.update` clears it) or the adapter changes.
 * · The failure names another adapter: the hardware changed, so it is forgotten and asked.
 *
 * It never relaunches, so it cannot loop: a launch that asks nothing records nothing.
 */
export function planGpu(
  pick: DxAdapter | null,
  failure: GpuSwitchFailure | null
): { ask: boolean; clear: boolean } {
  if (!pick) return { ask: false, clear: false }
  if (!failure) return { ask: true, clear: false }
  const same = failure.vendorId === pick.vendorId && failure.deviceId === pick.deviceId
  return same ? { ask: false, clear: false } : { ask: true, clear: true }
}

/** The slice of `app.getGPUInfo('complete')` read here. */
export interface GpuInfoLike {
  gpuDevice?: { active?: boolean; vendorId?: number; deviceId?: number; deviceString?: string }[]
  auxAttributes?: { glRenderer?: string }
}

/** Pure. The adapter actually drawing, by name: the active device, else the GL renderer string. */
export function activeGraphics(info: GpuInfoLike | null | undefined): string | null {
  const active = info?.gpuDevice?.find((d) => d.active)
  const name = active?.deviceString?.trim() || info?.auxAttributes?.glRenderer?.trim()
  return name || null
}

/** Pure. Is the active device the adapter that was asked for? By vendor and device id, not name. */
export function isOnAdapter(info: GpuInfoLike | null | undefined, asked: DxAdapter): boolean {
  const active = info?.gpuDevice?.find((d) => d.active)
  return !!active && active.vendorId === asked.vendorId && active.deviceId === asked.deviceId
}
