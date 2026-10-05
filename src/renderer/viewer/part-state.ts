/**
 * Per-part colour and state, as one small texture the shaders read.
 *
 * The reference gives every element its own `THREE.Mesh` and swaps `mesh.material` per state
 * (`viewer-core.js` L487–498). A merged mesh has one material for tens of thousands of parts,
 * so the state has to travel with the *vertex*: every vertex of a part carries that part's
 * index in a `partIndex` attribute, and the material fetches `RGBA` for it here. Writing a
 * colour is then two array stores and a dirty flag — no buffer rewrite, no re-merge.
 *
 * **Why a texture rather than a uniform array.** 67 364 parts × vec4 is far past any uniform
 * limit, and a storage buffer would not work on the WebGL2 backend. A `Float32` RGBA texture
 * read with `textureLoad` (`texelFetch` in GLSL3) is core WebGL2 and needs no filtering.
 *
 * It is tiny: the width is fixed at 1 024 texels, so the reference model's 67 364 parts are
 * 66 rows — about 1.1 MB. The whole thing is re-uploaded when anything changes, which is why
 * `flush()` exists: `set()` only marks it dirty, and the frame loop turns that into **one**
 * `needsUpdate` per frame in which something actually changed, never one per write and never
 * one per frame.
 */
import { DataTexture, FloatType, NearestFilter, RGBAFormat, type Vector4 } from 'three/webgpu'

/** Texels per row. Fixed, so the shader's index → (col, row) needs no uniform. */
export const PART_TEX_WIDTH = 1024

/** Rows in the first allocation; it doubles from here. */
const INITIAL_ROWS = 8

export interface PartState {
  /** The texture the materials sample. The object identity never changes, only its image. */
  readonly texture: DataTexture
  /** Parts allocated so far. */
  readonly count: number
  /** Texels the current image holds — `count` rounded up to whole rows, at least one page. */
  readonly capacity: number
  /** Reserve `n` consecutive part indices and return the first. */
  allocate(n: number): number
  set(part: number, r: number, g: number, b: number, a: number): void
  /** The stored RGBA of one part — for `debug()` and the unit tests. */
  get(part: number, out: Vector4): Vector4
  /**
   * Turn every write since the last call into at most one texture upload.
   *
   * @returns whether anything was actually uploaded — which is also the one honest signal
   * that what the shadow pass draws may have changed, since a part's alpha is what the family
   * materials discard on (`viewer-core.ts` hands it to `rig.invalidateShadows()`).
   */
  flush(): boolean
  /** Forget every part; the image is kept so the next model reuses the allocation. */
  reset(): void
  dispose(): void
}

const rowsFor = (texels: number): number => Math.max(INITIAL_ROWS, Math.ceil(texels / PART_TEX_WIDTH))

export function createPartState(): PartState {
  let rows = INITIAL_ROWS
  let data = new Float32Array(PART_TEX_WIDTH * rows * 4)
  const texture = new DataTexture(data, PART_TEX_WIDTH, rows, RGBAFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.name = 'sgvue:part-state'
  texture.needsUpdate = true

  let count = 0
  let dirty = false

  /** Grow to hold `want` parts, keeping everything already written. */
  const grow = (want: number): void => {
    if (want <= rows * PART_TEX_WIDTH) return
    let next = rows
    while (next * PART_TEX_WIDTH < want) next *= 2
    const bigger = new Float32Array(PART_TEX_WIDTH * next * 4)
    bigger.set(data)
    data = bigger
    rows = next
    // A `DataTexture` whose dimensions change has to be reallocated on the GPU; disposing
    // frees the old allocation and `needsUpdate` re-uploads at the new size. The JS object —
    // the one every material node holds a reference to — is deliberately kept.
    texture.image = { data, width: PART_TEX_WIDTH, height: rows }
    texture.dispose()
    texture.needsUpdate = true
  }

  return {
    texture,
    get count() {
      return count
    },
    get capacity() {
      return rows * PART_TEX_WIDTH
    },

    allocate: (n) => {
      const first = count
      count += n
      grow(count)
      return first
    },

    set: (part, r, g, b, a) => {
      const i = part * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
      dirty = true
    },

    get: (part, out) => {
      const i = part * 4
      return out.set(data[i], data[i + 1], data[i + 2], data[i + 3])
    },

    flush: () => {
      if (!dirty) return false
      dirty = false
      texture.needsUpdate = true
      return true
    },

    reset: () => {
      data.fill(0)
      count = 0
      dirty = true
    },

    dispose: () => {
      texture.dispose()
      count = 0
    }
  }
}

/** The shader's index → texel arithmetic, in JS, so the unit tests can check the same maths. */
export const texelOf = (part: number): { col: number; row: number } => ({
  col: part % PART_TEX_WIDTH,
  row: Math.floor(part / PART_TEX_WIDTH)
})

export { rowsFor as partStateRowsFor }
