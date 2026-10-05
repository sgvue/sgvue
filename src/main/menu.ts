/**
 * The application menu.
 *
 * It exists for one item. The fidelity contract's allowed deviations put the settings the
 * design has no surface for — API key, model, effort, renderer backend, "Data sent to AI" —
 * behind **Preferences… (⌘,)**, because adding them to a designed surface is forbidden and a
 * desktop app needs somewhere to put them. Everything else here is the platform's own roles,
 * so the window behaves like a Mac or Windows application rather than a web page in a frame.
 *
 * `autoHideMenuBar` is false on the window (`index.ts`): on Windows an auto-hidden bar means
 * the only way to reach Preferences is a shortcut nothing advertises.
 */
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { CH_SETTINGS_OPEN } from '../shared/ipc-channels'
import { aboutBoxOptions, aboutPanelOptions, updatesUrl } from './about'
import { activeGraphics, type GpuInfoLike } from './gpu-choice'
import { openSchedules } from './schedules-window'
import { messageBox, targetWindow } from './window'

const isMac = process.platform === 'darwin'

/** Ask the main window to show the Preferences dialog. It is drawn by the renderer. */
function openPreferences(): void {
  targetWindow()?.webContents.send(CH_SETTINGS_OPEN)
}

/**
 * Help › About, with the owner's story (`about.ts`). macOS shows it in the native About panel,
 * whose `credits` field is the story. On Windows Electron's own panel is a synchronous,
 * unparented message box that blocks the main process while it is open, so there — and on
 * Linux, whose panel shows nothing unless told — it is a native message box on the window.
 * The options are set on every open, so they can never go stale. The box ends with the
 * adapter actually drawing (2026-09-25), read from the GPU process when the box opens.
 */
function showAbout(): void {
  const version = __APP_VERSION__
  if (isMac) {
    app.setAboutPanelOptions(aboutPanelOptions(version))
    app.showAboutPanel()
    return
  }
  void app
    .getGPUInfo('complete')
    .then((info) => activeGraphics(info as GpuInfoLike))
    .catch(() => null)
    .then((graphics) => messageBox(targetWindow(), aboutBoxOptions(version, graphics)))
}

function buildMenu(): Menu {
  const preferences: MenuItemConstructorOptions = {
    label: 'Preferences…',
    accelerator: 'CmdOrCtrl+,',
    click: () => openPreferences()
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              preferences,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        ...(isMac ? [] : ([preferences, { type: 'separator' }] as MenuItemConstructorOptions[])),
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'copy' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' as const }] : []),
        { type: 'separator' },
        {
          // 2026-09-25 — the Schedules window, as the toolbar's button opens it. ⇧⌘T: no
          // single-key shortcut in `renderer/state/keys.ts` reads T, and it is no OS default.
          label: 'Schedules',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => openSchedules()
        }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          // The name, the version and the owner's story (2026-09-24). It used to open
          // `https://github.com/`, a placeholder that pointed nowhere.
          label: 'About SGVue',
          click: () => showAbout()
        },
        {
          // 2026-09-25 — a manual update check, in the user's own browser; since 2026-09-28 the
          // product site, told this version (`?v=`). The build-time version, as About's: in a
          // dev or e2e launch `app.getVersion()` reports Electron's own. The item downloads
          // nothing and makes no network call; the base URL is a constant.
          label: 'Check for updates…',
          click: () => void shell.openExternal(updatesUrl(__APP_VERSION__))
        }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}

export function installMenu(): void {
  // The macOS app menu's own `role: 'about'` item opens the same panel.
  if (isMac) app.setAboutPanelOptions(aboutPanelOptions(__APP_VERSION__))
  Menu.setApplicationMenu(buildMenu())
}
