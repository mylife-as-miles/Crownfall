# Quest Bannerhold environment (`main-game-vr/src/legacy/environment/`)

The Meta Quest renderer of the shared Bannerhold pipeline (IWSDK 1.1.0-rc.2, super-three imported
only from `@iwsdk/core`). It implements `CreateQuestLegacyEnvironment` from
`../environment-contract.ts`; gameplay's Quest environment provider discovers
`createLegacyEnvironment.ts` with `import.meta.glob` and falls back to its labelled stand-in when
creation fails. Layout, geometry, textures and staging data come from the shared blueprint and
pipeline (`shared/legacy/environment/`, `docs/legacy/environment/TECHNICAL_SPEC.md`); nothing is
re-authored here.

## What the viewer sees

A table-top miniature of the holding at **1:125**, below eye level, cut along its near edge like a
relief model (soil, earth and rock strata with a bronze lip on the carved face). The skirt of land
around it thins into mist at its sides; beyond its far edge the nation's land continues at the same
scale to the horizon (3.5 km of terrain, about 28 m away physically) with the distant places and
ranges on the skyline (about 40–50 m away), layered in the nation's haze. Above it all is the
nation's sky: Korvenia's black eclipse disc with a streamered corona, Aethelgard's low sun,
Solforiz's veiled sun, Kwind-09's smog disc, a dusk band and a sea of mist below the horizon into
which the miniature's rim dissolves. Because the far land and silhouettes are real geometry at the
miniature's own plan scale, stereo depth and head parallax stay consistent everywhere. Only their
height is forced: beyond 900 m, distant places are raised ×2.1 and ranges ×1.5 about their own
ground (`VR_SKYLINE_EXAGGERATION` in `shared/legacy/environment/vr/miniature.ts`), so the skyline
still stands clear of the haze band seen from the table-top eye height (the eyes sit the
equivalent of 57–80 m above the land at 1:125).

## Flow

