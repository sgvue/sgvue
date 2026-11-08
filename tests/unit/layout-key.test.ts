/**
 * The layout key the reduced-motion e2e check compares matrix pictures by (`tests/e2e/layout-key.ts`;
 * the owner: *"Compare layout, not pixels."*). Held here, headless, on pictures drawn by hand: two
 * pictures that differ only in their cells' anti-aliased corners are one layout; a cell moved,
 * added or changed in colour role is another. So the e2e's "exactly three pictures" is exactly as
 * strict as before about every state a person could see, and blind only to corner coverage.
 */
import { describe, expect, it } from 'vitest'
import { layoutKey } from '../e2e/layout-key'

const W = 40
const H = 12
type Rgb = [number, number, number]
const CELL: Rgb = [0x2a, 0x3a, 0x39]
const HIT: Rgb = [0x35, 0xc4, 0xb6]

/** A canvas's pixels: transparent, with rounded square cells of `size` px at `(x, y)`. */
function picture(cells: { x: number; y: number; size: number; rgb: Rgb; corner: number }[], w = W): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * H * 4)
  for (const c of cells) {
    for (let y = c.y; y < c.y + c.size; y++) {
      for (let x = c.x; x < c.x + c.size; x++) {
        const corner = (x === c.x || x === c.x + c.size - 1) && (y === c.y || y === c.y + c.size - 1)
        const i = (y * w + x) * 4
        px[i] = c.rgb[0]
        px[i + 1] = c.rgb[1]
        px[i + 2] = c.rgb[2]
        // A rounded corner's pixel is only partly covered — by as much as the rasteriser decides.
        px[i + 3] = corner ? c.corner : 255
      }
    }
  }
  return px
}

const row = (corner: number, change: Partial<Record<number, Partial<{ x: number; rgb: Rgb }>>> = {}) =>
  [0, 1, 2, 3].map((k) => ({ x: 2 + k * 9, y: 2, size: 7, rgb: CELL, corner, ...(change[k] ?? {}) }))

describe('the layout key: cells, places and colour roles — never corners', () => {
  it('reads one cell a connected run of solid pixels, by its box and its centre colour', () => {
    const k = layoutKey(W, H, picture(row(255)))
    expect(k.cells).toBe(4)
    expect(k.colours).toBe('2.3.3×4')
    expect(k.key.split(';')).toContain('2,2,7x7,2.3.3')
  })

  it('takes two pictures that differ only in anti-aliased corners as one layout', () => {
    // One rasteriser covers each corner at 200 of 255, the other at 90 — under the threshold, so
    // the solid-pixel count differs by 4 corners a cell, as the window run's 160 did for 80 cells.
    const gpu = layoutKey(W, H, picture(row(200)))
    const cpu = layoutKey(W, H, picture(row(90)))
    expect(cpu.key).toBe(gpu.key)
    // …and a backing store reallocated for the same cells is no new layout either.
    expect(layoutKey(W + 6, H, picture(row(90), W + 6)).key).toBe(gpu.key)
  })

  it('takes a cell moved, a cell added or a cell changing colour role as another layout', () => {
    const base = layoutKey(W, H, picture(row(200))).key
    expect(layoutKey(W, H, picture(row(200, { 2: { x: 21 } }))).key).not.toBe(base)
    expect(layoutKey(W, H, picture(row(200, { 3: { rgb: HIT } }))).key).not.toBe(base)
    expect(layoutKey(W, H, picture([...row(200), { x: 2, y: 10, size: 2, rgb: CELL, corner: 255 }])).key).not.toBe(base)
    expect(layoutKey(W, H, picture(row(200).slice(0, 3))).key).not.toBe(base)
  })

  it('is self-contained, so the page can run it from its source', () => {
    // The e2e sends `layoutKey.toString()` to the page: it may name nothing from outside itself.
    const rebuilt = new Function(`return (${layoutKey.toString()})`)() as typeof layoutKey
    expect(rebuilt(W, H, picture(row(90))).key).toBe(layoutKey(W, H, picture(row(200))).key)
  })
})
