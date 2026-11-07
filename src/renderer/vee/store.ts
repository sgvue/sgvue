/**
 * What the Ask Vee window draws — 2026-11-07.
 *
 * The chat panel moved into a window of its own (`main/vee-window.ts`), and the conversation
 * stayed in the main window. This is the little state the panel reads here: the main window's
 * last snapshot (`shared/vee-messages.ts`, `VeeSnapshot`), under the names the panel always read
 * from the shell store, and the composer as it is being typed. Everything the user does goes
 * back as an intent (`./link.ts`); nothing here decides anything.
 *
 * **The composer is typed here** and kept in step with the main window's `chatInput`. A snapshot's
 * text is taken only when its counter (`composer.rev`) has moved — the main window changed it
 * itself: a sent turn cleared it, "Ask about this" filled it — so a snapshot that is a keystroke
 * behind never takes back what was just typed.
 */
import { create } from 'zustand'
import type { DisplayUnit } from '../../shared/units'
import type { VeeMessage, VeeSnapshot } from '../../shared/vee-messages'

export interface VeeView {
  /** A snapshot has arrived: until then the panel draws nothing. */
  ready: boolean
  chatMsgs: VeeMessage[]
  chatBusy: boolean
  chatErr: string
  chatReplyTo: number | null
  chatSuggestOpen: boolean
  suggestions: string[]
  units: DisplayUnit
  /** The composer, as typed here. */
  chatInput: string
  /** The main window's composer counter, as last taken. */
  rev: number
}

export const useVee = create<VeeView>(() => ({
  ready: false,
  chatMsgs: [],
  chatBusy: false,
  chatErr: '',
  chatReplyTo: null,
  chatSuggestOpen: false,
  suggestions: [],
  units: 'mm',
  chatInput: '',
  rev: -1
}))

/** Take one snapshot from the main window. */
export function takeSnapshot(snap: VeeSnapshot): void {
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme !== snap.theme) {
    document.documentElement.dataset.theme = snap.theme
  }
  const was = useVee.getState()
  useVee.setState({
    ready: true,
    chatMsgs: snap.msgs,
    chatBusy: snap.busy,
    chatErr: snap.err,
    chatReplyTo: snap.replyTo,
    chatSuggestOpen: snap.suggestOpen,
    suggestions: snap.suggestions,
    units: snap.units,
    ...(snap.composer.rev !== was.rev ? { chatInput: snap.composer.text, rev: snap.composer.rev } : {})
  })
}
