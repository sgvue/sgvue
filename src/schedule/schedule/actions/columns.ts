// Column intents: which columns, in what order, labelled and formatted how.
// `i` is always an index into def.columns. A missing column is a no-op, as it was in the
// handlers these came from.

import {
  headingOf, type Column, type FieldRef, type ScheduleDef, type TotalKind, type UnitFormat,
} from '../def';
import { edit, moveItem } from './edit';

/** Append columns. The caller builds them — a prop column's default format needs the model. */
export const addColumns = (def: ScheduleDef, cols: Column[]) =>
  edit(def, (d) => { d.columns.push(...structuredClone(cols)); });

export const removeColumn = (def: ScheduleDef, i: number) =>
  edit(def, (d) => { d.columns.splice(i, 1); });

export const moveColumn = (def: ScheduleDef, from: number, to: number) =>
  edit(def, (d) => { moveItem(d.columns, from, to); });

/** Point a column at another property, keeping the heading the user reads. */
export const remapColumn = (def: ScheduleDef, i: number, field: FieldRef) => edit(def, (d) => {
  const col = d.columns[i];
  if (!col) return;
  col.heading = col.heading ?? headingOf(col, d);
  col.field = field;
});

const onColumn = (def: ScheduleDef, i: number, fn: (c: Column) => void) =>
  edit(def, (d) => { const c = d.columns[i]; if (c) fn(c); });

export const setHeading = (def: ScheduleDef, i: number, heading: string) =>
  onColumn(def, i, (c) => { c.heading = heading; });

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
