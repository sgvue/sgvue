/**
 * `src/main/deep-link.ts` — the argv parser and the `second-instance` handler.
 *
 * `electron` is mocked down to the one thing the module touches, `app.on`, whose listeners the
 * test then fires itself; `main/window.ts`'s `mainWindow()` answers with a stand-in window that
 * records what was asked of it (since 2026-09-25 a link goes to the main window by name, never
 * to whichever window was created first). macOS `open-url` is the same `deliver`, so the
 * window behaviour below is what it does too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The listeners `installDeepLinks()` registered, by event name. */
const listeners = new Map<string, (...args: unknown[]) => void>()

/** A window the module can find, or none. */
class FakeWindow {
  minimized = false
  loading = false
  restored = 0
  focused = 0
  sent: { channel: string; payload: unknown }[] = []
  webContents = {
    isLoading: (): boolean => this.loading,
    send: (channel: string, payload: unknown): void => {
      this.sent.push({ channel, payload })
    }
  }
  isMinimized = (): boolean => this.minimized
  restore = (): void => {
    this.minimized = false
    this.restored++
  }
  focus = (): void => {
    this.focused++
  }
}

let windows: FakeWindow[] = []

vi.mock('electron', () => ({
  app: {
    on: (event: string, fn: (...args: unknown[]) => void) => listeners.set(event, fn)
  }
}))
vi.mock('../../src/main/window', () => ({ mainWindow: () => windows[0] }))

const { installDeepLinks, launchHash, linkFromArgv } = await import('../../src/main/deep-link')
const { CH_LINK_OPEN } = await import('../../src/shared/ipc-contract')
const { payloadFromLink } = await import('../../src/shared/session-codec')

const LINK = 'sgvue://s=eyJtb2RlbHMiOltdfQ'

/** Windows' second launch, as Electron reports it to the instance holding the lock. */
function secondInstance(argv: readonly string[]): void {
  const fn = listeners.get('second-instance')
  if (!fn) throw new Error('installDeepLinks registered no second-instance listener')
  fn({}, [...argv], process.cwd())
}

beforeEach(() => {
  listeners.clear()
  windows = []
  delete process.env.SGVUE_LINK
  installDeepLinks()
})

describe('linkFromArgv', () => {
  it('finds a bare `sgvue://` argument, which is how Windows hands one over', () => {
    expect(linkFromArgv(['SGVue.exe', LINK])).toBe(LINK)
  })

  it('finds the `sgvue:s=…` form Windows produces when there is no authority', () => {
    expect(linkFromArgv(['SGVue.exe', 'sgvue:s=abc'])).toBe('sgvue:s=abc')
  })

  it('finds the development hook’s `--sgvue-link=`', () => {
    expect(linkFromArgv(['electron', '.', `--sgvue-link=${LINK}`])).toBe(LINK)
  })

  it('is null when nothing in the argv is a link', () => {
    expect(linkFromArgv(['SGVue.exe', '--user-data-dir=C:\\tmp\\p'])).toBeNull()
    // The flag is only a link when what it carries is one.
    expect(linkFromArgv(['SGVue.exe', '--sgvue-link=https://example.com/s=abc'])).toBeNull()
  })
})

/**
 * What of a launch link reaches `location.hash`. Everything after the payload is dropped,
 * because the hash is also where the dev build's own switches live — `#backend=webgpu` in a
 * link would have asked a cold start for the backend 2026-09-17 refused it.
 */
describe('launchHash', () => {
  const CODE = 'eyJtb2RlbHMiOltdfQ'

  it('keeps the payload of a bare `sgvue://s=…` link, and nothing around it', () => {
    expect(launchHash(LINK)).toBe(`s=${CODE}`)
  })

  it('keeps the payload of the `sgvue:s=…` form Windows produces', () => {
    expect(launchHash(`sgvue:s=${CODE}`)).toBe(`s=${CODE}`)
  })

  it('drops a backend switch appended to the link', () => {
    expect(launchHash(`${LINK}&backend=webgpu`)).toBe(`s=${CODE}`)
  })

  it('drops a trailing `#x`, `?x` and `/`, which an OS may hand over', () => {
    expect(launchHash(`${LINK}#x`)).toBe(`s=${CODE}`)
    expect(launchHash(`${LINK}?x`)).toBe(`s=${CODE}`)
    expect(launchHash(`${LINK}/`)).toBe(`s=${CODE}`)
  })

  it('tolerates surrounding whitespace, exactly as `payloadFromLink` does', () => {
    expect(launchHash(`  ${LINK}\n`)).toBe(`s=${CODE}`)
  })

  it('is empty for anything that is not a link, and for no link at all', () => {
    expect(launchHash(null)).toBe('')
    expect(launchHash('')).toBe('')
    expect(launchHash('https://example.com/s=abc')).toBe('')
    expect(launchHash('sgvue://backend=webgpu')).toBe('')
    // The scheme without a payload carries nothing, so nothing travels.
    expect(launchHash('sgvue://')).toBe('')
  })

  it('accepts exactly what `payloadFromLink` accepts', () => {
    for (const url of [LINK, `sgvue:s=${CODE}`, `${LINK}&backend=webgpu`, `  ${LINK} `]) {
      expect(launchHash(url)).toBe(`s=${CODE}`)
      expect(payloadFromLink(url)).toEqual({ models: [] })
    }
    for (const url of ['https://example.com/s=abc', 'sgvue://backend=webgpu', 'not a link']) {
      expect(launchHash(url)).toBe('')
      expect(payloadFromLink(url)).toBeNull()
    }
  })
})

describe('a second launch', () => {
  it('brings a minimised window forward when the argv carries no link', () => {
    const win = new FakeWindow()
    win.minimized = true
    windows = [win]
    secondInstance(['SGVue.exe'])
    expect(win.restored).toBe(1)
    expect(win.minimized).toBe(false)
    expect(win.focused).toBe(1)
    expect(win.sent).toEqual([])
  })

  it('focuses a window that is not minimised, and restores nothing', () => {
    const win = new FakeWindow()
    windows = [win]
    secondInstance(['SGVue.exe'])
    expect(win.restored).toBe(0)
    expect(win.focused).toBe(1)
  })

  it('sends the link and brings the window forward when the argv carries one', () => {
    const win = new FakeWindow()
    win.minimized = true
    windows = [win]
    secondInstance(['SGVue.exe', LINK])
    expect(win.sent).toEqual([{ channel: CH_LINK_OPEN, payload: { url: LINK } }])
    expect(win.restored).toBe(1)
    expect(win.focused).toBe(1)
  })

  it('parks a link rather than sending it into a window that is still loading', () => {
    const win = new FakeWindow()
    win.loading = true
    windows = [win]
    secondInstance(['SGVue.exe', LINK])
    expect(win.sent).toEqual([])
    expect(win.focused).toBe(0)
  })

  it('does nothing, and throws nothing, when there is no window', () => {
    expect(() => secondInstance(['SGVue.exe'])).not.toThrow()
    expect(() => secondInstance(['SGVue.exe', LINK])).not.toThrow()
  })
})
