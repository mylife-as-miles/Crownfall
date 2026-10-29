// AETHELGARD — the clan steading (working placeholder name). First-pass layout for the shared
// pipeline; every name and story line is a working placeholder pending creator approval.
//
// Terrain logic: a glacial upland valley. A moraine knoll stands on the north-west side of a
// river that comes down from the mountains to the north-east; a steep forested fell climbs
// behind it. The compound crowns the knoll at +10 m inside a ring palisade on an earth bank.
// The levy field is a terrace at +5.5 m on the knoll's south shoulder, reached from the gate by
// a raking ramp along the rampart; a graded way drops from it to the ford, and the valley road
// climbs the far bank toward the capital. A spring rises in the saddle between knoll and fell.
// Organisation: a clan compound, not a town. The ancestral longhall (the Banner Hall) faces a
// hearth yard ringed by carved honour posts; the War Record is a carved-board record house
// joined to the longhall's east end by a covered passage. Family yards of longhouses and
// pit-houses follow the inside of the palisade to the west, craft yards and an outsized byre
// to the east. A ring of standing stones raised by an older people stands on a ledge at the
// foot of the fell, bound to the wilderness above the steading.
// Coordinates are world plan metres (+X east, +Z south) with the origin at the hearth yard.

import { building, camera, cameraFrom, distantPlace, groundTools, local, mass, onStreet, poseRow } from "../authoring";
import type { FrontagePlacement, StreetLike } from "../authoring";
import { resolveBuildingBase } from "../buildings";
import { round2 } from "../math2d";
import { createTerrainSampler } from "../terrain";
import type { BannerholdBlueprint, Building, NpcAgent, Route, TerrainFeature, TerrainModel, Vec2, Vec3, WaterBody } from "../types";

const COMPOUND = 10;
const FIELD = 5.5;

/** The ring palisade: an ellipse of 54 × 44 m half-axes, listed east → south → west → north. */
const RING: Vec2[] = [
  [54, 0], [49.9, 16.8], [38.2, 31.1], [20.7, 40.7], [0, 44], [-20.7, 40.7], [-38.2, 31.1], [-49.9, 16.8],
  [-54, 0], [-49.9, -16.8], [-38.2, -31.1], [-20.7, -40.7], [0, -44], [20.7, -40.7], [38.2, -31.1], [49.9, -16.8],
];
const inset = (pts: readonly Vec2[], k: number): Vec2[] => pts.map((p) => [round2(p[0] * k), round2(p[1] * k)] as Vec2);

// --- Terrain ----------------------------------------------------------------

const riverLine: Vec2[] = [[240, -60], [150, 30], [80, 84], [20, 104], [-60, 112], [-140, 100], [-240, 70]];
const STONE_SHELF: Vec2[] = [[49, -79], [51, -84], [56, -86], [61, -84], [63, -79], [61, -74], [56, -72], [51, -74]];

/** Natural ground only: the knoll, the far rise, the fell, noise and the river channel. */
const naturalFeatures: TerrainFeature[] = [
  { kind: "slope", gradient: [0, -0.02] },
  { kind: "mound", id: "ag-knoll", center: [0, 4], radiusX: 125, radiusZ: 130, height: 12, surface: "meadow" },
  { kind: "mound", id: "ag-far-rise", center: [40, 190], radiusX: 220, radiusZ: 70, height: 12, surface: "heath" },
  // The fell: a steep forested mountain flank behind the compound.
  { kind: "ridge", id: "ag-fell", points: [[-260, -150], [-80, -140], [60, -150], [260, -172]], width: 170, height: 70, surface: "forest-floor" },
  { kind: "noise", seed: 7301, amplitude: 1.2, wavelength: 28, octaves: 3 },
  // Glacier-scoured crags on the upper fell only.
  { kind: "noise", seed: 7319, amplitude: 6, wavelength: 22, octaves: 2, style: "ridged", region: { kind: "polygon", points: [[-260, -200], [260, -200], [260, -92], [-260, -92]] }, regionFalloff: 14 },
  { kind: "channel", id: "ag-river", points: riverLine, width: 14, depth: 3.2, bankWidth: 12, surface: "gravel" },
];

const features: TerrainFeature[] = naturalFeatures.concat([
  // The spring's hollow in the saddle between the knoll and the fell.
  { kind: "mound", id: "ag-spring-hollow", center: [-28, -62.5], radiusX: 4, radiusZ: 3.5, height: -0.9, surface: "moss" },
  // The ditch outside the palisade bank.
  { kind: "channel", id: "ag-ditch", points: inset(RING, 1.12).concat([inset(RING, 1.12)[0]]), width: 4, depth: 2, bankWidth: 2.5, surface: "mud" },
  // The levelled compound, the levy terrace on the south shoulder and the raised gate apron.
  { kind: "platform", id: "ag-compound", shape: { kind: "polygon", points: inset(RING, 0.97) }, elevation: COMPOUND, falloff: 4, surface: "earth", edge: "embankment" },
  { kind: "platform", id: "ag-levy-field", shape: { kind: "rect", center: [0, 62], width: 64, depth: 30 }, elevation: FIELD, falloff: 6, surface: "meadow", edge: "embankment" },
  { kind: "platform", id: "ag-gate-apron", shape: { kind: "polygon", points: [[-4.5, 44], [4.5, 44], [4.5, 49.2], [-4.5, 49.2]] }, elevation: COMPOUND, falloff: 1.5, surface: "earth", edge: "retaining-wall" },
  // The ancient ledge of the stone ring, cut into the foot of the fell.
  { kind: "platform", id: "ag-stone-shelf", shape: { kind: "polygon", points: STONE_SHELF }, elevation: 10.5, falloff: 4, surface: "moss", edge: "cliff" },
  // Graded ways: the raking gate ramp along the rampart, the way down to the ford, the ford itself and the postern way.
  { kind: "ramp", id: "ag-gate-ramp", points: [[4.5, 47.4], [12, 49.4], [24, 51.2], [28, 53]], width: 4.2, startElevation: COMPOUND, endElevation: FIELD, falloff: 2, surface: "earth" },
  { kind: "ramp", id: "ag-ford-way", points: [[30, 76], [32, 86], [22, 99]], width: 5, startElevation: FIELD, endElevation: -2.4, falloff: 3, surface: "earth" },
  { kind: "ramp", id: "ag-ford-north", points: [[22, 99], [17, 105.5]], width: 4.6, startElevation: -2.4, endElevation: -5.7, falloff: 2, surface: "gravel" },
  { kind: "ramp", id: "ag-ford-south", points: [[17, 105.5], [17, 117]], width: 4.6, startElevation: -5.7, endElevation: -2.2, falloff: 2, surface: "gravel" },
  { kind: "ramp", id: "ag-postern-way", points: [[0, -45], [0, -52], [-14, -64]], width: 3, startElevation: COMPOUND, endElevation: 7.4, falloff: 3, surface: "earth" },
]);

const EXTENTS = { minX: -220, maxX: 220, minZ: -200, maxZ: 200 };
const riverbed = createTerrainSampler({ extents: EXTENTS, baseElevation: 0, baseSurface: "grass", features: naturalFeatures, water: [], surfaces: [], logic: "" });
const withoutWater = createTerrainSampler({ extents: EXTENTS, baseElevation: 0, baseSurface: "grass", features, water: [], surfaces: [], logic: "" });

const water: WaterBody[] = [
  {
    id: "ag-river-water",
    kind: "river",
    shape: { kind: "line", points: riverLine, width: 22.4 },
    level: round2(riverbed.height(20, 104) + 0.9),
    pointLevels: riverLine.map((p) => round2(riverbed.height(p[0], p[1]) + 0.9)),
    flow: 1.4,
    note: "Cold, fast and grey with rock flour, 0.9 m deep over the gravel; the surface meets the banks, and the ford bar lies a hand's depth under it below the levy terrace.",
  },
  {
    id: "ag-spring",
    kind: "spring",
    shape: { kind: "area", points: [[-30.6, -63.8], [-26, -64.6], [-25.2, -61.2], [-29.4, -60.6]] },
    level: round2(withoutWater.height(-28, -62.5) + 0.45),
    flow: 0,
    note: "A spring in the saddle under the fell that never freezes; the compound's water is carried from here through the postern.",
  },
];

const terrain: TerrainModel = {
  extents: EXTENTS,
  baseElevation: 0,
  baseSurface: "grass",
  features,
  water,
  surfaces: [
    { id: "ag-hearth-yard", surface: "earth", shape: { kind: "rect", center: [0, 4], width: 24, depth: 16 } },
    { id: "ag-byre-mud", surface: "mud", shape: { kind: "rect", center: [46, 4], width: 16, depth: 8 } },
    { id: "ag-gravel-bar", surface: "gravel", shape: { kind: "polygon", points: [[0, 98], [30, 96], [36, 108], [4, 114]] } },
    { id: "ag-fell-heath", surface: "heath", shape: { kind: "polygon", points: [[-220, -60], [220, -70], [220, -100], [-220, -96]] } },
  ],
  logic:
    "A moraine knoll (≈ +12 m) on the north-west side of a glacial river valley. Its top is levelled at +10 m for the compound and ringed by a palisade bank and ditch; the levy field is a terrace at +5.5 m on the south shoulder, 4.5 m below the gate apron, reached by a ramp raking along the rampart. A steep forested fell climbs from a saddle (+7 m, with the spring) 60 m to crags within 50 m; the stone ring stands on a ledge cut into its foot north-east of the compound at +10.5 m. The river runs from the north-east past the knoll's foot (≈ −4 m) to the south-west, shallow at the ford below the levy terrace, with the valley road on the far bank.",
};

const T = createTerrainSampler(terrain);
const G = groundTools(T);

// --- Materials --------------------------------------------------------------------

const STAVE = "ag-oak-stave";
const PLANK = "ag-oak-plank";
const FRAME = "ag-oak-frame";
const SOD = "ag-sod-turf";
const SHINGLE = "ag-oak-shingle";
const THATCH = "ag-reed-thatch";
const WATTLE = "ag-wattle-daub";
const FIELDSTONE = "ag-fieldstone";
const PALISADE = "ag-oak-palisade";

const HALL = "ag-longhall-timber";
const TURF = "ag-turf-house";
const STONE = "ag-fieldstone-work";

// --- Circulation ------------------------------------------------------------------

const route = (r: Omit<Route, "grade" | "covered" | "outer"> & Partial<Pick<Route, "grade" | "covered" | "outer">>): Route => ({ grade: "ground", covered: false, outer: false, ...r });

/** The lane through the family yards, from the gate square round the west side to the chief's house. */
const YARD_LANE: StreetLike = { points: [[0, 32], [-6.6, 30.3], [-18.9, 26.7], [-29, 19.8], [-35.5, 10.5], [-37.8, 0], [-35.5, -10.5], [-33, -16]], width: 3 };
/** The lane through the craft yards, from the gate square round the east side to the byre track. */
const CRAFT_LANE: StreetLike = { points: [[0, 32], [6.6, 30.3], [18.9, 26.7], [29, 19.8], [35.5, 10.5], [37.8, 0.5]], width: 3.2 };

