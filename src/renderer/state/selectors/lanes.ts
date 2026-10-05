/**
 * Overlay lane arbitration — `BUILD_PLAN.md` §1.5 and `SGVue.dc.html:2049–2050`.
 *
 * The viewport hosts absolutely-positioned overlays that compete for width. The lanes are
 * *declared*; nothing nudges an offset (pitfall 1), and nothing falls back to an overlapped
 * position (pitfall 2) — a card clamps its width against `--rlane` instead.
 */

/** The property card's reserved width, in CSS pixels. `SGVue.dc.html:2050`. */
export const RIGHT_LANE = 332

/** Below this stage width there is no room for the lane, so it collapses. `:2049`. */
export const RIGHT_LANE_MIN_STAGE = 420

/** The chat panel's own right offset when the lane is live. `:2049`. */
export const CHAT_RIGHT = 344

/** Measured toolbar height plus this is every left-lane card's `top`. `:873`. */
export const CARD_TOP_GAP = 24

/**
 * `--rlane` on the stage: `'332px'` while a selection is showing its card **and** the stage is
 * at least 420 px wide, else `'0px'`.
 */
export const rlane = (hasSelection: boolean, stageWidth: number): string =>
  hasSelection && stageWidth >= RIGHT_LANE_MIN_STAGE ? `${RIGHT_LANE}px` : '0px'

/** The chat panel's `right`, the same decision one step over. `:2049`. */
export const chatRight = (hasSelection: boolean, stageWidth: number): number =>
  hasSelection && stageWidth >= RIGHT_LANE_MIN_STAGE ? CHAT_RIGHT : 12

/**
 * The action bar's lane, in CSS pixels (2026-10-01): the bar's own 27 px — the status bar's
 * measured height, the same one line of 11 px type in the same padding — and the 3 px the
 * design already leaves between the status bar and the colour legend (`bottom:42px`, `:413`).
 */
export const ACTION_LANE = 30

/**
 * `--abar` on the stage: `'30px'` while the action bar is drawn, else `'0px'`. The colour
 * legend sits that much higher, and the two left-lane cards that stop short of the status bar
 * (Markups, Spatial structure) stop that much sooner. With `0px` every one of those lengths is
 * the design's own.
 */
export const abar = (shown: boolean): string => (shown ? `${ACTION_LANE}px` : '0px')

/* ── the bottom row (2026-10-01, `app/BottomRow.tsx`) ── */

/** The gap on either side of the bottom row's centre zone, in CSS pixels. */
export const BOTTOM_GAP = 10

/**
 * The narrowest a hint may be wrapped to. At 200 px the longest hint (the laser's, 522 px on
 * one line) is three lines; narrower than that it becomes a column of single words — measured
 * at 62 px in a 760 px window: fifteen lines.
 */
export const HINT_MIN = 200

/** Where the bottom row's centre zone stands. */
export type CentrePlace = 'empty' | 'between' | 'above'

/**
 * Where the bottom row's centre zone stands: `between` the two side zones, a gap on either
 * side of it, while the room they leave is at least what it needs — the reset pill's own
 * width, which cannot wrap, or `HINT_MIN` for a hint — and `above` them, on a row of its own,
 * when it is not. `empty` (`need` 0) is nothing to place, and no gaps to keep. Every argument is
 * a measured width that does not depend on the answer, so the layout cannot flip back and forth.
 */
export const centrePlace = (row: number, left: number, right: number, need: number): CentrePlace =>
  need <= 0 ? 'empty' : need > row - left - right - 2 * BOTTOM_GAP ? 'above' : 'between'

/**
 * How far above the stage's foot the design stops the chat panel (`bottom:52px`, `:431`) — the
 * room it leaves for the bottom row's one line: the Ask pill's top is 46 px up, a one-line
 * hint's 46.8 and the reset pill's 49.5.
 */
export const ROW_ROOM = 52

/** The clearance the design keeps between that panel and the Ask pill under it (52 − 14 − 32). */
export const ROW_CLEAR = 6

/**
 * The bottom row's lane, in whole CSS pixels (2026-10-01): what the row's centre zone needs
 * above the one line the design leaves room for. `centreTop` is the measured distance from the
 * stage's foot up to the top of the centre zone (0 with nothing in it).
 *
 * `0` while that top is within the one-line row — a hint alone, the reset pill alone: the
 * design's own layout, which nothing may move. Otherwise — the pill standing over a hint, a
 * wrapped hint, the centre placed above the bars — what it takes to keep the design's 6 px
 * between the centre zone and whatever stops above the row, rounded up so that what takes the
 * lane stays on whole pixels.
 */
export const browFrom = (centreTop: number): number =>
  centreTop <= ROW_ROOM ? 0 : Math.ceil(centreTop + ROW_CLEAR - ROW_ROOM)

/**
 * `--brow` on the stage, declared like `--rlane` and `--abar`: the chat panel's `bottom` and
 * `max-height`, its resize clamp and the property card's `max-height` take it, so each stops
 * above a centre zone that is taller than one line instead of covering it. With `0px` every
 * one of those lengths is the design's own.
 */
export const brow = (lane: number): string => `${lane}px`

/** `cardTop` from a `ResizeObserver` on the toolbar. `SGVue.dc.html:873`. */
export const cardTopFrom = (toolbarHeight: number): number =>
  Math.round(toolbarHeight) + CARD_TOP_GAP
