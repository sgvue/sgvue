/**
 * `src/main/gpu-choice.ts` (2026-09-25) — which adapter SGVue asks Chromium for on Windows.
 *
 * The registry text is `reg query HKLM\SOFTWARE\Microsoft\DirectX /s` as this Windows prints it
 * (the RTX 3070 Ti + UHD 770 desktop, one boot's LUIDs), trimmed to the values read.
 */
import { describe, expect, it } from 'vitest'
import {
  activeGraphics,
  AMD,
  chooseAdapter,
  INTEL,
  isGpuCrash,
  isOnAdapter,
  luidSwitch,
  MICROSOFT,
  NVIDIA,
  parseDirectXAdapters,
  planGpu,
  shouldRecordGpuCrash,
  type DxAdapter
} from '../../src/main/gpu-choice'

/** 2026-09-24 01:40:57.266 UTC as a FILETIME — the `DXGIAdapterCache` run a minute after boot. */
const SEEN = '0x1dd4bc5becc1029'
const SEEN_MS = Date.UTC(2026, 8, 24, 1, 40, 57, 266)
const BOOT_MS = Date.UTC(2026, 8, 24, 1, 39, 44)

const REG = [
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX',
  '    Version    REG_SZ    4.09.00.0904',
  `    LastSeen    REG_QWORD    ${SEEN}`,
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{238B5620-B93E-11EF-8BB2-806E6F6E6963}',
  '    Description    REG_SZ    Microsoft Basic Render Driver',
  '    AdapterLuid    REG_QWORD    0x12a33',
  '    VendorId    REG_DWORD    0x1414',
  '    DeviceId    REG_DWORD    0x8c',
  '    DedicatedVideoMemory    REG_QWORD    0x0',
  `    LastSeen    REG_QWORD    ${SEEN}`,
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{238B5633-B93E-11EF-8BB2-806E6F6E6963}',
  '    Description    REG_SZ    Intel(R) UHD Graphics 770',
  '    AdapterLuid    REG_QWORD    0x12a5e',
  '    VendorId    REG_DWORD    0x8086',
  '    DeviceId    REG_DWORD    0x4680',
  '    DedicatedVideoMemory    REG_QWORD    0x8000000',
  `    LastSeen    REG_QWORD    ${SEEN}`,
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{4591AAB8-B93E-11EF-8BB3-8A3C5581D728}',
  '    Description    REG_SZ    NVIDIA GeForce RTX 3070 Ti',
  '    AdapterLuid    REG_QWORD    0x11524',
  '    VendorId    REG_DWORD    0x10de',
  '    DeviceId    REG_DWORD    0x2482',
  '    DedicatedVideoMemory    REG_QWORD    0x1f5100000',
  `    LastSeen    REG_QWORD    ${SEEN}`,
  '    AdapterFamily    REG_SZ    unspecified adapter family from ddiShaderCacheGetCaps_12_0118()',
  ''
].join('\r\n')

const adapter = (over: Partial<DxAdapter>): DxAdapter => ({
  luid: 0x100n,
  vendorId: INTEL,
  deviceId: 1,
  description: 'x',
  dedicatedBytes: 0,
  lastSeenMs: SEEN_MS,
  ...over
})

describe('reading the registry', () => {
  it('finds one adapter per subkey that has a LUID, and ignores the root key', () => {
    const list = parseDirectXAdapters(REG)
    expect(list.map((a) => a.description)).toEqual([
      'Microsoft Basic Render Driver',
      'Intel(R) UHD Graphics 770',
      'NVIDIA GeForce RTX 3070 Ti'
    ])
    const nv = list[2]
    expect(nv.luid).toBe(0x11524n)
    expect(nv.vendorId).toBe(NVIDIA)
    expect(nv.deviceId).toBe(0x2482)
    expect(nv.dedicatedBytes).toBe(0x1f5100000)
    expect(nv.lastSeenMs).toBe(SEEN_MS)
  })

  it('reads LF output the same, and survives nothing, junk and a non-numeric LUID', () => {
    expect(parseDirectXAdapters(REG.replace(/\r\n/g, '\n'))).toEqual(parseDirectXAdapters(REG))
    expect(parseDirectXAdapters('')).toEqual([])
    expect(parseDirectXAdapters('ERROR: The system was unable to find the specified registry key')).toEqual([])
    expect(
      parseDirectXAdapters('HKEY_LOCAL_MACHINE\\X\\{a}\r\n    AdapterLuid    REG_QWORD    nonsense\r\n')
    ).toEqual([])
  })
})

