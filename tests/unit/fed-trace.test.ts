/**
 * 2026-11-12 — the federating indicator, the owner's pick "B · Edge trace": a 2 px line of five
 * segments along the top of the 3D stage and a caption chip in the bottom row's centre zone,
 * shown while a model picked **after boot** is parsing and joining.
 *
 * Three layers, each checked here headlessly: the pure step (`shared/fed-trace.ts`), the little
 * store that feeds it from the shell store and owns its two timers (`model/fed-trace-store.ts`),
 * and the two components (`app/FedTrace.tsx`), which draw nothing — absent, not hidden — while
 * idle. No Electron, no viewer.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FED_EXIT_MS,
  FED_FAILED,
  FED_FAILED_HOLD_MS,
  FED_IDLE,
  FED_JOINED_HOLD_MS,
  fedExpire,
  fedHoldMs,
  fedStep,
  fedView,
  type FedRow,
  type FedSnapshot,
  type FedTrace
} from '../../src/shared/fed-trace'
import { fedTraceState, onFedTrace } from '../../src/renderer/model/fed-trace-store'
import { FedCaption, FedLine } from '../../src/renderer/app/FedTrace'
import LoadingBadge from '../../src/renderer/app/LoadingBadge'
import { useShell } from '../../src/renderer/state/shell'
import type { Federation } from '../../src/shared/federate'

const ROOT = join(__dirname, '..', '..')

const row = (id: string, stage: string, extra: Partial<FedRow> = {}): FedRow => ({
  id,
  name: `${id}.ifc`,
  stage,
  ...extra
})
const snap = (booted: boolean, uploads: FedRow[], elementCount = 100): FedSnapshot => ({
  booted,
  uploads,
  elementCount
})
/** Feeds snapshots in order from idle, as the store does. */
const run = (snaps: FedSnapshot[], reduced = false): FedTrace =>
  snaps.reduce((t, sn) => fedStep(t, sn, reduced), FED_IDLE)

describe('the step — when it shows', () => {
  it('never starts for the landing page’s first load, even while its ticked rows stay past the reveal', () => {
    const t = run([
      snap(false, [row('a', 'reading file')]),
      snap(false, [row('a', 'building geometry')]),
      snap(false, [row('a', 'ready', { done: true })]),
      // The reveal: booted, the ticked row still there, then gone.
      snap(true, [row('a', 'ready', { done: true })], 400),
      snap(true, [], 400)
    ])
    expect(t.phase).toBe('idle')
    expect(fedView(t)).toBeNull()
  })

  it('never starts for a row that is an error row at first sight (a refused file)', () => {
    const t = run([snap(true, [row('x', 'not an IFC file', { error: true, dismiss: true } as Partial<FedRow>)])])
    expect(t.phase).toBe('idle')
    expect(fedView(t)).toBeNull()
  })

  it('starts for a model picked after boot, at its own stage', () => {
    const t = run([snap(true, []), snap(true, [row('Tower B', 'reading file')])])
    expect(t.phase).toBe('loading')
    const v = fedView(t)!
    expect(v.leaving).toBe(false)
    expect(v.caption).toEqual({ kind: 'loading', name: 'Tower B.ifc', stage: 'reading file', step: '1/5' })
    expect(v.segments).toEqual(['current', 'pending', 'pending', 'pending', 'pending'])
    expect(v.glint).toBe(0)
  })
})

describe('the step — what it shows while loading', () => {
  it('follows the row’s own shown stage, in the design’s words, with n/5', () => {
    const t = run([snap(true, [row('a', 'reading file')]), snap(true, [row('a', 'building geometry')])])
    const v = fedView(t)!
    expect(v.caption).toMatchObject({ stage: 'building geometry', step: '3/5' })
    expect(v.segments).toEqual(['done', 'done', 'current', 'pending', 'pending'])
    expect(v.glint).toBe(2)
  })

  it('a row that reads `ready` is `federating · 5/5`, still running', () => {
    const t = run([snap(true, [row('a', 'reading file')]), snap(true, [row('a', 'ready', { done: true })])])
    expect(t.phase).toBe('loading')
    const v = fedView(t)!
    expect(v.caption).toMatchObject({ stage: 'federating', step: '5/5' })
    expect(v.segments).toEqual(['done', 'done', 'done', 'done', 'current'])
  })

  it('two or more in flight: `N models`, and the stage of the one furthest behind', () => {
    const t = run([
      snap(true, [row('a', 'reading file')]),
      snap(true, [row('a', 'indexing properties'), row('b', 'parsing entities'), row('c', 'ready', { done: true })])
    ])
    expect(fedView(t)!.caption).toEqual({ kind: 'loading', name: '3 models', stage: 'parsing entities', step: '2/5' })
  })

  it('an error row of the same batch is not in flight', () => {
    const t = run([
      snap(true, [row('a', 'reading file'), row('b', 'reading file')]),
      snap(true, [row('a', 'parsing entities'), row('b', 'boom', { error: true })])
    ])
    expect(fedView(t)!.caption).toMatchObject({ name: 'a.ifc', stage: 'parsing entities' })
  })
})

