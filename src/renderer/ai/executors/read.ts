/**
 * The tools that report what is there — the design's four (`summarize_elements`,
 * `audit_model`, `clash_check`, `query_elements`) and the plan's ten read-only additions.
 *
 * None of them touches the store. They read the **frozen** index, the SQL worker and the
 * view state, and return JSON: real counts, per-group counts, capped samples with
 * `truncated`, and `valid_values` whenever nothing matched, so a wrong guess costs the model
 * one round rather than a sentence of apology.
 *
 * Provenance — which entity a value came from, where georeferencing was read, the file's
 * SHA-256 — reaches the user only through here and through the exports. It is never new UI
 * (the fidelity contract's "no visible additions").
 *
 * 2026-10-02 — `get_view_state` reads back everything the assistant can set (the display
 * switches, both section planes, the undo history's two flags, each model's eye, colour and
 * active state, the interface), in full; the per-turn view state names the same things only
 * while they are off their defaults. The rule and the reasons are on the executor, below.
 */
import { ID_STRIDE, orderGrids, type FederatedElement } from '../../../shared/federate'
import { ATTR_KEYS, attr } from '../../../shared/attr'
import { rankKeys } from '../../../shared/prop-names'
import { displayState, sectionPlanes, viewStateCore } from '../../../shared/ai-schema'
import { corenetReadout } from '../../../shared/corenet'
import {
  coordsFromGeoref,
  isIdentityMapConversion,
  mapPlacement,
  toMap,
  type PlacedBy
} from '../../../shared/georef'
import { visFn, type Rule } from '../../../shared/rules'
import { measureKind, unitLabel, type UnitKind } from '../../../shared/units'
import type { ShellState } from '../../state/shell'
import type { Georeference, SpatialNode, Units } from '../../../shared/model-index.types'
import {
  METRICS,
  auditModel,
  clashPairs,
  nearbyElements,
  summarize,
  type Metric,
  type SummaryMeasures,
  type SummaryRow
} from '../analysis'
import { modelLabel } from '../../state/selectors/models'
import { basePointSource, notLinedUp, type NotLinedUp } from '../../state/selectors/status'
import { cameraNow, groupCounts } from './view'
import { carriedInFederation, topOf, valueHints } from './names'
import { scheduleBriefOf } from './schedule'
import { interfaceState } from './interface'
import { viewpointsState } from './saved'
import {
  CLASH_ROW_CAP,
  QUERY_SAMPLE_CAP,
  SAMPLE_CAP,
  brief,
  capped,
  chatMatch,
  labelText,
  notLoaded,
  validValues,
  type Executor
} from './context'

/** A map unit's name is file text; past this it is clipped, like every other name in a result. */
export const MAP_UNIT_NAME_CHARS = 60

/**
 * 2026-10-08 — how one model was put into the federation's map space, for `get_model_info`:
 * the declaration that placed it (`IfcMapConversion`, `ePset_MapConversion`,
 * `WorldCoordinateSystem` — rule 4, where Revit writes the map position with no EPSG code —
 * `site placement` — its world coordinates are its map coordinates — or `none`); the unit its
 * Eastings, Northings and height were read in, with `assumedMetre` when the file names none or one
 * that is not a length this knows; that `Scale`, reported beside it as written, was not applied;
 * the context's `WorldCoordinateSystem` when it is not the identity and how it was read; the turn
 * `TrueNorth` put into the placement, if any; and `ambiguous` when a map conversion and a
 * `WorldCoordinateSystem` that is not the identity stand together, which IFC leaves open.
 */
function placementReadout(georef: Georeference): {
  placedBy: PlacedBy
  mapUnit: { name: string | null; metresPerUnit: number; assumedMetre: boolean }
  scaleApplied: false
  worldCoordinateSystem: { originMetres: readonly number[]; rotationDeg: number; readAs: string } | null
  trueNorthAppliedDeg: number | null
  ambiguous: string | null
} {
  const p = mapPlacement(georef)
  return {
    placedBy: p.placedBy,
    mapUnit: {
      name: p.mapUnit === null ? null : labelText(p.mapUnit, MAP_UNIT_NAME_CHARS),
      metresPerUnit: p.metresPerMapUnit,
      assumedMetre: p.mapUnit === null || !p.mapUnitKnown
    },
    scaleApplied: false,
    worldCoordinateSystem: p.wcs
      ? { originMetres: [...p.wcs.origin], rotationDeg: p.wcs.rotationDeg, readAs: p.wcs.readAs }
      : null,
    trueNorthAppliedDeg: p.trueNorthDeg,
    ambiguous: p.ambiguous
      ? 'The file states a map conversion and a WorldCoordinateSystem that is not the identity. IFC leaves that pair ambiguous; the WorldCoordinateSystem was undone before the conversion, as IfcOpenShell reads it.'
      : null
  }
}

const asRules = (v: unknown): Rule[] => (Array.isArray(v) ? (v as Rule[]) : [])

/** `id` or `guid` → the one element, or the sentence that says why not. */
function findElement(
  s: ShellState,
  input: Record<string, unknown>
): { el: FederatedElement } | { error: string } {
  if (typeof input.id === 'number') {
    const el = s.byId.get(input.id)
    return el ? { el } : { error: `No element with id ${input.id}.` }
  }
  if (typeof input.guid === 'string' && input.guid) {
    const el = s.federation.elements.find((e) => e.guid === input.guid)
    return el ? { el } : { error: `No element with GlobalId ${input.guid}.` }
  }
  return { error: 'Pass either id or guid.' }
}

const slotOf = (s: ShellState, key: string): number =>
  s.federation.models.find((m) => m.meta.modelKey === key)?.slot ?? 0

/**
 * What one element's box says, for the tools that report it.
 *
 * Project-frame metres, Z-up, exactly as `IfcElement.bbox` is declared — so `size.z` is
 * height and `size.x` / `size.y` are the building's own axes. The centre is put through the
 * federation's base point with the design's own `toMap`, which is the same expression the
 * property card's Centroid row and the spot labels use, so a georeferenced model reports one
 * set of map coordinates and not two. `null` when the file states no base point.
 *
 * Every name here carries `box`, because that is what it is: the union of the element's placed
 * part boxes, never smaller than the solid and larger for a rotated one.
 */
function boxReport(
  s: ShellState,
  bbox: readonly [number, number, number, number, number, number]
): Record<string, unknown> {
  const [x0, y0, z0, x1, y1, z1] = bbox
  const centre: [number, number, number] = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
  const size = { x: x1 - x0, y: y1 - y0, z: z1 - z0 }
  return {
    bboxMetres: bbox,
    bboxFrame: 'project',
    boxSizeMetres: size,
    boxVolumeM3: size.x * size.y * size.z,
    boxCentreMetres: { x: centre[0], y: centre[1], z: centre[2] },
    boxCentreMap: toMap(s.coords, centre[0], centre[1], centre[2]),
    boxMethod:
      'axis-aligned bounding box in the project frame — the union of the element’s placed part boxes, not solid geometry'
  }
}

