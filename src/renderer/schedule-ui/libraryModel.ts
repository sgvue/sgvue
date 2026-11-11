// The Templates library's data, with no DOM: one shape for both sources (a built-in preset and
// a setup saved in this window), the ordered list the library draws, and the rules behind its
// inline name row.
//
// Ported from ifcTable's `ui/libraryModel.ts` (Yong Yen, 2026-11-07, after d3c4989 — no
// arming, no start screen) for SGVue v1.5.0, phase 3. Built-in and saved share ONE row design
// and ONE action set; source shows as a section and a tag, never as a different shape — so
// everything below works on `Tpl`, and only `src` says which kind it is.
//
// SGVue: a built-in's definition is what Use applies here — `scheduleFromPreset` in the model's
// unit system, and with more than one model loaded the `Model` column first (`applyTemplate`,
// actions.ts) — so the preview shows exactly what the table will.

import { withModelColumn } from '../../schedule/schedule/columns';
import type { ModelStore } from '../../schedule/ifc/store';
import type { ScheduleDef } from '../../schedule/schedule/def';
import { PRESETS, scheduleFromPreset, type Preset } from '../../schedule/schedule/presets';
import { FULL_MESSAGE, isFull, listSaved, uniqueName, type SavedEntry } from './schedules';
import type { AppState } from './state';

export type Section = 'mine' | 'general' | 'ifcsg';

export interface Tpl {
  /** `b:<presetId>` or `m:<name>` — UI state only, never saved. */
  key: string;
  src: 'builtin' | 'mine';
  section: Section;
  name: string;
  entities: string[];
  /** What Use applies. A built-in's is built for the open model. */
  def: ScheduleDef;
  savedAt: string | null;
  preset?: Preset;
  /** Changes whenever what the key names changes (a save over it, a rename) — the caches' key. */
  cacheKey: string;
}

/** Said by a built-in's greyed Rename and Delete. */
export const READ_ONLY = 'Built-in templates are read-only — duplicate one to change it';

export const builtinKey = (id: string) => `b:${id}`;
export const mineKey = (name: string) => `m:${name}`;
/** The saved template's name a `m:` key names, or null for a built-in. */
export const mineName = (key: string | null) => (key?.startsWith('m:') ? key.slice(2) : null);

/** A built-in as Use applies it to this model (actions.ts `applyTemplate` builds the same). */
export function presetDef(p: Preset, store: ModelStore | null): ScheduleDef {
  const def = scheduleFromPreset(p, store?.meta.unitSystem);
  if (store) def.columns = withModelColumn(def.columns, store);
  return def;
}

/** Every template, Mine first. Built from PRESETS directly, not presetsFor(): a template
 *  whose class this model lacks still lists, under "Not in this model". */
export function templates(store: ModelStore | null): Tpl[] {
  const mine: Tpl[] = listSaved().map((s) => ({
    key: mineKey(s.name), src: 'mine', section: 'mine', name: s.name,
    entities: s.def.entity, def: s.def, savedAt: s.savedAt,
    cacheKey: `${mineKey(s.name)}|${s.savedAt}`,
  }));
  const built: Tpl[] = PRESETS.map((p) => ({
    key: builtinKey(p.id), src: 'builtin', section: p.section === 'ifcsg' ? 'ifcsg' : 'general',
    name: p.name, entities: p.entities, def: presetDef(p, store), savedAt: null,
    preset: p, cacheKey: builtinKey(p.id),
  }));
  return [...mine, ...built];
}

/** Elements of the template's classes in this model, before any filter. */
export function classCount(store: ModelStore, t: Pick<Tpl, 'entities'>): number {
  return t.entities.reduce((n, e) => n + (store.byEntity.get(e)?.length ?? 0), 0);
}

/** The template the schedule on screen came from, or null for a generated one. */
export function currentKey(state: AppState): string | null {
  if (state.savedName) return mineKey(state.savedName);
  if (state.templateId) return builtinKey(state.templateId);
  return null;
}

export type Item =
  | { type: 'sec'; id: Section; label: string; n: number; shut: boolean }
  | { type: 'row'; tpl: Tpl; absent: boolean }
  | { type: 'absent'; id: Section; n: number; open: boolean }
  | { type: 'empty' }
  | { type: 'saving' };

/** What a sort reads off a template that its definition cannot say: counts on this model. */
export interface Measure {
  /** Elements the template lists on this model; undefined while still being counted. */
  count(t: Tpl): number | undefined;
  /** Fraction of its columns this model carries; undefined while still being measured. */
  fit(t: Tpl): number | undefined;
}

const SECTIONS: [Section, string][] = [['mine', 'Mine'], ['general', 'Built-in'], ['ifcsg', 'IFC-SG']];

