// Ready-made schedule templates, hand-authored — one for each of the schedules people
// build most often: walls, doors, windows, floors, rooms, and so on.
//
// They are deliberately generic. Every property column asks by NAME across every property
// set (`pset: '*'`), so a template fits whatever the exporting tool called its psets; the
// names asked for are the ones a Revit IFC export actually writes — Qto_* quantity names
// and Pset_*Common properties.
//
// A template supplies a column set and number formatting, nothing else. It does not judge
// the model: no validation, no pass/fail, no completeness score.
//
// A template names one or more IFC classes, unioned. Two classes only where a schema
// difference splits one real-world thing — a wall is IfcWallStandardCase in the IFC2X3
// Revit writes and IfcWall in IFC4; furniture gained the IfcFurniture subtype in IFC4.
// Ducts and pipes deliberately stay IFC4-only: their IFC2X3 fallback is the generic
// IfcFlowSegment, which would list every flow segment in the model under BOTH templates.
// Absence is the honest answer there — presetsFor simply does not offer them.
//
// Below the general list sits a second, separately commented block: the IFC-SG templates,
// hand-authored one at a time at the owner's direction. They are the only templates allowed
// a filter, because IFC-SG classifies by ObjectType on generic classes — IfcGeographicElement
// holds trees, green verges and more, so naming the class alone names the wrong thing. The
// general list above is unchanged and still never filters.

import type { UnitSystem } from '../ifc/units';
import { emptySchedule, type Column, type CoreKey, type FilterRule, type ScheduleDef } from './def';
import { ANY_PSET } from './resolve';

export interface Preset {
  id: string;
  name: string;
  /**
   * Which gallery group this belongs to. Absent = general — the same forward-lenient shape
   * as `Calculated.result`: a template written before the key existed reads as the default.
   */
  section?: 'ifcsg';
  /** IFC classes this template covers. More than one unions them via byEntity. */
  entities: string[];
  /** IFC-SG only. Absent = no filter, which is what every general template is. */
  filters?: FilterRule[];
  columns: Column[];
}

// ---------- column shorthands ----------
// Units follow what a Revit user expects to read: mm at 0 dp for thicknesses and openings,
// m at 2 dp for runs, m² and m³ at 2 dp for quantities.

const core = (key: CoreKey, heading?: string): Column => ({
  field: { kind: 'core', key },
  ...(heading ? { heading } : {}),
});

const asks = (prop: string, heading?: string): Column => ({
  field: { kind: 'prop', pset: ANY_PSET, prop },
  ...(heading ? { heading } : {}),
});

/** A text property, e.g. FireRating. */
const text = (prop: string, heading?: string): Column => ({ ...asks(prop, heading), align: 'left' });

/** A boolean property, e.g. IsExternal. */
const yesNo = (prop: string, heading?: string): Column => ({
  ...asks(prop, heading), align: 'center', format: { boolStyle: 'Yes/No' },
});

const measure = (display: string, decimals: number) => (prop: string, heading?: string): Column => ({
  ...asks(prop, heading), align: 'right', format: { display, decimals, thousands: true },
});

const mm = measure('mm', 0);
const m = measure('m', 2);
const m2 = measure('m²', 2);
const m3 = measure('m³', 2);

