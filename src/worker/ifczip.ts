/**
 * `.ifczip` — the third extension the design's drop zone advertises (`SGVue.dc.html:771`).
 *
 * An ifcZIP is an ordinary ZIP holding **one** IFC-SPF file (ISO 10303-21's own packaging
 * convention, carried into IFC by buildingSMART). Unzipping it in the worker is what lets the
 * design's copy stay true: a person drops the file the exporter gave them and it opens.
 *
 * Two things are deliberate:
 *
 * · **Exactly one `.ifc` entry.** An archive with none, or with several, is refused by name
 *   rather than guessed at — picking one of three would be picking a building for the user.
 * · **The SHA-256 stays the archive's.** `ModelIndex.sha256` identifies the file on disk,
 *   because that is what a session and a share link name and what `checkFiles` compares.
 */
import { unzipSync } from 'fflate'
import { MAX_FILE_BYTES, TOO_LARGE } from '../shared/upload'

/**
 * 2026-10-09 — whether a file's first bytes open a ZIP archive: a local file header,
 * `PK\x03\x04`, or — an archive with nothing in it — the end record, `PK\x05\x06`, so an empty
 * one gets `ifcFromZip`'s own answer. A split archive's `PK\x07\x08` is not one: it cannot be
 * read on its own. The worker learns a file's name only from a drop's `File`; from the Open
 * dialog, a Recent pill or a share link the bytes arrive as a `Blob`, named by the model key —
 * the name without its extension — so an `.ifczip` taken those ways was never unzipped and went
 * to web-ifc as an IFC (measured: a valid 1.5 kB archive took the renderer to 4.2 GB before
 * web-ifc aborted). An IFC-SPF file opens with `ISO-10303-21;`, never with these bytes.
 */
export const isZipArchive = (head: Uint8Array): boolean =>
  head.length >= 4 &&
  head[0] === 0x50 &&
  head[1] === 0x4b &&
  ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06))

/**
 * Whether the parse worker unzips a file before web-ifc reads it: its name says `.ifczip`, or —
 * on every route but a drop, where the name is the model key — its first four bytes say ZIP.
 */
export const isIfczip = (fileName: string, head: Uint8Array): boolean =>
  /\.ifczip$/i.test(fileName) || isZipArchive(head)

/** Directory entries, resource forks and dot-files are not the model. */
const isCandidate = (path: string): boolean =>
  /\.ifc$/i.test(path) && !path.endsWith('/') && !path.startsWith('__MACOSX/') &&
  !path.split('/').pop()!.startsWith('.')

export interface ZippedIfc {
  /** The entry's own name inside the archive, without its directories. */
  name: string
  bytes: Uint8Array
}

export function ifcFromZip(archive: Uint8Array): ZippedIfc {
  // First pass: read the directory only — a filter that answers `false` inflates nothing — so
  // an archive that will be refused (none, several, or one that declares itself larger than
  // the 600 MB any file may be) never costs a byte of decompression.
  const names: string[] = []
  let oversized = false
  unzipSync(archive, {
    filter: (f) => {
      if (isCandidate(f.name)) {
        names.push(f.name)
        if (f.originalSize > MAX_FILE_BYTES) oversized = true
      }
      return false
    }
  })
  if (names.length === 0) throw new Error('the archive contains no .ifc file')
  if (names.length > 1) {
    throw new Error(
      `the archive contains ${names.length} .ifc files — unzip it and open the one you want`
    )
  }
  // The size reason the drop zone gives, advice and all (2026-10-09, `shared/upload.ts`).
  if (oversized) throw new Error(`the .ifc file in the archive is ${TOO_LARGE}`)
  const [only] = names
  const entries = unzipSync(archive, { filter: (f) => f.name === only })
  const bytes = entries[only]
  // The declared size is the archive's word; the inflated bytes are the fact.
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error(`the .ifc file in the archive is ${TOO_LARGE}`)
  }
  return { name: only.split('/').pop() || only, bytes }
}
