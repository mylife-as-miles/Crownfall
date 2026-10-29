// KORVENIA — the holding on the scarp (working placeholder name). Reversible production
// default (docs/legacy/environment/BIBLE.md §1): the benchmark layout the other nations are
// measured against, never a canonical or launch choice. Every name and story line below is
// a working placeholder pending creator approval.
//
// A vertical Gothic holding on the south flank of a basalt scarp. The Banner Court sits on a
// rock spur at +9 m; the War Record on its own shelf at +6.5 m, joined to the lodging by a
// gallery bridge; the Muster Terrace is levelled at 0 m inside the West Gate beneath the
// court's 9 m retaining wall; the lower town packs narrow, stepping streets east toward the
// ravine. The national road leaves the West Gate, crosses the valley brook and runs up the
// valley toward the capital in the north-west.

import { building, camera, cameraFrom, distantPlace, groundTools, local, mass, onStreet, poseRow } from "../authoring";
import type { FrontagePlacement } from "../authoring";
import { resolveBuildingBase } from "../buildings";
import { polar, round2 } from "../math2d";
import { createTerrainSampler } from "../terrain";
import type { BannerholdBlueprint, Building, NpcAgent, Route, TerrainFeature, TerrainModel, Vec2, WaterBody } from "../types";

// --- Terrain ----------------------------------------------------------------

const ravine: Vec2[] = [[96, -170], [88, -96], [82, -30], [84, 30], [74, 96], [52, 170]];
const brook: Vec2[] = [[-240, 118], [-160, 125], [-96, 131], [-30, 140], [20, 153], [52, 170]];

const COURT: Vec2[] = [[-30.5, -11.8], [-30.5, -57.5], [-14, -62], [22.6, -62], [23, -40], [22.8, -11.8]];
const SHELF: Vec2[] = [[23.4, -61], [40, -56], [45, -41], [45, -19.4], [23.4, -19.2]];
const TERRACE: Vec2[] = [[-53, -8.6], [-8.2, -8.6], [-8.2, 14.2], [-55.5, 14.2], [-55.5, -2]];

const features: TerrainFeature[] = [
  { kind: "slope", gradient: [-0.03, -0.085] },
  {
    kind: "ridge",
    id: "kv-scarp",
    points: [[-240, -138], [-120, -128], [-20, -124], [80, -128], [240, -142]],
    width: 120,
    height: 18,
    surface: "rock",
  },
  { kind: "mound", id: "kv-court-spur", center: [6, -36], radiusX: 50, radiusZ: 30, rotationDeg: -6, height: 5, surface: "rock" },
  { kind: "mound", id: "kv-west-knoll", center: [-128, -36], radiusX: 54, radiusZ: 40, height: 7, surface: "heath" },
  { kind: "mound", id: "kv-ravine-hill", center: [134, 64], radiusX: 42, radiusZ: 36, height: 10, surface: "heath" },
  { kind: "noise", seed: 1307, amplitude: 1.1, wavelength: 46, octaves: 3 },
  // Crags on the scarp face behind the court: ridged noise breaks the slope into basalt ribs.
  {
    kind: "noise",
    seed: 2203,
    amplitude: 4.5,
    wavelength: 24,
    octaves: 3,
    style: "ridged",
    region: { kind: "polygon", points: [[-200, -170], [200, -170], [200, -80], [70, -78], [-40, -76], [-200, -82]] },
    regionFalloff: 16,
  },
  { kind: "channel", id: "kv-ravine", points: ravine, width: 9, depth: 13, bankWidth: 24, surface: "scree" },
  { kind: "channel", id: "kv-valley-brook", points: brook, width: 6, depth: 2.4, bankWidth: 12, surface: "mud" },
  // Levelled ground: the Banner Court on the spur, the Record shelf, the Muster Terrace.
  { kind: "platform", id: "kv-banner-court", shape: { kind: "polygon", points: COURT }, elevation: 9, falloff: 1, surface: "paving", edge: "retaining-wall" },
  { kind: "platform", id: "kv-record-shelf", shape: { kind: "polygon", points: SHELF }, elevation: 6.5, falloff: 1, surface: "paving", edge: "retaining-wall" },
  { kind: "platform", id: "kv-muster-terrace", shape: { kind: "polygon", points: TERRACE }, elevation: 0, falloff: 1.5, surface: "earth", edge: "retaining-wall" },
  { kind: "platform", id: "kv-gate-apron", shape: { kind: "rect", center: [-64, 17], width: 12, depth: 12 }, elevation: 0, falloff: 4, surface: "cobble", edge: "slope" },
  // Graded steps cut into the rock.
  { kind: "ramp", id: "kv-record-stair-cut", points: [[18.5, -21], [25.5, -21]], width: 3, startElevation: 9, endElevation: 6.5, falloff: 0.6, surface: "paving" },
  { kind: "ramp", id: "kv-record-steps-cut", points: [[32, -19.6], [32, -13], [37, -6.6]], width: 2.6, startElevation: 6.5, endElevation: -0.45, falloff: 0.8, surface: "paving" },
];

const natural = createTerrainSampler({
  extents: { minX: -200, maxX: 200, minZ: -170, maxZ: 170 },
  baseElevation: 0,
  baseSurface: "heath",
  features,
  water: [],
  surfaces: [],
  logic: "",
});

const streamLevels = (points: readonly Vec2[], depth: number): number[] => points.map((p) => round2(natural.height(p[0], p[1]) + depth));

const water: WaterBody[] = [
  { id: "kv-ravine-stream", kind: "stream", shape: { kind: "line", points: ravine, width: 3 }, level: 0, pointLevels: streamLevels(ravine, 0.35), flow: 1.4, note: "Cold stream at the foot of the ravine; the washing path from the East Postern ends here." },
  { id: "kv-brook", kind: "stream", shape: { kind: "line", points: brook, width: 4 }, level: 0, pointLevels: streamLevels(brook, 0.4), flow: 0.6, note: "Valley brook crossed by the national road's stone bridge and turning the holding's mill." },
  { id: "kv-mill-pond", kind: "pond", shape: { kind: "area", points: [[-86, 127], [-70, 126], [-66, 134], [-82, 137]] }, level: round2(natural.height(-76, 131) + 0.3), flow: 0, note: "Mill pond held behind a timber weir." },
  { id: "kv-court-cistern", kind: "cistern", shape: { kind: "area", points: [[-5.5, -18.2], [-3.5, -18.2], [-3.5, -16.6], [-5.5, -16.6]] }, level: 9.1, flow: 0, note: "Rain cistern of the Banner Court, its lid of black stone." },
];

const terrain: TerrainModel = {
  extents: { minX: -200, maxX: 200, minZ: -170, maxZ: 170 },
  baseElevation: 0,
  baseSurface: "heath",
  features,
  water,
  surfaces: [
    { id: "kv-banner-court-paving", surface: "paving", shape: { kind: "rect", center: [-2, -17], width: 30, depth: 11 } },
    { id: "kv-muster-yard", surface: "earth", shape: { kind: "rect", center: [-30, 3], width: 42, depth: 20 } },
    { id: "kv-lower-town-cobble", surface: "cobble", shape: { kind: "polygon", points: [[-8, 15.8], [20, 18.3], [46, 23.6], [56, 25.6], [56, 30], [46, 28.4], [20, 22.7], [-8, 20.2]] } },
    { id: "kv-west-fields", surface: "field", shape: { kind: "polygon", points: [[-84, 34], [-186, 8], [-196, 60], [-104, 86]] } },
    { id: "kv-valley-meadow", surface: "meadow", shape: { kind: "polygon", points: [[40, 120], [-200, 96], [-200, 170], [40, 170]] } },
  ],
  logic:
    "South flank of a basalt scarp. The land falls 8.5% to the south and 3% to the east into a 13 m ravine; a rock spur carries the Banner Court at +9 m and the Record shelf at +6.5 m beneath crag ribs that climb to a wooded crest (≈ +28 m, 125 m north), low enough that the hall and keep break the skyline from the valley. The Muster Terrace is cut and filled level at 0 m below the court's 9 m retaining wall; the lower town steps from −1 m to −5 m toward the ravine; the valley brook runs ≈ 14 m below the datum.",
};

const T = createTerrainSampler(terrain);
const G = groundTools(T);

// --- Materials (TECHNICAL_SPEC.md material library) ---------------------------

const ASHLAR = "kv-basalt-ashlar";
const RUBBLE = "kv-basalt-rubble";
const FRAME = "kv-oak-frame-plaster";
const SLATE = "kv-slate";
const LEAD = "kv-lead";
const SHINGLE = "kv-shingle";
const THATCH = "kv-thatch-dark";
const TIMBER = "kv-timber-raw";
const MARBLE = "kv-black-marble";

// --- Circulation ------------------------------------------------------------------

const route = (r: Omit<Route, "grade" | "covered" | "outer"> & Partial<Pick<Route, "grade" | "covered" | "outer">>): Route => ({
  grade: "ground",
  covered: false,
  outer: false,
  ...r,
});

const LANTERN = route({
  id: "kv-lantern-street",
  name: "Lantern Street",
  kind: "street",
  hierarchy: "secondary",
  points: [[-8, 18], [6, 19], [20, 20.5], [34, 22.5], [46, 26], [55, 28]],
  width: 3.6,
  surface: "cobble",
  users: ["residents", "carts", "messengers"],
});
const ROCK_LANE = route({
  id: "kv-rock-lane",
  name: "Rock Lane",
  kind: "lane",
  hierarchy: "pedestrian",
  points: [[37, -6.6], [24, -5.6], [12, -5], [0, -4.6], [-7.4, -4.3]],
  width: 2.4,
  surface: "cobble",
  users: ["residents"],
});
const WALL_LANE = route({
  id: "kv-wall-lane",
  name: "Wall Lane",
  kind: "lane",
  hierarchy: "pedestrian",
  points: [[-28, 41], [-10, 41.2], [8, 41.3], [26, 41], [44, 40]],
  width: 2.4,
  surface: "packed-earth",
  users: ["residents", "carts"],
});

const routes: Route[] = [
  route({
    id: "kv-national-road",
    name: "The road to the capital",
    kind: "road",
    hierarchy: "national",
    points: [[-58.5, 17], [-66, 18], [-84, 28], [-104, 52], [-124, 84], [-140, 112], [-150, 128], [-176, 140], [-240, 148], [-420, 150], [-900, 80], [-2000, -320], [-6000, -3400]],
    width: 6,
    surface: "setts",
    users: ["merchants", "messengers", "carts", "soldiers", "nobility"],
    outer: true,
  }),
  route({ id: "kv-gate-street", name: "Gate Street", kind: "street", hierarchy: "primary", points: [[-58, 17.2], [-50, 17.4], [-34, 17.4], [-20, 17.6], [-8, 18]], width: 4.6, surface: "setts", users: ["merchants", "messengers", "carts", "soldiers", "residents"] }),
  LANTERN,
  ROCK_LANE,
  WALL_LANE,
  route({ id: "kv-muster-walk", name: "Muster Walk", kind: "path", hierarchy: "pedestrian", points: [[-34, 17.4], [-34, -9.7]], width: 3, surface: "packed-earth", users: ["soldiers", "residents"] }),
  route({ id: "kv-muster-yard", name: "Yard Path", kind: "path", hierarchy: "pedestrian", points: [[-34, 12], [-9.5, 12]], width: 2.4, surface: "packed-earth", users: ["soldiers"] }),
  route({
    id: "kv-muster-stair",
    name: "The Muster Stair",
    kind: "stair",
    hierarchy: "pedestrian",
    points: [[-34, -9.7], [-15, -9.7], [-11, -9.7], [-11, -12.4]],
    width: 3,
    surface: "flagstone",
    grade: "elevated",
    deckY: [0, 9, 9, 9],
    users: ["soldiers", "nobility", "messengers"],
  }),
  route({ id: "kv-banner-court-way", name: "Banner Court", kind: "path", hierarchy: "pedestrian", points: [[-11, -12.4], [-11, -18.5], [0, -20.2], [0, -22]], width: 4, surface: "flagstone", users: ["nobility", "soldiers", "messengers"] }),
  route({ id: "kv-court-walk", name: "Court Walk", kind: "path", hierarchy: "pedestrian", points: [[0, -20.2], [10.5, -21], [18.5, -21]], width: 3, surface: "flagstone", users: ["nobility", "residents"] }),
  route({ id: "kv-masons-yard", name: "Masons' Yard", kind: "path", hierarchy: "service", points: [[-11, -18.5], [-17, -20.6], [-21, -22.4]], width: 2.6, surface: "packed-earth", users: ["workers"] }),
  route({ id: "kv-kitchen-passage", name: "Kitchen Passage", kind: "alley", hierarchy: "service", points: [[10.5, -21], [10.5, -48], [16.5, -48.6]], width: 2, surface: "flagstone", users: ["residents"] }),
  route({ id: "kv-record-stair", name: "Record Stair", kind: "stair", hierarchy: "pedestrian", points: [[18.5, -21], [25.5, -21]], width: 3, surface: "flagstone", users: ["nobility", "residents"] }),
  route({ id: "kv-record-yard", name: "Record Yard", kind: "path", hierarchy: "pedestrian", points: [[25.5, -21], [32, -21], [32, -26.6]], width: 3, surface: "flagstone", users: ["nobility", "residents"] }),
  route({ id: "kv-record-steps", name: "Record Steps", kind: "stair", hierarchy: "pedestrian", points: [[32, -21], [32, -13], [37, -6.6]], width: 2.4, surface: "flagstone", users: ["residents"] }),
  route({ id: "kv-levy-lane", name: "Levy Lane", kind: "lane", hierarchy: "pedestrian", points: [[-7.4, -4.3], [-7.4, 11], [-7.6, 18]], width: 2, surface: "cobble", users: ["soldiers", "residents"] }),
  route({ id: "kv-well-steps-north", name: "Well Steps", kind: "stair", hierarchy: "pedestrian", points: [[18.8, 18.6], [18.8, 6], [18.8, -5.3]], width: 2.2, surface: "cobble", users: ["residents"] }),
  route({ id: "kv-well-steps-south", name: "Well Steps (south)", kind: "stair", hierarchy: "pedestrian", points: [[14.6, 22.2], [14.6, 32], [14.6, 41.2]], width: 2.2, surface: "cobble", users: ["residents"] }),
  route({ id: "kv-coopers-row", name: "Cooper's Row", kind: "lane", hierarchy: "pedestrian", points: [[48.6, 27.4], [47.8, 34], [44, 40]], width: 2.2, surface: "cobble", users: ["residents", "carts"] }),
  route({ id: "kv-forge-lane", name: "Forge Lane", kind: "lane", hierarchy: "secondary", points: [[-30, 17.4], [-30, 32], [-28, 41]], width: 3, surface: "packed-earth", users: ["carts", "residents"] }),
  route({ id: "kv-herald-yard", name: "Herald's Yard", kind: "lane", hierarchy: "secondary", points: [[-51, 17.4], [-51, 11], [-51, 6.9]], width: 3, surface: "cobble", users: ["messengers"] }),
  route({ id: "kv-washing-path", name: "Washing Path", kind: "path", hierarchy: "pedestrian", points: [[55, 28], [64, 26], [75, 22]], width: 1.8, surface: "packed-earth", users: ["residents"] }),
  route({ id: "kv-field-track", name: "Field Track", kind: "track", hierarchy: "service", points: [[-84, 28], [-110, 18], [-140, 10], [-175, 2]], width: 3, surface: "packed-earth", users: ["carts", "workers"], outer: true }),
  route({ id: "kv-mill-track", name: "Mill Track", kind: "track", hierarchy: "service", points: [[-140, 112], [-118, 132], [-100, 137]], width: 2.6, surface: "packed-earth", users: ["carts", "workers"], outer: true }),
];

