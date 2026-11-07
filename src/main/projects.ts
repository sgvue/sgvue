/**
 * The `.sgvue` project file on disk — **the fourth module allowed to write to disk** (2026-11-07,
 * `docs/plans/project-file.md` D11, owner-approved: *"Approve the recommended defaults for both
 * plans. go with .sgvue"*). `settings.ts`, `sessions.ts` and `exports.ts` are the other three;
 * `tests/readonly-guard.test.ts` holds the list at four.
 *
 * **What it writes, and where.** One project file, and only to
 *   · the path `dialog.showSaveDialog` returned **in the same call** — Save Project As…, or Save
 *     Project while no project is open yet; or
 *   · the `.sgvue` file this run opened or last saved (`state.path`) — Save Project (⌘S / Ctrl+S)
 *     re-saves it without a dialog, the one stretch of `exports.ts`'s rule (D11).
 * The page never names a path and never asks for a write: main **pulls** the project from it
 * (`project:snapshotRequest` → `project:snapshot`), keeps the current path itself, and reads the
 * text again with `readProject` before a byte is written — so whatever the page sends, only a
 * project file can land on disk. `relPath` is worked out here, against the real folder of the
 * path being written. UTF-8, at most `PROJECT_MAX_BYTES`, the extension forced to `.sgvue`, and
 * atomically — a uniquely named temporary file beside the target, then one `rename` — as
 * `exports.ts` writes.
 *
 * **What it reads.** Open Project… is the native Open dialog, filtered to `.sgvue`, then at most
 * `PROJECT_MAX_BYTES` of the file picked, as text, once — a read like `scheduleFile:open`, not an
 * `admit()`. The models the project names are a different matter: **each path goes through
 * `admit()`** (`file-protocol.ts`) before the page hears of it, and the page is handed only what
 * `admit()` returns — so a path from the file is never opened as such. Opening the project is the
 * user's act that admits them, with one bound: a network path (`\\server\share\…`) is let through
 * only on the share the project file itself was opened from, or where the user has been already
 * (their recents, a path admitted earlier this run) — a project file someone sent cannot make the
 * app knock on a host the user never chose.
 *
 * **Unsaved changes** (D8). The page says whether the open project has changes (`project:dirty`);
 * the window title is `<name> • — SGVue` while it has, `<name> — SGVue` while it has not — on
 * macOS also the title bar's proxy icon and the close button's dot, the platform's own marks — and
 * closing the window, quitting or opening another project asks — Save · Don't Save · Cancel — in a
 * native message box. With no project open nothing here does anything: no title, no question.
 */
import { app, dialog, type BrowserWindow, type WebContents } from 'electron'
import { randomBytes } from 'node:crypto'
import { open, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  CH_PROJECT_OPENED,
  CH_PROJECT_SAVED,
  CH_PROJECT_SNAPSHOT_REQUEST
} from '../shared/ipc-channels'
import {
  ProjectClose,
  ProjectDirty,
  ProjectSnapshot,
  type ProjectNothing,
  type ProjectModelFile,
  type ProjectOpened,
  type RefusedFile
} from '../shared/ipc-contract'
import {
  PROJECT_MAX_BYTES,
  projectText,
  readProject,
  relPathOf,
  resolveRelPath,
  type ProjectFile
} from '../shared/project-file'
import { admit, isRemotePath } from './file-protocol'
import { listRecents } from './sessions'
import { mainContents, mainWindow, messageBox, openDialog } from './window'

export const PROJECT_EXT = 'sgvue'
/** How long main waits for the page's snapshot before it gives the save up. */
export const SNAPSHOT_MS = 10_000
/** The app's own name in the window title. */
const APP_TITLE = 'SGVue'

/* ────────────────────────────── pure rules ────────────────────────────── */

/** `path` ending in `.sgvue`, whatever the user typed: `tower` → `tower.sgvue`, `a.json` → `a.json.sgvue`. */
export function withProjectExtension(path: string): string {
  return path.toLowerCase().endsWith(`.${PROJECT_EXT}`) ? path : `${path}.${PROJECT_EXT}`
}

