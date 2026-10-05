/**
 * Parity with the user, phase 2 — 2026-10-02. The owner: *"assistant should possess everything
 * user can do on the app."*
 *
 * The camera (`set_view`'s `fit`, `azimuth`, `elevation`, `zoom`), saved viewpoints
 * (`manage_views`), markups (`manage_markups`), one filter step changed in place
 * (`manage_filters`' `update`, `set_filter_stack`'s `color`) — and three leftovers from phase 1.
 *
 * Everything runs through `executeTool`, the one door a model's call comes through, on the
 * design's own mock federation, with a viewer whose **camera is the real rig**
 * (`rig-viewer.ts`): what is asserted about the camera is the pose it would really fly to. The
 * rules are phase 1's — through the control's own action, the same call twice changes nothing
 * the second time, anything that can hide runs the scope guard, every result is bounded — and
 * one more: **nothing here deletes, clears or places anything.** (Phase 3, the same day: a
 * deletion can be *asked for*, and a viewpoint restore the guard catches is held behind Apply
 * where it was refused in words — `ai-parity-3.test.ts` has the gate.)
 *
 * The chat's widened revert is `turn-revert.test.ts`; the angles themselves, `view-angles.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HL } from '../../src/shared/colors'
import { federate } from '../../src/shared/federate'
import * as fstack from '../../src/shared/filter-stack'
import { mmv, fixed3 } from '../../src/shared/fmt'
import { visFn, type Rule } from '../../src/shared/rules'
import {
  MARKUPS_CAP,
  VIEWPOINTS_CAP,
  VIEWPOINTS_SAVE_CAP,
  VIEW_DIRECTIONS,
  VIEW_NAME_MAX
} from '../../src/shared/tool-schemas'
import { POLE_PHI, anglesOf, sphericalOf, wrapPi } from '../../src/shared/view-angles'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { SCOPE_GUARD } from '../../src/renderer/ai/executors/view'
import { toolPhrase } from '../../src/renderer/ai/stages'
import { noteFor } from '../../src/renderer/ai/trace-facts'
import { loadViews, viewsKeyFor } from '../../src/renderer/state/persist'
import { measureRows, spotRows } from '../../src/renderer/state/selectors/markups'
import { historyDepth, setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import type { MeasureRecord, SpotRecord } from '../../src/renderer/viewer/annotations'
import { createCameraRig, type CameraRig } from '../../src/renderer/viewer/camera'
import { MOCK_BOX, SELECTION_BOX, rigViewer, type RigViewer } from './rig-viewer'
import { memoryStorage, resetShell } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const full = federate(KEYS.map((k) => mockModelIndex(k)))

interface Body {
  message?: string
  [key: string]: unknown
}

const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
  rawLine: async () => null,
  turn
})
const run = async (name: string, input: unknown = {}): Promise<Body> =>
  (await executeTool(name, input, ctx())) as Body
/** A fresh turn: what the next call marks is that call's own. */
const fresh = (): void => void Object.assign(turn, newTurnState())

const st = (): ShellState => useShell.getState()
const is = (prop: string, val: string): Rule => ({ prop, op: '=', val })
const idsOf = (pred: (e: (typeof full.elements)[number]) => boolean): number[] =>
  full.elements.filter(pred).map((e) => e.id)
const visibleIds = (): number[] => st().federation.elements.filter(visFn(st())).map((e) => e.id)
const visible = (): number => visibleIds().length

const STAIRS = idsOf((e) => e.type === 'IfcStair')
const DOORS_L2 = idsOf((e) => e.type === 'IfcDoor' && e.storey === 'L2')
const L2 = idsOf((e) => e.storey === 'L2')
const L3 = idsOf((e) => e.storey === 'L3')
const ALL = full.elements.map((e) => e.id)

let rv: RigViewer
/** The viewer calls a test cares about beside the camera's. */
let other: [string, ...unknown[]][] = []
const cameraCalls = (): string[] => rv.calls.map((c) => c[0])
const pose = (): unknown => rv.rig.getCamera()
/**
 * A second rig to compare against — the view button, the view cube — set up as `rigViewer`'s is
 * and telling the store nothing, so that what it does to its own projection is its own.
 */
function bareRig(): CameraRig {
  const rig = createCameraRig({ scale: 1, bbox: MOCK_BOX })
  rig.setAspect(1440 / 860)
  rig.fitBox(MOCK_BOX)
  return rig
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  other = []
  rv = rigViewer({
    setHighlightColor: (c: string) => void other.push(['setHighlightColor', c]),
    setSections: (cfg: unknown) => void other.push(['setSections', cfg]),
    setGrids: (on: boolean) => void other.push(['setGrids', on]),
    setLevels: (on: boolean) => void other.push(['setLevels', on])
  })
  setViewer(rv.viewer)
  st().commitModels(full)
  fresh()
})
afterEach(() => {
  setViewer(null)
  vi.unstubAllGlobals()
})

describe('the mock and the rig, as these cases need them', () => {
  it('has 412 elements, three stairs, four doors on L2, and a camera on the boot view', () => {
    expect(full.elements).toHaveLength(412)
    expect([STAIRS.length, DOORS_L2.length, L2.length]).toEqual([3, 4, 92])
    for (const n of [3, 4]) expect(n / 412).toBeLessThan(SCOPE_GUARD)
    expect(st().view).toBe('iso')
    expect(pose()).toMatchObject({ theta: -Math.PI / 4, phi: 1.05, proj: 'persp', target: [12, 9, 7.25] })
  })
})

/* ────────────────────────────── 0. phase 1's leftovers ────────────────────────────── */

describe('manage_filters — remove and move, which cannot hide', () => {
  const build = (): void => {
    st().addStep('isolate', [is('IfcEntity', 'IfcStair')])
    st().addStep('hide', [is('Level', 'L2')])
    fresh()
  }

  it('a move to the position the step already has is no move: no write, no undo entry', async () => {
    build()
    const before = st()
    const depth = historyDepth()
    for (const step of [1, 2]) {
      const body = await run('manage_filters', { op: 'move', step, to: step })
      expect(body.message).toBe(`Step ${step} is already at position ${step} — nothing changed.`)
      expect((body.steps as unknown[]).length).toBe(2)
    }
    expect(st()).toBe(before)
    expect(historyDepth()).toEqual(depth)
    expect(turn.acted).toBe(false)
  })

  it('still moves and removes, unguarded, in a view the user already took under 5 %', async () => {
    build()
    const few = visible()
    expect(few).toBeGreaterThan(0)
    expect(few / 412).toBeLessThan(SCOPE_GUARD)
    const ids = st().stack.map((x) => x.id)
    expect((await run('manage_filters', { op: 'move', step: 2, to: 1 })).message).toBe('Step 2 moved to position 1.')
    expect(st().stack.map((x) => x.id)).toEqual([ids[1], ids[0]])
    expect(visible()).toBe(few)
    expect((await run('manage_filters', { op: 'remove', step: 1 })).message).toBe('Step 1 removed. 1 left.')
    expect(visible()).toBe(3)
    expect(turn.pending).toBeNull()
    expect(turn.acted).toBe(true)
    expect((await run('manage_filters', { op: 'move', step: 1, to: 4 })).message).toBe('Target must be between 1 and 1.')
  })
})

/* ────────────────────────────── 1. the camera ────────────────────────────── */