const destinations: BannerholdBlueprint["destinations"] = [
  { id: "gate", label: "West Gate", position: [-58.5, 17] },
  { id: "manor", label: "Banner Hall porch", position: [0, -22] },
  { id: "muster", label: "Muster Grounds", position: [-24, 6] },
  { id: "residential", label: "Well Square, Lantern Street", position: [16.5, 23.5] },
  { id: "artisan", label: "Forge Lane", position: [-30, 26] },
  { id: "archive", label: "War Record door", position: [32, -27] },
  { id: "herald", label: "Herald's Station door", position: [-51, 6.5] },
  { id: "ceremonial", label: "Honour Court", position: [7, -17] },
];

// --- Architecture ---------------------------------------------------------------

const civic: Building[] = [
  // A — Central Manor and Banner Hall (Banner Court, +9 m)
  building({
    id: "kv-banner-hall",
    name: "The Banner Hall",
    district: "A",
    fn: "banner-hall",
    tradition: "kv-ashlar-gothic",
    masses: [
      mass({ id: "hall", role: "hall", at: [0, -38], w: 13, d: 26, storeys: 2, eave: 11, ridge: 22, roof: "steep-gable", axis: "z", roofMat: LEAD, wallMat: ASHLAR }),
      mass({ id: "porch", role: "porch", at: [0, -23.5], w: 6.6, d: 3, storeys: 1, eave: 5.8, ridge: 9.4, roof: "steep-gable", axis: "z", roofMat: LEAD, wallMat: MARBLE }),
      mass({ id: "keep", role: "keep", at: [-11, -47], w: 8.5, d: 8.5, storeys: 6, eave: 23, ridge: 34, roof: "spire", roofMat: LEAD, wallMat: ASHLAR }),
      mass({ id: "turret", role: "stair-tower", at: [7.8, -26.6], w: 3.2, d: 3.2, plan: "round", storeys: 4, eave: 15, ridge: 19.5, roof: "conical", roofMat: SLATE, wallMat: ASHLAR }),
      mass({ id: "fleche", role: "tower", at: [0, -36], w: 1.8, d: 1.8, storeys: 1, eave: 2, ridge: 8.5, roof: "spire", roofMat: LEAD, wallMat: LEAD, baseOffset: 19.6 }),
    ],
    door: [0, -22],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.6, maxRelief: 1.5 },
    era: "predecessor",
    built: 140,
    condition: "worn",
    repairs: [
      { kind: "rebuilt-courses", note: "Keep parapet rebuilt in paler limestone after the earlier conflict; the seam runs level all round.", mass: "keep" },
      { kind: "patched-roof", note: "New lead sheets on the hall's west slope, brighter than the dulled east slope.", mass: "hall" },
      { kind: "boarded-opening", note: "Two gallery lancets boarded: the hall is larger than the new house can heat.", mass: "hall" },
    ],
    quality: "noble",
    social: "lord",
    lod: "hero",
    kit: "kv.manor.banner-hall",
    landmark: "banner-hall",
    tags: ["banner-mount", "emblem", "lancet-windows", "buttresses", "braziers", "chimney", "veiled-standard", "bell", "fleche", "lead-roof", "black-marble-porch"],
    story: "Raised by the house that held the scarp before this banner: the only lead roof and the only black marble in the holding, too grand for its new family, two gallery lancets shuttered, its standard new.",
  }),
  building({
    id: "kv-lodging",
    name: "The Lodging",
    district: "A",
    fn: "manor-house",
    tradition: "kv-ashlar-gothic",
    masses: [
      mass({ id: "range", role: "wing", at: [16.5, -36], w: 9, d: 22, storeys: 3, eave: 10.5, ridge: 16.5, roof: "steep-gable", axis: "z", roofMat: SLATE, wallMat: ASHLAR }),
      mass({ id: "chimney", role: "chimney", at: [21.4, -41], w: 1.4, d: 2.2, storeys: 1, eave: 18.5, ridge: 19, roof: "flat", roofMat: SLATE, wallMat: RUBBLE }),
      mass({ id: "oriel", role: "annex", at: [11.5, -31], w: 1.2, d: 3.2, storeys: 1, eave: 8, ridge: 9.5, roof: "conical", roofMat: LEAD, wallMat: ASHLAR, baseOffset: 3.5 }),
    ],
    door: [12, -28],
    facing: 270,
    foundation: { kind: "plinth", plinth: 0.45, maxRelief: 1.5 },
    era: "predecessor",
    built: 120,
    condition: "sound",
    repairs: [{ kind: "lime-wash", note: "Court face freshly lime-washed for the founding.", mass: "range" }],
    quality: "fine",
    social: "lord",
    lod: "hero",
    kit: "kv.manor.lodging",
    tags: ["chimney", "smoke", "oriel", "shutters", "heraldic-shield"],
    story: "Where the household actually lives: warmer and smaller than the hall it serves, its oriel looking down on the court.",
    overlap: ["kv-war-record"],
  }),
  building({
    id: "kv-kitchen",
    name: "Kitchen and Service Range",
    district: "A",
    fn: "kitchen",
    tradition: "kv-rubble-jettied",
    masses: [
      mass({ id: "range", role: "wing", at: [16.5, -52.5], w: 12, d: 6, storeys: 2, eave: 6, ridge: 10, roof: "gable", axis: "x", roofMat: SLATE, wallMat: RUBBLE }),
      mass({ id: "flue", role: "chimney", at: [12, -52.5], w: 2, d: 2, storeys: 1, eave: 12.5, ridge: 13, roof: "flat", roofMat: SLATE, wallMat: RUBBLE }),
    ],
    door: [16.5, -49.5],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.3, maxRelief: 1.5 },
    era: "predecessor",
    built: 110,
    condition: "weathered",
    repairs: [{ kind: "re-shingled", note: "East half re-roofed in cheap shingle instead of slate.", mass: "range" }],
    quality: "common",
    social: "retainer",
    kit: "kv.service.kitchen",
    tags: ["chimney", "smoke", "woodpile", "water-jars"],
    story: "The busiest building on the rock; its smoke is the first sign of life seen from the valley.",
  }),
  building({
    id: "kv-west-range",
    name: "West Range (unfinished)",
    district: "A",
    fn: "lodging",
    tradition: "kv-ashlar-gothic",
    masses: [
      mass({ id: "walls", role: "wing", at: [-21, -31], w: 8, d: 16, storeys: 1, eave: 4.2, ridge: 4.2, roof: "open-frame", axis: "z", roofMat: TIMBER, wallMat: ASHLAR }),
      mass({ id: "scaffold", role: "scaffold", at: [-25.8, -31], w: 1.6, d: 16, storeys: 2, eave: 7.2, ridge: 7.2, roof: "open-frame", axis: "z", roofMat: TIMBER, wallMat: TIMBER }),
    ],
    door: [-21, -23],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.45, maxRelief: 1.5 },
    era: "under-construction",
    built: 0,
    condition: "under-construction",
    quality: "fine",
    social: "lord",
    lod: "hero",
    kit: "kv.manor.west-range",
    tags: ["scaffold", "treadwheel-crane", "stone-pile", "dressed-blocks", "rope"],
    story: "Ground-floor walls stand to 4 m beside an idle crane: the banner's ambition, raised one recognition at a time.",
    unfinished: { stage: "walls", completesAtHallTier: 1, scaffold: true },
  }),
  building({
    id: "kv-court-gatehouse",
    name: "Court Gate",
    district: "A",
    fn: "gatehouse",
    tradition: "kv-ashlar-gothic",
    masses: [mass({ id: "gate", role: "gatehouse", at: [-11, -14.25], w: 6, d: 4.5, storeys: 2, eave: 8, ridge: 13.5, roof: "pyramid", roofMat: SLATE, wallMat: ASHLAR })],
    door: [-11, -12],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.2, maxRelief: 1.5 },
    era: "predecessor",
    built: 140,
    condition: "worn",
    repairs: [{ kind: "replaced-gate", note: "New iron-bound oak leaves hung at the founding.", mass: "gate" }],
    quality: "fine",
    social: "martial",
    kit: "kv.fort.court-gate",
    tags: ["banner-mount", "lantern", "portcullis-slot"],
    story: "The only formal way from the levy's yard to the lord's court is up the Muster Stair and through this gate.",
    overlap: ["kv-banner-court-way", "kv-muster-stair", "kv-court-parapet-west", "kv-court-parapet-east"],
  }),
  // F — War Record (Record shelf, +6.5 m), joined to the Lodging by a gallery bridge
  building({
    id: "kv-war-record",
    name: "The War Record",
    district: "F",
    fn: "archive",
    tradition: "kv-ashlar-gothic",
    masses: [
      mass({ id: "house", role: "hall", at: [32, -36], w: 10, d: 18, storeys: 2, eave: 9.5, ridge: 17, roof: "steep-gable", axis: "z", roofMat: SLATE, wallMat: ASHLAR }),
      mass({ id: "record-tower", role: "tower", at: [38.75, -29.75], w: 5.5, d: 5.5, storeys: 4, eave: 16, ridge: 24, roof: "spire", roofMat: LEAD, wallMat: ASHLAR }),
      mass({ id: "gallery", role: "gallery", at: [24, -38], w: 6, d: 3, storeys: 1, eave: 3, ridge: 4.6, roof: "gable", axis: "x", roofMat: SLATE, wallMat: FRAME, baseOffset: 6 }),
    ],
    door: [32, -27],
    facing: 180,
    foundation: { kind: "undercroft", plinth: 0.4, maxRelief: 3 },
    era: "predecessor",
    built: 95,
    condition: "weathered",
    repairs: [
      { kind: "new-lintel", note: "Door lintel replaced in raw oak after rot; not yet carved.", mass: "house" },
      { kind: "iron-strapping", note: "Record tower bound with iron bands where frost split the quoins.", mass: "record-tower" },
    ],
    quality: "fine",
    social: "civic",
    lod: "hero",
    kit: "kv.record.archive",
    landmark: "war-record",
    tags: ["war-table", "ledgers", "candle-light", "tracery-window", "lancet-windows"],
    story: "The previous house's records fill the lower shelves; the banner's own War Record begins on the top shelf, mostly empty.",
    overlap: ["kv-lodging"],
  }),
  building({
    id: "kv-record-gallery",
    name: "Record Gallery (development)",
    district: "F",
    fn: "archive",
    tradition: "kv-ashlar-gothic",
    masses: [mass({ id: "gallery", role: "wing", at: [32, -51], w: 9, d: 7, storeys: 2, eave: 8, ridge: 13, roof: "steep-gable", axis: "x", roofMat: SLATE, wallMat: ASHLAR })],
    door: [32, -47.5],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.4, maxRelief: 1.5 },
    era: "recent",
    built: 0,
    condition: "new",
    quality: "fine",
    social: "civic",
    kit: "kv.record.gallery",
    tags: ["banner-mount", "honour-wall"],
    story: "Appears only when recognition reaches hall tier 2: a gallery for honours and returned standards.",
    tier: 2,
  }),
];

