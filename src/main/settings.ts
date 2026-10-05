/**
 * Settings — **one of the two modules allowed to write to disk** (plan §2 "Persistence",
 * `CLAUDE.md` rules). One file, `userData/settings.json`.
 *
 * The API key is the reason this module is careful.
 *
 * · It is encrypted with Electron's `safeStorage` (Keychain on macOS, DPAPI on Windows) and
 *   stored as base64 ciphertext under `apiKeyEnc`. The plaintext is never written.
 * · **It is never returned.** `view()` is what the renderer gets and it carries `hasKey:
 *   boolean` and nothing else; `apiKey()` is main-only and is called from exactly one place,
 *   `main/ai/session.ts`, which hands it to the Anthropic client it constructs.
 * · When the OS refuses to encrypt — a Linux session with no keyring, a locked login
 *   keychain — nothing is stored at all and `keyStorageAvailable` is false, so the dialog can
 *   say why the field is disabled instead of silently dropping what was typed.
 *
 * Everything else is small and ordinary: the model id, the effort level, whether to ask for a
 * one-hour prompt cache, the renderer backend the design's own `backend` prop selects, and —
 * Windows only, read once before `ready` — whether to prefer an NVIDIA adapter (`gpu-choice.ts`).
 */
import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SettingsPatch, SettingsView, type AiEffort, type RendererBackend } from '../shared/ipc-contract'
import type { GpuSwitchFailure } from './gpu-choice'

/** The plan's pinned model (`CLAUDE.md` → Decisions). */
const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_EFFORT: AiEffort = 'medium'
const DEFAULT_BACKEND: RendererBackend = 'auto'

interface StoredSettings {
  model: string
  effort: AiEffort
  cacheOneHour: boolean
  backend: RendererBackend
  preferNvidia: boolean
  /**
   * Main-only, never in `view()`: the GPU process crashed on a launch that asked for this
   * adapter (`gpu-choice.ts` → `planGpu`). Absent until that happens.
   */
  gpuSwitchFailed?: GpuSwitchFailure
  /** base64 `safeStorage` ciphertext, or absent. Never plaintext. */
  apiKeyEnc?: string
}

const DEFAULTS: StoredSettings = {
  model: DEFAULT_MODEL,
  effort: DEFAULT_EFFORT,
  cacheOneHour: false,
  backend: DEFAULT_BACKEND,
  preferNvidia: true
}

const filePath = (): string => join(app.getPath('userData'), 'settings.json')

let cache: StoredSettings | null = null

/** A recorded GPU failure, if the file holds a well-formed one. */
function failureOf(v: unknown): GpuSwitchFailure | null {
  const f = v as Partial<GpuSwitchFailure> | null
  return f && [f.at, f.vendorId, f.deviceId].every((n) => typeof n === 'number' && Number.isFinite(n))
    ? { at: f.at!, vendorId: f.vendorId!, deviceId: f.deviceId! }
    : null
}

/** A stored file that has been hand-edited into nonsense is replaced by the defaults. */
function read(): StoredSettings {
  if (cache) return cache
  let raw: unknown = null
  try {
    raw = JSON.parse(readFileSync(filePath(), 'utf8'))
  } catch {
    raw = null
  }
  const o = (raw ?? {}) as Partial<StoredSettings>
  const effort = SettingsView.shape.effort.safeParse(o.effort)
  const backend = SettingsView.shape.backend.safeParse(o.backend)
  const failed = failureOf(o.gpuSwitchFailed)
  cache = {
    model: typeof o.model === 'string' && o.model ? o.model : DEFAULTS.model,
    effort: effort.success ? effort.data : DEFAULTS.effort,
    cacheOneHour: o.cacheOneHour === true,
    backend: backend.success ? backend.data : DEFAULTS.backend,
    preferNvidia: o.preferNvidia !== false,
    ...(failed ? { gpuSwitchFailed: failed } : {}),
    ...(typeof o.apiKeyEnc === 'string' && o.apiKeyEnc ? { apiKeyEnc: o.apiKeyEnc } : {})
  }
  return cache
}

/** Atomic, like `sessions.ts`: a temporary file beside it, then one `rename`. */
function write(next: StoredSettings): void {
  cache = next
  const path = filePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(tmp, path)
}

/** True when the OS will actually encrypt. */
export function keyStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** What the renderer is allowed to see. Note what is missing: the key itself. */
export function view(): SettingsView {
  const s = read()
  return {
    model: s.model,
    effort: s.effort,
    cacheOneHour: s.cacheOneHour,
    backend: s.backend,
    preferNvidia: s.preferNvidia,
    hasKey: !!s.apiKeyEnc,
    keyStorageAvailable: keyStorageAvailable()
  }
}

/**
 * Main-only, read once before `ready` (`index.ts` → `gpu-choice.ts`). Not `view()`: that asks
 * `safeStorage`, which on Windows is not usable until `ready`.
 */
export function preferNvidia(): boolean {
  return read().preferNvidia
}

/** Main-only (`index.ts`): the GPU failure an earlier launch recorded, or `null`. */
export function gpuSwitchFailed(): GpuSwitchFailure | null {
  return read().gpuSwitchFailed ?? null
}

/** Main-only (`index.ts`): record a GPU failure, or forget it with `null`. */
export function setGpuSwitchFailed(failure: GpuSwitchFailure | null): void {
  const next = { ...read() }
  if (failure) next.gpuSwitchFailed = failure
  else delete next.gpuSwitchFailed
  write(next)
}

/**
 * A patch that sets `preferNvidia` — the user toggling Preferences' checkbox, either way —
 * also forgets a recorded GPU failure, so turning it off and on again is how to retry.
 */
export function update(patch: unknown): SettingsView {
  const p = SettingsPatch.parse(patch)
  const next: StoredSettings = { ...read(), ...p }
  if (p.preferNvidia !== undefined) delete next.gpuSwitchFailed
  write(next)
  return view()
}

/**
 * Store the key, encrypted. Throws with a sentence the dialog can show when the OS has no
 * usable secret store — losing the key silently would be worse than refusing.
 */
export function setApiKey(key: string): SettingsView {
  const trimmed = key.trim()
  if (!trimmed) return clearApiKey()
  if (!keyStorageAvailable()) {
    throw new Error(
      'This computer has no secret store available, so the key cannot be saved safely. Set ANTHROPIC_API_KEY in the environment instead.'
    )
  }
  write({ ...read(), apiKeyEnc: safeStorage.encryptString(trimmed).toString('base64') })
  return view()
}

export function clearApiKey(): SettingsView {
  const s = { ...read() }
  delete s.apiKeyEnc
  write(s)
  return view()
}

/**
 * The key, for the one caller in main that needs it. `ANTHROPIC_API_KEY` in the environment
 * wins, so a development run and `scripts/ai-acceptance.cjs` never have to touch the stored
 * one — and the acceptance script never reads from disk at all.
 */
export function apiKey(): string | null {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const enc = read().apiKeyEnc
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64')) || null
  } catch {
    return null
  }
}

/** Tests and a relaunch inside one process. */
export function resetCache(): void {
  cache = null
}
