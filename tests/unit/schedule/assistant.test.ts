/**
 * The assistant's side of the Schedules window (`src/schedule/assistant.ts`) — 2026-09-28, on
 * the design's own mock federation, the ground truth counted straight off the federation.
 *
 *   · a field name resolves to the engine's field the way a rule's `prop` resolves — core fields
 *     by label, key or SGVue's name; property names exact or normalised; never a merely similar
 *     one; two that normalise alike asked about, not chosen between;
 *   · a new schedule and a change to the open one both come out of `parseScheduleDef` unchanged,
 *     and a change keeps what the simplified shape cannot say;
 *   · the rows, the group subtotals and the grand totals are the engine's, bounded and honest.
 *
 * 2026-10-02, phase 4 of the assistant's parity work — the last blocks: what the window's
 * Filter, Sorting and Format tabs and its calculated-value editor set (`filterLogic`, `itemize`,
 * a column's `hidden` / `align` / `decimals` / `unit` / `after`, `calculated`), each by that
 * tab's own rule and refused with its reason where the tab would not offer it; and the elements
 * a schedule lists, as a set (`scheduleElementIds`).
 */
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import { snapshotOf } from '../../../src/schedule/adapter'
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store'
import { parseScheduleDef, type ScheduleDef } from '../../../src/schedule/schedule/def'
import {
  buildSchedule,
  readSchedule,
  resolveScheduleField,
  scheduleBrief,
  scheduleElementIds,
  simplify,
  CELL_CHARS,
  SCHEDULE_ROWS_CAP,
  SCHEDULE_ROWS_DEFAULT,
  type AskSchedule,
  type Built,
  type FieldWorld,
  type Refused
} from '../../../src/schedule/assistant'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const

/**
 * The mock plus the owner's own example: a Revit shared parameter `Includes As GFA` (yes on the
 * floor slabs) and a `GFA Area` of 100 m² on every slab; and, when asked, a door key that
 * normalises like the walls' `FireRating`.
 */
const federation = (fireRatingTwice = false) =>
  federate(
    KEYS.map((k) =>
      mockModelIndex(k, {
        element: (e) => {
          if (e.type === 'IfcSlab') {
            return {
              ...e,
              psets: { ...e.psets, SGPset_Area: { 'Includes As GFA': e.predefinedType === 'FLOOR', 'GFA Area': 100 } },
              psetMeta: {
                ...e.psetMeta,
                SGPset_Area: { sourceExpressId: 0, inherited: false, kind: 'SGPset', measures: { 'GFA Area': 'IFCAREAMEASURE' } }
              }
            }
          }
          if (fireRatingTwice && e.type === 'IfcDoor') return { ...e, psets: { ...e.psets, Other: { Fire_Rating: '1HR' } } }
          return e
        }
      })
    )
  )

function worldOf(fed: ReturnType<typeof federate>): FieldWorld & { rowIds: number[] } {
  const snap = snapshotOf(fed)
  const b = new StoreBuilder()
  b.add(snap.cores, snap.cells)
  return { store: b.finish(snap.meta), propKeys: fed.propKeys, rowIds: snap.rowIds }
}

const fed = federation()
const world = worldOf(fed)
const store: ModelStore = world.store

const built = (ask: AskSchedule, base: ScheduleDef | null = null): Built => {
  const r = buildSchedule(ask, world, base)
  if ('error' in r) throw new Error(r.error)
  return r
}
const refused = (ask: AskSchedule, base: ScheduleDef | null = null, w: FieldWorld = world): Refused => {
  const r = buildSchedule(ask, w, base)
  if (!('error' in r)) throw new Error('expected a refusal')
  return r
}

const doors = fed.elements.filter((e) => e.type === 'IfcDoor')
const doorsBy = (storey: string) => doors.filter((d) => d.storey === storey).length
const floorSlabs = fed.elements.filter((e) => e.type === 'IfcSlab' && e.predefinedType === 'FLOOR')

/* ────────────────────────────── field names ────────────────────────────── */

describe('a field name resolves the way a rule’s prop does', () => {
  const field = (asked: string, w: FieldWorld = world, base: ScheduleDef | null = null) => {
    const r = resolveScheduleField(asked, w, base)
    return r.ok ? r.field : r
  }

  it('reads the Schedules window’s own fields by label, key or SGVue’s name, in any case', () => {
    for (const asked of ['Level', 'level', 'storey', 'LEVEL']) expect(field(asked)).toEqual({ kind: 'core', key: 'storey' })
    for (const asked of ['IfcEntity', 'IFC Class', 'entity']) expect(field(asked)).toEqual({ kind: 'core', key: 'entity' })
    for (const asked of ['ObjectType', 'Object Type', 'object_type']) expect(field(asked)).toEqual({ kind: 'core', key: 'objectType' })
    expect(field('PredefinedType')).toEqual({ kind: 'core', key: 'predefinedType' })
    expect(field('Type')).toEqual({ kind: 'core', key: 'typeName' })
    expect(field('Model')).toEqual({ kind: 'core', key: 'model' })
    expect(field('Material')).toEqual({ kind: 'core', key: 'material' })
    expect(field('GlobalId')).toEqual({ kind: 'core', key: 'guid' })
    expect(field('Tag (Revit ID)')).toEqual({ kind: 'core', key: 'mark' })
    expect(field('Level Elevation')).toEqual({ kind: 'core', key: 'storeyElevation' })
  })

  it('never reads "Mark" as the Revit ElementId the core `mark` field holds', () => {
    const r = resolveScheduleField('Mark', world)
    expect(r.ok).toBe(false)
  })

  it('reads a property name exactly, or normalised, across every set — and says what it read', () => {
    expect(resolveScheduleField('FireRating', world)).toEqual({ ok: true, field: { kind: 'prop', pset: '*', prop: 'FireRating' } })
    expect(resolveScheduleField('includes as gfa', world)).toEqual({
      ok: true,
      field: { kind: 'prop', pset: '*', prop: 'Includes As GFA' },
      rewritten: 'Includes As GFA'
    })
    expect(resolveScheduleField('Pset_DoorCommon.FireRating', world)).toEqual({
      ok: true,
      field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' }
    })
  })

  it('never picks a merely similar name: includesGFA is refused, Includes As GFA offered first', () => {
    const r = resolveScheduleField('includesGFA', world)
    if (r.ok) throw new Error('resolved')
    expect(r.nearest[0]).toBe('Includes As GFA')
    expect(r.error).toContain('"includesGFA" is not a Schedules field or a property name in this federation — nearest: Includes As GFA')
  })

  it('asks which of two names that normalise alike — but two that differ only by case are one column', () => {
    const two = worldOf(federation(true))
    const r = resolveScheduleField('fire rating', two)
    if (r.ok) throw new Error('resolved')
    expect(r.error).toBe('"fire rating" matches two names, FireRating and Fire_Rating — say which.')

    // The engine matches a property name case-insensitively, so these are the same column.
    const cased: FieldWorld = { store, propKeys: ['Width', 'width'] }
    expect(resolveScheduleField('WIDTH ', cased)).toMatchObject({ ok: true, field: { kind: 'prop', pset: '*', prop: 'Width' } })
  })

  it('reads a calculated column of the schedule being changed by its name', () => {
    const base = { ...built({ category: ['IfcDoor'], columns: [{ field: 'Name' }] }).def }
    base.calculated = [{ id: 'c1', name: 'Area x2', kind: 'formula', formula: 'Area * 2' }]
    expect(field('area X2', world, base)).toEqual({ kind: 'formula', id: 'c1' })
  })
})

