// Shared helpers for the config tabs: field lists, type/unit lookup, and the
// unit conversion the filter boxes need (values are stored in SI, typed in display units).

import type { UnitKind } from '../../../schedule/ifc/types';
import type { UnitSystem } from '../../../schedule/ifc/units';
import { kindOf, kindsByHeading, statOf, typeOf } from '../../../schedule/schedule/columns';
import { fieldKey, headingOf, CORE_KEYS, CORE_LABELS, type FieldRef, type ScheduleDef } from '../../../schedule/schedule/def';
import { defaultUnit, fromDisplay, toDisplay } from '../../../schedule/schedule/format';
import type { AppState } from '../state';
import { esc, option } from '../dom';
import { cross, grip } from '../icons';

/** Every field the user may filter or sort on: the scheduled columns plus all core fields. */
export function selectableFields(state: AppState): { id: string; label: string; field: FieldRef }[] {
  const def = state.def;
  const out: { id: string; label: string; field: FieldRef }[] = [];
  const seen = new Set<string>();
  const push = (field: FieldRef, label: string) => {
    const id = fieldKey(field);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label, field });
  };
  def.columns.forEach((c) => push(c.field, headingOf(c, def)));
  CORE_KEYS.forEach((k) => push({ kind: 'core', key: k }, CORE_LABELS[k]));
  return out;
}

// Moved to the engine's `def.ts` on 2026-09-28 (the assistant's colour-by names a column too).
export { fieldKey };

export function fieldFromKey(key: string): FieldRef | null {
  const p = key.split('|');
  if (p[0] === 'core') return { kind: 'core', key: p[1] as never };
  if (p[0] === 'prop') return { kind: 'prop', pset: p[1], prop: p[2] };
  if (p[0] === 'formula') return { kind: 'formula', id: p[1] };
  return null;
}

// `statOf`, `typeOf` and `kindOf` moved to the engine's `columns.ts` in phase 4 of the
// assistant's parity work (2026-10-02), with `kindsByHeading`: the assistant's `make_schedule`
// decides a column's unit and decimals by the rule the Format tab offers them by.
export { kindOf, kindsByHeading, statOf, typeOf };

/**
 * The column the section is editing — column 0 when nothing has been picked.
 *
 * It lives here rather than in formatSection because the table marks this column too, and a
 * panel importing the table's `cellStyle` while the table imported the panel's answer to
 * this was a cycle for no gain. `shared.ts` is the leaf both sides already depend on.
 */
export function selectedIndex(state: AppState): number {
  const n = state.def.columns.length;
  if (!n) return -1;
  const i = state.selectedColumn ?? 0;
  return i >= 0 && i < n ? i : 0;
}

interface ColumnRowOpts {
  /** The overlay's copy: boxed, smaller, and without the coverage read-out. */
  compact?: boolean;
  selected?: boolean;
  /** 0…1 coverage, and the class that colours it. Full rows only. */
  cover?: { pct: number; cls: string; title: string; pset: string };
}

/**
 * One row of the scheduled-column list. It is rendered in two places — the Fields panel and
 * the field browser's "In this schedule" pane — and the two carry identical data-act and
 * data-i attributes. Keeping them one function is what stops them drifting apart, which is
 * how the focus-restore code came to find the wrong one of the pair.
 */
export function columnRow(def: ScheduleDef, i: number, o: ColumnRowOpts = {}): string {
  const c = def.columns[i];
  const heading = headingOf(c, def);
  const classes = ['drag-row',
    o.compact ? 'boxed' : '',
    !o.compact && o.cover?.cls === 'none' ? 'empty' : '',
    o.selected ? 'on' : ''].filter(Boolean).join(' ');

  const name = o.compact
    ? `<span class="name small">${esc(heading)}</span>`
    : `<span class="name${c.hidden ? ' off' : ''}" data-act="select-col" data-i="${i}"
        title="${esc(heading)} — click to format">${esc(heading)}</span>`;

  // Name, source, then the coverage as a number — once, not twice. The bar that used to sit
  // between them said nothing the coloured percentage beside it did not, on a row already
  // carrying a handle, a name, a pset and a remove button. The field browser keeps its bars:
  // there the job is scanning an unfamiliar model, and a bar is faster to compare down a
  // long list than to read.
  const coverage = !o.compact && o.cover
    ? `<span class="pset" title="${esc(o.cover.pset)}">${esc(o.cover.pset)}</span>
      <span class="cover ${o.cover.cls}" title="${esc(o.cover.title)}">${o.cover.pct}%</span>`
    : '';

  return `<div class="${classes}" draggable="true" data-drag="col" data-i="${i}">
      <span class="handle" tabindex="0" data-act="col-handle" data-i="${i}"
        title="${o.compact ? 'Drag to reorder' : 'Drag to reorder, or focus and use the arrow keys'}"
        aria-label="Reorder ${esc(heading)}">${grip}</span>
      ${name}
      ${coverage}
      <button class="x-btn hv-warn-both" data-act="col-remove" data-i="${i}" title="Remove this column">${cross()}</button>
    </div>`;
}

/**
 * A checkbox dressed as one of three things, with the whole control as the hit target.
 * Written out ten times across three panels before this existed, which is nine chances for
 * one of them to drift. `attrs` carries the row index where the control belongs to a list.
 *
 * - 'chip'  — the bordered pill, for option groups like a level's Header/Footer/Blank.
 * - 'row'   — label left, switch right; a settings line in a list.
 * - 'lead'  — switch left, label (and optional hint) right; a feature being turned on.
 *
 * One helper on purpose: acts.test.ts resolves this function's call sites into the
 * emitted-acts list by name, so every variant stays covered by the wiring check.
 */
export function toggle(
  act: string, label: string, on: boolean, attrs = '',
  style: 'chip' | 'row' | 'lead' = 'chip', hint = '',
): string {
  const box = `<input type="checkbox" data-act="${act}"${attrs}${on ? ' checked' : ''} />`;
  if (style === 'chip') {
    return `<label class="toggle${on ? ' on' : ''}">${box} ${esc(label)}</label>`;
  }
  const sw = `<span class="switch">${box}<i></i></span>`;
  const text = hint
    ? `<span class="grow-1"><span class="opt-title">${esc(label)}</span><span class="hint">${esc(hint)}</span></span>`
    : `<span class="grow-1">${esc(label)}</span>`;
  return style === 'lead'
    ? `<label class="switch-row${hint ? ' top' : ''}">${sw}${text}</label>`
    : `<label class="switch-row">${text}${sw}</label>`;
}

export function fieldSelect(state: AppState, selected: FieldRef | undefined, act: string, idx: number): string {
  const opts = selectableFields(state)
    .map((f) => option(f.id, f.label, !!selected && fieldKey(selected) === f.id))
    .join('');
  return `<select data-act="${act}" data-i="${idx}" aria-label="Field">${opts}</select>`;
}

/**
 * Filter values are stored in SI; the box shows display units — the model's own, so a file
 * drawn in feet is filtered in feet under the `ft` label filterSection prints beside it.
 * These two are a pair: read the system from the same place for both, or a value typed in
 * one unit is read back in another.
 */
export function displayNum(v: unknown, kind: UnitKind, system?: UnitSystem): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const out = toDisplay(v, kind, defaultUnit(kind, system) || undefined);
  return String(Math.round(out * 1e6) / 1e6);
}

export function storeNum(raw: string, kind: UnitKind, system?: UnitSystem): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return fromDisplay(n, kind, defaultUnit(kind, system) || undefined);
}
