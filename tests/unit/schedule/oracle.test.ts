/**
 * The Schedules window's data, cell by cell, against IfcOpenShell (2026-11-08).
 *
 * `scripts/expected-from-ifcopenshell.py` reads the committed synthetic models with IfcOpenShell
 * and writes `tests/fixtures/<stem>.cells.json`: for every indexed element its property and
 * quantity values as written, each with its IFC measure type (and, for a property that is not a
 * single value, its class), the fields a schedule shows, the storey, building, site and space
 * above it, and the file's unit scales (`calculate_unit_scale`, and each derived unit's from its
 * elements). This test builds the Schedules data the way the app does — the real parse, the
 * federation, `snapshotOf`, `StoreBuilder`, `runSchedule` — and requires every cell to say what
 * IfcOpenShell says.
 *
 * Three models: `reference.ifc` (2 097 elements, millimetres), `feet.ifc` (feet) and `edge.ifc`
 * (`scripts/make-edge-ifc.py`: Family:Type names, list / enumerated / bounded values, blanks and
 * placeholders, pounds, a count, a non-SI derived unit, furniture in a space, a wall in no storey
 * and a component nested on it, and — contained nowhere themselves — a component nested on a
 * storey's wall and a door that only fills an opening in one, whose storey is their host's).
 *
 * Per IFC class, two schedules, itemised, unfiltered and unsorted: the class's default schedule
 * (what picking the category opens) and one with every field — every core field and every
 * property and quantity IfcOpenShell finds on that class. For each, the row count and the
 * GlobalIds are the class's own, and for every row and every column:
 *
 *  · the raw value (the engine's own `resolveField`, which `runSchedule` formats) equals the
 *    IfcOpenShell value after the documented conversion (`wantScalar`) — floats at a relative
 *    tolerance of `REL_TOL`, nothing else tolerant;
 *  · the displayed text equals the IfcOpenShell value formatted by this file's own formatter
 *    (`expectedText`), from the column's unit, decimals and flags — never the app's formatter.
 *
 * The documented conversions, each written out here:
 *  · a length, area, volume or plane angle: × IfcOpenShell's `calculate_unit_scale`;
 *  · a mass: × `calculate_unit_scale` ÷ 1 000 — IfcOpenShell scales mass against the gram, which
 *    is IFC's SI unit for it, and the schedule holds kilograms (`adapter.ts`, `scalesOf`);
 *  · a measure in a derived unit the project assigns: × that unit's SI scale, with no unit kind
 *    (IfcOpenShell's scale counts a mass element in grams, the app in kilograms; none of the
 *    three models has a derived unit with mass in it — `container-units.test.ts` pins the app's);
 *  · a count: as written, kind `count`; anything else (a ratio, a label) as written;
 *  · a list, or an enumeration of more than one value: text — the values as written, ', '-joined,
 *    with no unit conversion (ifcTable's `toCell`); an enumeration of one: that value;
 *  · a bounded value: one field per stated bound, `Prop.LowerBound`, `Prop.UpperBound`,
 *    `Prop.SetPoint`, each converted as a single value;
 *  · a blank label: no value; a placeholder ('-', 'n/a'): the text itself.
 *
 * What this file takes from the app, and why: the column definitions (`defaultColumnsFor`,
 * `columnForCore`, `columnForProp`) — they are the schedule being checked, the input, and the
 * expected text is computed from what they say (unit, decimals); and the documented reading of
 * a core field the index defines (`adapter.ts`'s header: Family / Type split on the first ':',
 * the type's Name before the occurrence's ObjectType, a storey's `Name || LongName`, a
 * building's, site's and space's `LongName || Name`). The discipline is not IFC data: it is
 * checked against this file's own table for the classes the fixtures hold.
 *
 * Where the app and IfcOpenShell disagree, the cell is listed in `KNOWN_DIFFERENCES` with both
 * values — and the test requires each listed difference still to be there, so a fix fails it
 * until its line is taken out.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import { createReadOnlyIfcSource } from '../../../src/worker/ifc-source'
import { buildModelIndex } from '../../../src/worker/index-builder'
import { snapshotOf } from '../../../src/schedule/adapter'
import { keysForEntity, StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store'
import type { Cell, UnitKind } from '../../../src/schedule/ifc/types'
import { columnForCore, columnForProp, defaultColumnsFor } from '../../../src/schedule/schedule/columns'
import { CORE_KEYS, emptySchedule, type Column, type CoreKey, type ScheduleDef } from '../../../src/schedule/schedule/def'
import { runSchedule, type DataRow } from '../../../src/schedule/schedule/engine'
import { resolveField } from '../../../src/schedule/schedule/resolve'

const FIXTURES = join(__dirname, '..', '..', 'fixtures')

/** The one tolerance: relative, on floats only. Text, booleans and integers compare exactly. */
const REL_TOL = 1e-9

