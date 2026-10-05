/**
 * The chat's per-turn **revert**, widened — 2026-10-02, owner-approved. Asked whether the chat's
 * revert should restore everything the assistant changed in that reply rather than visibility
 * only: *"correct."*
 *
 * The design's revert put back the five visibility keys. The assistant now also cuts sections,
 * moves the camera, switches the display, colours models, selects, and changes the app's own
 * settings, so a reply's `revert` puts back **what that reply changed** — every part of the
 * review state, and only the parts its own tool calls touched (`state/selectors/snapshot.ts`).
 *
 * A turn here runs as `ai/bridge.ts` runs one: `chatBegin` takes the snapshot, every call goes
 * through `executeTool` with the turn's accumulators, `chatFinish` commits the reply. The viewer
 * is a stub whose camera is the real rig (`rig-viewer.ts`), so "the camera was put back" is the
 * pose itself.
 *
 * Phase 3, the same day: **the base point is a part.** The assistant can ask to change it, the
 * user's Apply changes it, and what an Apply changed joins the reply's undo — so `revert` puts
 * the old base point back. What a revert cannot put back is what was deleted, which is why a
 * deletion is asked for and never done by a tool.
 */
import { Vector3 } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate, removeModel, ID_STRIDE } from '../../src/shared/federate'
import { visFn, type Rule } from '../../src/shared/rules'
import { renumberId, slotMapOf } from '../../src/shared/session-codec'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { executeTool, newTurnState, type ToolContext, type TurnState } from '../../src/renderer/ai/executors'
import { CONNECT_WAIT_MS } from '../../src/renderer/ai/executors/schedule'
import {
  NOT_REVERTED,
  TURN_PARTS,
  changedParts,
  mergeUndo,
  revertNote,
  revertPlan,
  sessionSource,
  turnSnapshot,
  turnUndo,
  withParts,
  type TurnPart,
  type TurnSnapshot
} from '../../src/renderer/state/selectors/snapshot'
import { chatRow } from '../../src/renderer/state/selectors/chat'
import { historyDepth, setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { MOCK_BOX, rigViewer, type RigViewer } from './rig-viewer'
import { memoryStorage, resetShell } from './stub-viewer'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const full = federate(KEYS.map((k) => mockModelIndex(k)))

const st = (): ShellState => useShell.getState()
const is = (prop: string, val: string): Rule => ({ prop, op: '=', val })
const idsOf = (
  pred: (e: (typeof full.elements)[number]) => boolean,
  from: ShellState['federation'] = full
): number[] => from.elements.filter(pred).map((e) => e.id)
const visible = (): number => st().federation.elements.filter(visFn(st())).length
const hiddenIds = (): number[] => Object.keys(st().hidden).map(Number).sort((a, b) => a - b)

const STAIRS = idsOf((e) => e.type === 'IfcStair')
const STR_COLUMNS = idsOf((e) => e.model === 'STR' && e.type === 'IfcColumn')
const ARC_DOORS = idsOf((e) => e.model === 'ARC' && e.type === 'IfcDoor')

let rv: RigViewer
/** What the viewer was told beside its camera, in order. */
let told: [string, ...unknown[]][] = []
const VIEWER_CALLS = [
  'setGrids',
  'setLevels',
  'setShadows',
  'setSnap',
  'setGroundGrid',
  'setModelColors',
  'setHighlightColor',
  'setSections',
  'setSelected',
  'setTheme',
  'setTool',
  'setPickable'
]
const toldNames = (): string[] => told.map((c) => c[0])
const cameraCalls = (): string[] => rv.calls.map((c) => c[0])

/** The whole review state as a revert sees it, by value — and the store's own projection. */
const everything = (): unknown =>
  JSON.parse(JSON.stringify([turnSnapshot(st(), rv.rig.getCamera()), st().proj, st().sel]))

type Call = [name: string, input: unknown]

/**
 * One turn, as the bridge runs it. `meanwhile` is the user's own hand while the reply is being
 * written — after the calls, before the reply is committed. Returns the reply's index.
 */
const contextOf = (turn: TurnState): ToolContext => ({
  state: () => useShell.getState(),
  sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
  rawLine: async () => null,
  turn
})

async function reply(calls: readonly Call[], meanwhile?: () => void): Promise<number> {
  const before = st().chatBegin('q', null)
  const turn: TurnState = newTurnState()
  const ctx = contextOf(turn)
  for (const [name, input] of calls) await executeTool(name, input, ctx)
  meanwhile?.()
  st().chatFinish('done', { ...turn }, before)
  return st().chatMsgs.length - 1
}
const changedBy = (at: number): readonly TurnPart[] | null => st().chatMsgs[at].undoSnap?.changed ?? null
/** Does the panel draw `revert` on that reply? The row's own rule (`selectors/chat.ts`). */
const offersRevert = (at: number): boolean => chatRow(st().chatMsgs[at], at).canRevert

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  told = []
  rv = rigViewer(
    Object.fromEntries(
      VIEWER_CALLS.map((name) => [name, (...args: unknown[]) => void told.push([name, ...args])])
    )
  )
  setViewer(rv.viewer)
  st().commitModels(full)
  told = []
  rv.calls.length = 0
})
afterEach(() => {
  setViewer(null)
  vi.unstubAllGlobals()
})

/* ────────────────────────────── the parts ────────────────────────────── */

describe('the review state, cut into parts', () => {
  const PARTS = Object.entries(TURN_PARTS) as [TurnPart, { payload?: readonly string[]; extra?: readonly string[] }][]
  const partsOf = (key: string, where: 'payload' | 'extra'): TurnPart[] =>
    PARTS.filter(([, spec]) => (spec[where] ?? []).includes(key)).map(([name]) => name)

  it('puts every key a session saves in exactly one part, or says why it is never reverted', () => {
    // `sessionSource` returns a `SessionSource`, so a key added to the session does not compile
    // until it is read off the store there — and does not pass here until it has a part.
    const source = Object.keys(sessionSource(st()))
    expect(source.length).toBeGreaterThan(15)
    for (const key of source) {
      const parts = partsOf(key, 'payload')
      expect([key, parts.length]).toEqual([key, key in NOT_REVERTED ? 0 : 1])
    }
    // Phase 3: `coords` — the base point — is a part now. What is left follows the federation,
    // which only the user's own click loads or unloads.
    expect(Object.keys(NOT_REVERTED).sort()).toEqual(['uploadNames'])
    for (const key of Object.keys(NOT_REVERTED)) expect(source).toContain(key)
    expect(partsOf('coords', 'payload')).toEqual(['basePoint'])
  })

  it('covers what a payload adds to that — the camera and the legacy section — and nothing else', () => {
    const snap = turnSnapshot(st(), rv.rig.getCamera())
    const source = Object.keys(sessionSource(st()))
    const added = Object.keys(snap.payload).filter((k) => !source.includes(k)).sort()
    expect(added).toEqual(['cam', 'files', 'frame', 'models', 'section'])
    expect(partsOf('cam', 'payload')).toEqual(['camera'])
    expect(partsOf('section', 'payload')).toEqual(['sections'])
    // Where the snapshot was taken, not review state: no part.
    for (const key of ['files', 'frame', 'models']) expect(partsOf(key, 'payload')).toEqual([])
    // A snapshot never leaves the window: it names no file.
    expect(snap.payload.files).toEqual([])
  })

  it('puts everything else the assistant can change in exactly one part', () => {
    const snap = turnSnapshot(st(), null)
    const extra = Object.keys(snap.extra)
    expect(extra.sort()).toEqual(
      ['activeView', 'card', 'colorBy', 'groundGrid', 'panelOpen', 'search', 'selIds', 'tool', 'units'].sort()
    )
    for (const key of extra) expect([key, partsOf(key, 'extra').length]).toEqual([key, 1])
  })

  it('names no key that is not there', () => {
    const snap = turnSnapshot(st(), rv.rig.getCamera())
    for (const [name, spec] of PARTS) {
      for (const key of spec.payload ?? []) expect([name, Object.keys(snap.payload)]).toEqual([name, expect.arrayContaining([key])])
      for (const key of spec.extra ?? []) expect([name, Object.keys(snap.extra)]).toEqual([name, expect.arrayContaining([key])])
      expect([name, (spec.payload ?? []).length + (spec.extra ?? []).length]).not.toEqual([name, 0])
    }
  })

  it('keeps the five visibility keys together, as the design restored them', () => {
    expect([...TURN_PARTS.vis.payload].sort()).toEqual(['active', 'hidden', 'modelVis', 'stack', 'storeyVis'])
  })
})

