// The Schedules window's composition root — 2026-09-25 (phase 1: the port, the rail and the
// table; phase 2: the whole of ifcTable's interface).
//
// Vanilla DOM, as ifcTable is: its panes are string renderers written in one innerHTML each,
// driven by one `state` / `update()` / `render()` (state.ts), with every event delegated from
// `#app` (events.ts) and focus, caret and scroll kept across repaints (preserve.ts). The
// window holds no model of its own beyond the snapshot the main window sends over the private
// port, indexed by ifcTable's `StoreBuilder`.
//
//   port → `store`  → index it, keep the open schedule if its category survives, repaint
//   port → `theme`  → the same `data-theme` switch the main window uses
//   row click       → `select` with the row's elements, zoomed, back over the port
//
// Phase 3 (2026-09-25):
//   port → `selection` → mark every row carrying a selected element, IN PLACE (no repaint:
//                        a 4 000-row table takes ~0.4 s to rebuild); scroll to the first unless
//                        the table made it; say so in the status line and mark the rail when
//                        none of it is in this table
//   port → `vis`       → what the row menu enables
//   port → `colours`   → the swatches before the colour-by column's values
//   Ctrl/⌘-click, Shift-click, ↑ / ↓ / Enter → `select`; the row menu → `act`; the heading
//   menu → `colourBy` / `clearColours`
//
// 2026-09-28 — the assistant:
//   port → `define`   → a schedule the assistant made or changed: read by `parseScheduleDef`,
//                       shown as the current, unsaved schedule on this window's own undo history,
//                       and said in the existing toast (`Schedule from Ask Vee` since 2026-10-01,
//                       when the assistant got its name)
//   `current`         → the schedule on screen, back to the main window after every paint that
//                       changed it (at most one per 250 ms) and on every new port
//   port → `export`   → `export_schedule`: the Export menu's own action for that entry (its
//                       native Save dialog, its toast), or the menu's reason not to — answered
//                       at once by `exportAck`, never after the dialog
//
// 2026-10-02 — parity with the user, phase 4:
//   port → `manage`   → `manage_schedules`: one of this window's own actions (manage.ts, over
//                       actions.ts — the functions the click handlers call): undo, redo, a
//                       template, a saved setup; a deletion, Print and Open schedule file only
//                       raise this window's own dialog. Answered at once by `manageAck`, the
//                       schedule on screen posted ahead of it

import '../styles/fonts.css';
import '../styles/design.css';
import '../styles/hover.css';
import '../styles/a11y.css';
import './schedule.css';
import './print.css';

import { CH_SCHEDULE_PORT } from '../../shared/ipc-channels';
import { trapTab, focusables } from '../app/focus-trap';
import { copyText } from '../clipboard';
import type { ScheduleSnapshot } from '../../schedule/adapter';
import { resetHistory } from '../../schedule/history';
import { colourColumn } from '../../schedule/colour';
import { MANAGE_FRESH_MS, ToSchedules, type ActKind, type ExportFormat } from '../../schedule/messages';
import { StoreBuilder } from '../../schedule/ifc/store';
import { openingSchedule } from '../../schedule/schedule/columns';
import { parseScheduleDef, type ScheduleDef } from '../../schedule/schedule/def';
import { runSchedule, type ScheduleResult } from '../../schedule/schedule/engine';
import { wireColumnResize } from './colResize';
import { buildCoverage, type Coverage } from './coverage';
import { dialogOpen } from './dialog';
import { byId, flash } from './dom';
import { EXPORT_ACTIONS, exportRefusal } from './exporting';
import { wireApp } from './events';
import { renderHeader, renderStatus, selNoteHtml } from './header';
import { renderInspector } from './inspector';
import { manageFromChat } from './manage';
import { openMenu } from './menu';
import { renderOverlay } from './overlays';
import { flushPending, wirePending } from './pending';
import { restoreUi, snapshotUi, type Ui } from './preserve';
import { renderRail } from './rail';
import { initInspectorWidth, wireInspectorResize } from './resize';
import {
  markedRows, nextDataRow, rangeElements, rowMenu, rowOfElement, type RowMenuItem,
} from './selection';
import { render, renderSoon, setRenderer, state, update, updateDef, type RenderScope } from './state';
import { renderSchedule } from './tableView';

