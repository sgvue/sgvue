/**
 * 2026-11-07 — PredefinedType, seeded and randomised: ~300 ways of stating it, in one IFC4 file.
 *
 * The fixtures in `predefined-type.pipeline.test.ts` are the cases someone thought of. This
 * writes combinations nobody chose — the occurrence's code (`$`, NOTDEFINED, USERDEFINED, an
 * enumeration), its `ObjectType` (`$` or text), and either no type object or one with its own code,
 * `ElementType` and `Name` — as STEP text in memory, parses it once with web-ifc, and holds every
 * element to three invariants:
 *
 *   1. the property card's PredefinedType tile shows one of the file's own PredefinedType tokens
 *      for that element (the occurrence's or its type's), or nothing — never ObjectType,
 *      ElementType or Name text, which is the bug the owner reported;
 *   2. `effectivePredefinedType` is IfcOpenShell 0.8.4's `get_predefined_type`, re-written here
 *      from its Python source rather than imported from the app;
 *   3. a `PredefinedType` rule on either value matches, and `absent` matches only when both are
 *      empty.
 *
 * Every text value is lower case with a prefix, so it can never equal an enumeration token and
 * invariant 1 means something. The PRNG is seeded: the same seed writes the same file on every
 * run, and every failure message names the seed and the element.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import { matchFn, type Rule } from '../../src/shared/rules'
import { selectionCard } from '../../src/renderer/state/selectors/props'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'

const SEED = 20261107
const COUNT = 300

/** mulberry32 — a small, well-known 32-bit PRNG; no dependency. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CLASSES = {
  IfcWall: { type: 'IfcWallType', codes: ['SOLIDWALL', 'PARTITIONING', 'SHEAR', 'PARAPET'] },
  IfcSlab: { type: 'IfcSlabType', codes: ['FLOOR', 'ROOF', 'BASESLAB', 'LANDING'] }
} as const
type Cls = keyof typeof CLASSES

/** `null` is `$`. */
interface Case {
  cls: Cls
  occurrence: { code: string | null; objectType: string | null }
  type: { code: string | null; elementType: string | null; name: string } | null
}

function cases(seed: number): Case[] {
  const r = prng(seed)
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)]
  const code = (cls: Cls): string | null => pick([null, 'NOTDEFINED', 'USERDEFINED', pick(CLASSES[cls].codes)])
  const out: Case[] = []
  for (let i = 0; i < COUNT; i++) {
    const cls = pick(Object.keys(CLASSES) as Cls[])
    out.push({
      cls,
      occurrence: { code: code(cls), objectType: r() < 0.5 ? null : `ot-${i}` },
      type: r() < 0.35 ? null : { code: code(cls), elementType: r() < 0.5 ? null : `et-${i}`, name: `tn-${i}` }
    })
  }
  return out
}

const guid = (n: number): string => `F${String(n).padStart(21, '0')}`
const str = (v: string | null): string => (v === null ? '$' : `'${v}'`)
const enm = (v: string | null): string => (v === null ? '$' : `.${v}.`)

/** One minimal IFC4 file: units, Project → Site → Building → Storey, and every case contained in it. */
function stepText(list: readonly Case[]): string {
  const lines: string[] = []
  let id = 0
  const add = (body: string): number => {
    lines.push(`#${++id}=${body};`)
    return id
  }
  const metre = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')
  const units = add(`IFCUNITASSIGNMENT((#${metre}))`)
  const project = add(`IFCPROJECT('${guid(1)}',$,'Fuzz',$,$,$,$,$,#${units})`)
  const site = add(`IFCSITE('${guid(2)}',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$)`)
  const building = add(`IFCBUILDING('${guid(3)}',$,'Building',$,$,$,$,$,.ELEMENT.,$,$,$)`)
  const storey = add(`IFCBUILDINGSTOREY('${guid(4)}',$,'Level 1',$,$,$,$,$,.ELEMENT.,0.)`)
  add(`IFCRELAGGREGATES('${guid(5)}',$,$,$,#${project},(#${site}))`)
  add(`IFCRELAGGREGATES('${guid(6)}',$,$,$,#${site},(#${building}))`)
  add(`IFCRELAGGREGATES('${guid(7)}',$,$,$,#${building},(#${storey}))`)
  const elements: number[] = []
  list.forEach((c, i) => {
    const n = 100 + 3 * i
    const el = add(
      `${c.cls.toUpperCase()}('${guid(n)}',$,'fz-${i}',$,${str(c.occurrence.objectType)},$,$,$,${enm(c.occurrence.code)})`
    )
    elements.push(el)
    if (c.type) {
      const t = add(
        `${CLASSES[c.cls].type.toUpperCase()}('${guid(n + 1)}',$,'${c.type.name}',$,$,$,$,$,${str(c.type.elementType)},${enm(c.type.code)})`
      )
      add(`IFCRELDEFINESBYTYPE('${guid(n + 2)}',$,$,$,(#${el}),#${t})`)
    }
  })
  add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid(8)}',$,$,$,(${elements.map((e) => `#${e}`).join(',')}),#${storey})`)
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    "FILE_NAME('fuzz.ifc','2026-11-07T00:00:00',('SGVue test'),('SGVue'),'predefined-type.fuzz.test.ts','SGVue','none');",
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    ''
  ].join('\n')
}