function comparator(state: AppState, m: Measure) {
  const { by, dir } = state.librarySort;
  const name = (a: Tpl, b: Tpl) => a.name.localeCompare(b.name);
  const num = (f: (t: Tpl) => number) => (a: Tpl, b: Tpl) => dir * (f(a) - f(b)) || name(a, b);
  switch (by) {
    case 'cls': return (a: Tpl, b: Tpl) => dir * (a.entities[0] ?? '').localeCompare(b.entities[0] ?? '') || name(a, b);
    case 'count': return num((t) => m.count(t) ?? -1);
    case 'fit': return num((t) => m.fit(t) ?? -1);
    case 'dt': return (a: Tpl, b: Tpl) => dir * (a.savedAt ?? '').localeCompare(b.savedAt ?? '') || name(a, b);
    case 'name': return (a: Tpl, b: Tpl) => dir * name(a, b);
  }
}

/**
 * The list, top to bottom: sections, their rows, each section's folded "Not in this model"
 * group. Sorting applies inside each section. IFC-SG exists only where the model has its class.
 */
export function libraryItems(state: AppState, store: ModelStore, all: Tpl[], m: Measure): Item[] {
  const q = state.libraryQuery.trim().toLowerCase();
  const match = (t: Tpl) => !q || t.name.toLowerCase().includes(q)
    || t.entities.some((e) => e.toLowerCase().includes(q));
  const cmp = comparator(state, m);
  const saving = state.libraryDraft?.kind === 'save';
  const out: Item[] = [];
  for (const [id, label] of SECTIONS) {
    const inSection = all.filter((t) => t.section === id);
    if (id === 'ifcsg' && !inSection.some((t) => classCount(store, t) > 0)) continue;
    const list = inSection.filter(match).sort(cmp);
    if (q && !list.length && !(id === 'mine' && saving)) continue;
    const shut = state.libraryFolds.includes(`sec:${id}`);
    out.push({ type: 'sec', id, label, n: list.length, shut });
    if (shut) continue;
    if (id === 'mine' && saving) out.push({ type: 'saving' });
    if (id === 'mine' && !inSection.length && !saving) out.push({ type: 'empty' });
    const present = list.filter((t) => classCount(store, t) > 0);
    const absent = list.filter((t) => classCount(store, t) === 0);
    for (const tpl of present) out.push({ type: 'row', tpl, absent: false });
    if (!absent.length) continue;
    // Search opens it, so a match is never hidden behind a fold.
    const open = !!q || state.libraryFolds.includes(`abs:${id}`);
    out.push({ type: 'absent', id, n: absent.length, open });
    if (open) for (const tpl of absent) out.push({ type: 'row', tpl, absent: true });
  }
  return out;
}

export const visibleRows = (items: Item[]) =>
  items.flatMap((i) => (i.type === 'row' ? [i.tpl] : []));

/** The selection as drawn: the chosen key when it is on screen, else the first row. */
export function resolveSel(state: AppState, rows: Tpl[]): Tpl | null {
  return rows.find((t) => t.key === state.librarySel) ?? rows[0] ?? null;
}

/** ↑ ↓ PgUp PgDn Home End over the rows on screen. */
export function moveSel(rows: Tpl[], from: string | null, step: number | 'home' | 'end'): string | null {
  if (!rows.length) return null;
  const i = rows.findIndex((t) => t.key === from);
  const to = step === 'home' ? 0 : step === 'end' ? rows.length - 1
    : Math.max(0, Math.min(rows.length - 1, (i < 0 ? (step > 0 ? -1 : rows.length) : i) + step));
  return rows[to].key;
}

/** The folds after opening whatever hides `t`: its section, and — when it is absent from
 *  the model — its "Not in this model" group. Nothing the user opened is closed. */
export function revealFolds(folds: string[], t: Pick<Tpl, 'section'>, absent: boolean): string[] {
  const next = folds.filter((f) => f !== `sec:${t.section}`);
  if (absent && !next.includes(`abs:${t.section}`)) next.push(`abs:${t.section}`);
  return next;
}

/**
 * The live note under "Save current": what pressing Enter would do. `saved` is the saved list —
 * the library passes the one it has just read for this paint, so a keystroke reads storage once.
 */
export function saveNote(
  text: string, savedName: string | null, saved: readonly Pick<SavedEntry, 'name'>[] = listSaved(),
): { note: string; error: boolean } {
  const name = text.trim();
  const names = saved.map((s) => s.name);
  if (!name) return { note: 'A name is needed', error: true };
  if (name === savedName && names.includes(name)) return { note: 'Replaces the saved one you loaded', error: false };
  if (isFull(null, saved)) return { note: FULL_MESSAGE, error: true };
  if (names.includes(name)) return { note: `Name taken — saves as “${uniqueName(name, names)}”`, error: false };
  return { note: 'Enter to save · Esc to cancel', error: false };
}

/** Why a rename cannot go through, or '' when it can. */
export function renameError(text: string, oldName: string): string {
  const name = text.trim();
  if (!name) return 'A name is needed';
  if (name !== oldName && listSaved().some((s) => s.name === name)) return 'Another saved template has that name';
  return '';
}

/** "28 Oct" — a saved template's day, local calendar. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10)
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
