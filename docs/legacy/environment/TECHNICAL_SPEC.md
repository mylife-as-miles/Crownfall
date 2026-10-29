# The Bannerhold — technical environment specification

The shared pipeline that turns one blueprint into the same holding on desktop (`main game/`, three)
and Quest (`main-game-vr/`, IWSDK super-three). Read with `BIBLE.md` (design), `STYLE_GUIDE.md`
(kit language), `docs/legacy/WORKFLOWS.md` (contract and seams) and `docs/legacy/PERFORMANCE.md`
(budgets and measurement). File paths below are the current implementation in this branch; where a
section describes a contract not yet built, it says so.

## 1. Principles

- **One source of layout.** `shared/legacy/environment/blueprint/` is the only place positions,
  sizes, heights, materials, routes, slots, cameras and VR staging are authored. Renderers, maps and
  tests read it; nothing re-authors layout.
- **Pure shared code.** Everything under `shared/legacy/environment/` is TypeScript producing plain
  data and typed arrays (`Float32Array`, `Uint32Array`, `Uint8Array`, `Uint8ClampedArray`). No three,
  IWSDK, React, DOM, storage, clock or `Math.random` (seeded PRNGs only). It typechecks for desktop
  (ES2022) and Quest (ES2020, no `Array.prototype.at`, `findLast`, `Object.hasOwn`, `replaceAll`).
  `environment-blueprint.test.ts` scans every file for these rules.
- **Deterministic.** The same blueprint, state and quality profile produce byte-identical buffers.
- **Share data, never runtime objects.** Each platform converts buffers into its own geometries,
  materials and textures and disposes them itself.

## 2. Coordinates and the VR transform

Blueprint space: right-handed, +Y up, metres, +X east, +Z south, north −Z; yaw follows three.js
`rotation.y` (`blueprint/coordinates.ts`, `BIBLE.md` §3). Desktop uses blueprint metres directly as
world units. Quest maps blueprint → anchor space (the gameplay-owned parent entity):

```
anchor = R(yawAtRest) · ((p − [displayCenter.x, datumY, displayCenter.z]) · displayScale) + [0, surfaceHeight, −viewerDistance]
yawAtRest turns vr.viewerFacingBearingDeg to anchor −Z; posture (seated | standing) picks surfaceHeight and viewerDistance.
```

`QuestStagingInfo.scale = displayScale`, `footprint = detailExtent × displayScale`, panel anchors
from `vr.panelAnchors`, landmark positions from the same transform applied to `pickCenter`.

## 3. Pipeline

```
blueprint (data, validateBlueprint)          shared/legacy/environment/blueprint
   │  + LegacySceneState (gameplay)           shared/legacy/environment-contract.ts
   │  + quality profile                       shared/legacy/environment/quality.ts
   ▼
buildBannerhold(input)                        shared/legacy/environment/build/buildBannerhold.ts
   ├─ terrain field + far field               kits/landscape/*, kits/context.ts
   ├─ kit registry: site kits, building kits  kits/registry.ts, kits/packages/*
   ├─ geometry kernel → MeshBuffer/InstanceSet kernel/* (builder, primitives, roofs, triangulate, bake)
   ├─ materials (keys → definitions)          materials/library.ts
   ├─ heraldry atlas inputs                   heraldry/*, build/state.ts
   ├─ lights, smoke, fires, agents, colliders, slots, landmarks, staging, stats
   ▼
EnvironmentBuild (typed arrays + metadata)
   ├─ desktop: worker build → three scene     main game/src/legacy/environment/ (build.worker.ts, buildClient.ts, sceneAssembly.ts, materials.ts, textures.ts, sky.ts, atmosphere.ts, cameraRig.ts, picking.ts, life.ts, post.ts)
   └─ Quest: IWSDK entities (to be built)     main-game-vr/src/legacy/environment/ (createTransformEntity, AssetManager, RayInteractable/PokeInteractable, no per-frame allocation)
```

