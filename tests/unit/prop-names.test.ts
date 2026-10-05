/**
 * Property names as the user says them, against the file's — 2026-09-28. The owner: "it never
 * check the shared parameters Includes As GFA."
 *
 * The one rule that must never slip: a name is rewritten only when the rewrite is certain —
 * the exact key, or the one key that differs by case, spacing or punctuation alone. Anything
 * merely *similar* is offered, ranked, never chosen.
 */
import { describe, expect, it } from 'vitest'
import {
  ambiguousText,
  booleanSpelling,
  booleanWord,
  editDistance,
  keyTokens,
  nearestKeys,
  normKey,
  rankKeys,
  resolveKey
} from '../../src/shared/prop-names'

/** A realistic slice of a Revit export's names, with the shared parameter near the end. */
const KEYS = [
  'Model',
  'IfcEntity',
  'Level',
  'Name',
  'Reference',
  'IsExternal',
  'FireRating',
  'GrossArea',
  'NetArea',
  'Area',
  'GFA',
  'GFA Category',
  'Includes As GFA',
  'Unit Type',
  'Comments'
]

describe('normKey and keyTokens', () => {
  it('keeps letters and digits only, lower-cased', () => {
    expect(normKey('Includes As GFA')).toBe('includesasgfa')
    expect(normKey('Fire_Rating')).toBe('firerating')
    expect(normKey('Pset_WallCommon.FireRating')).toBe('psetwallcommonfirerating')
    expect(normKey('Längen-Maß 2')).toBe('längenmaß2')
    expect(normKey(' — ')).toBe('')
  })

  it('splits camelCase, acronyms, digits and punctuation into words', () => {
    expect(keyTokens('includesGFA')).toEqual(['includes', 'gfa'])
    expect(keyTokens('IncludesAsGFA')).toEqual(['includes', 'as', 'gfa'])
    expect(keyTokens('Includes As GFA')).toEqual(['includes', 'as', 'gfa'])
    expect(keyTokens('GFAArea2')).toEqual(['gfa', 'area', '2'])
    expect(keyTokens('Fire_Rating')).toEqual(['fire', 'rating'])
  })

  it('measures edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('same', 'same')).toBe(0)
  })
})

describe('resolveKey', () => {
  it('takes the exact key first', () => {
    expect(resolveKey('FireRating', KEYS)).toEqual({ key: 'FireRating', candidates: [] })
  })

  it('takes the one key that differs by case, spaces, underscores or punctuation alone', () => {
    for (const asked of ['includes as gfa', 'IncludesAsGFA', 'Includes_As_GFA', 'INCLUDES-AS-GFA']) {
      expect([asked, resolveKey(asked, KEYS).key]).toEqual([asked, 'Includes As GFA'])
    }
    expect(resolveKey('Fire_Rating', KEYS).key).toBe('FireRating')
    expect(resolveKey('fire rating', KEYS).key).toBe('FireRating')
    expect(resolveKey('level', KEYS).key).toBe('Level')
  })

  it('never resolves to a merely similar key — includesGFA is not Includes As GFA', () => {
    expect(resolveKey('includesGFA', KEYS)).toEqual({ key: null, candidates: [] })
    expect(resolveKey('FireRatings', KEYS)).toEqual({ key: null, candidates: [] })
    expect(resolveKey('Gross Areas', KEYS).key).toBeNull()
  })

  it('chooses between two keys that normalise alike never, and returns both', () => {
    const keys = [...KEYS, 'Fire Rating']
    expect(resolveKey('fire_rating', keys)).toEqual({
      key: null,
      candidates: ['FireRating', 'Fire Rating']
    })
    // Exact still wins over the ambiguity.
    expect(resolveKey('Fire Rating', keys).key).toBe('Fire Rating')
  })

  it('reads Pset.Key and Pset:Key, trying the whole name before the part after a separator', () => {
    expect(resolveKey('Pset_WallCommon.FireRating', KEYS).key).toBe('FireRating')
    expect(resolveKey('SGPset_Area:Includes As GFA', KEYS).key).toBe('Includes As GFA')
    expect(resolveKey('SGPset_Area.includes as gfa', KEYS).key).toBe('Includes As GFA')
    // A key that itself holds a dot is found whole, not cut.
    const dotted = [...KEYS, 'Thickness.LowerBound', 'LowerBound']
    expect(resolveKey('Thickness.LowerBound', dotted).key).toBe('Thickness.LowerBound')
    expect(resolveKey('Pset_X.Thickness.LowerBound', dotted).key).toBe('Thickness.LowerBound')
    expect(resolveKey('Pset_WallCommon.NoSuch', KEYS).key).toBeNull()
  })

  it('resolves nothing from an empty or punctuation-only name', () => {
    expect(resolveKey('', KEYS)).toEqual({ key: null, candidates: [] })
    expect(resolveKey('—', KEYS)).toEqual({ key: null, candidates: [] })
  })
})

