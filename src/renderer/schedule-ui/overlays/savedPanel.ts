// My templates: every setup saved in this window, in one place — load, rename, duplicate,
// export or delete one; and, beside Save, open a `.schedule.json` (ifcTable's Import…). Export…
// and Open schedule file… came back with phase 4 (2026-09-25): main's native Save and Open
// dialogs, `exporting.ts`. The rail lists the same entries, but a rail row is one click wide
// and a growing list needs room to be organised in.
//
// A separate overlay from the template gallery on purpose: a preset card is a single
// button ("start from this"), and a saved entry is a thing you own, carrying five actions.

import type { ModelStore } from '../../../schedule/ifc/store';
import type { AppState } from '../state';
import { esc } from '../dom';
import { listSaved } from '../schedules';
import { cross } from '../icons';

type Entry = ReturnType<typeof listSaved>[number];

/** One saved setup: what it is, whether it is the one in use, and what can be done to it. */
function savedRow(state: AppState, store: ModelStore, s: Entry): string {
  const on = state.savedName === s.name;
  const cols = s.def.columns.length;
  // A setup saved against another model may name a class this one lacks. Worth saying
  // before the click, not after: loading it would produce an empty table.
  const missing = s.def.entity.some((e) => !store.byEntity.has(e));
  // Each act is written out in full, never built from a variable: tests/acts.test.ts reads
  // these literals to prove every control is wired, and cannot see an interpolated name.
  const n = esc(s.name);
  return `<div class="saved-row${on ? ' on' : ''}">
    <div class="grow-1">
      <div class="saved-title">
        <b>${n}</b>
        ${on ? `<span class="badge accent">${state.dirty ? 'EDITED' : 'IN USE'}</span>` : ''}
      </div>
      <div class="sub">${cols} column${cols === 1 ? '' : 's'} · saved ${esc(s.savedAt.slice(0, 10))}${
        missing ? ' · <span class="dim">not in this model</span>' : ''}</div>
    </div>
    <div class="row saved-acts">
      <button class="quiet" data-act="load-saved" data-name="${n}"
        title="Use this setup for the schedule on screen" aria-label="Load ${n}">Load</button>
      <button class="quiet" data-act="rename-saved" data-name="${n}"
        title="Give this template another name" aria-label="Rename ${n}">Rename</button>
      <button class="quiet" data-act="duplicate-saved" data-name="${n}"
        title="Make a copy to edit, leaving this one alone" aria-label="Duplicate ${n}">Duplicate</button>
      <button class="quiet" data-act="export-saved" data-name="${n}"
        title="Save this setup as a .schedule.json file" aria-label="Export ${n}">Export…</button>
      <button class="quiet hv-warn-both" data-act="delete-saved" data-name="${n}"
        title="Delete this saved template" aria-label="Delete ${n}">Delete</button>
    </div>
  </div>`;
}

export function savedPanel(state: AppState, store: ModelStore): string {
  const q = state.savedQuery.trim().toLowerCase();
  const saved = listSaved();
  const matching = saved.filter((s) => !q
    || s.name.toLowerCase().includes(q)
    || s.def.entity.some((e) => e.toLowerCase().includes(q)));

  // Grouped by the classes a setup schedules: with several setups per category, the class
  // is what tells two similarly named ones apart.
  const groups = new Map<string, Entry[]>();
  for (const s of matching) {
    const key = s.def.entity.join(' + ') || 'No category';
    const list = groups.get(key);
    if (list) list.push(s); else groups.set(key, [s]);
  }

  const body = [...groups]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => `<div class="saved-group">
      <div class="saved-group-head">
        <span class="eyebrow">${esc(key)}</span>
        <span class="sub mono">${list.length}</span>
      </div>
      ${[...list].sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => savedRow(state, store, s)).join('')}
    </div>`).join('');

  // Two different emptinesses, and saying the wrong one is a dead end — the same rule the
  // rail's category list follows.
  const empty = saved.length
    ? '<div class="empty-note">No template matches that.</div>'
    : '<div class="empty-note">Nothing saved yet — name the schedule above and press Save.</div>';

  return `<div class="overlay" data-act="overlay-backdrop">
    <div class="overlay-card" role="dialog" aria-modal="true" aria-label="My templates">
      <div class="overlay-head">
        <div class="row top head-row">
          <div class="grow-1">
            <h3>My templates</h3>
            <p>Schedule setups saved on this computer — they never leave it</p>
          </div>
          <button class="overlay-close hv-step-ink" data-act="close-overlay" aria-label="Close">${cross(14, 1.8)}</button>
        </div>
        <div class="row wide save-row">
          <input type="text" class="saved-name grow-1" data-act="name" value="${esc(state.def.name)}"
            aria-label="Schedule name" title="Name the schedule on screen" />
          <button class="btn primary" data-act="save-schedule" title="Save this schedule setup">Save</button>
          <button class="btn" data-act="import-schedule" title="Open a .schedule.json file">Open schedule file…</button>
        </div>
        <div class="sub save-hint">A name that is already taken gets a number — nothing is
          overwritten except the template you loaded.</div>
        <div class="row wide filter-row">
          <input type="search" data-act="saved-search" class="saved-search"
            placeholder="Search my templates" aria-label="Search my templates"
            value="${esc(state.savedQuery)}" />
        </div>
      </div>
      <div class="saved-list">${body || empty}</div>
    </div>
  </div>`;
}