const routes: Route[] = [
  route({
    id: "ag-national-road",
    name: "The valley road to the capital",
    kind: "road",
    hierarchy: "national",
    points: [
      [0, 36], [0, 44], [0, 47.4], [4.5, 47.4], [12, 49.4], [24, 51.2], [28, 53], [30, 60], [30, 76], [32, 86], [22, 99], [17, 105.5], [17, 117],
      [40, 126], [110, 104], [180, 60], [260, 0], [700, -380], [2000, -1200], [5000, -2900], [10000, -5800], [18000, -10400],
    ],
    width: 4,
    surface: "packed-earth",
    users: ["merchants", "messengers", "carts", "beasts", "soldiers", "nobility"],
    outer: true,
  }),
  route({ id: "ag-gate-square", name: "Gate Square", kind: "path", hierarchy: "primary", points: [[-6.5, 37], [6.5, 37]], width: 3.6, surface: "log-corduroy", users: ["residents", "messengers", "beasts"] }),
  route({ id: "ag-hall-way", name: "Hall Way", kind: "path", hierarchy: "primary", points: [[0, 36], [0, 24], [0, 12.5]], width: 3, surface: "log-corduroy", users: ["residents", "messengers", "nobility", "soldiers"] }),
  route({ id: "ag-hearth-ring", name: "Hearth Ring", kind: "path", hierarchy: "pedestrian", points: [[0, 12.5], [9, 9], [10, 0], [4.6, -3.4], [0, -4.4], [-4.6, -3.4], [-10, 0], [-9, 9], [0, 12.5]], width: 2.4, surface: "turf", users: ["nobility", "residents"] }),
  route({ id: "ag-record-path", name: "Record Path", kind: "path", hierarchy: "pedestrian", points: [[10, 0], [20, -3], [29, -8.3]], width: 2, surface: "packed-earth", users: ["residents", "nobility"] }),
  route({ id: "ag-yard-lane", name: "Yard Lane", kind: "lane", hierarchy: "pedestrian", points: YARD_LANE.points, width: YARD_LANE.width, surface: "packed-earth", users: ["residents", "beasts"] }),
  route({ id: "ag-craft-lane", name: "Craft Lane", kind: "lane", hierarchy: "secondary", points: CRAFT_LANE.points, width: CRAFT_LANE.width, surface: "packed-earth", users: ["workers", "carts", "beasts"] }),
  route({ id: "ag-kitchen-path", name: "Kitchen Path", kind: "path", hierarchy: "service", points: [[37.8, 0.5], [36, -12], [34.6, -27.6], [28.6, -28.2]], width: 2.2, surface: "packed-earth", users: ["workers", "residents"] }),
  route({ id: "ag-back-path", name: "Back Path", kind: "path", hierarchy: "service", points: [[0, -43], [10, -40], [24, -34.2], [31, -33], [34.4, -28.6]], width: 2, surface: "packed-earth", users: ["residents", "workers"] }),
  route({ id: "ag-byre-track", name: "Byre Track", kind: "track", hierarchy: "service", points: [[37.8, 0.5], [54, 1.5], [75, 6], [110, 18], [150, -8]], width: 3.6, surface: "packed-earth", users: ["beasts", "workers"] }),
  route({
    id: "ag-fell-path",
    name: "Fell Path",
    kind: "path",
    hierarchy: "service",
    points: [[-10, 0], [-23.8, -4], [-23.8, -24], [-19, -38], [-6, -42.5], [0, -43], [0, -44], [0, -52], [16, -60], [34, -68], [46, -74], [50.6, -77]],
    width: 2.4,
    surface: "packed-earth",
    users: ["residents", "beasts", "soldiers"],
  }),
  route({ id: "ag-spring-path", name: "Spring Path", kind: "path", hierarchy: "service", points: [[0, -52], [-14, -64], [-27.7, -67.1], [-28, -64.4]], width: 1.8, surface: "packed-earth", users: ["residents"] }),
  route({ id: "ag-levy-path", name: "Levy Path", kind: "path", hierarchy: "pedestrian", points: [[28, 53], [10, 55.2], [-10, 55.5], [-19.5, 56.5], [-20.6, 61.6]], width: 2.4, surface: "turf", users: ["soldiers"] }),
  route({ id: "ag-muster-walk", name: "Muster Walk", kind: "path", hierarchy: "pedestrian", points: [[10, 55.2], [0, 57.4], [0, 63.2]], width: 2, surface: "turf", users: ["soldiers", "nobility"] }),
  route({ id: "ag-field-track", name: "Field Track", kind: "track", hierarchy: "service", points: [[31, 82.4], [0, 89], [-40, 90], [-66, 90], [-90, 86], [-112, 80]], width: 2.6, surface: "packed-earth", users: ["workers", "carts", "beasts"] }),
  route({ id: "ag-mill-path", name: "Mill Path", kind: "path", hierarchy: "service", points: [[-40, 90], [-45, 92.5]], width: 2, surface: "packed-earth", users: ["workers", "carts"] }),
];

const destinations: BannerholdBlueprint["destinations"] = [
  { id: "gate", label: "South gate", position: [0, 44] },
  { id: "manor", label: "Longhall door", position: [0, -5.4] },
  { id: "muster", label: "Representative's stone on the levy terrace", position: [0, 64.2] },
  { id: "residential", label: "Yard Lane", position: [-29, 19.8] },
  { id: "artisan", label: "Craft Lane", position: [18.9, 26.7] },
  { id: "archive", label: "Record house door", position: [29, -8.3] },
  { id: "herald", label: "Herald's hut door", position: [-8.5, 35.5] },
  { id: "ceremonial", label: "Hearth of the honour posts", position: [0, 4] },
];

// --- Architecture ---------------------------------------------------------------

const civic: Building[] = [
  // A — The longhall yard: the ancestral longhall (Banner Hall), the chief's house, cook house and the unfinished guest hall.
  building({
    id: "ag-longhall",
    name: "The Longhall",
    district: "A",
    fn: "banner-hall",
    tradition: HALL,
    masses: [
      mass({ id: "hall", role: "hall", at: [0, -14], w: 40, d: 11.5, storeys: 1, eave: 4.2, ridge: 11.5, roof: "curved-ridge", axis: "x", roofMat: SOD, wallMat: STAVE }),
      mass({ id: "porch", role: "porch", at: [0, -6.85], w: 5, d: 3, storeys: 1, eave: 3.4, ridge: 5.8, roof: "gable", axis: "z", roofMat: SHINGLE, wallMat: STAVE }),
      mass({ id: "gable-west", role: "annex", at: [-21.2, -14], w: 2.4, d: 8, storeys: 1, eave: 3.4, ridge: 6.2, roof: "half-hip", axis: "z", roofMat: SOD, wallMat: STAVE }),
    ],
    door: [0, -5.35],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.6, maxRelief: 1.2 },
    era: "ancestral",
    built: 240,
    condition: "worn",
    repairs: [
      { kind: "new-timber", note: "Three wall staves on the yard side replaced in pale new oak among the black old ones.", mass: "hall" },
      { kind: "patched-roof", note: "A fresh green band of turf laid where the ridge sagged last winter.", mass: "hall" },
      { kind: "spliced-post", note: "The west gable's corner post spliced and pinned.", mass: "gable-west" },
    ],
    quality: "noble",
    social: "lord",
    lod: "hero",
    kit: "ag.hall.longhall",
    landmark: "banner-hall",
    tags: ["banner-mount", "emblem", "carved-gables", "smoke-louvre", "high-seat", "hearth", "shield-wall"],
    story: "Older than any house that has held it: the curved roof rides the knoll like an upturned keel, its gable boards carved so deep the faces have worn smooth. The banner's shield hangs over the door; the hall is too big for the household that now fills it.",
  }),
  building({
    id: "ag-chief-house",
    name: "The Chief's House",
    district: "A",
    fn: "lodging",
    tradition: HALL,
    masses: [mass({ id: "house", role: "house", at: [-34, -22], w: 16, d: 7.5, storeys: 1, eave: 3.4, ridge: 8, roof: "curved-ridge", axis: "x", roofMat: SHINGLE, wallMat: PLANK })],
    door: [-34, -18.25],
    facing: 180,
    era: "predecessor",
    built: 80,
    condition: "sound",
    repairs: [{ kind: "re-shingled", note: "The south slope re-shingled in split oak for the founding.", mass: "house" }],
    quality: "fine",
    social: "lord",
    lod: "hero",
    kit: "ag.hall.chief-house",
    tags: ["carved-door", "chimney-smoke", "bench"],
    story: "Where the household sleeps and the chief keeps the house chest; warmer than the hall and half its age.",
  }),
  building({
    id: "ag-kitchen",
    name: "Cook House",
    district: "A",
    fn: "kitchen",
    tradition: TURF,
    masses: [mass({ id: "house", role: "house", at: [23, -28], w: 9, d: 7, storeys: 1, eave: 2.6, ridge: 6.4, roof: "sod-gable", axis: "x", roofMat: SOD, wallMat: WATTLE })],
    door: [27.5, -28],
    facing: 90,
    era: "predecessor",
    built: 60,
    condition: "worn",
    quality: "common",
    social: "retainer",
    kit: "ag.hall.cook-house",
    tags: ["smoke", "woodpile", "cauldron"],
    story: "Smoke leaks through the turf all day; the hall's meals cross the yard in covered pots.",
  }),
  building({
    id: "ag-guest-hall",
    name: "Guest Hall (unfinished)",
    district: "A",
    fn: "lodging",
    tradition: HALL,
    masses: [
      mass({ id: "frame", role: "hall", at: [-6, -33], w: 18, d: 7, storeys: 1, eave: 3.8, ridge: 8, roof: "open-frame", axis: "x", roofMat: FRAME, wallMat: FRAME }),
      mass({ id: "scaffold", role: "scaffold", at: [-6, -37.3], w: 12, d: 1.4, storeys: 1, eave: 4.6, ridge: 4.6, roof: "open-frame", roofMat: FRAME, wallMat: FRAME }),
    ],
    door: [-6, -37.9],
    facing: 0,
    era: "under-construction",
    built: 0,
    condition: "under-construction",
    quality: "fine",
    social: "lord",
    lod: "hero",
    kit: "ag.hall.guest-hall",
    tags: ["scaffold", "timber-stack", "adze-chips", "crane"],
    story: "Posts and roof trees raised for envoys the house hopes to receive; the walls wait for recognition to pay for their staves.",
    unfinished: { stage: "roof-frame", completesAtHallTier: 1, scaffold: true },
  }),
  // F — War Record: the carved-board record house, joined to the longhall's east end by a covered passage.
  building({
    id: "ag-war-record",
    name: "The War Record",
    district: "F",
    fn: "archive",
    tradition: HALL,
    masses: [
      mass({ id: "record-house", role: "hall", at: [29, -14], w: 8, d: 9, storeys: 1, eave: 3.8, ridge: 9.4, roof: "steep-gable", axis: "z", roofMat: SHINGLE, wallMat: PLANK }),
      mass({ id: "passage", role: "gallery", at: [22.5, -14], w: 5, d: 2.6, storeys: 1, eave: 2.6, ridge: 3.8, roof: "gable", axis: "x", roofMat: SHINGLE, wallMat: PLANK }),
    ],
    door: [29, -9.5],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.5, maxRelief: 1.2 },
    era: "ancestral",
    built: 190,
    condition: "weathered",
    repairs: [
      { kind: "new-timber", note: "Fresh boards nailed inside for the banner's own tallies, beside the old carved ones.", mass: "record-house" },
      { kind: "re-shingled", note: "The passage roof re-shingled; the house roof still carries its silvered old shingles.", mass: "passage" },
    ],
    quality: "fine",
    social: "civic",
    lod: "hero",
    kit: "ag.record.tally-house",
    landmark: "war-record",
    tags: ["war-table", "carved-boards", "tally-sticks", "tally-stones", "covered-passage"],
    story: "Every wall is carved board: the previous holders' tallies run floor to roof. The banner's War Record has begun on one new plank by the door, and the table holds its markers.",
    overlap: ["ag-longhall"],
  }),
  building({
    id: "ag-tally-loft",
    name: "Tally Loft (development)",
    district: "F",
    fn: "archive",
    tradition: HALL,
    masses: [mass({ id: "loft", role: "wing", at: [29, -21.5], w: 7, d: 5, storeys: 1, eave: 3.4, ridge: 6.8, roof: "steep-gable", axis: "x", roofMat: SHINGLE, wallMat: PLANK })],
    door: [32.5, -21.5],
    facing: 90,
    era: "recent",
    built: 0,
    condition: "new",
    quality: "fine",
    social: "civic",
    kit: "ag.record.tally-loft",
    tags: ["banner-mount", "honour-boards"],
    story: "Appears only when recognition reaches hall tier 2: a loft for honour boards behind the record house.",
    tier: 2,
  }),
];

const gateAndField: Building[] = [
  // E — The south gate and the Herald's Station (hut and horn tower inside the gate, west side).
  building({
    id: "ag-gate-tower",
    name: "South Gate",
    district: "E",
    fn: "gatehouse",
    tradition: HALL,
    masses: [mass({ id: "gate", role: "gatehouse", at: [0, 44], w: 7, d: 5, storeys: 2, eave: 6.5, ridge: 9.5, roof: "sod-gable", axis: "x", roofMat: SOD, wallMat: STAVE })],
    door: [0, 46.5],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.3, maxRelief: 2 },
    era: "predecessor",
    built: 90,
    condition: "worn",
    repairs: [{ kind: "replaced-gate", note: "New oak gate leaves hung on the old iron pins at the founding.", mass: "gate" }],
    quality: "fine",
    social: "martial",
    lod: "hero",
    kit: "ag.fort.gate-tower",
    tags: ["banner-mount", "fighting-platform", "carved-posts"],
    story: "A timber tower over the gate passage on its raised apron: the banner's shield hangs where the previous holders' sign was planed off the boards.",
    overlap: ["ag-palisade", "ag-national-road"],
  }),
  building({
    id: "ag-herald-station",
    name: "Herald's Station",
    district: "E",
    fn: "herald-station",
    tradition: HALL,
    masses: [
      mass({ id: "hut", role: "house", at: [-12, 35.5], w: 7, d: 5, storeys: 1, eave: 3, ridge: 6.2, roof: "sod-gable", axis: "x", roofMat: SOD, wallMat: PLANK }),
      mass({ id: "horn-tower", role: "tower", at: [-17.5, 35], w: 4, d: 4, storeys: 3, eave: 12, ridge: 14.5, roof: "pyramid", roofMat: SHINGLE, wallMat: FRAME }),
    ],
    door: [-8.5, 35.5],
    facing: 90,
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "new-timber", note: "The horn platform rebuilt in fresh timber; the old tower legs are black with age.", mass: "horn-tower" }],
    quality: "common",
    social: "civic",
    lod: "hero",
    kit: "ag.herald.horn-tower",
    landmark: "heralds-station",
    tags: ["notice-posts", "signal-horn", "banner-mount", "beast-tether"],
    story: "The horn on the tower answers the horn post at the ford: a summons is sounded across the valley before the rider reaches the gate, and its carved message stick is pinned to the posts by the door.",
  }),
  // B — The levy terrace: the muster mound, the levy house and the weapon house below the palisade.
  building({
    id: "ag-muster-mound",
    name: "Muster Mound",
    district: "B",
    fn: "muster-platform",
    tradition: STONE,
    masses: [mass({ id: "mound", role: "platform", at: [0, 72], w: 16, d: 4, storeys: 1, eave: 1.4, ridge: 1.4, roof: "none", roofMat: FIELDSTONE, wallMat: FIELDSTONE })],
    door: [0, 70],
    facing: 0,
    foundation: { kind: "flush", plinth: 0, maxRelief: 0.8 },
    era: "ancestral",
    built: 300,
    condition: "worn",
    repairs: [{ kind: "salvaged-stone", note: "Kerb stones reset where frost heaved them out.", mass: "mound" }],
    quality: "common",
    social: "martial",
    lod: "hero",
    kit: "ag.muster.mound",
    landmark: "muster-grounds",
    tags: ["banner-mount", "file-stones", "kerb-stones"],
    story: "A kerbed earthen mound older than the palisade, on the valley edge of the levy terrace: the levy is named before it with the valley at its back.",
  }),
  building({
    id: "ag-levy-house",
    name: "Levy House",
    district: "B",
    fn: "barracks",
    tradition: TURF,
    masses: [mass({ id: "house", role: "house", at: [-25, 62], w: 6, d: 16, storeys: 1, eave: 2.4, ridge: 5.6, roof: "sod-gable", axis: "z", roofMat: SOD, wallMat: WATTLE })],
    door: [-22, 62],
    facing: 90,
    era: "founding",
    built: 2,
    condition: "worn",
    repairs: [{ kind: "patched-roof", note: "Fresh turfs stacked over a leak at the north end.", mass: "house" }],
    quality: "poor",
    social: "martial",
    kit: "ag.muster.levy-house",
    tags: ["sleeping-benches", "cooking-fire", "shields"],
    story: "One long turf room outside the palisade: the levy sleeps here when it is called, closer to the field than to the hall.",
  }),
  building({
    id: "ag-weapon-house",
    name: "Weapon House",
    district: "B",
    fn: "armoury",
    tradition: HALL,
    masses: [mass({ id: "house", role: "house", at: [-25, 50.4], w: 7, d: 4.8, storeys: 1, eave: 2.6, ridge: 5.6, roof: "sod-gable", axis: "x", roofMat: SOD, wallMat: PLANK })],
    door: [-21.5, 50.4],
    facing: 90,
    era: "predecessor",
    built: 70,
    condition: "sound",
    quality: "common",
    social: "martial",
    kit: "ag.muster.weapon-house",
    tags: ["weapon-rack", "shields", "spear-stand"],
    story: "Spears, shields and the old axes the levy carries for the Muster; half the pegs are bare.",
  }),
];