/* ────────────────────────────── building ────────────────────────────── */

describe('a new schedule', () => {
  it('"a door schedule with fire rating and width, grouped by level" — a checked ScheduleDef', () => {
    const { def, resolvedKeys } = built({
      category: ['ifcdoor'],
      columns: [{ field: 'Name' }, { field: 'fire rating' }, { field: 'Width', total: 'sum' }],
      groupBy: ['Level'],
      grandTotals: true
    })
    expect(def.name).toBe('Door Schedule')
    expect(def.entity).toEqual(['IfcDoor'])
    expect(resolvedKeys).toEqual({ 'fire rating': 'FireRating' })
    expect(def.columns.map((c) => c.field)).toEqual([
      { kind: 'core', key: 'name' },
      { kind: 'prop', pset: '*', prop: 'FireRating' },
      { kind: 'prop', pset: '*', prop: 'Width' }
    ])
    // A new column is dressed the way the field picker dresses it (`columnForProp`): numbers
    // right-aligned — the mock's Width carries no measure type, so it has no unit to read in…
    expect(def.columns[2]).toMatchObject({ align: 'right', total: 'sum', format: { display: '', decimals: 2 } })
    // …while an area measure reads in m² at 2 dp.
    const area = built({ category: ['IfcSlab'], columns: [{ field: 'GFA Area' }] }).def
    expect(area.columns[0]).toMatchObject({ align: 'right', format: { display: 'm²', decimals: 2, thousands: true } })
    expect(def.sort).toEqual([{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true, footer: 'titleCountTotals' }])
    expect(def.grandTotal).toBe(true)
    // parseScheduleDef has already read it: reading it again changes nothing.
    expect(parseScheduleDef(JSON.parse(JSON.stringify(def)))).toEqual(def)
  })

  it('refuses the whole call over one unknown name, and names the nearest', () => {
    const r = refused({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'FireRatng' }], groupBy: ['Levle'] })
    expect(r.error).toContain('"FireRatng" is not a Schedules field')
    expect(r.error).toContain('"Levle" is not a Schedules field')
    expect(r.valid_values!.fields!.FireRatng[0]).toBe('FireRating')
    expect(r.valid_values!.fields!.Levle[0]).toBe('Level')
  })

  it('refuses an unknown category with the nearest classes, and a schedule with no category or column', () => {
    const r = refused({ category: ['IfcDor'], columns: [{ field: 'Name' }] })
    expect(r.error).toContain('No element is of class "IfcDor" — nearest: IfcDoor')
    expect(refused({ columns: [{ field: 'Name' }] }).error).toContain('needs a category')
    expect(refused({ category: ['IfcDoor'] }).error).toContain('at least one column')
  })

  it('turns filters into the engine’s rules, and refuses one that cannot work', () => {
    const { def } = built({
      category: ['IfcDoor'],
      columns: [{ field: 'Name' }],
      filters: [
        { field: 'Width', op: '>', value: '0.9' },
        { field: 'Level', op: 'in', values: ['Level 1', 'Level 2'] },
        { field: 'FireRating', op: 'hasValue', value: 'ignored' },
        { field: 'Height', op: 'between', values: ['2', '2.5'] }
      ]
    })
    expect(def.filters).toEqual([
      { field: { kind: 'prop', pset: '*', prop: 'Width' }, op: '>', value: 0.9 },
      { field: { kind: 'core', key: 'storey' }, op: 'in', values: ['Level 1', 'Level 2'] },
      { field: { kind: 'prop', pset: '*', prop: 'FireRating' }, op: 'hasValue' },
      { field: { kind: 'prop', pset: '*', prop: 'Height' }, op: 'between', values: [2, 2.5] }
    ])
    const col = [{ field: 'Name' }]
    expect(refused({ category: ['IfcDoor'], columns: col, filters: [{ field: 'Width', op: '>', value: 'wide' }] }).error).toContain('is not one')
    expect(refused({ category: ['IfcDoor'], columns: col, filters: [{ field: 'Width', op: 'between', values: ['1'] }] }).error).toContain('two numbers')
    expect(refused({ category: ['IfcDoor'], columns: col, filters: [{ field: 'Level', op: 'in', values: [] }] }).error).toContain('needs values')
    expect(refused({ category: ['IfcDoor'], columns: col, filters: [{ field: 'Level', op: '=' }] }).error).toContain('needs a value')
  })

  it('sorts and groups by at most four fields together', () => {
    const r = refused({
      category: ['IfcDoor'],
      columns: [{ field: 'Name' }],
      groupBy: ['Level', 'Type', 'Family'],
      sortBy: [{ field: 'Name' }, { field: 'Width', descending: true }]
    })
    expect(r.error).toContain('at most 4 fields together; that asks for 5')
  })
})

