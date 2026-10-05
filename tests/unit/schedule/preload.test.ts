/**
 * The Schedules window's preload and page (2026-09-25), held to the rules every SGVue
 * renderer is held to: the preload imports only `electron`, spells its channel names exactly
 * as `ipc-channels.ts` does, and since phase 4 exposes exactly two calls (`saveExport`,
 * `openScheduleFile` — the keys are pinned in `tests/readonly-guard.test.ts`); both HTML pages
 * carry the production CSP byte for byte; and the window is built with the same webPreferences
 * as the main one.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CH_EXPORT_SAVE, CH_SCHEDULE_FILE_OPEN, CH_SCHEDULE_PORT } from '../../../src/shared/ipc-channels'

const ROOT = join(__dirname, '../../..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

describe('preload/schedule.ts', () => {
  const text = read('src/preload/schedule.ts')
  const code = text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')
  const imports = [...text.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[2])

  it('exposes one object, `sgvueSchedule`, and nothing else', () => {
    // Phase 4 (2026-09-25): the two file calls. Before it this preload exposed nothing.
    expect([...code.matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map((m) => m[1])).toEqual(['sgvueSchedule'])
  })

  it('imports electron and nothing else — so it builds to one file a sandbox can load', () => {
    // A module shared with the main preload would be split into `preload/chunks/`.
    expect(imports).toEqual(['electron'])
  })

  it('names every channel exactly as ipc-channels.ts does', () => {
    const named = (c: string): string | undefined => new RegExp(`const ${c} = '([^']+)'`).exec(code)?.[1]
    expect(named('CH_SCHEDULE_PORT')).toBe(CH_SCHEDULE_PORT)
    expect(named('CH_EXPORT_SAVE')).toBe(CH_EXPORT_SAVE)
    expect(named('CH_SCHEDULE_FILE_OPEN')).toBe(CH_SCHEDULE_FILE_OPEN)
  })

  it('receives only the port, invokes only its two file channels, and sends nothing', () => {
    expect(code).not.toMatch(/ipcRenderer\.(send|sendSync|postMessage)\b/)
    expect([...code.matchAll(/ipcRenderer\.on\(\s*(CH_[A-Z_]+)/g)].map((m) => m[1])).toEqual(['CH_SCHEDULE_PORT'])
    expect([...code.matchAll(/ipcRenderer\.invoke\(\s*(CH_[A-Z_]+)/g)].map((m) => m[1])).toEqual([
      'CH_EXPORT_SAVE',
      'CH_SCHEDULE_FILE_OPEN'
    ])
    // …and those three are every use of `ipcRenderer` there is.
    expect(code.match(/ipcRenderer\./g)).toHaveLength(3)
  })
})

describe('the two pages', () => {
  const CSP = /const CSP =\s*"([^"]+)"/.exec(read('electron.vite.config.ts'))![1]
  const meta = (html: string): string =>
    /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? ''

  it('carry the production CSP byte for byte', () => {
    expect(meta(read('src/renderer/index.html'))).toBe(CSP)
    expect(meta(read('src/renderer/schedule.html'))).toBe(CSP)
  })
})

describe('main/schedules-window.ts', () => {
  const text = read('src/main/schedules-window.ts')

  it('builds the window sandboxed, isolated, without Node and without webview', () => {
    expect(text).toMatch(/sandbox:\s*true/)
    expect(text).toMatch(/contextIsolation:\s*true/)
    expect(text).toMatch(/nodeIntegration:\s*false/)
    expect(text).toMatch(/webviewTag:\s*false/)
    expect(text).toMatch(/preload\/schedule\.js/)
  })

  it('locks its navigation and never hands the page a port through anything but the pair', () => {
    expect(text).toMatch(/lockNavigation\(win\.webContents/)
    expect(text).toMatch(/new MessageChannelMain\(\)/)
    expect(text).not.toMatch(/ipcMain\./)
  })
})

describe('main/index.ts — the two file channels (phase 4)', () => {
  const text = read('src/main/index.ts')
  /** A handler's text: from its `ipcMain.handle(` to the next registration. */
  const handler = (ch: string): string => {
    const at = text.indexOf(`ipcMain.handle(${ch},`)
    if (at < 0) return ''
    const next = text.slice(at + 1).search(/ipcMain\.handle\(|registerAiIpc\(\)/)
    return text.slice(at, next < 0 ? undefined : at + 1 + next)
  }

  it('answers them for the Schedules window only, before the payload is read', () => {
    for (const ch of ['CH_EXPORT_SAVE', 'CH_SCHEDULE_FILE_OPEN']) {
      const body = handler(ch)
      expect(body, `${ch} has no handler`).not.toBe('')
      const guard = body.indexOf('fromSchedules(event.sender)')
      expect(guard, `${ch} does not check its sender`).toBeGreaterThan(-1)
      expect(guard, `${ch} reads its payload before checking the sender`).toBeLessThan(body.indexOf('.parse('))
    }
    // The check itself: the Schedules window's own webContents, or nothing.
    expect(text).toMatch(/if \(!win \|\| sender !== win\.webContents\) throw new Error\('not available'\)/)
  })
})
