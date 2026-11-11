# SGVue Desktop — allowed desktop deviations

> **What this file is:** the complete list of record of where SGVue's desktop port differs,
> visibly, from the design (`design-reference/design/SGVue.dc.html` and `viewer-core.js`).
> **Anything not on this list is a defect.** Read it before changing anything visible.
>
> It was moved out of `CLAUDE.md` unchanged on 2026-11-12, because `CLAUDE.md` is loaded into
> every agent session; the original is in git history at `cdd8256:CLAUDE.md`. `CLAUDE.md` keeps
> one pointer line per entry.
>
> **A new deviation** is added here — dated, with the owner's own words — plus a full row in
> [`docs/DECISIONS.md`](DECISIONS.md) and a one-line pointer in `CLAUDE.md`.

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
  stop showing what the file said" cannot happen; the caption names the boot file's method.)* *(Amended 2026-11-07: the method of the file the card shows — the loaded model with the most elements that states georeferencing, ties by key, whatever the order; the 2026-11-07 entry.)*
- **2026-09-20 — a grid bubble that would overprint its neighbour is not drawn, and comes back
  as the view zooms in.** Asked for by the user; the design's nine well-spaced axes needed no
  rule. Hidden through the same path an occluded bubble takes — no new element, no new class.
- **2026-09-20 — above six storeys the element tree keeps 40 % of the sidebar's height, and the
  STOREYS and MODELS lists scroll inside themselves.** The user's own rule, for the case where
  twelve storeys left the tree one row tall. At six or fewer, every style string is the design's.
  *(Amended 2026-11-07: MODELS no longer scrolls — it is collapsible and, expanded, always full;
  when that does not fit, the tree's 40 % gives way to three rows and the column under the
  MODELS header scrolls — below.)*
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
  *(Amended 2026-11-07: the MODELS↔STOREYS handle is gone — MODELS is collapsible instead,
  below. The STOREYS↔ELEMENTS handle is unchanged; with no second list to pin, its drag sizes
  STOREYS alone, and the tree's floor is then three rows at any storey count.)*
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
  dimensions. *(Amended 2026-11-07: the extent, the bubbles' rows and the grid dimensions are taken in the plan frame, square with the grids — the 2026-11-07 entry.)*
- **2026-09-24 — a toolbar button toggles the canvas (ground) grid.** Asked for by the user in
  these words: *"Add an option to toggle off canvas gridline."* One new control, the only one:
  a button right after Levels, the neighbours' markup, class and on/off colours,
  `data-tip="canvas grid"`, a framed 3 × 3 grid glyph in the toolbar's stroke. It shows or hides
  the fine ground `GridHelper` — not the IFC grids. *(Amended 2026-10-08: and the ground veil
  with it — below.)* On by default *(off since 2026-11-07 — below)*; not saved in a session.
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
  beside Save and ifcTable's own `Export…` on each saved row *(amended 2026-11-08: in the
  Templates library, its head's Import and each template's Export — below)*. Files go through the OS's native
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
  Filter, Sorting and Format tabs *(since 2026-11-08 its view-bar chips and column menus — below)*
  and its calculated-value editor set (`make_schedule`: any-rule
  or every-rule filtering, itemise, a column hidden, aligned, given decimals and a unit, and put
  in its place, calculated columns), acts in the main window on the elements its rows list
  (`schedule: true`), and works its own controls (`manage_schedules`): undo and redo, a template
  from the gallery, and My templates *(since 2026-11-08 the one Templates library — below)* —
  list, load, save, rename, duplicate — each the control's
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
  cannot be brought back.` *(Amended 2026-11-08: a save or a duplicate at the hundred is refused,
  for the user and the assistant alike, and forgets nothing, so the second question is gone and a
  duplicate never asks; the save over the setup the schedule was loaded from still does.)*
  **The two differences:** a question raised for the assistant
  carries `Ask Vee` as the card's small label, where one the user's own click raised reads
  `Schedules` — so that a dialog nobody in this window clicked for says who is asking — and it
  **takes no default button**: the focus is on the card itself, not on Delete, Save, Duplicate
  or Print…, so a key press already under way answers nothing (Tab reaches Cancel first, Escape
  cancels; the user's own confirms keep the focus on their confirm button). No new
  element, no new control; nothing visible changes in the main window.
  *(Amended 2026-11-08 — SGVue 1.5.0, ifcTable's table-first interface. Asked for by the owner in
  these words: *"Refer to my private github ifcTable. I have updated the majority of the UI layers
  for better user experience. Please help me wire them in the sgvue as v1.5.0"* — and, of the
  window's floor, *"Yes, 780 px"*. In the Schedules window only: **the right-hand inspector is
  gone** — its five tabs (Fields, Filter, Sort, Format, Style), its resize grip and the field
  browser; a column's settings open from its heading in one popover (a plain click, Enter or
  Space; Left / Right move between headings; the right-click and Shift+F10 heading menu is
  unchanged), what the schedule does reads as chips at the top of the centre column (filters as
  sentences with what each removes, sort and group levels, Rows, Style), fields are added from a
  search-first picker (`+ Column`, the fields chip), and the calculated-value editor is a modal of
  its own. **One Templates library** — a modal in the window's own card, opened from the header,
  the rail or `T`, sections Mine · Built-in · IFC-SG, a search, sortable columns and a preview
  pane — replaces the template gallery and My templates; its Import adds a `.schedule.json` to
  Mine and no longer replaces the open schedule; at a hundred saved setups a save or a duplicate
  is refused (`Saved templates are full (100). Delete one to make room.`). **ifcTable's icon set**,
  drawn in `app/icons.tsx`'s stroke idiom (24-unit box, 1.7 stroke, the main window's own path
  where it has the glyph). **The window's minimum width is 780 px** (was 560). Every visual
  decision is still SGVue's — its tokens, type, radii, hover classes, the main `ContextMenu`'s
  look for menu items, the window's own dialog and toast; two-way selection, the row and heading
  menus, the legend squares, the `Model` column, Export, Print, undo / redo and the assistant's
  port are kept. **Nothing is added to the main window.** The full record is in
  `docs/DECISIONS.md`, 2026-11-08.)*
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
  900 mm below and behind it: `Z 110.000` → `110.900`, `M2 Y 9 025 · Z 2 700` → `8 865 · 1 800`. *(Amended 2026-11-07: the level is the file's own world z in both cases, since readouts print world coordinates.)*
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
  *(Amended 2026-11-07: each model's outline is drawn in its MODELS row's colour, the accent
  only as a fallback — below.)*
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
  *(Amended 2026-11-08: on the whole MODELS row, not the name block; the library popover is gone — below.)*
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
  (`notLinedUp`). *(Amended 2026-11-07: it now names a model whose own map position is more than 1 m or 0.1° from where its file coordinates put it; the old two reasons are retired — the 2026-11-07 entry.)*
- **2026-10-08 — the Coordinate-system card is read-only.** Asked for by the owner in these
  words: *"Maybe just make the coordinates system toggle a read only, dont let user change
  anything."* The four fields keep their element, class and style string and are `readOnly`:
  they still take focus and a selection, so a value can be copied. Nothing in the app changes the
  base point: the store's `setCoord` and the fields' `onChange` are gone, and so are
  `request_user_action`'s `set_base_point` and the reply revert's `basePoint`; a session's, a
  link's or a viewpoint's stored `coords` is ignored on restore (still written, for older
  builds). The base point is the boot file's — P read off `bootGeoref`, the declaration that
  defined the frame, kept in the store with it — so it, the chips and the caption stay right after
  any unload. The status bar's chip no longer shows the design's `SVY21` for a typed base point. *(Amended 2026-11-07: the base point is that of the file `georefSourceOf` picks — most elements, ties by key — written in `commitModels`, and the status bar's chip is that file's CRS.)*
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
  (`tests/parity/phase6/README.md`); the numbers are in `docs/DECISIONS.md`. *(Amended 2026-11-07: X and Y fire along the plan axes, square with the grids.)*
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
- **2026-10-09 — the landing page says, in one line, that georeferencing is taken from the first
  model opened.** Asked for by the owner in these words: *"Also add message saying the geo
  referencing will take reference from 1st model on upload page."* Under the drop zone and its
  upload rows, before the "or" divider: `Georeferencing is taken from the first model you open:
  its base point and north are the reference, and the other models are placed relative to it.`
  (`GEOREF_NOTE`, `shared/upload.ts`) — what `federationFrame` does: the first model's base point
  is the one the Coordinate-system card shows and its north the one the compass shows. A
  `<span data-role="georef-note">` in the drop zone caption's own style string
  (`font:400 12px/1.4 var(--mono);color:var(--faint)`, the `.ifc · .ifcxml · .ifczip` line's);
  **one new element, no control, no icon, no new style string.** **Measured** (`#mock&landing`,
  the design's four sample pills, both themes alike): the note is 620 × 33.59 px, two lines; the
  centred column grows by 55.59 px, so at 1280 × 820 what is above the note stands 27.8 px higher
  and what is below 27.8 px lower, every element keeping its size; where the column then outgrows
  the window the page scrolls, as designed, the column 4 px left beside the scrollbar — at the
  default window (1264 × 755) by 22 px (it fitted exactly before), and with the update notice by
  24 px at 1280 × 820 (fitted before) and 89 px at 1264 × 755 (34 before). The default viewer is
  byte-identical to the build before, in both themes. *(Removed 2026-11-07: nothing depends on the first model any more; the note and its span are gone.)*
- **2026-11-07 — the IFC gridlines and the canvas grid are off when the app starts.** Asked for
  by the owner in these words: *"Make gridlines and canvas off by default."* Amends 2026-09-24's
  canvas-grid entry and the design's own default of gridlines on. The two toolbar buttons,
  Gridlines and `canvas grid`, keep their markup, tips, handlers and on / off colours; only where
  they start changes. With the canvas grid off the ground veil is not drawn (2026-10-08), so at
  boot what is below grade is seen at full contrast from above. A session, share link or
  viewpoint that stores `grids` still restores what it stored; `groundGrid` is still not saved.
  The defaults are one list, `DISPLAY_DEFAULTS` (`shared/ai-schema.ts`), which the store reads
  and the assistant's sparse view state compares against. **No new element and no new control.**
  Not yet measured in a window; parity captures now need both switched on to match the design.
- **2026-11-07 — Ask Vee is a window of its own, above the SGVue window.** Asked for by the owner
  in these words: *"Also bring vee out as a separate window and always on top of our app window.
  because when the vee panel and properties panel show up together, they blocked my model
  view."* The chat panel is a child window of the main window (`parent`): it stays above SGVue
  and not above other apps, and on macOS it moves with it. OS chrome, the title `Ask Vee`,
  resizable, it opens at the panel's 330 × 420 where the panel stood, in the current theme (no
  flash), and comes back where it was left for the run only. The pill, "Ask about this" and the
  dev harness open it; the pill, × or Esc (when focus is not in a text field) close it; closing
  it stops nothing. Every style string of the panel is the design's except its placement: it
  fills the window, so its position, size, border, radius, shadow, fade-in and resize corner are
  the OS window's. The conversation still runs in the main window; the window is its view, over
  a private port (`shared/vee-messages.ts`). Apply is still only the Apply click, for the request
  the row showed, and a copy is made in the window that was clicked. The main window's 3D view,
  property card, legend and bottom row are unchanged. **No new element and no new control.** The
  mascots' "no two blink together" now holds within each window. Not yet seen in a window: the
  e2e specs that drive it and the parity harness's chat states are owed. *(Amended 2026-11-08:
  the window's contents are a messaging conversation — the entry of that date, below.)*
