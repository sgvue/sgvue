/**
 * The tools that change what is shown — `SGVue.dc.html:1400–1568`.
 *
 * Every one of them goes through the **store actions the buttons call**, which is the design's
 * own note at `:1214`: an AI action is indistinguishable from a manual one and lands on the
 * same undo stack. Nothing here writes state directly, so the scope guard, the per-turn
 * snapshot, the temporary-state frame and ⌘Z all keep working for free.
 *
 * The scope guard is the one place an action is held back. Its two halves are the design's:
 * a stack that would leave **nothing** visible is refused outright (`:1412`), and one that
 * would leave **under 5 %** becomes a pending patch with an Apply button (`:1464`) — except
 * for `highlight`, which changes no element's visibility and is therefore exempt.
 *
 * 2026-10-01: `set_section` acts on one of two independent cuts — `kind:"grid"` the gridline
 * cut, `kind:"level"` the level cut — and leaves the other alone; a `kind` with no name clears
 * just that cut, and `kind:null` clears both. And it **does what the user's click does** (the
 * owner: *"assistant should possess everything user can do on the app"*): setting a plane is
 * the chip's own patch — cutting, at the kind's default offset; the same kind and name again
 * changes only what the call passes, `cut` included; `cut:false` is the card's `cut` button
 * off; and the two clears are the card's `Clear` and `Clear all`.
 *
 * 2026-10-02 — **parity with the user, phase 1.** The same direction, applied to the reversible
 * view state the tools could not reach, and to the defects an audit of them found:
 *
 *   · `toggle_display` also switches the canvas grid, snap and original materials, and says
 *     "already" for every switch that was where it was asked to be — `dims` included, which
 *     used to say nothing. **A toggle is compared first and called only when it differs**, so
 *     every call is idempotent; that rule holds for each switch-like thing below too.
 *   · `select_elements` takes a `mode`: replace, add, remove (a Ctrl-click, for a set) and
 *     clear (Esc) — all through the store's one `select`.
 *   · `apply_visibility` takes `undo` and `redo`: the store's `step(back)`, asked first what it
 *     would leave visible (`peekHistory`) so that it is held to the scope guard.
 *   · `set_models` is the eye beside each model — one `up({ modelVis })`, the call
 *     `toggleModel` makes, so one request is one undo step — under the same guard.
 *   · `color_models` takes `null` for one key: the palette's own `reset`.
 *   · `activate_model` no longer leaves activate mode when handed the key that is already
 *     active (it answered "Activated X." while doing the opposite).
 *   · `manage_filters`' `enable` and `apply_set` are held to the scope guard — they were the
 *     two ways round it. `remove` and `move` are not checked, because they cannot hide:
 *     visibility is a conjunction of the enabled steps (`shared/rules.ts`), so taking a step
 *     away can only reveal and reordering changes nothing.
 *
 * 2026-10-02 — **phase 2: the camera, and one filter step in place.**
 *
 *   · `set_view` reaches what the user's own camera does: `fit` frames the building or the
 *     selection without turning (a double-click on empty space; F), `azimuth` / `elevation`
 *     turn it to any direction (the view cube's 26, and a drag), `zoom` is a factor on the fit.
 *     It goes through the store — `setView`, the two new actions `aimCamera` and `fitView`, and
 *     the persp / ortho button's own `toggleProj` — and no longer reaches into the viewer. A
 *     named view together with a direction is refused in words.
 *   · `manage_filters`' `update` changes one step where it stands — action, rules, highlight
 *     colour — through the Filter card's own `updStep`, `setStepRules` and `setStepColor`, so
 *     the step keeps its id and the rest of the stack its colours and its off switches. It runs
 *     the scope guard; an update that only reveals is exempt.
 *   · `set_filter_stack` takes a `color` per step: the card's swatch, chosen at once.
 *   · A view tool says `acted` exactly when it changed something the per-turn revert can put
 *     back — and since the revert now restores the camera, the display and the interface as well
 *     as what is visible (`state/selectors/snapshot.ts`), a camera move that moved nothing does
 *     not.
 *
 * 2026-10-02 — **phase 3: the consent gate.** The pending row can hold an action as well as a
 * patch (`context.ts`, `PendingAction`), so two things here stop being what they were:
 *
 *   · an `undo` or `redo` the scope guard catches is **held behind Apply** — it was refused in
 *     words, because a patch could not stand for a move through the history. The user's click
 *     takes the real step;
 *   · `manage_filters`' `delete_set` only **asks**. It forgot the set at once, unguarded, and a
 *     forgotten set cannot be brought back. Nothing in this file forgets one any more: the
 *     store's `applyPending` does, on the user's click. That includes `save_set`, which forgot
 *     one by replacing it or by pushing the oldest out: such a save is asked for too.
 */
import * as fstack from '../../../shared/filter-stack'
import {
  cameraBrief,
  displayState,
  groupLabel,
  ruleGroups,
  type CameraBrief,
  type DisplayState
} from '../../../shared/ai-schema'
import { visFn, type FilterStep, type Rule, type StepAction } from '../../../shared/rules'
import { NO_PLANE, sectionsLabel, type SecKind } from '../../../shared/sections'
import type { ColorByState } from '../../../shared/colors'
import { planePatch } from '../../state/selectors/section'
import { getViewer, peekHistory, restoredVis } from '../../state/shell'
import type { ShellState } from '../../state/shell'
import {
  CHIP_CAP,
  COLOR_GROUP_CAP,
  COLOR_HEAD,
  askApply,
  chatMatch,
  labelText,
  notLoaded,
  validValues,
  type Executor,
  type PendingPatch,
  type ToolContext,
  type ToolOutcome
} from './context'
import { emptyTargetMessage, namesSet, resolveTargets, unknownFields, unknownText } from './targets'
import { carriedInFederation, valueHints } from './names'

/** `SGVue.dc.html:1464` / `:1412`. Below this share of the model, a change waits for a click. */
export const SCOPE_GUARD = 0.05

/**
 * The scope guard's verdict — one rule for the three view paths (`set_filter_stack`, and
 * `apply_visibility` by rules and by ids). A change that would leave nothing visible is refused
 * outright, never offered as an Apply (`SGVue.dc.html:1412`); one that leaves under
 * `SCOPE_GUARD` of the model waits for the user's own Apply button. A mode that cannot hide
 * anything (`highlight`, `show`) is exempt from both, and the caller says so.
 */
export function scopeCheck(would: number, total: number, exempt = false): 'empty' | 'confirm' | 'ok' {
  if (exempt) return 'ok'
  if (!would) return 'empty'
  return would / total < SCOPE_GUARD ? 'confirm' : 'ok'
}

/** What both `apply_visibility` paths say when the guard holds a change back, word for word. */
const confirmText = (would: number, total: number): string =>
  `Needs confirmation: this would leave only ${would} of ${total} elements visible. The user has been shown an Apply button — tell them briefly what is waiting.`

const asRules = (v: unknown): Rule[] => (Array.isArray(v) ? (v as Rule[]) : [])

/** `SGVue.dc.html:1275`: each OR group's own count, so an empty category is visible. */
function groupCounts(s: ShellState, rules: readonly Rule[]): { label: string; n: number }[] {
  return ruleGroups(rules).map((g) => ({
    label: groupLabel(g),
    n: chatMatch(s.federation.elements, g).length
  }))
}

const visibleCount = (s: ShellState, stack: readonly FilterStep[]): number =>
  s.federation.elements.filter(visFn({ ...s, stack })).length

const chipFor = (label: string, ids: number[]): { label: string; ids: number[] }[] =>
  ids.length ? [{ label, ids }] : []

/**
 * A list the model itself sent, said back to it (2026-10-02): ten entries of at most sixty
 * characters, then a count. A key that is not loaded is the model's own text, and a result is
 * bounded whatever it was sent.
 */
const firstFew = (list: readonly string[], n = 10): string =>
  list
    .slice(0, n)
    .map((x) => (x.length > 60 ? x.slice(0, 60) + '…' : x))
    .join(', ') + (list.length > n ? `, … ${list.length - n} more` : '')

/* ────────────────────────────── set_filter_stack ────────────────────────────── */

