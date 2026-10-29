# Chronicles — work status

*The Archive of Ash & Aether (working presentation title). Lead architect, end of M0, 29 October 2026.*

Read this file first after any context loss or in a new session, then
[`ARCHITECTURE.md`](ARCHITECTURE.md). Update it after every meaningful iteration. The creator's
directive and the approved content pack are supplied to agents outside version control; never copy
private briefs into this repository.

## 1. Current implementation status

**Milestone:** M0 (resume and architecture audit) is complete. M1 is planned (§5). Its
implementation has not started, and gate G1 (blueprint acceptance) is still open.

**What selecting Chronicles does today.** The Home tile no longer opens an unavailable-information
dialog on either platform.

- **Desktop:** Home → Chronicles opens a full-screen `chronicles` menu screen with three exhibit
  tabs. *The Atlas* is a real-time 3D relief of the painted map on a dark table, with four nation
  rings, camera flights to each nation and a record panel. *The Interregnum* is a 2D timeline of
  four stops. *The Laws of the Gambit* shows three 2D articles. Back closes an open record, then
  returns Home with the Chronicles tile selected and focused.
- **Quest:** Home → Chronicles shows `View_Chronicles` in the world-space menu panel, with exhibit
  tabs and one button per nation, stop and article. The Atlas relief diorama sits on a table below
  the panel. Records open in the panel. Back, Pause and Resume keep the exhibit and record.

This is the Brief E archive, upgraded with a 3D relief. It is a menu screen with a 3D backdrop, not
yet the directive's archive environment.

### Component classification

Status values: **complete** (meets its current scope and is verified), **partial**, **placeholder**
(stands in for a required directive feature), **broken** (its last verification failed or it
breaks an existing check) and **missing**.

| Area | Component | Path | Status | Evidence and notes |
| --- | --- | --- | --- | --- |
| Shared | Approved archive copy: 11 records, 3 exhibits, 4 labels, map metadata | `shared/chronicles/content.ts` | complete | Verbatim. Private verifier 283 passed, 0 failed. Exports are frozen. |
| Shared | Navigation helpers (hotspots, timeline stops, articles, map hit test) | `shared/chronicles/content.ts` | complete | Covered by `content.test.ts` (9 tests, including the guard) |
| Shared | Domain types | `shared/chronicles/types.ts` | partial | Record, exhibit, label and map only. No canon status, events, sources, perspectives, artifacts, discovery or scene state. |
| Shared | Content-status layer: canon status, "Working proposal" marker, one visibility switch with a test | — | missing | Specified in ARCHITECTURE §7 |
| Shared | New text modules (exhibit captions, the Debt of Blackmere example, piece battlefield roles, short accounts) | — | missing | None written and none approved |
| Shared | Hashed guarded-phrase test | `shared/chronicles/content.test.ts` | complete | In M0 it was extended to every module under `shared/chronicles`. A negative control in a scratch copy catches a phrase planted in a nested module. |
| Shared | Living Atlas relief: heightfield, landforms, views, camera limits, markers, ray hits, living details | `shared/chronicles/archive/relief.ts` (+ test) | complete | 15 tests. Deterministic and pure. Reusable as the core of the central monument. |
| Shared | Scene-state reducer used by both platforms | — | missing | Quest keeps its own exhibit and record state in `quest-state.ts`. Desktop keeps its state in React. |
| Shared | Future War Record interface | — | missing | Types only, in ARCHITECTURE §8 |
| Desktop | Home → Chronicles routing, Back, Q/E, return from Settings and Showcase | `main game/src/App.tsx` | complete (Brief E) | M0 capture: Back returns Home with the tile selected |
| Desktop | Pausing the menu loops while Chronicles is open | `main game/src/App.tsx` | partial | Atmosphere is forced to quality `low` (its WebGL context is destroyed and rebuilt on exit). The sorcerer is frozen through `reducedMotion`, but its canvas and context stay alive. |
| Desktop | Chronicles screen: tabs, record panel, labels, footer, keyboard, gamepad, mouse | `main game/src/Chronicles.tsx`, `.css` | partial | No loading indicator: the stage stays hidden until it is ready. Without WebGL it falls back to the flat painting. |
| Desktop | Interregnum and Laws presentation | `main game/src/Chronicles.tsx` | placeholder | 2D DOM panels stand in for the Annals mechanism and the Gambit exhibit |
| Desktop | Relief renderer: its own `WebGLRenderer`, sliced build, camera flights, orbit/zoom/pan limits, pointer, gamepad, labels, disposal | `main game/src/chronicles/scene/AtlasScene.ts` | complete (Brief E) | M0: 19 draw calls and 306k triangles at high, 19 and 227k at medium. Canvas released on exit. |
| Desktop | Table, lights and bronze frame | `main game/src/chronicles/scene/atlas-set.ts` | partial | The table is replaced by the archive plinth in M1 |
| Desktop | Living details (sea, mist, eclipse, embers, falls, rivers, dust) | `main game/src/chronicles/scene/atlas-details.ts` | complete | Reusable |
| Desktop | Relief markers | `main game/src/chronicles/scene/atlas-markers.ts` | complete | Reusable |
| Desktop | Map preload during boot | `main game/src/useBootLoading.ts` | complete | |
| Desktop | Chronicles verification suite | `main game/scripts/verify-chronicles.mjs` | broken | Last run (15:48) failed at 1280×720: "another ring is in view beside the open record". It also recorded a 4.3 s long task on open. |
| Desktop | Home artwork hash manifests | `main game/artifacts/home-artwork.json`, `visual-review.json` | broken | `deliveryPath` points at the cleaned map, but `deliveryBytes` and `deliverySha256` still describe the original painting (615 504 B, `2b9efe06…`). The delivered file is 537 628 B, `d9f143ad…`, so the hash assertion in `verify-home.mjs` would fail. Not run in M0. |
| Quest | Chronicles state: screen, exhibit, record, map hit, Back, pause and resume | `main-game-vr/src/quest-state.ts` (+ tests) | complete (Brief E) | 7 Chronicles tests and 1 adjusted Home test |
| Quest | Generated `View_Chronicles` (tabs, nation/stop/article buttons, record panel) | `scripts/generate-quest-ui.ts` → `public/ui/menu.uikitml` | complete (Brief E) | 299 elements, in sync. 2D panel layout. |
| Quest | Runtime wiring: diorama lifecycle, atmosphere hold, hidden sorcerer, browser-preview framing, selected-control reporting | `main-game-vr/src/crownfall-system.ts` | complete (Brief E) | |
| Quest | Atlas diorama: sliced build, baked vertex light, unlit materials, Ray and Poke markers, posture placement | `main-game-vr/src/chronicles/scene/atlas-diorama.ts` | complete (Brief E) | Brief E capture: 19 draw calls and 50.9k triangles in the browser preview. Reusable as the Quest monument. |
| Quest | Contract ids, layout and `questText` | `main-game-vr/src/ui-contract.ts` | complete | |
| Quest | Map texture in the manifest | `main-game-vr/src/assets.ts` | complete | |
| Quest | Capture script | `main-game-vr/scripts/capture-chronicles.mjs` | broken | Last run (16:07) failed "Bare ground at the map centre takes the pointer and selects nothing". No immersive (XR) capture or hand-input evidence was recorded. |
| Quest | Hands-first immersive interaction | — | unverified | No XR evidence and no physical headset test |
| Sync | Chronicles parity in `check:sync` | `scripts/check-chronicles-sync.ts`, hooked from `scripts/check-menu-sync.ts` | complete | Moved in M0 out of the shared check. Negative controls fail as expected. |
| Assets | Map (central tower removed, working choice), mirrored to Quest | `main game/public/assets/chronicles/chronicles-map.webp` | complete | Byte-identical on Quest. Provenance is recorded only here (§2) until the M1 manifest exists. |
| Collections | Archive environment: architecture, lighting, atmosphere, annotated blueprint | — | missing | M1 |
| Collections | Living Atlas | relief + markers | partial | The relief and per-nation emphasis exist. Missing: the architectural and cultural identity reveal, environmental vignettes and the political-structure presentation. |
| Collections | Annals mechanism | — | placeholder | 2D timeline |
| Collections | Laws of the Gambit exhibit: ceremonial formation and piece inspection | — | placeholder | 2D articles |
| Collections | Contested Record: perspectives, sources, provenance, evidence classes | — | missing | |
| Collections | Occlusion reveal for focused exhibits | — | missing | Needed once architecture can stand between the camera and an exhibit |

