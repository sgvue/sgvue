/**
 * Viewpoints — `SGVue.dc.html:1723` (`saveView`), `:1729` (`restoreView`) and `:1957–1959`
 * (the card's rows), as a record shape and two pure functions.
 *
 * **Plan §3.5 defect 1, fixed here.** The prototype saved `filterOn`, `rules` and `filterMode`
 * — three keys its own state had already stopped carrying when the filter became an ordered
 * stack — so a restored viewpoint silently kept whatever filter was live instead of the one it
 * was saved with. A viewpoint records `stack` (and `active`, the fifth `VIS_KEYS` member) and
 * nothing dead.
 *
 * Everything else is the design's: the auto-name, the three-part subtitle and its `' · '`
 * join, the `|| '3D'` fallback, and the accent edge on the row that was restored last.
 *
 * 2026-10-01 (owner-requested, two section planes): a viewpoint records `sections` — the
 * gridline cut and the level cut — **and** the design's single `section`, exactly as the session
 * payload does (`shared/session-codec.ts`), so a build from before then still restores one
 * plane from a list this build wrote. A viewpoint saved before then has only `section`;
 * `restoreView` reads either through `sectionsOf`. The sub-line names both planes.
 */
import { ID_STRIDE } from '../../../shared/federate'
import { frameKey, type ProjectFrame } from '../../../shared/georef'
import type { FilterStep } from '../../../shared/rules'
import { sectionsLabel, type Sections } from '../../../shared/sections'
import {
  idNumbering,
  legacySection,
  liveHidden,
  type SessionSection
} from '../../../shared/session-codec'
import type { CameraState } from '../../viewer/camera'

/** One saved viewpoint. `id` is the design's `Date.now()`. */
export interface Viewpoint {
  id: number
  name: string
  sub: string
  /** Camera position, target and projection — `CameraState` carries `proj`. */
  cam: CameraState | null
  /** The design's single plane: all an older viewpoint has, and written for older builds. */
  section?: SessionSection
  /** Both planes. Absent in a viewpoint saved before 2026-10-01. */
  sections?: Sections
  hidden: Record<number | string, boolean>
  storeyVis: Record<string, boolean>
  modelVis: Record<string, boolean>
  /** The filter stack, which the prototype lost (plan §3.5 defect 1). */
  stack: readonly FilterStep[]
  /** Activate mode, the fifth `VIS_KEYS` member. */
  active: string | null
  grids: boolean
  levels: boolean
  /**
   * Which project frame `cam` was recorded in (`shared/georef.ts`'s `frameKey`). A camera is
   * scene coordinates, and the scene is the project frame minus the federation offset — so a
   * viewpoint saved against a different boot model, or before the frame existed at all,
   * points somewhere else entirely. Absent means "written before this was recorded", which is
   * treated as a mismatch.
   */
  frame?: string
  /**
   * 2026-10-09 — the stride `hidden`'s ids are numbered by (`shared/federate.ts`'s `ID_STRIDE`).
   * Absent in a viewpoint saved before then, numbered by the design's 1 000 000 (`viewpointHidden`).
   */
  idStride?: number
}

/** What the state a viewpoint is cut from has to offer. */
export interface ViewpointInput {
  views: readonly Viewpoint[]
  sections: Sections
  hidden: Record<number | string, boolean>
  storeyVis: Record<string, boolean>
  modelVis: Record<string, boolean>
  stack: readonly FilterStep[]
  active: string | null
  grids: boolean
  levels: boolean
  view: string | null
  /** The live federation's project frame, which the camera is recorded against. */
  frame?: ProjectFrame | null
}

/**
 * `SGVue.dc.html:1725`. Section, then how much is hidden, then the named view. The section is
 * `grid C`, `level L2`, or — both planes set — `grid C + level L2`.
 */
export function viewSub(s: ViewpointInput): string {
  return (
    [
      sectionsLabel(s.sections),
      Object.keys(s.hidden).length ? `${Object.keys(s.hidden).length} hidden` : null,
      s.view && s.view !== 'iso' ? s.view : null
    ]
      .filter(Boolean)
      .join(' · ') || '3D'
  )
}

/** `SGVue.dc.html:1724–1726`. */
export function viewpointOf(
  s: ViewpointInput,
  cam: CameraState | null,
  now: number = Date.now()
): Viewpoint {
  return {
    id: now,
    name: `Viewpoint ${s.views.length + 1}`,
    sub: viewSub(s),
    cam,
    section: legacySection(s.sections),
    sections: s.sections,
    hidden: s.hidden,
    storeyVis: s.storeyVis,
    modelVis: s.modelVis,
    stack: s.stack,
    active: s.active,
    grids: s.grids,
    levels: s.levels,
    frame: frameKey(s.frame),
    idStride: ID_STRIDE
  }
}

/**
 * The ids a viewpoint hides, numbered for the live federation (2026-10-09). A viewpoint records
 * no files and no slots — it has always been restored onto the slots the models have now — so
 * one saved by this build is restored as it was saved. One saved before then is numbered by the
 * design's 1 000 000, which a model of more than a million lines overran: each of its ids is read
 * on every live slot and kept where that element is really here (`shared/session-codec.ts`,
 * `liveHidden`). A numbering this build does not know hides nothing.
 */
export function viewpointHidden(
  v: Pick<Viewpoint, 'hidden' | 'idStride'>,
  slots: readonly number[],
  exists: (id: number) => boolean
): Record<number | string, boolean> {
  const numbering = idNumbering(v.idStride)
  if (numbering === 'current') return v.hidden ?? {}
  if (!numbering) return {}
  return liveHidden(v.hidden ?? {}, 'legacy', new Map(slots.map((s) => [s, s])), exists)
}

/** True when a saved viewpoint's camera still means what it meant. */
export const viewpointFrameMatches = (
  v: Viewpoint,
  frame: ProjectFrame | null | undefined
): boolean => v.frame === frameKey(frame)

export interface ViewRow {
  id: number
  name: string
  sub: string
  edge: string
}

/** `SGVue.dc.html:1958`. */
export const viewRows = (
  views: readonly Viewpoint[],
  activeView: number | null
): ViewRow[] =>
  views.map((v) => ({
    id: v.id,
    name: v.name,
    sub: v.sub,
    edge: activeView === v.id ? 'var(--accent)' : 'transparent'
  }))

/**
 * Rename one viewpoint (2026-09-24, owner-requested). The name is trimmed; a blank one, an
 * unchanged one or an unknown id leaves the list as it was and returns **the same array**, so
 * the caller writes nothing. The list has no repeated-name rule — the design's own auto-names
 * never collide and two views may share a name — so none is applied.
 */
export function renameViews(
  views: readonly Viewpoint[],
  id: number,
  raw: string
): readonly Viewpoint[] {
  const name = raw.trim()
  const at = views.findIndex((v) => v.id === id)
  if (!name || at < 0 || views[at].name === name) return views
  return views.map((v, i) => (i === at ? { ...v, name } : v))
}
