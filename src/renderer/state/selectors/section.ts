/**
 * The Section card's derived values — `SGVue.dc.html:1875` (`chip`), `:1922` (`secSummary`)
 * and `:1994–1996`, as pure functions.
 *
 * The one thing worth stating: a chip **offers every grid the federation has**, at any angle.
 * The design's card lists `m.grids` unconditionally, and the renderer can now cut along a
 * segment (`shared/annotate.ts`), so a 43° grid gets its own chip like any other.
 *
 * 2026-10-01 (owner-requested): the gridline cut and the level cut are **two planes**, so every
 * function here takes the one plane it is about — the design's chip, summary and patch rules,
 * once per plane — and the gridline chips come **grouped by the grid's own IFC family** (`u`,
 * `v`, `w`), which the card draws as one chip row a family with a rule between them.
 */
import type { Federation } from '../../../shared/federate'
import { FOOT, ftIn, MINUS, THIN_SPACE } from '../../../shared/fmt'
import { LEVEL_DEFAULT_OFFSET_MM, type SecKind, type SecPlane } from '../../../shared/sections'
import type { DisplayUnit } from '../../../shared/units'

export interface SectionChip {
  name: string
  /** This chip is its plane's live section. */
  on: boolean
  line: string
  bg: string
  fg: string
}

/** `SGVue.dc.html:1875`. */
function chip(name: string, on: boolean): SectionChip {
  return {
    name,
    on,
    line: on ? 'var(--accent)' : 'var(--border)',
    bg: on ? 'var(--sel-bg)' : 'transparent',
    fg: on ? 'var(--sel-ink)' : 'var(--muted)'
  }
}

/** The design's default offset for a level cut (`:1875`), re-exported from the shared shapes. */
export { LEVEL_DEFAULT_OFFSET_MM }

/**
 * The gridline chips, one list per grid family, in the federation's own order — which is
 * family-first (`shared/federate.ts` `orderGrids`), so consecutive grids of one family are one
 * group: `A…E`, then `1…10`. One family is one group, and no grids is none.
 */
export function sectionGridFamilies(m: Federation, plane: SecPlane): SectionChip[][] {
  const groups: SectionChip[][] = []
  let family: string | undefined
  for (const g of m.grids) {
    if (!groups.length || g.family !== family) groups.push([])
    family = g.family
    groups[groups.length - 1].push(chip(g.name, plane.name === g.name))
  }
  return groups
}

export const sectionLevelChips = (m: Federation, plane: SecPlane): SectionChip[] =>
  m.storeys.map((st) => chip(st.name, plane.name === st.name))

/** `SGVue.dc.html:1922`, for one plane. */
export function secSummary(kind: SecKind, plane: SecPlane): string {
  if (!plane.name) return 'no section'
  return (
    `${kind === 'grid' ? 'grid' : 'level'} ${plane.name}` +
    (plane.cut ? ' · cut' : ' · plane only') +
    (plane.flip ? ' · flipped' : '')
  )
}

/** `SGVue.dc.html:1996`. */
export const secCutStyle = (cut: boolean): { bg: string; fg: string; line: string } =>
  cut
    ? { bg: 'var(--sel-bg)', fg: 'var(--sel-ink)', line: 'var(--accent)' }
    : { bg: 'transparent', fg: 'var(--muted)', line: 'var(--border)' }

/**
 * What setting a plane writes (`:1875`): that name, **cutting**, at the design's default offset
 * for its kind — on the gridline, or 1 200 mm above the storey. `flip` is not in it, so a chip
 * keeps the side the plane had. The assistant's `set_section` starts from this same patch
 * (2026-10-01, the owner: an assistant-made section does what the user's click does).
 */
export const planePatch = (name: string, kind: SecKind): Pick<SecPlane, 'name' | 'offset' | 'cut'> => ({
  name,
  offset: kind === 'level' ? LEVEL_DEFAULT_OFFSET_MM : 0,
  cut: true
})

/**
 * The patch a chip's own click writes to **its** plane (`:1875`): the live chip clears the
 * plane — the name only, as the design's `{ kind: null, name: '' }` does — and any other sets
 * it cutting at the design's default offset, keeping `flip` (`planePatch`).
 */
export const chipPatch = (name: string, kind: SecKind, plane: SecPlane): Partial<SecPlane> =>
  plane.name === name ? { name: '' } : planePatch(name, kind)

/* ─────────────────── the offset field in the display unit (2026-10-09) ─────────────────── */

