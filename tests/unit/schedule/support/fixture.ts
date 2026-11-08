// Deterministic synthetic model and schedule definitions shared by the safety-net tests
// (golden master, round-trip, simulation). No IFC file: the store is built the way the
// engine tests build theirs — ElemCore rows plus sparse property cells — so every value is
// fixed in source and the outputs can be snapshotted byte for byte.
//
// Ported from ifcTable's `tests/support/fixture.ts` (Yong Yen) for SGVue v1.5.0, phase 1 of
// the ifcTable update. The synthetic store and every case are ifcTable's, unchanged — so
// SGVue's golden files can be read against ifcTable's own. SGVue adds a third store, the
// design's four-model mock federation through SGVue's own adapter (`snapshotOf`), which is
// the store the Schedules window really receives, `Model` field and all.

import { readFileSync } from 'node:fs';
import { StoreBuilder, type ModelStore } from '../../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../../src/schedule/ifc/types';
import type { UnitSystem } from '../../../../src/schedule/ifc/units';
import { emptySchedule, parseScheduleDef, type CoreKey, type ScheduleDef } from '../../../../src/schedule/schedule/def';
import { PRESETS, presetById, scheduleFromPreset } from '../../../../src/schedule/schedule/presets';
import { openingSchedule, withModelColumn } from '../../../../src/schedule/schedule/columns';
import { snapshotOf } from '../../../../src/schedule/adapter';
import { federate } from '../../../../src/shared/federate';
import { mockModelIndex } from '../../../../src/renderer/dev/mock-adapter';

const STOREYS: [string, number | null][] = [
  ['Level 1', 0], ['Level 2', 3.5], ['Level 10', 31.5], ['Roof', null],
];
const FIRE = ['60 min', '90 min', '', '=SUM(A1)', 'FR, "120"'];

/** Per-class: how many elements, and which properties (pset.prop → value maker). */
type Maker = (i: number) => Cell | undefined;
const len = (base: number): Maker => (i) => (i % 5 === 3 ? undefined : { v: base + i * 0.137, k: 'length' });
const area = (base: number): Maker => (i) => (i % 4 === 2 ? undefined : { v: base + i * 1.234, k: 'area' });
const vol = (base: number): Maker => (i) => (i % 6 === 5 ? undefined : { v: base + i * 0.0417, k: 'volume' });
const txt = (vals: string[]): Maker => (i) => (vals[i % vals.length] === '' ? undefined : { v: vals[i % vals.length] });
const bool: Maker = (i) => (i % 3 === 2 ? undefined : { v: i % 2 === 0 });