/** The project's name, for the title and the questions: the file's name without `.sgvue`. */
export function projectNameOf(path: string): string {
  const name = basename(path.replace(/\\/g, '/'))
  return name.toLowerCase().endsWith(`.${PROJECT_EXT}`) ? name.slice(0, -PROJECT_EXT.length - 1) : name
}

/** The window title while a project is open: `<name> — SGVue`, with ` •` after the name while unsaved. */
export const projectTitle = (name: string, dirty: boolean): string =>
  `${name}${dirty ? ' •' : ''} — ${APP_TITLE}`

/** Where Save writes: the project this run opened or saved, unless Save As — or none is open yet. */
export const saveTarget = (as: boolean, current: string | null): 'current' | 'dialog' =>
  !as && current !== null ? 'current' : 'dialog'

export type CloseAction = 'close' | 'ask' | 'wait'

/**
 * What a request to close the main window — or to quit — does. `close`: let it (no project, or no
 * unsaved changes, or the user has already answered). `ask`: hold it and ask. `wait`: hold it and
 * do nothing — a question or a save is already under way.
 */
export function closeAction(s: { open: boolean; dirty: boolean; busy: boolean; allowed: boolean }): CloseAction {
  if (s.allowed || !s.open || !s.dirty) return 'close'
  return s.busy ? 'wait' : 'ask'
}

/** The question's buttons, in order; `Cancel` is also what Escape answers. */
export const UNSAVED_BUTTONS = ['Save', "Don't Save", 'Cancel'] as const
export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/** The button the user pressed, as a choice. Anything unexpected is Cancel: nothing is lost. */
export const unsavedChoice = (response: number): UnsavedChoice =>
  response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'

/** `\\server\share`, lower case, of a network path — or `null` for any other. */
function shareOf(path: string): string | null {
  const m = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(path)
  return m ? `\\\\${m[1]}\\${m[2]}`.toLowerCase() : null
}

/**
 * Whether a network path a project names may be let through: only when it is on the share the
 * project file itself came from (`project`, its real path). A local project naming
 * `\\host\x.ifc`, or a project on one share naming another, is refused before the path is touched.
 */
export function onProjectShare(project: string, candidate: string): boolean {
  if (!isRemotePath(candidate)) return false
  const a = shareOf(project)
  return a !== null && a === shareOf(candidate)
}

/** Where to look for a model, in order: `relPath` against the project's folder, then `absPath`. */
export function modelCandidates(
  projectPath: string,
  realProjectPath: string,
  m: { relPath: string | null; absPath: string }
): string[] {
  const out: string[] = []
  const add = (p: string | null): void => {
    if (p && !out.includes(p)) out.push(p)
  }
  if (m.relPath !== null) {
    add(resolveRelPath(projectPath, m.relPath))
    add(resolveRelPath(realProjectPath, m.relPath))
  }
  add(m.absPath)
  return out
}

/** What became of one save. */
export type SaveOutcome =
  | { kind: 'saved' }
  /** The user cancelled the Save dialog, or the question about replacing a file. */
  | { kind: 'cancelled' }
  /** The write failed; the error box has already said so. */
  | { kind: 'failed' }
  /** The page had nothing to save, and why — or gave no answer in time. */
  | { kind: 'nothing'; reason: ProjectNothing | 'no-answer' }

/** The one line the error box gives for each reason a save had nothing to write. */
export const NOTHING_REASON: Record<Exclude<ProjectNothing, 'no-models'> | 'no-answer', string> = {
  loading: "The project's models are still loading — wait for them, then save.",
  'no-files': 'None of the models on screen has a file behind it, so a project cannot name them.',
  'too-large': 'The project would be larger than 16 MB.',
  failed: 'The project could not be built from what is on screen.',
  'no-answer': 'The window did not hand the project over in time.'
}

/**
 * After **Save** in the question on close, quit or Open: whether to go on, and what to say if not.
 * Saved — go on. Cancelled at the dialog, or a write that failed (its box is shown already) — stay,
 * silently. Nothing to save because no model is open — there is nothing unsaved, so go on. Nothing
 * for any other reason — stay, and say why in the "Could not save project" box: the user asked to
 * save, and leaving their changes behind without a word is the one thing this must not do.
 */
