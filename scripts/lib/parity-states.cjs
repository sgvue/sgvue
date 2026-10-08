/**
 * Dev utility — NOT application code. The half of the parity harness that both capture scripts
 * share: `scripts/screenshot.cjs` (the app) and `scripts/parity-prototype.cjs` (the design
 * prototype) require this one file, so the two sides are driven by the *same* text — the same
 * mouse coordinates, the same DOM helpers, the same state tables in the same order — rather
 * than by two copies that were once byte-identical.
 *
 * What is *not* here is what genuinely differs between the two sides: the 2a/2b states that
 * address each side's own viewer API (`D` against `V`), the app's `APP_ONLY_STATES`, and the
 * prototype's `BARE` stripping.
 *
 * 2026-10-01: the app's Section card has two planes and a `Clear all`; the prototype's has one
 * plane and one `Clear`. The annotation chain clears the section through `secClear()`, which is
 * whichever of the two the card has, and the sidecar reads the taller card's text in full.
 *
 * 2026-10-01: the app's assistant is named Vee — its pill reads `Ask Vee` and a reply is from
 * `Vee` — where the prototype's reads `Ask` and `SGVue`. `chatPill()` and the sidecar's `pill`
 * find either label, and the quoted reply of `CHAT_REPLY` carries each side's own name.
 *
 * The same day the app's busy row became the assistant's live reply (the owner's "Ask Vee"
 * handoff): where the prototype's `chat-busy` shows its brand mark, a stage line and three dots,
 * the app's shows `Vee` and `Thinking`, and a user's row stands on the left. `chat-busy` still
 * sets the same state on both sides — the prototype needs its `chatStage`, which the app drops —
 * and on the app it also pins the trace's clock three seconds into that turn and the sprite's
 * at its frame 0 (`pinTrace`), so the capture is one fixed frame of the shimmer and of the
 * mascot's `thinking`.
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/* ── mouse input, in CSS pixels of the 1440 × 860 window ──────────────────── */
const MOVE = (x, y) => ({ move: [x, y] })
const CLICK = (x, y, o = {}) => ({ click: [x, y], ...o })
const RIGHT = (x, y) => ({ click: [x, y], button: 'right' })
const DBLCLICK = (x, y) => ({ dblclick: [x, y] })
/**
 * The 148 px cube sits at `top: 8px; right: 8px` (`SGVue.dc.html` L302), so in a 1440 × 860
 * window its box is x 1284…1432, y 8…156. These are zone centres read off a capture.
 */
const CUBE = { e: [1380, 93], top: [1357, 54] }
/** A point on the exposed edge of STR's "Floor Slab L3", and a beam on the E façade. */
const HOVER = [620, 470]
const SECOND = [760, 505]
/** The building's near vertical corner — inside the 16 px corner radius on both sides. */
const CORNER = [750, 475]
/** Phase 4: a wall panel on the S façade, and open ground west of the site. */
const WALL = (process.env.SGVUE_WALL || '812,462').split(',').map(Number)
const EMPTY = [420, 180]

/* ── Phase 3: the designed chrome, driven through its own DOM ─────────────────
 * Both `scripts/screenshot.cjs` and `scripts/parity-prototype.cjs` inject this same text and
 * run the same state list, so each side goes through its own real click handlers.
 * Selectors are `title` / `data-tip` / visible copy, all of which the port keeps verbatim.
 * ──────────────────────────────────────────────────────────────────────────── */
