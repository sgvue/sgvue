/**
 * Schedules files — **the third, and last, module allowed to write to disk** (2026-09-25,
 * phase 4 of the Schedules port). Owner-approved in phase 1: *export adds ONE writer, limited
 * to paths the user picks in a native Save dialog*. `settings.ts` and `sessions.ts` are the
 * other two; `tests/readonly-guard.test.ts` holds the list at three.
 *
 * **What it writes, and where.** Bytes the Schedules window built — an Excel workbook, a CSV, or
 * a `.schedule.json` — and only to the path `dialog.showSaveDialog` returned **in the same
 * call**. The renderer never names a path: it sends a kind, a suggested file name (the dialog's
 * default, put in a folder main chooses — Documents, or the folder last used this session) and
 * the bytes. The extension is forced to the kind (`withExtension`); when forcing it changed the
 * name the user confirmed and a file of that name exists, the OS asks before it is replaced.
 * Written atomically — a uniquely named temporary file beside the target, then one `rename` —
 * as `sessions.ts` writes, so an interrupted export never leaves half a workbook under the
 * user's name; a temporary file this module created is removed if the write fails.
 *
 * **What it reads.** `openScheduleFile` is the other half of the window's file surface, and a
 * read: the native Open dialog, then at most `SCHEDULE_FILE_MAX_BYTES` of the file the user
 * picked, as text. It does not go through `file-protocol.ts`'s `admit()`, which exists for
 * *models* — paths the renderer keeps, compares and streams from. Nothing here hands the
 * renderer a path, a token or a stream: it gets the text of one file the user chose, once.
 *
 * Both are reachable only from the Schedules window (`index.ts` checks the sender), and both
 * attach their dialogs to it.
 */
import { app, dialog, type BrowserWindow, type FileFilter } from 'electron'
import { randomBytes } from 'node:crypto'
import { open, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  EXPORT_MAX_BYTES,
  SCHEDULE_FILE_MAX_BYTES,
  type ExportKind,
  type ExportSaveRequest
} from '../shared/ipc-contract'
import { messageBox, openDialog } from './window'

const KINDS: Record<ExportKind, { ext: string; title: string; filter: FileFilter }> = {
  xlsx: { ext: 'xlsx', title: 'Export to Excel', filter: { name: 'Excel workbook', extensions: ['xlsx'] } },
  csv: { ext: 'csv', title: 'Export to CSV', filter: { name: 'CSV (comma-separated)', extensions: ['csv'] } },
  // The filter is `.json`: a two-part extension in a filter is handled differently by each
  // OS's dialog. `withExtension` then makes it `.schedule.json`.
  schedule: {
    ext: 'schedule.json',
    title: 'Export schedule file',
    filter: { name: 'Schedule file', extensions: ['json'] }
  }
}

/** The folder the last export went to — this session only, never stored. */
let lastDir: string | null = null

/**
 * `path` with the kind's extension, whatever the user typed. A two-part extension replaces
 * the last part the dialog already appended rather than stacking on it: `doors.json` →
 * `doors.schedule.json`. Anything else gains the extension: `doors.xlsx` saved as CSV is
 * `doors.xlsx.csv` — the name the user typed is kept, and the file is what it says it is.
 */
export function withExtension(path: string, ext: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(`.${ext}`)) return path
  const dot = ext.lastIndexOf('.')
  if (dot > 0 && lower.endsWith(ext.slice(dot))) {
    return `${path.slice(0, path.length - (ext.length - dot))}.${ext}`
  }
  return `${path}.${ext}`
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

let tmpSeq = 0

/**
 * Write `bytes` to `path` atomically, through a temporary file of this module's own beside it.
 * The temporary name carries random bytes as well as the pid and a counter: a `.tmp` a crashed
 * earlier run left under the same pid and count would otherwise make the `wx` open fail.
 */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${++tmpSeq}.${randomBytes(4).toString('hex')}.tmp`
  let created = false
  try {
    // `wx`: never opens a file that is already there, so the clean-up below can only ever
    // remove a file this call made.
    const handle = await open(tmp, 'wx')
    created = true
    try {
      await handle.writeFile(bytes)
    } finally {
      await handle.close()
    }
    await rename(tmp, path)
  } catch (e) {
    if (created) await unlink(tmp).catch(() => undefined)
    // The user reads this in the window's flash: the file's name and the OS's code, no path.
    const code = (e as NodeJS.ErrnoException).code
    throw new Error(`could not write ${basename(path)}${code ? ` (${code})` : ''}`)
  }
}

/**
 * The Save dialog, attached to the Schedules window, then the write. `{ saved: false }` when
 * the user cancels — at the dialog, or at the replace question.
 */
export async function saveExport(win: BrowserWindow, req: ExportSaveRequest): Promise<{ saved: boolean }> {
  // The schema caps it already; this module does not rely on its caller for that.
  if (req.bytes.byteLength > EXPORT_MAX_BYTES) throw new Error('export too large')
  const kind = KINDS[req.kind]
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: kind.title,
    defaultPath: join(lastDir ?? app.getPath('documents'), basename(req.suggestedName)),
    filters: [kind.filter],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (canceled || !filePath) return { saved: false }
  const path = withExtension(filePath, kind.ext)
  // The dialog asked about the name the user confirmed; a name this module changed is asked
  // about here, so no file is ever replaced without a question.
  if (path !== filePath && (await exists(path))) {
    const { response } = await messageBox(win, {
      type: 'question',
      title: 'Replace file?',
      message: `"${basename(path)}" already exists.`,
      detail: 'Replace it with this export?',
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    if (response !== 0) return { saved: false }
  }
  await writeAtomic(path, req.bytes)
  lastDir = dirname(path)
  return { saved: true }
}

/**
 * The Open dialog, attached to the Schedules window, and the text of the file picked — at most
 * `SCHEDULE_FILE_MAX_BYTES`; a larger file is refused unread. `null` when the user cancels.
 * The page parses it with ifcTable's strict `parseScheduleDef`; nothing here trusts it.
 */
export async function openScheduleFile(win: BrowserWindow): Promise<{ text: string } | null> {
  const { canceled, filePaths } = await openDialog(win, {
    title: 'Open schedule file',
    buttonLabel: 'Open',
    properties: ['openFile'],
    filters: [{ name: 'Schedule files', extensions: ['json'] }]
  })
  if (canceled || !filePaths[0]) return null
  // Checked before it is opened: opening a FIFO or a device for reading can block forever.
  // Only a regular file is read, and only one no larger than the cap.
  const first = await stat(filePaths[0])
  if (!first.isFile()) throw new Error('not a file')
  if (first.size > SCHEDULE_FILE_MAX_BYTES) throw new Error('file too large')
  const handle = await open(filePaths[0], 'r')
  try {
    // …and again on what was opened, in case the path changed in between.
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error('not a file')
    const size = opened.size
    if (size > SCHEDULE_FILE_MAX_BYTES) throw new Error('file too large')
    const buf = Buffer.alloc(size)
    const { bytesRead } = await handle.read(buf, 0, size, 0)
    return { text: buf.toString('utf8', 0, bytesRead) }
  } finally {
    await handle.close()
  }
}
