/**
 * Number formatting — ONE implementation of what the design spells out five times.
 *
 * The prototype inlined the same `toLocaleString('en-US').replace(/,/g,' ')` in five
 * places (plan §3.5 defect 4). Every variant below is reproduced exactly, including which
 * space character sits before `mm`, because the two differ between call sites and both are
 * visible in the design.
 *
 * Source lines, and who calls which:
 *
 * | Function     | Design source                          | Callers in the port                          |
 * |--------------|----------------------------------------|----------------------------------------------|
 * | `thin`       | (the shared inner expression)          | every function below                         |
 * | `fmtV`       | `SGVue.dc.html:1835`                   | property-card pset/qto rows                  |
 * | `mmv`        | `SGVue.dc.html:1838`                   | property-card geometry rows (bbox, base/top) |
 * | `signedMm`   | `SGVue.dc.html:1790`, `viewer-core:219`| sidebar storey list, 3D level tags           |
 * | `fmtMM`      | `viewer-core.js:9`                     | viewer-core labels (plain space before mm)   |
 * | `mmTxt`      | `viewer-core.js:435`                   | selection dimension labels (thin space)      |
 * | `mmPlain`    | `viewer-core.js:617`                   | live measure label (number only, unit split) |
 * | `f3`         | `viewer-core.js:410`                   | spot coordinate readout E/N/Z                |
 * | `signedF3`   | (2026-09-28, owner-requested)          | the spot tag's collapsed level               |
 * | `fixed3`     | `SGVue.dc.html:2063`, geometry rows    | measure rows in metres, footprint/volume     |
 * | `ftIn`       | (2026-10-09, owner-requested)          | every length, in the `ft` display unit       |
 * | `signedFtIn` | (2026-10-09, owner-requested)          | storey elevations and level tags, in `ft`    |
 *
 * `f3` and `fixed3` are **not** the same function: the coordinate readout groups thousands
 * with a thin space, the measure rows do not. Keeping both is fidelity, not duplication.
 *
 * Which of these a readout uses for the display unit it is in — `mm`, `m` or `ft` — is
 * `shared/units.ts`'s to say; this file only spells numbers.
 */

/** U+2009 THIN SPACE — the design's thousands separator. */
export const THIN_SPACE = ' '
/** U+2212 MINUS SIGN — used for signed elevations, not the ASCII hyphen. */
export const MINUS = '−'
/**
 * U+2014 EM DASH — what every readout shows for a value the file does not carry
 * (`SGVue.dc.html:1749`'s own `p.site || '—'`). Re-exported by
 * `state/selectors/spatial.ts`, which is where the port first needed it.
 */
export const DASH = '—'

/** `1234567` → `1 234 567`, grouped with thin spaces. */
export const thin = (v: number): string =>
  v.toLocaleString('en-US').replace(/,/g, THIN_SPACE)

/** Property-card value: booleans as True/False, numbers grouped, anything else as-is. */
export const fmtV = (v: unknown): string =>
  typeof v === 'boolean' ? (v ? 'True' : 'False') : typeof v === 'number' ? thin(v) : String(v)

/** Metres → `"2 400 mm"` (plain space). Property-card geometry rows. */
export const mmv = (metres: number): string => thin(Math.round(metres * 1000)) + ' mm'

/** Metres → `"2 400 mm"` with a plain space. `viewer-core.js`'s label formatter. */
export const fmtMM = mmv

/** Metres → `"2 400 mm"` with a THIN space before the unit. Dimension labels only. */
export const mmTxt = (metres: number): string =>
  thin(Math.round(metres * 1000)) + THIN_SPACE + 'mm'

/** Metres → `"2 400"`, no unit. The live measure label prints the unit separately. */
export const mmPlain = (metres: number): string => thin(Math.round(metres * 1000))

/** Metres → `"+4 000"` / `"−1 000"` with U+2212. Storey elevations, level tags. */
export const signedMm = (metres: number): string => {
  const mm = Math.round(metres * 1000)
  return (mm >= 0 ? '+' : MINUS) + thin(Math.abs(mm))
}

/** `28 500.000` — three decimals, thin-space grouping. Coordinate readouts. */
export const f3 = (v: number): string =>
  v
    .toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    .replace(/,/g, THIN_SPACE)

