/**
 * `src/main/projects.ts` — the fourth writer (2026-11-07, the `.sgvue` project file, plan D11).
 *
 * The owner-approved rule: it writes only to a path the user picked in its Save dialog in the
 * same call, or to the project this run opened or last saved; atomically; UTF-8; at most 16 MiB;
 * always `.sgvue`. The page never names a path: main pulls the project from it and reads the text
 * again with `readProject` before it writes. And the read half: Open Project… reads at most
 * 16 MiB, refuses what the reader refuses, and hands over only models `admit()` let through.
 *
 * `electron` is mocked down to the dialogs, `app` and nothing else; the "page" is a stub
 * `webContents` that answers each snapshot request with the text a test sets.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Real paths, as `admit()` gives them: on macOS the temporary folder is a link into /private.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'sgvue-projects-')))
const docs = join(root, 'Documents')
const review = join(root, 'review')
const models = join(review, 'models')
mkdirSync(docs)
mkdirSync(models, { recursive: true })

const dialog = {
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn()
}
const appOn = vi.fn()
const appQuit = vi.fn()
vi.mock('electron', () => ({
  app: { getPath: () => docs, isPackaged: true, on: appOn, quit: appQuit },
  dialog,
  net: {},
  protocol: {}
}))

const projects = await import('../../src/main/projects')
const { setMainWindow } = await import('../../src/main/window')
const { CH_PROJECT_OPENED, CH_PROJECT_SAVED, CH_PROJECT_SNAPSHOT_REQUEST } = await import('../../src/shared/ipc-channels')
const { PROJECT_MAX_BYTES, readProject, projectText } = await import('../../src/shared/project-file')
const {
  answerSnapshot,
  attachProjectWindow,
  closeAction,
  finaliseProject,
  modelCandidates,
  onProjectShare,
  openProject,
  projectNameOf,
  projectTitle,
  resetProjects,
  saveProject,
  saveTarget,
  setDirty,
  unsavedChoice,
  withProjectExtension,
  admitProjectModels,
  relPathFor,
  afterQuestionSave,
  NOTHING_REASON,
  closeFromPage,
  locateModel,
  openProjectFromOS,
  openDroppedProject,
  projectPageReady,
  givenPathProblem,
  NOT_A_PROJECT,
  NETWORK_DROP
} = projects


afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/* ────────────────────────────── a project to save ────────────────────────────── */

const ARC = join(models, 'ARC.ifc')
const STR = join(root, 'shared', 'STR.ifc')
mkdirSync(join(root, 'shared'))
writeFileSync(ARC, 'ISO-10303-21;ARC')
writeFileSync(STR, 'ISO-10303-21;STRSTR')

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/project/v1-synthetic.sgvue'), 'utf8')
) as { models: { absPath: string; relPath: string | null; size: number }[] }
/** The frozen corpus, its two models pointed at real files in the temporary folder, relPaths unset. */
function projectAt(paths: readonly string[] = [ARC, STR]): string {
  const p = structuredClone(fixture)
  // The corpus's first two models (its third, MEP, carries only an assigned colour).
  p.models = p.models.slice(0, paths.length)
  p.models.forEach((m, i) => {
    m.absPath = paths[i]
    m.relPath = null
    m.size = readFileSync(paths[i]).length
  })
  return JSON.stringify(p)
}

/* ────────────────────────────── a stub window and page ────────────────────────────── */

type Handler = (...args: unknown[]) => void
function fakeWindow() {
  const sent: [string, unknown][] = []
  const handlers = new Map<string, Handler[]>()
  const on = (ev: string, fn: Handler) => void handlers.set(ev, [...(handlers.get(ev) ?? []), fn])
  let answer: { text: string | null; suggestedName?: string; reason?: string | null; extra?: Record<string, unknown> } = {
    text: null
  }
  const contents = {
    isDestroyed: () => false,
    getTitle: () => 'SGVue',
    on,
    send: (channel: string, payload: unknown) => {
      sent.push([channel, payload])
      if (channel === CH_PROJECT_SNAPSHOT_REQUEST) {
        const { n } = payload as { n: number }
        queueMicrotask(() =>
          answerSnapshot(contents as never, {
            n,
            text: answer.text,
            suggestedName: answer.suggestedName ?? 'Tower A',
            reason: answer.reason !== undefined ? answer.reason : answer.text === null ? 'no-models' : null,
            ...answer.extra
          })
        )
      }
    }
  }
  const win = {
    webContents: contents,
    isDestroyed: () => false,
    setTitle: vi.fn(),
    setRepresentedFilename: vi.fn(),
    setDocumentEdited: vi.fn(),
    close: vi.fn(),
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
    on
  }
  const emit = (ev: string, ...args: unknown[]) => handlers.get(ev)?.forEach((fn) => fn(...args))
  return {
    win,
    contents,
    sent,
    emit,
    answer: (a: typeof answer) => {
      answer = a
    }
  }
}

let page = fakeWindow()
beforeEach(() => {
  resetProjects()
  dialog.showSaveDialog.mockReset()
  dialog.showOpenDialog.mockReset()
  dialog.showMessageBox.mockReset()
  appQuit.mockReset()
  page = fakeWindow()
  setMainWindow(page.win as never)
})

