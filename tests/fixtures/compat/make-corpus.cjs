#!/usr/bin/env node
/**
 * Writes one build's share link, `last.json`, saved-viewpoint list and `.schedule.json` files
 * into `tests/fixtures/compat/<version>/` — **with that build's own encoders**, not today's.
 *
 *   node tests/fixtures/compat/make-corpus.cjs <version> <source-root>
 *
 * `<source-root>` is a checkout (or `git archive … src package.json`) of the build named by
 * `<version>`; `README.md` beside this file lists which commit each corpus folder was made from.
 * The script writes a small entry module that imports the old tree's own pure functions —
 * `sessionPayload` + `linkFor`, `viewpointOf` + `storeViews`, `federate` + `mockModelIndex`,
 * `frameKey` and `scheduleFromPreset` — bundles it with this repository's esbuild (no type
 * check, so each tree is read exactly as it was) and runs it under Node. Nothing in the old tree
 * is edited and nothing of today's `src/` is imported.
 *
 * The review state fed to each build is the same scenario (`SCENARIO` below) spelled in that
 * build's own state shape: a single `section` up to 1.1.0, `sections` from 1.2.0, `units` from
 * 1.3.0. The file paths are placeholders and the only coordinates are the repository's synthetic
 * set (CLAUDE.md, Rules).
 */
