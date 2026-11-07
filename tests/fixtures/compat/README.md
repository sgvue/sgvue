# The compatibility corpus

Share links, `last.json` sessions, saved-viewpoint lists and `.schedule.json` files **as past
builds of SGVue wrote them**. `tests/unit/compat-corpus.test.ts` decodes each one with today's
code and restores it to the state the recorded decisions say it must reach (core protection,
plan item 4).

**Never regenerate a past build's folder with today's code.** These files are what people
already have; a change that cannot read them breaks their links and saved work. Only
`current/` may be rewritten, and only when the format changes on purpose — then the folder it
replaces is kept under that build's version.

## What made each folder

Each folder was written by `make-corpus.cjs` running **that build's own pure encoders** —
`sessionPayload` + `linkFor`, `viewpointOf` + `storeViews`, `federate` + `mockModelIndex`,
`projectFrame` / `federationFrame` + `frameKey`, `scheduleFromPreset` — bundled from that
build's source with esbuild and run under Node. Nothing of today's `src/` is imported.

| Folder | Build | Source | What it is the oldest or only example of |
|---|---|---|---|
| `v1.0.0/` | 1.0.0 | private archive, tag `v1.0.0-stable` (`4814c5d`) | one `section` plane; ids at the design's stride 1 000 000, no `idStride`; no `units`; a frame key P from the boot model's site placement; a typed base point |
| `v1.1.0-beta.1/` | 1.1.0-beta.1 | private archive, `22c13fc` | the first build that wrote a `.schedule.json` (the format has not changed since) |
| `v1.2.0/` | 1.2.0 | public `27fb7ee` | `sections` beside the legacy `section`; still no `idStride` or `units`; frame key `identity` (boot model without a site placement) |
| `v1.3.0/` | 1.3.0 | public tag `v1.3.0` (`3240e8b`) | `idStride` 1 000 000 000 and `units: ft`; a frame key P placed by an `IfcMapConversion` |
| `current/` | 1.3.0 + unreleased | public `04cbf1d` | today's format: frame key always `identity`, `units: m` |

The 1.1.0 session, link and viewpoint formats are 1.0.0's byte for byte (`session-codec.ts` and
`views.ts` did not change between them), so 1.0.0 stands for both.

To remake a folder, extract that build's tree and point the script at it:

```sh
mkdir -p /tmp/sgvue-1.3.0 && git archive v1.3.0 src package.json | tar -x -C /tmp/sgvue-1.3.0
node tests/fixtures/compat/make-corpus.cjs v1.3.0 /tmp/sgvue-1.3.0
```

## The files

| File | How the build wrote it |
|---|---|
| `link.txt` | `linkFor(sessionPayload(…))` — the `sgvue://s=…` text "copy link to this state" puts on the clipboard |
| `last.json` | `JSON.stringify({ payload, savedAt })`, the envelope `main/sessions.ts` writes |
| `viewpoints.json` | `{ key, value }`: the `localStorage` key (`ifc-viewer:viewpoints:<building>`) and the exact string `storeViews` wrote there for two viewpoints saved one after the other |
| `hidden.json` | Not a user file: the elements the scenario hid, named by model and GlobalId, with the id that build gave each (`savedId`) — what the test checks the restored ids against |
| `*.schedule.json` | `JSON.stringify(def, null, 2)`, as the Export menu's "Schedule file" writes it: the gallery's door template (metric) and its wall template (imperial), renamed and with itemize off |

## The scenario

The same review in every build, spelled in that build's own state shape: the design's mock
federation (ARC on slot 0, STR on slot 1); one ARC wall and two STR columns hidden; the Roof
storey off; STR active; ARC overridden to `#D8D2C6` with Original materials off; tree by type;
gridlines on, levels off, shadows off, snap off, dimensions on; the light theme; one isolate step
on `IfcWall`; highlight `#E8A33D`; an orthographic camera. Sections: level L2 cut at 1 200 mm
(1.0.0), plus grid C previewed at 500 mm and flipped (1.2.0 on). Units: none (1.0.0, 1.2.0),
`ft` (1.3.0), `m` (current). The base point the payloads carry is the repository's synthetic set
(CLAUDE.md, Rules); the file paths are `/Users/me/models/…` placeholders and the digests are
`aaaa…` / `bbbb…`.