describe('what changed between two snapshots', () => {
  const at = (patch: Partial<ShellState> = {}, cam = rv.rig.getCamera()): TurnSnapshot =>
    turnSnapshot({ ...st(), ...patch }, cam)

  it('is nothing for the same state, by identity or by value', () => {
    expect(changedParts(at(), at())).toEqual([])
    // The store rebuilds some objects on a restore: the same value is the same state.
    expect(changedParts(at(), at({ hidden: {}, sections: JSON.parse(JSON.stringify(st().sections)) }))).toEqual([])
  })

  it('names the part of each key, in the table’s order', () => {
    const one: [Partial<ShellState>, TurnPart][] = [
      [{ hidden: { 5: true } }, 'vis'],
      [{ storeyVis: { L1: false } }, 'vis'],
      [{ modelVis: { MEP: false } }, 'vis'],
      [{ active: 'STR' }, 'vis'],
      [{ stack: [{ id: 'a', on: true, action: 'hide', color: '#35C4B6', rules: [] }] }, 'vis'],
      [{ sections: { ...st().sections, grid: { name: 'C', offset: 0, flip: false, cut: true } } }, 'sections'],
      [{ view: null }, 'camera'],
      [{ activeView: 7 }, 'camera'],
      [{ grids: !st().grids }, 'grids'],
      [{ levels: !st().levels }, 'levels'],
      [{ shadows: !st().shadows }, 'shadows'],
      [{ dims: !st().dims }, 'dims'],
      [{ snap: !st().snap }, 'snap'],
      [{ groundGrid: !st().groundGrid }, 'groundGrid'],
      [{ modelColors: { ARC: '#E05A6B' } }, 'colours'],
      [{ nativeMats: !st().nativeMats }, 'colours'],
      [{ hlColor: '#E05A6B' }, 'hlColor'],
      [{ colorBy: { prop: 'Level', groups: [] } }, 'colorBy'],
      [{ selIds: [1] }, 'selection'],
      [{ theme: 'light' }, 'theme'],
      [{ treeMode: 'type' }, 'treeMode'],
      [{ units: 'm' }, 'units'],
      [{ panelOpen: !st().panelOpen }, 'sidebar'],
      [{ card: 'filter' }, 'card'],
      [{ tool: 'measure' }, 'tool'],
      [{ search: 'wall' }, 'search'],
      [{ coords: { ...st().coords, E: 99 } }, 'basePoint']
    ]
    for (const [patch, part] of one) expect([patch, changedParts(at(), at(patch))]).toEqual([patch, [part]])
    // The camera's own pose, and its projection, are the camera part.
    const cam = rv.rig.getCamera()
    expect(changedParts(at(), at({}, { ...cam, theta: cam.theta + 0.1 }))).toEqual(['camera'])
    expect(changedParts(at(), at({}, { ...cam, proj: 'ortho' }))).toEqual(['camera'])
    // Several at once come in the table's order, whatever order they were made in.
    expect(changedParts(at(), at({ search: 'x', theme: 'light', hidden: { 5: true }, grids: !st().grids }))).toEqual([
      'vis',
      'grids',
      'theme',
      'search'
    ])
    // What is never reverted is never a change.
    expect(changedParts(at(), at({ uploadNames: { x: 'y' } }))).toEqual([])
  })

  it('turnUndo keeps the parts the reply’s own calls changed, and is null when none is left', () => {
    const before = at()
    const after = at({ hidden: { 5: true }, theme: 'light' }, { ...rv.rig.getCamera(), dist: 5 })
    expect(turnUndo(before, after)).toEqual({ before, changed: ['vis', 'camera', 'theme'] })
    // The user orbited meanwhile: the camera is not the reply's.
    expect(turnUndo(before, after, ['vis', 'theme'])?.changed).toEqual(['vis', 'theme'])
    // A part a call changed and changed back needs nothing.
    expect(turnUndo(before, after, ['grids'])).toBeNull()
    expect(turnUndo(before, at())).toBeNull()
    expect(turnUndo(before, after, [])).toBeNull()
  })

  it('withParts takes the named parts and leaves the rest', () => {
    const base = at({ theme: 'light', hidden: { 5: true } })
    const from = at({ theme: 'dark', hidden: {}, search: 'x' })
    const mixed = withParts(base, from, ['vis'])
    expect([mixed.payload.hidden, mixed.payload.theme, mixed.extra.search]).toEqual([{}, 'light', ''])
    expect(mixed.models).toBe(base.models)
  })

  it('mergeUndo joins an Apply to what the reply had already changed', () => {
    const before = at()
    const afterReply = at({ grids: !st().grids })
    const afterApply = at({ grids: !st().grids, hidden: { 5: true } })
    const earlier = turnUndo(before, afterReply)!
    // Both, in the table's order, with the values from before the reply.
    const both = mergeUndo(earlier, afterReply, afterApply)!
    expect(both.changed).toEqual(['vis', 'grids'])
    expect([both.before.payload.grids, both.before.payload.hidden]).toEqual([st().grids, {}])
    // Nothing earlier: the Apply's own. Nothing applied: the earlier one, untouched.
    expect(mergeUndo(null, afterReply, afterApply)).toEqual({ before: afterReply, changed: ['vis'] })
    expect(mergeUndo(earlier, afterReply, afterReply)).toBe(earlier)
    expect(mergeUndo(null, afterReply, afterReply)).toBeNull()
    // Recorded against other models: two numberings cannot share a snapshot.
    const moved = { ...afterReply, models: afterReply.models.slice(1) }
    expect(mergeUndo(earlier, moved, { ...afterApply, models: moved.models })?.changed).toEqual(['vis'])
  })
})

