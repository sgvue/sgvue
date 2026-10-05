// Column construction and default-schedule logic. Pure — no DOM, unit-testable.

import { keysForEntity, type ModelStore } from '../ifc/store';
import type { PropStat, UnitKind } from '../ifc/types';
import type { UnitSystem } from '../ifc/units';
import {
  emptySchedule, headingOf, resultOf,
  type Calculated, type Column, type CoreKey, type FieldRef, type ScheduleDef,
} from './def';
import { defaultDecimals, defaultUnit } from './format';

/**
 * A column built from a discovered property, with sensible display defaults.
 *
 * `system` is the model's own — a file drawn in feet opens in feet. It defaults to metric so
 * a caller with no model in hand (a test, a field with no store) still gets a column.
 */
export function columnForProp(stat: PropStat, system: UnitSystem = 'metric'): Column {
  const numeric = stat.type === 'number';
  return {
    field: { kind: 'prop', pset: stat.pset, prop: stat.prop },
    align: numeric ? 'right' : stat.type === 'bool' ? 'center' : 'left',
    format: numeric
      ? {
        display: defaultUnit(stat.kind, system),
        decimals: defaultDecimals(stat.kind, system),
        thousands: true,
      }
      : undefined,
  };
}

/**
 * A calculated column lines up by what its author says the result IS — numbers right so
 * the decimal points stack, a yes/no centred like a tick, a label left like any other text.
 * Exactly the rule columnForProp uses on a discovered property, so the two kinds of column
 * cannot look like different apps.
 *
 * Stored on the column rather than worked out at render time because the XLSX exporter
 * reads this same value: a sheet that disagreed with the screen would be worse than either.
 */
export function alignForCalc(calc: Calculated | undefined): 'left' | 'center' | 'right' {
  switch (calc ? resultOf(calc) : 'number') {
    case 'text': return 'left';
    case 'yesNo': return 'center';
    default: return 'right';
  }
}

export function columnForCore(key: CoreKey, system: UnitSystem = 'metric'): Column {
  const elevation = system === 'imperial' ? { display: 'ft', decimals: 2 } : { display: 'm', decimals: 3 };
  return {
    field: { kind: 'core', key },
    align: key === 'storeyElevation' ? 'right' : 'left',
    format: key === 'storeyElevation' ? elevation : undefined,
  };
}

/*
 * What a field's values are — its statistics, its type and what it measures. SGVue (phase 4 of
 * the assistant's parity work, 2026-10-02): moved here from `schedule-ui/panels/shared.ts`,
 * which re-exports them, so that `schedule/assistant.ts` decides which unit and how many decimals
 * a column may take by the very rule the Format tab offers them by. Unchanged, comments and all.
 */

/** What we know about a field's values, so the UI offers the right operators and units. */
export function statOf(store: ModelStore, def: ScheduleDef, field: FieldRef): PropStat | undefined {
  if (field.kind !== 'prop') return undefined;
  const all = keysForEntity(store, def.entity);
  return all.find((s) => s.pset === field.pset && s.prop === field.prop)
    ?? all.find((s) => s.prop.toLowerCase() === field.prop.toLowerCase());
}

export function typeOf(store: ModelStore, def: ScheduleDef, field: FieldRef): PropStat['type'] {
  if (field.kind === 'core') {
    return field.key === 'storeyElevation' ? 'number' : 'text';
  }
  // A formula yields whatever it declares. This one lookup decides which controls the
  // Column-formatting panel offers, which operators the filter offers, and which way the
  // column aligns — so a text formula behaves exactly like an IFC text property, with no
  // decimals, no unit, no Sum, and the same equals/contains rules.
  if (field.kind === 'formula') {
    const calc = def.calculated?.find((x) => x.id === field.id);
    const result = calc ? resultOf(calc) : 'number';
    return result === 'yesNo' ? 'bool' : result === 'text' ? 'text' : 'number';
  }
  return statOf(store, def, field)?.type ?? 'text';
}

export function kindOf(store: ModelStore, def: ScheduleDef, field: FieldRef): UnitKind {
  if (field.kind === 'core') return field.key === 'storeyElevation' ? 'length' : 'none';
  // A formula works on the STORED value, which is SI — so `Height * 2` on a 2,350 mm door
  // is 4.70, in metres. Without a unit kind the column got no unit control at all and that
  // 4.70 sat next to a Height column reading 2,350, looking wrong by a factor of a thousand.
  // The author says what the result measures; the column then converts like any other.
  // Only a measurement has a unit to convert. Reading unitKind unconditionally would let a
  // stale one left behind by an earlier edit put "(mm)" on a column full of words.
  if (field.kind === 'formula') {
    const calc = def.calculated?.find((c) => c.id === field.id);
    return calc && resultOf(calc) === 'number' ? calc.unitKind ?? 'none' : 'none';
  }
  return statOf(store, def, field)?.kind ?? 'none';
}

