// CSV.

import type { ExportRow } from './rows';

/**
 * Element names come from the IFC file, so a cell can start with = + - or @, which Excel
 * and Sheets treat as a formula. A leading apostrophe makes them show the text instead.
 * Negative numbers are left alone — "-5" is a number, not a formula.
 */
function defuse(s: string): string {
  return /^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?[\d.,]+$/.test(s)) ? `'${s}` : s;
}

/** RFC 4180 quoting: wrap when the value contains a delimiter, quote or newline. */
export function csvCell(v: string): string {
  const s = defuse(String(v ?? ''));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExportRow[]): string {
  return rows.map((r) => r.cells.map(csvCell).join(',')).join('\r\n');
}

/**
 * Excel reads a bare UTF-8 CSV as the system codepage, which mangles m², °, and
 * non-ASCII names. A BOM makes it read UTF-8. Written as an escape, not as the character
 * itself: an invisible U+FEFF in the source is a thing no reader or diff can see.
 */
export function csvBlob(csv: string): Blob {
  return new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
}
