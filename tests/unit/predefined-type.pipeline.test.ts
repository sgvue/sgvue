/**
 * 2026-11-07 — PredefinedType, end to end, against IfcOpenShell's own reading.
 *
 * The owner: *"investigate why my ifcObjectType sometimes shown in Predefinetype on the
 * properties panel. The database and how it shown on the app is critical important thing to our
 * app. Please design determistic test or simulation to prevent bugs like this."* The index put
 * a `USERDEFINED` element's `ObjectType` text into the one field the PredefinedType tile shows.
 *
 * `scripts/make-predefined-fixtures.py` writes one element per way a file states a predefined
 * type, in IFC4 and IFC2X3, and `golden.json` — IfcOpenShell's reading of those files as written.
 * Each file goes through every layer the value passes on its way to the user — web-ifc under Node,
 * `buildModelIndex`, the federation, the SQL database through `sql-schema.ts`'s own insert, the
 * property card's selector and the rule matcher — and every element is checked field by field.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { chatSchema } from '../../src/shared/ai-schema'
import { federate, type FederatedElement } from '../../src/shared/federate'
import { valueOptions } from '../../src/renderer/state/selectors/filter'
import { matchFn, type Rule } from '../../src/shared/rules'
import { selectionCard } from '../../src/renderer/state/selectors/props'
import { buildDatabase } from '../../src/worker/sql-schema'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'

const DIR = join(__dirname, '..', 'fixtures', 'predefined')
const require = createRequire(import.meta.url)

interface GoldenElement {
  case: string
  class: string
  expected: { predefinedType: string; effectivePredefinedType: string; objectType: string }
}
interface Golden {
  generatedBy: string
  files: Record<string, { schema: string; elements: Record<string, GoldenElement> }>
}
const golden = JSON.parse(readFileSync(join(DIR, 'golden.json'), 'utf8')) as Golden

const rule = (op: Rule['op'], val: string | null): Rule[] => [{ prop: 'PredefinedType', op, val }]

for (const [file, want] of Object.entries(golden.files)) {
  describe(`PredefinedType — ${file} (${want.schema}) vs ${golden.generatedBy}`, () => {
    let elements: readonly FederatedElement[] = []
    let fed: ReturnType<typeof federate>
    let db: Database

    beforeAll(async () => {
      const src = await createReadOnlyIfcSource()
      const modelID = src.openFromBuffer(new Uint8Array(readFileSync(join(DIR, file))))
      const index = buildModelIndex(src, modelID, { modelKey: 'PDT', fileName: file, sha256: '' })
      expect(index.schema).toBe(want.schema)
      fed = federate([index])
      elements = fed.elements
      const SQL = await initSqlJs({ locateFile: (f) => join(dirname(require.resolve('sql.js')), f) })
      db = buildDatabase(SQL, { models: fed.models, elements: fed.elements })
    })

    const sqlRow = (guid: string): Record<string, unknown> => {
      const result = db.exec(
        'SELECT predefined_type, predefined_type_effective, object_type FROM element WHERE guid = ?',
        [guid]
      )
      expect(result[0]?.values.length, `${guid}: one SQL row`).toBe(1)
      const [predefinedType, effectivePredefinedType, objectType] = result[0].values[0]
      return { predefinedType, effectivePredefinedType, objectType }
    }

    it('indexes every element, and nothing more', () => {
      expect(elements.length).toBe(Object.keys(want.elements).length)
      expect(new Set(elements.map((e) => e.guid))).toEqual(new Set(Object.keys(want.elements)))
      expect(db.exec('SELECT COUNT(*) FROM element')[0].values[0][0]).toBe(elements.length)
    })

    for (const [guid, g] of Object.entries(want.elements)) {
      it(`${g.class} "${g.case}": index, SQL, the property card and the rules agree with IfcOpenShell`, () => {
        const e = elements.find((x) => x.guid === guid)
        expect(e, `${guid} missing from the index`).toBeDefined()
        expect(e!.name).toBe(g.case)
        expect(e!.type).toBe(g.class)

        // The index.
        expect({
          predefinedType: e!.predefinedType,
          effectivePredefinedType: e!.effectivePredefinedType,
          objectType: e!.objectType
        }).toEqual(g.expected)

        // The database, read back from the row `sql-schema.ts` inserted.
        expect(sqlRow(guid)).toEqual(g.expected)
        // …and its `attribute` rows: one per distinct value, as a rule matches either.
        const attrRows = db.exec(
          "SELECT value FROM attribute WHERE element = ? AND key = 'PredefinedType' ORDER BY value",
          [e!.id]
        )[0].values.map(([v]) => v)
        expect(attrRows).toEqual(
          [...new Set([g.expected.predefinedType, g.expected.effectivePredefinedType])].sort()
        )

        // The property card's tiles: the code as written, never ObjectType text.
        const card = selectionCard({
          federation: fed,
          element: e!,
          box: null,
          solids: 0,
          coords: { E: null, N: null, Z: null, angle: null },
          offset: [0, 0, 0]
        })!
        expect(card.predefinedType).toBe(g.expected.predefinedType)
        expect(card.objectType).toBe(g.expected.objectType)

        // A rule on either value matches; `absent` only when both are empty.
        const matches = (rules: Rule[]): boolean => matchFn(rules)!(e!)
        if (g.expected.predefinedType) expect(matches(rule('=', g.expected.predefinedType))).toBe(true)
        if (g.expected.effectivePredefinedType)
          expect(matches(rule('=', g.expected.effectivePredefinedType))).toBe(true)
        const bothEmpty = !g.expected.predefinedType && !g.expected.effectivePredefinedType
        expect(matches(rule('absent', null))).toBe(bothEmpty)
        // `!=` is true only when neither value equals.
        for (const v of [g.expected.predefinedType, g.expected.effectivePredefinedType].filter(Boolean))
          expect(matches(rule('!=', v))).toBe(false)
      })
    }

    it('offers both values wherever a value is picked: the Filter card and the assistant\'s schema', () => {
      const all = new Set(
        Object.values(want.elements).flatMap((g) => [g.expected.predefinedType, g.expected.effectivePredefinedType])
      )
      expect(new Set(valueOptions(elements, 'PredefinedType'))).toEqual(all)
      const schema = chatSchema(fed).predefinedTypes.map((v) => v.replace(/ \(\d+\)$/, ''))
      all.delete('')
      expect(new Set(schema)).toEqual(all)
    })

    it('`absent` matches exactly the elements with both values empty', () => {
      const absent = matchFn(rule('absent', null))!
      const want_ = Object.entries(want.elements)
        .filter(([, g]) => !g.expected.predefinedType && !g.expected.effectivePredefinedType)
        .map(([guid]) => guid)
        .sort()
      expect(want_.length).toBeGreaterThan(0)
      expect(elements.filter(absent).map((e) => e.guid).sort()).toEqual(want_)
    })
  })
}
