// What the Templates library knows about the open model, computed once and kept until the
// model changes: how many elements a filtered template lists, and the selected template's first
// rows (with, for a filtered one, exact per-column counts over the rows it keeps).
//
// Ported from ifcTable's `ui/libraryCache.ts` (Yong Yen, 2026-11-07) for SGVue v1.5.0, phase 3.
// Measured there on a 50,000-element model: runSchedule capped at 6 rows on 20,000 walls is
// ~400 ms, and coverage for every class set the templates name ~500 ms. So nothing here is
// computed twice, the selected template comes first, and the rest arrive one per task behind a
// placeholder — the list is never held up waiting for the slowest row.
//
// Whole-class coverage lives in coverage.ts (a per-model Map). This file never runs a second
// sort or filter: every count comes out of the engine.
//
// SGVue: `fit` and `inModel` — the template gallery's two figures, which the assistant's
// `manage_schedules` `templates` lists (manage.ts) — moved here from the gallery when it went,
// unchanged, so the answer it gives is the one it gave.

import type { ModelStore } from '../../schedule/ifc/store';
import { runSchedule, type RenderRow, type ScheduleResult } from '../../schedule/schedule/engine';
import { presetCount, scheduleFromPreset, type Preset } from '../../schedule/schedule/presets';
import { resolveField } from '../../schedule/schedule/resolve';
import { buildCoverage, isNoValue, peekCoverage, populated, type Coverage } from './coverage';
import { classCount, libraryItems, resolveSel, templates, visibleRows, type Item, type Tpl } from './libraryModel';
import { paintLibrary } from './libraryPaint';
import type { AppState } from './state';

/** Data lines in the preview. */
export const PREVIEW_ROWS = 6;
/** A cache miss waits this long, so holding ↓ does not queue a run per row it passes. */
export const PREVIEW_DELAY = 120;

export interface Preview {
  res: ScheduleResult;
  /** Elements the template lists — after its filter. */
  matched: number;
  /** A filtered template only: per def.columns, how many of its OWN rows carry a value. */
  found?: number[];
}

let owner: ModelStore | null = null;
const counts = new Map<string, number>();
const previews = new Map<string, Preview>();

/** Forget the model that went. main.ts calls it beside clearCoverageCache(). */
export function clearLibraryCache() {
  cancelPreview();
  owner = null;
  counts.clear();
  previews.clear();
  jobs.length = 0;
  queued.clear();
}

function own(store: ModelStore) {
  if (owner !== store) { clearLibraryCache(); owner = store; }
}

// ---------------------------------------------------------------- background fill

const jobs: (() => void)[] = [];
const queued = new Set<string>();
let pumping = false;

/** One job per task, then a library paint so its placeholder fills in. */
function enqueue(id: string, store: ModelStore, job: () => void) {
  if (queued.has(id)) return;
  queued.add(id);
  jobs.push(() => { if (owner === store) job(); });
  if (pumping) return;
  pumping = true;
  const step = () => {
    jobs.shift()?.();
    paintLibrary();
    if (jobs.length) setTimeout(step, 0);
    else pumping = false;
  };
  setTimeout(step, 0);
}

// ---------------------------------------------------------------- what each row shows

/** "N in model". A filtered template asks the engine — its class count would be wrong. */
export function inModelOf(store: ModelStore, t: Tpl): number | undefined {
  const total = classCount(store, t);
  if (!total || !t.def.filters.length) return total;
  own(store);
  const hit = counts.get(t.cacheKey) ?? previews.get(t.cacheKey)?.matched;
  if (hit !== undefined) return hit;
  enqueue(`n:${t.cacheKey}`, store, () => {
    counts.set(t.cacheKey, runSchedule(store, t.def, { cap: 0 }).matchedElements);
  });
  return undefined;
}

/**
 * Columns found, over the whole class (list rows, ifcTable's owner decision 2). `now` builds the
 * coverage on the spot — the selected template comes first; the rest wait their turn.
 */
export function fitOf(store: ModelStore, t: Tpl, now = false): { found: number; of: number } | undefined {
  const of = t.def.columns.length;
  if (!classCount(store, t)) return { found: 0, of };
  const cov = now ? buildCoverage(store, t.entities) : peekCoverage(store, t.entities);
  if (!cov) {
    own(store);
    enqueue(`c:${t.entities.join('|')}`, store, () => { buildCoverage(store, t.entities); });
    return undefined;
  }
  return { found: t.def.columns.filter((c) => populated(cov, c.field) > 0).length, of };
}