/* ───────────────────────────── the truth file ───────────────────────────── */

type Scalar = string | number | boolean
interface TruthValue {
  /** As written. A list or an enumeration is an array; a bounded value is {bound: value}. */
  v: Scalar | Scalar[] | Record<string, number> | null
  /** The IFC measure type — per bound for a bounded value — or null. */
  m: string | Record<string, string> | null
  /** The property's class, when it is not `IfcPropertySingleValue` or a quantity. */
  p?: string
}
type TruthSets = Record<string, Record<string, TruthValue>>
interface Named {
  name: string
  longName: string
}
interface TruthStorey extends Named {
  /** `Elevation` × the length unit's scale, metres; null when not stated. */
  elevation: number | null
}
interface TruthElement {
  entity: string
  name: string
  description: string
  tag: string
  /** The occurrence's own `ObjectType` attribute. */
  objectType: string
  /** The type object's `Name`. */
  typeName: string
  predefinedType: string
  longName: string
  storey: string | null
  /** GlobalIds into `spatial`: the building, site and space above the element itself. */
  building: string | null
  site: string | null
  space: string | null
  materials: string[]
  psets: TruthSets
  qtos: TruthSets
}
interface Truth {
  generatedBy: string
  file: string
  sha256: string
  unitScales: Record<string, number>
  derivedScales: Record<string, number>
  measureUnitTypes: Record<string, string | null>
  storeys: Record<string, TruthStorey>
  spatial: Record<string, Named>
  elements: Record<string, TruthElement>
}

/* ─────────────── the expected values, computed here from the truth ─────────────── */

/** Unit types whose scale `calculate_unit_scale` read from the file, and the kind each is. */
const SCALED: Record<string, UnitKind> = {
  LENGTHUNIT: 'length',
  AREAUNIT: 'area',
  VOLUMEUNIT: 'volume',
  PLANEANGLEUNIT: 'angle'
}

/** The discipline of each class the fixtures hold — ARC / STR as a coordinator reads them. */
const DISCIPLINE: Record<string, string> = {
  IfcBeam: 'STR',
  IfcColumn: 'STR',
  IfcDiscreteAccessory: 'OTHER',
  IfcFooting: 'STR',
  IfcSlab: 'STR',
  IfcDoor: 'ARC',
  IfcFurniture: 'ARC',
  IfcSpace: 'ARC',
  IfcWall: 'ARC',
  IfcWindow: 'ARC'
}

/** What a display unit is in SI — physical constants, written out here. */
const SI_PER_UNIT: Record<string, Record<string, number>> = {
  length: { mm: 1e-3, cm: 1e-2, m: 1, km: 1e3, in: 0.0254, ft: 0.3048 },
  area: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1, 'ft²': 0.3048 ** 2, ha: 1e4 },
  volume: { 'mm³': 1e-9, 'cm³': 1e-6, L: 1e-3, 'm³': 1, 'ft³': 0.3048 ** 3 },
  angle: { rad: 1, '°': Math.PI / 180 },
  mass: { g: 1e-3, kg: 1, t: 1e3, lb: 0.45359237 }
}

/**
 * Where the app and IfcOpenShell disagree — `<model> <GlobalId> <field>` → why. Each is a
 * finding, reported and not fixed here; each must still disagree, or the test asks for its line
 * to be removed.
 */
