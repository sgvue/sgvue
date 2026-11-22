/**
 * `ifcsg_columns` (2026-11-22) — the IFC+SG CoP property list for each sub-type of one IFC class
 * the loaded models carry, so a schedule for an IFC+SG submission is built from the columns the
 * model really has, and the rest are named in the reply (the owner's choice: no empty columns).
 *
 * A sub-type is read the way the IFC+SG prompt block and the heads-up read it (review round 1,
 * 2026-11-22): the PredefinedType when it is any value but NOTDEFINED, USERDEFINED or empty, else
 * the ObjectType when that is one upper-case token (`SINK`, `TRENCH`) — the two with equal
 * standing — and otherwise there is none, so a Revit `Family:Type` ObjectType is never a group of
 * its own. With none, the CoP's record for the entity alone is the one looked up. A sub-type the
 * CoP does not list is returned with a plain note, never as a fault.
 *
 * `inModel` holds the names a `make_schedule` column takes: each CoP property the sub-type's
 * elements carry a value for, matched to the file's spelling by `resolveKey` — the same rule every
 * tool matches a property name by — and then put through make_schedule's own field resolution
 * (`resolveScheduleField`), so a name here never makes it refuse. Where the bare name is a core
 * Schedules field too (the CoP's `Material` is a property; the window's Material is the element's
 * material), it is named with its set, `SGPset_Door.Material`.
 *
 * Read-only: the bundled corpus (`shared/ifcsg-cop.ts`), the frozen index and the schedule store.
 */
import { COP_SOURCE, copClassification, type CopClassification } from '../../../shared/ifcsg-cop'
import { IFCSG_SUBTYPES_MAX } from '../../../shared/tool-schemas'
import { resolveKey } from '../../../shared/prop-names'
import type { FederatedElement } from '../../../shared/federate'
import { resolveScheduleField, type FieldWorld } from '../../../schedule/assistant'
import { scheduleStore } from '../../model/schedule-link'
import { noSubtypeCode, SUBTYPE_TOKEN } from '../heads-up'
import type { Executor } from './context'

/** Sub-types one result lists, largest first; past it, `truncated` — the catalogue's number. */
export const IFCSG_SUBTYPES_CAP = IFCSG_SUBTYPES_MAX
/** A sub-type read from an ObjectType is file text: clipped, like every other name in a result. */
const SUBTYPE_CHARS = 80

const clip = (s: string): string => (s.length > SUBTYPE_CHARS ? `${s.slice(0, SUBTYPE_CHARS - 1)}…` : s)

/**
 * The element's IFC+SG sub-type, or null: `heads-up.ts`'s own two tests, so the tool, the heads-up
 * and the prompt's identity rule cannot disagree about what a sub-type is.
 */
export function subtypeOf(e: Pick<FederatedElement, 'predefinedType' | 'objectType'>): string | null {
  const code = e.predefinedType || ''
  if (!noSubtypeCode(code)) return code
  const ot = e.objectType || ''
  return SUBTYPE_TOKEN.test(ot) ? ot : null
}

interface Group {
  subtype: string | null
  elements: FederatedElement[]
}

/** Every property name the elements carry a value for, with the sets it is carried in. */
function carried(elements: readonly FederatedElement[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const e of elements) {
    for (const sets of [e.psets, e.qto]) {
      for (const [set, props] of Object.entries(sets)) {
        for (const [key, v] of Object.entries(props)) {
          if (v === undefined || v === null || v === '') continue
          const where = out.get(key) ?? new Set<string>()
          where.add(set)
          out.set(key, where)
        }
      }
    }
  }
  return out
}

/** The name make_schedule takes for a carried property — bare, else with its set — or null. */
function fieldFor(key: string, sets: ReadonlySet<string>, world: FieldWorld): string | null {
  const takes = (name: string): boolean => {
    const r = resolveScheduleField(name, world)
    return r.ok && r.field.kind === 'prop' && r.field.prop.toLowerCase() === key.toLowerCase()
  }
  if (takes(key)) return key
  for (const set of [...sets].sort()) if (takes(`${set}.${key}`)) return `${set}.${key}`
  return null
}

const pagesText = (c: CopClassification): string =>
  [
    ...new Set(
      c.sources.filter((s) => s.pages).map((s) => (s.pages![0] === s.pages![1] ? `${s.pages![0]}` : `${s.pages![0]}–${s.pages![1]}`))
    )
  ].join(', ')

