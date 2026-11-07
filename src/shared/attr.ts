/**
 * The one property resolver (`design-reference/BUILD_PLAN.md` §2.3, `SGVue.dc.html:929`).
 *
 * Ported exactly: seven named attributes, then the first match for the key across every
 * property set, then every quantity set, then `undefined`.
 *
 * The design's own note applies: **filter rules, `summarize_elements` grouping and
 * colour-by-property must all use this function.** The prototype once hard-coded a
 * five-value enum for grouping, which silently made every pset key ungroupable.
 */
import type { PropValue } from './model-index.types'

/** The seven attributes the resolver answers directly, in the design's order. */
export const ATTR_KEYS = [
  'Model',
  'IfcEntity',
  'PredefinedType',
  'ObjectType',
  'Level',
  'Name',
  'Material'
] as const

/** The parts of an element `attr` reads. Both the real index and the mock satisfy it. */
export interface AttrElement {
  model: string
  type: string
  /** The code as written — `IfcElement.predefinedType`. */
  predefinedType: string
  /** IfcOpenShell's `get_predefined_type` — `IfcElement.effectivePredefinedType`. */
  effectivePredefinedType: string
  objectType: string
  storey: string
  name: string
  material: string
  psets: Record<string, Record<string, PropValue>>
  qto: Record<string, Record<string, PropValue>>
}

export function attr(el: AttrElement, k: string): PropValue | undefined {
  switch (k) {
    case 'Model':
      return el.model
    case 'IfcEntity':
      return el.type
    case 'PredefinedType':
      // The effective type, for grouping and colour-by (2026-11-07). A rule tests both values
      // (`matchFn`), and `attrValues` lists both.
      return el.effectivePredefinedType
    case 'ObjectType':
      return el.objectType
    case 'Level':
      return el.storey
    case 'Name':
      return el.name
    case 'Material':
      return el.material
  }
  for (const ps of [el.psets, el.qto]) {
    for (const p of Object.values(ps)) if (k in p) return p[k]
  }
  return undefined
}

/**
 * Every value a rule over `k` can match: `attr`'s one value, except `PredefinedType`, which
 * has two — the code as written and the effective type (2026-11-07) — listed once each. For a
 * value list (the Filter card's, the assistant's schema) and SQL's `attribute` rows.
 */
export function attrValues(el: AttrElement, k: string): PropValue[] {
  if (k === 'PredefinedType') {
    const { predefinedType: raw, effectivePredefinedType: eff } = el
    return raw === eff ? [eff] : [raw, eff]
  }
  const v = attr(el, k)
  return v === undefined ? [] : [v]
}

/**
 * `propKeys` = the seven attributes + every key found in any pset/qto across the loaded
 * federation (`SGVue.dc.html:911`). Feeds the rule builder, the value autocomplete and the
 * AI schema.
 */
export function collectPropKeys(elements: Iterable<AttrElement>): string[] {
  const pk = new Set<string>(ATTR_KEYS)
  for (const e of elements) {
    for (const ps of [e.psets, e.qto]) {
      for (const p of Object.values(ps)) for (const k of Object.keys(p)) pk.add(k)
    }
  }
  return [...pk]
}
