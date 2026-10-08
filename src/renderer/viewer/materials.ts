/**
 * The scene palette and every material in it.
 *
 * Ported from `design-reference/design/viewer-core.js` L4–7 (`THEMES`), L61–68 (the TSL
 * section clipping and cut-face shading) and L69–109 (the material rules), with one
 * difference that is invisible on screen: the reference makes a material per colour and per
 * state and swaps `mesh.material` per element, which cannot work when tens of thousands of
 * parts share one merged draw. Here the colour **and the alpha** live in a small texture
 * indexed by the part's own index (`part-state.ts`), which every vertex carries in a
 * `partIndex` attribute — so one material per family reproduces the reference's whole bank.
 * `viewer-core.ts` owns the precedence.
 *
 * Two families, exactly the reference's rule: `solid` for opaque parts, which cast shadows,
 * and `glass` for anything the file marks transparent, which never casts and never writes
 * depth. The reference's `ghostMat` / `inertMat` / fade pair collapse into one see-through
 * material drawn over the same geometry — see `maskNode` below.
 *
 * Colour space: the contract's `rgba` and the design's hexes are sRGB; the part-state texture
 * is in the renderer's working (linear) space, so `linearRgba` converts once.
 *
 * 2026-10-01 (owner-requested, two section planes): the section clip is **two** plane uniforms —
 * the gridline cut and the level cut — and a fragment is kept only on the kept side of both. A
 * plane that is not cutting is parked where it keeps everything, so with one plane cutting the
 * test is the reference's own.
 */
import {
  Color,
  CustomBlending,
  DoubleSide,
  Line2NodeMaterial,
  LineBasicNodeMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SRGBColorSpace,
  SrcAlphaFactor,
  Vector3,
  Vector4
} from 'three/webgpu'
import {
  attribute,
  float,
  frontFacing,
  int,
  ivec2,
  positionWorld,
  select,
  textureLoad,
  uniform,
  vec3,
  vec4
} from 'three/tsl'
import { PART_TEX_WIDTH, type PartState } from './part-state'

export type ThemeName = 'dark' | 'light'

/** The design's palette, copied verbatim from `viewer-core.js` L4–7. */
export const THEMES = {
  dark: { bg: 0x0f1516, ground: 0x171f20, grid1: 0x263332, grid2: 0x1d2726, edge: 0x0f1516, gridline: 0x798c8a, level: 0x94a7a4, accent: 0x35c4b6, cut: 0x3b494c, card: '#171F20', cardHover: '#12302D', ink: '#E4ECEA', muted: '#94A7A4', border: '#354544', accentCss: '#35C4B6' },
  light: { bg: 0xf4f7f6, ground: 0xffffff, grid1: 0xdce4e2, grid2: 0xe9efee, edge: 0x1b2a2c, gridline: 0x7c8f8e, level: 0x54696b, accent: 0x0e8a80, cut: 0x55666a, card: '#FFFFFF', cardHover: '#E2F0EE', ink: '#1B2A2C', muted: '#54696B', border: '#BFCFCC', accentCss: '#0E8A80' }
} as const

export type Theme = (typeof THEMES)[ThemeName]

/** The reference's ghost / inert / fade grey (`viewer-core.js` L98–104). */
export const GHOST_GREY = 0x8a9492
/** Ghost opacity in highlight mode. */
export const GHOST_ALPHA = 0.1
/** Opacity of a model outside activate mode. */
export const INERT_ALPHA = 0.08
/** Crossfade endpoints and duration (seconds) — `viewer-core.js` L103–104, L731. */
export const FADE_OUT_FROM = 0.3
export const FADE_IN_FROM = 0.02
export const FADE_IN_TO = 0.3
export const FADE_SECONDS = 0.22
/** The edge line opacity (`viewer-core.js` L107). */
export const EDGE_ALPHA = 0.45
/**
 * The ground veil's opacity (2026-09-24, owner-requested). An opaque face below grade is
 * drawn at `1 − GROUND_VEIL_ALPHA` = 40 % of its own contrast against the ground; plain ground
 * blends ground over ground and does not change. See `groundVeil` below and `scene.ts`.
 */
export const GROUND_VEIL_ALPHA = 0.6

