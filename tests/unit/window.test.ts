/**
 * `src/main/window.ts` — the navigation lock (S3).
 *
 * The window loads the app's own `index.html` and never leaves it: a link, a `location.href`
 * or a dropped URL is refused, a `<webview>` is never attached and no second window opens. The
 * one navigation allowed is a same-document hash change — a share link's `#s=…`.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {} }))

const { isSameDocument, lockNavigation } = await import('../../src/main/window')

const APP = 'file:///C:/Program%20Files/SGVue/resources/app.asar/out/renderer/index.html'

describe('isSameDocument', () => {
  it('allows the page itself, with or without a different hash', () => {
    expect(isSameDocument(APP, APP)).toBe(true)
    expect(isSameDocument(`${APP}#s=abc`, APP)).toBe(true)
    expect(isSameDocument(APP, `${APP}#s=abc`)).toBe(true)
  })

  it('refuses anything else — another page, another file, another scheme, a query', () => {
    for (const target of [
      'https://example.com/',
      'file:///C:/Windows/win.ini',
      'file:///C:/Program%20Files/SGVue/resources/app.asar/out/renderer/other.html',
      `${APP}?backend=webgpu`,
      'sgvue://s=abc',
      'not a url'
    ]) {
      expect([target, isSameDocument(target, APP)]).toEqual([target, false])
    }
  })
})

describe('lockNavigation', () => {
  function contents() {
    let openHandler: ((d: { url: string }) => { action: string }) | null = null
    const wc = Object.assign(new EventEmitter(), {
      getURL: () => APP,
      setWindowOpenHandler: (fn: typeof openHandler) => {
        openHandler = fn
      }
    })
    return { wc, open: (url: string) => openHandler!({ url }) }
  }
  const navigate = (wc: EventEmitter, event: string, url?: string): boolean => {
    let prevented = false
    wc.emit(event, { url, preventDefault: () => (prevented = true) })
    return prevented
  }

  it('prevents a navigation off the page and lets a hash change through', () => {
    const { wc } = contents()
    lockNavigation(wc as never, () => {})
    expect(navigate(wc, 'will-navigate', 'https://example.com/')).toBe(true)
    expect(navigate(wc, 'will-navigate', 'file:///C:/Users/me/evil.html')).toBe(true)
    expect(navigate(wc, 'will-navigate', `${APP}#s=abc`)).toBe(false)
  })

  it('never attaches a webview', () => {
    const { wc } = contents()
    lockNavigation(wc as never, () => {})
    expect(navigate(wc, 'will-attach-webview')).toBe(true)
  })

  it('denies every new window, handing http(s) to the OS browser and nothing else', () => {
    const { wc, open } = contents()
    const external = vi.fn()
    lockNavigation(wc as never, external)
    expect(open('https://example.com/').action).toBe('deny')
    expect(open('file:///C:/x.html').action).toBe('deny')
    expect(external.mock.calls).toEqual([['https://example.com/']])
  })
})
