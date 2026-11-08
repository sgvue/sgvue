// Reads back the table `renderSchedule` (schedule-ui/tableView.ts) writes into `#output-pane`
// with one innerHTML. The unit tests run in Node with no HTML parser, so this is a small,
// strict tokenizer for exactly the markup the window writes: tags with double-quoted
// attributes, text, and a `<style>` block whose CSS is skipped. Text is entity-decoded as
// `esc()` (shared/html.ts) encodes it. Anything it cannot read is an error, never a guess.
//
// What a test reads off it is what the user sees: each `<th>`'s text, each `<tr>`'s class,
// `data-row` and cells — a cell's text, its class and its `style`, with the `0 values` badge
// told apart from the heading text it follows. Written for the Schedules checks of v1.5.0.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

export function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e]);
}

export interface HtmlCell {
  tag: 'td' | 'th';
  attrs: Record<string, string>;
  /** The cell's text, every descendant's included, but not a `.badge` span's. */
  text: string;
  /** The `.badge` span's text, when the cell has one. */
  badge: string | null;
  /** The `background` of a `.sw` swatch span inside, when there is one. */
  swatch: string | null;
}

export interface HtmlRow {
  cls: string;
  /** `data-row`, or null when the row carries none. */
  dataRow: number | null;
  cells: HtmlCell[];
  where: 'thead' | 'tbody';
}

export interface HtmlTable {
  head: HtmlCell[];
  body: HtmlRow[];
  /** Each `.notice`'s text, whitespace collapsed. */
  notices: string[];
  /** `.empty-note` text, when the renderer drew one instead of a table. */
  empty: string | null;
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

interface Tok { kind: 'open' | 'close' | 'text'; tag?: string; attrs?: Record<string, string>; text?: string }

function tokenize(html: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out.push({ kind: 'text', text: html.slice(i) }); break; }
    if (lt > i) out.push({ kind: 'text', text: html.slice(i, lt) });
    // A tag: name, then attributes `name` or `name="value"` (values never hold a raw `"`).
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>"/]+(?:="[^"]*")?)*)\s*\/?>/.exec(html.slice(lt));
    if (!m) throw new Error(`unreadable markup at ${lt}: ${html.slice(lt, lt + 60)}`);
    const tag = m[2].toLowerCase();
    if (m[1]) out.push({ kind: 'close', tag });
    else {
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([^\s=>"/]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
      out.push({ kind: 'open', tag, attrs });
      if (tag === 'style') {
        // Raw text up to its end tag — CSS, not markup.
        const end = html.indexOf('</style>', lt + m[0].length);
        if (end < 0) throw new Error('unterminated <style>');
        i = end;
        continue;
      }
      if (VOID.has(tag)) out.push({ kind: 'close', tag });
    }
    i = lt + m[0].length;
  }
  return out;
}

interface Node { tag: string; attrs: Record<string, string>; kids: (Node | string)[] }

function tree(html: string): Node {
  const root: Node = { tag: '#root', attrs: {}, kids: [] };
  const stack: Node[] = [root];
  for (const t of tokenize(html)) {
    const top = stack[stack.length - 1];
    if (t.kind === 'text') top.kids.push(decode(t.text!));
    else if (t.kind === 'open') {
      const n: Node = { tag: t.tag!, attrs: t.attrs!, kids: [] };
      top.kids.push(n);
      stack.push(n);
    } else {
      if (top.tag !== t.tag) throw new Error(`</${t.tag}> closes <${top.tag}>`);
      stack.pop();
    }
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].tag}>`);
  return root;
}

const classes = (n: Node) => (n.attrs.class ?? '').split(/\s+/).filter(Boolean);

function textOf(n: Node, skip: (x: Node) => boolean = () => false): string {
  return n.kids.map((k) => (typeof k === 'string' ? k : skip(k) ? '' : textOf(k, skip))).join('');
}

function* walk(n: Node): Generator<Node> {
  for (const k of n.kids) {
    if (typeof k === 'string') continue;
    yield k;
    yield* walk(k);
  }
}

function cellOf(n: Node): HtmlCell {
  const isBadge = (x: Node) => classes(x).includes('badge');
  const badge = [...walk(n)].find(isBadge);
  const sw = [...walk(n)].find((x) => classes(x).includes('sw'));
  return {
    tag: n.tag as 'td' | 'th',
    attrs: n.attrs,
    text: textOf(n, isBadge),
    badge: badge ? textOf(badge) : null,
    swatch: sw ? (/background:([^;]+)/.exec(sw.attrs.style ?? '')?.[1] ?? '') : null,
  };
}

/** The table, its notices and its empty note, as the user would read them. */
export function readTable(html: string): HtmlTable {
  const root = tree(html);
  const all = [...walk(root)];
  const notices = all.filter((n) => classes(n).includes('notice')).map((n) => textOf(n).replace(/\s+/g, ' ').trim());
  const emptyNode = all.find((n) => classes(n).includes('empty-note'));
  const table = all.find((n) => n.tag === 'table');
  if (!table) return { head: [], body: [], notices, empty: emptyNode ? textOf(emptyNode).replace(/\s+/g, ' ').trim() : null };
  const head: HtmlCell[] = [];
  const body: HtmlRow[] = [];
  for (const sec of table.kids) {
    if (typeof sec === 'string') {
      if (sec.trim()) throw new Error(`text directly in <table>: ${sec}`);
      continue;
    }
    for (const tr of sec.kids) {
      if (typeof tr === 'string') {
        if (tr.trim()) throw new Error(`text directly in <${sec.tag}>: ${tr}`);
        continue;
      }
      if (tr.tag !== 'tr') throw new Error(`<${tr.tag}> in <${sec.tag}>`);
      const cells = tr.kids.filter((k): k is Node => typeof k !== 'string').map(cellOf);
      if (sec.tag === 'thead') head.push(...cells);
      else body.push({
        cls: tr.attrs.class ?? '',
        dataRow: tr.attrs['data-row'] === undefined ? null : Number(tr.attrs['data-row']),
        cells,
        where: 'tbody',
      });
    }
  }
  return { head, body, notices, empty: null };
}
