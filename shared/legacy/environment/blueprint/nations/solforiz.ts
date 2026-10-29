// SOLFORIZ — the terraced holding (working placeholder name). First-pass layout for the shared
// pipeline; every name and story line is a working placeholder pending creator approval.
//
// Terrain logic: an engineered cascade. Four level terraces (+14, +8, +2, −3 m) are cut into an
// escarpment that falls from a plateau in the north-west to a mineral basin in the south-east.
// Organisation: one axial spine — a covered market street climbing straight from the basin gate
// to the manor gate — with a stone rill beside it carrying water down from the manor's cistern
// to a reservoir and the oasis gardens outside the walls. Courtyard houses turn blank walls to a
// shaded blind lane; the sulfur works and domed granaries fill the market terrace; the
// palace-like manor, its great windcatcher and the domed War Record crown the top terrace.
// Everything is authored in a local frame (local +Z runs downhill to the south-east).

import { building, camera, cameraFrom, distantPlace, groundTools, mass, poseRow, siteFrame } from "../authoring";
import type { MassInput } from "../authoring";
import { resolveBuildingBase } from "../buildings";
import { round2 } from "../math2d";
import { createTerrainSampler } from "../terrain";
import type { BannerholdBlueprint, Building, NpcAgent, Route, TerrainFeature, TerrainModel, Vec2, Vec3, WaterBody } from "../types";

/** Local frame: +X runs north-east along the terraces, +Z runs downhill to the south-east. */
const F = siteFrame([0, 0], 45);
const P = F.p;
/** Local rectangle as a world-rotated rect shape. */
const rect = (lx0: number, lz0: number, lx1: number, lz1: number) => ({ kind: "rect" as const, center: P((lx0 + lx1) / 2, (lz0 + lz1) / 2), width: lx1 - lx0, depth: lz1 - lz0, rotationDeg: F.rot() });
const poly = (pts: readonly (readonly [number, number])[]): Vec2[] => F.pts(pts);
/** Mass authored in local coordinates (centre lx, lz). */
const M = (m: Omit<MassInput, "at" | "rot"> & { lx: number; lz: number; rot?: number }): Building["masses"][number] => {
  const { lx, lz, rot, ...rest } = m;
  return mass({ ...rest, at: P(lx, lz), rot: F.rot(rot ?? 0) });
};
/** World bearing of a local bearing (0 uphill/north-west, 90 north-east, 180 downhill/south-east, 270 south-west). */
const LB = F.bearing;

const T3 = 14;
const T2 = 8;
const T1 = 2;
const T0 = -3;

// --- Terrain ----------------------------------------------------------------

const wadi = poly([[-92, -170], [-84, -100], [-78, -30], [-74, 40], [-64, 110], [-40, 190]]);

const features: TerrainFeature[] = [
  { kind: "slope", gradient: [-0.085, -0.085] },
  { kind: "ridge", id: "sf-escarpment", points: poly([[-260, -96], [-100, -94], [0, -92], [120, -95], [260, -98]]), width: 66, height: 21, surface: "rock" },
  { kind: "noise", seed: 4111, amplitude: 0.9, wavelength: 40, octaves: 3 },
  // Bedded strata on the cliff face: ridged noise inside the escarpment band only.
  { kind: "noise", seed: 4127, amplitude: 3.2, wavelength: 13, octaves: 2, style: "ridged", region: { kind: "polygon", points: poly([[-260, -128], [260, -128], [260, -64], [-260, -64]]) }, regionFalloff: 6 },
  { kind: "mound", id: "sf-sulfur-dome-1", center: P(64, 124), radiusX: 20, radiusZ: 14, rotationDeg: 30, height: 3.5, surface: "sulfur-crust" },
  { kind: "mound", id: "sf-salt-dome", center: P(-96, 150), radiusX: 26, radiusZ: 18, height: 2.4, surface: "salt-flat" },
  { kind: "mound", id: "sf-sulfur-hollow", center: P(30, 150), radiusX: 13, radiusZ: 10, height: -2.2, surface: "sulfur-crust" },
  { kind: "channel", id: "sf-wadi", points: wadi, width: 6, depth: 3.5, bankWidth: 9, surface: "gravel" },
  // The plateau behind the escarpment and the basin flats below the holding.
  { kind: "platform", id: "sf-plateau", shape: rect(-300, -260, 300, -112), elevation: 34, falloff: 24, surface: "rock", edge: "cliff" },
  { kind: "platform", id: "sf-basin", shape: rect(-300, 78, 300, 300), elevation: -13, falloff: 36, surface: "salt-flat", edge: "slope" },
  // Terraces, lowest first so each upper terrace keeps a crisp retaining-wall edge.
  { kind: "platform", id: "sf-terrace-0", shape: rect(-52, 18, 52, 38.5), elevation: T0, falloff: 1.2, surface: "paving", edge: "retaining-wall" },
  { kind: "platform", id: "sf-terrace-1", shape: rect(-52, -6, 52, 18), elevation: T1, falloff: 0.8, surface: "paving", edge: "retaining-wall" },
  { kind: "platform", id: "sf-terrace-2", shape: rect(-52, -31, 52, -6), elevation: T2, falloff: 0.8, surface: "earth", edge: "retaining-wall" },
  { kind: "platform", id: "sf-terrace-3", shape: rect(-52, -61, 52, -31), elevation: T3, falloff: 0.8, surface: "paving", edge: "retaining-wall" },
  { kind: "platform", id: "sf-gate-apron", shape: rect(-12, 38.5, 12, 50), elevation: -4.6, falloff: 6, surface: "sand", edge: "slope" },
  { kind: "platform", id: "sf-reservoir-basin", shape: rect(-29, 45, -11, 54), elevation: -7.4, falloff: 2, surface: "paving", edge: "steps" },
  // Stairs and ramps graded between terraces.
  { kind: "ramp", id: "sf-gate-stair", points: poly([[0, 26], [0, 18]]), width: 5, startElevation: T0, endElevation: T1, falloff: 0.6, surface: "paving" },
  { kind: "ramp", id: "sf-market-stair", points: poly([[0, -1.5], [0, -9.5]]), width: 4.6, startElevation: T1, endElevation: T2, falloff: 0.6, surface: "paving" },
  { kind: "ramp", id: "sf-manor-stair", points: poly([[0, -21], [0, -31.2]]), width: 6, startElevation: T2, endElevation: T3, falloff: 0.6, surface: "paving" },
  { kind: "ramp", id: "sf-barrack-ramp-low", points: poly([[46, 21], [46, 13]]), width: 4, startElevation: T0, endElevation: T1, falloff: 0.8, surface: "sand" },
  { kind: "ramp", id: "sf-barrack-ramp-high", points: poly([[46, -2], [46, -10.5]]), width: 4, startElevation: T1, endElevation: T2, falloff: 0.8, surface: "sand" },
  { kind: "ramp", id: "sf-cistern-stair-cut", points: poly([[47, -29.4], [47, -39.6]]), width: 2.4, startElevation: T2, endElevation: T3, falloff: 0.6, surface: "paving" },
  { kind: "ramp", id: "sf-rim-stair-cut", points: poly([[18, -59.6], [24, -70], [30, -84]]), width: 2.4, startElevation: T3, endElevation: 30.5, falloff: 0.8, surface: "rock" },
];

const EXTENTS = { minX: -200, maxX: 200, minZ: -180, maxZ: 180 };
const natural = createTerrainSampler({ extents: EXTENTS, baseElevation: 0, baseSurface: "sand", features, water: [], surfaces: [], logic: "" });
const levels = (points: readonly Vec2[], above: number): number[] => points.map((p) => round2(natural.height(p[0], p[1]) + above));

const rill = poly([[-2, -36], [-2, -31.4], [-2, -21], [-2, -9.4], [-2, -1.6], [-2, 16], [-2, 33], [-6, 40], [-14, 46.5]]);
const water: WaterBody[] = [
  { id: "sf-cistern", kind: "cistern", shape: { kind: "area", points: poly([[-3, -40], [3, -40], [3, -36.6], [-3, -36.6]]) }, level: T3 + 0.25, flow: 0, note: "The manor's cistern pool, fed by the channel from the plateau springs; every other drop in the holding passes through here first." },
  { id: "sf-rill", kind: "rill", shape: { kind: "line", points: rill, width: 0.6 }, level: 0, pointLevels: levels(rill, 0.12), flow: 0.8, note: "Stone channel along the spine, dropping in small cascades at each terrace, with a public basin by the market." },
  { id: "sf-reservoir", kind: "reservoir", shape: { kind: "area", points: poly([[-28, 46], [-12, 46], [-12, 53], [-28, 53]]) }, level: -6.7, flow: 0, note: "Stepped reservoir outside the lower wall that waters the oasis gardens." },
  { id: "sf-sulfur-pool", kind: "pond", shape: { kind: "area", points: poly([[24, 145], [36, 146], [37, 154], [25, 156]]) }, level: round2(natural.height(P(30, 150)[0], P(30, 150)[1]) + 0.9), flow: 0, note: "A yellow-green mineral pool in the basin crust; nobody drinks from it." },
];

const terrain: TerrainModel = {
  extents: EXTENTS,
  baseElevation: 0,
  baseSurface: "sand",
  features,
  water,
  surfaces: [
    { id: "sf-parade-sand", surface: "sand", shape: rect(14, -29.5, 49, -7) },
    { id: "sf-works-yard", surface: "slag", shape: rect(18, -5, 46, 9) },
    { id: "sf-manor-court", surface: "paving", shape: rect(-12, -43.6, 12, -34.4) },
    { id: "sf-oasis-soil", surface: "field", shape: { kind: "polygon", points: poly([[-92, 58], [-70, 52], [-48, 55], [-33, 56], [-27, 70], [-30, 88], [-26, 104], [-44, 110], [-66, 108], [-88, 113], [-97, 96], [-94, 76]]) } },
    { id: "sf-basin-crust", surface: "sulfur-crust", shape: { kind: "polygon", points: poly([[8, 118], [30, 108], [58, 113], [84, 103], [110, 107], [126, 124], [134, 148], [126, 172], [104, 182], [80, 176], [54, 186], [26, 180], [6, 168], [14, 146]]) } },
    { id: "sf-basin-salt", surface: "salt-flat", shape: { kind: "polygon", points: poly([[-60, 140], [-30, 132], [-8, 140], [-4, 162], [-24, 176], [-52, 172], [-68, 158]]) } },
  ],
  logic:
    "An escarpment falls from a plateau (+34 m) in the north-west to a mineral basin (−13 m) in the south-east. The holding is an engineered cascade of four level terraces — the manor at +14 m, houses and the parade court at +8 m, the market and works at +2 m, the gate court at −3 m — held by thick retaining walls and joined by stairs on one axial spine. A dry wadi runs past the south-west wall; a stone rill carries the manor's cistern water down the spine to a reservoir and the oasis gardens.",
};

const T = createTerrainSampler(terrain);
const G = groundTools(T);
/** Ground pose at a local point facing a local bearing. */
const LP = (lx: number, lz: number, localBearing: number, dy = 0) => { const p = P(lx, lz); return G.facing(p[0], p[1], LB(localBearing), dy); };
const LG = (lx: number, lz: number, dy = 0): Vec3 => { const p = P(lx, lz); return G.ground(p[0], p[1], dy); };
/** Local point at an explicit height. */
const L3 = (lx: number, y: number, lz: number): Vec3 => { const p = P(lx, lz); return [p[0], round2(y), p[1]]; };

// --- Materials --------------------------------------------------------------------

const SANDSTONE = "sf-sandstone-ashlar";
const RUBBLE = "sf-sandstone-rubble";
const MUDBRICK = "sf-mudbrick-plaster";
const PLASTER = "sf-lime-plaster";
const TILE = "sf-glazed-tile";
const PALM = "sf-palm-timber";
const IRON = "sf-iron-sheet";

// --- Circulation ------------------------------------------------------------------

const route = (r: Omit<Route, "grade" | "covered" | "outer" | "points"> & { pts: readonly (readonly [number, number])[] } & Partial<Pick<Route, "grade" | "covered" | "outer">>): Route => {
  const { pts, ...rest } = r;
  return { grade: "ground", covered: false, outer: false, points: poly(pts), ...rest };
};

