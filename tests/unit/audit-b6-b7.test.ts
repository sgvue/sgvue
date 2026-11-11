/**
 * Audit fixes B6 / B7 — one test per item, each written to fail on the code before its fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLASH_TEST_CAP, clashPairs } from '../../src/renderer/ai/analysis'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { libraryOf } from '../../src/renderer/model/upload-pipeline'
import { tableCsv } from '../../src/renderer/state/selectors/chat'
import { spotRows } from '../../src/renderer/state/selectors/markups'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import type { SpotRecord } from '../../src/renderer/viewer/annotations'
import { federate, type FederatedElement } from '../../src/shared/federate'
import { visFn } from '../../src/shared/rules'
import { TOOLS } from '../../src/shared/tool-schemas'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

/* ────────────────────────────── item 1: clash cap ────────────────────────────── */

describe('item 1 — clash check', () => {
  it('a capped clash result is still sorted largest overlap first', () => {
    // 700 × 700 = 490 000 candidate tests, all in one bucket: the cap (400 000) trips.
    const n = 700
    expect(n * n).toBeGreaterThan(CLASH_TEST_CAP)
    const el = (id: number, model: string, bbox: number[]): FederatedElement =>
      ({ id, model, name: `${model}-${id}`, type: 'IfcWall', bbox }) as unknown as FederatedElement
    // An A box met later overlaps more: its X extent grows with its index.
    const A = Array.from({ length: n }, (_, i) => el(i + 1, 'A', [0, 0, 0, 0.1 + (0.8 * i) / n, 1, 1]))
    const B = Array.from({ length: n }, (_, i) => el(10_000 + i, 'B', [0, 0, 0, 1, 1, 1]))
    const always = visFn({ hidden: {}, modelVis: {}, storeyVis: {}, stack: [] })
    const { pairs, capped } = clashPairs([...A, ...B], always, 'A', 'B')
    expect(capped).toBe(true)
    expect(pairs.length).toBeGreaterThan(0)
    const vols = pairs.map((p) => p.vol)
    const unsorted = vols.findIndex((v, i) => i > 0 && v > vols[i - 1])
    expect(unsorted).toBe(-1)
  })
})

/* ────────────────────────────── item 2: two same-named recents ────────────────────────────── */

describe('item 2 — two recents of one name', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    resetShell()
    setViewer(stubViewer())
  })
  afterEach(() => {
    setViewer(null)
    vi.unstubAllGlobals()
  })

  it('two same-named recents send the user to the upload button, not the removed library', async () => {
    useShell.getState().setLibrary(
      libraryOf([
        { path: 'C:\\Models\\Tower A.ifc', name: 'Tower A.ifc' },
        { path: 'E:\\Other\\Tower A.ifc', name: 'Tower A.ifc' }
      ])
    )
    const ctx: ToolContext = {
      state: () => useShell.getState(),
      sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
      rawLine: async () => null,
      turn: newTurnState()
    }
    const body = (await executeTool('request_user_action', { action: 'open_recent', recent: 'Tower A.ifc' }, ctx)) as {
      message: string
    }
    expect(body.message).not.toContain('library')
    expect(body.message.endsWith('Nothing was asked — the user can open the one they mean with the sidebar’s upload button.')).toBe(true)
  })
})

/* ────────────────────────────── item 3: summarize_elements ────────────────────────────── */

describe('item 3 — summarize_elements description', () => {
  it('summarize_elements no longer asks for a one-sentence reply', () => {
    const spec = TOOLS.find((t) => t.name === 'summarize_elements')!
    expect(spec.description).not.toContain('one sentence')
    expect(spec.description).toContain('do not repeat its rows')
  })
})

/* ────────────────────────────── item 4: a placed spot in feet ────────────────────────────── */

describe('item 4 — a placed spot reads in the display unit', () => {
  const full = federate((['ARC', 'STR', 'SIT', 'MEP'] as const).map((k) => mockModelIndex(k)))
  const st = () => useShell.getState()
  let nextId = 100
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    resetShell()
    setViewer(
      stubViewer({
        placeSpot: (p: number[]) => {
          const [ox, oy, oz] = st().offset
          const f = { x: p[0] + ox, y: p[1] + oy, z: p[2] + oz }
          const rec: SpotRecord = { id: ++nextId, p: p as [number, number, number], E: f.x, N: f.y, Z: f.z, ...f }
          st().setSpots([...st().spots, rec])
        }
      })
    )
    st().commitModels(full)
  })
  afterEach(() => {
    setViewer(null)
    vi.unstubAllGlobals()
  })

  it('place_spot in ft quotes the Markups card’s own ft row, not metres', async () => {
    useShell.setState({ coords: { E: 12345.457, N: 23456.766, Z: 5.05, angle: 0 }, units: 'ft' })
    const ctx: ToolContext = {
      state: () => useShell.getState(),
      sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
      rawLine: async () => null,
      turn: newTurnState()
    }
    const body = (await executeTool('manage_markups', { op: 'place_spot', point: { x: 10, y: 20, z: 3 } }, ctx)) as {
      message: string
    }
    const ft = spotRows(st().spots, 'ft')[0].v
    const metres = spotRows(st().spots)[0].v
    expect(ft).not.toBe(metres)
    expect(body.message).toContain(`: ${ft}. `)
    expect(body.message).not.toContain(metres)
  })
})

/* ────────────────────────────── item 5: copy csv volumes ────────────────────────────── */

describe('item 5 — copy csv', () => {
  it('copy csv writes a group’s volume, and leaves area, clash and empty rows as they were', () => {
    // A volume-only table: the quantity column was blank.
    expect(tableCsv({ groupBy: 'Level', rows: [{ k: 'L1', n: 4, volume: 12.34567, ids: [] }] }).split('\n')[1]).toBe(
      '"L1",4,12.346'
    )
    // Unchanged: an area row, a clash row, a row with neither.
    expect(tableCsv({ groupBy: 'Level', rows: [{ k: 'L1', n: 4, area: 4.5, volume: 9, ids: [] }] }).split('\n')[1]).toBe(
      '"L1",4,4.50'
    )
    expect(
      tableCsv({ groupBy: 'Clash candidates', clash: true, rows: [{ k: 'A ↔ B', n: 1, vol: 0.01234567, ids: [] }] }).split('\n')[1]
    ).toBe('"A ↔ B",1,0.0123')
    expect(tableCsv({ groupBy: 'Level', rows: [{ k: 'L1', n: 4, ids: [] }] }).split('\n')[1]).toBe('"L1",4,')
  })
})
