/**
 * `src/shared/project-file.ts` — the `.sgvue` project file, format v1 (`docs/plans/project-file.md`,
 * phase 1). The headless half of the plan's "How we know it works":
 *
 *   · a round trip — 500 seeded random review states, written, read and planned back onto the same
 *     federation, come back the same state, and a re-save of what was read is the same text;
 *   · a re-export — the same synthetic model with its express ids renumbered, opened on another
 *     slot under another key: hidden items, viewpoints and markups land on the same elements by
 *     GlobalId, and what no longer matches is counted per model;
 *   · hostile files — each refused with a message, none of them throwing;
 *   · the path helpers, the colour rule, and the writer's bounds.
 *
 * The frozen v1 corpus is `project-file-corpus.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { HL, MC, SCHEME } from '../../src/shared/colors'
import { fedId, modelKeyOf } from '../../src/shared/federate'
import { modelKeyOf as storeModelKeyOf } from '../../src/renderer/model/federation-store'
import type { FilterSet } from '../../src/shared/filter-stack'
import { IDENTITY_FRAME_KEY } from '../../src/shared/georef'
import {
  checkRelPath,
  isAbsolutePath,
  leastUsedColour,
  MAX_MARKUPS,
  MAX_RULES,
  MAX_STEPS,
  MAX_STOREYS,
  MAX_TEXT,
  MAX_VIEWPOINTS,
  normaliseAbsolute,
  PROJECT_MAX_BYTES,
  carryForward,
  projectOf,
  projectText,
  readProject,
  relPathOf,
  resolveRelPath,
  restorePlanOf,
  type ProjectContext,
  type ProjectFederation,
  type ProjectFile,
  type ProjectMeasure,
  type ProjectRestore,
  type ProjectSavedSchedule,
  type ProjectSource,
  type ProjectViewpoint,
  type RestoredViewpoint
} from '../../src/shared/project-file'
import type { FilterStep, Rule } from '../../src/shared/rules'
import { NO_PLANE, type SecPlane, type Sections } from '../../src/shared/sections'
import { ID_STRIDE } from '../../src/shared/federate'
import { legacySection } from '../../src/shared/session-codec'
import { DISPLAY_UNITS } from '../../src/shared/units'
import { parseScheduleDef, type ScheduleDef } from '../../src/schedule/schedule/def'
import type { Viewpoint } from '../../src/renderer/state/selectors/views'
import type { SavedEntry } from '../../src/renderer/schedule-ui/schedules'
import type { MeasureRecord, SpotRecord } from '../../src/renderer/viewer/annotations'
import { cutSwatch } from '../../src/renderer/state/selectors/models'

/* ────────────────────────────── the types hold to the renderer's ────────────────────────────── */

// `shared/` cannot import the renderer, so the project's viewpoint, saved-schedule and markup
// shapes are stated there. These assignments fail the typecheck the day the two drift apart.
const viewpointIn = (v: Viewpoint): ProjectViewpoint => v
const viewpointOut = (v: RestoredViewpoint): Viewpoint => v
const savedIn = (e: SavedEntry): ProjectSavedSchedule => e
const savedOut = (e: ProjectSavedSchedule): SavedEntry => e
const measureIn = (m: MeasureRecord): ProjectMeasure => m
const spotIn = (s: SpotRecord): ProjectSource['spots'][number] => s
void [viewpointIn, viewpointOut, savedIn, savedOut, measureIn, spotIn]

/* ────────────────────────────── seeded randomness ────────────────────────────── */

/** Deterministic, so a failure is reproducible and a green run means something. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GUID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'

class Gen {
  constructor(readonly rnd: () => number) {}
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.rnd() * (hi - lo + 1))
  }
  bool(p = 0.5): boolean {
    return this.rnd() < p
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(0, xs.length - 1)]
  }
  some<T>(xs: readonly T[], p = 0.3): T[] {
    return xs.filter(() => this.bool(p))
  }
  word(max = 12): string {
    // Spaces, unicode and a quote: names are file text.
    const chars = 'abcXYZ019 -_.()é漢"'
    let s = ''
    for (let i = this.int(1, max); i > 0; i--) s += this.pick([...chars])
    return s
  }
  hex(n: number): string {
    let s = ''
    for (let i = 0; i < n; i++) s += '0123456789abcdef'[this.int(0, 15)]
    return s
  }
  guid(): string {
    let s = ''
    for (let i = 0; i < 22; i++) s += GUID_ALPHABET[this.int(0, 63)]
    return s
  }
  /** A coordinate that survives `+ offset − offset` exactly: a multiple of 1/1024. */
  coord(): number {
    return this.int(-1_000_000, 1_000_000) / 1024
  }
  xyz(): [number, number, number] {
    return [this.coord(), this.coord(), this.coord()]
  }
}

/* ────────────────────────────── a synthetic review ────────────────────────────── */

interface SynModel {
  key: string
  slot: number
  sha256: string
  elements: { id: number; guid: string; model: string; expressId: number }[]
}

function synModels(g: Gen): SynModel[] {
  const n = g.int(1, 4)
  const keys = new Set<string>()
  const out: SynModel[] = []
  for (let i = 0; i < n; i++) {
    let key = g.word(8)
    while (keys.has(key)) key += ' (2)'
    keys.add(key)
    const guids = new Set<string>()
    const elements: SynModel['elements'] = []
    const slot = i
    for (let e = g.int(0, 30); e > 0; e--) {
      let guid = g.guid()
      while (guids.has(guid)) guid = g.guid()
      guids.add(guid)
      const expressId = g.int(1, 900_000_000)
      elements.push({ id: fedId(slot, expressId), guid, model: key, expressId })
    }
    // Two elements with one express id would be one id: keep them apart.
    const seen = new Set<number>()
    out.push({ key, slot, sha256: g.hex(64), elements: elements.filter((x) => !seen.has(x.id) && !!seen.add(x.id)) })
  }
  return out
}

const fedOf = (models: readonly SynModel[]): ProjectFederation => ({
  models: models.map((m) => ({ meta: { modelKey: m.key, sha256: m.sha256 } })),
  elements: models.flatMap((m) => m.elements)
})

function synPlane(g: Gen): SecPlane {
  return g.bool(0.4)
    ? NO_PLANE
    : { name: g.word(6), offset: g.int(-5000, 5000), flip: g.bool(), cut: g.bool() }
}

