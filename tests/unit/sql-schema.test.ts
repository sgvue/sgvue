/**
 * The model database, built under Node from the design's own mock federation.
 *
 * The federation is the prototype's four discipline files (412 elements, 6 storeys), so the
 * numbers here are the design's numbers and a drift shows up as a failing count rather than
 * as a wrong answer in the assistant six phases later.
 *
 * `PRAGMA query_only = 1` is checked the only way worth checking it: by trying to write.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { federate, ID_STRIDE } from '../../src/shared/federate'
import { guardSql } from '../../src/shared/sql-guard'
import { buildDatabase } from '../../src/worker/sql-schema'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const require = createRequire(import.meta.url)
/** Node has no bundler to hand us the asset URL, so point sql.js at its own dist folder. */
const DIST = dirname(require.resolve('sql.js'))

const federation = federate(KEYS.map((key) => mockModelIndex(key)))

let SQL: SqlJsStatic
let db: Database

/** One column of the first result set, as plain values. */
const rows = (sql: string): unknown[][] => {
  const result = db.exec(sql)
  return result.length ? result[0].values : []
}

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (file) => join(DIST, file) })
  db = buildDatabase(SQL, { models: federation.models, elements: federation.elements })
})

describe('sql schema — what got in', () => {
  it('holds one row per model and one per element', () => {
    expect(rows('SELECT COUNT(*) FROM model')[0][0]).toBe(4)
    expect(rows('SELECT COUNT(*) FROM element')[0][0]).toBe(412)
    expect(rows('SELECT key, slot, elements FROM model ORDER BY slot')).toEqual([
      ['ARC', 0, 140],
      ['STR', 1, 244],
      ['SIT', 2, 20],
      ['MEP', 3, 8]
    ])
  })

  it('uses federation ids, so an element id carries its model in its id block', () => {
    const [[min, max]] = rows("SELECT MIN(id), MAX(id) FROM element WHERE model = 'STR'") as [
      [number, number]
    ]
    expect(min).toBeGreaterThanOrEqual(ID_STRIDE)
    expect(max).toBeLessThan(2 * ID_STRIDE)
  })

  it('counts by storey, which is the query the storey panel asks', () => {
    const byStorey = rows(
      'SELECT storey, COUNT(*) FROM element GROUP BY storey ORDER BY 2 DESC, 1'
    ) as [string, number][]
    const total = byStorey.reduce((sum, [, count]) => sum + count, 0)
    expect(total).toBe(412)
    // Every storey in the federation ladder is represented by at least one element.
    for (const [name] of byStorey) {
      expect(federation.storeys.map((s) => s.name).concat('')).toContain(name)
    }
  })

  it('creates every table the schema documents', () => {
    const tables = rows(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).map(([name]) => name)
    expect(tables).toEqual([
      'attribute',
      'bbox',
      'classification',
      'element',
      'material',
      'model',
      'property',
      'pset',
      'quantity',
      'relationship',
      'spatial',
      'type_object'
    ])
  })
})

describe('sql schema — joins', () => {
  it('joins an element to one of its properties', () => {
    const found = rows(`
      SELECT e.name, ps.name, p.name, p.value
      FROM element e
      JOIN pset ps ON ps.element = e.id
      JOIN property p ON p.pset = ps.id
      WHERE e.type = 'IfcWindow' AND p.name = 'FireRating'
      ORDER BY e.id LIMIT 1
    `) as [string, string, string, string][]
    expect(found).toHaveLength(1)
    const [name, setName, key, value] = found[0]
    expect(setName).toBe('Pset_WindowCommon')
    expect(key).toBe('FireRating')
    // The value is as authored, not converted — the fidelity rule the whole index follows.
    const element = federation.elements.find((e) => e.name === name)!
    expect(String(element.psets[setName][key])).toBe(value)
  })

  it('joins an element to a quantity, keeping the number a number', () => {
    const found = rows(`
      SELECT q.name, q.value, q.text
      FROM element e JOIN pset ps ON ps.element = e.id JOIN quantity q ON q.pset = ps.id
      WHERE e.type = 'IfcWall' ORDER BY e.id, q.name LIMIT 1
    `) as [string, number, string][]
    expect(found).toHaveLength(1)
    expect(typeof found[0][1]).toBe('number')
    expect(found[0][2]).toBe(String(found[0][1]))
  })

  it('resolves the seven design attributes through the attribute table', () => {
    const [[level]] = rows(
      "SELECT COUNT(*) FROM attribute WHERE key = 'Level' AND value = 'L1'"
    ) as [[number]]
    const [[direct]] = rows("SELECT COUNT(*) FROM element WHERE storey = 'L1'") as [[number]]
    expect(level).toBe(direct)
    expect(level).toBeGreaterThan(0)
  })

  it('stores each element bounding box the mock federation carries', () => {
    const [[boxes]] = rows('SELECT COUNT(*) FROM bbox') as [[number]]
    expect(boxes).toBe(federation.elements.filter((e) => e.bbox).length)
    const [[finite]] = rows(
      'SELECT COUNT(*) FROM bbox WHERE min_x <= max_x AND min_y <= max_y AND min_z <= max_z'
    ) as [[number]]
    expect(finite).toBe(boxes)
  })
})

