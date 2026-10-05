// Ported from ifcTable's `tests/acts.test.ts` for the Schedules window (2026-09-25, phase 2):
// every button there is wired by a `data-act` name matched with a delegated
// selector in events.ts. Nothing else connects the two: a typo on either side produces a
// control that looks perfectly normal and silently does nothing, and no other test in the
// suite can see it. So the two lists are checked against each other here.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const UI = resolve(__dirname, '../../../src/renderer/schedule-ui');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full)
      : full.endsWith('.ts') ? [full] : [];
  });
}

const files = walk(UI);
const read = (f: string) => readFileSync(f, 'utf8');
const events = read(resolve(UI, 'events.ts'));

/** Act names written into markup, from every ui module except the wiring itself. */
const emitted = new Set<string>();
/** Act names an emitter builds from a variable — resolved from the helper's call sites. */
const interpolated: string[] = [];

for (const f of files) {
  if (f.endsWith('events.ts')) continue;
  const src = read(f);
  for (const m of src.matchAll(/data-act="([a-z][a-z0-9-]*)"/g)) emitted.add(m[1]);
  // Three places build the name instead of writing it. Each is resolved by reading the
  // literals that reach it; a FOURTH such helper must be added here or its controls go
  // unchecked. That is the price of not having a DOM test harness.
  for (const m of src.matchAll(/data-act="\$\{([^}]*)\}"/g)) {
    // e.g. data-act="${inUse ? 'browse-remove' : 'browse-add'}"
    for (const lit of m[1].matchAll(/'([a-z][a-z0-9-]*)'/g)) interpolated.push(lit[1]);
  }
  // appearanceSection: toggle('app-grid', …)   shared.ts is called as fieldSelect(…, 'filter-field', …)
  // The lookbehind matters: `classList.toggle('lit')` is a CSS class, not an act name, and
  // a bare \b matches straight after the dot.
  for (const m of src.matchAll(/(?<![.\w])toggle\('([a-z][a-z0-9-]*)'/g)) interpolated.push(m[1]);
  for (const m of src.matchAll(/\bfieldSelect\([^)]*?'([a-z][a-z0-9-]*)'/g)) interpolated.push(m[1]);
  // SGVue's header (2026-09-25): tool('undo', …) — the fourth helper, added as the note says.
  for (const m of src.matchAll(/(?<![.\w])tool\('([a-z][a-z0-9-]*)'/g)) interpolated.push(m[1]);
}
for (const a of interpolated) emitted.add(a);

/** Act names events.ts listens for, including the ones it builds from a variable. */
const handled = new Set<string>();
for (const m of events.matchAll(/\[data-act="([a-z][a-z0-9-]*)"\]/g)) handled.add(m[1]);
for (const m of events.matchAll(/(?<![.\w])toggle\('([a-z][a-z0-9-]*)'/g)) handled.add(m[1]);

/**
 * Acts that legitimately appear on only one side. Keep this empty if you can — an entry
 * here is a promise that the control works for some other reason.
 *
 * The two drag handles are that case: dnd.ts finds them by their `.handle` class, not by
 * act. They carry a data-act anyway because that is how preserve.ts names a control when
 * restoring focus to it after a repaint. The inspector's resize grip is the same shape:
 * ui/resize.ts owns its pointer events, delegated from the root like everything else.
 */
const ALLOW_UNHANDLED = ['col-handle', 'lvl-handle', 'panel-resize'];
const ALLOW_UNEMITTED: string[] = [];

/**
 * Comments are stripped before any of these patterns run. Both of the things banned below
 * are NAMED in the comments that explain why they are banned, and a tripwire that matches
 * its own documentation passes for the wrong reason.
 */
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('a repaint cannot swallow the click that caused it', () => {
  // Every item in the Export menu was dead in the shipped app, and no test could see it:
  // the acts matched, the handlers existed, and clicking one from a script worked.
  //
  // On a real pointer click the browser flushes microtasks BETWEEN listener callbacks. The
  // capture-phase handler that closes the menu repainted in a microtask, so the clicked
  // button left the document before the bubble-phase handler's turn — and that handler
  // then rejected it for no longer being inside the root it had just been clicked in.
  // Two independent guards, each harmless alone, silently fatal together.
  const dom = strip(read(resolve(UI, 'dom.ts')));
  const events = strip(read(resolve(UI, 'events.ts')));

  it('found the code, so the test is not vacuously passing', () => {
    expect(dom).toMatch(/addEventListener\('click'/);
    // SGVue has no app-bar menu; the delegated handlers are what this guards.
    expect(events).toMatch(/onClick\(root, /);
  });

  it('never rejects a clicked element for having left the document', () => {
    expect(dom, 'a delegated handler must still run for an element a repaint detached mid-click')
      .not.toMatch(/root\.contains\(/);
  });

  it('never repaints from a microtask while a click is still being dispatched', () => {
    expect(events, 'a microtask lands BETWEEN listeners, not after the event — use a task')
      .not.toMatch(/queueMicrotask/);
  });
});

describe('a backdrop closes only for a click that also began on it', () => {
  // Dragging to select the text in an overlay's search box and letting go over the dimmed
  // surround closed the panel. `click` is dispatched on the nearest common ancestor of the
  // press and release targets, so a press inside the card and a release on the backdrop
  // arrive at the handler with `ev.target` set to the backdrop — indistinguishable from
  // someone clicking the surround to dismiss. Where the press began is the only difference,
  // and nothing but a pointerdown listener can see it.
  const events = strip(read(resolve(UI, 'events.ts')));
  const press = events.match(/root\.addEventListener\('pointerdown',[\s\S]*?\n  \}\);/)?.[0] ?? '';
  const close = events.match(/onClick\(root, '\[data-act="overlay-backdrop"\]'[\s\S]*?\n  \}\);/)?.[0] ?? '';

  it('found both halves, so the test is not vacuously passing', () => {
    expect(close).toMatch(/update\(\{ overlay: null \}\)/);
    expect(press, 'wireOverlays must record the press origin on pointerdown')
      .toMatch(/overlay-backdrop/);
  });

  it('the close consults the press origin, not only the release target', () => {
    expect(close, 'ev.target alone cannot tell a drag-select from a click on the surround')
      .toMatch(/pressOnBackdrop/);
  });
});

describe('one name for an element position', () => {
  // data-i, data-col, data-c and data-idx all meant "index in a list". Two bugs came from
  // the focus and reorder code disagreeing about which one identified an element, so there
  // is now exactly one name. data-defcol is the one deliberate exception, and is named so
  // it cannot be mistaken for a position: it carries where a header's column sits in
  // def.columns, which differs from its visible index as soon as a column is hidden.
  //
  // An ALLOWLIST, not a blocklist. Banning the three names that were actually removed only
  // guards against those three coming back — inventing a fourth (data-pos, data-n, data-at)
  // sailed straight through, which is the failure this rule exists to prevent. Adding a name
  // here has to be a decision; and preserve.ts's KEYS list has to learn it too, or a control
  // carrying it loses focus on the next repaint.
  // SGVue adds four, each a decision: `tip` is the main window's tooltip attribute
  // (design.css), `row` is a data row's index in the result on screen (the row click that
  // selects in 3D), `answer` is which button of the window's dialog was pressed, and `theme`
  // is the <html> theme switch the main window drives. ifcTable's `phase` went with its
  // loading screen.
  const ALLOWED = new Set([
    'act', 'i', 'id', 'v', 'drag', 'name', 'section', 'defcol',
    'type', 'pset', 'fg', 'bg', 'entity',
    'tip', 'row', 'answer', 'theme',
  ]);
  const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

  it('found attributes at all, so the test is not vacuously passing', () => {
    const all = files.flatMap((f) => [...read(f).matchAll(/\bdata-([a-z][a-z0-9-]*)=/g)].map((m) => m[1]));
    expect(new Set(all).size).toBeGreaterThan(8);
  });

  it('emits only data-* names that are on the list', () => {
    for (const f of files) {
      const used = [...read(f).matchAll(/\bdata-([a-z][a-z0-9-]*)=/g)].map((m) => m[1]);
      const strangers = [...new Set(used)].filter((n) => !ALLOWED.has(n));
      expect(strangers, `${f} emits a data-* name nobody decided on`).toEqual([]);
    }
  });

  it('reads back only data-* names that are on the list', () => {
    const allowedReads = new Set([...ALLOWED].map(camel));
    for (const f of files) {
      const read_ = [...read(f).matchAll(/\bdataset\.([A-Za-z][A-Za-z0-9]*)\b/g)].map((m) => m[1]);
      const strangers = [...new Set(read_)].filter((n) => !allowedReads.has(n));
      expect(strangers, `${f} reads a data-* name nothing emits`).toEqual([]);
    }
  });
});

describe('every data-act is wired', () => {
  it('found both lists, so the test is not vacuously passing', () => {
    expect(emitted.size).toBeGreaterThan(30);
    expect(handled.size).toBeGreaterThan(30);
  });

  it('every act written into markup has a handler', () => {
    const dead = [...emitted].filter((a) => !handled.has(a) && !ALLOW_UNHANDLED.includes(a));
    expect(dead, 'these controls render but nothing listens for them').toEqual([]);
  });

  it('every handler has something that emits it', () => {
    const orphan = [...handled].filter((a) => !emitted.has(a) && !ALLOW_UNEMITTED.includes(a));
    expect(orphan, 'these handlers can never fire — dead wiring').toEqual([]);
  });
});
