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
import { DEVTOOLS } from '../dev/flags'
import type { VeeBoard, VeeMessage, VeeSnapshot } from '../../shared/vee-messages'

export interface VeeView {
  /** A snapshot has arrived: until then the panel draws nothing. */
  ready: boolean
  chatMsgs: VeeMessage[]
  chatBusy: boolean
  chatErr: string
  chatReplyTo: number | null
  /** 2026-11-08 — the bubble of `chatReplyTo` replied to, or `null` for the whole message. */
  chatReplyPart: number | null
  /** 2026-11-08 — whether Vee can answer: a key, a model. `undefined`: not said, so taken as yes. */
  hasKey: boolean | undefined
  hasModel: boolean | undefined
  /** 2026-11-08 — how the last turn ended when it did not answer. */
  chatEnd: VeeSnapshot['end'] | null
  /** 2026-11-08 — the pinned board, or `null` with no model open. */
  board: VeeBoard | null
  /**
   * 2026-11-08 — the table card whose `copy csv` was clicked last (its message's identity), and
   * how the copy went, for its `copied` flash: `null` until the copy has answered.
   */
  copyFlash: { msg: number; ok: boolean | null; at: number } | null
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
  chatReplyPart: null,
  hasKey: undefined,
  hasModel: undefined,
  chatEnd: null,
  board: null,
  copyFlash: null,
  chatSuggestOpen: false,
  suggestions: [],
  units: 'mm',
  chatInput: '',
  rev: -1
}))

/**
 * 2026-11-08 (stage 1b) — the messages of a new snapshot, each **the object this window already
 * holds** when it is the same message: a message's `id` is the identity of the main window's
 * message object, which is replaced whenever the message changes (`model/vee-link.ts`), so an
 * unchanged id is an unchanged message. A row of the transcript is memoised on its message
 * (`app/ChatPanel.tsx`, `MessageRow`), so a snapshot that changed one message — or none: the
 * composer, the board — renders only that one again.
 */
export function keepUnchanged(was: readonly VeeMessage[], next: readonly VeeMessage[]): VeeMessage[] {
  const known = new Map(was.map((m) => [m.id, m]))
  return next.map((m) => known.get(m.id) ?? m)
}

/**
 * 2026-11-09 — the owner has seen a reply of Vee's twice. Two messages of one snapshot that share
 * an `id` would be drawn as two rows of one object here (`keepUnchanged` keeps the first), so it is
 * said in the console of a dev build; a production build drops the check. Exported for the tests.
 */
export function sharedIds(msgs: readonly Pick<VeeMessage, 'id'>[]): number[] {
  const seen = new Set<number>()
  const twice = new Set<number>()
  for (const m of msgs) (seen.has(m.id) ? twice : seen).add(m.id)
  return [...twice]
}

/** Take one snapshot from the main window. */
export function takeSnapshot(snap: VeeSnapshot): void {
  if (DEVTOOLS) {
    const twice = sharedIds(snap.msgs)
    if (twice.length) console.warn(`[vee] ${twice.length} message id(s) shared by two rows of one snapshot: ${twice.join(', ')}`)
  }
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme !== snap.theme) {
    document.documentElement.dataset.theme = snap.theme
  }
  const was = useVee.getState()
  useVee.setState({
    ready: true,
    chatMsgs: keepUnchanged(was.chatMsgs, snap.msgs),
    chatBusy: snap.busy,
    chatErr: snap.err,
    chatReplyTo: snap.replyTo,
    chatReplyPart: snap.replyPart ?? null,
    hasKey: snap.hasKey,
    hasModel: snap.hasModel,
    chatEnd: snap.end ?? null,
    chatSuggestOpen: snap.suggestOpen,
    suggestions: snap.suggestions,
    units: snap.units,
    ...(snap.composer.rev !== was.rev ? { chatInput: snap.composer.text, rev: snap.composer.rev } : {})
  })
}

/** 2026-11-08 — take the pinned board from the main window. */
export function takeBoard(board: VeeBoard | null): void {
  useVee.setState({ board })
}