const routes: Route[] = [
  route({
    id: "sf-national-road",
    name: "The causeway to the capital",
    kind: "causeway",
    hierarchy: "national",
    pts: [[0, 38], [0, 46], [2, 70], [6, 110], [14, 180], [30, 320], [60, 800], [120, 2400], [260, 7000]],
    width: 6,
    surface: "gravel",
    users: ["merchants", "messengers", "carts", "beasts", "soldiers", "nobility"],
    outer: true,
  }),
  route({ id: "sf-gate-stair", name: "Gate Stair", kind: "stair", hierarchy: "primary", pts: [[0, 38], [0, 34], [0, 26], [0, 18]], width: 5, surface: "sandstone-paving", users: ["merchants", "messengers", "residents", "beasts"] }),
  route({ id: "sf-market-street", name: "The Covered Market", kind: "covered-street", hierarchy: "primary", pts: [[0, 18], [0, 7], [0, -1.5]], width: 4, surface: "sandstone-paving", covered: true, users: ["merchants", "residents", "messengers", "workers"] }),
  route({ id: "sf-market-stair", name: "Market Stair", kind: "stair", hierarchy: "primary", pts: [[0, -1.5], [0, -9.5]], width: 4.6, surface: "sandstone-paving", users: ["residents", "messengers", "soldiers"] }),
  route({ id: "sf-manor-way", name: "Manor Way", kind: "street", hierarchy: "primary", pts: [[0, -9.5], [0, -14], [0, -17.5], [0, -21]], width: 4, surface: "sandstone-paving", users: ["residents", "messengers", "nobility", "soldiers"] }),
  route({ id: "sf-manor-stair", name: "The Manor Stair", kind: "stair", hierarchy: "pedestrian", pts: [[0, -21], [0, -31.2], [0, -34.6]], width: 6, surface: "sandstone-paving", users: ["nobility", "messengers", "soldiers"] }),
  route({ id: "sf-manor-court", name: "Manor Court", kind: "path", hierarchy: "pedestrian", pts: [[0, -34.6], [9, -35.5], [9.5, -42.2], [0, -42.4], [-9.5, -42.2], [-9, -35.5], [0, -34.6]], width: 2.4, surface: "flagstone", users: ["nobility", "residents"] }),
  route({ id: "sf-back-passage", name: "Back Passage", kind: "alley", hierarchy: "service", pts: [[9.5, -42.2], [11, -44], [11, -46.2], [12.8, -51.4], [17.6, -51.4], [18, -57.7]], width: 1.6, surface: "flagstone", users: ["residents"] }),
  route({ id: "sf-rim-stair", name: "Rim Stair", kind: "stair", hierarchy: "pedestrian", pts: [[18, -57.7], [18, -59.6], [24, -70], [30, -84], [34.6, -86.4]], width: 2.2, surface: "flagstone", users: ["soldiers"] }),
  route({ id: "sf-shade-lane", name: "Shade Lane", kind: "lane", hierarchy: "pedestrian", pts: [[-2, -17.5], [-20, -17.5], [-37, -17.5], [-49, -17.5]], width: 2.4, surface: "sandstone-paving", users: ["residents"] }),
  route({ id: "sf-parade-lane", name: "Parade Lane", kind: "lane", hierarchy: "pedestrian", pts: [[2, -14], [14, -14], [20, -14]], width: 2.6, surface: "sandstone-paving", users: ["soldiers", "residents"] }),
  route({ id: "sf-dais-walk", name: "Dais Walk", kind: "path", hierarchy: "pedestrian", pts: [[20, -14], [20, -25], [31, -25.2]], width: 2, surface: "sand", users: ["soldiers"] }),
  route({ id: "sf-parade-court", name: "Parade Court", kind: "path", hierarchy: "pedestrian", pts: [[20, -14], [46, -13]], width: 3, surface: "sand", users: ["soldiers"] }),
  route({ id: "sf-cistern-stair", name: "Cistern Stair", kind: "stair", hierarchy: "service", pts: [[46, -13], [47, -16], [47, -29.6], [47, -39.6]], width: 2.4, surface: "sandstone-paving", users: ["workers", "soldiers"] }),
  route({ id: "sf-cistern-walk", name: "Cistern Walk", kind: "path", hierarchy: "service", pts: [[47, -39.6], [40, -40.2], [33, -40.2]], width: 2.4, surface: "flagstone", users: ["workers"] }),
  route({ id: "sf-barrack-road", name: "Barrack Road", kind: "road", hierarchy: "secondary", pts: [[2, 21.5], [20, 21.5], [40, 21.5], [46, 21], [46, 13], [46, -2], [46, -10.5], [46, -13]], width: 4, surface: "sand", users: ["soldiers", "carts", "beasts"] }),
  route({ id: "sf-works-lane", name: "Works Lane", kind: "lane", hierarchy: "service", pts: [[2, 11], [24, 11], [44, 11], [46, 11]], width: 3, surface: "packed-earth", users: ["workers", "carts"] }),
  route({ id: "sf-grain-lane", name: "Grain Lane", kind: "lane", hierarchy: "service", pts: [[-2, 11], [-20, 11], [-45, 11]], width: 2.6, surface: "packed-earth", users: ["workers", "carts"] }),
  route({ id: "sf-caravan-gate", name: "Caravan Gate", kind: "path", hierarchy: "secondary", pts: [[-2.5, 27.4], [-12, 27.3]], width: 3, surface: "sandstone-paving", users: ["merchants", "beasts"] }),
  route({ id: "sf-herald-yard", name: "Herald's Yard", kind: "path", hierarchy: "secondary", pts: [[2.5, 31], [9.5, 31]], width: 2.4, surface: "sandstone-paving", users: ["messengers"] }),
  route({ id: "sf-oasis-track", name: "Oasis Track", kind: "track", hierarchy: "service", pts: [[-2.5, 45], [-20, 57], [-40, 72], [-70, 96]], width: 2.6, surface: "packed-earth", users: ["workers", "beasts"], outer: true }),
  route({ id: "sf-basin-track", name: "Crust Track", kind: "track", hierarchy: "service", pts: [[4, 72], [16, 110], [26, 136]], width: 2.4, surface: "sand", users: ["workers"], outer: true }),
  route({ id: "sf-qanat-path", name: "Channel Path", kind: "path", hierarchy: "service", pts: [[34.6, -86.4], [10, -110], [-20, -150]], width: 1.8, surface: "packed-earth", users: ["workers"], outer: true }),
];

const destinations: BannerholdBlueprint["destinations"] = [
  { id: "gate", label: "Basin Gate", position: P(0, 38) },
  { id: "manor", label: "Manor gate", position: P(0, -31.2) },
  { id: "muster", label: "Parade court", position: P(31, -18) },
  { id: "residential", label: "Shade Lane", position: P(-20, -17.5) },
  { id: "artisan", label: "Works Lane", position: P(24, 11) },
  { id: "archive", label: "War Record door", position: P(15, -39) },
  { id: "herald", label: "Herald's Station door", position: P(9.5, 31) },
  { id: "ceremonial", label: "Court of Honours", position: P(0, -42) },
];

// --- Architecture ---------------------------------------------------------------

const CUT = "sf-cut-sandstone";
const COURT = "sf-courtyard-house";
const WORKS = "sf-works";