export const set_filter_stack: Executor = (input, ctx) => {
  const s = ctx.state()
  const steps = Array.isArray(input.steps)
    ? (input.steps as { action?: StepAction; rules?: Rule[]; color?: string }[])
    : []
  if (!steps.length) {
    return { forModel: { message: 'No steps given. Pass at least one {action, rules}.' } }
  }
  /**
   * Each step is built against the stack **being assembled**, not against a snapshot of the
   * one that was live when the call began (2026-09-20).
   *
   * The design's `steps.map(x => this.newStep(...))` reads `this.state.stack` once per element,
   * so three highlight steps created in one call all found the same colours taken and all took
   * the same next one — which is exactly the defect `applyFilterSet` was fixed for on
   * 2026-09-18, one tool over. The seed is still the live stack, as the design has it; what is
   * new is that step 2 can see step 1.
   *
   * 2026-10-02: a step may name its own colour — one of the Filter card's swatches, which is
   * `newStep`'s own fourth argument — and a later step with none still takes the next one that
   * neither the stack nor an earlier step of this call is using.
   */
  const mk: FilterStep[] = []
  for (const x of steps) {
    mk.push(fstack.newStep([...s.stack, ...mk], x.action ?? 'isolate', x.rules ?? [], x.color))
  }
  const next = input.combine === 'append' ? [...s.stack, ...mk] : mk
  const per = next.map((x, i) => ({
    step: i + 1,
    action: x.action,
    label: fstack.stepLabel(x),
    matched: chatMatch(s.federation.elements, x.rules).length
  }))
  const perText = per.map((p) => `${p.step}. ${p.action} ${p.label} → ${p.matched} match`)
  const total = s.federation.elements.length
  const would = visibleCount(s, next)
  const empty = per.filter((p) => !p.matched)
  const scope = scopeCheck(would, total)
  // 2026-09-28: a step that matched nothing because of its value says what the key does carry.
  const hint = valueHints(
    next.filter((_, i) => !per[i].matched).flatMap((x) => x.rules),
    s
  )
  const hintFields = hint.topValues ? { valid_values: { topValues: hint.topValues } } : {}
  const hintText = hint.text ? ' ' + hint.text : ''

  if (scope === 'empty') {
    return {
      forModel: {
        message: `That stack would leave nothing visible, so it was not applied. ${perText.join('; ')}. Check which step matches nothing and fix its rules.${hintText}`,
        applied: false,
        wouldLeaveVisible: 0,
        totalElements: total,
        steps: per,
        ...hintFields
      }
    }
  }
  if (scope === 'confirm') {
    const label = `${next.length} filter step${next.length === 1 ? '' : 's'} — leaves ${would} of ${total} visible`
    return {
      forModel: {
        message: `Needs confirmation: leaves only ${would} of ${total} visible. ${perText.join('; ')}. The user has an Apply button.${hintText}`,
        applied: false,
        pending: true,
        wouldLeaveVisible: would,
        totalElements: total,
        steps: per,
        ...hintFields
      },
      ui: { pending: { label, patch: { stack: next, stepSel: next[next.length - 1].id } } }
    }
  }

  s.up({ stack: next, stepSel: next[next.length - 1].id })
  const after = ctx.state()
  const shown = after.federation.elements.filter(visFn(after))
  return {
    forModel: {
      message:
        `${next.length} step${next.length === 1 ? '' : 's'} applied, ${would} of ${total} visible. ${perText.join('; ')}.` +
        (empty.length ? ` Note: ${empty.length} step(s) matched nothing.${hintText}` : ''),
      applied: true,
      visibleElements: shown.length,
      totalElements: total,
      steps: per,
      ...hintFields
    },
    ui: {
      acted: true,
      filtered: true,
      chips: chipFor(`${would} visible`, shown.map((e) => e.id))
    }
  }
}

/* ────────────────────────────── manage_filters ────────────────────────────── */

/** A stack in words, for a refusal: twelve steps at most, each label clipped. */
const STACK_TEXT_STEPS = 12
const STACK_LABEL_CHARS = 120
function stackText(stack: readonly FilterStep[]): string {
  const head = stack.slice(0, STACK_TEXT_STEPS).map((x, i) => {
    const label = fstack.stepLabel(x)
    const short = label.length > STACK_LABEL_CHARS ? label.slice(0, STACK_LABEL_CHARS) + '…' : label
    return `${i + 1}. ${x.on ? '' : '(off) '}${x.action} — ${short}`
  })
  const more = stack.length - head.length
  return head.join('; ') + (more > 0 ? `; … ${more} more` : '')
}

/**
 * The scope guard for a stack `manage_filters` is about to write — 2026-10-02. `enable` and
 * `apply_set` wrote theirs unchecked, which made them the two ways round the guard: a step
 * could be switched on, or a saved set recalled, that left the view blank or nearly so with no
 * Apply button. They now run the rule the other view paths run (`scopeCheck`): nothing left
 * visible is refused, under 5 % waits for the user's click, and the pending entry is the
 * **patch** the store action would have handed `up()`.
 *
 * `exempt` is `scopeCheck`'s own third argument — a change that cannot hide anything: enabling
 * a `highlight` step (as in `apply_visibility`), and an `update` that takes nothing out of view.
 *
 * **`remove` and `move` do not come through here at all.** `visFn` is a conjunction of the
 * enabled isolate / hide steps, so taking a step away can only reveal more and changing their
 * order changes nothing; `tests/unit/ai-parity.test.ts` proves both over every stack of three it
 * can build, 216 of them. Until phase 2 they were passed in with `exempt = true`, which could
 * only ever answer "go ahead". `disable` and `clear` can only reveal too.
 *
 * `null` means "go ahead"; anything else is the outcome to return.
 */
function guardStack(
  s: ShellState,
  patch: { stack: readonly FilterStep[]; stepSel?: string | null },
  what: string,
  exempt: boolean
): ToolOutcome | null {
  const total = s.federation.elements.length
  // Not counted where it cannot matter: an exempt change is `ok` whatever it leaves.
  const would = exempt ? total : visibleCount(s, patch.stack)
  const scope = scopeCheck(would, total, exempt)
  if (scope === 'ok') return null
  const What = what.charAt(0).toUpperCase() + what.slice(1)
  if (scope === 'empty') {
    return {
      forModel: {
        message: `${What} would leave nothing visible, so it was not done. The stack it would make: ${stackText(patch.stack)}.`,
        applied: false,
        wouldLeaveVisible: 0,
        totalElements: total
      }
    }
  }
  return {
    forModel: {
      message: confirmText(would, total),
      applied: false,
      pending: true,
      wouldLeaveVisible: would,
      totalElements: total
    },
    ui: { pending: { label: `${what} — leaves ${would} of ${total} visible`, patch } }
  }
}

export const manage_filters: Executor = (input, ctx) => {
  const s = ctx.state()
  const st = s.stack
  const listed = (): { step: number; enabled: boolean; action: string; label: string }[] =>
    st.map((x, i) => ({ step: i + 1, enabled: x.on, action: x.action, label: fstack.stepLabel(x) }))
  const listText = (): string =>
    st.length
      ? st.map((x, i) => `${i + 1}. ${x.on ? '' : '(off) '}${x.action} — ${fstack.stepLabel(x)}`).join('; ')
      : 'The filter stack is empty.'

  const op = String(input.op ?? '')
  if (op === 'list') return { forModel: { message: listText(), steps: listed() } }
  if (op === 'clear') {
    s.up({ stack: [], stepSel: null })
    return { forModel: { message: 'Filter stack cleared.', steps: [] }, ui: { acted: true } }
  }
  if (op === 'save_set' || op === 'apply_set' || op === 'delete_set' || op === 'list_sets') {
    return filterSets(op, input, ctx)
  }

  const stepNumber = typeof input.step === 'number' ? input.step : 0
  const i = stepNumber - 1
  const x = st[i]
  if (!x) {
    return { forModel: { message: `No step ${input.step}. ${listText()}`, steps: listed() } }
  }
  if (op === 'enable' || op === 'disable') {
    const on = op === 'enable'
    // The step's own on / off switch: compared first, so a repeat is not a second undo entry.
    if (x.on === on) {
      return {
        forModel: { message: `Step ${stepNumber} is already ${op}d — nothing changed.`, steps: listed() }
      }
    }
    // Switching a step on can hide; switching one off can only reveal.
    if (on) {
      const held = guardStack(
        s,
        { stack: fstack.updStep(st, x.id, { on: true }) },
        `enabling step ${stepNumber}`,
        x.action === 'highlight'
      )
      if (held) return held
    }
    s.updStep(x.id, { on })
    return { forModel: { message: `Step ${stepNumber} ${op}d.` }, ui: { acted: true } }
  }
  if (op === 'remove') {
    // Not guarded: removing a step can only reveal (the 216-stack test in `ai-parity.test.ts`).
    s.dropStep(x.id)
    return {
      forModel: { message: `Step ${stepNumber} removed. ${ctx.state().stack.length} left.` },
      ui: { acted: true }
    }
  }
  if (op === 'update') return updateStep(x, stepNumber, input, ctx)
  const to = typeof input.to === 'number' ? input.to : 0
  const j = to - 1
  if (j < 0 || j >= st.length) {
    return { forModel: { message: `Target must be between 1 and ${st.length}.`, steps: listed() } }
  }
  // A step moved to where it stands is no move: the store's own `moveStep` would write the same
  // order again and push an undo entry for it.
  if (j === i) {
    return {
      forModel: {
        message: `Step ${stepNumber} is already at position ${to} — nothing changed.`,
        steps: listed()
      }
    }
  }
  // Not guarded: the order of the steps does not change what is visible (the same test).
  s.moveStep(x.id, j - i)
  return { forModel: { message: `Step ${stepNumber} moved to position ${to}.` }, ui: { acted: true } }
}

