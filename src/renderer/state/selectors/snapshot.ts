/**
 * What one reply of the assistant's changed, and how to put it back — the chat panel's per-turn
 * `revert` (`SGVue.dc.html:1613`, `:1622`), as pure functions. 2026-10-02.
 *
 * **What changed, and whose decision it is.** The design's revert restores the five visibility
 * keys (`VIS_KEYS`) and nothing else. That was the whole of what its assistant could change. It
 * is not any more: the assistant sets sections, moves the camera, switches the display, colours
 * models, selects, and changes the app's own settings — and `revert` appeared on those turns and
 * put nothing back. The owner, asked on 2026-10-01 whether the chat's revert should restore
 * everything the assistant changed in that reply rather than visibility only: *"correct."*
 *
 * **No second mechanism.** A snapshot is the app's own **session payload**
 * (`shared/session-codec.ts`, `sessionPayload` — what a session and a share link save), cut from
 * the store by `sessionSource`, which `model/session.ts` uses too; and it is put back through
 * the app's own restore path, the store's `applySession` and the codec's `applyRestore` order.
 * Beside the payload stand the few things a session does not carry and the assistant can change
 * (`TurnExtra`): the selection, the colour-by scheme, the canvas grid, the sidebar, the open
 * card, the armed tool, the tree's search and the viewpoint marked as restored. (The display
 * unit stood here too until 2026-10-09, when a session started saving it.)
 *
 * **"Undo just this step"** — the control's own tooltip — is taken literally. The state is cut
 * into parts (`TURN_PARTS`), a reply's undo records **which parts that reply changed**, and
 * `revert` puts back exactly those. A reply that hid the walls and never touched the camera does
 * not fly the camera back to where it was an hour ago. The five visibility keys are one part,
 * restored together as they always were, and still go on the undo stack.
 *
 * "That reply changed" means **its tool calls did**. A turn takes seconds and the user orbits
 * while they wait, so the parts are measured around each call that says it acted
 * (`ai/executors/index.ts`, `TurnState.parts`) and the reply's undo is those parts, as far as
 * they still differ from the snapshot taken before the turn (`turnUndo`).
 *
 * **The same rules a session restore keeps** (`revertPlan`):
 *   · element ids are renumbered onto the slots their models have now (`slotMapOf`): a model
 *     unloaded and opened again need not be on the slot it had;
 *   · a model that is no longer loaded takes its ids, its eye, its colour and `active` with it —
 *     everything else is put back, and `lost.models` names it so the panel can say so;
 *   · the camera is scene coordinates, so it is put back only while the scene is the one it was
 *     recorded in — the project frame, and the whole-metre offset beside it. Otherwise it is
 *     left where it is, and `lost.camera` says so.
 *
 * Not in any part, and never restored: `uploadNames`. It follows the federation, which only
 * the user's own click loads or unloads, and putting an old copy back would undo that loading.
 *
 * 2026-10-02, phase 3 — the base point (`coords`) was a part: the assistant could ask to change
 * it, the user's Apply changed it, and the reply's `revert` put the old one back. **Not since
 * 2026-10-08**, when the owner made the Coordinate-system card read-only: nothing in the app can
 * change the base point — it is the boot file's (`state/shell.ts`, `setOffset`) — so there is
 * nothing to put back, and `coords` stands beside `uploadNames` again (`NOT_REVERTED`). What a
 * revert cannot put back is what was deleted — a viewpoint, a markup, a saved filter set — and
 * that is exactly why those are asked for rather than done.
 *
 * Phase 4, and its follow-up the same day — **a markup the assistant placed is not a part, and a
 * revert takes it away all the same** (`ai/executors/saved.ts`, `place_spot` / `place_measure`).
 * The two markup lists are the viewer's own records, which no session carries, so they are not
 * in a snapshot; but a spot or a measurement drawn in the 3D view is session view state — the
 * most visible thing a reply can add — and not a saved list. So the reply keeps the ids of the
 * markups its own calls placed (`ChatMessage.placed`) and `revertTurn` (`state/shell.ts`)
 * removes the ones that are still there, beside the parts: these, by id, through the card's own
 * ×, and no markup the user or another reply placed. Phase 4 had left a placed markup standing,
 * "an addition to the user's list, like a saved viewpoint"; the line is the other way — **session
 * view state is put back; saved lists are not**: a viewpoint, a filter set, a saved schedule
 * setup. Not put back either: a spot tag's state (its level alone, or its full E / N / Z), which
 * is the annotation layer's, per spot, for the session. And nothing in the Schedules window is:
 * what `manage_schedules` changes there is on that window's own undo history, or in its saved
 * setups.
 */
