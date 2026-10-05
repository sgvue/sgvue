/**
 * The two section planes in the viewer — `renderer/viewer/section.ts` (2026-10-01,
 * owner-requested: the gridline cut and the level cut are independent and can be on together).
 *
 * `createSection` is driven against a recording host: the box, the grids and the storeys are
 * the design's own mock federation's, and what is asserted is what the host is told — which
 * planes cut (`setClips`, one entry a slot) and when the camera is re-aimed. The re-aim is the
 * design's rule (`viewer-core.js` L253) applied **per plane**: a plane that starts cutting, or
 * whose kind, name or flip changed while cutting, re-aims the camera at itself; an offset, a
 * clear, or a change to the other plane never does; both moving in one call re-aims once, at
 * the gridline plane; and `refresh()` re-aims at nothing.
 */
import { Box3, LineBasicMaterial, MeshBasicMaterial, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import type { CutPlane } from '../../src/renderer/viewer/section-cut'
import {
  createSection,
  type GridSegment,
  type SectionConfig,
  type SectionVisuals
} from '../../src/renderer/viewer/section'

/** `−0` and `0` are the same plane; `toEqual` tells them apart. */
const flat = (p: CutPlane | null): number[] | null => (p ? [...p.n.map((v) => v + 0), p.c + 0] : null)

function stage(grids?: GridSegment[]): {
  section: SectionVisuals
  clips: (number[] | null)[][]
  aims: number[][]
  grids: GridSegment[]
} {
  const clips: (number[] | null)[][] = []
  const aims: number[][] = []
  const live: GridSegment[] = grids ?? [
    { name: 'C', p0: [12, -8], p1: [12, 26] },
    { name: 'D', p0: [18, -8], p1: [18, 26] },
    { name: '2', p0: [-8, 6], p1: [32, 6] }
  ]
  const section = createSection(
    {
      // The mock federation's box: its centre is (12, 9, 7.25).
      bbox: new Box3(new Vector3(-8, -8, -1), new Vector3(32, 26, 15.5)),
      scale: () => 1,
      grids: () => live,
      storeys: () => [
        { name: 'L2', elev: 4 },
        { name: 'L3', elev: 7.5 }
      ],
      setClips: (planes) => void clips.push(planes.map(flat)),
      reaim: (normal) => void aims.push(normal.toArray().map((v) => v + 0))
    },
    {
      section: new LineBasicMaterial(),
      sectionSheet: new MeshBasicMaterial(),
      sectionCut: new MeshBasicMaterial()
    }
  )
  return { section, clips, aims, grids: live }
}

const grid = (name: string, over: Partial<SectionConfig> = {}): SectionConfig => ({
  kind: 'grid',
  name,
  offset: 0,
  flip: false,
  cut: true,
  ...over
})
const level = (name: string, over: Partial<SectionConfig> = {}): SectionConfig => ({
  kind: 'storey',
  name,
  offset: 1.2,
  flip: false,
  cut: true,
  ...over
})

/** Grid C keeps x ≥ 12 (the side holding the centre); level L2 + 1.2 m keeps z ≤ 5.2. */
const CLIP_C = [1, 0, 0, -12]
const CLIP_L2 = [0, 0, -1, 5.2]
/** The camera looks along −n: at grid C from +x, at a level cut from above. */
const AIM_C = [-1, 0, 0]
const AIM_LEVEL = [0, 0, 1]

describe('the section planes — what cuts', () => {
  it('hands the host one plane a slot: the gridline cut, then the level cut', () => {
    const { section, clips } = stage()
    section.apply({ grid: grid('C'), level: null })
    expect(clips.at(-1)).toEqual([CLIP_C, null])
    section.apply({ grid: null, level: level('L2') })
    expect(clips.at(-1)).toEqual([null, CLIP_L2])
    section.apply({ grid: grid('C'), level: level('L2') })
    expect(clips.at(-1)).toEqual([CLIP_C, CLIP_L2])
    section.apply({ grid: null, level: null })
    expect(clips.at(-1)).toEqual([null, null])
    // One `setClips` per apply, both slots every time.
    expect(clips).toHaveLength(4)
    expect(section.current).toEqual({ grid: null, level: null })
  })

  it('each plane is the design’s single plane: offset along the normal, flip the kept side', () => {
    const { section, clips } = stage()
    section.apply({ grid: grid('C', { offset: 1.5, flip: true }), level: level('L3', { offset: -0.5, flip: true }) })
    // Grid C moved 1.5 m along +x: the centre (x = 12) is now on its low side, so unflipped it
    // would keep x ≤ 13.5 — flipped, x ≥ 13.5. Level L3 − 0.5 m flipped: z ≥ 7.
    expect(clips.at(-1)).toEqual([
      [1, 0, 0, -13.5],
      [0, 0, 1, -7]
    ])
    section.apply({ grid: grid('C', { offset: 1.5 }), level: null })
    expect(clips.at(-1)).toEqual([[-1, 0, 0, 13.5], null])
    // A grid along x: its normal is +y, and it keeps the centre's side (y ≥ 6).
    section.apply({ grid: grid('2'), level: null })
    expect(clips.at(-1)).toEqual([[0, 1, 0, -6], null])
  })

  it('a previewed plane clips nothing and shows its own sheet; a cutting one does not', () => {
    const { section, clips } = stage()
    const [gridLine, gridSheet, levelLine, levelSheet, cut] = section.objects
    expect(section.objects).toHaveLength(5)
    expect(section.drawn).toBe(0)

    section.apply({ grid: grid('C', { cut: false }), level: level('L2') })
    // The gridline plane is previewed while the level plane cuts: each has its own outline.
    expect(clips.at(-1)).toEqual([null, CLIP_L2])
    expect([gridLine.visible, gridSheet.visible]).toEqual([true, true])
    expect([levelLine.visible, levelSheet.visible]).toEqual([true, false])
    expect(section.drawn).toBe(3)

    section.apply({ grid: grid('C', { cut: false }), level: level('L2', { cut: false }) })
    expect(clips.at(-1)).toEqual([null, null])
    expect([gridSheet.visible, levelSheet.visible]).toEqual([true, true])
    expect(section.drawn).toBe(4)

    section.apply({ grid: null, level: level('L2') })
    expect([gridLine.visible, gridSheet.visible]).toEqual([false, false])
    expect([levelLine.visible, levelSheet.visible]).toEqual([true, false])
    // The cut outline is one mesh for both planes, shown only while it has segments.
    expect(cut.visible).toBe(false)
    section.setCut(new Float32Array([0, 0, 0, 1, 0, 0]), 1)
    expect(cut.visible).toBe(true)
    expect(section.drawn).toBe(2)
    section.setCut(null, 0)
    expect(cut.visible).toBe(false)
    section.dispose()
  })

  it('a name the federation does not have draws nothing and cuts nothing — and comes in on refresh', () => {
    const live: GridSegment[] = []
    const { section, clips, aims } = stage(live)
    section.apply({ grid: grid('C'), level: level('Mezzanine') })
    expect(clips.at(-1)).toEqual([null, null])
    expect(section.drawn).toBe(0)
    expect(aims).toEqual([])
    // The configuration is kept, so a model that brings grid C makes the plane appear …
    live.push({ name: 'C', p0: [12, -8], p1: [12, 26] })
    section.refresh()
    expect(clips.at(-1)).toEqual([CLIP_C, null])
    // … without stealing the camera.
    expect(aims).toEqual([])
  })
})

describe('the section planes — the re-aim, per plane (L253)', () => {
  it('a plane that starts cutting re-aims the camera at itself', () => {
    const { section, aims } = stage()
    section.apply({ grid: grid('C'), level: null })
    expect(aims).toEqual([AIM_C])
    section.apply({ grid: null, level: null })
    section.apply({ grid: null, level: level('L2') })
    expect(aims).toEqual([AIM_C, AIM_LEVEL])
  })

  it('an offset never re-aims, on either plane', () => {
    const { section, aims, clips } = stage()
    section.apply({ grid: grid('C'), level: level('L2') })
    const n = aims.length
    section.apply({ grid: grid('C', { offset: -0.5 }), level: level('L2') })
    section.apply({ grid: grid('C', { offset: -0.5 }), level: level('L2', { offset: 1.7 }) })
    expect(aims).toHaveLength(n)
    // …but both planes moved to where they were told.
    expect(clips.at(-1)).toEqual([
      [1, 0, 0, -11.5],
      [0, 0, -1, 5.7]
    ])
    // Not even when the offset carries the gridline plane past the model's centre, which —
    // the design's rule, "keep the side holding the model" — turns its kept side round.
    section.apply({ grid: grid('C', { offset: 0.5 }), level: level('L2', { offset: 1.7 }) })
    expect(clips.at(-1)![0]).toEqual([-1, 0, 0, 12.5])
    expect(aims).toHaveLength(n)
  })

  it('a change to one plane never re-aims at the other', () => {
    const { section, aims } = stage()
    section.apply({ grid: grid('C'), level: null })
    expect(aims).toEqual([AIM_C])
    // The level plane starts cutting beside a gridline cut that did not change: the camera
    // goes to the level plane, not back to grid C.
    section.apply({ grid: grid('C'), level: level('L2') })
    expect(aims).toEqual([AIM_C, AIM_LEVEL])
    // The level plane flipped: at the level plane again, from below this time.
    section.apply({ grid: grid('C'), level: level('L2', { flip: true }) })
    expect(aims.at(-1)).toEqual([0, 0, -1])
    // The level plane moved to another storey: still the level plane.
    section.apply({ grid: grid('C'), level: level('L3', { flip: true }) })
    expect(aims.at(-1)).toEqual([0, 0, -1])
    expect(aims).toHaveLength(4)
    // The gridline plane moved to grid D, then flipped: at the gridline plane, both times.
    // Grid D (x = 18) keeps the centre's side, x ≤ 18, so it is looked at from −x; flipped, +x.
    section.apply({ grid: grid('D'), level: level('L3', { flip: true }) })
    expect(aims.at(-1)).toEqual([1, 0, 0])
    section.apply({ grid: grid('D', { flip: true }), level: level('L3', { flip: true }) })
    expect(aims.at(-1)).toEqual([-1, 0, 0])
    expect(aims).toHaveLength(6)
  })

  it('a clear never re-aims — not at the plane that went, not at the one that stayed', () => {
    const { section, aims, clips } = stage()
    section.apply({ grid: grid('C'), level: level('L2') })
    const n = aims.length
    section.apply({ grid: grid('C'), level: null })
    expect(clips.at(-1)).toEqual([CLIP_C, null])
    section.apply({ grid: null, level: null })
    expect(aims).toHaveLength(n)
  })

  it('a preview does not re-aim; turning its cut on does', () => {
    const { section, aims } = stage()
    section.apply({ grid: grid('C', { cut: false }), level: null })
    expect(aims).toEqual([])
    section.apply({ grid: grid('C'), level: null })
    expect(aims).toEqual([AIM_C])
    // Cut off again, and a second plane previewed: nothing.
    section.apply({ grid: grid('C', { cut: false }), level: level('L2', { cut: false }) })
    expect(aims).toEqual([AIM_C])
    // The level plane's cut on, the gridline plane still a preview: the level plane.
    section.apply({ grid: grid('C', { cut: false }), level: level('L2') })
    expect(aims).toEqual([AIM_C, AIM_LEVEL])
  })

  it('both planes moving in one call — a restore — re-aims once, at the gridline plane', () => {
    const { section, aims, clips } = stage()
    section.apply({ grid: grid('C'), level: level('L2') })
    expect(aims).toEqual([AIM_C])
    expect(clips.at(-1)).toEqual([CLIP_C, CLIP_L2])
    // And again from another pair: one re-aim, the gridline plane's.
    section.apply({ grid: grid('2', { flip: true }), level: level('L3') })
    expect(aims).toEqual([AIM_C, [0, 1, 0]])
  })

  it('refresh re-applies both planes against the new box and re-aims at nothing', () => {
    const { section, aims, clips } = stage()
    section.apply({ grid: grid('C'), level: level('L2') })
    const n = aims.length
    const calls = clips.length
    section.refresh()
    expect(clips).toHaveLength(calls + 1)
    expect(clips.at(-1)).toEqual([CLIP_C, CLIP_L2])
    expect(aims).toHaveLength(n)
    expect(section.current).toEqual({ grid: grid('C'), level: level('L2') })
  })
})