// C — Family yards and D — craft yards: lots placed square to the curving lanes inside the palisade.

interface Lot {
  id: string;
  name: string;
  district: "C" | "D";
  lane: StreetLike;
  s: number;
  side: "left" | "right";
  w: number;
  d: number;
  setback?: number;
  fn: Building["function"];
  tradition: string;
  role?: Building["masses"][number]["role"];
  storeys: number;
  eave: number;
  ridge: number;
  roof: Building["masses"][number]["roof"]["form"];
  roofMat: string;
  wallMat: string;
  /** Extra masses in the lot's local frame (x along the lane, z toward the lane). */
  extra?: (fp: FrontagePlacement) => Building["masses"][number][];
  foundation?: Building["foundation"];
  era: Building["age"]["era"];
  built: number;
  condition: Building["age"]["condition"];
  repairs?: Building["age"]["repairs"];
  quality: Building["quality"];
  social: Building["social"];
  lod?: Building["lod"];
  kit: string;
  tags: readonly string[];
  story: string;
}

/** The frontage of a lot (the same placement lot() uses), for dressing and life authored around it. */
const lotFrame = (lane: StreetLike, s: number, side: "left" | "right", d: number, setback = 0.6): FrontagePlacement => onStreet(lane, s, side, d, setback);

function lot(h: Lot): Building {
  const fp = lotFrame(h.lane, h.s, h.side, h.d, h.setback ?? 0.6);
  const masses = [mass({ id: "house", role: h.role ?? "house", at: fp.center, w: h.w, d: h.d, rot: fp.rot, storeys: h.storeys, eave: h.eave, ridge: h.ridge, roof: h.roof, axis: "x", roofMat: h.roofMat, wallMat: h.wallMat })];
  if (h.extra) masses.push(...h.extra(fp));
  return building({
    id: h.id,
    name: h.name,
    district: h.district,
    fn: h.fn,
    tradition: h.tradition,
    masses,
    door: fp.door,
    facing: fp.facingBearingDeg,
    foundation: h.foundation,
    era: h.era,
    built: h.built,
    condition: h.condition,
    repairs: h.repairs,
    quality: h.quality,
    social: h.social,
    lod: h.lod,
    kit: h.kit,
    tags: h.tags,
    story: h.story,
  });
}

/** A mass offset in a lot's local frame (x along the lane, z toward the lane). */
const lotMass = (fp: FrontagePlacement, m: Omit<Parameters<typeof mass>[0], "at" | "rot"> & { lx: number; lz: number }) => {
  const { lx, lz, ...rest } = m;
  return mass({ ...rest, at: local(fp.center, fp.rot, lx, lz), rot: fp.rot });
};

const SMITHY_FP = lotFrame(CRAFT_LANE, 18, "right", 6);
const WEAVER_FP = lotFrame(YARD_LANE, 33.5, "right", 6.5, 2.2);
const ELDER_FP = lotFrame(YARD_LANE, 31, "left", 7);
const GRANARY_FP = lotFrame(CRAFT_LANE, 23, "left", 5);
const WORKSHOP_FP = lotFrame(CRAFT_LANE, 38, "left", 6);
const TANNERY_FP = lotFrame(CRAFT_LANE, 34, "right", 5);
const SMOKEHOUSE_FP = lotFrame(CRAFT_LANE, 12, "left", 4);
/** Smithy local point (x along the lane, z toward the lane). */
const SM = (lx: number, lz: number): Vec2 => local(SMITHY_FP.center, SMITHY_FP.rot, lx, lz);

const yards: Building[] = [
  lot({
    id: "ag-elder-house", name: "Elder's Longhouse", district: "C", lane: YARD_LANE, s: 31, side: "left", w: 18, d: 7, fn: "longhouse", tradition: HALL,
    storeys: 1, eave: 2.8, ridge: 7.4, roof: "curved-ridge", roofMat: SHINGLE, wallMat: STAVE, era: "ancestral", built: 210, condition: "weathered",
    repairs: [{ kind: "new-timber", note: "The door frame recarved in new oak with the banner's colours worked into the knots.", mass: "house" }, { kind: "re-shingled", note: "Patches of bright new shingle on a silver roof.", mass: "house" }],
    quality: "fine", social: "retainer", lod: "hero", kit: "ag.house.elder-longhouse", tags: ["carved-door", "loom", "smoke-louvre", "bench"],
    story: "The oldest family in the steading keeps the oldest house: stave walls and a curved roof like a small longhall.",
  }),
  lot({
    id: "ag-byre-house", name: "Byre-End Longhouse", district: "C", lane: YARD_LANE, s: 49, side: "left", w: 12, d: 6.5, fn: "longhouse", tradition: TURF,
    storeys: 1, eave: 2.2, ridge: 6, roof: "sod-gable", roofMat: SOD, wallMat: WATTLE,
    extra: (fp) => [lotMass(fp, { id: "byre", role: "annex", lx: 10, lz: 0, w: 8, d: 6, storeys: 1, eave: 2, ridge: 5.2, roof: "sod-gable", axis: "x", roofMat: SOD, wallMat: WATTLE })],
    era: "predecessor", built: 90, condition: "worn", repairs: [{ kind: "patched-roof", note: "The byre end re-turfed; the house end still sags.", mass: "byre" }],
    quality: "common", social: "commoner", kit: "ag.house.byre-longhouse", tags: ["cattle", "hay", "dung-heap", "smoke"],
    story: "People at one end, cattle at the other: the beasts' warmth keeps the family through the winter.",
  }),
  lot({
    id: "ag-pit-house-fallen", name: "Fallen Pit-House", district: "C", lane: YARD_LANE, s: 67.5, side: "left", w: 4.6, d: 4.2, fn: "pit-house", tradition: TURF,
    storeys: 1, eave: 0.7, ridge: 3.2, roof: "sod-gable", roofMat: SOD, wallMat: WATTLE, foundation: { kind: "terrace-cut", plinth: 0, maxRelief: 2 },
    era: "predecessor", built: 60, condition: "damaged", repairs: [{ kind: "tarpaulin", note: "Hides weighted with stones over a fallen roof corner.", mass: "house" }],
    quality: "poor", social: "labourer", kit: "ag.house.pit-house", tags: ["cooking-fire", "hides"],
    story: "Half sunk in the ground against the palisade bank; one corner of the roof has fallen in and nobody has had the timber to fix it.",
  }),
  lot({
    id: "ag-founding-cottage", name: "Founding Cottage", district: "C", lane: YARD_LANE, s: 9, side: "right", w: 9, d: 6, fn: "cottage", tradition: TURF,
    storeys: 1, eave: 2.4, ridge: 5.4, roof: "sod-gable", roofMat: SOD, wallMat: PLANK, era: "founding", built: 2, condition: "new",
    quality: "common", social: "commoner", kit: "ag.house.cottage", tags: ["woodpile", "laundry", "new-turf"],
    story: "Raised at the founding by a family that followed the banner up the valley; the turf on its roof has not yet greened.",
  }),
  lot({
    id: "ag-pit-house", name: "Pit-House by the Lane", district: "C", lane: YARD_LANE, s: 20, side: "right", w: 5, d: 4, setback: 1.8, fn: "pit-house", tradition: TURF,
    storeys: 1, eave: 0.8, ridge: 3.6, roof: "sod-gable", roofMat: SOD, wallMat: WATTLE, foundation: { kind: "terrace-cut", plinth: 0, maxRelief: 2 },
    era: "recent", built: 12, condition: "worn", quality: "poor", social: "labourer", kit: "ag.house.pit-house", tags: ["cooking-fire", "smoke", "goats"],
    story: "A herder's sunken house, warm and dark; goats sleep against its wall.",
  }),
  lot({
    id: "ag-weaver-house", name: "Weaver's Longhouse", district: "C", lane: YARD_LANE, s: 33.5, side: "right", w: 11.5, d: 6.5, setback: 2.2, fn: "longhouse", tradition: HALL,
    storeys: 1, eave: 2.6, ridge: 6.4, roof: "curved-ridge", roofMat: THATCH, wallMat: PLANK, era: "predecessor", built: 70, condition: "sound",
    quality: "common", social: "artisan", kit: "ag.house.longhouse", tags: ["loom", "dye-vats", "laundry"],
    story: "Warp-weighted looms stand inside the door; dyed wool dries on the fence behind.",
  }),
  lot({
    id: "ag-empty-house", name: "Empty Longhouse", district: "C", lane: YARD_LANE, s: 50.5, side: "right", w: 12.5, d: 6.5, setback: 1.8, fn: "longhouse", tradition: HALL,
    storeys: 1, eave: 2.4, ridge: 5.6, roof: "curved-ridge", roofMat: SOD, wallMat: STAVE, era: "ancestral", built: 260, condition: "ruinous",
    repairs: [{ kind: "boarded-opening", note: "Door barred with a single plank and a carved mark of the previous holders.", mass: "house" }],
    quality: "common", social: "commoner", lod: "mid", kit: "ag.house.longhouse-ruin", tags: ["fallen-roof", "nettles", "sealed-door"],
    story: "Its family left with the previous holders; the roof has fallen in at one end and nobody has claimed the staves.",
  }),
  lot({
    id: "ag-smallholder-house", name: "Smallholder's House", district: "C", lane: YARD_LANE, s: 66, side: "right", w: 7, d: 5, setback: 1.6, fn: "house", tradition: TURF,
    storeys: 1, eave: 2.2, ridge: 5, roof: "sod-gable", roofMat: THATCH, wallMat: WATTLE, era: "recent", built: 20, condition: "worn",
    quality: "poor", social: "labourer", kit: "ag.house.smallholding", tags: ["hens", "kale-patch", "woodpile"],
    story: "A single room and a kale patch beside the chief's house; the family works the hall's fields.",
  }),
];

