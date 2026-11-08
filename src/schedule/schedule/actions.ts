// Every edit a user can make to a ScheduleDef, one pure function per intent:
// (def, args) → new def, no DOM. The UI decides what was asked; these decide what changes.
// Split by concern under ./actions/; this barrel is the one import the UI and the tests use.
//
// Wholesale replacements are NOT here — picking a category, applying a template, loading or
// importing a setup, undo/redo. Those swap in a different definition; they edit nothing.
//
// Ported from ifcTable's `schedule/actions.ts` and `schedule/actions/` (Yong Yen, 2026-11-05 on)
// for SGVue v1.5.0, phase 1 of the ifcTable update — the engine half only. The Schedules
// window's own handlers (`renderer/schedule-ui/events.ts`) still edit the definition in place
// until phase 2 rebuilds them on these; the assistant's `make_schedule` builds a whole
// definition at once and keeps its own rules (`schedule/assistant.ts`).

export { canMove, fieldKey, moveItem, newId } from './actions/edit';
export {
  addColumns, moveColumn, remapColumn, removeColumn, setAlign,
  setColumnFormat, setHeading, setHeadingOrientation, setHidden, setTotal, setWidths,
} from './actions/columns';
export {
  addConditionalRule, addFilterRule, removeConditionalRule, removeFilterRule, setFilterField,
  setFilterMode, setFilterOp, setFilterRange, setFilterValue, setFilterValues,
  updateConditionalRule,
} from './actions/rules';
export {
  addSortLevel, moveSortLevel, removeSortLevel, setAppearance, setGrandTotal,
  setGrandTotalTitle, setGroupOptions, setItemize, setName, setSortDir, setSortField,
} from './actions/schedule';
export {
  addCalculated, removeCalculated, setCalculatedResult, setCalculatedUnitKind, updateCalculated,
} from './actions/calculated';
