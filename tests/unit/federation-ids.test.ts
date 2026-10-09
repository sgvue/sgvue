/**
 * Federation ids past a million lines — the first defect the 2026-10-09 capacity measurement
 * found (`reports/Large model capacity.md`, local).
 *
 * An element's federation id is `slot × stride + its express id`. The design's stride was
 * 1 000 000, and an IFC file passes a million lines at about 60–70 MB, so a real model numbered
 * into the next model's block: four 150 MB files federated together lost 1 146 elements to
 * shared ids and the SQL index would not build (`UNIQUE constraint failed: element.id`). The
 * stride is now `ID_STRIDE` (1 000 000 000), and a model that would still not fit is refused at
 * load, in its own upload row.
 *
 * Everything here runs under Node: the federation and the SQL build are the app's own modules
 * (the database through sql.js, as `tests/unit/sql-schema.test.ts` builds it), the load is
 * `FederationController.prepare` against a parse worker that never runs, and the upload row is
 * the real pipeline's.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  federate,
  fedId,
  fitsLocalId,
  ID_RANGE_REFUSAL,
  ID_STRIDE,
  LEGACY_ID_STRIDE,
  localIdRefusal,
  localOfId,
  MAX_LOCAL_ID,
  MAX_SLOT,
  slotOfId,
  type Federation
} from '../../src/shared/federate'
import type { GeometryChunk } from '../../src/shared/geometry-contract.types'
import type { IfcElement, ModelIndex } from '../../src/shared/model-index.types'
import { buildDatabase } from '../../src/worker/sql-schema'
import { mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { FederationController, federation } from '../../src/renderer/model/federation-store'
import { disposeUploads, queue } from '../../src/renderer/model/upload-pipeline'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import { viewpointHidden } from '../../src/renderer/state/selectors/views'
import { memoryStorage, resetShell, stubViewer } from './stub-viewer'

/* ────────────────────────────── the id itself ────────────────────────────── */

describe('fedId — one id per element, inside its model’s own block', () => {
  it('numbers express ids past a million, and around twelve million, exactly', () => {
    for (const local of [1, 999_999, 1_000_000, 2_348_438, 9_423_394, 12_000_000, 12_345_678, MAX_LOCAL_ID]) {
      for (const slot of [0, 1, 3, 17]) {
        const id = fedId(slot, local)
        expect(id).toBe(slot * ID_STRIDE + local)
        expect(Number.isSafeInteger(id)).toBe(true)
        expect([slotOfId(id), localOfId(id)]).toEqual([slot, local])
      }
    }
  })

  it('keeps the largest slot’s largest id an exact JavaScript integer, and refuses the next slot', () => {
    expect(MAX_SLOT).toBe(9_007_198)
    const top = fedId(MAX_SLOT, MAX_LOCAL_ID)
    expect(Number.isSafeInteger(top)).toBe(true)
    expect([slotOfId(top), localOfId(top)]).toEqual([MAX_SLOT, MAX_LOCAL_ID])
    expect(() => fedId(MAX_SLOT + 1, 0)).toThrow(RangeError)
    expect(() => fedId(-1, 5)).toThrow(RangeError)
    expect(() => fedId(1.5, 5)).toThrow(RangeError)
  })

  it('refuses a local id that would number into the next block — never a silent collision', () => {
    for (const bad of [ID_STRIDE, ID_STRIDE + 1, 4_294_967_295, -1, 1.5, Number.NaN, Infinity]) {
      expect(fitsLocalId(bad)).toBe(false)
      expect(() => fedId(0, bad)).toThrow(ID_RANGE_REFUSAL)
    }
    expect(fitsLocalId(0)).toBe(true)
    expect(fitsLocalId(MAX_LOCAL_ID)).toBe(true)
  })

  it('says so in the words the upload row shows', () => {
    expect(ID_RANGE_REFUSAL).toBe('entity ids above #999999999 are not supported')
    expect(localIdRefusal([1, 2_348_438, MAX_LOCAL_ID])).toBeNull()
    expect(localIdRefusal([1, ID_STRIDE, 3])).toBe(ID_RANGE_REFUSAL)
    expect(localIdRefusal([])).toBeNull()
  })

  it('is the design’s own block arithmetic, with the wider stride', () => {
    expect(ID_STRIDE).toBe(1_000 * LEGACY_ID_STRIDE)
    // Slot 0 is numbered the same either way: an older build reads a slot-0 id as its own.
    expect(fedId(0, 123_456)).toBe(0 * LEGACY_ID_STRIDE + 123_456)
  })
})