const civic: Building[] = [
  // A — Central Manor and Banner Hall (top terrace, +14 m)
  building({
    id: "sf-banner-hall",
    name: "The Banner Hall",
    district: "A",
    fn: "banner-hall",
    tradition: CUT,
    masses: [
      M({ id: "hall", role: "hall", lx: 0, lz: -51.5, w: 20, d: 11, storeys: 2, eave: 10, ridge: 11.2, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
      M({ id: "iwan", role: "porch", lx: 0, lz: -44.8, w: 8, d: 2.4, storeys: 2, eave: 13, ridge: 14, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
      M({ id: "dome", role: "vault", lx: 0, lz: -51.5, w: 9, d: 9, plan: "round", storeys: 1, eave: 1.6, ridge: 8.4, roof: "dome", roofMat: TILE, wallMat: SANDSTONE, baseOffset: 11 }),
      M({ id: "windcatcher", role: "windcatcher", lx: 13, lz: -55, w: 4.5, d: 4.5, storeys: 6, eave: 21, ridge: 22.5, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
    ],
    door: P(0, -43.6),
    facing: LB(180),
    foundation: { kind: "podium", plinth: 0.8, maxRelief: 1.5 },
    era: "predecessor",
    built: 160,
    condition: "worn",
    repairs: [
      { kind: "rebuilt-courses", note: "Windcatcher's upper vents rebuilt in fresher, yellower stone after a storm toppled them.", mass: "windcatcher" },
      { kind: "fresh-render", note: "Iwan face re-plastered for the founding; the carved band beneath it is sand-worn smooth.", mass: "iwan" },
      { kind: "boarded-opening", note: "Two upper lattices shuttered: the house cannot staff the whole hall.", mass: "hall" },
    ],
    quality: "noble",
    social: "lord",
    lod: "hero",
    kit: "sf.manor.banner-hall",
    landmark: "banner-hall",
    tags: ["banner-mount", "emblem", "iwan", "dome", "windcatcher", "carved-frieze", "lattice-screens", "braziers"],
    story: "Built by the house that held the terraces before this banner: its great windcatcher is the tallest thing in the holding, its dome glazed in an old green the banner could not afford today.",
  }),
  building({
    id: "sf-lodging",
    name: "The Household Wing",
    district: "A",
    fn: "manor-house",
    tradition: CUT,
    masses: [
      M({ id: "wing", role: "wing", lx: -20, lz: -44.5, w: 10, d: 22, storeys: 3, eave: 10.5, ridge: 11.3, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
      M({ id: "windcatcher", role: "windcatcher", lx: -22.5, lz: -52, w: 2.5, d: 2.5, storeys: 4, eave: 15, ridge: 15.8, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
      M({ id: "arcade", role: "arcade", lx: -13.5, lz: -39, w: 3, d: 10, storeys: 1, eave: 4.6, ridge: 5, roof: "flat", roofMat: PLASTER, wallMat: SANDSTONE }),
    ],
    door: P(-15, -39),
    facing: LB(90),
    foundation: { kind: "podium", plinth: 0.6, maxRelief: 1.5 },
    era: "predecessor",
    built: 140,
    condition: "sound",
    repairs: [{ kind: "lime-wash", note: "Court arcade lime-washed for the founding.", mass: "arcade" }],
    quality: "fine",
    social: "lord",
    lod: "hero",
    kit: "sf.manor.lodging",
    tags: ["windcatcher", "lattice-screens", "arcade", "roof-terrace"],
    story: "Where the household lives: shaded rooms around the court, its small windcatcher turned toward the evening wind.",
  }),
  building({
    id: "sf-manor-gatehouse",
    name: "Manor Gate",
    district: "A",
    fn: "gatehouse",
    tradition: CUT,
    masses: [M({ id: "portal", role: "gatehouse", lx: 0, lz: -32.8, w: 10, d: 3.2, storeys: 2, eave: 10, ridge: 11, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE })],
    door: P(0, -31.2),
    facing: LB(180),
    foundation: { kind: "plinth", plinth: 0.3, maxRelief: 1.6 },
    era: "predecessor",
    built: 160,
    condition: "worn",
    repairs: [{ kind: "replaced-gate", note: "New palm-timber gate leaves hung at the founding.", mass: "portal" }],
    quality: "fine",
    social: "martial",
    lod: "mid",
    kit: "sf.fort.manor-gate",
    tags: ["banner-mount", "lanterns", "carved-frieze"],
    story: "A tall blank portal at the head of the Manor Stair; nothing of the court shows from below.",
    overlap: ["sf-manor-stair", "sf-manor-curtain", "sf-manor-court"],
  }),
  building({
    id: "sf-cistern-house",
    name: "New Cistern House (unfinished)",
    district: "A",
    fn: "cistern-house",
    tradition: CUT,
    masses: [
      M({ id: "walls", role: "vault", lx: 35, lz: -48, w: 10, d: 12, storeys: 1, eave: 3.4, ridge: 3.4, roof: "open-frame", roofMat: PALM, wallMat: SANDSTONE }),
      M({ id: "scaffold", role: "scaffold", lx: 40.8, lz: -48, w: 1.6, d: 12, storeys: 2, eave: 6.8, ridge: 6.8, roof: "open-frame", roofMat: PALM, wallMat: PALM }),
    ],
    door: P(35, -42),
    facing: LB(180),
    era: "under-construction",
    built: 0,
    condition: "under-construction",
    quality: "fine",
    social: "civic",
    lod: "hero",
    kit: "sf.water.cistern-house",
    tags: ["scaffold", "stone-pile", "dressed-blocks", "water-channel"],
    story: "A second cistern cut into the terrace and walled to 3 m: when it is roofed, the holding can feed twice the gardens.",
    unfinished: { stage: "walls", completesAtHallTier: 1, scaffold: true },
  }),
  // F — War Record (domed archive on the court's east side, joined to the hall by its arcade)
  building({
    id: "sf-war-record",
    name: "The War Record",
    district: "F",
    fn: "archive",
    tradition: CUT,
    masses: [
      M({ id: "archive", role: "hall", lx: 20, lz: -42, w: 10, d: 16, storeys: 2, eave: 9, ridge: 9.8, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
      M({ id: "dome", role: "vault", lx: 20, lz: -42, w: 7, d: 7, plan: "round", storeys: 1, eave: 1.2, ridge: 6.6, roof: "dome", roofMat: TILE, wallMat: SANDSTONE, baseOffset: 9.8 }),
      M({ id: "arcade", role: "arcade", lx: 13.5, lz: -39, w: 3, d: 10, storeys: 1, eave: 4.6, ridge: 5, roof: "flat", roofMat: PLASTER, wallMat: SANDSTONE }),
    ],
    door: P(15, -39),
    facing: LB(270),
    foundation: { kind: "podium", plinth: 0.6, maxRelief: 1.5 },
    era: "predecessor",
    built: 120,
    condition: "weathered",
    repairs: [
      { kind: "re-shingled", note: "A ring of dome tiles replaced in plain fired clay among the green.", mass: "dome" },
      { kind: "iron-strapping", note: "Iron cramps across a crack in the drum.", mass: "dome" },
    ],
    quality: "fine",
    social: "civic",
    lod: "hero",
    kit: "sf.record.archive",
    landmark: "war-record",
    tags: ["war-table", "ledgers", "shelving-niches", "dome", "lattice-screens", "arcade"],
    story: "Cool, dim and lined with niches: the previous house's tablets fill the lower ones; the banner's War Record has begun on a single shelf by the door.",
    overlap: ["sf-banner-hall"],
  }),
  building({
    id: "sf-record-gallery",
    name: "Record Gallery (development)",
    district: "F",
    fn: "archive",
    tradition: CUT,
    masses: [M({ id: "gallery", role: "wing", lx: 35, lz: -35.25, w: 9, d: 5.5, storeys: 2, eave: 6, ridge: 6.6, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE })],
    door: P(30.5, -35.25),
    facing: LB(270),
    era: "recent",
    built: 0,
    condition: "new",
    quality: "fine",
    social: "civic",
    kit: "sf.record.gallery",
    tags: ["banner-mount", "honour-wall"],
    story: "Appears only when recognition reaches hall tier 2: a gallery for honours beside the War Record.",
    tier: 2,
  }),
];

const yards: Building[] = [
  // B — Muster Grounds: a walled sand parade court on the +8 m terrace
  building({
    id: "sf-muster-dais",
    name: "Parade Dais",
    district: "B",
    fn: "muster-platform",
    tradition: CUT,
    masses: [M({ id: "dais", role: "platform", lx: 31, lz: -28.2, w: 18, d: 3.2, storeys: 1, eave: 1.2, ridge: 1.2, roof: "none", roofMat: SANDSTONE, wallMat: SANDSTONE })],
    door: P(31, -26.6),
    facing: LB(180),
    foundation: { kind: "flush", plinth: 0, maxRelief: 0.5 },
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "salvaged-stone", note: "Steps reused from the previous house's fallen gate.", mass: "dais" }],
    quality: "common",
    social: "martial",
    lod: "hero",
    kit: "sf.muster.dais",
    landmark: "muster-grounds",
    tags: ["banner-mount", "file-markers", "awning-posts"],
    story: "Stepped stone against the manor terrace's retaining wall: the levy is named here before the National Muster, the manor's portal looming above.",
  }),
  building({
    id: "sf-armoury",
    name: "Armoury",
    district: "B",
    fn: "armoury",
    tradition: COURT,
    masses: [M({ id: "store", role: "house", lx: 41, lz: -21, w: 6, d: 10, storeys: 1, eave: 5, ridge: 5.6, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK })],
    door: P(41, -16),
    facing: LB(180),
    era: "founding",
    built: 2,
    condition: "sound",
    quality: "common",
    social: "martial",
    kit: "sf.muster.armoury",
    tags: ["weapon-rack", "shields", "awning"],
    story: "Thick mud walls keep the few spears cool; half the racks stand empty.",
  }),
  building({
    id: "sf-barracks",
    name: "Levy House",
    district: "B",
    fn: "barracks",
    tradition: COURT,
    masses: [M({ id: "range", role: "house", lx: 34, lz: -8.5, w: 16, d: 4.6, storeys: 1, eave: 4.4, ridge: 5, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK })],
    door: P(34, -10.8),
    facing: LB(0),
    era: "founding",
    built: 2,
    condition: "worn",
    repairs: [{ kind: "tarpaulin", note: "Canvas stretched over a split roof beam.", mass: "range" }],
    quality: "poor",
    social: "martial",
    kit: "sf.muster.levy-house",
    tags: ["awning", "water-jars", "cooking-fire", "sleeping-mats"],
    story: "One long low room on the terrace edge: the levy sleeps on the roof in the hot months.",
  }),
  // E — Herald's Station and Main Gate (lowest terrace, −3 m)
  building({
    id: "sf-herald-station",
    name: "Herald's Station",
    district: "E",
    fn: "herald-station",
    tradition: CUT,
    masses: [
      M({ id: "signal-tower", role: "tower", lx: 13, lz: 26, w: 5, d: 5, storeys: 4, eave: 16, ridge: 17.2, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
      M({ id: "post-court", role: "house", lx: 13, lz: 31, w: 7, d: 4.5, storeys: 1, eave: 6, ridge: 6.6, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
    ],
    door: P(9.5, 31),
    facing: LB(270),
    foundation: { kind: "plinth", plinth: 0.3, maxRelief: 1.5 },
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "new-timber", note: "Signal mirror frame on the tower top renewed in palm timber.", mass: "signal-tower" }],
    quality: "common",
    social: "civic",
    lod: "hero",
    kit: "sf.herald.station",
    landmark: "heralds-station",
    tags: ["notice-board", "signal-mirror", "banner-mount", "lanterns"],
    story: "The mirror on the tower answers the causeway towers across the flats: summons reach the gate before the courier does.",
  }),
  building({
    id: "sf-main-gatehouse",
    name: "Basin Gate",
    district: "E",
    fn: "gatehouse",
    tradition: CUT,
    masses: [
      M({ id: "passage", role: "gatehouse", lx: 0, lz: 37.5, w: 6, d: 7, storeys: 2, eave: 9, ridge: 10, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
      M({ id: "tower-ne", role: "tower", lx: 6, lz: 37.5, w: 6, d: 8, storeys: 3, eave: 12, ridge: 13, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
      M({ id: "tower-sw", role: "tower", lx: -6, lz: 37.5, w: 6, d: 8, storeys: 3, eave: 12, ridge: 13, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
    ],
    door: P(0, 41),
    facing: LB(180),
    foundation: { kind: "plinth", plinth: 0.3, maxRelief: 1.8 },
    era: "predecessor",
    built: 150,
    condition: "worn",
    repairs: [{ kind: "replaced-gate", note: "Iron-sheathed gate leaves replaced; the old ones lie in the caravan court.", mass: "passage" }],
    quality: "fine",
    social: "martial",
    lod: "hero",
    kit: "sf.fort.gatehouse",
    tags: ["banner-mount", "carved-frieze", "lanterns", "water-trough"],
    story: "Two massive towers over a deep shaded passage; the causeway arrives straight from the flats, and the banner's shield hangs where the old arms were cut away.",
    overlap: ["sf-lower-wall", "sf-national-road", "sf-gate-stair"],
  }),
  // D — Artisan and Supply Quarter (market terrace, +2 m, and the caravan court)
  building({
    id: "sf-covered-market",
    name: "The Covered Market",
    district: "D",
    fn: "covered-market",
    tradition: COURT,
    masses: [
      M({ id: "row-w1", role: "block", lx: -6, lz: 2, w: 6, d: 6, storeys: 2, eave: 7, ridge: 7.6, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "row-w2", role: "block", lx: -6, lz: 7.75, w: 6, d: 3.5, storeys: 2, eave: 6.2, ridge: 6.8, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "row-w3", role: "block", lx: -6, lz: 14.25, w: 6, d: 3.5, storeys: 2, eave: 7.4, ridge: 8, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "row-e1", role: "block", lx: 6, lz: 1.5, w: 6, d: 5, storeys: 2, eave: 6.6, ridge: 7.2, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "row-e2", role: "block", lx: 6, lz: 7.25, w: 6, d: 4.5, storeys: 2, eave: 7.2, ridge: 7.8, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "row-e3", role: "block", lx: 6, lz: 14.25, w: 6, d: 3.5, storeys: 2, eave: 6, ridge: 6.6, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "vault", role: "canopy", lx: 0, lz: 7.5, w: 6, d: 17, storeys: 1, eave: 0.3, ridge: 2.4, roof: "barrel-vault", axis: "z", roofMat: PLASTER, wallMat: MUDBRICK, baseOffset: 5.2 }),
      M({ id: "vent-w", role: "windcatcher", lx: -7.6, lz: 0.4, w: 1.8, d: 1.8, storeys: 3, eave: 10, ridge: 10.6, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "vent-e", role: "windcatcher", lx: 7.6, lz: 8.2, w: 1.8, d: 1.8, storeys: 3, eave: 10.4, ridge: 11, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
    ],
    door: P(-3, 14.25),
    facing: LB(90),
    era: "predecessor",
    built: 110,
    condition: "worn",
    repairs: [
      { kind: "fresh-render", note: "The vault re-plastered in patches; the new lime is whiter than the old.", mass: "vault" },
      { kind: "new-lintel", note: "Two shop lintels replaced in palm timber.", mass: "row-e2" },
    ],
    quality: "common",
    social: "artisan",
    lod: "hero",
    kit: "sf.market.covered-street",
    tags: ["awning", "market-stall", "water-basin", "light-shafts", "lanterns"],
    story: "Six shop-houses under one long vault: cloth, salt, lamp oil, sulfur in waxed sacks. Light falls in shafts from the vault's openings.",
  }),
  building({
    id: "sf-grain-domes",
    name: "Grain Domes",
    district: "D",
    fn: "granary",
    tradition: COURT,
    masses: [
      M({ id: "dome-1", role: "silo", lx: -16, lz: 5, w: 6, d: 6, plan: "round", storeys: 1, eave: 4, ridge: 7.6, roof: "dome", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "dome-2", role: "silo", lx: -24, lz: 5, w: 6.5, d: 6.5, plan: "round", storeys: 1, eave: 4.4, ridge: 8.4, roof: "dome", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "dome-3", role: "silo", lx: -32, lz: 5, w: 5.5, d: 5.5, plan: "round", storeys: 1, eave: 3.8, ridge: 7, roof: "dome", roofMat: PLASTER, wallMat: MUDBRICK }),
    ],
    door: P(-24, 8.25),
    facing: LB(180),
    era: "predecessor",
    built: 130,
    condition: "weathered",
    repairs: [{ kind: "fresh-render", note: "The smallest dome re-skimmed with mud plaster after the rains.", mass: "dome-3" }],
    quality: "common",
    social: "labourer",
    kit: "sf.supply.grain-dome",
    tags: ["loading-ladder", "sacks", "seal-marks"],
    story: "Three beehive granaries, each sealed with the steward's mark; a share of every harvest goes down the causeway to the capital.",
  }),
  building({
    id: "sf-storehouse",
    name: "Storehouse",
    district: "D",
    fn: "storehouse",
    tradition: COURT,
    masses: [M({ id: "range", role: "shed", lx: -24, lz: 15.25, w: 20, d: 4.5, storeys: 1, eave: 5, ridge: 5.5, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK })],
    door: P(-24, 13),
    facing: LB(0),
    era: "founding",
    built: 2,
    condition: "sound",
    quality: "common",
    social: "labourer",
    kit: "sf.supply.storehouse",
    tags: ["crates", "water-jars", "awning"],
    story: "Lamp oil, rope and dried dates for the lean months, counted twice a year.",
  }),
  building({
    id: "sf-sulfur-works",
    name: "Sulfur Works",
    district: "D",
    fn: "workshop",
    tradition: WORKS,
    masses: [
      M({ id: "kiln-house", role: "house", lx: 26, lz: 3, w: 10, d: 8, storeys: 1, eave: 6, ridge: 6.8, roof: "flat", roofMat: IRON, wallMat: RUBBLE }),
      M({ id: "flue", role: "stack", lx: 32.5, lz: 1.5, w: 2.2, d: 2.2, storeys: 1, eave: 20, ridge: 20.6, roof: "flat", roofMat: IRON, wallMat: RUBBLE }),
      M({ id: "refining-shed", role: "shed", lx: 38, lz: 3, w: 8, d: 10, storeys: 1, eave: 5, ridge: 7.2, roof: "sawtooth", axis: "z", roofMat: IRON, wallMat: RUBBLE }),
    ],
    door: P(26, 7),
    facing: LB(180),
    era: "recent",
    built: 14,
    condition: "worn",
    repairs: [
      { kind: "welded-plate", note: "The flue banded with riveted plates where the heat cracked it.", mass: "flue" },
      { kind: "patched-roof", note: "Shed glazing replaced with iron sheet, darkening the work floor.", mass: "refining-shed" },
    ],
    quality: "common",
    social: "artisan",
    lod: "hero",
    kit: "sf.works.sulfur",
    tags: ["furnace-glow", "smoke", "sulfur-heaps", "crucibles", "stained-walls"],
    story: "Basin crust is melted and poured into yellow blocks here; the tall flue is the holding's second landmark and its stain on the terrace never washes out.",
  }),
  building({
    id: "sf-smithy",
    name: "Smithy",
    district: "D",
    fn: "forge",
    tradition: WORKS,
    masses: [
      M({ id: "shop", role: "house", lx: 24, lz: 15.3, w: 8, d: 4.6, storeys: 1, eave: 5, ridge: 5.5, roof: "flat-parapet", roofMat: PLASTER, wallMat: RUBBLE }),
      M({ id: "chimney", role: "chimney", lx: 21, lz: 14.2, w: 1.4, d: 1.4, storeys: 1, eave: 8.5, ridge: 8.9, roof: "flat", roofMat: IRON, wallMat: RUBBLE }),
    ],
    door: P(24, 13),
    facing: LB(0),
    era: "founding",
    built: 2,
    condition: "sound",
    quality: "common",
    social: "artisan",
    kit: "sf.works.smithy",
    tags: ["anvil", "quench-trough", "forge-glow", "smoke"],
    story: "Mends works tools and the levy's spearheads; the anvil rings under the market's noise.",
  }),
  building({
    id: "sf-caravan-court",
    name: "Caravan Court",
    district: "D",
    fn: "market",
    tradition: COURT,
    masses: [
      M({ id: "north-wing", role: "wing", lx: -24, lz: 21.5, w: 24, d: 4, storeys: 2, eave: 6.4, ridge: 7, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "south-wing", role: "wing", lx: -24, lz: 33, w: 24, d: 4, storeys: 1, eave: 4.6, ridge: 5.2, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "west-wing", role: "wing", lx: -34, lz: 27.25, w: 4, d: 7.5, storeys: 1, eave: 4.6, ridge: 5.2, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "gate-wing", role: "gatehouse", lx: -14, lz: 27.25, w: 4, d: 7.5, storeys: 2, eave: 7.4, ridge: 8, roof: "flat-parapet", roofMat: PLASTER, wallMat: SANDSTONE }),
    ],
    door: P(-12, 27.25),
    facing: LB(90),
    era: "predecessor",
    built: 100,
    condition: "worn",
    repairs: [{ kind: "rebuilt-courses", note: "The south wing's parapet rebuilt in mud brick over old stone.", mass: "south-wing" }],
    quality: "common",
    social: "civic",
    kit: "sf.supply.caravan-court",
    tags: ["stalls", "beast-tether", "water-trough", "bales", "awning"],
    story: "Merchants and their beasts rest here before the climb; strangers' voices and three kinds of coin.",
  }),
];

// C — Residential Quarter: introverted courtyard houses turning blank walls to Shade Lane.

interface CourtHouse {
  id: string;
  name: string;
  lx0: number;
  lz0: number;
  lx1: number;
  lz1: number;
  /** Which side faces the lane: the uphill (lz0) or downhill (lz1) edge. */
  front: "uphill" | "downhill";
  form: "ring" | "u" | "l" | "block";
  wing: number;
  storeys: number;
  eave: number;
  parapet: number;
  windcatcher?: { lx: number; lz: number; h: number };
  wallMat: string;
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
}

function courtHouse(h: CourtHouse): Building {
  const cx = (h.lx0 + h.lx1) / 2;
  const w = h.lx1 - h.lx0;
  const d = h.lz1 - h.lz0;
  const frontZ = h.front === "downhill" ? h.lz1 - h.wing / 2 : h.lz0 + h.wing / 2;
  const backZ = h.front === "downhill" ? h.lz0 + h.wing / 2 : h.lz1 - h.wing / 2;
  const sideZ = (h.lz0 + h.lz1) / 2 + (h.front === "downhill" ? -h.wing / 2 : h.wing / 2) * (h.form === "ring" ? 0 : 1);
  const sideD = h.form === "ring" ? d - 2 * h.wing : d - h.wing;
  const masses: Building["masses"][number][] = [];
  const box = (id: string, role: Building["masses"][number]["role"], lx: number, lz: number, bw: number, bd: number, eave: number) =>
    M({ id, role, lx, lz, w: bw, d: bd, storeys: Math.max(1, Math.round(eave / 3.2)), eave, ridge: round2(eave + (h.parapet - h.eave)), roof: "flat-parapet", roofMat: PLASTER, wallMat: h.wallMat });
  if (h.form === "block") masses.push(box("block", "house", cx, (h.lz0 + h.lz1) / 2, w, d, h.eave));
  else {
    masses.push(box("front", "house", cx, frontZ, w, h.wing, h.eave));
    if (h.form === "ring") masses.push(box("back", "wing", cx, backZ, w, h.wing, round2(h.eave + 0.8)));
    masses.push(box("left", "wing", h.lx0 + h.wing / 2, sideZ, h.wing, sideD, Math.max(3, round2(h.eave - 0.6))));
    if (h.form !== "l") masses.push(box("right", "wing", h.lx1 - h.wing / 2, sideZ, h.wing, sideD, Math.max(3, round2(h.eave - 0.6))));
  }
  if (h.windcatcher) masses.push(M({ id: "windcatcher", role: "windcatcher", lx: h.windcatcher.lx, lz: h.windcatcher.lz, w: 2.4, d: 2.4, storeys: 3, eave: h.windcatcher.h - 0.6, ridge: h.windcatcher.h, roof: "flat-parapet", roofMat: PLASTER, wallMat: h.wallMat }));
  return building({
    id: h.id,
    name: h.name,
    district: "C",
    fn: h.fn ?? "courtyard-house",
    tradition: COURT,
    masses,
    door: P(cx, h.front === "downhill" ? h.lz1 : h.lz0),
    facing: LB(h.front === "downhill" ? 180 : 0),
    foundation: { kind: "plinth", plinth: 0.25, maxRelief: 1.5 },
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

const houses: Building[] = [
  courtHouse({
    id: "sf-merchant-house", name: "Merchant's Courtyard House", lx0: -16, lz0: -29.5, lx1: -4, lz1: -19, front: "downhill", form: "ring", wing: 3.6, storeys: 2, eave: 7, parapet: 7.8,
    windcatcher: { lx: -14.2, lz: -27.7, h: 13.2 }, wallMat: PLASTER, era: "predecessor", built: 90, condition: "sound",
    repairs: [{ kind: "fresh-render", note: "Lane wall freshly lime-plastered, the door frame painted in the banner's colours.", mass: "front" }],
    quality: "fine", social: "retainer", lod: "hero", kit: "sf.house.court-ring", tags: ["windcatcher", "fountain-court", "carved-door", "lattice-screens"],
    story: "The richest house below the manor: a fountain in its court, fed by its own share of the rill, and a windcatcher of its own.",
  }),
  courtHouse({
    id: "sf-weaver-house", name: "Weaver's House", lx0: -28, lz0: -29.5, lx1: -17, lz1: -19, front: "downhill", form: "u", wing: 3.4, storeys: 2, eave: 6.5, parapet: 7.1,
    wallMat: MUDBRICK, era: "predecessor", built: 70, condition: "worn", repairs: [{ kind: "fresh-render", note: "Front re-plastered; the sides still show bare brick.", mass: "front" }],
    quality: "common", social: "commoner", kit: "sf.house.court-u", tags: ["loom-shade", "fabric-drying", "roof-terrace"],
    story: "Looms under an awning in the open court; finished cloth dries on the roof terrace.",
  }),
  courtHouse({
    id: "sf-old-court-house", name: "Old Court House", lx0: -38, lz0: -29.5, lx1: -29, lz1: -19, front: "downhill", form: "ring", wing: 3, storeys: 1, eave: 4.2, parapet: 4.8,
    wallMat: RUBBLE, era: "predecessor", built: 130, condition: "weathered", repairs: [{ kind: "rebuilt-courses", note: "A sand-scoured corner rebuilt in rough rubble.", mass: "back" }],
    quality: "common", social: "commoner", kit: "sf.house.court-ring-low", tags: ["date-palm", "water-jars"],
    story: "One storey round a court with a single date palm; older than the terraces' retaining walls.",
  }),
  courtHouse({
    id: "sf-block-house", name: "House by the Wall", lx0: -48, lz0: -26, lx1: -39, lz1: -19, front: "downhill", form: "block", wing: 3, storeys: 1, eave: 3.6, parapet: 4,
    wallMat: MUDBRICK, fn: "house", era: "predecessor", built: 110, condition: "damaged",
    repairs: [
      { kind: "tarpaulin", note: "Palm-frond mats laid over a fallen rear roof.", mass: "block" },
      { kind: "boarded-opening", note: "The street window bricked up with loose stones.", mass: "block" },
    ],
    quality: "poor", social: "labourer", lod: "mid", kit: "sf.house.block-low", tags: ["cooking-fire", "goat-pen"],
    story: "A labourer's single room against the west wall, its back half fallen in; the family sleeps on the roof.",
  }),
  courtHouse({
    id: "sf-water-seller-house", name: "Water-Seller's House", lx0: -14, lz0: -16, lx1: -4, lz1: -7, front: "uphill", form: "ring", wing: 3.2, storeys: 2, eave: 6.8, parapet: 7.4,
    wallMat: MUDBRICK, era: "founding", built: 2, condition: "sound",
    quality: "common", social: "artisan", kit: "sf.house.court-ring", tags: ["water-jars", "donkey", "awning"],
    story: "Fills jars at the market basin and carries them up the lanes; the new house was built with the fees.",
  }),
  courtHouse({
    id: "sf-potter-house", name: "Potter's House", lx0: -25, lz0: -16, lx1: -15, lz1: -7, front: "uphill", form: "l", wing: 3.4, storeys: 1, eave: 4.6, parapet: 5.2,
    wallMat: MUDBRICK, era: "predecessor", built: 60, condition: "worn",
    quality: "common", social: "artisan", kit: "sf.house.court-l", tags: ["kiln", "pots", "smoke"],
    story: "Jars for the rill's water and the granaries' grain, fired in a small kiln in the open half of the court.",
  }),
  courtHouse({
    id: "sf-tenement", name: "Labourers' Tenement", lx0: -34, lz0: -16, lx1: -26, lz1: -7, front: "uphill", form: "block", wing: 3, storeys: 3, eave: 9, parapet: 9.6,
    wallMat: MUDBRICK, fn: "tenement", era: "recent", built: 15, condition: "worn", repairs: [{ kind: "spliced-post", note: "Roof-terrace awning poles spliced.", mass: "block" }],
    quality: "poor", social: "labourer", kit: "sf.house.tenement", tags: ["laundry", "roof-terrace", "awning"],
    story: "Three storeys of works labourers' families, built quickly when the sulfur works opened.",
  }),
  courtHouse({
    id: "sf-sealed-house", name: "Sealed House", lx0: -47, lz0: -16, lx1: -36, lz1: -7, front: "uphill", form: "ring", wing: 3.2, storeys: 2, eave: 6, parapet: 6.6,
    wallMat: RUBBLE, era: "predecessor", built: 120, condition: "weathered",
    repairs: [{ kind: "boarded-opening", note: "Door sealed with lime and the house mark of the previous holders.", mass: "front" }],
    quality: "common", social: "commoner", kit: "sf.house.court-ring", tags: ["sealed-door", "sand-drift"],
    story: "Sealed when its family followed the previous house away; sand drifts against the door and nobody has broken the seal.",
  }),
  courtHouse({
    id: "sf-steward-house", name: "Steward's House", lx0: 4, lz0: -29.5, lx1: 13, lz1: -20, front: "downhill", form: "ring", wing: 3, storeys: 2, eave: 7, parapet: 7.6,
    windcatcher: { lx: 11.4, lz: -28.2, h: 12.4 }, wallMat: PLASTER, era: "predecessor", built: 85, condition: "sound",
    quality: "fine", social: "retainer", lod: "hero", kit: "sf.house.court-ring", tags: ["windcatcher", "ledger-room", "carved-door"],
    story: "The steward who kept the previous house's accounts keeps this one's; his windcatcher looks down on the parade court.",
  }),
  courtHouse({
    id: "sf-gate-tenement", name: "Stair Tenement", lx0: 4, lz0: -12, lx1: 12, lz1: -7, front: "uphill", form: "block", wing: 3, storeys: 3, eave: 8.6, parapet: 9.2,
    wallMat: MUDBRICK, fn: "tenement", era: "founding", built: 2, condition: "sound",
    quality: "common", social: "commoner", kit: "sf.house.tenement", tags: ["shop-front", "awning", "roof-terrace"],
    story: "Rooms above a tea counter at the head of the Market Stair; everyone climbing to the manor passes its door.",
  }),
];

const outerBuildings: Building[] = [
  building({
    id: "sf-pump-house",
    name: "Oasis Pump House",
    district: "G",
    fn: "well-house",
    tradition: COURT,
    masses: [
      M({ id: "house", role: "house", lx: -36, lz: 58, w: 6, d: 5, storeys: 1, eave: 4, ridge: 4.6, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
      M({ id: "vent", role: "windcatcher", lx: -37.6, lz: 56.8, w: 1.8, d: 1.8, storeys: 2, eave: 7, ridge: 7.6, roof: "flat-parapet", roofMat: PLASTER, wallMat: MUDBRICK }),
    ],
    door: P(-36, 55.5),
    facing: LB(0),
    era: "predecessor",
    built: 70,
    condition: "worn",
    quality: "common",
    social: "labourer",
    lod: "background",
    kit: "sf.outer.pump-house",
    tags: ["water-wheel", "channel-gates"],
    story: "Lifts reservoir water into the garden channels; whoever opens its sluices decides which plots drink.",
  }),
  building({
    id: "sf-crust-shelter",
    name: "Crust Diggers' Shelter",
    district: "G",
    fn: "outpost",
    tradition: WORKS,
    masses: [M({ id: "shelter", role: "lean-to", lx: 32, lz: 128, w: 8, d: 4, storeys: 1, eave: 2.6, ridge: 3.6, roof: "lean-to", axis: "x", roofMat: IRON, wallMat: RUBBLE })],
    door: P(32, 130),
    facing: LB(180),
    era: "recent",
    built: 14,
    condition: "worn",
    quality: "poor",
    social: "labourer",
    lod: "background",
    kit: "sf.outer.crust-shelter",
    tags: ["rakes", "sulfur-heaps", "water-jars"],
    story: "Shade for the crews who rake sulfur crust from the basin; the yellow heaps are carted up to the works.",
  }),
];

const buildings: Building[] = civic.concat(yards, houses, outerBuildings);
const byId = (id: string): Building => {
  for (const b of buildings) if (b.id === id) return b;
  throw new Error(`solforiz: unknown building ${id}`);
};
const floorOf = (id: string): number => resolveBuildingBase(T, byId(id)).floorY;

// --- Fortifications -----------------------------------------------------------------

const walls: BannerholdBlueprint["walls"] = [
  {
    id: "sf-lower-wall", name: "Lower Wall", kind: "town-wall", points: poly([[-51, 38], [-20, 38], [0, 38], [20, 38], [51, 38]]), closed: false, height: 7, thickness: 2.2, walkway: true, material: SANDSTONE, tradition: CUT,
    segments: [
      { from: 0, to: 1, condition: "weathered", note: "South-west stretch scoured by sand-laden wind; the merlons are rounded stumps." },
      { from: 1, to: 3, condition: "sound", note: "The gate stretch, re-pointed at the founding." },
      { from: 3, to: 4, condition: "worn", note: "Toward the corner tower; salt bloom on the lower courses." },
    ],
    allowOverlapWith: ["sf-main-gatehouse"],
  },
  {
    id: "sf-ne-wall", name: "North-East Wall", kind: "town-wall", points: poly([[51, 38], [51, 18], [51, -6], [51, -31], [51, -60]]), closed: false, height: 6.5, thickness: 2, walkway: true, material: SANDSTONE, tradition: CUT,
    segments: [
      { from: 0, to: 2, condition: "sound", note: "Stepping up the terraces beside the Barrack Road." },
      { from: 2, to: 3, condition: "worn", note: "Behind the parade court." },
      { from: 3, to: 4, condition: "weathered", note: "Where it meets the cliff foot; cracked by old ground movement." },
    ],
  },
  {
    id: "sf-sw-wall", name: "South-West Wall", kind: "town-wall", points: poly([[-51, 38], [-51, 18], [-51, -6], [-51, -31], [-51, -60]]), closed: false, height: 6.5, thickness: 2, walkway: true, material: RUBBLE, tradition: CUT,
    segments: [
      { from: 0, to: 1, condition: "worn", note: "Above the wadi." },
      { from: 1, to: 2, condition: "damaged", note: "An old breach closed with mud brick, never refaced in stone." },
      { from: 2, to: 4, condition: "weathered", note: "Sand drifts against the outer face up to the walkway." },
    ],
  },
  {
    id: "sf-manor-curtain", name: "Manor Curtain", kind: "curtain", points: poly([[-5, -31.2], [-26.5, -31.2], [-26.5, -58.5], [26.5, -58.5], [26.5, -31.2], [5, -31.2]]), closed: false, height: 7.5, thickness: 1.6, walkway: true, material: SANDSTONE, tradition: CUT,
    segments: [
      { from: 0, to: 2, condition: "sound", note: "Plastered face toward the terraces." },
      { from: 2, to: 3, condition: "worn", note: "Back wall against the cliff foot." },
      { from: 3, to: 5, condition: "sound", note: "East face above the parade court." },
    ],
    allowOverlapWith: ["sf-manor-gatehouse"],
  },
  {
    id: "sf-rim-wall", name: "Old Rim Wall", kind: "rampart", points: poly([[-60, -87], [-20, -86], [20, -86.5], [60, -88]]), closed: false, height: 4, thickness: 2, walkway: false, material: RUBBLE, tradition: CUT,
    segments: [
      { from: 0, to: 1, condition: "ruinous", note: "Fallen to its footings: the earlier holders' outer line on the plateau edge." },
      { from: 1, to: 3, condition: "weathered", note: "Standing to half height, sand-scoured, patched where the watch walks." },
    ],
  },
  { id: "sf-parade-wall-n", name: "Parade Wall", kind: "low-wall", points: poly([[14, -29.5], [14, -15.6]]), closed: false, height: 1.4, thickness: 0.6, walkway: false, material: MUDBRICK, tradition: COURT, segments: [{ from: 0, to: 1, condition: "worn", note: "Low mud wall around the parade sand." }] },
  { id: "sf-parade-wall-s", name: "Parade Wall (south)", kind: "low-wall", points: poly([[14, -12.4], [14, -6.6]]), closed: false, height: 1.4, thickness: 0.6, walkway: false, material: MUDBRICK, tradition: COURT, segments: [{ from: 0, to: 1, condition: "sound", note: "Rebuilt at the founding." }] },
];

const towers: BannerholdBlueprint["towers"] = [
  {
    id: "sf-watchtower-repaired", name: "Rim Watchtower", kind: "watchtower", center: P(38, -87.2), shape: "square", width: 6, height: 15, roof: "flat-parapet", material: SANDSTONE, wallId: "sf-rim-wall", condition: "sound",
    repairs: [
      { kind: "rebuilt-courses", note: "Upper third rebuilt in fresh, yellower sandstone after the earlier conflict; the seam is a straight line." },
      { kind: "new-timber", note: "New palm-timber hoarding and signal frame." },
      { kind: "iron-strapping", note: "Iron cramps across the old lower courses." },
    ],
    storyRole: "repaired-watchtower",
    story: "The one tower of the old rim line that the banner rebuilt: from it the watch sees the causeway towers to the capital and the frontier dust to the north.",
  },
  { id: "sf-tower-se", name: "Salt Tower", kind: "wall-tower", center: P(51, 38), shape: "square", width: 6.5, height: 11, roof: "flat-parapet", material: SANDSTONE, wallId: "sf-lower-wall", condition: "worn", repairs: [], story: "Corner tower over the basin; salt bloom to head height." },
  { id: "sf-tower-sw", name: "Wadi Tower", kind: "wall-tower", center: P(-51, 38), shape: "square", width: 6.5, height: 11, roof: "flat-parapet", material: RUBBLE, wallId: "sf-lower-wall", condition: "weathered", repairs: [{ kind: "rebuilt-courses", note: "Parapet rebuilt in mud brick." }], story: "Watches the wadi mouth and the gardens." },
  { id: "sf-tower-ne", name: "Terrace Tower", kind: "wall-tower", center: P(51, -6), shape: "square", width: 5, height: 12, roof: "flat-parapet", material: SANDSTONE, wallId: "sf-ne-wall", condition: "sound", repairs: [], story: "Where the wall steps from the market terrace to the parade court." },
  { id: "sf-tower-w", name: "Lane Tower", kind: "wall-tower", center: P(-51, -31), shape: "square", width: 5, height: 10, roof: "flat-parapet", material: RUBBLE, wallId: "sf-sw-wall", condition: "worn", repairs: [], story: "Closes the end of Shade Lane." },
  { id: "sf-rim-ruin", name: "Fallen Rim Tower", kind: "wall-tower", center: P(-40, -86.5), shape: "square", width: 5, height: 7, roof: "none", material: RUBBLE, wallId: "sf-rim-wall", condition: "ruinous", repairs: [], story: "A stump of the earlier holders' rim line, left to the wind." },
];

const gates: BannerholdBlueprint["gates"] = [
  { id: "sf-gate-main", name: "Basin Gate", kind: "main-gate", position: P(0, 38), outwardBearingDeg: LB(180), width: 4.5, height: 7, wallId: "sf-lower-wall", routeId: "sf-national-road" },
  { id: "sf-gate-manor", name: "Manor Gate", kind: "inner-gate", position: P(0, -31.2), outwardBearingDeg: LB(180), width: 3.6, height: 5, wallId: "sf-manor-curtain", routeId: "sf-manor-stair" },
  { id: "sf-gate-postern", name: "Rim Postern", kind: "postern", position: P(18, -58.5), outwardBearingDeg: LB(0), width: 1.6, height: 2.6, wallId: "sf-manor-curtain", routeId: "sf-rim-stair" },
  { id: "sf-gate-rim", name: "Watchtower Door", kind: "postern", position: P(35, -87.1), outwardBearingDeg: LB(0), width: 1.6, height: 2.4, wallId: "sf-rim-wall", routeId: "sf-qanat-path" },
];

// --- Landmarks, muster, ceremony and state slots ---------------------------------

const HALL_FLOOR = floorOf("sf-banner-hall");
const RECORD_FLOOR = floorOf("sf-war-record");
const HERALD_FLOOR = floorOf("sf-herald-station");
const DAIS_TOP = round2(floorOf("sf-muster-dais") + 1.2);
const GATE_FLOOR = floorOf("sf-main-gatehouse");
const MANOR_GATE_FLOOR = floorOf("sf-manor-gatehouse");

const landmarks: BannerholdBlueprint["landmarks"] = [
  { id: "banner-hall", label: "Banner Hall", buildingIds: ["sf-banner-hall", "sf-lodging", "sf-cistern-house"], anchor: L3(0, HALL_FLOOR + 21.5, -48), pickCenter: L3(0, HALL_FLOOR + 8, -48), pickRadius: 13, cameraId: "landmark:banner-hall" },
  { id: "muster-grounds", label: "Muster Grounds", buildingIds: ["sf-muster-dais", "sf-armoury", "sf-barracks"], anchor: L3(31, DAIS_TOP + 4, -26), pickCenter: L3(31, T2 + 2, -18), pickRadius: 12, cameraId: "landmark:muster-grounds" },
  { id: "war-record", label: "War Record", buildingIds: ["sf-war-record"], anchor: L3(20, RECORD_FLOOR + 19, -42), pickCenter: L3(21, RECORD_FLOOR + 6, -42), pickRadius: 8.5, cameraId: "landmark:war-record" },
  { id: "heralds-station", label: "Herald's Station", buildingIds: ["sf-herald-station", "sf-main-gatehouse"], anchor: L3(13, HERALD_FLOOR + 20, 26), pickCenter: L3(10, HERALD_FLOOR + 6, 30), pickRadius: 8, cameraId: "landmark:heralds-station" },
];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const fileRow = poseRow(T, P(24, -23.6), P(38, -23.6), 8, LB(180));

const muster: BannerholdBlueprint["muster"] = {
  pawnStand: LP(31, -20.6, 180),
  fileMarkers: FILES.map((file, i) => ({ file, pose: fileRow[i] })),
  levySlots: [LP(27, -18.4, 180), LP(29, -18.4, 180), LP(33, -18.4, 180), LP(35, -18.4, 180), LP(28, -16.8, 180), LP(34, -16.8, 180)],
  drillSquare: rect(22, -19, 36, -14.4),
  platformBuildingId: "sf-muster-dais",
};

const ceremonial: BannerholdBlueprint["ceremonial"] = {
  id: "sf-court-of-honours",
  name: "The Court of Honours",
  shape: rect(-11.9, -43.5, 11.9, -39.6),
  centrepiece: P(0, -41.6),
  description:
    "The shaded north end of the manor court before the iwan, between the two arcades: eight lamp niches cut into the arcade piers wait for honours, and a carved basin catches the cistern's overflow. Empty niches are deliberate: recognition fills them, never the scene.",
};

const niche = (i: number) => {
  // Four niches on each arcade's inner piers, facing across the court.
  const west = i < 4;
  const lz = round2(-43 + (i % 4) * 1.1);
  return { position: L3(west ? -11.7 : 11.7, T3 + 0.6 + 1.1, lz), yawDeg: west ? round2(F.rot(90)) : round2(F.rot(-90)) };
};

const tableTop = round2(RECORD_FLOOR + 0.95);
const recordMarkers = Array.from({ length: 12 }, (_, i) => ({ position: L3(18.8 + (i % 4) * 0.6, tableTop, -43.2 + Math.floor(i / 4) * 0.62), yawDeg: F.rot() }));

const slots: BannerholdBlueprint["slots"] = {
  injuredRest: LP(36, -12.4, 0, 0.4),
  captiveMarker: LP(32.2, -20.8, 180),
  honourNiches: Array.from({ length: 8 }, (_, i) => niche(i)),
  recordMarkers,
  noticeBoard: Array.from({ length: 6 }, (_, i) => ({ position: L3(9.3, HERALD_FLOOR + 1.3 + Math.floor(i / 3) * 0.55, 29.6 + (i % 3) * 0.7), yawDeg: F.rot(-90) })),
  heraldArrival: LP(5, 30.6, 90),
  rivalCorrespondence: { position: L3(9.3, HERALD_FLOOR + 1.5, 32.6), yawDeg: F.rot(-90) },
  alliedEnvoy: { position: L3(13, HERALD_FLOOR + 17.4, 26), yawDeg: F.rot() },
  bannerMounts: [
    { id: "sf-court-standard", kind: "standard", heraldry: "player", pose: LP(-5.5, -39.4, 180), height: 9, minHallTier: 0 },
    { id: "sf-iwan-emblem", kind: "emblem", heraldry: "player", pose: { position: L3(0, HALL_FLOOR + 9, -43.5), yawDeg: F.rot() }, height: 2, minHallTier: 0 },
    { id: "sf-windcatcher-veil", kind: "veiled-standard", heraldry: "crown", pose: { position: L3(13, HALL_FLOOR + 22.5, -55), yawDeg: F.rot() }, height: 3.4, minHallTier: 0 },
    { id: "sf-manor-gate-banner", kind: "tapestry", heraldry: "player", pose: { position: L3(0, MANOR_GATE_FLOOR + 4, -31.1), yawDeg: F.rot() }, height: 5, minHallTier: 0 },
    { id: "sf-basin-gate-shield", kind: "shield", heraldry: "player", pose: { position: L3(0, GATE_FLOOR + 6.4, 41.1), yawDeg: F.rot() }, height: 1.6, minHallTier: 0 },
    { id: "sf-dais-standard-ne", kind: "standard", heraldry: "player", pose: { position: L3(39.4, DAIS_TOP, -28.6), yawDeg: F.rot() }, height: 5, minHallTier: 0 },
    { id: "sf-dais-standard-sw", kind: "standard", heraldry: "player", pose: { position: L3(22.6, DAIS_TOP, -28.6), yawDeg: F.rot() }, height: 5, minHallTier: 0 },
    { id: "sf-signal-crown", kind: "signal-flag", heraldry: "crown", pose: { position: L3(14.6, HERALD_FLOOR + 17.2, 24.6), yawDeg: F.rot() }, height: 3, minHallTier: 0 },
    { id: "sf-market-pennants", kind: "pennant", heraldry: "player", pose: { position: L3(0, T1 + 8.2, 17.4), yawDeg: F.rot() }, height: 2, minHallTier: 1 },
    { id: "sf-hall-hangings", kind: "tapestry", heraldry: "player", pose: { position: L3(0, HALL_FLOOR + 2.5, -45.9), yawDeg: F.rot() }, height: 6, minHallTier: 2 },
    { id: "sf-windcatcher-pennant", kind: "pennant", heraldry: "player", pose: { position: L3(13, HALL_FLOOR + 25.5, -55), yawDeg: F.rot() }, height: 3, minHallTier: 3 },
  ],
  hallTiers: [
    { tier: 1, buildings: ["sf-cistern-house"], expansionZones: [], dressing: ["sf-market-pennants", "court-fountain-running"] },
    { tier: 2, buildings: ["sf-record-gallery"], expansionZones: ["sf-exp-record-gallery"], dressing: ["sf-hall-hangings", "gallery-honours"] },
    { tier: 3, buildings: [], expansionZones: ["sf-exp-east-terrace", "sf-exp-gate-forecourt"], dressing: ["sf-windcatcher-pennant", "gilded-iwan"] },
  ],
  foundingStandard: { position: L3(31, DAIS_TOP, -28.2), yawDeg: F.rot() },
};

// --- Storytelling, vegetation and dressing ------------------------------------------

const story: BannerholdBlueprint["story"] = [
  { id: "sf-story-watchtower", kind: "repaired-watchtower", position: P(38, -87.2), refs: ["sf-watchtower-repaired"], description: "Fresh yellow courses on an old grey tower: the one piece of the rim line the banner rebuilt after the earlier conflict." },
  { id: "sf-story-rim-wall", kind: "weathered-fortification", position: P(-30, -86.2), refs: ["sf-rim-wall", "sf-rim-ruin"], description: "The earlier holders' rim wall, sand-scoured to its footings along the plateau edge." },
  { id: "sf-story-breach", kind: "weathered-fortification", position: P(-51, 6), refs: ["sf-sw-wall"], description: "An old breach in the south-west wall closed with mud brick and never refaced." },
  { id: "sf-story-parade", kind: "levy-yard-vs-noble-architecture", position: P(31, -18), refs: ["sf-muster-dais", "sf-barracks", "sf-allied-seat"], description: "A sand parade court and a one-room levy house; across the basin the allied Great House's domed palace stands on its mesa." },
  { id: "sf-story-causeway", kind: "merchant-road", position: P(2, 70), refs: ["sf-national-road", "sf-gate-main", "sf-caravan-court"], description: "The causeway across the flats, its marker towers stepping toward the capital; caravans rest in the court inside the gate." },
  { id: "sf-story-cistern", kind: "unfinished-structure", position: P(35, -48), refs: ["sf-cistern-house"], description: "A second cistern cut and walled to 3 m, waiting for its vault." },
  { id: "sf-story-honours", kind: "ceremonial-place", position: P(0, -41.6), refs: ["sf-court-of-honours"], description: "Eight empty lamp niches in the arcade piers before the iwan." },
  { id: "sf-story-pawn", kind: "empty-character-position", position: P(31, -20.6), refs: ["sf-muster-dais"], description: "The nominated representative's marked stone on the parade sand, occupied or empty according to real state." },
  { id: "sf-story-water", kind: "water-memory", position: P(-2, 12), refs: ["sf-pump-house", "sf-market-basin", "sf-gate-main"], description: "Water enters at the lord's cistern and falls terrace by terrace past every door: who may draw from the rill is written on its basins." },
  { id: "sf-story-sealed", kind: "older-house-ruin", position: P(-41.5, -11.5), refs: ["sf-sealed-house"], description: "A courtyard house sealed with the previous holders' mark; sand drifts against the door." },
  { id: "sf-story-class", kind: "class-contrast", position: P(-20, -17.5), refs: ["sf-merchant-house", "sf-tenement", "sf-block-house"], description: "A windcatcher and a fountain court for the merchant; three storeys of works families; a single fallen room by the wall." },
  { id: "sf-story-boundary", kind: "boundary-dispute", position: P(-94, 62), refs: ["sf-marker-old", "sf-marker-moved"], description: "Two well markers at the oasis edge, set a few paces apart by houses that share the same water." },
];

const vegetation: BannerholdBlueprint["vegetation"] = [
  { id: "sf-palm-grove", kind: "palm-grove", shape: { kind: "polygon", points: poly([[-100, 40], [-72, 44], [-66, 112], [-98, 118]]) }, density: 3, species: "date palm", seed: 41 },
  { id: "sf-oasis-gardens", kind: "garden", shape: { kind: "polygon", points: poly([[-64, 58], [-10, 56], [-4, 102], [-58, 108]]) }, density: 16, species: "onion, barley and date nursery", seed: 42 },
  { id: "sf-manor-palms", kind: "palm-grove", shape: rect(-48, -56, -31, -36), density: 2.4, species: "date palm and pomegranate", seed: 43 },
  { id: "sf-manor-garden", kind: "garden", shape: rect(-49, -58, -28.5, -33), density: 14, species: "herbs and roses under palms", seed: 44 },
  { id: "sf-court-planters", kind: "planter", shape: rect(-11, -36.6, -7, -35), density: 40, species: "myrtle in jars", seed: 45 },
  { id: "sf-old-court-palm", kind: "palm-grove", shape: rect(-34.2, -25, -32.8, -23.6), density: 60, species: "single date palm", seed: 46 },
  { id: "sf-escarpment-scrub", kind: "scrub", shape: { kind: "polygon", points: poly([[-220, -64], [220, -64], [220, -112], [-220, -112]]) }, density: 0.5, species: "salt bush and thorn", seed: 47 },
  { id: "sf-wadi-tamarisk", kind: "woodland", shape: { kind: "polygon", points: poly([[-96, -60], [-64, -60], [-60, 40], [-56, 120], [-84, 124], [-90, 40]]) }, density: 1.2, species: "tamarisk and acacia", seed: 48 },
  { id: "sf-pool-reeds", kind: "reeds", shape: { kind: "polygon", points: poly([[20, 142], [40, 142], [41, 158], [21, 160]]) }, density: 20, species: "salt reeds", seed: 49 },
];

const D = (id: string, kind: BannerholdBlueprint["dressing"][number]["kind"], lx: number, lz: number, localYaw: number, district: BannerholdBlueprint["dressing"][number]["district"], note?: string): BannerholdBlueprint["dressing"][number] => {
  const out: BannerholdBlueprint["dressing"][number] = { id, kind, position: P(lx, lz), yawDeg: F.rot(localYaw), district };
  if (note) out.note = note;
  return out;
};

const dressing: BannerholdBlueprint["dressing"] = [
  D("sf-iwan-brazier-w", "brazier", -4.8, -42.9, 0, "A", "Pair flanking the iwan."),
  D("sf-iwan-brazier-e", "brazier", 4.8, -42.9, 0, "A"),
  D("sf-court-jars", "water-jars", -10.6, -42.6, 0, "A"),
  D("sf-cistern-stone", "stone-pile", 44.2, -42.8, 0, "A", "Cut blocks for the cistern vault."),
  D("sf-cistern-crane", "crane", 45.4, -48, 90, "A", "Timber crane beside the unfinished cistern house."),
  D("sf-racks", "weapon-rack", 37, -24.6, 90, "B"),
  D("sf-pells", "practice-pell", 17, -21, 0, "B", "Three straw posts at the parade court's edge."),
  D("sf-levy-jars", "water-jars", 29.6, -11.4, 0, "B"),
  D("sf-levy-fire", "cooking-fire", 40.4, -11.6, 0, "B"),
  D("sf-parade-awning", "awning", 24, -25.6, 0, "B", "Canvas awning poles on the dais."),
  D("sf-sulfur-heaps", "stone-pile", 30, -4.4, 0, "D", "Yellow sulfur heaps in the works yard."),
  D("sf-works-crates", "crates", 43.4, 7.4, 0, "D"),
  D("sf-anvil", "anvil", 24.6, 12.6, 0, "D"),
  D("sf-quench", "quench-trough", 27, 12.6, 0, "D"),
  D("sf-stall-sw", "market-stall", -7, 25.4, 0, "E"),
  D("sf-stall-ne", "market-stall", 7, 25.2, 0, "E"),
  D("sf-caravan-bales", "crates", -24, 27.2, 0, "D", "Bales and saddle-packs in the caravan court."),
  D("sf-caravan-tether", "beast-tether", -20, 29, 0, "D"),
  D("sf-gate-trough", "quench-trough", -3.8, 30.4, 0, "E"),
  D("sf-notice-board", "notice-board", 8.4, 28.8, -90, "E"),
  D("sf-gate-cart", "cart", 4.6, 46, 0, "E", "A merchant's cart waiting at the toll."),
  D("sf-market-basin", "well", -1.3, 12, 0, "D", "Public basin on the rill at the market's crossing."),
  D("sf-merchant-fire", "cooking-fire", -10, -24.4, 0, "C"),
  D("sf-weaver-looms", "awning", -22.5, -24, 0, "C", "Looms under an awning in the open court."),
  D("sf-lane-laundry", "laundry-line", -30, -17.2, 90, "C"),
  D("sf-goat-pen", "beast-tether", -43.5, -27.6, 0, "C"),
  D("sf-potter-kiln", "brazier", -18, -10.4, 0, "C", "The potter's kiln in the open half of the court."),
  D("sf-lane-jars", "water-jars", -12, -18.4, 0, "C"),
  D("sf-marker-old", "boundary-stone", -94, 60, 0, "G"),
  D("sf-marker-moved", "boundary-stone", -90.5, 63.6, 12, "G", "The well marker a neighbour moved."),
  D("sf-milestone", "boundary-stone", 4, 92, 0, "G", "Causeway stone counting the stages to the capital."),
  D("sf-crust-heaps", "stone-pile", 24, 134, 0, "G"),
];

const activitySites: BannerholdBlueprint["activitySites"] = [
  { id: "sf-site-forge", kind: "forge", position: LG(22.8, 12.4), district: "D" },
  { id: "sf-site-anvil", kind: "anvil", position: LG(24.6, 12.4), district: "D" },
  { id: "sf-site-quench", kind: "quench", position: LG(27, 12.4), district: "D" },
  { id: "sf-site-basin", kind: "well", position: LG(-1.3, 12.6), district: "D" },
  { id: "sf-site-drill", kind: "drill-square", position: LG(29, -16.6), district: "B" },
  { id: "sf-site-notices", kind: "notice-board", position: LG(8, 30), district: "E" },
  { id: "sf-site-stable", kind: "stable", position: LG(-20, 28.4), district: "D" },
  { id: "sf-site-lookout", kind: "lookout", position: L3(38, T.height(P(38, -87.2)[0], P(38, -87.2)[1]) + 13, -87.2), district: "G" },
  { id: "sf-site-war-table", kind: "war-table", position: L3(20, tableTop, -42.6), district: "F" },
  { id: "sf-site-grain", kind: "loading-bay", position: LG(-24, 9.4), district: "D" },
  { id: "sf-site-stall", kind: "market-stall", position: LG(-6.4, 24.6), district: "E" },
  { id: "sf-site-masons", kind: "workbench", position: LG(33, -41.2), district: "A" },
  { id: "sf-site-reservoir", kind: "laundry", position: LG(-11, 45), district: "G" },
  { id: "sf-site-works", kind: "loading-bay", position: LG(30, -3.6), district: "D" },
];

// --- Life: deterministic schedules ------------------------------------------------

const near = { fullRateWithin: 60, reducedRateWithin: 160, hiddenBeyond: 420 };
const far = { fullRateWithin: 0, reducedRateWithin: 600, hiddenBeyond: 1600 };
const CAUSEWAY_IN = poly([[14, 180], [6, 110], [2, 70], [0, 46], [0, 38]]);

const npcs: NpcAgent[] = [
  {
    id: "sf-sentry-lower", role: "sentry", label: "Sentry on the lower wall", district: "E", count: 1,
    route: poly([[-48, 38], [-20, 38], [20, 38], [48, 38]]), heightMode: "wall-walk", wallId: "sf-lower-wall",
    steps: [{ kind: "walk", to: 3 }, { kind: "hold", seconds: 9, activity: "watch", faceBearingDeg: LB(180) }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 9, activity: "watch", faceBearingDeg: LB(200) }],
    phaseSeconds: 0, speed: 0.9, lod: near, activitySiteIds: [],
  },
  {
    id: "sf-sentry-rim", role: "sentry", label: "Watch on the rim wall", district: "G", count: 1,
    route: poly([[-18, -86], [20, -86.5], [35, -87.1]]), heightMode: "wall-walk", wallId: "sf-rim-wall",
    steps: [{ kind: "walk", to: 2 }, { kind: "hold", seconds: 12, activity: "watch", faceBearingDeg: LB(170) }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 7, activity: "watch", faceBearingDeg: LB(0) }],
    phaseSeconds: 23, speed: 0.8, lod: near, activitySiteIds: ["sf-site-lookout"],
  },
  {
    id: "sf-gate-guards", role: "guard", label: "Guards in the gate passage", district: "E", count: 2, formation: [[0, 0], [7, 0]],
    route: poly([[-3.5, 32.6], [-3.5, 31.4]]), heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 18, activity: "watch", faceBearingDeg: LB(180) }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "inspect", faceBearingDeg: LB(180) }, { kind: "walk", to: 0 }],
    phaseSeconds: 4, speed: 0.6, lod: near, activitySiteIds: [],
  },
  {
    id: "sf-smith", role: "smith", label: "Smith at the works forge", district: "D", count: 1,
    route: poly([[22.8, 12.4], [24.6, 12.4], [27, 12.4]]), heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 5, activity: "bellows", faceBearingDeg: LB(0) }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 9, activity: "forge-strike", faceBearingDeg: LB(0) }, { kind: "walk", to: 2 }, { kind: "hold", seconds: 3, activity: "quench", faceBearingDeg: LB(0) }, { kind: "walk", to: 0 }],
    phaseSeconds: 0, speed: 0.8, lod: near, activitySiteIds: ["sf-site-forge", "sf-site-anvil", "sf-site-quench"],
  },
  {
    id: "sf-messenger", role: "messenger", label: "Courier riding in along the causeway", district: "E", count: 1,
    route: CAUSEWAY_IN.concat(poly([[0, 34], [2.5, 31], [5, 30.6]])), heightMode: "terrain",
    steps: [{ kind: "walk", to: 7, speed: 3.2 }, { kind: "hold", seconds: 10, activity: "post-notice", faceBearingDeg: LB(90) }, { kind: "hold", seconds: 8, activity: "tend-beast", faceBearingDeg: LB(180) }, { kind: "walk", to: 0, speed: 3.2 }, { kind: "hold", seconds: 40, activity: "rest" }],
    phaseSeconds: 15, speed: 3.2, lod: { fullRateWithin: 80, reducedRateWithin: 400, hiddenBeyond: 900 }, activitySiteIds: ["sf-site-notices"],
  },
  {
    id: "sf-drill", role: "drill", label: "Levy drilling on the parade sand", district: "B", count: 4, formation: [[0, 0], [1.6, 0], [0, 1.6], [1.6, 1.6]],
    route: poly([[23, -19], [35, -19], [35, -15.6], [23, -15.6], [23, -19]]), heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 12, activity: "drill", faceBearingDeg: LB(0) }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 8, activity: "drill", faceBearingDeg: LB(0) }, { kind: "walk", to: 2 }, { kind: "walk", to: 3 }, { kind: "hold", seconds: 6, activity: "salute", faceBearingDeg: LB(0) }, { kind: "walk", to: 4 }],
    phaseSeconds: 0, speed: 1.1, lod: near, activitySiteIds: ["sf-site-drill"],
  },
  {
    id: "sf-herald", role: "herald", label: "Herald at the post court", district: "E", count: 1,
    route: poly([[8, 30], [5.6, 30.6], [6, 27]]), heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 9, activity: "read-notice", faceBearingDeg: LB(90) }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "write", faceBearingDeg: LB(90) }, { kind: "walk", to: 2 }, { kind: "hold", seconds: 7, activity: "watch", faceBearingDeg: LB(180) }, { kind: "walk", to: 0 }],
    phaseSeconds: 11, speed: 0.9, lod: near, activitySiteIds: ["sf-site-notices"],
  },
  {
    id: "sf-scribe", role: "scribe", label: "War Record scribe crossing the court", district: "F", count: 1,
    route: poly([[15, -39], [12, -39.4], [12, -43.6], [0, -44.2], [0, -43.8]]), heightMode: "terrain",
    steps: [{ kind: "walk", to: 4 }, { kind: "hold", seconds: 8, activity: "inspect", faceBearingDeg: LB(0) }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 20, activity: "write", faceBearingDeg: LB(90) }],
    phaseSeconds: 14, speed: 0.9, lod: near, activitySiteIds: ["sf-site-war-table"],
  },
  {
    id: "sf-mason", role: "worker", label: "Mason at the unfinished cistern house", district: "A", count: 1,
    route: poly([[33, -41.2], [44, -42.6], [33, -41.2]]), heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 15, activity: "repair", faceBearingDeg: LB(0) }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "carry" }, { kind: "walk", to: 2 }],
    phaseSeconds: 6, speed: 0.7, lod: near, activitySiteIds: ["sf-site-masons"],
  },
  {
    id: "sf-water-carrier", role: "resident", label: "Water-seller carrying jars up the spine", district: "C", count: 1,
    route: poly([[-1.3, 12.6], [-1.3, -1.5], [-1.3, -9.5], [-1.3, -17.5], [-9, -17.5], [-9, -16.4]]), heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 8, activity: "draw-water", faceBearingDeg: LB(270) }, { kind: "walk", to: 5 }, { kind: "hold", seconds: 6, activity: "carry", faceBearingDeg: LB(180) }, { kind: "walk", to: 0 }],
    phaseSeconds: 3, speed: 0.75, lod: near, activitySiteIds: ["sf-site-basin"],
  },
  {
    id: "sf-sulfur-carrier", role: "worker", label: "Works hand carrying sulfur to the market", district: "D", count: 1,
    route: poly([[30, -3.6], [30, 3.6], [30, 11], [2.5, 11], [2.5, 6]]), heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 10, activity: "load", faceBearingDeg: LB(0) }, { kind: "walk", to: 4 }, { kind: "hold", seconds: 12, activity: "trade", faceBearingDeg: LB(90) }, { kind: "walk", to: 0 }],
    phaseSeconds: 27, speed: 0.8, lod: near, activitySiteIds: ["sf-site-works"],
  },
  {
    id: "sf-children", role: "child", label: "Children playing along Shade Lane", district: "C", count: 2, formation: [[0, 0], [1.1, 0.7]],
    route: poly([[-4, -17.5], [-30, -17.5], [-4, -17.5]]), heightMode: "terrain",
    steps: [{ kind: "walk", to: 1, speed: 1.9 }, { kind: "hold", seconds: 8, activity: "chat" }, { kind: "walk", to: 2, speed: 1.9 }, { kind: "hold", seconds: 10, activity: "chat" }],
    phaseSeconds: 9, speed: 1.9, lod: near, activitySiteIds: [],
  },
  {
    id: "sf-gardeners", role: "farmer", label: "Gardeners opening the oasis channels", district: "G", count: 2, formation: [[0, 0], [4, 2]],
    route: poly([[-40, 70], [-62, 88]]), heightMode: "terrain",
    steps: [{ kind: "walk", to: 1, speed: 0.4 }, { kind: "hold", seconds: 22, activity: "draw-water" }, { kind: "walk", to: 0, speed: 0.4 }, { kind: "hold", seconds: 16, activity: "carry" }],
    phaseSeconds: 0, speed: 0.4, lod: far, activitySiteIds: [],
  },
  {
    id: "sf-crust-diggers", role: "worker", label: "Crews raking basin crust", district: "G", count: 3, formation: [[0, 0], [3, 2], [6, 0.5]],
    route: poly([[20, 126], [34, 140]]), heightMode: "terrain",
    steps: [{ kind: "walk", to: 1, speed: 0.3 }, { kind: "hold", seconds: 18, activity: "rest" }, { kind: "walk", to: 0, speed: 0.3 }, { kind: "hold", seconds: 14, activity: "carry" }],
    phaseSeconds: 5, speed: 0.3, lod: far, activitySiteIds: [],
  },
  {
    id: "sf-caravan", role: "beast-handler", label: "Caravan crossing the flats", district: "G", count: 3, formation: [[0, 0], [0, 4], [0, 8]],
    route: CAUSEWAY_IN.concat(poly([[-2, 44]])), heightMode: "terrain",
    steps: [{ kind: "walk", to: 5, speed: 1 }, { kind: "hold", seconds: 40, activity: "trade", faceBearingDeg: LB(0) }, { kind: "walk", to: 0, speed: 1 }, { kind: "hold", seconds: 80, activity: "rest" }],
    phaseSeconds: 120, speed: 1, lod: far, activitySiteIds: [],
  },
];

// --- Outer Territory and the greater nation ---------------------------------------

const outer: BannerholdBlueprint["outer"] = {
  fields: [
    { id: "sf-field-onion", crop: "onion and barley", polygon: poly([[-34, 60], [-12, 58], [-8, 76], [-30, 80]]), furrowBearingDeg: LB(90), owner: "holding", condition: "tended" },
    { id: "sf-field-nursery", crop: "date nursery", polygon: poly([[-62, 72], [-36, 70], [-32, 92], [-58, 96]]), furrowBearingDeg: LB(90), owner: "holding", condition: "tended" },
    { id: "sf-field-harvested", crop: "sorghum stubble", polygon: poly([[-30, 84], [-6, 80], [-2, 100], [-26, 104]]), furrowBearingDeg: LB(90), owner: "holding", condition: "harvested" },
    { id: "sf-field-neighbour", crop: "fallow", polygon: poly([[-64, 100], [-40, 98], [-36, 120], [-60, 124]]), furrowBearingDeg: LB(90), owner: "neighbour", condition: "fallow" },
  ],
  outposts: [
    { id: "sf-causeway-tower", name: "First causeway tower", kind: "beacon", position: P(10, 240), height: 12, owner: "crown", description: "Signal tower on the causeway, answering the Herald's Station mirror." },
    { id: "sf-toll-shade", name: "Causeway toll shade", kind: "toll", position: P(18, 320), height: 6, owner: "crown", description: "A roofed toll post where the causeway leaves the holding's flats." },
    { id: "sf-spring-house", name: "Spring house", kind: "pump-station", position: P(-20, -150), height: 5, owner: "holding", description: "Head of the stone channel that feeds the manor cistern from the plateau springs." },
    { id: "sf-boundary-oasis", name: "Oasis boundary stone", kind: "boundary-stone", position: P(-110, 64), height: 1.4, owner: "holding", description: "Where the holding's gardens end and the neighbour's begin." },
    { id: "sf-boundary-plateau", name: "Plateau boundary cairn", kind: "cairn", position: P(80, -120), height: 1.8, owner: "holding", description: "Cairn marking the holding's grazing on the plateau." },
  ],
  places: [
    distantPlace({ id: "sf-allied-seat", name: "Seat of the allied Great House", kind: "allied-seat", bearingDeg: 160, distance: 5500, groundElevation: 40, silhouetteHeight: 74, radius: 300, stateSlot: "allied-house", description: "A walled palace on a mesa across the basin, its domes catching the last light: the Great House the banner musters beside, wealthy, watchful and openly unimpressed by the newcomer." }),
    distantPlace({ id: "sf-frontier-aethelgard", name: "Northern pass fort", kind: "frontier", frontierNation: "aethelgard", bearingDeg: 6, distance: 16000, groundElevation: 120, silhouetteHeight: 38, radius: 150, stateSlot: "rival-house", description: "Frontier fort at the northern pass where the caravan road leaves for Aethelgard." }),
    distantPlace({ id: "sf-frontier-korvenia", name: "North-western watch fort", kind: "frontier", frontierNation: "korvenia", bearingDeg: 314, distance: 20000, groundElevation: 140, silhouetteHeight: 36, radius: 140, stateSlot: "rival-house", description: "Watch fort on the plateau facing the Korvenian marches." }),
    distantPlace({ id: "sf-frontier-kwind", name: "Western customs station", kind: "frontier", frontierNation: "kwind-09", bearingDeg: 268, distance: 24000, groundElevation: 90, silhouetteHeight: 44, radius: 160, stateSlot: "rival-house", description: "Customs station on the western plateau road toward Kwind-09." }),
    distantPlace({ id: "sf-oasis-fort", name: "Oasis farm-fort of a neighbouring banner", kind: "neighbour-estate", bearingDeg: 222, distance: 2200, groundElevation: -10, silhouetteHeight: 18, radius: 90, description: "Another minor banner's walled farm in the same oasis; its wells draw on the same water." }),
    distantPlace({ id: "sf-well-village", name: "Well village", kind: "village", bearingDeg: 176, distance: 2900, groundElevation: -12, silhouetteHeight: 12, radius: 120, description: "A well village on the basin edge: cooking smoke and a squat water tower." }),
    distantPlace({ id: "sf-caravan-town", name: "Caravan town on the causeway", kind: "town", bearingDeg: 140, distance: 6500, groundElevation: -14, silhouetteHeight: 30, radius: 400, description: "A caravan town halfway across the basin, where the causeway meets the salt road." }),
    distantPlace({ id: "sf-refinery", name: "Basin refinery", kind: "industrial", bearingDeg: 102, distance: 9000, groundElevation: -12, silhouetteHeight: 90, radius: 500, description: "Flare stacks, tanks and a long smoke trail on the basin floor." }),
    distantPlace({ id: "sf-capital", name: "The capital", kind: "capital", bearingDeg: 135, distance: 28000, groundElevation: -10, silhouetteHeight: 300, radius: 3500, description: "Monumental terraces and refinery towers on the far side of the basin, hazed gold at evening. Always called simply the capital." }),
  ],
  territories: [
    { id: "sf-terr-holding", name: "The holding's terraces and oasis", owner: "holding", polygon: poly([[-120, -150], [100, -150], [100, 60], [40, 70], [-10, 130], [-120, 130]]) },
    { id: "sf-terr-crown", name: "The causeway and the flats (crown)", owner: "crown", polygon: poly([[40, 70], [100, 60], [3000, 9000], [-1200, 9000], [-10, 130]]) },
    { id: "sf-terr-allied", name: "Mesa lands of the allied Great House", owner: "allied-great-house", polygon: poly([[-120, 130], [-10, 130], [-1200, 9000], [-6000, 6000]]) },
    { id: "sf-terr-neighbour", name: "Oasis farm of another banner", owner: "other-banner", polygon: poly([[-120, -40], [-120, 130], [-6000, 6000], [-5000, -800]]) },
    { id: "sf-terr-plateau", name: "The plateau (wilderness)", owner: "wilderness", polygon: poly([[-120, -150], [100, -150], [3000, -6000], [-5000, -6000], [-5000, -800], [-120, -40]]) },
  ],
  skyline: [
    { id: "sf-sky-escarpment", kind: "ridge", bearingFromDeg: 250, bearingToDeg: 20, distance: 140, height: 22, description: "The escarpment and the plateau rim directly behind the manor." },
    { id: "sf-sky-spires", kind: "mesa", bearingFromDeg: 110, bearingToDeg: 170, distance: 4000, height: 70, description: "Mineral spires and buttes standing out of the basin crust." },
    { id: "sf-sky-dunes", kind: "dunes", bearingFromDeg: 60, bearingToDeg: 110, distance: 12000, height: 40, description: "Pale dune fields east of the basin." },
    { id: "sf-sky-refinery-smoke", kind: "smoke", bearingFromDeg: 98, bearingToDeg: 106, distance: 9000, height: 160, description: "The refinery's smoke trail leaning north-east." },
    { id: "sf-sky-capital", kind: "towers", bearingFromDeg: 131, bearingToDeg: 139, distance: 28000, height: 300, description: "The capital's terraces and refinery towers across the basin." },
    { id: "sf-sky-mesas", kind: "mesa", bearingFromDeg: 180, bearingToDeg: 240, distance: 15000, height: 120, description: "Far mesas to the south-west, the allied seat's country." },
    { id: "sf-sky-aqueduct", kind: "viaduct", bearingFromDeg: 286, bearingToDeg: 322, distance: 2300, height: 58, description: "The crown aqueduct striding along the plateau on tall arches; the holding's spring channel is one small tap on it." },
    { id: "sf-sky-north-range", kind: "mountains", bearingFromDeg: 290, bearingToDeg: 30, distance: 34000, height: 1300, description: "A bare range far to the north, cut by the pass toward the northern frontier." },
  ],
};

// --- View corridors and expansion ------------------------------------------------------

// From above the basin south-east of the walls, looking up the cascade: the retaining walls face
// the camera, the manor crowns the stack and the plateau skyline (aqueduct, far range) closes it.
// The capital lies behind this view; the windcatcher corridor and the herald's causeway carry it.
const ESTABLISHING_TARGET = L3(-2, 18.5, -18);
const establishingPos = cameraFrom(ESTABLISHING_TARGET, LB(145), 150, 26.45);

function sightToward(from: readonly [number, number, number], placeId: string, length: number): readonly [number, number, number] {
  const place = outer.places.find((p) => p.id === placeId);
  if (!place) throw new Error(`solforiz: unknown place ${placeId}`);
  const tx = place.position[0] - from[0];
  const ty = place.groundElevation + place.silhouetteHeight - from[1];
  const tz = place.position[1] - from[2];
  const k = length / Math.sqrt(tx * tx + ty * ty + tz * tz);
  return [round2(from[0] + tx * k), round2(from[1] + ty * k), round2(from[2] + tz * k)];
}

const WINDCATCHER_TOP = L3(13, HALL_FLOOR + 22.6, -55);

const viewCorridors: BannerholdBlueprint["viewCorridors"] = [
  { id: "sf-vc-spine", name: "Basin Gate up the spine to the Manor Gate", from: L3(0, T0 + 1.7, 32), to: L3(0, MANOR_GATE_FLOOR + 9, -31.4), halfWidth: 1.5, halfWidthFar: 4, purpose: "From inside the gate the eye climbs the stair, the covered market and the Manor Stair to the blank portal at the top.", allow: ["sf-covered-market", "sf-manor-gatehouse"] },
  { id: "sf-vc-capital", name: "Windcatcher down the causeway to the capital", from: WINDCATCHER_TOP, to: sightToward(WINDCATCHER_TOP, "sf-capital", 600), halfWidth: 2, halfWidthFar: 50, purpose: "From the manor's tallest point the causeway runs straight across the flats to the capital's towers in the haze; nothing on the terraces may rise into it.", allow: ["sf-banner-hall"] },
  { id: "sf-vc-allied", name: "Windcatcher to the allied mesa", from: WINDCATCHER_TOP, to: sightToward(WINDCATCHER_TOP, "sf-allied-seat", 600), halfWidth: 2, halfWidthFar: 40, purpose: "From the manor's tallest point the allied Great House's palace stands on its mesa across the basin.", allow: ["sf-banner-hall"] },
  { id: "sf-vc-court", name: "War Record door to the iwan", from: L3(14.6, RECORD_FLOOR + 1.6, -39), to: L3(0, HALL_FLOOR + 4, -43.4), halfWidth: 0.8, halfWidthFar: 1.4, purpose: "The archive and the hall face each other across the court.", allow: ["sf-war-record", "sf-banner-hall"] },
  { id: "sf-vc-causeway", name: "Signal tower to the first causeway tower", from: L3(13, HERALD_FLOOR + 17.4, 26), to: L3(10.4, 6, 220), halfWidth: 1.5, halfWidthFar: 12, purpose: "The mirror on the herald tower must see the causeway towers: keep this line clear.", allow: ["sf-herald-station"] },
];

const expansion: BannerholdBlueprint["expansion"] = [
  { id: "sf-exp-record-gallery", name: "Record Gallery plot", district: "F", polygon: poly([[30, -38.6], [40, -38.6], [40, -32], [30, -32]]), intendedUse: "Gallery for honours beside the War Record (hall tier 2).", unlocksAtHallTier: 2 },
  { id: "sf-exp-east-terrace", name: "East terrace", district: "A", polygon: poly([[42.4, -58.5], [49.6, -58.5], [49.6, -51], [42.4, -51]]), intendedUse: "A summer pavilion on the top terrace (hall tier 3).", unlocksAtHallTier: 3 },
  { id: "sf-exp-gate-forecourt", name: "Gate forecourt", district: "E", polygon: poly([[-12, 42.2], [12, 42.2], [12, 50], [-12, 50]]), intendedUse: "A walled forecourt and fountain before the Basin Gate (hall tier 3).", unlocksAtHallTier: 3 },
  { id: "sf-exp-knight-yard", name: "Parade court corner", district: "B", polygon: poly([[14.8, -29.2], [18.8, -29.2], [18.8, -22.4], [14.8, -22.4]]), intendedUse: "Quarters and a stable for a future Knight appointment (reserved).", unlocksAtHallTier: null },
  { id: "sf-exp-market-plots", name: "Market terrace corner", district: "D", polygon: poly([[-50, 13.2], [-36.4, 13.2], [-36.4, 17.4], [-50, 17.4]]), intendedUse: "Workshops for the market as trade grows (reserved).", unlocksAtHallTier: null },
];

// --- Cameras, VR staging, atmosphere ---------------------------------------------

const hallTarget = L3(0, HALL_FLOOR + 9, -46);
const musterTarget = L3(30.5, 12, -23);
const recordTarget = L3(25.4, RECORD_FLOOR + 9, -41);
const heraldTarget = L3(11, HERALD_FLOOR + 9, 29);
const pawnTarget: Vec3 = [muster.pawnStand.position[0], round2(muster.pawnStand.position[1] + 1.3), muster.pawnStand.position[2]];

const cameras: BannerholdBlueprint["cameras"] = [
  camera(
    "establishing",
    "Establishing — the terraces from the basin",
    establishingPos,
    ESTABLISHING_TARGET,
    38,
    { yawDeg: [-25, 25], pitchDeg: [5, 20], distance: [120, 190] },
    "From above the flats south-east of the walls: lower third, the Basin Gate towers, the herald's signal tower and the reservoir; centre, the four terraces climbing behind their retaining walls past the covered market's domes and the courtyard houses to the manor, its green domes and great windcatcher; top, the escarpment with the repaired rim watchtower, the crown aqueduct striding along the plateau and a bare range in the haze; the oasis palms fill the left edge. Low sun from the left (south-west) rakes the retaining walls.",
    2.4,
  ),
  camera(
    "founding",
    "Founding — the standard raised over the parade court",
    L3(21, 15, -2),
    L3(29.5, 18.5, -31),
    50,
    { yawDeg: [-8, 8], pitchDeg: [-11, -2], distance: [26, 34] },
    "From above the works-yard edge, as the levy sees it: the new standard rising from the centre of the parade dais between the two older standards, the file posts and the pawn stand before it; behind, the retaining wall, the War Record's block and dome, the manor's green dome and windcatcher, and the repaired rim watchtower on the escarpment.",
    2.0,
  ),
  camera(
    "landmark:banner-hall",
    "Banner Hall",
    L3(0, 41, -8),
    hallTarget,
    44,
    { yawDeg: [-30, 30], pitchDeg: [14, 34], distance: [30, 56] },
    "On the spine above the Manor Stair: over the manor gate into the court with its pool and arcades, the iwan and the green dome on axis, the lodging and the War Record either side, the windcatcher rising at the right against the escarpment.",
  ),
  camera(
    "landmark:muster-grounds",
    "Muster Grounds",
    L3(31, 22, 0),
    musterTarget,
    46,
    { yawDeg: [-25, 25], pitchDeg: [14, 34], distance: [18, 40] },
    "From above the levy house, on the parade court's axis: the pawn stand and its figure in the centre, the eight file posts and the stepped dais with its three standards behind, the armoury to the right, the manor's retaining wall and the foot of the War Record across the top.",
  ),
  camera(
    "landmark:war-record",
    "War Record",
    cameraFrom(recordTarget, LB(110), 36, 10),
    recordTarget,
    40,
    { yawDeg: [-25, 25], pitchDeg: [10, 34], distance: [24, 48] },
    "The domed archive on the court's east side, its arcade joining the hall, the unfinished cistern house beyond.",
  ),
  camera(
    "landmark:heralds-station",
    "Herald's Station",
    cameraFrom(heraldTarget, LB(140), 34, 10),
    heraldTarget,
    42,
    { yawDeg: [-25, 25], pitchDeg: [10, 34], distance: [22, 44] },
    "From outside the lower wall: the signal tower and its mirror frame, the post court door and notice board beside the Basin Gate towers.",
  ),
  camera(
    "representative",
    "Representative close-up",
    L3(31, muster.pawnStand.position[1] + 2.2, -13),
    pawnTarget,
    32,
    { yawDeg: [-30, 30], pitchDeg: [2, 20], distance: [5, 8.5] },
    "Eye-level close-up of the nominated representative on the pawn stand (or the empty stand and sealed letter), the dais and file posts behind, the manor wall above.",
    1.4,
  ),
];

const WIND_TOP = round2(HALL_FLOOR + 22.5);
const VR_SCALE = 0.008;
const DETAIL = { width: 112, depth: 112 };
const SEATED = { eyeHeight: 1.2, surfaceHeight: 0.74, viewerDistance: 0.82 };

const vr: BannerholdBlueprint["vr"] = {
  displayScale: VR_SCALE,
  displayCenter: P(0, -11),
  datumY: 0,
  detailExtent: DETAIL,
  skirtMargins: { far: 150, lateral: 70, near: 0 },
  viewerFacingBearingDeg: LB(0),
  seated: SEATED,
  standing: { eyeHeight: 1.62, surfaceHeight: 0.98, viewerDistance: 0.85 },
  rotation: { userRotatable: true, yawLimitDeg: 45, snapStepDeg: 15, resetsOnRecentre: true },
  reach: { pokeMax: 0.65, rayMax: 3, minTargetRadius: 0.035 },
  recentre: {
    keepsScale: true,
    keepsYaw: false,
    description: `Recentring re-places the gameplay anchor in front of the viewer; the miniature resets to its authored yaw (the viewer looks up the terraces toward bearing ${LB(0)}°) and to the posture heights. The viewer is never moved or rotated.`,
  },
  horizon: { ringRadius: 8, ringBaseHeight: -0.18, ringHeight: 1.4 },
  panelAnchors: { primary: [-0.74, 0.38, 0.24], dock: [0.64, 0.1, 0.36] },
  anchorConvention:
    "Assumed until gameplay confirms: the parent anchor's origin is the floor point beneath the viewer at recentre, -Z forward, no pitch or roll. The miniature's centre sits at (0, surfaceHeight, -viewerDistance).",
  comfortNotes: [
    `1:${Math.round(1 / VR_SCALE)} puts the ${DETAIL.width} × ${DETAIL.depth} m detail region on a ${(DETAIL.width * VR_SCALE).toFixed(2)} × ${(DETAIL.depth * VR_SCALE).toFixed(2)} m surface; the great windcatcher (${WIND_TOP} m) rises ${(WIND_TOP * VR_SCALE).toFixed(2)} m, below seated eye height.`,
    `Near edge ${(SEATED.viewerDistance - (DETAIL.depth * VR_SCALE) / 2).toFixed(2)} m from the eyes seated: the Basin Gate and the oasis are nearest, the terraces climb away so no tall mass hides the town.`,
    "The escarpment and plateau rise behind the manor as a backdrop beyond the far edge.",
    "No artificial viewer motion: focusLandmark raises the landmark's emphasis and label only.",
  ],
};

const atmosphere: BannerholdBlueprint["atmosphere"] = {
  timeOfDay: "Late afternoon: a low, heavy sun in a sulfur-yellow haze, the basin glowing below the terraces",
  sun: { bearingDeg: 232, elevationDeg: 19, colour: "#ffcf8a", intensity: 2.3, disc: "veiled-sun" },
  sky: { zenith: "#7f97ad", horizon: "#e6c48c", ground: "#a07a52", ambientIntensity: 0.7 },
  fog: { colour: "#d8b37c", near: 260, far: 3200, heightFalloff: 0.006 },
  wind: { towardBearingDeg: 60, speed: 6, gustiness: 0.5 },
  exposure: 0.95,
  accentLights: [
    { kind: "furnace", colour: "#ff7a2a", note: "Sulfur kiln mouths and the smithy." },
    { kind: "lantern", colour: "#ffc477", note: "Lamps in the covered market's light shafts and at the gates." },
    { kind: "brazier", colour: "#ffab5c", note: "Braziers flanking the iwan." },
    { kind: "signal-lamp", colour: "#fff1c2", note: "The herald's signal mirror catching the sun." },
  ],
  palette: {
    sandstone: "#c8a678",
    limePlaster: "#d9c7a6",
    mudbrick: "#b98c62",
    sulfur: "#d6c25a",
    glazedTile: "#2f6f6a",
    shadow: "#5a3e2c",
    sky: "#7f97ad",
    haze: "#e6c48c",
    or: "#c9a23a",
    tenne: "#a8622a",
    crownField: "#8c5a2b",
    crownBorder: "#c9a050",
  },
  notes: "Warm key, cool sky fill: shaded courts and lanes read as deep blue-brown pools. Haze builds with distance across the basin; no bloom — the glow is in the palette, not in post-processing.",
};

// --- Districts, traditions and the blueprint -------------------------------------

const districts: BannerholdBlueprint["districts"] = [
  { id: "A", name: "Manor Terrace", role: "The Banner Hall with its iwan, dome and great windcatcher, the household wing, the manor court and gate, and the unfinished cistern house, at +14 m.", polygon: poly([[-52, -61], [52, -61], [52, -31], [41.4, -31], [41.4, -40.4], [26.4, -40.4], [26.4, -51.4], [14.6, -51.4], [14.6, -31], [-52, -31]]) },
  { id: "B", name: "Parade Court", role: "Walled sand court with the stepped dais, file posts and pawn stand, armoury and levy house, at +8 m.", polygon: poly([[14, -30.6], [51, -30.6], [51, -6.2], [14, -6.2]]) },
  { id: "C", name: "Shade Lane Quarter", role: "Courtyard houses on a blind lane and the houses beside the Manor Way, at +8 m.", polygon: poly([[-51, -30.6], [14, -30.6], [14, -6.2], [-51, -6.2]]) },
  { id: "D", name: "Market and Works Terrace", role: "The covered market, grain domes, storehouse, sulfur works and smithy at +2 m, and the caravan court inside the gate.", polygon: poly([[-51, -6], [51, -6], [51, 18.4], [-10.6, 18.4], [-10.6, 37.6], [-51, 37.6]]) },
  { id: "E", name: "Basin Gate and Herald's Station", role: "The gate towers, the gate square and the herald's signal tower and post court, at −3 m.", polygon: poly([[-10.6, 18.4], [51, 18.4], [51, 37.6], [10, 37.6], [10, 42], [-10, 42], [-10.6, 37.6]]) },
  { id: "F", name: "War Record", role: "The domed archive on the manor court's east side, joined to the hall by its arcade.", polygon: poly([[14.6, -51.4], [26.4, -51.4], [26.4, -40.4], [41.4, -40.4], [41.4, -31], [14.6, -31]]) },
];

const traditions: BannerholdBlueprint["traditions"] = [
  { key: CUT, name: "Cut sandstone", description: "Dressed sandstone in thick battered walls, carved friezes, tall iwan portals, glazed domes and square windcatchers. Reserved for the manor, the archive, the gates and the watch.", materials: [SANDSTONE, PLASTER, TILE] },
  { key: COURT, name: "Courtyard house", description: "Lime-plastered mud brick and rubble around an open court, blank walls to the lane, flat roof terraces behind parapets, small windcatchers on the richer houses.", materials: [MUDBRICK, RUBBLE, PLASTER, PALM] },
  { key: WORKS, name: "Works sheds", description: "Rubble walls stained yellow, riveted iron roofs and sawtooth lights, tall banded flues: the industry that pays the holding's dues.", materials: [RUBBLE, IRON] },
];

const settlementBoundary: Vec2[] = poly([[-52.5, -61.2], [52.5, -61.2], [52.5, 42.6], [-52.5, 42.6]]);

export const SOLFORIZ_BLUEPRINT: BannerholdBlueprint = {
  schema: 1,
  nationId: "solforiz",
  siteName: "The terraced holding",
  status: "first-pass",
  summary:
    "An engineered cascade of four terraces on an escarpment above a mineral basin: the manor with its great windcatcher and domed War Record at +14 m, courtyard houses and the parade court at +8 m, the covered market and sulfur works at +2 m, the Basin Gate at −3 m. A covered market street and a stone rill run straight down the spine; the causeway crosses the flats toward the capital 28 km to the south-east.",
  terrain,
  settlementBoundary,
  coreReference: { width: 105, depth: 104 },
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
  unfinished: { buildingId: "sf-cistern-house", description: "A second cistern house on the top terrace: walls to 3.4 m and scaffold; completes at hall tier 1." },
  slots,
  story,
  vegetation,
  dressing,
  activitySites,
  npcs,
  outer,
  viewCorridors,
  expansion,
  observation: { position: establishingPos, target: ESTABLISHING_TARGET, description: "From above the flats south-east of the walls, looking up the four terraces to the manor, the escarpment and the plateau skyline." },
  cameras,
  vr,
  atmosphere,
};
