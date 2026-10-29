# The Bannerhold — environment production brief

The product owner's direction for the dedicated environment workflow. Read with
`docs/legacy/BRIEF.md` (overall My Legacy direction) and `docs/legacy/WORKFLOWS.md` (ownership
and contract). Deliver a working, rendered 3D environment on desktop and Meta Quest — never only a
design document, concept image or static substitute.

## World canon and confidentiality

Crownfall's world canon is maintained privately by the creator and is never committed to this
repository. Agents receive the private canon brief through their task instructions, outside version
control; never copy its text, named institutions, languages or history into any committed file.
Committed work uses only public-safe setting detail — Crownfall as the world and the King's Gambit as
its chess-derived conflict institution, Year 33 of the Ash & Aether Interregnum, and the four nations
Korvenia (occult Grand Duchy), Solforiz (sulfur-industrial Scorched Caliphate), Aethelgard (primordial
Blood-Throne) and Kwind-09 (industrial/cyberpunk Kwind Zaibatsu) — plus plain descriptive language.
Every name, rule or lore element an agent invents is a working placeholder pending creator approval:
keep it in replaceable content files and never present it as canon. Legacy prototype names from
`web/` are not nation canon. Player-facing copy says "the capital" rather than inventing capital
names, and adds no lore about the player. The creator has approved using the Ash & Aether Linguistic
Atlas in game content — its writing systems as captioned inscriptions, each nation's evidence and
certainty categories, mottos, sound direction and naming. Agents receive the atlas and its usage rules
privately; never commit the atlas itself or bulk word lists. Critics treat invented canon presented as established,
lore leaks and contradictions of the canon brief as blockers.

## Vision

Crownfall combines the political scale of *Game of Thrones*, the character attachment of
*Baldur's Gate 3*, the ownership of settlement builders and the strategy of chess. The player is
unseen and guides a small banner in one of four nations (Korvenia, Solforiz,
Aethelgard, Kwind-09), granted a minor holding inside an enormous established civilisation. Make the
player feel small within the political world while their Bannerhold feels personally important. With
no exposition they should understand: this land belongs to my banner; people live here; my nation is
far larger and more powerful than my house; other houses existed before mine and have their own
interests; my holding has a past and an uncertain future; what happens on the King's Gambit board may
change life here.

## Package A — spatial blueprint (required before final construction)

An environment bible with real measurements in one consistent coordinate system: annotated top-down
map, building positions and footprints with relative heights, terrain dimensions and elevation plan,
landmarks, road and pedestrian circulation, settlement boundaries and neighbouring territories, view
corridors and the distant skyline, the player's initial observation position, key cinematic camera
angles, day/night or atmospheric presentation, NPC activity locations, interactive landmark
locations and future expansion areas; plus an architectural style guide, lighting direction,
storytelling locations, the desktop camera plan, the VR viewpoint and interaction plan, four
nation-specific design sheets and a shared technical environment specification. Starting reference:
a settlement of roughly 100 × 80 m, shown as a comfortably observable miniature in VR — adjust through
visual testing.

Districts:

- **A. Central Manor and Banner Hall** — the most important building; dominates the composition
  without becoming a royal palace. Central courtyard, distinctive entrance, heraldic banners and
  shields, a gathering/ceremonial space, a visible emblem, evidence of limited wealth, room for future
  expansion.
- **B. Muster Grounds** — connected to the main road and the manor courtyard. Training ground,
  practice equipment, muster platform, weapon storage, guard positions, an identifiable place for the
  nominated Pawn and their condition.
- **C. Residential Quarter** — several houses of different sizes, functions, ages, repairs and
  material quality on pedestrian routes; courtyards, cooking fires, storage, wells, fabric, tools.
  Residents are not all standing around waiting for the player.
- **D. Artisan and Supply Quarter** — a forge, workshop, granary or cultural equivalent that looks
  functional.
- **E. Herald's Station and Main Gate** — a significant entrance where summons and communications
  arrive, with a road leading out toward the greater nation. Not a sealed snow globe.
- **F. War Record** — a physical archive or historical focal point connected to the Manor,
  ready for inspection of conflicts, losses and relationships. A real architectural place.
- **G. Outer Territory** — terrain, distant roads, fields, outposts, neighbouring estates and distant
  settlements that make the larger civilisation believable.

## AAA quality bar

An authored game environment, not an automatic procedural layout; an original Crownfall identity
(inspiration may come from *Expedition 33*, FromSoftware's architectural storytelling and major
fantasy RPG settlements — never copied). Memorable silhouettes, composed focal points, coherent
materials, intentional palettes, atmosphere without noise, believable scale, distinctive roofs,
foundations, walls and structural detail, terrain and architecture physically integrated, layered
near/middle/far composition, natural environmental animation, directional light with convincing
ambient light, and a clear sense of history, social hierarchy and habitation. No generic cube
buildings, repeated identical huts, random props, featureless terrain or excessive bloom. It must
still impress with post-processing disabled.

