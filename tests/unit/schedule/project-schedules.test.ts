/**
 * The `.sgvue` project file, phase 3 (plan D9) — a project's saved schedule setups over the
 * Schedules window's private port:
 *
 *   · the two messages (`projectSchedules` to the window, `projectSaved` back) are strict and
 *     bounded, and hostile input is refused whole;
 *   · `readSavedList` reads a list as the window's own reader does — bad definitions left out, a
 *     repeated name kept once, at most a hundred;
 *   · the window's list (`schedule-ui/schedules.ts`) is the project's while one is open: every
 *     read and write acts on it, each write is reported, `localStorage` is never touched — and
 *     with no project it is `localStorage`'s, as before;
 *   · the main window's end (`model/schedule-link.ts`) sends the project's list on connect, takes
 *     the window's `projectSaved` only while a project is open, and keeps the project's open
 *     schedule when the window closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import {
  connect,
  onProjectSchedules,
  projectSchedules,
  receive,
  setProjectSchedules
} from '../../../src/renderer/model/schedule-link'
import {
  FromSchedules,
  MANAGE_SAVED_MAX,
  MAX_SAVED_LIST_CHARS,
  portableSavedList,
  ProjectSavedMessage,
  readProjectSchedules,
  readSavedList,
  SAVED_NAME_MAX,
  ToSchedules
} from '../../../src/schedule/messages'
import { emptySchedule, parseScheduleDef, type ScheduleDef } from '../../../src/schedule/schedule/def'
import {
  deleteSchedule,
  duplicateSchedule,
  listSaved,
  projectListOn,
  refuseProjectList,
  renameSchedule,
  SAVED_KEY,
  saveSchedule,
  setProjectList,
  type SavedEntry
} from '../../../src/renderer/schedule-ui/schedules'
import { setViewer, useShell } from '../../../src/renderer/state/shell'
import { memoryStorage, resetShell, stubViewer } from '../stub-viewer'

const def = (name: string, entity = 'IfcDoor'): ScheduleDef => ({
  ...emptySchedule(name, [entity]),
  columns: [{ field: { kind: 'core', key: 'name' } }]
})
const entry = (name: string): SavedEntry => ({ name, def: def(name), savedAt: '2026-11-07T00:00:00Z' })

let storage: Storage
beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  setProjectList(null)
  setProjectSchedules(null)
  connect(null)
  vi.unstubAllGlobals()
})

/* ────────────────────────────── the messages ────────────────────────────── */

describe('projectSchedules and projectSaved — strict, bounded', () => {
  it('accept a project’s list, null, and an open schedule', () => {
    expect(ToSchedules.safeParse({ type: 'projectSchedules', saved: [entry('A')] }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'projectSchedules', saved: null }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'projectSchedules', saved: [], open: def('O') }).success).toBe(true)
    expect(FromSchedules.safeParse({ type: 'projectSaved', saved: [entry('A')] }).success).toBe(true)
  })

  it('refuse anything else, whole', () => {
    const bad: unknown[] = [
      { type: 'projectSchedules', saved: [entry('A')], path: '/etc/passwd' },
      { type: 'projectSchedules' },
      { type: 'projectSchedules', saved: [{ ...entry('A'), extra: 1 }] },
      { type: 'projectSchedules', saved: [{ ...entry('A'), name: '' }] },
      { type: 'projectSchedules', saved: [{ ...entry('A'), name: 'x'.repeat(1001) }] },
      { type: 'projectSchedules', saved: [{ ...entry('A'), savedAt: 'x'.repeat(65) }] },
      { type: 'projectSchedules', saved: [{ ...entry('A'), def: { name: 'not a schedule' } }] },
      { type: 'projectSchedules', saved: [{ ...entry('A'), def: { ...def('A'), columns: [{ field: { kind: 'eval', key: 'x' } }] } }] },
      { type: 'projectSchedules', saved: Array.from({ length: MANAGE_SAVED_MAX + 1 }, (_, i) => entry(`S${i}`)) },
      { type: 'projectSchedules', saved: [], open: { name: 'x' } },
      { type: 'projectSchedules', saved: 'all' },
      { type: 'projectSaved', saved: null },
      { type: 'projectSaved', saved: [entry('A')], n: 1 }
    ]
    for (const m of bad) {
      const ok = ToSchedules.safeParse(m).success || FromSchedules.safeParse(m).success
      expect(ok, JSON.stringify(m).slice(0, 120)).toBe(false)
    }
  })

  it(`refuse a list over ${MAX_SAVED_LIST_CHARS} characters, though each entry is within bounds`, () => {
    // A definition near its own 200 000-character cap, a hundred times: over the project's 16 MiB.
    const big = (i: number): SavedEntry => ({
      name: `S${i}`,
      def: { ...def(`S${i}`), meta: { note: 'x'.repeat(170_000) } } as unknown as ScheduleDef,
      savedAt: ''
    })
    const list = Array.from({ length: MANAGE_SAVED_MAX }, (_, i) => big(i))
    expect(JSON.stringify(list).length).toBeGreaterThan(MAX_SAVED_LIST_CHARS)
    expect(ProjectSavedMessage.safeParse({ type: 'projectSaved', saved: list }).success).toBe(false)
    expect(ProjectSavedMessage.safeParse({ type: 'projectSaved', saved: list.slice(0, 10) }).success).toBe(true)
  })
})

