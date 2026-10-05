/**
 * Sessions and recents — **one of the two modules allowed to write to disk** (plan §2
 * "Persistence", `CLAUDE.md` rules).
 *
 * Two files, both under `app.getPath('userData')/sessions/`:
 *
 * · `last.json`   — the design's `sessionPayload()` plus, per model, `{ key, path, name,
 *                   sha256 }`. Written by the renderer, debounced 600 ms exactly as
 *                   `SGVue.dc.html:1685` debounces its `localStorage` write. Nothing in the
 *                   app reads it back since 2026-09-24, when the landing page's "Resume last
 *                   session" card left the port; `loadSession` has had no IPC channel since
 *                   refactor pass 3 and is kept for the unit tests that read a write back.
 * · `recents.json` — the files the user has opened, newest first, capped at `RECENTS_MAX`.
 *                   This is what the sample library is backed by on the desktop (fidelity
 *                   contract, allowed deviations): same pills, same "open all N" copy,
 *                   rendered only when it is non-empty.
 *
 * Both are written atomically — a temporary file, then a single `rename` — so a crash mid-save
 * cannot leave the app with half a session, and both readers treat a corrupt file as "no
 * session" rather than as an error: losing a session is annoying, refusing to start is worse.
 * Every write goes through one queue, so two saves — or two `addRecent`s, each a read and then
 * a write — never interleave and never share a temporary file.
 *
 * Filter sets and viewpoints deliberately stay in `localStorage` (`renderer/state/persist.ts`):
 * they carry no paths, they are per-building rather than per-session, and they are the design's
 * own keys. See `CLAUDE.md` → Decisions.
 */
import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  RECENTS_MAX,
  RecentFile,
  SessionEnvelope,
  type RecentAdd
} from '../shared/ipc-contract'

/** A session is ~20 small keys plus a camera; anything above this is not one. */
const MAX_SESSION_BYTES = 4 * 1024 * 1024

const dir = (): string => join(app.getPath('userData'), 'sessions')
const lastPath = (): string => join(dir(), 'last.json')
const recentsPath = (): string => join(dir(), 'recents.json')

/** The tail of the write queue. It never rejects, so one failed write cannot stall the rest. */
let queue: Promise<unknown> = Promise.resolve()

/** Run `task` once every write queued before it has finished, however that went. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task)
  queue = next.catch(() => undefined)
  return next
}

let tmpSeq = 0

/** Write `text` to `path` atomically. The temp file sits beside it, on the same volume. */
async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dir(), { recursive: true })
  const tmp = `${path}.${process.pid}.${++tmpSeq}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/* ────────────────────────────── the session ────────────────────────────── */

export async function loadSession(): Promise<SessionEnvelope | null> {
  const parsed = SessionEnvelope.safeParse(await readJson(lastPath()))
  return parsed.success ? parsed.data : null
}

export async function saveSession(envelope: SessionEnvelope): Promise<void> {
  const text = JSON.stringify(envelope)
  // A renderer that has gone wrong must not be able to fill the disk through this channel.
  if (text.length > MAX_SESSION_BYTES) return
  await serial(() => writeAtomic(lastPath(), text))
}

/** Forget the stored session. */
export async function clearSession(): Promise<void> {
  await serial(() => writeAtomic(lastPath(), JSON.stringify({ payload: {}, savedAt: 0 })))
}

/* ────────────────────────────── recents ────────────────────────────── */

export async function listRecents(): Promise<RecentFile[]> {
  const raw = await readJson(recentsPath())
  if (!Array.isArray(raw)) return []
  const out: RecentFile[] = []
  for (const entry of raw) {
    const parsed = RecentFile.safeParse(entry)
    if (parsed.success) out.push(parsed.data)
  }
  return out.slice(0, RECENTS_MAX)
}

/**
 * Put one file at the head of the list.
 *
 * The rules, and each is a test in `tests/unit/recents.test.ts`:
 * · a path already in the list **moves** to the head rather than appearing twice, and its
 *   name, size and hash are refreshed — the same file re-opened after an edit is one entry;
 * · the list is capped at `RECENTS_MAX`, oldest dropped;
 * · order is most-recently-opened first, which is the order the landing pills render in.
 */
export function addRecent(file: RecentAdd): Promise<RecentFile[]> {
  // The read is inside the queue with the write, so a second call reads what the first wrote.
  return serial(async () => {
    const next = mergeRecent(await listRecents(), { ...file, openedAt: Date.now() })
    await writeAtomic(recentsPath(), JSON.stringify(next))
    return next
  })
}

/** Pure, so the list rules are testable without a disk. */
export function mergeRecent(
  list: readonly RecentFile[],
  entry: RecentFile,
  max = RECENTS_MAX
): RecentFile[] {
  return [entry, ...list.filter((r) => r.path !== entry.path)].slice(0, max)
}
