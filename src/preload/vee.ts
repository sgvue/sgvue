/**
 * The Ask Vee window's preload — 2026-11-07.
 *
 * The page's whole view of the rest of the app is one `MessagePort` joined to the main window,
 * which main hands over when the page has loaded (`main/vee-window.ts`). A port cannot cross
 * the bridge, so it is re-posted into the page — Electron's own documented pattern for a
 * context-isolated page — where `renderer/vee/link.ts` takes it. **It exposes nothing**: the
 * page calls no IPC channel at all. Opening, closing and focusing the window are the main
 * window's to ask for.
 *
 * **It imports nothing but `electron`**, for the reason `preload/schedule.ts` gives: a module
 * shared with another preload is hoisted into `preload/chunks/`, which a sandboxed preload
 * cannot `require`. The channel name is written here once more, and
 * `tests/unit/vee-window.test.ts` holds it equal to `ipc-channels.ts`.
 */
import { ipcRenderer } from 'electron'

const CH_VEE_PORT = 'vee:port'

ipcRenderer.on(CH_VEE_PORT, (event) => {
  window.postMessage(CH_VEE_PORT, '*', event.ports)
})