function synRule(g: Gen, keys: readonly string[]): Rule {
  const r: Rule = g.bool(0.3)
    ? { prop: 'Model', op: '=', val: g.bool(0.7) ? g.pick(keys) : g.pick(['m1', 'm2', 'ghost']) }
    : {
        prop: g.pick(['IfcEntity', 'Level', 'Pset_WallCommon.FireRating', g.word()]),
        op: g.pick(['=', '!=', '~', '>', '<', 'absent'] as const),
        val: g.pick([g.word(), g.int(-100, 100), null, ''])
      }
  if (g.bool(0.6)) r.join = g.pick(['and', 'or'] as const)
  return r
}

function synStack(g: Gen, keys: readonly string[]): FilterStep[] {
  const out: FilterStep[] = []
  for (let i = g.int(0, 3); i > 0; i--) {
    const step: FilterStep = {
      id: 'f' + g.hex(6),
      on: g.bool(),
      action: g.pick(['isolate', 'hide', 'highlight'] as const),
      rules: Array.from({ length: g.int(0, 3) }, () => synRule(g, keys))
    }
    if (g.bool(0.7)) step.color = g.pick(HL)
    out.push(step)
  }
  return out
}

function synHidden(g: Gen, models: readonly SynModel[]): Record<number, boolean> {
  const out: Record<number, boolean> = {}
  for (const el of g.some(models.flatMap((m) => m.elements))) out[el.id] = true
  return out
}

function synSchedule(g: Gen, name: string): ScheduleDef {
  const def = parseScheduleDef({
    version: 1,
    name,
    entity: g.some(['IfcWall', 'IfcDoor', 'IfcColumn'], 0.5),
    columns: [{ field: { kind: 'core', key: g.pick(['name', 'entity', 'mark']) }, heading: g.word() }],
    filters: [],
    sort: [],
    itemize: g.bool(),
    grandTotal: g.bool()
  })
  return JSON.parse(JSON.stringify(def)) as ScheduleDef
}

const cam = (g: Gen): ProjectSource['cam'] => ({
  theta: g.rnd() * 6,
  phi: g.rnd() * 3,
  dist: g.rnd() * 200,
  half: g.rnd() * 50,
  target: g.xyz(),
  proj: g.pick(['persp', 'ortho'] as const)
})

function synSource(g: Gen, models: readonly SynModel[]): ProjectSource {
  const keys = models.map((m) => m.key)
  const storeys = Array.from({ length: g.int(0, 4) }, () => g.word(6))
  const storeyVis = Object.fromEntries(g.some(storeys, 0.6).map((s) => [s, g.bool()]))
  const sections = (): Sections => ({ grid: synPlane(g), level: synPlane(g) })
  const views: ProjectViewpoint[] = Array.from({ length: g.int(0, 3) }, (_, i) => {
    const s = sections()
    return {
      id: 1_762_500_000_000 + i,
      name: g.word(),
      sub: g.word(),
      cam: g.bool(0.8) ? cam(g) : null,
      section: legacySection(s),
      sections: s,
      hidden: synHidden(g, models),
      storeyVis: Object.fromEntries(g.some(storeys).map((x) => [x, g.bool()])),
      modelVis: Object.fromEntries(g.some(keys).map((k) => [k, g.bool()])),
      stack: synStack(g, keys),
      active: g.bool(0.3) ? g.pick(keys) : null,
      grids: g.bool(),
      levels: g.bool(),
      frame: IDENTITY_FRAME_KEY,
      idStride: ID_STRIDE
    }
  })
  const filterSets: FilterSet[] = Array.from({ length: g.int(0, 3) }, (_, i) => {
    const f: FilterSet = { id: 1_762_400_000_000 + i, label: g.word(), stack: synStack(g, keys) }
    if (g.bool(0.2)) {
      f.mode = 'isolate'
      f.rules = [synRule(g, keys)]
    }
    return f
  })
  const schedules = Array.from({ length: g.int(0, 2) }, (_, i) => {
    const name = `Schedule ${i} ${g.word(4)}`
    return { name, def: synSchedule(g, name), savedAt: '2026-11-07T09:4' + i + ':00.000Z' }
  })
  const measures: ProjectMeasure[] = Array.from({ length: g.int(0, 3) }, () => {
    const m: ProjectMeasure = { p: g.xyz(), sides: {} }
    for (const axis of g.some(['x', 'y', 'z'] as const, 0.6)) {
      const minus = g.bool(0.8) ? g.coord() : null
      const plus = g.bool(0.8) ? g.coord() : null
      m[axis] = (minus ?? 0) + (plus ?? 0)
      m.sides[axis] = { minus, plus }
    }
    return m
  })
  return {
    hidden: synHidden(g, models),
    storeyVis,
    modelVis: Object.fromEntries(g.some(keys).map((k) => [k, false])),
    active: g.bool(0.3) ? g.pick(keys) : null,
    // Some models carry the user's own colour — the grey `MC[0]` among them — and some none.
    modelColors: Object.fromEntries(
      g.some(keys, 0.5).map((k) => [k, g.bool(0.3) ? MC[0] : g.pick([...MC, ...SCHEME])])
    ),
    nativeMats: g.bool(),
    treeMode: g.pick(['entity', 'type'] as const),
    grids: g.bool(),
    levels: g.bool(),
    shadows: g.bool(),
    snap: g.bool(),
    dims: g.bool(),
    sections: sections(),
    stack: synStack(g, keys),
    view: g.pick([null, 'iso', 'top', 'N']),
    units: g.pick(DISPLAY_UNITS),
    groundGrid: g.bool(),
    cam: g.bool(0.8) ? cam(g) : null,
    views,
    filterSets,
    schedules,
    openSchedule: g.bool(0.5) ? synSchedule(g, 'Open ' + g.word(4)) : null,
    spots: Array.from({ length: g.int(0, 3) }, () => ({ p: g.xyz() })),
    measures
  }
}

function synContext(g: Gen, models: readonly SynModel[], win: boolean): ProjectContext {
  const byId = new Map(models.flatMap((m) => m.elements.map((e) => [e.id, e])))
  const dir = win ? 'C:\\Reviews\\Tower' : '/srv/reviews/tower'
  const sep = win ? '\\' : '/'
  return {
    projectPath: dir + sep + 'review.sgvue',
    savedBy: 'SGVue 1.4.0',
    savedAt: '2026-11-07T09:45:00.000Z',
    models: models.map((m) => ({
      key: m.key,
      path: g.bool(0.5) ? dir + sep + 'models' + sep + m.key + '.ifc' : (win ? 'D:\\elsewhere\\' : '/Volumes/x/') + m.key + '.ifc',
      name: m.key + '.ifc',
      sha256: m.sha256,
      size: g.int(0, 600_000_000),
      label: m.key,
      colour: MC[m.slot % MC.length],
      // 2026-11-07 (D12): some rows show a colour the open project assigned.
      ...(g.bool(0.3) ? { assigned: true } : {})
    })),
    offset: [g.int(-40_000, 40_000), g.int(-40_000, 40_000), g.int(-100, 100)],
    elementRef: (id) => {
      const e = byId.get(id)
      return e ? { model: e.model, guid: e.guid } : null
    }
  }
}