const KNOWN_DIFFERENCES: Record<string, string> = {
  // None. The three found on edge.ifc (2026-11-08) were fixed for 1.5.0: a derived unit is
  // converted to SI (`index-builder.ts` `derivedFactor`, `adapter.ts` `derivedOf`), and
  // Building, Site and Room / Space come from the element's own spatial container
  // (`IfcElement.container`), whatever level it is contained at.
}

/** A cell as the schedule should hold it: undefined = no value. */
type Want = { v: Scalar; k?: UnitKind } | undefined

const text = (s: string): Want => (s === '' ? undefined : { v: s })
const label = (n: Named | undefined): string => (n ? n.longName || n.name : '')

/** The type's Name before the occurrence's ObjectType — `adapter.ts`'s documented source. */
const fullType = (e: TruthElement): string => e.typeName || e.objectType

function wantCore(t: Truth, e: TruthElement, key: CoreKey, guid: string, model: string): Want {
  const storey = e.storey ? t.storeys[e.storey] : undefined
  const type = fullType(e)
  const colon = type.indexOf(':')
  switch (key) {
    case 'entity':
      return text(e.entity)
    case 'name':
      return text(e.name)
    case 'description':
      return text(e.description)
    case 'mark':
      return text(e.tag)
    case 'objectType':
      return text(type)
    case 'family':
      return text(colon > 0 ? type.slice(0, colon) : '')
    case 'typeName':
      return text(colon > 0 ? type.slice(colon + 1) : type)
    case 'predefinedType':
      return text(e.predefinedType)
    case 'guid':
      return text(guid)
    case 'storey':
      return text(storey ? storey.name || storey.longName : '')
    case 'storeyElevation':
      return storey && storey.elevation !== null ? { v: storey.elevation, k: 'length' } : undefined
    case 'building':
      return text(label(e.building ? t.spatial[e.building] : undefined))
    case 'site':
      return text(label(e.site ? t.spatial[e.site] : undefined))
    case 'space':
      return text(e.entity === 'IfcSpace' ? e.longName || e.name : label(e.space ? t.spatial[e.space] : undefined))
    case 'material':
      return text([...new Set(e.materials.filter(Boolean))].join(', '))
    case 'discipline': {
      const d = DISCIPLINE[e.entity]
      if (!d) throw new Error(`oracle: no discipline written down for ${e.entity} — add it to DISCIPLINE`)
      return text(d)
    }
    case 'model':
      return text(model)
  }
}

/** One value and its measure type, converted as documented in the header. */
function wantScalar(t: Truth, v: Scalar, m: string | null): Want {
  if (typeof v === 'boolean') return { v }
  if (typeof v === 'string') return text(v)
  const unitType = m ? t.measureUnitTypes[m] : null
  if (unitType && SCALED[unitType]) return { v: v * t.unitScales[unitType], k: SCALED[unitType] }
  if (unitType === 'MASSUNIT') return { v: (v * t.unitScales.MASSUNIT) / 1000, k: 'mass' }
  if (unitType && t.derivedScales[unitType] !== undefined) return { v: v * t.derivedScales[unitType] }
  return m === 'IfcCountMeasure' ? { v, k: 'count' } : { v }
}

/** A value as written, as text: a yes / no as TRUE / FALSE, a number as JavaScript prints it. */
const asWritten = (v: Scalar): string => (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))

const BOUND_FIELD: Record<string, string> = {
  LowerBoundValue: 'LowerBound',
  UpperBoundValue: 'UpperBound',
  SetPointValue: 'SetPoint'
}

