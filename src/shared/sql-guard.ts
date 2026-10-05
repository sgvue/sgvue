/**
 * The SELECT-only gate in front of the SQL worker (plan §2 "Power query for AI", §3.8).
 *
 * Three layers protect the model database, and this is the first: nothing that is not a
 * single read statement gets as far as SQLite. The second is `PRAGMA query_only = 1`, set
 * on the connection after the tables are built. The third is that the database is a
 * throwaway copy of the index — there is no write path back to the IFC file at all.
 *
 * Pure string work, so it is fully unit-tested (`tests/unit/sql-guard.test.ts`) and shared
 * by the worker and by anything that wants to show the user what will actually run.
 *
 * The analysis is done on a copy with comments and string literals blanked out, so a
 * literal `'DELETE'` in a `WHERE` clause is data and passes, while `SELECT 1 -- x\n; DROP
 * TABLE element` is two statements and does not.
 */

/** Keywords that may never appear, as whole words, outside a string literal. */
export const FORBIDDEN_SQL_KEYWORDS = [
  'ATTACH',
  'DETACH',
  'PRAGMA',
  'VACUUM',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'REPLACE',
  'REINDEX',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
  'LOAD_EXTENSION'
] as const

/** Statements that may start a query. */
export const ALLOWED_SQL_HEADS = ['SELECT', 'WITH', 'EXPLAIN'] as const

/** Rows fetched. One more than the cap, so 201 means "there were more". */
export const SQL_ROW_FETCH = 201
/** Rows returned to the caller when the fetch came back full. */
export const SQL_ROW_LIMIT = 200

export type SqlGuardResult =
  | { ok: true; sql: string; head: (typeof ALLOWED_SQL_HEADS)[number] }
  | { ok: false; reason: string }

/**
 * Blank out `--` comments, block comments and every quoted run, replacing each with a
 * single space so neighbouring tokens cannot be glued together. Lengths are not preserved;
 * only the analysis copy is produced here, never the SQL that runs.
 */
export function stripSqlLiterals(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      out += ' '
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
    } else if (c === "'" || c === '"' || c === '`') {
      // SQLite escapes a quote by doubling it, so a doubled quote continues the literal.
      i++
      while (i < sql.length) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) i += 2
          else {
            i++
            break
          }
        } else i++
      }
      out += ' '
    } else if (c === '[') {
      const end = sql.indexOf(']', i)
      i = end === -1 ? sql.length : end + 1
      out += ' '
    } else {
      out += c
      i++
    }
  }
  return out
}

/**
 * Check one statement and return what the worker should run.
 *
 * `SELECT` and `WITH` are wrapped as `SELECT * FROM (<sql>) LIMIT 201`, which caps the
 * result inside SQLite rather than in JavaScript. `EXPLAIN` cannot be a subquery in SQLite,
 * so it is run as written; the worker stops reading at `SQL_ROW_FETCH` rows either way, and
 * a query plan is a handful of rows in any case.
 */
export function guardSql(input: string): SqlGuardResult {
  const sql = input.trim()
  if (!sql) return { ok: false, reason: 'empty query' }

  const analysed = stripSqlLiterals(sql)

  // Exactly one statement. A trailing `;` is fine; anything after it is not.
  const statements = analysed
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (statements.length === 0) return { ok: false, reason: 'no statement' }
  if (statements.length > 1) {
    return { ok: false, reason: 'one statement only — found ' + statements.length }
  }

  const head = (/^\s*([A-Za-z_]+)/.exec(analysed)?.[1] ?? '').toUpperCase()
  const allowed = ALLOWED_SQL_HEADS.find((candidate) => candidate === head)
  if (!allowed) {
    return {
      ok: false,
      reason: `read-only: a query must start with ${ALLOWED_SQL_HEADS.join(', ')} — found "${head || sql.slice(0, 12)}"`
    }
  }

  for (const keyword of FORBIDDEN_SQL_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(analysed)) {
      return { ok: false, reason: `read-only: "${keyword}" is not allowed` }
    }
  }

  // The statement that runs is the caller's own text, minus a trailing semicolon so the
  // wrapper stays valid SQL.
  const body = sql.replace(/;\s*$/, '')
  return {
    ok: true,
    head: allowed,
    sql: allowed === 'EXPLAIN' ? body : `SELECT * FROM (${body}) LIMIT ${SQL_ROW_FETCH}`
  }
}
