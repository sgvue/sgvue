// The ranges the Schedules window's own controls allow — one place, read by the window's
// controls and by the assistant's `make_schedule`, so the two cannot disagree (2026-11-25).
//
// A leaf module: no imports, so the shared tool catalogue can name these numbers in its words
// without pulling the schedule engine into the main process. The file reader `parseScheduleDef`
// is deliberately wider (6–48, 20–2000), so a save made outside these keeps loading unchanged.

/**
 * The Style popover's text size slider (`schedule-ui/panels/appearanceSection.ts`), in px —
 * what the user can pick, so what `make_schedule` takes.
 */
export const TEXT_SIZE_SLIDER_MIN = 10;
export const TEXT_SIZE_SLIDER_MAX = 18;

/**
 * The clamp on the text size the window commits (`schedule-ui/events.ts`), in px: wider than
 * the slider, and only the window's own guard.
 */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 24;

/** A column width, dragged or typed in the column menu's Width box (`schedule-ui/colResize.ts`), in px. */
export const COL_WIDTH_MIN = 30;
export const COL_WIDTH_MAX = 600;
