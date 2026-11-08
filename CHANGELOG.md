# Changelog

The notable changes in each version of SGVue. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Installers are published at
https://github.com/sgvue/releases/releases; from 1.2.0 the full notes of each version are in
[`docs/releases/`](docs/releases/).

## [Unreleased]

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
