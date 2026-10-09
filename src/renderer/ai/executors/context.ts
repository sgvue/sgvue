/**
 * What an executor is handed, and what it hands back.
 *
 * **Only `forModel` crosses IPC.** It is JSON with real counts in it — per-OR-group counts,
 * samples, `truncated`, `valid_values` when nothing matched — because plan §3.5 defect 9 is
 * that the prototype returned prose and the model had to parse its own tool results back out
 * of a sentence. The sentence is still there, as `message`, because the reply the user reads
 * is unchanged; everything else beside it is structure.
 *
 * `ui` never leaves the renderer. Chips, the table, the pending patch and the "this turn
 * changed something" flag are the panel's, and they are accumulated per turn exactly as
 * `SGVue.dc.html:1591–1619` accumulates them.
 *
 * 2026-10-02, phase 3 — **the consent gate.** The pending row under a reply can hold an
 * **action** as well as a visibility patch (`PendingAction`): something that reaches outside
 * the view or cannot be undone, which the assistant may only *ask* for. An executor describes
 * it — a kind and the ids it was fixed to when it was asked — and never performs it; the
 * store's `applyPending`, which only the user's click on Apply calls, is the one place it is
 * performed. And a turn asks for one thing: a held change, a gated action, a native dialog or
 * the sidebar's unload confirmation — whichever comes first (`waitingOn`).
 */
import type { SqlQueryResult } from '../../model/sql-bridge'
import type { RawLine } from '../../../worker/index-builder'
import type { FederatedElement } from '../../../shared/federate'
import { matchFn, type Rule } from '../../../shared/rules'
import type { PendingPatchKey } from '../../../shared/undo'
import { turnSnapshot, type TurnPart, type TurnSnapshot } from '../../state/selectors/snapshot'
import { getViewer, type ShellState } from '../../state/shell'

/** One clickable chip under a reply. `SGVue.dc.html:1361`. */
export interface ChatChip {
  label: string
  ids: number[]
}

/** One table under a reply. `SGVue.dc.html:1370` and `:1396` (the clash variant). */
export interface ChatTable {
  groupBy: string
  clash?: boolean
  rows: { k: string; n: number; area?: number; volume?: number; vol?: number; ids: number[] }[]
  /**
   * 2026-10-09 — the unit the area and volume totals are in, **as the file writes it** (`m²`,
   * `ft²` …: `summarize_elements`'s own `units`), a metric absent where the files do not settle
   * one. The totals are as authored, so this is their label; the design's literal `m²` and `m³`
   * labelled a model in feet wrong (`state/selectors/chat.ts`, `tableQuantity`). A clash table's
   * overlap volume is the app's own, in the display unit.
   */
  units?: { area?: string; volume?: string }
}

/**
 * What the user's click on Apply does when it is not a visibility patch — 2026-10-02, the
 * consent gate. **A closed list**: `applyPending` (`state/shell.ts`) performs exactly these, and
 * nothing in `ai/` performs any of them.
 *
 * Each carries what was fixed when the request was made — a record's own id, never its
 * position in a list; the history entry an undo would restore; the text to copy — so that the
 * label the user reads is what the click does. When that no longer holds at the click (the
 * viewpoint has gone, the history has moved on) nothing is done, and the panel says so.
 */
