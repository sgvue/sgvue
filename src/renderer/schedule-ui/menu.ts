// The right-click menu of the Schedules window — 2026-09-25, phase 3.
//
// `app/ContextMenu.tsx`, in vanilla DOM: the same `role="menu"` box and `menuitem` buttons,
// the same two style strings byte for byte, the same `hv-step` hover, the same clamping
// (`clampCtxX`, and `clampCtxY` against the menu's own measured height) and the same keyboard
// contract — focus goes to the first item, arrows / Home / End rove, Tab stays inside, Escape
// closes, and focus goes back to whatever had it. What is new is one state the main menu never
// needed: an item that would do nothing is `disabled` — no hover class, the window's own
// `button:disabled` opacity (.45), skipped by the roving focus. The shortcut column stays
// empty: the main window's H / I / F keys are that window's, not this one's.
//
// Created once per opening, outside `#app`, so no repaint can rebuild it under the pointer; it
// closes on a pick, Escape, a press anywhere else, the window losing focus, or a resize.

import { clampCtxX, clampCtxY } from '../state/selectors/ctx';
import { focusables, trapTab } from '../app/focus-trap';
import { DEVTOOLS } from '../dev/flags';
import { esc } from './dom';

export interface MenuEntry {
  label: string;
  disabled?: boolean;
  /** A separator above this entry — ContextMenu's `border-top`. */
  sep?: boolean;
  run: () => void;
}

const BOX = 'position:fixed;left:{x}px;top:{y}px;min-width:200px;display:flex;flex-direction:column;padding:4px;background:var(--card);border:1px solid var(--border-strong);border-radius:8px;box-shadow:var(--shadow);z-index:10;animation:fadein .1s ease-out';
const ITEM = 'display:flex;justify-content:space-between;gap:12px;font:400 13px/1.3 var(--sans);color:var(--ink);padding:7px 10px;border-radius:6px;border-top:{top}';
const KEY = 'font:400 11px/1.3 var(--mono);color:var(--faint)';

let current: { box: HTMLElement; opener: HTMLElement | null; off: () => void } | null = null;

export const menuOpen = (): boolean => !!current;

/** Why a menu closed. */
type CloseReason = 'pick' | 'escape' | 'outside' | 'blur' | 'resize' | 'reopen';

/**
 * Whether to say why each menu closed (`console.debug`): in a development build, and in a run
 * started by a guard script, which main marks with `#guarded` on this page's URL (only when
 * unpackaged, `schedules-window.ts`). A menu that vanishes in a test then names its trigger.
 */
const logCloses = (): boolean =>
  DEVTOOLS || (typeof location !== 'undefined' && location.hash === '#guarded');

export function closeMenu(reason: CloseReason): void {
  if (!current) return;
  if (logCloses()) console.debug(`[menu] closed: ${reason}`);
  const { box, opener, off } = current;
  current = null;
  off();
  // Focus goes back only if the menu still had it — a click elsewhere has moved it on purpose.
  const active = document.activeElement;
  const ours = !active || active === document.body || box.contains(active);
  box.remove();
  if (ours && opener?.isConnected) opener.focus({ preventScroll: true });
}

/** Open a menu at the pointer (viewport coordinates). */
export function openMenu(x: number, y: number, entries: MenuEntry[], label: string): void {
  closeMenu('reopen');
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const box = document.createElement('div');
  box.setAttribute('role', 'menu');
  box.setAttribute('aria-label', label);
  box.className = 'ctx-menu';
  box.tabIndex = -1;
  box.style.cssText = BOX.replace('{x}', String(clampCtxX(x, window.innerWidth))).replace('{y}', String(y));
  box.innerHTML = entries.map((m, i) =>
    `<button role="menuitem" tabindex="-1" data-i="${i}"${m.disabled ? ' disabled aria-disabled="true"' : ' class="hv-step"'}`
    + ` style="${ITEM.replace('{top}', m.sep ? '1px solid var(--border)' : '0')}">`
    + `<span>${esc(m.label)}</span><span style="${KEY}"></span></button>`).join('');
  document.body.appendChild(box);
  // Clamped against its own height, measured before the first paint (ContextMenu.tsx's
  // layout effect).
  box.style.top = `${clampCtxY(y, box.offsetHeight, window.innerHeight)}px`;

  const items = () => focusables(box);
  const move = (to: number) => {
    const list = items();
    // Every item disabled: the box itself holds focus, so Escape still reaches it.
    if (!list.length) { box.focus(); return; }
    const el = list[(to + list.length) % list.length];
    for (const b of box.querySelectorAll<HTMLElement>('[role="menuitem"]')) b.tabIndex = b === el ? 0 : -1;
    el.focus();
  };

  // A right-click inside the menu is not a second menu, and not the page's.
  box.addEventListener('contextmenu', (ev) => ev.preventDefault());
  box.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
    if (!b || b.disabled) return;
    const entry = entries[Number(b.dataset.i)];
    closeMenu('pick');
    entry?.run();
  });
  box.addEventListener('keydown', (ev) => {
    const list = items();
    const at = Math.max(0, list.indexOf(document.activeElement as HTMLElement));
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (ev.key === 'ArrowDown') { stop(); move(at + 1); return; }
    if (ev.key === 'ArrowUp') { stop(); move(at - 1); return; }
    if (ev.key === 'Home') { stop(); move(0); return; }
    if (ev.key === 'End') { stop(); move(list.length - 1); return; }
    if (ev.key === 'Escape') { stop(); closeMenu('escape'); return; }
    if (trapTab(box, ev)) ev.preventDefault();
    // Enter and Space are the focused button's own click.
    ev.stopPropagation();
  });

  const outside = (ev: Event) => { if (!box.contains(ev.target as Node)) closeMenu('outside'); };
  const blur = () => closeMenu('blur');
  const resize = () => closeMenu('resize');
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('blur', blur);
  window.addEventListener('resize', resize);
  current = {
    box,
    opener,
    off: () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', resize);
    },
  };
  move(0);
}
