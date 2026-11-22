/**
 * The bundled IFC-SG CoP corpus (2026-11-22) — the pinned, trimmed copy `ifcsg_columns` reads.
 *
 * `scripts/ifcsg-corpus.cjs` writes `src/shared/ifcsg-cop.json` from the corpus at
 * https://ifcsg-md.pages.dev/ (corpus v4 rev 3, the CoP 4th Edition; CC BY 4.0; an independent
 * compilation, not an official BCA publication). What this holds:
 *   · the copy is the one recorded — the source file's SHA-256, its version and revision;
 *   · nobody edited it by hand — its content hash is recomputed here;
 *   · two classifications the owner checks by eye: `IfcDoor.DOOR` has 21 properties, `IfcDoor.OPENING` 3;
 *   · NOTICE credits it.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IFCSG_COP, copClassification } from '../../src/shared/ifcsg-cop'

const ROOT = join(__dirname, '..', '..')

describe('the bundled IFC-SG CoP corpus', () => {
  it('is the copy recorded: corpus v4 rev 3, its source file’s SHA-256, from ifcsg-md.pages.dev', () => {
    const s = IFCSG_COP.source
    expect(s.sha256).toBe('069430c3bd895bf3719ebdb63944f3080c7645116e83b78d751149cd9af2bcc0')
    expect(s.corpusVersion).toBe('4')
    expect(s.revision).toBe(3)
    expect(s.url).toBe('https://ifcsg-md.pages.dev/corpus/_reference/classifications.json')
    expect(s.license).toBe('CC BY 4.0')
    expect(s.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(s.note).toContain('not an official BCA publication')
  })

  it('has not been edited by hand: its content hash is what the generator recorded', () => {
    const hash = createHash('sha256').update(JSON.stringify(IFCSG_COP.classifications)).digest('hex')
    expect(hash).toBe(IFCSG_COP.contentSha256)
    // And the recorded hash is itself pinned: a regenerated copy changes this line in the same commit.
    expect(IFCSG_COP.contentSha256).toBe('aaa9d7688aa0e08e32ef8c83d65d7e52eb51068874e929900e4cae0543191ea3')
    expect(IFCSG_COP.classifications).toHaveLength(275)
  })

  it('lists 21 properties for IfcDoor.DOOR and 3 for IfcDoor.OPENING, each once', () => {
    const door = copClassification('IfcDoor', 'DOOR')!
    expect(door.key).toBe('IfcDoor.DOOR')
    expect(door.properties).toHaveLength(21)
    expect(door.properties.map((p) => p.name)).toContain('FireRating')
    expect(door.properties.map((p) => p.name)).toContain('ClearWidth')
    expect(door.sources[0].component).toBe('Door')
    const opening = copClassification('IfcDoor', 'OPENING')!
    expect(opening.properties.map((p) => p.name)).toEqual(['AmendmentStatus', 'FireAccessOpening', 'Status'])
    // A property name appears once per classification, wherever several tables list it.
    for (const c of IFCSG_COP.classifications) {
      const names = c.properties.map((p) => p.name)
      expect([c.key, new Set(names).size]).toEqual([c.key, names.length])
    }
  })

  it('finds a classification by entity and sub-type, and a plain entity by itself', () => {
    expect(copClassification('IfcDoor', 'SINK')).toBeUndefined()
    expect(copClassification('IfcWall', null)?.key).toBe('IfcWall')
    expect(copClassification('IfcDoor', null)).toBeUndefined()
  })

  it('is credited in NOTICE: CC BY 4.0, the source, and that it is not an official BCA publication', () => {
    const notice = readFileSync(join(ROOT, 'NOTICE'), 'utf8')
    expect(notice).toContain('src/shared/ifcsg-cop.json')
    expect(notice).toContain('https://ifcsg-md.pages.dev/')
    expect(notice).toContain('CC BY 4.0')
    expect(notice).toContain('not an official BCA publication')
  })
})