const UI = `
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const txt = (e) => (e.textContent || '').trim();
  const byText = (sel, t) => $$(sel).find((e) => txt(e) === t);
  const byTitle = (t) => $$('button').filter((b) => b.title === t);
  const click = (e) => { if (!e) throw new Error('parity: no such control'); e.click(); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const typeInto = (el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const search = () => $('input[placeholder="find an element…"]');
  const group = (label) => byText('span', label).parentElement;
  const storeyRow = (name) => byText('span', name).parentElement;
  // Phase 4: a property-card section header, and a menu / list row by its leading copy.
  const section = (label) => byText('span', label).parentElement;
  const item = (prefix) => $$('button').find((b) => txt(b).startsWith(prefix));
  // The card's scrolling body is its last child (SGVue.dc.html L326): the collapsible
  // sections sit below the fold on a 620 px card, so a state that opens one scrolls to it.
  const cardScroll = (to) => { const c = $('[data-role="propcard"]');
    if (!c) throw new Error('parity: no property card'); c.lastElementChild.scrollTop = to; };
  // Phase 5. A <select> needs the *select* prototype's value setter and a \`change\` event, for
  // the same reason \`typeInto\` needs the input prototype's and an \`input\` event: React tracks
  // the last value it wrote and ignores an assignment it did not see.
  const pickOption = (el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  // The left-lane cards are the absolutely-positioned z-index-14 boxes; the first match is the
  // card itself, its own header row is not positioned and so is never one of these.
  const laneCards = () => $$('div').filter((e) => { const c = getComputedStyle(e);
    return (c.position === 'absolute' || c.position === 'fixed') && c.zIndex === '14'; });
  const filterCard = () => { const c = laneCards().find((e) => /^Filter/.test(txt(e)));
    if (!c) throw new Error('parity: no filter card'); return c; };
  const ruleVal = () => filterCard().querySelector('input[placeholder="value"]');
  const tbBtn = (tip) => $('button[data-tip="' + tip + '"]');
  // One filter step, built the way a person builds it: add, choose the property, type the
  // value, choose the action. Each click is a separate render on both sides.
  const addStep = async (prop, val, action) => {
    click(byText('button', '+ add filter step')); await sleep(250);
    pickOption(filterCard().querySelector('select'), prop); await sleep(250);
    typeInto(ruleVal(), val); await sleep(250);
    if (action) click(byText('button', action));
    await sleep(250);
  };
  // Phase 6. The three new left-lane cards, the controls inside them, and a grid bubble —
  // which is a DOM label in the overlay carrying the same title on both sides.
  const cardNamed = (re) => { const c = laneCards().find((e) => re.test(txt(e)));
    if (!c) throw new Error('parity: no card matching ' + re); return c; };
  const sectionCard = () => cardNamed(/^Section/);
  const secBtn = (t) => [...sectionCard().querySelectorAll('button')].find((b) => txt(b) === t);
  const secOffset = () => sectionCard().querySelector('input');
  // 2026-10-01: the app's card has two planes, each with its own \`cut\`, \`flip side\`, \`Clear\`
  // and offset field. \`secBtn\` and \`secOffset\` take the first match, which is the gridline
  // plane's — the block the design's single row of controls stands in for while only a gridline
  // is cut. "Clear the section" is the app's \`Clear all\` (the gridline plane's own \`Clear\` would
  // leave a level cut standing); the prototype has no such button, so there it is its \`Clear\`.
  const secClear = () => secBtn('Clear all') || secBtn('Clear');
  const bubble = (name) => $$('div').find((e) => e.title === 'Show plane of grid ' + name);
  // Phase 7. Colour by property has **no designed manual control** — only the assistant's
  // \`color_by_property\` tool sets it (SGVue.dc.html:1547), and that is Phase 9 — so each side
  // is driven through its own real entry point and nothing new is invented on either: the app
  // through \`window.__sgvueDev.colorBy\`, the prototype through its own \`colorBy\` method on
  // the logic instance the template runtime keeps as \`logic\`. The legend itself — its rows and
  // its × — is a designed control and is clicked through the DOM on both sides.
  const logicWithColorBy = () => {
    for (let n = $('[data-role="stage"]') || document.body; n; n = n.parentElement) {
      const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$') || x.startsWith('__reactInternalInstance$'));
      for (let f = k ? n[k] : null; f; f = f.return) {
        const L = f.stateNode && f.stateNode.logic;
        if (L && typeof L.colorBy === 'function') return L;
      }
    }
    return null;
  };
  const colorBy = (prop, rules) => {
    if (window.__sgvueDev && window.__sgvueDev.colorBy) return window.__sgvueDev.colorBy(prop, rules);
    const L = logicWithColorBy();
    if (!L) throw new Error('parity: no colorBy');
    return L.colorBy(prop, rules);
  };
  const legendBox = () => $$('div').filter((e) => { const c = getComputedStyle(e);
    return (c.position === 'absolute' || c.position === 'fixed') && c.zIndex === '11'; }).pop();
  const legendRows = () => legendBox() ? [...legendBox().querySelectorAll('button[data-tip="Select these elements"]')] : [];
  // Phase 8. The landing page is the one surface whose upload rows the two sides cannot reach
  // the same way: the prototype's five stages are a timer, ours are a real worker on a real
  // file. So the **row state** is set through each side's own state API — the technique
  // Phase 7 established for \`colorBy\` — and every other control in these captures is a
  // designed one, clicked by its own copy or title on both sides.
  const logicWith = (name) => {
    for (let n = $('[data-role="landing"]') || $('[data-role="stage"]') || document.body; n; n = n.parentElement) {
      const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$') || x.startsWith('__reactInternalInstance$'));
      for (let f = k ? n[k] : null; f; f = f.return) {
        const L = f.stateNode && f.stateNode.logic;
        if (L && typeof L[name] === 'function') return L;
      }
    }
    return null;
  };
  const proto = () => { const L = logicWith('queue');
    if (!L) throw new Error('parity: no logic instance'); return L; };
  const D8 = () => window.__sgvueDev || null;
  const setUploads = (rows) => { const d = D8();
    if (d) return d.setUploads(rows); proto().setState({ uploads: rows }); };
  const setDragging = (b) => { const d = D8();
    if (d) return d.setDragging(b); proto().setState({ dragging: b }); };
  const setInitErr = (m) => { const d = D8();
    if (d) return d.setInitErr(m); proto().setState({ initErr: m }); };
  /**
   * Freeze the animated backdrop so the two sides can be compared pixel for pixel.
   *
   * \`animation: none\` rather than \`animation-play-state: paused\`: pausing freezes each side
   * wherever its own 26 s drift happened to be when the capture started, which is a different
   * phase every run; removing the animation puts both at phase 0. The pointer is then placed
   * at one fixed point, because the parallax is written straight to CSS custom properties from
   * the pointer position (\`SGVue.dc.html:1116\`) and is otherwise wherever the mouse last was.
   */
  const freeze = () => {
    let st = document.getElementById('parity-freeze');
    if (!st) {
      st = document.createElement('style');
      st.id = 'parity-freeze';
      st.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
      document.head.appendChild(st);
    }
    const host = $('[data-role="landing"]');
    if (host) host.dispatchEvent(new PointerEvent('pointermove', { clientX: 720, clientY: 430, bubbles: true }));
  };
  const openAllBtn = () => $$('button').find((b) => /^open all .* as a federation/.test(txt(b)));
  const linkBtn = () => $$('button').find((b) => /^(copy link to this state|link copied)$/.test(txt(b)));
  // The 1 600 ms "link copied" flash is a *timer*, so which side is still inside it when
  // \`capturePage()\` runs is a race rather than a parity property (its duration is asserted in
  // \`tests/unit/upload.test.ts\` instead). The state clicks the real control, waits for the
  // flash to lapse on both sides, and then re-arms the flag so the pixels are deterministic.
  const setLinkCopied = (b) => { const d = D8();
    if (d) return d.setLinkCopied(b); proto().setState({ linkCopied: b }); };
  // Phase 9. The chat panel. A transcript, a busy row and a reply strip cannot be produced
  // without an API key, so the **messages** are set through each side's own state API — the
  // technique Phase 7 established for \`colorBy\` and Phase 8 for the upload rows. Everything
  // else in these captures is a designed control clicked by its own copy on both sides: the
  // pill that opens the panel, and a wall in the viewport for the property-card state.
  const setChat = (patch) => { const d = D8();
    if (d) return d.chat.setState(patch); proto().setState(patch); };
  // 2026-10-01, app only: the live reply is drawn from two clocks — the trace's and the mascot's.
  // Hold both — the trace \`seconds\` into the turn that is running, the sprite at its frame 0 —
  // or let both go with no argument. The prototype has neither clock.
  const pinTrace = (seconds) => { const d = D8(); if (!d || !d.trace) return;
    const turn = d.trace.timeline();
    const hold = seconds != null && !!turn;
    d.trace.pin(hold ? turn.send + seconds : null); d.vee.pin(hold ? 0 : null); };
  // 2026-10-01: the app's pill reads \`Ask Vee\` (the owner's "Ask Vee" handoff) and the
  // prototype's still \`Ask\`; the reply's author is likewise \`Vee\` on the app and \`SGVue\` on
  // the prototype, which is what each side writes into a quote of its own.
  const chatPill = () => $$('button').find((b) => txt(b) === 'Ask' || txt(b) === 'Ask Vee');
  const ASSISTANT = window.__sgvueDev ? 'Vee' : 'SGVue';
  // One finished turn, carrying everything a reply can carry: two chips, a three-row table
  // and a change the scope guard held back with its apply / cancel.
  const CHAT_TURN = [
    { role: 'user', text: 'How many walls are there, by level?' },
    { role: 'assistant', text: 'Walls by level, across the four models. L1 carries the most; the table totals their gross areas.',
      chips: [{ label: 'IfcWall (140)', ids: [1] }, { label: 'L1 (62)', ids: [2] }],
      table: { groupBy: 'Level', rows: [
        { k: 'L1', n: 62, area: 742.5, ids: [1] },
        { k: 'L2', n: 48, area: 610.25, ids: [2] },
        { k: 'L3', n: 30, area: 388, ids: [3] }] },
      pending: { label: 'isolate 140 elements — leaves 140 of 412 visible', patch: {} } },
  ];
  const CHAT_REPLY = [...CHAT_TURN,
    { role: 'user', text: 'Isolate those elements', quote: { who: ASSISTANT, text: 'Walls by level, across the four models. L1 carries the most; the table totals their gross areas.' } }];
`

