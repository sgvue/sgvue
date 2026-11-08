// Just enough DOM to drive the real delegated handlers in ui/events.ts, ui/colResize.ts and
// ui/popover.ts from a test: elements with a parent chain, `closest()` for the selector
// shapes those files use, and dispatch in the real order — window and document capture,
// then the target and its ancestors bubbling, then document and window — honouring
// stopPropagation. There is no layout and no hit-testing: a dispatched click goes where it
// is told. So this proves the WIRING (which handler runs, in which order, and what it
// writes); a trusted pointer click in the real app is still the proof of hit-testing.
//
// Ported from ifcTable's `tests/support/fakeDom.ts` (Yong Yen, 2026-11-05) for SGVue v1.5.0,
// phase 2. SGVue's handlers live in `src/renderer/schedule-ui/`; nothing else differs.

type Fn = (e: FakeEvent) => void;

export class FakeTarget {
  listeners = new Map<string, { fn: Fn; capture: boolean }[]>();
  parent: FakeTarget | null = null;
  addEventListener(type: string, fn: Fn, opt?: boolean | { capture?: boolean }) {
    const capture = typeof opt === 'boolean' ? opt : !!opt?.capture;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { fn, capture }]);
  }
  removeEventListener(type: string, fn: Fn, opt?: boolean | { capture?: boolean }) {
    const capture = typeof opt === 'boolean' ? opt : !!opt?.capture;
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l.fn !== fn || l.capture !== capture));
  }
}

/** `tag`, `.class`, `[attr]` and `[attr="v"]`, comma-separated — what the app's selectors use. */
function matches(el: FakeEl, selector: string): boolean {
  return selector.split(',').some((part) => {
    // Descendant combinators are not modelled: the last compound decides.
    const s = part.trim().split(/\s+/).pop() ?? '';
    const tag = /^[a-z]+/i.exec(s)?.[0];
    if (tag && tag.toLowerCase() !== el.tag) return false;
    for (const m of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const v = el.attr(m[1]);
      if (v === undefined || (m[2] !== undefined && v !== m[2])) return false;
    }
    for (const m of s.matchAll(/\.([\w-]+)/g)) if (!el.classes.includes(m[1])) return false;
    for (const m of s.matchAll(/#([\w-]+)/g)) if (el.attrs.id !== m[1]) return false;
    return true;
  });
}

export class FakeEl extends FakeTarget {
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  classes: string[] = [];
  value = '';
  checked = false;
  type = '';
  isConnected = true;
  rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  children: FakeEl[] = [];
  /** How many times `innerHTML` was written — a repaint, to a test. No parsing happens. */
  writes = 0;
  private html = '';
  get innerHTML() { return this.html; }
  set innerHTML(v: string) { this.html = v; this.writes++; }
  classList = {
    contains: (c: string) => this.classes.includes(c),
    toggle: (c: string, on = !this.classes.includes(c)) => {
      this.classes = this.classes.filter((x) => x !== c);
      if (on) this.classes.push(c);
      return on;
    },
  };
  scrollIntoView() {}
  private props = new Map<string, string>();
  style = {
    width: '',
    setProperty: (k: string, v: string) => { this.props.set(k, v); },
    getPropertyValue: (k: string) => this.props.get(k) ?? '',
    removeProperty: (k: string) => { this.props.delete(k); },
  };
  constructor(public tag: string, data: Record<string, string> = {}, parent: FakeTarget | null = null) {
    super();
    this.parent = parent;
    if (parent instanceof FakeEl) parent.children.push(this);
    Object.assign(this.dataset, data);
  }
  attr(name: string): string | undefined {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      return this.dataset[key];
    }
    return this.attrs[name];
  }
  closest(selector: string): FakeEl | null {
    for (let n: FakeTarget | null = this; n; n = n.parent) {
      if (n instanceof FakeEl && matches(n, selector)) return n;
    }
    return null;
  }
  querySelectorAll(selector: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (n: FakeEl) => { for (const c of n.children) { if (matches(c, selector)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeEl | null { return this.querySelectorAll(selector)[0] ?? null; }
  get nextElementSibling(): FakeEl | null {
    const sibs = this.parent instanceof FakeEl ? this.parent.children : [];
    return sibs[sibs.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling(): FakeEl | null {
    const sibs = this.parent instanceof FakeEl ? this.parent.children : [];
    return sibs[sibs.indexOf(this) - 1] ?? null;
  }
  setAttribute(name: string, v: string) { this.attrs[name] = v; }
  removeAttribute(name: string) { delete this.attrs[name]; }
  getBoundingClientRect() { return this.rect; }
  focus() { (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement = this; }
  setPointerCapture() {}
  contains(other: unknown): boolean {
    for (let n = other as FakeTarget | null; n; n = n.parent) if (n === this) return true;
    return false;
  }
}

export interface FakeEvent {
  type: string;
  target: FakeEl;
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  button?: number;
  buttons?: number;
  clientX?: number;
  pointerId?: number;
  relatedTarget?: FakeTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Install `window` and `document` on globalThis and return a dispatcher. `root` stands for
 * #app: the element ui/events.ts and the resizer delegate from.
 */
export function installFakeDom() {
  const win = new FakeTarget();
  const doc = new FakeTarget();
  doc.parent = win;
  const root = new FakeEl('div', {}, doc);
  Object.assign(doc, {
    getElementById: (id: string) => root.querySelector(`#${id}`),
    querySelector: (sel: string) => root.querySelector(sel),
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    activeElement: null,
  });
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.document = doc;

  function dispatch(target: FakeEl, type: string, init: Partial<FakeEvent> = {}) {
    let stopped = false;
    const ev: FakeEvent = {
      type, target, button: 0, buttons: 0, clientX: 0, pointerId: 1, ...init,
      preventDefault() {}, stopPropagation() { stopped = true; },
    };
    const path: FakeTarget[] = [];
    for (let n: FakeTarget | null = target; n; n = n.parent) path.push(n);
    const run = (node: FakeTarget, capture: boolean) => {
      for (const l of [...(node.listeners.get(type) ?? [])]) {
        if (l.capture === capture && !stopped) l.fn(ev);
      }
    };
    for (const node of [...path].reverse()) { if (stopped) return; run(node, true); }
    for (const node of path) { if (stopped) return; run(node, false); }
  }
  return { win, doc, root, dispatch };
}
