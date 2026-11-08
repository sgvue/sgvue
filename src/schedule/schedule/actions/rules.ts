// Filter rules and a column's conditional colour rules.
//
// Filter actions that the UI never guarded (op, on a rule that is not there) still
// throw, exactly as the in-place handlers did: a caller passing a stale index is a bug to
// surface, not a no-op to paper over.

import { MAX_FILTERS, type CondRule, type FieldRef, type FilterRule, type ScheduleDef } from '../def';
import { edit, firstField } from './edit';

// ---------- filters ----------

/** A new rule starts on the first column's field with "has a value". At the cap, a no-op:
 *  parse keeps only MAX_FILTERS, so a ninth rule would vanish on reload. */
export const addFilterRule = (def: ScheduleDef) => edit(def, (d) => {
  if (d.filters.length < MAX_FILTERS) d.filters.push({ field: firstField(d), op: 'hasValue' } as FilterRule);
});

export const removeFilterRule = (def: ScheduleDef, k: number) =>
  edit(def, (d) => { d.filters.splice(k, 1); });

export const setFilterMode = (def: ScheduleDef, logic: 'and' | 'or') =>
  edit(def, (d) => { d.filterLogic = logic; });

/** A new field makes the old value meaningless, so the rule restarts as "has a value". */
export const setFilterField = (def: ScheduleDef, k: number, field: FieldRef) =>
  edit(def, (d) => { d.filters[k] = { field, op: 'hasValue' }; });

/** Only `in` and `between` keep a value list. */
export const setFilterOp = (def: ScheduleDef, k: number, op: FilterRule['op']) => edit(def, (d) => {
  const rule = d.filters[k];
  rule.op = op;
  if (rule.op !== 'in' && rule.op !== 'between') rule.values = undefined;
});

/** The value as stored: SI for a number the caller converted from display units. */
export const setFilterValue = (def: ScheduleDef, k: number, value: FilterRule['value']) =>
  edit(def, (d) => { const rule = d.filters[k]; if (rule) rule.value = value; });

/**
 * One end of a `between` range, already in SI; undefined empties that box. An empty end is
 * stored as '' — never an array hole, which JSON (saves, undo) would turn into null.
 */
export const setFilterRange = (def: ScheduleDef, k: number, slot: 0 | 1, n: number | undefined) =>
  edit(def, (d) => {
    const rule = d.filters[k];
    if (!rule) return;
    const vals = [...(rule.values ?? [])] as (string | number)[];
    vals[slot] = n ?? '';
    rule.values = Array.from(vals, (v) => v ?? '');
  });

/** The `in` list. */
export const setFilterValues = (def: ScheduleDef, k: number, values: (string | number)[]) =>
  edit(def, (d) => { const rule = d.filters[k]; if (rule) rule.values = values; });

// ---------- conditional colour rules (on column i) ----------

/** Seeded with BOTH colours, so a new rule visibly does something once its value matches. */
export const addConditionalRule = (def: ScheduleDef, i: number) => edit(def, (d) => {
  const c = d.columns[i];
  if (!c) return;
  c.conditional = [...(c.conditional ?? []), { op: '=', value: '', bg: '#fff3cd', fg: '#664d03' } as CondRule];
});

export const removeConditionalRule = (def: ScheduleDef, i: number, k: number) =>
  edit(def, (d) => { const c = d.columns[i]; if (c?.conditional) c.conditional.splice(k, 1); });

/** Op, value, colours or bold — a preset's fill and text together are one patch, one step. */
export const updateConditionalRule = (def: ScheduleDef, i: number, k: number, patch: Partial<CondRule>) =>
  edit(def, (d) => {
    const r = d.columns[i]?.conditional?.[k];
    if (r) Object.assign(r, patch);
  });