describe('element ids across a federation change', () => {
  const rec = (key: string, slot: number, sha256 = ''): { key: string; sha256: string; slot: number } => ({ key, sha256, slot })

  it('moves an id from the slot its model had to the slot it has now', () => {
    const { slots, gone } = slotMapOf([rec('ARC', 0), rec('STR', 1)], [rec('STR', 0), rec('ARC', 3)])
    expect([...slots]).toEqual([[0, 3], [1, 0]])
    expect(gone).toEqual([])
    expect(renumberId(ID_STRIDE + 42, slots)).toBe(42)
    expect(renumberId(42, slots)).toBe(3 * ID_STRIDE + 42)
    expect(renumberId(7 * ID_STRIDE + 1, slots)).toBeNull()
  })

  it('knows a model that has gone, and one replaced by a changed file, from one that only moved', () => {
    const { slots, gone } = slotMapOf(
      [rec('ARC', 0, 'aa'), rec('STR', 1, 'bb'), rec('MEP', 2, 'cc')],
      // ARC unloaded and its slot taken by another file; STR picked again from a changed file.
      [rec('SIT', 0, 'dd'), rec('STR', 1, 'b2'), rec('MEP', 2, 'cc')]
    )
    expect(gone).toEqual(['ARC', 'STR'])
    expect([...slots]).toEqual([[2, 2]])
    // "The id still exists" proves nothing: slot 0 is another model's now.
    expect(renumberId(5, slots)).toBeNull()
  })
})

describe('revertPlan — what a revert does, against the state as it is now', () => {
  const at = (patch: Partial<ShellState> = {}, cam = rv.rig.getCamera()): TurnSnapshot =>
    turnSnapshot({ ...st(), ...patch }, cam)

  it('hands back the changed parts as they were and everything else as it stands', () => {
    const before = at({ hidden: { 5: true }, theme: 'dark', grids: true })
    const live = at({ hidden: {}, theme: 'light', grids: false, search: 'wall' })
    const plan = revertPlan({ before, changed: ['vis'] }, live)
    expect(plan.payload.hidden).toEqual({ 5: true })
    expect([plan.payload.theme, plan.payload.grids]).toEqual(['light', false])
    expect(plan.extra).toEqual({})
    expect(plan.lost).toEqual({ models: [], camera: false })
  })

  it('withholds the camera and the shadows unless they are what changed', () => {
    const before = at({ shadows: true })
    const live = at({ shadows: false }, { ...rv.rig.getCamera(), dist: 9 })
    // The restore path acts on their presence: a camera present is flown to.
    const vis = revertPlan({ before, changed: ['vis'] }, live).payload
    expect(vis.cam).toBeNull()
    expect('shadows' in vis).toBe(false)
    const both = revertPlan({ before, changed: ['camera', 'shadows'] }, live).payload
    expect(both.cam).toEqual(rv.rig.getCamera())
    expect(both.shadows).toBe(true)
    expect(both.frame).toBe(before.payload.frame)
  })

  it('leaves the camera where it is when the scene is not the one it was recorded in', () => {
    const before = at({ view: 'north', activeView: 3 })
    for (const live of [
      at({ offset: [100, 0, 0], view: null, activeView: null }),
      { ...at({ view: null, activeView: null }), payload: { ...at({ view: null }).payload, frame: 'another' } }
    ]) {
      const plan = revertPlan({ before, changed: ['camera', 'grids'] }, live)
      expect(plan.payload.cam).toBeNull()
      // The lit view button and the marked viewpoint belong to the camera: they stay too.
      expect([plan.payload.view, plan.extra.activeView]).toEqual([null, null])
      expect(plan.lost).toEqual({ models: [], camera: true })
    }
    // A snapshot taken where there was no camera has none to lose.
    const none = revertPlan({ before: at({}, null as never), changed: ['camera'] }, at({ offset: [1, 0, 0] }))
    expect(none.lost.camera).toBe(false)
  })

  it('says what could not be put back, in the panel’s words', () => {
    expect(revertNote({ models: [], camera: false })).toBe('')
    expect(revertNote({ models: ['STR'], camera: false })).toBe(
      'STR is no longer loaded, so nothing of it could be put back. Everything else was reverted.'
    )
    expect(revertNote({ models: ['STR', 'MEP'], camera: true })).toBe(
      'STR and MEP are no longer loaded, so nothing of them could be put back. The camera was left where it is: the model stands somewhere else than it did then. Everything else was reverted.'
    )
    // A key is a file's stem: clipped, and a long list is counted.
    const note = revertNote({ models: ['a'.repeat(60), 'b', 'c', 'd', 'e'], camera: false })
    expect(note).toBe(`${'a'.repeat(40)}…, b, c and 2 more are no longer loaded, so nothing of them could be put back. Everything else was reverted.`)
    expect(revertNote({ models: [], camera: true })).toBe(
      'The camera was left where it is: the model stands somewhere else than it did then. Everything else was reverted.'
    )
  })
})

/* ────────────────────────────── each kind of state ────────────────────────────── */

interface Kind {
  name: string
  /** What the user had before the turn, where the defaults would not show a change. */
  setup?: () => void | Promise<void>
  calls: () => readonly Call[]
  /** The reply only asked: nothing changes until the user clicks Apply, which this case does. */
  applied?: true
  /** The parts that reply changed — what its `revert` puts back. */
  parts: readonly TurnPart[]
  /** The piece of state the case is about. */
  read: () => unknown
}