describe('the step — how it ends', () => {
  const loading = [snap(true, [row('a', 'reading file')], 100), snap(true, [row('a', 'ready', { done: true })], 100)]

  it('joined: `+N elements`, N the federation’s growth over the batch', () => {
    const t = run([...loading, snap(true, [], 4182)])
    expect(t.phase).toBe('joined')
    const v = fedView(t)!
    expect(v.caption).toEqual({ kind: 'joined', added: '+4\u2009082 elements', failed: null })
    expect(v.segments).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(v.glint).toBe(-1)
  })

  it('joined one element: `+1 element`', () => {
    expect(fedView(run([...loading, snap(true, [], 101)]))!.caption).toMatchObject({ added: '+1 element' })
  })

  it('joined with no growth (a replacement): the tick and `joined`, no number', () => {
    expect(fedView(run([...loading, snap(true, [], 100)]))!.caption).toEqual({
      kind: 'joined',
      added: 'joined',
      failed: null
    })
    expect(fedView(run([...loading, snap(true, [], 60)]))!.caption).toMatchObject({ added: 'joined' })
  })

  it('joined with failures: `· N could not open`', () => {
    const t = run([
      snap(true, [row('a', 'reading file'), row('b', 'reading file')], 100),
      snap(true, [row('a', 'ready', { done: true }), row('b', 'bad file', { error: true })], 100),
      snap(true, [row('b', 'bad file', { error: true })], 150)
    ])
    expect(fedView(t)!.caption).toEqual({ kind: 'joined', added: '+50 elements', failed: '1 could not open' })
  })

  it('all failed: one still state in warn, the current segment filled', () => {
    const t = run([
      snap(true, [row('a', 'reading file')]),
      snap(true, [row('a', 'building geometry')]),
      snap(true, [row('a', 'web-ifc refused', { error: true })])
    ])
    expect(t.phase).toBe('failed')
    const v = fedView(t)!
    expect(v.caption).toEqual({ kind: 'failed', text: FED_FAILED })
    expect(FED_FAILED).toBe('could not open — see Models')
    expect(v.segments).toEqual(['done', 'done', 'warn', 'pending', 'pending'])
    expect(v.glint).toBe(-1)
  })

  it('a join that fails after boot (done rows patched to error) is failed', () => {
    const t = run([...loading, snap(true, [row('a', 'no geometry', { error: true, done: false })])])
    expect(t.phase).toBe('failed')
  })

  it('cancelled (rows gone, none joined, none failed): leaving at once; under reduced motion, idle at once', () => {
    const t = run([snap(true, [row('a', 'parsing entities')]), snap(true, [])])
    expect(t.phase).toBe('leaving')
    expect(fedView(t)!.leaving).toBe(true)
    expect(run([snap(true, [row('a', 'parsing entities')]), snap(true, [])], true).phase).toBe('idle')
  })

  it('a pick during the joined hold drops it at once and restarts at the new file’s stage', () => {
    const joined = run([...loading, snap(true, [], 300)])
    const t = fedStep(joined, snap(true, [row('n', 'reading file')], 300))
    expect(t.phase).toBe('loading')
    expect(t.batch).toBe(joined.batch + 1)
    expect(fedView(t)!.caption).toMatchObject({ name: 'n.ifc', step: '1/5' })
    // Its own batch: it grows from where the federation stood when it started.
    const after = fedStep(fedStep(t, snap(true, [row('n', 'ready', { done: true })], 300)), snap(true, [], 310))
    expect(fedView(after)!.caption).toMatchObject({ added: '+10 elements' })
  })

  it('a pick during the exit restarts too', () => {
    const leaving = fedExpire(run([...loading, snap(true, [], 300)]))
    expect(leaving.phase).toBe('leaving')
    expect(fedStep(leaving, snap(true, [row('n', 'reading file')], 300)).phase).toBe('loading')
  })

  it('an unrelated change returns the same object (the store does not re-render on it)', () => {
    const t = run(loading)
    expect(fedStep(t, snap(true, [row('a', 'ready', { done: true })], 100))).toBe(t)
    expect(fedStep(FED_IDLE, snap(true, []))).toBe(FED_IDLE)
  })
})