/**
 * One entry per Phase 3 parity state. They run **in order** and each one undoes the previous
 * state's change first, so the sequence ends where it started — except `library-open`, which
 * is last because it unloads a model.
 */
const CHROME_STATES = {
  default: '',
  'tree-predef': `click(byText('button', 'by PredefType'))`,
  'search-wall': `click(byText('button', 'by Entity')); typeInto(search(), 'wall')`,
  'group-expanded': `typeInto(search(), ''); await sleep(120); click(group('IfcWall'))`,
  'storey-solo-L2': `click(group('IfcWall')); click(storeyRow('L2'))`,
  'model-hidden-STR': `click(byText('button', 'show all')); click(byTitle('Show / hide model')[1])`,
  'palette-open': `click(byTitle('Show / hide model')[1]); click($$('button').filter((b) => b.title.startsWith('Override this model'))[0])`,
  'project-card': `click($$('button').filter((b) => b.title.startsWith('Override this model'))[0]); click($('button[data-tip="Project, site and building information"]'))`,
  'tool-measure-active': `click($('button[data-tip="Project, site and building information"]')); click($('button[data-tip^="Laser meter"]'))`,
  'view-plan': `click($('button[data-tip^="Select (Esc)"]')); click($('button[data-tip="Plan"]'))`,
  rail: `click($('button[title="Collapse panel"]'))`,
  'library-open':
    `click($('button[title="Open panel"]')); click($('button[data-tip="3D perspective (Home)"]'));` +
    ` await sleep(1400); click(byTitle('Unload model')[3]); await sleep(200);` +
    ` click(byText('button', 'delete')); await sleep(3000); click(byText('button', 'library'))`
}