const crafts: Building[] = [
  lot({
    id: "ag-smithy", name: "Smithy", district: "D", lane: CRAFT_LANE, s: 18, side: "right", w: 9, d: 6, fn: "forge", tradition: TURF,
    storeys: 1, eave: 2.6, ridge: 6, roof: "sod-gable", roofMat: SOD, wallMat: FIELDSTONE,
    extra: (fp) => [
      lotMass(fp, { id: "forge-chimney", role: "chimney", lx: -3.4, lz: -1.6, w: 1.6, d: 1.6, storeys: 1, eave: 7.2, ridge: 7.6, roof: "flat", axis: "x", roofMat: FIELDSTONE, wallMat: FIELDSTONE }),
      // Open forge shed on the west gable; rotated half a turn so its lean-to rises against the smithy wall.
      mass({ id: "forge-shed", role: "canopy", at: local(fp.center, fp.rot, -6.3, 0.4), w: 3.6, d: 5.2, rot: round2(fp.rot + 180), storeys: 1, eave: 2.4, ridge: 3.4, roof: "lean-to", axis: "z", roofMat: SHINGLE, wallMat: FRAME }),
    ],
    era: "founding", built: 2, condition: "sound", quality: "common", social: "artisan", lod: "hero", kit: "ag.craft.smithy",
    tags: ["anvil", "quench-trough", "forge-glow", "smoke", "bog-iron", "forge-shed"],
    story: "Bog iron from the valley mires is worked under the open shed on its gable; the smith mends the levy's spearheads and the byre's chains.",
  }),
  lot({
    id: "ag-tannery", name: "Tannery", district: "D", lane: CRAFT_LANE, s: 34, side: "right", w: 10, d: 5, fn: "tannery", tradition: TURF,
    role: "shed", storeys: 1, eave: 2.4, ridge: 4.4, roof: "lean-to", roofMat: SOD, wallMat: WATTLE,
    era: "predecessor", built: 50, condition: "worn", repairs: [{ kind: "spliced-post", note: "Drying-frame posts spliced with rawhide.", mass: "house" }],
    quality: "poor", social: "labourer", kit: "ag.craft.tannery", tags: ["hide-frames", "vats", "stench"],
    story: "Hides from the byre stretched on frames against the palisade; the smell keeps the lane quiet.",
  }),
  lot({
    id: "ag-smokehouse", name: "Smokehouse", district: "D", lane: CRAFT_LANE, s: 12, side: "left", w: 5, d: 4, fn: "smokehouse", tradition: TURF,
    storeys: 1, eave: 2, ridge: 4.8, roof: "sod-gable", roofMat: SOD, wallMat: FIELDSTONE, era: "predecessor", built: 110, condition: "weathered",
    quality: "common", social: "artisan", kit: "ag.craft.smokehouse", tags: ["smoke", "fish-racks", "woodpile"],
    story: "Fish from the river and mutton for the winter hang in the smoke; the stones are black inside to the roof.",
  }),
  lot({
    id: "ag-granary", name: "Staddle Granary", district: "D", lane: CRAFT_LANE, s: 23, side: "left", w: 6, d: 5, fn: "granary", tradition: HALL,
    storeys: 1, eave: 3.6, ridge: 6.8, roof: "sod-gable", roofMat: THATCH, wallMat: PLANK, foundation: { kind: "stilts", plinth: 0.9, maxRelief: 1.5 },
    era: "predecessor", built: 40, condition: "sound", quality: "common", social: "labourer", kit: "ag.craft.staddle-granary", tags: ["staddle-stones", "sacks", "ladder"],
    story: "Raised on mushroom stones out of the rats' reach; the hall's share of oats and barley is counted in and out.",
  }),
  lot({
    id: "ag-workshop", name: "Woodwright's Shop", district: "D", lane: CRAFT_LANE, s: 38, side: "left", w: 8, d: 6, fn: "workshop", tradition: HALL,
    storeys: 1, eave: 2.6, ridge: 6, roof: "sod-gable", roofMat: SHINGLE, wallMat: PLANK, era: "founding", built: 2, condition: "sound",
    quality: "common", social: "artisan", kit: "ag.craft.woodwright", tags: ["timber-stack", "adze-chips", "sledges"],
    story: "Staves and roof trees for the guest hall are shaped here; shavings drift across the lane.",
  }),
  building({
    id: "ag-great-byre",
    name: "The Great Byre",
    district: "D",
    fn: "beast-pen",
    tradition: HALL,
    masses: [
      mass({ id: "byre", role: "hall", at: [44, -9.5], w: 10, d: 13, storeys: 1, eave: 5, ridge: 12.5, roof: "curved-ridge", axis: "z", roofMat: SOD, wallMat: STAVE }),
      mass({ id: "great-door", role: "porch", at: [44, -2.4], w: 6.4, d: 1.2, storeys: 1, eave: 7.6, ridge: 8.6, roof: "gable", axis: "x", roofMat: SHINGLE, wallMat: STAVE }),
    ],
    door: [44, -1.8],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.4, maxRelief: 1.6 },
    era: "ancestral",
    built: 230,
    condition: "weathered",
    repairs: [{ kind: "iron-strapping", note: "The great door's hinges bound with new iron straps.", mass: "great-door" }],
    quality: "fine",
    social: "labourer",
    lod: "hero",
    kit: "ag.craft.great-byre",
    tags: ["outsized-door", "great-bones", "hay", "chains"],
    story: "Built to a scale no herd of cattle needs: its door is twice the height of the longhall's. The house keeps its cattle at one end and leaves the rest swept and empty.",
  }),
];

const outerBuildings: Building[] = [
  building({
    id: "ag-mill",
    name: "River Mill",
    district: "G",
    fn: "mill",
    tradition: HALL,
    masses: [
      mass({ id: "mill", role: "house", at: [-46, 95.5], w: 7, d: 6, storeys: 1, eave: 3, ridge: 6.6, roof: "sod-gable", axis: "x", roofMat: SOD, wallMat: PLANK }),
      mass({ id: "wheel-house", role: "lean-to", at: [-46, 100.4], w: 4, d: 3.8, storeys: 1, eave: 2, ridge: 3, roof: "lean-to", axis: "x", roofMat: SHINGLE, wallMat: PLANK }),
    ],
    door: [-45, 92.5],
    facing: 0,
    foundation: { kind: "undercroft", plinth: 0.3, maxRelief: 4.6 },
    era: "predecessor",
    built: 75,
    condition: "worn",
    repairs: [{ kind: "new-timber", note: "Three new paddles on an old grey wheel.", mass: "wheel-house" }],
    quality: "common",
    social: "artisan",
    lod: "background",
    kit: "ag.outer.mill",
    tags: ["water-wheel", "millstones", "sacks"],
    story: "The river turns the stones for the steading and for the farms downstream, who pay in grain and grudges.",
    overlap: ["ag-river-water"],
  }),
];

const buildings: Building[] = civic.concat(gateAndField, yards, crafts, outerBuildings);
const byId = (id: string): Building => {
  for (const b of buildings) if (b.id === id) return b;
  throw new Error(`aethelgard: unknown building ${id}`);
};
const floorOf = (id: string): number => resolveBuildingBase(T, byId(id)).floorY;

// --- Fortifications -----------------------------------------------------------------

const walls: BannerholdBlueprint["walls"] = [
  {
    id: "ag-palisade", name: "The Palisade", kind: "palisade", points: RING, closed: true, height: 4.6, thickness: 0.7, walkway: true, material: PALISADE, tradition: HALL,
    segments: [
      { from: 0, to: 3, condition: "sound", note: "East and south-east, above the craft yards and the byre gate." },
      { from: 3, to: 5, condition: "sound", note: "Either side of the south gate, its posts tarred at the founding." },
      { from: 5, to: 7, condition: "worn", note: "South-west, behind the herald's horn tower." },
      { from: 7, to: 10, condition: "weathered", note: "West: grey posts leaning outward, rotten at ground level and propped with stakes." },
      { from: 10, to: 13, condition: "worn", note: "North, under the fell; moss to head height." },
      { from: 13, to: 16, condition: "sound", note: "North-east, rebuilt with the watchtower in pale new oak." },
    ],
    allowOverlapWith: ["ag-gate-tower"],
  },
  {
    id: "ag-old-ring", name: "The Old Ring", kind: "rampart", points: [[-72, -36], [-78, -10], [-76, 16], [-68, 40]], closed: false, height: 1.2, thickness: 4, walkway: false, material: SOD, tradition: STONE,
    segments: [
      { from: 0, to: 1, condition: "ruinous", note: "A grassed bank and a few charred post stumps: the earlier holders' outer ring." },
      { from: 1, to: 3, condition: "ruinous", note: "Ploughed half away; the field strips run over it." },
    ],
  },
  {
    id: "ag-field-fence", name: "Levy Field Fence", kind: "fence", points: [[-31, 77], [27, 77]], closed: false, height: 1.2, thickness: 0.3, walkway: false, material: FRAME, tradition: HALL,
    segments: [{ from: 0, to: 1, condition: "worn", note: "Split-rail fence along the terrace's valley edge." }],
  },
];

const towers: BannerholdBlueprint["towers"] = [
  {
    id: "ag-watchtower-repaired", name: "North-East Watchtower", kind: "watchtower", center: [38.2, -31.1], shape: "square", width: 5, height: 13, roof: "pyramid", material: FRAME, wallId: "ag-palisade", condition: "sound",
    repairs: [
      { kind: "new-timber", note: "The upper half rebuilt in pale new oak on the charred stumps of the old legs; the seam is plain from the yard." },
      { kind: "iron-strapping", note: "Iron bands where new posts are scarfed to old." },
    ],
    storyRole: "repaired-watchtower",
    story: "The one tower the banner rebuilt after the earlier conflict burned it: from its platform the watch sees up the valley and along the fell to the stones.",
    allowOverlapWith: ["ag-palisade"],
  },
  { id: "ag-tower-west", name: "West Tower", kind: "wall-tower", center: [-54, 0], shape: "square", width: 4.4, height: 8.5, roof: "pyramid", material: FRAME, wallId: "ag-palisade", condition: "weathered", repairs: [{ kind: "spliced-post", note: "One leg spliced; the platform boards are soft." }], story: "Leans with the west palisade; the watch avoids standing at its outer edge.", allowOverlapWith: ["ag-palisade"] },
  { id: "ag-tower-gate-east", name: "Byre Gate Tower", kind: "gate-tower", center: [52.8, 9], shape: "square", width: 3.6, height: 7.5, roof: "pyramid", material: FRAME, wallId: "ag-palisade", condition: "sound", repairs: [], story: "Watches the byre gate and the pasture track.", allowOverlapWith: ["ag-palisade"] },
];

const gates: BannerholdBlueprint["gates"] = [
  { id: "ag-gate-main", name: "South Gate", kind: "main-gate", position: [0, 44], outwardBearingDeg: 180, width: 4, height: 4.5, wallId: "ag-palisade", routeId: "ag-national-road" },
  { id: "ag-gate-fell", name: "Fell Postern", kind: "postern", position: [0, -44], outwardBearingDeg: 0, width: 2.2, height: 2.6, wallId: "ag-palisade", routeId: "ag-fell-path" },
  { id: "ag-gate-byre", name: "Byre Gate", kind: "postern", position: [53.6, 1.5], outwardBearingDeg: 90, width: 4.2, height: 4.2, wallId: "ag-palisade", routeId: "ag-byre-track" },
];

// --- Landmarks, muster, ceremony and state slots ---------------------------------

const HALL_FLOOR = floorOf("ag-longhall");
const RECORD_FLOOR = floorOf("ag-war-record");
const HERALD_FLOOR = floorOf("ag-herald-station");
const MOUND_TOP = round2(floorOf("ag-muster-mound") + 1.4);
const GATE_FLOOR = floorOf("ag-gate-tower");

const landmarks: BannerholdBlueprint["landmarks"] = [
  { id: "banner-hall", label: "Banner Hall", buildingIds: ["ag-longhall", "ag-chief-house", "ag-guest-hall"], anchor: [0, round2(HALL_FLOOR + 14), -14], pickCenter: [0, round2(HALL_FLOOR + 5), -14], pickRadius: 14, cameraId: "landmark:banner-hall" },
  { id: "muster-grounds", label: "Muster Grounds", buildingIds: ["ag-muster-mound", "ag-levy-house", "ag-weapon-house"], anchor: [0, round2(MOUND_TOP + 4), 72], pickCenter: [0, round2(FIELD + 1.5), 64.5], pickRadius: 11, cameraId: "landmark:muster-grounds" },
  { id: "war-record", label: "War Record", buildingIds: ["ag-war-record"], anchor: [29, round2(RECORD_FLOOR + 12), -14], pickCenter: [29, round2(RECORD_FLOOR + 4), -14], pickRadius: 7, cameraId: "landmark:war-record" },
  { id: "heralds-station", label: "Herald's Station", buildingIds: ["ag-herald-station", "ag-gate-tower"], anchor: [-17.5, round2(HERALD_FLOOR + 17), 35], pickCenter: [-13, round2(HERALD_FLOOR + 4), 35.5], pickRadius: 7, cameraId: "landmark:heralds-station" },
];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const fileRow = poseRow(T, [-10.5, 67.6], [10.5, 67.6], 8, 0);

const muster: BannerholdBlueprint["muster"] = {
  pawnStand: G.facing(0, 64.2, 0),
  fileMarkers: FILES.map((file, i) => ({ file, pose: fileRow[i] })),
  levySlots: [G.facing(-4, 61.4, 0), G.facing(-2, 61.4, 0), G.facing(2, 61.4, 0), G.facing(4, 61.4, 0), G.facing(-3, 59.8, 0), G.facing(3, 59.8, 0)],
  drillSquare: { kind: "rect", center: [-16.5, 63], width: 8, depth: 8 },
  platformBuildingId: "ag-muster-mound",
};

const ceremonial: BannerholdBlueprint["ceremonial"] = {
  id: "ag-honour-posts",
  name: "The Hearth of the Honour Posts",
  shape: { kind: "rect", center: [0, 4], width: 22, depth: 14 },
  centrepiece: [0, 4],
  description:
    "The open hearth before the longhall door, ringed by eight carved posts with bare iron hooks: honours hang here when recognition is earned, never before. The fire is kept in winter and summer.",
};