/**
 * `IfcSpace` (2026-09-24, owner-requested: *"make them transparent by default. They are space
 * anyway."*). A space is drawn as a faint tint of its own colour at this opacity — its
 * file opacity is replaced, not multiplied (`batches.ts`) — writes no depth and casts nothing,
 * so it never hides what stands inside or behind it. Every per-part state scales it: a ghost
 * (0.1) or a fade becomes that fraction of it, and hidden (0) discards.
 */
export const SPACE_ALPHA = 0.08
/**
 * A selected or highlighted space (a state alpha above 1) is drawn at this opacity instead, in
 * the accent or the highlight colour with the usual glow — clearly marked, still see-through.
 */
export const SPACE_MARKED_ALPHA = 0.3

/**
 * The cut outline's width in CSS pixels (2026-09-28, owner-requested: *"Accent colour, thick —
 * about 2.5 px"*). Screen-constant at every zoom: `Line2NodeMaterial` sizes it in pixels.
 */
export const CUT_LINE_PX = 2.5

/**
 * A part's alpha is also its state channel, because the part-state texture is Float32 and
 * nothing clamps it. An alpha **above 1** means "opaque, and glowing by the excess": the
 * material clamps the drawn opacity back to 1 and feeds `alpha − 1` to `emissiveNode`. That is
 * how the reference's `selMat` (`emissive: accent, emissiveIntensity: 0.35`) and `hlMat` (0.15)
 * survive a world with one material per family instead of one per state.
 */
export const SELECT_GLOW = 0.35
export const HIGHLIGHT_GLOW = 0.15

/** Alpha 0 is the hidden state: both the solid and the see-through material discard it. */
export const HIDDEN_ALPHA = 0

/**
 * Below this alpha a part is drawn by the slot's **see-through mesh** instead of its solid
 * one. The two share the same geometry and each discards what the other draws, so a part is
 * rasterised by exactly one of them: the solid mesh stays genuinely opaque, writes depth and
 * casts, and the see-through one blends over it afterwards writing none. That is how the
 * reference's `depthWrite: false` and `castShadow = shadowsOn && !transparent` survive a world
 * where a material belongs to a whole merged mesh rather than to an element.
 */
export const SEE_THROUGH_BELOW = 0.5

/**
 * The hovered element is tagged by adding this to its instance alpha, and the material
 * subtracts it back out before doing anything else. It is the one state the glow channel
 * above cannot carry: `selMat`'s and `hlMat`'s emissive is the accent *because their colour
 * is the accent*, so `rgb × (alpha − 1)` reproduces them, whereas the reference's hover
 * (`hoverFor`, `viewer-core.js` L77) keeps the element's own colour and adds a **flat**
 * accent × 0.22 on top. Tagging is exact and costs one `select` in the shader; the
 * alternative — glowing in the element's own colour — turns a red pipe's hover red.
 *
 * 4 is clear of every real alpha (the largest is `1 + SELECT_GLOW`), so the test is a
 * comparison against 3.5 and the base alpha is recovered by subtraction.
 */
export const HOVER_TAG = 4
/** `viewer-core.js` L67: the hover lift is the accent at this intensity. */
export const HOVER_EMISSIVE = 0.22

/* ── the colour precedence, as a pure decision (`BUILD_PLAN.md` §1.4) ─────────── */

/**
 * Everything the reference's `baseFor` (L91–96) and `applyMat` (L487–498) read about one
 * element. `modelColor` arrives **already resolved against "Original materials"**: the
 * reference's `nativeMats ? null : modelColors[model]` (L94), so absent here means either no
 * override for that file or the toggle is on — which is why an override is *remembered* while
 * native materials show (`SGVue.dc.html:1209` keeps `modelColors` and flips only the flag).
 */
