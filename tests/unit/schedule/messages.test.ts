/**
 * The Schedules port's messages (`src/schedule/messages.ts`): what each page accepts, and
 * that anything else is refused rather than half-read.
 */
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import { snapshotOf } from '../../../src/schedule/adapter'
import {
  admitGroups, admitIds, EXPORT_FORMATS, EXPORT_REFUSALS, FromSchedules, MAX_COLOUR_GROUPS, MAX_DEF_CHARS,
  MAX_DEF_COLUMNS, SelectMessage, ToSchedules
} from '../../../src/schedule/messages'
import { emptySchedule, type ScheduleDef } from '../../../src/schedule/schedule/def'

describe('main window → Schedules', () => {
  const snapshot = snapshotOf(federate([mockModelIndex('ARC')]))

  it('accepts a snapshot the adapter made, and a theme', () => {
    expect(ToSchedules.safeParse({ type: 'store', snapshot }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'store', snapshot: snapshotOf(federate([])) }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'theme', theme: 'light' }).success).toBe(true)
  })

  it('refuses rows that do not line up with their ids', () => {
    const short = { ...snapshot, rowIds: snapshot.rowIds.slice(1) }
    expect(ToSchedules.safeParse({ type: 'store', snapshot: short }).success).toBe(false)
  })

  it('refuses a cell that is not a value, and an unknown message', () => {
    const bad = { ...snapshot, cells: [{ 'P.X': { v: { html: '<b>' } } }, ...snapshot.cells.slice(1)] }
    expect(ToSchedules.safeParse({ type: 'store', snapshot: bad }).success).toBe(false)
    expect(ToSchedules.safeParse({ type: 'theme', theme: 'sepia' }).success).toBe(false)
    expect(ToSchedules.safeParse({ type: 'select', ids: [1], zoom: true }).success).toBe(false)
    expect(ToSchedules.safeParse('schedule:port').success).toBe(false)
  })
})

describe('Schedules → main window', () => {
  it('accepts integer ids and a zoom flag, and nothing else', () => {
    expect(SelectMessage.safeParse({ type: 'select', ids: [1_000_001, 2], zoom: true }).success).toBe(true)
    expect(SelectMessage.safeParse({ type: 'select', ids: [1.5], zoom: true }).success).toBe(false)
    expect(SelectMessage.safeParse({ type: 'select', ids: ['1'], zoom: true }).success).toBe(false)
    expect(SelectMessage.safeParse({ type: 'select', ids: [1] }).success).toBe(false)
    expect(SelectMessage.safeParse({ type: 'store' }).success).toBe(false)
  })
})

describe('phase 3 messages', () => {
  it('the Schedules window accepts a selection, the visibility and a colour map', () => {
    expect(ToSchedules.safeParse({ type: 'selection', ids: [1, 2], quiet: true }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'vis', hidden: [3], total: 9, storeysClean: true, allShown: false }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'colours', live: true, key: 'core|storey', entries: [{ value: 'L1', color: '#35C4B6' }] }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'colours', live: false, key: null, entries: [] }).success).toBe(true)
  })

  it('refuses a colour that is not a plain hex — it lands in a style attribute', () => {
    for (const color of ['red', '#35C4B6;background:url(x)', 'url(x)', '#fff']) {
      expect(ToSchedules.safeParse({ type: 'colours', live: true, key: 'k', entries: [{ value: 'v', color }] }).success, color).toBe(false)
    }
    expect(ToSchedules.safeParse({ type: 'selection', ids: [1] }).success).toBe(false)
    expect(ToSchedules.safeParse({ type: 'vis', hidden: [], total: -1, storeysClean: true, allShown: true }).success).toBe(false)
  })

  it('the main window accepts the menu’s six actions and a colour-by, and nothing else', () => {
    for (const kind of ['select', 'zoom', 'isolate', 'hide', 'show', 'showAll']) {
      expect(FromSchedules.safeParse({ type: 'act', kind, ids: [1] }).success, kind).toBe(true)
    }
    expect(FromSchedules.safeParse({ type: 'act', kind: 'delete', ids: [1] }).success).toBe(false)
    expect(FromSchedules.safeParse({ type: 'act', kind: 'hide', ids: [1.5] }).success).toBe(false)
    expect(FromSchedules.safeParse({ type: 'colourBy', label: 'Level', key: 'core|storey', groups: [{ value: 'L1', ids: [1] }] }).success).toBe(true)
    expect(FromSchedules.safeParse({ type: 'colourBy', label: 'Level', key: 'k', groups: [{ value: '', ids: [1] }] }).success).toBe(false)
    expect(FromSchedules.safeParse({ type: 'colourBy', label: 'x'.repeat(201), key: 'k', groups: [] }).success).toBe(false)
    expect(FromSchedules.safeParse({ type: 'clearColours' }).success).toBe(true)
  })

  it('a colour-by carries at most MAX_COLOUR_GROUPS values, both ways', () => {
    expect(MAX_COLOUR_GROUPS).toBe(100)
    const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, ids: [i] }))
    const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, color: '#35C4B6' }))
    expect(FromSchedules.safeParse({ type: 'colourBy', label: 'L', key: 'k', groups: groups(100) }).success).toBe(true)
    expect(FromSchedules.safeParse({ type: 'colourBy', label: 'L', key: 'k', groups: groups(101) }).success).toBe(false)
    expect(ToSchedules.safeParse({ type: 'colours', live: true, key: 'k', entries: entries(100) }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'colours', live: true, key: 'k', entries: entries(101) }).success).toBe(false)
    expect(FromSchedules.safeParse({ type: 'store' }).success).toBe(false)
  })
})

