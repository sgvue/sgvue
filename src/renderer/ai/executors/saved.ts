/**
 * The user's own saved things — viewpoints and markups (2026-10-02; parity with the user,
 * phase 2 — the owner: *"assistant should possess everything user can do on the app"*).
 *
 * `manage_views` is the Viewpoints card, each operation through the action its own control calls:
 *
 *   list     the card's rows                                   (a read)
 *   save     its "Save current view" button                    `saveView`
 *            …and, when a name is given, a double-click on it  `renameView`
 *   restore  a click on a row                                  `restoreView`
 *   rename   a double-click on a name                          `renameView`
 *   delete   its ×                                             asked for: the user's Apply
 *
 * `manage_markups` is the Markups card: its two lists, the tag that zooms to one
 * (`focusPoint`), and — asked for, like the viewpoint's × — a row's × and a list's `clear`.
 *
 * **Nothing here deletes or clears — it asks** (2026-10-02, phase 3, the consent gate).
 * A viewpoint or a markup that is removed cannot be brought back, so `manage_views`' `delete`
 * and `manage_markups`' `delete` and `clear` put the request behind the reply's Apply button
 * (`context.ts`, `PendingAction`) and change nothing; the card's own action runs in the store's
 * `applyPending`, on the user's click. Each names what will go by the record's **own id**: a
 * markup's `M2` is a position, and positions shift.
 *
 * **Placing** (phase 4): `place_spot` and `place_measure` are the user's click with the spot
 * tool or the laser meter, at a point that is named because a tool has no pointer — the middle
 * of an element's box top, of the box, or of its underside (`shared/annotate.ts`, `boxPlace`),
 * or a project-frame point. What is placed is made by the viewer's own commit for that click
 * (the store's `placeSpot` / `placeMeasure`), so it is the same record, the same labels, the
 * same number in the card, and the laser's rays are the laser tool's. A markup drawn in the 3D
 * view is **session view state**, not a saved list as the viewpoints are, so **the reply's
 * revert takes it away again** (the follow-up of the same day; phase 4 had it stay). What this
 * file does for that is report the new record's own id (`ui.placed`); the removing is the
 * store's, in `revertTurn`, through the card's own × — nothing here removes a markup, and the
 * gated `delete` still only asks. `show` sets a spot tag's two states, which a click on the tag
 * toggles; that state is the annotation layer's, and a revert does not put it back.
 *
 * **A restore can hide** — a viewpoint keeps what was hidden when it was saved — so it runs the
 * scope guard exactly as an undo does (`view.ts`, `stepHistory`): one that would take elements
 * out of view and leave nothing, or under 5 %, is **held behind Apply**. Until phase 3 it was
 * refused in words — the pending row held a visibility patch, and a viewpoint is a section, a
 * camera and two display switches as well. The user's own click on the row is not guarded, as
 * it never was.
 *
 * **Names are the user's text.** A viewpoint's name is whatever was typed, and its sub-line can
 * carry a gridline's or a storey's name from the file. Both reach the model only in a result
 * that was asked for — here and in `get_view_state` — bounded and clipped, never per turn and
 * never in the cached prefix.
 */
import { boxPlace, type BoxPlace } from '../../../shared/annotate'
import { visFn } from '../../../shared/rules'
import { sectionsLabel } from '../../../shared/sections'
import {
  MARKUPS_CAP,
  MARKUPS_PLACE_CAP,
  VIEWPOINTS_CAP,
  VIEWPOINTS_SAVE_CAP,
  VIEW_NAME_MAX
} from '../../../shared/tool-schemas'
import { measureRows, spotRows, type MarkupRow } from '../../state/selectors/markups'
import { viewpointFrameMatches, type Viewpoint } from '../../state/selectors/views'
import { getViewer, type ShellState } from '../../state/shell'
import { askApply, labelText, type Executor, type ToolContext, type ToolOutcome } from './context'
import { cameraKey, scopeCheck } from './view'

/** A viewpoint's sub-line (`grid C · 12 hidden · north`) as a result carries it. */
export const VIEW_SUB_CHARS = 120

/* ────────────────────────────── viewpoints ────────────────────────────── */

