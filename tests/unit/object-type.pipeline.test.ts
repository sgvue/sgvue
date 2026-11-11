/**
 * 2026-11-11 — ObjectType and the type's Name, end to end, against IfcOpenShell's raw reading.
 *
 * The index showed the **type object's Name** (`IfcWallType.Name` …, through
 * `IfcRelDefinesByType`) as an element's ObjectType whenever it had a named type, where
 * IfcOpenShell and other viewers read the occurrence's own `ObjectType` attribute: on a Revit
 * export the occurrence carries an ALL-CAPS sub-type code and the type the "Family:Type" name.
 * The contract: `IfcElement.objectType` is the occurrence's own `ObjectType`, as written, `''`
 * when unset; `IfcElement.typeName` is the assigned type's `Name`, `''` for none.
 *
 * `scripts/make-objecttype-fixtures.py` writes one element per way the two can stand beside
 * each other, in IFC4 and IFC2X3; `tests/fixtures/identities.json` is IfcOpenShell's reading of
 * them (`expected-from-ifcopenshell.py --identities`), raw attributes only. Each file goes
 * through every layer the value reaches the user by — web-ifc under Node, `buildModelIndex`, the
 * federation, the SQL database through `sql-schema.ts`'s own insert, the property card, the
 * context menu, the tree, the rule matcher, the assistant's schema, executors, audit, heads-up
 * and IFC terms, and the Schedules adapter — and every element is checked against that reading.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { chatSchema } from '../../src/shared/ai-schema'
import { attr } from '../../src/shared/attr'
import { federate, type FederatedElement } from '../../src/shared/federate'
import { labelText } from '../../src/shared/fmt'
import { matchFn, type Rule } from '../../src/shared/rules'
import { valueOptions } from '../../src/renderer/state/selectors/filter'
import { selectionCard } from '../../src/renderer/state/selectors/props'
import { ctxItems } from '../../src/renderer/state/selectors/ctx'
import { matchesSearch, rowMeta } from '../../src/renderer/state/selectors/tree'
import { useShell } from '../../src/renderer/state/shell'
import { executeTool, newTurnState, type ToolContext } from '../../src/renderer/ai/executors'
import { auditModel } from '../../src/renderer/ai/analysis'
import { noSubtypeCode, objectTypeOnlyOver, OBS_TEXT_MAX, SUBTYPE_TOKEN } from '../../src/renderer/ai/heads-up'
import { isTerm, vocabularyOf } from '../../src/renderer/ai/terms'
import { snapshotOf } from '../../src/schedule/adapter'
import { buildDatabase } from '../../src/worker/sql-schema'
import { createReadOnlyIfcSource } from '../../src/worker/ifc-source'
import { buildModelIndex } from '../../src/worker/index-builder'
import { resetShell } from './stub-viewer'

const FIXTURES = join(__dirname, '..', 'fixtures')
const require = createRequire(import.meta.url)

/** IfcOpenShell's raw reading — `identity()` in `scripts/expected-from-ifcopenshell.py`. */
interface Identity {
  expressId: number
  guid: string
  type: string
  name: string
  longName: string
  objectType: string
  typeName: string
  typeGuid: string
  predefinedType: string
}
interface IdentityFile {
  generatedBy: string
  files: Record<string, { sha256: string; schema: string; elements: Record<string, Identity> }>
}
const truth = JSON.parse(readFileSync(join(FIXTURES, 'identities.json'), 'utf8')) as IdentityFile

const FILES = ['objecttype/ifc4.ifc', 'objecttype/ifc2x3.ifc']

const otRule = (op: Rule['op'], val: string | null): Rule[] => [{ prop: 'ObjectType', op, val }]
/** `typeName` is new on `IfcElement`; read it without the type, so this file runs before it exists. */
const typeNameOf = (e: FederatedElement): unknown => (e as unknown as Record<string, unknown>).typeName
/** The Schedules' type rule (ifcTable's, recorded in `adapter.ts`): the type's Name, else the ObjectType. */
const fullType = (w: Identity): string => w.typeName || w.objectType