export const PRESETS: Preset[] = [
  {
    id: 'wall-schedule',
    name: 'Wall Schedule',
    entities: ['IfcWall', 'IfcWallStandardCase'],
    columns: [
      core('typeName'), core('storey'),
      m('Length'), mm('Width', 'Thickness'), mm('Height'),
      m2('NetSideArea', 'Area'), m3('NetVolume', 'Volume'),
      text('FireRating'), yesNo('IsExternal'),
    ],
  },
  {
    id: 'door-schedule',
    name: 'Door Schedule',
    entities: ['IfcDoor'],
    columns: [
      core('mark'), core('typeName'), core('storey'),
      mm('Width'), mm('Height'), text('FireRating'),
    ],
  },
  {
    id: 'window-schedule',
    name: 'Window Schedule',
    entities: ['IfcWindow'],
    columns: [
      core('mark'), core('typeName'), core('storey'),
      mm('Width'), mm('Height'), yesNo('IsExternal'),
    ],
  },
  {
    id: 'floor-schedule',
    name: 'Floor Schedule',
    entities: ['IfcSlab'],
    columns: [
      core('typeName'), core('storey'),
      mm('Width', 'Thickness'), m2('NetArea', 'Area'), m3('NetVolume', 'Volume'),
      m('Perimeter'),
    ],
  },
  {
    id: 'room-schedule',
    name: 'Room Schedule',
    entities: ['IfcSpace'],
    columns: [
      core('name'), core('storey'),
      m2('NetFloorArea', 'Area'), mm('Height'), m3('NetVolume', 'Volume'),
    ],
  },
  {
    id: 'column-schedule',
    name: 'Column Schedule',
    entities: ['IfcColumn'],
    columns: [
      core('typeName'), core('storey'),
      mm('Length', 'Height'), m3('NetVolume', 'Volume'),
    ],
  },
  {
    id: 'beam-schedule',
    name: 'Beam Schedule',
    entities: ['IfcBeam'],
    columns: [
      core('typeName'), core('storey'),
      m('Length'), m3('NetVolume', 'Volume'),
    ],
  },
  {
    id: 'ceiling-schedule',
    name: 'Ceiling Schedule',
    entities: ['IfcCovering'],
    columns: [
      // IfcCovering is one class for ceilings, floor finishes and claddings alike. The
      // covering kind is a column rather than a baked-in filter: the user sees what shares
      // the class and filters it themselves, and an export that wrote NOTDEFINED still shows
      // its rows instead of being silently blanked.
      core('typeName'), core('predefinedType', 'Type of covering'), core('storey'),
      m2('NetArea', 'Area'), mm('Width', 'Thickness'),
    ],
  },
  {
    id: 'roof-schedule',
    name: 'Roof Schedule',
    entities: ['IfcRoof'],
    columns: [core('typeName'), core('storey'), m2('NetArea', 'Area')],
  },
  {
    id: 'stair-schedule',
    name: 'Stair Schedule',
    entities: ['IfcStair'],
    columns: [core('name'), core('typeName'), core('storey')],
  },
  {
    id: 'railing-schedule',
    name: 'Railing Schedule',
    entities: ['IfcRailing'],
    columns: [core('typeName'), core('storey'), m('Length')],
  },
  {
    id: 'furniture-schedule',
    name: 'Furniture Schedule',
    entities: ['IfcFurnishingElement', 'IfcFurniture'],
    columns: [core('name'), core('typeName'), core('storey'), core('space')],
  },
  {
    id: 'duct-schedule',
    name: 'Duct Schedule',
    entities: ['IfcDuctSegment'],
    columns: [core('typeName'), core('storey'), m('Length')],
  },
  {
    id: 'pipe-schedule',
    name: 'Pipe Schedule',
    entities: ['IfcPipeSegment'],
    columns: [core('typeName'), core('storey'), m('Length')],
  },

  // ---------- IFC-SG (Singapore CORENET X) ----------
  // A separate gallery section, and the only templates that may filter. Girth and Height are
  // IfcLengthMeasure in a real IFC-SG export, written in mm, so metres at 2 dp is what to
  // read them in; the rest are labels. Headings stay the IFC-SG property names — a friendlier
  // word here would stop matching what the submitter was told to fill in.
  {
    id: 'sg-planting',
    name: 'Planting',
    section: 'ifcsg',
    entities: ['IfcGeographicElement'],
    filters: [{ field: { kind: 'core', key: 'objectType' }, op: '=', value: 'LANDSCAPE_TREE' }],
    columns: [text('TreeNumber'), text('Species'), m('Girth'), m('Height'), text('Status')],
  },
];

/** How many elements this template covers, summed over every class it names. */
export function presetCount(byEntity: Map<string, number[]>, p: Preset): number {
  return p.entities.reduce((n, e) => n + (byEntity.get(e)?.length ?? 0), 0);
}

/** Templates whose IFC classes exist in this model, most-populous first. */
export function presetsFor(byEntity: Map<string, number[]>): Preset[] {
  return PRESETS
    .filter((p) => presetCount(byEntity, p) > 0)
    .sort((a, b) => presetCount(byEntity, b) - presetCount(byEntity, a)
      || a.name.localeCompare(b.name));
}

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * A metric template column, read in feet and inches — display and decimals together, since
 * a foot needs the decimals a millimetre does not. The mm-scale dimensions a template asks
 * for (opening sizes, thicknesses) are what an imperial drawing calls out in INCHES; the
 * metre-scale runs are what it calls out in FEET. A display this table does not name — a
 * degree, a boolean's absent format — is left exactly as authored.
 */
const IMPERIAL_DISPLAY: Record<string, [string, number]> = {
  mm: ['in', 1], m: ['ft', 2], 'm²': ['ft²', 2], 'm³': ['ft³', 2],
};

function imperialise(col: Column): void {
  const hit = col.format?.display ? IMPERIAL_DISPLAY[col.format.display] : undefined;
  if (!hit || !col.format) return;
  [col.format.display, col.format.decimals] = hit;
}

/**
 * Turn a template into a working schedule, grouped by level as most people want.
 *
 * The metric authoring above stays the single source of truth: an imperial model gets the
 * same template with its units mapped on the CLONE, never on the constant.
 */
export function scheduleFromPreset(p: Preset, system: UnitSystem = 'metric'): ScheduleDef {
  // A deep copy: the format objects above are module constants, and the formatting
  // controls edit a column's format in place. A rule is the same story — the Filter tab
  // edits `def.filters[i]` where it stands.
  const columns = structuredClone(p.columns);
  if (system === 'imperial') columns.forEach(imperialise);
  return {
    ...emptySchedule(p.name, [...p.entities]),
    columns,
    filters: structuredClone(p.filters ?? []),
    sort: [{ field: { kind: 'core', key: 'storey' }, dir: 'asc', header: true, footer: 'count' }],
    meta: { notes: `SGVue template — ${p.name}` },
  };
}
