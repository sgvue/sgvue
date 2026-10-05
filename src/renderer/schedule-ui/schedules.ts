// Saved schedule definitions: a named list in this window's localStorage — ported from
// ifcTable's `ui/schedules.ts` (2026-09-25, phase 2). The save rule, the numbering and the
// cap are ifcTable's own. What SGVue leaves out for now: the `.schedule.json` export and
// import (a file written or read outside the two sanctioned writers — phase 4 brings them back
// behind a native Save / Open dialog), and the one-time adoption of ifcTable's older key.
// The key is SGVue's own, under the `sgvue.schedules.` prefix the Schedules window keeps to.

import { parseScheduleDef, type ScheduleDef } from '../../schedule/schedule/def';

export const SAVED_KEY = 'sgvue.schedules.saved.v1';
/** How many setups the list keeps. Saves unshift, so the oldest entry is the last one. */
export const CAP = 100;

/** The name is the identity, and it always equals `def.name`. Every writer below keeps
 *  the two in step, so the rail and the panel agree. */
export interface SavedEntry { name: string; def: ScheduleDef; savedAt: string }

/**
 * Every entry goes through `parseScheduleDef` — the importer's own validator, which fills
 * the defaults and rejects what cannot be a schedule — and one that fails is dropped. Storage
 * is data like any file: a hand-edited or damaged entry (`def: {}`, `columns: 'nope'`) would
 * otherwise throw inside a paint and blank the window.
 */
export function listSaved(): SavedEntry[] {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt or unavailable storage must never break the app.
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SavedEntry[] = [];
  for (const e of parsed as { name?: unknown; def?: unknown; savedAt?: unknown }[]) {
    if (!e || typeof e.name !== 'string') continue;
    try {
      const def = parseScheduleDef(e.def);
      // The name is the identity and always equals `def.name` — the writers keep it so.
      def.name = e.name;
      out.push({ name: e.name, def, savedAt: typeof e.savedAt === 'string' ? e.savedAt : '' });
    } catch {
      // Not a schedule: left out, never shown, never loaded.
    }
  }
  return out;
}

function write(entries: SavedEntry[]): boolean {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/**
 * A name nobody has yet: "Door Schedule" → "Door Schedule (2)" → "(3)". An existing
 * trailing number is stripped from the base first, so duplicating a copy carries on
 * counting instead of stacking — "Door Schedule (2) (2)" is nobody's idea of a name.
 */
export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  const root = base.replace(/ \(\d+\)$/, '');
  for (let n = 2; ; n++) {
    const next = `${root} (${n})`;
    if (!taken.includes(next)) return next;
  }
}

/**
 * Save, replacing exactly one entry: the one this schedule was loaded from — `own`, the
 * caller's `state.savedName`. Any other collision is numbered instead. Save used to
 * overwrite by name, and since picking a category always names the schedule "Door
 * Schedule", the second door setup silently destroyed the first.
 *
 * Returns the name actually used, or null when storage refused the write.
 */
export function saveSchedule(def: ScheduleDef, own: string | null): string | null {
  // A setup with no columns is refused: it could never be read back (`parseScheduleDef`
  // rejects it), so saving it would store a template that silently vanishes. The caller says
  // so before asking; this is the backstop.
  if (!def.columns.length) return null;
  const { name, kept } = planSave(def, own, listSaved());
  const copy = structuredClone(def);
  copy.name = name;
  return write([{ name, def: copy, savedAt: new Date().toISOString() }, ...kept]) ? name : null;
}

/**
 * What a save would do to the list, without doing it: the name it would be stored under, the
 * entries that stay, and the two ways an entry is lost — `replaced`, the one entry of that name
 * (which can only be `own`: every other clash is numbered), and `evicted`, whatever the cap
 * pushes off the end. `saveSchedule` writes exactly this plan.
 */
function planSave(def: ScheduleDef, own: string | null, entries: SavedEntry[]) {
  const wanted = def.name.trim() || 'Untitled schedule';
  const name = wanted !== own && entries.some((e) => e.name === wanted)
    ? uniqueName(wanted, entries.map((e) => e.name))
    : wanted;
  // Only `own` can still be sitting under this name — every other clash was numbered above.
  const rest = entries.filter((e) => e.name !== name);
  return {
    name,
    replaced: entries.find((e) => e.name === name)?.name ?? null,
    kept: rest.slice(0, CAP - 1),
    evicted: rest.slice(CAP - 1).map((e) => e.name),
  };
}

/**
 * What a save of `def` would take away from the saved list — 2026-10-02, the assistant's
 * `manage_schedules`. A user's own Save replaces the setup it was loaded from and, at the cap,
 * lets the oldest go, by ifcTable's rule and without a question; a save asked for from chat
 * must not take a saved setup away by itself (the consent gate — it found the same hole in
 * saved filter sets), so it asks first, and this says what it would be asking about.
 * `name` is what the setup would be saved as.
 */
export function forgottenBySave(
  def: ScheduleDef, own: string | null,
): { name: string; replaced: string | null; evicted: string[] } {
  const { name, replaced, evicted } = planSave(def, own, listSaved());
  return { name, replaced, evicted };
}

/** Rename in place: same position in the list, and the definition's own name follows. */
export function renameSchedule(
  oldName: string, newName: string,
): 'ok' | 'taken' | 'missing' | 'failed' {
  const name = newName.trim();
  const entries = listSaved();
  const entry = entries.find((e) => e.name === oldName);
  if (!entry) return 'missing';
  // An empty name is refused like a taken one — the caller asks first; this is the backstop.
  if (!name || entries.some((e) => e !== entry && e.name === name)) return 'taken';
  entry.name = name;
  entry.def.name = name;
  // A refused write leaves the entry exactly as it was — 'failed', not 'missing', so the
  // caller can say storage is full instead of saying nothing at all.
  return write(entries) ? 'ok' : 'failed';
}

/** Copy an entry under a free name, directly after the original — a base to edit from. */
export function duplicateSchedule(name: string): string | null {
  const entries = listSaved();
  const at = entries.findIndex((e) => e.name === name);
  if (at < 0) return null;
  const fresh = uniqueName(name, entries.map((e) => e.name));
  const def = structuredClone(entries[at].def);
  def.name = fresh;
  // Trim before putting the pair back, so the cap can never take the copy: capping after
  // the splice threw the copy away whenever the original sat last, and this still
  // returned the name, so the caller flashed "Copied to …" for a copy nobody stored. The
  // original is held out of the trim too — duplicating must not delete what you copied,
  // and the copy has to stay directly behind it. What goes is the oldest of the rest.
  const rest = entries.filter((_, i) => i !== at).slice(0, CAP - 2);
  rest.splice(at, 0, entries[at], { name: fresh, def, savedAt: new Date().toISOString() });
  return write(rest) ? fresh : null;
}

/** The saved setups a duplicate of `name` would push off the end of the list — none, below the cap. */
export function forgottenByDuplicate(name: string): string[] {
  const entries = listSaved();
  const at = entries.findIndex((e) => e.name === name);
  return at < 0 ? [] : entries.filter((_, i) => i !== at).slice(CAP - 2).map((e) => e.name);
}

export function deleteSchedule(name: string): void {
  write(listSaved().filter((e) => e.name !== name));
}
