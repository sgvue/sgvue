/**
 * The renderer's side of the SQL worker: `query(sql)` in, `{ columns, rows, truncated, ms }`
 * out.
 *
 * The ten-second limit is enforced the only way that actually works against a runaway
 * SQLite query: the worker is terminated. A cooperative cancel cannot interrupt
 * `sqlite3_step`, and the assistant will eventually write a cross join that never returns.
 *
 * That is why **the bridge keeps the database bytes, not the worker**: after a kill there is
 * something to rebuild from, in about the time an open takes, without touching the IFC file
 * again. `db.export()` arrives with the build and is held here.
 */
import type { SqlPayload } from '../../worker/sql-schema'
import type { SqlQueryResult, SqlRequest, SqlResponse } from '../../worker/sql.worker'

export type { SqlQueryResult }

/** A query that has not answered in this long has its worker terminated. */
export const SQL_TIMEOUT_MS = 10_000

const NO_DATABASE = (): Error => new Error('no model database — build it first')

interface Pending<T> {
  resolve(value: T): void
  reject(error: Error): void
}

export class SqlBridge {
  private worker: Worker | null = null
  /** The built database, owned here so a terminated worker can be rebuilt from it. */
  private bytes: Uint8Array | null = null
  /** The outstanding `build` or `restore`; only ever one at a time. */
  private loading: Pending<{ elements: number; ms: number }> | null = null
  private queries = new Map<number, Pending<SqlQueryResult> & { timer: number }>()
  private nextRequestId = 1
  /** Bumped by `dispose`, so a load queued behind another never starts after it. */
  private gen = 0
  /** Resolves when the current worker holds a usable database. */
  private ready: Promise<unknown> = this.idle()

  /** A rejection nothing is waiting on yet, pre-caught so it is not reported as unhandled. */
  private idle(): Promise<never> {
    const rejected = Promise.reject(NO_DATABASE())
    rejected.catch(() => {})
    return rejected
  }

  private spawn(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('../../worker/sql.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = (event: MessageEvent<SqlResponse>) => this.receive(worker, event.data)
    worker.onerror = (event) => this.kill(new Error(event.message || 'sql worker failed'))
    this.worker = worker
    return worker
  }

  private receive(worker: Worker, message: SqlResponse): void {
    // A message from a worker we already terminated has nothing left to resolve.
    if (this.worker !== worker) return
    switch (message.type) {
      case 'ready': {
        this.bytes = message.bytes
        const loading = this.loading
        this.loading = null
        loading?.resolve({ elements: message.elements, ms: message.ms })
        return
      }
      case 'restored': {
        const loading = this.loading
        this.loading = null
        loading?.resolve({ elements: 0, ms: message.ms })
        return
      }
      case 'result': {
        const pending = this.queries.get(message.requestId)
        if (!pending) return
        this.queries.delete(message.requestId)
        clearTimeout(pending.timer)
        pending.resolve(message.result)
        return
      }
      case 'error': {
        const error = new Error(message.message)
        if (message.requestId !== undefined) {
          const pending = this.queries.get(message.requestId)
          if (pending) {
            this.queries.delete(message.requestId)
            clearTimeout(pending.timer)
            pending.reject(error)
            return
          }
        }
        const loading = this.loading
        this.loading = null
        loading?.reject(error)
        return
      }
    }
  }

  private send(request: SqlRequest): void {
    this.spawn().postMessage(request)
  }

  /** Terminate the worker and fail everything outstanding. */
  private kill(error: Error): void {
    const worker = this.worker
    this.worker = null
    worker?.terminate()
    for (const pending of this.queries.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.queries.clear()
    const loading = this.loading
    this.loading = null
    loading?.reject(error)
  }

  /**
   * One `build` or `restore` at a time: each is sent only once the one before it has settled.
   * There is one `loading` slot, so a build sent while a timeout's restore was still running
   * used to be resolved by the restore's `restored` — early, and with nothing built.
   */
  private load(request: SqlRequest): Promise<{ elements: number; ms: number }> {
    const gen = this.gen
    // A load still queued when the bridge is disposed must not start a worker afterwards.
    const next = (): Promise<{ elements: number; ms: number }> =>
      gen === this.gen ? this.sendLoad(request) : Promise.reject(new Error('sql bridge disposed'))
    const promise = this.ready.then(next, next)
    this.ready = promise
    promise.catch(() => {})
    return promise
  }

  private sendLoad(request: SqlRequest): Promise<{ elements: number; ms: number }> {
    return new Promise((resolve, reject) => {
      this.loading = { resolve, reject }
      this.send(request)
    })
  }

  /** Build the database from the federation. Resolves with what it cost. */
  build(payload: SqlPayload): Promise<{ elements: number; ms: number }> {
    return this.load({ type: 'build', payload })
  }

  /**
   * Run one read-only query. Rejects with the guard's own words when the SQL is refused,
   * and after `SQL_TIMEOUT_MS` kills the worker and reloads the kept bytes for the next
   * caller.
   */
  async query(sql: string): Promise<SqlQueryResult> {
    await this.ready
    const requestId = this.nextRequestId++
    return new Promise<SqlQueryResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timedOut = new Error(`query cancelled after ${SQL_TIMEOUT_MS / 1000} s`)
        this.queries.delete(requestId)
        this.kill(timedOut)
        reject(timedOut)
        // Sent by copy, never transferred: the bridge must still own the bytes afterwards.
        if (this.bytes) this.load({ type: 'restore', bytes: this.bytes }).catch(() => {})
        else this.ready = this.idle()
      }, SQL_TIMEOUT_MS) as unknown as number
      this.queries.set(requestId, { resolve, reject, timer })
      this.send({ type: 'query', requestId, sql })
    })
  }

  dispose(): void {
    this.gen++
    this.kill(new Error('sql bridge disposed'))
    this.bytes = null
    this.ready = this.idle()
  }
}
