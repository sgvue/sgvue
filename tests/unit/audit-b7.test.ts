/**
 * Audit B7 — main-window items.
 *
 *   1. Preferences › Model is a draft saved once, on Enter or blur (`modelToSave`), never per keystroke.
 *   2. The Spatial-structure card names the file's own CRS, not always "(SVY21)".
 *   6a. `set_storeys`' held label names each storey once, and is bounded.
 *   6b. Three guard paths the deep review found unpinned (already true).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { federate } from '../../src/shared/federate'
import { MODEL_ID_MAX } from '../../src/shared/ipc-contract'
import { visFn } from '../../src/shared/rules'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { modelToSave } from '../../src/renderer/app/model-draft'
import { spatialCards } from '../../src/renderer/state/selectors/spatial'
import { setViewer, useShell, type ShellState } from '../../src/renderer/state/shell'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

const ROOT = join(__dirname, '..', '..')
const source = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

/* ────────────────────────────── 1. Preferences › Model ────────────────────────────── */

describe('1. Preferences › Model — modelToSave', () => {
  it('saves nothing for a blank, whitespace-only, unchanged or over-long draft', () => {
    expect(modelToSave('', 'claude-sonnet-5-5')).toBeNull()
    expect(modelToSave('   ', 'claude-sonnet-5-5')).toBeNull()
    expect(modelToSave('claude-sonnet-5-5', 'claude-sonnet-5-5')).toBeNull()
    expect(modelToSave('  claude-sonnet-5-5 ', 'claude-sonnet-5-5')).toBeNull()
    expect(modelToSave('x'.repeat(MODEL_ID_MAX + 1), 'claude-sonnet-5-5')).toBeNull()
  })
  it('saves a new id, trimmed', () => {
    expect(modelToSave('  claude-opus-5 ', 'claude-sonnet-5-5')).toBe('claude-opus-5')
    expect(modelToSave('x'.repeat(MODEL_ID_MAX), 'y')).toBe('x'.repeat(MODEL_ID_MAX))
  })
  it('the Model input does not save per keystroke: its onChange sets a draft, blur / Enter go through modelToSave', () => {
    const src = source('src/renderer/app/Preferences.tsx')
    const at = src.indexOf('>Model</span>')
    expect(at).toBeGreaterThan(0)
    const input = src.slice(at, src.indexOf('/>', at))
    const onChange = /onChange=\{([^}]*)\}/.exec(input)?.[1] ?? ''
    expect(onChange).not.toBe('')
    expect(onChange).not.toMatch(/patch\(|setSettings\(/)
    expect(input).toMatch(/onBlur=/)
    expect(input).toMatch(/Enter/)
    expect(src).toMatch(/modelToSave\(/)
  })
})

/* ────────────────────────────── 2. Spatial-structure CRS ────────────────────────────── */

describe('2. the Spatial-structure card names the file’s own CRS', () => {
  const federation = federate([mockModelIndex('ARC')])
  const coords = { E: 28500, N: 30200, Z: 102.5, angle: 12.5 }
  const row = (crs?: string): string =>
    spatialCards({ federation, library: [], coords, uploadNames: {}, ...(crs === undefined ? {} : { crs }) })
      .find((c) => c.type === 'IfcSite')!
      .rows.find((r) => r.k === 'Easting / Northing')!.v

  it('crs omitted → the design’s literal (SVY21)', () => {
    expect(row()).toBe('28,500.000 E · 30,200.000 N (SVY21)')
  })
  it('crs SVY21 → (SVY21)', () => {
    expect(row('SVY21')).toBe('28,500.000 E · 30,200.000 N (SVY21)')
  })
  it('crs the em dash or empty → no parenthesis', () => {
    expect(row('—')).toBe('28,500.000 E · 30,200.000 N')
    expect(row('')).toBe('28,500.000 E · 30,200.000 N')
  })
  it('another CRS → its own name', () => {
    expect(row('EPSG:27700')).toBe('28,500.000 E · 30,200.000 N (EPSG:27700)')
  })
  it('ProjectCard passes crsChip(georefSource).short', () => {
    const src = source('src/renderer/app/ProjectCard.tsx')
    expect(src).toMatch(/crs:\s*crsChip\(st\.georefSource\)\.short/)
    expect(src).toMatch(/pick\([^)]*'georefSource'/)
  })
})

/* ────────────────────────────── 6. set_storeys ────────────────────────────── */

interface Body {
  message?: string
  [key: string]: unknown
}

const NAMES = ['Foundation', 'L1', 'L2', 'L3', 'L4', 'Roof']
const turn = newTurnState()
const ctx = (): ToolContext => ({
  state: () => useShell.getState(),
  sql: (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as never,
  rawLine: async () => null,
  turn
})
const run = async (input: unknown): Promise<Body> => (await executeTool('set_storeys', input, ctx())) as Body
const fresh = (): void => void Object.assign(turn, newTurnState())
const st = (): ShellState => useShell.getState()
const visible = (): number => st().federation.elements.filter(visFn(st())).length

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetShell()
  setViewer(stubViewer())
  fresh()
})
afterEach(() => {
  setViewer(null)
  vi.unstubAllGlobals()
})

const mockFull = () => federate(['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k)))

describe('6a. set_storeys’ held label', () => {
  it('names a storey once when two models carry it at different elevations', async () => {
    const indexes = ['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k))
    const str = indexes[1]
    ;(str as { storeys: unknown }).storeys = str.storeys.map((s) =>
      s.name === 'Roof' ? { ...s, guid: 'roof-str-own', elev: s.elev + 0.5 } : s
    )
    const fed = federate(indexes)
    expect(fed.storeys.filter((s) => s.name === 'Roof').length).toBe(2)
    st().commitModels(fed)

    const body = await run({ visible: ['Roof'] })

    expect(body.pending).toBe(true)
    const label = turn.pending!.label
    expect(label.match(/Roof/g)).toHaveLength(1)
  })

  it('bounds the list on a tall building', async () => {
    const indexes = ['ARC', 'STR', 'SIT', 'MEP'].map((k) => mockModelIndex(k))
    const arc = indexes[0]
    const base = arc.storeys[arc.storeys.length - 1]
    const extra = Array.from({ length: 20 }, (_, i) => ({
      ...base,
      guid: `extra-${i}`,
      name: `S${String(i + 1).padStart(2, '0')}`,
      elev: base.elev + 10 + i
    }))
    ;(arc as { storeys: unknown }).storeys = [...arc.storeys, ...extra]
    st().commitModels(federate(indexes))

    const body = await run({ visible: ['Roof', ...extra.map((s) => s.name)] })

    expect(body.pending).toBe(true)
    const label = turn.pending!.label
    expect(label).toMatch(/more/)
    expect(label).not.toContain('S20')
  })
})

describe('6b. guard paths (pinned; already true)', () => {
  it('turn.acted stays false on the held, refused and already paths', async () => {
    st().commitModels(mockFull())
    await run({ visible: ['Roof'] })
    expect(turn.pending).not.toBeNull()
    expect(turn.acted).toBe(false)

    fresh()
    st().hide(st().federation.elements.filter((e) => e.storey === 'Roof').map((e) => e.id))
    await run({ visible: ['Roof'] })
    expect(turn.pending).toBeNull()
    expect(turn.acted).toBe(false)

    fresh()
    const already = await run({ visible: [] })
    expect(already.applied).toBe(false)
    expect(turn.acted).toBe(false)
  })

  it('from only Roof showing, set_storeys([Foundation]) — hides one, reveals another, 20 of 412 — is held', async () => {
    st().commitModels(mockFull())
    st().soloStorey('Roof', false, NAMES)
    expect(visible()).toBe(5)
    const body = await run({ visible: ['Foundation'] })
    expect(body).toMatchObject({ pending: true, wouldLeaveVisible: 20, totalElements: 412 })
    expect(visible()).toBe(5)
  })

  it('after isolating walls, set_storeys([L2]) — 19 of 412 — is held', async () => {
    st().commitModels(mockFull())
    st().isolate(st().federation.elements.filter((e) => e.type === 'IfcWall').map((e) => e.id))
    const body = await run({ visible: ['L2'] })
    expect(body).toMatchObject({ pending: true, wouldLeaveVisible: 19, totalElements: 412 })
  })
})
