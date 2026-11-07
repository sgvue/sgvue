/**
 * 2026-11-08 — the `.sgvue` project file, phase 5 (plan D10): what a drop does when a project
 * file is in it. Pure, so the window drop, the designed drop zone and the tests share one rule.
 *
 * **The rule.** A drop with no `.sgvue` in it is not this module's: it is an IFC drop, exactly as
 * before (`null`). A drop with one opens that project, alone. Anything else in the same drop is
 * not opened, and each such file is named in the designed error row with why: an IFC file (or
 * any other) dropped beside a project, or a second project — one project opens at a time, and the
 * first in the drop's own order is the one that opens. A project replaces what is open (phase 2),
 * so models dropped with it would only be thrown away by it a moment later.
 */

/** Whether a file name is a project file's: `*.sgvue`, any case. */
export const isProjectFileName = (name: string): boolean => /\.sgvue$/i.test(name)

/** The error row's text for a file dropped beside a project, which is not opened. */
export const DROPPED_WITH_PROJECT = 'not opened — a project was dropped with it'
/** The error row's text for a second project in one drop. */
export const ONE_PROJECT_AT_A_TIME = 'not opened — one project opens at a time'
/**
 * The error row's text for a dropped project that is not a file on disk — dragged out of a mail
 * or an archive view, where the drop names no path main could read.
 */
export const PROJECT_NOT_ON_DISK = 'not on disk — save it to a folder, then open it'

export interface ProjectDrop {
  /** The index, in the drop, of the project that opens. */
  project: number
  /** Every other file of the drop, by index, with its error row's text. */
  ignored: { index: number; reason: string }[]
}

/** What a drop of files with these names does: `null` when no project is in it (an IFC drop). */
export function projectDrop(names: readonly string[]): ProjectDrop | null {
  const project = names.findIndex(isProjectFileName)
  if (project < 0) return null
  const ignored: ProjectDrop['ignored'] = []
  names.forEach((name, index) => {
    if (index === project) return
    ignored.push({ index, reason: isProjectFileName(name) ? ONE_PROJECT_AT_A_TIME : DROPPED_WITH_PROJECT })
  })
  return { project, ignored }
}
