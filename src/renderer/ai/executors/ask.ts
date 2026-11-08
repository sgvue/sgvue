/**
 * `ask_choice` — the IFC+SG question (2026-11-08, "Vee Messages" stage 2; HANDOFF §8.3,
 * owner-approved).
 *
 * While a loaded model carries `SGPset_` property sets — how a Singapore IFC+SG (CORENET X)
 * submission is prepared — Vee answers a question about the types, properties or classification
 * of those elements differently for an IFC+SG submission (an identity: entity plus sub-type) and
 * for any other model (plain IFC terms). So it asks, once a conversation, before it answers.
 *
 * **The question and its answer are the app's.** The model gives one sentence of lead-in; the
 * app adds the question itself (`IFCSG_QUESTION`) and draws the two quick replies under the
 * reply. Only the user's click on one answers it (the store's `chooseReply`, which only the Vee
 * window's `choose` intent and the dev harness call — never anything under `ai/`), so neither the
 * model nor a file's text can set the answer or raise the question again.
 *
 * Refused, in words, when no loaded model carries an `SGPset_` set; when the turn's last
 * rule-bearing call touched no element that carries one (the question is not about them); when
 * the question was already asked in this conversation, answered or not; and when this turn asked
 * it already.
 */
import { labelText } from '../../../shared/fmt'
import { sgPsetNames } from '../../../shared/ai-schema'
import { ASK_LEAD_MAX } from '../../../shared/tool-schemas'
import type { Executor } from './context'

/** The question the app asks, after the model's lead-in. */
export const IFCSG_QUESTION = 'Is this model for an IFC+SG submission?'

/** The two quick replies under it: what each sends as the user's message, and what it sets. */
export const IFCSG_REPLIES: readonly { value: 'yes' | 'no'; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
]

export const ask_choice: Executor = (input, ctx) => {
  const s = ctx.state()
  if (!sgPsetNames(s.federation).length) {
    return {
      forModel: {
        message: 'No loaded model carries an SGPset_ property set, so there is no IFC+SG question to ask. Answer in plain IFC terms, and do not mention IFC+SG unless the user does.',
        asked: false
      }
    }
  }
  // Only when relevant, decided here and not only in the prompt (stage 2's review): the turn
  // must already have read, by rule, elements that carry an SGPset_ set.
  if (!ctx.turn.sgTouched) {
    return {
      forModel: {
        message:
          'Not asked: no element this turn has read by rule carries an SGPset_ set, so the question is not relevant to it. Read the elements the user asks about first — query_elements or another rule-bearing tool — and ask only if those carry SGPset_ sets; otherwise answer in plain IFC terms.',
        asked: false
      }
    }
  }
  if (s.chatIfcsg !== 'unknown') {
    return {
      forModel: {
        message: `Already answered: ${s.chatIfcsg}. Answer in ${s.chatIfcsg === 'yes' ? 'IFC+SG terms' : 'plain IFC terms'}, and do not ask again.`,
        asked: false,
        ifcsg: s.chatIfcsg
      }
    }
  }
  if (s.chatIfcsgAsked || ctx.turn.ask) {
    return {
      forModel: {
        message: 'The question was already asked once in this conversation and the user did not pick an answer. Do not ask again: answer in plain IFC terms unless the user says otherwise.',
        asked: false
      }
    }
  }
  const lead = labelText(String(input.lead ?? '').trim(), ASK_LEAD_MAX)
  return {
    forModel: {
      message: `Asked. Under your reply the user sees "${lead ? `${lead} ` : ''}${IFCSG_QUESTION}" with Yes and No. Nothing is answered yet: end your turn now, without repeating the lead-in or the question — at most one short sentence of your own. The answer arrives as the user's next message, and the view state then carries ifcsg.`,
      asked: true
    },
    // The touched set stays with the question, in the main window, for the heads-up after a "Yes".
    ui: { ask: { lead, ...(ctx.turn.sgSet ? { set: ctx.turn.sgSet } : {}) } }
  }
}

export const ASK_EXECUTORS: Record<string, Executor> = { ask_choice }
