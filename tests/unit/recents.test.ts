/**
 * The recents list — `src/main/sessions.ts`'s `mergeRecent`, which is what backs the landing
 * page's sample pills and the sidebar's library popover on the desktop.
 *
 * `mergeRecent` is the pure half on purpose: the disk half is two `writeFile`s.
 */
import { describe, expect, it } from 'vitest'
import { mergeRecent } from '../../src/main/sessions'
import { RECENTS_MAX } from '../../src/shared/ipc-contract'
import { COUNT_WORDS } from '../../src/shared/upload'
import { libraryOf } from '../../src/renderer/model/upload-pipeline'
import type { RecentFile } from '../../src/shared/ipc-contract'

const entry = (n: number, over: Partial<RecentFile> = {}): RecentFile => ({
  path: `/m/${n}.ifc`,
  name: `${n}.ifc`,
  size: 100 + n,
  sha256: `h${n}`,
  openedAt: 1000 + n,
  ...over
})

describe('mergeRecent', () => {
  it('puts the newest entry first', () => {
    expect(mergeRecent([entry(1), entry(2)], entry(3)).map((r) => r.path)).toEqual([
      '/m/3.ifc',
      '/m/1.ifc',
      '/m/2.ifc'
    ])
  })

  it('moves a path that is already there rather than duplicating it', () => {
    const list = [entry(1), entry(2), entry(3)]
    const out = mergeRecent(list, entry(3, { openedAt: 9999 }))
    expect(out.map((r) => r.path)).toEqual(['/m/3.ifc', '/m/1.ifc', '/m/2.ifc'])
    expect(out).toHaveLength(3)
  })

  it('refreshes the size and hash of a file re-opened after an edit', () => {
    const out = mergeRecent([entry(1, { sha256: 'old', size: 1 })], entry(1, { sha256: 'new', size: 2 }))
    expect(out[0]).toMatchObject({ sha256: 'new', size: 2 })
    expect(out).toHaveLength(1)
  })

  it('caps the list, dropping the oldest', () => {
    let list: RecentFile[] = []
    for (let i = 1; i <= RECENTS_MAX + 3; i++) list = mergeRecent(list, entry(i))
    expect(list).toHaveLength(RECENTS_MAX)
    expect(list[0].path).toBe(`/m/${RECENTS_MAX + 3}.ifc`)
    expect(list.map((r) => r.path)).not.toContain('/m/1.ifc')
  })

  it('is capped at six, so "open all N" never leaves the design’s word list', () => {
    // `SGVue.dc.html:1938` spells counts up to six; a seventh pill would read "open all 7".
    expect(RECENTS_MAX).toBe(6)
    expect(COUNT_WORDS).toHaveLength(RECENTS_MAX + 1)
  })
})

describe('libraryOf — recents as the designed library', () => {
  it('keeps the designed pill fields, with the stem as the name and the file beside it', () => {
    expect(libraryOf([{ path: '/m/Tower A.ifc', name: 'Tower A.ifc' }])[0]).toMatchObject({
      key: '/m/Tower A.ifc',
      name: 'Tower A',
      file: 'Tower A.ifc',
      path: '/m/Tower A.ifc'
    })
  })

  it('gives every pill a distinct swatch at the cap', () => {
    const swatches = libraryOf(
      [...Array(RECENTS_MAX)].map((_, i) => ({ path: `/m/${i}.ifc`, name: `${i}.ifc` }))
    ).map((f) => f.swatch)
    expect(new Set(swatches).size).toBe(RECENTS_MAX)
  })

  it('is empty when nothing has been opened, which is the design’s `hasSamples: false`', () => {
    expect(libraryOf([])).toEqual([])
  })
})
