/**
 * Core protection #6 — the federation simulation (`docs/plans/core-protection.md`, Tier 1).
 *
 * Seeded, property-based: fast-check generates synthetic federations of one to six models — the
 * design's four mock disciplines re-numbered and re-placed — with shared and far (~26 km) origins,
 * duplicate file stems, express ids from small to the very top of a slot's block
 * (`MAX_LOCAL_ID`), grids turned and families swapped, levels renamed, sites turned, and loads
 * them through the **real, headless** path: `FederationController.addBatch` (`federate`, the
 * free-slot search, the replacement path's slot rule) and the store's `commitModels`, with a stub
 * viewer. Every federation is loaded twice, in two orders — one batch or several, with a model
 * removed and opened again in between — and checked:
 *
 *   · **ids** — unique; `slotOfId` / `localOfId` give back the slot and the express id `fedId`
 *     composed them from; `byId` holds every element; a local id past the block is refused;
 *   · **the element tree** — every element in exactly one group, in both groupings;
 *   · **a session round trip** — hide a random set and choose an active model, encode the payload
 *     as a share link does, decode it, open the files in the *other* order and restore the ids
 *     the way the upload pipeline does (`restorableIds` → `applySession`): the same elements
 *     are hidden, by file and GlobalId, and the same file is active;
 *   · **independence of load order** (the 2026-11-07 decisions) — the same elements by file and
 *     GlobalId, the same tree, the same grid and storey ladders, the same plan rotation to the
 *     bit, the same georeferencing source and base point.
 *
 * A model's identity here is its **file path**, never its key: a key is the file's stem, and two
 * files of one stem in one pick are `name` and `name (2)` in pick order (`upload-pipeline.ts`).
 * The keys are given here per file, as one pick would give them, so the two loads agree on them.
 *
 * Seed and number of runs are fixed, so CI runs the same federations; a failure prints the seed,
 * the replay path and the shrunk counterexample.
 */
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_LOCAL_ID,
  federate,
  fedId,
  localOfId,
  slotOfId,
  type Federation
} from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { FederationController, type BatchItem } from '../../src/renderer/model/federation-store'
import { useShell } from '../../src/renderer/state/shell'
import { sessionSource } from '../../src/renderer/state/selectors/snapshot'
import { groupTree } from '../../src/renderer/state/selectors/tree'
import { IDENTITY_FRAME_KEY } from '../../src/shared/georef'
import {
  decodeState,
  encodeState,
  restorableIds,
  sessionPayload,
  type SessionPayload
} from '../../src/shared/session-codec'
import type { Georeference, ModelIndex } from '../../src/shared/model-index.types'
import { disposeFederation, resetShell, stubViewer } from './stub-viewer'

const SEED = 20261107
const RUNS = 150

/* ────────────────────────────── one synthetic model ────────────────────────────── */

const BASES = ['ARC', 'STR', 'SIT', 'MEP'] as const
type Base = (typeof BASES)[number]
const BASE_INDEX: Record<Base, ModelIndex> = Object.fromEntries(BASES.map((b) => [b, mockModelIndex(b)])) as Record<
  Base,
  ModelIndex
>
const STEMS = ['Tower', 'Podium', 'STR', 'MEP'] as const

/** A far origin, ~26 km out: the repository's synthetic set (CLAUDE.md), never a real project's. */
const FAR: readonly [number, number, number] = [12345.457, 23456.766, 5.05]

interface ModelSpec {
  base: Base
  stem: (typeof STEMS)[number]
  /** The express ids, one per element of the base, all distinct. */
  ids: number[]
  far: boolean
  /** Degrees the grids are turned about the file's origin. */
  gridTurn: number
  /** The numbered axes are the file's `UAxes` and the lettered its `VAxes`. */
  swapFamilies: boolean
  /** The levels are named in this file's own way (`Level L1` for `L1`), at the same elevations. */
  renameLevels: boolean
  /** The spatial-root site's rotation, or none. */
  siteTurn: number | null
}

const sizeOf = (b: Base): number => BASE_INDEX[b].elements.length

/** Distinct express ids: low, at the very top of the block, or anywhere in it. */
const idsFor = (n: number): fc.Arbitrary<number[]> =>
  fc.oneof(
    fc.uniqueArray(fc.integer({ min: 1, max: n * 8 }), { minLength: n, maxLength: n }),
    fc.uniqueArray(fc.integer({ min: MAX_LOCAL_ID - 4 * n, max: MAX_LOCAL_ID }), { minLength: n, maxLength: n }),
    fc.uniqueArray(fc.integer({ min: 1, max: MAX_LOCAL_ID }), { minLength: n, maxLength: n })
  )

