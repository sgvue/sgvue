/**
 * The property card — `SGVue.dc.html:313–410`, element by element.
 *
 * Right lane, `z-index: 14`, 320 px, `top: 184px`. Order is the design's and it is the point
 * (BUILD_PLAN Phase 3): four identity tiles, containment chips, PROPERTY SETS under a 2 px
 * rule and open by default, then Identifiers, Related and Geometry collapsed, geometry last.
 *
 * Every derived value comes from `state/selectors/props.ts`, which is `renderVals()`'s
 * arithmetic; this file is markup and event wiring only.
 *
 * 2026-10-01, owner-requested (*"…too long and got cut off, can you do a hover and show
 * full?"*): every text the card clips with an ellipsis carries its whole text as a native
 * `title` — the four identity tiles' values, each property set's header (the set's full name,
 * `Pset_WallCommon`, not the prettified one shown) and each property's name. Native, not
 * `data-tip`: the body is `overflow:auto` and would clip a `::after` tooltip. No style string
 * changed, so nothing drawn moves.
 *
 * The same day: the card's `max-height` takes the bottom row's lane, `--brow`
 * (`selectors/lanes.ts`), so a full-height card stops above a reset pill that stands over a
 * hint — or above a centre zone placed over the bars in a narrow window — instead of covering
 * it. With the lane at `0px`, which is whenever that row is one line, the length is the
 * design's `100% - 240px`.
 */
import { Fragment, useMemo } from 'react'
import { getViewer, pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { dimBtn, fullText, selectionCard, selTitle } from '../state/selectors/props'
import { s } from './css'

/** `SGVue.dc.html:363` etc. — the 9 px chevron each collapsible section opens with. */
function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--faint)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={s(`transform:${open ? 'rotate(90deg)' : 'none'};transition:transform .12s ease`)}
    >
      <path d="M9 5l7 7-7 7"></path>
    </svg>
  )
}

