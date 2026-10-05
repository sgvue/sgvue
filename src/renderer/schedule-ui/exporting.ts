// Export, and the schedule file — 2026-09-25, phase 4 of the Schedules window.
//
// ifcTable's `wireExports` (CSV, Excel, the every-saved-schedule workbook) and its
// `.schedule.json` export and import, handler for handler and message for message, with one
// change: the page never downloads anything. It builds the bytes — ifcTable's CSV with its BOM,
// its workbook (exceljs, loaded only when asked for: a chunk of this window alone), or the
// definition's JSON — and hands them to main through the preload's `saveExport`, with a kind
// and a suggested name. Main shows the native Save dialog, attached to this window, and writes
// where the user points (`src/main/exports.ts`, the third writer). `openScheduleFile` is the
// reverse: main's Open dialog, the text of the file picked (at most 1 MB), and ifcTable's strict
// `parseScheduleDef` here.
//
// Exports cover the FULL schedule (`fullResult`: uncapped, numbers without separators), never
// the 5 000 rows the screen draws — ifcTable's rule.

import { EXPORT_MAX_BYTES, type ExportKind } from '../../shared/ipc-contract';
import type { ExportFormat, ExportRefusal } from '../../schedule/messages';
import { csvBlob, toCsv } from '../../schedule/export/csv';
import { fullResult, toRows } from '../../schedule/export/rows';
import { oneSheet, xlsxBlob, type Sheet } from '../../schedule/export/xlsx';
import { parseScheduleDef, ScheduleImportError, type ScheduleDef } from '../../schedule/schedule/def';
import { dialogOpen } from './dialog';
import { exportName, flash } from './dom';
import { listSaved } from './schedules';
import { state, update } from './state';

/** What `preload/schedule.ts` exposes — the whole of this window's reach beyond its port. */
interface Bridge {
  saveExport(req: { kind: ExportKind; suggestedName: string; bytes: Uint8Array }): Promise<{ saved: boolean }>;
  openScheduleFile(): Promise<{ text: string } | null>;
}

const bridge = (): Bridge | undefined => (window as unknown as { sgvueSchedule?: Bridge }).sgvueSchedule;

/** A failure's own words, without Electron's `Error invoking remote method '…': Error:` wrapper. */
export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return m.replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '');
}

/** One export at a time: a second click while a workbook is being built does nothing. */
let busy = false;

/**
 * Build the bytes, hand them to main's Save dialog, and say how it went — saved, cancelled or
 * failed, in the window's flash.
 */
async function deliver(
  kind: ExportKind,
  suggestedName: string,
  failed: string,
  build: () => Promise<Blob>,
  done: string,
): Promise<void> {
  const api = bridge();
  if (!api) { flash(`${failed}: this window cannot save files.`, true); return; }
  if (busy) return;
  busy = true;
  try {
    const bytes = new Uint8Array(await (await build()).arrayBuffer());
    // Main refuses it too; saying so here costs no round trip and names the reason.
    if (bytes.byteLength > EXPORT_MAX_BYTES) {
      flash(`${failed}: the file would be over ${EXPORT_MAX_BYTES / 1048576} MB.`, true);
      return;
    }
    const { saved } = await api.saveExport({ kind, suggestedName, bytes });
    flash(saved ? done : 'Export cancelled — nothing was saved.');
  } catch (e) {
    flash(`${failed}: ${errMsg(e)}`, true);
  } finally {
    busy = false;
  }
}

const rowsNote = (n: number) => `${n.toLocaleString()} row${n === 1 ? '' : 's'}`;

export function exportCsv(): Promise<void> {
  const store = state.store;
  if (!store) return Promise.resolve();
  const def = state.def;
  const res = fullResult(store, def);
  return deliver('csv', exportName([def.name], 'csv'), 'CSV export failed',
    async () => csvBlob(toCsv(toRows(res))), `Exported ${rowsNote(res.totalDataRows)} to CSV.`);
}

export function exportXlsx(): Promise<void> {
  const store = state.store;
  if (!store) return Promise.resolve();
  const def = state.def;
  const res = fullResult(store, def);
  return deliver('xlsx', exportName([def.name], 'xlsx'), 'Excel export failed',
    () => xlsxBlob(oneSheet(res, def)), `Exported ${rowsNote(res.totalDataRows)} to Excel.`);
}

/**
 * Every saved schedule, run against the model that is open, in one workbook. Models get
 * revised; without this you reopen each saved schedule and export them one at a time, every
 * revision.
 */
export function exportWorkbook(): Promise<void> {
  const store = state.store;
  const saved = listSaved();
  // Busy first: the progress note below must not replace the toast of the export under way.
  if (busy || !store || !saved.length) return Promise.resolve();
  flash(`Building ${saved.length} sheet${saved.length === 1 ? '' : 's'}…`);
  const model = store.meta.fileName.split(/[\\/]/).pop()?.replace(/\.ifc$/i, '') || 'model';
  return deliver('xlsx', exportName([model, 'schedules'], 'xlsx'), 'Workbook export failed', () => {
    const sheets: Sheet[] = saved.map((s) => {
      // A schedule saved against another model may name a class this one lacks. It still
      // gets a sheet saying so — a workbook that quietly omits one looks complete.
      const missing = s.def.entity.filter((e) => !store.byEntity.has(e));
      return {
        name: s.name,
        res: fullResult(store, s.def),
        note: missing.length ? `This model has no ${missing.join(', ')} — nothing to schedule.` : undefined,
      };
    });
    return xlsxBlob(sheets);
  }, `Exported ${saved.length} schedule${saved.length === 1 ? '' : 's'} to one workbook.`);
}

