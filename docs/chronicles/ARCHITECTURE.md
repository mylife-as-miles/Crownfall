# Chronicles — architecture

*The Archive of Ash & Aether (working presentation title). Owner: lead architect. M0, 29 October 2026.*

This document holds the architecture and integration contracts for M1–M7. Role owners implement it,
and the architect accepts each increment against it. Current state, problems and the next increment
are in [`WORK_STATUS.md`](WORK_STATUS.md). The TypeScript blocks below are contracts: they are not
code yet. Each lands in the milestone named beside it.

## 1. Principles

1. **Continue, never restart.** The Brief E archive and its relief Atlas are the foundation
   (WORK_STATUS §2).
2. **One shared domain, two renderers.** `shared/chronicles/` is pure TypeScript: no React, IWSDK,
   Three, DOM, storage, timers or `Math.random`. It is deterministic and ES2020-safe for the Quest
   typecheck (no `Array.prototype.at`, `findLast`, `Object.hasOwn` or `replaceAll`). Each platform
   converts shared data into its own runtime objects and disposes them itself. Platforms share
   data, never runtime objects. Quest imports Three only through `@iwsdk/core`.
3. **Words are governed.** Approved copy is frozen in `content.ts`. All other text lives in
   separate modules, each string with a canon status. Non-approved text carries a visible marker,
   and one switch removes it (§7).
4. **Canon status is not in-world reliability.** Who approved the words is recorded separately from
   how far the world trusts them.
5. **Show, then tell.** Exhibits communicate through space, objects and light. Text stays short.
6. **Comfort and parity.** Quest is stationary and hands-first, and never moves the viewer. Desktop
   uses authored framings with restrained orbit and zoom. Both show the same exhibits and the same
   words.
7. **Budgets are requirements.** They are measured every round (§9). Emulation is never headset
   evidence.
8. **Preserve the menu.** The approved menu art, navigation, animated sorcerer, settings and the
   other Home destinations keep their behaviour.

## 2. Repository layout and ownership

Roles: **A** architect, **B** environment and technical art, **C** desktop, **D** Quest, **E**
historical content. "Now" marks files that exist after M0.

```
shared/chronicles/                     E  (everything except archive/)
  types.ts                 now         domain contracts, extended M1–M5
  content.ts               now         approved copy, verbatim, exports frozen
  content.test.ts          now         approved-copy tests + hashed guard over every module
  status.ts                M1          CanonStatus, content policy (the one switch), marker strings
  registry.ts              M1          ChronicleEntry list: approved records + visible proposals
  scene-state.ts (+test)   M1          ChroniclesSceneState reducer used by both platforms
  nations.ts               M2          NationProfile per approved nation record
  annals.ts                M3          HistoricalEvent anchors from the approved Interregnum records
  laws.ts                  M4          piece exhibits: rules of play + approved institutional links
  contested.ts             M5          ContestedRecord, sources, perspectives (authored example)
  war-record.ts            M5          future War Record interface, types only
  proposals/*.ts           M2+         working-proposal and placeholder text, one module per collection
  archive/                             B
    relief.ts (+test)      now         Living Atlas heightfield, views, markers, ray hits, details
    types.ts               M1          ExhibitDefinition, ArtifactDefinition, blueprint types
    blueprint.ts (+test)   M1          annotated spatial blueprint as data
    kernel/ (+tests)       M1          profiles, sweeps, bevels, mouldings, arches, columns → typed arrays
    materials.ts           M1          material descriptors and texture-generator ids
    occlusion.ts           when needed sphere sweep against blueprint occluder volumes
main game/src/Chronicles.tsx, .css     C   screen shell, overlays, input routing
main game/src/chronicles/*.ts(x)       C   loading, panels, input helpers
main game/src/chronicles/scene/        B   desktop renderer (now: AtlasScene, atlas-set, atlas-details, atlas-markers)
main game/scripts/*chronicles*.mjs     C   verification and capture
main game/public/assets/chronicles/    B   generated textures and GLBs; the supplied map is never redrawn
main-game-vr/src/chronicles/*.ts       D   system, interaction, panel wiring
main-game-vr/src/chronicles/scene/     B   Quest renderer (now: atlas-diorama)
main-game-vr/scripts/*chronicles*.mjs  D   capture and runtime steps
scripts/check-chronicles-sync.ts       D   Chronicles parity in check:sync (now), A reviews
scripts/chronicles/                    B   texture generators and Blender scripts (proposed path)
docs/chronicles/                       A   WORK_STATUS, ARCHITECTURE; BLUEPRINT drafted by B
```