describe('readSavedList', () => {
  it('reads each definition as the window’s reader does, keeps a repeated name once, at most a hundred', () => {
    const list = [
      entry('A'),
      { name: 'Broken', def: { version: 1 }, savedAt: '' },
      { ...entry('A'), savedAt: 'later' },
      { name: 'Renamed', def: def('Old name'), savedAt: '' }
    ]
    const read = readSavedList(list)
    expect(read.map((e) => [e.name, e.def.name, e.savedAt])).toEqual([
      ['A', 'A', '2026-11-07T00:00:00Z'],
      ['Renamed', 'Renamed', '']
    ])
    expect(read[0].def).toEqual({ ...parseScheduleDef(def('A')) })
    // The input is untouched.
    expect(list[3].def).toEqual(def('Old name'))
    expect(readSavedList(Array.from({ length: 150 }, (_, i) => entry(`S${i}`)))).toHaveLength(MANAGE_SAVED_MAX)
  })

  it('reads its own output back unchanged — a definition read twice is the one read once', () => {
    const once = readSavedList([entry('A'), entry('B')])
    expect(readSavedList(once)).toEqual(once)
    expect(parseScheduleDef(parseScheduleDef(def('X')))).toEqual(parseScheduleDef(def('X')))
  })
})

/* ────────────────────────────── the window's list ────────────────────────────── */

describe('the Schedules window’s list while a project is open', () => {
  it('is the project’s: every write acts on it, is reported, and leaves localStorage alone', () => {
    const own = JSON.stringify([entry('Own')])
    storage.setItem(SAVED_KEY, own)
    const reports: SavedEntry[][] = []
    setProjectList([entry('P1')], (e) => reports.push(e))
    expect(projectListOn()).toBe(true)
    expect(listSaved().map((e) => e.name)).toEqual(['P1'])

    expect(saveSchedule(def('P2'), null)).toBe('P2')
    expect(renameSchedule('P1', 'P1 renamed')).toBe('ok')
    expect(duplicateSchedule('P2')).toBe('P2 (2)')
    deleteSchedule('P1 renamed')
    expect(listSaved().map((e) => e.name)).toEqual(['P2', 'P2 (2)'])
    expect(reports.map((r) => r.map((e) => e.name))).toEqual([
      ['P2', 'P1'],
      ['P2', 'P1 renamed'],
      ['P2', 'P2 (2)', 'P1 renamed'],
      ['P2', 'P2 (2)']
    ])
    // What a caller is handed is a copy: editing it changes nothing.
    listSaved()[0].name = 'tampered'
    expect(listSaved()[0].name).toBe('P2')
    expect(storage.getItem(SAVED_KEY)).toBe(own)

    // Closed: the window's own list again, as it was.
    setProjectList(null)
    expect(projectListOn()).toBe(false)
    expect(listSaved().map((e) => e.name)).toEqual(['Own'])
  })

  it('refuses a write the project could not carry, as full storage refuses one', () => {
    const reports: unknown[] = []
    setProjectList([], (e) => reports.push(e))
    const huge = { ...def('Huge'), name: 'x'.repeat(1001) }
    expect(saveSchedule(huge, null)).toBeNull()
    expect(listSaved()).toEqual([])
    expect(reports).toEqual([])
  })

  it('with no project, it is localStorage’s exactly as before', () => {
    expect(saveSchedule(def('L'), null)).toBe('L')
    expect((JSON.parse(storage.getItem(SAVED_KEY)!) as SavedEntry[]).map((e) => e.name)).toEqual(['L'])
  })
})

