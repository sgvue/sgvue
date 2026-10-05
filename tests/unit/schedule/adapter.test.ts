/**
 * The federation → schedule-store adapter (`src/schedule/adapter.ts`).
 *
 * The committed fixture goes through the real parse (`buildModelIndex`) and the real
 * federation, so the rows are the ones the Schedules window will receive. The synthetic cases
 * pin each field against what ifcTable's own extractor produced.
 *
 * `SGVUE_IFC=<model.ifc>` adds a measurement on a real model: adapter time, the snapshot's
 * structured-clone size, and the time to index it — the numbers the Build Report quotes.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serialize } from 'node:v8'
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import type { IfcElement, ModelIndex } from '../../../src/shared/model-index.types'
import { createReadOnlyIfcSource } from '../../../src/worker/ifc-source'
import { buildModelIndex } from '../../../src/worker/index-builder'
import { mockModelIndex } from '../../../src/renderer/dev/mock-adapter'
import { snapshotOf } from '../../../src/schedule/adapter'
import { StoreBuilder } from '../../../src/schedule/ifc/store'
import { openingSchedule } from '../../../src/schedule/schedule/columns'
import { runSchedule, type DataRow } from '../../../src/schedule/schedule/engine'
import { ToSchedules } from '../../../src/schedule/messages'

const ROOT = resolve(__dirname, '../../..')

async function indexOf(path: string, modelKey: string): Promise<ModelIndex> {
  const src = await createReadOnlyIfcSource()
  const modelID = src.openFromBuffer(new Uint8Array(readFileSync(path)))
  const index = buildModelIndex(src, modelID, { modelKey, fileName: `${modelKey}.ifc`, sha256: '' })
  src.close(modelID)
  src.dispose()
  return index
}

const tiny = indexOf(resolve(ROOT, 'tests/fixtures/tiny.ifc'), 'tiny')

describe('the committed fixture, through the real parse and federation', () => {
  it('gives one row per element, each naming its federation id', async () => {
    const fed = federate([await tiny])
    const snap = snapshotOf(fed)
    expect(snap.cores).toHaveLength(6)
    expect(snap.cells).toHaveLength(6)
    expect(snap.rowIds).toEqual(fed.elements.map((e) => e.id))
    expect(snap.meta.elementCount).toBe(6)
    expect(snap.meta.unitSystem).toBe('metric')
    expect(snap.meta.lengthUnit).toBe('m')
  })

  it('carries the storey, its elevation and the building and site above it', async () => {
    const snap = snapshotOf(federate([await tiny]))
    const wall = snap.cores.find((c) => c.name === 'Wall L2-1')!
    expect(wall.entity).toBe('IfcWall')
    expect(wall.guid).toBe('000000000000000000000D')
    expect(wall.storey).toBe('Level 2')
    expect(wall.storeyElevation).toBeCloseTo(3.2, 9)
    expect(wall.discipline).toBe('ARC')
    expect(wall.model).toBe('tiny')
    // Phase 3: the Model field is the name the sidebar shows, when the caller gives it.
    const named = snapshotOf(federate([await tiny]), { tiny: 'Tiny test model' })
    expect(new Set(named.cores.map((c) => c.model))).toEqual(new Set(['Tiny test model']))
    expect(wall.predefinedType).toBe('SOLIDWALL')
    const slab = snap.cores.find((c) => c.name === 'Slab L1')!
    expect(slab.storeyElevation).toBe(0)
    expect(slab.discipline).toBe('STR')
  })

  it('turns an IfcBoolean property into a boolean cell under "Pset.Prop"', async () => {
    const snap = snapshotOf(federate([await tiny]))
    const withPset = snap.cells.filter((c) => 'Pset_WallCommon.IsExternal' in c)
    expect(withPset.length).toBeGreaterThan(0)
    expect(withPset[0]['Pset_WallCommon.IsExternal']).toEqual({ v: true })
    expect(withPset[0]['Pset_WallCommon.LoadBearing']).toEqual({ v: false })
  })

  it('opens a schedule whose data rows map back to federation ids', async () => {
    const snap = snapshotOf(federate([await tiny]))
    const b = new StoreBuilder()
    b.add(snap.cores, snap.cells)
    const store = b.finish(snap.meta)
    expect(store.entities).toEqual([
      { entity: 'IfcWall', count: 4 },
      { entity: 'IfcSlab', count: 2 }
    ])
    const { def } = openingSchedule(store, null)
    expect(def.entity).toEqual(['IfcWall'])
    const rows = runSchedule(store, def).rows.filter((r): r is DataRow => r.kind === 'data')
    const ids = rows.flatMap((r) => r.rows.map((i) => snap.rowIds[i]))
    const fed = federate([await tiny])
    expect(ids.map((id) => fed.byId.get(id)!.type)).toEqual(['IfcWall', 'IfcWall', 'IfcWall', 'IfcWall'])
  })

  it('is empty for an empty federation', () => {
    const snap = snapshotOf(federate([]))
    expect(snap.cores).toEqual([])
    expect(snap.rowIds).toEqual([])
    expect(snap.meta.elementCount).toBe(0)
  })
})

/* ────────────────────────────── field by field, against extract.ts ────────────────────────────── */