/**
 * The state a source is expected to come back as: the restored shape of the same review. A colour
 * the project assigned comes back as assigned — unless the user picked one, which wins (D12).
 */
const expectedOf = (s: ProjectSource, ctx: ProjectContext): ProjectRestore => ({
  ...s,
  assignedColors: Object.fromEntries(
    ctx.models.filter((m) => m.assigned && !s.modelColors[m.key]).map((m) => [m.key, m.colour])
  ),
  hidden: Object.fromEntries(Object.keys(s.hidden).map((k) => [k, true])),
  views: s.views as RestoredViewpoint[],
  spots: s.spots as ProjectRestore['spots'],
  measures: s.measures as ProjectRestore['measures'],
  schedules: [...s.schedules],
  filterSets: [...s.filterSets]
})

function read(text: string): ProjectFile {
  const r = readProject(text)
  if (!r.ok) throw new Error(r.message)
  return r.project
}

/* ────────────────────────────── round trip ────────────────────────────── */

describe('round trip: 500 seeded review states', () => {
  it('write → read → plan gives back the same state, and a re-save is the same text', () => {
    const kinds = { own: 0, ownGrey: 0, notOwn: 0, assigned: 0 }
    for (let seed = 1; seed <= 500; seed++) {
      const g = new Gen(mulberry32(seed))
      const models = synModels(g)
      const source = synSource(g, models)
      const ctx = synContext(g, models, seed % 2 === 0)
      const { project, dropped } = projectOf(source, ctx)
      expect(dropped, `seed ${seed}`).toEqual({ elements: 0, cameras: 0, items: 0 })
      const text = projectText(project)
      const back = read(text)
      expect(projectText(back), `seed ${seed}`).toBe(text)
      // The live federation lists its elements in another order: nothing may depend on it.
      const fed = fedOf(models)
      const shuffled = { ...fed, elements: [...fed.elements].reverse() }
      const plan = restorePlanOf(back, shuffled, { offset: ctx.offset })
      expect(plan.missing, `seed ${seed}`).toEqual([])
      expect(plan.unmatched, `seed ${seed}`).toEqual({})
      expect(plan.models, `seed ${seed}`).toEqual(Object.fromEntries(models.map((m, i) => [`m${i + 1}`, m.key])))
      expect(plan.state, `seed ${seed}`).toEqual(expectedOf(source, ctx))
      for (const m of back.models) {
        expect(m.own && m.assigned, `seed ${seed}`).toBeFalsy()
        if (m.assigned) kinds.assigned++
        if (!m.own) kinds.notOwn++
        else if (m.colour === MC[0]) kinds.ownGrey++
        else kinds.own++
      }
    }
    // The generator made all three kinds, many times over.
    expect(Math.min(kinds.own, kinds.ownGrey, kinds.notOwn, kinds.assigned)).toBeGreaterThan(50)
  })

  it('a model with no colour of the user’s comes back with none, and keeps the accent for its cut', () => {
    const g = new Gen(mulberry32(41))
    const models = synModels(g).slice(0, 1)
    const key = models[0].key
    const source: ProjectSource = { ...synSource(g, models), modelColors: {} }
    // The row showed the slot's grey, `MC[0]`: written as a record, not as the user's.
    const ctx = { ...synContext(g, models, false), models: synContext(g, models, false).models.map((m) => ({ ...m, colour: MC[0] })) }
    const file = read(projectText(projectOf(source, ctx).project))
    expect(file.models[0]).toMatchObject({ colour: MC[0], own: false })
    const plan = restorePlanOf(file, fedOf(models), { offset: ctx.offset })
    expect(plan.state.modelColors).toEqual({})
    expect(cutSwatch(key, 0, [], plan.state.modelColors)).toBeNull()
  })

  it('a grey the user picked stays the user’s', () => {
    const g = new Gen(mulberry32(43))
    const models = synModels(g).slice(0, 1)
    const key = models[0].key
    const source: ProjectSource = { ...synSource(g, models), modelColors: { [key]: MC[0] } }
    const ctx = synContext(g, models, false)
    const file = read(projectText(projectOf(source, ctx).project))
    expect(file.models[0]).toMatchObject({ colour: MC[0], own: true })
    const plan = restorePlanOf(file, fedOf(models), { offset: ctx.offset })
    expect(plan.state.modelColors).toEqual({ [key]: MC[0] })
    expect(cutSwatch(key, 0, [], plan.state.modelColors)).toBe(MC[0])
  })

  it('stores the camera and the markups in world coordinates', () => {
    const g = new Gen(mulberry32(7))
    const models = synModels(g)
    const source = { ...synSource(g, models), spots: [{ p: [1.5, 2.25, -0.5] }] }
    const ctx = { ...synContext(g, models, false), offset: [12345, 23456, 5] as const }
    const { project } = projectOf(source, ctx)
    expect(project.markups.spots[0].at).toEqual([12346.5, 23458.25, 4.5])
    // Opened where the federation offset is another one, the point is the same place.
    const plan = restorePlanOf(read(projectText(project)), fedOf(models), { offset: [12000, 23000, 0] })
    expect(plan.state.spots[0].p).toEqual([346.5, 458.25, 4.5])
  })

  it('keeps arbitrary floating-point coordinates to well under a micrometre', () => {
    const g = new Gen(mulberry32(11))
    const models = synModels(g)
    const source: ProjectSource = {
      ...synSource(g, models),
      cam: { theta: 1, phi: 1, dist: 10, half: 3, target: [0.1, -0.7, 3.3], proj: 'persp' },
      spots: [{ p: [Math.PI, Math.E, -Math.SQRT2] }]
    }
    const ctx = { ...synContext(g, models, false), offset: [-33012, 41057, 12] as const }
    const plan = restorePlanOf(read(projectText(projectOf(source, ctx).project)), fedOf(models), {
      offset: ctx.offset
    })
    const near = (a: readonly number[], b: readonly number[]): void =>
      a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(1e-9))
    near(plan.state.cam!.target, [0.1, -0.7, 3.3])
    near(plan.state.spots[0].p, [Math.PI, Math.E, -Math.SQRT2])
  })
})

/* ────────────────────────────── re-export ────────────────────────────── */

