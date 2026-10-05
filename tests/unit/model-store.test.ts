/**
 * Guarantee 3 (SYSTEM_SPEC §6): the model the renderer holds is immutable. A structured
 * clone strips the freeze on the way out of the worker, so `federation-store.ts` re-applies it
 * to every index as it lands — element, its property sets, and the values inside them.
 *
 * Refactor pass 2 removed the `ModelStore` class this file used to test: nothing ever read it
 * back. The freeze it applied is `deepFreeze`, applied the same way, and is what is tested.
 */
import { describe, expect, it } from 'vitest'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { deepFreeze } from '../../src/renderer/model/store'

describe('deepFreeze', () => {
  it('freezes every element down to its property sets, and the metadata', () => {
    const { elements, ...meta } = structuredClone(mockModelIndex('ARC'))
    deepFreeze(meta)
    for (const element of elements) deepFreeze(element)

    expect(elements).toHaveLength(140)
    const element = elements[0]
    expect(Object.isFrozen(element)).toBe(true)
    expect(Object.isFrozen(element.psets)).toBe(true)
    expect(Object.isFrozen(Object.values(element.psets)[0])).toBe(true)
    expect(Object.isFrozen(meta.storeys)).toBe(true)
    expect(Object.isFrozen(meta.counts)).toBe(true)

    expect(() => {
      ;(element as { name: string }).name = 'edited'
    }).toThrow(TypeError)
  })

  it('walks a shared object once', () => {
    // Property sets are shared between elements by the worker's resolver, so the freeze must
    // stop at an already-frozen subtree rather than re-walking it per element.
    const shared = { Reference: 'EW200' }
    const graph = { a: { pset: shared }, b: { pset: shared } }
    deepFreeze(graph)
    expect(Object.isFrozen(shared)).toBe(true)
  })

  it('leaves typed arrays alone', () => {
    const chunk = { positions: new Float32Array([1, 2, 3]) }
    deepFreeze(chunk)
    expect(Object.isFrozen(chunk)).toBe(true)
    expect(Object.isFrozen(chunk.positions)).toBe(false)
    chunk.positions[0] = 9
    expect(chunk.positions[0]).toBe(9)
  })
})
