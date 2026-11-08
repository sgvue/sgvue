// The field picker's detail strip: one fixed-height box under the list that says everything
// about ONE field — its full source, how much of the category carries it, what it holds.
// The rows stay one line each because this is where the detail went.
//
// It follows the keyboard highlight, and a hovered row previews in it without moving that
// highlight. Both only rewrite the strip's own node (`drawStrip`): never the list, never the
// table. What it shows is transient UI held in fieldPicker.ts, never AppState.
//
// Ported from ifcTable's `ui/pickerStrip.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2.

import type { FieldRef } from '../../schedule/schedule/def';
import { coverBar, fraction, populated, valuesOf, type Coverage } from './coverage';
import { esc } from './dom';
import { state } from './state';

/** What the strip needs about a row — a picker row or an "In this table" column. */
export interface Peek {
  name: string;
  /** The full pset, "any pset", the core group, or "Calculated". */
  source: string;
  field: FieldRef;
  /** From a value search: how many elements hold the match, and one of them. */
  hit?: { n: number; example: string };
}

export const mark = (text: string, q: string) => {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
};

/** The strip's markup; empty — and quiet — when nothing is highlighted. */
export function stripHtml(p: Peek | undefined, cov: Coverage, query: string): string {
  if (!p) return '';
  const head = `<div class="s1"><span class="sn">${esc(p.name)}</span><span class="sp">${esc(p.source)}</span></div>`;
  // A calculated value computes for every row; whether it produces one is the formula's business.
  if (p.field.kind === 'formula') return head;
  const n = populated(cov, p.field);
  const cat = state.def.entity.map((e) => e.replace(/^Ifc/, '')).join(', ');
  const cover = `<div class="s2">${coverBar(fraction(cov, p.field))}<span>${n.toLocaleString()} of ${cov.total.toLocaleString()} ${esc(cat)}</span></div>`;
  const chips: string[] = [];
  if (p.hit) {
    chips.push(`<span class="pval hit">${mark(p.hit.example, query.trim())}</span>`,
      `<span class="pval more">${p.hit.n.toLocaleString()} element${p.hit.n === 1 ? '' : 's'}</span>`);
  } else {
    const v = valuesOf(cov, p.field, state.store?.meta.unitSystem ?? 'metric');
    if (v) {
      chips.push(...v.top.map((s) => `<span class="pval">${esc(s)}</span>`));
      if (v.more) chips.push(`<span class="pval more">+${v.more.toLocaleString()}${v.capped ? '+' : ''} more</span>`);
      if (v.range) chips.push(`<span class="pval${v.top.length ? ' more' : ''}">${esc(v.range)}</span>`);
    }
  }
  return head + cover + (chips.length ? `<div class="s3">${chips.join('')}</div>` : '');
}