/** An expressId inside one file, as the federation id every other tool speaks. */
const fedId = (s: ShellState, modelKey: string, expressId: number): number =>
  slotOf(s, modelKey) * ID_STRIDE + expressId

/* ────────────────────────────── the design's four ────────────────────────────── */

/**
 * The unit each total is in, taken from the file rather than assumed (2026-09-20).
 *
 * Two things have to line up for a label to be honest. The **measure type** says which unit
 * kind the quantity is (`IFCAREAMEASURE` → area), and the **model's own unit assignment** says
 * what that kind is written in — and on a Revit export those are routinely different per kind:
 * this repository's reference file authors `Length` in millimetres and `GrossArea` in square
 * metres. A total summed across two models whose assignments disagree gets **no** label, which
 * is the only truthful answer; nothing is ever converted.
 */
function totalUnits(
  s: ShellState,
  els: readonly FederatedElement[],
  measures: SummaryMeasures,
  rows: readonly SummaryRow[]
): { units: Partial<Record<Metric, string>>; mixed: Metric[] } {
  const models = new Set(els.map((e) => e.model))
  const unitsOf: Units[] = s.federation.models
    .filter((m) => models.has(m.meta.modelKey))
    .map((m) => m.meta.units)
  const units: Partial<Record<Metric, string>> = {}
  const mixed: Metric[] = []
  for (const metric of METRICS) {
    // A metric nothing contributed to has no unit to name.
    if (!rows.some((r) => r.from[metric] > 0)) continue
    /**
     * `QK` says what kind each metric is — `GrossArea` is an area whatever else is true — and
     * the file's stated measure type is the cross-check. When the two disagree, or the file
     * states two different kinds for one metric, nothing is labelled: a wrong unit is worse
     * than none. When the file states no measure type at all (many do not), `QK` stands.
     */
    const stated = new Set(measures[metric].map((x) => measureKind(x)).filter(Boolean))
    if (stated.size > 1 || (stated.size === 1 && [...stated][0] !== metric)) {
      mixed.push(metric)
      continue
    }
    const labels = new Set(unitsOf.map((u) => unitLabel(u, metric as UnitKind)))
    if (labels.size === 1 && !labels.has(null)) units[metric] = [...labels][0] as string
    else mixed.push(metric)
  }
  return { units, mixed }
}

export const summarize_elements: Executor = (input, ctx) => {
  const s = ctx.state()
  const groupBy = String(input.groupBy ?? '')
  const rules = asRules(input.rules)
  // The design's fallback: with no rules, summarise **what is visible**, not the whole model.
  const els = rules.length
    ? chatMatch(s.federation.elements, rules)
    : s.federation.elements.filter(visFn(s))
  if (!els.length) {
    const hint = valueHints(rules, s)
    return {
      forModel: {
        message: `No elements match.${hint.text ? ' ' + hint.text : ''}`,
        matched: 0,
        ...(hint.topValues ? { valid_values: { topValues: hint.topValues } } : {})
      }
    }
  }

  const { rows, measures } = summarize(els, groupBy)
  if (rows.length === 1 && rows[0].k === '—') {
    // A name that is not a key at all gets its nearest keys from `executeTool` (`names.ts`);
    // a real key these elements happen not to carry says where it is carried instead.
    const elsewhere = carriedInFederation(s, groupBy)
    return {
      forModel: {
        message:
          `None of those ${els.length} elements carry "${groupBy}".` +
          (elsewhere ? ` ${elsewhere} elements elsewhere in the federation do.` : ''),
        matched: els.length,
        ...(elsewhere ? { carriedInFederation: elsewhere } : {})
      }
    }
  }
  const { units, mixed } = totalUnits(s, els, measures, rows)
  const head = rows.slice(0, 8)
  const shown = capped(rows, 50)
  // The design's sentence (`:1445`), with two corrections it cannot make for itself: the unit
  // is the file's own rather than a literal `m²`, and a total that covers only part of a group
  // says so instead of reading as the group's total.
  const areaText = (r: (typeof rows)[number]): string => {
    if (!r.area) return ''
    const unit = units.area ? ` ${units.area}` : ''
    const part = r.from.area < r.n ? ` from ${r.from.area} of ${r.n}` : ''
    return ` (${r.area.toFixed(1)}${unit}${part})`
  }
  const partial = rows.some((r) => (r.area && r.from.area < r.n) || (r.volume && r.from.volume < r.n))
  return {
    forModel: {
      message:
        `${els.length} elements in ${rows.length} groups by ${groupBy}: ` +
        head.map((r) => `${r.k} ${r.n}${areaText(r)}`).join(', ') +
        (partial ? ' Totals cover only the elements that carry the quantity — see areaFrom / volumeFrom.' : '') +
        (mixed.length ? ` No unit is stated for ${mixed.join(', ')}: the file's own unit for it is not one measure.` : ''),
      matched: els.length,
      groupBy,
      /**
       * The unit each total is in, **as the file writes it** — `m²`, `mm`, `ft`. A metric whose
       * unit could not be settled is absent rather than guessed, and nothing is converted.
       */
      units,
      measuresSummed: measures,
      groups: shown.items.map((r) => ({
        value: r.k,
        count: r.n,
        area: r.area,
        volume: r.volume,
        length: r.length,
        /** How many of `count` carried each quantity. Below `count`, the total is partial. */
        areaFrom: r.from.area,
        volumeFrom: r.from.volume,
        lengthFrom: r.from.length
      })),
      totalGroups: shown.total,
      truncated: shown.truncated
    },
    ui: {
      table: {
        groupBy,
        rows: rows.map((r) => ({ k: r.k, n: r.n, area: r.area, volume: r.volume, ids: r.ids })),
        // 2026-10-09: the panel labels each total in the file's own unit, as the reply does.
        units: {
          ...(units.area ? { area: units.area } : {}),
          ...(units.volume ? { volume: units.volume } : {})
        }
      }
    }
  }
}

export const audit_model: Executor = (_input, ctx) => {
  const s = ctx.state()
  const findings = auditModel(s.federation.elements, s.federation.storeys)
  if (!findings.length) {
    return { forModel: { message: 'No data-completeness issues found.', findings: [] } }
  }
  return {
    forModel: {
      message: findings.map((x) => `${x.label}: ${x.n}${x.note ? ` — ${x.note}` : ''}`).join('; '),
      findings: findings.map((x) => ({ label: x.label, count: x.n, note: x.note }))
    },
    ui: { chips: findings.map((x) => ({ label: `${x.label} (${x.n})`, ids: x.ids })).filter((c) => c.ids.length) }
  }
}

