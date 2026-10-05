// Formula parser for calculated columns. Shunting-yard -> RPN -> evaluate.
//
// User text is NEVER passed to eval() or new Function(). Anything unparseable, or any
// missing/non-numeric operand, yields a blank cell rather than NaN, Infinity or a crash.
//
// Operands are other column headings: `Area * 1.15`, `[Clear Width] / 1000`,
// `if(Width > 900, 1, 0)`, `round(Area, 2)`.

import type { CalcResult } from './def';

/**
 * A formula takes text IN and gives back whatever the column DECLARES — a number, a yes or
 * a no, or a text label. The declared kind is a contract: a result of any other kind is a
 * blank cell, never a coercion.
 *
 * Text in, because "is this a fire door?" is a question about `Type`, and a schedule author
 * has no other way to ask it. Text out for `if(Area > 10, "Large", "Small")`, because
 * sorting, grouping and counting by that label is schedule work — the table does it and a
 * spreadsheet export cannot. Text out is CLASSIFICATION only: `+` still never joins two
 * pieces of text (a text operand makes a blank), so composing `Type / Mark` into one cell
 * remains the spreadsheet's job, exactly as when Combined Parameters was cut.
 */
type Val = number | string | boolean;
export type Vars = Map<string, Val>;

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'lp' } | { t: 'rp' } | { t: 'comma' };

const OPS: Record<string, { prec: number; right?: boolean; arity: 1 | 2 }> = {
  '||': { prec: 1, arity: 2 }, '&&': { prec: 2, arity: 2 },
  '=': { prec: 3, arity: 2 }, '==': { prec: 3, arity: 2 }, '!=': { prec: 3, arity: 2 },
  '<': { prec: 4, arity: 2 }, '<=': { prec: 4, arity: 2 },
  '>': { prec: 4, arity: 2 }, '>=': { prec: 4, arity: 2 },
  '+': { prec: 5, arity: 2 }, '-': { prec: 5, arity: 2 },
  '*': { prec: 6, arity: 2 }, '/': { prec: 6, arity: 2 },
  // Negation binds tighter than any binary operator, so `3 * -2` is 3 * (-2), not (3*0) - 2.
  'u-': { prec: 8, right: true, arity: 1 },
};

/**
 * Deliberately absent, and each is turned away with its own advice rather than a generic
 * "unexpected character".
 *
 * `%` because it reads as "percent" to nearly everyone who would type it in a schedule —
 * `Area % 10` looks like a tenth of the area and is a remainder. A wrong number that looks
 * plausible is the worst thing this app can produce.
 *
 * `^` because `Width * Width` says the same thing, and says it better: the dimension checker
 * can see that multiplication makes an area, and cannot see through a power.
 */
const REMOVED: Record<string, string> = {
  '%': '"%" is not an operator here. For a share of a total, add a percentage calculated value instead.',
  '^': '"^" is not an operator here. Write Width * Width rather than Width ^ 2 — it also lets the unit be worked out.',
};

/** Text comparison is case-insensitive throughout: an author asking for "FD" means "fd" too. */
const str = (v: Val) => String(v).toLowerCase();
const num = (v: Val) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);

const FNS: Record<string, { args: number[]; text?: true; fn: (a: Val[]) => Val }> = {
  round: { args: [1, 2], fn: ([v, d = 0]) => { const p = 10 ** num(d); return Math.round(num(v) * p) / p; } },
  floor: { args: [1], fn: ([v]) => Math.floor(num(v)) },
  ceil: { args: [1], fn: ([v]) => Math.ceil(num(v)) },
  abs: { args: [1], fn: ([v]) => Math.abs(num(v)) },
  sqrt: { args: [1], fn: ([v]) => Math.sqrt(num(v)) },
  min: { args: [2, 3, 4], fn: (a) => Math.min(...a.map(num)) },
  max: { args: [2, 3, 4], fn: (a) => Math.max(...a.map(num)) },
  if: { args: [3], fn: ([c, a, b]) => (num(c) !== 0 ? a : b) },
  // Text predicates. Each answers 1 or 0, so it drops straight into if() and into a sum.
  contains: { args: [2], text: true, fn: ([a, b]) => (str(a).includes(str(b)) ? 1 : 0) },
  starts: { args: [2], text: true, fn: ([a, b]) => (str(a).startsWith(str(b)) ? 1 : 0) },
  ends: { args: [2], text: true, fn: ([a, b]) => (str(a).endsWith(str(b)) ? 1 : 0) },
  // "2400" in a text field is a number to a human; this says so explicitly rather than
  // guessing on every operand, which would make `Mark + 1` mean two different things
  // depending on the file.
  number: { args: [1], text: true, fn: ([v]) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))) },
  len: { args: [1], text: true, fn: ([v]) => String(v).length },
};

