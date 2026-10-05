// The Schedules window's own confirm and prompt, and what gets the focus when one opens —
// 2026-10-02, the follow-up to phase 4 of the assistant's parity work.
//
// A confirm the user's own click raised puts the focus on its confirm button, as it always has:
// they asked for it. One raised **for the assistant** (`schedule-ui/manage.ts`) appears while
// the user may be typing — in that window, or in the main window's chat as the Schedules window
// comes forward — and a focused button answers to Enter and Space: the next space of a sentence
// would delete a saved template. So a question raised for the assistant takes **no default
// button**. The focus goes to the dialog's card, which no key answers but Escape; Tab reaches
// Cancel first, then the confirm.
//
// Runs in Node, as every test of this window does. This repository has no DOM library, so the
// page is stood in for: a small element tree that parses the dialog's own markup, with the
// three browser rules the dialog leans on written out —
//
//   · what can take the focus: a button, an input, or anything that carries a `tabindex`. A
//     bare `<div>` cannot, so a card that lost its `tabindex` would leave the focus where it was;
//   · what a key does when the page did not take it: Enter or Space on a focused button is a
//     click on it, and Tab goes to the next thing Tab can reach, in document order;
//   · an event goes up from its target through its ancestors.
//
// That the real Chromium does the same is the e2e's to show (`tests/e2e/schedules.spec.ts`).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Ev {
  type: string;
  target: El;
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/** What `esc()` (`schedule-ui/dom.ts`) wrote, read back. */
const unescape = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** One element of the stand-in page: as much of one as dialog.ts and focus-trap.ts touch. */
class El {
  parent: El | null = null;
  children: El[] = [];
  readonly attrs = new Map<string, string>();
  text = '';
  value = '';
  selected = false;
  private readonly listeners = new Map<string, ((e: Ev) => void)[]>();

  constructor(readonly tag: string, private readonly page: Page) {}

