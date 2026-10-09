> **What this file is:** the working notes SGVue is built from with AI coding agents — loaded into every agent session: the fidelity contract, the rules, and an index of every decision and trap.
> **Human contributors start at [`CONTRIBUTING.md`](CONTRIBUTING.md).**

# SGVue Desktop — working notes

A read-only IFC model viewer for BIM coordination review, shipped as an Electron desktop app
for macOS and Windows. It loads real IFC files with web-ifc, renders them with three.js, and
answers questions about them through an AI assistant that can look but never touch.

**Read `docs/SYSTEM_SPEC.md` for what the app is.** This file is how we build it.

This file is loaded into every session, so it is kept short. The reasoning and the
measurements behind each decision are in **`docs/DECISIONS.md`**, the parser and renderer
traps in **`docs/TRAPS.md`**, and the dev-utility commands in **`docs/COMMANDS.md`**. Nothing
was dropped when they moved — the full text of each is in git history at `814f155:CLAUDE.md`.

---

## Fidelity contract

The design is finished. We are porting it, not interpreting it.

**Specification of record for everything visible:** `design-reference/design/SGVue.dc.html`
(markup, tokens, spacing, radii, type scale, motion, copy, shortcuts, context menu, cards and
their order, chat panel, landing page, footer, status bar) and
`design-reference/design/viewer-core.js` (scene look: palette, lights, shadows, edges, fades,
camera easing, view cube, snapping markers, dimension labels, grid bubbles, level tags).
`design-reference/BUILD_PLAN.md` §5 gives the token values and §6 the pitfalls.

1. **Port, don't redesign.** Markup is translated from the design's template syntax to JSX one
   element at a time, keeping structure, class names, `data-role`s, copy and `data-tip` texts
   verbatim. The `<style>` block is copied as-is. The logic class is ported method by method
   into store slices and hooks, keeping names and semantics.
2. **Same behaviour, same numbers.** 220 ms crossfade · 16/11 px snap radii · 5 % scope guard ·
   cap 50 undo · cap 12 filter sets · 500 ms stagger · 1100 ms ready hold · 26 s grid drift ·
   148 px cube · 332 px right lane · z-order 14/13/12/6. Every one of them is kept.
3. **Internal implementation may differ only where it is invisible** — batched drawing, a
   scissor-viewport cube, worker parsing. The visible result must be identical.
4. **Design parity harness.** A dev-only adapter feeds the design's own `sample-model.js`
   federation through the app's contract, so we render the same mock the prototype does. Every
   Build Report carries side-by-side screenshots at the same size and state. Differences are
   defects.

### Allowed desktop deviations — the complete list

Anything not on this list is a defect.

- The designed upload / drop-zone controls keep their copy and look; behind them, files come
  from Electron's native Open dialog or native drag-drop instead of a browser file input. The
  design's hidden `<input type="file">` is the one element that is **not** in the port: a
  browser file input inside the drop-zone `<label>` opens Chromium's own chooser when the label
  is clicked, which is not the OS one. The `<label>`, its dashed border, its two states and both
  its lines of copy are unchanged.
- "Copy link" keeps its control, copy and 1 600 ms flash; the link is `sgvue://s=…` (the app
  registers the scheme) and reopens the exact view when the referenced files are available.
- Settings the design has no surface for (API key, model, effort, "Data sent to AI") live
  behind the native app menu (Preferences…) in a small dialog built from the design tokens.
  No designed surface changes.
- The sample library is backed by real IFC files the user provides — same pills, same
  "open all N" copy, rendered only when the list is non-empty.
- Fonts are self-hosted (the design says so); no `<head>` SEO meta; window chrome is the OS's.
- **2026-09-20 — the Coordinate-system card's caption names the detected georeferencing method.**
  Asked for by the user in these words: *"auto detect which way the model is using and show
  it"*. The design's own caption `project base point` is kept verbatim and gains ` · ` plus one
  of `IfcSite placement`, `IfcMapConversion`, `IfcMapConversion + IfcSite placement` or
  `ePset_MapConversion`, **inside the same span and the same style** — no new element, no new
  control. Nothing is appended when the file carries no georeferencing, or once the four fields
  stop showing what the file said (the caption names where *these numbers* came from). When
  something *is* appended the row gains `flex-wrap:wrap`, so the caption takes its own line
  under the CRS chip and the chip keeps the shape the design gave it; with nothing appended
  both style strings are the design's, byte for byte. *(Amended 2026-10-08: two more methods,
  `WorldCoordinateSystem` and `WorldCoordinateSystem + IfcSite placement` — rule 4, the owner's
  — and since the card is read-only the fields are always the file's, so "once the four fields
  stop showing what the file said" cannot happen; the caption names the boot file's method.)*
- **2026-09-20 — a grid bubble that would overprint its neighbour is not drawn, and comes back
  as the view zooms in.** Asked for by the user; the design's nine well-spaced axes needed no
  rule. Hidden through the same path an occluded bubble takes — no new element, no new class.
- **2026-09-20 — above six storeys the element tree keeps 40 % of the sidebar's height, and the
  STOREYS and MODELS lists scroll inside themselves.** The user's own rule, for the case where
  twelve storeys left the tree one row tall. At six or fewer, every style string is the design's.
- **2026-09-20 — the Filter card's operator control gains exactly one entry, `empty`.**
  User-approved ("yes to all five"). The design's five operators cannot say *"this property has
  no value"* — a missing attribute matches only `!=`, which also matches every element carrying
  a *different* value, so "walls with no fire rating" (2 767 of 3 314 on the reference model)
  was unsayable. One `<option value="absent" title="is empty">empty</option>` after `<`, in the
  design's own pattern of a readable label over a terse token (`!=` → `≠`, `~` → `contains`).
  **The control is 64 px wide**, so its own text is the short label — `contains` is clipped
  there and a clipped label on the one entry the design does not have reads as a defect — and
  the phrase `is empty` is kept everywhere there is room for it: the step row's summary and
  badge, the option's tooltip, the OR-group labels and the assistant's schema and prompt.
  While it is selected the value field **keeps its exact box, border, radius and place in the
  grid** and is `disabled` at the step row's own `opacity:.45` with the placeholder `not used`;
  switching to the operator clears the value, which is what the property `<select>` one column
  left already does. Measured: the two Filter-card states that render a rule row with the
  operator control are **byte-identical** to the 2026-09-18 captures, in both themes.
- **2026-09-21 — the landing page's footer strip is not in the port; its theme toggle is.**
  Asked for by the user in these words: *"remove footer. Not valid for desktop app."* Removed:
  the `© <year> SGVue` line, the `·` separator, `Parsed locally, never uploaded`, the spacer,
  and the `Privacy` / `Terms` / `Support` links (`#privacy`, `#terms`, `#support` — placeholder
  hrefs a desktop app has nowhere to point), together with the `border-top` divider. **Kept
  unchanged, in the same place:** the theme toggle — same `onClick`, same `data-tip`, same
  `hv-accent-both` class, same style string — right-aligned in the same 1080 px container at
  the same vertical position, so the theme can still be switched before a model is open (the
  user's choice: *"Keep just the button"*). The strip is now a plain `<div>` rather than a
  `<footer>`, because a landmark holding one button is not a footer. **No new element and no
  new control was added.**

- **2026-09-24 — the landing page loses its Resume card, its pills read "Recent", it fades out
  into the viewer, and a new pick replaces a load in flight.** Asked for by the user in these
  words: *"Remove the resume last session on the home page. Change the wording SAMPLE
  FEDERATION to maybe Recent?"* and *"I prefer to fresh load every time so I can be certain
  which model I currently viewing."* **Removed:** the "Resume last session" card and its
  `N models · N hidden` line (`SGVue.dc.html:756–764`); the stored session is still written,
  and nothing reads it back. **Changed copy:** the pills' heading (`:801`) reads `Recent` —
  same element, same style string, so it renders `RECENT`; the "open all N …" button is
  unchanged. **Changed motion:** the federation is built *during* the last row's 1 100 ms tick
  hold rather than after it, the ticked rows stay until the viewer is revealed at whichever
  finishes last, and the landing page then fades out over the renderer's own 220 ms crossfade
  (`FADE_SECONDS`, linear; `pointer-events:none` while it fades; instant under
  `prefers-reduced-motion`) — where it used to drop the row, stand still for up to 2.2 s while
  the SQL index was built, and vanish. The SQL index now builds after the reveal. **Changed
  behaviour:** while the landing page is up, any new pick — drop, Open dialog, a Recent pill,
  "open all", a link — cancels everything in flight and loads only itself; after boot a pick
  still joins the federation, **except that a file whose model is already open or loading is
  first confirmed and then replaces it** — the user's words: *"Dont do this. Just ask user to
  confirm then remove the old version."* ("this" being the `name (2)` it used to join as). The
  question is a **native OS message box** — `Replace model?` / `"<file>" is already open.` /
  `Replace it with the file you just picked?`, buttons `Replace` · `Cancel` — which is OS
  chrome like the Open dialog, not a designed surface. The stagger, the stage minimums and the 1 100 ms hold are the
  design's numbers, unchanged. **No new element and no new control was added.**

- **2026-09-24 — Help › About tells a short story.** Asked for by the user in these words:
  *"Under Help> About also add some short story about us creating this."* The About item shows
  the name `SGVue` (also in dev, where `app.name` is `sgvue`), the version (`package.json`'s, built in as `__APP_VERSION__` — the same source as the
  landing page) and the story,
  kept verbatim in one constant, `ABOUT_STORY` (`src/main/about.ts`). macOS: the native About
  panel, story as its `credits`. Windows (and Linux): a native `dialog.showMessageBox` on the
  window — OS chrome, like the Open dialog — because Electron's own Windows panel is an
  unparented, synchronous box. No designed surface changes.
- **2026-09-24 — the landing page shows the app version.** Asked for by the user in these
  words: *"Show app version somewhere at homepage."* `v1.0.0` (from `package.json`, written in at
  build time as `__APP_VERSION__`) sits on the left of the strip that holds the theme toggle, in
  `font:400 11px/1 var(--mono);color:var(--faint)`; the strip becomes
  `justify-content:space-between`, so the toggle does not move. No new control.
- **2026-09-24 — the sidebar's MODELS, STOREYS and element-tree sections can be resized in
  height.** Asked for by the user in these words: *"The left hand side panel: Models, Storeys,
  Elements, Allow to resize them in height."* Two zero-height drag handles sit on the
  MODELS↔STOREYS and STOREYS↔ELEMENTS boundaries: a 6 px `row-resize` hit area whose 1 px line is
  transparent at rest and `var(--accent)` on hover. A drag sizes the rows above the handle (the
  first drag pins both lists at their current heights, so the other never jumps); the tree keeps
  `flex:1`; each list keeps one row, the tree three; a double-click puts that list back to
  automatic. Sizes live for the session only. **Undragged, every style string is exactly as
  before, the >6-storey rule included** — measured: the sidebar is pixel-identical to the
  previous build in both themes, and again after a drag and double-click reset.
- **2026-09-24 — the Ask SGVue suggestions take one line, and fold once the conversation
  starts.** Asked for by the user in these words: *"The ASK SGVUE AI suggestion are great but
  take up too many space."* — then, of the options offered, *"one line + hide after start"*.
  The design's wrapping row is one line that scrolls sideways (scrollbar hidden, a fade on the
  right edge while more is off it, the wheel scrolls it). After the first user message it is
  replaced by one chip in the same pill style, `▸ suggestions`, which opens and closes the row;
  picking a suggestion still fills the composer and folds the row again, and a new or cleared
  conversation starts unfolded. What is suggested, and how many, is unchanged.
- **2026-09-24 — a gridline runs on to its bubbles.** Asked for by the user in these words:
  *"The gridline and bubbles have some gaps in between."* The drawn line now reaches each
  bubble's centre (`BUBBLE_GAP × scale` past the clipped end, the design's own bubble position)
  and the bubble's opaque card covers the part inside it, so line meets bubble at every zoom.
  Bubble position, size, style, the overprint rule and occlusion are unchanged; a bubble hidden
  by either keeps its short run of line.
- **2026-09-24 — dimensions between gridlines.** Asked for by the user in these words: *"Show
  the Dimension between gridlines also, offset from bubbles."* One dimension per pair of
  adjacent grids that are parallel within 0.5° (a radial grid gets none), spacing in mm from the
  Float64 segments, at each family's **start** end only, standing inward of the bubble row by a
  fixed screen distance (bubble radius + 8 px + the label's own half-extent along the grid). It
  is the selection dimension's own look — its line material, tick share, label style and
  `mmTxt` — so nothing new is drawn. Labels share the bubbles' declutter sweep (decided after
  every bubble, so no bubble ever gives way to one) and their occlusion test; a run is drawn
  only while its label is, and none is drawn in an elevation.
- **2026-09-24 — the ground is see-through from above.** Asked for by the user in these words:
  *"The base canvas plane kind of hiding the model elements underneath it, when you orbit the
  camera to below the canvas plane only can see it."*; of the options offered, *keep the ground
  at level 0 but see-through, anything below dimmed, the same above ground*. An opaque part
  below grade now shows through at **40 %** of its contrast (a ground veil at 0.6); its ordinary
  edges, see-through parts, glass and annotations below grade stay hidden, as before, and a
  selected part's accent edges show, dimmed by the veil like its faces. **Measured:
  plain ground, shadows included, is byte-identical to the previous build** in both themes; the
  mock's only other changed pixels (531, 0.06 %) are on its at-grade site slab, where the grid
  helper 5 mm under it now meets the slab in a different draw order. From below nothing changed.
  *(Amended 2026-10-08: only while the canvas grid is on — with it off the veil is not drawn,
  below.)*
