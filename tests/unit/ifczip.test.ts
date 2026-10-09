/**
 * `.ifczip` — the third extension the design's drop zone advertises.
 */
import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ifcFromZip, isIfczip, isZipArchive } from '../../src/worker/ifczip'

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
    expect(() => ifcFromZip(bomb)).toThrow(
      'the .ifc file in the archive is larger than 600 MB — consider splitting it into several models'
    )
  })

  it('still opens an entry that declares exactly what it holds', () => {
    const out = ifcFromZip(zipSync({ 'model.ifc': strToU8(STEP) }))
    expect(out.bytes.length).toBe(STEP.length)
  })
})

/*
 * 2026-10-09 — from the Open dialog, a Recent pill or a share link the worker is handed a Blob
 * named by the model key (`renderer/model/worker-bridge.ts`), so an .ifczip is known by its bytes.
 */
describe('isZipArchive — an archive is known by its first four bytes', () => {
  it('knows what fflate writes', () => {
    expect(isZipArchive(zipSync({ 'model.ifc': strToU8(STEP) }).subarray(0, 4))).toBe(true)
  })

  it('knows an empty archive, which is its end record alone (50 4B 05 06)', () => {
    const empty = zipSync({})
    expect([...empty.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06])
    expect(isZipArchive(empty.subarray(0, 4))).toBe(true)
  })

  it('never takes an IFC-SPF file, an empty file, a short one or a split archive for one', () => {
    expect(isZipArchive(strToU8(STEP).subarray(0, 4))).toBe(false)
    expect(isZipArchive(new Uint8Array(0))).toBe(false)
    expect(isZipArchive(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false)
    // A split archive's marker: no part of one can be read on its own.
    expect(isZipArchive(new Uint8Array([0x50, 0x4b, 0x07, 0x08]))).toBe(false)
  })
})

/*
 * The worker's own rule, `isIfczip(fileName, head)`, with the name the bridge sends for a `Blob`
 * — the model key, `podium` for `Podium.ifczip` — as on the Open dialog, a Recent pill or a link.
 */
describe('isIfczip — the archive is unzipped whichever way it came', () => {
  const head = (bytes: Uint8Array): Uint8Array => bytes.subarray(0, 4)

  it('a drop: the name alone decides, as it always did', () => {
    expect(isIfczip('Podium.ifczip', head(strToU8(STEP)))).toBe(true)
    expect(isIfczip('Podium.IFCZIP', new Uint8Array(0))).toBe(true)
  })

  it('the dialog, a pill or a link: the bytes decide, so the archive’s own answers come back', () => {
    const one = zipSync({ 'model.ifc': strToU8(STEP) })
    expect(isIfczip('podium', head(one))).toBe(true)
    expect(dec.decode(ifcFromZip(one).bytes)).toBe(STEP)

    const empty = zipSync({})
    expect(isIfczip('podium', head(empty))).toBe(true)
    expect(() => ifcFromZip(empty)).toThrow('the archive contains no .ifc file')

    const bomb = declare(corrupt(zipSync({ 'model.ifc': strToU8(STEP) })), 700 * 1024 * 1024)
    expect(isIfczip('podium', head(bomb))).toBe(true)
    expect(() => ifcFromZip(bomb)).toThrow(
      'the .ifc file in the archive is larger than 600 MB — consider splitting it into several models'
    )
  })

  it('an IFC file is never unzipped, whatever it is called', () => {
    expect(isIfczip('podium', head(strToU8(STEP)))).toBe(false)
    expect(isIfczip('Podium.ifc', head(strToU8(STEP)))).toBe(false)
  })
})
