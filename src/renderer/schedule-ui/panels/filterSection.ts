// Filter: up to 8 rules, AND or OR.
//
// Every rule says what it is doing to the model — "Keeps 412 · removes 353" — and can show
// you the rows it removes. An empty schedule is nearly always one rule being stricter than
// its author thought, and this turns that from a mystery into a click.

import type { ModelStore } from '../../../schedule/ifc/store';
import type { PropStat, UnitKind } from '../../../schedule/ifc/types';
import { matchRule, OP_LABELS, opsForType, ruleText } from '../../../schedule/schedule/compare';
import { MAX_FILTERS, type ScheduleDef } from '../../../schedule/schedule/def';
import { planComputed } from '../../../schedule/schedule/computed';
import { candidateRows } from '../../../schedule/schedule/engine';
import { resolveField } from '../../../schedule/schedule/resolve';
import type { AppState } from '../state';
import { defaultUnit } from '../../../schedule/schedule/format';
import { esc, option } from '../dom';
import { displayNum, fieldSelect, kindOf, statOf, typeOf } from './shared';
import { cross } from '../icons';

interface Effect { keeps: number; removes: number }

/**
 * What each rule is responsible for, in ONE pass over the category rather than one pass
 * per rule: a rule only decides the rows the other rules leave to it.
 */
export function ruleEffects(store: ModelStore, def: ScheduleDef): Effect[] {
  const rules = def.filters;
  const out: Effect[] = rules.map(() => ({ keeps: 0, removes: 0 }));
  if (!rules.length) return out;
  const or = (def.filterLogic ?? 'and') === 'or';
  // Formula columns are legal filter targets, and resolveField returns nothing for them
  // without their computed values — the engine threads the same plan through its own
  // filter pass, and if these two disagree the stated count contradicts the rows shown.
  const plan = planComputed(def);

  for (const r of candidateRows(store, def)) {
    const computed = plan.compute(store, r);
    const hits = rules.map((f) => matchRule(resolveField(store, r, f.field, computed), f));
    for (let i = 0; i < rules.length; i++) {
      // Under AND the others must all pass for this rule to matter; under OR the others
      // must all fail, or the row is already in regardless of what this rule says.
      const mine = or
        ? !hits.some((h, n) => n !== i && h)
        : hits.every((h, n) => n === i || h);
      if (!mine) continue;
      if (hits[i]) out[i].keeps++; else out[i].removes++;
    }
  }
  return out;
}

export function filterSummary(state: AppState): string {
  const n = state.def.filters.length;
  if (!n) return 'none';
  return state.def.filters.map((f) => ruleText(f, state.def)).join(' · ');
}

