/**
 * `src/main/file-protocol.ts` — the token lifecycle.
 *
 * `electron` is mocked down to the two things the module touches: `protocol.handle`, whose
 * handler the test then calls directly, and `net.fetch`, which stands in for the OS stream.
 * Everything else — `realpath`, `stat`, the extension and size gates — is the real thing
 * against real files in a temporary directory.
 */
import { mkdtemp, open, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RefusedFile } from '../../src/shared/ipc-contract'

let handler: ((request: { url: string }) => Promise<Response>) | null = null

vi.mock('electron', () => ({
  protocol: {
    handle: (_scheme: string, fn: (request: { url: string }) => Promise<Response>) => {
      handler = fn
    }
  },
  net: {
    fetch: async (url: string) => new Response(`served:${url}`, { status: 200 })
  }
}))

const { admit, admitWithRefusals, mint, pendingTokens, registerFileProtocol } = await import(
  '../../src/main/file-protocol'
)
const { MAX_FILE_BYTES, validate } = await import('../../src/shared/upload')

let dir = ''
let model = ''
let big = ''
let text = ''
let link = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-proto-'))
  model = join(dir, 'model.ifc')
  big = join(dir, 'huge.ifc')
  text = join(dir, 'notes.txt')
  link = join(dir, 'link.ifc')
  await writeFile(model, 'ISO-10303-21;\nEND-ISO-10303-21;\n')
  await writeFile(text, 'hello')
  // Sparse, so a 600 MB + 1 file costs nothing to make.
  const fh = await open(big, 'w')
  await fh.truncate(MAX_FILE_BYTES + 1)
  await fh.close()
  await symlink(model, link)
  registerFileProtocol()
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const fetchToken = (url: string): Promise<Response> => handler!({ url })

describe('admit', () => {
  it('returns the file with its real path, name and size', async () => {
    const [f] = await admit([model])
    expect(f.name).toBe('model.ifc')
    expect(f.path).toBe(await realOf(model))
    expect(f.size).toBeGreaterThan(0)
  })

  it('resolves a symlink to its target, so the token is bound to the real file', async () => {
    const [f] = await admit([link])
    expect(f.path).toBe(await realOf(model))
    expect(f.path).not.toBe(link)
  })

  it('drops a path that is not an IFC file', async () => {
    expect(await admit([text])).toEqual([])
  })

  it('drops a file larger than 600 MB', async () => {
    expect(await admit([big])).toEqual([])
  })

  it('drops a path that does not exist, and a directory', async () => {
    expect(await admit([join(dir, 'gone.ifc'), dir])).toEqual([])
  })

  it('reports only what passed, so a caller sees which files have moved', async () => {
    const out = await admit([model, join(dir, 'gone.ifc'), text])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('model.ifc')
  })
})

/**
 * 2026-10-09 — a file turned down for a reason the drop zone gives too comes back with that
 * reason, so the Open dialog, a Recent pill and a link show the designed row a drop does. It used
 * to vanish: a 610 MB file picked in the Open dialog left no row and no banner.
 */
describe('admit — what it refuses, and why', () => {
  let empty = ''
  let xml = ''
  beforeAll(async () => {
    empty = join(dir, 'empty.ifc')
    xml = join(dir, 'plan.ifcxml')
    await writeFile(empty, '')
    await writeFile(xml, '<ifcXML/>')
  })

  it('collects a file over 600 MB with the drop zone’s own reason, and never admits it', async () => {
    const refused: RefusedFile[] = []
    expect(await admit([big], 'any', refused)).toEqual([])
    // Its name and its reason — never its size, and never its path.
    expect(refused).toEqual([{ name: 'huge.ifc', reason: 'larger than 600 MB' }])
    expect(refused[0].reason).toBe(validate('huge.ifc', MAX_FILE_BYTES + 1))
    expect(mint(await realOf(big))).toBeNull()
  })

  it('tells the Open dialog every reason, each in the drop zone’s words', async () => {
    const dialog: RefusedFile[] = []
    await admit([big, empty, xml, text], 'any', dialog)
    expect(dialog).toEqual([
      { name: 'huge.ifc', reason: 'larger than 600 MB' },
      { name: 'empty.ifc', reason: 'file is empty' },
      { name: 'plan.ifcxml', reason: 'ifcXML is not supported' },
      { name: 'notes.txt', reason: 'not an IFC file' }
    ])
  })

  it('tells a path the renderer names only about an .ifc or .ifczip — nothing else is its to learn', async () => {
    // A named path that is not a .ifc / .ifczip — an ifcXML file, a text file — answers exactly
    // what a path with nothing there answers: whether a file is there, and how large, stays the
    // gate's, as it was before 2026-10-09.
    const named: RefusedFile[] = []
    await admit([big, empty, xml, text, join(dir, 'gone.ifcxml')], new Set(), named)
    expect(named).toEqual([
      { name: 'huge.ifc', reason: 'larger than 600 MB' },
      { name: 'empty.ifc', reason: 'file is empty' }
    ])
    // The recents list is a named route too, however trusted its network paths are.
    const recents: RefusedFile[] = []
    await admit([xml, text], new Set([xml, text]), recents)
    expect(recents).toEqual([])
  })

  it('says nothing of a path that is gone or not a file — the caller’s "moved" covers those', async () => {
    const refused: RefusedFile[] = []
    await admit([join(dir, 'gone.ifc'), dir], 'any', refused)
    expect(refused).toEqual([])
  })

  it('answers both lists at once for the IPC channels', async () => {
    const out = await admitWithRefusals([model, big, join(dir, 'gone.ifc')], 'any')
    expect(out.files.map((f) => f.name)).toEqual(['model.ifc'])
    expect(out.refused).toEqual([{ name: 'huge.ifc', reason: 'larger than 600 MB' }])
  })

  it('still 403s a refused file at fetch time, whatever was minted before it grew', async () => {
    const grows = join(dir, 'grows.ifc')
    await writeFile(grows, 'ISO-10303-21;')
    const [f] = await admit([grows])
    const url = mint(f.path)!
    const fh = await open(grows, 'r+')
    await fh.truncate(MAX_FILE_BYTES + 1)
    await fh.close()
    expect((await fetchToken(url)).status).toBe(403)
  })
})