describe('set_view — any direction, a fit that does not turn, a zoom', () => {
  it('turns the camera to a direction, where it stands, through the store’s aimCamera', async () => {
    const before = rv.rig.getCamera()
    const body = await run('set_view', { azimuth: 45, elevation: 30 })
    expect(body).toEqual({
      message: 'Camera turned to azimuth 45°, elevation 30°.',
      view: null,
      projection: 'persp',
      camera: { view: null, projection: 'persp', azimuthDeg: 45, elevationDeg: 30 }
    })
    // One call to the viewer, with the rig's own two angles: no fit, no projection.
    expect(cameraCalls()).toEqual(['lookAlong'])
    const to = sphericalOf(45, 30)
    expect(rv.calls[0].slice(1)).toEqual([to.theta, to.phi])
    // About what it was looking at, at the distance it had.
    const after = rv.rig.getCamera()
    expect([after.target, after.dist, after.half, after.proj]).toEqual([before.target, before.dist, before.half, 'persp'])
    // Like a click on the view cube, no view button is lit afterwards.
    expect(st().view).toBeNull()
    expect(turn.acted).toBe(true)
    // It changes nothing about what is visible, and nothing goes on the undo stack.
    expect(visible()).toBe(412)
    expect(historyDepth()).toEqual({ undo: 0, redo: 0 })
  })

  it('takes either angle alone and keeps the other', async () => {
    await run('set_view', { elevation: 60 })
    expect(anglesOf(rv.rig.goal.theta, rv.rig.goal.phi).elevationDeg).toBeCloseTo(60, 9)
    // The bearing is the camera's own, untouched to the last bit.
    expect(rv.rig.goal.theta).toBe(-Math.PI / 4)
    const body = await run('set_view', { azimuth: 90 })
    expect(body.camera).toEqual({ view: null, projection: 'persp', azimuthDeg: 90, elevationDeg: 60 })
    expect(rv.rig.goal.phi).toBe(sphericalOf(0, 60).phi)
    expect(body.message).toBe('Camera turned to azimuth 90°, elevation 60°.')
  })

  it('reaches straight down and straight up, with the bearing it was given', async () => {
    const down = await run('set_view', { azimuth: 90, elevation: 90 })
    // East up the screen: the bearing is kept at the pole, where a view-cube click chooses north.
    expect(down.camera).toEqual({ view: null, projection: 'persp', azimuthDeg: 90, elevationDeg: 90 })
    expect(rv.rig.goal.phi).toBe(POLE_PHI)
    const up = await run('set_view', { elevation: -90 })
    expect((up.camera as { elevationDeg: number }).elevationDeg).toBe(-90)
    // …and the plan view itself, by its angles, is the plan view.
    expect((await run('set_view', { azimuth: 0, elevation: 90 })).camera).toMatchObject({ view: 'top' })
  })

  it('frames without turning: the whole building, as a double-click on empty space does', async () => {
    // The user has orbited and zoomed in on something by hand.
    rv.rig.orbit(160, 30, null)
    rv.rig.dolly(0.2, null)
    const before = rv.rig.getCamera()
    rv.calls.length = 0
    const body = await run('set_view', { fit: 'extents' })
    expect(body.message).toBe('Framed the whole building.')
    expect(rv.calls).toEqual([['zoomExtents', undefined]])
    const after = rv.rig.getCamera()
    // Not turned: the same two angles. Framed: the building's own centre and fit distance.
    expect([after.theta, after.phi]).toEqual([before.theta, before.phi])
    expect(after.target).toEqual([12, 9, 7.25])
    expect(+after.dist.toFixed(2)).toBe(70.31)
    // The lit view button is left as it was — the camera has not turned.
    expect(st().view).toBe('iso')
    expect(turn.acted).toBe(true)
  })

  it('frames the selection, as F does — and refuses when nothing is selected', async () => {
    const none = await run('set_view', { fit: 'selection' })
    expect(none.message).toBe(
      'Nothing is selected, so there is no selection to frame — nothing changed. Select something first, or use fit:"extents" for the whole building.'
    )
    expect(cameraCalls()).toEqual([])
    expect(turn.acted).toBe(false)

    st().select(STAIRS, false)
    rv.calls.length = 0
    const body = await run('set_view', { fit: 'selection' })
    expect(body.message).toBe('Framed the selection — 3 elements.')
    // Everything that is selected, not only the element picked last.
    expect(rv.calls).toEqual([['zoomTo', STAIRS, undefined]])
    expect(rv.rig.getCamera().target).toEqual(SELECTION_BOX.getCenter(MOCK_BOX.min.clone()).toArray())
    expect([rv.rig.goal.theta, rv.rig.goal.phi]).toEqual([-Math.PI / 4, 1.05])
    st().select([STAIRS[0]], false)
    expect((await run('set_view', { fit: 'selection' })).message).toBe('Framed the selection — 1 element.')
  })

  it('zooms on the fit: a factor, and alone it fits the building', async () => {
    const body = await run('set_view', { zoom: 2 })
    expect(body.message).toBe('Framed the whole building. Zoom 2× the fit.')
    expect(rv.calls).toEqual([['zoomExtents', 2]])
    expect(rv.rig.goal.dist).toBeCloseTo(70.31 / 2, 2)
    // On the selection when that is what is framed.
    st().select(STAIRS, false)
    rv.calls.length = 0
    expect((await run('set_view', { fit: 'selection', zoom: 0.5 })).message).toBe(
      'Framed the selection — 3 elements. Zoom 0.5× the fit.'
    )
    expect(rv.calls).toEqual([['zoomTo', STAIRS, 0.5]])
    // 1 is the fit itself.
    await run('set_view', { zoom: 1 })
    expect(+rv.rig.goal.dist.toFixed(2)).toBe(70.31)
  })

  it('a direction with a fit is a click on the view cube', async () => {
    await run('set_view', { azimuth: 225, elevation: 35.2644, fit: 'extents' })
    expect(cameraCalls()).toEqual(['lookAlong', 'zoomExtents'])
    // The cube's north-east-top corner: look from (+1, +1, +1), framed on the building.
    const cube = bareRig()
    cube.viewDir(MOCK_BOX.min.clone().set(1, 1, 1))
    cube.fitBox(MOCK_BOX)
    const got = rv.rig.getCamera()
    const want = cube.getCamera()
    expect(wrapPi(got.theta - want.theta)).toBeCloseTo(0, 6)
    expect(got.phi).toBeCloseTo(want.phi, 6)
    expect([got.dist, got.target]).toEqual([want.dist, want.target])
  })

  it('refuses a named view together with a direction, in words, and moves nothing', async () => {
    const before = pose()
    const state = st()
    for (const input of [
      { view: 'north', azimuth: 45 },
      { view: 'top', elevation: 30 },
      { view: 'iso', azimuth: 315, elevation: 30, fit: 'extents' }
    ]) {
      const body = await run('set_view', input)
      expect(body.message).toBe(
        'A named view and a direction were both given, so nothing was changed: send view, or azimuth and elevation, not both.'
      )
      // The refusal still reads the camera back, as it stands.
      expect(body).toMatchObject({ view: 'iso', projection: 'persp', camera: { view: 'iso' } })
    }
    expect(pose()).toEqual(before)
    expect(st()).toBe(state)
    expect(cameraCalls()).toEqual([])
    expect(turn.acted).toBe(false)
  })

  it('a named view is still the toolbar’s button, and an explicit projection wins over the view’s own', async () => {
    const north = await run('set_view', { view: 'north' })
    expect(north.message).toBe('View set to north.')
    expect(cameraCalls()).toEqual(['setView'])
    // The design's rule: an elevation is orthographic. Nobody asked the tool for it.
    expect([st().view, st().proj]).toEqual(['north', 'ortho'])
    expect(north.camera).toEqual({ view: 'north', projection: 'ortho', azimuthDeg: 180, elevationDeg: 0 })

    rv.calls.length = 0
    const persp = await run('set_view', { view: 'east', projection: 'persp' })
    expect(persp.message).toBe('View set to east (persp).')
    // The view first, then the persp / ortho button's own toggle — the viewer's `setProjection`.
    expect(rv.calls).toEqual([['setView', 'east'], ['setProjection', 'persp']])
    expect([st().view, st().proj]).toEqual(['east', 'persp'])
    // With a fit on the selection, the named view is framed on it afterwards.
    st().select(STAIRS, false)
    rv.calls.length = 0
    expect((await run('set_view', { view: 'top', fit: 'selection' })).message).toBe(
      'View set to top. Framed the selection — 3 elements.'
    )
    expect(cameraCalls()).toEqual(['setView', 'zoomTo'])
    expect([st().view, st().proj, rv.rig.getCamera().target]).toEqual(['top', 'ortho', [22, 4, 5]])
    // A fit of the whole building is what the view has just done: it is not asked for twice.
    rv.calls.length = 0
    await run('set_view', { view: 'west', fit: 'extents' })
    expect(cameraCalls()).toEqual(['setView'])
  })

  it('is the view button when it is pressed again, the design’s own second framing included', async () => {
    // The design's rig sizes an orthographic view from the perspective distance when it swaps
    // the projection, and from the fit itself once it is orthographic — so a view button pressed
    // a second time reframes by a tenth. The tool is that button: it does the same, and says so.
    const button = bareRig()
    for (const [press, acted] of [[1, true], [2, true], [3, false]] as const) {
      button.setView('south')
      fresh()
      await run('set_view', { view: 'south' })
      expect([press, pose()]).toEqual([press, button.getCamera()])
      expect([press, turn.acted]).toEqual([press, acted])
    }
  })

  it('changes the projection through the persp / ortho button’s own toggle, only when it differs', async () => {
    const ortho = await run('set_view', { projection: 'ortho' })
    expect(ortho.message).toBe('View set (ortho).')
    expect(rv.calls).toEqual([['setProjection', 'ortho']])
    expect(st().proj).toBe('ortho')
    expect(turn.acted).toBe(true)
    // Already so: the toggle is not pressed a second time, and nothing is marked.
    fresh()
    rv.calls.length = 0
    const again = await run('set_view', { projection: 'ortho' })
    expect(again.projection).toBe('ortho')
    expect(rv.calls).toEqual([])
    expect(turn.acted).toBe(false)
    // A direction leaves the projection alone.
    await run('set_view', { azimuth: 10, elevation: 10 })
    expect(st().proj).toBe('ortho')
  })

  it('frames in the projection it was asked for: the swap comes before the fit', async () => {
    await run('set_view', { projection: 'ortho', fit: 'extents' })
    expect(cameraCalls()).toEqual(['setProjection', 'zoomExtents'])
    // What a double-click on empty space gives in an orthographic view — the fit's own half.
    const ortho = bareRig()
    ortho.setProjection('ortho')
    ortho.fitBox(MOCK_BOX)
    expect(pose()).toEqual(ortho.getCamera())
    // …and back: the perspective fit's own distance, not the swap's conversion of the half.
    await run('set_view', { projection: 'persp', zoom: 1 })
    expect(+rv.rig.goal.dist.toFixed(2)).toBe(70.31)
  })

  it('lands on the same camera the second time, and marks the turn only when the camera moved', async () => {
    for (const input of [
      { azimuth: 200, elevation: 15 },
      { fit: 'extents' },
      { projection: 'ortho', azimuth: 0, elevation: 90, fit: 'extents' },
      { zoom: 3 },
      { azimuth: 30, elevation: 45, fit: 'extents', zoom: 1.5, projection: 'persp' },
      { projection: 'ortho' }
    ]) {
      fresh()
      await run('set_view', input)
      const first = pose()
      const [view, proj] = [st().view, st().proj]
      fresh()
      await run('set_view', input)
      expect([input, pose()]).toEqual([input, first])
      expect([input, st().view, st().proj]).toEqual([input, view, proj])
      expect([input, turn.acted]).toEqual([input, false])
    }
    // An empty call says so, and is no change.
    fresh()
    expect((await run('set_view', {})).message).toBe('Nothing to change: pass a view, a direction, fit, zoom or projection.')
    expect(turn.acted).toBe(false)
  })

  it('the six presets, asked for as azimuth and elevation, land on the camera the view buttons give', async () => {
    for (const name of Object.keys(VIEW_DIRECTIONS)) {
      // The view button, on a rig of its own that starts where the tool's stands — the camera
      // the previous view left — and pressed until it settles: a press that swaps the projection
      // is sized by the swap, the next one by the fit (the test above), and the fit is what a
      // direction with `fit` asks for.
      const button = bareRig()
      button.setCamera(rv.rig.getCamera())
      button.setView(name)
      button.setView(name)
      const want = button.getCamera()
      // The tool, by the exact angles of that view, a fit and the view's projection.
      const { azimuthDeg, elevationDeg } = anglesOf(want.theta, want.phi)
      const body = await run('set_view', {
        azimuth: azimuthDeg,
        elevation: elevationDeg,
        fit: 'extents',
        projection: want.proj
      })
      const got = rv.rig.getCamera()
      expect([name, got.proj, got.target, got.dist, got.half]).toEqual([name, want.proj, want.target, want.dist, want.half])
      expect([name, +wrapPi(got.theta - want.theta).toFixed(9) + 0, +got.phi.toFixed(9)]).toEqual([
        name,
        0,
        +want.phi.toFixed(9)
      ])
      // …and it reads back as that view, at the angles the description quotes.
      const read = body.camera as { view: string; azimuthDeg: number; elevationDeg: number }
      expect([name, read.view]).toEqual([name, name])
      expect([name, read.azimuthDeg, read.elevationDeg]).toEqual([name, ...VIEW_DIRECTIONS[name]])
    }
  })

  it('reads back the named view when it is sent the description’s own numbers for it', async () => {
    // What a model does with "view:"iso" is 315 / 29.8": it sends those two numbers.
    for (const [name, [azimuth, elevation]] of Object.entries(VIEW_DIRECTIONS)) {
      await run('set_view', { azimuth: 123, elevation: 45 })
      const body = await run('set_view', { azimuth, elevation })
      expect([name, body.camera]).toEqual([
        name,
        { view: name, projection: st().proj, azimuthDeg: azimuth, elevationDeg: elevation }
      ])
    }
  })

  it('says so where there is no 3D view, and changes nothing', async () => {
    setViewer(null)
    const state = st()
    for (const input of [{ azimuth: 45 }, { fit: 'extents' }, { zoom: 2 }]) {
      const body = await run('set_view', input)
      expect(body.message).toBe('There is no 3D view to move the camera in — nothing changed.')
      expect(body).not.toHaveProperty('camera')
    }
    expect(st()).toBe(state)
    expect(turn.acted).toBe(false)
  })
})

