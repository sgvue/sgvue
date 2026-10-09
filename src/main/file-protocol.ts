/**
 * `sgvue-file://` — the one way model bytes reach the renderer (plan §2 "File access", §3.1).
 *
 * The rule the whole design hangs on: **main streams and never holds model bytes.** A 600 MB
 * file must not cross IPC as an array, so the renderer is handed a URL instead and fetches it;
 * Chromium streams the response into a `Blob` and the parse worker reads that Blob in slices
 * through `OpenModelFromCallback`.
 *
 * A URL is a capability, so it is minted rather than constructed:
 *
 * 1. A path becomes **admitted** only by arriving from somewhere the user chose it — the
 *    native Open dialog, a native drop, the recents list, the stored session, or a share link.
 *    `admit()` is the only entrance and it applies the same checks the handler does.
 * 2. `mint()` issues a **single-use** token for an admitted path. It is spent on the first
 *    request and 403s for ever after.
 * 3. The handler re-checks everything at fetch time — `realpath`, extension, regular file,
 *    size — because a symlink can be repointed between admission and fetch. Anything that
 *    does not pass is a 403 with no body: a probe learns nothing from it.
 *
 * This module never writes: `stat` and `realpath` are reads, and the bytes leave through
 * `net.fetch`, which streams straight out of the OS.
 */
import { net, protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_FILE_BYTES, validate } from '../shared/upload'
import type { AdmitResult, PickedFile, RefusedFile } from '../shared/ipc-contract'

export const SCHEME = 'sgvue-file'

/** Only these reach the parser. `.ifcxml` is refused earlier, with its own copy. */
const ALLOWED_EXT = new Set(['.ifc', '.ifczip'])

/**
 * How long a minted token stays mintable-for. A token is single use, so this only bounds how
 * long an unspent one is worth stealing; the worker fetches within a tick of being handed it.
 */
const TOKEN_TTL_MS = 5 * 60 * 1000

/** Real paths the user has chosen this session. Cleared only when the app exits. */
const admitted = new Set<string>()

/** token → the real path it was minted for, and when. Entries are deleted on first use. */
const tokens = new Map<string, { path: string; at: number }>()

/**
 * A path that names another machine or a device rather than a local file — `\\host\share`,
 * `//host/share`, `\\?\…`, `\\.\…`: any path whose first two characters are separators, since
 * Windows treats `/` and `\` alike there. `realpath` or `stat` on one makes Windows open an SMB
 * session to that host and offer it the user's NTLM credentials before a single check has run,
 * so a share link naming `\\attacker\x.ifc` must be refused before the file system is touched.
 */
export const isRemotePath = (path: string): boolean => /^[\\/]{2}/.test(path)

/**
 * What every gate agrees on: a regular IFC file of a sane size, by its **real** path.
 * `remote` lets a network path through; `admit` says who may ask for that.
 *
 * 2026-10-09 — a regular file turned down for a reason the drop zone also gives
 * (`shared/upload.ts`, `validate`: not an IFC file, empty, larger than 600 MB, ifcXML) comes
 * back as `refused`, with its name and that reason, so the caller can show the designed row a
 * drop of the same file gets. Anything else — gone, not a file, a network path nobody reached —
 * is `null`, as before.
 *
 * **`picked`** — the user chose this path in the Open dialog. Only then is a path whose real
 * extension is not `.ifc` / `.ifczip` looked at any further: for a path the renderer names, it is
 * `null` before `stat`, as it always was, so whether any other file is there — or how large — is
 * never the renderer's to learn. Such a path cannot come from a legitimate named route anyway:
 * recents, sessions and links hold admitted paths, and a drop judges its own `File`.
 */
async function inspect(
  path: string,
  remote = false,
  picked = false
): Promise<{ real: string; size: number } | { refused: RefusedFile } | null> {
  if (!remote && isRemotePath(path)) return null
  try {
    const real = await realpath(path)
    const ifc = ALLOWED_EXT.has(extname(real).toLowerCase())
    if (!ifc && !picked) return null
    const info = await stat(real)
    if (!info.isFile()) return null
    if (ifc && info.size > 0 && info.size <= MAX_FILE_BYTES) return { real, size: info.size }
    const name = basename(real)
    const reason = validate(name, info.size)
    return reason ? { refused: { name, reason } } : null
  } catch {
    return null
  }
}