Storytelling evidence: a watchtower repaired after an earlier conflict, weathered fortifications, a
humble levy yard contrasted with distant noble architecture, a road used by merchants and national
messengers, an unfinished structure implying growth, a small ceremonial place for recognised
achievements, and empty or occupied character positions driven by real gameplay data. Class
differences visible without narration.

## Four culturally different nations

Different terrain logic, settlement organisation, dominant shapes, construction traditions and
atmosphere — not material recolours.

- **Korvenia** — Gothic occult Grand Duchy beneath an eclipse: dark aged masonry, vertical manor
  architecture, narrow streets, Gothic towers and steep roofs, formal courtyards, ritual details,
  veiled standards, distant aristocratic estates.
- **Solforiz** — sulfur deserts and fortified settlements: terraces, thick stone walls, shaded
  courtyards, carved sandstone, mineral formations, ventilation towers, covered streets, water
  management, dense market and workshops.
- **Aethelgard** — primordial bloodline nation: timber and megalithic architecture, massive
  ancestral halls, rugged terrain, fortified clan compounds, monumental stonework, settlement bound to
  wilderness, ancestral and bonded-beast traditions.
- **Kwind-09** — corporate zaibatsu: a chartered district or compact corporate enclave, never a
  neon medieval village. Layered infrastructure, dense industry, residential blocks, elevated roads,
  mechanical signage, corporate towers beyond, service corridors, privileged versus lower districts.

Choose the first production nation from assets and requirements; Korvenia as benchmark is a
reversible production default, not a canonical choice. Never lock the launch nations. The
architecture must support authoring all four with genuinely different geometry and layouts.

## Camera and the unseen player

Never a third-person character. **Desktop:** a composed initial view, cinematic overview with
restrained orbit and zoom, landmark inspection and return, smooth controlled transitions, no clipping.
**Quest:** physically convincing 3D from a comfortable stationary vantage overlooking the
Bannerhold; lean in, inspect details, point at landmarks; hand-based spatial selection; no forced
locomotion or sudden artificial camera motion; depth, spatial audio, layered terrain and motion make
the territory feel expansive; the same geography and landmarks as desktop at a comfortable scale.
Document display scale, viewer distance, rotation limits, interaction reach and recentring.

### Character occlusion reveal

The camera never loses the character it is framing — the named representative, the herald, any
inspected figure — behind geometry. Implement this pipeline, the Three.js equivalent of a spherecast
and sphere-mask dissolve:

1. **Spherecast, character → camera.** Each frame the active framing needs it, sweep a sphere
   (about 0.5–0.8 m at Bannerhold scale; tune by eye) from the character's chest to the camera.
   Test it analytically against the occluder volumes derived from the blueprint (oriented boxes or
   prisms from footprints, heights and roofs) in a pure shared module. No per-triangle raycasts in
   the hot path; a `Raycaster` refinement against merged occluder meshes is allowed on High only.
   The result is "occluded or not" and the nearest hit point along the segment.
2. **Lerp the hit point.** Frame-rate-independent damping (`1 − exp(−k·dt)`) of the reveal centre and
   of a 0–1 reveal strength, with hysteresis. The hole eases in and out and never pops or flickers
   when the camera or character moves.
3. **Sphere mask in the material.** Occluding materials (buildings, walls, roofs, trees and props —
   never the character, the ground it stands on, landmark labels or UI) get one shared shader patch
   (`onBeforeCompile`, in the existing shader-patch module). It computes a world-space sphere mask
   (or a camera-aligned capsule) around the smoothed centre, scaled by strength.
4. **Add noise.** Break the edge with cheap world-space 3D noise that stays stable and does not
   swim in screen space. Add an optional slow drift and an optional thin, warm rim at the edge.
5. **Material function as alpha.** One shared GLSL chunk outputs the opacity mask. Materials stay
   opaque and use dithered alpha-test discard (Bayer or blue noise), so depth, sorting and shadows
   stay correct. Shadow and depth materials do not apply the mask. A uniform skips the branch
   entirely when strength is 0.

Performance: one sweep per active character per frame, zero per-frame allocation, no new
dependencies, and one shared uniform object across all patched materials. Report the measured cost.
On Quest, apply the same mask with the viewer's head as the camera for the inspected representative
in the miniature (cheaper noise, off on Low) and never move the viewer. Ownership: the shared sweep
module and the desktop patch belong to the camera/lighting stage (env-light-camera), the Quest patch
to the Quest renderer stage. Earlier stages keep their materials patchable.

## Life

A handful of meaningful behaviours on believable schedules or deterministic patterns: a sentry
patrol, a smith at the forge, a messenger at the gate, soldiers drilling, residents crossing, chimney
smoke, banners in the wind, distant activity, atmospheric change. Distance-based update rates,
cheap rigs and distant representations per platform. Never an empty architectural visualisation.

### Inscriptions, mottos and sound

Signage, carved inscriptions, banners and documents in the Bannerhold may use the nation's atlas
writing system (Bellhand, Ashstroke, Marrowstaves, Skyscript or Ledgerline), always with a readable
caption, plus the nation's motto. Later ambient sound follows the atlas's acoustic direction:
Korvenia's three-pulse hourly ward bells, the Solforizi four-pulse engine and clapper signals, and
the others. All of it is a working proposal kept in replaceable data.

