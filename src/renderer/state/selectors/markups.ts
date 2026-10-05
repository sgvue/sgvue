/**
 * The Markups card's rows — `SGVue.dc.html:2060–2070`, as pure functions.
 *
 * Numbering is positional (`M1`, `M2`, `C1`…), exactly as the design numbers it: delete `M1`
 * and what was `M2` becomes `M1`, because the label is the row's index and not the record's id.
 *
 * The one place the port cannot be literal is a spot with no base point behind it: the
 * prototype always has one (its own literal origin), so it always prints three numbers. Here a
 * file that states no georeferencing and a session with nothing typed into the Coordinate-system
 * card leaves E / N / Z absent, and an absent value is the design's own em dash.
 */
import { DASH, fixed3, mmv } from '../../../shared/fmt'
import type { MeasureRecord, SpotRecord } from '../../viewer/annotations'
import type { Units } from '../shell'

export interface MarkupRow {
  /** `M1` / `C1` — the row's position, one-based. */
  n: string
  /** The reading, formatted for the current unit. */
  v: string
  /** The record's own id, for `dropMeasure` / `dropSpot`. */
  id: number
  /** The scene point, for `focusPoint`. */
  p: readonly number[]
}

const AXES = ['x', 'y', 'z'] as const

/** `SGVue.dc.html:2061–2065`. Three spaces between the axis readings, as the design joins them. */
export function measureRows(
  measures: readonly MeasureRecord[],
  units: Units
): MarkupRow[] {
  return measures.map((m, i) => ({
    n: 'M' + (i + 1),
    id: m.id,
    p: m.p,
    v: AXES.filter((a) => m[a] != null)
      .map((a) => {
        const v = m[a] as number
        return a.toUpperCase() + ' ' + (units === 'm' ? fixed3(v) + ' m' : mmv(v))
      })
      .join('   ')
  }))
}

/** `SGVue.dc.html:2066–2069`. */
export function spotRows(spots: readonly SpotRecord[]): MarkupRow[] {
  const n = (v: number | null): string => (v == null ? DASH : fixed3(v))
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
