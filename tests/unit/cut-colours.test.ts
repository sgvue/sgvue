/**
 * The section cut in each model's own colour (2026-11-07, owner-requested: *"Update the section
 * cut lines color on the different models to match with the color code assigned to the
 * model."*).
 *
 * Three links, each checked on its own: `sectionCut` tags every segment with the model it was
 * cut from; `cutColours` turns the tags into per-instance colours, the accent for a model with
 * none; and the store pushes the viewer exactly the swatch each MODELS row shows — the default
 * palette, a library swatch, an override — and nothing when that map has not changed.
 */
import { Color, MeshBasicMaterial } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planeFromLevel } from '../../src/shared/annotate'
import { MC } from '../../src/shared/colors'
import { federate } from '../../src/shared/federate'
import { SAMPLE_FILES, mockGeometryChunks, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { cutSwatch, modelRows, modelSwatches } from '../../src/renderer/state/selectors/models'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import { createBatchStore } from '../../src/renderer/viewer/batches'
import { createPartState } from '../../src/renderer/viewer/part-state'
import { THEMES } from '../../src/renderer/viewer/materials'
import { cutColours, sectionCut, type RGB } from '../../src/renderer/viewer/section-cut'
import { resetShell, stubViewer } from './stub-viewer'

const MATERIALS = {
  parts: createPartState(),
  solid: new MeshBasicMaterial(),
  ghost: new MeshBasicMaterial(),
  glass: new MeshBasicMaterial(),
  space: new MeshBasicMaterial()
}

/** The segments as rounded strings, so two cuts can be compared as sets. */
const segKeys = (segments: Float32Array, count: number, keep: (i: number) => boolean = () => true): string[] => {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    if (!keep(i)) continue
    out.push([...segments.subarray(i * 6, i * 6 + 6)].map((v) => v.toFixed(5)).join(','))
  }
  return out.sort()
}

describe('sectionCut tags each segment with its model', () => {
  const plane = planeFromLevel(1.2, false)
  const both = createBatchStore()
  const arc = createBatchStore()
  const str = createBatchStore()
  for (const c of mockGeometryChunks('ARC')) {
    both.addChunk(c, 0, MATERIALS)
    arc.addChunk(c, 0, MATERIALS)
  }
  for (const c of mockGeometryChunks('STR')) {
    both.addChunk(c, 1, MATERIALS)
    str.addChunk(c, 1, MATERIALS)
  }

  it('tags exactly the segments each model gives on its own', () => {
    const r = sectionCut(both, [plane], () => true)
    expect(r.models.sort()).toEqual(['ARC', 'STR'])
    expect(r.modelOf).toHaveLength(r.count)
    const a = sectionCut(arc, [plane], () => true)
    const s = sectionCut(str, [plane], () => true)
    expect(a.count).toBeGreaterThan(0)
    expect(s.count).toBeGreaterThan(0)
    expect(r.count).toBe(a.count + s.count)
    const tagOf = (key: string): number => r.models.indexOf(key)
    expect(segKeys(r.segments, r.count, (i) => r.modelOf[i] === tagOf('ARC'))).toEqual(
      segKeys(a.segments, a.count)
    )
    expect(segKeys(r.segments, r.count, (i) => r.modelOf[i] === tagOf('STR'))).toEqual(
      segKeys(s.segments, s.count)
    )
  })

  it('keeps the segments themselves as they were', () => {
    // One model: one tag, and the segments the single-model cut gives, float for float.
    const one = sectionCut(arc, [plane], () => true)
    expect(one.models).toEqual(['ARC'])
    expect([...one.modelOf].every((t) => t === 0)).toBe(true)
    expect(sectionCut(both, [], () => true)).toMatchObject({ count: 0, models: [] })
  })
})

describe('cutColours', () => {
  const ACCENT: RGB = [0, 0.5, 0.5]
  const cut = { count: 3, models: ['A', 'B'], modelOf: new Uint16Array([0, 1, 0]) }

  it('gives each segment its model’s colour at both ends', () => {
    const colour: Record<string, RGB> = { A: [1, 0, 0], B: [0, 0, 1] }
    expect([...cutColours(cut, (k) => colour[k], ACCENT)]).toEqual([
      1, 0, 0, 1, 0, 0,
      0, 0, 1, 0, 0, 1,
      1, 0, 0, 1, 0, 0
    ])
  })

  it('falls back to the accent for a model the map does not name', () => {
    const colour: Record<string, RGB> = { A: [1, 0, 0] }
    const out = [...cutColours(cut, (k) => colour[k] ?? null, ACCENT)]
    expect(out.slice(6, 12)).toEqual([0, 0.5, 0.5, 0, 0.5, 0.5])
    expect(out.slice(0, 6)).toEqual([1, 0, 0, 1, 0, 0])
    expect(cutColours({ count: 0, models: [], modelOf: new Uint16Array(0) }, () => null, ACCENT)).toHaveLength(0)
  })
})

