/**
 * Federation — several `ModelIndex`es read as one project (plan §3.3, §4 Phase 1b).
 *
 * Pure: no worker, no store, no three.js. Given frozen indexes it returns a new
 * `Federation`; given a `Federation` it returns a new one with a model removed. Nothing is
 * mutated, so the caller can diff old against new.
 *
 * The id scheme is the design's own (`design-reference/design/sample-model.js` `federate`) with
 * a wider stride: an element's federation id is `slot * ID_STRIDE + localId`, `localId` is kept,
 * and every element carries the `model` key it came from so the shell can filter, hide and colour
 * by source file. The design's stride, 1 000 000, is a million IFC lines; `ID_STRIDE` says why it
 * is a thousand million now (2026-10-09).
 *
 * **The slot is never `models.length`.** Marumi's lesson: after a delete that number repeats
 * and the next model silently inherits the removed one's ids, which shows up as the wrong
 * element highlighted or hidden. Slots are found by free-slot search and a model keeps its
 * slot for as long as it is loaded, so removing a model leaves every surviving id untouched
 * — `removeModel` returns the ids that disappeared so the caller can prune selection,
 * hidden, colour and filter maps instead of remapping them.
 */
import { collectPropKeys } from './attr'
import type {
  GridAxisRecord,
  IfcElement,
  ModelIndex,
  ModelIndexMeta,
  Storey
} from './model-index.types'

/**
 * Federation ids are `slot * ID_STRIDE + localId` (2026-10-09; the design's stride was 1 000 000).
 *
 * `localId` is the element's IFC express id — its `#` line number — and a real file passes a
 * million of them at about 60–70 MB of IFC. With the design's stride such a model numbered into
 * the next model's block: four 150 MB files federated together lost 1 146 elements to shared ids
 * and the SQL index refused to build (`UNIQUE constraint failed: element.id`), and every restore
 * that reads a slot back out of an id (`Math.floor(id / stride)`) named the wrong model for 57 %
 * of a 150 MB file's elements.
 *
 * A thousand million holds every express id the 600 MB cap can admit many times over: the 610 MB
 * test file has 9.4 million lines, and 600 MB of the shortest entity there is
 * (`#12345678=IFCVERTEX();`, 22 bytes) would number under 29 million. A model with an id at or
 * above it — a file numbered from a high start, or with huge gaps — is refused at load, never
 * numbered into its neighbour (`localIdRefusal`).
 *
 * Every id is still an exact JavaScript integer up to slot `MAX_SLOT` — over nine million models
 * — and federation ids live only in JavaScript numbers, JSON and SQLite's 64-bit `INTEGER`: no
 * typed array, texture or shader ever holds one (the GPU buffers carry part *indices*,
 * `viewer/batches.ts`). Decimal on purpose: `3000012345` still reads as slot 3, `#12345`; and the
 * ids of the first four slots stay below 2³² − 1, so a `hidden` map keyed by them stays an
 * indexed object (measured: a lookup keyed past that is about 5× slower in V8).
 */
export const ID_STRIDE = 1_000_000_000

/**
 * The design's stride. Every session, share link and viewpoint written before 2026-10-09 is
 * numbered by it, and they carry no `idStride` (`shared/session-codec.ts`, `legacyIds`).
 */
export const LEGACY_ID_STRIDE = 1_000_000

/** The largest local id a model may carry and still be numbered inside its own block. */
export const MAX_LOCAL_ID = ID_STRIDE - 1

/** The largest slot whose every id is still an exact JavaScript integer (`2⁵³ − 1`). */
export const MAX_SLOT = Math.floor((Number.MAX_SAFE_INTEGER - MAX_LOCAL_ID) / ID_STRIDE)

/** Whether a local id fits its block: a whole number from 0 to `MAX_LOCAL_ID`. */
export const fitsLocalId = (localId: number): boolean =>
  Number.isInteger(localId) && localId >= 0 && localId <= MAX_LOCAL_ID

