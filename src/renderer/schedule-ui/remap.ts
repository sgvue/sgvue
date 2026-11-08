// The "0 values in model" flow.
//
// A template asks for properties by name. A model whose author named them differently will
// not have them, and the schedule would render as a wall of blank columns with no
// explanation — the app would look broken.
//
// So: name the problem on the column, and offer near-name matches from what this model
// actually contains. This is usability, not compliance checking; nothing is judged.
//
// ifcTable's 2026-11-05 version (SGVue v1.5.0, phase 2): candidates are counted the way
// coverage counts, and `remapBlock` moved here from the retired Fields tab — the column menu
// draws it under a column nothing carries.

import { keysForEntity, type ModelStore } from '../../schedule/ifc/store';
import type { PropStat } from '../../schedule/ifc/types';
import { headingOf, type Column, type ScheduleDef } from '../../schedule/schedule/def';
import { populated, type Coverage } from './coverage';
import { esc, option } from './dom';

/** Collapse case, spaces, underscores and hyphens so FireRating finds Fire_Rating. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.]+/g, '');
}

interface Candidate { stat: PropStat; score: number }

/**
 * Properties in this model that plausibly mean the same thing as `prop`.
 * Ranked: exact-ignoring-punctuation, then contains, then shared word stem. Counted the way
 * coverage counts (placeholders like "-" are no value), and a property nothing really carries
 * is never offered — pointing an empty column at another empty one fixes nothing.
 */
export function remapCandidates(store: ModelStore, def: ScheduleDef, cov: Coverage, prop: string, limit = 12): Candidate[] {
  const want = normalise(prop);
  if (!want) return [];
  const out: Candidate[] = [];

  for (const raw of keysForEntity(store, def.entity)) {
    const count = populated(cov, { kind: 'prop', pset: raw.pset, prop: raw.prop });
    if (!count) continue;
    const stat = { ...raw, count };
    const have = normalise(stat.prop);
    let score = 0;
    if (have === want) score = 100;
    else if (have.includes(want) || want.includes(have)) score = 70;
    else {
      // share a meaningful chunk, e.g. FireRating vs RatingFire
      const chunks = prop.split(/(?=[A-Z])|[\s_\-]+/).filter((c) => c.length > 3).map(normalise);
      if (chunks.some((c) => have.includes(c))) score = 40;
    }
    if (score) out.push({ stat, score });
  }

  return out
    .sort((a, b) => b.score - a.score || b.stat.count - a.stat.count || a.stat.key.localeCompare(b.stat.key))
    .slice(0, limit);
}

/** The property name a column is asking for, if it is a property column. */
export function propNameOf(col: Column): string | null {
  return col.field.kind === 'prop' ? col.field.prop : null;
}

/** Offer a way out of a blank column instead of leaving the user guessing. */
export function remapBlock(store: ModelStore, def: ScheduleDef, cov: Coverage, i: number): string {
  const col = def.columns[i];
  const prop = propNameOf(col);
  const candidates = prop ? remapCandidates(store, def, cov, prop) : [];
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
