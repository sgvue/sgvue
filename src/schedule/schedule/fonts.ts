// Body fonts for the schedule table.
//
// Every one of these is either vendored with the app or already on the machine — no font is
// ever fetched at runtime, so the stacks below all end in a generic family and degrade
// quietly on a system that lacks the first choice.
//
// "Recommended" is not a taste ranking. A schedule is a dense grid of short strings and
// numbers read at 10–13px, so the list is ordered by the things that actually matter there:
// tabular (same-width) digits so columns of numbers line up, a large x-height so lowercase
// stays legible when small, and unambiguous 1/l/I and 0/O.

interface BodyFont {
  /** Stored in ScheduleDef, so these strings are a compatibility surface — never rename. */
  key: string;
  label: string;
  stack: string;
  recommended?: boolean;
  note?: string;
}

const UI = `'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

export const BODY_FONTS: BodyFont[] = [
  // ---- recommended: chosen for dense numeric tables ----
  { key: 'plex', label: 'IBM Plex Sans', stack: UI, recommended: true,
    note: 'Bundled with the app, so it looks the same everywhere' },
  { key: 'calibri', label: 'Calibri', stack: `Calibri, Carlito, ${UI}`, recommended: true,
    note: 'The Office default — familiar, and narrow enough for wide schedules' },
  { key: 'segoe', label: 'Segoe UI', stack: `'Segoe UI', ${UI}`, recommended: true },
  { key: 'verdana', label: 'Verdana', stack: `Verdana, Geneva, ${UI}`, recommended: true,
    note: 'Designed for small sizes; the most legible when you shrink the text' },
  { key: 'cambria', label: 'Cambria', stack: `Cambria, Caladea, Georgia, serif`, recommended: true,
    note: 'A serif drawn for screens — good if you print a lot' },
  { key: 'georgia', label: 'Georgia', stack: `Georgia, Cambria, serif`, recommended: true,
    note: 'Serif with old-style figures; easy on the eye over long sessions' },

  // ---- the rest ----
  { key: 'arial', label: 'Arial', stack: `Arial, Helvetica, ${UI}` },
  { key: 'helvetica', label: 'Helvetica', stack: `Helvetica, Arial, ${UI}` },
  { key: 'tahoma', label: 'Tahoma', stack: `Tahoma, Verdana, ${UI}` },
  { key: 'trebuchet', label: 'Trebuchet MS', stack: `'Trebuchet MS', ${UI}` },
  { key: 'times', label: 'Times New Roman', stack: `'Times New Roman', Tinos, Times, serif` },
  { key: 'system', label: 'System default', stack: `system-ui, -apple-system, sans-serif` },
  { key: 'mono', label: 'Monospace', stack: `'IBM Plex Mono', ui-monospace, Consolas, monospace`,
    note: 'Every character the same width' },
];

/**
 * Schedules saved before the list grew used these three. They must keep working, so they
 * map onto the nearest equivalent rather than being rejected.
 */
const LEGACY: Record<string, string> = { sans: 'plex', serif: 'georgia' };

export function fontStack(key: string | undefined): string {
  const k = LEGACY[key ?? ''] ?? key ?? 'plex';
  return (BODY_FONTS.find((f) => f.key === k) ?? BODY_FONTS[0]).stack;
}

/** True for anything we can render, including the three legacy names. */
export function isBodyFont(key: unknown): key is string {
  return typeof key === 'string' && (key in LEGACY || BODY_FONTS.some((f) => f.key === key));
}

/** The key a picker should show as selected, with legacy names resolved. */
export function normaliseFont(key: string | undefined): string {
  return LEGACY[key ?? ''] ?? (BODY_FONTS.some((f) => f.key === key) ? key! : 'plex');
}
