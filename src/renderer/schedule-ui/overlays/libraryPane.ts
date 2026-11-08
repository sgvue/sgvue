// The Templates library's preview pane: exactly what the selected template gives on THIS model
// — how many elements, which columns it finds (with a count each), how it is arranged, and its
// first rows as the table will draw them — and the one action set, the same for a built-in and
// a saved template.
//
// Ported from ifcTable's `ui/overlays/libraryPane.ts` (Yong Yen, 2026-11-07) for SGVue v1.5.0,
// phase 3, in this window's tokens. Drawn fresh on every paint, so nothing here animates.

import type { ModelStore } from '../../../schedule/ifc/store';
import { ruleText } from '../../../schedule/schedule/compare';
import { CORE_LABELS, defaultHeading, headingOf, type Column, type SortLevel } from '../../../schedule/schedule/def';
import type { RenderRow } from '../../../schedule/schedule/engine';
import { buildCoverage, coverBar, populated } from '../coverage';
import { esc } from '../dom';
import { ICON } from '../icons';
import { fitOf, inModelOf, previewOf, wantPreview } from '../libraryCache';
import { classCount, currentKey, READ_ONLY, shortDate, type Tpl } from '../libraryModel';
import type { AppState } from '../state';
import { alignOf } from '../tableView';

const sourceOf = (col: Column): string => {
  const f = col.field;
  const src = f.kind === 'core' ? CORE_LABELS[f.key] : f.kind === 'prop' ? f.prop : 'Calculated';
  return col.format?.display ? `${src} · ${col.format.display}` : src;
};

/** "Level ↑, then Width ↓" — what Sort and Group say, in the words the table uses. */
const levels = (list: SortLevel[], t: Tpl) => list.map((s) => `${defaultHeading(s.field, t.def)}${s.dir === 'desc' ? ' ↓' : ''}`);

/** ✓/✗ plus a count for each column; counts are exact over a filtered template's rows. */
function manifest(store: ModelStore, t: Tpl, found: (i: number) => number | undefined, of: number): string {
  return t.def.columns.map((col, i) => {
    const hd = headingOf(col, t.def);
    const src = sourceOf(col);
    const srcHtml = src !== hd ? `<span class="src-f">${esc(src)}</span>` : '';
    if (!classCount(store, t)) return `<div class="mf-row"><span class="hd">${esc(hd)}</span>${srcHtml}</div>`;
    if (col.field.kind === 'formula') {
      return `<div class="mf-row"><span class="ok">✓</span><span class="hd">${esc(hd)}</span>${srcHtml}<span class="cnt">calculated</span></div>`;
    }
    const n = found(i);
    if (n === undefined) return `<div class="mf-row"><span class="ok"></span><span class="hd">${esc(hd)}</span>${srcHtml}<span class="cnt">…</span></div>`;
    const cnt = n === 0 ? '<span class="cov zero">not found</span>'
      : n < of ? `<span class="cov">${n}/${of}</span>` : `<span class="cnt">${n}/${of}</span>`;
    return `<div class="mf-row${n ? '' : ' miss'}"><span class="ok${n ? '' : ' no'}">${n ? '✓' : ICON.remove}</span>`
      + `<span class="hd">${esc(hd)}</span>${srcHtml}${cnt}</div>`;
  }).join('');
}