const KINDS: Kind[] = [
  {
    name: 'elements hidden',
    calls: () => [['apply_visibility', { action: 'hide', ids: ARC_DOORS }]],
    parts: ['vis'],
    read: () => st().hidden
  },
  {
    name: 'elements hidden by a rule, which is a filter step',
    calls: () => [['apply_visibility', { action: 'hide', rules: [is('IfcEntity', 'IfcDoor')] }]],
    parts: ['vis'],
    read: () => st().stack
  },
  {
    name: 'storeys',
    calls: () => [['set_storeys', { visible: ['L1', 'L2'] }]],
    parts: ['vis'],
    read: () => st().storeyVis
  },
  {
    name: 'a model’s eye',
    calls: () => [['set_models', { visible: ['ARC', 'STR', 'SIT'] }]],
    parts: ['vis'],
    read: () => st().modelVis
  },
  {
    name: 'activate mode',
    calls: () => [['activate_model', { key: 'STR' }]],
    parts: ['vis'],
    read: () => st().active
  },
  {
    name: 'the filter stack',
    calls: () => [['set_filter_stack', { steps: [{ action: 'hide', rules: [is('Level', 'L2')] }] }]],
    parts: ['vis'],
    read: () => st().stack
  },
  {
    // Like a click on a grid bubble, `set_section` opens the Section card: that is the reply's too.
    name: 'a section, and the card it opens',
    calls: () => [['set_section', { kind: 'grid', name: 'C', offset: 250 }]],
    parts: ['sections', 'card'],
    read: () => [st().sections, st().card]
  },
  {
    name: 'a second section plane beside the user’s own, the card already open',
    setup: () => st().setSec('grid', { name: 'B', offset: 0, cut: true }, true),
    calls: () => [['set_section', { kind: 'level', name: 'L2' }]],
    parts: ['sections'],
    read: () => st().sections
  },
  {
    name: 'the camera’s direction',
    calls: () => [['set_view', { azimuth: 45, elevation: 30 }]],
    parts: ['camera'],
    read: () => [rv.rig.getCamera(), st().view]
  },
  {
    name: 'a named view, which is also a projection',
    calls: () => [['set_view', { view: 'north' }]],
    parts: ['camera'],
    read: () => [rv.rig.getCamera(), st().view, st().proj]
  },
  {
    name: 'the projection alone',
    calls: () => [['set_view', { projection: 'ortho' }]],
    parts: ['camera'],
    read: () => [rv.rig.getCamera().proj, st().proj]
  },
  {
    name: 'a fit and a zoom',
    setup: () => rv.rig.dolly(0.3, null),
    calls: () => [['set_view', { fit: 'extents', zoom: 2 }]],
    parts: ['camera'],
    read: () => rv.rig.getCamera()
  },
  {
    name: 'the camera, by a markup zoomed to',
    setup: () => st().setMeasures([{ id: 1, p: [3, 4, 5], x: 1 }]),
    calls: () => [['manage_markups', { op: 'focus', name: 'M1' }]],
    parts: ['camera'],
    read: () => rv.rig.getCamera()
  },
  {
    name: 'gridlines',
    calls: () => [['toggle_display', { grids: !st().grids }]],
    parts: ['grids'],
    read: () => st().grids
  },
  {
    name: 'levels',
    calls: () => [['toggle_display', { levels: !st().levels }]],
    parts: ['levels'],
    read: () => st().levels
  },
  {
    name: 'shadows',
    calls: () => [['toggle_display', { shadows: !st().shadows }]],
    parts: ['shadows'],
    read: () => st().shadows
  },
  {
    name: 'selection dimensions',
    calls: () => [['toggle_display', { dims: !st().dims }]],
    parts: ['dims'],
    read: () => st().dims
  },
  {
    name: 'snap',
    calls: () => [['toggle_display', { snap: !st().snap }]],
    parts: ['snap'],
    read: () => st().snap
  },
  {
    name: 'the canvas grid',
    calls: () => [['toggle_display', { groundGrid: !st().groundGrid }]],
    parts: ['groundGrid'],
    read: () => st().groundGrid
  },
  {
    name: 'original materials',
    calls: () => [['toggle_display', { originalMaterials: !st().nativeMats }]],
    parts: ['colours'],
    read: () => st().nativeMats
  },
  {
    name: 'a model’s colour',
    calls: () => [['color_models', { map: { ARC: '#E05A6B' } }]],
    parts: ['colours'],
    read: () => [st().modelColors, st().nativeMats]
  },
  {
    name: 'a model’s colour, over the user’s own',
    setup: () => st().setModelColor('ARC', '#35C4B6'),
    calls: () => [['color_models', { map: { ARC: '#E05A6B', STR: '#7B8CF0' } }]],
    parts: ['colours'],
    read: () => st().modelColors
  },
  {
    name: 'colour by a property',
    calls: () => [['color_by_property', { property: 'IfcEntity' }]],
    parts: ['colorBy'],
    read: () => st().colorBy
  },
  {
    name: 'the user’s colour-by, replaced',
    setup: () => void st().setColorBy('Level'),
    calls: () => [['color_by_property', { property: 'IfcEntity' }]],
    parts: ['colorBy'],
    read: () => st().colorBy
  },
  {
    name: 'the user’s colour-by, cleared',
    setup: () => void st().setColorBy('Level'),
    calls: () => [['color_by_property', { property: null }]],
    parts: ['colorBy'],
    read: () => st().colorBy
  },
  {
    name: 'the selection',
    calls: () => [['select_elements', { rules: [is('IfcEntity', 'IfcStair')], zoom: false }]],
    parts: ['selection'],
    read: () => [st().selIds, st().sel]
  },
  {
    // A selection zooms to itself unless told not to — the design's own default.
    name: 'the user’s selection, replaced and zoomed to',
    setup: () => st().select(ARC_DOORS.slice(0, 2)),
    calls: () => [['select_elements', { rules: [is('IfcEntity', 'IfcStair')] }]],
    parts: ['camera', 'selection'],
    read: () => [st().selIds, st().sel, rv.rig.getCamera()]
  },
  {
    name: 'the theme',
    calls: () => [['set_interface', { theme: 'light' }]],
    parts: ['theme'],
    read: () => st().theme
  },
  {
    name: 'the units',
    calls: () => [['set_interface', { units: 'm' }]],
    parts: ['units'],
    read: () => st().units
  },
  {
    name: 'the tree’s grouping',
    calls: () => [['set_interface', { treeMode: 'type' }]],
    parts: ['treeMode'],
    read: () => st().treeMode
  },
  {
    name: 'the sidebar',
    calls: () => [['set_interface', { sidebar: st().panelOpen ? 'collapsed' : 'open' }]],
    parts: ['sidebar'],
    read: () => st().panelOpen
  },
  {
    name: 'a card opened',
    calls: () => [['set_interface', { card: 'filter' }]],
    parts: ['card'],
    read: () => st().card
  },
  {
    name: 'the user’s card closed',
    setup: () => st().openCard('views'),
    calls: () => [['set_interface', { card: 'none' }]],
    parts: ['card'],
    read: () => st().card
  },
  {
    name: 'the user’s card swapped for another',
    setup: () => st().openCard('views'),
    calls: () => [['set_interface', { card: 'section' }]],
    parts: ['card'],
    read: () => st().card
  },
  {
    name: 'the armed tool',
    calls: () => [['set_interface', { tool: 'measure' }]],
    parts: ['tool'],
    read: () => st().tool
  },
  {
    name: 'the tree’s search',
    calls: () => [['set_interface', { search: 'wall' }]],
    parts: ['search'],
    read: () => st().search
  },
  {
    name: 'every interface setting at once',
    calls: () => [
      ['set_interface', { theme: 'light', units: 'm', treeMode: 'type', sidebar: 'collapsed', card: 'coords', tool: 'spot', search: 'slab' }]
    ],
    parts: ['theme', 'treeMode', 'units', 'sidebar', 'card', 'tool', 'search'],
    read: () => [st().theme, st().units, st().treeMode, st().panelOpen, st().card, st().tool, st().search]
  },
  {
    name: 'a filter step’s colour',
    setup: () => st().addStep('highlight', [is('IfcEntity', 'IfcWindow')]),
    calls: () => [['manage_filters', { op: 'update', step: 1, color: '#E05A6B' }]],
    parts: ['vis', 'hlColor'],
    read: () => [st().stack, st().hlColor]
  },
  {
    name: 'a filter step’s rules',
    setup: () => st().addStep('isolate', [is('Level', 'L2')]),
    calls: () => [['manage_filters', { op: 'update', step: 1, rules: [is('Level', 'L3')] }]],
    parts: ['vis'],
    read: () => st().stack
  },
  {
    name: 'a viewpoint restored',
    setup: async () => {
      // A viewpoint of the user's: a section, one storey, levels on, the north elevation…
      st().setSec('grid', { name: 'C', offset: 0, cut: true })
      st().up({ storeyVis: { L1: false, L3: false, L4: false, RF: false } })
      st().toggleLevels()
      st().setView('north')
      st().saveView()
      // …and then back to the view as it boots.
      st().clearSections()
      st().up({ storeyVis: {} })
      st().toggleLevels()
      st().setView('iso')
    },
    calls: () => [['manage_views', { op: 'restore', number: 1 }]],
    parts: ['vis', 'sections', 'camera', 'levels'],
    read: () => [st().sections, st().storeyVis, st().levels, st().view, st().activeView, rv.rig.getCamera()]
  },
  {
    // Phase 3. The tool changes nothing — it asks; the user's Apply types the numbers in, and
    // that joins the reply's undo. The Coordinate-system card has no reset of its own.
    name: 'the base point, changed by the user’s Apply on a request',
    setup: () => {
      st().setCoord('E', '12345.457')
      st().setCoord('N', '23456.766')
    },
    calls: () => [['request_user_action', { action: 'set_base_point', E: 28500, angle: 12.5 }]],
    applied: true,
    parts: ['basePoint'],
    read: () => st().coords
  },
  {
    name: 'several tools in one reply',
    calls: () => [
      ['set_section', { kind: 'level', name: 'L2' }],
      ['toggle_display', { levels: !st().levels, shadows: !st().shadows }],
      ['set_view', { view: 'top' }],
      ['apply_visibility', { action: 'hide', rules: [is('IfcEntity', 'IfcSlab')] }],
      ['select_elements', { rules: [is('IfcEntity', 'IfcStair')] }],
      ['color_by_property', { property: 'Level' }],
      ['set_interface', { theme: 'light', card: 'section' }]
    ],
    parts: ['vis', 'sections', 'camera', 'levels', 'shadows', 'colorBy', 'selection', 'theme', 'card'],
    read: () => everything()
  }
]