export const clash_check: Executor = (input, ctx) => {
  const s = ctx.state()
  const modelA = String(input.modelA ?? '')
  const modelB = String(input.modelB ?? '')
  const tolerance = typeof input.tolerance === 'number' ? input.tolerance : 0
  const ld = s.loaded
  if (!ld.includes(modelA) || !ld.includes(modelB)) {
    return {
      forModel: {
        message: `Both models must be loaded. Loaded: ${ld.join(', ')}`,
        valid_values: [...ld]
      }
    }
  }
  if (modelA === modelB) return { forModel: { message: 'Pick two different models.' } }

  const { pairs, capped: wasCapped } = clashPairs(
    s.federation.elements,
    visFn(s),
    modelA,
    modelB,
    tolerance
  )
  if (!pairs.length) {
    return {
      forModel: {
        message: `No bounding-box interference between ${modelA} and ${modelB}${tolerance ? ` above ${tolerance} m` : ''}.`,
        candidates: 0
      }
    }
  }
  const rows = pairs.slice(0, CLASH_ROW_CAP)
  return {
    forModel: {
      message: `${pairs.length} bbox interference candidates between ${modelA} and ${modelB}${wasCapped ? ' (test capped)' : ''}. Largest: ${pairs
        .slice(0, 3)
        .map((p) => `${p.a.name} × ${p.b.name} (${p.vol.toFixed(3)} m³)`)
        .join('; ')}. These are candidates for review, not confirmed solid clashes.`,
      candidates: pairs.length,
      capped: wasCapped,
      method:
        'axis-aligned bounding boxes in the project frame, not solid geometry — candidates for review',
      frame: 'project',
      pairs: rows.map((p) => ({
        a: { id: p.a.id, name: p.a.name, type: p.a.type },
        b: { id: p.b.id, name: p.b.name, type: p.b.type },
        overlapVolumeM3: p.vol
      })),
      truncated: pairs.length > CLASH_ROW_CAP
    },
    ui: {
      table: {
        groupBy: 'Clash candidates',
        clash: true,
        rows: rows.map((p) => ({
          k: `${p.a.name} × ${p.b.name}`,
          n: 1,
          vol: p.vol,
          ids: [p.a.id, p.b.id]
        }))
      },
      chips: [
        {
          label: `All ${pairs.length} involved`,
          ids: [...new Set(pairs.flatMap((p) => [p.a.id, p.b.id]))]
        }
      ]
    }
  }
}

export const query_elements: Executor = (input, ctx) => {
  const s = ctx.state()
  const rules = asRules(input.rules)
  const hit = chatMatch(s.federation.elements, rules)
  const per = groupCounts(s, rules)
  const perText = per.map((g) => `${g.label}: ${g.n}`).join(', ')
  if (!hit.length) {
    // 2026-09-28: the key's own values when a value matched nothing; a name that is not a key
    // gets its nearest keys from `executeTool`, in place of the first forty in file order.
    const hint = valueHints(rules, s)
    return {
      forModel: {
        message: `No elements match. Per group — ${perText}. ${hint.text ? hint.text + ' ' : ''}Check the schema for the right entity or predefined type.`,
        matched: 0,
        groups: per,
        valid_values: {
          entities: validValues([...new Set(s.federation.elements.map((e) => e.type))].sort()),
          ...(hint.topValues ? { topValues: hint.topValues } : {})
        }
      }
    }
  }
  const samples = hit.slice(0, QUERY_SAMPLE_CAP)
  return {
    forModel: {
      message: `${hit.length} match (${perText}). Examples: ${samples
        .map((e) => `${e.name} (${e.type}/${e.predefinedType}, ${e.storey})`)
        .join('; ')}`,
      matched: hit.length,
      groups: per,
      samples: samples.map(brief)
    },
    ui: { chips: [{ label: `${hit.length} found`, ids: hit.map((e) => e.id) }] }
  }
}

/* ────────────────────────────── the additions ────────────────────────────── */

export const get_element: Executor = (input, ctx) => {
  const s = ctx.state()
  const found = findElement(s, input)
  if ('error' in found) return { forModel: { message: found.error } }
  const e = found.el
  return {
    forModel: {
      id: e.id,
      model: e.model,
      expressId: e.expressId,
      guid: e.guid,
      guidValid: e.guidValid,
      tag: e.tag,
      name: e.name,
      description: e.description,
      type: e.type,
      predefinedType: e.predefinedType,
      objectType: e.objectType,
      typeGuid: e.typeGuid,
      storey: e.storey,
      material: e.material,
      isSpace: !!e.isSpace,
      psets: e.psets,
      qto: e.qto,
      // Provenance: which STEP line each set came from, and whether it was inherited.
      psetMeta: e.psetMeta,
      materials: e.materials,
      classifications: e.classifications,
      systems: e.systems,
      decomposition: e.decomposition,
      /**
       * Project-frame metres, Z-up — the frame the scene is drawn in, offset not subtracted —
       * with its size, its centre and, where the file georeferences, the centre's map
       * coordinates. `null` throughout when the element has no geometry.
       */
      ...(e.bbox
        ? boxReport(s, e.bbox)
        : {
            bboxMetres: null,
            bboxFrame: 'project',
            boxSizeMetres: null,
            boxVolumeM3: null,
            boxCentreMetres: null,
            boxCentreMap: null
          }),
      /**
       * The tessellated parts the geometry stream produced for this element — the number the
       * property card's Geometry row shows — and what that is, because "solids" could be read
       * as the file's own representation items and it is not one.
       */
      solidCount: e.solidCount ?? null,
      ...(e.solidCount === undefined
        ? {}
        : {
            solidCountMethod:
              'tessellated parts of this element’s geometry, opaque and transparent together — not IFC representation items'
          })
    }
  }
}

export const get_entity_raw: Executor = async (input, ctx) => {
  const s = ctx.state()
  const keys = s.loaded
  let modelKey = typeof input.model === 'string' ? input.model : ''
  let expressId = typeof input.expressId === 'number' ? input.expressId : undefined

  if (typeof input.guid === 'string' && input.guid) {
    const el = s.federation.elements.find((e) => e.guid === input.guid)
    if (!el) return { forModel: { message: `No element with GlobalId ${input.guid}.` } }
    modelKey = el.model
    expressId = el.expressId
  }
  if (!modelKey) {
    if (keys.length === 1) modelKey = keys[0]
    else return { forModel: { message: `Name the model. Loaded: ${keys.join(', ')}`, valid_values: [...keys] } }
  }
  if (!keys.includes(modelKey)) {
    return notLoaded(modelKey, keys)
  }
  if (expressId === undefined) return { forModel: { message: 'Pass expressId or guid.' } }

  const line = await ctx.rawLine(modelKey, expressId)
  if (!line) return { forModel: { message: `No line #${expressId} in ${modelKey}.` } }
  return { forModel: { model: modelKey, ...line } }
}

