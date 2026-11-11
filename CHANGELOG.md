# Changelog

The notable changes in each version of SGVue. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Installers are published at
https://github.com/sgvue/releases/releases; from 1.2.0 the full notes of each version are in
[`docs/releases/`](docs/releases/).

## [Unreleased]

### Fixed

- **ObjectType shows the element's own ObjectType**, as other BIM viewers and IfcOpenShell do.
  It used to show the name of the element's type (a Revit "Family:Type") whenever the element
  had one. The type's name is still in the Schedules window's Family and Type columns.
  What works differently: an element with no ObjectType of its own now shows a dash (—) on the
  ObjectType tile, as any identity tile with no value does, and its tree row no longer carries
  the type's name; a saved filter, filter set or project
  rule on ObjectType that named a type's name now matches only elements whose own ObjectType is
  that text; the tree search no longer finds an element by its type's name; and the
  property card's "Same ObjectType" row, on an element with no ObjectType, counts every element
  with none. The right-click "similar" items go by the element's type, as before, by its
  ObjectType when it has no type, and are left out for an element with neither.

## [1.5.0] - 2026-11-08

### Added

- **The Schedules window is table-first**, after ifcTable's redesign: the table takes the whole
  window. Click a column heading for everything about that column — its heading text, total,
  decimals, unit, alignment, sorting, grouping, colour rules, filter, width, position, hide and
  remove; Left and Right move between headings. What the schedule does reads as chips above the
  table — each filter as a sentence with how many rows it removes, each sort and group level,
  Rows (itemise, grand total) and Style — and each chip opens its own small popover. Columns are
  added from a search-first field picker, from **+ Column** at the end of the headings or the
  fields chip, which shows how many elements carry each field.
- **One Templates library** (the header's templates button, the rail's **Templates library**, or
  `T`) holds the built-in templates and your own, under Mine · Built-in · IFC-SG, with a search,
  sortable columns and a preview of what the selected template gives on the models open — how
  many elements, which columns it finds and its first rows. Use, save, rename, duplicate,
  delete, export and import from one place.
- A new icon set in the Schedules window, from ifcTable, drawn in SGVue's stroke style.
- **Ask Vee reads like a conversation in a messaging app.** Your questions stand on the right
  with the time and a tick — two once Vee has picked the question up. Vee's answer stands on the
  left as one bubble per paragraph, list or table, then its cards: the storey rows, the result
  table and anything that waits for your OK. A header shows Vee and what it is doing — `on site`,
  `typing`, `on it`, `no signal` — and a line under it always shows what the 3D view shows now:
  how many elements are visible, what is selected and on which storey, what it is coloured by,
  and which view it is on. Each day starts with its date.
- **Reply to one bubble.** Point at a bubble or a card (or move the keyboard onto it) and click
  **reply**: your next question quotes that bubble, not the whole answer.
- **Try again.** When Vee could not be reached or could not answer, the line that says so offers
  **Try again**, which asks the same question once more without repeating it in the conversation.
- **A request that needs your OK is a card that says what it does.** It is marked with hazard
  tape, asks its question in plain words — with the detail under it — and its button names the
  action: **Apply**, **Delete** or **Clear all**, beside **Cancel**. It never takes the keyboard
  by itself. Once answered it keeps a stamp — `APPLIED · 14:02`, `DELETED`, `CLEARED`, `CANCELLED`
  or `REVERTED` — and the answer's **Revert** sits on it.
- **Ask Vee says when it is not ready.** With no API key: "Add your API key in Preferences to
  start.", and the box you type in is greyed out until a key is saved — no restart needed. With no
  model open: "Open a model and I'll take a look."
- **A new answer animation.** While Vee works you see typing dots, then a small diary: every step
  it takes — reading the models, narrowing them down, checking a property — each with its live
  count, over a field of dots that stand for the elements. When the answer arrives the diary folds
  into one line, such as `✓ 412 read · 80 walls · 12 missing · 7s`, which you can click to open
  again, and the answer's bubbles come in one after another, all within half a second. The storey
  row that matches what is selected in 3D is marked with a revision cloud.
- **A heads-up line.** Under some answers, in amber, SGVue points out something odd it saw in the
  elements Vee just looked at: a placeholder value such as `TBC` or `-` in the property it
  checked, elements on no storey, or a GlobalId shared by two elements — when one answer looks at
  the model several ways, the most telling of them, a placeholder in the property you asked about
  first. It is written by SGVue from what it read, never by Vee, and most answers have none.