/**
 * Phase 4 — selection, the property card and the context menu. Identical text in both scripts.
 *
 * They run **in order**, each undoing the previous one's change, so one invocation per theme
 * leaves the app where it found it. The viewport is driven by real mouse events at the same
 * coordinates on both sides; the card's own sections and the menu's items are clicked through
 * the DOM, exactly as Phase 3 drives the chrome — the copy is verbatim on both sides, so the
 * same selector finds the same control.
 *
 * `after` is JavaScript run *after* the input steps: `hide-via-ctx` and `related-click` have to
 * open a menu with the mouse and then choose from it.
 *
 * Two clicks in one state are separated by a sleep. The prototype's `psOpen.*.toggle` closes
 * over the `propOpen` it was rendered with (`SGVue.dc.html:1978–1981`), so two toggles inside a
 * single tick both write from the same stale copy and the first one is lost — a race no person
 * can reach at 300 ms apart, and reproducing it would be reproducing a defect rather than a
 * look. The sleep is what makes both sides answer the same question.
 */
const PROP_STATES = {
  'select-wall': { js: '', input: [CLICK(WALL[0], WALL[1])] },
  'card-identifiers-open': `click(section('Identifiers')); await sleep(300); cardScroll(9999)`,
  'card-related-open':
    `click(section('Identifiers')); await sleep(300); click(section('Related'));` +
    ` await sleep(300); cardScroll(9999)`,
  'card-geometry-open':
    `click(section('Related')); await sleep(300); click(section('Geometry'));` +
    ` await sleep(300); cardScroll(9999)`,
  'multiselect-3': {
    js: `click(section('Geometry')); await sleep(300); cardScroll(0)`,
    input: [CLICK(SECOND[0], SECOND[1], { ctrl: true }), CLICK(HOVER[0], HOVER[1], { ctrl: true })]
  },
  'ctx-multi': { js: '', input: [RIGHT(SECOND[0], SECOND[1])] },
  'ctx-single': { js: '', input: [CLICK(WALL[0], WALL[1]), RIGHT(WALL[0], WALL[1])] },
  'select-similar': `click(item('Select similar'))`,
  'ctx-empty': { js: '', input: [CLICK(EMPTY[0], EMPTY[1]), RIGHT(EMPTY[0], EMPTY[1])] },
  'hide-via-ctx': {
    js: '',
    input: [CLICK(WALL[0], WALL[1]), RIGHT(WALL[0], WALL[1])],
    after: `click(item('Hide'))`
  },
  'related-click': {
    js: `click(byText('button', 'reset'))`,
    input: [CLICK(WALL[0], WALL[1])],
    after: `click(section('Related')); await sleep(300); click(item('Same ObjectType'))`
  }
}

/**
 * Phase 5 — the Filter card, the temporary-state frame, activate mode, undo and viewpoints.
 * Identical text in both scripts.
 *
 * They run **in order** and each one builds on or undoes the last, so one invocation per theme
 * walks the whole feature and ends with nothing hidden: the two `frame-*` states are captured
 * with the card closed, which is the only way to see the whole frame; `undo-after-hide` makes
 * two changes and steps one back, so the status bar carries **both** links.
 *
 * Everything is driven through the designed controls by their own copy — `+ add filter step`,
 * `isolate` / `hide` / `highlight`, `clear`, `save current`, `reset`, `undo`, `Save current
 * view` — and by the `title` / `data-tip` texts the port keeps verbatim, so the same selector
 * finds the same control on both sides.
 */
const FILTER_STATES = {
  'filter-empty': `click(tbBtn('Filter elements by parameter'))`,
  'filter-isolate-L2': `await addStep('Level', 'L2')`,
  'filter-isolate-L2-hide-windows': `await addStep('IfcEntity', 'IfcWindow', 'hide')`,
  // The card covers the left half of the frame, so the frame states close it first.
  'frame-filter': `click(tbBtn('Filter elements by parameter'))`,
  'filter-step-disabled':
    `click(tbBtn('Filter elements by parameter')); await sleep(300);` +
    ` click(byTitle('Enable / disable this step')[0])`,
  'filter-highlight-walls':
    `click(byText('button', 'clear')); await sleep(300);` +
    ` await addStep('IfcEntity', 'IfcWall', 'highlight')`,
  'filter-three-highlights':
    `await addStep('Level', 'L2', 'highlight'); await addStep('IfcEntity', 'IfcSlab', 'highlight')`,
  'filter-saved-set': `click(byText('button', 'save current'))`,
  'activate-ARC':
    `click(byText('button', 'clear')); await sleep(300);` +
    ` click(tbBtn('Filter elements by parameter')); await sleep(300);` +
    ` click($$('button').filter((b) => /^Activate/.test(b.title))[0])`,
  'frame-manual':
    `click($$('button').filter((b) => b.title === 'Leave activate mode')[0]); await sleep(400);` +
    ` click(byTitle('Show / hide storey')[2])`,
  'undo-after-hide':
    `click(byTitle('Show / hide storey')[3]); await sleep(500); click(byText('button', 'undo'))`,
  'viewpoints-one-saved':
    `click(byText('button', 'reset')); await sleep(600); click(tbBtn('Saved viewpoints'));` +
    ` await sleep(300); click(byText('button', 'Save current view'))`
}