Shared files outside this tree change only minimally, and only where needed. Each change is entered
in the WORK_STATUS register: `main game/src/App.tsx` (routing), `main game/src/useBootLoading.ts`,
`shared/menu/*`, `main-game-vr/src/{quest-state.ts, quest-state.test.ts, crownfall-system.ts,
ui-contract.ts, assets.ts}`, `scripts/{generate-quest-ui.ts, generate-quest-decoration.mjs,
check-menu-sync.ts, sync-menu-assets.mjs}`, the `main-game-vr/package.json` scripts, and
`main-game-vr/public/ui/menu.uikitml`, which is regenerated and never hand-edited. Its
`View_Chronicles` id stays.

The M0 reorganisation moved the desktop relief files into `main game/src/chronicles/scene/`, the
Quest diorama into `main-game-vr/src/chronicles/scene/` and the relief data into
`shared/chronicles/archive/`. It also moved the Chronicles parity check out of the shared sync
script into `scripts/check-chronicles-sync.ts`.

## 3. Status vocabulary

```ts
// shared/chronicles/status.ts (M1)

/** Production authority of the words, set by the creator. Agents may write only the last two. */
export type CanonStatus = "approved" | "public-assertion" | "disputed-testimony" | "working-proposal" | "placeholder";

/** In-world reliability shown on screen: the four approved labels (existing ChronicleLabel). */
export type ChronicleLabel = "recorded" | "disputed" | "testimony" | "rumor";

/** Evidence class of one statement inside a source (the Contested Record). */
export type SourceReliability = "verified-fact" | "interpretation" | "rumor-or-accusation" | "missing-evidence" | "unresolved-claim";

/** The one visibility switch (§7). */
export interface ContentPolicy { showUnapproved: boolean }
export declare const CHRONICLES_CONTENT_POLICY: ContentPolicy;
export declare function isCreatorApproved(status: CanonStatus): boolean; // the first three statuses
```

- Every row of `content.ts` is `approved`. The creator may also approve text as a
  `public-assertion` (a claim made in the world, approved to exist as a claim) or as
  `disputed-testimony`. These three statuses are creator-approved and are the only ones a release
  shows.
- Everything an agent writes is a `working-proposal` (design text awaiting approval) or a
  `placeholder` (development text that never ships). A test fails if a `proposals/` module carries
  a creator-approved status.
- Canon status never decides the in-world label, and the label never decides the status. An
  approved record may be in-world "Rumor", and a working proposal stays unapproved even when it
  describes something "Recorded".
- The on-screen names of the evidence classes are text too. They stay working proposals until the
  creator approves them.

## 4. Shared domain

### 4.1 Entries and registry (M1)

```ts
// shared/chronicles/types.ts
export type ChronicleCollectionId = ChronicleExhibitId | "contested"; // "atlas" | "interregnum" | "laws" | "contested"

export interface ChronicleEntry {
  id: string;                          // kebab-case, unique across the approved and proposal layers
  collection: ChronicleCollectionId;
  canonStatus: CanonStatus;
  label?: ChronicleLabel;              // in-world reliability; absent for non-diegetic exhibit captions
  title: string;
  body: string;
  nation?: ChronicleNationId;
  eventId?: string;
  sourceIds?: readonly string[];
}

// shared/chronicles/registry.ts
export declare function getChronicleEntries(policy: ContentPolicy): readonly ChronicleEntry[];
export declare function getChronicleEntry(id: string, policy: ContentPolicy): ChronicleEntry | undefined;
```

The registry derives one approved entry from each `CHRONICLE_RECORDS` row, using the same string
objects: collection = exhibit, `canonStatus: "approved"`, label = record label. When the policy
allows, proposal entries follow. Ids are unique, and an approved id can never be shadowed. Screens
on both platforms render registry entries only, and no screen imports `proposals/` directly.

The name `ChronicleEntry` also exists in `shared/legacy/types.ts` on `feat/my-legacy`, where it is a
War Record log entry. The two never meet: the Chronicles bridge consumes Legacy's finalised match
record (§8), never its log entries.

### 4.2 Nations (M2)

```ts
export interface NationProfile {
  id: ChronicleNationId;
  recordId: string;                    // the approved Atlas record: title, body, label
  hotspot: ChronicleHotspot;           // from that record
  view: ChronicleNationId;             // RELIEF_VIEWS key: the monument framing for this nation
  vignetteId?: string;                 // the environmental vignette exhibit (archive blueprint)
  captionIds: readonly string[];       // proposal captions for the vignette, shown with the marker
}
```

The political structure and the relationship to the King's Gambit come only from the approved
record bodies. Regions are the painting's own. No borders, capitals or rulers' names are drawn or
written. Where geography is unspecified, the exhibit stays a clearly provisional representation.

