/**
 * The model database's plan-frame box — "option A", owner-approved 2026-11-11.
 *
 * `bbox` stays what it is: one row per element with geometry, the world-axis box in the files'
 * own coordinates. Beside it the database gains two tables:
 *
 *   · `plan_box (element INTEGER PRIMARY KEY, min_x … max_z REAL)` — the same columns as `bbox`,
 *     in **plan coordinates** (a world point turned by −ρ about the world Z axis through the world
 *     origin), so a query about a turned building's walls reads them square with the building;
 *   · `plan_frame (rotation_deg REAL)` — exactly one row, the ρ those boxes were taken at.
 *
 * Built from `SqlPayload.planBoxes` (`{ rotationDeg, ids, boxes }`); with it absent `plan_box` is
 * `bbox` row for row and `rotation_deg` is 0. **Every existing table and its rows are unchanged**
 * — pinned here by a digest of each, captured from the code as it stood before the change
 * (`golden/plan-frame-rot0.sql.json`). And `FederationController` sends `planBoxes` for the plan
 * rotation in force at every rebuild.
 *
 * `NOT YET IN src/`: `SqlPayload.planBoxes`, both tables, the schema text and the controller's
 * `planBoxes`. The cases that need them fail today with "no such table" or a missing field; the
 * golden digests of the existing tables pass today, and must still pass after.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { federate, type FederatedElement, type Federation } from '../../src/shared/federate'
import { buildDatabase, SQL_SCHEMA, type SqlPayload } from '../../src/worker/sql-schema'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { FederationController, type BatchItem } from '../../src/renderer/model/federation-store'
import { elementBoxes } from '../../src/renderer/model/element-boxes'
import type { SqlBridge } from '../../src/renderer/model/sql-bridge'
import { useShell } from '../../src/renderer/state/shell'
import type { GeometryChunk } from '../../src/shared/geometry-contract.types'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'
import { boxCorners, boxModel, SITE_TURN_DEG, type BoxSpec } from './synthetic-boxes'
import { disposeFederation, resetShell, stubViewer } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const require = createRequire(import.meta.url)
const DIST = dirname(require.resolve('sql.js'))
const MM = 1e-3

/** The tables the database had before this change — each one's rows must not move. */
const EXISTING = [
  'attribute',
  'bbox',
  'classification',
  'element',
  'material',
  'model',
  'property',
  'pset',
  'quantity',
  'relationship',
  'spatial',
  'type_object'
] as const

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (file) => join(DIST, file) })
})

const rowsOf = (db: Database, sql: string): unknown[][] => {
  const r = db.exec(sql)
  return r.length ? r[0].values : []
}

/** Every row of a table, ordered by every column, as a count and a SHA-256 of their JSON. */
function digest(db: Database, table: string): { rows: number; sha256: string } {
  const cols = rowsOf(db, `PRAGMA table_info(${table})`).map((r) => String(r[1]))
  const all = rowsOf(db, `SELECT * FROM ${table} ORDER BY ${cols.map((_, i) => i + 1).join(', ')}`)
  return { rows: all.length, sha256: createHash('sha256').update(JSON.stringify(all)).digest('hex') }
}
const digests = (db: Database): Record<string, { rows: number; sha256: string }> =>
  Object.fromEntries(EXISTING.map((t) => [t, digest(db, t)]))

const mock = (): Federation => federate(KEYS.map((key) => mockModelIndex(key)))
const build = (payload: SqlPayload): Database => buildDatabase(SQL, payload)

/* ────────────────────────────── at rotation 0 ────────────────────────────── */

