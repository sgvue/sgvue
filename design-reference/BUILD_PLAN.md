# SGVue — Build Plan

A sequenced plan for building SGVue from scratch in a real codebase. Read
`README.md` first for what the bundled files are; this document is the plan.

---

## 0. What you are building

A browser-based IFC model viewer for BIM coordination review. A user loads one or
more IFC files, which merge into a single **federation**; they then isolate by storey,
entity or rule, section along gridlines, measure with corner snapping, inspect IFC
property sets, colour by any property, and drive all of it in plain language through an
AI assistant.

**Two constraints that shape everything:**

1. **Everything runs client-side.** No file is uploaded. This is a stated product
   promise in the UI — keep it.
2. **The assistant is strictly read-only with respect to model data.** It changes what
   is *shown* and reports what is *there*. It never writes names, parameters, property
   sets, classifications or geometry. There is deliberately no tool for it. This is a
   hard product requirement, not a phase-1 simplification.

---

## 1. Architecture decisions (and why)

Make these choices before writing code; each one prevented a class of bug during the
prototype.

### 1.1 Two layers with an imperative boundary

```
UI layer (state, panels, cards, chat)
        │  imperative calls only — never touches three.js
        ▼
Renderer (viewer-core) — three.js scene, camera, picking, annotation overlay
        │  callbacks up: select, hover, measure, spot, hint, camera, fps
```

The renderer exposes ~30 methods (`setVisibility(fn)`, `setSelected(ids)`,
`setElementColors(map)`, …). The UI never reaches into the scene graph. This survives
any framework choice and makes the renderer independently testable.

### 1.2 Visibility is derived, never stored per element

One predicate composes every source of truth. Do not keep a `visible` flag on elements
in UI state:

```
visible(el) =
     !hidden[el.id]
  && modelVis[el.model] !== false
  && storeyVis[el.storey] !== false
  && for each enabled filter step, in order:
        isolate → must match
        hide    → must not match
```

`setVisibility(fn)` takes the predicate; the renderer applies it. Every visibility
feature (element hide, storey solo, model toggle, filter stack, activate mode) feeds
this one function.

### 1.3 The filter is an ordered stack, not a single rule set

```ts
type Rule  = { prop: string; op: '=' | '!=' | '~' | '>' | '<'; val: string; join?: 'and' | 'or' }
type Step  = { id: string; on: boolean; action: 'isolate' | 'hide' | 'highlight'; color: string; rules: Rule[] }
type Stack = Step[]   // array order IS apply order
```

- Within a step, rules are ANDed unless a rule sets `join: 'or'`; **OR binds looser than
  AND** (rules split into OR groups at each `or`, a match is any group fully satisfied).
- Across steps, order matters: `isolate L2` → `hide windows` ≠ `hide windows` → `isolate L2`.
- `highlight` steps do not change visibility; each carries **its own colour**.

### 1.4 One element-colour map, composed every frame

Three colour systems coexist. Compose them into a single `id → hex` map and hand it to
`setElementColors`, in this precedence:

```
native IFC materials            (base)
  ← per-model override          (setModelColors)
  ← colour-by-property scheme   (legend)
  ← each enabled highlight step, in stack order   (later step wins)
  ← hover / selection materials (renderer-owned, always on top)
```

### 1.5 Overlay lane arbitration

The viewport hosts absolutely-positioned overlays that compete for width. Declare the
lanes; do not nudge offsets:

- `--rlane` on the stage element = width reserved by the right lane (property card),
  `332px` when a selection is active and the stage is ≥420px, else `0px`.
- Every left-lane card: `max-width: calc(100% - 24px - var(--rlane, 0px))`.
- `cardTop` = measured toolbar height + 24px, via `ResizeObserver`. Every left-lane card
  uses it as `top`; the chat panel uses it in `max-height: calc(100% - cardTop - 64px)`.
- Explicit z-order: **cards 14 · chat pill 13 · chat panel 12 · visibility frame 6**.

### 1.6 Undo snapshots a named key set

```
VIS_KEYS = ['hidden', 'storeyVis', 'modelVis', 'stack', 'active']
```

Every mutation of those keys pushes a JSON snapshot (cap 50). Undo/redo stacks live
**outside** reactive state — they must not trigger renders. Each AI turn additionally
stores the pre-turn snapshot on its message for a per-message revert.

---

## 2. Data contracts

### 2.1 Element

