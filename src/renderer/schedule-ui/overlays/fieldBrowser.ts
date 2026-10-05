// The field browser: everything this category actually carries, in one place, with how
// much of the category carries it.
//
// The list is built from the MODEL, never from a template — the app can only ever offer
// fields that exist in the file you opened.

import { keysForEntity, type ModelStore } from '../../../schedule/ifc/store';
import { CORE_KEYS, CORE_LABELS, type FieldRef } from '../../../schedule/schedule/def';
import { unitOptions } from '../../../schedule/schedule/format';
import { searchByValue } from '../../../schedule/schedule/valueSearch';
import type { AppState } from '../state';
import { coverBar, coverClass, fraction, type Coverage } from '../coverage';
import { esc } from '../dom';
import { columnRow, fieldKey, typeOf } from '../panels';
import { calcEditor } from './calcEditor';
import { cross } from '../icons';

const CORE_GROUP = 'Identity & location';
const CALC_GROUP = 'Calculated';

interface Item {
  id: string;
  field: FieldRef;
  name: string;
  group: string;
  type: 'number' | 'text' | 'bool' | 'enum';
  meta: string;
  cover: number;
}

function items(state: AppState, store: ModelStore, cov: Coverage): Item[] {
  const def = state.def;
  const out: Item[] = [];

  for (const k of CORE_KEYS) {
    const field: FieldRef = { kind: 'core', key: k };
    out.push({
      id: fieldKey(field), field, name: CORE_LABELS[k], group: CORE_GROUP,
      type: typeOf(store, def, field),
      meta: CORE_GROUP, cover: fraction(cov, field),
    });
  }

  for (const s of keysForEntity(store, def.entity)) {
    const field: FieldRef = { kind: 'prop', pset: s.pset, prop: s.prop };
    const unit = unitOptions(s.kind)[0];
    out.push({
      id: fieldKey(field), field, name: s.prop, group: s.pset || 'Other',
      type: s.type,
      meta: `${s.pset || 'no pset'}${unit ? ` · ${unit}` : s.type === 'bool' ? ' · Yes / No' : ''}`,
      cover: fraction(cov, field),
    });
  }

  for (const c of def.calculated ?? []) {
    const field: FieldRef = { kind: 'formula', id: c.id };
    out.push({
      id: fieldKey(field), field, name: c.name, group: CALC_GROUP,
      type: 'number', meta: c.kind === 'percentage' ? 'percentage of a total' : 'formula',
      cover: 1,
    });
  }
  return out;
}

const TYPES: [AppState['fieldType'], string][] = [
  ['all', 'All'], ['number', 'Number'], ['text', 'Text'], ['bool', 'Yes / No'],
];

function matchesType(item: Item, want: AppState['fieldType']): boolean {
  if (want === 'all') return true;
  if (want === 'number') return item.type === 'number';
  if (want === 'bool') return item.type === 'bool';
  return item.type === 'text' || item.type === 'enum';
}

/**
 * Fields that CONTAIN what was typed. Shown under the name matches, because someone who
 * knows the property name is served by the list above — and someone who only knows the
 * value ("FD30") has, until now, had nothing to search with at all.
 */
function valueSection(state: AppState, store: ModelStore, nameMatches: number, used: Set<string>): string {
  const q = state.fieldSearch.trim();
  if (q.length < 2) {
    return nameMatches ? '' : '<div class="empty-note">Nothing matches that search.</div>';
  }
  const hits = searchByValue(store, state.def.entity, q);
  if (!hits.length) {
    return nameMatches ? '' : `<div class="empty-note">No field is named or contains “${esc(q)}”.</div>`;
  }

  const rows = hits.map((h) => {
    const id = fieldKey(h.field);
    const inUse = used.has(id);
    return `<div class="browse-row${inUse ? ' used' : ''}">
      <span class="type-mark">"</span>
      <div class="grow-1">
        <div class="opt-title">${esc(h.label)}</div>
        <div class="sub mono">${esc(h.group)} · e.g. ${esc(h.example)}</div>
      </div>
      <div class="row cover-slot">
        <span class="sub">${h.hits.toLocaleString()} match${h.hits === 1 ? '' : 'es'}</span>
      </div>
      <button data-act="${inUse ? 'browse-remove' : 'browse-add'}" data-id="${esc(id)}"
        class="btn pick${inUse ? '' : ' add'}">${inUse ? 'Remove' : 'Add'}</button>
    </div>`;
  }).join('');

  return `<div class="value-hits">
    <div class="eyebrow">Fields containing “${esc(q)}”</div>
    ${rows}
  </div>`;
}

