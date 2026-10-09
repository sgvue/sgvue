# Changelog

The notable changes in each version of SGVue. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Installers are published at
https://github.com/sgvue/releases/releases; from 1.2.0 the full notes of each version are in
[`docs/releases/`](docs/releases/).

## [Unreleased]

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
[1.3.0]: https://github.com/sgvue/releases/releases/tag/v1.3.0
[1.2.0]: https://github.com/sgvue/releases/releases/tag/v1.2.0
[1.1.0]: https://github.com/sgvue/releases/releases/tag/v1.1.0
[1.0.2]: https://github.com/sgvue/releases/releases/tag/v1.0.2
[1.0.1]: https://github.com/sgvue/releases/releases/tag/v1.0.1
