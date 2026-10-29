# The Bannerhold — environment bible

The design reference every environment agent builds from. It explains the layout; it does not
restate it. **The single source of truth is the blueprint code** in
`shared/legacy/environment/blueprint/` (one file per nation under `nations/`). Both renderers,
the map generator, the validator and the tests read the same data, so numbers quoted here are
for orientation — when they disagree with the code, the code wins and this page is stale.

| Document | Purpose |
| --- | --- |
| `BIBLE.md` (this page) | Vision, districts, circulation, storytelling, class and history cues, lighting direction, camera and VR plans, expansion |
| `STYLE_GUIDE.md` | Architectural kit language, proportions, materials, palettes, signage of age and repair |
| `NATION_KORVENIA.md`, `NATION_SOLFORIZ.md`, `NATION_AETHELGARD.md`, `NATION_KWIND-09.md` | Per-nation design sheets |
| `TECHNICAL_SPEC.md` | Shared pipeline, kit registry, materials, budgets, quality profiles, state mapping, verification |
| `maps/<nation>-plan.png` / `-site` / `-elevation` / `-region` / `-views` / `-schedule.md` | Generated from the blueprint by `scripts/generate-legacy-environment-maps.ts`; never edited by hand |

Every place name, building name and story line in the blueprint is a **working placeholder pending
creator approval**. Names live only in the nation files so they can be replaced in one place.

## 1. Production nation

**Korvenia is the reversible production default** (`PRODUCTION_DEFAULT_NATION` in
`blueprint/index.ts`): the benchmark the first production-quality environment is built for. It is
not a canonical or launch choice — the launch armies are undecided and nation availability stays
configuration owned by gameplay. Switching the default is a one-line change; all four nations are
authored, validated and tested to the same rules today.

Why Korvenia first:

- **Assets.** The existing My Legacy home art is dark carved stone under warm, low light with
  crimson, gold and violet accents; the menu theme is warm-dark. Korvenia's Gothic eclipse holding
  is the closest match, so the first environment sits naturally beside what players already see.
- **Requirements.** The brief describes Korvenia most concretely (vertical manor, narrow streets,
  Gothic towers, formal courtyards, veiled standards). Its vertical terrain logic exercises the
  hardest shared-pipeline features first: retaining walls, a 9 m stair between levels, steep roofs
  and spires, jettied frames, walls with walkways, a ravine stream and a brook. A kernel proven on
  Korvenia carries the gentler layouts.
- **Lighting.** Eclipse light is low-key and directional; a scene that reads under it reads without
  post-processing, which the quality bar demands.

## 2. Vision: six things the player must understand without exposition

| The player must grasp | How every layout shows it |
| --- | --- |
| This land belongs to my banner | The banner's heraldry on the gate, the hall emblem, the founding standard and the muster standards (`slots.bannerMounts`, player heraldry from hall tier 0); boundary stones at the edge of the holding's fields |
| People live here | Dwellings of every class and age with chimneys, laundry, cooking fires and workshops; deterministic daily routines (`npcs`); smoke, banners and water in motion |
| My nation is far larger and more powerful than my house | The capital on the skyline 14–28 km away, always unnamed; a national road with couriers and carts; the crown's notices and veiled or corporate standard at the Herald's Station; an allied Great House seat visibly grander than the holding |
| Other houses existed before mine and have their own interests | Marks of the previous holders (chiselled arms, sealed doors, a burnt tower, an empty longhouse), neighbouring estates, a boundary dispute, the allied seat and the frontier toward the rival's nation |
| My holding has a past and an uncertain future | A repaired watchtower, weathered fortifications, ruins, an unfinished structure, empty honour places and marked expansion plots |
| What happens on the King's Gambit board may change life here | The nominated Pawn's marked place (occupied or empty), the captive marker, War Record markers, honours, herald notices and hall-tier development — all driven by gameplay state, never faked |

The emotional key: the player feels small within the political world while the holding feels
personally important. Every establishing view therefore places the holding in the lower and middle
ground and a greater power — the allied seat, the capital, the expressway and towers — above it.