- **2026-11-07 — the sidebar's MODELS section folds behind its header, and expanded it is
  always its full height.** Asked for by the owner in these words: *"I think the left panel
  model management are quite messy, make it collapsible instead, but when expand always show
  full."* Our reading, which the owner may still correct: the MODELS header is the section's
  toggle, and "instead" replaces the 2026-09-24 handle under it. **Added — one control:** the
  header's `Models` label is now a `<button>` (`aria-expanded`, `aria-controls` the rows, Enter /
  Space) holding the label and, after it, the element tree's own `GroupChevron` with the group
  row's rule (`disclosure`: a quarter turn and `--accent-ink` open, `--faint` closed, `.15s`);
  the label keeps its x, and the chip, the rule and `upload` keep their markup and
  handlers and do not toggle. Expanded by default; session-only, in no session, link or
  viewpoint, and not an assistant tool. **Collapsed**, only the header shows: the model rows,
  the upload rows, the palette, the unload strip and Original materials
  are the section, and collapsing puts the palette and the unload strip away; a new
  upload row and the unload strip (the assistant's `unload_model` too) expand it. *(Amended
  2026-11-08: the library popover is not in the port — below.)* **Removed:**
  the MODELS↔STOREYS handle and the models rows' >6-storey scroll tail. **Unchanged:** the
  STOREYS↔ELEMENTS handle, the >6-storey rule for STOREYS, and every other style string while
  the sidebar fits. **When it
  does not fit** — full MODELS rows, STOREYS at its floor and the tree at its floor over the
  aside's height — the tree's floor becomes the height it prefers and gives way to three rows,
  and only then does everything under the MODELS header scroll as one column; the header,
  search and project block stay put. That column is the one new element besides the control;
  while the sidebar fits it is `display:contents` and lays out nothing. The numbers are in
  `docs/DECISIONS.md`.
