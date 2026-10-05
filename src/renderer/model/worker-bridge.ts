/**
 * The renderer's side of the parse worker: a promise API over `postMessage`.
 *
 * The trap this file exists to avoid (Marumi, `PROGRESS.md`): two uploads in flight leak a
 * worker and can show the wrong file's results. `cancel()` rejects on a later microtask, by
 * which time a second upload has already stored its handle — so an unconditional cleanup
 * clears the *live* worker. Every handler here compares the session it was created with by
 * identity before touching anything shared.
 */
import type { ProjectFrame } from '../../shared/georef'
import type {
  FederationOffset,
  GeometryChunk,
  GeometrySummary
} from '../../shared/geometry-contract.types'
import type { ModelIndex } from '../../shared/model-index.types'
import type { ParseRequest, ParseResponse, ParseStage } from '../../worker/parse.worker'
import type { RawLine } from '../../worker/index-builder'

export interface ParseProgress {
  modelKey: string
  stage: ParseStage
  /** Always a real value — a size, a schema, a count. Never a bare percentage. */
  detail: string
  fraction: number
}

export type ProgressListener = (progress: ParseProgress) => void

interface LoadHandle {
  resolve(index: ModelIndex): void
  reject(error: Error): void
  onProgress?: ProgressListener
  index: Partial<ModelIndex> & { elements: ModelIndex['elements'] }
}

/** One chunk of geometry, as it lands. Buffers are transferred, so do not keep the chunk. */
export type GeometryChunkListener = (chunk: GeometryChunk) => void

interface GeometryHandle {
  resolve(summary: GeometrySummary): void
  reject(error: Error): void
  onChunk?: GeometryChunkListener
}

interface Session {
  worker: Worker
  loads: Map<string, LoadHandle>
  geometries: Map<string, GeometryHandle>
  raws: Map<number, { resolve(line: RawLine | null): void; reject(error: Error): void }>
}

export class ParseWorkerBridge {
  private session: Session | null = null
  private nextRequestId = 1

  /** Spawn the worker on first use, and again after a cancellation. */
  private open(): Session {
    if (this.session) return this.session
    const worker = new Worker(new URL('../../worker/parse.worker.ts', import.meta.url), {
      type: 'module'
    })
    const session: Session = {
      worker,
      loads: new Map(),
      geometries: new Map(),
      raws: new Map()
    }
    worker.onmessage = (event: MessageEvent<ParseResponse>) => this.receive(session, event.data)
    worker.onerror = (event) => this.failAll(session, new Error(event.message || 'parse worker failed'))
    this.session = session
    return session
  }

  private send(session: Session, request: ParseRequest): void {
    session.worker.postMessage(request)
  }

  private receive(session: Session, message: ParseResponse): void {
    // A message from a worker we already terminated has nothing left to resolve.
    if (this.session !== session) return

    switch (message.type) {
      case 'progress': {
        session.loads.get(message.modelKey)?.onProgress?.({
          modelKey: message.modelKey,
          stage: message.stage,
          detail: message.detail,
          fraction: message.fraction
        })
        return
      }
      case 'meta': {
        const handle = session.loads.get(message.modelKey)
        if (handle) Object.assign(handle.index, message.meta)
        return
      }
      case 'elements': {
        const handle = session.loads.get(message.modelKey)
        if (!handle) return
        ;(handle.index.elements as ModelIndex['elements'][number][]).push(...message.elements)
        handle.onProgress?.({
          modelKey: message.modelKey,
          stage: 'building elements',
          detail: `${handle.index.elements.length.toLocaleString('en-US')} elements`,
          fraction: (message.chunk + 1) / message.chunks
        })
        return
      }
      case 'done': {
        const handle = session.loads.get(message.modelKey)
        if (!handle) return
        session.loads.delete(message.modelKey)
        handle.resolve({ ...handle.index, counts: message.counts } as ModelIndex)
        return
      }
      case 'geometryChunk': {
        session.geometries.get(message.modelKey)?.onChunk?.(message.chunk)
        return
      }
      case 'geometryDone': {
        const handle = session.geometries.get(message.modelKey)
        if (!handle) return
        session.geometries.delete(message.modelKey)
        handle.resolve(message.summary)
        return
      }
      case 'rawLine': {
        const pending = session.raws.get(message.requestId)
        if (!pending) return
        session.raws.delete(message.requestId)
        pending.resolve(message.line)
        return
      }
      case 'error': {
        const error = new Error(message.message)
        if (message.requestId !== undefined) {
          const pending = session.raws.get(message.requestId)
          if (pending) {
            session.raws.delete(message.requestId)
            pending.reject(error)
            return
          }
        }
        if (message.modelKey !== undefined) {
          const handle = session.loads.get(message.modelKey)
          if (handle) {
            session.loads.delete(message.modelKey)
            handle.reject(error)
            return
          }
          const geometry = session.geometries.get(message.modelKey)
          if (geometry) {
            session.geometries.delete(message.modelKey)
            geometry.reject(error)
            return
          }
        }
        this.failAll(session, error)
        return
      }
    }
  }

