// Calculated values (formula / percentage). Addressed by id, never by position.

import type { UnitKind } from '../../ifc/types';
import { calcNameClash, calcNameProblem, calcNames, nameKey, type Binding, type CalcNames } from '../calcNames';
import { alignForCalc } from '../columns';
import { renameReference } from '../formula';
import { fieldKey, type Calculated, type ScheduleDef } from '../def';
import { edit, newId } from './edit';

export const addCalculated = (def: ScheduleDef, kind: 'formula' | 'percentage') => edit(def, (d) => {
  d.calculated = d.calculated ?? [];
  const id = newId('calc', d.calculated);
  // 2026-11-24 — names are unique: the next number no column already has.
  const word = kind === 'formula' ? 'Calculated' : 'Percentage';
  let n = d.calculated.length + 1;
  while (calcNameClash(d, id, `${word} ${n}`)) n++;
  d.calculated.push(kind === 'formula'
    ? { id, name: `${word} ${n}`, kind, formula: '' }
    : { id, name: `${word} ${n}`, kind, ofField: d.columns[0]?.field });
});

/**
 * Every formula naming `from` as the column `target` means, rewritten to name `to` — the
 * formulas keep working when a column is renamed (2026-11-24). Not an edit of their logic, so Vee's mark
 * and note stay. `names` is what each name meant BEFORE the rename; a name that meant two
 * columns, or another column than this one, is left as it was.
 */
export function carryRename(d: ScheduleDef, names: CalcNames, target: Binding, from: string, to: string): void {
  const b = names.bindings.get(nameKey(from));
  if (!b || nameKey(from) === nameKey(to) || !nameKey(to)) return;
  const same = b.kind === 'calc'
    ? target.kind === 'calc' && b.id === target.id
    : target.kind === 'model' && b.column === target.column;
  if (!same) return;
  for (const c of d.calculated ?? []) {
    if (c.kind === 'formula' && c.formula) c.formula = renameReference(c.formula, from, to);
  }
}

/** Also removes every column showing it — a column on a deleted calculation renders blank. */
export const removeCalculated = (def: ScheduleDef, id: string) => edit(def, (d) => {
  d.calculated = (d.calculated ?? []).filter((c) => c.id !== id);
  d.columns = d.columns.filter((c) => !(c.field.kind === 'formula' && c.field.id === id));
});

/**
 * Name, formula text, or a percentage's field. A new formula text or field makes the value the
 * user's own (2026-11-24): Vee's mark and note go with what they described. A rename keeps them,
 * and rewrites the other formulas that used the old name — theirs keep their marks too.
 */
export const updateCalculated = (
  def: ScheduleDef, id: string, patch: Partial<Pick<Calculated, 'name' | 'formula' | 'ofField'>>,
) => edit(def, (d) => {
  const c = d.calculated?.find((x) => x.id === id);
  if (!c) return;
  // 2026-11-24 — a name another column has is refused (the editor says why, `calcNameProblem`),
  // and an accepted one is carried into every formula that used the old name.
  if (patch.name !== undefined && patch.name !== c.name) {
    if (calcNameProblem(d, id, patch.name)) return;
    carryRename(d, calcNames(d), { kind: 'calc', id }, c.name, patch.name);
  }
  const rewritten = (patch.formula !== undefined && patch.formula !== c.formula)
    || (patch.ofField !== undefined && (!c.ofField || fieldKey(patch.ofField) !== fieldKey(c.ofField)));
  Object.assign(c, patch);
  if (rewritten) {
    delete c.by;
    delete c.note;
  }
});

/**
 * What the result IS: 'yesno', 'text', or a UnitKind for a number. The only writer of
 * result/unitKind/yesNo together — yesNo is cleared, not mirrored — and it re-aligns every
 * column showing this value, overriding a hand-picked alignment.
 */
export const setCalculatedResult = (def: ScheduleDef, id: string, choice: string) => edit(def, (d) => {
  const c = d.calculated?.find((x) => x.id === id);
  if (!c) return;
  c.result = choice === 'yesno' ? 'yesNo' : choice === 'text' ? 'text' : 'number';
  c.unitKind = c.result === 'number' ? (choice as NonNullable<typeof c.unitKind>) : undefined;
  c.yesNo = undefined;
  for (const col of d.columns) {
    if (col.field.kind === 'formula' && col.field.id === c.id) col.align = alignForCalc(c);
  }
});

/** Accept the dimension the expression works out to (the caller asks formula.ts). */
export const setCalculatedUnitKind = (def: ScheduleDef, id: string, kind: UnitKind) => edit(def, (d) => {
  const c = d.calculated?.find((x) => x.id === id);
  if (c) c.unitKind = kind;
});