export interface ElementColourInput {
  /** `rec.visible`. */
  visible: boolean
  /** `selected.has(id)`. */
  selected: boolean
  /** `id === hovered`. */
  hovered: boolean
  /** `!!pickOk && !pickOk(el)` — a model left outside activate mode. */
  inert: boolean
  /** Highlight mode is on at all (the reference's `highlight !== null`). */
  highlight: boolean
  /** This element is one of the highlighted ids (`rec.hl`). */
  hl: boolean
  /** `elColors[id]` — the composed map: colour-by underneath, highlight steps over it. */
  elColor?: string | null
  /** `modelColors[model]`, resolved as above. */
  modelColor?: string | null
  /**
   * 2026-09-24 (owner-requested): the element's **IFC class** colour — the group colour
   * `colorBy(elements, 'IfcEntity')` gives it — resolved against "Original materials" exactly
   * as `modelColor` is: absent while the toggle is on. It sits under a model swatch the user
   * picked, so turning the toggle off always changes what is drawn.
   */
  classColor?: string | null
  /** The user-picked highlight colour; `null` means the theme accent. */
  hlColor?: string | null
  /** The theme accent — what the selection and an unpicked highlight are drawn in. */
  accent: string | number
}

/** What to write for one part. `null` on either field means "keep the file's own value". */
export interface ElementColour {
  color: string | number | null
  alpha: number | null
  /** Add `HOVER_TAG`: the reference's flat accent lift **over the element's own colour**. */
  lift: boolean
}

/**
 * `baseFor`, L91–96: an explicit element colour wins, then the model override, then — since
 * 2026-09-24, and only with "Original materials" off — the element's IFC class colour, then
 * the part's own colour from the file. Every override returns `alpha: null` at the call site,
 * which is the reference's "the source material's opacity is kept" — glass stays glass.
 */
export const baseColour = (i: ElementColourInput): string | null =>
  i.elColor ? i.elColor : (i.modelColor ?? i.classColor ?? null)

/**
 * `applyMat`, L487–498, branch for branch and in the same order — inert, selected, hovered,
 * a highlighted element carrying its own colour, highlight mode, else the base. Hidden comes
 * first here because a merged mesh has no per-element `visible` flag: alpha 0 is what hides a
 * part, and every family material discards it in the colour pass and the shadow pass both.
 */
export function elementColour(i: ElementColourInput): ElementColour {
  if (!i.visible) return { color: null, alpha: HIDDEN_ALPHA, lift: false }
  if (i.inert) return { color: GHOST_GREY, alpha: INERT_ALPHA, lift: false }
  if (i.selected) return { color: i.accent, alpha: 1 + SELECT_GLOW, lift: false }
  // L491: hover is decided before highlight, so hovering a ghosted element brings it back to
  // its own colour for as long as the pointer is on it.
  if (i.hovered) return { color: baseColour(i), alpha: null, lift: true }
  // L492: a highlighted element that carries an explicit colour is drawn in *that* colour at
  // full opacity — which is what makes a highlight step's own colour, and a colour-by group
  // under a highlight step, survive highlight mode instead of flattening to the accent.
  if (i.highlight && i.hl && i.elColor)
    return { color: i.elColor, alpha: null, lift: false }
  if (i.highlight)
    return i.hl
      ? { color: i.hlColor ?? i.accent, alpha: 1 + HIGHLIGHT_GLOW, lift: false }
      : { color: GHOST_GREY, alpha: GHOST_ALPHA, lift: false }
  return { color: baseColour(i), alpha: null, lift: false }
}

/**
 * The alpha actually written for one part: `null` keeps the part's own opacity from the file,
 * and the hover tag rides on top of whatever it ends up being.
 */
export const partAlpha = (d: ElementColour, ownAlpha: number): number =>
  (d.alpha === null ? ownAlpha : d.alpha) + (d.lift ? HOVER_TAG : 0)

/** The plane that keeps everything: `dot(p, n) + c >= 0` with c far away. */
const NO_CLIP_N = new Vector3(0, 0, 1)
const NO_CLIP_C = 1e5

/** One section plane as the materials hold it: `dot(p, n) + c >= 0` is kept. */
export interface ClipUniform {
  n: { value: Vector3 }
  c: { value: number }
}

const _c = new Color()
/** An sRGB 0–1 colour as the working-space RGBA the batch colours texture stores. */
export function linearRgba(
  r: number,
  g: number,
  b: number,
  a: number,
  out: Vector4 = new Vector4()
): Vector4 {
  _c.setRGB(r, g, b, SRGBColorSpace)
  return out.set(_c.r, _c.g, _c.b, a)
}