/* ────────────────────────────── the main window's end ────────────────────────────── */

function fakePort(): { port: MessagePort; sent: { type: string; [k: string]: unknown }[] } {
  const sent: { type: string; [k: string]: unknown }[] = []
  const port = { postMessage: (m: never) => sent.push(m), close: () => undefined, onmessage: null }
  return { port: port as unknown as MessagePort, sent }
}

describe('the main window’s end of it', () => {
  beforeEach(() => {
    resetShell()
    setViewer(stubViewer())
    useShell.getState().commitModels(federate([mockModelIndex('ARC')]))
  })
  afterEach(() => setViewer(null))

  it('with no project, connecting sends what it always sent, and a projectSaved is ignored', () => {
    const { port, sent } = fakePort()
    connect(port)
    expect(sent.map((m) => m.type)).toEqual(['theme', 'store', 'colours'])
    receive({ type: 'projectSaved', saved: [entry('Sneaked')] })
    expect(projectSchedules()).toBeNull()
  })

  it('sends a project’s list — and its open schedule — after the snapshot, and takes the window’s changes', () => {
    const saved = readSavedList([entry('P1')])
    setProjectSchedules({ saved, open: parseScheduleDef(def('Open')) })
    const { port, sent } = fakePort()
    connect(port)
    expect(sent.map((m) => m.type)).toEqual(['theme', 'store', 'projectSchedules', 'colours'])
    expect(sent[2]).toEqual({ type: 'projectSchedules', saved, open: parseScheduleDef(def('Open')) })

    const listener = vi.fn()
    onProjectSchedules(listener)
    receive({ type: 'projectSaved', saved: [entry('P2'), entry('P1')] })
    expect(projectSchedules()?.saved.map((e) => e.name)).toEqual(['P2', 'P1'])
    // Hostile: refused whole, the list unchanged.
    receive({ type: 'projectSaved', saved: [{ ...entry('P3'), extra: true }] })
    receive({ type: 'projectSaved', saved: Array.from({ length: 101 }, (_, i) => entry(`S${i}`)) })
    expect(projectSchedules()?.saved.map((e) => e.name)).toEqual(['P2', 'P1'])
    expect(listener).toHaveBeenCalledTimes(1)
    onProjectSchedules(null)

    // The window's schedule is the project's open one, and stays when the window closes.
    receive({ type: 'current', def: def('Shown'), rowCount: 3 })
    expect(projectSchedules()?.open?.name).toBe('Shown')
    connect(null)
    expect(projectSchedules()?.open?.name).toBe('Shown')

    // Closing the project tells a joined window; a first-save import sends no open schedule.
    const again = fakePort()
    connect(again.port)
    again.sent.length = 0
    setProjectSchedules(null)
    expect(again.sent).toEqual([{ type: 'projectSchedules', saved: null }])
    setProjectSchedules({ saved: [], open: parseScheduleDef(def('Kept')) })
    expect(again.sent.at(-1)).toEqual({ type: 'projectSchedules', saved: [] })
  })
})

/* ────────────────────────────── review fixes ────────────────────────────── */