/**
 * Admit paths the user chose. Returns one entry per path that passed, dropping the rest — the
 * caller reports "that file has moved" from the difference, which is what the landing page's
 * error banner says.
 *
 * A network path (`isRemotePath`) passes only where the user has reached that host already:
 * `trusted` is `'any'` for the native Open dialog, or the paths main keeps for them (the
 * recents list), and a path admitted earlier this session passes too. A share link, a stored
 * session or a made-up path naming another machine is refused before `realpath` runs. A
 * Windows mapped drive resolves to its `\\server\share` form, which is why recents are trusted.
 *
 * 2026-10-09 — `refused`, when given, collects the files turned down for a reason the drop zone
 * gives too (`inspect`), so the Open dialog, a Recent pill and a link show the same designed
 * row a drop does; a refused file is never admitted. "Not an IFC file" — and anything else that
 * is not a `.ifc` / `.ifczip`, an ifcXML file included — is told only to the Open dialog
 * (`trusted === 'any'`), whose files the user picked: for a path the renderer names
 * (`file:admit`) it would say whether a file is there at all, which the gate has never answered.
 * A named `.ifc` / `.ifczip` that is empty or over 600 MB is told on every route, by name and
 * reason alone, never its size.
 */
export async function admit(
  paths: readonly string[],
  trusted: 'any' | ReadonlySet<string> = new Set(),
  refused?: RefusedFile[]
): Promise<PickedFile[]> {
  const out: PickedFile[] = []
  for (const path of paths) {
    const remote = trusted === 'any' || trusted.has(path) || admitted.has(path)
    const found = await inspect(path, remote, trusted === 'any')
    if (!found) continue
    if ('refused' in found) {
      refused?.push(found.refused)
      continue
    }
    admitted.add(found.real)
    out.push({ path: found.real, name: basename(found.real), size: found.size })
  }
  return out
}

/** `file:open` and `file:admit`'s answer: what was admitted, and what was refused with a reason. */
export async function admitWithRefusals(
  paths: readonly string[],
  trusted: 'any' | ReadonlySet<string> = new Set()
): Promise<AdmitResult> {
  const refused: RefusedFile[] = []
  const files = await admit(paths, trusted, refused)
  return { files, refused }
}

/**
 * Whether `path` is a real path admitted this session. `recents:add` asks it, so a network
 * path reaches the recents list — which `admit` trusts — only after the user admitted it.
 */
export const isAdmitted = (path: string): boolean => admitted.has(path)

/** A single-use URL for an admitted path, or `null` — never an error a probe can read. */
export function mint(path: string): string | null {
  if (!admitted.has(path)) return null
  // An unspent token past its life is worth nothing: drop it, so the map cannot only grow.
  const now = Date.now()
  for (const [key, entry] of tokens) if (now - entry.at > TOKEN_TTL_MS) tokens.delete(key)
  const token = randomUUID()
  tokens.set(token, { path, at: now })
  return `${SCHEME}://t/${token}`
}

/** For the smoke test and for `dispose`: how many unspent tokens are outstanding. */
export const pendingTokens = (): number => tokens.size

const deny = (): Response => new Response(null, { status: 403 })

/**
 * Register the handler. Called once, after `whenReady` — the scheme itself is registered as
 * privileged before that, in `index.ts`, with `corsEnabled` (Phase 1b's own finding: without
 * it Chromium refuses the fetch from a `file://` renderer before the handler is ever called).
 */
export function registerFileProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    let token: string
    try {
      const url = new URL(request.url)
      if (url.host !== 't') return deny()
      token = decodeURIComponent(url.pathname.replace(/^\//, ''))
    } catch {
      return deny()
    }
    const entry = tokens.get(token)
    // Single use: spent whether or not the rest of the checks pass.
    tokens.delete(token)
    if (!entry) return deny()
    if (Date.now() - entry.at > TOKEN_TTL_MS) return deny()

    // Re-check at fetch time. A symlink admitted an hour ago can point somewhere else now.
    // `entry.path` was admitted, so a network path here is one the user already reached.
    const found = await inspect(entry.path, true)
    if (!found || !('real' in found) || found.real !== entry.path) return deny()

    try {
      return await net.fetch(pathToFileURL(found.real).toString())
    } catch {
      return deny()
    }
  })
}
