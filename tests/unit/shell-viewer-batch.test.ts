/**
 * Every store action that reaches the viewer, against a viewer stub that counts (core
 * protection, plan item 7).
 *
 * `viewer-invalidate.test.ts` proves the real viewer's half: each setter asks for a frame, any
 * number of `invalidate()`s in one task still draw one request's worth of frames, and the three
 * expensive passes — repaint every element, rebuild the edge index, rebuild the picker — run once
 * per setter outside `viewer.batch` and once per batch inside one. So for the store the two
 * properties come down to:
 *
 * - **no stale frame** — an action that changes what is drawn calls the setter that draws it;
 * - **no over-render** — whatever an action calls, each of the three passes runs **at most
 *   once**: an action that calls more than one setter that asks for a pass goes through
 *   `viewer.batch` (CLAUDE.md: "Every multi-setter action in the shell goes through it").
 *
 * The stub charges each setter with what `viewer-contract.ts` says it costs, so the arithmetic
 * is the real viewer's. Which actions reach the viewer is read from `state/shell.ts` itself —
 * directly or through another action or helper — so an action that starts reaching it fails
 * here until it has a case.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { IDENTITY_FRAME_KEY } from '../../src/shared/georef'
import type { Rule } from '../../src/shared/rules'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { turnSnapshot, turnUndo } from '../../src/renderer/state/selectors/snapshot'
import { setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import type { Viewer } from '../../src/renderer/viewer/viewer-core'
import { memoryStorage, resetShell } from './stub-viewer'
import { VIEWER_MEMBERS, type Work } from './viewer-contract'

const full = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
const st = (): ShellState => useShell.getState()
const WALLS: Rule[] = [{ prop: 'IfcEntity', op: '=', val: 'IfcWall' }]
const ids = (n: number, model = 'ARC'): number[] =>
  full.elements.filter((e) => e.model === model).slice(0, n).map((e) => e.id)
const CAM = { theta: 1, phi: 1, dist: 30, half: 12, target: [1, 2, 3], proj: 'persp' as const }

/* ────────────────────────────── the counting viewer ────────────────────────────── */

interface Tally extends Work {
  /** Every setter called, in order. */
  setters: string[]
  /** Setters called outside any batch. */
  bare: string[]
}

let tally: Tally = { paint: 0, edges: 0, picker: 0, setters: [], bare: [] }
let depth = 0
let marked: Work = { paint: 0, edges: 0, picker: 0 }

/** A viewer whose setters are charged as `viewer-contract.ts` says, and whose batch coalesces. */
function countingViewer(): Viewer {
  const answers: Record<string, unknown> = {
    getCamera: () => CAM,
    elementIds: () => [],
    elementBox: () => null,
    solidCount: () => 0,
    isVisible: () => true,
    debug: () => ({}),
    showSpot: () => 'expanded',
    placeMeasure: () => true,
    removeModel: () => []
  }
  const o: Record<string, unknown> = {
    batch: (fn: () => void) => {
      depth++
      try {
        fn()
      } finally {
        if (--depth === 0) {
          for (const k of ['paint', 'edges', 'picker'] as const) tally[k] += marked[k] ? 1 : 0
          marked = { paint: 0, edges: 0, picker: 0 }
        }
      }
    }
  }
  for (const [name, m] of Object.entries(VIEWER_MEMBERS)) {
    if (m.kind !== 'setter') {
      if (name in answers) o[name] = answers[name]
      continue
    }
    o[name] = (...args: unknown[]) => {
      tally.setters.push(name)
      if (!depth) tally.bare.push(name)
      for (const k of ['paint', 'edges', 'picker'] as const) {
        if (!m.work[k]) continue
        if (depth) marked[k] = 1
        else tally[k] += m.work[k]
      }
      return name in answers ? (answers[name] as (...a: unknown[]) => unknown)(...args) : undefined
    }
  }
  return o as unknown as Viewer
}

/* ────────────────────────────── the cases ────────────────────────────── */

interface Case {
  /** Run before the count starts. */
  setup?: () => void
  run: () => void
  /** Setters the action must call — what it changed is drawn. */
  draws: string[]
}

/** A colour scheme on, so clearing it is a change. */
const withColorBy = (): void => void st().setColorBy('IfcEntity')

/** A reply that changed the theme, the colour scheme and the visibility, ready to revert. */
function replyToRevert(): void {
  const before = turnSnapshot(st(), CAM)
  st().setTheme('light')
  st().setColorBy('IfcEntity')
  st().hide(ids(2))
  const undoSnap = turnUndo(before, turnSnapshot(st(), CAM))
  useShell.setState({ chatMsgs: [{ role: 'assistant', text: 'Done.', undoSnap }] })
}

