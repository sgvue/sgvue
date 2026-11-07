# The `.sgvue` project file — plan

*2026-11-07 · status: **approved** — the owner: *"Approve the recommended defaults for both plans. go with .sgvue"* · D1…D12 are the recommended defaults below.*

## What it is

A small file that remembers a coordination review: **which IFC files, and everything done on top of
them** — colours, viewpoints, filter sets, schedules, sections, markups, what is hidden. Like a
music playlist: it names the songs and how to play them, it does not contain them. The IFC files
are never copied, changed or written. This is the Navisworks **NWF** model (Solibri and BIMcollab
work the same way); the NWD-style "bundle with the models inside" is not part of this plan.

## What exists today (the rawest source)

Most of the state already has a writer and a reader — the session payload
(`src/shared/session-codec.ts`) behind the share link and the per-reply revert. What is missing:

| Gap today | Consequence |
|---|---|
| Hidden / selected / isolated elements are stored as **federation ids** (`slot × 10⁹ + expressId`) | Lost if a model is re-exported or opened in another order. |
| Viewpoints and filter sets live in **`localStorage`, keyed by the building's name** | Not portable; two projects with one building name share them. |
| Saved schedules live in the **Schedules window's `localStorage`** | Same. |
| Markups (spots, measures) are **not saved anywhere** | Gone at quit. |
| `last.json` is written but **never read back** | Nothing survives a restart except through a link. |
| No version field; compatibility is by which keys are present | Fine for links, not enough for a file people keep for years. |
| No File › Open / Save, no `.sgvue` file type, no `open-file` handler | — |

## The file

```jsonc
{
  "format": "sgvue-project",
  "version": 1,
  "savedBy": "SGVue 1.4.0",
  "savedAt": "2026-11-07T09:45:00Z",
  "models": [
    { "id": "m1",                      // stable inside this file, never a slot
      "name": "Tower A - ARC.ifc",
      "relPath": "models/Tower A - ARC.ifc",   // relative to the .sgvue file — tried first
      "absPath": "…",                          // fallback only
      "sha256": "…", "size": 123456789,
      "label": "ARC", "colour": "#35C4B6", "own": false, "visible": true }
  ],
  "view":       { /* camera, sections, display switches, units, tree mode, storey eyes, Original materials */ },
  "visibility": { "hidden": [["m1", "2O2Fr$t4X7Zf8NOew3FLOH"], …], "active": "m1", "stack": [ /* filter steps, as today */ ] },
  "viewpoints": [ /* today's Viewpoint, with GlobalIds in place of ids */ ],
  "filterSets": [ /* today's FilterSet */ ],
  "schedules":  { "saved": [ /* name, def, savedAt */ ], "open": null /* or a ScheduleDef */ },
  "markups":    { "spots": [ /* world coordinates */ ], "measures": [ … ] }
}
```

Every element reference is **(model id, IFC GlobalId)** — the identity that survives a
re-export. One zod schema reads it; unknown keys are ignored; a `version` above what the build
knows is refused with "made by a newer SGVue — update the app" (the rule `parseScheduleDef`
already uses).

## Decisions for the owner

| # | Question | Recommended default | Why |
|---|---|---|---|
| **D1** | Reference the IFC files, or bundle them in? | **Reference** (NWF-style). A bundle can come later. | Small, instant to save, never duplicates 600 MB models. |
| **D2** | How elements are remembered | **By GlobalId**, per model | Survives re-exports and load order; ids do not. |
| **D3** | A model file **changed** since the project was saved (hash differs) | **Open it anyway**, warn once, re-apply by GlobalId, say how many items no longer matched | Today a changed hash discards the load — right for a link, wrong for a project that lives through revisions. |
| **D4** | A model file is **missing** | Open the rest, and say which are missing with a **Locate…** button (native Open dialog) | Folders move; one missing file should not block a review. |
| **D5** | What is saved | Everything in the table below marked ✔ | — |
| **D6** | The Vee chat | **Not saved** | It can hold sensitive discussion, and the assistant re-reads the model anyway. |
| **D7** | Theme (dark / light) | **Not saved** — it is the viewer's preference, not the project's | A colleague opening your project keeps their own theme. |
| **D8** | Saving | **File › Save Project (⌘S / Ctrl+S), Save Project As…, Open Project…**; the window title shows the project name and `•` when unsaved; quitting with unsaved changes asks (native box) | The usual document pattern every user knows. |
| **D9** | Where viewpoints / filter sets / schedules live while a project is open | **In the project** (no project open: as today) | Otherwise they leak between projects with the same building name. |
| **D10** | Double-click to open | **Yes**: register `.sgvue` in both installers (macOS `open-file`, Windows argv), and the drop zone also takes a `.sgvue` | No new element: the drop zone keeps its look and copy. |
| **D11** | The disk-writer rule (today: exactly three writers; a new one is "a design change") | A **fourth writer, `src/main/projects.ts`**: writes only to a path the user picked in Save As or opened this run, atomically (temp + rename), capped at 16 MB | ⌘S writing to the already-chosen file without a dialog is the one stretch of today's export rule; it needs your yes. |
| **D12** | Model colours | **Stored in the project.** A model added to a project for the first time takes the colour its loaded neighbours use least. The Recent pills keep the design's colours by position. | *Amended in phase 1, the owner: "Stay teal"* — each colour carries `own`; only the user's own are restored, so the grey model keeps the cut's accent. Replaces both the "colour by position" and the "colour by path hash" options; the path-matching fix is kept, the hash is dropped. |

