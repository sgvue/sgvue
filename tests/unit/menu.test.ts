/**
 * `src/main/menu.ts` — Help › Check for updates… (2026-09-25; the product site since
 * 2026-09-28). The item opens `https://sgvue.github.io/?v=<this exact version>` in the user's
 * browser through `shell.openExternal`, built from the one hard-coded constant and the
 * build-time version; the item itself makes no network call.
 */
import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

const built: MenuItemConstructorOptions[][] = []
const openExternal = vi.fn(async () => undefined)

vi.mock('electron', () => ({
  app: { name: 'sgvue', isPackaged: false, setAboutPanelOptions: () => undefined },
  Menu: {
    buildFromTemplate: (t: MenuItemConstructorOptions[]) => (built.push(t), t),
    setApplicationMenu: () => undefined
  },
  shell: { openExternal },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {}
}))
vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const { installMenu } = await import('../../src/main/menu')
const { SITE_URL } = await import('../../src/main/about')

function clickCheckForUpdates(): void {
  installMenu()
  const help = built.at(-1)!.find((m) => m.role === 'help')!
  const item = (help.submenu as MenuItemConstructorOptions[]).find((i) => i.label === 'Check for updates…')!
  expect(item).toBeDefined()
  ;(item.click as () => void)()
}

describe('Help › Check for updates…', () => {
  it.each([
    ['1.1.0', 'https://sgvue.github.io/?v=1.1.0'],
    ['1.2.0-beta.1', 'https://sgvue.github.io/?v=1.2.0-beta.1'],
    // Build metadata's `+` is encoded, so the site reads the version back unchanged.
    ['1.2.0-beta.1+build.5', 'https://sgvue.github.io/?v=1.2.0-beta.1%2Bbuild.5']
  ])('opens the site with ?v= and the exact version %s', (version, expected) => {
    vi.stubGlobal('__APP_VERSION__', version)
    openExternal.mockClear()
    clickCheckForUpdates()
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(expected)
    expect(new URL(expected).searchParams.get('v')).toBe(version)
  })

  it('the constant is the https product site, with no query or hash of its own', () => {
    const url = new URL(SITE_URL)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('sgvue.github.io')
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    expect(SITE_URL).toBe(url.href)
  })
})