/**
 * Phase 6 — gridlines, level tags, the Section card, the laser meter, spot coordinates,
 * selection dimensions, the Markups card and the Coordinate-system card. Identical text in
 * both scripts.
 *
 * They run **in order** and each one builds on or undoes the last, so one invocation per theme
 * walks the whole feature: the three `grids-*` states are the padding rule and the
 * elevation-view family rule; `section-*` walks one grid plane through cut → preview → flipped
 * and offset, then a level — **one plane at a time**, which since 2026-10-01 the app needs
 * `secClear()` for (its gridline cut and level cut are independent, and a level chip no longer
 * replaces a gridline cut); `bubble-click-opens-section` is the bubble's own click handler;
 * `measure-M1` and `spot-C1` commit one markup each; `dims-wall` selects a wall and turns its
 * dimensions on with the property card in the way; `markups-card` adds a second measure and
 * toggles the card to metres; `coords-card` is the four fields.
 *
 * `spot-C1` typed the **prototype's own default base point** into both sides first
 * (28 500 E · 30 200 N · 102.5 Z · 12.5°), so that both would print coordinates. **Not since
 * 2026-10-08**: the owner made the app's Coordinate-system card read-only, so the app refuses
 * the typing, and its base point is the boot file's — none, on the design's mock. The step now
 * places the spot and nothing else; the prototype keeps its own literal base point, so from
 * `spot-C1` on its states print map coordinates where the app's print the file's own level or
 * the em dash, and differ from the phase-6 captures there (`tests/parity/phase6/README.md`).
 */
const ANNOTATION_STATES = {
  'grids-iso': `click(tbBtn('3D perspective (Home)'))`,
  'grids-plan': `click(tbBtn('Plan'))`,
  'grids-north': `click(tbBtn('North elevation'))`,
  'levels-iso':
    `click(tbBtn('3D perspective (Home)')); await sleep(900); click(tbBtn('Levels (L)'))`,
  'section-grid-C':
    `click(tbBtn('Levels (L)')); await sleep(300);` +
    ` click(tbBtn('Section from gridline / level')); await sleep(400); click(secBtn('C'))`,
  'section-grid-C-preview': `click(secBtn('cut'))`,
  'section-grid-C-flip-offset1500':
    `click(secBtn('cut')); await sleep(400); click(secBtn('flip side')); await sleep(400);` +
    ` typeInto(secOffset(), '1500')`,
  'section-level-L2': `click(secClear()); await sleep(400); click(secBtn('L2'))`,
  'bubble-click-opens-section':
    `click(secClear()); await sleep(400);` +
    ` click(tbBtn('Section from gridline / level')); await sleep(500); click(bubble('C'))`,
  'measure-M1': {
    js:
      `click(secClear()); await sleep(400);` +
      ` click(tbBtn('Section from gridline / level')); await sleep(300);` +
      ` click(tbBtn('3D perspective (Home)')); await sleep(900);` +
      ` click($('button[data-tip^="Laser meter"]'))`,
    input: [CLICK(CORNER[0], CORNER[1])]
  },
  'spot-C1': {
    // No base point is typed in first since 2026-10-08: the app's card is read-only (above).
    js: `click($('button[data-tip="Spot coordinate (C)"]'))`,
    input: [CLICK(SECOND[0], SECOND[1])]
  },
  'dims-wall': {
    js: `click($('button[data-tip^="Select (Esc)"]'))`,
    input: [CLICK(WALL[0], WALL[1])],
    after: `click(byTitle('Show dimensions of the selection (D)')[0])`
  },
  'markups-card': {
    js:
      `click(byTitle('Close (Esc)')[0]); await sleep(500);` +
      ` click($('button[data-tip^="Laser meter"]'))`,
    input: [CLICK(HOVER[0], HOVER[1])],
    after:
      `await sleep(500); click($('button[data-tip="Open the markups list"]'));` +
      ` await sleep(500); click(byText('button', 'm'))`
  },
  'coords-card':
    `click($('button[data-tip="Open the markups list"]')); await sleep(400);` +
    ` click(tbBtn('Coordinate system & true north'))`
}

/**
 * Phase 7 — colour by property and its legend, the per-model override palette and the
 * "Original materials" toggle. Identical text in both scripts.
 *
 * They run **in order** and each one builds on or undoes the last: three schemes in a row
 * (an attribute, the storey, and a property-set key — the design's flagship "colour each
 * species"), a highlight step laid over a scheme so the precedence of `BUILD_PLAN.md` §1.4 is
 * visible, a legend row clicked (which selects its elements and so opens the property card and
 * its 332 px lane), the legend's × , then the two per-model states.
 *
 * Only the scheme itself is set through each side's own entry point, because the design gives
 * colour-by no manual control — the assistant's `color_by_property` is the only writer and
 * that is Phase 9. Everything else is a designed control clicked by its own copy or title:
 * `+ add filter step`, `highlight`, `clear`, the legend rows' `Select these elements`,
 * `Clear colour scheme`, `Override this model's colour`, the palette's own hex and the
 * Original-materials switch.
 */