export type PendingAction =
  /** The action bar's Undo / Redo, held by the scope guard. `snap` is the entry it would restore. */
  | { kind: 'undo'; snap: string }
  | { kind: 'redo'; snap: string }
  /** A click on a Viewpoints row, held by the scope guard. */
  | { kind: 'restore_view'; id: number }
  /** The Viewpoints row's ×. */
  | { kind: 'delete_view'; id: number }
  /** A Markups row's ×. */
  | { kind: 'delete_measure'; id: number }
  | { kind: 'delete_spot'; id: number }
  /** A Markups list's `clear`: `ids` is the whole list as it stood when it was asked. */
  | { kind: 'clear_measures'; ids: readonly number[] }
  | { kind: 'clear_spots'; ids: readonly number[] }
  /** The Filter card's × on a saved set. */
  | { kind: 'delete_filter_set'; id: number }
  /**
   * The Filter card's Save, when saving under `name` would **forget** a set that is already
   * saved — the one of that name, which a save replaces, or the oldest of twelve, which a new
   * one pushes out. `forgets` is those sets' ids: the click saves only while a save would still
   * forget exactly them. What is saved is the live filter at the click, as the card's Save saves.
   */
  | { kind: 'save_filter_set'; name: string; forgets: readonly number[] }
  /** A Recent pill. The path is the app's own, from main's recents list — never the model's. */
  | { kind: 'open_recent'; path: string }
  /** "copy link to this state": the view as it stands at the click. */
  | { kind: 'copy_link' }
  /** The property card's Copy, for one GlobalId or several, one per line. */
  | { kind: 'copy_guids'; text: string }
  // (`set_base_point`, the Coordinate-system card's four fields, was one until 2026-10-08, when
  // the owner made the card read-only: nothing in the app changes the base point any more.)

/**
 * The patch of a change the scope guard held: **visibility, and nothing else** — the six keys
 * of `PENDING_PATCH_KEYS` (`shared/undo.ts`), which are the ones the executors' patches carry.
 * It was `Partial<ShellState>`, so a patch could have named any key of the store — the
 * viewpoints, the saved filter sets, the base point — and `up()` would have set it. The type
 * says what a patch is; `applyPending` enforces it on the object, key by key.
 */
export type PendingPatch = Partial<Pick<ShellState, PendingPatchKey>>

/**
 * What waits behind the pending row's Apply button.
 *
 * Either a change the scope guard held back — the **patch**, not a label and a patch that have
 * drifted apart: `applyPending` passes it to `up()` (`SGVue.dc.html:1632`, `BUILD_PLAN.md` §6
 * pitfall 21), cut down to the keys a held change may write — or, since 2026-10-02, a gated
 * **action**. Never both.
 */
export type ChatPending =
  | { label: string; patch: PendingPatch; action?: undefined }
  | { label: string; action: PendingAction; patch?: undefined }

/**
 * One markup a tool call placed (2026-10-02, phase 4's follow-up): which of the Markups card's
 * two lists it joined, and **the record's own id** — the one the viewer gave it, read off the
 * list it grew. It is all an executor says about what it placed; the reply's `revert` takes
 * exactly these away again, in the store, through the removal the card's own × runs.
 */
export interface PlacedMarkup {
  kind: 'measure' | 'spot'
  id: number
}

export interface ToolUi {
  chips?: ChatChip[]
  table?: ChatTable
  pending?: ChatPending
  /** The turn changed the view, so it gets a ↺ revert and a pre-turn snapshot. */
  acted?: boolean
  /**
   * 2026-10-02 — the parts of the review state this call changed, **measured by the executor
   * itself** (`reviewState` before and after its own synchronous block). `executeTool` measures
   * around the whole call when this is absent, which is right for every executor that does not
   * wait; one that waits on something after it has changed the state (`set_interface`, asked to
   * open the Schedules window as well) hands its own measurement back, so that what the user
   * did during the wait is not counted as the reply's.
   */
  parts?: TurnPart[]
  /** A filter step was applied, so the next call in the same turn appends rather than replaces. */
  filtered?: boolean
  /** This call placed a markup: the new record, by its own id — what the reply's `revert` removes. */
  placed?: PlacedMarkup
  /**
   * 2026-10-02 — this call put a request in front of the user that is **not** the pending row: a
   * native dialog, the sidebar's "Unload …?" confirmation. What it is, in a few words — the
   * turn's one request is then taken (`waitingOn`).
   */
  asked?: string
}

export interface ToolOutcome {
  forModel: unknown
  ui?: ToolUi
}