## 3. Coordinates and scale

One system for everything (`BLUEPRINT_COORDINATES`): right-handed, **+Y up, metres, +X east,
+Z south, north is −Z** (an unrotated three.js camera looks north). Plan points are `[x, z]`, world
points `[x, y, z]`. Compass bearings run clockwise from north. `rotationDeg`/`yawDeg` is a yaw about
+Y in the three.js sense (positive turns counter-clockwise seen from above); at yaw 0 a building's
front (local +Z) faces south. The origin is each holding's datum at elevation 0 near its main
circulation spine; elevations are absolute.

The brief's reference settlement is roughly 100 × 80 m. The four cores realise it at
121 × 112 m (Korvenia), 105 × 104 m (Solforiz), 108 × 88 m (Aethelgard) and 112 × 92 m (Kwind-09);
modelled terrain runs to ±200 m and the far landscape, outer places and skyline beyond.

## 4. Districts

Every nation provides districts A–F as plan polygons; G is everything outside the holding.

| District | Role | Korvenia | Solforiz | Aethelgard | Kwind-09 |
| --- | --- | --- | --- | --- | --- |
| A Central Manor and Banner Hall | The most important building, a gathering space, a visible emblem, limited wealth, room to grow | Banner Court on a basalt spur at +9 m: lead-roofed hall, keep and spire, lodging, kitchen range, unfinished West Range, Court Gate, Honour Court | Top terrace at +14 m: domed hall and great windcatcher, household wing, manor gate, unfinished cistern house, Court of Honours | Longhall yard at +10 m inside the palisade: the ancestral longhall, chief's house, cook house, guest-hall frame, hearth of honour posts | Charter deck at +11 m: tiled charter hall and steel ledger tower, household block, canteen, gate lodge, honour terrace, annex frame |
| B Muster Grounds | Training ground, muster platform, weapon store, guards, the nominated Pawn's place | Muster Terrace at 0 m under the court's 9 m retaining wall | Parade court at +8 m | Levy terrace at +5.5 m below the gate | Painted loading yard under the 8 m podium wall |
| C Residential Quarter | Houses of different sizes, functions, ages, repairs and quality on pedestrian routes | Lantern Street, Rock Lane and Wall Lane, stepping toward the ravine | Courtyard houses on Shade Lane | Family yards along the inside of the west palisade | Blocks on Charter Street and the quay with back courts |
| D Artisan and Supply | A forge, workshop, granary or equivalent that looks functional | Smithy, workshop, tithe granary and barn | Covered market, grain domes, sulfur works, smithy, caravan court | Smithy with forge shed, tannery, smokehouse, staddle granary, woodwright, great byre | Fabrication shed, freight lift, ration depot, water tower, substation, quay warehouse |
| E Herald's Station and Main Gate | Where summons arrive; a road out toward the greater nation | West Gate and herald tower | Basin Gate and herald station | South gate tower, herald's hut and horn tower | Checkpoint under a sign gantry and the signal office |
| F War Record | A real architectural archive connected to the manor | Record house and tower on its own shelf, gallery bridge to the lodging | Domed archive joined to the hall by an arcade | Carved-board record house with a covered passage | Copper-roofed ledger vault with a glazed skybridge |
| G Outer Territory | Terrain, roads, fields, outposts, neighbours, distant settlements | Valley, brook, mill, strip fields, abbey, market town, the capital 20 km away | Mineral basin, oasis, causeway, refinery, the capital 28 km away | River valley, ford, fields, fell, stone ring, the capital 26 km away | Harbour, allotments, arterial and expressway, towers, the capital 14 km away |