describe('rankKeys and nearestKeys', () => {
  it('puts "Includes As GFA" first for includesGFA, ahead of GFA and its neighbours', () => {
    const ranked = rankKeys('includesGFA', KEYS)
    expect(ranked[0]).toEqual({ key: 'Includes As GFA', match: 'contains' })
    // Keys that share only part of the name come next, and are called partial.
    expect(ranked.slice(1, 3).map((r) => r.key).sort()).toEqual(['GFA', 'GFA Category'])
    expect(ranked[1].match).toBe('partial')
    expect(nearestKeys('includesGFA', KEYS, 3)[0]).toBe('Includes As GFA')
  })

  it('ranks exact, normalised, contains, partial, spelling — in that order', () => {
    expect(rankKeys('Area', KEYS)[0]).toEqual({ key: 'Area', match: 'exact' })
    expect(rankKeys('area', KEYS)[0]).toEqual({ key: 'Area', match: 'normalised' })
    const area = rankKeys('area', KEYS)
    expect(area.slice(1, 3).map((r) => r.match)).toEqual(['contains', 'contains'])
    // Among the keys that contain it, the nearer spelling first: NetArea before GrossArea.
    expect(area.slice(1, 3).map((r) => r.key)).toEqual(['NetArea', 'GrossArea'])
    expect(rankKeys('zzzz', KEYS).every((r) => r.match === 'spelling')).toBe(true)
  })

  it('is deterministic whatever order the keys come in', () => {
    const shuffled = [...KEYS].reverse()
    for (const asked of ['includesGFA', 'area', 'fire', 'zzzz', 'type']) {
      expect([asked, rankKeys(asked, shuffled)]).toEqual([asked, rankKeys(asked, KEYS)])
    }
  })

  it('breaks a tie by the shorter key, then by plain string order', () => {
    // All three are spelling-only; Aq and Bq tie on distance and length, so string order decides,
    // and Aqq — one edit further — comes last.
    expect(rankKeys('zz', ['Bq', 'Aq', 'Aqq']).map((r) => r.key)).toEqual(['Aq', 'Bq', 'Aqq'])
  })

  it('returns no more than asked for, and nothing twice', () => {
    expect(nearestKeys('area', [...KEYS, ...KEYS], 4)).toHaveLength(4)
    expect(new Set(nearestKeys('area', [...KEYS, ...KEYS], 20)).size).toBe(KEYS.length)
  })
})

describe('yes / no values', () => {
  it('knows the spellings of yes and no, in any case', () => {
    for (const t of ['Yes', 'TRUE', 'y', '1', 'T', '.T.', '✓', true, 1]) expect([t, booleanWord(t)]).toEqual([t, true])
    for (const f of ['no', 'False', 'N', '0', 'f', '.f.', '✗', false, 0]) expect([f, booleanWord(f)]).toEqual([f, false])
    for (const x of ['maybe', '2', '', 'yes please']) expect([x, booleanWord(x)]).toEqual([x, null])
  })

  it('maps a yes/no to the one spelling the key stores for it', () => {
    expect(booleanSpelling('Yes', ['true', 'false'])).toBe('true')
    expect(booleanSpelling('no', ['true', 'false'])).toBe('false')
    expect(booleanSpelling('1', ['true', 'false'])).toBe('true')
    expect(booleanSpelling('true', ['Yes', 'No'])).toBe('Yes')
    expect(booleanSpelling('.F.', ['Yes', 'No'])).toBe('No')
  })

  it('leaves the value alone when it already matches, or the key is not a yes/no', () => {
    // matchFn compares case-insensitively, so TRUE already finds `true`.
    expect(booleanSpelling('TRUE', ['true', 'false'])).toBeNull()
    // A text key that happens to hold "Yes" among other things is not a yes/no.
    expect(booleanSpelling('y', ['Yes', 'No', 'Partly'])).toBeNull()
    expect(booleanSpelling('maybe', ['true', 'false'])).toBeNull()
    // Two spellings of yes: no guess between them.
    expect(booleanSpelling('y', ['Yes', 'true', 'No'])).toBeNull()
    // Nothing stored at all.
    expect(booleanSpelling('yes', [])).toBeNull()
  })
})

/* ────────────────────────────── 2026-09-28 review follow-ups ────────────────────────────── */

describe('review follow-ups', () => {
  it('counts stored yes/no spellings case-insensitively — true from one model, True from another', () => {
    expect(booleanSpelling('Yes', ['true', 'True', 'false'])).toBe('true')
    expect(booleanSpelling('no', ['True', 'FALSE', 'false'])).toBe('FALSE')
    // Two different words for yes are still two, whatever their case.
    expect(booleanSpelling('y', ['Yes', 'true', 'TRUE', 'No'])).toBeNull()
  })

  it('says a name is two names, and asks which', () => {
    expect(ambiguousText('fire rating', ['FireRating', 'Fire_Rating'])).toBe(
      '"fire rating" matches two names, FireRating and Fire_Rating — say which.'
    )
    expect(ambiguousText('a b', ['AB', 'A_B', 'a-b'])).toBe('"a b" matches three names, AB, A_B and a-b — say which.')
    const many = Array.from({ length: 10 }, (_, i) => `K${'_'.repeat(i)}`)
    expect(ambiguousText('k', many)).toMatch(/^"k" matches 10 names, K, K_, .* and K_{7}, … — say which\.$/)
  })
})
