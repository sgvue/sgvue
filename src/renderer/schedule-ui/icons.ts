// Every glyph the Schedules window draws, in one place — 2026-09-25, phase 2; v1.5.0, phase 3
// (ifcTable's shared icon set, `ui/icons.ts`, 2026-11-07).
//
// ifcTable's set, path for path, drawn in `app/icons.tsx`'s idiom rather than its own: a 24-unit
// viewBox, `fill="none"`, `stroke="currentColor"` at the toolbar's 1.7 (ifcTable strokes at 2),
// round caps and joins, 16 px in a 30 px button. Where the main window already has the glyph
// (Cross, ChevronRight, Revert for undo) the path is copied from there, so one idea looks one
// way in both windows. Strings rather than components: this window is vanilla DOM.
//
// An icon is decoration: the button that holds it carries the words, as `aria-label` (read
// aloud) and `title` or `data-tip` (the tooltip).
//
// Two of ifcTable's names are SGVue's own here, because the header's Export (phase 4) already
// draws an arrow LEAVING a tray: `exportFile` is that glyph, and `importFile` is the arrow coming
// in — ifcTable's `upload` and `download`, the other way round from its own naming, so that one
// arrow means one thing in this window.

const svg = (body: string, size = 16, weight = 1.7) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
  + ` stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
  + ` focusable="false">${body}</svg>`;

/** A shape filled solid in the icon's colour rather than outlined. */
const solid = (d: string) => `<path d="${d}" fill="currentColor" stroke="none"/>`;

export const ICON = {
  // The rail: a sidebar with its column ruled off, and the collapsed strip's way back
  // (`icons.tsx` ChevronRight).
  panel: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15"/>', 15),
  chevronRight: svg('<path d="M9 6l6 6-6 6"/>', 12, 1.8),
  caretDown: svg('<path d="M7 10l5 5 5-5"/>', 12, 1.8),

  // Ordering: the letters as strokes, not <text>, so no glyph depends on which font resolved.
  sortAsc: svg('<path d="M2.2 11 6 3.2 9.8 11M3.7 8.6h4.6M2.5 14h7l-7 6.8h7M16.8 3.8v16M13.6 16.4l3.2 3.4 3.2-3.4"/>'),
  sortDesc: svg('<path d="M2.5 3.2h7l-7 6.8h7M2.2 20.8 6 13 9.8 20.8M3.7 18.4h4.6M16.8 3.8v16M13.6 16.4l3.2 3.4 3.2-3.4"/>'),
  arrowLeft: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  arrowUp: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  arrowDown: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  /** A sort heading's direction mark — the arrows at 11 px. */
  up11: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 11, 2),
  down11: svg('<path d="M12 5v14M6 13l6 6 6-6"/>', 11, 2),

  // Closing and removing. Close shuts a modal (`icons.tsx` Cross); remove takes a thing off the
  // view and undo brings it back; trash deletes something saved, for good.
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 14, 1.8),
  remove: svg('<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>', 14, 1.8),
  trash: svg('<path d="M4 6.5h16M9.5 6.5v-2h5v2M6.5 6.5l.9 12.6a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4l.9-12.6M10 10.5v6M14 10.5v6"/>'),

  // Files, history and printing — the header's.
  save: svg('<path d="M5 3.5h11.5l4 4V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5zM7.5 3.5v5h8v-5M7.5 20.5v-6h9v6"/>'),
  exportFile: svg('<path d="M12 14.5V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4 13.5v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>'),
  importFile: svg('<path d="M12 3.5v11M7.5 10 12 14.5l4.5-4.5"/><path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  print: svg('<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="7.5" rx="1.5"/><path d="M7 14h10v6.5H7z"/>'),
  // `icons.tsx` Revert, at the toolbar's weight; redo is its mirror.
  undo: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V10H9"/>'),
  redo: svg('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4.5V10H15"/>'),

  // Showing and hiding.
  eye: svg('<path d="M2.5 12C4.5 8 8 5.5 12 5.5S19.5 8 21.5 12C19.5 16 16 18.5 12 18.5S4.5 16 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M2.5 12C4.5 8 8 5.5 12 5.5S19.5 8 21.5 12C19.5 16 16 18.5 12 18.5S4.5 16 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>'),

  // Cell style.
  bold: svg('<path d="M7 4.5h5.5a3.75 3.75 0 0 1 0 7.5H7zM7 12h6.5a3.75 3.75 0 0 1 0 7.5H7z" stroke-width="2.4"/>'),
  fill: svg(`<path d="M11 5l7 7-7 7-7-7zM11 5 8.5 2.5"/>${solid('M4 12h14l-7 7z')}${
    solid('M21 17.4a1.4 1.4 0 0 1-2.8 0c0-1 1.4-2.9 1.4-2.9s1.4 1.9 1.4 2.9z')}`),
  textColour: svg('<path d="M6.5 16 12 3.5 17.5 16M8.6 11.5h6.8"/><path d="M4 20.5h16" stroke-width="2.8"/>'),

  // Column widths: fit to the contents between two rules, and one width shared by several.
  autofit: svg('<path d="M3.5 4v16M20.5 4v16M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3"/>'),
  equalWidth: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M9.2 5v14M14.8 5v14"/>'),

  // The Templates library.
  rename: svg('<path d="M15.5 4.5l4 4L8.5 19.5l-5 1 1-5zM13.5 6.5l4 4"/>'),
  duplicate: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>'),
  templates: svg('<path d="M4.5 4v16M9 7v13M13.5 5.5v14.5M16.6 6.2l3.8 13.6"/>'),
  templatesLarge: svg('<path d="M4.5 4v16M9 7v13M13.5 5.5v14.5M16.6 6.2l3.8 13.6"/>', 40, 1.4),
  search: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>', 14),
} as const;

/** Six dots: the grip a row is dragged by. Filled, since dots have no stroke to speak of. */
export const grip = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11" r="1.2"/><circle cx="7" cy="11" r="1.2"/></svg>`;
