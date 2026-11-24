/**
 * A formula may name another calculated column (2026-11-24, the owner; checks written before
 * the build).
 *
 *   1. by its name, with the right value and unit, through a chain; text and yes / no too;
 *   2. a loop is refused, every member names it, and nothing hangs (a cycle, a 50-long chain);
 *   3. a calculated column's name differs from every other heading — the editor, `make_schedule`
 *      and the heading box each refuse a duplicate;
 *   4. a rename rewrites the formulas that use it — name tokens only — keeping Vee's mark, in one
 *      undo step;
 *   5. a schedule saved before opens and calculates as before, duplicates included.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store'
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types'
import {
  emptySchedule, parseScheduleDef, type Calculated, type Column, type ScheduleDef
} from '../../../src/schedule/schedule/def'
import { runSchedule, type DataRow } from '../../../src/schedule/schedule/engine'
import { calcProblems, planComputed } from '../../../src/schedule/schedule/computed'
import { kindsByHeading } from '../../../src/schedule/schedule/columns'
import { dimensionOf, renameReference } from '../../../src/schedule/schedule/formula'
import { calcNameProblem, headingProblem } from '../../../src/schedule/schedule/calcNames'
import { addCalculated, setHeading, updateCalculated } from '../../../src/schedule/schedule/actions'
import { record, resetHistory, setClock, undo } from '../../../src/schedule/history'
import { federate } from '../../../src/shared/federate'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import { snapshotOf } from '../../../src/schedule/adapter'
import { buildSchedule, type AskSchedule, type Built, type FieldWorld, type Refused } from '../../../src/schedule/assistant'
import { toolByName } from '../../../src/shared/tool-schemas'

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0
}

function build(specs: { area?: number; height?: number }[]): ModelStore {
  const b = new StoreBuilder()
  const cores: ElemCore[] = []
  const cells: Record<string, Cell>[] = []
  specs.forEach((s, i) => {
    cores.push({
      entity: 'IfcSpace', name: `S${i}`, description: '', mark: `M${i}`,
      typeName: 'T1', family: 'Fam', objectType: '', predefinedType: '',
      guid: `g${i}`, storey: 'L1', storeyElevation: 0, building: '', site: '', space: '',
      material: '', discipline: 'ARC'
    })
    const c: Record<string, Cell> = {}
    if (s.area !== undefined) c['Q.NetFloorArea'] = { v: s.area, k: 'area' }
    if (s.height !== undefined) c['Q.Height'] = { v: s.height, k: 'length' }
    cells.push(c)
  })
  b.add(cores, cells)
  return b.finish(meta)
}

const colArea: Column = { field: { kind: 'prop', pset: 'Q', prop: 'NetFloorArea' }, heading: 'Area' }
const colHeight: Column = { field: { kind: 'prop', pset: 'Q', prop: 'Height' } }
const show = (id: string): Column => ({ field: { kind: 'formula', id }, format: { decimals: 3 } })
const f = (id: string, name: string, formula: string, more: Partial<Calculated> = {}): Calculated =>
  ({ id, name, kind: 'formula', formula, ...more })

function def(calculated: Calculated[], extra: Column[] = []): ScheduleDef {
  return {
    ...emptySchedule('S', ['IfcSpace']),
    columns: [colArea, colHeight, ...calculated.map((c) => show(c.id)), ...extra],
    calculated
  }
}
const data = (r: { kind: string }[]) => r.filter((x) => x.kind === 'data') as DataRow[]
const cellsOf = (store: ModelStore, d: ScheduleDef) => data(runSchedule(store, d).rows).map((r) => r.cells)
/** One row's raw computed values, by calculated id. */
const values = (store: ModelStore, d: ScheduleDef, row = 0) => {
  const out = planComputed(d).compute(store, row)
  return Object.fromEntries((d.calculated ?? []).map((c) => [c.id, out.get(`formula:${c.id}`)?.v]))
}

const STORE = build([{ area: 10, height: 2 }, { area: 4, height: 3 }])

