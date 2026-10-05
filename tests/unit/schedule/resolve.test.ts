import { describe, expect, it } from 'vitest';
import { StoreBuilder } from '../../../src/schedule/ifc/store';
import { ANY_PSET, resolveField } from '../../../src/schedule/schedule/resolve';
import type { Cell, ElemCore, ModelMeta } from '../../../src/schedule/ifc/types';
// Phase 2 (2026-09-25): the coverage sweep is ported now.
import { buildCoverage, populated } from '../../../src/renderer/schedule-ui/coverage';

function core(over: Partial<ElemCore> = {}): ElemCore {
  return { entity: 'IfcDoor', name: 'D1', description: '', mark: '2864709',
    typeName: '1100x2400', family: 'Single Leaf', objectType: 'Single Leaf:1100x2400',
    predefinedType: 'DOOR', guid: 'g1', storey: 'Level 2', storeyElevation: 11.975,
    building: '', site: 'Default', space: 'Lobby', material: 'Metal', discipline: 'ARC',
    ...over,
  };
}
const meta: ModelMeta = {
  fileName: 'f.ifc', schema: 'IFC4', projectName: '', authoringTool: '',
  lengthUnit: 'mm', unitSystem: 'metric', elementCount: 0, parseMs: 0,
};

function storeOf(cells: Record<string, Cell>[], cores?: ElemCore[]) {
  const b = new StoreBuilder();
  b.add(cores ?? cells.map(() => core()), cells);
  return b.finish(meta);
}

describe('core fields', () => {
  const s = storeOf([{}]);

  it('resolves text core fields', () => {
    expect(resolveField(s, 0, { kind: 'core', key: 'typeName' })).toEqual({ v: '1100x2400' });
    expect(resolveField(s, 0, { kind: 'core', key: 'guid' })).toEqual({ v: 'g1' });
    expect(resolveField(s, 0, { kind: 'core', key: 'space' })).toEqual({ v: 'Lobby' });
  });

  it('keeps storeyElevation numeric so levels sort by height, not name', () => {
    const cell = resolveField(s, 0, { kind: 'core', key: 'storeyElevation' });
    expect(cell).toEqual({ v: 11.975, k: 'length' });
    expect(typeof cell!.v).toBe('number');
  });

  it('resolves objectType as the raw attribute family and typeName were split from', () => {
    expect(resolveField(s, 0, { kind: 'core', key: 'objectType' }))
      .toEqual({ v: 'Single Leaf:1100x2400' });
  });

  it('treats a blank ObjectType like every other empty text core field', () => {
    const blank = storeOf([{}], [core({ objectType: '' })]);
    expect(resolveField(blank, 0, { kind: 'core', key: 'objectType' })).toBeUndefined();
  });

  it('returns undefined for empty fields rather than an empty string', () => {
    expect(resolveField(s, 0, { kind: 'core', key: 'description' })).toBeUndefined();
    expect(resolveField(s, 0, { kind: 'core', key: 'building' })).toBeUndefined();
  });
});

describe('property fields', () => {
  it('resolves an exact pset.prop', () => {
    const s = storeOf([{ 'Pset_DoorCommon.FireRating': { v: '2' } }]);
    expect(resolveField(s, 0, { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' })).toEqual({ v: '2' });
  });

  it('matches pset names case-insensitively', () => {
    // real files contain both SGPset_CivilElement and SGPSet_CivilElement
    const s = storeOf([{ 'SGPSet_CivilElement.Width': { v: 3, k: 'length' } }]);
    expect(resolveField(s, 0, { kind: 'prop', pset: 'SGPset_CivilElement', prop: 'width' }))
      .toEqual({ v: 3, k: 'length' });
  });

  it('wildcard prefers SGPset, then Pset_, then others, then Qto_', () => {
    const s = storeOf([{
      'Qto_DoorBaseQuantities.Width': { v: 9 },
      'Other_Set.Width': { v: 3 },
      'Pset_DoorCommon.Width': { v: 2 },
      'SGPset_DoorDimension.Width': { v: 1 },
    }]);
    expect(resolveField(s, 0, { kind: 'prop', pset: ANY_PSET, prop: 'Width' })).toEqual({ v: 1 });

    const noSg = storeOf([{ 'Qto_X.Width': { v: 9 }, 'Other_Set.Width': { v: 3 }, 'Pset_A.Width': { v: 2 } }]);
    expect(resolveField(noSg, 0, { kind: 'prop', pset: ANY_PSET, prop: 'Width' })).toEqual({ v: 2 });

    const onlyQto = storeOf([{ 'Qto_X.Width': { v: 9 }, 'Other_Set.Width': { v: 3 } }]);
    expect(resolveField(onlyQto, 0, { kind: 'prop', pset: ANY_PSET, prop: 'Width' })).toEqual({ v: 3 });
  });

  it('wildcard is deterministic when two psets rank equally', () => {
    const s = storeOf([{ 'Pset_B.W': { v: 2 }, 'Pset_A.W': { v: 1 } }]);
    expect(resolveField(s, 0, { kind: 'prop', pset: ANY_PSET, prop: 'W' })).toEqual({ v: 1 });
  });

  it('returns undefined when nothing matches', () => {
    const s = storeOf([{ 'Pset_DoorCommon.FireRating': { v: '2' } }]);
    expect(resolveField(s, 0, { kind: 'prop', pset: ANY_PSET, prop: 'Nope' })).toBeUndefined();
  });
});

describe('coverage', () => {
  it('counts rows carrying the field — this drives the \"0 values\" badge and every bar', () => {
    const s = storeOf([
      { 'Pset_DoorCommon.FireRating': { v: '2' } },
      {},
      { 'Pset_DoorCommon.FireRating': { v: '1' } },
    ]);
    const cov = buildCoverage(s, ['IfcDoor']);
    expect(cov.total).toBe(3);
    expect(populated(cov, { kind: 'prop', pset: ANY_PSET, prop: 'FireRating' })).toBe(2);
    expect(populated(cov, { kind: 'prop', pset: ANY_PSET, prop: 'Missing' })).toBe(0);
    // Exact pset and wildcard agree, and matching is case-insensitive as elsewhere.
    expect(populated(cov, { kind: 'prop', pset: 'Pset_DoorCommon', prop: 'FireRating' })).toBe(2);
    expect(populated(cov, { kind: 'prop', pset: 'PSET_DOORCOMMON', prop: 'firerating' })).toBe(2);
    // Core fields come from the same single pass.
    expect(populated(cov, { kind: 'core', key: 'guid' })).toBe(3);
  });

  it('counts a property once per element even when two psets carry the name', () => {
    const s = storeOf([{ 'Pset_A.Ref': { v: 'x' }, 'Pset_B.Ref': { v: 'y' } }]);
    const cov = buildCoverage(s, ['IfcDoor']);
    expect(populated(cov, { kind: 'prop', pset: ANY_PSET, prop: 'Ref' })).toBe(1);
  });
});