/* ────────────────────────────── a federation of large models ────────────────────────────── */

/**
 * A model of `n` elements numbered `first`, `first + step`, … — the mock's own elements,
 * recycled, so every one carries real property sets for the SQL build.
 */
function bigIndex(key: string, n: number, first: number, step: number): ModelIndex {
  const base = mockModelIndex('ARC')
  const elements: IfcElement[] = []
  for (let i = 0; i < n; i++) {
    const e = base.elements[i % base.elements.length]
    const id = first + i * step
    elements.push({ ...e, id, expressId: id, guid: `${key}-${i}`, model: key })
  }
  return { ...base, modelKey: key, fileName: `${key}.ifc`, sha256: key.padEnd(64, '0'), elements }
}

/**
 * Four models shaped like the measured 150 MB files — element ids up to #2 348 001 — and one
 * whose ids sit around twelve million, a 600 MB file's worth of lines and more.
 */
const LARGE = [
  bigIndex('A', 2349, 1, 1000),
  bigIndex('B', 2349, 1, 1000),
  bigIndex('C', 2349, 1, 1000),
  bigIndex('D', 2349, 1, 1000),
  bigIndex('E', 3000, 11_990_001, 7)
]
const TOTAL = LARGE.reduce((n, m) => n + m.elements.length, 0)

/** The rule of 7685cf2's `federate.ts:311`, verbatim: `slot * 1_000_000 + element.id`. */
const oldIds = (fed: Federation): number[] => {
  const slotOf = new Map(fed.models.map((m) => [m.meta.modelKey, m.slot]))
  return fed.elements.map((e) => slotOf.get(e.model)! * LEGACY_ID_STRIDE + e.localId)
}

describe('federate — large models side by side', () => {
  const fed = federate(LARGE)

  it('gives every element of every model an id of its own', () => {
    expect(fed.elements).toHaveLength(TOTAL)
    expect(new Set(fed.elements.map((e) => e.id)).size).toBe(TOTAL)
    expect(fed.byId.size).toBe(TOTAL)
  })

  it('keeps each id in its model’s block, its express id readable off it', () => {
    const slotOf = new Map(fed.models.map((m) => [m.meta.modelKey, m.slot]))
    for (const e of fed.elements) {
      expect(slotOfId(e.id)).toBe(slotOf.get(e.model))
      expect(localOfId(e.id)).toBe(e.localId)
    }
    expect(fed.byId.get(4 * ID_STRIDE + 12_010_994)?.model).toBe('E')
  })

  it('is what the design’s stride got wrong on the same models', () => {
    // Model A's #1 000 001 and model B's #1 were both 1 000 001, and so on down the blocks.
    const lost = TOTAL - new Set(oldIds(fed)).size
    expect(lost).toBeGreaterThan(4000)
  })
})

/* ────────────────────────────── the SQL index, built under Node ────────────────────────────── */

const require = createRequire(import.meta.url)
const DIST = dirname(require.resolve('sql.js'))
let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (file) => join(DIST, file) })
})

describe('the SQL index of a federation of large models', () => {
  const fed = federate(LARGE)

  it('builds, one row per element, every id an exact INTEGER', () => {
    const db = buildDatabase(SQL, { models: fed.models, elements: fed.elements })
    try {
      const [[count]] = db.exec('SELECT COUNT(*) FROM element')[0].values
      expect(count).toBe(TOTAL)
      // Past 2^31 sql.js binds a double; the INTEGER affinity stores it as an exact integer.
      expect(db.exec('SELECT DISTINCT typeof(id) FROM element')[0].values).toEqual([['integer']])
      const [[max]] = db.exec('SELECT MAX(id) FROM element')[0].values
      expect(max).toBe(4 * ID_STRIDE + 12_010_994)
      expect(max).toBe(Math.max(...fed.elements.map((e) => e.id)))
      // A join through a large id lands on its own element's rows.
      const id = fedId(4, 11_990_001)
      const rows = db.exec(
        `SELECT e.model, e.local_id, COUNT(a.element) FROM element e JOIN attribute a ON a.element = e.id WHERE e.id = ${id} GROUP BY e.id`
      )[0].values
      expect(rows).toEqual([['E', 11_990_001, expect.any(Number)]])
      expect(rows[0][2]).toBeGreaterThan(0)
      // The model table states each block.
      expect(db.exec('SELECT key, slot FROM model ORDER BY slot')[0].values).toEqual([
        ['A', 0],
        ['B', 1],
        ['C', 2],
        ['D', 3],
        ['E', 4]
      ])
    } finally {
      db.close()
    }
  })

  it('was refused with the design’s stride — the measured failure, reproduced', () => {
    const ids = oldIds(fed)
    const elements = fed.elements.map((e, i) => ({ ...e, id: ids[i] }))
    expect(() => buildDatabase(SQL, { models: fed.models, elements })).toThrow(
      /UNIQUE constraint failed: element\.id/
    )
  })
})

