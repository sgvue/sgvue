// Whole-schedule intents: name, sorting/grouping, itemize, grand total, appearance.
// Sort actions on a missing level throw, as the in-place handlers did.

import { MAX_SORT_LEVELS, type Appearance, type FieldRef, type ScheduleDef, type SortLevel } from '../def';
import { edit, firstField, moveItem } from './edit';

export const setName = (def: ScheduleDef, name: string) =>
  edit(def, (d) => { d.name = name; });

// ---------- sorting / grouping ----------

/** A new level sorts and nothing else: header, footer and blank line all start off. At the
 *  cap, a no-op: parse keeps only MAX_SORT_LEVELS, so a fifth level would vanish on reload. */
export const addSortLevel = (def: ScheduleDef) => edit(def, (d) => {
  if (d.sort.length < MAX_SORT_LEVELS) d.sort.push({ field: firstField(d), dir: 'asc' } as SortLevel);
});

export const removeSortLevel = (def: ScheduleDef, k: number) =>
  edit(def, (d) => { d.sort.splice(k, 1); });

export const moveSortLevel = (def: ScheduleDef, from: number, to: number) =>
  edit(def, (d) => { moveItem(d.sort, from, to); });

export const setSortField = (def: ScheduleDef, k: number, field: FieldRef) =>
  edit(def, (d) => { d.sort[k].field = field; });

export const setSortDir = (def: ScheduleDef, k: number, dir: 'asc' | 'desc') =>
  edit(def, (d) => { d.sort[k].dir = dir; });

/** Header row, footer style, blank line — what a level shows around its group. */
export const setGroupOptions = (
  def: ScheduleDef, k: number, patch: Partial<Pick<SortLevel, 'header' | 'footer' | 'blankLine'>>,
) => edit(def, (d) => { Object.assign(d.sort[k], patch); });

export const setItemize = (def: ScheduleDef, itemize: boolean) =>
  edit(def, (d) => { d.itemize = itemize; });

export const setGrandTotal = (def: ScheduleDef, on: boolean) =>
  edit(def, (d) => { d.grandTotal = on; });

export const setGrandTotalTitle = (def: ScheduleDef, title: string) =>
  edit(def, (d) => { d.grandTotalTitle = title; });

// ---------- appearance ----------

/** Title, toggles, font, size. Font size arrives already clamped by the caller. */
export const setAppearance = (def: ScheduleDef, patch: Partial<Appearance>) => edit(def, (d) => {
  d.appearance = d.appearance ?? {};
  Object.assign(d.appearance, patch);
});