const COLOR_STATES = {
  'colorby-ifcentity': `colorBy('IfcEntity')`,
  'colorby-level': `colorBy('Level')`,
  'colorby-species': `colorBy('SpeciesCommonName')`,
  'colorby-then-highlight':
    `colorBy('IfcEntity'); await sleep(500);` +
    ` click(tbBtn('Filter elements by parameter')); await sleep(300);` +
    ` await addStep('IfcEntity', 'IfcWall', 'highlight'); await sleep(400);` +
    ` click(tbBtn('Filter elements by parameter'))`,
  'colorby-legend-row-click':
    `click(tbBtn('Filter elements by parameter')); await sleep(300);` +
    ` click(byText('button', 'clear')); await sleep(400);` +
    ` click(tbBtn('Filter elements by parameter')); await sleep(300);` +
    ` colorBy('SpeciesCommonName'); await sleep(500); click(legendRows()[0])`,
  'colorby-cleared':
    `click(byTitle('Close (Esc)')[0]); await sleep(500);` +
    ` click(byTitle('Clear colour scheme')[0])`,
  'model-override-with-glass':
    `click(byTitle("Override this model's colour")[0]); await sleep(400);` +
    ` click(byTitle('#E05A6B')[0])`,
  'original-materials-toggle':
    `click(byTitle('Use the surface materials that came with the loaded IFC files')[0])`
}

/**
 * Phase 8 — the landing page, the upload rows, the Resume card, the warning banner, the share
 * link's flash, the sidebar's own upload rows and the library popover. Identical text in both
 * scripts.
 *
 * They run **in order**: eight states on the landing page, then the federation is opened
 * through the design's own "open all four as a federation →" button and the last three are
 * captured on the shell. Every state calls `freeze()` first, so the 26 s survey-grid drift, the
 * spinner, the progress shimmer and the pointer parallax are at the same phase on both sides.
 *
 * The upload rows carry invented file names and the design's **own** rejection reasons, set
 * identically on both sides — see `setUploads` in `UI` for why the rows are state rather than a
 * real parse on one side and a timer on the other.
 */
const LANDING_STATES = {
  landing: `freeze()`,
  'landing-dragover': `freeze(); setDragging(true)`,
  'landing-rejections':
    `setDragging(false); freeze(); setUploads([` +
    ` { id: 'e1', name: 'site-plan.pdf', stage: 'not an IFC file', pct: 0, error: true, dismiss: true },` +
    ` { id: 'e2', name: 'arc-block-b.ifc', stage: 'file is empty', pct: 0, error: true, dismiss: true },` +
    ` { id: 'e3', name: 'whole-campus.ifc', stage: 'larger than 600 MB', pct: 0, error: true, dismiss: true }` +
    `])`,
  'upload-midstage':
    `freeze(); setUploads([` +
    ` { id: 'u1', name: 'arc-block-a.ifc', kb: 18432, pct: 64, stage: 'building geometry' }` +
    `])`,
  'upload-ready':
    `freeze(); setUploads([` +
    ` { id: 'u1', name: 'arc-block-a.ifc', kb: 18432, pct: 100, stage: 'ready', done: true }` +
    `])`,
  'landing-samples-open-all': {
    js: `freeze()`,
    input: [MOVE(455, 606)]
  },
  'landing-error-banner':
    `freeze(); setInitErr('Could not open that model — the model contains no geometry.')`,
  'sidebar-upload-rows':
    `setInitErr(''); click(openAllBtn()); await sleep(5000); setUploads([` +
    ` { id: 'u1', name: 'str-frame.ifc', kb: 9216, pct: 38, stage: 'parsing entities' },` +
    ` { id: 'u2', name: 'sit-context.ifc', kb: 3072, pct: 100, stage: 'ready', done: true },` +
    ` { id: 'e1', name: 'mep-draft.rvt', stage: 'not an IFC file', pct: 0, error: true, dismiss: true }` +
    `])`,
  'library-popover':
    `setUploads([]); await sleep(300); click(byTitle('Unload model')[3]); await sleep(200);` +
    ` click(byText('button', 'delete')); await sleep(3000); click(byText('button', 'library'))`,
  'link-copied':
    `click(byText('button', 'library')); await sleep(300);` +
    ` click(tbBtn('Saved viewpoints')); await sleep(400); click(linkBtn());` +
    ` await sleep(2000); setLinkCopied(true)`
}

/**
 * Phase 9 — the assistant's panel. Identical text in both scripts.
 *
 * They run **in order** on the booted federation: the pill alone, the panel opened by clicking
 * it, one finished turn, the busy row, a reply, and the same panel with the property card
 * open — which is the one state where the panel steps out of the card's lane (`:2049`).
 *
 * `chat-busy` is the transcript a turn actually has while it runs — the user's question and
 * nothing else yet — which is also what puts the busy row in frame: the log scrolls to the
 * bottom when the message count changes (`:879`), on both sides.
 *
 * `freeze()` runs first and stays: the busy row's three dots, its brand mark tracing itself and
 * the 26 s survey-grid drift are animations, and which frame each side is on when
 * `capturePage()` runs is a race rather than a parity property. `animation: none` removes them,
 * so both sides render each element's base style (`tests/parity/phase8/README.md`).
 *
 * 2026-10-01: on the app `chat-busy` is no longer the design's busy row but the assistant's live
 * reply — `Vee`, `Thinking` — which is not a CSS animation and is held by `pinTrace` instead;
 * `chat-reply` lets the clocks go again. The two sides differ there by design.
 */