async function synthetic(elements: Partial<IfcElement>[], units?: Partial<ModelIndex['units']>): Promise<ModelIndex> {
  const base = await tiny
  const template = base.elements[0]
  return {
    ...base,
    modelKey: 'syn',
    units: { ...base.units, ...units },
    elements: elements.map((e, i) => ({ ...template, psets: {}, qto: {}, psetMeta: {}, materials: [], ...e, id: i + 1, expressId: i + 1 }))
  }
}

describe('each field, as ifcTable extracted it', () => {
  it('splits "Family:Type" on the first colon, and keeps a colon-less name as the type', async () => {
    const snap = snapshotOf(
      federate([await synthetic([{ objectType: 'Basic Wall:Generic - 200mm:x' }, { objectType: 'Plain' }])])
    )
    expect(snap.cores[0].family).toBe('Basic Wall')
    expect(snap.cores[0].typeName).toBe('Generic - 200mm:x')
    expect(snap.cores[0].objectType).toBe('Basic Wall:Generic - 200mm:x')
    expect(snap.cores[1].family).toBe('')
    expect(snap.cores[1].typeName).toBe('Plain')
  })

  it('converts a measure to SI with the file unit and names its kind', async () => {
    const snap = snapshotOf(
      federate([
        await synthetic(
          [
            {
              psets: { Dims: { Width: 900, Label: 'A', Empty: '', Many: ['x', 'y'], Ratio: 0.5 } },
              qto: { Qto_WallBaseQuantities: { NetSideArea: 12, Weight: 3000 } },
              psetMeta: {
                Dims: { sourceExpressId: 1, inherited: false, kind: 'other', measures: { Width: 'IFCPOSITIVELENGTHMEASURE', Ratio: 'IFCRATIOMEASURE' } },
                Qto_WallBaseQuantities: { sourceExpressId: 2, inherited: false, kind: 'Qto', measures: { NetSideArea: 'IFCAREAMEASURE', Weight: 'IFCMASSMEASURE' } }
              }
            }
          ],
          {
            length: 0.001,
            area: 1,
            byType: { MASSUNIT: { unitType: 'MASSUNIT', entity: 'IfcSIUnit', name: 'GRAM', prefix: 'KILO', factor: 1000 } }
          }
        )
      ])
    )
    const c = snap.cells[0]
    expect(c['Dims.Width']).toEqual({ v: 0.9, k: 'length' })
    expect(c['Dims.Ratio']).toEqual({ v: 0.5 })
    expect(c['Dims.Label']).toEqual({ v: 'A' })
    expect(c['Dims.Empty']).toBeUndefined()
    expect(c['Dims.Many']).toEqual({ v: 'x, y' })
    expect(c['Qto_WallBaseQuantities.NetSideArea']).toEqual({ v: 12, k: 'area' })
    // Kilograms: a 3 000 kg element is 3 000 in SI, not 3 000 000.
    expect(c['Qto_WallBaseQuantities.Weight']).toEqual({ v: 3000, k: 'mass' })
  })

  it('reads a POUND mass unit as kilograms — the index keeps mass factors in grams', async () => {
    const snap = snapshotOf(
      federate([
        await synthetic(
          [
            {
              qto: { Qto_Test: { Weight: 2 } },
              psetMeta: {
                Qto_Test: { sourceExpressId: 1, inherited: false, kind: 'Qto', measures: { Weight: 'IFCMASSMEASURE' } }
              }
            }
          ],
          {
            byType: {
              MASSUNIT: { unitType: 'MASSUNIT', entity: 'IfcConversionBasedUnit', name: 'POUND', prefix: '', factor: 453.59237 }
            }
          }
        )
      ])
    )
    const w = snap.cells[0]['Qto_Test.Weight']
    expect(w.k).toBe('mass')
    expect(w.v as number).toBeCloseTo(0.90718474, 9)
  })

  it('joins every distinct layer material, and falls back to the material name', async () => {
    const snap = snapshotOf(
      federate([
        await synthetic([
          {
            materials: [
              {
                kind: 'IfcMaterialLayerSetUsage',
                name: 'Wall set',
                layers: [
                  { name: 'L1', material: 'Brick' },
                  { name: 'L2', material: 'Insulation' },
                  { name: 'L3', material: 'Brick' }
                ]
              }
            ]
          },
          { materials: [{ kind: 'IfcMaterial', name: 'Concrete' }] }
        ])
      ])
    )
    expect(snap.cores[0].material).toBe('Brick, Insulation')
    expect(snap.cores[1].material).toBe('Concrete')
  })

  it('skips IfcVirtualElement, as ifcTable does', async () => {
    const snap = snapshotOf(federate([await synthetic([{ type: 'IfcVirtualElement' }, { type: 'IfcDoor' }])]))
    expect(snap.cores.map((c) => c.entity)).toEqual(['IfcDoor'])
    expect(snap.rowIds).toHaveLength(1)
  })

  it('shares the cells of a shared property set, so they convert — and cross — once', async () => {
    const shared = { Width: 1 }
    const snap = snapshotOf(federate([await synthetic([{ psets: { T: shared } }, { psets: { T: shared } }])]))
    expect(snap.cells[0]['T.Width']).toBe(snap.cells[1]['T.Width'])
  })

  it('reads the design mock federation without throwing', () => {
    const snap = snapshotOf(federate([mockModelIndex('ARC')]))
    expect(snap.cores.length).toBeGreaterThan(0)
    expect(snap.rowIds.length).toBe(snap.cores.length)
  })
})

