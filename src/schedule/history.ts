// Undo and redo over the schedule definition.
//
// Only the definition is tracked — which section is open or what is typed in a search box
// is not something anyone wants to undo. Snapshots are JSON strings, so a restored state
// can never share a reference with the live one.
//
// Typing coalesces: renaming a column produces one undo step, not one per keystroke. Two
// states belong to the same burst when they arrived within 700 ms AND have the same shape
// (same columns, filters and levels, in the same order) — so only their text differs. A change
// the assistant made (`define`) is never part of a burst: it is always its own step.

import type { ScheduleDef } from './schedule/def';

const LIMIT = 60;
const BURST_MS = 700;

let undoStack: string[] = [];
let redoStack: string[] = [];
let current: string | null = null;
let currentShape = '';
let lastAt = 0;
/**
 * Whether the change that produced `current` was itself text-only. A burst may only join
 * another text edit — otherwise "reorder a column, then immediately type a heading" would
 * merge both into one step, and undo would silently take the reorder back too.
 */
let lastWasText = false;
/** Injected so tests are not at the mercy of the clock. */
let now = () => Date.now();

/**
 * Everything except free text, so a rename is a burst and adding a column is not.
 *
 * A calculated value's `formula` and `name` are free text and stay out — typing them should
 * merge. What it RETURNS does not: picking "yes or no" also re-aligns every column showing
 * it, and a change that moves other columns cannot ride along inside a rename's undo step.
 * `align` is here for the same reason, so choosing one by hand is its own step too.
 */
function shapeOf(def: ScheduleDef): string {
  return JSON.stringify([
    def.entity,
    def.columns.map((c) => [c.field, c.hidden, c.total, c.align]),
    (def.calculated ?? []).map((c) => [c.result, c.unitKind, c.yesNo, c.ofField]),
    def.filters.map((f) => [f.field, f.op]),
    def.sort.map((s) => [s.field, s.dir]),
    def.itemize, def.grandTotal,
  ]);
}

/**
 * Call after every change to the definition. Identical states are ignored. `alone` is a change
 * that is always an undo step of its own — the assistant's `define` — never joined to the
 * user's typing, whichever comes first.
 */
export function record(def: ScheduleDef, alone = false) {
  const sig = JSON.stringify(def);
  if (sig === current) return;
  const shape = shapeOf(def);

  const textOnly = shape === currentShape;
  if (current !== null) {
    const t = now();
    const burst = !alone && textOnly && lastWasText && t - lastAt < BURST_MS && undoStack.length > 0;
    // In a burst the entry already on the stack holds the pre-typing state — keep it.
    if (!burst) {
      undoStack.push(current);
      if (undoStack.length > LIMIT) undoStack.shift();
    }
    lastAt = t;
    redoStack = [];
  }
  current = sig;
  currentShape = shape;
  lastWasText = textOnly && !alone;
}

/**
 * The definition on screen changed in a way that is not an edit — a save that had to number
 * its name, or the saved setup on screen renamed — so it takes the place of the current state
 * without an undo step of its own. The next change records it, so Undo goes back to the name
 * that was on screen then, never to the one before the save; and a change that changes nothing
 * is still no step at all. The undo and redo stacks are untouched: what they hold was on screen.
 * It also ends any typing burst, so text typed straight after it cannot join the typing before
 * it and carry the restated state away inside that earlier step.
 */
export function restate(def: ScheduleDef) {
  if (current === null) return;
  current = JSON.stringify(def);
  currentShape = shapeOf(def);
  lastAt = 0;
  lastWasText = false;
}

/** Start again from this definition — used when a new model is opened. */
export function resetHistory(def: ScheduleDef) {
  undoStack = [];
  redoStack = [];
  current = JSON.stringify(def);
  currentShape = shapeOf(def);
  lastAt = 0;
  lastWasText = false;
}

/**
 * The previous definition, or null if there is nothing to undo. `record` will see the
 * restored state as unchanged, so applying the result does not push a new entry.
 */
export function undo(): ScheduleDef | null {
  if (!undoStack.length || current === null) return null;
  const prev = undoStack.pop()!;
  redoStack.push(current);
  current = prev;
  currentShape = shapeOf(JSON.parse(prev) as ScheduleDef);
  lastAt = 0;
  lastWasText = false;
  return JSON.parse(prev) as ScheduleDef;
}

export function redo(): ScheduleDef | null {
  if (!redoStack.length || current === null) return null;
  const next = redoStack.pop()!;
  undoStack.push(current);
  current = next;
  currentShape = shapeOf(JSON.parse(next) as ScheduleDef);
  lastAt = 0;
  lastWasText = false;
  return JSON.parse(next) as ScheduleDef;
}

export const undoDepth = () => undoStack.length;
/** Tests only: the app shows one depth, and it is the undo one. */
export const redoDepth = () => redoStack.length;

/** Tests only: make the burst window deterministic. */
export function setClock(fn: () => number) { now = fn; }
