/**
 * Keyboard navigation for the element tree — Phase 10, `BUILD_PLAN.md` §3 Phase 9's "the
 * element tree needs `role="tree"` semantics and arrow-key navigation".
 *
 * It is a pure reducer for the same reason `selectors/tree.ts` is a pure selector: the design
 * has no keyboard tree at all, so every rule here is ours and has to be testable without a
 * DOM. `app/Sidebar.tsx` supplies the flattened node list and the focused key, and dispatches
 * whatever comes back.
 *
 * The rules are the WAI-ARIA Authoring Practices' tree pattern, nothing invented:
 *
 * | key | on a group | on a row |
 * |---|---|---|
 * | ↓ / ↑ | the next / previous visible node | the same |
 * | → | open it, or move to its first row when already open | nothing |
 * | ← | close it | move to its group |
 * | Home / End | the first / last visible node | the same |
 * | Enter / Space | what a click does — toggle the group | what a click does — select |
 *
 * "Visible" is the tree's own sense of the word: the rows of a closed group are not in the
 * list, and neither are elements the search filtered out. It is **not** about scrolling — a
 * row inside a windowed group (`app/Sidebar.tsx`) is a node here even when the window has not
 * rendered it, so a keyboard walk crosses a 6 805-row group exactly as a mouse scroll does.
 */
import type { TreeGroup } from './tree'

export interface TreeNode {
  /** Identity in the DOM (`data-tree-key`), and what `focusKey` holds. */
  key: string
  kind: 'group' | 'item'
  /** The group this node *is*, or the group this row belongs to. */
  group: string
  /** The element id — rows only. */
  id: number | null
  /** `aria-level`: a group is 1, a row inside it is 2. */
  level: 1 | 2
  /** `aria-expanded` — groups only; always `false` for a row. */
  open: boolean
}

/** Every node the tree currently shows, in the order they appear on screen. */
export function treeNodes(groups: readonly TreeGroup[]): TreeNode[] {
  const out: TreeNode[] = []
  for (const g of groups) {
    out.push({ key: `g:${g.key}`, kind: 'group', group: g.key, id: null, level: 1, open: g.open })
    if (!g.open) continue
    for (const it of g.items) {
      out.push({ key: `i:${it.id}`, kind: 'item', group: g.key, id: it.id, level: 2, open: false })
    }
  }
  return out
}

export type TreeKeyAction =
  /** Move the roving tabindex — and the DOM focus — to this node. */
  | { kind: 'focus'; key: string }
  /** Open a closed group. The store action is `toggleGroup`, as a click's is. */
  | { kind: 'expand'; group: string }
  /** Close an open group. */
  | { kind: 'collapse'; group: string }
  /** Enter / Space: exactly what clicking that node does. */
  | { kind: 'activate'; node: TreeNode }

/**
 * @param key the `KeyboardEvent.key`
 * @param nodes `treeNodes(groups)`
 * @param focusKey the node that currently has the roving tabindex, or `null` before the tree
 *   has been entered — in which case the walk starts at the first node.
 * @returns what to do, or `null` when the key means nothing here (so the caller leaves the
 *   event alone and the design's own window shortcuts still see it).
 */
export function treeKeyAction(
  key: string,
  nodes: readonly TreeNode[],
  focusKey: string | null
): TreeKeyAction | null {
  if (!nodes.length) return null
  const at = Math.max(
    0,
    nodes.findIndex((n) => n.key === focusKey)
  )
  const node = nodes[at]
  const to = (i: number): TreeKeyAction | null =>
    i >= 0 && i < nodes.length && i !== at ? { kind: 'focus', key: nodes[i].key } : null

  switch (key) {
    case 'ArrowDown':
      return to(at + 1)
    case 'ArrowUp':
      return to(at - 1)
    case 'Home':
      return to(0)
    case 'End':
      return to(nodes.length - 1)
    case 'ArrowRight':
      if (node.kind !== 'group') return null
      return node.open ? to(at + 1) : { kind: 'expand', group: node.group }
    case 'ArrowLeft':
      if (node.kind === 'group') return node.open ? { kind: 'collapse', group: node.group } : null
      return { kind: 'focus', key: `g:${node.group}` }
    case 'Enter':
    case ' ':
      return { kind: 'activate', node }
    default:
      return null
  }
}