### 4.3 Events, sources and perspectives (M3–M5)

```ts
export interface HistoricalEvent {
  id: string;                          // "year-0", "years-1-12", "year-19", "year-33"
  entryId: string;                     // the approved Interregnum record
  span: { from: number; to?: number }; // Interregnum years
  anchor: boolean;                     // Year 0, Year 19 and Year 33 are the foundational anchors
  sourceIds: readonly string[];        // empty until sources are approved
  perspectiveIds: readonly string[];   // disputed interpretations; empty until approved
  exhibitId?: string;                  // the Annals exhibit that presents it
}

export interface HistoricalSource {
  id: string;
  canonStatus: CanonStatus;
  kind: "court-record" | "house-account" | "battle-record" | "testimony" | "inscription" | "artifact";
  title: string;
  provenance: string;                  // who kept it and how it reached the archive, in one short line
  label: ChronicleLabel;               // in-world reliability of the source as a whole
  statements: readonly SourceStatement[];
}

export interface SourceStatement {
  id: string;
  text: string;
  reliability: SourceReliability;
  supportedBy?: readonly string[];     // statements that confirm it, e.g. the Battle Record's capture
  contradicts?: readonly string[];     // statements it disputes
}

export interface ChroniclePerspective {
  id: string;                          // e.g. "court-record", "allied-house-account", "battle-record"
  eventId: string;
  sourceId: string;
  emblem: "court" | "house" | "board"; // the physical object that becomes prominent when selected
}

export interface ContestedRecord {
  id: string;                          // "debt-of-blackmere"
  canonStatus: CanonStatus;            // working-proposal until approved
  provenance: "authored-example" | "verified-match";
  eventId: string;
  perspectiveIds: readonly string[];
  battle: BattleRecord;
}

export interface BattleRecord {
  moves: readonly string[];            // standard algebraic notation from the initial position
  captures: readonly { ply: number; piece: ChessPieceKind; side: "w" | "b"; representative?: string }[];
  result: { winner: "w" | "b" | null; reason: string };
}
```

These are the Contested Record rules, using the creator's illustrative event, the Debt of
Blackmere. It is a working proposal, always labelled "Authored example".

- The Battle Record's statements are `verified-fact` and are derived mechanically from `battle`. A
  test recomputes them. The Battle Record establishes what happened on the board. It never states
  why.
- Statements of motive in any perspective are classed as `interpretation`, `rumor-or-accusation`,
  `missing-evidence` or `unresolved-claim`. The court's report is not presumed false, and the
  allied house's accusation is not presumed justified.
- The authored moves must be legal under the game's rules engine, and they are validated in a test,
  never by a reimplementation of the rules. `chess.js` is a `web/` dependency and is not installed
  in this checkout. Giving a Chronicles test access to it is an open decision (§12).
- Development fixtures are never presented as anyone's actual history.

### 4.4 Laws of the Gambit (M4)

```ts
export type ChessPieceKind = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

export interface PieceExhibit {
  piece: ChessPieceKind;
  roleEntryId: string;                     // battlefield role as rules of play; working-proposal wording
  institutionEntryIds: readonly string[];  // approved articles that concern it (e.g. the law of the pawn, the muster)
  provisional: boolean;                    // true where house representation or political status is undecided
}
```

Rules of play may be stated as fact: how the pieces move, promotion only to queen, rook, bishop or
knight, and that the king is never captured. Nothing states an in-world reason for the rules, which
is unresolved. The approved articles are the only institutional statements. Nothing presents a
Muster constitution as law, and undecided matters are marked provisional. The exhibit never
computes moves and never touches the game's rules. Any demonstration is a fixed sequence, validated
like the Battle Record.

### 4.5 Exhibits and artifacts (M1, `shared/chronicles/archive/types.ts`, B)

```ts
export type Vec3 = readonly [x: number, y: number, z: number];

/** Archive metres: +X east, +Y up, −Z north; origin at the chamber centre on the main floor. */
export interface ExhibitDefinition {
  id: string;
  collection: ChronicleCollectionId;
  anchor: Vec3;
  yaw: number;
  artifactIds: readonly string[];
  /** Desktop authored framing and its restrained orbit, tilt and zoom ranges. */
  framing: { eye: Vec3; target: Vec3; fov: number; yaw: readonly [number, number]; pitch: readonly [number, number]; zoom: readonly [number, number] };
  /** Quest presentation around the stationary station: bearing (rad) and distance (m) from the viewer, height and scale. */
  station: { bearing: number; distance: number; height: number; scale: number };
  /** Selection proxy for rays and poke, in exhibit space. */
  pick: { center: Vec3; radius: number };
  /** Blueprint occluder volumes that can stand between the desktop camera and this exhibit. */
  occluders?: readonly string[];
}

export interface ArtifactDefinition {
  id: string;
  collection: ChronicleCollectionId;
  kind: "relief" | "ring" | "dial" | "piece" | "seal" | "document" | "emblem" | "inscription" | "miniature" | "standard";
  mesh: { builder: string } | { asset: string };   // a kernel builder id or a GLB under assets/chronicles
  materialIds: readonly string[];
  entryIds: readonly string[];                     // registry entries it presents
  selectable: boolean;                             // its own target, or part of its exhibit's proxy
}
```