1. `createLegacyEnvironment(options)` builds a `QuestBannerholdEnvironment` (`environment.ts`) and
   awaits `init()`. Everything is parented under `options.parent` (gameplay's anchor) with
   `world.createTransformEntity`: a root entity (sky and labels in anchor space) and a miniature
   entity (scaled and rotated; content in blueprint metres below it). Landmark proxies are child
   entities of the miniature.
2. `build.worker.ts` runs `buildBannerhold({ quality: 'quest' })` and the table-top preparation
   `prepareQuestMiniature` (`shared/legacy/environment/vr/`) off the main thread: exact clipping at
   the near cut, culling of land beside the viewer, the carved section, a Quest light bake on the
   terrain, the forced-perspective skyline heights, merging by material, motion and state gate
   (landmark ids per vertex), instance culling and reordering (any prefix is an even subset), the
   height envelope, the panel layouts and the occluder boxes for the reveal (below). It
   also fills the heraldry atlas (shared 1024² layout box-filtered to 512²). Typed arrays are
   transferred, never copied; the main thread only wraps them in buffer attributes (`assembly.ts`).
3. `materials.ts` loads the 512 px albedo maps the nation's materials use through
   `AssetManager.loadTexture` (mirrored into `public/assets/legacy/environment/textures/` by
   `scripts/sync-legacy-environment-assets.mjs`) and creates unlit `MeshBasicMaterial`s: baked
   vertex light and contact AO from the shared bake, alpha-tested heraldic cloth from the atlas.
4. `shaderPatch.ts` adds one shared chunk to every material (shared uniform objects, no recompiles):
   haze in blueprint metres that starts beyond the holding, the presence fade (the same expression
   and constants as `presence()` in `shared/legacy/environment/vr/frame.ts`), mist below the datum
   for the carved section, a per-vertex key-light relight with sky and sun tints, landmark rim
   emphasis, cloth and foliage wind, fire flicker, water fresnel and an in-shader ACES tonemap. The
   look is therefore independent of the host scene's lights, IBL and exposure.
5. `sky.ts` draws the sky dome at infinity (pinned to the far plane, drawn after opaque geometry).
   `life.ts` animates NPC figures from the blueprint schedules (instance matrices written into
   existing arrays) and chimney and forge smoke (one instanced draw). `landmarks.ts` owns the pick
   proxies, labels and ground rings.
6. `renderer.compileAsync` precompiles every program (including the hidden emphasis labels and
   rings) and textures upload one per yield before the reveal.

## Contract surface

| Method | Behaviour |
| --- | --- |
| `setState(state)` | Nation change → rebuild in the worker (the current holding stays until the new one is ready); otherwise gated meshes, slot instance counts (Pawn, injured rest, levy, honours, notices, War Record markers and their tints), smoke gates and, when heraldry changes, an atlas refill in the worker |
| `focusLandmark(id)` | Emphasis only: steady warm rim on the landmark's buildings, its label and a pulsing ground ring. Never moves the viewer |
| `highlightLandmark(id)` | Hover-strength emphasis from gameplay UI; proxy hover also raises it and calls `onLandmarkHover` |
| `getLandmarks()` | Landmark descriptors in blueprint metres (label anchors) |
| `update(delta, time)` | Allocation-free: own clock (frozen while paused), shared uniforms, agents, label fade and billboarding, focus pulse |
| `setQuality(q)` | `high` / `medium` / `low`: instance density 1 / 0.75 / 0.5 (ground clutter off on low), animated NPC bindings 6 / 5 / 4, smoke off on low. No new features per level; the global foveation level stays with gameplay's comfort settings |
| `setPosture(p)` | Moves the miniature to the posture's surface height and distance; staging and labels follow |
| `setReducedMotion(r)` | Cloth and foliage motion down to a quarter, slower smoke, no pulse; NPCs keep their routines |
| `setVisible(v)` | Hides everything and removes `RayInteractable`/`PokeInteractable` from the proxies, so no hover or press survives a hide |
| `setPaused(p)` | `update()` returns early; the scene still renders |
| `getStaging()` | `scale`, `footprint`, `surfaceCenter`, `panelAnchors`, landmark pick centres, all anchor-space metres |
| `getStats()` | `renderer.info` of the last frame (the whole frame, including any host panels), memory counts and recent `update()` deltas. `debugInfo()` adds the environment's own visible draws and triangles, texture memory, build and preparation times and the XR view count |
| `dispose()` | Terminates the worker, disposes proxies, geometries, materials, textures, the atlas and the sky, then `entity.dispose()` on both entities |

Development extras (not in the contract): `setMiniatureYaw(deg)`, `debugInfo()`, `ready`, `hovered`.

## Occlusion reveal (the representative stays visible)

While the Muster Grounds are focused (`focusLandmark('muster-grounds')`, the closest signal the
contract offers to "inspect the representative") and quality is medium or high, every `update()`
sweeps a sphere of 0.7 blueprint metres from the representative's chest (1.1 m above the Pawn stand,
or the injured rest place while injured) to the viewer's head. `sweepOccluders` in
`shared/legacy/environment/vr/reveal.ts` tests it analytically against the blueprint's
`blocksCamera` boxes (oriented, yaw only): no per-triangle raycasts and no allocation. A hit drives
a smoothed strength (rate 6/s) with a quarter second of clear sight before it fades out. While the
strength is above zero, the building, wall, roof, foliage and cloth materials (merged and
instanced) switch to their dissolve variants, compiled with everything else at load so the first
reveal never compiles a program. Fragments inside a capsule from the chest to the head, widening
toward the head, are discarded through a 4×4 ordered dither with a world-space noise edge and a
faint warm rim along the hole's edge; fragments clear of the capsule skip the noise and dither, so
the variants cost little beyond the capsule distance test and look exactly like the plain
materials. Terrain, figures, lit windows, water and the carved section never dissolve. Nothing
moves: not the viewer, not the miniature. Low quality keeps the plain materials.

## Staging, scale and comfort (measured from the shared data; not yet tried in a headset)

Anchor convention, as implemented by gameplay's Quest Legacy experience: the anchor's origin is the
viewer's eyes at recentre, yaw only, −Z ahead. (The blueprint's `vr.anchorConvention` text still
assumes a floor origin; the environment follows gameplay's actual anchor and converts the blueprint's
floor heights into eye-relative offsets.)