describe('the main-side id guard', () => {
  /** A federation of six elements. */
  const known = new Set([10, 11, 12, 13, 14, 15])

  it('drops duplicates and ids the federation does not carry, keeping the order', () => {
    expect(admitIds([12, 10, 12, 99, 10], known)).toEqual([12, 10])
    expect(admitIds([], known)).toEqual([])
  })

  it('ignores a list longer than the federation whole — it cannot be a real selection', () => {
    expect(admitIds([10, 11, 12, 13, 14, 15, 10], known)).toBeNull()
    expect(admitIds([10, 11, 12, 13, 14, 15], known)).toEqual([10, 11, 12, 13, 14, 15])
  })

  it('colour groups: one bound over all of them, each element in its first group, empty groups gone', () => {
    expect(admitGroups([
      { value: 'a', ids: [10, 10, 99] }, { value: 'b', ids: [10, 11] }, { value: 'c', ids: [99] },
    ], known)).toEqual([{ value: 'a', ids: [10] }, { value: 'b', ids: [11] }])
    expect(admitGroups([{ value: 'a', ids: [10, 11, 12, 13] }, { value: 'b', ids: [14, 15, 10] }], known)).toBeNull()
  })
})

/* ────────────────────────────── 2026-09-28: a schedule definition, both ways ────────────────────────────── */

