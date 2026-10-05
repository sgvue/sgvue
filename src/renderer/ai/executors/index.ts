/**
 * The executor registry, and the one door into it.
 *
 * `executeTool` is what the renderer's side of `ai:tool:exec` calls: it validates the
 * arguments again (`inputs.ts`), spells every name as the file does (`names.ts`), tells the
 * panel's thinking trace what is about to run — when the turn has one (`ToolContext.trace`,
 * 2026-10-01) — runs the executor, folds anything the panel needs into the turn's
 * accumulators, and hands back **only** `forModel` — the JSON that crosses IPC.
 *
 * Nothing else may reach a tool. `TOOL_EXECUTORS` is asserted against the catalogue in
 * `tests/unit/ai-tools.test.ts`, so a tool declared without an executor, or an executor with
 * no tool, fails the build rather than failing at the user.
 *
 * 2026-10-02 — **one held change per turn** (`oneHeld`). The scope guard holds a change back
 * as a pending patch behind the panel's Apply button, and a turn has one such slot. A second
 * held change in the same turn used to take the slot from the first — silently: the model had
 * been told each time that the user had an Apply button, and the user was shown only the last.
 * The second is now refused in words, and the first keeps the slot.
 *
 * The same day — **what a call changed is measured here** (`TurnState.parts`). The chat's
 * per-turn revert puts back the parts of the review state the reply changed, and "the reply"
 * has to mean its tool calls: a turn takes seconds, and the user orbits while they wait. So the
 * state is read before a call and — when the call says it acted — again after it, and the parts
 * that differ are the turn's. An executor that marks the turn runs synchronously, so nothing of
 * the user's can fall between the two reads — with one exception, which measures itself: the two
 * executors that wait on the Schedules window change nothing here and do not mark the turn, but
 * `set_interface` can be asked to open that window in the same call as another setting, and
 * then waits for it. It takes its own two reads around its synchronous block and hands the
 * result back as `ui.parts`, which is used instead of the measurement here.
 *
 * 2026-10-02, phase 3 — **one request per turn, of any kind.** A turn now asks the user for
 * things that are not a held visibility change: a gated action behind the same Apply button, a
 * native dialog, the sidebar's unload confirmation (`shared/tool-schemas.ts`, `ToolGate`). The
 * rule above covers all of them, in two places. A call the catalogue marks as gated is refused
 * **before its executor runs** when something is already waiting — a dialog must not be opened
 * to find out it was one too many. A change the scope guard holds is only known once the
 * executor has looked, so that one is still caught afterwards (`oneHeld`).
 */
import { TOOLS, gateOf } from '../../../shared/tool-schemas'
import { changedParts } from '../../state/selectors/snapshot'
import { parseToolInput } from './inputs'
import { INTERFACE_EXECUTORS } from './interface'
import { reportNames, resolveNames } from './names'
import { READ_EXECUTORS } from './read'
import { REQUEST_EXECUTORS } from './request'
import { SAVED_EXECUTORS } from './saved'
import { SCHEDULE_EXECUTORS } from './schedule'
import { VIEW_EXECUTORS } from './view'
import {
  CHIP_CAP,
  alreadyWaiting,
  reviewState,
  waitingOn,
  type Executor,
  type ToolContext,
  type ToolOutcome,
  type TurnState
} from './context'

export * from './context'
export { parseToolInput } from './inputs'

export const TOOL_EXECUTORS: Record<string, Executor> = {
  ...READ_EXECUTORS,
  ...VIEW_EXECUTORS,
  ...INTERFACE_EXECUTORS,
  ...SAVED_EXECUTORS,
  ...REQUEST_EXECUTORS,
  ...SCHEDULE_EXECUTORS
}

/** Every catalogue name that has no executor. Empty, and a test keeps it that way. */
export const missingExecutors = (): string[] =>
  TOOLS.filter((t) => !TOOL_EXECUTORS[t.name]).map((t) => t.name)

/** Every executor that is not a catalogue entry. Same rule, the other direction. */
export const strayExecutors = (): string[] =>
  Object.keys(TOOL_EXECUTORS).filter((name) => !TOOLS.some((t) => t.name === name))

/**
 * Run one tool. Throws only when the tool does not exist or its arguments do not parse; an
 * executor's own refusal (an unknown storey, a guarded SQL statement) is an ordinary result
 * with a `message` in it, because that is something the model can read and correct.
 */
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<unknown> {
  const executor = TOOL_EXECUTORS[name]
  if (!executor) throw new Error(`No tool named "${name}".`)
  // 2026-09-28: every property name and yes/no value is matched to the file's own spelling
  // here, once, before any executor sees it (`names.ts`) — so no tool can forget to.
  const names = resolveNames(parseToolInput(name, rawInput), ctx.state())
  // 2026-10-02, phase 3: a call that only asks the user is not made — no dialog, no
  // confirmation, no row — while this turn already has a request waiting.
  const waiting = gateOf(name, names.input) ? waitingOn(ctx.turn) : null
  if (waiting) return alreadyWaiting(waiting)
  // 2026-10-01: and the thinking trace hears of the call here — after the names are the
  // file's own, before the executor runs, so a slow tool is narrated while it works.
  ctx.trace?.(name, names.input)
  const before = reviewState(ctx)
  // 2026-10-02: a turn holds one change behind the Apply button; a second is refused here.
  const outcome: ToolOutcome = oneHeld(await executor(names.input, ctx), ctx.turn)
  applyUi(outcome, ctx)
  if (outcome.ui?.acted) {
    // The executor's own measurement where it took one (it waited on something afterwards).
    for (const part of outcome.ui.parts ?? changedParts(before, reviewState(ctx))) {
      if (!ctx.turn.parts.includes(part)) ctx.turn.parts.push(part)
    }
  }
  return reportNames(outcome.forModel, names, ctx.state())
}

/**
 * A second held change in one turn is refused, in words (2026-10-02).
 *
 * An executor that holds a change back has changed nothing — it returned before any store
 * action — so there is nothing to undo here: its "the user has an Apply button" is replaced
 * with what is true, and its pending entry is dropped. The first request keeps the slot and its
 * button. Whatever else the call handed the panel (chips, a table) is kept.
 *
 * Phase 3: "already waiting" is whatever this turn asked first — a held change, a gated action,
 * a dialog or the unload confirmation (`waitingOn`).
 */
export function oneHeld(outcome: ToolOutcome, turn: TurnState): ToolOutcome {
  const waiting = waitingOn(turn)
  if (!outcome.ui?.pending || !waiting) return outcome
  const { pending: _second, ...ui } = outcome.ui
  return { forModel: alreadyWaiting(waiting), ui }
}

/** Fold one call's UI into the turn. `SGVue.dc.html:1599` resets these; here they accumulate. */
export function applyUi(outcome: ToolOutcome, ctx: ToolContext): void {
  const ui = outcome.ui
  if (!ui) return
  if (ui.chips?.length) {
    for (const chip of ui.chips) {
      if (chip.ids.length && ctx.turn.chips.length < CHIP_CAP) ctx.turn.chips.push(chip)
    }
  }
  if (ui.table) ctx.turn.table = ui.table
  if (ui.pending) ctx.turn.pending = ui.pending
  if (ui.asked) ctx.turn.asked = ui.asked
  // A markup the call placed: what the reply's `revert` takes away again (`state/shell.ts`).
  if (ui.placed) ctx.turn.placed.push(ui.placed)
  if (ui.acted) ctx.turn.acted = true
  if (ui.filtered !== undefined) ctx.turn.filtered = ui.filtered
}
