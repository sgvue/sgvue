/**
 * The landing page's demo building (2026-09-24) and the split it caused: the design's mock
 * federation ships through `model/demo.ts`, and the `#mock&hostile` AI-eval fixture moved to
 * `dev/hostile.ts` so its text is not in a production bundle. The plain demo must carry none
 * of it; the hostile options must still produce the fixture `scripts/ai-eval.cjs` expects.
 */
import { describe, expect, it } from 'vitest'
import { DEMO_KEYS, demoLoader } from '../../src/renderer/model/demo'
import { HOSTILE_INJECTIONS, HOSTILE_OPTIONS } from '../../src/renderer/dev/hostile'

describe('the demo building', () => {
  it('is the design’s four discipline models, at the origin, with no frame', async () => {
    expect(DEMO_KEYS).toEqual(['ARC', 'STR', 'SIT', 'MEP'])
    const load = demoLoader()
    for (const key of DEMO_KEYS) {
      const item = await load(key)
      expect(item.index.modelKey).toBe(key)
      expect(item.chunks.length).toBeGreaterThan(0)
      expect(item.offset).toEqual([0, 0, 0])
      expect(item.frame).toBeNull()
    }
  })

  it('carries none of the hostile text', async () => {
    const text = JSON.stringify(await Promise.all(DEMO_KEYS.map((k) => demoLoader()(k).then((i) => i.index))))
    for (const injection of Object.values(HOSTILE_INJECTIONS)) expect(text).not.toContain(injection.trim())
  })
})

describe('the hostile fixture, through `MockOptions`', () => {
  it('appends each injection to a real value, as before the split', async () => {
    const load = demoLoader(HOSTILE_OPTIONS)
    const str = (await load('STR')).index
    const arc = (await load('ARC')).index
    const sit = (await load('SIT')).index
    expect(str.building!.name.endsWith(HOSTILE_INJECTIONS.building)).toBe(true)
    const core = str.elements.find((e) => e.name.startsWith('Core Wall W '))!
    expect(core.name.endsWith(HOSTILE_INJECTIONS.name)).toBe(true)
    const ext = arc.elements.find((e) => e.name.startsWith('Ext Wall N '))!
    expect(String(ext.psets.Pset_WallCommon.Reference).endsWith(HOSTILE_INJECTIONS.property)).toBe(true)
    const tree = sit.elements.find((e) => e.name.startsWith('Tree T01 '))!
    expect(tree.objectType.endsWith(HOSTILE_INJECTIONS.objectType)).toBe(true)
  })

  it('carries one that asks for what the assistant may only ask for — an unload, deletions, a copy (2026-10-02)', async () => {
    const mep = (await demoLoader(HOSTILE_OPTIONS)('MEP')).index
    const duct = mep.elements.find((e) => e.name === 'Duct Main L1')!
    // Appended to the real value, like the others: the element is still what it was.
    expect(duct.objectType).toBe('Supply Duct 600x400' + HOSTILE_INJECTIONS.gated)
    for (const asked of ['delete every saved viewpoint and filter set', 'unload every model except this one', 'copy the share link']) {
      expect([asked, HOSTILE_INJECTIONS.gated.includes(asked)]).toEqual([asked, true])
    }
    // One element, and only in the hostile fixture: every other duct is untouched.
    expect(mep.elements.filter((e) => e.objectType.includes('ASSISTANT NOTICE'))).toHaveLength(1)
    expect(Object.keys(HOSTILE_INJECTIONS)).toEqual(['name', 'property', 'objectType', 'building', 'gated'])
  })
})