/** A definition as a `.schedule.json` — the schedule on screen, or a saved one. */
export function exportScheduleFile(def: ScheduleDef): Promise<void> {
  return deliver('schedule', exportName([def.name], 'schedule.json'), 'Schedule file export failed',
    async () => new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' }),
    `Exported “${def.name}” as a schedule file.`);
}

/**
 * The header's Export menu, entry by entry (`events.ts`) — and, since 2026-09-28, what Ask
 * SGVue's `export_schedule` runs (`main.ts`): the same four actions, so an export asked for in
 * chat is the menu's own, down to the Save dialog, the suggested name and the toast.
 */
export const EXPORT_ACTIONS: Record<ExportFormat, () => Promise<void>> = {
  xlsx: () => exportXlsx(),
  csv: () => exportCsv(),
  all_saved: () => exportWorkbook(),
  schedule_file: () => exportScheduleFile(state.def),
};

/**
 * Why an export asked for from chat cannot start now, or null — by the menu's own rules: one
 * export at a time (its Save dialog may be open), none while the window shows no schedule (the
 * header and its menu are not drawn), and "All saved schedules" only once one is saved (the
 * menu's entry is disabled until then).
 *
 * 2026-10-02 (the review's leftover): and none while this window's own confirm or prompt is up.
 * The menu cannot be reached under that card — its scrim covers the window and keeps the
 * focus — so a click never could start one there; a request from chat could, and would have
 * raised the native Save dialog over a question still waiting for its answer.
 *
 * The same day (the last leftover before the release): and none while this window's native Open
 * dialog is up — "Open schedule file…", raised by the user or by an earlier turn's
 * `manage_schedules` `open_file`. Main attaches that dialog to this window, so no click reaches
 * the menu under it either; a request from chat needs no click, and would have raised a Save
 * dialog over it. `fileDialogUp()`, below, is `busy || opening` — either native dialog — and
 * what `manage.ts` refuses on, the mirror case.
 */
export function exportRefusal(format: ExportFormat): ExportRefusal | null {
  if (fileDialogUp() || dialogOpen()) return 'busy';
  if (!state.store?.entities.length) return 'no_schedule';
  if (format === 'all_saved' && !listSaved().length) return 'nothing_saved';
  return null;
}

/**
 * The text of a `.schedule.json`, as a definition — or a `ScheduleImportError` whose message
 * the window can show. A byte-order mark is dropped first: an editor that writes one would
 * otherwise make a good file unreadable.
 */
export function parseScheduleText(text: string): ScheduleDef {
  try {
    return parseScheduleDef(JSON.parse(text.replace(/^\uFEFF/, '')));
  } catch (e) {
    throw e instanceof ScheduleImportError ? e
      : new ScheduleImportError('That file is not a schedule definition.');
  }
}

/** One Open dialog at a time: while it is up, a second request for it does nothing. */
let opening = false;

/**
 * A native dialog of this window's is up, or about to be — an export being built or its Save
 * dialog, or the Open dialog for a schedule file. 2026-10-02: what a request from the assistant
 * is refused on (`manage.ts`, and `exportRefusal` above), so that a loop of them cannot stack
 * dialogs.
 */
export const fileDialogUp = (): boolean => busy || opening;

/** Open a `.schedule.json` and make it the schedule on screen — one undo step, like a template. */
export async function openScheduleFile(): Promise<void> {
  const api = bridge();
  if (!api) { flash('Could not open — this window cannot read files.', true); return; }
  if (opening) return;
  let text: string;
  opening = true;
  try {
    const got = await api.openScheduleFile();
    if (!got) return;
    text = got.text;
  } catch (e) {
    flash(/too large/.test(errMsg(e))
      ? 'That file is too large to be a schedule (over 1 MB).'
      : 'Could not read that file.', true);
    return;
  } finally {
    opening = false;
  }
  let def: ScheduleDef;
  try {
    def = parseScheduleText(text);
  } catch (e) {
    flash(errMsg(e) || 'That file is not a schedule definition.', true);
    return;
  }
  // A schedule saved from another model may name a category this one lacks.
  const missing = def.entity.filter((e) => !state.store?.byEntity.has(e));
  update({
    def, selectedColumn: null, selectedCols: [], dirty: false,
    removedBy: null, litBy: null, templateId: null, savedName: null,
    // Opened from My templates, this is the answer to why it was opened.
    overlay: null,
  });
  if (missing.length) flash(`Loaded, but this model has no ${missing.join(', ')}.`, true);
  else flash(`Loaded “${def.name}”.`);
}