function firstRows(t: Tpl, rows: RenderRow[], cols: Column[], headings: string[], count: boolean, missing: Set<number>): string {
  const width = cols.length + (count ? 1 : 0);
  const ths = cols.map((c, i) => {
    const right = alignOf(c) === 'right';
    const miss = missing.has(i);
    const unit = c.format?.display ? `<span class="u">${esc(c.format.display)}</span>` : '';
    const cls = [right ? 'r' : '', miss ? 'miss' : ''].filter(Boolean).join(' ');
    return `<th${cls ? ` class="${cls}"` : ''}${
      miss ? ' title="Not found in this model — the column will be empty"' : ''}>${esc(headings[i])}${unit}</th>`;
  }).join('') + (count ? '<th class="r">Count</th>' : '');
  const body = rows.map((r) => {
    if (r.kind === 'group') return `<tr class="group"><td colspan="${width}">${esc(r.label)} (${r.count})</td></tr>`;
    if (r.kind !== 'data') return '';
    return `<tr class="data">${r.cells.map((v, j) => `<td${alignOf(cols[j]) === 'right' ? ' class="r"' : ''}>${esc(v)}</td>`).join('')}${
      count ? `<td class="r">${r.count}</td>` : ''}</tr>`;
  }).join('');
  return `<table class="mini" aria-label="First rows of ${esc(t.name)}"><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table>`;
}

function body(state: AppState, store: ModelStore, t: Tpl): string {
  const inUse = currentKey(state) === t.key;
  const mine = t.src === 'mine';
  const tag = `<span class="src-tag${mine ? ' mine' : ''}">${mine ? 'Mine' : t.section === 'ifcsg' ? 'IFC-SG' : 'Built-in'}</span>`;
  const badge = inUse ? (state.dirty ? '<span class="badge">EDITED</span>' : '<span class="badge accent">IN USE</span>') : '';
  let html = `<div class="ph"><h4>${esc(t.name)}</h4><div class="tags">${tag}${badge}</div></div>`;
  const saved = mine && t.savedAt ? ` · saved ${esc(shortDate(t.savedAt))}` : '';
  const cls = esc(t.entities.join(' + '));
  const total = classCount(store, t);
  const filtered = t.def.filters.length > 0;
  const n = inModelOf(store, t);
  const shownN = n === undefined ? '…' : n.toLocaleString();
  html += `<div class="pmeta">${cls} · <b>${shownN}</b>${filtered && total ? ` of ${total.toLocaleString()}` : ''} in model${saved}</div>`;
  if (filtered) {
    const join = t.def.filterLogic === 'or' ? 'or' : 'and';
    html += `<div class="pfilter">${t.def.filters.map((f, i) => `<span class="vchip filter"><span class="k">${i ? join : 'Only where'}</span><span class="v">${esc(ruleText(f, t.def))}</span></span>`).join('')}</div>`;
  }
  if (inUse && state.dirty) {
    html += `<div class="notice lib-notice"><span class="grow">The schedule on screen has changes not saved here.</span>${
      mine ? '<button class="btn" data-act="library-save-over">Save changes</button>'
        : '<button class="btn" data-act="library-save-as">Save as mine…</button>'}</div>`;
  }

  // What each column finds: class coverage, or — for a filtered template — exact counts over
  // its own rows, from the preview run.
  let found: (i: number) => number | undefined = () => undefined;
  let of = 0;
  const preview = total ? previewOf(store, t) : undefined;
  if (total) {
    wantPreview(store, t);
    if (filtered) {
      found = (i) => preview?.found?.[i];
      of = preview?.matched ?? 0;
    } else {
      const cov = buildCoverage(store, t.entities);
      found = (i) => populated(cov, t.def.columns[i].field);
      of = cov.total;
    }
  }
  if (!total) {
    html += `<div class="notice lib-notice">This model has no ${esc(t.entities.join(' or '))} — using this gives an empty table.</div>`;
  } else {
    const f = filtered
      ? (preview?.found ? { found: preview.found.filter((x) => x > 0).length, of: t.def.columns.length } : undefined)
      : fitOf(store, t, true);
    html += `<div class="pfit">${coverBar(f && f.of ? f.found / f.of : 0)}<span>${
      f ? `<b>${f.found} of ${f.of}</b> columns found` : '…'}</span></div>`;
  }
  html += `<div class="psec-h"><span class="eyebrow">Columns</span><span class="sub mono">${t.def.columns.length}</span></div>
    <div class="manifest">${manifest(store, t, found, of)}</div>`;

  const sort = t.def.sort.filter((s) => !s.header);
  const group = t.def.sort.filter((s) => s.header);
  if (sort.length || group.length) {
    html += `<div class="psec-h"><span class="eyebrow">Arranged</span></div><dl class="kv">${
      sort.length ? `<dt>Sort</dt><dd>${esc(levels(sort, t).join(', then '))}</dd>` : ''}${
      group.length ? `<dt>Group</dt><dd>${esc(levels(group, t).join(' › '))}</dd>` : ''}</dl>`;
  }

  if (total && preview && preview.matched) {
    const res = preview.res;
    const rowsN = t.def.itemize === false ? res.totalDataRows : preview.matched;
    // A visible column's index in def.columns, so a column with no value marks its heading.
    const defIdx: number[] = [];
    t.def.columns.forEach((c, i) => { if (!c.hidden) defIdx.push(i); });
    const missing = new Set(defIdx.flatMap((d, i) => (found(d) === 0 ? [i] : [])));
    const shown = res.rows.filter((r) => r.kind === 'data').length;
    html += `<div class="psec-h"><span class="eyebrow">First rows</span><span class="sub mono">${rowsN.toLocaleString()} row${rowsN === 1 ? '' : 's'}</span></div>
      <div class="mini-wrap">${firstRows(t, res.rows, res.columns, res.headings, res.countColumn, missing)}${
  rowsN > shown ? `<div class="mini-more">+ ${(rowsN - shown).toLocaleString()} more</div>` : ''}</div>`;
  } else if (total && !preview) {
    html += '<div class="psec-h"><span class="eyebrow">First rows</span></div><div class="mini-wait"></div>';
  }
  return html;
}

