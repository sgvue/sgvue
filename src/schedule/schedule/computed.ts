// Builds the per-row values for calculated (formula / percentage) columns.
//
// Formulas reference other columns by their HEADING, which is what the user sees, so
// renaming a column renames the variable too. Percentage columns need a denominator
// computed over the whole result, so they run in a second pass.

import type { ModelStore } from '../ifc/store';
import { kindsByHeading } from './columns';
import { numberOf } from './compare';
import { headingOf, resultOf, type FieldRef, type ScheduleDef } from './def';
import { compile, dimensionOf, referencedNames, type Vars } from './formula';
import { resolveField, type Computed } from './resolve';

export interface ComputedPlan {
  compute: (store: ModelStore, row: number) => Computed;
  /** Formulas that failed to parse, keyed by calculated id — surfaced in the Fields tab. */
  errors: Map<string, string>;
}

/**
 * Prepare the per-row calculator for a definition. Compiling once here keeps the
 * per-row cost to a stack machine walk.
 */
export function planComputed(def: ScheduleDef): ComputedPlan {
  const errors = new Map<string, string>();

  // Variables available to formulas: every non-calculated column, by heading.
  // Two columns can share a default heading (Pset_MemberCommon.Reference and
  // Pset_EnvironmentalImpactIndicators.Reference both read "Reference"). Binding a
  // formula to whichever came last would be silently wrong, so an ambiguous name is
  // dropped and reported as unknown rather than guessed at.
  const byHeading = new Map<string, { field: FieldRef; count: number }>();
  for (const c of def.columns) {
    if (c.field.kind !== 'core' && c.field.kind !== 'prop') continue;
    const h = headingOf(c, def).toLowerCase();
    const hit = byHeading.get(h);
    if (hit) hit.count++;
    else byHeading.set(h, { field: c.field, count: 1 });
  }
  const sources = [...byHeading]
    .filter(([, v]) => v.count === 1)
    .map(([heading, v]) => ({ heading, field: v.field }));

  /** Headings a formula can legally reference — used by the Fields tab's warning. */
  const ambiguous = [...byHeading].filter(([, v]) => v.count > 1).map(([h]) => h);

  const formulas = (def.calculated ?? [])
    .filter((c) => c.kind === 'formula')
    .map((c) => {
      try {
        const result = resultOf(c);
        return { id: c.id, unitKind: c.unitKind, result, run: compile(c.formula ?? '', result) };
      } catch (e) {
        errors.set(c.id, e instanceof Error ? e.message : String(e));
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const compute = (store: ModelStore, row: number): Computed => {
    const out: Computed = new Map();

    if (formulas.length) {
      const vars: Vars = new Map();
      for (const s of sources) {
        const cell = resolveField(store, row, s.field);
        if (cell === undefined) continue;
        // The cell's OWN type decides, deliberately not numberOf(). That helper digs the
        // first number out of any string so a filter can compare "900 mm" against 900 —
        // right for filters, wrong here: it turned the type name "1100x2400 (2HR) Metal"
        // into the number 1100, so contains(Type, "Metal") could never match anything.
        // A number stored as text is converted explicitly with number(), and only then.
        if (typeof cell.v === 'number') vars.set(s.heading, cell.v);
        else if (typeof cell.v === 'boolean') vars.set(s.heading, cell.v ? 1 : 0);
        else if (typeof cell.v === 'string' && cell.v !== '') vars.set(s.heading, cell.v);
      }
      for (const f of formulas) {
        const v = f.run(vars);
        if (v === null) { out.set(`formula:${f.id}`, undefined); continue; }
        // Stored as the kind the author declared. A yes/no becomes a real boolean, so
        // formatCell renders it with the column's Yes/No style and numberOf reads it back
        // as 1/0 — a Sum total still counts the rows that said yes. Only a measurement
        // carries a unit kind; text and yes/no have nothing to convert.
        out.set(`formula:${f.id}`,
          f.result === 'number' ? { v, k: f.unitKind }
            : f.result === 'text' ? { v }
              : { v: typeof v === 'boolean' ? v : v !== 0 });
      }
    }

    return out;
  };

  for (const h of ambiguous) {
    errors.set(`ambiguous:${h}`, `Two columns are both called "${h}" — rename one to use it in a formula.`);
  }
  return { compute, errors };
}

/**
 * Everything wrong with one calculated value, in the order a person would want to hear it:
 * a formula that does not parse, one that is empty, one that names a heading no column has,
 * one whose units cannot be added — keyed by the calculated value's id.
 *
 * SGVue (phase 4 of the assistant's parity work, 2026-10-02): moved here from the Schedules
 * window's `overlays/calcEditor.ts`, which still calls it, so that the assistant's
 * `make_schedule` refuses a calculated column for exactly what the editor marks one bad for.
 */
export function calcProblems(store: ModelStore, def: ScheduleDef): Map<string, string> {
  const out = new Map<string, string>();
  const errors = planComputed(def).errors;
  // Headings a formula may refer to — the columns that are not themselves calculated.
  const known = new Set(def.columns
    .filter((c) => c.field.kind === 'core' || c.field.kind === 'prop')
    .map((c) => headingOf(c, def).toLowerCase()));
  const kindByName = kindsByHeading(store, def);

  for (const c of def.calculated ?? []) {
    if (c.kind !== 'formula') continue;
    const parseError = errors.get(c.id);
    if (parseError) { out.set(c.id, parseError); continue; }
    if (!(c.formula ?? '').trim()) { out.set(c.id, 'No formula yet.'); continue; }
    const unknown = referencedNames(c.formula ?? '').filter((n) => !known.has(n.toLowerCase()));
    if (unknown.length) {
      out.set(c.id, `Unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
      continue;
    }
    const problem = dimensionOf(c.formula ?? '', kindByName).problem;
    if (problem) out.set(c.id, problem);
  }
  return out;
}

/**
 * Percentage columns divide by a total over all matching rows, so they cannot be
 * computed row-by-row in isolation. Returns a compute function that layers them on.
 */
export function withPercentages(
  plan: ComputedPlan, store: ModelStore, def: ScheduleDef, rows: number[],
): ComputedPlan {
  const pcts = (def.calculated ?? []).filter((c) => c.kind === 'percentage' && c.ofField);
  if (!pcts.length) return plan;

  const totals = new Map<string, number>();
  for (const p of pcts) {
    let sum = 0;
    for (const r of rows) {
      const n = numberOf(resolveField(store, r, p.ofField!, plan.compute(store, r)));
      if (n !== null) sum += n;
    }
    totals.set(p.id, sum);
  }

  return {
    errors: plan.errors,
    compute: (s, row) => {
      const base = plan.compute(s, row);
      for (const p of pcts) {
        const total = totals.get(p.id) ?? 0;
        const n = numberOf(resolveField(s, row, p.ofField!, base));
        base.set(`formula:${p.id}`, total === 0 || n === null ? undefined : { v: (n / total) * 100 });
      }
      return base;
    },
  };
}
