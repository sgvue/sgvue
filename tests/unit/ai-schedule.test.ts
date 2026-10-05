/**
 * The assistant's two Schedules tools, end to end in the main renderer — 2026-09-28.
 *
 * Driven through `executeTool`, the one door every model call comes through, on the design's
 * mock federation, with a recording port standing in for the Schedules window
 * (`schedule-link.ts`'s own `connect`). What is asserted is what the model reads back and what
 * the window is sent — and that nothing is sent when the call is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { chatViewState } from '../../src/shared/ai-schema'
import { visFn } from '../../src/shared/rules'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { useShell } from '../../src/renderer/state/shell'
import {
  connect,
  openSchedule,
  receive,
  scheduleStore,
  scheduleStoreHeld
} from '../../src/renderer/model/schedule-link'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { CONNECT_WAIT_MS, EXPORT_ACK_MS, scheduleBriefOf } from '../../src/renderer/ai/executors/schedule'
import { colourColumn } from '../../src/schedule/colour'
import { MAX_COLOUR_GROUPS } from '../../src/schedule/messages'
import { StoreBuilder } from '../../src/schedule/ifc/store'
import { emptySchedule, type ScheduleDef } from '../../src/schedule/schedule/def'
import { resetShell } from './stub-viewer'

// `scheduleStore` as a spy around the real one, so a test can say it was never called.
vi.mock('../../src/renderer/model/schedule-link', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/model/schedule-link')>()
  return { ...real, scheduleStore: vi.fn(real.scheduleStore) }
})

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const full = federate(KEYS.map((k) => mockModelIndex(k)))
const doors = full.elements.filter((e) => e.type === 'IfcDoor')

type Body = { message: string; [k: string]: unknown }
const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: async () => ({ columns: [], rows: [], truncated: false, ms: 0 }) as never,
  rawLine: async () => null,
  turn
})
const run = async (name: string, input: unknown = {}): Promise<Body> =>
  (await executeTool(name, input, ctx())) as Body

function fakePort(): { port: MessagePort; sent: { type: string; [k: string]: unknown }[] } {
  const sent: { type: string; [k: string]: unknown }[] = []
  const port = { postMessage: (m: never) => sent.push(m), close: () => undefined, onmessage: null }
  return { port: port as unknown as MessagePort, sent }
}
const defines = (sent: { type: string }[]) => sent.filter((m) => m.type === 'define') as unknown as {
  kind: string
  def: ScheduleDef
}[]

const DOOR_SCHEDULE = {
  category: ['IfcDoor'],
  columns: [{ field: 'Name' }, { field: 'fire rating' }, { field: 'Width', total: 'sum' }],
  groupBy: ['Level'],
  grandTotals: true
}

beforeEach(() => {
  resetShell()
  useShell.getState().commitModels(full)
  Object.assign(turn, newTurnState())
  vi.mocked(scheduleStore).mockClear()
})
afterEach(() => {
  connect(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('get_schedule', () => {
  it('says so when no Schedules window is open, or it shows no schedule yet', async () => {
    expect((await run('get_schedule')).message).toContain('No Schedules window is open')
    connect(fakePort().port)
    expect((await run('get_schedule')).message).toBe('The Schedules window shows no schedule yet.')
  })

  it('reads the schedule the window reported, one page at a time, with a chip for its elements', async () => {
    connect(fakePort().port)
    receive({
      type: 'current',
      def: { ...emptySchedule('My doors', ['IfcDoor']), columns: [{ field: { kind: 'core', key: 'name' } }] },
      rowCount: doors.length
    })
    const body = await run('get_schedule', { limit: 2, offset: 1 })
    expect(body).toMatchObject({ headings: ['Name'], offset: 1, limit: 2, rowCount: doors.length, truncated: true })
    expect((body.rows as string[][]).map((r) => r[0])).toEqual(doors.slice(1, 3).map((d) => d.name))
    expect((body.schedule as { title: string }).title).toBe('My doors')
    expect(turn.chips).toEqual([{ label: `${doors.length} in schedule`, ids: doors.map((d) => d.id) }])
  })
})

describe('make_schedule', () => {
  it('builds it, sends it to the window, and hands back the rows and totals it shows', async () => {
    const { port, sent } = fakePort()
    connect(port)
    const body = await run('make_schedule', DOOR_SCHEDULE)

    const [sentDef] = defines(sent)
    // The tools do build the store — which is what makes the view-state test below mean something.
    expect(vi.mocked(scheduleStore)).toHaveBeenCalled()
    expect(sentDef.kind).toBe('made')
    expect(sentDef.def.entity).toEqual(['IfcDoor'])
    expect(openSchedule()).toEqual({ def: sentDef.def, rowCount: doors.length })

    expect(body.message).toMatch(/^Showed a new schedule in the Schedules window, where the user can undo it\. Door Schedule: /)
    expect(body.message).toContain('fire rating → FireRating')
    expect(body.resolvedKeys).toEqual({ 'fire rating': 'FireRating' })
    expect(body.headings).toEqual(['Name', 'FireRating', 'Width'])
    expect(body.elementCount).toBe(doors.length)
    const groups = body.groups as { group: string; count: number; totals: Record<string, string> }[]
    const byLevel = new Map<string, number>()
    for (const d of doors) byLevel.set(d.storey, (byLevel.get(d.storey) ?? 0) + 1)
    expect(new Map(groups.map((g) => [g.group, g.count]))).toEqual(byLevel)
    const width = (d: (typeof doors)[number]) => Number(d.qto.Qto_DoorBaseQuantities.Width)
    const num = (t: string) => Number(t.replace(/,/g, ''))
    for (const g of groups) {
      const sum = doors.filter((d) => d.storey === g.group).reduce((a, d) => a + width(d), 0)
      expect([g.group, num(g.totals.Width)]).toEqual([g.group, sum])
    }
    expect((body.grandTotal as { count: number }).count).toBe(doors.length)
    // One chip per level, each carrying that level's doors.
    expect(turn.chips.map((c) => c.label)).toEqual(groups.slice(0, 6).map((g) => `${g.group} (${g.count})`))
  })

  it('refuses the whole call over a name that is not one, and sends nothing', async () => {
    const { port, sent } = fakePort()
    connect(port)
    const body = await run('make_schedule', { ...DOOR_SCHEDULE, columns: [{ field: 'Name' }, { field: 'FireRatng' }] })
    expect(body.message).toMatch(/^Nothing was changed\. "FireRatng" is not a Schedules field/)
    expect((body.valid_values as { fields: Record<string, string[]> }).fields.FireRatng[0]).toBe('FireRating')
    expect(defines(sent)).toEqual([])
    expect(openSchedule()).toBeNull()
  })

  it('changes the open schedule and keeps what it does not mention — a user’s calculated column', async () => {
    const { port, sent } = fakePort()
    connect(port)
    const mine: ScheduleDef = {
      ...emptySchedule('Mine', ['IfcDoor']),
      columns: [
        { field: { kind: 'core', key: 'name' }, width: 180 },
        { field: { kind: 'formula', id: 'c1' }, heading: 'Twice' }
      ],
      calculated: [{ id: 'c1', name: 'Twice', kind: 'formula', formula: 'Width * 2' }]
    }
    receive({ type: 'current', def: mine, rowCount: doors.length })
    await run('make_schedule', { base: 'open', columns: [{ field: 'Level' }] })
    const [edit] = defines(sent)
    expect(edit.kind).toBe('edited')
    expect(edit.def.columns.map((c) => c.heading ?? c.field.kind)).toEqual(['core', 'Twice', 'core'])
    expect(edit.def.columns[0].width).toBe(180)
    expect(edit.def.columns[2].field).toEqual({ kind: 'core', key: 'storey' })
    expect(edit.def.calculated).toEqual(mine.calculated)
  })

  it('says there is nothing to change when no schedule is open', async () => {
    connect(fakePort().port)
    const body = await run('make_schedule', { base: 'open', columns: [{ field: 'Level' }] })
    expect(body.message).toContain('There is no open schedule to change')
  })

  it('opens the Schedules window when it is closed, and waits for it to join', async () => {
    const { port, sent } = fakePort()
    const openSchedules = vi.fn(async () => {
      setTimeout(() => connect(port), 50)
    })
    vi.stubGlobal('window', { sgvue: { openSchedules } })
    const body = await run('make_schedule', DOOR_SCHEDULE)
    expect(openSchedules).toHaveBeenCalledTimes(1)
    expect(defines(sent)).toHaveLength(1)
    expect(body.message).toMatch(/^Showed a new schedule/)
    // Already open: it is not brought forward again.
    await run('make_schedule', DOOR_SCHEDULE)
    expect(openSchedules).toHaveBeenCalledTimes(1)
  })

  it('gives up, saying so, when the window never joins — and when it cannot be opened at all', async () => {
    expect((await run('make_schedule', DOOR_SCHEDULE)).message).toBe('The Schedules window cannot be opened here.')
    vi.useFakeTimers()
    vi.stubGlobal('window', { sgvue: { openSchedules: async () => undefined } })
    const pending = run('make_schedule', DOOR_SCHEDULE)
    await vi.advanceTimersByTimeAsync(CONNECT_WAIT_MS)
    expect((await pending).message).toContain(`did not open within ${CONNECT_WAIT_MS / 1000} s`)
    expect(openSchedule()).toBeNull()
    // With no window to show it in, the store it built is not kept.
    expect(scheduleStoreHeld()).toBe(false)
  })
})

describe('the view state names the open schedule', () => {
  it('is null with no schedule, and the schedule’s line once one is open — in get_view_state too', async () => {
    const s = () => useShell.getState()
    expect(chatViewState(s(), s().federation, visFn(s()), scheduleBriefOf()).schedule).toBeNull()
    connect(fakePort().port)
    await run('make_schedule', { ...DOOR_SCHEDULE, title: 'Doors' })
    const brief = {
      title: 'Doors',
      category: ['IfcDoor'],
      columns: ['Name', 'FireRating', 'Width'],
      filters: '',
      rowCount: doors.length
    }
    expect(chatViewState(s(), s().federation, visFn(s()), scheduleBriefOf()).schedule).toEqual(brief)
    expect((await run('get_view_state')).schedule).toEqual(brief)
  })

  it('is the window’s own report on every turn: no store is built and the engine does not run', async () => {
    connect(fakePort().port)
    receive({
      type: 'current',
      def: {
        ...emptySchedule('Doors', ['IfcDoor']),
        columns: [
          { field: { kind: 'core', key: 'name' } },
          { field: { kind: 'prop', pset: '*', prop: 'FireRating' }, heading: 'Fire' },
          { field: { kind: 'core', key: 'guid' }, hidden: true }
        ],
        filters: [{ field: { kind: 'core', key: 'storey' }, op: '=', value: 'L1' }]
      },
      // Deliberately not the real count: the line says what the window said.
      rowCount: 42
    })
    const finish = vi.spyOn(StoreBuilder.prototype, 'finish')
    const s = useShell.getState()
    const brief = { title: 'Doors', category: ['IfcDoor'], columns: ['Name', 'Fire'], filters: 'Level equals L1', rowCount: 42 }
    expect(chatViewState(s, s.federation, visFn(s), scheduleBriefOf()).schedule).toEqual(brief)
    expect((await run('get_view_state')).schedule).toEqual(brief)
    expect(vi.mocked(scheduleStore)).not.toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
    finish.mockRestore()
  })
})

/* ────────────────────────────── 2026-09-28: export and colour from chat ────────────────────────────── */