## Gameplay-driven changes

Adapters for shared Legacy state: the available Pawn appears at the Muster Grounds; a captured Pawn
leaves an empty place and a record in the holding; a returned Pawn is restored; recognition adds
honours at the Banner Hall; a rival challenge brings heraldic correspondence to the Herald's Station;
development adds architecture, activity and decoration. Never hardcode victories or captives into
production scenes; provide a harness with clearly labelled development fixtures. Gameplay supplies the
authoritative events.

## Regional map of the player's nation (later increment)

My Legacy gets a surveyed map of the region around the player's holding: the holding itself,
neighbouring estates and villages, roads, rivers, the allied and rival houses' seats, and the capital
in the distance. Chronicles keeps the world-scale atlas; this map answers "where does my house
stand in my nation?"

- **Style.** A surveyed cartographic relief: coherent hillshaded terrain, rivers that drain
  downhill to water, gradual biome transitions, roads and tracks, settlement symbols, a compass, a
  scale bar and a legend. Each nation draws it in its own cartographic dialect — a Korvenian
  ecclesiastical chart, a Solforizi navigator's chart, an Aethelgard rune-carved survey, a Kwind-09
  ledger-grid survey — so the information is shared but the culture differs.
- **One source of truth.** Generate it from the blueprint's outer-territory data (the same
  bearings, distances, elevations and places the 3D scene uses), so the map can never disagree with
  the Bannerhold. No hand-drawn duplicate geography.
- **Where it lives.** A war table in the War Record landmark: a carved 3D relief of the region with
  the player's banner pinned on the holding, legible from the War Record framing on desktop and
  from the Quest vantage. It can later show where Herald summons and rival houses come from.
- **Canon.** The capital is always "the capital". Every other place name is a working placeholder
  kept in replaceable data and flagged for creator approval. Geography stays representational and
  must not settle the four nations' borders.
- **Order.** Reserve the war-table position and framing in the War Record now. Build the map once
  the core Bannerhold has passed critique. Critics track it as a planned increment, not as a blocker
  for the core acceptance.

## Pipeline and performance

Reusable building kits and prefabs, optimised GLB where appropriate, material and texture reuse,
atlases or trim sheets, instancing, LOD, baked lighting for Quest, occlusion/visibility where
practical, platform quality profiles. Desktop gets a higher-quality option; Quest keeps the identity
without frame-rate-hostile features. Measure actual performance; never claim stable headset frame
rates without physical-device evidence. Original or properly licensed assets with provenance; no
fragile external dependencies.

**Library decisions (evaluated 29 Oct 2026):**
- **meshoptimizer:** adopted, at build time only. Every exported GLB, including Blender hero prefabs,
  goes through a pinned `gltfpack` as the final pipeline step. Use quantisation, which is
  KHR_mesh_quantization and loads unchanged through IWSDK's AssetManager. Use simplification for
  Quest LODs where it holds up visually. Never use the decoder-dependent compression flags (`-c` or
  `-cc`) for anything Quest loads: IWSDK 1.1.0-rc.2 configures only Draco and KTX2 decoders. Export
  from Blender with Draco and meshopt off, and record each pass in the asset provenance.
- **Recast/Detour, Jolt and ozz-animation:** rejected for now. Life stays authored, deterministic and
  allocation-free. Physics, if ever needed, goes through IWSDK's built-in engine, and animation
  through three.js. Reopen navigation only if goals are chosen at runtime, a human-scale avatar
  appears, or figures visibly clip in close-ups. In that case try navcat (pure JS) at build time
  first.
- **Route solidity:** add an `npc-solid` validator check. Sample every life route at 0.5 m intervals
  against building masses inflated by 0.3 m, towers and solid dressing, keep the doorway allowance,
  test tier-gated buildings at each tier, and fix the routes it flags.

**Known overage to fix:** the Quest whole-build draw calls in TECHNICAL_SPEC §9 are 125–180 in every
nation, against the 120 budget. The §9 Quest row also disagrees with quality.ts (16 agents and
vegetation 0.45 against 10 and 0.26). Reconcile the two, then merge meshes by material and cut
figure prototypes, before morph-target instancing for walk poses. The desktop High preset was
measured at 2.66M triangles against its 1.5M budget. Critics treat both as blockers.

## Acceptance

A concrete spatial blueprint; a believable settlement with roads, housing, a central Manor, Muster
Grounds, War Record, Herald's Station and infrastructure; a larger nation implied by landscape,
roads and distant architecture; real interactive 3D on desktop and Quest showing the same settlement
and landmarks with platform-appropriate camera and interaction; interactive major landmarks; a character occlusion reveal that keeps the framed representative
visible through any building, with a smooth, noisy dissolve and no popping; fixtures
that demonstrate change without fabricated progress; an original coherent identity; existing
functionality intact; builds and sync checks passing; smooth, lag-free browser performance meeting every budget and the measurement protocol in `docs/legacy/PERFORMANCE.md`; real screenshots and performance evidence; a
record of what was verified on hardware versus emulation.