const yards: Building[] = [
  // B — Muster Grounds (terrace, 0 m)
  building({
    id: "kv-muster-dais",
    name: "Muster Dais",
    district: "B",
    fn: "muster-platform",
    tradition: "kv-ashlar-gothic",
    masses: [mass({ id: "dais", role: "platform", at: [-22, -5.7], w: 16, d: 3.4, storeys: 1, eave: 1.1, ridge: 1.1, roof: "none", axis: "x", roofMat: ASHLAR, wallMat: ASHLAR })],
    door: [-22, -4],
    facing: 180,
    foundation: { kind: "flush", plinth: 0, maxRelief: 0.5 },
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "salvaged-stone", note: "Steps cut from the previous house's fallen north tower.", mass: "dais" }],
    quality: "common",
    social: "martial",
    lod: "hero",
    kit: "kv.muster.dais",
    landmark: "muster-grounds",
    tags: ["banner-mount", "file-markers", "standard-posts"],
    story: "Where the levy is named before the National Muster, under the Muster Stair and the hall above it. The eight file posts belong to the formation, not the house.",
  }),
  building({
    id: "kv-armoury",
    name: "Armoury and Weapon Store",
    district: "B",
    fn: "armoury",
    tradition: "kv-rubble-jettied",
    masses: [mass({ id: "store", role: "house", at: [-43.5, -1.5], w: 5.5, d: 9, storeys: 1, eave: 4, ridge: 8.5, roof: "steep-gable", axis: "z", roofMat: SLATE, wallMat: RUBBLE })],
    door: [-40.75, -1.5],
    facing: 90,
    foundation: { kind: "plinth", plinth: 0.25, maxRelief: 1.5 },
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "iron-strapping", note: "Door strapped with iron from melted-down old arms.", mass: "store" }],
    quality: "common",
    social: "martial",
    kit: "kv.muster.armoury",
    tags: ["weapon-rack", "shields", "lantern"],
    story: "More empty racks than spears: the house arms the few it can.",
  }),
  building({
    id: "kv-levy-hall",
    name: "Levy Hall",
    district: "B",
    fn: "barracks",
    tradition: "kv-rubble-jettied",
    masses: [mass({ id: "hall", role: "house", at: [-44, 8.4], w: 6, d: 9, storeys: 2, eave: 5.5, ridge: 9.5, roof: "steep-gable", axis: "z", roofMat: SHINGLE, wallMat: FRAME })],
    door: [-41, 8.4],
    facing: 90,
    era: "founding",
    built: 2,
    condition: "worn",
    repairs: [{ kind: "spliced-post", note: "Corner post spliced where a cart struck it.", mass: "hall" }],
    quality: "poor",
    social: "martial",
    kit: "kv.muster.levy-hall",
    tags: ["infirmary-awning", "cooking-fire", "laundry"],
    story: "Humble timber under the court's corner tower: the levy sleeps beside the Herald's Station, within sight of the West Gate it would hold.",
  }),
  // E — Herald's Station and Main Gate (west)
  building({
    id: "kv-herald-station",
    name: "Herald's Station",
    district: "E",
    fn: "herald-station",
    tradition: "kv-ashlar-gothic",
    masses: [
      mass({ id: "tower", role: "tower", at: [-51, -2.5], w: 6, d: 6, storeys: 4, eave: 13, ridge: 18.5, roof: "pyramid", roofMat: SLATE, wallMat: ASHLAR }),
      mass({ id: "post-room", role: "house", at: [-51, 4.2], w: 5.6, d: 5.2, storeys: 2, eave: 6.5, ridge: 10.5, roof: "steep-gable", axis: "x", roofMat: SLATE, wallMat: FRAME }),
    ],
    door: [-51, 6.8],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.3, maxRelief: 2 },
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "new-timber", note: "Raven loft on the tower top rebuilt in new timber.", mass: "tower" }],
    quality: "common",
    social: "civic",
    lod: "hero",
    kit: "kv.herald.station",
    landmark: "heralds-station",
    tags: ["notice-board", "raven-loft", "signal-horn", "banner-mount", "lantern"],
    story: "Summons, challenges and the Grand Duchy's notices arrive here first; the ravens on the loft roof belong to the Duchy's riders, not to the house.",
  }),
  building({
    id: "kv-main-gatehouse",
    name: "West Gate",
    district: "E",
    fn: "gatehouse",
    tradition: "kv-ashlar-gothic",
    masses: [
      mass({ id: "passage", role: "gatehouse", at: [-58.3, 17], w: 8, d: 6.5, storeys: 2, eave: 8, ridge: 12, roof: "hip", axis: "z", roofMat: SLATE, wallMat: ASHLAR }),
      mass({ id: "tower-north", role: "tower", at: [-58.3, 12.2], w: 4.6, d: 4.6, plan: "round", storeys: 3, eave: 10.5, ridge: 15.5, roof: "conical", roofMat: SLATE, wallMat: ASHLAR }),
      mass({ id: "tower-south", role: "tower", at: [-58.3, 21.8], w: 4.6, d: 4.6, plan: "round", storeys: 3, eave: 10.5, ridge: 15.5, roof: "conical", roofMat: SLATE, wallMat: ASHLAR }),
    ],
    door: [-62.3, 17],
    facing: 270,
    foundation: { kind: "plinth", plinth: 0.2, maxRelief: 1.8 },
    era: "predecessor",
    built: 130,
    condition: "worn",
    repairs: [{ kind: "replaced-gate", note: "Gate leaves replaced; the old ones burned in the earlier conflict.", mass: "passage" }],
    quality: "fine",
    social: "martial",
    lod: "hero",
    kit: "kv.fort.gatehouse",
    tags: ["banner-mount", "portcullis", "lanterns", "toll-board"],
    story: "The road to the capital passes beneath the banner's shield here; travellers read the house before they meet it.",
    overlap: ["kv-town-wall", "kv-gate-street", "kv-national-road"],
  }),
  building({
    id: "kv-post-stable",
    name: "Post Stable",
    district: "E",
    fn: "stable",
    tradition: "kv-rubble-jettied",
    masses: [mass({ id: "stable", role: "shed", at: [-51, 27], w: 6, d: 9, storeys: 1, eave: 3.5, ridge: 7, roof: "gable", axis: "z", roofMat: SHINGLE, wallMat: TIMBER })],
    door: [-51, 22.5],
    facing: 0,
    era: "founding",
    built: 2,
    condition: "sound",
    quality: "common",
    social: "labourer",
    kit: "kv.service.stable",
    tags: ["hay", "trough", "beast-tether"],
    story: "Fresh horses for the Grand Duchy's riders, kept by obligation rather than choice.",
  }),
  // D — Artisan and Supply Quarter (south of Gate Street, inside the West Gate)
  building({
    id: "kv-smithy",
    name: "Smithy",
    district: "D",
    fn: "forge",
    tradition: "kv-rubble-jettied",
    masses: [
      mass({ id: "shop", role: "house", at: [-38, 26], w: 9, d: 7, storeys: 1, eave: 4.5, ridge: 9, roof: "steep-gable", axis: "x", roofMat: SLATE, wallMat: RUBBLE }),
      mass({ id: "forge-front", role: "canopy", at: [-32.6, 26], w: 1.8, d: 7, storeys: 1, eave: 2.8, ridge: 3.6, roof: "lean-to", axis: "z", roofMat: SHINGLE, wallMat: TIMBER }),
      mass({ id: "chimney", role: "chimney", at: [-41, 23.6], w: 1.8, d: 1.8, storeys: 1, eave: 11, ridge: 11.5, roof: "flat", roofMat: SLATE, wallMat: RUBBLE }),
    ],
    door: [-33.5, 26],
    facing: 90,
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "patched-roof", note: "Scorched shingles over the forge replaced in a lighter patch.", mass: "forge-front" }],
    quality: "common",
    social: "artisan",
    lod: "hero",
    kit: "kv.artisan.smithy",
    tags: ["chimney", "smoke", "forge-glow", "anvil", "quench-trough", "charcoal"],
    story: "The loudest building in the holding; its glow is visible from the West Gate at every hour under the eclipse.",
  }),
  building({
    id: "kv-workshop",
    name: "Cooper and Carpenter's Workshop",
    district: "D",
    fn: "workshop",
    tradition: "kv-rubble-jettied",
    masses: [mass({ id: "shop", role: "house", at: [-23, 25], w: 8, d: 6, storeys: 2, eave: 5.5, ridge: 9.5, roof: "steep-gable", axis: "x", roofMat: SHINGLE, wallMat: FRAME })],
    door: [-27, 25],
    facing: 270,
    era: "founding",
    built: 2,
    condition: "sound",
    quality: "common",
    social: "artisan",
    kit: "kv.artisan.workshop",
    tags: ["barrels", "woodpile", "sawhorse", "shavings"],
    story: "Staves for the granary and scaffold poles for the unfinished West Range.",
  }),
  building({
    id: "kv-granary",
    name: "Tithe Granary",
    district: "D",
    fn: "granary",
    tradition: "kv-rubble-jettied",
    masses: [mass({ id: "store", role: "silo", at: [-38, 37.5], w: 8, d: 10, storeys: 2, eave: 6.5, ridge: 12, roof: "steep-gable", axis: "z", roofMat: SHINGLE, wallMat: FRAME })],
    door: [-34, 37.5],
    facing: 90,
    foundation: { kind: "stilts", plinth: 0.9, maxRelief: 2.2 },
    era: "predecessor",
    built: 80,
    condition: "weathered",
    repairs: [{ kind: "new-timber", note: "Three staddle stones and a sill beam renewed in pale oak.", mass: "store" }],
    quality: "common",
    social: "labourer",
    kit: "kv.artisan.granary",
    tags: ["staddle-stones", "loading-hoist", "sacks", "cart"],
    story: "A third of every harvest goes up the road to the capital; the hoist beam is worn smooth.",
  }),
  building({
    id: "kv-tithe-barn",
    name: "Tithe Barn",
    district: "D",
    fn: "storehouse",
    tradition: "kv-rubble-jettied",
    masses: [mass({ id: "barn", role: "shed", at: [-21, 35.5], w: 10, d: 7, storeys: 1, eave: 4, ridge: 8.5, roof: "half-hip", axis: "x", roofMat: THATCH, wallMat: RUBBLE })],
    door: [-26, 35.5],
    facing: 270,
    era: "predecessor",
    built: 90,
    condition: "weathered",
    repairs: [{ kind: "re-thatched", note: "North slope re-thatched; the south slope is moss-dark and sagging.", mass: "barn" }],
    quality: "common",
    social: "labourer",
    kit: "kv.artisan.barn",
    tags: ["hay", "cart", "sacks"],
    story: "Older than the banner; the previous house's mark is still cut above the door.",
  }),
];

// C — Residential Quarter: continuous frontage on Lantern Street (gables to the street), lean-to
// houses under the rock on Rock Lane and the poorest cottages on Wall Lane by the south wall.

interface LotHouse {
  id: string;
  name: string;
  at: FrontagePlacement;
  w: number;
  d: number;
  storeys: number;
  eave: number;
  ridge: number;
  roof: Building["masses"][number]["roof"]["form"];
  axis?: "x" | "z";
  roofMat: string;
  wallMat: string;
  tradition: string;
  fn?: Building["function"];
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
  /** Extra volumes placed relative to the house (local x right, z toward the street). */
  annexes?: (at: FrontagePlacement) => Building["masses"];
}