/* ────────────────────────────── refused at load ────────────────────────────── */

describe('a model whose ids would not fit is refused at load, in its own row', () => {
  /** A parse worker that never runs: one index, and one chunk of geometry. */
  function fakeParse(
    on: FederationController,
    index: ModelIndex,
    chunks: GeometryChunk[] = mockGeometryChunks('ARC')
  ): { closed: string[]; streamed: string[]; offsets: unknown[] } {
    const closed: string[] = []
    const streamed: string[] = []
    /** The federation offset each stream was asked for: `null` is "this model sets it". */
    const offsets: unknown[] = []
    const parse = {
      load: async (_blob: Blob, key: string) => ({ ...index, modelKey: key }),
      geometry: async (key: string, offset: unknown, frame: unknown, onChunk: (c: GeometryChunk) => void) => {
        streamed.push(key)
        offsets.push(offset)
        for (const chunk of chunks) onChunk({ ...chunk, header: { ...chunk.header, modelKey: key } })
        return { offset: [10, 20, 0], offsetFromThisModel: offset === null, frame, chunks: chunks.length, warnings: [] }
      },
      close: (key: string) => void closed.push(key),
      cancel: () => {}
    }
    ;(on as unknown as { parse: typeof parse }).parse = parse
    return { closed, streamed, offsets }
  }
  const pick = (key: string): { path: string; name: string; blob: Blob; key: string } => ({
    path: `/x/${key}.ifc`,
    name: `${key}.ifc`,
    blob: new Blob([]),
    key
  })

  let fed: FederationController
  beforeEach(() => {
    resetShell()
    fed = new FederationController()
  })
  afterEach(() => fed.dispose())

  it('an element id past the block: refused before its geometry streams, its file closed', async () => {
    const tooHigh = bigIndex('HIGH', 10, ID_STRIDE - 5, 1)
    const { closed, streamed } = fakeParse(fed, tooHigh)
    await expect(fed.prepare(pick('HIGH'), () => {})).rejects.toThrow(ID_RANGE_REFUSAL)
    expect(streamed).toEqual([])
    expect(closed).toEqual(['HIGH'])
  })

  it('a drawn part past the block (a product the index does not list): refused too', async () => {
    const chunk = mockGeometryChunks('ARC')[0]
    const stray: GeometryChunk = { ...chunk, parts: [...chunk.parts, { ...chunk.parts[0], elementId: ID_STRIDE + 7 }] }
    const { closed, streamed } = fakeParse(fed, bigIndex('STRAY', 10, 1, 1), [stray])
    await expect(fed.prepare(pick('STRAY'), () => {})).rejects.toThrow(ID_RANGE_REFUSAL)
    expect(streamed).toEqual(['STRAY'])
    expect(closed).toEqual(['STRAY'])
    // Nothing of it fixed the federation: the next model is asked to set the offset itself.
    const next = fakeParse(fed, bigIndex('NEXT', 10, 1, 1))
    const item = await fed.prepare(pick('NEXT'), () => {})
    expect(item.index.modelKey).toBe('NEXT')
    expect(next.offsets).toEqual([null])
    expect(next.closed).toEqual([])
  })

  it('a model of twelve million lines loads', async () => {
    fakeParse(fed, bigIndex('BIG', 3000, 11_990_001, 7))
    const item = await fed.prepare(pick('BIG'), () => {})
    expect(item.index.elements).toHaveLength(3000)
  })
})