`EnvironmentBuild` carries `meshes` (static `MeshBuffer`s with part, material, positions, normals,
uvs, linear vertex colours, terrain splat weights, motion weights, per-vertex landmark ids, indices,
shadow flags, LOD, motion, state gate, bounds), `instances` (`InstanceSet` prototypes + column-major
matrices + tints), `lights` (practical point lights with priority and gate), `smoke`, `fires`,
`agents` (NPC bindings), `slots` and `initialSlots`, `colliders` (oriented boxes for camera
collision and precise picking), `field` (terrain heights), `landmarks` (anchor, pick sphere, camera
id, bounds), `staging` and `stats` (meshes, instances, draw calls, triangles, vertices, materials,
triangles by part). Desktop builds in a Web Worker so the main thread never blocks
(`PERFORMANCE.md` "off the critical path").

## 4. Blueprint module

| File | Exports |
| --- | --- |
| `types.ts` | `BannerholdBlueprint` and every part (terrain features, water, buildings and masses, walls, towers, gates, routes, destinations, landmarks, muster, slots, ceremony, story, vegetation, dressing, activity sites, NPC agents, outer territory, view corridors, expansion, cameras, VR staging, atmosphere, traditions) |
| `terrain.ts` | `createTerrainSampler` (height, surface, water level, slope), `buildHeightfield`, `valueNoise` — the one elevation model every consumer samples |
| `buildings.ts` | `resolveBuildingBase` (floor from terrain + foundation), `massPolygon`, `buildingTopY`, `pointInMass`, `pointInTower` |
| `schedule.ts` | `compileSchedule`, `sampleAgent` (allocation-free), `createAgentPose` |
| `validate.ts` | `validateBlueprint`, `formatBlueprintErrors`, required story kinds and NPC roles |
| `math2d.ts`, `coordinates.ts`, `authoring.ts` | Plan geometry, the coordinate convention, authoring helpers for nation files |
| `nations/*.ts` | `KORVENIA_BLUEPRINT`, `SOLFORIZ_BLUEPRINT`, `AETHELGARD_BLUEPRINT`, `KWIND09_BLUEPRINT` |
| `index.ts` | `BANNERHOLD_BLUEPRINTS`, `getBannerholdBlueprint`, `PRODUCTION_DEFAULT_NATION`, `landmarkDescriptors` |

Change rules: blueprint changes are additive (new optional fields, new keys); renaming or removing
an exported name or a field the pipeline reads needs a coordinated change. Every edit keeps
`validateBlueprint` at zero errors, the tests green, and regenerates the maps
(`cd main-game-vr && npx tsx ../scripts/generate-legacy-environment-maps.ts`). Names and story lines
stay in the nation files (working placeholders).

## 5. Kits, prefabs and parallel authoring

`KitRegistry` (`kits/registry.ts`) assembles **kit packages** so several agents can add kits
without editing the same files:

- A `KitPackage` contributes `buildingKits` keyed by the blueprint `kit` id and/or `siteKits` with
  an `order` (terrain, water, routes, fortifications, dressing, vegetation, outer, figures, ...).
- Building kits resolve by exact id (`kv.manor.banner-hall`), then the prefix-free id
  (`manor.banner-hall`), then the family (`manor.*`), then the generic architecture kit, which
  builds any blueprint mass with its tradition's openings, plinths, courses and roof
  (`kits/architecture/*`, styles in `kits/nations/style.ts`).
- **Kit ids** follow `<nation prefix>.<family>.<name>` (`kv`, `sf`, `ag`, `kw`; for example
  `ag.hall.longhall`, `kw.block.worker-gallery`). A new kit is a new file plus one line in a
  package; packages are listed once in `kits/packages/index.ts` (`DEFAULT_PACKAGES`). One owner per
  package file; landmark kits live in `kits/landmarks/<landmark>/`.
- **Tradition styles** are keyed by blueprint `tradition`. Korvenia's three are tabled; Solforiz,
  Aethelgard and Kwind-09 need their own entries from `STYLE_GUIDE.md` §3 — Kwind-09 needs new
  kinds (heritage, ferro, sheet) and must not fall back to timber jetties.
