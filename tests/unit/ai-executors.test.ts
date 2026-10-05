/**
 * Every tool, on the design's own mock federation, with the numbers written out.
 *
 * The mock is 412 elements across four discipline files, and it is the same federation the
 * parity screenshots are taken on — so "trees by species" has one right answer (Angsana 8,
 * Tembusu 8) and a tool that starts guessing fails here rather than in front of a coordinator.
 *
 * 2026-10-01: `set_section` sets one of two independent cuts — the cases cover one beside the
 * other, clearing one, clearing both, an unknown name, and the one string that names them. And
 * it does what the user's click does: a new plane cuts, at the chip's own default offset;
 * `cut:false` previews; the same kind and name again changes only what the call passes — an
 * omitted `offset`, `flip` or `cut` keeps what the plane has — and never clears the plane.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { SCOPE_GUARD, visPatch } from '../../src/renderer/ai/executors/view'
import { MAX_TOOL_IDS } from '../../src/shared/tool-schemas'
import { FILTER_SETS_CAP } from '../../src/shared/filter-stack'
import { HL } from '../../src/shared/colors'
import { visFn } from '../../src/shared/rules'
import { LEVEL_DEFAULT_OFFSET_MM, NO_PLANE, NO_SECTIONS } from '../../src/shared/sections'
import { chipPatch } from '../../src/renderer/state/selectors/section'
import {
  CHIP_CAP,
  COLOR_GROUP_CAP,
  VALID_VALUES_CAP
} from '../../src/renderer/ai/executors/context'
import { FIND_PROPERTIES_CAP, SPATIAL_DEPTH } from '../../src/renderer/ai/executors/read'
import { NEAREST_CAP, TOP_VALUES_CAP } from '../../src/renderer/ai/executors/names'
import type { RawLine } from '../../src/worker/index-builder'
import { rigViewer } from './rig-viewer'
import { resetShell } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const full = federate(KEYS.map((k) => mockModelIndex(k)))

interface Body {
  message?: string
  [key: string]: unknown
}

let sqlAnswer: (sql: string) => Promise<unknown> = async () => ({
  columns: ['n'],
  rows: [[1]],
  truncated: false,
  ms: 1
})
let rawAnswer: RawLine | null = null

const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: (sql) => sqlAnswer(sql) as never,
  rawLine: async () => rawAnswer,
  turn
})

const run = async (name: string, input: unknown = {}): Promise<Body> =>
  (await executeTool(name, input, ctx())) as Body

/** Every element in the loaded federation, by id. */
const ALL_IDS = (): number[] => useShell.getState().federation.elements.map((e) => e.id)

beforeEach(() => {
  resetShell()
  useShell.getState().commitModels(full)
  Object.assign(turn, newTurnState())
})

/* ────────────────────────────── reading ────────────────────────────── */

describe('summarize_elements', () => {
  it('counts the site trees by species: Angsana 8, Tembusu 8', async () => {
    const body = await run('summarize_elements', {
      groupBy: 'SpeciesCommonName',
      rules: [{ prop: 'PredefinedType', op: '=', val: 'VEGETATION' }]
    })
    expect(body.matched).toBe(16)
    expect(body.groups).toEqual([
      {
        value: 'Angsana',
        count: 8,
        area: expect.any(Number),
        volume: 0,
        length: 0,
        areaFrom: 8,
        volumeFrom: 0,
        lengthFrom: 0
      },
      {
        value: 'Tembusu',
        count: 8,
        area: expect.any(Number),
        volume: 0,
        length: 0,
        areaFrom: 8,
        volumeFrom: 0,
        lengthFrom: 0
      }
    ])
    expect(body.message).toContain('16 elements in 2 groups by SpeciesCommonName')
    // The table is UI, and does not cross IPC.
    expect(turn.table!.rows.map((r) => [r.k, r.n])).toEqual([
      ['Angsana', 8],
      ['Tembusu', 8]
    ])
    expect(body).not.toHaveProperty('ids')
  })

  it('splits the slabs by PredefinedType', async () => {
    const body = await run('summarize_elements', {
      groupBy: 'PredefinedType',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcSlab' }]
    })
    expect(body.groups).toEqual([
      expect.objectContaining({ value: 'FLOOR', count: 3 }),
      expect.objectContaining({ value: 'BASESLAB', count: 1 }),
      expect.objectContaining({ value: 'ROOF', count: 1 })
    ])
  })

  it('falls back to what is VISIBLE when no rules are given', async () => {
    await run('set_storeys', { visible: ['L2'] })
    const body = await run('summarize_elements', { groupBy: 'IfcEntity' })
    expect(body.matched).toBe(92)
  })

  it('names the nearest keys when nothing carries the one asked for', async () => {
    // 2026-09-28: the keys most like the name asked, not the first forty in file order.
    const body = await run('summarize_elements', { groupBy: 'SpeciesName' })
    expect(body.message).toContain('None of those')
    const keys = (body.valid_values as { propKeys: { nearest: Record<string, string[]> } }).propKeys
    expect(keys.nearest.SpeciesName.slice(0, 2).sort()).toEqual([
      'SpeciesBotanicalName',
      'SpeciesCommonName'
    ])
    expect(body.message).toContain('nearest: Species')
  })

  it('says where a real key is carried when the elements summarised do not carry it', async () => {
    const body = await run('summarize_elements', {
      groupBy: 'SpeciesCommonName',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    })
    expect(body.message).toContain('None of those')
    expect(body.carriedInFederation).toBe(16)
    // A real key is not "unknown", so no nearest-key list is offered for it.
    expect(body).not.toHaveProperty('valid_values')
  })
})

describe('query_elements', () => {
  it('reports per-OR-group counts and five samples', async () => {
    const body = await run('query_elements', {
      rules: [
        { prop: 'IfcEntity', op: '=', val: 'IfcDoor' },
        { prop: 'IfcEntity', op: '=', val: 'IfcStair', join: 'or' }
      ]
    })
    expect(body.matched).toBe(20)
    expect(body.groups).toEqual([
      { label: 'IfcEntity=IfcDoor', n: 17 },
      { label: 'IfcEntity=IfcStair', n: 3 }
    ])
    expect(body.samples).toHaveLength(5)
    expect(turn.chips[0].label).toBe('20 found')
  })

  it('hands back valid values when a guess matches nothing', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcGlass' }]
    })
    expect(body.matched).toBe(0)
    expect(body.message).toContain('No elements match')
    expect(
      (body.valid_values as { entities: { values: string[] } }).entities.values
    ).toContain('IfcWindow')
  })
})

describe('audit_model', () => {
  it('finds nothing to report on a complete federation', async () => {
    const body = await run('audit_model')
    expect(body.message).toBe('No data-completeness issues found.')
    expect(body.findings).toEqual([])
  })

  it('reports a finding, with a chip, when data is missing', async () => {
    const elements = full.elements.map((e, i) =>
      i < 3 ? { ...e, predefinedType: 'NOTDEFINED' } : e
    )
    useShell.setState({ federation: { ...full, elements } })
    const body = await run('audit_model')
    expect(body.findings).toContainEqual({
      label: 'No PredefinedType',
      count: 3,
      note: 'Blocks entity-level classification'
    })
    expect(turn.chips[0]).toEqual({ label: 'No PredefinedType (3)', ids: expect.any(Array) })
  })
})

describe('clash_check', () => {
  it('finds bbox candidates between two loaded models and says what they are', async () => {
    const body = await run('clash_check', { modelA: 'ARC', modelB: 'STR' })
    expect(body.candidates).toBe(442)
    expect(body.method).toContain('candidates for review')
    expect(body.message).toContain('candidates for review, not confirmed solid clashes')
    expect((body.pairs as unknown[]).length).toBe(25)
    expect(body.truncated).toBe(true)
    expect(turn.table!.clash).toBe(true)
  })

  it('refuses two names that are not both loaded, and lists what is', async () => {
    const body = await run('clash_check', { modelA: 'ARC', modelB: 'HVAC' })
    expect(body.message).toContain('Both models must be loaded')
    expect(body.valid_values).toEqual(['ARC', 'STR', 'SIT', 'MEP'])
  })

  it('refuses one model against itself', async () => {
    expect((await run('clash_check', { modelA: 'ARC', modelB: 'ARC' })).message).toBe(
      'Pick two different models.'
    )
  })
})

