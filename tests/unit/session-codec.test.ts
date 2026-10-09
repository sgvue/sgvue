/**
 * `src/shared/session-codec.ts` — the payload, the restore order, the link and the file checks.
 *
 * The restore order is the part of `applySession` that cannot be seen in a screenshot and is
 * easy to reorder by accident, so it is asserted call by call against a recording stub.
 *
 * 2026-10-01: the two section planes — `sections` written beside the old single `section` (the
 * plane that is cutting, when only one is), an old payload read onto the plane of its kind, and
 * `sectionsOf` coercing whatever a pasted link can carry, a name of any length included.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  applyRestore,
  canonicalFiles,
  checkFiles,
  decodeState,
  encodeState,
  idNumbering,
  legacySection,
  linkFor,
  payloadFromLink,
  PLANE_NAME_MAX,
  restorableIds,
  RESTORE_ORDER,
  sectionsOf,
  sessionOrder,
  sessionPatch,
  sessionPayload,
  type RestoreTarget,
  type SessionPayload,
  type SessionSource
} from '../../src/shared/session-codec'
import { NO_PLANE, NO_SECTIONS, sectionsLabel, type Sections } from '../../src/shared/sections'
import { ID_STRIDE, LEGACY_ID_STRIDE } from '../../src/shared/federate'

/** The live federation's project frame marker — `shared/georef.ts`'s `frameKey`. */
const FRAME = '12345.457,23456.766,5.050@-43.4103'

const source = (over: Partial<SessionSource> = {}): SessionSource => ({
  uploadNames: { ARC: 'arc.ifc' },
  hidden: { 7: true },
  storeyVis: { L2: false },
  modelVis: {},
  active: null,
  modelColors: { ARC: '#E05A6B' },
  nativeMats: false,
  treeMode: 'entity',
  grids: true,
  levels: false,
  shadows: true,
  theme: 'dark',
  snap: true,
  dims: false,
  sections: { grid: { name: 'C', offset: 1500, flip: true, cut: true }, level: NO_PLANE },
  stack: [],
  hlColor: '#35C4B6',
  view: 'iso',
  coords: { E: 28500, N: 30200, Z: 102.5, angle: 12.5 },
  units: 'mm',
  ...over
})

const payload = (over: Partial<SessionPayload> = {}): SessionPayload => ({
  ...sessionPayload(
    source(),
    ['ARC'],
    [{ key: 'ARC', path: '/m/arc.ifc', name: 'arc.ifc', sha256: 'aa' }],
    { theta: 1, phi: 2, dist: 70.31, half: 29.72, target: [1, 2, 3], proj: 'persp' },
    FRAME
  ),
  ...over
})

describe('sessionPayload', () => {
  it('carries the design’s own keys, in the design’s own order', () => {
    expect(Object.keys(payload())).toEqual([
      'models',
      'files',
      'uploadNames',
      'hidden',
      'storeyVis',
      'modelVis',
      'active',
      'modelColors',
      'nativeMats',
      'treeMode',
      'grids',
      'levels',
      'shadows',
      'theme',
      'snap',
      'dims',
      'section',
      'sections',
      'stack',
      'hlColor',
      'view',
      'coords',
      'cam',
      'frame',
      // 2026-10-09 — the port's: the display unit, which the design kept but never saved.
      'units',
      // 2026-10-09 — and how the element ids in `hidden` are numbered.
      'idStride'
    ])
  })

  it('says how its element ids are numbered (2026-10-09)', () => {
    expect(payload().idStride).toBe(ID_STRIDE)
  })

  it('records one file per model, with its path and hash', () => {
    expect(payload().files).toEqual([
      { key: 'ARC', path: '/m/arc.ifc', name: 'arc.ifc', sha256: 'aa' }
    ])
  })

  it('takes a null camera when there is no viewer, as the design does', () => {
    expect(sessionPayload(source(), [], [], null, FRAME).cam).toBeNull()
  })
})

describe('sessionPatch', () => {
  const live = source()

  it('uses the design’s literal defaults for the keys it states one for', () => {
    const p = sessionPatch({}, live)
    expect(p.hidden).toEqual({})
    expect(p.storeyVis).toEqual({})
    expect(p.modelVis).toEqual({})
    expect(p.active).toBeNull()
    expect(p.modelColors).toEqual({})
    expect(p.nativeMats).toBe(true)
    expect(p.snap).toBe(true)
    expect(p.dims).toBe(false)
    expect(p.stack).toEqual([])
    expect(p.shadows).toBe(true)
  })

  it('falls back to the live state for the keys the design falls back on', () => {
    const p = sessionPatch({}, live)
    expect(p.treeMode).toBe(live.treeMode)
    expect(p.grids).toBe(live.grids)
    expect(p.levels).toBe(live.levels)
    expect(p.sections).toEqual(live.sections)
    expect(p.hlColor).toBe(live.hlColor)
    expect(p.view).toBe(live.view)
  })

  it('never reads a base point back — the card is read-only, and the base point is the boot file’s (2026-10-08)', () => {
    // A payload's own, typed into a build from before then or written by this one, is ignored:
    // the restore carries no `coords` at all, so the live one stands.
    const p = sessionPatch({ coords: { E: 1, N: 2, Z: 3, angle: 4 } }, live)
    expect('coords' in p).toBe(false)
    expect(RESTORE_ORDER).not.toContain('coords')
    // It is still written, for an older build — which restores it over its own reading.
    expect(payload().coords).toEqual(live.coords)
  })

  it('keeps a false the payload actually carries — `pick` tests for undefined, not falsiness', () => {
    expect(sessionPatch({ grids: false, snap: false, nativeMats: false }, live)).toMatchObject({
      grids: false,
      snap: false,
      nativeMats: false
    })
  })

  it('restores `theme` and `dims`, which the prototype saved and never applied', () => {
    const p = sessionPatch({ theme: 'light', dims: true }, live)
    expect(p.theme).toBe('light')
    expect(p.dims).toBe(true)
  })
})

