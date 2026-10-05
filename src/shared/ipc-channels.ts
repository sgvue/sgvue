/**
 * The channel names, and nothing else.
 *
 * They are split out of `ipc-contract.ts` because the **preload is sandboxed**: electron-vite
 * externalises `dependencies` for main and preload, so a preload that imports `zod` — even
 * only for a type — emits `require("zod")` and fails to load altogether, taking
 * `window.sgvue` with it and leaving the renderer with no bridge and no error. Measured,
 * Phase 8. The preload imports this file; the schemas stay on the two sides that can run them.
 */
export const CH_FILE_OPEN = 'file:open'
export const CH_FILE_ADMIT = 'file:admit'
export const CH_FILE_TOKEN = 'file:token'
/**
 * 2026-09-24 — after boot, "this file is already open; replace it?" as a native message box.
 * OS chrome, like the Open dialog: no designed surface changes. Answers `true` for Replace.
 */
export const CH_FILE_CONFIRM_REPLACE = 'file:confirmReplace'
export const CH_SESSION_SAVE = 'session:save'
export const CH_SESSION_CLEAR = 'session:clear'
export const CH_RECENTS_LIST = 'recents:list'
export const CH_RECENTS_ADD = 'recents:add'
export const CH_LINK_OPEN = 'link:open'

/* ────────────────────────────── the assistant (Phase 9a) ────────────────────────────── */

/** Renderer → main: run one turn. Resolves when the turn is over. */
export const CH_AI_TURN_START = 'ai:turn:start'
/** Renderer → main: stop the turn that is running. */
export const CH_AI_TURN_ABORT = 'ai:turn:abort'
/** Main → renderer: the turn's event stream (`text_delta`, `tool_start`, `usage`, …). */
export const CH_AI_EVENT = 'ai:event'
/**
 * Main → renderer: execute one tool call. **Main never holds model data** — every tool runs
 * in the renderer, against the frozen index, the SQL worker and the view store, and only its
 * JSON result comes back.
 */
export const CH_AI_TOOL_EXEC = 'ai:tool:exec'
/** Renderer → main: that tool's result, or its failure. */
export const CH_AI_TOOL_RESULT = 'ai:tool:result'

/* ────────────────────────────── settings (Phase 9a) ────────────────────────────── */

/** Everything except the API key, which never crosses this boundary — only `hasKey`. */
export const CH_SETTINGS_GET = 'settings:get'
export const CH_SETTINGS_SET = 'settings:set'
/** Write-only: the key goes in, encrypted by `safeStorage`, and never comes back out. */
export const CH_SETTINGS_SET_KEY = 'settings:setKey'
export const CH_SETTINGS_CLEAR_KEY = 'settings:clearKey'
/** Main → renderer: the native menu's Preferences… item was chosen. */
export const CH_SETTINGS_OPEN = 'settings:open'

/* ────────────────────────────── the Schedules window (2026-09-25) ────────────────────────────── */

/** Main window → main: open the Schedules window, or bring it forward. No payload. */
export const CH_SCHEDULES_OPEN = 'schedules:open'
/**
 * Main → each window: one end of the private `MessagePort` joining the main window and the
 * Schedules window (`webContents.postMessage`). Each preload re-posts it into its page under
 * this same name — a port cannot cross `contextBridge`. Sent with **no** port, it tells the
 * main window the Schedules window has closed.
 */
export const CH_SCHEDULE_PORT = 'schedule:port'

/* ────────────────────────────── Schedules files (2026-09-25, phase 4) ────────────────────────────── */

/**
 * Schedules window → main: show the native Save dialog, and write these bytes where the user
 * chose (`main/exports.ts`, the third writer). Answered for the Schedules window only.
 */
export const CH_EXPORT_SAVE = 'export:save'
/**
 * Schedules window → main: the native Open dialog for a `.schedule.json`; its text, at most
 * 1 MB, or `null` when cancelled. A read, not a write. Answered for the Schedules window only.
 */
export const CH_SCHEDULE_FILE_OPEN = 'scheduleFile:open'

/* ────────────────────────────── the update notice (2026-10-01) ────────────────────────────── */

/**
 * Main window → main: is a newer version out? Answers `{ latest }` or `null`. No payload; main
 * asks GitHub at most once per run (`main/updates.ts`). Answered for the main window only.
 */
export const CH_UPDATE_CHECK = 'update:check'
/**
 * Main window → main: open the download page in the user's browser. No payload — main builds
 * the URL itself (`main/about.ts`, `updatesUrl`). Answered for the main window only.
 */
export const CH_UPDATE_OPEN = 'update:open'

/**
 * Every channel main registers a handler for, for `SYSTEM_SPEC.md` §10 and the guard test.
 * The main → renderer sends (`link:open`, `ai:event`, `ai:tool:exec`, `settings:open`,
 * `schedule:port`) have no handler and are not here.
 */
export const IPC_CHANNELS = [
  CH_FILE_OPEN,
  CH_FILE_ADMIT,
  CH_FILE_TOKEN,
  CH_FILE_CONFIRM_REPLACE,
  CH_SESSION_SAVE,
  CH_SESSION_CLEAR,
  CH_RECENTS_LIST,
  CH_RECENTS_ADD,
  CH_AI_TURN_START,
  CH_AI_TURN_ABORT,
  CH_AI_TOOL_RESULT,
  CH_SETTINGS_GET,
  CH_SETTINGS_SET,
  CH_SETTINGS_SET_KEY,
  CH_SETTINGS_CLEAR_KEY,
  CH_SCHEDULES_OPEN,
  CH_EXPORT_SAVE,
  CH_SCHEDULE_FILE_OPEN,
  CH_UPDATE_CHECK,
  CH_UPDATE_OPEN
] as const
