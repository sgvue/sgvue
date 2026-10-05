// The hand-authored templates: the general list, and the IFC-SG section beside it. No DOM.
//
// What is worth pinning is the boring stuff a template gets wrong silently: an IFC class
// misspelt (the gallery would just never offer it), a template applied and then edited
// writing back into the module constant, and a schedule that cannot survive being saved and
// reopened — which is what applying a template and hitting Save actually does.

import { describe, expect, it } from 'vitest';
import { CANONICAL_ENTITIES } from '../../../src/schedule/ifc/entities';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { headingOf, parseScheduleDef } from '../../../src/schedule/schedule/def';
import { runSchedule, type DataRow } from '../../../src/schedule/schedule/engine';
import { PRESETS, presetById, presetCount, presetsFor, scheduleFromPreset } from '../../../src/schedule/schedule/presets';

const general = PRESETS.filter((p) => !p.section);
const ifcsg = PRESETS.filter((p) => p.section === 'ifcsg');

describe('the template list', () => {
  it('holds 14 general templates and the IFC-SG section, with unique ids', () => {
    expect(general).toHaveLength(14);
    expect(ifcsg).toHaveLength(1);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it('lets only the IFC-SG templates carry a filter', () => {
    // The general list is generic and judges nothing — a rule baked into one of those
    // would silently hide rows from a user who never wrote it.
    for (const p of general) expect(p.filters, `${p.id} filters`).toBeUndefined();
    expect(presetById('sg-planting')?.filters).toEqual([
      { field: { kind: 'core', key: 'objectType' }, op: '=', value: 'LANDSCAPE_TREE' },
    ]);
  });

  it('names only IFC classes the app can recognise', () => {
    // A class the extractor never produces under this exact spelling is a template that can
    // never appear, and nothing else in the app would say so.
    const known = new Set(CANONICAL_ENTITIES);
    for (const p of PRESETS) {
      expect(p.entities.length, `${p.id} names at least one class`).toBeGreaterThan(0);
      for (const e of p.entities) expect(known, `${p.id} → ${e}`).toContain(e);
    }
  });

  it('unions the classes a schema difference split in two', () => {
    // Revit's IFC2X3 export writes IfcWallStandardCase; IFC4 writes IfcWall. One template.
    expect(presetById('wall-schedule')?.entities).toEqual(['IfcWall', 'IfcWallStandardCase']);
    expect(presetById('furniture-schedule')?.entities).toEqual(['IfcFurnishingElement', 'IfcFurniture']);
  });

  it('leaves ducts and pipes on their IFC4 names alone', () => {
    // The IFC2X3 fallback is the generic IfcFlowSegment, which would put every flow segment
    // under BOTH templates. Not offering them is the honest answer.
    expect(presetById('duct-schedule')?.entities).toEqual(['IfcDuctSegment']);
    expect(presetById('pipe-schedule')?.entities).toEqual(['IfcPipeSegment']);
  });

  it('shows what shares IfcCovering rather than filtering it away', () => {
    const cols = presetById('ceiling-schedule')!.columns;
    const kind = cols.find((c) => c.field.kind === 'core' && c.field.key === 'predefinedType');
    expect(kind?.heading).toBe('Type of covering');
  });
});

describe('offering templates for a model', () => {
  const byEntity = new Map<string, number[]>([
    ['IfcWall', [1, 2]],
    ['IfcWallStandardCase', [3, 4, 5]],
    ['IfcDoor', [6]],
  ]);

  it('counts every class a template names', () => {
    expect(presetCount(byEntity, presetById('wall-schedule')!)).toBe(5);
    expect(presetCount(byEntity, presetById('door-schedule')!)).toBe(1);
  });

  it('offers a template whose only elements are under the second class', () => {
    const only = new Map<string, number[]>([['IfcWallStandardCase', [1]]]);
    expect(presetsFor(only).map((p) => p.id)).toEqual(['wall-schedule']);
  });

  it('ranks by the union, most-populous first', () => {
    expect(presetsFor(byEntity).map((p) => p.id)).toEqual(['wall-schedule', 'door-schedule']);
  });
});

describe('a schedule made from a template', () => {
  it('survives a save and reopen with every column, heading and format intact', () => {
    for (const p of PRESETS) for (const system of ['metric', 'imperial'] as const) {
      const def = scheduleFromPreset(p, system);
      const back = parseScheduleDef(JSON.parse(JSON.stringify(def)));
      expect(back.name, p.id).toBe(def.name);
      expect(back.entity, p.id).toEqual(p.entities);
      expect(back.columns, `${p.id} columns`).toEqual(def.columns);
      // A template's rule is part of what was saved — an IFC-SG schedule that reopens
      // unfiltered shows the whole class under a name that promises one kind of thing.
      expect(back.filters, `${p.id} filters`).toEqual(def.filters);
      expect(back.columns.map((c) => headingOf(c, back)), `${p.id} headings`)
        .toEqual(def.columns.map((c) => headingOf(c, def)));
    }
  });

  it('is a copy, so editing the schedule cannot rewrite the template', () => {
    // The formatting controls edit a column's format IN PLACE. Without the clone that edit
    // would land on the module constant and every later use of the template would carry it.
    const p = presetById('wall-schedule')!;
    const before = JSON.stringify(p);
    const def = scheduleFromPreset(p);
    def.columns.find((c) => c.format)!.format!.decimals = 5;
    def.columns[0].heading = 'Edited';
    def.entity.push('IfcNonsense');
    expect(JSON.stringify(p)).toBe(before);
    // The imperial mapping edits a format IN PLACE too, so it must land on the clone as well.
    scheduleFromPreset(p, 'imperial');
    expect(JSON.stringify(p)).toBe(before);
  });

  it('reads in feet and inches on a model drawn in feet', () => {
    // mm-scale dimensions — opening sizes, thicknesses — are what an imperial drawing calls
    // out in inches; the metre-scale runs are what it calls out in feet.
    const fmt = (id: string, prop: string) => {
      const def = scheduleFromPreset(presetById(id)!, 'imperial');
      return def.columns.find((c) => (c.field as { prop?: string }).prop === prop)!.format;
    };
    expect(fmt('door-schedule', 'Width')).toEqual({ display: 'in', decimals: 1, thousands: true });
    expect(fmt('door-schedule', 'Height')).toEqual({ display: 'in', decimals: 1, thousands: true });
    expect(fmt('wall-schedule', 'Length')).toEqual({ display: 'ft', decimals: 2, thousands: true });
    expect(fmt('wall-schedule', 'Width')).toEqual({ display: 'in', decimals: 1, thousands: true });
    expect(fmt('wall-schedule', 'NetSideArea')).toEqual({ display: 'ft²', decimals: 2, thousands: true });
    expect(fmt('wall-schedule', 'NetVolume')).toEqual({ display: 'ft³', decimals: 2, thousands: true });
    // A format the table does not name is left exactly as authored.
    expect(fmt('wall-schedule', 'IsExternal')).toEqual({ boolStyle: 'Yes/No' });
  });

  it('is unchanged on a metric model, and metric is the default', () => {
    const metric = scheduleFromPreset(presetById('door-schedule')!, 'metric');
    expect(JSON.stringify(scheduleFromPreset(presetById('door-schedule')!)))
      .toBe(JSON.stringify(metric));
    expect(metric.columns.find((c) => (c.field as { prop?: string }).prop === 'Width')!.format)
      .toEqual({ display: 'mm', decimals: 0, thousands: true });
  });

  it('copies the filter too, so retyping a rule cannot rewrite the template', () => {
    // The Filter tab edits def.filters[i] IN PLACE, exactly as the format controls do.
    const p = presetById('sg-planting')!;
    const before = JSON.stringify(p);
    const def = scheduleFromPreset(p);
    def.filters[0].value = 'GREENVERGES';
    expect(JSON.stringify(p)).toBe(before);
    expect(p.filters![0].value).toBe('LANDSCAPE_TREE');
  });
});

describe('the Planting template against a model', () => {
  // The fake-store pattern from engine.test.ts: three IfcGeographicElement, of which two
  // are trees. IFC-SG classifies by ObjectType on a generic class, so the class count and
  // the schedule's row count are two different numbers — which is the whole reason the
  // gallery runs a filtered template through the engine for its "N in model".
  const meta: ModelMeta = {
    fileName: 'sg.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
    lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
  };

  function build(objectTypes: string[]): ModelStore {
    const b = new StoreBuilder();
    const cores: ElemCore[] = [];
    const cells: Record<string, Cell>[] = [];
    objectTypes.forEach((objectType, i) => {
      cores.push({
        entity: 'IfcGeographicElement', name: `E${i}`, description: '', mark: String(i),
        typeName: 'T1', family: 'F', objectType, predefinedType: 'USERDEFINED',
        guid: `g${i}`, storey: 'Level 1', storeyElevation: 0,
        building: '', site: '', space: '', material: '', discipline: 'ARC',
      });
      cells.push({
        'SGPset_Planting.TreeNumber': { v: `T-${i}` },
        'SGPset_Planting.Girth': { v: 0.3, k: 'length' },
      });
    });
    b.add(cores, cells);
    return b.finish(meta);
  }

  const store = build(['LANDSCAPE_TREE', 'LANDSCAPE_TREE', 'GREENVERGES']);

  it('schedules the trees and leaves the rest of the class alone', () => {
    const res = runSchedule(store, scheduleFromPreset(presetById('sg-planting')!));
    const rows = res.rows.filter((r) => r.kind === 'data') as DataRow[];
    expect(store.byEntity.get('IfcGeographicElement')).toHaveLength(3);
    expect(res.matchedElements).toBe(2);
    expect(rows).toHaveLength(2);
    // Girth is the third column, an IfcLengthMeasure held in SI and read in metres.
    expect(rows[0].cells[2]).toBe('0.30');
  });

  it('counts what the gallery card claims', () => {
    // The gallery's own inModel() is not exported and lives in a DOM module, so the count
    // is pinned here at its source: matchedElements under the template's own filters.
    const res = runSchedule(store, scheduleFromPreset(presetById('sg-planting')!), { cap: 0 });
    expect(res.matchedElements).toBe(2);
  });
});