/** The accumulators one turn collects, reset at its start. `SGVue.dc.html:1599`. */
export interface TurnState {
  chips: ChatChip[]
  table: ChatTable | null
  pending: ChatPending | null
  acted: boolean
  /**
   * 2026-10-02 — which parts of the review state this turn's **own tool calls** changed
   * (`state/selectors/snapshot.ts`, `TURN_PARTS`), measured around each call that said it acted
   * (`executeTool`). It is what the reply's `revert` puts back: a camera the user orbited by
   * hand while the reply was being written is not the reply's, and is not flown back.
   */
  parts: TurnPart[]
  filtered: boolean
  /**
   * 2026-10-02 — the markups this turn's own calls placed (`ToolUi.placed`), in the order they
   * were placed. A spot or a measurement is session view state the reply added, so its `revert`
   * takes them away again — these, by id, and no markup anyone else placed.
   */
  placed: PlacedMarkup[]
  /**
   * 2026-10-02 — what this turn has already asked the user to decide outside the pending row
   * (`ToolUi.asked`): the Open or Save dialog, the unload confirmation. `null` until it has.
   */
  asked: string | null
}

export const newTurnState = (): TurnState => ({
  chips: [],
  table: null,
  pending: null,
  acted: false,
  parts: [],
  filtered: false,
  placed: [],
  asked: null
})

/**
 * What this turn has already put in front of the user, in words — the pending row's label, or
 * the dialog or confirmation it raised — or `null`. **A turn asks for one thing** (2026-10-02):
 * twelve rounds must not be twelve dialogs, and a row with one Apply button must not stand for
 * two requests.
 */
export const waitingOn = (turn: Pick<TurnState, 'pending' | 'asked'>): string | null =>
  turn.pending?.label ?? turn.asked

/**
 * A second request in one turn, refused in words. Nothing was asked and nothing was changed;
 * the first keeps its row, its dialog or its confirmation.
 */
export const alreadyWaiting = (waiting: string): Record<string, unknown> => ({
  message:
    `A request is already waiting for the user’s own click from earlier in this turn (${waiting}). ` +
    'Only one can wait at a time, so this one was not made and nothing was changed. ' +
    'Tell the user what is waiting; once they have answered it they can ask for this one again.',
  applied: false,
  pending: false,
  alreadyWaiting: waiting
})

/**
 * A name as a pending label, or the result of a request, may carry it (2026-10-02, the gate's
 * review): control characters and the invisible direction and width marks out, clipped at `max`.
 * **Every name that goes into a label or a request's result comes through here.** It lives in
 * `shared/fmt.ts` since 2026-10-08, because the Coordinate-system card's note prints model names
 * through it too; every executor still takes it from here.
 */
export { labelText } from '../../../shared/fmt'

/**
 * A gated action, asked for: the pending row gets the label and the action, and the model is
 * told — in the same words every time — that nothing has happened and that it will not learn
 * whether anything does. The label names exactly what Apply will do, and holds no path.
 */
export function askApply(
  label: string,
  action: PendingAction,
  more: Record<string, unknown> = {}
): ToolOutcome {
  return {
    forModel: {
      message:
        `Asked, not done: ${label}. The user has been shown an Apply button under this reply, and nothing happens unless they click it. ` +
        'This turn is not told whether they do — so tell them what is waiting, and never say it was done.',
      applied: false,
      pending: true,
      ...more
    },
    ui: { pending: { label, action } }
  }
}

export interface ToolContext {
  /** Read fresh every time: a view tool's own `up()` changes what the next read should see. */
  state: () => ShellState
  sql: (sql: string) => Promise<SqlQueryResult>
  rawLine: (modelKey: string, expressId: number) => Promise<RawLine | null>
  turn: TurnState
  /**
   * 2026-10-01 — the thinking trace's ear: told each tool that is about to run, with its
   * **resolved** input (`executeTool`, after `resolveNames`), so the panel's live reply can say
   * what is being filtered and checked in the file's own spelling. Only a turn the panel is
   * showing has one; a dev harness's throwaway call does not.
   */
  trace?: (name: string, input: Readonly<Record<string, unknown>>) => void
}

/** The review state as the per-turn revert sees it — a handful of references, no copies. */
export const reviewState = (ctx: Pick<ToolContext, 'state'>): TurnSnapshot =>
  turnSnapshot(ctx.state(), getViewer()?.getCamera() ?? null)