### 4.6 Scene state and discovery (M1)

```ts
export type ChroniclesFocus =
  | { kind: "overview" }
  | { kind: "nation"; nation: ChronicleNationId }
  | { kind: "event"; eventId: string }
  | { kind: "piece"; piece: ChessPieceKind }
  | { kind: "perspective"; recordId: string; perspectiveId: string };

export interface ChroniclesSceneState {
  collection: ChronicleCollectionId;   // the active collection's exhibit; the Home tile opens "atlas"
  focus: ChroniclesFocus;
  entryId: string | null;              // the open entry in the record panel
  sourceId: string | null;             // the inspected source or testimony
  comparing: boolean;                  // Contested Record side-by-side comparison
  load: "loading" | "ready" | "flat" | "failed";
}

export type ChroniclesSceneEvent =
  | { type: "collection"; collection: ChronicleCollectionId }
  | { type: "focus"; focus: ChroniclesFocus }
  | { type: "entry"; id: string }
  | { type: "source"; id: string }
  | { type: "compare"; on: boolean }
  | { type: "loaded"; result: "ready" | "flat" | "failed" }
  | { type: "back" };

/** Pure and total: invalid ids, hidden entries and events for another collection return the same state object. */
export declare function reduceChroniclesScene(state: ChroniclesSceneState, event: ChroniclesSceneEvent, policy: ContentPolicy): ChroniclesSceneState;
/** Back unwinds source → entry → focus → collection overview; when this is false the platform returns Home. */
export declare function canUnwind(state: ChroniclesSceneState): boolean;

export interface DiscoveryState {
  schema: 1;
  seen: readonly string[];             // registry ids opened on this device
}
```

Desktop holds the scene state in a reducer. Quest embeds it in `QuestState`, replacing today's
`exhibit` and `record` fields, so that pause, resume and Back behave identically. The reducer's tests
carry over today's Quest Chronicles tests. Discovery is optional (P3). It is stored per device under
`crownfall.chronicles.discovery` and `crownfall.quest.chronicles.discovery`, it is never synced, and
it never claims progress.

## 5. Scene architecture

### 5.1 Pipeline

```
content.ts + proposals/ ──► registry (policy) ───────────────────────► text on both platforms
archive/blueprint ──┬─► kernel builders ─► typed-array meshes ──┬─► desktop ArchiveScene (three, one renderer)
archive/materials ──┘                                           └─► Quest ArchiveRoom (IWSDK super-three)
archive/relief ─────► relief mesh, markers, views, details ─────┘
scripts/chronicles ─► assets/chronicles (textures, GLB) ─► mirrored to Quest, hash-checked ─► both renderers
```

- **Shared:** positions, sizes, profiles and material descriptors. Kernels emit
  `{ positions, normals, uvs, colors?, indices, groups }` typed arrays, as `ReliefMesh` does. They
  are deterministic, and they are sliceable generators, as `reliefMeshSlices` is, so platforms can
  build within a frame budget. Tests cover determinism, triangle budgets per quality, finite
  geometry and purity.
- **Desktop renderer** (`main game/src/chronicles/scene/ArchiveScene.ts`, B): one `WebGLRenderer`
  for the whole archive, with today's relief renderer folded in. It uses physically based materials
  with generated textures; one shadow-casting key light whose bounded shadow map is drawn once while
  nothing moves; baked ambient occlusion and light in vertex colours or lightmaps from Blender; warm
  practical lights; height fog and light shafts as cheap geometry; and post-processing that is
  optional and off on Low. It has low, medium and high presets, honours `renderScale` and
  `frameLimit`, and ships as a lazy chunk.
- **Quest renderer** (`main-game-vr/src/chronicles/scene/ArchiveRoom.ts`, B): the same blueprint and
  kernels at Quest tessellation. Lighting is baked into vertex colours with unlit or Lambert
  materials, as the diorama does. Static meshes are merged per material and repeats instanced. It
  creates entities with `world.createTransformEntity` under the experience anchor and never edits
  the scene JSON. `update()` does not allocate, and it releases every GPU object it owns on close.