import type { ColorByState } from '../../../shared/colors'
import { slotOfId } from '../../../shared/federate'
import { frameKey } from '../../../shared/georef'
import {
  renumberId,
  sessionPayload,
  slotMapOf,
  type SessionCamera,
  type SessionPayload,
  type SessionSource,
  type SlotRecord
} from '../../../shared/session-codec'
import type { Tool } from '../../viewer/viewer-core'
import type { CardName, ShellState } from '../shell'

/** `SGVue.dc.html:1678` — the state a session saves, read off the store. One list, two readers. */
export const sessionSource = (s: ShellState): SessionSource => ({
  uploadNames: s.uploadNames,
  hidden: s.hidden,
  storeyVis: s.storeyVis,
  modelVis: s.modelVis,
  active: s.active,
  modelColors: s.modelColors,
  nativeMats: s.nativeMats,
  treeMode: s.treeMode,
  grids: s.grids,
  levels: s.levels,
  shadows: s.shadows,
  theme: s.theme,
  snap: s.snap,
  dims: s.dims,
  sections: s.sections,
  stack: s.stack,
  hlColor: s.hlColor,
  view: s.view,
  coords: s.coords,
  units: s.units
})

/** What the assistant can change and a session does not carry. */
export interface TurnExtra {
  selIds: readonly number[]
  colorBy: ColorByState | null
  groundGrid: boolean
  panelOpen: boolean
  card: CardName | null
  tool: Tool
  search: string
  /** The viewpoint whose row is marked as the one restored last. */
  activeView: number | null
}

/** The review state at one moment. It holds the store's own objects, which are never mutated. */
export interface TurnSnapshot {
  /** The session payload, with no files: a snapshot never leaves the window. */
  payload: SessionPayload
  extra: TurnExtra
  /** Each loaded model's key, digest and slot — what the element ids in it are numbered by. */
  models: readonly SlotRecord[]
  /** The whole metres the scene stands off the project frame; the camera is relative to them. */
  offset: readonly [number, number, number]
}

export function turnSnapshot(s: ShellState, cam: SessionCamera | null): TurnSnapshot {
  return {
    payload: sessionPayload(sessionSource(s), s.loaded, [], cam, frameKey(s.frame)),
    extra: {
      selIds: s.selIds,
      colorBy: s.colorBy,
      groundGrid: s.groundGrid,
      panelOpen: s.panelOpen,
      card: s.card,
      tool: s.tool,
      search: s.search,
      activeView: s.activeView
    },
    models: s.federation.models.map((m) => ({
      key: m.meta.modelKey,
      sha256: m.meta.sha256,
      slot: m.slot
    })),
    offset: s.offset
  }
}

/* ────────────────────────────── the parts ────────────────────────────── */

interface PartSpec {
  payload?: readonly (keyof SessionPayload)[]
  extra?: readonly (keyof TurnExtra)[]
}

/**
 * The review state, cut into the parts a revert puts back one by one. Every key of the session
 * payload the assistant can change is in exactly one part (`tests/unit/turn-revert.test.ts`
 * holds the table to `SessionSource`), and so is every key of `TurnExtra`.
 *
 * `vis` is the design's five keys, together. `camera` is the pose, the named view the toolbar
 * lights and the viewpoint row that is marked. `colours` is the model swatches with the
 * Original-materials switch, which one viewer call takes together.
 */
export const TURN_PARTS = {
  vis: { payload: ['hidden', 'storeyVis', 'modelVis', 'stack', 'active'] },
  sections: { payload: ['sections', 'section'] },
  camera: { payload: ['cam', 'view'], extra: ['activeView'] },
  grids: { payload: ['grids'] },
  levels: { payload: ['levels'] },
  shadows: { payload: ['shadows'] },
  dims: { payload: ['dims'] },
  snap: { payload: ['snap'] },
  groundGrid: { extra: ['groundGrid'] },
  colours: { payload: ['modelColors', 'nativeMats'] },
  hlColor: { payload: ['hlColor'] },
  colorBy: { extra: ['colorBy'] },
  selection: { extra: ['selIds'] },
  theme: { payload: ['theme'] },
  treeMode: { payload: ['treeMode'] },
  units: { payload: ['units'] },
  sidebar: { extra: ['panelOpen'] },
  card: { extra: ['card'] },
  tool: { extra: ['tool'] },
  search: { extra: ['search'] }
} as const satisfies Record<string, PartSpec>

export type TurnPart = keyof typeof TURN_PARTS

/** The session keys no part covers, each with its reason (the header has them in full). */
export const NOT_REVERTED: Readonly<Record<string, string>> = {
  uploadNames:
    'follows the federation; a model is loaded or unloaded only by the user’s own click, and a revert must not undo that',
  coords:
    'the base point is the boot file’s and read-only since 2026-10-08 — nothing in the app changes it, so a reply never has one to put back'
}