- **IFC names in one colour.** When Vee names a class, a PredefinedType or ObjectType value, a
  property set or a property exactly as your models spell it — `IfcWall`, `FireRating` — it is
  shown in one colour and in bold, and so are the names in the diary's steps and in the storey
  rows' title, which use the file's own spelling — `Checking FireRating`, not "Fire Rating". Only
  an exact match of your files' spelling is coloured; a name your models do not carry stays
  plain.
- **The IFC+SG question.** When a model carries `SGPset_` property sets and you ask about the types
  or properties of elements that carry them, Vee answers and, in the same reply, asks once per
  conversation whether the model is for an IFC+SG submission, with **Yes** and **No** buttons.
  Yes: answers name each element's IFC+SG identity, such as `IfcDoor.DOOR*`. No: plain IFC terms.
  Vee never says whether a sub-type is valid or which parameters are required — the official
  IFC+SG mapping is not in SGVue — and only your click answers the question.
- A **New message** button appears when an answer arrives while you are scrolled up, and
  **copy csv** on a result table says `copied` or `couldn't copy`.
- **New conversation.** A button in the Ask Vee header starts the conversation again: the old
  messages and any request still waiting for your OK go, the IFC+SG question can be asked again,
  and Vee starts with nothing of the old conversation. What earlier answers did to the 3D view
  stays as it is. It is greyed out while Vee is working — Stop ends a turn.
- From the repository only: every Schedules cell of three synthetic models is checked against
  IfcOpenShell (`tests/unit/schedule/oracle.test.ts`, `scripts/make-edge-ifc.py`); the drawn
  table against the engine's rows, totals and filters against an independent oracle, and seeded
  simulations of the Schedules window and of the messages between the two windows.

### Changed

- The Schedules window's right-hand panel — its Fields, Filter, Sort, Format and Style tabs and
  the field browser — is gone; every control in it is in a column's menu, a chip above the
  table or the field picker. The calculated-value editor opens as a dialog of its own.
- The template gallery and **My templates** are replaced by the Templates library; your saved
  templates are its **Mine**.
- At 100 saved templates, a save or a duplicate is refused with "Saved templates are full (100).
  Delete one to make room." — the oldest is no longer dropped to make room.
- Importing a `.schedule.json` adds it to Mine; it no longer replaces the schedule on screen.
- A **between** filter with one box empty is open-ended — only "to" filled reads as at most,
  only "from" as at least — and with both empty it keeps every row.
- Values such as `-`, `—`, `n/a`, `none` or a blank count as no value where the Schedules window
  counts which elements carry a field.
- The Schedules window is at least 780 px wide (was 560).
- A part, a nested component or a door or window that only fills an opening, with no storey of
  its own, now stands on its host's storey and in its host's container, as IfcOpenShell reads
  it — in STOREYS, a storey's eye, Level rules, the element tree, the Schedules window and
  Ask Vee. Models where every element is placed on a storey directly, such as most Revit
  exports, are unchanged.
- In the Schedules window, a value in one of the file's derived units is shown in SI units, a
  mass in it counted in kilograms; the main window still shows it as the file writes it.
- In the Schedules window, Building, Site and Room / Space come from the element's own place
  in the spatial structure, so a wall placed in the building names it, and furniture placed in
  a room names the room.
- Questions that ask to tabulate — counts by storey, by type, by value — are answered with a table
  in the chat. Vee makes a schedule in the Schedules window only when you ask for one.
- Vee writes every count in digits, zero included: "**0** walls are missing a FireRating".
- **Sonnet 5.5 is the default model** (`claude-sonnet-5-5`). Existing installs move once from
  Opus 5 to the new default model; a model you choose later is kept.
- A follow-up keeps to what Vee just found: after "Which walls are missing a fire rating?",
  "Tabulate them by type" tabulates those walls, not every wall. Say "all the walls" for all.
- Vee uses a database query whenever you ask for "the database", "SQL" or "a query".
- A stopped or failed turn is a neutral line, such as "Stopped · nothing changed". It says
  "nothing changed" only when nothing did; otherwise "what it already did stays".