function lotHouse(h: LotHouse): Building {
  const main = mass({ id: "house", role: "house", at: h.at.center, w: h.w, d: h.d, rot: h.at.rot, storeys: h.storeys, eave: h.eave, ridge: h.ridge, roof: h.roof, axis: h.axis ?? "z", roofMat: h.roofMat, wallMat: h.wallMat });
  return building({
    id: h.id,
    name: h.name,
    district: "C",
    fn: h.fn ?? "house",
    tradition: h.tradition,
    masses: [main].concat(h.annexes ? h.annexes(h.at) : []),
    door: h.at.door,
    facing: h.at.facingBearingDeg,
    foundation: { kind: "plinth", plinth: 0.35, maxRelief: 2 },
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

const north = (s: number, depth: number): FrontagePlacement => onStreet(LANTERN, s, "left", depth, 0.4);
const south = (s: number, depth: number): FrontagePlacement => onStreet(LANTERN, s, "right", depth, 0.4);
const underRock = (s: number, depth: number): FrontagePlacement => onStreet(ROCK_LANE, s, "right", depth, 0.2);
const byWall = (s: number, depth: number): FrontagePlacement => onStreet(WALL_LANE, s, "left", depth, 0.3);

const JETTY = "kv-rubble-jettied";
const GOTHIC = "kv-ashlar-gothic";
const COTTAGE = "kv-cottage";

const houses: Building[] = [
  lotHouse({
    id: "kv-reeve-house", name: "Reeve's House", at: north(6.5, 10), w: 9, d: 10, storeys: 3, eave: 9, ridge: 14.5, roof: "half-hip", axis: "x", roofMat: SLATE, wallMat: ASHLAR, tradition: GOTHIC,
    era: "predecessor", built: 100, condition: "sound", repairs: [{ kind: "fresh-render", note: "Street face re-rendered and the house mark repainted in the banner's colours.", mass: "house" }],
    quality: "fine", social: "retainer", lod: "hero", kit: "kv.house.reeve", tags: ["chimney", "heraldic-shield", "shutters", "stair-turret"],
    story: "The finest house below the rock, kept by the reeve who served the previous house and now serves this one.",
    annexes: (at) => [mass({ id: "turret", role: "stair-tower", at: local(at.center, at.rot, 3.1, -5.8), w: 2.6, d: 2.6, plan: "round", storeys: 4, eave: 11, ridge: 14, roof: "conical", roofMat: SLATE, wallMat: ASHLAR })],
  }),
  lotHouse({
    id: "kv-tall-house", name: "Tall House", at: north(14.5, 10), w: 6, d: 10, storeys: 3, eave: 8.5, ridge: 14, roof: "steep-gable", roofMat: SLATE, wallMat: FRAME, tradition: JETTY,
    era: "predecessor", built: 85, condition: "worn", repairs: [{ kind: "new-timber", note: "One jetty bracket replaced in raw oak.", mass: "house" }],
    quality: "common", social: "retainer", kit: "kv.house.jettied-tall", tags: ["chimney", "jetty", "window-box", "laundry"],
    story: "A retainer's family house, gable to Lantern Street, three storeys on a lot six metres wide.",
  }),
  lotHouse({
    id: "kv-lamplighter-house", name: "Lamplighter's House", at: north(20.75, 9.5), w: 6.5, d: 9.5, storeys: 3, eave: 8.8, ridge: 14.8, roof: "steep-gable", roofMat: SLATE, wallMat: FRAME, tradition: JETTY,
    era: "predecessor", built: 90, condition: "worn", repairs: [{ kind: "patched-roof", note: "A square of new slate where fire once dropped through.", mass: "house" }],
    quality: "common", social: "commoner", kit: "kv.house.jettied-tall", tags: ["chimney", "street-lantern", "jetty"],
    story: "Keeps the lanterns that give the street its name; the Well Steps climb past her door to Rock Lane.",
  }),
  lotHouse({
    id: "kv-narrow-house", name: "Narrow House", at: north(31, 9), w: 5.5, d: 9, storeys: 2, eave: 6, ridge: 10.5, roof: "steep-gable", roofMat: SHINGLE, wallMat: FRAME, tradition: JETTY,
    era: "founding", built: 2, condition: "sound",
    quality: "common", social: "commoner", kit: "kv.house.jettied-small", tags: ["chimney", "window-box", "pale-timber"],
    story: "Built at the founding on a plot left empty since the earlier conflict; its timbers are still pale.",
  }),
  lotHouse({
    id: "kv-pewterer-house", name: "Pewterer's House", at: north(38.5, 10), w: 6, d: 10, storeys: 3, eave: 9.2, ridge: 15.4, roof: "steep-gable", roofMat: SLATE, wallMat: FRAME, tradition: JETTY,
    era: "predecessor", built: 75, condition: "worn",
    quality: "common", social: "artisan", kit: "kv.house.jettied-tall", tags: ["chimney", "shop-front", "jetty"],
    story: "A shop window on the ground floor; pewter for the Banner Hall's table is mended here, rarely made new.",
    annexes: (at) => [mass({ id: "rear", role: "lean-to", at: local(at.center, at.rot, 0, -6.5), w: 4.4, d: 3, storeys: 1, eave: 2.6, ridge: 3.8, roof: "lean-to", axis: "x", roofMat: SHINGLE, wallMat: TIMBER })],
  }),
  lotHouse({
    id: "kv-brewer-house", name: "Brewer's House", at: north(45.5, 9), w: 7, d: 9, storeys: 2, eave: 7, ridge: 12, roof: "half-hip", roofMat: SLATE, wallMat: FRAME, tradition: JETTY,
    era: "predecessor", built: 70, condition: "worn", repairs: [{ kind: "spliced-post", note: "Brew-shed posts spliced and propped.", mass: "brew-shed" }],
    quality: "common", social: "artisan", kit: "kv.house.half-hip", tags: ["chimney", "barrels", "smoke"],
    story: "Brews for the levy hall; the brew-shed behind smokes every morning.",
    annexes: (at) => [mass({ id: "brew-shed", role: "lean-to", at: local(at.center, at.rot, 0, -6.6), w: 5, d: 4.2, storeys: 1, eave: 2.6, ridge: 4, roof: "lean-to", axis: "x", roofMat: SHINGLE, wallMat: TIMBER })],
  }),
  lotHouse({
    id: "kv-corner-house", name: "House at the Bend", at: north(52.5, 10), w: 7, d: 10, storeys: 3, eave: 9, ridge: 14.5, roof: "steep-gable", roofMat: SLATE, wallMat: FRAME, tradition: JETTY,
    era: "predecessor", built: 110, condition: "weathered", repairs: [{ kind: "buttress", note: "Raking shore against the leaning east wall.", mass: "house" }],
    quality: "common", social: "commoner", kit: "kv.house.jettied-tall", tags: ["chimney", "shores", "jetty"],
    story: "Leans toward the ravine a little more each decade; the shore was cut from a beam of the old mill.",
  }),
  lotHouse({
    id: "kv-weavers-tenement", name: "Weavers' Tenement", at: south(5, 10), w: 8, d: 10, storeys: 4, eave: 11, ridge: 16, roof: "steep-gable", roofMat: SLATE, wallMat: FRAME, tradition: JETTY, fn: "tenement",
    era: "predecessor", built: 95, condition: "worn", repairs: [{ kind: "buttress", note: "Raking timber shores against the leaning gable.", mass: "house" }],
    quality: "common", social: "commoner", kit: "kv.house.tenement", tags: ["fabric-drying", "laundry", "shores", "window-box"],
    story: "Four storeys of weaving families; dyed cloth hangs across the street from the upper windows.",
  }),
  lotHouse({
    id: "kv-chandler-house", name: "Chandler's House", at: south(12, 9), w: 5.8, d: 9, storeys: 3, eave: 8, ridge: 13.5, roof: "steep-gable", roofMat: SLATE, wallMat: FRAME, tradition: JETTY,
    era: "predecessor", built: 80, condition: "sound",
    quality: "common", social: "artisan", kit: "kv.house.jettied-tall", tags: ["chimney", "shop-front", "candle-light"],
    story: "Candles for the War Record and the shrine; the busiest door on the street when the light fails.",
  }),
  lotHouse({
    id: "kv-well-house", name: "House on the Well Square", at: south(18.2, 8.5), w: 5.4, d: 8.5, storeys: 2, eave: 6.5, ridge: 11, roof: "steep-gable", roofMat: SHINGLE, wallMat: FRAME, tradition: JETTY,
    era: "founding", built: 2, condition: "sound",
    quality: "common", social: "commoner", kit: "kv.house.jettied-small", tags: ["chimney", "window-box", "bench"],
    story: "Its bench faces the well; most of the street's news passes through it.",
  }),
  lotHouse({
    id: "kv-glover-house", name: "Glover's House", at: south(32, 9.5), w: 6.5, d: 9.5, storeys: 3, eave: 8.6, ridge: 14.2, roof: "steep-gable", roofMat: SLATE, wallMat: FRAME, tradition: JETTY,
    era: "predecessor", built: 105, condition: "weathered", repairs: [{ kind: "rebuilt-courses", note: "Ground storey refaced in mismatched rubble.", mass: "house" }],
    quality: "common", social: "artisan", kit: "kv.house.jettied-tall", tags: ["chimney", "jetty", "hides"],
    story: "Leather hangs to dry in the yard behind; the smell keeps the rival house's envoys moving.",
  }),
  lotHouse({
    id: "kv-burnt-house", name: "Burnt House", at: south(38.5, 8), w: 6, d: 8, storeys: 2, eave: 6, ridge: 6, roof: "none", roofMat: SLATE, wallMat: RUBBLE, tradition: JETTY,
    era: "predecessor", built: 120, condition: "ruinous",
    quality: "poor", social: "commoner", kit: "kv.house.ruin", tags: ["charred-beams", "weeds", "empty-plot"],
    story: "Roofless since the earlier conflict; nobody has claimed the plot, and children dare each other to cross it.",
  }),
  lotHouse({
    id: "kv-dyer-house", name: "Dyer's House", at: south(46.2, 9.5), w: 6, d: 9.5, storeys: 2, eave: 6.4, ridge: 11, roof: "gable", roofMat: SHINGLE, wallMat: FRAME, tradition: JETTY,
    era: "founding", built: 2, condition: "sound",
    quality: "common", social: "artisan", kit: "kv.house.jettied-small", tags: ["chimney", "dye-vats", "fabric-drying"],
    story: "Violet and black vats behind the house supply the weavers across the street.",
  }),
  lotHouse({
    id: "kv-cooper-house", name: "Cooper's House", at: south(52.6, 9), w: 5.5, d: 9, storeys: 2, eave: 6, ridge: 10.5, roof: "gable", axis: "x", roofMat: SHINGLE, wallMat: FRAME, tradition: JETTY,
    era: "founding", built: 2, condition: "sound",
    quality: "common", social: "artisan", kit: "kv.house.broad", tags: ["barrels", "chimney"],
    story: "Eaves to the street at the corner of Cooper's Row; hoops hang from the jetty beam.",
  }),
  lotHouse({
    id: "kv-scribe-house", name: "Scribe's House", at: underRock(9.2, 6), w: 5.6, d: 6, storeys: 2, eave: 6, ridge: 10, roof: "gable", axis: "x", roofMat: SLATE, wallMat: FRAME, tradition: JETTY,
    era: "predecessor", built: 75, condition: "sound",
    quality: "common", social: "civic", kit: "kv.house.jettied-small", tags: ["chimney", "window-box", "candle-light"],
    story: "Home of the War Record's scribe, at the foot of the Record Steps.",
  }),
  lotHouse({
    id: "kv-rock-house-east", name: "House under the Rock", at: underRock(24, 4), w: 6, d: 4, storeys: 2, eave: 5.5, ridge: 7.5, roof: "lean-to", axis: "x", roofMat: SHINGLE, wallMat: RUBBLE, tradition: COTTAGE,
    era: "predecessor", built: 110, condition: "weathered", repairs: [{ kind: "salvaged-stone", note: "Back wall patched with dressed stone fallen from the court.", mass: "house" }],
    quality: "poor", social: "labourer", kit: "kv.house.rock-lean", tags: ["chimney", "cooking-fire", "woodpile"],
    story: "Built against the foot of the rock; the lord's court looms nine metres over its roof.",
  }),
  lotHouse({
    id: "kv-rock-house-west", name: "Lean-to on Rock Lane", at: underRock(33, 4.2), w: 6.5, d: 4.2, storeys: 1, eave: 3.6, ridge: 5.6, roof: "lean-to", axis: "x", roofMat: THATCH, wallMat: RUBBLE, tradition: COTTAGE,
    era: "recent", built: 9, condition: "worn",
    quality: "poor", social: "labourer", kit: "kv.house.rock-lean", tags: ["chimney", "hens"],
    story: "A labourer's one-room house roofed against the retaining wall, newer than the stone it leans on.",
  }),
  building({
    id: "kv-lantern-shrine",
    name: "Lantern Shrine",
    district: "C",
    fn: "shrine",
    tradition: GOTHIC,
    masses: [mass({ id: "shrine", role: "tower", at: [17.8, 26.4], w: 3, d: 3, storeys: 1, eave: 3.4, ridge: 7, roof: "spire", roofMat: LEAD, wallMat: ASHLAR })],
    door: [17.8, 24.9],
    facing: 0,
    era: "predecessor",
    built: 150,
    condition: "weathered",
    quality: "fine",
    social: "sacred",
    kit: "kv.ritual.shrine",
    tags: ["ritual-candles", "eclipse-disc"],
    story: "An eclipse disc over a candle niche on the Well Square; residents light it on their way past.",
  }),
  lotHouse({
    id: "kv-widows-cottage", name: "Widow's Cottage", at: byWall(36, 6), w: 6, d: 5.5, storeys: 1, eave: 3, ridge: 6.5, roof: "steep-gable", axis: "x", roofMat: THATCH, wallMat: RUBBLE, tradition: COTTAGE, fn: "cottage",
    era: "predecessor", built: 100, condition: "damaged",
    repairs: [
      { kind: "boarded-opening", note: "One window boarded; she cannot pay a joiner.", mass: "house" },
      { kind: "tarpaulin", note: "Oiled cloth weighted over a hole in the thatch.", mass: "house" },
    ],
    quality: "poor", social: "labourer", lod: "mid", kit: "kv.cottage.thatch", tags: ["chimney", "candle-in-window", "herb-garden"],
    story: "The oldest resident keeps a candle in her window during every Muster.",
  }),
  lotHouse({
    id: "kv-lane-cottage", name: "Lane Cottage", at: byWall(50, 6), w: 7, d: 6, storeys: 1, eave: 3.4, ridge: 7.5, roof: "steep-gable", axis: "x", roofMat: THATCH, wallMat: RUBBLE, tradition: COTTAGE, fn: "cottage",
    era: "predecessor", built: 120, condition: "weathered", repairs: [{ kind: "re-thatched", note: "Ridge re-thatched; the eaves are moss-black.", mass: "house" }],
    quality: "poor", social: "labourer", lod: "background", kit: "kv.cottage.thatch", tags: ["chimney", "garden-plot", "hens"],
    story: "A labourer's cottage older than every wall around it.",
  }),
  lotHouse({
    id: "kv-carter-cottage", name: "Carter's Cottage", at: byWall(26, 5.5), w: 6.5, d: 5.5, storeys: 1, eave: 3.2, ridge: 6.8, roof: "half-hip", axis: "x", roofMat: SHINGLE, wallMat: RUBBLE, tradition: COTTAGE, fn: "cottage",
    era: "recent", built: 12, condition: "sound",
    quality: "poor", social: "labourer", lod: "background", kit: "kv.cottage.shingle", tags: ["chimney", "cart", "beast-tether"],
    story: "The carter's family and their mule share one roof by the south wall.",
  }),
  lotHouse({
    id: "kv-steward-house", name: "Old Steward's House", at: byWall(57.2, 5), w: 6, d: 5, storeys: 2, eave: 6.5, ridge: 11, roof: "steep-gable", axis: "x", roofMat: SLATE, wallMat: RUBBLE, tradition: GOTHIC,
    era: "predecessor", built: 130, condition: "weathered", repairs: [{ kind: "rebuilt-courses", note: "Upper gable rebuilt in mismatched stone.", mass: "house" }],
    quality: "common", social: "commoner", lod: "background", kit: "kv.house.stone-small", tags: ["chimney", "carved-lintel"],
    story: "The previous house's steward lived here; the carved lintel still shows arms chiselled flat.",
  }),
];

const outerBuildings: Building[] = [
  building({
    id: "kv-brook-mill",
    name: "Brook Mill",
    district: "G",
    fn: "mill",
    tradition: JETTY,
    masses: [
      mass({ id: "mill", role: "house", at: [-96, 138], w: 8, d: 6, storeys: 2, eave: 5.5, ridge: 10, roof: "steep-gable", axis: "x", roofMat: SLATE, wallMat: RUBBLE }),
      mass({ id: "wheel-house", role: "lean-to", at: [-96, 134.2], w: 4, d: 1.6, storeys: 1, eave: 2.8, ridge: 3.8, roof: "lean-to", axis: "x", roofMat: SHINGLE, wallMat: TIMBER }),
    ],
    door: [-100, 138],
    facing: 270,
    foundation: { kind: "undercroft", plinth: 0.3, maxRelief: 3 },
    era: "predecessor",
    built: 115,
    condition: "worn",
    repairs: [{ kind: "new-timber", note: "New paddles on an old wheel.", mass: "wheel-house" }],
    quality: "common",
    social: "labourer",
    lod: "background",
    kit: "kv.outer.mill",
    tags: ["water-wheel", "sacks", "cart"],
    story: "The holding's mill on the brook, beside the bridge where the road to the capital crosses.",
    overlap: ["kv-brook"],
  }),
  building({
    id: "kv-field-barn",
    name: "Field Barn",
    district: "G",
    fn: "barn",
    tradition: COTTAGE,
    masses: [mass({ id: "barn", role: "shed", at: [-80, 52], w: 12, d: 7, rot: -14, storeys: 1, eave: 3.8, ridge: 8, roof: "half-hip", axis: "x", roofMat: THATCH, wallMat: TIMBER })],
    door: [-80.85, 48.6],
    facing: 14,
    foundation: { kind: "plinth", plinth: 0.2, maxRelief: 2.2 },
    era: "predecessor",
    built: 60,
    condition: "weathered",
    repairs: [{ kind: "patched-roof", note: "Thatch patched in two colours.", mass: "barn" }],
    quality: "poor",
    social: "labourer",
    lod: "background",
    kit: "kv.outer.field-barn",
    tags: ["hay", "cart"],
    story: "Stands at the edge of the holding's strips; beyond its hedge the fields belong to another banner.",
  }),
];

const buildings: Building[] = civic.concat(yards, houses, outerBuildings);

const byId = (id: string): Building => {
  for (const b of buildings) if (b.id === id) return b;
  throw new Error(`korvenia: unknown building ${id}`);
};
const floorOf = (id: string): number => resolveBuildingBase(T, byId(id)).floorY;

// --- Fortifications -----------------------------------------------------------------

const walls: BannerholdBlueprint["walls"] = [
  {
    id: "kv-court-curtain",
    name: "Court Curtain",
    kind: "curtain",
    points: [[-31, -12.6], [-31, -58.5], [-14, -63.5], [23, -63.5], [41, -57], [46.2, -41], [46.2, -21]],
    closed: false,
    height: 6.5,
    thickness: 1.8,
    walkway: true,
    material: ASHLAR,
    tradition: GOTHIC,
    segments: [
      { from: 0, to: 1, condition: "worn", note: "West face above the Muster Terrace; sound core, eroded crenels." },
      { from: 1, to: 4, condition: "weathered", note: "North face under the crags: lichen-black, merlons fallen, ivy in the joints." },
      { from: 4, to: 6, condition: "worn", note: "East face over the ravine; arrow loops half blocked with rubble." },
    ],
  },
  {
    id: "kv-court-parapet-west",
    name: "Court Parapet (west)",
    kind: "low-wall",
    points: [[-30.2, -12.2], [-14.3, -12.2]],
    closed: false,
    height: 1.1,
    thickness: 0.6,
    walkway: false,
    material: ASHLAR,
    tradition: GOTHIC,
    segments: [{ from: 0, to: 1, condition: "sound", note: "Balustrade above the Muster Stair." }],
  },
  {
    id: "kv-court-parapet-east",
    name: "Court Parapet (east)",
    kind: "low-wall",
    points: [[-7.7, -12.2], [22.6, -12.2]],
    closed: false,
    height: 1.1,
    thickness: 0.6,
    walkway: false,
    material: ASHLAR,
    tradition: GOTHIC,
    segments: [{ from: 0, to: 1, condition: "worn", note: "Balustrade over the lower town; two balusters replaced in timber." }],
  },
  {
    id: "kv-shelf-parapet-west",
    name: "Record Shelf Parapet (west)",
    kind: "low-wall",
    points: [[23.5, -19.4], [30.6, -19.4]],
    closed: false,
    height: 1.1,
    thickness: 0.6,
    walkway: false,
    material: RUBBLE,
    tradition: JETTY,
    segments: [{ from: 0, to: 1, condition: "weathered", note: "Rubble parapet, partly collapsed." }],
  },
  {
    id: "kv-shelf-parapet-east",
    name: "Record Shelf Parapet (east)",
    kind: "low-wall",
    points: [[33.4, -19.5], [45.4, -19.8]],
    closed: false,
    height: 1.1,
    thickness: 0.6,
    walkway: false,
    material: RUBBLE,
    tradition: JETTY,
    segments: [{ from: 0, to: 1, condition: "worn", note: "Rubble parapet over the scribe's roof." }],
  },
  {
    id: "kv-town-wall",
    name: "Town Wall",
    kind: "town-wall",
    points: [[46.2, -21], [55, -6], [57, 10], [56.6, 30], [46, 44], [10, 46.6], [-26, 46], [-46, 44], [-56, 32], [-58.6, 17], [-58.2, -2], [-52, -14], [-31, -12.6]],
    closed: false,
    height: 5.5,
    thickness: 1.5,
    walkway: true,
    material: RUBBLE,
    tradition: JETTY,
    segments: [
      { from: 0, to: 1, condition: "damaged", note: "Old breach above the ravine closed with a timber palisade and salvaged stone, never properly rebuilt." },
      { from: 1, to: 3, condition: "weathered", note: "East wall over the ravine: crenels lost, faces streaked black." },
      { from: 3, to: 7, condition: "sound", note: "South wall rebuilt at the founding in coursed rubble." },
      { from: 7, to: 10, condition: "worn", note: "West wall; the gate stretch is the best kept." },
      { from: 10, to: 12, condition: "weathered", note: "North-west stretch behind the Herald's Station, patched with timber hoarding." },
    ],
    allowOverlapWith: ["kv-main-gatehouse"],
  },
];

const towers: BannerholdBlueprint["towers"] = [
  {
    id: "kv-watchtower-repaired",
    name: "South-east Watchtower",
    kind: "watchtower",
    center: [46, 44],
    shape: "round",
    width: 6.5,
    height: 16,
    roof: "conical",
    material: RUBBLE,
    wallId: "kv-town-wall",
    condition: "sound",
    repairs: [
      { kind: "rebuilt-courses", note: "Upper third rebuilt in pale limestone after the earlier conflict; the seam is a clean horizontal line." },
      { kind: "new-timber", note: "New timber hoarding and conical roof." },
      { kind: "iron-strapping", note: "Iron bands where the old masonry cracked." },
    ],
    storyRole: "repaired-watchtower",
    story: "The tower that held when the previous house lost the scarp. Its pale crown is the first scar a visitor reads from the valley.",
  },
  {
    id: "kv-ravine-tower",
    name: "Ravine Tower",
    kind: "wall-tower",
    center: [56.6, 30],
    shape: "round",
    width: 5,
    height: 9,
    roof: "none",
    material: RUBBLE,
    wallId: "kv-town-wall",
    condition: "weathered",
    repairs: [],
    story: "Open-topped half-round tower over the ravine; its floors long since fallen in.",
  },
  {
    id: "kv-southwest-tower",
    name: "Field Tower",
    kind: "wall-tower",
    center: [-46, 44],
    shape: "square",
    width: 5,
    height: 10,
    roof: "pyramid",
    material: RUBBLE,
    wallId: "kv-town-wall",
    condition: "worn",
    repairs: [{ kind: "patched-roof", note: "Shingle patch on the slate pyramid." }],
    story: "Watches the road where it turns down into the valley.",
  },
  {
    id: "kv-burnt-tower",
    name: "Burnt North Tower",
    kind: "wall-tower",
    center: [-31, -58.5],
    shape: "round",
    width: 7,
    height: 11,
    roof: "none",
    material: ASHLAR,
    wallId: "kv-court-curtain",
    condition: "ruinous",
    repairs: [],
    story: "A broken shell since the previous house lost the scarp; the banner cannot yet afford to raise it.",
  },
  {
    id: "kv-court-tower",
    name: "Court Tower",
    kind: "wall-tower",
    center: [-31, -12.6],
    shape: "square",
    width: 4.6,
    height: 12,
    roof: "pyramid",
    material: ASHLAR,
    wallId: "kv-court-curtain",
    condition: "worn",
    repairs: [],
    story: "Corner tower above the Muster Terrace where the court curtain meets the town wall; the levy is watched from above.",
    allowOverlapWith: ["kv-court-parapet-west", "kv-town-wall"],
  },
];

const gates: BannerholdBlueprint["gates"] = [
  { id: "kv-gate-west", name: "West Gate", kind: "main-gate", position: [-58.6, 17], outwardBearingDeg: 270, width: 4, height: 5.5, wallId: "kv-town-wall", routeId: "kv-national-road" },
  { id: "kv-gate-court", name: "Court Gate", kind: "inner-gate", position: [-11, -12.2], outwardBearingDeg: 180, width: 3.4, height: 4.2, wallId: "kv-court-parapet-west", routeId: "kv-muster-stair" },
  { id: "kv-gate-postern", name: "East Postern", kind: "postern", position: [56.7, 28], outwardBearingDeg: 90, width: 1.6, height: 2.6, wallId: "kv-town-wall", routeId: "kv-washing-path" },
];

// --- Landmarks, muster, ceremony and state slots ---------------------------------

const HALL_FLOOR = floorOf("kv-banner-hall");
const RECORD_FLOOR = floorOf("kv-war-record");
const HERALD_FLOOR = floorOf("kv-herald-station");
const DAIS_TOP = round2(floorOf("kv-muster-dais") + 1.1);
const GATE_FLOOR = floorOf("kv-main-gatehouse");
const COURT_GATE_FLOOR = floorOf("kv-court-gatehouse");

const landmarks: BannerholdBlueprint["landmarks"] = [
  {
    id: "banner-hall",
    label: "Banner Hall",
    buildingIds: ["kv-banner-hall", "kv-lodging", "kv-west-range"],
    anchor: [0, round2(HALL_FLOOR + 24), -26],
    pickCenter: [0, round2(HALL_FLOOR + 10), -37],
    pickRadius: 13,
    cameraId: "landmark:banner-hall",
  },
  {
    id: "muster-grounds",
    label: "Muster Grounds",
    buildingIds: ["kv-muster-dais", "kv-armoury", "kv-levy-hall"],
    anchor: [-22, round2(DAIS_TOP + 4), -4],
    pickCenter: [-24, 2, 2],
    pickRadius: 12,
    cameraId: "landmark:muster-grounds",
  },
  {
    id: "war-record",
    label: "War Record",
    buildingIds: ["kv-war-record"],
    anchor: [33, round2(RECORD_FLOOR + 19), -31],
    pickCenter: [33, round2(RECORD_FLOOR + 7), -34],
    pickRadius: 9,
    cameraId: "landmark:war-record",
  },
  {
    id: "heralds-station",
    label: "Herald's Station",
    buildingIds: ["kv-herald-station", "kv-main-gatehouse"],
    anchor: [-51, round2(HERALD_FLOOR + 20), -1],
    pickCenter: [-53, round2(HERALD_FLOOR + 6), 4],
    pickRadius: 8,
    cameraId: "landmark:heralds-station",
  },
];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const fileRow = poseRow(T, [-28.5, -2.2], [-15.5, -2.2], 8, 180);

const muster: BannerholdBlueprint["muster"] = {
  pawnStand: G.facing(-22, 0.4, 180),
  fileMarkers: FILES.map((file, i) => ({ file, pose: fileRow[i] })),
  levySlots: [G.facing(-26, 2.6, 180), G.facing(-24, 2.6, 180), G.facing(-20, 2.6, 180), G.facing(-18, 2.6, 180), G.facing(-25, 4.2, 180), G.facing(-19, 4.2, 180)],
  drillSquare: { kind: "rect", center: [-22, 7], width: 18, depth: 6 },
  platformBuildingId: "kv-muster-dais",
};

const ceremonial: BannerholdBlueprint["ceremonial"] = {
  id: "kv-honour-court",
  name: "The Honour Court",
  shape: { kind: "rect", center: [7, -16], width: 7, depth: 6 },
  centrepiece: [7, -16],
  description:
    "A raised flagstone court (0.45 m) in the south-east corner of the Banner Court, under an old yew beside the hall porch. Eight candle niches in its low walls wait for honours; a black marble eclipse dial stands at its centre. Empty niches are deliberate: recognition fills them, never the scene.",
};

const niche = (i: number) => {
  // Four niches in the east wall facing west, four in the north wall facing south, all toward the dial.
  const east = i < 4;
  const x = east ? 10.1 : round2(4.6 + (i - 4) * 1.5);
  const z = east ? round2(-18 + i * 1.5) : -18.6;
  return { position: [x, round2(9 + 0.45 + 0.9), z] as const, yawDeg: east ? -90 : 0 };
};

const tableTop = round2(RECORD_FLOOR + 0.95);
const recordMarkers = Array.from({ length: 12 }, (_, i) => ({
  position: [round2(30.6 + (i % 4) * 0.6), tableTop, round2(-36.6 + Math.floor(i / 4) * 0.62)] as const,
  yawDeg: 0,
}));

const slots: BannerholdBlueprint["slots"] = {
  injuredRest: G.facing(-40.2, 6.4, 90, 0.4),
  captiveMarker: G.facing(-20.8, 0.2, 180),
  honourNiches: Array.from({ length: 8 }, (_, i) => niche(i)),
  recordMarkers,
  noticeBoard: Array.from({ length: 6 }, (_, i) => ({ position: [round2(-52.6 + (i % 3) * 0.6), round2(HERALD_FLOOR + 1.3 + Math.floor(i / 3) * 0.55), 7.0] as const, yawDeg: 0 })),
  heraldArrival: G.facing(-51, 12.6, 0),
  rivalCorrespondence: { position: [-49.4, round2(HERALD_FLOOR + 1.5), 7.0], yawDeg: 0 },
  alliedEnvoy: { position: [-51, round2(HERALD_FLOOR + 18.5), -2.5], yawDeg: 0 },
  bannerMounts: [
    { id: "kv-court-standard", kind: "standard", heraldry: "player", pose: G.facing(-3, -16.2, 180), height: 14, minHallTier: 0 },
    { id: "kv-hall-emblem", kind: "emblem", heraldry: "player", pose: { position: [0, round2(HALL_FLOOR + 7.4), -21.9], yawDeg: 0 }, height: 1.6, minHallTier: 0 },
    { id: "kv-keep-veiled", kind: "veiled-standard", heraldry: "veiled", pose: { position: [-11, round2(HALL_FLOOR + 34), -47], yawDeg: 0 }, height: 4, minHallTier: 0 },
    { id: "kv-gate-shield", kind: "shield", heraldry: "player", pose: { position: [-62.4, round2(GATE_FLOOR + 6.2), 17], yawDeg: -90 }, height: 1.4, minHallTier: 0 },
    { id: "kv-court-gate-banner", kind: "standard", heraldry: "player", pose: { position: [-11, round2(COURT_GATE_FLOOR + 6), -11.95], yawDeg: 0 }, height: 2.4, minHallTier: 0 },
    { id: "kv-dais-standard-w", kind: "standard", heraldry: "player", pose: { position: [-29.6, DAIS_TOP, -6.8], yawDeg: 0 }, height: 6, minHallTier: 0 },
    { id: "kv-dais-standard-e", kind: "standard", heraldry: "player", pose: { position: [-14.4, DAIS_TOP, -6.8], yawDeg: 0 }, height: 6, minHallTier: 0 },
    { id: "kv-herald-crown", kind: "veiled-standard", heraldry: "crown", pose: { position: [-48, round2(HERALD_FLOOR + 13), -2.5], yawDeg: 90 }, height: 3, minHallTier: 0 },
    { id: "kv-parapet-shields", kind: "shield", heraldry: "player", pose: { position: [6, 10.2, -12], yawDeg: 0 }, height: 1.1, minHallTier: 1 },
    { id: "kv-hall-tapestries", kind: "tapestry", heraldry: "player", pose: { position: [0, round2(HALL_FLOOR + 3), -24.9], yawDeg: 0 }, height: 5, minHallTier: 2 },
    { id: "kv-keep-pennant", kind: "pennant", heraldry: "player", pose: { position: [-11, round2(HALL_FLOOR + 36.5), -47], yawDeg: 0 }, height: 3, minHallTier: 3 },
  ],
  hallTiers: [
    { tier: 1, buildings: ["kv-west-range"], expansionZones: [], dressing: ["kv-parapet-shields", "court-braziers-lit"] },
    { tier: 2, buildings: ["kv-record-gallery"], expansionZones: ["kv-exp-record-gallery"], dressing: ["kv-hall-tapestries", "gallery-honours"] },
    { tier: 3, buildings: [], expansionZones: ["kv-exp-shelf-terrace", "kv-exp-barbican"], dressing: ["kv-keep-pennant", "gilded-emblem"] },
  ],
  foundingStandard: G.facing(-3, -16.2, 180),
};

// --- Storytelling, vegetation and dressing ------------------------------------------

const story: BannerholdBlueprint["story"] = [
  { id: "kv-story-watchtower", kind: "repaired-watchtower", position: [46, 44], refs: ["kv-watchtower-repaired"], description: "Pale limestone crown on a black tower above the ravine: repaired after the earlier conflict, never hidden." },
  { id: "kv-story-north-curtain", kind: "weathered-fortification", position: [4, -63.5], refs: ["kv-court-curtain"], description: "Lichen-black north curtain with fallen merlons under the crags." },
  { id: "kv-story-breach", kind: "weathered-fortification", position: [50.5, -13.5], refs: ["kv-town-wall"], description: "The old breach above the ravine, closed with a timber palisade and salvaged stone." },
  { id: "kv-story-levy-yard", kind: "levy-yard-vs-noble-architecture", position: [-24, 6], refs: ["kv-muster-dais", "kv-levy-hall", "kv-allied-seat"], description: "A packed-earth yard and timber levy hall beneath 9 m of the lord's rock; on the ridge above the scarp, the allied Great House's spires." },
  { id: "kv-story-road", kind: "merchant-road", position: [-84, 28], refs: ["kv-national-road", "kv-gate-west"], description: "Setts worn into ruts by carts and couriers; milestones count down to the capital." },
  { id: "kv-story-west-range", kind: "unfinished-structure", position: [-21, -31], refs: ["kv-west-range"], description: "Walls to 4 m, an idle treadwheel crane and stacked dressed stone." },
  { id: "kv-story-honour-court", kind: "ceremonial-place", position: [7, -16], refs: ["kv-honour-court"], description: "Eight empty candle niches waiting for recognised honours." },
  { id: "kv-story-pawn-stand", kind: "empty-character-position", position: [-22, 0.4], refs: ["kv-muster-dais"], description: "The nominated representative's marked stone, occupied or empty according to real state." },
  { id: "kv-story-burnt-tower", kind: "older-house-ruin", position: [-31, -58.5], refs: ["kv-burnt-tower"], description: "The previous house's burnt north tower, left as a shell." },
  { id: "kv-story-burnt-house", kind: "older-house-ruin", position: [36.5, 29.5], refs: ["kv-burnt-house"], description: "A roofless house on Lantern Street that nobody has claimed since the earlier conflict." },
  { id: "kv-story-boundary", kind: "boundary-dispute", position: [-176, 22], refs: ["kv-boundary-stone-west", "kv-boundary-stone-moved"], description: "Two boundary stones a few metres apart where a neighbour moved the line." },
  { id: "kv-story-class", kind: "class-contrast", position: [12, 4], refs: ["kv-reeve-house", "kv-rock-house-east", "kv-lodging"], description: "Ashlar and slate for the reeve, rubble lean-tos under the rock, lime-washed lodging above both." },
  { id: "kv-story-arms", kind: "ancestral-memory", position: [36, 37], refs: ["kv-steward-house", "kv-banner-hall"], description: "The previous house's arms chiselled flat above the old steward's door, and the same blank shields inside the Banner Hall." },
];

const vegetation: BannerholdBlueprint["vegetation"] = [
  { id: "kv-scarp-pines", kind: "forest", shape: { kind: "polygon", points: [[-200, -170], [200, -170], [200, -94], [70, -90], [-10, -92], [-80, -90], [-200, -96]] }, density: 3.5, species: "black pine", seed: 11 },
  { id: "kv-scarp-scrub", kind: "scrub", shape: { kind: "polygon", points: [[-200, -96], [-80, -90], [-60, -70], [-46, -68], [60, -70], [200, -94], [200, -72], [64, -62], [-34, -64], [-200, -62]] }, density: 0.8, species: "thorn and juniper", seed: 12 },
  { id: "kv-ravine-birch", kind: "woodland", shape: { kind: "polygon", points: [[108, -60], [66, -60], [70, 40], [74, 96], [70, 150], [96, 150], [104, 80]] }, density: 3, species: "silver birch and alder", seed: 13 },
  { id: "kv-honour-yew", kind: "lone-tree", shape: { kind: "rect", center: [4.6, -14.2], width: 2, depth: 2 }, density: 1, species: "old yew", seed: 14 },
  { id: "kv-lords-garden", kind: "garden", shape: { kind: "rect", center: [-21, -46], width: 8, depth: 10 }, density: 30, species: "herbs and black kale", seed: 15 },
  { id: "kv-orchard", kind: "orchard", shape: { kind: "polygon", points: [[-62, -38], [-98, -34], [-102, -6], [-66, -4]] }, density: 2.2, species: "black medlar", seed: 16 },
  { id: "kv-hedge-fields", kind: "hedgerow", shape: { kind: "polygon", points: [[-86, 30], [-184, 6], [-185, 9], [-87, 33]] }, density: 40, species: "blackthorn", seed: 17 },
  { id: "kv-brook-alders", kind: "woodland", shape: { kind: "polygon", points: [[40, 140], [-40, 128], [-200, 112], [-200, 132], [-40, 150], [40, 162]] }, density: 2.5, species: "alder and willow", seed: 18 },
  { id: "kv-heath-south", kind: "heath", shape: { kind: "polygon", points: [[60, 54], [-60, 52], [-80, 100], [40, 118]] }, density: 6, species: "heather and bracken", seed: 19 },
  { id: "kv-yard-gardens", kind: "garden", shape: { kind: "polygon", points: [[-4, 0.5], [44, 3.5], [44, 6], [-4, 4]] }, density: 12, species: "kitchen plots behind Lantern Street", seed: 20 },
  { id: "kv-widow-herbs", kind: "garden", shape: { kind: "rect", center: [8, 32.4], width: 5, depth: 1.6 }, density: 30, species: "herbs", seed: 21 },
];

const dressing: BannerholdBlueprint["dressing"] = [
  { id: "kv-court-brazier-w", kind: "brazier", position: [-3.9, -21.6], yawDeg: 0, district: "A", note: "Pair flanking the hall porch." },
  { id: "kv-court-brazier-e", kind: "brazier", position: [3.9, -21.6], yawDeg: 0, district: "A" },
  { id: "kv-crane", kind: "crane", position: [-15.2, -27], yawDeg: 90, district: "A", note: "Idle treadwheel crane beside the West Range." },
  { id: "kv-crane-stones", kind: "stone-pile", position: [-26.5, -19.6], yawDeg: 10, district: "A", note: "Dressed blocks for the West Range." },
  { id: "kv-scaffold-poles", kind: "scaffold-stack", position: [-15, -21.8], yawDeg: 90, district: "A" },
  { id: "kv-kitchen-wood", kind: "woodpile", position: [8.2, -50.6], yawDeg: 0, district: "A" },
  { id: "kv-kitchen-jars", kind: "water-jars", position: [21.8, -48.4], yawDeg: 0, district: "A" },
  { id: "kv-pells", kind: "practice-pell", position: [-12.6, 4], yawDeg: 0, district: "B", note: "Four pells, one split." },
  { id: "kv-butts", kind: "archery-butt", position: [-11.2, 9.6], yawDeg: 270, district: "B" },
  { id: "kv-racks", kind: "weapon-rack", position: [-40.2, 3.8], yawDeg: 90, district: "B" },
  { id: "kv-levy-fire", kind: "cooking-fire", position: [-39.6, 12.6], yawDeg: 0, district: "B" },
  { id: "kv-muster-trough", kind: "quench-trough", position: [-36.6, 13.4], yawDeg: 0, district: "B", note: "Horse trough at the yard edge." },
  { id: "kv-anvil", kind: "anvil", position: [-32.5, 27.4], yawDeg: 90, district: "D" },
  { id: "kv-quench", kind: "quench-trough", position: [-32.5, 24.4], yawDeg: 90, district: "D" },
  { id: "kv-charcoal", kind: "woodpile", position: [-43.8, 30.6], yawDeg: 90, district: "D" },
  { id: "kv-granary-cart", kind: "cart", position: [-32.4, 40.4], yawDeg: 0, district: "D" },
  { id: "kv-workshop-barrels", kind: "barrels", position: [-27.8, 22.4], yawDeg: 0, district: "D" },
  { id: "kv-barn-hay", kind: "hay", position: [-15, 38.4], yawDeg: 0, district: "D" },
  { id: "kv-builders-stone", kind: "stone-pile", position: [-12.4, 26], yawDeg: 0, district: "D", note: "Builder's yard: stone and timber waiting for the West Range." },
  { id: "kv-builders-timber", kind: "scaffold-stack", position: [-12.4, 32.5], yawDeg: 90, district: "D" },
  { id: "kv-gate-cart", kind: "cart", position: [-64.6, 19.8], yawDeg: 100, district: "E", note: "A merchant's cart waiting for the toll." },
  { id: "kv-notice-board", kind: "notice-board", position: [-49, 7.6], yawDeg: 0, district: "E" },
  { id: "kv-post-trough", kind: "quench-trough", position: [-46.8, 24], yawDeg: 0, district: "E" },
  { id: "kv-well-square", kind: "well", position: [13.6, 24.2], yawDeg: 0, district: "C" },
  { id: "kv-well-bench", kind: "bench", position: [13.4, 26.8], yawDeg: 0, district: "C" },
  { id: "kv-street-lamp-1", kind: "lamp-post", position: [1, 16.7], yawDeg: 0, district: "C" },
  { id: "kv-street-lamp-2", kind: "lamp-post", position: [30, 20.2], yawDeg: 0, district: "C" },
  { id: "kv-yard-fire", kind: "cooking-fire", position: [2.6, 2.4], yawDeg: 0, district: "C" },
  { id: "kv-lane-fire", kind: "cooking-fire", position: [13.2, 37.2], yawDeg: 0, district: "C" },
  { id: "kv-weaver-laundry", kind: "laundry-line", position: [-3, 20.4], yawDeg: 90, district: "C", note: "Dyed cloth strung across Lantern Street from the tenement." },
  { id: "kv-widow-laundry", kind: "laundry-line", position: [12.6, 33.2], yawDeg: 0, district: "C" },
  { id: "kv-brewer-barrels", kind: "barrels", position: [36.4, 6.4], yawDeg: 0, district: "C" },
  { id: "kv-cooper-hoops", kind: "barrels", position: [46.2, 30.4], yawDeg: 0, district: "C" },
  { id: "kv-dye-vats", kind: "water-jars", position: [36.4, 37.8], yawDeg: 0, district: "C" },
  { id: "kv-boundary-stone-west", kind: "boundary-stone", position: [-176, 22], yawDeg: 0, district: "G" },
  { id: "kv-boundary-stone-moved", kind: "boundary-stone", position: [-171.5, 19.6], yawDeg: 12, district: "G", note: "The stone a neighbour moved." },
  { id: "kv-stream-laundry", kind: "laundry-line", position: [70, 23.6], yawDeg: 30, district: "G" },
  { id: "kv-milestone", kind: "boundary-stone", position: [-90, 41], yawDeg: 0, district: "G", note: "Milestone counting the leagues to the capital." },
];

const activitySites: BannerholdBlueprint["activitySites"] = [
  { id: "kv-site-forge", kind: "forge", position: G.ground(-34.2, 25.2), district: "D" },
  { id: "kv-site-anvil", kind: "anvil", position: G.ground(-32.5, 27.4), district: "D" },
  { id: "kv-site-quench", kind: "quench", position: G.ground(-32.5, 24.4), district: "D" },
  { id: "kv-site-well", kind: "well", position: G.ground(13.6, 24.9), district: "C" },
  { id: "kv-site-drill", kind: "drill-square", position: G.ground(-22, 7), district: "B" },
  { id: "kv-site-notices", kind: "notice-board", position: G.ground(-51, 7.8), district: "E" },
  { id: "kv-site-stable", kind: "stable", position: G.ground(-49.5, 21.8), district: "E" },
  { id: "kv-site-lookout", kind: "lookout", position: [46, round2(T.height(46, 44) + 13), 44], district: "C" },
  { id: "kv-site-war-table", kind: "war-table", position: [31.5, tableTop, -35.4], district: "F" },
  { id: "kv-site-granary", kind: "loading-bay", position: G.ground(-33.2, 37.5), district: "D" },
  { id: "kv-site-stream", kind: "laundry", position: G.ground(73.5, 22.4), district: "G" },
  { id: "kv-site-shrine", kind: "shrine", position: G.ground(17.8, 24.2), district: "C" },
  { id: "kv-site-masons", kind: "workbench", position: G.ground(-15.6, -24.6), district: "A" },
];

// --- Life: deterministic schedules ------------------------------------------------

const near = { fullRateWithin: 60, reducedRateWithin: 160, hiddenBeyond: 420 };
const far = { fullRateWithin: 0, reducedRateWithin: 600, hiddenBeyond: 1600 };
const ROAD_IN: Vec2[] = [[-196, 142.5], [-176, 140], [-150, 128], [-140, 112], [-124, 84], [-104, 52], [-84, 28], [-66, 18]];

const npcs: NpcAgent[] = [
  {
    id: "kv-sentry-south", role: "sentry", label: "Sentry on the south wall", district: "C", count: 1,
    route: [[44.4, 44.2], [10, 46.6], [-26, 46], [-44.4, 44.1]], heightMode: "wall-walk", wallId: "kv-town-wall",
    steps: [{ kind: "walk", to: 3 }, { kind: "hold", seconds: 8, activity: "watch", faceBearingDeg: 225 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 10, activity: "watch", faceBearingDeg: 135 }],
    phaseSeconds: 0, speed: 1.0, lod: near, activitySiteIds: ["kv-site-lookout"],
  },
  {
    id: "kv-sentry-crag", role: "sentry", label: "Sentry on the north curtain", district: "A", count: 1,
    route: [[-29.6, -59], [-14, -63.5], [23, -63.5], [39.6, -57.6]], heightMode: "wall-walk", wallId: "kv-court-curtain",
    steps: [{ kind: "walk", to: 3 }, { kind: "hold", seconds: 6, activity: "watch", faceBearingDeg: 30 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 6, activity: "watch", faceBearingDeg: 315 }],
    phaseSeconds: 37, speed: 0.9, lod: near, activitySiteIds: [],
  },
  {
    id: "kv-gate-guards", role: "guard", label: "Gate guards", district: "E", count: 2, formation: [[0, 0], [0, 7]],
    route: [[-53.6, 13.4], [-53.6, 14.6]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 20, activity: "watch", faceBearingDeg: 270 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "inspect", faceBearingDeg: 270 }, { kind: "walk", to: 0 }],
    phaseSeconds: 5, speed: 0.6, lod: near, activitySiteIds: [],
  },
  {
    id: "kv-smith", role: "smith", label: "Smith at the forge", district: "D", count: 1,
    route: [[-34.2, 25.2], [-32.5, 27.4], [-32.5, 24.4]], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 5, activity: "bellows", faceBearingDeg: 270 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 9, activity: "forge-strike", faceBearingDeg: 90 },
      { kind: "walk", to: 2 }, { kind: "hold", seconds: 3, activity: "quench", faceBearingDeg: 90 }, { kind: "walk", to: 0 },
    ],
    phaseSeconds: 0, speed: 0.8, lod: near, activitySiteIds: ["kv-site-forge", "kv-site-anvil", "kv-site-quench"],
  },
  {
    id: "kv-messenger", role: "messenger", label: "Grand Duchy messenger riding to the Herald's Station", district: "E", count: 1,
    route: ROAD_IN.concat([[-58.6, 17], [-51, 17.4], [-51, 12.6]]), heightMode: "terrain",
    steps: [
      { kind: "walk", to: 10, speed: 3.4 }, { kind: "hold", seconds: 10, activity: "post-notice", faceBearingDeg: 0 }, { kind: "hold", seconds: 8, activity: "tend-beast", faceBearingDeg: 270 },
      { kind: "walk", to: 0, speed: 3.4 }, { kind: "hold", seconds: 45, activity: "rest" },
    ],
    phaseSeconds: 20, speed: 3.4, lod: { fullRateWithin: 80, reducedRateWithin: 400, hiddenBeyond: 900 }, activitySiteIds: ["kv-site-notices", "kv-site-stable"],
  },
  {
    id: "kv-drill", role: "drill", label: "Levy drilling before the dais", district: "B", count: 4, formation: [[0, 0], [1.6, 0], [0, 1.6], [1.6, 1.6]],
    route: [[-30, 5], [-15, 5], [-15, 8.4], [-30, 8.4], [-30, 5]], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 12, activity: "drill", faceBearingDeg: 0 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 8, activity: "drill", faceBearingDeg: 0 },
      { kind: "walk", to: 2 }, { kind: "walk", to: 3 }, { kind: "hold", seconds: 6, activity: "salute", faceBearingDeg: 0 }, { kind: "walk", to: 4 },
    ],
    phaseSeconds: 0, speed: 1.1, lod: near, activitySiteIds: ["kv-site-drill"],
  },
  {
    id: "kv-herald", role: "herald", label: "Herald at the notice board", district: "E", count: 1,
    route: [[-52.2, 8.4], [-50.2, 8.6], [-50.4, 12.6]], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 9, activity: "read-notice", faceBearingDeg: 0 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "write", faceBearingDeg: 0 },
      { kind: "walk", to: 2 }, { kind: "hold", seconds: 7, activity: "watch", faceBearingDeg: 270 }, { kind: "walk", to: 0 },
    ],
    phaseSeconds: 11, speed: 0.9, lod: near, activitySiteIds: ["kv-site-notices"],
  },
  {
    id: "kv-scribe", role: "scribe", label: "War Record scribe crossing to the Banner Hall", district: "F", count: 1,
    route: [[32, -26.4], [32, -21], [25.5, -21], [18.5, -21], [10.5, -21], [0, -20.2], [0, -21.8]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 6 }, { kind: "hold", seconds: 8, activity: "inspect", faceBearingDeg: 0 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 22, activity: "write", faceBearingDeg: 0 }],
    phaseSeconds: 14, speed: 0.9, lod: near, activitySiteIds: ["kv-site-war-table"],
  },
  {
    id: "kv-mason", role: "worker", label: "Mason dressing stone at the West Range", district: "A", count: 1,
    route: [[-15.6, -24.6], [-24.8, -20.4], [-15.6, -24.6]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 16, activity: "repair", faceBearingDeg: 270 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "carry" }, { kind: "walk", to: 2 }],
    phaseSeconds: 9, speed: 0.7, lod: near, activitySiteIds: ["kv-site-masons"],
  },
  {
    id: "kv-water-carrier", role: "resident", label: "Water carrier at the Well Square", district: "C", count: 1,
    route: [[13.6, 24.9], [12.4, 20.2], [6.6, 19.6], [6.6, 17.4]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 7, activity: "draw-water", faceBearingDeg: 180 }, { kind: "walk", to: 3 }, { kind: "hold", seconds: 5, activity: "carry", faceBearingDeg: 0 }, { kind: "walk", to: 0 }],
    phaseSeconds: 3, speed: 0.8, lod: near, activitySiteIds: ["kv-site-well"],
  },
  {
    id: "kv-cloth-carrier", role: "resident", label: "Dyer's daughter carrying cloth to the weavers", district: "C", count: 1,
    route: [[42.6, 24.8], [30, 22], [16, 20.2], [3, 19.6], [1, 21.2]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 4 }, { kind: "hold", seconds: 12, activity: "chat", faceBearingDeg: 180 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 20, activity: "hang-laundry", faceBearingDeg: 180 }],
    phaseSeconds: 41, speed: 0.85, lod: near, activitySiteIds: [],
  },
  {
    id: "kv-washer", role: "resident", label: "Washer on the ravine path", district: "C", count: 1,
    route: [[46, 26], [55, 28], [64, 26], [73, 22.6]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 3 }, { kind: "hold", seconds: 24, activity: "hang-laundry", faceBearingDeg: 60 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 18, activity: "chat" }],
    phaseSeconds: 50, speed: 0.7, lod: near, activitySiteIds: ["kv-site-stream"],
  },
  {
    id: "kv-carter", role: "carter", label: "Carter between granary and post stable", district: "D", count: 1,
    route: [[-33.2, 37.6], [-29.4, 37.5], [-30, 26], [-30, 18], [-49.5, 17.4], [-49.5, 21.8]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 15, activity: "load", faceBearingDeg: 90 }, { kind: "walk", to: 5 }, { kind: "hold", seconds: 12, activity: "tend-beast", faceBearingDeg: 180 }, { kind: "walk", to: 0 }],
    phaseSeconds: 31, speed: 0.9, lod: near, activitySiteIds: ["kv-site-granary", "kv-site-stable"],
  },
  {
    id: "kv-children", role: "child", label: "Children running along Lantern Street", district: "C", count: 2, formation: [[0, 0], [1.2, 0.8]],
    route: [[-2, 20.6], [8, 20.6], [16, 21.4], [8, 20.6], [-2, 20.6]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 2, speed: 2.1 }, { kind: "hold", seconds: 5, activity: "chat" }, { kind: "walk", to: 4, speed: 2.1 }, { kind: "hold", seconds: 9, activity: "chat" }],
    phaseSeconds: 8, speed: 2.1, lod: near, activitySiteIds: ["kv-site-shrine"],
  },
  {
    id: "kv-farmers", role: "farmer", label: "Farmers working the west strips", district: "G", count: 3, formation: [[0, 0], [5, 3], [10, 1]],
    route: [[-116, 36], [-160, 24]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 1, speed: 0.4 }, { kind: "hold", seconds: 20, activity: "rest" }, { kind: "walk", to: 0, speed: 0.4 }, { kind: "hold", seconds: 16, activity: "carry" }],
    phaseSeconds: 0, speed: 0.4, lod: far, activitySiteIds: [],
  },
  {
    id: "kv-merchant-cart", role: "carter", label: "Merchant cart on the road to the capital", district: "G", count: 1,
    route: ROAD_IN.concat([[-64.6, 19.6]]), heightMode: "terrain",
    steps: [{ kind: "walk", to: 8, speed: 1.2 }, { kind: "hold", seconds: 30, activity: "trade", faceBearingDeg: 90 }, { kind: "walk", to: 0, speed: 1.2 }, { kind: "hold", seconds: 60, activity: "rest" }],
    phaseSeconds: 140, speed: 1.2, lod: far, activitySiteIds: [],
  },
];

