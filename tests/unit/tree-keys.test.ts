/**
 * The element tree's keyboard — `state/selectors/tree-keys.ts`.
 *
 * The design has no keyboard tree at all, so every rule here is Phase 10's and none of it can
 * be checked against the prototype. What it *can* be checked against is the WAI-ARIA tree
 * pattern, which is what the rules are, and against the tree the sidebar actually builds.
 */
import { describe, expect, it } from 'vitest'
import type { TreeGroup, TreeItem } from '../../src/renderer/state/selectors/tree'
import { treeKeyAction, treeNodes } from '../../src/renderer/state/selectors/tree-keys'

const item = (id: number): TreeItem => ({
  id,
  name: `Wall ${id}`,
  sub: 'Basic Wall · L1',
  vis: true,
  hid: false,
  sel: false,
  opacity: 1,
  edge: 'transparent',
  bg: 'transparent',
  fg: 'var(--ink)'
})

const group = (key: string, open: boolean, ids: number[]): TreeGroup => ({
  key,
  label: key,
  count: ids.length,
  open,
  rot: open ? 90 : 0,
  chevColor: 'var(--faint)',
  vis: true,
  hid: false,
  opacity: 1,
  font: '500 12.5px/1.3 var(--mono)',
  ids,
  items: open ? ids.map(item) : []
})

/** IfcDoor closed, IfcWall open with three rows — the shape the sidebar hands over. */
const groups = [group('IfcDoor', false, [7, 8]), group('IfcWall', true, [1, 2, 3])]
const nodes = treeNodes(groups)

describe('treeNodes', () => {
  it('flattens groups and the rows of the open ones, in the order they appear', () => {
    expect(nodes.map((n) => n.key)).toEqual(['g:IfcDoor', 'g:IfcWall', 'i:1', 'i:2', 'i:3'])
  })

  it('carries the levels and the expanded state ARIA needs', () => {
    expect(nodes[0]).toMatchObject({ kind: 'group', level: 1, open: false, id: null })
    expect(nodes[1]).toMatchObject({ kind: 'group', level: 1, open: true })
    expect(nodes[2]).toMatchObject({ kind: 'item', level: 2, id: 1, group: 'IfcWall' })
  })

  it('leaves the rows of a closed group out — a walk skips them, as the eye does', () => {
    expect(treeNodes([group('IfcDoor', false, [7, 8])]).map((n) => n.key)).toEqual(['g:IfcDoor'])
  })
})

describe('treeKeyAction', () => {
  it('moves down and up one node at a time, and stops at the ends', () => {
    expect(treeKeyAction('ArrowDown', nodes, 'g:IfcDoor')).toEqual({ kind: 'focus', key: 'g:IfcWall' })
    expect(treeKeyAction('ArrowDown', nodes, 'g:IfcWall')).toEqual({ kind: 'focus', key: 'i:1' })
    expect(treeKeyAction('ArrowUp', nodes, 'i:1')).toEqual({ kind: 'focus', key: 'g:IfcWall' })
    expect(treeKeyAction('ArrowUp', nodes, 'g:IfcDoor')).toBeNull()
    expect(treeKeyAction('ArrowDown', nodes, 'i:3')).toBeNull()
  })

  it('starts at the first node when the tree has not been entered yet', () => {
    expect(treeKeyAction('ArrowDown', nodes, null)).toEqual({ kind: 'focus', key: 'g:IfcWall' })
  })

  it('opens a closed group with →, and descends into an open one', () => {
    expect(treeKeyAction('ArrowRight', nodes, 'g:IfcDoor')).toEqual({
      kind: 'expand',
      group: 'IfcDoor'
    })
    expect(treeKeyAction('ArrowRight', nodes, 'g:IfcWall')).toEqual({ kind: 'focus', key: 'i:1' })
  })

  it('closes an open group with ←, and climbs from a row to its group', () => {
    expect(treeKeyAction('ArrowLeft', nodes, 'g:IfcWall')).toEqual({
      kind: 'collapse',
      group: 'IfcWall'
    })
    expect(treeKeyAction('ArrowLeft', nodes, 'i:2')).toEqual({ kind: 'focus', key: 'g:IfcWall' })
    // Already closed and at the top level: nothing to climb to.
    expect(treeKeyAction('ArrowLeft', nodes, 'g:IfcDoor')).toBeNull()
  })

  it('→ does nothing on a row — it has no children', () => {
    expect(treeKeyAction('ArrowRight', nodes, 'i:1')).toBeNull()
  })

  it('Home and End reach the first and last node of the whole tree', () => {
    expect(treeKeyAction('Home', nodes, 'i:2')).toEqual({ kind: 'focus', key: 'g:IfcDoor' })
    expect(treeKeyAction('End', nodes, 'g:IfcDoor')).toEqual({ kind: 'focus', key: 'i:3' })
    // Already there: no action at all, so the caller leaves the event alone.
    expect(treeKeyAction('Home', nodes, 'g:IfcDoor')).toBeNull()
  })

  it('Enter and Space do what a click does, on either kind of node', () => {
    expect(treeKeyAction('Enter', nodes, 'g:IfcWall')).toEqual({
      kind: 'activate',
      node: nodes[1]
    })
    expect(treeKeyAction(' ', nodes, 'i:2')).toEqual({ kind: 'activate', node: nodes[3] })
  })

  it('leaves every other key to the window — including the design’s own shortcuts', () => {
    for (const k of ['h', 'H', 'i', 'f', 'Escape', 'Tab', 'a', 'ArrowDownLeft']) {
      expect(treeKeyAction(k, nodes, 'i:1')).toBeNull()
    }
  })

  it('answers nothing at all on an empty tree', () => {
    expect(treeKeyAction('ArrowDown', [], null)).toBeNull()
    expect(treeKeyAction('Enter', [], null)).toBeNull()
  })

  it('walks a windowed group as if every row were rendered', () => {
    // 6 805 rows is `IfcMember` on the reference model; only ~60 of them are ever in the DOM.
    const big = treeNodes([group('IfcMember', true, Array.from({ length: 6805 }, (_, i) => i + 1))])
    expect(big).toHaveLength(6806)
    expect(treeKeyAction('End', big, 'g:IfcMember')).toEqual({ kind: 'focus', key: 'i:6805' })
    expect(treeKeyAction('ArrowDown', big, 'i:4000')).toEqual({ kind: 'focus', key: 'i:4001' })
  })
})