/**
 * What the upload row says about a model that does not fit — the designed error row, and the
 * landing page's banner around it (`model/upload-pipeline.ts`, `fail`).
 */
export const ID_RANGE_REFUSAL = `entity ids above #${MAX_LOCAL_ID} are not supported`

/**
 * One element's federation id. **The one place an id is composed** — the federation, the
 * viewer's parts and edges, the site set and the assistant's references all call it — and it
 * refuses rather than collide: a local id outside its block, or a slot past `MAX_SLOT`, throws.
 */
export function fedId(slot: number, localId: number): number {
  if (!fitsLocalId(localId)) throw new RangeError(ID_RANGE_REFUSAL)
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
    throw new RangeError(`federation slot ${slot} is out of range`)
  }
  return slot * ID_STRIDE + localId
}

/** The slot an id was numbered in. */
export const slotOfId = (id: number): number => Math.floor(id / ID_STRIDE)

/** The element's own id inside its file. */
export const localOfId = (id: number): number => id - slotOfId(id) * ID_STRIDE

/**
 * The refusal for a model whose ids would not fit, or `null`. `ids` are every local id the
 * model brings — its elements, and the elements its geometry parts name.
 */
export function localIdRefusal(ids: Iterable<number>): string | null {
  for (const id of ids) if (!fitsLocalId(id)) return ID_RANGE_REFUSAL
  return null
}

/** Two storeys count as the same level when their elevations agree to this, in metres. */
export const STOREY_ELEVATION_TOLERANCE = 0.001

/** One element as the federation sees it: a new id, its own id kept, its model named. */
export interface FederatedElement extends IfcElement {
  /** The element's id inside its own file — `expressId` for a real model. */
  localId: number
}

/** One loaded file: its stable slot and everything the index knows except the elements. */
export interface FederatedModel {
  slot: number
  meta: ModelIndexMeta
}

/**
 * The project header the shell shows, composed exactly as the design composes it:
 * the first file's building name (falling back to its project name), and every file name
 * joined with ' + '.
 */
export interface FederationProject {
  name: string
  file: string
  schema: string
  site: string
  building: string
}

/** One row of the design's file list. */
export interface FederationFile {
  key: string
  name: string
  file: string
  schema: string
  site: string
  building: string
}

export interface FederationCounts {
  models: number
  elements: number
  spaces: number
  byType: Record<string, number>
}

export interface Federation {
  models: readonly FederatedModel[]
  elements: readonly FederatedElement[]
  /** Federation id → element. The one lookup selection, picking and the AI tools share. */
  byId: ReadonlyMap<number, FederatedElement>
  /** Union across files, sorted by elevation. */
  storeys: readonly Storey[]
  /** Union across files by axis name. */
  grids: readonly GridAxisRecord[]
  project: FederationProject
  files: readonly FederationFile[]
  /** The seven attributes plus every pset/qto key in the federation. */
  propKeys: readonly string[]
  counts: FederationCounts
}

/** An empty federation — what the shell starts with and what removing the last model gives. */
export const EMPTY_FEDERATION: Federation = {
  models: [],
  elements: [],
  byId: new Map(),
  storeys: [],
  grids: [],
  project: { name: '', file: '', schema: '', site: '', building: '' },
  files: [],
  propKeys: [],
  counts: { models: 0, elements: 0, spaces: 0, byType: {} }
}

/* ────────────────────────────── slots ────────────────────────────── */

/**
 * The lowest slot not already taken. A model that was loaded before keeps the slot it had,
 * so its element ids never move; a new model fills the first gap a removal left behind.
 */
function assignSlots(
  models: readonly ModelIndex[],
  previous: Federation | undefined
): Map<string, number> {
  const slots = new Map<string, number>()
  const used = new Set<number>()
  const wanted = new Set(models.map((m) => m.modelKey))

  for (const model of previous?.models ?? []) {
    if (!wanted.has(model.meta.modelKey)) continue
    slots.set(model.meta.modelKey, model.slot)
    used.add(model.slot)
  }
  for (const model of models) {
    if (slots.has(model.modelKey)) continue
    let slot = 0
    while (used.has(slot)) slot++
    used.add(slot)
    slots.set(model.modelKey, slot)
  }
  return slots
}

