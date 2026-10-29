# Desktop Bannerhold environment (`main game/src/legacy/environment/`)

The desktop renderer of the shared Bannerhold pipeline (standard `three` 0.185). It implements
`CreateDesktopLegacyEnvironment` from `../environment-contract.ts`; gameplay's environment provider
discovers `createLegacyEnvironment.ts` with `import.meta.glob`. Design and data come from the shared
blueprint and pipeline (`shared/legacy/environment/`, `docs/legacy/environment/TECHNICAL_SPEC.md`).

## Flow

1. `createLegacyEnvironment(options)` constructs a `BannerholdEnvironment` (`environment.ts`) and
   awaits `init()`.
2. The pure shared build (`buildBannerhold`) runs in a Web Worker (`build.worker.ts`,
   `buildClient.ts`); its typed arrays are transferred, never copied. Textures load in parallel from
   the baked library (`textures.ts`, `assets/legacy/environment/textures/manifest.json`) with
   `ImageBitmapLoader` (off-thread decode).
3. `sceneAssembly.ts` merges static meshes by material, shadow flags, motion and state gate (the
   landmark id survives as a vertex attribute for highlight), creates instanced meshes for
   vegetation, figures and state slots, and records gated objects.
4. `materials.ts` builds physically based materials from the shared library; `shaderPatches.ts`
   adds analytic height fog (applied before tone mapping), landmark rim highlight, cloth and
   foliage wind, fire flicker and four-layer terrain detail.
5. `sky.ts` draws the nation's sky (Korvenia: eclipse disc, diamond ring, streamered corona,
   warm horizon band, faint stars; under the eclipse the sky stays dark round the corona);
   `atmosphere.ts` sets the key light (one bounded PCF shadow map fitted to the settlement on
   medium/high), a warm shadowless fill from the opposite horizon, hemisphere ambient whose sky and
   ground colours keep the blueprint's hues at a fixed luminance (so shadowed streets are never
   black), practical point lights and fog; a PMREM environment map of the sky supplies
   image-based ambient light.
6. `cameraRig.ts` turns the blueprint framings into a restrained orbit (yaw/pitch/distance limits
   per framing), eases transitions (smootherstep, log-space distance), damps input and keeps the
   camera outside building volumes and above the terrain.
7. `life.ts` animates NPC figures from the blueprint schedules (instances packed per pose each
   frame, no allocation), smoke billboards and flickering lights. `picking.ts` picks landmarks on
   collider boxes and pick spheres on pointer move only.
8. `post.ts` (optional; off on low): restrained bloom, grade and vignette, SMAA, GTAO on high. The
   scene never depends on it.
9. `renderer.compileAsync` precompiles shaders before the first frame; `onReady` fires after it.

## Contract surface

| Method | Behaviour |
| --- | --- |
| `setState(state)` | Nation change → rebuild in the worker; otherwise toggles gated meshes, slot instance counts and marker tints, and refills the heraldry atlas only when heraldry changes |
| `focusLandmark(id)` / `resetView()` / `inspectRepresentative()` | Eased move to `landmark:<id>`, `establishing`, `representative` |
| `highlightLandmark(id)` | Rim highlight through a shared uniform (no material swap) |
| `nudgeOrbit(yaw, pitch, zoom)` | Normalised fractions of the active framing's ranges, clamped |
| `projectLandmark(id)` | Label anchor in container CSS pixels with visibility |
| `setPaused`, `setQuality`, `setReducedMotion`, `resize`, `getStats`, `dispose` | As the contract states; `getStats` reads `renderer.info` accumulated over all passes of the last frame plus recent frame-script times |

The environment copies the quality options it is given, so a caller that mutates its own options
object still triggers a rebuild through `setQuality`. Optional post follows the preset (off on low,
on for medium/high) unless the development override `setPost(false)` or `?post=0` turns it off.