/**
 * `+10.500` / `−1.200` — `f3` with an explicit sign, U+2212 for a negative, as `signedMm` has.
 * The spot tag's collapsed level (2026-09-28). A value that rounds to zero reads `+0.000`.
 */
export const signedF3 = (v: number): string => {
  const s = f3(Math.abs(v))
  return (v < 0 && s !== '0.000' ? MINUS : '+') + s
}

/* ────────────────────── feet and inches (2026-10-09, owner-requested) ────────────────────── */

/**
 * The international foot, in metres — what the `ft` display unit is written in. The US survey
 * foot is `US_SURVEY_FOOT` in `units.ts`.
 */
export const FOOT = 0.3048

/** Sixteenths of an inch in a foot: what feet and inches are rounded in. */
const SIXTEENTHS_PER_FOOT = 12 * 16

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/** `n` sixteenths of an inch, `n ≥ 0`, as `12'-6 1/2"`. */
function feetInches(n: number): string {
  const feet = Math.floor(n / SIXTEENTHS_PER_FOOT)
  const rest = n - feet * SIXTEENTHS_PER_FOOT
  const inches = Math.floor(rest / 16)
  const sixteenths = rest - inches * 16
  const g = gcd(sixteenths, 16)
  const fraction = sixteenths ? `${sixteenths / g}/${16 / g}` : ''
  const inch = !fraction ? String(inches) : inches ? `${inches} ${fraction}` : fraction
  return `${thin(feet)}'-${inch}"`
}

/** Metres → whole sixteenths of an inch, rounded to the nearest one. */
const toSixteenths = (metres: number): number => Math.round((Math.abs(metres) / FOOT) * SIXTEENTHS_PER_FOOT)

/**
 * Metres → feet and inches to the nearest sixteenth of an inch: `12'-6 1/2"`, `0'-3/4"`, `5'-0"`.
 * The feet are thin-space grouped, as every other number here is (`1 234'-5"`); the fraction is
 * reduced (`8/16` → `1/2`); 11 15/16" that rounds up carries into the next foot (`1'-0"`). A
 * negative reads with U+2212, the minus sign the signed readouts already use, because the
 * hyphen is the separator here; a value that rounds to zero has no sign.
 */
export function ftIn(metres: number): string {
  const n = toSixteenths(metres)
  return (metres < 0 && n > 0 ? MINUS : '') + feetInches(n)
}

/** `ftIn` with an explicit sign, as `signedMm` has: `+10'-6"`, `−3'-0"`, and `+0'-0"` for zero. */
export function signedFtIn(metres: number): string {
  const n = toSixteenths(metres)
  return (metres < 0 && n > 0 ? MINUS : '+') + feetInches(n)
}

/** `2.400` — three decimals, no grouping. Measure rows in metres, box volume. */
export const fixed3 = (v: number): string => v.toFixed(3)

/** `5.76` — two decimals, no grouping. Footprint area. */
export const fixed2 = (v: number): string => v.toFixed(2)

/**
 * `1,234` — **comma**-grouped, not thin-spaced. The Spatial-structure card's element counts
 * (`SGVue.dc.html:1760`, `:1778`) are the one place the design leaves the commas in.
 */
export const group = (v: number): string => v.toLocaleString('en-US')

/**
 * `28,500.000` — comma-grouped, three decimals. The Spatial-structure card's own `f3`
 * (`SGVue.dc.html:1749`), which is *not* `f3` above: that one groups with thin spaces.
 */
export const group3 = (v: number): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

/* ────────────────────────────── text, not numbers ────────────────────────────── */

/** Control characters, and Unicode's invisible direction and width marks. */
const UNSEEN = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/gu

/**
 * A name as a pending label, or the result of a request, may carry it (2026-10-02, the gate's
 * review): control characters and the invisible direction and width marks are taken out, and it
 * is clipped at `max` characters. **Every name that goes into a label or a request's result
 * comes through here** — and since 2026-10-08 every model name the Coordinate-system card's note
 * prints, which is why it lives here and not in `renderer/ai/executors/context.ts`, which
 * re-exports it.
 *
 * A viewpoint's or a filter set's name is whatever was typed, and a file's is whatever the disk
 * has. A label is what the user reads before they click Apply: a newline in a name would break
 * the row in two, and a right-to-left override would show its text in another order — either
 * could make the row read as something it is not.
 */
export const labelText = (text: string, max: number): string => {
  const clean = text.replace(UNSEEN, '')
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}
