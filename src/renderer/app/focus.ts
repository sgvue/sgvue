/**
 * Phase 10. The two things every overlay owes a keyboard: focus goes *in* when it opens and
 * comes *back* when it closes, and Tab cannot walk out of it while it is open.
 *
 * The design has neither — it has no keyboard surface at all beyond the browser's default
 * focus ring (`SGVue.dc.html:44`) — so this is new behaviour, and it is invisible: it moves
 * focus and draws nothing. Three surfaces use it: the context menu, the Preferences dialog
 * and the designed unload confirmation.
 */
import { useEffect, type RefObject } from 'react'
import { focusables } from './focus-trap'

// The two DOM-only halves live in `focus-trap.ts` since 2026-09-25, so the Schedules window
// (vanilla DOM, no React) uses the same ones.
export { focusables, trapTab } from './focus-trap'

/**
 * Move focus into `container` while `open`, and give it back to whatever had it when the
 * surface opened once it closes. `startAt` picks which control receives it; the default is
 * the first one Tab would reach.
 */
export function useDialogFocus(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  startAt: 'first' | 'container' = 'first'
): void {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    // Captured here rather than read in the cleanup: React has already nulled the ref by the
    // time an unmount's cleanup runs, and this node is what the check below is about.
    const root = container.current
    if (root) {
      const target = startAt === 'container' ? root : (focusables(root)[0] ?? root)
      target.focus()
    }
    return () => {
      // Only if the surface still owns the focus: a click elsewhere has already moved it on
      // purpose, and yanking it back would be the rudest thing this file could do. An element
      // that has just been removed counts as ours — that is what closing looks like from here.
      const active = document.activeElement as HTMLElement | null
      const ours =
        !active || active === document.body || !active.isConnected || !!root?.contains(active)
      if (opener && opener.isConnected && ours) opener.focus()
    }
  }, [open, container, startAt])
}