// --- Outer Territory and the greater nation ---------------------------------------

const outer: BannerholdBlueprint["outer"] = {
  fields: [
    { id: "kv-field-barley", crop: "dark barley", polygon: [[-86, 34], [-120, 26], [-128, 52], [-94, 60]], furrowBearingDeg: 194, owner: "holding", condition: "tended" },
    { id: "kv-field-oats", crop: "black oats", polygon: [[-122, 25], [-154, 17], [-162, 43], [-130, 51]], furrowBearingDeg: 194, owner: "holding", condition: "harvested" },
    { id: "kv-field-flax", crop: "flax", polygon: [[-156, 16], [-186, 9], [-194, 35], [-164, 42]], furrowBearingDeg: 194, owner: "holding", condition: "tended" },
    { id: "kv-field-fallow", crop: "fallow", polygon: [[-96, 62], [-130, 54], [-138, 80], [-104, 88]], furrowBearingDeg: 194, owner: "holding", condition: "fallow" },
    { id: "kv-field-neighbour", crop: "rye", polygon: [[30, 150], [-40, 140], [-44, 168], [26, 170]], furrowBearingDeg: 100, owner: "neighbour", condition: "tended" },
  ],
  outposts: [
    { id: "kv-toll-tower", name: "Road toll tower", kind: "toll", position: [-656, 116], height: 14, owner: "crown", description: "The Grand Duchy's toll tower on the road, 0.7 km out." },
    { id: "kv-scarp-beacon", name: "Scarp beacon", kind: "beacon", position: [24, -150], height: 7, owner: "holding", description: "Iron beacon basket on the crest; lit for Muster summons." },
    { id: "kv-road-shrine", name: "Crossroads shrine", kind: "shrine", position: [-176, 140], height: 4, owner: "crown", description: "Eclipse shrine where the mill track meets the road." },
    { id: "kv-boundary-east", name: "East boundary stone", kind: "boundary-stone", position: [150, 20], height: 1.4, owner: "holding", description: "Holding boundary beyond the ravine." },
    { id: "kv-boundary-crest", name: "Crest boundary stone", kind: "boundary-stone", position: [-40, -160], height: 1.4, owner: "holding", description: "Where the holding's grazing ends at the crest." },
  ],
  places: [
    distantPlace({ id: "kv-allied-seat", name: "Seat of the allied Great House", kind: "allied-seat", bearingDeg: 8, distance: 3600, groundElevation: 240, silhouetteHeight: 96, radius: 260, stateSlot: "allied-house", description: "A many-spired Gothic cloister-estate on the next ridge, above pale scars of black marble quarries, crowning the scarp seen from the valley: the Great House the banner musters beside, older, richer and openly disdainful of the newcomer." }),
    distantPlace({ id: "kv-frontier-aethelgard", name: "Eastern march fort", kind: "frontier", frontierNation: "aethelgard", bearingDeg: 80, distance: 14000, groundElevation: 120, silhouetteHeight: 40, radius: 150, stateSlot: "rival-house", description: "March fort on the eastern heights where the road to Aethelgard leaves the Grand Duchy." }),
    distantPlace({ id: "kv-frontier-solforiz", name: "Valley-mouth border keep", kind: "frontier", frontierNation: "solforiz", bearingDeg: 140, distance: 18000, groundElevation: 20, silhouetteHeight: 36, radius: 140, stateSlot: "rival-house", description: "Border keep at the valley mouth; beyond it the land falls away toward Solforiz." }),
    distantPlace({ id: "kv-frontier-kwind", name: "Southern customs fort", kind: "frontier", frontierNation: "kwind-09", bearingDeg: 190, distance: 22000, groundElevation: 60, silhouetteHeight: 44, radius: 160, stateSlot: "rival-house", description: "Customs fort on the southern ridge facing the Kwind-09 marches." }),
    distantPlace({ id: "kv-valley-manor", name: "Valley manor of a neighbouring banner", kind: "neighbour-estate", bearingDeg: 200, distance: 1600, groundElevation: -20, silhouetteHeight: 26, radius: 90, description: "Another minor banner's walled manor in the valley; older and better roofed." }),
    distantPlace({ id: "kv-tower-house", name: "Tower-house on the western height", kind: "neighbour-estate", bearingDeg: 255, distance: 2400, groundElevation: 30, silhouetteHeight: 30, radius: 110, description: "Tower-house estate on the western height, its standard always veiled." }),
    distantPlace({ id: "kv-valley-village", name: "Valley village", kind: "village", bearingDeg: 222, distance: 1300, groundElevation: -24, silhouetteHeight: 18, radius: 140, description: "Village of a neighbouring banner's tenants; chimney smoke and a squat bell tower." }),
    distantPlace({ id: "kv-west-abbey", name: "Abbey on the west hill", kind: "monastery", bearingDeg: 285, distance: 2200, groundElevation: 40, silhouetteHeight: 46, radius: 120, description: "Pale abbey on the west hill; its bell carries on still days." }),
    distantPlace({ id: "kv-market-town", name: "Market town on the road", kind: "town", bearingDeg: 300, distance: 7000, groundElevation: -30, silhouetteHeight: 40, radius: 600, description: "Walled market town on the road to the capital: roofs, a cathedral, smoke." }),
    distantPlace({ id: "kv-capital", name: "The capital", kind: "capital", bearingDeg: 312, distance: 20000, groundElevation: 90, silhouetteHeight: 280, radius: 3000, description: "A forest of black spires under the eclipse at the far end of the valley road. Always called simply the capital." }),
  ],
  territories: [
    { id: "kv-terr-holding", name: "The holding's lands", owner: "holding", polygon: [[150, -160], [-60, -165], [-200, -60], [-210, 40], [-150, 110], [-40, 128], [60, 120], [150, 40]] },
    { id: "kv-terr-allied", name: "Lands of the allied Great House", owner: "allied-great-house", polygon: [[-60, -165], [150, -160], [2600, -4200], [-2400, -4400]] },
    { id: "kv-terr-crown", name: "Road and valley (crown)", owner: "crown", polygon: [[-150, 110], [-210, 40], [-4000, 900], [-4000, 1500], [-40, 128]] },
    { id: "kv-terr-valley-banner", name: "Valley manor lands (another banner)", owner: "other-banner", polygon: [[-40, 128], [60, 120], [900, 2600], [-500, 2600]] },
    { id: "kv-terr-abbey", name: "Abbey lands", owner: "church", polygon: [[-200, -60], [-210, 40], [-2600, 1200], [-2800, -900]] },
    { id: "kv-terr-heights", name: "Ravine and eastern heights (wilderness)", owner: "wilderness", polygon: [[150, -160], [150, 40], [2800, 1200], [2600, -4200]] },
  ],
  skyline: [
    { id: "kv-sky-scarp", kind: "ridge", bearingFromDeg: 290, bearingToDeg: 70, distance: 160, height: 34, description: "The scarp crest directly behind the Banner Court." },
    { id: "kv-sky-mountains", kind: "mountains", bearingFromDeg: 300, bearingToDeg: 60, distance: 18000, height: 1400, description: "Snow-streaked peaks of the Grand Duchy's north, pale against the corona." },
    { id: "kv-sky-allied", kind: "spires", bearingFromDeg: 5, bearingToDeg: 11, distance: 3600, height: 96, description: "The allied Great House's spires on the next, higher ridge, above the scarp crest." },
    { id: "kv-sky-capital", kind: "spires", bearingFromDeg: 309, bearingToDeg: 315, distance: 20000, height: 280, description: "The capital's black spires at the end of the valley road." },
    { id: "kv-sky-forest-west", kind: "forest", bearingFromDeg: 200, bearingToDeg: 280, distance: 3000, height: 60, description: "Dark forest on the western heights below the abbey." },
    { id: "kv-sky-smoke", kind: "smoke", bearingFromDeg: 218, bearingToDeg: 226, distance: 1300, height: 70, description: "The valley village's chimney smoke leaning east." },
  ],
};

