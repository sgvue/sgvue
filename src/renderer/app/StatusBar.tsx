/**
 * The status bar — `SGVue.dc.html:705–715` — and, since 2026-10-01, the action bar above it.
 *
 * Two of the status bar's five fixed fields are data here rather than literals, and both follow
 * rules the rest of the port already obeys:
 *
 * · `mm` — the design writes it as a literal even though it keeps a `units` state key
 *   (plan §3.5 defect 4). The unit shown is that key, which the Markups card's mm / m toggle
 *   sets.
 * · `SVY21` — true of the design's own Singapore subject and a placeholder for any other file.
 *   `shared/georef.ts`'s `crsChip` names the file's declared `IfcProjectedCRS`, keeps the
 *   design's own chip when that CRS is SVY21 / EPSG:3414 or the user has typed a base point
 *   this session, and shows the em dash when there is neither.
 *
 * **The action bar** (owner-requested: *"Can you move the clear button and undo button
 * somewhere?"*). The design appends `undo`, `redo`, `N measures` + `clear` and `N spots` +
 * `clear` to the status bar (`:711–714`), which then runs under the centred reset pill. Those
 * buttons — same copy, same `data-tip`s, same style strings, same handlers — are a bar of
 * their own, 3 px above the status bar, drawn only while one of them exists
 * (`hasActionBar`). The status bar keeps its five fields and nothing else, so its width no
 * longer depends on what has been done. The stage declares the bar's lane as `--abar`
 * (`selectors/lanes.ts`), which is what lifts the colour legend and shortens the two cards
 * that stop above the status bar.
 *
 * **Neither bar positions itself.** Both are the left zone of the stage's bottom row
 * (`app/BottomRow.tsx`), a column 3 px apart — which puts the status bar exactly where the
 * design's `left:12px;bottom:12px` did and the action bar exactly at `bottom:42px`.
 */
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { hasActionBar, statusValues } from '../state/selectors/status'
import { s } from './css'

const DOT = 'color:var(--border-strong)'
/**
 * `:705`, less its `position:absolute;left:12px;bottom:12px` — the row places it. Both bars are
 * this one card. The row takes no pointer events, so each bar asks for its own.
 */
const BAR =
  'display:flex;align-items:center;gap:10px;font:400 11px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--muted);background:var(--card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;box-shadow:var(--shadow);white-space:nowrap;pointer-events:auto'
/** `:711–714`: the two button styles the design gives these controls. */
const LINK = 'font:400 11px/1 var(--mono);color:var(--accent-ink)'
const CLEAR = 'font:500 11px/1 var(--sans);color:var(--accent-ink)'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick('stats', 'visibleCount', 'federation', 'units', 'coords')

export default function StatusBar(): React.JSX.Element {
  const st = useShell(useShallow(KEYS))
  const v = statusValues(st)
  return (
    <div data-role="statusbar" style={s(BAR)}>
      <span>{v.backend}</span>
      <span style={s(DOT)}>·</span>
      <span title="frames per second">{v.fps} fps</span>
      <span style={s(DOT)}>·</span>
      <span title="visible / total elements">
        {v.visibleCount} / {v.total}
      </span>
      <span style={s(DOT)}>·</span>
      <span>{v.units}</span>
      <span style={s(DOT)}>·</span>
      <span>{v.crs}</span>
    </div>
  )
}

/** What the action bar reads. Not `stats`: a frame-rate report must not re-render it. */
const ACTION_KEYS = pick(
  'canRedo', 'canUndo', 'clearMeasures', 'clearSpots', 'measureCount', 'openCard', 'spotCount',
  'step'
)

/**
 * `:711–714`, moved: the design's four conditional pieces in the design's own order. Each of
 * the two markup groups keeps the `·` the design puts in front of it — except when nothing
 * stands before it, so the bar never opens with a dot.
 */
export function ActionBar(): React.JSX.Element | null {
  const st = useShell(useShallow(ACTION_KEYS))
  if (!hasActionBar(st)) return null
  const history = st.canUndo || st.canRedo
  const measures = st.measureCount > 0
  const dot = <span style={s(DOT)}>·</span>
  return (
    <div data-role="actionbar" style={s(BAR)}>
      {st.canUndo && (
        <button
          onClick={() => st.step(true)}
          data-tip="Undo the last visibility change (⌘Z)"
          style={s(LINK)}
        >
          undo
        </button>
      )}
      {st.canRedo && (
        <button onClick={() => st.step(false)} data-tip="Redo (⇧⌘Z)" style={s(LINK)}>
          redo
        </button>
      )}
      {measures && (
        <>
          {history && dot}
          <button
            onClick={() => st.openCard('measure')}
            data-tip="Open the markups list"
            style={s(LINK)}
          >
            {st.measureCount} measures
          </button>
          <button onClick={st.clearMeasures} style={s(CLEAR)}>
            clear
          </button>
        </>
      )}
      {st.spotCount > 0 && (
        <>
          {(history || measures) && dot}
          <button
            onClick={() => st.openCard('measure')}
            data-tip="Open the markups list"
            style={s(LINK)}
          >
            {st.spotCount} spots
          </button>
          <button onClick={st.clearSpots} style={s(CLEAR)}>
            clear
          </button>
        </>
      )}
    </div>
  )
}
