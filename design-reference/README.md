# SGVue — developer handoff

> **Not in this repository (2026-10-05).** The design tool's own runtime (`design/support.js`,
> `ask-vee/support.js`) and its starter components (`ask-vee/animations-v3.jsx`,
> `ask-vee/tweaks-panel.jsx`) are not redistributed: their licence was never recorded. Without
> them the `.dc.html` prototypes do not open in a browser, so they are **read as source** — the
> markup, the `<style>` block, the logic class, `viewer-core.js` and the mock are all here as
> text, and that is what the port and its tests read. Every other file here is as it arrived,
> but for this README's two dated notes and `ask-vee/fonts/OFL.txt`, the licence of the IBM Plex
> fonts beside it.

## What this bundle is

`design/` holds a **working HTML prototype** of SGVue, a browser-based IFC model viewer
for BIM coordination review. These are **design references**, not production code to
paste into an app. Your task is to **recreate this in the target codebase's own
environment** (React, Vue, Svelte, native — whatever it uses) with its established
patterns, state library and build tooling. If there is no codebase yet, pick the
framework that suits the project and build there.

**Start with `BUILD_PLAN.md`** — it is the sequenced plan: architecture decisions with
rationale, data contracts, ten build phases with acceptance criteria, the full token
set, and a pitfalls log of every real defect hit while building the prototype.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, iconography, copy, interaction and
motion. Every value in `BUILD_PLAN.md` §5 is the intended production value.

## Two qualifications

1. **The 3D layer is real and worth keeping as reference.** `design/viewer-core.js` is a
   framework-agnostic ES module on three.js (WebGPU renderer, WebGL fallback). Its
   imperative API is a sound boundary between UI and renderer and translates directly to
   any framework. Treat it as a reference implementation, not decoration.
2. **The model data is fake.** `design/sample-model.js` procedurally generates a
   four-storey block plus a landscape file so the prototype could be built without an IFC
   parser. Replace it with **web-ifc**; keep the data shape — the whole UI is written
   against it. See `BUILD_PLAN.md` §2 and §4.

`design/support.js` is the prototype's own template runtime. It has no place in
production — do not port it. (It is not in this repository: see the note at the top.)

## Non-negotiables

- **Everything runs client-side.** No file is uploaded; the UI says so.
- **The assistant is read-only with respect to model data.** It changes what is shown and
  reports what is there. It never writes names, parameters, property sets,
  classifications or geometry, and no tool exists for it.

## Files

```
BUILD_PLAN.md        The plan. Read this first.
design/
  SGVue.dc.html      UI shell — layout, overlay cards, sidebar, assistant, state, logic.
                     Prototype template format: markup, then the logic class in a
                     <script type="text/x-dc"> block at the end. Read both halves.
  viewer-core.js     three.js renderer. Framework-agnostic — reference closely.
  sample-model.js    Mock model generator. Replace with a real parser; keep the shape.
  support.js         Prototype runtime. Do NOT port. Not redistributed (see the top).
```

With its runtime, `design/SGVue.dc.html` opens in a browser as the interactive prototype; this
repository does not carry the runtime, so read it as source.

`ask-vee/` is the owner's second handoff, **"Ask Vee"**, received 2026-10-01 and kept exactly as it arrived: the assistant's name (**Vee**), its 16 × 16 pixel mascot and the thinking-process motion — `ask-vee/README.md` is the spec and `ask-vee/ask-thinking-hex.jsx` the reference code. **Scale:** its README calls its sizes "app px (screenshot ÷ 1.2)", but the screenshot it was traced from was taken at 150 % display scaling, so — measured against the real panel — **`ask-thinking-hex.jsx` px ÷ 1.5 = app px** (README px ÷ 1.25), and the panel it shows is today's panel: `CLAUDE.md` (allowed deviations, 2026-10-01) records what was built from it.

## Still owed before launch

- Production URL for `canonical` / `og:url` (deliberately unset — a canonical pointed at
  the wrong host is the most damaging SEO error).
- Real URLs for the footer's Privacy / Terms / Support links, and a support email.
- Accessibility items listed in `BUILD_PLAN.md` Phase 9.
- Spatial hashing for the clash test before it meets real file sizes.