/**
 * `manage_filters`' `update` — 2026-10-02: one step changed where it stands.
 *
 * The user changes a step's action with the card's three buttons, its rules in the rule builder
 * and its highlight colour with a swatch; the assistant could only rebuild the whole stack,
 * which mints new step ids, hands out fresh colours and switches every step back on. This goes
 * through the card's own actions — `updStep` (or `setStepRules`, which is `updStep` with the
 * rules) and `setStepColor` — so the step keeps its id and its place, and no other step is
 * touched. A call that changes the colour as well as the action or the rules is two undo
 * entries, as the two clicks are.
 *
 * It is compared first, like every switch: a field already as asked is left alone, and a call
 * that changes nothing writes nothing. And it is guarded like every change that can hide — the
 * rules of an isolate step narrowed, a highlight turned into an isolate: nothing left visible is
 * refused, under 5 % waits for the user's Apply with the stack it would write. An update that
 * takes nothing out of view — a colour, a step that is switched off, an action made `highlight`
 * — is exempt, as an undo that only reveals is.
 */
function updateStep(
  x: FilterStep,
  n: number,
  input: Record<string, unknown>,
  ctx: ToolContext
): ToolOutcome {
  const s = ctx.state()
  const action = typeof input.action === 'string' ? (input.action as StepAction) : undefined
  const rules = Array.isArray(input.rules) ? (input.rules as Rule[]) : undefined
  const color = typeof input.color === 'string' ? input.color : undefined
  if (action === undefined && rules === undefined && color === undefined) {
    return {
      forModel: {
        message: `Nothing to update: pass action, rules or color for step ${n}. Nothing changed.`,
        applied: false
      }
    }
  }

  const patch: Partial<FilterStep> = {}
  if (action !== undefined && action !== x.action) patch.action = action
  if (rules !== undefined && JSON.stringify(rules) !== JSON.stringify(x.rules)) patch.rules = rules
  if (color !== undefined && color !== x.color) patch.color = color
  if (!Object.keys(patch).length) {
    return {
      forModel: {
        message: `Step ${n} is already as asked — nothing changed.`,
        applied: false,
        ...stepReport(s, x, n)
      }
    }
  }

  const next = fstack.updStep(s.stack, x.id, patch)
  const shownNow = visFn(s)
  const shownNext = visFn({ ...s, stack: next })
  const hides = s.federation.elements.some((e) => shownNow(e) && !shownNext(e))
  const held = guardStack(s, { stack: next }, `updating step ${n}`, !hides)
  if (held) return held

  if (patch.action !== undefined) {
    s.updStep(x.id, { action: patch.action, ...(patch.rules ? { rules: patch.rules } : {}) })
  } else if (patch.rules) s.setStepRules(x.id, patch.rules)
  if (patch.color) ctx.state().setStepColor(x.id, patch.color)

  const after = ctx.state()
  const now = after.stack.find((y) => y.id === x.id) ?? x
  const total = after.federation.elements.length
  const shown = after.federation.elements.filter(visFn(after)).length
  const report = stepReport(after, now, n)
  const said = [
    patch.action !== undefined ? `action ${x.action} → ${now.action}` : '',
    patch.rules ? `rules now ${report.label}` : '',
    patch.color ? `colour ${now.color}` : ''
  ].filter(Boolean)
  // A step whose new rules match nothing says what its key does carry, as a new stack does.
  const hint = patch.rules && !report.matched ? valueHints(now.rules, after) : { text: '' }
  return {
    forModel: {
      message:
        `Step ${n} updated: ${said.join(', ')}. ${shown} of ${total} visible.` +
        (now.on ? '' : ' The step is switched off, so nothing on screen changed.') +
        (patch.color && now.action !== 'highlight' ? ' A colour shows only on a highlight step.' : '') +
        (hint.text ? ` ${hint.text}` : ''),
      applied: true,
      ...report,
      visibleElements: shown,
      totalElements: total,
      ...(hint.topValues ? { valid_values: { topValues: hint.topValues } } : {})
    },
    ui: { acted: true }
  }
}

/**
 * One step as `update` reads it back: what it is now — its label clipped, its colour while it
 * is a highlight step — and how many elements its rules match.
 */
function stepReport(
  s: ShellState,
  x: FilterStep,
  n: number
): { step: number; enabled: boolean; action: string; label: string; color?: string; matched: number } {
  const label = fstack.stepLabel(x)
  return {
    step: n,
    enabled: x.on,
    action: x.action,
    label: label.length > STACK_LABEL_CHARS ? label.slice(0, STACK_LABEL_CHARS) + '…' : label,
    ...(x.action === 'highlight' && x.color ? { color: x.color } : {}),
    matched: chatMatch(s.federation.elements, x.rules).length
  }
}

/* ────────────────────────────── the named filter sets ────────────────────────────── */

/**
 * Save, recall, forget and list the designed card's own filter sets, by name — 2026-09-20,
 * `docs/AI_REVIEW.md` §9 gap 8 and workflow W7.
 *
 * Saving and recalling go through the store action the Filter card's own control calls, so
 * the cap of twelve, the "a set with the same name replaces the older one" rule and the
 * `localStorage` write are the card's, not a second implementation. What it persists is a list
 * of **rules** scoped to a building — no element ids, no file path, and nothing whatever from
 * the model, which this app cannot write in any case.
 *
 * **Forgetting one is asked for, not done** (2026-10-02, phase 3): `delete_set` puts the
 * request behind the reply's Apply button, and the card's own action runs on the user's click.
 * **So is a save that would forget one** — under a name already in use, or as a thirteenth set
 * (`forgottenBySave`): the card's two rules still hold, on the user's click. A save that only
 * adds is done at once.
 */
/** A filter set's name as a pending label, or a request's result, shows it. */
const SET_NAME_CHARS = 60

function filterSets(
  op: string,
  input: Record<string, unknown>,
  ctx: { state: () => ShellState }
): ToolOutcome {
  const s = ctx.state()
  const sets = s.filterSets
  const names = sets.map((f) => f.label)
  const asked = typeof input.name === 'string' ? input.name.trim() : ''
  const listSets = (): { name: string; steps: number }[] =>
    ctx.state().filterSets.map((f) => ({ name: f.label, steps: (f.stack ?? []).length }))
  /** The same list as a request's result carries it: each name through `labelText`. */
  const shownSets = (): { name: string; steps: number }[] =>
    listSets().map((x) => ({ ...x, name: labelText(x.name, SET_NAME_CHARS) }))
  const namesText = (): string =>
    names.length ? names.map((n) => `"${n}"`).join(', ') : 'There are no saved filter sets.'

  if (op === 'list_sets') {
    return {
      forModel: {
        message: names.length
          ? `${names.length} saved filter set${names.length === 1 ? '' : 's'}: ${namesText()}`
          : namesText(),
        sets: listSets()
      }
    }
  }

  if (!asked) {
    return { forModel: { message: `Pass the set's name. ${namesText()}`, sets: listSets() } }
  }

  if (op === 'save_set') {
    const live = s.stack.filter((x) => fstack.liveRules(x).length > 0)
    if (!live.length) {
      return {
        forModel: {
          message:
            'There is nothing to save — no filter step carries a condition yet. Build the stack first, then save it.',
          saved: false
        }
      }
    }
    // 2026-10-02, phase 3 — **a save can forget.** The card's rule is that a set of the same
    // name is replaced and that twelve are kept, so a save under a name already in use, or a
    // thirteenth set, takes one away — and a forgotten set cannot be brought back. That is
    // `delete_set` by another road, so it waits behind the same Apply button. A save that only
    // adds is done here, as it always was.
    const forgotten = fstack.forgottenBySave(sets, s.stack, asked)
    if (forgotten.length) {
      const short = (text: string): string => labelText(text, SET_NAME_CHARS)
      const stepsOf = (f: fstack.FilterSet): string => {
        const n = (f.stack ?? []).length
        return `${n} step${n === 1 ? '' : 's'}`
      }
      const said = `save the live filter as "${short(asked)}"`
      const label = forgotten.every((f) => f.label === asked)
        ? forgotten.length === 1
          ? `${said} — it replaces the saved set of that name (${stepsOf(forgotten[0])}), which cannot be brought back`
          : `${said} — it replaces the ${forgotten.length} saved sets of that name, which cannot be brought back`
        : `${said} — only ${fstack.FILTER_SETS_CAP} are kept, so ${forgotten
            .map((f) => `"${short(f.label)}" (${stepsOf(f)})`)
            .join(' and ')} would be forgotten, and cannot be brought back`
      return askApply(
        label,
        { kind: 'save_filter_set', name: asked, forgets: forgotten.map((f) => f.id) },
        {
          saved: false,
          name: short(asked),
          steps: live.length,
          wouldForget: forgotten.map((f) => short(f.label)),
          sets: shownSets()
        }
      )
    }
    s.saveFilterSet(asked)
    return {
      forModel: {
        message: `Saved ${live.length} step${live.length === 1 ? '' : 's'} as "${asked}".`,
        saved: true,
        name: asked,
        steps: live.length,
        sets: listSets()
      },
      // Saving changes nothing about what is on screen, so there is nothing to revert.
      ui: {}
    }
  }

  // Exact first, then case-insensitively — a name said out loud is rarely capitalised the
  // way it was typed, and a wrong guess should not cost a round.
  const found =
    sets.find((f) => f.label === asked) ??
    sets.find((f) => f.label.toLowerCase() === asked.toLowerCase())
  if (!found) {
    return {
      forModel: {
        message: `No filter set called "${asked}". ${namesText()}`,
        valid_values: validValues(names)
      }
    }
  }

  const name = labelText(found.label, SET_NAME_CHARS)

  if (op === 'delete_set') {
    // 2026-10-02, phase 3: asked for, never done here — a forgotten set cannot be brought back.
    // The set is named by its own id, so the click forgets this one and no other.
    const steps = (found.stack ?? []).length
    return askApply(
      `forget the filter set "${name}" (${steps} step${steps === 1 ? '' : 's'}) — it cannot be brought back`,
      { kind: 'delete_filter_set', id: found.id },
      { name, sets: shownSets() }
    )
  }

  // 2026-10-02: a recalled set is a whole new stack, so it is held to the scope guard like one —
  // on the patch `applyFilterSet` would hand `up()`. (Its step ids are minted per call, so the
  // stack the action writes below is this one with other ids, and the same view.)
  const held = guardStack(s, fstack.applyFilterSet(found), `applying the filter set "${name}"`, false)
  if (held) {
    return { ...held, forModel: { ...(held.forModel as Record<string, unknown>), name } }
  }
  s.applyFilterSet(found)
  const after = ctx.state()
  const shown = after.federation.elements.filter(visFn(after))
  return {
    forModel: {
      message: `Applied "${found.label}" — ${after.stack.length} step${after.stack.length === 1 ? '' : 's'}, ${shown.length} of ${after.federation.elements.length} visible.`,
      applied: true,
      name: found.label,
      steps: after.stack.length,
      visibleElements: shown.length,
      totalElements: after.federation.elements.length
    },
    ui: { acted: true, filtered: true, chips: chipFor(`${shown.length} visible`, shown.map((e) => e.id)) }
  }
}