/** How a spec prints in a counterexample: its ids as a range, not a hundred numbers. */
function specText(x: ModelSpec): string {
  const lo = Math.min(...x.ids)
  const hi = Math.max(...x.ids)
  return (
    `${x.base} as ${x.stem}.ifc, ${x.ids.length} ids in [${lo}, ${hi}]` +
    (x.far ? ', far origin' : '') +
    (x.gridTurn ? `, grids turned ${x.gridTurn}°` : '') +
    (x.swapFamilies ? ', U/V swapped' : '') +
    (x.renameLevels ? ', levels renamed' : '') +
    (x.siteTurn !== null ? `, site turned ${x.siteTurn}°` : '')
  )
}

const modelSpec: fc.Arbitrary<ModelSpec> = fc.constantFrom(...BASES).chain((base) =>
  fc.record({
    base: fc.constant(base),
    stem: fc.constantFrom(...STEMS),
    ids: idsFor(sizeOf(base)),
    far: fc.boolean(),
    gridTurn: fc.constantFrom(0, 0, 90, -43.4103, 12.5),
    swapFamilies: fc.nat({ max: 5 }).map((n) => n === 0),
    renameLevels: fc.nat({ max: 3 }).map((n) => n === 0),
    siteTurn: fc.option(fc.constantFrom(-43.4103, 30, 90), { nil: null })
  }).map((x) => Object.assign(x, { [fc.toStringMethod]: () => specText(x) }))
)

/** One file of the federation: where it is, the key it is open under, and its index. */
interface FileSpec {
  path: string
  key: string
  sha256: string
  index: ModelIndex
}

const turn = (p: readonly [number, number], deg: number, at: readonly [number, number, number]): [number, number] => {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [p[0] * c - p[1] * s + at[0], p[0] * s + p[1] * c + at[1]]
}

function buildModel(spec: ModelSpec, key: string, fileName: string): ModelIndex {
  const base = BASE_INDEX[spec.base]
  const at = spec.far ? FAR : ([0, 0, 0] as const)
  const level = (name: string): string => (spec.renameLevels && name ? `Level ${name}` : name)
  const georef: Georeference =
    spec.siteTurn === null
      ? { source: 'none', sources: [], method: 'none' }
      : {
          source: 'IfcSite',
          sources: ['IfcSite'],
          method: 'IfcSite placement',
          site: { placement: [at[0], at[1], at[2]], rotationDeg: spec.siteTurn }
        }
  const swap = (f: string | undefined): string | undefined =>
    !spec.swapFamilies ? f : f === 'u' ? 'v' : f === 'v' ? 'u' : f
  return {
    ...base,
    modelKey: key,
    fileName,
    storeys: base.storeys.map((s) => ({ ...s, name: level(s.name) })),
    grids: base.grids.map((g) => ({
      ...g,
      start: turn(g.start, spec.gridTurn, at),
      end: turn(g.end, spec.gridTurn, at),
      family: swap(g.family)
    })),
    georef,
    elements: base.elements.map((e, i) => ({
      ...e,
      id: spec.ids[i],
      expressId: spec.ids[i],
      model: key,
      storey: level(e.storey),
      ...(e.bbox
        ? {
            bbox: [
              e.bbox[0] + at[0],
              e.bbox[1] + at[1],
              e.bbox[2] + at[2],
              e.bbox[3] + at[0],
              e.bbox[4] + at[1],
              e.bbox[5] + at[2]
            ] as const
          }
        : {})
    }))
  } as ModelIndex
}

/** The files of one federation, keyed as one pick of them would key them. */
function filesOf(specs: readonly ModelSpec[]): FileSpec[] {
  const taken = new Map<string, number>()
  return specs.map((spec, i) => {
    const n = (taken.get(spec.stem) ?? 0) + 1
    taken.set(spec.stem, n)
    const key = n === 1 ? spec.stem : `${spec.stem} (${n})`
    const fileName = `${spec.stem}.ifc`
    return {
      path: `/synthetic/m${i}/${fileName}`,
      key,
      sha256: i.toString(16).padStart(64, '0'),
      index: buildModel(spec, key, fileName)
    }
  })
}

const itemOf = (f: FileSpec): BatchItem => ({
  index: f.index,
  chunks: [],
  offset: [0, 0, 0],
  file: { key: f.key, path: f.path, name: f.index.fileName, sha256: f.sha256 }
})

/* ────────────────────────────── one load ────────────────────────────── */

/** How a federation is opened: an order, cut into batches, and maybe one model removed and re-opened. */
interface LoadPlan {
  order: number[]
  /** Where the order is cut into batches: the first is the boot, the rest join it. */
  cuts: number[]
  /** A model of the first batch removed after the last batch, then opened again. */
  reopen: number | null
}

