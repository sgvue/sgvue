/**
 * The stage's bottom edge, as one row — 2026-10-01, owner-requested (*"…So they are
 * overlapped."*).
 *
 * The design gives the bottom edge five separately positioned pieces: the status bar
 * (`SGVue.dc.html:705`, `left:12px;bottom:12px`), the buttons it appended (`:711–714` — the
 * action bar, `app/StatusBar.tsx`), the hint bar (`:702`) and the reset pill (`:306`) — both
 * `bottom:14px;left:50%` — and the Ask pill (`:536`, `right:12px;bottom:14px`). Each is placed
 * without knowing the others, so every pair that can meet does: the hint under the status bar,
 * the pill over the hint, the pill on the status bar in a narrow window.
 *
 * Here they are the zones of one grid, and a grid's tracks cannot overlap:
 *
 *   left     the action bar above the status bar, 3 px apart
 *   centre   the hint, and the reset pill above it when both show
 *   right    the Ask pill
 *
 * `1fr minmax(0,auto) 1fr`: a side track never goes below its own content (both bars and the
 * Ask pill are `nowrap`), and the centre takes its content's width while there is room. So a
 * short centre — the pill — stands on the stage's centre line exactly where the design put it;
 * a long one — a hint — is pushed right of the left zone instead of running under it; and only
 * when there is still not room does the hint wrap.
 *
 * **One thing a track cannot do is shrink the pill**, which does not wrap. So when the side
 * zones leave the centre less room than it needs (`selectors/lanes.ts`, `centrePlace`) the
 * centre zone stands above them, on a row of its own across the stage — measured, because the
 * status bar's width is the file's (a CRS name is any length), not a number to declare. The
 * 10 px gaps are kept only while the centre stands between the side zones: with nothing there,
 * the two of them are as far apart as the design's own offsets put them, and no further.
 *
 * Every piece keeps its own markup, copy, handlers and style string — less the
 * `position:absolute`, the offsets and the centring transform the row now does for it. The
 * row itself takes no pointer events, so the canvas keeps its clicks in the gaps.
 *
 * **The row's lane.** The chat panel and the property card are not zones of the row; each stops
 * a fixed distance above the stage's foot, which is room for the row's one line. When the
 * centre zone is taller than that — the reset pill over a hint, a wrapped hint, the centre
 * above the bars — the row says by how much: it measures the centre zone's top where it places
 * it, and the store's `brow` (`browFrom`, `selectors/lanes.ts`) is declared on the stage as
 * `--brow`, which those two subtract. Nothing in the row reads the lane, so it cannot feed back
 * into what was measured.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import {
  BOTTOM_GAP,
  browFrom,
  centrePlace,
  HINT_MIN,
  type CentrePlace
} from '../state/selectors/lanes'
import { ChatPill } from './ChatPanel'
import HintBar from './HintBar'
import StatusBar, { ActionBar } from './StatusBar'
import { ResetPill } from './VisibilityFrame'
import { s } from './css'

/**
 * What the centre zone holds changes with these. The row reads none of them: it re-renders with
 * them so that it measures again in the same commit — before the paint, not a frame after it.
 */
const CENTRE_KEYS = pick('federation', 'hidden', 'storeyVis', 'stack', 'visibleCount', 'hint', 'tool')

export default function BottomRow(): React.JSX.Element {
  const row = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<CentrePlace>('empty')
  useShell(useShallow(CENTRE_KEYS))

  const fit = (): void => {
    const node = row.current
    if (!node) return
    const [left, centre, right] = [...node.children] as HTMLElement[]
    let need = 0
    for (const piece of [...centre.children] as HTMLElement[]) {
      need = Math.max(need, piece.dataset.role === 'hintbar' ? HINT_MIN : piece.offsetWidth)
    }
    setPlace(centrePlace(node.clientWidth, left.offsetWidth, right.offsetWidth, need))
    // The lane: how far the centre zone's top stands above the stage's foot. Read off the
    // layout as it is now; a change of place renders the row again, and that measures again.
    const stage = node.offsetParent
    const top =
      stage && centre.children.length
        ? stage.getBoundingClientRect().bottom - centre.getBoundingClientRect().top
        : 0
    useShell.getState().setBrow(browFrom(top))
  }
  // After every render of the row, and whenever the window or a zone changes size without one
  // (a resize, the status bar's own text).
  useLayoutEffect(fit)
  useLayoutEffect(() => {
    const node = row.current
    if (!node) return
    const ro = new ResizeObserver(fit)
    for (const box of [node, ...node.children]) ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const above = place === 'above'
  return (
    <div
      ref={row}
      data-role="bottomrow"
      style={s(
        `position:absolute;left:12px;right:12px;bottom:12px;display:grid;grid-template-columns:1fr minmax(0,auto) 1fr;column-gap:${place === 'between' ? BOTTOM_GAP : 0}px;row-gap:6px;align-items:end;pointer-events:none`
      )}
    >
      {/* `align-items:flex-start`: each bar keeps its own width rather than the wider one's. */}
      <div
        style={s(
          'justify-self:start;display:flex;flex-direction:column;align-items:flex-start;gap:3px' +
            (above ? ';grid-row:2;grid-column:1' : '')
        )}
      >
        <ActionBar />
        <StatusBar />
      </div>
      {/* `margin-bottom:2px` is the design's `bottom:14px` against the row's 12. Between the
          side zones the pill stands over the hint's **start**, not its middle: centred over a
          522 px hint its `reset` end is under the open chat panel (39 px at the default window)
          or a full-height property card (29 px), both of which stop 52–56 px above the stage's
          foot — room for one line, not for two. Alone, either piece is the zone's whole width,
          so this moves nothing. */}
      <div
        style={s(
          'display:flex;flex-direction:column-reverse;gap:6px;min-width:0' +
            (above
              ? ';align-items:center;grid-row:1;grid-column:1 / -1;justify-self:center;max-width:100%'
              : ';align-items:flex-start;margin-bottom:2px')
        )}
      >
        <HintBar />
        <ResetPill />
      </div>
      <div
        style={s(
          'justify-self:end;display:flex;margin-bottom:2px' + (above ? ';grid-row:2;grid-column:3' : '')
        )}
      >
        <ChatPill />
      </div>
    </div>
  )
}