describe('Done 1 — a formula uses another calculated column by its name', () => {
  it('Volume = Area * Height, then Volume * 1.1: the right number, worked out as a volume', () => {
    const d = def([
      f('c1', 'Volume', 'Area * Height', { unitKind: 'volume' }),
      f('c2', 'Plus ten', 'Volume * 1.1')
    ])
    expect(calcProblems(STORE, d).size).toBe(0)
    const v = values(STORE, d)
    expect(v.c1).toBe(20)
    expect(v.c2).toBeCloseTo(22, 9)
    expect(values(STORE, d, 1).c2).toBeCloseTo(13.2, 9)
    expect(dimensionOf('Volume * 1.1', kindsByHeading(STORE, d)).kind).toBe('volume')
    expect(dimensionOf('[volume] / Area', kindsByHeading(STORE, d)).kind).toBe('length')
  })

  it('the unit is inferred through the chain when the first one declares none', () => {
    const d = def([f('c1', 'Volume', 'Area * Height'), f('c2', 'Plus ten', 'Volume * 1.1')])
    expect(dimensionOf('Volume * 1.1', kindsByHeading(STORE, d)).kind).toBe('volume')
    // And a unit mistake through the chain is still caught.
    const bad = def([f('c1', 'Volume', 'Area * Height'), f('c2', 'Odd', 'Volume + Area')])
    expect(calcProblems(STORE, bad).get('c2')).toMatch(/adds a volume to a area/)
  })

  it('a chain of three, listed in any order', () => {
    const d = def([
      f('c3', 'Triple', 'Twice + Area'),
      f('c1', 'Base', 'Area * 1'),
      f('c2', 'Twice', 'Base * 2')
    ])
    expect(calcProblems(STORE, d).size).toBe(0)
    expect(values(STORE, d)).toEqual({ c3: 30, c1: 10, c2: 20 })
    expect(cellsOf(STORE, d)[1].slice(2)).toEqual(['12.000', '4.000', '8.000'])
    expect(dimensionOf('Triple', kindsByHeading(STORE, d)).kind).toBe('area')
  })

  it('a text result and a yes / no result are used as a model text or boolean column is', () => {
    const d = def([
      f('t', 'Band', 'if(Area > 5, "Large", "Small")', { result: 'text' }),
      f('y', 'Is large', 'Band = "large"', { result: 'yesNo' }),
      f('n', 'Large area', 'if([Is large], Area, 0)'),
      f('c', 'Band has g', 'contains(Band, "G")')
    ])
    expect(calcProblems(STORE, d).size).toBe(0)
    expect(values(STORE, d, 0)).toEqual({ t: 'Large', y: true, n: 10, c: 1 })
    expect(values(STORE, d, 1)).toEqual({ t: 'Small', y: false, n: 0, c: 0 })
  })

  it('a blank upstream makes a blank downstream, never a crash', () => {
    const store = build([{ area: 10 }])
    const d = def([f('c1', 'Volume', 'Area * Height'), f('c2', 'Plus ten', 'Volume * 1.1')])
    expect(values(store, d)).toEqual({ c1: undefined, c2: undefined })
  })

  it('the variable list the editor shows names the calculated ones too, and the problems know them', () => {
    const d = def([f('c1', 'Volume', 'Area * Height'), f('c2', 'Plus ten', '[Volume] * 1.1')])
    expect(calcProblems(STORE, d).get('c2')).toBeUndefined()
  })

  it('a percentage column cannot be named by a formula, and says so', () => {
    const d = def([
      { id: 'p1', name: 'Share', kind: 'percentage', ofField: colArea.field },
      f('c1', 'Twice share', 'Share * 2')
    ])
    expect(calcProblems(STORE, d).get('c1')).toBe('A percentage cannot be used in a formula: Share')
    expect(values(STORE, d).c1).toBeUndefined()
  })
})