/** Eight honour posts on a ring round the hearth, each facing the fire. */
const honourPost = (i: number) => {
  const a = ((22.5 + i * 45) * Math.PI) / 180;
  const x = round2(Math.cos(a) * 7.5);
  const z = round2(4 + Math.sin(a) * 6);
  const toFire = (Math.atan2(-x, -(z - 4)) * 180) / Math.PI;
  return { position: [x, round2(T.height(x, z) + 1.7), z] as Vec3, yawDeg: round2(toFire) };
};

const tableTop = round2(RECORD_FLOOR + 0.9);
const recordMarkers = Array.from({ length: 12 }, (_, i) => ({ position: [round2(27.8 + (i % 4) * 0.6), tableTop, round2(-15.4 + Math.floor(i / 4) * 0.62)] as Vec3, yawDeg: 0 }));

const slots: BannerholdBlueprint["slots"] = {
  injuredRest: G.facing(-20.8, 65.6, 90, 0.3),
  captiveMarker: G.facing(1.2, 63.8, 0),
  honourNiches: Array.from({ length: 8 }, (_, i) => honourPost(i)),
  recordMarkers,
  noticeBoard: Array.from({ length: 6 }, (_, i) => ({ position: [-8.3, round2(HERALD_FLOOR + 1.3 + Math.floor(i / 3) * 0.55), round2(33.4 + (i % 3) * 0.55)] as Vec3, yawDeg: 90 })),
  heraldArrival: G.facing(-5.6, 37.6, 270),
  rivalCorrespondence: { position: [-8.3, round2(HERALD_FLOOR + 1.5), 37.2], yawDeg: 90 },
  alliedEnvoy: { position: [-17.5, round2(HERALD_FLOOR + 14.6), 35], yawDeg: 180 },
  bannerMounts: [
    { id: "ag-yard-standard", kind: "standard", heraldry: "player", pose: G.facing(-6.5, 10.5, 180), height: 8, minHallTier: 0 },
    { id: "ag-hall-emblem", kind: "emblem", heraldry: "player", pose: { position: [0, round2(HALL_FLOOR + 4.4), -5.3], yawDeg: 0 }, height: 1.6, minHallTier: 0 },
    { id: "ag-gate-shield", kind: "shield", heraldry: "player", pose: { position: [0, round2(GATE_FLOOR + 5), 46.6], yawDeg: 0 }, height: 1.4, minHallTier: 0 },
    { id: "ag-mound-standard-w", kind: "standard", heraldry: "player", pose: { position: [-7, MOUND_TOP, 73.4], yawDeg: 0 }, height: 6, minHallTier: 0 },
    { id: "ag-mound-standard-e", kind: "standard", heraldry: "player", pose: { position: [7, MOUND_TOP, 73.4], yawDeg: 0 }, height: 6, minHallTier: 0 },
    { id: "ag-horn-veil", kind: "veiled-standard", heraldry: "crown", pose: { position: [-17.5, round2(HERALD_FLOOR + 12), 35], yawDeg: 0 }, height: 3, minHallTier: 0 },
    { id: "ag-hall-gable-pennant", kind: "pennant", heraldry: "player", pose: { position: [-21, round2(HALL_FLOOR + 11.5), -14], yawDeg: 0 }, height: 2.4, minHallTier: 1 },
    { id: "ag-hall-shields", kind: "tapestry", heraldry: "player", pose: { position: [0, round2(HALL_FLOOR + 2.2), -8.2], yawDeg: 0 }, height: 3, minHallTier: 2 },
    { id: "ag-watch-pennant", kind: "pennant", heraldry: "player", pose: { position: [38.2, round2(T.height(38.2, -31.1) + 15.5), -31.1], yawDeg: 0 }, height: 2.6, minHallTier: 3 },
  ],
  hallTiers: [
    { tier: 1, buildings: ["ag-guest-hall"], expansionZones: [], dressing: ["ag-hall-gable-pennant", "guest-hall-hangings"] },
    { tier: 2, buildings: ["ag-tally-loft"], expansionZones: ["ag-exp-tally-loft"], dressing: ["ag-hall-shields", "honour-boards"] },
    { tier: 3, buildings: [], expansionZones: ["ag-exp-stone-hall", "ag-exp-byre-yard"], dressing: ["ag-watch-pennant", "carved-gate-posts"] },
  ],
  foundingStandard: G.facing(-4.6, 8.8, 180),
};

// --- Storytelling, vegetation and dressing ------------------------------------------

const STONE_RING_CENTRE: Vec2 = [56, -79];
const stoneRing = Array.from({ length: 7 }, (_, i) => {
  const a = ((i * 360) / 7 + 12) * (Math.PI / 180);
  return { id: `ag-stone-${i + 1}`, x: round2(STONE_RING_CENTRE[0] + Math.cos(a) * 4.2), z: round2(STONE_RING_CENTRE[1] + Math.sin(a) * 4.2), yaw: round2((i * 360) / 7) };
});

const story: BannerholdBlueprint["story"] = [
  { id: "ag-story-watchtower", kind: "repaired-watchtower", position: [38.2, -31.1], refs: ["ag-watchtower-repaired"], description: "Pale new oak scarfed onto charred black legs at half height: the one tower the banner rebuilt, the seam plain from the yard." },
  { id: "ag-story-west-palisade", kind: "weathered-fortification", position: [-52, 8], refs: ["ag-palisade", "ag-tower-west"], description: "The west palisade leans outward on rotten feet, propped with stakes; its tower is soft underfoot." },
  { id: "ag-story-old-ring", kind: "weathered-fortification", position: [-76, 6], refs: ["ag-old-ring"], description: "A grassed bank and charred post stumps: the earlier holders' outer ring, half ploughed into the field strips." },
  { id: "ag-story-levy-field", kind: "levy-yard-vs-noble-architecture", position: [0, 62], refs: ["ag-muster-mound", "ag-levy-house", "ag-allied-seat"], description: "A turf levy house and a kerbed mound on a terrace below the palisade; far up the valley on the opposite shoulder, the allied Great House's barrow-hall among colossal stones." },
  { id: "ag-story-road", kind: "merchant-road", position: [31, 84], refs: ["ag-national-road", "ag-gate-main", "ag-ford-horn"], description: "The valley road crosses at the ford under the horn post and climbs to the gate: drovers, traders and the Blood-Throne's riders all use it." },
  { id: "ag-story-guest-hall", kind: "unfinished-structure", position: [-6, -33], refs: ["ag-guest-hall", "ag-guest-crane"], description: "Posts and roof trees raised for a guest hall, scaffolded, with sheer-legs standing idle beside it." },
  { id: "ag-story-honour-posts", kind: "ceremonial-place", position: [0, 4], refs: ["ag-honour-posts"], description: "Eight carved posts round the hearth with bare iron hooks waiting for recognised honours." },
  { id: "ag-story-pawn-stand", kind: "empty-character-position", position: [0, 64.2], refs: ["ag-muster-mound"], description: "The nominated representative's stone before the file stones, occupied or empty according to real state." },
  { id: "ag-story-empty-house", kind: "older-house-ruin", position: [-31.7, 2.7], refs: ["ag-empty-house"], description: "A longhouse left when its family followed the previous holders away; the roof has fallen in at one end." },
  { id: "ag-story-stones", kind: "ancestral-memory", position: STONE_RING_CENTRE, refs: ["ag-stone-1", "ag-stone-4", "ag-fell-path"], description: "A ring of standing stones raised by an older people on a ledge at the foot of the fell; the path to them is worn deeper than any lane inside the palisade." },
  { id: "ag-story-byre", kind: "ancestral-memory", position: [44, -9.5], refs: ["ag-great-byre", "ag-bone-arch"], description: "A byre built for beasts far larger than cattle, its door twice the longhall's height, and an arch of enormous ribs over the byre gate." },
  { id: "ag-story-class", kind: "class-contrast", position: [-20, 10], refs: ["ag-elder-house", "ag-pit-house-fallen", "ag-longhall"], description: "Carved stave walls and a curved roof for the eldest family, a half-sunk pit-house with a fallen corner against the bank, the longhall over both." },
  { id: "ag-story-spring", kind: "water-memory", position: [-28, -62.5], refs: ["ag-spring-path", "ag-spring-trough"], description: "The spring that never freezes, in the saddle under the fell; water carriers pass through the postern at every hour." },
  { id: "ag-story-boundary", kind: "boundary-dispute", position: [-112, 82], refs: ["ag-boundary-stone-west", "ag-boundary-stone-moved"], description: "Two boundary stones a stride apart at the end of the field track, where the downstream farms dispute the line." },
];

const vegetation: BannerholdBlueprint["vegetation"] = [
  { id: "ag-fell-forest", kind: "forest", shape: { kind: "polygon", points: [[-220, -200], [220, -200], [220, -98], [60, -94], [-40, -92], [-120, -94], [-220, -98]] }, density: 3.2, species: "black pine and twisted birch", seed: 31 },
  { id: "ag-fell-scrub", kind: "scrub", shape: { kind: "polygon", points: [[-220, -98], [-120, -94], [-40, -92], [60, -94], [220, -98], [220, -76], [66, -74], [64, -88], [48, -88], [46, -74], [-220, -76]] }, density: 1.0, species: "juniper and rowan", seed: 32 },
  { id: "ag-birch-copse", kind: "woodland", shape: { kind: "polygon", points: [[62, -58], [110, -70], [130, -40], [92, -22], [66, -30]] }, density: 2.4, species: "birch and aspen", seed: 33 },
  { id: "ag-alders-east", kind: "woodland", shape: { kind: "polygon", points: [[96, 54], [122, 26], [134, 34], [108, 66]] }, density: 3, species: "alder and grey willow", seed: 34 },
  { id: "ag-alders-west", kind: "woodland", shape: { kind: "polygon", points: [[-118, 90], [-170, 80], [-176, 88], [-124, 97]] }, density: 3, species: "alder and grey willow", seed: 35 },
  { id: "ag-ford-willow", kind: "lone-tree", shape: { kind: "rect", center: [38, 100], width: 2, depth: 2 }, density: 1, species: "old crack willow", seed: 36 },
  { id: "ag-old-ash", kind: "lone-tree", shape: { kind: "rect", center: [11, -33], width: 2, depth: 2 }, density: 1, species: "old ash behind the longhall", seed: 37 },
  { id: "ag-kale-patch", kind: "garden", shape: { kind: "rect", center: [-28, -15.6], width: 4, depth: 2.4 }, density: 30, species: "kale and onions", seed: 38 },
  { id: "ag-far-heath", kind: "heath", shape: { kind: "polygon", points: [[-220, 132], [220, 122], [220, 200], [-220, 200]] }, density: 5, species: "heather and bilberry", seed: 39 },
  { id: "ag-river-reeds", kind: "reeds", shape: { kind: "polygon", points: [[-62, 100], [-28, 97], [-28, 101], [-62, 104]] }, density: 20, species: "reeds and sedge", seed: 40 },
  { id: "ag-saddle-bracken", kind: "heath", shape: { kind: "polygon", points: [[-110, -68], [-42, -58], [-40, -52], [-110, -58]] }, density: 6, species: "bracken", seed: 41 },
];

/** Point in a lot's frame (x along the lane, z toward the lane). */
const LF = (fp: FrontagePlacement, lx: number, lz: number): Vec2 => local(fp.center, fp.rot, lx, lz);
const ELDER_BENCH = LF(ELDER_FP, -3, 4.0);