The landmark contract (`LEGACY_LANDMARKS`) maps onto districts A (Banner Hall), B (Muster Grounds),
F (War Record) and E (Herald's Station). Each landmark has a label anchor, a pick sphere
(radius 7–14 m, 5.6–11.2 cm at the VR scale) and an authored desktop framing.

## 5. Circulation

Routes are polylines with width, surface, users and a hierarchy: **national** (one per nation, from
the main gate out of the modelled terrain toward the capital, 5–20 km), **primary** (the spine:
Gate Street, the market stair, Charter Street, the hall way), **secondary** and **pedestrian**
(lanes, alleys, stairs, courts) and **service** (kitchen passages, tracks, the deck service way).
Rules the validator enforces and the tests repeat:

- Every route joins the main gate's network (a junction is an endpoint of one route lying on
  another; stairs and ramps join any grade). The gate, manor, muster grounds, residential quarter,
  artisan quarter, archive and herald are each reached.
- Ground routes cross barrier walls only at gates. Elevated routes (stairs over retaining walls,
  the Kwind-09 expressway and off-ramp, landing stairs) carry a deck height per point.
- No building blocks a route except within 2.5 m of its own door; every door lies within 6 m of a
  route. Narrow streets are deliberate — Korvenia's Lantern Street is 3.6 m between jettied
  gables — but always passable.

Each nation's circulation expresses its organisation: Korvenia climbs (street → stair along the
retaining wall → court gate → court); Solforiz descends one axial spine with a rill beside it;
Aethelgard rings a hearth inside a palisade; Kwind-09 separates a deck from a yard with a gated
stair, a freight lift and a service ramp, while the expressway passes over everything.

## 6. Storytelling locations

Each nation places every required kind (`REQUIRED_STORY_KINDS`) and adds its own. Locations are
places in the data (`story[]`), referencing real buildings, walls, towers, routes, dressing or
distant places.

| Kind | What it must show |
| --- | --- |
| repaired-watchtower | One tower visibly repaired after the earlier conflict: a clean seam between old and new material, never hidden |
| weathered-fortification | Wall segments marked weathered, damaged or ruinous with specific notes (fallen merlons, propped palisade, welded breach) |
| levy-yard-vs-noble-architecture | The humble muster ground seen against the house's own hall and the allied Great House's far grander seat |
| merchant-road | The national road used by merchants, couriers and the crown's riders, with a waiting cart and waymarks |
| unfinished-structure | A building under construction that completes at hall tier 1 (`unfinished.completesAtHallTier`) |
| ceremonial-place | A small place for recognised achievements with empty honour places that only recognition fills |
| empty-character-position | The nominated Pawn's marked place, occupied or empty according to real state |
| older-house-ruin, class-contrast, ancestral-memory, boundary-dispute, water-memory | The holding's past and its social order (optional kinds; every nation uses several) |

The earlier conflict is never named, dated or explained. Previous holders are never named; their
marks are chiselled flat, planed off or sealed.

## 7. Class and history

Class is built in, not narrated. Every building carries `quality` (noble, fine, common, poor),
`social` (lord, retainer, martial, civic, sacred, artisan, commoner, labourer), `age.era`
(ancestral, predecessor, founding, recent, under-construction), `age.condition` and a list of
specific `repairs`. Each residential quarter mixes at least two qualities, three conditions and two
eras with no repeated massing. The visual consequences are defined in `STYLE_GUIDE.md`:

- **Limited wealth.** The hall is the one noble building and is too large for the new house: shut
  bays or lancets, a single costly material (Korvenia's lead roof and black marble porch, Solforiz's
  green-glazed dome, Kwind-09's tiled heritage roof), founding-era repairs done cheaply.
- **Hierarchy by height.** Korvenia's court sits 9 m above the levy; Solforiz's manor crowns the
  top terrace; Kwind-09's deck stands 8 m above the yard; Aethelgard's compound towers 4.5 m over
  the levy terrace. The poorest dwellings are lowest, nearest the damp, the wall or the bank.
- **History.** Three layers per nation: the predecessor's ambitious building, the earlier
  conflict's scars and repairs, the founding banner's cheap new work and its unfinished ambition.

## 8. Lighting direction

| Nation | Time and light | Key colours | Accents |
| --- | --- | --- | --- |
| Korvenia | Eclipse noon: the sun held behind a black disc, a corona low in the west-south-west, a dusk band round the horizon | Violet-grey sky, basalt, slate, pale limestone repairs, restrained gilt | Braziers, candles, the forge, lanterns |
| Solforiz | Late afternoon in sulfur haze, the basin glowing below the terraces | Warm sandstone, sulfur yellow, green-glazed tile | Furnaces and storm lanterns |
| Aethelgard | Cold upland late afternoon, low sun under broken cloud, mist on the river | Black oak, green and red turf, pale new timber | The hearth, the forge, torches, the horn tower lamp |
| Kwind-09 | Last light of the day shift, smog-red sun, signage coming on, rain on concrete | Concrete, soot brick, rust, verdigris | Sodium, fluorescent, the banner's cyan sign, furnace orange |

Principles for both platforms: silhouette first — dark masses against a luminous horizon band; one
directional key light with a convincing, never-black ambient; small warm local accents; fog as a
layer of depth, not a veil; no global bloom; every view must read with post-processing disabled.
Values live in each blueprint's `atmosphere` (sun bearing and elevation, sky, fog, wind, exposure,
accent lights, palette); the per-nation sheets explain them.

## 9. Desktop camera plan

Never a third-person character. Each nation authors seven framings (`cameras[]`), each with
position, target, vertical field of view (16:9 reference) and a restrained orbit — yaw relative to
the authored azimuth, pitch above the target, absolute distance — plus a transition time and a
written composition.

| Framing | Use | Typical numbers |
| --- | --- | --- |
| `establishing` | The player's initial observation position (`observation`), the return of `resetView()` and the overview | 150–200 m out, 30–60 m up, FOV 38–40°, yaw ±25–30°, 2.4 s transition |
| `founding` | The founding ceremony: the draft standard raised at the founding standard pose | Eye level in the muster ground or yard looking up at the standard and hall, FOV 50–52° |
| `landmark:banner-hall`, `landmark:muster-grounds`, `landmark:war-record`, `landmark:heralds-station` | `focusLandmark()` inspection | 22–70 m orbit, pitch 8–46°, FOV 40–46°, 1.6 s |
| `representative` | `inspectRepresentative()`: the nominated Pawn or their empty place | 5–10 m, eye level, FOV 32° |

The validator checks every framing against the terrain and every building: the authored position
and the twelve orbit extremes stay at least 1 m above ground and outside solids; the line of sight
to the target is clear; the landmark's label anchor stays in frame at 3:2; the representative and
founding framings hold their subjects. Renderers must still clamp near-plane clipping per frame and
ease with time-based curves; orbit nudges (`nudgeOrbit`) clamp to the authored ranges.

Composition rules: lower third for the holding's daily life, middle for the landmark, upper third
for the greater power (allied seat, towers, capital); the main road leads the eye out of frame
toward the capital; light rakes across façades rather than flattening them.

## 10. VR viewpoint and interaction plan

The Quest scene is a **table-top miniature** of the same blueprint, viewed from a stationary vantage.
The viewer is never moved or rotated by the environment.

