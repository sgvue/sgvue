# SGVue Desktop — parser and renderer traps

Moved out of `CLAUDE.md` unchanged. **Read this before touching `src/worker/` or
`src/renderer/viewer/`** — every bullet was a real defect, and each one cost a day.
`CLAUDE.md` carries the same list as one-line reminders.

## web-ifc traps

Distilled from two earlier viewers built on the same parser — **Marumi** and **Aquila**, the
author's earlier IFC viewers. Each one was a real defect, and each cost a day. The source is
named so each trap can be traced to its original write-up.

**Geometry and units**

- **`flatTransformation` already applies the length unit and the Z-up → Y-up conversion.**
  Scaling or rotating again shrinks a 415 m warehouse into a 40 cm box, and nothing in the
  browser tells you. Print the model size in a Node harness to catch it.
  — Marumi's `CLAUDE.md` and `PROGRESS.md`
- **Adding `rotation.x = -π/2` double-rotates and lays the building on its side.** Same trap,
  second project. — Aquila's `CLAUDE.md`
- **Always `.slice()` the result of `GetVertexArray`/`GetIndexArray`.** They are views into the
  WASM heap and are invalidated under you.
  — Aquila's `CLAUDE.md`
- **`IfcSpace` is excluded from `StreamAllMeshes`** — stream it with
  `StreamAllMeshesWithTypes`. — Aquila's `CLAUDE.md`
- **The `FlatMesh` a stream callback receives has no `delete` in 0.0.77** — the property is
  `undefined`, and calling it would throw. What must be freed is `mesh.geometries`, the
  placement vector: one leaks per product, so a 26 761-element model leaks 26 761 of them.
  Checked by probe, not assumed. — Phase 1b
- **Surface-style transparency is NOT folded into the placed colour's alpha.** Resolve it by
  walking `IfcStyledItem`, or every window renders opaque.
  — Aquila's `CLAUDE.md`
- **Never `COORDINATE_TO_ORIGIN: true` in a federation.** It recentres each model
  independently and `GetCoordinationMatrix` then returns identity, so the offsets between
  models are silently lost. Subtract a shared origin in Float64 instead.
  — Marumi's `CLAUDE.md`
- **Revit shared coordinates put models ~33 km from the file origin,** where float32 resolves
  about 4 mm — enough to crack thin geometry and z-fight 6 mm glass.
  — Marumi's `CLAUDE.md` and `PROGRESS.md`
- **Grid points need `placementMatrix()` applied by hand.** Unlike geometry, web-ifc does not
  bake the `IfcLocalPlacement` chain into anything read from the entity graph. And a grid axis
  is a segment, not a coordinate — one reference model's grid runs at 43°.
  — Marumi's `CLAUDE.md`
- **A Revit shared-coordinates export carries the rotation to true north AND the elevation on
  `IfcSite.ObjectPlacement` — not just the translation, and not on `IfcMapConversion`.** The
  reference model's map conversion is an **identity** (`0., 0., 0., 1., 6.12e-17, 0.001`) while
  its site placement is `(12 345 457, 23 456 766, 5 050) mm` turned **−43.4103°** about Z. Read
  only the translation and the whole model stands at 43° to its own grid, with every
  axis-aligned annotation wrong by that angle; read the map conversion first and the
  Coordinate-system card fills with zeros. Take the **composed matrix's X column** for the
  rotation (`atan2(m[1], m[0])`), check it really is a rotation about `+Z` before believing it,
  and undo the whole placement once in the geometry pipeline. — 2026-09-20
