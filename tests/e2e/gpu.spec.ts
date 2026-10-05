/**
 * 2026-09-25 — on Windows the app draws on NVIDIA when there is one (`src/main/gpu-choice.ts`).
 *
 * Every launch here is the real main process, so the registry read, the switch and Chromium's
 * own adapter choice all run. What is asserted is what Chromium reports back: the active device
 * in `app.getGPUInfo`, and the page's own `UNMASKED_RENDERER_WEBGL`. The development override
 * `SGVUE_GPU_VENDOR=8086` proves the switch really moves the app — onto Intel, and back.
 *
 * Windows only, and each case skips with its reason when this machine lacks the adapter it
 * needs. Run through `npm run test:e2e` (the guarded wrapper), never a bare Playwright.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, uptime } from 'node:os'
import { join } from 'node:path'
import {
  chooseAdapter,
  INTEL,
  luidSwitch,
  NVIDIA,
  parseDirectXAdapters,
  type DxAdapter
} from '../../src/main/gpu-choice'
import { launch } from './helpers'

const WIN = process.platform === 'win32'

/** What this machine's registry says, read the way `index.ts` reads it. */
function adapters(): DxAdapter[] {
  if (!WIN) return []
  const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
  return parseDirectXAdapters(
    execFileSync(reg, ['query', 'HKLM\\SOFTWARE\\Microsoft\\DirectX', '/s'], { encoding: 'utf8' })
  )
}
const boot = (): number => Date.now() - uptime() * 1000
const nvidia = (): DxAdapter | null => chooseAdapter(adapters().filter((a) => a.vendorId === NVIDIA), boot())
const intel = (): DxAdapter | null => chooseAdapter(adapters(), boot(), INTEL)

/** The switch main appended, the active device, and the page's own WebGL renderer string. */
async function drawing(app: ElectronApplication, page: Page): Promise<{
  luid: string
  active: { vendorId?: number; deviceString?: string } | undefined
  webgl: string
}> {
  const webgl = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  })
  const main = await app.evaluate(async ({ app: a }) => {
    const info = (await a.getGPUInfo('complete')) as {
      gpuDevice?: { active?: boolean; vendorId?: number; deviceString?: string }[]
    }
    return {
      luid: a.commandLine.getSwitchValue('use-adapter-luid'),
      active: info.gpuDevice?.find((d) => d.active)
    }
  })
  return { ...main, webgl }
}

let dir = ''
/** This profile's `settings.json`, or `{}` before anything has written it. */
const stored = async (): Promise<Record<string, unknown>> => {
  try {
    return JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
}
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sgvue-e2e-gpu-'))
})
test.afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('Windows: NVIDIA by default, Intel when a development build names it, then NVIDIA again', async () => {
  test.skip(!WIN, 'Windows only — macOS lets the OS choose')
  const nv = nvidia()
  const ig = intel()
  test.skip(!nv || !ig || ig.vendorId !== INTEL, 'needs an NVIDIA and an Intel adapter, seen since boot')

  for (const [env, want] of [
    [{}, nv!],
    [{ SGVUE_GPU_VENDOR: '8086' }, ig!],
    [{}, nv!]
  ] as const) {
    const { app, page } = await launch(dir, env)
    try {
      await expect(page.locator('[data-role="landing"]')).toBeVisible()
      const got = await drawing(app, page)
      expect(got.luid).toBe(luidSwitch(want.luid))
      expect(got.active?.vendorId).toBe(want.vendorId)
      expect(got.webgl).toContain(want.vendorId === NVIDIA ? 'NVIDIA' : 'Intel')
      console.log(`[gpu] ${JSON.stringify(env)} → ${got.luid} · ${got.active?.deviceString} · ${got.webgl}`)
    } finally {
      await app.close()
    }
  }
  // Three ordinary quits: none of them is taken for a GPU failure.
  expect((await stored()).gpuSwitchFailed).toBeUndefined()
})