| Parameter | Value | Source |
| --- | --- | --- |
| Display scale | 1:125 (0.008 m per blueprint metre) | `vr.displayScale` |
| Miniature (detail region) | Korvenia 1.04 × 0.99 m, Solforiz 0.90 × 0.90 m, Aethelgard 1.06 × 1.09 m, Kwind-09 0.99 × 0.90 m | `vr.detailExtent` |
| Skirt | 150 m far (1.2 m), 70 m each side (0.56 m, the outer half fading into mist), nothing toward the viewer | `vr.skirtMargins`, `VR_SIDE_SOLID` |
| Seated | surface (datum) 0.46 m below the eyes, centre 0.82 m ahead | `vr.seated` (0.74 m surface, 1.20 m eyes) |
| Standing | surface 0.64 m below the eyes, centre 0.85 m ahead | `vr.standing` (0.98 m, 1.62 m) |
| Near edge | 0.32 m (seated) / 0.35 m (standing) from the eyes for Korvenia; 0.28 / 0.31 m for Aethelgard; 0.37 / 0.40 m for Solforiz and Kwind-09 | detail depth |
| Tallest structure | The holding stays below the eyes in both postures: its highest point (hall pennant at tier 3 for Korvenia and Kwind-09) is 0.07 / 0.08 m below seated eye level for Korvenia / Kwind-09, 0.11 m for Solforiz and 0.20 m for Aethelgard (0.18 m more standing). Land and buildings on the far skirt, 1.5–2.2 m away, can rise above seated eye level where the terrain climbs behind the holding: Aethelgard's ridge reaches 0.19 m above, one Solforiz building 0.02 m | prepared quest geometry; asserted in `environment-vr.test.ts` |
| The nation beyond | Far land to 3.5 km (about 28 m), distant places and ranges at their silhouette placements (about 40–50 m), hazed; beyond 900 m their heights are forced ×2.1 (places) and ×1.5 (ranges) about their own ground, plan positions unchanged | quest profile `farTerrain`, `SILHOUETTE_RING`, `VR_SKYLINE_EXAGGERATION` |
| Rotation | The miniature (never the viewer) turns within ±45° in 15° snaps through `setMiniatureYaw`; the worker re-prepares the table-top at the new yaw so the near cut and the fades stay relative to the viewer (0.2–1 s here, the current view stays until it is ready). Recentring returns it to the authored orientation in the harness. The contract has no rotation call yet | `vr.rotation` |
| Interaction reach | Landmark pick spheres 5.6–11.2 cm in radius (≥ the 3.5 cm minimum), every pick sphere's top at least 0.17 m below the eyes; landmarks sit 0.59–1.15 m from the eyes seated and 0.75–1.23 m standing, well inside the 3 m ray reach. Direct poke (0.65 m reach) needs a lean for most landmarks: the nearest are Aethelgard's Muster Grounds at 0.59 m and Solforiz's Herald's Station at 0.66 m | `vr.reach` |
| Recentring | Gameplay re-places its anchor at the eyes with the head's heading; the environment's staging is relative to the anchor, so the miniature, labels and panel anchors follow. The environment never moves or rotates the viewer, including on focus and selection | `vr.recentre` |
| Panels | Solved per nation, posture and rotation against the miniature's height envelope (`shared/legacy/environment/vr/staging.ts`). Over all four nations, both postures and the seven rotation steps: primary panel to the left at −40° to −44° yaw, 1.00–1.30 m, pitch −2° to +10°; dock to the right at +40° to +44°, 1.05–1.25 m, pitch −3° to −12°. Both clear every structure by at least 3.5 cm at 150 % text width and keep the central ±14° of the view (the holding and its skyline) clear at 100 % | `getStaging().panelAnchors` |

Gameplay's panel sizes (720 × 490 and 720 × 98 UIKit units at 0.15) and its growth rules (the
panel grows upward, the dock downward) are encoded in `QUEST_LEGACY_PANELS`; if they change, the
solver needs the new numbers.

## Budgets (founded fixture, high; IWER emulation in software)

Measured by `scripts/capture-legacy-environment.mjs` in an active emulated session
(`artifacts/legacy-environment/latest/evidence.json`, 2026-10-29). Per-eye numbers are the frame's
`renderer.info` divided by the two views the emulator draws (it has no multiview); the frame
includes the harness caption and controls and the emulator's hands and rays.

| Nation | Environment alone (visible draws / triangles) | Whole harness frame per eye | Albedo sets / texture memory |
| --- | --- | --- | --- |
| Korvenia | 66 / 177k | 79 / 188k | 19 / 26.7 MB |
| Solforiz | 49 / 112k | 62 / 123k | 12 / 17.3 MB |
| Aethelgard | 53 / 89k | 64 / 97k | 11 / 16.0 MB |
| Kwind-09 | 57 / 103k | 61 / 112k | 15 / 21.3 MB |
| Quest budget (`docs/legacy/PERFORMANCE.md`) | | 120 / 250k | |