/** One saved viewpoint as the assistant reads it: the card's row. */
export interface ViewpointBrief {
  name: string
  /** What it holds, as the card's second line says it. */
  sub: string
  /** It is the one restored last — the row the card marks. */
  active: boolean
}

/**
 * The saved viewpoints, the first `VIEWPOINTS_CAP` of them in the card's own order —
 * `get_view_state`'s `viewpoints`, and `manage_views`' list.
 */
export function viewpointsState(s: ShellState): {
  viewpoints: ViewpointBrief[]
  total: number
  truncated: boolean
} {
  return {
    viewpoints: s.views.slice(0, VIEWPOINTS_CAP).map((v) => ({
      name: labelText(v.name, VIEW_NAME_MAX),
      sub: labelText(v.sub, VIEW_SUB_CHARS),
      active: s.activeView === v.id
    })),
    total: s.views.length,
    truncated: s.views.length > VIEWPOINTS_CAP
  }
}

/** The same list with each row's number, which is how `manage_views` can be told which one. */
function listed(s: ShellState): Record<string, unknown> {
  const { viewpoints, total, truncated } = viewpointsState(s)
  return {
    viewpoints: viewpoints.map((v, i) => ({ number: i + 1, ...v })),
    total,
    truncated
  }
}

const listText = (s: ShellState): string => {
  const { viewpoints, total, truncated } = viewpointsState(s)
  if (!total) return 'There are no saved viewpoints.'
  return (
    `${total} saved viewpoint${total === 1 ? '' : 's'}: ` +
    viewpoints.map((v, i) => `${i + 1}. "${v.name}" (${v.sub})${v.active ? ' — restored last' : ''}`).join('; ') +
    (truncated ? `; … ${total - viewpoints.length} more` : '') +
    '.'
  )
}

/**
 * Which viewpoint a call means — by number, else by name — or the sentence that says why not.
 *
 * A name is compared whole, and the list shows one clipped at `VIEW_NAME_MAX` characters: a
 * viewpoint the user gave a longer name is therefore reached by its number, which is what the
 * tool's description says and why every row of the list carries one.
 */
function findView(
  s: ShellState,
  input: Record<string, unknown>
): { view: Viewpoint; number: number } | { error: string } {
  const views = s.views
  if (typeof input.number === 'number') {
    const view = views[input.number - 1]
    return view
      ? { view, number: input.number }
      : { error: `There is no viewpoint ${input.number} — there ${views.length === 1 ? 'is' : 'are'} ${views.length}.` }
  }
  const asked = typeof input.name === 'string' ? input.name.trim() : ''
  if (!asked) return { error: 'Say which viewpoint: pass its name, or its number in the list.' }
  // Exactly first, then without regard to case — a name said out loud is rarely typed the same.
  let hits = views.map((view, i) => ({ view, number: i + 1 })).filter((h) => h.view.name === asked)
  if (!hits.length) {
    const low = asked.toLowerCase()
    hits = views
      .map((view, i) => ({ view, number: i + 1 }))
      .filter((h) => h.view.name.toLowerCase() === low)
  }
  const said = labelText(asked, VIEW_NAME_MAX)
  if (!hits.length) return { error: `No viewpoint is called "${said}".` }
  if (hits.length > 1) {
    // The card has no repeated-name rule, so two can share one; a number settles it.
    return {
      error: `${hits.length} viewpoints are called "${said}" — numbers ${hits
        .slice(0, VIEWPOINTS_CAP)
        .map((h) => h.number)
        .join(', ')}. Pass number to say which.`
    }
  }
  return hits[0]
}