describe('Done 2 — a loop is refused, every member names it, nothing hangs', () => {
  it('A uses B and B uses A', () => {
    const d = def([f('a', 'Alpha', 'Beta + 1'), f('b', 'Beta', 'Alpha + 1'), f('z', 'Fine', 'Area * 2')])
    const p = calcProblems(STORE, d)
    const msg = '"Alpha" and "Beta" use each other in a loop — a formula cannot use its own result, directly or through another column.'
    expect(p.get('a')).toBe(msg)
    expect(p.get('b')).toBe(msg)
    expect(p.has('z')).toBe(false)
    // The same way a formula that does not parse is reported: in the plan's errors, blank cells.
    expect(planComputed(d).errors.get('a')).toBe(msg)
    expect(cellsOf(STORE, d)[0].slice(2)).toEqual(['', '', '20.000'])
  })

  it('a longer cycle, and what depends on it is blank', () => {
    const d = def([
      f('a', 'A', 'C * 2'), f('b', 'B', 'A * 2'), f('c', 'C', 'B * 2'),
      f('d', 'After', 'C + 1')
    ])
    const p = calcProblems(STORE, d)
    const msg = '"A", "B" and "C" use each other in a loop — a formula cannot use its own result, directly or through another column.'
    for (const id of ['a', 'b', 'c']) expect([id, p.get(id)]).toEqual([id, msg])
    expect(values(STORE, d)).toEqual({ a: undefined, b: undefined, c: undefined, d: undefined })
  })

  it('a column naming itself', () => {
    const d = def([f('a', 'Self', 'Self * 2')])
    expect(calcProblems(STORE, d).get('a')).toBe(
      '"Self" uses itself — a formula cannot use its own result, directly or through another column.'
    )
    expect(values(STORE, d).a).toBeUndefined()
  })

  it('a 50-long chain computes; a 50-long cycle is refused at once', () => {
    const chain: Calculated[] = [f('k1', 'K1', 'Area')]
    for (let i = 2; i <= 50; i++) chain.push(f(`k${i}`, `K${i}`, `K${i - 1} + Area`))
    const d = def(chain.slice().reverse())
    const t0 = Date.now()
    expect(calcProblems(STORE, d).size).toBe(0)
    expect(values(STORE, d).k50).toBe(500)
    expect(dimensionOf('K50', kindsByHeading(STORE, d)).kind).toBe('area')
    const loop = chain.map((c, i) => (i === 0 ? { ...c, formula: 'K50 + Area' } : c))
    const p = calcProblems(STORE, def(loop))
    expect(p.size).toBe(50)
    expect(p.get('k1')).toMatch(/^"K1", "K2", .* and "K50" use each other in a loop/)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('Done 3 — a calculated column’s name differs from every other heading', () => {
  const base = def([f('c1', 'Volume', 'Area * Height'), f('c2', 'Plus ten', 'Volume * 1.1')])

  it('the editor refuses a duplicate, ignoring case and spaces, and keeps the old name', () => {
    const taken = 'Another column is already called "area" — each calculated column needs a name of its own.'
    expect(calcNameProblem(base, 'c2', 'area')).toBe(taken)
    expect(calcNameProblem(base, 'c2', '  VOLUME ')).toBe(
      'Another column is already called "VOLUME" — each calculated column needs a name of its own.'
    )
    expect(calcNameProblem(base, 'c2', 'Height')).toMatch(/already called "Height"/)
    expect(calcNameProblem(base, 'c2', 'Plus 10')).toBeNull()
    // Its own name, in another case, is not a duplicate.
    expect(calcNameProblem(base, 'c1', 'VOLUME')).toBeNull()
    const kept = updateCalculated(base, 'c2', { name: 'Area' })
    expect(kept.calculated!.map((c) => c.name)).toEqual(['Volume', 'Plus ten'])
  })

  it('a name a formula uses cannot be emptied; one nothing uses still can', () => {
    expect(calcNameProblem(base, 'c1', '  ')).toBe('Another formula uses this column, so it needs a name.')
    expect(calcNameProblem(base, 'c2', '')).toBeNull()
  })

  it('a model column’s heading cannot become a calculated column’s name', () => {
    expect(headingProblem(base, 0, 'volume')).toBe(
      'A calculated column is already called "Volume" — give this column another heading.'
    )
    expect(headingProblem(base, 0, 'Floor area')).toBeNull()
    expect(setHeading(base, 0, 'Volume').columns[0].heading).toBe('Area')
    // Clearing a heading back to a default that a calculated column has taken is refused too.
    const named = def([f('c1', 'NetFloorArea', 'Height * 2')])
    expect(headingProblem(named, 0, '')).toMatch(/already called "NetFloorArea"/)
  })

  it('a new calculated value never starts on a name already taken', () => {
    const d = def([f('c1', 'Calculated 2', 'Area')])
    const next = addCalculated(d, 'formula')
    const names = next.calculated!.map((c) => c.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('Done 4 — a rename rewrites the formulas that use it', () => {
  it('renameReference rewrites name tokens only, bare or bracketed, ignoring case', () => {
    expect(renameReference('Volume * 1.1', 'Volume', 'Door Volume')).toBe('[Door Volume] * 1.1')
    expect(renameReference('[volume] + VOLUME', 'Volume', 'Vol2')).toBe('[Vol2] + Vol2')
    expect(renameReference('if(contains(Band, "Volume"), Volume, 0)', 'volume', 'V')).toBe('if(contains(Band, "Volume"), V, 0)')
    expect(renameReference("Volumes + 'Volume' + VolumeX", 'Volume', 'V')).toBe("Volumes + 'Volume' + VolumeX")
    expect(renameReference('[Clear Width] / 2', 'clear width', 'Width_2')).toBe('[Width_2] / 2')
    expect(renameReference('Area * Area', 'Area', 'A-1')).toBe('[A-1] * [A-1]')
  })

  it('renaming a calculated column rewrites its users and keeps Vee’s mark and note', () => {
    const d = def([
      f('c1', 'Volume', 'Area * Height'),
      f('c2', 'Plus ten', 'Volume * 1.1', { by: 'vee', note: 'Ten percent more than the volume.' }),
      f('c3', 'Words', 'contains(Band, "Volume")')
    ])
    const next = updateCalculated(d, 'c1', { name: 'Door volume' })
    expect(next.calculated!.map((c) => [c.name, c.formula, c.by, c.note])).toEqual([
      ['Door volume', 'Area * Height', undefined, undefined],
      ['Plus ten', '[Door volume] * 1.1', 'vee', 'Ten percent more than the volume.'],
      ['Words', 'contains(Band, "Volume")', undefined, undefined]
    ])
    expect(values(STORE, next).c2).toBeCloseTo(22, 9)
  })

  it('renaming a model column’s heading rewrites the formulas that used it, back to its default too', () => {
    const d = def([f('c1', 'Twice', 'area * 2', { by: 'vee', note: 'Twice the area.' })])
    const renamed = setHeading(d, 0, 'Floor area')
    expect(renamed.calculated![0]).toMatchObject({ formula: '[Floor area] * 2', by: 'vee', note: 'Twice the area.' })
    expect(values(STORE, renamed).c1).toBe(20)
    const cleared = setHeading(renamed, 0, '')
    // Written bracketed as it was; a bracket around a bare word reads the same.
    expect(cleared.calculated![0].formula).toBe('[NetFloorArea] * 2')
    expect(values(STORE, cleared).c1).toBe(20)
  })

  it('a name a model column shadows is not rewritten when the calculated one is renamed', () => {
    // A file saved before: a calculated "Area" beside the model column "Area" — the model wins.
    const d = def([f('c1', 'Area', 'Height * 3'), f('c2', 'Uses', 'Area * 2')])
    const next = updateCalculated(d, 'c1', { name: 'Tall' })
    expect(next.calculated![1].formula).toBe('Area * 2')
  })

  describe('undo', () => {
    let clock = 0
    beforeEach(() => { clock = 0; setClock(() => clock) })
    it('restores the old name and the old formulas in one step', () => {
      const d = def([f('c1', 'Volume', 'Area * Height'), f('c2', 'Plus ten', 'Volume * 1.1')])
      resetHistory(d)
      const next = updateCalculated(d, 'c1', { name: 'Vol' })
      clock = 5000
      record(next)
      const back = undo()!
      expect(back.calculated!.map((c) => [c.name, c.formula])).toEqual([
        ['Volume', 'Area * Height'], ['Plus ten', 'Volume * 1.1']
      ])
    })
  })
})

describe('Done 5 — schedules saved before open and calculate as before', () => {
  it('a name both a model column and a calculated column have: the model column wins', () => {
    const saved = parseScheduleDef(JSON.parse(JSON.stringify(def([f('c1', 'Area', 'Height * 3'), f('c2', 'Uses', 'Area * 2')]))))
    expect(saved.calculated!.map((c) => c.name)).toEqual(['Area', 'Uses'])
    expect(values(STORE, saved)).toEqual({ c1: 6, c2: 20 })
    expect(calcProblems(STORE, saved).size).toBe(0)
  })

  it('two calculated columns sharing a name: not usable as a variable, and nothing is renamed', () => {
    const saved = parseScheduleDef(JSON.parse(JSON.stringify(def([
      f('c1', 'Twin', 'Area * 2'), f('c2', 'twin', 'Area * 3'), f('c3', 'Uses', 'Twin + 1')
    ]))))
    expect(saved.calculated!.map((c) => c.name)).toEqual(['Twin', 'twin', 'Uses'])
    expect(values(STORE, saved)).toEqual({ c1: 20, c2: 30, c3: undefined })
    expect(calcProblems(STORE, saved).get('c3')).toBe('Unknown field: Twin')
  })
})

describe('Done 3 / 6 — make_schedule refuses a duplicate name, and says it may chain', () => {
  const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
  const snap = snapshotOf(fed)
  const b = new StoreBuilder()
  b.add(snap.cores, snap.cells)
  const world: FieldWorld = { store: b.finish(snap.meta), propKeys: fed.propKeys }
  const run = (a: Record<string, unknown>, base: ScheduleDef | null = null): Built | Refused =>
    buildSchedule(a as unknown as AskSchedule, world, base)
  const DOORS = { category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Area' }, { field: 'Height' }] }

  it('chains: Volume, then 10 % more than Volume, the unit carried through the chain', () => {
    // The mock federation's numbers carry no unit kind, so the first is declared a volume.
    const r = run({
      ...DOORS,
      calculated: [
        { name: 'Volume', formula: 'Area * Height', result: 'volume' },
        { name: 'Volume +10%', formula: 'Volume * 1.1' }
      ]
    })
    if ('error' in r) throw new Error(r.error)
    expect(r.def.calculated!.map((c) => [c.name, c.unitKind, c.by])).toEqual([
      ['Volume', 'volume', 'vee'], ['Volume +10%', 'volume', 'vee']
    ])
    const plan = planComputed(r.def)
    let rows = 0
    for (let i = 0; i < world.store.cores.length; i++) {
      const out = plan.compute(world.store, i)
      const v = out.get('formula:calc1')?.v
      if (typeof v !== 'number') continue
      expect(out.get('formula:calc2')?.v).toBeCloseTo(v * 1.1, 9)
      rows++
    }
    expect(rows).toBeGreaterThan(0)
  })

  it('refuses a calculated name another heading has, with the reason', () => {
    const open = run(DOORS)
    if ('error' in open) throw new Error(open.error)
    const r = run({ base: 'open', calculated: [{ name: ' height', formula: 'Area * 2' }] }, open.def)
    expect('error' in r && r.error).toBe(
      'Calculated column "height": Another column is already called "height" — each calculated column needs a name of its own. This schedule’s columns are Name, Area, Height.'
    )
    // Redefining a calculated column by its own name is not a duplicate.
    const one = run({ base: 'open', calculated: [{ name: 'Volume', formula: 'Area * Height' }] }, open.def)
    if ('error' in one) throw new Error(one.error)
    const again = run({ base: 'open', calculated: [{ name: 'volume', formula: 'Area * Height * 2' }] }, one.def)
    expect('error' in again).toBe(false)
  })

  it('refuses a loop with its reason', () => {
    const r = run({
      ...DOORS,
      calculated: [{ name: 'A', formula: 'B + 1' }, { name: 'B', formula: 'A + 1' }]
    })
    expect('error' in r && r.error).toMatch(/^Calculated column "A": "A" and "B" use each other in a loop/)
  })

  it('the description says a formula may name another calculated column, not a percentage, and names are unique', () => {
    const d = toolByName('make_schedule')!.description
    expect(d).toContain(
      'A formula may also name another calculated column of the same schedule by its name, such as Volume * 1.1, but not a percentage one; a loop refuses the call, and so does a calculated column named like another column of the schedule.'
    )
  })
})
