/**
 * The Spatial-structure card — `SGVue.dc.html:257–278`.
 *
 * A left-lane card: `top` is the measured `cardTop`, and its width clamps against `--rlane`
 * rather than dodging under the property card (BUILD_PLAN §1.5, pitfalls 1–3). z-order 14.
 * Its `max-height` stops above the status bar, and since 2026-10-01 above the action bar too
 * (`--abar`, `selectors/lanes.ts` — `0px` while that bar is not drawn).
 *
 * **2026-11-23 — the card compares the models** (`docs/DEVIATIONS.md`; the owner's approved
 * prototype `prototype/project-card/`, matching rows merged, 11.5 px text). Same place, chrome,
 * header, cross and type scale; the body is a table with a column per model — 340 px for one
 * model as before, 190 px more for each other one, up to the lane — that scrolls both ways under
 * a fixed header, its key column and its model heading row sticky. Differing rows carry a dot in
 * the key gutter and a tint on the cells off the most common value; "differences only" (card
 * state, never saved) hides the rest. The rows are `selectors/spatial.ts`'s `spatialTable`. The
 * rules an inline style cannot carry — the row hover, the key column's hairline once scrolled,
 * the two new tokens and the rows' fade — are `styles/project-card.css`.
 */
import { Fragment, useMemo, useState } from 'react'
import { federation as fed } from '../model/federation-store'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { DASH, spatialTable, type SpatialRow, type SpatialSet } from '../state/selectors/spatial'
import { s } from './css'
import { Cross } from './icons'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick('card', 'cardTop', 'closeCard', 'federation', 'library', 'uploadNames', 'units', 'assignedColors', 'modelColors')

/** The key column: a 14 px gutter for the difference dot, 104 px of key, a 10 px gap. */
const KEY_W = 128
/** A model column with two or more models; with one, the value column that makes the card 340 px. */
const COL_W = 190
const ONE_W = 198

/** Soft breaks at camelCase humps and after `_`, so a long key or set name wraps where it reads. */
function soft(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const parts = text.replace(/([a-z])([A-Z])/g, '$1\u0000$2').replace(/_/g, '_\u0000').split('\u0000')
  parts.forEach((p, i) => {
    if (i) out.push(<wbr key={i} />)
    out.push(p)
  })
  return out
}

const KEY_TD =
  'position:sticky;left:0;z-index:1;background:var(--card);padding:3px 10px 3px 14px;font:400 11.5px/1.4 var(--sans);color:var(--muted);word-break:break-word;vertical-align:baseline;border-bottom:1px solid var(--row-line)'
/** A value: ink; the em dash faint; a GlobalId muted and on one line; a cell off the most common value tinted. */
const VAL =
  'display:block;width:fit-content;max-width:calc(100% + 5px);margin-left:-5px;padding:0 5px;border-radius:4px;font:400 11.5px/1.4 var(--mono);color:var(--ink);word-break:break-word'
const VAL_OFF =
  'display:block;width:fit-content;max-width:calc(100% + 5px);margin-left:-5px;padding:0 5px;border-radius:4px;font:400 11.5px/1.4 var(--mono);color:var(--ink);word-break:break-word;background:var(--diff-bg)'
const VAL_DASH =
  'display:block;width:fit-content;max-width:calc(100% + 5px);margin-left:-5px;padding:0 5px;border-radius:4px;font:400 11.5px/1.4 var(--mono);color:var(--faint);word-break:break-word'
const VAL_DASH_OFF =
  'display:block;width:fit-content;max-width:calc(100% + 5px);margin-left:-5px;padding:0 5px;border-radius:4px;font:400 11.5px/1.4 var(--mono);color:var(--faint);word-break:break-word;background:var(--diff-bg)'
const VAL_GID =
  'display:block;width:fit-content;max-width:calc(100% + 5px);margin-left:-5px;padding:0 5px;border-radius:4px;font:400 11.5px/1.4 var(--mono);color:var(--muted);white-space:nowrap'
/** The "differences only" pill, at rest and pressed (the MODELS `active` pill's look), and its count. */
const TOGGLE =
  'display:flex;align-items:center;gap:6px;font:500 11px/1 var(--sans);color:var(--muted);background:transparent;border:1px solid var(--border);border-radius:999px;padding:4px 8px 4px 7px'
const TOGGLE_ON =
  'display:flex;align-items:center;gap:6px;font:500 11px/1 var(--sans);color:var(--sel-ink);background:var(--sel-bg);border:1px solid var(--accent);border-radius:999px;padding:4px 8px 4px 7px'
