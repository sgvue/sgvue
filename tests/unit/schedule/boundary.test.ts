/**
 * ifcTable's hard rule, kept in SGVue (2026-09-25): the engine never touches the DOM. Only
 * the Schedules window's page (`src/renderer/schedule-ui/`) does; everything under
 * `src/schedule/` is pure, so it runs in either renderer and in these tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../../..')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const full = join(dir, n)
    return statSync(full).isDirectory() ? files(full) : /\.ts$/.test(n) ? [full] : []
  })

describe('src/schedule/', () => {
  const all = files(join(ROOT, 'src/schedule'))

  it('has modules to check', () => {
    expect(all.length).toBeGreaterThan(15)
  })

  it('never references document or window, and imports nothing from a renderer', () => {
    const hits = all.filter((f) => {
      const text = readFileSync(f, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')
      return /\b(document|window)\s*[.[]/.test(text) || /from '\.\.\/(\.\.\/)?renderer\//.test(text)
    })
    expect(hits.map((f) => relative(ROOT, f))).toEqual([])
  })
})