/** A port that answers every `export` the way the Schedules window does — at once. */
function ackingPort(refused: string | null = null): ReturnType<typeof fakePort> {
  const { port, sent } = fakePort()
  const post = port.postMessage.bind(port)
  ;(port as unknown as { postMessage: (m: { type: string; n?: number }) => void }).postMessage = (m) => {
    post(m as never)
    if (m.type === 'export') queueMicrotask(() => receive({ type: 'exportAck', n: m.n, refused }))
  }
  return { port, sent }
}
const exportsOf = (sent: { type: string }[]) => sent.filter((m) => m.type === 'export')
const DOORS_OPEN = {
  type: 'current',
  def: {
    ...emptySchedule('Doors', ['IfcDoor']),
    columns: [
      { field: { kind: 'core', key: 'name' } },
      { field: { kind: 'prop', pset: '*', prop: 'FireRating' }, heading: 'Fire Rating' },
      { field: { kind: 'core', key: 'storey' } },
      { field: { kind: 'core', key: 'guid' }, hidden: true }
    ]
  },
  rowCount: doors.length
}

describe('export_schedule', () => {
  it('is refused with no Schedules window, or none shown in it — and nothing is asked for', async () => {
    const opened = vi.fn(async () => undefined)
    vi.stubGlobal('window', { sgvue: { openSchedules: opened } })
    const none = await run('export_schedule', { format: 'xlsx' })
    expect(none).toEqual({
      message: 'No Schedules window is open, so there is no schedule to export. Nothing was exported — make_schedule shows one.',
      dialog: false
    })
    const { port, sent } = ackingPort()
    connect(port)
    expect((await run('export_schedule', { format: 'xlsx' })).message).toMatch(
      /^The Schedules window shows no schedule yet\. Nothing was exported/
    )
    expect(exportsOf(sent)).toEqual([])
    expect(opened).not.toHaveBeenCalled()
  })

  it('asks the window for the Export menu’s own entry, brings it forward, and returns without claiming a file', async () => {
    const opened = vi.fn(async () => undefined)
    vi.stubGlobal('window', { sgvue: { openSchedules: opened } })
    const { port, sent } = ackingPort()
    connect(port)
    receive(DOORS_OPEN)
    const body = await run('export_schedule', { format: 'xlsx' })
    expect(exportsOf(sent)).toEqual([{ type: 'export', n: expect.any(Number), format: 'xlsx' }])
    expect(opened).toHaveBeenCalledTimes(1)
    expect(body).toEqual({
      message:
        'The Save dialog for Excel (.xlsx) is opening in the Schedules window, which was brought to the front. The user chooses the name and the folder there; nothing is saved unless they click Save, and this tool is not told whether they did — so do not say a file was saved.',
      format: 'xlsx',
      dialog: true
    })
    // Nothing for the panel: no chips, no ↺ — the view did not change.
    expect(turn.chips).toEqual([])
    expect(turn.acted).toBe(false)
  })

  it('passes on the window’s own refusals: nothing saved for all_saved, and busy — in words true of both its causes', async () => {
    const opened = vi.fn(async () => undefined)
    vi.stubGlobal('window', { sgvue: { openSchedules: opened } })
    connect(ackingPort('nothing_saved').port)
    receive(DOORS_OPEN)
    const saved = await run('export_schedule', { format: 'all_saved' })
    expect(saved.message).toMatch(/^There are no saved schedules to export/)
    expect(saved.dialog).toBe(false)
    connect(ackingPort('busy').port)
    receive(DOORS_OPEN)
    // The window answers `busy` for an export in flight and, since 2026-10-02, while its own
    // confirm or prompt, or its native Open dialog, is up (`exportRefusal`). The model passes the
    // sentence on, so it names both: it used to say only that an export was under way, with a
    // Save dialog to finish.
    const busy = (await run('export_schedule', { format: 'csv' })).message
    expect(busy).toMatch(/^The Schedules window is busy — /)
    expect(busy).toContain('an export is already under way (its Save dialog may be open)')
    expect(busy).toContain('or one of that window’s own dialogs is still waiting for an answer')
    expect(opened).not.toHaveBeenCalled()
  })

  it('never stacks a second request while one waits, and says so when the window does not answer', async () => {
    vi.useFakeTimers()
    const { port, sent } = fakePort()
    connect(port)
    receive(DOORS_OPEN)
    const first = run('export_schedule', { format: 'csv' })
    await vi.advanceTimersByTimeAsync(0)
    // (This side's own `busy` — `requestExport`, nothing sent — in the same words as the window's.)
    expect((await run('export_schedule', { format: 'csv' })).message).toMatch(
      /^The Schedules window is busy — an export is already under way/
    )
    expect(exportsOf(sent)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(EXPORT_ACK_MS)
    const late = await first
    expect(late.message).toMatch(/^The Schedules window did not answer within 3 s\. If a Save dialog appears there/)
    expect(late.dialog).toBe(false)
  })
})

describe('color_by_schedule_column', () => {
  /** The Schedules window's own store, built from the snapshot the port carried — as its `load` builds it. */
  function windowStore(sent: { type: string; [k: string]: unknown }[]) {
    const snap = sent.find((m) => m.type === 'store')!.snapshot as {
      cores: never[]
      cells: never[]
      meta: never
      rowIds: number[]
    }
    const b = new StoreBuilder()
    b.add(snap.cores, snap.cells)
    return { store: b.finish(snap.meta), rowIds: snap.rowIds }
  }

  it('does exactly what the heading menu does — same groups, same colours, same legend title', async () => {
    const { port, sent } = fakePort()
    connect(port)
    receive(DOORS_OPEN)
    const def = openSchedule()!.def
    // The menu: `colourColumn` over the window's own store, posted as `colourBy`.
    const w = windowStore(sent)
    const made = colourColumn(w.store, def, 1, w.rowIds)
    if (!made || 'error' in made) throw new Error('the menu refused')
    receive({ type: 'colourBy', ...made })
    const viaMenu = useShell.getState().colorBy
    expect(viaMenu!.prop).toBe('Fire Rating')

    // The tool, by the column's heading and by its field — in the file's own spelling or not.
    for (const column of ['Fire Rating', 'fire rating', 'FireRating']) {
      useShell.getState().clearColorBy()
      const body = await run('color_by_schedule_column', { column })
      expect([column, useShell.getState().colorBy]).toEqual([column, viaMenu])
      expect(body.column).toBe('Fire Rating')
      expect(body.message).toMatch(/^Coloured by the schedule column "Fire Rating" — \d+ values?: /)
      expect(body.groups).toEqual(viaMenu!.groups.map((g) => ({ value: g.v, count: g.n, color: g.color })))
      expect(body.truncated).toBe(false)
    }
    // The table is told which column its swatches go on.
    expect(sent.filter((m) => m.type === 'colours').at(-1)).toMatchObject({ live: true, key: 'prop|*|FireRating' })
    // Chips, one per value, as color_by_property gives; and the turn's ↺.
    expect(turn.chips[0]).toEqual({ label: `${viaMenu!.groups[0].v} (${viaMenu!.groups[0].n})`, ids: viaMenu!.groups[0].ids })
    expect(turn.acted).toBe(true)
  })

  it('refuses a column the open schedule does not show, naming the ones it does', async () => {
    connect(fakePort().port)
    receive(DOORS_OPEN)
    for (const column of ['Width', 'GUID']) {
      const body = await run('color_by_schedule_column', { column })
      expect(body.message).toBe(
        `Nothing was coloured. No column of the open schedule is "${column}" — its columns are Name, Fire Rating, Level.`
      )
      expect(body.valid_values).toEqual({ columns: ['Name', 'Fire Rating', 'Level'] })
    }
    expect(useShell.getState().colorBy).toBeNull()
  })

  it('refuses a column of more than 100 distinct values, in the menu’s own words', async () => {
    connect(fakePort().port)
    const beams = full.elements.filter((e) => e.type === 'IfcBeam')
    expect(beams.length).toBeGreaterThan(MAX_COLOUR_GROUPS)
    receive({
      type: 'current',
      def: { ...emptySchedule('Beams', ['IfcBeam']), columns: [{ field: { kind: 'core', key: 'guid' } }] },
      rowCount: beams.length
    })
    const body = await run('color_by_schedule_column', { column: 'GUID' })
    expect(body.message).toBe(
      `Nothing was coloured. ${beams.length} distinct values — too many to colour by. Group or narrow the column first.`
    )
    expect(useShell.getState().colorBy).toBeNull()
  })

  it('null clears the colours — the legend’s own clear — and no schedule is refused', async () => {
    useShell.getState().setColorBy('IfcEntity')
    expect(await run('color_by_schedule_column', { column: null })).toEqual({ message: 'Colour scheme cleared.', groups: [] })
    expect(useShell.getState().colorBy).toBeNull()
    expect((await run('color_by_schedule_column', { column: 'Level' })).message).toMatch(/^No Schedules window is open/)
    connect(fakePort().port)
    expect((await run('color_by_schedule_column', { column: 'Level' })).message).toMatch(
      /^The Schedules window shows no schedule yet\. Nothing was coloured/
    )
  })
})