describe('the step — holds', () => {
  const joined = run([snap(true, [row('a', 'ready', { done: true })], 1), snap(true, [], 2)])
  const failed = run([snap(true, [row('a', 'reading file')]), snap(true, [row('a', 'x', { error: true })])])

  it('joined holds 900 ms, failed 1600 ms, the exit 220 ms; nothing else waits', () => {
    expect([FED_JOINED_HOLD_MS, FED_FAILED_HOLD_MS, FED_EXIT_MS]).toEqual([900, 1600, 220])
    expect(fedHoldMs(joined)).toBe(900)
    expect(fedHoldMs(failed)).toBe(1600)
    expect(fedHoldMs(fedExpire(joined))).toBe(220)
    expect(fedHoldMs(FED_IDLE)).toBeNull()
    expect(fedHoldMs(run([snap(true, [row('a', 'reading file')])]))).toBeNull()
  })

  it('at the end of a hold: the exit, then idle; under reduced motion straight to idle', () => {
    expect(fedExpire(joined).phase).toBe('leaving')
    expect(fedExpire(failed).phase).toBe('leaving')
    expect(fedExpire(fedExpire(joined)).phase).toBe('idle')
    expect(fedExpire(joined, true).phase).toBe('idle')
    expect(fedExpire(failed, true).phase).toBe('idle')
  })

  it('under reduced motion there is no glint', () => {
    expect(fedView(run([snap(true, [row('a', 'reading file')])]), true)!.glint).toBe(-1)
  })
})

/* ─────────────────────────── the store and its timers ─────────────────────────── */

const INITIAL = useShell.getState()
/** A federation of `n` elements — only its count is read. */
const fedOf = (n: number): Federation =>
  ({ ...INITIAL.federation, elements: Array.from({ length: n }) }) as unknown as Federation