const CHAT_STATES = {
  'chat-pill': `freeze(); setChat({ chatOpen: false, chatMsgs: [], chatBusy: false, chatErr: '', chatReplyTo: null })`,
  'chat-empty': `click(chatPill())`,
  'chat-transcript': `setChat({ chatMsgs: CHAT_TURN })`,
  'chat-busy': `setChat({ chatMsgs: [CHAT_TURN[0]], chatBusy: true, chatStage: 'totalling quantities' }); pinTrace(3)`,
  'chat-reply': `pinTrace(); setChat({ chatBusy: false, chatStage: '', chatMsgs: CHAT_REPLY, chatReplyTo: 1 })`,
  'chat-with-card': { js: `setChat({ chatReplyTo: null })`, input: [CLICK(WALL[0], WALL[1])] },
  // The corner stroke's own hover state (`:432`): the design sets `--grab` on the 34 px hit
  // area and both borders read `var(--grab, var(--border-strong))`, so this is the one hover
  // in the port that travels through a custom property rather than a colour.
  'chat-corner-hover': { js: '', input: [MOVE(775, 397)] }
}

/**
 * Where the designed chrome is, in CSS pixels, read out of the live DOM beside every capture.
 * `tests/parity/phase3/README.md` masks the diff to these rectangles, so the 3D stage — whose
 * r170/0.186 hemisphere-light difference is Phase 2a's, not this phase's — is excluded and a
 * rectangle that moved between the two sides is a defect the diff names.
 */