const saveAnswer = (filePath: string | undefined) =>
  dialog.showSaveDialog.mockResolvedValueOnce({ canceled: !filePath, filePath: filePath ?? '' })
const tmpLeft = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.tmp'))
const savedTo = (path: string) => {
  const read = readProject(readFileSync(path, 'utf8'))
  if (!read.ok) throw new Error(read.message)
  return read.project
}

/* ────────────────────────────── pure rules ────────────────────────────── */

describe('the pure rules', () => {
  it('forces .sgvue, whatever was typed', () => {
    expect(withProjectExtension('/d/tower')).toBe('/d/tower.sgvue')
    expect(withProjectExtension('/d/tower.SGVUE')).toBe('/d/tower.SGVUE')
    expect(withProjectExtension('/d/tower.json')).toBe('/d/tower.json.sgvue')
    expect(withProjectExtension('C:\\d\\tower')).toBe('C:\\d\\tower.sgvue')
  })

  it('names a project by its file, in the title, with • while unsaved', () => {
    expect(projectNameOf('/d/Tower A.sgvue')).toBe('Tower A')
    expect(projectNameOf('C:\\d\\Tower A.SGVUE')).toBe('Tower A')
    expect(projectTitle('Tower A', false)).toBe('Tower A — SGVue')
    expect(projectTitle('Tower A', true)).toBe('Tower A • — SGVue')
  })

  it('saves to the open project unless Save As — or none is open', () => {
    expect(saveTarget(false, '/d/a.sgvue')).toBe('current')
    expect(saveTarget(true, '/d/a.sgvue')).toBe('dialog')
    expect(saveTarget(false, null)).toBe('dialog')
    expect(saveTarget(true, null)).toBe('dialog')
  })

  it('asks on close only for an open project with unsaved changes, and holds while one asks', () => {
    const at = (open: boolean, dirty: boolean, busy = false, allowed = false) =>
      closeAction({ open, dirty, busy, allowed })
    expect(at(false, false)).toBe('close')
    expect(at(false, true)).toBe('close')
    expect(at(true, false)).toBe('close')
    expect(at(true, true)).toBe('ask')
    expect(at(true, true, true)).toBe('wait')
    expect(at(true, true, true, true)).toBe('close')
    expect(at(true, true, false, true)).toBe('close')
  })

  it('reads the question’s answer as Save · Don’t Save · Cancel, anything else Cancel', () => {
    expect([0, 1, 2, 3, -1].map(unsavedChoice)).toEqual(['save', 'discard', 'cancel', 'cancel', 'cancel'])
  })

  it('trusts a network path only on the share the project itself came from', () => {
    expect(onProjectShare('\\\\srv\\proj\\r\\a.sgvue', '\\\\srv\\proj\\m\\a.ifc')).toBe(true)
    expect(onProjectShare('\\\\SRV\\Proj\\a.sgvue', '//srv/proj/a.ifc')).toBe(true)
    expect(onProjectShare('\\\\srv\\proj\\a.sgvue', '\\\\srv\\other\\a.ifc')).toBe(false)
    expect(onProjectShare('\\\\srv\\proj\\a.sgvue', '\\\\attacker\\proj\\a.ifc')).toBe(false)
    expect(onProjectShare('C:\\r\\a.sgvue', '\\\\attacker\\x\\a.ifc')).toBe(false)
    expect(onProjectShare('/r/a.sgvue', '\\\\?\\C:\\a.ifc')).toBe(false)
    expect(onProjectShare('\\\\srv\\proj\\a.sgvue', 'C:\\a.ifc')).toBe(false)
  })

  it('looks for a model by relPath against the project folder first, then by absPath', () => {
    expect(
      modelCandidates('/r/p.sgvue', '/real/r/p.sgvue', { relPath: '../m/a.ifc', absPath: '/old/a.ifc' })
    ).toEqual(['/m/a.ifc', '/real/m/a.ifc', '/old/a.ifc'])
    expect(modelCandidates('/r/p.sgvue', '/r/p.sgvue', { relPath: 'a.ifc', absPath: '/r/a.ifc' })).toEqual([
      '/r/a.ifc'
    ])
    expect(modelCandidates('/r/p.sgvue', '/r/p.sgvue', { relPath: null, absPath: '/x/a.ifc' })).toEqual(['/x/a.ifc'])
  })
})

/* ────────────────────────────── writing ────────────────────────────── */

