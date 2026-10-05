// Finding a field by what it contains. The point is the case where you do NOT know the
// property name — the author of someone else's model chose it.

import { describe, expect, it } from 'vitest';
import { StoreBuilder, type ModelStore } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
import { searchByValue } from '../../../src/schedule/schedule/valueSearch';

const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function core(over: Partial<ElemCore> = {}): ElemCore {
  return {
    entity: 'IfcDoor', name: 'D', description: '', mark: '', typeName: 'T', family: 'F',
    objectType: '', predefinedType: 'DOOR', guid: 'g', storey: 'Level 1', storeyElevation: 0,
    building: '', site: '', space: '', material: 'Timber', discipline: 'ARC', ...over,
  };
}

function store(
  cells: Record<string, Cell>[], cores?: Partial<ElemCore>[], metaOver?: Partial<ModelMeta>,
): ModelStore {
  const b = new StoreBuilder();
  b.add(cells.map((_, i) => core(cores?.[i])), cells);
  return b.finish({ ...meta, ...metaOver });
}

describe('searching fields by value', () => {
  it('finds the property carrying a value whose NAME you do not know', () => {
    const s = store([
      { 'SGPset_Whatever.FR_Code': { v: 'FD30' } },
      { 'SGPset_Whatever.FR_Code': { v: 'FD30' } },
      { 'SGPset_Whatever.FR_Code': { v: 'FD60' } },
    ]);
    const hits = searchByValue(s, ['IfcDoor'], 'fd30');
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe('FR_Code');
    expect(hits[0].group).toBe('SGPset_Whatever');
    expect(hits[0].hits).toBe(2);
    expect(hits[0].example).toBe('FD30');
    expect(hits[0].field).toEqual({ kind: 'prop', pset: 'SGPset_Whatever', prop: 'FR_Code' });
  });

  it('is case-insensitive and matches on a substring', () => {
    const s = store([{ 'P.SpaceType': { v: 'Household Shelter' } }]);
    expect(searchByValue(s, ['IfcDoor'], 'SHELTER')[0].label).toBe('SpaceType');
    expect(searchByValue(s, ['IfcDoor'], 'household sh')[0].label).toBe('SpaceType');
  });

  it('finds a number by what the table SHOWS, not by how it is stored', () => {
    // 0.9 m is stored in SI; a length column displays it as 900 mm, which is what a person
    // would type. Both must find it.
    const s = store([{ 'P.Width': { v: 0.9, k: 'length' } }]);
    expect(searchByValue(s, ['IfcDoor'], '900')).toHaveLength(1);
    expect(searchByValue(s, ['IfcDoor'], '0.9')).toHaveLength(1);
    expect(searchByValue(s, ['IfcDoor'], '901')).toHaveLength(0);
  });

  it('ignores a unit typed after the number', () => {
    const s = store([{ 'P.Width': { v: 0.9, k: 'length' } }]);
    for (const q of ['900mm', '900 mm', '900MM']) {
      expect(searchByValue(s, ['IfcDoor'], q), q).toHaveLength(1);
    }
  });

  it('reads a number in the unit the MODEL is authored in', () => {
    // The same 0.9144 m door is 3 ft to an imperial file and 914 mm to a metric one, and a
    // person types what their own model shows them — so the same model answers differently.
    const cells: Record<string, Cell>[] = [{ 'P.Width': { v: 0.9144, k: 'length' } }];
    const imperial = store(cells, undefined, { unitSystem: 'imperial', lengthUnit: 'ft' });
    const metric = store(cells);
    expect(searchByValue(imperial, ['IfcDoor'], '3.0')).toHaveLength(1);
    expect(searchByValue(metric, ['IfcDoor'], '3.0')).toHaveLength(0);
    expect(searchByValue(metric, ['IfcDoor'], '914')).toHaveLength(1);
  });

  it('searches core fields too — level and material are what people look for', () => {
    const s = store([{}, {}], [{ storey: '1st Storey' }, { storey: '2nd Storey' }]);
    const hits = searchByValue(s, ['IfcDoor'], '1st');
    expect(hits.map((h) => h.label)).toContain('Level');
    expect(hits.find((h) => h.label === 'Level')?.hits).toBe(1);
  });

  it('matches booleans on the words a schedule shows', () => {
    const s = store([{ 'P.IsExternal': { v: true } }, { 'P.IsExternal': { v: false } }]);
    expect(searchByValue(s, ['IfcDoor'], 'yes')[0].hits).toBe(1);
  });

  it('ranks the field that carries the value on the most elements first', () => {
    const s = store([
      { 'P.Rare': { v: 'XX' }, 'P.Common': { v: 'XX' } },
      { 'P.Common': { v: 'XX' } },
      { 'P.Common': { v: 'XX' } },
    ]);
    expect(searchByValue(s, ['IfcDoor'], 'xx').map((h) => h.label)).toEqual(['Common', 'Rare']);
  });

  it('stays quiet for a query too short to mean anything', () => {
    const s = store([{ 'P.A': { v: 'aaaa' } }]);
    expect(searchByValue(s, ['IfcDoor'], 'a')).toEqual([]);
    expect(searchByValue(s, ['IfcDoor'], ' ')).toEqual([]);
  });

  it('returns nothing rather than throwing when the class is absent', () => {
    const s = store([{ 'P.A': { v: 'x' } }]);
    expect(searchByValue(s, ['IfcWall'], 'x')).toEqual([]);
  });
});
