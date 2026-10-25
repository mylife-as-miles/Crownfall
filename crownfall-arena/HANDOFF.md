# Crownfall environment — Claude track → Codex handoff

Maintained by Claude. Last update: 2026-10-23 (in progress — sections marked IN PROGRESS are not ready).

## Ground rules followed
- Codex's live Blender (MCP 9876), `outputs/**`, and Codex scripts were **never** connected to, opened for write, or saved.
  The saved v001 .blend was opened once **read-only** in a separate headless Blender to inventory it
  (`research/codex_v001_inventory.json`); nothing was saved.
- All Claude work runs in separate headless Blender 5.2.3 processes (`blender -b --factory-startup`, no MCP port),
  gated by `lib/run_blender.py` to ≤2 concurrent processes to protect RAM for Codex's session.
- Board untouched. Previews append a copy of the board read-only; asset .blend files do not contain it.
- No chess pieces, text, faction names or invented emblems.

## Scale: aligned with Codex's live layout (decision 2026-10-23 ~20:00)
I first proposed a monumental layout (8 m skull at 15 m). After reading Codex's refine02/03 transforms and an independent
camera solve from measured reference positions (`research/reference_study.md` §6c), both of which landed on the same
~10 m layout, **all Claude-track assets now target Codex's scale** so they drop straight in:
- Skull ≈2.7 m wide, at ≈(−3.8,8.1) in Codex's scene / (−2.8,9.5) research ideal.
- Hand ≈4.5 m visible, at ≈(3.6,9.8) / (4.5,10).
- Ribs 4–14 m. Altar drum Ø≈1.2 m. Eclipse r≈2 m at ~20 m.
Each asset carries `arrangement_codex.json` (Codex's transforms) and `arrangement.json` (research ideal).

## Contributions

### 1. Shared pipeline library — READY
| File | What |
|---|---|
| `lib/cf_sdf.py` | numpy SDF modelling (Perlin/fBm/ridged/warp, primitives incl. exact round-cone, smooth booleans) + vectorised Surface Nets mesher + fast Blender mesh bridge. |
| `lib/cf_materials.py` | procedural world-space materials `CFCL_*` (Basalt, AncientStone, BoneStone, Moss, Lava, Bronze, Fern, CrimsonLeaf, Bark). Being upgraded by the surface agent. Must be baked for GLB/runtime. |
| `lib/cf_render.py` | consistent preview rig (AgX Medium High Contrast), cameras, turntables, tri counts, read-only board append. |
| `lib/cf_atmos.py` | sky/eclipse/fog/light rig (see §2). |
| `lib/run_blender.py` | slot-gated headless runner. |
Validation: `scripts/_smoke_test.py` → `renders/_smoke_front.png` (SDF→mesh→material→EEVEE in one headless run).

### 2. Sky, eclipse, atmosphere, light rig — READY v002 (final balance happens at integration)
- Asset: `assets/CFCL_Sky_Eclipse/CFCL_Sky_Eclipse_v002.blend` (collections `CFCL_Sky_Eclipse_Body`, `CFCL_LightRig`, `CFCL_LavaMist`),
  built by `scripts/sky_eclipse.py` from `lib/cf_atmos.py`. v001 = superseded monumental-scale version.
- Eclipse body r=2 m at (3.95,20,5.25). On the 28 mm hero camera it measures centre (0.64,0.22), Ø 14.8% of W
  (reference 0.643,0.224 / 14.7%). The body has a faint flat haze emission so it reads ≈0.25 luma, darker than its sky,
  as in the reference.
- Corona: a camera-facing emissive card with these layers:
  - a thin cream-white limb (1.5× weight) and amber falloff;
  - radial flame streaks from seamless polar 3D noise;
  - low-frequency bright arcs;
  - an upper-right eruption lobe;
  - fade to zero before the card edge.
- Debris: 28 dark shards in the eruption, 70 far sparks, 110 sparse embers rising from the lava.
- `build_sky_clouds`: 9 dark smoke banks in the upper corners, which darken the top-left toward the 0.22–0.30 target.
- Fog: **a bounded box, never an EEVEE world volume**. EEVEE treats world volumes as infinite and they black out the sky
  (reproduced in iter02). Height falloff: density 0.024·exp(−(z+4)/5), green-grey albedo, anisotropy 0.3.
  Lava mist: a warm volume from Z −6 to −0.6.
- Lights:
  - warm eclipse rim sun 2.0;
  - cool fill sun 0.95;
  - sacred shaft spot on the board (700 W, 11°);
  - board fill from the player side;
  - 6 lava point lights (140–320 W) at Z −2.4…−2.8.
- EEVEE shadow pool is set to 1024 (otherwise "Shadow buffer full").
- Iteration log (`renders/sky/iterNN_*.png`):

| Iteration | Change | Result |
|---|---|---|
| iter01 | first pass | all orange: full lava plane plus over-strong lava lights |
| iter02 | — | black sky (world-volume behaviour) |
| iter03–04 | bounded fog | beige → green-grey |
| iter05 | rescaled to shared layout | eclipse lands on the reference spot |
| iter06 | hazed disc | white clipping |
| iter07 | — | clipping 1.2% (band 0.5–1.5%), top-left 0.27 |

- Remaining: shards are still slightly grey through the fog, and the fog's warm-grey veil needs re-balancing with real geometry
  (corners should drop to ≈0.20–0.25).

### 3. Hero sculptures — SKULL READY v003, HAND IN PROGRESS (v002 usable for tests)
- `assets/CFCL_Hero_Skull/CFCL_Hero_Skull_v003.blend`: objects `CFCL_Hero_Skull` (120k tris), `_Mandible` (24k), `_Rubble` (34k).
  - SDF-sculpted from human proportions, scaled to ≈2.7 m wide, origin at ground contact.
  - Features: brow, deep orbits, nasal aperture, zygomatic arches with real gaps, temporal crests, uneven teeth.
  - No attached mandible: a broken half-mandible lies separately.
  - Upper-left parietal impact breach into a hollow shell; radiating cracks.
  - Placement files: `arrangement.json` (research ideal, (−2.85,9.49,−0.38) yaw 30°) and `arrangement_codex.json` (your position).
  - Remaining defects are listed in its README: blocky teeth, a smooth occiput, and an ivory material (owned by the surface agent).
- `assets/CFCL_Hero_Hand/CFCL_Hero_Hand_v002.blend`: `CFCL_Hero_Hand` (118k), `_FingerFragment`, `_Manacle` (bronze, chain), `_Mound`.
  - A left hand with curled, asymmetric fingers reaching toward the eclipse.
  - v003 in progress: palm readability from the hero camera, pitting, and eclipse tangency.

### 4. Terrain — IN PROGRESS (usable for tests)
- Ribs v003: 7 unique faceted, segmented basalt ribs, 31 placements.
- Central v002: stratified central rock, SkullSeat, HandSeat, SpineRidge, broken RearSlabs.
- Abyss v003: lava channels, crust and banks.
- FarCliffs and Islands in progress.
- Open: near ribs are outside the 28 mm hero frame; lava not yet in the hero's bottom corners; basalt reads brown.

### 5. Architecture — ALTAR READY v003 (per README), ruins kit + far ruins IN PROGRESS
- `assets/CFCL_Arch_AltarDais/CFCL_Arch_AltarDais_v003.blend`, collections `CFCL_Arch_AltarDais_Drum` (29k tris) and
  `CFCL_Arch_AltarDais_Floor` (optional seated-VR floor at Z=−0.76; 64k tris).
  - Drum: 3-step, 12 blocks with lozenge/chevron friezes echoing the board border; offerings in the lunettes;
    top at exactly Z=−0.054, r=0.616.
  - Board clearance: 0 vertices or triangle overlaps in the board volume and in the r<0.45 / Z>0 cylinder.
  - Place at world origin with identity transform.
- `CFCL_Arch_RuinsKit_v002`: columns, wall, stair, lancet arch, ring segment, and optional gate jambs for Codex's gate.
- `CFCL_Arch_FarRuins_v002`: pale distant tower, colonnade, great arch, bridge.

### 6. Materials + vegetation — materials PROMOTED, veg kit v004 + `lib/cf_vegetation.py` (dress()) usable
- `lib/cf_materials.py` is the promoted library: in-place rebuilds and variant names, which fixes a material-deletion bug.
- Vegetation kit v004: ferns, crimson, vines, drips, roots, cushions, tufts, fungi.
- `cf_vegetation.dress(target, kit, seed, scale, density, exclude_fn=V.board_exclude)` attaches moss shells and clustered
  clumps, hangs vines and grows roots on any mesh. Max contact gap measured in integration pass01: ≤3.5 cm.

### 7. Reference study — READY (`research/`)

### 8. Independent critique of Codex pass02 — READY
`reviews/independent_review_codex_pass02.md` (4.3/10 vs Codex 5.0; metrics vs research bands; 8 ranked fixes tagged by owner; VR floor-height note at 40–50% confidence) and `reviews/pass02_aux/` (annotated defects image, crops, helper scripts).

### 9. Integration preview — pass01 rendered, pass02 rendering (test harness only, not a competing scene)
- pass01 (`renders/integration/pass01/`, 8 views): 4.5M tris, 1,579 objects, 22 min in EEVEE.
- Metrics (hero, vs reference):

| Metric | pass01 | Reference | Codex pass02 |
|---|---|---|---|
| p5 / p50 | 0.079 / 0.208 | 0.062 / 0.276 | p50 0.147 |
| RMS contrast | 0.192 | 0.19 | — |
| Pixels below 0.08 | 5.5% | 7.6% | — |
| Centre column | 0.30 | 0.48 | — |
| Warm saturated | 4% | 15% | — |
| Cool tint | 0% | 10% | — |

- pass01 defects:
  - the altar was missing (integrator lacked COLLECTION: placement support — fixed);
  - an arch-fragment forest in the centre column;
  - the hand touched the eclipse;
  - the skull was backlit;
  - no lava in the bottom corners;
  - ribs outside the frame.
- pass02 fixes:
  - collection placements;
  - optional gate jambs and left ring hidden;
  - eclipse moved to (3.0,20,5.4) with a darker disc;
  - front-right cool key 1.5;
  - cooler fog;
  - capped skull drips;
  - altar drum and dais dressed.

## How Codex can integrate (once assets are READY)
1. In Codex's session: `bpy.ops.wm.append` / `bpy.data.libraries.load(<asset blend>, link=False)` the objects of each asset,
   then apply `assets/<Asset>/arrangement.json` (schema: `{asset, blend, placements:[{source,name,location,rotation_deg,scale}]}`).
   `scripts/integrate_preview.py` is a working reference implementation of exactly this.
2. Hide (don't delete) the corresponding v001 objects (`ENV_Hero_Skull_*`, `ENV_Hero_Hand_*`, `ENV_Basalt_GothicNeedle_*`,
   `ENV_Sky_*`, `ENV_Island_*`) to A/B compare.
3. Materials are procedural (`CFCL_*`); bake to textures before GLB export.

### 10. Score log (independent fresh-context critics; image critiques only — never VR/runtime validation)
| Pass | Scene | Score | Review |
|---|---|---|---|
| Codex pass02 | Codex live scene | 4.3 (Codex self: 5.0) | `reviews/independent_review_codex_pass02.md` |
| Claude integration pass01 | preview harness | ≈4.4 (critic's estimate, not formally reviewed) | — |
| Claude integration pass02 | preview harness | **5.3** — slightly ahead of Codex pass03 (critic re-scale ≈5.0; Codex self 5.8): better sculpture/architecture/hero lighting/multi-view, worse terrain | `reviews/claude_integration_pass02_review.md` |

pass02 → pass03 plan (critic's 8 fixes, ≈+2.0 if all land):
- Lava in the hero bottom corners (terrain + integration).
- Near ribs in frame, with obelisks off the edges (terrain + architect).
- Raking key light and per-plane fog; disc 0.22–0.26; corner luma 0.22–0.28 (integration — applied in pass03).
- Hand gesture and anatomy (sculptor).
- Stratified islands on the skull→eclipse arc (terrain).
- Moss mask, stone chipping and chain/wax materials (surface).
- Skull brow, teeth and yaw (sculptor).
- Multi-view clean-up and stair rework (integration + architect).
No 9/10 is claimed; §6 of the pass02 review lists what 8 and 9 would visibly require.

### 11. Official showcase camera (user decision 2026-10-24)
The hero camera is locked as an official Crownfall arena showcase shot: `CF_CAM_hero`, location (0, −30, 9) m,
target (0, 20, 5.5), 24 mm on a 36 mm sensor, 1920×1080, cinematic profile.
Lighting is frozen except for small corrections. Further passes focus on asset quality:
1. the floating megastructure and the celestial ring mechanism (sky agent);
2. distant monolith silhouettes (terrain agent);
3. skull and hand material storytelling (Ucupaint agent);
4. eclipse corona: plasma strands, gaps, deeper orange (done in `cf_atmos`, v019);
5. vegetation variety;
6. board polish.

Every render must pass the gate (`scripts/gate.py`):
- mean luma ≥ 0.30;
- crushed ≤ 5% (excluding the eclipse disc);
- cool-tinted ≥ 10%.

Score history:
| Version | Score | Gate |
|---|---|---|
| v009 | 4.4 | — |
| v013 | 4.8 | — |
| v016 | 4.7 | fail |
| v017 | — | 2/3 |
| v018 | — | crushed 5.1% |

## 2026-10-24 afternoon: v019-v021, Meshy, Luminara, RunPod (orchestrator)
- **v019:** wear pass (`lib/cf_wear.py`), corona strands, hand vines removed, RitualFloor v011, Meshy organic set (`assets/CFCL_Meshy`).
- **v020:** adds the Luminara (KitBash3D) megastructure (`assets/CFCL_KB3D`; the kit's textures were not supplied, so CC0
  materials are mapped through pbr_mapping), Ucupaint skull v009 and hand v004, FarCliffs v007 and FarStacks v004.
- **v021** is a render-time variant of v020 (`scripts/render_variant.py` tokens):
  `cycles-fog2-keyhalf-disc-declutter-tiles-rim-hq`. Its hides are now also in layout_overrides.
- **Renderer:** Cycles on RunPod (`runpod/`, README). The cached volume `crownfall-cache` is in EU-RO-1. A round costs
  about $0.09 when the scene is cached and about $0.35 when the 557 MB scene must upload.
- **Scores:** independent critic 4.8/10 for v020 Cycles.
- **E33 metrics, v021 vs E33:**

  | Metric | v021 | E33 |
  |---|---|---|
  | mean | 0.396 | 0.396 |
  | darks | 6.7% | 11.5% |
  | shadow std | 6.1 | 10.1 |
  | block | 7.9 | 5.0 |
- **Open items (critic):**
  - lava pools and rivers lighting the skull and hand bases;
  - the sky slabs need glowing crimson and gold cracks, and a darker top of frame;
  - fewer, larger fractured megastructure fragments;
  - scale and clutter;
  - the disc still shows a grey gradient (suspect `CFCL_SkyShatter_CloudVolume` in front, or glare bleed);
  - the corona is still one-sided.

## v022 (2026-10-24 16:35)
- **Living chess pieces (user request, superseding the original "no chess pieces" rule).** `assets/CFCL_Pieces` uses the
  Crownfall game's own figures: Ivory = White, Sun Empire = Black, the game's DEFAULT_ARMY_SKINS. Each is posed with
  the game's idle or combat-stance clip and baked to a mesh, and placed in the opening position at the game's
  PIECE_HEIGHT x 2.3 m.
- **Look fixes** (`lib/cf_lookfix.py`, `layout_overrides.lookfix`):
  - lava pools and rivers with uplights at the skull and hand bases;
  - sky dome darkened toward the top, plus crimson and ember-gold crack glow;
  - corona bias reduced to near 360 degrees;
  - smoke card in front of the disc hidden;
  - SpeckS debris hidden;
  - megastructure x1.35 with fewer pieces.
- **RunPod renders** (`runpod/results/v022_hero_r1610`): hero + new `army` camera (render_variant token `camarmy`).
  Pod time was 24.5 min, about $0.36; the upload of the new scene dominates it.
- **Still open:** the disc still reads dark grey in Cycles (suspect glare bloom or the remaining smoke cards); floating
  cube debris at the upper left; critic items on scale and clutter.