/**
 * `ifcopenshell.util.element.get_predefined_type` (0.8.4), from its Python source: the type's
 * PredefinedType, its ElementType when that is USERDEFINED or empty, if neither empty nor
 * NOTDEFINED; else the occurrence's PredefinedType, its ObjectType when that is USERDEFINED or
 * empty. `None` is `''` here, as the index has it.
 */
function getPredefinedType(c: Case): string {
  if (c.type) {
    let t = c.type.code
    if (t === 'USERDEFINED' || !t) t = c.type.elementType
    if (t && t !== 'NOTDEFINED') return t
  }
  let p = c.occurrence.code
  if (p === 'USERDEFINED' || !p) p = c.occurrence.objectType
  return p ?? ''
}

describe(`PredefinedType, ${COUNT} seeded combinations (seed ${SEED})`, () => {
  const list = cases(SEED)
  const text = stepText(list)

  it('writes the same file from the same seed', () => {
    const again = stepText(cases(SEED))
    const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
    expect(sha(again), `seed ${SEED}`).toBe(sha(text))
    // Text is never a token: invariant 1 is only meaningful if they cannot collide.
    const tokens = new Set(['NOTDEFINED', 'USERDEFINED', ...Object.values(CLASSES).flatMap((c) => c.codes)])
    for (const c of list)
      for (const v of [c.occurrence.objectType, c.type?.elementType, c.type?.name]) if (v) expect(tokens.has(v)).toBe(false)
  })

  it('holds every element to the three invariants', async () => {
    const src = await createReadOnlyIfcSource()
    const modelID = src.openFromBuffer(new TextEncoder().encode(text))
    const index = buildModelIndex(src, modelID, { modelKey: 'FUZZ', fileName: 'fuzz.ifc', sha256: '' })
    const fed = federate([index])
    expect(fed.elements.length, `seed ${SEED}: elements indexed`).toBe(COUNT)
    const byName = new Map(fed.elements.map((e) => [e.name, e]))
    const rule = (op: Rule['op'], val: string | null): Rule[] => [{ prop: 'PredefinedType', op, val }]

    list.forEach((c, i) => {
      const at = `seed ${SEED}, element fz-${i}: ${JSON.stringify(c)}`
      const e = byName.get(`fz-${i}`)
      expect(e, at).toBeDefined()
      const tile = selectionCard({
        federation: fed,
        element: e!,
        box: null,
        solids: 0,
        coords: { E: null, N: null, Z: null, angle: null },
        offset: [0, 0, 0]
      })!.predefinedType

      // 1. The tile is one of this element's own PredefinedType tokens, or nothing.
      const own = [c.occurrence.code, c.type?.code].filter((v): v is string => !!v)
      expect(tile === '' || own.includes(tile), at).toBe(true)
      for (const t of [c.occurrence.objectType, c.type?.elementType, c.type?.name]) if (t) expect(tile, at).not.toBe(t)

      // 2. The effective type is IfcOpenShell's.
      expect(e!.effectivePredefinedType, at).toBe(getPredefinedType(c))

      // 3. The rules: either value matches; `absent` only when both are empty.
      const matches = (rules: Rule[]): boolean => matchFn(rules)!(e!)
      if (tile) expect(matches(rule('=', tile)), at).toBe(true)
      if (e!.effectivePredefinedType) expect(matches(rule('=', e!.effectivePredefinedType)), at).toBe(true)
      expect(matches(rule('absent', null)), at).toBe(!tile && !e!.effectivePredefinedType)
    })
  })
})