/* ────────────────────────────── 2. viewpoints ────────────────────────────── */

describe('manage_views — the Viewpoints card', () => {
  const views = (): ShellState['views'] => st().views
  const stored = (): { name: string }[] => loadViews(viewsKeyFor(full.project.building))

  it('lists nothing, in words, before anything is saved', async () => {
    expect(await run('manage_views', { op: 'list' })).toEqual({
      message: 'There are no saved viewpoints.',
      viewpoints: [],
      total: 0,
      truncated: false
    })
    expect(turn.acted).toBe(false)
  })

  it('saves the view as it stands through the card’s own button, and names it when asked', async () => {
    const auto = await run('manage_views', { op: 'save' })
    expect(auto).toEqual({
      message: 'Saved the current view as "Viewpoint 1" (3D) — viewpoint 1 of 1.',
      saved: true,
      name: 'Viewpoint 1',
      number: 1,
      viewpoints: [{ number: 1, name: 'Viewpoint 1', sub: '3D', active: false }],
      total: 1,
      truncated: false
    })
    // What `saveView` saves: the camera the viewer has, and the state.
    expect(views()[0].cam).toEqual(rv.rig.getCamera())
    // The same record the button leaves.
    const byTool = { ...views()[0], id: 0 }
    st().saveView()
    expect({ ...views()[1], id: 0, name: 'Viewpoint 1' }).toEqual(byTool)

    await run('set_section', { kind: 'grid', name: 'C' })
    st().hide(STAIRS)
    const named = await run('manage_views', { op: 'save', name: '  Section C  ' })
    expect(named.message).toBe('Saved the current view as "Section C" (grid C · 3 hidden) — viewpoint 3 of 3.')
    expect(views().map((v) => v.name)).toEqual(['Viewpoint 1', 'Viewpoint 2', 'Section C'])
    // Persisted with the list, per building, as the card's own save and rename are.
    expect(stored().map((v) => v.name)).toEqual(['Viewpoint 1', 'Viewpoint 2', 'Section C'])
    // Saving changes nothing on screen, so it is not something a revert undoes.
    fresh()
    await run('manage_views', { op: 'save' })
    expect(turn.acted).toBe(false)
    expect(historyDepth().undo).toBe(1)
  })

  it('gives two viewpoints saved in the same instant ids of their own', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    await run('manage_views', { op: 'save', name: 'A' })
    await run('manage_views', { op: 'save', name: 'B' })
    await run('manage_views', { op: 'save' })
    vi.restoreAllMocks()
    expect(new Set(views().map((v) => v.id)).size).toBe(3)
    // …so a name given on save reaches the viewpoint just saved, not an older one of that id.
    expect(views().map((v) => v.name)).toEqual(['A', 'B', 'Viewpoint 3'])
  })

  it('restores one as a click on its row does: every key, the camera, and one undo entry', async () => {
    // Viewpoint 1: the boot view. Viewpoint 2: a section, something hidden, the north elevation.
    await run('manage_views', { op: 'save', name: 'Start' })
    await run('set_section', { kind: 'grid', name: 'C', offset: 500 })
    await run('set_storeys', { visible: ['L2'] })
    await run('toggle_display', { levels: true, grids: false })
    await run('set_view', { view: 'north' })
    await run('manage_views', { op: 'save', name: 'North at C' })
    const northCam = rv.rig.getCamera()
    // …and back to something else.
    await run('set_section', { kind: null })
    await run('apply_visibility', { action: 'reset' })
    await run('set_view', { view: 'iso' })
    fresh()
    other = []
    rv.calls.length = 0
    const depth = historyDepth().undo

    const body = await run('manage_views', { op: 'restore', name: 'north at c' })
    expect(body).toEqual({
      message: 'Restored "North at C" — 92 of 412 elements visible, section grid C.',
      applied: true,
      name: 'North at C',
      number: 2,
      visibleElements: 92,
      totalElements: 412,
      section: 'grid C'
    })
    const s = st()
    expect(s.sections.grid).toEqual({ name: 'C', offset: 500, flip: false, cut: true })
    expect(visibleIds()).toEqual(L2)
    expect([s.grids, s.levels, s.view, s.activeView]).toEqual([false, true, null, s.views[1].id])
    // The viewer is told as the card's click tells it — and the camera is the saved one.
    expect(cameraCalls()).toEqual(['setCamera'])
    expect(rv.rig.getCamera()).toEqual(northCam)
    expect(other.map((c) => c[0])).toEqual(['setGrids', 'setLevels', 'setSections'])
    // Exactly as a click does: it pushes undo first, so ⌘Z walks the visibility back.
    expect(historyDepth().undo).toBe(depth + 1)
    expect(turn.acted).toBe(true)
    st().step(true)
    expect(visible()).toBe(412)

    // The state it leaves is the state the click leaves.
    const byTool = { hidden: s.hidden, storeyVis: s.storeyVis, stack: s.stack, sections: s.sections, activeView: s.activeView }
    st().restoreView(st().views[0])
    st().restoreView(st().views[1])
    const c = st()
    expect({ hidden: c.hidden, storeyVis: c.storeyVis, stack: c.stack, sections: c.sections, activeView: c.activeView }).toEqual(byTool)
  })

  it('names a viewpoint by number, and by name exactly before case-insensitively', async () => {
    for (const name of ['Plan', 'plan', 'Roof']) await run('manage_views', { op: 'save', name })
    expect(((await run('manage_views', { op: 'restore', number: 3 })).name)).toBe('Roof')
    expect(st().activeView).toBe(views()[2].id)
    // "plan" is exactly the second; "PLAN" is two viewpoints at once.
    expect((await run('manage_views', { op: 'restore', name: 'plan' })).number).toBe(2)
    const both = await run('manage_views', { op: 'restore', name: 'PLAN' })
    expect(both.message).toBe(
      '2 viewpoints are called "PLAN" — numbers 1, 2. Pass number to say which. Nothing changed. ' +
        '3 saved viewpoints: 1. "Plan" (3D); 2. "plan" (3D) — restored last; 3. "Roof" (3D).'
    )
    expect(st().activeView).toBe(views()[1].id)
    // The list's own rows carry their numbers, so the next call can say which.
    expect((both.viewpoints as { number: number }[]).map((v) => v.number)).toEqual([1, 2, 3])
  })

  it('changes nothing for a name or a number that matches nothing, and returns the list', async () => {
    await run('manage_views', { op: 'save', name: 'Plan' })
    fresh()
    const before = st()
    const depth = historyDepth()
    const none = await run('manage_views', { op: 'restore', name: 'Elevation' })
    expect(none.message).toBe(
      'No viewpoint is called "Elevation". Nothing changed. 1 saved viewpoint: 1. "Plan" (3D).'
    )
    expect(none.viewpoints).toEqual([{ number: 1, name: 'Plan', sub: '3D', active: false }])
    expect((await run('manage_views', { op: 'rename', number: 4, to: 'x' })).message).toContain(
      'There is no viewpoint 4 — there is 1.'
    )
    expect((await run('manage_views', { op: 'restore' })).message).toContain(
      'Say which viewpoint: pass its name, or its number in the list.'
    )
    expect(st()).toBe(before)
    expect(historyDepth()).toEqual(depth)
    expect(turn.acted).toBe(false)
  })

  it('renames one through the card’s own action: trimmed, persisted, and nothing for the same name', async () => {
    await run('manage_views', { op: 'save' })
    await run('manage_views', { op: 'save' })
    const body = await run('manage_views', { op: 'rename', name: 'Viewpoint 2', to: '  Level 2 plan ' })
    expect(body.message).toBe('Renamed viewpoint 2 from "Viewpoint 2" to "Level 2 plan".')
    expect(body.renamed).toBe(true)
    expect(views().map((v) => v.name)).toEqual(['Viewpoint 1', 'Level 2 plan'])
    expect(stored().map((v) => v.name)).toEqual(['Viewpoint 1', 'Level 2 plan'])
    // The same list the double-click leaves.
    const byTool = views().map((v) => v.name)
    st().renameView(views()[1].id, 'x')
    st().renameView(views()[1].id, 'Level 2 plan')
    expect(views().map((v) => v.name)).toEqual(byTool)

    const list = views()
    expect((await run('manage_views', { op: 'rename', number: 2, to: 'Level 2 plan' })).message).toBe(
      'Viewpoint 2 is already called "Level 2 plan" — nothing changed.'
    )
    expect((await run('manage_views', { op: 'rename', number: 1, to: '   ' })).message).toBe(
      'Pass the new name in to — "Viewpoint 1" was not renamed.'
    )
    expect(views()).toBe(list)
    // A name is the list's, not the view's: nothing to revert.
    expect(turn.acted).toBe(false)
  })

  it('holds a restore that would hide down to under 5 %, or to nothing, behind Apply — and the click is the row’s', async () => {
    await run('manage_views', { op: 'save', name: 'Everything' })
    st().isolate(STAIRS) // the user's own right-click Isolate: 3 of 412
    st().saveView()
    st().hide(STAIRS) // …and those hidden too: nothing at all
    st().saveView()
    st().showAll()
    fresh()
    const before = st()
    const depth = historyDepth()

    const few = await run('manage_views', { op: 'restore', number: 2 })
    expect(few).toEqual({
      message:
        'Needs confirmation: restoring "Viewpoint 2" would leave only 3 of 412 elements visible. The user has been shown an Apply button — tell them briefly what is waiting.',
      applied: false,
      pending: true,
      name: 'Viewpoint 2',
      number: 2,
      wouldLeaveVisible: 3,
      totalElements: 412
    })
    // Held as an action, by the viewpoint's own id (phase 3) — nothing was restored.
    const held = turn.pending!
    expect(held).toEqual({
      label: 'restore the viewpoint "Viewpoint 2" — leaves 3 of 412 visible',
      action: { kind: 'restore_view', id: st().views[1].id }
    })
    expect(st()).toBe(before)
    expect(historyDepth()).toEqual(depth)
    expect(turn.acted).toBe(false)
    expect(cameraCalls()).toEqual([])

    // A view left with nothing in it is held the same way: it is a viewpoint the user saved.
    fresh()
    const blank = await run('manage_views', { op: 'restore', number: 3 })
    expect(blank).toMatchObject({ applied: false, pending: true, wouldLeaveVisible: 0 })
    expect(turn.pending!.label).toBe('restore the viewpoint "Viewpoint 3" — leaves 0 of 412 visible')
    expect(st()).toBe(before)

    // The user's click on Apply is the click on the card's row: the same state, one undo entry.
    st().chatFinish('…', { pending: held }, st().chatBegin('q', null))
    const at = st().chatMsgs.length - 1
    st().applyPending(at)
    expect(visible()).toBe(3)
    expect(st().activeView).toBe(st().views[1].id)
    expect(historyDepth().undo).toBe(depth.undo + 1)
    expect(st().chatMsgs[at].undoSnap?.changed).toEqual(['vis', 'camera'])
    // …and from there, a restore that only reveals is free.
    fresh()
    const back = await run('manage_views', { op: 'restore', name: 'Everything' })
    expect(back).toMatchObject({ applied: true, visibleElements: 412 })
  })

  it('frames the building for a viewpoint whose camera was recorded against another frame, and says so', async () => {
    await run('manage_views', { op: 'save', name: 'Old' })
    // The list is what `localStorage` held: one saved before the federation's frame was this one.
    useShell.setState({ views: st().views.map((v) => ({ ...v, frame: '1.000,2.000,3.000@12.5000' })) })
    rv.calls.length = 0
    const body = await run('manage_views', { op: 'restore', name: 'Old' })
    expect(body.message).toBe(
      'Restored "Old" — 412 of 412 elements visible. Its camera was recorded against a different model, so the whole building is framed instead.'
    )
    expect(body.cameraRestored).toBe(false)
    expect(cameraCalls()).toEqual(['frameExtents'])
  })

  it('is bounded: twenty rows a list, a clipped name, and no more than fifty viewpoints saved by a tool', async () => {
    for (let i = 0; i < VIEWPOINTS_CAP + 3; i++) st().saveView()
    st().renameView(st().views[0].id, 'N'.repeat(VIEW_NAME_MAX + 50))
    const list = await run('manage_views', { op: 'list' })
    expect(list.viewpoints).toHaveLength(VIEWPOINTS_CAP)
    expect(list).toMatchObject({ total: VIEWPOINTS_CAP + 3, truncated: true })
    expect((list.viewpoints as { name: string }[])[0].name).toBe('N'.repeat(VIEW_NAME_MAX) + '…')
    expect(String(list.message)).toContain('; … 3 more.')
    // A name longer than the list shows is reached by its number: the clipped text the list
    // gave is not its name, and the description says so.
    const clipped = (list.viewpoints as { name: string }[])[0].name
    const missed = await run('manage_views', { op: 'restore', name: clipped })
    expect(String(missed.message)).toContain('No viewpoint is called "')
    expect(st().activeView).toBeNull()
    expect((await run('manage_views', { op: 'restore', number: 1 })).applied).toBe(true)
    expect(st().activeView).toBe(st().views[0].id)
    // A viewpoint past the listed twenty is still found by its number, and by its name.
    expect((await run('manage_views', { op: 'restore', number: VIEWPOINTS_CAP + 2 })).applied).toBe(true)
    expect((await run('manage_views', { op: 'restore', name: `Viewpoint ${VIEWPOINTS_CAP + 3}` })).number).toBe(VIEWPOINTS_CAP + 3)

    // The card's button has no limit; a tool that can be called in a loop has one.
    while (st().views.length < VIEWPOINTS_SAVE_CAP) st().saveView()
    const full50 = await run('manage_views', { op: 'save', name: 'One more' })
    expect(full50.message).toBe(
      `There are already ${VIEWPOINTS_SAVE_CAP} saved viewpoints, so nothing was saved — the user can save one from the Viewpoints card, or delete some there first.`
    )
    expect(st().views).toHaveLength(VIEWPOINTS_SAVE_CAP)
    // A name too long for the assistant to give is refused before anything is saved.
    useShell.setState({ views: [] })
    expect((await run('manage_views', { op: 'save', name: 'x'.repeat(VIEW_NAME_MAX + 1) })).message).toBe(
      `A viewpoint's name is at most ${VIEW_NAME_MAX} characters — nothing was saved.`
    )
    expect(st().views).toEqual([])
  })

  it('cannot delete one: `delete` only asks (phase 3), and no other word removes', async () => {
    await run('manage_views', { op: 'save' })
    const asked = await run('manage_views', { op: 'delete', number: 1 })
    expect(asked).toMatchObject({ applied: false, pending: true })
    expect(turn.pending!.action).toEqual({ kind: 'delete_view', id: st().views[0].id })
    await expect(run('manage_views', { op: 'remove', number: 1 })).rejects.toThrow(/manage_views: op/)
    expect(st().views).toHaveLength(1)
  })
})

