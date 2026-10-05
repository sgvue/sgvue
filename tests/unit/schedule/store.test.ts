import { describe, expect, it } from 'vitest';
import { buildCatalog, keysForEntity, StoreBuilder } from '../../../src/schedule/ifc/store';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';

function core(over: Partial<ElemCore> = {}): ElemCore {
  return { entity: 'IfcDoor', name: '', description: '', mark: '', typeName: '', family: '', objectType: '', predefinedType: '', guid: 'g', storey: '',
    storeyElevation: null, building: '', site: '', space: '', material: '', discipline: 'ARC',
    ...over,
  };
}
const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

describe('buildCatalog', () => {
  it('infers bool, number, enum and text', () => {
    const cells: Record<string, Cell>[] = [
      { 'P.Flag': { v: true }, 'P.Width': { v: 0.9, k: 'length' }, 'P.Grade': { v: 'A' }, 'P.Note': { v: 'x1' } },
      { 'P.Flag': { v: false }, 'P.Width': { v: 1.2, k: 'length' }, 'P.Grade': { v: 'B' }, 'P.Note': { v: 'x2' } },
      { 'P.Flag': { v: true }, 'P.Width': { v: 2.4, k: 'length' }, 'P.Grade': { v: 'A' }, 'P.Note': { v: 'x3' } },
    ];
    const cat = buildCatalog(cells);

    expect(cat.get('P.Flag')!.type).toBe('bool');
    expect(cat.get('P.Width')!.type).toBe('number');
    expect(cat.get('P.Width')!.kind).toBe('length');
    // few distinct values -> offered as an enum in filters
    expect(cat.get('P.Grade')!.type).toBe('enum');
    expect(cat.get('P.Grade')!.distinct).toEqual(['A', 'B']);
    // splits the interned key back into pset + property
    expect(cat.get('P.Width')!.pset).toBe('P');
    expect(cat.get('P.Width')!.prop).toBe('Width');
  });

  it('counts only rows where the property is present', () => {
    const cat = buildCatalog([{ 'A.X': { v: 1 } }, {}, { 'A.X': { v: 2 } }]);
    expect(cat.get('A.X')!.count).toBe(2);
  });

  it('stops collecting distinct values past the cap', () => {
    const cells = Array.from({ length: 300 }, (_, i) => ({ 'A.X': { v: `v${i}` } as Cell }));
    const stat = buildCatalog(cells).get('A.X')!;
    expect(stat.type).toBe('text');
    expect(stat.distinct).toEqual([]);
  });

  it('never calls a mixed number/text column numeric', () => {
    // 'n/a' among numbers must not unlock > and < operators.
    const few = buildCatalog([{ 'A.X': { v: 1 } }, { 'A.X': { v: 'n/a' } }]).get('A.X')!;
    expect(few.type).toBe('enum');

    const many = buildCatalog([
      ...Array.from({ length: 40 }, (_, i) => ({ 'A.X': { v: i } as Cell })),
      { 'A.X': { v: 'n/a' } },
    ]).get('A.X')!;
    expect(many.type).toBe('text');
  });
});

describe('StoreBuilder', () => {
  it('indexes rows by entity, most populous first', () => {
    const b = new StoreBuilder();
    b.add([core({ entity: 'IfcWall' }), core({ entity: 'IfcDoor' })], [{}, {}]);
    b.add([core({ entity: 'IfcWall' })], [{}]);
    const s = b.finish(meta);

    expect(s.byEntity.get('IfcWall')).toEqual([0, 2]);
    expect(s.byEntity.get('IfcDoor')).toEqual([1]);
    expect(s.entities).toEqual([
      { entity: 'IfcWall', count: 2 },
      { entity: 'IfcDoor', count: 1 },
    ]);
    expect(s.cores.length).toBe(s.cells.length);
  });
});

describe('keysForEntity', () => {
  it('offers only keys present on that category, SG psets first', () => {
    const b = new StoreBuilder();
    b.add(
      [core({ entity: 'IfcDoor' }), core({ entity: 'IfcDoor' }), core({ entity: 'IfcWall' })],
      [
        { 'Pset_DoorCommon.FireRating': { v: '2' }, 'SGPset_Door.AirTight': { v: true } },
        { 'Pset_DoorCommon.FireRating': { v: '1' } },
        { 'Pset_WallCommon.IsExternal': { v: true } },
      ],
    );
    const s = b.finish(meta);
    const keys = keysForEntity(s, ['IfcDoor']).map((k) => k.key);

    expect(keys).toEqual(['SGPset_Door.AirTight', 'Pset_DoorCommon.FireRating']);
    expect(keys).not.toContain('Pset_WallCommon.IsExternal');
    // count is per-category, not model-wide
    expect(keysForEntity(s, ['IfcDoor']).find((k) => k.prop === 'FireRating')!.count).toBe(2);
  });
});