const dressing: BannerholdBlueprint["dressing"] = [
  { id: "ag-hearth", kind: "brazier", position: [0, 4], yawDeg: 0, district: "A", note: "The open hearth before the longhall door, kept in every season." },
  ...stoneRing.map((s) => ({ id: s.id, kind: "standing-stone" as const, position: [s.x, s.z] as Vec2, yawDeg: s.yaw, district: "G" as const, note: "Standing stone of the older ring, lichen-grey, taller than a rider." })),
  { id: "ag-stone-fallen", kind: "standing-stone", position: [60.6, -74.8], yawDeg: 64, district: "G", note: "The eighth stone, fallen outward long ago and left where it lies." },
  { id: "ag-bone-arch", kind: "bones", position: [55.8, 1.5], yawDeg: 90, district: "D", note: "An arch of two enormous ribs over the byre gate." },
  { id: "ag-byre-jaw", kind: "bones", position: [49.6, -1.2], yawDeg: 0, district: "D", note: "A jawbone longer than a cart, propped against the byre wall." },
  { id: "ag-cook-wood", kind: "woodpile", position: [20.2, -23.4], yawDeg: 0, district: "A" },
  { id: "ag-cook-jars", kind: "water-jars", position: [28.8, -30.4], yawDeg: 0, district: "A" },
  { id: "ag-cauldron", kind: "cooking-fire", position: [27, -35.6], yawDeg: 0, district: "A", note: "The cook house's yard fire and cauldron." },
  { id: "ag-guest-timber", kind: "scaffold-stack", position: [6.4, -34], yawDeg: 90, district: "A", note: "Roof trees and staves for the guest hall." },
  { id: "ag-guest-crane", kind: "crane", position: [-17.2, -33], yawDeg: 90, district: "A", note: "Sheer-legs for raising the roof trees, idle." },
  { id: "ag-weapon-rack", kind: "weapon-rack", position: [-20.4, 52.4], yawDeg: 90, district: "B" },
  { id: "ag-pell", kind: "practice-pell", position: [-13.4, 58.2], yawDeg: 0, district: "B", note: "Three pells at the drill square's edge, one split." },
  { id: "ag-archery", kind: "archery-butt", position: [-29, 74.2], yawDeg: 0, district: "B" },
  { id: "ag-levy-fire", kind: "cooking-fire", position: [-19.6, 67.8], yawDeg: 0, district: "B" },
  { id: "ag-anvil", kind: "anvil", position: SM(-6.3, 1.6), yawDeg: 0, district: "D" },
  { id: "ag-quench", kind: "quench-trough", position: SM(-7.4, -1.4), yawDeg: 0, district: "D" },
  { id: "ag-bog-iron", kind: "stone-pile", position: SM(4.2, -4.6), yawDeg: 0, district: "D", note: "Bog-iron ore and charcoal heaped behind the smithy." },
  { id: "ag-tannery-frames", kind: "laundry-line", position: LF(TANNERY_FP, 0, -4.2), yawDeg: 0, district: "D", note: "Hides stretched on frames against the palisade." },
  { id: "ag-weaver-laundry", kind: "laundry-line", position: LF(WEAVER_FP, 0, -4.6), yawDeg: 0, district: "C", note: "Dyed wool drying on the fence behind the weaver's longhouse." },
  { id: "ag-smoke-racks", kind: "laundry-line", position: LF(SMOKEHOUSE_FP, 0, -3.4), yawDeg: 0, district: "D", note: "Fish drying on racks behind the smokehouse." },
  { id: "ag-granary-sacks", kind: "crates", position: LF(GRANARY_FP, 3.8, 1.2), yawDeg: 0, district: "D" },
  { id: "ag-workshop-timber", kind: "scaffold-stack", position: LF(WORKSHOP_FP, -5.4, 0), yawDeg: 0, district: "D", note: "Split staves seasoning beside the woodwright's shop." },
  { id: "ag-elder-bench", kind: "bench", position: ELDER_BENCH, yawDeg: 0, district: "C" },
  { id: "ag-herald-tether", kind: "beast-tether", position: [-6.6, 34.2], yawDeg: 0, district: "E" },
  { id: "ag-notice-posts", kind: "notice-board", position: [-7.8, 33.6], yawDeg: 90, district: "E", note: "Carved message sticks pinned to posts by the herald's door." },
  { id: "ag-ford-cart", kind: "cart", position: [27.4, 93.6], yawDeg: 200, district: "G", note: "A drover's cart waiting to cross the ford." },
  { id: "ag-spring-trough", kind: "quench-trough", position: [-25, -61.4], yawDeg: 0, district: "G", note: "Stone trough below the spring." },
  { id: "ag-boundary-stone-west", kind: "boundary-stone", position: [-112, 82], yawDeg: 0, district: "G" },
  { id: "ag-boundary-stone-moved", kind: "boundary-stone", position: [-108.4, 84.6], yawDeg: 15, district: "G", note: "The stone the downstream farms say was moved." },
  { id: "ag-waymark", kind: "boundary-stone", position: [44, 130], yawDeg: 0, district: "G", note: "Waymark on the far bank where the valley road leaves the ford." },
  { id: "ag-byre-hay", kind: "hay", position: [50.4, -8], yawDeg: 0, district: "D" },
  { id: "ag-goat-tether", kind: "beast-tether", position: [-14.6, 18.4], yawDeg: 0, district: "C", note: "Goats tethered by the herder's pit-house." },
];

const activitySites: BannerholdBlueprint["activitySites"] = [
  { id: "ag-site-forge", kind: "forge", position: G.ground(SM(-6.6, 0)[0], SM(-6.6, 0)[1]), district: "D" },
  { id: "ag-site-anvil", kind: "anvil", position: G.ground(SM(-6.3, 1.6)[0], SM(-6.3, 1.6)[1]), district: "D" },
  { id: "ag-site-quench", kind: "quench", position: G.ground(SM(-7.4, -1.4)[0], SM(-7.4, -1.4)[1]), district: "D" },
  { id: "ag-site-spring", kind: "well", position: G.ground(-27.9, -65), district: "G" },
  { id: "ag-site-drill", kind: "drill-square", position: G.ground(-16.5, 63), district: "B" },
  { id: "ag-site-notices", kind: "notice-board", position: G.ground(-7.4, 34.2), district: "E" },
  { id: "ag-site-tether", kind: "stable", position: G.ground(-6.6, 34.2), district: "E" },
  { id: "ag-site-lookout", kind: "lookout", position: [38.2, round2(T.height(38.2, -31.1) + 13), -31.1], district: "D" },
  { id: "ag-site-war-table", kind: "war-table", position: [29.6, tableTop, -14.8], district: "F" },
  { id: "ag-site-workbench", kind: "workbench", position: G.ground(LF(WORKSHOP_FP, 0, 4)[0], LF(WORKSHOP_FP, 0, 4)[1]), district: "D" },
  { id: "ag-site-byre", kind: "stable", position: G.ground(44, -0.8), district: "D" },
  { id: "ag-site-granary", kind: "loading-bay", position: G.ground(LF(GRANARY_FP, 0, 3.4)[0], LF(GRANARY_FP, 0, 3.4)[1]), district: "D" },
  { id: "ag-site-laundry", kind: "laundry", position: G.ground(LF(WEAVER_FP, 0, -4.6)[0], LF(WEAVER_FP, 0, -4.6)[1]), district: "C" },
  { id: "ag-site-hearth", kind: "cooking-fire", position: G.ground(0, 5.6), district: "A" },
];

// --- Life: deterministic schedules ------------------------------------------------

const near = { fullRateWithin: 60, reducedRateWithin: 160, hiddenBeyond: 420 };
const far = { fullRateWithin: 0, reducedRateWithin: 600, hiddenBeyond: 1600 };
const ROAD_IN: Vec2[] = [[180, 60], [110, 104], [40, 126], [17, 117], [17, 105.5], [22, 99], [32, 86], [30, 76], [30, 60], [28, 53], [24, 51.2], [12, 49.4], [4.5, 47.4], [0, 47.4], [0, 44], [0, 38.6], [-5.6, 37.6]];
const WORKSHOP_DOOR = LF(WORKSHOP_FP, 0, 3.6);

const npcs: NpcAgent[] = [
  {
    id: "ag-sentry-south", role: "sentry", label: "Sentry on the south palisade walk", district: "E", count: 1,
    route: [[-38.2, 31.1], [-20.7, 40.7], [0, 44], [20.7, 40.7], [38.2, 31.1]], heightMode: "wall-walk", wallId: "ag-palisade",
    steps: [{ kind: "walk", to: 4 }, { kind: "hold", seconds: 8, activity: "watch", faceBearingDeg: 135 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 10, activity: "watch", faceBearingDeg: 225 }],
    phaseSeconds: 0, speed: 0.9, lod: near, activitySiteIds: [],
  },
  {
    id: "ag-sentry-north", role: "sentry", label: "Sentry on the north palisade under the fell", district: "A", count: 1,
    route: [[-38.2, -31.1], [-20.7, -40.7], [0, -44], [20.7, -40.7], [35.4, -32.6]], heightMode: "wall-walk", wallId: "ag-palisade",
    steps: [{ kind: "walk", to: 4 }, { kind: "hold", seconds: 6, activity: "watch", faceBearingDeg: 40 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 6, activity: "watch", faceBearingDeg: 320 }],
    phaseSeconds: 33, speed: 0.8, lod: near, activitySiteIds: ["ag-site-lookout"],
  },
  {
    id: "ag-gate-guards", role: "guard", label: "Gate guards inside the south gate", district: "E", count: 2, formation: [[0, 0], [5.2, 0]],
    route: [[-2.6, 40.6], [-2.6, 39.4]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 20, activity: "watch", faceBearingDeg: 180 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "inspect", faceBearingDeg: 180 }, { kind: "walk", to: 0 }],
    phaseSeconds: 5, speed: 0.6, lod: near, activitySiteIds: [],
  },
  {
    id: "ag-smith", role: "smith", label: "Smith under the forge shed", district: "D", count: 1,
    route: [SM(-6.6, 0), SM(-6.3, 1.6), SM(-7.4, -1.4)], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 5, activity: "bellows" }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 9, activity: "forge-strike" },
      { kind: "walk", to: 2 }, { kind: "hold", seconds: 3, activity: "quench" }, { kind: "walk", to: 0 },
    ],
    phaseSeconds: 0, speed: 0.8, lod: near, activitySiteIds: ["ag-site-forge", "ag-site-anvil", "ag-site-quench"],
  },
  {
    id: "ag-messenger", role: "messenger", label: "Rider of the Blood-Throne coming up the valley to the Herald's Station", district: "E", count: 1,
    route: ROAD_IN, heightMode: "terrain",
    steps: [
      { kind: "walk", to: 16, speed: 3.4 }, { kind: "hold", seconds: 10, activity: "post-notice", faceBearingDeg: 270 }, { kind: "hold", seconds: 8, activity: "tend-beast", faceBearingDeg: 90 },
      { kind: "walk", to: 0, speed: 3.4 }, { kind: "hold", seconds: 45, activity: "rest" },
    ],
    phaseSeconds: 20, speed: 3.4, lod: { fullRateWithin: 80, reducedRateWithin: 400, hiddenBeyond: 900 }, activitySiteIds: ["ag-site-notices", "ag-site-tether"],
  },
  {
    id: "ag-drill", role: "drill", label: "Levy drilling on the terrace", district: "B", count: 4, formation: [[0, 0], [1.6, 0], [0, 1.6], [1.6, 1.6]],
    route: [[-19.6, 60.4], [-14.6, 60.4], [-14.6, 64.4], [-19.6, 64.4], [-19.6, 60.4]], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 12, activity: "drill", faceBearingDeg: 0 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 8, activity: "drill", faceBearingDeg: 0 },
      { kind: "walk", to: 2 }, { kind: "walk", to: 3 }, { kind: "hold", seconds: 6, activity: "salute", faceBearingDeg: 120 }, { kind: "walk", to: 4 },
    ],
    phaseSeconds: 0, speed: 1.1, lod: near, activitySiteIds: ["ag-site-drill"],
  },
  {
    id: "ag-herald", role: "herald", label: "Herald at the message posts", district: "E", count: 1,
    route: [[-7.4, 34.2], [-6, 37.6], [-2.6, 38.6]], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 9, activity: "read-notice", faceBearingDeg: 270 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "write" },
      { kind: "walk", to: 2 }, { kind: "hold", seconds: 7, activity: "watch", faceBearingDeg: 180 }, { kind: "walk", to: 0 },
    ],
    phaseSeconds: 11, speed: 0.9, lod: near, activitySiteIds: ["ag-site-notices"],
  },
  {
    id: "ag-tally-keeper", role: "scribe", label: "Tally keeper crossing from the record house to the longhall", district: "F", count: 1,
    route: [[29, -8.6], [20, -3], [10, 0], [4, -4.6], [0.8, -5.6]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 4 }, { kind: "hold", seconds: 8, activity: "inspect", faceBearingDeg: 0 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 22, activity: "write", faceBearingDeg: 0 }],
    phaseSeconds: 14, speed: 0.9, lod: near, activitySiteIds: ["ag-site-war-table"],
  },
  {
    id: "ag-water-carrier", role: "resident", label: "Water carrier between the spring and the cook house", district: "A", count: 1,
    route: [[-27.9, -65], [-27.7, -67.1], [-14, -64], [0, -52], [0, -44], [0, -43], [10, -40], [24, -34.2], [31, -33], [34.4, -28.6], [29.4, -28.2]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 8, activity: "draw-water", faceBearingDeg: 350 }, { kind: "walk", to: 10 }, { kind: "hold", seconds: 6, activity: "carry", faceBearingDeg: 270 }, { kind: "walk", to: 0 }],
    phaseSeconds: 3, speed: 0.8, lod: near, activitySiteIds: ["ag-site-spring"],
  },
  {
    id: "ag-weaver", role: "resident", label: "Weaver at the drying fence and the elder's bench", district: "C", count: 1,
    route: [LF(WEAVER_FP, 0, -4.6), LF(WEAVER_FP, 7, -4.6), LF(WEAVER_FP, 7, 5), ELDER_BENCH], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 20, activity: "hang-laundry" }, { kind: "walk", to: 3 }, { kind: "hold", seconds: 14, activity: "chat" }, { kind: "walk", to: 0 }],
    phaseSeconds: 41, speed: 0.8, lod: near, activitySiteIds: ["ag-site-laundry"],
  },
  {
    id: "ag-herder", role: "beast-handler", label: "Herder leading the byre's cattle to the pasture", district: "D", count: 1,
    route: [[44, -0.8], [50, 1.3], [54, 1.5], [75, 6], [100, 14.8]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 4 }, { kind: "hold", seconds: 40, activity: "tend-beast", faceBearingDeg: 90 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 20, activity: "rest" }],
    phaseSeconds: 60, speed: 0.7, lod: near, activitySiteIds: ["ag-site-byre"],
  },
  {
    id: "ag-children", role: "child", label: "Children running round the hearth ring", district: "A", count: 2, formation: [[0, 0], [1.2, 0.8]],
    route: [[0, 12.5], [9, 9], [10, 0], [9, 9], [0, 12.5]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 2, speed: 2.1 }, { kind: "hold", seconds: 5, activity: "chat" }, { kind: "walk", to: 4, speed: 2.1 }, { kind: "hold", seconds: 9, activity: "chat" }],
    phaseSeconds: 8, speed: 2.1, lod: near, activitySiteIds: ["ag-site-hearth"],
  },
  {
    id: "ag-woodwright", role: "worker", label: "Woodwright carrying staves to the guest hall", district: "D", count: 1,
    route: [WORKSHOP_DOOR, [35.5, 10.5], [37.8, 0.5], [36, -12], [34.6, -27.6], [34.4, -28.6], [31, -33], [24, -34.2], [10, -40], [2.8, -40.4]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 9 }, { kind: "hold", seconds: 8, activity: "carry", faceBearingDeg: 270 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 20, activity: "repair" }],
    phaseSeconds: 27, speed: 0.85, lod: near, activitySiteIds: ["ag-site-workbench"],
  },
  {
    id: "ag-farmers", role: "farmer", label: "Farmers working the oat strips over the old ring", district: "G", count: 3, formation: [[0, 0], [5, 3], [10, 1]],
    route: [[-62, 40], [-94, 34]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 1, speed: 0.4 }, { kind: "hold", seconds: 20, activity: "rest" }, { kind: "walk", to: 0, speed: 0.4 }, { kind: "hold", seconds: 16, activity: "carry" }],
    phaseSeconds: 0, speed: 0.4, lod: far, activitySiteIds: [],
  },
  {
    id: "ag-drover", role: "carter", label: "Drover's cart coming down the valley road to the ford", district: "G", count: 1,
    route: [[180, 60], [110, 104], [40, 126], [17, 117], [17, 105.5], [22, 99], [27.2, 94.2]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 6, speed: 1.1 }, { kind: "hold", seconds: 30, activity: "trade", faceBearingDeg: 200 }, { kind: "walk", to: 0, speed: 1.1 }, { kind: "hold", seconds: 60, activity: "rest" }],
    phaseSeconds: 140, speed: 1.1, lod: far, activitySiteIds: [],
  },
];

