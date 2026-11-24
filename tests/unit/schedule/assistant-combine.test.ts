/**
 * Vee and combine by sort value (2026-11-24, checks written before the build).
 *
 *   · `make_schedule` takes an optional `combine: 'identical' | 'sort'`; a bad value is refused
 *     by the input check, naming `make_schedule: combine`;
 *   · the built definition carries `combine: 'sort'` only for 'sort'; 'identical' takes it away;
 *   · the read-back (`simplify`, and `readSchedule`'s `schedule`) reports `combine: 'sort'` beside
 *     `itemize: false`;
 *   · E — `readSchedule` reads a combined schedule truthfully: the listed rows are the combined
 *     rows with the count last, a mixed cell is `<varies>`, the message says what a row and
 *     `<varies>` mean, and `filled` counts elements, not rows.
 *
 * Nothing here pins the whole `make_schedule` description or the eval case count: another build
 * is changing those.
 */
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import { snapshotOf } from '../../../src/schedule/adapter'
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store'
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types'
import { emptySchedule, parseScheduleDef, type Column, type ScheduleDef, type SortLevel } from '../../../src/schedule/schedule/def'
import { buildSchedule, readSchedule, simplify, type AskSchedule, type Built, type FieldWorld } from '../../../src/schedule/assistant'
import { toolByName } from '../../../src/shared/tool-schemas'
import { parseToolInput } from '../../../src/renderer/ai/executors/inputs'

const V = '<varies>'

/* ────────────────────────────── make_schedule ────────────────────────────── */

const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const snap = snapshotOf(fed)
const b = new StoreBuilder()
b.add(snap.cores, snap.cells)
const world: FieldWorld = { store: b.finish(snap.meta), propKeys: fed.propKeys }

/** `combine` is what the build adds to `AskSchedule` and `ScheduleDef`; typed loosely until then. */
const ask = (a: Record<string, unknown>): AskSchedule => a as unknown as AskSchedule
const built = (a: Record<string, unknown>, base: ScheduleDef | null = null): Built => {
  const r = buildSchedule(ask(a), world, base)
  if ('error' in r) throw new Error(r.error)
  return r
}
const combineOf = (d: unknown): unknown => (d as { combine?: unknown }).combine
const DOORS = { category: ['IfcDoor'], columns: [{ field: 'Type' }, { field: 'Level' }, { field: 'Width' }], sortBy: [{ field: 'Type' }] }

describe('make_schedule takes combine', () => {
  const make = toolByName('make_schedule')!

  it('the catalogue names combine: a string, "identical" or "sort", with a description', () => {
    const p = (make.input_schema.properties as Record<string, { type?: string; enum?: unknown[]; description?: string }>).combine
    expect(p).toBeDefined()
    expect(p.type).toBe('string')
    expect(p.enum).toEqual(['identical', 'sort'])
    expect(p.description?.length).toBeGreaterThan(0)
    expect(make.input_schema.required).toBeUndefined()
  })

  it('the input check keeps either value, and refuses any other naming make_schedule: combine', () => {
    expect(parseToolInput('make_schedule', { itemize: false, combine: 'sort' })).toEqual({ itemize: false, combine: 'sort' })
    expect(parseToolInput('make_schedule', { combine: 'identical' })).toEqual({ combine: 'identical' })
    for (const bad of ['revit', 'Sort', '', true, 1, null]) {
      expect(() => parseToolInput('make_schedule', { combine: bad }), String(bad)).toThrow(/make_schedule: combine/)
    }
  })
})

describe('buildSchedule sets and clears combine', () => {
  it('"sort" is carried on the definition, beside itemize false, and survives the window’s reader', () => {
    const { def } = built({ ...DOORS, itemize: false, combine: 'sort' })
    expect([def.itemize, combineOf(def)]).toEqual([false, 'sort'])
    expect(combineOf(parseScheduleDef(JSON.parse(JSON.stringify(def))))).toBe('sort')
  })

  it('"identical" leaves no key (guard: passes today)', () => {
    const { def } = built({ ...DOORS, itemize: false, combine: 'identical' })
    expect(Object.hasOwn(def, 'combine')).toBe(false)
  })

  it('on the open schedule: "identical" takes the key away; a call that does not name combine keeps it', () => {
    const open = built({ ...DOORS, itemize: false, combine: 'sort' }).def
    expect(combineOf(open)).toBe('sort')
    expect(Object.hasOwn(built({ base: 'open', combine: 'identical' }, open).def, 'combine')).toBe(false)
    expect(combineOf(built({ base: 'open', grandTotals: true }, open).def)).toBe('sort')
  })

  it('the read-back reports combine: "sort" beside itemize: false; without it, says nothing', () => {
    const on = built({ ...DOORS, itemize: false, combine: 'sort' }).def
    expect(simplify(on)).toMatchObject({ itemize: false, combine: 'sort' })
    const off = built({ ...DOORS, itemize: false }).def
    expect(simplify(off).itemize).toBe(false)
    expect('combine' in simplify(off)).toBe(false)
  })
})

/* ────────────────────────────── E. readSchedule reads it truthfully ────────────────────────────── */

