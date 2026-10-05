// Turns a FieldRef into a Cell for a given element row.
//
// A template column names the property it wants but not the set holding it, so it asks for
// pset '*' and matches by property name across every pset — which is what lets one template
// fit models from different tools. Real files also disagree with themselves on casing
// (SGPset_CivilElement and SGPSet_CivilElement both occur), so all pset-name comparison
// here is case-insensitive.

import type { Cell, ElemCore } from '../ifc/types';
import type { ModelStore } from '../ifc/store';
import type { CoreKey, FieldRef } from './def';

export const ANY_PSET = '*';

/** Computed formula values for one row, keyed 'formula:id'. */
export type Computed = Map<string, Cell | undefined>;

/** Core fields that are numbers, not text — they must sort numerically. */
function coreCell(core: ElemCore, key: CoreKey): Cell | undefined {
  const v = core[key];
  if (v === null || v === undefined || v === '') return undefined;
  // storeyElevation is the one numeric core field — it must sort as a number.
  if (key === 'storeyElevation') return { v: v as number, k: 'length' };
  return { v: String(v) };
}

/**
 * Pick one pset for a wildcard property match. The job is DETERMINISM: the same file must
 * always resolve to the same value, so a tie has to break on something. Authored properties
 * beat derived quantities (Qto_ last, so a Qto Width never hides the one someone typed) and
 * equal ranks break alphabetically. SGPset sorting first is not an audience — it costs
 * nothing on the models that have no such pset, and keeps the choice stable on the ones
 * that do.
 */
function rank(pset: string): number {
  const u = pset.toUpperCase();
  if (u.startsWith('SGPSET')) return 0;
  if (u.startsWith('PSET_')) return 1;
  if (u.startsWith('QTO_')) return 3;
  return 2;
}

function wildcardLookup(cells: Record<string, Cell>, prop: string): Cell | undefined {
  const target = prop.toUpperCase();
  let bestKey: string | null = null;
  let bestRank = Infinity;
  for (const key in cells) {
    const dot = key.indexOf('.');
    if (dot < 0) continue;
    if (key.slice(dot + 1).toUpperCase() !== target) continue;
    const r = rank(key.slice(0, dot));
    if (r < bestRank || (r === bestRank && bestKey !== null && key < bestKey)) {
      bestRank = r;
      bestKey = key;
    }
  }
  return bestKey === null ? undefined : cells[bestKey];
}

function exactLookup(cells: Record<string, Cell>, pset: string, prop: string): Cell | undefined {
  const direct = cells[pset + '.' + prop];
  if (direct !== undefined) return direct;
  // Fall back to a case-insensitive sweep — real files vary their own pset casing.
  const wantPset = pset.toUpperCase();
  const wantProp = prop.toUpperCase();
  for (const key in cells) {
    const dot = key.indexOf('.');
    if (dot < 0) continue;
    if (key.slice(0, dot).toUpperCase() === wantPset && key.slice(dot + 1).toUpperCase() === wantProp) {
      return cells[key];
    }
  }
  return undefined;
}

/**
 * Resolve a field for one row. `computed` supplies formula values, which the
 * engine calculates in its own pass (they can depend on other columns).
 */
export function resolveField(
  store: ModelStore,
  row: number,
  field: FieldRef,
  computed?: Map<string, Cell | undefined>,
): Cell | undefined {
  switch (field.kind) {
    case 'core':
      return coreCell(store.cores[row], field.key);
    case 'prop': {
      const cells = store.cells[row];
      return field.pset === ANY_PSET
        ? wildcardLookup(cells, field.prop)
        : exactLookup(cells, field.pset, field.prop);
    }
    case 'formula':
      return computed?.get('formula:' + field.id);
  }
}
