// Column intents: which columns, in what order, labelled and formatted how.
// `i` is always an index into def.columns. A missing column is a no-op, as it was in the
// handlers these came from.

import {
  headingOf, type Column, type FieldRef, type ScheduleDef, type TotalKind, type UnitFormat,
} from '../def';
import { calcNames, clearOfCalcNames, headingProblem } from '../calcNames';
import { carryRename } from './calculated';
import { edit, moveItem } from './edit';

/**
 * Append columns. The caller builds them — a prop column's default format needs the model.
 * 2026-11-25 (F1): a model column whose heading a calculated value has is headed apart
 * (`clearOfCalcNames`), so a formula naming that value keeps reading it.
 */
export const addColumns = (def: ScheduleDef, cols: Column[]) => edit(def, (d) => {
  for (const c of structuredClone(cols)) {
    d.columns.push(c);
    const apart = c.field.kind === 'formula' ? undefined : clearOfCalcNames(d, c);
    if (apart) c.heading = apart;
  }
});

export const removeColumn = (def: ScheduleDef, i: number) =>
  edit(def, (d) => { d.columns.splice(i, 1); });

export const moveColumn = (def: ScheduleDef, from: number, to: number) =>
  edit(def, (d) => { moveItem(d.columns, from, to); });

/**
 * Point a column at another property, keeping the heading the user reads. A heading typed and
 * then cleared is stored empty and reads as the default, so it is pinned like one never set
 * (2026-11-25, review round 2: left empty, the column took the new property's name — which a
 * calculated value may have, and a formula naming that value then read this column instead).
 */
export const remapColumn = (def: ScheduleDef, i: number, field: FieldRef) => edit(def, (d) => {
  const col = d.columns[i];
  if (!col) return;
  if (!col.heading?.trim()) col.heading = headingOf(col, d);
  col.field = field;
});

const onColumn = (def: ScheduleDef, i: number, fn: (c: Column) => void) =>
  edit(def, (d) => { const c = d.columns[i]; if (c) fn(c); });

/**
 * 2026-11-24 — a heading a calculated value's name has is refused (the column menu says why,
 * `headingProblem`), and a model column's new heading is carried into the formulas using it.
 * 2026-11-25 (F2) — so is another column's heading while a formula names either: the formula
 * could no longer tell the two apart. Refused, the old heading stays, and the next edit renames
 * from it.
 */
export const setHeading = (def: ScheduleDef, i: number, heading: string) => edit(def, (d) => {
  const c = d.columns[i];
  if (!c || headingProblem(d, i, heading)) return;
  const before = headingOf(c, d);
  const names = calcNames(d);
  c.heading = heading;
  if (c.field.kind === 'core' || c.field.kind === 'prop') {
    carryRename(d, names, { kind: 'model', column: i }, before, headingOf(c, d));
  }
});

export const setHeadingOrientation = (def: ScheduleDef, i: number, o: 'horizontal' | 'vertical') =>
  onColumn(def, i, (c) => { c.headingOrientation = o; });

export const setAlign = (def: ScheduleDef, i: number, align: 'left' | 'center' | 'right') =>
  onColumn(def, i, (c) => { c.align = align; });

/** Merge into the column's number/boolean format. An `undefined` in the patch clears a key
 *  back to "no choice made" — the Decimals box's empty state. */
export const setColumnFormat = (def: ScheduleDef, i: number, patch: Partial<UnitFormat>) =>
  onColumn(def, i, (c) => {
    c.format = c.format ?? {};
    Object.assign(c.format, patch);
  });

export const setTotal = (def: ScheduleDef, i: number, total: TotalKind | null) =>
  onColumn(def, i, (c) => { c.total = total; });

export const setHidden = (def: ScheduleDef, i: number, hidden: boolean) =>
  onColumn(def, i, (c) => { c.hidden = hidden; });

/** Set several widths at once (a drag, Fit all, Equal width, the Width box). Already
 *  clamped by the caller; `undefined` clears a width back to automatic. */
export const setWidths = (def: ScheduleDef, widths: [number, number | undefined][]) =>
  edit(def, (d) => {
    for (const [i, w] of widths) if (d.columns[i]) d.columns[i].width = w;
  });
