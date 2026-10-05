/**
 * Version strings, read the way semver reads them (2026-10-01) — what the launch-time update
 * check compares (`main/updates.ts`). Pure: no Electron, no I/O.
 */

/** The longest text `parseVersion` looks at. A real tag is about a dozen characters. */
export const VERSION_MAX_CHARS = 64

export interface Version {
  major: number
  minor: number
  patch: number
  /** The pre-release identifiers (`beta`, `1`), in order; empty for a release. */
  pre: readonly string[]
}

/**
 * `MAJOR.MINOR.PATCH`, an optional `-pre.release` and optional `+build` metadata, with an
 * optional leading `v`. Every repeated group is a character class that excludes the separator
 * after it, so there is one way to match any input and nothing to backtrack over.
 */
const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const NUMERIC = /^\d+$/

/**
 * `1.2.3` or `v1.2.3`, with an optional pre-release (`-beta.1`) and optional build metadata
 * (`+…`, which semver ignores for precedence and so is dropped). Anything else is `null`: a
 * leading zero, a missing part, stray text, a number too large to compare exactly, or more than
 * `VERSION_MAX_CHARS` characters — checked first, before any pattern runs.
 */
export function parseVersion(text: string): Version | null {
  if (typeof text !== 'string' || text.length > VERSION_MAX_CHARS) return null
  const m = SEMVER.exec(text)
  if (!m) return null
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  const pre = m[4] ? m[4].split('.') : []
  // Semver §9: a numeric identifier has no leading zero.
  if (pre.some((id) => NUMERIC.test(id) && id.length > 1 && id[0] === '0')) return null
  return { major, minor, patch, pre }
}

/** Semver §11.4: numeric below alphanumeric; numbers by value; the rest in ASCII order. */
function comparePre(a: string, b: string): number {
  const [na, nb] = [NUMERIC.test(a), NUMERIC.test(b)]
  if (na && nb) {
    // No leading zeros, so the longer run of digits is the larger number — exact at any size.
    if (a.length !== b.length) return a.length - b.length
    return a < b ? -1 : a > b ? 1 : 0
  }
  if (na !== nb) return na ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semver precedence: negative when `a` is older than `b`, positive when newer, 0 when equal. */
function compare(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  // §11.3: a pre-release is older than its release.
  if (!a.pre.length || !b.pre.length) return (a.pre.length ? 0 : 1) - (b.pre.length ? 0 : 1)
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const c = comparePre(a.pre[i], b.pre[i])
    if (c) return c
  }
  // §11.4.4: with every shared identifier equal, the longer list is the newer.
  return a.pre.length - b.pre.length
}

/** Is `latest` a newer version than `current`? `false` when either cannot be read. */
export function isNewer(latest: string, current: string): boolean {
  const [a, b] = [parseVersion(latest), parseVersion(current)]
  return !!a && !!b && compare(a, b) > 0
}
