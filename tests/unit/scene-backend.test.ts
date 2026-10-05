/**
 * Backend resolution (`src/renderer/viewer/scene.ts`).
 *
 * This is a one-line function guarding a product decision taken on 2026-09-17 after two
 * kernel panics: `'auto'` means **WebGL2**, and nothing reaches WebGPU without naming it.
 * `CLAUDE.md` Decisions carries the evidence.
 */
import { describe, expect, it } from 'vitest'
import { forceWebGLFor } from '../../src/renderer/viewer/scene'

describe('forceWebGLFor', () => {
  it("resolves 'auto' to WebGL2 — the 2026-09-17 default", () => {
    expect(forceWebGLFor('auto')).toBe(true)
  })

  it("resolves 'webgl' to WebGL2", () => {
    expect(forceWebGLFor('webgl')).toBe(true)
  })

  it("lets only an explicit 'webgpu' through to the adapter check", () => {
    expect(forceWebGLFor('webgpu')).toBe(false)
  })
})
