/**
 * `runQuery`'s size cap (2026-11-08), through the real sql.js.
 *
 * The row cap alone does not bound a result: a SELECT the guard passes can make one cell
 * hundreds of megabytes (`printf('%.*c', 400000000, 'x')`), and 201 of them crash the worker's
 * process before main's `AI_JSON_MAX_CHARS` is ever checked. So the cells are counted while the
 * rows are collected, a cell is cut to what is left, and `truncated` says so — and a result under
 * both caps is exactly what it was.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { SQL_RESULT_MAX_CHARS, SQL_ROW_LIMIT } from '../../src/shared/sql-guard'
import { AI_JSON_MAX_CHARS } from '../../src/shared/ipc-contract'
import { runQuery } from '../../src/worker/sql-query'

const req = createRequire(import.meta.url)
let db: Database

const cellChars = (rows: readonly (readonly SqlValue[])[]): number =>
  rows.reduce(
    (sum, row) =>
      sum +
      row.reduce<number>(
        (s, v) => s + (typeof v === 'string' || v instanceof Uint8Array ? v.length : String(v).length),
        0
      ),
    0
  )

beforeAll(async () => {
  const dist = dirname(req.resolve('sql.js'))
  const SQL = await initSqlJs({ locateFile: (file) => join(dist, file) })
  db = new SQL.Database()
  db.run('CREATE TABLE element (id INTEGER PRIMARY KEY, type TEXT, name TEXT)')
  const insert = db.prepare('INSERT INTO element VALUES (?, ?, ?)')
  for (let i = 1; i <= 300; i++) insert.run([i, i % 2 ? 'IfcWall' : 'IfcDoor', `Element ${i}`])
  insert.free()
})
afterAll(() => db.close())

describe('runQuery: the size cap', () => {
  it('is half of the JSON cap main checks, so a cut result still reaches the model', () => {
    expect(SQL_RESULT_MAX_CHARS).toBe(AI_JSON_MAX_CHARS / 2)
  })

  it('cuts a printf-built huge cell and stops, saying so', () => {
    // 3 MB a cell, every row: well past the cap in the first row.
    const r = runQuery(db, "SELECT id, printf('%.*c', 3000000, 'x') AS big FROM element")
    expect(r.truncated).toBe(true)
    expect(r.cut).toBe('size')
    expect(r.rows.length).toBe(1)
    expect(cellChars(r.rows)).toBeLessThanOrEqual(SQL_RESULT_MAX_CHARS)
    expect(r.rows[0][0]).toBe(1)
    expect((r.rows[0][1] as string).length).toBe(SQL_RESULT_MAX_CHARS - 1)
  })

  it('cuts a huge blob the same way', () => {
    const r = runQuery(db, 'SELECT zeroblob(2000000) FROM element')
    expect(r.truncated).toBe(true)
    expect(r.cut).toBe('size')
    expect((r.rows[0][0] as Uint8Array).length).toBe(SQL_RESULT_MAX_CHARS)
  })

  it('stops at the cap across many medium rows, under the row cap', () => {
    // 150 rows of 10 000 characters: 1.5 M, under 200 rows.
    const r = runQuery(db, "SELECT printf('%.*c', 10000, 'y') FROM element LIMIT 150")
    expect(r.truncated).toBe(true)
    expect(r.cut).toBe('size')
    expect(r.rows.length).toBe(50)
    expect(cellChars(r.rows)).toBeLessThanOrEqual(SQL_RESULT_MAX_CHARS)
    // Every row but the one the cap fell in is whole.
    expect(r.rows.slice(0, 49).every((row) => (row[0] as string).length === 10000)).toBe(true)
  })

  it('leaves a result under both caps exactly as it was', () => {
    const r = runQuery(db, "SELECT id, type, name FROM element WHERE type = 'IfcWall' AND id <= 9 ORDER BY id")
    expect(r.truncated).toBe(false)
    expect('cut' in r).toBe(false)
    expect(r.columns).toEqual(['id', 'type', 'name'])
    expect(r.rows).toEqual([
      [1, 'IfcWall', 'Element 1'],
      [3, 'IfcWall', 'Element 3'],
      [5, 'IfcWall', 'Element 5'],
      [7, 'IfcWall', 'Element 7'],
      [9, 'IfcWall', 'Element 9']
    ])
  })

  it('still cuts by rows alone, with no size cut named', () => {
    const r = runQuery(db, 'SELECT id, name FROM element')
    expect(r.truncated).toBe(true)
    expect('cut' in r).toBe(false)
    expect(r.rows.length).toBe(SQL_ROW_LIMIT)
    expect(r.rows[SQL_ROW_LIMIT - 1]).toEqual([200, 'Element 200'])
  })
})