export function fieldBrowser(state: AppState, store: ModelStore, cov: Coverage): string {
  const def = state.def;
  const all = items(state, store, cov);
  const used = new Set(def.columns.map((c) => fieldKey(c.field)));
  const q = state.fieldSearch.trim().toLowerCase();

  const visible = all.filter((f) => {
    if (state.fieldPset !== 'all' && f.group !== state.fieldPset) return false;
    if (!matchesType(f, state.fieldType)) return false;
    if (state.hideEmpty && f.cover === 0 && !used.has(f.id)) return false;
    if (q && !(f.name.toLowerCase().includes(q) || f.group.toLowerCase().includes(q))) return false;
    return true;
  });

  // Groups count what the OTHER filters leave, so the numbers match what clicking shows.
  const preGroup = all.filter((f) => matchesType(f, state.fieldType)
    && (!state.hideEmpty || f.cover > 0 || used.has(f.id))
    && (!q || f.name.toLowerCase().includes(q) || f.group.toLowerCase().includes(q)));
  const names = [...new Set(preGroup.map((f) => f.group))];
  const groups = [{ id: 'all', name: 'All fields', n: preGroup.length }]
    .concat(names.map((g) => ({ id: g, name: g, n: preGroup.filter((f) => f.group === g).length })));

  const groupList = groups.map((g) => `<button class="rail-item${state.fieldPset === g.id ? ' on' : ''}"
      data-act="field-pset" data-pset="${esc(g.id)}"
      aria-pressed="${state.fieldPset === g.id}" aria-label="${esc(g.name)}, ${g.n} fields">
      <span class="grow${g.id !== 'all' && g.id !== CORE_GROUP && g.id !== CALC_GROUP ? ' pset-name' : ''}">${esc(g.name)}</span>
      <span class="n">${g.n}</span>
    </button>`).join('');

  const rows = visible.map((f) => {
    const inUse = used.has(f.id);
    const pct = Math.round(f.cover * 100);
    const cls = coverClass(f.cover);
    const mark = f.type === 'number' ? '#' : f.type === 'bool' ? '✓' : 'T';
    return `<div class="browse-row${cls === 'none' ? ' empty' : ''}${inUse ? ' used' : ''}">
      <span class="type-mark ${f.type}">${mark}</span>
      <div class="grow-1">
        <div class="opt-title">${esc(f.name)}</div>
        <div class="sub mono">${esc(f.meta)}</div>
      </div>
      <div class="row cover-slot">
        ${coverBar(f.cover)}
        <span class="cover pct ${cls}">${pct}%</span>
      </div>
      <button data-act="${inUse ? 'browse-remove' : 'browse-add'}" data-id="${esc(f.id)}"
        class="btn pick${inUse ? '' : ' add'}">${inUse ? 'Remove' : 'Add'}</button>
    </div>`;
  }).join('');

  const chosen = def.columns.map((_, i) => columnRow(def, i, { compact: true })).join('');

  return `<div class="overlay" data-act="overlay-backdrop">
    <div class="overlay-card" role="dialog" aria-modal="true" aria-label="Add fields">
      <div class="overlay-head">
        <div class="row top head-row">
          <div class="grow-1">
            <h3>Add fields to ${esc(def.name)}</h3>
            <p>${all.length} field${all.length === 1 ? '' : 's'} found on ${cov.total.toLocaleString()} ${esc(def.entity.join(', ') || 'element')} element${cov.total === 1 ? '' : 's'} in this model</p>
          </div>
          <button class="overlay-close hv-step-ink" data-act="close-overlay" aria-label="Close">${cross(14, 1.8)}</button>
        </div>
        <div class="row wide search-row">
          <input type="search" data-act="field-search" class="grow-1 search-box"
            placeholder="Search fields — try “width”, “fire”, “rating”" aria-label="Search fields"
            value="${esc(state.fieldSearch)}" />
          <span class="seg mini">
            ${TYPES.map(([id, label]) => `<button class="seg-btn${state.fieldType === id ? ' on' : ''}"
              data-act="field-type" data-type="${id}">${label}</button>`).join('')}
          </span>
          <label class="row check-inline">
            <input type="checkbox" data-act="hide-empty" ${state.hideEmpty ? 'checked' : ''} /> Hide empty fields
          </label>
        </div>
      </div>

      <div class="browse-cols">
        <div class="browse-groups">
          <div class="eyebrow group-head">Where fields come from</div>
          <div class="rail-group">${groupList}</div>
        </div>
        <div class="browse-list">
          <div class="stack rows">
            ${rows}
            ${valueSection(state, store, visible.length, used)}
          </div>
        </div>
        <div class="browse-chosen">
          <div class="row ends chosen-head">
            <span class="eyebrow">In this schedule</span>
            <span class="sub mono">${def.columns.length}</span>
          </div>
          <div class="stack tight">${chosen || '<div class="sub">No columns yet.</div>'}</div>
          <div class="sub order-note">Order here is column order in the schedule.</div>

          <!-- Authoring a formula lives here, not in the 368px inspector it used to be
               crammed into. This is also the one place where the list of fields you can
               refer to is on screen while you type. -->
          ${calcEditor(state, store)}
        </div>
      </div>

      <div class="overlay-foot">
        <span class="sub">${def.columns.length} of ${all.length} fields in this schedule</span>
        <span class="spacer"></span>
        <button class="btn primary" data-act="close-overlay">Done</button>
      </div>
    </div>
  </div>`;
}
