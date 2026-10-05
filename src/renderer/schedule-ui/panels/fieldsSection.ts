// Fields: the columns this schedule shows, in order, each with how much of the category
// actually carries it. A column nothing carries is the app's classic failure — it reads
// as "the app is broken" — so it is tinted, badged, and offered a remap on the spot.

import { type ModelStore } from '../../../schedule/ifc/store';
import { headingOf, newId, type ScheduleDef } from '../../../schedule/schedule/def';
import { ANY_PSET } from '../../../schedule/schedule/resolve';
import type { AppState } from '../state';
import { coverClass, fraction, populated, type Coverage } from '../coverage';
import { esc, option } from '../dom';
import { calcProblems } from '../overlays/calcEditor';
import { propNameOf, remapCandidates } from '../remap';
import { columnRow } from './shared';

export function fieldsSummary(state: AppState): string {
  const n = state.def.columns.length;
  return n ? `${n} column${n === 1 ? '' : 's'}` : 'none yet';
}

/**
 * Authoring formulas moved into the Add-fields modal, so a broken one would otherwise be
 * invisible whenever that modal is closed — which is nearly always. The tab carries an
 * alert dot instead, and this is its tooltip: quiet when there is nothing wrong, and it
 * names what needs attention. PLAIN TEXT — the caller escapes it into a title attribute.
 */
export function fieldsAlert(state: AppState, store: ModelStore, cov: Coverage): string {
  const empty = state.def.columns.filter((c) => !c.hidden && populated(cov, c.field) === 0).length;
  const broken = calcProblems(state, store).size;
  const bits: string[] = [];
  if (broken) bits.push(`${broken} formula${broken === 1 ? '' : 's'} to fix`);
  if (empty) bits.push(`${empty} empty column${empty === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

export function fieldsBody(state: AppState, store: ModelStore, cov: Coverage): string {
  const def = state.def;

  const rows = def.columns.map((c, i) => {
    const f = fraction(cov, c.field);
    const cls = coverClass(f);
    const pset = c.field.kind === 'prop' ? (c.field.pset === ANY_PSET ? 'any pset' : c.field.pset)
      : c.field.kind === 'formula' ? 'calculated' : 'core';

    return columnRow(def, i, {
      selected: state.selectedColumn === i,
      cover: {
        pct: Math.round(f * 100), cls, pset,
        title: `${populated(cov, c.field).toLocaleString()} of ${cov.total.toLocaleString()} elements carry this`,
      },
    }) + (cls === 'none' ? remapBlock(store, def, i) : '');
  }).join('');

  return `<div class="row ends head-row">
      <span class="eyebrow">Columns in this schedule</span>
      <span class="sub">drag to reorder</span>
    </div>
    <div class="stack tight">${rows}</div>
    ${def.columns.length ? '' : '<div class="sub none-yet">No fields yet.</div>'}
    <button class="tint add-fields" data-act="open-fields">＋ Add fields…</button>
    <div class="panel-note">Each column shows how much of the category carries it.</div>
    ${brokenNote(state, store)}`;
}

/** The way back to a formula that needs attention, without reproducing its editor here. */
function brokenNote(state: AppState, store: ModelStore): string {
  const problems = [...calcProblems(state, store)];
  if (!problems.length) return '';
  const byId = new Map((state.def.calculated ?? []).map((c) => [c.id, c.name]));
  return `<div class="subcard bad calc-note">
    ${problems.map(([id, why]) => `<div class="sub"><b>${esc(byId.get(id) ?? id)}</b> — ${esc(why)}</div>`).join('')}
    <button class="dashed" data-act="open-fields">Fix in Add fields…</button>
  </div>`;
}

/** Offer a way out of a blank column instead of leaving the user guessing. */
function remapBlock(store: ModelStore, def: ScheduleDef, i: number): string {
  const col = def.columns[i];
  const prop = propNameOf(col);
  const candidates = prop ? remapCandidates(store, def, prop) : [];
  return `<div class="remap">
    <div class="sub">No ${esc(prop ?? headingOf(col, def))} on any ${esc(def.entity.join(', '))} in this model.</div>
    ${candidates.length
    ? `<select data-act="remap" data-i="${i}" class="full remap-pick" aria-label="Point this column at another property">
          <option value="">Point this column at…</option>
          ${candidates.map((k) => option(k.stat.key, `${k.stat.prop} — ${k.stat.pset} (${k.stat.count})`, false)).join('')}
        </select>`
    : '<div class="sub">Nothing similar to map it to.</div>'}
  </div>`;
}

// `newId` moved to the engine's `def.ts` (2026-10-02): the assistant's `make_schedule` names a
// calculated value it adds by the same rule the editor's two Add buttons do.
export { newId };
