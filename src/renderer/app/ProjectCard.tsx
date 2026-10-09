/**
 * The Spatial-structure card — `SGVue.dc.html:257–278`.
 *
 * A left-lane card: `top` is the measured `cardTop`, and its width clamps against `--rlane`
 * rather than dodging under the property card (BUILD_PLAN §1.5, pitfalls 1–3). z-order 14.
 * Its `max-height` stops above the status bar, and since 2026-10-01 above the action bar too
 * (`--abar`, `selectors/lanes.ts` — `0px` while that bar is not drawn).
 */
import { useMemo } from 'react'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { spatialCards } from '../state/selectors/spatial'
import { s } from './css'
import { Cross } from './icons'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick('card', 'cardTop', 'closeCard', 'coords', 'federation', 'library', 'uploadNames', 'units')

export default function ProjectCard(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  const cards = useMemo(
    () =>
      spatialCards({
        federation: st.federation,
        library: st.library,
        coords: st.coords,
        uploadNames: st.uploadNames,
        units: st.units
      }),
    [st.federation, st.library, st.coords, st.uploadNames, st.units]
  )
  if (st.card !== 'project') return null
  return (
    <div
      style={s(
        `position:absolute;z-index:14;top:${st.cardTop}px;left:12px;width:340px;max-width:calc(100% - 24px - var(--rlane, 0px));max-height:calc(100% - 110px - var(--abar, 0px));overflow:auto;display:flex;flex-direction:column;gap:14px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out`
      )}
    >
      <div style={s('display:flex;align-items:center;justify-content:space-between')}>
        <span
          style={s(
            'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
          )}
        >
          Spatial structure
        </span>
        <button
          onClick={st.closeCard}
          className="hv-step-ink"
          style={s(
            'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
          )}
        >
          <Cross size={13} weight={1.8} />
        </button>
      </div>
      {cards.map((sp, i) => (
        <div key={`${sp.type}-${i}`} style={s('display:flex;flex-direction:column;gap:7px')}>
          <div style={s('display:flex;align-items:center;gap:8px')}>
            {sp.swatch && (
              <span style={s(`width:9px;height:9px;border-radius:2px;flex:none;background:${sp.swatch}`)}></span>
            )}
            <span style={s('font:500 12px/1 var(--mono);color:var(--accent-ink)')}>{sp.type}</span>
            {sp.shared && (
              <span
                style={s(
                  'font:400 10px/1 var(--mono);color:var(--faint);border:1px solid var(--border);border-radius:999px;padding:3px 6px'
                )}
              >
                shared
              </span>
            )}
            <span style={s('flex:1;height:1px;background:var(--border)')}></span>
            <span
              style={s(
                'font:400 11px/1 var(--mono);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px'
              )}
            >
              {sp.name}
            </span>
          </div>
          {sp.rows.map((r) => (
            <div
              key={r.k}
              style={s('display:grid;grid-template-columns:104px minmax(0,1fr);gap:10px;align-items:baseline')}
            >
              <span style={s('font:400 11.5px/1.5 var(--sans);color:var(--muted)')}>{r.k}</span>
              <span style={s('font:400 11.5px/1.5 var(--mono);color:var(--ink);word-break:break-word')}>
                {r.v}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
