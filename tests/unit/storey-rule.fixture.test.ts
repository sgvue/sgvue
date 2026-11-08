/**
 * An element's storey and spatial container follow its host (2026-11-08, owner-approved).
 *
 * `index-builder.ts` gives every element one effective container, IfcOpenShell's: its own
 * `IfcRelContainedInSpatialStructure`, else what `get_container` finds by climbing `get_parent`
 * — aggregation, nesting, the opening a door or window fills, the element that opening voids —
 * to the first element that is contained. `storey` and `container` both come from that one walk.
 *
 * Three parts:
 *  · on `reference.ifc` and `feet.ifc`, where every element is contained directly (as a Revit
 *    export contains it), nothing changed: each element's storey and container are the values
 *    the build before this rule gave them (HEAD 996dac71), pinned here as per-storey counts and
 *    a SHA-256 of every `GlobalId → storey · container` line;
 *  · on `edge.ifc`, the component nested on a wall in a storey and the door that only fills an
 *    opening in such a wall — each contained nowhere itself — sit on their host's storey and in
 *    their host's container;
 *  · in the main window, each place that reads an element's storey — STOREYS' counts, a storey's
 *    eye, a `Level` rule, the tree row's meta line and its search, the SQL `storey` column, the
 *    assistant's element, relationship and spatial-tree reads — puts those two there too. Every
 *    one of them reads `IfcElement.storey`; nothing else changed and no saved format did.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import initSqlJs from 'sql.js'
import { afterAll, describe, expect, it } from 'vitest'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { storeyRows } from '../../src/renderer/state/selectors/storeys'
import { matchesSearch, rowMeta } from '../../src/renderer/state/selectors/tree'
import { setViewer, useShell } from '../../src/renderer/state/shell'
import { federate } from '../../src/shared/federate'
import type { ModelIndex } from '../../src/shared/model-index.types'
import { matchFn, visFn } from '../../src/shared/rules'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'
import { buildDatabase } from '../../src/worker/sql-schema'
import { resetShell, stubViewer } from './stub-viewer'

const FIXTURES = join(__dirname, '..', 'fixtures')

async function index(stem: string): Promise<ModelIndex> {
  const src = await createReadOnlyIfcSource()
  const modelID = src.openFromBuffer(new Uint8Array(readFileSync(join(FIXTURES, `${stem}.ifc`))))
  const out = buildModelIndex(src, modelID, { modelKey: stem, fileName: `${stem}.ifc`, sha256: '' })
  src.close(modelID)
  src.dispose()
  return out
}

/** Per storey name, how many elements; and a digest of every element's storey and container. */
function placement(ix: ModelIndex): { counts: Record<string, number>; digest: string; elements: number } {
  const counts: Record<string, number> = {}
  const lines: string[] = []
  for (const e of ix.elements) {
    counts[e.storey] = (counts[e.storey] ?? 0) + 1
    lines.push(`${e.guid}\t${e.storey}\t${e.container ?? '-'}`)
  }
  lines.sort()
  return {
    counts,
    digest: createHash('sha256').update(lines.join('\n')).digest('hex'),
    elements: ix.elements.length
  }
}

/** What the build before the rule gave, captured from HEAD 996dac71. */
const BEFORE: Record<string, ReturnType<typeof placement>> = {
  reference: {
    counts: {
      'Level 00': 196,
      'Level 01': 223,
      'Level 02': 223,
      'Level 03': 223,
      'Level 04': 223,
      'Level 05': 223,
      'Level 06': 223,
      'Level 07': 223,
      'Level 08': 223,
      Roof: 117
    },
    digest: 'bece43b6af4d1afb9e3e6ba5424dea29ed6dac43df3e9d0e6f34ccd4d43a0df6',
    elements: 2097
  },
  feet: {
    counts: { 'Level 1': 4, 'Level 2': 1 },
    digest: 'f23823dbe7af78b93f8c7659171beb1a6b02d8b34a16eacaaf06500276d6c159',
    elements: 5
  }
}

describe('storey and container: unchanged where every element is contained directly', () => {
  for (const stem of Object.keys(BEFORE)) {
    it(`${stem}.ifc — every element's storey and container are what they were`, async () => {
      expect(placement(await index(stem))).toEqual(BEFORE[stem])
    })
  }
})

