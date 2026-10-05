// The "0 values in model" flow.
//
// A template asks for properties by name. A model whose author named them differently will
// not have them, and the schedule would render as a wall of blank columns with no
// explanation — the app would look broken.
//
// So: name the problem on the column, and offer near-name matches from what this model
// actually contains. This is usability, not compliance checking; nothing is judged.

import { keysForEntity, type ModelStore } from '../../schedule/ifc/store';
import type { PropStat } from '../../schedule/ifc/types';
import type { Column, ScheduleDef } from '../../schedule/schedule/def';

/** Collapse case, spaces, underscores and hyphens so FireRating finds Fire_Rating. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.]+/g, '');
}

interface Candidate { stat: PropStat; score: number }

/**
 * Properties in this model that plausibly mean the same thing as `prop`.
 * Ranked: exact-ignoring-punctuation, then contains, then shared word stem.
 */
export function remapCandidates(store: ModelStore, def: ScheduleDef, prop: string, limit = 12): Candidate[] {
  const want = normalise(prop);
  if (!want) return [];
  const out: Candidate[] = [];

  for (const stat of keysForEntity(store, def.entity)) {
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