const app = byId('app');
const header = byId('header');
const layout = byId('layout');
const railPane = byId('rail-pane');
const outputPane = byId('output-pane');
const statusBar = byId('status-bar');
const inspectorPane = byId('inspector-pane');
const overlayRoot = byId('overlay-root');
const emptyPane = byId('empty-pane');

let port: MessagePort | null = null;
/** Federation id of each store row, from the snapshot. */
let rowIds: number[] = [];
/** Store row of each federation id — `rowIds` the other way. */
let rowOf = new Map<number, number>();
/** The main window's selection, as federation ids — this window's too, both ways. */
let selIds: number[] = [];
/** The result on screen, so a row click can name the elements behind it. */
let shown: ScheduleResult | null = null;
/** Each drawn data row's `<tr>` by its index in `shown.rows`; found once per table paint. */
let drawn: Map<number, HTMLElement> | null = null;

function drawnRows(): Map<number, HTMLElement> {
  if (!drawn) {
    drawn = new Map();
    for (const tr of outputPane.querySelectorAll<HTMLElement>('tr[data-row]')) drawn.set(Number(tr.dataset.row), tr);
  }
  return drawn;
}

// Which fields the category actually carries. Recomputed only on a full pass — every coverage
// bar, badge and fit score reads it.
let coverage: Coverage = { total: 0, byKey: new Map(), byProp: new Map(), byCore: new Map() };

// ---------- overlays own the keyboard ----------
// ifcTable's overlays had neither; SGVue's Preferences does (`app/focus.ts`), so these match
// it: focus goes into the card when it opens, Tab stays inside, and focus goes back to the
// control that opened it when it closes — found again by the same identity preserve.ts uses,
// since that control has been redrawn in between.
let overlayShown: AppOverlay = null;
let opener: Pick<Ui, 'pane' | 'path'> | null = null;
type AppOverlay = typeof state.overlay;

function settleOverlayFocus(ui: Ui) {
  if (state.overlay === overlayShown) return;
  const was = overlayShown;
  overlayShown = state.overlay;
  if (state.overlay) {
    if (!was) opener = { pane: ui.pane, path: ui.path };
    // Its search or name box when it has one — what the card is opened to type into — and
    // otherwise the first control Tab would reach.
    const card = overlayRoot.querySelector<HTMLElement>('.overlay-card');
    const box = card?.querySelector<HTMLElement>('input[type="search"], input[type="text"]');
    if (card) (box ?? focusables(card)[0] ?? card).focus({ preventScroll: true });
    return;
  }
  const back = opener?.path
    ? (opener.pane ? document.querySelector(opener.pane) : document)?.querySelector<HTMLElement>(opener.path)
    : null;
  opener = null;
  back?.focus({ preventScroll: true });
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !state.overlay || dialogOpen()) return;
  const card = overlayRoot.querySelector<HTMLElement>('.overlay-card');
  if (card && trapTab(card, e)) e.preventDefault();
});

// ---------- rendering ----------

