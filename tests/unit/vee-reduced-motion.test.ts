/**
 * Nothing in the Ask Vee window animates under `prefers-reduced-motion: reduce` (2026-11-08). The
 * window's look is `styles/vee.css`; what stops its motion is `styles/design.css`'s one rule,
 * `*{animation-duration:.01ms !important;animation-iteration-count:1 !important;
 * transition-duration:.01ms !important}`, which the window loads first (`vee/main.tsx`). Held here,
 * headless, so a rule added to `vee.css` cannot slip past it:
 *
 *   · the reduced-motion rule is there, `!important` on all three properties;
 *   · no animation or transition in `vee.css` is `!important` — which would win over it;
 *   · none is on a pseudo-element, which `*` does not reach;
 *   · `vee.css` asks for no motion of its own under `prefers-reduced-motion`.
 *
 * What the painter writes under reduced motion — every state at its end — is held by `trace.test.ts`
 * and `vee-answer.test.ts`; the window run checks both together (`vee-trace.spec.ts`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = (name: string): string => readFileSync(join(process.cwd(), 'src/renderer/styles', name), 'utf8')
const design = css('design.css')
const vee = css('vee.css').replace(/\/\*[\s\S]*?\*\//g, '')

/** Each rule of a stylesheet with no nesting: its selector and its declarations. */
const rules = (sheet: string): { selector: string; body: string }[] =>
  [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))

describe('the Ask Vee window holds still under reduced motion', () => {
  it('loads the design’s reduced-motion rule, which ends every animation and transition at once', () => {
    expect(design).toContain(
      '@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}}'
    )
    const entry = readFileSync(join(process.cwd(), 'src/renderer/vee/main.tsx'), 'utf8')
    expect(entry).toContain("import '../styles/design.css'")
    expect(entry.indexOf("import '../styles/design.css'")).toBeLessThan(entry.indexOf("import '../styles/vee.css'"))
  })

  it('has no animation or transition of its own that the rule cannot reach', () => {
    const moving = rules(vee).filter((r) => /(^|;|\s)(animation|transition)[\w-]*\s*:/.test(r.body))
    expect(moving.length).toBeGreaterThan(5)
    for (const r of moving) {
      expect([r.selector, /!important/.test(r.body)]).toEqual([r.selector, false])
      expect([r.selector, /::?(before|after)\b/.test(r.selector)]).toEqual([r.selector, false])
    }
    expect(vee).not.toMatch(/prefers-reduced-motion/)
  })
})