export function afterQuestionSave(o: SaveOutcome): { go: boolean; explain: string | null } {
  switch (o.kind) {
    case 'saved':
      return { go: true, explain: null }
    case 'cancelled':
    case 'failed':
      return { go: false, explain: null }
    case 'nothing':
      return o.reason === 'no-models' ? { go: true, explain: null } : { go: false, explain: NOTHING_REASON[o.reason] }
  }
}

/* ────────────────────────────── state ────────────────────────────── */

const state = {
  /** The `.sgvue` file this run opened or last saved, as the user named it; `null` for none. */
  path: null as string | null,
  /**
   * The real path of the file the open project was read from — what a carried model's `relPath`
   * is relative to (`relPathFor`). `null` for a project that was never opened, only saved.
   */
  openedFrom: null as string | null,
  dirty: false,
  /** A save, an open or the unsaved-changes question is under way. */
  busy: false,
  /** The user has answered the question: the next close goes through. */
  allowClose: false,
  /** The close in progress is part of a quit. */
  quitting: false
}

/** The folder the last project went to or came from — this run only, never stored. */
let lastDir: string | null = null

/** The open project's path, or `null`. */
export const currentProject = (): string | null => state.path

/** For tests: everything back to "no project". */
export function resetProjects(): void {
  state.path = null
  state.openedFrom = null
  state.dirty = false
  state.busy = false
  state.allowClose = false
  state.quitting = false
  lastDir = null
  waiting.clear()
}

const isMac = (): boolean => process.platform === 'darwin'

/**
 * The window shows the open project: the title everywhere, and on macOS the platform's own way
 * as well — the title bar's proxy icon (`setRepresentedFilename`) and the dot in the close button
 * while there are unsaved changes (`setDocumentEdited`).
 */
function refreshTitle(): void {
  const win = mainWindow()
  if (!win || !state.path) return
  win.setTitle(projectTitle(projectNameOf(state.path), state.dirty))
  if (isMac()) {
    win.setRepresentedFilename(state.path)
    win.setDocumentEdited(state.dirty)
  }
}

/** No project any more: the app's own title, and on macOS no proxy icon and no dot. */
function clearTitle(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setTitle(win.webContents.getTitle() || APP_TITLE)
  if (isMac()) {
    win.setRepresentedFilename('')
    win.setDocumentEdited(false)
  }
}

/* ────────────────────────────── the page's half ────────────────────────────── */

const waiting = new Map<number, (snap: ProjectSnapshot | null) => void>()
let seq = 0

/** Only the main window's page may answer, and it is checked before the payload is read. */
function fromMain(sender: WebContents): void {
  if (sender !== mainContents()) throw new Error('not available')
}

/** `project:snapshot` — the page's answer to one request. */
export function answerSnapshot(sender: WebContents, raw: unknown): void {
  fromMain(sender)
  const snap = ProjectSnapshot.parse(raw)
  const done = waiting.get(snap.n)
  waiting.delete(snap.n)
  done?.(snap)
}

/** `project:dirty` — the page's word on unsaved changes. Ignored while no project is open. */
export function setDirty(sender: WebContents, raw: unknown): void {
  fromMain(sender)
  const { dirty } = ProjectDirty.parse(raw)
  if (!state.path || dirty === state.dirty) return
  state.dirty = dirty
  refreshTitle()
}

/**
 * `project:close` — the page closed the open project (a fresh start on the landing page replaced
 * it): forget its path, and put the title back.
 */
export function closeFromPage(sender: WebContents, raw: unknown): void {
  fromMain(sender)
  ProjectClose.parse(raw)
  if (!state.path) return
  state.path = null
  state.openedFrom = null
  state.dirty = false
  const win = mainWindow()
  if (win) clearTitle(win)
}

/** Ask the page for the project as it stands; `null` when it has none to give, or does not answer. */
function pullSnapshot(): Promise<ProjectSnapshot | null> {
  const contents = mainContents()
  if (!contents) return Promise.resolve(null)
  const n = ++seq
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(n)
      resolve(null)
    }, SNAPSHOT_MS)
    waiting.set(n, (snap) => {
      clearTimeout(timer)
      resolve(snap)
    })
    contents.send(CH_PROJECT_SNAPSHOT_REQUEST, { n })
  })
}