function paint(scope: RenderScope) {
  // A box with a pending edit must never be redrawn from the older text in the definition.
  // Landing it only changes state and asks renderSoon for a paint; it never paints itself, so
  // this cannot recurse, and state.ts crosses that ask off once this paint has drawn it.
  flushPending();
  const ui = snapshotUi();
  const { store, def } = state;

  if (!store || !store.entities.length) {
    layout.hidden = true;
    header.hidden = true;
    emptyPane.hidden = false;
    overlayRoot.innerHTML = '';
    overlayShown = null;
    shown = null;
    drawn = null;
    queueCurrent();
    return;
  }
  layout.hidden = false;
  header.hidden = false;
  emptyPane.hidden = true;

  // Collapsed panes stay in the layout as thin strips — the way back in lives where the pane
  // was.
  railPane.classList.toggle('closed', !state.railOpen);
  inspectorPane.classList.toggle('closed', !state.inspectorOpen);

  // 'panes' (a search box, a list filter) leaves the schedule as it is: no engine run, no
  // coverage sweep, no table — the table is the whole cost of a paint on a large category.
  // With nothing on screen yet there is nothing to keep, so it paints everything.
  const full = scope === 'all' || !shown;
  const panes = full || scope === 'panes';
  const table = full || scope === 'table';

  // Run FIRST, then paint. The rules panel reports what each colour rule claims, and it can
  // only read that off the result — so the result has to exist before the inspector is built.
  let ms = 0;
  if (table) {
    const t0 = performance.now();
    shown = runSchedule(store, def, {
      ...(state.removedBy === null ? {} : { invertRule: state.removedBy }),
      ...(state.litBy === null ? {} : { litBy: state.litBy }),
    });
    ms = performance.now() - t0;
  }
  const res = shown!;
  // Which rows the selection marks, and whether it is somewhere else — before the rail and
  // the status line are drawn, since both say so.
  deriveSelection(res);

  if (full) coverage = buildCoverage(store, def.entity);
  if (panes) {
    railPane.innerHTML = renderRail(state, store);
    inspectorPane.innerHTML = renderInspector(state, store, coverage, res);
    overlayRoot.innerHTML = renderOverlay(state, store, coverage);
  }
  // The header on every scope: its undo / redo buttons follow every edit, and the name box
  // it holds is kept focused by preserve.ts like any other.
  header.innerHTML = renderHeader(state);
  if (table) {
    outputPane.innerHTML = renderSchedule(state, res, coverage);
    drawn = null;
    statusBar.innerHTML = renderStatus(state, res, coverage, ms);
  }

  restoreUi(ui);
  settleOverlayFocus(ui);
  if (ms > 120) console.warn(`[schedules] schedule took ${ms.toFixed(0)}ms`);
  queueCurrent();
}

setRenderer(paint);

// ---------- the schedule on screen, for the assistant (2026-09-28) ----------

/** The last `current` posted, as JSON, so an unchanged schedule is never sent twice. */
let sentCurrent = '';
let currentTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Tell the main window which schedule is on screen and how many rows its table shows — at most
 * one post per 250 ms, carrying whatever is on screen when the timer fires, and only when it
 * changed. `null` while the window shows none. The count is the painted result's own; while a
 * preview narrows the table (a filter's removals, a colour rule's rows) it is the schedule's
 * without the preview.
 */
function queueCurrent(): void {
  if (currentTimer) return;
  currentTimer = setTimeout(postCurrent, 250);
}

/** The schedule on screen, posted now if it is not what was posted last. */
function postCurrent(): void {
  clearTimeout(currentTimer);
  currentTimer = undefined;
  if (!port) return;
  const store = state.store;
  const def = store?.entities.length ? state.def : null;
  const previewing = state.removedBy !== null || state.litBy !== null;
  const rowCount = !def || !store ? 0
    : shown && !previewing ? shown.totalDataRows
      : runSchedule(store, def, { cap: 0 }).totalDataRows;
  const json = JSON.stringify([def, rowCount]);
  if (json === sentCurrent) return;
  sentCurrent = json;
  port.postMessage({ type: 'current', def, rowCount });
}

/** A schedule the assistant made or changed. Anything `parseScheduleDef` refuses is ignored. */
function define(raw: unknown, kind: 'made' | 'edited'): void {
  if (!state.store) return;
  let def: ScheduleDef;
  try {
    def = parseScheduleDef(raw);
  } catch {
    return;
  }
  // A half-typed edit belongs to the schedule on screen: land it before that is replaced.
  flushPending();
  // Whatever was queued for the old schedule is dropped; the paint below queues this one, and
  // it is always echoed back.
  clearTimeout(currentTimer);
  currentTimer = undefined;
  sentCurrent = '';
  update({
    def,
    dirty: true,
    // Column marks and previews name positions in the old column list.
    selectedColumn: null, selectedCols: [], removedBy: null, litBy: null,
    // A new schedule is nobody's template or saved setup; a changed one still is, edited.
    ...(kind === 'made' ? { templateId: null, savedName: null } : {}),
  });
  // The assistant by its own name, as the main window's panel and pill call it (2026-10-01).
  flash(kind === 'made' ? 'Schedule from Ask Vee' : 'Schedule changed by Ask Vee');
}

// ---------- printing ----------

// The on-screen table is capped for responsiveness; a printout must never be. beforeprint
// re-renders uncapped (covers both the Print button and Ctrl+P), afterprint restores.
let printing = false;
window.addEventListener('beforeprint', () => {
  const { store, def } = state;
  if (!store) return;
  printing = true;
  outputPane.innerHTML = renderSchedule(state, runSchedule(store, def, { cap: Infinity }), coverage);
  drawn = null;
});
window.addEventListener('afterprint', () => {
  if (!printing) return;
  printing = false;
  render('table');
});

