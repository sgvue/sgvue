/**
 * The frozen v1 corpus — `tests/fixtures/project/v1-synthetic.sgvue`, a format-v1 project on two
 * synthetic models (no real project data or coordinates: the site point is the synthetic set from
 * `CLAUDE.md`'s Rules). Every later build must read it to exactly this state. **Never edit the
 * fixture to make this pass**: a build that cannot read it has broken every v1 project on disk.
 *
 * The two models are opened here in the other order (STR on slot 0, ARC on slot 1) with express
 * ids the file never saw: the state below follows from GlobalIds alone.
 *
 * 2026-11-07 (phase 2, before v1 was released) — a third model, MEP, carries `assigned: true`: a
 * colour the open project gave it (D12), restored as assigned, never as the user's own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fedId, ID_STRIDE } from '../../src/shared/federate'
import { IDENTITY_FRAME_KEY } from '../../src/shared/georef'
import { projectText, readProject, restorePlanOf, type ProjectFederation } from '../../src/shared/project-file'

const FIXTURE = join(__dirname, '../fixtures/project/v1-synthetic.sgvue')
const arc = (n: number): string => 'SynArc' + String(n).padStart(16, '0')
const str = (n: number): string => 'SynStr' + String(n).padStart(16, '0')
const ARC = 'Synthetic ARC'
const STR = 'Synthetic STR'
const MEP = 'Synthetic MEP'

const live: ProjectFederation = {
  models: [
    { meta: { modelKey: STR, sha256: 'b'.repeat(64) } },
    { meta: { modelKey: ARC, sha256: 'a'.repeat(64) } },
    { meta: { modelKey: MEP, sha256: 'c'.repeat(64) } }
  ],
  elements: [
    { id: fedId(0, 201), guid: str(1), model: STR },
    { id: fedId(0, 202), guid: str(2), model: STR },
    ...[1, 2, 3, 4].map((n) => ({ id: fedId(1, 100 + n), guid: arc(n), model: ARC }))
  ]
}

const near = (a: readonly number[], b: readonly number[]): void => {
  expect(a).toHaveLength(b.length)
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(1e-9))
}

describe('the frozen v1 corpus', () => {
  const text = readFileSync(FIXTURE, 'utf8')
  const read = readProject(text)

  it('reads, and reports the model that sits outside the project folder', () => {
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.outside).toEqual(['m2'])
    expect(read.project.savedBy).toBe('SGVue 1.4.0')
    expect(read.project.models.map((m) => [m.id, m.relPath, m.visible, m.colour, m.own, m.assigned])).toEqual([
      ['m1', 'models/Synthetic ARC.ifc', true, '#8A9492', false, undefined],
      ['m2', '../shared/Synthetic STR.ifc', false, '#E8A33D', true, undefined],
      ['m3', 'models/Synthetic MEP.ifc', true, '#7B8CF0', false, true]
    ])
  })

  it('plans exactly this state', () => {
    if (!read.ok) throw new Error(read.message)
    const plan = restorePlanOf(read.project, live, { offset: [12345, 23456, 5] })
    expect(plan.models).toEqual({ m1: ARC, m2: STR, m3: MEP })
    expect(plan.missing).toEqual([])
    expect(plan.unmatched).toEqual({})

    const { cam, views, spots, measures, schedules, openSchedule, ...rest } = plan.state
    expect(rest).toEqual({
      hidden: { [fedId(1, 101)]: true, [fedId(1, 102)]: true, [fedId(0, 201)]: true },
      storeyVis: { L2: false, Roof: true },
      modelVis: { [STR]: false },
      active: ARC,
      // ARC's grey is what its row showed, not the user's: not applied. STR's is the user's own.
      modelColors: { [STR]: '#E8A33D' },
      // MEP's colour is the one the project assigned it: assigned again, not the user's own.
      assignedColors: { [MEP]: '#7B8CF0' },
      nativeMats: false,
      treeMode: 'entity',
      grids: true,
      levels: false,
      groundGrid: false,
      shadows: true,
      snap: true,
      dims: false,
      sections: {
        grid: { name: 'C', offset: 500, flip: true, cut: true },
        level: { name: '', offset: 0, flip: false, cut: false }
      },
      stack: [
        {
          id: 'f1',
          on: true,
          action: 'hide',
          color: '#E8A33D',
          rules: [
            { prop: 'Model', op: '=', val: STR, join: 'and' },
            { prop: 'IfcEntity', op: '=', val: 'IfcColumn' },
            // A literal: a model whose key reads `m1` — not the file's model m1.
            { prop: 'Model', op: '=', val: 'm1', join: 'or' }
          ]
        }
      ],
      view: 'iso',
      units: 'mm',
      filterSets: [
        {
          id: 1762508600000,
          label: 'STR columns',
          stack: [
            {
              id: 'f2',
              on: true,
              action: 'isolate',
              color: '#35C4B6',
              rules: [
                { prop: 'Model', op: '=', val: STR },
                { prop: 'IfcEntity', op: '=', val: 'IfcColumn', join: 'and' }
              ]
            }
          ]
        }
      ]
    })

    expect(cam && { ...cam, target: [] }).toEqual({
      theta: -0.7853981633974483,
      phi: 1.05,
      dist: 60,
      half: 12,
      target: [],
      proj: 'persp'
    })
    near(cam!.target, [0.457, 0.766, 0.05])

    expect(views).toHaveLength(1)
    const { cam: vcam, ...vp } = views[0]
    expect(vp).toEqual({
      id: 1762508700000,
      name: 'Lobby',
      sub: 'grid C + level L2 · 1 hidden',
      section: { kind: 'grid', name: 'C', offset: 0, flip: false, cut: true },
      sections: {
        grid: { name: 'C', offset: 0, flip: false, cut: true },
        level: { name: 'L2', offset: 1200, flip: false, cut: false }
      },
      hidden: { [fedId(1, 103)]: true },
      storeyVis: {},
      modelVis: { [STR]: false },
      stack: [],
      active: null,
      grids: true,
      levels: true,
      frame: IDENTITY_FRAME_KEY,
      idStride: ID_STRIDE
    })
    expect(vcam?.proj).toBe('ortho')
    near(vcam!.target, [5, 4, 1.05])

    expect(spots).toHaveLength(1)
    near(spots[0].p, [0.457, 0.766, 0.05])
    expect(measures).toHaveLength(1)
    near(measures[0].p, [1, 1, 1.5])
    expect({ ...measures[0], p: [] }).toEqual({
      p: [],
      x: 4.2,
      z: 3,
      sides: { x: { minus: 1.2, plus: 3 }, z: { minus: null, plus: 3 } }
    })

    expect(schedules.map((s) => [s.name, s.def.name, s.def.entity, s.savedAt])).toEqual([
      ['Wall Schedule', 'Wall Schedule', ['IfcWall'], '2026-11-07T09:40:00.000Z']
    ])
    expect(schedules[0].def.columns).toEqual([{ field: { kind: 'core', key: 'name' } }])
    expect(openSchedule).toMatchObject({
      version: 1,
      name: 'Column Schedule',
      entity: ['IfcColumn'],
      columns: [{ field: { kind: 'core', key: 'name' }, heading: 'Mark' }],
      filters: [],
      sort: [],
      itemize: false,
      grandTotal: true
    })
  })

  it('re-saves to a file that reads back to the same project', () => {
    if (!read.ok) throw new Error(read.message)
    const again = readProject(projectText(read.project))
    expect(again).toEqual(read)
  })
})
