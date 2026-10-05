/**
 * The clipboard, truthfully — 2026-10-02.
 *
 * Measured in a guarded run of the built app (Electron 44.3.0 / Chromium 152;
 * `docs/DECISIONS.md` has the table): `navigator.clipboard.writeText` is refused in this app
 * always — main denies every permission request — so "copy link to this state" and the
 * property card's Copy flashed `link copied` and `Copied` over a clipboard that had not
 * changed. Both treated a rejected write as success.
 *
 * What is held here: `copyText` (`src/renderer/clipboard.ts`) resolves `true` only when the
 * text reached the clipboard — by the async API, or by the design's own fallback, a selected
 * textarea and `execCommand('copy')`, which Chromium allows only under user activation — and
 * the two controls flash on that and on nothing else. That the fallback really writes from a
 * click, and really does not without one, is the e2e's to show (`consent-gate.spec.ts`): there
 * is no clipboard here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../../src/renderer/clipboard'
import { copyLink, LINK_FLASH_MS } from '../../src/renderer/model/session'
import { CLIPBOARD_REFUSED, COPIED_MS, useShell } from '../../src/renderer/state/shell'
import { resetShell } from './stub-viewer'

/** What the textarea fallback touches of a page, recorded. */
interface FakePage {
  /** What was selected and copied, when `execCommand` said yes. */
  copied: string[]
  /** Every textarea made, so that none is left in the page. */
  made: { value: string; attached: boolean }[]
  focused: number
}

class FakeElement {
  isConnected = true
  constructor(private readonly page: FakePage) {}
  focus(): void {
    this.page.focused++
  }
}

/**
 * A page with a clipboard that refuses the async API, as this app's does. `activation` is
 * whether a click is recent enough for `execCommand('copy')` to be allowed.
 */
function fakePage(activation: boolean, asyncApi: 'refused' | 'works' | 'absent' = 'refused'): FakePage {
  const page: FakePage = { copied: [], made: [], focused: 0 }
  const active = new FakeElement(page)
  let selected: { value: string } | null = null
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('document', {
    activeElement: active,
    createElement: () => {
      const ta = {
        value: '',
        attached: false,
        style: { cssText: '' },
        select: () => void (selected = ta),
        remove: () => void (ta.attached = false)
      }
      page.made.push(ta)
      return ta
    },
    body: { appendChild: (ta: { attached: boolean }) => void (ta.attached = true) },
    execCommand: (command: string) => {
      if (command !== 'copy' || !activation || !selected) return false
      page.copied.push(selected.value)
      return true
    }
  })
  vi.stubGlobal(
    'navigator',
    asyncApi === 'absent'
      ? {}
      : {
          clipboard: {
            writeText: (text: string) =>
              asyncApi === 'works'
                ? (page.copied.push(text), Promise.resolve())
                : Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
          }
        }
  )
  return page
}

beforeEach(() => resetShell())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('copyText — true only when the text is on the clipboard', () => {
  it('uses the async API where it is allowed', async () => {
    const page = fakePage(false, 'works')
    expect(await copyText('one')).toBe(true)
    expect(page.copied).toEqual(['one'])
    // No textarea was needed.
    expect(page.made).toEqual([])
  })

  it('falls back to the design’s textarea when the async API is refused — and that copies, from a click', async () => {
    const page = fakePage(true)
    expect(await copyText('sgvue://s=abc')).toBe(true)
    expect(page.copied).toEqual(['sgvue://s=abc'])
    // The textarea is gone again, and whatever had the focus has it back.
    expect(page.made.map((t) => t.attached)).toEqual([false])
    expect(page.focused).toBe(1)
  })

  it('says no when there was no click to copy from: nothing was written', async () => {
    const page = fakePage(false)
    expect(await copyText('sgvue://s=abc')).toBe(false)
    expect(page.copied).toEqual([])
    expect(page.made.map((t) => t.attached)).toEqual([false])
  })

  it('takes the fallback where there is no async API at all', async () => {
    const page = fakePage(true, 'absent')
    expect(await copyText('x')).toBe(true)
    expect(page.copied).toEqual(['x'])
  })

  it('says no outside a page, rather than throwing', async () => {
    // The unit environment: no `navigator.clipboard`, no `document`.
    expect(await copyText('x')).toBe(false)
  })

  it('says no when the fallback itself throws', async () => {
    const page = fakePage(true)
    ;(document as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('blocked')
    }
    expect(await copyText('x')).toBe(false)
    expect(page.copied).toEqual([])
    expect(page.made.map((t) => t.attached)).toEqual([false])
  })
})