'use strict'
const { execFileSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const REPO = resolve(__dirname, '..', '..', '..')
const esbuild = require(join(REPO, 'node_modules', 'esbuild'))

/** Which shape each build's state and frame key have. */
const VERSIONS = {
  // Private archive, tag v1.0.0-stable. One section plane, ids by 1 000 000, no unit; the frame
  // key is the boot model's site placement (`projectFrame`).
  'v1.0.0': { section: 'single', frame: 'site', units: false, idStride: false, sessions: true, schedules: false },
  // Private archive, 1.1.0-beta.1 — the first build that wrote a `.schedule.json`.
  'v1.1.0-beta.1': { sessions: false, schedules: true },
  // Public 27fb7ee. Two planes beside the single one; the boot model has no site placement.
  'v1.2.0': { section: 'two', frame: 'none', units: false, idStride: false, sessions: true, schedules: true },
  // Public tag v1.3.0. `idStride`, `units`; the frame key is P, placed by an `IfcMapConversion`.
  'v1.3.0': { section: 'two', frame: 'map', units: 'ft', idStride: true, sessions: true, schedules: false },
  // Today's tree, as committed when the corpus was made: the frame key is always `identity`.
  current: { section: 'two', frame: 'identity', units: 'm', idStride: true, sessions: true, schedules: true }
}

function entry(root, v) {
  const at = (p) => JSON.stringify(join(root, p))
  const lines = []
  if (v.sessions) {
    lines.push(
      `import { sessionPayload, linkFor } from ${at('src/shared/session-codec')}`,
      `import * as georef from ${at('src/shared/georef')}`,
      `import { viewpointOf } from ${at('src/renderer/state/selectors/views')}`,
      `import { storeViews, viewsKeyFor } from ${at('src/renderer/state/persist')}`,
      `import { federate } from ${at('src/shared/federate')}`,
      `import { mockModelIndex } from ${at('src/renderer/dev/mock-adapter')}`
    )
  }
  if (v.schedules) {
    lines.push(`import { PRESETS, scheduleFromPreset } from ${at('src/schedule/schedule/presets')}`)
  }
  lines.push(`const v = ${JSON.stringify(v)}`, `const out: Record<string, string> = {}`)
  if (v.sessions) lines.push(SESSION_BODY)
  if (v.schedules) lines.push(SCHEDULE_BODY)
  lines.push(`process.stdout.write(JSON.stringify(out))`)
  return lines.join('\n')
}

/**
 * The scenario, in each build's own shape. Element ids come from **that build's** `federate`
 * over **that build's** mock federation (ARC on slot 0, STR on slot 1), so they are numbered by
 * that build's stride; `hidden.json` names them by model and GlobalId for the test.
 */
const SESSION_BODY = String.raw`
const fed = federate([mockModelIndex('ARC'), mockModelIndex('STR')])
const pick = (model: string, type: string, n: number) =>
  fed.elements.filter((e: any) => e.model === model && e.type === type).slice(0, n)
const hiddenEls = [...pick('ARC', 'IfcWall', 1), ...pick('STR', 'IfcColumn', 2)]
const hidden: Record<string, boolean> = {}
for (const e of hiddenEls) hidden[e.id] = true
out['hidden.json'] = JSON.stringify(hiddenEls.map((e: any) => ({ model: e.model, guid: e.guid, savedId: e.id })), null, 2) + '\n'

// The boot model's georeferencing, from which the old store's s.frame was made. The synthetic set.
const site = { source: 'IfcSite', sources: ['IfcSite'], method: 'IfcSite placement',
  site: { placement: [12345.457, 23456.766, 5.05], rotationDeg: -43.4103, pureZRotation: true } }
const rad = (-43.4103 * Math.PI) / 180
const map = { source: 'IfcMapConversion', sources: ['IfcMapConversion'], method: 'IfcMapConversion',
  eastings: 12345.457, northings: 23456.766, orthogonalHeight: 5.05,
  xAxisAbscissa: Math.cos(rad), xAxisOrdinate: Math.sin(rad) }
const g: any = georef
const frame = v.frame === 'site' ? g.projectFrame(site)
  : v.frame === 'map' ? g.federationFrame(map)
  : null
const key = v.frame === 'identity' ? g.IDENTITY_FRAME_KEY : g.frameKey(frame)

const section = { kind: 'level', name: 'L2', offset: 1200, flip: false, cut: true }
const sections = {
  grid: { name: 'C', offset: 500, flip: true, cut: false },
  level: { name: 'L2', offset: 1200, flip: false, cut: true }
}
const stack = [{ id: 's1', on: true, action: 'isolate', color: '#35C4B6',
  rules: [{ prop: 'IfcEntity', op: '=', val: 'IfcWall', join: 'and' }] }]
const state: any = {
  uploadNames: {}, hidden, storeyVis: { Roof: false }, modelVis: {}, active: 'STR',
  modelColors: { ARC: '#D8D2C6' }, nativeMats: false, treeMode: 'type', grids: true,
  levels: false, shadows: false, theme: 'light', snap: false, dims: true, stack,
  hlColor: '#E8A33D', view: null,
  // Typed into the card by hand before 2026-10-08, read from the file after; never restored now.
  coords: { E: 12345.457, N: 23456.766, Z: 5.05, angle: -43.4103 },
  views: [], frame
}
if (v.section === 'single') state.section = section
else state.sections = sections
if (v.units) state.units = v.units

const cam = { theta: 0.8, phi: 1.1, dist: 42.5, half: 18.25, target: [3.5, 7.25, 4], proj: 'ortho' }
const files = [
  { key: 'ARC', path: '/Users/me/models/Tower A ARC.ifc', name: 'Tower A ARC.ifc', sha256: 'a'.repeat(64), slot: 0 },
  { key: 'STR', path: '/Users/me/models/Tower A STR.ifc', name: 'Tower A STR.ifc', sha256: 'b'.repeat(64), slot: 1 }
]
const payload = sessionPayload(state, ['ARC', 'STR'], files, cam, key)
out['link.txt'] = linkFor(payload) + '\n'
// main/sessions.ts writes the renderer's envelope as JSON.stringify(envelope).
out['last.json'] = JSON.stringify({ payload, savedAt: 1790000000000 }) + '\n'

// Two viewpoints, saved one after the other, through the build's own persist.ts.
const mem = new Map<string, string>()
;(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, s: string) => void mem.set(k, s) }
const first = viewpointOf(state, cam, 1790000000000)
const second = viewpointOf({ ...state, views: [first], hidden: {}, stack: [], active: null,
  storeyVis: {}, ...(v.section === 'single' ? { section: { kind: null, name: '', offset: 0, flip: false, cut: false } }
  : { sections: { grid: { name: '', offset: 0, flip: false, cut: false }, level: { name: '', offset: 0, flip: false, cut: false } } }),
  view: 'top' }, null, 1790000000001)
const vkey = viewsKeyFor(fed.project.building)
storeViews(vkey, [first, second])
out['viewpoints.json'] = JSON.stringify({ key: vkey, value: mem.get(vkey) }, null, 2) + '\n'
`

/** Two templates as the gallery makes them, one metric and one imperial, written as Export does. */
const SCHEDULE_BODY = String.raw`
const byId = (id: string) => PRESETS.find((p: any) => p.id === id)
const doors = scheduleFromPreset(byId('door-schedule'), 'metric')
const walls = scheduleFromPreset(byId('wall-schedule'), 'imperial')
// Two edits the window makes in place: a rename (the title field) and itemize off (Sorting tab).
walls.name = 'Walls — by level'
walls.itemize = false
// exporting.ts: JSON.stringify(def, null, 2), as the Blob's text.
out['doors.schedule.json'] = JSON.stringify(doors, null, 2)
out['walls.schedule.json'] = JSON.stringify(walls, null, 2)
`

function main() {
  const [version, rootArg] = process.argv.slice(2)
  const v = VERSIONS[version]
  if (!v || !rootArg) {
    console.error(`usage: make-corpus.cjs <${Object.keys(VERSIONS).join('|')}> <source-root>`)
    process.exit(2)
  }
  const root = resolve(rootArg)
  const work = mkdtempSync(join(tmpdir(), 'sgvue-compat-'))
  try {
    const src = join(work, 'entry.ts')
    const bundle = join(work, 'entry.cjs')
    writeFileSync(src, entry(root, v))
    esbuild.buildSync({
      entryPoints: [src],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundle,
      nodePaths: [join(REPO, 'node_modules')],
      logLevel: 'error'
    })
    const out = JSON.parse(execFileSync(process.execPath, [bundle], { encoding: 'utf8' }))
    const dir = join(__dirname, version)
    mkdirSync(dir, { recursive: true })
    for (const [name, text] of Object.entries(out)) writeFileSync(join(dir, name), text)
    console.log(`${version}: ${Object.keys(out).join(', ')}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main()
