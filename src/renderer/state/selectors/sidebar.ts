/**
 * The sidebar's two drag handles — 2026-09-24, the owner: *"The left hand side panel: Models,
 * Storeys, Elements, Allow to resize them in height."*
 *
 * A handle sits on the boundary under the MODELS rows and under the STOREYS rows. Dragging it
 * gives the section **above** it an explicit height; the element tree keeps `flex:1` and takes
 * the rest. Until a handle is dragged nothing here applies and every style string is the
 * design's (plus the >6-storey rule), so parity is unchanged by default. A double-click puts
 * that section back to automatic.
 */

/**
 * The tree's floor once a section has been sized by hand: three rows. A group row is a 24 px
 * eye in 5 px of padding (34 px), and the tree's own `padding:2px 12px 12px 10px` adds 14.
 */
export const TREE_MIN = 3 * 34 + 14

/**
 * Where a drag settles. `startH` is the section's height when the drag began and `dy` how far
 * the pointer has moved down since; `min` is its header-less floor (one row plus its padding);
 * `treeH` is the tree's height at the start, of which everything above `TREE_MIN` may be
 * given up. The section never goes under `min`, and never grows by more than the tree can
 * give, so the aside never overflows. Whole pixels.
 */
export function clampSection(
  startH: number,
  dy: number,
  min: number,
  treeH: number,
  treeMin: number = TREE_MIN
): number {
  const max = Math.max(min, startH + Math.max(0, treeH - treeMin))
  return Math.round(Math.max(min, Math.min(max, startH + dy)))
}

/**
 * What a hand-sized rows wrapper gains: its height as the flex base, never grown, able to
 * shrink to `min` if the window later gets shorter, and scrolled inside when its content is
 * taller. Replaces the >6-storey tail on that wrapper; the other one is untouched.
 */
export const sizedTail = (h: number, min: number): string =>
  `;flex:0 1 ${h}px;min-height:${min}px;overflow:auto`