```ts
type Element = {
  id: number               // unique across the federation
  guid: string             // IFC GlobalId (22-char base64)
  tag: string
  model: string            // source file key — drives colour / visibility / activate
  name: string
  type: string             // IfcEntity, e.g. 'IfcWall'
  predefinedType: string   // e.g. 'SOLIDWALL' | 'NOTDEFINED'
  objectType: string       // type family, e.g. 'EW 200 Brick'
  storey: string
  material: string
  psets: Record<string, Record<string, string | number | boolean>>  // Pset_* and SGPset_*
  qto:   Record<string, Record<string, number>>                     // Qto_*
  // geometry: solids, each with a colour key
}
```

### 2.2 Model / federation

```ts
type Model = {
  project:  { name: string; file: string; schema: string; site: string; building: string }
  storeys:  { name: string; elev: number /* metres */; h: number }[]
  grids:    { name: string; axis: 'x' | 'y'; v: number /* metres */ }[]
  elements: Element[]
}
```

`federate(models)` merges several: offsets ids per model so they stay unique, tags every
element with its `model` key, unions storeys and grids by name. Real files additionally
need spatial-structure GlobalId reconciliation across files.

### 2.3 Property lookup — one resolver for everything

```
attr(el, key):
  'Model' → el.model,  'IfcEntity' → el.type,  'PredefinedType' → el.predefinedType,
  'ObjectType' → el.objectType,  'Level' → el.storey,  'Name' → el.name,
  'Material' → el.material
  otherwise: first match for `key` across every pset, then every qto
  else undefined
```

**This resolver must be used by filter rules, `summarize_elements` grouping, and
colour-by-property alike.** The prototype originally hard-coded a five-value enum for
grouping, which silently made every property-set key ungroupable.

`propKeys` = the seven attributes + every key found in any pset/qto across the loaded
federation. It feeds the rule builder's dropdown, the value autocomplete, and the AI
schema.

### 2.4 Units

All internal geometry is **metres**. Display converts to millimetres at the last moment.
Real IFC files declare their own unit assignment — normalise on import.

---

## 3. Build phases

Each phase ends in something demonstrable. Acceptance criteria are written so they can be
checked by hand or automated.

### Phase 0 — Scaffold (½ day)

- Project skeleton in the target framework; fixed full-viewport layout
  (`html, body { margin: 0; height: 100%; overflow: hidden }`).
- Design tokens as CSS custom properties on `:root`, plus a `[data-theme="light"]`
  override block (§5). Theme switches via `document.documentElement.dataset.theme`.
- Fonts: IBM Plex Sans / Mono / Serif — **self-host in production**.
- Global rules: `a` / `a:hover` colours, `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`,
  and a `prefers-reduced-motion` block flattening all animation.

**Accept:** blank themed shell, no scrollbars, theme toggle flips every token.

### Phase 1 — Renderer core (3–4 days)

The largest single piece. Build it framework-agnostically.

1. **Scene setup** — three.js WebGPU renderer with WebGL fallback, studio lighting,
   ground plane, shadow-casting directional light, a two-tier construction grid.
2. **Geometry build** — one record per element:
   `{ el, meshes[], edges[], keys[], bbox, verts, visible, hl, fading }`.
   `verts` are deduplicated corner positions, used for snapping.
3. **Materials — cached and shared per element class.** Never one material per mesh.
   Keep separate banks: base, hover, per-model override, override-hover. Transparent
   materials never cast shadows. Section clipping is applied per material (`clipify`) so
   cut faces can be capped (`capify`).
4. **Camera controller** — spherical `{theta, phi, dist, target, half}` with a goal/current
   pair lerped per frame: `k = 1 - exp(-dt * rate)`. `rate = 14` for direct manipulation;
   **deliberate jumps** (view buttons, zoom-to, double-click, session restore) set a
   ~620ms window at `rate = 5` so they read as a flight. Perspective and orthographic.
5. **Input** — drag = pan, Shift+drag = orbit, wheel = dolly. Touch: `touch-action: none`,
   pointers tracked in a Map; one finger orbits, two fingers pinch-zoom and pan (the
   two-finger branch must `stopPropagation` so the one-finger orbit path does not also fire).
   Double-click frames the hit element and selects it; on empty space, zoom to extents.
6. **Picking** — a rebuildable pick list of visible, pickable meshes. `setPickable(fn)`
   drops non-matching elements out of hit-testing while leaving them rendered.
7. **Annotation overlay** — 2D **DOM** labels in an overlay div, projected each frame
   (`toPx`), not sprites. Each label carries flags: `on`, `clamp` (keep inside viewport),
   `stack` (avoid vertical collisions), `occlude` / `occluded`.
8. **View cube** — a second tiny renderer, orbit-synced, 26 hit zones (6 faces, 12 edges,
   8 corners), click to snap.

