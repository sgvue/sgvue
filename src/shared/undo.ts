/**
 * Undo / redo for visibility — `design-reference/design/SGVue.dc.html:1012–1032`
 * (`VIS_KEYS`, `snapVis`, `pushUndo`, `up`, `step`) and `BUILD_PLAN.md` §1.6.
 *
 * Three properties of the design's design, all deliberate:
 *
 * 1. **Only five keys are covered.** Hidden elements, storey and model visibility, the filter
 *    stack and activate mode. The camera, the section, the selection and the theme are not
 *    undoable, so ⌘Z never surprises you by moving the view.
 * 2. **The stacks live outside reactive state.** They are two arrays of JSON strings; only the
 *    two booleans the action bar reads (`canUndo` / `canRedo`) are state, so pushing a
 *    snapshot re-renders nothing.
 * 3. **Cap 50, both sides.** `.slice(-50)` on every push, and on the counter-stack inside
 *    `step` too — so a long redo chain cannot grow the undo stack past the cap either.
 *
 * A snapshot is `JSON.stringify` of the five keys, which is also the equality test: pushing is
 * unconditional, exactly as the design pushes.
 *
 * One addition that is not the design's (2026-10-02): `peek(back)` reads the snapshot a step
 * would apply without taking the step. The design has no reader of its stacks but `step`; the
 * assistant's undo / redo needs one, to hold a step to the scope guard before it is taken.
 */

/** The keys an undo snapshot covers — `SGVue.dc.html:1013`. */
export const VIS_KEYS = ['hidden', 'storeyVis', 'modelVis', 'stack', 'active'] as const

export type VisKey = (typeof VIS_KEYS)[number]

/**
 * What a change **held behind the chat's Apply button** may write (2026-10-02, the consent
 * gate's review): the visibility keys a held patch really carries — `hidden`, `storeyVis`,
 * `modelVis`, `stack` — and the two that travel with them, `stepSel` (the step a new stack
 * selects) and `ctx` (the context menu a hide closes). Not the design's: its pending entry was
 * any patch at all.
 *
 * The pending row's patch is **typed** to these (`ai/executors/context.ts`, `PendingPatch`), and
 * `applyPending` hands `up()` **these and nothing else** whatever the object carries — a type
 * alone would not hold, since an object of a wider type is assignable to it. So a "visibility"
 * patch cannot carry the viewpoints, the saved filter sets, the base point or the transcript:
 * everything the gate asks the user about stays behind an action that says what it is.
 */
export const PENDING_PATCH_KEYS = ['hidden', 'storeyVis', 'modelVis', 'stack', 'stepSel', 'ctx'] as const

export type PendingPatchKey = (typeof PENDING_PATCH_KEYS)[number]

/** `patch`, cut down to `PENDING_PATCH_KEYS` — its own keys only, never an inherited one. */
export function pendingPatch<T extends object>(patch: T): Partial<Pick<T, Extract<keyof T, PendingPatchKey>>> {
  const out: Record<string, unknown> = {}
  for (const key of PENDING_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) out[key] = (patch as Record<string, unknown>)[key]
  }
  return out as Partial<Pick<T, Extract<keyof T, PendingPatchKey>>>
}

/** `SGVue.dc.html:1016`. */
export const UNDO_CAP = 50

/** A serialised `VIS_KEYS` snapshot. */
export type VisSnapshot = string

/**
 * `SGVue.dc.html:1014`. Takes anything carrying the five keys — the store itself does — and
 * copies **only** those five, so nothing else can slip into a snapshot by accident.
 */
export function snapVis(s: { [K in VisKey]: unknown }): VisSnapshot {
  const o: Record<string, unknown> = {}
  for (const k of VIS_KEYS) o[k] = s[k]
  return JSON.stringify(o)
}

/** What `step` hands back: the snapshot to apply, and the two flags after applying it. */
export interface UndoStep {
  snap: VisSnapshot
  canUndo: boolean
  canRedo: boolean
}

export interface UndoHistory {
  /** `pushUndo` (`:1015`): record the state *before* a change, and drop the redo branch. */
  push(snap: VisSnapshot): void
  /**
   * `step(back)` (`:1023`): move one snapshot off `back ? undo : redo`, push `current` onto
   * the other, and return what to apply. `null` when that side is empty.
   */
  step(back: boolean, current: VisSnapshot): UndoStep | null
  /**
   * The snapshot `step(back, …)` would apply, **without moving anything** — `null` when that side
   * is empty. 2026-10-02: the assistant's undo / redo has to know what a step would leave visible
   * before it takes it, because the scope guard decides on that (`executors/view.ts`).
   */
  peek(back: boolean): VisSnapshot | null
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** Drop both stacks — a new federation has no shared history with the old one. */
  reset(): void
  /** For tests and the Build Report: how deep each side is. */
  depth(): { undo: number; redo: number }
}

export function createUndoHistory(cap: number = UNDO_CAP): UndoHistory {
  let undo: VisSnapshot[] = []
  let redo: VisSnapshot[] = []
  return {
    push(snap) {
      undo = [...undo, snap].slice(-cap)
      redo = []
    },
    step(back, current) {
      const from = back ? undo : redo
      if (!from.length) return null
      const snap = from[from.length - 1]
      const other = [...(back ? redo : undo), current].slice(-cap)
      if (back) {
        undo = from.slice(0, -1)
        redo = other
      } else {
        redo = from.slice(0, -1)
        undo = other
      }
      return { snap, canUndo: undo.length > 0, canRedo: redo.length > 0 }
    },
    peek(back) {
      const from = back ? undo : redo
      return from.length ? from[from.length - 1] : null
    },
    get canUndo() {
      return undo.length > 0
    },
    get canRedo() {
      return redo.length > 0
    },
    reset() {
      undo = []
      redo = []
    },
    depth: () => ({ undo: undo.length, redo: redo.length })
  }
}