describe('saveProject', () => {
  it('with no project open: the Save dialog, in Documents, then the file — with relPaths for where it went', async () => {
    page.answer({ text: projectAt(), suggestedName: 'Tower A' })
    const target = join(review, 'review.sgvue')
    saveAnswer(target)
    expect(await saveProject(false)).toBe(true)
    const opts = dialog.showSaveDialog.mock.calls[0][1] as { defaultPath: string; filters: unknown[]; title: string }
    expect(dialog.showSaveDialog.mock.calls[0][0]).toBe(page.win)
    expect(opts.title).toBe('Save Project')
    expect(opts.defaultPath).toBe(join(docs, 'Tower A.sgvue'))
    expect(opts.filters).toEqual([{ name: 'SGVue project', extensions: ['sgvue'] }])
    const saved = savedTo(target)
    expect(saved.models.map((m) => m.relPath)).toEqual(['models/ARC.ifc', '../shared/STR.ifc'])
    expect(tmpLeft(review)).toEqual([])
    expect(projects.currentProject()).toBe(target)
    // The page is told which snapshot is on disk, and the title names the project.
    expect(page.sent.filter(([c]) => c === CH_PROJECT_SAVED)).toHaveLength(1)
    expect(page.win.setTitle).toHaveBeenLastCalledWith('review — SGVue')
  })

  it('then Save writes to that file with no dialog, and Save As asks again', async () => {
    page.answer({ text: projectAt() })
    const first = join(review, 'first.sgvue')
    saveAnswer(first)
    await saveProject(false)
    writeFileSync(first, 'stale')
    expect(await saveProject(false)).toBe(true)
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
    expect(savedTo(first).format).toBe('sgvue-project')
    const second = join(review, 'second.sgvue')
    saveAnswer(second)
    expect(await saveProject(true)).toBe(true)
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(2)
    expect(projects.currentProject()).toBe(second)
    expect(tmpLeft(review)).toEqual([])
  })

  it('forces the extension, and asks before a name it changed replaces a file', async () => {
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'plain'))
    await saveProject(false)
    expect(savedTo(join(review, 'plain.sgvue')).version).toBe(1)
    // `taken` → `taken.sgvue`, which exists: asked, and Cancel writes nothing.
    writeFileSync(join(review, 'taken.sgvue'), 'mine')
    resetProjects()
    saveAnswer(join(review, 'taken'))
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })
    expect(await saveProject(false)).toBe(false)
    expect(readFileSync(join(review, 'taken.sgvue'), 'utf8')).toBe('mine')
  })

  it('writes nothing when the user cancels, or the page has nothing to save', async () => {
    page.answer({ text: projectAt() })
    saveAnswer(undefined)
    expect(await saveProject(false)).toBe(false)
    expect(projects.currentProject()).toBeNull()
    page.answer({ text: null })
    expect(await saveProject(true)).toBe(false)
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)
  })

  it('writes only a project: text that is not one is refused with a message, and nothing lands', async () => {
    const before = readdirSync(review)
    for (const text of ['{"hello":1}', 'not json', JSON.stringify({ ...fixture, version: 2 })]) {
      page.answer({ text })
      saveAnswer(join(review, 'bad.sgvue'))
      dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
      expect(await saveProject(true)).toBe(false)
    }
    expect(readdirSync(review)).toEqual(before)
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(3)
    expect((dialog.showMessageBox.mock.calls[0][1] as { title: string }).title).toBe('Could not save project')
  })

  it('is atomic: a write that fails leaves no temporary file and no project behind', async () => {
    page.answer({ text: projectAt() })
    saveAnswer(join(root, 'no-such-folder', 'x.sgvue'))
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(await saveProject(false)).toBe(false)
    expect(tmpLeft(root)).toEqual([])
    expect(projects.currentProject()).toBeNull()
  })

  it('is capped at 16 MiB of UTF-8, as written — relPaths included', () => {
    // Under the cap as the page sent it, and over it once main has written the two relPaths in:
    // the cap is on the file that would land, in bytes, not on the text that arrived.
    const deep = '/' + Array.from({ length: 300 }, (_, i) => `folder${i}`).join('/')
    const big = JSON.parse(projectAt()) as { models: { absPath: string }[] }
    big.models.forEach((m, i) => (m.absPath = `${deep}/m${i}.ifc`))
    const big2 = big as unknown as { visibility: { hidden: [string, string][] } }
    const bytes = (): number => Buffer.byteLength(JSON.stringify(big), 'utf8')
    // Filled to just under the cap with hidden elements, each `["m1","<22-character GlobalId>"]`.
    const ref = (i: number): [string, string] => ['m1', String(i).padStart(22, '0')]
    const per = JSON.stringify(ref(0)).length + 1
    const n = Math.floor((PROJECT_MAX_BYTES - 8000 - bytes()) / per)
    big2.visibility.hidden = Array.from({ length: n }, (_, i) => ref(i))
    const more = Math.floor((PROJECT_MAX_BYTES - 3000 - bytes()) / per)
    for (let i = 0; i < more; i++) big2.visibility.hidden.push(ref(n + i))
    const text = JSON.stringify(big)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(PROJECT_MAX_BYTES)
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(PROJECT_MAX_BYTES - 4000)
    expect(readProject(text).ok).toBe(true)
    expect(() => finaliseProject(text, '/elsewhere/review.sgvue')).toThrow(/larger than 16 MB/)
    // The same project, written beside its models, has short relPaths and fits.
    expect(() => finaliseProject(text, `${deep}/review.sgvue`)).not.toThrow()
    // A text longer than the cap in characters does not get past the channel's schema at all.
    expect(() =>
      answerSnapshot(page.contents as never, { n: 1, text: 'x'.repeat(PROJECT_MAX_BYTES + 1), suggestedName: '', reason: null })
    ).toThrow()
  }, 60_000)
})

