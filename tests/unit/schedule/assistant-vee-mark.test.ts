/**
 * `make_schedule` marks what Vee made (2026-11-24, checks written before the build).
 *
 *   · each `calculated` item takes an optional `note` — one short plain sentence saying what the
 *     column works out — and the model never sends `by`;
 *   · the executor (`buildSchedule`) sets `by: 'vee'` on every calculated entry it creates, or
 *     whose formula or percentage it changes, and stores the note (cut at CALC_NOTE_CHARS);
 *   · on the open schedule, an entry it does not touch keeps what it had: a user's stays
 *     unmarked, Vee's earlier one keeps its mark and note.
 *
 * The same mock federation `assistant.test.ts` builds, minus its extra properties.
 */
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import { snapshotOf } from '../../../src/schedule/adapter'
import { StoreBuilder } from '../../../src/schedule/ifc/store'
import { parseScheduleDef, type ScheduleDef } from '../../../src/schedule/schedule/def'
import { buildSchedule, type AskSchedule, type Built, type FieldWorld } from '../../../src/schedule/assistant'
import { CALC_NOTE_CHARS, toolByName } from '../../../src/shared/tool-schemas'
import { parseToolInput } from '../../../src/renderer/ai/executors/inputs'

const fed = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
const snap = snapshotOf(fed)
const b = new StoreBuilder()
b.add(snap.cores, snap.cells)
const world: FieldWorld = { store: b.finish(snap.meta), propKeys: fed.propKeys }

/** `note` is what the build adds to `AskCalculated`; the asks are typed loosely until then. */
const ask = (a: Record<string, unknown>): AskSchedule => a as unknown as AskSchedule
const built = (a: Record<string, unknown>, base: ScheduleDef | null = null): Built => {
  const r = buildSchedule(ask(a), world, base)
  if ('error' in r) throw new Error(r.error)
  return r
}
const DOORS = { category: ['IfcDoor'], columns: [{ field: 'Name' }, { field: 'Level' }, { field: 'Width' }] }
const NOTE = 'Twice the door’s width.'
const entries = (def: ScheduleDef): Record<string, unknown>[] => def.calculated as unknown as Record<string, unknown>[]
const byName = (def: ScheduleDef, name: string): Record<string, unknown> =>
  entries(def).find((c) => c.name === name)!

describe('make_schedule’s calculated items take a note, never a by', () => {
  const make = toolByName('make_schedule')!
  const items = make.input_schema.properties.calculated.items!

  it('the catalogue names note, says what it is for, and has no by', () => {
    expect(Object.keys(items.properties!)).toContain('note')
    expect(Object.keys(items.properties!)).not.toContain('by')
    expect(items.properties!.note.type).toBe('string')
    expect(items.properties!.note.description).toContain(
      'one short plain sentence saying what the column works out, for someone who does not read formulas'
    )
    expect(items.required).toEqual(['name'])
    expect(CALC_NOTE_CHARS).toBe(160)
  })

  it('the input check keeps a note', () => {
    const input = { calculated: [{ name: 'Double', formula: 'Width * 2', note: NOTE }] }
    expect(parseToolInput('make_schedule', input)).toEqual(input)
  })
})

describe('buildSchedule marks what Vee made (Done 1)', () => {
  it('a new formula column: by vee, and the note stored', () => {
    const { def } = built({ ...DOORS, calculated: [{ name: 'Double', formula: 'Width * 2', note: NOTE }] })
    expect(byName(def, 'Double')).toMatchObject({ kind: 'formula', formula: 'Width * 2', by: 'vee', note: NOTE })
    // And the window's own reader keeps it as it is.
    expect(parseScheduleDef(JSON.parse(JSON.stringify(def)))).toEqual(def)
  })

  it('with no note: by vee, and no note key', () => {
    const { def } = built({ ...DOORS, calculated: [{ name: 'Double', formula: 'Width * 2' }] })
    const c = byName(def, 'Double')
    expect(c.by).toBe('vee')
    expect(Object.hasOwn(c, 'note')).toBe(false)
  })

  it('a percentage too', () => {
    const { def } = built({ ...DOORS, calculated: [{ name: 'Share', percentageOf: 'Width', note: 'Each door’s share of the total width.' }] })
    expect(byName(def, 'Share')).toMatchObject({ kind: 'percentage', by: 'vee', note: 'Each door’s share of the total width.' })
  })

  it('a by the call carries is not the model’s to set', () => {
    const { def } = built({ ...DOORS, calculated: [{ name: 'Double', formula: 'Width * 2', by: 'user' }] })
    expect(byName(def, 'Double').by).toBe('vee')
  })

  it('a note over the cap is cut to it', () => {
    const { def } = built({ ...DOORS, calculated: [{ name: 'Double', formula: 'Width * 2', note: 'n'.repeat(CALC_NOTE_CHARS + 50) }] })
    expect(byName(def, 'Double').note).toBe('n'.repeat(CALC_NOTE_CHARS))
  })
})