/* ────────────────────────────── apply_visibility ────────────────────────────── */

/**
 * `apply_visibility`'s `undo` and `redo` — 2026-10-02: the action bar's two buttons, through
 * the store's own `step(back)`, so the redo branch, the 50-deep cap and the pickability that
 * follows `active` are the store's and not a second implementation.
 *
 * A step can hide — undoing a "show all" brings an isolate back — so it is held to the scope
 * guard like every other change that can: `peekHistory` reads what the step would restore
 * **before** it is taken. A step that takes something out of view and would leave nothing
 * visible, or under 5 %, is **held behind the Apply button** (phase 3 — until the pending row
 * could hold an action it was refused in words, because that button applied a patch through
 * `up()`, a new change on top of the history, and an undo is a move *through* it). The entry it
 * would restore travels with the request, so the click takes this step or none: if the history
 * has moved on by then, nothing is undone. A view left with nothing in it is held like one left
 * with little — it is a state the user made, and stepping back to it is theirs to decide. A
 * step that only brings elements back is exempt, as `show` is.
 */
function stepHistory(back: boolean, ctx: ToolContext): ToolOutcome {
  const s = ctx.state()
  const word = back ? 'undo' : 'redo'
  const was = { canUndo: s.canUndo, canRedo: s.canRedo }
  const snap = peekHistory(back)
  if (!snap) {
    return {
      forModel: {
        message: `Nothing to ${word} — nothing changed.`,
        applied: false,
        action: word,
        history: was
      }
    }
  }

  const total = s.federation.elements.length
  const shownNow = visFn(s)
  const shownNext = visFn({ ...s, ...restoredVis(snap, s.loaded) })
  let before = 0
  let would = 0
  /** Does the step take anything out of view? One that only reveals is exempt, as `show` is. */
  let hides = false
  for (const e of s.federation.elements) {
    const isShown = shownNow(e)
    if (isShown) before++
    if (shownNext(e)) would++
    else if (isShown) hides = true
  }
  const scope = scopeCheck(would, total, !hides)
  if (scope !== 'ok') {
    return {
      forModel: {
        message: confirmText(would, total),
        applied: false,
        pending: true,
        action: word,
        wouldLeaveVisible: would,
        totalElements: total,
        history: was
      },
      ui: {
        pending: {
          label: `${word} one change — leaves ${would} of ${total} visible`,
          action: { kind: word, snap }
        }
      }
    }
  }

  s.step(back)
  const after = ctx.state()
  const shown = after.federation.elements.filter(visFn(after)).length
  const now = { canUndo: after.canUndo, canRedo: after.canRedo }
  return {
    forModel: {
      message:
        `${back ? 'Undid' : 'Redid'} one change — ${shown} of ${total} visible (was ${before}).` +
        (now.canUndo ? '' : ' Nothing further to undo.') +
        (now.canRedo ? '' : ' Nothing further to redo.'),
      applied: true,
      action: word,
      visibleElements: shown,
      visibleBefore: before,
      totalElements: total,
      historyBefore: was,
      history: now
    },
    ui: { acted: true }
  }
}

export const apply_visibility: Executor = (input, ctx) => {
  const s = ctx.state()
  const action = input.action as StepAction | 'show' | 'reset' | 'undo' | 'redo' | undefined

  if (action === 'reset') {
    s.showAll()
    return {
      forModel: { message: 'All elements visible again.', applied: true },
      ui: { acted: true, filtered: false }
    }
  }

  // The action bar's Undo and Redo (2026-10-02). They take nothing else: no rules, no ids.
  if (action === 'undo' || action === 'redo') return stepHistory(action === 'undo', ctx)

  // A found set, or the selection, rather than a rule (2026-09-20). It is a different route
  // through the store — the right-click menu's `hidden` map, not a filter step — so it is a
  // branch of its own rather than a rule list nobody could have written. An **empty** `ids`
  // names nothing, so it falls through to whatever else the call carried rather than turning
  // a rule list into an id action. (2026-10-02, phase 4: or the open schedule's rows,
  // `schedule:true` — resolved here to ids and acted on by the same actions, guard included.)
  if (namesSet(input)) return visibilityByIds(input, ctx)

  if (action === 'show') {
    return {
      forModel: {
        message:
          '"show" needs the elements named — pass ids or selection:true. To bring everything back use action:"reset"; to narrow a view by rule use isolate or hide.'
      }
    }
  }

  const live = s.stack.filter((x) => x.on)
  // "add" appends a step; "replace" starts a fresh stack. A repeat call inside one request is
  // almost always another category, so it appends rather than discarding the first.
  const add = input.combine === 'append' || ctx.turn.filtered
  const rs = asRules(input.rules)
  const last = live[live.length - 1]
  const mode: StepAction = action ?? last?.action ?? 'isolate'
  const hit = chatMatch(s.federation.elements, rs)
  const per = groupCounts(s, rs)
  const perText = per.map((g) => `${g.label}: ${g.n}`).join(', ')

  if (!hit.length) {
    // 2026-09-28: the key's own values, not the first forty keys; an unknown name gets its
    // nearest keys from `executeTool` (`names.ts`).
    const hint = valueHints(rs, s)
    return {
      forModel: {
        message: `No elements match — nothing changed. Per group: ${perText}${hint.text ? '. ' + hint.text : ''}`,
        applied: false,
        matched: 0,
        groups: per,
        ...(hint.topValues ? { valid_values: { topValues: hint.topValues } } : {})
      }
    }
  }

  const total = s.federation.elements.length
  const step = fstack.newStep(s.stack, mode, rs)
  const nextStack = add ? [...s.stack, step] : [step]
  const would = visibleCount(s, nextStack)
  const scope = scopeCheck(would, total, mode === 'highlight')

  /**
   * A change that would leave **nothing** visible is refused outright, never offered as a
   * pending Apply (2026-09-20).
   *
   * `set_filter_stack` above has always done this (`SGVue.dc.html:1412`) and
   * `SYSTEM_SPEC.md` §8.7 states it as the rule; `apply_visibility` fell through to the 5 %
   * branch instead, so appending a second `isolate` — which is what "also show the plates"
   * produces, because two isolates AND — put an Apply button under a patch labelled *"leaves
   * 0 of 26 761 visible"*. `highlight` is exempt for the same reason it is exempt below: it
   * changes no element's visibility, so a zero here is the view's, not the step's.
   */
  if (scope === 'empty') {
    return {
      forModel: {
        message:
          `That would leave nothing visible, so it was not applied. ${hit.length} elements match — ` +
          `${perText}${add ? ` — but appended to ${s.stack.filter((x) => x.on).length} live step(s) it narrows to nothing` : ''}. ` +
          'Check the rules, or pass combine:"replace" to start a fresh stack.',
        applied: false,
        matched: hit.length,
        wouldLeaveVisible: 0,
        totalElements: total,
        appended: add,
        groups: per
      }
    }
  }

  if (scope === 'confirm') {
    return {
      forModel: {
        message: confirmText(would, total),
        applied: false,
        pending: true,
        matched: hit.length,
        wouldLeaveVisible: would,
        totalElements: total,
        groups: per
      },
      ui: {
        pending: {
          label: `${mode} ${hit.length} elements — leaves ${would} of ${total} visible`,
          patch: { stack: nextStack, stepSel: step.id }
        }
      }
    }
  }

  // Deliberately does NOT open the filter card: the reply, the chip and the viewport frame
  // already report the outcome, and the card would collide with the panel that requested it.
  s.up({ stack: nextStack, stepSel: step.id })
  const after = ctx.state()
  const shown = after.federation.elements.filter(visFn(after)).length
  const empty = per.filter((g) => !g.n)
  return {
    forModel: {
      message:
        `step ${nextStack.length} ${mode}${add ? ' (appended)' : ' (new stack)'}: ${hit.length} elements match, ${shown} visible. Groups — ${perText}.` +
        (empty.length ? ` Note: ${empty.map((g) => g.label).join(' and ')} matched nothing.` : ''),
      applied: true,
      step: nextStack.length,
      action: mode,
      appended: add,
      matched: hit.length,
      visibleElements: shown,
      totalElements: total,
      groups: per
    },
    ui: { acted: true, filtered: true, chips: chipFor(`${hit.length} elements`, hit.map((e) => e.id)) }
  }
}

