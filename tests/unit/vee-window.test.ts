/**
 * The Ask Vee window — 2026-11-07. The owner: *"Also bring vee out as a separate window and
 * always on top of our app window."*
 *
 * Held here, with Electron faked, in the Schedules window's style (`schedule/preload.test.ts`):
 *   · the window is a **child of the main window** (`parent`), not modal, resizable, at the
 *     panel's design size with a floor, sandboxed, isolated, without Node or webview, behind the
 *     navigation lock, loading `vee.html` through its own preload;
 *   · one at most — asking again brings it forward — it opens where the panel stood, and comes
 *     back where it was left, relative to the main window, without writing anything;
 *   · its close tells the main window by an empty post on the port channel;
 *   · the preload imports only `electron`, names the channel as `ipc-channels.ts` does and
 *     exposes nothing; the page carries the production CSP byte for byte;
 *   · main answers the two channels for the main window only, before it reads the payload.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CH_SCHEDULE_PORT, CH_VEE_CLOSE, CH_VEE_OPEN, CH_VEE_PORT } from '../../src/shared/ipc-channels'
import { VeeCloseRequest, VeeOpenRequest } from '../../src/shared/ipc-contract'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** A BrowserWindow that records how it was built and what was done to it. */
class FakeWindow {
  static made: FakeWindow[] = []
  handlers = new Map<string, (() => void)[]>()
  contentsHandlers = new Map<string, unknown>()
  posted: { channel: string; ports: unknown[] }[] = []
  bounds: Box = { x: 0, y: 0, width: 0, height: 0 }
  destroyed = false
  /** The page alone is gone: a parent window's teardown, before the window itself is destroyed. */
  contentsDestroyed = false
  focused = 0
  loaded = ''
  loadOptions: unknown = undefined
  menuRemoved = false
  openHandler: unknown = null
  webContents = {
    on: (name: string, fn: unknown) => void this.contentsHandlers.set(name, fn),
    setWindowOpenHandler: (fn: unknown) => void (this.openHandler = fn),
    getURL: () => 'file:///app/out/renderer/vee.html',
    isDestroyed: (): boolean => this.destroyed || this.contentsDestroyed,
    // As Electron's: a post to a destroyed page throws.
    postMessage: (channel: string, _msg: unknown, ports: unknown[]): void => {
      if (this.webContents.isDestroyed()) throw new TypeError('Object has been destroyed')
      this.posted.push({ channel, ports })
    }
  }
  constructor(readonly options: Record<string, unknown>) {
    FakeWindow.made.push(this)
  }
  on(name: string, fn: () => void): void {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn])
  }
  emit(name: string): void {
    for (const fn of this.handlers.get(name) ?? []) fn()
  }
  isDestroyed = (): boolean => this.destroyed
  isMinimized = (): boolean => false
  restore = (): void => undefined
  focus = (): void => void this.focused++
  show = (): void => undefined
  removeMenu = (): void => void (this.menuRemoved = true)
  setContentBounds = (b: Box): void => void (this.bounds = b)
  getContentBounds = (): Box => this.bounds
  loadFile = async (p: string, o?: unknown): Promise<void> => {
    this.loaded = p
    this.loadOptions = o
  }
  loadURL = async (u: string): Promise<void> => void (this.loaded = u)
  close = (): void => {
    this.emit('close')
    this.destroyed = true
    this.emit('closed')
  }
}

class FakeChannel {
  port1 = { name: 'port1' }
  port2 = { name: 'port2' }
}

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: FakeWindow,
  MessageChannelMain: FakeChannel,
  shell: { openExternal: () => undefined },
  dialog: {}
}))

const { setMainWindow } = await import('../../src/main/window')
const { closeVee, openVee, veePlacement, veeWindow, VEE_BACKGROUND, VEE_MIN, VEE_SIZE } = await import(
  '../../src/main/vee-window'
)

const { closeSchedules, connectSchedules, openSchedules } = await import('../../src/main/schedules-window')