describe('on the open schedule, only what Vee changes is marked', () => {
  /** A door schedule with the user's own calculated column and one Vee made earlier. */
  const base = (): ScheduleDef => {
    const def = built({ ...DOORS, calculated: [{ name: 'Vee’s', formula: 'Width * 2', note: NOTE }] }).def
    def.calculated!.push({ id: 'u1', name: 'Mine', kind: 'formula', formula: 'Width * 3' })
    def.columns.push({ field: { kind: 'formula', id: 'u1' } })
    return parseScheduleDef(JSON.parse(JSON.stringify(def)))
  }

  it('a change that touches no calculated entry leaves both as they were', () => {
    const was = base()
    const { def } = built({ base: 'open', columns: [{ field: 'FireRating' }] }, was)
    expect(def.calculated).toEqual(was.calculated)
    expect(Object.hasOwn(byName(def, 'Mine'), 'by')).toBe(false)
  })

  it('adding another keeps Vee’s earlier mark and note, and the user’s stays unmarked', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'Half', formula: 'Width / 2', note: 'Half the width.' }] }, base())
    expect(byName(def, 'Vee’s')).toMatchObject({ by: 'vee', note: NOTE })
    expect(byName(def, 'Mine')).toEqual({ id: 'u1', name: 'Mine', kind: 'formula', formula: 'Width * 3' })
    expect(byName(def, 'Half')).toMatchObject({ by: 'vee', note: 'Half the width.' })
  })

  it('redefining the user’s column by name makes it Vee’s, with the new note', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'mine', formula: 'Width * 4', note: 'Four times the width.' }] }, base())
    expect(byName(def, 'Mine')).toMatchObject({ id: 'u1', formula: 'Width * 4', by: 'vee', note: 'Four times the width.' })
  })

  it('redefining Vee’s own with no note: still Vee’s, the old note gone', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'Vee’s', formula: 'Width * 5' }] }, base())
    const c = byName(def, 'Vee’s')
    expect(c).toMatchObject({ formula: 'Width * 5', by: 'vee' })
    expect(Object.hasOwn(c, 'note')).toBe(false)
  })

  it('a user column Vee turns into a percentage is Vee’s', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'Mine', percentageOf: 'Width' }] }, base())
    expect(byName(def, 'Mine')).toMatchObject({ kind: 'percentage', by: 'vee' })
  })
})

describe('the same formula or percentage sent again changes nothing (review 2026-11-24)', () => {
  const base = (): ScheduleDef => {
    const def = built({
      ...DOORS,
      calculated: [
        { name: 'Vee’s', formula: 'Width * 2', note: NOTE },
        { name: 'Share', percentageOf: 'Width', note: 'Each door’s share of the total width.' },
      ],
    }).def
    const widthField = (byName(def, 'Share') as { ofField: unknown }).ofField
    def.calculated!.push({ id: 'u1', name: 'Mine', kind: 'formula', formula: 'Width * 3' })
    def.calculated!.push({ id: 'u2', name: 'Spaced', kind: 'formula', formula: 'Width * 2 ' })
    def.calculated!.push({ id: 'u3', name: 'My share', kind: 'percentage', ofField: widthField as never })
    for (const id of ['u1', 'u2', 'u3']) def.columns.push({ field: { kind: 'formula', id } })
    return parseScheduleDef(JSON.parse(JSON.stringify(def)))
  }

  it('a user’s formula stored with trailing whitespace, sent again trimmed, stays unmarked', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'Spaced', formula: 'Width * 2', note: 'New.' }] }, base())
    const c = byName(def, 'Spaced')
    expect(Object.hasOwn(c, 'by')).toBe(false)
    expect(Object.hasOwn(c, 'note')).toBe(false)
  })

  it('Vee’s own formula sent again with a new note keeps the old note and the mark', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'Vee’s', formula: 'Width * 2', note: 'Another note.' }] }, base())
    expect(byName(def, 'Vee’s')).toMatchObject({ formula: 'Width * 2', by: 'vee', note: NOTE })
  })

  it('a user’s formula sent again the same stays unmarked', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'Mine', formula: 'Width * 3', note: 'Thrice.' }] }, base())
    const c = byName(def, 'Mine')
    expect(c).toMatchObject({ id: 'u1', formula: 'Width * 3' })
    expect(Object.hasOwn(c, 'by')).toBe(false)
    expect(Object.hasOwn(c, 'note')).toBe(false)
  })

  it('Vee’s percentage sent again with the same field keeps its mark and note', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'Share', percentageOf: 'Width' }] }, base())
    expect(byName(def, 'Share')).toMatchObject({ kind: 'percentage', by: 'vee', note: 'Each door’s share of the total width.' })
  })

  it('a user’s percentage sent again the same stays unmarked', () => {
    const { def } = built({ base: 'open', calculated: [{ name: 'My share', percentageOf: 'Width', note: 'A share.' }] }, base())
    const c = byName(def, 'My share')
    expect(c).toMatchObject({ kind: 'percentage' })
    expect(Object.hasOwn(c, 'by')).toBe(false)
    expect(Object.hasOwn(c, 'note')).toBe(false)
  })
})