describe('re-export: express ids renumbered, the model on another slot under another key', () => {
  const g = new Gen(mulberry32(2026))
  const guids = Array.from({ length: 40 }, () => g.guid())
  const original: SynModel = {
    key: 'Synthetic ARC',
    slot: 0,
    sha256: 'a'.repeat(64),
    elements: guids.map((guid, i) => ({ id: fedId(0, 100 + i), guid, model: 'Synthetic ARC', expressId: 100 + i }))
  }
  const other: SynModel = {
    key: 'Synthetic STR',
    slot: 1,
    sha256: 'b'.repeat(64),
    elements: [{ id: fedId(1, 7), guid: g.guid(), model: 'Synthetic STR', expressId: 7 }]
  }
  const id = (guid: string): number => original.elements.find((e) => e.guid === guid)!.id
  const hiddenGuids = guids.slice(0, 10)
  const viewGuids = guids.slice(10, 15)
  const source: ProjectSource = {
    ...synSource(new Gen(mulberry32(1)), [original, other]),
    hidden: Object.fromEntries([...hiddenGuids.map(id), other.elements[0].id].map((x) => [x, true])),
    active: 'Synthetic ARC',
    stack: [
      {
        id: 'f1',
        on: true,
        action: 'hide',
        rules: [
          { prop: 'Model', op: '=', val: 'Synthetic ARC' },
          { prop: 'Model', op: '=', val: 'Synthetic STR', join: 'or' }
        ]
      }
    ],
    views: [
      {
        id: 1,
        name: 'Lobby',
        sub: '5 hidden',
        cam: null,
        sections: { grid: NO_PLANE, level: NO_PLANE },
        section: legacySection({ grid: NO_PLANE, level: NO_PLANE }),
        hidden: Object.fromEntries(viewGuids.map((x) => [id(x), true])),
        storeyVis: {},
        modelVis: { 'Synthetic ARC': false },
        stack: [],
        active: 'Synthetic ARC',
        grids: true,
        levels: true,
        frame: IDENTITY_FRAME_KEY,
        idStride: ID_STRIDE
      }
    ],
    spots: [{ p: [1, 2, 3] }],
    measures: [{ p: [4, 5, 6], x: 3, sides: { x: { minus: 1, plus: 2 } } }]
  }
  const ctx: ProjectContext = {
    ...synContext(new Gen(mulberry32(2)), [original, other], false),
    offset: [100, 200, 0],
    elementRef: (x) => {
      const e = [...original.elements, ...other.elements].find((el) => el.id === x)
      return e ? { model: e.model, guid: e.guid } : null
    }
  }
  const project = read(projectText(projectOf(source, ctx).project))

  // The re-export: every express id renumbered, the elements in another order, the model on slot
  // 3 under the key a second pick of the same stem gets. Two elements are gone (one hidden, one
  // in the viewpoint), one GlobalId is now carried by two elements, one new element is added;
  // the STR model is not opened at all.
  const gone = new Set([hiddenGuids[0], viewGuids[0]])
  const reKey = 'Synthetic ARC (2)'
  const renumbered = guids
    .filter((guid) => !gone.has(guid))
    .map((guid, i) => ({ id: fedId(3, 5000 + 37 * i), guid, model: reKey }))
    .reverse()
  const twin = { id: fedId(3, 99_999), guid: hiddenGuids[1], model: reKey }
  const fresh = { id: fedId(3, 88_888), guid: g.guid(), model: reKey }
  const live: ProjectFederation = {
    models: [{ meta: { modelKey: reKey, sha256: 'c'.repeat(64) } }],
    elements: [...renumbered, twin, fresh]
  }
  const newId = (guid: string): number => renumbered.find((e) => e.guid === guid)!.id
  const plan = restorePlanOf(project, live, { bind: new Map([['m1', reKey]]), offset: [90, 210, 0] })

  it('lands hidden items on the same elements by GlobalId', () => {
    const want = Object.fromEntries(
      [...hiddenGuids.slice(1).map(newId), twin.id].map((x) => [x, true])
    )
    expect(plan.state.hidden).toEqual(want)
  })

  it('lands a viewpoint on the same elements, its model eye and activate mode on the new key', () => {
    const vp = plan.state.views[0]
    expect(vp.hidden).toEqual(Object.fromEntries(viewGuids.slice(1).map((x) => [newId(x), true])))
    expect(vp.modelVis).toEqual({ [reKey]: false })
    expect(vp.active).toBe(reKey)
  })

  it('carries a Model rule and activate mode to the key the model is open under', () => {
    expect(project.visibility.stack[0].rules[0].val).toEqual({ model: 'm1' })
    expect(plan.state.stack[0].rules[0].val).toBe(reKey)
    expect(plan.state.active).toBe(reKey)
  })

  it('names a model that is not open by the key its file will get', () => {
    // m2's file is `Synthetic STR.ifc` (`synContext`); Locate… will open it as `Synthetic STR`.
    expect(project.models[1].name).toBe('Synthetic STR.ifc')
    expect(plan.state.stack[0].rules[1].val).toBe(modelKeyOf('Synthetic STR.ifc'))
    expect(plan.state.stack[0].rules[1].val).toBe('Synthetic STR')
  })

  it('puts the markups in the same world place', () => {
    expect(plan.state.spots).toEqual([{ p: [11, -8, 3] }])
    expect(plan.state.measures[0].p).toEqual([14, -5, 6])
    expect(plan.state.measures[0].sides).toEqual({ x: { minus: 1, plus: 2 } })
  })

  it('counts what no longer matched, per model, and names the model that is not open', () => {
    expect(plan.missing).toEqual(['m2'])
    expect(plan.models).toEqual({ m1: reKey })
    expect(plan.unmatched).toEqual({
      m1: { hidden: 1, viewpoints: 1 },
      m2: { hidden: 1, viewpoints: 0 }
    })
  })

  it('binds by SHA-256 when no binding is given, and by nothing when the file changed', () => {
    const same = restorePlanOf(project, fedOf([original, other]))
    expect(same.models).toEqual({ m1: 'Synthetic ARC', m2: 'Synthetic STR' })
    expect(restorePlanOf(project, live).missing).toEqual(['m1', 'm2'])
  })
})

/* ────────────────────────────── hostile files ────────────────────────────── */

/** A small valid project to break one piece of at a time. */
function validProject(): Record<string, unknown> {
  const g = new Gen(mulberry32(99))
  const models = synModels(g)
  return JSON.parse(projectText(projectOf(synSource(g, models), synContext(g, models, false)).project)) as Record<
    string,
    unknown
  >
}
const firstModel = (p: Record<string, unknown>): Record<string, unknown> =>
  (p.models as Record<string, unknown>[])[0]

function refused(text: unknown, match?: RegExp): void {
  let r: ReturnType<typeof readProject> | undefined
  expect(() => (r = readProject(text as string))).not.toThrow()
  expect(r!.ok).toBe(false)
  if (r!.ok) return
  expect(r!.message.length).toBeGreaterThan(0)
  if (match) expect(r!.message).toMatch(match)
}