### 5.2 The Living Atlas becomes the central monument

The relief stays the heart of the archive, on a carved plinth at the chamber's centre: the bronze
frame on desktop and the baked diorama treatment on Quest. The painting stays its albedo and is never
redrawn.

- **Desktop:** `AtlasScene`'s camera rig becomes the Atlas focus mode of the archive camera.
  `RELIEF_VIEWS` become the nation framings, expressed in the monument's frame. The markers, the
  `intersectRelief` picking and the living details move with the monument.
- **Quest:** the station keeps the reachable table-height presentation. The blueprint sets the
  monument's scale.
- **Nation emphasis (M2):** the relief, the markers and the light respond to selection. The
  vignettes rise beside it.

### 5.3 Spatial concept: the initial envelope

This is design direction, not world lore: where the archive is, who made it and why the visitor
may enter stay unstated. The blueprint (B, M1) fixes the final numbers, viewpoints, light sources,
interaction zones, navigation paths and expansion points before construction.

- **One central chamber with a strong vertical axis.** The Living Atlas lies on the central floor.
  Above it hang the Annals' large astronomical rings. Light falls from a high opening across the
  relief. The first frame on entry shows the monument, the mechanism and the light together.
- **Collection bays around the chamber.** The Laws of the Gambit sits on a raised dais, with a
  ceremonial formation of the six pieces and the four nations' standards. The Contested Record is
  three lit lecterns or stelae, one per perspective. Engraved wall reliefs of the four nations draw
  only on approved content and the painting.
- **Starting dimensions for the blueprint to refine:**
  - chamber about 22–26 m across and 14–18 m high to the opening;
  - desktop monument about 4.5–5 m wide at about 1 m height;
  - rings 3–6 m in radius, hung 5–9 m up;
  - bays about 6–8 m deep.
- **Quest:** one stationary station at the monument's south edge. The monument is at reachable
  scale (about 1.2–1.6 m wide, 0.75–0.85 m high). Every exhibit lies within ±60° of forward, and
  every target within ray reach.
- **Expansion points:** empty niches reserved for future collections and for exhibits fed by the
  War Record. They stay visibly unoccupied until real content exists.

### 5.4 Occlusion reveal

If an authored desktop framing can place architecture (columns, arches, rings) between the camera and
a focused exhibit, Chronicles applies the technique described in `docs/legacy/ENVIRONMENT_BRIEF.md` on
`feat/my-legacy`, in its own code:

1. A pure sphere sweep from the exhibit to the camera, tested against the blueprint's occluder
   volumes (`archive/occlusion.ts`).
2. Frame-rate-independent damping of the reveal centre and strength, with hysteresis.
3. One shared `onBeforeCompile` patch on occluding materials. It computes a world-space sphere mask,
   broken up by stable world-space noise.
4. Dithered alpha-test discard, so materials stay opaque and depth and shadows stay correct. Shadow
   and depth materials are not masked, and a uniform skips the branch when the strength is 0.
5. No per-frame allocation, and the cost is measured.

On Quest the head is the camera, and the layout keeps sight lines clear. A cheaper patch (simpler
noise, off on Low) applies only where a measured case needs it. Nothing ever moves the viewer.

### 5.5 Assets and provenance

- Geometry is authored: procedural TypeScript builders with real profiles, bevels, mouldings and
  arches, or Blender → GLB through headless `bpy`. The scripts are committed under
  `scripts/chronicles/blender/`.
- Textures are baked by committed generators under `scripts/chronicles/textures/`.
- Outputs go to `main game/public/assets/chronicles/`. The existing directory sync mirrors them to
  Quest, and `check:sync` compares hashes.
- Nothing is downloaded and no unlicensed asset is used.
- `main game/public/assets/chronicles/provenance.json` lists every file with its generator and
  command. The map is listed as the creator's painting with the tower removed by orchestrator
  inpainting. A test asserts that every file is listed.

## 6. Screen and navigation integration

### 6.1 Desktop

- **Entry:** the Home tile goes to the `chronicles` screen in `App.tsx`, as it does now. From M1,
  Chronicles is a full-stage layer with the main navigation inert, as the Legacy layer is. The menu
  sorcerer and atmosphere pause once the layer covers the stage and resume before it fades out
  (WORK_STATUS problem 3).
- **Flow:**
  1. Loading: visible progress from the sliced builds and texture decoding; no freeze longer than
     200 ms without feedback.
  2. Entrance: one short camera settle of at most 1.5 s, cut under reduced motion.
  3. Overview → collection → focus → entry → source.

  Back, B or Escape unwinds one level. At the overview it returns Home with the tile selected.