describe('a reply’s revert puts back what that reply changed', () => {
  for (const kind of KINDS) {
    it(kind.name, async () => {
      await kind.setup?.()
      const was = everything()
      const wasRead = JSON.parse(JSON.stringify(kind.read()))

      const at = await reply(kind.calls())
      if (kind.applied) {
        // Asked, not done: the state is as it was, and the reply has nothing to revert yet.
        expect(JSON.parse(JSON.stringify(kind.read()))).toEqual(wasRead)
        expect(offersRevert(at)).toBe(false)
        st().applyPending(at)
      }
      // The reply did change it, and its undo names exactly the parts it changed.
      expect(JSON.parse(JSON.stringify(kind.read()))).not.toEqual(wasRead)
      expect(changedBy(at)).toEqual(kind.parts)
      expect(offersRevert(at)).toBe(true)
      const depth = historyDepth().undo

      st().revertTurn(at)
      // All of it is back — the store, the camera, the projection.
      expect(everything()).toEqual(was)
      expect(st().chatMsgs[at].reverted).toBe(true)
      expect(offersRevert(at)).toBe(false)
      // The snapshot goes with the control: nothing of the old state is held any longer.
      expect(st().chatMsgs[at].undoSnap).toBeNull()
      expect(st().chatErr).toBe('')
      // Visibility still goes on the undo stack, as it always did. Nothing else is on that stack.
      expect(historyDepth().undo).toBe(depth + (kind.parts.includes('vis') ? 1 : 0))
    })
  }

  it('covers every part', () => {
    const covered = new Set(KINDS.flatMap((k) => k.parts))
    expect(Object.keys(TURN_PARTS).filter((p) => !covered.has(p as TurnPart))).toEqual([])
  })

  it('tells the viewer, through the app’s own restore path', async () => {
    const at = await reply([
      ['toggle_display', { grids: !st().grids, shadows: !st().shadows, groundGrid: !st().groundGrid }],
      ['set_section', { kind: 'grid', name: 'C' }],
      ['set_view', { view: 'north' }],
      ['select_elements', { rules: [is('IfcEntity', 'IfcStair')] }],
      ['set_interface', { theme: 'light', tool: 'measure' }]
    ])
    const [grids, shadows, groundGrid] = [!st().grids, !st().shadows, !st().groundGrid]
    told = []
    rv.calls.length = 0
    st().revertTurn(at)
    // `applySession`: the theme first, then `RESTORE_ORDER` — sections before the camera, the
    // camera before nothing else moves it.
    const names = toldNames()
    expect(names.indexOf('setTheme')).toBeLessThan(names.indexOf('setGrids'))
    expect(names.indexOf('setSections')).toBeGreaterThan(names.indexOf('setGrids'))
    expect(names.indexOf('setShadows')).toBeGreaterThan(names.indexOf('setSections'))
    expect(told.find((c) => c[0] === 'setTheme')).toEqual(['setTheme', 'dark'])
    expect(told.find((c) => c[0] === 'setGrids')).toEqual(['setGrids', grids])
    expect(told.find((c) => c[0] === 'setShadows')).toEqual(['setShadows', shadows])
    expect(told.find((c) => c[0] === 'setGroundGrid')).toEqual(['setGroundGrid', groundGrid])
    expect(told.find((c) => c[0] === 'setTool')).toEqual(['setTool', 'select'])
    expect(told.filter((c) => c[0] === 'setSelected').pop()).toEqual(['setSelected', []])
    // The camera is flown back by the session's own step, once.
    expect(cameraCalls()).toEqual(['setCamera'])
    expect(st().proj).toBe('persp')
  })
})

/* ────────────────────────────── only what it changed ────────────────────────────── */