describe('hostile files are refused with a message and never throw', () => {
  it('reads the unbroken file', () => {
    expect(readProject(JSON.stringify(validProject())).ok).toBe(true)
  })

  it('malformed text', () => {
    for (const t of ['', '{', 'not json', '{"format": "sgvue-project",}']) refused(t, /not valid JSON/)
    for (const t of ['null', '[]', '42', '"x"', '[{"format": "sgvue-project", "version": 1}]']) {
      refused(t, /not an SGVue project/)
    }
    refused(42)
    refused(undefined)
  })

  it('a file over 16 MB, by characters and by UTF-8 bytes', () => {
    refused('x'.repeat(PROJECT_MAX_BYTES + 1), /16 MB/)
    // 6 M euro signs are 6 M characters but 18 MB of UTF-8.
    refused(JSON.stringify({ format: 'sgvue-project', pad: '€'.repeat(6_000_000) }), /16 MB/)
  })

  it('another format, and a version this build cannot read', () => {
    refused(JSON.stringify({ ...validProject(), format: 'ifc-viewer' }), /not an SGVue project/)
    const { format: _f, ...noFormat } = validProject()
    void _f
    refused(JSON.stringify(noFormat), /not an SGVue project/)
    refused(JSON.stringify({ ...validProject(), version: 2 }), /newer SGVue.*update the app/)
    for (const v of [0, 1.5, '1', null]) refused(JSON.stringify({ ...validProject(), version: v }), /version/)
  })

  it('a relPath that is absolute, on a drive, UNC, or holds a NUL', () => {
    for (const rel of [
      '/etc/passwd',
      '\\Windows\\x.ifc',
      'C:\\models\\a.ifc',
      'C:a.ifc',
      'c:/a.ifc',
      '\\\\server\\share\\a.ifc',
      '//server/share/a.ifc',
      'a\u0000b.ifc',
      'a.ifc:stream',
      '',
      '.',
      'a/..'
    ]) {
      const p = validProject()
      firstModel(p).relPath = rel
      refused(JSON.stringify(p), /relPath/)
    }
  })

  it('a relPath that climbs out of the project folder is read, and reported', () => {
    const p = validProject()
    firstModel(p).relPath = 'models\\..\\..\\shared/./a.ifc'
    const r = readProject(JSON.stringify(p))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.project.models[0].relPath).toBe('../shared/a.ifc')
    expect(r.outside).toEqual([r.project.models[0].id])
  })

  it('a model whose colour does not say whether it is the user’s', () => {
    for (const own of [undefined, 'yes', 1, null]) {
      const p = validProject()
      firstModel(p).own = own
      refused(JSON.stringify(p), /own/)
    }
  })

  it('a colour that is both the user’s own and assigned, or an `assigned` that is not a boolean', () => {
    const both = validProject()
    Object.assign(firstModel(both), { own: true, assigned: true })
    refused(JSON.stringify(both), /both the user’s own colour and an assigned one/)
    for (const assigned of ['yes', 1, null, {}]) {
      const p = validProject()
      Object.assign(firstModel(p), { own: false, assigned })
      refused(JSON.stringify(p), /assigned/)
    }
    // Absent and false both read as "not assigned".
    for (const assigned of [undefined, false]) {
      const p = validProject()
      Object.assign(firstModel(p), { own: false, assigned })
      expect(readProject(JSON.stringify(p)).ok).toBe(true)
    }
  })

  it('an absPath that is not absolute, a bad digest, two models with one id', () => {
    const rel = validProject()
    firstModel(rel).absPath = 'models/a.ifc'
    refused(JSON.stringify(rel), /absolute/)
    const sha = validProject()
    firstModel(sha).sha256 = 'XYZ'
    refused(JSON.stringify(sha), /SHA-256/)
    const two = validProject()
    const ms = two.models as unknown[]
    two.models = [ms[0], ms[0]]
    refused(JSON.stringify(two), /one id/)
  })

  it('over-long strings', () => {
    const name = validProject()
    firstModel(name).name = 'n'.repeat(MAX_TEXT + 1)
    refused(JSON.stringify(name))
    const guid = validProject()
    ;(guid.visibility as Record<string, unknown>).hidden = [['m1', 'g'.repeat(65)]]
    refused(JSON.stringify(guid))
    const id = validProject()
    ;(id.visibility as Record<string, unknown>).active = 'm'.repeat(65)
    refused(JSON.stringify(id))
  })

  it('over-long lists', () => {
    const vps = validProject()
    vps.viewpoints = Array.from({ length: MAX_VIEWPOINTS + 1 }, () => ((vps.viewpoints as unknown[])[0] ?? {}))
    refused(JSON.stringify(vps))
    const storeys = validProject()
    ;(storeys.view as Record<string, unknown>).storeyVis = Object.fromEntries(
      Array.from({ length: MAX_STOREYS + 1 }, (_, i) => ['L' + i, false])
    )
    refused(JSON.stringify(storeys), /entries/)
    const step = { id: 'f', on: true, action: 'hide', rules: [] }
    const steps = validProject()
    ;(steps.visibility as Record<string, unknown>).stack = Array.from({ length: MAX_STEPS + 1 }, () => step)
    refused(JSON.stringify(steps))
    const rules = validProject()
    ;(rules.visibility as Record<string, unknown>).stack = [
      { ...step, rules: Array.from({ length: MAX_RULES + 1 }, () => ({ prop: 'IfcEntity', op: '=', val: 'x' })) }
    ]
    refused(JSON.stringify(rules))
    const spots = validProject()
    ;(spots.markups as Record<string, unknown>).spots = Array.from({ length: MAX_MARKUPS + 1 }, () => ({ at: [0, 0, 0] }))
    refused(JSON.stringify(spots))
  })

  it('a "__proto__" key anywhere', () => {
    const at = JSON.stringify(validProject())
    refused(at.replace('{', '{"__proto__":{"polluted":true},'), /__proto__/)
    refused(at.replace('"storeyVis":{', '"storeyVis":{"__proto__":false,'), /__proto__/)
    refused(at.replace('"sections":{', '"sections":{"__proto__":{"name":"x"},'), /__proto__/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('a model id that is an object property name — or anything the writer does not write', () => {
    const at = (p: Record<string, unknown>, id: string, where: string): void => {
      const vis = p.visibility as Record<string, unknown>
      const vps = p.viewpoints as Record<string, unknown>[]
      const view = { id: 1, name: 'v', sub: '', camera: null, sections: {}, hidden: [], storeyVis: {}, modelVis: {}, stack: [], active: null, grids: true, levels: true }
      if (where === 'model') firstModel(p).id = id
      if (where === 'ref') vis.hidden = [[id, 'SynArc0000000000000001']]
      if (where === 'active') vis.active = id
      if (where === 'modelVis') p.viewpoints = [...vps, { ...view, modelVis: { [id]: false } }]
      if (where === 'rule') vis.stack = [{ id: 'f', on: true, action: 'hide', rules: [{ prop: 'Model', op: '=', val: { model: id } }] }]
    }
    for (const id of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'm0', 'M1', 'm1 ', 'm1234567', 'x']) {
      for (const where of ['model', 'ref', 'active', 'modelVis', 'rule']) {
        const p = validProject()
        at(p, id, where)
        // A computed `[id]` key is an own property, so `__proto__` reaches the text as a key too.
        refused(JSON.stringify(p))
      }
    }
    expect(({} as Record<string, unknown>).hidden).toBeUndefined()
    expect(({} as Record<string, unknown>).viewpoints).toBeUndefined()
  })

  it('a Model value on another rule, or naming a model the file does not list', () => {
    const other = validProject()
    ;(other.visibility as Record<string, unknown>).stack = [
      { id: 'f', on: true, action: 'hide', rules: [{ prop: 'IfcEntity', op: '=', val: { model: 'm1' } }] }
    ]
    refused(JSON.stringify(other), /not a Model rule/)
    const unlisted = validProject()
    ;(unlisted.visibility as Record<string, unknown>).stack = [
      { id: 'f', on: true, action: 'hide', rules: [{ prop: 'Model', op: '=', val: { model: 'm199' } }] }
    ]
    refused(JSON.stringify(unlisted), /does not list/)
  })

  it('wrong types and a schedule this build cannot read', () => {
    const cam = validProject()
    ;(cam.view as Record<string, unknown>).camera = { theta: 'a' }
    refused(JSON.stringify(cam))
    const units = validProject()
    ;(units.view as Record<string, unknown>).units = 'yd'
    refused(JSON.stringify(units))
    const sched = validProject()
    ;(sched.schedules as Record<string, unknown>).open = { version: 9, columns: [] }
    refused(JSON.stringify(sched), /newer version/)
    const cols = validProject()
    ;(cols.schedules as Record<string, unknown>).open = { version: 1, columns: [] }
    refused(JSON.stringify(cols), /no usable columns/)
  })

  it('deep nesting', () => {
    refused('['.repeat(200_000) + ']'.repeat(200_000), /nested too deeply/)
    const p = validProject()
    refused(JSON.stringify(p).replace('"storeyVis":{', '"storeyVis":{"x":' + '['.repeat(50_000) + ']'.repeat(50_000) + ','))
  })

  it('ignores unknown keys, at any level', () => {
    const p = validProject()
    p.future = { anything: [1, 2] }
    firstModel(p).later = 'x'
    ;(p.view as Record<string, unknown>).fog = true
    const r = readProject(JSON.stringify(p))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect('future' in r.project).toBe(false)
    expect('later' in r.project.models[0]).toBe(false)
    expect('fog' in r.project.view).toBe(false)
  })
})

describe('the restore planner never writes to a prototype', () => {
  const project = (): ProjectFile => read(JSON.stringify(validProject()))
  const before = Object.getOwnPropertyNames(Object.prototype).sort()

  it('a reference to a model id the schema would refuse, handed in directly', () => {
    const p = project()
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      p.visibility.hidden = [[id, 'g'], [id, 'h']]
      p.viewpoints = [
        {
          id: 1,
          name: 'v',
          sub: '',
          camera: null,
          sections: { grid: NO_PLANE, level: NO_PLANE },
          hidden: [[id, 'g']],
          storeyVis: {},
          modelVis: { [id]: false },
          stack: [{ id: 'f', on: true, action: 'hide', rules: [{ prop: 'Model', op: '=', val: { model: id } }] }],
          active: id,
          grids: true,
          levels: true
        }
      ]
      const plan = restorePlanOf(p, { models: [], elements: [] })
      expect(plan.unmatched[id]).toEqual({ hidden: 2, viewpoints: 1 })
      expect(plan.state.views[0].active).toBeNull()
      expect(Object.keys(plan.state.views[0].modelVis)).toEqual([])
    }
    expect(({} as Record<string, unknown>).hidden).toBeUndefined()
    expect(({} as Record<string, unknown>).viewpoints).toBeUndefined()
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before)
  })

  it('a live model whose key is `__proto__` (a file named `__proto__.ifc`)', () => {
    const p = project()
    p.models[0].visible = false
    p.models[0].own = true
    const sv = Object.create(null) as Record<string, boolean>
    sv['__proto__'] = false
    p.view.storeyVis = sv
    const plan = restorePlanOf(
      p,
      { models: [{ meta: { modelKey: '__proto__', sha256: p.models[0].sha256 } }], elements: [] },
      { bind: new Map([[p.models[0].id, '__proto__']]) }
    )
    expect(Object.keys(plan.state.modelVis)).toEqual(['__proto__'])
    expect(Object.keys(plan.state.modelColors)).toEqual(['__proto__'])
    expect(Object.keys(plan.state.storeyVis)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(plan.state.modelVis)).toBeNull()
    expect(({} as Record<string, unknown>).hidden).toBeUndefined()
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before)
  })
})

