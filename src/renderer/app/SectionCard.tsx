/**
 * The Section card — `SGVue.dc.html:582–603`, ported element for element, and since 2026-10-01
 * laid out for **two planes** (owner-requested: *"add the section cut along gridline as another
 * cut also? same, i need offset, cut / flip, clear … add a clear all somewhere … add divider on
 * the gridlines under section panel for along x or y side"*).
 *
 * A left-lane card, z-order 14, 300 px wide. The design has one plane, so one offset row and one
 * summary row under both chip lists; here each of the two blocks — "Along a gridline" and "At a
 * level" — carries its **own** copy of those two rows, the design's markup and style strings
 * once per plane, and a plane's controls act on that plane alone. With no plane chosen in a
 * block its controls stay and behave as the design's do with no section. What is new on the
 * card: `Clear all` in the header (the `Clear` button's own style string), a 1 px
 * `var(--border)` rule between two grid families' chip rows, and a `max-height` with
 * `overflow:auto`, the Markups card's, because the card is taller now.
 *
 * **The summary row is the one place the design's two rows were re-arranged.** The design puts
 * the summary and `cut` · `flip side` · `Clear` on one line, where the three buttons leave the
 * summary about 75 px of the 300 px card — it reads `offset mm …`, the plane's name clipped
 * away. With two planes that line is the only place a plane's name, `cut` and `flipped` are
 * read at all, so here the summary has a line of its own — its own style string, so it still
 * ellipsises if it ever overflows, and a native `title` with its whole text — and the three
 * buttons follow in a row of their own, right-aligned, in their own style strings and order.
 *
 * The offset field is **millimetres**, as the design has it, and the division by 1000 happens
 * once, on the way to the viewer (`state/shell.ts`'s `sectionConfigOf`).
 *
 * Every grid the federation has gets a chip, at any angle: `section.ts` cuts along a segment,
 * so a 43° grid is sectioned like an axis-aligned one. The chips are grouped by the grid's own
 * IFC family — `A…E`, then `1…10` — one wrapping row a family.
 */
import { Fragment } from 'react'
import { NO_PLANE, type SecKind, type SecPlane } from '../../shared/sections'
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import {
  chipPatch,
  secCutStyle,
  secSummary,
  sectionGridFamilies,
  sectionLevelChips,
  type SectionChip
} from '../state/selectors/section'
import { s } from './css'
import { Cross } from './icons'

const CHIP =
  'font:500 12px/1 var(--mono);padding:7px 10px;border:1px solid %line%;border-radius:6px;color:%fg%;background:%bg%'
/** `:585`, `:587` — one block: its label, then its rows. */
const BLOCK = 'display:flex;flex-direction:column;gap:6px'
const LABEL = 'font-size:12px;color:var(--muted)'
const CHIPS = 'display:flex;flex-wrap:wrap;gap:5px'
/** `:590`, `:592` — the ±500 buttons. */
const NUDGE =
  'font:500 12px/1 var(--mono);padding:8px 10px;border:1px solid var(--border);border-radius:8px;color:var(--muted)'
/** `:599` — the design's `Clear`, and `Clear all` beside the ×. */
const CLEAR =
  'font:500 12px/1 var(--sans);color:var(--accent-ink);padding:7px 4px;white-space:nowrap;flex:none'
/** `:595` — the summary's own style string, unchanged: it ellipsises if it ever overflows. */
const SUMMARY =
  'font:400 11.5px/1.4 var(--mono);color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick('card', 'cardTop', 'clearSections', 'closeCard', 'federation', 'sections', 'setSec')