describe('…and nothing it did not change', () => {
  it('leaves what the user did afterwards to every other part', async () => {
    const at = await reply([['apply_visibility', { action: 'hide', rules: [is('IfcEntity', 'IfcDoor')] }]])
    expect(changedBy(at)).toEqual(['vis'])
    // The user carries on: orbits, turns the grids off, selects, goes light, opens a card.
    rv.rig.orbit(200, 40, null)
    rv.rig.dolly(0.5, null)
    st().toggleGrids()
    st().select(STAIRS)
    st().setTheme('light')
    st().openCard('filter')
    st().setShadows(!st().shadows)
    const mine = { cam: rv.rig.getCamera(), grids: st().grids, selIds: st().selIds, shadows: st().shadows }
    told = []
    rv.calls.length = 0

    st().revertTurn(at)
    expect(visible()).toBe(412)
    expect(rv.rig.getCamera()).toEqual(mine.cam)
    expect([st().grids, st().selIds, st().theme, st().card, st().shadows]).toEqual([mine.grids, mine.selIds, 'light', 'filter', mine.shadows])
    // Not flown anywhere, the shadow map not redrawn, the selection not made again.
    expect(cameraCalls()).toEqual([])
    expect(toldNames()).not.toContain('setShadows')
    expect(toldNames()).not.toContain('setSelected')
    expect(toldNames()).not.toContain('setTheme')
  })

  it('leaves the user’s later hiding alone when the reply only moved the camera', async () => {
    const start = rv.rig.getCamera()
    const at = await reply([['set_view', { view: 'north' }]])
    st().hide(STAIRS)
    st().toggleLevels()
    const depth = historyDepth().undo
    st().revertTurn(at)
    expect(rv.rig.getCamera()).toEqual(start)
    expect([st().view, st().proj]).toEqual(['iso', 'persp'])
    expect(hiddenIds()).toEqual(STAIRS)
    expect(st().levels).toBe(true)
    // Nothing of the visibility was touched, so nothing went on the undo stack.
    expect(historyDepth().undo).toBe(depth)
  })

  it('does not fly the camera back when it was the user who orbited while the reply was written', async () => {
    const at = await reply(
      [['apply_visibility', { action: 'hide', rules: [is('IfcEntity', 'IfcDoor')] }]],
      () => {
        rv.rig.orbit(120, 0, null)
        st().toggleGrids()
      }
    )
    // The state differs in three parts; one of them is the reply's.
    expect(changedBy(at)).toEqual(['vis'])
    const mine = rv.rig.getCamera()
    const grids = st().grids
    st().revertTurn(at)
    expect(visible()).toBe(412)
    expect(rv.rig.getCamera()).toEqual(mine)
    expect(st().grids).toBe(grids)
  })

  it('counts only its own change when a call waits on the Schedules window: what the user does meanwhile is theirs', async () => {
    vi.useFakeTimers()
    try {
      // The bridge's `openSchedules` is left pending, as it is while the window opens.
      let opened: () => void = () => undefined
      vi.stubGlobal('window', { sgvue: { openSchedules: () => new Promise<void>((done) => (opened = done)) } })
      const before = st().chatBegin('q', null)
      const turn = newTurnState()
      const call = executeTool('set_interface', { theme: 'light', schedulesWindow: 'open' }, contextOf(turn))
      // The theme is set at once; the call is now waiting for the window.
      expect(st().theme).toBe('light')
      // Meanwhile the user orbits and switches the gridlines off.
      rv.rig.orbit(150, 20, null)
      st().toggleGrids()
      const mine = { cam: rv.rig.getCamera(), grids: st().grids }
      opened()
      await vi.advanceTimersByTimeAsync(CONNECT_WAIT_MS)
      const body = (await call) as { changed: string[] }
      expect(body.changed).toEqual(['theme light'])

      // `set_interface` measured around its own synchronous block, and that is what is used —
      // a measurement around the whole call would have named the camera and the gridlines too.
      expect(turn.parts).toEqual(['theme'])
      st().chatFinish('done', { ...turn }, before)
      const at = st().chatMsgs.length - 1
      expect(changedBy(at)).toEqual(['theme'])
      st().revertTurn(at)
      expect(st().theme).toBe('dark')
      expect(rv.rig.getCamera()).toEqual(mine.cam)
      expect(st().grids).toBe(mine.grids)
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts the camera back when the reply moved it, wherever the user took it afterwards', async () => {
    const start = rv.rig.getCamera()
    const at = await reply([['set_view', { azimuth: 90, elevation: 10 }]], () => rv.rig.orbit(60, 10, null))
    expect(changedBy(at)).toEqual(['camera'])
    rv.rig.dolly(0.5, null)
    st().revertTurn(at)
    expect(rv.rig.getCamera()).toEqual(start)
    expect(st().view).toBe('iso')
  })
})

describe('a section put back does not move a camera that was not the reply’s', () => {
  type Plane = { kind: string; name: string; cut?: boolean; flip?: boolean } | null
  /**
   * The real viewer's rule (`viewer/section.ts`, the design's L253), which the plain stub does
   * not have: a plane that starts cutting — or changes kind, name or flip while it cuts —
   * re-aims the camera at itself, and that unlights the toolbar's view button (`on.cubeView`).
   */
  const withReaim = (): void => {
    let prev: Record<string, Plane> = { grid: null, level: null }
    rv = rigViewer({
      setSections: (cfg: Record<string, Plane>) => {
        told.push(['setSections', cfg])
        const moved = (['grid', 'level'] as const).find((slot) => {
          const [c, was] = [cfg[slot], prev[slot]]
          return (
            !!c &&
            c.cut !== false &&
            (!was || was.cut === false || was.kind !== c.kind || was.name !== c.name || !!was.flip !== !!c.flip)
          )
        })
        prev = cfg
        if (!moved) return
        rv.rig.viewDir(moved === 'grid' ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1))
        rv.rig.fitBox(MOCK_BOX)
        st().clearView()
      }
    })
    setViewer(rv.viewer)
  }

  it('re-aims for the reply’s own cut — so the camera is the reply’s too, and flies back', async () => {
    withReaim()
    const start = rv.rig.getCamera()
    const at = await reply([['set_section', { kind: 'grid', name: 'C' }]])
    expect(rv.rig.getCamera()).not.toEqual(start)
    expect(st().view).toBeNull()
    expect(changedBy(at)).toEqual(['sections', 'camera', 'card'])
    st().revertTurn(at)
    // Clearing a plane re-aims nothing; the camera is put back by the restore's own camera step.
    expect(st().sections.grid.name).toBe('')
    expect(rv.rig.getCamera()).toEqual(start)
    expect([st().view, st().card]).toEqual(['iso', null])
  })

  it('leaves the camera and the lit view where the user has them when the reply only cleared a cut', async () => {
    withReaim()
    // The user's own: a cut at C (which re-aims), then the north elevation, then closer in.
    st().setSec('grid', { name: 'C', offset: 250, cut: true })
    st().setView('north')
    rv.rig.dolly(0.5, null)
    const mine = rv.rig.getCamera()
    const at = await reply([['set_section', { kind: 'grid', name: '' }]])
    expect(st().sections.grid.name).toBe('')
    expect(changedBy(at)).toEqual(['sections'])
    expect(rv.rig.getCamera()).toEqual(mine)

    st().revertTurn(at)
    // The plane cuts again — which, in the viewer, turns the camera to face it. It is turned
    // back before a frame is drawn, and the view button stays lit.
    expect(st().sections.grid).toMatchObject({ name: 'C', offset: 250, cut: true })
    expect(rv.rig.getCamera()).toEqual(mine)
    expect(st().view).toBe('north')
    expect(st().proj).toBe('ortho')
  })

  it('puts back the cut, the camera and the lit view together when all three were the reply’s', async () => {
    withReaim()
    st().setSec('grid', { name: 'C', offset: 0, cut: true })
    st().setView('north')
    const mine = rv.rig.getCamera()
    const at = await reply([
      ['set_section', { kind: null }],
      ['set_view', { view: 'iso' }]
    ])
    expect(changedBy(at)).toEqual(['sections', 'camera'])
    expect([st().view, st().proj]).toEqual(['iso', 'persp'])
    st().revertTurn(at)
    expect(st().sections.grid).toMatchObject({ name: 'C', cut: true })
    expect(rv.rig.getCamera()).toEqual(mine)
    expect([st().view, st().proj]).toEqual(['north', 'ortho'])
  })

  it('hands the camera to the restore path only beside a section', () => {
    const at = (patch: Partial<ShellState> = {}): TurnSnapshot => turnSnapshot({ ...st(), ...patch }, rv.rig.getCamera())
    const before = at({ sections: { ...st().sections, grid: { name: 'C', offset: 0, flip: false, cut: true } } })
    const live = at({ hidden: { 5: true } })
    expect(revertPlan({ before, changed: ['sections'] }, live).payload.cam).toEqual(rv.rig.getCamera())
    expect(revertPlan({ before, changed: ['vis', 'grids'] }, live).payload.cam).toBeNull()
    // A camera that could not be put back is left standing in the same way.
    const moved = at({ offset: [5, 0, 0] })
    const lost = revertPlan({ before, changed: ['sections', 'camera'] }, moved)
    expect(lost.payload.cam).toEqual(rv.rig.getCamera())
    expect(lost.payload.frame).toBe(moved.payload.frame)
  })
})