describe('the additional read tools', () => {
  it('get_element returns the whole record, provenance included', async () => {
    const tree = full.elements.find((e) => e.name.startsWith('Tree T01'))!
    const body = await run('get_element', { id: tree.id })
    expect(body.guid).toBe(tree.guid)
    expect(body.model).toBe('SIT')
    expect((body.psets as Record<string, Record<string, unknown>>).SGPset_Planting
      .SpeciesCommonName).toBe('Angsana')
    expect(body).toHaveProperty('psetMeta')
    expect(body).toHaveProperty('bboxMetres')
  })

  it('get_element finds the same element by GlobalId', async () => {
    const tree = full.elements.find((e) => e.name.startsWith('Tree T01'))!
    expect((await run('get_element', { guid: tree.guid })).id).toBe(tree.id)
    expect((await run('get_element', { guid: 'nope' })).message).toContain('No element with GlobalId')
  })

  it('list_values counts every distinct value and pages', async () => {
    const body = await run('list_values', { attr: 'SpeciesCommonName' })
    expect(body.values).toEqual([
      { value: 'Angsana', count: 8 },
      { value: 'Tembusu', count: 8 }
    ])
    expect(body.total).toBe(2)
    expect(body.truncated).toBe(false)

    const page = await run('list_values', { attr: 'IfcEntity', limit: 2, offset: 0 })
    expect((page.values as unknown[]).length).toBe(2)
    expect(page.truncated).toBe(true)
  })

  it('list_values filters with `contains` and refuses a key nothing carries', async () => {
    const some = await run('list_values', { attr: 'IfcEntity', contains: 'wall' })
    expect((some.values as { value: string }[]).every((v) => /wall/i.test(v.value))).toBe(true)
    expect((await run('list_values', { attr: 'Nope' })).message).toContain('Nothing carries')
  })

  it('search finds an element by name and says where it matched', async () => {
    const body = await run('search', { text: 'Tembusu', limit: 3 })
    expect(body.matched).toBe(8)
    expect((body.matches as { matchedIn: string }[])[0].matchedIn).toBe('Name')
    expect(body.truncated).toBe(true)
  })

  it('search reaches into property values', async () => {
    const body = await run('search', { text: 'Pterocarpus indicus' })
    expect(body.matched).toBe(8)
    expect((body.matches as { matchedIn: string }[])[0].matchedIn).toBe(
      'SGPset_Planting.SpeciesBotanicalName'
    )
  })

  it('get_spatial_tree walks IfcProject down to the storeys', async () => {
    const body = await run('get_spatial_tree', { model: 'ARC', counts: true })
    const models = body.models as { model: string; tree: { type: string; children: unknown[] } }[]
    expect(models[0].model).toBe('ARC')
    expect(models[0].tree.type).toBe('IfcProject')
    expect(JSON.stringify(models[0].tree)).toContain('IfcBuildingStorey')
  })

  it('get_relationships names the type object, materials and containment', async () => {
    const wall = full.elements.find((e) => e.type === 'IfcWall')!
    const body = await run('get_relationships', { id: wall.id })
    expect((body.containedIn as { storey: string }).storey).toBe(wall.storey)
    expect((body.typeObject as { name: string }).name).toBe(wall.objectType)
    expect(body).toHaveProperty('decomposition')
  })

  it('get_model_info carries the header, units, georeferencing and the CORENET X readout', async () => {
    const body = await run('get_model_info', { model: 'ARC' })
    const m = (body.models as Record<string, unknown>[])[0]
    expect(m.model).toBe('ARC')
    expect(m.schema).toBe('IFC4')
    // The mock authors its quantities in millimetres, so the file unit is 0.001 m — read,
    // never assumed (`shared/units.ts`).
    expect((m.units as { metresPerLengthUnit: number }).metresPerLengthUnit).toBe(0.001)
    const geo = m.georeferencing as { source: string; corenetX: { status: string; isSg: boolean } }
    // The mock has no file behind it, so it georeferences nothing — and says so rather than
    // inventing an origin.
    expect(geo.source).toBe('none')
    expect(geo.corenetX.status).toBe('na')
    expect(geo.corenetX.isSg).toBe(false)
  })

  it('get_view_state reports the live stack with per-step counts', async () => {
    await run('set_filter_stack', {
      steps: [{ action: 'isolate', rules: [{ prop: 'Level', op: '=', val: 'L2' }] }]
    })
    const body = await run('get_view_state')
    expect(body.totalElements).toBe(412)
    expect(body.visibleElements).toBe(92)
    expect((body.filterStack as { matched: number }[])[0].matched).toBe(92)
    expect(body.loadedModels).toEqual(['ARC', 'STR', 'SIT', 'MEP'])
  })

  it('measure_between works in metres off the bounding boxes, and says so', async () => {
    const [a, b] = full.elements.filter((e) => e.bbox)
    const body = await run('measure_between', { a: a.id, b: b.id })
    expect(typeof body.centreToCentreMetres).toBe('number')
    expect(body.message).toContain('Bounding-box arithmetic, not solid geometry')
    expect(body).toHaveProperty('boxGapMetres')
  })

  it('get_entity_raw asks the parse worker and passes the line straight through', async () => {
    rawAnswer = { expressId: 42, type: 'IFCWALL', attributes: { Name: 'W-01' } }
    const tree = full.elements.find((e) => e.model === 'SIT')!
    const body = await run('get_entity_raw', { model: 'SIT', expressId: tree.expressId })
    expect(body).toEqual({ model: 'SIT', expressId: 42, type: 'IFCWALL', attributes: { Name: 'W-01' } })
    rawAnswer = null
    expect((await run('get_entity_raw', { model: 'SIT', expressId: 1 })).message).toContain(
      'No line #1 in SIT'
    )
  })

  it('query_sql returns the shape the tool promises, and the guard’s refusal verbatim', async () => {
    sqlAnswer = async () => ({ columns: ['n'], rows: [[412]], truncated: false, ms: 3 })
    const ok = await run('query_sql', { sql: 'SELECT count(*) AS n FROM element' })
    expect(ok).toEqual({ columns: ['n'], rows: [[412]], rowCount: 1, truncated: false, ms: 3 })

    sqlAnswer = async () => {
      throw new Error('only SELECT, WITH or EXPLAIN may be run; this begins with DROP')
    }
    const refused = await run('query_sql', { sql: 'DROP TABLE element' })
    expect(refused.refused).toBe(true)
    expect(refused.message).toBe('only SELECT, WITH or EXPLAIN may be run; this begins with DROP')
  })
})

/* ────────────────────────────── changing the view ────────────────────────────── */

describe('set_filter_stack', () => {
  it('isolates L2 then hides the windows in ONE call, with real counts per step', async () => {
    const body = await run('set_filter_stack', {
      steps: [
        { action: 'isolate', rules: [{ prop: 'Level', op: '=', val: 'L2' }] },
        { action: 'hide', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }] }
      ]
    })
    expect(body.applied).toBe(true)
    expect(body.steps).toEqual([
      { step: 1, action: 'isolate', label: 'Level = L2', matched: 92 },
      { step: 2, action: 'hide', label: 'IfcEntity = IfcWindow', matched: 55 }
    ])
    expect(body.visibleElements).toBe(78)
    expect(body.totalElements).toBe(412)

    const st = useShell.getState()
    expect(st.stack).toHaveLength(2)
    expect(st.stack.map((x) => x.action)).toEqual(['isolate', 'hide'])
    expect(st.stepSel).toBe(st.stack[1].id)
    expect(turn.acted).toBe(true)
    // It lands on the same undo stack as a manual change.
    expect(st.canUndo).toBe(true)
  })

  it('appends rather than replacing when combine is "append"', async () => {
    await run('set_filter_stack', {
      steps: [{ action: 'isolate', rules: [{ prop: 'Level', op: '=', val: 'L2' }] }]
    })
    await run('set_filter_stack', {
      steps: [{ action: 'hide', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }] }],
      combine: 'append'
    })
    expect(useShell.getState().stack).toHaveLength(2)
  })

  it('refuses outright a stack that would leave nothing visible', async () => {
    const body = await run('set_filter_stack', {
      steps: [{ action: 'hide', rules: [{ prop: 'Model', op: '!=', val: 'nothing' }] }]
    })
    expect(body.applied).toBe(false)
    expect(body.wouldLeaveVisible).toBe(0)
    expect(body.message).toContain('would leave nothing visible')
    expect(useShell.getState().stack).toHaveLength(0)
  })

  it('holds back a change under the 5 % scope guard and hands over the patch', async () => {
    const body = await run('set_filter_stack', {
      steps: [{ action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcStair' }] }]
    })
    expect(3 / 412).toBeLessThan(SCOPE_GUARD)
    expect(body.pending).toBe(true)
    expect(body.wouldLeaveVisible).toBe(3)
    expect(body.message).toContain('The user has an Apply button')
    // Nothing changed yet…
    expect(useShell.getState().stack).toHaveLength(0)
    // …and the pending entry is a patch, not a label with one attached.
    expect(Object.keys(turn.pending!.patch!).sort()).toEqual(['stack', 'stepSel'])
    expect(turn.pending!.label).toBe('1 filter step — leaves 3 of 412 visible')
  })
})

describe('apply_visibility', () => {
  it('applies one step and reports the groups', async () => {
    const body = await run('apply_visibility', {
      action: 'isolate',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    })
    expect(body.applied).toBe(true)
    expect(body.step).toBe(1)
    expect(body.appended).toBe(false)
    expect(useShell.getState().stack).toHaveLength(1)
  })

  it('appends on the second call in the same turn rather than discarding the first', async () => {
    await run('apply_visibility', {
      action: 'isolate',
      rules: [{ prop: 'Level', op: '=', val: 'L2' }]
    })
    const second = await run('apply_visibility', {
      action: 'hide',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }]
    })
    expect(second.appended).toBe(true)
    expect(second.step).toBe(2)
    expect(second.visibleElements).toBe(78)
    expect(useShell.getState().stack).toHaveLength(2)
  })

  it('keeps the current action when none is given (the design\u2019s own rule)', async () => {
    await run('apply_visibility', {
      action: 'highlight',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    })
    const second = await run('apply_visibility', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcSlab' }]
    })
    expect(second.action).toBe('highlight')
    expect(useShell.getState().stack.map((x) => x.action)).toEqual(['highlight', 'highlight'])
  })

  it('is exempt from the scope guard for highlight, which hides nothing', async () => {
    const body = await run('apply_visibility', {
      action: 'highlight',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcStair' }]
    })
    expect(body.applied).toBe(true)
    expect(turn.pending).toBeNull()
  })

  it('resets the whole view', async () => {
    await run('apply_visibility', {
      action: 'isolate',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    })
    const body = await run('apply_visibility', { action: 'reset' })
    expect(body.message).toBe('All elements visible again.')
    expect(useShell.getState().stack.every((x) => !x.on)).toBe(true)
  })
})