// --- View corridors and expansion ------------------------------------------------------

const ESTABLISHING_TARGET = [-6, 16, -18] as const;
const establishingPos = cameraFrom(ESTABLISHING_TARGET, 160, 152, 13);

/** A point `length` metres along the sight line from `from` toward a distant place's silhouette top. */
function sightToward(from: readonly [number, number, number], placeId: string, length: number): readonly [number, number, number] {
  const place = outer.places.find((p) => p.id === placeId);
  if (!place) throw new Error(`korvenia: unknown place ${placeId}`);
  const tx = place.position[0] - from[0];
  const ty = place.groundElevation + place.silhouetteHeight - from[1];
  const tz = place.position[1] - from[2];
  const k = length / Math.sqrt(tx * tx + ty * ty + tz * tz);
  return [round2(from[0] + tx * k), round2(from[1] + ty * k), round2(from[2] + tz * k)];
}

const KEEP_TOP_VIEW = [-11, round2(HALL_FLOOR + 24.5), -47] as const;
const marchDir = polar(150, 600, [KEEP_TOP_VIEW[0], KEEP_TOP_VIEW[2]]);

const viewCorridors: BannerholdBlueprint["viewCorridors"] = [
  { id: "kv-vc-approach", name: "Road bend to the Banner Hall", from: [-84, round2(T.height(-84, 28) + 1.7), 28], to: [0, round2(HALL_FLOOR + 17), -27], halfWidth: 1.5, halfWidthFar: 5, purpose: "The reveal on the road: the hall gable and keep spire rise over the West Gate.", allow: ["kv-main-gatehouse", "kv-banner-hall", "kv-court-tower", "kv-west-range"] },
  { id: "kv-vc-capital", name: "Valley approach: the capital beyond the scarp's shoulder", from: establishingPos, to: sightToward(establishingPos, "kv-capital", 600), halfWidth: 3, halfWidthFar: 60, purpose: "The capital's spires show over the western shoulder of the scarp only from the valley; from the keep the scarp hides them. Keep this sight line clear of tall planting.", allow: [] },
  { id: "kv-vc-allied", name: "Valley approach: the allied seat above the scarp", from: establishingPos, to: sightToward(establishingPos, "kv-allied-seat", 600), halfWidth: 3, halfWidthFar: 40, purpose: "From the valley the allied Great House's spires crown the scarp behind the Banner Hall: the banner is small beneath a greater house.", allow: [] },
  { id: "kv-vc-march", name: "Keep over the valley to the southern marches", from: KEEP_TOP_VIEW, to: [marchDir[0], 6, marchDir[1]], halfWidth: 2, halfWidthFar: 30, purpose: "Over the court and the lower town toward the frontier keeps: where a rival's signal fire would show.", allow: ["kv-banner-hall"] },
  { id: "kv-vc-record", name: "War Record door to the Banner Hall", from: [32, round2(RECORD_FLOOR + 1.6), -24.8], to: [2, round2(HALL_FLOOR + 4), -22.4], halfWidth: 0.8, halfWidthFar: 1.2, purpose: "The archive and the hall face each other across the Court Walk.", allow: ["kv-war-record", "kv-banner-hall"] },
  { id: "kv-vc-stair", name: "Muster yard up the stair to the Court Gate", from: [-36, round2(T.height(-36, 10) + 1.7), 10], to: [-11, round2(COURT_GATE_FLOOR + 7), -14.25], halfWidth: 1.5, halfWidthFar: 3, purpose: "From the levy's yard the eye climbs the Muster Stair to the lord's gate.", allow: ["kv-court-gatehouse"] },
];