describe('the refusal reaches the designed upload row', () => {
  const INITIAL = useShell.getState()
  let restore = (): void => {}

  beforeEach(() => {
    vi.useFakeTimers()
    useShell.setState({ ...INITIAL, uploads: [], initErr: '' }, true)
    vi.stubGlobal('window', { sgvue: { addRecent: async () => [] } })
    const real = (federation as unknown as { parse: unknown }).parse
    restore = () => void ((federation as unknown as { parse: unknown }).parse = real)
    ;(federation as unknown as { parse: unknown }).parse = {
      load: async (_blob: Blob, key: string) => ({ ...bigIndex('HIGH', 3, ID_STRIDE + 1, 1), modelKey: key }),
      geometry: async () => {
        throw new Error('geometry must not stream for a refused model')
      },
      close: () => {},
      cancel: () => {}
    }
  })

  afterEach(() => {
    disposeUploads()
    restore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('names the file, says why, and the landing page’s banner says it too', async () => {
    const file = new File(['ISO-10303-21;'], 'high.ifc')
    expect(queue([{ path: 'C:\\m\\high.ifc', name: 'high.ifc', size: file.size, file }])).toBe(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(useShell.getState().uploads).toEqual([
      expect.objectContaining({ name: 'high.ifc', stage: ID_RANGE_REFUSAL, error: true, dismiss: true, pct: 0 })
    ])
    expect(useShell.getState().initErr).toBe(`Could not open that model — ${ID_RANGE_REFUSAL}.`)
  })
})

/* ────────────────────────────── viewpoints saved before 2026-10-09 ────────────────────────────── */

describe('viewpointHidden — a viewpoint’s ids on the live federation', () => {
  const here = (...ids: number[]): ((id: number) => boolean) => {
    const set = new Set(ids)
    return (id) => set.has(id)
  }

  it('restores one this build saved as it was saved', () => {
    const hidden = { 5: true, [ID_STRIDE + 2_348_438]: true }
    expect(viewpointHidden({ hidden, idStride: ID_STRIDE }, [0, 1], () => false)).toBe(hidden)
  })

  it('reads an older one by the design’s stride, against the elements that are here', () => {
    // A big model on slot 0 and another on slot 1: the old ids of #2 348 438 on slot 0 (itself),
    // of #7 on slot 1 (1 000 007) and an old id two elements shared (1 500 123).
    const old = { 2_348_438: true, 1_000_007: true, 1_500_123: true }
    const live = here(2_348_438, ID_STRIDE + 7, 1_500_123, ID_STRIDE + 500_123)
    expect(viewpointHidden({ hidden: old }, [0, 1], live)).toEqual({
      2_348_438: true,
      [ID_STRIDE + 7]: true,
      1_500_123: true,
      [ID_STRIDE + 500_123]: true
    })
  })

  it('hides nothing for a numbering it does not know', () => {
    expect(viewpointHidden({ hidden: { 5: true }, idStride: 77 }, [0], () => true)).toEqual({})
  })
})

describe('restoreView — an older viewpoint through the store', () => {
  const STR_LOCAL = mockModelIndex('STR').elements[0].id

  beforeEach(() => {
    resetShell()
    vi.stubGlobal('localStorage', memoryStorage())
    setViewer(null)
    useShell.getState().commitModels(federate([mockModelIndex('ARC'), mockModelIndex('STR')]))
    setViewer(stubViewer({ getCamera: () => null }))
  })
  afterEach(() => {
    setViewer(null)
    vi.unstubAllGlobals()
  })

  it('saves the numbering with a new one, and reads an older one onto the model it was on', () => {
    useShell.getState().saveView()
    const saved = useShell.getState().views[0]
    expect(saved.idStride).toBe(ID_STRIDE)
    // Saved before 2026-10-09: STR, on slot 1, was numbered 1 000 000 + its express id.
    const legacy = { ...saved, idStride: undefined, hidden: { [LEGACY_ID_STRIDE + STR_LOCAL]: true } }
    useShell.getState().restoreView(legacy)
    expect(useShell.getState().hidden).toEqual({ [ID_STRIDE + STR_LOCAL]: true })
    expect(useShell.getState().byId.get(ID_STRIDE + STR_LOCAL)?.model).toBe('STR')
  })
})
