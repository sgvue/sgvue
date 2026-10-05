/**
 * The right-click menu — `SGVue.dc.html:1898–1921`, as a pure selector.
 *
 * The design builds the list with a closure per item; here each item carries an `action`
 * object and `app/ContextMenu.tsx` dispatches it, exactly as `selectors/tree.ts` separates a
 * tree row from its handler. Labels, shortcut keys, separators, order and the two rules that
 * decide them — `nSuffix` and `shortList` — are the design's, verbatim.
 */
import type { FederatedElement } from '../../../shared/federate'

export type CtxAction =
  | { kind: 'hide'; ids: number[] }
  | { kind: 'isolate'; ids: number[] }
  | { kind: 'select'; ids: number[] }
  | { kind: 'zoomTo'; ids: number[] }
  | { kind: 'ask'; ids: number[] }
  | { kind: 'showAll' }
  | { kind: 'zoomExtents' }

export interface CtxItem {
  label: string
  /** The shortcut printed on the right, `''` when the item has none. */
  key: string
  /** `border-top` — the separator above an item. `'0'` for everything else. `:1921`. */
  top: string
  fg: string
  action: CtxAction
}

export interface CtxInput {
  /** Every element in the federation — the design's `els` (`:1783`), not the activate scope. */
  elements: readonly FederatedElement[]
  byId: ReadonlyMap<number, FederatedElement>
  /** The element under the pointer when the menu opened, or `null` on empty space. */
  ctxId: number | null
  selIds: readonly number[]
  hidden: Record<number | string, boolean>
}

/** More than two names is a count, not a list. `:1903`. */
export const shortList = (arr: readonly string[]): string =>
  arr.length > 2 ? `${arr.length} types` : arr.join(', ')

/**
 * What the menu acts on: the whole selection when the right-clicked element is part of a
 * multi-selection, otherwise just that element. `:1900`.
 */
export function ctxTargets(input: CtxInput): number[] {
  const { byId, ctxId, selIds } = input
  const ctxEl = ctxId != null ? byId.get(ctxId) : undefined
  if (!ctxEl) return []
  return selIds.includes(ctxId!) && selIds.length > 1 ? [...selIds] : [ctxId!]
}

export function ctxItems(input: CtxInput): CtxItem[] {
  const { elements, byId, ctxId, hidden } = input
  const ctxEl = ctxId != null ? byId.get(ctxId) : undefined
  const tgtIds = ctxTargets(input)
  const tgt = tgtIds.map((id) => byId.get(id)).filter(Boolean) as FederatedElement[]
  const nT = tgt.length
  const types = [...new Set(tgt.map((e) => e.objectType))]
  const ents = [...new Set(tgt.map((e) => e.type))]
  const simType = (): number[] =>
    elements.filter((e) => types.includes(e.objectType)).map((e) => e.id)
  const simEnt = (): number[] => elements.filter((e) => ents.includes(e.type)).map((e) => e.id)
  const shortEnts = shortList(ents.map((t) => t.replace(/^Ifc/, '')))
  const nSuffix = nT > 1 ? ` (${nT})` : ''

  const items: Omit<CtxItem, 'fg'>[] = [
    ...(ctxEl
      ? [
          { label: `Hide${nSuffix}`, key: 'H', top: '0', action: { kind: 'hide', ids: tgtIds } },
          {
            label: `Hide similar · ${shortList(types)}`,
            key: '',
            top: '0',
            action: { kind: 'hide', ids: simType() }
          },
          {
            label: `Hide similar entity · ${shortEnts}`,
            key: '',
            top: '0',
            action: { kind: 'hide', ids: simEnt() }
          },
          {
            label: `Isolate${nSuffix}`,
            key: 'I',
            top: '1px solid var(--border)',
            action: { kind: 'isolate', ids: tgtIds }
          },
          {
            label: `Isolate similar · ${shortList(types)}`,
            key: '',
            top: '0',
            action: { kind: 'isolate', ids: simType() }
          },
          {
            label: `Isolate similar entity · ${shortEnts}`,
            key: '',
            top: '0',
            action: { kind: 'isolate', ids: simEnt() }
          },
          {
            label: `Select similar · ${shortList(types)}`,
            key: '',
            top: '1px solid var(--border)',
            // Selecting what you cannot see is the one case the design guards. `:1914`.
            action: { kind: 'select', ids: simType().filter((id) => !hidden[id]) }
          },
          { label: 'Zoom to', key: 'F', top: '0', action: { kind: 'zoomTo', ids: tgtIds } },
          {
            label: 'Properties',
            key: '',
            top: '0',
            action: { kind: 'select', ids: [ctxId!] }
          },
          {
            label: `Ask about this${nSuffix}`,
            key: '',
            top: '1px solid var(--border)',
            action: { kind: 'ask', ids: tgtIds }
          }
        ]
      : []),
    {
      label: 'Show all hidden',
      key: '⇧H',
      top: ctxEl ? '1px solid var(--border)' : '0',
      action: { kind: 'showAll' }
    },
    { label: 'Zoom extents', key: 'Home', top: '0', action: { kind: 'zoomExtents' } }
  ] as Omit<CtxItem, 'fg'>[]

  return items.map((x) => ({ ...x, fg: 'var(--ink)' }))
}

/** `SGVue.dc.html:892` — the menu is clamped so it stays inside the window. */
export const CTX_RIGHT_MARGIN = 220
/** The gap the clamped menu keeps from the window's bottom edge. */
export const CTX_EDGE_GAP = 8

export const clampCtxX = (x: number, innerWidth: number): number =>
  Math.min(x, innerWidth - CTX_RIGHT_MARGIN)

/**
 * Phase 10, and a §3.5-class defect in the design: `:1901` clamps the top to
 * `innerHeight - 260` whatever the menu contains, and the element menu is **385 px** tall —
 * so a right-click low in the window opens a menu whose last three items are past the bottom
 * edge, with no way to reach them. The same constant is also far too *large* for the
 * two-item menu empty space gets, which the design pushes 180 px above the pointer for no
 * reason.
 *
 * Both follow from clamping against a guess instead of the menu. `app/ContextMenu.tsx`
 * measures its own height in a layout effect — before the browser paints, so nothing moves on
 * screen — and passes it here.
 */
export const clampCtxY = (y: number, menuHeight: number, innerHeight: number): number =>
  Math.max(CTX_EDGE_GAP, Math.min(y, innerHeight - menuHeight - CTX_EDGE_GAP))
