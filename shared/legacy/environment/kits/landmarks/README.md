# Landmark kits (Korvenia)

Authored building kits for the four landmarks of the production nation and the buildings
that belong to them. Every kit is procedural TypeScript: no external models, textures or
downloads. The geometry comes from the shared kernel and every material is an existing
library key, so the landmarks bring no materials of their own. Draw calls grow only where a
hall-tier gate splits a material group (see State and hall tiers).

Registered in `kits/packages/landmarks.ts` under Korvenia's kit ids. Other nations keep the
generic architecture kit until their own landmark kits register, so Gothic details never
appear on another nation's buildings.

| Kit id | Builder | Builds | Part |
| --- | --- | --- | --- |
| `kv.manor.banner-hall` | `buildBannerHallKit` | Hall, keep with spire and crown, round stair turret, flèche, porch with the emblem frame, Honour Court, court standard socle, tier-1 braziers | `landmark:banner-hall` |
| `kv.manor.lodging` | `buildLodgingKit` | Lodging range with its oriel and stacks | `landmark:banner-hall` |
| `kv.manor.west-range` | `buildWestRangeKit` | West Range: unfinished shell and scaffold up to tier 0, completed range from tier 1 | `landmark:banner-hall` |
| `kv.fort.court-gate` | `buildCourtGateKit` | Court Gate with a real passage | `landmark:banner-hall` |
| `kv.muster.dais` | `buildMusterGroundsKit` | Muster dais with standard sockets and bench, file stones a–h with bronze letters, the representative's stand, drill square kerbs, training ground (quintain, stave rack, cresset poles), sentry boxes | `landmark:muster-grounds` |
| `kv.muster.armoury` | `buildArmouryKit` | Armoury, weapon store under a pentice, racks, lantern | `landmark:muster-grounds` |
| `kv.muster.levy-hall` | `buildLevyHallKit` | Levy hall (architecture kit) plus the infirmary awning and the spliced corner post | `landmark:muster-grounds` |
| `kv.record.archive` | `buildWarRecordKit` | Archive house, record tower, gallery bridge, interior with the war table at the record-marker slots (desktop only), pegged tier-2 plot | `landmark:war-record` |
| `kv.record.gallery` | `buildRecordGalleryKit` | Record Gallery (tier 2) with the honour wall of carved shields | `landmark:war-record` |
| `kv.herald.station` | `buildHeraldsStationKit` | Herald tower with raven loft, post room, notice board around the notice slots, rival correspondence hook, signal lantern | `landmark:heralds-station` |
| `kv.fort.gatehouse` | `buildMainGateKit` | West Gate passage and round towers, allied envoy pennant (flag `allied-house`), pegged barbican plot | `landmark:heralds-station` |

## Gothic detail library (`gothic/`)

- `face.ts`: `faceWall` cuts real openings in a wall face (columns merged where openings
  overlap, so a door under a wider window keeps both). It adds splayed reveals, stepped orders,
  tracery (mullion, two-light and three-light with sub-arches, oculus and quatrefoils at detail
  2), leaded glazing, hood moulds with label stops, drip sills, door leaves with iron straps,
  boarded and shuttered fills, and per-vertex weathering (`weatherField`: damp toward the
  plinth, streaks under sills, a darker north face). `quadSafe` drops degenerate quads, because a
  zero normal turns into NaN in the shaders and spreads through bloom.
- `mass.ts`: stepped plinths, buttresses with weathered set-offs and pinnacles, corbel tables,
  parapets with merlons, gable copings with finials, quoins and mass colliders.
- `roofs.ts`: sloped roofs with overhang, verge, soffit and ridge cap, lead rolls, cresting,
  lucarnes, octagonal broach spires, flèches and bartizans.
- `build.ts`: `buildGothicMass` assembles one blueprint mass from four `FaceSpec`s (openings,
  buttresses, gable, parapet, string courses cut around openings, quoins).

Faces use local frames: `u` runs to the right seen from outside, `z` points out of the wall and
`y` is height above the mass floor. World space is +Y up in metres, +X east, +Z south, and yaw
follows three.js `rotation.y`.

## Level of detail

`landmarkLod(ctx)` maps the quality profile to the kit detail:

| Profile | detail | ornament | weathering cell | arch segments | interiors |
| --- | --- | --- | --- | --- | --- |
| desktop-low | 0 | 0 | none | 3 | no |
| desktop-medium | 1 | 1 | 1.5 m | 5 | yes |
| desktop-high | 2 | 2 | 0.9 m | 7 | yes |
| quest | 1 | 0 | none | 3 | no |

Quest keeps every opening and the silhouettes. It drops detail smaller than a centimetre at
miniature scale (tracery, leading, hood moulds, crockets, lucarnes), the interiors and the
weathering cells. `buildFigure(palette, pose, lod = 0)` takes an optional `lod`, so existing
calls are unchanged. Quest passes 1, which gives fewer segments and no face planes; both levels
use the same materials (the figure material plus the heraldic tabard).

## State and hall tiers

- State slots stay where the blueprint puts them. The kits build the architecture that holds
  them: the dais and the representative's stand, the file stones, the injured rest under the
  awning, the notice board around the notice slots, the war table under the record markers,
  the honour niches in the Honour Court and the banner mounts. The slots themselves (figures,
  notices, honours, markers) come from the slot kits and real state. The kits never pre-fill
  them.
- Hall tiers are `StateGate`s read from `slots.hallTiers`:
  - below tier 1: the unfinished West Range with its scaffold;
  - tier 1: the completed West Range and lit court braziers (fire and light gated);
  - tier 2: the Record Gallery and its honour wall;
  - tier 3: the gilded inner moulding of the emblem frame;
  - expansion plots (the Record Gallery plot, the barbican plot) are pegged out with stakes
    and cords until the tier that unlocks them. No tier-3 expansion building is authored yet.
- Every material on a tier-gated building costs another draw (and another shadow draw). The
  gated buildings therefore reuse the materials they already draw with: stone ridges, iron
  finials, timber doors and lit gallery windows.
- The desktop light rig turns the first `quality.maxLights` lights (sorted by priority) into
  point lights and does not read gates. Gated landmark lights therefore have priority 1 and
  never take one of those lights before their tier. Until the rig reads gates, the tier-1
  braziers show their fire but cast no point light. A test guards this.

## Budgets (estimateBudget, Korvenia, founded fixture)

| Profile | Draws (with shadow casters + 6) | Triangles |
| --- | --- | --- |
| desktop-low | 85 / 120 | 281.8k / 300k |
| desktop-medium | 162 / 200 | 664.1k / 800k |
| desktop-high | 162 / 400 | 1.03M / 1.5M |
| quest | 89 / 120 | 234.6k / 250k |

With every tier's development visible (tier 3, recognised fixture) medium is at 192 / 200 draws.
`shared/legacy/tests/environment-landmarks.test.ts` checks these limits at every profile and
tier. These are build estimates. No frame time has been measured on real hardware, and no
headset frame rate is claimed.

## Captures

`main game/scripts/capture-legacy-environment-landmarks.mjs` renders the landmark framings and
the close-up development framings (`lm:*`, not shipped cameras) through the desktop harness
on port 5175. It writes `landmarks-<quality>-<view>.png` and `landmarks-metrics.json` to
`main game/artifacts/legacy-environment/`. `--tier N` previews a hall tier and labels the
caption as a development preview. `--post 0` renders without post-processing. The captures
use software rendering (SwiftShader), so their timings do not represent real hardware.