const PART_NAMES = Object.keys(TURN_PARTS) as TurnPart[]
const specOf = (part: TurnPart): PartSpec => TURN_PARTS[part]

/** The store never mutates in place, so identity settles most of it; the rest is small. */
const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

/** The parts in which two snapshots differ, in the table's order. */
export function changedParts(a: TurnSnapshot, b: TurnSnapshot): TurnPart[] {
  return PART_NAMES.filter((part) => {
    const spec = specOf(part)
    return (
      (spec.payload ?? []).some((k) => !same(a.payload[k], b.payload[k])) ||
      (spec.extra ?? []).some((k) => !same(a.extra[k], b.extra[k]))
    )
  })
}

/** `base`, with the named parts taken from `from`. Everything else is `base`'s, models included. */
export function withParts(
  base: TurnSnapshot,
  from: TurnSnapshot,
  parts: readonly TurnPart[]
): TurnSnapshot {
  const payload: Record<string, unknown> = { ...base.payload }
  const extra: Record<string, unknown> = { ...base.extra }
  for (const part of parts) {
    const spec = specOf(part)
    for (const k of spec.payload ?? []) payload[k] = from.payload[k]
    for (const k of spec.extra ?? []) extra[k] = from.extra[k]
  }
  return {
    ...base,
    payload: payload as unknown as SessionPayload,
    extra: extra as unknown as TurnExtra
  }
}

/* ────────────────────────────── what a reply can undo ────────────────────────────── */

/** What `revert` on one reply puts back: the state before it, and the parts it changed. */
export interface TurnUndo {
  before: TurnSnapshot
  /** Never empty — a reply that changed nothing a revert can restore has no undo at all. */
  changed: readonly TurnPart[]
}

/**
 * The undo for a reply, or `null` when the reply left every part as it found it.
 *
 * `only` is the parts the reply's own tool calls changed (`ai/executors`, `TurnState.parts`).
 * A part that differs but is not among them was changed by the user while the reply was being
 * written — an orbit, a click in the tree — and is not the reply's to put back. A part that is
 * among them and no longer differs was changed and changed back, and needs nothing.
 */
export function turnUndo(
  before: TurnSnapshot,
  after: TurnSnapshot,
  only?: readonly TurnPart[]
): TurnUndo | null {
  const changed = changedParts(before, after).filter((part) => !only || only.includes(part))
  return changed.length ? { before, changed } : null
}

/**
 * A change the scope guard held, applied later from the reply's own Apply button
 * (`SGVue.dc.html:1632`), joins what the reply had already changed: one revert then puts back
 * both. The earlier undo's values win for the parts it already covers — they are the older
 * ones — and the parts the Apply changed take the values from just before it.
 *
 * The two are only joined while both were recorded against the same models: their element ids
 * are numbered by slot, and two numberings cannot share one snapshot. If the federation changed
 * in between, the Apply's own undo stands alone, as the design's did.
 */
export function mergeUndo(
  earlier: TurnUndo | null | undefined,
  before: TurnSnapshot,
  after: TurnSnapshot
): TurnUndo | null {
  const fresh = changedParts(before, after)
  if (!earlier) return fresh.length ? { before, changed: fresh } : null
  if (!fresh.length) return earlier
  if (!same(earlier.before.models, before.models)) return { before, changed: fresh }
  return {
    before: withParts(before, earlier.before, earlier.changed),
    changed: PART_NAMES.filter((p) => earlier.changed.includes(p) || fresh.includes(p))
  }
}

/* ────────────────────────────── putting it back ────────────────────────────── */

export interface RevertLost {
  /** Models the undo needed that are no longer loaded, by key, in the order they were loaded. */
  models: string[]
  /** The camera was not put back: the scene is not the one it was recorded in. */
  camera: boolean
}

export interface RevertPlan {
  /** For the store's `applySession`: the live payload with the changed parts as they were. */
  payload: Partial<SessionPayload>
  /** The changed parts a session does not carry — each key present is to be set. */
  extra: Partial<TurnExtra>
  lost: RevertLost
}

/**
 * What a revert does, worked out against the state as it is now.
 *
 * It starts from the **live** state and takes only the changed parts from the undo, so every
 * part the reply left alone is handed back to the restore path exactly as it stands. Two keys
 * are withheld rather than re-applied, because the restore path acts on their presence: `cam`
 * (present, the camera flies to it) and `shadows` (present, the shadow map is redrawn). The one
 * time a camera that is not the reply's is handed over is beside a section, whose own re-aim it
 * then undoes.
 */
