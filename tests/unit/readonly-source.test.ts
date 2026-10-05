/**
 * The read-only adapter's runtime half of guarantee 1 (SYSTEM_SPEC §6): every web-ifc write
 * API is sealed on the instance, and calling one throws rather than reaching the parser.
 *
 * The names are never spelled here either — they come from `FORBIDDEN_IFC_WRITE_API`, which
 * is the single file allowed to mention them.
 */
import { describe, expect, it } from 'vitest'
import { FORBIDDEN_IFC_WRITE_API } from '../../src/shared/readonly-list'
import { ReadOnlyViolation, createReadOnlyIfcSource } from '../../src/worker/ifc-source'

describe('read-only IFC source', () => {
  it('seals every forbidden write API', async () => {
    const src = await createReadOnlyIfcSource()
    try {
      expect([...src.sealedWriteApi.keys()].sort()).toEqual([...FORBIDDEN_IFC_WRITE_API].sort())
      for (const [name, stub] of src.sealedWriteApi) {
        expect(() => stub(), `${name} should throw`).toThrow(ReadOnlyViolation)
      }
    } finally {
      src.dispose()
    }
  })

  it('exposes read methods and resolves entity type codes', async () => {
    const src = await createReadOnlyIfcSource()
    try {
      const wall = src.typeCode('IFCWALL')
      expect(wall).toBeGreaterThan(0)
      expect(src.typeName(wall)).toBe('IfcWall')
      // A name no schema defines must resolve to 0, not to a plausible-looking hash.
      expect(src.typeCode('IFCDOESNOTEXIST')).toBe(0)
    } finally {
      src.dispose()
    }
  })
})
