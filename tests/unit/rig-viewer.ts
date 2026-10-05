/**
 * A shared test helper — not a test on its own (the name does not end in `.test.ts`).
 *
 * `rigViewer(overrides)` is `stubViewer` with a **real camera rig** behind its camera methods
 * (2026-10-02). `viewer/camera.ts` touches no renderer, canvas or DOM, so the assistant's camera
 * tools and the chat's per-turn revert can be checked against the camera's own arithmetic — the
 * pose it would really fly to — rather than against a recording of what was called.
 *
 * Each camera method makes the rig call `viewer-core.ts` makes for it — `zoomExtents` is
 * `fitBox(frameBox, zoom)`, `lookAlong` is `setAngles`, `focusPoint` a 6 m box round the point —
 * without the flight and the frame request, and the rig reports a projection swap to the store
 * as the app's `on.projection` does. `calls` records them, in order. Everything else is the
 * plain stub's no-op, unless `overrides` names it.
 *
 * It is a file of its own, beside `stub-viewer.ts`, so that the many store tests that need no
 * camera do not load three.js to get a stub.
 */
import { Box3, Vector3 } from 'three/webgpu'
import { useShell } from '../../src/renderer/state/shell'
import { createCameraRig, type CameraRig, type CameraState } from '../../src/renderer/viewer/camera'
import type { Viewer } from '../../src/renderer/viewer/viewer-core'
import { stubViewer } from './stub-viewer'

/** The design's own mock federation's box: −8…32 × −8…26 × −1…15.5 m, radius 27.5 m. */
export const MOCK_BOX = new Box3(new Vector3(-8, -8, -1), new Vector3(32, 26, 15.5))
/** What the rig viewer frames for `zoomTo`, whatever the ids: a 4 m cube off the centre. */
export const SELECTION_BOX = new Box3(new Vector3(20, 2, 3), new Vector3(24, 6, 7))

export interface RigViewer {
  viewer: Viewer
  rig: CameraRig
  /** Every camera call the store made, in order: `['zoomExtents', 2]`, `['lookAlong', θ, φ]` … */
  calls: [string, ...unknown[]][]
}

export function rigViewer(overrides: Record<string, unknown> = {}): RigViewer {
  const calls: [string, ...unknown[]][] = []
  const rig = createCameraRig({
    scale: 1,
    bbox: MOCK_BOX,
    onProjection: (p) => useShell.getState().setProjection(p)
  })
  rig.setAspect(1440 / 860)
  rig.fitBox(MOCK_BOX)
  const said =
    <A extends unknown[]>(name: string, fn: (...args: A) => void) =>
    (...args: A): void => {
      calls.push([name, ...args])
      fn(...args)
    }
  const viewer = stubViewer({
    getCamera: () => rig.getCamera(),
    setCamera: said('setCamera', (c: CameraState) => rig.setCamera(c)),
    setView: said('setView', (name: string) => rig.setView(name)),
    setProjection: said('setProjection', (p: 'persp' | 'ortho') => rig.setProjection(p)),
    zoomExtents: said('zoomExtents', (zoom?: number) => rig.fitBox(MOCK_BOX, zoom)),
    zoomTo: said('zoomTo', (_ids: number | number[], zoom?: number) => rig.fitBox(SELECTION_BOX, zoom)),
    lookAlong: said('lookAlong', (theta: number, phi: number) => rig.setAngles(theta, phi)),
    focusPoint: said('focusPoint', (p: number[]) =>
      rig.fitBox(new Box3().setFromCenterAndSize(new Vector3().fromArray(p), new Vector3(6, 6, 6)))
    ),
    frameExtents: said('frameExtents', () => rig.fitBox(MOCK_BOX)),
    ...overrides
  })
  return { viewer, rig, calls }
}
