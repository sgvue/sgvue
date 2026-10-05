/**
 * The temporary-state frame — `SGVue.dc.html:1874` (`hiddenCount`) and `:1966` (`vis`).
 *
 * A Revit-style border round the viewport plus a pill that says how much is out of sight:
 * accent while a filter step drives the view, amber for hides made by hand. It belongs with
 * the hide affordances, which is why it lands with them in Phase 3 rather than with the filter
 * stack; the filter half of the label is written now and stays dormant until `stack` fills.
 *
 * Two design behaviours that read like bugs and are not:
 * · A model switched off with its eye does **not** count as hidden here. Only `hidden` and
 *   `storeyVis` do, so unloading a discipline from view leaves the frame alone.
 * · The filter term is `total − visibleCount − manual`, so a filter step and a manual hide
 *   covering the same element are counted once.
 */
import { group } from '../../../shared/fmt'
import type { FederatedElement } from '../../../shared/federate'
import type { FilterStep } from '../../../shared/rules'

export interface VisFrame {
  hiddenCount: number
  line: string
  glow: string
  bg: string
  fg: string
  label: string
}

export interface VisFrameInput {
  elements: readonly FederatedElement[]
  hidden: Record<number | string, boolean>
  storeyVis: Record<string, boolean>
  stack: readonly FilterStep[]
  visibleCount: number
}

export function visibilityFrame(s: VisFrameInput): VisFrame {
  const total = s.elements.length
  // Counted, not collected (2026-10-02): this runs over every element on every visibility
  // change, and the array a `filter` builds here was only ever measured.
  let manual = 0
  for (const e of s.elements) if (s.hidden[e.id] || s.storeyVis[e.storey] === false) manual++
  const live = s.stack.filter((x) => x.on && x.action !== 'highlight')
  const hiddenCount = manual + (live.length ? total - s.visibleCount - manual : 0)
  const n = group(hiddenCount)
  const label = live.length
    ? `${live.length} filter step${live.length === 1 ? '' : 's'} — ${n} hidden`
    : `${n} element${hiddenCount === 1 ? '' : 's'} hidden`
  return live.length
    ? {
        hiddenCount,
        line: 'var(--accent)',
        glow: 'var(--sel-bg)',
        bg: 'var(--sel-bg)',
        fg: 'var(--sel-ink)',
        label
      }
    : {
        hiddenCount,
        line: 'var(--warn-line)',
        glow: 'var(--warn-bg)',
        bg: 'var(--warn-bg)',
        fg: 'var(--warn-ink)',
        label
      }
}

/** What `visibilityFrameOnce` last answered, and for which inputs. One entry. */
let last: { of: VisFrameInput; frame: VisFrame } | null = null

/**
 * `visibilityFrame`, remembered for the inputs it was last asked about (2026-10-02).
 *
 * Two components ask on every visibility change — the frame and its pill, which stand in two
 * places (`app/VisibilityFrame.tsx`) — and each ran the selector for itself, so one change cost
 * two passes over every element. Whoever asks second now gets the first one's answer: the same
 * object. The store replaces `hidden`, `storeyVis`, `stack` and a federation's element array and
 * never edits them, so their identities are the key — what each component's own `useMemo`
 * depended on, which named the federation where this names its element array. The values are
 * `visibilityFrame`'s for every input.
 */
export function visibilityFrameOnce(s: VisFrameInput): VisFrame {
  if (
    last &&
    last.of.elements === s.elements &&
    last.of.hidden === s.hidden &&
    last.of.storeyVis === s.storeyVis &&
    last.of.stack === s.stack &&
    last.of.visibleCount === s.visibleCount
  ) {
    return last.frame
  }
  const frame = visibilityFrame(s)
  // The five references themselves, not the caller's object: that is its own to reuse.
  last = {
    of: { elements: s.elements, hidden: s.hidden, storeyVis: s.storeyVis, stack: s.stack, visibleCount: s.visibleCount },
    frame
  }
  return frame
}
