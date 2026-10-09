/**
 * The model database: the federation's index, as twelve SQLite tables.
 *
 * It exists so the assistant can answer questions that no fixed tool signature covers —
 * "which fire doors on L3 have no FRL", "count walls by type and storey" — with an
 * arbitrary join instead of a new tool per question. It is built from the index already in
 * memory, held only in RAM, and set `PRAGMA query_only = 1` once it is full; there is no
 * write path from it back to the IFC file.
 *
 * `SQL_SCHEMA` is the DDL **and** the documentation: Phase 9 puts this exact string in the
 * assistant's prompt, so the model reads the same column names the database has. Keep the
 * comments in it accurate — they are not decoration.
 *
 * No wasm is loaded here. The caller passes an initialised `SqlJsStatic`, so the worker can
 * fetch the `.wasm` through Vite and the Node test can resolve it from `node_modules`, and
 * this file stays runnable in both.
 */
import type { Database, SqlJsStatic, Statement } from 'sql.js'
import { ATTR_KEYS, attr } from '../shared/attr'
import type { FederatedElement, FederatedModel } from '../shared/federate'
import type { PropValue } from '../shared/model-index.types'

/** What the SQL worker is sent: the federation, minus everything SQL does not store. */
export interface SqlPayload {
  models: readonly FederatedModel[]
  elements: readonly FederatedElement[]
}

/**
 * Element ids are the federation's own (`slot * ID_STRIDE + localId`, `shared/federate.ts`), so
 * a row joins straight to a selection, a pick or a geometry part with no translation. Since
 * 2026-10-09 the stride is 1 000 000 000, so an id past 2^31 is bound as a double by sql.js and
 * stored as an exact `INTEGER` by the columns' affinity (`tests/unit/federation-ids.test.ts`).
 */
