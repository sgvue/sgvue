/**
 * The Markups card — `SGVue.dc.html:541–580`, ported element for element.
 *
 * A left-lane card, z-order 14, 330 px wide and scrolling. Two lists — `laser` and
 * `coordinates` — each with its own `clear`, numbered by position (`M1`, `C1`…), the tag
 * zooming to the markup and the × deleting it. The mm / m toggle is the design's `units` state,
 * which the status bar reads too.
 *
 * Its `max-height` stops above the status bar (`calc(100% - 110px)`), and since 2026-10-01
 * above the action bar too: `--abar` (`selectors/lanes.ts`) is that bar's lane, `0px` without it.
 *
 * Since 2026-10-08 a laser row reads each side of its point (`selectors/markups.ts`); a row that
 * reads two sides somewhere may wrap between two axes' readings when they do not fit on a line.
 */
import { Fragment } from 'react'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { measureRows, noMarks, spotRows, type MarkupRow } from '../state/selectors/markups'
import { on } from '../state/selectors/status'
import { s } from './css'
import { Cross } from './icons'

const ROW =
  'display:grid;grid-template-columns:26px minmax(0,1fr) 22px;align-items:center;gap:8px;padding:5px 4px;border-radius:6px'
const VALUE =
  'font:400 11.5px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
/**
 * 2026-10-08: a laser row that reads two sides of its point is wider than the column (up to
 * 311 px of 220, measured), so its value may wrap — between two axes' readings, never inside
 * one; one that fits is one line. A row with no two-sided axis has no `axes` and is `VALUE`.
 */
const VALUE_AXES = VALUE.replace('white-space:nowrap', 'white-space:normal')
const HEAD = 'display:flex;align-items:center;gap:8px'
const HEAD_LABEL = 'font:500 11px/1 var(--mono);color:var(--faint)'
const RULE = 'flex:1;height:1px;background:var(--border)'
const CLEAR = 'font:500 11px/1 var(--sans);color:var(--accent-ink)'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick(
  'card', 'cardTop', 'clearMeasures', 'clearSpots', 'closeCard', 'dropMeasure', 'dropSpot',
  'focusPoint', 'measureCount', 'measures', 'setUnits', 'spotCount', 'spots', 'units'
)

export default function MarkupsCard(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  if (st.card !== 'measure') return null
  const measures = measureRows(st.measures, st.units)
  const spots = spotRows(st.spots)
  const mm = on(st.units === 'mm')
  const m = on(st.units === 'm')

  const list = (
    label: string,
    rows: MarkupRow[],
    tip: string,
    clear: () => void,
    remove: (id: number) => void
  ): React.JSX.Element => (
    <div style={s('display:flex;flex-direction:column;gap:3px')}>
      <div style={s(HEAD)}>
        <span style={s(HEAD_LABEL)}>{label}</span>
        <span style={s(RULE)} />
        <button onClick={clear} style={s(CLEAR)}>
          clear
        </button>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="hv-step" style={s(ROW)}>
          <button
            onClick={() => st.focusPoint(r.p)}
            data-tip={tip}
            style={s('font:500 11px/1 var(--mono);color:var(--accent-ink)')}
          >
            {r.n}
          </button>
          {r.axes ? (
            <span style={s(VALUE_AXES)}>
              {r.axes.map((a, i) => (
                <Fragment key={i}>
                  {i > 0 && '   '}
                  <span style={s('white-space:nowrap')}>{a}</span>
                </Fragment>
              ))}
            </span>
          ) : (
            <span style={s(VALUE)}>{r.v}</span>
          )}
          <button
            onClick={() => remove(r.id)}
            title="Delete"
            className="hv-warn-both"
            style={s(
              'width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:5px;color:var(--faint)'
            )}
          >
            <Cross size={11} weight={2} />
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div
      style={s(
        `position:absolute;z-index:14;top:${st.cardTop}px;left:12px;width:330px;max-width:calc(100% - 24px - var(--rlane, 0px));max-height:calc(100% - 110px - var(--abar, 0px));overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out`
      )}
    >
      <div style={s('display:flex;align-items:center;gap:8px')}>
        <span
          style={s(
            'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
          )}
        >
          Markups
        </span>
        <span style={s('flex:1')} />
        <div
          style={s(
            'display:flex;align-items:center;height:24px;border:1px solid var(--border);border-radius:6px;overflow:hidden'
          )}
        >
          <button
            onClick={() => st.setUnits('mm')}
            style={s(
              `font:500 11px/1 var(--mono);height:100%;padding:0 8px;color:${mm.fg};background:${mm.bg}`
            )}
          >
            mm
          </button>
          <button
            onClick={() => st.setUnits('m')}
            style={s(
              `font:500 11px/1 var(--mono);height:100%;padding:0 8px;color:${m.fg};background:${m.bg}`
            )}
          >
            m
          </button>
        </div>
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
      {noMarks(st.measures, st.spots) && (
        <span
          style={s(
            'font:400 12px/1.5 var(--sans);color:var(--faint);text-wrap:pretty'
          )}
        >
          Nothing measured yet. Pick the laser meter (M) or spot coordinate (C) and click a
          surface — snapping catches corners and edges.
        </span>
      )}
      {st.measureCount > 0 &&
        list('laser', measures, 'Zoom to this measurement', st.clearMeasures, st.dropMeasure)}
      {st.spotCount > 0 && list('coordinates', spots, 'Zoom to this point', st.clearSpots, st.dropSpot)}
    </div>
  )
}
