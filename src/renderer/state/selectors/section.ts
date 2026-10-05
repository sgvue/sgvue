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
import { LEVEL_DEFAULT_OFFSET_MM, type SecKind, type SecPlane } from '../../../shared/sections'

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