- In Ask Vee your messages are on the right, and the `Vee` / `You` labels above each message and
  the panel's own × are gone — the window's own close button and Esc close it. The status beside
  Vee's name and the answer appearing word by word are replaced by the diary and its folded line.
- The Ask Vee window is at least 300 × 380.
- When Vee makes a schedule for several classes and one of them is in no loaded model, it leaves
  that class out and says so. An interference check states the tolerance it used.

### Fixed

- A mass per length and a rotational mass in the Schedules window are no longer scaled as a
  length or a mass.
- A group footer or grand total whose first total is a hidden zero now shows its label on
  screen, as the Excel and CSV exports already did.
- Saving a template under a numbered name, or renaming the saved template on screen, no longer
  brings the old name back on Undo; a schedule changed by Ask Vee is always its own Undo step.
- When the Schedules window does not answer Ask Vee in time, Vee says it is not known whether
  the action happened, instead of saying it most likely did not.
- Paste (⌘V / Ctrl+V) and cut now work in text fields, including the API key box and the Ask Vee
  composer.
- ⌘C / Ctrl+C no longer switches to the spot tool.
- A reply of Vee's that asks the IFC+SG question no longer shows its opening sentence twice.
- A conversation that went on after its model schema changed — a model loaded mid-conversation —
  no longer fails on the newer models, which tie their reasoning to the conversation as it was.
- When the API hands an answer over to another model midway, the first model's unfinished tool
  calls are no longer run.
- A change that waits for your OK counts a single element as `1 element`, not `1 elements`.

### Security

- Excel exports write every cell as plain text or a number, so a value from a doctored
  template can never become a live formula or link in the workbook.
- A schedule's calculated columns are rebuilt from known fields wherever a schedule comes in —
  a `.schedule.json`, a saved template, a project file or Ask Vee — and anything else in them
  is dropped.

See [docs/releases/1.5.0.md](docs/releases/1.5.0.md).

## [1.4.0] - 2026-11-08

### Added

- **Project files (`.sgvue`).** File › Save Project (⌘S / Ctrl+S), Save Project As… and Open
  Project… save a coordination review — which IFC files are open and everything done on top of
  them: colours, hidden elements, sections, camera, viewpoints, filter sets, schedules, spots and
  measurements. The IFC files are referenced, never copied or changed. The window title shows the
  project and a `•` while there are unsaved changes, and quitting asks first.
- A model that changed since the project was saved opens anyway, with its saved items re-applied
  by GlobalId and a note of how many no longer match; a missing model gets **Locate…**.
- **Double-click a `.sgvue` to open it**, or drag it onto the SGVue window, the home page's drop
  zone or (macOS) the Dock icon. On Windows the installer registers the file type for your user
  only; if Windows asks which app opens `.sgvue`, pick SGVue, and the file icon may appear only
  after Explorer refreshes. On macOS, Finder learns the type once the app has been opened. A
  project on a network share opens by double-click or File › Open Project…, not by dragging it in.
- **Ask Vee opens in a window of its own**, kept above the SGVue window, so it no longer covers
  the model beside the property card. It can be moved and resized; it comes back where it was
  left until SGVue is closed.
- The sidebar's **MODELS** section folds away behind its header, and when open always shows every
  model. When the sidebar is too short for everything, the part under the MODELS header scrolls.
- From the repository only: more automatic checks on every push and before every release build —
  ESLint, the privacy search (`npm run privacy`), a synthetic reference model checked against
  IfcOpenShell, simulations of the review state and of federations opened in different orders, a
  corpus of links, sessions, viewpoints and schedule files saved by past versions, and a check
  that the design reference and the design's style strings are unchanged.

### Changed