const RECTS = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const all = [...document.querySelectorAll('div,aside,main')];
  const abs = (e) => { const p = getComputedStyle(e).position; return p === 'absolute' || p === 'fixed'; };
  // The innermost match: querySelectorAll is document order, so an ancestor that merely
  // contains the text comes first and the element itself comes last.
  // SVY21 used to identify the status bar; the CRS chip is read from the file now
  // (shared/georef.ts), so the one field that is always in it does the identifying.
  // 2026-10-01: on the app the status bar, the hint and the reset pill are zones of one bottom
  // row and no longer position themselves, so each is found by its \`data-role\`; the prototype,
  // which has none of the three roles, is still found by the shape the design gives it.
  const role = (name) => document.querySelector('[data-role="' + name + '"]');
  const status = role('statusbar') || all.filter((e) => abs(e) && / fps/.test(e.textContent || '')).pop();
  const card = all.filter((e) => abs(e) && /^Spatial structure/.test((e.textContent || '').trim())).pop();
  // "The last box at bottom:14px" is the hint bar, or the reset pill when there is no hint —
  // on both sides, so the app names them in that order.
  const hint = role('hintbar') || role('resetpill') ||
    all.filter((e) => abs(e) && getComputedStyle(e).bottom === '14px').pop();
  // Phase 4: the property card by its data-role, and the context menu by the one shape only it
  // has — fixed, z-index 10, min-width 200px (SGVue.dc.html L834).
  const prop = document.querySelector('[data-role="propcard"]');
  const menu = all.filter((e) => { const c = getComputedStyle(e);
    return c.position === 'fixed' && c.zIndex === '10' && c.minWidth === '200px'; }).pop();
  // Phase 5: the two left-lane cards by their own heading, and the temporary-state frame by
  // the two shapes only it has — a 3 px border at z-index 6, and a pill at the same depth.
  const lane = all.filter((e) => abs(e) && getComputedStyle(e).zIndex === '14');
  const filter = lane.find((e) => /^Filter/.test((e.textContent || '').trim()));
  const views = lane.find((e) => /^Viewpoints/.test((e.textContent || '').trim()));
  const z6 = all.filter((e) => abs(e) && getComputedStyle(e).zIndex === '6');
  const frameBox = z6.find((e) => getComputedStyle(e).borderTopWidth === '3px');
  const framePill = role('resetpill') || z6.find((e) => getComputedStyle(e).borderRadius === '999px');
  // Phase 6: the three new left-lane cards, and every DOM annotation label that is actually
  // drawn — text and position, sorted so creation order cannot read as a difference.
  const section = lane.find((e) => /^Section/.test((e.textContent || '').trim()));
  const markups = lane.find((e) => /^Markups/.test((e.textContent || '').trim()));
  const coords = lane.find((e) => /^Coordinate system/.test((e.textContent || '').trim()));
  const ov = document.querySelector('[data-role="overlay"]');
  const labels = !ov ? null : [...ov.children]
    .filter((e) => getComputedStyle(e).display !== 'none')
    .map((e) => { const b = e.getBoundingClientRect();
      return { t: (e.innerText || '').replace(/\\s+/g, ' ').trim(), x: Math.round(b.x),
        y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  // Phase 7: the colour-by legend — the design's one absolutely-positioned z-index-11 box
  // (SGVue.dc.html:413) — with each row's swatch colour, so a scheme colour that differs by a
  // single hex digit is named in the sidecar rather than left to the pixels.
  const legend = all.filter((e) => abs(e) && getComputedStyle(e).zIndex === '11').pop();
  const legendRows = !legend ? null : [...legend.querySelectorAll('button[data-tip="Select these elements"]')]
    .map((b) => ({ c: getComputedStyle(b.firstElementChild).backgroundColor,
      t: (b.innerText || '').replace(/\\s+/g, ' ').trim() }));
  // Phase 8: the landing page — its box, every line of its copy, and the share link's label,
  // so the 1 600 ms flash is compared as text rather than left to the pixels.
  // Phase 9: the assistant's panel — the design's one absolutely-positioned z-index-12 box
  // (SGVue.dc.html:431) — and the pill that opens it, which is a button and so is not in
  // \`all\`. Every line of the panel is read back, so a bubble's copy, a chip, a table row, the
  // pending label and the four suggestions are compared as text rather than left to the pixels.
  const chat = all.filter((e) => abs(e) && getComputedStyle(e).zIndex === '12').pop();
  // 2026-10-01, app only: undo / redo and the markup counts left the status bar for the action
  // bar above it (owner-requested). The prototype has none, so its two readbacks are \`null\`.
  const action = document.querySelector('[data-role="actionbar"]');
  const pill = [...document.querySelectorAll('button')].find((b) => /^Ask( Vee)?$/.test((b.innerText || '').trim()));
  const landing = document.querySelector('[data-role="landing"]');
  const link = [...document.querySelectorAll('button')]
    .find((b) => /^(copy link to this state|link copied)$/.test((b.innerText || '').trim()));
  const flat = (e) => e ? (e.innerText || '').replace(/\\s+/g, ' ').trim() : null;
  const lines = (e, n) => e ? (e.innerText || '').split('\\n').map((t) => t.trim()).filter(Boolean).slice(0, n) : null;
  return JSON.stringify({
    panel: r(document.querySelector('aside')),
    stage: r(document.querySelector('[data-role="stage"]')),
    toolbar: r(document.querySelector('[data-role="toolbar"]')),
    cube: r(document.querySelector('[data-role="cube"]')),
    status: r(status), card: r(card), hint: r(hint),
    propcard: r(prop), ctx: r(menu),
    filter: r(filter), views: r(views), frame: r(frameBox), framePill: r(framePill),
    // What each side actually selected and offered, so a state that clicked a different
    // element — or a menu that came out different — is visible in the sidecar, not only in
    // the pixels.
    sel: lines(prop, 6),
    ctxItems: menu ? [...menu.querySelectorAll('button')].map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()) : null,
    // Phase 5 readbacks: every line of the two cards, the banner's own copy and the colour of
    // the frame (amber for manual hides, accent when a filter step drives it), and the status
    // bar, where undo / redo appear on the prototype — and, on the app, the action bar they
    // moved to on 2026-10-01.
    filterText: lines(filter, 60),
    viewsText: lines(views, 20),
    frameLabel: flat(framePill),
    frameTone: frameBox ? getComputedStyle(frameBox).borderTopColor : null,
    statusText: flat(status),
    actionbar: r(action), actionText: flat(action),
    section: r(section), markups: r(markups), coords: r(coords),
    // 60, not 40: the app's Section card carries its two control rows once per plane since
    // 2026-10-01, and a real model's grid has more chips than the mock's nine.
    sectionText: lines(section, 60), markupsText: lines(markups, 40), coordsText: lines(coords, 20),
    coordVals: coords ? [...coords.querySelectorAll('input')].map((i) => i.value) : null,
    labels,
    legend: r(legend), legendText: lines(legend, 24), legendRows,
    // The camera, so the parity README can state it rather than describe it.
    landing: r(landing), landingText: lines(landing, 44), linkLabel: flat(link),
    chat: r(chat), chatText: lines(chat, 44), pill: r(pill),
    camera: window.__sgvueDev ? window.__sgvueDev.debug() : null
  });
})()`

/** Deliver one input step through Chromium's real mouse pipeline. */
async function sendInput(win, step) {
  const wc = win.webContents
  if (step.wait) return wait(step.wait)
  const [x, y] = step.move || step.click || step.dblclick
  const modifiers = step.ctrl ? ['control'] : []
  // Two moves: Chromium drops a `mouseMove` that does not move, and a state may repeat the
  // previous state's coordinate (snap on → snap off).
  wc.sendInputEvent({ type: 'mouseMove', x: x - 3, y: y - 3, modifiers })
  await wait(80)
  wc.sendInputEvent({ type: 'mouseMove', x, y, modifiers })
  if (step.move) return wait(260)
  const button = step.button || 'left'
  const press = (clickCount) => {
    wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount, modifiers })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount, modifiers })
  }
  press(1)
  if (step.dblclick) {
    await wait(40)
    press(2)
  }
  return wait(260)
}

module.exports = {
  MOVE,
  CLICK,
  RIGHT,
  DBLCLICK,
  CUBE,
  HOVER,
  SECOND,
  CORNER,
  WALL,
  EMPTY,
  UI,
  CHROME_STATES,
  PROP_STATES,
  FILTER_STATES,
  ANNOTATION_STATES,
  COLOR_STATES,
  LANDING_STATES,
  CHAT_STATES,
  RECTS,
  sendInput
}