/* ────────────────────────────── visibility by id ────────────────────────────── */

/**
 * The patch the store's `hide` / `isolate` / `show` actions write (`state/shell.ts`), as a pure
 * function — because the 5 % scope guard has to know what a change *would* do before it is
 * made, and `applyPending` hands `pending.patch` straight to `up()`.
 *
 * `visibilityByIds` builds it, guards on it, and then calls the **store action itself** on the
 * path that goes through; the patch is only ever handed to the pending entry.
 * `tests/unit/ai-executors.test.ts` drives both and asserts they leave the same state, so the
 * two cannot drift.
 */
export function visPatch(
  s: Pick<ShellState, 'hidden' | 'federation'>,
  mode: 'hide' | 'isolate' | 'show',
  ids: readonly number[]
): PendingPatch {
  if (mode === 'isolate') {
    const keep = new Set(ids)
    const hidden: Record<number, boolean> = {}
    for (const e of s.federation.elements) if (!keep.has(e.id)) hidden[e.id] = true
    return { hidden, storeyVis: {}, ctx: null }
  }
  const hidden = { ...s.hidden }
  if (mode === 'hide') for (const id of ids) hidden[id] = true
  else for (const id of ids) delete hidden[id]
  return { hidden, ctx: null }
}

function visibilityByIds(input: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const s = ctx.state()
  const mode = (input.action as string | undefined) ?? 'isolate'
  if (mode !== 'hide' && mode !== 'isolate' && mode !== 'show') {
    return {
      forModel: {
        message:
          `An id list can be hidden, isolated or shown — "${mode}" cannot act on one. A highlight tints a matched set and has to be written as rules, so use set_filter_stack with a highlight step.`
      }
    }
  }
  const past = { hide: 'hidden', isolate: 'isolated', show: 'shown' } as const
  const t = resolveTargets(input, s)
  if (!t.hit.length) {
    return {
      forModel: {
        message: emptyTargetMessage(t, past[mode]),
        applied: false,
        target: t.source,
        matched: 0,
        ...unknownFields(t)
      }
    }
  }

  const ids = t.hit.map((e) => e.id)
  const total = s.federation.elements.length
  const patch = visPatch(s, mode, ids)
  const would = s.federation.elements.filter(visFn({ ...s, ...patch } as ShellState)).length
  const how =
    t.source === 'selection'
      ? 'the selection'
      : t.source === 'schedule'
        ? `the ${ids.length} elements the open schedule lists`
        : `${ids.length} elements`
  const tail = unknownText(t)
  const scope = scopeCheck(would, total, mode === 'show')

  // The same two halves as the rule path, and for the same reason: a view with nothing in it
  // is refused outright, and one under 5 % waits for the user's own Apply button. `show` is
  // exempt from both — it can only ever reveal more.
  if (scope === 'empty') {
    // What there is to check depends on what named the set: ids were sent, while a selection or
    // a schedule's rows are the app's own — there are no ids to look at.
    const check =
      t.source === 'selection'
        ? 'the selection'
        : t.source === 'schedule'
          ? 'what the open schedule lists'
          : 'the ids'
    return {
      forModel: {
        message: `That would leave nothing visible, so it was not applied.${tail ? tail + '.' : ''} Check ${check}, or use action:"reset" to start from the whole model.`,
        applied: false,
        target: t.source,
        matched: ids.length,
        wouldLeaveVisible: 0,
        totalElements: total,
        ...unknownFields(t)
      }
    }
  }
  if (scope === 'confirm') {
    return {
      forModel: {
        message: confirmText(would, total) + tail,
        applied: false,
        pending: true,
        target: t.source,
        matched: ids.length,
        wouldLeaveVisible: would,
        totalElements: total,
        ...unknownFields(t)
      },
      ui: { pending: { label: `${mode} ${how} — leaves ${would} of ${total} visible`, patch } }
    }
  }

  // The right-click menu's own actions, so this lands on the same undo stack.
  if (mode === 'hide') s.hide(ids)
  else if (mode === 'isolate') s.isolate(ids)
  else s.show(ids)

  const after = ctx.state()
  const shown = after.federation.elements.filter(visFn(after)).length
  return {
    forModel: {
      message: `${mode === 'show' ? 'Showed' : mode === 'hide' ? 'Hid' : 'Isolated'} ${how} — ${shown} of ${total} visible.${tail}`,
      applied: true,
      action: mode,
      target: t.source,
      matched: ids.length,
      visibleElements: shown,
      totalElements: total,
      ...unknownFields(t)
    },
    ui: { acted: true, chips: chipFor(`${ids.length} elements`, ids) }
  }
}

/* ────────────────────────────── the rest ────────────────────────────── */

/**
 * The design's `select_elements`, with a `mode` since 2026-10-02 — what happens to the selection
 * the user already has. Every mode is the store's one `select`, which is what a tree click, a
 * Ctrl-click and Esc all call:
 *
 *   · `replace` (the default, and all the tool did before) — a click: exactly this set.
 *   · `add` / `remove` — a Ctrl-click, for a whole set: the selection with the set added to it,
 *     or taken out of it, handed to `select` in **one** call. The store's own `'toggle'` mode
 *     takes one id at a time, and two thousand of those would be two thousand repaints.
 *   · `clear` — Esc: `select(null)`. It needs no set, and ignores one.
 *
 * A call that would leave the selection as it is — everything asked for already selected,
 * nothing asked for selected, nothing selected to clear — says so and calls nothing.
 * `selectionCount` is what is selected once the call returns, in every mode.
 */