export const manage_views: Executor = (input, ctx) => {
  const s = ctx.state()
  const op = String(input.op ?? '')

  if (op === 'list') return { forModel: { message: listText(s), ...listed(s) } }

  if (op === 'save') {
    const asked = typeof input.name === 'string' ? input.name.trim() : ''
    if (asked.length > VIEW_NAME_MAX) {
      return {
        forModel: {
          message: `A viewpoint's name is at most ${VIEW_NAME_MAX} characters — nothing was saved.`,
          saved: false
        }
      }
    }
    // The card's own button has no limit; a tool that can be called in a loop needs one.
    if (s.views.length >= VIEWPOINTS_SAVE_CAP) {
      return {
        forModel: {
          message: `There are already ${s.views.length} saved viewpoints, so nothing was saved — the user can save one from the Viewpoints card, or delete some there first.`,
          saved: false,
          total: s.views.length
        }
      }
    }
    s.saveView()
    const made = ctx.state().views[s.views.length]
    if (!made) {
      return { forModel: { message: 'The view could not be saved here — nothing changed.', saved: false } }
    }
    // A name of its own is the double-click on the new row: the card's second action.
    if (asked) ctx.state().renameView(made.id, asked)
    const after = ctx.state()
    const now = after.views.find((v) => v.id === made.id) ?? made
    return {
      forModel: {
        message: `Saved the current view as "${labelText(now.name, VIEW_NAME_MAX)}" (${labelText(now.sub, VIEW_SUB_CHARS)}) — viewpoint ${after.views.length} of ${after.views.length}.`,
        saved: true,
        name: labelText(now.name, VIEW_NAME_MAX),
        number: after.views.length,
        ...listed(after)
      },
      // Saving changes nothing on screen, and the list is not something a revert puts back.
      ui: {}
    }
  }

  const found = findView(s, input)
  if ('error' in found) {
    return { forModel: { message: `${found.error} Nothing changed. ${listText(s)}`, ...listed(s) } }
  }
  const { view, number } = found
  const name = labelText(view.name, VIEW_NAME_MAX)

  if (op === 'delete') {
    // 2026-10-02, phase 3 — the row's ×, asked for and never done here: a deleted viewpoint
    // cannot be brought back. By its own id, so the click deletes this one whatever the list
    // looks like by then.
    return askApply(
      `delete the viewpoint "${name}" (${labelText(view.sub, VIEW_SUB_CHARS)}) — it cannot be brought back`,
      { kind: 'delete_view', id: view.id },
      { name, number, ...listed(s) }
    )
  }

  if (op === 'rename') {
    const to = typeof input.to === 'string' ? input.to.trim() : ''
    if (!to) {
      return { forModel: { message: `Pass the new name in to — "${name}" was not renamed.`, renamed: false } }
    }
    if (to === view.name) {
      return {
        forModel: { message: `Viewpoint ${number} is already called "${name}" — nothing changed.`, renamed: false }
      }
    }
    s.renameView(view.id, to)
    return {
      forModel: {
        message: `Renamed viewpoint ${number} from "${name}" to "${labelText(to, VIEW_NAME_MAX)}".`,
        renamed: true,
        number,
        ...listed(ctx.state())
      },
      ui: {}
    }
  }

  return restore(view, number, ctx)
}

/**
 * `restore` — a click on the card's row, held to the scope guard as an undo is: one that would
 * take elements out of view and leave nothing, or under 5 %, waits for the user's Apply.
 */
function restore(view: Viewpoint, number: number, ctx: ToolContext): ToolOutcome {
  const s = ctx.state()
  const name = labelText(view.name, VIEW_NAME_MAX)
  if (!getViewer()) {
    return { forModel: { message: 'There is no 3D view to restore a viewpoint in — nothing changed.', applied: false } }
  }

  const total = s.federation.elements.length
  const shownNow = visFn(s)
  const shownNext = visFn({
    hidden: view.hidden ?? {},
    storeyVis: view.storeyVis ?? {},
    modelVis: view.modelVis ?? {},
    stack: view.stack ?? []
  })
  let would = 0
  /** Does it take anything out of view? One that only reveals is exempt, as `show` is. */
  let hides = false
  for (const e of s.federation.elements) {
    if (shownNext(e)) would++
    else if (shownNow(e)) hides = true
  }
  const scope = scopeCheck(would, total, !hides)
  if (scope !== 'ok') {
    // Held, by the viewpoint's own id: the user's Apply is the row's click (phase 3).
    return {
      forModel: {
        message: `Needs confirmation: restoring "${name}" would leave only ${would} of ${total} elements visible. The user has been shown an Apply button — tell them briefly what is waiting.`,
        applied: false,
        pending: true,
        name,
        number,
        wouldLeaveVisible: would,
        totalElements: total
      },
      ui: {
        pending: {
          label: `restore the viewpoint "${name}" — leaves ${would} of ${total} visible`,
          action: { kind: 'restore_view', id: view.id }
        }
      }
    }
  }

  // The row's own click: it pushes undo first, exactly as a click does.
  s.restoreView(view)
  const after = ctx.state()
  const shown = after.federation.elements.filter(visFn(after)).length
  const section = sectionsLabel(after.sections)
  // The card's own rule (`restoreView`): a camera recorded against another frame is not used.
  const reframed = !!view.cam && !viewpointFrameMatches(view, after.frame)
  return {
    forModel: {
      message:
        `Restored "${name}" — ${shown} of ${total} elements visible${section ? `, section ${section}` : ''}.` +
        (reframed
          ? ' Its camera was recorded against a different model, so the whole building is framed instead.'
          : ''),
      applied: true,
      name,
      number,
      visibleElements: shown,
      totalElements: total,
      section,
      ...(reframed ? { cameraRestored: false } : {})
    },
    ui: { acted: true }
  }
}