// ---------- the port ----------

function load(snapshot: ScheduleSnapshot): void {
  // A half-typed edit belongs to the definition on screen: land it before that is replaced.
  flushPending();
  const b = new StoreBuilder();
  b.add(snapshot.cores, snapshot.cells);
  const store = b.finish(snapshot.meta);
  rowIds = snapshot.rowIds;
  rowOf = new Map(rowIds.map((id, r) => [id, r]));
  // Store rows are per snapshot: the marks come back with the `selection` main sends after
  // every snapshot.
  selIds = [];
  // The open schedule stays when the new federation still carries its category — ifcTable's
  // own rule for a setup armed before a model was chosen. Then so do its history and its
  // markers; otherwise the history refers to categories that are gone, and starts again.
  const { def, fits } = openingSchedule(store, state.store ? state.def : null);
  if (!fits) resetHistory(def);
  update({
    store,
    def,
    selected: new Set(),
    anchor: null,
    sel3d: 0,
    ...(fits ? {} : {
      selectedColumn: null, selectedCols: [], removedBy: null, litBy: null,
      templateId: null, savedName: null, dirty: false, open: 'fields' as const, overlay: null,
    }),
  });
}

function receive(data: unknown): void {
  const msg = ToSchedules.safeParse(data);
  if (!msg.success) return;
  const m = msg.data;
  switch (m.type) {
    case 'theme':
      document.documentElement.dataset.theme = m.theme;
      return;
    case 'store':
      // The validated original, not zod's copy: cells shared between elements stay shared.
      load((data as { snapshot: ScheduleSnapshot }).snapshot);
      return;
    case 'selection':
      applySelection(m.ids, m.quiet);
      return;
    case 'vis':
      state.vis = { hidden: new Set(m.hidden), total: m.total, storeysClean: m.storeysClean, allShown: m.allShown };
      return;
    case 'define':
      define(m.def, m.kind);
      return;
    case 'export':
      exportFromChat(m.format, m.n);
      return;
    case 'manage': {
      // A request this window gets to too late has been given up on by whoever asked it: a
      // renderer held up by its print dialog must not save, load or print for it afterwards.
      if (Date.now() - m.at > MANAGE_FRESH_MS) return;
      const { ack, then } = manageFromChat(m);
      // What the window shows now, ahead of the answer: an undo, a template or a loaded setup
      // has just changed it, and the assistant's next read must be of this schedule.
      postCurrent();
      port?.postMessage({ type: 'manageAck', n: m.n, ...ack });
      then?.();
      return;
    }
    case 'colours': {
      const map = new Map(m.entries.map((e) => [e.value, e.color]));
      const was = state.colours;
      const same = was.key === m.key && was.map.size === map.size
        && [...map].every(([v, c]) => was.map.get(v) === c);
      state.colours = { live: m.live, key: m.key, map };
      // The swatches are in the cells, so the table is drawn again — after any press is over.
      if (!same && state.store) renderSoon('table');
      return;
    }
  }
}

// ---------- selection, both ways (phase 3) ----------

/** Which rows the selection marks; sets the status line's note and the rail's marks. */
function deriveSelection(res: ScheduleResult): number[] {
  const on = markedRows(res, state.selected);
  state.selAway = state.sel3d > 0 && !on.length;
  const cores = state.store?.cores;
  state.selEntities = state.selAway && cores ? [...new Set([...state.selected].map((r) => cores[r].entity))] : [];
  return on;
}

/**
 * Mark the selection where it is drawn — the rows, the rail and the status line — without a
 * repaint, and scroll to its first row when asked. Returns the marked rows.
 */
function markSelection(scroll: boolean): number[] {
  if (!shown || layout.hidden) return [];
  const on = deriveSelection(shown);
  const want = new Set(on);
  for (const [i, tr] of drawnRows()) tr.classList.toggle('on', want.has(i));
  for (const b of railPane.querySelectorAll<HTMLElement>('[data-act="category"]')) {
    b.classList.toggle('sel-here', state.selEntities.includes(b.dataset.entity ?? ''));
  }
  const note = statusBar.querySelector('.sel-note');
  if (note) note.innerHTML = selNoteHtml(state, shown);
  if (scroll && on.length) reveal(drawnRows().get(on[0]), 'center');
  return on;
}