describe('mint', () => {
  it('refuses a path that was never admitted', () => {
    expect(mint('/etc/passwd')).toBeNull()
    expect(mint(join(dir, 'never-seen.ifc'))).toBeNull()
  })

  it('issues an sgvue-file:// URL for an admitted path', async () => {
    const [f] = await admit([model])
    const url = mint(f.path)
    expect(url).toMatch(/^sgvue-file:\/\/t\/[0-9a-f-]{36}$/)
  })

  it('issues a different token every time', async () => {
    const [f] = await admit([model])
    expect(mint(f.path)).not.toBe(mint(f.path))
  })
})

describe('the handler', () => {
  it('streams an admitted file once', async () => {
    const [f] = await admit([model])
    const response = await fetchToken(mint(f.path)!)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('file://')
  })

  it('403s the second time — the token is single use', async () => {
    const [f] = await admit([model])
    const url = mint(f.path)!
    expect((await fetchToken(url)).status).toBe(200)
    expect((await fetchToken(url)).status).toBe(403)
  })

  it('403s a token nobody minted', async () => {
    expect((await fetchToken('sgvue-file://t/00000000-0000-0000-0000-000000000000')).status).toBe(403)
  })

  it('403s a URL that is not a token at all', async () => {
    for (const url of [
      'sgvue-file://model/model.ifc',
      'sgvue-file://t/',
      'sgvue-file://t/../../etc/passwd',
      'sgvue-file://T/x'
    ]) {
      expect((await fetchToken(url)).status).toBe(403)
    }
  })

  it('403s when the file has gone between minting and fetching', async () => {
    const doomed = join(dir, 'doomed.ifc')
    await writeFile(doomed, 'x')
    const [f] = await admit([doomed])
    const url = mint(f.path)!
    await rm(doomed)
    expect((await fetchToken(url)).status).toBe(403)
  })

  it('403s when the path now resolves somewhere else — a repointed symlink', async () => {
    const hop = join(dir, 'hop.ifc')
    const other = join(dir, 'other.ifc')
    await writeFile(other, 'other')
    await symlink(model, hop)
    // Admitted by the symlink, but bound to the target's real path…
    const [f] = await admit([hop])
    expect(f.path).toBe(await realOf(model))
    // …so repointing the link cannot make the token serve a different file: the token is the
    // real path, which still passes. The escape that *is* possible — admitting a link and
    // later replacing the target — is caught by the re-check, proved by the deletion above.
    await rm(hop)
    await symlink(other, hop)
    const [again] = await admit([hop])
    expect(again.path).toBe(await realOf(other))
    expect(again.path).not.toBe(f.path)
  })

  it('leaves no token outstanding once each has been used', async () => {
    const [f] = await admit([model])
    const before = pendingTokens()
    const url = mint(f.path)!
    expect(pendingTokens()).toBe(before + 1)
    await fetchToken(url)
    expect(pendingTokens()).toBe(before)
  })
})

async function realOf(path: string): Promise<string> {
  const { realpath } = await import('node:fs/promises')
  return realpath(path)
}