- **Blender GLB prefabs (contract, not yet built).** A building or site kit may place a prefab by
  id instead of emitting procedural geometry: the build records `{ prefab, transform, gate }`;
  renderers load `main game/public/assets/legacy/environment/<prefab>.glb` (Quest copy synced by
  `scripts/sync-legacy-environment-assets.mjs`, loaded through `AssetManager`). Prefabs keep the
  blueprint mass envelope (validator volumes) and the material keys of §6; baked lightmaps travel
  as a second UV set and texture. Every asset's generating script is committed beside it and listed
  in an asset README with provenance. Swapping a kit for a prefab changes no other code.

## 6. Materials, textures and the heraldry atlas

- `materials/library.ts` defines `MaterialDefinition`s (shading `standard`, `terrain`, `foliage`,
  `cloth`, `glass`, `emissive`, `water`, `smoke`, `silhouette`; colour, roughness, metalness,
  texture set, world or unit UVs, emissive, Quest fallback colour). Common materials (roads,
  timber, iron, gilt, glass, cloth, foliage, fire, water, silhouettes) plus one set per nation keyed
  by the blueprint's material keys; unknown keys resolve by keyword.
- **Kwind-09 has no material set yet** — its keys (`kw-concrete`, `kw-brick-soot`, `kw-steel-panel`,
  `kw-corrugated-sheet`, `kw-rusted-steel`, `kw-glass-grid`, `kw-ceramic-tile`,
  `kw-copper-verdigris`, `kw-asphalt-felt`, `kw-timber-lattice`) need definitions and texture sets
  (`STYLE_GUIDE.md` §4); the keyword fallback renders brick and glazing as stone.
- **Status on 29 Oct (probe of `buildBannerhold` at `desktop-medium`):** Aethelgard renders all 8
  of its authored building materials; Solforiz 6 of 7 (`sf-palm-timber` undefined); Kwind-09 none
  of its 10. The fortification, dressing and outer kits still emit Korvenia keys (`kv-basalt-*`,
  `kv-limestone`, `kv-slate`, `kv-shingle`, `kv-lead`) in every nation; they should take the
  nation's own wall, roof and paving keys from the blueprint.
- **Texture sets** are generated from recipes (generator, palette, seed, tile metres) — no external
  downloads — at 1024 px for desktop-high and 512 px for every other profile, with mipmaps; Quest
  can run untextured (flat `quest.color` × vertex colour). Architecture uses world-space UVs on tiling
  sets; trims (frames, copings, ridge caps) are separate materials, which keeps texture memory small
  without per-building textures.
- **Heraldry atlas.** One atlas texture holds every cloth: the banner (`player`), the allied and
  rival houses, the crown standard (nation colours `atmosphere.palette.crownField`/`crownBorder`),
  undyed cloth before founding and veils. Rasters come from gameplay's heraldry module
  (`rasterizeHeraldry`, straight-alpha sRGB, row 0 at the top). `heraldryKey` changes only when the
  heraldry changes, so the atlas refills only then.

## 7. Instancing, LOD and distance

- Repeated geometry is instanced: vegetation, props, file markers, honour niches, figures
  (`InstanceSet`: one draw per prototype mesh). Static architecture is merged by material within a
  part; `landmarkIds` per vertex keep merged landmarks individually highlightable.
- Building `lod` (`hero`, `mid`, `background`) and the profile's `detail` (0–2) decide openings,
  courses and extras; background buildings keep silhouette, roof and window rhythm.
- Terrain: a fine core grid around the datum growing geometrically outward (`quality.terrain`),
  then far-terrain rings to the horizon. Distant places and skyline layers are low-poly silhouettes
  with aerial perspective (`kits/outer/distant.ts`).
- Life: agents update at full rate within 60 m, reduced within 160 m and hide beyond 420 m (far
  agents: reduced to 600 m, hidden beyond 1.6 km) — per agent in the blueprint.

## 8. Baked lighting and Quest

Quest keeps the identity without frame-rate-hostile features: no real-time shadow maps, no practical
point lights (`maxLights: 0`), no post-processing. `kernel/bake.ts` bakes contact darkening, grime
and — for the Quest profile (`bakeDirectional: true`) — the key light's directional term into vertex
colours; fires, candles and windows read through emissive materials. Desktop medium and high use one
bounded shadow map from the key light and a capped number of practical lights.

