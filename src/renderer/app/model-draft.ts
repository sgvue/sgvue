/**
 * Preferences › Model is a draft, saved once — on Enter or when the field loses focus — and never
 * per keystroke: main refuses an empty model id (`SettingsPatch`, `min(1).max(MODEL_ID_MAX)`), and
 * a half-typed id must not be saved if the dialog closes mid-word (audit B7, item 1).
 *
 * What to send for a draft: the trimmed id, or `null` — nothing to save — for a blank, an
 * unchanged or an over-long draft. On `null` the field shows the saved model again.
 */
import { MODEL_ID_MAX } from '../../shared/ipc-contract'

export function modelToSave(draft: string, saved: string): string | null {
  const id = draft.trim()
  if (!id || id === saved || id.length > MODEL_ID_MAX) return null
  return id
}
