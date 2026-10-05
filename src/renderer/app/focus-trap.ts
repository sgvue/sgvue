/**
 * Phase 10's keyboard trap for an overlay, without React: what Tab can reach inside a surface,
 * and keeping Tab inside it. Moved out of `focus.ts` on 2026-09-25 unchanged, so the Schedules
 * window's dialogs (vanilla DOM) use the very same two functions as Preferences and the
 * context menu. `focus.ts` re-exports both.
 */

/** Everything inside `root` a Tab can reach, in document order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    // `getClientRects()` rather than `offsetParent`, which is null for a fixed element and
    // would drop the context menu's own items.
  ].filter((el) => el.getClientRects().length > 0 || el === document.activeElement)
}

/**
 * Keep Tab inside `root`: off the last element it wraps to the first, and off the first with
 * Shift it wraps to the last. Returns `true` when it handled the event, so the caller knows
 * whether to `preventDefault`.
 */
export function trapTab(root: HTMLElement, event: { key: string; shiftKey: boolean }): boolean {
  if (event.key !== 'Tab') return false
  const list = focusables(root)
  if (!list.length) return false
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === root)) {
    last.focus()
    return true
  }
  if (!event.shiftKey && active === last) {
    first.focus()
    return true
  }
  return false
}