describe('a change to the open schedule keeps what the simplified shape cannot say', () => {
  // The user's own setup: a calculated column, a colour rule, a width, a format, a template note.
  const userDef = (): ScheduleDef => {
    const def = built({
      category: ['IfcDoor'],
      columns: [{ field: 'Type' }, { field: 'Width' }, { field: 'Level' }],
      sortBy: [{ field: 'Name' }]
    }).def
    def.calculated = [{ id: 'c1', name: 'Wide', kind: 'formula', formula: 'Width * 2' }]
    def.columns.push({ field: { kind: 'formula', id: 'c1' }, heading: 'Double', align: 'right' })
    def.columns[1] = { ...def.columns[1], width: 140, format: { display: 'm', decimals: 3 }, conditional: [{ op: '>', value: 1, bg: '#ff0000' }] }
    def.meta = { notes: 'SGVue template — Door Schedule' }
    return parseScheduleDef(JSON.parse(JSON.stringify(def)))
  }

  it('adds a column at the right, and leaves every other column exactly as it was', () => {
    const base = userDef()
    const { def } = built({ base: 'open', columns: [{ field: 'FireRating' }] }, base)
    expect(def.columns.slice(0, -1)).toEqual(base.columns)
    expect(def.columns.at(-1)!.field).toEqual({ kind: 'prop', pset: '*', prop: 'FireRating' })
    expect(def.calculated).toEqual(base.calculated)
    expect(def.meta).toEqual(base.meta)
    expect(def.sort).toEqual(base.sort)
  })

  it('brings back a hidden column it is asked to add', () => {
    const base = userDef()
    base.columns[1].hidden = true
    const { def } = built({ base: 'open', columns: [{ field: 'Width' }] }, base)
    expect(def.columns).toHaveLength(base.columns.length)
    // Shown again, and otherwise exactly the user's column.
    const { hidden, ...rest } = base.columns[1]
    expect(hidden).toBe(true)
    expect(def.columns[1]).toStrictEqual(rest)
  })

  it('re-heads and re-totals a column it already shows, rather than adding it twice', () => {
    const base = userDef()
    const { def } = built({ base: 'open', columns: [{ field: 'width', heading: 'W', total: 'max' }] }, base)
    expect(def.columns).toHaveLength(base.columns.length)
    expect(def.columns[1]).toEqual({ ...base.columns[1], heading: 'W', total: 'max' })
    const off = built({ base: 'open', columns: [{ field: 'Width', total: 'none', heading: '' }] }, def).def
    expect(off.columns[1]).toEqual(base.columns[1])
  })

  it('removes columns by heading or by field, and refuses one it does not have', () => {
    const base = userDef()
    const { def } = built({ base: 'open', removeColumns: ['double', 'Type'] }, base)
    expect(def.columns.map((c) => c.field)).toEqual([base.columns[1].field, base.columns[2].field])
    const r = refused({ base: 'open', removeColumns: ['Colour'] }, base)
    expect(r.error).toContain('No column of this schedule is "Colour" — its columns are Type, Width, Level, Double.')
    expect(refused({ base: 'open', removeColumns: ['Type', 'Width', 'Level', 'Double'] }, base).error).toContain('at least one column')
  })

  it('replaces the filters, and the grouping without the sort (or the sort without the grouping)', () => {
    const base = userDef()
    const only2 = built({ base: 'open', filters: [{ field: 'Level', op: '=', value: 'Level 2' }] }, base).def
    expect(only2.filters).toEqual([{ field: { kind: 'core', key: 'storey' }, op: '=', value: 'Level 2' }])
    const grouped = built({ base: 'open', groupBy: ['Type'] }, only2).def
    expect(grouped.sort.map((l) => [l.field, !!l.header])).toEqual([
      [{ kind: 'core', key: 'typeName' }, true],
      [{ kind: 'core', key: 'name' }, false]
    ])
    const resorted = built({ base: 'open', sortBy: [{ field: 'Width', descending: true }] }, grouped).def
    expect(resorted.sort[0]).toEqual(grouped.sort[0])
    expect(resorted.sort[1]).toEqual({ field: { kind: 'prop', pset: '*', prop: 'Width' }, dir: 'desc' })
    expect(built({ base: 'open', filters: [] }, only2).def.filters).toEqual([])
  })

  it('renames it, and moves it to another class when asked', () => {
    const { def } = built({ base: 'open', title: '  Doors by type ', category: ['IfcWindow'] }, userDef())
    expect(def.name).toBe('Doors by type')
    expect(def.entity).toEqual(['IfcWindow'])
  })
})

/* ────────────────────────────── reading ────────────────────────────── */