Upper bound before state gating and quality thinning (every merged group and instance draw plus
sky, smoke and emphasis): Korvenia 107, asserted ≤ 120 for every nation in
`environment-vr.test.ts`; the triangle bound is asserted ≤ 250k the same way. Texture memory
includes mipmaps and the 512² heraldry atlas (1.4 MB). `iwsdk scene render-stats`: 48 programs,
0 shadow casters, shadows off; no point lights, no post-processing. On a Quest,
`OCULUS_multiview` draws both eyes in one pass. Build in the worker 0.5–2.3 s plus 0.15–0.65 s
preparation on this shared, heavily loaded 4-CPU host. Emulated frame intervals (median about
0.8 s) are software-rendered (SwiftShader) and say nothing about Quest frame rate.

## Development harness and captures

- `?legacyEnvironment` (seam in `src/index.ts`) opens `harness.ts`: the menu nodes are hidden and
  lose their interactables, an anchor is placed at the eyes, and the environment shows labelled
  development fixtures only, with a "Development fixture" caption plate at the primary panel anchor
  and a label on the carved section. Query parameters: `nation`, `fixture`
  (`unfounded|founded|injured|captive|returned|recognised`), `quality`, `posture`, `yaw`, `panels=1`
  (gameplay panel areas), `reducedMotion=1`, `fbScale` (development only: XR framebuffer scale for
  software emulation). The page's Enter VR button starts the session; the first XR frame recentres;
  world-space buttons at the dock anchor switch fixture, nation, posture, quality, turn the
  miniature, recentre and show the panel areas. `R` recentres in the browser preview.
- Scripts drive the harness through the runtime-registered `LegacyEnvironmentHarnessState`
  component (`harness-components.ts`) with `npx @iwsdk/cli ecs set-component` and read it back with
  `ecs query`: settings, `command`/`commandSeq` (`recenter`, `focus:<id>`, `highlight:<id>`,
  `stats`), hover and select counters and a JSON `report` (debug info, staging and world-space
  targets such as the Pawn's chest).
- `node scripts/capture-legacy-environment.mjs [--out artifacts/legacy-environment/latest]
  [--nation korvenia] [--fixture founded] [--quality high] [--fb-scale 0.35] [--nations a,b,...]
  [--only seated,wide,standing,lean,reveal,select,fixtures,stereo,stats,nations] [--workspace dir]
  [--no-stereo] [--keep-runtime] [--shot element|iwsdk]` (from `main-game-vr/`) starts the
  runtime when needed (`dev up --headless --allow-browser-automation`), opens the harness, enters
  XR through Enter VR with hands only (controllers disconnected) and writes mono 60° captures, a
  wide staging view, a lean-in on the Pawn, the occlusion reveal from a low lean behind the lower
  town, a War Record emphasised after a real hand-ray pinch (the select callback is asserted),
  fixture changes, optional stereo, the other nations, `renderStats`, an emulator frame-timing
  sample and `evidence.json`. During each pinch the emulated head looks at the sky so software
  frames stay inside the pointer click window; the ray, its target and the pinch are unchanged.
  Captures are Playwright screenshots of the app frame with the emulator and workspace overlays
  hidden (`--shot element`, the default) because `iwsdk browser screenshot` (`--shot iwsdk`)
  repeatedly closed the managed browser mid-capture during XR sessions on this loaded host, every
  time in the reveal view; `evidence.json` records the method per capture. The script stops the
  runtime afterwards only if it started it (`--keep-runtime` keeps it); otherwise stop it with
  `npx @iwsdk/cli dev down`.

## Verification record

| What | Where verified |
| --- | --- |
| Frame transform, presence fade, near cut, carved section, determinism, budgets, landmark targets, the holding below eye level, panel clearance and comfort, rotation re-preparation, occlusion sweep | `shared/legacy/tests/environment-vr.test.ts` (pure Node: `npx tsx --test ../shared/legacy/tests/environment-*.test.ts` from `main-game-vr/`; the seam for gameplay's `test:legacy` glob) |
| Contract behaviour, staging numbers, hand-ray hover and select callbacks, focus emphasis, occlusion reveal, fixtures, stereo, other nations, budgets | IWER Meta Quest 3 emulation in IWSDK's managed headless Chromium (software WebGL), `artifacts/legacy-environment/latest/` |
| Comfort, scale, legibility, tracking, frame rate, thermal behaviour | **Not verified on hardware.** Needs a person with a Quest |

## Provenance

All geometry is generated by the shared kits from blueprint data and prepared by
`shared/legacy/environment/vr/`; all textures are generated by
`scripts/generate-legacy-environment-textures.ts`; the heraldry atlas is rasterised at runtime;
labels are drawn with the page's canvas. No external models, images or fonts.