**Accept:** the sample model renders; orbit/pan/zoom smooth at 60fps; view buttons ease;
touch gestures work on a tablet; clicking an element fires `on.select`.

### Phase 2 — Shell and sidebar (2 days)

Layout: 300px sidebar (`flex: none`, `flex-direction: column`, `min-height: 0`) +
`flex: 1` viewport (`position: relative`). Sidebar collapses to a narrow rail.

Sidebar contents, top to bottom:

1. **Brand lockup row** — its own full-width row, mark 22px with `flex: none`,
   wordmark, right-aligned "IFC REVIEW" with `white-space: nowrap`. Brand only — must not
   share a row with the project button (a logo beside an entity label reads as an icon
   *for* that entity).
2. **IfcProject button** — opens the Spatial structure card; shows active state.
   Eyebrow / project name in serif / meta line `{n} models · {file} · {schema}`.
3. **MODELS** — per model: visibility eye, colour swatch button, name + file, element
   count, activate target, remove ×. Header carries `upload · library`.
4. **STOREYS** — eye, name, signed elevation in mm (`+3 500` / `−1 000`, thin-space
   grouped), count, solo.
5. **ELEMENTS** — two tabs, **by Entity** and **by PredefType**; search across name,
   entity, object type, predefined type and storey. Each row is two lines: name, then
   meta `PredefinedType · ObjectType · Level` (by Entity) or
   `IfcEntity · ObjectType · Level` (by PredefType), falsy parts dropped, `NOTDEFINED`
   omitted.

**Accept:** every list reflects the loaded federation; search filters; tabs group correctly;
collapse/expand works.

### Phase 3 — Selection and the property card (2 days)

- Click selects; **Ctrl/⌘-click toggles** into a multi-selection; right-click opens a
  context menu acting on the **whole selection** (hide, hide similar, isolate, isolate
  similar, select similar, zoom to, properties, ask about this).
- Multi-selection clears when models are added or removed (stale ids).
- Property card, right lane, `z-index: 14`. **Order matters — property sets first,
  geometry last:**

  1. Four identity tiles — IfcEntity, PredefinedType, ObjectType, Level.
     Labels `600 10.5px` uppercase in `--muted` (not `--faint`: 9.5px `--faint` on
     `--step-bg` is 4.27:1 and fails).
  2. Containment path chips — `Project › Site › Building › Storey`. Deduplicate
     **globally** (first occurrence wins, not just adjacent), and render `›` only
     *between* items.
  3. **PROPERTY SETS** — the card's main content, under a 2px rule, open by default.
     One bordered box per set with a kind badge — **SGPset** (accent-framed) / **Pset** /
     **Qto** — and the name with its prefix stripped and camelCase split
     ("Wall Common"). Rows inside with hairline separators, keys in sans, values in
     tabular mono. Order: SGPset → Pset → Qto.
  4. **Identifiers** (collapsed) — GlobalId + copy, Tag, Model, Material.
  5. **Related** (collapsed) — "Same ObjectType" / "Same PredefinedType" with counts;
     clicking selects all matches.
  6. **Geometry** (collapsed, last) — bounding box in mm, footprint m², box volume m³,
     base → top, SVY21 centroid, solid count.

**Accept:** selecting an element shows its psets without scrolling; collapsed sections
remember state; Related selects the right set.

### Phase 4 — Visibility and the filter stack (3 days)

- Element hide/show/isolate, storey solo, model toggle, activate mode.
- **Activate mode**: one model owns the lists and the picker; the others render at **8%
  opacity grey with edges off** and drop out of hit-testing. Selection prunes to the
  active model; activation clears if that model unloads.
- **Filter card** — the step stack above the rule builder:
  - Step row: number · eye · action badge (highlight badges render *in* the step's colour,
    with **fixed `#0F1516` ink** — see §6) · rule summary · live match count · ↑↓ · ×.
  - Click a step to edit its conditions below; the action segmented control and on/off
    pill act on the selected step.
  - `+ add filter step`, `clear`.
- **Isolate/hide transitions** — a 220ms crossfade driven by **one shared material pair**
  for the whole batch (out `.3 → 0`, in `.02 → .3`), then real materials restore and
  hidden meshes get `visible = false`. Edges suppressed during the fade; picking and
  dimension redraws deferred to the end. Instant under reduced motion.
- **Temporary-visibility frame** — whenever anything is hidden: a 3px inset frame plus a
  bottom-centre banner with the state and a `reset`. **Amber** (`--warn-line`) for manual
  hides, **accent** when filter steps are driving it. This is the only signal — do not add
  a duplicate "show hidden" button elsewhere.
