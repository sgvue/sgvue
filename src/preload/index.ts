import { contextBridge, ipcRenderer, webUtils } from 'electron'
// From `shared/`, not from `main/gpu-guard.ts`: the guard itself imports `node:child_process`
// to read `phys_footprint`, and a sandboxed preload that pulls that in fails to load at all.
import { GPU_GUARD_CHANNEL, type GpuGuardTrip } from '../shared/gpu-guard-channel'
// Channel names only — `ipc-channels.ts` carries no zod, which a **sandboxed** preload
// cannot load (electron-vite externalises dependencies; `require("zod")` there takes the whole
// bridge down silently). The schemas run on the two sides that can run them.
import {
  CH_AI_EVENT,
  CH_AI_TOOL_EXEC,
  CH_AI_TOOL_RESULT,
  CH_AI_TURN_ABORT,
  CH_AI_TURN_START,
  CH_FILE_ADMIT,
  CH_FILE_CONFIRM_REPLACE,
  CH_FILE_OPEN,
  CH_FILE_TOKEN,
  CH_LINK_OPEN,
  CH_RECENTS_ADD,
  CH_RECENTS_LIST,
  CH_SCHEDULE_PORT,
  CH_SCHEDULES_OPEN,
  CH_SESSION_CLEAR,
  CH_SESSION_SAVE,
  CH_SETTINGS_CLEAR_KEY,
  CH_SETTINGS_GET,
  CH_SETTINGS_OPEN,
  CH_SETTINGS_SET,
  CH_SETTINGS_SET_KEY,
  CH_UPDATE_CHECK,
  CH_UPDATE_OPEN
} from '../shared/ipc-channels'
import type {
  AiEvent,
  AiToolExec,
  AiToolResult,
  AiTurnStart,
  LinkOpen,
  PickedFile,
  RecentAdd,
  RecentFile,
  SessionEnvelope,
  SettingsPatch,
  SettingsView,
  UpdateInfo
} from '../shared/ipc-contract'