describe('a Model rule names a model by its id, tagged; any other value is literal', () => {
  const g = new Gen(mulberry32(31))
  const models = synModels(g).slice(0, 1)
  const ctx = synContext(g, models, false)
  const key = models[0].key
  const source: ProjectSource = {
    ...synSource(g, models),
    stack: [
      {
        id: 'f',
        on: true,
        action: 'isolate',
        rules: [
          { prop: 'Model', op: '=', val: key },
          // A model that is not loaded, though its key reads like the file's model id.
          { prop: 'Model', op: '=', val: 'm1', join: 'or' },
          { prop: 'Model', op: '~', val: key.slice(0, 1), join: 'or' },
          { prop: 'Name', op: '=', val: key, join: 'or' }
        ]
      }
    ]
  }
  const file = read(projectText(projectOf(source, ctx).project))

  it('writes the loaded model tagged and leaves every other value as written', () => {
    expect(file.visibility.stack[0].rules.map((r) => r.val)).toEqual([
      { model: 'm1' },
      'm1',
      key.slice(0, 1),
      key
    ])
  })

  it('reads the tag back as the live key and the literal as itself', () => {
    const plan = restorePlanOf(file, { models: [{ meta: { modelKey: 'Opened Again', sha256: 'x' } }], elements: [] }, {
      bind: new Map([['m1', 'Opened Again']])
    })
    expect(plan.state.stack[0].rules.map((r) => r.val)).toEqual(['Opened Again', 'm1', key.slice(0, 1), key])
  })

  it('reads the tag of a model that is not open as the key its file name gives', () => {
    const plan = restorePlanOf(file, { models: [], elements: [] })
    expect(plan.missing).toEqual(['m1'])
    expect(plan.state.stack[0].rules[0].val).toBe(modelKeyOf(file.models[0].name))
    expect(plan.state.stack[0].rules[1].val).toBe('m1')
  })

  it('the key rule is the app’s own', () => {
    expect(storeModelKeyOf).toBe(modelKeyOf)
    expect(modelKeyOf('Tower A - ARC.ifc')).toBe('Tower A - ARC')
    expect(modelKeyOf('a.b.ifczip')).toBe('a.b')
  })
})