export const list_values: Executor = (input, ctx) => {
  const s = ctx.state()
  const key = String(input.attr ?? '')
  const rules = asRules(input.rules)
  const pool = rules.length ? chatMatch(s.federation.elements, rules) : s.federation.elements
  const counts = new Map<string, number>()
  let carrying = 0
  for (const e of pool) {
    const v = attr(e, key)
    if (v === undefined || v === '') continue
    const text = String(v)
    carrying++
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  /**
   * How many elements were looked at, how many carry the property and how many do not
   * (2026-09-20).
   *
   * Without it the tool is misleading on exactly the property a reviewer cares about: asked for
   * `FireRating` over this repository's reference walls it answered "1 distinct value" with a
   * count of 547 and said nothing about the 2 767 walls that carry none. The distinct values
   * are the answer to "how is it spelled"; these three numbers are the answer to "is it there".
   */
  const coverage = { pool: pool.length, carrying, missing: pool.length - carrying }
  if (!counts.size) {
    // As `summarize_elements`: a name that is not a key gets its nearest keys from
    // `executeTool`; a real key outside the rules' scope says where it is carried.
    const elsewhere = rules.length ? carriedInFederation(s, key) : 0
    const hint = valueHints(pool.length ? [] : rules, s)
    return {
      forModel: {
        message:
          `Nothing carries "${key}" — 0 of ${pool.length} elements.` +
          (elsewhere ? ` ${elsewhere} elements outside the rules' scope do.` : '') +
          (hint.text ? ` ${hint.text}` : ''),
        attr: key,
        ...coverage,
        values: [],
        ...(elsewhere ? { carriedInFederation: elsewhere } : {}),
        ...(hint.topValues ? { valid_values: { topValues: hint.topValues } } : {})
      }
    }
  }
  const contains = typeof input.contains === 'string' ? input.contains.toLowerCase() : ''
  const all = [...counts.entries()]
    .filter(([v]) => !contains || v.toLowerCase().includes(contains))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? 50)) || 50, 1), 200)
  const offset = Math.max(Math.trunc(Number(input.offset ?? 0)) || 0, 0)
  const page = all.slice(offset, offset + limit)
  return {
    forModel: {
      message:
        `${all.length} distinct value${all.length === 1 ? '' : 's'} of ${key}${contains ? ` containing "${input.contains}"` : ''}. ` +
        `${carrying} of ${pool.length} element${pool.length === 1 ? '' : 's'} carry it; ${coverage.missing} do not.`,
      attr: key,
      ...coverage,
      values: page.map(([value, count]) => ({ value, count })),
      offset,
      limit,
      total: all.length,
      truncated: offset + page.length < all.length
    }
  }
}

/** Property names `find_properties` returns at most; `limit` defaults to 20. */
export const FIND_PROPERTIES_CAP = 50
const FIND_PROPERTIES_DEFAULT = 20
/** Values and property sets listed under each name, and names offered on spelling alone. */
export const FIND_PROPERTIES_HEAD = 5

type ValueKind = 'number' | 'text' | 'boolean'

/**
 * `find_properties` — 2026-09-28. The owner: *"it never check the shared parameters Includes As
 * GFA."* The assistant only knew the names the schema listed, and guessed the rest; this is the
 * search it lacked. It ranks **names**, never values (that is `search`), with the same ranking a
 * miss answers with (`shared/prop-names.ts`), over the names the scoped elements carry — the
 * seven attributes included — and reports, per name, the sets it sits in, how many elements
 * carry it, what kind of value it holds, its measure type and its commonest values.
 *
 * Two passes over the pool: which names are there at all (string work only), then the numbers
 * for the handful that were asked about. Bounded, and `truncated` says when anything was cut.
 */
