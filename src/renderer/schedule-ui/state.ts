// One AppState, one update(), one render() — ported from ifcTable's `state.ts` (2026-09-25,
// phase 2 of the Schedules window). Only this folder touches the DOM; `src/schedule/` never
// does. What SGVue drops: the loading / error fields and the start screen they served (the
// model comes from the main window), the theme (it follows the main window's) and the app
// bar's export menu (phase 4 adds export).
//
// ifcTable's two render scopes — 'all' rebuilds every pane, 'table' only the schedule and the
// status line — plus SGVue's third, 'panes' (2026-09-25): everything BUT the schedule, for a
// change that cannot alter it (a search box, a list filter). On a 4 082-row category the table
// is the whole cost of a paint (~0.4–0.5 s, DECISIONS.md), so a keystroke in the field browser
// must not rebuild it. main.ts restores focus, caret and scroll around every repaint.

import { record } from '../../schedule/history';
import type { ModelStore } from '../../schedule/ifc/store';
import { emptySchedule, type ScheduleDef } from '../../schedule/schedule/def';

/** The five inspector tabs. Exactly one is active; the whole panel can collapse instead. */
export type Section = 'fields' | 'filter' | 'sort' | 'format' | 'appearance';
/** `formula` is the in-window syntax guide ifcTable served as `/formula.html`. */
type Overlay = 'fields' | 'templates' | 'saved' | 'formula';
export type RenderScope = 'all' | 'table' | 'panes';
type FieldType = 'all' | 'number' | 'text' | 'bool';

export interface AppState {
  store: ModelStore | null;
  def: ScheduleDef;

  /** The active inspector tab. Stays put while the panel is collapsed, so reopening
   *  lands where the user left off. */
  open: Section;
  /** Whether the inspector is expanded, or collapsed to its icon strip. Ordinary app
   *  state, like railOpen — render() reads it back on every paint. */
  inspectorOpen: boolean;
  overlay: Overlay | null;
  /** Index into def.columns, for the Column formatting section. */
  selectedColumn: number | null;
  /**
   * Columns marked at their headings, as def.columns indices. A grip is solo by default, so
   * this set is the only way a drag or a double-click moves more than one column — it is how
   * "make these equal" is said. Transient UI, deliberately NOT in ScheduleDef — frozen schema,
   * and a selection is not part of a saved schedule. Anything that replaces or reorders
   * def.columns must clear it, or the marks point at columns that have moved.
   */
  selectedCols: number[];
  /** True once the user has edited the definition — guards destructive switches. */
  dirty: boolean;
  /**
   * Which template this schedule was started from, for the gallery's IN USE badge.
   * Deliberately NOT part of ScheduleDef — a saved schedule records its provenance in
   * meta.notes, and the save format stays frozen.
   */
  templateId: string | null;
  /**
   * Which saved setup this schedule came from — the same idea as templateId, and equally
   * NOT part of ScheduleDef. Matching on `def.name` instead was wrong in both directions:
   * a freshly generated "Door Schedule" claimed to be the saved one, and renaming a loaded
   * setup made it stop claiming to be anything.
   */
  savedName: string | null;

  /**
   * Whether the left rail is showing. Ordinary app state, not motion state: render() reads
   * it back on every paint. Deliberately not persisted — a session always starts by opening
   * a model anyway, and a rail that stays hidden across reloads hides the category list from
   * someone who has forgotten they collapsed it.
   */
  railOpen: boolean;
  /**
   * How the category list is ordered: by element count, or A→Z. Ordinary app state for the
   * same reason railOpen is — render() reads it back on every paint — and deliberately not
   * persisted either: a session starts by opening a model, and an order the user cannot see
   * they chose is an order they cannot undo.
   */
  railSort: 'count' | 'name';

  // transient search / filter boxes
  railQuery: string;
  fieldSearch: string;
  fieldType: FieldType;
  /** 'all', or a property-set name to narrow the field browser to. */
  fieldPset: string;
  hideEmpty: boolean;
  templateQuery: string;
  /** Search text in the My templates panel — transient, like templateQuery. */
  savedQuery: string;