- **Undo** — ⌘Z / ⇧⌘Z over `VIS_KEYS`, with undo/redo links in the status bar.
- **Saved filter sets** — name and persist a whole stack; chips apply, × forgets; cap 12.

**Accept:** `isolate L2` → `hide IfcWindow` gives a different result from the reverse
order; disabling step 1 re-expands what step 2 acts on; ⌘Z unwinds one step at a time.

### Phase 5 — Annotation (3 days)

- **Gridlines** — extend past the building by `pad = max(2.5m, 6% of footprint)`.
  In elevation views (`|phi − π/2| < 0.25`) only the grid family that spreads across the
  screen is drawn; the collapsed family hides line, stem and bubble. Bubbles lift to
  `bbox.max.z + pad` and drop a vertical stem to ground; only the near-side bubble is kept.
  **Bubbles are depth-tested** — they are DOM, so raycast each anchor along the view
  direction against the visible pick set and hide the ones the building is in front of.
  Throttle to every 4th frame.
- **Levels** — rings plus tags at `max(6m, 12% of footprint)` beyond the corner, **clamped
  into the viewport** and **stacked with a minimum vertical gap** so close storeys do not
  overlap.
- **Section** — pick a gridline or level, offset in mm, flip, cut-fill toggle.
- **Snapping** (laser meter + spot coordinates) — corner catch radius **16px**, edge
  **11px**, corners win ties. The marker draws **at the snapped point**, not under the
  cursor: square = corner, ring = edge, dot = free face. Magnet toggle (`S`) for exact
  free picks; marker label reads `corner` / `edge` / `free`.
- **Selection dimensions** (`D`) — bbox plus three dimension runs with ticks and mm labels.
  Label placement is a **screen-space search**: each run keeps its own face; candidate
  anchors slide along the run (`t = .5, .72, .28, .9, .1`) crossed with push directions,
  then offset vertically in ±26px steps; candidates are rejected against measured
  obstruction rects (property card, view cube — passed in from the UI via
  `getBoundingClientRect`) **and against labels already placed in the same pass**.
- **Markups card** — measurements and spots numbered (M1, C1…), click the tag to zoom,
  × to delete, per-kind clear, mm/m unit toggle.

**Accept:** dimension labels never overlap each other or the property card; grid bubbles
disappear behind the building; snapping catches a corner from 16px away.

### Phase 6 — Colour systems (1 day)

- **Per-model override** — a 7-swatch palette per model row + reset. Picking a colour
  switches out of native-material mode; the source material's opacity is preserved
  (glass stays glass). An **Original materials** toggle flips between IFC-authored
  colours and overrides, remembering overrides while off.
- **Colour by property** — every distinct value of any attribute or pset key gets its own
  colour from an 11-colour scheme, largest group first, plus a **legend** bottom-left:
  property name, swatch, value, count; rows select those elements; × clears. Suppress on
  federation change so stale ids cannot linger.
- **Per-step highlight colours** — new steps auto-pick the next unused palette colour.
  `applyMat` must prefer a step colour over the shared highlight material so matched
  elements render at full opacity in their own colour while others ghost.

**Accept:** "colour by species" yields distinct colours + legend; three highlight steps
show three colours; overlapping steps resolve to the later step's colour.

### Phase 7 — Landing, upload, session (2 days)

- **Landing page** — serif headline, one-line explanation, drop zone, sample library,
  footer. Nothing auto-loads.
  - **Interactive background**: an axonometric survey grid (fine 88px + coarse 440px
    `repeating-linear-gradient` layers) at `perspective(1100px) rotateX(66deg) rotateZ(-24deg)`,
    drifting one cell per 26s so it loops seamlessly, parallaxing off the pointer via CSS
    custom properties written **directly to the element** (never through state), an accent
    glow tracking the cursor, and a gradient scrim so text keeps contrast. All disabled
    under reduced motion.
  - **Drop zone** — `<label>` around a hidden multi-file input; dragover flips border to
    accent and label to "Release to load".
  - Render the sample library **only when the file list is non-empty** — otherwise a cold
    load paints an empty row and "open all zero".
- **Upload pipeline** — background work with a visible queue, never a blocking modal.
  Validate before queueing (extension, empty, >600 MB); each rejection gets its own
  dismissible warning row. Files stagger 500ms. Five stages at 420–780ms:
  reading file 16% → parsing entities 38% → building geometry 64% → indexing properties
  86% → federating 100%. Then **ready**: bar turns green, shimmer stops, spinner pops
  into a check, holds 1100ms, then the model joins the federation.