/* ────────────────────────────── the page's channels ────────────────────────────── */

describe('project:close — a fresh start replaced the project', () => {
  it('forgets the path and puts the title back, for the main window’s page only', async () => {
    attachProjectWindow(page.win as never)
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'closing.sgvue'))
    await saveProject(false)
    expect(() => closeFromPage({ isDestroyed: () => false } as never, undefined)).toThrow('not available')
    expect(() => closeFromPage(page.contents as never, { path: '/x' })).toThrow()
    expect(projects.currentProject()).not.toBeNull()
    closeFromPage(page.contents as never, undefined)
    expect(projects.currentProject()).toBeNull()
    expect(page.win.setTitle).toHaveBeenLastCalledWith('SGVue')
    // No project, so nothing asks on close.
    const event = { preventDefault: vi.fn() }
    setDirty(page.contents as never, { dirty: true })
    page.emit('close', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

describe('the page’s two channels', () => {
  it('answer the main window’s page and nothing else, before the payload is read', () => {
    const other = { isDestroyed: () => false } as never
    expect(() => answerSnapshot(other, { n: 1, text: null, suggestedName: '', reason: 'no-models' })).toThrow('not available')
    expect(() => answerSnapshot(other, 'not even an object')).toThrow('not available')
    expect(() => setDirty(other, { dirty: true })).toThrow('not available')
  })

  it('take no path: a snapshot or a dirty flag with anything more is refused', () => {
    expect(() =>
      answerSnapshot(page.contents as never, { n: 1, text: null, suggestedName: '', reason: 'no-models', path: '/etc/x.sgvue' })
    ).toThrow()
    expect(() => answerSnapshot(page.contents as never, { n: 1, text: null, suggestedName: '../../x', reason: 'no-models' })).toThrow()
    expect(() => setDirty(page.contents as never, { dirty: true, path: '/x' })).toThrow()
  })

  it('a dirty flag sets the title’s • — and is ignored while no project is open', async () => {
    setDirty(page.contents as never, { dirty: true })
    expect(page.win.setTitle).not.toHaveBeenCalled()
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'titled.sgvue'))
    await saveProject(false)
    setDirty(page.contents as never, { dirty: true })
    expect(page.win.setTitle).toHaveBeenLastCalledWith('titled • — SGVue')
    setDirty(page.contents as never, { dirty: false })
    expect(page.win.setTitle).toHaveBeenLastCalledWith('titled — SGVue')
  })
})

describe('macOS’s own marks (2026-11-07)', () => {
  const asPlatform = async (platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> => {
    const real = process.platform
    Object.defineProperty(process, 'platform', { value: platform })
    try {
      await run()
    } finally {
      Object.defineProperty(process, 'platform', { value: real })
    }
  }

  it('on macOS: the proxy icon names the file, the close button’s dot follows unsaved — and both clear', async () => {
    await asPlatform('darwin', async () => {
      attachProjectWindow(page.win as never)
      page.answer({ text: projectAt() })
      const target = join(review, 'mac.sgvue')
      saveAnswer(target)
      await saveProject(false)
      expect(page.win.setRepresentedFilename).toHaveBeenLastCalledWith(target)
      expect(page.win.setDocumentEdited).toHaveBeenLastCalledWith(false)
      setDirty(page.contents as never, { dirty: true })
      expect(page.win.setDocumentEdited).toHaveBeenLastCalledWith(true)
      // The ` •` is in the title text on macOS too.
      expect(page.win.setTitle).toHaveBeenLastCalledWith('mac • — SGVue')
      // A reload holds no project: the marks go.
      page.emit('did-finish-load')
      expect(page.win.setRepresentedFilename).toHaveBeenLastCalledWith('')
      expect(page.win.setDocumentEdited).toHaveBeenLastCalledWith(false)
      expect(page.win.setTitle).toHaveBeenLastCalledWith('SGVue')
    })
  })

  it('elsewhere: the title alone', async () => {
    await asPlatform('win32', async () => {
      attachProjectWindow(page.win as never)
      page.answer({ text: projectAt() })
      saveAnswer(join(review, 'win.sgvue'))
      await saveProject(false)
      setDirty(page.contents as never, { dirty: true })
      page.emit('did-finish-load')
      expect(page.win.setTitle).toHaveBeenCalledWith('win • — SGVue')
      expect(page.win.setRepresentedFilename).not.toHaveBeenCalled()
      expect(page.win.setDocumentEdited).not.toHaveBeenCalled()
    })
  })
})

describe('relPathFor — a carried model keeps the pointer its file had', () => {
  it('re-saved to the file it came from, the relPath is the same string', () => {
    const m = { relPath: '../shared/STR.ifc', absPath: '/old/place/STR.ifc' }
    expect(relPathFor(m, '/p/review/r.sgvue', '/p/review/r.sgvue')).toBe('../shared/STR.ifc')
  })

  it('saved elsewhere, it is re-based so it still points at the same place', () => {
    const m = { relPath: '../shared/STR.ifc', absPath: '/old/place/STR.ifc' }
    expect(relPathFor(m, '/p/review/copies/r.sgvue', '/p/review/r.sgvue')).toBe('../../shared/STR.ifc')
  })

  it('an open model (relPath null), or nothing to re-base against: worked out from absPath', () => {
    expect(relPathFor({ relPath: null, absPath: '/p/review/models/A.ifc' }, '/p/review/r.sgvue', '/p/review/r.sgvue')).toBe(
      'models/A.ifc'
    )
    expect(relPathFor({ relPath: 'x/A.ifc', absPath: '/p/review/models/A.ifc' }, '/p/review/r.sgvue', null)).toBe(
      'models/A.ifc'
    )
  })
})

/* ────────────────────────────── reading ────────────────────────────── */

describe('openProject', () => {
  const openAnswer = (path: string | undefined) =>
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: !path, filePaths: path ? [path] : [] })
  const opened = () => page.sent.filter(([c]) => c === CH_PROJECT_OPENED).map(([, m]) => m as Record<string, unknown>)

  it('reads the project, admits each model by relPath first, and makes it the open project', async () => {
    // relPaths point where the models are; absPaths at a folder that no longer exists.
    const p = readProject(projectAt())
    if (!p.ok) throw new Error(p.message)
    const file = join(review, 'opened.sgvue')
    const rel = ['models/ARC.ifc', '../shared/STR.ifc']
    const moved = {
      ...p.project,
      models: p.project.models.map((m, i) => ({ ...m, relPath: rel[i], absPath: join(root, 'gone', m.name) }))
    }
    writeFileSync(file, projectText(moved))
    openAnswer(file)
    await openProject()
    const opts = dialog.showOpenDialog.mock.calls[0][1] as { filters: unknown[] }
    expect(opts.filters).toEqual([{ name: 'SGVue project', extensions: ['sgvue'] }])
    const [msg] = opened()
    expect(msg.ok).toBe(true)
    expect(msg.name).toBe('opened')
    const got = msg.models as { id: string; file: { name: string } | null }[]
    expect(got.map((m) => [m.id, m.file?.name ?? null])).toEqual([
      ['m1', 'ARC.ifc'],
      ['m2', 'STR.ifc']
    ])
    expect(projects.currentProject()).toBe(file)
    expect(page.win.setTitle).toHaveBeenLastCalledWith('opened — SGVue')
  })

  it('refuses a file the reader refuses — and the open project stays the open one', async () => {
    page.answer({ text: projectAt() })
    const kept = join(review, 'kept.sgvue')
    saveAnswer(kept)
    await saveProject(false)
    const bad = join(review, 'bad.sgvue')
    writeFileSync(bad, '{"format":"sgvue-project","version":9}')
    openAnswer(bad)
    await openProject()
    expect(opened()).toEqual([
      { ok: false, name: 'bad', message: expect.stringMatching(/newer SGVue/) as unknown as string }
    ])
    expect(projects.currentProject()).toBe(kept)
  })

  it('refuses a file over 16 MiB unread, and does nothing on Cancel', async () => {
    const huge = join(review, 'huge.sgvue')
    writeFileSync(huge, Buffer.alloc(PROJECT_MAX_BYTES + 1, 0x20))
    openAnswer(huge)
    await openProject()
    expect(opened()[0]).toEqual({ ok: false, name: 'huge', message: expect.stringMatching(/larger than 16 MB/) })
    openAnswer(undefined)
    await openProject()
    expect(opened()).toHaveLength(1)
    rmSync(huge)
  })

  it('Save before Open with nothing to save (the demo on screen): says why, and opens nothing', async () => {
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'before-open.sgvue'))
    await saveProject(false)
    setDirty(page.contents as never, { dirty: true })
    page.answer({ text: null, reason: 'no-files' })
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 })
    await openProject()
    expect((dialog.showMessageBox.mock.calls[1][1] as { detail: string }).detail).toBe(NOTHING_REASON['no-files'])
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('asks before replacing a project with unsaved changes — Cancel opens nothing', async () => {
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'dirty.sgvue'))
    await saveProject(false)
    setDirty(page.contents as never, { dirty: true })
    dialog.showMessageBox.mockResolvedValueOnce({ response: 2 })
    await openProject()
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })
})