describe('without planBoxes, nothing that was there moves (golden)', () => {
  it('every existing table’s rows are what they were before the change', async () => {
    const f = mock()
    const db = build({ models: f.models, elements: f.elements })
    const file = new URL('./golden/plan-frame-rot0.sql.json', import.meta.url)
    expect(existsSync(file), 'golden file missing: create it empty, then run vitest with -u once, on the code before the change').toBe(true)
    await expect(JSON.stringify(digests(db), null, 1) + '\n').toMatchFileSnapshot('./golden/plan-frame-rot0.sql.json')
    db.close()
  })

  it('plan_box is bbox row for row, and plan_frame is one row: 0 (NOT YET IN src/)', () => {
    const f = mock()
    const db = build({ models: f.models, elements: f.elements })
    const bbox = rowsOf(db, 'SELECT element, min_x, min_y, min_z, max_x, max_y, max_z FROM bbox ORDER BY element')
    // NOT YET IN src/: both tables.
    const planBox = rowsOf(db, 'SELECT element, min_x, min_y, min_z, max_x, max_y, max_z FROM plan_box ORDER BY element')
    expect(bbox.length).toBeGreaterThan(400)
    expect(planBox).toEqual(bbox)
    expect(rowsOf(db, 'SELECT rotation_deg FROM plan_frame')).toEqual([[0]])
    db.close()
  })

  it('plan_box has exactly bbox’s columns, and element is its primary key (NOT YET IN src/)', () => {
    const f = mock()
    const db = build({ models: f.models, elements: f.elements })
    const cols = (t: string): unknown[][] => rowsOf(db, `PRAGMA table_info(${t})`).map((r) => [r[1], r[2], r[5]])
    expect(cols('plan_box')).toEqual([
      ['element', 'INTEGER', 1],
      ['min_x', 'REAL', 0],
      ['min_y', 'REAL', 0],
      ['min_z', 'REAL', 0],
      ['max_x', 'REAL', 0],
      ['max_y', 'REAL', 0],
      ['max_z', 'REAL', 0]
    ])
    expect(cols('plan_frame')).toEqual([['rotation_deg', 'REAL', 0]])
    db.close()
  })
})

/* ────────────────────────────── the rotation in force ────────────────────────────── */

/** A wall 6.0 × 0.1 × 3.0 m square with a building turned −43.4103° (`synthetic-boxes.ts`). */
const WALL: BoxSpec = { name: 'Wall', at: [1000, 2000, 0], size: [6000, 100, 3000] }
type B6 = [number, number, number, number, number, number]
const aabb = (pts: readonly (readonly number[])[]): B6 => [0, 1, 2, 0, 1, 2].map((k, i) =>
  (i < 3 ? Math.min : Math.max)(...pts.map((p) => p[k]))
) as B6
const RHO = (SITE_TURN_DEG * Math.PI) / 180
const turn = (p: readonly number[]): number[] => [
  p[0] * Math.cos(RHO) + p[1] * Math.sin(RHO),
  -p[0] * Math.sin(RHO) + p[1] * Math.cos(RHO),
  p[2]
]
const WALL_WORLD = aabb(boxCorners(WALL))
const WALL_PLAN = aabb(boxCorners(WALL).map(turn))

/**
 * The mock federation with one ARC wall standing as that turned wall: its `bbox` the world box,
 * and a `planBoxes` that gives every boxed element its own box but that wall its plan box.
 */
function turnedPayload(rotationDeg: number): { payload: SqlPayload; wall: FederatedElement } {
  const idx = KEYS.map((key) => mockModelIndex(key))
  const arc = idx[0]
  idx[0] = { ...arc, elements: arc.elements.map((e) => (e.name === 'Ext Wall S A-B L1' ? { ...e, bbox: WALL_WORLD } : e)) }
  const f = federate(idx)
  const wall = f.elements.find((e) => e.name === 'Ext Wall S A-B L1' && e.model === 'ARC')!
  const boxed = f.elements.filter((e) => e.bbox)
  const ids = new Float64Array(boxed.map((e) => e.id))
  const boxes = new Float64Array(boxed.flatMap((e) => (e === wall ? WALL_PLAN : [...e.bbox!])))
  // NOT YET IN src/: `SqlPayload.planBoxes`.
  return { payload: { models: f.models, elements: f.elements, planBoxes: { rotationDeg, ids, boxes } }, wall }
}