export type Executor = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => ToolOutcome | Promise<ToolOutcome>

/* ────────────────────────────── shared helpers ────────────────────────────── */

/** Elements per federation-wide sample, and the cap every list in a result obeys. */
export const SAMPLE_CAP = 10
/** The design's own sample count in `query_elements`. `SGVue.dc.html:1447`. */
export const QUERY_SAMPLE_CAP = 5
/**
 * Chips under one reply — **six, and there is no second number**. `SGVue.dc.html:1610`.
 *
 * `applyUi` stops pushing at six and `chatFinish` slices to six again, so a tool that builds
 * more is building chips nobody will ever see. A `COLOR_CHIP_CAP = 8` used to sit beside this
 * claiming a larger cap for the colour legend; it was unreachable, and it is gone (2026-09-20).
 */
export const CHIP_CAP = 6
/**
 * How many values `color_by_property` names **in its own sentence** — the design's own
 * `groups.slice(0, 8)` (`SGVue.dc.html:1558`), which it uses for the sentence and for the chip
 * list alike. It is not a chip cap: six of those eight chips survive `CHIP_CAP`, here exactly
 * as in the design.
 */
export const COLOR_HEAD = 8
/**
 * Groups `color_by_property` reports **to the model**. The legend and the chips are built from
 * the whole scheme — the design caps nothing there — but the JSON crossing IPC was the
 * complete list, which on a real file's widest key is 1 306 groups and ~18 600 tokens
 * (2026-09-20). Fifty is `summarize_elements`'s own row cap, so the two agree.
 */
export const COLOR_GROUP_CAP = 50
/**
 * Values listed in a `valid_values` answer before it pages. The federation's `propKeys` is 197
 * entries on a real model and appeared in five separate miss paths at ~1 840 tokens each; the
 * first forty plus a total is enough to correct a guess. Since 2026-09-28 a property name that
 * is not a key is answered with its nearest keys instead (`names.ts`), and this cap is for the
 * other lists — entity names, filter-set names.
 */
export const VALID_VALUES_CAP = 40
/** Clash rows in one table. `SGVue.dc.html:1396`. */
export const CLASH_ROW_CAP = 25

/** `SGVue.dc.html:1269`'s `chatMatch`: no rule with a value matches nothing. */
export function chatMatch(
  elements: readonly FederatedElement[],
  rules: readonly Rule[] | undefined
): FederatedElement[] {
  const fn = matchFn(rules)
  return fn ? elements.filter(fn) : []
}

/** A short, stable identification of one element, for a sample list. */
export const brief = (
  e: FederatedElement
): { id: number; name: string; type: string; predefinedType: string; storey: string } => ({
  id: e.id,
  name: e.name,
  type: e.type,
  predefinedType: e.predefinedType,
  storey: e.storey
})

/** Trim a list to a cap and say so, rather than silently returning part of an answer. */
export function capped<T>(
  list: readonly T[],
  cap: number
): { items: T[]; total: number; truncated: boolean } {
  return { items: list.slice(0, cap), total: list.length, truncated: list.length > cap }
}

/**
 * One `valid_values` list: the first `VALID_VALUES_CAP` entries, the total, and whether it was
 * cut. The point of the list is to let a wrong guess be corrected in one round, and forty
 * spellings do that as well as two hundred.
 */
export function validValues(
  list: readonly string[]
): { values: string[]; total: number; truncated: boolean } {
  const { items, total, truncated } = capped(list, VALID_VALUES_CAP)
  return { values: items, total, truncated }
}

/**
 * The reply to a model key that is not loaded — four tools give it, in these exact words.
 * `key` is printed as given, `null` included (`get_spatial_tree` with nothing loaded).
 */
export const notLoaded = (key: string | null, loaded: readonly string[]): ToolOutcome => ({
  forModel: {
    message: `Not loaded: ${key}. Loaded: ${loaded.join(', ')}`,
    valid_values: [...loaded]
  }
})