/* ────────────────────────────── 3. markups ────────────────────────────── */

describe('manage_markups — the Markups card, read', () => {
  const MEASURES: MeasureRecord[] = [
    { id: 11, p: [1, 2, 3], x: 4.5, y: 9.025, z: 2.7 },
    // A ray that hit nothing has no reading: only X here.
    { id: 12, p: [4, 5, 6], x: 1.234 }
  ]
  const SPOTS: SpotRecord[] = [
    // The repository's synthetic coordinates, never a real site's.
    { id: 21, p: [7, 8, 9], E: 12345.457, N: 23456.766, Z: 5.05, x: 10, y: 20, z: 5.05 },
    // No base point: the card prints dashes, and the tag in the view prints the file's own level.
    { id: 22, p: [1, 1, 1], E: null, N: null, Z: null, x: 10, y: 20, z: 3.2 }
  ]
  const place = (): void => {
    st().setMeasures(MEASURES)
    st().setSpots(SPOTS)
  }

  it('says there are none before any is placed', async () => {
    expect(await run('manage_markups', { op: 'list' })).toEqual({
      // (Phase 4: and the assistant can place one, so the sentence says how.)
      message:
        'There are no markups — the user places them by clicking the model with the laser meter or the spot tool, and place_spot or place_measure places one at a point you name.',
      units: 'mm',
      measures: [],
      spots: [],
      measuresTotal: 0,
      spotsTotal: 0,
      truncated: false
    })
  })

  it('lists what the card shows: each measurement’s X, Y and Z in the card’s unit, each spot’s E, N, Z or its level', async () => {
    place()
    const mm = await run('manage_markups', { op: 'list' })
    expect(mm).toEqual({
      message: '2 laser measurements (M1–M2, lengths in mm) and 2 spot coordinates (C1–C2, in metres).',
      units: 'mm',
      measures: [
        { name: 'M1', x: 4500, y: 9025, z: 2700 },
        { name: 'M2', x: 1234 }
      ],
      spots: [
        { name: 'C1', E: 12345.457, N: 23456.766, Z: 5.05 },
        { name: 'C2', level: 3.2 }
      ],
      measuresTotal: 2,
      spotsTotal: 2,
      truncated: false
    })
    // The numbers are the card's own: its rows, read back.
    const rows = measureRows(st().measures, 'mm')
    expect(rows.map((r) => r.n)).toEqual(['M1', 'M2'])
    expect(rows[0].v).toBe(`X ${mmv(4.5)}   Y ${mmv(9.025)}   Z ${mmv(2.7)}`)
    expect(rows[0].v.replace(/[^\d ]/g, '').trim().split(/\s{2,}/).map((x) => Number(x.replace(/\D/g, '')))).toEqual([4500, 9025, 2700])
    expect(spotRows(st().spots)[0].v).toBe(`${fixed3(12345.457)} E · ${fixed3(23456.766)} N · ${fixed3(5.05)} Z`)

    // The card's m toggle: metres, to three decimals.
    st().setUnits('m')
    const m = await run('manage_markups', { op: 'list' })
    expect(m.units).toBe('m')
    expect(m.measures).toEqual([
      { name: 'M1', x: 4.5, y: 9.025, z: 2.7 },
      { name: 'M2', x: 1.234 }
    ])
    expect(m.message).toContain('lengths in m)')
    // A read: nothing changed, nothing to revert.
    expect(turn.acted).toBe(false)
    expect(cameraCalls()).toEqual([])
  })

  it('is bounded: fifty of each, and it says it cut', async () => {
    st().setMeasures(Array.from({ length: MARKUPS_CAP + 10 }, (_, i) => ({ id: i, p: [i, 0, 0] as [number, number, number], x: 1 })))
    const body = await run('manage_markups', { op: 'list' })
    expect(body.measures).toHaveLength(MARKUPS_CAP)
    expect(body).toMatchObject({ measuresTotal: MARKUPS_CAP + 10, spotsTotal: 0, truncated: true })
    expect(body.message).toBe(
      `${MARKUPS_CAP + 10} laser measurements (M1–M${MARKUPS_CAP + 10}, lengths in mm). The first ${MARKUPS_CAP} of each are listed.`
    )
    expect(JSON.stringify(body).length).toBeLessThan(2500)
  })

  it('zooms to one through the card’s own tag, named as the card names it', async () => {
    place()
    const body = await run('manage_markups', { op: 'focus', name: 'm2' })
    expect(body).toEqual({ message: 'Zoomed to M2.', focused: 'M2' })
    expect(rv.calls).toEqual([['focusPoint', [4, 5, 6]]])
    expect(rv.rig.getCamera().target).toEqual([4, 5, 6])
    expect(turn.acted).toBe(true)
    // The camera is already there the second time: nothing to revert.
    fresh()
    await run('manage_markups', { op: 'focus', name: 'M2' })
    expect(turn.acted).toBe(false)
    // A spot, and with a space as a person might type it.
    rv.calls.length = 0
    expect((await run('manage_markups', { op: 'focus', name: 'C 1' })).focused).toBe('C1')
    expect(rv.calls).toEqual([['focusPoint', [7, 8, 9]]])
    // The lists are the user's: neither is touched.
    expect(st().measures).toBe(MEASURES)
    expect(st().spots).toBe(SPOTS)
  })

  it('changes nothing for a name that is not there, and returns the lists', async () => {
    place()
    rv.calls.length = 0
    const missing = await run('manage_markups', { op: 'focus', name: 'M9' })
    expect(missing.message).toBe(
      'There is no M9. Nothing changed. 2 laser measurements (M1–M2, lengths in mm) and 2 spot coordinates (C1–C2, in metres).'
    )
    expect((missing.measures as unknown[]).length).toBe(2)
    expect((await run('manage_markups', { op: 'focus', name: 'X1' })).message).toContain(
      '"X1" is not a markup\'s name — they are M1, M2 … and C1, C2 ….'
    )
    expect((await run('manage_markups', { op: 'focus' })).message).toContain(
      'Say which markup: pass its name as the card shows it, e.g. M2 or C1.'
    )
    expect((await run('manage_markups', { op: 'focus', name: 'M0' })).message).toContain('There is no M0.')
    expect(rv.calls).toEqual([])
    expect(turn.acted).toBe(false)
  })

  it('cannot delete, clear or place one: `delete` and `clear` only ask (phase 3), and nothing places', async () => {
    place()
    for (const op of ['remove', 'place', 'add']) {
      await expect(run('manage_markups', { op })).rejects.toThrow(/manage_markups: op/)
    }
    expect((await run('manage_markups', { op: 'delete', name: 'M1' })).pending).toBe(true)
    fresh()
    expect((await run('manage_markups', { op: 'clear', kind: 'spots' })).pending).toBe(true)
    expect([st().measures.length, st().spots.length]).toEqual([2, 2])
    // The lists are the user's: neither was touched, and the viewer was told nothing.
    expect(st().measures).toBe(MEASURES)
    expect(st().spots).toBe(SPOTS)
    expect(rv.calls).toEqual([])
  })
})