/* ────────────────────────────── markups ────────────────────────────── */

/**
 * One laser measurement as the card's row reads: its name, the lengths its rays read and —
 * since 2026-10-08, when the card started listing them — each length split at the point:
 * `minus` to the face on that axis's − side, `plus` to the one on its + side, a side that
 * reached no face left out. The whole ray stays beside them, as it always read.
 */
interface MeasureBrief {
  name: string
  x?: number
  y?: number
  z?: number
  sides: Partial<Record<'x' | 'y' | 'z', { minus?: number; plus?: number }>>
}

/** One spot coordinate: its map coordinates, or — with no base point — its level in the file. */
type SpotBrief = { name: string; E: number; N: number; Z: number } | { name: string; level: number }

/**
 * The Markups card's two lists, the first `MARKUPS_CAP` of each, numbered as the card numbers
 * them — by position, so `M1` is whatever is first now. Lengths are in the card's current unit:
 * whole millimetres, or metres to three decimals; coordinates and levels are metres.
 */
export function markupsState(s: ShellState): {
  units: string
  measures: MeasureBrief[]
  spots: SpotBrief[]
  measuresTotal: number
  spotsTotal: number
  truncated: boolean
} {
  const len = (metres: number): number => (s.units === 'm' ? +metres.toFixed(3) : Math.round(metres * 1000))
  const m3 = (v: number): number => +v.toFixed(3)
  /** Each axis split at the point, in the card's unit — what its row lists. */
  const sidesOf = (m: ShellState['measures'][number]): MeasureBrief['sides'] => {
    const out: MeasureBrief['sides'] = {}
    for (const a of ['x', 'y', 'z'] as const) {
      const r = m.sides[a]
      if (!r) continue
      out[a] = {
        ...(r.minus != null ? { minus: len(r.minus) } : {}),
        ...(r.plus != null ? { plus: len(r.plus) } : {})
      }
    }
    return out
  }
  return {
    units: s.units,
    measures: s.measures.slice(0, MARKUPS_CAP).map((m, i) => ({
      name: `M${i + 1}`,
      ...(m.x != null ? { x: len(m.x) } : {}),
      ...(m.y != null ? { y: len(m.y) } : {}),
      ...(m.z != null ? { z: len(m.z) } : {}),
      sides: sidesOf(m)
    })),
    spots: s.spots.slice(0, MARKUPS_CAP).map((p, i) =>
      p.E != null && p.N != null && p.Z != null
        ? { name: `C${i + 1}`, E: m3(p.E), N: m3(p.N), Z: m3(p.Z) }
        : { name: `C${i + 1}`, level: m3(p.z) }
    ),
    measuresTotal: s.measures.length,
    spotsTotal: s.spots.length,
    truncated: s.measures.length > MARKUPS_CAP || s.spots.length > MARKUPS_CAP
  }
}

const markupsText = (s: ShellState): string => {
  const m = s.measures.length
  const c = s.spots.length
  if (!m && !c) {
    return 'There are no markups — the user places them by clicking the model with the laser meter or the spot tool, and place_spot or place_measure places one at a point you name.'
  }
  const parts = [
    m ? `${m} laser measurement${m === 1 ? '' : 's'} (M1${m > 1 ? `–M${m}` : ''}, lengths in ${s.units})` : '',
    c ? `${c} spot coordinate${c === 1 ? '' : 's'} (C1${c > 1 ? `–C${c}` : ''}, in metres)` : ''
  ].filter(Boolean)
  const cut = m > MARKUPS_CAP || c > MARKUPS_CAP ? ` The first ${MARKUPS_CAP} of each are listed.` : ''
  return `${parts.join(' and ')}.${cut}`
}