/* ────────────────────────────── writing ────────────────────────────── */

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** `path`'s folder resolved to its real path, the file name kept — what `relPath` is relative to. */
async function realTarget(path: string): Promise<string> {
  const dir = await realpath(dirname(path)).catch(() => dirname(path))
  return join(dir, basename(path))
}

/**
 * A model's `relPath` in the file written at `target`. The page writes `null` for every model it
 * has open, and the path is worked out from its `absPath` — the file `admit()` let through. A model
 * the project names and could not open is carried forward with the `relPath` the opened file had
 * (`model/project.ts`, `carryForward`); that one is relative to the file it was opened from
 * (`openedFrom`), so it is re-based onto `target` — the same string when they are the same file,
 * where the file's own `relPath` may be the only pointer that still finds the model. With nothing
 * to re-base against, it is worked out from `absPath` as an open one's is.
 */
export function relPathFor(
  m: { relPath: string | null; absPath: string },
  target: string,
  openedFrom: string | null
): string | null {
  if (m.relPath !== null && openedFrom) {
    const where = resolveRelPath(openedFrom, m.relPath)
    const rel = where ? relPathOf(target, where) : null
    if (rel !== null) return rel
  }
  return relPathOf(target, m.absPath)
}

/**
 * The page's text, made into the file written at `target`: read again by `readProject` — so
 * nothing that is not a project is ever written — with every model's `relPath` worked out against
 * the folder it is being written to (`relPathFor`), and within `PROJECT_MAX_BYTES` of UTF-8.
 */
export function finaliseProject(text: string, target: string, openedFrom: string | null = null): string {
  const read = readProject(text)
  if (!read.ok) throw new Error(read.message)
  const project: ProjectFile = {
    ...read.project,
    models: read.project.models.map((m) => ({ ...m, relPath: relPathFor(m, target, openedFrom) }))
  }
  const out = projectText(project)
  if (Buffer.byteLength(out, 'utf8') > PROJECT_MAX_BYTES) throw new Error('the project is larger than 16 MB')
  return out
}

let tmpSeq = 0

/**
 * Write `text` as UTF-8 to `path` atomically, through a temporary file of this module's own beside
 * it — `exports.ts`'s rule: `wx`, so the clean-up can only ever remove a file this call made.
 */
