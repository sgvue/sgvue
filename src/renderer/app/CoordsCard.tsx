/**
 * The Coordinate-system card — `SGVue.dc.html:687–699`, ported element for element.
 *
 * Two values in it are data, not copy, and the fidelity contract's "never a placeholder" is
 * what decides both:
 *
 * · **The four fields.** The prototype opens with a literal base point
 *   (`{ E: 28500, N: 30200, Z: 102.5, angle: 12.5 }`, `:849`). Here they are the map
 *   coordinates of the **project frame's** origin and the total rotation from project north to
 *   true north — `IfcMapConversion` composed over the spatial-root `IfcSite.ObjectPlacement`,
 *   either of which may be identity — and **left blank** when the file states none
 *   (`shared/georef.ts`). Typing into one sets `coords` and pushes it to the viewer, which is
 *   what moves the TN mark on the cube and re-renders every spot label.
 * · **The CRS chip.** The design writes `SVY21 · EPSG:3414`, which is true of its own Singapore
 *   subject and a placeholder for any other file, so it names the file's declared
 *   `IfcProjectedCRS` and shows the em dash when there is none. `SVY21 · EPSG:3414` is exactly
 *   what it reads for an SVY21 file — the reference model included.
 *
 * · **The caption.** `project base point` is the design's, verbatim, and it gains ` · ` plus
 *   the detected georeferencing method — the one visible addition in the whole port, asked for
 *   by the user on 2026-09-20 ("auto detect which way the model is using and show it") and
 *   recorded in CLAUDE.md's allowed deviations. Same element, same span, same style; nothing
 *   is appended when the file has no georeferencing or when the fields are the user's own.
 *
 * Everything else — the copy, the labels, the grid, the closing paragraph — is verbatim.
 */
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { crsChip } from '../../shared/georef'
import type { CoordState } from '../state/shell'
import { s } from './css'
import { coordsCaption, hasManualCoords } from '../state/selectors/status'
import { Cross } from './icons'

const LABEL =
  'font:600 11px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)'
const FIELD =
  'font:400 13px/1.4 var(--mono);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:6px 10px;width:100%'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick('card', 'cardTop', 'closeCard', 'coords', 'federation', 'setCoord')

export default function CoordsCard(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  if (st.card !== 'coords') return null
  const georef = st.federation.models.find((m) => m.meta.georef.source !== 'none')?.meta.georef
  const chip = crsChip(georef ?? null, hasManualCoords(st.coords, st.federation)).long
  // The one visible addition in the port, the user's own request (2026-09-20): the detected
  // method, appended inside the design's own caption span, in the design's own style.
  const caption = coordsCaption(georef ?? null, st.coords)
  const detected = caption !== ''

  const field = (k: keyof CoordState, label: string): React.JSX.Element => (
    <label style={s('display:flex;flex-direction:column;gap:4px')}>
      <span style={s(LABEL)}>{label}</span>
      <input
        value={st.coords[k] == null ? '' : String(st.coords[k])}
        onChange={(e) => st.setCoord(k, e.target.value)}
        className="fv-field"
        style={s(FIELD)}
      />
    </label>
  )

  return (
    <div
      style={s(
        `position:absolute;z-index:14;top:${st.cardTop}px;left:12px;width:300px;max-width:calc(100% - 24px - var(--rlane, 0px));display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out`
      )}
    >
      <div style={s('display:flex;align-items:center;justify-content:space-between')}>
        <span
          style={s(
            'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
          )}
        >
          Coordinate system
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
      {/* The design's own row. `flex-wrap:wrap` is added only when something is appended, so
          the designed state is byte-identical and the longer caption takes its own line under
          the chip rather than squeezing it — the chip keeps the shape the design gave it. */}
      <div style={s('display:flex;align-items:center;gap:8px' + (detected ? ';flex-wrap:wrap' : ''))}>
        <span
          style={s(
            'font:400 11px/1 var(--mono);border:1px solid var(--border);border-radius:5px;padding:5px 7px;color:var(--muted);background:var(--ground)'
          )}
        >
          {chip}
        </span>
        {/* The design's own span and style string, untouched. */}
        <span style={s('font-size:12px;color:var(--muted)')}>
          project base point{caption}
        </span>
      </div>
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
        {field('E', 'Easting m')}
        {field('N', 'Northing m')}
        {field('Z', 'Elevation m')}
        {field('angle', 'True north °')}
      </div>
      <p style={s('margin:0;font-size:12px;line-height:1.5;color:var(--muted)')}>
        Spot coordinates and the TN mark on the cube follow these values. True north is measured
        clockwise from project north.
      </p>
    </div>
  )
}
