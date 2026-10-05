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
 *
 * `f3` and `fixed3` are **not** the same function: the coordinate readout groups thousands
 * with a thin space, the measure rows do not. Keeping both is fidelity, not duplication.
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
