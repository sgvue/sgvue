/**
 * The session autosave (refactor pass 2, P1). The store changes for reasons the session does
 * not record — the frame rate, the hint, a hover — and each one used to rewrite `last.json`
 * with the same payload and a new `savedAt`, about once a second at rest. A payload identical
 * to the last one sent is not sent again; a changed one is, and a failed write is retried by
 * the next change even when that change puts the payload back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAVE_DEBOUNCE_MS, saveSession } from '../../src/renderer/model/session'
import { useShell } from '../../src/renderer/state/shell'

const INITIAL = useShell.getState()
let writes: Record<string, unknown>[] = []
let fail = false

beforeEach(() => {
  vi.useFakeTimers()
  writes = []
  fail = false
  useShell.setState({ ...INITIAL, booted: true, hidden: {} }, true)
  vi.stubGlobal('window', {
    sgvue: {
      saveSession: async (env: { payload: Record<string, unknown> }) => {
        if (fail) throw new Error('disk full')
        writes.push(env.payload)
      }
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 1)
}

describe('saveSession', () => {
  it('writes once, then not again for a payload that has not changed', async () => {
    useShell.setState({ hidden: { 1: true } })
    saveSession()
    await settle()
    expect(writes).toHaveLength(1)
    // The frame rate moved; the session did not.
    useShell.getState().setStats({ fps: 12, backend: 'WebGL2', calls: 3 })
    saveSession()
    await settle()
    saveSession()
    await settle()
    expect(writes).toHaveLength(1)
    useShell.setState({ hidden: { 1: true, 2: true } })
    saveSession()
    await settle()
    expect(writes).toHaveLength(2)
    expect(writes[1].hidden).toEqual({ 1: true, 2: true })
  })

  it('a write that failed is not remembered as sent', async () => {
    useShell.setState({ hidden: { 3: true } })
    fail = true
    saveSession()
    await settle()
    expect(writes).toHaveLength(0)
    fail = false
    saveSession()
    await settle()
    expect(writes).toHaveLength(1)
  })
})