const loadPlan = (n: number): fc.Arbitrary<LoadPlan> =>
  fc.record({
    order: fc.shuffledSubarray([...Array(n).keys()], { minLength: n, maxLength: n }),
    cuts: fc.uniqueArray(fc.integer({ min: 1, max: Math.max(1, n - 1) }), { maxLength: n - 1 }).map((c) =>
      c.filter((x) => x < n).sort((a, b) => a - b)
    ),
    reopen: fc.option(fc.nat({ max: n - 1 }), { nil: null })
  })

let fed: FederationController | null = null

/** What the runs covered, so the test proves it reached each case it is about. */
const reached = {
  runs: 0,
  six: 0,
  duplicateStems: 0,
  farAndShared: 0,
  nearTheBound: 0,
  batches: 0,
  reopened: 0,
  turnedPlan: 0,
  georefSource: 0,
  restoredHidden: 0
}

async function load(files: readonly FileSpec[], plan: LoadPlan): Promise<FederationController> {
  const f = new FederationController()
  fed = f
  f.attach(
    stubViewer({
      addModel: async () => undefined,
      removeModel: () => [],
      debug: () => ({}),
      elementIds: () => []
    })
  )
  const order = plan.order.map((i) => files[i])
  const bounds = [0, ...plan.cuts, order.length]
  for (let b = 0; b + 1 < bounds.length; b++) {
    const batch = order.slice(bounds[b], bounds[b + 1])
    if (batch.length) await f.addBatch(batch.map(itemOf))
  }
  if (plan.reopen !== null) {
    const again = order[plan.reopen % order.length]
    await f.removeModel(again.key)
    await f.addBatch([itemOf(again)])
  }
  return f
}

/* ────────────────────────────── what is compared ────────────────────────────── */

/** A model's file path, by key. */
const pathsOf = (files: readonly FileSpec[]): Map<string, string> => new Map(files.map((f) => [f.key, f.path]))

/** An element as the user knows it: its file and its GlobalId. */
const identity = (fd: Federation, paths: Map<string, string>) => (id: number): string => {
  const e = fd.byId.get(id)!
  return `${paths.get(e.model)}|${e.guid}`
}

/** Every invariant that holds of one loaded federation, whatever order it was opened in. */
function checkIds(fd: Federation, files: readonly FileSpec[]): void {
  const slots = new Map(fd.models.map((m) => [m.meta.modelKey, m.slot]))
  // One slot each, and every file present.
  expect(new Set(slots.values()).size).toBe(files.length)
  expect([...slots.keys()].sort()).toEqual(files.map((f) => f.key).sort())
  const expected = files.reduce((n, f) => n + f.index.elements.length, 0)
  expect(fd.elements).toHaveLength(expected)
  expect(fd.byId.size).toBe(expected)
  const seen = new Set<number>()
  for (const e of fd.elements) {
    expect(seen.has(e.id), `id ${e.id} given twice`).toBe(false)
    seen.add(e.id)
    const slot = slots.get(e.model)!
    expect(slotOfId(e.id), `the slot of id ${e.id}`).toBe(slot)
    expect(localOfId(e.id), `the express id in id ${e.id}`).toBe(e.localId)
    expect(e.localId).toBe(e.expressId)
    expect(fedId(slot, e.localId), `fedId(${slot}, ${e.localId})`).toBe(e.id)
    expect(fd.byId.get(e.id)).toBe(e)
  }
  // The file's own express ids, every one, under that file's key.
  for (const f of files) {
    const mine = fd.elements.filter((e) => e.model === f.key).map((e) => e.localId).sort((a, b) => a - b)
    expect(mine).toEqual(f.index.elements.map((e) => e.expressId).sort((a, b) => a - b))
  }
}

/** The element tree, in both groupings: each element in exactly one group. */
function treeOf(fd: Federation, who: (id: number) => string): unknown {
  return (['entity', 'type'] as const).map((treeMode) => {
    const groups = groupTree({ elements: fd.elements, treeMode, search: '', expanded: {}, hidden: {} })
    const all = groups.flatMap((g) => g.ids)
    expect(all).toHaveLength(fd.elements.length)
    expect(new Set(all).size).toBe(fd.elements.length)
    for (const g of groups) expect(g.count).toBe(g.ids.length)
    return groups.map((g) => ({ key: g.key, members: g.ids.map(who).sort() }))
  })
}

