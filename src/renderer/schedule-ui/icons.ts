// The Schedules window's glyphs, as SVG strings — 2026-09-25, phase 2.
//
// Drawn in `app/icons.tsx`'s idiom rather than ifcTable's filled one: a 24-unit viewBox,
// `fill="none"`, `stroke="currentColor"` at the toolbar's 1.7, round caps and joins, 16 px in
// a 30 px button. Where the main window already has the glyph (Filter, Cross, the chevrons,
// Revert for undo, Schedules) the path is copied from there, so one idea looks one way in
// both windows. Strings rather than components: this window is vanilla DOM.

const svg = (body: string, size = 16, weight = 1.7) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
  + ` stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
  + ` focusable="false">${body}</svg>`;

/** `icons.tsx` Cross: the × on every remove / close button. */
export const cross = (size = 12, weight = 2) => svg('<path d="M6 6l12 12M18 6L6 18"/>', size, weight);
/** `icons.tsx` ChevronLeft / ChevronRight. */
export const chevronLeft = (size = 14) => svg('<path d="M15 6l-6 6 6 6"/>', size, 1.8);
export const chevronRight = (size = 14) => svg('<path d="M9 6l6 6-6 6"/>', size, 1.8);

/** The five inspector tabs. */
export const TAB_ICONS = {
  // Three columns.
  fields: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.2 4.5v15M14.8 4.5v15"/>'),
  // `icons.tsx` IconFilter.
  filter: svg('<path d="M3 5h18l-7 8v6l-4 2v-8z"/>'),
  // Three bars shortening: sort and nest.
  sort: svg('<path d="M4 6h16M4 12h11M4 18h6"/>'),
  // Two sliders.
  format: svg('<path d="M3 7h18M3 17h18"/><circle cx="15" cy="7" r="2.4" fill="var(--card)"/><circle cx="8.5" cy="17" r="2.4" fill="var(--card)"/>'),
  // Half-filled disc: how it looks.
  appearance: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>'),
} as const;

/** The header's actions. */
// Four cards: start from a template.
export const templates = svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/>');
// A bookmark: the setups kept in this window.
export const saved = svg('<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>');
// A bookmark taking a plus: save this setup.
export const save = svg('<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/><path d="M12 7.5v5M9.5 10h5"/>');
// A tray with an arrow leaving it: export (phase 4).
export const exportFile = svg('<path d="M12 14.5V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4 13.5v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>');
export const print = svg('<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="1.5"/><path d="M7 14h10v6.5H7z"/>');
// `icons.tsx` Revert, at the toolbar's weight; redo is its mirror.
export const undo = svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V10H9"/>');
export const redo = svg('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4.5V10H15"/>');

/** A over Z with a downward arrow — ifcTable's own glyph, kept from phase 1. */
export const AZ = svg('<path d="M2.2 11 6 3.2 9.8 11M3.7 8.6h4.6"/><path d="M2.5 14h7l-7 6.8h7"/><path d="M16.8 3.8v16M13.6 16.4l3.2 3.4 3.2-3.4"/>', 15);
/** A sidebar with its column filled — collapse the rail. */
export const panel = svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15"/>', 15);

/** Six dots: the grip a row is dragged by. Filled, since dots have no stroke to speak of. */
export const grip = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/></svg>`;

/** Left / centre / right as the alignment itself — ifcTable's bars, at SGVue's weight. */
export const align = (bars: [string, string, string]) =>
  svg(`<path d="${bars.join('')}"/>`, 14, 1.8);