export const select_elements: Executor = (input, ctx) => {
  const s = ctx.state()
  const mode = typeof input.mode === 'string' ? input.mode : 'replace'
  const current = s.selIds
  const count = (n: number): string => `${n} element${n === 1 ? '' : 's'}`

  if (mode === 'clear') {
    if (!current.length) {
      return {
        forModel: { message: 'Nothing was selected — nothing changed.', cleared: 0, selectionCount: 0 }
      }
    }
    s.select(null)
    return {
      forModel: {
        message: `Selection cleared — ${count(current.length)} deselected.`,
        cleared: current.length,
        selectionCount: 0
      },
      ui: { acted: true }
    }
  }

  const t = resolveTargets(input, s)
  if (!t.hit.length) {
    const hint = valueHints(t.source === 'rules' ? asRules(input.rules) : [], s)
    return {
      forModel: {
        message: `${emptyTargetMessage(t, mode === 'remove' ? 'deselected' : 'selected')} The selection is unchanged.${hint.text ? ' ' + hint.text : ''}`,
        selected: 0,
        selectionCount: current.length,
        ...unknownFields(t),
        ...(hint.topValues ? { valid_values: { topValues: hint.topValues } } : {})
      }
    }
  }
  const ids = t.hit.map((e) => e.id)

  if (mode === 'add') {
    const have = new Set(current)
    const fresh = ids.filter((id) => !have.has(id))
    if (!fresh.length) {
      return {
        forModel: {
          message: `All ${count(ids.length)} are already selected — the selection is unchanged.${unknownText(t)}`,
          added: 0,
          selectionCount: current.length,
          target: t.source,
          ...unknownFields(t)
        }
      }
    }
    const next = [...current, ...fresh]
    s.select(next, input.zoom === true)
    return {
      forModel: {
        message:
          `Added ${count(fresh.length)} to the selection — ${next.length} selected now.` +
          (fresh.length < ids.length ? ` ${ids.length - fresh.length} were already selected.` : '') +
          unknownText(t),
        added: fresh.length,
        selectionCount: next.length,
        target: t.source,
        ...unknownFields(t)
      },
      ui: { acted: true, chips: chipFor(`${next.length} selected`, next) }
    }
  }

  if (mode === 'remove') {
    const drop = new Set(ids)
    const next = current.filter((id) => !drop.has(id))
    const removed = current.length - next.length
    if (!removed) {
      return {
        forModel: {
          message: `None of those ${count(ids.length)} are selected — the selection is unchanged.${unknownText(t)}`,
          removed: 0,
          selectionCount: current.length,
          target: t.source,
          ...unknownFields(t)
        }
      }
    }
    s.select(next, input.zoom === true)
    return {
      forModel: {
        message: `Removed ${count(removed)} from the selection — ${next.length} selected now.${unknownText(t)}`,
        removed,
        selectionCount: next.length,
        target: t.source,
        ...unknownFields(t)
      },
      ui: { acted: true, chips: chipFor(`${next.length} selected`, next) }
    }
  }

  s.select(ids, input.zoom !== false)
  return {
    forModel: {
      message: `Selected ${ids.length} elements.${unknownText(t)}`,
      selected: ids.length,
      selectionCount: ids.length,
      target: t.source,
      ...unknownFields(t)
    },
    ui: { acted: true, chips: chipFor(`${ids.length} selected`, ids) }
  }
}

export const set_storeys: Executor = (input, ctx) => {
  const s = ctx.state()
  const visible = Array.isArray(input.visible) ? (input.visible as string[]).map(String) : []
  const names = s.federation.storeys.map((x) => x.name)
  const bad = visible.filter((v) => !names.includes(v))
  if (bad.length) {
    return {
      forModel: {
        message: `Unknown storey: ${bad.join(', ')}. Valid: ${names.join(', ')}`,
        valid_values: names
      }
    }
  }
  const storeyVis: Record<string, boolean> = {}
  if (visible.length) for (const n of names) storeyVis[n] = visible.includes(n)
  s.up({ storeyVis })
  return {
    forModel: {
      message: visible.length ? `Showing ${visible.join(', ')}.` : 'All storeys visible.',
      storeysShown: visible.length ? visible : names
    },
    ui: { acted: true }
  }
}

/**
 * The store's `activate` **toggles**: handed the key that is already active, it leaves activate
 * mode — which is how the sidebar's own pill leaves it, and how `key:null` does here. Until
 * 2026-10-02 the tool handed it whatever key it was given, so "make STR the active model" with
 * STR already active turned activate mode *off* and answered "Activated STR.". The key is now
 * compared first: the active key stays active and says so, and `null` with nothing active
 * changes nothing rather than pushing an undo entry for it.
 */
export const activate_model: Executor = (input, ctx) => {
  const s = ctx.state()
  const key = input.key == null ? null : String(input.key)
  if (key !== null && !s.loaded.includes(key)) return notLoaded(key, s.loaded)
  if (key === null) {
    if (!s.active) {
      return { forModel: { message: 'No model was active — nothing changed.', activeModel: null } }
    }
    // The pill's own call: `activate` with the active key leaves activate mode.
    s.activate(s.active)
    return {
      forModel: { message: 'Left activate mode.', activeModel: ctx.state().active },
      ui: { acted: true }
    }
  }
  if (s.active === key) {
    return {
      forModel: { message: `${key} is already the active model — nothing changed.`, activeModel: key }
    }
  }
  s.activate(key)
  return {
    forModel: { message: `Activated ${key}.`, activeModel: ctx.state().active },
    ui: { acted: true }
  }
}

/**
 * Where the camera stands, as the assistant reads it back (`shared/ai-schema.ts`,
 * `cameraBrief`) — or `null` where there is no viewer to ask. A read: the camera is the
 * viewer's own, and the store holds only the name of the view that was asked for last.
 */
export function cameraNow(): CameraBrief | null {
  const cam = getViewer()?.getCamera()
  return cam ? cameraBrief(cam) : null
}

/**
 * Everything about where the camera is, as one string: the pose the viewer is flying to, the
 * view the toolbar lights and the projection. A camera tool compares it before and after, and
 * says it acted only when it differs.
 */
export const cameraKey = (s: ShellState): string =>
  JSON.stringify([s.view, s.proj, getViewer()?.getCamera() ?? null])

/**
 * `SGVue.dc.html:1519`, and since 2026-10-02 the rest of what the user's camera does.
 *
 *   · `view` — a toolbar view button: the store's `setView`, which turns, frames the building
 *     and takes the projection the design gives that view.
 *   · `azimuth` / `elevation` — any direction (`shared/view-angles.ts`): the store's
 *     `aimCamera`. It turns the camera where it stands, as a drag does; with `fit` it also
 *     frames, which is a click on the view cube.
 *   · `fit` — frame without turning: `fitView`, a double-click on empty space or F.
 *   · `zoom` — a factor on that fit; alone, on the fit of the whole building.
 *   · `projection` — the persp / ortho button's own `toggleProj`, called only when it differs:
 *     after a named view, so that what was asked for wins over what the view chose, and before
 *     any framing, so that a fit is the fit of the projection that was asked for. (The rig
 *     converts distance to half-height on a swap, which is not the fit's own arithmetic: a fit
 *     taken first would come out a tenth looser in ortho, a tenth tighter in perspective, and
 *     different again on the same call repeated.)
 *
 * A named view together with a direction is refused before anything moves, and so is a fit on
 * a selection that is empty: a call does all of what it says or none of it. `acted` is whether
 * the camera, the named view or the projection is different afterwards — a call that lands on
 * the camera it started from has changed nothing a revert could put back. Every call without a
 * named view lands on the same camera when it is repeated; a named view is the toolbar's button,
 * and the design's button pressed twice from a perspective view reframes by that same tenth
 * (`camera.ts`, `setView`: the swap sizes the first, the fit the second).
 */
export const set_view: Executor = (input, ctx) => {
  const view = typeof input.view === 'string' ? input.view : undefined
  const projection = typeof input.projection === 'string' ? (input.projection as ShellState['proj']) : undefined
  const fit = input.fit === 'extents' || input.fit === 'selection' ? input.fit : undefined
  const azimuth = typeof input.azimuth === 'number' ? input.azimuth : undefined
  const elevation = typeof input.elevation === 'number' ? input.elevation : undefined
  const zoom = typeof input.zoom === 'number' ? input.zoom : undefined
  const turned = azimuth !== undefined || elevation !== undefined
  /** The camera as it is now: the result of every outcome below, a refusal included. */
  const read = (): Record<string, unknown> => {
    const camera = cameraNow()
    return { view: ctx.state().view, projection: ctx.state().proj, ...(camera ? { camera } : {}) }
  }

  if (view && turned) {
    return {
      forModel: {
        message:
          'A named view and a direction were both given, so nothing was changed: send view, or azimuth and elevation, not both.',
        ...read()
      }
    }
  }
  const selected = ctx.state().selIds.length
  if (fit === 'selection' && !selected) {
    return {
      forModel: {
        message:
          'Nothing is selected, so there is no selection to frame — nothing changed. Select something first, or use fit:"extents" for the whole building.',
        ...read()
      }
    }
  }

  // A zoom is a factor on a fit, so it implies one.
  const framed = fit ?? (zoom !== undefined ? 'extents' : undefined)
  if ((turned || framed) && !getViewer()) {
    return {
      forModel: { message: 'There is no 3D view to move the camera in — nothing changed.', ...read() }
    }
  }

  const before = cameraKey(ctx.state())

  if (view) ctx.state().setView(view)
  if (projection && projection !== ctx.state().proj) ctx.state().toggleProj()
  if (turned) ctx.state().aimCamera(azimuth, elevation)
  // A named view has already framed the building, so that fit is not asked for twice.
  if (framed && !(view && framed === 'extents' && zoom === undefined)) ctx.state().fitView(framed, zoom)

  const camera = cameraNow()
  const said: string[] = []
  if (view || projection) {
    said.push(`View set${view ? ' to ' + view : ''}${projection ? ' (' + projection + ')' : ''}.`)
  }
  if (turned) {
    said.push(
      camera
        ? `Camera turned to azimuth ${camera.azimuthDeg}°, elevation ${camera.elevationDeg}°.`
        : 'Camera turned.'
    )
  }
  if (framed === 'selection') said.push(`Framed the selection — ${selected} element${selected === 1 ? '' : 's'}.`)
  else if (framed) said.push('Framed the whole building.')
  if (zoom !== undefined) said.push(`Zoom ${zoom}× the fit.`)
  if (projection && ctx.state().proj !== projection) said.push('The projection could not be changed here.')
  if (!said.length) said.push('Nothing to change: pass a view, a direction, fit, zoom or projection.')

  return {
    forModel: { message: said.join(' '), ...read() },
    ui: { acted: cameraKey(ctx.state()) !== before }
  }
}