/* ────────────────────────────── the merge ────────────────────────────── */

const fileOf = (meta: ModelIndexMeta): FederationFile => ({
  key: meta.modelKey,
  name: meta.project?.name ?? '',
  file: meta.fileName,
  schema: meta.schema,
  site: meta.site?.name ?? '',
  building: meta.building?.name ?? ''
})

/**
 * Union the storeys of every file into one ladder.
 *
 * Matched by GlobalId first — two files that export the same level share its GUID, and that
 * is the only statement of identity the schema makes. Files that do not (a Revit link
 * re-exported, a consultant's own model) fall back to the same name at the same elevation
 * within a millimetre, which is what the design does by name alone.
 */
function unionStoreys(models: readonly FederatedModel[]): Storey[] {
  const out: Storey[] = []
  const byGuid = new Map<string, Storey>()
  for (const model of models) {
    for (const storey of model.meta.storeys) {
      if (storey.guid && byGuid.has(storey.guid)) continue
      const sameLevel = out.some(
        (kept) =>
          kept.name === storey.name &&
          Math.abs(kept.elev - storey.elev) <= STOREY_ELEVATION_TOLERANCE
      )
      if (sameLevel) continue
      const copy: Storey = { ...storey }
      out.push(copy)
      if (storey.guid) byGuid.set(storey.guid, copy)
    }
  }
  return out.sort((a, b) => a.elev - b.elev)
}

/* ────────────────────────────── grid order ────────────────────────────── */

/** `u` before `v` before `w` — the IFC grid's own `UAxes` / `VAxes` / `WAxes` lists. */
const FAMILY_RANK: Record<string, number> = { u: 0, v: 1, w: 2 }

/**
 * A grid name split into its digit and non-digit runs, for a natural comparison.
 * `2a` → `[2, 'a']`, `A1` → `['a', 1]`, `1'` → `[1, "'"]`.
 */
const gridNameTokens = (name: string): (string | number)[] =>
  (name.match(/\d+|\D+/g) ?? []).map((part) => (/^\d/.test(part) ? Number(part) : part.toLowerCase()))

/**
 * Natural order on a grid's name: numeric-aware and case-insensitive, so a real ladder reads
 * `1, 1', 2, 2a, 3 … 10 … 24` and `A, A1, B, C, C1` rather than `1, 10, 2` or `A1, A, B`.
 * The raw name breaks a tie, so two names that differ only in case have a fixed order.
 */
export function compareGridNames(a: string, b: string): number {
  const ta = gridNameTokens(a)
  const tb = gridNameTokens(b)
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i]
    const y = tb[i]
    if (x === y) continue
    // A number sorts before a word at the same position: `1` before `A` on a mixed row.
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  if (ta.length !== tb.length) return ta.length - tb.length
  return a === b ? 0 : a < b ? -1 : 1
}

/**
 * Grid axes union by name — every discipline repeats the project grid, so drawing them all
 * overprints — then **ordered**, because a real file does not list them in any order a reader
 * would recognise.
 *
 * The design fills the Section card's "Along a gridline" chips straight from this list
 * (`SGVue.dc.html:1994`, markup `:585`), and its own mock is already tidy: five `x` axes
 * `A…E` then four `y` axes `1…4`. A Revit export is in creation order — on the reference model
 * the first `UAxes` entry is `L` and the first `VAxes` entry is `22` — so thirty-nine chips
 * came out jumbled. Grouping by the IFC grid's own family and sorting naturally within it
 * reproduces the mock exactly and makes a real one readable.
 *
 * This is the federation's list only. The **drawn** grid, its bubbles and the declutter sweep
 * read `ModelMeta.grids` through the viewer and are untouched by this: the declutter's greedy
 * order is still the file's own axis order, which is what was measured and committed, and a
 * name's natural order is not demonstrably the row's spatial order on an arbitrary file.
 */
