/**
 * The element tree — `SGVue.dc.html:1816–1833`, the grouping, search and row-meta rules,
 * as pure functions so they can be tested without a DOM.
 *
 * The design builds these inside `renderVals()` with the click handlers attached. Here the
 * data is separated from the handlers, which the components bind; nothing about the result
 * changes.
 */
import type { FederatedElement } from '../../../shared/federate'

/** Search matches a case-insensitive substring of any of these five fields. `:1817`. */
export function matchesSearch(e: FederatedElement, q: string): boolean {
  if (!q) return true
  return (
    e.name.toLowerCase().includes(q) ||
    e.type.toLowerCase().includes(q) ||
    e.objectType.toLowerCase().includes(q) ||
    (e.predefinedType || '').toLowerCase().includes(q) ||
    e.storey.toLowerCase().includes(q)
  )
}

/**
 * The second line of a tree row: `PredefinedType · ObjectType · Level` by Entity, or
 * `IfcEntity · ObjectType · Level` by PredefType, with falsy parts dropped and `NOTDEFINED`
 * omitted. `:1827–1829`.
 */
export function rowMeta(e: FederatedElement, treeMode: 'entity' | 'type'): string {
  const pdt = e.predefinedType && e.predefinedType !== 'NOTDEFINED' ? e.predefinedType : null
  const meta =
    treeMode === 'entity'
      ? [pdt, e.objectType, e.storey]
      : [e.type.replace(/^Ifc/, ''), e.objectType, e.storey]
  return meta.filter(Boolean).join(' · ')
}

/** A group's key: the IFC entity, or the predefined type falling back to `NOTDEFINED`. `:1818`. */
export const groupKey = (e: FederatedElement, treeMode: 'entity' | 'type'): string =>
  treeMode === 'entity' ? e.type : e.predefinedType || 'NOTDEFINED'

/**
 * The slice of a long row list that has to be in the DOM: everything the scroller can see,
 * plus `overscan` rows beyond each edge. `viewTop` is how far the list's own top has scrolled
 * past the top of the viewport — negative while the list starts below it.
 *
 * Pure so the arithmetic can be tested without a browser; `app/Sidebar.tsx` supplies the
 * measurements and renders a spacer for each end.
 */
export function rowWindow(
  viewTop: number,
  viewHeight: number,
  rowHeight: number,
  count: number,
  overscan: number
): [number, number] {
  if (!(rowHeight > 0)) return [0, count]
  const start = Math.min(count, Math.max(0, Math.floor(viewTop / rowHeight) - overscan))
  const end = Math.min(count, Math.max(start, Math.ceil((viewTop + viewHeight) / rowHeight) + overscan))
  return [start, end]
}

export interface TreeItem {
  id: number
  name: string
  sub: string
  vis: boolean
  hid: boolean
  /** In the selection — the row's accent edge, and its `aria-selected`. */
  sel: boolean
  opacity: number
  edge: string
  bg: string
  fg: string
}

export interface TreeGroup {
  key: string
  label: string
  count: number
  open: boolean
  rot: number
  chevColor: string
  vis: boolean
  hid: boolean
  opacity: number
  font: string
  /** Every element in the group, open or not — the group eye acts on all of them. `:1825`. */
  ids: number[]
  /** Rows, built only for an open group. `:1826`. */
  items: TreeItem[]
}

export interface TreeInput {
  /** Already scoped by activate mode — `lels` in the design (`:1786`). */
  elements: readonly FederatedElement[]
  treeMode: 'entity' | 'type'
  search: string
  expanded: Record<string, boolean>
  hidden: Record<number | string, boolean>
  selIds: readonly number[]
}

/**
 * A search opens any group it leaves at 40 rows or fewer, which is what makes a search read
 * as a result list rather than as a set of closed folders. `:1821`.
 */
export const SEARCH_AUTO_OPEN_MAX = 40

export function treeGroups(input: TreeInput): TreeGroup[] {
  return withSelection(groupTree(input), input.selIds)
}

/**
 * The grouping half of `treeGroups`, with every row unselected. It scans and sorts the whole
 * (scoped) federation, so `app/Sidebar.tsx` keeps it apart from the selection: a click in the
 * viewport re-runs `withSelection` alone.
 */
export function groupTree(input: Omit<TreeInput, 'selIds'>): TreeGroup[] {
  const { elements, treeMode, expanded, hidden } = input
  const q = input.search.trim().toLowerCase()
  const byKey = new Map<string, FederatedElement[]>()
  for (const e of elements) {
    if (!matchesSearch(e, q)) continue
    const key = groupKey(e, treeMode)
    let list = byKey.get(key)
    if (!list) byKey.set(key, (list = []))
    list.push(e)
  }
  return [...byKey.keys()].sort().map((key) => {
    const items = byKey.get(key)!
    const open = !!expanded[key] || (!!q && items.length <= SEARCH_AUTO_OPEN_MAX)
    const hiddenN = items.filter((e) => hidden[e.id]).length
    const vis = hiddenN < items.length
    return {
      key,
      label: key,
      count: items.length,
      open,
      rot: open ? 90 : 0,
      chevColor: open ? 'var(--accent-ink)' : 'var(--faint)',
      vis,
      hid: !vis,
      opacity: vis ? 1 : 0.5,
      font: '500 12.5px/1.3 var(--mono)',
      ids: items.map((e) => e.id),
      items: open
        ? items.map((e) => {
            const h = !!hidden[e.id]
            return {
              id: e.id,
              name: e.name,
              sub: rowMeta(e, treeMode),
              vis: !h,
              hid: h,
              sel: false,
              opacity: h ? 0.5 : 1,
              edge: 'transparent',
              bg: 'transparent',
              fg: 'var(--ink)'
            }
          })
        : []
    }
  })
}

/**
 * The selection half of `treeGroups`: the selected rows of open groups take the accent edge
 * and the selection colours. A group with no selected row, and every unselected row, is
 * returned as it was.
 */
export function withSelection(groups: TreeGroup[], selIds: readonly number[]): TreeGroup[] {
  if (!selIds.length) return groups
  const sel = new Set(selIds)
  return groups.map((g) =>
    g.items.some((it) => sel.has(it.id))
      ? {
          ...g,
          items: g.items.map((it) =>
            sel.has(it.id)
              ? { ...it, sel: true, edge: 'var(--accent)', bg: 'var(--sel-bg)', fg: 'var(--sel-ink)' }
              : it
          )
        }
      : g
  )
}
