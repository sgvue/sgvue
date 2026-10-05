/**
 * The filter stack — `design-reference/design/SGVue.dc.html:949–974` (`newStep`, `curStep`,
 * `updStep`, `addStep`, `moveStep`, `dropStep`, `stepLabel`) and `:1659–1673` (the saved sets),
 * as pure functions over an array of steps.
 *
 * The design keeps these as methods that call `this.up(...)` themselves. Here each one returns
 * the **next stack** and the store does the single `up()`, so the stack arithmetic is testable
 * without a store, a viewer or a DOM — and so there is still exactly one place that snapshots
 * undo (`state/shell.ts`).
 *
 * The one rule that is easy to lose: **order matters.** `isolate L2 → hide windows` is not the
 * same view as `hide windows → isolate L2` for the *highlight* colours, and the design's own
 * comment says so (`:950`). Visibility itself is a conjunction (`rules.ts`), so the two orders
 * agree there; `applyColors` is where the order is visible, because a later step overwrites an
 * earlier one's colour.
 */
import { HL } from './colors'
import { isLiveRule, ruleText, type FilterStep, type Rule, type StepAction } from './rules'

export type { FilterStep, Rule, StepAction }

/** Saved filter sets are capped at twelve, oldest dropped. `SGVue.dc.html:1667`. */
export const FILTER_SETS_CAP = 12

/** One entry of the design's `filterSets`. `:1667`. */
export interface FilterSet {
  id: number
  label: string
  stack: readonly FilterStep[]
  /** Sets saved before the stack existed carry a flat rules/mode pair. `:1669–1671`. */
  mode?: StepAction
  rules?: readonly Rule[]
}

/** `SGVue.dc.html:953`. Kept behind a parameter so a test can make ids deterministic. */
export const makeStepId = (): string =>
  'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

/** The rule a new step starts with. `:955`. */
export const defaultRule = (): Rule => ({ prop: 'IfcEntity', op: '=', val: '', join: 'and' })

/**
 * The next unused highlight colour, or — once all six are taken — the palette walked round by
 * how many steps there are. `SGVue.dc.html:952–954`, verbatim including the modulo.
 */
export function nextColor(stack: readonly FilterStep[]): string {
  const used = stack.map((x) => x.color)
  return HL.find((c) => !used.includes(c)) ?? HL[used.length % HL.length]
}

/** `SGVue.dc.html:951`. */
export function newStep(
  stack: readonly FilterStep[],
  action: StepAction = 'isolate',
  rules?: readonly Rule[],
  color?: string,
  id: string = makeStepId()
): FilterStep {
  return {
    id,
    on: true,
    action,
    color: color || nextColor(stack),
    rules: rules ?? [defaultRule()]
  }
}

/** `SGVue.dc.html:957`. The selected step, else the first, else nothing. */
export function curStep(
  stack: readonly FilterStep[],
  stepSel: string | null
): FilterStep | null {
  return stack.find((x) => x.id === stepSel) ?? stack[0] ?? null
}

/** `SGVue.dc.html:958`. */
export function updStep(
  stack: readonly FilterStep[],
  id: string,
  patch: Partial<FilterStep>
): FilterStep[] {
  return stack.map((x) => (x.id === id ? { ...x, ...patch } : x))
}

/**
 * `SGVue.dc.html:960`. The ends do not wrap: a move that would leave the array returns the
 * **same array**, which is how the caller tells there is nothing to snapshot — the design
 * returns before reaching its own `this.up({ stack })`.
 */
export function moveStep(
  stack: readonly FilterStep[],
  id: string,
  d: number
): readonly FilterStep[] {
  const i = stack.findIndex((x) => x.id === id)
  const j = i + d
  if (i < 0 || j < 0 || j >= stack.length) return stack
  const st = [...stack]
  st.splice(j, 0, st.splice(i, 1)[0])
  return st
}

/** `SGVue.dc.html:966`. Removing a step selects the **last** one that is left. */
export function dropStep(
  stack: readonly FilterStep[],
  id: string
): { stack: FilterStep[]; stepSel: string | null } {
  const st = stack.filter((x) => x.id !== id)
  return { stack: st, stepSel: st.length ? st[st.length - 1].id : null }
}