/** Every schedule field one element should carry — "Pset.Prop" → its value. */
function expectedFields(t: Truth, e: TruthElement): Map<string, { pset: string; prop: string; want: Want }> {
  const out = new Map<string, { pset: string; prop: string; want: Want }>()
  const put = (pset: string, prop: string, want: Want): void => {
    out.set(`${pset}.${prop}`, { pset, prop, want })
  }
  for (const sets of [e.psets, e.qtos]) {
    for (const [pset, props] of Object.entries(sets)) {
      for (const [prop, value] of Object.entries(props)) {
        const { v, m, p } = value
        if (p === 'IfcPropertyBoundedValue') {
          const bounds = v as Record<string, number>
          const measures = m as Record<string, string>
          for (const [bound, n] of Object.entries(bounds)) put(pset, `${prop}.${BOUND_FIELD[bound]}`, wantScalar(t, n, measures[bound]))
        } else if (Array.isArray(v)) {
          if (p !== 'IfcPropertyListValue' && p !== 'IfcPropertyEnumeratedValue') {
            throw new Error(`oracle: an array from a ${p ?? 'single value'}: ${pset}.${prop}`)
          }
          if (p === 'IfcPropertyEnumeratedValue' && v.length === 1) put(pset, prop, wantScalar(t, v[0], m as string | null))
          else put(pset, prop, text(v.map(asWritten).filter(Boolean).join(', ')))
        } else if (v === null) {
          put(pset, prop, undefined)
        } else if (typeof v === 'object') {
          throw new Error(`oracle: no rule for ${pset}.${prop}: ${JSON.stringify(value)}`)
        } else {
          put(pset, prop, wantScalar(t, v, m as string | null))
        }
      }
    }
  }
  return out
}

/** The two values agree: exactly, or within `REL_TOL` for two numbers. */
function same(got: Cell | undefined, want: Want): boolean {
  if (got === undefined || want === undefined) return got === want
  if ((got.k ?? undefined) !== (want.k ?? undefined)) return false
  if (typeof got.v === 'number' && typeof want.v === 'number') {
    if (got.v === want.v) return true
    return Math.abs(got.v - want.v) <= REL_TOL * Math.max(Math.abs(got.v), Math.abs(want.v))
  }
  return got.v === want.v
}

/** Thousands groups of three, on the integer part only. */
function grouped(fixed: string): string {
  const [int, dec] = fixed.split('.')
  const neg = int.startsWith('-')
  const digits = neg ? int.slice(1) : int
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return (neg ? '-' : '') + out + (dec !== undefined ? '.' + dec : '')
}

/**
 * The text a column shows for a value — written from the column's own format: the value in its
 * display unit, rounded to its decimals, a negative zero shown as zero, grouped unless the
 * column says not to, then its symbol and affixes; a yes / no as Yes / No.
 */
function expectedText(want: Want, col: Column): string {
  if (want === undefined) return ''
  const f = col.format ?? {}
  if (typeof want.v === 'boolean') {
    if (f.boolStyle && f.boolStyle !== 'Yes/No') throw new Error('oracle: only Yes/No is written down here')
    return want.v ? 'Yes' : 'No'
  }
  if (typeof want.v === 'string') return (f.prefix ?? '') + want.v + (f.suffix ?? '')
  if (f.decimals === undefined) throw new Error(`oracle: a numeric column with no decimals: ${JSON.stringify(col.field)}`)
  let value = want.v
  if (want.k && want.k !== 'count' && want.k !== 'none') {
    const per = SI_PER_UNIT[want.k]?.[f.display ?? '']
    if (per === undefined) throw new Error(`oracle: no display unit "${f.display}" for ${want.k}`)
    value = value / per
  }
  if (f.suppressZero && value === 0) return ''
  let s = value.toFixed(f.decimals)
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1)
  if (f.thousands !== false) s = grouped(s)
  if (f.showSymbol && f.display) s += ` ${f.display}`
  return (f.prefix ?? '') + s + (f.suffix ?? '')
}

/* ───────────────────────────── the app's side ───────────────────────────── */

interface Built {
  stem: string
  truth: Truth
  store: ModelStore
  /** Store row → the GlobalId of the federation element `rowIds` names. */
  rowGuid: (row: number) => string | undefined
  label: string
}

