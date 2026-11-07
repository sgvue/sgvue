/**
 * The Ask Vee window — 2026-11-07. The owner: *"Also bring vee out as a separate window and
 * always on top of our app window. because when the vee panel and properties panel show up
 * together, they blocked my model view."*
 *
 * The chat panel, in a window of its own. It is a **child** of the main window (`parent`), so it
 * stays above the SGVue window — not above other apps — and, on macOS, moves with it. Not modal,
 * resizable, the OS's own chrome. One at most: asking again brings the open one forward. It is
 * opened when the panel opens (the Ask Vee pill, "Ask about this"), closed when the panel closes,
 * and it closes with the main window. It opens where the panel stood — the main window's
 * bottom-right, inside it — at the panel's design size; once moved or sized, it comes back where
 * it was left, relative to the main window, **for this run only**: nothing is written to disk.
 *
 * **Main never holds the conversation here either** — the Schedules window's pattern
 * (`schedules-window.ts`): a private `MessageChannelMain` pair, one end to each page, made again
 * whenever either page (re)loads; when this window closes the main window is told by an empty post
 * on the same channel. Same security as every window: sandboxed, isolated, no Node, no webview,
 * the navigation lock, and the page carries the production CSP (`renderer/vee.html`).
 *
 * **Not watched by `gpu-guard.ts`**, for the Schedules window's reason: Chromium runs one GPU
 * process for the app, and the main window's watch already reads it. This page draws a few small
 * 2D canvases, never WebGL.
 */
import { app, BrowserWindow, MessageChannelMain, shell, type Rectangle } from 'electron'
import { join } from 'path'
import { CH_VEE_PORT } from '../shared/ipc-channels'
import type { VeeTheme } from '../shared/ipc-contract'
import { lockNavigation, mainContents, mainWindow } from './window'

/** The panel's design size (`SGVue.dc.html:850`, 330 × 420 px), as the window's content. */
export const VEE_SIZE = { width: 330, height: 420 } as const
/** The panel's own floor in either direction: the design's 240 px (`SGVue.dc.html:1133–1134`). */
export const VEE_MIN = { width: 240, height: 240 } as const
/** Where the panel stood: 12 px in from the stage's right edge, 52 px up from its foot. */
export const VEE_INSET = { right: 12, bottom: 52 } as const

/**
 * The window's content box at first open: the panel's place in the main window's content box,
 * at `size`, never larger than the main window and never outside it. Pure.
 */
export function veePlacement(host: Rectangle, size: { width: number; height: number } = VEE_SIZE): Rectangle {
  const width = Math.max(1, Math.min(size.width, host.width))
  const height = Math.max(1, Math.min(size.height, host.height))
  return {
    x: Math.round(host.x + Math.max(0, host.width - VEE_INSET.right - width)),
    y: Math.round(host.y + Math.max(0, host.height - VEE_INSET.bottom - height)),
    width: Math.round(width),
    height: Math.round(height)
  }
}

/** Where it was left, relative to the main window's content box, for this run only. Pure. */
export const relativeTo = (box: Rectangle, host: Rectangle): Rectangle => ({
  x: box.x - host.x,
  y: box.y - host.y,
  width: box.width,
  height: box.height
})
export const placedAt = (rel: Rectangle, host: Rectangle): Rectangle => ({
  x: host.x + rel.x,
  y: host.y + rel.y,
  width: rel.width,
  height: rel.height
})

/**
 * The window's background before its page paints: the theme's `--card` (`styles/design.css`), so
 * a window opened in either theme never flashes the other one's colour.
 */
export const VEE_BACKGROUND: Record<VeeTheme, string> = { dark: '#171F20', light: '#FFFFFF' }

/** Everything the window is built with, but its parent and background. Exported for the unit test. */
export const VEE_WINDOW_OPTIONS = {
  title: 'Ask Vee',
  width: VEE_SIZE.width,
  height: VEE_SIZE.height,
  minWidth: VEE_MIN.width,
  minHeight: VEE_MIN.height,
  useContentSize: true,
  modal: false,
  resizable: true,
  fullscreenable: false,
  show: false,
  webPreferences: {
    preload: join(__dirname, '../preload/vee.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false
  }
}

let vee: BrowserWindow | null = null
/** Where the window was left, relative to the main window's content box. Session only. */
let left: Rectangle | null = null
/** Windows whose `close` has started: on their way out, so not the open one. */
const closing = new WeakSet<BrowserWindow>()

const alive = (win: BrowserWindow | null | undefined): win is BrowserWindow =>
  !!win && !win.isDestroyed() && !closing.has(win)
/** The window is open and its page still exists: something can be posted to it. */
const reachable = (win: BrowserWindow | null | undefined): win is BrowserWindow =>
  alive(win) && !win.webContents.isDestroyed()

/** The Ask Vee window, while it exists. */
export const veeWindow = (): BrowserWindow | undefined => (alive(vee) ? vee : undefined)

/**
 * Open the Ask Vee window, or bring the open one forward. `theme` is the main window's, so the
 * page's first paint is already in it; later switches come with the snapshot.
 */
export function openVee(theme: VeeTheme = 'dark'): void {
  const main = mainWindow()
  if (!main) return
  if (alive(vee)) {
    if (vee.isMinimized()) vee.restore()
    vee.focus()
    return
  }

  // A window still closing is not the open one: a new one is made beside it (a fast reopen).
  const win = new BrowserWindow({ ...VEE_WINDOW_OPTIONS, backgroundColor: VEE_BACKGROUND[theme], parent: main })
  vee = win
  const host = main.getContentBounds()
  win.setContentBounds(left ? placedAt(left, host) : veePlacement(host))
  // A small tool window: no menu bar of its own on Windows and Linux (macOS's is the app's).
  win.removeMenu()

  win.on('ready-to-show', () => win.show())
  lockNavigation(win.webContents, (url) => void shell.openExternal(url))
  win.webContents.on('did-finish-load', () => connectVee())
  win.on('close', () => {
    closing.add(win)
    // The main window may be tearing down (it closes this one with it): only a live one has bounds.
    const now = mainWindow()
    if (now && mainContents()) left = relativeTo(win.getContentBounds(), now.getContentBounds())
  })
  win.on('closed', () => {
    // A window opened since is the panel now: its port and the panel's state are not this one's.
    if (vee !== win) return
    vee = null
    // No port: the main window drops its end, and its panel is closed.
    // During the main window's own teardown its page is already gone: nothing to tell.
    mainContents()?.postMessage(CH_VEE_PORT, null, [])
  })

  // The page sets its first `data-theme` from the hash (`renderer/vee/main.tsx`).
  const hash = `theme=${theme}`
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/vee.html#' + hash)
  } else {
    void win.loadFile(join(__dirname, '../renderer/vee.html'), { hash })
  }
}

/**
 * Join the two pages with a new port pair — from either page's `did-finish-load`, so whichever
 * loads last connects them (`connectSchedules` has the measurement behind that).
 */
export function connectVee(): void {
  const main = mainContents()
  if (!main || !reachable(vee)) return
  const { port1, port2 } = new MessageChannelMain()
  main.postMessage(CH_VEE_PORT, null, [port1])
  vee.webContents.postMessage(CH_VEE_PORT, null, [port2])
}

/** The panel closed, or the main window is closing: the window goes. */
export function closeVee(): void {
  if (alive(vee)) vee.close()
}