export const SQL_SCHEMA = `
-- SGVue model database. Read-only: PRAGMA query_only = 1 is set once it is built.
-- Element ids are federation ids (slot * 1000000000 + localId), the same ids the viewer,
-- the selection and the geometry parts use. Values are stored AS AUTHORED in the file:
-- property.value is the text, property.num the number when there is one, and
-- property.measure the IFC measure type (IFCLENGTHMEASURE, …) that says what unit it is in.

-- One row per loaded IFC file.
CREATE TABLE model (
  key      TEXT PRIMARY KEY, -- element.model joins to this
  slot     INTEGER,          -- id block: ids run slot*1000000000 .. slot*1000000000+999999999
  name     TEXT,             -- IfcProject.Name
  file     TEXT,             -- file name as loaded
  schema   TEXT,             -- IFC2X3 | IFC4 | IFC4X3
  sha256   TEXT,
  site     TEXT,             -- IfcSite.Name
  building TEXT,             -- IfcBuilding.Name
  elements INTEGER
);

-- One row per element. IfcSpace is included and flagged; IfcOpeningElement is not indexed.
CREATE TABLE element (
  id              INTEGER PRIMARY KEY,
  model           TEXT,
  local_id        INTEGER, -- id inside its own file
  express_id      INTEGER, -- STEP line number in that file
  guid            TEXT,    -- IfcRoot.GlobalId, verbatim
  name            TEXT,
  description     TEXT,
  type            TEXT,    -- exact IFC entity, e.g. IfcWall
  predefined_type TEXT,    -- USERDEFINED already resolved to the authored string
  object_type     TEXT,    -- type family: IfcTypeObject.Name, else ObjectType
  tag             TEXT,
  storey          TEXT,    -- IfcBuildingStorey.Name of the containing storey
  material        TEXT,    -- the single display string
  is_space        INTEGER  -- 1 for IfcSpace
);

-- The seven attributes the UI filters and groups by, one row each, so a rule over
-- "Level" or "Material" is the same join as a rule over a property.
CREATE TABLE attribute (
  element INTEGER,
  key     TEXT, -- Model | IfcEntity | PredefinedType | ObjectType | Level | Name | Material
  value   TEXT
);

-- One row per property set or quantity set AS IT LANDED ON ONE ELEMENT.
CREATE TABLE pset (
  id                INTEGER PRIMARY KEY,
  element           INTEGER,
  name              TEXT,
  kind              TEXT,    -- SGPset | Pset | Qto | other
  inherited         INTEGER, -- 1 when it came through the type object, not the occurrence
  source_express_id INTEGER, -- the IfcPropertySet / IfcElementQuantity line it came from
  method            TEXT     -- IfcElementQuantity.MethodOfMeasurement
);

CREATE TABLE property (
  pset    INTEGER,
  element INTEGER,
  name    TEXT,
  value   TEXT, -- always populated; a list is joined with ', '
  num     REAL, -- populated only when the authored value is a number
  measure TEXT  -- IFCLENGTHMEASURE, IFCAREAMEASURE, … when the file states one
);

CREATE TABLE quantity (
  pset    INTEGER,
  element INTEGER,
  name    TEXT,
  value   REAL, -- populated when the quantity is numeric
  text    TEXT, -- the authored value as text
  measure TEXT
);

-- Decomposition and group membership, one row per link.
CREATE TABLE relationship (
  kind    TEXT,    -- parent | child | opening | filling | system
  element INTEGER, -- federation id
  other   INTEGER, -- the other end, as an expressId inside the same file
  name    TEXT     -- the group/system name, for kind = 'system'
);

-- IfcProject / IfcSite / IfcBuilding / IfcBuildingStorey / IfcSpace, by IfcRelAggregates.
CREATE TABLE spatial (
  model             TEXT,
  express_id        INTEGER,
  guid              TEXT,
  type              TEXT,
  name              TEXT,
  long_name         TEXT,
  elevation         REAL,   -- storeys only, metres
  parent_express_id INTEGER -- NULL at the IfcProject root
);

CREATE TABLE type_object (element INTEGER, name TEXT, guid TEXT);

-- One row per material, plus one per layer/profile/constituent when the file lists them.
CREATE TABLE material (
  element   INTEGER,
  kind      TEXT, -- IfcMaterial | IfcMaterialLayerSet | IfcMaterialLayerSetUsage | …
  name      TEXT,
  layer     TEXT, -- layer name, NULL on the material row itself
  thickness REAL  -- as authored
);

CREATE TABLE classification (
  element        INTEGER,
  system         TEXT, -- IfcClassification.Name, e.g. Uniclass
  identification TEXT, -- Identification (IFC4) / ItemReference (IFC2X3)
  name           TEXT,
  location       TEXT
);

-- One row per element THAT HAS GEOMETRY; an element with none has no row, so join with
-- LEFT JOIN when you are counting elements and with an inner join when you are measuring.
-- Axis-aligned bounding box in the PROJECT frame, in METRES, Z-up: each file's world
-- coordinates put through its own map conversion, then into the project frame of the first
-- model loaded (shared/georef.ts). x and y are therefore that building's own axes, not map east
-- and north; max_z - min_z is height, and the federation offset is NOT subtracted. The box is an axis-aligned APPROXIMATION of the solid — the union of the
-- element's placed part boxes — so it is never smaller than the element and can be larger for
-- a rotated or diagonal one. Report anything computed from it as bounding-box arithmetic, not
-- as solid geometry, and prefer an authored Qto quantity when one exists.
CREATE TABLE bbox (
  element INTEGER PRIMARY KEY,
  min_x REAL, min_y REAL, min_z REAL,
  max_x REAL, max_y REAL, max_z REAL
);

CREATE INDEX element_model ON element(model);
CREATE INDEX element_type ON element(type);
CREATE INDEX element_storey ON element(storey);
CREATE INDEX element_guid ON element(guid);
CREATE INDEX attribute_key ON attribute(key, value);
CREATE INDEX attribute_element ON attribute(element);
CREATE INDEX pset_element ON pset(element);
CREATE INDEX property_element ON property(element);
CREATE INDEX property_name ON property(name);
CREATE INDEX quantity_element ON quantity(element);
CREATE INDEX quantity_name ON quantity(name);
CREATE INDEX relationship_element ON relationship(element);
CREATE INDEX material_element ON material(element);
CREATE INDEX classification_element ON classification(element);
`

