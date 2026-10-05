// The template gallery. Each card says how well the template fits THIS model — how many
// of its columns the file actually carries.
//
// That is a fit score for the template, not a verdict on the model: it tells you which
// ready-made schedule will come out populated, and nothing about compliance.
//
// Two groups: the general templates, then IFC-SG. Grouping is all the gallery does with
// `Preset.section` — the section decides nothing about how a card behaves.

import type { ModelStore } from '../../../schedule/ifc/store';
import { ruleText } from '../../../schedule/schedule/compare';
import { runSchedule } from '../../../schedule/schedule/engine';
import { presetCount, presetsFor, scheduleFromPreset, type Preset } from '../../../schedule/schedule/presets';
import type { AppState } from '../state';
import { buildCoverage, coverBar, populated, type Coverage } from '../coverage';
import { esc } from '../dom';
import { cross } from '../icons';

/**
 * How many of a template's columns resolve on at least one of its elements — counted over
 * every class the template names, since that union is exactly what applying it will show.
 */
export function fit(store: ModelStore, p: Preset, cache: Map<string, Coverage>): { found: number; of: number } {
  const key = p.entities.join('+');
  let cov = cache.get(key);
  if (!cov) { cov = buildCoverage(store, p.entities); cache.set(key, cov); }
  const found = p.columns.filter((c) => populated(cov!, c.field) > 0).length;
  return { found, of: p.columns.length };
}

/**
 * "N in model". A filtered template is asked through the engine rather than counted by
 * class: several IFC-SG templates will share IfcGeographicElement and differ only by their
 * rule, so the class count would read identically on every one of those cards and be wrong
 * on each. `cap: 0` because only the total is wanted here, never the lines.
 *
 * SGVue (2026-10-02): exported with `fit` above — the assistant's `manage_schedules` lists the
 * templates with the same two figures a card shows (`manage.ts`).
 */
export function inModel(store: ModelStore, p: Preset): number {
  if (!p.filters?.length) return presetCount(store.byEntity, p);
  return runSchedule(store, scheduleFromPreset(p), { cap: 0 }).matchedElements;
}

export function templateGallery(state: AppState, store: ModelStore): string {
  const q = state.templateQuery.trim().toLowerCase();
  const cache = new Map<string, Coverage>();

  const available = presetsFor(store.byEntity).filter((p) => (
    !q || p.name.toLowerCase().includes(q) || p.entities.some((e) => e.toLowerCase().includes(q))
  ));

  const card = (p: Preset) => {
    const { found, of } = fit(store, p, cache);
    const inUse = state.templateId === p.id;
    // No `def`: only a formula field needs one to name itself, and a template carries none.
    const rules = (p.filters ?? []).map((f) => ruleText(f)).join(' · ');
    const meta = `${p.entities.join(' + ')}${rules ? ` · ${rules}` : ''} · ${inModel(store, p).toLocaleString()} in model`;
    return `<button class="tpl-card${inUse ? ' on' : ''}" data-act="apply-template" data-id="${esc(p.id)}">
      <div class="row top card-head">
        <div class="grow-1">
          <div class="tpl-name">${esc(p.name)}</div>
          <div class="sub mono tpl-meta">${esc(meta)}</div>
        </div>
        ${inUse ? '<span class="badge accent">IN USE</span>' : ''}
      </div>
      <div class="row tpl-fit">
        ${coverBar(of ? found / of : 0)}
        <span class="sub tpl-score">${found} / ${of} columns</span>
      </div>
    </button>`;
  };

  // An empty group is not drawn at all, heading included. presetsFor already drops every
  // template whose classes this model lacks, so a file with no IfcGeographicElement never
  // shows the IFC-SG heading — which is the point: the section exists only where it means
  // something, and everyone else meets the gallery they always had.
  const group = (label: string, list: Preset[]) => (list.length ? `<div class="tpl-group">
      <span class="eyebrow">${label}</span>
      <div class="tpl-grid">${list.map(card).join('')}</div>
    </div>` : '');

  const groups = group('General', available.filter((p) => !p.section))
    + group('IFC-SG', available.filter((p) => p.section === 'ifcsg'));

  return `<div class="overlay" data-act="overlay-backdrop">
    <div class="overlay-card" role="dialog" aria-modal="true" aria-label="Start from a template">
      <div class="overlay-head">
        <div class="row top head-row">
          <div class="grow-1">
            <h3>Start from a template</h3>
            <p>Templates supply column sets and formatting only — they never judge your model</p>
          </div>
          <button class="overlay-close hv-step-ink" data-act="close-overlay" aria-label="Close">${cross(14, 1.8)}</button>
        </div>
        <div class="row wide filter-row">
          <input type="search" data-act="template-search" class="tpl-search"
            placeholder="Search templates" aria-label="Search templates" value="${esc(state.templateQuery)}" />
        </div>
      </div>
      <div class="tpl-grid-wrap">
        ${groups || '<div class="tpl-grid"><div class="empty-note">No template matches that.</div></div>'}
      </div>
    </div>
  </div>`;
}
