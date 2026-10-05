/**
 * The colour-by-property legend — `SGVue.dc.html:412–428`, ported element for element.
 *
 * Bottom-left of the stage, 230 px wide, z-order **11** — under the cards (14), the chat pill
 * (13) and the chat panel (12), over the temporary-state frame (6). It is the one left-lane
 * surface with a fixed width and no `--rlane` clamp: the design gives it `width:230px` and
 * `bottom:42px`, which clears the status bar, and `max-height:calc(100% - cardTop - 60px)`, so
 * it scrolls rather than growing into the toolbar (`BUILD_PLAN.md` §1.5 — lanes are declared,
 * never nudged). Since 2026-10-01 both lengths also take the action bar's lane, `--abar`
 * (`selectors/lanes.ts`): the legend stands 3 px above that bar while it is drawn, and exactly
 * where the design put it while it is not (`--abar` is then `0px`).
 *
 * The header carries the property's own name; the × clears the scheme; each row is a button
 * that **selects that group's elements** (`select(ids, false)` — no zoom, `:2043`). Row swatches
 * are the fixed `SCHEME` hexes, so nothing here is a theme token.
 */
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { s } from './css'
import { Cross } from './icons'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick('cardTop', 'clearColorBy', 'colorBy', 'select')

export default function ColorLegend(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  // `:412` — `hasScheme: !!s.colorBy` (`:2042`).
  if (!st.colorBy) return null
  const { prop, groups } = st.colorBy

  return (
    <div
      style={s(
        `position:absolute;left:12px;bottom:calc(42px + var(--abar, 0px));z-index:11;width:230px;max-height:calc(100% - ${st.cardTop}px - 60px - var(--abar, 0px));display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out`
      )}
    >
      <div
        style={s(
          'display:flex;align-items:center;gap:7px;padding:8px 8px 8px 11px;border-bottom:1px solid var(--border)'
        )}
      >
        <span
          style={s(
            'flex:1;min-width:0;font:600 10px/1.3 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
          )}
        >
          {prop}
        </span>
        <button
          onClick={st.clearColorBy}
          title="Clear colour scheme"
          className="hv-step-ink"
          style={s(
            'width:20px;height:20px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:5px;color:var(--faint)'
          )}
        >
          <Cross size={11} weight={2} />
        </button>
      </div>
      <div style={s('overflow:auto;padding:5px 5px 7px')}>
        {groups.map((g) => (
          <button
            key={g.v}
            onClick={() => st.select([...g.ids], false)}
            data-tip="Select these elements"
            className="hv-step"
            style={s(
              'display:grid;grid-template-columns:11px minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;padding:5px 6px;border-radius:6px'
            )}
          >
            <span style={s(`width:11px;height:11px;border-radius:3px;background:${g.color}`)} />
            <span
              style={s(
                'font:400 11.5px/1.35 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left'
              )}
            >
              {g.v}
            </span>
            <span
              style={s(
                'font:400 10.5px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--faint)'
              )}
            >
              {String(g.n)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