/* ────────────────────────────── the writer's bounds ────────────────────────────── */

describe('the writer stays inside the bounds it reads, and counts what it leaves out', () => {
  const g = new Gen(mulberry32(5))
  const models = synModels(g).map((m) => ({ ...m, elements: [...m.elements] }))
  models[0].elements.push({ id: fedId(0, 999_999_999), guid: '', model: models[0].key, expressId: 999_999_999 })
  const base = synSource(g, models)
  const ctx = synContext(g, models, false)
  const vp = (over: Partial<ProjectViewpoint>): ProjectViewpoint => ({
    id: 1,
    name: 'Viewpoint 1',
    sub: '3D',
    cam: null,
    sections: { grid: NO_PLANE, level: NO_PLANE },
    hidden: {},
    storeyVis: {},
    modelVis: {},
    stack: [],
    active: null,
    grids: true,
    levels: true,
    frame: IDENTITY_FRAME_KEY,
    idStride: ID_STRIDE,
    ...over
  })

  it('clips long text, drops what it cannot name and counts each', () => {
    const source: ProjectSource = {
      ...base,
      hidden: { [fedId(0, 999_999_999)]: true, 123: true },
      storeyVis: { ['L'.repeat(MAX_TEXT + 1)]: false, L1: false },
      views: [
        vp({ name: 'v'.repeat(5000) }),
        vp({ hidden: { 1: true }, idStride: undefined }),
        vp({ frame: 'x,y,z@1', cam: { theta: 0, phi: 0, dist: 1, half: 1, target: [0, 0, 0], proj: 'persp' } })
      ]
    }
    const { project, dropped } = projectOf(source, ctx)
    // The element with no GlobalId, the id no element has, and the legacy-numbered viewpoint id.
    expect(dropped).toEqual({ elements: 3, cameras: 1, items: 1 })
    expect(project.viewpoints[0].name.length).toBe(MAX_TEXT)
    expect(project.viewpoints[1].hidden).toEqual([])
    expect(project.viewpoints[2].camera).toBeNull()
    expect(project.view.storeyVis).toEqual({ L1: false })
    expect(readProject(projectText(project)).ok).toBe(true)
  })

  it('leaves out a model it cannot name, with its elements', () => {
    const noDigest = { ...ctx, models: ctx.models.map((m, i) => (i === 0 ? { ...m, sha256: '' } : m)) }
    const first = models[0].elements.filter((e) => e.guid)
    const { project, dropped } = projectOf({ ...base, hidden: Object.fromEntries(first.map((e) => [e.id, true])), views: [] }, noDigest)
    expect(project.models.map((m) => m.name)).toEqual(ctx.models.slice(1).map((m) => m.name))
    expect(dropped.items).toBe(1)
    expect(dropped.elements).toBe(first.length)
    expect(readProject(projectText(project)).ok).toBe(true)
  })

  it('writes element references sorted, whatever order the ids came in', () => {
    const ids = models.flatMap((m) => m.elements.filter((e) => e.guid).map((e) => e.id))
    const a = projectOf({ ...base, hidden: Object.fromEntries(ids.map((i) => [i, true])) }, ctx)
    const b = projectOf({ ...base, hidden: Object.fromEntries([...ids].reverse().map((i) => [i, true])) }, ctx)
    expect(a.project.visibility.hidden).toEqual(b.project.visibility.hidden)
    const keys = a.project.visibility.hidden.map((r) => r.join('\n'))
    expect(keys).toEqual([...keys].sort())
  })
})

/* ────────────────────────────── paths ────────────────────────────── */

describe('paths', () => {
  it('knows an absolute path in either style', () => {
    for (const p of ['/a/b.ifc', 'C:\\a\\b.ifc', 'c:/a.ifc', '\\\\srv\\share\\a.ifc', '//srv/share/a.ifc']) {
      expect(isAbsolutePath(p), p).toBe(true)
    }
    for (const p of ['a/b.ifc', 'C:a.ifc', '\\a.ifc', '', '/a\u0000b']) expect(isAbsolutePath(p), p).toBe(false)
    expect(normaliseAbsolute('/a/./b/../c//d.ifc')).toBe('/a/c/d.ifc')
    expect(normaliseAbsolute('c:/a\\..\\b/d.ifc')).toBe('C:\\b\\d.ifc')
    expect(normaliseAbsolute('//srv/share/a/../b.ifc')).toBe('\\\\srv\\share\\b.ifc')
  })

  it('writes a relPath beside, below and above the project folder', () => {
    expect(relPathOf('/r/t/review.sgvue', '/r/t/a.ifc')).toBe('a.ifc')
    expect(relPathOf('/r/t/review.sgvue', '/r/t/models/a.ifc')).toBe('models/a.ifc')
    expect(relPathOf('/r/t/review.sgvue', '/r/shared/a.ifc')).toBe('../shared/a.ifc')
    expect(relPathOf('/r/t/review.sgvue', '/a.ifc')).toBe('../../a.ifc')
    expect(relPathOf('C:\\R\\T\\review.sgvue', 'c:\\r\\t\\Models\\A.ifc')).toBe('Models/A.ifc')
    expect(relPathOf('\\\\srv\\share\\t\\p.sgvue', '//SRV/share/m/a.ifc')).toBe('../m/a.ifc')
  })

  it('writes no relPath across drives, shares or styles, or for a name a relPath cannot hold', () => {
    expect(relPathOf('C:\\r\\p.sgvue', 'D:\\r\\a.ifc')).toBeNull()
    expect(relPathOf('\\\\a\\s\\p.sgvue', '\\\\b\\s\\a.ifc')).toBeNull()
    expect(relPathOf('/r/p.sgvue', 'C:\\r\\a.ifc')).toBeNull()
    expect(relPathOf('/r/p.sgvue', '/r/a\\b.ifc')).toBeNull()
    expect(relPathOf('/r/p.sgvue', '/r/a:b.ifc')).toBeNull()
    expect(relPathOf('r/p.sgvue', '/r/a.ifc')).toBeNull()
  })

  it('checks a relPath and says how far it climbs', () => {
    expect(checkRelPath('a/./b/../c.ifc')).toEqual({ ok: true, path: 'a/c.ifc', climbs: 0 })
    expect(checkRelPath('..\\..\\m\\a.ifc')).toEqual({ ok: true, path: '../../m/a.ifc', climbs: 2 })
    expect(checkRelPath('/a.ifc').ok).toBe(false)
  })

  it('resolves a relPath against the project, in the project path’s own style', () => {
    expect(resolveRelPath('/r/t/review.sgvue', 'models/a.ifc')).toBe('/r/t/models/a.ifc')
    expect(resolveRelPath('/r/t/review.sgvue', '../shared/a.ifc')).toBe('/r/shared/a.ifc')
    expect(resolveRelPath('C:\\R\\T\\review.sgvue', '../m/a.ifc')).toBe('C:\\R\\m\\a.ifc')
    expect(resolveRelPath('\\\\srv\\share\\t\\p.sgvue', '../a.ifc')).toBe('\\\\srv\\share\\a.ifc')
    // Past the root, through a drive, or against a relative project path: nothing.
    expect(resolveRelPath('/r/p.sgvue', '../../a.ifc')).toBeNull()
    expect(resolveRelPath('/r/p.sgvue', 'C:\\a.ifc')).toBeNull()
    expect(resolveRelPath('r/p.sgvue', 'a.ifc')).toBeNull()
  })

  it('a relPath written and resolved is the model’s own path', () => {
    for (const [proj, model] of [
      ['/srv/reviews/t/p.sgvue', '/srv/models/Tower A.ifc'],
      ['C:\\Reviews\\T\\p.sgvue', 'C:\\Reviews\\T\\models\\a b.ifc'],
      ['\\\\srv\\share\\p.sgvue', '\\\\srv\\share\\deep\\er\\a.ifc']
    ]) {
      expect(resolveRelPath(proj, relPathOf(proj, model)!)).toBe(normaliseAbsolute(model))
    }
  })
})

