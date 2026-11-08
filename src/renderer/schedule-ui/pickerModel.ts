// What the field picker lists, and in what order — no markup here (fieldPicker.ts draws it).
//
// Every field the category carries, once each: the core fields, every property key the
// coverage sweep met (exact pset + name), and the schedule's calculated values. The list is
// built from the MODEL, so it can only ever offer what the open file holds.
//
// Ported from ifcTable's `ui/pickerModel.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0, phase 2.

import type { ModelStore } from '../../schedule/ifc/store';
import { fieldKey } from '../../schedule/schedule/actions';
import { CORE_KEYS, CORE_LABELS, type FieldRef, type ScheduleDef } from '../../schedule/schedule/def';
import { suggestedFor } from '../../schedule/schedule/presets';
import { ANY_PSET } from '../../schedule/schedule/resolve';
import { searchByValue } from '../../schedule/schedule/valueSearch';
import { populated, type Coverage } from './coverage';

export const CORE_GROUP = 'Identity & location';
export const CALC_GROUP = 'Calculated';
/** Rows drawn at most, across every section a person picks from; the rest say "keep typing". */
export const MAX_ROWS = 60;

export interface PickRow {
  id: string;
  field: FieldRef;
  name: string;
  /** The name, tagged with its source when another pset carries the same name. */
  label: string;
  /** That source tag alone ("Qto", "Dimensions"), or '' when no other field shares the name. */
  twin: string;
  /** Where it comes from: a pset, the core group, or "Calculated". */
  group: string;
  /** 0…100, or null for a calculated value (it computes for every row). */
  pct: number | null;
  /** From a value search: how many elements hold the match, and one of them. */
  hit?: { n: number; example: string };
}

export interface Section { title: string; rows: PickRow[]; table?: boolean; fold?: boolean }

export interface PickerQuery {
  query: string;
  single: boolean;
  view: 'list' | 'pset';
  showEmpty: boolean;
  shut: Set<string>;
}

export interface PickerModel {
  sections: Section[];
  /** The rows ↑↓ and Enter move through, in order: every drawn, unfolded, pickable row. */
  pickable: PickRow[];
  /** Rows past MAX_ROWS, not drawn. */
  more: number;
  /** 0% fields held back behind "Show N empty fields". */
  emptyHidden: number;
  /** A search whose only name matches are 0% fields, hidden. */
  onlyEmpty: number;
}

/** "Qto" for a quantity set, the set's own name otherwise — shown only to tell twins apart. */
const tagOf = (pset: string) => (/^qto_/i.test(pset) ? 'Qto' : pset.replace(/^pset_/i, ''));

/** 0…100, never rounding a gap away: 0 only when nothing carries it, 100 only when everything does. */
export function pctOf(cov: Coverage, f: FieldRef): number {
  const n = populated(cov, f);
  return !cov.total || !n ? 0 : n >= cov.total ? 100 : Math.min(99, Math.max(1, Math.round(n / cov.total * 100)));
}

export function allRows(def: ScheduleDef, store: ModelStore, cov: Coverage): PickRow[] {
  const pct = (f: FieldRef) => pctOf(cov, f);
  const out: PickRow[] = CORE_KEYS.map((key) => {
    const field: FieldRef = { kind: 'core', key };
    return { id: fieldKey(field), field, name: CORE_LABELS[key], label: CORE_LABELS[key], twin: '', group: CORE_GROUP, pct: pct(field) };
  });
  const props: PickRow[] = [];
  for (const key of cov.tallies.keys()) {
    const stat = store.propCatalog.get(key);
    if (!stat) continue;
    const field: FieldRef = { kind: 'prop', pset: stat.pset, prop: stat.prop };
    props.push({ id: fieldKey(field), field, name: stat.prop, label: stat.prop, twin: '', group: stat.pset || 'no pset', pct: pct(field) });
  }
  // The same name in two psets is two fields: "Width (Dimensions)" and "Width (Qto)".
  const byName = new Map<string, PickRow[]>();
  for (const r of props) byName.set(r.name.toLowerCase(), [...(byName.get(r.name.toLowerCase()) ?? []), r]);
  for (const twins of byName.values()) {
    if (twins.length < 2) continue;
    const tags = twins.map((r) => tagOf(r.group));
    twins.forEach((r, i) => {
      r.twin = tags.filter((t) => t === tags[i]).length > 1 ? r.group : tags[i];
      r.label = `${r.name} (${r.twin})`;
    });
  }
  out.push(...props);
  for (const c of def.calculated ?? []) {
    const field: FieldRef = { kind: 'formula', id: c.id };
    out.push({ id: fieldKey(field), field, name: c.name, label: c.name, twin: '', group: CALC_GROUP, pct: null });
  }
  return out;
}

/** Words of a name or pset, split at punctuation and camelCase: "Qto_DoorBaseQuantities" → qto door base quantities. */
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9²³]+/).filter(Boolean);

/** 0 = no match; higher ranks first. Every typed token must start some word of name or pset. */
function nameScore(r: PickRow, tokens: string[]): number {
  const name = words(r.name);
  const all = [...name, ...words(r.group)];
  if (!tokens.every((t) => all.some((w) => w.startsWith(t)))) return 0;
  return name[0]?.startsWith(tokens[0]) ? 3 : name.some((w) => w.startsWith(tokens[0])) ? 2 : 1;
}

/**
 * Is this field already a column? By exact key — or, for a column that asks by NAME across
 * psets (`pset: '*'`, every template column), by that name, case-insensitive: the template's
 * Width IS the Qto Width row, and offering it again would add a duplicate column. The one
 * test for "in the table", "Suggested" and what may be ticked.
 */
