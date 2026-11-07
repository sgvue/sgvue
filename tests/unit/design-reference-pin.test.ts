/**
 * `design-reference/` is pinned, file by file (2026-11-07, core protection #2).
 *
 * The folder is the specification of record and is read-only (CLAUDE.md, Rules). Nothing else
 * stops it being edited to match a bug — a style string "corrected" in `SGVue.dc.html`, a colour
 * in `viewer-core.js` — after which every parity check agrees with the bug. So each file's
 * SHA-256 is committed in `tests/design-reference.sha256`, and this fails, naming the file, when
 * one is changed, added or removed.
 *
 * Updating the list is deliberate: `node scripts/design-reference-pin.cjs --write`, in the same
 * commit as the owner's new handoff and its recorded decision. The file list and the hashing are
 * the script's own (`pinnedFiles`, `currentHashes`), so the test and the update cannot disagree.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const req = createRequire(__filename)
const pin = req('../../scripts/design-reference-pin.cjs') as {
  LIST: string
  currentHashes: () => Map<string, string>
  parseList: (text: string) => Map<string, string>
  differences: (pinned: Map<string, string>, current: Map<string, string>) => string[]
}

describe('design-reference hash pin', () => {
  const pinned = pin.parseList(readFileSync(pin.LIST, 'utf8'))
  const current = pin.currentHashes()

  it('covers the whole specification, not an empty folder', () => {
    // The two files every port rule names; an empty listing would otherwise pass vacuously.
    expect([...current.keys()]).toEqual(
      expect.arrayContaining(['design-reference/design/SGVue.dc.html', 'design-reference/design/viewer-core.js'])
    )
  })

  it('every file under design-reference/ is byte-identical to its pinned SHA-256', () => {
    const diff = pin.differences(pinned, current)
    expect(
      diff,
      `design-reference/ is the read-only specification, and ${diff.length} file(s) differ from ` +
        `tests/design-reference.sha256:\n  ${diff.join('\n  ')}\n` +
        'Put the specification back. Only a new design handoff from the owner changes it — then ' +
        'run `node scripts/design-reference-pin.cjs --write` and commit the list with it.'
    ).toEqual([])
  })

  it('reports a changed, an added and a removed file by name', () => {
    const a = new Map([
      ['design-reference/x.html', '0'.repeat(64)],
      ['design-reference/gone.js', '1'.repeat(64)]
    ])
    const b = new Map([
      ['design-reference/x.html', 'f'.repeat(64)],
      ['design-reference/new.css', '2'.repeat(64)]
    ])
    expect(pin.differences(a, b)).toEqual([
      'added: design-reference/new.css',
      'changed: design-reference/x.html',
      'removed: design-reference/gone.js'
    ])
  })
})