const CLASSES: { entity: string; n: number; type: string; props: Record<string, Maker> }[] = [
  { entity: 'IfcWall', n: 7, type: 'Basic Wall:Generic 200mm', props: {
    'Qto_WallBaseQuantities.Length': len(2.4), 'Qto_WallBaseQuantities.Width': len(0.2),
    'Qto_WallBaseQuantities.Height': len(2.8), 'Qto_WallBaseQuantities.NetSideArea': area(6),
    'Qto_WallBaseQuantities.NetVolume': vol(1.2), 'Pset_WallCommon.FireRating': txt(FIRE),
    'Pset_WallCommon.IsExternal': bool, 'Other_Pset.FireRating': txt(['Other']),
  } },
  { entity: 'IfcWallStandardCase', n: 3, type: 'Basic Wall:Exterior 300mm', props: {
    'Qto_WallBaseQuantities.Length': len(10.5), 'Qto_WallBaseQuantities.Width': len(0.3),
    'Pset_WallCommon.IsExternal': () => ({ v: true }),
  } },
  { entity: 'IfcDoor', n: 9, type: 'Single-Flush:0915 x 2134mm', props: {
    'Pset_DoorCommon.FireRating': txt(FIRE), 'Qto_DoorBaseQuantities.Width': len(0.8),
    'Qto_DoorBaseQuantities.Height': len(2.1), 'Pset_DoorCommon.IsExternal': bool,
    'Identity Data.Cost': (i) => ({ v: 1250 + i * 333.33 }),
    'Pset_ManufacturerTypeInformation.Manufacturer': txt(['Acme', 'Bolt & Co', '']),
  } },
  { entity: 'IfcWindow', n: 5, type: 'Fixed:1200 x 1500mm', props: {
    'Qto_WindowBaseQuantities.Width': len(1.2), 'Qto_WindowBaseQuantities.Height': len(1.5),
    'Pset_WindowCommon.IsExternal': bool,
  } },
  { entity: 'IfcSlab', n: 4, type: 'Floor:Generic 150mm', props: {
    'Qto_SlabBaseQuantities.Width': len(0.15), 'Qto_SlabBaseQuantities.NetArea': area(40),
    'Qto_SlabBaseQuantities.NetVolume': vol(6), 'Qto_SlabBaseQuantities.Perimeter': len(26),
  } },
  { entity: 'IfcSpace', n: 5, type: '', props: {
    'Qto_SpaceBaseQuantities.NetFloorArea': area(12), 'Qto_SpaceBaseQuantities.Height': len(2.7),
    'Qto_SpaceBaseQuantities.NetVolume': vol(30),
  } },
  { entity: 'IfcColumn', n: 3, type: 'Concrete:450 x 450', props: {
    'Qto_ColumnBaseQuantities.Length': len(3.2), 'Qto_ColumnBaseQuantities.NetVolume': vol(0.6),
  } },
  { entity: 'IfcBeam', n: 3, type: 'UB:305x165x40', props: {
    'Qto_BeamBaseQuantities.Length': len(6), 'Qto_BeamBaseQuantities.NetVolume': vol(0.05),
  } },
  { entity: 'IfcCovering', n: 3, type: 'Ceiling:600x600', props: {
    'Qto_CoveringBaseQuantities.NetArea': area(20), 'Qto_CoveringBaseQuantities.Width': len(0.02),
  } },
  { entity: 'IfcRoof', n: 2, type: 'Roof:Flat', props: { 'Qto_RoofBaseQuantities.NetArea': area(120) } },
  { entity: 'IfcStair', n: 2, type: 'Stair:Monolithic', props: {} },
  { entity: 'IfcRailing', n: 2, type: 'Railing:900mm', props: { 'Qto_RailingBaseQuantities.Length': len(4) } },
  { entity: 'IfcFurniture', n: 3, type: 'Desk:1800', props: {} },
  { entity: 'IfcFurnishingElement', n: 1, type: 'Chair:Task', props: {} },
  { entity: 'IfcDuctSegment', n: 2, type: 'Rect Duct:400x200', props: { 'Qto_DuctSegmentBaseQuantities.Length': len(3) } },
  { entity: 'IfcPipeSegment', n: 2, type: 'Pipe:DN50', props: { 'Qto_PipeSegmentBaseQuantities.Length': len(5) } },
  { entity: 'IfcGeographicElement', n: 4, type: '', props: {
    'SGPset_GeographicElement.TreeNumber': (i) => ({ v: `T${i + 1}` }),
    'SGPset_GeographicElement.Species': txt(['Rain Tree', 'Tembusu']),
    'SGPset_GeographicElement.Girth': len(1.1), 'SGPset_GeographicElement.Height': len(8),
    'SGPset_GeographicElement.Status': txt(['Retain', 'Remove', '']),
  } },
];

export function buildStore(system: UnitSystem = 'metric'): ModelStore {
  const b = new StoreBuilder();
  const cores: ElemCore[] = [];
  const cells: Record<string, Cell>[] = [];
  let g = 0;
  CLASSES.forEach((c, ci) => {
    for (let i = 0; i < c.n; i++) {
      const [storey, elev] = STOREYS[(i * 3 + ci) % STOREYS.length];
      const [family, typeName] = c.type.includes(':') ? c.type.split(':') : ['', c.type];
      cores.push({
        entity: c.entity, name: `${c.entity.replace(/^Ifc/, '')} ${i + 1}`,
        description: i % 2 ? 'Described' : '', mark: String(1000 + g), typeName, family,
        objectType: c.entity === 'IfcGeographicElement' ? (i % 3 === 2 ? 'GREEN_VERGE' : 'LANDSCAPE_TREE') : c.type,
        predefinedType: c.entity === 'IfcCovering' ? (i % 2 ? 'FLOORING' : 'CEILING') : 'NOTDEFINED',
        guid: `GUID${String(g).padStart(4, '0')}`, storey, storeyElevation: elev,
        building: 'Block A', site: 'Site', space: i % 2 ? 'Room 101' : '',
        material: i % 3 ? 'Concrete' : '', discipline: 'ARC',
      });
      const row: Record<string, Cell> = {};
      for (const [key, make] of Object.entries(c.props)) {
        const v = make(i);
        if (v) row[key] = v;
      }
      cells.push(row);
      g++;
    }
  });
  b.add(cores, cells);
  const meta: ModelMeta = {
    fileName: 'synthetic.ifc', schema: 'IFC4', projectName: 'Golden', authoringTool: 'tests',
    lengthUnit: system === 'imperial' ? 'ft' : 'mm', unitSystem: system,
    elementCount: cores.length, parseMs: 0,
  };
  return b.finish(meta);
}