/** One identity tile. `:330–333` — four of them, and the labels are `--muted` (pitfall 9). */
function Tile({
  label,
  value,
  font
}: {
  label: string
  value: string
  font: string
}): React.JSX.Element {
  return (
    <div
      style={s(
        'display:flex;flex-direction:column;gap:3px;padding:7px 9px;background:var(--step-bg);border-radius:7px;min-width:0'
      )}
    >
      <span
        style={s(
          'font:600 10.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)'
        )}
      >
        {label}
      </span>
      <span
        title={fullText(value)}
        style={s(`font:${font};color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}
      >
        {value}
      </span>
    </div>
  )
}

/** `:362`, `:377`, `:394` — a collapsible section header. */
function SectionHead({
  open,
  label,
  count,
  onClick
}: {
  open: boolean
  label: string
  count?: number
  onClick: () => void
}): React.JSX.Element {
  return (
    <button onClick={onClick} className="hv-accent-ink" style={s('display:flex;align-items:center;gap:7px')}>
      <Chevron open={open} />
      <span
        style={s(
          'font:600 10.5px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)'
        )}
      >
        {label}
      </span>
      {count !== undefined && (
        <span style={s('font:500 10px/1 var(--mono);color:var(--faint)')}>{count}</span>
      )}
    </button>
  )
}

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick(
  'byId', 'coords', 'copied', 'copyGuid', 'dims', 'federation', 'offset', 'propOpen', 'sel',
  'selIds', 'select', 'toggleDims', 'toggleProp'
)

export default function PropertyCard(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  const viewer = getViewer()
  const element = st.sel != null ? (st.byId.get(st.sel) ?? null) : null
  const sel = useMemo(
    () =>
      selectionCard({
        federation: st.federation,
        element,
        box: element && viewer ? viewer.elementBox(element.id) : null,
        solids: element && viewer ? viewer.solidCount(element.id) : 0,
        coords: st.coords,
        offset: st.offset
      }),
    // `viewer` is a module-level handle, not state; the box is re-read whenever the selection,
    // the federation or the georeferencing changes, which is every time it can have moved.
    [st.federation, element, st.coords, st.offset, viewer]
  )
  if (!sel) return null

  const db = dimBtn(st.dims)
  const ids = !!st.propOpen.ids
  const rel = !!st.propOpen.rel
  const geo = !!st.propOpen.geo

  return (
    <div
      data-role="propcard"
      style={s(
        'position:absolute;z-index:14;top:184px;right:12px;width:320px;max-height:calc(100% - 240px - var(--brow, 0px));display:flex;flex-direction:column;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out'
      )}
    >
      <div
        style={s(
          'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px 10px 10px 14px;border-bottom:1px solid var(--border)'
        )}
      >
        <div style={s('display:flex;flex-direction:column;gap:4px;min-width:0')}>
          <span
            style={s(
              'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
            )}
          >
            {selTitle(st.selIds.length)}
          </span>
          <span style={s('font:500 14px/1.3 var(--sans);color:var(--ink)')}>{sel.name}</span>
        </div>
        <div style={s('display:flex;align-items:center;gap:6px;flex:none')}>
          <button
            onClick={st.toggleDims}
            title="Show dimensions of the selection (D)"
            className="hv-accent-line"
            style={s(
              `height:26px;flex:none;display:flex;align-items:center;gap:6px;padding:0 9px;border-radius:6px;font:500 11px/1 var(--mono);border:1px solid ${db.line};color:${db.fg};background:${db.bg}`
            )}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8h18v8H3z"></path>
              <path d="M7 8v3M11 8v3M15 8v3M19 8v3"></path>
            </svg>
            dims
          </button>
          <button
            onClick={() => st.select(null)}
            title="Close (Esc)"
            className="hv-step-ink"
            style={s(
              'width:26px;height:26px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
            )}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18"></path>
            </svg>
          </button>
        </div>
      </div>

      <div style={s('overflow:auto;padding:10px 14px 14px;display:flex;flex-direction:column;gap:12px')}>
        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:6px')}>
          <Tile label="IfcEntity" value={sel.type} font="500 12px/1.3 var(--mono)" />
          <Tile label="PredefinedType" value={sel.predefinedType} font="500 12px/1.3 var(--mono)" />
          <Tile label="ObjectType" value={sel.objectType} font="500 12.5px/1.3 var(--sans)" />
          <Tile label="Level" value={sel.storey} font="500 12.5px/1.3 var(--sans)" />
        </div>

        <div style={s('display:flex;flex-wrap:wrap;align-items:center;gap:4px')}>
          {sel.path.map((p) => (
            <Fragment key={p.v}>
              <span style={s('font:400 10.5px/1.4 var(--mono);color:var(--faint)')}>{p.v}</span>
              {p.sep && (
                <span style={s('font:400 10.5px/1.4 var(--mono);color:var(--border-strong)')}>›</span>
              )}
            </Fragment>
          ))}
        </div>

        <div
          style={s(
            'display:flex;flex-direction:column;gap:9px;padding-top:11px;border-top:2px solid var(--border-strong)'
          )}
        >
          <div style={s('display:flex;align-items:center;gap:8px')}>
            <span
              style={s(
                'font:600 10.5px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink)'
              )}
            >
              Property sets
            </span>
            <span style={s('font:500 10px/1 var(--mono);color:var(--faint)')}>{sel.psetCount}</span>
          </div>
          {sel.noPsets && (
            <span style={s('font:400 11.5px/1.5 var(--sans);color:var(--faint)')}>
              No property sets on this element.
            </span>
          )}
          {sel.psets.map((ps) => (
            <div
              key={ps.name}
              style={s(
                'display:flex;flex-direction:column;border:1px solid var(--border);border-radius:8px;overflow:hidden'
              )}
            >
              <div style={s('display:flex;align-items:center;gap:7px;padding:7px 9px;background:var(--step-bg)')}>
                <span
                  style={s(
                    `flex:none;font:600 9.5px/1 var(--mono);letter-spacing:.02em;color:${ps.badgeFg};background:${ps.badgeBg};border:1px solid ${ps.badgeLine};border-radius:4px;padding:3px 5px;white-space:nowrap`
                  )}
                >
                  {ps.kind}
                </span>
                <span
                  title={fullText(ps.name)}
                  style={s(
                    'flex:1;min-width:0;font:500 11.5px/1.3 var(--sans);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                  )}
                >
                  {ps.short}
                </span>
              </div>
              {ps.rows.map((r) => (
                <div
                  key={r.k}
                  style={s(
                    `display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:baseline;padding:6px 9px;border-top:${r.top}`
                  )}
                >
                  <span
                    title={fullText(r.k)}
                    style={s(
                      'font:400 11.5px/1.4 var(--sans);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                    )}
                  >
                    {r.k}
                  </span>
                  <span
                    style={s(
                      'font:400 11.5px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);text-align:right'
                    )}
                  >
                    {r.v}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div
          style={s('display:flex;flex-direction:column;gap:7px;padding-top:10px;border-top:1px solid var(--border)')}
        >
          <SectionHead open={ids} label="Identifiers" onClick={() => st.toggleProp('ids')} />
          {ids && (
            <div
              style={s(
                'display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 12px;align-items:baseline;font-size:11.5px'
              )}
            >
              <span style={s('color:var(--muted)')}>GlobalId</span>
              <span style={s('display:flex;align-items:center;gap:8px;min-width:0')}>
                <span
                  style={s(
                    'font:400 11px/1.5 var(--mono);color:var(--ink);word-break:break-all;min-width:0;flex:1'
                  )}
                >
                  {sel.guid}
                </span>
                <button
                  onClick={() => void st.copyGuid(sel.guid)}
                  title="Copy GlobalId"
                  className="hv-step-strong"
                  style={s(
                    `flex:none;height:21px;padding:0 7px;display:flex;align-items:center;border-radius:5px;border:1px solid var(--border);color:${st.copied ? 'var(--accent-ink)' : 'var(--muted)'};font:500 10px/1 var(--mono)`
                  )}
                >
                  {st.copied ? 'Copied' : 'Copy'}
                </button>
              </span>
              <span style={s('color:var(--muted)')}>Tag</span>
              <span style={s('font:400 11px/1.5 var(--mono);color:var(--ink)')}>{sel.tag}</span>
              <span style={s('color:var(--muted)')}>Model</span>
              <span style={s('font:400 11px/1.5 var(--mono);color:var(--ink)')}>{sel.model}</span>
              <span style={s('color:var(--muted)')}>Material</span>
              <span style={s('font:400 11.5px/1.5 var(--sans);color:var(--ink)')}>{sel.material}</span>
            </div>
          )}
        </div>

        <div
          style={s('display:flex;flex-direction:column;gap:7px;padding-top:10px;border-top:1px solid var(--border)')}
        >
          <SectionHead
            open={rel}
            label="Related"
            count={sel.relRows.length}
            onClick={() => st.toggleProp('rel')}
          />
          {rel &&
            sel.relRows.map((r) => (
              <button
                key={r.k}
                onClick={() => st.select(r.ids)}
                className="hv-step"
                style={s(
                  'display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:baseline;padding:5px 6px;margin:0 -6px;border-radius:6px'
                )}
              >
                <span style={s('font:400 11.5px/1.4 var(--sans);color:var(--muted)')}>{r.k}</span>
                <span
                  style={s(
                    'font:400 11.5px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink)'
                  )}
                >
                  {r.v}
                </span>
                <span style={s('font:500 10.5px/1.4 var(--mono);color:var(--accent-ink)')}>select</span>
              </button>
            ))}
        </div>

        <div
          style={s('display:flex;flex-direction:column;gap:7px;padding-top:10px;border-top:1px solid var(--border)')}
        >
          <SectionHead
            open={geo}
            label="Geometry"
            count={sel.geoRows.length}
            onClick={() => st.toggleProp('geo')}
          />
          {geo && (
            <div
              style={s(
                'display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;align-items:baseline'
              )}
            >
              {sel.geoRows.map((r) => (
                <Fragment key={r.k}>
                  <span style={s('font:400 11.5px/1.4 var(--sans);color:var(--muted);white-space:nowrap')}>
                    {r.k}
                  </span>
                  <span
                    style={s(
                      'font:400 11.5px/1.4 var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);text-align:right'
                    )}
                  >
                    {r.v}
                  </span>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
