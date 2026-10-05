// Appearance: how the whole table looks on screen and on paper.

import { BODY_FONTS, normaliseFont } from '../../../schedule/schedule/fonts';
import type { AppState } from '../state';
import { esc, option } from '../dom';
import { toggle } from './shared';

/** Recommended first, under a heading, because that is the answer for most people. */
function fontOptions(current: string | undefined): string {
  const now = normaliseFont(current);
  const group = (label: string, wanted: boolean) => {
    const items = BODY_FONTS.filter((f) => !!f.recommended === wanted);
    return items.length
      ? `<optgroup label="${label}">${items.map((f) => option(f.key, f.label, f.key === now)).join('')}</optgroup>`
      : '';
  };
  return group('Recommended for tables', true) + group('Other', false);
}

/** Say WHY a face is recommended, rather than making the user try each one. */
function fontNote(current: string | undefined): string {
  const f = BODY_FONTS.find((x) => x.key === normaliseFont(current));
  return f?.note ?? '';
}

export function appearanceSummary(state: AppState): string {
  const a = state.def.appearance ?? {};
  return `${a.gridLines !== false ? 'Grid' : 'No grid'} · ${a.zebra !== false ? 'zebra' : 'plain'} · ${a.fontSize ?? 13} px`;
}

export function appearanceBody(state: AppState): string {
  const a = state.def.appearance ?? {};

  return `<div class="eyebrow block-label">Graphics</div>
    <div class="switch-list">
      ${toggle('app-grid', 'Grid lines', a.gridLines !== false, '', 'row')}
      ${toggle('app-outline', 'Outline', a.outline !== false, '', 'row')}
      ${toggle('app-zebra', 'Stripe rows', a.zebra !== false, '', 'row')}
      ${toggle('app-blankfirst', 'Blank row before data', !!a.blankRowBeforeData, '', 'row')}
    </div>

    <div class="rule-sep"></div>

    <div class="eyebrow block-label">Text</div>
    <div class="switch-list">
      ${toggle('app-showtitle', 'Show title', a.showTitle !== false, '', 'row')}
      ${toggle('app-headerbold', 'Bold header', a.headerBold !== false, '', 'row')}
    </div>

    <div class="block tight">
      <label class="lbl" for="app-title">Title</label>
      <input id="app-title" class="full" type="text" data-act="app-title"
        value="${esc(a.title ?? '')}" placeholder="${esc(state.def.name)}" />
    </div>

    <div class="block">
      <div class="row ends">
        <label class="lbl" for="app-size">Text size</label>
        <span class="mono size-read">${esc(a.fontSize ?? 13)} px</span>
      </div>
      <input id="app-size" class="full" type="range" min="10" max="18" step="1"
        data-act="app-fontsize" value="${esc(a.fontSize ?? 13)}" />
    </div>

    <div class="block">
      <label class="lbl" for="app-font">Body font</label>
      <select id="app-font" class="full" data-act="app-font" aria-label="Body font">
        ${fontOptions(a.bodyFont)}
      </select>
      <div class="sub hint-under">${esc(fontNote(a.bodyFont))}</div>
    </div>`;
}