export function filterBody(state: AppState, store: ModelStore): string {
  const def = state.def;
  const effects = ruleEffects(store, def);

  const rows = def.filters.map((rule, i) => {
    const type = typeOf(store, def, rule.field);
    const kind = kindOf(store, def, rule.field);
    const ops = opsForType(type).map((o) => option(o, OP_LABELS[o], o === rule.op)).join('');
    const unit = kind !== 'none' && kind !== 'count' ? defaultUnit(kind, store.meta.unitSystem) : '';
    const e = effects[i];
    const showing = state.removedBy === i;
    const decided = e.keeps + e.removes;
    const value = valueInput(state, store, i, type, kind);

    // What the rule is doing, as a bar first and the numbers second — a strict rule shows
    // up as a short green stub long before anyone reads "removes 4,812".
    const effect = `${decided ? `<div class="bar keep"><i style="width:${(e.keeps / decided * 100).toFixed(1)}%"></i></div>` : ''}
      <div class="row ends rule-effect">
        <span class="keeps">Keeps ${e.keeps.toLocaleString()}</span>
        <span class="sub">removes <strong>${e.removes.toLocaleString()}</strong>
          <button class="link" data-act="show-removed" data-i="${i}"${e.removes ? '' : ' disabled'}>${showing ? 'back to schedule' : 'show them'}</button>
        </span>
      </div>`;

    return `<div class="subcard" data-i="${i}">
      <div class="row">
        ${fieldSelect(state, rule.field, 'filter-field', i)}
        <button class="x-btn near hv-warn-both" data-act="filter-remove" data-i="${i}" title="Remove this rule">${cross()}</button>
      </div>
      <select class="full block snug" data-act="filter-op" data-i="${i}" aria-label="Condition">${ops}</select>
      ${value ? `<div class="row block snug">
        <span class="value-slot">${value}</span>
        ${unit ? `<span class="sub mono unit-hint">${esc(unit)}</span>` : ''}
      </div>` : ''}
      ${effect}
    </div>`;
  }).join('');

  const logic = def.filterLogic ?? 'and';
  const full = def.filters.length >= MAX_FILTERS;
  return `<div class="row match-row">
      <span class="sub">Match</span>
      <div class="seg grow-1" role="group" aria-label="Match all or any rule">
        <button class="seg-btn${logic === 'and' ? ' on' : ''}" data-act="filter-logic" data-v="and"
          aria-pressed="${logic === 'and'}">All rules</button>
        <button class="seg-btn${logic === 'or' ? ' on' : ''}" data-act="filter-logic" data-v="or"
          aria-pressed="${logic === 'or'}">Any rule</button>
      </div>
    </div>
    <div class="stack">${rows || '<div class="sub">No rules — every element is shown.</div>'}</div>
    <button class="dashed block tight" data-act="filter-add" ${full ? 'disabled' : ''}>
      ${full ? `Maximum ${MAX_FILTERS} rules` : `+ Add rule <span class="dim">(${def.filters.length} of ${MAX_FILTERS})</span>`}
    </button>
    <div class="panel-note">An empty schedule is nearly always one rule too strict — “show them” reveals what a rule drops.</div>`;
}

/**
 * Numeric values are typed in display units and stored in SI, so '>= 1200 mm' works.
 *
 * `type` and `kind` come from the caller, which already has them: both walk every property
 * key in the category, and working them out a second time here doubled that for every rule
 * on every repaint.
 */
function valueInput(
  state: AppState, store: ModelStore, i: number, type: PropStat['type'], kind: UnitKind,
): string {
  const rule = state.def.filters[i];
  const wide = 'class="full"';

  if (rule.op === 'hasValue' || rule.op === 'noValue') return '';
  if (rule.op === 'between') {
    const [lo, hi] = rule.values ?? [];
    return `<span class="row full">
      <input type="number" step="any" data-act="filter-lo" data-i="${i}" value="${esc(displayNum(lo, kind, store.meta.unitSystem))}" placeholder="from" aria-label="From" class="grow-1" />
      <input type="number" step="any" data-act="filter-hi" data-i="${i}" value="${esc(displayNum(hi, kind, store.meta.unitSystem))}" placeholder="to" aria-label="To" class="grow-1" />
    </span>`;
  }
  if (rule.op === 'in') {
    return `<input type="text" data-act="filter-values" data-i="${i}" ${wide}
      value="${esc((rule.values ?? []).join(', '))}" placeholder="value, value, value" aria-label="Values" />`;
  }
  if (type === 'enum' || type === 'bool') {
    const stat = statOf(store, state.def, rule.field);
    const choices = type === 'bool' ? ['true', 'false'] : (stat?.distinct ?? []);
    return `<select data-act="filter-value" data-i="${i}" aria-label="Value" ${wide}>
      ${choices.map((c) => option(c, c, String(rule.value ?? '') === c)).join('')}
    </select>`;
  }
  if (type === 'number') {
    return `<input type="number" step="any" data-act="filter-value" data-i="${i}" aria-label="Value" ${wide}
      value="${esc(displayNum(rule.value as number, kind, store.meta.unitSystem))}" />`;
  }
  return `<input type="text" data-act="filter-value" data-i="${i}" aria-label="Value" ${wide}
    value="${esc(rule.value ?? '')}" placeholder="value" />`;
}
