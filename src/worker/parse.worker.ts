/**
 * The parse worker.
 *
 * Opening a 144 MB file, indexing 108 000 property relations and hashing 144 MB would each
 * freeze the window on their own. All of it happens here; the renderer only ever receives
 * progress messages and the index in pieces, so the viewport keeps drawing while a model
 * lands. (Aquila left the equivalent work on the main thread and paid a 4.7 s frozen tab.)
 *
 * Three things this file is careful about:
 *
 *  · **The file is never held whole.** It arrives as a `Blob` and is read in slices inside
 *    `OpenModelFromCallback`, so the main process never copies 600 MB across IPC.
 *  · **The SHA-256 is of the whole file, not of what web-ifc happened to ask for.** web-ifc
 *    requests 64 MB blocks and does not ask for them in order, so the hash walks forward on
 *    its own and fills any gap it is skipped over.
 *  · **Every stage ends with a real value** — the schema, the entity count, the pset count —
 *    because that is what makes a six-second wait read as work rather than as a hang.
 *
 * The model stays open after the index is sent so raw STEP lines and geometry can be
 * fetched on demand — geometry is a second request rather than part of the parse, because
 * the shell shows the tree and the property card long before the first frame is drawn.
 */
import { createSHA256 } from 'hash-wasm'
import wasmUrl from 'web-ifc/web-ifc.wasm?url'
import type { ProjectFrame } from '../shared/georef'
import type {
  FederationOffset,
  GeometryChunk,
  GeometrySummary
} from '../shared/geometry-contract.types'
import type { IfcElement, ModelCounts, ModelIndexMeta } from '../shared/model-index.types'
import { streamGeometry } from './geometry-streamer'
import { createReadOnlyIfcSource, type ReadBytes, type ReadOnlyIfcSource } from './ifc-source'
import { ifcFromZip } from './ifczip'
import { buildModelIndex, readRawLine, type RawLine } from './index-builder'

/* ────────────────────────────── protocol ────────────────────────────── */

export type ParseStage =
  | 'reading'
  | 'parsing entities'
  | 'reading units'
  | 'spatial structure'
  | 'indexing properties'
  | 'indexing relations'
  | 'building elements'
  | 'georeferencing'

export type ParseRequest =
  | { type: 'parse'; modelKey: string; fileName: string; file: Blob }
  | { type: 'rawLine'; modelKey: string; expressId: number; requestId: number }
  | { type: 'close'; modelKey: string }
  /**
   * Stream this model's geometry. `offset` is the federation offset already in force, or
   * `null` for the first model — then the first mesh defines it and `geometryDone` reports
   * what it turned out to be. `frame` is the federation's project frame, which the caller
   * always knows: it read this model's index before asking for its geometry.
   */
  | {
      type: 'geometry'
      modelKey: string
      offset: FederationOffset | null
      frame: ProjectFrame | null
    }

export type ParseResponse =
  | { type: 'progress'; modelKey: string; stage: ParseStage; detail: string; fraction: number }
  | { type: 'meta'; modelKey: string; meta: ModelIndexMeta }
  | { type: 'elements'; modelKey: string; chunk: number; chunks: number; elements: IfcElement[] }
  | { type: 'done'; modelKey: string; sha256: string; counts: ModelCounts; ms: number }
  | { type: 'rawLine'; requestId: number; line: RawLine | null }
  | { type: 'geometryChunk'; modelKey: string; chunk: GeometryChunk }
  | { type: 'geometryDone'; modelKey: string; summary: GeometrySummary }
  | { type: 'error'; modelKey?: string; requestId?: number; message: string }

/** Elements per `postMessage`, so the renderer can freeze and show progress as they land. */
const ELEMENT_CHUNK = 5000

/** Bytes hashed per block when the hash has to catch up on its own. */
const HASH_BLOCK = 8 * 1024 * 1024

/* ────────────────────────────── worker plumbing ────────────────────────────── */

/**
 * `FileReaderSync` is a worker-only global and is not in TypeScript's DOM library. It is the
 * only way to read a `Blob` synchronously, which `OpenModelFromCallback` requires.
 */
declare class FileReaderSync {
  readAsArrayBuffer(blob: Blob): ArrayBuffer
}

