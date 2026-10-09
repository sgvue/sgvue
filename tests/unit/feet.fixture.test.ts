/**
 * 2026-10-09 — a model drawn in feet, end to end under Node: the committed synthetic fixture
 * `tests/fixtures/feet.ifc` (`scripts/make-tiny-ifc.py`, `feet()`) through the real index builder
 * and geometry streamer, the federation store's boot and the store's own readouts.
 *
 * The owner, of the display unit: *"Starts in the first model's unit, adds feet-and-inches next
 * to mm and m, and shows coordinates in the file's map unit."* So a model in feet:
 *
 *  · resolves FOOT, SQUARE FOOT and CUBIC FOOT, and starts the app in `ft`;
 *  · reads its storeys, its elements' boxes and its grid spacings back as the feet they were
 *    drawn in — `+10'-6"`, `40'-0"`, `20'-0"` — while the geometry is metres, as always;
 *  · keeps its quantities as authored, and labels their totals `ft²` / `ft³`;
 *  · shows its base point in the US survey feet its map conversion states.
 *
 * Every coordinate in the fixture is the repository's synthetic set, never a real site's.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { THIN_SPACE } from '../../src/shared/fmt'
import { coordsFromGeoref, mapPlacement, mapUnitOf } from '../../src/shared/georef'
import { federate } from '../../src/shared/federate'
import type { GeometryChunk } from '../../src/shared/geometry-contract.types'
import { displayUnitOf, formatDim, formatElevation, formatLength, unitLabel, US_SURVEY_FOOT } from '../../src/shared/units'
import { elementBoxes } from '../../src/renderer/model/element-boxes'
import { FederationController } from '../../src/renderer/model/federation-store'
import { tableQuantity } from '../../src/renderer/state/selectors/chat'
import { storeyRows } from '../../src/renderer/state/selectors/storeys'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import type { ChatTable } from '../../src/renderer/ai/executors/context'
import { useShell } from '../../src/renderer/state/shell'
import { streamGeometry } from '../../src/worker/geometry-streamer'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'
import { disposeFederation, resetShell, stubViewer } from './stub-viewer'

const FILE = join(__dirname, '..', 'fixtures', 'feet.ifc')

const ready = (async () => {
  const src = await createReadOnlyIfcSource()
  const modelID = src.openFromBuffer(new Uint8Array(readFileSync(FILE)))
  const index = buildModelIndex(src, modelID, { modelKey: 'feet', fileName: 'feet.ifc', sha256: '' })
  const chunks: GeometryChunk[] = []
  const summary = streamGeometry(src, modelID, { modelKey: 'feet', offset: null, frame: null, onChunk: (c) => chunks.push(c) })
  return { index, chunks, offset: summary.offset }
})()

/** Each element's box in the project frame, metres, by name — the app's own union. */
async function boxes(): Promise<Map<string, readonly number[]>> {
  const { index, chunks, offset } = await ready
  const name = new Map(index.elements.map((e) => [e.id, e.name]))
  return new Map([...elementBoxes(chunks, offset)].map(([id, g]) => [name.get(id)!, g.box]))
}

const size = (b: readonly number[]): [number, number, number] => [b[3] - b[0], b[4] - b[1], b[5] - b[2]]