describe('applyRestore', () => {
  const recorder = (): { target: RestoreTarget; calls: string[] } => {
    const calls: string[] = []
    const note =
      (name: string) =>
      (...args: unknown[]): void => {
        void args
        calls.push(name)
      }
    return {
      calls,
      target: {
        grids: note('grids'),
        levels: note('levels'),
        snap: note('snap'),
        modelColors: note('modelColors'),
        highlightColor: note('highlightColor'),
        pickable: note('pickable'),
        section: note('section'),
        shadows: note('shadows'),
        camera: note('camera'),
        frameExtents: note('frameExtents'),
        visibility: note('visibility')
      } as RestoreTarget
    }
  }

  it('runs every step of RESTORE_ORDER, in that order', () => {
    const { target, calls } = recorder()
    const p = payload()
    const ran = applyRestore(sessionPatch(p, source()), p, target, FRAME)
    // `frameExtents` is the alternative to `camera`, never a step of its own run.
    const expected = RESTORE_ORDER.filter((step) => step !== 'frameExtents')
    expect(calls).toEqual(expected)
    expect(ran).toEqual(expected)
  })

  it('applies visibility last — it reads every key the patch has just written', () => {
    const { target, calls } = recorder()
    const p = payload()
    applyRestore(sessionPatch(p, source()), p, target, FRAME)
    expect(calls[calls.length - 1]).toBe('visibility')
  })

  it('sets the section before the camera', () => {
    const { target, calls } = recorder()
    const p = payload()
    applyRestore(sessionPatch(p, source()), p, target, FRAME)
    expect(calls.indexOf('section')).toBeLessThan(calls.indexOf('camera'))
  })

  it('skips the camera when the payload has none, so the boot framing stands', () => {
    const { target, calls } = recorder()
    const p = payload({ cam: null })
    applyRestore(sessionPatch(p, source()), p, target, FRAME)
    expect(calls).not.toContain('camera')
    expect(calls).not.toContain('frameExtents')
    expect(calls[calls.length - 1]).toBe('visibility')
  })

  it('frames the extents instead of restoring a camera from another project frame', () => {
    // The camera is scene coordinates and the scene is the project frame, so a payload from a
    // different boot model — or from a build that recorded no frame at all — would point it
    // with numbers that meant something else.
    for (const p of [payload(), payload({ frame: 'identity' })]) {
      if (p.frame === FRAME) delete (p as Partial<SessionPayload>).frame
      const { target, calls } = recorder()
      applyRestore(sessionPatch(p, source()), p, target, FRAME)
      expect(calls).not.toContain('camera')
      expect(calls).toContain('frameExtents')
      // Everything else still restores.
      expect(calls).toContain('section')
      expect(calls[calls.length - 1]).toBe('visibility')
    }
  })

  it('skips shadows when the payload does not carry the key (`:1705`)', () => {
    const { target, calls } = recorder()
    const p = payload()
    delete (p as Partial<SessionPayload>).shadows
    applyRestore(sessionPatch(p, source()), p, target, FRAME)
    expect(calls).not.toContain('shadows')
  })

  it('passes each step the value the patch decided on', () => {
    const target = {
      grids: vi.fn(),
      levels: vi.fn(),
      snap: vi.fn(),
      modelColors: vi.fn(),
      highlightColor: vi.fn(),
      pickable: vi.fn(),
      section: vi.fn(),
      shadows: vi.fn(),
      camera: vi.fn(),
      frameExtents: vi.fn(),
      visibility: vi.fn()
    }
    const p = payload({ grids: false, nativeMats: false, active: 'STR' })
    applyRestore(sessionPatch(p, source()), p, target, FRAME)
    expect(target.grids).toHaveBeenCalledWith(false)
    expect(target.modelColors).toHaveBeenCalledWith({ ARC: '#E05A6B' }, false)
    expect(target.pickable).toHaveBeenCalledWith('STR')
    expect(target.highlightColor).toHaveBeenCalledWith('#35C4B6')
    expect(target.camera).toHaveBeenCalledWith(p.cam)
    // Both planes go to the one `section` step, which still runs before the camera.
    expect(target.section).toHaveBeenCalledWith({
      grid: { name: 'C', offset: 1500, flip: true, cut: true },
      level: NO_PLANE
    })
  })
})

/* ══════════════════════════ 2026-10-01 — two section planes ══════════════════════════ */

