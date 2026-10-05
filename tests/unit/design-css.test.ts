/**
 * `src/renderer/styles/design.css` is the design's own `<style>` block.
 *
 * The fidelity contract (`CLAUDE.md`, "Port, don't redesign"): *the `<style>` block is copied
 * as-is.* Tokens, both themes, the resets, the keyframes and the tooltip are all in it, so one
 * edited value there moves every surface at once — and nothing checked that the copy still was
 * one. This holds it to the design, line for line.
 *
 * **Less exactly three lines, whose removal is a recorded decision** (`docs/DECISIONS.md`,
 * 2026-10-01 — "the chat panel has a stop control…": *the busy row is gone with what only it
 * used*): the keyframes `ifctrace`, `ifcbreathe` and `ifcdot`, which animated the design's busy
 * row. That row is the assistant's live reply now, and nothing names them. Leaving a fourth line
 * out, or putting one of these back, is a decision to record there first — and then here.
 *
 * Line endings are normalised, because a Windows checkout holds CRLF; nothing else is. The block
 * is found by its tags, not by a line number.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n')

const DESIGN = 'design-reference/design/SGVue.dc.html'
const PORT = 'src/renderer/styles/design.css'

/** The keyframes the port does not carry — the complete list. */
const REMOVED_KEYFRAMES = ['ifctrace', 'ifcbreathe', 'ifcdot'] as const

const removed = (line: string): boolean => REMOVED_KEYFRAMES.some((name) => line.startsWith(`@keyframes ${name}{`))

/** The lines between `<style>` and `</style>`: the tag's own line and the closing tag's are not the block's. */
function styleBlock(html: string): string[] {
  const open = html.indexOf('<style>')
  const close = html.indexOf('</style>')
  if (open < 0 || close < open) throw new Error(`${DESIGN} has no <style> block`)
  const lines = html.slice(open + '<style>'.length, close).split('\n')
  // Nothing follows `<style>` on its line and nothing precedes `</style>` on its own.
  if (lines[0] !== '' || lines.at(-1) !== '') throw new Error(`${DESIGN}: the <style> tags no longer stand on lines of their own`)
  return lines.slice(1, -1)
}

/** The first line at which the port and the design part ways, in words — or null when they do not. */
function firstDifference(port: readonly string[], design: readonly string[]): string | null {
  const n = Math.max(port.length, design.length)
  for (let i = 0; i < n; i++) {
    if (port[i] === design[i]) continue
    const show = (line: string | undefined): string => (line === undefined ? '(no such line)' : line)
    return `line ${i + 1} of ${PORT} is not the design's:\n  port:   ${show(port[i])}\n  design: ${show(design[i])}`
  }
  return null
}

describe('design.css', () => {
  const html = read(DESIGN)
  const css = read(PORT)

  it('is the design’s <style> block, less exactly the three keyframes whose removal is recorded', () => {
    // One block, so "the design's style block" names one thing.
    expect(html.split('<style').length - 1).toBe(1)
    const design = styleBlock(html)
    // The file ends with one newline, as the block's last line does.
    const port = css.split('\n')
    expect(port.at(-1)).toBe('')

    const difference = firstDifference(port.slice(0, -1), design.filter((line) => !removed(line)))
    expect(difference, difference ?? '').toBeNull()
  })

  it('leaves out each of the three once: all are in the design, on a line of their own, and none is in the port', () => {
    const design = styleBlock(html)
    for (const name of REMOVED_KEYFRAMES) {
      const lines = design.filter((line) => line.includes(`@keyframes ${name}`))
      expect([name, lines.length, lines.every(removed)]).toEqual([name, 1, true])
      expect([name, css.includes(name)]).toEqual([name, false])
    }
    expect(design.filter(removed)).toHaveLength(REMOVED_KEYFRAMES.length)
    expect(design.length - css.split('\n').slice(0, -1).length).toBe(REMOVED_KEYFRAMES.length)
  })

  it('…and the comparison has teeth: it names the first line that differs, is missing or was added', () => {
    const design = ['a{color:red}', 'b{color:blue}', 'c{color:green}']
    expect(firstDifference(design, design)).toBeNull()
    expect(firstDifference(['a{color:red}', 'b{color:navy}', 'c{color:green}'], design)).toBe(
      `line 2 of ${PORT} is not the design's:\n  port:   b{color:navy}\n  design: b{color:blue}`
    )
    // A line left out of the port shows as the line that took its place…
    expect(firstDifference(['a{color:red}', 'c{color:green}'], design)).toBe(
      `line 2 of ${PORT} is not the design's:\n  port:   c{color:green}\n  design: b{color:blue}`
    )
    // …and one added at the end, or missing from it, as a line with nothing opposite.
    expect(firstDifference([...design, 'd{color:black}'], design)).toBe(
      `line 4 of ${PORT} is not the design's:\n  port:   d{color:black}\n  design: (no such line)`
    )
    expect(firstDifference(design.slice(0, 2), design)).toBe(
      `line 3 of ${PORT} is not the design's:\n  port:   (no such line)\n  design: c{color:green}`
    )
    // A keyframe is left out only by its own name: a fourth is a difference.
    expect(removed('@keyframes ifctrace{0%{stroke-dashoffset:40}}')).toBe(true)
    expect(removed('@keyframes ifcpulse{0%,100%{opacity:.55}50%{opacity:1}}')).toBe(false)
    expect(removed('@keyframes ifcdotted{}')).toBe(false)
  })
})
