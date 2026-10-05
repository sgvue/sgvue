/**
 * Share links — `sgvue://s=<base64url>` (plan §2 "Share link", `CLAUDE.md` allowed deviations).
 *
 * The design's "copy link to this state" writes a `#s=…` hash into its own page URL. A desktop
 * app has no address bar, so the same payload travels in a registered scheme and the OS hands
 * it back:
 *
 * · **macOS** delivers it to the running app through `open-url`, which can fire *before*
 *   `whenReady`. It is parked here until a window exists.
 * · **Windows** launches a second process with the URL in `argv`; the single-instance lock
 *   turns that into a `second-instance` event on the first one.
 *
 * Registering the scheme stays `app.isPackaged`-only (`index.ts`): claiming `sgvue://`
 * system-wide from a development checkout would hijack it for the installed app. So that the
 * path is still exercisable, a link can be fed in at launch with `--sgvue-link=<url>` or
 * `SGVUE_LINK=<url>` — which is how `tests/e2e` drives it.
 */
import { app, type BrowserWindow } from 'electron'
import { CH_LINK_OPEN } from '../shared/ipc-contract'
import { LINK_PATTERN } from '../shared/session-codec'
// The main window by name, never `getAllWindows()[0]`: since 2026-09-25 the Schedules window
// can exist too, and a link or a second launch belongs to the main window.
import { mainWindow } from './window'

/** The first `sgvue://` argument in an argv, or `null`. Windows and the dev hook both use it. */
export function linkFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (/^sgvue:/i.test(arg)) return arg
    const flag = /^--sgvue-link=(.+)$/.exec(arg)
    if (flag && /^sgvue:/i.test(flag[1])) return flag[1]
  }
  return null
}

let pending: string | null = null
let launch: string | null = null

/**
 * The link the app was **launched** with, consumed once by `createWindow`.
 *
 * It goes into the renderer's own `location.hash` as `#s=…` rather than over IPC, for two
 * reasons: it is the design's own path (`SGVue.dc.html:866` reads `[#&]s=` out of the hash at
 * mount), and it is race-free — `did-finish-load` can fire before React's first effect has
 * registered an IPC listener, and a link sent then is simply lost.
 */
export function takeLaunchLink(): string | null {
  const url = launch
  launch = null
  return url
}

/**
 * What of a launch link may reach `location.hash`: **its payload, and nothing else**.
 *
 * `createWindow` used to copy everything after the scheme into the hash, so a link could carry
 * any other switch the renderer reads there — `sgvue://s=<payload>&backend=webgpu` asked a
 * cold start for the backend that kernel-panicked the development Mac (`CLAUDE.md` Decisions,
 * 2026-09-17). A link is a thing a person is handed by someone else, so it now travels as
 * `s=<code>` or as nothing at all; anything that is not a payload yields `''` and the renderer
 * opens on the landing page, exactly as it does for a link it cannot read.
 *
 * The shape is `payloadFromLink`'s own — one `LINK_PATTERN` in `shared/session-codec.ts` —
 * whitespace tolerance included: the same `sgvue://s=…`, `sgvue:s=…` and trailing `?x` / `#x`
 * forms an OS may hand over. `tests/unit/deep-link.test.ts` holds the two to each other.
 */
export function launchHash(link: string | null): string {
  const m = LINK_PATTERN.exec((link ?? '').trim())
  return m ? `s=${m[1]}` : ''
}

/** Bring the window the app already has in front of the person. */
function surface(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.focus()
}

/** Hand a link to the renderer, or park it until there is one. */
function deliver(url: string): void {
  const win = mainWindow()
  if (!win || win.webContents.isLoading()) {
    pending = url
    return
  }
  win.webContents.send(CH_LINK_OPEN, { url })
  surface(win)
}

/**
 * Called once the window has finished loading: anything the OS delivered before that is sent
 * now. The renderer treats a link as taking precedence over the stored session, exactly as
 * `SGVue.dc.html:869` does.
 */
export function flushPendingLink(): void {
  if (!pending) return
  const url = pending
  pending = null
  deliver(url)
}

/**
 * Wire the two OS paths and the dev hook. Safe to call before `whenReady` — `open-url` on
 * macOS fires early and must already have a listener, or the link is lost.
 */
export function installDeepLinks(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    deliver(url)
  })
  app.on('second-instance', (_event, argv) => {
    const url = linkFromArgv(argv)
    if (url) return deliver(url)
    // No link: the shortcut or the Start menu was used again, and what every Windows
    // application does then is bring its window forward. Without this a minimised SGVue
    // stayed minimised and a second launch looked like nothing at all.
    const win = mainWindow()
    if (win) surface(win)
  })
  launch = linkFromArgv(process.argv) ?? (process.env.SGVUE_LINK || null)
}
