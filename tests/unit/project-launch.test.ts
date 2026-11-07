/**
 * `src/main/project-launch.ts` — 2026-11-08, the `.sgvue` project file, phase 5 (plan D10): how a
 * project the OS hands the app — macOS `open-file`, `argv` on first launch and on a second launch —
 * reaches `projects.ts`. `electron` is mocked down to `app.on` / `app.isReady`, whose listeners the
 * test fires itself, and `projects.ts` down to `openProjectFromOS`, which is all this module calls:
 * what that function then does (park, wait for the page, the shared open) is `projects.test.ts`'s.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const listeners = new Map<string, (...args: unknown[]) => unknown>()
let ready = false
vi.mock('electron', () => ({
  app: {
    on: (event: string, fn: (...args: unknown[]) => unknown) => listeners.set(event, fn),
    isReady: () => ready
  },
  dialog: {}
}))
const openProjectFromOS = vi.fn()
vi.mock('../../src/main/projects', () => ({ openProjectFromOS }))

const { installProjectLaunch, projectArgs, projectFromArgv } = await import('../../src/main/project-launch')

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'sgvue-launch-')))
const TOWER = join(root, 'Tower A.sgvue')
const OTHER = join(root, 'other.sgvue')
writeFileSync(TOWER, '{}')
writeFileSync(OTHER, '{}')
mkdirSync(join(root, 'folder.sgvue'))
writeFileSync(join(root, 'model.ifc'), 'ISO-10303-21;')
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Let the `void …then(…)` the listeners start run to the end. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('projectArgs — the .sgvue paths in an argv', () => {
  it('skips the executable, every switch, a link and anything that is not .sgvue', () => {
    const argv = [
      '/Applications/SGVue.app/Contents/MacOS/SGVue',
      '--allow-file-access-from-files',
      '--original-process-start-time=13379999999999999',
      // A switch whose value happens to be a project's path is still a switch.
      '--log-file=/d/trace.sgvue',
      '--sgvue-link=sgvue://s=abc',
      'sgvue://s=abc',
      '-psn_0_12345',
      '/d/model.ifc',
      '/d/notes.sgvue.txt',
      '/d/Tower A.sgvue',
      '/d/b.SGVUE'
    ]
    expect(projectArgs(argv, '/home', 'darwin')).toEqual(['/d/Tower A.sgvue', '/d/b.SGVUE'])
  })

  it('makes a relative path absolute against the working directory, and drops repeats', () => {
    expect(projectArgs(['electron', '.', 'a.sgvue', './a.sgvue', '../x/b.sgvue'], '/w/app', 'linux')).toEqual([
      '/w/app/a.sgvue',
      '/w/x/b.sgvue'
    ])
  })

  it('reads Windows paths by Windows rules — a drive, a relative path, UNC — and takes off one pair of quotes', () => {
    const argv = [
      'C:\\Program Files\\SGVue\\SGVue.exe',
      '"C:\\Users\\jane\\Documents\\Tower A.sgvue"',
      'review\\b.sgvue',
      '\\\\server\\share\\c.sgvue',
      '--type=renderer'
    ]
    expect(projectArgs(argv, 'C:\\Users\\jane', 'win32')).toEqual([
      'C:\\Users\\jane\\Documents\\Tower A.sgvue',
      'C:\\Users\\jane\\review\\b.sgvue',
      '\\\\server\\share\\c.sgvue'
    ])
  })

  it('refuses an argument with a control character', () => {
    expect(projectArgs(['exe', '/d/a\u0000.sgvue', '/d/b\n.sgvue'], '/', 'darwin')).toEqual([])
  })
})

describe('projectFromArgv — the first .sgvue that is a regular file', () => {
  it('passes over a missing file, a wrong extension and a directory', async () => {
    const argv = ['exe', join(root, 'gone.sgvue'), join(root, 'model.ifc'), join(root, 'folder.sgvue'), TOWER, OTHER]
    expect(await projectFromArgv(argv, root)).toBe(TOWER)
  })

  it('takes the first of several files, in argv order', async () => {
    expect(await projectFromArgv(['exe', OTHER, TOWER], root)).toBe(OTHER)
  })

  it('resolves a relative name against the working directory it is given', async () => {
    expect(await projectFromArgv(['exe', 'Tower A.sgvue'], root)).toBe(TOWER)
  })

  it('is nothing when there is no .sgvue, or a link is there too — the link is deep-link.ts’s', async () => {
    expect(await projectFromArgv(['exe', '--flag', join(root, 'model.ifc')], root)).toBeNull()
    expect(await projectFromArgv(['exe', 'sgvue://s=abc', TOWER], root)).toBeNull()
    expect(await projectFromArgv(['exe', '--sgvue-link=sgvue://s=abc', TOWER], root)).toBeNull()
  })

  it('looks a Windows path up by the platform’s rules, through the given check', async () => {
    const seen: string[] = []
    const isFile = async (p: string): Promise<boolean> => {
      seen.push(p)
      return p.endsWith('b.sgvue')
    }
    expect(await projectFromArgv(['SGVue.exe', 'a.sgvue', 'D:\\b.sgvue'], 'C:\\w', 'win32', isFile)).toBe('D:\\b.sgvue')
    expect(seen).toEqual(['C:\\w\\a.sgvue', 'D:\\b.sgvue'])
  })
})

describe('installProjectLaunch — the OS routes', () => {
  const ensureWindow = vi.fn()
  const argv = process.argv
  beforeEach(() => {
    listeners.clear()
    openProjectFromOS.mockReset()
    ensureWindow.mockReset()
    ready = false
    process.argv = ['exe']
  })
  afterAll(() => {
    process.argv = argv
  })

  it('macOS open-file before ready: handed over (to be parked) and no window forced', async () => {
    installProjectLaunch(ensureWindow)
    const event = { preventDefault: vi.fn() }
    listeners.get('open-file')!(event, TOWER)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(openProjectFromOS).toHaveBeenCalledWith(TOWER)
    expect(ensureWindow).not.toHaveBeenCalled()
  })

  it('macOS open-file after ready: handed over, and a window opened if there is none', () => {
    installProjectLaunch(ensureWindow)
    ready = true
    listeners.get('open-file')!({ preventDefault: vi.fn() }, TOWER)
    expect(openProjectFromOS).toHaveBeenCalledWith(TOWER)
    expect(ensureWindow).toHaveBeenCalledTimes(1)
  })

  it('macOS open-file of anything else is left alone, as it is today', () => {
    installProjectLaunch(ensureWindow)
    ready = true
    const event = { preventDefault: vi.fn() }
    listeners.get('open-file')!(event, join(root, 'model.ifc'))
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(openProjectFromOS).not.toHaveBeenCalled()
    expect(ensureWindow).not.toHaveBeenCalled()
  })

  it('a second launch with a project in its argv hands it over, against its own working directory', async () => {
    installProjectLaunch(ensureWindow)
    listeners.get('second-instance')!({}, ['SGVue.exe', '--some-switch', 'Tower A.sgvue'], root)
    await settle()
    expect(openProjectFromOS).toHaveBeenCalledWith(TOWER)
  })

  it('a second launch with a link, or with nothing, hands nothing over', async () => {
    installProjectLaunch(ensureWindow)
    listeners.get('second-instance')!({}, ['SGVue.exe', 'sgvue://s=abc', TOWER], root)
    listeners.get('second-instance')!({}, ['SGVue.exe'], root)
    await settle()
    expect(openProjectFromOS).not.toHaveBeenCalled()
  })

  it('the first launch’s own argv: a project there is handed over', async () => {
    process.argv = ['SGVue.exe', TOWER]
    installProjectLaunch(ensureWindow)
    await settle()
    expect(openProjectFromOS).toHaveBeenCalledWith(TOWER)
  })
})