/** The first rows of the template on this model, or undefined until they have been run. */
export function previewOf(store: ModelStore, t: Tpl): Preview | undefined {
  own(store);
  return previews.get(t.cacheKey);
}

let pending: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;

/** Drop a preview still waiting to run — nobody is looking at it. The background coverage
 *  fill keeps going: it fills a cache the next opening reads. */
export function cancelPreview() {
  if (pending) { clearTimeout(pending.timer); pending = null; }
}

/**
 * Ask for the selected template's preview. A hit costs nothing; a miss waits PREVIEW_DELAY,
 * and asking for a different template first drops the wait — so holding ↓ runs only the row
 * it stops on.
 */
export function wantPreview(store: ModelStore, t: Tpl) {
  own(store);
  if (pending && pending.key !== t.cacheKey) { clearTimeout(pending.timer); pending = null; }
  if (pending || previews.has(t.cacheKey)) return;
  pending = {
    key: t.cacheKey,
    timer: setTimeout(() => {
      pending = null;
      if (owner !== store || previews.has(t.cacheKey)) return;
      previews.set(t.cacheKey, computePreview(store, t));
      paintLibrary();
    }, PREVIEW_DELAY),
  };
}

/** Data and group lines up to PREVIEW_ROWS data lines — what the preview table draws. */
function firstRows(rows: RenderRow[]): RenderRow[] {
  const out: RenderRow[] = [];
  let data = 0;
  for (const r of rows) {
    if (r.kind === 'data') { if (data === PREVIEW_ROWS) break; data++; out.push(r); }
    else if (r.kind === 'group') out.push(r);
  }
  // A heading the cap cut off before its first line heads nothing.
  while (out.length && out[out.length - 1].kind === 'group') out.pop();
  return out;
}

export function computePreview(store: ModelStore, t: Tpl): Preview {
  if (!t.def.filters.length) {
    const res = runSchedule(store, t.def, { cap: PREVIEW_ROWS });
    return { res: { ...res, rows: firstRows(res.rows) }, matched: res.matchedElements };
  }
  // Filtered: every row it keeps, once, so the per-column counts are over THOSE rows rather
  // than the whole class. Placeholders count as no value, as in coverage.
  const res = runSchedule(store, t.def, { cap: Infinity });
  const kept = res.rows.flatMap((r) => (r.kind === 'data' ? r.rows : []));
  const found = t.def.columns.map((c) => (c.field.kind === 'formula' ? kept.length
    : kept.filter((r) => {
      const cell = resolveField(store, r, c.field);
      return cell !== undefined && cell.v !== null && cell.v !== undefined && !isNoValue(cell.v);
    }).length));
  return { res: { ...res, rows: firstRows(res.rows) }, matched: res.matchedElements, found };
}

// ---------------------------------------------------------------- the list, as drawn

export interface LibraryView { all: Tpl[]; items: Item[]; rows: Tpl[]; sel: Tpl | null }

/** The library exactly as the next paint draws it — the handlers read the same thing. */
export function libraryView(state: AppState, store: ModelStore): LibraryView {
  const all = templates(store);
  const items = libraryItems(state, store, all, {
    count: (t) => inModelOf(store, t),
    fit: (t) => {
      const f = fitOf(store, t);
      return f && f.of ? f.found / f.of : f ? 0 : undefined;
    },
  });
  const rows = visibleRows(items);
  return { all, items, rows, sel: resolveSel(state, rows) };
}

// ---------------------------------------------------------------- the assistant's two figures

/**
 * How many of a template's columns resolve on at least one of its elements — counted over
 * every class the template names, since that union is exactly what applying it will show.
 * (The gallery card's figure, 2026-09-25; `manage_schedules` `templates` lists it.)
 */
export function fit(store: ModelStore, p: Preset, cache: Map<string, Coverage>): { found: number; of: number } {
  const key = p.entities.join('+');
  const cov = cache.get(key) ?? buildCoverage(store, p.entities);
  cache.set(key, cov);
  const found = p.columns.filter((c) => populated(cov, c.field) > 0).length;
  return { found, of: p.columns.length };
}

/**
 * "N in model". A filtered template is asked through the engine rather than counted by class:
 * several IFC-SG templates share IfcGeographicElement and differ only by their rule. `cap: 0`
 * because only the total is wanted here, never the lines.
 */
export function inModel(store: ModelStore, p: Preset): number {
  if (!p.filters?.length) return presetCount(store.byEntity, p);
  return runSchedule(store, scheduleFromPreset(p), { cap: 0 }).matchedElements;
}