const ROOT = join(__dirname, '../..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

let main: FakeWindow

beforeEach(() => {
  closeVee()
  closeSchedules()
  FakeWindow.made = []
  main = new FakeWindow({})
  main.bounds = { x: 100, y: 50, width: 1264, height: 755 }
  setMainWindow(main as unknown as Electron.BrowserWindow)
  FakeWindow.made = []
})

describe('main/vee-window.ts — the window', () => {
  it('is a child of the main window: not modal, resizable, the panel’s size, sandboxed and isolated', () => {
    openVee()
    expect(FakeWindow.made).toHaveLength(1)
    const o = FakeWindow.made[0].options
    expect(o.parent).toBe(main)
    expect(o.modal).toBe(false)
    expect(o.resizable).toBe(true)
    expect(o.title).toBe('Ask Vee')
    expect(o.useContentSize).toBe(true)
    expect([o.width, o.height]).toEqual([330, 420])
    expect([o.minWidth, o.minHeight]).toEqual([VEE_MIN.width, VEE_MIN.height])
    // 2026-11-08 (stage 1b): the prototype's smallest window, as the content box.
    expect(VEE_MIN).toEqual({ width: 300, height: 380 })
    // Not above other apps: a child window, never `alwaysOnTop`.
    expect(o.alwaysOnTop).toBeUndefined()
    expect(o.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    })
    expect(String((o.webPreferences as { preload: string }).preload)).toMatch(/preload[\\/]vee\.js$/)
    expect(FakeWindow.made[0].loaded).toMatch(/renderer[\\/]vee\.html$/)
  })

  it('is locked to its own page: no navigation, no webview, no window of its own', () => {
    openVee()
    const w = FakeWindow.made[0]
    expect(w.contentsHandlers.has('will-navigate')).toBe(true)
    expect(w.contentsHandlers.has('will-attach-webview')).toBe(true)
    const handler = w.openHandler as (d: { url: string }) => { action: string }
    expect(handler({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
  })

  it('is one at most: asking again brings it forward', () => {
    openVee()
    openVee()
    expect(FakeWindow.made).toHaveLength(1)
    expect(FakeWindow.made[0].focused).toBe(1)
    expect(veeWindow()).toBe(FakeWindow.made[0])
  })

  it('opens where the panel stood, and comes back where it was left — relative to the main window', () => {
    openVee()
    const w = FakeWindow.made[0]
    // The main window's bottom-right, 12 px in and 52 px up, inside its content box.
    expect(w.bounds).toEqual({ x: 100 + 1264 - 12 - 330, y: 50 + 755 - 52 - 420, width: 330, height: 420 })
    w.bounds = { x: 300, y: 200, width: 400, height: 500 }
    closeVee()
    expect(veeWindow()).toBeUndefined()
    main.bounds = { ...main.bounds, x: 150, y: 80 }
    openVee()
    expect(FakeWindow.made[1].bounds).toEqual({ x: 350, y: 230, width: 400, height: 500 })
  })

  it('its close tells the main window: an empty post on the port channel', () => {
    openVee()
    main.posted = []
    closeVee()
    expect(main.posted).toEqual([{ channel: CH_VEE_PORT, ports: [] }])
  })

  it('joins the two pages when it has loaded: one end each', () => {
    openVee()
    const w = FakeWindow.made[0]
    ;(w.contentsHandlers.get('did-finish-load') as () => void)()
    expect(main.posted.map((p) => p.channel)).toEqual([CH_VEE_PORT])
    expect(w.posted.map((p) => p.channel)).toEqual([CH_VEE_PORT])
    expect(main.posted[0].ports).toHaveLength(1)
    expect(w.posted[0].ports).toHaveLength(1)
    expect(main.posted[0].ports[0]).not.toBe(w.posted[0].ports[0])
  })

  it('opens in the main window’s theme: the background is that theme’s --card, the hash names it', () => {
    // The two `--card` values of `styles/design.css`, read from the file, not recalled.
    const css = read('src/renderer/styles/design.css')
    const dark = /^:root\{[^}]*?--card:(#[0-9A-Fa-f]{6})/m.exec(css)?.[1]
    const light = /:root\[data-theme="light"\]\{[^}]*?--card:(#[0-9A-Fa-f]{6})/.exec(css)?.[1]
    expect(VEE_BACKGROUND).toEqual({ dark, light })
    openVee('light')
    expect(FakeWindow.made[0].options.backgroundColor).toBe(light)
    expect(FakeWindow.made[0].loadOptions).toEqual({ hash: 'theme=light' })
    closeVee()
    openVee('dark')
    expect(FakeWindow.made[1].options.backgroundColor).toBe(dark)
    expect(FakeWindow.made[1].loadOptions).toEqual({ hash: 'theme=dark' })
  })

  it('a fast reopen: a window whose close has started is not the open one, and its close leaves the new one be', () => {
    openVee()
    const old = FakeWindow.made[0]
    // The close has started, and has not finished.
    old.emit('close')
    expect(veeWindow()).toBeUndefined()
    openVee()
    expect(FakeWindow.made).toHaveLength(2)
    expect(old.focused).toBe(0)
    const now = FakeWindow.made[1]
    expect(veeWindow()).toBe(now)
    main.posted = []
    old.destroyed = true
    old.emit('closed')
    // No empty post — the main window's panel stays open, its port the new window's to give.
    expect(main.posted).toEqual([])
    expect(veeWindow()).toBe(now)
    // …and the new one's own close still says so.
    closeVee()
    expect(main.posted).toEqual([{ channel: CH_VEE_PORT, ports: [] }])
    expect(veeWindow()).toBeUndefined()
  })

  it('opens nothing without a main window', () => {
    setMainWindow(null)
    openVee()
    expect(FakeWindow.made).toHaveLength(0)
  })
})

/**
 * 2026-11-07: closing the main window closes its child Vee window during the main window's own
 * teardown — its page already destroyed, the window not yet — and the `closed` handler's post
 * threw `TypeError: Object has been destroyed` in main.
 */
describe('the main window going away while a child window is open', () => {
  for (const [what, gone] of [
    ['its page is destroyed, the window not yet', (): void => void (main.contentsDestroyed = true)],
    ['the window is destroyed', (): void => void (main.destroyed = true)]
  ] as const) {
    it(`Vee: ${what} — close and closed throw nothing and post nothing`, () => {
      openVee()
      const w = FakeWindow.made[0]
      ;(w.contentsHandlers.get('did-finish-load') as () => void)()
      main.posted = []
      gone()
      expect(() => closeVee()).not.toThrow()
      expect(main.posted).toEqual([])
      expect(veeWindow()).toBeUndefined()
    })

    it(`Vee: ${what} — a late did-finish-load connects nothing`, () => {
      openVee()
      const w = FakeWindow.made[0]
      main.posted = []
      gone()
      expect(() => (w.contentsHandlers.get('did-finish-load') as () => void)()).not.toThrow()
      expect(main.posted).toEqual([])
      expect(w.posted).toEqual([])
    })

    it(`Schedules: ${what} — closed throws nothing and posts nothing`, () => {
      openSchedules()
      const w = FakeWindow.made[0]
      main.posted = []
      gone()
      expect(() => connectSchedules()).not.toThrow()
      expect(() => closeSchedules()).not.toThrow()
      expect(main.posted).toEqual([])
      expect(w.posted).toEqual([])
    })
  }

  it('a child window whose own page is gone is not connected', () => {
    openVee()
    openSchedules()
    const [v, s] = FakeWindow.made
    v.contentsDestroyed = true
    s.contentsDestroyed = true
    main.posted = []
    expect(() => (v.contentsHandlers.get('did-finish-load') as () => void)()).not.toThrow()
    expect(() => connectSchedules()).not.toThrow()
    expect(main.posted).toEqual([])
  })

  it('Schedules: with the main window whole, its close still tells it', () => {
    openSchedules()
    main.posted = []
    closeSchedules()
    expect(main.posted.map((p) => [p.channel, p.ports.length])).toEqual([[CH_SCHEDULE_PORT, 0]])
  })
})

describe('veePlacement', () => {
  it('never larger than the main window, never outside it', () => {
    expect(veePlacement({ x: 0, y: 0, width: 200, height: 150 })).toEqual({ x: 0, y: 0, width: 200, height: 150 })
    expect(veePlacement({ x: 10, y: 20, width: 1000, height: 800 }, VEE_SIZE)).toEqual({
      x: 10 + 1000 - 12 - 330,
      y: 20 + 800 - 52 - 420,
      width: 330,
      height: 420
    })
  })
})

describe('the source: main, the preload and the page', () => {
  it('writes nothing to disk: the bounds are kept for the run only', () => {
    expect(read('src/main/vee-window.ts')).not.toMatch(/\b(writeFile|settings|sessions)\b/)
  })

  it('preload/vee.ts imports electron alone, names the channel as ipc-channels does, and exposes nothing', () => {
    const text = read('src/preload/vee.ts')
    const code = text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')
    const imports = [...text.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[2])
    expect(imports).toEqual(['electron'])
    expect(/const CH_VEE_PORT = '([^']+)'/.exec(code)?.[1]).toBe(CH_VEE_PORT)
    expect(code).not.toMatch(/contextBridge|exposeInMainWorld/)
    expect(code).not.toMatch(/ipcRenderer\.(send|sendSync|invoke|postMessage)\b/)
    expect([...code.matchAll(/ipcRenderer\.on\(\s*(CH_[A-Z_]+)/g)].map((m) => m[1])).toEqual(['CH_VEE_PORT'])
  })

  it('vee.html carries the production CSP byte for byte', () => {
    const CSP = /const CSP =\s*"([^"]+)"/.exec(read('electron.vite.config.ts'))![1]
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read('src/renderer/vee.html'))?.[1]
    expect(meta).toBe(CSP)
    expect(read('src/renderer/vee.html')).toMatch(/<title>Ask Vee<\/title>/)
  })

  it('opening carries the theme and nothing else; closing carries nothing', () => {
    expect(VeeOpenRequest.parse({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(VeeOpenRequest.parse({ theme: 'dark' })).toEqual({ theme: 'dark' })
    for (const bad of [undefined, {}, { theme: 'blue' }, { theme: 'dark', url: 'x' }, 'dark']) {
      expect(VeeOpenRequest.safeParse(bad).success).toBe(false)
    }
    expect(VeeCloseRequest.safeParse(undefined).success).toBe(true)
    expect(VeeCloseRequest.safeParse({}).success).toBe(false)
  })

  it('main answers the two channels for the main window only, before reading the payload', () => {
    const text = read('src/main/index.ts')
    for (const ch of ['CH_VEE_OPEN', 'CH_VEE_CLOSE']) {
      const at = text.indexOf(`ipcMain.handle(${ch},`)
      expect(at, `${ch} has no handler`).toBeGreaterThan(-1)
      const body = text.slice(at, text.indexOf('\n  })', at))
      expect(body).toMatch(/Request\.parse\(raw\)\n\s*if \(event\.sender !== mainWindow\(\)\?\.webContents\) return/)
    }
    // …the preload's two calls are exactly those: opening carries the theme, closing nothing.
    const preload = read('src/preload/index.ts')
    expect(preload).toMatch(/openVee: \(theme: VeeTheme\): Promise<void> => ipcRenderer\.invoke\(CH_VEE_OPEN, \{ theme \}\)/)
    expect(preload).toMatch(/closeVee: \(\): Promise<void> => ipcRenderer\.invoke\(CH_VEE_CLOSE\)/)
    expect([CH_VEE_OPEN, CH_VEE_CLOSE]).toEqual(['vee:open', 'vee:close'])
    // The window closes with the main window.
    expect(text).toMatch(/closeSchedules\(\)\n\s*closeVee\(\)/)
  })
})