async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${++tmpSeq}.${randomBytes(4).toString('hex')}.tmp`
  let created = false
  try {
    const handle = await open(tmp, 'wx')
    created = true
    try {
      await handle.writeFile(Buffer.from(text, 'utf8'))
    } finally {
      await handle.close()
    }
    await rename(tmp, path)
  } catch (e) {
    if (created) await unlink(tmp).catch(() => undefined)
    const code = (e as NodeJS.ErrnoException).code
    throw new Error(`could not write ${basename(path)}${code ? ` (${code})` : ''}`)
  }
}

/** The Save dialog for a project, attached to the main window; `null` when the user cancels. */
async function pickSavePath(win: BrowserWindow, suggested: string): Promise<string | null> {
  // A native dialog cannot be driven by an automated test: a development build takes its answer
  // from the environment, as `file:open` does (`SGVUE_OPEN_PATHS`). A shipped build has no such path.
  const injected = !app.isPackaged ? process.env.SGVUE_SAVE_PROJECT_PATH : undefined
  if (injected) return withProjectExtension(injected)
  const name = `${basename(suggested || 'Project') || 'Project'}.${PROJECT_EXT}`
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save Project',
    defaultPath: state.path ?? join(lastDir ?? app.getPath('documents'), name),
    filters: [{ name: 'SGVue project', extensions: [PROJECT_EXT] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (canceled || !filePath) return null
  const path = withProjectExtension(filePath)
  // The dialog asked about the name the user confirmed; a name this module changed is asked
  // about here, so no file is ever replaced without a question.
  if (path !== filePath && (await exists(path))) {
    const { response } = await messageBox(win, {
      type: 'question',
      title: 'Replace file?',
      message: `"${basename(path)}" already exists.`,
      detail: 'Replace it with this project?',
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (response !== 0) return null
  }
  return path
}

/** The "Could not save project" box, for the file `name` and one line of `detail`. */
async function saveError(win: BrowserWindow, name: string, detail: string): Promise<void> {
  await messageBox(win, {
    type: 'error',
    title: 'Could not save project',
    message: `"${name}" could not be saved.`,
    detail,
    buttons: ['OK'],
    noLink: true
  })
}

/** Save, with no check for a save already under way — the callers hold `busy`. */
async function saveNow(as: boolean): Promise<SaveOutcome> {
  const win = mainWindow()
  if (!win) return { kind: 'nothing', reason: 'no-answer' }
  const snap = await pullSnapshot()
  // Nothing to save, or a page that did not answer: nothing is written.
  if (!snap) return { kind: 'nothing', reason: 'no-answer' }
  if (snap.text === null) return { kind: 'nothing', reason: snap.reason ?? 'failed' }
  const target = saveTarget(as, state.path) === 'current' ? state.path! : await pickSavePath(win, snap.suggestedName)
  if (!target) return { kind: 'cancelled' }
  try {
    await writeAtomic(target, finaliseProject(snap.text, await realTarget(target), state.openedFrom))
  } catch (e) {
    await saveError(win, basename(target), e instanceof Error ? e.message : String(e))
    return { kind: 'failed' }
  }
  state.path = target
  state.dirty = false
  lastDir = dirname(target)
  refreshTitle()
  mainContents()?.send(CH_PROJECT_SAVED, { n: snap.n })
  return { kind: 'saved' }
}

/**
 * **Save** chosen in the question on close, quit or Open: save, and whether to go on
 * (`afterQuestionSave`) — saying why not when there was nothing to write.
 */
async function saveForQuestion(win: BrowserWindow): Promise<boolean> {
  const { go, explain } = afterQuestionSave(await saveNow(false))
  if (explain) await saveError(win, basename(state.path ?? `Project.${PROJECT_EXT}`), explain)
  return go
}

/**
 * File › Save Project (`as` false) and Save Project As… (`as` true). Resolves whether it saved. A
 * menu Save with nothing to write — no model open, the demo — does nothing, as before.
 */
export async function saveProject(as: boolean): Promise<boolean> {
  if (state.busy) return false
  state.busy = true
  try {
    return (await saveNow(as)).kind === 'saved'
  } finally {
    state.busy = false
  }
}

/* ────────────────────────────── reading ────────────────────────────── */

/** The unsaved-changes question — `Save · Don't Save · Cancel` — for the open project, on the main window. */
async function askUnsaved(win: BrowserWindow): Promise<UnsavedChoice> {
  const { response } = await messageBox(win, {
    type: 'warning',
    title: 'Unsaved changes',
    message: `Do you want to save the changes you made to "${projectNameOf(state.path ?? '')}"?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: [...UNSAVED_BUTTONS],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  return unsavedChoice(response)
}

/** The project file's text, at most `PROJECT_MAX_BYTES` — `exports.ts`'s `openScheduleFile` read. */
async function readProjectFile(path: string): Promise<string> {
  // Checked before it is opened: opening a FIFO or a device for reading can block forever.
  const first = await stat(path)
  if (!first.isFile()) throw new Error('not a file')
  if (first.size > PROJECT_MAX_BYTES) throw new Error('too large')
  const handle = await open(path, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error('not a file')
    if (opened.size > PROJECT_MAX_BYTES) throw new Error('too large')
    const buf = Buffer.alloc(opened.size)
    const { bytesRead } = await handle.read(buf, 0, opened.size, 0)
    return buf.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * Each of a project's models, admitted: the first of its candidates (`modelCandidates`) that
 * `admit()` lets through — the checks a Recent pill gets — or why none was. A network candidate
 * is trusted only on the project's own share, or where the user has been already (`trusted`).
 */
export async function admitProjectModels(
  projectPath: string,
  project: ProjectFile,
  trusted: ReadonlySet<string>
): Promise<ProjectModelFile[]> {
  const real = await realpath(projectPath).catch(() => projectPath)
  const out: ProjectModelFile[] = []
  for (const m of project.models) {
    let file: ProjectModelFile['file'] = null
    let refused: RefusedFile | null = null
    for (const candidate of modelCandidates(projectPath, real, m)) {
      const trust = new Set(trusted)
      if (onProjectShare(real, candidate)) trust.add(candidate)
      const why: RefusedFile[] = []
      const [admitted] = await admit([candidate], trust, why)
      if (admitted) {
        file = admitted
        break
      }
      refused ??= why[0] ?? null
    }
    out.push({ id: m.id, file, refused: file ? null : refused })
  }
  return out
}

/** The Open dialog for a project; `null` when the user cancels. */
async function pickOpenPath(win: BrowserWindow): Promise<string | null> {
  const injected = !app.isPackaged ? process.env.SGVUE_OPEN_PROJECT_PATH : undefined
  if (injected) return injected
  const { canceled, filePaths } = await openDialog(win, {
    title: 'Open Project',
    buttonLabel: 'Open',
    properties: ['openFile'],
    filters: [{ name: 'SGVue project', extensions: [PROJECT_EXT] }]
  })
  return canceled || !filePaths[0] ? null : filePaths[0]
}

async function openNow(): Promise<void> {
  const win = mainWindow()
  if (!win) return
  // Opening another project would lose the open one's changes, exactly as quitting would.
  if (state.path && state.dirty) {
    const choice = await askUnsaved(win)
    if (choice === 'cancel') return
    if (choice === 'save' && !(await saveForQuestion(win))) return
  }
  const path = await pickOpenPath(win)
  if (!path) return
  const name = projectNameOf(path)
  const send = (msg: ProjectOpened): void => mainContents()?.send(CH_PROJECT_OPENED, msg)
  let text: string
  try {
    text = await readProjectFile(path)
  } catch (e) {
    const tooLarge = e instanceof Error && e.message === 'too large'
    return send({
      ok: false,
      name,
      message: tooLarge
        ? 'This project file is larger than 16 MB, which no SGVue project is.'
        : 'This project file could not be read.'
    })
  }
  const read = readProject(text)
  // A refused file changes nothing: the project that was open, if any, stays the open one.
  if (!read.ok) return send({ ok: false, name, message: read.message })
  const recents = new Set((await listRecents().catch(() => [])).map((r) => r.path))
  const models = await admitProjectModels(path, read.project, recents)
  state.path = path
  state.openedFrom = await realpath(path).catch(() => path)
  state.dirty = false
  lastDir = dirname(path)
  refreshTitle()
  send({ ok: true, name, text, models })
}

/** File › Open Project…. */
export async function openProject(): Promise<void> {
  if (state.busy) return
  state.busy = true
  try {
    await openNow()
  } finally {
    state.busy = false
  }
}

/* ────────────────────────────── the window ────────────────────────────── */

let quitWatched = false

/**
 * The main window's project behaviour: the title, the question on close and on quit, and a clean
 * slate whenever its page loads afresh (a reload holds no project).
 */
export function attachProjectWindow(win: BrowserWindow): void {
  if (!quitWatched) {
    quitWatched = true
    app.on('before-quit', () => {
      state.quitting = true
    })
  }
  // While a project is open the title is ours, whatever the page's `<title>` says.
  win.on('page-title-updated', (event) => {
    if (state.path) event.preventDefault()
  })
  win.webContents.on('did-finish-load', () => {
    const had = state.path !== null
    state.path = null
    state.openedFrom = null
    state.dirty = false
    state.allowClose = false
    waiting.clear()
    if (had) clearTitle(win)
  })
  win.on('close', (event) => {
    const act = closeAction({
      open: state.path !== null,
      dirty: state.dirty,
      busy: state.busy,
      allowed: state.allowClose
    })
    if (act === 'close') return
    event.preventDefault()
    if (act === 'wait') {
      state.quitting = false
      return
    }
    void askBeforeClose(win)
  })
  win.on('closed', () => {
    state.path = null
    state.openedFrom = null
    state.dirty = false
    state.allowClose = false
    state.quitting = false
    waiting.clear()
  })
}

async function askBeforeClose(win: BrowserWindow): Promise<void> {
  state.busy = true
  let go = false
  try {
    const choice = await askUnsaved(win)
    go = choice === 'discard' || (choice === 'save' && (await saveForQuestion(win)))
  } finally {
    state.busy = false
  }
  if (!go) {
    state.quitting = false
    return
  }
  state.allowClose = true
  if (state.quitting) app.quit()
  else if (!win.isDestroyed()) win.close()
}
