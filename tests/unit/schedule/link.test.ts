/**
 * The main window's end of the Schedules port (`renderer/model/schedule-link.ts`) — phase 3,
 * 2026-09-25, and the phase-1 review's leftover: the guard that ignores an oversized `select`
 * and de-duplicates ids.
 *
 * Driven through the real store with a stub viewer and a fake port, so what is asserted is
 * what the main window would do: every row-menu action lands on the store action the main
 * ContextMenu calls (and so on the main window's undo stack), a colour-by from a column goes
 * through the legend's own state, and the selection comes back over the port at most once per
 * frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { SCHEME } from '../../../src/shared/colors'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import {
  colourByColumn,
  connect,
  defineSchedule,
  openSchedule,
  receive,
  requestExport,
  scheduleConnected,
  scheduleStore,
  scheduleStoreHeld,
  whenScheduleConnected
} from '../../../src/renderer/model/schedule-link'
import { emptySchedule, parseScheduleDef, type ScheduleDef } from '../../../src/schedule/schedule/def'
import { setViewer, useShell, type ShellState } from '../../../src/renderer/state/shell'
import { resetShell, stubViewer } from '../stub-viewer'

const full = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
const st = (): ShellState => useShell.getState()
const ids = full.elements.map((e) => e.id)

beforeEach(() => {
  resetShell()
  setViewer(stubViewer())
  st().commitModels(full)
})
afterEach(() => {
  connect(null)
  setViewer(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('select from the table', () => {
  it('selects through the store, de-duplicated and without ids the federation lacks', () => {
    const select = vi.spyOn(st(), 'select')
    receive({ type: 'select', ids: [ids[2], ids[1], ids[2], 987_654_321], zoom: true })
    expect(select).toHaveBeenCalledWith([ids[2], ids[1]], true)
    expect(st().selIds).toEqual([ids[2], ids[1]])
  })

  it('ignores a list longer than the federation, whole', () => {
    st().select([ids[0]])
    const select = vi.spyOn(st(), 'select')
    receive({ type: 'select', ids: [...ids, ids[0]], zoom: false })
    expect(select).not.toHaveBeenCalled()
    expect(st().selIds).toEqual([ids[0]])
  })

  it('ignores anything that fails its schema', () => {
    const select = vi.spyOn(st(), 'select')
    receive({ type: 'select', ids: ['1'], zoom: true })
    receive({ type: 'act', kind: 'delete', ids: [ids[0]] })
    receive({ type: 'colourBy', label: '', key: 'k', groups: [] })
    receive('schedule:port')
    expect(select).not.toHaveBeenCalled()
  })
})

describe('the row menu acts through the main ContextMenu’s own store actions', () => {
  it('isolate, hide, show and show all — each one undoable in the main window', () => {
    const two = [ids[0], ids[1]]
    receive({ type: 'act', kind: 'isolate', ids: two })
    expect(st().visibleCount).toBe(2)
    expect(st().canUndo).toBe(true)
    st().step(true)
    expect(st().visibleCount).toBe(full.elements.length)

    receive({ type: 'act', kind: 'hide', ids: two })
    expect(st().hidden[ids[0]] && st().hidden[ids[1]]).toBe(true)
    receive({ type: 'act', kind: 'show', ids: [ids[0]] })
    expect(st().hidden[ids[0]]).toBeUndefined()
    receive({ type: 'act', kind: 'showAll', ids: [] })
    expect(st().hidden).toEqual({})
  })

  it('select and zoom are the menu’s select and zoomTo', () => {
    const select = vi.spyOn(st(), 'select')
    receive({ type: 'act', kind: 'select', ids: [ids[3]] })
    receive({ type: 'act', kind: 'zoom', ids: [ids[4], ids[4]] })
    expect(select.mock.calls).toEqual([[[ids[3]], false], [[ids[4]], true]])
  })

  it('an act on nothing the federation carries is refused — isolate([]) would hide everything', () => {
    const isolate = vi.spyOn(st(), 'isolate')
    const hide = vi.spyOn(st(), 'hide')
    const select = vi.spyOn(st(), 'select')
    // Ids from a model unloaded after the table's right-click: all of them admitted away.
    receive({ type: 'act', kind: 'isolate', ids: [987_654_321, 987_654_322] })
    receive({ type: 'act', kind: 'hide', ids: [] })
    receive({ type: 'act', kind: 'zoom', ids: [987_654_321] })
    expect(isolate).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
    expect(st().visibleCount).toBe(full.elements.length)
    // A `select` of nothing is a deselect, and stays one.
    st().select([ids[0]])
    receive({ type: 'select', ids: [987_654_321], zoom: false })
    expect(st().selIds).toEqual([])
  })

  it('an oversized act is ignored', () => {
    const isolate = vi.spyOn(st(), 'isolate')
    receive({ type: 'act', kind: 'isolate', ids: [...ids, ids[0]] })
    expect(isolate).not.toHaveBeenCalled()
  })
})

describe('colour 3D by a column', () => {
  it('sets the legend’s own scheme — the column label, its values, SCHEME colours by size', () => {
    receive({
      type: 'colourBy', label: 'Level', key: 'core|storey',
      groups: [
        { value: 'L1', ids: [ids[0]] },
        { value: 'L2', ids: [ids[1], ids[2], ids[1]] },
        { value: 'L3', ids: [987_654_321] },
      ],
    })
    const scheme = st().colorBy!
    expect(scheme.prop).toBe('Level')
    expect(scheme.groups.map((g) => [g.v, g.n, g.color])).toEqual([
      ['L2', 2, SCHEME[0]],
      ['L1', 1, SCHEME[1]],
    ])
    receive({ type: 'clearColours' })
    expect(st().colorBy).toBeNull()
  })

  it('an element is claimed by one colour only, and an oversized request is ignored', () => {
    receive({ type: 'colourBy', label: 'A', key: 'k', groups: [
      { value: 'x', ids: [ids[0]] }, { value: 'y', ids: [ids[0], ids[1]] },
    ] })
    expect(st().colorBy!.groups.map((g) => [g.v, g.ids])).toEqual([['x', [ids[0]]], ['y', [ids[1]]]])
    receive({ type: 'colourBy', label: 'B', key: 'k', groups: [{ value: 'z', ids: [...ids, ids[0]] }] })
    expect(st().colorBy!.prop).toBe('A')
  })
})

/** A port that records what the main window posts. */
function fakePort(): { port: MessagePort; sent: { type: string; [k: string]: unknown }[] } {
  const sent: { type: string; [k: string]: unknown }[] = []
  const port = { postMessage: (m: never) => sent.push(m), close: () => undefined, onmessage: null }
  return { port: port as unknown as MessagePort, sent }
}