/**
 * A wrong argument count that is really a misunderstanding, answered where it is made.
 *
 * `if(Area > 10)` is the one people write, because "if the area is over 10" is the whole
 * thought. "if() takes 3 arguments, got 1" is true and no help at all: what they want is
 * the test on its own, and the answer is a dropdown away.
 */
const ARITY_ADVICE: Record<string, string> = {
  if: 'if() has three parts: if(test, when yes, when no) — for example if(Area > 10, Area, 0).'
    + ' For a plain yes or no you do not need it: write the test on its own, like Area > 10,'
    + ' and set "Result is a" to yes or no.',
};

export class FormulaError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }

    if (c === '[') {                       // [Bracketed Name] for headings with spaces
      const end = src.indexOf(']', i);
      if (end < 0) throw new FormulaError('Unclosed [');
      out.push({ t: 'name', v: src.slice(i + 1, end).trim() });
      i = end + 1; continue;
    }
    if (c === '"' || c === "'") {           // "FD-60" — a piece of text to compare against
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new FormulaError(`Unclosed ${c}`);
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1; continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Bad number at "${src.slice(i, i + 8)}"`);
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      const word = m[0];
      i += word.length;
      // a name directly followed by "(" is a function call
      const rest = src.slice(i).trimStart();
      if (rest.startsWith('(') && FNS[word.toLowerCase()]) out.push({ t: 'fn', v: word.toLowerCase() });
      else out.push({ t: 'name', v: word });
      continue;
    }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (c === ',') { out.push({ t: 'comma' }); i++; continue; }

    const two = src.slice(i, i + 2);
    if (OPS[two]) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if (OPS[c]) { out.push({ t: 'op', v: c }); i++; continue; }
    if (REMOVED[c]) throw new FormulaError(REMOVED[c]);
    throw new FormulaError(`Unexpected character "${c}"`);
  }
  return out;
}

/**
 * Shunting-yard: infix tokens to RPN, tracking unary minus and function arity.
 * Extracted so the dimension checker walks the SAME parse the evaluator does — a second,
 * near-identical parser would eventually disagree with this one about something.
 */
function toRpn(tokens: Tok[]): Tok[] {
  const output: Tok[] = [];
  const stack: (Tok & { argc?: number })[] = [];
  const argc: number[] = [];
  let prev: Tok | null = null;

  for (const tok of tokens) {
    if (tok.t === 'num' || tok.t === 'str' || tok.t === 'name') { output.push(tok); prev = tok; continue; }

    if (tok.t === 'fn') { stack.push(tok); argc.push(1); prev = tok; continue; }

    if (tok.t === 'comma') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') output.push(stack.pop()!);
      if (!stack.length) throw new FormulaError('Misplaced comma');
      argc[argc.length - 1]++;
      prev = tok; continue;
    }

    if (tok.t === 'op') {
      // A +/- in operand position is a sign, not an arithmetic operator.
      const inOperandPosition = prev === null || prev.t === 'op' || prev.t === 'lp' || prev.t === 'comma';
      let op = tok;
      if (inOperandPosition && (tok.v === '-' || tok.v === '+')) {
        if (tok.v === '+') { prev = tok; continue; }   // unary plus is a no-op
        op = { t: 'op', v: 'u-' };
      }
      const o1 = OPS[op.v];
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t !== 'op') break;
        const o2 = OPS[top.v];
        if (o2.prec > o1.prec || (o2.prec === o1.prec && !o1.right)) output.push(stack.pop()!);
        else break;
      }
      stack.push(op); prev = op; continue;
    }

    if (tok.t === 'lp') { stack.push(tok); prev = tok; continue; }

    // rp
    while (stack.length && stack[stack.length - 1].t !== 'lp') output.push(stack.pop()!);
    if (!stack.length) throw new FormulaError('Unbalanced )');
    stack.pop();
    if (stack.length && stack[stack.length - 1].t === 'fn') {
      const fn = stack.pop() as Tok & { argc?: number };
      fn.argc = argc.pop() ?? 1;
      output.push(fn);
    }
    prev = tok;
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === 'lp') throw new FormulaError('Unbalanced (');
    output.push(top);
  }
  return output;
}

/**
 * Compile once; the returned function runs per row.
 *
 * `result` is what the column says it holds. It is applied at exactly one point — the exit
 * below — so there is no second place where a value could be coerced differently.
 */
export function compile(src: string, result: CalcResult = 'number'): (vars: Vars) => Val | null {
  const tokens = tokenize(src);
  if (!tokens.length) throw new FormulaError('Empty formula');
  const output = toRpn(tokens);

  // Validate up front so mistakes surface while typing rather than as a silently blank
  // column. Walking the RPN and tracking stack depth catches "1 +" and "1 2" alike.
  let depth = 0;
  for (const tok of output) {
    if (tok.t === 'num' || tok.t === 'str' || tok.t === 'name') { depth++; continue; }
    if (tok.t === 'fn') {
      const spec = FNS[tok.v];
      const n = (tok as Tok & { argc?: number }).argc ?? 1;
      if (!spec.args.includes(n)) {
        throw new FormulaError(ARITY_ADVICE[tok.v]
          ?? `${tok.v}() takes ${spec.args.join(' or ')} arguments, got ${n}`);
      }
      if (depth < n) throw new FormulaError(`${tok.v}() is missing an argument`);
      depth = depth - n + 1;
      continue;
    }
    if (tok.t === 'op') {
      const need = OPS[tok.v].arity;
      if (depth < need) {
        throw new FormulaError(`"${tok.v === 'u-' ? '-' : tok.v}" is missing a value`);
      }
      depth = depth - need + 1;
    }
  }
  if (depth !== 1) {
    throw new FormulaError(depth === 0 ? 'Formula is empty' : 'Formula has values with no operator between them');
  }

  const run = (vars: Vars): Val | null => {
    const st: Val[] = [];
    for (const tok of output) {
      if (tok.t === 'num' || tok.t === 'str') { st.push(tok.v); continue; }
      if (tok.t === 'name') {
        const v = vars.get(tok.v.toLowerCase());
        // Text is a legitimate operand now; only a genuinely absent or non-finite value
        // blanks the row. An arithmetic operator applied to text still blanks it, below.
        if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return null;
        st.push(v); continue;
      }
      if (tok.t === 'fn') {
        const spec = FNS[tok.v];
        const n = (tok as Tok & { argc?: number }).argc ?? 1;
        const args = st.splice(-n, n);
        if (args.length !== n) return null;
        st.push(spec.fn(args));
        continue;
      }
      if (tok.t === 'op') {
        if (OPS[tok.v].arity === 1) {
          const a = st.pop();
          if (a === undefined) return null;
          st.push(-num(a));
          continue;
        }
        const b = st.pop(), a = st.pop();
        if (a === undefined || b === undefined) return null;
        st.push(apply(tok.v, a, b));
        continue;
      }
    }
    const top = st.pop();
    // A text column keeps text and nothing else: `if(Area > 10, "Large", 0)` blanks the
    // small rows rather than printing a 0 among the words. Whitespace is blanked with it,
    // so `if(Area > 10, "Large", "")` collapses alongside rows that had no value at all.
    if (result === 'text') return typeof top === 'string' && top.trim() !== '' ? top.trim() : null;
    if (typeof top === 'boolean') return top;
    // Division by zero and overflow read as blanks, never as "Infinity" on a printed
    // schedule. A formula that ends up holding text is a blank too — the column is numeric.
    return typeof top === 'number' && Number.isFinite(top) ? top : null;
  };
  return run;
}

function apply(op: string, a: Val, b: Val): Val {
  // Equality is the one place text is compared directly: `Family = "Basic Wall"` is the
  // natural way to write it, and forcing contains() for an exact match would be worse.
  if (typeof a === 'string' || typeof b === 'string' || typeof a === 'boolean' || typeof b === 'boolean') {
    switch (op) {
      case '=': case '==': return str(a) === str(b) ? 1 : 0;
      case '!=': return str(a) !== str(b) ? 1 : 0;
      // Anything else on text is a mistake, and a blank cell says so more clearly than a
      // number computed from NaN would.
      default: return NaN;
    }
  }
  return applyNum(op, a, b);
}

function applyNum(op: string, a: number, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    case '<': return a < b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '=': case '==': return Math.abs(a - b) < 1e-9 ? 1 : 0;
    case '!=': return Math.abs(a - b) >= 1e-9 ? 1 : 0;
    case '&&': return a !== 0 && b !== 0 ? 1 : 0;
    case '||': return a !== 0 || b !== 0 ? 1 : 0;
    default: return NaN;
  }
}

/** Column headings a formula refers to, for showing "unknown field" while editing. */
export function referencedNames(src: string): string[] {
  try {
    return [...new Set(tokenize(src).filter((t) => t.t === 'name').map((t) => (t as { v: string }).v))];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- dimensions

/**
 * What a formula's result measures, worked out from the expression itself.
 *
 * The app used to ask the author and take their word for it, which left `Height * 2` on a
 * 2,350 mm door showing 4.70 — the stored metres — beside a Height column reading 2,350.
 * It does not have to guess: every operand's unit kind is known, and dimensions compose.
 * Multiplication adds exponents, division subtracts, and addition demands they already
 * match — which is also how `Width + Area` is caught, an expression that is arithmetically
 * fine and physically meaningless, and that produced a silent number.
 *
 * Exponents rather than a unit name, because the intermediate steps have no name:
 * `Width * Height / Length` passes through L2 on its way back to L1.
 */
interface Dim { L: number; M: number; A: number }

const ZERO: Dim = { L: 0, M: 0, A: 0 };
const KIND_DIM: Record<string, Dim> = {
  length: { L: 1, M: 0, A: 0 },
  area: { L: 2, M: 0, A: 0 },
  volume: { L: 3, M: 0, A: 0 },
  mass: { L: 0, M: 1, A: 0 },
  angle: { L: 0, M: 0, A: 1 },
  count: ZERO, none: ZERO,
};

const same = (a: Dim, b: Dim) => a.L === b.L && a.M === b.M && a.A === b.A;

/** The unit kind an exponent vector corresponds to, or null when nothing names it. */
function kindOfDim(d: Dim): string | null {
  for (const [kind, dim] of Object.entries(KIND_DIM)) {
    if (kind !== 'count' && same(dim, d)) return kind;
  }
  return same(d, ZERO) ? 'none' : null;
}

export interface DimResult {
  /** The inferred unit kind, or null when the expression has no nameable unit. */
  kind: string | null;
  /** Set when the expression cannot be given any dimension — a real mistake, not a nuance. */
  problem?: string;
}

/**
 * @param src        the formula text
 * @param kindByName lower-cased column heading -> its unit kind
 */
export function dimensionOf(src: string, kindByName: Map<string, string>): DimResult {
  let toks: Tok[];
  try { toks = tokenize(src); } catch { return { kind: null }; }

  // A second, tiny shunting-yard over dimensions only. Re-parsing rather than threading a
  // dimension through compile() keeps the per-row evaluator exactly as fast as it was.
  const st: (Dim | 'text' | 'unknown')[] = [];
  let rpnLike: Tok[];
  try { rpnLike = toRpn(toks); } catch { return { kind: null }; }

  for (const tok of rpnLike) {
    if (tok.t === 'num') { st.push(ZERO); continue; }
    if (tok.t === 'str') { st.push('text'); continue; }
    if (tok.t === 'name') {
      const k = kindByName.get(tok.v.toLowerCase());
      st.push(k === undefined ? 'unknown' : (KIND_DIM[k] ?? ZERO));
      continue;
    }
    if (tok.t === 'fn') {
      const n = (tok as Tok & { argc?: number }).argc ?? 1;
      const args = st.splice(-n, n);
      // Predicates answer yes/no, so the result is a plain count whatever went in.
      if (FNS[tok.v]?.text || /^(len)$/.test(tok.v)) { st.push(ZERO); continue; }
      if (tok.v === 'sqrt') {
        const a = args[0];
        if (typeof a === 'string') { st.push('unknown'); continue; }
        // sqrt of an area is a length; sqrt of an odd exponent has no name.
        st.push(a.L % 2 || a.M % 2 || a.A % 2 ? 'unknown' : { L: a.L / 2, M: a.M / 2, A: a.A / 2 });
        continue;
      }
      // round/floor/ceil/abs keep their argument's dimension; min/max/if need agreement.
      const dims = args.filter((a): a is Dim => typeof a !== 'string');
      if (!dims.length) { st.push('unknown'); continue; }
      const first = tok.v === 'if' ? dims[dims.length - 1] : dims[0];
      st.push(dims.every((d) => same(d, first)) ? first : 'unknown');
      continue;
    }
    if (tok.t === 'op') {
      if (OPS[tok.v].arity === 1) continue;              // negation keeps the dimension
      const b = st.pop(), a = st.pop();
      if (a === undefined || b === undefined) return { kind: null };
      if (/^(<|<=|>|>=|=|==|!=|&&|\|\|)$/.test(tok.v)) { st.push(ZERO); continue; }
      if (typeof a === 'string' || typeof b === 'string' || typeof a === 'boolean' || typeof b === 'boolean') { st.push('unknown'); continue; }
      if (tok.v === '*') { st.push({ L: a.L + b.L, M: a.M + b.M, A: a.A + b.A }); continue; }
      if (tok.v === '/') { st.push({ L: a.L - b.L, M: a.M - b.M, A: a.A - b.A }); continue; }
      if (tok.v === '+' || tok.v === '-') {
        if (!same(a, b)) {
          return { kind: null, problem: `This adds a ${kindOfDim(a) ?? 'mixed unit'} to a ${kindOfDim(b) ?? 'mixed unit'}, which cannot be right.` };
        }
        st.push(a); continue;
      }
      // Every remaining binary operator is handled above. Nothing reaches here, but a future
      // one would rather arrive as "no opinion" than as a confidently wrong unit.
      st.push('unknown'); continue;
    }
  }

  const top = st.pop();
  if (top === undefined || typeof top === 'string') return { kind: null };
  return { kind: kindOfDim(top) };
}

