/**
 * The Filter card — `SGVue.dc.html:605–685`, ported element for element.
 *
 * A left-lane card like the Spatial-structure one: `top` is the measured `cardTop`, its width
 * clamps against `--rlane`, z-order 14.
 *
 * The block order is the design's and is not obvious: the step list, then the rule builder for
 * the selected step, then that step's highlight colours, then **saved sets**, and only then the
 * isolate / hide / highlight control and the match count. Saved sets sit in the middle.
 */
import { Fragment, useMemo } from 'react'
import { curStep } from '../../shared/filter-stack'
import {
  ABSENT_LABEL,
  ABSENT_LABEL_SHORT,
  ABSENT_OP,
  type Rule,
  type RuleJoin,
  type RuleOp
} from '../../shared/rules'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import {
  actionFlags,
  hlColorChips,
  matchCount,
  ruleRows,
  stackRows,
  stepTitle,
  stepToggle
} from '../state/selectors/filter'
import { s } from './css'
import { Cross, MoveArrow, StepEye } from './icons'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick(
  'addStep', 'applyFilterSet', 'card', 'cardTop', 'clearStack', 'closeCard', 'dropStep',
  'federation', 'filterSets', 'forgetFilterSet', 'moveStep', 'pickStep', 'propKeys',
  'saveFilterSet', 'setStepColor', 'setStepRules', 'stack', 'stepSel', 'updStep'
)

