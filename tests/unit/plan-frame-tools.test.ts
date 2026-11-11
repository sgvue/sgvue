/**
 * The assistant's box tools read a turned building square with the building — "option A",
 * owner-approved 2026-11-11 — and change nothing at all while the plan is not turned.
 *
 * Since 2026-11-07 every model is drawn at its file's own world coordinates and only the camera's
 * plan frame turns (ρ). `clash_check`, `find_nearby`, `measure_between` and `get_element` still
 * work on `IfcElement.bbox`, the world-axis box: on a building turned 43° a 6.0 × 0.1 m wall's
 * box is 4.4 × 4.2 m, so walls a metre apart "overlap" and a duct beside a slab "clashes". The
 * fix keeps `bbox` and adds a plan-frame box beside it (`model/plan-boxes.ts`, `planFrameOf(
 * state.planRotationDeg, state.offset, getViewer())`), which the four tools use while ρ ≠ 0.
 *
 * Here, on the design's own mock federation (`dev/mock-adapter.ts`):
 *
 *   1. **Rotation 0 is byte for byte today's.** The full `forModel` result of each tool, captured
 *      from the code before the change, is a committed golden file
 *      (`golden/plan-frame-rot0.tools.json`); it is compared with no viewer and with a viewer whose
 *      plan boxes are wrong, which must not be read at ρ = 0.
 *   2. **The demo building, turned.** Each part of the mock is turned −43.4103° about the world
 *      origin; an element's world `bbox` is the union of each part's AABB of its turned local AABB
 *      — how `element-boxes.ts` makes it from `PartRecord.bbox6` — and its plan box is the
 *      unturned building's own box, handed to the tools through a stub viewer's
 *      `elementPlanBox` in scene-plan coordinates. With world boxes the clash counts are 30, 15,
 *      140 and 251 (shown below); square with the building they are the unturned building's: 0,
 *      0, 0 and 80.
 *   3. **The four descriptions** say so, and keep the phrases other checks pin.
 *
 * `NOT YET IN src/`: the plan-frame results (`frame: 'plan'`, `planRotationDeg`, the `planBox…`
 * keys) and the descriptions' new wording. Those cases fail today on the world counts or a
 * missing key; the golden and the fixture checks pass today, and must still pass after.
 */
import { existsSync } from 'node:fs'
import { Box3, Vector3 } from 'three/webgpu'
import { beforeEach, describe, expect, it } from 'vitest'
import { federate, type FederatedElement, type Federation } from '../../src/shared/federate'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { clashPairs, clashPairsBrute } from '../../src/renderer/ai/analysis'
import { visFn } from '../../src/shared/rules'
import { TOOLS } from '../../src/shared/tool-schemas'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { SITE_TURN_DEG } from './synthetic-boxes'
import { resetShell, stubViewer } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
type B6 = [number, number, number, number, number, number]
interface Body {
  message?: string
  [key: string]: unknown
}

const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: async () => ({ columns: [], rows: [], truncated: false, ms: 0 }),
  rawLine: async () => null,
  turn
})
const run = async (name: string, input: unknown): Promise<Body> => (await executeTool(name, input, ctx())) as Body

const square = (): Federation => federate(KEYS.map((k) => mockModelIndex(k)))
const byName = (f: Federation, name: string): FederatedElement => {
  const e = f.elements.find((x) => x.name === name)
  if (!e) throw new Error(`no element named ${name}`)
  return e
}

beforeEach(() => {
  resetShell()
  setViewer(null)
  Object.assign(turn, newTurnState())
})

/* ────────────────────────────── 1. rotation 0, golden ────────────────────────────── */

/** Every call the golden file holds, by element name so the file reads on its own. */
const GOLDEN_CALLS: { tool: string; input: Record<string, unknown> }[] = [
  { tool: 'clash_check', input: { modelA: 'ARC', modelB: 'STR' } },
  { tool: 'clash_check', input: { modelA: 'ARC', modelB: 'STR', tolerance: 0.01 } },
  { tool: 'clash_check', input: { modelA: 'ARC', modelB: 'MEP' } },
  { tool: 'clash_check', input: { modelA: 'STR', modelB: 'MEP', tolerance: 0.01 } },
  { tool: 'find_nearby', input: { id: 'Ext Wall S A-B L1', distance: 1 } },
  { tool: 'find_nearby', input: { id: 'Ext Wall S A-B L1', distance: 2 } },
  { tool: 'measure_between', input: { a: 'Ext Wall S A-B L1', b: 'Column A-1 L1' } },
  { tool: 'measure_between', input: { a: 'Duct Main L1', b: 'Floor Slab L2' } },
  { tool: 'measure_between', input: { a: 'Entrance Door L1', b: 'Turf Area S' } },
  { tool: 'get_element', input: { id: 'Ext Wall S A-B L1' } },
  { tool: 'get_element', input: { id: 'Entrance Door L1' } },
  { tool: 'get_element', input: { id: 'Column A-1 L1' } },
  { tool: 'get_element', input: { id: 'Turf Area S' } },
  { tool: 'get_element', input: { id: 'Duct Main L1' } }
]