describe('the store', () => {
  let stop: () => void = () => {}
  const reduce = (on: boolean): void => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce') }))
  }
  beforeEach(() => {
    vi.useFakeTimers()
    reduce(false)
    useShell.setState({ ...INITIAL, booted: true, uploads: [], federation: fedOf(10) }, true)
    stop = onFedTrace(() => {})
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useShell.setState(INITIAL, true)
  })
  const add = (id: string, stage = 'reading file'): void =>
    useShell.getState().addUpload({ id, name: `${id}.ifc`, stage, pct: 5 })

  it('sets no timer while idle, whatever the store does', () => {
    useShell.setState({ hint: 'x' })
    useShell.setState({ federation: fedOf(12) })
    useShell.getState().addUpload({ id: 'e', name: 'e.ifc', stage: 'not an IFC file', pct: 0, error: true })
    expect(fedTraceState().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('joined: held 900 ms, exits 220 ms, then idle with no timer pending', () => {
    add('a')
    expect(fedTraceState().phase).toBe('loading')
    expect(vi.getTimerCount()).toBe(0)
    useShell.getState().patchUpload('a', { stage: 'ready', done: true, pct: 100 })
    useShell.setState({ federation: fedOf(30) })
    useShell.getState().dropUpload('a')
    expect(fedTraceState().phase).toBe('joined')
    expect(fedView(fedTraceState())!.caption).toMatchObject({ added: '+20 elements' })
    vi.advanceTimersByTime(899)
    expect(fedTraceState().phase).toBe('joined')
    vi.advanceTimersByTime(1)
    expect(fedTraceState().phase).toBe('leaving')
    vi.advanceTimersByTime(220)
    expect(fedTraceState().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('failed: held 1600 ms, exits 220 ms, then idle with no timer pending', () => {
    add('a')
    useShell.getState().patchUpload('a', { stage: 'broken', error: true })
    expect(fedTraceState().phase).toBe('failed')
    vi.advanceTimersByTime(1599)
    expect(fedTraceState().phase).toBe('failed')
    vi.advanceTimersByTime(1)
    expect(fedTraceState().phase).toBe('leaving')
    vi.advanceTimersByTime(220)
    expect(fedTraceState().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancelled: exits 220 ms at once', () => {
    add('a')
    useShell.getState().dropUpload('a')
    expect(fedTraceState().phase).toBe('leaving')
    vi.advanceTimersByTime(220)
    expect(fedTraceState().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a pick during the hold restarts and drops the hold’s timer', () => {
    add('a')
    useShell.getState().patchUpload('a', { stage: 'ready', done: true })
    useShell.getState().dropUpload('a')
    expect(vi.getTimerCount()).toBe(1)
    add('b')
    expect(fedTraceState().phase).toBe('loading')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('under reduced motion: no exit — removed at the end of the hold, and at once on a cancel', () => {
    reduce(true)
    add('a')
    useShell.getState().patchUpload('a', { stage: 'ready', done: true })
    useShell.getState().dropUpload('a')
    vi.advanceTimersByTime(900)
    expect(fedTraceState().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
    add('b')
    useShell.getState().dropUpload('b')
    expect(fedTraceState().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the landing page’s first load is never tracked', () => {
    useShell.setState({ booted: false })
    add('a')
    useShell.getState().patchUpload('a', { stage: 'ready', done: true })
    useShell.setState({ booted: true, federation: fedOf(400) })
    useShell.getState().dropUpload('a')
    expect(fedTraceState().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })
})

/* ─────────────────────────── the pieces drawn ─────────────────────────── */

describe('the components', () => {
  const loadingView = fedView(run([snap(true, [row('Tower B', 'reading file')])]))
  const joinedView = fedView(run([snap(true, [row('a', 'ready', { done: true })], 1), snap(true, [], 4083)]))

  it('idle: both absent, not hidden', () => {
    expect(renderToStaticMarkup(createElement(FedLine, { view: null }))).toBe('')
    expect(renderToStaticMarkup(createElement(FedCaption, { view: null }))).toBe('')
  })

  it('the line: five segments, aria-hidden, no pointer events, a glint on the current one only', () => {
    const html = renderToStaticMarkup(createElement(FedLine, { view: loadingView }))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('pointer-events:none')
    expect(html.match(/data-seg=/g)).toHaveLength(5)
    expect(html.match(/ifcsweep/g)).toHaveLength(1)
    expect(renderToStaticMarkup(createElement(FedLine, { view: joinedView }))).not.toContain('ifcsweep')
  })

  it('the caption: role=status, no pointer events, the text in its parts', () => {
    const html = renderToStaticMarkup(createElement(FedCaption, { view: loadingView }))
    expect(html).toContain('role="status"')
    expect(html).toContain('pointer-events:none')
    expect(html).toContain('Tower B.ifc')
    expect(html).toContain('reading file')
    expect(html).toContain('1/5')
    const joined = renderToStaticMarkup(createElement(FedCaption, { view: joinedView }))
    expect(joined).toContain('+4\u2009082 elements')
    expect(joined).toContain('ifcpop')
  })

  it('tokens only: no literal colour in either piece', () => {
    for (const src of ['src/renderer/app/FedTrace.tsx', 'src/renderer/styles/fed-trace.css']) {
      const text = readFileSync(join(ROOT, src), 'utf8')
      expect(text, src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
    }
  })

  it('the centre badge is not drawn while the indicator is up, and is as before otherwise', () => {
    vi.useFakeTimers()
    const stop = onFedTrace(() => {})
    try {
      // A server render reads zustand's initial state (`ready: false`, the boot's message); the
      // indicator's state is read live. Idle: the badge, as designed.
      useShell.setState({ ...INITIAL, booted: true, uploads: [] }, true)
      expect(renderToStaticMarkup(createElement(LoadingBadge))).toContain(INITIAL.loadMsg)
      useShell.getState().addUpload({ id: 'q', name: 'q.ifc', stage: 'ready', pct: 100, done: true })
      expect(renderToStaticMarkup(createElement(LoadingBadge))).toBe('')
    } finally {
      stop()
      vi.useRealTimers()
      useShell.setState(INITIAL, true)
    }
  })
})

describe('it reaches nothing it should not', () => {
  it('imports nothing from viewer/, and uses no frame loop or interval', () => {
    for (const src of [
      'src/shared/fed-trace.ts',
      'src/renderer/model/fed-trace-store.ts',
      'src/renderer/app/FedTrace.tsx'
    ]) {
      const text = readFileSync(join(ROOT, src), 'utf8')
      expect(text, src).not.toMatch(/from ['"][^'"]*viewer\//)
      expect(text, src).not.toMatch(/requestAnimationFrame|setInterval|invalidate\(/)
    }
  })
})