/** The same for a design hex (`0x35c4b6` or `'#35C4B6'`). */
export function linearHex(hex: number | string, a: number, out?: Vector4): Vector4 {
  _c.set(hex as number)
  return (out ?? new Vector4()).set(_c.r, _c.g, _c.b, a)
}

export interface Materials {
  theme: Theme
  /** Per-part colour and state; the store writes it, these materials read it. */
  parts: PartState
  /** Solid family: opaque parts at full alpha. Casts shadows. */
  solid: MeshStandardNodeMaterial
  /** The ghost twin's material: everything the reference draws see-through. */
  ghost: MeshStandardNodeMaterial
  /** Glass family: any part whose file colour has alpha < 1. Never casts, never writes depth. */
  glass: MeshStandardNodeMaterial
  /** `IfcSpace`: a faint tint at `SPACE_ALPHA`. Never casts, never writes depth. */
  space: MeshStandardNodeMaterial
  edge: LineBasicNodeMaterial
  selEdge: LineBasicNodeMaterial
  /** The ground's opaque base: drawn first, writes no depth, so what is below grade draws over it. */
  ground: MeshStandardMaterial
  /** The same ground again, blended over the opaque pass at `GROUND_VEIL_ALPHA`. Writes depth. */
  groundVeil: MeshStandardMaterial
  section: LineBasicNodeMaterial
  sectionSheet: MeshBasicMaterial
  /** The cut outline: the accent, `CUT_LINE_PX` wide, opaque, depth-tested with a small bias. */
  sectionCut: Line2NodeMaterial
  /**
   * The annotation line materials — `viewer-core.js` L170–171, L363–364 and L432–433. None of
   * them is clip-gated, exactly as the reference leaves them: a gridline, a level ring, a laser
   * and a dimension stay whole when the model is cut open.
   */
  gridLine: LineBasicNodeMaterial
  levelLine: LineBasicNodeMaterial
  laser: LineBasicNodeMaterial
  laserPreview: LineBasicNodeMaterial
  dim: LineBasicNodeMaterial
  dimBox: LineBasicNodeMaterial
  /**
   * The two section planes — `[0]` the gridline cut, `[1]` the level cut — which `setSections`
   * writes. A parked one (`clearClip`) keeps everything.
   */
  clip: readonly [ClipUniform, ClipUniform]
  /** The materials' own test, mirrored on the CPU: on the kept side of **both** planes. */
  keeps(x: number, y: number, z: number): boolean
  /** Park plane `i`: it clips nothing. */
  clearClip(i: number): void
  setClip(i: number, n: Vector3, c: number): void
  setTheme(name: ThemeName): void
  dispose(): void
}

