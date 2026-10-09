/**
 * The Markups card's rows — `SGVue.dc.html:2060–2070`, as pure functions.
 *
 * Numbering is positional (`M1`, `M2`, `C1`…), exactly as the design numbers it: delete `M1`
 * and what was `M2` becomes `M1`, because the label is the row's index and not the record's id.
 *
 * The one place the port cannot be literal is a spot with no base point behind it: the
 * prototype always has one (its own literal origin), so it always prints three numbers. Here a
 * file that states no georeferencing leaves E / N / Z absent — and since 2026-10-08 nothing can be
 * typed into the Coordinate-system card to stand for one — and an absent value is the design's
 * own em dash.
 */
import { laserSideLengths, type LaserSides } from '../../../shared/annotate'
import { DASH, fixed3 } from '../../../shared/fmt'
import { coordIn, lengthNumber, lengthSuffix } from '../../../shared/units'
import type { MeasureRecord, SpotRecord } from '../../viewer/annotations'
import type { Units } from '../shell'

export interface MarkupRow {
  /** `M1` / `C1` — the row's position, one-based. */
  n: string
  /** The reading, formatted for the current unit. */
  v: string
  /**
   * 2026-10-08 — a laser row's readings, one an axis, when one of them reads two sides: `v` is
   * them joined as the design joins them, and the card breaks the row between them, never inside
   * one, when they do not fit. Absent on any other row, which the card draws as the design does.
   */
  axes?: readonly string[]
  /** The record's own id, for `dropMeasure` / `dropSpot`. */
  id: number
  /** The scene point, for `focusPoint`. */
  p: readonly number[]
}

const AXES = ['x', 'y', 'z'] as const

/**
 * One axis of a row. Since 2026-10-08 (owner-requested) its two sides of the point, − side
 * first, joined by ` + ` — `1 200 + 2 300 mm` — or the one side that reached a face, which reads
 * exactly as the design's whole-ray number did (`2 300 mm`). The unit once, after the numbers —
 * and since 2026-10-09 none in `ft`, whose feet and inches say their own (`7'-6" + 2'-0"`).
 */
const axisReading = (s: LaserSides, units: Units): string =>
  laserSideLengths(s)
    .map((v) => lengthNumber(v, units))
    .join(' + ') + lengthSuffix(units)

/** `SGVue.dc.html:2061–2065`. Three spaces between the axis readings, as the design joins them. */
export function measureRows(
  measures: readonly MeasureRecord[],
  units: Units
): MarkupRow[] {
  return measures.map((m, i) => {
    const axes = AXES.flatMap((a) => {
      const s = m.sides[a]
      return s ? [a.toUpperCase() + ' ' + axisReading(s, units)] : []
    })
    // Only a row that reads two sides somewhere needs to wrap; any other is the design's text in
    // the design's own span, byte for byte.
    const split = AXES.some((a) => m.sides[a]?.minus != null && m.sides[a]?.plus != null)
    return { n: 'M' + (i + 1), id: m.id, p: m.p, v: axes.join('   '), ...(split ? { axes } : {}) }
  })
}

/**
 * `SGVue.dc.html:2066–2069`. Coordinates, so since 2026-10-09 metres in `mm` and `m`, as they
 * always printed, and decimal feet in `ft` (`shared/units.ts`).
 */
export function spotRows(spots: readonly SpotRecord[], units: Units = 'mm'): MarkupRow[] {
  const n = (v: number | null): string => (v == null ? DASH : fixed3(coordIn(v, units)))
  return spots.map((s, i) => ({
    n: 'C' + (i + 1),
    id: s.id,
    p: s.p,
    v: `${n(s.E)} E · ${n(s.N)} N · ${n(s.Z)} Z`
  }))
}

/** `SGVue.dc.html:2070`. */
export const noMarks = (
  measures: readonly MeasureRecord[],
  spots: readonly SpotRecord[]
): boolean => measures.length === 0 && spots.length === 0