describe('revert is offered exactly on a reply that changed something it can put back', () => {
  it('not on a reply that only read', async () => {
    const at = await reply([
      ['get_view_state', {}],
      ['query_elements', { rules: [is('IfcEntity', 'IfcDoor')] }],
      ['manage_views', { op: 'list' }],
      ['manage_markups', { op: 'list' }]
    ])
    expect(st().chatMsgs[at].undoSnap).toBeNull()
    expect(offersRevert(at)).toBe(false)
    // …even when the user changed something by hand meanwhile.
    const second = await reply([['get_view_state', {}]], () => st().hide(STAIRS))
    expect(st().chatMsgs[second].undoSnap).toBeNull()
  })

  it('not on one that changed something and changed it back', async () => {
    const at = await reply([
      ['apply_visibility', { action: 'hide', ids: ARC_DOORS }],
      ['toggle_display', { grids: !st().grids }],
      ['apply_visibility', { action: 'show', ids: ARC_DOORS }],
      ['toggle_display', { grids: st().grids }]
    ])
    expect(st().chatMsgs[at].undoSnap).toBeNull()
  })

  it('on one that looks the same and is not: a hide by rule, then a reset, leaves a step switched off', async () => {
    const at = await reply([
      ['apply_visibility', { action: 'hide', rules: [is('IfcEntity', 'IfcDoor')] }],
      ['apply_visibility', { action: 'reset' }]
    ])
    // Everything is visible again, and the Filter card holds a step it did not hold before.
    expect([visible(), st().stack.map((x) => x.on)]).toEqual([412, [false]])
    expect(changedBy(at)).toEqual(['vis'])
    st().revertTurn(at)
    expect(st().stack).toEqual([])
  })

  it('not on one whose calls were all already so, or refused', async () => {
    const at = await reply([
      ['toggle_display', { grids: st().grids }],
      ['set_view', { view: 'north', azimuth: 10 }],
      ['set_view', { fit: 'selection' }],
      ['color_models', { map: {} }],
      ['manage_filters', { op: 'update', step: 3, color: '#E05A6B' }],
      ['set_interface', { theme: st().theme }]
    ])
    expect(st().chatMsgs[at].undoSnap).toBeNull()
  })

  it('not on one that saved or renamed a viewpoint: the list is the user’s, and no revert unsaves', async () => {
    const at = await reply([
      ['manage_views', { op: 'save', name: 'Here' }],
      ['manage_views', { op: 'rename', name: 'Here', to: 'There' }]
    ])
    expect(st().chatMsgs[at].undoSnap).toBeNull()
    expect(st().views.map((v) => v.name)).toEqual(['There'])
  })

  it('on the row the panel draws: `revert` appears with the undo and goes when it is used', async () => {
    const read = await reply([['get_view_state', {}]])
    const acted = await reply([['set_interface', { theme: 'light' }]])
    expect([offersRevert(read), offersRevert(acted)]).toEqual([false, true])
    st().revertTurn(acted)
    expect(offersRevert(acted)).toBe(false)
    // The reverted reply is dimmed, as the design dims it.
    expect(chatRow(st().chatMsgs[acted], acted).opacity).toBe('0.5')
    expect(st().theme).toBe('dark')
    // The reverted reply gave its snapshot up with the control, so a second press — which the
    // panel no longer offers — does nothing at all: no state is written, nothing is put back.
    expect(st().chatMsgs[acted].undoSnap).toBeNull()
    st().setTheme('light')
    const again = st()
    const depth = historyDepth()
    st().revertTurn(acted)
    expect(st()).toBe(again)
    expect(st().theme).toBe('light')
    expect(historyDepth()).toEqual(depth)
    // A reply that never had an undo does nothing either.
    st().revertTurn(read)
    expect(st()).toBe(again)
  })
})

/* ────────────────────────────── the federation changed in between ────────────────────────────── */

describe('a revert after the federation changed keeps the rules a session restore keeps', () => {
  it('restores what still applies when a model has been removed, and says what could not be', async () => {
    // Before the reply: some of ARC and some of STR hidden, STR's eye off, STR coloured, a
    // selection across both, STR active.
    st().hide([...ARC_DOORS, ...STR_COLUMNS.slice(0, 4)])
    st().setModelColor('STR', '#E05A6B')
    st().setModelColor('ARC', '#35C4B6')
    st().select([ARC_DOORS[0], STR_COLUMNS[5]])
    st().toggleLevels()
    // The reply shows everything, clears the colours, selects something else, flips a switch.
    const at = await reply([
      ['apply_visibility', { action: 'reset' }],
      ['color_models', { map: {} }],
      ['select_elements', { rules: [is('IfcEntity', 'IfcStair')], zoom: false }],
      ['toggle_display', { levels: false }]
    ])
    expect(changedBy(at)).toEqual(['vis', 'levels', 'colours', 'selection'])

    // The user removes STR.
    st().commitModels(removeModel(st().federation, 'STR').federation)
    expect(st().loaded).toEqual(['ARC', 'SIT', 'MEP'])
    told = []
    st().revertTurn(at)

    // ARC's part of it is back; STR's ids, colour and selection went with STR.
    expect(hiddenIds()).toEqual(ARC_DOORS)
    expect(st().modelColors).toEqual({ ARC: '#35C4B6' })
    expect(st().selIds).toEqual([ARC_DOORS[0]])
    expect(st().levels).toBe(true)
    for (const id of hiddenIds()) expect(st().byId.has(id)).toBe(true)
    expect(st().chatErr).toBe(
      'STR is no longer loaded, so nothing of it could be put back. Everything else was reverted.'
    )
    expect(st().chatMsgs[at].reverted).toBe(true)
    // The viewer is handed colours for loaded models only.
    expect(told.filter((c) => c[0] === 'setModelColors').pop()).toEqual(['setModelColors', { ARC: '#35C4B6' }, false])
  })

  it('drops a removed model’s eye and activate mode, and keeps a loaded model’s', async () => {
    st().toggleModel('STR')
    st().toggleModel('MEP')
    st().activate('ARC')
    const at = await reply([
      ['set_models', { visible: ['ARC', 'STR', 'SIT', 'MEP'] }],
      ['activate_model', { key: null }]
    ])
    expect(changedBy(at)).toEqual(['vis'])
    st().commitModels(removeModel(st().federation, 'STR').federation)
    st().revertTurn(at)
    expect(st().modelVis).toEqual({ MEP: false })
    expect(st().active).toBe('ARC')
    expect(st().chatErr).toContain('STR is no longer loaded')

    // …and with the active model itself gone, activate mode is left off.
    const again = await reply([['activate_model', { key: null }]])
    st().commitModels(removeModel(st().federation, 'ARC').federation)
    st().revertTurn(again)
    expect(st().active).toBeNull()
    expect(st().chatErr).toBe(
      'ARC is no longer loaded, so nothing of it could be put back. Everything else was reverted.'
    )
  })

  it('says nothing when the removed model had nothing in what is put back', async () => {
    st().hide(ARC_DOORS)
    const at = await reply([['apply_visibility', { action: 'reset' }]])
    st().commitModels(removeModel(st().federation, 'MEP').federation)
    st().revertTurn(at)
    expect(hiddenIds()).toEqual(ARC_DOORS)
    expect(st().chatErr).toBe('')
  })

  it('renumbers ids onto the slots the models have now', async () => {
    const guidsOf = (ids: readonly number[]): string[] => ids.map((id) => st().byId.get(id)!.guid).sort()
    const pick = [...STR_COLUMNS.slice(0, 3), ...ARC_DOORS.slice(0, 2)]
    st().hide(pick)
    st().select([STR_COLUMNS[7]])
    st().setColorByIds('IfcEntity', [...STR_COLUMNS.slice(0, 2), ARC_DOORS[0]])
    const scheme = st().colorBy!
    const hiddenGuids = guidsOf(pick)
    const at = await reply([
      ['apply_visibility', { action: 'reset' }],
      ['select_elements', { mode: 'clear' }],
      ['color_by_property', { property: null }]
    ])
    expect(changedBy(at)).toEqual(['vis', 'colorBy', 'selection'])

    // ARC and STR are unloaded and opened again the other way round: STR lands on slot 0.
    const rest = removeModel(removeModel(st().federation, 'ARC').federation, 'STR').federation
    st().commitModels(rest)
    const back = federate([...['SIT', 'MEP', 'STR', 'ARC'].map((k) => mockModelIndex(k))], rest)
    st().commitModels(back)
    const slotOf = (key: string): number => back.models.find((m) => m.meta.modelKey === key)!.slot
    expect([slotOf('STR'), slotOf('ARC')]).toEqual([0, 1])

    st().revertTurn(at)
    // The same elements, by GUID, under the ids they have now.
    expect(guidsOf(hiddenIds())).toEqual(hiddenGuids)
    for (const id of hiddenIds()) expect(st().byId.has(id)).toBe(true)
    expect(st().selIds).toEqual([STR_COLUMNS[7] - ID_STRIDE])
    expect(st().byId.get(st().selIds[0])!.model).toBe('STR')
    // The colour-by scheme: the same values and colours over the renumbered ids.
    expect(st().colorBy!.groups.map((g) => [g.v, g.color, g.n])).toEqual(scheme.groups.map((g) => [g.v, g.color, g.n]))
    for (const g of st().colorBy!.groups) for (const id of g.ids) expect(st().byId.get(id)!.type).toBe(g.v)
    expect(st().chatErr).toBe('')
  })

  it('treats a file picked again from a changed version as another model', async () => {
    st().hide([...STR_COLUMNS.slice(0, 3), ARC_DOORS[0]])
    const at = await reply([['apply_visibility', { action: 'reset' }]])
    // The same key on the same slot, another digest: its ids are another parse's.
    const changed = KEYS.map((k) => (k === 'STR' ? { ...mockModelIndex(k), sha256: 'changed' } : mockModelIndex(k)))
    st().commitModels(federate(changed, st().federation))
    expect(st().byId.has(STR_COLUMNS[0])).toBe(true)
    st().revertTurn(at)
    expect(hiddenIds()).toEqual([ARC_DOORS[0]])
    expect(st().chatErr).toContain('STR is no longer loaded')
  })

  it('leaves the camera where it is when the scene has moved, and restores the rest', async () => {
    const at = await reply([
      ['set_view', { view: 'north' }],
      ['toggle_display', { grids: !st().grids }]
    ])
    expect(changedBy(at)).toEqual(['camera', 'grids'])
    const grids = !st().grids
    // The model now stands somewhere else in the scene: another whole-metre offset.
    st().setOffset([1000, 2000, 0], st().frame)
    rv.rig.orbit(50, 0, null)
    const mine = rv.rig.getCamera()
    rv.calls.length = 0
    st().revertTurn(at)
    expect(rv.rig.getCamera()).toEqual(mine)
    expect(cameraCalls()).toEqual([])
    // The view button that is lit says where the camera is, so it stays as well.
    expect(st().view).toBe('north')
    expect(st().grids).toBe(grids)
    expect(st().chatErr).toBe(
      'The camera was left where it is: the model stands somewhere else than it did then. Everything else was reverted.'
    )
  })
})