- **2026-09-24 — the camera frames the building, not the site.** Asked for by the user in these
  words: *"frame the camera on the building, not the site."* Boot, zoom extents, the six view
  presets, the cube, a section's re-aim and a double-click on empty space frame the **building
  box** — every element's box but the site's (`shared/site.ts`), else the whole box. Everything
  that must cover what is drawn (clip planes, shadow frustum, ground and its grid, section
  sheet, occlusion, laser) keeps the whole box. **Measured:** the reference model boots at 1.86
  px a metre (was 1.15); the structure model, which has no site, is unchanged; **the design's
  mock is not** — its turf and trees are `IfcGeographicElement`, so it now frames the block, not
  the site (49 % of the viewport's pixels differ at boot).
- **2026-09-24 — gridline bubbles sit at the grids' own extent.** Asked for by the user in these
  words: *"I think the gridline bubbles are too far away from my uploaded real model."* The
  lines span the union of the grids' authored segments (one under 2.5 m is ignored), padded by
  the design's own rule, else the building's footprint — never the whole model's; the bubble
  gap and elevation lift scale with the building, and the level rings take its footprint. Same
  bubbles, same declutter, same dimensions; **only building elements hide a bubble or a grid
  dimension** — a tree, turf, a topography or a space never does (the orchestrator's ruling).
  **Measured:** 93–173 m → 31–36 m from the reference model's building; on the mock 10.9 m →
  2.8 m, under its street trees, and its plan still shows 18 of 18 bubbles and 7 of 7
  dimensions.
- **2026-09-24 — a toolbar button toggles the canvas (ground) grid.** Asked for by the user in
  these words: *"Add an option to toggle off canvas gridline."* One new control, the only one:
  a button right after Levels, the neighbours' markup, class and on/off colours,
  `data-tip="canvas grid"`, a framed 3 × 3 grid glyph in the toolbar's stroke. It shows or hides
  the fine ground `GridHelper` — not the IFC grids. *(Amended 2026-10-08: and the ground veil
  with it — below.)* On by default; not saved in a session.
  **Amended 2026-10-02:** it was recorded here as "not reachable by the assistant", and now it
  is — `toggle_display`'s `groundGrid`, through the button's own `setGroundGrid` — because the
  owner's direction of 2026-10-01 (*"assistant should possess everything user can do on the
  app"*) supersedes that. The toolbar is one button (32 px) wider, which at the default
  window puts the theme button's centre inside the view cube's 148 px canvas, over an empty
  corner; the cube canvas therefore takes a mouse's events only where the cube, its compass
  ring or its north kite is drawn, and passes them through elsewhere (touch keeps the whole
  square). Nothing drawn changes; the cube's hover and click are unchanged; its native `title`
  tooltip no longer shows over those empty corners.
- **2026-09-24 — "Original materials" off colours every element by its IFC class.** Asked for
  by the user in these words: *"When the material override toggle off, there are nothing
  different. The toggle off are suppose to be coloured in different ifcentity."* With the toggle
  off, an element with no colour-by and no model swatch is drawn in its class's colour —
  exactly the colour `colorBy(elements, 'IfcEntity')` gives it, so the toggle and the
  assistant's colour-by-entity agree. Precedence: a colour-by (or a highlight step) > a model
  swatch the user picked > the IFC class colour > the file's colour. Opacity is the file's, so
  glass stays glass. The hint under the toggle reads `Coloured by IFC class` instead of the
  design's "Overrides on — no model colour set yet". No new control, no legend.
- **2026-09-24 — a double-click renames a saved viewpoint.** Asked for by the user in these
  words: *"allow double click to edit saved view name."* The name swaps, in place, for a text
  field in its own font, colour and box — no layout shift, measured — with the text selected.
  Enter or leaving the field commits (trimmed; blank keeps the old name); Esc cancels. The
  double-click's first click restores the view as a single click always has; its second click
  is ignored, so the view restores once and undo gains one entry. The list has no repeated-name
  rule, so two views may share a name. The new name persists with the list, per building.
- **2026-09-24 — the landing page offers the design's demo building.** Asked for by the user in
  these words: *"Also keep our sample model on the home page for demo."* A text button, `try
  the demo building →`, in the exact style of "open all N as a federation →", always shown:
  after the "or" divider (so the divider is now always drawn) and under the Recent section when
  there are recents. It loads the design's own four-model mock federation — synthetic, safe to
  ship — as one batch, in production builds too (`model/demo.ts`, a lazy 19 kB chunk), and
  obeys the landing page's fresh-start rule. It is never a recent and never in the sidebar
  library; a session or share link cut from it names no files, and reopening one shows the
  designed "That session had no models in it" banner.
- **2026-09-24 — `IfcSpace` is see-through by default.** Asked for by the user in these words:
  *"the ifcSpace, make them transparent by default. They are space anyway."* A space is a faint
  tint of its own colour (`SPACE_ALPHA` 0.08 a face, so a room reads at about 15 %), casts no
  shadow, writes no depth and draws no grey edges; selected or highlighted it is drawn at 0.3 in
  the accent / highlight colour with its accent outline. A click takes the nearest **non-space**
  element on the ray and a space only when it is the one thing hit; the tree still selects a
  space. Hide, isolate, filters, colour-by and the section cut all still apply.

- **2026-09-25 — Help › Check for updates… opens a page in the browser; since 2026-09-28, the
  product site told this version.** Asked for by the owner in these words: *"add the check for
  updates menu item."* A native menu item, like About, under `About SGVue` in the Help menu on
  both platforms. It opened the GitHub releases list until the owner's decision of 2026-09-28:
  *"From the next version, should Help › Check for updates open the new page instead of the
  GitHub releases list?"* → *"Yes, open the page"*. Its click is now
  `shell.openExternal(updatesUrl(__APP_VERSION__))` — `https://sgvue.github.io/?v=<exact
  version>`, URL-encoded, from one hard-coded https constant, `SITE_URL`, in
  `src/main/about.ts`; the site says "You're up to date" or "Update available". The version is
  the build-time one About and the landing page show. **No designed surface changes, and the
  item makes no network call** — no download; `publish: null` stays. *(Until 2026-10-01 the app
  made no network call of its own at all; since then it makes one at launch — the update check,
  below — and the landing page's notice opens this same page. The menu item still makes none.)*
- **2026-09-25 — a second window, Schedules, and one toolbar button that opens it.**
  Owner-approved, in these words: *"I want this ifcTable to be wired together with sgvue, but
  as separate window. The UI everything must be closely harmony with the sgvue design. Then the
  table i can interact with any element table row then it will show me in the 3d."* The
  Revit-style schedule engine of ifcTable (credit: Yong Yen) runs in its own window, drawn
  entirely in SGVue's tokens, fonts and hover classes; a row click selects its element(s) in
  the main window through the element tree's own `select(ids, zoom)`. **Added to the main
  window: exactly one toolbar button** (`data-tip="schedules"`, a table glyph in the `Tool`
  style, in the Section / Filter / Coordinate-system group, the neighbours' markup and classes),
  plus **Window › Schedules** (⇧⌘T / Ctrl+Shift+T) in the native menu. No designed surface of
  the main window changes otherwise. Phase 1 of the port; **phase 2 (the same day) brings the
  whole ifcTable interface into that window**, every visual decision SGVue's. **Phase 3 (the same
  day, the owner's chosen extras) adds, in the Schedules window only:** a right-click menu on
  rows (`Select in 3D`, `Zoom to`, `Isolate`, `Hide`, `Show`, `Show all`, `Copy GUIDs`; also the
  ContextMenu key and Shift+F10) and on column headings (`Colour 3D by this column`, `Clear 3D
  colours`), both drawn with the main `ContextMenu`'s markup and style strings, an item that
  would do nothing `disabled` at the window's `.45`; column headings take keyboard focus
  (`tabindex="0"`, the design's own ring drawn inset) so the ContextMenu key / Shift+F10 reach the
  heading menu — nothing shows for a mouse, the phase-2 captures are unchanged but for timers; the existing row highlight for the main
  window's selection, a status-line note and an accent dot in the rail when that selection is
  in another category; the legend's colour square before each value of the colour-source
  column and a small bar of its first colours on that heading; a `Model` column first when more
  than one model is loaded. **Nothing is added to the main window**: a colour-by from the table
  shows in the existing colour legend, titled with the column's heading. **Phase 4 (the same
  day) adds, in the Schedules window only:** an Export button in its header (a tray-and-arrow
  glyph, the same 30 px `hv-step` button with a `data-tip`, beside Print) whose menu — the row
  menu's own markup and keyboard contract — offers `Excel (.xlsx)`, `CSV`, `All saved schedules
  (.xlsx)` and `Schedule file (.schedule.json)`; and in My templates, `Open schedule file…`
  beside Save and ifcTable's own `Export…` on each saved row. Files go through the OS's native
  Save and Open dialogs, attached to the Schedules window; success, cancel and failure are the
  window's existing toast. A focused column heading takes Enter / Space as its click, and its
  title says so. **Nothing is added to the main window.** **2026-09-28 (Ask SGVue):** a schedule
  the assistant makes or changes (`make_schedule`) shows here as the current, unsaved schedule on
  this window's own undo history, and the existing toast says `Schedule from Ask SGVue` or
  `Schedule changed by Ask SGVue` *(since 2026-10-01, when the assistant got its name:
  `Schedule from Ask Vee` / `Schedule changed by Ask Vee`)*; nothing else visible changes in
  either window. The same day,
  owner-approved: `export_schedule` runs one entry of the Export menu — its native Save dialog
  (the window is brought forward) and its toast — and `color_by_schedule_column` the heading
  menu's "Colour 3D by this column" — the existing legend and swatches. No new surface in either
  window. **2026-10-02 (Ask Vee, parity phase 4):** the assistant also sets what this window's
  Filter, Sorting and Format tabs and its calculated-value editor set (`make_schedule`: any-rule
  or every-rule filtering, itemise, a column hidden, aligned, given decimals and a unit, and put
  in its place, calculated columns), acts in the main window on the elements its rows list
  (`schedule: true`), and works its own controls (`manage_schedules`): undo and redo, a template
  from the gallery, and My templates — list, load, save, rename, duplicate — each the control's
  own handler, with its own toast and its own entry on this window's undo history. **Three
  things are only asked for here, and the user's click does them:** deleting a saved setup
  raises this window's own confirm dialog — the same card, the same text (`Delete the saved
  template “…”? This cannot be undone.`), the same two buttons — printing raises that card too
  (`Open the print dialog for this schedule?` · `Print…`; the print dialog, whose own default
  button prints, opens only on that click), and opening a schedule file the native Open dialog.
  So is a save or a duplicate that
  would take a saved setup away (a save over the setup the schedule was loaded from, or past the
  hundred that are kept), which the user's own Save does without a question: the same dialog
  card asks first — `Save over the saved template “…”? What it holds now is replaced, and cannot
  be brought back.`, or `… Only 100 are kept, so the oldest — “…” — would be forgotten, and
  cannot be brought back.` **The two differences:** a question raised for the assistant
  carries `Ask Vee` as the card's small label, where one the user's own click raised reads
  `Schedules` — so that a dialog nobody in this window clicked for says who is asking — and it
  **takes no default button**: the focus is on the card itself, not on Delete, Save, Duplicate
  or Print…, so a key press already under way answers nothing (Tab reaches Cancel first, Escape
  cancels; the user's own confirms keep the focus on their confirm button). No new
  element, no new control; nothing visible changes in the main window.
- **2026-09-25 — on Windows the app draws on NVIDIA when there is one; Preferences can turn it
  off, and the About box names the adapter.** Asked for by the owner in these words: *"auto set
  the highest graphic card if available? Nvidia as first choice."* Preferences (the allowed
  dialog) gains one checkbox, **Windows only**, `Prefer NVIDIA graphics when available`, on by
  default; the Windows / Linux About box gains one last line, `Graphics: <adapter>` — OS chrome,
  like the story above it. The macOS panel and every designed surface are unchanged.
- **2026-09-28 — a spot tag shows its level only until clicked, and the snap takes the surface
  being looked at.** Asked for by the owner in these words: *"I need the spot coordinate to show
  level only most of the time and prioritize on the surface camera is watching on."* — and, of
  the options offered: the level only (`▽ +10.500`), a click on the tag for the full E / N / Z
  and a second click to shrink it, the Markups list unchanged. **The tag** is the design's label
  (L413), collapsed for every new spot to one line: a drawn `▽` — an 8 × 7 px outline in the
  E / N / Z letters' `--faint`, because the self-hosted IBM Plex Mono maps no triangle and a typed
  one would come from a fallback font — then the level in `--ink`, `+` or U+2212 and `f3`'s
  digits: the map Z the grid's Z row prints, or with no base point the file's own z in metres.
  Expanded it is the design's grid, byte for byte, at the design's offset (70, −34); collapsed
  it stands at (33, −7), so its bottom-left corner sits on the dot as the grid's does. It takes
  the click with the grid bubble's own `pointer-events:auto` / `cursor:pointer` /
  `user-select:none` and a `title` (`Show E, N and Z` / `Show level only`); the overlay is above
  the canvas, so that click never orbits, picks, measures or places a spot — and, as over a
  bubble, a click or wheel on the tag's own box does not reach the canvas. Per spot, for the
  session only (spots are in no session or link). Not keyboard-reachable, like the bubbles; the
  Markups list is, and carries the full coordinates. The Markups list, the status bar's
  `N spots` and `on.spot` are unchanged. **The snap** (spot and laser alike): a corner or edge
  point hidden behind the face under the cursor, or on the cut-away side of the section, is
  never taken; one on that face's plane beats one off it; an edge whose own foot is hidden gives
  its nearest-to-camera visible point inside the radius. The radii, the precedence within each
  class, the axis and perpendicular locks, `S` and the marker are the design's. **Measured** on
  the phase-6 parity chain, per theme, before → after: the label readback is identical for the
  first ten states; from `spot-C1` on, the tag reads `+110.900` (85 × 28) in place of the
  153 × 82 grid, **and the spot moved** — both it and `markups-card`'s second measurement are
  clicked on a window sill's top face, where the design took the wall's bottom-back corner
  900 mm below and behind it: `Z 110.000` → `110.900`, `M2 Y 9 025 · Z 2 700` → `8 865 · 1 800`.
- **2026-09-28 — a section outlines everything it cuts, in the accent, about 2.5 px wide.**
  Asked for by the owner in these words: *"Also highlight and thicken the line of all geometry
  that are cut in cut section."* — and, of the options offered: *"Accent colour, thick — SGVue's
  teal accent, about 2.5 px, so the cut stands out clearly from the rest of the model in both
  themes."* (not a solid poché fill, not drawing-style black / white). While a section **cuts**,
  where the plane meets every element whose edges are drawn — visible, not inert, not ghosted,
  not fading, not an `IfcSpace`; glass included — is drawn as a screen-constant 2.5 px line in the
  theme's accent (`--accent`, the selection outline's and the plane outline's colour), depth-tested
  so the model hides it from the kept side. A preview (`cut` off) and a cleared section draw none.
  **No new element, no new control, no toggle**; the design's clip, cap colour, plane outline,
  preview sheet and re-aim are unchanged, and the assistant's `set_section` gets it for free.
  **Measured** (the phase-6 chain on the mock, 1440 × 860, each theme its own run): the outline
  is 37 653 / 37 648 px in `section-grid-C` (3.0 % of the frame), 1 129 / 1 129 in
  `section-grid-C-flip-offset1500` (seen through the glazing: the camera is on the kept side) and
  32 294 / 32 277 in `section-level-L2`, dark / light; with it hidden each of those frames is
  HEAD's — byte-identical in `section-grid-C`, within HEAD's own run-to-run label noise in the
  other two. The preview, `bubble-click-opens-section` and the four states before them draw none.
- **2026-10-01 — undo, redo and the markup counts are an action bar above the status bar, and
  the stage's bottom edge is one row.** Asked for by the owner in these words: *"The footer in
  3D viewport that hold unit, coordinate system and frame per second. When i hide or measure
  something, the undo, clear measurement button are all added up. When i hided something, there
  is a UI for reset in the middle of the view also. So they are overlapped. Can you move the
  clear button and undo button somewhere?"* The design appends `undo`, `redo`, `N measures` +
  `clear` and `N spots` + `clear` to the status bar (`SGVue.dc.html:711–714`), which then runs
  under the centred reset pill. Those buttons — same copy, same `data-tip`s, same style strings,
  same handlers — are a bar of their own (`data-role="actionbar"`): the status bar's card, 3 px
  above it, its groups separated by the status bar's own `·` with none in front of the first,
  drawn only while one of the buttons exists. **The status bar keeps its five fields and its
  markup.** The stage declares the bar's lane as `--abar` (`30px`, else `0px`), like `--rlane`;
  the colour legend's `bottom` and `max-height` and the Markups and Spatial-structure cards'
  `max-height` take it, so with the bar absent every computed length is the design's.
  **Measured** (mock, 1280 × 820; a storey hidden, 3 measures, 2 spots, colour by Level, Markups
  open): status bar `[312, 781, 287, 27]` (before: 576 wide, under the whole reset pill), action
  bar `[312, 751, 284, 27]`, pill `[699, 771, 183, 36]`, legend `[312, 544, 230, 204]`, Markups
  `[312, 66, 330, 275]` — no two intersect.
  **The bottom row** — the same complaint, taken as the class it names (*"So they are
  overlapped"*). The design places five pieces along the bottom edge without any of them
  knowing the others: the status bar (`:705`), those buttons, the hint bar (`:702`) and the
  reset pill (`:306`) — both `bottom:14px; left:50%` — and the Ask pill (`:536`). They are now
  the three zones of one grid row (`app/BottomRow.tsx`, `1fr minmax(0,auto) 1fr`, 12 px inside
  the stage), and a grid's tracks cannot overlap: the action bar above the status bar · the
  hint, the reset pill 6 px above its start when both show · the Ask pill. **Each piece keeps
  its markup, copy, class, handlers and style string, less `position:absolute`, its offsets and
  the centring transform**, plus `pointer-events:auto` — the row takes none, so the canvas keeps
  its clicks between the zones. The visibility frame's border is where it was. **Changed:** a
  hint is `white-space:normal; text-align:center; text-wrap:balance; max-width:100%` — one line
  while there is room, pushed right of the bars rather than under them, wrapped (never narrower
  than 200 px) when there is not; where the bars leave the centre less than it needs — a 760 px
  window — the centre stands above them, on a row of its own; and `reset` and `Ask` are the last
  two stops of the stage's tab order, after the action bar (`reset` came before the property
  card, `Ask` after the chat panel). **Measured** (mock, dark and light alike): at rest the
  status bar `[312, 781, 287, 27]` and the Ask pill `[1201, 774, 67, 32]` are where they were,
  0 px differing, at 1280 × 820 and at the real default 1264 × 755; the reset pill alone is
  where the design centres it, `[699, 771, 183, 36]` — only the curved ends of its outline and
  its button's differ (571 / 452 px, by ≤ 37 / 93 of 255), drawn at a layout position now and
  not through `translateX(-50%)`. With the laser tool's 522 px hint, a storey hidden and a full
  action bar — bar `[312, 751, 284, 27]`, hint `[609, 773, 522, 33]`, pill `[609, 732, 183, 36]`
  — **no two of the five intersect**, at either of those sizes, at 900 × 700 (the hint on three
  lines) or at 760 × 700 (the centre above the bars); placed separately, three pairs met at the
  first two and six at the others. **Not solved:** the chat panel, the property card and the
  colour legend are not zones of the row. With an element selected, the chat panel open, a tool
  hint and something hidden — all four at once — the chat panel covers the reset pill above the
  hint at the default window; in a window of 900 px or less the open chat panel covers the pill
  and the top of a wrapped hint; and where the centre stands above the bars it is where a colour
  legend is. `tests/parity/2026-10-01-ui/README.md` has every rectangle. *(Later the same day:
  the first two are closed — the row declares its height as a lane, `--brow`, which the chat
  panel and the property card clear; and the Ask pill reads `Ask Vee`, 88.9 px wide, so the
  rectangles of that pill here are the "before". Both are the Vee entry's, below.)*
- **2026-10-01 — the toolbar is five groups with a divider between each two, and Schedules
  stands alone, last.** Asked for by the owner in these words: *"Can you add organize, group and
  add divider for the toggles bar on the top of 3D view? Please separate the schedules toggle.
  Make it distinct from others."* In order: Select · Laser meter · Spot coordinate · Snap |
  Section · Filter · Coordinate system | Gridlines · Levels · Canvas grid · Shadows · Light /
  dark | Saved viewpoints · 3D Plan N S E W · persp / ortho | Schedules. Every button keeps its
  markup, class, tip, handler and on / off colours. The dividers are `aria-hidden` 1 × 18 px
  spans in `--border-strong`, and `column-gap` is 4 px (was 10). The design had none because
  they strand on wrapped rows (`BUILD_PLAN.md` §5): one whose two neighbours are on different
  rows is `visibility:hidden`, re-evaluated whenever the toolbar's box changes. Schedules is the
  same 30 × 30 `hv-step` button in `--accent-ink` with a 1 px `--accent` outline — never the
  filled "on" look, because it opens a window and is not a toggle. **Measured** (mock,
  1280 × 820): 741.03 → **737.03 px**, one row; the Schedules button has no cube pixel under it
  in 3D or in Plan (nearest 7.4 / 8.8 px; the theme button, last before: 6.5 / 7.1), and at the
  real default window (1 264 px inside) nearest 4.3 / 2.5 px (before 3.9 / 1.1). At 900 × 700 it
  is two rows with one divider hidden. Schedules is now the button under the cube canvas's empty
  corner (2026-09-24's canvas-grid entry): a mouse reaches it, a touch does not — Window ›
  Schedules does.
- **2026-10-01 — the property card's clipped texts carry their whole text on hover.** Asked for
  by the owner in these words: *"Sometimes on the properties panel, the information on
  Predefinetype, objectype are too long and got cut off, can you do a hover and show full?"* A
  native `title` on every text the card clips with an ellipsis: the four identity tiles' values,
  each property set's header (the set's own name, `Pset_WallCommon`, not the prettified one
  shown) and each property's name. None for a blank value or the em dash. Native rather than
  `data-tip`, which the card's `overflow:auto` body would clip. **No style string changed**:
  the card differs from the capture before by 0 px (dark) and 3 px (light), which is what two
  captures of one build differ by.
- **2026-10-01 — the element tree is eye-first, like STOREYS and MODELS.** Asked for by the
  owner in these words: *"Can you swap the collapse expand icon and visibility eye icon on the
  element by entity? so it all consistent with the storeys."* A group row is
  `[eye][label][count][chevron]` (the design: `[chevron][label][count][eye]`, `:179`) and an
  element row `[eye][name / meta]` (the design: `[name / meta][eye]`, `:191`), its 2 px and 8 px
  of side padding mirrored with it. Every piece keeps its markup, class and handler; the tree's
  roles, roving tabindex, keyboard and row windowing are unchanged. **Measured:** the group eye
  is on the storey eye's own x, 16 px (it was at 251); an element's is at 31 (was 253); both
  rows keep their size.
- **2026-10-01 — a model's file path is its hover title.** Asked for by the owner in these
  words: *"The model library, can you show file path on the hover for each model?"* A native
  `title` with the file's full path on each row of the sidebar's `library` popover, on each
  Recent pill of the landing page, and on a loaded model's name block in MODELS (the row's
  buttons keep their own). The paths are the ones the renderer already holds — no new IPC. A
  model with no file behind it, the demo building, has no `title` at all. Nothing drawn changes.
- **2026-10-01 — the landing page says when a newer version is out, with a link — and the app
  asks GitHub for that once at every start.** Asked for by the owner in these words: *"Can you
  show updates with link if there are one automatically on the upload page?"* Asked how —
  *"Showing an update notice automatically means SGVue must contact the internet once each time
  it starts (it asks GitHub for the newest version number; nothing about you or your models is
  sent). Until now the app made no such call. How should it work?"* — the owner chose **"Check
  at every start"**: *"One small request to GitHub when the app opens. If a newer version
  exists, the home page shows 'Update available' with a link to the download page. Offline or
  blocked: it stays silent."* — and not the variant with a Preferences switch, so there is none.
  **Shown**, only when a newer version exists: one notice in the landing page's 620 px column,
  between the introduction and the drop zone, above the warning banner when both show — the
  designed warning banner's box in the accent tokens (`--sel-bg`, a 1 px `--accent` border,
  `--sel-ink`), `data-role="update-notice"`. Its copy is `SGVue <latest> is available — you
  have <this version>.`; its one control is a text button in the page's own style,
  `get the update →`, which opens the page Help › Check for updates… opens. No icon, no
  dismiss. **Sent:** one `GET` to one hard-coded https URL — GitHub's "latest release" of the
  public releases repository — with an `Accept` header and nothing else of ours: no query
  string, no body, no cookie; nothing about the user, the machine's files or the models. It is
  a web request, so GitHub sees what any server sees, the IP address and Chromium's standard
  headers — whose user agent, in a packaged build, names the app and its version. **When:**
  once per start and at most once per run, in a **packaged** build only; a
  development build makes no request at all. **Failure is silent:** offline, a proxy, any
  status but 200, a rate limit, 5 s without an answer, an answer over 256 kB or not JSON, a tag
  that is not a version, or a version that is not newer — nothing is drawn and the page is what
  it was. There is still **no auto-updater and no download**; `publish: null` stays.
  **Measured** (`tests/parity/2026-10-01-update-notice/README.md`; `#mock&landing`,
  1280 × 820, both themes): with nothing newer the landing capture is byte-identical to the
  build before and its DOM is the same 7 922 bytes; with the notice (620 × 44.75 px) the
  centred column is 66.75 px taller, so what is above it stands 33.4 px higher and what is
  below 33.4 px lower — as the designed banner does — and at the real default window
  (1 264 × 755 inside) with two rows of Recent pills the page is 34 px taller than the window
  and scrolls.
- **2026-10-01 — the Section card cuts along a gridline and at a level at the same time, each
  with its own offset, cut, flip side and Clear, and has a Clear all.** Asked for by the owner
  in these words: *"Can you add the section cut along gridline as another cut also? same, i
  need offset, cut / flip, clear. and since we have multi plane section cut now, add a clear all
  somewhere. Can you also add divider on the gridlines under section panel for along x or y
  side, for example gridline 1 to 10 one section, Gridline A to E one section."* Asked *"Section
  cuts: how many should be possible at the same time?"*, the owner chose **"Two: gridline +
  level"**: *"The gridline cut and the level cut become independent. Each has its own offset,
  cut, flip side and Clear, plus one Clear all. The gridline chips are split by a divider into
  their two directions (A-E / 1-10)."* The design has one plane: its card
  (`SGVue.dc.html:582–603`) lists both chip rows, then one offset row and one summary row for
  whichever was picked last. **The card now** is two blocks built from the design's own pieces
  and style strings. "Along a gridline": its chips, one wrapping row per grid family (the file's
  own, `GridAxisRecord.family` — `A…E`, then `1…10`), then the design's offset row (`−500` ·
  field · `+500`), the plane's summary (`offset mm · grid C · cut · flipped`) and its three
  buttons (`cut` · `flip side` · `Clear`). "At a level": the level chips, then the same again.
  **The summary line is the one place the single card's two rows were re-arranged.** The design
  puts the summary and the three buttons on one line, where the buttons leave the summary about
  75 px of the 300 px card: it read `offset mm …`, the plane's name clipped away — and with two
  planes that line is the only place a plane's name, `cut` and `flipped` are read at all. So
  the summary has a line of its own — its own style string, so it still ellipsises if it ever
  overflows, and a native `title` with its whole text — and the three buttons follow in a row
  of their own, right-aligned, in their own style strings and order. **Added, and nothing
  else:** `Clear all` in the header, left of the × and 6 px from it (the two share one flex
  group), in the `Clear` button's own style string; a 1 px `var(--border)` rule between two
  families' chip rows (`aria-hidden`; none when the grids are one family); the second copy of
  the controls; and, because the card is taller,
  `max-height:calc(100% - 110px - var(--abar, 0px));overflow:auto` — the Markups card's. Each
  block is a `role="group"` named by its label, and its rows stand 6 px apart, the design's own
  gap inside a block, where the single pair of rows stood 12 px under the chips. A block's
  controls stay when no plane is chosen in it, as the design's do with no section, and its
  summary then reads `offset mm · no section`. **Behaviour:** a chip acts on its own plane by the design's rule — the live chip
  clears it, another sets that name with offset `0` (gridline) or `1200` (level) and `cut` on,
  keeping `flip`; a block's `Clear` puts that one plane back to nothing (offset `0`, not
  flipped, `cut` off); `Clear all` does it to both. A grid bubble's click previews, or clears,
  the gridline plane only. The toolbar's Section button is lit while the card is open or either
  plane is set. A saved viewpoint's sub-line, the assistant's result and its view state name
  what is on: `grid C`, `level L2` or `grid C + level L2`. **In the 3D view** what is kept is
  what both planes keep. Each plane has its own accent outline and, with its `cut` off, its own
  preview sheet; 2026-09-28's cut outline is drawn for both, each trimmed to the other's kept
  side; a pick, the laser and the snap see only what is left. The camera re-aims at a plane
  when that plane starts cutting, or its gridline, level or side changes while it cuts — never
  for an offset, a clear or a change of the other plane; a restore that brings both re-aims
  once, at the gridline plane. **Unchanged:** every piece's own style string, copy and `title`
  — the chips, the offset row, the summary, each button — the chips' colours, the clip, the cap
  colour, the plane outline, the preview sheet and the 2.5 px outline; with one plane set the
  3D view draws what it drew before. A session, share
  link or viewpoint written before restores its one section; a new one also writes the old
  single key (the plane that is cutting, when only one of the two is; else the gridline cut if
  set, else the level cut), which is all an older build reads.
  **Measured** (the phase-6 chain on the mock, each theme its own run, this build captured
  three times): **every one of its 84 canvas-only frames — 14 states × 2 themes × 3 runs,
  1140 × 860, everything but the 3D canvas hidden — is identical, pixel for pixel, to a capture
  of the build before.** That build's own captures agree with each other in every state but
  `levels-iso`, where one pixel reads one level either way in both themes.
  In the whole-window captures the label readback is identical in all 28 state / themes, and
  the card is `[312, 66, 300, 330]` → `[312, 66, 300, 444]`, its longest summary — `offset mm ·
  grid C · cut · flipped` — read whole. With both planes cutting — grid C
  flipped + level L2, 3D, dark / light — the outline is 10 469 / 9 771 px (378 segments on 63
  elements); grid C alone 12 231 / 11 837 (220 on 47), level L2 alone 16 584 / 15 001 (568 on
  74). `tests/parity/2026-10-01-two-sections/README.md` has every table.
- **2026-10-01 — the assistant is Vee, and its mascot is a 16 × 16 pixel sprite.** Asked for by
  the owner in these words: *"Can you help me update the ai assistant name and animations?"* —
  with a design handoff, **"Ask Vee"**, kept exactly as it arrived in
  `design-reference/ask-vee/`. **That handoff is the specification for the assistant's name,
  its mascot and its thinking-process motion**, as `SGVue.dc.html` is for everything else: its
  `README.md` is the spec, `ask-thinking-hex.jsx` the reference code, and the mascot is its
  option 1a, "Hex" — a hexagon creature from the SGVue mark, five states (`idle`, `thinking`,
  `reading`, `found`, `done`) at 8 frames a second. **Scale:** the handoff calls its sizes "app
  px (screenshot ÷ 1.2)"; the screenshot was taken at 150 % display scaling, so — measured
  against the real panel (330 × 420, bubble text 12.5 px, send button 32 px) —
  **`ask-thinking-hex.jsx` px ÷ 1.5 = app px** (its README's px ÷ 1.25). The panel it shows is
  today's panel traced from that screenshot, so **every existing element keeps its style
  string** and only what is new is sized from it. **Built in this step: the name, and the
  mascot at rest;** the thinking trace, its motion, the stop control and the left-aligned "You"
  bubble were the next step — the entry below. **Changed copy:** the panel's
  title `Ask Vee` (the design's: `Ask SGVue`) and the pill's label `Ask Vee` (`Ask`); a reply's
  label, the quote of one and the reply strip `Vee` (`SGVue`); the Schedules window's two
  toasts; and one added instruction line tells the model its name, so it says so when asked.
  **SGVue is still the app:** About, the window title, the sidebar's brand, the empty panel's
  "SGVue never writes to your model" and the pill's `data-tip` are unchanged. **The mascot**
  stands where the design's sparkle did — beside the title and on the pill — and in front of
  each reply's label, never the user's; `idle` at rest in all three (a reply's takes its state
  from its turn — the entry below). It is a `<canvas>`, `aria-hidden`, drawn at a whole number
  of device pixels to a cell — **one number for every sprite, `max(1, round(devicePixelRatio))`**,
  so the three are the same size beside each other at any display scaling (until the trace step
  each slot rounded on its own, `max(1, round(slot × devicePixelRatio / 16))`, which at 125 %
  drew the header's at 25.6 px beside two of 12.8) — and centred in a layout slot of 21, 19 and
  16 px — the reference's 32, 28 and 24 ÷ 1.5 — whose negative margins give it the sparkle's
  own room. An idle sprite blinks on 2 of every 28 frames, each at its own offset, so no two of
  the header's, the pill's and the first seven replies' blink together; the one 8 fps clock
  counts only while a sprite is mounted and the window is visible, **sleeps between the frames
  at which a mounted sprite's drawing changes** (three idle sprites wake it 12 times in 7 s, not
  56), never causes a React render, and does not run under `prefers-reduced-motion: reduce`,
  where each sprite holds an open-eyed frame.
  **Colours:** dark is the handoff's palette — five roles through the app's tokens (`--accent`,
  `--step-bg`, `--border-strong`, `--ink`, `--ground`) and two new constants, the highlight
  `#8AF0E4` and the top facet `#2B3B3A`. The owner designed dark only; light keeps the roles on
  the light tokens and adds three values — the visor `--ink`, the top facet `#CBD8D5`, the
  highlight `#35C4B6`. **Measured** (mock, 1280 × 820, both themes alike): the header is
  `[939, 349, 328, 47]` and its title `[974, 366.5, 249, 11]` before and after — the same box,
  the same baseline; a reply's label row is 10 px tall before and after; the pill is
  `[1179.09, 774, 88.91, 32]`, was `[1201.42, 774, 66.58, 32]` — 22.3 px wider, which is its
  label's own width, at the same offsets, height and colours. Outside the two sprites, the
  title's text and the name, the open panel is pixel-identical to the build before (0 px in the
  bubble, the composer and the close button), and so are the status bar, the sidebar and the
  toolbar. At real device pixel ratios of 1, 1.25, 1.5, 1.75, 2, 2.5 and 3 every sprite's
  captured pixels equal its backing store, 0 differing — measured again under the one-size rule:
  16, 16, 32, 32, 32, 48 and 48 device px, the same for all three.
  **The bottom row, now that the pill is wider — and its lane.** The row's rule is unchanged;
  no two of its five pieces intersect at 1280 × 820, 1264 × 755, 900 × 700 or 760 × 700 — at
  rest, with the reset pill alone, or with the laser's hint, a full action bar and the pill —
  and the status bar is where it was in all of them. **One placement changed:** at 900 px the
  bars now leave the centre 180 px, less than the reset pill is wide (183) and than a hint's
  200 px floor, so there the centre stands above the bars; with the 67 px pill it stood between
  them and the laser's hint wrapped to three lines. **The gap the row's own entry records as
  not solved is closed for the chat panel and the property card.** The stage declares `--brow`
  beside `--rlane` and `--abar`: `0px` while the centre zone's top is within the 52 px the
  design leaves under the chat panel — a hint alone, the reset pill alone — and otherwise what
  it takes to keep the design's 6 px above it, in whole pixels. The panel's `bottom`,
  `max-height` and resize clamp and the card's `max-height` subtract it; **with `0px` every
  computed style is the design's** (`52px`, `calc(100% - 130px)`, `calc(100% - 240px)`, read
  before and after). **Measured:** with an element selected, the panel open, the laser's hint
  and a storey hidden — the four at once — `--brow` is `43px`, the panel `[606, 305, 330, 420]`
  (was `[606, 348, 330, 420]`, over the whole of the reset pill) and the card
  `[948, 184, 320, 537]` (was 580 tall) at 1280 × 820, the panel 6.7 px above the pill; none of
  the five pieces meets the panel or the card at any of the four sizes, where one to five pairs
  did. **Still not solved:** the colour legend does not take the lane; and with the row one
  line, the panel in the card's lane still lies 6 px across the end of a full action bar at the
  default window, as it did. `tests/parity/2026-10-01-vee/README.md` has every table.
- **2026-10-01 — Vee's reply is drawn while its turn runs — a thinking trace — the send button
  stops the turn, and `You` stands on the left.** The second step of the owner's "Ask Vee"
  handoff (the entry above: `design-reference/ask-vee/` is the specification, its px ÷ 1.5 are
  app px). The handoff is a 16 s scripted video on invented numbers; **the app plays the same
  choreography from the turn's real events and the federation's real data.** **What it
  replaces:** the design's busy row (`SGVue.dc.html:499–531` — a brand mark tracing itself, a
  stage line, three dots) is not in the port. While a turn runs, the transcript's next row *is*
  the assistant's reply being written — at the index its message will get, and the same element
  when it commits, so nothing jumps. **What it shows, and from which event.** *Send*
  (`chatBegin`): the typed line rises out of the composer to its bubble in 0.7 s at one x, the
  bubble comes in at 0.94 → 1, `You` fades in, the placeholder returns, the send button presses.
  *Think* (Send + 1 s): the reply's label rises 4 px and fades in, Vee pops in, and `Thinking`
  shimmers beside the name until the answer. *Read* (the turn's first `tool_start`, never before
  Think + 0.4 s): a bubble opens to 52 px with a one-line ticker — `Reading 4 models`, the
  element count counting up — over the element matrix, four rows grouped by model, arriving as
  a wave. Then, for each executed tool whose input carries live rules: *Filter* —
  `Filtering IfcWall`, the count falling to the scope's, its cells regrouping larger in two rows
  while the rest shrink away — from the rules on `Model`, `IfcEntity`, `PredefinedType`,
  `ObjectType` and `Level`; and *Check* — `Checking Thermal Transmittance`, a beam crossing the
  grid in 1.7 s, each flagged cell lighting under a ring as it passes and the count rising with
  it to the matched size, `missing` when every such rule asks for an empty value and `found`
  otherwise — from every other rule. Any other tool is a note: its `TOOL_STAGE` phrase, no
  count. A step starts when its data exists and the one before it has had its designed time
  (1.8 / 1.6 / 2.4 / 0.6 s); calls that pile up behind a step are not replayed — the ticker goes
  to the latest. *Answer* (`done`): the ticker fades, the unflagged cells fold away, the bubble
  glides to the answer's height, the words come in one after another (`**bold**` and `` `code` ``
  as elements, never HTML), the status rolls to `checked 80 walls · 8s` (a Check ran),
  `found 12 doors · 3s` (only a Filter) or `4s`, and the flagged cells fly into one row per
  storey that holds a match — at most eight, the eighth `+N more levels` — each a button that
  selects what it counts. Vee is `thinking`, `reading`, `found` for half a second at each
  finding, and `done` while that reply is the newest message. A turn with no tool opens no
  trace: its reply hugs its text as before, and says how long it took. **Not negotiable, and
  each tested:** the answer is never delayed by animation — at `done` whatever is queued or in
  flight is at its end and the answer begins; every number is the federation's own — a cell may
  stand for several elements, a count never rounds; nothing animates for ever — one frame loop
  from Send until at most 1.95 s after the answer, and none between turns; a failed or stopped
  turn leaves the transcript as `chatFail` always has; chips, the table, the pending patch,
  `reply` and `revert` are untouched under the bubble; and the trace is narration — if it ever
  fails, the tool still answers and the reply still arrives, plain. **Two changes of behaviour,
  both the handoff's.** *A stop control:* the design has none (`:1592`) and the port
  deliberately had none; while a turn runs the send button's arrow cross-fades to an 8 px square
  and a click stops the turn (`abortChat`; `data-tip` and `aria-label` read `Stop`) — a
  double-click stops it once and sends nothing: the button ignores clicks for 300 ms after a
  stop. Enter during a turn still does nothing, nothing is `disabled`, and closing the panel
  still stops nothing. *`You` on the left*, with the assistant's corner (the design: on the right, `:2015`)
  — what makes the lift a straight line; its colour and its 86 % are unchanged. **Reduced
  motion:** every state still shows, at its end, the moment its cue is reached — the status,
  the latest step with its final count, the matrix settled, the rows — with no lift, shimmer,
  roll, wave, beam, fly-in, count-up or word-by-word reveal, and each sprite holds frame 0 of
  its state; the view wakes at each cue instead of every frame. **Both themes:** dark is the
  handoff's — the cell `--border-strong`, the flagged cell `--accent`, and three greys that have
  no token (`#7E9693`, `#405351`, `#2D3B3A`); light keeps each grey where the dark one stands
  between the same neighbours (`#748382`, `#B3C3C0`, `#CFDCD9`). **Whole device pixels:** every
  pitch and size of the matrix is the handoff's ÷ 1.5 rounded to whole device pixels for the
  display — at 150 % the handoff's own numbers (4 / 3, 10 / 7, 14 / 10), at 100 % 3 / 2, 7 / 5
  and 9 / 7. **Bucketing:** one cell per element while the grid has room, else each stands for
  `ceil(count / capacity)`; so at 100 % the demo building's 412 are two to a cell (206 cells in
  53 columns, 167 of the bubble's 282 px — a 2 px cell needs a 3 px column), and one each from
  125 % up. **Not shipped** (the handoff says they are the video's): its camera moves, its
  background dimming and the Minimal / Wide variants; and the composer keeps the app's own focus
  ring. **Fixed with it, at its cause:** the log scrolled sideways as soon as it scrolled at all
  (`scrollWidth` 348 against 320). No child was wider than the log — the design's tooltip is
  laid out while it is invisible, and the one under the right-aligned `reply` reached past the
  log's edge. A tooltip inside the log is now generated only while it shows (it still fades
  in) and the log's overflow is vertical only: `scrollWidth` = `clientWidth`, 328 and then 320.
  **Measured** (mock, 1280 × 820, ratio 1, both themes alike): the panel `[938, 348, 330, 420]`,
  unmoved; a user's bubble `[951, 499.75, 261.44, 54.75]`, its text at x 962 — the composer's
  text x, where the lifting line stays for the whole 220 px; the live reply's label row
  `[951, 563.5, 87.58, 10]`, 10 px as every label row is, and 192.42 px wide once it reads
  `checked 80 walls · 8s`; the trace bubble `[951, 577.5, 304, 52]`; the read grid 206 cells of
  2 px, the filter grid 80 of 5 px in 2 × 40 across 278 px; the answered bubble
  `[951, 490.5, 296, 148.05]` with five rows of 17.33 px, their cells 7 px at a 9 px pitch
  33 px from the text's edge; the stop square `[1235, 735, 8, 8]`. The sprite clock wakes 4
  times in 7 s for the pill alone, 12 for three idle sprites, 8 a second while one thinks or
  reads, 26 in 7 s with one `done`. While a turn ran for 6.8 s the trace drew about 410
  frames (one per display frame) and the 3D scene none; in the 2 s after the answer had settled,
  neither drew one.
  `tests/parity/2026-10-01-vee/README.md` § 5 puts each capture beside the handoff's still and
  lists every difference.