export default function FilterCard(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  const elements = st.federation.elements
  const step = useMemo(() => curStep(st.stack, st.stepSel), [st.stack, st.stepSel])
  const rows = useMemo(
    () => stackRows(st.stack, elements, step?.id ?? null),
    [st.stack, elements, step]
  )
  const rules = useMemo(
    () => ruleRows(step?.rules ?? [], elements),
    [step?.rules, elements]
  )
  const fm = actionFlags(step)
  const ft = stepToggle(step)
  const hlColors = hlColorChips(step)
  const total = elements.length
  const matched = useMemo(() => matchCount(step, elements), [step, elements])

  if (st.card !== 'filter') return null

  const stepRules: readonly Rule[] = step?.rules ?? []
  const setRule = (i: number, patch: Partial<Rule>): void => {
    if (!step) return
    st.setStepRules(
      step.id,
      stepRules.map((x, j) => (j === i ? { ...x, ...patch } : x))
    )
  }

  return (
    <div
      style={s(
        `position:absolute;z-index:14;top:${st.cardTop}px;left:12px;width:340px;max-width:calc(100% - 24px - var(--rlane, 0px));display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out`
      )}
    >
      <div style={s('display:flex;align-items:center;justify-content:space-between')}>
        <span
          style={s(
            'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
          )}
        >
          Filter
        </span>
        <button
          onClick={st.closeCard}
          className="hv-step-ink"
          style={s(
            'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
          )}
        >
          <Cross size={14} weight={1.8} />
        </button>
      </div>

      {/* ── the step list (`:608`) ── */}
      <div style={s('display:flex;flex-direction:column;gap:5px')}>
        <div style={s('display:flex;align-items:center;gap:8px')}>
          <span style={s('font:500 11px/1 var(--mono);color:var(--faint)')}>
            steps apply in order
          </span>
          <span style={s('flex:1;height:1px;background:var(--border)')}></span>
          {rows.length > 0 && (
            <button
              onClick={st.clearStack}
              className="hv-warn-ink"
              style={s('font:500 11px/1 var(--sans);color:var(--muted)')}
            >
              clear
            </button>
          )}
        </div>
        {rows.length === 0 && (
          <span
            style={s('font:400 11.5px/1.5 var(--sans);color:var(--faint);text-wrap:pretty')}
          >
            No filter steps. Each step isolates, hides or highlights what it matches, and later
            steps act on what earlier ones left.
          </span>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            onClick={() => st.pickStep(r.id)}
            className="hv-step"
            style={s(
              `display:grid;grid-template-columns:16px 22px auto minmax(0,1fr) auto 18px 18px 20px;align-items:center;gap:6px;padding:5px 5px 5px 3px;border-left:2px solid ${r.edge};background:${r.bg};border-radius:0 6px 6px 0;cursor:pointer;opacity:${r.opacity}`
            )}
          >
            <span style={s('font:500 10px/1 var(--mono);color:var(--faint);text-align:center')}>
              {r.n}
            </span>
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                st.updStep(r.id, { on: !r.on })
              }}
              title="Enable / disable this step"
              style={s(
                `width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:5px;color:${r.eyeFg}`
              )}
            >
              <StepEye />
            </button>
            <span
              style={s(
                `font:600 9.5px/1 var(--mono);letter-spacing:.02em;color:${r.aFg};background:${r.aBg};border-radius:4px;padding:3px 5px;white-space:nowrap`
              )}
            >
              {r.action}
            </span>
            <span
              style={s(
                'font:400 11px/1.3 var(--mono);color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
              )}
            >
              {r.label}
            </span>
            <span
              style={s(
                'font:400 10.5px/1 var(--mono);font-variant-numeric:tabular-nums;color:var(--faint)'
              )}
            >
              {r.count}
            </span>
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                st.moveStep(r.id, -1)
              }}
              title="Move earlier"
              className="hv-card-ink"
              style={s(
                'width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:4px;color:var(--faint)'
              )}
            >
              <MoveArrow up />
            </button>
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                st.moveStep(r.id, 1)
              }}
              title="Move later"
              className="hv-card-ink"
              style={s(
                'width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:4px;color:var(--faint)'
              )}
            >
              <MoveArrow up={false} />
            </button>
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                st.dropStep(r.id)
              }}
              title="Remove step"
              className="hv-warn-both"
              style={s(
                'width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:5px;color:var(--faint)'
              )}
            >
              <Cross size={11} weight={2} />
            </button>
          </div>
        ))}
        <button
          onClick={() => st.addStep('isolate')}
          style={s('align-self:flex-start;font:500 12px/1 var(--sans);color:var(--accent-ink);padding:4px 0')}
        >
          + add filter step
        </button>
      </div>

      {/* ── the rule builder for the selected step (`:632`) ── */}
      {step && (
        <div
          style={s(
            'display:flex;flex-direction:column;gap:6px;padding-top:11px;border-top:1px solid var(--border)'
          )}
        >
          <span
            style={s(
              'font:600 10.5px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)'
            )}
          >
            {stepTitle(st.stack, step)}
          </span>
          {rules.map((r, i) => (
            <Fragment key={r.listId}>
              {r.notFirst && (
                <button
                  onClick={() =>
                    setRule(i, { join: (r.join === 'or' ? 'and' : 'or') as RuleJoin })
                  }
                  title="Switch AND / OR"
                  className="hv-accent-sel"
                  style={s(
                    'align-self:flex-start;font:600 10.5px/1 var(--mono);letter-spacing:.08em;padding:4px 8px;border:1px solid var(--border);border-radius:999px;color:var(--accent-ink);margin:2px 0'
                  )}
                >
                  {r.joinLabel}
                </button>
              )}
              <div
                style={s(
                  'display:grid;grid-template-columns:minmax(0,1.3fr) 64px minmax(0,1fr) 22px;gap:5px;align-items:center'
                )}
              >
                <select
                  value={r.prop}
                  onChange={(e) => setRule(i, { prop: e.target.value, val: '' })}
                  style={s(
                    'font:400 12px/1.3 var(--sans);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:6px 6px;min-width:0'
                  )}
                >
                  {st.propKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <select
                  value={r.op}
                  // `absent` ignores the value, so switching to it clears the one that is
                  // there — the same thing the property select one column left already does.
                  onChange={(e) =>
                    setRule(
                      i,
                      e.target.value === ABSENT_OP
                        ? { op: ABSENT_OP, val: '' }
                        : { op: e.target.value as RuleOp }
                    )
                  }
                  style={s(
                    'font:400 12px/1.3 var(--mono);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:6px 4px;min-width:0'
                  )}
                >
                  <option value="=">=</option>
                  <option value="!=">≠</option>
                  <option value="~">contains</option>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                  {/*
                    2026-09-20, user-approved. The one operator the design does not have.
                    The control is 64 px wide, so the option text is the short label and the
                    phrase rides on its `title` — the same attribute the design uses for every
                    other control's tooltip. `ruleText` prints the phrase in the step row.
                  */}
                  <option value={ABSENT_OP} title={ABSENT_LABEL}>
                    {ABSENT_LABEL_SHORT}
                  </option>
                </select>
                <input
                  value={String(r.val ?? '')}
                  onChange={(e) => setRule(i, { val: e.target.value })}
                  list={r.listId}
                  placeholder={r.valueUnused ? 'not used' : 'value'}
                  disabled={r.valueUnused}
                  className="fv-field"
                  style={s(
                    'width:100%;font:400 12px/1.3 var(--mono);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:6px 8px;min-width:0' +
                      // The step row's own "switched off" idiom (`:1889`), so the field keeps
                      // its exact box, border and place in the grid and simply reads as inert.
                      (r.valueUnused ? ';opacity:.45' : '')
                  )}
                />
                <datalist id={r.listId}>
                  {r.values.map((v) => (
                    <option key={v} value={v}></option>
                  ))}
                </datalist>
                <button
                  onClick={() =>
                    st.setStepRules(
                      step.id,
                      stepRules.filter((_, j) => j !== i)
                    )
                  }
                  title="Remove rule"
                  className="hv-step-ink"
                  style={s(
                    'width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
                  )}
                >
                  <Cross size={12} weight={2} />
                </button>
              </div>
            </Fragment>
          ))}
          <button
            onClick={() =>
              st.setStepRules(step.id, [
                ...stepRules,
                { prop: 'ObjectType', op: '=', val: '', join: 'and' }
              ])
            }
            style={s(
              'align-self:flex-start;font:500 12px/1 var(--sans);color:var(--accent-ink);padding:4px 0'
            )}
          >
            + add condition
          </button>
        </div>
      )}

      {/* ── this step's highlight colour (`:650`) ── */}
      {step?.action === 'highlight' && (
        <div style={s('display:flex;align-items:center;gap:8px')}>
          <span style={s('font-size:12px;color:var(--muted)')}>{"This step's colour"}</span>
          <div style={s('display:flex;gap:6px')}>
            {hlColors.map((h) => (
              <button
                key={h.c}
                onClick={() => st.setStepColor(step.id, h.c)}
                style={s(
                  `width:18px;height:18px;border-radius:50%;background:${h.c};border:2px solid var(--card);box-shadow:0 0 0 1.5px ${h.ring}`
                )}
              ></button>
            ))}
          </div>
        </div>
      )}

      {/* ── saved sets (`:660`) ── */}
      <div style={s('display:flex;flex-direction:column;gap:6px')}>
        <div style={s('display:flex;align-items:center;gap:8px')}>
          <span style={s('font:500 11px/1 var(--mono);color:var(--faint)')}>saved sets</span>
          <span style={s('flex:1;height:1px;background:var(--border)')}></span>
          <button
            // Called with no argument on purpose: `saveFilterSet` now takes an optional name
            // (`manage_filters` passes one) and the click event must not become it.
            onClick={() => st.saveFilterSet()}
            style={s('font:500 11px/1 var(--sans);color:var(--accent-ink)')}
          >
            save current
          </button>
        </div>
        {st.filterSets.length > 0 && (
          <div style={s('display:flex;flex-wrap:wrap;gap:5px')}>
            {st.filterSets.map((f) => (
              <span
                key={f.id}
                className="hv-accent-line"
                style={s(
                  'display:flex;align-items:center;gap:2px;border:1px solid var(--border);border-radius:999px;background:var(--card)'
                )}
              >
                <button
                  onClick={() => st.applyFilterSet(f)}
                  style={s(
                    'font:400 11px/1 var(--mono);color:var(--ink);padding:6px 2px 6px 9px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
                  )}
                >
                  {f.label}
                </button>
                <button
                  onClick={(ev) => {
                    ev.stopPropagation()
                    st.forgetFilterSet(f.id)
                  }}
                  title="Forget this set"
                  className="hv-warn-both"
                  style={s(
                    'width:20px;height:20px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:var(--faint);margin-right:3px'
                  )}
                >
                  <Cross size={9} weight={2.6} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── the selected step's action, and how much it matches (`:673`) ── */}
      {step && (
        <>
          <div
            style={s(
              'display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;align-self:flex-start'
            )}
          >
            <button
              onClick={() => st.updStep(step.id, { action: 'isolate' })}
              style={s(
                `font:500 12px/1 var(--mono);padding:8px 13px;border-right:1px solid var(--border);color:${fm.isolate.fg};background:${fm.isolate.bg}`
              )}
            >
              isolate
            </button>
            <button
              onClick={() => st.updStep(step.id, { action: 'hide' })}
              style={s(
                `font:500 12px/1 var(--mono);padding:8px 13px;border-right:1px solid var(--border);color:${fm.hide.fg};background:${fm.hide.bg}`
              )}
            >
              hide
            </button>
            <button
              onClick={() => st.updStep(step.id, { action: 'highlight' })}
              style={s(
                `font:500 12px/1 var(--mono);padding:8px 13px;color:${fm.highlight.fg};background:${fm.highlight.bg}`
              )}
            >
              highlight
            </button>
          </div>
          <div
            style={s('display:flex;align-items:center;justify-content:space-between;gap:10px')}
          >
            <span style={s('font:400 11.5px/1.4 var(--mono);color:var(--faint)')}>
              {matched} of {total} match
            </span>
            <button
              onClick={() => st.updStep(step.id, { on: !step.on })}
              style={s(
                `font:500 12px/1 var(--mono);padding:8px 13px;border:1px solid ${ft.line};border-radius:999px;color:${ft.fg};background:${ft.bg}`
              )}
            >
              {ft.label}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