/* ────────────────────────────── the Apply button ────────────────────────────── */

describe('a change the scope guard held, applied later, joins the reply’s revert', () => {
  it('one revert puts back the reply’s own change and the applied one', async () => {
    const grids = st().grids
    const at = await reply([
      ['toggle_display', { grids: !grids }],
      ['apply_visibility', { action: 'isolate', rules: [is('IfcEntity', 'IfcStair')] }]
    ])
    // Held: 3 of 412. Only the switch is the reply's so far.
    expect(st().chatMsgs[at].pending?.label).toContain('3 of 412')
    expect(visible()).toBe(412)
    expect(changedBy(at)).toEqual(['grids'])

    st().applyPending(at)
    expect(visible()).toBe(3)
    expect(st().chatMsgs[at].pending).toBeNull()
    expect(changedBy(at)).toEqual(['vis', 'grids'])

    st().revertTurn(at)
    expect(visible()).toBe(412)
    expect(st().grids).toBe(grids)
    // The Apply and the revert are both on the undo stack; ⌘Z walks the revert back.
    st().step(true)
    expect(visible()).toBe(3)
  })

  it('gives a reply that only held a change its revert when the change is applied', async () => {
    const at = await reply([['apply_visibility', { action: 'isolate', rules: [is('IfcEntity', 'IfcStair')] }]])
    expect(st().chatMsgs[at].undoSnap).toBeNull()
    expect(offersRevert(at)).toBe(false)
    st().applyPending(at)
    expect(changedBy(at)).toEqual(['vis'])
    expect(offersRevert(at)).toBe(true)
    st().revertTurn(at)
    expect(visible()).toBe(412)
  })

  /**
   * After the consent gate's review. A reverted reply used to keep its pending row: applied
   * afterwards, the change landed with no snapshot to hold — a reverted reply is never offered
   * `revert` again — which for a held hide was only untidy (it is on the undo stack), and for a
   * base point asked for by that reply meant a change nothing could put back. The request was
   * part of the reply, so it goes when the reply is taken back.
   */
  it('drops a request a reverted reply left waiting: its Apply does nothing afterwards', async () => {
    const grids = st().grids
    const at = await reply([
      ['toggle_display', { grids: !grids }],
      ['apply_visibility', { action: 'isolate', rules: [is('IfcEntity', 'IfcStair')] }]
    ])
    expect(st().chatMsgs[at].pending?.label).toContain('3 of 412')
    expect(chatRow(st().chatMsgs[at], at).hasPending).toBe(true)
    st().revertTurn(at)
    expect(st().grids).toBe(grids)
    // The row is gone with the reply's changes…
    expect(st().chatMsgs[at].pending).toBeNull()
    expect(chatRow(st().chatMsgs[at], at).hasPending).toBe(false)
    // …so there is nothing to apply, and the reply stays as the design leaves a reverted one.
    const depth = historyDepth()
    st().applyPending(at)
    expect(visible()).toBe(412)
    expect(historyDepth()).toEqual(depth)
    expect(st().chatMsgs[at].reverted).toBe(true)
    expect(st().chatMsgs[at].undoSnap).toBeNull()
    expect(offersRevert(at)).toBe(false)
  })

  it('…so a base point that reply asked for cannot be set afterwards, where nothing could have put it back', async () => {
    st().setCoord('E', '12345.457')
    const coords = st().coords
    const at = await reply([
      ['toggle_display', { grids: !st().grids }],
      ['request_user_action', { action: 'set_base_point', E: 28500, angle: 12.5 }]
    ])
    expect(st().chatMsgs[at].pending?.action).toMatchObject({ kind: 'set_base_point' })
    st().revertTurn(at)
    expect(st().chatMsgs[at].pending).toBeNull()
    told = []
    st().applyPending(at)
    expect(st().coords).toBe(coords)
    expect(told).toEqual([])
    // A reply with nothing to revert keeps its request: only a revert takes one away.
    const only = await reply([['request_user_action', { action: 'set_base_point', E: 28500 }]])
    expect(offersRevert(only)).toBe(false)
    expect(st().chatMsgs[only].pending).not.toBeNull()
  })

  it('stands alone when the federation changed between the reply and the Apply', async () => {
    const grids = st().grids
    const at = await reply([
      ['toggle_display', { grids: !grids }],
      ['apply_visibility', { action: 'isolate', rules: [is('IfcEntity', 'IfcStair')] }]
    ])
    st().commitModels(removeModel(st().federation, 'MEP').federation)
    st().applyPending(at)
    expect(changedBy(at)).toEqual(['vis'])
    st().revertTurn(at)
    expect(visible()).toBe(404)
    // The switch is no longer this revert's to put back.
    expect(st().grids).toBe(!grids)
  })
})