describe('choosing the adapter', () => {
  it('this desktop: NVIDIA over Intel, never the Basic Render Driver', () => {
    expect(chooseAdapter(parseDirectXAdapters(REG), BOOT_MS)?.description).toBe(
      'NVIDIA GeForce RTX 3070 Ti'
    )
  })

  it('no NVIDIA: the AMD adapter with the most dedicated memory', () => {
    const apu = adapter({ vendorId: AMD, luid: 1n, dedicatedBytes: 512 << 20, description: 'APU' })
    const card = adapter({ vendorId: AMD, luid: 2n, dedicatedBytes: 8192 * 2 ** 20, description: 'card' })
    const intel = adapter({ vendorId: INTEL, luid: 3n, dedicatedBytes: 16 * 2 ** 30 })
    expect(chooseAdapter([apu, intel, card], BOOT_MS)?.description).toBe('card')
    expect(chooseAdapter([card, apu], BOOT_MS)?.description).toBe('card')
  })

  it('NVIDIA wins over AMD whatever the memory', () => {
    const amd = adapter({ vendorId: AMD, luid: 1n, dedicatedBytes: 24 * 2 ** 30 })
    const nv = adapter({ vendorId: NVIDIA, luid: 2n, dedicatedBytes: 4 * 2 ** 30, description: 'nv' })
    expect(chooseAdapter([amd, nv], BOOT_MS)?.description).toBe('nv')
  })

  it('Intel only, or only software: nothing is asked for, and Windows decides', () => {
    expect(chooseAdapter([adapter({ vendorId: INTEL })], BOOT_MS)).toBeNull()
    expect(chooseAdapter([adapter({ vendorId: MICROSOFT })], BOOT_MS)).toBeNull()
    expect(chooseAdapter([], BOOT_MS)).toBeNull()
  })

  it('refuses an entry last seen before this boot — its LUID may now be another adapter', () => {
    const list = parseDirectXAdapters(REG)
    expect(chooseAdapter(list, SEEN_MS + 1)).toBeNull()
    expect(chooseAdapter(list, SEEN_MS)?.vendorId).toBe(NVIDIA)
    expect(chooseAdapter([adapter({ vendorId: NVIDIA, lastSeenMs: 0 })], BOOT_MS)).toBeNull()
  })

  it('never a LUID of zero', () => {
    expect(chooseAdapter([adapter({ vendorId: NVIDIA, luid: 0n })], BOOT_MS)).toBeNull()
  })

  it('the development override puts one vendor first, and falls back when it is absent', () => {
    const list = parseDirectXAdapters(REG)
    expect(chooseAdapter(list, BOOT_MS, INTEL)?.description).toBe('Intel(R) UHD Graphics 770')
    expect(chooseAdapter(list, BOOT_MS, AMD)?.vendorId).toBe(NVIDIA)
    // Even named, the software adapter is never a choice.
    expect(chooseAdapter(list, BOOT_MS, MICROSOFT)?.vendorId).toBe(NVIDIA)
  })
})

describe('the switch value', () => {
  it('is HighPart,LowPart in decimal — the only form Chromium accepts', () => {
    expect(luidSwitch(0x11524n)).toBe('0,70948')
    expect(luidSwitch(0x12a5en)).toBe('0,76382')
    expect(luidSwitch(0x8000_0000n)).toBe('0,2147483648')
    expect(luidSwitch(0xffff_ffffn)).toBe('0,4294967295')
    for (const v of [0x11524n, 0x12345678n]) expect(luidSwitch(v)).toMatch(/^0,\d+$/)
  })

  it('refuses a non-zero HighPart — a form never measured is never sent', () => {
    expect(luidSwitch(0x1_0000_0005n)).toBeNull()
    // HighPart is a signed LONG; -1 is refused like any other.
    expect(luidSwitch(0xffff_ffff_0000_0001n)).toBeNull()
    expect(luidSwitch(0xabcdef_12345678n)).toBeNull()
  })
})

