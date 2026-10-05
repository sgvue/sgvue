/**
 * `src/main/updates.ts` — the launch-time update check (2026-10-01, owner-chosen: "Check at
 * every start"). One request to one hard-coded https URL, carrying nothing about the user; any
 * failure is `null` and at most one line; one request per app run; and none at all in a
 * development build, where `SGVUE_UPDATE_LATEST` stands in for GitHub's answer.
 *
 * Nothing here touches the network: `latestVersion` is handed its fetch, and `checkForUpdate`
 * runs against a mocked `electron` whose `net.fetch` is a recorder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  packaged: true,
  fetch: (() => {
    throw new Error('not set')
  }) as (url: string, init: RequestInit) => Promise<Response>
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electron.packaged
    }
  },
  net: { fetch: (url: string, init: RequestInit) => electron.fetch(url, init) }
}))

type Updates = typeof import('../../src/main/updates')
/** A fresh copy of the module, so each test starts with nothing memoised. */
const load = async (): Promise<Updates> => {
  vi.resetModules()
  return import('../../src/main/updates')
}

/** GitHub's answer, cut down to the field that is read (the real one is about 5 kB). */
const release = (tag: unknown): string => JSON.stringify({ url: 'x', tag_name: tag, name: 'SGVue', assets: [] })
const ok = (body: string, status = 200): Response => new Response(body, { status })

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  electron.packaged = true
  electron.fetch = () => {
    throw new Error('not set')
  }
  delete process.env.SGVUE_UPDATE_LATEST
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warn.mockRestore()
  delete process.env.SGVUE_UPDATE_LATEST
})

describe('LATEST_RELEASE_URL', () => {
  it('is one https constant on api.github.com, with no query or hash of its own', async () => {
    const { LATEST_RELEASE_URL } = await load()
    const url = new URL(LATEST_RELEASE_URL)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('api.github.com')
    expect(url.pathname).toBe('/repos/sgvue/releases/releases/latest')
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    expect(url.username + url.password + url.port).toBe('')
    expect(LATEST_RELEASE_URL).toBe(url.href)
  })
})