/* ────────────────────────────── conversion-based units, through the real parse ────────────────────────────── */

/**
 * `tiny.ifc` with every unit a conversion-based imperial one — FOOT, SQUARE FOOT, CUBIC FOOT,
 * POUND (over KILO GRAM) and DEGREE — and one wall carrying a measure of each kind, so the
 * index builder's own factors are what the adapter converts with.
 */
function imperialTiny(): string {
  const text = readFileSync(resolve(ROOT, 'tests/fixtures/tiny.ifc'), 'utf8')
  const units = [
    "#200=IFCSIUNIT(*,.MASSUNIT.,.KILO.,.GRAM.);",
    '#201=IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0);',
    '#202=IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),#1);',
    "#203=IFCCONVERSIONBASEDUNIT(#201,.LENGTHUNIT.,'FOOT',#202);",
    '#204=IFCDIMENSIONALEXPONENTS(2,0,0,0,0,0,0);',
    '#205=IFCMEASUREWITHUNIT(IFCAREAMEASURE(0.09290304),#2);',
    "#206=IFCCONVERSIONBASEDUNIT(#204,.AREAUNIT.,'SQUARE FOOT',#205);",
    '#207=IFCDIMENSIONALEXPONENTS(3,0,0,0,0,0,0);',
    '#208=IFCMEASUREWITHUNIT(IFCVOLUMEMEASURE(0.028316846592),#3);',
    "#209=IFCCONVERSIONBASEDUNIT(#207,.VOLUMEUNIT.,'CUBIC FOOT',#208);",
    '#210=IFCDIMENSIONALEXPONENTS(0,1,0,0,0,0,0);',
    '#211=IFCMEASUREWITHUNIT(IFCMASSMEASURE(0.45359237),#200);',
    "#212=IFCCONVERSIONBASEDUNIT(#210,.MASSUNIT.,'POUND',#211);",
    '#213=IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0);',
    '#214=IFCMEASUREWITHUNIT(IFCPLANEANGLEMEASURE(0.0174532925199433),#4);',
    "#215=IFCCONVERSIONBASEDUNIT(#213,.PLANEANGLEUNIT.,'DEGREE',#214);",
    '#5=IFCUNITASSIGNMENT((#203,#206,#209,#212,#215));'
  ]
  const props = [
    "#220=IFCPROPERTYSINGLEVALUE('Width',$,IFCPOSITIVELENGTHMEASURE(3.),$);",
    "#221=IFCPROPERTYSINGLEVALUE('Area',$,IFCAREAMEASURE(10.),$);",
    "#222=IFCPROPERTYSINGLEVALUE('Volume',$,IFCVOLUMEMEASURE(100.),$);",
    "#223=IFCPROPERTYSINGLEVALUE('Weight',$,IFCMASSMEASURE(2.),$);",
    "#224=IFCPROPERTYSINGLEVALUE('Angle',$,IFCPLANEANGLEMEASURE(90.),$);",
    "#225=IFCPROPERTYSET('000000000000000000000J',$,'Pset_Imperial',$,(#220,#221,#222,#223,#224));",
    "#226=IFCRELDEFINESBYPROPERTIES('000000000000000000000K',$,$,$,(#46),#225);"
  ]
  const out = text
    .replace(/\r\n/g, '\n')
    .replace('#5=IFCUNITASSIGNMENT((#1,#2,#3,#4));', units.join('\n'))
    .replace('ENDSEC;\nEND-ISO', props.join('\n') + '\nENDSEC;\nEND-ISO')
  if (!out.includes('#212=') || !out.includes('#226=')) throw new Error('imperialTiny: fixture shape changed')
  return out
}

