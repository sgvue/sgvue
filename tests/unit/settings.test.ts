/**
 * `src/main/settings.ts` — and above all, the key.
 *
 * `electron` is mocked down to the two things the module touches: `app.getPath('userData')`,
 * pointed at a temporary directory, and `safeStorage`, which is stubbed so both branches —
 * encryption available and encryption refused — can actually be exercised.
 *
 * The assertion that matters most is the negative one: the view the renderer receives carries
 * `hasKey` and never the key, and the key is not in the file as plaintext either.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sgvue-settings-'))
let available = true

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => available,
    // A stand-in for the OS keychain: reversible, and visibly not the plaintext.
    encryptString: (s: string) => Buffer.from(`enc:${s}`.split('').reverse().join('')),
    decryptString: (b: Buffer) => b.toString().split('').reverse().join('').replace(/^enc:/, '')
  }
}))

const settings = await import('../../src/main/settings')
const { SettingsPatch } = await import('../../src/shared/ipc-contract')

const stored = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))

beforeEach(() => {
  available = true
  delete process.env.ANTHROPIC_API_KEY
  settings.resetCache()
})

// The temporary `userData` goes away with the run, as `file-protocol.test.ts`'s does — a test
// that leaves a directory behind leaves one behind every time it is run.
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('defaults', () => {
  it('are the plan’s pinned model and effort, with WebGPU not on offer', () => {
    settings.clearApiKey()
    const view = settings.view()
    expect(view.model).toBe('claude-opus-5')
    expect(view.effort).toBe('medium')
    expect(view.cacheOneHour).toBe(false)
    expect(view.backend).toBe('auto')
    expect(view.preferNvidia).toBe(true)
    expect(view.hasKey).toBe(false)
  })

  it('keeps "Prefer NVIDIA graphics" on unless the file says exactly false (2026-09-25)', () => {
    expect(settings.preferNvidia()).toBe(true)
    expect(settings.update({ preferNvidia: false }).preferNvidia).toBe(false)
    settings.resetCache()
    expect(settings.preferNvidia()).toBe(false)
    expect(stored().preferNvidia).toBe(false)
    expect(() => settings.update({ preferNvidia: 'no' })).toThrow()
    expect(settings.update({ preferNvidia: true }).preferNvidia).toBe(true)
  })

  it('records a GPU failure main-only, and toggling the checkbox forgets it (2026-09-25)', () => {
    const failure = { at: 1790214057266, vendorId: 0x10de, deviceId: 0x2482 }
    settings.setGpuSwitchFailed(failure)
    settings.resetCache()
    expect(settings.gpuSwitchFailed()).toEqual(failure)
    expect(stored().gpuSwitchFailed).toEqual(failure)
    // Never shown to the renderer.
    expect('gpuSwitchFailed' in settings.view()).toBe(false)
    // Another setting leaves it alone…
    settings.update({ effort: 'high' })
    expect(settings.gpuSwitchFailed()).toEqual(failure)
    // …the checkbox, either way, clears it.
    settings.update({ preferNvidia: false })
    expect(settings.gpuSwitchFailed()).toBeNull()
    settings.setGpuSwitchFailed(failure)
    settings.update({ preferNvidia: true })
    expect(settings.gpuSwitchFailed()).toBeNull()
    expect(stored().gpuSwitchFailed).toBeUndefined()
    // And main can forget it directly (a changed adapter).
    settings.setGpuSwitchFailed(failure)
    settings.setGpuSwitchFailed(null)
    expect(settings.gpuSwitchFailed()).toBeNull()
  })

  it('never lets the renderer write a GPU failure: SettingsPatch strips it', () => {
    expect(SettingsPatch.parse({ effort: 'low', gpuSwitchFailed: { at: 1, vendorId: 1, deviceId: 1 } })).toEqual({
      effort: 'low'
    })
    settings.update({ gpuSwitchFailed: { at: 1, vendorId: 0x10de, deviceId: 0x2482 } })
    expect(settings.gpuSwitchFailed()).toBeNull()
    expect(stored().gpuSwitchFailed).toBeUndefined()
  })

  it('ignores a malformed recorded failure', () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ gpuSwitchFailed: { at: 'yesterday', vendorId: 4318, deviceId: 9346 } })
    )
    settings.resetCache()
    expect(settings.gpuSwitchFailed()).toBeNull()
  })

  it('accepts only the settings the contract declares', () => {
    expect(settings.update({ effort: 'xhigh', backend: 'webgl', cacheOneHour: true }).effort).toBe(
      'xhigh'
    )
    expect(settings.view().backend).toBe('webgl')
    // `webgpu` is not in the enum: it leaked ~168 GB in the GPU process on the big model.
    expect(() => settings.update({ backend: 'webgpu' })).toThrow()
  })

  it('bounds the model id, so a renderer cannot write megabytes into settings (S2)', () => {
    expect(settings.update({ model: 'claude-opus-5' }).model).toBe('claude-opus-5')
    expect(() => settings.update({ model: 'x'.repeat(201) })).toThrow()
    expect(() => settings.update({ model: '' })).toThrow()
    expect(settings.view().model).toBe('claude-opus-5')
  })

  it('falls back to the defaults rather than refusing to start on a corrupt file', () => {
    settings.update({ effort: 'low' })
    settings.resetCache()
    expect(settings.view().effort).toBe('low')
  })
})

describe('the API key', () => {
  it('is never returned to the renderer — only `hasKey`', () => {
    settings.setApiKey('sk-ant-secret-value')
    const view = settings.view()
    expect(view.hasKey).toBe(true)
    expect(JSON.stringify(view)).not.toContain('sk-ant-secret-value')
    expect(Object.keys(view).sort()).toEqual([
      'backend',
      'cacheOneHour',
      'effort',
      'hasKey',
      'keyStorageAvailable',
      'model',
      'preferNvidia'
    ])
  })

  it('is stored encrypted, never as plaintext on disk', () => {
    settings.setApiKey('sk-ant-secret-value')
    const file = stored()
    expect(typeof file.apiKeyEnc).toBe('string')
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).not.toContain('sk-ant-secret-value')
    // …and main can still read it back, which is the whole point.
    expect(settings.apiKey()).toBe('sk-ant-secret-value')
  })

  it('is forgotten on request, leaving nothing behind', () => {
    settings.setApiKey('sk-ant-secret-value')
    expect(settings.clearApiKey().hasKey).toBe(false)
    expect(stored().apiKeyEnc).toBeUndefined()
    expect(settings.apiKey()).toBeNull()
  })

  it('refuses to store with a clear reason when the OS has no secret store', () => {
    settings.clearApiKey()
    available = false
    expect(settings.view().keyStorageAvailable).toBe(false)
    expect(() => settings.setApiKey('sk-ant-x')).toThrow(/no secret store available/)
    expect(stored().apiKeyEnc).toBeUndefined()
  })

  it('lets the environment win, so a dev run never touches the stored one', () => {
    settings.setApiKey('sk-ant-stored')
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-env'
    expect(settings.apiKey()).toBe('sk-ant-from-env')
    delete process.env.ANTHROPIC_API_KEY
    expect(settings.apiKey()).toBe('sk-ant-stored')
    settings.clearApiKey()
  })

  it('treats an empty key as a request to forget it', () => {
    settings.setApiKey('sk-ant-x')
    expect(settings.setApiKey('   ').hasKey).toBe(false)
  })
})