/** Every store action that reaches the viewer, with a call that changes something. */
const CASES: Record<string, Case> = {
  activate: { run: () => st().activate('ARC'), draws: ['setPickable'] },
  addStep: { run: () => st().addStep('isolate', WALLS), draws: ['setVisibility'] },
  aimCamera: { run: () => st().aimCamera(90, 30), draws: ['lookAlong'] },
  allStoreys: {
    setup: () => st().toggleStorey('L1'),
    run: () => st().allStoreys(),
    draws: ['setVisibility']
  },
  applyColors: { setup: withColorBy, run: () => st().applyColors(), draws: ['setElementColors'] },
  applyFilterSet: {
    run: () =>
      st().applyFilterSet({ id: 1, label: 'Walls', stack: [{ id: 'a', on: true, action: 'isolate', rules: WALLS }] }),
    draws: ['setVisibility']
  },
  applyPending: {
    setup: () =>
      useShell.setState({
        chatMsgs: [
          { role: 'assistant', text: 'Hide two?', pending: { label: 'hide 2', patch: { hidden: { [ids(1)[0]]: true } } } }
        ]
      }),
    run: () => st().applyPending(0),
    draws: ['setVisibility']
  },
  applySession: {
    run: () =>
      st().applySession({
        theme: 'light',
        units: 'ft',
        hidden: { [ids(1)[0]]: true },
        modelColors: { ARC: '#D8D2C6' },
        nativeMats: false,
        shadows: false,
        sections: { grid: { name: 'C', offset: 0, flip: false, cut: true }, level: { name: '', offset: 0, flip: false, cut: false } },
        cam: CAM,
        frame: IDENTITY_FRAME_KEY
      }),
    draws: ['setTheme', 'setUnits', 'setModelColors', 'setSections', 'setShadows', 'setCamera', 'setVisibility']
  },
  applyVis: { run: () => st().applyVis(), draws: ['setVisibility', 'setHighlight', 'setElementColors'] },
  clearColorBy: { setup: withColorBy, run: () => st().clearColorBy(), draws: ['setElementColors'] },
  clearMeasures: { run: () => st().clearMeasures(), draws: ['clearMeasures'] },
  clearSections: {
    setup: () => st().setSec('grid', { name: 'C', cut: true }),
    run: () => st().clearSections(),
    draws: ['setSections']
  },
  clearSpots: { run: () => st().clearSpots(), draws: ['clearSpots'] },
  clearStack: { setup: () => st().addStep('isolate', WALLS), run: () => st().clearStack(), draws: ['setVisibility'] },
  commitModels: {
    run: () => st().commitModels(federate([mockModelIndex('ARC'), mockModelIndex('STR'), mockModelIndex('MEP')])),
    draws: ['setSelected', 'setClassColors', 'setModelColors', 'setPickable', 'setVisibility']
  },
  dropMeasure: { run: () => st().dropMeasure(1), draws: ['dropMeasure'] },
  dropSpot: { run: () => st().dropSpot(1), draws: ['dropSpot'] },
  dropStep: {
    setup: () => st().addStep('isolate', WALLS),
    run: () => st().dropStep(st().stack[0].id),
    draws: ['setVisibility']
  },
  fitView: { run: () => st().fitView('extents', 2), draws: ['zoomExtents'] },
  focusPoint: { run: () => st().focusPoint([1, 2, 3]), draws: ['focusPoint'] },
  gridClick: { run: () => st().gridClick('C'), draws: ['setSections'] },
  hide: { run: () => st().hide(ids(3)), draws: ['setVisibility'] },
  isolate: { run: () => st().isolate(ids(3)), draws: ['setVisibility'] },
  moveStep: {
    setup: () => {
      st().addStep('isolate', WALLS)
      st().addStep('hide', [{ prop: 'IfcEntity', op: '=', val: 'IfcDoor' }])
    },
    run: () => st().moveStep(st().stack[1].id, -1),
    draws: ['setVisibility']
  },
  placeMeasure: { run: () => st().placeMeasure([1, 2, 3], null, -1), draws: ['placeMeasure'] },
  placeSpot: { run: () => st().placeSpot([1, 2, 3]), draws: ['placeSpot'] },
  restoreView: {
    setup: () => {
      st().hide(ids(2))
      st().saveView()
      st().showAll()
    },
    run: () => st().restoreView(st().views[0]),
    draws: ['setGrids', 'setLevels', 'setPickable', 'setSections', 'setCamera', 'setVisibility']
  },
  revertTurn: {
    setup: replyToRevert,
    run: () => st().revertTurn(0),
    draws: ['setTheme', 'setElementColors', 'setVisibility']
  },
  select: { run: () => st().select(ids(2), true), draws: ['setSelected', 'setDims', 'zoomTo'] },
  // 2026-11-08 (stage 1b): a pick on a reply is `select` of what is still loaded.
  pickChat: {
    setup: () => useShell.setState({ chatMsgs: [{ role: 'assistant', text: 'x', chips: [{ label: 'two', ids: ids(2) }] }] }),
    run: () => st().pickChat(0, ids(2), true),
    draws: ['setSelected', 'setDims', 'zoomTo']
  },
  setColorBy: { run: () => st().setColorBy('IfcEntity'), draws: ['setElementColors'] },
  setColorByGroups: {
    run: () => st().setColorByGroups('Mark', [{ value: 'A', ids: ids(2) }]),
    draws: ['setElementColors']
  },
  setColorByIds: { run: () => st().setColorByIds('IfcEntity', ids(4)), draws: ['setElementColors'] },
  setGroundGrid: { run: () => st().setGroundGrid(true), draws: ['setGroundGrid'] },
  setModelColor: { run: () => st().setModelColor('ARC', '#D8D2C6'), draws: ['setModelColors'] },
  setSec: { run: () => st().setSec('level', { name: 'L2', cut: true }), draws: ['setSections'] },
  setShadows: { run: () => st().setShadows(false), draws: ['setShadows'] },
  setStepColor: {
    setup: () => st().addStep('highlight', WALLS),
    run: () => st().setStepColor(st().stack[0].id, '#E05A6B'),
    draws: ['setElementColors', 'setHighlightColor']
  },
  setStepRules: {
    setup: () => st().addStep('isolate', WALLS),
    run: () => st().setStepRules(st().stack[0].id, [{ prop: 'IfcEntity', op: '=', val: 'IfcSlab' }]),
    draws: ['setVisibility']
  },
  setTheme: { run: () => st().setTheme('light'), draws: ['setTheme'] },
  setTool: { run: () => st().setTool('measure'), draws: ['setTool'] },
  setUnits: { run: () => st().setUnits('ft'), draws: ['setUnits'] },
  setView: { run: () => st().setView('top'), draws: ['setView'] },
  show: { setup: () => st().hide(ids(3)), run: () => st().show(ids(3)), draws: ['setVisibility'] },
  showAll: { setup: () => st().hide(ids(3)), run: () => st().showAll(), draws: ['setVisibility'] },
  showSpot: { run: () => void st().showSpot(1, true), draws: ['showSpot'] },
  soloStorey: { run: () => st().soloStorey('L1', false, ['L1', 'L2']), draws: ['setVisibility'] },
  step: { setup: () => st().hide(ids(2)), run: () => st().step(true), draws: ['setPickable', 'setVisibility'] },
  toggleDims: { setup: () => st().select(ids(1)), run: () => st().toggleDims(), draws: ['setDims'] },
  toggleGrids: { run: () => st().toggleGrids(), draws: ['setGrids'] },
  toggleLevels: { run: () => st().toggleLevels(), draws: ['setLevels'] },
  toggleModel: { run: () => st().toggleModel('ARC'), draws: ['setVisibility'] },
  toggleNative: { run: () => st().toggleNative(), draws: ['setModelColors'] },
  toggleProj: { run: () => st().toggleProj(), draws: ['setProjection'] },
  toggleSnap: { run: () => st().toggleSnap(), draws: ['setSnap'] },
  toggleStorey: { run: () => st().toggleStorey('L1'), draws: ['setVisibility'] },
  up: { run: () => st().up({ hidden: { [ids(1)[0]]: true } }), draws: ['setVisibility'] },
  updStep: {
    setup: () => st().addStep('isolate', WALLS),
    run: () => st().updStep(st().stack[0].id, { on: false }),
    draws: ['setVisibility']
  }
}