// ---------- hand-built definitions exercising every ScheduleDef feature ----------

const P = (pset: string, prop: string) => ({ kind: 'prop' as const, pset, prop });
const C = (key: CoreKey) => ({ kind: 'core' as const, key });

/** Doors: OR filters, 4 levels, collapsed rows, grand total, calculated values, rules, appearance. */
function kitchenSink(): ScheduleDef {
  return {
    version: 1,
    name: 'Kitchen Sink Doors',
    entity: ['IfcDoor'],
    columns: [
      { field: C('storey'), heading: 'Lvl', headingOrientation: 'vertical', width: 90 },
      { field: C('typeName'), align: 'left' },
      { field: P('*', 'FireRating'), conditional: [
        { op: 'contains', value: '90', bg: '#fff3cd', fg: '#664d03', bold: true },
        { op: 'noValue', bg: 'rgb(255, 0, 10)' },
      ] },
      { field: P('*', 'Width'), heading: 'W', align: 'right', total: 'sum',
        format: { display: 'mm', decimals: 0, thousands: true, showSymbol: true } },
      { field: P('*', 'Height'), total: 'max', hidden: true,
        format: { display: 'm', decimals: 3, prefix: 'h=', suffix: '!' } },
      { field: P('Identity Data', 'Cost'), total: 'avg', align: 'center',
        format: { decimals: 2, thousands: true, prefix: '$', suppressZero: true } },
      { field: P('*', 'IsExternal'), format: { boolStyle: '✓/✗' }, total: 'count',
        conditional: [{ op: '=', value: 'true', bg: '#abc', fg: '#123456' }] },
      { field: { kind: 'formula', id: 'c1' }, total: 'sum', format: { display: 'm²', decimals: 2 } },
      { field: { kind: 'formula', id: 'c2' }, align: 'center' },
      { field: { kind: 'formula', id: 'c3' }, align: 'left', total: 'countDistinct' },
      { field: { kind: 'formula', id: 'p1' }, format: { decimals: 1, suffix: '%' } },
    ],
    calculated: [
      { id: 'c1', name: 'Leaf Area', kind: 'formula', unitKind: 'area', formula: 'W * Height', result: 'number' },
      { id: 'c2', name: 'Wide', kind: 'formula', formula: 'W > 1', result: 'yesNo' },
      { id: 'c3', name: 'Band', kind: 'formula', formula: 'if(W > 1.2, "Large", "Small")', result: 'text' },
      { id: 'p1', name: 'Share', kind: 'percentage', ofField: P('*', 'Width') },
    ],
    filters: [
      { field: P('*', 'FireRating'), op: 'hasValue' },
      { field: P('*', 'Width'), op: '>=', value: 1.3 },
      { field: C('name'), op: 'startsWith', value: 'Door 1' },
    ],
    filterLogic: 'or',
    sort: [
      { field: C('storey'), dir: 'asc', header: true, footer: 'titleCountTotals', blankLine: true },
      { field: C('typeName'), dir: 'desc', header: true, footer: 'count' },
      { field: P('*', 'FireRating'), dir: 'asc', header: false, footer: 'totals', blankLine: true },
      { field: P('*', 'IsExternal'), dir: 'desc', footer: 'title' },
    ],
    itemize: false,
    grandTotal: true,
    grandTotalTitle: 'All doors',
    appearance: {
      title: 'Doors — golden', showTitle: false, gridLines: false, outline: false,
      blankRowBeforeData: true, zebra: false, fontSize: 11, headerBold: false, bodyFont: 'serif',
    },
    meta: { corpusVersion: 'x1', notes: 'hand-built' },
  };
}

/** Walls (two classes): AND filters with in/between, itemized, grand total without title. */
function wallsAnd(): ScheduleDef {
  return {
    ...emptySchedule('Walls AND', ['IfcWall', 'IfcWallStandardCase']),
    columns: [
      { field: C('entity') }, { field: C('mark') }, { field: C('storeyElevation') },
      { field: P('Qto_WallBaseQuantities', 'Length'), total: 'sum', format: { display: 'm', decimals: 2 } },
      { field: P('*', 'FireRating') }, { field: P('Other_Pset', 'FireRating') },
      { field: P('*', 'NetVolume'), total: 'min', format: { display: 'm³', decimals: 3, thousands: false } },
    ],
    filters: [
      { field: C('storey'), op: 'in', values: ['Level 1', 'Level 10', 'Roof'] },
      { field: P('*', 'Length'), op: 'between', values: [2, 12] },
      { field: C('name'), op: '!=', value: 'Wall 3' },
      { field: C('description'), op: 'noValue' },
    ],
    filterLogic: 'and',
    sort: [{ field: C('storey'), dir: 'asc', header: true, footer: 'totals' },
      { field: P('*', 'Length'), dir: 'desc' }],
    grandTotal: true,
  };
}

