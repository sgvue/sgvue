/**
 * Audit A1 — the assistant's SQL database stays read-only after it is built AND exported.
 *
 * The worker (`src/worker/sql.worker.ts`, its `build` case) builds the database with
 * `buildDatabase`, which ends with `PRAGMA query_only = 1`, then calls `db.export()` to hand
 * the bytes to the renderer and keeps that same `db` as the live connection. Up to 1.15.1,
 * sql.js's `export()` closed and reopened the connection, which reset pragmas — so after the
 * export the live connection accepted writes (1.15.2 keeps them; the fix stays, so either
 * behaviour is read-only). `guardSql` (the SELECT-only gate) still refuses writes; this file is
 * about the pragma layer alone.
 *
 * The fix's contract, from `src/worker/sql-schema.ts`:
 *   `export function exportDatabase(db: Database): Uint8Array` — returns `db.export()`'s bytes
 *   and leaves `db` with `PRAGMA query_only` ON.
 * It is imported dynamically inside the tests that need it, so its absence fails only those.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { federate } from '../../src/shared/federate'
import { buildDatabase } from '../../src/worker/sql-schema'
import { mockModelIndex } from '../../src/renderer/dev/mock-adapter'

const KEYS = ['ARC', 'STR', 'SIT', 'MEP'] as const
const require = createRequire(import.meta.url)
const DIST = dirname(require.resolve('sql.js'))
const federation = federate(KEYS.map((key) => mockModelIndex(key)))
const payload = { models: federation.models, elements: federation.elements }

let SQL: SqlJsStatic
const open: Database[] = []

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (file) => join(DIST, file) })
})
afterEach(() => {
  while (open.length) open.pop()!.close()
})

const built = (): Database => {
  const db = buildDatabase(SQL, payload)
  open.push(db)
  return db
}

const queryOnly = (db: Database): unknown => db.exec('PRAGMA query_only')[0].values[0][0]

/** Every table and its row count, as `[name, count]` in name order. */
const tableCounts = (db: Database): [string, number][] =>
  (db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0].values as [
    string
  ][]).map(([name]) => [name, db.exec(`SELECT count(*) FROM "${name}"`)[0].values[0][0] as number])

/** The raw writes the pragma must refuse, each on a table the schema has. */
const WRITES: Record<string, string> = {
  INSERT: "INSERT INTO model (key) VALUES ('X')",
  UPDATE: "UPDATE element SET name = 'changed'",
  DELETE: 'DELETE FROM element',
  'DROP TABLE': 'DROP TABLE element',
  'CREATE TABLE': 'CREATE TABLE intruder (x INTEGER)'
}

const expectRefusesWrites = (db: Database): void => {
  for (const [what, sql] of Object.entries(WRITES)) {
    expect(() => db.run(sql), what).toThrow()
  }
}

type ExportFn = (db: Database) => Uint8Array
const loadExportDatabase = async (): Promise<ExportFn> => {
  const mod = (await import('../../src/worker/sql-schema')) as unknown as Record<string, unknown>
  expect(typeof mod.exportDatabase).toBe('function')
  return mod.exportDatabase as ExportFn
}

describe('A1 — PIN: a freshly built database refuses writes', () => {
  it('has query_only = 1 and throws on INSERT, CREATE TABLE and DELETE', () => {
    const db = built()
    expect(queryOnly(db)).toBe(1)
    expect(() => db.run(WRITES.INSERT)).toThrow()
    expect(() => db.run(WRITES['CREATE TABLE'])).toThrow()
    expect(() => db.run(WRITES.DELETE)).toThrow()
  })
})

describe('A1 — library behaviour the fix works around', () => {
  // sql.js up to 1.15.1 reset every pragma on export, which is what `exportDatabase` works
  // around. 2026-11-12 — sql.js 1.15.2 (the dependency update merged that day) keeps them, and
  // the canary that pinned the reset fired, as it was written to. It now pins what the pinned
  // version does; `exportDatabase` still sets the pragma again, so the connection is read-only
  // with either behaviour. If this fails, sql.js changed again: read the tests below first.
  it('a bare db.export() keeps query_only = 1 (sql.js 1.15.2; 1.15.1 left it at 0)', () => {
    const db = built()
    db.export()
    expect(queryOnly(db)).toBe(1)
  })

  // Proves every statement in WRITES is a valid write, so the "throws" asserted elsewhere is the
  // pragma refusing it, not a constraint or syntax error. 2026-11-12 — the pragma is switched off
  // by name here; until sql.js 1.15.2 a bare export did that by itself.
  it('with query_only switched off every write in WRITES succeeds', () => {
    const db = built()
    db.run('PRAGMA query_only = 0')
    expect(queryOnly(db)).toBe(0)
    for (const [what, sql] of Object.entries(WRITES)) {
      expect(() => db.run(sql), what).not.toThrow()
    }
  })
})

describe('A1 — DEFECT: exportDatabase keeps the live connection read-only', () => {
  it('returns bytes that open as the same database', async () => {
    const exportDatabase = await loadExportDatabase()
    const db = built()
    const before = tableCounts(db)
    const bytes = exportDatabase(db)
    expect(bytes).toBeInstanceOf(Uint8Array)
    const copy = new SQL.Database(bytes)
    open.push(copy)
    expect(tableCounts(copy)).toEqual(before)
    expect(before.length).toBeGreaterThan(0)
  })

  it('leaves query_only = 1 on the live connection', async () => {
    const exportDatabase = await loadExportDatabase()
    const db = built()
    exportDatabase(db)
    expect(queryOnly(db)).toBe(1)
  })

  it('leaves the live connection refusing INSERT, UPDATE, DELETE, DROP TABLE and CREATE TABLE', async () => {
    const exportDatabase = await loadExportDatabase()
    const db = built()
    exportDatabase(db)
    expectRefusesWrites(db)
  })

  it('still answers a SELECT count(*) with what it answered before', async () => {
    const exportDatabase = await loadExportDatabase()
    const db = built()
    const before = db.exec('SELECT count(*) FROM element')[0].values[0][0]
    exportDatabase(db)
    expect(db.exec('SELECT count(*) FROM element')[0].values[0][0]).toBe(before)
    expect(before).toBe(412)
  })
})

describe('A1 — DEFECT: the worker uses exportDatabase in its build case', () => {
  // The worker cannot be imported under Node: at module load it assigns `ctx.onmessage` on
  // `self` (the worker global) and imports `sql.js/dist/sql-wasm.wasm?url`, a Vite-only asset
  // import. So this is a source-level wiring check.
  const source = readFileSync(join(__dirname, '../../src/worker/sql.worker.ts'), 'utf8')
  const start = source.indexOf("case 'build':")
  const end = source.indexOf("case 'restore':")
  const buildCase = source.slice(start, end)

  it('finds the build case', () => {
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
  })

  it('calls exportDatabase( and no bare db.export()', () => {
    expect(buildCase).toContain('exportDatabase(')
    expect(buildCase).not.toMatch(/\bdb\.export\(\)/)
  })
})

describe('A1 — PIN: a database restored the way the worker restores refuses writes', () => {
  it('new SQL.Database(bytes) then PRAGMA query_only = 1 refuses every write', () => {
    const db = built()
    const bytes = db.export()
    const restored = new SQL.Database(bytes)
    open.push(restored)
    restored.run('PRAGMA query_only = 1')
    expect(queryOnly(restored)).toBe(1)
    expectRefusesWrites(restored)
    expect(restored.exec('SELECT count(*) FROM element')[0].values[0][0]).toBe(412)
  })
})