function describeGroup(entity: string, g: Group, world: FieldWorld): Record<string, unknown> {
  const classification = g.subtype ? `${entity}.${clip(g.subtype)}` : entity
  const base = { classification, subtype: g.subtype === null ? null : clip(g.subtype), count: g.elements.length }
  const cop = copClassification(entity, g.subtype)
  if (!cop) {
    return {
      ...base,
      note: g.subtype
        ? `The CoP lists no columns for ${classification} — it is not among the classifications this compilation lists. Schedule these with the columns the user names.`
        : `These have no sub-type — PredefinedType NOTDEFINED, USERDEFINED or none, and no ObjectType that is one upper-case token — and the CoP lists no columns for ${entity} without one.`
    }
  }
  const where = { component: [...new Set(cop.sources.map((s) => s.component))].join(', '), copPages: pagesText(cop) }
  if (cop.noPropertiesRequired || !cop.properties.length) {
    return { ...base, ...where, note: `The CoP lists no columns for ${classification}: it asks for no properties of it.` }
  }
  const keys = carried(g.elements)
  const known = [...keys.keys()]
  const inModel: string[] = []
  const missing: string[] = []
  const copName: Record<string, string> = {}
  const notSchedulable: string[] = []
  for (const p of cop.properties) {
    const r = resolveKey(p.name, known)
    const found = r.key !== null ? [r.key] : [...r.candidates].sort()
    if (!found.length) {
      missing.push(p.name)
      continue
    }
    for (const key of found) {
      const field = fieldFor(key, keys.get(key)!, world)
      if (field === null) {
        notSchedulable.push(key)
        continue
      }
      if (!inModel.includes(field)) inModel.push(field)
      if (field !== p.name) copName[field] = p.name
    }
  }
  return {
    ...base,
    ...where,
    copProperties: cop.properties.length,
    inModel,
    missing,
    ...(Object.keys(copName).length ? { copName } : {}),
    ...(notSchedulable.length ? { notSchedulable } : {})
  }
}

export const ifcsg_columns: Executor = (input, ctx) => {
  const s = ctx.state()
  const asked = String(input.entity ?? '').trim()
  const want = asked.toLowerCase()
  const groups = new Map<string | null, Group>()
  let entity = asked
  for (const e of s.federation.elements) {
    if (e.type.toLowerCase() !== want) continue
    entity = e.type
    const sub = subtypeOf(e)
    const g = groups.get(sub) ?? { subtype: sub, elements: [] }
    g.elements.push(e)
    groups.set(sub, g)
  }
  if (!groups.size) {
    return { forModel: { message: `No loaded model carries ${asked}, so there are no sub-types to look up.`, entity: asked, count: 0 } }
  }
  const all = [...groups.values()].sort(
    (a, b) =>
      b.elements.length - a.elements.length ||
      Number(a.subtype === null) - Number(b.subtype === null) ||
      ((a.subtype ?? '') < (b.subtype ?? '') ? -1 : (a.subtype ?? '') > (b.subtype ?? '') ? 1 : 0)
  )
  const only = typeof input.subtype === 'string' && input.subtype.trim() ? input.subtype.trim() : null
  const picked = only ? all.filter((g) => g.subtype !== null && g.subtype.toLowerCase() === only.toLowerCase()) : all
  if (!picked.length) {
    const carriedText = all
      .slice(0, IFCSG_SUBTYPES_CAP)
      .map((g) => `${g.subtype === null ? 'no sub-type' : clip(g.subtype)} (${g.elements.length})`)
      .join(', ')
    return {
      forModel: {
        message: `No ${entity} in the loaded models is of sub-type ${only}. They carry: ${carriedText}.`,
        entity,
        count: all.reduce((n, g) => n + g.elements.length, 0)
      }
    }
  }
  const { store } = scheduleStore(s)
  const world: FieldWorld = { store, propKeys: s.propKeys }
  const shown = picked.slice(0, IFCSG_SUBTYPES_CAP)
  const subtypes = shown.map((g) => describeGroup(entity, g, world))
  const lines = subtypes.map((g) =>
    Array.isArray(g.inModel)
      ? `${String(g.classification)} — ${String(g.count)}: ${(g.inModel as string[]).length} of the CoP's ${String(g.copProperties)} properties are carried, ${(g.missing as string[]).length} are not`
      : `${String(g.classification)} — ${String(g.count)}: no CoP columns, kept in the schedule`
  )
  return {
    forModel: {
      message:
        `${entity}: ${picked.length} sub-type${picked.length === 1 ? '' : 's'} in the loaded models. ${lines.join('; ')}. ` +
        `Schedule every ${entity} — category ${entity}, with no filter on sub-type or PredefinedType — grouped by PredefinedType: elements with no sub-type, or one the CoP does not list, stay in the schedule in their own group. ` +
        'Use only the inModel names as make_schedule column fields; name the missing ones in the reply as what the CoP lists that the model does not carry.',
      entity,
      source: COP_SOURCE,
      subtypes,
      ...(picked.length > shown.length ? { truncated: true, subtypesTotal: picked.length } : {})
    }
  }
}

export const IFCSG_EXECUTORS: Record<string, Executor> = { ifcsg_columns }
