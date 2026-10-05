/**
 * `src/main/file-protocol.ts` — network and device paths (S1), and the token sweep (C7).
 *
 * `realpath` and `stat` on a `\\host\share` path make Windows open an SMB session to that host
 * and offer it the user's NTLM credentials, so the refusal must come **before** either runs.
 * Both are wrapped in spies around the real functions to prove that. The one UNC path that is
 * let through (`TRUSTED`) is answered by the spy with a local file, so no test ever reaches the
 * network.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const TRUSTED = '\\\\fileserver\\projects\\tower.ifc'
let local = ''

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    realpath: vi.fn((path: string) => real.realpath(path === TRUSTED ? local : path)),
    stat: vi.fn(real.stat)
  }
})
vi.mock('electron', () => ({ protocol: { handle: () => {} }, net: { fetch: async () => new Response() } }))

const fsp = await import('node:fs/promises')
const { admit, isRemotePath, mint, pendingTokens } = await import('../../src/main/file-protocol')

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-remote-'))
  local = join(dir, 'tower.ifc')
  await writeFile(local, 'ISO-10303-21;\nEND-ISO-10303-21;\n')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

beforeEach(() => {
  vi.mocked(fsp.realpath).mockClear()
  vi.mocked(fsp.stat).mockClear()
})

const REMOTE = [
  '\\\\attacker\\share\\x.ifc',
  '//attacker/share/x.ifc',
  '\\\\?\\UNC\\attacker\\share\\x.ifc',
  '\\\\?\\C:\\models\\x.ifc',
  '\\\\.\\pipe\\x.ifc',
  '/\\attacker\\share\\x.ifc',
  '\\/attacker/share/x.ifc'
]

describe('isRemotePath', () => {
  it('names every UNC and device form, whichever separators it uses', () => {
    for (const path of REMOTE) expect([path, isRemotePath(path)]).toEqual([path, true])
  })

  it('leaves local paths alone', () => {
    for (const path of ['C:\\models\\x.ifc', 'C:/models/x.ifc', '/home/me/x.ifc', 'x.ifc', '\\models\\x.ifc']) {
      expect([path, isRemotePath(path)]).toEqual([path, false])
    }
  })
})

describe('admit refuses a network path before the file system is touched', () => {
  it('drops it without calling realpath or stat', async () => {
    expect(await admit(REMOTE)).toEqual([])
    expect(fsp.realpath).not.toHaveBeenCalled()
    expect(fsp.stat).not.toHaveBeenCalled()
  })

  it('still admits a local file in the same call', async () => {
    const out = await admit([REMOTE[0], local])
    expect(out.map((f) => f.name)).toEqual(['tower.ifc'])
    expect(vi.mocked(fsp.realpath).mock.calls.map((c) => c[0])).toEqual([local])
  })

  it('lets one through when the user reached it themselves — the Open dialog or recents', async () => {
    expect(await admit([TRUSTED], new Set([TRUSTED]))).toHaveLength(1)
    expect(await admit([TRUSTED], 'any')).toHaveLength(1)
    expect(fsp.realpath).toHaveBeenCalledWith(TRUSTED)
  })

  it('does not let a trusted set vouch for a different network path', async () => {
    expect(await admit([REMOTE[0]], new Set([TRUSTED]))).toEqual([])
    expect(fsp.realpath).not.toHaveBeenCalled()
  })
})

describe('mint sweeps expired tokens (C7)', () => {
  it('drops an unspent token once it is older than its five-minute life', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const [f] = await admit([local])
      const before = pendingTokens()
      mint(f.path)
      expect(pendingTokens()).toBe(before + 1)
      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)
      mint(f.path)
      // The stale one is gone and only the fresh one is outstanding.
      expect(pendingTokens()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