/**
 * What reaches the viewer from `state/shell.ts` but is not a store action with a case above, and
 * why. A store action is never on this list: one that reaches the viewer gets a case.
 */
const NOT_ACTIONS: Record<string, string> = {
  setViewer: 'hands the viewer in; pushes the cut colours, which draw only while a plane cuts',
  pushCutColors: 'the store subscription’s cut colours — setCutColors, which draws only while a plane cuts',
  pushDims: 'a helper of select, toggleDims and revertTurn, which have cases',
  performGated: 'the pending row’s performer, reached only through applyPending (a case)',
  batched: 'the batch wrapper itself'
}

/* ────────────────────────────── which actions reach the viewer ────────────────────────────── */

/**
 * The store's actions and the module's helpers that reach the viewer, read from the source:
 * a call on the viewer handle (`viewer.x(`, `vw.x(`, `v.x(`, `v?.x(` — not `getCamera`, a read),
 * or `batched(`, directly or through another action (`get().x(`, `s.x(`) or helper (`x(`).
 */
function actionsReachingTheViewer(): Set<string> {
  const raw = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'state', 'shell.ts'), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const open = 'export const useShell = create<ShellState>((set, get) => ({'
  const start = src.indexOf(open)
  const end = src.indexOf('\n}))', start)
  expect(start, 'the store literal in state/shell.ts').toBeGreaterThan(0)
  const bodies = new Map<string, string>()
  let cur = ''
  for (const line of src.slice(start + open.length, end).split('\n')) {
    const m = /^ {2}(\w+)(?::|\s*\()/.exec(line)
    if (m) cur = m[1]
    if (cur) bodies.set(cur, (bodies.get(cur) ?? '') + line + '\n')
  }
  let helper = ''
  for (const line of (src.slice(0, start) + src.slice(end)).split('\n')) {
    const m = /^(?:export )?(?:function (\w+)|const (\w+) = )/.exec(line)
    if (m) helper = m[1] || m[2]
    else if (/^\S/.test(line)) helper = ''
    if (helper) bodies.set(helper, (bodies.get(helper) ?? '') + line + '\n')
  }
  const reach = new Set<string>()
  for (const [name, body] of bodies) {
    const calls = [...body.matchAll(/\b(?:viewer|vw|v)\??\.(\w+)\(/g)].map((m) => m[1])
    if (calls.some((c) => c !== 'getCamera' && c !== 'batch') || /\bbatched\(/.test(body)) reach.add(name)
  }
  reach.add('batched')
  for (let grew = true; grew; ) {
    grew = false
    for (const [name, body] of bodies) {
      if (reach.has(name)) continue
      const via = [...reach].some(
        (r) => new RegExp(`(?:get\\(\\)|\\bs|\\bst)\\.${r}\\(`).test(body) || new RegExp(`(?<![.\\w])${r}\\(`).test(body)
      )
      if (via) {
        reach.add(name)
        grew = true
      }
    }
  }
  return reach
}

/* ────────────────────────────── the tests ────────────────────────────── */

beforeEach(() => {
  resetShell()
  vi.stubGlobal('localStorage', memoryStorage())
  // `pushDims` measures the viewport and the two cards it keeps the labels clear of.
  const box = { left: 0, top: 0, width: 800, height: 600 }
  vi.stubGlobal('document', {
    documentElement: { dataset: {} },
    querySelector: (q: string) => (q.includes('viewport') ? { getBoundingClientRect: () => box } : null)
  })
  setViewer(null)
  st().commitModels(full)
  setViewer(countingViewer())
})
afterEach(() => {
  setViewer(null)
  vi.unstubAllGlobals()
})

describe('which store actions reach the viewer', () => {
  it('every one has a case, and every case is one', () => {
    const reach = actionsReachingTheViewer()
    const actions = [...reach].filter((n) => !(n in NOT_ACTIONS))
    expect(actions.filter((n) => !(n in CASES)), 'reach the viewer with no case here').toEqual([])
    expect(Object.keys(CASES).filter((n) => !reach.has(n)), 'cases for actions that no longer reach it').toEqual([])
    expect(Object.keys(NOT_ACTIONS).filter((n) => !reach.has(n)), 'listed but no longer reaching it').toEqual([])
  })
})

describe.each(Object.entries(CASES))('%s', (name, c) => {
  it('draws what it changed, running each expensive pass at most once', () => {
    c.setup?.()
    tally = { paint: 0, edges: 0, picker: 0, setters: [], bare: [] }
    depth = 0
    c.run()
    expect(depth).toBe(0)
    for (const s of c.draws) expect(tally.setters, `${name} never called ${s}: a stale frame`).toContain(s)
    const why = `${name} called ${tally.bare.join(', ')} outside viewer.batch`
    expect(tally.paint, `${why} — repaints of every element`).toBeLessThanOrEqual(1)
    expect(tally.edges, `${why} — edge rebuilds`).toBeLessThanOrEqual(1)
    expect(tally.picker, `${why} — picker rebuilds`).toBeLessThanOrEqual(1)
  })
})