describe('portableSavedList — only what the port can carry, and a count of the rest', () => {
  it('clips a name to the bound, leaves out a definition the port refuses, keeps a clipped name once', () => {
    const long = 'N'.repeat(SAVED_NAME_MAX + 300)
    const wide = { ...def('Wide'), columns: Array.from({ length: 201 }, () => ({ field: { kind: 'core' as const, key: 'name' as const } })) }
    const { saved, dropped } = portableSavedList([
      { name: long, def: def(long), savedAt: '' },
      { name: long + 'x', def: def('Other'), savedAt: '' },
      { name: 'Wide', def: wide, savedAt: '' },
      entry('Fine')
    ])
    expect(saved.map((e) => e.name)).toEqual(['N'.repeat(SAVED_NAME_MAX), 'Fine'])
    expect(saved[0].def.name).toBe('N'.repeat(SAVED_NAME_MAX))
    expect(dropped).toBe(2)
    // What it gives is what the window takes.
    expect(ProjectSavedMessage.safeParse({ type: 'projectSaved', saved }).success).toBe(true)
  })

  it('past the size bound, leaves out the oldest until the list fits', () => {
    const big = (i: number) => ({
      name: `S${i}`,
      def: { ...def(`S${i}`), meta: { note: 'x'.repeat(170_000) } } as unknown as ScheduleDef,
      savedAt: ''
    })
    const { saved, dropped } = portableSavedList(Array.from({ length: MANAGE_SAVED_MAX }, (_, i) => big(i)))
    expect(dropped).toBeGreaterThan(0)
    expect(saved.length + dropped).toBe(MANAGE_SAVED_MAX)
    expect(saved[0].name).toBe('S0')
    expect(JSON.stringify(saved).length).toBeLessThanOrEqual(MAX_SAVED_LIST_CHARS)
  })

  it('the main window holds and sends only that, and says what it left out', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const r = setProjectSchedules({ saved: [entry('A'), { name: 'B', def: { ...def('B'), columns: 'x' } as unknown as ScheduleDef, savedAt: '' }], open: { name: 'bad' } as unknown as ScheduleDef })
    expect(r).toEqual({ dropped: 1, openDropped: true })
    expect(projectSchedules()?.saved.map((e) => e.name)).toEqual(['A'])
    expect(projectSchedules()?.open).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('a projectSchedules the window cannot read', () => {
  it('is told apart from no project and from any other message', () => {
    expect(readProjectSchedules({ type: 'theme', theme: 'dark' })).toBeNull()
    expect(readProjectSchedules(null)).toBeNull()
    expect(readProjectSchedules({ type: 'projectSchedules', saved: null })).toEqual({ kind: 'none' })
    expect(readProjectSchedules({ type: 'projectSchedules', saved: [entry('A')] })).toMatchObject({ kind: 'project', open: null })
    expect(readProjectSchedules({ type: 'projectSchedules', saved: [{ ...entry('A'), name: 'x'.repeat(1001) }] })).toEqual({ kind: 'refused' })
    expect(readProjectSchedules({ type: 'projectSchedules', saved: [], extra: 1 })).toEqual({ kind: 'refused' })
  })

  it('leaves the window writing nowhere — never to localStorage — until a list it can read arrives', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const own = JSON.stringify([entry('Own')])
    storage.setItem(SAVED_KEY, own)
    refuseProjectList()
    expect(projectListOn()).toBe(true)
    expect(listSaved()).toEqual([])
    expect(saveSchedule(def('Lost'), null)).toBeNull()
    expect(renameSchedule('Own', 'X')).toBe('missing')
    deleteSchedule('Own')
    expect(storage.getItem(SAVED_KEY)).toBe(own)
    // A list it can read puts it back to work.
    setProjectList([entry('P')])
    expect(saveSchedule(def('Q'), null)).toBe('Q')
    expect(storage.getItem(SAVED_KEY)).toBe(own)
  })
})

describe('current from a schedule the window chose by itself', () => {
  beforeEach(() => {
    resetShell()
    setViewer(stubViewer())
    useShell.getState().commitModels(federate([mockModelIndex('ARC')]))
  })
  afterEach(() => setViewer(null))

  it('is accepted, still the assistant’s open schedule, and never a project’s', () => {
    expect(FromSchedules.safeParse({ type: 'current', def: def('D'), rowCount: 1, fromDefault: true }).success).toBe(true)
    expect(FromSchedules.safeParse({ type: 'current', def: def('D'), rowCount: 1, fromDefault: 'yes' }).success).toBe(false)
    setProjectSchedules({ saved: [], open: null })
    connect(fakePort().port)
    receive({ type: 'current', def: def('Default'), rowCount: 3, fromDefault: true })
    expect(projectSchedules()?.open).toBeNull()
    receive({ type: 'current', def: def('Picked'), rowCount: 3 })
    expect(projectSchedules()?.open?.name).toBe('Picked')
    // Back to a self-chosen one: the project has none open again.
    receive({ type: 'current', def: def('Default'), rowCount: 3, fromDefault: true })
    expect(projectSchedules()?.open).toBeNull()
  })
})