describe('storey and container: a nested component and a filling door take their host’s', () => {
  const edge = index('edge')
  const byGuid = async (guid: string) => {
    const el = (await edge).elements.find((e) => e.guid === guid)
    if (!el) throw new Error(`no ${guid}`)
    return el
  }

  it('the eight elements written before them are where the build before put them', async () => {
    // GlobalId → storey · container, captured from HEAD 996dac71 on the eight-element edge.ifc.
    const before: Record<string, [string, number]> = {
      '000000000000000000000E': ['Level 00', 41],
      '000000000000000000000F': ['Level 00', 41],
      '000000000000000000000G': ['Level 01', 45],
      '000000000000000000000H': ['Level 01', 45],
      '000000000000000000000I': ['', 21],
      '000000000000000000000J': ['Level 00', 57],
      '000000000000000000000Z': ['', 21],
      '0000000000000000000009': ['Level 00', 41]
    }
    for (const [guid, [storey, container]] of Object.entries(before)) {
      const el = await byGuid(guid)
      expect([el.storey, el.container], guid).toEqual([storey, container])
    }
  })

  it('a component nested on a wall in Level 00, contained nowhere, is on Level 00 in its host’s container', async () => {
    const host = await byGuid('000000000000000000000E')
    const clip = await byGuid('000000000000000000000b')
    expect(clip.name).toBe('Clip on a storey wall')
    expect(clip.decomposition.parent).toBe(host.expressId)
    expect(clip.storey).toBe('Level 00')
    expect(clip.container).toBe(host.container)
  })

  it('a door that only fills an opening in a wall in Level 01 is on Level 01 in the wall’s container', async () => {
    const wall = await byGuid('000000000000000000000G')
    const door = await byGuid('000000000000000000000f')
    expect(door.type).toBe('IfcDoor')
    expect(door.decomposition.parent).toBeUndefined()
    expect(door.decomposition.fillings).toHaveLength(1)
    expect(wall.decomposition.openings).toEqual(door.decomposition.fillings)
    expect(door.storey).toBe('Level 01')
    expect(door.container).toBe(wall.container)
  })
})

describe('the main window reads the host’s storey for the nested component and the filling door', () => {
  const CLIP = '000000000000000000000b'
  const DOOR = '000000000000000000000f'
  const fed = index('edge').then((ix) => federate([ix]))
  const el = async (guid: string) => (await fed).elements.find((e) => e.guid === guid)!

  afterAll(() => {
    setViewer(null)
    resetShell()
  })

  it('STOREYS counts them on their host’s storey', async () => {
    const f = await fed
    const rows = storeyRows({ storeys: f.storeys, elements: f.elements, storeyVis: {}, active: null })
    expect(rows.map((r) => [r.name, r.count])).toEqual([
      ['Level 00', 5],
      ['Level 01', 3]
    ])
  })

  it('a storey’s eye hides them with it, and a Level rule matches them', async () => {
    const [clip, door] = [await el(CLIP), await el(DOOR)]
    const off = (name: string) => visFn({ hidden: {}, modelVis: {}, storeyVis: { [name]: false } })
    expect([off('Level 00')(clip), off('Level 00')(door)]).toEqual([false, true])
    expect([off('Level 01')(clip), off('Level 01')(door)]).toEqual([true, false])
    const level = (val: string) => matchFn([{ prop: 'Level', op: '=', val }])!
    expect([level('Level 00')(clip), level('Level 01')(door)]).toEqual([true, true])
    expect(matchFn([{ prop: 'Level', op: 'absent', val: null }])!(door)).toBe(false)
  })

  it('the element tree’s row names the storey, and its search finds it', async () => {
    const door = await el(DOOR)
    expect(rowMeta(door, 'entity')).toBe('DOOR · Level 01')
    expect(matchesSearch(door, 'level 01')).toBe(true)
    expect(rowMeta(await el(CLIP), 'type')).toContain('Level 00')
  })

  it('the SQL `storey` column holds it', async () => {
    const f = await fed
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: (file) => join(dirname(require.resolve('sql.js')), file) })
    const db = buildDatabase(SQL, { models: f.models, elements: f.elements })
    const storeyOf = (guid: string) => db.exec('SELECT storey FROM element WHERE guid = ?', [guid])[0].values[0][0]
    expect([storeyOf(CLIP), storeyOf(DOOR)]).toEqual(['Level 00', 'Level 01'])
    expect(db.exec("SELECT storey, COUNT(*) FROM element GROUP BY storey ORDER BY storey")[0].values).toEqual([
      ['', 2],
      ['Level 00', 5],
      ['Level 01', 3]
    ])
    db.close()
  })

  it('the assistant’s element, relationship and spatial-tree reads say it', async () => {
    resetShell()
    setViewer(stubViewer())
    useShell.getState().commitModels(await fed)
    const sql = (async () => ({ columns: [], rows: [], truncated: false, ms: 0 })) as unknown as ToolContext['sql']
    const call = async (name: string, input: Record<string, unknown>) => {
      const ctx: ToolContext = { state: () => useShell.getState(), sql, rawLine: async () => null, turn: newTurnState() }
      return (await executeTool(name, input, ctx)) as unknown as Record<string, unknown>
    }
    expect(JSON.stringify(await call('get_element', { guid: DOOR }))).toContain('"storey":"Level 01"')
    expect(JSON.stringify(await call('get_relationships', { guid: CLIP }))).toContain('"containedIn":{"storey":"Level 00"}')
    const tree = JSON.stringify(await call('get_spatial_tree', { counts: true }))
    expect(tree).toMatch(/"name":"Level 00"[^}]*"elements":5/)
    expect(tree).toMatch(/"name":"Level 01"[^}]*"elements":3/)
  })
})