export const find_properties: Executor = (input, ctx) => {
  const s = ctx.state()
  const text = String(input.text ?? '').trim()
  if (!text) return { forModel: { message: 'Pass some text to look for in the property names.' } }
  const asked = Math.trunc(Number(input.limit ?? FIND_PROPERTIES_DEFAULT)) || FIND_PROPERTIES_DEFAULT
  const limit = Math.min(Math.max(asked, 1), FIND_PROPERTIES_CAP)
  const rules = asRules(input.rules)
  const scoped = rules.length > 0
  const pool = scoped ? chatMatch(s.federation.elements, rules) : s.federation.elements
  if (!pool.length) {
    const hint = valueHints(rules, s)
    return {
      forModel: {
        message: `No elements match the rules, so there is nothing to search.${hint.text ? ' ' + hint.text : ''}`,
        pool: 0,
        total: 0,
        hits: [],
        truncated: false,
        ...(hint.topValues ? { valid_values: { topValues: hint.topValues } } : {})
      }
    }
  }
  const attrs = new Set<string>(ATTR_KEYS)

  // Pass 1 — every name the pool carries a value for, in the federation's own order.
  const present = new Set<string>()
  for (const e of pool) {
    for (const k of ATTR_KEYS) if (attr(e, k)) present.add(k)
    for (const ps of [e.psets, e.qto]) for (const set of Object.values(ps)) for (const k of Object.keys(set)) present.add(k)
  }
  const ranked = rankKeys(text, s.propKeys.filter((k) => present.has(k)))
  const alike = ranked.filter((r) => r.match !== 'spelling')
  const bySpelling = !alike.length
  const chosen = bySpelling ? ranked.slice(0, Math.min(limit, FIND_PROPERTIES_HEAD)) : alike.slice(0, limit)

  // Pass 2 — the numbers, for the chosen names only. A value is read the way `attr()` reads it
  // (attributes first, then the first set that has the key), so every count here is the count
  // a rule over that name would see; every set holding the name is still listed.
  interface Stat {
    carrying: number
    sets: Map<string, number>
    kinds: Set<ValueKind>
    measures: Set<string>
    values: Map<string, number>
  }
  const stats = new Map<string, Stat>(
    chosen.map((r) => [r.key, { carrying: 0, sets: new Map(), kinds: new Set(), measures: new Set(), values: new Map() }])
  )
  const take = (st: Stat, v: unknown, measure: string | undefined): void => {
    if (v === undefined || v === null || v === '') return
    st.carrying++
    st.kinds.add(typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'text')
    if (measure) st.measures.add(measure)
    const t = String(v)
    st.values.set(t, (st.values.get(t) ?? 0) + 1)
  }
  for (const e of pool) {
    for (const [k, st] of stats) if (attrs.has(k)) take(st, attr(e, k), undefined)
    const seen = new Set<string>()
    for (const ps of [e.psets, e.qto]) {
      for (const [setName, set] of Object.entries(ps)) {
        for (const [k, v] of Object.entries(set)) {
          const st = stats.get(k)
          if (!st || attrs.has(k)) continue
          st.sets.set(setName, (st.sets.get(setName) ?? 0) + 1)
          if (seen.has(k)) continue
          seen.add(k)
          take(st, v, e.psetMeta?.[setName]?.measures?.[k])
        }
      }
    }
  }

  const hits = chosen.map((r) => {
    const st = stats.get(r.key)!
    const top = topOf(st.values, FIND_PROPERTIES_HEAD)
    const sets = topOf(st.sets, FIND_PROPERTIES_HEAD)
    const kinds = [...st.kinds]
    return {
      key: r.key,
      match: r.match,
      ...(attrs.has(r.key) ? { attribute: true } : {}),
      elements: st.carrying,
      sets: sets.values.map((x) => x.value),
      setCount: sets.distinct,
      kind: kinds.length === 1 ? kinds[0] : kinds.length ? 'mixed' : 'none',
      ...(st.measures.size ? { measureTypes: [...st.measures].sort() } : {}),
      values: top.values,
      distinct: top.distinct,
      truncated: top.truncated || sets.truncated
    }
  })
  const total = bySpelling ? hits.length : alike.length
  // Out of scope, so a wrong scope cannot read as "the file has no such property".
  const elsewhere =
    scoped && bySpelling
      ? rankKeys(text, s.propKeys.filter((k) => !present.has(k)))
          .filter((r) => r.match !== 'spelling')
          .slice(0, FIND_PROPERTIES_HEAD)
          .map((r) => r.key)
      : []
  const where = scoped ? ` on the ${pool.length} element${pool.length === 1 ? '' : 's'} the rules match` : ''
  const head = hits
    .slice(0, FIND_PROPERTIES_HEAD)
    .map((h) => `${h.key} (${h.elements} element${h.elements === 1 ? '' : 's'}${h.sets.length ? ', ' + h.sets[0] : ''})`)
    .join('; ')
  return {
    forModel: {
      message:
        (bySpelling
          ? `No property name shares a word with "${text}"${where}. Nearest by spelling: ${head}.`
          : `${total} property name${total === 1 ? '' : 's'} like "${text}"${where}: ${head}${total > FIND_PROPERTIES_HEAD ? '; …' : ''}.`) +
        (elsewhere.length ? ` Outside that scope: ${elsewhere.join(', ')}.` : ''),
      text,
      pool: pool.length,
      namesSearched: present.size,
      total,
      hits,
      ...(elsewhere.length ? { outsideScope: elsewhere } : {}),
      truncated: total > hits.length || hits.some((h) => h.truncated)
    }
  }
}

export const search: Executor = (input, ctx) => {
  const s = ctx.state()
  const text = String(input.text ?? '').toLowerCase()
  if (!text) return { forModel: { message: 'Pass some text to search for.' } }
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? 25)) || 25, 1), 100)

  const hits: { el: FederatedElement; where: string }[] = []
  for (const e of s.federation.elements) {
    let where = ''
    if (e.name.toLowerCase().includes(text)) where = 'Name'
    else if (e.guid.toLowerCase() === text) where = 'GlobalId'
    else if (e.type.toLowerCase().includes(text)) where = 'IfcEntity'
    else if (e.objectType.toLowerCase().includes(text)) where = 'ObjectType'
    else if (e.tag && e.tag.toLowerCase().includes(text)) where = 'Tag'
    else {
      outer: for (const [setName, set] of Object.entries({ ...e.psets, ...e.qto })) {
        for (const [k, v] of Object.entries(set)) {
          if (String(v).toLowerCase().includes(text)) {
            where = `${setName}.${k}`
            break outer
          }
        }
      }
    }
    if (where) hits.push({ el: e, where })
  }
  if (!hits.length) {
    return { forModel: { message: `Nothing matches "${input.text}".`, matched: 0, matches: [] } }
  }
  const page = hits.slice(0, limit)
  return {
    forModel: {
      message: `${hits.length} element${hits.length === 1 ? '' : 's'} match "${input.text}".`,
      matched: hits.length,
      matches: page.map((h) => ({ ...brief(h.el), matchedIn: h.where })),
      truncated: hits.length > page.length
    },
    ui: { chips: [{ label: `${hits.length} found`, ids: hits.map((h) => h.el.id) }] }
  }
}

/** The whole `IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey` chain, and one spare. */
export const SPATIAL_DEPTH = 6

/**
 * The spatial tree, **bounded by default** (2026-09-20).
 *
 * A real building's tree is mostly `IfcSpace` leaves — 913 of 928 nodes on this repository's
 * reference model — and returning them unasked cost ~34 600 tokens, about five ordinary turns,
 * for a question usually answered by the twelve storeys above them. So the walk stops above the
 * spaces unless `spaces: true`, and at `depth` levels counting the root as 1.
 *
 * Nothing is hidden: **every** node reports `childCount`, the number of children the file gives
 * it, and `childrenOmitted` when the walk did not descend — so the model can see exactly what it
 * did not receive and ask for it. `truncated` is true whenever anything was left out.
 */