describe('what the main window sends', () => {
  let frames: (() => void)[] = []
  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => frames.push(fn))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })
  const nextFrame = (): void => {
    const run = frames
    frames = []
    for (const f of run) f()
  }

  it('on connect: the theme, the snapshot with the sidebar’s model names, then one selection, vis and colours', () => {
    const { port, sent } = fakePort()
    connect(port)
    expect(sent.map((m) => m.type)).toEqual(['theme', 'store', 'colours'])
    const snapshot = sent[1].snapshot as { cores: { model: string }[] }
    // No upload names and no library here: the name is the file name without its extension.
    expect(new Set(snapshot.cores.map((c) => c.model))).toEqual(
      new Set(full.models.map((m) => m.meta.fileName.replace(/\.[^.]+$/, ''))))
    nextFrame()
    expect(sent.slice(3).map((m) => m.type)).toEqual(['selection', 'vis'])
    expect(sent[3]).toEqual({ type: 'selection', ids: [], quiet: false })
    expect(sent[4]).toMatchObject({ type: 'vis', hidden: [], total: full.elements.length, allShown: true })
  })

  it('a burst of selection changes is one post per frame; one the table made is quiet', () => {
    const { port, sent } = fakePort()
    connect(port)
    nextFrame()
    sent.length = 0
    st().select([ids[0]])
    st().select([ids[1]])
    st().select([ids[1], ids[2]])
    expect(sent).toEqual([])
    nextFrame()
    expect(sent).toEqual([{ type: 'selection', ids: [ids[1], ids[2]], quiet: false }])

    sent.length = 0
    receive({ type: 'select', ids: [ids[5]], zoom: false })
    nextFrame()
    expect(sent).toEqual([{ type: 'selection', ids: [ids[5]], quiet: true }])
  })

  it('a hide sends the hidden set; Show all would then do something', () => {
    const { port, sent } = fakePort()
    connect(port)
    nextFrame()
    sent.length = 0
    st().hide([ids[0]])
    nextFrame()
    expect(sent).toEqual([{
      type: 'vis', hidden: [ids[0]], total: full.elements.length, storeysClean: true, allShown: false,
    }])
  })

  it('colours carry the column key only while the table’s scheme is the live one', () => {
    const { port, sent } = fakePort()
    connect(port)
    sent.length = 0
    receive({ type: 'colourBy', label: 'Level', key: 'core|storey', groups: [{ value: 'L1', ids: [ids[0]] }] })
    const colours = () => sent.filter((m) => m.type === 'colours')
    const last = () => colours().at(-1)
    // One post, already carrying the column's key.
    expect(colours()).toEqual([{ type: 'colours', live: true, key: 'core|storey', entries: [{ value: 'L1', color: SCHEME[0] }] }])
    // Another scheme (the assistant's, the legend's own) takes the key away.
    st().setColorBy('IfcEntity')
    expect(last()).toEqual({ type: 'colours', live: true, key: null, entries: [] })
    st().clearColorBy()
    expect(last()).toEqual({ type: 'colours', live: false, key: null, entries: [] })
  })
})

