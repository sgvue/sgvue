/**
 * The launch-time update check — 2026-10-01, asked for by the owner: *"Can you show updates
 * with link if there are one automatically on the upload page?"*, and of the ways offered,
 * **"Check at every start"**: one small request to GitHub when the app opens; if a newer
 * version exists the landing page says so, with a link; offline or blocked, it stays silent.
 *
 * This is the one network call the app makes by itself (the assistant's are the user's own,
 * and need a key). It learns a version number and nothing else: there is still no auto-updater
 * and no download (`publish: null`), and the link opens the product site in the browser.
 *
 * What the request carries: a `GET` to one hard-coded https URL with an `Accept` header. No
 * query string, no body, no cookie, no other header of ours — nothing about the user, the
 * machine's files or the models. What any web request shows its server it shows too: the
 * machine's IP address and Chromium's own standard headers.
 *
 * A development build makes **no request at all** — the same `app.isPackaged` gate as
 * `SGVUE_OPEN_PATHS` in `index.ts`: there `SGVUE_UPDATE_LATEST`, when set, stands in for
 * GitHub's `tag_name` and goes through the same validation and comparison, so the unit tests
 * and the e2e suite never reach the network. A packaged build ignores the variable.
 */
import { app, net } from 'electron'
import type { UpdateInfo } from '../shared/ipc-contract'
import { isNewer, parseVersion } from '../shared/version'

/** GitHub's "latest release" of the public releases repository. Never built from anything. */
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/sgvue/releases/releases/latest'

/** The request is given up after this long: a slow network must not be waited on. */
export const UPDATE_TIMEOUT_MS = 5000

/** The largest answer read. GitHub's is about 5 kB; anything near this is not that answer. */
export const UPDATE_BODY_MAX_BYTES = 256 * 1024

/** `net.fetch`, or a stand-in: the unit tests pass their own and never touch the network. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

/** A release tag → the version it names, without the leading `v`; `null` unless it is one. */
const versionOf = (tag: unknown): string | null =>
  typeof tag === 'string' && parseVersion(tag) ? tag.replace(/^v/, '') : null

/** The body as text, read in pieces and abandoned the moment it passes the cap. */
async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('no body')
  const pieces: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > UPDATE_BODY_MAX_BYTES) {
      void reader.cancel().catch(() => undefined)
      throw new Error(`answer over ${UPDATE_BODY_MAX_BYTES} bytes`)
    }
    pieces.push(value)
  }
  return Buffer.concat(pieces).toString('utf8')
}

/**
 * The newest released version, or `null` — for every failure there is: offline, a proxy, any
 * status but 200 (a rate limit is 403), a timeout, an oversized or malformed answer, a tag that
 * is not a version. It never throws, and says at most one line.
 */
export async function latestVersion(
  fetchFn: FetchFn = (url, init) => net.fetch(url, init)
): Promise<string | null> {
  try {
    const response = await fetchFn(LATEST_RELEASE_URL, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS)
    })
    if (response.status !== 200) throw new Error(`status ${response.status}`)
    const release = JSON.parse(await boundedText(response)) as { tag_name?: unknown } | null
    const version = versionOf(release?.tag_name)
    if (!version) throw new Error('no usable tag_name')
    return version
  } catch (err) {
    // One line whatever the reason says: a parse error quotes the answer it could not read.
    const why = (err instanceof Error ? err.message : String(err))
      .replace(/[\s\u0000-\u001f\u007f]+/g, ' ')
      .slice(0, 200)
    console.warn(`[update] not checked — ${why}`)
    return null
  }
}

/** One answer per app run: the window may ask again after a reload, and no second request goes. */
let answer: Promise<UpdateInfo | null> | null = null

/**
 * `{ latest }` when a version newer than `current` is out, else `null`. `current` is the
 * build-time `__APP_VERSION__` — the one About and the landing page show — never
 * `app.getVersion()`, which reads Electron's own in a development launch.
 */
export function checkForUpdate(current: string): Promise<UpdateInfo | null> {
  answer ??= (async () => {
    const latest = app.isPackaged ? await latestVersion() : versionOf(process.env.SGVUE_UPDATE_LATEST)
    return latest && isNewer(latest, current) ? { latest } : null
  })()
  return answer
}