describe('reading a schedule runs the engine, bounded', () => {
  it('a grouped count: each level’s doors, with its elements behind a chip', () => {
    const { def } = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Level' }], groupBy: ['Level'] })
    const read = readSchedule(store, def, world.rowIds, { limit: 100 })
    const storeys = [...new Set(doors.map((d) => d.storey))]
    const out = read.forModel as { groups: { group: string; count: number }[]; rowCount: number; elementCount: number; limit: number }
    expect(out.groups.map((g) => g.count).reduce((a, b) => a + b, 0)).toBe(doors.length)
    for (const g of out.groups) expect([g.group, g.count]).toEqual([g.group, doorsBy(g.group)])
    expect(out.groups.map((g) => g.group).sort()).toEqual(storeys.sort())
    expect(out.rowCount).toBe(doors.length)
    expect(out.limit).toBe(SCHEDULE_ROWS_CAP)
    // Chips name federation ids, not store rows.
    expect([...read.ids].sort()).toEqual(doors.map((d) => d.id).sort())
    expect(read.groups.map((g) => g.ids.length)).toEqual(out.groups.map((g) => g.count))
  })

  it('a sum total: the owner’s “GFA area of what Includes As GFA, by level”', () => {
    const { def } = built({
      category: ['IfcSlab'],
      columns: [{ field: 'Name' }, { field: 'GFA Area', total: 'sum' }],
      filters: [{ field: 'Includes As GFA', op: '=', value: 'Yes' }],
      groupBy: ['Level'],
      grandTotals: true
    })
    const out = readSchedule(store, def, world.rowIds).forModel as {
      groups: { group: string; count: number; totals: Record<string, string> }[]
      grandTotal: { count: number; totals: Record<string, string> }
      elementCount: number
    }
    const num = (t: string): number => Number(t.replace(/[^\d.]/g, ''))
    expect(out.elementCount).toBe(floorSlabs.length)
    for (const g of out.groups) {
      const n = floorSlabs.filter((e) => e.storey === g.group).length
      expect([g.group, g.count, num(g.totals['GFA Area'])]).toEqual([g.group, n, 100 * n])
    }
    expect(out.grandTotal.count).toBe(floorSlabs.length)
    expect(num(out.grandTotal.totals['GFA Area'])).toBe(100 * floorSlabs.length)
  })

  it('pages rows as displayed text, and says when it cut', () => {
    const { def } = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Width' }] })
    const all = readSchedule(store, def, world.rowIds).forModel as { rows: string[][]; truncated: boolean; limit: number; headings: string[] }
    expect(all.limit).toBe(SCHEDULE_ROWS_DEFAULT)
    expect(all.headings).toEqual(['Name', 'Width'])
    expect(all.rows[0][1]).toMatch(/^\d[\d,]*\.\d\d$/)
    const page = readSchedule(store, def, world.rowIds, { limit: 2, offset: 1 }).forModel as { rows: string[][]; truncated: boolean; offset: number }
    expect(page.rows).toHaveLength(2)
    expect(page.offset).toBe(1)
    expect(page.truncated).toBe(doors.length > 3)
    const past = readSchedule(store, def, world.rowIds, { offset: 10_000 }).forModel as { rows: string[][]; truncated: boolean }
    expect(past).toMatchObject({ rows: [], truncated: false })
  })

  it('answers "why is this empty?": the column no element fills, and what each filter keeps alone', () => {
    const { def } = built({
      category: ['IfcDoor'],
      columns: [{ field: 'Name' }, { field: 'GFA Area' }],
      filters: [{ field: 'Level', op: '=', value: 'Level 9' }, { field: 'FireRating', op: 'hasValue' }]
    })
    const out = readSchedule(store, def, world.rowIds).forModel as Record<string, unknown>
    expect(out.rowCount).toBe(0)
    expect(out.categoryElements).toBe(doors.length)
    expect(out.filterKeeps).toEqual([
      { filter: 'Level equals Level 9', keeps: 0 },
      { filter: 'FireRating has a value', keeps: doors.length }
    ])
    const open = built({ base: 'open', filters: [] }, def).def
    expect((readSchedule(store, open, world.rowIds).forModel as { filled: Record<string, number> }).filled).toEqual({
      Name: doors.length,
      'GFA Area': 0
    })
  })

  it('clips a long cell, and reports the definition in make_schedule’s own shape', () => {
    const long = federate([mockModelIndex('ARC', { element: (e) => (e.type === 'IfcDoor' ? { ...e, name: 'x'.repeat(500) } : e) })])
    const w = worldOf(long)
    const def = buildSchedule({ category: ['IfcDoor'], columns: [{ field: 'Name' }], groupBy: ['Level'], sortBy: [{ field: 'Name', descending: true }] }, w, null) as Built
    const out = readSchedule(w.store, def.def, w.rowIds).forModel as { rows: string[][]; schedule: unknown }
    expect(out.rows[0][0]).toHaveLength(CELL_CHARS)
    expect(out.rows[0][0].endsWith('…')).toBe(true)
    expect(out.schedule).toEqual({
      title: 'Door Schedule',
      category: ['IfcDoor'],
      columns: [{ field: 'Name', heading: 'Name' }],
      filters: [],
      sortBy: [{ field: 'Name', descending: true }],
      groupBy: ['Level'],
      grandTotals: false
    })
    expect(simplify(def.def)).toEqual(out.schedule)
  })

  it('keeps a table of the widest schedule the port allows inside the result cap', () => {
    const def = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }] }).def
    def.columns = Array.from({ length: 200 }, (_, i) => ({ field: { kind: 'core' as const, key: 'name' as const }, heading: `H${i}${'y'.repeat(200)}` }))
    const out = readSchedule(store, def, world.rowIds, { limit: 50 }).forModel
    expect(JSON.stringify(out).length).toBeLessThan(1_000_000)
  })
})

describe('the view state’s line', () => {
  it('names the title, the class, the headings, the filters in the Filter tab’s words, and the rows it is given', () => {
    const { def } = built({
      title: 'Doors L1',
      category: ['IfcDoor'],
      columns: [{ field: 'Name' }, { field: 'FireRating', heading: 'Fire' }],
      filters: [{ field: 'Level', op: '=', value: 'Level 1' }]
    })
    expect(scheduleBrief(def, 5)).toEqual({
      title: 'Doors L1',
      category: ['IfcDoor'],
      columns: ['Name', 'Fire'],
      filters: 'Level equals Level 1',
      rowCount: 5
    })
  })

  it('shows the headings the table shows — hidden columns out, clashing names qualified — without the engine', () => {
    const { def } = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }] })
    def.columns = [
      { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Reference' } },
      { field: { kind: 'prop', pset: 'Pset_Other', prop: 'Reference' } },
      { field: { kind: 'core', key: 'guid' }, hidden: true }
    ]
    const res = readSchedule(store, def, world.rowIds).forModel as { headings: string[] }
    expect(scheduleBrief(def, 0).columns).toEqual(res.headings)
    expect(res.headings).toEqual(['Reference (Pset_DoorCommon)', 'Reference (Pset_Other)'])
  })
})

/* ────────────────────────────── units ────────────────────────────── */

