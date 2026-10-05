/**
 * Text to the clipboard — the one helper both windows use. It was the Schedules window's own
 * (`schedule-ui/main.ts`, "Copy GUIDs"); since 2026-10-02 the main window's two copy controls
 * call it too, because they were found to copy nothing.
 *
 * **Measured, 2026-10-02** (Electron 44.3.0 / Chromium 152, a guarded run; `docs/DECISIONS.md`
 * has the table):
 *
 *   · `navigator.clipboard.writeText` is **refused in this app, always** — on a page never
 *     clicked, straight after a click, and under a user gesture alike (`NotAllowedError: Write
 *     permission denied`). Chromium asks the browser process for `clipboard-sanitized-write`
 *     (with a gesture) or `clipboard-read` (the read-write permission, without one), and main
 *     denies every permission request (`main/index.ts`, plan §3.2).
 *   · So "copy link to this state" and the property card's Copy flashed `link copied` and
 *     `Copied` over a clipboard that had not changed: both treated a rejection as success.
 *   · The design's own fallback (`SGVue.dc.html:1991`) — a selected textarea and
 *     `document.execCommand('copy')` — **works, and only under user activation**: a click or a
 *     key press within the last five seconds. With none it returns `false` and writes nothing.
 *
 * So the async API is tried first, for the day main's policy changes, and the fallback is what
 * copies. **It resolves `true` only when the text reached the clipboard**, and a caller flashes
 * on that and on nothing else.
 *
 * It is not what keeps the assistant away from the clipboard. Activation lasts five seconds, so
 * a tool call arriving just after the user pressed Enter would be allowed to copy; what stops
 * it is that no tool calls this — a copy is asked for, and runs from the user's own click on
 * Apply (`ai/executors/request.ts`, `state/shell.ts` `applyPending`).
 *
 * Whatever had the focus gets it back: the textarea takes it to be selected, and a keyboard
 * user's place in the page must not be lost to a copy.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // No clipboard API at all (a unit test, an insecure context) lands here too.
    if (typeof document === 'undefined') return false
    const had = document.activeElement
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    if (had instanceof HTMLElement && had.isConnected) had.focus({ preventScroll: true })
    return ok
  }
}
