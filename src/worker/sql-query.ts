/**
 * One read-only query against the model database, as the SQL worker answers it.
 *
 * Its own module (2026-11-07) so that it runs under Node as well as in the worker: the worker
 * (`sql.worker.ts`) is its one caller in the app, and the headless eval runner
 * (`tests/unit/ai-eval-offline.test.ts`) answers the assistant's `query_sql` and the eval's
 * ground-truth probes with this same function, against the same `buildDatabase`.
 */
import type { Database, SqlValue } from 'sql.js'
import { SQL_RESULT_MAX_CHARS, SQL_ROW_FETCH, SQL_ROW_LIMIT, guardSql } from '../shared/sql-guard'

export interface SqlQueryResult {
  columns: readonly string[]
  rows: readonly (readonly SqlValue[])[]
  /**
   * True when anything was left out: more rows than the cap (`rows` then holds the first 200),
   * or more than `SQL_RESULT_MAX_CHARS` of cell values (`cut: 'size'`).
   */
  truncated: boolean
  /**
   * Present only when the size cap bit (2026-11-08): the rows stop there, and the last row's
   * text or blob cells may be shortened — to `''` where nothing was left. Absent for a cut by
   * rows alone, so an ordinary result is exactly what it was.
   */
  cut?: 'size'
  ms: number
}

/** What a cell counts against the size cap: a text's characters, a blob's bytes, a number's digits. */
function cellSize(value: SqlValue): number {
  if (value === null) return 4
  if (typeof value === 'string' || value instanceof Uint8Array) return value.length
  return String(value).length
}

export function runQuery(database: Database, request: string): SqlQueryResult {
  const guard = guardSql(request)
  if (!guard.ok) throw new Error(guard.reason)

  const started = Date.now()
  const statement = database.prepare(guard.sql)
  try {
    const rows: SqlValue[][] = []
    let left = SQL_RESULT_MAX_CHARS
    let sizeCut = false
    while (rows.length < SQL_ROW_FETCH && statement.step()) {
      // Checked before `get()`, so a row past the cap is never copied out of SQLite.
      if (left <= 0) {
        sizeCut = true
        break
      }
      const row = statement.get()
      for (let i = 0; i < row.length; i++) {
        const value = row[i]
        const size = cellSize(value)
        if (size > left && (typeof value === 'string' || value instanceof Uint8Array)) {
          row[i] = value.slice(0, Math.max(0, left))
          sizeCut = true
          left = 0
        } else left -= size
      }
      rows.push(row)
      if (sizeCut) break
    }
    const columns = statement.getColumnNames()
    const byRows = rows.length >= SQL_ROW_FETCH
    return {
      columns,
      rows: byRows ? rows.slice(0, SQL_ROW_LIMIT) : rows,
      truncated: byRows || sizeCut,
      ...(sizeCut && !byRows ? { cut: 'size' as const } : {}),
      ms: Date.now() - started
    }
  } finally {
    statement.free()
  }
}