describe('each measured column says its unit, and the SI unit its filters compare in', () => {
  // A door `Clear Width` of 900 in the file's millimetres, as an IfcLengthMeasure: the engine
  // stores 0.9 m and the column shows 900 in mm — the trap the owner's model would set.
  const measured = federate([
    mockModelIndex('ARC', {
      element: (e) =>
        e.type === 'IfcDoor'
          ? {
              ...e,
              psets: { ...e.psets, Dims: { 'Clear Width': 900 } },
              psetMeta: { ...e.psetMeta, Dims: { sourceExpressId: 0, inherited: false, kind: 'Pset', measures: { 'Clear Width': 'IFCLENGTHMEASURE' } } }
            }
          : e
    })
  ])
  const w = worldOf(measured)
  const read = (ask: AskSchedule) => {
    const b = buildSchedule(ask, w, null) as Built
    return readSchedule(w.store, b.def, w.rowIds).forModel as {
      schedule: { columns: Record<string, unknown>[] }
      rows: string[][]
      rowCount: number
      message: string
    }
  }

  it('a length reads in mm, filters in metres; a text column and a unitless number carry no unit', () => {
    const out = read({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Clear Width', total: 'sum' }, { field: 'Width' }] })
    // 2026-10-02 (phase 4): a numeric column's decimals are read back, since they can be set.
    expect(out.schedule.columns).toEqual([
      { field: 'Name', heading: 'Name' },
      { field: 'Clear Width', heading: 'Clear Width', total: 'sum', decimals: 0, unit: 'mm', filterUnit: 'm' },
      { field: 'Width', heading: 'Width', decimals: 2 }
    ])
    expect(out.rows[0][1]).toBe('900')
    expect(out.message).toContain('so 900 mm is 0.9')
  })

  it('so "wider than 850 mm" is 0.85 — and 850 itself matches nothing, which the unit now says why', () => {
    const doors = measured.elements.filter((e) => e.type === 'IfcDoor').length
    const si = read({ category: ['IfcDoor'], columns: [{ field: 'Clear Width' }], filters: [{ field: 'Clear Width', op: '>', value: '0.85' }] })
    expect(si.rowCount).toBe(doors)
    const mm = read({ category: ['IfcDoor'], columns: [{ field: 'Clear Width' }], filters: [{ field: 'Clear Width', op: '>', value: '850' }] })
    expect(mm.rowCount).toBe(0)
    expect(mm.schedule.columns[0]).toMatchObject({ unit: 'mm', filterUnit: 'm' })
  })

  it('a column’s own display unit wins over the default, and an area reads in m²', () => {
    const b = buildSchedule({ category: ['IfcDoor'], columns: [{ field: 'Clear Width' }] }, w, null) as Built
    b.def.columns[0].format = { display: 'm', decimals: 3 }
    const out = readSchedule(w.store, b.def, w.rowIds).forModel as { schedule: { columns: Record<string, unknown>[] }; rows: string[][] }
    expect(out.schedule.columns[0]).toMatchObject({ unit: 'm', filterUnit: 'm' })
    expect(out.rows[0][0]).toBe('0.900')
    const area = readSchedule(store, built({ category: ['IfcSlab'], columns: [{ field: 'GFA Area' }] }).def, world.rowIds)
      .forModel as { schedule: { columns: Record<string, unknown>[] } }
    expect(area.schedule.columns[0]).toMatchObject({ unit: 'm²', filterUnit: 'm²' })
  })
})

/* ────────────────────────────── phase 4 (2026-10-02) ────────────────────────────── */

const DOORS: AskSchedule = { category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Level' }, { field: 'Width' }] }
const headingsOf = (def: ScheduleDef): string[] =>
  (simplify(def).columns as { heading: string }[]).map((c) => c.heading)
type Read = {
  headings: string[]
  rows: string[][]
  rowCount: number
  elementCount: number
  schedule: { columns: Record<string, unknown>[]; calculated?: Record<string, unknown>[]; [k: string]: unknown }
}
const readOf = (def: ScheduleDef, w: FieldWorld & { rowIds: number[] } = world, limit = 50): Read =>
  readSchedule(w.store, def, w.rowIds, { limit }).forModel as Read

describe('phase 4 — the Filter and Sorting tabs: filter logic, and itemise', () => {
  const [l1, l2] = ['L1', 'L2']
  const either: AskSchedule['filters'] = [
    { field: 'Level', op: '=', value: l1 },
    { field: 'Level', op: '=', value: l2 }
  ]

  it('filterLogic "or" lists what passes any filter; "and", the default, what passes every one', () => {
    const and = built({ ...DOORS, filters: either })
    expect(and.def.filterLogic).toBe('and')
    // No door is on two levels at once.
    expect(readOf(and.def).elementCount).toBe(0)
    const or = built({ ...DOORS, filters: either, filterLogic: 'or' })
    expect(or.def.filterLogic).toBe('or')
    expect(readOf(or.def).elementCount).toBe(doorsBy(l1) + doorsBy(l2))
    // Read back under the name it is set by, and only when it is not the default.
    expect(simplify(or.def).filterLogic).toBe('or')
    expect('filterLogic' in simplify(and.def)).toBe(false)
    // On the open schedule it is changed alone: the filters stay.
    const back = built({ base: 'open', filterLogic: 'and' }, or.def)
    expect([back.def.filterLogic, back.def.filters]).toEqual(['and', or.def.filters])
  })

  it('itemize:false collapses rows that read alike into one with a Count — and still lists every element', () => {
    const levels = [...new Set(doors.map((d) => d.storey))]
    const one = built({ category: ['IfcDoor'], columns: [{ field: 'Level' }], itemize: false })
    expect(one.def.itemize).toBe(false)
    const read = readOf(one.def)
    expect(read.headings).toEqual(['Level', 'Count'])
    expect(read.rows).toEqual(levels.map((l) => [l, String(doorsBy(l))]))
    expect([read.rowCount, read.elementCount]).toEqual([levels.length, doors.length])
    expect(simplify(one.def).itemize).toBe(false)
    // The default lists every element, and says nothing about it.
    const every = built({ category: ['IfcDoor'], columns: [{ field: 'Level' }] })
    expect(every.def.itemize).toBe(true)
    expect('itemize' in simplify(every.def)).toBe(false)
    expect(readOf(every.def).rowCount).toBe(doors.length)
    // And back again, on the open schedule.
    expect(built({ base: 'open', itemize: true }, one.def).def.itemize).toBe(true)
  })
})

describe('phase 4 — the Format tab: a column hidden, aligned, placed', () => {
  it('hidden keeps a column in the schedule without showing it; asking for it again shows it', () => {
    const b = built({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'GUID', hidden: true }] })
    expect(b.def.columns.map((c) => !!c.hidden)).toEqual([false, true])
    expect(readOf(b.def).headings).toEqual(['Name'])
    expect(simplify(b.def).columns).toEqual([
      { field: 'Name', heading: 'Name' },
      { field: 'GUID', heading: 'GUID', hidden: true }
    ])
    // On the open schedule: hide one that is shown, and show one that is hidden.
    const hid = built({ base: 'open', columns: [{ field: 'Name', hidden: true }, { field: 'GUID' }] }, b.def)
    expect(hid.def.columns.map((c) => !!c.hidden)).toEqual([true, false])
    expect(readOf(hid.def).headings).toEqual(['GUID'])
  })

  it('align is set, and is read back only where it is not what the table does anyway', () => {
    const b = built({
      category: ['IfcDoor'],
      columns: [{ field: 'Name', align: 'center' }, { field: 'Level', align: 'left' }, { field: 'Width', align: 'left' }]
    })
    expect(b.def.columns.map((c) => c.align)).toEqual(['center', 'left', 'left'])
    // Text is left and a number with decimals right, by the table's own rule (`alignOf`).
    expect(simplify(b.def).columns).toEqual([
      { field: 'Name', heading: 'Name', align: 'center' },
      { field: 'Level', heading: 'Level' },
      { field: 'Width', heading: 'Width', decimals: 2, align: 'left' }
    ])
  })

  it('after puts a new column directly behind another, and "" first', () => {
    const behind = built({ ...DOORS, columns: [...DOORS.columns!, { field: 'FireRating', after: 'Name' }] })
    expect(headingsOf(behind.def)).toEqual(['Name', 'FireRating', 'Level', 'Width'])
    const first = built({ ...DOORS, columns: [...DOORS.columns!, { field: 'FireRating', after: '' }] })
    expect(headingsOf(first.def)).toEqual(['FireRating', 'Name', 'Level', 'Width'])
    // By the field as well as by the heading, the way a rule's prop is read.
    const byField = built({ ...DOORS, columns: [...DOORS.columns!, { field: 'FireRating', after: 'storey' }] })
    expect(headingsOf(byField.def)).toEqual(['Name', 'Level', 'FireRating', 'Width'])
  })

  it('moves a column the open schedule already shows, and leaves the rest in their order', () => {
    const base = built(DOORS).def
    const moved = built({ base: 'open', columns: [{ field: 'Width', after: '' }] }, base)
    expect(headingsOf(moved.def)).toEqual(['Width', 'Name', 'Level'])
    // Nothing else about the column changed: it is the same column, somewhere else.
    expect(moved.def.columns[0]).toEqual(base.columns[2])
    // After itself is where it already stands.
    expect(headingsOf(built({ base: 'open', columns: [{ field: 'Level', after: 'Level' }] }, base).def)).toEqual([
      'Name',
      'Level',
      'Width'
    ])
    // Two moves in one call are applied in the order given.
    const two = built({ base: 'open', columns: [{ field: 'Width', after: '' }, { field: 'Name', after: 'Level' }] }, base)
    expect(headingsOf(two.def)).toEqual(['Width', 'Level', 'Name'])
  })

  it('refuses a column to go after one the schedule does not have, naming its columns', () => {
    const r = refused({ category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Width', after: 'Nope' }] })
    expect(r.error).toBe('No column of this schedule is "Nope" to put Width after — its columns are Name, Width.')
    expect(r.valid_values).toEqual({ columns: ['Name', 'Width'] })
  })
})

describe('phase 4 — a unit and decimals only where the Format tab offers them', () => {
  // A door's clear width and height as IfcLengthMeasures in the file's millimetres, and its leaf
  // area as an IfcAreaMeasure: the engine stores SI, and each column shows its display unit.
  const measured = federate([
    mockModelIndex('ARC', {
      element: (e) =>
        e.type === 'IfcDoor'
          ? {
              ...e,
              psets: { ...e.psets, Dims: { 'Clear Width': 900, 'Clear Height': 2100, 'Leaf Area': 1.89 } },
              psetMeta: {
                ...e.psetMeta,
                Dims: {
                  sourceExpressId: 0,
                  inherited: false,
                  kind: 'Pset',
                  measures: { 'Clear Width': 'IFCLENGTHMEASURE', 'Clear Height': 'IFCLENGTHMEASURE', 'Leaf Area': 'IFCAREAMEASURE' }
                }
              }
            }
          : e
    })
  ])
  const w = worldOf(measured)
  const make = (ask: AskSchedule, base: ScheduleDef | null = null): Built => {
    const r = buildSchedule(ask, w, base)
    if ('error' in r) throw new Error(r.error)
    return r
  }
  const refuse = (ask: AskSchedule): Refused => refused(ask, null, w)

  it('a length takes one of its own units, with the decimals asked for — and the cells follow', () => {
    const b = make({ category: ['IfcDoor'], columns: [{ field: 'Clear Width', unit: 'm', decimals: 3 }] })
    expect(b.def.columns[0].format).toMatchObject({ display: 'm', decimals: 3 })
    const read = readOf(b.def, w)
    expect(read.rows[0]).toEqual(['0.900'])
    expect(read.schedule.columns[0]).toEqual({ field: 'Clear Width', heading: 'Clear Width', decimals: 3, unit: 'm', filterUnit: 'm' })
    // A unit alone leaves the decimals the column had; decimals alone, its unit.
    const cm = make({ base: 'open', columns: [{ field: 'Clear Width', unit: 'cm' }] }, b.def)
    expect(cm.def.columns[0].format).toMatchObject({ display: 'cm', decimals: 3 })
    expect(readOf(cm.def, w).rows[0]).toEqual(['90.000'])
    const whole = make({ base: 'open', columns: [{ field: 'Clear Width', decimals: 0 }] }, cm.def)
    expect(whole.def.columns[0].format).toMatchObject({ display: 'cm', decimals: 0 })
    expect(readOf(whole.def, w).rows[0]).toEqual(['90'])
  })

  it('reads m2 and m3 as m² and m³, and deg as °', () => {
    const area = make({ category: ['IfcDoor'], columns: [{ field: 'Leaf Area', unit: 'm2', decimals: 1 }] })
    expect(area.def.columns[0].format).toMatchObject({ display: 'm²', decimals: 1 })
    expect(readOf(area.def, w).rows[0]).toEqual(['1.9'])
    expect(readOf(area.def, w).schedule.columns[0]).toMatchObject({ unit: 'm²', filterUnit: 'm²' })
  })

  it('refuses a unit the measure does not have, a unit on what is no measure, and decimals on text — and builds nothing', () => {
    expect(refuse({ category: ['IfcDoor'], columns: [{ field: 'Clear Width', unit: 'kg' }] }).error).toBe(
      'Clear Width is a length: its unit is one of mm, cm, m, km, in, ft — not "kg".'
    )
    expect(refuse({ category: ['IfcDoor'], columns: [{ field: 'Leaf Area', unit: 'mm' }] }).error).toBe(
      'Leaf Area is an area: its unit is one of mm², cm², m², ft², ha — not "mm".'
    )
    expect(refuse({ category: ['IfcDoor'], columns: [{ field: 'Name', unit: 'mm' }] }).error).toBe(
      'Name is not a length, an area, a volume, an angle or a mass, so it has no unit to set.'
    )
    expect(refuse({ category: ['IfcDoor'], columns: [{ field: 'Name', decimals: 2 }] }).error).toBe(
      'Name is not a number, so decimals do not apply to it.'
    )
    // A number the file gives no unit is a number: decimals apply, a unit does not.
    expect(make({ category: ['IfcDoor'], columns: [{ field: 'Width', decimals: 0 }] }).def.columns[0].format).toMatchObject({ decimals: 0 })
    expect(refuse({ category: ['IfcDoor'], columns: [{ field: 'Width', unit: 'mm' }] }).error).toMatch(/^Width is not a length/)
    // Every problem of one call is said at once.
    expect(
      refuse({ category: ['IfcDoor'], columns: [{ field: 'Name', decimals: 2 }, { field: 'Clear Width', unit: 'L' }] }).error
    ).toBe(
      'Name is not a number, so decimals do not apply to it. Clear Width is a length: its unit is one of mm, cm, m, km, in, ft — not "L".'
    )
  })

  it('a calculated column is typed by what its units work out to, unless the call says what it is', () => {
    const cols = [{ field: 'Clear Width' }, { field: 'Clear Height' }]
    const b = make({
      category: ['IfcDoor'],
      columns: cols,
      calculated: [
        { name: 'Twice', formula: '[Clear Width] * 2' },
        { name: 'Opening', formula: '[Clear Width] * [Clear Height]' },
        { name: 'Ratio', formula: '[Clear Height] / [Clear Width]' },
        { name: 'Plain', formula: '[Clear Width] * 2', result: 'number' }
      ]
    })
    expect(b.def.calculated!.map((c) => [c.name, c.result, c.unitKind])).toEqual([
      ['Twice', 'number', 'length'],
      ['Opening', 'number', 'area'],
      ['Ratio', 'number', undefined],
      ['Plain', 'number', undefined]
    ])
    const read = readOf(b.def, w)
    expect(read.headings).toEqual(['Clear Width', 'Clear Height', 'Twice', 'Opening', 'Ratio', 'Plain'])
    // 0.9 m × 2 shown in mm; 0.9 m × 2.1 m in m²; 2.1 / 0.9 and 0.9 × 2 as plain SI numbers.
    expect(read.rows[0]).toEqual(['900', '2,100', '1,800', '1.89', '2.33', '1.80'])
    expect(read.schedule.calculated).toEqual([
      { name: 'Twice', formula: '[Clear Width] * 2', result: 'length' },
      { name: 'Opening', formula: '[Clear Width] * [Clear Height]', result: 'area' },
      { name: 'Ratio', formula: '[Clear Height] / [Clear Width]', result: 'number' },
      { name: 'Plain', formula: '[Clear Width] * 2', result: 'number' }
    ])
    // A measured result takes a unit like any other column, when the call places it.
    const placed = make({
      category: ['IfcDoor'],
      columns: [{ field: 'Clear Width' }, { field: 'Twice', after: '', unit: 'm', decimals: 1 }],
      calculated: [{ name: 'Twice', formula: '[Clear Width] * 2' }]
    })
    expect(readOf(placed.def, w).headings).toEqual(['Twice', 'Clear Width'])
    expect(readOf(placed.def, w).rows[0]).toEqual(['1.8', '900'])
  })

  it('refuses a formula whose units cannot be added, in the editor’s own words', () => {
    const r = refuse({
      category: ['IfcDoor'],
      columns: [{ field: 'Clear Width' }, { field: 'Leaf Area' }],
      calculated: [{ name: 'Sum', formula: '[Leaf Area] + [Clear Width]' }]
    })
    expect(r.error).toBe(
      'Calculated column "Sum": This adds a area to a length, which cannot be right. A formula names other columns by their headings — [Clear Width] for one with a space — and this schedule\'s are Clear Width, Leaf Area.'
    )
    expect(r.valid_values).toEqual({ columns: ['Clear Width', 'Leaf Area'] })
  })
})

describe('phase 4 — calculated columns, in the engine’s own formula grammar', () => {
  it('a formula over the columns’ headings becomes a column at the right, and reads back by name', () => {
    const b = built({ ...DOORS, calculated: [{ name: 'Double', formula: 'Width * 2' }] })
    expect(b.def.calculated).toEqual([{ id: 'calc1', name: 'Double', kind: 'formula', formula: 'Width * 2', result: 'number' }])
    expect(b.def.columns.at(-1)).toEqual({ field: { kind: 'formula', id: 'calc1' }, align: 'right' })
    const read = readOf(b.def)
    expect(read.headings).toEqual(['Name', 'Level', 'Width', 'Double'])
    // The mock's Width is a number the file gives no unit: 2 400 doubled is 4 800.
    expect(read.rows[0].slice(2)).toEqual(['2,400.00', '4,800.00'])
    expect(read.schedule.calculated).toEqual([{ name: 'Double', formula: 'Width * 2', result: 'number' }])
    expect(read.schedule.columns.at(-1)).toMatchObject({ field: 'Double', heading: 'Double', calculated: true })
    // It came back out of the importer's own check unchanged.
    expect(parseScheduleDef(JSON.parse(JSON.stringify(b.def)))).toEqual(b.def)
  })

  it('a yes / no and a text result are the author’s to say', () => {
    const wide = doors.filter((d) => Number(d.qto.Qto_DoorBaseQuantities.Width) > 1000).length
    expect(wide).toBeGreaterThan(0)
    expect(wide).toBeLessThan(doors.length)
    const b = built({
      ...DOORS,
      calculated: [
        { name: 'Wide', formula: 'Width > 1000', result: 'yes_no' },
        { name: 'Size', formula: 'if(Width > 1000, "Wide", "Standard")', result: 'text' }
      ]
    })
    expect(b.def.calculated!.map((c) => c.result)).toEqual(['yesNo', 'text'])
    expect(b.def.columns.slice(-2).map((c) => c.align)).toEqual(['center', 'left'])
    const rows = readOf(b.def).rows
    expect(rows.filter((r) => r[3] === 'Yes')).toHaveLength(wide)
    expect(rows.filter((r) => r[3] === 'No')).toHaveLength(doors.length - wide)
    expect(rows.filter((r) => r[4] === 'Wide')).toHaveLength(wide)
    expect(rows.filter((r) => r[4] === 'Standard')).toHaveLength(doors.length - wide)
    expect(readOf(b.def).schedule.calculated).toEqual([
      { name: 'Wide', formula: 'Width > 1000', result: 'yes_no' },
      { name: 'Size', formula: 'if(Width > 1000, "Wide", "Standard")', result: 'text' }
    ])
  })

  it('percentageOf is each row’s share of a field’s total', () => {
    const b = built({ ...DOORS, calculated: [{ name: 'Share', percentageOf: 'Width' }] })
    expect(b.def.calculated).toEqual([
      { id: 'calc1', name: 'Share', kind: 'percentage', ofField: { kind: 'prop', pset: '*', prop: 'Width' } }
    ])
    const total = doors.reduce((a, d) => a + Number(d.qto.Qto_DoorBaseQuantities.Width), 0)
    const rows = readOf(b.def).rows
    for (const [i, d] of doors.entries()) {
      const share = (Number(d.qto.Qto_DoorBaseQuantities.Width) / total) * 100
      expect([d.name, rows[i][3]]).toEqual([d.name, share.toFixed(2)])
    }
    expect(readOf(b.def).schedule.calculated).toEqual([{ name: 'Share', percentageOf: 'Width' }])
    // A filter on it could never match — the share is worked out over what the filters leave.
    expect(
      refused({ ...DOORS, calculated: [{ name: 'Share', percentageOf: 'Width' }], filters: [{ field: 'Share', op: '>', value: 1 }] }).error
    ).toBe('A filter cannot test Share: a percentage is worked out over the rows the filters leave.')
    // A field that is not one refuses the call like any other name.
    expect(refused({ ...DOORS, calculated: [{ name: 'Share', percentageOf: 'Widht' }] }).valid_values?.fields?.Widht).toContain('Width')
  })

  it('is redefined by name on the open schedule, where it stands — and can be taken away as a column', () => {
    const base = built({ ...DOORS, calculated: [{ name: 'Double', formula: 'Width * 2' }] }).def
    const again = built({ base: 'open', calculated: [{ name: 'double', formula: 'Width * 3' }] }, base)
    expect(again.def.calculated).toEqual([{ id: 'calc1', name: 'Double', kind: 'formula', formula: 'Width * 3', result: 'number' }])
    expect(headingsOf(again.def)).toEqual(['Name', 'Level', 'Width', 'Double'])
    expect(readOf(again.def).rows[0][3]).toBe('7,200.00')
    // A second one is a second value, with an id of its own.
    const two = built({ base: 'open', calculated: [{ name: 'Half', formula: 'Width / 2' }] }, base)
    expect(two.def.calculated!.map((c) => [c.id, c.name])).toEqual([
      ['calc1', 'Double'],
      ['calc2', 'Half']
    ])
    // Turned into a share, it stops being a formula.
    const share = built({ base: 'open', calculated: [{ name: 'Double', percentageOf: 'Width' }] }, base)
    expect(share.def.calculated).toEqual([
      { id: 'calc1', name: 'Double', kind: 'percentage', ofField: { kind: 'prop', pset: '*', prop: 'Width' } }
    ])
    // removeColumns takes the column away; the value's definition is kept, as the editor keeps it.
    const gone = built({ base: 'open', removeColumns: ['Double'] }, base)
    expect(headingsOf(gone.def)).toEqual(['Name', 'Level', 'Width'])
    expect(gone.def.calculated).toEqual(base.calculated)
  })

  it('refuses a formula that does not parse, or names a heading no column has — with the reason, and builds nothing', () => {
    const parse = refused({ ...DOORS, calculated: [{ name: 'Bad', formula: 'Width *' }] })
    expect(parse.error).toBe(
      'Calculated column "Bad": "*" is missing a value. A formula names other columns by their headings — [Clear Width] for one with a space — and this schedule\'s are Name, Level, Width.'
    )
    expect(parse.valid_values).toEqual({ columns: ['Name', 'Level', 'Width'] })
    const name = refused({ ...DOORS, calculated: [{ name: 'Tall', formula: 'Height * 2' }] })
    expect(name.error).toMatch(/^Calculated column "Tall": Unknown field: Height\. A formula names other columns by their headings/)
    // Each bad one is named, and a good one beside them does not get the schedule built.
    const several = refused({
      ...DOORS,
      calculated: [
        { name: 'Good', formula: 'Width * 2' },
        { name: 'Bad', formula: '(Width' },
        { name: 'Tall', formula: 'Height + Depth' }
      ]
    })
    expect(several.error).toMatch(/^Calculated column "Bad": .+ Calculated column "Tall": Unknown fields: Height, Depth\. A formula names/)
    expect(several.error).not.toContain('"Good"')
  })

  it('refuses one with both a formula and a share, with neither, with no name, or two of one name', () => {
    const both = 'needs a formula over the other columns\' headings, or percentageOf — one of the two.'
    expect(refused({ ...DOORS, calculated: [{ name: 'X', formula: 'Width', percentageOf: 'Width' }] }).error).toBe(
      `Calculated column "X" ${both}`
    )
    expect(refused({ ...DOORS, calculated: [{ name: 'X' }] }).error).toBe(`Calculated column "X" ${both}`)
    expect(refused({ ...DOORS, calculated: [{ name: '  ', formula: 'Width' }] }).error).toBe('A calculated column needs a name.')
    expect(
      refused({ ...DOORS, calculated: [{ name: 'A', formula: 'Width' }, { name: 'a', formula: 'Width * 2' }] }).error
    ).toBe('Two calculated columns in one call are both called "a" — give each its own name.')
  })
})

describe('phase 4 — the elements a schedule lists, as a set', () => {
  const ids = (def: ScheduleDef): number[] => scheduleElementIds(store, def, world.rowIds)

  it('are every element of its rows, once each, in the table’s order — whatever the page', () => {
    const def = built(DOORS).def
    expect(ids(def)).toEqual(doors.map((d) => d.id))
    // The same set `get_schedule` hands the panel its chip for.
    expect(ids(def)).toEqual(readSchedule(store, def, world.rowIds, { limit: 2 }).ids)
    // Sorted, it is in the sort's order.
    const sorted = built({ ...DOORS, sortBy: [{ field: 'Name', descending: true }] }).def
    expect(ids(sorted)).toEqual([...doors].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)).map((d) => d.id))
  })

  it('follow the filters, and count every element of a collapsed or a grouped row', () => {
    const l1 = built({ ...DOORS, filters: [{ field: 'Level', op: '=', value: 'L1' }] }).def
    expect(ids(l1).sort((a, b) => a - b)).toEqual(doors.filter((d) => d.storey === 'L1').map((d) => d.id).sort((a, b) => a - b))
    const collapsed = built({ category: ['IfcDoor'], columns: [{ field: 'Level' }], itemize: false }).def
    expect(readOf(collapsed).rowCount).toBeLessThan(doors.length)
    expect(ids(collapsed).sort((a, b) => a - b)).toEqual(doors.map((d) => d.id).sort((a, b) => a - b))
    const grouped = built({ ...DOORS, groupBy: ['Level'], grandTotals: true }).def
    expect(new Set(ids(grouped))).toEqual(new Set(doors.map((d) => d.id)))
    expect(ids(grouped)).toHaveLength(doors.length)
    // A schedule that lists nothing names no element.
    const none = built({ ...DOORS, filters: [{ field: 'Level', op: '=', value: 'Nowhere' }] }).def
    expect(ids(none)).toEqual([])
  })
})