/** The words for one of the card's two lists, as the card and the action bar say them. */
const MARKUP_NOUN = { measures: 'laser measurement', spots: 'spot coordinate' } as const

/**
 * `clear` — the `clear` beside one of the card's two lists, asked for (2026-10-02, phase 3).
 * The request carries the list as it stood, id by id: if a markup has been placed or deleted by
 * the time the user clicks, it is no longer the list the label counted, and nothing is cleared.
 */
function clearMarkups(input: Record<string, unknown>, s: ShellState): ToolOutcome {
  const kind = input.kind === 'measures' || input.kind === 'spots' ? input.kind : null
  if (!kind) {
    return {
      forModel: {
        message: `Say which list to clear: kind:"measures" for the laser measurements, kind:"spots" for the spot coordinates. Nothing changed. ${markupsText(s)}`,
        ...markupsState(s)
      }
    }
  }
  const laser = kind === 'measures'
  const ids = (laser ? s.measures : s.spots).map((m) => m.id)
  const noun = MARKUP_NOUN[kind]
  if (!ids.length) {
    return { forModel: { message: `There are no ${noun}s to clear — nothing changed.`, ...markupsState(s) } }
  }
  const letter = laser ? 'M' : 'C'
  const range = ids.length === 1 ? `${letter}1` : `${letter}1–${letter}${ids.length}`
  return askApply(
    ids.length === 1
      ? `delete the one ${noun} (${range}) — it cannot be brought back`
      : `delete all ${ids.length} ${noun}s (${range}) — they cannot be brought back`,
    laser ? { kind: 'clear_measures', ids } : { kind: 'clear_spots', ids },
    { kind, count: ids.length }
  )
}

/* ────────────────────────────── placing (2026-10-02, phase 4) ────────────────────────────── */

type Triple = [number, number, number]

/** Where a markup is to go: a project-frame point, the face it sits on, and how to say it. */
interface Placement {
  p: Triple
  normal: Triple | null
  /** The element the point sits on, for the laser's own "step past the surface we are on". */
  selfId: number
  /** "the middle of the top face of the bounding box of …", or "the point given". */
  where: string
  /** What the result carries beside the point. */
  fields: Record<string, unknown>
  /** The element is not in view, so the markup stands where nothing is drawn. */
  hidden: boolean
}

const PLACE_WORDS: Record<BoxPlace, string> = {
  top: 'the middle of the top face of the bounding box of',
  centre: 'the middle of the bounding box of',
  base: 'the middle of the underside of the bounding box of'
}

/** An element's name as a result quotes it — the file's own text, so clipped and cleaned. */
const ELEMENT_NAME_CHARS = 80

/** The point a call names, or the sentence that says why there is none. */
function placementOf(input: Record<string, unknown>, s: ShellState): Placement | { error: string } {
  const point = input.point as { x: number; y: number; z: number } | undefined
  const hasId = typeof input.id === 'number'
  if (point && hasId) return { error: 'Pass either id (with at) or point — not both.' }
  if (point) {
    return {
      p: [point.x, point.y, point.z],
      normal: null,
      selfId: -1,
      where: 'the point given',
      fields: {},
      hidden: false
    }
  }
  if (!hasId) {
    return { error: 'Say where: pass the element’s id (and at: top, centre or base), or a point in project-frame metres.' }
  }
  const el = s.byId.get(input.id as number)
  if (!el) return { error: `No element has id ${input.id as number} — ids are per session, so query again.` }
  const name = labelText(el.name || el.type, ELEMENT_NAME_CHARS)
  if (!el.bbox) return { error: `"${name}" has no geometry, so there is nowhere on it to place a markup.` }
  const at: BoxPlace = input.at === 'centre' || input.at === 'base' ? input.at : 'top'
  const { p, normal } = boxPlace(el.bbox, at)
  return {
    p,
    normal,
    // The middle of the box is on no surface of the element: there is nothing to step past, and
    // the rays read the element's own faces.
    selfId: at === 'centre' ? -1 : el.id,
    where: `${PLACE_WORDS[at]} "${name}"`,
    fields: { element: el.id, at, on: 'bounding box' },
    hidden: !visFn(s)(el)
  }
}

