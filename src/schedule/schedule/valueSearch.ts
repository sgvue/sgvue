// Find a field by what it CONTAINS, not what it is called.
//
// Opening a model you did not author, you rarely know the property name — the author chose
// it, and it lives in a pset you have never seen. What you do know is the value: "FD30",
// "2 HR", "Household Shelter", "25". This scans the scheduled class once and reports which
// fields carry a matching value, so the lookup runs in the direction the user can start.
//
// Pure: no DOM, no state. One pass over the class per query.

import type { ModelStore } from '../ifc/store';
import type { Cell, UnitKind } from '../ifc/types';
import type { UnitSystem } from '../ifc/units';
import { CORE_KEYS, CORE_LABELS, type CoreKey, type FieldRef } from './def';
import { defaultDecimals, defaultUnit, formatCell, toDisplay } from './format';

interface ValueHit {
  field: FieldRef;
  /** What to show as the field's name. */
  label: string;
  /** Where it came from — a pset name, or the core-field group. */
  group: string;
  /** How many elements in the class carry a matching value. */
  hits: number;
  /** One real value, formatted as the table would show it. */
  example: string;
}

/** Unit words people type alongside a number — dropped before comparing. */
const UNIT_WORDS = /\s*(mm|cm|km|m²|m2|m³|m3|ft²|ft2|ft³|ft3|ft|in|kg|lb|deg|°|m|t|l)\s*$/i;

/**
 * A number typed with or without its unit. "25", "25mm" and "25 mm" all mean the same
 * thing to someone reading a schedule, so they are all the same query here.
 */
function numericQuery(q: string): number | null {
  const bare = q.replace(UNIT_WORDS, '').replace(/,/g, '').trim();
  if (!bare || !/^-?\d*\.?\d+$/.test(bare)) return null;
  const n = Number(bare);
  return Number.isFinite(n) ? n : null;
}

/** Does this cell match? Text is substring; numbers match SI or the default display unit. */
function matches(cell: Cell, needle: string, asNumber: number | null, system: UnitSystem): boolean {
  const v = cell.v;
  if (typeof v === 'number') {
    if (asNumber === null) return false;
    const kind = (cell.k ?? 'none') as UnitKind;
    // A width stored as 0.025 m is what the user sees as "25", so compare in the unit the
    // table would display, rounded the way the table would round it — the model's own
    // system, since that is what a column added from this result would be shown in.
    const shown = toDisplay(v, kind, defaultUnit(kind, system) || undefined);
    const dp = defaultDecimals(kind, system);
    return Math.abs(shown - asNumber) < 0.5 / 10 ** dp || Math.abs(v - asNumber) < 1e-9;
  }
  if (typeof v === 'boolean') return (v ? 'yes true' : 'no false').includes(needle);
  return String(v).toLowerCase().includes(needle);
}

export function searchByValue(
  store: ModelStore, entities: string[], query: string, limit = 12,
): ValueHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const asNumber = numericQuery(needle);
  const system = store.meta.unitSystem;

  const rows = entities.flatMap((e) => store.byEntity.get(e) ?? []);
  if (!rows.length) return [];

  // key -> hits, and the first matching cell as the example.
  const propHits = new Map<string, { n: number; cell: Cell }>();
  const coreHits = new Map<CoreKey, { n: number; value: string }>();

  for (const r of rows) {
    const cells = store.cells[r];
    for (const key in cells) {
      const cell = cells[key];
      if (!matches(cell, needle, asNumber, system)) continue;
      const hit = propHits.get(key);
      if (hit) hit.n++; else propHits.set(key, { n: 1, cell });
    }
    const core = store.cores[r];
    for (const k of CORE_KEYS) {
      const v = core[k];
      if (v === null || v === undefined || v === '') continue;
      // storeyElevation is the one numeric core field; the rest are plain text.
      const ok = typeof v === 'number'
        ? asNumber !== null && Math.abs(v - asNumber) < 1e-9
        : String(v).toLowerCase().includes(needle);
      if (!ok) continue;
      const hit = coreHits.get(k);
      if (hit) hit.n++; else coreHits.set(k, { n: 1, value: String(v) });
    }
  }

  const out: ValueHit[] = [];
  for (const [key, { n, cell }] of propHits) {
    const dot = key.indexOf('.');
    const pset = dot > 0 ? key.slice(0, dot) : '';
    const prop = dot > 0 ? key.slice(dot + 1) : key;
    out.push({
      field: { kind: 'prop', pset, prop },
      label: prop, group: pset || 'no pset', hits: n,
      example: formatCell(cell) || '—',
    });
  }
  for (const [k, { n, value }] of coreHits) {
    out.push({
      field: { kind: 'core', key: k },
      label: CORE_LABELS[k], group: 'Identity & location', hits: n, example: value,
    });
  }

  // Most-carried first: the field that holds the value on the most elements is almost
  // always the one being looked for.
  return out.sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label)).slice(0, limit);
}
