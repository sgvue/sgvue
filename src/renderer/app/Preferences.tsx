/**
 * Preferences — the one surface the design does not have, and the fidelity contract's
 * allowed deviations are what put it here: the API key, the model, the effort level, the
 * renderer backend and the "Data sent to AI" viewer have no designed home, and adding them
 * to a designed surface is forbidden. It opens from the native menu (⌘,) and from nowhere
 * else, so no designed surface changes.
 *
 * It is built from the design's own tokens and its own card idiom — `var(--card)`,
 * `var(--border-strong)`, the 10 px radius, the uppercase 11 px label, the `fadein`
 * animation, the same close button — so it reads as part of the app rather than as a
 * browser dialog.
 *
 * **The key field is write-only.** It shows whether a key is stored, never the key: main
 * encrypts it with `safeStorage` and the renderer is told `hasKey` and nothing more.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { SettingsView } from '../../shared/ipc-contract'
import { lastRequestSnapshot } from '../ai/bridge'
import { api } from '../api'
import { trapTab, useDialogFocus } from './focus'
import { s } from './css'
import { Cross } from './icons'

const LABEL =
  'font:600 11px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)'
const FIELD =
  'font:400 13px/1.4 var(--mono);color:var(--ink);background:var(--card);border:1px solid var(--border-strong);border-radius:8px;padding:6px 10px;width:100%'

/** The sentence the plan asks for, verbatim. It is the whole privacy story in two lines. */
export const PRIVACY_NOTE =
  "The assistant sends a summary of the model's schema and the results of read-only queries to Anthropic's API. The IFC file itself never leaves this computer."

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export default function Preferences({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [key, setKey] = useState('')
  const [note, setNote] = useState('')
  const [showData, setShowData] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // Phase 10: focus goes into the dialog when it opens and back to whatever had it — here the
  // window, since Preferences opens from the native menu — when it closes.
  useDialogFocus(open, box)

  useEffect(() => {
    if (!open) return
    setNote('')
    setKey('')
    void api()?.getSettings().then(setSettings)
  }, [open])

  if (!open) return null

  const patch = (p: Parameters<Window['sgvue']['setSettings']>[0]): void => {
    void api()?.setSettings(p).then(setSettings)
  }

  const saveKey = (): void => {
    if (!key.trim()) return
    api()
      ?.setApiKey(key.trim())
      .then((next) => {
        setSettings(next)
        setKey('')
        setNote('Key saved.')
      })
      .catch((e: Error) => setNote(e.message))
  }

  return (
    <div
      data-role="prefs-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        // A modal owns Escape and Tab: neither reaches the window's own shortcuts behind it.
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        } else if (box.current && trapTab(box.current, event)) {
          event.preventDefault()
        }
      }}
      style={s(
        'position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.34)'
      )}
    >
      <div
        data-role="prefs"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={s(
          'width:420px;max-width:calc(100% - 32px);max-height:calc(100% - 48px);overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px;background:var(--card);border:1px solid var(--border-strong);border-radius:10px;box-shadow:var(--shadow);animation:fadein .15s ease-out'
        )}
      >
        <div style={s('display:flex;align-items:center;justify-content:space-between')}>
          <span
            id={titleId}
            style={s(
              'font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)'
            )}
          >
            Preferences
          </span>
          <button
            onClick={onClose}
            aria-label="Close Preferences"
            className="hv-step-ink"
            style={s(
              'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;color:var(--faint)'
            )}
          >
            <Cross size={14} weight={1.8} />
          </button>
        </div>

        <label style={s('display:flex;flex-direction:column;gap:4px')}>
          <span style={s(LABEL)}>Anthropic API key</span>
          <div style={s('display:flex;gap:8px')}>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={settings?.hasKey ? 'A key is stored' : 'sk-ant-…'}
              value={key}
              disabled={settings ? !settings.keyStorageAvailable : true}
              onChange={(e) => setKey(e.target.value)}
              className="fv-field"
              style={s(FIELD)}
            />
            <button
              onClick={saveKey}
              className="hv-step-ink"
              style={s(
                'font:600 12px/1 var(--sans);padding:0 12px;border-radius:8px;border:1px solid var(--border-strong);color:var(--ink);background:var(--ground)'
              )}
            >
              Save
            </button>
          </div>
        </label>
        <div style={s('display:flex;align-items:center;gap:8px')}>
          <span style={s('font-size:12px;color:var(--muted)')}>
            {settings?.keyStorageAvailable === false
              ? 'This computer has no secret store available. Set ANTHROPIC_API_KEY in the environment instead.'
              : settings?.hasKey
                ? 'Stored, encrypted by the operating system. It is never shown again.'
                : 'Not set. The assistant is unavailable until one is.'}
          </span>
          {settings?.hasKey ? (
            <button
              onClick={() => void api()?.clearApiKey().then(setSettings)}
              className="hv-step-ink"
              style={s('font:600 12px/1 var(--sans);color:var(--muted);margin-left:auto')}
            >
              Forget
            </button>
          ) : null}
        </div>

        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
          <label style={s('display:flex;flex-direction:column;gap:4px')}>
            <span style={s(LABEL)}>Model</span>
            <input
              value={settings?.model ?? ''}
              onChange={(e) => patch({ model: e.target.value })}
              className="fv-field"
              style={s(FIELD)}
            />
          </label>
          <label style={s('display:flex;flex-direction:column;gap:4px')}>
            <span style={s(LABEL)}>Effort</span>
            <select
              value={settings?.effort ?? 'medium'}
              onChange={(e) => patch({ effort: e.target.value as SettingsView['effort'] })}
              className="fv-field"
              style={s(FIELD)}
            >
              {EFFORTS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label style={s('display:flex;flex-direction:column;gap:4px')}>
            <span style={s(LABEL)}>Renderer</span>
            <select
              value={settings?.backend ?? 'auto'}
              onChange={(e) => patch({ backend: e.target.value as SettingsView['backend'] })}
              className="fv-field"
              style={s(FIELD)}
            >
              <option value="auto">auto</option>
              <option value="webgl">WebGL2</option>
            </select>
          </label>
          <label style={s('display:flex;flex-direction:column;gap:4px')}>
            <span style={s(LABEL)}>Prompt cache</span>
            <select
              value={settings?.cacheOneHour ? '1h' : '5m'}
              onChange={(e) => patch({ cacheOneHour: e.target.value === '1h' })}
              className="fv-field"
              style={s(FIELD)}
            >
              <option value="5m">5 minutes</option>
              <option value="1h">1 hour</option>
            </select>
          </label>
        </div>

        {/* 2026-09-25 — Windows only (`main/gpu-choice.ts`): read once, at the next launch. */}
        {api()?.platform === 'win32' ? (
          <div style={s('display:flex;flex-direction:column;gap:4px')}>
            <label style={s('display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink);cursor:pointer')}>
              <input
                type="checkbox"
                checked={settings?.preferNvidia ?? true}
                onChange={(e) => patch({ preferNvidia: e.target.checked })}
                style={s('margin:0;accent-color:var(--accent)')}
              />
              Prefer NVIDIA graphics when available
            </label>
            <span style={s('font-size:12px;color:var(--muted)')}>
              Takes effect the next time SGVue starts.
            </span>
          </div>
        ) : null}

        <p style={s('margin:0;font-size:12px;line-height:1.5;color:var(--muted)')}>
          {PRIVACY_NOTE}
        </p>

        <button
          onClick={() => setShowData((v) => !v)}
          className="hv-step-ink"
          style={s(
            'align-self:flex-start;font:600 12px/1 var(--sans);color:var(--muted);padding:6px 0'
          )}
        >
          {showData ? 'Hide data sent to AI' : 'Data sent to AI'}
        </button>
        {showData ? (
          <pre
            data-role="prefs-snapshot"
            style={s(
              'margin:0;max-height:220px;overflow:auto;font:400 11px/1.5 var(--mono);color:var(--muted);background:var(--ground);border:1px solid var(--border);border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word'
            )}
          >
            {lastRequestSnapshot() || 'Nothing has been sent yet this session.'}
          </pre>
        ) : null}

        {note ? (
          <span style={s('font-size:12px;color:var(--muted)')} data-role="prefs-note">
            {note}
          </span>
        ) : null}
      </div>
    </div>
  )
}
