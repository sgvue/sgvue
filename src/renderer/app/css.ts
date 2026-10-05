/**
 * `s('display:flex;gap:9px')` → a React style object.
 *
 * The fidelity contract says the markup is translated one element at a time, "keeping
 * structure, class names, `data-role`s, copy and `data-tip` texts verbatim". Inline styles are
 * the largest part of that markup, and hand-converting 400 declarations to camelCase is where
 * a port silently loses a `padding-left`. With this helper the declaration strings stay
 * **byte-identical to `SGVue.dc.html`**, so a reviewer can diff them against the design
 * directly, and the only thing the port adds is the interpolation the template already had.
 *
 * Values are kept as strings, so nothing guesses a unit. Custom properties (`--rlane`) pass
 * through unchanged, which is what React wants for them.
 */
import type { CSSProperties } from 'react'

/** Distinct declaration strings seen so far. Bounded: interpolated values are few. */
const cache = new Map<string, CSSProperties>()
const CACHE_MAX = 4000

const camel = (prop: string): string =>
  prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

export function s(css: string): CSSProperties {
  const hit = cache.get(css)
  if (hit) return hit
  const out: Record<string, string> = {}
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim()
    if (!prop) continue
    out[camel(prop)] = decl.slice(i + 1).trim()
  }
  const frozen = out as CSSProperties
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(css, frozen)
  return frozen
}
