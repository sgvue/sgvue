/**
 * `ifcsg_columns` (2026-11-22) — the CoP property list for each sub-type of one IFC class the
 * loaded models carry, split into what the model carries (`inModel`) and what it does not
 * (`missing`), so a door schedule for an IFC+SG submission is built from present columns only.
 *
 * Driven through `executeTool`, the one door every model call comes through, on the design's
 * mock federation with its doors re-typed by name:
 *
 * | Door(s) | Sub-type | Added |
 * |---|---|---|
 * | `Entrance Door L1` | PredefinedType `OPENING` | `SGPset_Door.FireAccessOpening` |
 * | `Core Door L1` … `L4` | `DOOR` (as the mock has it) | `SGPset_Door.ClearWidth` |
 * | `Core Door L2` | `DOOR` | `SGPset_Door.Material` — a CoP name that is also a core Schedules field |
 * | `Room Door L4-03` | `USERDEFINED` + ObjectType `SINK` | — |
 * | `Room Door L3-03` | `NOTDEFINED`: no sub-type | — |
 * | `Room Door L2-03` | `USERDEFINED` + ObjectType `Single-Flush 900 x 2100`: no sub-type (not one upper-case token) | — |
 * | every other door | `DOOR` | — |
 *
 * Every mock door carries `Pset_DoorCommon` (`Reference`, `IsExternal`, `FireRating`, `FireExit`,
 * `HandicapAccessible`) and `Qto_DoorBaseQuantities` (`Width`, `Height`, `Area`).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import type { IfcElement } from '../../src/shared/model-index.types'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { useShell } from '../../src/renderer/state/shell'
import { connect, scheduleStore } from '../../src/renderer/model/schedule-link'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { IFCSG_SUBTYPES_CAP, subtypeOf } from '../../src/renderer/ai/executors/ifcsg'
import { noSubtypeCode, SUBTYPE_TOKEN } from '../../src/renderer/ai/heads-up'
import { resolveScheduleField } from '../../src/schedule/assistant'
import { copClassification } from '../../src/shared/ifcsg-cop'
import { resetShell } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const

function retype(e: IfcElement): IfcElement {
  if (e.type !== 'IfcDoor') return e
  const sg = (props: Record<string, string | number | boolean>): IfcElement => ({
    ...e,
    psets: { ...e.psets, SGPset_Door: { ...(e.psets.SGPset_Door ?? {}), ...props } }
  })
  if (e.name === 'Entrance Door L1') return { ...sg({ FireAccessOpening: true }), predefinedType: 'OPENING', effectivePredefinedType: 'OPENING' }
  if (e.name === 'Core Door L2') return sg({ ClearWidth: 850, Material: 'Timber' })
  if (/^Core Door L[1-4]$/.test(e.name)) return sg({ ClearWidth: 850 })
  if (e.name === 'Room Door L4-03') return { ...e, predefinedType: 'USERDEFINED', effectivePredefinedType: 'SINK', objectType: 'SINK' }
  if (e.name === 'Room Door L3-03') return { ...e, predefinedType: 'NOTDEFINED', effectivePredefinedType: 'NOTDEFINED' }
  // A Revit family name in ObjectType: IfcOpenShell's effective type is that text, but it is no IFC+SG sub-type.
  if (e.name === 'Room Door L2-03') return { ...e, predefinedType: 'USERDEFINED', effectivePredefinedType: 'Single-Flush 900 x 2100', objectType: 'Single-Flush 900 x 2100' }
  return e
}

const fed = federate(KEYS.map((k) => mockModelIndex(k, { element: retype })))
const doors = fed.elements.filter((e) => e.type === 'IfcDoor')

type Group = {
  classification: string
  subtype: string | null
  count: number
  component?: string
  copPages?: string
  inModel?: string[]
  missing?: string[]
  copName?: Record<string, string>
  note?: string
}
type Body = { message: string; entity?: string; subtypes?: Group[]; truncated?: boolean; subtypesTotal?: number; source?: string }

const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: async () => ({ columns: [], rows: [], truncated: false, ms: 0 }) as never,
  rawLine: async () => null,
  turn
})
const run = async (name: string, input: unknown = {}): Promise<Body> => (await executeTool(name, input, ctx())) as Body

beforeEach(() => {
  resetShell()
  useShell.getState().commitModels(fed)
  Object.assign(turn, newTurnState())
})

/** The CoP's DOOR list, in its own order, less the names given. */
const doorListLess = (present: string[]): string[] =>
  copClassification('IfcDoor', 'DOOR')!.properties.map((p) => p.name).filter((n) => !present.includes(n))