## 2. Reusable components

| Component | Reuse in the archive |
| --- | --- |
| `shared/chronicles/content.ts` | The approved layer of the registry, unchanged |
| `shared/chronicles/archive/relief.ts` | The heightfield, ray hits, markers, views and living details of the central Living Atlas monument on both platforms |
| `scene/AtlasScene.ts` | Its camera rig, picking, sliced build and texture path become the Atlas focus mode and monument module of the single desktop archive renderer |
| `scene/atlas-details.ts`, `scene/atlas-markers.ts` | Kept as monument modules |
| `scene/atlas-set.ts` | Its lighting values seed the archive's key light. The table is retired. |
| `scene/atlas-diorama.ts` | Becomes the Quest monument: same build, baking and markers, scaled to the archive station |
| `quest-state.ts` Chronicles events and tests | Migrate into the shared scene-state reducer (ARCHITECTURE §4.7) |
| `generate-quest-ui.ts` Chronicles view and `ui-contract.ts` ids | The control surface for Quest collections. `View_Chronicles` keeps its id. |
| `check-chronicles-sync.ts` | Extended with every new collection |
| Verification scripts | Their harnesses (instrumented page, controller mock, long-task capture, runtime CLI driver) are reused once they write to milestone folders |
| Map asset, `sync-menu-assets.mjs` directory sync | Any file added under `main game/public/assets/chronicles/` mirrors to Quest and is hash-checked |

Map provenance: supplied creator painting, 2048 × 1529, first delivered as
`main game/public/assets/home/chronicles.webp` (`2b9efe06…`). The orchestrator removed the central
tower by inpainting (creator decision, 29 October; working choice) and delivered
`chronicles-map.webp` (`d9f143ad…`). Agents never redraw or edit it.

## 3. Outstanding problems