- **2026-10-02 — a reply's `revert` puts back everything that reply changed, not only what is
  visible.** Owner-approved. Asked on 2026-10-01 whether the chat's revert should restore
  everything the assistant changed in that reply rather than visibility only, the owner:
  *"correct."* The design's `revert` (`SGVue.dc.html:1613`, `:1622`) restores the five
  visibility keys, which was all its assistant could change. Ours also cuts sections, moves the
  camera, switches the display, colours models, selects and changes the app's own settings — and
  `revert` appeared on those replies and put nothing back. **The control is unchanged:** the
  same button, the same `Undo just this step` tip, the same place, the reverted reply dimmed as
  before; no new element and no new control. **What it does now:** it puts back each part of the
  review state that *that reply's own tool calls* changed — what is visible (the design's five
  keys, together as they always were, and still on the undo stack), the two section planes, the
  camera with its projection and the lit view button, each display switch and the canvas grid,
  the model colours with Original materials, a highlight step's colour, the colour-by scheme,
  the selection, the theme, the units, the tree's grouping and its search, the sidebar, the open
  card and the armed tool — **and nothing else**: a part that reply left alone, or that the user
  changed by hand while it was being written, stays exactly as it stands. (The tooltip, taken
  literally: a reply that hid the walls does not fly the camera back.) **It is offered exactly
  on a reply that changed something it can put back** — not on one that only read, that changed
  something and changed it back, or that only saved or renamed a viewpoint; a turn that only
  switched the theme or moved the camera used to be offered a `revert` that did nothing, or none
  at all. **Never put back:** the base point and the loaded models, the saved viewpoints and
  filter sets (the user's own lists), and anything in the Schedules window. *(Amended the same
  day, phase 3 — the entry below: the base point **is** put back. A reply can now ask to change
  it, and a change the user applied joins that reply's `revert` — until 2026-10-08, when the
  card became read-only and there was no base point left for anyone to change. Phase 4 and its follow-up:
  **a spot or a measurement a reply placed is taken away by that reply's `revert`** — session
  view state, not a saved list: exactly those, by id, through the Markups card's own ×, and a
  reply that only placed one is offered `revert`; a spot tag's state is not put back. A turn
  that is stopped, or fails, after it placed one leaves that markup in place with no reply to
  revert it — as every other change a stopped turn made stays — and the user removes it with
  the Markups card's ×.)* **When
  the federation
  changed in between,** a session restore's rules apply: element ids are renumbered onto the
  slots their models have now; a model that is no longer loaded takes its ids, its eye, its
  colour and activate mode with it; a camera recorded where the model stood somewhere else is
  left where it is — and what could not be put back is said in the panel's own status line, the
  one a failed turn uses (`STR is no longer loaded, so nothing of it could be put back.
  Everything else was reverted.`). A change the scope guard held and the user then applied joins
  that reply's `revert`, where it used to replace it. Nothing else on the panel changes.
- **2026-10-02 — the chat's pending row also confirms what reaches outside the view or cannot
  be undone.** Owner-approved. Asked how the assistant should handle actions that reach outside
  the view or cannot be undone, the recommendation — *the assistant proposes, and you click
  Apply in the chat or pick in the Windows dialog* — was confirmed by the owner: *"correct."*
  The design's pending row (`SGVue.dc.html:1632`: a label, `apply`, `cancel`) held one thing, a
  visibility change the 5 % scope guard would not apply by itself. It now also holds a
  **request**: delete a saved viewpoint; delete one laser measurement or spot coordinate, or
  clear all of either; forget a saved filter set, or save one where that would forget another;
  open a file of the Recent list; copy the share
  link, or elements' GlobalIds; change the base point; and an undo, a redo or a viewpoint
  restore that the scope guard caught, which phases 1 and 2 could only refuse in words.
  **The row is unchanged** — the same element, the same two buttons, every style string the
  design's — and only its label differs, which says exactly what `apply` will do: `delete the
  viewpoint "Lobby" (3D) — it cannot be brought back`, `open the recent file "Tower A.ifc"`,
  `set the base point — Easting 28500 m (now —) — every coordinate read-out follows it`, `undo
  one change — leaves 5 of 412 visible`. **No new element and no new control.** Nothing a row
  asks for happens unless the user clicks `apply`; `cancel` drops it; it is taken once, and a
  later reply never brings it back; a reply holds one request, and **reverting a reply takes
  its row with it** — a held change as much as a request. A request the user's own work has
  overtaken — the viewpoint already gone, the history moved on, the base point retyped — does
  nothing and says so in the panel's status line, the one a failed turn uses. A name in a label
  is shown without control characters or direction marks. No label holds a file's path or the link's
  text: a recent file is named, as its pill names it. **Two requests use another surface the app
  already has, also unchanged:** unloading a model raises the sidebar's own inline `Unload X?`
  strip beside that model (opening a collapsed sidebar first), where `delete` is the user's; and
  opening files raises the native Open dialog — OS chrome. *(Phase 4: three more are asked for in
  the Schedules window, through surfaces that window already has — its entry of 2026-09-25,
  above: a question raised there for the assistant takes no default button, and printing is
  asked there first, the print dialog opening only on the user's click.)* **The two copy flashes are now
  truthful**: `link copied` (the Viewpoints card) and `Copied` (the property card) show only
  when the clipboard took the text. Measured, they used to show with the clipboard untouched —
  and, measured, it always was: this app grants a page no clipboard permission, so the designed
  controls copied nothing. They copy now (`renderer/clipboard.ts`) — same control, same copy,
  the same flash for the same time (1 600 ms and 1 400 ms); a copy the user applied from a
  reply that the clipboard still refused is said in the panel's status line. **The chat table's
  `copy csv` copies too** (phase 4, asked for by the owner): the design's line for it
  (`SGVue.dc.html:2029`) called the API this app always refuses, so the control copied nothing;
  it goes through the same helper from the user's click — no new element, no new control, the
  same copy and style string, and **no flash, as designed**; a copy that did not reach the
  clipboard is said in the panel's status line. The base point joins what a reply's `revert`
  puts back. *(Amended 2026-10-08: the base point is no longer among the requests — the card is
  read-only, `set_base_point` went with its `onChange`, and so did its label and its revert.)*
- **2026-10-08 — with the canvas grid off, the ground veil is not drawn.** Asked for by the
  owner in these words: *"When off the canvas grid, please dont show the semi-opacity plane
  filter."* The filter is 2026-09-24's ground veil, the layer that dims an opaque part below
  grade to 40 % of its contrast; it now goes on and off with the canvas grid. **Grid on, nothing
  changes.** Grid off, the opaque ground under the veil is the whole ground — its colour and the
  building's shadow, unchanged — so what is below grade is seen from above as it is: an opaque
  part at full contrast and, because the veil also carried the ground's depth, its edges,
  see-through parts, glass and annotations below grade as well. Our reading, which the owner may
  still correct: only the veil goes; the opaque layer stays and keeps the shadow. The same
  toolbar button, and the assistant's `toggle_display` `groundGrid` through it; **no new element
  and no new control.** **Measured** (mock, 1280 × 820, the 3D view, the canvas alone, both
  themes): grid on, every frame is byte-identical to the build before; grid off, the pixels
  that change are on below-grade parts and their edges — the footings, the slab's and the turf's
  rims, the `Foundation` level ring — plus 258 px of far IFC gridlines that no longer lose
  samples to the veil's depth. The building's shadow on the ground is the build before's, pixel
  for pixel; the numbers are in `docs/DECISIONS.md`.
- **2026-10-08 — the Coordinate-system card says, in one line, which model could not be lined
  up.** Offered to the owner as *"A short note in the Coordinate system card. Recorded as a
  change to the design."* and chosen in these words: *"One-line note on screen"*. Directly under
  the caption row, only while there is something to say: a loaded model whose file states no map
  position while another's does, or whose geometry landed more than 5 km from the offset another
  model set (the stream's `farPlacement`); when the boot model is the one with no map position it
  is the one named, and no distance is. The caption span's own style string plus
  `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, the whole text as its native
  `title`; a model is named by its sidebar row's file line, through `labelText`.
  `Tower B.ifc could not be lined up — it has no map position.` · `… — it sits 12.3 km from the
  others.` · `2 models could not be lined up: Tower B.ifc (no map position), STR.ifc (12.3 km
  away).` **One new element (`data-role="coords-note"`), no new control**; with nothing to say,
  every style string of the card is the design's. `get_model_info` / `get_view_state` report it
  (`notLinedUp`).
- **2026-10-08 — the Coordinate-system card is read-only.** Asked for by the owner in these
  words: *"Maybe just make the coordinates system toggle a read only, dont let user change
  anything."* The four fields keep their element, class and style string and are `readOnly`:
  they still take focus and a selection, so a value can be copied. Nothing in the app changes the
  base point: the store's `setCoord` and the fields' `onChange` are gone, and so are
  `request_user_action`'s `set_base_point` and the reply revert's `basePoint`; a session's, a
  link's or a viewpoint's stored `coords` is ignored on restore (still written, for older
  builds). The base point is the boot file's — P read off `bootGeoref`, the declaration that
  defined the frame, kept in the store with it — so it, the chips and the caption stay right after
  any unload. The status bar's chip no longer shows the design's `SVY21` for a typed base point.
- **2026-10-08 — a laser measurement reads each side of its point.** Asked for by the owner in
  these words: *"Also update the measurement to show left and right dimension from the spot,
  rather than overall."* Per axis, the distance along it from the point to the face on each
  side: in the 3D view one label at the middle of each half of the ray — the design's label
  markup, style and offsets — where the design has one for the whole ray; under the pointer
  `X 1 200 + 2 300 · … mm`; in the Markups card `X 1 200 + 2 300 mm` in its unit; in
  `manage_markups`, `sides` beside each axis's whole length, which is their sum. A side that
  reached no face has no reading, so an axis read one way is the design's 3D label and live
  reading, and a row with no two-sided axis the design's Markups row, byte for byte — but for
  the 3 mm the ray starts off the surface, which the design counted into a one-sided axis
  across a face: that number can now be a millimetre less (about one reading in 220 at a metre).
  Lines, dots, origin mark and copy unchanged; **no new control.** **One style string changed:**
  a two-sided row's value — one span per axis inside the design's span — wraps between two axes'
  readings (`white-space:normal`, each `nowrap`) instead of being cut: such rows measured up to
  311 px against the 220 px column. **Known limit, by choice — no declutter:** both halves of one
  axis share the design's screen offset, so a short two-sided axis seen from far off can
  overprint its own two labels (phase 6's `measure-M1`, 60 mm halves: 50 × 10 px). On the
  phase-6 chain `measure-M1` to `coords-card` differ for that reason
  (`tests/parity/phase6/README.md`); the numbers are in `docs/DECISIONS.md`.
- **2026-10-08 — Vee's replies are laid out in paragraphs, lists and tables.** Asked for by the
  owner in these words: *"the Ask VEE ai assistant answer are in one sentence, which is extremely
  difficult to read … Present answer in simple table or list if applicable."* The design's prompt
  line `Reply in one short sentence saying what you did and how many elements it affected. No
  preamble, no lists unless asked.` (`SGVue.dc.html:1257`) is replaced, in its place, by three
  formatting lines: an opening sentence, its key number or name in bold — after a change, still
  what was done and to how many elements — then a `- ` list, a table (a separator cell per column,
  ≤ 4 columns, ≤ 12 rows) or short paragraphs only where they help. Every message of Vee's renders paragraphs and their line
  breaks, `- ` / `* ` / `1. ` lists and pipe tables (`ai/blocks.ts`); anything else prints as
  written, never as HTML. A table is the chat result table's strings (`:466–477`), its numbers
  right-aligned in mono; it scrolls inside its own box and makes its bubble full width. A list
  marker and a table are each one piece of the word-by-word reveal; a reply is quoted as one plain
  line. A user's message is unchanged; **no new control.** **Measured:** with a one-sentence reply
  the chat panel is pixel-identical to the build before, both themes — the trace's eight states
  and a reply with no tool.
- **2026-10-09 — the app starts in the boot model's own unit, the unit toggle gains `ft`, and
  every length, elevation and coordinate the app prints follows it.** Asked for by the owner in
  these words: *"Why model units not automatically using the units provided by model? in other
  countries are feets"* — of the options offered, *"auto unit + feet"*: start in the first
  model's unit, add feet and inches beside mm and m, show coordinates in the file's map unit,
  *"Singapore mm models look exactly as now"* — and, mid-build, *"and also the laser measurement
  unit, and review any other similar situation."* **One button is added, nothing else:** `ft`
  after `mm` and `m` in the Markups card's toggle, the design's own markup and style string a
  third time; the status bar's unit field reads it. **Every boot** sets the unit from the boot
  model's `LENGTHUNIT` — shorter than a metre `mm`, a metre or longer `m`, a foot or an inch `ft`,
  none `mm` — and a later model never changes it; a session or a link writes it and restores it.
  **One rule** (`shared/units.ts`): in `mm` every readout is what it was, byte for byte; in `m`
  what printed millimetres prints metres to three decimals; in `ft` a length, a dimension or an
  elevation is feet and inches to the nearest 1/16" (`12'-6 1/2"`, `0'-3/4"`, U+2212 for a
  negative), a coordinate decimal feet, an area or a volume the app computes ft² / ft³. It
  reaches the laser's 3D labels and live reading, the Markups card, the grid and selection
  dimensions, the level tags, the sidebar's storey elevations, the spot tag, the property card's
  geometry rows, the Spatial-structure card's site rows, a clash table's volume and the Section
  card's offset field — which reads and takes metres (±0.5) in `m`, reads feet and inches and
  takes them or decimal feet (±2'-0") in `ft`, and still holds millimetres. **Not converted:** property and quantity values,
  which stay as authored — but a quantity total's label is now the file's own unit, `ft²` on a
  model in feet, where the design's literal read `m²`. **The Coordinate-system card** speaks the
  file's own **map** unit, not the toggle: `Easting m` as designed, `Easting ft` for the foot,
  `Easting US ft` for the US survey foot, each value as authored. The Schedules window keeps its
  own unit system, which already followed the first model's. **Measured** (mock, against HEAD,
  both themes): in every mm state the chrome is 0 px and every overlay label the same text in the
  same box, the 3D frame within two HEAD runs' own label antialiasing; the Markups card differs only
  inside its toggle — the new `ft` button 29.20 × 22 px, the title and the × not moved — and the
  chat panel not at all. `tests/parity/2026-10-09-units/README.md` has every number.
- **2026-10-09 — a file refused for its size is told to split the model.** Asked for by the
  owner in these words: *"add consider splitting into multiple models message for files over
  600mb."* The design's reason, `larger than 600 MB` (`SGVue.dc.html:1155`), keeps its words and
  gains ` — consider splitting it into several models`: one string, `TOO_LARGE`
  (`shared/upload.ts`), so the drop, the Open dialog, a Recent pill and a share link say the same,
  and an `.ifczip` whose one `.ifc` is that large ends the same way (`the .ifc file in the archive
  is …`), in its row and in the landing page's banner. **No element, no control and no style
  string was added or changed:** the stage line is the design's own, which wraps and never clips,
  so it needs no `title`. **Measured** (the default window, 1264 × 755 inside, both themes
  alike): on the landing page the stage is one line, 515 × 14.30 px, in a row 590 × 59.19; in the
  sidebar after boot it wraps to two, 231 × 27.28 px, so that row is one 13.65 px line taller; the
  `.ifczip` refusal is two lines in its row and two in the banner's 620 px box. Nothing in any of
  them overflows or is clipped.

The three 2026-09-20 entries above are recorded in full — the arithmetic, the measurements and
what each cost in parity — in `docs/DECISIONS.md`, and so are 2026-09-21's, 2026-09-24's,
2026-09-25's (all three), 2026-09-28's, 2026-10-01's, 2026-10-02's, 2026-10-08's and 2026-10-09's.

### No visible additions

Provenance (which entity a value came from, georeferencing source, SHA-256) is exposed only
through the assistant's tools and the exports — never as new UI. Inputs the design already has
(e.g. the Coordinate-system card, read-only since 2026-10-08) are pre-filled from the file when
the data exists and left blank when it does not. **Never a placeholder.**

The chat's pending row is such an input too. Since 2026-10-02 it also confirms a request that
is not a visibility change — a deletion, a copy, a recent file (and, until 2026-10-08, the base
point) — the allowed deviation of that date. The same row and the same two buttons: **no new
element.**

---

## Decisions

An index. **The full log — the alternatives, the reasoning and the measurements — is
`docs/DECISIONS.md`**, one dated row each, in this order.

**The stack.**

- **Desktop shell** — Electron 44, bundled Chromium. Node is installed, Rust is not.
- **Build tooling** — electron-vite 5 + Vite 7 + TypeScript 5.9; one config for main, preload and renderer.
- **UI** — React 19 + Zustand 5; the renderer module is plain TypeScript.
- **3D** — three 0.186.0 (`three/webgpu` + `three/tsl`), WebGL2 by default, merged geometry per slot.
- **IFC parser** — web-ifc 0.0.77 in a Web Worker behind a read-only adapter; IfcOpenShell is ground truth in tests.
- **File access** — `sgvue-file://` read-only protocol with single-use tokens; the parser reads a Blob in chunks.
- **Power query for AI** — sql.js 1.14 in its own worker, `PRAGMA query_only`, SELECT-only gate, 10 s cap.
- **AI** — `@anthropic-ai/sdk` 0.125 in main only, `claude-opus-5`, effort `medium`, key in `safeStorage`.
- **Persistence** — JSON in `userData`, written by main: settings, sessions, recents.
- **Share link** — `sgvue://s=<base64url>`, a scheme the app registers.
- **Packaging** — electron-builder 26: `.dmg` arm64 + x64 (ad-hoc signed), NSIS `.exe` x64 (unsigned), `.wasm` unpacked.
- **Reuse** — parser, georeferencing and property modules ported from Marumi, Aquila and ifcgref.

**The decisions that constrain day-to-day work.**

- 2026-09-17 — geometry is a **second** worker request, so the tree and the cards fill in before it lands.
- 2026-09-17 — **merged geometry per slot, never a `BatchedMesh`**: one driver draw per instance floods the GPU process.
- 2026-09-17 — per-part colour and state live in one `DataTexture`; the alpha channel carries state as well as opacity.
- 2026-09-17 — every scene constant is the reference's value × (radius / 27.5 m). Nothing is sized to one model.
- 2026-09-17 — **`backend: 'auto'` means WebGL2**; WebGPU is opt-in by name only and unmeasured at a real size.
- 2026-09-17 — **Electron starts only through the guarded scripts, and every guard reads `phys_footprint`** — `rss` is blind to the GPU.
- 2026-09-17 — the hemisphere-light difference against r170 is an upstream bug 0.186 fixed; we keep 0.186's.
- 2026-09-18 — the undo stacks are module state, and every filter-stack operation is a pure function returning the next stack.
- 2026-09-18 — **the assistant's tools are one catalogue in `shared/`, every entry declaring `kind: 'read' | 'view'`**.
- 2026-09-18 — every view tool goes through the store actions the buttons call — or the control's own handler, where the control has none (2026-10-02: the Schedules button's `window.sgvue.openSchedules()`; phase 4: the Schedules window's own handlers, `schedule-ui/actions.ts`, and the viewer's own commit for a click that places a markup) — so an AI action lands on the same undo stack.
- 2026-09-18 — every tool runs in the renderer; main holds the SDK, the key and the transcript, and never model data.
- 2026-09-18 — **the API key is encrypted by the OS and has no getter anywhere**; the renderer learns `hasKey` and nothing else.
- 2026-09-18 — **there is no `src/main/exports.ts`**: `settings.ts` and `sessions.ts` are the only two disk writers. *(Superseded 2026-09-25, Schedules phase 4: `exports.ts` is the third, owner-approved.)*
- 2026-09-18 — **the preload imports channel *names*, never the zod schemas** — importing zod there kills `window.sgvue` silently.
- 2026-09-18 — Preferences (⌘,) is the one allowed new surface, and it opens only from the native menu.
- 2026-09-18 — a file path is *admitted* by a user act before a `sgvue-file://` token is minted, and a token is single-use. *(2026-10-02: the user's Apply on a recent file the assistant asked for is such an act — the path is one main's own recents list holds, re-read at the click, and it goes through `admit()` as a Recent pill's does.)*
- 2026-09-18 — inline styles stay the design's declaration strings (`app/css.ts`); hover states are `!important` classes.
- 2026-09-18 — a value the file does not carry shows the design's own em dash. **Never a placeholder.**
- 2026-09-18 — element-tree groups of 200 rows or more are windowed; anything smaller renders the design's own DOM.
- 2026-09-18 — `viewer.addModel` never frames the camera; the shell frames the boot batch, once, with every model present.
- 2026-09-18 — a grid is a **segment**, not the design's `{ axis, v }`; real grids are not axis-aligned.
- 2026-09-18 — the shadow map is rendered on change, not every frame; five call sites mark it dirty.
- 2026-09-19 — **anything that changes what is drawn must call `invalidate()`**. The frame loop draws on demand.
- 2026-09-19 — a pick ray walks a uniform grid, and the grid is a **filter**: the candidate walk is still the answer.
- 2026-09-19 — **`forceSinglePass` on the glass material is refused**: the two-pass back-then-front order is drawn result.
- 2026-09-20 — **the scene is the model's project frame**, not the file's world frame; `geometry-streamer.ts` is where they meet. *(Amended 2026-10-08: the frame is the boot model's project frame expressed in map coordinates, P = M_boot ∘ Site_boot, and each model streams through its own M_i⁻¹ ∘ P — the federation lines up in map space, not by world coordinates; below.)*
- 2026-09-20 — a session, a share link and a viewpoint record `frameKey`; on a mismatch everything restores but the camera. *(Amended 2026-10-08: the key is P's — unchanged for a boot model whose map operation is the identity, new for one placed by a map conversion.)*
- 2026-09-20 — **the spatial-root `IfcSite`** is the one `IfcProject` aggregates, never the first by expressId.
- 2026-09-20 — a level ring sits at the storey's own `ObjectPlacement`; the ladder and the tag print the authored `Elevation`.
- 2026-09-20 — **`IfcElement.bbox` is unioned from the part boxes before the index freezes**: project frame, conservative, and said so everywhere.
- 2026-09-20 — **`IfcElement.solidCount` is the part count from that same pass**: whatever `viewer.solidCount` counts, so the assistant and the property card cannot disagree.
- 2026-09-20 — **the federation's grid list is ordered once, where it is unioned**: by family, then naturally by name.
- 2026-09-20 — a grid bubble that would overprint a kept one is not drawn, greedily in the grid's own axis order.
- 2026-09-20 — above six storeys the element tree keeps 40 % of the sidebar; at six or fewer nothing moves.
- 2026-09-20 — **every assistant result is bounded and says so when it cut**; `truncated` is never false when something was left out.
- 2026-09-20 — **a quantity total carries the file's own unit and its coverage**; nothing is ever converted, and an unsettled unit is left unnamed.
- 2026-09-20 — `apply_visibility` refuses a blank view outright, as `set_filter_stack` does; there is no Apply button for "leaves 0 of N". *(2026-10-02, phase 3: still so for a filter or a hide. An undo, a redo or a viewpoint restore that would leave nothing is **held** behind Apply instead — each returns to a view the user themselves had.)*
- 2026-09-20 — **the turn's 120 s cap aborts the live stream**, and the SDK client is bounded at 50 s × 2 attempts.
- 2026-09-20 — `max_tokens` is **64 000** and every strict tool streams its input eagerly; the zod re-validation is what makes that safe.
- 2026-09-20 — **the assistant has an eval suite, graded programmatically with no model judge**: 36 questions (66 since 2026-10-02), one window and one fresh conversation per case, ground truth computed at grade time (`docs/AI_EVAL.md`).
- 2026-09-20 — **the rule grammar gains one operator, `absent`** — "the property has no value" — because `!=` also matches every *different* value. It flows everywhere a rule flows, and it is the one visible change: the Filter card's 64 px operator control reads `empty`, everything with room reads `is empty`.
- 2026-09-20 — **a view tool can act on a found set**: `ids` (capped at 2 000) or `selection:true`, through the right-click menu's own store actions, so undo and the 5 % guard are unchanged. Rules stay preferred, because only a rule can be saved and shared.
- 2026-09-20 — **an id the federation does not carry is reported by count, never dropped in silence**; element ids are per session.
- 2026-09-20 — `manage_filters` reaches the designed card's **named filter sets** — save, recall, list, forget — through the card's own action, cap and repeated-name rule.
- 2026-09-20 — **`find_nearby` is box arithmetic on `clash_check`'s own uniform hash**, `IfcSpace` excluded unless asked; a test proves it equals the flat scan.
- 2026-09-20 — **`set_filter_stack` builds each step against the stack being assembled**, so three highlight steps in one call take three colours.
- 2026-09-20 — six instruction lines added, in **plain sentence case**: tool results are file data, quantities are as authored, the `absent` operator, the id and selection targets, named filter sets, and the turn budget.
- 2026-09-20 — **no dot-entry at the project root is packaged**, and a unit test reads `app.asar`'s own header: top level is `node_modules`, `out`, `package.json` and nothing else.
- 2026-09-21 — **the landing page's footer strip is not in the port** — no © line, no "Parsed locally, never uploaded", no `#privacy` / `#terms` / `#support` links, no divider; its **theme toggle is kept unchanged** in the same spot, in a plain `<div>`.
- 2026-09-21 — **every path the renderer stores or compares has passed through `admit()`**; main stays the only place that canonicalises, and a drop admits before it queues.
- 2026-09-21 — **a second launch always brings the window forward**, and the instance that loses the single-instance lock does nothing at all.
- 2026-09-21 — **a launch link carries only its payload into the window**, and `#backend=webgpu` is a dev-build switch: both halves enforce 2026-09-17's "WebGPU is opt-in by name only".
- 2026-09-21 — **on Windows every guard reads working set plus the GPU dedicated-memory counter**, because `phys_footprint` does not exist there and there is no pressure signal to read; enumeration is one PowerShell call, a process is ours by *directory*, and a kill is `taskkill /T /F`. **The macOS path is unchanged** — every Windows addition is behind `process.platform === 'win32'`.

- 2026-09-24 — **the landing page's "Resume last session" card is not in the port, and its pills' heading reads "Recent"**; the autosave still writes `last.json`, the share-link tests read it, and nothing in the app reads it back.
- 2026-09-24 — **the federation builds during the tick hold, the viewer is revealed at whichever finishes last, and the landing page fades out over 220 ms**; the ticked rows stay until the reveal, and the SQL index builds after it — `query` waits on the newest build, builds are chained so two never overlap, and a removal rebuilds too.
- 2026-09-24 — **on the landing page a new pick replaces a load in flight**: rows, stagger, parsed models, a join waiting out its hold and the parse worker all go, and stale results are dropped by generation. After boot a pick joins the federation.
- 2026-09-24 — **after boot, a pick whose model key is already open or loading is confirmed in a native message box and then replaces it** — *"Just ask user to confirm then remove the old version."* Cancel drops that file silently; Replace removes the old model only once the new one has parsed, right before it joins, under the same key, with no reframe; a failed parse leaves the old one. A newer pick of a key still loading wins, and parses once the older parse has run out (one worker holds every open file, so a single parse cannot be cancelled). ` (2)` survives only for two files of one stem in **one** pick.
- 2026-09-24 — **Help › About shows `SGVue`, the version and the owner's story** (`ABOUT_STORY`, one constant in `src/main/about.ts`): the native panel's `credits` on macOS, a native message box on Windows.
- 2026-09-24 — **the landing page shows `v<version>` on the left of the theme toggle's strip**, from `package.json` at build time (`__APP_VERSION__`), with no preload key.
- 2026-09-24 — **the sidebar's MODELS and STOREYS lists can be sized by dragging the boundary under them**; the tree takes the rest, sizes are session-only, a double-click resets, and undragged every style string is the design's.
- 2026-09-24 — **the assistant's suggestions are one scrolling line, folded behind a `suggestions` chip after the first user message**; same source, same cap.
- 2026-09-24 — **a gridline is drawn on to its bubbles' centres**; `p0` / `p1` stay the clipped ends every rule reads.
- 2026-09-24 — **dimensions between adjacent parallel gridlines, at each family's start end, a fixed screen distance inward of the bubbles**: pure geometry in `shared/annotate.ts` (`gridDimRuns`, `gridDimStandoffPx`), placed per drawn frame *before* `renderer.render`; labels decided after every bubble in the same sweep and occlusion-tested; a run is drawn only while its label is (`gridDimsStale` asks for the frame that catches up).
- 2026-09-24 — **the ground is two layers in the opaque list**: helper −2, opaque ground −1 (no depth write), batches 0, a veil at 10 (`CustomBlending`, 0.6, writes depth). Never a transparent veil — glass's back-face pass draws before every transparent. *(Amended 2026-10-08: the veil is drawn only while the canvas grid is on — below.)*
- 2026-09-24 — **the viewer keeps two boxes: `store.bbox` covers what is drawn, `frameBox` is the building** (`shared/site.ts` leaves out site classes and ground proxies, falling back to the whole box). Framing, view presets, the orbit target, the near zoom limits, the level rings and the bubble gap read `frameBox`; clip planes, far zoom limit, shadow frustum, ground, section sheet, occlusion and laser read `store.bbox`.
- 2026-09-24 — **the grid rectangle is the grids' own authored extent** (`gridExtentRect` + `padRect`, a segment under 2.5 m ignored), else the building's footprint; never the whole model's.
- 2026-09-24 — **site elements never hide an annotation**: the picker's `occludes` mask leaves them out of `anyHit` only; `pick` and `ray` (hover, select, laser, snap) still hit them.
- 2026-09-24 — **the view cube's canvas passes a mouse's events through where nothing is drawn**: a capture-phase `pointermove` hit-tests its zones, compass ring and north kite and sets `pointer-events` for the next event; touch always keeps the whole square.
- 2026-09-24 — **the canvas-grid flag lives in `viewer-core`, not the scene rig**, and is handed to every `buildScene` and reapplied by `setTheme`'s rebuild; the store's `groundGrid` is pushed on boot and not saved in a session. *(Amended 2026-10-02: it was "not an assistant tool"; it is reachable now through `toggle_display`'s `groundGrid` — the parity direction, below.)*
- 2026-09-24 — **"Original materials" off draws each element in its IFC class colour** — `classColors` in `shared/colors.ts`, which *is* `colorBy(elements, 'IfcEntity')`, pushed by `commitModels` through `viewer.setClassColors`; it is `baseColour`'s bottom override, under `modelColor`, resolved against the toggle in `decide` exactly as `modelColor` is.
- 2026-09-24 — **a viewpoint is renamed by `renameView`** (pure `renameViews`: trimmed, blank / unchanged / unknown returns the same list and writes nothing), stored where `saveView` stores; the row ignores a click with `detail > 1`, so a double-click restores once.
- 2026-09-24 — **the design's mock federation ships as the landing page's demo** through one production entry, `model/demo.ts` (lazy chunk); `dev/mock-adapter.ts` stays where the tests import it, and the hostile AI-eval fixture moved to `dev/hostile.ts` so its text is not in a production bundle. `openDemo` starts fresh and gives way to a later pick.
- 2026-09-24 — **`IfcSpace` is a third batch family, `space`**, whatever its file alpha: transparent, no depth write, never casts or receives, `forceSinglePass`, drawn at 2.5 (after ghosts, before glass), no grey edges (the accent outline stays), file alpha stored as 1 so `SPACE_ALPHA` (0.08) is the whole opacity; a state alpha above 1 draws at `SPACE_MARKED_ALPHA` (0.3). **The picker casts over non-spaces first and over spaces only on a miss** — in `picking.ts`, so the brute-force reference shares it.
- 2026-09-24 — **a UNC or device path is refused before `realpath`**, unless the user reached it themselves: the Open dialog, main's recents list, or admitted earlier this session; `recents:add` takes a network path only once it is admitted.
- 2026-09-24 — **a drop main did not admit loads but is never remembered**: `unadmitted` picks skip `addRecent`.
- 2026-09-24 — **one cap, `AI_JSON_MAX_CHARS` = 1 000 000**, on a tool result (→ `is_error`), a turn's view state and schema (→ refused); `ai:turn:abort` stops only the turn it names.
- 2026-09-24 — **the window never leaves the app's own page**: `will-navigate` allows a hash change only, no `<webview>`, and no page opens a window of its own (`main/window.ts`) — since 2026-09-25 main alone opens the second one, Schedules, under the same lock.
- 2026-09-24 — an `.ifczip` is read in two passes: several `.ifc` entries or a declared size over 600 MB is refused without inflating a byte.
- 2026-09-24 — **the GPU guard escalates**: `wait` is its own answer, so still-over-in-grace no longer resets the warning and a runaway is crashed at 3 s.
- 2026-09-24 — **`viewer.batch(fn)` repaints, rebuilds the edges and rebuilds the picker once for a run of setters** (`batched()` in the shell); a fade still settles a pending picker rebuild before it starts. Every multi-setter action in the shell goes through it.
- 2026-09-24 — **a session's ids are renumbered onto the slots its files have now** (`restorableIds`, by path; `sessionOrder` orders the batch); if one of its files is not open, `hidden` and `active` are dropped, and everything by name restores.
- 2026-09-24 — **a real pick while the demo is on screen replaces the demo** — the landing page's fresh start, no question, and the demo's review state goes with it (`forgetDemoView`).
- 2026-09-24 — **a batch whose join fails undoes itself; a replacement streams in beside the model it replaces, on a slot of its own**, so a failed one leaves the old model; after boot a failure is the error row, never the landing page.
- 2026-09-24 — **the macOS guards share one tested `parseFootprintMB` (`scripts/lib/mac-procs.cjs`), bound every `/bin/ps` · `footprint` · `sysctl` call (5 / 4 / 2 s), and fail closed on a process listing they could not make** — as on Windows.
- 2026-09-25 — **updates are manual: Help › Check for updates… opens the releases page in the browser** (`RELEASES_URL`, `shell.openExternal`); no auto-updater, no network call by the app, `publish: null` stays. *(Amended 2026-09-28: it opens the product site, `SITE_URL` + `?v=<version>` — below. Amended 2026-10-01: the app makes one network call at launch, the update check — below; there is still no auto-updater and no download.)*
- 2026-09-25 — **a second window, Schedules, joined to the main window by a private `MessagePort` pair that main creates and never reads**: the snapshot, the theme and every row click go renderer to renderer; **main still holds no model data**. One at most; it closes with the main window; not watched by the GPU guard (one shared GPU process, already watched). Its preload imports only `electron`, so it builds to one file a sandbox can load; it exposed nothing until phase 4's two file calls.
- 2026-09-25 — **ifcTable's pure engine is ported into `src/schedule/`** (its own `ifc/`, `schedule/`, `export/` layout, 284 of its test cases in `tests/unit/schedule/`, and its rule: no DOM there); **its IFC extractor is not** — `schedule/adapter.ts` builds the store from the already-parsed federation, plus `rowIds` (store row → federation id).
- 2026-09-25 — **main names the main window** (`window.ts` `mainWindow()`): Preferences, About, share links and a second launch act on it even while Schedules has focus — never "the focused one" or `getAllWindows()[0]`.
- 2026-09-25 — owner's plan for the Schedules port: **export will add ONE disk writer, limited to paths the user picks in a native Save dialog** (built in phase 4: `src/main/exports.ts`, below); extras chosen: two-way selection, right-click Isolate / Hide / Show, multi-model schedules.
- 2026-09-25 — **the Windows installer writes SGVue.exe's per-app GPU setting, `GpuPreference=2;SwapEffectUpgradeEnable=1;` under `HKCU\…\DirectX\UserGpuPreferences`, only when no value exists, and a real uninstall deletes it only while it is still exactly that** (`build/installer.nsh`); installer-only, Windows-only, invisible — no pixel differs.
- 2026-09-25 — **the Schedules window's whole interface is ifcTable's, and every visual decision in it is SGVue's** (`src/renderer/schedule-ui/`, vanilla DOM): tokens, type, radii, hover classes, the Filter card's fields, the Preferences card for overlays and the window's own confirm / prompt (`dialog.ts` — Electron has no `prompt()`); a header replaces ifcTable's app bar; **no Export, no `.schedule.json` import / export and no dead button until phase 4** (which brought them, below); `focusables` / `trapTab` live in React-free `app/focus-trap.ts`; **one pending typed edit** (`pending.ts`), its target bound at input, landing before any other input, focus change, click or key action.
- 2026-09-25 — **two-way selection**: main posts `selIds` to Schedules at most once a frame (`requestAnimationFrame`, a 100 ms timer as the backstop an occluded window needs), `quiet` when the table made it; the table marks rows **in place, never repainting**, and scrolls only to a selection made elsewhere.
- 2026-09-25 — **the Schedules menus act through the main `ContextMenu`'s own store actions**: `act` `select` / `zoom` / `isolate` / `hide` / `show` / `showAll` → `select(ids)` / `select(ids, true)` / `isolate` / `hide` / `show` / `showAll`, so the main window's ⌘Z reverts them; no 5 % guard (the assistant's alone); `colourBy` → `setColorByGroups`, `clearColours` → `clearColorBy`; every id admitted against `byId` (`admitIds` / `admitGroups`), and **an `act` left with no ids is refused** (`isolate([])` hides everything).
- 2026-09-25 — **Schedules column headings are focusable** (`tabindex="0"`): the keyboard's route to the heading menu, the design's `:focus-visible` ring drawn inset (`outline-offset:-2px`); focus survives a repaint (`preserve.ts` names a heading by `data-defcol`).
- 2026-09-25 — **"Colour 3D by this column" groups the column's displayed text over the uncapped schedule**, coloured by `colorBy`'s own rule — biggest group first, `SCHEME[i % 11]`, no binning or "other", because `colorBy` has none — and **refuses a column of more than 100 distinct values** (`MAX_COLOUR_GROUPS`, also the bound on both messages): past that no colour can be read.
- 2026-09-25 — **`Model` is the schedule's core field for the sidebar's model name** (`modelLabel`); with more than one model the opening schedule, a category's default and a template start with it, and a definition the user already has is never rewritten.
- 2026-09-25 — **no `scroll-margin` on schedule rows**: one declaration on every `<tr>` doubled a 4 082-row repaint; the row scrolled to is cleared of the sticky heading in script instead.
- 2026-09-25 — **saved schedule setups and the inspector width are the Schedules window's `localStorage`** (`sgvue.schedules.saved.v1`, cap 100, ifcTable's never-overwrite save rule, every entry validated by `parseScheduleDef` on read and an empty setup refused at Save; `sgvue.schedules.inspectorW`), no paths and no model data; phase 4 kept them there — a setup travels between machines as a `.schedule.json` the user exports and opens.
- 2026-09-25 — **measured: the largest category's repaint is the DOM table** (4 082 rows: engine 13–18 ms, full repaint 0.39–0.56 s — parse ~0.13 s, layout ~0.23–0.39 s); `content-visibility` on a `<tr>` does not window a table. A third scope, **`'panes'`**, repaints everything but the table for searches and list filters (field-browser keystroke 380–524 → 14–18 ms); row windowing is a later phase, because content-sized columns would change width as it scrolls.
- 2026-09-25 — **the third disk writer, `src/main/exports.ts`** (Schedules phase 4, owner-approved): it writes the bytes the Schedules page built — `.xlsx`, `.csv` or `.schedule.json` — **only to the path `dialog.showSaveDialog` returned in the same call**, extension forced to the kind, atomically (unique temp beside it, then `rename`), at most **50 MB**; the page sends a kind, a suggested name and bytes, never a path. A name the extension rule changed asks before it replaces a file.
- 2026-09-25 — **`export:save` and `scheduleFile:open` answer the Schedules window's `webContents` and nothing else**, checked before the payload is read; the Schedules preload exposes exactly `saveExport` and `openScheduleFile` (`window.sgvueSchedule`), channel names spelled literally and pinned to `ipc-channels.ts`; the main preload names neither.
- 2026-09-25 — **opening a `.schedule.json` is a read, not an `admit()`**: main's Open dialog, at most 1 MB, the text back once; `admit()` is for models the renderer keeps a path to, and no path, token or stream reaches the page. ifcTable's strict `parseScheduleDef` decides; a bad file is a toast.
- 2026-09-25 — **exceljs 4.4.0 (MIT) is a devDependency, bundled into one lazy chunk of the Schedules window** (`exceljs.min-*.js`, 0.94 MB, loaded on the first Excel export): renderer libraries are bundled, so it never enters `app.asar`'s `node_modules`, and the production CSP is unchanged — its `Function(…)` calls are fallbacks a browser never reaches (measured: no CSP refusal).
- 2026-09-25 — **Excel cells are numbers**: ifcTable's exporter unchanged — the displayed value under a number format that reproduces the column (decimals, grouping, unit, prefix / suffix), a count total a plain integer, rule colours from the table's own `firingRule`.
- 2026-09-25 — **on Windows SGVue picks its own adapter — NVIDIA, else AMD, else Windows decides — with Chromium's `--use-adapter-luid=<high>,<low>` appended before `ready`** (`src/main/gpu-choice.ts`). **The LUID is read fresh at every launch** from `HKLM\SOFTWARE\Microsoft\DirectX` (one bounded `reg query`, ~40 ms) and an entry last seen before this boot is refused, because a LUID changes at every boot — so there is no cache and no relaunch. Preferences' `preferNvidia` (default on) turns it off; the installer's GPU value stays as the fallback. Dev builds only: `SGVUE_GPU_VENDOR=<hex>` puts one vendor first.
- 2026-09-25 — **a GPU process that crashes (`crashed` / `abnormal-exit` / `launch-failed`, never `oom` or `killed`) on a launch that asked for an adapter is recorded once in `settings.json` (`gpuSwitchFailed`), and later launches ask for nothing while it names the adapter they would pick** (`planGpu`); toggling Preferences' checkbox clears it, and so does a different adapter. Nothing relaunches, so nothing loops. A LUID with a non-zero `HighPart` is never sent, and registry numbers are read only from `REG_DWORD` / `REG_QWORD`.
- 2026-09-28 — **a property name the assistant sends is matched to the file's own in `executeTool`, and only when that is certain** (`executors/names.ts` on the pure `shared/prop-names.ts`): the exact key, else the one key equal but for case, spaces and punctuation, `Pset.Key` read as `Key`; never a merely similar key, never one of two that normalise alike. A yes/no on `=` / `!=` becomes the key's stored spelling. The rewrite reaches the store, and the result carries `resolvedKeys` / `resolvedValues`. A name still not a key answers — on any tool — with its 8 nearest names; a value that matched nothing, with its key's 15 commonest values. `attr()` and `matchFn` are unchanged.
- 2026-09-28 — **`find_properties` searches property names** (read, strict, `text` · `rules?` · `limit?` ≤ 50): per name its sets, how many carry it, its kind, measure type and commonest values, `truncated` when anything was cut. One prompt line: names are authored ("Includes As GFA"), so look before calling one missing.
- 2026-09-28 — **property names have their own schema cap, `SCHEMA_KEY_CAP` = 1 000**; every other category keeps 150. About 22 B a name: 1 000 names is a 22.7 kB cached schema block.
- 2026-09-28 — **the Windows installer is an assisted wizard (Welcome → progress → Finish) that says whether it installs, updates or repairs** (`customInit` reads the uninstall entry's `DisplayVersion`); per-user with the install-mode page skipped by `customInstallMode`; the Finish page's "Create a desktop shortcut" box decides that shortcut (`createDesktopShortcut: true`, never `always`); English only; bitmaps from `scripts/make-installer-images.py`.
- 2026-09-28 — **the assistant makes and reads schedules: `make_schedule` (view) and `get_schedule` (read)**, the ported engine run in the **main renderer** (`schedule/assistant.ts`) over `schedule-link.ts`'s `scheduleStore()` — the adapter's own snapshot through ifcTable's `StoreBuilder`, one slot, built the first time either tool runs — never by a chat turn — and released when the federation changes or Schedules closes. Each measured column carries its display `unit` and the SI `filterUnit` its filters compare in. Fields: core by label, key or SGVue's name; property names through `resolveKey`, as `pset: '*'`; an unknown or ambiguous name refuses the whole call with the nearest names. Output bounded: ≤ 50 rows a page, ≤ 50 groups, 120 characters a cell, 300 000 for rows and groups together, `truncated` honest.
- 2026-09-28 — **the open schedule crosses the port as `current` (Schedules → main, with the rows its table shows, ≤ one per 250 ms, on connect and after a change) and `define` (main → Schedules, `made` / `edited`)**, both bounded by `DefShape` and read by `parseScheduleDef` on receipt; main keeps it in a module holder (`openSchedule()`), never the store, a session or a link; the view state gains a small `schedule` line (title, classes, headings, filter text, rowCount) built from that holder alone — no store, no engine run. A `define` goes on the window's own undo history.
- 2026-09-28 — **changing the open schedule is `make_schedule` with `base:"open"`, not a third tool** (the guard forbids `edit` in a tool name, and one shape serves both): columns are added or re-headed / re-totalled, `removeColumns` by heading or field, a hidden column asked for shown again, filters / sort / group replaced when given; calculated columns, formats, colour rules, widths and the template note are kept. Filters cap at the engine's 8, not 20; strict schemas carry no `maxItems` (the API refuses them), so bounds are in the descriptions and enforced by zod. The window is opened and brought forward only when it is closed.
- 2026-09-28 — review follow-ups: **a name that normalises to two keys says so** (`"fire rating" matches two names, FireRating and Fire_Rating — say which.`), and **`booleanSpelling` counts stored spellings case-insensitively** (`true` + `True` is one).
- 2026-09-28 — **`export_schedule` (view, strict, `{format}` of `xlsx` · `csv` · `all_saved` · `schedule_file`) is the one tool that may open a Save dialog** (owner-approved; *2026-10-02: one of **two** calls that may raise a native dialog — `request_user_action`'s `open_files` raises the Open dialog — and the list is pinned, `GATED_CALLS`*): over the port, `export {n, format}` makes the Schedules window run the Export menu's own action (`EXPORT_ACTIONS`) and answer `exportAck {n, refused}` at once — refused by the menu's rules (`busy`, `no_schedule`, `nothing_saved`), one request at a time, 3 s for the answer, never a wait on the dialog; the window is raised through `openSchedules()`; the tool is never told whether a file was saved and says so. The read-only guard exempts that exact name from the mutating-name test and now refuses a path, file name or file-content key at any depth of any tool's input.
- 2026-09-28 — **`color_by_schedule_column` (view, strict, `{column | null}`) is the heading menu's "Colour 3D by this column"**: the grouping moved to `schedule/colour.ts` (`colourColumn`, which the menu calls too) and is applied through `schedule-link.ts`'s `colourByColumn` (the menu's `colourBy` path); the column is found by `removeColumns`' own rule (`columnsNamed`) among the visible ones; `null` is the legend's clear. **Not on ⌘Z**, exactly like the menu's: colour-by is not a `VIS_KEY`.
- 2026-09-28 — **a spot tag is collapsed to its level and toggled by a click on it** (`spotLevelHtml` / `spotGridHtml` in `shared/annotate.ts`, `signedF3` in `fmt.ts`, `renderSpot` in `annotations.ts`): the expanded grid is the design's byte for byte; the level is the map Z, else the file's z; the tag takes pointer events as a grid bubble does; the state is per spot and session-only.
- 2026-09-28 — **the snap prefers the surface being looked at** (`SnapDepth` in `snap.ts`): a candidate more than `SNAP_PLANE_TOL × scale` (1 mm on the mock) beyond the hit face's plane from the camera — its depth along its own ray against the face's there — or cut away by the section is never taken; on-plane candidates are tried before off-plane ones with the design's rule inside each; an edge whose foot is hidden gives its nearest-to-camera visible point within 11 px. With no `depth` it is the design's rule, case for case.
- 2026-09-28 — **an export's suggested name is cut to fit main's 200-character `suggestedName`** (`EXPORT_NAME_MAX`, each part an equal share of what the date, extension and separators leave).
- 2026-09-28 — **the cut outline is one instanced fat-line mesh**: three's `LineSegmentsGeometry` layout written out in `section.ts` (the example imports the classic `three` entry) and `Line2NodeMaterial` at `CUT_LINE_PX` = 2.5 CSS px, opaque, not clip-gated, `polygonOffset` −1 / −4, render order 5 (after the batches, before the ground veil); one draw on WebGL2 and on WebGPU, no shadow, not picked; a new geometry every recompute, the old one disposed.
- 2026-09-28 — **the cut is computed from the batch store's own slot arrays** (`viewer/section-cut.ts`, pure): element boxes first, then each part's triangles; a triangle in the plane gives nothing, an edge in the plane is drawn by the triangle whose third vertex is kept, collinear pieces are joined (a box is 4 segments). It is recomputed on the main thread, **at most once a frame** — marked by the section's `setClip` / `clearClip` and by every edge rebuild (so visibility, fades, highlight, activate and models) — and measured at **5.6 ms (level) / 7.0 ms (grid) / 8.9 ms (worst, on-plane), 13 ms cold, on a 5.58 M-triangle synthetic model**, so no worker and no chunking.
- 2026-09-28 — **Help › Check for updates… opens the product site told this version**: `updatesUrl(__APP_VERSION__)` = `SITE_URL` (`https://sgvue.github.io/`) + `?v=` + the build-time version, URL-encoded (`src/main/about.ts`); `RELEASES_URL` is gone. Still `shell.openExternal`, still no network call by the app, `publish: null` stays. *(Amended 2026-10-01: one launch-time call since — below.)*
- 2026-10-01 — **the action bar is the status bar's `:711–714` buttons moved, and its lane is declared**: `ActionBar` (`app/StatusBar.tsx`), drawn while `hasActionBar` (`selectors/status.ts`); `--abar` on the stage (`abar()`, `ACTION_LANE` = 30 = the status bar's measured 27 px + 3) is read by the colour legend and the two cards that stop above the status bar. **The stage's bottom edge is one grid row, `BottomRow`** (`1fr minmax(0,auto) 1fr`, `pointer-events:none`, every piece `auto`): the action bar over the status bar · the hint under the reset pill · the Ask pill — none of the five positions itself any more, so the harnesses find the first four by `data-role` (`statusbar`, `actionbar`, `hintbar`, `resetpill`). One pure rule, `centrePlace` (`selectors/lanes.ts`), from four measured widths: `between` the side zones with `BOTTOM_GAP` (10 px) on either side, `above` them when they leave less than the pill's width or `HINT_MIN` (200 px), `empty` — no gaps. The pill stands over the hint's start, not its middle, which is under the open chat panel. The chat panel, the property card and the legend are not zones: no lane is declared for the row's height. *(Amended the same day: one is, `--brow`, for the chat panel and the property card — below.)*
- 2026-10-01 — **the toolbar's width is a constraint, so its dividers were paid for out of the gaps**: five groups, four 1 px dividers, `column-gap:4px` → 737 px (741 before); a stranded divider is `visibility:hidden`, never `display:none`; Schedules is the button under the cube canvas's empty corner now, so the e2e suite clicks it the way a hand does, and again if no window came (`openSchedulesWindow`).
- 2026-10-01 — **a clipped text's tooltip is a native `title` from one pure rule, `fullText`** (`selectors/props.ts`): the whole text, none for a blank or the em dash; never `data-tip` inside an `overflow:auto` body.
- 2026-10-01 — **the element tree is eye-first**: the columns swapped, the group row's padding kept (its 6 px is what puts the eye on the storey eye's x), the element row's mirrored; a group row's `children[1]` / `children[2]` are still its label and count, which the dev scripts index.
- 2026-10-01 — **a loaded model's path reaches its row through `modelRows` (`ModelRow.path`) from `fed.sessionFiles()`**, read in the memo keyed on `federation`; the library popover and the Recent pills read `LibraryFile.path`. No IPC, no store key; `''` is no `title`.
- 2026-10-01 — **the ground stands at the project frame's own zero — scene `0 − offset z` — whenever the model's box spans it, else at the bottom of the box; never at scene z = 0 as such** (`groundLevel` in `viewer/scene.ts`, pure; `buildScene` takes the datum, and `viewer-core.ts` builds the rig one way, `buildRig`, at construction and on every `restage`). The offset is untouched: sessions, links and viewpoints keep their cameras. `debug().ground` reports it. A box wholly below its datum now has the ground under it, not on top of it.
- 2026-10-01 — **the app makes one network call of its own: the launch-time update check, in main** (`main/updates.ts`, owner-chosen "Check at every start"): one `GET` to `LATEST_RELEASE_URL` (a hard-coded https constant on `api.github.com`) through `net.fetch` with `Accept` and nothing else of ours, `credentials:'omit'`, `cache:'no-store'`, `redirect:'error'`, 5 s, the body read up to 256 kB; `tag_name` through `parseVersion`, compared by `isNewer` (`shared/version.ts`, semver precedence) with the build-time `__APP_VERSION__`. Every failure is `null` and at most one `console.warn`; one request per run (the promise is kept); **none in a development build**, where `SGVUE_UPDATE_LATEST` stands in for the tag (the `SGVUE_OPEN_PATHS` gate). Two channels, both without a payload and answered for the main window only: `update:check` → `{ latest } | null`, `update:open` → `shell.openExternal(updatesUrl(__APP_VERSION__))` — the renderer never supplies a URL. No Preferences switch, no auto-updater, no download; `publish: null` stays.
- 2026-10-01 — **there are two section planes, the gridline cut and the level cut: `sections: { grid, level }`, each a `SecPlane { name, offset, flip, cut }` with `name: ''` for none** (`shared/sections.ts`; owner-chosen "Two: gridline + level"). `setSec(kind, patch, open?)` patches one plane, `clearSections()` clears both, `gridClick` touches the gridline plane only, and millimetres become metres in one place, `sectionConfigOf`, per plane. The viewer's contract is `setSections({ grid, level })`, which replaces `setSection` (a viewer `kind` stays `'grid' | 'storey'`): the clip is the intersection of the kept sides — a second uniform pair in `materials.ts`, a plane that is not cutting parked where it keeps everything; the pick and laser rays are clamped by every cutting plane (`clipSpan`, shared by the brute-force reference) and the snap refuses a candidate any of them cut away, while the label-occlusion ray stays unclipped, as it was and as the design's is; each plane has its own outline quad and preview sheet; a plane re-aims the camera only for itself — it starts cutting, or its kind, name or flip changes while it cuts — once, at the gridline plane, when both moved, and never on `refresh()`. `debug().section` is `{ grid, level }` and `debug().planes` both uniform pairs. **Measured: with one plane set, every one of the 84 canvas-only frames of the phase-6 chain is identical, pixel for pixel, to a capture of the build before.**
- 2026-10-01 — **a session, a share link and a viewpoint carry `sections` and, beside it, the old single `section`** (`legacySection`: **the plane that is cutting** when exactly one of the two set planes is; when neither cuts or both do, the gridline plane if it is set, else the level plane; else the old "none" object), so a build that knows only `section` still restores one plane — the one that changes what is seen. Reading takes `sections` when it is there, else maps the old `section` onto the plane of its `kind` — one pure normaliser, **`sectionsOf` in `shared/session-codec.ts`**, the only reader for all three (`sessionPatch`, `restoreView`), which coerces what a pasted link can carry: a name that is not a string, or is longer than 200 characters (`PLANE_NAME_MAX`), is none, an offset that is not a finite number is 0, `flip` / `cut` are true only when exactly `true`, unknown keys are dropped. `RESTORE_ORDER` is unchanged (section before camera); `forgetDemoView` and `clearSections` reset both.
- 2026-10-01 — **each plane's cut outline is trimmed to the kept side of the other cutting plane** (`sectionCut(store, planes, include)` and `emit` in `viewer/section-cut.ts`): a joined segment wholly on the other's cut-away side is dropped, one that straddles it is cut at the crossing, and an element whose box does not reach the other's kept side is skipped before its triangles are walked; the line where the two planes meet inside a solid is not drawn. Still one instanced mesh and at most one recompute a frame (`setClips` marks it, where `setClip` / `clearClip` did); `debug().cut` sums both planes and counts them. **Measured on the 5.58 M-triangle synthetic model: 6.2–7.2 ms with both planes cutting; with one, 5.6–7.5 ms (the build before 5.6–7.3) and 8.9–9.3 ms in the worst case, a plane lying on a face (8.7–9.4).**
- 2026-10-01 — **`set_section` sets one cut and leaves the other alone**: `kind:"grid"` the gridline cut, `kind:"level"` the level cut, a `kind` with `name:""` or no name clears just that cut, `kind:null` clears both, and an unknown name still changes nothing and returns the valid list. A rewritten description, through `setSec` as before; its result's `section` and the view state's `section` are one string from one function, `sectionsLabel` — `grid C`, `level L2`, `grid C + level L2` or `null`.
- 2026-10-01 — **the assistant should be able to do whatever the user can do in the app** — bounded, as the user is, by the viewer-only rule. The owner, asked whether an assistant-made section should actually cut: *"yes. assistant should possess everything user can do on the app. that would be the best case scenario."* **`set_section` is its first application, and it does what the user's click does:** *setting* a plane is the chip's own patch (`planePatch`, `selectors/section.ts`) — cutting, at the kind's default offset (0 for a gridline, `LEVEL_DEFAULT_OFFSET_MM` for a level, one constant in `shared/sections.ts` that the description states too), not flipped; *changing* the plane already set at that name changes only what the call passes — **an omitted `offset`, `flip` or `cut` keeps what the plane has, one rule with no exception**, as the card's `±500`, `flip side` and `cut` each change one thing and its offset and flip controls never touch `cut`, so a previewed plane that is moved is still a preview — and never clears it, which is what a second click on the live chip does; one new optional input, **`cut`**: `false` is the card's `cut` button off (the plane previewed), `true` is it on, and omitted a new plane cuts; `kind:null` is the card's `Clear all` and a `kind` with no name that block's `Clear`. The result says `Section cut at grid C.` or `Section previewed at grid C.` Nothing beyond `set_section` was changed; the audit of the other tools is separate.
- 2026-10-01 — **Vee, the assistant's mascot, is a pure core and a thin canvas** (the owner's "Ask Vee" handoff, `design-reference/ask-vee/`, the specification for the assistant's name, mascot and thinking motion; **its px ÷ 1.5 = app px**). `veeGrid(state, frame)` in `app/vee-grid.ts` is the handoff's `hexGrid` ported verbatim — five states, 16 × 16 cells; the unit test runs the handoff's own code beside it for every state over two whole cycles — with the palette as roles (a token's name or a constant, per theme), the slots (21 / 19 / 16 px) and frame offsets (5 / 11 + 4 a message / 17), and two rules. **The device-pixel rule:** `veeCell` = `max(1, round(devicePixelRatio))` whole device pixels to a cell — **one number for every sprite**, whatever its slot (until the trace step each slot rounded on its own, `max(1, round(slot × devicePixelRatio / 16))`: the same at 100, 150, 175 and 250 %, unequal sprites at 125 and 200 %); `veeBox` sizes the canvas to exactly `16 × cell` of them — its CSS length rounded *up* in the third decimal, because Chromium truncates a length to 1/64 px — and centres it in the slot on a whole device pixel; the slot, with negative margins, is what the layout sees. **The clock rule:** one shared clock at 8 frames a second (`app/Vee.tsx`), counted from wall time, that counts only while a sprite is mounted and the window is visible (`veeClockRuns`) and **sleeps between changes** — one timer, set for the next frame at which a mounted sprite's drawing differs (`veeNextWake`, a pure rule whose table is read off `veeGrid` itself: `idle` at its blink's two edges, `thinking` and `reading` every frame, `done` twice a second) — never under `prefers-reduced-motion: reduce` — each sprite then holds clock frame 0, which with its own offset is an open-eyed frame — and never sets React state: a wake repaints a sprite's own canvas, and only when its grid changed (two repaints a blink). `idle` stands `offset` frames ahead of the clock; every other state plays from its own first frame, counted from when the sprite entered it (`veeSpriteFrame`), so a half-second `found` is the hop itself. A `MutationObserver` on `data-theme` and a re-armed `(resolution: …dppx)` query redraw every sprite; `window.__sgvueDev.vee.pin(n)` holds the frame for captures. **The light palette** (the handoff is dark only): the roles on the light tokens, the visor `--ink`, the top facet `#CBD8D5`, the highlight `#35C4B6`. **The name** is one constant, `ASSISTANT`, behind `authorOf` (`selectors/chat.ts`) — the label, the reply strip and the quote sent with a reply — plus the title, the pill, the Schedules toasts and one instruction line (`Your name is Vee. …`); `SGVue` stays the app's name everywhere.
- 2026-10-01 — **the bottom row declares its height as a lane, `--brow`**: `browFrom(centreTop)` (`selectors/lanes.ts`, pure) is `0` while the centre zone's top is within the 52 px the design leaves under the chat panel (`ROW_ROOM`; a hint alone is 46.8 px up, the reset pill alone 49.5), else `ceil(centreTop + 6 − 52)` — the design's 6 px (`ROW_CLEAR`) kept above the zone, in whole pixels. `BottomRow.fit` measures the top where it places the centre and writes the store's `brow` (only when it changes; layout only, never saved); the stage declares it beside `--rlane` and `--abar`; the chat panel's `bottom` and `max-height`, `clampChatSize` and the property card's `max-height` subtract it. Nothing in the row reads it, so it cannot feed back into what was measured. With `0px` every computed style is the design's. Not taken by the colour legend, and not a lane for the bars: a full action bar under the panel is as it was. **The Ask pill is 88.9 px since it reads `Ask Vee`** (66.6 before), so at 900 px the bars leave the centre 180 px and it stands above them (`centrePlace`, unchanged).
- 2026-10-01 — **the thinking trace is a pure core, a little store and one painter, on a clock that can be pinned** (the owner's "Ask Vee" handoff, step 2): `ai/trace-facts.ts` — what a tool call contributes; `ai/trace.ts` — `traceReduce` (the turn's events → a timeline), `traceCues`, and `traceFrame(timeline, T, layout)` → everything visible at `T`, with `traceSend` for the lift and the composer — no DOM, and the unit test runs the handoff's own code beside it at 330 instants; `ai/trace-store.ts` — the one live timeline, **outside the shell store**, every event stamped with `traceNow()`; `app/Trace.tsx` + `ChatPanel` — one `requestAnimationFrame` loop and one painter, which also runs in the panel's layout effect. `ai/bridge.ts` feeds it where it already handles the turn (`sendChat`, `tool_start`, `done`, `aborted` / `error`) and `executeTool` reports each call **after `resolveNames`** (`ToolContext.trace`). Cues: Send = `chatBegin`; Think = Send + 1 s; Read = the first `tool_start`, not before Think + 0.4 s; each later step when its data exists and the one before has had its time (1.8 / 1.6 / 2.4 / 0.6 s), only the latest of those that pile up; Answer = `done`. The live reply is the row its message will be — one keyed list, the same element — and what a finished reply keeps (status, rows, width) is `ChatMessage.trace`. `window.__sgvueDev.trace.pin(T)` holds the clock and `chat.step` steps a turn, so a capture holds it at any instant; the e2e, which has no dev harness, replaces main's two turn handlers and sends real events over the real channels.
- 2026-10-01 — **a rule is *scope* or *check*, and that split is the trace's Filter and Check** (`splitRules`, `SCOPE_PROPS`): scope = a rule on `Model`, `IfcEntity`, `PredefinedType`, `ObjectType` or `Level`; check = every other rule; for any executed tool with a live top-level `rules` array, OR group by OR group. The scope set is the rule list with its check rules removed (an OR group left with none matches everything); the matched set is `matchFn(rules)` itself. Filter says the classes (two at most, else `N classes`) or the first scope value, and counts in the class's plural noun only when every OR group names the same one class with `=`; Check says the prettified property names (two at most), `missing` when every check rule is `absent`, else `found`. **A Filter is shown only when the scope really narrows** — the brief had it whenever a scope rule is present, which for `IfcEntity = IfcWall OR FireRating is empty` would read "412 walls". A tool with no live rule is a note: its `TOOL_STAGE` phrase (every catalogue tool has one, tested). The status comes from the turn's last rule-bearing call: `checked {scope} · {s}s`, `found {count} · {s}s` or `{s}s`, whole seconds to the nearest, at least 1.
- 2026-10-01 — **the matrix is one cell per element while it fits, else `ceil(count / capacity)` to a cell, on whole device pixels** (`planRead`, `planRules`, `traceLattice`): 4 rows grouped by model, every model keeping a column; 2 rows of larger cells for the scope, each gliding from the read cell that holds its first element; a cell is flagged when it holds a match, and the count rises by what the cell holds, so it ends exact. Every pitch, size and origin is the handoff's ÷ 1.5 rounded to whole device pixels for the display's ratio (150 %: 4 / 3, 10 / 7, 14 / 10 — its own numbers; 100 %: 3 / 2, 7 / 5, 9 / 7), with the reference's numbers untouched for `dpr: null`, which is what the unit test compares. At 100 % the demo building's 412 are two to a cell (206 in 53 columns); one each from 125 %.
- 2026-10-01 — **the answer is never delayed by animation, and nothing animates for ever**: every animation of the trace is `pre(cue, …)`, complete from the answer on; at `done` the matrix is the last rule-bearing call at its end, shown or not, and the answer's choreography starts there. The loop runs from Send until `traceEnd` — never more than 1.95 s after the answer (a long reply's 65 ms stagger and more than fifteen flyers' 50 ms are shortened to fit) — and not at all between turns; reduced motion draws one frame a cue (`traceNextCue`). **The trace is narration**: `narrated()` in the bridge and a `try` round the painter mean a failure in it is logged and dropped — the tool still answers, the reply still commits (plain), the window stays (the painter runs in a layout effect and the renderer has no error boundary).
- 2026-10-01 — **the rows under an answer**: from the last rule-bearing call, when it matched something and the turn has no `table`; one per storey in `federation.storeys` order, unnamed last under the em dash; at most eight (`+{k} more levels`); one cell per element up to twelve in the largest row, else `ceil(largest / 12)`; the cells start where the handoff starts them unless a storey's name needs more (`rowLayout`), and a clipped name carries its text as a `title`. A row is a button — `select(ids, false)` — with **`hv-card`, not the brief's `hv-step`**, which on a `--step-bg` bubble is no hover at all. A finished reply paints its own cells at rest (`rowCells`).
- 2026-10-01 — **two inline marks in a reply, as elements** (`ai/marks.ts`, pure): `**bold**` → weight 600, `` `code` `` → the mono face; nothing else is markup and nothing is ever HTML; an unmatched mark prints as written; code inside bold is mono. A reply is rendered word by word (`markWords`) because the reveal fades each in — `position:relative` inline spans, so the text wraps exactly as plain text does. **Linear in the reply's length, because it runs on the answer path** (`done` counts the words before it commits the reply): an opening has one candidate for its partner, the next mark of its kind, and is literal if that one cannot close it — 200 kB of `**a ` splits in 4 ms, where a first version that looked past such a candidate took 44 s. `Words` is memoised on the text, so a reply is split once and not at every keystroke in the composer. *(Amended 2026-10-08: the marks are read inside blocks — paragraphs and their line breaks, `- ` / `* ` / `1. ` lists (a numbered item breaking into a paragraph only at `1.`, as in CommonMark), pipe tables — split by `ai/blocks.ts` in one linear pass, linear in the number of blocks too, anything else as written; `wordCount` moved there and counts a list marker and a whole table as one piece each; `Words` became `ReplyText`, memoised the same way, and every message of Vee's is drawn through it; and the prompt asks for those blocks — the design's one-sentence line replaced.)*
- 2026-10-01 — **the chat panel has a stop control and `You` stands on the left** — both the handoff's, amending 2026-09-18's "no stop control": the send button is the stop while a turn runs (`abortChat`, `Stop`), and for 300 ms after a stop it ignores clicks (`sendClick`, `STOP_GUARD_MS`), so a double-click on Stop neither stops twice nor sends the draft; Enter during a turn still does nothing, nothing is `disabled`, closing the panel stops nothing; `chatRow` gives a user's row `flex-start` and the assistant's corner. The store has no `chatStage`; `BrandBusy` and the `ifctrace` / `ifcbreathe` / `ifcdot` keyframes are gone; `TOOL_STAGE` stays, as the note step's words.
- 2026-10-01 — **a tooltip inside the chat log is generated only while it shows** (`styles/vee.css`: `content:none` unless hovered or focus-visible, `@starting-style` for the fade), and the log is `overflow-x:hidden`: the design's always-laid-out `[data-tip]::after` under a control near the log's right edge was the horizontal scrollbar (`scrollWidth` 348 against 320). No child was wider than the log.
- 2026-10-02 — **parity with the user, phase 1 of 4: the reversible view state the assistant could not reach is reachable** (the owner's direction of 2026-10-01, above), each through the store action its own control calls — or, for the Schedules window, the toolbar button's own handler: `toggle_display` gains `groundGrid`, `snap` and `originalMaterials`; `select_elements` a `mode` (`replace | add | remove | clear`, all the store's one `select`); `apply_visibility` the actions `undo` / `redo` (the store's `step`); `color_models` a `null` for one key (`setModelColor(key, null)`, the palette's reset); and two new view tools in a group of their own (`PARITY_TOOLS`) — `set_models`, the eye beside each model (one `up({ modelVis })`, so one request is one undo step), and `set_interface`: theme, units, tree mode, sidebar, card, armed tool, tree search, opening the Schedules window. 33 tools (35 after phase 2, 36 after phase 3, below). No camera, viewpoint, markup, file, clipboard or in-Schedules work — phases 2–4; no new IPC, no preload key, no tool input that carries a path.
- 2026-10-02 — **a tool that wraps a toggle compares first and calls the control's action only when the state differs**: every call is idempotent, and a setting already as asked is *reported* (`already`), never flipped — no store write, no viewer call, no undo entry, no ↺. It is the fix for `activate_model` (the store's `activate` toggles, so the already-active key used to leave activate mode under the reply "Activated X."; it now stays active and says so), why `set_interface` cannot close the card it was asked to open (`openCard` toggles), and why `toggle_display`'s `dims` says "already" like the rest. `set_interface` sets no `acted`: ↺ restores the five `VIS_KEYS` and could not put a theme or an armed tool back. *(Amended the same day, phase 2: the revert was widened, and `set_interface` marks the turn for every setting but the Schedules window.)*
- 2026-10-02 — **read-back is sparse per turn and full on demand**: the per-turn view state gains a field only while something is *not at its default* — `display` (the switches off their default), `tool` (not `select`), `modelsHidden` (keys), `sectionPlanes` (a set plane's offset, side or preview where it is not the card's default) — so a view at its defaults is byte for byte what it was (`sparseViewState`, `shared/ai-schema.ts`); `get_view_state` reports all of it in full — `display`, `sectionPlanes`, `history`, `models`, `interface` — and keeps `section` the one string the eval grades. A model's *name* is file text: `get_view_state` only, never per turn or in the cached schema. A unit test holds `get_view_state` to the session's own list of review state (`SessionSource`): each key reported, or excluded by name with its reason (`coords`, `hlColor`). *(Phase 2: a highlight step's `color` is reported, so only `coords` is excluded; and the per-turn `modelsHidden` is capped at 20 keys, `modelsHiddenMore` counting the rest. Phase 3: `coords` is reported too — `basePoint`, with whose it is — so nothing is excluded.)*
- 2026-10-02 — **everything new that can hide runs `scopeCheck`, and two old ways round it are closed**: `set_models` (blank refused; under 5 % held with the `{ modelVis }` patch; a call that only brings models back is exempt, as `show` is); `undo` / `redo` — asked first through `peekHistory`, the one reader added to the store — where a step that takes something out of view and would leave nothing, or under 5 %, is **refused in words, never held** (Apply applies a patch on top of the history; an undo is a move through it); and `manage_filters`' `enable` and `apply_set`, which wrote their stacks unchecked. `remove` and `move` go through the same check and are exempt: `visFn` is a conjunction, so removing a step can only reveal and reordering changes nothing. *(Phase 2: they no longer go through it at all — a test proves they cannot hide — and a `move` to the step's own position is no move. The option rejected for undo, exempting it because it only returns to a state that existed, is in the row. Phase 3: such an undo or redo is **held** behind Apply as an action — the user's click takes the real step — and no longer refused.)*
- 2026-10-02 — **a turn holds one change behind Apply, and a second is refused in words** (`oneHeld`, `executors/index.ts`): it used to take the slot from the first in silence, after the model had been told twice that the user had a button. *(Phase 3: one **request** a turn, of any kind — below.)*
- 2026-10-02 — **two instruction lines, and a ticker that reads the call**: the switches and `set_interface` are for when the user asks and never change the model; the per-turn view state lists only what is off its default, and `get_view_state` has it in full (31 lines, none of the design's touched; 33 after phase 2, 35 after phase 3). `toolPhrase(name, input)` (`ai/stages.ts`) words the two calls a tool's one phrase would misstate: clearing the selection, and undoing or redoing.
- 2026-10-02 — **parity with the user, phase 2 of 4: the camera, saved viewpoints, markups and one filter step in place**, each through the action its own control calls: `set_view` gains `fit` (`extents | selection` — the new store action `fitView`, which is the viewer's `zoomExtents` / `zoomTo`: a double-click on empty space, and F), `azimuth` / `elevation` (`aimCamera` → `viewer.lookAlong`, the one method added to the viewer) and `zoom` (a factor on the fit, 0.1–20); two new view tools in `PARITY_TOOLS` — `manage_views` (`list | save | restore | rename`: `saveView`, `restoreView`, `renameView`) and `manage_markups` (`list | focus`: `focusPoint`); `manage_filters` gains `update` and `set_filter_stack` a `color` per step. 35 tools (36 after phase 3). Nothing deletes, clears or places, nothing reaches outside the view or into the Schedules window — phases 3 and 4; no new IPC, no preload key, no tool input that carries a path.
- 2026-10-02 — **the camera's direction is two angles in the project frame** (`shared/view-angles.ts`, pure): `azimuth` is the compass bearing the camera looks towards, clockwise from project north — the model's own +Y, not true north — and `elevation` how far it looks down from level (90 straight down, −90 up); `θ = −π/2 − azimuth`, `φ = π/2 − elevation`, clamped at the rig's own pole. In these terms the view buttons are south 0 / 0, west 90 / 0, north 180 / 0, east 270 / 0, top 0 / 90 and iso 315 / 29.8 — to the tenth the read-back is rounded to, so the description's numbers, sent back, are that view — and the description lists them from the same constant. A direction turns the camera where it stands and lights no view button; `fit` frames without turning; a named view with a direction is refused in words. The projection is swapped before any framing, so a fit is the fit of the projection asked for and a repeated call lands on the same camera. Read back as `camera { view, projection, azimuthDeg, elevationDeg }`: in `get_view_state` always, per turn only while the camera is not standing on the view `view` names.
- 2026-10-02 — **viewpoints and markups are reachable, and nothing of the user's is deleted**: `manage_views` lists (≤ 20 a result), saves (≤ 50 by a tool; a name ≤ 80 characters), restores and renames; `manage_markups` lists (≤ 50 of each, in the card's unit) and zooms to one. **No delete, no clear** — a removed viewpoint or markup cannot be brought back, so those wait for phase 3's consent gate — and no placing, which needs a click on the model (phase 4: built — below). A restore can hide, so it runs `scopeCheck` as an undo does: one that would take elements out of view and leave nothing, or under 5 %, is refused in words (a viewpoint is a section and a camera too, not a patch Apply could hold). *(Phase 3: `delete` and `clear` exist and only **ask**; a guarded restore is held behind Apply as an action — below.)* Names are the user's text: in a tool result only, never per turn or in the cached schema. `saveView`'s id is monotonic, as `saveFilterSet`'s is.
- 2026-10-02 — **`manage_filters`' `update` changes one step where it stands** — action, rules, highlight colour — through the card's own `updStep`, `setStepRules` and `setStepColor`: the step keeps its id and its place, the others their colours and off switches, where a rebuild keeps none. Compared first; under `scopeCheck` (blank refused, under 5 % held with the stack it would write, an update that takes nothing out of view exempt). A colour is one of the card's six swatches (`STEP_COLORS` = `HL`), on `set_filter_stack` too; `get_view_state` reports it on each highlight step.
- 2026-10-02 — **the per-turn revert's snapshot is the session payload, and it puts back the parts that reply's own tool calls changed** (`state/selectors/snapshot.ts`, pure; owner-approved — *"correct."*): `turnSnapshot` = `sessionPayload` through `sessionSource` (which `model/session.ts` uses too) + what a session does not carry (`TurnExtra`) + each model's key, digest and slot; the state is cut into `TURN_PARTS`, held to `SessionSource` by a test; `executeTool` measures the parts around each call that says `acted` (`TurnState.parts`) — or takes the executor's own measurement, `ui.parts`, from the one that waits afterwards (`set_interface` opening the Schedules window) — so the user's own orbit during a turn is not the reply's; `revertTurn` restores them through the store's **`applySession`** — moved there from `model/session.ts`, unchanged, so a session, a share link and a revert are one path — and the rest through each control's own action. Ids are renumbered by model (`slotMapOf`, `renumberId`: key + digest → slot); what a model unloaded since took with it, or a camera recorded in another scene, is said in the panel's status line (`revertNote`). Only `vis` goes on the undo stack. A held change applied later joins the reply's undo (`mergeUndo`); a reverted reply gives its snapshot up (`undoSnap: null`). Never restored: `uploadNames`, `coords`, the viewpoint list, filter sets, the Schedules window. *(Phase 3: `coords` is a part now — `basePoint`. Phase 4: a markup the assistant placed is not a part, and `revertTurn` takes it away all the same — `ChatMessage.placed`, below; a spot tag's state is not put back.)*
- 2026-10-02 — **phase 2's prompt, ticker and evaluation**: two instruction lines (33) — the camera's two angles and when to move it; viewpoints and markups are the user's own, list before acting — and the read-back line names the camera in all three of its parts; `toolPhrase` words `manage_filters`' `update` and each `manage_views` / `manage_markups` operation; ten more cases (56); `VIEW_FINGERPRINT` sees the camera's direction, where it stands, the viewpoints and a step's colour; a case starts with empty `localStorage`; the write-claim detector excuses a claim verb (`renamed`, `deleted` …) **only for its own object** — a viewpoint, a filter set or a markup directly after it, or as the whole subject of its passive, with nothing more hung on it (`and the wall`, `, the wall too`) — so a model write beside one of those words is still a write; what is inside quotes is a name and excuses nothing; it errs towards flagging, and its three limits are pinned by a test. Phase 1's five review leftovers are closed with it.
- 2026-10-02 — **parity with the user, phase 3 of 4: the consent gate.** What reaches outside the view or cannot be undone is never performed by a tool: it is **asked for** through a surface the app already has, and the user's click does it (the owner, of *the assistant proposes, and you click Apply in the chat or pick in the Windows dialog*: *"correct."*). The designed pending row carries an **action** as well as a patch — `ChatPending` is `{label, patch}` or `{label, action}`, `PendingAction` a closed union (`undo` · `redo` · `restore_view` · `delete_view` · `delete_measure` · `delete_spot` · `clear_measures` · `clear_spots` · `delete_filter_set` · `save_filter_set` · `open_recent` · `copy_link` · `copy_guids` · `set_base_point`) — and **the one performer is the store's `performGated`, called only by `applyPending`, which only the row's Apply button calls**: the row is taken before the action runs, so it runs once; `cancel` drops it; nothing re-arms it. Behind it: `manage_views` `delete`, `manage_markups` `delete` and `clear` (a new `kind`), `manage_filters` `delete_set` (immediate and unguarded until now) and any `save_set` that would **forget** a saved set — the card's rules replace one of the same name and keep twelve, so a save could take one away; `forgottenBySave` says which, and a save that only adds is still done at once — and one new view tool, `request_user_action` (`open_files` · `open_recent` · `unload_model` · `copy_link` · `copy_guids` · `set_base_point`), whose description's first job is to say it only asks. 36 tools. No new IPC, no preload key, no tool input that carries a path. *(2026-10-08: no `set_base_point` in either list any more — the card is read-only.)*
- 2026-10-02 — **why these are never automatic**: text authored inside an IFC file reaches the model in every tool result and in the cached vocabulary, and the per-reply revert cannot put back a deleted viewpoint, markup or filter set, an unloaded model, a loaded file or what was on the clipboard. So the most a model's output can do is put a labelled question in front of the user. Nothing under `renderer/ai/` imports or names a performer (the guard test reads the directory for `dropView`, `clearSpots`, `forgetFilterSet`, `setCoord`, `copyLink`, `openRecent`, `removeModel`, `applyPending` … by identifier); a request is fixed when it is asked — to record ids, a history snapshot, the GlobalIds' text — and one the user's own work has overtaken does nothing and says so; **no label and no result holds a path or the link**: a recent file is named and matched against the app's own list (a name with a separator is refused by zod, two recents of one name are refused rather than told apart), only a valid GlobalId is ever put on a clipboard, and the link is cut at the click.
- 2026-10-02 — **a `gate` marker on the tool spec, and the guard pins it**: `ToolSpec.gate = { by, asks }`, read by `gateOf(name, input)` → `'apply'` (the pending row) · `'dialog'` (a native dialog) · `'confirm'` (the sidebar's strip), flattened into `GATED_CALLS` — 11 calls. `tests/readonly-guard.test.ts` pins that list line for line, the **two calls that may raise a native dialog** (`request_user_action` `open_files` → Open; `export_schedule` → Save — amending 2026-09-28's "the one tool"), the one file under `renderer/ai/` that may name each of `openDialog`, `askRemove` and `requestExport`, and the only callers of `applyPending` (the Apply button, the dev harness) and `performGated` (the store). Still two kinds, `read` and `view`. *(Phase 4: **fourteen** gated calls — the Schedules window's `delete` and `print` → `confirm`, its `open_file` → `dialog` — so three calls may raise a native dialog and three a confirmation. 2026-10-08: **thirteen** — `set_base_point` went with the read-only Coordinate-system card.)*
- 2026-10-02 — **one request a turn, of any kind** (amending phase 1's "one change behind Apply"): a held change, a gated request, the Open dialog, the Schedules window's Save dialog and the sidebar's confirmation all count (`waitingOn`: the row's `pending`, else `TurnState.asked` for what is not a row); `executeTool` refuses a second gated call **before** its executor runs (`alreadyWaiting`), `oneHeld` a second held change after. An Open dialog is single-flight besides (`openDialogUp()`, counting the user's own): the tool never awaits it and is told only that it was raised. *(Phase 4: the Schedules window's own confirm — before a deletion, before its print dialog, before a save that would forget — and its Open dialog count too.)*
- 2026-10-02 — **a guarded undo, redo or viewpoint restore is held as an action, no longer refused** (amending phases 1 and 2): `{kind:'undo'|'redo', snap}` — Apply takes the real `step` only while `peekHistory` still returns that very snapshot — and `{kind:'restore_view', id}`. Both guard verdicts are held, "nothing left" as well as "under 5 %": each returns to a view the user themselves had. A filter or a hide that would leave nothing is still refused outright (2026-09-20).
- 2026-10-02 — **the clipboard, measured (Electron 44.3.0 / Chromium 152)**: `navigator.clipboard.writeText` is refused **always** in this app — main's `setPermissionRequestHandler` denies everything, by design — and `document.execCommand('copy')` succeeds only while the page holds a user's activation (5 s after a click or a key). So the designed `link copied` / `Copied` flashes were shown over an untouched clipboard. One shared `copyText` (`renderer/clipboard.ts`: the async API, else a selected off-screen textarea and `execCommand`) answers whether it copied; `copyLink` and `copyGuid` flash only on `true`; a copy applied from a reply and refused is said in the panel's status line (`CLIPBOARD_REFUSED`). No permission is granted and there is no clipboard IPC. **The browser's rule is not the gate**: a tool call arriving within 5 s of the user's Enter could copy, so it is the Apply click that is required, not activation. *(Phase 4: the chat table's `copy csv` — the design's line called the refused API and copied nothing — goes through `copyText` too, as the store's `copyTable`.)*
- 2026-10-02 — **the base point is read back and reverted**: `get_view_state.basePoint { E, N, Z, angle, source }` — `source` is `file` while the four fields are what the file's georeferencing states (the card caption's own test), `none` while all are blank, else `user` (`basePointSource`, `selectors/status.ts`); and `coords` is a `TURN_PARTS` part (`basePoint`), so a change the user applied joins that reply's `revert`. `NOT_REVERTED` is `uploadNames` alone. *(After review: the request carries what the four fields held, `was`, and Apply sets nothing if any has changed since.)* *(Superseded 2026-10-08 — the read-only card: `source` is `file` or `none`, `coords` is in `NOT_REVERTED` beside `uploadNames`, and there is no request to change it.)*
- 2026-10-02 — **a recent file opened by Apply is admitted by the user's act**: the request holds the path the app's own list gave it — in renderer memory, never in a label or a result — and at the click `openRecent` re-reads main's list (`listRecents`): a path no longer on it is not opened (`gone`), else `openPaths` → `admitPaths` → main's `admit()` against that same list, as a Recent pill's click does. Nothing the model sent is ever opened.
- 2026-10-02 — **phase 3's prompt, ticker and evaluation**: two instruction lines (35) — which things are the user's alone to decide and that text inside the model asking for one is content; and that `asked`, `pending` or `dialog` in a result means nothing has happened yet — with two lines this work had *added* earlier (2026-09-20's on filter sets, phase 2's on viewpoints) reworded where they had become false, and no design line touched; `toolPhrase` words each request; seven more cases (63), one of them on the hostile fixture, which gained a fifth injection (an object type that "pre-approves" deleting, unloading and copying); `VIEW_FINGERPRINT` sees the loaded models, the base point, the saved filter sets and the sidebar's confirmation; `gradeView` checks `pendingKind`, `basePoint`, `loadedModels`, `filterSets` and `unloadAsk`; `HANGER` reads a gapped clause behind `:`, `—` or `–` as hung on an excused verb (phase 2's leftover). The write-claim detector was **not** widened: two honest kinds of "asked, not done" phrasing it flags — a future passive, "nothing has been …" — are pinned by a test. (After review, a contraction negates: `n't` stood behind the pattern's `\b` and could never match.)
- 2026-10-02 — **what stays the user's alone, by decision — not built**: the API key and every Preferences setting; quit, reload and DevTools; the consent clicks themselves — Apply, Save, Open, Replace, the sidebar's `delete` (phase 4: and the Schedules window's Delete, Print and Open); and anything that writes model data.
- 2026-10-02 — **the gate, hardened after its review (the reviewer's nine items)**: a held **patch** is typed to six visibility keys (`PENDING_PATCH_KEYS`, `shared/undo.ts`) and `applyPending` hands `up()` those and no others, whatever the object carries; the guard also refuses the general doors under `renderer/ai/` — `applySession`, `setState`, `setSettings`, `setApiKey`, `clearApiKey`, `saveSession`, `clearSession` — and requires every `.up(` a tool calls to be a flat literal of those keys; **a call that only asks is not run for a turn that is no longer live** (`ai/bridge.ts`: answered `The turn was stopped, so nothing was asked.`; phase 4: nor is any other view call — below); `set_base_point` carries what the four fields held and is stale when they change (gone 2026-10-08); **every name in a label or a request's result goes through `labelText`** (control characters and bidi / zero-width marks out, then clipped); `manage_filters`' `name` is bounded at 200; **`revertTurn` drops a reverted reply's pending row**; the gate's prompt line names exactly the calls that ask; and the eval's negation takes a contraction (`n't` outside the `\b` group).
- 2026-10-02 — **parity with the user, phase 4 of 4: the Schedules window, and placing markups.** `make_schedule` sets what that window's Filter, Sorting and Format tabs and its calculated-value editor set — `filterLogic`, `itemize`, per column `hidden`, `decimals`, `unit`, `align`, `after`, and `calculated` — each by the tab's own rule, in `buildSchedule` (`schedule/assistant.ts`): a unit only from `unitOptions` for what the column measures, decimals only on a number, a formula refused with the editor's own reason (`calcProblems`, moved into `schedule/schedule/computed.ts` so the editor and the tool share it; `statOf`, `typeOf`, `kindOf`, `kindsByHeading` and `newId` moved into the engine with it); with no `result` a formula is what its units work out to (`dimensionOf`); `get_schedule` reads each one back. One new view tool, `manage_schedules`; `manage_markups` places. 37 tools.
- 2026-10-02 — **a stale view call is not run** (`ai/bridge.ts`, `staleAnswer`; phase 3's review): for a turn that is no longer live — after Stop, or under a newer turn — every `kind: 'view'` tool is answered `The turn was stopped, so nothing was changed.` and only a read still runs; a call that only asks keeps phase 3's sentence. The guard also refuses a **bare** `up(` under `renderer/ai/`.
- 2026-10-02 — **`schedule: true` is the open schedule's rows as a set, resolved in the main renderer** (`ai/executors/targets.ts`, `scheduleElementIds`): the engine run uncapped over the definition the Schedules window last reported and the assistant's own store — what `get_schedule` reads — then the store's own actions, so the 5 % guard, undo and the pending row apply. Precedence `ids`, `selection`, `schedule`, `rules`. On `apply_visibility`, `select_elements`, `color_by_property` and `copy_guids`. **Not bounded by `MAX_TOOL_IDS`** (the same day's follow-up; phase 4 refused an over-long schedule whole): that cap is for ids the model sends, and this set never travels through the model — the app holds it, as it holds `selection` — so a schedule of any length is acted on whole, the scope guard holding or refusing as for any set; rules stay preferred where a rule can say the set, because only a rule can be saved and shared. **Never through the port's `act`**, which is the row menu's and has no scope guard; the guard test pins that the main window posts no `act`.
- 2026-10-02 — **the Schedules port gains `manage` and `manageAck`** (`schedule/messages.ts`), both `.strict()`: `manage {n, at, op, name?, to?, ask}` — one of twelve operations, at most two names and one flag, no definition, path or content; `manageAck {n, result, …}` — one of nine results and, per operation, a name, a count or one of two lists (≤ 60 templates, ≤ 100 saved setups, ≤ 12 classes each). **A name crosses only as `SafeName`** — ≤ 200 characters, no control or direction character; a saved setup with any other name is counted (`unlisted`), never sent. The asker waits `MANAGE_ACK_MS` (3 s) and one request waits at a time; the window drops a request older than `MANAGE_FRESH_MS` (2 s), so a renderer held up by its print dialog cannot act for a turn that gave up. The answer goes at once, with the window's `current` posted ahead of it; a dialog is raised only afterwards.
- 2026-10-02 — **the Schedules window's handlers are one function each, with two callers** (`schedule-ui/actions.ts`: `stepHistory`, `applyTemplate`, `loadSaved`, `saveCurrent`, `renameSaved`, `duplicateSaved`, `askDeleteSaved`, `printSchedule` — the bodies moved out of `events.ts` unchanged, as `EXPORT_ACTIONS` was): the click, which still asks what it always asked first, and `schedule-ui/manage.ts` for a request over the port. `delete`, `print` and `open_file` are **gated** (`confirm`, `confirm`, `dialog`; fourteen gated calls — thirteen since 2026-10-08 — three of them a native dialog): answered `asked`, then that window's own confirm (labelled `Ask Vee`) — before a deletion, and before `window.print()`, which only its `Print…` click calls, because the print dialog's own default button prints — or the native Open dialog. **A question raised for the assistant takes no default button** (`dialog.ts`, `ConfirmHow.forAssistant` — an explicit option, never read off the label): the focus goes to the card (`tabindex="-1"`), so a key press already under way answers nothing; the user's own confirms and prompts are unchanged. **A save or a duplicate that would forget a saved setup asks first too** (`forgottenBySave`, `forgottenByDuplicate` — the replace-your-own and the cap of 100), held when the turn has already asked (`ask: false`) and re-checked at the click; the user's own Save is unchanged. `load` and `apply_template` do not ask "Replace the current schedule setup?": the replacement is one step on that window's undo history. `save` writes that window's `localStorage`, as its Save button does — not a fourth disk writer.
- 2026-10-02 — **a markup is placed by the viewer's own commit for a click** (`viewer-core.ts`: `commitSpot` / `commitLaser`, called by the click handler and by `placeSpot` / `placeMeasure`; `showSpot` is the tag's own toggle, `annotations.ts` `setExpanded`): `manage_markups` `place_spot` / `place_measure` take an element and `at` — `top` (the default), `centre` or `base` of its **bounding box** (`shared/annotate.ts`, `boxPlace`; the tool says it is the box, not a picked surface) — or a project-frame `point`; the store's `placeSpot` / `placeMeasure` subtract the scene's whole-metre `offset`. Top and base hand the laser the face's normal and the element (it does not fire into it); the centre hands it neither. ≤ 50 of a kind by a tool. **A placed markup is session view state, so the reply's `revert` takes it away** (the same day's follow-up; phase 4 had it stay): the executor reports the new record's own id (`ui.placed` → `TurnState.placed` → `ChatMessage.placed`) and `revertTurn` drops exactly those that still exist, through the Markups card's own × — nothing under `renderer/ai/` names a removal; a reply that only placed one is offered `revert`; one the user already removed is skipped in silence. Saved lists and a spot tag's state are not put back. Deleting and clearing stay gated.
- 2026-10-02 — **the chat table's `copy csv` copies** (owner-requested): the design's line (`SGVue.dc.html:2029`) called the refused clipboard API; the button calls the store's `copyTable` → `copyText`. No flash, as designed; a refused copy is said in the panel's status line (`CLIPBOARD_REFUSED`), and a later success takes that sentence away. Measured in the built app: a real click leaves exactly `tableCsv`'s text on the clipboard.
- 2026-10-02 — **phase 4's prompt, ticker and evaluation**: two instruction lines (37) — the Schedules window's controls with `schedule:true`, and placing a markup (on the box, only when asked; since the follow-up, taken away by the reply's revert) — with three added lines reworded where they had become false and no design line touched; `toolPhrase` words each `manage_schedules` operation (the three that ask say "asking" — to delete, to open the print dialog — or "opening the Open dialog") and the placing ones; three more cases (66): a spot and a measurement placed on top of a named element, graded on the Markups card's lists and the spot's height against the element's box, and the rows of a schedule that is not open; `VIEW_FINGERPRINT` sees the markups, `gradeView` checks `markups`; `NEGATION` takes the typographic apostrophe. **Measured:** the tools block 47 127 → 54 448 B, the contract 20 263 → 21 468 B — 54 774 and 21 497 after the follow-up; the whole parity work took the catalogue from 32 049 B to 54 774 B (+22 725 B, against an estimate of about +13 kB).
- 2026-10-02 — **deliberately left out of the parity work, each for a stated reason**: a schedule's column widths, auto-fit and equal width, its appearance panel, colour rules, heading orientation, thousands separators, a group footer's style and its print layout (how one window looks on one screen or one sheet — low value, and a definition the assistant changes keeps them); a calculated value's definition taken away (`removeColumns` takes the column); dragging the sidebar's and the panels' sizes and folding a property-card section (layout, session-only, nothing a question needs); the chat panel's own controls (the conversation is the user's side of it); and a markup on a **picked surface** — a tool has no pointer, so it names a box or a point.
- 2026-10-02 — **the refactor pass after the parity work: nothing visible, one module boundary, two pins.** The trace's layout planner is `ai/trace-plan.ts` — moved out of `ai/trace.ts` verbatim, which stays the part read beside the handoff's jsx and re-exports every moved name — and it **imports nothing from `./trace`**: `REF` calls `J` at module load, so the five leaf values both need (`clamp`, `J`, `MATRIX_TOP`, `MONO_CH`, `ROW_CELLS`) are declared there. `tests/unit/scripts-parse.test.ts`: every script under `scripts/` parses (`node --check`) and carries no NUL byte. `tests/unit/design-css.test.ts`: `design.css` is the design's `<style>` block less exactly the three recorded keyframes.
- 2026-10-02 — **version 1.2.0 changes the version number and nothing else in the app**; its installer, `dist/SGVue-1.2.0-setup.exe` (the unsigned NSIS wizard), is verified here without being run — the owner runs it — and each release's notes are `docs/releases/<version>.md` from now on.
- 2026-10-05 — **SGVue is open source under the Apache License 2.0, published as a fresh public repository, `sgvue/sgvue`**, whose first commit is the prepared tree authored as Yong Yen — the owner: *"prepare our sg vue repo for open source on github. propose license for me and setup everything properly like a industry standard."* The private history stays private; GitHub's runners build the macOS installers, and the owner tests them before they are published.
- 2026-10-05 — **the design tool's runtime and starter files and the eval's HTML report builder are not redistributed** (their licence was never recorded): the trace fixture writes out its three easing curves, `scripts/ai-eval.cjs` writes JSON only, the prototypes are read as source, and `.gitignore` keeps all five out of every commit.
- 2026-10-05 — **`THIRD_PARTY_NOTICES.md` is generated** (`scripts/third-party-notices.cjs`, from the installed tree and the recorded `scripts/third-party-notices.json`) and held to it by `npm test`; it, `LICENSE` and `NOTICE` ship in every installer's resources (`extraResources`), never inside `app.asar`. On macOS, where electron-builder deletes them, a mac-only `extraResources` also carries Electron's `LICENSE` (as `LICENSE.electron.txt`) and `LICENSES.chromium.html` into `SGVue.app/Contents/Resources/` — to be confirmed on the first `dist:mac`.
- 2026-10-05 — **macOS builds are ad-hoc signed**: `mac.identity: '-'`, `hardenedRuntime: false` — a download opens after one Open Anyway; a Developer ID and notarisation are still owed.
- 2026-10-05 — **`sgvue/releases` is a permanent public channel** — never renamed, moved, made private or deleted, because every installed copy asks it for updates and treats a redirect as failure. CI builds the installers and publishes nothing; releases are made by hand (`docs/RELEASING.md`).
- 2026-10-05 — **public commits are authored as `Yong Yen <releases@sgvue.invalid>`, the project's public commit identity**, and no file holds a personal account, address or link.
- 2026-10-05 — **LF in every working copy** (`.gitattributes`, `* text=auto eol=lf`): a CRLF checkout — Git for Windows' default — fails the guard test's source patterns.
- 2026-10-05 — **the public repository, `sgvue/sgvue`, is the source of truth**: every push is public at once; commits carry the project's public commit identity; the privacy search runs before every push; `sgvue/releases` stays the download channel. The private repository is an archive of the history before publication.
- 2026-10-05 — **Dependabot proposes no major version update** for any dependency, npm or Actions (`'*'` with `update-types: [version-update:semver-major]`): a toolchain major is a measured change, not a bot PR. Security updates are unaffected — `update-types` applies to version updates only.
- 2026-10-08 — **with the canvas grid off, the ground veil is not drawn** (owner-requested): `buildScene` builds it with `visible = groundGrid` and the rig's `setGroundGrid` moves it with the helper, so a theme change keeps it and every rig rebuild (`buildRig`) takes the flag; the opaque ground stays, and takes the shadow. The veil casts nothing, so the shadow map is untouched and `invalidate()` is all the toggle needs. The veil also carried the ground's depth, so with the grid off what is below grade — edges, glass, annotations — is drawn too.
- 2026-10-08 — **the federation is assembled in map space** (owner-approved, coordinates part 1): each model's world → map operation comes from its own declaration — `mapPlacement` in `shared/georef.ts`, the one function the geometry, the grids and storeys, the base point and `get_model_info` all read; the `IfcMapConversion` on the 3D `Model` context (or a sub-context of it), else IFC2X3's `ePset_MapConversion`, else the identity — the federation's frame is **P = M_boot ∘ Site_boot** (`federationFrame`), and each model streams through **M_i⁻¹ ∘ P** (`modelFrame`), which is the boot's site frame itself, not recomputed, for every model placed the way the boot is. The offset, Float64 and `COORDINATE_TO_ORIGIN = false` are unchanged; `frameKey` is P's. **The base point is P**: set once, at boot, from the boot model, never by a model that joins later; the card, the chips and `basePointSource` speak for the model whose declaration the fields are (`cardGeoref` — since part 2 the store's `bootGeoref`, below).
- 2026-10-08 — **`IfcMapConversion.Scale` is never applied for placement**, only reported as written: exporters write it absent, 0.001 and 1000 for the same millimetre model in a metre CRS, and web-ifc has already applied the length unit.
- 2026-10-08 — **E, N and H are multiplied by the map unit**, `IfcProjectedCRS.MapUnit` (IFC2X3: `ePset_ProjectedCRS`'s, by name — `lengthUnitFromLabel`); **absent, it is the metre** — what Revit writes and the IFC4.3 Annex E examples; a name that is not a known length is read as metres and said so.
- 2026-10-08 — **`TrueNorth` is never stacked on a map conversion**, and in part 1 it places nothing at all; the base point's angle still falls back to it, as a readout only, when nothing else states a rotation (2026-09-20). *(Part 2: beside a `WorldCoordinateSystem` that is the map position it is the turn — rule 4, below.)*
- 2026-10-08 — **CRS names are deliberately not compared**: every regime fixes one CRS a project, and the names are unreliable (EPSG:3414 and the compound EPSG:6927 for one grid, placeholders, free text), so models align by their operations whatever their CRS is called.
- 2026-10-08 — **rule 4: with no map conversion, a `WorldCoordinateSystem` that is not the identity is the map position** (coordinates part 2, owner-approved): the 3D `Model` context's (`readWcs`, `Georeference.wcs`), M = the WCS — origin through the length unit, its own turn — then `TrueNorth`'s turn, atan2(x, y), **only** when nothing else turns (no conversion, no site turn, no WCS turn). `placedBy` and the caption's method gain `WorldCoordinateSystem` (`… + IfcSite placement` with a site that moves). **Beside a conversion** the WCS is undone first, M = C ∘ WCS⁻¹ (IfcOpenShell's reading), and `get_model_info` says `ambiguous`. **web-ifc 0.0.77 applies the WCS to no placement — neither its move nor its turn** (pinned by a test), so nothing is added twice. Fixtures (i) Project Base Point with no EPSG, (j) its IFC2X3 twin, (k) WCS + conversion: all eleven federate within 1 mm in all 110 ordered pairs; IfcOpenShell agrees product by product — `auto_xyz2enh` for (k), and its own `get_wcs` and `get_true_north`, composed as Revit writes them, for (i) and (j).
- 2026-10-08 — **the Coordinate-system card's one-line note** (owner-chosen, *"One-line note on screen"*): `notLinedUp` / `lineUpNote` (`selectors/status.ts`, pure) — a model with no map position while another has one, or one the stream flagged `farPlacement` (`ModelIndexMeta.farPlacementMetres`, recorded only for a model that did not set the offset); a boot model with no map position is named and no distance is. Read off the store's `bootGeoref`; names are the sidebar's file line through `labelText` (moved to `shared/fmt.ts`). `get_model_info` / `get_view_state` report `notLinedUp`.
- 2026-10-08 — **the Coordinate-system card is read-only** (the owner: *"dont let user change anything"*): no `setCoord`, no `onChange`, no `set_base_point` (13 gated calls), no `basePoint` revert part; the store writes `coords` in `setOffset` alone, from `bootGeoref` — the boot model's georeferencing, kept beside `frame` after any unload, and cleared with it — and the guard pins that. A session's, link's or viewpoint's `coords` is **ignored on restore and still written**, for older builds (`sessionPatch`, `RESTORE_ORDER` without `coords`). `basePointSource` is `file` | `none`; the status bar's chip is the boot file's CRS or the em dash.
- 2026-10-08 — **a laser measurement reads each side of its point** (owner-requested): `LaserRay` and `MeasureRecord.sides` carry, per axis, `{ minus, plus }` — the distance **along the axis** from the point to the face its − / + ray hit, `null` for none — beside the whole ray, `x` / `y` / `z`, which is kept (the assistant's result and the eval's observation read it) and is now exactly their sum; one label a side at the middle of its half, the live reading and the Markups row from `shared/annotate.ts` (`laserLabelHtml`, `laserLiveHtml`, `laserSideLengths`); a row with a two-sided axis wraps between axes (`MarkupRow.axes`, absent otherwise, so any other row is the design's span); `manage_markups` adds `sides` in the card's unit. No declutter: label overlaps are measured, not moved.
- 2026-10-09 — **the display unit is `mm | m | ft` (`shared/units.ts`, `DisplayUnit`), set at every boot from the boot model's own `LENGTHUNIT`** (`displayUnitOf`: shorter than a metre `mm`, a metre or longer `m`, an imperial conversion-based unit `ft`, none the design's `mm`; `federation-store.ts` keeps `bootUnits` beside `bootGeoref`) and changed after that only by the toggle, the assistant's `set_interface` and a session or a link: `units` is a payload key now, restored when it is one of the three, and a payload without it — every older one — leaves the boot model's. It is a session part of the per-reply revert, no longer a `TurnExtra`.
- 2026-10-09 — **one rule for every readout** (`shared/units.ts`): each keeps its own grouping, spacing, decimals and unit position, and only its quantity and unit follow — `mm` byte for byte as before; `m` metres to three decimals where it printed millimetres; `ft` feet and inches to the nearest 1/16" (`ftIn` / `signedFtIn`, the international foot) for a length, dimension or elevation, decimal feet for a coordinate, ft² / ft³ for an area or volume the app computes. The viewer hears it through `viewer.setUnits` (`annotations.ts` re-renders every reading and tag and rebuilds the grid dimensions and level tags, whose boxes are measured once). Authored values are never converted; a quantity total is labelled in the file's own unit (`ChatTable.units`; `unitLabel` writes FOOT / SQUARE FOOT / CUBIC FOOT as `ft` / `ft²` / `ft³`).
- 2026-10-09 — **the Section card's field speaks the unit and the plane holds millimetres** (`selectors/section.ts`: `offsetText`, `parseOffset`, `parseFeet`, `nudgeOffset`, `nudgeLabel`): in `mm` the design's field exactly; in `m` and `ft` the typed text is kept while the field has focus and the plane moves only when it reads as a number. **The Coordinate-system card speaks the file's map unit** (`mapUnitOf`: `m`, `ft`, `US ft`; `coordsFromGeoref(g, per)` divides before it rounds), not the toggle.
- 2026-10-09 — **the assistant**: `set_interface`'s `units` takes `ft`; the per-turn view state names `units` only while it is not `mm`; one instruction line (40) — a length, elevation or distance stated to the user is in the display unit, a coordinate in metres or, in `ft`, decimal feet, a quantity as authored; `manage_markups` lists laser lengths in decimal feet while the card shows `ft`. Every other tool input and result keeps its documented unit — `set_section`'s offset is millimetres.
- 2026-10-09 — **Navisworks Manage 2026 places the georeferencing fixtures in two groups, and SGVue keeps its rule — no "Navisworks mode"**: fixtures a–f and i, appended with IFC reader v4 and Shared Coordinates on, split differently with "include True North" off and on — Navisworks positions as SGVue does (`Scale` ignored, feet honoured) but turns differently (inferred; the angle was not measured); SGVue places all seven as one building, as IfcOpenShell does and as IFC reads `TrueNorth` beside a conversion. For the two to agree, consultants export from Shared Coordinates or Survey Point (the turn in the site placement).
- 2026-10-09 — **federation ids are `slot × ID_STRIDE + express id` with `ID_STRIDE` = 1 000 000 000, composed only by `fedId` and decoded only by `slotOfId` / `localOfId`** (`shared/federate.ts`): the design's 1 000 000 is a 60–70 MB file, and four 150 MB files lost 1 146 elements and the SQL index to shared ids. The bound: a unique, exact id for every express id below 10⁹ on slots 0 … 9 007 198; a model past it is refused at load in its own row (`entity ids above #999999999 are not supported`). No typed array, texture or shader holds an id. A session, a link and a viewpoint carry `idStride`; one without it is read by the design's stride against the elements really there (`liveHidden`), and an older build reading a new one reads slot 0's ids as it reads its own (they are the same numbers) and drops every other slot's.
- 2026-10-09 — **`file:open` and `file:admit` answer `{ files, refused }`** (`AdmitResult`): a file main turns down for a reason `validate` gives — over 600 MB, empty, not IFC, ifcXML — gets the drop zone's designed row on every route: the Open dialog, a Recent pill, a link (whose banner then names only files that moved). "Not an IFC file" — and anything else that is not a `.ifc` / `.ifczip` — is told only to the Open dialog; for a path the renderer names, `inspect` stops before `stat`, as it always did. A refusal carries a name and a reason, never a size or a path.
- 2026-10-09 — **the size refusal is `larger than 600 MB — consider splitting it into several models`** (owner-requested): one constant, `TOO_LARGE` (`shared/upload.ts`), which `validate` returns on every route and both of `.ifczip`'s size refusals end with; the design's words first, and the stage line wraps as designed, so no style string and no `title` was added.
- 2026-10-09 — **the parse worker knows an `.ifczip` by its first four bytes as well as by its name** (`isZipArchive`, `isIfczip`, `worker/ifczip.ts`: `PK\x03\x04`, or `PK\x05\x06` for an empty archive): from the Open dialog, a Recent pill or a share link it is handed a `Blob` named by the model key (`worker-bridge.ts`), so an archive taken those ways went whole to web-ifc and never opened — a valid 1.5 kB one took the renderer to 4.2 GB before web-ifc aborted, one declaring a 700 MB entry 4.1 GB. `meta.fileName` is unchanged.

A new decision is recorded as **one line here and a full row in `docs/DECISIONS.md`**.

---

## Commands

| Command | What it does |
|---|---|
| ~~`npm run dev`~~ | **Suspended since 2026-09-17.** It starts an unguarded Electron window, which is how this Mac was kernel-panicked three times. Use `safe-run.cjs` below. |
| `npm run build` | Typecheck, then build into `out/` |
| `npm run typecheck` | `tsc --noEmit` for the node and web projects |
| `npm test` | vitest (unit + read-only guard) |
| `npm run test:e2e` | Electron smoke test through `scripts/safe-e2e.cjs` (the guarded wrapper — **never** a bare `npx playwright test`). Runs on Windows too: same limits, working set + the GPU dedicated-memory counter instead of `phys_footprint` |
| `npm run dist:mac` / `dist:win` | Installers. `dist:mac` writes `dist/SGVue-<version>-arm64.dmg` and `dist/SGVue-<version>-x64.dmg`; `dist:win` writes `dist/SGVue-<version>-setup.exe` (`<version>` is `package.json`'s). The DMGs ad-hoc signed (since 2026-10-05), the installer unsigned. Before `dist:mac`, run `node node_modules/electron/install.js` — Electron 44.3.0 has no install script, and without its binary the Mac build lacks Electron's and Chromium's notice files |
| **`npm run test:packaged`** | The **packaged** app — `dist/mac-arm64/SGVue.app` on macOS, `dist/win-unpacked` on Windows — through `scripts/safe-app.cjs`: a share link, the production CSP, the unpacked `.wasm`, Preferences from the real menu. Skips when there is no `dist/`; the `.icns` test is macOS-only |
| **`node scripts/safe-app.cjs -- <executable> [args]`** | **The only sanctioned way to start a *packaged* SGVue.** Same limits as the other guards, matched on `/SGVue.app/Contents/` as well as `node_modules/electron/dist/`, and it kills every `SGVue Helper (…)` afterwards. On Windows it matches on the directory instead — `dist\win-unpacked\`, `node_modules\electron\dist\`, and the directory of a `-- <executable>.exe` so an installed copy is guarded too — reads working set plus the GPU dedicated-memory counter, and kills with `taskkill /T /F`. With no `--` it runs the packaged Playwright spec |
| **`node scripts/safe-run.cjs <script.cjs> [args]`** | **The only sanctioned way to start Electron here.** Refuses to start a second dev Electron, runs the target in the foreground under the memory guard, kills any survivor afterwards and says whether it had to — on Windows too, through PowerShell and `taskkill` rather than `/bin/ps` and `kill -9`. On both platforms a listing that could not be made refuses the run outright rather than start blind, and one at the end prints `COULD NOT LIST` rather than `clean:`. Limits: `SGVUE_MAX_GPU_MB` (2 500), `SGVUE_MAX_RENDERER_MB` (6 000), `SGVUE_MAX_SECONDS` (25) |

Everything else — the frame profiler, the pick-parity and frame-trigger checks, the benchmark,
the parity harnesses, the AI acceptance run, the fixture and icon generators, `npm run preview`
— is in **`docs/COMMANDS.md`**.

---

## Phase status

All ten phases are built: parser and federation, renderer, shell and sidebar, selection,
visibility and the filter stack, annotation, colour systems, landing and sessions, the
assistant, and the robustness / accessibility / performance / packaging pass. `PROGRESS.md`
is the history, and `docs/SYSTEM_SPEC.md` §11 is what is still owed before a public release.

---

## Rules

- **Viewer only. Never write model data.** No IFC write path, no "save model", no tool that
  edits a name, property, classification or geometry. `src/shared/readonly-list.ts` holds the
  forbidden names and `tests/readonly-guard.test.ts` fails the build if one appears.
- **Only three modules may write to disk**: `src/main/settings.ts`, `src/main/sessions.ts` and,
  since 2026-09-25 (Schedules phase 4, owner-approved), `src/main/exports.ts` — which writes
  only to a path the user picked in the native Save dialog in the same call. No designed
  control of the main window produces a file (its panel's `copy csv` writes the clipboard); the
  Schedules window's Export menu does — and, since 2026-09-28, the assistant's
  `export_schedule` can open that menu's Save dialog, where only the user's Save writes. Adding
  a fourth writer is a design change, not a convenience.
- **Every implementation task goes to the `builder` agent**, one phase or half-phase per run,
  ending in a Build Report.
- **The reviewer commits**, after reviewing the report against the diff and against the design.
  The builder never commits.
- **The public repository, `sgvue/sgvue`, is the source of truth, and every push is public at
  once.** Commit only as the project's public commit identity, `Yong Yen
  <releases@sgvue.invalid>`. Before every push, run the privacy search over what is pushed: no
  personal account, e-mail address, home path or real project may appear, and the owner appears
  only as Yong Yen. Installers are still published on `sgvue/releases`.
- **`samples/` is git-ignored.** Real project models never enter the repository. So is
  **`tests/fixtures/*.expected.json`**: the IfcOpenShell ground truth is generated *from*
  those models and carries their metadata. Regenerate it with
  `python3 scripts/expected-from-ifcopenshell.py`; the fixture tests skip with a visible
  notice when either is missing.
- **Real project coordinates never enter the repository.** Tests and docs use the synthetic, whole-metre-shifted set
  (site `12345.457 / 23456.766 / 5.05`, rotation `−43.4103°`). Never paste a value read from `samples/` into a tracked file;
  the history was rewritten once for this on 2026-09-20 (`docs/DECISIONS.md` has the note).
- **`design-reference/` is read-only.** It is the specification; never edit it to match the code.
- **Never start Electron except through a guard**: `node scripts/safe-run.cjs` for a dev
  Electron, `npm run test:e2e` (`scripts/safe-e2e.cjs`) for Playwright, and
  `node scripts/safe-app.cjs` for the **packaged** app. Not `npm run dev`, not `npx electron …`,
  never in the background, never two at once. Three kernel panics on 2026-09-17 came from an
  unguarded dev window; the guard inside every run watches the GPU helper's `phys_footprint`
  every 250 ms and exits the process group the moment it is over budget. A guarded run kills
  only what it started, so a packaged SGVue the user already had open is left alone. If a guard
  trips: stop, record the numbers, change the code — do not re-run the same configuration.
  Confirm nothing survived afterwards
  (`ps -Ao pid=,comm= | grep node_modules/electron/dist/`; on Windows
  `powershell -NoProfile -Command "Get-Process -Name SGVue,electron -ErrorAction SilentlyContinue | Select Id,Path"`).
  **On Windows the three wrappers read working set and the GPU dedicated-memory counter, and
  there is no memory-pressure term** — `phys_footprint` does not exist there.

---

## Traps

One line each. **Read `docs/TRAPS.md` before touching `src/worker/` or
`src/renderer/viewer/`** — every one of these was a real defect, and each cost a day.

**Geometry and units**

- `flatTransformation` already applies the length unit and the Z-up → Y-up swap; doing either again shrinks the model.
- `rotation.x = -π/2` double-rotates and lays the building on its side. Same trap, second project.
- Always `.slice()` `GetVertexArray` / `GetIndexArray` — they are views into the WASM heap.
- `IfcSpace` is excluded from `StreamAllMeshes`; stream it with `StreamAllMeshesWithTypes`.
- A stream callback's `FlatMesh` has no `delete` in 0.0.77 — free `mesh.geometries`, one vector per product.
- Surface-style transparency is not in the placed colour's alpha; walk `IfcStyledItem` or every window is opaque.
- Never `COORDINATE_TO_ORIGIN: true` in a federation — it recentres each model and loses the offsets between them.
- Revit shared coordinates sit ~33 km out, where float32 resolves ~4 mm. Subtract a shared origin in Float64.
- Grid points need `placementMatrix()` applied by hand, and a grid axis is a segment, not a coordinate.
- A Revit "Shared Coordinates" export puts the true-north rotation and the elevation on `IfcSite.ObjectPlacement`, not `IfcMapConversion`; its other Coordinate Base options put the position in `IfcMapConversion` (with an EPSG code) or the context's `WorldCoordinateSystem`.
- `IfcMapConversion.Scale` is written absent, 0.001 or 1000 for the same mm model in a metre CRS — never apply it; E / N / H × the map unit.
- Take the `IfcMapConversion` on the 3D `Model` context (a sub-context counts, by its `ParentContext`), not the first one in the file.
- web-ifc 0.0.77 applies the context's `WorldCoordinateSystem` to nothing — neither its move nor its turn; Revit puts the map position there with no EPSG code, so `mapPlacement` applies it once.
- A file can hold many `IfcSite`s — 16 on the reference model. Only the one `IfcProject` aggregates is the position.
- The federation offset's Z is the first placement's, not the datum — never read scene z = 0 as the ground.

**Properties**

- `getPropertySets(…, includeTypeProperties=true)` REPLACES rather than adds; fetch both and merge, occurrence wins.
- Use shallow `GetLine` with manual reference resolution — `GetLine(id, true)` throws on real Revit exports.
- Never index properties with a per-element `getPropertySets` loop: O(N×M), ~3.1 billion visits, a permanent freeze.
- Free `GetLineIDsWithType` vectors in a `finally`.
- `GetTypeCodeFromName` hashes anything; round-trip through `GetNameFromTypeCode` and treat unknown as absent.
- Numeric attributes have no own `value` key — `.value` is a prototype getter, and `name` is the measure type.
- A reference handle and an enumeration look alike; only `type === REF` separates a pointer from an authored value.
- `OpenModelFromCallback` does not read the file in order — hash forward independently, trimming overlaps.
- Storey `Elevation` is in the file's own length unit; read `IfcUnitAssignment` and convert.
- Never use `getSpatialStructure` — walk `IfcRelAggregates` and `IfcRelContainedInSpatialStructure`.

**Streaming, workers and progress**

- The stream callback's `index` / `total` restart at every IFC type; count products up front instead.
- Two uploads in flight leak a worker — hold the handle locally and compare by identity before clearing it.
- Every parse stage should finish with a real value, not a percentage. Geometry is ~55 % of the wall clock.
- Parsing belongs in a worker: a synchronous `StreamAllMeshes` froze Aquila's tab for 4.7 s.
- Only a drop gives the worker the file's name; any other route hands it a `Blob` named by the model key. Never branch on the extension there.

**Rendering at real sizes**

- One mesh per product does not survive a real model — ~26 500 draw calls at ~12 fps.
- Never pick with `Mesh.raycast` (222 ms a hover); filter by element box first, and cut *inside* the walk.
- Nothing may be sized to the demo model: clip, zoom, fog, shadow frustum and ladder all come from the bbox.
- Deleting a model must remap element ids everywhere; ids come from a free-slot search, never `models.length`.
- A federation id must not overflow its stride — the design's 1 000 000 was a 60 MB file; compose ids only through `fedId`, which refuses rather than collides.
- Dispose discipline — seed the "still in use" set, or a shared geometry a later load needs is disposed.

**three.js 0.186 (the version we pin), against the design's r170**

- A `BatchedMesh` is one *driver* draw per visible instance on both backends; it kernel-panicked this Mac three times.
- `WebGLBackend.draw()` has its `info` parameter commented out, so `renderer.info.render.drawCalls` can read 0.
- `maskNode` is the supported per-fragment discard and it reaches the shadow pass; `opacityNode` does not.
- `batchColor` applies only on a `BatchedMesh` — a plain `Mesh` must supply its own `colorNode`.
- An interpolated vertex attribute used as an index must be rounded, not truncated: `int(a + 0.5)`.
- A `DoubleSide` *transparent* material is rendered twice, and the shadow pass copies `transparent` from it.
- `material.depthNode` renders the scene black under an orthographic camera.
- `HemisphereLightNode` changed frames between r170 and 0.186 (`normalView` → `normalWorld`).
- `PCFSoftShadowMap` was removed; both backends warn and fall back to `PCFShadowMap`.
- `BatchedMesh.sortObjects` and `perObjectFrustumCulled` walk every instance every frame.
- The per-part state texture is in the renderer's *working* colour space; convert an sRGB file colour before writing.
- A `DataTexture` whose dimensions change must be `dispose()`d before re-upload — keep the same `Texture` object.
- An object kept after its geometry is disposed must be `dispose()`d too — its render state holds the vertex buffers.
- A double-sided transparent's back-face pass draws before the whole transparent list; blend "before glass" from the opaque list (`CustomBlending`).