/** Everything in the model by GUID: no filters, no sort, empty-ish columns. */
function bareGuids(): ScheduleDef {
  return {
    ...emptySchedule('Bare', ['IfcSpace', 'IfcGeographicElement', 'IfcRoof']),
    columns: [{ field: C('guid') }, { field: C('objectType') }, { field: C('space'), hidden: true },
      { field: P('*', 'NetFloorArea'), format: { display: 'ft²', decimals: 1 } },
      { field: P('*', 'Height'), format: { display: 'in', decimals: 0, thousands: true } }],
  };
}

/** Collapsed rows that really merge: few visible columns, a hidden one, a Count. */
function collapsed(): ScheduleDef {
  return {
    ...emptySchedule('Collapsed walls', ['IfcWall', 'IfcWallStandardCase']),
    columns: [{ field: C('typeName') }, { field: C('storey') },
      { field: P('*', 'FireRating'), hidden: true },
      { field: P('*', 'IsExternal'), format: { boolStyle: 'Y/N' }, total: 'count' }],
    sort: [{ field: C('typeName'), dir: 'asc', header: true, footer: 'titleCountTotals' }],
    itemize: false,
    grandTotal: true,
  };
}

/**
 * SGVue: the design's mock federation (ARC, STR, SIT, MEP) through the adapter the Schedules
 * window is fed by — the real path from a `Federation` to a `ModelStore`, four models, so a
 * schedule the app builds starts with a `Model` column.
 */
export function buildFederationStore(): ModelStore {
  const snap = snapshotOf(federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k))));
  const b = new StoreBuilder();
  b.add(snap.cores, snap.cells);
  return b.finish(snap.meta);
}

/** Which store a case runs against. */
export type StoreName = 'metric' | 'imperial' | 'federation';

/** Each store once per test file — the federation is built through the real adapter. */
export function buildStores(): Record<StoreName, ModelStore> {
  return { metric: buildStore('metric'), imperial: buildStore('imperial'), federation: buildFederationStore() };
}

export function legacyFixture(): unknown {
  return JSON.parse(readFileSync(new URL('../fixtures/legacy-v1.schedule.json', import.meta.url), 'utf8'));
}

export interface Case { id: string; def: ScheduleDef; store: StoreName; system: UnitSystem }

/**
 * Every preset in both unit systems, the hand-built defs, and the legacy fixture — ifcTable's
 * cases — and, SGVue's own, the schedules the window builds for a federation: the one it opens
 * on by itself (`openingSchedule`) and two templates with their `Model` column.
 */
export function allCases(): Case[] {
  const out: Case[] = [];
  for (const p of PRESETS) {
    out.push({ id: `preset-${p.id}`, def: scheduleFromPreset(p, 'metric'), store: 'metric', system: 'metric' });
    out.push({ id: `preset-${p.id}-imperial`, def: scheduleFromPreset(p, 'imperial'), store: 'imperial', system: 'imperial' });
  }
  out.push({ id: 'hand-kitchen-sink', def: kitchenSink(), store: 'metric', system: 'metric' });
  out.push({ id: 'hand-walls-and', def: wallsAnd(), store: 'metric', system: 'metric' });
  out.push({ id: 'hand-collapsed', def: collapsed(), store: 'metric', system: 'metric' });
  out.push({ id: 'hand-bare-guids', def: bareGuids(), store: 'imperial', system: 'imperial' });
  out.push({ id: 'legacy-v1', def: parseScheduleDef(legacyFixture()), store: 'metric', system: 'metric' });

  const fed = buildFederationStore();
  out.push({ id: 'federation-opening', def: openingSchedule(fed, null).def, store: 'federation', system: 'metric' });
  for (const id of ['wall-schedule', 'door-schedule']) {
    const def = scheduleFromPreset(presetById(id)!, 'metric');
    def.columns = withModelColumn(def.columns, fed);
    out.push({ id: `federation-${id}`, def, store: 'federation', system: 'metric' });
  }
  return out;
}