/** One action set, the same slots for both sources; a built-in's Rename and Delete stay greyed. */
function bar(state: AppState, t: Tpl): string {
  const ro = t.src !== 'mine';
  // `act` is the whole data-act attribute, written out at each call: tests/unit/schedule/
  // acts.test.ts reads the literals to prove every control is wired, and cannot see an
  // interpolated name.
  const ib = (act: string, icon: string, label: string, opts: { off?: boolean; hover?: string; kb?: string } = {}) =>
    `<button class="icon-btn ${opts.hover ?? 'hv-step'}" ${act}${
      opts.off ? ` aria-disabled="true" title="${READ_ONLY}"` : ` title="${label}${opts.kb ? ` (${opts.kb})` : ''}"`} aria-label="${label}">${icon}</button>`;
  const inUse = currentKey(state) === t.key;
  const use = inUse && !state.dirty ? '<button class="btn primary use" disabled>In use</button>'
    : inUse ? '<button class="btn primary use" data-act="library-use">Revert to saved</button>'
      : '<button class="btn primary use" data-act="library-use">Use <kbd>↵</kbd></button>';
  return `<div class="pane-bar">
    ${ib('data-act="library-duplicate"', ICON.duplicate, ro ? 'Duplicate to Mine' : 'Duplicate')}
    ${ib('data-act="library-rename-start"', ICON.rename, 'Rename', { off: ro, kb: 'F2' })}
    ${ib('data-act="library-export"', ICON.exportFile, 'Export as .schedule.json')}
    <span class="vsep"></span>
    ${ib('data-act="library-delete"', ICON.trash, 'Delete', { off: ro, hover: ro ? '' : 'hv-warn-both', kb: 'Del in the list' })}
    ${ro ? `<span class="ro" title="${READ_ONLY}">Read-only</span>` : ''}
    ${use}
  </div>`;
}

export function libraryPane(state: AppState, store: ModelStore, t: Tpl | null): string {
  if (!t) return `<div class="pane-empty">${ICON.templatesLarge}</div>`;
  return `<div class="pane-scroll">${body(state, store, t)}</div>${bar(state, t)}`;
}