  /**
   * Index of the filter rule whose removals are being previewed. When set, the table
   * shows exactly the rows that one rule drops while every other rule still applies.
   */
  removedBy: number | null;
  /**
   * The colour rule whose rows are being previewed: a column's index in def.columns and a
   * rule's index within that column. When set, the table shows exactly the rows that one
   * rule colours, every filter still applying. Transient like removedBy and equally NOT in
   * ScheduleDef — a preview is not part of a saved schedule, and the format is frozen. The
   * two previews are mutually exclusive, and anything that replaces def must clear this or
   * it narrows the table by whatever now sits at that position.
   */
  litBy: { col: number; rule: number } | null;
  /**
   * SGVue: the selected elements as store rows (indexes into `store.cores`) — the main
   * window's selection as this window sees it (phase 3: both ways), or the rows clicked here.
   * Store rows rather than table rows, so the marks follow the elements through every
   * re-sort, regroup and collapse: the table marks every data row that carries one. Cleared
   * when a new snapshot arrives, since store rows are per snapshot.
   */
  selected: Set<number>;
  /** SGVue: the store row Shift-click ranges and the arrow keys start from. */
  anchor: number | null;
  /** SGVue: how many elements are selected in the main window, in this table or not. */
  sel3d: number;
  /** SGVue: something is selected in 3D and no row on screen holds any of it. */
  selAway: boolean;
  /** SGVue: the categories that hold that selection instead — the rail marks them. */
  selEntities: string[];
  /** SGVue: the main window's visibility, as far as the row menu needs it. */
  vis: { hidden: Set<number>; total: number; storeysClean: boolean; allShown: boolean };
  /**
   * SGVue: the 3D colour-by scheme. `live` whenever the main window shows one; `key` and
   * `map` only while it is the one this window asked for — the column (`fieldKey`) it came
   * from and each displayed value's colour.
   */
  colours: { live: boolean; key: string | null; map: Map<string, string> };
}

export const state: AppState = {
  store: null,
  def: emptySchedule(),

  open: 'fields',
  inspectorOpen: true,
  overlay: null,
  selectedColumn: null,
  selectedCols: [],
  dirty: false,
  templateId: null,
  savedName: null,
  railOpen: true,
  railSort: 'count',

  railQuery: '',
  fieldSearch: '',
  fieldType: 'all',
  fieldPset: 'all',
  hideEmpty: true,
  templateQuery: '',
  savedQuery: '',

  removedBy: null,
  litBy: null,
  selected: new Set(),
  anchor: null,
  sel3d: 0,
  selAway: false,
  selEntities: [],
  vis: { hidden: new Set(), total: 0, storeysClean: true, allShown: true },
  colours: { live: false, key: null, map: new Map() },
};

type Renderer = (scope: RenderScope) => void;
let renderer: Renderer = () => {};

export function setRenderer(fn: Renderer) { renderer = fn; }

/**
 * The parts of the window a deferred change has left out of date — `renderSoon`'s ledger. A
 * paint of a scope crosses its parts off, whoever asked for it, so a change that is followed
 * by an ordinary repaint never costs a second one.
 */
const stale = new Set<'table' | 'panes'>();
let pointerDown = false;
let queued = false;

function paint(scope: RenderScope) {
  renderer(scope);
  // Crossed off AFTER the paint: main.ts's paint lands a pending typed edit first, which asks
  // for a paint of its own — and this one has just drawn it, so that ask is answered here and
  // the queued task finds nothing left to do.
  if (scope === 'all') stale.clear(); else stale.delete(scope);
}

/** Merge a patch into state and repaint. */
export function update(patch: Partial<AppState>, scope: RenderScope = 'all') {
  Object.assign(state, patch);
  // Replacing the definition wholesale — a template, a saved schedule, a category switch
  // — is as undoable as editing one. A restored state records as unchanged, so undo
  // itself never lands back on the stack.
  if (patch.def) record(state.def);
  paint(scope);
}

/** Mutate the schedule definition in place and repaint. Marks the definition dirty. */
export function updateDef(fn: (def: ScheduleDef) => void, scope: RenderScope = 'all') {
  editDef(fn);
  paint(scope);
}

/** `updateDef` without the repaint — for a typed edit committed from inside a gesture. */
export function editDef(fn: (def: ScheduleDef) => void) {
  fn(state.def);
  state.dirty = true;
  record(state.def);
}

export function render(scope: RenderScope = 'all') { paint(scope); }

/**
 * Repaint `scope` on a later task, and never while a pointer button is down.
 *
 * A typed edit is committed the moment focus leaves its box (pending.ts) — which, for a
 * click, is inside the pointerdown. Repainting there would rebuild the very element under the
 * pointer, the release would land on a new one, and the click would go to their common
 * ancestor instead (ifcTable LESSONS, 2026-09-11). So the paint waits for the release, and
 * then for a task: the click is dispatched in the same task as the pointerup, so a timer
 * always lands after it — by which time the click's own handler has usually repainted and
 * crossed the parts off.
 */
export function renderSoon(scope: RenderScope) {
  if (scope === 'all') { stale.add('table'); stale.add('panes'); } else stale.add(scope);
  if (!pointerDown) queue();
}

/** pending.ts reports the pointer; a release lets a waiting paint go. */
export function setPointerDown(down: boolean) {
  pointerDown = down;
  if (!down && stale.size) queue();
}

function queue() {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    if (pointerDown || !stale.size) return;
    paint(stale.size === 2 ? 'all' : [...stale][0]);
  }, 0);
}