const COUNT = 'font:400 10.5px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--faint)'
const COUNT_ON = 'font:400 10.5px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--sel-ink)'
const DIFF_DOT = 'position:absolute;left:5px;top:8.5px;width:5px;height:5px;border-radius:50%;background:var(--accent)'
/** A set heading's hairline; the last column's stops at the card's 14 px inset. */
const SET_LINE = 'flex:1;min-width:8px;height:1px;background:var(--row-line)'
const SET_LINE_END = 'flex:1;min-width:8px;height:1px;background:var(--row-line);margin-right:14px'

export default function ProjectCard(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  const [diffOnly, setDiffOnly] = useState(false)
  const t = useMemo(
    () =>
      spatialTable({
        federation: st.federation,
        // Each loaded model's file, read with the federation it belongs to (as the Sidebar's
        // MODELS rows read it): how a real file finds its library entry, keyed by its path.
        files: fed.sessionFiles(),
        library: st.library,
        uploadNames: st.uploadNames,
        modelColors: st.modelColors,
        units: st.units,
        assigned: st.assignedColors
      }),
    [st.federation, st.library, st.uploadNames, st.modelColors, st.units, st.assignedColors]
  )
  if (st.card !== 'project' || !t) return null

  const n = t.columns.length
  const multi = n > 1
  // Down to one model, the switch is gone and released, as the prototype's `build()` does.
  if (!multi && diffOnly) setDiffOnly(false)
  const only = multi && diffOnly
  const valueW = multi ? COL_W : ONE_W
  const cardW = 340 + COL_W * (n - 1)
  const tableW = KEY_W + valueW * n + 4
  /** The right padding of a model column: the last one keeps the card's 14 px inset. */
  const padR = (i: number): number => (i === n - 1 ? 14 : 10)

  const valueCell = (r: SpatialRow, v: string, i: number): React.JSX.Element => (
    <span
      title={v === DASH ? undefined : v}
      style={s(v === DASH ? (r.off[i] ? VAL_DASH_OFF : VAL_DASH) : r.gid ? VAL_GID : r.off[i] ? VAL_OFF : VAL)}
    >
      {v}
    </span>
  )

  const rowEl = (r: SpatialRow, key: string): React.JSX.Element | null => {
    if (only && !r.diff) return null
    return (
      <tr key={key} data-row="" style={s('animation:pcrowin .14s ease-out')}>
        <td data-key="" style={s(KEY_TD)}>
          {r.diff && <span role="img" aria-label="differs" style={s(DIFF_DOT)}></span>}
          {soft(r.k)}
        </td>
        {r.merged ? (
          <td colSpan={n} style={s('padding:3px 14px 3px 0;vertical-align:baseline;border-bottom:1px solid var(--row-line)')}>
            <span
              data-merged=""
              title={r.cells[0] === DASH ? undefined : r.cells[0]}
              style={s(
                `position:sticky;left:${KEY_W}px;display:block;width:fit-content;font:400 11.5px/1.4 var(--mono);color:${r.cells[0] === DASH ? 'var(--faint)' : 'var(--ink)'};word-break:break-word`
              )}
            >
              {r.cells[0]}
            </span>
          </td>
        ) : (
          r.cells.map((v, i) => (
            <td key={i} style={s(`padding:3px ${padR(i)}px 3px 0;vertical-align:baseline;border-bottom:1px solid var(--row-line)`)}>
              {valueCell(r, v, i)}
            </td>
          ))
        )}
      </tr>
    )
  }

  const setEl = (p: SpatialSet, key: string): React.JSX.Element | null => {
    if (only && !p.diff) return null
    const name = <span style={s('font:500 11px/1.4 var(--mono);color:var(--muted);word-break:break-word')}>{soft(p.name)}</span>
    if (!multi) {
      return (
        <tr key={key}>
          <td colSpan={2} style={s('position:sticky;left:0;z-index:1;background:var(--card);padding:10px 0 3px 14px;vertical-align:middle')}>
            <div style={s('display:flex;align-items:center;gap:8px')}>
              {name}
              <span style={s(SET_LINE_END)}></span>
            </div>
          </td>
        </tr>
      )
    }
    return (
      <tr key={key}>
        <td data-key="" style={s('position:sticky;left:0;z-index:1;background:var(--card);padding:10px 0 3px 14px;vertical-align:middle')}>
          <div style={s('display:flex;align-items:center;gap:8px')}>
            {name}
            <span style={s(SET_LINE)}></span>
          </div>
        </td>
        {p.has.map((has, i) => (
          <td key={i} style={s('padding:10px 0 3px;vertical-align:middle')}>
            <div style={s('display:flex;align-items:center;gap:8px')}>
              {!has && (
                <span
                  title={`${t.columns[i].label} carries no ${p.name}`}
                  style={s('font:400 11.5px/1.4 var(--mono);color:var(--faint);padding-right:2px')}
                >
                  {DASH}
                </span>
              )}
              <span style={s(i === n - 1 ? SET_LINE_END : SET_LINE)}></span>
            </div>
          </td>
        ))}
      </tr>
    )
  }

  return (
    <div
      style={s(
        `position:absolute;z-index:14;top:${st.cardTop}px;left:12px;width:${cardW}px;max-width:calc(100% - 24px - var(--rlane, 0px));max-height:calc(100% - 110px - var(--abar, 0px));display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out;overflow:hidden`
      )}
    >
      <div style={s('display:flex;align-items:center;gap:10px;padding:14px 14px 0')}>
        <span
          style={s(
            'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
          )}
        >
          Spatial structure
        </span>
        <span style={s('flex:1')}></span>
        {multi && (
          <button
            aria-pressed={diffOnly}
            onClick={() => setDiffOnly(!diffOnly)}
            className={diffOnly ? undefined : 'hv-step-ink'}
            style={s(diffOnly ? TOGGLE_ON : TOGGLE)}
          >
            <span style={s('width:5px;height:5px;border-radius:50%;background:var(--accent);flex:none')}></span>
            differences only
            <span style={s(diffOnly ? COUNT_ON : COUNT)}>
              {t.diffs}
            </span>
          </button>
        )}
        <button
          aria-label="Close"
          onClick={st.closeCard}
          className="hv-step-ink"
          style={s(
            'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
          )}
        >
          <Cross size={13} weight={1.8} />
        </button>
      </div>
      <div
        data-role="projtable"
        onScroll={(e) => e.currentTarget.toggleAttribute('data-scrolled', e.currentTarget.scrollLeft > 0)}
        style={s('overflow:auto;min-height:0;flex:1;padding-bottom:14px;margin-top:12px')}
      >
        <table style={s(`border-collapse:separate;border-spacing:0;table-layout:fixed;width:${tableW}px`)}>
          <colgroup>
            <col style={s(`width:${KEY_W}px`)} />
            {t.columns.map((c, i) => (
              <col key={c.key} style={s(`width:${i === n - 1 ? valueW + 4 : valueW}px`)} />
            ))}
          </colgroup>
          {multi && (
            <thead>
              <tr>
                <th
                  data-key=""
                  style={s(
                    'position:sticky;top:0;left:0;z-index:3;background:var(--card);padding:0 10px 8px 14px;border-bottom:1px solid var(--border)'
                  )}
                ></th>
                {t.columns.map((c, i) => (
                  <th
                    key={c.key}
                    style={s(
                      `position:sticky;top:0;z-index:2;background:var(--card);padding:0 ${padR(i)}px 8px 0;border-bottom:1px solid var(--border);text-align:left;font-weight:400`
                    )}
                  >
                    <div style={s('display:flex;align-items:center;gap:7px;min-width:0')}>
                      <span style={s(`width:9px;height:9px;border-radius:2px;flex:none;background:${c.swatch}`)}></span>
                      <span
                        title={c.file}
                        style={s(
                          'font:500 12px/1.3 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                        )}
                      >
                        {c.label}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {t.groups.map((g, gi) =>
              only && !g.diff ? null : (
                <Fragment key={g.type}>
                  <tr>
                    <td colSpan={n + 1} style={s(`padding:${gi === 0 && !multi ? 12 : 20}px 14px 5px`)}>
                      {/* A row as wide as the table: only the label is sticky, and the card-coloured
                          8 px past its edge covers the rule behind it once scrolled; the rule is
                          an ordinary line that scrolls with the table, so it always spans the
                          visible width without measuring it. */}
                      <div style={s('display:flex;align-items:center;gap:8px')}>
                        <span
                          style={s(
                            'position:sticky;left:14px;z-index:1;display:flex;align-items:center;gap:8px;background:var(--card);box-shadow:8px 0 0 var(--card),-14px 0 0 var(--card)'
                          )}
                        >
                          {!multi && g.type === 'IfcProject' && (
                            <span
                              style={s(`width:9px;height:9px;border-radius:2px;flex:none;background:${t.columns[0].swatch}`)}
                            ></span>
                          )}
                          <span style={s('font:500 12px/1 var(--mono);color:var(--accent-ink)')}>{g.type}</span>
                        </span>
                        <span style={s('flex:1;height:1px;background:var(--border)')}></span>
                        {!multi && (
                          <span
                            style={s(
                              'font:400 11px/1 var(--mono);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px'
                            )}
                          >
                            {g.name}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {g.lines.map((l, i) => (l.kind === 'set' ? setEl(l, `s${i}`) : rowEl(l, `r${i}`)))}
                </Fragment>
              )
            )}
          </tbody>
        </table>
        {only && t.diffs === 0 && (
          <div style={s('padding:18px 14px 4px;font:400 12px/1.5 var(--sans);color:var(--muted)')}>
            All rows match across {n} models.
          </div>
        )}
      </div>
    </div>
  )
}
