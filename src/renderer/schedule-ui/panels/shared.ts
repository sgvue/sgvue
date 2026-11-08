// Shared helpers for the column menu and the view bar's popovers: field lists, type/unit lookup, and the
// unit conversion the filter boxes need (values are stored in SI, typed in display units).

import type { UnitKind } from '../../../schedule/ifc/types';
import type { UnitSystem } from '../../../schedule/ifc/units';
import { kindOf, kindsByHeading, statOf, typeOf } from '../../../schedule/schedule/columns';
import { defaultHeading, fieldKey, headingOf, CORE_KEYS, CORE_LABELS, type FieldRef } from '../../../schedule/schedule/def';
import { defaultUnit, toDisplay } from '../../../schedule/schedule/format';
import type { AppState } from '../state';
import { esc, option } from '../dom';

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

/** The column whose heading was last clicked — column 0 when none has been. Equal width
 *  copies its width. */
export function selectedIndex(state: AppState): number {
  const n = state.def.columns.length;
  if (!n) return -1;
  const i = state.selectedColumn ?? 0;
  return i >= 0 && i < n ? i : 0;
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
  const fields = selectableFields(state);
  // A rule or level can be on a field that is not a column — the field picker offers every
  // field the category has. Without its own option the select would SHOW the first one and,
  // touched, rewrite the rule onto it (ifcTable, 2026-11-05).
  if (selected && !fields.some((f) => f.id === fieldKey(selected))) {
    fields.unshift({ id: fieldKey(selected), label: defaultHeading(selected, state.def), field: selected });
  }
  const opts = fields
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

/** The box's text, read back to SI — moved to the engine (v1.5.0, phase 1); one copy. */
export { storeNum } from '../../../schedule/schedule/format';