describe('latestVersion', () => {
  it('reads tag_name from a 200 and drops the leading v', async () => {
    const { latestVersion } = await load()
    expect(await latestVersion(async () => ok(release('v1.2.0')))).toBe('1.2.0')
    expect(await latestVersion(async () => ok(release('1.2.0')))).toBe('1.2.0')
    expect(await latestVersion(async () => ok(release('v1.2.0-beta.1')))).toBe('1.2.0-beta.1')
    expect(warn).not.toHaveBeenCalled()
  })

  it('sends one GET to the constant, with Accept and nothing about the user', async () => {
    const { latestVersion, LATEST_RELEASE_URL, UPDATE_TIMEOUT_MS } = await load()
    const calls: [string, RequestInit][] = []
    await latestVersion(async (url, init) => {
      calls.push([url, init])
      return ok(release('v1.2.0'))
    })
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0]
    expect(url).toBe(LATEST_RELEASE_URL)
    expect(init.method).toBe('GET')
    // The one header of ours, and no body, cookie or redirect to follow.
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json' })
    expect(init.body).toBeUndefined()
    expect(init.credentials).toBe('omit')
    expect(init.cache).toBe('no-store')
    expect(init.redirect).toBe('error')
    expect(Object.keys(init).sort()).toEqual(['cache', 'credentials', 'headers', 'method', 'redirect', 'signal'])
    // A live timeout signal, not yet fired.
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal!.aborted).toBe(false)
    expect(UPDATE_TIMEOUT_MS).toBe(5000)
  })

  it.each([
    ['a 404', () => ok('{"message":"Not Found"}', 404)],
    ['a rate limit (403)', () => ok('{"message":"API rate limit exceeded"}', 403)],
    ['a 204 with nothing in it', () => new Response(null, { status: 204 })],
    ['a 201, which is not 200', () => ok(release('v9.0.0'), 201)],
    ['a 500', () => ok('oops', 500)],
    ['a body that is not JSON', () => ok('<html>captive portal</html>')],
    ['an empty body', () => ok('')],
    ['JSON null', () => ok('null')],
    ['a JSON array', () => ok('[]')],
    ['no tag_name', () => ok(JSON.stringify({ name: 'SGVue' }))],
    ['a numeric tag_name', () => ok(release(120))],
    ['a null tag_name', () => ok(release(null))],
    ['an object tag_name', () => ok(release({ v: '1.2.0' }))],
    ['a tag that is not a version', () => ok(release('latest'))],
    ['a tag with a suffix', () => ok(release('v1.2.0-stable build'))],
    ['a two-part tag', () => ok(release('v1.2'))],
    ['an over-long tag', () => ok(release('v1.2.0-' + 'a'.repeat(80)))]
  ])('is null, without throwing, for %s', async (_name, respond) => {
    const { latestVersion } = await load()
    await expect(latestVersion(async () => respond())).resolves.toBeNull()
    // At most one line.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
    for (const call of warn.mock.calls) expect(String(call[0])).not.toMatch(/\n/)
  })

  it('says one short line even when the reason carries line breaks or control characters', async () => {
    const { latestVersion } = await load()
    // A parse error quotes the body it choked on; a thrown reason can be anything.
    await latestVersion(async () => ok('\n\n<html>\n<head>\r\n\u001b[31m</head>'))
    await latestVersion(async () => {
      throw new Error(`line one\nline two\r\n\u001b[2Jcleared ${'x'.repeat(1000)}`)
    })
    expect(warn).toHaveBeenCalledTimes(2)
    for (const [line] of warn.mock.calls) {
      expect(String(line)).toMatch(/^\[update\] not checked — /)
      expect(String(line)).not.toMatch(/[\n\r\u0000-\u001f\u007f]/)
      expect(String(line).length).toBeLessThanOrEqual(225)
    }
  })

  it('is null when the request itself fails: offline, a refused redirect, a timeout', async () => {
    const { latestVersion } = await load()
    await expect(
      latestVersion(async () => {
        throw new TypeError('net::ERR_INTERNET_DISCONNECTED')
      })
    ).resolves.toBeNull()
    await expect(latestVersion(() => Promise.reject(new DOMException('timed out', 'TimeoutError')))).resolves.toBeNull()
    // A fetch that throws before it returns a promise at all.
    await expect(
      latestVersion(() => {
        throw new Error('sync')
      })
    ).resolves.toBeNull()
    // A value that is not an Error.
    await expect(latestVersion(() => Promise.reject('nope'))).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(4)
  })

  it('refuses an answer over 256 kB, and stops reading it', async () => {
    const { latestVersion, UPDATE_BODY_MAX_BYTES } = await load()
    expect(UPDATE_BODY_MAX_BYTES).toBe(256 * 1024)
    // A valid release padded past the cap: read whole it would have parsed.
    const padded = JSON.stringify({ tag_name: 'v9.0.0', body: 'x'.repeat(UPDATE_BODY_MAX_BYTES) })
    await expect(latestVersion(async () => ok(padded))).resolves.toBeNull()

    // An endless body: abandoned once it passes the cap, never read to its end.
    let pulled = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        cancelled = true
      }
    })
    await expect(latestVersion(async () => new Response(endless, { status: 200 }))).resolves.toBeNull()
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThan(16)

    // Just under the cap is still read.
    const room = UPDATE_BODY_MAX_BYTES - JSON.stringify({ tag_name: 'v9.0.0', body: '' }).length
    const fits = JSON.stringify({ tag_name: 'v9.0.0', body: 'x'.repeat(room) })
    expect(Buffer.byteLength(fits)).toBe(UPDATE_BODY_MAX_BYTES)
    await expect(latestVersion(async () => ok(fits))).resolves.toBe('9.0.0')
  })

  it('is null when the response has no body to read', async () => {
    const { latestVersion } = await load()
    await expect(
      latestVersion(async () => ({ status: 200, body: null }) as unknown as Response)
    ).resolves.toBeNull()
  })
})