describe('the other view tools', () => {
  it('manage_filters lists, disables and removes by 1-based step number', async () => {
    await run('set_filter_stack', {
      steps: [
        { action: 'isolate', rules: [{ prop: 'Level', op: '=', val: 'L2' }] },
        { action: 'hide', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }] }
      ]
    })
    expect((await run('manage_filters', { op: 'list' })).steps).toEqual([
      { step: 1, enabled: true, action: 'isolate', label: 'Level = L2' },
      { step: 2, enabled: true, action: 'hide', label: 'IfcEntity = IfcWindow' }
    ])
    await run('manage_filters', { op: 'disable', step: 2 })
    expect(useShell.getState().stack[1].on).toBe(false)
    await run('manage_filters', { op: 'remove', step: 1 })
    expect(useShell.getState().stack).toHaveLength(1)
    expect((await run('manage_filters', { op: 'move', step: 9, to: 1 })).message).toContain(
      'No step 9'
    )
    await run('manage_filters', { op: 'clear' })
    expect(useShell.getState().stack).toHaveLength(0)
  })

  it('select_elements selects and chips them', async () => {
    const body = await run('select_elements', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcStair' }],
      zoom: false
    })
    expect(body.selected).toBe(3)
    expect(useShell.getState().selIds).toHaveLength(3)
    expect(turn.chips[0].label).toBe('3 selected')
  })

  it('set_storeys refuses an unknown name and lists the real ones', async () => {
    const bad = await run('set_storeys', { visible: ['Mezzanine'] })
    expect(bad.message).toContain('Unknown storey: Mezzanine')
    expect(bad.valid_values).toEqual(['Foundation', 'L1', 'L2', 'L3', 'L4', 'Roof'])

    await run('set_storeys', { visible: ['L2'] })
    expect(useShell.getState().storeyVis).toEqual({
      Foundation: false,
      L1: false,
      L2: true,
      L3: false,
      L4: false,
      Roof: false
    })
    await run('set_storeys', { visible: [] })
    expect(useShell.getState().storeyVis).toEqual({})
  })

  it('activate_model refuses a model that is not loaded', async () => {
    const bad = await run('activate_model', { key: 'HVAC' })
    expect(bad.message).toContain('Not loaded: HVAC')
    await run('activate_model', { key: 'STR' })
    expect(useShell.getState().active).toBe('STR')
  })

  it('set_section refuses an unknown grid and names the real ones', async () => {
    const bad = await run('set_section', { kind: 'grid', name: 'Z' })
    expect(bad.valid_values).toEqual(['A', 'B', 'C', 'D', 'E', '1', '2', '3', '4'])
    expect(useShell.getState().sections).toEqual(NO_SECTIONS)
    const cut = await run('set_section', { kind: 'grid', name: 'C' })
    expect(cut).toMatchObject({ message: 'Section cut at grid C.', section: 'grid C' })
    expect(useShell.getState().sections.grid).toEqual({ name: 'C', offset: 0, flip: false, cut: true })
    expect(useShell.getState().card).toBe('section')
    const cleared = await run('set_section', { kind: null })
    expect(cleared).toMatchObject({ message: 'Section cleared.', section: null })
    expect(useShell.getState().sections).toEqual(NO_SECTIONS)
  })

  /* ── 2026-10-01: the gridline cut and the level cut are independent planes ── */

  it('set_section sets one plane and leaves the other alone', async () => {
    const sections = () => useShell.getState().sections
    await run('set_section', { kind: 'grid', name: 'C', offset: 500, flip: true })
    const level = await run('set_section', { kind: 'level', name: 'L2', offset: 1200 })
    // The gridline cut is exactly as it was; the result names both.
    expect(sections().grid).toMatchObject({ name: 'C', offset: 500, flip: true })
    expect(sections().level).toMatchObject({ name: 'L2', offset: 1200, flip: false })
    expect(level.section).toBe('grid C + level L2')
    expect(level.message).toBe('Section cut at level L2. The gridline section at C is unchanged.')

    // Moving one does not move the other, in either direction.
    const grid = await run('set_section', { kind: 'grid', name: 'D' })
    expect(sections().grid).toMatchObject({ name: 'D', offset: 0, flip: false })
    expect(sections().level).toMatchObject({ name: 'L2', offset: 1200 })
    expect(grid.section).toBe('grid D + level L2')
    expect(grid.message).toBe('Section cut at grid D. The level section at L2 is unchanged.')
    // And the view state says the same thing as the tool's result.
    expect((await run('get_view_state')).section).toBe('grid D + level L2')
  })

  it('set_section with a kind and no name clears just that cut', async () => {
    const sections = () => useShell.getState().sections
    await run('set_section', { kind: 'grid', name: 'C' })
    await run('set_section', { kind: 'level', name: 'L2', offset: 1200 })

    const one = await run('set_section', { kind: 'level', name: '' })
    // The block's own `Clear`: the plane back to nothing, its offset and `cut` with it.
    expect(sections().level).toEqual(NO_PLANE)
    expect(sections().grid.name).toBe('C')
    expect(one).toMatchObject({
      message: 'The level section is cleared. The gridline section at C is unchanged.',
      section: 'grid C'
    })

    // No `name` at all means the same as an empty one.
    await run('set_section', { kind: 'level', name: 'L3' })
    const other = await run('set_section', { kind: 'grid' })
    expect(sections().grid).toEqual(NO_PLANE)
    expect(sections().level.name).toBe('L3')
    expect(other).toMatchObject({
      message: 'The gridline section is cleared. The level section at L3 is unchanged.',
      section: 'level L3'
    })
    // Clearing a plane that is not set is harmless and says what is left: nothing.
    await run('set_section', { kind: 'level' })
    expect(await run('set_section', { kind: 'grid' })).toMatchObject({
      message: 'The gridline section is cleared.',
      section: null
    })
  })

  it('set_section with kind:null clears both cuts', async () => {
    await run('set_section', { kind: 'grid', name: 'C' })
    await run('set_section', { kind: 'level', name: 'L2' })
    expect((await run('get_view_state')).section).toBe('grid C + level L2')
    const body = await run('set_section', { kind: null })
    expect(body).toMatchObject({ message: 'Section cleared.', section: null })
    // The card's own `Clear all`.
    expect(useShell.getState().sections).toEqual(NO_SECTIONS)
    expect((await run('get_view_state')).section).toBeNull()
  })

  /*
   * ── 2026-10-01, the owner: "assistant should possess everything user can do on the app" ──
   * `set_section` does what the user's click does: a plane it sets cuts, at the chip's own
   * default offset, and `cut:false` is the card's `cut` button off.
   */

  it('set_section cuts by default, at the chip\'s own default offset for the kind', async () => {
    const sections = () => useShell.getState().sections
    const grid = await run('set_section', { kind: 'grid', name: 'C' })
    expect(sections().grid).toEqual({ name: 'C', offset: 0, flip: false, cut: true })
    expect(grid.message).toBe('Section cut at grid C.')
    // A level's default is the design's 1 200 mm above the storey — the chip's, not a copy.
    const level = await run('set_section', { kind: 'level', name: 'L2' })
    expect(sections().level).toEqual({ name: 'L2', offset: LEVEL_DEFAULT_OFFSET_MM, flip: false, cut: true })
    expect(level.message).toBe('Section cut at level L2. The gridline section at C is unchanged.')
    // Exactly what the two chips write on a card with nothing set.
    expect(sections().grid).toEqual({ ...NO_PLANE, ...chipPatch('C', 'grid', NO_PLANE) })
    expect(sections().level).toEqual({ ...NO_PLANE, ...chipPatch('L2', 'level', NO_PLANE) })
  })

  it('set_section takes an explicit offset and side, zero included', async () => {
    const sections = () => useShell.getState().sections
    await run('set_section', { kind: 'level', name: 'L2', offset: 500, flip: true })
    expect(sections().level).toEqual({ name: 'L2', offset: 500, flip: true, cut: true })
    // 0 is an offset, not "omitted": the level cut at the slab itself, on another storey.
    await run('set_section', { kind: 'level', name: 'L3', offset: 0 })
    expect(sections().level).toEqual({ name: 'L3', offset: 0, flip: false, cut: true })
    await run('set_section', { kind: 'grid', name: 'C', offset: -250 })
    expect(sections().grid).toEqual({ name: 'C', offset: -250, flip: false, cut: true })
  })

  it('set_section at a new name starts from the defaults, whatever the plane had before', async () => {
    const grid = () => useShell.getState().sections.grid
    await run('set_section', { kind: 'grid', name: 'C', offset: 500, flip: true, cut: false })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: true, cut: false })
    // Another gridline: its own offset, not flipped, cutting — nothing carried over from C.
    await run('set_section', { kind: 'grid', name: 'D' })
    expect(grid()).toEqual({ name: 'D', offset: 0, flip: false, cut: true })
    // And after a clear the same name is a new plane again.
    await run('set_section', { kind: 'grid', name: 'D', offset: 750, flip: true })
    await run('set_section', { kind: 'grid' })
    await run('set_section', { kind: 'grid', name: 'D' })
    expect(grid()).toEqual({ name: 'D', offset: 0, flip: false, cut: true })
  })

  it('set_section with cut:false previews the plane, and says so', async () => {
    const body = await run('set_section', { kind: 'grid', name: 'C', cut: false })
    expect(useShell.getState().sections.grid).toEqual({ name: 'C', offset: 0, flip: false, cut: false })
    expect(body).toMatchObject({ message: 'Section previewed at grid C.', section: 'grid C' })
    // `cut:true` on that plane is the card's `cut` button turned on.
    const cut = await run('set_section', { kind: 'grid', name: 'C', cut: true })
    expect(useShell.getState().sections.grid).toEqual({ name: 'C', offset: 0, flip: false, cut: true })
    expect(cut.message).toBe('Section cut at grid C.')
    // On a new plane `cut:true` is the same as leaving it out.
    await run('set_section', { kind: 'level', name: 'L2', cut: true })
    expect(useShell.getState().sections.level.cut).toBe(true)
  })

  it('set_section: a new plane cuts, a preview stays a preview while it is moved, and cut:true cuts it', async () => {
    const grid = () => useShell.getState().sections.grid
    // {kind, name} on a new plane → cuts.
    const made = await run('set_section', { kind: 'grid', name: 'C' })
    expect(grid()).toEqual({ name: 'C', offset: 0, flip: false, cut: true })
    expect(made.message).toBe('Section cut at grid C.')
    // {kind, name, cut:false} → previews.
    const preview = await run('set_section', { kind: 'grid', name: 'C', cut: false })
    expect(grid()).toEqual({ name: 'C', offset: 0, flip: false, cut: false })
    expect(preview.message).toBe('Section previewed at grid C.')
    // {kind, name, offset:500} on that previewed plane → still a preview, moved.
    const moved = await run('set_section', { kind: 'grid', name: 'C', offset: 500 })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: false, cut: false })
    expect(moved.message).toBe('Section previewed at grid C.')
    // … and flipped: the card's `flip side` never touches `cut` either.
    await run('set_section', { kind: 'grid', name: 'C', flip: true })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: true, cut: false })
    // {kind, name, cut:true} → cuts it, where it stands.
    const cut = await run('set_section', { kind: 'grid', name: 'C', cut: true })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: true, cut: true })
    expect(cut.message).toBe('Section cut at grid C.')
  })

  it('set_section re-sent for the plane already set changes only what it passes, and never clears it', async () => {
    const grid = () => useShell.getState().sections.grid
    await run('set_section', { kind: 'grid', name: 'C', offset: 500, flip: true })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: true, cut: true })
    // A second click on the live chip would clear the plane; the tool's same name does not.
    expect(chipPatch('C', 'grid', grid())).toEqual({ name: '' })

    // Only `cut`: the same kind and name again, and nothing else. A preview, where it stood.
    const preview = await run('set_section', { kind: 'grid', name: 'C', cut: false })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: true, cut: false })
    expect(preview).toMatchObject({ message: 'Section previewed at grid C.', section: 'grid C' })
    // The same kind and name with nothing else changes nothing — an omitted `cut` keeps the
    // preview, as an omitted offset keeps the offset — and the result says what the plane is.
    const same = await run('set_section', { kind: 'grid', name: 'C' })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: true, cut: false })
    expect(same.message).toBe('Section previewed at grid C.')
    // … and back, by saying so.
    const back = await run('set_section', { kind: 'grid', name: 'C', cut: true })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: true, cut: true })
    expect(back.message).toBe('Section cut at grid C.')

    // Only the side.
    await run('set_section', { kind: 'grid', name: 'C', flip: false })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: false, cut: true })
    await run('set_section', { kind: 'grid', name: 'C', flip: true })
    expect(grid()).toEqual({ name: 'C', offset: 500, flip: true, cut: true })
    // Only the offset — zero included, which is "on the gridline", not "omitted".
    await run('set_section', { kind: 'grid', name: 'C', offset: 1000 })
    expect(grid()).toEqual({ name: 'C', offset: 1000, flip: true, cut: true })
    await run('set_section', { kind: 'grid', name: 'C', offset: 0 })
    expect(grid()).toEqual({ name: 'C', offset: 0, flip: true, cut: true })

    // A cutting plane keeps cutting while it is moved; a preview keeps previewing.
    await run('set_section', { kind: 'grid', name: 'C', offset: 250 })
    expect(grid()).toEqual({ name: 'C', offset: 250, flip: true, cut: true })
    await run('set_section', { kind: 'grid', name: 'C', offset: 300, cut: false })
    expect(grid()).toEqual({ name: 'C', offset: 300, flip: true, cut: false })
    await run('set_section', { kind: 'grid', name: 'C', offset: 350 })
    expect(grid()).toEqual({ name: 'C', offset: 350, flip: true, cut: false })

    // A plane the user set by hand — offset and side from the card — is changed the same way.
    useShell.getState().setSec('level', { name: 'L2', offset: 2350, flip: true, cut: true })
    await run('set_section', { kind: 'level', name: 'L2', cut: false })
    expect(useShell.getState().sections.level).toEqual({ name: 'L2', offset: 2350, flip: true, cut: false })
    // So is one the user only previewed — a grid bubble's click: naming it again leaves it a
    // preview, and `cut:true` is what cuts it.
    useShell.getState().gridClick('D')
    expect(grid()).toMatchObject({ name: 'D', cut: false })
    const named = await run('set_section', { kind: 'grid', name: 'D' })
    expect(grid()).toMatchObject({ name: 'D', cut: false })
    expect(named.message).toBe('Section previewed at grid D. The level section at L2 is unchanged.')
    await run('set_section', { kind: 'grid', name: 'D', cut: true })
    expect(grid()).toMatchObject({ name: 'D', offset: 0, cut: true })
    // The level plane was not touched by the gridline calls.
    expect(useShell.getState().sections.level).toEqual({ name: 'L2', offset: 2350, flip: true, cut: false })
  })

  it('set_section refuses a `cut` that is not a boolean, and changes nothing', async () => {
    const before = useShell.getState().sections
    await expect(run('set_section', { kind: 'grid', name: 'C', cut: 'yes' })).rejects.toThrow(/set_section: cut/)
    expect(useShell.getState().sections).toBe(before)
  })

  it('set_section with an unknown name changes neither plane and lists the valid ones', async () => {
    await run('set_section', { kind: 'grid', name: 'C' })
    await run('set_section', { kind: 'level', name: 'L2' })
    const before = useShell.getState().sections
    const grid = await run('set_section', { kind: 'grid', name: 'ZZ' })
    expect(grid.message).toContain('Unknown grid: ZZ')
    expect(grid.valid_values).toEqual(['A', 'B', 'C', 'D', 'E', '1', '2', '3', '4'])
    const level = await run('set_section', { kind: 'level', name: 'Mezzanine' })
    expect(level.message).toContain('Unknown level: Mezzanine')
    expect(level.valid_values).toEqual(['Foundation', 'L1', 'L2', 'L3', 'L4', 'Roof'])
    // A storey name is not a gridline name, and the other way round.
    expect((await run('set_section', { kind: 'grid', name: 'L2' })).message).toContain('Unknown grid: L2')
    expect(useShell.getState().sections).toBe(before)
  })

  it('get_view_state names the section as one string, or null', async () => {
    expect((await run('get_view_state')).section).toBeNull()
    await run('set_section', { kind: 'level', name: 'L2' })
    expect((await run('get_view_state')).section).toBe('level L2')
    await run('set_section', { kind: 'grid', name: 'C' })
    expect((await run('get_view_state')).section).toBe('grid C + level L2')
    await run('set_section', { kind: 'level' })
    expect((await run('get_view_state')).section).toBe('grid C')
  })

  it('set_view moves the camera and the projection', async () => {
    // 2026-10-02: through the store's own actions — `setView`, and the persp / ortho button's
    // `toggleProj` — so the projection is the viewer's to report, as it is for a click. The
    // camera behind this viewer is the real rig (`rig-viewer.ts`).
    setViewer(rigViewer().viewer)
    try {
      const body = await run('set_view', { view: 'north', projection: 'ortho' })
      expect(body.message).toBe('View set to north (ortho).')
      expect(useShell.getState().view).toBe('north')
      expect(useShell.getState().proj).toBe('ortho')
    } finally {
      setViewer(null)
    }
  })

  it('toggle_display turns things on and off and says which', async () => {
    const body = await run('toggle_display', { grids: false, levels: true })
    expect(body.changed).toEqual(['grids off', 'levels on'])
    expect(useShell.getState().grids).toBe(false)
    expect(useShell.getState().levels).toBe(true)
    expect((await run('toggle_display', {})).message).toBe('Nothing to change.')
  })

  it('toggle_display asked for what is already so has not acted — no ↺ for nothing', async () => {
    const s = useShell.getState()
    await run('toggle_display', { grids: s.grids, levels: s.levels, shadows: s.shadows, dims: s.dims })
    expect(turn.acted).toBe(false)
    await run('toggle_display', { shadows: !s.shadows })
    expect(turn.acted).toBe(true)
  })

  it('color_by_property colours each species and chips the legend', async () => {
    const body = await run('color_by_property', {
      property: 'SpeciesCommonName',
      rules: [{ prop: 'PredefinedType', op: '=', val: 'VEGETATION' }]
    })
    expect(body.groups).toEqual([
      { value: 'Angsana', count: 8, color: '#35C4B6' },
      { value: 'Tembusu', count: 8, color: '#E8A33D' }
    ])
    expect(useShell.getState().colorBy!.prop).toBe('SpeciesCommonName')
    expect(turn.chips.map((c) => c.label)).toEqual(['Angsana (8)', 'Tembusu (8)'])

    await run('color_by_property', { property: null })
    expect(useShell.getState().colorBy).toBeNull()
  })

  it('color_by_property leaves a live scheme alone when nothing carries the property', async () => {
    await run('color_by_property', { property: 'IfcEntity' })
    const before = useShell.getState().colorBy
    const body = await run('color_by_property', { property: 'NoSuchKey' })
    expect(body.message).toContain('Nothing carries "NoSuchKey"')
    expect(useShell.getState().colorBy).toBe(before)
  })

  it('color_models takes hex per loaded model and refuses anything else', async () => {
    await run('color_models', { map: { ARC: '#E05A6B' } })
    expect(useShell.getState().modelColors).toEqual({ ARC: '#E05A6B' })
    expect(useShell.getState().nativeMats).toBe(false)

    const bad = await run('color_models', { map: { ARC: 'reddish' } })
    expect(bad.message).toContain('Unusable: ARC')

    await run('color_models', { map: {} })
    expect(useShell.getState().modelColors).toEqual({})
    expect(useShell.getState().nativeMats).toBe(true)
  })
})