- **Session + deep links** — persist the whole review state (debounced 600ms): models,
  upload names, hidden, storeyVis, modelVis, active, model colours, native flag, tree
  mode, grids, levels, shadows, theme, snap, dims, section, **stack**, hl colour, view,
  coords, camera. Surfaces as "Resume last session" on the landing page; base64-encoded
  into `#s=…` for a share link, which takes precedence over stored state on load.
  Restore order: grids, levels, coords, snap, model colours, highlight colour,
  pickability, section, shadows, camera, then visibility.
- **Failure states** — boot with no models, model with no geometry, renderer failure: all
  return to the landing page with a stated reason in the error banner. Never leave the
  user on a broken viewer.

**Accept:** first run shows the empty state; a dropped file streams through all five
stages while the viewport stays interactive; a share link reopens the exact view.

### Phase 8 — AI assistant (3 days)

A bottom-right pill opening a resizable panel (drag the top-left corner; a 17px rounded
corner stroke tracing the panel radius, not an arrow glyph).

**Grounding — the system prompt carries, every turn:**

- The read-only contract, stated as a refusal instruction.
- The rule grammar, including that OR binds looser than AND.
- The stack model: ordered steps, step 1 narrows, step 2 acts on what step 1 left.
- **Live view state**: active filter stack with per-step enabled/action/rules,
  visible/total counts, manual hides, storeys shown, active model, view, projection,
  section, selection count. *Without this the assistant is blind across turns and an
  "add X also" request silently replaces the whole filter.*
- **Live model schema**: loaded models, storeys, grids, and every distinct IfcEntity,
  PredefinedType, ObjectType and **pset key**.
- A vocabulary note mapping everyday words to the schema: floor/ceiling/roof are all
  `IfcSlab` separated by PredefinedType; glass is `IfcWindow`; partition is
  `IfcWall/PARTITIONING`; **there is no `IfcFloor`, `IfcCeiling` or `IfcGlass`**.
- Which of the three colour tools to use for which phrasing.
- That a message opening with `[replying to …]` resolves pronouns against the **quoted**
  turn, not the most recent one.

**Tools** (read-only tools do not collapse the panel; mutating ones report via chips):

| Tool | Purpose |
|---|---|
| `set_filter_stack` | **The main tool.** Whole ordered stack in ONE call; array order is apply order |
| `apply_visibility` | A single step, or reset. `combine:"add"` appends |
| `manage_filters` | list / enable / disable / move / remove / clear steps |
| `query_elements` | Count + sample matches, read-only, with per-OR-group counts |
| `summarize_elements` | Group by any attribute **or pset key**; totals area/volume from Qto |
| `audit_model` | Data completeness: missing PredefinedType / ObjectType / material / psets / quantities, duplicate names, empty storeys |
| `clash_check` | Bbox interference candidates between two models, sorted by overlap volume |
| `color_by_property` | A colour per distinct value + legend |
| `color_models` | Per-discipline tint |
| `select_elements` | Select, optionally zoom |
| `set_storeys` / `activate_model` | Spatial scoping |
| `set_view` / `set_section` / `toggle_display` | Camera and display |

**Tool design rules learned the hard way:**

- **Declarative over sequential.** A multi-condition view must be ONE call with a steps
  array. Chained calls forced the model to guess replace-vs-append and it lost steps.
- **Report reality, not intent.** Every mutating tool returns the real post-apply count
  and per-group counts, and names any group that matched nothing. A half-satisfied request
  must not read as success.
- **Fail with the vocabulary.** An unknown value returns the valid list, never a bare
  "no match".
- **Scope guard.** A change leaving <5% visible is not applied; it becomes an
  apply/cancel strip in the reply. Everything else applies immediately and is undoable.

**Panel UX:**

- User messages right-aligned in an accent bubble (notch bottom-right), assistant left
  (notch bottom-left). Labels "You" / "SGVue" in sentence-case sans.
- **Reply-to**: a `reply` action per message pins a quote strip above the composer and
  prefixes `[replying to X: "…"]` into the sent content.
- **Per-message revert** — an ↺ restoring the pre-turn snapshot, greying that message.
- **Result chips** — counts are live: click selects, double-click zooms.
- **Tables** — quantity and clash results render as a table with clickable rows and
  `copy csv`.