- **2026-11-07 — each model's section-cut outline is drawn in the colour its MODELS row shows.**
  Asked for by the owner in these words: *"Update the section cut lines color on the different
  models to match with the color code assigned to the model."* 2026-09-28's outline was the
  theme's accent; each segment is now the swatch of the model its element belongs to — the
  user's override, else the library entry's swatch, else the slot's colour from the design's
  model palette (`MC`), one rule (`rowSwatch`) for the row and the cut — whichever way "Original
  materials" is set, as the row is. The accent is only the fallback for a model the viewer has
  no colour for (a replacement still streaming in under its own label). **Unchanged:** the
  2.5 px width, the depth test and its bias, what is outlined, the two-plane trimming, the clip,
  the cap colour, the plane outline, the preview sheet, and one mesh in one draw. **No new
  element, no new control.** On the dev mock the cut is ARC `#D8D2C6`, STR `#9AA5A3`, SIT
  `#8FAE82`, MEP `#8FA3B5` (its library swatches); the production demo building, never in the
  library, takes `MC[slot]` — its STR `#35C4B6` is the dark theme's accent. **Not yet measured
  visually**: no window was opened, and the parity capture waits for the owner's yes.
  *(Amended the same day: a model whose row shows the neutral grey `MC[0]` — no override, no
  library swatch, and its slot on the palette's grey; a single real file's row, the demo's ARC —
  has no colour of its own, and its outline is the theme's accent, which follows the theme. The
  owner, asked whether such a model should keep the accent: *"Yes, keep accent"*. A colour the
  user picked, the grey included, and any other palette or library colour stay the model's
  (`cutSwatch`). In the dark theme the demo's ARC and STR are then cut in one colour.)*

- **2026-11-07 — models line up origin to origin, and only the camera turns to square the grids.**
  The owner: *"I think we can leave geo referenced, and only focus on the internal origin of the
  model like how Naviswork do"* → *"go with your recommendation. Any solution for the side effect?
  I dont want my gridlines to be place diagonally relative to my building."* Every model is drawn
  at its file's own world coordinates (IfcSite placement included); no map conversion,
  `WorldCoordinateSystem` or `TrueNorth` moves or turns a model, and nothing visible depends on
  load order. Coordinate readouts print those world coordinates; the compass points at world +Y.
  The Coordinate-system card shows the georeferencing of the loaded model with the most elements
  that states one (ties by key), and its note reads `X's map position is 26.5 km from where its
  file places it — ask for a Shared Coordinates export.` (or `… is turned 30.0° from how …`, or
  the several-models line), past 1 m or 0.1°. The landing page's georeferencing line is gone.
  **The plan rotation:** the camera's plan frame stands at the grids' own dominant direction, so
  Plan, the six views, the view cube, the framing box, the grid extent and bubbles, the level
  rings, the ground grid and the laser's X / Y are square with the grids, and the compass shows
  turned against the cube. **No new element and no new control.** Not yet measured in a window.

- **2026-11-07 — File › Open Project…, Save Project and Save Project As…; the window title names
  the open project and marks unsaved changes; closing or quitting asks.** Owner-approved with the
  project-file plan (D8), in these words: *"Approve the recommended defaults for both plans. go
  with .sgvue"*. Three native menu items at the top of the File menu: Open Project… (the native
  Open dialog, filtered to `.sgvue`), Save Project (⌘S / Ctrl+S — the open project with no dialog,
  else the native Save dialog) and Save Project As… (⇧⌘S / Ctrl+Shift+S). While a project is open
  the OS window title is `<project name> — SGVue`, with ` •` after the name while there are changes
  since it was opened or saved; on macOS the window also carries the platform's own marks — the
  title bar's proxy icon and the close button's dot — cleared when the project goes. Closing the
  window, quitting, or opening another project with unsaved changes asks in a native message box:
  `Do you want to save the changes you made to "<name>"?` · `Your changes will be lost if you don't
  save them.` · **Save** · **Don't Save** · **Cancel**. If Save is chosen there and there is nothing
  a project can write — its models still loading, no model with a file on screen — the native
  "Could not save project" box says why in one line and the window stays; with no model open at
  all, nothing is unsaved and the window closes. A save that fails says so in that box. A project's
  missing or changed models are named in the designed banner or error row. All of it is OS chrome,
  like the Open dialog; with no project open the title is the app's own and nothing asks. The
  page's `S` (snap) no longer fires with ⌘ or Ctrl held. **No designed surface changes, and no new
  element or control in the window.** Not yet seen in a window: `tests/e2e/project.spec.ts` waits
  for the owner's yes.
  *(Amended 2026-11-08 — phase 4, plan D3 and D4, owner-approved with the plan: "Open it anyway,
  warn once, re-apply by GlobalId, say how many items no longer matched" and "Open the rest, and
  say which are missing with a Locate… button (native Open dialog)". A model whose file changed
  since the project was saved opens anyway, restored by GlobalId; its designed error row says once
  `changed since the project was saved — N saved items no longer match` (`— 1 saved item no longer
  matches`; nothing appended when everything matches), and the project is unsaved until saved. A
  model for which no file was admitted gets a designed error row with **one new control**, a
  `Locate…` text button in the row's text column, no icon, an existing style string verbatim in
  each place — the landing page's upload list: "open all N as a federation →"'s
  (`align-self:flex-start;font:500 12px/1 var(--sans);color:var(--accent-ink);padding:2px 0`); the
  sidebar: the palette's `reset` (`SGVue.dc.html:121`, `font:500 11px/1 var(--sans);color:var(--accent-ink);padding:3px 2px;white-space:nowrap`).
  It opens the native Open dialog (`Locate "<name>"`, one `.ifc` / `.ifczip`); the pick goes
  through `admit()` and loads into the open project as that model — same id, key and label,
  references restored, unsaved. A pick already open, or already being located, loads nothing
  (`already open in this project`). When every model was missing, the first one located boots the
  viewer. A row dismissed with × loses its Locate… until the project is reopened. No other
  element was added.)*
  *(Amended 2026-11-08 — phase 5, plan D10, owner-approved with the plan: "register `.sgvue` in
  both installers (macOS `open-file`, Windows argv), and the drop zone also takes a `.sgvue`".
  Double-clicking a `.sgvue` in Finder or Explorer, dropping it on the Dock icon or naming it on
  the command line opens it as File › Open Project… opens a pick — the unsaved-changes question
  first — and a running SGVue's window comes forward. A `.sgvue` dropped on the window or on the
  designed drop zone opens the same way; the drop zone keeps its look and copy. A drop opens its
  first project alone; every other file in it gets the designed error row (`not opened — a project
  was dropped with it` · `not opened — one project opens at a time`), a `.sgvue` dragged from
  somewhere that is not a disk gets `not on disk — save it to a folder, then open it`, and a
  project on a network share is refused from a drop (`A project on a network share opens with File
  › Open Project… or a double-click, not by dropping it.`). A file that is not a `.sgvue` reads
  `Only an SGVue project file (.sgvue) opens this way.` The file type is `SGVue Project` with the
  app's own icon, registered per-user by the Windows installer and removed by a real uninstall.
  **No new element, no new control.** Not yet seen installed: the packaged checks wait for the
  owner's yes.)*

- **2026-11-08 — the sidebar's `library` control and its popover are not in the port, and a
  model's file path is the hover title of its whole MODELS row.** Asked for by the owner,
  testing 1.4.0, in these words: *"Add hover description on the model list and show the file
  path. … remove library, i dont think its useful."* **Removed:** the MODELS header's `·` and
  `library` button (`SGVue.dc.html:90`) and the popover of files not yet loaded (`:139–148`);
  `upload` keeps its markup, tip, handler and style string. The Recent pills, "open all N" and
  the assistant's `open_recent` are unchanged. **Moved:** 2026-10-01's native `title` with the
  file's full path, from the row's name block to the whole row; the row's buttons keep their
  own titles, and the unload strip and the palette under the row carry none. Still no title for
  a model with no file behind it (the demo building). **No new element, no new control, no
  style string changed.** Parity states `library-open` (phase 3) and `library-popover`
  (phase 8) are retired. Not yet seen in a window.
- **2026-11-08 — the Ask Vee window is a messaging conversation.** Asked for by the owner:
  *"I need the conversation window like texting in messaging"*; the owner chose direction C,
  "site group chat" (`prototypes/vee-messages/full/`, its `HANDOFF.md`, kept out of the repository
  and of `app.asar`). In the Ask Vee window only: a header — the 32 px Vee at two whole device
  pixels a cell, `Vee`, and a presence line (`no signal` after a failed turn, until the next one
  begins); a pinned board under it — what the main window's 3D view shows, counts only, whoever
  changed it; `You` on the right, with one tick (sent) or two (the turn's first stream event);
  Vee on the left as one bubble per block, then its cards (chips, storey rows, the result table
  with `copy csv`, the consent card); the time on the lead bubble; the 16 px avatar at the
  group's foot, only the newest moving; `reply` on a bubble quotes that one bubble, worked out in
  the main window; the pending row is a consent card — hazard tape (`--vis` `#F2C230`, light
  `#B88600`, used nowhere else), its label read as a question with the detail after its first
  ` — `, `Cancel`, and a confirm button naming the action (`Apply`, `Delete`, `Clear all`), never
  focused by itself; then the stub tears and a stamp lands (`APPLIED · 14:02`, `DELETED`,
  `CLEARED`, `CANCELLED` — also for a request the user's own work had overtaken — `REVERTED`)
  carrying the reply's one `Revert`, else `Revert` at the group's foot; stopped and failed turns
  are neutral system lines that never say "nothing changed" when a tool had acted, with
  `Try again` on a failed one while a model is open; a `New message` pill; a day line (`Today`,
  `Yesterday` or the date) over each day's first message; activity bars in the header while a
  turn runs; the board's view chip (`3D`, `Plan`, `N` …) and its isolated look (the eye struck
  through, the selection colours); a faint 4 % grid behind the thread; not-ready lines — no
  key wins (`Add your API key in Preferences to start.`, composer disabled at `.45`, no
  placeholder), no model (`Open a model and I'll take a look.`; no board, no suggestions; a
  question gets the line back and runs no turn); a not-ready line carries the day line and its
  time, as a first message does. **The trace's answer is the app's own** — the
  handoff (`design-reference/ask-vee/`) is the specification up to its Answer cue: while a turn
  runs Vee's bubble is typing dots, then a diary of every step shown with its live count over
  the element matrix; at the answer it folds into one dashed line (`✓ 412 read · 80 walls ·
  12 missing · 7s ›`, a dashed card) that reopens to its steps, and the reply's parts land ≤ 110 ms apart, all
  within 0.5 s, on the row they settle in — no re-layout. The status beside the name, the ticker
  bubble and the word-by-word reveal are gone. The selected storey row is pressed and ringed by
  a revision cloud; the storey-rows card is titled by the checked property in the file's spelling (its IFC terms coloured, their case kept inside the capitalised title); a fresh bubble pops
  once — none of the motion under reduced motion. The table card's `copy csv` flashes `copied` /
  `couldn’t copy` for 1 400 ms here (2026-10-02's "no flash" stands for the main window).
  **Removed:** the per-message `Vee` / `You` labels and the header's ×; `Ask Vee` is the OS
  window's title. **New controls:** `reply` on a bubble, `Try again`, the `New message` pill and
  the diary's fold toggle *(amended 2026-11-09: and a `New conversation` icon button in the header —
  at its right, the reply bar's icon-button size and hover, a pencil-on-square in the window's stroke
  style, `aria-label` and tip `New conversation`, disabled at `.45` while a turn runs; it starts the
  conversation again through `seedChat`, and what earlier replies did to the view stays; no confirm)*.
  The typed line lifts on a slant to the right. The OS window's minimum
  is 300 × 380. Styled by `.vm` classes in `styles/vee.css`; one inline string changed (the
  lift's type, 13px/1.42). The main window is unchanged but for Preferences telling the store
  whether a key is there. Not yet seen in a window: the e2e specs that drive it
  (`tests/e2e/vee-trace.spec.ts`, rewritten for this layout, and `vee-stage2.spec.ts`) and the
  `vm-*` captures in `scripts/screenshot.cjs`, one per prototype shot, are written and not run. *(Amended the same day — stage 2, owner-approved decisions B, C, D, HANDOFF §2,
  §7, §8: in the Ask Vee window only, three more pieces. **A heads-up line** — at most one a
  reply, after its answer and before its consent card, in `--warn-ink` with a 12 px outline
  sign, no control: the app's own observation over the elements the reply's last rule-bearing
  call touched — its matched set when its rules scope the whole model, and never a call that
  acts on ids, the selection or a schedule — placeholder values in the property it checked,
  listed or grouped by, elements on no storey, a shared GlobalId, and, only after the user answered Yes to IFC+SG, an
  ObjectType-only sub-type, which the app also adds by itself to the reply that answers the Yes,
  over what the asking turn read, when that reply has none of its own; drawn from a fixed template, its names mono and uncoloured, part of
  the reply's announcement, never quoted. **IFC terms** — a code span of Vee's text that is
  exactly a name the loaded models carry (class, PredefinedType / ObjectType value, set or
  property name, `Entity.SUBTYPE*`), never SGVue's own attribute names, is drawn in one colour,
  `--ifc-term` (`#859FF6`, light `#3B51BC`), mono 600 — bold since 2026-11-09, the owner: *"also bold it"*; a user's words never. **The IFC+SG
  question** — while a model carries an `SGPset_` set, and only once the turn has read by rule
  elements that carry one, Vee may ask once a conversation, through `ask_choice`: its
  one-sentence lead-in is a bubble of Vee's own, and the app's question, "Is this model for an
  IFC+SG submission?", stands apart from it as a dashed part of its own ("Question from SGVue")
  with app-drawn `Yes` / `No` quick replies (no tape, no card), keyboard-reachable and never
  focused by themselves; only the user's click answers it. **New controls:** the quick replies.
  Styled by `.vm` classes only; no inline string changed. Not yet seen in a window.)*

- **2026-11-11 — the right-click menu's "similar · …" items go by the element's type, and are not
  drawn for an element with neither a type nor an ObjectType.** Asked *"Should right-click
  'similar' match by the type name first, as other viewers do?"*, the owner: *"Yes, by type"*.
  `Hide similar · X`, `Isolate similar · X` and `Select similar · X` (`SGVue.dc.html:1898–1921`)
  keep their copy, order, keys and handlers; `X` and what they take is the type object's Name, the
  element's own ObjectType only when it has no type. With neither, the three items are absent —
  the design's mock never reaches that state — and the rule above `Select similar` stands above
  `Zoom to`. The mock has no type objects, so there every label and action is the design's. The
  property card's "Same ObjectType" row is unchanged and literal. **No new element, no new
  control.** Seen in a window on `reference.ifc` (2026-11-11): twelve items on a typed element,
  nine on one with neither, the rules in place.
- **2026-11-11 — an identity tile with no value shows the em dash.** Asked for by the owner in
  these words, looking at an element with no ObjectType: *"show a dash on the empty tile"*. The
  design's four tiles (`SGVue.dc.html:330–333`) draw `{{ sel.… }}` with nothing behind it, so a
  value the file does not carry was a label over a blank box. Each of the four — IfcEntity,
  PredefinedType, ObjectType, Level — now draws `—` for an empty value (`tileText`,
  `selectors/props.ts`), in the tile's own span and style string; a written value is never
  replaced, `NOTDEFINED` included. No tooltip on the dash; the card's values, "Same ObjectType",
  rules and the assistant keep the empty value. The design's mock states all four on every
  element, so its captures are unchanged. **No new element, no new control, no style string
  changed.** **Measured** in a window on `reference.ifc`: the ObjectType tile is 142 × 43.75 px
  with a written value and with the dash.
- **2026-11-11 — the Spatial-structure card's site line names the file's own coordinate system.**
  Found by the repo audit (its decision 7) and approved by the owner in these words: *"fix all
  the audit decisions 6 to 10"*. The design's site row ends in the literal `(SVY21)` whatever
  the file says. It now shows the CRS the Coordinate-system card's chip shows, as `(name)`, and
  no parenthesis when the file declares none; the design's mock, which passes no CRS, still
  reads `(SVY21)`. Same span, same style string. **No new element, no new control.** Not yet
  seen in a window.

- **2026-11-12 — a model picked after boot shows a federating indicator: a line along the stage's
  top edge and a caption in the bottom row.** Asked for by the owner in these words: *"create a
  new simple yet cool techy loading animation when model view is federating the new upload
  model."* Of three clickable prototypes (pixel chip, edge trace, scan frame) the owner chose
  *"B"* — Edge trace. Until now a model added to an open viewer showed its progress only in the
  sidebar's upload row, and the 3D view nothing but the centre badge during the join. **Two new
  elements, no new control**, DOM and CSS only (`app/FedTrace.tsx`). **The line**
  (`data-role="fedline"`): a child of the stage, 2 px high, `top:5px;left:5px;right:5px`,
  z-index 14, `aria-hidden`, no pointer events — clear of the visibility frame (3 px + 1 px), the
  toolbar (12 px) and the view cube (8 px). Five equal segments 2 px apart, one per stage of
  `STAGES`: pending `--border`; the current one a `--border-strong` track carrying the design's
  `ifcsweep` glint (25 % wide, 1.3 s), on that segment only and only while its stage runs; a
  finished one's `--accent` fill grows over 260 ms. It enters over 220 ms by opacity alone
  (`fedfade`, the one new keyframe, `styles/fed-trace.css`). Joined: every fill `--ok-ink`.
  Failed: the current segment `--warn-ink`, still. **The caption** (`data-role="fedcaption"`,
  `role="status"`): the top piece of the bottom row's centre zone, above the reset pill and the
  hint, in the status bar's own card, no pointer events. Loading: `<file> · <stage> · n/5`, the
  stage in the design's words; with two or more files in flight `N models` and the stage of the
  one furthest behind; a row that reads `ready` is `federating · 5/5`. Joined: the upload row's
  tick at 14 px and `+N elements` (`+1 element`) in `--ok-ink` — N how much the federation grew
  over the batch, grouped with thin spaces — or `joined` with no number when it did not grow (a
  replacement), plus ` · N could not open` in `--warn-ink` when some files of the batch failed.
  All failed: `could not open — see Models` in `--warn-ink`. Only the file name shrinks (22
  characters at most, then an ellipsis). **Only what the app knows:** never a percentage, never
  a count while parsing. **Timings:** joined holds 900 ms and failed 1 600 ms, then both pieces
  fade over 220 ms and are removed from the DOM; a cancel fades at once; a new pick during a
  hold or the fade restarts it. **It replaces the design's centre badge `Rebuilding federation…`
  only while it is up**; the boot's messages and a removal with no load in flight are as
  designed, and the landing page's first load never shows it. **Reduced motion:** every state a
  still, no glint, and each piece removed at the end of its hold with no fade. **With no load in
  flight both pieces are absent and every element and style string is what it was.** It reads the
  store's upload rows alone, starts no frame loop and never wakes the 3D view. **Seen in a window** (2026-11-12, `tests/e2e/fed-trace.spec.ts`, the built app, a model added
  with the sidebar's `upload` six times): the line is 2 px, 5 px inside the stage's top, left and
  right at every size tried; the caption is 27 px tall, its foot 14 px above the stage's, and
  258.62 px wide reading `high-first.ifc · reading file · 1/5`; every load showed `1/5` … `5/5`
  in order, never together with the centre badge, ended on `+N elements` with N the status
  bar's own growth, and both pieces were then removed. Neither piece met the toolbar, the view
  cube, the status bar, the Ask pill, a tool hint, the reset pill or the property card, nor took
  the pointer — at the default window, in both themes, at a stage 520 px wide (the caption
  centred above the bars) and with the hint, the pill and the card all showing (the caption
  above the pill). The first load showed nothing; an archive with no `.ifc` ended on `could not
  open — see Models`; under reduced motion no glint was drawn. The numbers are in
  `docs/DECISIONS.md`.

The three 2026-09-20 entries above are recorded in full — the arithmetic, the measurements and
what each cost in parity — in `docs/DECISIONS.md`, and so are 2026-09-21's, 2026-09-24's,
2026-09-25's (all three), 2026-09-28's, 2026-10-01's, 2026-10-02's, 2026-10-08's, 2026-10-09's,
2026-11-07's and 2026-11-12's.