/* ────────────────────────────── 4. one filter step, in place ────────────────────────────── */

describe('manage_filters — update changes one step where it stands', () => {
  /** The stack a user built by hand: an isolate, a hide switched off, a highlight in a picked colour. */
  const build = (): void => {
    st().addStep('isolate', [is('Level', 'L2')])
    st().addStep('hide', [is('IfcEntity', 'IfcDoor')])
    st().addStep('highlight', [is('IfcEntity', 'IfcWindow')])
    st().updStep(st().stack[1].id, { on: false })
    st().setStepColor(st().stack[2].id, '#D96BD0')
    fresh()
    other = []
  }
  const shape = (): unknown[] => st().stack.map((x) => [x.id, x.on, x.action, x.color])

  it('changes a step’s colour through the card’s swatch, and nothing else about the stack', async () => {
    build()
    const before = st().stack
    const body = await run('manage_filters', { op: 'update', step: 3, color: '#E05A6B' })
    expect(body).toEqual({
      message: 'Step 3 updated: colour #E05A6B. 92 of 412 visible.',
      applied: true,
      step: 3,
      enabled: true,
      action: 'highlight',
      label: 'IfcEntity = IfcWindow',
      color: '#E05A6B',
      matched: body.matched,
      visibleElements: 92,
      totalElements: 412
    })
    // The step keeps its id; the other two are the very same objects.
    expect(st().stack[2]).toEqual({ ...before[2], color: '#E05A6B' })
    expect([st().stack[0], st().stack[1]]).toEqual([before[0], before[1]])
    expect(st().stack[0]).toBe(before[0])
    // `setStepColor` records the colour and tells the viewer, as the swatch does.
    expect(st().hlColor).toBe('#E05A6B')
    expect(other).toEqual([['setHighlightColor', '#E05A6B']])
    expect(turn.acted).toBe(true)
  })

  it('changes a step’s rules and keeps its id, its place, the other steps’ colours and the off switch', async () => {
    build()
    const was = shape()
    const body = await run('manage_filters', { op: 'update', step: 1, rules: [is('Level', 'L3')] })
    expect(body.message).toBe(`Step 1 updated: rules now Level = L3. ${L3.length} of 412 visible.`)
    expect(body).toMatchObject({ applied: true, step: 1, action: 'isolate', label: 'Level = L3', matched: L3.length })
    expect(visibleIds()).toEqual(L3)
    expect(shape()).toEqual(was)
    expect(st().stack[0].rules).toEqual([is('Level', 'L3')])
    // What rebuilding the stack would have done instead: new ids, every step on, fresh colours.
    const rebuilt = fstack.applyFilterSet({ id: 1, label: 'x', stack: st().stack }).stack
    expect(rebuilt.map((x) => x.on)).toEqual([true, true, true])
    expect(rebuilt.map((x) => x.id)).not.toEqual(st().stack.map((x) => x.id))
    expect(rebuilt[2].color).not.toBe('#D96BD0')
    // One undo entry, and ⌘Z puts the rules back.
    st().step(true)
    expect(visibleIds()).toEqual(L2)
  })

  it('changes a step’s action, and all three at once — the colour as a second undo entry, like the two clicks', async () => {
    build()
    const depth = historyDepth().undo
    const action = await run('manage_filters', { op: 'update', step: 3, action: 'hide' })
    // The L2 storey without its windows.
    const left = L2.length - idsOf((e) => e.type === 'IfcWindow' && e.storey === 'L2').length
    expect(left).toBeLessThan(L2.length)
    expect(action.message).toBe(`Step 3 updated: action highlight → hide. ${left} of 412 visible.`)
    // A hide step tints nothing, so no colour is reported for it.
    expect(action).not.toHaveProperty('color')
    expect(st().stack[2]).toMatchObject({ action: 'hide', color: '#D96BD0' })
    expect(historyDepth().undo).toBe(depth + 1)

    const all = await run('manage_filters', {
      op: 'update',
      step: 3,
      action: 'highlight',
      rules: [is('IfcEntity', 'IfcDoor')],
      color: '#6BC96B'
    })
    expect(all.message).toBe(
      'Step 3 updated: action hide → highlight, rules now IfcEntity = IfcDoor, colour #6BC96B. 92 of 412 visible.'
    )
    expect(st().stack[2]).toMatchObject({ action: 'highlight', color: '#6BC96B', rules: [is('IfcEntity', 'IfcDoor')] })
    expect(historyDepth().undo).toBe(depth + 3)
    // The same stack the card's own three controls leave.
    const byTool = st().stack
    st().step(true)
    st().step(true)
    st().updStep(st().stack[2].id, { action: 'highlight' })
    st().setStepRules(st().stack[2].id, [is('IfcEntity', 'IfcDoor')])
    st().setStepColor(st().stack[2].id, '#6BC96B')
    expect(st().stack).toEqual(byTool)
  })

  it('writes nothing for a step that is already as asked, or for a call that names no field', async () => {
    build()
    const before = st()
    const depth = historyDepth()
    const same = await run('manage_filters', {
      op: 'update',
      step: 3,
      action: 'highlight',
      color: '#D96BD0',
      rules: st().stack[2].rules
    })
    expect(same.message).toBe('Step 3 is already as asked — nothing changed.')
    expect(same).toMatchObject({ applied: false, step: 3, color: '#D96BD0' })
    const none = await run('manage_filters', { op: 'update', step: 1 })
    expect(none.message).toBe('Nothing to update: pass action, rules or color for step 1. Nothing changed.')
    const unknown = await run('manage_filters', { op: 'update', step: 9, action: 'hide' })
    expect(unknown.message).toContain('No step 9.')
    expect(st()).toBe(before)
    expect(historyDepth()).toEqual(depth)
    expect(other).toEqual([])
    expect(turn.acted).toBe(false)
    // Only what differs is written: the same colour sent with a new action is one undo entry.
    await run('manage_filters', { op: 'update', step: 3, action: 'hide', color: '#D96BD0' })
    expect(historyDepth().undo).toBe(depth.undo + 1)
    expect(other).toEqual([])
  })

  it('runs the scope guard: an update that would leave nothing visible is refused', async () => {
    build()
    const before = st()
    const body = await run('manage_filters', { op: 'update', step: 1, rules: [is('IfcEntity', 'IfcTeleporter')] })
    expect(body).toMatchObject({ applied: false, wouldLeaveVisible: 0, totalElements: 412 })
    expect(String(body.message)).toContain('Updating step 1 would leave nothing visible, so it was not done.')
    expect(String(body.message)).toContain('1. isolate — IfcEntity = IfcTeleporter')
    expect(st()).toBe(before)
    expect(turn.pending).toBeNull()
    expect(turn.acted).toBe(false)
  })

  it('holds an update that would leave under 5 % behind Apply, with the stack the card’s actions would write', async () => {
    build()
    const was = shape()
    const body = await run('manage_filters', {
      op: 'update',
      step: 1,
      rules: [is('IfcEntity', 'IfcDoor'), is('Level', 'L2')],
      action: 'isolate'
    })
    expect(body).toMatchObject({ applied: false, pending: true, wouldLeaveVisible: 4, totalElements: 412 })
    expect(visible()).toBe(92)
    expect(turn.pending!.label).toBe('updating step 1 — leaves 4 of 412 visible')
    expect(Object.keys(turn.pending!.patch!)).toEqual(['stack'])
    // Apply hands the patch to `up()`: the step's id, the off switch and the picked colour kept.
    const id = st().stack[0].id
    st().up(turn.pending!.patch!)
    expect(visibleIds()).toEqual(DOORS_L2)
    expect(shape()).toEqual(was)
    const byPatch = st().stack
    st().step(true)
    st().setStepRules(id, [is('IfcEntity', 'IfcDoor'), is('Level', 'L2')])
    expect(st().stack).toEqual(byPatch)
  })

  it('never holds an update that takes nothing out of view', async () => {
    // A view the user already took under 5 %: three stairs.
    st().addStep('isolate', [is('IfcEntity', 'IfcStair')])
    st().addStep('isolate', [is('IfcEntity', 'IfcStair')])
    st().updStep(st().stack[1].id, { on: false })
    fresh()
    expect(visible()).toBe(3)
    // A step that is switched off changes nothing on screen, whatever it is made into.
    const off = await run('manage_filters', { op: 'update', step: 2, rules: [is('IfcEntity', 'IfcTeleporter')] })
    expect(off.applied).toBe(true)
    expect(String(off.message)).toContain('The step is switched off, so nothing on screen changed.')
    // An isolate turned into a highlight only reveals.
    const reveal = await run('manage_filters', { op: 'update', step: 1, action: 'highlight' })
    expect(reveal).toMatchObject({ applied: true, visibleElements: 412 })
    // A colour hides nothing, in any view.
    expect((await run('manage_filters', { op: 'update', step: 1, color: '#7B8CF0' })).applied).toBe(true)
    expect(turn.pending).toBeNull()
  })

  it('says what the key does carry when the new rules match nothing, and that a colour needs a highlight', async () => {
    build()
    const miss = await run('manage_filters', { op: 'update', step: 3, rules: [is('IfcEntity', 'IfcTeleporter')] })
    expect(miss).toMatchObject({ applied: true, matched: 0 })
    expect(String(miss.message)).toContain('Nothing has IfcEntity = IfcTeleporter; IfcEntity carries')
    expect(miss.valid_values).toBeDefined()
    const coloured = await run('manage_filters', { op: 'update', step: 1, color: '#7B8CF0' })
    expect(coloured.message).toBe('Step 1 updated: colour #7B8CF0. 92 of 412 visible. A colour shows only on a highlight step.')
    expect(coloured).not.toHaveProperty('color')
  })

  it('reads a property name in the new rules as the file spells it', async () => {
    build()
    const body = await run('manage_filters', { op: 'update', step: 1, rules: [is('fire rating', '2 HR')] })
    expect(body.resolvedKeys).toEqual({ 'fire rating': 'FireRating' })
    expect(st().stack[0].rules[0].prop).toBe('FireRating')
  })
})