describe('ifcsg_columns', () => {
  it('finds each sub-type the doors carry, with its count, and splits the CoP list into inModel and missing', async () => {
    expect(doors.length).toBeGreaterThan(5)
    const body = await run('ifcsg_columns', { entity: 'IfcDoor' })
    expect(body.entity).toBe('IfcDoor')
    expect(body.source).toContain('not an official BCA publication')
    const groups = body.subtypes!
    // Largest first; then by name, with the one that has no sub-type last among equals. The family
    // name `Single-Flush 900 x 2100` is no sub-type: it joins the NOTDEFINED door, not a group of its own.
    expect(groups.map((g) => [g.classification, g.count])).toEqual([
      ['IfcDoor.DOOR', doors.length - 4],
      ['IfcDoor', 2],
      ['IfcDoor.OPENING', 1],
      ['IfcDoor.SINK', 1]
    ])
    const [door, , opening] = groups
    expect(door).toMatchObject({ subtype: 'DOOR', component: 'Door', copPages: '262' })
    // CoP order. `Material` is a core Schedules field too, so it is named with its set.
    expect(door.inModel).toEqual(['ClearWidth', 'FireExit', 'FireRating', 'IsExternal', 'SGPset_Door.Material'])
    expect(door.copName).toEqual({ 'SGPset_Door.Material': 'Material' })
    expect(door.missing).toEqual(doorListLess(['ClearWidth', 'FireExit', 'FireRating', 'IsExternal', 'Material']))
    expect(door.missing).toHaveLength(16)
    expect(opening).toMatchObject({ subtype: 'OPENING', inModel: ['FireAccessOpening'], missing: ['AmendmentStatus', 'Status'] })
    expect(body.truncated).toBeUndefined()
  })

  it('narrows to one sub-type when asked, and says so when the model carries none of it', async () => {
    const one = await run('ifcsg_columns', { entity: 'IfcDoor', subtype: 'opening' })
    expect(one.subtypes!.map((g) => g.classification)).toEqual(['IfcDoor.OPENING'])
    const none = await run('ifcsg_columns', { entity: 'IfcDoor', subtype: 'GATE' })
    expect(none.subtypes).toBeUndefined()
    expect(none.message).toMatch(/No IfcDoor in the loaded models is of sub-type GATE/)
    expect(none.message).toContain('DOOR')
  })

  it('gives only names make_schedule’s own field resolution accepts, as property columns', async () => {
    const body = await run('ifcsg_columns', { entity: 'IfcDoor' })
    const s = useShell.getState()
    const world = { store: scheduleStore(s).store, propKeys: s.propKeys }
    const names = body.subtypes!.flatMap((g) => g.inModel ?? [])
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const r = resolveScheduleField(name, world)
      expect([name, r.ok, r.ok && r.field.kind]).toEqual([name, true, 'prop'])
    }
    // And the schedule itself is made from them, refusing none.
    const sent: unknown[] = []
    connect({ postMessage: (m: unknown) => sent.push(m), close: () => undefined, onmessage: null } as unknown as MessagePort)
    try {
      const made = await run('make_schedule', {
        category: ['IfcDoor'],
        columns: [{ field: 'Name' }, ...[...new Set(names)].map((field) => ({ field }))],
        groupBy: ['PredefinedType']
      })
      expect(made.message).not.toMatch(/Nothing was changed/)
      expect(sent.length).toBeGreaterThan(0)
    } finally {
      connect(null)
    }
  })

  it('returns a sub-type the CoP does not list with a plain note, never an error', async () => {
    const body = await run('ifcsg_columns', { entity: 'IfcDoor' })
    const sink = body.subtypes!.find((g) => g.classification === 'IfcDoor.SINK')!
    expect(sink.subtype).toBe('SINK')
    expect(sink.note).toMatch(/CoP lists no columns for IfcDoor\.SINK/)
    expect(sink.note).not.toMatch(/\b(error|invalid|wrong|not allowed)\b/i)
    expect(sink.inModel).toBeUndefined()
    expect(sink.missing).toBeUndefined()
    const plain = body.subtypes!.find((g) => g.subtype === null)!
    expect(plain.note).toMatch(/no sub-type/i)
    expect(plain.note).toMatch(/CoP lists no columns for IfcDoor\b/)
  })

  it('says plainly when no loaded model carries the class', async () => {
    const body = await run('ifcsg_columns', { entity: 'IfcRamp' })
    expect(body.message).toBe('No loaded model carries IfcRamp, so there are no sub-types to look up.')
    expect(body.subtypes).toBeUndefined()
    // The class is matched without regard to case.
    expect((await run('ifcsg_columns', { entity: 'ifcdoor' })).entity).toBe('IfcDoor')
  })

  it('is bounded: past its cap of sub-types it lists the largest and says it cut', async () => {
    // Each wall's name as one upper-case token, so every wall is a sub-type of its own.
    const token = (name: string): string => name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    const walls = federate(
      KEYS.map((k) =>
        mockModelIndex(k, {
          element: (e) => (e.type === 'IfcWall' ? { ...e, predefinedType: 'USERDEFINED', objectType: token(e.name), effectivePredefinedType: token(e.name) } : e)
        })
      )
    )
    useShell.getState().commitModels(walls)
    const n = new Set(walls.elements.filter((e) => e.type === 'IfcWall').map((e) => token(e.name))).size
    expect(n).toBeGreaterThan(IFCSG_SUBTYPES_CAP)
    const body = await run('ifcsg_columns', { entity: 'IfcWall' })
    expect(body.subtypes).toHaveLength(IFCSG_SUBTYPES_CAP)
    expect(body.truncated).toBe(true)
    expect(body.subtypesTotal).toBe(n)
  })

  it('is a read tool: it changes nothing the user sees', async () => {
    const before = useShell.getState()
    await run('ifcsg_columns', { entity: 'IfcDoor' })
    const after = useShell.getState()
    expect(after.stack).toBe(before.stack)
    expect(after.hidden).toBe(before.hidden)
    expect(turn.acted).toBe(false)
    expect(turn.chips).toEqual([])
  })
  it('reads a sub-type by the prompt’s rule: a family-name ObjectType is none, USERDEFINED + SINK is IfcDoor.SINK', async () => {
    const body = await run('ifcsg_columns', { entity: 'IfcDoor' })
    const none = body.subtypes!.find((g) => g.subtype === null)!
    expect(none.count).toBe(2)
    expect(body.subtypes!.some((g) => /Single-Flush/.test(g.classification))).toBe(false)
    const sink = body.subtypes!.find((g) => g.subtype === 'SINK')!
    expect(sink.classification).toBe('IfcDoor.SINK')
    expect(sink.note).toMatch(/CoP lists no columns for IfcDoor\.SINK/)
    expect(subtypeOf({ predefinedType: 'USERDEFINED', objectType: 'Single-Flush 900 x 2100' })).toBeNull()
    expect(subtypeOf({ predefinedType: 'USERDEFINED', objectType: 'SINK' })).toBe('SINK')
  })

  it('agrees with the heads-up on every one-token case it is tested on (vee-stage2’s own lists)', () => {
    const yes = ['TRENCH', 'PAD_FOOTING', 'A1', 'X']
    const no = ['Trench', 'TRENCH 1', 'Single-Flush 900 x 2100', '1TRENCH', '', 'TRENCH-A']
    for (const code of ['', 'NOTDEFINED', 'USERDEFINED']) {
      for (const ot of yes) expect([code, ot, subtypeOf({ predefinedType: code, objectType: ot })]).toEqual([code, ot, ot])
      for (const ot of no) expect([code, ot, subtypeOf({ predefinedType: code, objectType: ot })]).toEqual([code, ot, null])
      // The heads-up's ObjectType-only finding is exactly "an ObjectType, and no sub-type here".
      for (const ot of [...yes, ...no]) {
        const headsUp = noSubtypeCode(code) && !!ot && !SUBTYPE_TOKEN.test(ot)
        expect([code, ot, headsUp]).toEqual([code, ot, !!ot && subtypeOf({ predefinedType: code, objectType: ot }) === null])
      }
    }
    // A stated PredefinedType is the sub-type, whatever the ObjectType says.
    for (const ot of [...yes, ...no]) expect(subtypeOf({ predefinedType: 'DOOR', objectType: ot })).toBe('DOOR')
  })
  it('tells Vee to schedule the whole class, never filtered by sub-type, the unclassified in their own group (live eval, 2026-11-22)', async () => {
    // Two of three live runs filtered make_schedule to PredefinedType = DOOR and dropped the
    // NOTDEFINED doors: "no CoP columns" read as "leave these out". They are what a coordinator must see.
    const body = await run('ifcsg_columns', { entity: 'IfcDoor' })
    for (const said of [
      'Schedule every IfcDoor — category IfcDoor, with no filter on sub-type or PredefinedType — grouped by PredefinedType',
      'elements with no sub-type, or one the CoP does not list, stay in the schedule in their own group',
      'IfcDoor — 2: no CoP columns, kept in the schedule',
      'IfcDoor.SINK — 1: no CoP columns, kept in the schedule'
    ]) {
      expect([said, body.message.includes(said)]).toEqual([said, true])
    }
  })
})