describe('the cut colours are the MODELS rows’ swatches', () => {
  const federation = federate([mockModelIndex('ARC'), mockModelIndex('STR'), mockModelIndex('SIT')])
  const library = SAMPLE_FILES.map((f) => ({ key: f.key, name: f.name, file: f.file, swatch: f.swatch }))
  const rowsOf = (lib: typeof library, modelColors: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
      modelRows({
        federation,
        files: [],
        library: lib,
        modelVis: {},
        modelColors,
        nativeMats: true,
        uploadNames: {},
        active: null,
        palette: null,
        confirmRemove: null
      }).map((r) => [r.key, r.swatch])
    )

  it('matches the row for the slot palette, a library swatch and an override', () => {
    // No library: the design's model palette by slot — but slot 0's neutral grey is no colour of
    // its own, so ARC is left out and the viewer draws it in the accent (the next block).
    expect(rowsOf([], {})).toEqual({ ARC: MC[0], STR: MC[1], SIT: MC[2] })
    expect(modelSwatches(federation, [], {})).toEqual({ STR: MC[1], SIT: MC[2] })
    // The library's own swatches.
    expect(modelSwatches(federation, library, {})).toEqual(rowsOf(library, {}))
    expect(modelSwatches(federation, library, {})).toEqual({ ARC: '#D8D2C6', STR: '#9AA5A3', SIT: '#8FAE82' })
    // An override wins, whatever "Original materials" says — the row shows it either way.
    const ov = { STR: '#E05A6B' }
    expect(modelSwatches(federation, library, ov)).toEqual(rowsOf(library, ov))
    expect(modelSwatches(federation, library, ov).STR).toBe('#E05A6B')
  })

  describe('pushed by the store', () => {
    let pushed: Record<string, string>[] = []
    beforeEach(() => {
      resetShell()
      pushed = []
      setViewer(stubViewer({ setCutColors: (m: Record<string, string> | null) => pushed.push(m ?? {}) }))
    })
    afterEach(() => setViewer(null))

    it('when the viewer is handed in, the federation, the library or an override changes — and only then', () => {
      expect(pushed).toEqual([{}])
      useShell.getState().commitModels(federation)
      expect(pushed.at(-1)).toEqual({ STR: MC[1], SIT: MC[2] })
      useShell.getState().setLibrary(library)
      expect(pushed.at(-1)).toEqual({ ARC: '#D8D2C6', STR: '#9AA5A3', SIT: '#8FAE82' })
      useShell.getState().setModelColor('ARC', '#7B8CF0')
      expect(pushed.at(-1)).toEqual({ ARC: '#7B8CF0', STR: '#9AA5A3', SIT: '#8FAE82' })
      // "Original materials" changes nothing the row shows, so nothing is pushed.
      const n = pushed.length
      useShell.getState().toggleNative()
      useShell.getState().setLibrary([...library])
      expect(pushed).toHaveLength(n)
      useShell.getState().setModelColor('ARC', null)
      expect(pushed.at(-1)).toEqual({ ARC: '#D8D2C6', STR: '#9AA5A3', SIT: '#8FAE82' })
      // Each push equals what the rows show at that moment.
      const s = useShell.getState()
      expect(pushed.at(-1)).toEqual(rowsOf(s.library as typeof library, s.modelColors))
    })
  })
})

describe('a model whose row shows the neutral grey is cut in the accent (owner: "Yes, keep accent")', () => {
  // One real file at slot 0 — its row shows `MC[0]`, no colour of its own — beside the demo's
  // STR at slot 1, whose row shows the palette's `MC[1]`.
  const federation = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
  const cut = { count: 2, models: ['ARC', 'STR'], modelOf: new Uint16Array([0, 1]) }
  /** The viewer's own path: `setCutColors`' map → working-space RGB → `cutColours` with the theme's accent. */
  const drawn = (modelColors: Record<string, string>, theme: keyof typeof THEMES): { ARC: RGB; STR: RGB } => {
    const map = modelSwatches(federation, [], modelColors)
    const rgb = (hex: string | number): RGB => {
      const c = new Color(hex)
      return [c.r, c.g, c.b]
    }
    const out = cutColours(cut, (k) => (map[k] ? rgb(map[k]) : null), rgb(THEMES[theme].accent))
    return { ARC: [out[0], out[1], out[2]], STR: [out[6], out[7], out[8]] }
  }
  /** As the instance buffer holds it: float32. */
  const rgbOf = (hex: string | number): RGB => {
    const c = new Color(hex)
    const f = new Float32Array([c.r, c.g, c.b])
    return [f[0], f[1], f[2]]
  }

  it('the default-grey row takes the accent, in either theme', () => {
    expect(cutSwatch('ARC', 0, [], {})).toBeNull()
    expect(cutSwatch('ARC', MC.length, [], {})).toBeNull()
    for (const theme of ['dark', 'light'] as const) {
      expect(drawn({}, theme).ARC).toEqual(rgbOf(THEMES[theme].accent))
    }
    expect(THEMES.dark.accent).not.toBe(THEMES.light.accent)
  })

  it('a user-picked colour is that colour — even the grey itself', () => {
    for (const theme of ['dark', 'light'] as const) {
      expect(drawn({ ARC: '#E05A6B' }, theme).ARC).toEqual(rgbOf('#E05A6B'))
      expect(drawn({ ARC: MC[0] }, theme).ARC).toEqual(rgbOf(MC[0]))
    }
    expect(cutSwatch('ARC', 0, [], { ARC: MC[0] })).toBe(MC[0])
  })

  it('a palette colour of its own (the demo’s `MC[slot]`) or a library swatch is that colour', () => {
    for (const theme of ['dark', 'light'] as const) {
      expect(drawn({}, theme).STR).toEqual(rgbOf(MC[1]))
    }
    expect(cutSwatch('STR', 1, [], {})).toBe(MC[1])
    expect(cutSwatch('ARC', 0, [{ key: 'ARC', name: 'A', file: 'A.ifc', swatch: '#D8D2C6' }], {})).toBe('#D8D2C6')
  })
})