/** The authored value as the two columns SQL stores: text always, number when there is one. */
function valueColumns(value: PropValue): { text: string; num: number | null } {
  if (Array.isArray(value)) return { text: value.join(', '), num: null }
  if (typeof value === 'number') return { text: String(value), num: value }
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE', num: value ? 1 : 0 }
  return { text: value as string, num: null }
}

/**
 * Build the database.
 *
 * Everything is inserted inside one transaction with prepared statements: on a 26 000-element
 * model that is roughly half a million rows, and one `run` per row without a transaction
 * takes minutes rather than seconds.
 */
export function buildDatabase(SQL: SqlJsStatic, payload: SqlPayload): Database {
  const db = new SQL.Database()
  // Every statement prepared, so a build that fails part-way frees them and closes the
  // half-built database rather than leaving both inside the WASM heap.
  const statements: Statement[] = []
  const freeAll = (): void => {
    for (const statement of statements) statement.free()
  }
  try {
    fill(db, payload, (sql) => {
      const statement = db.prepare(sql)
      statements.push(statement)
      return statement
    })
  } catch (error) {
    freeAll()
    db.close()
    throw error
  }
  freeAll()

  // From here the connection refuses every write, whatever reaches it.
  db.run('PRAGMA query_only = 1')
  return db
}

