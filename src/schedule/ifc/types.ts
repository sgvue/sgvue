// The store's shapes. Ported from ifcTable, where the parse worker produced them; in SGVue
// `schedule/adapter.ts` builds them from the already-parsed federation instead.
import type { Discipline } from './entities';
import type { UnitSystem } from './units';

/** Physical dimension a value carries. Everything is stored in SI base units. */
export type UnitKind = 'length' | 'area' | 'volume' | 'angle' | 'mass' | 'count' | 'none';

/** One resolved cell value. `k` lets the display layer convert units correctly. */
export interface Cell {
  v: string | number | boolean;
  k?: UnitKind;
}

/**
 * Core (non-property) fields, one per element. Mirrors ScheduleDef's CoreKey list.
 * `storeyElevation` is numeric so grouping by level sorts L2 before L10.
 */
export interface ElemCore {
  entity: string;
  name: string;
  description: string;
  mark: string;
  typeName: string;
  family: string;
  objectType: string;
  predefinedType: string;
  guid: string;
  storey: string;
  storeyElevation: number | null;
  building: string;
  site: string;
  space: string;
  material: string;
  discipline: Discipline;
  /**
   * SGVue: the federation's model key (`IfcElement.model`). Optional so a store built without
   * a federation — every ported ifcTable test — still type-checks; blank resolves to no value.
   */
  model?: string;
}

/** What the field picker offers, and how a column formats by default. */
export interface PropStat {
  key: string;                 // 'Pset_DoorCommon.FireRating'
  pset: string;
  prop: string;
  count: number;
  kind: UnitKind;
  type: 'text' | 'number' | 'bool' | 'enum';
  distinct: string[];          // capped at 200
}

export interface ModelMeta {
  fileName: string;
  schema: string;
  projectName: string;
  authoringTool: string;
  lengthUnit: string;          // the file's own unit, for display only
  unitSystem: UnitSystem;      // which defaults a new column takes: mm/m² or ft/ft²
  elementCount: number;
  parseMs: number;
}
