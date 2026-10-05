/**
 * `recents:add` in `src/main/index.ts` — the real handler, loaded with Electron stubbed out.
 *
 * `file:admit` trusts main's recents list for network paths (S1), so the list must not be a
 * way in: a compromised renderer naming `\\attacker\share\x.ifc` here would otherwise make the
 * next `file:admit` run `realpath` on it and hand the user's NTLM credentials to that host. A
 * network path joins the list only once the user has admitted it.
 *
 * `realpath` / `stat` are spied so the one "admitted" UNC path never reaches the network.
 */
import { describe, expect, it, vi } from 'vitest'

const ADMITTED_UNC = '\\\\fileserver\\projects\\tower.ifc'

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    realpath: vi.fn(async (path: string) => {
      if (path === ADMITTED_UNC) return path
      throw new Error(`unexpected realpath ${path}`)
    }),
    stat: vi.fn(async () => ({ isFile: () => true, size: 10 }))
  }
})

const handlers = new Map<string, (event: unknown, raw?: unknown) => unknown>()
vi.mock('electron', () => {
  class BrowserWindow {
    static getAllWindows = (): unknown[] => []
    static fromWebContents = (): null => null
    webContents = { on: () => {} }
    on(): void {}
    loadFile(): Promise<void> {
      return Promise.resolve()
    }
  }
  return {
    app: {
      enableSandbox: () => {},
      requestSingleInstanceLock: () => true,
      quit: () => {},
      whenReady: () => Promise.resolve(),
      on: () => {},
      isPackaged: false
    },
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, raw?: unknown) => unknown) =>
        handlers.set(channel, fn),
      on: () => {}
    },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
    session: { defaultSession: { setPermissionRequestHandler: () => {} } },
    shell: { openExternal: () => {} },
    net: { fetch: async () => new Response() },
    BrowserWindow
  }
})
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: () => {} },
  optimizer: { watchWindowShortcuts: () => {} },
  is: { dev: false }
}))
vi.mock('../../src/main/gpu-guard', () => ({ watchGpu: () => {} }))
vi.mock('../../src/main/deep-link', () => ({
  flushPendingLink: () => {},
  installDeepLinks: () => {},
  launchHash: () => '',
  takeLaunchLink: () => null
}))
// Off, so importing main on Windows reads no registry and appends no GPU switch (2026-09-25).
vi.mock('../../src/main/settings', () => ({ preferNvidia: () => false }))
vi.mock('../../src/main/ai/session', () => ({ registerAiIpc: () => {} }))
vi.mock('../../src/main/menu', () => ({ installMenu: () => {} }))
vi.mock('../../src/main/window', () => ({
  lockNavigation: () => {},
  setMainWindow: () => {},
  mainWindow: () => undefined
}))

const current = [{ path: 'C:\\m\\arc.ifc', name: 'arc.ifc', size: 1, sha256: 'a', openedAt: 1 }]
const addRecent = vi.fn(async (file: { path: string }) => [{ ...file, openedAt: 2 }, ...current])
vi.mock('../../src/main/sessions', () => ({
  addRecent: (file: { path: string }) => addRecent(file),
  listRecents: async () => current,
  clearSession: async () => {},
  saveSession: async () => {}
}))

await import('../../src/main/index')
await new Promise((r) => setTimeout(r, 0)) // `whenReady().then(...)` registers the IPC
const { admit } = await import('../../src/main/file-protocol')
const { CH_RECENTS_ADD } = await import('../../src/shared/ipc-channels')

const add = (path: string): Promise<unknown> =>
  handlers.get(CH_RECENTS_ADD)!({}, { path, name: 'x.ifc', size: 1, sha256: 'b' }) as Promise<unknown>

describe('recents:add', () => {
  it('refuses a network path nobody admitted, answering the list unchanged', async () => {
    for (const path of ['\\\\attacker\\share\\x.ifc', '//attacker/share/x.ifc']) {
      expect(await add(path)).toEqual(current)
    }
    expect(addRecent).not.toHaveBeenCalled()
  })

  it('remembers a local path, as before', async () => {
    await add('C:\\m\\str.ifc')
    expect(addRecent).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'C:\\m\\str.ifc' }))
  })

  it('remembers a network path once the user admitted it (the Open dialog)', async () => {
    expect(await admit([ADMITTED_UNC], 'any')).toHaveLength(1)
    await add(ADMITTED_UNC)
    expect(addRecent).toHaveBeenLastCalledWith(expect.objectContaining({ path: ADMITTED_UNC }))
  })
})
