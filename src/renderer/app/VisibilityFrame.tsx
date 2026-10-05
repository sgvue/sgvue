/**
 * The temporary-state frame and its reset pill — `SGVue.dc.html:304–311`, z-order 6.
 *
 * It ships with Phase 3 because Phase 3 ships the controls that hide things (the storey,
 * model, group and element eyes). Its filter-driven variant stays dormant until Phase 5 fills
 * `stack`.
 *
 * Two components since 2026-10-01, because the two elements now live in two places: the frame
 * (`:305`) is drawn here, where the design draws it, and the pill (`:306`) is one of the zones
 * of the stage's bottom row (`app/BottomRow.tsx`), which is what keeps it off the status bar and
 * the hint. Both ask the same selector, so they agree on whether anything is hidden — and since
 * 2026-10-02 they share its one answer (`visibilityFrameOnce`), where each used to compute its
 * own: one visibility change is one pass over the elements, whichever of the two asks first.
 */
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { visibilityFrameOnce, type VisFrame } from '../state/selectors/visibility'
import { s } from './css'

/** The store fields these components read — they re-render when one of them changes. */
const KEYS = pick('federation', 'hidden', 'showAll', 'stack', 'storeyVis', 'visibleCount')

/** What is hidden, how the frame says so, and the action that shows it again. */
function useFrame(): { v: VisFrame; showAll: () => void } {
  const st = useShell(useShallow(KEYS))
  const v = visibilityFrameOnce({
    elements: st.federation.elements,
    hidden: st.hidden,
    storeyVis: st.storeyVis,
    stack: st.stack,
    visibleCount: st.visibleCount
  })
  return { v, showAll: st.showAll }
}

/** `:305` — the border round the viewport. */
export default function VisibilityFrame(): React.JSX.Element | null {
  const { v } = useFrame()
  if (v.hiddenCount <= 0) return null
  return (
    <div
      aria-hidden="true"
      style={s(
        `position:absolute;inset:0;pointer-events:none;z-index:6;border:3px solid ${v.line};border-radius:2px;box-shadow:inset 0 0 0 1px ${v.glow}`
      )}
    ></div>
  )
}

/**
 * `:306` — the pill that says how much is out of sight, and puts it back. The design's string
 * less `position:absolute;bottom:14px;left:50%;transform:translateX(-50%)`: the bottom row's
 * centre zone places it now. `z-index:6` still applies, to a flex item.
 */
export function ResetPill(): React.JSX.Element | null {
  const { v, showAll } = useFrame()
  if (v.hiddenCount <= 0) return null
  return (
    <div
      data-role="resetpill"
      style={s(
        `z-index:6;display:flex;align-items:center;gap:9px;padding:6px 8px 6px 12px;background:${v.bg};border:1px solid ${v.line};border-radius:999px;box-shadow:var(--shadow);pointer-events:auto`
      )}
    >
      <span style={s(`font:500 11.5px/1 var(--sans);color:${v.fg};white-space:nowrap`)}>
        {v.label}
      </span>
      <button
        onClick={showAll}
        className="hv-card"
        style={s(
          `font:500 11.5px/1 var(--sans);color:${v.fg};padding:4px 9px;border:1px solid ${v.line};border-radius:999px;white-space:nowrap`
        )}
      >
        reset
      </button>
    </div>
  )
}