const REVERT_REMOVES =
  'It is in the Markups card, where the user can delete it, and this reply’s revert takes it away again.'

/**
 * `place_spot` / `place_measure` — the click with the spot tool or the laser meter, at a named
 * point. The new record is found by its id, which the viewer gives it: nothing here makes one.
 * That id is what the call reports to the turn (`ui.placed`), so the reply's `revert` removes
 * this markup and no other.
 */
function placeMarkup(input: Record<string, unknown>, ctx: ToolContext, laser: boolean): ToolOutcome {
  const s = ctx.state()
  const noun = MARKUP_NOUN[laser ? 'measures' : 'spots']
  const had = laser ? s.measures : s.spots
  const refuse = (message: string): ToolOutcome => ({
    forModel: { message: `${message} Nothing was placed.`, placed: false }
  })
  if (!getViewer()) return refuse('There is no 3D view to place a markup in.')
  // The card's own tools have no limit; one that can be called in a loop needs one — and the
  // lists a result can name stop at the same number.
  if (had.length >= MARKUPS_PLACE_CAP) {
    return refuse(
      `There are already ${had.length} ${noun}s — the user can delete some from the Markups card first.`
    )
  }
  const place = placementOf(input, s)
  if ('error' in place) return refuse(place.error)

  const before = new Set(had.map((m) => m.id))
  const done = laser ? s.placeMeasure(place.p, place.normal, place.selfId) : s.placeSpot(place.p)
  const after = ctx.state()
  const list = laser ? after.measures : after.spots
  const at = list.findIndex((m) => !before.has(m.id))
  if (!done || at < 0) {
    return refuse(
      laser
        ? 'No ray from that point reached a visible face — the laser reads the distance to the nearest faces along X, Y and Z, and found none.'
        : 'The spot could not be placed here.'
    )
  }
  const name = `${laser ? 'M' : 'C'}${at + 1}`
  const [x, y, z] = place.p.map((v) => +v.toFixed(3))
  const full = !laser && input.show === 'full'
  if (full) after.showSpot(list[at].id, true)
  const state = markupsState(after)
  const record = (laser ? state.measures : state.spots)[at]
  // What the card's row reads — or, for a spot in a model with no base point, its level, which
  // is what its tag shows and the row has only dashes for.
  const reads = laser
    ? measureRows(after.measures, after.units)[at].v.replace(/\s+/g, ' ')
    : 'level' in record
      ? `level ${record.level} m in the file’s own coordinates — the model has no base point`
      : spotRows(after.spots)[at].v
  return {
    forModel: {
      message:
        `Placed ${noun} ${name} at ${place.where}: ${reads}. ` +
        (laser
          ? 'Each axis reads from that point to the nearest visible face on its − side and on its + side, in that order; a lone number is the one side that reached a face. '
          : full
            ? 'Its tag shows the full E, N and Z. '
            : 'Its tag shows the level alone; show:"full" gives E, N and Z. ') +
        (place.hidden ? 'The element is hidden in the current view, so the markup stands where nothing is drawn. ' : '') +
        REVERT_REMOVES,
      placed: true,
      name,
      ...(laser ? { measure: record } : { spot: record }),
      pointMetres: { x, y, z },
      pointFrame: 'project',
      ...place.fields,
      ...(place.hidden ? { elementHidden: true } : {})
    },
    // The record the viewer made, by its own id: what this reply's revert takes away. No part
    // of the review state changed, so the turn is not marked `acted` for it.
    ui: { placed: { kind: laser ? 'measure' : 'spot', id: list[at].id } }
  }
}

