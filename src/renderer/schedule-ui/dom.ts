// Tiny DOM helpers, ported from ifcTable's `ui/dom.ts` (2026-09-25). Every string that
// reaches innerHTML goes through esc() first — IFC files are user data and can contain
// anything, including angle brackets. What SGVue leaves out: `download` — a file is written by
// main behind the native Save dialog (phase 4, `exporting.ts`), never by an `<a download>`.

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Keep a number inside a range. Rounding is the caller's business — a width rounds, a
 *  percentage does not. */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * A filename the user's own text can be dropped into: their words where they are usable,
 * and a fallback rather than an empty name. Only word characters, hyphens and spaces survive,
 * so nothing Windows refuses in a name (`<>:"/\|?*`) can reach the Save dialog.
 */
export function safeName(name: string, fallback = 'schedule'): string {
  return (name.trim() || fallback).replace(/[^\w\- ]+/g, '').trim() || fallback;
}

/**
 * Every export's suggested filename: what it holds, then the day it was taken —
 * `Door Schedule — 2026-09-11.csv`. A schedule is a snapshot of a model that gets revised,
 * so the date is the difference between two exports in a folder and an argument about
 * which one is current.
 *
 * The date is built from the LOCAL calendar, never `toISOString()`: that is UTC, which
 * names yesterday for the last eight hours of every Singapore day.
 *
 * The whole name stays within `EXPORT_NAME_MAX`, the cap main's `ExportSaveRequest` puts on
 * `suggestedName` (`shared/ipc-contract.ts`): each part is cut to an equal share of what the
 * separators, the date and the extension leave, so a 200-character schedule name still exports.
 */
export const EXPORT_NAME_MAX = 200;

export function exportName(parts: string[], ext: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const room = EXPORT_NAME_MAX - (today.length + ext.length + 1 + parts.length * 3);
  const share = Math.max(1, Math.floor(room / Math.max(1, parts.length)));
  return `${[...parts.map((p) => safeName(p).slice(0, share).trim()), today].join(' — ')}.${ext}`;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/**
 * Delegated event handling, so re-rendering innerHTML never orphans a listener.
 *
 * These deliberately do NOT re-test `root.contains(target)`. The event's path is fixed
 * when dispatch begins, so anything that reaches this listener came from inside `root` by
 * construction — the test could only ever fail for an element that something detached
 * DURING the dispatch, and a control the user really clicked must still do its job on the
 * way out (ifcTable LESSONS, 2026-08-10).
 */
export function onClick(root: HTMLElement, selector: string, fn: (el: HTMLElement, ev: MouseEvent) => void) {
  root.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement)?.closest(selector);
    if (target) fn(target as HTMLElement, ev as MouseEvent);
  });
}

export function onChange(root: HTMLElement, selector: string, fn: (el: HTMLElement) => void) {
  root.addEventListener('change', (ev) => {
    const target = (ev.target as HTMLElement)?.closest(selector);
    if (target) fn(target as HTMLElement);
  });
}

export function onInput(root: HTMLElement, selector: string, fn: (el: HTMLElement) => void) {
  root.addEventListener('input', (ev) => {
    const target = (ev.target as HTMLElement)?.closest(selector);
    if (target) fn(target as HTMLElement);
  });
}

export function option(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

/**
 * Transient toast. Styled by `.toast` in schedule.css, which carries the themed colours
 * and — load-bearing — `pointer-events: none`: it sits above everything for 2.6s, and
 * without that every click landing on it would be swallowed.
 */
let toast: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function flash(message: string, bad = false) {
  toast?.remove();
  clearTimeout(toastTimer);
  toast = document.createElement('div');
  toast.className = bad ? 'toast bad' : 'toast';
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);
  const mine = toast;
  toastTimer = setTimeout(() => { mine.remove(); if (toast === mine) toast = null; }, 2600);
}
