// The one way an action changes a definition: on a deep copy, never on the caller's object.
// Every action is (def, args) → new def, so the UI that calls it — the column menu, a chip popover or the
// table-first one replacing it — decides only WHAT the user asked for, never how the saved
// format changes. No DOM, no AppState, no model: whatever needs the model is worked out by
// the caller and passed in as plain data.

import type { FieldRef, ScheduleDef } from '../def';

/** Copy, apply, return the copy. structuredClone keeps undefined-valued keys exactly as an
 *  in-place edit would have left them, so the JSON the history and saves see is unchanged. */
export function edit(def: ScheduleDef, fn: (d: ScheduleDef) => void): ScheduleDef {
  const d = structuredClone(def);
  fn(d);
  return d;
}

/** Whether moving `from` → `to` in a list this long would change anything. */
export function canMove(length: number, from: number, to: number): boolean {
  return from >= 0 && from < length && to >= 0 && to < length && from !== to;
}

/** Move one item in place. Returns false (and leaves the list alone) when out of range. */
export function moveItem<T>(list: T[], from: number, to: number): boolean {
  if (!canMove(list.length, from, to)) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

// SGVue keeps `fieldKey` and `newId` in def.ts, where the Schedules window and the assistant's
// `make_schedule` already read them (2026-09-28, 2026-10-02): re-exported, so there is one copy.
export { fieldKey, newId } from '../def';

/** The field a new filter rule or sort level starts on: the first column's, else Name. */
export function firstField(def: ScheduleDef): FieldRef {
  return def.columns[0]?.field ?? { kind: 'core', key: 'name' };
}