describe('set_filter_stack — a colour per step', () => {
  it('gives a step the swatch it names, and the next unused one to a step that names none', async () => {
    const body = await run('set_filter_stack', {
      steps: [
        { action: 'highlight', rules: [is('IfcEntity', 'IfcDoor')], color: '#E05A6B' },
        { action: 'highlight', rules: [is('IfcEntity', 'IfcWindow')] },
        { action: 'highlight', rules: [is('IfcEntity', 'IfcStair')], color: '#E05A6B' }
      ]
    })
    expect(body.applied).toBe(true)
    // The second is the first of the six not taken; two steps may be asked to share a colour.
    expect(st().stack.map((x) => x.color)).toEqual(['#E05A6B', HL[0], '#E05A6B'])
    expect(HL[0]).not.toBe('#E05A6B')
    // …and without any `color` it is exactly what it was: each step the next colour that neither
    // the live stack (the design's seed — here it holds HL[2] and HL[0]) nor an earlier step uses.
    await run('set_filter_stack', {
      steps: [
        { action: 'highlight', rules: [is('IfcEntity', 'IfcDoor')] },
        { action: 'highlight', rules: [is('IfcEntity', 'IfcWindow')] }
      ]
    })
    expect(st().stack.map((x) => x.color)).toEqual([HL[1], HL[3]])
    await expect(
      run('set_filter_stack', { steps: [{ action: 'highlight', rules: [], color: 'red' }] })
    ).rejects.toThrow(/set_filter_stack: steps/)
  })
})

