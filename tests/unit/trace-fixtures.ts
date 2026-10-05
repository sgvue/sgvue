/**
 * Shared by the thinking-trace tests — not a test on its own (the name does not end in
 * `.test.ts`).
 *
 * - `reference()` — the handoff's own choreography code, cut out of
 *   `design-reference/ask-vee/ask-thinking-hex.jsx` (with the three easing curves it names,
 *   written out below) and run unchanged: its constants, its 412 cells, its 86 walls, its 9
 *   flagged walls, `p`, `lin`, `beamAt`, `hexState`.
 * - `federationOf(elements, storeys)` — just enough of a `Federation` for `toolFacts`.
 * - `referenceFederation()` — the handoff's scenario as real elements: 4 models of 140, 244, 20
 *   and 8; the reference's own 86 walls among the first 140; its 9 flagged ones carrying no
 *   `FireRating`, on the storeys its `FLAG_LEVEL` puts them on.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FederatedElement, Federation } from '../../src/shared/federate'
import type { PropValue } from '../../src/shared/model-index.types'

const ROOT = join(__dirname, '..', '..')
const JSX = readFileSync(join(ROOT, 'design-reference/ask-vee/ask-thinking-hex.jsx'), 'utf8')

/**
 * What the handoff's choreography reads from outside its own file: the three easing curves its
 * `MOTION` names (`Easing.easeOutQuart`, `Easing.easeInOutCubic`, `Easing.easeOutBack`) and
 * `clamp`. The handoff took them from the design tool's animation starter, which is not
 * redistributed (`design-reference/README.md`). They are the standard Penner easing equations —
 * `easeOutBack` with the usual overshoot constant `c1 = 1.70158` — written out here in the same
 * form, so the reference computes exactly what it did.
 */
const RUNTIME = `const Easing = {
  easeOutQuart: (t) => 1 - (--t) * t * t * t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));`

type Ease = (t: number) => number

/** One cell of the reference: an element, where it stands in each grid, and what it is. */
export interface RefCell {
  i: number
  col: number
  xA: number
  yA: number
  /** Its index among the walls, when it is one. */
  k?: number
  xB?: number
  yB?: number
  /** Its index among the flagged walls, when it is one. */
  f?: number
}

export interface Reference {
  MOTION: { enter: Ease; glide: Ease; pop: Ease }
  p: (T: number, s: number, d: number, ease: Ease) => number
  lin: (T: number, s: number, d: number) => number
  lerp: (a: number, b: number, t: number) => number
  clamp: (v: number, lo: number, hi: number) => number
  MODEL_COLS: number[]
  MW: number
  GAP_G: number
  PITCH_A: number
  SIZE_A: number
  PITCH_B: number
  SIZE_B: number
  WALLS: number[]
  FLAGGED: number[]
  FLAG_LEVEL: number[]
  FLAG_SLOT: number[]
  LEVELS: [string, number][]
  CELLS: RefCell[]
  MX: number
  MY: number
  ROW_Y0: number
  ROW_H: number
  H_ANSWER: number
  ANSWER: [string, string?][]
  beamAt: (cues: Cues, xc: number) => number
  hexState: (T: number, cues: Cues) => string
}

/** The handoff's scene starts (`Ask Vee Thinking.dc.html`, `OM_SCENES`), as running sums. */
export interface Cues {
  Open: number
  Send: number
  Think: number
  Read: number
  Filter: number
  Check: number
  Answer: number
  Hold: number
}

export const CUES: Cues = (() => {
  const html = readFileSync(join(ROOT, 'design-reference/ask-vee/Ask Vee Thinking.dc.html'), 'utf8')
  const scenes = JSON.parse(/window\.OM_SCENES = '(.*)';<\/script>/.exec(html)![1]) as { name: string; dur: number }[]
  const cues: Record<string, number> = {}
  let at = 0
  for (const s of scenes) {
    cues[s.name] = Math.round(at * 1000) / 1000
    at += s.dur
  }
  return cues as unknown as Cues
})()

let ref: Reference | null = null