describe('a schedule definition crossing the port', () => {
  const def = (): ScheduleDef => ({
    ...emptySchedule('Doors', ['IfcDoor']),
    columns: [{ field: { kind: 'core', key: 'name' } }, { field: { kind: 'prop', pset: '*', prop: 'FireRating' }, total: 'count' }],
    filters: [{ field: { kind: 'core', key: 'storey' }, op: '=', value: 'Level 1' }],
    sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true, footer: 'count' }]
  })

  it('the Schedules window accepts a made or changed schedule, and nothing else', () => {
    expect(ToSchedules.safeParse({ type: 'define', kind: 'made', def: def() }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'define', kind: 'edited', def: def() }).success).toBe(true)
    expect(ToSchedules.safeParse({ type: 'define', kind: 'deleted', def: def() }).success).toBe(false)
    expect(ToSchedules.safeParse({ type: 'define', kind: 'made' }).success).toBe(false)
    expect(FromSchedules.safeParse({ type: 'define', kind: 'made', def: def() }).success).toBe(false)
  })

  it('the main window accepts the schedule on screen, or null, with its row count, and nothing else', () => {
    expect(FromSchedules.safeParse({ type: 'current', def: def(), rowCount: 12 }).success).toBe(true)
    expect(FromSchedules.safeParse({ type: 'current', def: null, rowCount: 0 }).success).toBe(true)
    expect(FromSchedules.safeParse({ type: 'current', rowCount: 0 }).success).toBe(false)
    // The count is what the view state reports every turn: a whole, non-negative number.
    for (const rowCount of [undefined, -1, 1.5, '12', 1e9]) {
      expect([rowCount, FromSchedules.safeParse({ type: 'current', def: def(), rowCount }).success]).toEqual([rowCount, false])
    }
    expect(ToSchedules.safeParse({ type: 'current', def: def(), rowCount: 1 }).success).toBe(false)
  })

  it('refuses a field reference the engine does not resolve, or an operator it does not have', () => {
    const bad = (mutate: (d: ScheduleDef & Record<string, unknown>) => void): boolean => {
      const d = def() as ScheduleDef & Record<string, unknown>
      mutate(d)
      return FromSchedules.safeParse({ type: 'current', def: d, rowCount: 1 }).success
    }
    expect(bad(() => undefined)).toBe(true)
    expect(bad((d) => { d.columns[0] = { field: { kind: 'script', id: 'x' } as never } })).toBe(false)
    expect(bad((d) => { d.columns[0] = { field: { kind: 'core', key: '__proto__' } as never } })).toBe(false)
    expect(bad((d) => { d.columns[1] = { field: { kind: 'prop', pset: '*', prop: '' } } })).toBe(false)
    expect(bad((d) => { d.filters[0] = { ...d.filters[0], op: 'like' as never } })).toBe(false)
    expect(bad((d) => { d.filters[0] = { ...d.filters[0], value: { html: '<b>' } as never } })).toBe(false)
    expect(bad((d) => { d.sort[0] = { ...d.sort[0], dir: 'up' as never } })).toBe(false)
    expect(bad((d) => { d.entity = 'IfcDoor' as never })).toBe(false)
  })

  it('refuses what is too big: columns, filters, sort levels, strings, and the whole', () => {
    const col = { field: { kind: 'core' as const, key: 'name' as const } }
    const at = (d: Partial<ScheduleDef>): boolean =>
      ToSchedules.safeParse({ type: 'define', kind: 'made', def: { ...def(), ...d } }).success
    expect(at({ columns: Array(MAX_DEF_COLUMNS).fill(col) })).toBe(true)
    expect(at({ columns: Array(MAX_DEF_COLUMNS + 1).fill(col) })).toBe(false)
    expect(at({ filters: Array(9).fill(def().filters[0]) })).toBe(false)
    expect(at({ sort: Array(5).fill(def().sort[0]) })).toBe(false)
    expect(at({ name: 'n'.repeat(1001) })).toBe(false)
    // Under every per-field bound, over the whole: 150 columns of 1 900-character headings.
    const wide = Array.from({ length: 150 }, () => ({ ...col, heading: 'h'.repeat(1900) }))
    expect(JSON.stringify(wide).length).toBeGreaterThan(MAX_DEF_CHARS)
    expect(at({ columns: wide })).toBe(false)
  })
})

/* ────────────────────────────── 2026-09-28: export from chat ────────────────────────────── */

describe('an export asked for from chat', () => {
  it('the Schedules window accepts one of the Export menu’s four entries and a request number — nothing more', () => {
    for (const format of EXPORT_FORMATS) {
      expect([format, ToSchedules.safeParse({ type: 'export', n: 1, format }).success]).toEqual([format, true])
    }
    for (const format of ['pdf', 'XLSX', '', undefined, 'schedule']) {
      expect([format, ToSchedules.safeParse({ type: 'export', n: 1, format }).success]).toEqual([format, false])
    }
    // No name, no path, no bytes: any extra key refuses the whole message.
    for (const extra of [{ path: 'C:/out.xlsx' }, { suggestedName: 'x' }, { bytes: [1] }, { kind: 'xlsx' }]) {
      expect(ToSchedules.safeParse({ type: 'export', n: 1, format: 'xlsx', ...extra }).success).toBe(false)
    }
    for (const n of [-1, 1.5, '1', undefined]) {
      expect([n, ToSchedules.safeParse({ type: 'export', n, format: 'csv' }).success]).toEqual([n, false])
    }
    expect(FromSchedules.safeParse({ type: 'export', n: 1, format: 'csv' }).success).toBe(false)
  })

  it('the main window accepts its answer — started, or the menu’s own reason — and nothing more', () => {
    expect(FromSchedules.safeParse({ type: 'exportAck', n: 3, refused: null }).success).toBe(true)
    for (const refused of EXPORT_REFUSALS) {
      expect(FromSchedules.safeParse({ type: 'exportAck', n: 3, refused }).success).toBe(true)
    }
    expect(FromSchedules.safeParse({ type: 'exportAck', n: 3, refused: 'saved' }).success).toBe(false)
    expect(FromSchedules.safeParse({ type: 'exportAck', n: 3 }).success).toBe(false)
    // Nothing about a file ever comes back.
    expect(FromSchedules.safeParse({ type: 'exportAck', n: 3, refused: null, path: 'C:/x' }).success).toBe(false)
    expect(ToSchedules.safeParse({ type: 'exportAck', n: 3, refused: null }).success).toBe(false)
  })
})