describe('admitProjectModels', () => {
  it('lets through only what admit() does: a missing model is null, an empty one is refused with its reason', async () => {
    const empty = join(models, 'EMPTY.ifc')
    writeFileSync(empty, '')
    const p = readProject(projectAt())
    if (!p.ok) throw new Error(p.message)
    const project = {
      ...p.project,
      models: [
        { ...p.project.models[0], relPath: 'models/ARC.ifc', absPath: join(root, 'x', 'ARC.ifc') },
        { ...p.project.models[1], relPath: null, absPath: join(root, 'nowhere', 'STR.ifc') },
        { ...p.project.models[1], id: 'm3', relPath: null, absPath: empty },
        // A network path in a local project is never touched.
        { ...p.project.models[1], id: 'm4', relPath: null, absPath: '\\\\attacker\\share\\x.ifc' }
      ]
    }
    const got = await admitProjectModels(join(review, 'p.sgvue'), project, new Set())
    expect(got.map((m) => [m.id, m.file?.path ?? null, m.refused?.reason ?? null])).toEqual([
      ['m1', expect.stringMatching(/models[\\/]ARC\.ifc$/), null],
      ['m2', null, null],
      ['m3', null, expect.any(String)],
      ['m4', null, null]
    ])
  })
})

/* ────────────────────────────── Locate… (phase 4, D4) ────────────────────────────── */

