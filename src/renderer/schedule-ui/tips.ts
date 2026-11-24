// Fast descriptions inside the popover, the overlays, the rail and the table (2026-11-25, the
// owner: "the hover description must be fast to show"; one rule for the window: no control
// carries a native `title`).
//
// Everywhere else the design's own tooltip is a `[data-tip]::after` box (`design.css`, about
// 0.14 s). Inside the popover, the modal cards, the rail and the table that box would be clipped
// by — or add scroll height to — the scroll container (or the clipped heading) it sits in, so there ONE fixed element, `#pop-tip`
// (schedule.html, outside every pane), shows the hovered or keyboard-focused control's
// `data-tip`, drawn from the same tokens and with the same timing (`.pop-tip`, schedule.css),
// and the `::after` boxes are switched off. It hides on leave, blur, click, scroll, resize and
// when the popover closes. The text goes in as `textContent`, never as markup.

import { onPopoverClose } from './popover';

/** Where the fixed tip stands in for the `::after` one: the popover, the modal cards, and —
 *  since fix round 1, one rule for the window — the rail and the table, whose scroll
 *  containers and clipped headings would cut an `::after` box too. */
const SCOPE = '#popover, #overlay-root, #rail-pane, #output-pane';
const EDGE = 8;
const GAP = 8;

let current: HTMLElement | null = null;
const node = () => document.getElementById('pop-tip');

function hide() {
  current = null;
  node()?.classList.toggle('on', false);
}

function show(el: HTMLElement) {
  const tip = node();
  const text = el.dataset.tip;
  if (!tip || !text) { hide(); return; }
  current = el;
  tip.textContent = text;
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  // Under the control, inside the window; above it when below has no room.
  const left = Math.max(EDGE, Math.min(r.left, innerWidth - (t.width || 0) - EDGE));
  const below = r.bottom + GAP + (t.height || 0) <= innerHeight - EDGE;
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? r.bottom + GAP : Math.max(EDGE, r.top - GAP - (t.height || 0))}px`;
  tip.classList.toggle('on', true);
}

/** The control a tip belongs to, if the event is about one inside the popover or an overlay. */
function owner(target: EventTarget | null): HTMLElement | null {
  const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]');
  return el?.closest(SCOPE) ? el : null;
}

export function wireTips(root: HTMLElement) {
  root.addEventListener('pointerover', (e) => {
    const el = owner(e.target);
    if (el) { if (el !== current) show(el); } else if (current) hide();
  });
  root.addEventListener('pointerout', (e) => {
    if (current && !current.contains((e as PointerEvent).relatedTarget as Node | null)) hide();
  });
  // A keyboard focus shows it as `:focus-visible` shows the design's.
  root.addEventListener('focusin', (e) => {
    const el = owner(e.target);
    if (el && el.matches?.(':focus-visible')) show(el);
  });
  root.addEventListener('focusout', hide);
  root.addEventListener('click', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  onPopoverClose(hide);
}