/**
 * The gridline cut and the level cut are independent, so a payload carries both (`sections`) —
 * and, beside them, the design's single `section`, so that a build from before the change still
 * restores one plane. Nothing saved before may break: a payload with only the old key restores
 * onto the plane of its kind, and a link is a string a person pasted, so whatever shape arrives
 * is coerced rather than trusted.
 */
describe('the two section planes in a payload', () => {
  const grid = { name: 'C', offset: 1500, flip: true, cut: true }
  const level = { name: 'L2', offset: 1200, flip: false, cut: false }
  const NONE = { kind: null, name: '', offset: 0, flip: false, cut: false }
  const live = source({ sections: NO_SECTIONS })
  const written = (sections: Sections): SessionPayload =>
    sessionPayload(source({ sections }), ['ARC'], [], null, FRAME)

  it('writes both planes, and the legacy key in the old single-plane shape', () => {
    const p = written({ grid, level })
    expect(p.sections).toEqual({ grid, level })
    // The gridline plane when it is set …
    expect(p.section).toEqual({ kind: 'grid', ...grid })
    expect(Object.keys(p.section)).toEqual(['kind', 'name', 'offset', 'flip', 'cut'])
    // … else the level plane …
    expect(written({ grid: NO_PLANE, level }).section).toEqual({ kind: 'level', ...level })
    // … else the old "none" object, whatever a nameless plane still carries.
    expect(written(NO_SECTIONS).section).toEqual(NONE)
    expect(
      written({ grid: { name: '', offset: 500, flip: true, cut: true }, level: NO_PLANE }).section
    ).toEqual(NONE)
    expect(legacySection({ grid, level })).toEqual(p.section)
  })

  /**
   * An older build restores one plane, so it should be the one that changes what is seen: with
   * exactly one of the two set planes cutting, that one. `grid` above cuts and `level` is a
   * preview — the first case; the second is the same two planes the other way round.
   */
  it('gives an older build the plane that is cutting, when only one of the two is', () => {
    const preview = (p: typeof grid): typeof grid => ({ ...p, cut: false })
    const cutting = (p: typeof grid): typeof grid => ({ ...p, cut: true })
    // The gridline plane cuts, the level plane is a preview: the gridline plane.
    expect(legacySection({ grid: cutting(grid), level: preview(level) })).toEqual({
      kind: 'grid',
      ...cutting(grid)
    })
    // The level plane cuts, the gridline plane is a preview: the level plane — it was the
    // gridline plane, the preview, until this rule.
    expect(legacySection({ grid: preview(grid), level: cutting(level) })).toEqual({
      kind: 'level',
      ...cutting(level)
    })
    expect(written({ grid: preview(grid), level: cutting(level) }).section.kind).toBe('level')
  })

  it('keeps the gridline plane first when neither plane cuts, or both do', () => {
    const preview = (p: typeof grid): typeof grid => ({ ...p, cut: false })
    const cutting = (p: typeof grid): typeof grid => ({ ...p, cut: true })
    expect(legacySection({ grid: cutting(grid), level: cutting(level) })).toEqual({ kind: 'grid', ...cutting(grid) })
    expect(legacySection({ grid: preview(grid), level: preview(level) })).toEqual({ kind: 'grid', ...preview(grid) })
    // One plane set is that plane, cutting or not.
    expect(legacySection({ grid: NO_PLANE, level: preview(level) }).kind).toBe('level')
    expect(legacySection({ grid: preview(grid), level: NO_PLANE }).kind).toBe('grid')
    // A `cut` left on a plane with no name is not a cutting plane: the level preview is all there is…
    expect(
      legacySection({ grid: { name: '', offset: 0, flip: false, cut: true }, level: preview(level) }).kind
    ).toBe('level')
    // …and it does not outrank a set gridline preview either.
    expect(
      legacySection({ grid: preview(grid), level: { name: '', offset: 0, flip: false, cut: true } }).kind
    ).toBe('grid')
  })

  it('round-trips a new payload through the link and back into the patch, plane for plane', () => {
    for (const sections of [
      { grid, level },
      { grid, level: NO_PLANE },
      { grid: NO_PLANE, level },
      NO_SECTIONS,
      // A nameless plane keeps what its controls were left at.
      { grid: { name: '', offset: -500, flip: true, cut: true }, level }
    ]) {
      const p = written(sections)
      const back = payloadFromLink(linkFor(p))!
      expect(back).toEqual(p)
      expect(encodeState(back)).toBe(encodeState(p))
      expect(sessionPatch(back, live).sections).toEqual(sections)
      expect(sessionPatch(JSON.parse(JSON.stringify(p)) as SessionPayload, live).sections).toEqual(sections)
    }
  })

  it('reads a payload written before there were two: its one section, onto the plane of its kind', () => {
    const old = (section: unknown): Partial<SessionPayload> => {
      const p = JSON.parse(JSON.stringify(written(NO_SECTIONS))) as Record<string, unknown>
      delete p.sections
      p.section = section
      return p as Partial<SessionPayload>
    }
    expect(sessionPatch(old({ kind: 'grid', ...grid }), live).sections).toEqual({ grid, level: NO_PLANE })
    expect(sessionPatch(old({ kind: 'level', ...level }), live).sections).toEqual({ grid: NO_PLANE, level })
    expect(sessionPatch(old(NONE), live).sections).toEqual(NO_SECTIONS)
    // Through a real link, as an older build would have copied it.
    const link = linkFor(old({ kind: 'level', ...level }) as SessionPayload)
    expect(sessionPatch(payloadFromLink(link)!, live).sections).toEqual({ grid: NO_PLANE, level })
    // The old key replaces whatever is live — it described the whole section of its view.
    const busy = source({ sections: { grid, level } })
    expect(sessionPatch(old({ kind: 'level', ...level }), busy).sections).toEqual({ grid: NO_PLANE, level })
    expect(sessionPatch(old(NONE), busy).sections).toEqual(NO_SECTIONS)
  })

  it('prefers `sections` when a payload carries both keys, which every new one does', () => {
    const p = written({ grid: NO_PLANE, level })
    expect(p.section.kind).toBe('level')
    const edited = { ...p, section: { kind: 'grid' as const, ...grid } }
    expect(sessionPatch(edited, live).sections).toEqual({ grid: NO_PLANE, level })
  })

  it('keeps the live planes when the payload carries neither key (`pick`’s own rule)', () => {
    const busy = source({ sections: { grid, level } })
    expect(sessionPatch({}, busy).sections).toEqual({ grid, level })
    expect(sectionsOf({})).toBeNull()
    expect(sectionsOf(null)).toBeNull()
    expect(sectionsOf(undefined)).toBeNull()
  })

  it('coerces a hostile shape instead of trusting it', () => {
    // A name that is not a string is no plane; an offset that is not a finite number is 0;
    // `flip` and `cut` are true only when they are `true`; unknown keys are dropped.
    expect(
      sectionsOf({
        sections: {
          grid: { name: 42, offset: '1500', flip: 'yes', cut: 1, extra: { deep: true }, kind: 'level' },
          level: { name: 'L2', offset: Infinity, flip: true, cut: 'true' },
          other: { name: 'Z' }
        }
      })
    ).toEqual({ grid: NO_PLANE, level: { name: 'L2', offset: 0, flip: true, cut: false } })
    expect(sectionsOf({ sections: { grid: { name: 'C', offset: NaN, flip: null, cut: true } } })).toEqual({
      grid: { name: 'C', offset: 0, flip: false, cut: true },
      level: NO_PLANE
    })
    // A plane that is not an object at all, and a `sections` whose planes are missing.
    for (const sections of [{ grid: 'C', level: ['L2'] }, { grid: null }, {}]) {
      expect(sectionsOf({ sections })).toEqual(NO_SECTIONS)
    }
    // `sections` that is not an object is as good as absent: the legacy key is read instead …
    for (const sections of ['grid C', 7, true, ['C'], null]) {
      expect(sectionsOf({ sections, section: { kind: 'grid', ...grid } })).toEqual({ grid, level: NO_PLANE })
      // … and with no usable legacy key either, the caller keeps what it has.
      expect(sectionsOf({ sections, section: 'grid C' })).toBeNull()
    }
    // A legacy section of an unknown kind is no section; its numbers go nowhere.
    for (const kind of ['storey', 'GRID', 3, undefined, { kind: 'grid' }]) {
      expect(sectionsOf({ section: { kind, ...grid } })).toEqual(NO_SECTIONS)
    }
    expect(sectionsOf({ section: { kind: 'level', name: ['L2'], offset: {}, flip: 0, cut: [] } })).toEqual(NO_SECTIONS)
    // Every result is a fresh, plain pair of planes with exactly the four keys.
    const out = sectionsOf({ sections: { grid: { name: 'C', offset: 1, flip: true, cut: true, x: 1 } } })!
    expect(Object.keys(out)).toEqual(['grid', 'level'])
    expect(Object.keys(out.grid)).toEqual(['name', 'offset', 'flip', 'cut'])
  })

  /**
   * A plane's name is printed — the Section card's summary, a viewpoint's sub-line, the
   * assistant's view state — and a link is a string a person pasted. A grid tag or a storey
   * name is a few characters; one longer than `PLANE_NAME_MAX` is treated as no plane.
   */
  it('reads a name longer than 200 characters as no plane, in either shape', () => {
    expect(PLANE_NAME_MAX).toBe(200)
    const longest = 'L'.repeat(PLANE_NAME_MAX)
    const tooLong = 'L'.repeat(PLANE_NAME_MAX + 1)
    const plane = (name: string): Record<string, unknown> => ({ name, offset: 1200, flip: true, cut: true })
    // Exactly 200 is a name like any other; the other plane is untouched either way.
    expect(sectionsOf({ sections: { grid, level: plane(longest) } })).toEqual({
      grid,
      level: { name: longest, offset: 1200, flip: true, cut: true }
    })
    // One more is no plane: the name is gone, so nothing is cut and nothing is printed.
    const cut = sectionsOf({ sections: { grid, level: plane(tooLong) } })!
    expect(cut.grid).toEqual(grid)
    expect(cut.level.name).toBe('')
    expect(sectionsLabel(cut)).toBe('grid C')
    // The old single key goes through the same reader.
    expect(sectionsOf({ section: { kind: 'level', ...plane(tooLong) } })!.level.name).toBe('')
    expect(sectionsOf({ section: { kind: 'grid', ...plane(longest) } })!.grid.name).toBe(longest)
    // Through a real link, and into the patch the store takes.
    const hostile = { ...written(NO_SECTIONS), sections: { grid: plane('G'.repeat(5000)), level: plane('L2') } }
    const back = payloadFromLink(linkFor(hostile as unknown as SessionPayload))!
    expect(sessionPatch(back, live).sections).toEqual({
      grid: { name: '', offset: 1200, flip: true, cut: true },
      level: { name: 'L2', offset: 1200, flip: true, cut: true }
    })
  })

  it('survives the link codec carrying such a shape end to end', () => {
    const hostile = { ...written(NO_SECTIONS), sections: { grid: { name: { $: 1 }, offset: '9e99' }, level: 5 } }
    const back = payloadFromLink(linkFor(hostile as unknown as SessionPayload))!
    expect(sessionPatch(back, live).sections).toEqual(NO_SECTIONS)
  })

  it('prints both planes as one string, and one plane as the design does', () => {
    expect(sectionsLabel({ grid, level })).toBe('grid C + level L2')
    expect(sectionsLabel({ grid, level: NO_PLANE })).toBe('grid C')
    expect(sectionsLabel({ grid: NO_PLANE, level })).toBe('level L2')
    expect(sectionsLabel(NO_SECTIONS)).toBeNull()
  })
})

