/**
 * The clash sweep's spatial hash must give the **same answer** as the prototype's nested
 * loop — plan §3.5 defect 6 replaces the algorithm, not the result.
 *
 * The prototype gave up at 400 000 tested pairs, which two real discipline models reach long
 * before the answer is; the grid reaches the same answer without reaching that cap. So the
 * test is equivalence, on random boxes, with the tolerance the tool exposes.
 */
import { describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { visFn } from '../../src/shared/rules'
import {
  clashPairs,
  clashPairsBrute,
  nearbyElements,
  nearbyElementsBrute
} from '../../src/renderer/ai/analysis'
import type { FederatedElement } from '../../src/shared/federate'

const ALWAYS = visFn({ hidden: {}, modelVis: {}, storeyVis: {}, stack: [] })

/** Mulberry32: the same boxes every run, so a failure is reproducible. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function boxes(n: number, model: string, seed: number, spread: number): FederatedElement[] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => {
    const cx = (r() - 0.5) * spread
    const cy = (r() - 0.5) * spread
    const cz = (r() - 0.5) * spread * 0.25
    // Sizes vary by two orders of magnitude, which is what breaks a naive uniform grid.
    const sx = 0.05 + r() * (r() < 0.1 ? 12 : 1.5)
    const sy = 0.05 + r() * (r() < 0.1 ? 12 : 1.5)
    const sz = 0.05 + r() * 2
    return {
      id: i + 1,
      model,
      name: `${model}-${i}`,
      type: 'IfcWall',
      bbox: [cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2]
    } as unknown as FederatedElement
  })
}

const key = (pairs: { a: FederatedElement; b: FederatedElement; vol: number }[]): string =>
  pairs
    .map((p) => `${p.a.id}:${p.b.id}:${p.vol.toFixed(9)}`)
    .sort()
    .join('|')

describe('the spatial hash', () => {
  it('equals brute force on random boxes, at several tolerances', () => {
    const A = boxes(220, 'ARC', 12345, 40)
    const B = boxes(240, 'STR', 98765, 40)
    const elements = [...A, ...B]
    for (const tol of [0, 0.05, 0.5, -0.25]) {
      const fast = clashPairs(elements, ALWAYS, 'ARC', 'STR', tol)
      const slow = clashPairsBrute(elements, ALWAYS, 'ARC', 'STR', tol)
      expect([tol, fast.capped]).toEqual([tol, false])
      expect([tol, fast.pairs.length]).toEqual([tol, slow.length])
      expect([tol, key(fast.pairs)]).toEqual([tol, key(slow)])
    }
  })

  it('equals brute force on the design’s own federation', () => {
    const f = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
    const fast = clashPairs(f.elements, ALWAYS, 'ARC', 'STR')
    const slow = clashPairsBrute(f.elements, ALWAYS, 'ARC', 'STR')
    expect(fast.pairs.length).toBe(442)
    expect(key(fast.pairs)).toBe(key(slow))
  })

  it('sorts by overlap volume, largest first', () => {
    const f = federate(['ARC', 'STR'].map((k) => mockModelIndex(k)))
    const { pairs } = clashPairs(f.elements, ALWAYS, 'ARC', 'STR')
    for (let i = 1; i < pairs.length; i++) expect(pairs[i - 1].vol).toBeGreaterThanOrEqual(pairs[i].vol)
  })

  it('tests only what is visible, so a hidden storey is not reported as a clash', () => {
    const f = federate(['ARC', 'STR'].map((k) => mockModelIndex(k)))
    const all = clashPairs(f.elements, ALWAYS, 'ARC', 'STR').pairs.length
    const hideL2 = visFn({ hidden: {}, modelVis: {}, storeyVis: { L2: false }, stack: [] })
    const fewer = clashPairs(f.elements, hideL2, 'ARC', 'STR').pairs.length
    expect(fewer).toBeLessThan(all)
    expect(fewer).toBe(clashPairsBrute(f.elements, hideL2, 'ARC', 'STR').length)
  })

  it('ignores elements with no geometry rather than treating them as a point at the origin', () => {
    const A = boxes(4, 'ARC', 1, 5)
    const B = boxes(4, 'STR', 2, 5)
    const ghost = { ...B[0], id: 999, bbox: undefined } as unknown as FederatedElement
    const pairs = clashPairs([...A, ...B, ghost], ALWAYS, 'ARC', 'STR')
    expect(pairs.pairs.some((p) => p.b.id === 999)).toBe(false)
  })
})

/* ══════════════════════════ 2026-09-20 — the proximity tool ══════════════════════════ */

/**
 * `find_nearby` runs on the **same** uniform hash, so it gets the same proof: the grid is a
 * filter, never an answer, and it must return exactly what a flat scan returns.
 */
describe('nearbyElements', () => {
  const idKey = (ns: { el: FederatedElement; gap: number }[]): string =>
    ns.map((n) => `${n.el.id}:${n.gap.toFixed(9)}`).join('|')

  it('equals brute force on random boxes, at several distances', () => {
    const pool = boxes(400, 'ARC', 24680, 40)
    for (const seedId of [3, 51, 199, 377]) {
      const seeds = pool.filter((e) => e.id === seedId)
      for (const d of [0, 0.25, 1, 5]) {
        const fast = nearbyElements(pool, seeds, d)
        const slow = nearbyElementsBrute(pool, seeds, d)
        expect([seedId, d, fast.length]).toEqual([seedId, d, slow.length])
        expect([seedId, d, idKey(fast)]).toEqual([seedId, d, idKey(slow)])
      }
    }
  })

  it('equals brute force with several seeds at once, keeping the smallest gap per neighbour', () => {
    const pool = boxes(300, 'ARC', 13579, 30)
    const seeds = pool.filter((e) => [7, 88, 201].includes(e.id))
    for (const d of [0.5, 2, 8]) {
      expect([d, idKey(nearbyElements(pool, seeds, d))]).toEqual([
        d,
        idKey(nearbyElementsBrute(pool, seeds, d))
      ])
    }
    // A neighbour appears once, whichever seed found it.
    const ids = nearbyElements(pool, seeds, 8).map((n) => n.el.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('equals brute force on the design’s own federation', () => {
    const f = federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))
    const seed = f.elements.find((e) => e.type === 'IfcStair' && e.bbox)!
    for (const d of [0, 1, 2, 10]) {
      expect([d, idKey(nearbyElements(f.elements, [seed], d))]).toEqual([
        d,
        idKey(nearbyElementsBrute(f.elements, [seed], d))
      ])
    }
  })

  it('never returns a seed as its own neighbour, and sorts by gap', () => {
    const f = federate(['ARC', 'STR'].map((k) => mockModelIndex(k)))
    const seeds = f.elements.filter((e) => e.bbox).slice(0, 3)
    const found = nearbyElements(f.elements, seeds, 50)
    expect(found.some((n) => seeds.some((s) => s.id === n.el.id))).toBe(false)
    for (let i = 1; i < found.length; i++) expect(found[i - 1].gap).toBeLessThanOrEqual(found[i].gap)
  })

  it('reports 0 for boxes that overlap, and the straight-line gap otherwise', () => {
    const box = (id: number, x: number): FederatedElement =>
      ({ id, model: 'ARC', name: `b${id}`, type: 'IfcWall', bbox: [x, 0, 0, x + 1, 1, 1] }) as unknown as FederatedElement
    const pool = [box(1, 0), box(2, 0.5), box(3, 3)]
    const found = nearbyElements(pool, [pool[0]], 10)
    expect(found.map((n) => [n.el.id, Number(n.gap.toFixed(6))])).toEqual([
      [2, 0],
      [3, 2]
    ])
  })
})