describe('with planBoxes (NOT YET IN src/)', () => {
  it('plan_frame carries the rotation, and the turned wall’s plan_box is 6.0 m long while its bbox row is the world box', () => {
    const { payload, wall } = turnedPayload(SITE_TURN_DEG)
    const db = build(payload)
    const [[rot]] = rowsOf(db, 'SELECT rotation_deg FROM plan_frame') as [[number]]
    expect(rot).toBe(SITE_TURN_DEG)
    expect(rot.toFixed(4)).toBe('-43.4103')
    expect(rowsOf(db, 'SELECT COUNT(*) FROM plan_frame')).toEqual([[1]])
    const [p] = rowsOf(db, `SELECT min_x, min_y, min_z, max_x, max_y, max_z FROM plan_box WHERE element = ${wall.id}`) as number[][]
    const along = [p[3] - p[0], p[4] - p[1], p[5] - p[2]]
    expect(Math.abs(Math.max(along[0], along[1]) - 6)).toBeLessThan(MM)
    expect(Math.abs(Math.min(along[0], along[1]) - 0.1)).toBeLessThan(MM)
    expect(Math.abs(along[2] - 3)).toBeLessThan(MM)
    const [w] = rowsOf(db, `SELECT min_x, min_y, min_z, max_x, max_y, max_z FROM bbox WHERE element = ${wall.id}`)
    expect(w).toEqual(WALL_WORLD)
    // …which is no 6.0 × 0.1 m box: ~4.4 × 4.2 m.
    expect(w[3] as number - (w[0] as number)).toBeGreaterThan(4)
    db.close()
  })

  it('one row a boxed element, in plan_box as in bbox', () => {
    const { payload } = turnedPayload(SITE_TURN_DEG)
    const db = build(payload)
    expect(rowsOf(db, 'SELECT COUNT(*) FROM plan_box')).toEqual(rowsOf(db, 'SELECT COUNT(*) FROM bbox'))
    expect(rowsOf(db, 'SELECT COUNT(*) FROM plan_box p LEFT JOIN bbox b ON b.element = p.element WHERE b.element IS NULL')).toEqual([[0]])
    db.close()
  })

  it('a second build with another rotation carries the new one', () => {
    const first = build(turnedPayload(SITE_TURN_DEG).payload)
    const second = build(turnedPayload(12.5).payload)
    expect(rowsOf(first, 'SELECT rotation_deg FROM plan_frame')).toEqual([[SITE_TURN_DEG]])
    expect(rowsOf(second, 'SELECT rotation_deg FROM plan_frame')).toEqual([[12.5]])
    first.close()
    second.close()
  })

  it('every existing table is still what it was before the change, planBoxes or not', () => {
    const f = mock()
    const without = build({ models: f.models, elements: f.elements })
    const boxed = f.elements.filter((e) => e.bbox)
    const shifted = new Float64Array(boxed.flatMap((e) => e.bbox!.map((v) => v + 1)))
    // NOT YET IN src/: `SqlPayload.planBoxes`.
    const withBoxes = build({
      models: f.models,
      elements: f.elements,
      planBoxes: { rotationDeg: SITE_TURN_DEG, ids: new Float64Array(boxed.map((e) => e.id)), boxes: shifted }
    })
    expect(digests(withBoxes)).toEqual(digests(without))
    // And the plan boxes are the ones given, not bbox's.
    const [[minX]] = rowsOf(withBoxes, `SELECT min_x FROM plan_box WHERE element = ${boxed[0].id}`) as [[number]]
    expect(minX).toBe(boxed[0].bbox![0] + 1)
    without.close()
    withBoxes.close()
  })
})