describe('checkForUpdate — a packaged build', () => {
  it('answers { latest } when GitHub’s version is newer than this build', async () => {
    const { checkForUpdate, LATEST_RELEASE_URL } = await load()
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ok(release('v1.2.0')))
    electron.fetch = fetch
    expect(await checkForUpdate('1.1.0')).toEqual({ latest: '1.2.0' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe(LATEST_RELEASE_URL)
  })

  it.each([
    ['the same version', 'v1.1.0', '1.1.0'],
    ['an older one', 'v1.0.3', '1.1.0'],
    ['a pre-release of this version', 'v1.1.0-beta.4', '1.1.0'],
    ['this build being unreadable', 'v1.2.0', 'dev']
  ])('answers null for %s', async (_name, tag, current) => {
    const { checkForUpdate } = await load()
    electron.fetch = async () => ok(release(tag))
    expect(await checkForUpdate(current)).toBeNull()
  })

  it('answers null, quietly, when the request fails', async () => {
    const { checkForUpdate } = await load()
    electron.fetch = async () => {
      throw new TypeError('net::ERR_NAME_NOT_RESOLVED')
    }
    await expect(checkForUpdate('1.1.0')).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('asks once per app run: a second and a concurrent call share the first answer', async () => {
    const { checkForUpdate } = await load()
    const fetch = vi.fn(async () => ok(release('v1.2.0')))
    electron.fetch = fetch
    const [a, b] = await Promise.all([checkForUpdate('1.1.0'), checkForUpdate('1.1.0')])
    const c = await checkForUpdate('1.1.0')
    expect([a, b, c]).toEqual([{ latest: '1.2.0' }, { latest: '1.2.0' }, { latest: '1.2.0' }])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not ask again after a failure either', async () => {
    const { checkForUpdate } = await load()
    const fetch = vi.fn(async () => ok('nope', 503))
    electron.fetch = fetch
    expect(await checkForUpdate('1.1.0')).toBeNull()
    expect(await checkForUpdate('1.1.0')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('ignores SGVUE_UPDATE_LATEST', async () => {
    const { checkForUpdate } = await load()
    process.env.SGVUE_UPDATE_LATEST = '99.0.0'
    const fetch = vi.fn(async () => ok(release('v1.1.0')))
    electron.fetch = fetch
    expect(await checkForUpdate('1.1.0')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('checkForUpdate — a development build', () => {
  const never = vi.fn(async (): Promise<Response> => ok(release('v99.0.0')))

  beforeEach(() => {
    electron.packaged = false
    never.mockClear()
    electron.fetch = never
  })

  it('makes no request at all, and answers null with nothing set', async () => {
    const { checkForUpdate } = await load()
    expect(await checkForUpdate('1.1.0')).toBeNull()
    expect(never).not.toHaveBeenCalled()
  })

  it('takes SGVUE_UPDATE_LATEST in place of GitHub’s tag, through the same checks', async () => {
    process.env.SGVUE_UPDATE_LATEST = '99.0.0'
    expect(await (await load()).checkForUpdate('1.1.0')).toEqual({ latest: '99.0.0' })
    process.env.SGVUE_UPDATE_LATEST = 'v99.0.0'
    expect(await (await load()).checkForUpdate('1.1.0')).toEqual({ latest: '99.0.0' })
    // Not newer, and not a version: null, exactly as a tag from GitHub would be.
    process.env.SGVUE_UPDATE_LATEST = '1.1.0'
    expect(await (await load()).checkForUpdate('1.1.0')).toBeNull()
    process.env.SGVUE_UPDATE_LATEST = '1.0.0'
    expect(await (await load()).checkForUpdate('1.1.0')).toBeNull()
    process.env.SGVUE_UPDATE_LATEST = 'https://example.com/'
    expect(await (await load()).checkForUpdate('1.1.0')).toBeNull()
    process.env.SGVUE_UPDATE_LATEST = ''
    expect(await (await load()).checkForUpdate('1.1.0')).toBeNull()
    expect(never).not.toHaveBeenCalled()
  })
})
