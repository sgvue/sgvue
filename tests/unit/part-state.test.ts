/**
 * The per-part colour/state table (`src/renderer/viewer/part-state.ts`).
 *
 * It is what replaced `BatchedMesh.setColorAt`: the merged meshes have one material for tens
 * of thousands of parts, so the state travels with the vertex. Three things must hold — the
 * index → texel arithmetic here is the one the shader repeats, growing must not lose a
 * colour already written, and a write must not upload anything until the frame asks.
 */
import { Vector4 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { PART_TEX_WIDTH, createPartState, texelOf } from '../../src/renderer/viewer/part-state'

describe('texelOf', () => {
  it('is the row-major mapping the material recomputes in the shader', () => {
    expect(texelOf(0)).toEqual({ col: 0, row: 0 })
    expect(texelOf(PART_TEX_WIDTH - 1)).toEqual({ col: PART_TEX_WIDTH - 1, row: 0 })
    expect(texelOf(PART_TEX_WIDTH)).toEqual({ col: 0, row: 1 })
    expect(texelOf(67_364)).toEqual({ col: 67_364 % PART_TEX_WIDTH, row: 65 })
  })
})

describe('part state', () => {
  it('hands out consecutive indices and remembers what was written', () => {
    const s = createPartState()
    expect(s.allocate(3)).toBe(0)
    expect(s.allocate(2)).toBe(3)
    expect(s.count).toBe(5)
    s.set(4, 0.1, 0.2, 0.3, 1.35)
    const out = new Vector4()
    expect(s.get(4, out).toArray()).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.3, 6),
      expect.closeTo(1.35, 6)
    ])
    s.dispose()
  })

  it('grows past the first allocation without losing a colour', () => {
    const s = createPartState()
    const first = s.capacity
    s.allocate(first)
    s.set(first - 1, 1, 0, 0, 1)
    // One more part than fits: the image is reallocated and re-uploaded at the new size.
    s.allocate(1)
    expect(s.capacity).toBeGreaterThan(first)
    expect(s.texture.image.height).toBe(s.capacity / PART_TEX_WIDTH)
    const out = new Vector4()
    expect(s.get(first - 1, out).toArray()).toEqual([1, 0, 0, 1])
    expect(s.get(first, out).toArray()).toEqual([0, 0, 0, 0])
    s.dispose()
  })

  it('uploads once per flush, and not at all when nothing changed', () => {
    const s = createPartState()
    s.allocate(4)
    // `needsUpdate = true` bumps `version`; it cannot be cleared, so measure from here.
    const base = s.texture.version
    s.flush()
    expect(s.texture.version).toBe(base)

    s.set(0, 1, 1, 1, 1)
    s.set(1, 1, 1, 1, 1)
    s.set(2, 1, 1, 1, 1)
    // Three writes, still nothing uploaded: `needsUpdate` is the frame's job.
    expect(s.texture.version).toBe(base)
    s.flush()
    expect(s.texture.version).toBe(base + 1)
    // And a second flush with no write in between costs nothing.
    s.flush()
    expect(s.texture.version).toBe(base + 1)
    s.dispose()
  })

  /**
   * Phase 10: the frame loop turns this answer into `rig.invalidateShadows()`. A part's alpha
   * is what the family materials discard on in the shadow pass too, so "something was
   * uploaded" is exactly "the shadow map may now be wrong" — and a `false` that should have
   * been `true` is a stale shadow.
   */
  it('says whether it uploaded, which is what re-renders the shadow map', () => {
    const s = createPartState()
    s.allocate(2)
    expect(s.flush()).toBe(false)
    s.set(0, 1, 1, 1, 1)
    expect(s.flush()).toBe(true)
    expect(s.flush()).toBe(false)
    // Writing the same value again is still a write: the table does not compare.
    s.set(0, 1, 1, 1, 1)
    expect(s.flush()).toBe(true)
    // A reset is a change too — every part goes to zero.
    s.reset()
    expect(s.flush()).toBe(true)
    s.dispose()
  })

  it('samples exactly: nearest filtering, no mips, no flip', () => {
    const s = createPartState()
    expect(s.texture.generateMipmaps).toBe(false)
    expect(s.texture.flipY).toBe(false)
    expect(s.texture.minFilter).toBe(s.texture.magFilter)
    s.dispose()
  })
})