const ctx = self as unknown as {
  postMessage(message: ParseResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null
}

/** Geometry buffers are transferred, not copied: one chunk can be 30 MB. */
const post = (message: ParseResponse, transfer?: Transferable[]): void =>
  ctx.postMessage(message, transfer)

/** web-ifc is initialised once per worker; `Init` compiles the wasm module. */
let sourcePromise: Promise<ReadOnlyIfcSource> | null = null
const source = (): Promise<ReadOnlyIfcSource> => {
  sourcePromise ??= createReadOnlyIfcSource({ locateFile: () => wasmUrl })
  return sourcePromise
}

/** Models stay open for raw-line requests until the renderer closes them. */
const openModels = new Map<string, number>()

/* ────────────────────────────── parse ────────────────────────────── */

async function parse(modelKey: string, fileName: string, source0: Blob): Promise<void> {
  const started = Date.now()
  const src = await source()
  const reader = new FileReaderSync()
  const hasher = await createSHA256()
  hasher.init()

  // `.ifczip`: the SHA-256 stays the **archive's** — that is the file on disk, and what a
  // session and a share link name — so it is taken in one forward pass before the inner IFC
  // replaces the blob the parser reads (`ifczip.ts`).
  let file = source0
  let zipSha: string | null = null
  if (/\.ifczip$/i.test(fileName)) {
    const archive = new Uint8Array(reader.readAsArrayBuffer(source0))
    for (let at = 0; at < archive.length; at += HASH_BLOCK) {
      hasher.update(archive.subarray(at, Math.min(archive.length, at + HASH_BLOCK)))
    }
    zipSha = hasher.digest('hex')
    post({
      type: 'progress',
      modelKey,
      stage: 'reading',
      detail: (archive.length / 1048576).toFixed(1) + ' MB archive',
      fraction: 0.5
    })
    const inner = ifcFromZip(archive)
    file = new Blob([inner.bytes as BlobPart])
  }

  const slice = (offset: number, length: number): Uint8Array =>
    new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + length)))

  let hashedTo = 0
  let readTo = 0
  const hashUpTo = (end: number): void => {
    while (hashedTo < end) {
      const stop = Math.min(end, hashedTo + HASH_BLOCK)
      hasher.update(slice(hashedTo, stop - hashedTo))
      hashedTo = stop
    }
  }

  const read: ReadBytes = (offset, size) => {
    const end = Math.min(offset + size, file.size)
    const bytes = slice(offset, Math.max(0, end - offset))
    // The hash only ever moves forward. web-ifc may re-read a block or skip ahead; neither
    // may corrupt the digest, so overlaps are trimmed and gaps are read again on their own.
    if (zipSha === null && end > hashedTo) {
      if (offset > hashedTo) hashUpTo(offset)
      hasher.update(offset < hashedTo ? bytes.subarray(hashedTo - offset) : bytes)
      hashedTo = end
    }
    if (end > readTo) {
      readTo = end
      post({
        type: 'progress',
        modelKey,
        stage: 'reading',
        detail: (readTo / 1048576).toFixed(1) + ' MB',
        fraction: file.size ? readTo / file.size : 1
      })
    }
    return bytes
  }

  const modelID = src.openFromCallback(read)
  if (modelID < 0) throw new Error(`web-ifc could not open ${fileName}`)
  let sha256: string
  let index: ReturnType<typeof buildModelIndex>
  try {
    // web-ifc may stop short of the last byte; the digest is of the file, not of the read.
    if (zipSha === null) hashUpTo(file.size)
    sha256 = zipSha ?? hasher.digest('hex')
    post({
      type: 'progress',
      modelKey,
      stage: 'reading',
      detail: (file.size / 1048576).toFixed(1) + ' MB · SHA-256 ' + sha256.slice(0, 8),
      fraction: 1
    })

    index = buildModelIndex(src, modelID, {
      modelKey,
      fileName,
      sha256,
      onStage: (stage, detail, fraction) =>
        post({ type: 'progress', modelKey, stage, detail, fraction })
    })
  } catch (err) {
    src.close(modelID)
    throw err
  }
  // 2026-09-24 — a confirmed replacement parses under the key of the model it replaces, which
  // stays open for raw-line requests until the new file has parsed. Only then is it closed,
  // so a file that fails to parse leaves the old one exactly as it was.
  const replaced = openModels.get(modelKey)
  if (replaced !== undefined) src.close(replaced)
  openModels.set(modelKey, modelID)

  const { elements, ...meta } = index
  post({ type: 'meta', modelKey, meta })

  const chunks = Math.max(1, Math.ceil(elements.length / ELEMENT_CHUNK))
  for (let chunk = 0; chunk < chunks; chunk++) {
    post({
      type: 'elements',
      modelKey,
      chunk,
      chunks,
      elements: elements.slice(chunk * ELEMENT_CHUNK, (chunk + 1) * ELEMENT_CHUNK) as IfcElement[]
    })
  }

  post({ type: 'done', modelKey, sha256, counts: index.counts, ms: Date.now() - started })
}

/* ────────────────────────────── message loop ────────────────────────────── */

ctx.onmessage = (event: MessageEvent<ParseRequest>): void => {
  const request = event.data
  const fail = (err: unknown): void =>
    post({
      type: 'error',
      modelKey: 'modelKey' in request ? request.modelKey : undefined,
      requestId: 'requestId' in request ? request.requestId : undefined,
      message: err instanceof Error ? err.message : String(err)
    })

  switch (request.type) {
    case 'parse':
      parse(request.modelKey, request.fileName, request.file).catch(fail)
      return

    case 'rawLine':
      source()
        .then((src) => {
          const modelID = openModels.get(request.modelKey)
          post({
            type: 'rawLine',
            requestId: request.requestId,
            line: modelID === undefined ? null : readRawLine(src, modelID, request.expressId)
          })
        })
        .catch(fail)
      return

    case 'close':
      source()
        .then((src) => {
          const modelID = openModels.get(request.modelKey)
          if (modelID !== undefined) {
            src.close(modelID)
            openModels.delete(request.modelKey)
          }
        })
        .catch(fail)
      return

    case 'geometry':
      source()
        .then((src) => {
          const modelID = openModels.get(request.modelKey)
          if (modelID === undefined) {
            throw new Error(`no open model "${request.modelKey}" — parse it first`)
          }
          const summary = streamGeometry(src, modelID, {
            modelKey: request.modelKey,
            offset: request.offset,
            frame: request.frame,
            onChunk: (chunk, transfer) =>
              post({ type: 'geometryChunk', modelKey: request.modelKey, chunk }, transfer)
          })
          post({ type: 'geometryDone', modelKey: request.modelKey, summary })
        })
        .catch(fail)
      return
  }
}
