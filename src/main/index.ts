import { app, ipcMain, shell, session, protocol, BrowserWindow, type WebContents } from 'electron'
import { execFileSync } from 'node:child_process'
import { uptime } from 'node:os'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { watchGpu } from './gpu-guard'
import {
  admitWithRefusals,
  isAdmitted,
  isRemotePath,
  mint,
  registerFileProtocol,
  SCHEME
} from './file-protocol'
import { flushPendingLink, installDeepLinks, launchHash, takeLaunchLink } from './deep-link'
import { addRecent, clearSession, listRecents, saveSession } from './sessions'
import {
  clearApiKey,
  gpuSwitchFailed,
  preferNvidia,
  setApiKey,
  setGpuSwitchFailed,
  update as updateSettings,
  view as settingsView
} from './settings'
import {
  activeGraphics,
  chooseAdapter,
  isOnAdapter,
  luidSwitch,
  parseDirectXAdapters,
  planGpu,
  shouldRecordGpuCrash,
  type DxAdapter,
  type GpuInfoLike
} from './gpu-choice'
import { registerAiIpc } from './ai/session'
import { installMenu } from './menu'
import { lockNavigation, mainWindow, messageBox, openDialog, setMainWindow } from './window'
import { closeSchedules, connectSchedules, openSchedules, schedulesWindow } from './schedules-window'
import { openScheduleFile, saveExport } from './exports'
import { updatesUrl } from './about'
import { checkForUpdate } from './updates'
import {
  AdmitRequest,
  ApiKeyPayload,
  CH_EXPORT_SAVE,
  CH_SCHEDULE_FILE_OPEN,
  CH_UPDATE_CHECK,
  CH_UPDATE_OPEN,
  ExportSaveRequest,
  ScheduleFileOpenRequest,
  UpdateCheckRequest,
  UpdateOpenRequest,
  CH_FILE_ADMIT,
  CH_FILE_CONFIRM_REPLACE,
  CH_FILE_OPEN,
  CH_FILE_TOKEN,
  CH_RECENTS_ADD,
  CH_RECENTS_LIST,
  CH_SESSION_CLEAR,
  CH_SESSION_SAVE,
  CH_SETTINGS_CLEAR_KEY,
  CH_SETTINGS_GET,
  CH_SETTINGS_SET,
  CH_SETTINGS_SET_KEY,
  ConfirmReplaceRequest,
  CH_SCHEDULES_OPEN,
  RecentAdd,
  SchedulesOpenRequest,
  SessionEnvelope,
  TokenRequest
} from '../shared/ipc-contract'

// Privileged scheme for read-only model streaming. Must be registered before `whenReady`;
// the handler itself is `file-protocol.ts`, installed after it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    // `corsEnabled` is what lets the `file://` renderer fetch this scheme at all: without
    // it Chromium refuses before the handler is ever called (`docs/DECISIONS.md`, 2026-09-16).
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

// Sandbox every renderer (plan §3.2).
app.enableSandbox()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    // False on purpose: the one place Preferences… lives is the application menu
    // (fidelity contract, allowed deviations), and an auto-hidden bar on Windows would
    // leave it reachable only by a shortcut nothing advertises.
    autoHideMenuBar: false,
    backgroundColor: '#0F1516', // --ground (dark), so the window never flashes white
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false
    }
  })

  // Named, not found: since 2026-09-25 the Schedules window can exist too (`window.ts`).
  setMainWindow(win)
  win.on('closed', () => {
    setMainWindow(null)
    closeSchedules()
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // A link the OS delivered before the window existed is sent once the renderer can hear it.
  // A reload also drops the page's end of the Schedules port, so a new pair is made.
  win.webContents.on('did-finish-load', () => {
    flushPendingLink()
    connectSchedules()
  })

  // The GPU process is up by now: say which adapter is drawing, against the one asked for.
  const asked = gpuAsked
  if (asked) {
    win.webContents.once('did-finish-load', () => {
      void app.getGPUInfo('complete').then((raw) => {
        const info = raw as GpuInfoLike
        const line = `[gpu] drawing on ${activeGraphics(info) ?? 'an unknown adapter'} (asked for ${asked.description})`
        if (isOnAdapter(info, asked)) console.log(line)
        else console.warn(`${line} — NOT the adapter asked for`)
      })
    })
  }

  // Watch the GPU helper process; see `gpu-guard.ts` for why this exists at all.
  watchGpu(win.webContents)

  // The window stays on the app's page; external links open in the OS browser, and no page
  // opens a window of its own (`window.ts`) — the Schedules window is opened by main alone.
  lockNavigation(win.webContents, (url) => void shell.openExternal(url))

  // A link the app was launched with travels in the renderer's own hash, exactly as the
  // design reads it (`SGVue.dc.html:866`) — and **only its payload does**. `launchHash` keeps
  // `s=<code>` and drops everything else a link may carry, because the hash is also where the
  // dev build's own switches live. Links that arrive later come over IPC.
  const hash = launchHash(takeLaunchLink())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    void win.loadFile(
      join(__dirname, '../renderer/index.html'),
      hash ? { hash } : undefined
    )
  }
}