function unionGrids(models: readonly FederatedModel[]): GridAxisRecord[] {
  const byName = new Map<string, GridAxisRecord>()
  for (const model of models) {
    for (const grid of model.meta.grids) if (!byName.has(grid.name)) byName.set(grid.name, grid)
  }
  return orderGrids([...byName.values()])
}

/** The shared ordering: family first, then the name, with first appearance as the tie-break. */
export function orderGrids<T extends { name: string; family?: string }>(
  grids: readonly T[]
): T[] {
  const seen = new Map<string, number>()
  for (const g of grids) if (!seen.has(g.name)) seen.set(g.name, seen.size)
  const rank = (g: T): number => FAMILY_RANK[g.family ?? ''] ?? FAMILY_RANK.w + 1
  return [...grids].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      compareGridNames(a.name, b.name) ||
      (seen.get(a.name) ?? 0) - (seen.get(b.name) ?? 0)
  )
}

/** Everything that is derived from the models and their already-numbered elements. */
function compose(
  models: readonly FederatedModel[],
  elements: readonly FederatedElement[]
): Federation {
  if (!models.length) return EMPTY_FEDERATION

  const first = models[0].meta
  const byType: Record<string, number> = {}
  let spaces = 0
  const byId = new Map<number, FederatedElement>()
  for (const element of elements) {
    byType[element.type] = (byType[element.type] ?? 0) + 1
    if (element.isSpace) spaces++
    byId.set(element.id, element)
  }

  return {
    models,
    elements,
    byId,
    storeys: unionStoreys(models),
    grids: unionGrids(models),
    project: {
      // `name = first.building || first.name`, `file` = the file names joined — the design's
      // own `federate`, reproduced so the header line reads identically.
      name: first.building?.name || first.project?.name || '',
      file: models.map((m) => m.meta.fileName).join(' + '),
      schema: first.schema,
      site: first.site?.name ?? '',
      building: first.building?.name ?? ''
    },
    files: models.map((m) => fileOf(m.meta)),
    propKeys: collectPropKeys(elements),
    counts: { models: models.length, elements: elements.length, spaces, byType }
  }
}

/**
 * Merge indexes into one federation.
 *
 * Pass the previous federation to keep every model that is still loaded on the slot it
 * already had; without it, slots are handed out from zero in the order given.
 */
export function federate(models: readonly ModelIndex[], previous?: Federation): Federation {
  const keys = new Set<string>()
  for (const model of models) {
    if (keys.has(model.modelKey)) {
      throw new Error(`federate: two models share the key "${model.modelKey}"`)
    }
    keys.add(model.modelKey)
  }

  const slots = assignSlots(models, previous)
  const federated: FederatedModel[] = []
  const elements: FederatedElement[] = []
  for (const model of models) {
    const slot = slots.get(model.modelKey)!
    const { elements: own, ...meta } = model
    federated.push({ slot, meta })
    for (const element of own) {
      elements.push({
        ...element,
        id: fedId(slot, element.id),
        localId: element.id,
        model: model.modelKey
      })
    }
  }
  return compose(federated, elements)
}

/**
 * Drop one model. Every surviving element keeps the id it already had — that is the whole
 * point of the slot — so the caller only has to *prune* the ids in `droppedIds` from
 * whatever stores them (the design's `setModels` prunes `hidden` and `modelColors`, clears
 * `colorBy` and drops `active`), never remap them.
 */
export function removeModel(
  federation: Federation,
  modelKey: string
): { federation: Federation; droppedIds: readonly number[] } {
  const models = federation.models.filter((m) => m.meta.modelKey !== modelKey)
  if (models.length === federation.models.length) return { federation, droppedIds: [] }

  const droppedIds: number[] = []
  const elements: FederatedElement[] = []
  for (const element of federation.elements) {
    if (element.model === modelKey) droppedIds.push(element.id)
    else elements.push(element)
  }
  return { federation: compose(models, elements), droppedIds }
}
