/**
 * `src/shared/version.ts` — the comparison behind the landing page's update notice
 * (2026-10-01). Semver precedence, and `false` for anything that is not a version.
 */
import { describe, expect, it } from 'vitest'
import { VERSION_MAX_CHARS, isNewer, parseVersion } from '../../src/shared/version'

describe('parseVersion', () => {
  it('reads major.minor.patch, with or without a leading v', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] })
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] })
    expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0, pre: [] })
    expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30, pre: [] })
  })

  it('reads a pre-release as its dot-separated identifiers', () => {
    expect(parseVersion('1.1.0-beta.4')?.pre).toEqual(['beta', '4'])
    expect(parseVersion('v2.0.0-rc.1')?.pre).toEqual(['rc', '1'])
    expect(parseVersion('1.0.0-alpha-1.x')?.pre).toEqual(['alpha-1', 'x'])
    expect(parseVersion('1.0.0-0')?.pre).toEqual(['0'])
  })

  it('accepts build metadata and drops it', () => {
    expect(parseVersion('1.2.3+build.5')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] })
    expect(parseVersion('1.2.3-beta.1+sha.abc123')).toEqual({ major: 1, minor: 2, patch: 3, pre: ['beta', '1'] })
  })

  it.each([
    '',
    'v',
    '1',
    '1.2',
    '1.2.3.4',
    '1.2.x',
    'latest',
    'release-1.2.3',
    '1.2.3 ',
    ' 1.2.3',
    'V1.2.3',
    'vv1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-',
    '1.2.3-beta..1',
    '1.2.3-beta.01',
    '1.2.3+',
    '1.2.3-beta_1',
    '1.2.3\n',
    '-1.2.3',
    '1.2.3-β',
    // A number that cannot be compared exactly is not a version to act on.
    '99999999999999999999.0.0'
  ])('refuses %j', (text) => {
    expect(parseVersion(text)).toBeNull()
  })

  it('refuses anything longer than the cap, before it looks at it', () => {
    const long = '1.2.3-' + 'a'.repeat(VERSION_MAX_CHARS)
    expect(long.length).toBeGreaterThan(VERSION_MAX_CHARS)
    expect(parseVersion(long)).toBeNull()
    // …and exactly at the cap it is still read.
    const atCap = '1.2.3-' + 'a'.repeat(VERSION_MAX_CHARS - 6)
    expect(atCap).toHaveLength(VERSION_MAX_CHARS)
    expect(parseVersion(atCap)).not.toBeNull()
    // A megabyte of digits and dots costs nothing: it is refused on its length.
    const t0 = performance.now()
    expect(parseVersion('1.'.repeat(500_000))).toBeNull()
    expect(performance.now() - t0).toBeLessThan(50)
  })

  it('refuses what is not a string at all', () => {
    for (const value of [undefined, null, 123, {}, ['1.2.3']]) {
      expect(parseVersion(value as unknown as string)).toBeNull()
    }
  })
})

describe('isNewer — semver precedence', () => {
  it.each([
    // latest, current, newer?
    ['1.1.0', '1.1.0', false],
    ['v1.1.0', '1.1.0', false],
    ['1.1.1', '1.1.0', true],
    ['1.1.0', '1.1.1', false],
    ['1.2.0', '1.1.9', true],
    ['1.1.9', '1.2.0', false],
    ['2.0.0', '1.99.99', true],
    ['1.99.99', '2.0.0', false],
    // Numbers, not text: 10 is after 9.
    ['1.10.0', '1.9.0', true],
    ['1.0.10', '1.0.9', true],
    ['10.0.0', '9.0.0', true],
    ['v1.2.0', '1.1.0', true],
    ['1.2.0', 'v1.1.0', true],
    // A pre-release is older than its release.
    ['1.1.0', '1.1.0-beta.4', true],
    ['1.1.0-beta.4', '1.1.0', false],
    // …and newer than the release before it.
    ['1.2.0-beta.1', '1.1.0', true],
    ['1.1.0', '1.2.0-beta.1', false],
    // Numeric identifiers by value: beta.10 is after beta.2.
    ['1.1.0-beta.10', '1.1.0-beta.2', true],
    ['1.1.0-beta.2', '1.1.0-beta.10', false],
    ['1.1.0-beta.4', '1.1.0-beta.4', false],
    // A numeric identifier is below an alphanumeric one, and text sorts in ASCII order.
    ['1.0.0-alpha', '1.0.0-1', true],
    ['1.0.0-1', '1.0.0-alpha', false],
    ['1.0.0-beta', '1.0.0-alpha', true],
    ['1.0.0-rc.1', '1.0.0-beta.11', true],
    // With every shared identifier equal, the longer list is the newer.
    ['1.0.0-alpha.1', '1.0.0-alpha', true],
    ['1.0.0-alpha', '1.0.0-alpha.1', false],
    // Build metadata is ignored.
    ['1.1.0+build.9', '1.1.0', false],
    ['1.1.0', '1.1.0+build.9', false],
    ['1.1.1+a', '1.1.0+z', true]
  ])('isNewer(%j, %j) is %j', (latest, current, expected) => {
    expect(isNewer(latest, current)).toBe(expected)
  })

  it('follows the whole of semver’s own example chain', () => {
    // semver.org §11.4: each is older than the next.
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0'
    ]
    for (let i = 0; i < chain.length; i++) {
      for (let j = 0; j < chain.length; j++) {
        expect([chain[j], chain[i], isNewer(chain[j], chain[i])]).toEqual([chain[j], chain[i], j > i])
      }
    }
  })

  it('compares numeric pre-release identifiers exactly, however long', () => {
    expect(isNewer('1.0.0-90071992547409931', '1.0.0-90071992547409930')).toBe(true)
    expect(isNewer('1.0.0-90071992547409930', '1.0.0-90071992547409931')).toBe(false)
  })

  it('is false when either side cannot be read', () => {
    expect(isNewer('garbage', '1.0.0')).toBe(false)
    expect(isNewer('2.0.0', 'garbage')).toBe(false)
    expect(isNewer('', '')).toBe(false)
    expect(isNewer('2.0.0', '')).toBe(false)
    expect(isNewer('9'.repeat(100), '1.0.0')).toBe(false)
  })
})
