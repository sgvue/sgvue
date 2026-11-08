import type { IfcElement } from '../../shared/model-index.types'
import type { MockOptions } from './mock-adapter'

/**
 * The messy-model fixture — **`scripts/ai-eval.cjs`'s `mock-messy` cases and nothing else**
 * (2026-11-08, with the Ask Vee eval cases).
 *
 * Real exports are untidy in a handful of ways the design's mock never is, and an assistant that
 * meets them should count honestly and never fill a gap with a value it made up. This is the
 * design's own 412-element federation with those ways written into it, **by name**, so every
 * count is a SELECT away and a case's ground truth is computed, never typed in. It is
 * hostile-but-honest: unlike `hostile.ts`, no value here reads like an instruction.
 *
 * | What | Which elements |
 * |---|---|
 * | `FireRating` `TBC` | the six L3 walls `Ext Wall S A-B L3` … `D-E L3`, `Ext Wall N A-B L3`, `Ext Wall N B-C L3` |
 * | `FireRating` `n/a` | `Partition B L1` … `L4` |
 * | `FireRating` `0` | `Corridor Wall L4` |
 * | `FireRating` `-` | the four parapets — the design's own, unchanged |
 * | `Fire_Rating` in place of `FireRating` | the four `Ext Wall N … L4` (same set, same value) |
 * | on no storey | `Duct Branch L1` … `L4` |
 * | one GlobalId on two elements | `Beam BC/1 L2` takes `Beam AB/1 L2`'s — a sixth pair: the design's mock already has five, by accident, each across two storeys or classes |
 * | ObjectType-only sub-type, one upper-case token | `Footing E-1` … `E-4`: ObjectType `TRENCH`, PredefinedType `NOTDEFINED` |
 * | PredefinedType `NOTDEFINED`, family-name ObjectType | `Room Door L4-01` … `L4-03` |
 * | an `SGPset_Door` set | every door but the five on L1 |
 *
 * Off unless `#mock&messy` (`App.tsx`), and dev-only: only `App.tsx`'s dev-tools block and the
 * offline eval test import it, so none of it is in a production bundle.
 */

/** The six L3 walls whose FireRating is `TBC`. */
const TBC = /^Ext Wall (S [A-D]-[B-E]|N (A-B|B-C)) L3$/
const NA = /^Partition B L[1-4]$/
const SPELLED = /^Ext Wall N [A-D]-[B-E] L4$/
const NO_STOREY = /^Duct Branch L[1-4]$/
const TRENCH = /^Footing E-[1-4]$/
const NOTDEFINED_DOOR = /^Room Door L4-0[1-3]$/

/** The GlobalId `Beam AB/1 L2` carries in the design's mock, which `Beam BC/1 L2` takes too. */
export const MESSY_SHARED_GUID = 'oWG0CCCd2AowYgIQ2AowYg'

/** Replace one property of one set, or rename its key. */
function withProp(e: IfcElement, set: string, key: string, value: string, renameTo?: string): IfcElement {
  const ps = e.psets[set]
  if (!ps || !(key in ps)) return e
  const next: Record<string, IfcElement['psets'][string][string]> = {}
  for (const [k, v] of Object.entries(ps)) {
    if (k !== key) next[k] = v
    else next[renameTo ?? k] = renameTo ? v : value
  }
  return { ...e, psets: { ...e.psets, [set]: next } }
}

/** One element with its mess written in, or the element unchanged. */
function mess(e: IfcElement): IfcElement {
  let out = e
  if (e.type === 'IfcWall') {
    if (TBC.test(e.name)) out = withProp(out, 'Pset_WallCommon', 'FireRating', 'TBC')
    else if (NA.test(e.name)) out = withProp(out, 'Pset_WallCommon', 'FireRating', 'n/a')
    else if (e.name === 'Corridor Wall L4') out = withProp(out, 'Pset_WallCommon', 'FireRating', '0')
    else if (SPELLED.test(e.name)) out = withProp(out, 'Pset_WallCommon', 'FireRating', '', 'Fire_Rating')
  }
  if (NO_STOREY.test(e.name)) out = { ...out, storey: '' }
  if (e.name === 'Beam BC/1 L2') out = { ...out, guid: MESSY_SHARED_GUID }
  if (TRENCH.test(e.name)) {
    out = { ...out, objectType: 'TRENCH', predefinedType: 'NOTDEFINED', effectivePredefinedType: 'NOTDEFINED' }
  }
  if (e.type === 'IfcDoor') {
    if (NOTDEFINED_DOOR.test(e.name)) {
      out = { ...out, predefinedType: 'NOTDEFINED', effectivePredefinedType: 'NOTDEFINED' }
    }
    if (e.storey !== 'L1') {
      const wide = /Double|2400/.test(e.objectType)
      out = {
        ...out,
        psets: { ...out.psets, SGPset_Door: { DoorPanelType: wide ? 'DOUBLE' : 'SINGLE', BarrierFree: wide } },
        psetMeta: {
          ...out.psetMeta,
          SGPset_Door: { sourceExpressId: 0, inherited: false, kind: 'SGPset', measures: {} }
        }
      }
    }
  }
  return out
}

/** What `mockModelIndex` is given to build the messy federation. */
export const MESSY_OPTIONS: MockOptions = { element: mess }