- **Models line up origin to origin**, the way Navisworks does by default: every model is drawn
  at its own file's coordinates, and no map conversion, world coordinate system or true north
  moves or turns it. What you see no longer depends on which model was opened first. Export the
  models from the same coordinates (for example Revit's *Shared Coordinates*) to line them up.
- When a building's grids stand at an angle on the site, Plan, the six views, the view cube,
  the framing of the building, the grid bubbles, the level rings, the canvas grid and the laser
  meter's X and Y turn with them, so the gridlines are square on screen, not diagonal. Only the
  camera turns; no model moves.
- The Coordinate-system card shows the georeferencing of the loaded model with the most elements
  that states any, wherever it was opened in the list. Its one-line note now names a model whose
  map position is more than 1 m or 0.1° from where its file places it, and suggests a Shared
  Coordinates export.
- Spot coordinates and the other coordinate readouts show the files' own coordinates.
- A viewpoint, session or link saved with 1.3.0 whose first model was placed by its map conversion
  or world coordinate system restores everything but its camera.
- The home page's line saying that georeferencing is taken from the first model is gone.
- **The gridlines and the canvas grid are off when SGVue starts.** Turn them on from the toolbar.
  A session, link or viewpoint that stored the gridlines on still turns them on.
- Each model's **section-cut outline** is drawn in the colour its MODELS row shows; a model with
  no colour of its own is still cut in the accent colour.
- ⌘S / Ctrl+S saves the project; the `S` key turns snapping on and off only without ⌘ or Ctrl.
- Ask Vee says "Could not reach the API. Check the network." when it cannot connect.
- A model's full file path shows when hovering anywhere on its MODELS row, not only its name.
- Electron 44.10.0 and updated dependencies.

### Removed

- The sidebar's **library** button and its list of recent files; **upload** opens any file.

### Fixed

- The property card's PredefinedType no longer shows the ObjectType text for an element whose
  PredefinedType is `USERDEFINED`: it shows the code as the file writes it, and grouping and
  colouring use the effective type, as IfcOpenShell reads it.
- A model opened from a file now takes its library entry's colour in its MODELS row and its
  Spatial-structure card, where it showed the colour of its position in the list.
- When two files name a level differently or disagree about a grid, the gridlines, the section
  chips and STOREYS no longer depend on which file was opened first.
- Closing SGVue while another of its windows is open no longer can end in an
  "Object has been destroyed" error.
- From the repository only: four tests that assumed macOS-style paths pass on Windows.

### Security

- A gridline's name and a level's name from an IFC file are shown as text; a crafted file could
  put markup into a grid bubble or a level tag.
- Vee's database query stops at 500 000 characters of results and says so; a crafted query could
  build results large enough to crash SGVue before the existing limit applied.
- The chat's **copy csv** doubles quotes in a group's name and defuses a value starting with
  `=`, `+`, `@` or `-`, so a pasted value cannot become a spreadsheet formula — as the Schedules
  window's export already did.
- Dependency updates for 21 Dependabot alerts, Electron among them. Development tools only, not
  shipped: `minimatch` forced to 11 under ESLint and electron-builder, and `uuid` to 11 under
  exceljs.

See [docs/releases/1.4.0.md](docs/releases/1.4.0.md).

## [1.3.0] - 2026-10-09

### Added

- Feet: SGVue opens in the first model's own unit — millimetres, metres or feet — and the unit
  toggle gains **ft**, feet and inches to 1/16" for lengths and levels and decimal feet for
  coordinates. The lengths, levels and coordinates SGVue shows follow the toggle — the
  Coordinate-system card keeps the file's own map unit — and a session and a link remember it.
- The laser meter reads each side of the clicked point along each axis (`X 1 200 + 2 300`); the
  two sides add up to the whole.
- The Coordinate-system card says, in one line, which model could not be lined up with the
  others — no map position, or more than 5 km away.
- The home page says, under the drop zone, that georeferencing is taken from the first model
  opened: its base point and north are the reference, and the other models are placed
  relative to it.
- SGVue is open source, under the Apache License 2.0: `LICENSE`, `NOTICE`, and
  `THIRD_PARTY_NOTICES.md` — every third-party component the installers ship, with its licence,
  generated from the dependency tree and checked by `npm test`. All three are in every
  installer's resources folder.
- Documents for contributors: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `SUPPORT.md`, this changelog and `docs/RELEASING.md`; issue and pull-request templates.
- Continuous integration on Windows, macOS and Ubuntu, and a release workflow that builds the
  installers on GitHub with their SHA-256 checksums and build-provenance attestations.

### Changed

- Models are federated in map space: each file is placed by its own `IfcMapConversion`, its
  `WorldCoordinateSystem` or its site placement, so files exported with different coordinate
  settings line up. A map conversion's `Scale` is not applied, the map unit is respected, and
  true north is never applied twice.
- The Coordinate-system card is read-only: it shows the base point the first model's file
  states, in that file's own map unit. A base point stored in a session or a link is ignored.
- Ask Vee answers in paragraphs, lists and small tables instead of one sentence.
- With the canvas grid off, parts below ground are no longer dimmed.
- A file over 600 MB is refused with "larger than 600 MB — consider splitting it into several
  models".
- macOS builds are ad-hoc signed instead of unsigned, so a downloaded copy can be opened (after
  one **Open Anyway**) rather than being reported as damaged. They are not notarised yet. (The
  1.2.0 disk images, published after its Windows installer, were already built this way.)
- The Windows installer's entry in the installed-apps list links to https://sgvue.github.io/.

### Fixed

- Large models opened together no longer share element ids: with files over about 60–70 MB,
  elements were lost and Vee's database could not be built. Sessions, links and viewpoints of
  large files restore the elements that were hidden, those saved with 1.2.0 included.
- A file refused from the Open dialog, a Recent pill or a link says why, as a dropped file
  always did.
- A zipped IFC (`.ifczip`) opens from the Open dialog, a Recent pill and a link, not only from a
  drop.
- Area and volume totals in Vee's answers carry the file's own units, where they always read m²
  and m³.

### Removed

- Vee's request to change the base point (`request_user_action`'s `set_base_point`).
- From the repository only: the design tool's runtime and starter files, and the evaluation
  suite's HTML report builder, whose licences were never recorded. The design prototypes are
  read as source, and the evaluation writes its results as JSON.

