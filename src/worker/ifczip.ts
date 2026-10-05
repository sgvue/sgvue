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
import { MAX_FILE_BYTES } from '../shared/upload'

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
  if (oversized) throw new Error('the .ifc file in the archive is larger than 600 MB')
  const [only] = names
  const entries = unzipSync(archive, { filter: (f) => f.name === only })
  const bytes = entries[only]
  // The declared size is the archive's word; the inflated bytes are the fact.
  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error('the .ifc file in the archive is larger than 600 MB')
  }
  return { name: only.split('/').pop() || only, bytes }
}