/**
 * Scroll a row into view, clear of the sticky heading. Done here, once, rather than with a
 * `scroll-margin` on every row, which doubled the table's layout (schedule.css).
 */
function reveal(tr: HTMLElement | undefined, block: 'center' | 'nearest'): void {
  if (!tr) return;
  tr.scrollIntoView({ block });
  const wrap = tr.closest<HTMLElement>('.table-wrap');
  const head = wrap?.querySelector('thead');
  if (!wrap || !head) return;
  const under = head.getBoundingClientRect().bottom - tr.getBoundingClientRect().top;
  if (under > 0) wrap.scrollTop -= under;
}

/** The main window's selection arrived. `quiet`: the table made it, or it is a re-send. */
function applySelection(ids: number[], quiet: boolean): void {
  selIds = ids;
  state.sel3d = ids.length;
  const rows = new Set<number>();
  for (const id of ids) {
    const r = rowOf.get(id);
    if (r !== undefined) rows.add(r);
  }
  state.selected = rows;
  const on = markSelection(!quiet);
  if (quiet) return;
  // A selection made in 3D is where the arrow keys carry on from.
  const first = on.length ? shown?.rows[on[0]] : undefined;
  state.anchor = first?.kind === 'data' ? first.rows.find((r) => rows.has(r)) ?? null : null;
}

/** The table's own selection: marked here at once, then told to the main window. */
function selectHere(rows: Set<number>, anchor: number | null, send: () => void): void {
  state.selected = rows;
  state.anchor = anchor;
  selIds = [...rows].map((r) => rowIds[r]);
  state.sel3d = selIds.length;
  markSelection(false);
  send();
}

const selectRows = (rows: Set<number>, anchor: number | null, zoom: boolean): void =>
  selectHere(rows, anchor, () => port?.postMessage({ type: 'select', ids: selIds, zoom }));

// `copyText` (the async API, then the textarea fallback) is `../clipboard` since 2026-10-02:
// the main window's two copy controls needed the same one.

function runRowItem(item: RowMenuItem, rows: Set<number>): void {
  if (item.kind === 'copy') {
    const cores = state.store?.cores ?? [];
    const guids = [...rows].map((r) => cores[r]?.guid).filter(Boolean);
    void copyText(guids.join('\n')).then((ok) => flash(ok
      ? `Copied ${guids.length.toLocaleString()} GUID${guids.length === 1 ? '' : 's'}.`
      : 'Could not copy — the clipboard is unavailable.', !ok));
    return;
  }
  const kind: ActKind = item.kind;
  const send = () => port?.postMessage({ type: 'act', kind, ids: item.ids });
  // Select and Zoom to change the selection: marked here at once, like a click.
  if (kind === 'select' || kind === 'zoom') selectHere(rows, [...rows][0] ?? null, send);
  else send();
}

/** The data rows a menu acts on: the right-clicked one, or every marked one it belongs to. */
function menuTargets(res: ScheduleResult, row: number | null): number[] {
  const on = markedRows(res, state.selected);
  if (row === null || on.includes(row)) return on;
  return [row];
}

/**
 * "Colour 3D by this column": the column's displayed values over every matching element —
 * `colourColumn`, which Ask SGVue's `color_by_schedule_column` runs too (2026-09-28).
 */
function colourByColumn(defcol: number): void {
  const { store, def } = state;
  if (!store) return;
  const made = colourColumn(store, def, defcol, rowIds);
  if (!made) return;
  if ('error' in made) { flash(made.error, true); return; }
  port?.postMessage({ type: 'colourBy', ...made });
}

/**
 * Ask SGVue's `export_schedule` (2026-09-28): the Export menu's own action for that entry, or
 * the menu's reason not to. The answer goes back at once — the tool never waits on the dialog.
 */
function exportFromChat(format: ExportFormat, n: number): void {
  const refused = exportRefusal(format);
  port?.postMessage({ type: 'exportAck', n, refused });
  if (!refused) void EXPORT_ACTIONS[format]();
}