/* ────────────────────────────── the turn around them ────────────────────────────── */

describe('per-turn bookkeeping', () => {
  it('seeds the first turn from the local audit, with no model call', () => {
    const msgs = useShell.getState().chatMsgs
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].text).toBe('4 models, 412 elements, 6 storeys. No data-completeness issues found.')
  })

  it('applies a pending patch through up(), so it is undoable', async () => {
    const before = useShell.getState().chatBegin('isolate the stairs')
    // Three of 412: the scope guard holds it, and the turn itself changes nothing.
    await run('apply_visibility', {
      action: 'isolate',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcStair' }]
    })
    expect(turn.pending!.label).toBe('isolate 3 elements — leaves 3 of 412 visible')
    useShell.getState().chatFinish('Needs confirmation.', { pending: turn.pending! }, before)
    const index = useShell.getState().chatMsgs.length - 1
    // A turn that only held a change has nothing of its own to revert.
    expect(useShell.getState().chatMsgs[index].undoSnap).toBeNull()

    useShell.getState().applyPending(index)
    expect(useShell.getState().chatMsgs[index].pending).toBeNull()
    expect(useShell.getState().stack).toHaveLength(1)
    expect(useShell.getState().canUndo).toBe(true)
    // `applyPending` takes its own snapshot at the moment it applies, and what the patch
    // changed is the visibility part — the design's five keys (2026-10-02: by name, in a
    // snapshot of the whole review state, where it was those five keys as a string).
    const undo = useShell.getState().chatMsgs[index].undoSnap!
    expect(undo.changed).toEqual(['vis'])
    expect(undo.before.payload.stack).toEqual([])
    // …and the reply's revert puts it back.
    useShell.getState().revertTurn(index)
    expect(useShell.getState().stack).toEqual([])
  })

  it('dismisses a pending patch without touching the view', () => {
    const shell = useShell.getState()
    const before = shell.chatBegin('isolate the stairs')
    shell.chatFinish('Needs confirmation.', {
      pending: { label: 'x', patch: { stack: [] } }
    }, before)
    const index = useShell.getState().chatMsgs.length - 1
    useShell.getState().dismissPending(index)
    expect(useShell.getState().chatMsgs[index].pending).toBeNull()
    expect(useShell.getState().stack).toHaveLength(0)
  })

  it('reverts one turn without unwinding what came after it', async () => {
    const before = useShell.getState().chatBegin('isolate L2')
    await run('set_filter_stack', {
      steps: [{ action: 'isolate', rules: [{ prop: 'Level', op: '=', val: 'L2' }] }]
    })
    useShell.getState().chatFinish('Done.', { acted: turn.acted }, before)
    const index = useShell.getState().chatMsgs.length - 1
    // The state from before the turn, and the one part of it the turn changed.
    expect(useShell.getState().chatMsgs[index].undoSnap).toEqual({ before, changed: ['vis'] })
    expect(useShell.getState().chatMsgs[index].undoSnap!.before).toBe(before)

    // Something the user did afterwards, by hand.
    useShell.getState().toggleStorey('L3')
    useShell.getState().revertTurn(index)
    expect(useShell.getState().stack).toHaveLength(0)
    expect(useShell.getState().chatMsgs[index].reverted).toBe(true)
  })

  it('caps chips at six, as the design caps them', async () => {
    for (let i = 0; i < 9; i++) {
      await run('query_elements', { rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }] })
    }
    expect(turn.chips.length).toBe(6)
  })
})

/* ══════════════════════════ 2026-09-20 — the Stage B corrections ══════════════════════════ */

