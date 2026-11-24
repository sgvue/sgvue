// Appearance: how the whole table looks on screen and on paper — the view bar's Style chip.
// Grid lines and stripe rows are the bar's own switches since 2026-11-25, and the rest sits under
// a More… as in the prototype.

import { BODY_FONTS, normaliseFont } from '../../../schedule/schedule/fonts';
import type { AppState } from '../state';
import { esc, option } from '../dom';
import { moreFold, toggle } from './shared';

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

/**
 * The Style chip's body (2026-11-25, the prototype's): the title, with its Show title switch, and
 * the text size; More… holds the outline, the bold header, the blank row and the body font.
 * `idp` prefixes its label/input ids; `more` is whether More… is open.
 */
export function appearanceBody(state: AppState, idp = '', more = false): string {
  const a = state.def.appearance ?? {};

  return `<div class="row ends">
      <label class="lbl" for="${idp}app-title">Title</label>
      ${toggle('app-showtitle', 'Show title', a.showTitle !== false, '', 'row')}
    </div>
    <input id="${idp}app-title" class="full" type="text" data-act="app-title"
      value="${esc(a.title ?? '')}" placeholder="${esc(state.def.name)}" />

    <div class="block">
      <div class="row ends">
        <label class="lbl" for="${idp}app-size">Text size</label>
        <span class="mono size-read">${esc(a.fontSize ?? 13)} px</span>
      </div>
      <input id="${idp}app-size" class="full" type="range" min="10" max="18" step="1"
        data-act="app-fontsize" value="${esc(a.fontSize ?? 13)}" />
    </div>

    <hr class="pop-rule" />
    ${moreFold(more)}
    ${more ? `<div class="pop-more">
      <div class="switch-list">
        ${toggle('app-outline', 'Outline', a.outline !== false, '', 'row')}
        ${toggle('app-headerbold', 'Bold header', a.headerBold !== false, '', 'row')}
        ${toggle('app-blankfirst', 'Blank row before data', !!a.blankRowBeforeData, '', 'row')}
      </div>
      <div class="block">
        <label class="lbl" for="${idp}app-font">Body font</label>
        <select id="${idp}app-font" class="full" data-act="app-font" aria-label="Body font">
          ${fontOptions(a.bodyFont)}
        </select>
        <div class="sub hint-under">${esc(fontNote(a.bodyFont))}</div>
      </div>
    </div>` : ''}`;
}