/** The schema and every row, in one transaction. `buildDatabase` owns the cleanup. */
function fill(db: Database, payload: SqlPayload, prepare: (sql: string) => Statement): void {
  db.run(SQL_SCHEMA)
  db.run('BEGIN')

  const modelStmt = prepare(
    'INSERT INTO model (key, slot, name, file, schema, sha256, site, building, elements) VALUES (?,?,?,?,?,?,?,?,?)'
  )
  const spatialStmt = prepare(
    'INSERT INTO spatial (model, express_id, guid, type, name, long_name, elevation, parent_express_id) VALUES (?,?,?,?,?,?,?,?)'
  )
  const elementStmt = prepare(
    'INSERT INTO element (id, model, local_id, express_id, guid, name, description, type, predefined_type, object_type, tag, storey, material, is_space) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  )
  const attributeStmt = prepare('INSERT INTO attribute (element, key, value) VALUES (?,?,?)')
  const psetStmt = prepare(
    'INSERT INTO pset (id, element, name, kind, inherited, source_express_id, method) VALUES (?,?,?,?,?,?,?)'
  )
  const propertyStmt = prepare(
    'INSERT INTO property (pset, element, name, value, num, measure) VALUES (?,?,?,?,?,?)'
  )
  const quantityStmt = prepare(
    'INSERT INTO quantity (pset, element, name, value, text, measure) VALUES (?,?,?,?,?,?)'
  )
  const relationshipStmt = prepare(
    'INSERT INTO relationship (kind, element, other, name) VALUES (?,?,?,?)'
  )
  const typeStmt = prepare('INSERT INTO type_object (element, name, guid) VALUES (?,?,?)')
  const materialStmt = prepare(
    'INSERT INTO material (element, kind, name, layer, thickness) VALUES (?,?,?,?,?)'
  )
  const classificationStmt = prepare(
    'INSERT INTO classification (element, system, identification, name, location) VALUES (?,?,?,?,?)'
  )
  const bboxStmt = prepare(
    'INSERT INTO bbox (element, min_x, min_y, min_z, max_x, max_y, max_z) VALUES (?,?,?,?,?,?,?)'
  )

  const perModel = new Map<string, number>()
  for (const element of payload.elements) {
    perModel.set(element.model, (perModel.get(element.model) ?? 0) + 1)
  }

  for (const model of payload.models) {
    const meta = model.meta
    modelStmt.run([
      meta.modelKey,
      model.slot,
      meta.project?.name ?? '',
      meta.fileName,
      meta.schema,
      meta.sha256,
      meta.site?.name ?? '',
      meta.building?.name ?? '',
      perModel.get(meta.modelKey) ?? 0
    ])
    // The spatial tree, flattened by walking IfcRelAggregates the index already resolved.
    const walk = (node: (typeof meta)['spatial'], parent: number | null): void => {
      if (!node) return
      spatialStmt.run([
        meta.modelKey,
        node.expressId,
        node.guid,
        node.type,
        node.name,
        node.longName,
        node.elevation ?? null,
        parent
      ])
      for (const child of node.children) walk(child, node.expressId)
    }
    walk(meta.spatial, null)
  }

  let psetId = 0
  for (const element of payload.elements) {
    elementStmt.run([
      element.id,
      element.model,
      element.localId,
      element.expressId,
      element.guid,
      element.name,
      element.description,
      element.type,
      element.predefinedType,
      element.objectType,
      element.tag,
      element.storey,
      element.material,
      element.isSpace ? 1 : 0
    ])

    // One resolver for attributes, filter rules and colour-by — the design's own note.
    for (const key of ATTR_KEYS) {
      const value = attr(element, key)
      if (value !== undefined) attributeStmt.run([element.id, key, valueColumns(value).text])
    }

    if (element.objectType || element.typeGuid) {
      typeStmt.run([element.id, element.objectType, element.typeGuid])
    }

    for (const [setName, values] of Object.entries(element.psets)) {
      const meta = element.psetMeta[setName]
      psetId++
      psetStmt.run([
        psetId,
        element.id,
        setName,
        meta?.kind ?? 'other',
        meta?.inherited ? 1 : 0,
        meta?.sourceExpressId ?? 0,
        meta?.methodOfMeasurement ?? null
      ])
      for (const [key, value] of Object.entries(values)) {
        const { text, num } = valueColumns(value)
        propertyStmt.run([psetId, element.id, key, text, num, meta?.measures[key] ?? null])
      }
    }

    for (const [setName, values] of Object.entries(element.qto)) {
      const meta = element.psetMeta[setName]
      psetId++
      psetStmt.run([
        psetId,
        element.id,
        setName,
        meta?.kind ?? 'Qto',
        meta?.inherited ? 1 : 0,
        meta?.sourceExpressId ?? 0,
        meta?.methodOfMeasurement ?? null
      ])
      for (const [key, value] of Object.entries(values)) {
        const { text, num } = valueColumns(value)
        quantityStmt.run([psetId, element.id, key, num, text, meta?.measures[key] ?? null])
      }
    }

    const decomposition = element.decomposition
    if (decomposition.parent !== undefined) {
      relationshipStmt.run(['parent', element.id, decomposition.parent, null])
    }
    for (const child of decomposition.children) {
      relationshipStmt.run(['child', element.id, child, null])
    }
    for (const opening of decomposition.openings) {
      relationshipStmt.run(['opening', element.id, opening, null])
    }
    for (const filling of decomposition.fillings) {
      relationshipStmt.run(['filling', element.id, filling, null])
    }
    for (const system of element.systems) {
      relationshipStmt.run(['system', element.id, system.expressId, system.name])
    }

    for (const material of element.materials) {
      materialStmt.run([element.id, material.kind, material.name, null, null])
      for (const layer of material.layers ?? []) {
        materialStmt.run([
          element.id,
          material.kind,
          layer.material,
          layer.name,
          layer.thickness ?? null
        ])
      }
    }

    for (const c of element.classifications) {
      classificationStmt.run([element.id, c.system, c.identification, c.name, c.location])
    }

    if (element.bbox) {
      bboxStmt.run([element.id, ...element.bbox])
    }
  }

  db.run('COMMIT')
}
