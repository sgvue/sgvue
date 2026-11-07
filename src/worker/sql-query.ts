/**
 * One read-only query against the model database, as the SQL worker answers it.
 *
 * Its own module (2026-11-07) so that it runs under Node as well as in the worker: the worker
 * (`sql.worker.ts`) is its one caller in the app, and the headless eval runner
 * (`tests/unit/ai-eval-offline.test.ts`) answers the assistant's `query_sql` and the eval's
 * ground-truth probes with this same function, against the same `buildDatabase`.
 */
import type { Database, SqlValue } from 'sql.js'
import { SQL_ROW_FETCH, SQL_ROW_LIMIT, guardSql } from '../shared/sql-guard'

export interface SqlQueryResult {
  columns: readonly string[]
  rows: readonly (readonly SqlValue[])[]
  /** True when the query had more rows than the cap; `rows` then holds the first 200. */
  truncated: boolean
  ms: number
}

export function runQuery(database: Database, request: string): SqlQueryResult {
  const guard = guardSql(request)
  if (!guard.ok) throw new Error(guard.reason)

  const started = Date.now()
  const statement = database.prepare(guard.sql)
  try {
    const rows: SqlValue[][] = []
    while (rows.length < SQL_ROW_FETCH && statement.step()) rows.push(statement.get())
    const columns = statement.getColumnNames()
    const truncated = rows.length >= SQL_ROW_FETCH
    return {
      columns,
      rows: truncated ? rows.slice(0, SQL_ROW_LIMIT) : rows,
      truncated,
      ms: Date.now() - started
    }
  } finally {
    statement.free()
  }
}
