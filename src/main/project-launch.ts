/**
 * 2026-11-08 — the `.sgvue` project file, phase 5 (plan D10, owner-approved: *"Yes: register
 * `.sgvue` in both installers (macOS `open-file`, Windows argv), and the drop zone also takes a
 * `.sgvue`"*). How a project the **OS** hands the app reaches `projects.ts`'s one open function.
 *
 * · **macOS** delivers a double-clicked `.sgvue` — or one dropped on the Dock icon — through
 *   `open-file`, which can fire before `whenReady` when the double-click launched the app, and
 *   with no window at all when the app was running with every window closed.
 * · **Windows and Linux** start the app with the path in `argv` (the installer's
 *   `"SGVue.exe" "%1"`); when it is already running, the single-instance lock turns that into a
 *   `second-instance` event on the first one — whose window `deep-link.ts` already brings forward.
 *
 * Every route parks the path in `projects.ts` (`openProjectFromOS`), which opens it once the main
 * window's page is listening, through the same `openNow` File › Open Project… takes.
 * A `sgvue://` link in the same `argv` wins, as before: it is `deep-link.ts`'s, and a link and a
 * project would each replace what is open.
 */
import { app } from 'electron'
import { stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { isProjectFileName } from '../shared/project-drop'
import { linkFromArgv } from './deep-link'
import { openProjectFromOS } from './projects'

/**
 * The `.sgvue` paths in an `argv`, in order, made absolute against `cwd` with `platform`'s path
 * rules. Skipped: the executable (`argv[0]`), every switch (`-…`, Chromium's and Electron's own,
 * and `--sgvue-link=`), a `sgvue:` link, anything with a control character, and anything that does
 * not end in `.sgvue`. One pair of quotes round an argument is taken off — Windows' own parsing
 * normally has, but a shell or a shortcut can leave them.
 */
export function projectArgs(argv: readonly string[], cwd: string, platform: NodeJS.Platform): string[] {
  const rules = platform === 'win32' ? win32 : posix
  const out: string[] = []
  for (const raw of argv.slice(1)) {
    let arg = raw.trim()
    if (arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"')) arg = arg.slice(1, -1).trim()
    if (!arg || arg.startsWith('-') || /^sgvue:/i.test(arg)) continue
    if (/[\u0000-\u001f\u007f]/.test(arg) || !isProjectFileName(arg)) continue
    const path = rules.isAbsolute(arg) ? arg : rules.resolve(cwd, arg)
    if (!out.includes(path)) out.push(path)
  }
  return out
}

/** Whether a path is a regular file that is there — the one look `projectFromArgv` takes. */
const regularFile = (path: string): Promise<boolean> => stat(path).then((s) => s.isFile(), () => false)

/**
 * The project an `argv` asks for: the first of its `.sgvue` paths (`projectArgs`) that is a regular
 * file that exists — a missing file, a directory called `x.sgvue` and every later path are passed
 * over — or `null`. `null` too when the `argv` carries a `sgvue:` link, which is `deep-link.ts`'s.
 */
export async function projectFromArgv(
  argv: readonly string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  isFile: (path: string) => Promise<boolean> = regularFile
): Promise<string | null> {
  if (linkFromArgv(argv)) return null
  for (const path of projectArgs(argv, cwd, platform)) if (await isFile(path)) return path
  return null
}

/**
 * Wire the OS's routes. Called before `whenReady`, as `installDeepLinks` is: `open-file` on macOS
 * fires early for the double-click that launched the app, and must already have a listener.
 * `ensureWindow` opens the main window when there is none (macOS, every window closed) — called
 * only once the app is ready; before that, the window `whenReady` opens takes the project.
 */
export function installProjectLaunch(ensureWindow: () => void): void {
  app.on('open-file', (event, path) => {
    // Only a project is ours: anything else the OS sends is left as it is today.
    if (!isProjectFileName(path)) return
    event.preventDefault()
    openProjectFromOS(path)
    if (app.isReady()) ensureWindow()
  })
  app.on('second-instance', (_event, argv, workingDirectory) => {
    void projectFromArgv(argv, workingDirectory).then((path) => {
      if (path) openProjectFromOS(path)
    })
  })
  // The launch itself. A dev link (`SGVUE_LINK`) wins as an `argv` one does.
  if (process.env.SGVUE_LINK) return
  void projectFromArgv(process.argv, process.cwd()).then((path) => {
    if (path) openProjectFromOS(path)
  })
}
