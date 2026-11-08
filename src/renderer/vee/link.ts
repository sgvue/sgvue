/**
 * The Ask Vee window's end of its private port — 2026-11-07.
 *
 * Main hands this page one end of a `MessageChannelMain` pair once it has loaded
 * (`main/vee-window.ts`; the preload re-posts it as `CH_VEE_PORT`). From the main window come
 * `update`s — the snapshot (`./store.ts`) and the trace's changes, which this page's own trace
 * store folds in (`ai/trace-store.ts`, `traceMirror`) so the panel draws the turn on its own
 * frame loop — a `copy` to make here, and a `focus`. Everything that arrives is validated
 * (`ToVee`) and anything else is ignored. What goes back is an intent (`VeeIntent`): one thing
 * the user did, which the main window then does (`model/vee-link.ts`).
 *
 * **A copy is made here** because the click that asked for it was here: `copyText` writes only
 * under the user's activation, which this page has and the main window does not. Whether it
 * reached the clipboard goes back as `copied`.
 */
import { CH_VEE_PORT } from '../../shared/ipc-channels'
import { ToVee, type VeeIntent } from '../../shared/vee-messages'
import { shiftChange, traceEpoch, traceMirror, type TraceChange } from '../ai/trace-store'
import { copyText } from '../clipboard'
import { el, isFieldTarget } from '../dom'
import { takeBoard, takeSnapshot, useVee } from './store'

/**
 * The theme the window opens in: `#theme=light` or `#theme=dark`, put there by main
 * (`main/vee-window.ts`) from the main window's theme, so the first paint is already in it.
 * Anything else is dark, the design's default. Pure.
 */
export function themeFromHash(hash: string): 'dark' | 'light' {
  return /^#?theme=light$/.test(hash) ? 'light' : 'dark'
}

/**
 * Whether a key press closes the window, as the panel's × does: Esc, not mid-composition, and
 * not in a text field — there Esc is the field's, as the design's keys leave a field's keys
 * alone (`isFieldTarget`, which `state/keys.ts` uses too). Pure.
 */
export const escClosesVee = (e: { key: string; isComposing?: boolean; target?: unknown }): boolean =>
  e.key === 'Escape' && !e.isComposing && !isFieldTarget((e.target as { tagName?: string } | null)?.tagName)

let port: MessagePort | null = null

/** The composer, given the keyboard — with the caret at the end when `end` (`askAbout`'s, `:1650`). */
export function focusComposer(end = false): void {
  const input = el('chatinput')
  if (!(input instanceof HTMLInputElement)) return
  input.focus()
  if (end) input.setSelectionRange(input.value.length, input.value.length)
}

/** Send the main window one intent. */
export function post(intent: VeeIntent): void {
  port?.postMessage(intent)
}

/** One message from the main window. Exported for the unit tests. */
export function receive(data: unknown): void {
  const parsed = ToVee.safeParse(data)
  if (!parsed.success) return
  const m = parsed.data
  if (m.type === 'copy') {
    void copyText(m.text).then((ok) => {
      post({ type: 'copied', n: m.n, ok })
      // The table card's `copied` flash, for the copy its own click asked for.
      const flash = useVee.getState().copyFlash
      if (flash && flash.ok === null) useVee.setState({ copyFlash: { ...flash, ok } })
    })
    return
  }
  if (m.type === 'focus') {
    focusComposer(true)
    return
  }
  // Both in the one task, so the panel renders the reply and its trace together.
  // The main window's trace clock started `origin` on the wall clock, this page's `traceEpoch()`.
  const dt = m.origin - traceEpoch()
  for (const change of m.trace) traceMirror(shiftChange(change as TraceChange, dt))
  if (m.snap) takeSnapshot(m.snap)
  if (m.board !== undefined) takeBoard(m.board)
}

/** Take a port. Exported for the unit tests. */
export function connect(next: MessagePort | null): void {
  port?.close()
  port = next
  if (port) port.onmessage = (event: MessageEvent): void => receive(event.data)
}

/** Listen for the port, and for Esc. Called once, before the page renders. */
export function installVeeWindow(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    // Only the preload's own re-post: same window, the channel's name as the data.
    if (event.source !== window || event.data !== CH_VEE_PORT) return
    connect(event.ports[0] ?? null)
  })
  // Esc closes the window, as the panel's × does — but not from inside a text field.
  window.addEventListener('keydown', (e) => {
    if (escClosesVee(e)) post({ type: 'close' })
  })
}