/**
 * `SGVue.dc.html:1527`, over two planes since 2026-10-01 (owner-requested): the gridline cut
 * and the level cut are independent, so a `kind` names the one plane this call is about and
 * the other is left exactly as it is. The result's `section` is the whole view's, both planes
 * in one string, as `get_view_state` reports it.
 *
 * **It does what the user's click does** (the owner, the same day: *"assistant should possess
 * everything user can do on the app"*), through the action the card's controls call:
 *
 *   · **Setting** a plane — a name the plane does not already have — is the chip's own patch
 *     (`planePatch`): **cutting**, at the kind's default offset, plus whatever the call passes
 *     (`cut:false` for a preview). An omitted `flip` is not flipped, as it always was.
 *   · **Changing** the plane already set at that name changes only what the call passes, the
 *     way the card's `−500` / `+500`, `flip side` and `cut` each change one thing: an omitted
 *     `offset`, `flip` **or `cut`** keeps what the plane has — one rule, no exception — so a
 *     previewed plane that is moved or flipped is still a preview, and `cut:true` is what cuts
 *     it. It never clears the plane, which is what a second click on the live chip does.
 *   · `cut:false` is the card's `cut` button off — the plane previewed; `cut:true` is it on.
 *   · `kind:null` is the card's `Clear all`; a `kind` with no name is that block's `Clear`.
 */
export const set_section: Executor = (input, ctx) => {
  const s = ctx.state()
  const section = (): string | null => sectionsLabel(ctx.state().sections)
  if (input.kind == null) {
    // The card's own `Clear all`.
    s.clearSections()
    return { forModel: { message: 'Section cleared.', section: section() }, ui: { acted: true } }
  }
  const kind: SecKind = input.kind === 'level' ? 'level' : 'grid'
  const name = typeof input.name === 'string' ? input.name : ''
  const noun = (k: SecKind): string => (k === 'grid' ? 'gridline' : 'level')
  /**
   * The plane this call did not name, when it is set: said, so that one cut is never read as
   * having replaced — or cleared — the other.
   */
  const other = (): string => {
    const k: SecKind = kind === 'grid' ? 'level' : 'grid'
    const plane = ctx.state().sections[k]
    return plane.name ? ` The ${noun(k)} section at ${plane.name} is unchanged.` : ''
  }
  if (!name) {
    // That block's own `Clear`.
    s.setSec(kind, NO_PLANE)
    return {
      forModel: { message: `The ${noun(kind)} section is cleared.${other()}`, section: section() },
      ui: { acted: true }
    }
  }
  const valid =
    kind === 'grid' ? s.federation.grids.map((g) => g.name) : s.federation.storeys.map((x) => x.name)
  if (!valid.includes(name)) {
    return {
      forModel: {
        message: `Unknown ${kind}: ${name}. Valid: ${valid.join(', ')}`,
        valid_values: valid
      }
    }
  }
  const already = s.sections[kind].name === name
  s.setSec(
    kind,
    {
      ...(already ? {} : { ...planePatch(name, kind), flip: false }),
      ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
      ...(typeof input.flip === 'boolean' ? { flip: input.flip } : {}),
      ...(typeof input.cut === 'boolean' ? { cut: input.cut } : {})
    },
    true
  )
  // What the plane is now — a new one cuts unless told otherwise, a changed one may have kept
  // a preview — is what the model is told.
  const cut = ctx.state().sections[kind].cut
  return {
    forModel: {
      message: `Section ${cut ? 'cut' : 'previewed'} at ${kind} ${name}.${other()}`,
      section: section()
    },
    ui: { acted: true }
  }
}

/**
 * One display switch: the input that names it, what the reply calls it, where the store keeps
 * it, and **the action its own control calls** — the toolbar's buttons, the property card's
 * dimensions button and the sidebar's Original materials switch. A toggle has no "set", so the
 * executor compares first and calls it only when the switch has to move.
 */
interface DisplaySwitch {
  key: keyof DisplayState
  label: string
  move: (s: ShellState, on: boolean) => void
}

const DISPLAY_SWITCHES: readonly DisplaySwitch[] = [
  { key: 'grids', label: 'grids', move: (s) => s.toggleGrids() },
  { key: 'levels', label: 'levels', move: (s) => s.toggleLevels() },
  { key: 'shadows', label: 'shadows', move: (s, on) => s.setShadows(on) },
  { key: 'dims', label: 'dimensions', move: (s) => s.toggleDims() },
  // 2026-10-02 — the three the toolbar and the sidebar had and the tool did not.
  { key: 'groundGrid', label: 'canvas grid', move: (s, on) => s.setGroundGrid(on) },
  { key: 'snap', label: 'snap', move: (s) => s.toggleSnap() },
  { key: 'originalMaterials', label: 'original materials', move: (s) => s.toggleNative() }
]

/**
 * `changed` is what moved and `already` what was where it was asked to be — every switch asked
 * for is in exactly one of them, `dims` included (until 2026-10-02 a `dims` that was already so
 * was not mentioned at all). `display` reads every switch back.
 */
export const toggle_display: Executor = (input, ctx) => {
  const changed: string[] = []
  const already: string[] = []
  const said: string[] = []
  for (const sw of DISPLAY_SWITCHES) {
    const want = input[sw.key]
    if (typeof want !== 'boolean') continue
    const state = want ? 'on' : 'off'
    // Read fresh: a switch is compared with what it is now, never with a snapshot.
    if (displayState(ctx.state())[sw.key] === want) {
      already.push(`${sw.label} ${state}`)
      said.push(`${sw.label} already ${state}`)
    } else {
      sw.move(ctx.state(), want)
      changed.push(`${sw.label} ${state}`)
      said.push(`${sw.label} ${state}`)
    }
  }
  return {
    forModel: {
      message: said.length ? said.join(', ') + '.' : 'Nothing to change.',
      changed,
      already,
      display: displayState(ctx.state())
    },
    // Only what actually changed — a switch already where it was asked to be gets no ↺.
    ui: { acted: changed.length > 0 }
  }
}

export const color_by_property: Executor = (input, ctx) => {
  const s = ctx.state()
  const property = input.property == null ? null : String(input.property)
  if (!property) {
    s.clearColorBy()
    return { forModel: { message: 'Colour scheme cleared.', groups: [] }, ui: { acted: true } }
  }
  /**
   * Scope by a found set as well as by rules (2026-09-20). `colorBy` already took a pool;
   * an id list is one more way to name it, and it is what makes "colour what the query just
   * found by material" a second call rather than a re-derivation of the whole rule list.
   */
  const t = resolveTargets(input, s)
  /** Named as a set — ids, the selection, the open schedule's rows — rather than by rules. */
  const asSet = t.source === 'ids' || t.source === 'selection' || t.source === 'schedule'
  if (asSet && !t.hit.length) {
    return { forModel: { message: emptyTargetMessage(t, 'coloured'), ...unknownFields(t) } }
  }
  const scheme = asSet
    ? s.setColorByIds(property, t.hit.map((e) => e.id))
    : s.setColorBy(property, asRules(input.rules))
  if (!scheme) {
    // 2026-09-28: a name that is not a key gets its nearest keys from `executeTool`; a real key
    // outside the scope says where it is carried; a rule that matched nothing, what its key holds.
    const elsewhere = t.source === 'none' ? 0 : carriedInFederation(s, property)
    const hint = valueHints(t.source === 'rules' && !t.hit.length ? asRules(input.rules) : [], s)
    return {
      forModel: {
        message:
          `Nothing carries "${property}"${t.source === 'rules' ? '' : ' in that set'}.` +
          (elsewhere ? ` ${elsewhere} elements outside that scope do.` : '') +
          (hint.text ? ` ${hint.text}` : ''),
        ...(elsewhere ? { carriedInFederation: elsewhere } : {}),
        ...(hint.topValues ? { valid_values: { topValues: hint.topValues } } : {})
      }
    }
  }
  return schemeOutcome(scheme, property, { property })
}

/**
 * A colour scheme that was just set, as the model and the panel get it — `color_by_property`'s
 * report, shared since 2026-09-28 with `color_by_schedule_column` (`what` names the property or
 * the column; `extra` follows the message).
 */
