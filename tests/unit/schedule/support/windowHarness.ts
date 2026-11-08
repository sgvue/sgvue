// The Schedules window's real composition root (`schedule-ui/main.ts`), run in Node — for the
// window state-machine and message-order checks of v1.5.0 (checks 3 and 4).
//
// main.ts finds its panes by id, wires its delegated handlers on `#app`, and listens on
// `window` for the preload's re-post of the port. This stands all of that up on the fake DOM
// (`fakeDom.ts`): the nine panes it looks up, `window` / `document` with the few members the
// window's code reads (`body`, `documentElement`, `createElement` for the toast, the element
// classes an `instanceof` names, `CSS.escape`), `localStorage`, `window.print`, and the
// preload's `window.sgvueSchedule` with an Open dialog a test answers. Nothing is parsed or
// laid out — `innerHTML` is stored as written — so what runs is the window's logic: the port's
// messages, the state, the history, the library and the handlers, with every pane painted to a
// string. The window's own confirm dialog is the one thing replaced (`vi.mock` in the test,
// `dialogMock` below), because a test must answer it — as `manage.test.ts` does.
//
// Call `installWindow()` BEFORE importing main.ts (dynamically), once per test file.

import { CH_SCHEDULE_PORT } from '../../../../src/shared/ipc-channels';
import { FakeEl, installFakeDom } from './fakeDom';
import { readTable } from './htmlTable';

/**
 * `#output-pane`, whose markup is READ when it is written: each heading the table draws becomes
 * a `<th data-defcol>` element, as the browser would build it — so the column menu anchors to a
 * real heading, and closes (popover.ts `anchorPopover`) when its heading is gone, exactly as in
 * the window.
 */
class OutputPane extends FakeEl {
  private markup = '';
  override get innerHTML() { return this.markup; }
  override set innerHTML(v: string) {
    this.markup = v;
    this.writes++;
    this.children = [];
    let head: ReturnType<typeof readTable>['head'] = [];
    try { head = readTable(v).head; } catch { head = []; }
    for (const h of head) {
      if (h.attrs['data-defcol'] !== undefined) new FakeEl('th', { defcol: h.attrs['data-defcol'] }, this);
    }
  }
}

/** The confirm dialog, recorded: what was asked, and a way to answer the one that is up. */
export interface DialogMock {
  open: boolean;
  asked: { message: string; confirm: string; forAssistant: boolean }[];
  answer: (ok: boolean) => void;
}

export function dialogModule(dialog: DialogMock) {
  return {
    dialogOpen: () => dialog.open,
    confirmDialog: (message: string, confirm: string, _danger = false, how: { forAssistant?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        dialog.open = true;
        dialog.asked.push({ message, confirm, forAssistant: how.forAssistant === true });
        dialog.answer = (ok) => { dialog.open = false; dialog.answer = () => undefined; resolve(ok); };
      }),
    promptDialog: async () => null,
  };
}

/** A fake MessagePort end: what it posts goes to `send`; `deliver` runs its `onmessage`. */
export interface FakePort {
  postMessage(data: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
  closed: boolean;
}

export function fakePort(send: (data: unknown) => void): FakePort {
  const p: FakePort = {
    onmessage: null,
    closed: false,
    // The structured clone a real port makes: nothing is shared between the two pages.
    postMessage: (data) => { if (!p.closed) send(structuredClone(data)); },
    close: () => { p.closed = true; },
  };
  return p;
}

export interface Window {
  win: ReturnType<typeof installFakeDom>['win'];
  root: FakeEl;
  app: FakeEl;
  pane: (id: string) => FakeEl;
  /** localStorage's one store. */
  storage: Map<string, string>;
  /** The Open dialog main would raise: each call waits for `answerOpen`. */
  opened: ((text: string | null) => void)[];
  printed: () => number;
  /** Hand the window a port, as the preload's re-post does. */
  connect(port: FakePort): void;
  dispatch: ReturnType<typeof installFakeDom>['dispatch'];
}

const PANES = ['header', 'layout', 'rail-pane', 'output-pane', 'status-bar', 'centre-head', 'overlay-root', 'empty-pane', 'popover'];

export function installWindow(): Window {
  const dom = installFakeDom();
  const g = globalThis as Record<string, unknown>;
  const app = new FakeEl('div', {}, dom.root);
  app.attrs.id = 'app';
  for (const id of PANES) (id === 'output-pane' ? new OutputPane('div', {}, app) : new FakeEl('div', {}, app)).attrs.id = id;
  const storage = new Map<string, string>();
  const opened: ((text: string | null) => void)[] = [];
  let printed = 0;

  class FakeElement {}
  g.HTMLElement = FakeElement;
  g.HTMLInputElement = class extends FakeElement {};
  g.HTMLSelectElement = class extends FakeElement {};
  g.HTMLTextAreaElement = class extends FakeElement {};
  g.CSS = { escape: (s: string) => s };
  g.innerWidth = 1280;
  g.innerHeight = 800;
  g.localStorage = {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => { storage.set(k, String(v)); },
    removeItem: (k: string) => { storage.delete(k); },
  };
  const toast = () => ({
    className: '', textContent: '', style: {}, hidden: false,
    setAttribute: () => undefined, remove: () => undefined, addEventListener: () => undefined,
  });
  Object.assign(dom.doc, {
    body: Object.assign(new FakeEl('body', {}, null), { appendChild: () => undefined }),
    documentElement: { dataset: {} as Record<string, string> },
    createElement: toast,
  });
  Object.assign(dom.win, {
    innerWidth: 1280,
    innerHeight: 800,
    print: () => { printed++; },
    sgvueSchedule: {
      saveExport: async () => ({ saved: false }),
      openScheduleFile: () => new Promise<{ text: string } | null>((resolve) => {
        opened.push((text) => resolve(text === null ? null : { text }));
      }),
    },
  });
  return {
    win: dom.win,
    root: dom.root,
    app,
    pane: (id) => app.children.find((c) => c.attrs.id === id)!,
    storage,
    opened,
    printed: () => printed,
    dispatch: dom.dispatch,
    connect: (port) => {
      dom.dispatch(dom.root, 'message', { source: dom.win, data: CH_SCHEDULE_PORT, ports: [port] } as never);
    },
  };
}