export function createMaterials(themeName: ThemeName, parts: PartState): Materials {
  let T: Theme = THEMES[themeName]

  const clipN = uniform(NO_CLIP_N.clone())
  const clipC = uniform(NO_CLIP_C)
  // 2026-10-01: the second plane, parked like the first until a second cut is on.
  const clipN2 = uniform(NO_CLIP_N.clone())
  const clipC2 = uniform(NO_CLIP_C)
  const clip: readonly [ClipUniform, ClipUniform] = [
    { n: clipN, c: clipC },
    { n: clipN2, c: clipC2 }
  ]
  const cutCol = uniform(new Color(T.cut))

  // Section clipping is done in-shader against a world-space plane uniform: dot(p, n) + c >= 0
  // is kept. (The WebGPU ClippingContext caches projected planes and goes camera-locked on
  // update — the reference's own note, L61–62.) With two planes the kept region is the
  // intersection of their kept sides; a parked plane's test is always true, so one cutting
  // plane keeps exactly what the reference's single test keeps.
  const clipKeep = () =>
    positionWorld
      .dot(clipN)
      .add(clipC)
      .greaterThanEqual(0)
      .and(positionWorld.dot(clipN2).add(clipC2).greaterThanEqual(0))

  /** `viewer-core.js` L66. `op` is 1 for the batch families: the alpha is per instance. */
  const clipify = <M extends { opacityNode: unknown; alphaTest: number }>(m: M, op = 1): M => {
    m.opacityNode = select(clipKeep(), float(op), float(0))
    m.alphaTest = 0.001
    return m
  }

  /**
   * The per-part state fetch. Every vertex of a part carries that part's index, so the index
   * → texel arithmetic is the whole cost: the width is a constant, so it is a multiply, a
   * floor and a subtract, with no uniform and no division.
   *
   * `+ 0.5` before truncating is not decoration. The attribute is the same float at all three
   * vertices of a triangle, but barycentric interpolation can still land a unit in the last
   * place away from it; at a part index near 10^6 one ulp is 0.0625, so rounding to the
   * nearest integer is exact and truncating alone would not be.
   */
  const partIndex = attribute('partIndex', 'float').add(0.5).floor()
  const partRow = partIndex.mul(1 / PART_TEX_WIDTH).floor()
  const partCol = partIndex.sub(partRow.mul(PART_TEX_WIDTH))
  // `textureLoad` is `texelFetch`: integer texel coordinates, no filtering, no mip selection —
  // core WebGL2, and the only form that is exact for a lookup table.
  const state = textureLoad(parts.texture, ivec2(int(partCol), int(partRow)))

  /**
   * `viewer-core.js` L68: a cut face is the inside of the solid, so back faces are drawn
   * black and lit by the cut colour instead of the material's own. The colour node is built
   * as a vec4 with alpha 1 on purpose — the drawn opacity is `opacityNode`, and the **shadow**
   * pass reads `colorNode.a` (three 0.186 `Renderer._getShadowNodes`), so anything but 1 here
   * would make an opaque part cast a partial shadow.
   */
  const capify = <M extends { colorNode: unknown; emissiveNode: unknown }>(m: M): M => {
    m.colorNode = vec4(select(frontFacing, state.rgb, vec3(0)), 1)
    m.emissiveNode = select(frontFacing, glow, cutCol)
    return m
  }

  /**
   * The state channel. `state.a` is the part's alpha, possibly above 1 (see `SELECT_GLOW`)
   * and possibly carrying `HOVER_TAG` on top of that: `baseAlpha` recovers the real alpha,
   * and `glow` is the reference's flat accent lift when hovered and the part's own colour ×
   * the excess otherwise.
   */
  const hoverEmis = uniform(new Color(T.accent).multiplyScalar(HOVER_EMISSIVE))
  const alpha = state.a
  const hovered = alpha.greaterThan(HOVER_TAG - 0.5)
  const baseAlpha = select(hovered, alpha.sub(HOVER_TAG), alpha)
  const glow = select(hovered, hoverEmis, state.rgb.mul(baseAlpha.sub(1).max(0)))

  /**
   * A family material: the section plane gates the opacity, and `maskNode` decides which of
   * the two meshes over the same geometry rasterises this part at all.
   *
   * `maskNode` is three 0.186's own hook — `NodeMaterial.setupDiffuseColor` emits
   * `mask.not().discard()`, and `Renderer._getShadowNodes` emits the same discard into the
   * **shadow** pass (`maskShadowNode || maskNode`). So a hidden or see-through part costs no
   * fragment and casts no shadow, without the app touching a private field anywhere.
   */
  const familyify = <
    M extends { opacityNode: unknown; alphaTest: number; maskNode: unknown }
  >(
    m: M,
    opacity: unknown,
    mask: unknown
  ): M => {
    m.opacityNode = select(clipKeep(), opacity as never, float(0))
    m.alphaTest = 0.001
    m.maskNode = mask
    return m
  }

  /**
   * The opaque family, and the reference's ordinary material (L73). Truly opaque: it renders
   * in the opaque pass, writes depth and casts. Every see-through part is discarded here and
   * drawn by the slot's see-through mesh instead (`batches.ts`), so this mesh only ever draws
   * parts at alpha 1 — which is exactly the reference's split between its normal materials
   * and its `ghostMat` / `inertMat` / fade pair.
   */
  const solid = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
    side: DoubleSide,
    transparent: false,
    depthWrite: true
  })
  familyify(solid, float(1), baseAlpha.greaterThanEqual(SEE_THROUGH_BELOW))
  capify(solid)

  /**
   * The see-through family: the reference's `ghostMat` (0.1), `inertMat` (0.08) and its two
   * fade materials (.3 → 0 and .02 → .3) collapse into one, because the only thing that
   * differed between them was the opacity and that is now per part. `depthWrite: false` and
   * `transparent` are the reference's, verbatim; no `capify`, because the reference does not
   * cap a transparent material either.
   */
  const ghost = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    forceSinglePass: true
  })
  familyify(
    ghost,
    baseAlpha.min(1),
    baseAlpha.greaterThan(HIDDEN_ALPHA).and(baseAlpha.lessThan(SEE_THROUGH_BELOW))
  )
  ghost.colorNode = vec4(state.rgb, 1)
  ghost.emissiveNode = glow

  /**
   * The glass family: any part whose file colour has alpha < 1. Never casts, never writes depth.
   *
   * **`forceSinglePass` is deliberately *not* set here**, unlike on `ghost` above, and the
   * three.js trap in `CLAUDE.md` does not apply to it. A `DoubleSide` transparent material is
   * rendered twice — back faces, then front faces — and on the 137.9 MB reference model that
   * is 14 draw calls and 365 019 triangles a frame through the vertex stage the flag would
   * remove (measured 2026-09-19: 91 · 5 208 637 with it against 105 · 5 573 656 without).
   *
   * It is not taken because the back-then-front order is part of the drawn result. Measured on
   * the design's own mock in a band of pure façade — no DOM bubbles in frame to confuse it —
   * setting the flag changes **about 300 pixels of the glazing, by at most 4 of 255** (at most
   * 1 in highlight mode), in both themes and identically on every run. Small, but systematic
   * and not nothing, and it buys 0.14 ms of an 8.4 ms frame: under the fidelity contract that
   * trade is the wrong way round. `tests/parity/phase2a/README.md` records both numbers.
   */
  const glass = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
    side: DoubleSide,
    transparent: true,
    depthWrite: false
  })
  familyify(glass, baseAlpha.min(1), baseAlpha.greaterThan(HIDDEN_ALPHA))
  glass.colorNode = vec4(state.rgb, 1)
  glass.emissiveNode = glow

  /**
   * The space family (2026-09-24): glass's rules — transparent, no depth write, never cast —
   * at a fixed faint opacity. The state alpha scales it (a ghost or a fade is that fraction of
   * `SPACE_ALPHA`), and above 1 — selected or highlighted — it is `SPACE_MARKED_ALPHA`.
   *
   * `forceSinglePass` **is** set, unlike on glass: a space is one flat tint at one opacity,
   * so which of its own faces blends first changes nothing that could be seen — the same
   * reasoning that set it on `ghost` — and it halves the cost of 2 000 rooms.
   */
  const space = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    forceSinglePass: true
  })
  familyify(
    space,
    select(baseAlpha.greaterThan(1), float(SPACE_MARKED_ALPHA), baseAlpha.mul(SPACE_ALPHA)),
    baseAlpha.greaterThan(HIDDEN_ALPHA)
  )
  space.colorNode = vec4(state.rgb, 1)
  space.emissiveNode = glow

  const edge = clipify(
    new LineBasicNodeMaterial({ color: T.edge, transparent: true, opacity: EDGE_ALPHA }),
    EDGE_ALPHA
  )
  const selEdge = clipify(new LineBasicNodeMaterial({ color: T.accent }))

  /*
   * The ground, in two layers (2026-09-24). The reference's opaque ground writes depth, so
   * anything below grade is hidden from above. Here the opaque layer is drawn **first** and
   * writes no depth, so an opaque part below grade draws over it; then, while the canvas grid
   * is on (2026-10-08, `scene.ts`), `groundVeil` — the same plane, the same lit and shadowed
   * colour — is blended over it at `GROUND_VEIL_ALPHA` **after** every batch and before any
   * transparent object, and writes the depth the reference's ground wrote. Over plain ground
   * that blends ground over ground, so the pixel does not change; over a part below grade it
   * dims the part toward the ground colour; and because the veil leaves the reference's ground
   * depth behind, every transparent pass after it (edges, see-through parts, glass, gridlines,
   * the section sheet) meets exactly the depth it met before. With the grid off the veil is not
   * drawn, so nothing below grade is dimmed or hidden. `CustomBlending` rather than
   * `transparent` is what keeps it in the opaque list — a transparent veil would be drawn after
   * glass's back-face pass (`Renderer._renderTransparents`) and dim it. The alpha factors keep
   * the canvas opaque. Both are `FrontSide`, as the reference's ground is, so from below neither
   * is drawn.
   */
  const ground = new MeshStandardMaterial({
    color: T.ground,
    roughness: 1,
    metalness: 0,
    depthWrite: false
  })
  const groundVeil = new MeshStandardMaterial({
    color: T.ground,
    roughness: 1,
    metalness: 0,
    opacity: GROUND_VEIL_ALPHA,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor
  })
  const section = new LineBasicNodeMaterial({ color: T.accent, transparent: true, opacity: 0.8 })
  const sectionSheet = new MeshBasicMaterial({
    color: T.accent,
    transparent: true,
    opacity: 0.1,
    side: DoubleSide,
    depthWrite: false
  })
  /*
   * The cut outline (2026-09-28). Opaque — `Line2NodeMaterial` does not blend — and not
   * clip-gated: every segment lies on the plane itself, where the cut's own `>= 0` test would
   * keep or drop pixels by rounding. (With two planes cutting, each plane's segments are
   * trimmed to the other's kept side where they are computed — `section-cut.ts` — not here.)
   * It depth-tests like any solid, so from the kept side the
   * model hides it; the polygon offset pulls it a few depth steps toward the camera, so a face
   * lying in the plane, or the kept face it runs along, does not fight it.
   */
  const sectionCut = new Line2NodeMaterial({
    color: T.accent,
    linewidth: CUT_LINE_PX,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4
  })

  /* ── annotation lines, `viewer-core.js` L170–171, L363–364, L432–433 ────── */
  const gridLine = new LineBasicNodeMaterial({
    color: T.gridline,
    transparent: true,
    opacity: 0.7
  })
  const levelLine = new LineBasicNodeMaterial({ color: T.level, transparent: true, opacity: 0.45 })
  const laser = new LineBasicNodeMaterial({ color: T.accent, transparent: true, opacity: 0.95 })
  const laserPreview = new LineBasicNodeMaterial({
    color: T.accent,
    transparent: true,
    opacity: 0.5
  })
  const dim = new LineBasicNodeMaterial({ color: T.accent, transparent: true, opacity: 0.95 })
  const dimBox = new LineBasicNodeMaterial({ color: T.accent, transparent: true, opacity: 0.35 })

  return {
    get theme() {
      return T
    },
    parts,
    solid,
    ghost,
    glass,
    space,
    edge,
    selEdge,
    ground,
    groundVeil,
    section,
    sectionSheet,
    sectionCut,
    gridLine,
    levelLine,
    laser,
    laserPreview,
    dim,
    dimBox,
    clip,
    keeps: (x, y, z) =>
      clip.every((u) => x * u.n.value.x + y * u.n.value.y + z * u.n.value.z + u.c.value >= 0),
    clearClip: (i) => {
      clip[i].n.value.copy(NO_CLIP_N)
      clip[i].c.value = NO_CLIP_C
    },
    setClip: (i, n, c) => {
      clip[i].n.value.copy(n)
      clip[i].c.value = c
    },
    /** `viewer-core.js` L688–697. */
    setTheme: (name) => {
      T = THEMES[name]
      ground.color.set(T.ground)
      groundVeil.color.set(T.ground)
      edge.color.set(T.edge)
      selEdge.color.set(T.accent)
      section.color.set(T.accent)
      sectionSheet.color.set(T.accent)
      sectionCut.color.set(T.accent)
      gridLine.color.set(T.gridline)
      levelLine.color.set(T.level)
      for (const m of [laser, laserPreview, dim, dimBox]) m.color.set(T.accent)
      cutCol.value.set(T.cut)
      hoverEmis.value.set(T.accent).multiplyScalar(HOVER_EMISSIVE)
    },
    dispose: () => {
      for (const m of [
        solid,
        ghost,
        glass,
        space,
        edge,
        selEdge,
        ground,
        groundVeil,
        section,
        sectionSheet,
        sectionCut,
        gridLine,
        levelLine,
        laser,
        laserPreview,
        dim,
        dimBox
      ]) {
        m.dispose()
      }
    }
  }
}
