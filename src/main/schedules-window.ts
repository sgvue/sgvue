/**
 * The Schedules window — 2026-09-25, owner-approved: *"I want this ifcTable to be wired
 * together with sgvue, but as separate window."*
 *
 * One at most: asking again brings the open one forward. It is created on demand from the
 * toolbar button or Window › Schedules, closes when the main window closes, and closing it
 * leaves the main window alone.
 *
 * **Main never holds model data here either.** The two pages talk over a private
 * `MessageChannelMain` pair: main creates it, gives one end to each page, and from then on
 * the snapshot, the theme and every row click go renderer to renderer without passing
 * through this process. A fresh pair is made whenever either page (re)loads, since a
 * reload drops the old end; when Schedules closes the main window is told so by an empty
 * post on the same channel, and stops sending.
 *
 * **Not watched by `gpu-guard.ts`.** Chromium runs one GPU process per app, shared by every
 * window, and the guard's watch on the main window already reads that process and stops the
 * main window's viewer — the only thing in the app that draws WebGL. This page is DOM only.
 * A second watch would read the same process and could only duplicate the trip.
 */
import { app, BrowserWindow, MessageChannelMain, shell } from 'electron'
import { join } from 'path'
import { CH_SCHEDULE_PORT } from '../shared/ipc-channels'
import { lockNavigation, mainWindow } from './window'

let schedules: BrowserWindow | null = null

const alive = (win: BrowserWindow | null | undefined): win is BrowserWindow =>
  !!win && !win.isDestroyed()

/**
 * The Schedules window, while it exists — phase 4: the one sender `export:save` and
 * `scheduleFile:open` answer (`index.ts`), and the window their dialogs attach to.
 */
export const schedulesWindow = (): BrowserWindow | undefined => (alive(schedules) ? schedules : undefined)

/** Open the Schedules window, or bring the open one forward. */
export function openSchedules(): void {
  if (!mainWindow()) return
  if (alive(schedules)) {
    if (schedules.isMinimized()) schedules.restore()
    schedules.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 560,
    minHeight: 360,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#0F1516', // --ground (dark), as the main window
    webPreferences: {
      preload: join(__dirname, '../preload/schedule.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })
  schedules = win

  win.on('ready-to-show', () => win.show())
  lockNavigation(win.webContents, (url) => void shell.openExternal(url))
  win.webContents.on('did-finish-load', () => connectSchedules())
  win.on('closed', () => {
    schedules = null
    // No port: the main window drops its end and stops building snapshots.
    const main = mainWindow()
    if (main) main.webContents.postMessage(CH_SCHEDULE_PORT, null, [])
  })

  // A run under a guard script (`SGVUE_GUARDED=1`, set by safe-run / safe-e2e / safe-app) asks
  // the page to log why each menu closes (`schedule-ui/menu.ts`) — an unpackaged build only, so
  // the shipped app never carries the mark.
  const hash = !app.isPackaged && process.env['SGVUE_GUARDED'] === '1' ? 'guarded' : ''
  // `!app.isPackaged` is `@electron-toolkit/utils`' own `is.dev`, which `index.ts` uses.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/schedule.html' + (hash ? `#${hash}` : ''))
  } else {
    void win.loadFile(join(__dirname, '../renderer/schedule.html'), hash ? { hash } : undefined)
  }
}

/**
 * Join the two pages with a new port pair. Called from each page's `did-finish-load` — the
 * Schedules page's, and the main page's while Schedules is open — so whichever of the two
 * loads last connects them. No loading-state check: measured on 2026-09-25, a page's own
 * `isLoading()` and `isLoadingMainFrame()` both still read true inside its `did-finish-load`,
 * which kept the two windows from ever connecting. A pair handed to a page that is still
 * loading is simply replaced by the next one, when that page's own load finishes.
 */
export function connectSchedules(): void {
  const main = mainWindow()
  if (!main || !alive(schedules)) return
  const { port1, port2 } = new MessageChannelMain()
  main.webContents.postMessage(CH_SCHEDULE_PORT, null, [port1])
  schedules.webContents.postMessage(CH_SCHEDULE_PORT, null, [port2])
}

/** The main window is closing: Schedules goes with it. */
export function closeSchedules(): void {
  if (alive(schedules)) schedules.close()
}