const expansion: BannerholdBlueprint["expansion"] = [
  { id: "kv-exp-record-gallery", name: "Record Gallery plot", district: "F", polygon: [[26.5, -55.5], [37.5, -55.5], [37.5, -47], [26.5, -47]], intendedUse: "Gallery for honours and returned standards (hall tier 2).", unlocksAtHallTier: 2 },
  { id: "kv-exp-shelf-terrace", name: "East shelf terrace", district: "F", polygon: [[38.4, -50], [44.4, -44], [44.4, -35], [42.4, -33.6], [38.4, -33.6]], intendedUse: "Chapel and solar for the house on the east shelf (hall tier 3).", unlocksAtHallTier: 3 },
  { id: "kv-exp-barbican", name: "Barbican plot", district: "E", polygon: [[-72, 9], [-63, 9], [-63, 25], [-72, 25]], intendedUse: "Barbican and toll house before the West Gate (hall tier 3).", unlocksAtHallTier: 3 },
  { id: "kv-exp-builders-yard", name: "Builder's yard", district: "D", polygon: [[-15.4, 21.4], [-9.2, 21.4], [-9.2, 38.8], [-15.4, 38.8]], intendedUse: "Stable and quarters for a future Knight appointment (reserved).", unlocksAtHallTier: null },
  { id: "kv-exp-east-plots", name: "East plots by the postern", district: "C", polygon: [[49.4, 31.5], [54.4, 31.5], [54.4, 40.5], [49.4, 40.5]], intendedUse: "Houses for the levy's families as representation grows (reserved).", unlocksAtHallTier: null },
];

