/**
 * The SQL worker.
 *
 * It holds one in-memory SQLite database built from the federation's index and answers
 * read-only queries. Its own process is the containment: a query that runs away is stopped
 * by terminating this worker, which is exactly what `sql-bridge.ts` does after ten seconds.
 *
 * Read-only in three independent ways, so no single mistake opens a write path:
 *   1. `guardSql` rejects anything that is not one `SELECT` / `WITH` / `EXPLAIN`.
 *   2. `PRAGMA query_only = 1` is set on the connection once the tables are full.
 *   3. The database is a copy of the index. Nothing here can reach the IFC file.
 *
 * `db.export()` is sent back as soon as the build finishes, so the bridge — not the worker
 * — owns the bytes. After a timeout kill there is then something to rebuild from without
 * re-reading the model.
 */
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { SQL_ROW_FETCH, SQL_ROW_LIMIT, guardSql } from '../shared/sql-guard'
import { buildDatabase, type SqlPayload } from './sql-schema'

/* ────────────────────────────── protocol ────────────────────────────── */

export interface SqlQueryResult {
  columns: readonly string[]
  rows: readonly (readonly SqlValue[])[]
  /** True when the query had more rows than the cap; `rows` then holds the first 200. */
  truncated: boolean
  ms: number
}

export type SqlRequest =
  | { type: 'build'; payload: SqlPayload }
  /** Rebuild from bytes the bridge kept, after a timeout killed the previous worker. */
  | { type: 'restore'; bytes: Uint8Array }
  | { type: 'query'; requestId: number; sql: string }

export type SqlResponse =
  | { type: 'ready'; bytes: Uint8Array; elements: number; ms: number }
  | { type: 'restored'; ms: number }
  | { type: 'result'; requestId: number; result: SqlQueryResult }
  | { type: 'error'; requestId?: number; message: string }

const ctx = self as unknown as {
  postMessage(message: SqlResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<SqlRequest>) => void) | null
}

let sqlPromise: Promise<SqlJsStatic> | null = null
const sql = (): Promise<SqlJsStatic> => {
  sqlPromise ??= initSqlJs({ locateFile: () => sqlWasmUrl })
  return sqlPromise
}

let db: Database | null = null

/* ────────────────────────────── query ────────────────────────────── */

function runQuery(database: Database, request: string): SqlQueryResult {
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

/* ────────────────────────────── message loop ────────────────────────────── */

ctx.onmessage = (event: MessageEvent<SqlRequest>): void => {
  const request = event.data
  const fail = (error: unknown): void =>
    ctx.postMessage({
      type: 'error',
      requestId: request.type === 'query' ? request.requestId : undefined,
      message: error instanceof Error ? error.message : String(error)
    })

  switch (request.type) {
    case 'build':
      sql()
        .then((SQL) => {
          const started = Date.now()
          // Cleared first: a build that throws must leave "no database", not a closed one.
          db?.close()
          db = null
          db = buildDatabase(SQL, request.payload)
          const bytes = db.export()
          ctx.postMessage(
            {
              type: 'ready',
              bytes,
              elements: request.payload.elements.length,
              ms: Date.now() - started
            },
            [bytes.buffer as ArrayBuffer]
          )
        })
        .catch(fail)
      return

    case 'restore':
      sql()
        .then((SQL) => {
          const started = Date.now()
          db?.close()
          db = null
          db = new SQL.Database(request.bytes)
          db.run('PRAGMA query_only = 1')
          ctx.postMessage({ type: 'restored', ms: Date.now() - started })
        })
        .catch(fail)
      return

    case 'query':
      try {
        if (!db) throw new Error('no model database — build it first')
        ctx.postMessage({ type: 'result', requestId: request.requestId, result: runQuery(db, request.sql) })
      } catch (error) {
        fail(error)
      }
      return
  }
}