export const get_spatial_tree: Executor = (input, ctx) => {
  const s = ctx.state()
  const wanted = typeof input.model === 'string' ? input.model : null
  const withCounts = input.counts === true
  const withSpaces = input.spaces === true
  // `|| SPATIAL_DEPTH` would swallow a deliberate 0, which the schema says is treated as 1.
  const asked = Number(input.depth)
  const depth = Number.isFinite(asked) ? Math.max(1, Math.trunc(asked)) : SPATIAL_DEPTH
  const models = s.federation.models.filter((m) => !wanted || m.meta.modelKey === wanted)
  if (!models.length) return notLoaded(wanted, s.loaded)
  const countIn = (modelKey: string, storey: string): number =>
    s.federation.elements.filter((e) => e.model === modelKey && e.storey === storey).length

  let omitted = 0
  let emitted = 0
  /** Every node under `n`, including it — what an omitted subtree costs, counted honestly. */
  const subtreeSize = (n: SpatialNode): number =>
    1 + n.children.reduce((a, c) => a + subtreeSize(c), 0)

  const node = (modelKey: string, n: SpatialNode, level: number): unknown => {
    emitted++
    const kept = level < depth ? n.children.filter((c) => withSpaces || c.type !== 'IfcSpace') : []
    const dropped = n.children.filter((c) => !kept.includes(c))
    for (const c of dropped) omitted += subtreeSize(c)
    return {
      type: n.type,
      name: n.name,
      longName: n.longName || undefined,
      guid: n.guid,
      expressId: n.expressId,
      compositionType: n.compositionType,
      elevationMetres: n.elevation,
      ...(withCounts && n.type === 'IfcBuildingStorey'
        ? { elements: countIn(modelKey, n.name) }
        : {}),
      /** Children this node has in the file, whether or not they are listed below. */
      childCount: n.children.length,
      ...(dropped.length ? { childrenOmitted: dropped.length } : {}),
      children: kept.map((c) => node(modelKey, c, level + 1))
    }
  }

  const trees = models.map((m) => ({
    model: m.meta.modelKey,
    tree: m.meta.spatial ? node(m.meta.modelKey, m.meta.spatial, 1) : null
  }))

  return {
    forModel: {
      message:
        `Spatial structure of ${models.map((m) => m.meta.modelKey).join(', ')}. ` +
        `${emitted} node${emitted === 1 ? '' : 's'}` +
        (omitted
          ? `, ${omitted} not listed — ${withSpaces ? `below depth ${depth}` : 'IfcSpace leaves and anything below depth ' + depth}. Every node states its own childCount; pass spaces:true or a larger depth for more.`
          : '.'),
      spaces: withSpaces,
      maxDepth: depth,
      nodes: emitted,
      omitted,
      truncated: omitted > 0,
      models: trees
    }
  }
}

export const get_relationships: Executor = (input, ctx) => {
  const s = ctx.state()
  const found = findElement(s, input)
  if ('error' in found) return { forModel: { message: found.error } }
  const e = found.el
  const ref = (expressId: number): { id: number; name: string; type: string } | number => {
    const other = s.byId.get(fedId(s, e.model, expressId))
    return other ? { id: other.id, name: other.name, type: other.type } : expressId
  }
  return {
    forModel: {
      id: e.id,
      model: e.model,
      containedIn: { storey: e.storey },
      typeObject: e.objectType ? { name: e.objectType, guid: e.typeGuid || null } : null,
      materials: e.materials,
      classifications: e.classifications,
      systems: e.systems,
      decomposition: {
        partOf: e.decomposition.parent !== undefined ? ref(e.decomposition.parent) : null,
        parts: e.decomposition.children.map(ref),
        openings: e.decomposition.openings,
        fills: e.decomposition.fillings.map(ref)
      }
    }
  }
}

export const get_model_info: Executor = (input, ctx) => {
  const s = ctx.state()
  const wanted = typeof input.model === 'string' ? input.model : null
  const models = s.federation.models.filter((m) => !wanted || m.meta.modelKey === wanted)
  if (!models.length) return notLoaded(wanted, s.loaded)
  // 2026-10-08 — which loaded models could not be lined up: the Coordinate-system card's note.
  const issues = notLinedUp(s)
  return {
    forModel: {
      message: `${models.length} model${models.length === 1 ? '' : 's'}.`,
      models: models.map(({ meta }) => ({
        model: meta.modelKey,
        fileName: meta.fileName,
        sha256: meta.sha256 || null,
        schema: meta.schema,
        header: {
          description: meta.header.description,
          // The MVD, which is what says whether a file is a Reference View or a Design
          // Transfer View — and therefore what may legitimately be missing from it.
          viewDefinition: meta.header.viewDefinition || null,
          name: meta.header.name,
          timeStamp: meta.header.timeStamp,
          author: meta.header.author,
          organization: meta.header.organization,
          preprocessorVersion: meta.header.preprocessorVersion,
          originatingSystem: meta.header.originatingSystem,
          authorization: meta.header.authorization,
          fileSchema: meta.header.fileSchema
        },
        project: meta.project,
        site: meta.site ? { name: meta.site.name, guid: meta.site.guid } : null,
        building: meta.building ? { name: meta.building.name, guid: meta.building.guid } : null,
        units: {
          metresPerLengthUnit: meta.units.length,
          squareMetresPerAreaUnit: meta.units.area,
          cubicMetresPerVolumeUnit: meta.units.volume,
          radiansPerAngleUnit: meta.units.angle,
          assignment: meta.units.byType
        },
        georeferencing: {
          /** Which declaration is actually in force, over every one that was found. */
          method: meta.georef.method,
          source: meta.georef.source,
          sourcesFound: meta.georef.sources,
          mapConversion: {
            eastings: meta.georef.eastings ?? null,
            northings: meta.georef.northings ?? null,
            orthogonalHeight: meta.georef.orthogonalHeight ?? null,
            xAxisAbscissa: meta.georef.xAxisAbscissa ?? null,
            xAxisOrdinate: meta.georef.xAxisOrdinate ?? null,
            rotationDeg: meta.georef.rotationDeg ?? null,
            scale: meta.georef.scale ?? null,
            isIdentity: isIdentityMapConversion(meta.georef)
          },
          // Kept flat as well, because these are the names the IFC schema uses.
          eastings: meta.georef.eastings ?? null,
          northings: meta.georef.northings ?? null,
          orthogonalHeight: meta.georef.orthogonalHeight ?? null,
          rotationDeg: meta.georef.rotationDeg ?? null,
          scale: meta.georef.scale ?? null,
          crs: meta.georef.crs ?? null,
          /** The **spatial-root** site — the one `IfcProject` aggregates, never the first by id. */
          site: meta.georef.site ?? null,
          trueNorth: meta.georef.trueNorth ?? null,
          epsetName: meta.georef.epsetName ?? null,
          /**
           * The map coordinates of this model's project frame's origin and the total rotation
           * from project north to true north. The Coordinate-system card shows the **boot**
           * model's, which is the frame the whole federation is placed in.
           */
          projectBasePoint: coordsFromGeoref(meta.georef),
          ...placementReadout(meta.georef),
          // 2026-10-08 — whether it lines up with the others, as the Coordinate-system card's
          // note says: `null` when it does (and with one model loaded, when there is nothing to
          // line up with).
          notLinedUp: lineUpOf(issues.find((x) => x.key === meta.modelKey)),
          corenetX: corenetReadout(meta.georef)
        },
        storeys: meta.storeys.map((x) => ({
          /** `Elevation` as authored — what the storey ladder shows. */
          name: x.name,
          elevationMetres: x.elev,
          /** Where the storey's floor actually is, in the file's world coordinates. */
          placementWorldMetres: x.placement ?? null,
          heightMetres: x.h ?? null,
          compositionType: x.compositionType ?? null
        })),
        // The same order the Section card's chips are in (`shared/federate.ts`).
        grids: orderGrids(meta.grids).map((g) => g.name),
        counts: meta.counts
      }))
    }
  }
}