// --- Cameras, VR staging, atmosphere ---------------------------------------------

const hallTarget = [1, round2(HALL_FLOOR + 10), -27] as const;
const musterTarget = [-23, 1.6, 0] as const;
const recordTarget = [33, round2(RECORD_FLOOR + 8.5), -30] as const;
const heraldTarget = [-51, round2(HERALD_FLOOR + 9.5), 6] as const;
const pawnTarget = [-22, round2(muster.pawnStand.position[1] + 1.3), 0.4] as const;

const cameras: BannerholdBlueprint["cameras"] = [
  camera(
    "establishing",
    "Establishing — the holding from the valley",
    establishingPos,
    ESTABLISHING_TARGET,
    38,
    { yawDeg: [-30, 30], pitchDeg: [2, 26], distance: [110, 200] },
    "Lower third: lower-town roofs stepping toward the ravine and the pale-crowned watchtower; centre: the Banner Hall gable and keep spire on the rock above the Muster Stair; left third: the West Gate and the road falling into the valley toward the capital's spires; top right: the allied Great House's spires above the scarp. Corona light rakes from the left (west-south-west).",
    2.4,
  ),
  camera(
    "founding",
    "Founding — the standard raised over the levy's yard",
    [-12, 4.2, 12.6],
    [-3, 17.5, -19.5],
    52,
    { yawDeg: [-10, 10], pitchDeg: [-24, -14], distance: [30, 40] },
    "From the levy's yard, as the holding's people see it: the court parapet across the lower third, the new standard rising above it against the hall gable and the emblem over the porch, the keep spire and flèche at the top of frame.",
    2.0,
  ),
  camera(
    "landmark:banner-hall",
    "Banner Hall",
    cameraFrom(hallTarget, 162, 50, 14),
    hallTarget,
    40,
    { yawDeg: [-35, 35], pitchDeg: [6, 32], distance: [32, 70] },
    "Over the lower town: hall front, porch and emblem, the keep to the left, the lodging and its oriel to the right, the Court Gate and the idle crane at the left edge.",
  ),
  camera(
    "landmark:muster-grounds",
    "Muster Grounds",
    cameraFrom(musterTarget, 160, 40, 17),
    musterTarget,
    42,
    { yawDeg: [-20, 30], pitchDeg: [14, 38], distance: [24, 60] },
    "From above Gate Street: the dais and its eight file posts, the pawn stand on axis, the Muster Stair climbing the 9 m retaining wall behind them to the Court Gate, the levy hall dwarfed by the rock.",
  ),
  camera(
    "landmark:war-record",
    "War Record",
    cameraFrom(recordTarget, 172, 36, 11),
    recordTarget,
    40,
    { yawDeg: [-30, 25], pitchDeg: [8, 34], distance: [22, 50] },
    "The archive's tall south gable and tracery window, the iron-banded record tower, the gallery bridge to the lodging and the Record Steps falling to Rock Lane.",
  ),
  camera(
    "landmark:heralds-station",
    "Herald's Station",
    cameraFrom(heraldTarget, 150, 31, 10),
    heraldTarget,
    46,
    { yawDeg: [-25, 25], pitchDeg: [10, 34], distance: [22, 44] },
    "From above Gate Street: the herald tower and raven loft, the post room door and notice board, the levy hall beside it and the West Gate towers to the left where the road arrives.",
  ),
  camera(
    "representative",
    "Representative close-up",
    [-22, round2(muster.pawnStand.position[1] + 2.2), 7.6],
    pawnTarget,
    32,
    { yawDeg: [-30, 30], pitchDeg: [2, 20], distance: [5, 10] },
    "Eye-level close-up of the nominated representative on the pawn stand (or the empty stand and sealed writ), the dais, the file posts and the stair behind.",
    1.4,
  ),
];

const KEEP_TOP = round2(HALL_FLOOR + 32);
const VR_SCALE = 0.008;
const DETAIL: { width: number; depth: number } = { width: 130, depth: 124 };
const SEATED = { eyeHeight: 1.2, surfaceHeight: 0.74, viewerDistance: 0.82 };

const vr: BannerholdBlueprint["vr"] = {
  displayScale: VR_SCALE,
  displayCenter: [-2.5, -8.5],
  datumY: 0,
  detailExtent: DETAIL,
  skirtMargins: { far: 150, lateral: 70, near: 0 },
  viewerFacingBearingDeg: 352,
  seated: SEATED,
  standing: { eyeHeight: 1.62, surfaceHeight: 0.98, viewerDistance: 0.85 },
  rotation: { userRotatable: true, yawLimitDeg: 45, snapStepDeg: 15, resetsOnRecentre: true },
  reach: { pokeMax: 0.65, rayMax: 3, minTargetRadius: 0.035 },
  recentre: {
    keepsScale: true,
    keepsYaw: false,
    description: "Recentring re-places the gameplay anchor in front of the viewer; the miniature resets to its authored yaw (the viewer looks toward bearing 352°) and to the posture heights. The viewer is never moved or rotated.",
  },
  horizon: { ringRadius: 8, ringBaseHeight: -0.18, ringHeight: 1.4 },
  panelAnchors: { primary: [-0.74, 0.38, 0.24], dock: [0.64, 0.1, 0.36] },
  anchorConvention:
    "Assumed until gameplay confirms: the parent anchor's origin is the floor point beneath the viewer at recentre, -Z forward, no pitch or roll. The miniature's centre sits at (0, surfaceHeight, -viewerDistance).",
  comfortNotes: [
    `1:${Math.round(1 / VR_SCALE)} puts the ${DETAIL.width} × ${DETAIL.depth} m detail region on a ${(DETAIL.width * VR_SCALE).toFixed(2)} × ${(DETAIL.depth * VR_SCALE).toFixed(2)} m surface; the keep spire tip (${KEEP_TOP} m) rises ${(KEEP_TOP * VR_SCALE).toFixed(2)} m, below seated eye height.`,
    `Near edge ${(SEATED.viewerDistance - (DETAIL.depth * VR_SCALE) / 2).toFixed(2)} m from the eyes seated: close enough to lean in, far enough not to clip the head.`,
    "The scarp behind the holding rises as a backdrop beyond the far edge, never between the viewer and the town.",
    "No artificial viewer motion: focusLandmark raises the landmark's emphasis and label only.",
  ],
};

const atmosphere: BannerholdBlueprint["atmosphere"] = {
  timeOfDay: "Eclipse noon: the sun held behind the black disc, a corona low in the west-south-west and a dusk band all round the horizon",
  sun: { bearingDeg: 245, elevationDeg: 20, colour: "#cfc6dc", intensity: 1.6, disc: "eclipse-corona" },
  sky: { zenith: "#24202f", horizon: "#8c7a86", ground: "#2a2520", ambientIntensity: 0.55 },
  fog: { colour: "#6c6273", near: 140, far: 1500, heightFalloff: 0.012 },
  wind: { towardBearingDeg: 70, speed: 4.5, gustiness: 0.35 },
  exposure: 1.0,
  accentLights: [
    { kind: "brazier", colour: "#ffad5c", note: "Banner Court braziers flanking the hall porch." },
    { kind: "ritual-candle", colour: "#ffd9a0", note: "Honour Court niches and the Lantern Shrine." },
    { kind: "furnace", colour: "#ff6a1a", note: "Smithy forge mouth." },
    { kind: "lantern", colour: "#ffb870", note: "Lantern Street, the gate passage and the herald's door." },
  ],
  palette: {
    basalt: "#2e2c31",
    slate: "#3a3d45",
    limestoneRepair: "#a59f92",
    oak: "#4a3a2c",
    plaster: "#b9b0a0",
    heath: "#5f5263",
    moss: "#4d5a3a",
    purpure: "#5e3a78",
    gilt: "#c9a23a",
    corona: "#e8e0f0",
    crownField: "#4b3462",
    crownBorder: "#b7954a",
  },
  notes: "Silhouette-first: dark masses against the luminous horizon band. Warm accents are small and local; no global bloom. Shadows are long and violet, the ambient never black.",
};

// --- Districts, traditions and the blueprint -------------------------------------

const districts: BannerholdBlueprint["districts"] = [
  { id: "A", name: "Banner Court", role: "Banner Hall and keep, the Lodging, kitchen range, the unfinished West Range, the Court Gate and the Honour Court, on the rock at +9 m.", polygon: COURT },
  { id: "B", name: "Muster Terrace", role: "Dais, file posts, pawn stand, drill square, armoury and levy hall beneath the court's retaining wall.", polygon: [[-47, -12.6], [-30.5, -11.8], [-8.2, -11.8], [-8.2, 14.6], [-47, 14.6]] },
  { id: "C", name: "Lower Town", role: "Lantern Street, Rock Lane, Wall Lane and the Well Square: houses of every condition, the shrine and back yards.", polygon: [[-8.2, -11.8], [22.8, -11.8], [23.4, -19.4], [45.4, -19.8], [46.2, -21], [55, -6], [57, 10], [56.6, 30], [46, 44], [10, 46.6], [-8.3, 46.2], [-8.3, 20.2], [-8.2, 14.6]] },
  { id: "D", name: "Forge and Granary Yards", role: "Smithy, workshop, granary, tithe barn and the builder's yard south of Gate Street.", polygon: [[-47, 19.8], [-8.3, 20.2], [-8.3, 46.2], [-26, 46], [-46, 44], [-47, 32.2]] },
  { id: "E", name: "West Gate and Herald's Station", role: "Gatehouse, herald tower and post room, post stable.", polygon: [[-62.5, 9], [-58.4, -2], [-52, -14], [-47, -12.6], [-47, 32.2], [-56, 32.2], [-62.5, 25]] },
  { id: "F", name: "Record Shelf", role: "The War Record, its record tower and gallery bridge, on a shelf at +6.5 m joined to the Lodging.", polygon: SHELF },
];

const traditions: BannerholdBlueprint["traditions"] = [
  { key: GOTHIC, name: "Ashlar Gothic", description: "Dark basalt ashlar, pointed lancets, stepped buttresses, steep (55–62°) slate roofs, lead-capped spires and tall narrow gables, black marble only where a house could afford it. Reserved for lordly, civic and sacred buildings.", materials: [ASHLAR, SLATE, LEAD, MARBLE] },
  { key: JETTY, name: "Rubble and jetty", description: "Rubble basalt ground storey on a stepped plinth, jettied oak-framed upper storeys with lime plaster, steep slate or shingle roofs. The common house of the lower town.", materials: [RUBBLE, FRAME, SLATE, SHINGLE] },
  { key: COTTAGE, name: "Labourer's cottage", description: "Low rubble walls, dark thatch or shingle, small deep windows; the poorest and oldest dwellings, and lean-tos against the rock.", materials: [RUBBLE, THATCH, SHINGLE] },
];

const settlementBoundary: Vec2[] = [
  [-31.8, -59.2], [-14.2, -64.4], [23.2, -64.4], [41.8, -57.6], [47.2, -41], [47.2, -21.6], [56, -6.2], [58, 10], [57.6, 30.4], [46.6, 45.2],
  [10, 47.6], [-26, 47], [-46.6, 45], [-57, 32.2], [-63, 25.5], [-63, 9], [-59.2, -2], [-52.6, -15], [-31.8, -13.4],
];

export const KORVENIA_BLUEPRINT: BannerholdBlueprint = {
  schema: 1,
  nationId: "korvenia",
  siteName: "The holding on the scarp",
  status: "production-default",
  summary:
    "A vertical Gothic holding on a basalt spur: the Banner Court on the rock at +9 m and the War Record on its shelf at +6.5 m, the Muster Terrace levelled at 0 m beneath the court's retaining wall inside the West Gate, and a lower town of narrow, stepping streets falling to −5 m toward the ravine. The road leaves the West Gate, crosses the valley and climbs toward the capital 20 km to the north-west.",
  terrain,
  settlementBoundary,
  coreReference: { width: 121, depth: 112 },
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
  unfinished: { buildingId: "kv-west-range", description: "The West Range of the Banner Court: walls to 4 m, scaffold and treadwheel crane; completes at hall tier 1." },
  slots,
  story,
  vegetation,
  dressing,
  activitySites,
  npcs,
  outer,
  viewCorridors,
  expansion,
  observation: { position: establishingPos, target: ESTABLISHING_TARGET, description: "From above the valley meadow south-south-east of the holding, the way a messenger first sees it coming up the valley." },
  cameras,
  vr,
  atmosphere,
};