async function build(stem: string, label: string): Promise<Built> {
  const bytes = readFileSync(join(FIXTURES, `${stem}.ifc`))
  const truth = JSON.parse(readFileSync(join(FIXTURES, `${stem}.cells.json`), 'utf8')) as Truth
  const src = await createReadOnlyIfcSource()
  const modelID = src.openFromBuffer(new Uint8Array(bytes))
  const index = buildModelIndex(src, modelID, { modelKey: stem, fileName: `${stem}.ifc`, sha256: '' })
  src.close(modelID)
  src.dispose()
  const fed = federate([index])
  const snap = snapshotOf(fed, { [stem]: label })
  const b = new StoreBuilder()
  b.add(snap.cores, snap.cells)
  return {
    stem,
    truth,
    store: b.finish(snap.meta),
    rowGuid: (row) => fed.byId.get(snap.rowIds[row])?.guid,
    label
  }
}

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

interface Tally {
  cells: number
  mismatches: string[]
  /** Known differences seen, `<model> <GlobalId> <field>` → both values. */
  known: Map<string, string>
}

/** Run one schedule and hold every cell of every row against the truth. */
function check(b: Built, cls: string, def: ScheduleDef, guids: string[], tally: Tally, what: string): void {
  const { truth, store } = b
  const result = runSchedule(store, def, { cap: Infinity })
  const rows = result.rows.filter((r): r is DataRow => r.kind === 'data')
  const fail = (msg: string): void => {
    tally.mismatches.push(`${b.stem} ${what} ${cls}: ${msg}`)
  }
  if (result.columns.length !== def.columns.length) fail(`${result.columns.length} visible columns of ${def.columns.length}`)
  if (rows.length !== guids.length) fail(`${rows.length} rows, IfcOpenShell has ${guids.length}`)

  const seen = new Set<string>()
  for (const line of rows) {
    if (line.rows.length !== 1) {
      fail(`an itemised line covers ${line.rows.length} elements`)
      continue
    }
    const row = line.rows[0]
    const guid = store.cores[row].guid
    if (b.rowGuid(row) !== guid) fail(`row ${row} names ${guid} but maps to ${b.rowGuid(row)}`)
    const e = truth.elements[guid]
    if (!e) {
      fail(`row ${row}: ${guid} is not an element IfcOpenShell indexes`)
      continue
    }
    if (e.entity !== cls) fail(`${guid} is a ${e.entity}, scheduled under ${cls}`)
    if (seen.has(guid)) fail(`${guid} appears twice`)
    seen.add(guid)

    const fields = expectedFields(truth, e)
    result.columns.forEach((col, i) => {
      const f = col.field
      if (f.kind === 'formula') throw new Error('oracle: no formula columns here')
      const want =
        f.kind === 'core' ? wantCore(truth, e, f.key, guid, b.label) : fields.get(`${f.pset}.${f.prop}`)?.want
      const got = resolveField(store, row, f)
      const field = f.kind === 'core' ? f.key : `${f.pset}.${f.prop}`
      tally.cells++
      const known = `${b.stem} ${guid} ${field}`
      if (!same(got, want)) {
        if (known in KNOWN_DIFFERENCES) tally.known.set(known, `app ${JSON.stringify(got)}, IfcOpenShell ${JSON.stringify(want)}`)
        else fail(`${guid} ${field}: app ${JSON.stringify(got)}, IfcOpenShell ${JSON.stringify(want)}`)
        return
      }
      const shown = expectedText(want, col)
      if (line.cells[i] !== shown) fail(`${guid} ${field}: shows "${line.cells[i]}", expected "${shown}"`)
    })
  }
  for (const guid of guids) if (!seen.has(guid)) fail(`${guid} is missing from the schedule`)
}

/* ─────────────────────────────── the tests ─────────────────────────────── */

const FIXTURE_SET = [
  { stem: 'reference', label: 'Reference model', system: 'metric' },
  { stem: 'feet', label: 'Feet model', system: 'imperial' },
  { stem: 'edge', label: 'Edge model', system: 'metric' }
] as const

const knownSeen = new Map<string, string>()