describe('apply_visibility refuses a change that leaves nothing visible', () => {
  it('does not offer an Apply button for a stack that blanks the view', async () => {
    // Two isolates AND, so appending a second one for a disjoint entity leaves nothing —
    // which is exactly what "also show the plates" produces.
    await run('apply_visibility', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }],
      action: 'isolate'
    })
    const before = useShell.getState().stack.length
    const body = await run('apply_visibility', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }],
      action: 'isolate',
      combine: 'append'
    })
    expect(body.applied).toBe(false)
    expect(body.wouldLeaveVisible).toBe(0)
    expect(body.message).toContain('would leave nothing visible')
    // Neither applied nor pending: there is nothing to click.
    expect(turn.pending).toBeNull()
    expect(useShell.getState().stack).toHaveLength(before)
  })

  it('still lets a highlight through, because it hides nothing', async () => {
    const body = await run('apply_visibility', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }],
      action: 'highlight'
    })
    expect(body.applied).toBe(true)
  })

  it('leaves set_filter_stack behaving exactly as it did', async () => {
    const body = await run('set_filter_stack', {
      steps: [{ action: 'isolate', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcNope' }] }]
    })
    expect(body.applied).toBe(false)
    expect(body.wouldLeaveVisible).toBe(0)
    expect(turn.pending).toBeNull()
  })
})

describe('color_by_property caps what the model is told, not what the legend shows', () => {
  it('reports every group when there are few, and says so', async () => {
    const body = await run('color_by_property', { property: 'IfcEntity' })
    const groups = body.groups as unknown[]
    expect(groups.length).toBe((body.totalGroups as number))
    expect(body.truncated).toBe(false)
    expect(body).not.toHaveProperty('omittedGroups')
    // The legend keeps the whole scheme whatever the model was told.
    expect(useShell.getState().colorBy!.groups.length).toBe(body.totalGroups)
  })

  it('caps at COLOR_GROUP_CAP, largest first, and never says truncated:false when it cut', async () => {
    // `Name` is one group per element on the mock — far past the cap.
    const body = await run('color_by_property', { property: 'Name' })
    const groups = body.groups as { value: string; count: number }[]
    expect(groups.length).toBe(COLOR_GROUP_CAP)
    expect(body.truncated).toBe(true)
    expect(body.totalGroups as number).toBeGreaterThan(COLOR_GROUP_CAP)
    expect(body.omittedGroups).toBe((body.totalGroups as number) - COLOR_GROUP_CAP)
    // Largest first, and the omitted elements are counted rather than lost.
    const counts = groups.map((g) => g.count)
    expect([...counts].sort((a, b) => b - a)).toEqual(counts)
    const scheme = useShell.getState().colorBy!
    expect(scheme.groups.length).toBe(body.totalGroups)
    const shown = counts.reduce((a, b) => a + b, 0)
    expect(body.omittedElements).toBe(scheme.groups.reduce((a, g) => a + g.n, 0) - shown)
  })

  it('still puts at most six chips under the reply', async () => {
    await run('color_by_property', { property: 'Name' })
    expect(turn.chips.length).toBe(CHIP_CAP)
  })
})

describe('get_spatial_tree is bounded by default', () => {
  it('states how many nodes it returned and whether anything was left out', async () => {
    const body = await run('get_spatial_tree', {})
    expect(body.spaces).toBe(false)
    expect(body.maxDepth).toBe(SPATIAL_DEPTH)
    expect(typeof body.nodes).toBe('number')
    expect(body.truncated).toBe((body.omitted as number) > 0)
  })

  it('gives every node its own childCount, so nothing is silently missing', async () => {
    const body = await run('get_spatial_tree', { model: 'ARC' })
    const tree = (body.models as { tree: Record<string, unknown> }[])[0].tree
    const walk = (n: Record<string, unknown>): void => {
      expect(typeof n.childCount).toBe('number')
      for (const c of (n.children as Record<string, unknown>[]) ?? []) walk(c)
    }
    walk(tree)
  })

  it('stops at the depth it is given, and counts what it did not descend into', async () => {
    const shallow = await run('get_spatial_tree', { model: 'ARC', depth: 1 })
    const tree = (shallow.models as { tree: Record<string, unknown> }[])[0].tree
    expect(tree.children).toEqual([])
    expect(shallow.truncated).toBe(true)
    expect(shallow.nodes).toBe(1)
    // Everything below the root was counted, not dropped.
    expect(tree.childrenOmitted).toBe(tree.childCount)
    expect(shallow.omitted as number).toBeGreaterThan(0)

    const deep = await run('get_spatial_tree', { model: 'ARC' })
    expect(deep.nodes as number).toBeGreaterThan(shallow.nodes as number)
  })

  it('a depth below one is treated as one rather than as an empty answer', async () => {
    const body = await run('get_spatial_tree', { model: 'ARC', depth: 0 })
    expect(body.maxDepth).toBe(1)
    expect(body.nodes).toBe(1)
  })
})

describe('summarize_elements names the file’s own unit and its coverage', () => {
  it('labels areas with the file’s area unit, never a literal', async () => {
    const body = await run('summarize_elements', {
      groupBy: 'SpeciesCommonName',
      rules: [{ prop: 'PredefinedType', op: '=', val: 'VEGETATION' }]
    })
    // The mock's assignment is the real file's combination: millimetres and square metres.
    expect((body.units as Record<string, string>).area).toBe('m²')
    expect(body.message).toContain('m²')
  })

  it('says when a total covers only part of its group', async () => {
    const body = await run('summarize_elements', { groupBy: 'IfcEntity' })
    const groups = body.groups as { count: number; areaFrom: number; volumeFrom: number }[]
    const partial = groups.find((g) => g.areaFrom > 0 && g.areaFrom < g.count)
    if (partial) {
      expect(body.message).toContain('Totals cover only the elements that carry the quantity')
      expect(body.message).toMatch(/from \d+ of \d+/)
    }
    // Every group carries its own coverage, partial or not.
    for (const g of groups) {
      expect(g.areaFrom).toBeLessThanOrEqual(g.count)
      expect(g.volumeFrom).toBeLessThanOrEqual(g.count)
    }
  })

  it('names no unit for a metric nothing contributed to', async () => {
    const body = await run('summarize_elements', {
      groupBy: 'SpeciesCommonName',
      rules: [{ prop: 'PredefinedType', op: '=', val: 'VEGETATION' }]
    })
    const groups = body.groups as { volumeFrom: number }[]
    expect(groups.every((g) => g.volumeFrom === 0)).toBe(true)
    expect(body.units).not.toHaveProperty('volume')
  })
})

describe('list_values reports the pool, not only the values', () => {
  it('says how many carry the property and how many do not', async () => {
    const body = await run('list_values', {
      attr: 'SpeciesCommonName',
      rules: [{ prop: 'Model', op: '=', val: 'SIT' }]
    })
    const pool = body.pool as number
    const carrying = body.carrying as number
    expect(carrying).toBe(16)
    expect(pool).toBeGreaterThan(carrying)
    expect(body.missing).toBe(pool - carrying)
    expect(body.message).toContain(`${carrying} of ${pool}`)
    // The three numbers are consistent with the values' own counts.
    const values = body.values as { count: number }[]
    expect(values.reduce((a, v) => a + v.count, 0)).toBe(carrying)
  })

  it('reports the pool even when nothing carries the key at all', async () => {
    const body = await run('list_values', { attr: 'NoSuchKey' })
    expect(body.carrying).toBe(0)
    expect(body.missing).toBe(body.pool)
    expect(body.values).toEqual([])
    expect(body.message).toContain(`0 of ${body.pool}`)
  })
})

describe('valid_values pages rather than listing everything', () => {
  it('returns the first forty entity names with a total and a truncated flag', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcGlass' }]
    })
    const entities = (body.valid_values as { entities: { values: string[]; total: number; truncated: boolean } })
      .entities
    expect(entities.values.length).toBe(Math.min(VALID_VALUES_CAP, entities.total))
    expect(entities.truncated).toBe(entities.total > VALID_VALUES_CAP)
    // IfcEntity is a real key, so no key list — its own values instead.
    expect(body.valid_values).not.toHaveProperty('propKeys')
  })

  it('answers a name that is not a key with its eight nearest keys and the total (2026-09-28)', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'NoSuchKey', op: '=', val: 'x' }]
    })
    const keys = (body.valid_values as {
      propKeys: { nearest: Record<string, string[]>; total: number; truncated: boolean }
    }).propKeys
    expect(keys.total).toBe(useShell.getState().propKeys.length)
    expect(keys.nearest.NoSuchKey).toHaveLength(NEAREST_CAP)
    expect(keys.truncated).toBe(true)
    // The sentence agrees with the structure.
    expect(body.message).toContain(`nearest: ${keys.nearest.NoSuchKey.join(', ')}.`)
    expect(body.message).toContain(`${keys.total} names in all; find_properties searches them.`)
  })
})

/* ══════════════════════ 2026-09-20 — acting on a found set ══════════════════════ */

/**
 * `docs/AI_REVIEW.md` §9 gap 1: `query_sql`, `search` and `find_nearby` can find a set that no
 * rule can describe, and until now nothing could act on it. The three ways of naming a set go
 * through one resolver, and the acting goes through the **right-click menu's own store
 * actions**, which is what keeps undo, the temporary-state frame and the 5 % guard working.
 */
describe('ids and selection as targets', () => {
  const ids = (n: number, of: (e: { type: string }) => boolean = () => true): number[] =>
    useShell.getState().federation.elements.filter(of).slice(0, n).map((e) => e.id)

  it('selects exactly the ids given, in the order given', async () => {
    const want = ids(5)
    const body = await run('select_elements', { ids: want, zoom: false })
    expect(body.selected).toBe(5)
    expect(body.target).toBe('ids')
    expect(useShell.getState().selIds).toEqual(want)
    expect(turn.chips[0].ids).toEqual(want)
  })

  it('reports ids the federation does not carry by count, and never drops them silently', async () => {
    const want = ids(3)
    const body = await run('select_elements', { ids: [...want, 999_999, 999_998], zoom: false })
    expect(body.selected).toBe(3)
    expect(body.idsGiven).toBe(5)
    expect(body.idsUnknown).toBe(2)
    expect(body.message).toContain('2 of the 5 ids given are not in the loaded federation')
    expect(useShell.getState().selIds).toEqual(want)
  })

  it('counts a repeated id once in "N of M ids given"', async () => {
    const want = ids(2)
    const body = await run('select_elements', { ids: [...want, want[0], 999_999, 999_999], zoom: false })
    expect(body.idsGiven).toBe(3)
    expect(body.idsUnknown).toBe(1)
    expect(body.message).toContain('1 of the 3 ids given are not in the loaded federation')
  })

  it('says so plainly when none of the ids exist, rather than reporting a selection of zero', async () => {
    const body = await run('select_elements', { ids: [999_999], zoom: false })
    expect(body.selected).toBe(0)
    expect(body.message).toContain('per session')
    expect(useShell.getState().selIds).toEqual([])
  })

  it('refuses more than the cap before any executor runs', async () => {
    const many = Array.from({ length: MAX_TOOL_IDS + 1 }, (_, i) => i + 1)
    await expect(run('select_elements', { ids: many })).rejects.toThrow(
      new RegExp(`select_elements: ids — at most ${MAX_TOOL_IDS} ids`)
    )
    // …and the cap itself is accepted.
    expect(MAX_TOOL_IDS).toBe(2000)
  })

  it('acts on the live selection when selection:true', async () => {
    const want = useShell
      .getState()
      .federation.elements.filter((e) => e.type === 'IfcWall')
      .map((e) => e.id)
    useShell.getState().select(want, false)
    const body = await run('apply_visibility', { action: 'isolate', selection: true })
    expect(body.target).toBe('selection')
    expect(body.matched).toBe(want.length)
    expect(body.message).toContain('Isolated the selection')
  })

  it('says nothing is selected rather than acting on everything', async () => {
    const body = await run('apply_visibility', { action: 'isolate', selection: true })
    expect(body.applied).toBe(false)
    expect(body.message).toContain('Nothing is selected')
    expect(useShell.getState().hidden).toEqual({})
  })

  it('prefers an explicit id list over rules sent in the same call', async () => {
    const want = ids(2)
    const body = await run('select_elements', {
      ids: want,
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }],
      zoom: false
    })
    expect(body.selected).toBe(2)
    expect(useShell.getState().selIds).toEqual(want)
  })
})

