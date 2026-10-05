// The one evaluator for a column's conditional colour rules. Pure, no DOM.
//
// Three readers ask the same question and must never get three answers: the table's paint
// (`cellStyle` in ui/tableView.ts), the engine's per-rule counts (`conditionalHits`) and
// the engine's one-rule preview (`litBy`). "Colours 12 of 400 rows" that shows 11 rows in
// a different colour than the table painted is worse than no count at all, so the decision
// lives here once and all three call it.

import { matchRule } from './compare';
import type { Column, CondRule, ScheduleDef } from './def';
import { boolOfText } from './format';

/**
 * Does one rule fire on this cell's displayed text?
 *
 * Rules are evaluated on the DISPLAYED text — that is what lets "contains 2400" work on a
 * formatted number. Equality on a boolean is the one amendment: a Yes/No column switched to
 * ✓/✗ holds the same value drawn differently, so a rule authored as "= Yes" has to keep
 * matching. Only = and != get it, and only when BOTH sides name a boolean; every other
 * operator is a text or number question and stays on the displayed text. matchRule itself is
 * untouched — the filter engine shares it and already compares raw values.
 */
function fires(col: Column, r: CondRule, text: string): boolean {
  if (r.op === '=' || r.op === '!=') {
    const cell = boolOfText(text);
    const want = boolOfText(String(r.value ?? ''));
    if (cell !== null && want !== null) return r.op === '=' ? cell === want : cell !== want;
  }
  return matchRule({ v: text }, { field: col.field, op: r.op, value: r.value });
}

/**
 * Which rule claims this cell — its index in `col.conditional`, or -1.
 *
 * The first firing rule claims the cell WHETHER OR NOT it carries a style. That is the
 * whole point of returning an index rather than a style string: the paint, the per-rule
 * counts and the litBy narrowing then agree by construction. A rule with every colour
 * cleared still shadows the rules below it, exactly as it does when the table paints.
 *
 * A blank cell is not a value, so only "has no value" may claim it. Every other operator is
 * skipped on blank text: `= ''` and `contains ''` are both true of the empty string, and a
 * rule authored with its value box left empty would otherwise paint the whole column the
 * moment it was added.
 */
export function firingRule(col: Column, text: string): number {
  const rules = col.conditional;
  if (!rules?.length) return -1;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    if (text === '') {
      if (r.op === 'noValue') return k;
      continue;
    }
    if (fires(col, r, text)) return k;
  }
  return -1;
}

/**
 * The column and rule a `litBy` preview points at, or null when it points at nothing.
 *
 * One validator, asked by the engine before it narrows and by the notice before it explains
 * the narrowing — so the table can never be narrowed by a target the notice thinks is gone,
 * or left wide under a notice claiming it is not. A hidden column counts as gone: its cells
 * are not in the result, so there is nothing to have coloured.
 */
export function litTarget(
  def: ScheduleDef,
  litBy: { col: number; rule: number } | null | undefined,
): { col: Column; rule: CondRule } | null {
  if (!litBy) return null;
  const col = def.columns[litBy.col];
  if (!col || col.hidden) return null;
  const rule = col.conditional?.[litBy.rule];
  return rule ? { col, rule } : null;
}