export function revertPlan(undo: TurnUndo, live: TurnSnapshot): RevertPlan {
  const { before, changed } = undo
  const has = (part: TurnPart): boolean => changed.includes(part)
  const { slots } = slotMapOf(before.models, live.models)
  const keyOfSlot = new Map(before.models.map((m) => [m.slot, m.key]))
  // By key, the store's own `loaded` list is what says a model is here — the list `step()`
  // consults for the same question (`restoredVis`).
  const loaded = new Set(live.payload.models)
  const missing = new Set<string>()
  /**
   * One id as it is numbered now — or noted as its model's loss. A key that was never an id (a
   * saved viewpoint's `hidden` is whatever `localStorage` held) is dropped and blames no model.
   */
  const idNow = (id: number): number | null => {
    const now = renumberId(id, slots)
    if (now === null && Number.isSafeInteger(id) && id >= 0) {
      const key = keyOfSlot.get(slotOfId(id))
      if (key !== undefined) missing.add(key)
    }
    return now
  }
  /**
   * A key-indexed map with only the models that are still loaded. An entry that said something
   * about a model that has gone — its eye off, its colour — is that model's loss.
   */
  const byLoaded = <T>(map: Record<string, T>, says: (v: T) => boolean): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const [key, v] of Object.entries(map)) {
      if (loaded.has(key)) out[key] = v
      else if (before.payload.models.includes(key) && says(v)) missing.add(key)
    }
    return out
  }

  const target = withParts(live, before, changed)
  const payload: Partial<SessionPayload> = { ...target.payload }
  const extra: Partial<TurnExtra> = {}
  for (const part of changed) {
    for (const k of specOf(part).extra ?? []) (extra as Record<string, unknown>)[k] = before.extra[k]
  }

  if (has('vis')) {
    const hidden: Record<string, boolean> = {}
    for (const [id, on] of Object.entries(before.payload.hidden ?? {})) {
      const now = idNow(Number(id))
      if (now !== null) hidden[now] = on
    }
    payload.hidden = hidden
    payload.modelVis = byLoaded(before.payload.modelVis ?? {}, (shown) => shown === false)
    const active = before.payload.active
    if (active != null && !loaded.has(active)) {
      missing.add(active)
      payload.active = null
    }
  }
  if (has('colours')) payload.modelColors = byLoaded(before.payload.modelColors ?? {}, () => true)
  if (has('selection')) {
    extra.selIds = before.extra.selIds.map(idNow).filter((id): id is number => id !== null)
  }
  if (has('colorBy') && before.extra.colorBy) {
    const scheme = before.extra.colorBy
    const groups = scheme.groups
      .map((g) => {
        const ids = g.ids.map(idNow).filter((id): id is number => id !== null)
        return ids.length === g.ids.length && ids.every((id, i) => id === g.ids[i])
          ? g
          : { ...g, n: ids.length, ids }
      })
      .filter((g) => g.ids.length)
    extra.colorBy = groups.length ? { ...scheme, groups } : null
  }

  // The camera is scene coordinates: it means something only in the scene it was recorded in.
  let cameraLost = false
  let camera = has('camera')
  if (camera && !(before.payload.frame === live.payload.frame && same(before.offset, live.offset))) {
    cameraLost = before.payload.cam !== null
    payload.view = live.payload.view
    extra.activeView = live.extra.activeView
    camera = false
  }
  if (camera) payload.frame = before.payload.frame
  else {
    // The camera stays where it is. A section that is put back and starts cutting again re-aims
    // the camera at itself (`viewer/section.ts`), so with a section among the parts the camera
    // as it stands is handed to the restore path — which sets it after the section, and so
    // leaves it standing. With no section nothing moves it, and it is withheld.
    payload.cam = has('sections') ? live.payload.cam : null
    payload.frame = live.payload.frame
  }
  if (!has('shadows')) delete payload.shadows

  return {
    payload,
    extra,
    lost: { models: before.payload.models.filter((k) => missing.has(k)), camera: cameraLost }
  }
}

/** A model key as the note prints it: a file's stem can be as long as a file name. */
const NOTE_NAME_CHARS = 40
const NOTE_NAMES = 3

/**
 * What the panel says when a revert could not put everything back — one sentence a part, then
 * what did happen. `''` when nothing was lost, which is nearly always.
 */
export function revertNote(lost: RevertLost): string {
  const said: string[] = []
  if (lost.models.length) {
    const clip = (k: string): string =>
      k.length > NOTE_NAME_CHARS ? k.slice(0, NOTE_NAME_CHARS) + '…' : k
    const shown = lost.models.slice(0, NOTE_NAMES).map(clip)
    const more = lost.models.length - shown.length
    const names = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(' and ')
    const one = lost.models.length === 1
    said.push(
      `${names} ${one ? 'is' : 'are'} no longer loaded, so nothing of ${one ? 'it' : 'them'} could be put back.`
    )
  }
  if (lost.camera) {
    said.push('The camera was left where it is: the model stands somewhere else than it did then.')
  }
  return said.length ? `${said.join(' ')} Everything else was reverted.` : ''
}