describe('apply_visibility on an id set', () => {
  const wallIds = (): number[] =>
    useShell.getState().federation.elements.filter((e) => e.type === 'IfcWall').map((e) => e.id)

  it('isolates through the same store action the right-click menu calls, and is undoable', async () => {
    const want = wallIds()
    const body = await run('apply_visibility', { action: 'isolate', ids: want })
    expect(body.applied).toBe(true)
    expect(body.action).toBe('isolate')
    expect(body.visibleElements).toBe(want.length)
    const st = useShell.getState()
    expect(st.canUndo).toBe(true)
    expect(Object.keys(st.hidden)).toHaveLength(412 - want.length)
    expect(turn.acted).toBe(true)

    // ⌘Z — the same `step(true)` the keyboard calls.
    st.step(true)
    expect(Object.keys(useShell.getState().hidden)).toHaveLength(0)
  })

  it('hides an id set and leaves everything else where it was', async () => {
    const want = wallIds().slice(0, 6)
    const body = await run('apply_visibility', { action: 'hide', ids: want })
    expect(body.applied).toBe(true)
    expect(body.visibleElements).toBe(412 - 6)
    expect(Object.keys(useShell.getState().hidden).map(Number).sort((a, b) => a - b)).toEqual(
      [...want].sort((a, b) => a - b)
    )
  })

  it('shows an id set again, which is the one action rules cannot express', async () => {
    const want = wallIds().slice(0, 6)
    await run('apply_visibility', { action: 'hide', ids: want })
    const body = await run('apply_visibility', { action: 'show', ids: want.slice(0, 2) })
    expect(body.applied).toBe(true)
    expect(Object.keys(useShell.getState().hidden)).toHaveLength(4)
    expect(body.visibleElements).toBe(412 - 4)
  })

  it('refuses "show" without an id set rather than guessing', async () => {
    const body = await run('apply_visibility', {
      action: 'show',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    })
    expect(body.message).toContain('pass ids or selection:true')
    expect(body.message).toContain('action:"reset"')
  })

  it('sends a highlight back to the rules that can express it', async () => {
    const body = await run('apply_visibility', { action: 'highlight', ids: wallIds().slice(0, 3) })
    expect(body.message).toContain('set_filter_stack')
    expect(useShell.getState().stack).toHaveLength(0)
  })

  it('holds an id isolate back behind the 5 % guard, with the patch, not a label', async () => {
    const stairs = useShell
      .getState()
      .federation.elements.filter((e) => e.type === 'IfcStair')
      .map((e) => e.id)
    expect(stairs.length / 412).toBeLessThan(SCOPE_GUARD)
    const body = await run('apply_visibility', { action: 'isolate', ids: stairs })
    expect(body.pending).toBe(true)
    expect(body.wouldLeaveVisible).toBe(stairs.length)
    expect(useShell.getState().hidden).toEqual({})
    expect(Object.keys(turn.pending!.patch!).sort()).toEqual(['ctx', 'hidden', 'storeyVis'])
    expect(turn.pending!.label).toContain(`leaves ${stairs.length} of 412 visible`)
  })

  it('refuses outright an id set that would leave nothing visible', async () => {
    const body = await run('apply_visibility', { action: 'hide', ids: ALL_IDS() })
    expect(body.applied).toBe(false)
    expect(body.wouldLeaveVisible).toBe(0)
    expect(body.message).toContain('would leave nothing visible')
    expect(useShell.getState().hidden).toEqual({})
  })

  it('never holds "show" back — it can only reveal more', async () => {
    const all = ALL_IDS()
    await run('apply_visibility', { action: 'hide', ids: all.slice(0, 411) })
    const body = await run('apply_visibility', { action: 'show', ids: all.slice(0, 1) })
    expect(body.applied).toBe(true)
    expect(body.pending).toBeUndefined()
  })

  /**
   * The pending entry carries a patch and the applied path calls the store action, so the two
   * have to leave the same state. This is that proof — without it they are free to drift, and
   * the drift would only ever be visible behind the Apply button.
   */
  it('hands the guard a patch that leaves exactly what the store action would', async () => {
    const stairs = useShell
      .getState()
      .federation.elements.filter((e) => e.type === 'IfcStair')
      .map((e) => e.id)
    await run('apply_visibility', { action: 'isolate', ids: stairs })
    const patch = turn.pending!.patch!
    useShell.getState().up(patch)
    const viaPatch = JSON.stringify(useShell.getState().hidden)

    resetShell()
    useShell.getState().commitModels(full)
    useShell.getState().isolate(stairs)
    expect(JSON.stringify(useShell.getState().hidden)).toBe(viaPatch)

    for (const mode of ['hide', 'show'] as const) {
      resetShell()
      useShell.getState().commitModels(full)
      useShell.getState().hide(stairs.slice(0, 1))
      const byPatch = JSON.stringify(visPatch(useShell.getState(), mode, stairs).hidden)
      if (mode === 'hide') useShell.getState().hide(stairs)
      else useShell.getState().show(stairs)
      expect([mode, JSON.stringify(useShell.getState().hidden)]).toEqual([mode, byPatch])
    }
  })
})

describe('color_by_property on an id set', () => {
  it('colours only the elements given', async () => {
    const trees = useShell
      .getState()
      .federation.elements.filter((e) => e.predefinedType === 'VEGETATION')
      .map((e) => e.id)
    const body = await run('color_by_property', {
      property: 'SpeciesCommonName',
      ids: trees.slice(0, 8)
    })
    const groups = body.groups as { count: number }[]
    expect(groups.reduce((a, g) => a + g.count, 0)).toBe(8)
    const scheme = useShell.getState().colorBy!
    expect(scheme.groups.reduce((a, g) => a + g.ids.length, 0)).toBe(8)
  })

  it('leaves the live scheme alone when nothing in the set carries the property', async () => {
    await run('color_by_property', { property: 'IfcEntity' })
    const before = useShell.getState().colorBy!.prop
    const body = await run('color_by_property', {
      property: 'SpeciesCommonName',
      ids: useShell
        .getState()
        .federation.elements.filter((e) => e.type === 'IfcWall')
        .slice(0, 5)
        .map((e) => e.id)
    })
    expect(body.message).toContain('in that set')
    expect(useShell.getState().colorBy!.prop).toBe(before)
  })
})

/* ══════════════════════ 2026-09-20 — filter sets by name ══════════════════════ */

describe('manage_filters — named filter sets', () => {
  const buildStack = async (): Promise<void> => {
    await run('set_filter_stack', {
      steps: [
        { action: 'isolate', rules: [{ prop: 'Level', op: '=', val: 'L3' }] },
        { action: 'hide', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }] }
      ]
    })
  }

  it('saves the live stack under a name, through the card’s own action', async () => {
    await buildStack()
    const body = await run('manage_filters', { op: 'save_set', name: 'L3 minus windows' })
    expect(body.saved).toBe(true)
    expect(body.steps).toBe(2)
    expect(useShell.getState().filterSets.map((f) => f.label)).toEqual(['L3 minus windows'])
  })

  it('recalls one by name and rebuilds the same view', async () => {
    await buildStack()
    const visible = useShell.getState().federation.elements.filter(visFn(useShell.getState())).length
    await run('manage_filters', { op: 'save_set', name: 'L3 minus windows' })
    await run('manage_filters', { op: 'clear' })
    expect(useShell.getState().stack).toHaveLength(0)

    const body = await run('manage_filters', { op: 'apply_set', name: 'L3 minus windows' })
    expect(body.applied).toBe(true)
    expect(body.steps).toBe(2)
    expect(body.visibleElements).toBe(visible)
    expect(useShell.getState().canUndo).toBe(true)
  })

  it('matches a name case-insensitively when the exact one misses', async () => {
    await buildStack()
    await run('manage_filters', { op: 'save_set', name: 'L3 minus windows' })
    const body = await run('manage_filters', { op: 'apply_set', name: 'l3 MINUS windows' })
    expect(body.applied).toBe(true)
  })

  it('lists the sets, and asks before one is forgotten', async () => {
    await buildStack()
    await run('manage_filters', { op: 'save_set', name: 'one' })
    await run('manage_filters', { op: 'save_set', name: 'two' })
    expect((await run('manage_filters', { op: 'list_sets' })).sets).toEqual([
      { name: 'one', steps: 2 },
      { name: 'two', steps: 2 }
    ])
    // 2026-10-02, phase 3: `delete_set` forgot the set at once. A forgotten set cannot be
    // brought back, so it only asks now — the set is still there until the user's Apply.
    const sets = useShell.getState().filterSets
    const asked = await run('manage_filters', { op: 'delete_set', name: 'one' })
    expect(asked).toMatchObject({ applied: false, pending: true, name: 'one' })
    expect(useShell.getState().filterSets).toBe(sets)
    expect(turn.pending).toEqual({
      label: 'forget the filter set "one" (2 steps) — it cannot be brought back',
      action: { kind: 'delete_filter_set', id: sets[0].id }
    })
    // The user's click is the Filter card's own ×.
    const before = useShell.getState().chatBegin('forget it', null)
    useShell.getState().chatFinish('…', { pending: turn.pending! }, before)
    useShell.getState().applyPending(useShell.getState().chatMsgs.length - 1)
    expect(useShell.getState().filterSets.map((f) => f.label)).toEqual(['two'])
  })

  /**
   * 2026-10-02, phase 3. The card's two rules — a repeated name replaces, twelve are kept —
   * each **forget** a set, and a forgotten set cannot be brought back. Until then the tool
   * applied them at once (`replaced: true`, the oldest dropped); it now only asks, and the rules
   * are applied by the user's click. `ai-parity-3.test.ts` holds the click.
   */
  it('saves at once only while nothing is forgotten: a repeated name, or a thirteenth set, waits', async () => {
    await buildStack()
    await run('manage_filters', { op: 'save_set', name: 'mine' })
    const mine = useShell.getState().filterSets
    const again = await run('manage_filters', { op: 'save_set', name: 'mine' })
    expect(again).toMatchObject({ applied: false, pending: true, saved: false, wouldForget: ['mine'] })
    // Not replaced: the very same list, and the very same set in it.
    expect(useShell.getState().filterSets).toBe(mine)
    expect(turn.pending).toEqual({
      label: 'save the live filter as "mine" — it replaces the saved set of that name (2 steps), which cannot be brought back',
      action: { kind: 'save_filter_set', name: 'mine', forgets: [mine[0].id] }
    })

    // Eleven more fill the list — each only adds, so each is saved at once…
    for (let i = 1; i < FILTER_SETS_CAP; i++) {
      Object.assign(turn, newTurnState())
      expect((await run('manage_filters', { op: 'save_set', name: `s${i}` })).saved).toBe(true)
    }
    const full = useShell.getState().filterSets
    expect(full.map((f) => f.label)).toEqual(['mine', ...Array.from({ length: 11 }, (_, i) => `s${i + 1}`)])
    // …and the thirteenth would push the oldest out, so it waits.
    Object.assign(turn, newTurnState())
    const extra = await run('manage_filters', { op: 'save_set', name: 'one too many' })
    expect(extra).toMatchObject({ applied: false, pending: true, saved: false, wouldForget: ['mine'] })
    expect(useShell.getState().filterSets).toBe(full)
    expect(turn.pending!.label).toBe(
      'save the live filter as "one too many" — only 12 are kept, so "mine" (2 steps) would be forgotten, and cannot be brought back'
    )
    expect(turn.pending!.action).toEqual({ kind: 'save_filter_set', name: 'one too many', forgets: [mine[0].id] })
  })

  it('names the sets it has when the one asked for is not among them', async () => {
    await buildStack()
    await run('manage_filters', { op: 'save_set', name: 'one' })
    const body = await run('manage_filters', { op: 'apply_set', name: 'nope' })
    expect(body.message).toContain('No filter set called "nope"')
    expect((body.valid_values as { values: string[] }).values).toEqual(['one'])
    expect(useShell.getState().stack).toHaveLength(2)
  })

  it('refuses to save a stack that carries no condition', async () => {
    const body = await run('manage_filters', { op: 'save_set', name: 'empty' })
    expect(body.saved).toBe(false)
    expect(body.message).toContain('nothing to save')
    expect(useShell.getState().filterSets).toHaveLength(0)
  })

  it('asks for the name rather than guessing one', async () => {
    const body = await run('manage_filters', { op: 'save_set' })
    expect(body.message).toContain("Pass the set's name")
  })

  it('leaves the eight stack operations exactly as they were', async () => {
    await buildStack()
    expect((await run('manage_filters', { op: 'list' })).steps).toHaveLength(2)
    await run('manage_filters', { op: 'disable', step: 1 })
    expect(useShell.getState().stack[0].on).toBe(false)
    await run('manage_filters', { op: 'remove', step: 1 })
    expect(useShell.getState().stack).toHaveLength(1)
  })
})

