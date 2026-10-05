/**
 * `SGVue.dc.html:855` — the design finds its own nodes by `data-role`, and so does the port.
 * Searches `root` when given, else the document; `null` where there is no document (the unit
 * tests).
 */
export const el = (role: string, root?: ParentNode): HTMLElement | null =>
  (root ?? (typeof document === 'undefined' ? null : document))?.querySelector<HTMLElement>(
    `[data-role="${role}"]`
  ) ?? null