/**
 * The offset is **millimetres**, as the design keeps it, whatever the field shows: a plane, a
 * session, a viewpoint and the assistant's `set_section` all carry millimetres, and the level
 * cut's default is still 1 200 mm. Since 2026-10-09 (owner-requested) the field and its two
 * nudge buttons speak the display unit:
 *
 *  · `mm` — the design's own field and its ±500, unchanged;
 *  · `m` — metres, nudged by 0.5 m (the same 500 mm);
 *  · `ft` — feet and inches at rest (`3'-11 1/4"` for the level cut's 1 200 mm), as its nudges
 *    are written, nudged by 2'-0" (609.6 mm); typed, either feet and inches (`12'-6"`) or decimal
 *    feet (`12.5`).
 */
export const OFFSET_STEP_MM: Readonly<Record<DisplayUnit, number>> = { mm: 500, m: 500, ft: 2 * FOOT * 1000 }

/** Millimetres to a thousandth: what a foot or a metre typed in, times 1 000, settles to. */
const mm3 = (v: number): number => Math.round(v * 1000) / 1000

/** The field's text for an offset in millimetres: `1200` · `1.2` · `3'-11 1/4"`. */
export function offsetText(mm: number, unit: DisplayUnit): string {
  if (unit === 'mm') return String(mm)
  if (unit === 'ft') return ftIn(mm / 1000)
  return String(Number((mm / 1000).toFixed(3)))
}

/**
 * Decimal feet — `12.5`, `-3` — or feet and inches — `12'-6"`, `12' 6 1/2"`, `0'-3/4"`, `6"`,
 * `−3'-6"` — to feet; `NaN` for anything else, such as a reading still being typed.
 */
export function parseFeet(text: string): number {
  const t = text
    .trim()
    .replace(new RegExp(`[${MINUS}–]`, 'g'), '-')
    // `ftIn` groups the feet with a thin space (`1 000'-0"`), so one between a digit and three
    // more is no separator; any other thin space is read as the space it is (`6 1/2"`).
    .replace(new RegExp(`(\\d)${THIN_SPACE}(?=\\d{3}(?!\\d))`, 'g'), '$1')
  if (!/['"]/.test(t)) return t ? Number(t) : NaN
  const m = /^([+-])?\s*(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:(?:(\d+(?:\.\d+)?)(?:[\s-]+(\d+)\/(\d+))?|(\d+)\/(\d+))\s*"?)?$/.exec(t)
  if (!m || (m[2] == null && m[3] == null && m[6] == null)) return NaN
  // A fraction over zero is no number at all.
  const frac = (n?: string, d?: string): number => (n != null && d != null ? Number(n) / Number(d) : 0)
  const inches = Number(m[3] ?? 0) + frac(m[4], m[5]) + frac(m[6], m[7])
  const feet = Number(m[2] ?? 0) + inches / 12
  if (!Number.isFinite(feet)) return NaN
  return m[1] === '-' ? -feet : feet
}

/**
 * The offset a typed text stands for, in millimetres. In `mm` the design's own rule — what
 * does not parse is `0`; in `m` and `ft` it is `null`, and the plane stays where it is while a
 * reading is still being typed (`1.`, `12'-6 1/`).
 */
export function parseOffset(text: string, unit: DisplayUnit): number | null {
  if (unit === 'mm') {
    const n = parseFloat(text)
    return isNaN(n) ? 0 : n
  }
  const v = unit === 'ft' ? parseFeet(text) * FOOT * 1000 : Number(text.trim() === '' ? NaN : text) * 1000
  return Number.isFinite(v) ? mm3(v) : null
}

/** One click of `−` (`-1`) or `+` (`1`): the design's ±500 mm, or ±2'-0" in `ft`. */
export const nudgeOffset = (mm: number, sign: 1 | -1, unit: DisplayUnit): number =>
  unit === 'ft' ? mm3(mm + sign * OFFSET_STEP_MM.ft) : mm + sign * OFFSET_STEP_MM[unit]

/** The nudge buttons' text and title: `−500` / `−500 mm`, `−0.5` / `−0.5 m`, `−2'-0"` twice. */
export function nudgeLabel(sign: 1 | -1, unit: DisplayUnit): { text: string; title: string } {
  const s = sign < 0 ? MINUS : '+'
  if (unit === 'ft') return { text: `${s}2'-0"`, title: `${s}2'-0"` }
  const n = unit === 'm' ? '0.5' : '500'
  return { text: s + n, title: `${s}${n} ${unit}` }
}
