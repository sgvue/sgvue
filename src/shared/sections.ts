/**
 * The two section planes, as the view state holds them — 2026-10-01, owner-requested: *"add the
 * section cut along gridline as another cut also"*, and of the options offered, **"Two: gridline
 * + level"**. The design has one plane (`SGVue.dc.html:848`,
 * `section: { kind, name, offset, flip, cut }`), so a level chip replaced a gridline cut and the
 * other way round. Here the gridline cut and the level cut are two planes that can be on at the
 * same time, each with its own offset, cut, flip side and Clear.
 *
 * Pure and shared: the store (`renderer/state/shell.ts`), the session codec, the viewpoint
 * record and the assistant's view state all read these shapes, and all print a section through
 * the one `sectionsLabel`.
 */

/** Which of the two planes: the cut along a gridline, or the cut at a level. */
export type SecKind = 'grid' | 'level'

/**
 * One plane. `name: ''` is "no plane" — a grid's `AxisTag` or a storey's name otherwise; a name
 * the live federation does not have simply draws nothing. `offset` is **millimetres**, as the
 * Section card has it (`state/shell.ts` `sectionConfigOf` is the one place it becomes metres).
 * `cut: false` shows the plane as a translucent sheet without cutting.
 */
export interface SecPlane {
  name: string
  offset: number
  flip: boolean
  cut: boolean
}

export interface Sections {
  grid: SecPlane
  level: SecPlane
}

/**
 * The design's default offset for a level cut: 1 200 mm above the slab (`SGVue.dc.html:1875`).
 * A gridline cut's default is 0, on the gridline itself. Here rather than in the renderer
 * because the assistant's tool description states it too (`tool-schemas.ts`).
 */
export const LEVEL_DEFAULT_OFFSET_MM = 1200

/** A plane's cleared state: what its own `Clear` writes. */
export const NO_PLANE: SecPlane = Object.freeze({ name: '', offset: 0, flip: false, cut: false })

/** Both planes cleared: the first state, and what `Clear all` writes. */
export const NO_SECTIONS: Sections = Object.freeze({ grid: NO_PLANE, level: NO_PLANE })

/**
 * The section as one string, wherever it is printed — a viewpoint's sub-line, the assistant's
 * view state and `set_section`'s result: `grid C`, `level L2`, `grid C + level L2`, or `null`
 * when neither plane is set. With one plane it is the design's own `${kind} ${name}`
 * (`SGVue.dc.html:1725`, `:1239`).
 */
export function sectionsLabel(s: {
  grid: { name: string }
  level: { name: string }
}): string | null {
  const parts: string[] = []
  if (s.grid.name) parts.push(`grid ${s.grid.name}`)
  if (s.level.name) parts.push(`level ${s.level.name}`)
  return parts.length ? parts.join(' + ') : null
}
