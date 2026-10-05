/**
 * Small helpers every window-facing part of main shares: which window a menu item acts on, a
 * native dialog attached to a window when there is one, and the rule that keeps every window
 * on the app's own page.
 *
 * Since 2026-09-25 there can be two windows — the main window and, on demand, the Schedules
 * window (`schedules-window.ts`). Everything that used to find "the" window by focus or by
 * `getAllWindows()[0]` — Preferences, About, a share link, a second launch — means the **main**
 * window, so it is named here explicitly and never looked up by focus or creation order.
 */
import {
  type BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type WebContents
} from 'electron'

let main: BrowserWindow | null = null

/** `index.ts` records the main window when it creates it, and clears it when it closes. */
export function setMainWindow(win: BrowserWindow | null): void {
  main = win
}

/** The main window, while it exists. */
export const mainWindow = (): BrowserWindow | undefined =>
  main && !main.isDestroyed() ? main : undefined

/**
 * The window a menu item acts on: always the main window, even while Schedules has focus —
 * Preferences and About belong to it, and Schedules has no surface for either.
 */
export const targetWindow = (): BrowserWindow | undefined => mainWindow()

/** A native message box, sheet-attached to `win` when there is one. */
export const messageBox = (
  win: BrowserWindow | null | undefined,
  options: MessageBoxOptions
): Promise<MessageBoxReturnValue> =>
  win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)

/** The native Open dialog, sheet-attached to `win` when there is one. */
export const openDialog = (
  win: BrowserWindow | null | undefined,
  options: OpenDialogOptions
): Promise<OpenDialogReturnValue> =>
  win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)

/**
 * True when `target` is the page already loaded with at most a different `#hash` — the only
 * navigation the window allows. Pure, so the rule is testable without a window.
 */
export function isSameDocument(target: string, current: string): boolean {
  try {
    const a = new URL(target)
    const b = new URL(current)
    a.hash = ''
    b.hash = ''
    return a.href === b.href
  } catch {
    return false
  }
}

/**
 * Nothing moves the window off the app's own page: a link, a `location.href` or a dropped URL
 * is refused, a `<webview>` is never attached, and a new window is never opened (an `http(s)`
 * link goes to the OS browser instead). A share link's hash change is same-document and passes.
 */
export function lockNavigation(contents: WebContents, openExternal: (url: string) => void): void {
  contents.on('will-navigate', (event) => {
    if (!isSameDocument(event.url, contents.getURL())) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) openExternal(url)
    return { action: 'deny' }
  })
}