window.addEventListener('message', (event: MessageEvent) => {
  // Only the preload's own re-post: same window, the channel's name as the data.
  if (event.source !== window || event.data !== CH_SCHEDULE_PORT) return;
  port?.close();
  port = event.ports[0] ?? null;
  if (port) port.onmessage = (m: MessageEvent) => receive(m.data);
  // A new port is a new main page: it hears what is on screen again.
  sentCurrent = '';
  queueCurrent();
});

// ---------- boot ----------

// Motion state, wired straight onto the panes and never through render().
initInspectorWidth(inspectorPane);
wireInspectorResize(app, inspectorPane);
// The column drag writes --colw variables on the table and never repaints. Only the release
// lands in the definition. A grip drags its own column unless the user has marked several at
// their headings (ifcTable's rule, word for word in its main.ts).
wireColumnResize(outputPane, {
  groupOf: (i) => {
    const picked = state.selectedCols.filter((n) => state.def.columns[n]);
    return picked.includes(i) ? picked : [i];
  },
  commit: (widths) => updateDef((def) => {
    for (const [i, w] of widths) if (def.columns[i]) def.columns[i].width = w;
  }),
});

// A typed edit lands before any click or key action: the window's capture phase runs first.
wirePending(app, window);
wireApp(app, {
  // A data row stands for one element, or — with itemise off — every element it collapsed.
  // Either way all of them are selected, through the main window's own `select(ids, zoom)`.
  // Marked in place, not repainted: this is the middle of a click.
  pickRow: (i, mods) => {
    const res = shown;
    const row = res?.rows[i];
    if (!res || row?.kind !== 'data') return;
    // Shift: every row from the anchor to this one; the anchor stays where it was.
    const from = mods.range && state.anchor !== null ? rowOfElement(res, state.anchor) : -1;
    if (from >= 0) { selectRows(rangeElements(res, from, i), state.anchor, false); return; }
    if (mods.toggle) {
      const next = new Set(state.selected);
      const had = row.rows.some((r) => next.has(r));
      for (const r of row.rows) { if (had) next.delete(r); else next.add(r); }
      selectRows(next, row.rows[0], false);
      return;
    }
    // A plain click: this row alone, framed in 3D — phase 1's behaviour.
    selectRows(new Set(row.rows), row.rows[0], true);
  },
  moveRow: (step) => {
    const res = shown;
    if (!res) return;
    const at = nextDataRow(res, state.anchor !== null ? rowOfElement(res, state.anchor) : -1, step);
    const row = res.rows[at];
    if (row?.kind !== 'data') return;
    selectRows(new Set(row.rows), row.rows[0], false);
    reveal(drawnRows().get(at), 'nearest');
  },
  frameSelection: () => {
    if (selIds.length) port?.postMessage({ type: 'select', ids: selIds, zoom: true });
  },
  rowMenu: (row, at) => {
    const res = shown;
    if (!res) return;
    const picks = menuTargets(res, row);
    const rows = new Set<number>();
    for (const k of picks) {
      const r = res.rows[k];
      if (r?.kind === 'data') for (const x of r.rows) rows.add(x);
    }
    if (!rows.size) return;
    // From the keyboard: just under the first row it acts on.
    const box = at ? null : drawnRows().get(picks[0])?.getBoundingClientRect();
    const pos = at ?? (box ? { x: box.left + 24, y: box.bottom } : { x: 40, y: 40 });
    const items = rowMenu([...rows].map((r) => rowIds[r]), selIds, state.vis);
    openMenu(pos.x, pos.y, items.map((item) => ({
      label: item.label, disabled: item.disabled, sep: item.sep, run: () => runRowItem(item, rows),
    })), 'Rows');
  },
  headMenu: (defcol, at) => {
    const res = shown;
    const col = state.def.columns[defcol];
    if (!res || !col) return;
    const vi = state.def.columns.filter((c) => !c.hidden).indexOf(col);
    // A column with no value anywhere has nothing to colour — certain only when every row is
    // on screen.
    const empty = !res.truncated && !res.rows.some((r) => r.kind === 'data' && r.cells[vi] !== '');
    openMenu(at.x, at.y, [
      { label: 'Colour 3D by this column', disabled: vi < 0 || empty, run: () => colourByColumn(defcol) },
      {
        label: 'Clear 3D colours', disabled: !state.colours.live,
        run: () => port?.postMessage({ type: 'clearColours' }),
      },
    ], 'Column');
  },
});

render();
