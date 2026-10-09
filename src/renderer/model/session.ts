/**
 * The renderer's half of sessions and share links — `SGVue.dc.html:1676–1721`.
 *
 * The arithmetic is `shared/session-codec.ts` and is unit-tested there; this file is the wiring
 * to the store, the viewer and the main process. The differences from the prototype, all of
 * them the desktop's:
 *
 * · the payload is written through `main/sessions.ts` (one of the two permitted writers)
 *   instead of `localStorage`, with the design's own 600 ms debounce;
 * · a session names **files**, so opening a link re-admits their paths and refuses by name
 *   anything that has moved or changed (`checkFiles`);
 * · 2026-09-24 — nothing reads the stored session back: the landing page's "Resume last
 *   session" card is not in the port. The autosave still writes it, and the share-link tests
 *   build their link from it;
 * · "copy link to this state" copies `sgvue://s=…` rather than writing a location hash — the
 *   control, its copy and its 1 600 ms flash are the design's;
 * · 2026-10-01 — the payload carries both section planes (`sections`) and, for a build from
 *   before then, the design's single `section`; a payload that has only the old key restores
 *   onto the plane of its kind (`shared/session-codec.ts`, `sectionsOf`);
 * · 2026-10-02 — the restore itself is the store's `applySession` and the fields a payload is
 *   cut from are `sessionSource` (`state/selectors/snapshot.ts`): the chat's per-turn revert
 *   snapshots the same payload and puts it back through the same path, so there is one of each.
 */
import {
  canonicalFiles,
  checkFiles,
  decodeState,
  linkFor,
  payloadFromLink,
  sessionPayload,
  type SessionPayload
} from '../../shared/session-codec'
import { frameKey } from '../../shared/georef'
import type { RefusedFile } from '../../shared/ipc-contract'
import { getViewer, useShell } from '../state/shell'
import { sessionSource } from '../state/selectors/snapshot'
import { federation as fed } from './federation-store'
import { api } from '../api'
import { copyText } from '../clipboard'

/** `SGVue.dc.html:1687`. */
export const SAVE_DEBOUNCE_MS = 600
/** `SGVue.dc.html:1718`. */
export const LINK_FLASH_MS = 1600

/**
 * `SGVue.dc.html:1677`. The whole review state, ready to be written or encoded. The store's
 * half of it is `sessionSource` — the same fields the chat's per-turn revert snapshots.
 */
export function currentPayload(): SessionPayload {
  const s = useShell.getState()
  return sessionPayload(
    sessionSource(s),
    s.loaded,
    fed.sessionFiles(),
    getViewer()?.getCamera() ?? null,
    frameKey(s.frame)
  )
}

/* ────────────────────────────── autosave ────────────────────────────── */

let saveTimer: ReturnType<typeof setTimeout> | undefined
/**
 * The payload last handed to main, serialised. The store changes for reasons the session does
 * not record — the status bar's frame rate, the hint, a hover — and every one of them used to
 * rewrite `last.json` with the same payload and a new `savedAt`, about once a second at rest.
 * A payload identical to the last one sent is not sent again (refactor pass 2).
 */
let lastSent = ''

/** `SGVue.dc.html:1685`. Nothing is written before a model is open. */
export function saveSession(): void {
  if (!useShell.getState().booted) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const payload = currentPayload()
    const text = JSON.stringify(payload)
    if (text === lastSent) return
    lastSent = text
    void api()
      ?.saveSession({ payload: payload as unknown as Record<string, unknown>, savedAt: Date.now() })
      .catch(() => {
        // A session that cannot be written is not a reason to stop reviewing; the next change
        // tries again, even if it puts the payload back to this one.
        lastSent = ''
      })
  }, SAVE_DEBOUNCE_MS)
}

/**
 * `SGVue.dc.html:876` — `componentDidUpdate` calls `saveSession()` on every state change.
 * A store subscription is the same thing; the debounce is what makes it one write.
 */
export function startAutosave(): () => void {
  const off = useShell.subscribe(() => saveSession())
  return () => {
    off()
    clearTimeout(saveTimer)
  }
}

/* ────────────────────────────── reading it back ────────────────────────────── */

/** The payload inside a `sgvue://s=…` URL, or `null`. Tolerant — a person pasted this. */
export const payloadFromUrl = (url: string): SessionPayload | null => payloadFromLink(url)

/** For the dev hook and the smoke test: a bare base64url payload. */
export const payloadFromCode = (code: string): SessionPayload | null => decodeState(code)