// --- Outer Territory and the greater nation ---------------------------------------

const outer: BannerholdBlueprint["outer"] = {
  fields: [
    { id: "ag-field-oats", crop: "oats", polygon: [[-56, 30], [-96, 24], [-100, 44], [-60, 52]], furrowBearingDeg: 262, owner: "holding", condition: "tended" },
    { id: "ag-field-barley", crop: "bere barley", polygon: [[-60, 54], [-100, 46], [-104, 66], [-64, 74]], furrowBearingDeg: 262, owner: "holding", condition: "harvested" },
    { id: "ag-field-fallow", crop: "fallow", polygon: [[-64, 76], [-104, 68], [-108, 84], [-66, 88]], furrowBearingDeg: 262, owner: "holding", condition: "fallow" },
    { id: "ag-field-hay", crop: "hay meadow", polygon: [[60, 14], [104, 6], [112, 34], [68, 40]], furrowBearingDeg: 80, owner: "holding", condition: "harvested" },
    { id: "ag-field-neighbour", crop: "rye", polygon: [[40, 132], [-20, 140], [-16, 170], [44, 162]], furrowBearingDeg: 95, owner: "neighbour", condition: "tended" },
  ],
  outposts: [
    { id: "ag-ford-horn", name: "Ford horn post", kind: "waystation", position: [28, 102], height: 6, owner: "holding", description: "A post and shelter at the ford where a horn is kept to answer the horn tower above." },
    { id: "ag-storm-watch", name: "Storm watch on the fell", kind: "border-tower", position: [70, -134], height: 9, owner: "holding", description: "A stone watch hut on the fell crest that sees weather and riders coming down the valley." },
    { id: "ag-crest-cairn", name: "Crest cairn", kind: "cairn", position: [-20, -152], height: 3, owner: "holding", description: "Cairn where the holding's grazing ends at the crest." },
    { id: "ag-boundary-ford", name: "Far-bank boundary stone", kind: "boundary-stone", position: [0, 124], height: 1.4, owner: "holding", description: "Holding boundary on the far bank of the river." },
  ],
  places: [
    distantPlace({ id: "ag-allied-seat", name: "Barrow-hall of the allied Great House", kind: "allied-seat", bearingDeg: 72, distance: 5200, groundElevation: 140, silhouetteHeight: 42, radius: 260, stateSlot: "allied-house", description: "A great barrow-hall among colossal standing stones on the valley's upper shoulder: the Great House the banner musters beside, older than the valley's memory and sparing with its regard." }),
    distantPlace({ id: "ag-frontier-korvenia", name: "Western pass fort", kind: "frontier", frontierNation: "korvenia", bearingDeg: 262, distance: 15000, groundElevation: 160, silhouetteHeight: 36, radius: 140, stateSlot: "rival-house", description: "A timber-and-stone fort in the western pass where the drove road leaves for Korvenia." }),
    distantPlace({ id: "ag-frontier-solforiz", name: "Southern gorge fort", kind: "frontier", frontierNation: "solforiz", bearingDeg: 184, distance: 21000, groundElevation: 60, silhouetteHeight: 34, radius: 140, stateSlot: "rival-house", description: "A gorge fort on the southern road; beyond it the land dries toward Solforiz." }),
    distantPlace({ id: "ag-frontier-kwind", name: "South-western march fort", kind: "frontier", frontierNation: "kwind-09", bearingDeg: 224, distance: 24000, groundElevation: 80, silhouetteHeight: 40, radius: 150, stateSlot: "rival-house", description: "A march fort above the south-western lowlands, facing the Kwind-09 border." }),
    distantPlace({ id: "ag-neighbour-steading", name: "Steading of a neighbouring banner", kind: "neighbour-estate", bearingDeg: 238, distance: 1900, groundElevation: -6, silhouetteHeight: 16, radius: 90, description: "Another banner's palisaded steading downstream; its smoke rises at the same hour as ours." }),
    distantPlace({ id: "ag-valley-farms", name: "Downstream farms", kind: "village", bearingDeg: 205, distance: 1400, groundElevation: -8, silhouetteHeight: 10, radius: 160, description: "Scattered turf-roofed farms along the river below the mill." }),
    distantPlace({ id: "ag-crag-hall", name: "Crag hall of a warrior house", kind: "citadel", bearingDeg: 96, distance: 6000, groundElevation: 260, silhouetteHeight: 60, radius: 200, description: "A dark hall on the eastern crags, with great nesting ledges above it." }),
    distantPlace({ id: "ag-ford-town", name: "Timber town at the valley mouth", kind: "town", bearingDeg: 214, distance: 6500, groundElevation: -20, silhouetteHeight: 24, radius: 450, description: "A timber town where the drove roads meet at the valley mouth: roofs, smoke and a long bridge." }),
    distantPlace({ id: "ag-capital", name: "The capital", kind: "capital", bearingDeg: 60, distance: 26000, groundElevation: 200, silhouetteHeight: 320, radius: 3000, description: "A citadel of colossal dark stone on the volcanic heights where the valley road ends, a slow smoke plume behind it. Always called simply the capital." }),
  ],
  territories: [
    { id: "ag-terr-holding", name: "The steading's lands", owner: "holding", polygon: [[150, -170], [-60, -170], [-200, -80], [-200, 60], [-120, 96], [20, 100], [150, 40]] },
    { id: "ag-terr-allied", name: "Lands of the allied Great House (up-valley)", owner: "allied-great-house", polygon: [[150, 40], [150, -170], [4000, -3000], [6000, 600]] },
    { id: "ag-terr-crown", name: "Valley road (crown)", owner: "crown", polygon: [[20, 100], [150, 40], [6000, 600], [6400, 1600], [200, 160]] },
    { id: "ag-terr-downstream", name: "Downstream farms (another banner)", owner: "other-banner", polygon: [[-120, 96], [20, 100], [200, 160], [-600, 3000], [-3000, 2400]] },
    { id: "ag-terr-fell", name: "The fell and the crags (wilderness)", owner: "wilderness", polygon: [[-60, -170], [150, -170], [4000, -3000], [-2800, -3000], [-200, -80]] },
  ],
  skyline: [
    { id: "ag-sky-fell", kind: "ridge", bearingFromDeg: 280, bearingToDeg: 80, distance: 150, height: 70, description: "The fell rising behind the compound to bare crags." },
    { id: "ag-sky-glaciers", kind: "glacier", bearingFromDeg: 300, bearingToDeg: 90, distance: 22000, height: 1800, description: "Glacier-hung mountains of the north, white above the fell." },
    { id: "ag-sky-volcano", kind: "smoke", bearingFromDeg: 56, bearingToDeg: 64, distance: 28000, height: 900, description: "A slow smoke plume over the capital's volcanic heights, lit red from beneath at dusk." },
    { id: "ag-sky-allied", kind: "ridge", bearingFromDeg: 68, bearingToDeg: 76, distance: 5200, height: 42, description: "The allied barrow-hall's mound and stones on the valley's upper shoulder." },
    { id: "ag-sky-forest", kind: "forest", bearingFromDeg: 180, bearingToDeg: 260, distance: 3000, height: 50, description: "Pine forest on the far side of the valley." },
    { id: "ag-sky-smoke", kind: "smoke", bearingFromDeg: 236, bearingToDeg: 240, distance: 1900, height: 60, description: "The neighbouring steading's smoke drifting down the valley." },
  ],
};

// --- View corridors and expansion ------------------------------------------------------

const ESTABLISHING_TARGET = [2, 15, -4] as const;
const establishingPos = cameraFrom(ESTABLISHING_TARGET, 222, 200, 44);

/** A point `length` metres along the sight line from `from` toward a distant place's silhouette top. */
function sightToward(from: readonly [number, number, number], placeId: string, length: number): readonly [number, number, number] {
  const place = outer.places.find((p) => p.id === placeId);
  if (!place) throw new Error(`aethelgard: unknown place ${placeId}`);
  const tx = place.position[0] - from[0];
  const ty = place.groundElevation + place.silhouetteHeight - from[1];
  const tz = place.position[1] - from[2];
  const k = length / Math.sqrt(tx * tx + ty * ty + tz * tz);
  return [round2(from[0] + tx * k), round2(from[1] + ty * k), round2(from[2] + tz * k)];
}

const WATCH_TOP = [38.2, round2(T.height(38.2, -31.1) + 13.6), -31.1] as const;

const viewCorridors: BannerholdBlueprint["viewCorridors"] = [
  { id: "ag-vc-gate-hall", name: "Gate to the longhall door", from: [7, round2(T.height(7, 48.2) + 1.7), 48.2], to: [0, round2(HALL_FLOOR + 3.5), -6.6], halfWidth: 1.2, halfWidthFar: 4, purpose: "Through the gate passage the hearth and its honour posts frame the longhall door and the banner's shield.", allow: ["ag-gate-tower", "ag-longhall"] },
  { id: "ag-vc-capital", name: "Valley approach: the capital up the valley", from: establishingPos, to: sightToward(establishingPos, "ag-capital", 600), halfWidth: 3, halfWidthFar: 60, purpose: "From the valley the capital's dark heights and smoke show beyond the fell's eastern shoulder; keep this line clear of tall planting.", allow: [] },
  { id: "ag-vc-allied", name: "Watchtower up the valley to the allied barrow-hall", from: WATCH_TOP, to: sightToward(WATCH_TOP, "ag-allied-seat", 600), halfWidth: 2, halfWidthFar: 40, purpose: "From the rebuilt watchtower the allied Great House's barrow-hall stands on the valley's upper shoulder.", allow: ["ag-watchtower-repaired"] },
  { id: "ag-vc-stones", name: "Watchtower to the stone ring under the fell", from: WATCH_TOP, to: [STONE_RING_CENTRE[0], 15, STONE_RING_CENTRE[1]], halfWidth: 1.5, halfWidthFar: 5, purpose: "The watch looks over the north-east palisade to the older people's stones on their ledge at the foot of the fell.", allow: ["ag-watchtower-repaired"] },
  { id: "ag-vc-record", name: "Record house door to the longhall porch", from: [29, round2(RECORD_FLOOR + 1.6), -8.6], to: [3, round2(HALL_FLOOR + 2.5), -4.8], halfWidth: 0.8, halfWidthFar: 1.2, purpose: "The record house and the longhall door face each other across the hearth yard's east side.", allow: ["ag-war-record", "ag-longhall"] },
];

const expansion: BannerholdBlueprint["expansion"] = [
  { id: "ag-exp-tally-loft", name: "Tally loft plot", district: "F", polygon: [[25, -24.5], [33, -24.5], [33, -18.6], [25, -18.6]], intendedUse: "Loft for honour boards behind the record house (hall tier 2).", unlocksAtHallTier: 2 },
  { id: "ag-exp-stone-hall", name: "Stone hall plot below the palisade", district: "B", polygon: [[36, 52], [52, 50], [54, 66], [38, 68]], intendedUse: "A stone-footed hall for envoys facing the levy terrace (hall tier 3).", unlocksAtHallTier: 3 },
  { id: "ag-exp-byre-yard", name: "Byre yard", district: "D", polygon: [[56, -12], [72, -14], [74, 10], [58, 12]], intendedUse: "Beast pens outside the byre gate (hall tier 3).", unlocksAtHallTier: 3 },
  { id: "ag-exp-saddle-plot", name: "Saddle plot", district: "A", polygon: [[10, -62], [30, -60], [30, -50], [10, -52]], intendedUse: "Hall for a future Knight's household in the saddle beyond the postern (reserved).", unlocksAtHallTier: null },
];