- **Input:**
  - Mouse: hover highlights, click selects, drag orbits within the framing's limits and the wheel
    zooms. Panning is allowed in the Atlas focus only.
  - Keyboard: arrows move between exhibits and items through the shared navigation helpers. Enter
    selects, Escape goes back, Shift+arrows orbit, +/− zoom, and Home/End reach the ends.
  - Gamepad: the D-pad or left stick moves, A selects, B goes back, the right stick orbits and the
    triggers zoom.
  - LB/RB and Q/E: today they keep their top-level tab behaviour. My Legacy uses them to cycle its
    landmarks. Using them to cycle collections is an open decision (§12).
- **Text:** DOM overlays built from registry entries. Each shows its label chip and, when it is not
  approved, the marker. There are no long paragraphs.
- **Failure:** if WebGL is unavailable or lost, the flat painting fallback offers the same records,
  plus a retry. Back always works.

### 6.2 Quest

- **Entry:** the existing `quest-state` route. The archive room fades in around the stationary
  viewer, who is never moved or rotated. The menu panel stays world-space, stationary and the
  control surface, and `View_Chronicles` keeps its id. Collection tabs replace exhibit tabs once the
  Contested Record exists.
- **Hands-first:** `RayInteractable` and `PokeInteractable` on every exhibit proxy and panel
  control. Either hand works, and no controller is required. Targets are at least 6% of the map
  width and at least 4 cm. Hover highlights, and a pinch selects.
- **Controls:**
  - Back unwinds exactly as on desktop.
  - Pause uses the existing flow, including the automatic pause on visibility blur.
  - Recenter re-places the panel and the archive relative to the head, never the viewer.
  - Exit VR is unchanged.

  All of them keep working after hand tracking is lost and recovered.
- **Text:** UIKitML generated from registry entries, with `questText` mapping dashes for the ASCII
  glyph atlas, and the marker chip on non-approved text.
- **Comfort:** no automatic camera motion. Transitions are fades or motion of content only. Text is
  sized for arm's length. The browser preview's camera tilt stays a preview-only accommodation.

### 6.3 Parity

Both platforms consume the same registry under the same policy, the same scene-state reducer and the
same exhibit and artifact definitions. `scripts/check-chronicles-sync.ts` asserts that every visible
registry entry and collection control exists in the generated Quest UI. The desktop verification
asserts that every on-screen string comes from `shared/chronicles` or the existing menu chrome.

## 7. Content status and the visibility switch

- **The switch:** `CHRONICLES_CONTENT_POLICY.showUnapproved` in `shared/chronicles/status.ts`. It is
  `true` in the draft build. `false` removes every working-proposal and placeholder entry, caption,
  perspective and marker from both platforms, through the registry and the generator input.
- **The marker:** every non-approved string on screen stands next to a visible "Working proposal"
  marker, or "Placeholder" for development text. The marker strings live in `status.ts` as
  placeholders and disappear with the switch.
- **Tests (E, M1):**
  1. With the switch off, the registry returns only creator-approved entries, and the generated
     Quest UI contains no proposal string.
  2. With it on, each non-approved entry renders with its marker, on desktop in the verification
     suite and on Quest in the sync check.
  3. `proposals/` modules carry only working-proposal or placeholder statuses.
  4. The hashed guard scans every exported string of every `shared/chronicles` module, which it
     already does.
- **Approved copy:** it stays verbatim in `content.ts` with its exports unchanged. The private
  content verifier must pass at every checkpoint.
- **Writing proposals:** only where the directive asks for text: exhibit captions, the Debt of
  Blackmere example, piece battlefield roles and short accounts. Keep it short, in Crownfall's
  public-safe register, and never presented as fact.
- **Never write:**
  - the creator's reserved mysteries;
  - anything about what the visitor is, or any link between the visitor and the people of the world;
  - where the archive is, who made it or why the visitor may enter;
  - invented capitals, borders or rulers' names;
  - a Muster constitution presented as law;
  - in-world reasons for the chess rules.

## 8. Future War Record interface (types only)

Chronicles will eventually read finished matches from My Legacy's War Record. Until that bridge
exists in merged, tested code, Chronicles depends on nothing from `feat/my-legacy`. These types live
in `shared/chronicles/war-record.ts` (M5), and their field names follow Legacy's finalised match
record so that the adapter stays trivial.