// The prototype's 16 made-up doors: [type, level, width mm, height mm, fire rating].
const DOOR_ROWS: [string, string, number, number, string][] = [
  ['D01 Timber single', 'Level 1', 900, 2100, 'None'], ['D01 Timber single', 'Level 1', 900, 2100, 'None'],
  ['D01 Timber single', 'Level 1', 1000, 2100, 'None'], ['D01 Timber single', 'Level 2', 900, 2100, 'None'],
  ['D01 Timber single', 'Level 2', 900, 2100, '½ hr'], ['D01 Timber single', 'Level 2', 1000, 2100, 'None'],
  ['D02 Timber double', 'Level 1', 1800, 2100, '1 hr'], ['D02 Timber double', 'Level 1', 1800, 2100, '1 hr'],
  ['D02 Timber double', 'Level 2', 1800, 2400, '1 hr'], ['D02 Timber double', 'Level 2', 1800, 2400, '1 hr'],
  ['D03 Glass sliding', 'Level 1', 2400, 2100, 'None'], ['D03 Glass sliding', 'Level 1', 2400, 2100, 'None'],
  ['D03 Glass sliding', 'Level 2', 2400, 2100, 'None'],
  ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr'], ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr'],
  ['D04 Steel fire door', 'Level 1', 1000, 2100, '2 hr']
]
const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0
}
/** The doors as a store; `noFire` doors carry no fire rating, so `filled` has a gap to count. */
function doorStore(noFire: number[] = []): ModelStore {
  const sb = new StoreBuilder()
  const cores: ElemCore[] = []
  const cells: Record<string, Cell>[] = []
  DOOR_ROWS.forEach(([type, level, w, h, fire], i) => {
    cores.push({ entity: 'IfcDoor', name: `Door ${i}`, description: '', mark: String(i),
      typeName: type, family: 'F', objectType: '', predefinedType: 'DOOR',
      guid: `g${i}`, storey: level, storeyElevation: level === 'Level 1' ? 0 : 3.5, building: '', site: '', space: '',
      material: '', discipline: 'ARC'
    })
    cells.push({
      'Pset_DoorCommon.Width': { v: w / 1000, k: 'length' },
      'Pset_DoorCommon.Height': { v: h / 1000, k: 'length' },
      ...(noFire.includes(i) ? {} : { 'Pset_DoorCommon.FireRating': { v: fire } }),
      'Qto_DoorBaseQuantities.Area': { v: (w * h) / 1e6, k: 'area' }
    })
  })
  sb.add(cores, cells)
  return sb.finish(meta)
}
const COLS: Column[] = [
  { field: { kind: 'core', key: 'typeName' } },
  { field: { kind: 'core', key: 'storey' } },
  { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Width' }, format: { display: 'mm', decimals: 0 } },
  { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'Height' }, format: { display: 'mm', decimals: 0 } },
  { field: { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' }, heading: 'Fire rating' },
  { field: { kind: 'prop', pset: 'Qto_DoorBaseQuantities', prop: 'Area' }, heading: 'Area', total: 'sum' }
]
const BY_TYPE: SortLevel[] = [{ field: { kind: 'core', key: 'typeName' }, dir: 'asc' }]
const doorDef = (sort = BY_TYPE): ScheduleDef =>
  ({ ...emptySchedule('Door schedule', ['IfcDoor']), columns: COLS, sort, itemize: false, combine: 'sort' }) as ScheduleDef
const ROW_IDS = DOOR_ROWS.map((_, i) => 1000 + i)

interface Read {
  message: string
  headings: string[]
  rows: string[][]
  rowCount: number
  elementCount: number
  filled: Record<string, number>
  schedule: Record<string, unknown>
}
const readOf = (store: ModelStore, def: ScheduleDef): Read => readSchedule(store, def, ROW_IDS, { limit: 50 }).forModel as unknown as Read

describe('E. readSchedule reads a combined schedule truthfully', () => {
  const store = doorStore()
  const read = readOf(store, doorDef())
  const itemised = readOf(store, { ...doorDef(), itemize: true })

  it('the listed rows are the combined rows, each with its count as the last cell', () => {
    expect(read.headings).toEqual(['Type', 'Level', 'Width', 'Height', 'Fire rating', 'Area', 'Count'])
    expect([read.rowCount, read.elementCount]).toEqual([4, 16])
    expect(read.rows.map((r) => r[0])).toEqual(['D01 Timber single', 'D02 Timber double', 'D03 Glass sliding', 'D04 Steel fire door'])
    expect(read.rows.map((r) => r.at(-1))).toEqual(['6', '4', '3', '3'])
  })

  it('a mixed cell is <varies>, never one member’s value', () => {
    // D01: Level, Width and Fire rating differ among its six doors.
    expect([read.rows[0][1], read.rows[0][2], read.rows[0][4]]).toEqual([V, V, V])
    // D04’s three doors are all on Level 1, so that one agrees.
    expect(read.rows.map((r) => r[1])).toEqual([V, V, V, 'Level 1'])
  })

  it('the message says each row stands for the elements sharing its sort value, and what <varies> means', () => {
    expect(read.message).toContain(V)
    expect(read.message).toContain('Type')
    // The same schedule itemised says neither.
    expect(itemised.message).not.toContain(V)
  })

  it('the read-back of the definition reports combine: "sort"', () => {
    expect(read.schedule).toMatchObject({ itemize: false, combine: 'sort' })
  })

  it('filled counts elements with a value, per column, the same as the itemised read', () => {
    const gaps = doorStore([0, 4, 6])
    const c = readOf(gaps, doorDef())
    const i = readOf(gaps, { ...doorDef(), itemize: true })
    expect(c.rowCount).toBe(4)
    // Fire rating: 13 of 16 doors carry one; a combined D01 row reading <varies> holds two blanks.
    expect(i.filled['Fire rating']).toBe(13)
    for (const h of i.headings) expect([h, c.filled[h]]).toEqual([h, i.filled[h]])
  })
})