/**
 * Whether any filter step is switched on — what makes the toolbar's Filter button read "on"
 * while its card is closed. Highlight steps count, and so does a step whose rules carry no
 * value yet: it is the same "is a step live" test the temporary-state banner uses (`:1967`).
 * `state/selectors/status.ts` carries the reasoning for the button itself.
 */
export const filterIsLive = (stack: readonly FilterStep[]): boolean => stack.some((x) => x.on)

/**
 * A rule counts once it carries a value — or is `absent`, which has none to carry.
 * `SGVue.dc.html:971`, `:937`, `:1664`.
 */
export const liveRules = (step: FilterStep): Rule[] => (step.rules ?? []).filter(isLiveRule)

/** `SGVue.dc.html:970`. */
export function stepLabel(step: FilterStep): string {
  const rs = liveRules(step)
  if (!rs.length) return 'no conditions'
  return rs
    .map((r, i) => (i ? ` ${r.join === 'or' ? 'or' : 'and'} ` : '') + ruleText(r))
    .join('')
}

/** `SGVue.dc.html:1666`. The first live step, then how many more there are. */
export function filterSetLabel(live: readonly FilterStep[]): string {
  return (
    `${live[0].action} ${stepLabel(live[0])}` +
    (live.length > 1 ? ` +${live.length - 1} step${live.length > 2 ? 's' : ''}` : '')
  )
}

/**
 * `SGVue.dc.html:1663–1668`. Only steps that carry a value are saved; a set with the same
 * label replaces the older one; the list keeps the **last** twelve.
 * Returns `null` when there is nothing to save, exactly as the design returns early.
 *
 * `label` is the one addition (2026-09-20): the card derives the label from the stack and
 * passes nothing, and `manage_filters` passes the name the user said out loud. Both take the
 * same two rules — same label replaces, last twelve kept — because they are the same action.
 */
export function saveFilterSet(
  sets: readonly FilterSet[],
  stack: readonly FilterStep[],
  now: number = Date.now(),
  label?: string
): FilterSet[] | null {
  const live = stack.filter((x) => liveRules(x).length > 0)
  if (!live.length) return null
  const name = label && label.trim() ? label.trim() : filterSetLabel(live)
  return [...sets.filter((f) => f.label !== name), { id: now, label: name, stack: live }].slice(
    -FILTER_SETS_CAP
  )
}

/**
 * The saved sets a save under `label` would **forget** (2026-10-02, the consent gate): the one
 * of the same name, which it replaces, or — with the list at its cap — the oldest, which a new
 * one pushes out. Empty when the save only adds, and when there is nothing to save.
 *
 * It is `saveFilterSet`'s own answer, by difference, so the two cannot disagree: a forgotten
 * set cannot be brought back, and the assistant's `save_set` is held behind the user's Apply
 * whenever this is not empty (`renderer/ai/executors/view.ts`). The card's own Save is the
 * user's click, and replaces as it always did.
 */
export function forgottenBySave(
  sets: readonly FilterSet[],
  stack: readonly FilterStep[],
  label?: string
): FilterSet[] {
  const next = saveFilterSet(sets, stack, 0, label)
  return next ? sets.filter((f) => !next.includes(f)) : []
}

/**
 * `SGVue.dc.html:1670–1673`. Every applied step is switched on and given a **fresh id and
 * colour**, so a set applied twice cannot collide with the stack it replaced.
 */
export function applyFilterSet(
  f: FilterSet,
  id: () => string = makeStepId
): { stack: FilterStep[]; stepSel: string | null } {
  const stack: FilterStep[] = []
  const source = f.stack ?? [{ action: f.mode ?? 'isolate', rules: f.rules } as Partial<FilterStep>]
  for (const x of source) {
    stack.push({ ...newStep(stack, x.action ?? 'isolate', x.rules, undefined, id()), on: true })
  }
  return { stack, stepSel: stack.length ? stack[stack.length - 1].id : null }
}
