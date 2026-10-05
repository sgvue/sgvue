/**
 * Who a view tool acts on — 2026-09-20, `docs/AI_REVIEW.md` §9 gap 1.
 *
 * Before this, every view tool took a rule list and nothing else, so `query_sql`, `search` and
 * `list_values` were read-only dead ends: the assistant could *find* a set and then had no way
 * to show it. A question whose answer is not re-expressible as a rule — "the walls with no
 * fire rating", "the 19 elements within 2 m of this one" — could be answered and not operated.
 *
 * Four ways to name a set, in one place so the tools that take them cannot drift:
 *
 *   · `rules`     — the design's, and still the one to prefer. A rule step is visible in the
 *                   Filter card, can be saved as a filter set, travels in a share link and is
 *                   re-evaluated when a model is added. An id list is none of those things.
 *   · `ids`       — a found set, capped at `MAX_TOOL_IDS` by `inputs.ts` before an executor
 *                   runs. Ids are **per session**: a model reloaded into another slot renumbers
 *                   them, so an id the federation does not carry is reported by count rather
 *                   than dropped in silence.
 *   · `selection` — whatever the user has selected now, which no rule can express.
 *   · `schedule`  — 2026-10-02, phase 4: the elements the schedule open in the Schedules window
 *                   lists. The user gets from a schedule's rows to the model through that
 *                   window's row menu; the assistant had no way to, short of re-deriving the
 *                   schedule as rules. **Not bounded by `MAX_TOOL_IDS`**: that cap is for ids
 *                   the model sends, and this set never travels through the model — the app
 *                   holds it, exactly as it holds `selection`, which has no cap either. So a
 *                   schedule of every wall in a real model is acted on whole, as the row menu
 *                   acts on it. (It was bounded, and an over-long one refused whole, until the
 *                   follow-up of the same day.) **Never through the port's `act` message**,
 *                   which is the row menu's and has no scope guard: the set is resolved here,
 *                   in this renderer, and the caller acts on it through the store's own actions,
 *                   exactly as for `ids` — so the 5 % guard, undo and the pending row apply.
 *
 * Nothing here touches the store. It answers *which elements*, and the caller does the acting
 * through the same store actions the right-click menu uses.
 */
import type { FederatedElement } from '../../../shared/federate'
import { scheduleElementIds } from '../../../schedule/assistant'
import { openSchedule, scheduleConnected, scheduleStore } from '../../model/schedule-link'
import type { ShellState } from '../../state/shell'
import { chatMatch } from './context'

/** Which way the set was named, for the sentence the model reads back. */
export type TargetSource = 'rules' | 'ids' | 'selection' | 'schedule' | 'none'

export interface Targets {
  source: TargetSource
  /** The elements that exist, in federation order for `rules` and as given for `ids`. */
  hit: FederatedElement[]
  /** Ids the federation does not carry — stale, or from another session. Counted, never hidden. */
  unknown: number[]
  /** How many ids were asked for, before the unknown ones were taken out. */
  asked: number
  /**
   * `schedule` only: why the open schedule names no set — there is no window, or it shows no
   * schedule. `hit` is then empty.
   */
  refused?: string
}

const SELECTION_FLAG = 'selection'
const SCHEDULE_FLAG = 'schedule'

/**
 * The open schedule's elements as a target. The engine runs here, over the assistant's own
 * store (`schedule-link.ts`, `scheduleStore`) and the definition the Schedules window last
 * reported — what `get_schedule` reads, so "what this schedule lists" is one thing.
 */
function scheduleTargets(s: ShellState): Targets {
  const none = (refused: string): Targets => ({ source: 'schedule', hit: [], unknown: [], asked: 0, refused })
  const open = openSchedule()
  if (!open) {
    return none(
      scheduleConnected()
        ? 'The Schedules window shows no schedule yet, so there are no schedule rows to act on'
        : 'No Schedules window is open, so there is no open schedule whose rows could be acted on'
    )
  }
  const { store, rowIds } = scheduleStore(s)
  // Every element it lists, however many: the set is the app's own, never the model's output.
  const ids = scheduleElementIds(store, open.def, rowIds)
  // The store is this federation's own snapshot, so every id it names is one the federation
  // has; one that somehow is not is counted like a stale id, never dropped in silence.
  const hit: FederatedElement[] = []
  const unknown: number[] = []
  for (const id of ids) {
    const el = s.byId.get(id)
    if (el) hit.push(el)
    else unknown.push(id)
  }
  return { source: 'schedule', hit, unknown, asked: ids.length }
}

/**
 * Resolve one call's target. Precedence is **ids, then selection, then the open schedule, then
 * rules** — the specific ones first, so a model that sends both a found set and the rules it
 * came from acts on the set it just found rather than on a re-derivation of it.
 */
export function resolveTargets(
  input: Record<string, unknown>,
  s: ShellState
): Targets {
  const raw = Array.isArray(input.ids) ? (input.ids as number[]) : null
  if (raw && raw.length) {
    const hit: FederatedElement[] = []
    const unknown: number[] = []
    const seen = new Set<number>()
    for (const id of raw) {
      if (seen.has(id)) continue
      seen.add(id)
      const el = s.byId.get(id)
      if (el) hit.push(el)
      else unknown.push(id)
    }
    // Distinct ids, so a repeated id cannot make "N of M" read as more than was asked.
    return { source: 'ids', hit, unknown, asked: seen.size }
  }
  if (input[SELECTION_FLAG] === true) {
    const hit = s.selIds.map((id) => s.byId.get(id)).filter(Boolean) as FederatedElement[]
    return { source: 'selection', hit, unknown: [], asked: s.selIds.length }
  }
  if (input[SCHEDULE_FLAG] === true) return scheduleTargets(s)
  const rules = Array.isArray(input.rules) ? input.rules : null
  if (rules && rules.length) {
    return { source: 'rules', hit: chatMatch(s.federation.elements, rules), unknown: [], asked: 0 }
  }
  return { source: 'none', hit: [], unknown: [], asked: 0 }
}

/** True when a call names a set some way other than by rules — by ids, the selection or the open schedule. */
export const namesSet = (input: Record<string, unknown>): boolean =>
  (Array.isArray(input.ids) && input.ids.length > 0) || input[SELECTION_FLAG] === true || input[SCHEDULE_FLAG] === true

/** The clause that reports stale ids — empty when every id was found. */
export const unknownText = (t: Targets): string =>
  t.unknown.length
    ? ` ${t.unknown.length} of the ${t.asked} ids given are not in the loaded federation and were left out`
    : ''

/** The same fact as structure, for the JSON beside the sentence. */
export const unknownFields = (t: Targets): Record<string, unknown> =>
  t.unknown.length ? { idsGiven: t.asked, idsUnknown: t.unknown.length } : {}

/** What an empty target should say, which depends on how the set was named. */
export const emptyTargetMessage = (t: Targets, verb: string): string => {
  if (t.source === 'ids') {
    return `None of the ${t.asked} ids given are in the loaded federation, so nothing was ${verb}. Element ids are per session — re-run the query that found them.`
  }
  if (t.source === 'selection') return `Nothing is selected, so nothing was ${verb}.`
  if (t.source === 'schedule') {
    return t.refused
      ? `${t.refused}. Nothing was ${verb}.`
      : `The open schedule lists no elements, so nothing was ${verb}.`
  }
  // Told nothing at all is not the same as told something that matched nothing.
  if (t.source === 'none') {
    return `No set was named, so nothing was ${verb}. Pass rules, or ids, or selection:true, or schedule:true.`
  }
  return `No elements match — nothing was ${verb}.`
}