/**
 * Which of a payload's files are openable right now. Main re-checks each path (`realpath`,
 * extension, regular file, size) and admits only what passes, so a path that is missing simply
 * does not come back — which is what `checkFiles` turns into the banner's copy.
 *
 * Admission is one call per file, because what comes back is the path's **own `realpath`** and
 * the answer has to be attributable to the request: a junction, an 8.3 short name or a mapped
 * drive comes back spelled differently, and the payload is rewritten to the admitted spelling
 * so the open, the hash check and the saved session all name the same file. Sessions hold a
 * handful of files.
 *
 * The SHA-256 is **not** re-hashed here: that would mean reading every byte of a 138 MB file
 * before the progress rows appear. It is checked where it is free — the parse hashes the file
 * it reads anyway — and `verifyHashes` below compares afterwards.
 *
 * 2026-10-09 — a file main **refused** for a reason the drop zone gives (it is over 600 MB now,
 * say) is there, so it is not called moved: it comes back in `refused`, for the designed error
 * row with that reason (`upload-pipeline.ts`, `showRefused`), and the session does not open —
 * as it does not with a file missing. `message` then names only the files that really moved.
 */
export async function probeFiles(payload: SessionPayload): Promise<{
  ok: boolean
  message: string
  paths: string[]
  payload: SessionPayload
  refused: RefusedFile[]
}> {
  const files = payload.files ?? []
  if (!files.length) {
    return {
      ok: false,
      message: 'That session had no models in it. Pick a file to start again.',
      paths: [],
      payload,
      refused: []
    }
  }
  const admitted: (string | null)[] = []
  const refused: RefusedFile[] = []
  const refusedAt = new Set<number>()
  for (const [i, f] of files.entries()) {
    // A call that rejects — the contract refuses an empty path, and main may refuse for its
    // own reasons — means main did not admit that file, so the person gets the designed
    // banner naming it rather than the whole probe going down with an unhandled rejection.
    let real: string | null = null
    try {
      const answer = await api()?.admitPaths([f.path])
      real = answer?.files?.[0]?.path ?? null
      const why = answer?.refused?.[0]
      if (!real && why) {
        refused.push(why)
        refusedAt.add(i)
      }
    } catch {
      /* not admitted */
    }
    admitted.push(real)
  }
  const kept = <T>(list: readonly T[]): T[] => list.filter((_, i) => !refusedAt.has(i))
  const canon = canonicalFiles(kept(files), kept(admitted))
  const verdict = checkFiles(canon.files, canon.probes)
  if (refused.length) {
    return { ok: false, message: verdict.ok ? '' : verdict.message, paths: [], payload, refused }
  }
  return verdict.ok
    ? {
        ok: true,
        message: '',
        paths: canon.files.map((f) => f.path),
        payload: { ...payload, files: canon.files },
        refused
      }
    : { ok: false, message: verdict.message, paths: [], payload, refused }
}

/**
 * After the files have been parsed, the hashes are in hand for free. A file whose bytes have
 * changed since the session was saved is named rather than silently accepted — the point of
 * recording the digest at all.
 */
export function verifyHashes(payload: SessionPayload): string | null {
  const live = new Map(fed.sessionFiles().map((f) => [f.path, f.sha256]))
  const verdict = checkFiles(
    payload.files ?? [],
    (payload.files ?? []).map((f) => ({ path: f.path, exists: true, sha256: live.get(f.path) ?? null }))
  )
  return verdict.ok ? null : verdict.message
}

/* ────────────────────────────── restoring ────────────────────────────── */

/**
 * `SGVue.dc.html:1690`. The state patch first, then the renderer calls in `RESTORE_ORDER` —
 * since 2026-10-02 the store's own `applySession` (`state/shell.ts`), which is also the path the
 * chat's per-turn revert puts a reply's changes back through. A session is only ever applied to
 * a live viewer, so that is still asked here.
 */
export function applySession(p: Partial<SessionPayload>): void {
  if (!p || !getViewer()) return
  useShell.getState().applySession(p)
}

/* ────────────────────────────── the link ────────────────────────────── */

let flashTimer: ReturnType<typeof setTimeout> | undefined

/**
 * `SGVue.dc.html:1716`. The designed control, its copy and its 1 600 ms flash; the link is
 * `sgvue://s=…` because a desktop app has no address bar to put a hash in.
 *
 * 2026-10-02 — **the flash is truthful.** The design flashes `link copied` whether or not the
 * write went through (`.then(done, done)`), and in this app it never did: the clipboard API is
 * refused (`../clipboard.ts` has the measurement), so the control flashed over a clipboard that
 * had not changed. It now copies through `copyText` — which does write, from a click — and
 * flashes only when that says the link is on the clipboard. Resolves to the same answer, for
 * the one other caller: the assistant's `copy_link`, applied by the user (`state/shell.ts`).
 */
export async function copyLink(): Promise<boolean> {
  const ok = await copyText(linkFor(currentPayload()))
  if (!ok) return false
  useShell.getState().setLinkCopied(true)
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => useShell.getState().setLinkCopied(false), LINK_FLASH_MS)
  return true
}
