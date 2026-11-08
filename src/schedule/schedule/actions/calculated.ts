// Calculated values (formula / percentage). Addressed by id, never by position.

import type { UnitKind } from '../../ifc/types';
import { alignForCalc } from '../columns';
import type { Calculated, ScheduleDef } from '../def';
import { edit, newId } from './edit';

export const addCalculated = (def: ScheduleDef, kind: 'formula' | 'percentage') => edit(def, (d) => {
  d.calculated = d.calculated ?? [];
  const id = newId('calc', d.calculated);
  d.calculated.push(kind === 'formula'
    ? { id, name: `Calculated ${d.calculated.length + 1}`, kind, formula: '' }
    : { id, name: `Percentage ${d.calculated.length + 1}`, kind, ofField: d.columns[0]?.field });
});

/** Also removes every column showing it — a column on a deleted calculation renders blank. */
export const removeCalculated = (def: ScheduleDef, id: string) => edit(def, (d) => {
  d.calculated = (d.calculated ?? []).filter((c) => c.id !== id);
  d.columns = d.columns.filter((c) => !(c.field.kind === 'formula' && c.field.id === id));
});

/** Name, formula text, or a percentage's field. */
export const updateCalculated = (
  def: ScheduleDef, id: string, patch: Partial<Pick<Calculated, 'name' | 'formula' | 'ofField'>>,
) => edit(def, (d) => {
  const c = d.calculated?.find((x) => x.id === id);
  if (c) Object.assign(c, patch);
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
