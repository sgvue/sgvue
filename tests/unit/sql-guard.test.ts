/**
 * The SELECT-only gate.
 *
 * Every rejection here is a way someone has actually smuggled a write past a naive
 * "starts with SELECT" check: a second statement after a semicolon, a second statement
 * hidden behind a `--` comment, a write wrapped in `/* *​/`, a bare `PRAGMA`. And the one
 * acceptance that matters as much as the rejections: a string literal containing the word
 * DELETE is data, not a command, and must go through.
 */
import { describe, expect, it } from 'vitest'
import {
  SQL_ROW_FETCH,
  guardSql,
  stripSqlLiterals
} from '../../src/shared/sql-guard'

const ok = (sql: string): { sql: string } => {
  const result = guardSql(sql)
  expect(result.ok, `expected to be accepted: ${sql}`).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  return result
}

const refused = (sql: string): string => {
  const result = guardSql(sql)
  expect(result.ok, `expected to be refused: ${sql}`).toBe(false)
  return result.ok ? '' : result.reason
}

describe('sql guard — accepts a single read', () => {
  it('accepts SELECT, WITH and EXPLAIN', () => {
    ok('SELECT * FROM element')
    ok('  select id from element where type = ? ')
    ok('WITH walls AS (SELECT * FROM element WHERE type = 1) SELECT COUNT(*) FROM walls')
    ok('EXPLAIN QUERY PLAN SELECT * FROM element')
  })

  it('accepts a trailing semicolon', () => {
    expect(ok('SELECT 1;').sql).toBe(`SELECT * FROM (SELECT 1) LIMIT ${SQL_ROW_FETCH}`)
  })

  it('wraps SELECT and WITH with the row cap', () => {
    expect(ok('SELECT type FROM element').sql).toBe(
      `SELECT * FROM (SELECT type FROM element) LIMIT ${SQL_ROW_FETCH}`
    )
  })

  it('leaves EXPLAIN unwrapped, because a query plan cannot be a subquery', () => {
    expect(ok('EXPLAIN SELECT 1').sql).toBe('EXPLAIN SELECT 1')
  })

  it('accepts a string literal that contains a forbidden word', () => {
    // The word is data here, in a column the model actually has.
    ok("SELECT * FROM element WHERE name = 'DELETE'")
    ok(`SELECT * FROM property WHERE value = 'DROP TABLE element'`)
    ok("SELECT 'it''s a PRAGMA' AS note")
  })

  it('accepts a comment that mentions a forbidden word', () => {
    ok('SELECT 1 -- never DELETE anything\n')
    ok('/* no INSERT here */ SELECT 1')
  })
})

describe('sql guard — refuses everything else', () => {
  it('refuses writes and schema changes outright', () => {
    for (const sql of [
      "INSERT INTO element VALUES (1)",
      'UPDATE element SET name = 1',
      'DELETE FROM element',
      'DROP TABLE element',
      'CREATE TABLE x (a)',
      'ALTER TABLE element ADD COLUMN x',
      'REPLACE INTO element VALUES (1)',
      'VACUUM',
      'REINDEX',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'SAVEPOINT a',
      'RELEASE a',
      'DETACH db'
    ]) {
      expect(refused(sql)).toMatch(/read-only/)
    }
  })

  it('refuses PRAGMA and ATTACH, which reach outside the database', () => {
    expect(refused('PRAGMA query_only = 0')).toMatch(/read-only/)
    expect(refused("ATTACH DATABASE '/etc/passwd' AS leak")).toMatch(/read-only/)
    expect(refused("SELECT load_extension('evil.so')")).toMatch(/LOAD_EXTENSION/i)
  })

  it('refuses a second statement after a semicolon', () => {
    expect(refused('SELECT 1; DROP TABLE element')).toMatch(/one statement only/)
  })

  it('refuses a second statement hidden behind a line comment', () => {
    // Without comment stripping the `;` is invisible and the whole thing looks like one read.
    expect(refused('SELECT 1 -- harmless\n; DROP TABLE element')).toMatch(/one statement only/)
  })

  it('refuses a write wrapped in a block comment', () => {
    expect(refused('/* SELECT */ INSERT INTO element VALUES (1)')).toMatch(/read-only/)
    expect(refused('SELECT 1 /* x */; DELETE FROM element')).toMatch(/one statement only/)
  })

  it('refuses an empty query', () => {
    expect(refused('')).toMatch(/empty/)
    expect(refused('   ;  ')).toMatch(/no statement/)
  })
})

describe('sql guard — the analysis copy', () => {
  it('blanks comments and literals without gluing tokens together', () => {
    expect(stripSqlLiterals("SELECT 'a' FROM t").replace(/\s+/g, ' ')).toBe('SELECT FROM t')
    expect(stripSqlLiterals('SELECT 1 -- x\nFROM t').replace(/\s+/g, ' ')).toBe('SELECT 1 FROM t')
    expect(stripSqlLiterals('SELECT/*x*/1').replace(/\s+/g, ' ')).toBe('SELECT 1')
    // Doubled quotes continue the literal rather than ending it.
    expect(stripSqlLiterals("SELECT 'a''; DROP' FROM t").replace(/\s+/g, ' ')).toBe(
      'SELECT FROM t'
    )
    expect(stripSqlLiterals('SELECT [DELETE] FROM t').replace(/\s+/g, ' ')).toBe('SELECT FROM t')
  })
})
