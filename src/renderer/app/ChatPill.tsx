/**
 * The Ask Vee pill — `SGVue.dc.html:536`. Moved out of `ChatPanel.tsx` on 2026-11-07, unchanged,
 * when the panel became a window of its own (`main/vee-window.ts`) and the pill stayed in the
 * main window's bottom row.
 *
 * `:2041` — it lights while the panel is open, and is the only way to open it. Since 2026-11-07
 * "open" is the Ask Vee window: `chatOpen` is still the panel's state, and the window follows it
 * (`model/vee-link.ts`) — so the pill opens it, closes it, and is lit while it is open.
 *
 * Since 2026-10-01 it is the right zone of the stage's bottom row (`app/BottomRow.tsx`), which
 * stands it where the design's `position:absolute;right:12px;bottom:14px` did; the rest of the
 * string is the design's. `z-index:12` still applies: the button is `position:relative`, as
 * every `[data-tip]` is.
 *
 * The same day it took the assistant's name: its label reads `Ask Vee` (the design's: `Ask`) and
 * the mascot stands where the sparkle did, in the sparkle's own 14 px of flow. So the pill is
 * 88.9 px wide where it was 66.6 — the label, and nothing else: its height, colours, tip and
 * offsets are the design's.
 */
import { useShell } from '../state/shell'
import { s } from './css'
import { Vee } from './Vee'
import { VEE_MARGIN, VEE_OFFSET, VEE_SLOT } from './vee-grid'

export function ChatPill(): React.JSX.Element {
  const chatOpen = useShell((st) => st.chatOpen)
  const setChatOpen = useShell((st) => st.setChatOpen)
  const fg = chatOpen ? 'var(--sel-ink)' : 'var(--muted)'
  const line = chatOpen ? 'var(--accent)' : 'var(--border)'
  return (
    <button
      onClick={() => setChatOpen(!chatOpen)}
      data-tip="Ask the assistant to filter, isolate, hide or navigate the model"
      className="hv-accent-line"
      style={s(
        `z-index:12;display:flex;align-items:center;gap:7px;height:32px;padding:0 12px;background:var(--card);border:1px solid ${line};border-radius:999px;box-shadow:var(--shadow);color:${fg};pointer-events:auto`
      )}
    >
      <Vee slot={VEE_SLOT.pill} margin={VEE_MARGIN.pill} offset={VEE_OFFSET.pill} />
      <span style={s('font:500 11.5px/1 var(--sans);white-space:nowrap')}>Ask Vee</span>
    </button>
  )
}