export function reference(): Reference {
  if (ref) return ref
  const cut = (text: string, from: string, to: string): string => {
    const a = text.indexOf(from)
    const b = text.indexOf(to, a)
    if (a < 0 || b < a) throw new Error(`the handoff's code was not found between "${from}" and "${to}"`)
    return text.slice(a, b)
  }
  // `:13–48` — the motion helpers, the data, the cells and `beamAt` — and `:81–89`, `hexState`.
  const choreography = cut(JSX, 'const MOTION', '// ── Hex, the pixel mascot')
  const hex = cut(JSX, 'function hexState', 'function useDataUrl')
  ref = new Function(
    `${RUNTIME}\n${choreography}\n${hex}\n` +
      'return { MOTION, p, lin, lerp, clamp, MODEL_COLS, MW, GAP_G, PITCH_A, SIZE_A, PITCH_B, SIZE_B, WALLS,' +
      ' FLAGGED, FLAG_LEVEL, FLAG_SLOT, LEVELS, CELLS, MX, MY, ROW_Y0, ROW_H, H_ANSWER, ANSWER, beamAt, hexState }'
  )() as Reference
  return ref
}

/* ────────────────────────────── elements ────────────────────────────── */

export interface Sketch {
  model: string
  type: string
  storey?: string
  predefinedType?: string
  objectType?: string
  name?: string
  material?: string
  props?: Record<string, PropValue>
}

/** A federation of exactly these elements, in this order, ids from 1. */
export function federationOf(sketches: readonly Sketch[], storeys: readonly string[]): Federation {
  const elements = sketches.map((e, i) => ({
    id: i + 1,
    localId: i + 1,
    model: e.model,
    type: e.type,
    predefinedType: e.predefinedType ?? '',
    objectType: e.objectType ?? '',
    storey: e.storey ?? '',
    name: e.name ?? `${e.type} ${i + 1}`,
    material: e.material ?? '',
    psets: e.props ? { Pset_Common: e.props } : {},
    qto: {}
  })) as unknown as FederatedElement[]
  const byType: Record<string, number> = {}
  for (const e of elements) byType[e.type] = (byType[e.type] ?? 0) + 1
  return {
    elements,
    byId: new Map(elements.map((e) => [e.id, e])),
    storeys: storeys.map((name, i) => ({ expressId: 0, guid: '', name, elev: i * 3, h: 3 })),
    counts: { models: new Set(sketches.map((e) => e.model)).size, elements: elements.length, spaces: 0, byType }
  } as unknown as Federation
}

/** The handoff's models, in its order, with its counts. */
export const REFERENCE_MODELS: readonly [string, number][] = [
  ['ARC', 140],
  ['STR', 244],
  ['SIT', 20],
  ['MEP', 8]
]

/** The handoff's own scenario, as elements a rule can be run over. */
export function referenceFederation(): Federation {
  const r = reference()
  const wallOf = new Map(r.WALLS.map((i, k) => [i, k]))
  const flagOf = new Map(r.FLAGGED.map((k, f) => [k, f]))
  const sketches: Sketch[] = []
  for (const [model, count] of REFERENCE_MODELS) {
    for (let j = 0; j < count; j++) {
      const i = sketches.length
      const k = wallOf.get(i)
      if (k === undefined) {
        sketches.push({ model, type: 'IfcSlab', storey: 'L1', props: { FireRating: '2 HR' } })
        continue
      }
      const f = flagOf.get(k)
      sketches.push({
        model,
        type: 'IfcWall',
        storey: f === undefined ? 'L1' : r.LEVELS[r.FLAG_LEVEL[f]][0],
        props: f === undefined ? { FireRating: '1 HR' } : { IsExternal: true }
      })
    }
  }
  return federationOf(
    sketches,
    r.LEVELS.map(([name]) => name)
  )
}

/** The question the handoff's video asks, as the rules a tool call would carry. */
export const REFERENCE_RULES = [
  { prop: 'IfcEntity', op: '=', val: 'IfcWall' },
  { prop: 'FireRating', op: 'absent', val: null }
] as const