/* ══════════════════════ 2026-09-20 — one call, one colour each ══════════════════════ */

describe('set_filter_stack gives each highlight step its own colour', () => {
  it('builds every step against the stack being assembled, not a snapshot of the old one', async () => {
    await run('set_filter_stack', {
      steps: [
        { action: 'highlight', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }] },
        { action: 'highlight', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }] },
        { action: 'highlight', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }] }
      ]
    })
    const colors = useShell.getState().stack.map((x) => x.color)
    expect(new Set(colors).size).toBe(3)
    expect(colors).toEqual([HL[0], HL[1], HL[2]])
  })

  it('still seeds from the live stack, so an appended step avoids the colours already taken', async () => {
    await run('set_filter_stack', {
      steps: [{ action: 'highlight', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }] }]
    })
    await run('set_filter_stack', {
      steps: [
        { action: 'highlight', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWindow' }] },
        { action: 'highlight', rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }] }
      ],
      combine: 'append'
    })
    expect(useShell.getState().stack.map((x) => x.color)).toEqual([HL[0], HL[1], HL[2]])
  })
})

/* ══════════════════════ 2026-09-20 — find_nearby ══════════════════════ */

describe('find_nearby', () => {
  const stair = (): number =>
    useShell.getState().federation.elements.find((e) => e.type === 'IfcStair' && e.bbox)!.id

  it('reports neighbours nearest first, with the fields a reviewer needs', async () => {
    const body = await run('find_nearby', { id: stair(), distance: 2 })
    const ns = body.neighbours as { id: number; entity: string; storey: string; gapMetres: number }[]
    expect(ns.length).toBeGreaterThan(0)
    expect(Object.keys(ns[0]).sort()).toEqual([
      'entity',
      'gapMetres',
      'id',
      'model',
      'name',
      'of',
      'storey'
    ])
    for (let i = 1; i < ns.length; i++) {
      expect(ns[i - 1].gapMetres).toBeLessThanOrEqual(ns[i].gapMetres)
    }
    expect(ns.every((n) => n.gapMetres <= 2)).toBe(true)
    expect(ns.some((n) => n.id === stair())).toBe(false)
  })

  it('states its method and its frame, exactly as measure_between does', async () => {
    const body = await run('find_nearby', { id: stair(), distance: 1 })
    expect(body.frame).toBe('project')
    expect(body.method).toContain('not solid geometry')
    expect(body.message).toContain('not solid geometry')
    expect(body.message).toContain('IfcSpace excluded')
  })

  it('leaves IfcSpace out unless asked', async () => {
    const withOut = await run('find_nearby', { id: stair(), distance: 5 })
    const withIn = await run('find_nearby', { id: stair(), distance: 5, spaces: true, limit: 100 })
    expect(withOut.spacesIncluded).toBe(false)
    expect(withIn.spacesIncluded).toBe(true)
    expect(
      (withOut.neighbours as { entity: string }[]).some((n) => n.entity === 'IfcSpace')
    ).toBe(false)
  })

  it('caps honestly rather than returning everything', async () => {
    const body = await run('find_nearby', { id: stair(), distance: 1000, limit: 3 })
    expect(body.truncated).toBe(true)
    expect(body.neighbours).toHaveLength(3)
    expect(body.count).toBeGreaterThan(3)
    expect(body.message).toContain('The 3 nearest are listed')
  })

  it('takes a short id list and keeps each neighbour once', async () => {
    const seeds = useShell
      .getState()
      .federation.elements.filter((e) => e.bbox)
      .slice(0, 3)
      .map((e) => e.id)
    const body = await run('find_nearby', { ids: seeds, distance: 3, limit: 100 })
    const ids = (body.neighbours as { id: number }[]).map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(seeds.some((s) => ids.includes(s))).toBe(false)
    expect(body.around).toEqual(seeds)
  })

  it('only looks at what is visible', async () => {
    const seed = stair()
    const all = (await run('find_nearby', { id: seed, distance: 100, limit: 100 })).count as number
    await run('set_storeys', { visible: ['L2'] })
    const fewer = (await run('find_nearby', { id: seed, distance: 100, limit: 100 })).count as number
    expect(fewer).toBeLessThan(all)
  })

  it('says what is wrong rather than answering nothing', async () => {
    expect((await run('find_nearby', {})).message).toContain('Pass id, or ids')
    expect((await run('find_nearby', { id: 999_999 })).message).toContain('per session')
  })

  it('is a read tool: it changes nothing', async () => {
    const before = JSON.stringify(useShell.getState().hidden)
    await run('find_nearby', { id: stair(), distance: 5 })
    expect(JSON.stringify(useShell.getState().hidden)).toBe(before)
    expect(turn.acted).toBe(false)
  })
})

describe('the id branch does not swallow a rule list', () => {
  it('treats an empty ids array as "no set named", not as "act on nothing"', async () => {
    const body = await run('apply_visibility', {
      action: 'isolate',
      ids: [],
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    })
    // The rule path: a filter step, not a hidden-map write.
    expect(body.applied).toBe(true)
    expect(body.step).toBe(1)
    expect(useShell.getState().stack).toHaveLength(1)
    expect(useShell.getState().hidden).toEqual({})
  })

  it('says "hidden", not "hided", when an id set names nothing', async () => {
    const body = await run('apply_visibility', { action: 'hide', ids: [999_999] })
    expect(body.message).toContain('nothing was hidden')
    expect(body.message).not.toContain('hided')
    expect((await run('apply_visibility', { action: 'isolate', ids: [999_999] })).message).toContain(
      'nothing was isolated'
    )
    expect((await run('apply_visibility', { action: 'show', ids: [999_999] })).message).toContain(
      'nothing was shown'
    )
  })
})

describe('a call that names no set at all', () => {
  it('asks for one rather than reporting a match of zero', async () => {
    const body = await run('select_elements', {})
    expect(body.selected).toBe(0)
    expect(body.message).toContain('No set was named')
    expect(body.message).toContain('rules, or ids, or selection:true')
    expect(useShell.getState().selIds).toEqual([])
  })
})

/* ══════════════ 2026-09-28 — property names as the file spells them ══════════════ */

/**
 * The owner: "Sometimes when i ask it check area with includesGFA, it never check the shared
 * parameters Includes As GFA." The mock gains that shared parameter — a yes/no on every slab,
 * yes on the three floor slabs — plus a numeric neighbour with a measure type, and a door key
 * that normalises like the walls' `FireRating`, so every resolver case has something to hit.
 */
const withGfa = (doors: boolean): ReturnType<typeof federate> =>
  federate(
    KEYS.map((k) =>
      mockModelIndex(k, {
        element: (e) => {
          if (e.type === 'IfcSlab') {
            return {
              ...e,
              psets: {
                ...e.psets,
                SGPset_Area: { 'Includes As GFA': e.predefinedType === 'FLOOR', 'GFA Area': 100 }
              },
              psetMeta: {
                ...e.psetMeta,
                SGPset_Area: {
                  sourceExpressId: 0,
                  inherited: false,
                  kind: 'SGPset',
                  measures: { 'GFA Area': 'IFCAREAMEASURE' }
                }
              }
            }
          }
          if (doors && e.type === 'IfcDoor') {
            return { ...e, psets: { ...e.psets, Other: { Fire_Rating: '1HR' } } }
          }
          return e
        }
      })
    )
  )