describe('project:locate — a missing model’s Locate…', () => {
  const pick = (path: string | undefined) =>
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: !path, filePaths: path ? [path] : [] })
  async function openOne(): Promise<void> {
    const file = join(review, 'locate.sgvue')
    writeFileSync(file, projectAt())
    pick(file)
    await openProject()
    dialog.showOpenDialog.mockReset()
  }

  it('answers the main window’s page alone, before the payload is read, and takes a name — never a path or anything more', async () => {
    await openOne()
    const other = { ...page.contents }
    await expect(locateModel(other as never, { name: 'STR.ifc' })).rejects.toThrow('not available')
    await expect(locateModel(page.contents as never, { name: 'STR.ifc', path: STR })).rejects.toThrow()
    await expect(locateModel(page.contents as never, { name: 'a\u0000b' })).rejects.toThrow()
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('with no project open: no dialog, and nothing', async () => {
    expect(await locateModel(page.contents as never, { name: 'STR.ifc' })).toBeNull()
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('the native Open dialog for one IFC; the pick through admit(): a file, a reason, or nothing — and null when cancelled', async () => {
    await openOne()
    pick(STR)
    expect(await locateModel(page.contents as never, { name: 'STR.ifc' })).toEqual({
      file: { path: STR, name: 'STR.ifc', size: readFileSync(STR).length },
      refused: null
    })
    const opts = dialog.showOpenDialog.mock.calls[0][1] as { title: string; properties: string[]; filters: unknown[] }
    expect(opts.title).toBe('Locate "STR.ifc"')
    expect(opts.properties).toEqual(['openFile'])
    expect(opts.filters).toEqual([{ name: 'IFC models', extensions: ['ifc', 'ifczip'] }])

    const empty = join(models, 'EMPTY-locate.ifc')
    writeFileSync(empty, '')
    pick(empty)
    const refused = await locateModel(page.contents as never, { name: 'STR.ifc' })
    expect(refused?.file).toBeNull()
    expect(refused?.refused).toEqual({ name: 'EMPTY-locate.ifc', reason: expect.any(String) })

    pick(join(root, 'nowhere', 'STR.ifc'))
    expect(await locateModel(page.contents as never, { name: 'STR.ifc' })).toEqual({ file: null, refused: null })

    pick(undefined)
    expect(await locateModel(page.contents as never, { name: 'STR.ifc' })).toBeNull()
    // It wrote nothing: the project file is the one that was opened.
    expect(readFileSync(join(review, 'locate.sgvue'), 'utf8')).toBe(projectAt())
  })
})

/* ────────────────────────────── closing and quitting ────────────────────────────── */

describe('afterQuestionSave — Save chosen in the question', () => {
  it('goes on when saved or when nothing is open; stays, saying why, for anything else', () => {
    expect(afterQuestionSave({ kind: 'saved' })).toEqual({ go: true, explain: null })
    expect(afterQuestionSave({ kind: 'cancelled' })).toEqual({ go: false, explain: null })
    expect(afterQuestionSave({ kind: 'failed' })).toEqual({ go: false, explain: null })
    expect(afterQuestionSave({ kind: 'nothing', reason: 'no-models' })).toEqual({ go: true, explain: null })
    for (const reason of ['loading', 'no-files', 'too-large', 'failed', 'no-answer'] as const) {
      const r = afterQuestionSave({ kind: 'nothing', reason })
      expect([reason, r.go]).toEqual([reason, false])
      expect(r.explain).toBe(NOTHING_REASON[reason])
      expect(r.explain!.length).toBeGreaterThan(10)
    }
  })
})

describe('the question on close', () => {
  async function dirtyProject(): Promise<void> {
    attachProjectWindow(page.win as never)
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'q.sgvue'))
    await saveProject(false)
    setDirty(page.contents as never, { dirty: true })
  }
  const close = () => {
    const event = { preventDefault: vi.fn() }
    page.emit('close', event)
    return event
  }
  const settle = () => new Promise((r) => setTimeout(r, 10))
  /**
   * 2026-11-08 — until `check` holds: the question, the save and its real disk write run on their
   * own, and a fixed 10 ms was not always enough on a loaded machine (seen at phase 3's HEAD too).
   */
  const until = (check: () => void) => vi.waitFor(check, { timeout: 3000, interval: 5 })

  it('with no project, or none unsaved, a close goes through with no question', async () => {
    attachProjectWindow(page.win as never)
    expect(close().preventDefault).not.toHaveBeenCalled()
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'clean.sgvue'))
    await saveProject(false)
    expect(close().preventDefault).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('Cancel keeps the window', async () => {
    await dirtyProject()
    dialog.showMessageBox.mockResolvedValueOnce({ response: 2 })
    expect(close().preventDefault).toHaveBeenCalled()
    await until(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1))
    await settle()
    const box = dialog.showMessageBox.mock.calls[0][1] as { buttons: string[]; cancelId: number }
    expect(box.buttons).toEqual(['Save', "Don't Save", 'Cancel'])
    expect(box.cancelId).toBe(2)
    expect(page.win.close).not.toHaveBeenCalled()
  })

  it('Don’t Save closes without writing; Save writes, then closes', async () => {
    await dirtyProject()
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })
    close()
    await until(() => expect(page.win.close).toHaveBeenCalledTimes(1))
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1)

    page = fakeWindow()
    setMainWindow(page.win as never)
    resetProjects()
    await dirtyProject()
    writeFileSync(join(review, 'q.sgvue'), 'stale')
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    close()
    await until(() => expect(page.win.close).toHaveBeenCalledTimes(1))
    expect(savedTo(join(review, 'q.sgvue')).format).toBe('sgvue-project')
  })

  it('Save with nothing to save because a project is still loading: the box says why, and the window stays', async () => {
    await dirtyProject()
    page.answer({ text: null, reason: 'loading' })
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 })
    close()
    await until(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(2))
    await settle()
    expect(page.win.close).not.toHaveBeenCalled()
    const box = dialog.showMessageBox.mock.calls[1][1] as { title: string; message: string; detail: string }
    expect(box).toMatchObject({ title: 'Could not save project', message: '"q.sgvue" could not be saved.' })
    expect(box.detail).toBe(NOTHING_REASON.loading)
  })

  it('Save with no model open: nothing is unsaved, so the close goes on', async () => {
    await dirtyProject()
    page.answer({ text: null, reason: 'no-models' })
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    close()
    await until(() => expect(page.win.close).toHaveBeenCalledTimes(1))
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  })

})