| # | Severity | Problem | Owner | Next action |
| --- | --- | --- | --- | --- |
| 1 | Major | No archive environment. Chronicles is still a menu screen. | B, C, D | M1 |
| 2 | Major | Long main-thread tasks. M0 on this loaded software-rendered host: opening the Atlas at high produced a 12.1 s task; the record and exhibit interactions afterwards (open, close, tab switches) produced 396 ms and 585 ms; medium produced 5.7 s and 5.6 s while building. No loading indicator is shown meanwhile. The budget allows no long task over 50 ms once the archive is interactive. | C, B | Compile shaders and upload textures behind a visible loading state (no parallel compile under SwiftShader); profile the tab switch (React re-render, panel compositing); measure again |
| 3 | Major | The menu loops are rested through quality and motion overrides instead of being paused: Atmosphere's renderer is rebuilt on every exit and the sorcerer's context stays alive | C | Adopt the `suspended` prop exactly as `feat/my-legacy` implements it in `Atmosphere.tsx` and `CreatureStage.tsx`, once the orchestrator approves touching those files (they are not on the Chronicles shared-file list); otherwise wait for the Legacy merge |
| 4 | Major | Desktop `verify-chronicles.mjs` fails one framing assertion. The Quest capture fails the bare-ground hover check. No immersive XR evidence exists. | C, D | Decide whether other rings may stay visible behind the record panel; diagnose the ground proxy; record hand-ray and pinch evidence in an XR session |
| 5 | Major | No content-status layer, visibility switch or "Working proposal" marker | E | M1, before any proposal text ships |
| 6 | Minor | Stale delivery hashes in `home-artwork.json` and `visual-review.json` | C | Update them to the delivered map and prove it with a `verify-home.mjs` run |
| 7 | Minor | The verification scripts write to `artifacts/chronicles/` instead of milestone folders | C, D | Add a milestone argument |
| 8 | Minor | Quest shows typographic dashes as hyphens (UIKit's ASCII glyph atlas) | D | A documented platform adaptation; ask the creator to confirm |
| 9 | Minor | `main game/README.md` still says every Home tile opens an unavailable dialog | C | M6, coordinated with the Legacy README edits |
| 10 | Process | Orphaned Chronicles processes from earlier sessions are still running. Last seen at M1 planning (16:55 UTC): the desktop vite on port 5191 (PID 4697), and the scratch IWSDK runtime (vite PID 3060; its managed Chromium PID 27321 has a GPU process using about one CPU). The scratch runtime serves this checkout's sources through symlinks but keeps its own copy of `assets.ts`, so it goes stale as soon as M1 changes the manifest. M0 could not stop them, because the permission system refuses to stop processes this agent did not start. `npx @iwsdk/cli dev status` for this checkout reports no runtime. | Orchestrator | Stop both before B5, D2 and D3 need a runtime. Until then, start no second IWSDK runtime for this checkout and do not reuse the scratch one. |
| 11 | Info | The Brief E desktop captures (`main game/artifacts/chronicles/brief-e/`) predate the cleaned map and show the central tower. The Quest Brief E captures show the current map. | — | — |
| 12 | Info | Bundle sizes: the desktop main chunk is 1.03 MB (the relief is a lazy 48 kB chunk); the Quest main chunk is 2.5 MB | C, D | Keep all archive code in lazy chunks |

## 4. Current branch and commit

- Checkout: worktree `/home/user/crownfall-chronicles`, branch `feat/chronicles-archive` (renamed
  from `feat/chronicles`).
- Base: `feat/main-game-menu` at `29343c1`, the head of draft PR #1 (open, into `main`).
- Checkpoint: "chore(chronicles): resume Chronicles archive workflow with audit and architecture",
  `32464d0f7dee09c869788bb6fcce0dcb3d61368f`. This is the first commit on the branch, and it contains
  all earlier Brief E and Atlas work. It is pushed to `origin/feat/chronicles-archive`. The working
  tree was clean when M1 was planned.
- Remote branches seen in M0: `main` `6bc3a58`, `feat/main-game-menu` `29343c1`, `feat/my-legacy`
  `84ffcfc`, `feat/legacy-world-environment` `d568976`, and four `codex/*` branches. PR #1 is the
  only pull request.
- Other worktrees: `/home/user/crownfall` (`feat/my-legacy`, large uncommitted work in progress) and
  `/home/user/crownfall-env` (`feat/legacy-world-environment`, uncommitted work in progress). Read
  them only.

## 5. Proposed next increment — M1, Archive Environment (P0)

*Planned by the lead architect on 29 October 2026, about 17:00 UTC, from this file, ARCHITECTURE.md,
the M0 code and captures and the directive. The contracts it relies on are in ARCHITECTURE §4.5 and
§5.1.*

**Goal.** Home → Chronicles enters a real 3D archive on desktop and on Quest. The first settled frame
shows the central monument (today's Living Atlas relief on a carved plinth), the suspended mechanism
above it and the light falling into the chamber. The archive has an original Crownfall identity:
authored geometry, generated materials and controlled atmosphere, within budget on both platforms.
Spatial navigation works: authored collection framings on desktop, collection emphasis around a
stationary viewer on Quest, and Back on both. The environment owner first delivers the annotated
blueprint as data. The scene is composed from it only after the architect accepts it. A full
five-critic round must pass before M2 starts. Full Atlas interaction (vignettes, the identity reveal,
the relief's steep-slope fix) belongs to M2.

### 5.1 Decisions for M1

| # | Decision |
| --- | --- |
| D1 | **No new words.** M1 adds no on-screen text: no captions, proposals, interface strings or labels. The loading state is visual and is named by the approved title. A failure shows the flat painting with the same records, and re-entering Chronicles retries. |
| D2 | **Collections in M1.** The Atlas is *interactive*: today's nation selection, now on the monument. The Interregnum and the Laws are *framed*: an authored view of their bay, with today's approved records. The Contested Record bay is built but *dormant*: unlit, not selectable and absent from navigation until M5. |
| D3 | **Monument scale per platform.** On desktop the relief is about 4.5–5 m wide. Quest presents it at reachable table scale, sized by the blueprint's vantage tests. The plinth is parametric around the relief width, and the rest of the room is shared. |
| D4 | **Mechanism.** The suspended rings are built in M1 as the future Annals mechanism, one pivot per ring, and stay still until M3. Their future event band must already sit where a seated Quest viewer sees it comfortably. |
| D5 | **Desktop navigation.** Chronicles becomes a full-stage layer with the main navigation hidden and inert. LB/RB and Q/E cycle the collections inside the archive, as My Legacy cycles its landmarks (this settles ARCHITECTURE §12). Back unwinds through the shared reducer, then returns Home with the tile selected and focused. Chronicles exports its own handle type, so `settings-types.ts` stays unchanged. |
| D6 | **Quest presentation.** The viewer is never moved. While the archive is open, the menu panel takes the blueprint's control-surface pose beside the monument. Recenter re-places the room and the panel relative to the head, under a fade. |
| D7 | **Menu loops.** `Atmosphere.tsx` and `CreatureStage.tsx` are not on the shared-file list. M1 keeps the `App.tsx` overrides: the sorcerer pauses through reduced motion and the atmosphere drops to `low`. M1 measures the atmosphere rebuild on exit. The identical port of Legacy's `suspended` props stays with the orchestrator (problem 3). |
| D8 | **Occlusion reveal** is in M1 scope only if the blueprint's sweep test finds an authored desktop framing, within its orbit and zoom limits, where architecture can hide the focused exhibit. |
| D9 | **Canon in space.** Nothing marks the map centre: no spire, column, rod, hub, light pin or inlay. The light pool covers the monument broadly. The oculus shows only sky and light, never an exterior that places the archive. Ornament stays abstract and astronomical: no inscriptions, names, emblems, heraldry or narrative scenes. The room is not a library: shelving walls are never the dominant motif. |
| D10 | **Process.** Chronicles tests run through two Chronicles-owned aggregators, so the shared Quest `test` script changes only once. One IWSDK runtime at a time for this checkout. Desktop iteration renders come from a dev-only harness page that never enters the production bundle. |

### 5.2 Sequence and gates

1. **Phase 1, in parallel:** B1 blueprint, B2 kernel, B3 materials, E1 status layer and E2 scene state.
   D1 follows E2. C0 runs at any time.
2. **Gate G1:** the architect reviews the blueprint (A1). B4 and B5 compose the scene only after G1 is
   recorded in §1 of this file. Kernel and material work may continue during the review.
3. **Phase 2:** B4 desktop renderer, B5 Quest room, C1 desktop integration and D2 Quest integration.
4. **Phase 3:** C2 and D3 evidence. **Gate G2:** the five-critic round (A2), with up to three
   correction rounds. **G3:** the checkpoint.

**Preconditions.** The orchestrator stops the orphaned processes of problem 10. Until then, no agent
starts a second IWSDK runtime for this checkout. Nobody reuses the scratch runtime, because it keeps
its own stale copy of `assets.ts`. B5 and D2/D3 share one runtime: check `npx @iwsdk/cli dev status`
and the process list before `dev up`, and stop it with `dev down` when done. Desktop servers use ports
5190–5199. Each agent stops the servers it starts.

**Word rule for every file on a Chronicles path.** The private verifier scans, case-insensitively,
every tracked or new `.ts`, `.tsx`, `.css`, `.json`, `.md`, `.uikitml`, `.mjs` and `.html` file whose
path contains "chronicles" (tests excepted). It covers code, comments, scripts, docs and artifact
manifests. It rejects a short private list of substrings, which includes the word for the person
holding the controller. Even the IWSDK rig property of that name fails, and so does any compound
word that contains it. Write "viewer" or "visitor". Keep IWSDK calls that need that property in
`crownfall-system.ts`, and pass the head pose to the Chronicles modules. Run the verifier before
reporting any task as done.

### 5.3 Tasks

#### Content (E)

**E1 — Content-status layer, registry and the one switch.** Files: `shared/chronicles/status.ts`,
`registry.ts`, `types.ts`, `status.test.ts` and the aggregator `chronicles.test.ts` (it imports
`content.test.ts`, `status.test.ts`, `scene-state.test.ts` and `archive/archive.test.ts`).

- `CanonStatus`, `SourceReliability`, `ContentPolicy`, `CHRONICLES_CONTENT_POLICY`
  (`showUnapproved: true` in the draft build), `isCreatorApproved` and the marker strings ("Working
  proposal", "Placeholder"), stored as placeholder data that the switch hides (ARCHITECTURE §3, §7).
- A pure registry factory, plus `getChronicleEntries(policy)` and `getChronicleEntry(id, policy)`.
  Approved entries derive from `CHRONICLE_RECORDS` and reuse the same string objects. The proposal
  list is empty in M1.
- Acceptance:
  - With the switch off, the registry returns exactly the 11 approved records, in order, and no marker.
  - With it on, a fixture proposal defined in the test appears with its marker.
  - A duplicate or shadowing id throws.
  - A proposal fixture that carries a creator-approved status fails.
  - Status and label vary independently.
  - `content.ts` is unchanged (`git diff --exit-code 32464d0 -- shared/chronicles/content.ts`).
  - The hashed guard and the private verifier pass.

**E2 — Shared scene-state reducer.** Files: `shared/chronicles/scene-state.ts`,
`scene-state.fixture.ts`, `scene-state.test.ts` and `types.ts`.

- ARCHITECTURE §4.6, scoped to M1:
  - collections `atlas`, `interregnum` and `laws`; `contested` is refused while it has no visible
    entries;
  - focus `overview` or `nation`;
  - entries only from the active collection, and Atlas entries only from a nation;
  - `map` hits through `hotspotAt`, where empty ground and the centre do nothing;
  - `back` unwinds entry → focus → overview, and `canUnwind` false means the platform goes Home;
  - `loaded` sets ready, flat or failed.
- Pure and total: an invalid event returns the same object. The fixture is one event sequence with
  its expected states, which both platforms replay.
- Acceptance: the tests cover every rule above and restate the seven Brief E Quest Chronicles
  behaviours against the reducer.

#### Environment (B)

**B1 — The annotated blueprint as data (gate G1).** Files: `shared/chronicles/archive/types.ts`,
`blueprint.ts`, `blueprint.test.ts`, the aggregator `archive.test.ts` (it also runs
`relief.test.ts`), `scripts/chronicles/generate-archive-blueprint.ts`, and the generated
`docs/chronicles/ARCHIVE_BLUEPRINT.md`, `docs/chronicles/blueprint/archive-plan.svg` and `.png`, plus a
section drawing.

- Contents (contract in ARCHITECTURE §4.5):
  - the chamber footprint, levels and heights, and the oculus;
  - every architectural element: kernel builder or GLB, parameters, transform, instances, materials
    and occluder;
  - the monument (D3) and the mechanism (D4);
  - one exhibit per collection, with its presentation (D2);
  - desktop viewpoints: entrance, overview, one per collection, the nation framings (`RELIEF_VIEWS` in
    the monument frame) and a review-only framing of the dormant bay;
  - the Quest seated and standing vantages, with forward direction, comfort cone and control-surface
    pose;
  - lights: one shadow-casting key through the oculus (optionally with a tracery cookie for dappled
    light), fill, practicals and emissive accents, each dynamic or baked per platform;
  - haze, shaft and dust volumes;
  - interaction zones;
  - desktop camera paths: flights of at most 1.2 s, and an entrance settle of at most 1.5 s;
  - expansion points, occluders and budgets per quality.
- Acceptance, tests:
  - deterministic and pure (a static scan finds no three, React, DOM, `Math.random` or `Date`), and
    every number finite;
  - every exhibit and viewpoint inside the chamber, and no desktop eye inside an occluder or within
    0.3 m of solid geometry;
  - each framing's orbit and zoom range sampled on at least a 5 × 5 × 3 grid and swept against the
    occluders: either clear, or the hit occluders are listed on the exhibit (D8);
  - the overview frustum at 16:9 holds the whole monument, at least 60% of the ring band and the
    light shaft;
  - from both Quest vantages:
    - every exhibit within ±60° of forward;
    - the relief's far edge at least 22° below the eye when seated and 28° when standing;
    - its near edge at least 0.3 m ahead, and its top between 0.65 and 0.9 m;
    - markers at least 4 cm and at least 6% of the relief width;
    - the mechanism's future event band within ±60° and 10°–45° above the eye line;
    - the control surface clear of the monument's projected outline at 0° and −20° pitch;
  - no element within 0.4 m of the vertical line rising from the map centre, between the relief
    surface and the vault springing (D9);
  - at least two expansion points, one of them reserved for War Record exhibits.
- Acceptance, document:
  - The generator's `--check` exits 0 for the committed files, and non-zero after a deliberate data
    change (record this negative control).
  - The document gives real dimensions, the exhibit positions of all four collections, the desktop
    viewpoints and both Quest vantages, light sources, camera framings, interaction zones, navigation
    paths, expansion points, the occlusion analysis and the budgets. It embeds the plan PNG.
  - No on-screen text is added.

**B2 — Archive geometry kernel.** Files: `shared/chronicles/archive/kernel/*.ts` and
`kernel/kernel.test.ts`.

- Pure ES2020 builders that emit `ReliefMesh`-style typed arrays:
  - a profile library: fillet, torus, scotia, cavetto, cyma, astragal and bevel;
  - lathe, and sweep with mitred corners;
  - bevelled prisms;
  - arches (pointed, segmental, stilted) with voussoir joints and mouldings;
  - piers and columns: base, shaft with optional fluting, capital;
  - vault ribs and the oculus ring;
  - balustrades and steps;
  - ring bands with engraved grooves.
- Per-quality tessellation, sliceable generators like `reliefMeshSlices`, seeded variation and UVs in
  metres. An optional shared vertex bake serves both platforms: ambient occlusion from the blueprint
  volumes, oculus and sky visibility, and practical falloff. The Bannerhold kernel is an idea only and
  is never imported.
- Acceptance: tests for determinism, finite values, unit normals, indices in range, no degenerate
  triangles, watertight parts where declared, triangle counts within the declared per-quality budgets,
  a sliced build equal to the one-shot build, and purity.

**B3 — Materials, generated textures and provenance.** Files:
`shared/chronicles/archive/materials.ts`, `materials.test.ts`, `scripts/chronicles/textures/*`,
`main game/public/assets/chronicles/textures/*.webp` and
`main game/public/assets/chronicles/provenance.json`.

- An original material family: for example, warm limestone ashlar with weathering, a dark polished
  floor stone with worn paths, patinated bronze with engraving, carved abstract relief panels and
  small glowing lamp cores.
- Albedo, normal and ORM maps at 1024 (desktop medium and high) and 512 (desktop low and Quest),
  generated deterministically by committed scripts (TypeScript or Blender).
- The map is listed as the creator's painting, with the tower removed by orchestrator inpainting. It
  is used unmodified.
- Acceptance:
  - Every listed texture exists with its manifest hash. Every file under `assets/chronicles` is in
    `provenance.json`, and nothing listed is missing.
  - Sizes are powers of two, and a regeneration reproduces the hashes.
  - The Quest texture estimate per preset stays at or below 64 MB: 4 bytes per texel, mipmaps
    counted, map included.
  - The committed texture size is reported (target: at most 8 MB).
  - `npm run build:quest` mirrors the files, and `check:sync` passes.

**B4 — Desktop archive renderer.** Files: `main game/src/chronicles/scene/ArchiveScene.ts` and its
modules (architecture, materials, lighting, atmosphere, camera, and the monument refitted from
`atlas-set`, `atlas-details` and `atlas-markers`; the table retires), the dev-only `scene/harness.html`
and `harness.ts`, and renders in `main game/artifacts/chronicles/m1/` named `env-*`.

- One `WebGLRenderer` behind the API in ARCHITECTURE §5.1.
- Build: sliced, in slices of at most 5 ms, with progress. Static geometry is merged per material,
  and repeats are instanced. B3 materials are used per preset.
- Lighting and atmosphere:
  - one shadow-casting key through the oculus, its shadow drawn once;
  - baked ambient occlusion and indirect light;
  - at most four dynamic practical lights on medium;
  - height haze, a light shaft and dust as cheap geometry;
  - post-processing optional, and off on low.
- The monument at the blueprint scale, with the bronze frame, the markers and the living details. The
  rings stay still on their pivots.
- Camera: the blueprint framings plus the Atlas focus, restrained orbit and zoom within limits, and
  cuts under reduced motion. Picking for markers and exhibits.
- Every program is compiled and every texture uploaded before `onReady`. The scene renders only while
  shown and visible, and it disposes everything, including its context.
- Acceptance:
  - The build passes, and the harness is absent from `main game/dist`.
  - Clay and lit renders of every viewpoint at 1920 × 1080 (medium and high), plus kernel and material
    contact sheets. Look at each one, and record a short self-assessment against the reference frames.
  - Measured per preset at the overview and at the heaviest framing: low ≤ 120 draw calls and 300k
    triangles, medium ≤ 250 and 1.0M, high ≤ 400 and 1.5M. Texture bytes are reported.
  - Heap growth under 1 MB over 10 s of idle after garbage collection.
  - Five create–dispose cycles return contexts, canvases and `renderer.info` memory to baseline.
  - D9 holds.

**B5 — Quest archive room.** Files: `main-game-vr/src/chronicles/scene/archive-room.ts` and its
helpers, `atlas-diorama.ts` refitted as the monument at the Quest scale (Ray and Poke markers kept),
and renders in `main-game-vr/artifacts/chronicles/m1/` named `env-*`.

- The same blueprint and kernel at Quest tessellation:
  - static geometry merged per material, and repeats instanced;
  - lighting baked into vertex colours, unlit or Lambert materials, and no real-time shadows;
  - 512 textures (256 on low), with low, medium and high presets;
  - a small, fill-rate-conscious shaft and haze.
- Entities are created through `world.createTransformEntity` under an archive root whose floor is XR
  local-floor y = 0. Three is imported only through `@iwsdk/core`.
- The build is sliced to a few milliseconds per frame and reports progress. `update()` is
  allocation-free. `close()` releases every GPU object with `entity.dispose()`. A collection is
  emphasised by light.
- Acceptance:
  - Typecheck and build pass, and no file imports `from 'three'`.
  - Browser-preview renders from the seated vantage at each preset, looking forward, up and to both
    sides. Look at each one.
  - Per preset, with the panel visible: ≤ 120 draw calls, ≤ 250k triangles and a texture estimate
    ≤ 64 MB.
  - Five open–close cycles return the geometry and texture counts to baseline.
  - The runtime is stopped afterwards.

#### Desktop (C)

**C0 — Housekeeping.** Files: `main game/scripts/verify-chronicles.mjs`,
`main game/artifacts/home-artwork.json` and `visual-review.json`.

- Add a milestone argument for the output folder.
- Correct the stale delivery hashes to the delivered map (537 628 B, `d9f143ad…`), and prove it with
  a `verify-home.mjs` run.
- Take a CDP trace that attributes the M0 tab-switch long tasks. Suspects: the full-stage blur
  filter, React re-rendering and first-use compilation.
- Acceptance: verify-home passes, and the attribution is recorded in `m1/`.

**C1 — The archive in the Chronicles screen.** Files: `main game/src/Chronicles.tsx`,
`Chronicles.css`, `main game/src/chronicles/*.ts` (outside `scene/`) and minimal hunks in
`main game/src/App.tsx`: navigation hidden and inert, LB/RB and Q/E cycling collections, and the D7
overrides kept.

- Mount `ArchiveScene`. State goes through the shared reducer under the content policy, plus local
  focus state.
- A visual loading state from the click until `onReady`: a compositor-driven animation, progress from
  `onProgress`, named by the approved title. Then the entrance settle, then interaction.
- Collections by tab, LB/RB, Q/E, keyboard, gamepad and mouse.
- On the monument: nation markers, labels and the record panel. The Interregnum and Laws records sit
  over their bay framings, without the full-stage blur. The dormant bay is absent from navigation.
- Back follows D5.
- A WebGL failure or a lost context shows the flat painting with the same records.
- The 844 × 390 landscape layout works, and no React state changes per frame.
- Acceptance: the C2 runs pass. Every on-screen string comes from `shared/chronicles` or the existing
  menu chrome. Changes stay in the listed files and are entered in the register.

**C2 — Desktop evidence.** Files: `main game/scripts/verify-chronicles.mjs` and
`main game/artifacts/chronicles/m1/`.

- A production build on `vite preview` (a port in 5190–5199, stopped afterwards), driven by
  Playwright with SwiftShader.
- Flows:
  - loading, captured mid-way, then the entrance and the overview;
  - every collection by each input;
  - nation records by mouse and keyboard;
  - Back to Home;
  - reduced motion, the flat fallback and 844 × 390;
  - a DOM text inventory checked against the shared strings;
  - the parity fixture, replayed.
- CDP measurements:
  - long tasks after interactive, with attribution;
  - script time per frame (p50, p95, p99);
  - heap and canvases before and after five Home ↔ Chronicles round trips;
  - stats per preset;
  - the atmosphere rebuild on exit;
  - one 4× CPU-throttled run: entry and one collection switch.
- Acceptance:
  - Captures at 1280 × 720 for every state, 1920 × 1080 hero frames and 844 × 390. Look at all of
    them. The manifest records the host load and SwiftShader.
  - No Chronicles long task over 50 ms after interactive at medium.
  - The budgets are met.
  - After the round trips, canvases are back at baseline and heap growth is under 5 MB after garbage
    collection.
  - The suite passes end to end.

#### Quest (D)

**D1 — Quest state on the shared reducer.** Files: `main-game-vr/src/quest-state.ts`,
`quest-state.test.ts` and the `test` script in `main-game-vr/package.json`.

- `QuestState` embeds `ChroniclesSceneState` in place of `exhibit` and `record`. The existing events
  map onto the shared ones, and Back follows `canUnwind`. Pause and resume keep the state, and the
  Home tile resets it.
- The `test` script runs `src/quest-state.test.ts` and the aggregator
  `../shared/chronicles/chronicles.test.ts` instead of the individual Chronicles files.
- Acceptance: `npm run test:quest` passes. The Brief E Chronicles behaviours hold. The parity fixture
  replays in `quest-state.test.ts`. The register entries are updated.

**D2 — Archive integration.** Files: the new `main-game-vr/src/chronicles/archive-controller.ts` and
`archive-assets.ts`; the Chronicles hunks of `crownfall-system.ts`, `ui-contract.ts`, `assets.ts`
(one spread line) and `scripts/generate-quest-ui.ts`; the regenerated `public/ui/menu.uikitml`; and
`scripts/check-chronicles-sync.ts`.

- Room lifecycle: it opens on entry, stays through pause, closes on leaving, and is visible only on
  the Chronicles screen.
- The menu atmosphere plane and the sorcerer are hidden while the room is open.
- The panel takes its control-surface pose (D6).
- Collection tabs drive the emphasis, and markers drive the reducer.
- A visual loading indicator shows on `View_Chronicles` until the room is ready. The room fades in,
  instantly under reduced motion.
- Recenter happens under a fade. Pause, including the automatic pause on visibility blur, holds the
  room. Exit VR is unchanged.
- Controls keep working after hand tracking is lost and recovered.
- The preview-only framing never applies in XR.
- The sync check covers the new ids and every registered room texture. With the switch off, it
  confirms that no non-approved string is present.
- Acceptance:
  - `npm run generate` (no hand edits; `View_Chronicles` kept), `check:sync`, typecheck and build
    pass.
  - Body text at the control surface subtends at least 1.0° from both vantages (computed).
  - The `crownfall-system.ts` diff stays in Chronicles hunks and is entered in the register.

**D3 — Quest evidence.** Files: `main-game-vr/scripts/capture-chronicles.mjs`,
`chronicles-runtime-step.mjs` and `main-game-vr/artifacts/chronicles/m1/`.

- One runtime: `npx @iwsdk/cli dev up --headless`, ready on `browserCommandReady`, stopped with
  `dev down`.
- Fix the bare-ground check.
- Browser preview, seated and standing.
- An IWER XR session in hand mode, with controllers disconnected:
  - pinch the Home tile;
  - look-around captures;
  - pinch a marker, then a collection tab;
  - Back to Home;
  - pause on visibility blur, then resume;
  - recenter after a 40° head turn: the camera's world pose still equals the emulated headset pose,
    which proves the XR origin was never moved;
  - lose hand tracking, recover it, then pinch.
- Render stats for every capture, the texture estimate and the presets.
- An allocation probe: a profile trace, or heap sampling over 600 idle frames, attributes no
  allocation to the room or the controller update.
- Acceptance:
  - `xr status` reports an active session for every XR capture.
  - Every interaction is proven by state, not by a screenshot alone.
  - Every preset stays within 120 draw calls, 250k triangles and 64 MB.
  - The manifest marks emulation and SwiftShader. Look at every capture.
  - The runtime is stopped, and nothing claims headset results.

#### Architect (A)

**A1 — Blueprint gate G1.** Review the generated blueprint and the plan renders (read the PNG)
against B1, the directive's composition requirements and D9. Accept, or return findings by severity.
Record the decision and its date in §1, and fold any contract refinement into ARCHITECTURE §4.5.

**A2 — Critic round G2 and checkpoint G3.**

- Assemble the review packet: the blueprint; the desktop and Quest `m1/` captures, including the
  clay and XR captures; the measurements; the text inventory; the diff stat; and the register.
- Run the five critics independently. Each finding carries a severity, evidence and a corrective
  action. Findings about collections scheduled for M2–M5 are filed against those milestones, unless
  M1 regresses them.
- Allow up to three correction rounds, in this order: lighting and atmosphere, then primary forms,
  then materials, then detail.
- Then update this file and ARCHITECTURE.

### 5.4 M1 exit criteria

1. G1 is recorded before any scene composition.
2. `npm run build` passes (desktop `tsc -b` and vite; Quest typecheck and vite).
3. `npm run test:quest` passes, including the new status, scene-state, blueprint, kernel and
   materials tests.
4. `npm run check:sync` passes with the extended Chronicles line.
5. The private verifier passes, and `shared/chronicles/content.ts` is unchanged since `32464d0`.
6. Desktop:
   - Home → Chronicles shows the loading state, then the archive. The first settled frame shows the
     monument, the mechanism and the light.
   - Collections, nation records and Back work by mouse, keyboard and gamepad.
   - Reduced motion cuts the camera moves. The flat fallback and 844 × 390 work.
7. Quest:
   - Home → Chronicles works in the browser preview, and in an IWER XR session driven by hand ray and
     pinch.
   - The room surrounds a stationary viewer, who is never moved.
   - Markers, tabs, Back, Pause/Resume, Recenter and Exit VR work.
8. Budgets are measured and met:
   - desktop medium: ≤ 250 draw calls and ≤ 1.0M triangles; low and high within theirs;
   - Quest, at every preset: ≤ 120 draw calls, ≤ 250k triangles and ≤ 64 MB of textures;
   - no Chronicles long task over 50 ms once interactive, and no per-frame allocation;
   - no leak over five round trips;
   - only one render loop runs while the archive is open, and the menu loops resume on exit.
9. The evidence is in the two `m1/` folders, and every capture has been looked at. The manifests state
   emulation and SwiftShader. Nothing claims headset results.
10. The five critics have reviewed the evidence, and no Blocker or Major finding remains unresolved.
11. Boundaries hold:
    - no on-screen words added, and D9 holds;
    - no edits to `web/`, the chess core, the Play screens, `main-game-vr/src/chess/`, the other
      worktrees or unlisted shared files;
    - every shared-file change is in the register.
12. This file records the completed behaviour, the evidence, the measurements, the open issues and the
    M2 increment.

### 5.5 Scope cuts

- **Later collections:**
  - Annals interaction (M3): the rings stay still.
  - Laws pieces, formation and piece inspection (M4): the dais is architecture only.
  - Contested Record content, tab and title (M5): its bay stays dormant.
  - Nation vignettes, landmark miniatures, the identity reveal and the relief's steep-slope fix (M2).
- **New words:** every new on-screen string, including captions, proposals, interface text and
  a labelled retry button.
- **P3:** discovery state, environmental animation beyond today's relief details and subtle dust and
  light, and elaborate transitions.
- **The `suspended` port** in `Atmosphere.tsx` and `CreatureStage.tsx`, which is an orchestrator
  decision (D7).
- **The occlusion reveal,** unless the sweep test demands it (D8).
- **Optional:** Blender hero assets and Cycles lightmaps. KTX2 compression only if the Quest texture
  budget needs it.
- **Throttled run:** the 4× CPU throttle covers one entry and one collection switch only.
- **Elsewhere:**
  - physical headset validation (creator);
  - README edits (M6);
  - the War Record interface (M5);
  - any change to Herald Board or My Legacy.

## 6. Dependencies on other workflows

| Workflow | Dependency |
| --- | --- |
| My Legacy gameplay (`feat/my-legacy`, `/home/user/crownfall`) | Overlapping shared files (§ register), the menu-loop `suspended` props, the War Record data shape (its finalised match record) for the M5 adapter, the merge order and the README edits. Chronicles never imports unmerged Legacy modules. |
| Bannerhold environment (`feat/legacy-world-environment`) | No code dependency. Ideas reused, never imported: the pure geometry kernel pattern and the occlusion reveal technique. Shares the machine (ports, CPU, the one-runtime rule). |
| Chess in VR (Brief A) | No edits to `web/`, the chess core, the Play screens or `main-game-vr/src/chess/`. The Laws exhibit never duplicates the move engine. An authored Battle Record may be validated read-only against the game's rules engine in a test. |
| Menu (`feat/main-game-menu`, PR #1) | Base branch. A change there means rebasing this branch. |
| Creator | Approval of every proposal text, the rows held for review, nation geography (no borders or capitals), the status of Muster rules, the dash adaptation on Quest, and physical Quest validation |
| Orchestrator | Stopping the orphaned processes (problem 10), approval to touch `Atmosphere.tsx` and `CreatureStage.tsx`, merge authorisation |

## 7. Last successful verification

Final M0 run on 29 October 2026, 16:43–16:45 UTC, from `/home/user/crownfall-chronicles`, after the M0 reorganisation and with these documents in place:

| Command | Result |
| --- | --- |
| `npm run build` | pass (exit 0). Desktop `tsc -b` + vite and Quest `tsc --noEmit` + vite. Quest UI regenerated with 299 elements. |
| `npm run test:quest` | pass: 40 tests, 0 failures |
| `npm run check:sync` | pass: "Chronicles: 24 Quest UI ids, the Home tile and the shared Atlas map"; 21 byte-identical assets, 31 UI resources |
| Private content verifier (`cd main-game-vr && npx tsx <verify-content.ts> /home/user/crownfall-chronicles`) | pass: 315 passed, 0 failed. It scans more files now that the documents exist. Before M0 it was 282 passed, 1 failed, because of one comment in `verify-chronicles.mjs`, fixed in M0. |
| M0 desktop baseline, 16:23–16:28 UTC (production build on vite preview, port 5192, stopped afterwards; Playwright with SwiftShader; host load about 17–20) | Home → Chronicles works; the record opens; both exhibit tabs switch; Back returns Home with the tile selected; the relief canvas is released on exit; no page errors. Captures and numbers in `main game/artifacts/chronicles/m0/`. |

Baseline re-run at M1 planning, 29 October 2026, about 16:55 UTC, on the unchanged checkpoint
(`32464d0`, clean tree): `npm run test:quest` passed 40 tests with 0 failures; `npm run check:sync`
passed (24 Chronicles Quest UI ids, 299 generated elements, 21 byte-identical assets); the private
content verifier reported 315 passed and 0 failed. The builds were not re-run, because nothing has
changed since the final M0 run.

Quest evidence is the Brief E browser-preview capture set (`main-game-vr/artifacts/chronicles/brief-e/`,
16:04–16:07, current map). No Quest runtime was started in M0 because of problem 10. Nothing here is
physical-headset evidence.

## Milestones

| Milestone | Scope | Status | Evidence |
| --- | --- | --- | --- |
| M0 | Resume and architecture audit | complete | This file, `ARCHITECTURE.md`, M0 captures, checkpoint commit |
| M1 | Archive environment and central monument, rendering on desktop and Quest, visual-critic round | planned (§5); G1 open | — |
| M2 | Living Atlas: four nations, interactive selection, vignettes | partial | Relief, rings, nation framings and records exist on both platforms. Vignettes and the identity reveal are missing. |
| M3 | Annals: timeline mechanism and the foundational anchors | placeholder | Approved records for Year 0, Years 1–12, Year 19 and Year 33, shown in a 2D timeline |
| M4 | Laws of the Gambit | placeholder | Three approved articles in 2D. No formation and no piece inspection. |
| M5 | Contested Record, authored example first | not started | — |
| M6 | Full integration on both platforms | partial | Home → Chronicles is routed on both platforms; it opens the Brief E screen |
| M7 | Visual polish and release verification | not started | — |

## Shared-file change register

The changes are relative to `29343c1`. "Legacy conflict" is a read-only trial merge (`git merge-tree`)
of this work against committed `feat/my-legacy` (`84ffcfc`), plus inspection of its uncommitted
worktree. A trial against `feat/legacy-world-environment` conflicts only in the two `shared/menu`
files.

| File | Chronicles change | Legacy conflict | Resolution at merge |
| --- | --- | --- | --- |
| `shared/menu/types.ts` | `MenuScreen` gains `"chronicles"`; `HomeTileContent.destination?: "chronicles"` | **conflict** (Legacy adds `destination?: "legacy"` on the same line) | `destination?: "legacy" \| "chronicles"` |
| `shared/menu/content.ts` | Imports `CHRONICLES_MAP`; the Chronicles tile uses the map and `destination: "chronicles"`; `getModalContent` returns no unavailable text for tiles with a destination; comment updated | **conflict** in the comment only | Keep both destinations; merge the comment |
| `main-game-vr/package.json` (`test` script) | M1 D1, the one-time change: `tsx --test src/quest-state.test.ts ../shared/chronicles/chronicles.test.ts`. The aggregator replaces the separate content and relief entries and runs the content, status, scene-state, relief, blueprint, kernel and materials suites. | **conflict** (Legacy adds its tests on the same line) | Keep Legacy's entries plus the two Chronicles entries |
| `main game/src/App.tsx` | `chronicles` screen routing: ref, origins, activate, Back, focus, keyboard and gamepad moves, footer, and the `stageResting` overrides for Atmosphere and the sorcerer | Legacy's uncommitted worktree edits the same hunks | Union. Replace `stageResting` with Legacy's `menuSuspended`, set for `legacy` or `chronicles`. |
| `main-game-vr/src/quest-state.ts` | `chronicles` screen. M1 D1: `QuestState.chronicles: ChroniclesSceneState` replaces `exhibit` and `record`, reduced by `reduceChroniclesScene` under `CHRONICLES_CONTENT_POLICY`; the `exhibit`, `record`, `map` and `close-record` events map onto the shared `collection`, `entry`, `map` and `back`, and new `focus` and `loaded` events pass through (`loaded` also lands while paused over Chronicles); a no-op keeps the same `QuestState`; Back follows `canUnwind`, then returns Home; the Home tile opens `createChroniclesScene()`. | Legacy's uncommitted worktree adds a `legacy` route in the same places | Union of the routes and events; keep the `loaded` exception in the pause guard |
| `main-game-vr/src/quest-state.test.ts` | Chronicles tests, rewritten in M1 against the shared scene state (the Brief E behaviours, Back through the nation focus, close-record, the load report during pause), the replay of `scene-state.fixture.ts` through the Quest events, and the control-surface test computed from the blueprint vantages. The Home test no longer expects a Chronicles dialog. | Legacy edits the same Home test | Union |
| `main-game-vr/src/crownfall-system.ts` | Chronicles rendering and `questText`. M1 D2: `ArchiveController` replaces the diorama (constructed in `init` with the anchor, panel, state entity and camera; `sync` from `render`; `comfort()` at the end of `applyComfort`; `recenter(now)` defers to the archive's fade; `update` every frame); the atmosphere object and the sorcerer are hidden, and the atmosphere held, while the room is open; the record panel reads `getOpenEntry` and shows the canon marker chip; `selectedControl` reports the open or focused record; the creature retry stays off the Chronicles screen; the preview framing turns toward the control surface. No Chronicles-path file names the XR rig. | Legacy's uncommitted worktree changes the same update loop | Union: hold the atmosphere when paused, in Chronicles or in Legacy; hide it while either room is open |
| `main-game-vr/src/assets.ts` | Map texture entry; M1 D2 adds one import and one spread line, `...archiveAssets(publicUrl)` (13 lazy archive-room textures from the shared material descriptors) | Legacy adds entries nearby | Union |
| `main-game-vr/src/ui-contract.ts` | `View_Chronicles`, record text ids, `questText`, `QUEST_CHRONICLE_*`; M1 D2 adds the loading-bar and marker-chip ids, collection ids for tabs and panes, the loading-bar layout and `QUEST_CHRONICLE_EXTENT` (the regions the control surface keeps clear of the monument) | none (Legacy uses its own contract file) | — |
| `main-game-vr/public/ui/menu.uikitml` | Regenerated with `View_Chronicles` (302 elements after M1: the wordless loading bar and the empty marker chip) | regenerate | Never hand-merge; rerun `npm run generate` after merging |
| `scripts/generate-quest-ui.ts` | Generates `View_Chronicles`; imports `questText`; M1 D2 adds the wordless loading bar under the tabs, the empty `Record_Marker` chip and its style, and their required ids | none (Legacy has its own generator) | — |
| `scripts/generate-quest-decoration.mjs` | Shared modules may require one another | none | — |
| `scripts/check-menu-sync.ts` | M0 reduced it to an import and one call to `checkChroniclesSync` (it was a 120-line restructure) | auto-merges with committed Legacy; Legacy's worktree appends an optional check at the end | Keep both hooks |
| `scripts/sync-menu-assets.mjs` | Home asset list drops `chronicles`; adds the `assets/chronicles` directory | none | — |
| `main game/src/useBootLoading.ts` | Preloads `chronicles-map.webp` | none | — |
| `main game/scripts/verify-loading.mjs` | Expects the map path | none | — |
| `main game/artifacts/home-artwork.json`, `visual-review.json` | `deliveryPath` moved to the map (hashes still stale, problem 6) | none | — |
| `main game/public/assets/home/chronicles.webp` | Deleted (moved to `assets/chronicles/chronicles-map.webp`) | none | — |

Not changed by Chronicles: `main game/src/main.tsx`, `main-game-vr/src/index.ts`,
`main-game-vr/vite.config.ts`, the IWSDK scene JSON, the root `package.json`, `Atmosphere.tsx` and
`CreatureStage.tsx`.