```ts
export type WarRecordSide = "w" | "b";
export type WarRecordPiece = "p" | "n" | "b" | "r" | "q" | "k";

export interface WarRecordIdentity {
  id: string;                          // representative identity
  side: WarRecordSide;
  piece: WarRecordPiece;
  houseId: string;                     // the house the representative belongs to
  label: string;                       // display name supplied by the War Record, never invented here
}

export interface WarRecordMove {
  ply: number;                         // authoritative order
  san?: string;
  from: string;
  to: string;
  actorId: string;
  capturedId: string | null;           // the identity captured on this ply
  capturedSquare: string | null;
  promotion: "q" | "r" | "b" | "n" | null;
}

export interface WarRecordMatch {
  schema: 1;
  matchId: string;
  provenance: "verified-match" | "development-fixture";
  stakes: "classic" | "muster";
  identities: readonly WarRecordIdentity[];
  moves: readonly WarRecordMove[];
  result: { winner: WarRecordSide | null; reason: string };
  completedAt: string;                 // from the record; never generated by Chronicles
}

/** Injected by each app; Chronicles never reads saves or storage itself. */
export interface WarRecordSource {
  verifiedMatches(): readonly WarRecordMatch[];
}

/** Deterministic interpretation: the same match always yields the same statements, and facts come only from the match. */
export interface PerspectiveTemplate {
  id: string;
  canonStatus: CanonStatus;            // working-proposal until the creator approves the wording
  perspective: "court" | "allied-house";
  statements(match: WarRecordMatch): readonly SourceStatement[];
}
```

Rules:

- When a match record exists, its moves and captured identities are authoritative. The Battle Record
  perspective is built from them alone, as `verified-fact` statements.
- Templates may interpret, but they never alter, omit or contradict a fact. A test compares every
  fact statement with the facts derived from the match.
- `development-fixture` matches never appear outside development previews.
- The authored example keeps its "Authored example" label even after real matches exist.

The adapter is written only after `feat/my-legacy` is merged and its engine bridge is tested. It
maps Legacy's engine-sourced records to `verified-match` and its fixtures to `development-fixture`.

## 9. Performance budgets

| | Desktop low | Desktop medium | Desktop high | Quest |
| --- | --- | --- | --- | --- |
| Draw calls | ≤ 120 | ≤ 250 | ≤ 400 | ≤ 120 |
| Triangles in view | ≤ 300k | ≤ 1.0M | ≤ 1.5M | ≤ 250k |
| Texture memory | per preset, mipmapped | per preset | per preset | ≤ 64 MB |
| Our script time per frame | ≤ 4 ms average, ≤ 8 ms p95 | same | same | ≤ 5 ms, no per-frame allocation |
| Long tasks once interactive | none over 50 ms | none | none | none |
| Frame rate (real hardware only) | 60 fps on a mid-range integrated GPU | | | 72 Hz |

The medium and Quest limits are the directive's. Low and high follow the My Legacy performance
standard.

**Rules:**

- One render loop at a time: the menu sorcerer and atmosphere pause while the archive is open and
  resume on exit.
- Render only while visible, and stop when the tab is hidden.
- Dispose of everything on exit.
- Show a loading state, and precompile shaders and upload textures before the reveal.
- Keep frames cheap: no allocation and no React state updates per frame.
- Cap the device pixel ratio.
- Use one bounded shadow map.
- Step quality down when frame time stays over budget for a sustained period.

**Measurement protocol (every round):**

- Playwright with CDP on desktop: long tasks (count and maximum), script time per frame
  (p50/p95/p99), JS heap and `renderer.info` before and after five Home ↔ Chronicles round trips,
  and draw calls, triangles and programs per preset. Entry, orbit and framing changes are repeated
  under 4× CPU throttling.
- Quest emulator: `renderStats` and a check that `update()` does not allocate.

The host renders in software (SwiftShader) on 4 CPUs under heavy load. Its absolute timings are not
representative, and the emulator never stands in for a physical Quest.

**M0 measurements:**

- Desktop relief: 19 draw calls and 306k triangles at high; 19 and 227k at medium.
- Quest browser preview (Brief E): 19 draw calls and 50.9k triangles.
- Long-task findings are in WORK_STATUS problem 2.

## 10. Ownership by role