## 9. Quality profiles and budgets

Profiles (`shared/legacy/environment/quality.ts`) trade detail against the budgets in
`docs/legacy/PERFORMANCE.md`. The same blueprint builds at every profile.

| Profile | Contract preset | Detail | Terrain core cell | Vegetation | Dressing | Agents | Textures | Shadows | Lights | Budget (draws / triangles in view) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `desktop-low` | desktop `low` | 0 | 2 m | 0.35 | off | 8 | 512 | off | 0 | ≤ 120 / ≤ 300k |
| `desktop-medium` | desktop `medium` | 1 | 1.25 m | 0.7 | on | 24 | 512 | 2048 | 3 | ≤ 200 / ≤ 800k |
| `desktop-high` | desktop `high` | 2 | 0.8 m | 1 | on | 40 | 1024 | 4096 | 6 | ≤ 400 / ≤ 1.5M |
| `quest` | Quest `high`/`medium`/`low` | 1 | 1.6 m | 0.45 | on | 16 | 512 or none | off | 0 (baked) | ≤ 120 / ≤ 250k |

Quest `medium` and `low` should scale the `quest` profile down (vegetation × 0.75 / × 0.5, agents
12 / 8, smoke off on low) rather than introduce new features. Texture memory on Quest stays small:
512 px sets and one heraldry atlas (target ≤ 32 MB of GPU textures). Script time per frame ≤ 4 ms
desktop / ≤ 5 ms Quest with no per-frame allocation; no long tasks during interaction.
`EnvironmentBuild.stats` reports draw calls and triangles per build; the renderers report
`renderer.info` (desktop) and `renderStats` (Quest emulator). Frame timings measured in this
container are software-rendered (SwiftShader) and are not representative.

Whole-build counts from `EnvironmentBuild.stats` on 29 Oct (every mesh, before culling; the
Quest miniature is seen whole, so its whole-build count is the one that matters):

| Nation | `desktop-low` | `desktop-medium` | `desktop-high` | `quest` |
| --- | --- | --- | --- | --- |
| Korvenia | 168 / 248k | 182 / 514k | 182 / 754k | 180 / 316k |
| Solforiz | 138 / 205k | 149 / 330k | 149 / 458k | 149 / 235k |
| Aethelgard | 137 / 174k | 153 / 393k | 153 / 595k | 150 / 210k |
| Kwind-09 | 115 / 156k | 125 / 277k | 125 / 389k | 125 / 205k |

Draw calls exceed the `desktop-low` budget in three nations and the `quest` budget in all four,
and Korvenia's Quest triangles exceed 250k (vegetation is about 126k of them). The largest draw
groups are figure prototypes (about 29), per-material settlement meshes and landmark parts;
merging by material within a part, fewer figure prototypes and thinner Quest vegetation are the
first levers. These are CPU-side counts, not hardware measurements.

## 10. Gameplay state → environment

The environment renders `LegacySceneState` (= `BannerholdPresentation`) and never computes results.
`build/state.ts` derives scene flags and slot counts; meshes carry `StateGate`s (minimum or maximum
hall tier, flag) so most changes toggle visibility or instance counts instead of rebuilding. Only a
nation change rebuilds.