/* ────────────────────────────── 5. what the ticker says ────────────────────────────── */

describe('the ticker words the new calls as what they do', () => {
  it('has a phrase for each new tool, and one for each operation that phrase would misstate', () => {
    expect(toolPhrase('manage_views')).toBe('reading the saved viewpoints')
    expect(toolPhrase('manage_views', { op: 'list' })).toBe('reading the saved viewpoints')
    expect(toolPhrase('manage_views', { op: 'save' })).toBe('saving a viewpoint')
    expect(toolPhrase('manage_views', { op: 'restore', name: 'x' })).toBe('restoring a viewpoint')
    expect(toolPhrase('manage_views', { op: 'rename' })).toBe('renaming a viewpoint')
    expect(toolPhrase('manage_markups')).toBe('reading the markups')
    expect(toolPhrase('manage_markups', { op: 'focus', name: 'M1' })).toBe('zooming to a markup')
    expect(toolPhrase('manage_filters', { op: 'update', step: 1 })).toBe('changing a filter step')
    expect(toolPhrase('manage_filters', { op: 'move' })).toBe('rearranging filter steps')
    // The camera's phrase fits every way it can be moved.
    expect(toolPhrase('set_view', { azimuth: 45, fit: 'extents' })).toBe('moving the camera')
    expect(noteFor('manage_views', { op: 'restore' })).toBe('Restoring a viewpoint')
  })

  it('cannot be made to throw by an input', () => {
    for (const input of [null, undefined, 7, [], { op: null }, { op: {} }, { op: ['save'] }]) {
      for (const name of ['manage_views', 'manage_markups', 'manage_filters', 'set_view']) {
        expect(() => toolPhrase(name, input as never)).not.toThrow()
      }
    }
  })
})

describe('nothing in this phase hides without the guard, or takes more than it is given', () => {
  it('leaves the undo stack and the visible set alone for every camera, viewpoint-list and markup call', async () => {
    st().setMeasures([{ id: 1, p: [1, 2, 3], x: 1 }])
    const calls: [string, unknown][] = [
      ['set_view', { azimuth: 120, elevation: 20 }],
      ['set_view', { fit: 'extents', zoom: 2 }],
      ['set_view', { view: 'west' }],
      ['manage_views', { op: 'save', name: 'A' }],
      ['manage_views', { op: 'list' }],
      ['manage_views', { op: 'rename', name: 'A', to: 'B' }],
      ['manage_markups', { op: 'list' }],
      ['manage_markups', { op: 'focus', name: 'M1' }]
    ]
    for (const [name, input] of calls) await run(name, input)
    expect(visibleIds()).toEqual(ALL)
    expect(historyDepth()).toEqual({ undo: 0, redo: 0 })
    expect(turn.pending).toBeNull()
  })
})