describe('conversion-based units, as the index builder resolves them', () => {
  it('turns FOOT, SQUARE FOOT, CUBIC FOOT, POUND and DEGREE values into SI', async () => {
    const src = await createReadOnlyIfcSource()
    const modelID = src.openFromBuffer(new TextEncoder().encode(imperialTiny()))
    const index = buildModelIndex(src, modelID, { modelKey: 'imp', fileName: 'imp.ifc', sha256: '' })
    src.close(modelID)
    src.dispose()
    expect(index.units.byType.MASSUNIT?.name).toBe('POUND')

    const snap = snapshotOf(federate([index]))
    expect(snap.meta.unitSystem).toBe('imperial')
    expect(snap.meta.lengthUnit).toBe('ft')
    const c = snap.cells[snap.cores.findIndex((x) => x.name === 'Wall L1-1')]
    const near = (key: string, kind: string, si: number): void => {
      expect(c[key]?.k, key).toBe(kind)
      expect(c[key]?.v as number, key).toBeCloseTo(si, 6)
    }
    near('Pset_Imperial.Width', 'length', 0.9144)
    near('Pset_Imperial.Area', 'area', 0.9290304)
    near('Pset_Imperial.Volume', 'volume', 2.8316846592)
    near('Pset_Imperial.Weight', 'mass', 0.90718474)
    near('Pset_Imperial.Angle', 'angle', Math.PI / 2)
  })
})

/* ────────────────────────────── a real model, when one is named ────────────────────────────── */

const BIG = process.env.SGVUE_IFC ? resolve(ROOT, process.env.SGVUE_IFC) : ''

describe.skipIf(!BIG)('a real model (SGVUE_IFC)', () => {
  it('measures the snapshot', { timeout: 600_000 }, async () => {
    const index = await indexOf(BIG, 'big')
    const fed = federate([index])
    let t = performance.now()
    const snap = snapshotOf(fed)
    const adaptMs = performance.now() - t
    t = performance.now()
    const bytes = serialize(snap).length
    const serializeMs = performance.now() - t
    t = performance.now()
    const valid = ToSchedules.safeParse({ type: 'store', snapshot: snap }).success
    const validateMs = performance.now() - t
    expect(valid).toBe(true)
    t = performance.now()
    const b = new StoreBuilder()
    b.add(snap.cores, snap.cells)
    const store = b.finish(snap.meta)
    const indexMs = performance.now() - t
    t = performance.now()
    const res = runSchedule(store, openingSchedule(store, null).def)
    const runMs = performance.now() - t
    console.log(
      `[schedules] ${snap.cores.length} rows · ${store.entities.length} categories · ` +
        `adapt ${adaptMs.toFixed(0)} ms · structured-clone ${(bytes / 1048576).toFixed(1)} MB ` +
        `(serialize ${serializeMs.toFixed(0)} ms) · validate ${validateMs.toFixed(0)} ms · index ${indexMs.toFixed(0)} ms · ` +
        `opening schedule ${res.totalDataRows} rows in ${runMs.toFixed(0)} ms`
    )
    expect(snap.rowIds).toHaveLength(snap.cores.length)
  })
})
