// Saved schedule definitions: a named list in this window's localStorage — ported from
// ifcTable's `ui/schedules.ts` (2026-09-25, phase 2). The save rule, the numbering and the
// cap are ifcTable's own. What SGVue leaves out for now: the `.schedule.json` export and
// import (a file written or read outside the two sanctioned writers — phase 4 brings them back
// behind a native Save / Open dialog), and the one-time adoption of ifcTable's older key.
// The key is SGVue's own, under the `sgvue.schedules.` prefix the Schedules window keeps to.

import { parseScheduleDef, type ScheduleDef } from '../../schedule/schedule/def';
import { SavedListShape } from '../../schedule/messages';

export const SAVED_KEY = 'sgvue.schedules.saved.v1';
/**
 * How many setups the list keeps. v1.5.0, phase 3 — ifcTable's rule of 2026-11-07 ("saved
 * setups are never silently overwritten"): at the cap a save, a duplicate or an import that
 * would ADD an entry is refused, rather than making room by dropping the oldest. Replacing the
 * entry the schedule was loaded from never grows the list, so it still goes through.
 */
export const CAP = 100;

/** What the caller says when a write was refused, and why. */
export const FULL_MESSAGE = `Saved templates are full (${CAP}). Delete one to make room.`;
export const STORAGE_MESSAGE = 'Could not save — storage is unavailable or full.';
export const DELETE_STORAGE_MESSAGE = 'Could not delete — storage is unavailable or full.';

/** Would a save that may replace `own` have to add an entry to a list already at the cap? */
export function isFull(own: string | null = null, entries = listSaved()): boolean {
  return entries.length >= CAP && !(own !== null && entries.some((e) => e.name === own));
}

/** Why a write just came back null: the cap, or storage refused it. */
export const refusal = (own: string | null = null) => (isFull(own) ? FULL_MESSAGE : STORAGE_MESSAGE);

/** The name is the identity, and it always equals `def.name`. Every writer below keeps
 *  the two in step, so the rail and the panel agree. */
export interface SavedEntry { name: string; def: ScheduleDef; savedAt: string }

/**
 * 2026-11-07 (project file phase 3, plan D9) — while a project is open in the main window, its
 * saved setups are this window's list (`setProjectList`, from the port's `projectSchedules`):
 * every read and write below acts on them, and `localStorage` is neither read nor written. Each
 * write is reported back (`onWrite`), so the main window holds the project's list as it stands.
 * `null` — no project — is the window's own `localStorage` list, exactly as before.
 */
let project: { entries: SavedEntry[]; onWrite: (entries: SavedEntry[]) => void; refused?: true } | null = null;

/** Make `entries` this window's list, or (`null`) its own `localStorage` list again. */
export function setProjectList(entries: SavedEntry[] | null, onWrite?: (entries: SavedEntry[]) => void): void {
  project = entries ? { entries: structuredClone(entries), onWrite: onWrite ?? (() => undefined) } : null;
}

/**
 * The main window sent a project's list this window could not read (2026-11-07). A project is
 * open there, so `localStorage` is not this window's list either: until a list it can read
 * arrives (or a new main page), the library's Mine is empty and every write is refused — the caller
 * says "Could not save — storage is unavailable or full." — rather than land in the wrong place.
 */
export function refuseProjectList(): void {
  console.warn('[sgvue] the project\'s saved schedules could not be read here; saving setups is off until they can be.');
  project = { entries: [], onWrite: () => undefined, refused: true };
}

/** Whether the list is an open project's. */
export const projectListOn = (): boolean => project !== null;

/**
 * Every entry goes through `parseScheduleDef` — the importer's own validator, which fills
 * the defaults and rejects what cannot be a schedule — and one that fails is dropped. Storage
 * is data like any file: a hand-edited or damaged entry (`def: {}`, `columns: 'nope'`) would
 * otherwise throw inside a paint and blank the window.
 */
export function listSaved(): SavedEntry[] {
  // A copy: the writers below edit what they are handed before they write it.
  if (project) return structuredClone(project.entries);
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
  if (project?.refused) return false;
  if (project) {
    // A list the project could not carry is refused, as full storage refuses one: the caller
    // says "Could not save — storage is unavailable or full." and nothing changes.
    if (!SavedListShape.safeParse(entries).success) return false;
    project.entries = structuredClone(entries);
    project.onWrite(structuredClone(entries));
    return true;
  }
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
 * Returns the name actually used, or null when the list is full (`isFull`) or storage refused
 * the write — `refusal()` says which.
 */
export function saveSchedule(def: ScheduleDef, own: string | null): string | null {
  // A setup with no columns is refused: it could never be read back (`parseScheduleDef`
  // rejects it), so saving it would store a template that silently vanishes. The caller says
  // so before asking; this is the backstop.
  if (!def.columns.length) return null;
  const entries = listSaved();
  const { name, kept } = planSave(def, own, entries);
  // Only replacing `own` itself keeps the count; anything else adds an entry.
  if (isFull(name === own ? own : null, entries)) return null;
  const copy = structuredClone(def);
  copy.name = name;
  return write([{ name, def: copy, savedAt: new Date().toISOString() }, ...kept]) ? name : null;
}

/**
 * What a save would do to the list, without doing it: the name it would be stored under, the
 * entries that stay, and `replaced` — the one entry of that name, which can only be `own`:
 * every other clash is numbered. `saveSchedule` writes exactly this plan. (Nothing is pushed off
 * the end any more: at the cap the save is refused.)
 */
function planSave(def: ScheduleDef, own: string | null, entries: SavedEntry[]) {
  const wanted = def.name.trim() || 'Untitled schedule';
  const name = wanted !== own && entries.some((e) => e.name === wanted)
    ? uniqueName(wanted, entries.map((e) => e.name))
    : wanted;
  return {
    name,
    replaced: entries.find((e) => e.name === name)?.name ?? null,
    kept: entries.filter((e) => e.name !== name),
  };
}

/**
 * What a save of `def` would take away from the saved list — 2026-10-02, the assistant's
 * `manage_schedules`. A user's own Save replaces the setup it was loaded from, by ifcTable's
 * rule and without a question; a save asked for from chat must not take a saved setup away by
 * itself (the consent gate — it found the same hole in saved filter sets), so it asks first,
 * and this says what it would be asking about. `name` is what the setup would be saved as.
 * v1.5.0, phase 3: the only way left — at the cap a save is refused, never makes room.
 */
export function forgottenBySave(def: ScheduleDef, own: string | null): { name: string; replaced: string | null } {
  const { name, replaced } = planSave(def, own, listSaved());
  return { name, replaced };
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

/**
 * Copy an entry under a free name, directly after the original — a base to edit from.
 * Refused at the cap like any other new entry: nothing is dropped to make room.
 */
export function duplicateSchedule(name: string): string | null {
  const entries = listSaved();
  const at = entries.findIndex((e) => e.name === name);
  if (at < 0 || isFull(null, entries)) return null;
  const fresh = uniqueName(name, entries.map((e) => e.name));
  const def = structuredClone(entries[at].def);
  def.name = fresh;
  entries.splice(at + 1, 0, { name: fresh, def, savedAt: new Date().toISOString() });
  return write(entries) ? fresh : null;
}

/** False when storage (or a project's list) refused the write: then nothing was deleted. */
export function deleteSchedule(name: string): boolean {
  return write(listSaved().filter((e) => e.name !== name));
}