/** Everything that must not depend on the order the files were opened in. */
function orderFree(fd: Federation, files: readonly FileSpec[]): Record<string, unknown> {
  const paths = pathsOf(files)
  const who = identity(fd, paths)
  const s = useShell.getState()
  return {
    elements: fd.elements.map((e) => who(e.id)).sort(),
    tree: treeOf(fd, who),
    grids: fd.grids.map((g) => [g.name, g.family]),
    storeys: fd.storeys.map((x) => [x.name, x.elev]),
    planRotationDeg: s.planRotationDeg,
    georefSource: s.georefSourceKey === null ? null : paths.get(s.georefSourceKey),
    coords: s.coords,
    // As a set: the list is in the order the elements first carry each key (`collectPropKeys`,
    // the design's own rule), which follows the load order — recorded, not changed here.
    propKeys: [...fd.propKeys].sort()
  }
}

/* ────────────────────────────── the properties ────────────────────────────── */

const federationCase = fc
  .array(modelSpec, { minLength: 1, maxLength: 6 })
  .chain((specs) => fc.tuple(fc.constant(specs), loadPlan(specs.length), loadPlan(specs.length), fc.nat(), fc.option(fc.nat(), { nil: null })))

describe('federation simulation — seeded synthetic federations through the real load path', () => {
  beforeEach(() => {
    resetShell()
    // Every commit queues an SQL index build, which has no worker here: it logs and gives up.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(async () => {
    if (fed) await disposeFederation(fed)
    fed = null
    vi.restoreAllMocks()
  })

  it('numbers every element once and decodably, keeps the tree whole, round-trips a session and ignores load order', async () => {
    await fc.assert(
      fc.asyncProperty(federationCase, async ([specs, planA, planB, hideSeed, activeAt]) => {
        const files = filesOf(specs)
        const paths = pathsOf(files)
        reached.runs++
        if (files.length === 6) reached.six++
        if (files.some((f) => f.key.endsWith(')'))) reached.duplicateStems++
        if (specs.some((x) => x.far) && specs.some((x) => !x.far)) reached.farAndShared++
        if (specs.some((x) => x.ids.some((id) => id > MAX_LOCAL_ID - 1000))) reached.nearTheBound++
        if (planA.cuts.length || planB.cuts.length) reached.batches++
        if (planA.reopen !== null || planB.reopen !== null) reached.reopened++

        // Load A: ids, tree, and the session it leaves.
        resetShell()
        const a = await load(files, planA)
        const fa = a.current
        expect(useShell.getState().federation).toBe(fa)
        checkIds(fa, files)
        const whoA = identity(fa, paths)
        const seenA = orderFree(fa, files)
        if (seenA.planRotationDeg !== 0) reached.turnedPlan++
        if (seenA.georefSource !== null) reached.georefSource++

        // Hide a seeded share of the elements and activate a model, then cut the link.
        const hide = fa.elements.filter((_, i) => (i * 2654435761 + hideSeed) % 7 === 0).map((e) => e.id)
        useShell.getState().hide(hide)
        const activeKey = activeAt === null ? null : files[activeAt % files.length].key
        if (activeKey) useShell.getState().activate(activeKey)
        const s = useShell.getState()
        const payload = sessionPayload(sessionSource(s), s.loaded, a.sessionFiles(), null, IDENTITY_FRAME_KEY)
        const decoded = decodeState(encodeState(payload)) as SessionPayload
        expect(decoded).toEqual(JSON.parse(JSON.stringify(payload)))
        await disposeFederation(a)
        fed = null

        // Load B, in the other order, and restore the session as the upload pipeline does.
        resetShell()
        const b = await load(files, planB)
        const fb = b.current
        checkIds(fb, files)
        expect(orderFree(fb, files)).toEqual(seenA)
        const live = fb.byId
        useShell.getState().applySession({ ...decoded, ...restorableIds(decoded, b.sessionFiles(), (id) => live.has(id)) })
        const after = useShell.getState()
        const whoB = identity(fb, paths)
        expect(Object.keys(after.hidden).map((id) => whoB(Number(id))).sort()).toEqual(hide.map(whoA).sort())
        if (hide.length) reached.restoredHidden++
        expect(after.active === null ? null : paths.get(after.active)).toBe(activeKey === null ? null : paths.get(activeKey))
        await disposeFederation(b)
        fed = null
      }),
      { seed: SEED, numRuns: RUNS }
    )
    // Each case the properties are about was reached — or the test would prove nothing.
    for (const [what, n] of Object.entries(reached)) expect(n, what).toBeGreaterThan(0)
  }, 120_000)

  it('refuses a local id past its block rather than number it into the next model', () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_LOCAL_ID + 1, max: Number.MAX_SAFE_INTEGER }), fc.nat({ max: 5 }), (bad, at) => {
        const index = mockModelIndex('ARC')
        const elements = index.elements.map((e, i) => (i === at ? { ...e, id: bad, expressId: bad } : e))
        expect(() => federate([{ ...index, elements }])).toThrow(RangeError)
      }),
      { seed: SEED, numRuns: 50 }
    )
  })
})