/** The calls with names resolved to this session's ids, and each `forModel` result. */
async function goldenRun(f: Federation): Promise<{ call: string; forModel: Body }[]> {
  const out: { call: string; forModel: Body }[] = []
  for (const { tool, input } of GOLDEN_CALLS) {
    const resolved = Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, ['id', 'a', 'b'].includes(k) ? byName(f, String(v)).id : v])
    )
    out.push({ call: `${tool} ${JSON.stringify(input)}`, forModel: await run(tool, resolved) })
  }
  return out
}

describe('rotation 0: every result is exactly what it was before the change (golden)', () => {
  const file = new URL('./golden/plan-frame-rot0.tools.json', import.meta.url)

  it('with no viewer', async () => {
    const f = square()
    useShell.getState().commitModels(f)
    expect(useShell.getState().planRotationDeg).toBe(0)
    expect(existsSync(file), 'golden file missing: create it empty, then run vitest with -u once, on the code before the change').toBe(true)
    await expect(JSON.stringify(await goldenRun(f), null, 1) + '\n').toMatchFileSnapshot('./golden/plan-frame-rot0.tools.json')
  })

  it('with a viewer whose plan boxes are wrong, which ρ = 0 must never read', async () => {
    const f = square()
    setViewer(stubViewer({ elementPlanBox: () => ({ box: new Box3(new Vector3(-1e3, -1e3, -1e3), new Vector3(1e3, 1e3, 1e3)), rho: 0 }) }))
    useShell.getState().commitModels(f)
    await expect(JSON.stringify(await goldenRun(f), null, 1) + '\n').toMatchFileSnapshot('./golden/plan-frame-rot0.tools.json')
  })

  it('no result at ρ = 0 carries a plan key', async () => {
    const f = square()
    useShell.getState().commitModels(f)
    for (const { call, forModel } of await goldenRun(f)) {
      expect(Object.keys(forModel).filter((k) => /^plan/.test(k)), call).toEqual([])
      expect(forModel.frame === undefined || forModel.frame === 'world', call).toBe(true)
    }
  })
})

/* ────────────────────────────── 2. the demo building, turned ────────────────────────────── */

const RHO_DEG = SITE_TURN_DEG
const RHO = (RHO_DEG * Math.PI) / 180
/** A world point turned by the building's turn ρ about the world origin. */
const turnBy = (x: number, y: number): [number, number] => [x * Math.cos(RHO) - y * Math.sin(RHO), x * Math.sin(RHO) + y * Math.cos(RHO)]

/** One part box turned: the AABB of its turned footprint corners, z unchanged — `PartRecord.bbox6`'s rule. */
function turnedPartBox(b: readonly number[]): B6 {
  const pts = [
    turnBy(b[0], b[1]),
    turnBy(b[3], b[1]),
    turnBy(b[0], b[4]),
    turnBy(b[3], b[4])
  ]
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    b[2],
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
    b[5]
  ]
}

/** The mock's four models with every element's `bbox` the union of its turned part boxes. */
function turnedIndexes(): ModelIndex[] {
  return KEYS.map((key) => {
    const index = mockModelIndex(key)
    const union = new Map<number, B6>()
    for (const chunk of mockGeometryChunks(key)) {
      for (const part of chunk.parts) {
        const t = turnedPartBox(part.bbox6)
        const u = union.get(part.elementId)
        if (!u) union.set(part.elementId, t)
        else for (let k = 0; k < 6; k++) u[k] = k < 3 ? Math.min(u[k], t[k]) : Math.max(u[k], t[k])
      }
    }
    return {
      ...index,
      elements: index.elements.map((e) => (e.bbox ? { ...e, bbox: union.get(e.id) ?? e.bbox } : e))
    }
  })
}

/**
 * The turned federation in the store, at ρ = −43.4103° and offset 0, with a stub viewer whose
 * `elementPlanBox` is the unturned building's box (scene-plan coordinates are plan coordinates
 * when the offset is 0) — the box square with the building.
 */
function standTurned(): { turned: Federation; unturned: Federation } {
  const unturned = square()
  const turned = federate(turnedIndexes())
  const planOf = new Map(unturned.elements.filter((e) => e.bbox).map((e) => [e.id, e.bbox!]))
  setViewer(
    stubViewer({
      elementPlanBox: (id: number) => {
        const b = planOf.get(id)
        return b ? { box: new Box3(new Vector3(b[0], b[1], b[2]), new Vector3(b[3], b[4], b[5])), rho: RHO } : null
      }
    })
  )
  useShell.getState().commitModels(turned)
  useShell.setState({ planRotationDeg: RHO_DEG, offset: [0, 0, 0] })
  return { turned, unturned }
}