| Role | Owns | Reviews |
| --- | --- | --- |
| A — lead architect | `docs/chronicles/**`, the contracts in this document, acceptance of every increment, the critic loop, the shared-file register | everything |
| B — environment and technical art | `shared/chronicles/archive/**`, `main game/src/chronicles/scene/**`, `main-game-vr/src/chronicles/scene/**`, Chronicles art in `main game/public/assets/chronicles/` (never redrawing the supplied map), `scripts/chronicles/**`, the provenance manifest, renders | — |
| C — desktop | `main game/src/Chronicles.*`, `main game/src/chronicles/**` outside `scene/`, `main game/scripts/*chronicles*`, the Chronicles hunks of `App.tsx` and `useBootLoading.ts` | desktop renders |
| D — Quest | `main-game-vr/src/chronicles/**` outside `scene/`, `main-game-vr/scripts/*chronicles*`, `scripts/check-chronicles-sync.ts`, the Chronicles hunks of `quest-state(.test).ts`, `crownfall-system.ts`, `ui-contract.ts`, `assets.ts` and `generate-quest-ui.ts`, and the `main-game-vr/package.json` scripts | Quest renders |
| E — historical content | `shared/chronicles/**` outside `archive/`: types, the frozen content, status, registry, scene state, proposals, war-record types and their tests | all on-screen text |
| Critics 1–5 | no files; findings with severity, evidence and corrective action | renders, text, VR comfort, code, first-time experience |

## 11. Merge plan with `feat/my-legacy`

Both branches stack on `feat/main-game-menu`. Neither merges the other, and nothing merges into
`main` without the product owner's authorisation. Chronicles never pulls `feat/my-legacy` in to gain
features. Once integration is authorised, merge My Legacy first, as the earlier and larger branch,
then merge or rebase Chronicles and resolve as follows. A read-only trial merge (`git merge-tree`, M0)
against committed `feat/my-legacy` conflicts in exactly three files:

| File | Resolution |
| --- | --- |
| `shared/menu/types.ts` | `destination?: "legacy" \| "chronicles"` |
| `shared/menu/content.ts` | Keep both destinations. Comment: My Legacy and Chronicles open their destinations on both platforms; Herald Board opens an information panel. |
| `main-game-vr/package.json` | Union of the `test` lists |

Legacy's uncommitted worktree also edits files that Chronicles changed:

| File | Resolution |
| --- | --- |
| `main game/src/App.tsx` | Union of the screens. Chronicles drops its `stageResting` overrides and uses Legacy's `menuSuspended` for `legacy` or `chronicles`. Footer and navigation `inert` conditions cover both. |
| `quest-state.ts` and its test | Union of the routes. The Home test expects destinations for both tiles. |
| `crownfall-system.ts` | Union: the atmosphere holds while paused, in Chronicles or in Legacy, and the sorcerer hides for either |
| `assets.ts` | Union of the entries |
| `check-menu-sync.ts` | Keep the Chronicles hook (one call) and Legacy's optional environment hook |
| `Atmosphere.tsx`, `CreatureStage.tsx` | Legacy's `suspended` props. Chronicles adds nothing beyond using them. |
| `menu.uikitml` | Regenerate with `npm run generate` after merging; never hand-merge |
| README files | Chronicles updates its README lines after Legacy's edits land (M6) |

After merging, run the full checks: both builds, `test:quest`, `test:legacy`, `check:sync`, the
private verifier, and the desktop and Quest verification suites of both features.

## 12. Risks and open decisions

| Risk or decision | Mitigation or owner |
| --- | --- |
| Release time (18 November) and a heavily loaded host | Priorities P0 → P3, with P3 cut first. Small increments with evidence. |
| Canon leakage or invented lore | Frozen approved layer, status and marker, the one switch, the hashed guard over every module, the private verifier, Critic 2 |
| Approval latency for proposal text | Draft builds show the marker. A release can ship with the switch off and still offer complete approved exhibits. |
| Single WebGL context for the archive | Fold the relief renderer into the archive renderer. Keep the menu contexts suspended, not rebuilt. |
| Long tasks on open (problem 2) | Loading state, staged compile and upload, measured every round |
| Quest performance on hardware is unknown | Baked lighting, instancing, budgets, presets. Headset checks are listed for the creator. |
| Shared-file conflicts with My Legacy | Minimal hunks, the register, the trial merge, the merge plan (§11) |
| Session-bound Blender environment | Commit the generator scripts. Outputs are deterministic and listed in the provenance manifest. |
| Open: on-screen collection names | Approved exhibit titles stay ("The Atlas", "The Interregnum", "The Laws of the Gambit"). A title for the Contested Record is a working proposal until the creator approves one. |
| Open: LB/RB and Q/E inside Chronicles | Cycle collections, as My Legacy cycles landmarks? Desktop owner proposes, architect decides. |
| Open: `suspended` props in `Atmosphere.tsx` and `CreatureStage.tsx` | Orchestrator approval for an identical port before the Legacy merge |
| Open: rules-engine access for validating authored moves | Orchestrator approval of a test-only dependency, or validation from an installed copy |
| Open: dashes rendered as hyphens on Quest | Creator confirmation |
| Orphaned runtime and dev server from earlier sessions | Orchestrator (WORK_STATUS problem 10) |
