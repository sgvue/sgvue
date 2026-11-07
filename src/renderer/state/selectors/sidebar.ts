/**
 * The sidebar's drag handle — 2026-09-24, the owner: *"The left hand side panel: Models,
 * Storeys, Elements, Allow to resize them in height."*
 *
 * A handle sits on the boundary under the STOREYS rows. Dragging it gives that section an
 * explicit height; the element tree keeps `flex:1` and takes the rest. Until it is dragged
 * nothing here applies and every style string is the design's (plus the >6-storey rule), so
 * parity is unchanged by default. A double-click puts the section back to automatic.
 *
 * **2026-11-07** — the owner: *"make it collapsible instead, but when expand always show full."*
 * The handle that sat under the MODELS rows is gone; MODELS folds behind its header instead and,
 * expanded, is always its full height. Since MODELS can no longer give way, the sidebar's last
 * resort is `sidebarTight` below.
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

/**
 * 2026-11-07 — the element tree's floor, as the tree's `min-height`: three rows once STOREYS is
 * sized by hand, else 40 % of the aside above the design's six storeys, else the design's `0`.
 * (Until 2026-11-07 a hand-sized section kept the 40 % above six storeys until *both* were
 * sized; the first drag pinned both, so a storeys drag always gave three rows. With one handle
 * left that is now the rule as written.)
 */
export function treeMinFor(crowded: boolean, storeysSized: boolean): string {
  return storeysSized ? `${TREE_MIN}px` : crowded ? '40%' : '0'
}

/** `treeMinFor`'s value in pixels, for an aside `asideH` tall. */
export function floorPx(min: string, asideH: number): number {
  if (min.endsWith('%')) return (asideH * parseFloat(min)) / 100
  return parseFloat(min) || 0
}

/**
 * 2026-11-07 — whether the sidebar has to give up its usual rules. `rigid` is everything in the
 * aside that never gives — the brand row, the project block, the search, the MODELS header and
 * rows (always full), the two section titles, and the STOREYS rows when they are not allowed to
 * shrink; `storeysFloor` is the least the STOREYS rows can be; `treeFloor` the tree's floor.
 * When their sum is over the aside's height, the usual rules would push the tree out of the
 * aside, where nothing could reach it. Half a pixel of tolerance, for fractional layout.
 *
 * Every input is a natural size or a floor, never a size the layout gave out, so the answer does
 * not change with the layout it chooses — it cannot flip back and forth.
 */
export function sidebarTight(
  rigid: number,
  storeysFloor: number,
  treeFloor: number,
  asideH: number
): boolean {
  return rigid + storeysFloor + treeFloor > asideH + 0.5
}

/**
 * 2026-11-07 — the tight sidebar: everything under the MODELS header becomes one column that
 * scrolls, and the tree's floor becomes the size it **prefers** — its flex basis — with three
 * rows as the floor it keeps. So the STOREYS rows still give way first (their shrink factor is a
 * million), then the tree, down to three rows; only past that does the column scroll. Not tight,
 * the column is `display:contents` and lays out nothing.
 */
export const TIGHT_COLUMN = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow-y:auto'
export const LOOSE_COLUMN = 'display:contents'
export const tightTree = (basisPx: number): string =>
  `flex:1 1 ${Math.round(basisPx)}px;min-height:${TREE_MIN}px`