export function inTableTest(def: ScheduleDef): (r: PickRow) => boolean {
  const keys = new Set(def.columns.map((c) => fieldKey(c.field)));
  const anyPset = new Set(def.columns.flatMap((c) =>
    (c.field.kind === 'prop' && c.field.pset === ANY_PSET ? [c.field.prop.toLowerCase()] : [])));
  return (r) => keys.has(r.id) || (r.field.kind === 'prop' && anyPset.has(r.field.prop.toLowerCase()));
}

/** A value search scans the whole category; the same query against the same category and
 *  model is answered once — typing, then an arrow key, then Enter all ask it again. */
let hitsMemo: { store: ModelStore; key: string; hits: ReturnType<typeof searchByValue> } | null = null;
/** Let go of a closed model, as clearCoverageCache does. */
export function clearPickerMemo() { hitsMemo = null; }
function valueHits(store: ModelStore, entities: string[], text: string) {
  const key = `${entities.join('|')}\u0000${text}`;
  if (hitsMemo?.store !== store || hitsMemo.key !== key) hitsMemo = { store, key, hits: searchByValue(store, entities, text) };
  return hitsMemo.hits;
}

const isEmpty = (r: PickRow) => r.pct === 0;
const byCoverage = (a: PickRow, b: PickRow) => (b.pct ?? 101) - (a.pct ?? 101) || a.label.localeCompare(b.label);

export function pickerModel(
  def: ScheduleDef, store: ModelStore, cov: Coverage, q: PickerQuery,
): PickerModel {
  const rows = allRows(def, store, cov);
  const isCol = inTableTest(def);
  // Multi-pick adds columns, so what is already a column is listed apart; a filter or sort
  // may use any field, columns included.
  const avail = (r: PickRow) => q.single || !isCol(r);
  const sections: Section[] = [];
  const text = q.query.trim();
  let emptyHidden = 0;
  let onlyEmpty = 0;

  if (!text) {
    const shown = rows.filter((r) => avail(r) && (q.showEmpty || !isEmpty(r)));
    emptyHidden = rows.filter((r) => avail(r) && isEmpty(r) && !q.showEmpty).length;
    if (!q.single) {
      sections.push({ title: 'In this table', table: true, rows: [] });
    } else {
      const cols = shown.filter(isCol);
      if (cols.length) sections.push({ title: 'In this table', rows: cols });
    }
    const rest = shown.filter((r) => !q.single || !isCol(r));
    if (q.view === 'pset') {
      const groups = [...new Set(rest.map((r) => r.group))]
        .sort((a, b) => Number(b === CORE_GROUP) - Number(a === CORE_GROUP) || Number(a === CALC_GROUP) - Number(b === CALC_GROUP) || a.localeCompare(b));
      for (const g of groups) sections.push({ title: g, fold: true, rows: rest.filter((r) => r.group === g).sort(byCoverage) });
    } else {
      // Suggested: what the category's templates ask for, matched by name across psets.
      const want = suggestedFor(def.entity);
      const sug: PickRow[] = [];
      for (const f of want) {
        for (const r of rest) {
          const hit = f.kind === 'core' ? r.id === fieldKey(f)
            : f.kind === 'prop' && r.field.kind === 'prop' && r.field.prop.toLowerCase() === f.prop.toLowerCase();
          if (hit && !sug.includes(r)) sug.push(r);
        }
      }
      const label = def.entity.map((e) => e.replace(/^Ifc/, '')).join(', ');
      if (sug.length) sections.push({ title: `Suggested for ${label}`, rows: sug });
      const others = rest.filter((r) => !sug.includes(r)).sort(byCoverage);
      sections.push({ title: `All fields · ${others.length}`, rows: others });
    }
  } else {
    const tokens = text.toLowerCase().split(/\s+/);
    const named = rows.filter((r) => avail(r) && nameScore(r, tokens))
      .sort((a, b) => nameScore(b, tokens) - nameScore(a, tokens) || byCoverage(a, b));
    const shownNamed = named.filter((r) => q.showEmpty || !isEmpty(r));
    emptyHidden = named.length - shownNamed.length;
    if (shownNamed.length) sections.push({ title: `Name matches “${text}”`, rows: shownNamed });
    // Fields that CONTAIN what was typed — "120", "2 hr", "FD30" — under the names.
    const hits = text.length >= 2 ? valueHits(store, def.entity, text) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set(shownNamed.map((r) => r.id));
    const valueRows: PickRow[] = [];
    for (const h of hits) {
      const id = fieldKey(h.field);
      const r = byId.get(id);
      if (!r || seen.has(id) || !avail(r)) continue;
      valueRows.push({ ...r, hit: { n: h.hits, example: h.example } });
    }
    if (valueRows.length) sections.push({ title: `Contains “${text}”`, rows: valueRows });
    if (!shownNamed.length && !valueRows.length) onlyEmpty = emptyHidden;
  }

  // Draw at most MAX_ROWS pickable rows; a folded group draws none.
  const pickable: PickRow[] = [];
  let more = 0;
  for (const s of sections) {
    if (s.table || (s.fold && q.shut.has(s.title))) continue;
    const room = Math.max(0, MAX_ROWS - pickable.length);
    if (s.rows.length > room) { more += s.rows.length - room; s.rows = s.rows.slice(0, room); }
    pickable.push(...s.rows);
  }
  return { sections, pickable, more, emptyHidden, onlyEmpty };
}