/** The same call on the unturned building, at ρ = 0 — today's code, the building's own answer. */
async function unturnedRun(tool: string, input: Record<string, unknown>): Promise<Body> {
  resetShell()
  setViewer(null)
  useShell.getState().commitModels(square())
  const body = await run(tool, input)
  standTurned()
  return body
}

const ALWAYS = visFn({ hidden: {}, modelVis: {}, storeyVis: {}, stack: [] })
const pairKeys = (body: Body): string[] =>
  ((body.pairs as { a: { id: number }; b: { id: number } }[]) ?? []).map((p) => `${p.a.id}:${p.b.id}`).sort()

describe('the fixture: the demo building turned −43.4103° (passes today)', () => {
  it('the world boxes give 30, 15, 140 and 251 candidates; the unturned building 0, 0, 0 and 80', () => {
    const { turned, unturned } = standTurned()
    const count = (f: Federation, a: string, b: string, tol = 0): number => clashPairsBrute(f.elements, ALWAYS, a, b, tol).length
    expect([count(turned, 'ARC', 'MEP'), count(turned, 'STR', 'MEP'), count(turned, 'ARC', 'SIT'), count(turned, 'ARC', 'STR', 0.01)]).toEqual([
      30, 15, 140, 251
    ])
    expect([count(unturned, 'ARC', 'MEP'), count(unturned, 'STR', 'MEP'), count(unturned, 'ARC', 'SIT'), count(unturned, 'ARC', 'STR', 0.01)]).toEqual([
      0, 0, 0, 80
    ])
    // The hash agrees with the flat scan on the turned boxes, as it does on any.
    expect(clashPairs(turned.elements, ALWAYS, 'ARC', 'STR', 0.01).pairs.length).toBe(251)
  })

  it('a turned wall’s world box is wider than its plan box on both axes', () => {
    const { turned, unturned } = standTurned()
    const w = byName(turned, 'Ext Wall S A-B L1').bbox!
    const p = byName(unturned, 'Ext Wall S A-B L1').bbox!
    expect(Math.min(w[3] - w[0], w[4] - w[1])).toBeGreaterThan(Math.min(p[3] - p[0], p[4] - p[1]) + 1)
  })
})

describe('clash_check on the turned building is square with it (NOT YET IN src/)', () => {
  for (const [a, b] of [
    ['ARC', 'MEP'],
    ['STR', 'MEP'],
    ['ARC', 'SIT']
  ] as const) {
    it(`${a} × ${b}: no candidates`, async () => {
      standTurned()
      const body = await run('clash_check', { modelA: a, modelB: b })
      expect(body.candidates, body.message).toBe(0)
      expect(body.frame).toBe('plan')
      expect((body.planRotationDeg as number).toFixed(4)).toBe('-43.4103')
    })
  }

  it('ARC × STR at 0.01 m: exactly the pairs the unturned building gives, 80', async () => {
    standTurned()
    const want = await unturnedRun('clash_check', { modelA: 'ARC', modelB: 'STR', tolerance: 0.01 })
    expect(want.candidates).toBe(80)
    const body = await run('clash_check', { modelA: 'ARC', modelB: 'STR', tolerance: 0.01 })
    expect(body.candidates, body.message).toBe(80)
    expect(pairKeys(body)).toEqual(pairKeys(want))
    const vol = (x: Body): Record<string, number> =>
      Object.fromEntries((x.pairs as { a: { id: number }; b: { id: number }; overlapVolumeM3: number }[]).map((p) => [`${p.a.id}:${p.b.id}`, p.overlapVolumeM3]))
    const got = vol(body)
    for (const [k, v] of Object.entries(vol(want))) expect(Math.abs(got[k] - v), k).toBeLessThan(1e-9)
    expect(body.frame).toBe('plan')
    expect((body.planRotationDeg as number).toFixed(4)).toBe('-43.4103')
  })
})

