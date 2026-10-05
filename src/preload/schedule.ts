/**
 * The Schedules window's preload — 2026-09-25.
 *
 * The page's view of the rest of the app is one `MessagePort` joined to the main window, which
 * main hands over when the page has loaded (`main/schedules-window.ts`). A port cannot cross
 * the bridge, so it is re-posted into the page — Electron's own documented pattern for a
 * context-isolated page — where `renderer/schedule-ui/main.ts` takes it.
 *
 * **Phase 4 adds exactly two calls, and nothing else** (`window.sgvueSchedule`): `saveExport`
 * hands main a kind, a suggested file name and the bytes, and main shows the native Save
 * dialog and writes where the user points (`main/exports.ts`, the third writer); and
 * `openScheduleFile` asks main for the native Open dialog and gets back the text of the
 * `.schedule.json` picked, or `null`. Neither takes a path. Main answers both for this window
 * only, and validates both with zod — nothing is validated here.
 *
 * **It imports nothing but `electron`**, not even `shared/ipc-channels.ts`: a module shared
 * with the main preload is hoisted by Rollup into `preload/chunks/`, and a sandboxed preload
 * cannot `require` one — both windows would load with no bridge and no error. The channel names
 * are therefore written here once more; `tests/unit/schedule/preload.test.ts` holds them equal
 * to `ipc-channels.ts` and holds this file to its one import, and `tests/readonly-guard.test.ts`
 * pins the two keys.
 */
import { contextBridge, ipcRenderer } from 'electron'

const CH_SCHEDULE_PORT = 'schedule:port'
const CH_EXPORT_SAVE = 'export:save'
const CH_SCHEDULE_FILE_OPEN = 'scheduleFile:open'

ipcRenderer.on(CH_SCHEDULE_PORT, (event) => {
  window.postMessage(CH_SCHEDULE_PORT, '*', event.ports)
})

const api = {
  saveExport: (req: { kind: string; suggestedName: string; bytes: Uint8Array }): Promise<{ saved: boolean }> =>
    ipcRenderer.invoke(CH_EXPORT_SAVE, { kind: req.kind, suggestedName: req.suggestedName, bytes: req.bytes }),
  openScheduleFile: (): Promise<{ text: string } | null> => ipcRenderer.invoke(CH_SCHEDULE_FILE_OPEN)
}

contextBridge.exposeInMainWorld('sgvueSchedule', api)
