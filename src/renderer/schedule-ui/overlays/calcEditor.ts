// Authoring calculated values — formulas and percentages.
//
// This used to hang off the bottom of the Fields section in the 368px inspector, which is
// where it became "too much text and messy": a name box, a formula box, two warning lines,
// a unit row with a suggestion chip and three lines of syntax help, all folded into a rail.
// It lives in the field browser instead, for one reason beyond the extra width — this is the
// only screen where the list of fields a formula may refer to is visible WHILE you type.
//
// Three lines of syntax help went with the move, deleted rather than relocated: the syntax
// guide says the same thing properly, and duplicated help is the thing that rots. SGVue opens
// that guide inside this window (`formulaHelp.ts`) — ifcTable's `/formula.html` was a page.

import type { ModelStore } from '../../../schedule/ifc/store';
import { calcProblems as problemsOf } from '../../../schedule/schedule/computed';
import { headingOf, resultOf, type Calculated, type ScheduleDef } from '../../../schedule/schedule/def';
import { dimensionOf } from '../../../schedule/schedule/formula';
import type { AppState } from '../state';
import { esc, option } from '../dom';
// The leaf, not the barrel: ./panels re-exports fieldsSection, which imports calcProblems
// from here, so going through it would be a cycle. All three of these live in shared.ts —
// the barrel was only ever passing them along.
import { fieldKey, kindsByHeading, selectableFields } from '../panels/shared';
import { cross } from '../icons';

/**
 * What the result IS. The measurements let the column convert units like any other number;
 * "yes or no" makes it a real yes/no so Column formatting can show Yes/No, TRUE/FALSE or a
 * tick rather than 1 and 0; "text" keeps the words an if() picked, so a schedule can be
 * grouped and counted by a label the author invented.
 *
 * This used to be a `yesno()` function in the formula language. A dropdown entry is the
 * right home: a reader of the panel finds it, a function has to be known about first — and
 * the same reasoning is why text is here rather than a `text()` wrapper.
 */
const CALC_KINDS: [string, string][] = [
  ['none', 'plain number'],
  ['yesno', 'yes or no'],
  ['text', 'text'],
  ['length', 'length'],
  ['area', 'area'],
  ['volume', 'volume'],
  ['mass', 'mass'],
  ['angle', 'angle'],
];

/** Headings a formula may refer to — the columns that are not themselves calculated. */
function formulaVariables(def: ScheduleDef): string[] {
  return def.columns
    .filter((c) => c.field.kind === 'core' || c.field.kind === 'prop')
    .map((c) => headingOf(c, def));
}

/**
 * Everything wrong with one calculated value, in the order a person would want to hear it.
 * Shared with the inspector, which shows the count so a broken formula cannot hide behind a
 * closed modal — the one thing that genuinely got worse by moving the editor in here.
 *
 * SGVue (2026-10-02): the rule itself is the engine's `calcProblems` now (`schedule/computed.ts`),
 * which the assistant's `make_schedule` asks too — one list of what makes a formula bad.
 */
export function calcProblems(state: AppState, store: ModelStore): Map<string, string> {
  return problemsOf(store, state.def);
}

function calcRow(state: AppState, c: Calculated, problems: Map<string, string>, store: ModelStore): string {
  const def = state.def;
  const problem = problems.get(c.id);

  // What the expression itself says the result measures. `Width * 2` is a length and
  // `Width * Height` is an area — the operands carry their kinds, so this is derived, not
  // guessed. Offered rather than applied: the author still owns the decision, but can no
  // longer be unaware that the app disagrees.
  const dim = c.kind === 'formula' && c.formula
    ? dimensionOf(c.formula, kindsByHeading(store, def)) : { kind: null };
  const result = resultOf(c);
  const declared = result === 'yesNo' ? 'yesno' : result === 'text' ? 'text' : (c.unitKind ?? 'none');
  // No unit suggestion once the author has said it is a yes/no or a label — a predicate is
  // dimensionless and a word has no dimension at all, so the chip would forever offer
  // "plain number" against their choice.
  const disagrees = result === 'number' && dim.kind && dim.kind !== declared;

  const body = c.kind === 'formula'
    ? `<input type="text" data-act="calc-formula" class="full mono" data-id="${esc(c.id)}"
         value="${esc(c.formula ?? '')}" placeholder='Area * 1.15   ·   contains(Type, "FD")' aria-label="Formula" />
       ${problem ? `<div class="sub tip-error">${esc(problem)}</div>` : ''}
       <div class="row calc-unit">
         <span class="sub">Result is a</span>
         <select data-act="calc-kind" data-id="${esc(c.id)}" aria-label="What the result measures">
           ${CALC_KINDS.map(([v, label]) => option(v, label, declared === v)).join('')}
         </select>
         ${disagrees ? `<button class="chip" data-act="calc-kind-accept" data-id="${esc(c.id)}"
             title="Set it to what the formula works out to">looks like a ${esc(dim.kind === 'none' ? 'plain number' : dim.kind!)} — use that</button>` : ''}
       </div>`
    : `<select data-act="calc-of" data-id="${esc(c.id)}" class="full" aria-label="Percentage of">
         ${selectableFields(state).map((f) => option(f.id, f.label, !!c.ofField && fieldKey(c.ofField) === f.id)).join('')}
       </select>
       <div class="sub">Each row as a percentage of this field's total.</div>`;

  return `<div class="subcard${problem ? ' bad' : ''}" data-id="${esc(c.id)}">
    <div class="row">
      <input type="text" data-act="calc-name" data-id="${esc(c.id)}" value="${esc(c.name)}"
        placeholder="Name" class="grow-1" aria-label="Calculated value name" />
      <button class="x-btn hv-warn-both" data-act="calc-remove" data-id="${esc(c.id)}" title="Remove">${cross()}</button>
    </div>
    <div class="calc-body">${body}</div>
  </div>`;
}

export function calcEditor(state: AppState, store: ModelStore): string {
  const items = state.def.calculated ?? [];
  const problems = calcProblems(state, store);
  const vars = formulaVariables(state.def);

  return `<div class="calc-editor">
    <div class="row ends chosen-head">
      <span class="eyebrow">Calculated${items.length ? ` · ${items.length}` : ''}</span>
      <button class="link" data-act="open-formula">Syntax guide</button>
    </div>
    <div class="stack tight">${items.map((c) => calcRow(state, c, problems, store)).join('')}</div>
    ${items.length ? '' : `<div class="sub">Work out a value from the columns you have — an
       allowance on an area, a flag for the fire doors. Add it here, then it appears in the
       list on the left to add as a column.</div>`}
    ${items.length && vars.length ? `<div class="sub">Refer to: ${esc(vars.join(', '))}</div>` : ''}
    <div class="row snug">
      <button class="btn" data-act="calc-add-formula">Add formula</button>
      <button class="btn" data-act="calc-add-percent">Add percentage</button>
    </div>
  </div>`;
}