  private failAll(session: Session, error: Error): void {
    for (const handle of session.loads.values()) handle.reject(error)
    for (const handle of session.geometries.values()) handle.reject(error)
    for (const pending of session.raws.values()) pending.reject(error)
    session.loads.clear()
    session.geometries.clear()
    session.raws.clear()
  }

  /** Parse one file. The model stays open in the worker until `close(modelKey)`. */
  load(file: File | Blob, modelKey: string, onProgress?: ProgressListener): Promise<ModelIndex> {
    const session = this.open()
    if (session.loads.has(modelKey)) {
      return Promise.reject(new Error(`already loading "${modelKey}"`))
    }
    const fileName = file instanceof File ? file.name : modelKey
    return new Promise<ModelIndex>((resolve, reject) => {
      session.loads.set(modelKey, { resolve, reject, onProgress, index: { elements: [] } })
      this.send(session, { type: 'parse', modelKey, fileName, file })
    })
  }

  /**
   * Stream one parsed model's geometry. `offset` is the federation offset already in force;
   * pass `null` for the first model and read the offset it chose off the summary. `frame` is
   * the federation's project frame, which the caller always has — it read this model's index
   * before asking for its geometry.
   *
   * The model must already have been parsed by this bridge — the worker streams from the
   * model it still holds open, so nothing is re-read.
   */
  geometry(
    modelKey: string,
    offset: FederationOffset | null,
    frame: ProjectFrame | null,
    onChunk?: GeometryChunkListener
  ): Promise<GeometrySummary> {
    const session = this.open()
    if (session.geometries.has(modelKey)) {
      return Promise.reject(new Error(`already streaming geometry for "${modelKey}"`))
    }
    return new Promise<GeometrySummary>((resolve, reject) => {
      session.geometries.set(modelKey, { resolve, reject, onChunk })
      this.send(session, { type: 'geometry', modelKey, offset, frame })
    })
  }

  /** One raw STEP line with its references resolved a single level. */
  rawLine(modelKey: string, expressId: number): Promise<RawLine | null> {
    const session = this.open()
    const requestId = this.nextRequestId++
    return new Promise<RawLine | null>((resolve, reject) => {
      session.raws.set(requestId, { resolve, reject })
      this.send(session, { type: 'rawLine', modelKey, expressId, requestId })
    })
  }

  /** Release a model's wasm memory. Raw lines from it are unavailable afterwards. */
  close(modelKey: string): void {
    if (!this.session) return
    this.send(this.session, { type: 'close', modelKey })
  }

  /**
   * Terminate the worker and reject everything outstanding. The next `load` spawns a fresh
   * one — cancelling a 144 MB parse any other way means waiting for it to finish.
   */
  cancel(reason = 'parse cancelled'): void {
    const session = this.session
    if (!session) return
    // Clear the handle *before* rejecting: a rejection handler may start the next upload,
    // and it must not find this dead session.
    this.session = null
    session.worker.terminate()
    for (const handle of session.loads.values()) handle.reject(new Error(reason))
    for (const handle of session.geometries.values()) handle.reject(new Error(reason))
    for (const pending of session.raws.values()) pending.reject(new Error(reason))
  }
}
