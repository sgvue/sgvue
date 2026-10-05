// The in-memory model. One wide sparse record per element — the store IS the table.
//
// Two indexes are built once at load and everything else reads them:
//   byEntity    schedules are per-category, so filter/sort/render touch 200-3,300 rows, not 27,000
//   propCatalog what the field picker offers, and how a column formats by default

import type { Cell, ElemCore, ModelMeta, PropStat, UnitKind } from './types';

const DISTINCT_CAP = 200;

export interface ModelStore {
  meta: ModelMeta;
  cores: ElemCore[];
  cells: Record<string, Cell>[];
  byEntity: Map<string, number[]>;
  propCatalog: Map<string, PropStat>;
  /** Entity names, most populous first — drives the category picker. */
  entities: { entity: string; count: number }[];
}

/** Accumulates chunks as they stream in, then indexes once at the end. */
export class StoreBuilder {
  private cores: ElemCore[] = [];
  private cells: Record<string, Cell>[] = [];

  add(cores: ElemCore[], cells: Record<string, Cell>[]) {
    for (let i = 0; i < cores.length; i++) {
      this.cores.push(cores[i]);
      this.cells.push(cells[i]);
    }
  }

  get count() { return this.cores.length; }

  finish(meta: ModelMeta): ModelStore {
    const byEntity = new Map<string, number[]>();
    for (let i = 0; i < this.cores.length; i++) {
      const e = this.cores[i].entity;
      const arr = byEntity.get(e);
      if (arr) arr.push(i); else byEntity.set(e, [i]);
    }

    const entities = [...byEntity]
      .map(([entity, rows]) => ({ entity, count: rows.length }))
      .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity));

    return {
      meta,
      cores: this.cores,
      cells: this.cells,
      byEntity,
      propCatalog: buildCatalog(this.cells),
      entities,
    };
  }
}

/**
 * One pass over every cell to learn what each property looks like.
 * Type inference decides a column's default alignment and which filter operators apply.
 */
export function buildCatalog(cells: Record<string, Cell>[]): Map<string, PropStat> {
  interface Acc {
    key: string; count: number; kind: UnitKind;
    nums: number; bools: number; texts: number;
    distinct: Set<string>; overflow: boolean;
  }
  const acc = new Map<string, Acc>();

  for (const row of cells) {
    for (const key in row) {
      const cell = row[key];
      let a = acc.get(key);
      if (!a) {
        a = { key, count: 0, kind: 'none', nums: 0, bools: 0, texts: 0,
          distinct: new Set(), overflow: false };
        acc.set(key, a);
      }
      a.count++;
      if (cell.k && cell.k !== 'none') a.kind = cell.k;

      const v = cell.v;
      if (typeof v === 'number') {
        a.nums++;
      } else if (typeof v === 'boolean') {
        a.bools++;
      } else {
        a.texts++;
      }
      if (!a.overflow) {
        a.distinct.add(String(v));
        if (a.distinct.size > DISTINCT_CAP) a.overflow = true;
      }
    }
  }

  const out = new Map<string, PropStat>();
  for (const a of acc.values()) {
    const dot = a.key.indexOf('.');
    const type: PropStat['type'] =
      a.bools > 0 && a.nums === 0 && a.texts === 0 ? 'bool'
        : a.nums > 0 && a.texts === 0 ? 'number'
          : !a.overflow && a.distinct.size <= 12 ? 'enum'
            : 'text';
    out.set(a.key, {
      key: a.key,
      pset: dot > 0 ? a.key.slice(0, dot) : '',
      prop: dot > 0 ? a.key.slice(dot + 1) : a.key,
      count: a.count,
      kind: a.kind,
      type,
      distinct: a.overflow ? [] : [...a.distinct].sort((x, y) =>
        type === 'number' ? Number(x) - Number(y) : x.localeCompare(y)),
    });
  }
  return out;
}

/**
 * Property keys observed on a given category, so the field picker only ever offers
 * what actually exists there. Sorted SG-first, then by how widely populated they are.
 */
export function keysForEntity(store: ModelStore, entities: string[]): PropStat[] {
  const rows = entities.flatMap((e) => store.byEntity.get(e) ?? []);
  const seen = new Map<string, number>();
  for (const i of rows) {
    for (const key in store.cells[i]) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const out: PropStat[] = [];
  for (const [key, count] of seen) {
    const stat = store.propCatalog.get(key);
    if (stat) out.push({ ...stat, count });
  }
  return out.sort((a, b) => {
    const sg = Number(b.pset.toUpperCase().startsWith('SGPSET')) - Number(a.pset.toUpperCase().startsWith('SGPSET'));
    return sg || b.count - a.count || a.key.localeCompare(b.key);
  });
}
