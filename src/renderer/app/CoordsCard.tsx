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
 *   (`shared/georef.ts`). Since 2026-10-08 they are the **boot model's**: the federation is
 *   placed in that model's frame expressed in map coordinates, so its base point is the one that
 *   holds for every model (`federation-store.ts`).
 * · **The CRS chip.** The design writes `SVY21 · EPSG:3414`, which is true of its own Singapore
 *   subject and a placeholder for any other file, so it names the file's declared
 *   `IfcProjectedCRS` and shows the em dash when there is none. `SVY21 · EPSG:3414` is exactly
 *   what it reads for an SVY21 file — the reference model included.
 *
 * · **The caption.** `project base point` is the design's, verbatim, and it gains ` · ` plus
 *   the detected georeferencing method — the one visible addition in the whole port, asked for
 *   by the user on 2026-09-20 ("auto detect which way the model is using and show it") and
 *   recorded in CLAUDE.md's allowed deviations. Same element, same span, same style; nothing
 *   is appended when the file has no georeferencing.
 *
 * Two allowed deviations of 2026-10-08, both the owner's:
 *
 * · **The card is read-only** — *"Maybe just make the coordinates system toggle a read only,
 *   dont let user change anything."* Each field keeps its element, class and style string and is
 *   `readOnly`: it still takes focus and a selection, so a value can be copied, and nothing typed
 *   reaches it. The store has no action that changes the base point (`state/shell.ts`).
 * · **A one-line note under the caption row** when a loaded model could not be lined up — of the
 *   ways offered, *"One-line note on screen"*. Only while there is something to say; the caption
 *   span's own style string, held to one line with an ellipsis, and the whole text as its native
 *   `title` (the 2026-10-01 rule for clipped text). Model names are file text, so they come
 *   through `labelText` (`selectors/status.ts`, `notLinedUp`).
 *
 * The chip, the caption and the note are read off the store's `bootGeoref` — the declaration
 * that defined the federation's frame — so they describe the frame in use after any unload.
 *
 * **The fields' unit** (2026-10-09, owner-requested): the file's own map unit
 * (`shared/georef.ts`, `mapUnitOf`) — `Easting m` as the design has it for a metre CRS or a file
 * that names none, `Easting ft` for the foot, `Easting US ft` for the US survey foot, each value as
 * the file authored it. Not the display toggle: this card says what the file states.
 *
 * Everything else — the copy, the labels, the grid, the closing paragraph — is verbatim.
 */
import { pick, useShell } from '../state/shell'
import { useShallow } from 'zustand/react/shallow'
import { coordsFromGeoref, crsChip, mapUnitOf } from '../../shared/georef'
import type { CoordState } from '../state/shell'
import { s } from './css'
import { coordsCaption, lineUpNote, notLinedUp } from '../state/selectors/status'
import { Cross } from './icons'

const LABEL =
  'font:600 11px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)'
const FIELD =
  'font:400 13px/1.4 var(--mono);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:6px 10px;width:100%'
/** The design's caption span (`:690`), untouched — the note below the row takes it too. */
const CAPTION = 'font-size:12px;color:var(--muted)'

/** The store fields this component reads — it re-renders when one of them changes. */
const KEYS = pick('card', 'cardTop', 'closeCard', 'coords', 'federation', 'bootGeoref', 'library', 'uploadNames')

export default function CoordsCard(): React.JSX.Element | null {
  const st = useShell(useShallow(KEYS))
  if (st.card !== 'coords') return null
  // The declaration that defined the federation's frame — the boot model's, kept after it is
  // unloaded — whose base point the four fields are (2026-10-08).
  const chip = crsChip(st.bootGeoref).long
  // The one visible addition in the port, the user's own request (2026-09-20): the detected
  // method, appended inside the design's own caption span, in the design's own style.
  const caption = coordsCaption(st.bootGeoref)
  const detected = caption !== ''
  // 2026-10-08, the owner's: which loaded model could not be lined up, in one line.
  const note = lineUpNote(notLinedUp(st))
  // 2026-10-09, owner-requested: the base point in the file's own map unit — not the display
  // toggle. The metre, and a file that names no map unit, read exactly as before; a foot or a US
  // survey foot reads as the file authored it, its unit in the three labels.
  const mapUnit = mapUnitOf(st.bootGeoref)
  const shown: CoordState =
    mapUnit.label === 'm'
      ? st.coords
      : (coordsFromGeoref(st.bootGeoref, mapUnit.metres) ?? { E: null, N: null, Z: null, angle: null })

  const field = (k: keyof CoordState, label: string): React.JSX.Element => (
    <label style={s('display:flex;flex-direction:column;gap:4px')}>
      <span style={s(LABEL)}>{label}</span>
      <input
        value={shown[k] == null ? '' : String(shown[k])}
        readOnly
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
        <span style={s(CAPTION)}>project base point{caption}</span>
      </div>
      {/* 2026-10-08 — the owner's one-line note, only while a loaded model could not be lined up:
          the caption's own style string, one line, the whole text as its title. */}
      {note && (
        <span
          data-role="coords-note"
          title={note}
          style={s(`${CAPTION};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}
        >
          {note}
        </span>
      )}
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
        {field('E', `Easting ${mapUnit.label}`)}
        {field('N', `Northing ${mapUnit.label}`)}
        {field('Z', `Elevation ${mapUnit.label}`)}
        {field('angle', 'True north °')}
      </div>
      <p style={s('margin:0;font-size:12px;line-height:1.5;color:var(--muted)')}>
        Spot coordinates and the TN mark on the cube follow these values. True north is measured
        clockwise from project north.
      </p>
    </div>
  )
}
