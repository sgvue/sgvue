/**
 * The STOREYS list — `SGVue.dc.html:1787–1794`, as a pure function.
 *
 * "Solo" is not a stored flag: a storey is solo when it is the only one still visible, which
 * is what makes a second click on the same row show all of them again.
 */
import type { FederatedElement } from '../../../shared/federate'
import type { Storey } from '../../../shared/model-index.types'
import { signedMm } from '../../../shared/fmt'

export interface StoreyRow {
  name: string
  /** Signed millimetres, thin-space grouped, U+2212 for negative. `:1790`. */
  elev: string
  count: number
  vis: boolean
  hid: boolean
  opacity: number
  edge: string
  bg: string
  fg: string
  /** True when this storey is the only visible one — a click then shows all. `:1793`. */
  solo: boolean
}

export interface StoreyInput {
  storeys: readonly Storey[]
  /** Already scoped by activate mode (`lels`). */
  elements: readonly FederatedElement[]
  storeyVis: Record<string, boolean>
  active: string | null
}

/** The only visible storey's name, or `null` when zero or several are visible. `:1787`. */
export function soloStoreyName(
  storeys: readonly Storey[],
  storeyVis: Record<string, boolean>
): string | null {
  const on = storeys.filter((st) => storeyVis[st.name] !== false)
  return on.length === 1 ? on[0].name : null
}

export function storeyRows(input: StoreyInput): StoreyRow[] {
  const { storeys, elements, storeyVis, active } = input
  const soloName = soloStoreyName(storeys, storeyVis)
  const counts = new Map<string, number>()
  for (const e of elements) counts.set(e.storey, (counts.get(e.storey) ?? 0) + 1)
  return storeys
    .filter((st) => !active || counts.has(st.name))
    .map((st) => {
      const vis = storeyVis[st.name] !== false
      const solo = soloName === st.name
      return {
        name: st.name,
        elev: signedMm(st.elev),
        count: counts.get(st.name) ?? 0,
        vis,
        hid: !vis,
        opacity: vis ? 1 : 0.5,
        edge: solo ? 'var(--accent)' : 'transparent',
        bg: solo ? 'var(--sel-bg)' : 'transparent',
        fg: solo ? 'var(--sel-ink)' : 'var(--ink)',
        solo
      }
    })
}
