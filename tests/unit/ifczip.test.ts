/**
 * `.ifczip` — the third extension the design's drop zone advertises.
 */
import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ifcFromZip } from '../../src/worker/ifczip'

const STEP = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'
const dec = new TextDecoder()

describe('ifcFromZip', () => {
  it('finds the single .ifc inside', () => {
    const out = ifcFromZip(zipSync({ 'model.ifc': strToU8(STEP) }))
    expect(out.name).toBe('model.ifc')
    expect(dec.decode(out.bytes)).toBe(STEP)
  })

  it('finds it inside a folder, and reports the entry’s own name', () => {
    const out = ifcFromZip(zipSync({ 'export/2026/Tower A.ifc': strToU8(STEP) }))
    expect(out.name).toBe('Tower A.ifc')
  })

  it('ignores the archive’s other files', () => {
    const out = ifcFromZip(
      zipSync({ 'readme.txt': strToU8('x'), 'model.ifc': strToU8(STEP), 'thumb.png': strToU8('y') })
    )
    expect(out.name).toBe('model.ifc')
  })

  it('ignores macOS resource forks and dot-files', () => {
    const out = ifcFromZip(
      zipSync({
        '__MACOSX/._model.ifc': strToU8('junk'),
        '.hidden.ifc': strToU8('junk'),
        'model.ifc': strToU8(STEP)
      })
    )
    expect(dec.decode(out.bytes)).toBe(STEP)
  })

  it('refuses an archive with no .ifc, by name', () => {
    expect(() => ifcFromZip(zipSync({ 'notes.txt': strToU8('x') }))).toThrow(
      'the archive contains no .ifc file'
    )
  })

  it('refuses an archive with several, rather than picking a building for the user', () => {
    expect(() =>
      ifcFromZip(zipSync({ 'a.ifc': strToU8(STEP), 'b.ifc': strToU8(STEP) }))
    ).toThrow('the archive contains 2 .ifc files')
  })
})

/* ────────── S4: refused archives are never inflated ────────── */

const dv = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** Every entry's compressed bytes overwritten with 0xFF: inflating any of them throws. */
function corrupt(zip: Uint8Array): Uint8Array {
  const out = zip.slice()
  const v = dv(out)
  for (let i = 0; v.getUint32(i, true) === 0x04034b50; ) {
    const size = v.getUint32(i + 18, true)
    const start = i + 30 + v.getUint16(i + 26, true) + v.getUint16(i + 28, true)
    out.fill(0xff, start, start + size)
    i = start + size
  }
  return out
}

/** Every central-directory entry now declares `size` uncompressed bytes. */
function declare(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice()
  const v = dv(out)
  for (let i = 0; i + 4 <= out.length; i++) {
    if (v.getUint32(i, true) === 0x02014b50) v.setUint32(i + 24, size, true)
  }
  return out
}

describe('ifcFromZip — a refused archive costs no decompression', () => {
  it('the corruption helper really does break inflation', () => {
    expect(() => ifcFromZip(corrupt(zipSync({ 'model.ifc': strToU8(STEP) })))).toThrow()
    expect(() => ifcFromZip(corrupt(zipSync({ 'model.ifc': strToU8(STEP) })))).not.toThrow(
      /archive contains/
    )
  })

  it('refuses several .ifc entries by count without inflating any of them', () => {
    const three = corrupt(
      zipSync({ 'a.ifc': strToU8(STEP), 'b.ifc': strToU8(STEP), 'c.ifc': strToU8(STEP) })
    )
    expect(() => ifcFromZip(three)).toThrow(
      'the archive contains 3 .ifc files — unzip it and open the one you want'
    )
  })

  it('refuses an entry that declares more than 600 MB, before inflating it', () => {
    const bomb = declare(corrupt(zipSync({ 'model.ifc': strToU8(STEP) })), 700 * 1024 * 1024)
    expect(() => ifcFromZip(bomb)).toThrow('the .ifc file in the archive is larger than 600 MB')
  })

  it('still opens an entry that declares exactly what it holds', () => {
    const out = ifcFromZip(zipSync({ 'model.ifc': strToU8(STEP) }))
    expect(out.bytes.length).toBe(STEP.length)
  })
})