- **`IfcMapConversion.Scale` cannot be read as an instruction: its direction depends on who wrote
  the file, and when.** For the same millimetre model in a metre CRS, Revit's exporter wrote it
  absent (up to its 25.x releases), 0.001 (26.1 to 27.0.x) and 1000 (27.3.0.12, August 2026 —
  after buildingSMART's validation rule GRF005 had expected 1000 for more than a year, and
  eighteen days before that rule was corrected to 0.001), and buildingSMART's own example files
  disagree with each other. Applied literally, one cohort of files is drawn a thousand or a
  million times too large. web-ifc has already put the geometry in metres, so place by E / N / H
  × the map unit and never by `Scale`; report it as written. — 2026-10-08
  ([revit-ifc Exporter.cs](https://github.com/Autodesk/revit-ifc/blob/IFC_v27.3.0.12/Source/Revit.IFC.Export/Exporter/Exporter.cs#L4124-L4143),
  [ifc-gherkin-rules #522](https://github.com/buildingSMART/ifc-gherkin-rules/issues/522))
- **Take the `IfcMapConversion` whose `SourceCRS` is the 3D `Model` context, not the first one in
  the file.** A file can carry another on a 2D `Plan` context, and "the first" is then a coin
  toss — IfcOpenShell's own reader takes the first. A sub-context of the `Model` context (`Body`)
  is a legal `SourceCRS` and the same frame: judge it by its `ParentContext`. Fall back to the
  first only when none is on the `Model` context. — 2026-10-08
- **A file can hold many `IfcSite` entities; only the one `IfcProject` aggregates is the model's
  position.** The reference model has **16** — road-marking families exported as sites. Taking
  "the first by expressId" is a coin toss that this file happens to win. Walk
  `IfcRelAggregates` from `IfcProject` instead, everywhere: the georeferencing reader, the
  CORENET X check, and any ground-truth script. — 2026-09-20
- **The federation offset's Z is the first placement's, not the datum — never read scene
  z = 0 as the ground.** The whole-metre offset is rounded from the first placement web-ifc
  streams from the boot model (`geometry-streamer.ts`), and web-ifc streams by IFC class, then
  in file order, with each geometry's own centre in the placement. In a Revit export that
  first part happens to sit near the file's zero; in a Tekla steel export it was a member at
  98 % of the model's height, so the ground — drawn at scene 0 — stood up there with 92 % of
  the elements under it, dimmed, while the same file federated behind another model (whose
  offset was used) looked right. The file's own zero is scene `0 − offset z`, and the ground is
  `groundLevel(datum, box min z, box max z)` (`viewer/scene.ts`). Anything that means "grade"
  reads `rig.groundZ`; anything that means "the file's zero" subtracts the offset. — 2026-10-01

**Properties**

- **`getPropertySets(..., includeTypeProperties=true)` REPLACES rather than adds** — it
  returns only the type psets. Fetch instance and type psets separately and merge, with the
  occurrence overriding the type.
  — Aquila's `CLAUDE.md`
- **Use shallow `GetLine` with manual reference resolution, not the recursive flatten
  `GetLine(id, true)`.** Flatten's batched `GetRawLinesData` throws
  `Cannot convert "1,2,3" to unsigned int` on real-world Revit exports.
  — Aquila's `PROGRESS.md`
- **Never index properties with a per-element `getPropertySets` loop.** On a 26 539-element
  model that is O(N×M) — about 3.1 billion relation visits and a permanent freeze. Do one
  forward pass over the relations instead: type psets, then instance psets, resolving each
  pset line once and caching it by expressId.
  — Aquila's `PROGRESS.md`
- **Free `GetLineIDsWithType` vectors in a `finally`.**
  — Aquila's `PROGRESS.md`
- **`GetTypeCodeFromName` hashes whatever it is given** — an entity name this schema does not
  define comes back as a plausible-looking number rather than 0. Round-trip it through
  `GetNameFromTypeCode` and treat `<web-ifc-type-unknown>` as absent. — Phase 1a
- **Numeric attributes have no `value` key of their own.** A measure arrives as
  `{ type: 4, _internalValue: "3525.", _representationValue: 3525, name: "IFCLENGTHMEASURE" }`;
  `.value` is a prototype getter, so anything that walks own properties misses it. The `name`
  field is the measure type, and is what makes a number convertible. — Phase 1a
- **A reference handle and an enumeration look alike.** Both are `{ type, value }`; only
  `type === REF` separates a pointer from an authored value. Reading them the same way turns
  `#18` into the number 18 inside a property set. — Phase 1a
- **`OpenModelFromCallback` does not read the file in order.** On a 144 MB model it asks for
  eight 64 MB blocks with repeats, so a SHA-256 built from "whatever it asked for" is wrong.
  Hash forward independently: trim overlaps, fill gaps, and finish the tail after the open.
  — Phase 1a
- **Storey `Elevation` is in the file's own length unit.** Read `IfcUnitAssignment` →
  `IfcSIUnit` LENGTHUNIT prefix and convert; do not assume metres.
  — Aquila's `PROGRESS.md`
- **Never use `getSpatialStructure`** — it dumps every element under each storey. Walk
  `IfcRelAggregates` for the tree and `IfcRelContainedInSpatialStructure` for contents.
  — plan §3.3, matching Aquila's `structure.js`

**Streaming, workers and progress**

- **The stream callback's `index`/`total` restart at every IFC type web-ifc walks,** so a
  progress bar driven from them saws back to zero a dozen times. Count products against
  `IfcElement − IfcOpeningElement`, read up front in about 0 ms and accurate within 1 %.
  — Marumi's `PROGRESS.md`
- **Two uploads in flight leak a worker and can show the wrong file's results.** `cancel()`
  rejects on a later microtask, by which time the second upload has stored its handle, so an
  unconditional `.catch` clears the live handle. Hold the handle locally and compare by
  identity before clearing. — Marumi's `PROGRESS.md`
- **Every parse stage should finish with a real value, not a percentage** — the schema, the
  storey count, the entity count. That is what makes a six-second wait read as work rather
  than a hang. Stage weights are measured shares of the wall clock; geometry is ~55 % of it.
  — Marumi's `PROGRESS.md`
- **Parsing belongs in a worker.** Aquila left `StreamAllMeshes` synchronous and paid a 4.7 s
  frozen tab; Marumi's worker parses a 144 MB model in 5.7 s while the viewport holds 120 fps.
  — Aquila's and Marumi's `PROGRESS.md`

**Rendering at real sizes**

- **One mesh per product does not survive a real model** — ~26 500 draw calls sat at ~12 fps.
  Batch, and make visibility an index-buffer rewrite rather than a re-merge.
  — Aquila's and Marumi's `CLAUDE.md`
- **Never pick with three.js `Mesh.raycast`** — it is brute force over every triangle, and one
  hover on a reference model cost **222 ms**. Filter by each element's world bounding box
  first (~2 ms), and apply the section cut *inside* the walk, because filtering afterwards lets
  a clipped-away roof block everything under it. — Marumi's `CLAUDE.md`
- **Nothing may be sized to the demo model.** Clip-plane park distance, zoom limits, fog,
  shadow frustum, ground disc and storey ladder are all derived from the federation's own
  bounding box. A literal 40 m clip constant silently sliced the roof off a 56 m warehouse.
  — Marumi's `CLAUDE.md`
- **Deleting a model must remap element ids everywhere** — selection, hidden set, isolated set,
  query hits, saved views, section cap ranges. If a feature stores an element id somewhere new,
  it must be added to that remap. Model ids come from a free-slot search, never
  `models.length`, which repeats after a delete.
  — Marumi's `CLAUDE.md`
- **Dispose discipline.** Shared cap geometry leaked on every model removal; deleting the last
  model disposed shared geometries that a later load still needed. Seed the "still in use" set.
  — Marumi's `PROGRESS.md`

**three.js 0.186 (the version we pin), against the design's r170**

- **A `BatchedMesh` is one *driver* draw per visible instance — on both backends — and at
  ~67 000 instances it floods the GPU process by gigabytes per second.** WebGPU has no
  multi-draw in 0.186 at all (134 745 `drawIndexed` a frame on the reference model). WebGL2
  looks fine in `renderer.info` — `WEBGL_multi_draw`, 44 calls a frame — but on macOS
  ANGLE/Metal *emulates* that extension by replaying the command list per draw with its own
  state, so the cost is the same and `renderer.info` is measuring the wrong thing. It
  kernel-panicked this Mac three times on 2026-09-17, the last one on WebGL2, with the GPU
  helper at ~168–170 GB. **And `workingSetSize` / `ps rss` do not show it**: at the moment one
  run's GPU process went 634 → 5 461 MB, `getAppMetrics` read 106 MB. Use `phys_footprint`
  (`/usr/bin/footprint -p <pid>`), which is what the panic report's `processByPid` uses, plus
  `sysctl kern.memorystatus_vm_pressure_level`. The fix is merged geometry per slot: 87 draws
  a frame, flat. — Phase 2b
- **`WebGLBackend.draw()` takes its `info` parameter commented out**, so
  `renderer.info.render.drawCalls` can read **0** there however much was drawn — `on.stats`
  reports the larger of that and our own object count. — Phase 2a
- **`maskNode` is the supported way to discard per fragment, and it reaches the shadow pass.**
  `NodeMaterial.setupDiffuseColor` emits `bool(maskNode).not().discard()`, and
  `Renderer._getShadowNodes` emits the same discard into the shadow override material from
  `maskShadowNode || maskNode`. `opacityNode` does **not** reach the shadow pass: the shadow
  material takes only `colorNode.a`, `alphaTest`, `depthNode` and the position nodes. — Phase 2b
- **`batchColor` is applied only when the object is a `BatchedMesh`** (`setupDiffuseColor`
  guards on `object.isBatchedMesh && object._colorsTexture`), so a plain `Mesh` must supply its
  own `colorNode`. — Phase 2b
- **An interpolated vertex attribute used as an index must be rounded, not truncated.** The
  same float at all three vertices can still interpolate a unit in the last place away from
  itself; at an index near 10^6 that ulp is 0.0625, so `int(a + 0.5)` is exact where `int(a)`
  is not. — Phase 2b
- **A `DoubleSide` *transparent* material is rendered twice**, and the shadow pass copies
  `transparent` from the source material — so a transparent caster costs two shadow draws per
  instance. `forceSinglePass` fixes the colour pass and `shadowSide` the shadow pass; better
  still, keep anything that casts genuinely opaque. **But `forceSinglePass` is not a free
  optimisation, and on the glass family it is refused**: the second pass is what draws back
  faces before front faces, and that order is visible wherever two transparent surfaces
  overlap (measured 2026-09-19 in a band of pure façade on the design's own mock: about 300
  pixels of the glazing change, by at most 4 of 255). It is set on `ghost`, whose parts are a
  flat grey at one opacity, and not on `glass`. — Phase 2a, revisited 2026-09-19
- **`material.depthNode` renders the scene black under an orthographic camera.** Reproduced
  with the node set to three's own `depth` and shadows off, so it is not our expression.
  — Phase 2a
- **`HemisphereLightNode` changed frames between r170 and 0.186** (`normalView` → `normalWorld`,
  against a `lightPosition` that is world-space in both). r170's hemisphere term depends on the
  camera, so the same surface changes brightness as you orbit — anything colour-matched against
  an r170 screenshot will not match. — Phase 2a
- **`PCFSoftShadowMap` was removed**; both backends warn and use `PCFShadowMap`. — Phase 2a
- **`BatchedMesh.sortObjects` and `perObjectFrustumCulled` walk every instance every frame**
  (`getMatrixAt` + a bounding-sphere transform each). At 67 000 instances that costs more
  than the draws they save. — Phase 2a
- **The per-part state texture is in the renderer's *working* colour space**, so an sRGB file
  colour has to be converted before it is written or every surface comes out too bright
  (`linearRgba`). — Phase 2a
- **An object kept after its geometry is disposed must be `dispose()`d too.** three's per-object
  render state caches the object's vertex buffers (`RenderObject.vertexBuffers`), and
  `geometry.dispose()` clears only its `attributes`; the render state lives as long as the
  object, and `batches.ts` / `edges.ts` keep a removed slot's objects (records index slots by
  position). Unloading the 134 MB model left 516 MB of JS heap behind; letting go of the
  slots' own arrays took that to 443 MB, and `Object3D.dispose()` on the removed meshes and
  lines to 25 MB. — refactor pass 2
- **A `DataTexture` whose dimensions change must be `dispose()`d before the re-upload**, or
  the backend keeps the old allocation and reads the wrong size. Keep the same `Texture`
  object, replace `texture.image`, dispose, set `needsUpdate` — every material node holds a
  reference to the object, not to the image. — Phase 2b
- **Every double-sided transparent material's back-face pass is drawn before the *whole*
  transparent list** (`Renderer._renderTransparents`), whatever the `renderOrder`s say — so a
  transparent object meant to go "before glass" still lands on top of glass's back faces. To
  blend something after the opaques and before every transparent, keep it in the opaque list:
  `transparent: false` with `CustomBlending` blends, and `NodeBuilder.isOpaque()` then leaves
  its alpha alone. And moving a coplanar layer in the opaque order moves who wins its depth
  fights: the see-through ground changed 62 628 far grid-helper pixels until the helper was put
  back in front of the ground. — 2026-09-24
