/**
 * What happens between the window opening and a model being on screen —
 * `SGVue.dc.html:857–875` (`componentDidMount`) and `:1096` (`boot`).
 *
 * The design reads the link, then the stored session, and **a link wins** — it boots straight
 * away, while a stored session only lights the "Resume last session" card. That card is not in
 * the port (2026-09-24), so only the link is read here. Nothing else loads by itself.
 *
 * A link the app was **launched** with does arrive in `location.hash`, exactly as the design
 * reads it: `main/index.ts` puts it there rather than sending it, because `did-finish-load`
 * can fire before React's first effect and an IPC message sent then is simply lost. A link
 * that arrives while the app is already running comes over IPC instead.
 */
import { copyLink, payloadFromCode, payloadFromUrl, probeFiles, startAutosave } from './session'
import { libraryOf, openPaths, openRecent, disposeUploads, showRefused } from './upload-pipeline'
import { setOutsideActions, useShell } from '../state/shell'
import type { SessionPayload } from '../../shared/session-codec'
import { api } from '../api'

/** A `sgvue://s=…` link. Same checks; the payload replaces whatever session was stored. */
export async function openLink(url: string): Promise<void> {
  const payload = payloadFromUrl(url)
  if (!payload) {
    useShell.getState().setInitErr('That link could not be read. Ask for it again.')
    return
  }
  await openPayload(payload)
}

/** Shared by the link and by any future caller that already holds a payload. */
export async function openPayload(payload: SessionPayload): Promise<void> {
  const probe = await probeFiles(payload)
  if (!probe.ok) {
    // 2026-10-09 — a file main refused (over 600 MB now, say) gets the drop zone's own row; the
    // banner, set after it (`begin` clears the banner), names only files that really moved.
    await showRefused(probe.refused)
    if (probe.message) useShell.getState().setInitErr(probe.message)
    return
  }
  useShell.getState().setInitErr('')
  // `probe.payload` is the link's own with every file's path rewritten to the one main
  // admitted, so the hash check downstream compares like with like (`probeFiles`).
  await openPaths(probe.paths, probe.payload)
}

/**
 * Called once from the shell's mount effect. Returns the teardown.
 */
export function installBoot(): () => void {
  const bridge = api()

  // 2026-10-02 — the two gated actions the store performs but does not own (`state/shell.ts`,
  // `OutsideActions`): a recent file opened, the share link copied. Each runs only from the
  // user's click on a pending row's Apply.
  setOutsideActions({ openRecent, copyLink })

  /**
   * `SGVue.dc.html:866` — a share link the app was **launched** with, in the renderer's own
   * hash, read exactly as the design reads it.
   */
  const inHash = /[#&]s=([A-Za-z0-9\-_]+)/.exec(
    typeof location === 'undefined' ? '' : location.hash
  )
  const fromHash = inHash ? payloadFromCode(inHash[1]) : null

  // The sample library, backed by the recents list (fidelity contract, allowed deviations).
  // Empty until the user has opened something, which is the design's own `hasSamples: false`.
  void bridge
    ?.listRecents()
    .then((list) => useShell.getState().setLibrary(libraryOf(list)))
    .catch(() => {
      /* no recents is the same as an empty library */
    })

  // A link the OS delivered — at launch or while the app is running. It simply acts whenever
  // it arrives (`:869`).
  const offLink = bridge?.onDeepLink(({ url }) => void openLink(url))

  // A launch link boots straight away — the design's `return this.boot(link.models, …)`.
  if (fromHash) void openPayload(fromHash)

  const stopAutosave = startAutosave()

  return () => {
    offLink?.()
    stopAutosave()
    disposeUploads()
    setOutsideActions(null)
  }
}