// --- Cameras, VR staging, atmosphere ---------------------------------------------

const hallTarget = [0, round2(HALL_FLOOR + 5), -4] as const;
const musterTarget = [0, round2(FIELD + 2), 65] as const;
const recordTarget = [29, round2(RECORD_FLOOR + 4.5), -7] as const;
const heraldTarget = [-8, round2(HERALD_FLOOR + 8), 35.5] as const;
const pawnY = muster.pawnStand.position[1];

const cameras: BannerholdBlueprint["cameras"] = [
  camera(
    "establishing",
    "Establishing — the steading from across the river",
    establishingPos,
    ESTABLISHING_TARGET,
    40,
    { yawDeg: [-30, 30], pitchDeg: [4, 24], distance: [130, 240] },
    "Lower third: the river bend and the ford under its horn post, the levy terrace and its kerbed mound below the rampart; centre: the palisade ring on the knoll, the longhall's black curved roof and smoke louvre, the horn tower by the gate, and above the roofs the stone ring on its ledge at the foot of the fell; right third: the valley road climbing north-east toward the capital's smoking heights, the allied barrow-hall on the far shoulder at the frame's edge. Low sun from the south-west rakes the palisade.",
    2.4,
  ),
  camera(
    "founding",
    "Founding — the standard raised at the hearth",
    [0.4, 11.9, 21],
    [-3, 14, -6],
    50,
    { yawDeg: [-6, 4], pitchDeg: [-5, 8], distance: [22, 30] },
    "From the hall way at eye level, as the steading's people see it: the honour posts across the lower third, the new standard rising at the hearth against the longhall's carved porch and the shield over the door, the curved roof filling the top of frame.",
    2.0,
  ),
  camera(
    "landmark:banner-hall",
    "Banner Hall",
    cameraFrom(hallTarget, 168, 46, 16),
    hallTarget,
    42,
    { yawDeg: [-35, 35], pitchDeg: [8, 34], distance: [30, 64] },
    "Over the hearth yard: the longhall's forty-metre flank and carved porch, the honour posts round the fire, the record house at the right and the guest hall's bare frame behind the roof.",
  ),
  camera(
    "landmark:muster-grounds",
    "Muster Grounds",
    cameraFrom(musterTarget, 40, 36, 15),
    musterTarget,
    42,
    { yawDeg: [-25, 25], pitchDeg: [12, 36], distance: [26, 56] },
    "From above the south-east rampart: the levy terrace below the palisade, the formation side-on with the representative's stone and the eight file stones before the kerbed mound, the levy house and weapon house beyond, the river and the far bank at the left.",
  ),
  camera(
    "landmark:war-record",
    "War Record",
    cameraFrom(recordTarget, 200, 30, 9),
    recordTarget,
    40,
    { yawDeg: [-30, 25], pitchDeg: [8, 34], distance: [22, 48] },
    "From over the craft yards: the carved-board record house's south gable and door, its covered passage to the longhall's east end at the left, the great byre's curved roof at the right.",
  ),
  camera(
    "landmark:heralds-station",
    "Herald's Station",
    cameraFrom(heraldTarget, 80, 30, 8),
    heraldTarget,
    46,
    { yawDeg: [-25, 25], pitchDeg: [10, 34], distance: [22, 44] },
    "From over the craft lane: the herald's hut door and its message posts, the horn tower above, the gate passage at the left where riders arrive.",
  ),
  camera(
    "representative",
    "Representative close-up",
    [0, round2(pawnY + 2.2), 56.6],
    [0, round2(pawnY + 1.3), 64.2],
    32,
    { yawDeg: [-30, 30], pitchDeg: [2, 20], distance: [5, 10] },
    "Eye-level close-up of the nominated representative on their stone (or the empty stone and sealed message stick), the file stones and the kerbed mound behind, the valley beyond.",
    1.4,
  ),
];

const VR_SCALE = 0.008;
const DETAIL = { width: 132, depth: 136 };
const SEATED = { eyeHeight: 1.2, surfaceHeight: 0.74, viewerDistance: 0.82 };
const HORN_TOP = round2(HERALD_FLOOR + 14.5);

const vr: BannerholdBlueprint["vr"] = {
  displayScale: VR_SCALE,
  displayCenter: [0, 16],
  datumY: 0,
  detailExtent: DETAIL,
  skirtMargins: { far: 150, lateral: 70, near: 0 },
  viewerFacingBearingDeg: 0,
  seated: SEATED,
  standing: { eyeHeight: 1.62, surfaceHeight: 0.98, viewerDistance: 0.85 },
  rotation: { userRotatable: true, yawLimitDeg: 45, snapStepDeg: 15, resetsOnRecentre: true },
  reach: { pokeMax: 0.65, rayMax: 3, minTargetRadius: 0.035 },
  recentre: {
    keepsScale: true,
    keepsYaw: false,
    description: "Recentring re-places the gameplay anchor in front of the viewer; the miniature resets to its authored yaw (the viewer looks north, up the knoll toward the fell) and to the posture heights. The viewer is never moved or rotated.",
  },
  horizon: { ringRadius: 8, ringBaseHeight: -0.18, ringHeight: 1.4 },
  panelAnchors: { primary: [-0.74, 0.38, 0.24], dock: [0.64, 0.1, 0.36] },
  anchorConvention:
    "Assumed until gameplay confirms: the parent anchor's origin is the floor point beneath the viewer at recentre, -Z forward, no pitch or roll. The miniature's centre sits at (0, surfaceHeight, -viewerDistance).",
  comfortNotes: [
    `1:${Math.round(1 / VR_SCALE)} puts the ${DETAIL.width} × ${DETAIL.depth} m detail region on a ${(DETAIL.width * VR_SCALE).toFixed(2)} × ${(DETAIL.depth * VR_SCALE).toFixed(2)} m surface; the horn tower top (${HORN_TOP} m) rises ${(HORN_TOP * VR_SCALE).toFixed(2)} m above the datum, below seated eye height.`,
    `Near edge ${(SEATED.viewerDistance - (DETAIL.depth * VR_SCALE) / 2).toFixed(2)} m from the eyes seated: the levy terrace is nearest, the knoll and the longhall rise away from the viewer and the fell stands beyond the far edge.`,
    "The fell behind the steading rises as a backdrop beyond the far edge, never between the viewer and the compound.",
    "No artificial viewer motion: focusLandmark raises the landmark's emphasis and label only.",
  ],
};

const atmosphere: BannerholdBlueprint["atmosphere"] = {
  timeOfDay: "Late afternoon in a cold upland: a low sun from the south-west under a broken cloud ceiling, mist pooling along the river",
  sun: { bearingDeg: 235, elevationDeg: 14, colour: "#ffd2a1", intensity: 2.4, disc: "veiled-sun" },
  sky: { zenith: "#5e6b74", horizon: "#b9b4a6", ground: "#3a3328", ambientIntensity: 0.6 },
  fog: { colour: "#8d9690", near: 180, far: 2400, heightFalloff: 0.02 },
  wind: { towardBearingDeg: 60, speed: 6, gustiness: 0.5 },
  exposure: 1.05,
  accentLights: [
    { kind: "brazier", colour: "#ff9a4a", note: "The hearth before the longhall door." },
    { kind: "furnace", colour: "#ff6a1a", note: "The forge under the smithy's open shed." },
    { kind: "torch", colour: "#ffb066", note: "Torches either side of the longhall porch and the gate passage." },
    { kind: "signal-lamp", colour: "#ffc27a", note: "The horn tower's lamp, lit when a rider is sighted." },
  ],
  palette: {
    oakBlack: "#2f2620",
    oakNew: "#b08a5a",
    turf: "#5d6b3c",
    turfFresh: "#7f8f45",
    fieldstone: "#77746c",
    reed: "#a08d5f",
    sanguine: "#6e2222",
    redMoss: "#7a3b2a",
    mist: "#a9b1ab",
    ember: "#d97a3a",
    crownField: "#7a2420",
    crownBorder: "#8f8a7c",
  },
  notes: "Big shapes against weather: black curved roofs and pale new timber read at any distance; colour comes from turf, red moss and the hearth. Fog is a valley layer below the knoll, never a veil over the compound.",
};

// --- Districts, traditions and the blueprint -------------------------------------

const districts: BannerholdBlueprint["districts"] = [
  { id: "A", name: "Longhall Yard", role: "The longhall and hearth yard with its honour posts, the chief's house, the cook house and the unfinished guest hall.", polygon: [[-46, -30], [-38, -36], [-20, -43], [0, -46], [20, -43], [30, -37], [30, -24], [20, -22], [20, -6], [14, 14], [0, 16], [-14, 14], [-22, 6], [-24, -16], [-46, -16]] },
  { id: "B", name: "Levy Terrace", role: "The kerbed muster mound, file stones and representative's stone, the drill square, the levy house and the weapon house, 4.5 m below the gate.", polygon: [[-36, 47], [36, 47], [36, 80], [-36, 80]] },
  { id: "C", name: "Family Yards", role: "Longhouses, pit-houses and cottages along the Yard Lane inside the west palisade.", polygon: [[-54, 0], [-49.9, -16.8], [-46, -16], [-24, -16], [-22, 6], [-14, 14], [-4, 18], [-3, 29.5], [-25, 30], [-28, 36], [-38.2, 31.1], [-49.9, 16.8]] },
  { id: "D", name: "Craft Yards and Byre", role: "Smithy, tannery, smokehouse, staddle granary and woodwright along the Craft Lane, and the great byre by the byre gate.", polygon: [[30, -37], [38.2, -31.1], [49.9, -16.8], [54, 0], [49.9, 16.8], [38.2, 31.1], [20.7, 40.7], [8, 42], [6, 20], [14, 14], [20, -6], [36, -8], [36, -24], [30, -24]] },
  { id: "E", name: "South Gate and Herald's Station", role: "The gate tower on its raised apron, the herald's hut, message posts and horn tower.", polygon: [[-25, 30], [-3, 29.5], [3, 29.5], [8, 42], [4.6, 49.4], [-4.6, 49.4], [-20.7, 40.7], [-28, 36]] },
  { id: "F", name: "Record House", role: "The carved-board War Record and its covered passage to the longhall.", polygon: [[20, -22], [30, -24], [36, -24], [36, -8], [20, -6]] },
];

const traditions: BannerholdBlueprint["traditions"] = [
  { key: HALL, name: "Longhall timber", description: "Black oak staves and posts, curved ridges like an upturned keel, deep eaves on carved brackets, sod or split-shingle roofs, carved gable boards and door frames. The lordly and ancestral buildings.", materials: [STAVE, PLANK, FRAME, SOD, SHINGLE] },
  { key: TURF, name: "Turf and wattle", description: "Low wattle-and-daub or turf walls, sod roofs down to head height, pit-houses half sunk into the ground; the common dwelling and workshop.", materials: [WATTLE, SOD, THATCH, FIELDSTONE] },
  { key: STONE, name: "Fieldstone and earthwork", description: "Dry-laid fieldstone kerbs and footings and earth banks; the standing stones of an older people.", materials: [FIELDSTONE, SOD] },
];

const settlementBoundary: Vec2[] = [
  [64.8, 0], [59.9, 20.2], [45.8, 37.3], [36, 46], [37, 81], [-37, 81], [-36, 46], [-45.8, 37.3], [-59.9, 20.2], [-64.8, 0],
  [-59.9, -20.2], [-45.8, -37.3], [-24.8, -48.8], [0, -52.8], [24.8, -48.8], [45.8, -37.3], [59.9, -20.2],
];

export const AETHELGARD_BLUEPRINT: BannerholdBlueprint = {
  schema: 1,
  nationId: "aethelgard",
  siteName: "The clan steading",
  status: "first-pass",
  summary:
    "A clan compound on a moraine knoll: the ancestral longhall and its hearth of honour posts inside a ring palisade at +10 m, family yards and craft yards following the inside of the ring, a carved record house joined to the longhall, the levy terrace 4.5 m below the gate, and a ring of standing stones on a ledge at the foot of the fell. The valley road crosses the river at the ford and climbs north-east toward the capital 26 km away.",
  terrain,
  settlementBoundary,
  coreReference: { width: 108, depth: 88 },
  traditions,
  districts,
  buildings,
  walls,
  towers,
  gates,
  routes,
  destinations,
  landmarks,
  muster,
  ceremonial,
  unfinished: { buildingId: "ag-guest-hall", description: "The guest hall behind the longhall: posts and roof trees raised and scaffolded, walls waiting for staves; completes at hall tier 1." },
  slots,
  story,
  vegetation,
  dressing,
  activitySites,
  npcs,
  outer,
  viewCorridors,
  expansion,
  observation: { position: establishingPos, target: ESTABLISHING_TARGET, description: "From the far bank south-south-west of the knoll, above the river bend: the way a drover first sees the steading coming down the valley road." },
  cameras,
  vr,
  atmosphere,
};