for (const file of FILES) {
  const want = truth.files[file]
  describe(`ObjectType — ${file} (${want?.schema}) vs ${truth.generatedBy}`, () => {
    const wants = Object.values(want?.elements ?? {})
    let elements: readonly FederatedElement[] = []
    let fed: ReturnType<typeof federate>
    let db: Database
    const byExpressId = new Map<number, FederatedElement>()

    beforeAll(async () => {
      expect(want, `${file} has no entry in identities.json`).toBeDefined()
      const src = await createReadOnlyIfcSource()
      const modelID = src.openFromBuffer(new Uint8Array(readFileSync(join(FIXTURES, file))))
      const index = buildModelIndex(src, modelID, { modelKey: 'OT', fileName: file, sha256: '' })
      src.close(modelID)
      src.dispose()
      expect(index.schema).toBe(want.schema)
      fed = federate([index])
      elements = fed.elements
      for (const e of elements) byExpressId.set(e.expressId, e)
      const SQL = await initSqlJs({ locateFile: (f) => join(dirname(require.resolve('sql.js')), f) })
      db = buildDatabase(SQL, { models: fed.models, elements: fed.elements })
    })

    const el = (w: Identity): FederatedElement => {
      const e = byExpressId.get(w.expressId)
      expect(e, `#${w.expressId} missing from the index`).toBeDefined()
      return e!
    }
    const at = (w: Identity): string => `#${w.expressId} "${w.name || w.longName}"`
    const sameOt = (w: Identity): string[] => wants.filter((x) => x.objectType === w.objectType).map((x) => x.guid).sort()
    const guidsOf = (ids: readonly number[]): string[] =>
      ids.map((id) => elements.find((e) => e.id === id)!.guid).sort()

    it('indexes every element IfcOpenShell indexes, and nothing more', () => {
      expect(elements.map((e) => e.expressId).sort((a, b) => a - b)).toEqual(
        wants.map((w) => w.expressId).sort((a, b) => a - b)
      )
      // The fixture covers what it says it does.
      expect(wants.some((w) => w.objectType && w.typeName && w.objectType !== w.typeName)).toBe(true)
      expect(wants.some((w) => !w.objectType && w.typeName)).toBe(true)
    })

    for (const w of wants) {
      describe(`${w.type} ${at(w)}`, () => {
        it('the index: objectType is the occurrence\'s, typeName the type\'s', () => {
          const e = el(w)
          expect({ objectType: e.objectType, typeName: typeNameOf(e) }, at(w)).toEqual({
            objectType: w.objectType,
            typeName: w.typeName
          })
          expect(e.typeGuid, at(w)).toBe(w.typeGuid)
        })

        it('attr(ObjectType) and the rules read the occurrence\'s ObjectType', () => {
          const e = el(w)
          expect(attr(e, 'ObjectType'), at(w)).toBe(w.objectType)
          if (w.objectType) expect(matchFn(otRule('=', w.objectType))!(e), at(w)).toBe(true)
          if (w.typeName && w.typeName !== w.objectType)
            expect(matchFn(otRule('=', w.typeName))!(e), `${at(w)}: a rule on the type's Name`).toBe(false)
          expect(matchFn(otRule('absent', null))!(e), at(w)).toBe(!w.objectType)
        })

        it('SQL: element.object_type, the attribute rows and type_object.name', () => {
          const e = el(w)
          const row = db.exec('SELECT object_type FROM element WHERE id = ?', [e.id])
          expect(row[0]?.values, at(w)).toEqual([[w.objectType]])
          const attrRows = db.exec("SELECT value FROM attribute WHERE element = ? AND key = 'ObjectType'", [e.id])
          expect(attrRows[0]?.values ?? [], at(w)).toEqual([[w.objectType]])
          const type = db.exec('SELECT name, guid FROM type_object WHERE element = ?', [e.id])
          expect(type[0]?.values ?? [], at(w)).toEqual(w.typeName || w.typeGuid ? [[w.typeName, w.typeGuid]] : [])
        })

        it('the property card: the ObjectType tile and "Same ObjectType"', () => {
          const e = el(w)
          const card = selectionCard({
            federation: fed,
            element: e,
            box: null,
            solids: 0,
            coords: { E: null, N: null, Z: null, angle: null },
            offset: [0, 0, 0]
          })!
          // `''` stays `''` here; the tile draws the em dash for it (`tileText`, 2026-11-11) — never a substitute.
          expect(card.objectType, at(w)).toBe(w.objectType)
          const same = card.relRows.find((r) => r.k === 'Same ObjectType')!
          expect(guidsOf(same.ids), at(w)).toEqual(sameOt(w))
          expect(same.v, at(w)).toBe(sameOt(w).length.toLocaleString('en-US'))
        })

        // 2026-11-11, the owner: *"Yes, by type"* — this case first pinned "similar" to the same
        // ObjectType, which on an element with none took every element with none. "Similar" is
        // the same type's Name, the element's own ObjectType only when it has no type, and with
        // neither there is no such item. Still IfcOpenShell's raw readings on the expected side.
        it('the context menu: "Select similar" is the same type, else the same ObjectType, else absent', () => {
          const e = el(w)
          const items = ctxItems({
            elements,
            byId: new Map(elements.map((x) => [x.id, x])),
            ctxId: e.id,
            selIds: [e.id],
            hidden: {}
          })
          const key = (x: Identity): string => x.typeName || x.objectType
          const similar = items.find((i) => i.label.startsWith('Select similar ·'))
          if (!key(w)) {
            expect(similar, at(w)).toBeUndefined()
            return
          }
          expect(similar!.label, at(w)).toBe(`Select similar · ${key(w)}`)
          expect(similar!.action.kind).toBe('select')
          expect(guidsOf((similar!.action as { ids: number[] }).ids), at(w)).toEqual(
            wants.filter((x) => key(x) === key(w)).map((x) => x.guid).sort()
          )
        })

        it('the tree: the row\'s meta and a search read the occurrence\'s ObjectType', () => {
          const e = el(w)
          const pdt = e.predefinedType && e.predefinedType !== 'NOTDEFINED' ? e.predefinedType : null
          expect(rowMeta(e, 'entity'), at(w)).toBe([pdt, w.objectType, e.storey].filter(Boolean).join(' · '))
          expect(rowMeta(e, 'type'), at(w)).toBe(
            [w.type.replace(/^Ifc/, ''), w.objectType, e.storey].filter(Boolean).join(' · ')
          )
          if (w.objectType) expect(matchesSearch(e, w.objectType.toLowerCase()), at(w)).toBe(true)
          // A type's Name that is no element's ObjectType and none of the other searched fields
          // must not find this element as an ObjectType match.
          const q = w.typeName.toLowerCase()
          const elsewhere = [e.name, e.type, e.predefinedType, e.effectivePredefinedType, e.storey, w.objectType].some(
            (v) => v.toLowerCase().includes(q)
          )
          if (q && !elsewhere) expect(matchesSearch(e, q), `${at(w)}: search for "${w.typeName}"`).toBe(false)
        })

        it('the Schedules adapter: objectType raw, family and typeName from typeName || objectType', () => {
          const e = el(w)
          const snap = snapshotOf(fed)
          const core = snap.cores[snap.rowIds.indexOf(e.id)]
          expect(core, at(w)).toBeDefined()
          const full = fullType(w)
          const colon = full.indexOf(':')
          expect(
            { objectType: core.objectType, family: core.family, typeName: core.typeName },
            at(w)
          ).toEqual({
            objectType: w.objectType,
            family: colon > 0 ? full.slice(0, colon) : '',
            typeName: colon > 0 ? full.slice(colon + 1) : full
          })
        })

        it('the heads-up\'s ObjectType-only check reads the occurrence\'s text', () => {
          const e = el(w)
          const o = objectTypeOnlyOver(fed, [e.id])
          const fires = noSubtypeCode(e.predefinedType) && !!w.objectType && !SUBTYPE_TOKEN.test(w.objectType)
          expect(o?.kind ?? null, at(w)).toBe(fires ? 'objectTypeOnly' : null)
          if (fires && o?.kind === 'objectTypeOnly') expect(o.example, at(w)).toBe(labelText(w.objectType, OBS_TEXT_MAX))
        })
      })
    }

    it('`ObjectType absent` matches exactly the elements with no ObjectType of their own', () => {
      const absent = matchFn(otRule('absent', null))!
      const expected = wants.filter((w) => !w.objectType).map((w) => w.guid).sort()
      expect(expected.length).toBeGreaterThan(0)
      expect(elements.filter(absent).map((e) => e.guid).sort()).toEqual(expected)
    })

    it('the Filter card and the assistant\'s schema offer the occurrences\' values, not a type\'s Name', () => {
      const values = new Set(wants.map((w) => w.objectType))
      expect(new Set(valueOptions(elements, 'ObjectType'))).toEqual(values)
      values.delete('')
      const schema = chatSchema(fed).objectTypes.map((v) => v.replace(/ \(\d+\)$/, ''))
      expect(new Set(schema)).toEqual(values)
      for (const w of wants)
        if (w.typeName && !values.has(w.typeName)) expect(schema, `a type-only Name "${w.typeName}"`).not.toContain(w.typeName)
    })

    it('the audit\'s "No ObjectType" is the elements with no ObjectType of their own', () => {
      const found = auditModel(elements, fed.storeys).find((f) => f.label === 'No ObjectType')
      const expected = wants.filter((w) => !w.objectType).map((w) => w.guid).sort()
      expect(found ? guidsOf(found.ids) : [], 'No ObjectType').toEqual(expected)
    })

    it('IFC terms: an occurrence\'s ObjectType is a term, a type-only Name is not', () => {
      const v = vocabularyOf(fed)
      const values = new Set(wants.map((w) => w.objectType).filter(Boolean))
      for (const ot of values) if (/[A-Za-z]{2}/.test(ot) && ot.length > 1) expect(isTerm(v, ot), ot).toBe(true)
      const names = new Set(
        elements.flatMap((e) => [
          e.type,
          ...Object.keys(e.psets),
          ...Object.values(e.psets).flatMap(Object.keys),
          ...Object.keys(e.qto),
          ...Object.values(e.qto).flatMap(Object.keys)
        ])
      )
      for (const w of wants)
        if (w.typeName && !values.has(w.typeName) && !names.has(w.typeName))
          expect(isTerm(v, w.typeName), `type-only Name "${w.typeName}"`).toBe(false)
    })

    it('the assistant: get_element\'s objectType and get_relationships\' typeObject', async () => {
      resetShell()
      useShell.getState().commitModels(fed)
      const turn = newTurnState()
      const ctx: ToolContext = {
        state: () => useShell.getState(),
        sql: async () => ({ columns: [], rows: [], truncated: false, ms: 0 }) as never,
        rawLine: async () => null,
        turn
      }
      for (const w of wants) {
        const e = el(w)
        const got = (await executeTool('get_element', { id: e.id }, ctx)) as Record<string, unknown>
        expect(got.objectType, at(w)).toBe(w.objectType)
        expect(got.typeName, at(w)).toBe(w.typeName)
        const rel = (await executeTool('get_relationships', { id: e.id }, ctx)) as Record<string, unknown>
        expect(rel.typeObject, at(w)).toEqual(
          w.typeName || w.typeGuid ? { name: w.typeName, guid: w.typeGuid || null } : null
        )
      }
    })
  })
}
