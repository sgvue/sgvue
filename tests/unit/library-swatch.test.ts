/**
 * A loaded real file finds its library entry by its path (the 2026-11-07 fix).
 *
 * A real library entry is a recent (`upload-pipeline.ts` `libraryOf`): its `key` is the file's
 * **path**. A loaded model's key is `modelKeyOf(name)` — the stem — and the path the federation
 * holds for it is `sessionFiles()`' `{ key, path }`. The MODELS row, the section cut and the
 * Spatial-structure card used to look the entry up by `f.key === modelKey`, which a real file
 * never satisfies, so its row always showed `MC[slot]`. The design's own entries (the `#mock`
 * library, `SAMPLE_FILES`) have no path and are still found by key.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MC } from '../../src/shared/colors'
import { federate } from '../../src/shared/federate'
import { SAMPLE_FILES, mockModelIndex } from '../../src/renderer/dev/mock-adapter'
import { libraryOf } from '../../src/renderer/model/upload-pipeline'
import {
  baseSwatch,
  cutSwatch,
  libraryEntry,
  modelRows,
  modelSwatches,
  type ModelInput
} from '../../src/renderer/state/selectors/models'
import { spatialCards } from '../../src/renderer/state/selectors/spatial'
import { setModelFiles, setViewer, useShell } from '../../src/renderer/state/shell'
import { resetShell, stubViewer } from './stub-viewer'

// Two real files, loaded as models `ARC` (slot 0) and `STR` (slot 1). A recent's swatch is the
// design's palette by its place in the list (`libraryOf`): Tower A, second, `#E8A33D`; Tower B,
// third, `#E05A6B` — neither the model palette's `MC[slot]` for its slot.
const ARC_PATH = '/Models/Tower/Tower A.ifc'
const STR_PATH = '/Models/Tower/Tower B.ifc'
const A = '#E8A33D'
const B = '#E05A6B'
const library = libraryOf([
  { path: '/Models/Other.ifc', name: 'Other.ifc' },
  { path: ARC_PATH, name: 'Tower A.ifc' },
  { path: STR_PATH, name: 'Tower B.ifc' }
])
const files = [
  { key: 'ARC', path: ARC_PATH },
  { key: 'STR', path: STR_PATH }
]
const federation = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
const input: ModelInput = {
  federation,
  files,
  library,
  modelVis: {},
  modelColors: {},
  nativeMats: true,
  uploadNames: {},
  active: null,
  palette: null,
  confirmRemove: null
}

describe('a real file’s library entry is found by its path', () => {
  it('the fixture is real-file shaped: the entry’s key is the path, not the model key', () => {
    expect(library.map((f) => f.key)).toEqual(['/Models/Other.ifc', ARC_PATH, STR_PATH])
    expect(library[1]).toMatchObject({ swatch: A, path: ARC_PATH })
    expect(library[2]).toMatchObject({ swatch: B, path: STR_PATH })
    expect([A, B]).not.toContain(MC[0])
    expect([A, B]).not.toContain(MC[1])
  })

  it('libraryEntry: by path when the model has one, by key for the design’s own entries', () => {
    expect(libraryEntry('ARC', ARC_PATH, library)).toBe(library[1])
    expect(libraryEntry('STR', STR_PATH, library)).toBe(library[2])
    // A path not in the recents (an unadmitted drop) finds nothing — never a guess by name.
    expect(libraryEntry('ARC', '/elsewhere/Tower A.ifc', library)).toBeUndefined()
    expect(libraryEntry('ARC', undefined, library)).toBeUndefined()
    // The mock library: no paths, keyed by model key.
    const mock = SAMPLE_FILES.map((f) => ({ key: f.key, name: f.name, file: f.file, swatch: f.swatch }))
    expect(libraryEntry('ARC', undefined, mock)?.swatch).toBe('#D8D2C6')
  })

  it('the MODELS row shows the library swatch, not `MC[slot]`', () => {
    const rows = modelRows(input)
    expect(rows.map((r) => [r.key, r.swatch])).toEqual([
      ['ARC', A],
      ['STR', B]
    ])
    // The list reorders — a pill reopened — and each row follows its own file's entry.
    const later = libraryOf([
      { path: STR_PATH, name: 'Tower B.ifc' },
      { path: ARC_PATH, name: 'Tower A.ifc' }
    ])
    expect(modelRows({ ...input, library: later }).map((r) => r.swatch)).toEqual([
      later[1].swatch,
      later[0].swatch
    ])
    // Without the paths the federation holds, nothing ties the model to its entry.
    expect(modelRows({ ...input, files: [] }).map((r) => r.swatch)).toEqual([MC[0], MC[1]])
  })

  it('the section cut takes the same colour — a library swatch is a colour of its own', () => {
    expect(baseSwatch('ARC', 0, library, ARC_PATH)).toBe(A)
    expect(cutSwatch('ARC', 0, library, {}, ARC_PATH)).toBe(A)
    // Slot 0 with no entry is still the neutral grey, cut in the accent.
    expect(cutSwatch('ARC', 0, library, {}, '/elsewhere/x.ifc')).toBeNull()
    expect(modelSwatches(federation, library, {}, files)).toEqual({ ARC: A, STR: B })
    const rows = Object.fromEntries(modelRows(input).map((r) => [r.key, r.swatch]))
    expect(modelSwatches(federation, library, {}, files)).toEqual(rows)
    // An override still wins.
    expect(modelSwatches(federation, library, { ARC: '#7B8CF0' }, files).ARC).toBe('#7B8CF0')
  })

  it('the Spatial-structure card’s model swatch agrees with the row', () => {
    const cards = spatialCards({
      federation,
      files,
      library,
      coords: { E: null, N: null, Z: null, angle: null },
      uploadNames: {}
    })
    const projects = cards.filter((c) => c.type === 'IfcProject')
    expect(projects.map((c) => c.swatch)).toEqual([A, B])
  })

  describe('pushed by the store, with the paths the federation holds', () => {
    let pushed: Record<string, string>[] = []
    beforeEach(() => {
      resetShell()
      pushed = []
      setModelFiles(() => files)
      setViewer(stubViewer({ setCutColors: (m: Record<string, string> | null) => pushed.push(m ?? {}) }))
    })
    afterEach(() => {
      setViewer(null)
      setModelFiles(() => [])
    })

    it('the viewer is given the rows’ colours', () => {
      useShell.getState().commitModels(federation)
      // Before the recents arrive: the model palette, slot 0's grey left to the accent.
      expect(pushed.at(-1)).toEqual({ STR: MC[1] })
      useShell.getState().setLibrary(library)
      expect(pushed.at(-1)).toEqual({ ARC: A, STR: B })
    })
  })
})
