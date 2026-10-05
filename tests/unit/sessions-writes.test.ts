/**
 * `src/main/sessions.ts` — the disk half (B3).
 *
 * `addRecent` is a read and then a write. Two of them at once used to both read the same list
 * and the second rename won, dropping the first file; both also wrote the same temporary name.
 * Every write now goes through one queue, and `addRecent` is `mergeRecent` — the tested rule is
 * the running rule. `electron` is mocked down to `app.getPath`, pointed at a temporary folder.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sgvue-sessions-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { addRecent, listRecents, saveSession, loadSession } = await import('../../src/main/sessions')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const file = (n: number): { path: string; name: string; size: number; sha256: string } => ({
  path: `/m/${n}.ifc`,
  name: `${n}.ifc`,
  size: n,
  sha256: `h${n}`
})

describe('concurrent writes', () => {
  it('keeps every entry when several addRecent calls race', async () => {
    await Promise.all([1, 2, 3, 4].map((n) => addRecent(file(n))))
    const paths = (await listRecents()).map((r) => r.path)
    expect([...paths].sort()).toEqual(['/m/1.ifc', '/m/2.ifc', '/m/3.ifc', '/m/4.ifc'])
    // Queued in call order, so the last call is the newest entry.
    expect(paths[0]).toBe('/m/4.ifc')
  })

  it('lands the last of several racing session saves, and leaves no temporary file', async () => {
    await Promise.all([1, 2, 3].map((n) => saveSession({ payload: { n }, savedAt: n })))
    expect((await loadSession())?.payload).toEqual({ n: 3 })
    expect(readdirSync(join(dir, 'sessions')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('one failed write does not stall the ones queued behind it', async () => {
    // A directory where recents.json should be: the rename inside the queue fails.
    const recents = join(dir, 'sessions', 'recents.json')
    rmSync(recents, { force: true })
    mkdirSync(recents)
    const failed = addRecent(file(9))
    const after = saveSession({ payload: { n: 4 }, savedAt: 4 })
    await expect(failed).rejects.toThrow()
    await after
    expect((await loadSession())?.payload).toEqual({ n: 4 })
  })
})