/* ────────────────────────────── colour (D12) ────────────────────────────── */

describe('leastUsedColour', () => {
  it('takes the palette colour the loaded models use least, ties in palette order', () => {
    expect(leastUsedColour(MC, [])).toBe(MC[0])
    expect(leastUsedColour(MC, [MC[0]])).toBe(MC[1])
    expect(leastUsedColour(MC, [MC[0], MC[1], MC[1]])).toBe(MC[2])
    expect(leastUsedColour(MC, [...MC])).toBe(MC[0])
    expect(leastUsedColour(MC, [...MC, MC[0], MC[2]])).toBe(MC[1])
  })

  it('compares without case and ignores a colour the palette does not have', () => {
    expect(leastUsedColour(['#AABBCC', '#112233'], ['#aabbcc', '#FFFFFF'])).toBe('#112233')
    expect(leastUsedColour([], ['#aabbcc'])).toBeNull()
  })
})

/* ────────────────────────────── carried models (phase 2) ────────────────────────────── */

describe('carryForward — a model the project names and is not open survives a save', () => {
  /** A seeded project of three models, written; then the same review opened with only the first. */
  function setup(seed: number) {
    const g = new Gen(mulberry32(seed))
    const models = synModels(g).slice(0, 3)
    while (models.length < 3) models.push(...synModels(g).slice(0, 3 - models.length))
    const source = synSource(g, models)
    const ctx = synContext(g, models, false)
    const opened = read(projectText(projectOf(source, ctx).project))
    // The one model still there is the first, the second or the third: a carried model's id is
    // then below, around or above the id the open one is written under.
    const open = models[seed % 3]
    const plan = restorePlanOf(opened, fedOf([open]), { offset: ctx.offset })
    const openCtx = { ...ctx, models: ctx.models.filter((m) => m.key === open.key) }
    return { g, models, source, ctx: openCtx, opened, plan }
  }
  const refsOf = (refs: readonly (readonly [string, string])[], ids: ReadonlySet<string>) =>
    refs.filter(([m]) => ids.has(m))

  it('writes the missing models back byte for byte, with every reference to them', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { models, ctx, opened, plan } = setup(seed)
      const carriedIds = new Set(plan.missing)
      expect(plan.missing.length, `seed ${seed}`).toBeGreaterThan(0)
      // What a save writes: the open model, under the state the restore gave the store.
      const state = plan.state
      const source: ProjectSource = { ...state, views: opened.viewpoints.map((v, i) => ({ ...state.views[i], id: v.id })) }
      const carried = opened.models
        .filter((m) => carriedIds.has(m.id))
        .map((m) => ({ id: m.id, key: modelKeyOf(m.name) }))
      const written = projectOf(source, { ...ctx, carried }).project
      const saved = read(projectText(carryForward(written, opened, plan.missing)))
      const pick = (p: ProjectFile) => p.models.filter((m) => carriedIds.has(m.id)).map((m) => JSON.stringify(m))
      expect(pick(saved), `seed ${seed}`).toEqual(pick(opened))
      expect(refsOf(saved.visibility.hidden, carriedIds), `seed ${seed}`).toEqual(
        refsOf(opened.visibility.hidden, carriedIds)
      )
      opened.viewpoints.forEach((v, i) => {
        expect(refsOf(saved.viewpoints[i].hidden, carriedIds), `seed ${seed}`).toEqual(refsOf(v.hidden, carriedIds))
        for (const id of carriedIds) expect(saved.viewpoints[i].modelVis[id], `seed ${seed}`).toBe(v.modelVis[id])
      })
      // A `Model` rule that named a missing model still names it, tagged by the same id.
      const tags = (p: ProjectFile) =>
        JSON.stringify(p.visibility.stack.flatMap((x) => x.rules.map((r) => r.val)).filter((v) => typeof v === 'object' && v && carriedIds.has((v as { model: string }).model)))
      expect(tags(saved), `seed ${seed}`).toBe(tags(opened))
      // The loaded model took an id the carried ones do not use.
      expect(new Set(saved.models.map((m) => m.id)).size, `seed ${seed}`).toBe(saved.models.length)
      void models
    }
  })

  it('carries nothing that is open again, or that the opened file does not have', () => {
    const { opened, ctx, plan } = setup(3)
    const written = projectOf({ ...plan.state, views: [] }, ctx).project
    expect(carryForward(written, opened, [])).toBe(written)
    expect(carryForward(written, opened, [written.models[0].id])).toBe(written)
    expect(carryForward(written, opened, ['m99'])).toBe(written)
  })
})