describe('encodeState / decodeState', () => {
  it('round-trips a payload', () => {
    const p = payload()
    expect(decodeState(encodeState(p))).toEqual(p)
  })

  it('is URL-safe: no +, / or = in the output', () => {
    // A long, varied payload, so every base64 sextet is exercised.
    const p = payload({ uploadNames: Object.fromEntries([...Array(40)].map((_, i) => [`k${i}`, `f~${i}?&/+.ifc`])) })
    expect(encodeState(p)).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('round-trips non-ASCII — the design’s own UTF-8 byte dance', () => {
    const p = payload({ uploadNames: { ARC: 'façade — 立面.ifc' } })
    expect(decodeState(encodeState(p))?.uploadNames).toEqual({ ARC: 'façade — 立面.ifc' })
  })

  it('gives null on garbage rather than throwing', () => {
    expect(decodeState('')).toBeNull()
    expect(decodeState('!!!!')).toBeNull()
    expect(decodeState('bm90IGpzb24')).toBeNull() // "not json"
    expect(decodeState(btoa('[1,2,3]').replace(/=+$/, ''))).toBeNull() // an array is not a payload
    expect(decodeState(btoa('null').replace(/=+$/, ''))).toBeNull()
  })
})

describe('the link', () => {
  it('is `sgvue://s=<base64url>`', () => {
    expect(linkFor(payload())).toMatch(/^sgvue:\/\/s=[A-Za-z0-9\-_]+$/)
  })

  it('round-trips through payloadFromLink', () => {
    const p = payload()
    expect(payloadFromLink(linkFor(p))).toEqual(p)
  })

  it('accepts the `sgvue:s=…` form Windows can hand over', () => {
    const p = payload()
    expect(payloadFromLink(linkFor(p).replace('sgvue://', 'sgvue:'))).toEqual(p)
  })

  it('ignores anything the OS appends after the payload', () => {
    const p = payload()
    expect(payloadFromLink(linkFor(p) + '&from=finder')).toEqual(p)
  })

  it('gives null for a URL that is not ours', () => {
    expect(payloadFromLink('https://example.com/s=abc')).toBeNull()
    expect(payloadFromLink('sgvue://open')).toBeNull()
  })
})

describe('checkFiles', () => {
  const files = [
    { key: 'ARC', path: '/m/arc.ifc', name: 'arc.ifc', sha256: 'aa' },
    { key: 'STR', path: '/m/str.ifc', name: 'str.ifc', sha256: 'bb' }
  ]

  it('passes when every file is there and unchanged', () => {
    expect(
      checkFiles(files, [
        { path: '/m/arc.ifc', exists: true, sha256: 'aa' },
        { path: '/m/str.ifc', exists: true, sha256: 'bb' }
      ])
    ).toEqual({ ok: true })
  })

  it('names a file that has moved', () => {
    const v = checkFiles(files, [
      { path: '/m/arc.ifc', exists: true },
      { path: '/m/str.ifc', exists: false }
    ])
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('missing')
    expect(v.message).toContain('str.ifc')
    expect(v.message).toContain('no longer where the session left it')
  })

  it('names a file whose bytes have changed, and never loads it silently', () => {
    const v = checkFiles(files, [
      { path: '/m/arc.ifc', exists: true, sha256: 'ZZ' },
      { path: '/m/str.ifc', exists: true, sha256: 'bb' }
    ])
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('changed')
    expect(v.message).toContain('arc.ifc')
  })

  it('reports missing before changed — a file that is gone cannot have a hash', () => {
    const v = checkFiles(files, [
      { path: '/m/arc.ifc', exists: false },
      { path: '/m/str.ifc', exists: true, sha256: 'different' }
    ])
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('missing')
  })

  it('does not judge a file it was not able to rehash', () => {
    expect(
      checkFiles(files, [
        { path: '/m/arc.ifc', exists: true, sha256: null },
        { path: '/m/str.ifc', exists: true }
      ])
    ).toEqual({ ok: true })
  })

  it('collapses three or more names into a count', () => {
    const many = [1, 2, 3, 4].map((i) => ({
      key: `M${i}`,
      path: `/m/${i}.ifc`,
      name: `${i}.ifc`,
      sha256: 'x'
    }))
    const v = checkFiles(
      many,
      many.map((f) => ({ path: f.path, exists: false }))
    )
    if (v.ok) throw new Error('expected a refusal')
    expect(v.message).toContain('1.ifc and 3 other files')
  })
})

describe('canonicalFiles', () => {
  const files = [
    { key: 'ARC', path: 'C:\\Users\\JANEDO~1\\m\\arc.ifc', name: 'arc.ifc', sha256: 'aa' },
    { key: 'STR', path: '/m/str.ifc', name: 'str.ifc', sha256: 'bb' }
  ]

  it('carries the admitted spelling forward, keeping everything else the file said', () => {
    const canon = canonicalFiles(files, ['C:\\Users\\Jane Doe\\m\\arc.ifc', '/m/str.ifc'])
    expect(canon.files.map((f) => f.path)).toEqual([
      'C:\\Users\\Jane Doe\\m\\arc.ifc',
      '/m/str.ifc'
    ])
    expect(canon.files[0]).toMatchObject({ key: 'ARC', name: 'arc.ifc', sha256: 'aa' })
    expect(canon.probes).toEqual([
      { path: 'C:\\Users\\Jane Doe\\m\\arc.ifc', exists: true },
      { path: '/m/str.ifc', exists: true }
    ])
  })

  it('leaves a file main refused at its own path, and says it is not there', () => {
    const canon = canonicalFiles(files, [null, '/m/str.ifc'])
    expect(canon.files[0].path).toBe('C:\\Users\\JANEDO~1\\m\\arc.ifc')
    expect(canon.probes[0]).toEqual({ path: 'C:\\Users\\JANEDO~1\\m\\arc.ifc', exists: false })
    const v = checkFiles(canon.files, canon.probes)
    if (v.ok) throw new Error('expected a refusal')
    expect(v.reason).toBe('missing')
    expect(v.message).toContain('arc.ifc')
  })

  it('is what lets the hash comparison happen at all', () => {
    // The live federation knows the file by the path main admitted. Against the session's own
    // spelling the probe simply misses and a changed file loads silently; against the
    // canonical one it is named.
    const canon = canonicalFiles(files, ['C:\\Users\\Jane Doe\\m\\arc.ifc', '/m/str.ifc'])
    const live = new Map([
      ['C:\\Users\\Jane Doe\\m\\arc.ifc', 'ZZ'],
      ['/m/str.ifc', 'bb']
    ])
    const v = checkFiles(
      canon.files,
      canon.files.map((f) => ({ path: f.path, exists: true, sha256: live.get(f.path) ?? null }))
    )
    if (v.ok) throw new Error('expected a refusal')
    expect(v.reason).toBe('changed')
    expect(v.message).toContain('arc.ifc')
  })
})

/* ══════════════════════════ 2026-09-20 — the absent operator travels ══════════════════════════ */

/**
 * A new rule operator has to survive everything a stack is written into. The codec carries the
 * stack as plain JSON and validates nothing, which is exactly why it is worth proving rather
 * than assuming: a payload written by this build must come back identical, and a payload
 * written by a build that had never heard of the operator must be unaffected.
 */
describe('a stack with an `absent` rule', () => {
  const stack = [
    {
      id: 'f1',
      on: true,
      action: 'hide' as const,
      color: '#35C4B6',
      rules: [
        { prop: 'IfcEntity', op: '=' as const, val: 'IfcWall', join: 'and' as const },
        { prop: 'FireRating', op: 'absent' as const, val: '' }
      ]
    }
  ]

  it('round-trips through the share link, rule for rule', () => {
    const payload = sessionPayload(source({ stack }), ['ARC'], [], null, FRAME)
    const back = payloadFromLink(linkFor(payload))!
    expect(back.stack).toEqual(stack)
    expect(back.stack[0].rules[1]).toEqual({ prop: 'FireRating', op: 'absent', val: '' })
    // And byte for byte, which is what "the link reopens the exact view" means.
    expect(encodeState(back)).toBe(encodeState(payload))
  })

  it('round-trips through the session payload and back into the patch', () => {
    const payload = sessionPayload(source({ stack }), ['ARC'], [], null, FRAME)
    const json = JSON.parse(JSON.stringify(payload)) as SessionPayload
    expect(sessionPatch(json, source()).stack).toEqual(stack)
  })

  it('leaves a payload written before the operator existed exactly as it was', () => {
    // Every operator the design shipped with, decoded from a link made by an older build.
    const old = sessionPayload(
      source({
        stack: [
          {
            id: 'f1',
            on: true,
            action: 'isolate',
            color: '#35C4B6',
            rules: [
              { prop: 'Level', op: '=', val: 'L2' },
              { prop: 'Name', op: '~', val: 'core', join: 'or' },
              { prop: 'FireRating', op: '!=', val: '2 HR' }
            ]
          }
        ]
      }),
      ['ARC'],
      [],
      null,
      FRAME
    )
    const link = linkFor(old)
    expect(payloadFromLink(link)).toEqual(old)
    expect(decodeState(encodeState(old))!.stack).toEqual(old.stack)
  })
})

/* ────────────────────────────── element ids (refactor pass 2, P5) ────────────────────────────── */

describe('sessionOrder — a session’s batch goes in so each file gets its own slot back', () => {
  const file = (path: string, slot?: number) => ({ key: path, path, name: path, sha256: '', ...(slot === undefined ? {} : { slot }) })
  const items = (...paths: string[]) => paths.map((path) => ({ path }))
  const order = (list: { path: string }[], files: ReturnType<typeof file>[]) =>
    sessionOrder(list, (i) => i.path, files).map((i) => i.path)

  it('puts the files in the order of their recorded slots, whatever order the parses finished in', () => {
    expect(order(items('/c', '/a', '/b'), [file('/a', 0), file('/b', 1), file('/c', 2)])).toEqual(['/a', '/b', '/c'])
    // A model removed before the save: the survivors' slots are not their places in `files`.
    expect(order(items('/a', '/b'), [file('/a', 1), file('/b', 0)])).toEqual(['/b', '/a'])
  })

  it('takes a file’s place in `files` for a payload saved before slots were recorded', () => {
    expect(order(items('/b', '/a'), [file('/a'), file('/b')])).toEqual(['/a', '/b'])
  })

  it('puts anything the session does not name last, in the order it came', () => {
    expect(order(items('/x', '/b', '/y', '/a'), [file('/a', 0), file('/b', 1)])).toEqual(['/a', '/b', '/x', '/y'])
  })
})

describe('restorableIds — a session’s ids, renumbered onto the slots its files have now', () => {
  const S = ID_STRIDE
  const f = (path: string, slot: number | undefined, key = path) => ({ key, path, name: path, sha256: '', ...(slot === undefined ? {} : { slot }) })
  /** A payload this build writes: its ids are numbered by `ID_STRIDE`, and it says so. */
  const saved = (files: ReturnType<typeof f>[], hidden: Record<string, boolean>, active: string | null = null) =>
    ({ files, hidden, active, idStride: ID_STRIDE }) as Partial<SessionPayload>
  /** Such a payload is exact: it never needs to ask which elements are here. */
  const unasked = (): boolean => {
    throw new Error('a payload numbered by ID_STRIDE asked which elements exist')
  }

  it('restores them as they were when every file is back on the slot it had', () => {
    const p = saved([f('/a', 0, 'A'), f('/b', 1, 'B')], { 5: true, [S + 7]: true }, 'B')
    expect(restorableIds(p, [f('/a', 0, 'A'), f('/b', 1, 'B')], unasked)).toEqual({
      hidden: { 5: true, [S + 7]: true },
      active: 'B'
    })
  })

  it('one model saved on slot 1 (it had replaced another) comes back on slot 0: its ids move with it', () => {
    const p = saved([f('/a', 1, 'A')], { [S + 5]: true, [S + 9]: true }, 'A')
    expect(restorableIds(p, [f('/a', 0, 'A')], unasked)).toEqual({ hidden: { 5: true, 9: true }, active: 'A' })
  })

  it('two models saved on 0 and 2 come back on 0 and 1', () => {
    const p = saved([f('/a', 0), f('/b', 2)], { 3: true, [2 * S + 4]: true })
    expect(restorableIds(p, [f('/a', 0), f('/b', 1)], unasked).hidden).toEqual({ 3: true, [S + 4]: true })
  })

  it('after boot, files that joined beside models already open keep their ids too', () => {
    const p = saved([f('/a', 0, 'A')], { 5: true }, 'A')
    expect(restorableIds(p, [f('/other', 0, 'O'), f('/a', 1, 'A')], unasked)).toEqual({ hidden: { [S + 5]: true }, active: 'A' })
  })

  it('restores none when a file of the session is not open', () => {
    expect(restorableIds(saved([f('/a', 0), f('/b', 1)], { 5: true }, '/a'), [f('/a', 0)], unasked)).toEqual({ hidden: {}, active: null })
  })

  it('a payload saved before slots were recorded: each file’s place in `files` is its slot', () => {
    const p = saved([f('/a', undefined), f('/b', undefined)], { 7: true, [S + 3]: true })
    expect(restorableIds(p, [f('/a', 0), f('/b', 1)], unasked).hidden).toEqual({ 7: true, [S + 3]: true })
    expect(restorableIds(p, [f('/a', 1), f('/b', 0)], unasked).hidden).toEqual({ [S + 7]: true, 3: true })
  })

  it('drops an id whose slot no file of the session had, and an active key no file had', () => {
    const p = saved([f('/a', 0, 'A')], { 5: true, [3 * S + 1]: true }, 'GONE')
    expect(restorableIds(p, [f('/a', 0, 'A')], unasked)).toEqual({ hidden: { 5: true }, active: null })
  })

  it('carries active to the key its file is open under now', () => {
    const p = saved([f('/a', 0, 'tiny')], {}, 'tiny')
    expect(restorableIds(p, [f('/a', 0, 'tiny (2)')], unasked).active).toBe('tiny (2)')
  })

  it('keeps an element past a million lines on its own model — what the old stride could not', () => {
    // #2 348 438 is the last element of a 150 MB file. By the design's stride, on slot 1 it was
    // 3 348 438 — read back as slot 3.
    const p = saved([f('/a', 0, 'A'), f('/b', 1, 'B')], { 2_348_438: true, [S + 2_348_438]: true })
    expect(restorableIds(p, [f('/a', 1, 'A'), f('/b', 0, 'B')], unasked).hidden).toEqual({
      [S + 2_348_438]: true,
      2_348_438: true
    })
  })
})

describe('restorableIds — a payload written before 2026-10-09, numbered by the design’s 1 000 000', () => {
  const S = ID_STRIDE
  const M = LEGACY_ID_STRIDE
  const f = (path: string, slot: number | undefined, key = path) => ({ key, path, name: path, sha256: '', ...(slot === undefined ? {} : { slot }) })
  /** No `idStride`: what every build wrote before the stride changed. */
  const legacy = (files: ReturnType<typeof f>[], hidden: Record<string, boolean>, active: string | null = null) =>
    ({ files, hidden, active }) as Partial<SessionPayload>
  /** The live federation's ids, as `exists` is asked about them. */
  const here = (...ids: number[]): ((id: number) => boolean) => {
    const set = new Set(ids)
    return (id) => set.has(id)
  }

  it('is read as legacy when it has no idStride, or states the design’s own', () => {
    expect(idNumbering(undefined)).toBe('legacy')
    expect(idNumbering(M)).toBe('legacy')
    expect(idNumbering(S)).toBe('current')
    expect(idNumbering(12_345)).toBeNull()
    expect(idNumbering('1000000000')).toBeNull()
  })

  it('renumbers small ids onto the new stride, slot for slot', () => {
    const p = legacy([f('/a', 0, 'A'), f('/b', 1, 'B')], { 5: true, [M + 7]: true }, 'B')
    expect(restorableIds(p, [f('/a', 0, 'A'), f('/b', 1, 'B')], here(5, S + 7))).toEqual({
      hidden: { 5: true, [S + 7]: true },
      active: 'B'
    })
    // And onto whatever slots the files have now.
    expect(restorableIds(p, [f('/a', 1, 'A'), f('/b', 0, 'B')], here(S + 5, 7)).hidden).toEqual({ [S + 5]: true, 7: true })
  })

  it('one big file on its own: an element past a million lines is still that file’s', () => {
    // The old rule read 1 500 000 as slot 1 and dropped it: a session of one large model lost
    // every hidden element past its millionth line.
    const p = legacy([f('/big', 0, 'BIG')], { 12: true, 1_500_000: true, 2_348_438: true })
    expect(restorableIds(p, [f('/big', 0, 'BIG')], here(12, 1_500_000, 2_348_438)).hidden).toEqual({
      12: true,
      1_500_000: true,
      2_348_438: true
    })
  })

  it('two big files: an id is matched to the element that is really there', () => {
    // 1 700 000: A has an element #1 700 000; B has none at #700 000 (that line is a property).
    // 1 500 123: A's #1 500 123 and B's #500 123 shared this id in the old build, which drew,
    // hid and listed them as one — both are restored, which is the view that was saved.
    const p = legacy([f('/a', 0, 'A'), f('/b', 1, 'B')], { 1_700_000: true, 1_500_123: true })
    const live = here(1_700_000, 1_500_123, S + 500_123)
    expect(restorableIds(p, [f('/a', 0, 'A'), f('/b', 1, 'B')], live).hidden).toEqual({
      1_700_000: true,
      1_500_123: true,
      [S + 500_123]: true
    })
  })

  it('an id no reading of which is here names nothing', () => {
    const p = legacy([f('/a', 0, 'A')], { 5: true, 6: true })
    expect(restorableIds(p, [f('/a', 0, 'A')], here(5)).hidden).toEqual({ 5: true })
  })

  it('a numbering it does not know restores no id, and still restores what is by name', () => {
    const p = { ...legacy([f('/a', 0, 'A')], { 5: true }, 'A'), idStride: 12_345 } as Partial<SessionPayload>
    expect(restorableIds(p, [f('/a', 0, 'A')], here(5))).toEqual({ hidden: {}, active: 'A' })
  })

  it('ignores a key that is not a whole, non-negative, exact number — a link is pasted text', () => {
    const p = legacy([f('/a', 0, 'A')], { x: true, '-3': true, '1.5': true, '1e300': true, 5: true })
    expect(restorableIds(p, [f('/a', 0, 'A')], () => true).hidden).toEqual({ 5: true })
    const q = { ...p, idStride: ID_STRIDE } as Partial<SessionPayload>
    expect(restorableIds(q, [f('/a', 0, 'A')], () => true).hidden).toEqual({ 5: true })
  })
})