export function schemeOutcome(
  scheme: ColorByState,
  what: string,
  extra: Record<string, unknown>
): ToolOutcome {
  // The design's own `groups.slice(0, 8)` — its sentence and its chip list alike. Six of those
  // chips survive `CHIP_CAP`, here exactly as in the design.
  const head = scheme.groups.slice(0, COLOR_HEAD)
  /**
   * The model gets the largest groups, not all of them (2026-09-20).
   *
   * The **legend keeps every group** — it is built from `s.colorBy`, which this call has
   * already set, and the design caps nothing there — but the JSON crossing IPC used to be the
   * complete list with `truncated: false` written beside it. On a real file's widest key that
   * is 1 306 groups and ~18 600 tokens, and the flag was simply false.
   */
  const byCount = [...scheme.groups].sort((a, b) => b.n - a.n)
  const shown = byCount.slice(0, COLOR_GROUP_CAP)
  const rest = byCount.slice(COLOR_GROUP_CAP)
  const restElements = rest.reduce((a, g) => a + g.n, 0)
  return {
    forModel: {
      message:
        `Coloured by ${what} — ${scheme.groups.length} value${scheme.groups.length === 1 ? '' : 's'}: ${head.map((g) => `${g.v} ${g.n}`).join(', ')}. A legend is showing.` +
        (rest.length
          ? ` The ${shown.length} largest are listed; ${rest.length} smaller values covering ${restElements} elements are not — the legend shows them all.`
          : ''),
      ...extra,
      groups: shown.map((g) => ({ value: g.v, count: g.n, color: g.color })),
      totalGroups: scheme.groups.length,
      truncated: rest.length > 0,
      ...(rest.length ? { omittedGroups: rest.length, omittedElements: restElements } : {})
    },
    ui: {
      acted: true,
      chips: head.map((g) => ({ label: `${g.v} (${g.n})`, ids: [...g.ids] }))
    }
  }
}

/** `#rgb` or `#rrggbb`. The prototype validated nothing and handed the viewer whatever came. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * The design's `color_models`. Since 2026-10-02 a **`null` value clears that one model's
 * override** — the palette's own `reset`, `setModelColor(key, null)` — where before the
 * only clear was the empty map, which clears every model and turns Original materials back on.
 * A key already as asked is said to be so and its action is not called.
 */
export const color_models: Executor = (input, ctx) => {
  const s = ctx.state()
  const raw = (input.map ?? {}) as Record<string, unknown>
  const keys = Object.keys(raw)
  if (!keys.length) {
    for (const k of Object.keys(s.modelColors)) s.setModelColor(k, null)
    if (!ctx.state().nativeMats) ctx.state().toggleNative()
    return { forModel: { message: 'Colour overrides cleared.', models: {} }, ui: { acted: true } }
  }
  const bad = keys.filter(
    (k) => !s.loaded.includes(k) || (raw[k] !== null && !HEX.test(String(raw[k])))
  )
  if (bad.length) {
    return {
      forModel: {
        message: `Unusable: ${firstFew(bad)}. Model keys must be loaded and colours must be hex like #35C4B6, or null to clear one. Loaded: ${s.loaded.join(', ')}`,
        valid_values: [...s.loaded]
      }
    }
  }
  const coloured: string[] = []
  const cleared: string[] = []
  const already: string[] = []
  for (const k of keys) {
    const now = ctx.state()
    if (raw[k] === null) {
      if (!(k in now.modelColors)) already.push(`${k} has no override`)
      else {
        now.setModelColor(k, null)
        cleared.push(k)
      }
      continue
    }
    const c = String(raw[k])
    // The same colour is still a change while Original materials hides it: picking a swatch
    // turns the overrides on (`setModelColor`), and that is what the user would see.
    if (now.modelColors[k] === c && !now.nativeMats) already.push(`${k} is already ${c}`)
    else {
      now.setModelColor(k, c)
      coloured.push(k)
    }
  }
  const after = ctx.state()
  const said = [
    coloured.length ? `Coloured ${coloured.join(', ')}.` : '',
    cleared.length ? `Cleared the override on ${cleared.join(', ')}.` : '',
    already.length ? `Unchanged: ${already.join(', ')}.` : ''
  ].filter(Boolean)
  return {
    forModel: {
      message: said.join(' '),
      models: after.modelColors,
      // What a cleared override now shows as: the files' own materials, or the IFC class colours.
      originalMaterials: after.nativeMats
    },
    ui: { acted: coloured.length + cleared.length > 0 }
  }
}

/* ────────────────────────────── set_models (2026-10-02) ────────────────────────────── */

/**
 * `set_models` — the eye beside each model in the sidebar. The owner: *"assistant should
 * possess everything user can do on the app"*; until now it could read which models were
 * hidden and not hide or show one.
 *
 * `visible` names the models to leave showing, `[]` every one — `set_storeys`' own shape, so a
 * call says the whole state it wants and calling it twice is the same as calling it once.
 *
 * **One `up({ modelVis })`** — the call `toggleModel` itself makes — rather than a toggle per
 * model, so one request is one undo step and the patch the scope guard holds back is the patch
 * that would have been written. Hiding is held to that guard exactly as `apply_visibility` is:
 * nothing left visible is refused, under 5 % waits for the user's Apply. A call that only
 * brings models back is exempt, as `show` is — it can only reveal more.
 */
export const set_models: Executor = (input, ctx) => {
  const s = ctx.state()
  const loaded = s.loaded
  const asked = [...new Set(Array.isArray(input.visible) ? (input.visible as unknown[]).map(String) : [])]
  const bad = asked.filter((k) => !loaded.includes(k))
  if (bad.length) {
    return {
      forModel: {
        message: `Not loaded: ${firstFew(bad)}. Nothing changed. Loaded: ${loaded.join(', ')}`,
        valid_values: [...loaded]
      }
    }
  }

  const hiddenNow = loaded.filter((k) => s.modelVis[k] === false)
  const hiddenNext = asked.length ? loaded.filter((k) => !asked.includes(k)) : []
  const shownNext = loaded.filter((k) => !hiddenNext.includes(k))
  const total = s.federation.elements.length
  const report = (visible: number): Record<string, unknown> => ({
    modelsShown: shownNext,
    modelsHidden: hiddenNext,
    visibleElements: visible,
    totalElements: total
  })
  const state = hiddenNext.length
    ? `Showing ${shownNext.join(', ')}; hidden: ${hiddenNext.join(', ')}`
    : 'All models showing'

  if (hiddenNow.length === hiddenNext.length && hiddenNow.every((k) => hiddenNext.includes(k))) {
    return {
      forModel: {
        message: `${state} — that is how it already was, so nothing changed.`,
        applied: false,
        ...report(s.federation.elements.filter(visFn(s)).length)
      }
    }
  }

  // Every loaded key explicitly, as `set_storeys` writes storeys — or nothing at all when every
  // model shows, which is the map's first state and what `showAll` writes.
  const modelVis: Record<string, boolean> = {}
  if (hiddenNext.length) for (const k of loaded) modelVis[k] = !hiddenNext.includes(k)
  const would = s.federation.elements.filter(visFn({ ...s, modelVis })).length
  // Only bringing models back can never hide anything.
  const scope = scopeCheck(would, total, hiddenNext.every((k) => hiddenNow.includes(k)))

  if (scope === 'empty') {
    return {
      forModel: {
        message: `That would leave nothing visible, so it was not applied. ${hiddenNow.length ? `Hidden now: ${hiddenNow.join(', ')}.` : 'Every model is showing now.'} Check the storeys and the filter stack, or use apply_visibility with action:"reset" to start from the whole model.`,
        applied: false,
        wouldLeaveVisible: 0,
        totalElements: total
      }
    }
  }
  if (scope === 'confirm') {
    return {
      forModel: {
        message: confirmText(would, total),
        applied: false,
        pending: true,
        wouldLeaveVisible: would,
        totalElements: total
      },
      ui: {
        pending: {
          label: `show ${shownNext.length} of ${loaded.length} models — leaves ${would} of ${total} visible`,
          patch: { modelVis }
        }
      }
    }
  }

  s.up({ modelVis })
  const after = ctx.state()
  const shown = after.federation.elements.filter(visFn(after)).length
  return {
    forModel: {
      message: `${state}. ${shown} of ${total} elements visible.`,
      applied: true,
      ...report(shown)
    },
    ui: { acted: true }
  }
}

/** Kept beside the chip caps so the panel and the executors cannot drift. */
export { CHIP_CAP }

export const VIEW_EXECUTORS: Record<string, Executor> = {
  set_filter_stack,
  manage_filters,
  apply_visibility,
  select_elements,
  set_storeys,
  activate_model,
  set_view,
  set_section,
  toggle_display,
  color_by_property,
  color_models,
  set_models
}

/** Reused by `read.ts`'s `get_view_state`, so both report the same numbers. */
export { visibleCount, groupCounts }

/** The outcome shape, re-exported so `index.ts` has one import. */
export type { ToolOutcome }