/* ────────────────────────────── 2026-09-28: the assistant's schedule ────────────────────────────── */

describe('the schedule the assistant sees and makes', () => {
  const doors = (): ScheduleDef => ({
    ...emptySchedule('Doors', ['IfcDoor']),
    columns: [{ field: { kind: 'core', key: 'name' } }]
  })
  const cur = (def: unknown, rowCount = 7) => ({ type: 'current', def, rowCount })

  it('keeps the schedule the window says is on screen, read by parseScheduleDef, with its row count', () => {
    const { port } = fakePort()
    connect(port)
    expect(openSchedule()).toBeNull()
    receive(cur(doors(), 12))
    expect(openSchedule()).toEqual({ def: parseScheduleDef(doors()), rowCount: 12 })
    receive(cur(null, 0))
    expect(openSchedule()).toBeNull()
  })

  it('treats a schedule parseScheduleDef refuses as none, and ignores one that fails its schema', () => {
    const { port } = fakePort()
    connect(port)
    receive(cur(doors()))
    receive(cur({ ...doors(), columns: [] }))
    expect(openSchedule()).toBeNull()
    receive(cur(doors()))
    receive(cur({ ...doors(), version: 99 }))
    expect(openSchedule()).toBeNull()
    receive(cur(doors()))
    receive(cur({ ...doors(), columns: [{ field: { kind: 'eval', code: '1' } }] }))
    receive(cur(doors(), -1))
    receive({ type: 'current', def: doors() })
    // Refused by its schema: ignored whole, so what was on screen stays.
    expect(openSchedule()).toEqual({ def: parseScheduleDef(doors()), rowCount: 7 })
  })

  it('forgets it with the port — a closed window, or a new page', () => {
    const { port } = fakePort()
    connect(port)
    receive(cur(doors()))
    connect(fakePort().port)
    expect(openSchedule()).toBeNull()
    receive(cur(doors()))
    connect(null)
    expect(openSchedule()).toBeNull()
    expect(scheduleConnected()).toBe(false)
  })

  it('sends a schedule to the window, after the snapshot, and keeps it at once with its row count', () => {
    expect(defineSchedule(doors(), 'made', 3)).toBe(false)
    const { port, sent } = fakePort()
    connect(port)
    expect(defineSchedule(doors(), 'made', 3)).toBe(true)
    expect(sent.map((m) => m.type)).toEqual(['theme', 'store', 'colours', 'define'])
    expect(sent.at(-1)).toEqual({ type: 'define', kind: 'made', def: doors() })
    expect(openSchedule()).toEqual({ def: doors(), rowCount: 3 })
  })

  it('waits for a window to join, and gives up after the time it is given', async () => {
    vi.useFakeTimers()
    const late = whenScheduleConnected(8000)
    const { port } = fakePort()
    connect(port)
    await expect(late).resolves.toBe(true)
    await expect(whenScheduleConnected(8000)).resolves.toBe(true)
    connect(null)
    const never = whenScheduleConnected(8000)
    vi.advanceTimersByTime(8000)
    await expect(never).resolves.toBe(false)
  })

  it('builds the assistant’s store once per federation', () => {
    connect(fakePort().port)
    const a = scheduleStore(st())
    expect(a.store.cores).toHaveLength(full.elements.length)
    expect(a.rowIds).toEqual(ids)
    expect(scheduleStore(st())).toBe(a)
  })

  it('releases the store the moment the federation changes — not on the next call — and with the window', () => {
    connect(fakePort().port)
    scheduleStore(st())
    expect(scheduleStoreHeld()).toBe(true)
    st().commitModels(federate([mockModelIndex('ARC')]))
    expect(scheduleStoreHeld()).toBe(false)
    scheduleStore(st())
    expect(scheduleStoreHeld()).toBe(true)
    connect(null)
    expect(scheduleStoreHeld()).toBe(false)
  })

  it('releases one built with no window joined, too — make_schedule fills it before one joins', () => {
    connect(null)
    scheduleStore(st())
    expect(scheduleStoreHeld()).toBe(true)
    st().commitModels(federate([mockModelIndex('STR')]))
    expect(scheduleStoreHeld()).toBe(false)
    // …and, released, it watches nothing: another change is harmless.
    st().commitModels(full)
    expect(scheduleStoreHeld()).toBe(false)
  })
})