Quality presets map to shared profiles: `low` → `desktop-low` (no shadows, no post, pixel ratio ≤ 1),
`medium` → `desktop-medium` (2048 shadow map, bloom/grade/SMAA, ≤ 1.5), `high` → `desktop-high`
(4096 shadow map, GTAO, 1024 px textures, ≤ 2). `renderScale` scales the pixel ratio (50–100 %);
`frameLimit` caps the loop. Rendering stops while paused or when the tab is hidden.

## Development harness and captures

- `?legacyEnvironment` opens `harness.ts`: the environment full screen with a permanent
  "Development fixture" caption. Query parameters: `nation`, `fixture` (`unfounded`, `founded`,
  `injured`, `captive`, `returned`, `recognised`), `view` (`establishing`, `founding`,
  `representative`, landmark ids, `district:court|lower-town|west-gate|forge|road|eclipse`), `quality`
  (`low|medium|high`), `post` (`0|1`), `labels` (`0|1`), `reducedMotion=1`. The `district:*` views
  are development framings derived from the blueprint destinations, not shipped cameras.
  `window.__bannerhold` exposes `{ env, ready, setView, setFixture, setQuality, waitIdle }` to
  scripts.
- `node scripts/capture-legacy-environment.mjs [--quality medium,high,low] [--views ...] [--out dir]
  [--fixture founded] [--nation korvenia] [--width 1600 --height 900] [--post 0|1] [--labels 0|1]
  [--copy-to dir]` (from `main game/`) writes `<quality>-<view>.png` and `metrics.json` (draw calls,
  triangles, geometries, textures and programs per view, plus the shared budget estimate, material
  count and estimated texture memory per quality). It pauses the live loop and renders each view on
  demand, and starts Vite on port 5174 when nothing answers.
- `node scripts/verify-legacy-environment.mjs [--quality low] [--out .../verify.json]` exercises the
  contract on the harness with explicitly stepped frames: contract surface, landmark descriptors
  and anchors, eased focus/reset/representative framings, hover and click picking, the highlight
  uniform, orbit nudges, captive and founded states without a rebuild, quality switches (PCF
  shadows and post on medium, neither on low), reduced motion, pause, stats, and that `dispose()`
  releases every geometry and texture (three.js keeps one shared 16×16 DFG lookup texture of its
  own) and removes the canvas.
- Rendering in this container is software (SwiftShader): frame times are not representative of
  real hardware; draw calls, triangles and memory counts are.

## Heraldry

Standards, shields, pennants and tabards sample one 1024² RGBA atlas
(`shared/legacy/environment/heraldry/atlas.ts`). Until gameplay's `shared/legacy/heraldry` module is
merged into this branch, `fillHeraldryAtlas` uses the fallback rasteriser in
`shared/legacy/environment/heraldry/adapter.ts` (field, division, ordinary and a simple charge mark
from `TINCTURE_SRGB`). The adapter's `HeraldryRasterSource.rasterize(heraldry, { width, height,
aspect })` matches `rasterizeHeraldry` (straight-alpha sRGB, row 0 at the top, aspects `banner`,
`shield`, `pennant`), so the swap is one line:
`{ id: "gameplay", rasterize: (h, r) => rasterizer.rasterize(h, r) }` with one
`HeraldryRasterizer` per renderer. Rebuild the atlas after the swap (charges were redrawn on
29 October).

## Budgets

`estimateBudget(build)` (shared) counts draws after the merge rule and triangles of initially
visible meshes and instances, against `docs/legacy/PERFORMANCE.md`; a pipeline test enforces it for
every profile. `renderer.info` in the captures counts every pass (shadow map, main, post), so its
triangle totals are higher than the in-view estimate.

## Provenance

All geometry is generated by the shared kits from blueprint data; all textures are generated by
`scripts/generate-legacy-environment-textures.ts` from `shared/legacy/environment/textures`. No
external models, images or fonts are used.