describe('the two copy controls flash only for a copy that happened', () => {
  it('the property card’s Copy: "Copied" for 1 400 ms after a real copy, and never after a refused one', async () => {
    vi.useFakeTimers()
    const refused = fakePage(false)
    expect(await useShell.getState().copyGuid('3Kd8sT0WD0qxL1Hrz0Vabc')).toBe(false)
    // The design flashed here. Nothing is on the clipboard, so nothing says "Copied".
    expect(useShell.getState().copied).toBe(false)
    expect(refused.copied).toEqual([])
    expect(vi.getTimerCount()).toBe(0)

    const page = fakePage(true)
    expect(await useShell.getState().copyGuid('3Kd8sT0WD0qxL1Hrz0Vabc')).toBe(true)
    expect(page.copied).toEqual(['3Kd8sT0WD0qxL1Hrz0Vabc'])
    expect(useShell.getState().copied).toBe(true)
    vi.advanceTimersByTime(COPIED_MS - 1)
    expect(useShell.getState().copied).toBe(true)
    vi.advanceTimersByTime(1)
    expect(useShell.getState().copied).toBe(false)
  })

  it('"copy link to this state": "link copied" for 1 600 ms after a real copy, and never after a refused one', async () => {
    vi.useFakeTimers()
    const refused = fakePage(false)
    expect(await copyLink()).toBe(false)
    expect(useShell.getState().linkCopied).toBe(false)
    expect(refused.copied).toEqual([])
    expect(vi.getTimerCount()).toBe(0)

    const page = fakePage(true)
    expect(await copyLink()).toBe(true)
    expect(page.copied).toHaveLength(1)
    expect(page.copied[0].startsWith('sgvue://s=')).toBe(true)
    expect(useShell.getState().linkCopied).toBe(true)
    vi.advanceTimersByTime(LINK_FLASH_MS - 1)
    expect(useShell.getState().linkCopied).toBe(true)
    vi.advanceTimersByTime(1)
    expect(useShell.getState().linkCopied).toBe(false)
  })
})

/**
 * Phase 4 — the third copy control, the one the gate's review found: `copy csv` under a reply's
 * table called `navigator.clipboard.writeText` directly (the design's own line, `:2029`), which
 * this app always refuses, so it copied nothing. It has no flash to be untruthful with; what it
 * has now is a copy that happens, and one sentence in the panel's status line when it does not.
 */
describe('the chat table’s copy csv', () => {
  const TABLE = {
    groupBy: 'Level',
    rows: [
      { k: 'L1', n: 12, area: 4.5, ids: [1, 2] },
      { k: 'Roof, upper', n: 3, ids: [3] }
    ]
  }
  const CSV = 'Level,count,quantity\n"L1",12,4.50\n"Roof, upper",3,'

  it('puts the table’s CSV on the clipboard from a click, through the app’s own copy', async () => {
    const page = fakePage(true)
    expect(await useShell.getState().copyTable(TABLE)).toBe(true)
    // The text the design's `copyTable` builds (`selectors/chat.ts`, `tableCsv`), by the fallback.
    expect(page.copied).toEqual([CSV])
    expect(useShell.getState().chatErr).toBe('')
  })

  it('says so in the panel when nothing was copied, and takes that back after a copy that worked', async () => {
    const refused = fakePage(false)
    expect(await useShell.getState().copyTable(TABLE)).toBe(false)
    expect(refused.copied).toEqual([])
    expect(useShell.getState().chatErr).toBe(CLIPBOARD_REFUSED)

    const page = fakePage(true)
    expect(await useShell.getState().copyTable(TABLE)).toBe(true)
    expect(page.copied).toEqual([CSV])
    expect(useShell.getState().chatErr).toBe('')
  })

  it('leaves any other sentence in the status line alone', async () => {
    fakePage(true)
    useShell.setState({ chatErr: 'Stopped.' })
    expect(await useShell.getState().copyTable(TABLE)).toBe(true)
    expect(useShell.getState().chatErr).toBe('Stopped.')
  })

  it('is the panel’s one way to copy: the button calls the store, and the refused API is not named there', () => {
    const panel = readFileSync(join(process.cwd(), 'src/renderer/app/ChatPanel.tsx'), 'utf8')
    expect(panel).toMatch(/onClick=\{\(\) => void st\.copyTable\(message!\.table!\)\}/)
    expect(panel).not.toMatch(/navigator\s*\.\s*clipboard|execCommand/)
  })
})