describe('property names and yes/no values are read the file’s way', () => {
  const gfa = withGfa(true)
  const TOTAL = gfa.elements.length

  beforeEach(() => {
    resetShell()
    useShell.getState().commitModels(gfa)
    Object.assign(turn, newTurnState())
  })

  const nearest = (body: Body): Record<string, string[]> =>
    (body.valid_values as { propKeys: { nearest: Record<string, string[]> } }).propKeys.nearest

  it('rewrites a name that differs only by case or spacing, and says what it read', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'includes as gfa', op: '=', val: 'true' }]
    })
    expect(body.matched).toBe(3)
    expect(body.resolvedKeys).toEqual({ 'includes as gfa': 'Includes As GFA' })
    expect(body.groups).toEqual([{ label: 'Includes As GFA=true', n: 3 }])
    expect(body.message).toContain('includes as gfa → Includes As GFA')
  })

  it('maps a yes/no value to the spelling the key stores, on = and !=', async () => {
    const yes = await run('query_elements', {
      rules: [{ prop: 'IncludesAsGFA', op: '=', val: 'Yes' }]
    })
    expect(yes.matched).toBe(3)
    expect(yes.resolvedKeys).toEqual({ IncludesAsGFA: 'Includes As GFA' })
    expect(yes.resolvedValues).toEqual({ 'Includes As GFA': { Yes: 'true' } })

    // != over a key most elements lack matches those too — that is matchFn's, unchanged.
    const notNo = await run('query_elements', {
      rules: [{ prop: 'Includes As GFA', op: '!=', val: 'no' }]
    })
    expect(notNo.resolvedValues).toEqual({ 'Includes As GFA': { no: 'false' } })
    expect(notNo.matched).toBe(TOTAL - 2)
  })

  it('leaves a value alone that already matches, or whose key is not a yes/no', async () => {
    const upper = await run('query_elements', {
      rules: [{ prop: 'Includes As GFA', op: '=', val: 'TRUE' }]
    })
    expect(upper.matched).toBe(3)
    expect(upper).not.toHaveProperty('resolvedValues')
    expect(upper).not.toHaveProperty('resolvedKeys')

    const text = await run('query_elements', { rules: [{ prop: 'FireRating', op: '=', val: 'yes' }] })
    expect(text).not.toHaveProperty('resolvedValues')
  })

  it('never picks a merely similar key — includesGFA is offered Includes As GFA, first', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'includesGFA', op: '=', val: 'Yes' }]
    })
    expect(body.matched).toBe(0)
    expect(body).not.toHaveProperty('resolvedKeys')
    expect(nearest(body).includesGFA[0]).toBe('Includes As GFA')
    expect(body.message).toContain(
      '"includesGFA" is not a property name in this federation — nearest: Includes As GFA'
    )
  })

  it('does not choose between two keys that normalise alike, and offers both first', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'fire rating', op: '=', val: '1HR' }]
    })
    expect(body).not.toHaveProperty('resolvedKeys')
    expect(nearest(body)['fire rating'].slice(0, 2)).toEqual(['FireRating', 'Fire_Rating'])
    // 2026-09-28 review follow-up: it says the name is two names, not that it is none.
    expect(body.message).toContain('"fire rating" matches two names, FireRating and Fire_Rating — say which.')
    expect(body.message).not.toContain('"fire rating" is not a property name')
    expect((body.valid_values as { propKeys: { ambiguous: unknown } }).propKeys.ambiguous).toEqual({
      'fire rating': ['FireRating', 'Fire_Rating']
    })
  })

  it('reports an unknown name even when the rule matched — absent and != match everything', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'includesGFA', op: 'absent', val: '' }]
    })
    expect(body.matched).toBe(TOTAL)
    expect(nearest(body).includesGFA[0]).toBe('Includes As GFA')
    expect(body.message).toContain('is not a property name')
  })

  it('reads Pset.Key and Pset:Key as the key', async () => {
    const dot = await run('query_elements', {
      rules: [{ prop: 'Pset_WallCommon.FireRating', op: 'absent', val: '' }]
    })
    expect(dot.resolvedKeys).toEqual({ 'Pset_WallCommon.FireRating': 'FireRating' })
    const colon = await run('query_elements', {
      rules: [{ prop: 'SGPset_Area:Includes As GFA', op: '=', val: 'y' }]
    })
    expect(colon.matched).toBe(3)
  })

  it('writes the file’s own key and value into the stack the Filter card shows', async () => {
    const body = await run('set_filter_stack', {
      steps: [{ action: 'highlight', rules: [{ prop: 'Includes_As_GFA', op: '=', val: 'y' }] }]
    })
    expect(body.applied).toBe(true)
    expect(body.resolvedKeys).toEqual({ Includes_As_GFA: 'Includes As GFA' })
    expect(useShell.getState().stack[0].rules[0]).toMatchObject({
      prop: 'Includes As GFA',
      op: '=',
      val: 'true'
    })

    await run('apply_visibility', {
      action: 'hide',
      combine: 'replace',
      rules: [{ prop: 'includes as gfa', op: '=', val: 'no' }]
    })
    expect(useShell.getState().stack.at(-1)!.rules[0]).toMatchObject({
      prop: 'Includes As GFA',
      val: 'false'
    })
  })

  it('resolves groupBy, attr, property and a view tool’s rules the same way', async () => {
    const sum = await run('summarize_elements', { groupBy: 'species common name' })
    expect(sum.groupBy).toBe('SpeciesCommonName')
    expect(sum.resolvedKeys).toEqual({ 'species common name': 'SpeciesCommonName' })

    const list = await run('list_values', { attr: 'speciescommonname' })
    expect(list.values).toEqual([
      { value: 'Angsana', count: 8 },
      { value: 'Tembusu', count: 8 }
    ])

    const colour = await run('color_by_property', { property: 'Species_Common_Name' })
    expect(colour.property).toBe('SpeciesCommonName')
    expect(useShell.getState().colorBy!.prop).toBe('SpeciesCommonName')

    const select = await run('select_elements', {
      rules: [{ prop: 'ifcentity', op: '=', val: 'IfcSlab' }],
      zoom: false
    })
    expect(select.selected).toBe(5)
  })

  it('answers a value that matched nothing with the key’s own commonest values', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'Includes As GFA', op: '=', val: 'maybe' }]
    })
    const top = (body.valid_values as { topValues: unknown[] }).topValues
    expect(top).toEqual([
      {
        prop: 'Includes As GFA',
        rule: 'Includes As GFA = maybe',
        values: [
          { value: 'true', count: 3 },
          { value: 'false', count: 2 }
        ],
        distinct: 2,
        truncated: false
      }
    ])
    expect(body.message).toContain('Includes As GFA carries true (3), false (2).')

    const vis = await run('apply_visibility', {
      rules: [{ prop: 'Includes As GFA', op: '=', val: 'maybe' }]
    })
    expect((vis.valid_values as { topValues: { prop: string }[] }).topValues[0].prop).toBe(
      'Includes As GFA'
    )
  })

  it('caps the values it lists and says so', async () => {
    const body = await run('query_elements', {
      rules: [{ prop: 'Name', op: '=', val: 'no such name' }]
    })
    const [top] = (body.valid_values as {
      topValues: { values: unknown[]; distinct: number; truncated: boolean }[]
    }).topValues
    expect(top.values).toHaveLength(TOP_VALUES_CAP)
    expect(top.distinct).toBeGreaterThan(TOP_VALUES_CAP)
    expect(top.truncated).toBe(true)
  })
})

describe('find_properties', () => {
  const gfa = withGfa(false)

  beforeEach(() => {
    resetShell()
    useShell.getState().commitModels(gfa)
    Object.assign(turn, newTurnState())
  })

  type Hit = Record<string, unknown> & { key: string; truncated: boolean }
  const hits = (body: Body): Hit[] => body.hits as Hit[]

  it('finds the shared parameter from the words the user used', async () => {
    const body = await run('find_properties', { text: 'includes GFA' })
    expect(hits(body)[0]).toEqual({
      key: 'Includes As GFA',
      match: 'contains',
      elements: 5,
      sets: ['SGPset_Area'],
      setCount: 1,
      kind: 'boolean',
      values: [
        { value: 'true', count: 3 },
        { value: 'false', count: 2 }
      ],
      distinct: 2,
      truncated: false
    })
    expect(body.message).toContain('Includes As GFA (5 elements, SGPset_Area)')
    expect(body.pool).toBe(gfa.elements.length)
  })

  it('reports the measure type and the kind of a numeric property', async () => {
    const body = await run('find_properties', { text: 'gfa area' })
    expect(hits(body)[0]).toMatchObject({
      key: 'GFA Area',
      match: 'normalised',
      kind: 'number',
      measureTypes: ['IFCAREAMEASURE']
    })
  })

  it('searches the seven attributes too', async () => {
    const body = await run('find_properties', { text: 'level' })
    expect(hits(body)[0]).toMatchObject({
      key: 'Level',
      attribute: true,
      match: 'normalised',
      sets: []
    })
  })

  it('scopes to what the rules match, and names what is outside that scope', async () => {
    const body = await run('find_properties', {
      text: 'includes gfa',
      rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
    })
    expect(hits(body).map((h) => h.key)).not.toContain('Includes As GFA')
    // Ranked as a miss is: the name holding every word asked first, then one sharing a word.
    expect(body.outsideScope).toEqual(['Includes As GFA', 'GFA Area'])
    expect(body.message).toContain('Outside that scope: Includes As GFA, GFA Area.')
  })

  it('resolves the names in its own rules like every other tool', async () => {
    const body = await run('find_properties', {
      text: 'gfa',
      rules: [{ prop: 'ifc entity', op: '=', val: 'IfcSlab' }]
    })
    expect(body.resolvedKeys).toEqual({ 'ifc entity': 'IfcEntity' })
    expect(body.pool).toBe(5)
    expect(hits(body).map((h) => h.key).slice(0, 2).sort()).toEqual(['GFA Area', 'Includes As GFA'])
  })

  it('is capped at limit and at fifty, and says when it cut', async () => {
    const two = await run('find_properties', { text: 'area', limit: 2 })
    expect(hits(two)).toHaveLength(2)
    expect(two.total as number).toBeGreaterThan(2)
    expect(two.truncated).toBe(true)

    const all = await run('find_properties', { text: 'e', limit: 500 })
    expect(hits(all).length).toBeLessThanOrEqual(FIND_PROPERTIES_CAP)
    expect(all.truncated).toBe(
      (all.total as number) > hits(all).length || hits(all).some((h) => h.truncated)
    )

    // One name whose values are cut is enough to make the whole answer say so.
    const cut = await run('find_properties', { text: 'name' })
    const name = hits(cut).find((h) => h.key === 'Name')!
    expect(name.truncated).toBe(true)
    expect(cut.truncated).toBe(true)
  })

  it('asks for text rather than searching for nothing', async () => {
    expect((await run('find_properties', { text: '  ' })).message).toContain('Pass some text')
  })
})