- **Busy row narrates real work** — each tool announces itself as it starts ("querying
  elements", "totalling quantities by Level", "testing Structure against Mechanical"),
  beside the brand mark drawing itself via `stroke-dashoffset`.
- **Contextual suggestions** — derived from the conversation and view: with a selection,
  "How many more like {ObjectType}?"; after a table, "Break that down by level instead";
  with a filter on, an extend and a reset; with two models, a named clash check; the audit
  prompt drops away once run.
- **Audit on load** — runs locally (no model call) the moment a federation is ready and
  seeds the first message with counts plus a chip per finding.

**Accept:** "isolate L2 then hide the windows" produces two steps in one call;
"colour each species" produces a legend; "how many trees by species" produces a table;
asking it to rename something is refused.

### Phase 9 — Robustness and accessibility (1–2 days)

Already in the prototype: focus-visible rings, `aria-hidden` on decorative layers, a
global reduced-motion rule plus JS guards on parallax and camera easing, dismissible
upload rejections, boot failure recovery.

**Still owed — do these properly:**

- Toolbar controls are 30px, below the 44px touch minimum. Pad up on touch.
- The element tree needs `role="tree"` semantics and arrow-key navigation.
- The context menu needs focus trapping and Escape handling.
- Overlay cards should announce as dialogs and return focus on close.
- The 3D canvas needs a described alternative for the model contents.
- Replace the bbox clash test's O(n×m) loop with spatial hashing before real files.

---

## 4. Replacing the mock data

`sample-model.js` procedurally generates a four-storey block plus a landscape file so the
prototype could be built without a parser. Swap it for **web-ifc** (WASM, runs in a
worker, no server) and preserve the contracts in §2.

The sample library is four discipline files that federate:

| Key | Name | Contents |
|---|---|---|
| ARC | Architecture | external/internal walls, windows, doors, parapets |
| STR | Structure | footings, slabs, columns, beams, stairs, core walls |
| SIT | Site & Landscape | `IfcGeographicElement/TERRAIN` turf areas, `…/VEGETATION` trees with `SGPset_Planting` |
| MEP | Mechanical | duct segments |

Keep this shape when you wire real files — it is what exercises federation, per-model
colour, activate mode, clash check and pset-key grouping.

Grids are suppressed for MEP and SIT (those disciplines do not carry the structural grid).

---

## 5. Design tokens

Fonts: IBM Plex Sans (400/500/600) for UI, IBM Plex Mono (400/500) for **all** numerics,
identifiers, filenames and coordinates, IBM Plex Serif (500/600) for project and product
headlines only.

### Dark (default)
```
--ground        #0F1516      --ink           #E4ECEA
--card          #171F20      --muted         #94A7A4
--border        #263332      --faint         #798C8A
--border-strong #354544
--accent        #35C4B6      --accent-ink    #4FD3C4
--sel-bg        #12302D      --sel-ink       #56D2C4
--step-bg       #1E2827      --step-ink      #C3D2CF
--code-bg       #1D2726      --code-ink      #D3E1DE
--warn-ink      #E8B76A      --warn-bg       #2E2412   --warn-line #4A3A1C
--ok-ink        #86C99C      --ok-bg         #14261B   --ok-line   #27412F
--shadow        0 1px 2px rgba(0,0,0,.45)
```

### Light
```
--ground        #F4F7F6      --ink           #1B2A2C
--card          #FFFFFF      --muted         #54696B
--border        #DCE4E2      --faint         #7C8F8E
--border-strong #BFCFCC
--accent        #0E8A80      --accent-ink    #0A6A62
--sel-bg        #E2F0EE      --sel-ink       #0A6A62
--step-bg       #EDF3F2      --step-ink      #3B5052
--code-bg       #EDF3F2      --code-ink      #1B2A2C
--warn-ink      #8A5B18      --warn-bg       #FBF1E0   --warn-line #E7D4AF
--ok-ink        #2E6B48      --ok-bg         #E8F1EB   --ok-line   #CFE2D6
--shadow        0 1px 2px rgba(27,42,44,.06)
```

The renderer keeps a **parallel palette** for scene colours (background, ground, grid
tiers, edges, gridline/level ink, accent, cut faces). Keep the two in sync.

### Fixed palettes (theme-independent — do NOT tokenise)

```
Highlight / step colours   #35C4B6  #E8A33D  #E05A6B  #7B8CF0  #6BC96B  #D96BD0
Model override adds        #8A9492
Colour-by scheme adds      #8FA3B5  #C9A26B  #6BBFC9  #B58FD9
```

### Scale

- **Radii** — 2px (visibility frame) · 5–6px (icon buttons, chips) · 7–8px (grouped
  controls, inset panels) · 10px (cards) · 12px (toolbar, drop zone, chat panel) · 999px
  (pills, banners, rings)
- **Spacing** — 2 3 4 5 6 7 8 9 10 11 12 14 16 22 26 32 34
- **Type** — 9.5 10 10.5 11 11.5 12 12.5 13 13.5 14 15 17 19 27 px
- **Control heights** — 18/20px (row actions) · 22px · 24px (card close) · 26px (card
  header) · 30px (toolbar) · 32px (chat send, pill)
- **Motion** — .1s tooltip · .12s chevron · .15s card fade / hover / switch knob · .18s
  glow follow · .22s isolate crossfade · .3s check pop · .35s progress width · .5s
  background parallax · .62s camera flight · 1.1s ready hold · 1.3s shimmer · 26s grid drift

### Toolbar

Floating card, `left: 12px; right: 12px; width: fit-content; margin: 0 auto` — this exact
combination is what lets it centre *and* use the full width. Four groups separated by
`column-gap: 10px` with **no divider elements** (dividers strand on wrapped rows):
tools (select · laser · spot · snap) · analysis (section · filter · coords) ·
display (grids · levels) · camera (viewpoints · 3D/Plan/N/S/E/W · shadows · persp/ortho ·
theme). Each group is itself a wrapping flex row with `min-width: 0`.

### Tooltips

In-design, not native `title` — the ~1s native delay makes a dense toolbar feel dead:

```css
[data-tip]{position:relative}
[data-tip]::after{
  content:attr(data-tip); position:absolute; top:calc(100% + 8px); left:50%;
  transform:translateX(-50%) translateY(-3px);
  width:max-content; max-width:min(420px,72vw); white-space:normal; text-align:center;
  font:400 11px/1.35 var(--sans); color:var(--ink);
  background:var(--card); border:1px solid var(--border-strong); border-radius:6px;
  padding:5px 7px; box-shadow:var(--shadow); opacity:0; pointer-events:none; z-index:40;
  transition:opacity .1s ease .04s, transform .1s ease .04s;
}
[data-tip]:hover::after,[data-tip]:focus-visible::after{opacity:1;transform:translateX(-50%) translateY(0)}
```

`width: max-content` matters — a fixed max-width wraps longer hints into unreadable stacks.

### Logo

An isometric cube outline with a bold **V** inscribed through its bottom vertex — the cube
is a building volume in axonometric, the V is both "Vue" and a section wedge. A thin
vertical spoke from top vertex to centre keeps it reading as a solid.

On a 24×24 viewBox:
```
cube   M12 2.6 20.2 7.3v9.4L12 21.4 3.8 16.7V7.3z   stroke var(--muted)
spoke  M12 3.4v8.2                                  stroke var(--muted)
V      M3.8 7.3 12 21.4 20.2 7.3                    stroke var(--accent)
```
Weights: 22px → outline 1.4, V 2.6. 34px → outline 1.3, V 2.3. Always `flex: none` inside
a flex row. At favicon scale **drop the outline entirely** and draw only the V on a
`#0F1516` tile — the hairlines do not survive 16px.

Rules: one closed silhouette, two stroke weights, no gradients, no type inside the mark,
accent stroke is always the design system's teal, works monochrome.

### SEO

Title, description, keywords, robots, author, `theme-color: #0F1516`, full Open Graph
(`locale: en_SG`), Twitter summary card, JSON-LD `SoftwareApplication` with feature list.
`canonical` and `og:url` are **deliberately left unset** — a canonical aimed at the wrong
host is the most damaging SEO error. Set them at deploy. Footer legal/support links are
placeholder anchors that also clobber a `#s=…` deep link when clicked — fix both together.

---

## 6. Pitfalls log

Every one of these was a real defect in the prototype. They are the highest-value part of
this document.

**Layout**

1. **Overlay collisions** — three absolutely-positioned panels (filter card 340px,
   property card 320px, chat 330px = 990px) competed for a 624px viewport. Fixed by
   declaring lanes (§1.5), not by nudging offsets. Every later collision was the same bug
   in a new place.
2. **Binary dodge vs clamp** — moving the chat to `right: 344px` only when there was room,
   and otherwise leaving it at `right: 12px` under a `z-index: 14` card, buried the
   composer completely (`elementFromPoint` returned the card). Always clamp width; never
   fall back to an overlapped position.
3. **Toolbar reservation** — the chat reserved space for the status bar but not the
   toolbar, so it rose over the camera group and killed five buttons. Reuse the measured
   `cardTop` for *both* `top` of cards and `max-height` of the panel.
4. **Out-of-bounds translate** — the panel dodged to `right: 344px` with a fixed 330px
   width on a 624px stage, putting 50px outside the clip edge (header read "K SGVUE").
   Width must be `min(chatW, calc(100% - right - 12px))`.
5. **`flex: none` on inline SVGs** — a 22px mark in a flex row rendered at 15px,
   letterboxed, silently undoing a legibility fix.
6. **`overflow: hidden` on a segmented group** clipped its own tooltips. Round the end
   buttons instead.

**Colour and contrast**

7. **Theme token on a fixed palette** — highlight badge ink was `var(--ground)`, which
   flips to near-white in light theme while the swatch stays mid-tone: 3.33:1. Ink on a
   fixed palette must be a **fixed dark** (`#0F1516`). `--ink` inverts the same way.
8. **Hairline token as stroke** — `--border-strong` is for 1px dividers; as a logo stroke
   on `--ground` it is 1.81:1. Use `--muted` for anything that must read as a mark.
9. **Shrinking and darkening together** — moving tile labels from 11px/`--muted` to
   9.5px/`--faint` crossed the threshold (4.27:1). 9.5px does not qualify for the 3:1
   large-text allowance.

**Annotation**

10. **DOM labels have no depth test** — grid bubbles floated in front of the building.
    Raycast each anchor and hide the occluded ones, throttled to every 4th frame.
11. **Label stacking** — dimension labels collided on thin elements *and* with each other.
    Placed labels must become obstacles for subsequent ones in the same pass.
12. **World-space offsets are not screen-space safety** — level tags pushed out in metres
    still clipped, because the camera frames the model, not the annotation. Clamp into the
    viewport and stack with a minimum gap.
13. **Heuristic placement loses to measurement** — "mirror if the box centre is right of
    centre" guessed wrong constantly. Project both candidate arrangements and keep the one
    that hides fewer labels, tested against real `getBoundingClientRect()` rects.

**AI**

14. **Wholesale state replacement** — `apply_visibility` overwrote the rule set, so
    "isolate doors and floors" as two calls kept only the floors and the reply claimed
    both. Union on repeat calls, and give the model a declarative whole-stack tool.
15. **Blind across turns** — with no view state in the prompt, "add X also" read as a new
    request. Inject the live filter stack and counts every turn.
16. **Silent mode drift** — an "add" request passed `highlight`, converting an isolate view
    into a ghosted one while the reply said "added". Make `action` optional, default to the
    current mode, and forbid unasked changes in the prompt.
17. **Enum-restricted grouping** — `groupBy` was locked to five attributes, so pset keys
    like `SpeciesCommonName` were ungroupable and "trees by species" failed. Route grouping
    through the same `attr()` resolver as the rules.
18. **Missing capability read as confusion** — "colour each species" failed because no tool
    could assign a colour *per value*; the only options were one highlight colour and one
    colour per file. When the assistant "doesn't understand", check the tool surface first.
19. **Fabricated totals** — replies claimed "52 elements (20 columns, 31 beams, 1 floor)"
    when one element matched. Every mutating tool must return the real post-apply count.
20. **Panel occluding its own output** — the chat sat in the property card's column, so
    `select_elements` opened a card the panel covered. Either move the panel out of the
    lane or stop the tool opening cards; do not rely on z-order.
21. **Nested patch object** — `applyPending` passed `{label, patch}` as the state patch
    instead of `patch`, writing two junk keys and applying nothing.

**Process**

22. **Literal `\n` in an edit** — writing escaped newlines into `viewer-core.js` broke the
    module, which silently emptied `SAMPLE_FILES` and made the whole demo library vanish.
    The error surfaced three layers from its cause.
23. **Stale ES module cache** — after fixing that, the page still failed because the broken
    module was cached; the file on disk was already correct. Verify what the browser serves,
    not what the editor shows.
24. **Replacement instead of insertion** — adding the Site file overwrote the Structure
    entry in `SAMPLE_FILES`; the only visible symptom was the landing page reading "open all
    three".
25. **Empty-list rendering** — the sample block rendered before the file list existed,
    painting an empty row and "open all zero". Gate on non-empty.

---

## 7. Suggested order if you are time-boxed

If you cannot build all nine phases, this sequence keeps a usable product at every stop:

1. Phases 0–3 — a real viewer with selection and IFC properties. Genuinely useful alone.
2. Phase 4 — the filter stack. This is what makes it a *review* tool.
3. Phase 7 — landing, upload, session. Makes it feel like a product.
4. Phase 8 — the assistant. Highest perceived value, but it needs 4 and the `attr()`
   resolver from 2.3 to be worth anything.
5. Phases 5, 6, 9 — annotation, colour, polish.

The assistant is the last thing to build, not the first. It is only as good as the tool
surface underneath it, and every AI defect in §6 was really a defect in that surface.