/** `show` — one spot tag's state, or every spot's: a click on the tag, by its own setter. */
function showSpots(input: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const s = ctx.state()
  const full = input.show === 'full'
  if (input.show !== 'full' && input.show !== 'level') {
    return {
      forModel: {
        message: 'Say which: show:"full" for a tag’s E, N and Z, or show:"level" for its level alone. Nothing changed.'
      }
    }
  }
  if (!getViewer()) return { forModel: { message: 'There is no 3D view, so there are no spot tags — nothing changed.' } }
  const asked = typeof input.name === 'string' ? input.name.trim() : ''
  const named = /^c\s*(\d{1,6})$/i.exec(asked)
  if (asked && !named) {
    return {
      forModel: {
        message: `"${labelText(asked, 20)}" is not a spot coordinate — they are C1, C2 …; a laser measurement has no tag to change. Nothing changed. ${markupsText(s)}`
      }
    }
  }
  /** The one named, by its position in the card — or, with no name, every spot there is. */
  const n = named ? Number(named[1]) : 0
  const spots = named ? s.spots.slice(n - 1, n) : s.spots
  if (!spots.length) {
    return {
      forModel: {
        message: `${named ? `There is no C${n}.` : 'There are no spot coordinates.'} Nothing changed. ${markupsText(s)}`
      }
    }
  }
  let changed = 0
  for (const spot of spots) if (s.showSpot(spot.id, full) === 'changed') changed++
  const state = full ? 'the full E, N and Z' : 'the level alone'
  let message: string
  if (named) {
    message = changed ? `C${n} now shows ${state}.` : `C${n} already shows ${state} — nothing changed.`
  } else if (!changed) {
    message = `Every spot tag already shows ${state} — nothing changed.`
  } else {
    message =
      `${changed} of ${spots.length} spot tag${spots.length === 1 ? '' : 's'} now show${changed === 1 ? 's' : ''} ${state}` +
      (changed < spots.length ? '; the rest already did.' : '.')
  }
  return {
    forModel: { message, show: full ? 'full' : 'level', changed },
    // A tag's state is the viewer's own, for the session: not something a revert puts back.
    ui: {}
  }
}

export const manage_markups: Executor = (input, ctx) => {
  const s = ctx.state()
  const op = String(input.op ?? '')
  if (op === 'list') return { forModel: { message: markupsText(s), ...markupsState(s) } }
  if (op === 'clear') return clearMarkups(input, s)
  if (op === 'place_spot' || op === 'place_measure') return placeMarkup(input, ctx, op === 'place_measure')
  if (op === 'show') return showSpots(input, ctx)

  // focus and delete — one markup, named as the card names it.
  const asked = typeof input.name === 'string' ? input.name.trim() : ''
  const named = /^([mc])\s*(\d{1,6})$/i.exec(asked)
  const laser = named?.[1].toLowerCase() === 'm'
  const list = named ? (laser ? s.measures : s.spots) : []
  const at = named ? Number(named[2]) - 1 : -1
  const mark = list[at]
  if (!mark) {
    const why = !asked
      ? 'Say which markup: pass its name as the card shows it, e.g. M2 or C1.'
      : !named
        ? `"${labelText(asked, 20)}" is not a markup's name — they are M1, M2 … and C1, C2 ….`
        : `There is no ${named[1].toUpperCase()}${named[2]}.`
    return { forModel: { message: `${why} Nothing changed. ${markupsText(s)}`, ...markupsState(s) } }
  }
  const name = `${laser ? 'M' : 'C'}${at + 1}`

  if (op === 'delete') {
    // The row's ×, asked for (phase 3). `M2` is a position, and positions shift when a markup
    // is deleted — so the request is fixed to the record's own id, and the label quotes what
    // the card's row reads now, which is how the user can tell it is the one they mean.
    const rows: MarkupRow[] = laser ? measureRows(s.measures, s.units) : spotRows(s.spots)
    return askApply(
      `delete ${MARKUP_NOUN[laser ? 'measures' : 'spots']} ${name} (${rows[at].v.replace(/\s+/g, ' ')}), as the Markups card lists it now — it cannot be brought back`,
      laser ? { kind: 'delete_measure', id: mark.id } : { kind: 'delete_spot', id: mark.id },
      { name }
    )
  }

  if (!getViewer()) {
    return { forModel: { message: 'There is no 3D view to zoom in — nothing changed.' } }
  }
  const before = cameraKey(s)
  s.focusPoint(mark.p)
  return {
    forModel: { message: `Zoomed to ${name}.`, focused: name },
    // The camera moved, which a revert puts back — unless it was already there.
    ui: { acted: cameraKey(ctx.state()) !== before }
  }
}

export const SAVED_EXECUTORS: Record<string, Executor> = { manage_views, manage_markups }
