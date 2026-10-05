// The colour rules for one column: a condition read as a sentence, the pair of colours a
// matching cell takes, and what that rule is actually doing to the schedule.
//
// What the result LOOKS like is not shown here — the Format tab's Preview box holds a real
// value from the model and wears whichever rule fires on it, which is the same question
// asked on an actual value rather than on the letters "Aa". What IS shown here is the half
// a preview cannot answer: how many rows the rule reaches, and a way to see them. A rule
// that colours nothing looks identical to a rule that colours everything until you can.

import type { PropStat } from '../../../schedule/ifc/types';
import { OP_LABELS, opsForType } from '../../../schedule/schedule/compare';
import type { Column, Op } from '../../../schedule/schedule/def';
import type { ScheduleResult } from '../../../schedule/schedule/engine';
import type { AppState } from '../state';
import { esc, option } from '../dom';
import { toggle } from './shared';
import { cross } from '../icons';

/**
 * Six ready-made pairs: a soft fill with text deep enough to stay readable on it. Picking
 * a fill and a text colour separately is two decisions with a legibility trap between them,
 * and the naked pair of swatches this replaced asked for both with no example of the answer.
 *
 * Written as #rrggbb because that is a form `def.ts`'s import sanitiser accepts, so a
 * preset survives the export → import round trip — which is the point of having presets.
 */
const COND_PRESETS: [string, string][] = [
  ['#fff3cd', '#664d03'],
  ['#f8d7da', '#58151c'],
  ['#d1e7dd', '#0a3622'],
  ['#cfe2ff', '#052c65'],
  ['#ffe5d0', '#653208'],
  ['#e2e3e5', '#2b2f32'],
];
/** What the colour boxes fall back to for a rule that stores no colour of its own. */
const COND_BG = '#fff3cd';
const COND_FG = '#1b1f24';

/**
 * The operators a colour rule may use on this column — the same type-aware list the Filter
 * tab offers, minus `in` and `between`. Those two need a SECOND value, and a CondRule holds
 * one; the saved format is frozen, so they are withheld rather than half-supported.
 *
 * A stored op outside the list is appended rather than dropped. Rules saved under the old
 * UI can hold `contains` on a number column, and a select that silently displays its first
 * option instead would rewrite that rule the moment anything else on the card was touched.
 *
 * The type arrives already worked out, because deciding it walks every property key in the
 * category — one answer for the column, not one per rule card.
 */
function opsFor(type: PropStat['type'], op: Op): Op[] {
  const ops: Op[] = opsForType(type).filter((o) => o !== 'in' && o !== 'between');
  return ops.includes(op) ? ops : [...ops, op];
}

export function conditionalRules(
  state: AppState, type: PropStat['type'], col: Column, colIndex: number, res: ScheduleResult,
): string {
  const rules = col.conditional ?? [];
  // Undefined for a hidden column: it has no cells in this result, so there is nothing
  // honest to count and the effect line is left off entirely.
  const claims = res.conditionalHits?.[colIndex];

  const cards = rules.map((r, n) => {
    const bg = (r.bg ?? COND_BG).toLowerCase();
    const fg = (r.fg ?? COND_FG).toLowerCase();
    const presets = COND_PRESETS.map(([pb, pf]) => `<button class="cond-preset${
      pb === bg && pf === fg ? ' on' : ''}" data-act="cond-preset" data-i="${n}"
      data-bg="${esc(pb)}" data-fg="${esc(pf)}" style="background:${esc(pb)};color:${esc(pf)}"
      title="Use this pair" aria-label="Colour pair">Aa</button>`).join('');

    // A presence rule asks about the cell, not about a value, so there is no value to type
    // — and the operator takes the room the box would have had.
    const presence = r.op === 'hasValue' || r.op === 'noValue';
    const ops = opsFor(type, r.op)
      .map((o) => option(o, OP_LABELS[o], r.op === o)).join('');

    const showing = state.litBy?.col === colIndex && state.litBy.rule === n;
    const hits = claims?.hits[n] ?? 0;
    const effect = claims ? `<div class="row ends rule-effect">
        <span class="sub">Colours <strong>${hits.toLocaleString()}</strong> of ${claims.of.toLocaleString()} rows
          <button class="link" data-act="cond-show" data-i="${n}"${hits ? '' : ' disabled'}>${showing ? 'back to schedule' : 'show them'}</button>
        </span>
      </div>` : '';

    return `<div class="subcard" data-i="${n}">
      <div class="row">
        <span class="cond-when">When</span>
        <select class="cond-op${presence ? ' solo' : ''}" data-act="cond-op" data-i="${n}" aria-label="Condition">${ops}</select>
        ${presence ? '' : `<input class="grow-1" type="text" data-act="cond-value" data-i="${n}" value="${esc(r.value ?? '')}"
          placeholder="value" aria-label="Value" />`}
        <button class="x-btn hv-warn-both" data-act="cond-remove" data-i="${n}" title="Remove">${cross()}</button>
      </div>
      <div class="row block snug">
        <span class="cond-presets">${presets}</span>
      </div>
      <div class="row block snug">
        <label class="cond-swatch"><span class="lbl">Fill</span>
          <input type="color" data-act="cond-bg" data-i="${n}" value="${esc(bg)}" aria-label="Fill colour" /></label>
        <label class="cond-swatch"><span class="lbl">Text</span>
          <input type="color" data-act="cond-fg" data-i="${n}" value="${esc(fg)}" aria-label="Text colour" /></label>
        ${toggle('cond-bold', 'Bold', !!r.bold, ` data-i="${n}"`)}
      </div>
      ${effect}
    </div>`;
  }).join('');

  const empty = '<div class="sub">No rules yet. A rule colours every cell in this column whose value matches it.</div>';
  // Literally what firingRule does: it returns on the first rule that claims the cell.
  const order = rules.length > 1 ? '<div class="sub block snug">When rules overlap, the first match wins.</div>' : '';
  return `<div class="stack">${cards || empty}</div>${order}
    <button class="dashed block snug" data-act="cond-add">+ Add rule</button>`;
}
