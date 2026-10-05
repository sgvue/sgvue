// The formula syntax guide — 2026-09-25, phase 2.
//
// ifcTable served this as a page of its own, `public/formula.html`, opened in a new tab from
// the calculated-value editor's "Syntax guide" link. A desktop window has no tab to open and
// must not navigate, so the same text is an overlay here, drawn in the field browser's card,
// reached from the same link, and left with Escape or "Back to fields". The content is
// ifcTable's own, section for section; only the pointers to where things live are SGVue's.
// Static text — no model data reaches this string.

import { cross } from '../icons';

const SECTIONS: [string, string][] = [
  ['basics', 'Basics'], ['units', 'Units'], ['text', 'Text'],
  ['functions', 'Functions'], ['blanks', 'Blanks'], ['recipes', 'Recipes'],
];

export function formulaHelp(): string {
  const toc = SECTIONS.map(([id, label]) =>
    `<button class="toggle" data-act="formula-jump" data-v="${id}">${label}</button>`).join('');

  return `<div class="overlay" data-act="overlay-backdrop">
    <div class="overlay-card narrow" role="dialog" aria-modal="true" aria-label="Formula syntax">
      <div class="overlay-head">
        <div class="row top head-row">
          <div class="grow-1">
            <h3>Formula syntax</h3>
            <p>For calculated columns — Fields › Add fields… › Calculated › Add formula</p>
          </div>
          <button class="overlay-close hv-step-ink" data-act="close-overlay" aria-label="Close">${cross(14, 1.8)}</button>
        </div>
        <div class="chips filter-row">${toc}</div>
      </div>
      <div class="help-body">
      <section id="help-basics">
        <h4>Basics</h4>
        <p>A formula refers to your other columns <strong>by their heading</strong>, and always
          produces a number.</p>
        <pre><code>Area * 1.15
Width * Height
round(Area, 2)</code></pre>
        <p>A heading with a space in it goes in square brackets: <code>[Clear Width] / 2</code>.
          Headings are matched ignoring case.</p>
        <p>Operators, loosest to tightest: <code>||</code> <code>&amp;&amp;</code> ·
          <code>=</code> <code>!=</code> · <code>&lt;</code> <code>&lt;=</code> <code>&gt;</code>
          <code>&gt;=</code> · <code>+</code> <code>-</code> · <code>*</code> <code>/</code>.
          Brackets work as you expect, and a comparison answers <code>1</code> or <code>0</code>,
          so it adds up to a count.</p>
        <p>There is no <code>^</code> and no <code>%</code>, on purpose. <code>%</code> reads as
          “percent” to almost everyone who would type it here, and it would mean remainder — a
          wrong number that looks perfectly plausible. For a share of a total, add a
          <em>percentage</em> calculated value instead. <code>^</code> is gone because
          <code>Width * Width</code> says the same thing and says it better: the app can see that
          multiplying two lengths makes an area, and cannot see through a power. Type either one
          and it will tell you this.</p>
        <p>Nothing you type is ever executed. The formula is parsed into a small stack machine —
          there is no <code>eval</code> anywhere in this app.</p>
      </section>

      <section id="help-units">
        <h4>Units — read this one</h4>
        <p>A formula sees the <strong>stored</strong> value, and everything is stored in SI:
          metres, square metres, cubic metres, kilograms, radians. A door 2,350&nbsp;mm high is
          <code>2.35</code> to a formula, whatever the Height column displays.</p>
        <p>So <code>Height * 2</code> gives <code>4.7</code> — correct, in metres, and confusing
          beside a column reading 2,350. Tell the app what the result <em>measures</em> using the
          <strong>“Result is a”</strong> dropdown, and the column converts like any other: pick
          <em>length</em> and it shows 4,700&nbsp;mm.</p>
        <p>The app works out the answer from the formula itself and offers it to you —
          <code>Width * 2</code> is a length, <code>Width * Height</code> is an area,
          <code>Volume / Area</code> is a length again. It will not change your choice silently;
          it only tells you when it disagrees.</p>
        <p>It also catches expressions that cannot mean anything, like <code>Width + Area</code> —
          adding a length to an area. That is arithmetically fine and physically nonsense, and it
          used to produce a number with no complaint.</p>
      </section>

      <section id="help-text">
        <h4>Text</h4>
        <p>Text goes <strong>in</strong> to a formula, and can come back <strong>out</strong> as a
          label you choose. Put text in quotes, single or double. All text comparison ignores
          case.</p>
        <pre><code>contains(Type, "FD")          → 1 if the type contains FD
starts(Mark, "D")             → 1 if the mark starts with D
ends(Mark, "01")              → 1 if it ends with 01
Family = "Basic Wall"         → 1 if it matches exactly
Family != "Basic Wall"        → 1 if it does not</code></pre>
        <p>Because those answer 1 or 0, they drop straight into <code>if()</code> and into a column
          total: give the column a <em>Sum</em> and you have counted the matching rows.</p>
        <p>A column of 1s and 0s reads badly, though. Set <strong>“Result is a”</strong> to
          <em>yes or no</em> and the same formula answers Yes or No instead — Column formatting can
          then show it as <em>Yes/No</em>, <em>TRUE/FALSE</em>, <em>Y/N</em> or a tick. There is no
          special syntax for this; it is a property of the calculated value, not something you
          write into the formula.</p>
        <p>You lose nothing by doing it: a yes still counts as 1, so a <em>Sum</em> total on that
          column still tells you how many matched. The <em>Yes / No style</em> dropdown only
          appears for columns that can actually be one.</p>
        <p>A number stored as text — <code>"2400"</code> in a Mark field — is only treated as a
          number when you ask, with <code>number(Mark)</code>. That is deliberate: implicit
          conversion would make <code>Mark + 1</code> mean different things in different files.</p>
        <p>Arithmetic on text gives a blank cell rather than a made-up number.</p>
        <h5>Answering with a word</h5>
        <p>Set <strong>“Result is a”</strong> to <em>text</em> and the column keeps whichever label
          the formula picked. Useful for sorting a schedule into buckets you invented, then
          grouping and counting by them:</p>
        <pre><code>if(Area &gt; 10, "Large", "Small")
if(contains(Type, "FD"), "Fire door", "Standard")</code></pre>
        <p>Whatever the column says it holds is what it will hold: on a <em>text</em> column a
          result that is not text comes out blank, so <code>if(Area &gt; 10, "Large", 0)</code>
          leaves the small rows empty rather than printing a 0 among the words. The same rule the
          other way is why a formula returning text on a <em>plain number</em> column is blank. A
          branch of <code>""</code> counts as no value at all, so those rows collapse together
          with rows that never had one.</p>
        <p>Two pieces of text cannot be joined. <code>Type + " " + Mark</code> is a blank, not
          <em>“Door D-101”</em> — <code>+</code> is arithmetic only.</p>
      </section>

      <section id="help-functions">
        <h4>Functions</h4>
        <table class="help-table">
          <tr><td><code>round(x)</code>, <code>round(x, n)</code></td><td>to a whole number, or to n decimals</td></tr>
          <tr><td><code>floor(x)</code> · <code>ceil(x)</code></td><td>down · up</td></tr>
          <tr><td><code>abs(x)</code> · <code>sqrt(x)</code></td><td>size without sign · square root (of an area, a length)</td></tr>
          <tr><td><code>min(a, b, …)</code> · <code>max(a, b, …)</code></td><td>up to four values</td></tr>
          <tr><td><code>if(test, a, b)</code></td><td>a when the test is non-zero, otherwise b</td></tr>
          <tr><td><code>contains(text, part)</code></td><td>1 or 0</td></tr>
          <tr><td><code>starts(text, part)</code> · <code>ends(text, part)</code></td><td>1 or 0</td></tr>
          <tr><td><code>number(text)</code></td><td>read a number out of a text field</td></tr>
          <tr><td><code>len(text)</code></td><td>how many characters</td></tr>
        </table>
      </section>

      <section id="help-blanks">
        <h4>When a cell comes out blank</h4>
        <p>A blank is always deliberate — it never shows <code>NaN</code> or <code>Infinity</code>:</p>
        <ul>
          <li>a column the formula names has no value on that row;</li>
          <li>division by zero;</li>
          <li>arithmetic applied to text, including <code>+</code> between two pieces of it;</li>
          <li>a result that is not a finite number;</li>
          <li>a result that is not the kind the column says it holds.</li>
        </ul>
        <p>A formula that cannot be parsed at all is different: it reports the mistake under the box
          as you type, rather than quietly giving you an empty column. A heading that two columns
          share is reported too, instead of the app picking one of them for you.</p>
      </section>

      <section id="help-recipes">
        <h4>Recipes</h4>
        <h5>Count the fire doors</h5>
        <pre><code>contains(Type, "FD")</code></pre>
        <p>Result is a <em>plain number</em>. Give the column a Sum total.</p>
        <h5>…or mark them Yes / No instead</h5>
        <pre><code>contains(Type, "FD")</code></pre>
        <p>Same formula. Set <em>Result is a</em> to <em>yes or no</em>. A Sum still counts them.</p>
        <h5>…or give each one a name</h5>
        <pre><code>if(contains(Type, "FD"), "Fire door", "Standard")</code></pre>
        <p>Set <em>Result is a</em> to <em>text</em>. Sort on the column and switch <em>itemise</em>
          off, and the schedule collapses to one line per kind with a count.</p>
        <h5>Sort rooms into size bands</h5>
        <pre><code>if(Area &gt; 20, "Large", if(Area &gt; 8, "Medium", "Small"))</code></pre>
        <p>Result is <em>text</em>. <code>if()</code> nests, so a third band costs one more. Group by
          this column for a summary of the whole floor.</p>
        <h5>Area with a 15% allowance</h5>
        <pre><code>Area * 1.15</code></pre>
        <p>Result is an <em>area</em>.</p>
        <h5>Wall area from its dimensions</h5>
        <pre><code>Length * Height</code></pre>
        <p>Result is an <em>area</em> — the app will suggest that.</p>
        <h5>A square, without a power operator</h5>
        <pre><code>Width * Width</code></pre>
        <p>Result is an <em>area</em>, and the app can tell. <code>Width ^ 2</code> could not be.</p>
        <h5>Flag anything under a minimum</h5>
        <pre><code>if([Clear Width] &lt; 0.85, 1, 0)</code></pre>
        <p>Note the <code>0.85</code>: comparisons are against stored SI values, so that is
          850&nbsp;mm. Result is a <em>plain number</em>.</p>
        <h5>Only count the ones that are both</h5>
        <pre><code>if(contains(Type, "FD") &amp;&amp; Height &gt; 2.1, 1, 0)</code></pre>
      </section>
      </div>
      <div class="overlay-foot">
        <span class="spacer"></span>
        <button class="btn primary" data-act="open-fields">Back to fields</button>
      </div>
    </div>
  </div>`;
}
