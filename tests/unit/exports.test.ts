/**
 * `src/main/exports.ts` — the third writer (2026-09-25, phase 4 of the Schedules port).
 *
 * The owner's rule: *export adds ONE writer, limited to paths the user picks in a native Save
 * dialog*. So: bytes land only where the dialog pointed, with the kind's extension, atomically,
 * and nowhere at all when the user cancels; a name this module changed never replaces a file
 * without a question; the renderer's suggested name is only the dialog's default, in a folder
 * main chooses. And the read half: the Open dialog, at most 1 MB, `null` on cancel.
 *
 * `electron` is mocked down to the dialog and `app.getPath`, pointed at a temporary folder.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXPORT_MAX_BYTES, ExportSaveRequest, SCHEDULE_FILE_MAX_BYTES } from '../../src/shared/ipc-contract'
const root = mkdtempSync(join(tmpdir(), 'sgvue-exports-'))
const docs = join(root, 'Documents')
const other = join(root, 'Elsewhere')
mkdirSync(docs)
mkdirSync(other)

const dialog = {
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn()
}
vi.mock('electron', () => ({ app: { getPath: () => docs }, dialog }))

const { openScheduleFile, saveExport, withExtension } = await import('../../src/main/exports')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  dialog.showSaveDialog.mockReset()
  dialog.showOpenDialog.mockReset()
  dialog.showMessageBox.mockReset()
})

// The window is only ever handed to the dialogs; the mocks never look at it.
const win = {} as never
const bytes = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s))
const req = (over: Partial<ExportSaveRequest> = {}): ExportSaveRequest =>
  ({ kind: 'csv', suggestedName: 'Door Schedule — 2026-09-25.csv', bytes: bytes('a,b'), ...over })
const answer = (filePath: string | undefined) =>
  dialog.showSaveDialog.mockResolvedValueOnce({ canceled: !filePath, filePath: filePath ?? '' })
const tmpLeft = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.tmp'))

describe('withExtension', () => {
  it('keeps a name that already carries the kind, in any case', () => {
    expect(withExtension('C:\\d\\doors.csv', 'csv')).toBe('C:\\d\\doors.csv')
    expect(withExtension('/d/doors.XLSX', 'xlsx')).toBe('/d/doors.XLSX')
    expect(withExtension('/d/doors.schedule.json', 'schedule.json')).toBe('/d/doors.schedule.json')
  })

  it('adds the kind to anything else, keeping what the user typed', () => {
    expect(withExtension('/d/doors', 'csv')).toBe('/d/doors.csv')
    expect(withExtension('/d/doors.xlsx', 'csv')).toBe('/d/doors.xlsx.csv')
    expect(withExtension('/d/doors', 'schedule.json')).toBe('/d/doors.schedule.json')
  })

  it('turns the .json the dialog appended into .schedule.json rather than stacking', () => {
    expect(withExtension('/d/doors.json', 'schedule.json')).toBe('/d/doors.schedule.json')
    expect(withExtension('/d/doors.JSON', 'schedule.json')).toBe('/d/doors.schedule.json')
  })
})

describe('saveExport', () => {
  // First in the file on purpose: nothing has been exported yet this session.
  it('offers the suggested name in Documents before anything has been exported', async () => {
    answer(undefined)
    await saveExport(win, req({ kind: 'xlsx', suggestedName: 'A — 2026-09-25.xlsx' }))
    const opts = dialog.showSaveDialog.mock.calls[0][1] as { defaultPath: string; filters: unknown[]; title: string }
    expect(opts.defaultPath).toBe(join(docs, 'A — 2026-09-25.xlsx'))
    expect(opts.filters).toEqual([{ name: 'Excel workbook', extensions: ['xlsx'] }])
    expect(opts.title).toBe('Export to Excel')
    // The dialog is attached to the window it was asked from.
    expect(dialog.showSaveDialog.mock.calls[0][0]).toBe(win)
  })

  it('writes the bytes to the path the dialog returned, and nowhere else', async () => {
    const target = join(other, 'mine.csv')
    answer(target)
    expect(await saveExport(win, req({ bytes: bytes('x,y\r\n1,2') }))).toEqual({ saved: true })
    expect(readFileSync(target, 'utf8')).toBe('x,y\r\n1,2')
    // Nothing under the suggested name, in the default folder or anywhere else.
    expect(readdirSync(docs)).toEqual([])
    expect(readdirSync(other)).toEqual(['mine.csv'])
  })

  it('writes nothing when the user cancels', async () => {
    const before = readdirSync(other).length
    answer(undefined)
    expect(await saveExport(win, req({ suggestedName: 'never.csv' }))).toEqual({ saved: false })
    expect(readdirSync(other)).toHaveLength(before)
    expect(readdirSync(docs)).toEqual([])
  })

  it('then offers the folder the last export went to, this session', async () => {
    answer(undefined)
    await saveExport(win, req({ suggestedName: 'B — 2026-09-25.csv' }))
    const opts = dialog.showSaveDialog.mock.calls[0][1] as { defaultPath: string; filters: unknown[] }
    // The test above saved into `other`.
    expect(opts.defaultPath).toBe(join(other, 'B — 2026-09-25.csv'))
    expect(opts.filters).toEqual([{ name: 'CSV (comma-separated)', extensions: ['csv'] }])
  })

  it('forces the extension of the kind', async () => {
    answer(join(other, 'typed-without'))
    expect(await saveExport(win, req({ kind: 'xlsx' }))).toEqual({ saved: true })
    expect(existsSync(join(other, 'typed-without.xlsx'))).toBe(true)
    expect(existsSync(join(other, 'typed-without'))).toBe(false)
    answer(join(other, 'setup.json'))
    expect(await saveExport(win, req({ kind: 'schedule', bytes: bytes('{}') }))).toEqual({ saved: true })
    expect(readFileSync(join(other, 'setup.schedule.json'), 'utf8')).toBe('{}')
  })

  it('asks before a name it changed replaces a file, and Cancel leaves the file alone', async () => {
    const kept = join(other, 'kept.schedule.json')
    writeFileSync(kept, 'original')
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    answer(join(other, 'kept.json'))
    expect(await saveExport(win, req({ kind: 'schedule', bytes: bytes('new') }))).toEqual({ saved: false })
    expect(readFileSync(kept, 'utf8')).toBe('original')
    const asked = dialog.showMessageBox.mock.calls[0][1] as { message: string; buttons: string[] }
    expect(asked.message).toBe('"kept.schedule.json" already exists.')
    expect(asked.buttons).toEqual(['Replace', 'Cancel'])

    dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    answer(join(other, 'kept.json'))
    expect(await saveExport(win, req({ kind: 'schedule', bytes: bytes('new') }))).toEqual({ saved: true })
    expect(readFileSync(kept, 'utf8')).toBe('new')
  })

  it('does not ask again about a name the user confirmed in the dialog itself', async () => {
    const same = join(other, 'same.csv')
    writeFileSync(same, 'old')
    answer(same)
    expect(await saveExport(win, req({ bytes: bytes('new') }))).toEqual({ saved: true })
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(readFileSync(same, 'utf8')).toBe('new')
  })

  it('leaves no temporary file behind, whether the write lands or fails', async () => {
    expect(tmpLeft(other)).toEqual([])
    // A directory where the file should go: the rename fails.
    const blocked = join(other, 'blocked.csv')
    mkdirSync(blocked)
    answer(blocked)
    const err = await saveExport(win, req()).catch((e: Error) => e)
    expect(String(err)).toMatch(/could not write blocked\.csv \(E[A-Z]+\)/)
    // The message the window flashes names the file, never the folder it is in.
    expect(String(err)).not.toContain(other)
    expect(tmpLeft(other)).toEqual([])
  })

  it('refuses more than the cap before showing a dialog', async () => {
    await expect(saveExport(win, req({ bytes: new Uint8Array(EXPORT_MAX_BYTES + 1) }))).rejects.toThrow(/too large/)
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })
})

describe('ExportSaveRequest', () => {
  const ok = { kind: 'xlsx', suggestedName: 'Door Schedule — 2026-09-25.xlsx', bytes: new Uint8Array(3) }

  it('accepts what the page sends', () => {
    expect(ExportSaveRequest.safeParse(ok).success).toBe(true)
    expect(ExportSaveRequest.safeParse({ ...ok, kind: 'schedule', suggestedName: 'x.schedule.json' }).success).toBe(true)
  })

  it('refuses a path, a Windows-illegal character, a control character, a dot-name or an empty name', () => {
    for (const suggestedName of ['..\\up.csv', 'a\\b.csv', 'a/b.csv', 'C:\\x.csv', 'a?.csv', 'a*.csv', 'a"b.csv', 'a|b', 'a\nb', '.hidden', '', 'x'.repeat(201)]) {
      expect([suggestedName, ExportSaveRequest.safeParse({ ...ok, suggestedName }).success]).toEqual([suggestedName, false])
    }
  })

  it('refuses an unknown kind, bytes that are not bytes, and bytes over the cap', () => {
    expect(ExportSaveRequest.safeParse({ ...ok, kind: 'pdf' }).success).toBe(false)
    expect(ExportSaveRequest.safeParse({ ...ok, bytes: 'abc' }).success).toBe(false)
    expect(ExportSaveRequest.safeParse({ ...ok, bytes: [1, 2, 3] }).success).toBe(false)
    expect(ExportSaveRequest.safeParse({ ...ok, bytes: new Uint8Array(EXPORT_MAX_BYTES + 1) }).success).toBe(false)
    expect(ExportSaveRequest.safeParse({ ...ok, bytes: new Uint8Array(EXPORT_MAX_BYTES) }).success).toBe(true)
  })
})

describe('openScheduleFile', () => {
  it('returns the text of the file picked', async () => {
    const file = join(other, 'in.schedule.json')
    writeFileSync(file, '{"name":"Doors"}')
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] })
    expect(await openScheduleFile(win)).toEqual({ text: '{"name":"Doors"}' })
    const opts = dialog.showOpenDialog.mock.calls[0][1] as { filters: unknown[]; properties: string[] }
    expect(opts.filters).toEqual([{ name: 'Schedule files', extensions: ['json'] }])
    expect(opts.properties).toEqual(['openFile'])
  })

  it('returns null when the user cancels', async () => {
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await openScheduleFile(win)).toBeNull()
  })

  it('refuses anything that is not a regular file before opening it', async () => {
    // A directory stands in for a FIFO or a device, which an open for reading could block on.
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [other] })
    await expect(openScheduleFile(win)).rejects.toThrow(/not a file/)
  })

  it('refuses a file over 1 MB without reading it', async () => {
    const big = join(other, 'big.json')
    writeFileSync(big, Buffer.alloc(SCHEDULE_FILE_MAX_BYTES + 1, 32))
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [big] })
    await expect(openScheduleFile(win)).rejects.toThrow(/too large/)
    // Exactly 1 MB is still read.
    writeFileSync(big, Buffer.alloc(SCHEDULE_FILE_MAX_BYTES, 32))
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [big] })
    expect((await openScheduleFile(win))?.text).toHaveLength(SCHEDULE_FILE_MAX_BYTES)
  })
})