/**
 * Every channel the renderer may reach (`shared/ipc-contract.ts`). Each request is validated
 * here with its zod schema — the preload carries channel names only and validates nothing —
 * because the preload runs in the renderer's process and a compromised renderer is what the
 * sandbox exists for.
 */
function registerIpc(): void {
  ipcMain.handle(CH_FILE_OPEN, async (event) => {
    // A native dialog cannot be driven by an automated test, so a development build accepts
    // the chooser's answer from the environment instead. `app.isPackaged` is the gate: a
    // shipped build has no such path, and `tests/e2e` and the big-model harness use it to
    // exercise the real admit → token → protocol stream chain end to end.
    // 2026-10-09: both channels answer the files admitted and those refused with the drop zone's
    // own reason (`AdmitResult`), so a file over 600 MB picked here gets the designed row.
    const injected = !app.isPackaged && process.env.SGVUE_OPEN_PATHS
    if (injected) return admitWithRefusals(injected.split(':::').filter(Boolean), 'any')
    const result = await openDialog(BrowserWindow.fromWebContents(event.sender), OPEN_OPTIONS)
    if (result.canceled) return { files: [], refused: [] }
    // The user browsed there, so a network path is theirs to open (`file-protocol.ts`).
    return admitWithRefusals(result.filePaths, 'any')
  })

  // A network path passes here only if it is already on the user's own recents list.
  ipcMain.handle(CH_FILE_ADMIT, async (_event, raw: unknown) => {
    const { paths } = AdmitRequest.parse(raw)
    return admitWithRefusals(paths, new Set((await listRecents()).map((r) => r.path)))
  })

  // 2026-09-24 — after boot, a pick whose model is already open or loading is confirmed here,
  // in the OS's own message box attached to the window. Resolves `true` for Replace.
  ipcMain.handle(CH_FILE_CONFIRM_REPLACE, async (event, raw: unknown) => {
    const { name } = ConfirmReplaceRequest.parse(raw)
    const options = {
      type: 'question' as const,
      title: 'Replace model?',
      message: `"${name}" is already open.`,
      detail: 'Replace it with the file you just picked?',
      buttons: ['Replace', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }
    const { response } = await messageBox(BrowserWindow.fromWebContents(event.sender), options)
    return response === 0
  })

  ipcMain.handle(CH_FILE_TOKEN, (_event, raw: unknown) => {
    const url = mint(TokenRequest.parse(raw).path)
    // A path that was never admitted gets no URL and no explanation.
    if (!url) throw new Error('not available')
    return { url }
  })

  ipcMain.handle(CH_SESSION_SAVE, (_event, raw: unknown) =>
    saveSession(SessionEnvelope.parse(raw))
  )
  ipcMain.handle(CH_SESSION_CLEAR, () => clearSession())

  ipcMain.handle(CH_RECENTS_LIST, () => listRecents())
  ipcMain.handle(CH_RECENTS_ADD, (_event, raw: unknown) => {
    const file = RecentAdd.parse(raw)
    // `file:admit` trusts this list for network paths, so a network path joins it only once
    // the user has admitted it — a renderer cannot launder one in by naming it here.
    if (isRemotePath(file.path) && !isAdmitted(file.path)) return listRecents()
    return addRecent(file)
  })

  // Settings. `settingsView()` is the whole of what the renderer may learn — the API key is
  // encrypted in `userData/settings.json` and read only by `ai/session.ts`, in this process.
  ipcMain.handle(CH_SETTINGS_GET, () => settingsView())
  ipcMain.handle(CH_SETTINGS_SET, (_event, raw: unknown) => updateSettings(raw))
  ipcMain.handle(CH_SETTINGS_SET_KEY, (_event, raw: unknown) =>
    setApiKey(ApiKeyPayload.parse(raw).key)
  )
  ipcMain.handle(CH_SETTINGS_CLEAR_KEY, () => clearApiKey())

  // 2026-09-25 — the toolbar's Schedules button. No payload, and only the main window may ask.
  ipcMain.handle(CH_SCHEDULES_OPEN, (event, raw: unknown) => {
    SchedulesOpenRequest.parse(raw)
    if (event.sender !== mainWindow()?.webContents) return
    openSchedules()
  })

  // 2026-09-25, phase 4 — the Schedules window's two file channels. Only that window may ask:
  // the main window's preload carries neither name, and a sender that is not the Schedules
  // window is refused here before its payload is read.
  ipcMain.handle(CH_EXPORT_SAVE, (event, raw: unknown) =>
    saveExport(fromSchedules(event.sender), ExportSaveRequest.parse(raw))
  )
  ipcMain.handle(CH_SCHEDULE_FILE_OPEN, (event, raw: unknown) => {
    const win = fromSchedules(event.sender)
    ScheduleFileOpenRequest.parse(raw)
    return openScheduleFile(win)
  })

  // 2026-10-01 — the landing page's update notice. Neither takes a payload, and only the main
  // window may ask. The check is one request per run, and none at all in a development build
  // (`updates.ts`); the page opened is the one Help › Check for updates… opens, built here —
  // the renderer never supplies a URL.
  ipcMain.handle(CH_UPDATE_CHECK, (event, raw: unknown) => {
    UpdateCheckRequest.parse(raw)
    if (event.sender !== mainWindow()?.webContents) return null
    return checkForUpdate(__APP_VERSION__)
  })
  ipcMain.handle(CH_UPDATE_OPEN, (event, raw: unknown) => {
    UpdateOpenRequest.parse(raw)
    if (event.sender !== mainWindow()?.webContents) return
    void shell.openExternal(updatesUrl(__APP_VERSION__))
  })

  registerAiIpc()
}

/** The Schedules window, when it is the sender; anything else gets no answer and no reason. */
function fromSchedules(sender: WebContents): BrowserWindow {
  const win = schedulesWindow()
  if (!win || sender !== win.webContents) throw new Error('not available')
  return win
}

/**
 * 2026-09-25 — Windows only, and only while Preferences' *Prefer NVIDIA graphics when available*
 * is on: run on the adapter `chooseAdapter` names (NVIDIA, else AMD) by appending Chromium's
 * `--use-adapter-luid`. Called before `ready`, because the GPU process reads its switches once.
 * The LUID is read fresh at every launch — it changes at every boot (`gpu-choice.ts`) — with one
 * bounded `reg query` (~40 ms); anything that fails leaves the choice to Windows. A development
 * build takes `SGVUE_GPU_VENDOR=<hex vendor id>` to put that vendor first, which is how the
 * guarded runs prove the switch moves the app both ways. Returns the adapter asked for.
 *
 * A GPU process that crashed on an earlier launch with this adapter asked for is recorded in
 * settings (`watchGpuCrash`), and then nothing is asked (`planGpu`) until Preferences' checkbox is
 * toggled or the adapter changes.
 */
function chooseGpu(): DxAdapter | null {
  if (process.platform !== 'win32' || !preferNvidia()) return null
  let text = ''
  try {
    const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
    text = execFileSync(reg, ['query', 'HKLM\\SOFTWARE\\Microsoft\\DirectX', '/s'], {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true
    })
  } catch {
    return null
  }
  const first = app.isPackaged ? NaN : parseInt(process.env.SGVUE_GPU_VENDOR ?? '', 16)
  const bootMs = Date.now() - uptime() * 1000
  const pick = chooseAdapter(parseDirectXAdapters(text), bootMs, Number.isFinite(first) ? first : undefined)
  const failure = gpuSwitchFailed()
  const plan = planGpu(pick, failure)
  if (plan.clear) setGpuSwitchFailed(null)
  if (pick && failure && !plan.ask) {
    console.warn(
      `[gpu] not asking for ${pick.description}: the GPU process failed with it on ` +
        `${new Date(failure.at).toISOString()}. Windows decides until Preferences' ` +
        '"Prefer NVIDIA graphics when available" is turned off and on again.'
    )
  }
  const value = pick && plan.ask ? luidSwitch(pick.luid) : null
  if (!pick || !value) return null
  app.commandLine.appendSwitch('use-adapter-luid', value)
  return pick
}

/**
 * 2026-09-25 — when this launch asked for an adapter and the GPU process then fails
 * (`isGpuCrash`) while the app runs, record it once, so the next launch asks for nothing
 * (`planGpu`). Not while it quits: a fault in driver teardown is not the adapter failing
 * (`shouldRecordGpuCrash`). No relaunch: Chromium restarts its own GPU process, and this launch
 * carries on as it can.
 */
function watchGpuCrash(asked: DxAdapter): void {
  let recorded = false
  let quitting = false
  app.once('before-quit', () => {
    quitting = true
  })
  app.on('child-process-gone', (_event, details) => {
    if (!shouldRecordGpuCrash({ quitting, recorded, details })) return
    recorded = true
    setGpuSwitchFailed({ at: Date.now(), vendorId: asked.vendorId, deviceId: asked.deviceId })
    console.warn(
      `[gpu] the GPU process ended (${details.reason}, exit ${details.exitCode}) while asked for ` +
        `${asked.description}; the next launch leaves the choice to Windows`
    )
  })
}

/** The adapter `chooseGpu` asked for, or `null` when Windows decides. Set before `ready`. */
let gpuAsked: DxAdapter | null = null

/**
 * The designed drop zone and `upload` control open this. `.ifcxml` is in the filter because
 * the design's own `accept` lists it; it is refused after the fact, by name, rather than
 * being hidden from a person who was told it was accepted.
 */
const OPEN_OPTIONS = {
  title: 'Open IFC model',
  buttonLabel: 'Open',
  properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
  filters: [
    { name: 'IFC models', extensions: ['ifc', 'ifczip'] },
    { name: 'All files', extensions: ['*'] }
  ]
}

// Windows delivers a share link by launching a second process; the lock turns that into a
// `second-instance` event on the first one (`deep-link.ts`). Electron's own if/else, because
// the instance that loses the lock must do *nothing* else: without the `else` it went on to
// register the protocol client, the file protocol, the IPC and the menu and to open a window,
// and was measured starting a `gpu-process`, a `utility` and a `renderer` child before it
// exited. `installDeepLinks()` still runs before `whenReady` — macOS `open-url` fires early.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  installDeepLinks()
  gpuAsked = chooseGpu()
  if (gpuAsked) watchGpuCrash(gpuAsked)

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.sgvue.viewer')

    // Deny every permission request: a viewer needs no camera, microphone, location or
    // notifications (plan §3.2).
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false)
    )

    // Share links (`sgvue://s=…`). Only meaningful for an installed app: claiming the scheme
    // from a dev checkout would take it away from the installed one. `--sgvue-link=` feeds the
    // same path in development (`deep-link.ts`).
    if (app.isPackaged) app.setAsDefaultProtocolClient('sgvue')

    registerFileProtocol()
    registerIpc()
    installMenu()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', () => {
      if (!mainWindow()) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