### What is saved (D5)

| Saved ✔ | Not saved ✗ |
|---|---|
| Models: path, hash, label, colour, eye; Original materials | API key, model, effort, every Preferences setting |
| Camera and projection; both section planes | Theme (D7); window and panel sizes; MODELS folded |
| Display switches (gridlines, levels, canvas grid, shadows, dims, snap); units; tree grouping | Selection, open card, armed tool, tree search |
| Hidden, isolated, storey eyes, active model, the filter stack | The Vee chat (D6) |
| Saved viewpoints; named filter sets | Recents list; GPU choice |
| Saved schedules and the open one | — |
| Spots and laser measurements (world coordinates) | — |

## Built in phases (each: builder → reviewer → commit)

1. **Format and codec, headless.** `shared/project-file.ts`: schema v1, writer from the store, reader to a restore plan, GlobalId ⇄ id mapping. Round-trip and fuzz tests. No UI.
2. **Save and Open from the File menu** (D8, D11): the fourth writer, Open dialog, dirty marker, ask-on-quit.
3. **Viewpoints, filter sets, schedules and markups move into the project** (D9), with a one-time import of the `localStorage` lists into a new project.
4. **Changed and missing models** (D3, D4).
5. **Double-click and drop** (D10): file association, `open-file`, installers.
6. *(Optional, later)* **BCF export** of viewpoints, the open BIM standard, so Navisworks, Solibri or BIMcollab can read them.

## How we know it works (the outside judge)

- **Round-trip property test:** a seeded random review state → save → open → the same state, 500 cases.
- **Frozen corpus:** a committed v1 project file (synthetic models) that every later build must open to the same state.
- **Re-export simulation:** the same synthetic model with express ids renumbered — hidden items and markups must land on the same elements by GlobalId.
- **Hostile files:** malformed, oversized, wrong version, path traversal in `relPath` — refused with a message, never a crash.
- **One e2e (your yes):** open two models, colour, hide, save viewpoint, Save Project, quit, double-click the file — everything is back.

## Recorded with it

An "Allowed desktop deviations" entry (the File menu items, the title marker, the quit question, the drop zone taking `.sgvue`), the `Only three modules may write to disk` rule amended, Decisions lines and `docs/DECISIONS.md` rows.

## Phase 2 must handle (from the phase-1 deep review)

1. Resolve `relPath`, then `absPath`, only through main's `admit()` — never open the string: `absPath` may be a UNC or `\\?\` device path, and `relPath` may climb (`outside[]`).
2. Restored measurements: re-measure (`placeMeasure` re-fires along the plan axes) or draw from the stored lengths — decide.
3. Viewpoints saved before 2026-10-09 (`idStride` absent): renumber through `viewpointHidden` before writing.
4. D12: apply `leastUsedColour` when a model is added.
5. A surface for `outside[]`, `dropped` and `unmatched` (phase 4's wording).
6. Use `Object.hasOwn` / `in` on the restored maps — they are null-prototype.
7. Write the file as UTF-8.

## Carried into later phases (from the phase-2 review)

- Phase 3: `carryForward` merges a carried model's viewpoint refs into the written viewpoint of the same `id`; while viewpoints still live in `localStorage` a coincidental id could gain foreign refs (carried models only). Moving viewpoints into the project removes it.
- Phase 3: decide whether a restored measurement is re-measured or drawn from its stored lengths.
- Phase 4: with an all-missing project open, a new pick on the landing page closes it (the file is untouched) — Locate… is the way in.
- Before release: on macOS ⌘Q, the Vee and Schedules child windows may close before the main window's question, and stay closed on Cancel — check in the e2e run.