describe('sql schema — read-only', () => {
  it('refuses a write even when one gets past the guard', () => {
    // The guard would never pass this; the PRAGMA is the layer underneath it.
    expect(() => db.run("UPDATE element SET name = 'x' WHERE id = 1")).toThrow()
    expect(() => db.run('DROP TABLE element')).toThrow()
    expect(rows('SELECT COUNT(*) FROM element')[0][0]).toBe(412)
  })

  it('runs what the guard hands it, capped', () => {
    const guarded = guardSql('SELECT id FROM element')
    expect(guarded.ok).toBe(true)
    if (!guarded.ok) return
    // 412 elements, so the 201-row cap is what comes back.
    expect(rows(guarded.sql)).toHaveLength(201)
  })

  it('runs a wrapped WITH, which the LIMIT wrapper could have broken', () => {
    const guarded = guardSql(
      "WITH walls AS (SELECT id FROM element WHERE type = 'IfcWall') SELECT COUNT(*) FROM walls"
    )
    expect(guarded.ok).toBe(true)
    if (!guarded.ok) return
    const [[walls]] = rows(guarded.sql) as [[number]]
    const [[direct]] = rows("SELECT COUNT(*) FROM element WHERE type = 'IfcWall'") as [[number]]
    expect(walls).toBe(direct)
  })

  it('runs an EXPLAIN, which is why the guard leaves it unwrapped', () => {
    const guarded = guardSql('EXPLAIN QUERY PLAN SELECT * FROM element WHERE type = ?')
    expect(guarded.ok).toBe(true)
    if (!guarded.ok) return
    expect(rows(guarded.sql).length).toBeGreaterThan(0)
  })

  it('answers the readout query the temporary drop path logs', () => {
    const guarded = guardSql(
      'SELECT type, COUNT(*) FROM element GROUP BY type ORDER BY 2 DESC LIMIT 5'
    )
    expect(guarded.ok).toBe(true)
    if (!guarded.ok) return
    const top = rows(guarded.sql) as [string, number][]
    expect(top).toHaveLength(5)
    expect(top[0][1]).toBeGreaterThanOrEqual(top[4][1])
  })
})

describe('a build that fails part-way (B4)', () => {
  it('frees every prepared statement, closes the half-built database, and rethrows', () => {
    const prepared: { freed: boolean }[] = []
    let closed = 0
    // The real sql.js, with `prepare` and `close` watched.
    class Watched extends SQL.Database {
      prepare(...args: Parameters<Database['prepare']>): ReturnType<Database['prepare']> {
        const statement = super.prepare(...args)
        const record = { freed: false }
        prepared.push(record)
        const free = statement.free.bind(statement)
        statement.free = () => {
          record.freed = true
          return free()
        }
        return statement
      }
      close(): void {
        closed++
        super.close()
      }
    }
    // An element whose property sets are not an object: `fill` throws after every statement
    // has been prepared and the first rows are in.
    const broken = { ...federation.elements[0], psets: null } as never
    expect(() =>
      buildDatabase({ ...SQL, Database: Watched } as unknown as SqlJsStatic, {
        models: federation.models,
        elements: [federation.elements[1], broken]
      })
    ).toThrow()
    expect(prepared.length).toBe(12)
    expect(prepared.every((s) => s.freed)).toBe(true)
    expect(closed).toBe(1)
  })
})