See [docs/releases/1.3.0.md](docs/releases/1.3.0.md).

## [1.2.0] - 2026-10-02

- **Vee**: the assistant has a name, a pixel mascot and a visible thinking process, a stop
  button, and can do much more of what you can do — the camera, saved viewpoints, markups, the
  Schedules window — while anything that cannot be undone happens only when you click
  **Apply**. A reply's **revert** puts back everything that reply changed in the view.
- Two section cuts at once, along a gridline and at a level.
- A tidier window: toolbar groups, an action bar for undo and the markup counts, and a bottom
  edge whose pieces no longer overlap.
- The home page says when a newer version is out.
- Fixes: the canvas grid at the model's own zero level; *Copy link*, *Copy GlobalId* and
  *copy csv* really copy.

See [docs/releases/1.2.0.md](docs/releases/1.2.0.md).

## [1.1.0] - 2026-09-28

- **Schedules**: a window of Revit-style schedules linked to the 3D view, with export to Excel,
  CSV and a schedule file.
- The assistant finds properties by the names your files use, and builds, reads, exports and
  colours by schedules.
- Spot levels show just the level until clicked, and snapping ignores corners hidden behind the
  surface; everything a section cuts is outlined.
- On Windows, SGVue draws on the NVIDIA graphics card when there is one (first made as 1.0.3,
  which was not published on its own); Preferences can turn it off.
- An installer wizard that says whether it will install, update or repair.

## [1.0.2] - 2026-09-25

- The Windows installer sets SGVue to use the high-performance graphics card on laptops with
  two, unless you have already chosen one for it.

## [1.0.1] - 2026-09-25

- The home page lists recent files, offers a demo building and shows the version.
- Opening a model that is already open asks first, then replaces it.
- The camera frames the building rather than the site; grid bubbles sit close to the building,
  with the dimensions between gridlines; a button turns the canvas grid off.
- A see-through ground and see-through `IfcSpace`s; with Original materials off, elements are
  coloured by IFC class.
- Resizable sidebar lists, renaming a saved view with a double-click, compact assistant
  suggestions, and Help › Check for updates….

## 1.0.0 - 2026-09-25

The first complete version — the IFC parser and federation, the renderer, the designed shell,
selection, visibility and filters, annotation, colour, the landing page and sessions, the
assistant, and the accessibility, performance and packaging pass. It was not published on the
releases page.

[Unreleased]: https://github.com/sgvue/sgvue/commits/main
[1.4.0]: https://github.com/sgvue/releases/releases/tag/v1.4.0
[1.3.0]: https://github.com/sgvue/releases/releases/tag/v1.3.0
[1.2.0]: https://github.com/sgvue/releases/releases/tag/v1.2.0
[1.1.0]: https://github.com/sgvue/releases/releases/tag/v1.1.0
[1.0.2]: https://github.com/sgvue/releases/releases/tag/v1.0.2
[1.0.1]: https://github.com/sgvue/releases/releases/tag/v1.0.1