/**
 * 2026-10-08 — one model's entry in the Coordinate-system card's note, as the assistant reads it:
 * why it could not be lined up — it states no map position while another model does, or it landed
 * far from the federation offset another model set — and how far, in kilometres. `null` when it
 * lines up.
 */
function lineUpOf(
  issue: NotLinedUp | undefined
): { reason: 'it has no map position' | 'it sits far from the others'; km: number | null } | null {
  if (!issue) return null
  return issue.reason === 'far'
    ? { reason: 'it sits far from the others', km: Math.round((issue.metres ?? 0) / 100) / 10 }
    : { reason: 'it has no map position', km: null }
}

/** Models `get_view_state` lists one by one. A federation has a handful; past this it says so. */
export const VIEW_MODELS_CAP = 50
/** A model's name is its file's, so it is as long as a file name may be — and clipped here. */
export const VIEW_MODEL_NAME_CHARS = 120

/**
 * `get_view_state` — the view, in full and on demand.
 *
 * The per-turn view state rides on every turn, so it is kept small: the eleven fields it has
 * always had, and since 2026-10-02 four more **only while something is not at its default**
 * (`shared/ai-schema.ts`, `sparseViewState`). This is the other half of that rule — everything
 * the assistant can set, read back whether or not it is at its default:
 *
 *   display        every switch `toggle_display` takes
 *   sectionPlanes  both planes: name, offset in millimetres, side, and whether it cuts
 *   history        whether `apply_visibility`'s undo and redo have anything to step to
 *   models         each loaded model: key, name, eye, colour override, active
 *   interface      what `set_interface` takes, and whether the Schedules window is open
 *
 * and since phase 2 of the same work, what `set_view`, `manage_filters`' `update` and
 * `manage_views` set:
 *
 *   camera         where the camera stands, in `set_view`'s terms: the named view it is on or
 *                  `null`, its projection, azimuth and elevation in degrees. The top-level
 *                  `view` beside it is still the toolbar's lit button — the view asked for last.
 *   filterStack[]  `color`, on each **highlight** step: the Filter card's swatch
 *   viewpoints     the saved viewpoints — name, what each holds, which was restored last — the
 *                  first twenty, with `viewpointsTotal` when there are more
 *
 * and since phase 3:
 *
 *   basePoint      the Coordinate-system card's four fields — E, N, Z in metres, `angle` the
 *                  true-north rotation in degrees — and `source`: `file` or `none`. Every
 *                  E / N / Z read-out is computed with it. (`user` too until 2026-10-08, when
 *                  the owner made the card read-only: the base point is the boot file's alone.)
 *
 * and since 2026-10-08:
 *
 *   notLinedUp     the loaded models the Coordinate-system card's note names — each one's key,
 *                  why it could not be lined up and how far — or `[]`
 *
 * `section` stays the one string it was (`grid C + level L2`): the evaluation suite grades it,
 * and `sectionPlanes` is where the detail is. It starts from `viewStateCore`, not from the
 * per-turn state, so none of the sparse fields is here twice. `tests/unit/ai-readback.test.ts`
 * holds this to the session's own list of review state (`SessionSource`): every key of it is
 * reported here or excluded there, by name and with a reason.
 *
 * A model's `name` is text from a file — its file name, or the label a library gave it — and a
 * viewpoint's is whatever the user typed, so both are reported here, in a tool result, and
 * never in the per-turn state or the cached schema.
 */
export const get_view_state: Executor = (_input, ctx) => {
  const s = ctx.state()
  const base = viewStateCore(s, s.federation, visFn(s), scheduleBriefOf())
  const models = capped(s.federation.models, VIEW_MODELS_CAP)
  const camera = cameraNow()
  const saved = viewpointsState(s)
  return {
    forModel: {
      ...base,
      // The live count per step, which the plain view state does not carry — and, on a
      // highlight step, the colour it tints in (a colour on any other step is not on screen).
      filterStack: base.filterStack.map((step, i) => ({
        ...step,
        matched: chatMatch(s.federation.elements, step.rules).length,
        ...(step.action === 'highlight' && s.stack[i]?.color ? { color: s.stack[i].color } : {})
      })),
      loadedModels: [...s.loaded],
      // Loaded models only: `modelVis` can still name one that has since been unloaded.
      modelsHidden: s.loaded.filter((k) => s.modelVis[k] === false),
      colorBy: s.colorBy
        ? { property: s.colorBy.prop, groups: s.colorBy.groups.map((g) => ({ value: g.v, count: g.n })) }
        : null,
      selectedIds: s.selIds.slice(0, SAMPLE_CAP),
      units: s.units,
      theme: s.theme,
      display: displayState(s),
      sectionPlanes: sectionPlanes(s.sections),
      history: { canUndo: s.canUndo, canRedo: s.canRedo },
      models: models.items.map((m) => {
        const key = m.meta.modelKey
        const name = modelLabel(key, m.meta.fileName, s.library, s.uploadNames[key])
        return {
          key,
          name: name.length > VIEW_MODEL_NAME_CHARS ? name.slice(0, VIEW_MODEL_NAME_CHARS) + '…' : name,
          visible: s.modelVis[key] !== false,
          // The override the user or the assistant picked, or null. It is drawn only while
          // `display.originalMaterials` is off.
          color: s.modelColors[key] ?? null,
          active: s.active === key
        }
      }),
      ...(models.truncated ? { modelsTotal: models.total, modelsTruncated: true } : {}),
      interface: interfaceState(s),
      // Absent only where there is no viewer to ask — never a guessed direction.
      ...(camera ? { camera } : {}),
      viewpoints: saved.viewpoints,
      ...(saved.truncated ? { viewpointsTotal: saved.total, viewpointsTruncated: true } : {}),
      basePoint: basePointState(s),
      notLinedUp: notLinedUp(s).map((x) => ({
        model: x.key,
        ...lineUpOf(x)!
      }))
    }
  }
}

/** The base point as the assistant reads it — the store's four fields, and whose they are. */
export interface BasePointState {
  E: number | null
  N: number | null
  Z: number | null
  /** True north, degrees clockwise from project north. */
  angle: number | null
  source: 'file' | 'none'
}

/**
 * `get_view_state`'s `basePoint` (2026-10-02). A field the file does not state is `null` — never
 * a zero, which would read as a coordinate. Since 2026-10-08 the four fields are always the boot
 * file's: the card is read-only and nothing can change them, so `source` is `file` or `none`.
 */
export const basePointState = (s: ShellState): BasePointState => ({
  E: s.coords.E,
  N: s.coords.N,
  Z: s.coords.Z,
  angle: s.coords.angle,
  source: basePointSource(s.bootGeoref)
})