for (const { stem, label, system } of FIXTURE_SET) {
  describe(`${stem}.ifc — every schedule cell against IfcOpenShell`, () => {
    const ready = build(stem, label)

    it('reads the truth written for this very file', async () => {
      const { truth, store } = await ready
      expect(truth.sha256).toBe(sha256(join(FIXTURES, `${stem}.ifc`)))
      expect(truth.generatedBy).toMatch(/^IfcOpenShell /)
      expect(store.meta.unitSystem).toBe(system)
    })

    it('has one row per element of each class, and the classes IfcOpenShell finds', async () => {
      const { truth, store } = await ready
      const byClass = new Map<string, number>()
      for (const e of Object.values(truth.elements)) byClass.set(e.entity, (byClass.get(e.entity) ?? 0) + 1)
      expect(new Map(store.entities.map((x) => [x.entity, x.count]))).toEqual(byClass)
      expect(store.cores.length).toBe(Object.keys(truth.elements).length)
    })

    it('offers, per class, exactly the properties and quantities IfcOpenShell finds', async () => {
      const { truth, store } = await ready
      const classes = [...new Set(Object.values(truth.elements).map((e) => e.entity))].sort()
      for (const cls of classes) {
        const want = new Set<string>()
        for (const e of Object.values(truth.elements)) {
          if (e.entity !== cls) continue
          for (const [key, { want: w }] of expectedFields(truth, e)) if (w !== undefined) want.add(key)
        }
        const got = new Set(keysForEntity(store, [cls]).map((s) => s.key))
        expect([...got].sort(), cls).toEqual([...want].sort())
      }
    })

    it('holds every cell of the default and the every-field schedule of each class', async () => {
      const b = await ready
      const { truth, store } = b
      const classes = [...new Set(Object.values(truth.elements).map((e) => e.entity))].sort()
      const tally: Tally = { cells: 0, mismatches: [], known: knownSeen }
      let elements = 0
      for (const cls of classes) {
        const guids = Object.entries(truth.elements)
          .filter(([, e]) => e.entity === cls)
          .map(([g]) => g)
        elements += guids.length
        const name = `${cls.replace(/^Ifc/, '')} Schedule`

        // What picking the category opens (`schedule-ui/events.ts`).
        const byDefault: ScheduleDef = { ...emptySchedule(name, [cls]), columns: defaultColumnsFor(store, [cls]) }
        check(b, cls, byDefault, guids, tally, 'default')

        // Every core field, then every property and quantity IfcOpenShell finds on the class.
        const keys = new Map<string, { pset: string; prop: string }>()
        for (const g of guids) for (const [key, { pset, prop }] of expectedFields(truth, truth.elements[g])) keys.set(key, { pset, prop })
        const columns: Column[] = CORE_KEYS.map((k) => columnForCore(k, store.meta.unitSystem))
        for (const key of [...keys.keys()].sort()) {
          const stat = store.propCatalog.get(key)
          const { pset, prop } = keys.get(key)!
          columns.push(stat ? columnForProp(stat, store.meta.unitSystem) : { field: { kind: 'prop', pset, prop } })
        }
        const everything: ScheduleDef = { ...emptySchedule(name, [cls]), columns, itemize: true }
        check(b, cls, everything, guids, tally, 'every field')
      }

      process.stderr.write(
        `[schedule oracle] ${stem}.ifc: ${classes.length} classes, ${elements} elements, ` +
          `${tally.cells} cells checked, ${tally.mismatches.length} mismatches\n`
      )
      expect(tally.cells).toBeGreaterThan(0)
      expect({ mismatches: tally.mismatches.length, first: tally.mismatches.slice(0, 40) }).toEqual({
        mismatches: 0,
        first: []
      })
      // Each known difference of this model must still be one — a fixed one comes off the list.
      const known = Object.keys(KNOWN_DIFFERENCES).filter((k) => k.startsWith(`${stem} `))
      for (const k of known) if (knownSeen.has(k)) process.stderr.write(`[schedule oracle] known: ${k}: ${knownSeen.get(k)}\n`)
      expect(known.filter((k) => !knownSeen.has(k)), 'no longer differ').toEqual([])
    })
  })
}