describe('find_nearby and measure_between on the turned building (NOT YET IN src/)', () => {
  it('find_nearby round a wall at 1 m: the unturned building’s neighbours and gaps', async () => {
    const { unturned } = standTurned()
    const id = byName(unturned, 'Ext Wall S A-B L1').id
    const want = await unturnedRun('find_nearby', { id, distance: 1, limit: 100 })
    const body = await run('find_nearby', { id, distance: 1, limit: 100 })
    type N = { id: number; gapMetres: number }
    const gaps = (x: Body): Record<number, number> => Object.fromEntries((x.neighbours as N[]).map((n) => [n.id, n.gapMetres]))
    expect(Object.keys(gaps(body)).sort()).toEqual(Object.keys(gaps(want)).sort())
    for (const [k, v] of Object.entries(gaps(want))) expect(Math.abs(gaps(body)[Number(k)] - v), k).toBeLessThan(1e-9)
    expect(body.count).toBe(want.count)
    expect(body.frame).toBe('plan')
    expect((body.planRotationDeg as number).toFixed(4)).toBe('-43.4103')
  })

  it('measure_between a wall and a column: the unturned building’s gap, and the plan boxes', async () => {
    const { unturned } = standTurned()
    const a = byName(unturned, 'Ext Wall S A-B L1')
    const b = byName(unturned, 'Column A-1 L1')
    const want = await unturnedRun('measure_between', { a: a.id, b: b.id })
    const body = await run('measure_between', { a: a.id, b: b.id })
    expect(body.boxesOverlap).toBe(want.boxesOverlap)
    expect(Math.abs((body.boxClearanceMetres as number) - (want.boxClearanceMetres as number))).toBeLessThan(1e-9)
    expect(body.aBoxMetres).toEqual(a.bbox)
    expect(body.bBoxMetres).toEqual(b.bbox)
    expect(body.frame).toBe('plan')
    expect((body.planRotationDeg as number).toFixed(4)).toBe('-43.4103')
    // The same keys as today, plus the rotation.
    expect(Object.keys(body).sort()).toEqual([...Object.keys(want), 'planRotationDeg'].sort())
  })

  it('get_element keeps every world key and adds the plan box', async () => {
    const { turned, unturned } = standTurned()
    const id = byName(turned, 'Ext Wall S A-B L1').id
    const want = await unturnedRun('get_element', { id })
    const body = await run('get_element', { id })
    // The world keys are the turned world box's, unchanged.
    expect(body.bboxMetres).toEqual(byName(turned, 'Ext Wall S A-B L1').bbox)
    expect(body.bboxFrame).toBe('world')
    // The plan box is the unturned building's.
    const p = byName(unturned, 'Ext Wall S A-B L1').bbox!
    const size = body.planBoxSizeMetres as { x: number; y: number; z: number }
    expect(size, 'no planBoxSizeMetres').toBeDefined()
    expect(Math.abs(size.x - (p[3] - p[0]))).toBeLessThan(1e-9)
    expect(Math.abs(size.y - (p[4] - p[1]))).toBeLessThan(1e-9)
    expect(Math.abs(size.z - (p[5] - p[2]))).toBeLessThan(1e-9)
    expect(Math.abs((body.planBoxVolumeM3 as number) - (want.boxVolumeM3 as number))).toBeLessThan(1e-9)
    // Its centre, back in world metres: the unturned centre turned by ρ.
    const [cx, cy] = turnBy((p[0] + p[3]) / 2, (p[1] + p[4]) / 2)
    const c = body.planBoxCentreMetres as { x: number; y: number; z: number }
    expect(Math.abs(c.x - cx)).toBeLessThan(1e-9)
    expect(Math.abs(c.y - cy)).toBeLessThan(1e-9)
    expect(Math.abs(c.z - (p[2] + p[5]) / 2)).toBeLessThan(1e-9)
    expect('planBoxCentreMap' in body).toBe(true)
    expect((body.planRotationDeg as number).toFixed(4)).toBe('-43.4103')
    expect(String(body.planBoxMethod)).toMatch(/square with the building|building['’]s own axes|plan frame/i)
    // Every key it has today is still there.
    for (const k of Object.keys(want)) expect(body, k).toHaveProperty(k)
  })
})

/* ────────────────────────────── 3. wording ────────────────────────────── */

describe('the four descriptions (NOT YET IN src/ for the new wording)', () => {
  const desc = (name: string): string => {
    const t = TOOLS.find((x) => x.name === name)
    if (!t) throw new Error(`no tool ${name}`)
    return t.description
  }

  it('keep the phrases other checks pin (passes today)', () => {
    expect(desc('clash_check').startsWith('Bounding-box interference candidates between two loaded models')).toBe(true)
    expect(desc('clash_check')).toContain('candidates for review')
    for (const p of ['not solid geometry', 'IfcSpace', 'metres']) expect(desc('find_nearby')).toContain(p)
  })

  for (const name of ['clash_check', 'find_nearby', 'measure_between', 'get_element']) {
    it(`${name} says its results are square with the building when it is turned`, () => {
      expect(desc(name)).toMatch(/square with the building|building['’]s own axes|plan frame/i)
    })
  }

  it('no tool is added: 38 (passes today)', () => {
    expect(TOOLS).toHaveLength(38)
  })
})