export const measure_between: Executor = (input, ctx) => {
  const s = ctx.state()
  const a = s.byId.get(Number(input.a))
  const b = s.byId.get(Number(input.b))
  if (!a || !b) {
    return { forModel: { message: `No element with id ${!a ? input.a : input.b}.` } }
  }
  if (!a.bbox || !b.bbox) {
    return {
      forModel: {
        message: `${!a.bbox ? a.name : b.name} has no geometry, so there is nothing to measure between.`
      }
    }
  }
  const [ax0, ay0, az0, ax1, ay1, az1] = a.bbox
  const [bx0, by0, bz0, bx1, by1, bz1] = b.bbox
  const ca = [(ax0 + ax1) / 2, (ay0 + ay1) / 2, (az0 + az1) / 2]
  const cb = [(bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2]
  const centre = Math.hypot(cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2])
  // Per axis: positive is a gap, negative is an overlap.
  const gap = [
    Math.max(bx0 - ax1, ax0 - bx1),
    Math.max(by0 - ay1, ay0 - by1),
    Math.max(bz0 - az1, az0 - bz1)
  ]
  const overlaps = gap.every((g) => g < 0)
  const clearance = Math.hypot(...gap.map((g) => Math.max(g, 0)))
  return {
    forModel: {
      message: `${a.name} and ${b.name}: ${centre.toFixed(3)} m centre to centre, ${overlaps ? 'bounding boxes overlap' : `${clearance.toFixed(3)} m between bounding boxes`}. Bounding-box arithmetic, not solid geometry.`,
      a: brief(a),
      b: brief(b),
      centreToCentreMetres: centre,
      boxGapMetres: { x: gap[0], y: gap[1], z: gap[2] },
      boxClearanceMetres: overlaps ? 0 : clearance,
      boxesOverlap: overlaps,
      /** Both boxes are project-frame metres, Z-up, so `x` and `y` are the building's own axes. */
      frame: 'project',
      // Said in structure as well as in the sentence, because the number is not a
      // surface-to-surface distance and a reader of the JSON alone must not take it for one.
      method:
        'axis-aligned bounding boxes in the project frame — the union of each element’s placed part boxes, not solid geometry',
      aBoxMetres: a.bbox,
      bBoxMetres: b.bbox
    }
  }
}

/**
 * `find_nearby` — 2026-09-20, `docs/AI_REVIEW.md` §9 gap 7 and workflow W5.
 *
 * "What is within two metres of this" was a four-line `bbox` self-join the model had to write
 * correctly every time, and `IfcSpace` — which by construction overlaps everything standing in
 * it — dominated the answer with no way to exclude it but another `WHERE`.
 *
 * It is box arithmetic and says so in the same words `measure_between` uses, because it is the
 * same arithmetic: the gap between two axis-aligned boxes in the project frame, never a
 * surface-to-surface distance.
 */
export const find_nearby: Executor = (input, ctx) => {
  const s = ctx.state()
  const asked: number[] = Array.isArray(input.ids)
    ? (input.ids as number[])
    : typeof input.id === 'number'
      ? [input.id]
      : []
  if (!asked.length) return { forModel: { message: 'Pass id, or ids, to search around.' } }

  const seeds = asked.map((id) => s.byId.get(id)).filter(Boolean) as FederatedElement[]
  const missing = asked.filter((id) => !s.byId.get(id))
  if (!seeds.length) {
    return {
      forModel: {
        message: `No element with id ${asked.join(', ')}. Element ids are per session — re-read them from a tool.`
      }
    }
  }
  const noBox = seeds.filter((e) => !e.bbox)
  const boxed = seeds.filter((e) => e.bbox)
  if (!boxed.length) {
    return {
      forModel: {
        message: `${seeds.map((e) => e.name).join(', ')} has no geometry, so there is nothing to search around.`
      }
    }
  }

  const distance = typeof input.distance === 'number' && input.distance >= 0 ? input.distance : 1
  const withSpaces = input.spaces === true
  const limit = Math.max(1, Math.min(typeof input.limit === 'number' ? input.limit : 25, 100))
  const visible = visFn(s)
  const pool = s.federation.elements.filter(
    (e) => visible(e) && (withSpaces || e.type !== 'IfcSpace')
  )
  const found = nearbyElements(pool, boxed, distance)
  const { items, total, truncated } = capped(found, limit)

  const noun = boxed.length === 1 ? boxed[0].name : `${boxed.length} elements`
  const head = `${total} element${total === 1 ? '' : 's'} within ${distance} m of ${noun}` +
    (withSpaces ? '' : ', IfcSpace excluded') +
    `. Axis-aligned bounding boxes in the project frame, not solid geometry — neighbours to check, not contacts.` +
    (truncated ? ` The ${items.length} nearest are listed.` : '') +
    (missing.length ? ` ${missing.length} of the ids given are not in the loaded federation.` : '') +
    (noBox.length ? ` ${noBox.length} of them carry no geometry and were skipped.` : '')

  return {
    forModel: {
      message: head,
      around: boxed.map((e) => e.id),
      distanceMetres: distance,
      spacesIncluded: withSpaces,
      count: total,
      truncated,
      ...(missing.length ? { idsUnknown: missing.length } : {}),
      ...(noBox.length ? { idsWithoutGeometry: noBox.length } : {}),
      neighbours: items.map((n) => ({
        id: n.el.id,
        entity: n.el.type,
        name: n.el.name,
        storey: n.el.storey,
        model: n.el.model,
        gapMetres: n.gap,
        of: n.of
      })),
      frame: 'project',
      method:
        'axis-aligned bounding boxes in the project frame — the union of each element’s placed part boxes, not solid geometry. A gap of 0 means the boxes touch or overlap.'
    },
    ui: { chips: items.length ? [{ label: `${total} within ${distance} m`, ids: items.map((n) => n.el.id) }] : [] }
  }
}

export const query_sql: Executor = async (input, ctx) => {
  const sql = String(input.sql ?? '')
  if (!sql.trim()) return { forModel: { message: 'Pass one SELECT or WITH statement.' } }
  try {
    const result = await ctx.sql(sql)
    return {
      forModel: {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rows.length,
        truncated: result.truncated,
        ms: result.ms
      }
    }
  } catch (error) {
    // The guard's own words, verbatim: they name exactly what was refused and why.
    return {
      forModel: {
        message: error instanceof Error ? error.message : String(error),
        refused: true
      }
    }
  }
}

export const READ_EXECUTORS: Record<string, Executor> = {
  summarize_elements,
  audit_model,
  clash_check,
  query_elements,
  get_element,
  get_entity_raw,
  list_values,
  find_properties,
  search,
  get_spatial_tree,
  get_relationships,
  get_model_info,
  get_view_state,
  measure_between,
  find_nearby,
  query_sql
}