  get className(): string { return this.attrs.get('class') ?? ''; }
  set className(v: string) { this.attrs.set('class', v); }
  get dataset(): Record<string, string> {
    return Object.fromEntries([...this.attrs].filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v]));
  }
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  get isConnected(): boolean { return this.page.body.contains(this); }

  /** The dialog's markup: tags, quoted attributes, text — and `<input>`, which has no end tag. */
  set innerHTML(html: string) {
    this.children = [];
    let at: El = this;
    for (const m of html.matchAll(/<(\/?)([a-z]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g)) {
      if (m[4] !== undefined) at.text += unescape(m[4].trim());
      else if (m[1]) at = at === this ? at : at.parent!;
      else {
        const el = at.appendChild(new El(m[2], this.page));
        for (const a of m[3].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) el.attrs.set(a[1], unescape(a[2] ?? ''));
        el.value = el.attrs.get('value') ?? '';
        if (el.tag !== 'input') at = el;
      }
    }
  }

  appendChild(child: El): El { child.parent = this; this.children.push(child); return child; }
  remove(): void {
    if (!this.parent) return;
    // What a browser does when the focused element leaves the page: the focus falls to <body>.
    if (this.page.active && this.contains(this.page.active)) this.page.active = null;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  contains(other: El): boolean {
    for (let n: El | null = other; n; n = n.parent) if (n === this) return true;
    return false;
  }
  /** Everything inside, in document order. */
  descendants(): El[] { return this.children.flatMap((c) => [c, ...c.descendants()]); }

  /** A selector list of `tag`, `.class`, `[attr]`, `[attr="v"]` and `:not([…])` — all that is asked. */
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      let rest = part.trim();
      const tag = /^[a-z]+/.exec(rest)?.[0];
      if (tag) {
        if (tag !== this.tag) return false;
        rest = rest.slice(tag.length);
      }
      for (const m of rest.matchAll(/\.([\w-]+)|(:not\()?\[([\w-]+)(?:="([^"]*)")?\]\)?/g)) {
        if (m[1]) {
          if (!this.className.split(/\s+/).includes(m[1])) return false;
          continue;
        }
        const has = m[4] === undefined ? this.attrs.has(m[3]) : this.attrs.get(m[3]) === m[4];
        if (has === !!m[2]) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector: string): El[] { return this.descendants().filter((e) => e.matches(selector)); }
  querySelector(selector: string): El | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): El | null {
    for (let n: El | null = this; n; n = n.parent) if (n.matches(selector)) return n;
    return null;
  }
  /** Laid out — which is all `focusables` asks of it — exactly while it is in the page. */
  getClientRects(): unknown[] { return this.isConnected ? [{}] : []; }

  /** The HTML rule: a button, an input, or anything that carries a `tabindex`. */
  get focusable(): boolean { return this.tag === 'button' || this.tag === 'input' || this.attrs.has('tabindex'); }
  /** What Tab reaches: focusable, and not taken out of the order by `tabindex="-1"`. */
  get tabbable(): boolean { return this.focusable && this.attrs.get('tabindex') !== '-1'; }
  focus(): void { if (this.focusable && this.isConnected) this.page.active = this; }
  select(): void { this.selected = true; }

  addEventListener(type: string, fn: (e: Ev) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  /** From here up through every ancestor, until a listener stops it. */
  dispatch(type: string, init: Partial<Pick<Ev, 'key' | 'shiftKey'>> = {}): Ev {
    const e: Ev = {
      type, target: this, key: '', shiftKey: false, defaultPrevented: false, stopped: false,
      preventDefault() { e.defaultPrevented = true; },
      stopPropagation() { e.stopped = true; },
      ...init,
    };
    for (let n: El | null = this; n && !e.stopped; n = n.parent) {
      for (const fn of n.listeners.get(type) ?? []) fn(e);
    }
    return e;
  }
}

/** The stand-in page: a body, what has the focus, and a keyboard and a mouse. */
class Page {
  readonly body: El = new El('body', this);
  /** `null` is the browser's "nothing has it": `document.activeElement` is then `<body>`. */
  active: El | null = null;
  readonly document = (() => {
    const page = this;
    return {
      body: page.body,
      createElement: (tag: string): El => new El(tag, page),
      get activeElement(): El { return page.active ?? page.body; },
    };
  })();

  el(tag: string): El { return new El(tag, this); }

  /** One key press: the page's own listeners first, then what the browser does with it. */
  press(key: string, shiftKey = false): void {
    const at = this.document.activeElement;
    if (at.dispatch('keydown', { key, shiftKey }).defaultPrevented) return;
    if ((key === 'Enter' || key === ' ') && at.tag === 'button') {
      at.dispatch('click');
      return;
    }
    if (key !== 'Tab') return;
    const order = this.body.descendants();
    const from = order.indexOf(at);
    const stops = order.filter((e) => e.tabbable);
    const next = shiftKey
      ? [...stops].reverse().find((e) => order.indexOf(e) < from) ?? stops.at(-1)
      : stops.find((e) => order.indexOf(e) > from) ?? stops[0];
    next?.focus();
  }

  /** A real click: the press, the release, the click — where the pointer is. */
  click(el: El): void {
    el.dispatch('pointerdown');
    el.dispatch('pointerup');
    el.dispatch('click');
  }
}

type Dialog = typeof import('../../../src/renderer/schedule-ui/dialog');

let page: Page;
/** What had the focus before the question: the control that asked — or whatever the user was in. */
let opener: El;
let dialog: Dialog;

beforeEach(async () => {
  page = new Page();
  opener = page.body.appendChild(page.el('button'));
  opener.focus();
  vi.stubGlobal('document', page.document);
  // The module keeps the open dialog; each test starts with none.
  vi.resetModules();
  dialog = await import('../../../src/renderer/schedule-ui/dialog');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const UNANSWERED = 'unanswered' as const;
/** What a question has been answered — or that it has not, once every pending callback has run. */
async function answerOf<T>(asked: Promise<T>): Promise<T | typeof UNANSWERED> {
  await new Promise((r) => setTimeout(r, 0));
  return Promise.race([asked, Promise.resolve(UNANSWERED)]);
}

const card = (): El => page.body.querySelector('.dlg')!;
const button = (answer: 'ok' | 'cancel'): El => card().querySelector(`[data-answer="${answer}"]`)!;
const focused = (): El => page.document.activeElement;

const FOR_ASSISTANT = { title: 'Ask Vee', forAssistant: true };
const DELETE = 'Delete the saved template “Doors”? This cannot be undone.';

describe('a confirm the user’s own click raised — as it always was', () => {
  it('puts the focus on its confirm button, which Enter and Space answer', async () => {
    for (const key of ['Enter', ' ']) {
      const asked = dialog.confirmDialog('Replace the current schedule setup?', 'Replace');
      expect(card().querySelector('.dlg-label')!.textContent).toBe('Schedules');
      expect(button('ok').textContent).toBe('Replace');
      expect(focused()).toBe(button('ok'));
      // The card is not something the focus can be put on: its markup is what it was.
      expect([...card().attrs.keys()]).toEqual(['class', 'role', 'aria-modal', 'aria-labelledby', 'aria-describedby']);
      page.press(key);
      expect([key, await answerOf(asked)]).toEqual([key, true]);
      expect(dialog.dialogOpen()).toBe(false);
      expect(focused()).toBe(opener);
    }
  });

  it('is not changed by its label: the focus rule is said by whoever asks, never read off the title', async () => {
    const asked = dialog.confirmDialog(DELETE, 'Delete', true, { title: 'Ask Vee' });
    expect(card().querySelector('.dlg-label')!.textContent).toBe('Ask Vee');
    expect(focused()).toBe(button('ok'));
    expect(card().attrs.has('tabindex')).toBe(false);
    page.press('Enter');
    expect(await answerOf(asked)).toBe(true);
  });

  it('a prompt puts the focus in its text box, with the text selected, and Enter there answers', async () => {
    const asked = dialog.promptDialog('Rename this template', 'Doors', 'Rename');
    const input = card().querySelector('.dlg-field')!;
    expect(focused()).toBe(input);
    expect([input.value, input.selected]).toEqual(['Doors', true]);
    input.value = 'Doors L2';
    page.press('Enter');
    expect(await answerOf(asked)).toBe('Doors L2');
    expect(focused()).toBe(opener);
  });
});

describe('a confirm raised for the assistant — no default button', () => {
  it('puts the focus on the dialog itself, and neither Enter nor Space answers it', async () => {
    const asked = dialog.confirmDialog(DELETE, 'Delete', true, FOR_ASSISTANT);
    // The same words and the same two buttons, under the assistant's name.
    expect(card().querySelector('.dlg-label')!.textContent).toBe('Ask Vee');
    expect(card().querySelector('.dlg-message')!.textContent).toBe(DELETE);
    expect([button('cancel').textContent, button('ok').textContent]).toEqual(['Cancel', 'Delete']);
    // The card can take the focus, has it, and is not a stop of its own for Tab.
    expect(card().attrs.get('tabindex')).toBe('-1');
    expect(focused()).toBe(card());
    for (const key of ['Enter', ' ', 'Enter', ' ']) {
      page.press(key);
      expect([key, await answerOf(asked)]).toEqual([key, UNANSWERED]);
      expect([dialog.dialogOpen(), card().isConnected]).toEqual([true, true]);
      expect(focused()).toBe(card());
    }
    // A real click on Delete is what answers it.
    page.click(button('ok'));
    expect(await answerOf(asked)).toBe(true);
    expect(dialog.dialogOpen()).toBe(false);
    expect(focused()).toBe(opener);
  });

  it('Tab reaches Cancel first, then the confirm, and stays inside the dialog', async () => {
    const asked = dialog.confirmDialog(DELETE, 'Delete', true, FOR_ASSISTANT);
    page.press('Tab');
    expect(focused()).toBe(button('cancel'));
    page.press('Tab');
    expect(focused()).toBe(button('ok'));
    // Off the last control Tab comes round to the first, and Shift+Tab goes back again.
    page.press('Tab');
    expect(focused()).toBe(button('cancel'));
    page.press('Tab', true);
    expect(focused()).toBe(button('ok'));
    expect(await answerOf(asked)).toBe(UNANSWERED);
    // Whoever walks to the confirm on purpose can press it: that key press is no accident.
    page.press('Enter');
    expect(await answerOf(asked)).toBe(true);
  });

  it('Shift+Tab from the dialog itself goes to its last control — never to the page behind', () => {
    void dialog.confirmDialog(DELETE, 'Delete', true, FOR_ASSISTANT);
    expect(focused()).toBe(card());
    page.press('Tab', true);
    expect(focused()).toBe(button('ok'));
  });

  it('Escape cancels, and so does Cancel — and the focus goes back to what had it', async () => {
    const first = dialog.confirmDialog(DELETE, 'Delete', true, FOR_ASSISTANT);
    page.press('Escape');
    expect(await answerOf(first)).toBe(false);
    expect([dialog.dialogOpen(), page.body.querySelector('.dlg-scrim')]).toEqual([false, null]);
    expect(focused()).toBe(opener);

    const second = dialog.confirmDialog('Open the print dialog for this schedule?', 'Print…', false, FOR_ASSISTANT);
    expect(button('ok').textContent).toBe('Print…');
    expect(focused()).toBe(card());
    page.click(button('cancel'));
    expect(await answerOf(second)).toBe(false);
    expect(focused()).toBe(opener);
  });

  it('a second question answers the one that is up "cancel" — it is never left hanging', async () => {
    const first = dialog.confirmDialog(DELETE, 'Delete', true, FOR_ASSISTANT);
    const second = dialog.confirmDialog('Replace the current schedule setup?', 'Replace');
    expect(await answerOf(first)).toBe(false);
    expect(page.body.querySelectorAll('.dlg')).toHaveLength(1);
    // The one that is up now is the user's own, with the focus where theirs goes.
    expect(focused()).toBe(button('ok'));
    page.press('Escape');
    expect(await answerOf(second)).toBe(false);
  });
});