// The renderer's entire view of the outside world. Its key names are pinned by
// tests/readonly-guard.test.ts — adding one is a deliberate, reviewed change.
const api = {
  platform: process.platform,
  versions: process.versions,
  /**
   * Main has seen the GPU helper process blow its budget and the viewer must stop drawing
   * now (`src/main/gpu-guard.ts`). One-way, main → renderer: nothing is sent back, and the
   * renderer cannot raise, lower or silence the limit. Returns an unsubscribe function.
   */
  onGpuGuardTripped: (fn: (info: GpuGuardTrip) => void): (() => void) => {
    const listener = (_event: unknown, info: GpuGuardTrip): void => fn(info)
    ipcRenderer.on(GPU_GUARD_CHANNEL, listener)
    return () => {
      ipcRenderer.off(GPU_GUARD_CHANNEL, listener)
    }
  },
  /**
   * Electron's native Open dialog, behind the design's own `upload` control and drop zone
   * (fidelity contract, allowed deviations). Returns the chosen files, already admitted.
   */
  openDialog: (): Promise<PickedFile[]> => ipcRenderer.invoke(CH_FILE_OPEN),
  /**
   * "These paths came from a drop, the recents list, a session or a share link." Main applies
   * the same checks the dialog path gets and returns only what passed, so the caller learns
   * which files have moved from what is missing.
   */
  admitPaths: (paths: readonly string[]): Promise<PickedFile[]> =>
    ipcRenderer.invoke(CH_FILE_ADMIT, { paths: [...paths] }),
  /**
   * A dropped `File` has no `path` in a sandboxed renderer. `webUtils.getPathForFile` is the
   * supported replacement, and it works only here, in the preload.
   */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** A single-use `sgvue-file://` URL for one admitted path (`main/file-protocol.ts`). */
  fileUrl: (path: string): Promise<{ url: string }> => ipcRenderer.invoke(CH_FILE_TOKEN, { path }),
  /**
   * 2026-09-24 — `"<name>" is already open. Replace it?`, as a native message box. `true`
   * for Replace. It carries a file name and answers yes or no; it reaches no file.
   */
  confirmReplace: (name: string): Promise<boolean> =>
    ipcRenderer.invoke(CH_FILE_CONFIRM_REPLACE, { name }),

  saveSession: (envelope: SessionEnvelope): Promise<void> =>
    ipcRenderer.invoke(CH_SESSION_SAVE, envelope),
  clearSession: (): Promise<void> => ipcRenderer.invoke(CH_SESSION_CLEAR),

  listRecents: (): Promise<RecentFile[]> => ipcRenderer.invoke(CH_RECENTS_LIST),
  addRecent: (file: RecentAdd): Promise<RecentFile[]> => ipcRenderer.invoke(CH_RECENTS_ADD, file),

  /** A `sgvue://s=…` link the OS handed the app. One way, main → renderer. */
  onDeepLink: (fn: (info: LinkOpen) => void): (() => void) => {
    const listener = (_event: unknown, info: LinkOpen): void => fn(info)
    ipcRenderer.on(CH_LINK_OPEN, listener)
    return () => {
      ipcRenderer.off(CH_LINK_OPEN, listener)
    }
  },

  /**
   * One assistant turn. The Anthropic SDK and the API key live in main and nothing about
   * either crosses this bridge: the renderer sends what it wants asked and receives events.
   */
  aiTurn: (request: AiTurnStart): Promise<void> => ipcRenderer.invoke(CH_AI_TURN_START, request),
  aiAbort: (turnId: string): Promise<void> => ipcRenderer.invoke(CH_AI_TURN_ABORT, { turnId }),
  onAiEvent: (fn: (event: AiEvent) => void): (() => void) => {
    const listener = (_event: unknown, payload: AiEvent): void => fn(payload)
    ipcRenderer.on(CH_AI_EVENT, listener)
    return () => {
      ipcRenderer.off(CH_AI_EVENT, listener)
    }
  },
  /**
   * Main asks the renderer to run a tool, because main never holds model data. The renderer
   * executes it against the frozen index and answers with `aiToolResult`.
   */
  onAiToolExec: (fn: (call: AiToolExec) => void): (() => void) => {
    const listener = (_event: unknown, call: AiToolExec): void => fn(call)
    ipcRenderer.on(CH_AI_TOOL_EXEC, listener)
    return () => {
      ipcRenderer.off(CH_AI_TOOL_EXEC, listener)
    }
  },
  aiToolResult: (result: AiToolResult): void => {
    ipcRenderer.send(CH_AI_TOOL_RESULT, result)
  },

  /** Settings, minus the API key: the renderer only ever learns `hasKey`. */
  getSettings: (): Promise<SettingsView> => ipcRenderer.invoke(CH_SETTINGS_GET),
  setSettings: (patch: SettingsPatch): Promise<SettingsView> =>
    ipcRenderer.invoke(CH_SETTINGS_SET, patch),
  /** Write-only. There is no reader: the key is encrypted at rest and used only in main. */
  setApiKey: (key: string): Promise<SettingsView> => ipcRenderer.invoke(CH_SETTINGS_SET_KEY, { key }),
  clearApiKey: (): Promise<SettingsView> => ipcRenderer.invoke(CH_SETTINGS_CLEAR_KEY),
  /** The native menu's Preferences… (⌘,). One way, main → renderer. */
  onOpenSettings: (fn: () => void): (() => void) => {
    const listener = (): void => fn()
    ipcRenderer.on(CH_SETTINGS_OPEN, listener)
    return () => {
      ipcRenderer.off(CH_SETTINGS_OPEN, listener)
    }
  },
  /**
   * 2026-09-25 — the toolbar's Schedules button: open the Schedules window, or bring it
   * forward. No payload, nothing back. What the two windows then say to each other goes over
   * a private port (below), never through main.
   */
  openSchedules: (): Promise<void> => ipcRenderer.invoke(CH_SCHEDULES_OPEN),
  /**
   * 2026-10-01 — the landing page's update notice. Main asks GitHub for the newest version at
   * most once per run (`main/updates.ts`; never in a development build) and answers `{ latest }`
   * when it is newer than this build, else `null`. Nothing goes in.
   */
  checkUpdate: (): Promise<UpdateInfo | null> => ipcRenderer.invoke(CH_UPDATE_CHECK),
  /**
   * The notice's button: open the download page in the user's browser. No payload — main
   * builds the URL from its own constant and version, so no URL crosses this bridge.
   */
  openUpdatePage: (): Promise<void> => ipcRenderer.invoke(CH_UPDATE_OPEN)
}

contextBridge.exposeInMainWorld('sgvue', api)

// The Schedules window's private port. A `MessagePort` cannot cross `contextBridge`, so it is
// re-posted into the page, where `renderer/model/schedule-link.ts` takes it — Electron's own
// documented pattern for a context-isolated page. No port means the Schedules window closed.
ipcRenderer.on(CH_SCHEDULE_PORT, (event) => {
  window.postMessage(CH_SCHEDULE_PORT, '*', event.ports)
})

export type SGVueApi = typeof api