/**
 * Every column a formula may name, as heading → what it measures, for `dimensionOf`.
 *
 * One copy because two disagree in a way nobody would spot: the suggestion chip in the
 * calculated-value editor and the button that applies it are built in different files, and
 * a drift here means the chip offers one unit and the click writes another. It lives beside
 * kindOf because that is the answer it is assembling.
 */
export function kindsByHeading(store: ModelStore, def: ScheduleDef): Map<string, string> {
  return new Map(def.columns
    .filter((col) => col.field.kind === 'core' || col.field.kind === 'prop')
    .map((col) => [headingOf(col, def).toLowerCase(), kindOf(store, def, col.field) as string]));
}

/**
 * Categories people usually want to schedule first. Falling back to the most populous
 * category lands on IfcMember in a structural model — technically correct, but a poor
 * first impression since framing carries no Level.
 */
const PREFERRED_FIRST = [
  'IfcDoor', 'IfcWindow', 'IfcSpace', 'IfcWall', 'IfcColumn', 'IfcBeam', 'IfcSlab', 'IfcStair',
];

export function defaultEntity(store: ModelStore): string | undefined {
  for (const want of PREFERRED_FIRST) {
    if ((store.byEntity.get(want)?.length ?? 0) > 0) return want;
  }
  return store.entities[0]?.entity;
}

/** SGVue: how many models the store's rows come from (`ElemCore.model`). */
export function modelCount(store: ModelStore): number {
  const seen = new Set<string>();
  for (const c of store.cores) seen.add(c.model ?? '');
  return seen.size;
}

/**
 * SGVue (2026-09-25, phase 3): with more than one model loaded, a schedule the app builds —
 * the opening one, a category's default, a template — starts with a Model column, so every
 * row says which file it came from. With one model, and on a set-up that already has one,
 * the columns are returned unchanged.
 */
export function withModelColumn(columns: Column[], store: ModelStore): Column[] {
  if (columns.some((c) => c.field.kind === 'core' && c.field.key === 'model')) return columns;
  if (modelCount(store) < 2) return columns;
  return [columnForCore('model', store.meta.unitSystem), ...columns];
}

/** Properties that say nothing useful in a schedule column. */
const NOISE = /^(Reference|IfcObjectType|GlobalId|Category|EntityType)$/i;

/** A useful starting schedule for a category: identity columns plus its best-populated properties. */
export function defaultColumnsFor(store: ModelStore, entity: string[]): Column[] {
  // The one place that reads the model's system; everything below just carries it.
  const system = store.meta.unitSystem;
  const cols: Column[] = [
    columnForCore('storey', system),
    columnForCore('family', system),
    columnForCore('typeName', system),
  ];
  // Dimensions and named values carry more information at a glance than Yes/No flags,
  // so a door schedule opens on ClearWidth rather than OneWayLockingDevice.
  const rank = { number: 0, enum: 1, text: 2, bool: 3 } as const;

  const takenProps = new Set<string>();
  const candidates = keysForEntity(store, entity)
    .filter((s) => !NOISE.test(s.prop))
    .sort((a, b) => rank[a.type] - rank[b.type] || b.count - a.count || a.prop.localeCompare(b.prop));

  for (const stat of candidates) {
    if (cols.length >= 8) break;
    // One column per property name — the same name in two psets adds noise, not information.
    const lower = stat.prop.toLowerCase();
    if (takenProps.has(lower)) continue;
    takenProps.add(lower);
    cols.push(columnForProp(stat, system));
  }
  return withModelColumn(cols, store);
}

/**
 * The schedule a newly opened model should show.
 *
 * `armed` is a setup the user picked on the start screen before choosing a file, or null.
 * It wins whenever this model actually carries one of the categories it names — otherwise
 * the caller would apply a door schedule to a model with no doors and get a blank table.
 * `fits: false` is the caller's cue to say why it could not be used.
 *
 * This lived inside main.ts's onDone, where it could not be tested at all. It is a decision
 * about schedules, not about wiring, so it belongs beside the other schedule defaults.
 */
export function openingSchedule(
  store: ModelStore,
  armed: ScheduleDef | null,
): { def: ScheduleDef; fits: boolean } {
  // Array.isArray, not just a truthy check: `armed` comes back from browser storage, and a
  // save written by an older build (or a hand-edited one) can carry anything. Throwing here
  // would abort the load and drop the user on the error screen with a parsed model in hand.
  if (armed && Array.isArray(armed.entity)
    && armed.entity.some((e) => (store.byEntity.get(e)?.length ?? 0) > 0)) {
    return { def: structuredClone(armed), fits: true };
  }
  const first = defaultEntity(store);
  const entity = first ? [first] : [];
  return {
    def: {
      ...emptySchedule(first ? `${first.replace(/^Ifc/, '')} Schedule` : 'Schedule', entity),
      columns: entity.length ? defaultColumnsFor(store, entity) : [],
    },
    fits: false,
  };
}