| State | Environment response |
| --- | --- |
| `nationId` | Which blueprint builds (`getBannerholdBlueprint`); the only change that rebuilds |
| `founded`, `draft` | Flag `founded`: cloth dyed with the banner's heraldry; before founding, undyed cloth. During the founding ceremony the draft heraldry is raised at `slots.foundingStandard` and the `founding` framing is used |
| `heraldry` | The atlas's player cloth on every `player` banner mount reached by the hall tier |
| `bannerName`, `rank`, `chronicleCount`, `unresolvedCount` | Labels and panels only (gameplay UI); no geometry in v1 |
| `hallTier` | Unfinished structure visible while tier 0 (gate `maxHallTier: 0`), completed from tier 1; `appearsAtHallTier` buildings, `bannerMounts.minHallTier`, `slots.hallTiers[].dressing` and expansion-zone development appear at their tier |
| `honours` | Honour niches fill in order (count capped by `slots.honourNiches`); empty niches stay empty |
| `representative.status` | `available`: the Pawn figure on `muster.pawnStand`; `injured`: the figure at `slots.injuredRest` (only when an injury is recorded); `captive`: the stand empty, `slots.captiveMarker` shows a sealed writ in the captor's colours; returned (`recentlyReturned`): figure restored; `promotedTo`: a promotion token at the stand, no political change |
| `representative.file`, `eligibleFiles`, `claimedFiles` | The nominated file's marker in the banner's colours; claimed files marked for their houses; open files plain |
| `levy` | Available members other than the representative fill `muster.levySlots` |
| `matchMarkers` | `slots.recordMarkers` on the War Record table, tinted by outcome (`markerTint`) |
| `unreadNotices`, `noticeKinds` | `slots.noticeBoard` positions filled; `rival-challenge` raises the sealed rival correspondence at `slots.rivalCorrespondence` (flag `rival-challenge`) |
| `alliedHouse` | Flag `allied-house`: the allied seat (`outer.places` with `stateSlot: "allied-house"`) and `slots.alliedEnvoy` fly the ally's heraldry |
| `rivalHouse` | Flags `rival-house` and `frontier:<nation>`: the frontier place whose `frontierNation` matches flies the rival's colours; `holdsCaptive` colours the captive marker |
| `mode: "preview"` | Harness shows `DEVELOPMENT_FIXTURE_CAPTION` ("Development fixture · environment preview · not saved"); never persisted |

Landmark interaction: hover and select report `LandmarkId`s through the platform callbacks; picking
uses the landmark pick spheres, refined by colliders on desktop. `focusLandmark(id)` moves the desktop
camera to `landmark:<id>` and only emphasises on Quest.

## 11. Motion and life

- **Agents:** `npcs[]` schedules compiled once (`compileSchedule`) and sampled each frame with
  `sampleAgent` into a reused pose; heights follow terrain, wall walks (`wallTop`) or elevated decks.
  Figures are cheap instanced rigs with activity poses (walk, hold activities).
- **Mesh motion:** cloth (banners, laundry), sway (foliage, reeds), flicker (fires, candles), smoke
  billboards, water flow — all vertex-stage effects driven by `MeshBuffer.motionWeights` and the
  blueprint `atmosphere.wind`. A renderer that cannot animate draws the static pose.
- **Reduced motion:** cloth and sway amplitudes drop to a gentle minimum, smoke slows, agents keep
  their routines but camera transitions shorten to cuts or short fades.
- **Pause:** `setPaused(true)` stops the clock for life and motion; Quest `update()` returns early.

## 12. Fixtures and harnesses

`shared/legacy/environment/fixtures.ts` provides labelled preview states (`unfounded`, `founded`,
`injured`, `captive`, `returned`, `recognised`) in `mode: "preview"` for each nation. The desktop
harness (`?legacyEnvironment`) and the Quest harness show the caption on screen. Production scenes
never contain hardcoded victories, captives or honours.

## 13. Verification plan

| Check | Where | When |
| --- | --- | --- |
| Blueprint validation (all four nations, zero errors) | `validateBlueprint`, `environment-blueprint.test.ts` | Every blueprint change |
| Blueprint rules, nation distinctness, prose hygiene, platform neutrality, determinism | `environment-blueprint.test.ts` | Every change (`npm run test:legacy`) |
| Maps and massing previews regenerated from the data | `scripts/generate-legacy-environment-maps.ts` | Every blueprint change |
| Build determinism, every nation × profile builds, budgets from `stats` | pipeline `environment-*.test.ts` | Every pipeline change |
| Captures of every framing per nation and profile; draw calls, triangles, programs | desktop Playwright scripts (`main game/scripts/*environment*`) | Each evidence round |
| `PERFORMANCE.md` protocol (long tasks, script time, heap and `renderer.info` across round trips, 4× CPU throttling) | desktop | Each evidence round |
| Quest emulator: `renderStats`, allocation-free `update()`, staging and picking | IWSDK runtime | Each evidence round |
| Physical Quest comfort, scale, tracking and frame rate | a person with a headset | Not yet done — no hardware claims |