export default function SectionCard(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  if (st.card !== 'section') return null
  const { grid, level } = st.sections
  const families = sectionGridFamilies(st.federation, grid)
  const levels = sectionLevelChips(st.federation, level)

  const chips = (list: SectionChip[], kind: SecKind, plane: SecPlane): React.JSX.Element[] =>
    list.map((c) => (
      <button
        key={c.name}
        onClick={() => st.setSec(kind, chipPatch(c.name, kind, plane))}
        className="hv-accent-line"
        style={s(CHIP.replace('%line%', c.line).replace('%fg%', c.fg).replace('%bg%', c.bg))}
      >
        {c.name}
      </button>
    ))

  /**
   * One plane's controls: the design's offset row (`:589–593`), then its summary row
   * (`:594–601`) as two — the summary on a line of its own, and its three buttons after it.
   */
  const controls = (kind: SecKind, plane: SecPlane): React.JSX.Element => {
    const cut = secCutStyle(plane.cut)
    const summary = `offset mm · ${secSummary(kind, plane)}`
    return (
      <>
        <div
          style={s(
            'display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px;align-items:center'
          )}
        >
          <button
            onClick={() => st.setSec(kind, { offset: plane.offset - 500 })}
            title="−500 mm"
            className="hv-step-ink"
            style={s(NUDGE)}
          >
            −500
          </button>
          <input
            value={String(plane.offset)}
            onChange={(e) => {
              const n = parseFloat(e.target.value)
              st.setSec(kind, { offset: isNaN(n) ? 0 : n })
            }}
            inputMode="numeric"
            className="fv-field"
            style={s(
              'width:100%;text-align:right;font:400 13px/1.4 var(--mono);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:6px 10px'
            )}
          />
          <button
            onClick={() => st.setSec(kind, { offset: plane.offset + 500 })}
            title="+500 mm"
            className="hv-step-ink"
            style={s(NUDGE)}
          >
            +500
          </button>
        </div>

        <span title={summary} style={s(SUMMARY)}>
          {summary}
        </span>

        <div style={s('display:flex;justify-content:flex-end;gap:6px')}>
          <button
            onClick={() => st.setSec(kind, { cut: !plane.cut })}
            title="Cut the model at this plane (off: plane shown only)"
            className="hv-accent-line"
            style={s(
              `font:500 12px/1 var(--mono);padding:7px 11px;border:1px solid ${cut.line};border-radius:999px;color:${cut.fg};background:${cut.bg};white-space:nowrap;flex:none`
            )}
          >
            cut
          </button>
          <button
            onClick={() => st.setSec(kind, { flip: !plane.flip })}
            className="hv-step-ink"
            style={s(
              'font:500 12px/1 var(--mono);padding:7px 11px;border:1px solid var(--border);border-radius:999px;color:var(--muted);white-space:nowrap;flex:none'
            )}
          >
            flip side
          </button>
          <button onClick={() => st.setSec(kind, NO_PLANE)} style={s(CLEAR)}>
            Clear
          </button>
        </div>
      </>
    )
  }

  return (
    <div
      style={s(
        `position:absolute;z-index:14;top:${st.cardTop}px;left:12px;width:300px;max-width:calc(100% - 24px - var(--rlane, 0px));max-height:calc(100% - 110px - var(--abar, 0px));overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out`
      )}
    >
      <div style={s('display:flex;align-items:center;justify-content:space-between')}>
        <span
          style={s(
            'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
          )}
        >
          Section
        </span>
        <div style={s('display:flex;align-items:center;gap:6px;flex:none')}>
          <button onClick={st.clearSections} style={s(CLEAR)}>
            Clear all
          </button>
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
      </div>

      <div role="group" aria-label="Along a gridline" style={s(BLOCK)}>
        <span style={s(LABEL)}>Along a gridline</span>
        {families.map((family, i) => (
          <Fragment key={family[0].name}>
            {i > 0 && (
              <span
                aria-hidden="true"
                style={s('flex:none;height:1px;background:var(--border)')}
              />
            )}
            <div style={s(CHIPS)}>{chips(family, 'grid', grid)}</div>
          </Fragment>
        ))}
        {controls('grid', grid)}
      </div>

      <div role="group" aria-label="At a level" style={s(BLOCK)}>
        <span style={s(LABEL)}>At a level</span>
        <div style={s(CHIPS)}>{chips(levels, 'level', level)}</div>
        {controls('level', level)}
      </div>
    </div>
  )
}