describe('numbers come only from REG_DWORD / REG_QWORD', () => {
  it('ignores an all-digit REG_BINARY where a number belongs', () => {
    // `reg query` prints REG_BINARY as bare hex bytes, which BigInt would read as decimal.
    const binaryLuid = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{a}',
      '    AdapterLuid    REG_BINARY    11524',
      '    VendorId    REG_DWORD    0x10de',
      `    LastSeen    REG_QWORD    ${SEEN}`
    ].join('\r\n')
    expect(parseDirectXAdapters(binaryLuid)).toEqual([])

    const binaryVendor = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\DirectX\\{b}',
      '    AdapterLuid    REG_QWORD    0x11524',
      '    VendorId    REG_BINARY    4318',
      `    LastSeen    REG_QWORD    ${SEEN}`
    ].join('\r\n')
    const [a] = parseDirectXAdapters(binaryVendor)
    expect(a.luid).toBe(0x11524n)
    expect(a.vendorId).toBeNaN()
    expect(chooseAdapter([a], BOOT_MS)).toBeNull()
  })
})

describe('a GPU process that failed with the switch', () => {
  it('counts crashed, abnormal-exit and launch-failed of the GPU process — nothing else', () => {
    for (const reason of ['crashed', 'abnormal-exit', 'launch-failed']) {
      expect(isGpuCrash({ type: 'GPU', reason })).toBe(true)
    }
    for (const reason of ['oom', 'killed', 'clean-exit', 'integrity-failure', 'memory-eviction']) {
      expect(isGpuCrash({ type: 'GPU', reason })).toBe(false)
    }
    expect(isGpuCrash({ type: 'Utility', reason: 'crashed' })).toBe(false)
    expect(isGpuCrash({ type: 'Tab', reason: 'crashed' })).toBe(false)
  })

  it('records only the first failure, and never while the app quits (driver teardown)', () => {
    const crashed = { type: 'GPU', reason: 'crashed' }
    expect(shouldRecordGpuCrash({ quitting: false, recorded: false, details: crashed })).toBe(true)
    expect(shouldRecordGpuCrash({ quitting: true, recorded: false, details: crashed })).toBe(false)
    expect(shouldRecordGpuCrash({ quitting: false, recorded: true, details: crashed })).toBe(false)
    expect(
      shouldRecordGpuCrash({ quitting: true, recorded: false, details: { type: 'GPU', reason: 'abnormal-exit' } })
    ).toBe(false)
    expect(
      shouldRecordGpuCrash({ quitting: false, recorded: false, details: { type: 'GPU', reason: 'killed' } })
    ).toBe(false)
  })

  const nv = parseDirectXAdapters(REG)[2]
  const failure = { at: 1, vendorId: NVIDIA, deviceId: 0x2482 }

  it('no failure recorded: ask', () => {
    expect(planGpu(nv, null)).toEqual({ ask: true, clear: false })
  })

  it('a failure with this adapter: ask nothing, and keep it', () => {
    expect(planGpu(nv, failure)).toEqual({ ask: false, clear: false })
  })

  it('a failure with another adapter: the hardware changed — forget it and ask', () => {
    expect(planGpu(nv, { ...failure, deviceId: 0x2484 })).toEqual({ ask: true, clear: true })
    expect(planGpu(nv, { ...failure, vendorId: AMD })).toEqual({ ask: true, clear: true })
  })

  it('nothing picked (the first minute after boot): ask nothing, and keep the failure', () => {
    expect(planGpu(null, failure)).toEqual({ ask: false, clear: false })
    expect(planGpu(null, null)).toEqual({ ask: false, clear: false })
  })
})

describe('what is drawing', () => {
  const info = {
    gpuDevice: [
      { active: false, vendorId: NVIDIA, deviceId: 0x2482, deviceString: 'NVIDIA GeForce RTX 3070 Ti' },
      { active: true, vendorId: INTEL, deviceId: 0x4680, deviceString: 'Intel(R) UHD Graphics 770' }
    ],
    auxAttributes: { glRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 …, D3D11)' }
  }

  it('names the active device, else the GL renderer, else nothing', () => {
    expect(activeGraphics(info)).toBe('Intel(R) UHD Graphics 770')
    expect(activeGraphics({ ...info, gpuDevice: [] })).toBe(info.auxAttributes.glRenderer)
    expect(activeGraphics({})).toBeNull()
    expect(activeGraphics(null)).toBeNull()
  })

  it('compares by vendor and device id, not by name', () => {
    const list = parseDirectXAdapters(REG)
    expect(isOnAdapter(info, list[1])).toBe(true)
    expect(isOnAdapter(info, list[2])).toBe(false)
    expect(isOnAdapter({}, list[2])).toBe(false)
  })
})