/* ────────────────────────────── 2026-09-28: export and colour from chat ────────────────────────────── */

describe('an export the assistant asks for', () => {
  const exports = (sent: { type: string }[]) => sent.filter((m) => m.type === 'export') as unknown as { n: number; format: string }[]

  it('posts the format and a number, and resolves on the answer to that number — at once, never after the dialog', async () => {
    const { port, sent } = fakePort()
    connect(port)
    const asked = requestExport('xlsx', 3000)
    const [msg] = exports(sent)
    expect(msg).toEqual({ type: 'export', n: msg.n, format: 'xlsx' })
    // An answer to another request is not this one's.
    receive({ type: 'exportAck', n: msg.n + 1, refused: null })
    receive({ type: 'exportAck', n: msg.n, refused: null })
    await expect(asked).resolves.toBe('opened')
    const saved = requestExport('all_saved', 3000)
    receive({ type: 'exportAck', n: exports(sent)[1].n, refused: 'nothing_saved' })
    await expect(saved).resolves.toBe('nothing_saved')
  })

  it('one at a time: a second request while one waits is busy and is not sent', async () => {
    const { port, sent } = fakePort()
    connect(port)
    const first = requestExport('csv', 3000)
    await expect(requestExport('csv', 3000)).resolves.toBe('busy')
    expect(exports(sent)).toHaveLength(1)
    receive({ type: 'exportAck', n: exports(sent)[0].n, refused: 'busy' })
    await expect(first).resolves.toBe('busy')
  })

  it('closed with no window, or when the window goes before it answers; timeout when it never does', async () => {
    await expect(requestExport('csv', 3000)).resolves.toBe('closed')
    connect(fakePort().port)
    const pending = requestExport('csv', 3000)
    connect(null)
    await expect(pending).resolves.toBe('closed')
    vi.useFakeTimers()
    const { port, sent } = fakePort()
    connect(port)
    const late = requestExport('csv', 3000)
    vi.advanceTimersByTime(3000)
    await expect(late).resolves.toBe('timeout')
    // A late answer to it changes nothing, and the next request goes out.
    receive({ type: 'exportAck', n: exports(sent)[0].n, refused: null })
    const next = requestExport('xlsx', 3000)
    expect(exports(sent)).toHaveLength(2)
    receive({ type: 'exportAck', n: exports(sent)[1].n, refused: null })
    await expect(next).resolves.toBe('opened')
  })
})

describe('colourByColumn — the heading menu’s colour-by and the assistant’s, one path', () => {
  it('is what a `colourBy` message does: the ids admitted, the legend’s scheme, the column key kept', () => {
    const { port, sent } = fakePort()
    connect(port)
    const groups = [{ value: 'L1', ids: [ids[0], 987_654_321] }, { value: 'L2', ids: [ids[1], ids[2]] }]
    const scheme = colourByColumn('Level', 'core|storey', groups)
    expect(scheme).toBe(st().colorBy)
    expect(scheme!.groups.map((g) => [g.v, g.ids])).toEqual([['L2', [ids[1], ids[2]]], ['L1', [ids[0]]]])
    const viaMenu = st().colorBy
    st().clearColorBy()
    receive({ type: 'colourBy', label: 'Level', key: 'core|storey', groups })
    expect(st().colorBy).toEqual(viaMenu)
    expect(sent.filter((m) => m.type === 'colours').at(-1)).toMatchObject({ live: true, key: 'core|storey' })
    // Oversized: nothing coloured, the live scheme left alone.
    expect(colourByColumn('Other', 'k', [{ value: 'z', ids: [...ids, ids[0]] }])).toBeNull()
    expect(st().colorBy!.prop).toBe('Level')
  })
})