| Parameter | Value (all four nations) | Source |
| --- | --- | --- |
| Display scale | 1:125 (0.008 physical metres per blueprint metre) | `vr.displayScale` |
| Detail region | 112–136 × 112–136 blueprint metres → 0.90–1.09 m on the table | `vr.detailExtent` |
| Terrain skirt | 150 m far, 70 m lateral, 0 toward the viewer, fading at its rim | `vr.skirtMargins` |
| Seated | eyes 1.20 m, surface 0.74 m, miniature centre 0.82 m in front | `vr.seated` |
| Standing | eyes 1.62 m, surface 0.98 m, centre 0.85 m in front | `vr.standing` |
| Near edge | ≥ 0.28 m from the eyes (lean in without clipping) | validator |
| Tallest structure | below eye height in both postures (Korvenia's keep spire tip rises 0.35 m above the datum) | validator |
| Rotation | user-rotatable ±45° in 15° snaps; reset on recentre | `vr.rotation` |
| Reach | poke 0.65 m, ray 3 m, minimum target radius 3.5 cm (landmark pick spheres are 5.6–11.2 cm) | `vr.reach` |
| Recentre | re-places the gameplay anchor in front of the viewer, keeps scale, resets yaw and posture heights | `vr.recentre` |
| Horizon | distant silhouettes on an 8 m ring (−0.18 to +1.22 m), so the nation stays vast | `vr.horizon` |
| Panels | primary at (−0.74, 0.38, 0.24) m and dock at (0.64, 0.10, 0.36) m from the surface centre | `vr.panelAnchors` |

Interaction: ray (pinch) and direct poke on landmark pick spheres; hover raises emphasis and the
label; select calls `onLandmarkSelect`; `focusLandmark` on Quest emphasises the landmark and never
moves the viewer. Each nation orients the miniature so the viewer looks across the holding's
low-lying daily life toward its hall and backdrop (Korvenia looks north toward the scarp, Solforiz
up its terraces, Aethelgard up the knoll toward the fell, Kwind-09 from the harbour toward the deck).
Comfort: no artificial locomotion, no forced camera motion, no flashing, large targets, the backdrop
always beyond the far edge. Display scale was chosen by measurement against these limits and checked
in software previews (`maps/<nation>-views.png`, "VR — seated eye point at rest"); it has **not**
been tried in a headset and should be confirmed on hardware.

## 11. Life

A handful of meaningful behaviours on deterministic loops (`npcs[]`): sentries walking the wall
walks, a smith or fabricator at the forge, a courier or rider arriving at the Herald's Station,
the levy drilling, residents carrying water, laundry and goods, children, carters, farmers and
workers. Each agent has a route, timed walk and hold steps that loop back to the first waypoint,
a phase offset so shared patterns never march in lockstep, and distance-based update rates
(full within 60 m, reduced within 160 m, hidden beyond 420 m; far agents reduced to 600 m and hidden
beyond 1.6 km). `sampleAgent` is allocation-free for Quest. Smoke rises from tagged chimneys, banners
and foliage follow `atmosphere.wind`, water flows where `flow > 0`.

## 12. Gameplay-driven change

The blueprint provides **places, never results** (`slots`, `muster`, `ceremonial`, hall tiers).
Gameplay's `LegacySceneState` decides what fills them; the environment never invents a victory, a
captive or an honour. The available Pawn stands on the marked stand; a captive leaves it empty with
a captive marker in the captor's colours; an injured Pawn rests at `injuredRest`; recognition fills
honour places and raises hall tiers that complete the unfinished structure (tier 1) and add
development buildings and dressing (tiers 2–3); notices and rival correspondence appear at the
Herald's Station; the allied seat and the frontier toward the rival's nation carry heraldry. The
full mapping is in `TECHNICAL_SPEC.md` §8. Development previews use clearly labelled fixtures only.

## 13. Expansion boundaries

Each nation reserves expansion plots (`expansion[]`) that no current building occupies: plots that
unlock at hall tiers 2–3 and at least one reserved beyond v1 (for example quarters for a future
Knight appointment). Districts keep open ground around their edges so later kits can add buildings
without moving existing ones.

## 14. Verification and honesty

- `validateBlueprint` (shared, pure) checks scale, overlaps, terrain fit and foundations, district
  membership, walls and gates, the route network, landmarks and pick volumes, the muster line,
  slots and hall tiers, story and habitation, outer territory, view corridors, every camera and the
  VR staging. All four nations validate with zero errors.
- `shared/legacy/tests/environment-blueprint.test.ts` repeats the key rules independently and adds
  nation-distinctness, prose hygiene, determinism and platform-neutrality checks.
- The maps and massing previews are rendered from the same data; previews are blueprint volumes in a
  software rasteriser, not final art and not performance evidence.
- Nothing in this blueprint has been verified on Quest hardware or a real GPU. Comfort, scale and
  frame rate claims require a person on that hardware.