describe('the schema documents both tables (NOT YET IN src/)', () => {
  it('SQL_SCHEMA has CREATE TABLE plan_box and CREATE TABLE plan_frame', () => {
    expect(SQL_SCHEMA).toContain('CREATE TABLE plan_box')
    expect(SQL_SCHEMA).toContain('CREATE TABLE plan_frame')
  })
})

/* ────────────────────────────── the controller ────────────────────────────── */

/** The turned synthetic model as a batch item: parsed and streamed here, its boxes written on. */
async function turnedItem(): Promise<BatchItem> {
  const src = await createReadOnlyIfcSource()
  try {
    const bytes = new TextEncoder().encode(
      boxModel({ name: 'Turned', guidPrefix: '7', boxes: [WALL, { name: 'Wall 2', at: [1000, 3200, 0], size: [6000, 100, 3000] }] })
    )
    const id = src.openFromBuffer(bytes)
    const index = buildModelIndex(src, id, { modelKey: 'TURNED', fileName: 'Turned.ifc', sha256: '' })
    const chunks: GeometryChunk[] = []
    const summary = streamGeometry(src, id, { modelKey: 'TURNED', offset: null, onChunk: (c) => chunks.push(c) })
    src.close(id)
    const geometry = elementBoxes(chunks, summary.offset)
    for (const element of index.elements) {
      const own = geometry.get(element.id)
      if (own) {
        element.bbox = own.box
        element.solidCount = own.parts
      }
    }
    return { index, chunks, offset: summary.offset }
  } finally {
    src.dispose()
  }
}

describe('FederationController sends the plan rotation in force with every SQL rebuild (NOT YET IN src/)', () => {
  let fed: FederationController | null = null
  afterEach(async () => {
    if (fed) await disposeFederation(fed)
    fed = null
    vi.restoreAllMocks()
  })

  it('a turned model alone, then a square model joining: each payload carries the rotation then in force', async () => {
    resetShell()
    fed = new FederationController()
    fed.attach(stubViewer({ addModel: async () => undefined, removeModel: () => [], debug: () => ({}), elementIds: () => [] }))
    const payloads: SqlPayload[] = []
    const bridge = (fed as unknown as { sql: SqlBridge }).sql
    vi.spyOn(bridge, 'build').mockImplementation(async (p: SqlPayload) => {
      payloads.push(p)
      return { elements: p.elements.length, ms: 0 }
    })
    const settle = async (): Promise<void> => void (await fed!.query('SELECT 1').catch(() => undefined))

    await fed.addBatch([await turnedItem()])
    await settle()
    const rot1 = useShell.getState().planRotationDeg
    // The fixture: the turned model alone stands at the synthetic site's turn.
    expect(Math.abs(rot1 - SITE_TURN_DEG)).toBeLessThan(1e-6)
    expect(payloads).toHaveLength(1)
    // NOT YET IN src/: `SqlPayload.planBoxes`.
    const first = payloads[0].planBoxes
    expect(first, 'no planBoxes in the payload').toBeDefined()
    expect(first!.rotationDeg).toBe(rot1)
    const boxed = payloads[0].elements.filter((e) => e.bbox)
    expect(first!.ids.length).toBe(boxed.length)
    expect(first!.boxes.length).toBe(6 * boxed.length)

    await fed.addBatch([{ index: mockModelIndex('ARC'), chunks: mockGeometryChunks('ARC'), offset: [0, 0, 0] }])
    await settle()
    const rot2 = useShell.getState().planRotationDeg
    // The fixture: the square model's grids put the federation's plan back square, or near it.
    expect(rot2).not.toBe(rot1)
    expect(payloads).toHaveLength(2)
    const second = payloads[1].planBoxes
    // A square plan may send no plan boxes at all (plan_box is then bbox); a turned one must say which.
    if (rot2 === 0) expect(second === undefined || second.rotationDeg === 0).toBe(true)
    else expect(second?.rotationDeg).toBe(rot2)
  }, 30_000)
})