/* ────────────────────────────── phase 5 (D10): double-click and drop ────────────────────────────── */

describe('a project the OS or a drop hands the app — the same open, question first', () => {
  const opened = () => page.sent.filter(([c]) => c === CH_PROJECT_OPENED).map(([, m]) => m as Record<string, unknown>)
  const until = (check: () => void) => vi.waitFor(check, { timeout: 3000, interval: 5 })
  const settle = () => new Promise((r) => setTimeout(r, 20))
  const onDisk = (name: string): string => {
    const path = join(review, name)
    writeFileSync(path, projectAt())
    return path
  }
  /** The window's page: loaded, and — unless `listening` is false — saying it listens. */
  function pageUp(listening = true): void {
    attachProjectWindow(page.win as never)
    page.emit('did-navigate')
    page.emit('did-finish-load')
    if (listening) projectPageReady(page.contents as never, undefined)
  }

  it('givenPathProblem: a .sgvue by name; a network path only from the OS', () => {
    expect(givenPathProblem('/d/a.sgvue', 'os')).toBeNull()
    expect(givenPathProblem('/d/a.SGVUE', 'drop')).toBeNull()
    expect(givenPathProblem('/d/a.ifc', 'os')).toBe(NOT_A_PROJECT)
    expect(givenPathProblem('/d/a.sgvue.json', 'drop')).toBe(NOT_A_PROJECT)
    expect(givenPathProblem('\\\\server\\share\\a.sgvue', 'os')).toBeNull()
    expect(givenPathProblem('\\\\server\\share\\a.sgvue', 'drop')).toBe(NETWORK_DROP)
    expect(givenPathProblem('\\\\?\\C:\\a.sgvue', 'drop')).toBe(NETWORK_DROP)
    expect(givenPathProblem('//server/share/a.sgvue', 'drop')).toBe(NETWORK_DROP)
  })

  it('from the OS before the page listens: parked, then opened once it does — never sent to a deaf page', async () => {
    const path = onDisk('double-clicked.sgvue')
    attachProjectWindow(page.win as never)
    openProjectFromOS(path)
    await settle()
    expect(opened()).toEqual([])
    page.emit('did-navigate')
    page.emit('did-finish-load')
    await settle()
    expect(opened()).toEqual([])
    projectPageReady(page.contents as never, undefined)
    await until(() => expect(opened()).toHaveLength(1))
    expect(opened()[0]).toMatchObject({ ok: true, name: 'double-clicked' })
    expect(projects.currentProject()).toBe(path)
    expect(page.win.focus).toHaveBeenCalled()
    // The menu's dialog was never shown: the path was the OS's.
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('from the OS after ready: opened at once; a reload makes it wait for the new page', async () => {
    pageUp()
    const path = onDisk('second-launch.sgvue')
    openProjectFromOS(path)
    await until(() => expect(opened()).toHaveLength(1))
    page.emit('did-navigate')
    openProjectFromOS(onDisk('after-reload.sgvue'))
    await settle()
    expect(opened()).toHaveLength(1)
    page.emit('did-finish-load')
    projectPageReady(page.contents as never, undefined)
    await until(() => expect(opened()).toHaveLength(2))
    expect(opened()[1]).toMatchObject({ ok: true, name: 'after-reload' })
  })

  it('from the OS with unsaved changes: the question comes first — Cancel opens nothing, the open project stays', async () => {
    pageUp()
    page.answer({ text: projectAt() })
    const kept = join(review, 'kept-os.sgvue')
    saveAnswer(kept)
    await saveProject(false)
    setDirty(page.contents as never, { dirty: true })
    dialog.showMessageBox.mockResolvedValueOnce({ response: 2 })
    openProjectFromOS(onDisk('incoming.sgvue'))
    await until(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1))
    await settle()
    expect((dialog.showMessageBox.mock.calls[0][1] as { buttons: string[] }).buttons).toEqual(['Save', "Don't Save", 'Cancel'])
    expect(opened()).toEqual([])
    expect(projects.currentProject()).toBe(kept)
  })

  it('from the OS with unsaved changes — Don’t Save: opened', async () => {
    pageUp()
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'discard-os.sgvue'))
    await saveProject(false)
    setDirty(page.contents as never, { dirty: true })
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })
    const path = onDisk('incoming2.sgvue')
    openProjectFromOS(path)
    await until(() => expect(opened()).toHaveLength(1))
    expect(projects.currentProject()).toBe(path)
  })

  it('a drop: opened as the menu opens a pick, and answers that it was sent', async () => {
    pageUp()
    const path = onDisk('dropped.sgvue')
    expect(await openDroppedProject(page.contents as never, { path })).toBe(true)
    expect(opened()).toHaveLength(1)
    expect(opened()[0]).toMatchObject({ ok: true, name: 'dropped' })
    expect(projects.currentProject()).toBe(path)
  })

  it('a drop with unsaved changes: the question first, and Cancel answers false with nothing sent', async () => {
    pageUp()
    page.answer({ text: projectAt() })
    saveAnswer(join(review, 'kept-drop.sgvue'))
    await saveProject(false)
    setDirty(page.contents as never, { dirty: true })
    dialog.showMessageBox.mockResolvedValueOnce({ response: 2 })
    expect(await openDroppedProject(page.contents as never, { path: onDisk('dropped2.sgvue') })).toBe(false)
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(opened()).toEqual([])
  })

  it('one drop heard twice opens once: the second is refused while the first runs', async () => {
    pageUp()
    const path = onDisk('twice.sgvue')
    const [a, b] = await Promise.all([
      openDroppedProject(page.contents as never, { path }),
      openDroppedProject(page.contents as never, { path })
    ])
    expect([a, b]).toEqual([true, false])
    expect(opened()).toHaveLength(1)
  })

  it('a drop refuses a network path before touching it, and a file that is not a project', async () => {
    pageUp()
    expect(await openDroppedProject(page.contents as never, { path: '\\\\attacker\\share\\x.sgvue' })).toBe(true)
    expect(opened()[0]).toEqual({ ok: false, name: 'x', message: NETWORK_DROP })
    const ifc = join(review, 'model.ifc')
    writeFileSync(ifc, 'ISO-10303-21;')
    await openDroppedProject(page.contents as never, { path: ifc })
    expect(opened()[1]).toMatchObject({ ok: false, message: NOT_A_PROJECT })
    // Neither asked anything, nor became the open project.
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(projects.currentProject()).toBeNull()
  })

  it('refuses a directory called x.sgvue, a link to a non-project, and a file over 16 MiB', async () => {
    pageUp()
    const dir = join(review, 'folder.sgvue')
    mkdirSync(dir, { recursive: true })
    await openDroppedProject(page.contents as never, { path: dir })
    expect(opened()[0]).toMatchObject({ ok: false, message: 'This project file could not be read.' })
    const target = join(review, 'plain.txt')
    writeFileSync(target, projectAt())
    const link = join(review, 'disguised.sgvue')
    rmSync(link, { force: true })
    const { symlinkSync } = await import('node:fs')
    symlinkSync(target, link)
    await openDroppedProject(page.contents as never, { path: link })
    expect(opened()[1]).toMatchObject({ ok: false, message: NOT_A_PROJECT })
    const huge = join(review, 'huge-drop.sgvue')
    writeFileSync(huge, Buffer.alloc(PROJECT_MAX_BYTES + 1, 0x20))
    await openDroppedProject(page.contents as never, { path: huge })
    expect(opened()[2]).toMatchObject({ ok: false, message: expect.stringMatching(/larger than 16 MB/) as unknown as string })
    rmSync(huge)
  })

  it('answers only the main window’s page, before the payload is read', () => {
    pageUp()
    const other = { send: vi.fn() }
    expect(() => openDroppedProject(other as never, { path: 'not even checked' })).toThrow('not available')
    expect(() => projectPageReady(other as never, undefined)).toThrow('not available')
    expect(() => openDroppedProject(page.contents as never, { path: '' })).toThrow()
    expect(() => openDroppedProject(page.contents as never, { path: '/d/a\u0000.sgvue' })).toThrow()
  })
})
