/**
 * 2026-11-08 — the matrix canvas is asked for with `willReadFrequently`. The e2e suite and the dev
 * harness read it back every frame, and Chromium moves a 2D canvas from the GPU rasteriser to the
 * CPU one after repeated readbacks: the same frame, drawn again, then gives its rounded cells
 * different anti-aliased corners (the reduced-motion "4th picture", `docs/DECISIONS.md`). The flag
 * keeps the canvas on one rasteriser where Chromium honours it; it did not remove the difference in
 * the window run, so the e2e compares the matrix by layout, not pixels (`tests/e2e/layout-key.ts`).
 * The flag stays, and is held here as text: no headless canvas can tell the two rasterisers apart.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/renderer/app/Trace.tsx'), 'utf8')

describe('the matrix canvas reads back as it was drawn', () => {
  it('asks for its 2D context with willReadFrequently, and only that way', () => {
    expect(source).toContain("getContext('2d', { willReadFrequently: true })")
    expect(source).not.toMatch(/getContext\(\s*['"]2d['"]\s*\)/)
    // One context request in the file: `paintMatrix`'s, which `paintFinal` goes through.
    expect(source.match(/getContext\(/g)).toHaveLength(1)
  })
})