describe('a model drawn in feet', () => {
  it('resolves its conversion-based units, and starts the app in ft', async () => {
    const { index } = await ready
    expect(index.units.length).toBeCloseTo(0.3048, 12)
    expect(index.units.area).toBeCloseTo(0.09290304, 12)
    expect(index.units.volume).toBeCloseTo(0.028316846592, 12)
    expect(index.units.byType.LENGTHUNIT).toMatchObject({ entity: 'IfcConversionBasedUnit', name: 'FOOT' })
    expect(displayUnitOf(index.units)).toBe('ft')
    // Five elements — two slabs, two walls, a column — which the status bar counts.
    expect(federate([index]).elements.map((e) => e.name).sort()).toEqual(['Column C2', 'Slab L1', 'Slab L2', 'Wall S', 'Wall W'])
    expect([unitLabel(index.units, 'length'), unitLabel(index.units, 'area'), unitLabel(index.units, 'volume')]).toEqual([
      'ft',
      'ft²',
      'ft³'
    ])
  })

  it('reads its storeys back as the feet they were authored in', async () => {
    const { index } = await ready
    // `Elevation` 10.5 in the file's own foot is 3.2004 m — and reads back 10'-6".
    expect(index.storeys.map((s) => s.name)).toEqual(['Level 1', 'Level 2'])
    expect(index.storeys[1].elev).toBeCloseTo(3.2004, 12)
    const federation = federate([index])
    const rows = (u: 'mm' | 'm' | 'ft'): string[] =>
      storeyRows({ storeys: federation.storeys, elements: federation.elements, storeyVis: {}, active: null, units: u }).map((r) => r.elev)
    expect(rows('ft')).toEqual([`+0'-0"`, `+10'-6"`])
    expect(rows('m')).toEqual(['+0.000', '+3.200'])
    expect(rows('mm')).toEqual(['+0', `+3${THIN_SPACE}200`])
  })

  it('draws metres, as every model is drawn, and its boxes read back in feet and inches', async () => {
    const b = await boxes()
    // The slab is 40 × 30 × 1 ft: 12.192 × 9.144 × 0.3048 m.
    const slab = size(b.get('Slab L1')!)
    expect(slab[0]).toBeCloseTo(12.192, 6)
    expect(slab[1]).toBeCloseTo(9.144, 6)
    expect(slab[2]).toBeCloseTo(0.3048, 6)
    expect(slab.map((v) => formatLength(v, 'ft'))).toEqual([`40'-0"`, `30'-0"`, `1'-0"`])
    expect(size(b.get('Wall S')!).map((v) => formatLength(v, 'ft'))).toEqual([`40'-0"`, `0'-6"`, `9'-6"`])
    expect(size(b.get('Column C2')!).map((v) => formatLength(v, 'ft'))).toEqual([`1'-3"`, `1'-3"`, `9'-6"`])
    expect(formatLength(size(b.get('Slab L2')!)[2], 'ft')).toBe(`0'-9"`)
    // The upper slab stands on Level 2: its base is 10'-6" up, its top 11'-3".
    const upper = b.get('Slab L2')!
    expect([formatLength(upper[2], 'ft'), formatLength(upper[5], 'ft')]).toEqual([`10'-6"`, `11'-3"`])
  })

  it('spaces its gridlines in feet: 20′-0″ and 30′-0″', async () => {
    const { index } = await ready
    const at = (name: string): readonly [number, number] => index.grids.find((g) => g.name === name)!.start
    expect(index.grids.map((g) => g.name).sort()).toEqual(['1', '2', 'A', 'B', 'C'])
    expect(formatDim(at('B')[0] - at('A')[0], 'ft')).toBe(`20'-0"`)
    expect(formatDim(at('C')[0] - at('B')[0], 'ft')).toBe(`20'-0"`)
    expect(formatDim(at('2')[1] - at('1')[1], 'ft')).toBe(`30'-0"`)
    expect(formatDim(at('B')[0] - at('A')[0], 'mm')).toBe(`6${THIN_SPACE}096${THIN_SPACE}mm`)
  })

  it('keeps its quantities as authored, and labels their totals in square and cubic feet', async () => {
    const { index } = await ready
    const slab = index.elements.find((e) => e.name === 'Slab L1')!
    expect(slab.qto.Qto_SlabBaseQuantities).toEqual({ GrossArea: 1200, GrossVolume: 1200 })
    resetShell()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    try {
      useShell.getState().commitModels(federate([index]))
      const turn = newTurnState()
      const ctx: ToolContext = {
        state: () => useShell.getState(),
        sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
        rawLine: async () => null,
        turn
      }
      const body = (await executeTool('summarize_elements', { groupBy: 'IfcEntity' }, ctx)) as {
        units: Record<string, string>
        message: string
      }
      expect(body.units).toEqual({ area: 'ft²', volume: 'ft³', length: 'ft' })
      expect(body.message).toContain('1200.0 ft²')
      // The panel's table says the same — never the design's literal m².
      const table = turn.table as ChatTable
      expect(table.units).toEqual({ area: 'ft²', volume: 'ft³' })
      const slabs = table.rows.find((r) => r.k === 'IfcSlab')!
      expect(tableQuantity(table, slabs)).toBe('1200.0 ft²')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stands at the synthetic map position, stated in US survey feet, and the card shows them', async () => {
    const { index } = await ready
    const g = index.georef
    expect(g.mapUnit?.name).toBe('US SURVEY FOOT')
    expect(mapPlacement(g).metresPerMapUnit).toBeCloseTo(US_SURVEY_FOOT, 15)
    expect(mapUnitOf(g).label).toBe('US ft')
    // Metres for every read-out that computes with the base point…
    expect(coordsFromGeoref(g)).toMatchObject({ E: 12345.457, N: 23456.766, Z: 5.05 })
    // …and the US survey feet the file states, for the Coordinate-system card.
    expect(coordsFromGeoref(g, mapUnitOf(g).metres)).toMatchObject({ E: 40503.387, N: 76957.74, Z: 16.568 })
  })
})

describe('booting it', () => {
  const fed = new FederationController()
  afterAll(() => disposeFederation(fed))

  it('starts the app in ft — the boot model’s own unit — and tells the viewer', async () => {
    resetShell()
    const heard: string[] = []
    fed.attach(stubViewer({ setUnits: (u: string) => heard.push(u), debug: () => ({}), elementIds: () => [] }))
    const { index, chunks, offset } = await ready
    // The parsed model, as `prepare` hands it over: its frame is the boot's.
    await fed.addBatch([{ index, chunks, offset, frame: null }])
    expect(useShell.getState().units).toBe('ft')
    expect(heard).toEqual(['ft'])
    // And every elevation the sidebar prints is in feet and inches.
    const s = useShell.getState()
    expect(
      storeyRows({ storeys: s.federation.storeys, elements: s.federation.elements, storeyVis: {}, active: null, units: s.units }).map(
        (r) => r.elev
      )
    ).toEqual([`+0'-0"`, `+10'-6"`])
    expect(formatElevation(s.federation.storeys[1].elev, s.units)).toBe(`+10'-6"`)
  })
})