test('Windows: a GPU crash with the switch on is recorded, the next launch asks nothing, and toggling the checkbox retries', async () => {
  test.skip(!WIN, 'Windows only')
  const nv = nvidia()
  test.skip(!nv, 'needs an NVIDIA adapter, seen since boot')
  const asks = async (app: ElectronApplication): Promise<boolean> =>
    app.evaluate(({ app: a }) => a.commandLine.hasSwitch('use-adapter-luid'))

  // 1 — asked for NVIDIA; then the GPU process crashes (Chromium's own debug URL) and is recorded.
  {
    const { app, page } = await launch(dir)
    try {
      await expect(page.locator('[data-role="landing"]')).toBeVisible()
      expect(await asks(app)).toBe(true)
      await app.evaluate(({ BrowserWindow }) => {
        void new BrowserWindow({ show: false }).loadURL('chrome://gpucrash').catch(() => undefined)
      })
      await expect.poll(async () => (await stored()).gpuSwitchFailed, { timeout: 15_000 }).toMatchObject({
        vendorId: nv!.vendorId,
        deviceId: nv!.deviceId
      })
    } finally {
      await app.close()
    }
  }
  // 2 — the next launch asks for nothing: Windows decides.
  {
    const { app, page } = await launch(dir)
    try {
      await expect(page.locator('[data-role="landing"]')).toBeVisible()
      expect(await asks(app)).toBe(false)
      // 3 — off and on again in Preferences forgets the failure.
      await app.evaluate(({ Menu }) => {
        for (const top of Menu.getApplicationMenu()!.items) {
          for (const sub of top.submenu?.items ?? []) if (sub.label === 'Preferences…') sub.click()
        }
      })
      const box = page.locator('[data-role="prefs"]').getByLabel('Prefer NVIDIA graphics when available')
      await box.click()
      await expect(box).not.toBeChecked()
      await box.click()
      await expect(box).toBeChecked()
      const now = await stored()
      expect(now.gpuSwitchFailed).toBeUndefined()
      expect(now.preferNvidia).toBe(true)
    } finally {
      await app.close()
    }
  }
  // 4 — and the launch after that asks again.
  {
    const { app, page } = await launch(dir)
    try {
      await expect(page.locator('[data-role="landing"]')).toBeVisible()
      expect(await asks(app)).toBe(true)
    } finally {
      await app.close()
    }
  }
})

test('Windows: Preferences carries the checkbox, on by default, and unticking it is saved', async () => {
  test.skip(!WIN, 'Windows only — the checkbox is not shown on macOS')
  const { app, page } = await launch(dir)
  try {
    await expect(page.locator('[data-role="landing"]')).toBeVisible()
    await app.evaluate(({ Menu }) => {
      for (const top of Menu.getApplicationMenu()!.items) {
        for (const sub of top.submenu?.items ?? []) if (sub.label === 'Preferences…') sub.click()
      }
    })
    const box = page.locator('[data-role="prefs"]').getByLabel('Prefer NVIDIA graphics when available')
    await expect(box).toBeChecked()
    // A click, not `uncheck()`: the box is controlled by what main saved, so it turns over when
    // the IPC answer lands — which `uncheck()` does not wait for, and the assertion below does.
    await box.click()
    await expect(box).not.toBeChecked()
    await expect
      .poll(async () => JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).preferNvidia)
      .toBe(false)
  } finally {
    await app.close()
  }
})

test('Windows: with "Prefer NVIDIA graphics" off, no adapter is asked for', async () => {
  test.skip(!WIN, 'Windows only')
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ preferNvidia: false }), 'utf8')
  const { app, page } = await launch(dir)
  try {
    await expect(page.locator('[data-role="landing"]')).toBeVisible()
    expect(await app.evaluate(({ app: a }) => a.commandLine.hasSwitch('use-adapter-luid'))).toBe(false)
  } finally {
    await app.close()
  }
})
