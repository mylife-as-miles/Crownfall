// KWIND-09 — the charter yard (working placeholder name). First-pass layout for the shared
// pipeline; every name and story line is a working placeholder pending creator approval.
//
// Terrain logic: no natural ground survives inside the enclave. A reclaimed foundry quay at
// +3 m carries the lower yard; a structural podium deck at +11 m carries the house's own
// buildings, so altitude reads as standing at a glance. The quay wall drops to an old foundry
// harbour basin to the south; industrial flats and slag lie to the west; an expressway crosses
// the north on 20 m piers with an off-ramp down to the arterial and the checkpoint.
// Organisation: a chartered enclave, never a village. The charter hall (the Banner Hall) and
// the ledger vault (the War Record) stand on the deck behind a parapet and an access gate; the
// levy is named on a painted loading yard beneath the podium wall; worker blocks of every age
// line Charter Street and the quay; a fabrication shed, a freight lift, stores, a water tower
// and a substation line the service ramp. The capital's towers stand beyond in the smog.
// Coordinates are world plan metres (+X east, +Z south) with the origin at the enclave's centre.

import { building, camera, cameraFrom, distantPlace, groundTools, mass, poseRow } from "../authoring";
import { resolveBuildingBase } from "../buildings";
import { round2 } from "../math2d";
import { createTerrainSampler } from "../terrain";
import type { BannerholdBlueprint, Building, NpcAgent, Route, TerrainFeature, TerrainModel, Vec2, Vec3, WaterBody } from "../types";

const QUAY = 3;
const DECK = 11;

// --- Terrain ----------------------------------------------------------------

const PODIUM: Vec2[] = [[-42, -44], [38, -44], [38, -34], [32, -34], [32, -6], [-42, -6]];
const BASIN: Vec2[] = [[-140, 49], [170, 49], [170, 140], [-140, 140]];

const features: TerrainFeature[] = [
  { kind: "slope", gradient: [0.002, 0.004] },
  { kind: "noise", seed: 9091, amplitude: 0.35, wavelength: 26, octaves: 2 },
  // Slag heaps and spoil on the waste ground west of the arterial.
  { kind: "mound", id: "kw-slag-heap", center: [-150, -112], radiusX: 34, radiusZ: 22, rotationDeg: 20, height: 9, surface: "slag" },
  { kind: "mound", id: "kw-spoil", center: [-122, 74], radiusX: 20, radiusZ: 14, height: 3.5, surface: "gravel" },
  // The neighbouring combine's yard, the enclave's quay, the podium deck and its service ramp.
  { kind: "platform", id: "kw-east-yard", shape: { kind: "polygon", points: [[58, -60], [200, -60], [200, 49], [58, 49]] }, elevation: 2.6, falloff: 4, surface: "asphalt", edge: "slope" },
  { kind: "platform", id: "kw-quay", shape: { kind: "polygon", points: [[-58, -48], [58, -48], [58, 49], [-58, 49]] }, elevation: QUAY, falloff: 3, surface: "concrete", edge: "retaining-wall" },
  { kind: "platform", id: "kw-podium", shape: { kind: "polygon", points: PODIUM }, elevation: DECK, falloff: 0.6, surface: "paving", edge: "retaining-wall" },
  { kind: "ramp", id: "kw-service-ramp-grade", points: [[35, 13], [35, -30]], width: 5, startElevation: QUAY, endElevation: DECK, falloff: 0.8, surface: "concrete" },
  // The harbour basin cut below the quay wall, and the far quay beyond it.
  { kind: "platform", id: "kw-harbour-basin", shape: { kind: "polygon", points: BASIN }, elevation: -4.5, falloff: 0, surface: "mud", edge: "retaining-wall" },
  { kind: "platform", id: "kw-far-quay", shape: { kind: "polygon", points: [[-200, 140], [200, 140], [200, 200], [-200, 200]] }, elevation: 2.8, falloff: 0, surface: "concrete", edge: "retaining-wall" },
];

const EXTENTS = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };

const water: WaterBody[] = [
  { id: "kw-harbour", kind: "reservoir", shape: { kind: "area", points: BASIN }, level: -1.2, flow: 0, note: "The old foundry harbour: still, oily water 4 m below the quay top, a single landing pontoon below the enclave and lighters moored along the far quay." },
];

const terrain: TerrainModel = {
  extents: EXTENTS,
  baseElevation: 2,
  baseSurface: "gravel",
  features,
  water,
  surfaces: [
    { id: "kw-charter-street-asphalt", surface: "asphalt", shape: { kind: "rect", center: [-2, 16], width: 108, depth: 7 } },
    { id: "kw-muster-yard-concrete", surface: "concrete", shape: { kind: "rect", center: [-15.5, 4], width: 41, depth: 18 } },
    { id: "kw-waste-ground", surface: "slag", shape: { kind: "polygon", points: [[-200, -200], [-92, -200], [-92, 46], [-200, 46]] } },
    { id: "kw-allotment-soil", surface: "field", shape: { kind: "polygon", points: [[-98, 26], [-148, 22], [-150, 46], [-100, 50]] } },
  ],
  logic:
    "Engineered ground only. A reclaimed foundry quay at +3 m carries the lower yard; a podium deck at +11 m (an 8 m retaining face to the south) carries the charter hall, the household block and the ledger vault, and is reached by a stair along its face, a freight lift and a 43 m service ramp. The quay wall drops 7.5 m to a harbour basin at −4.5 m (water at −1.2 m); industrial flats at ≈ +2 m with slag heaps lie west of the arterial; the expressway runs north of the enclave on piers with its deck at +22 m.",
};

const T = createTerrainSampler(terrain);
const G = groundTools(T);

// --- Materials --------------------------------------------------------------------

const CONCRETE = "kw-concrete";
const BRICK = "kw-brick-soot";
const STEEL = "kw-steel-panel";
const SHEET = "kw-corrugated-sheet";
const RUST = "kw-rusted-steel";
const GLASS = "kw-glass-grid";
const TILE = "kw-ceramic-tile";
const COPPER = "kw-copper-verdigris";
const FELT = "kw-asphalt-felt";
const LATTICE = "kw-timber-lattice";

const HERITAGE = "kw-charter-heritage";
const FERRO = "kw-ferroconcrete";
const SHEETWORK = "kw-sheet-industrial";

// --- Circulation ------------------------------------------------------------------

const route = (r: Omit<Route, "grade" | "covered" | "outer"> & Partial<Pick<Route, "grade" | "covered" | "outer" | "deckY">>): Route => ({ grade: "ground", covered: false, outer: false, ...r });

const EXPRESSWAY_DECK = 22;
const OFF_RAMP_FOOT = round2(T.height(-76.6, -14));

const routes: Route[] = [
  route({
    id: "kw-arterial",
    name: "The arterial to the capital",
    kind: "road",
    hierarchy: "national",
    points: [[-56, 16], [-72, 16], [-78, -20], [-82, -80], [-86, -160], [-40, -420], [400, -1300], [3000, -5000], [9000, -12000]],
    width: 9,
    surface: "asphalt",
    users: ["vehicles", "merchants", "messengers", "carts", "workers", "soldiers"],
    outer: true,
  }),
  route({
    id: "kw-expressway",
    name: "The expressway",
    kind: "elevated-road",
    hierarchy: "primary",
    points: [[2600, -2000], [600, -480], [200, -150], [70, -74], [-20, -72], [-100, -68], [-260, -50], [-1400, 240]],
    width: 12,
    surface: "concrete",
    grade: "elevated",
    deckY: [EXPRESSWAY_DECK, EXPRESSWAY_DECK, EXPRESSWAY_DECK, EXPRESSWAY_DECK, EXPRESSWAY_DECK, EXPRESSWAY_DECK, EXPRESSWAY_DECK, EXPRESSWAY_DECK],
    users: ["vehicles", "messengers", "merchants"],
    outer: true,
  }),
  route({
    id: "kw-off-ramp",
    name: "Expressway off-ramp",
    kind: "ramp",
    hierarchy: "secondary",
    points: [[-72, -69.4], [-72, -50], [-73, -30], [-76.6, -14]],
    width: 7,
    surface: "concrete",
    grade: "elevated",
    deckY: [EXPRESSWAY_DECK, 15.4, 8.6, OFF_RAMP_FOOT],
    users: ["vehicles", "messengers"],
  }),
  route({ id: "kw-charter-street", name: "Charter Street", kind: "street", hierarchy: "primary", points: [[-56, 16], [-40, 16], [-20, 16], [0, 16], [20, 16], [40, 16], [52, 16]], width: 7, surface: "asphalt", users: ["workers", "residents", "vehicles", "carts", "messengers"] }),
  route({ id: "kw-quay-road", name: "Quay Road", kind: "road", hierarchy: "secondary", points: [[52, 16], [52, 30], [52, 43.5], [30, 43.5], [0, 43.5], [-30, 43.5], [-46, 43.5]], width: 5, surface: "concrete", users: ["workers", "carts", "vehicles", "residents"] }),
  route({ id: "kw-yard-walk", name: "Yard Walk", kind: "path", hierarchy: "pedestrian", points: [[-36, 16], [-36, 0], [-36, -3.8]], width: 3, surface: "concrete", users: ["soldiers", "residents"] }),
  route({ id: "kw-yard-path", name: "Armoury Path", kind: "path", hierarchy: "pedestrian", points: [[-36, 0], [-24, 0]], width: 2.4, surface: "concrete", users: ["soldiers"] }),
  route({ id: "kw-muster-walk", name: "Muster Walk", kind: "path", hierarchy: "pedestrian", points: [[-3, 16], [-3, 4.4]], width: 3, surface: "concrete", users: ["soldiers", "nobility"] }),
  route({
    id: "kw-deck-stair",
    name: "The Deck Stair",
    kind: "stair",
    hierarchy: "pedestrian",
    points: [[-36, -3.8], [-16, -3.8], [-12, -3.8], [-12, -7.6]],
    width: 3,
    surface: "steel-grate",
    grade: "elevated",
    deckY: [QUAY, DECK, DECK, DECK],
    users: ["soldiers", "nobility", "messengers"],
  }),
  route({ id: "kw-deck-promenade", name: "Deck Promenade", kind: "path", hierarchy: "pedestrian", points: [[-12, -7.6], [-12, -12], [-6, -13.5], [10, -13.5], [24, -13.5]], width: 4, surface: "flagstone", users: ["nobility", "messengers", "residents"] }),
  route({ id: "kw-forecourt-walk", name: "Portico Walk", kind: "path", hierarchy: "pedestrian", points: [[-6, -13.5], [-6, -16.8]], width: 4, surface: "flagstone", users: ["nobility", "messengers"] }),
  route({ id: "kw-lodging-walk", name: "Household Walk", kind: "path", hierarchy: "pedestrian", points: [[-12, -12], [-30, -12], [-30, -18]], width: 3, surface: "flagstone", users: ["nobility", "residents"] }),
  route({ id: "kw-service-ramp", name: "Service Ramp", kind: "ramp", hierarchy: "service", points: [[35, 13], [35, -30]], width: 5, surface: "concrete", users: ["vehicles", "workers", "carts"] }),
  route({ id: "kw-deck-service", name: "Deck Service Way", kind: "service-corridor", hierarchy: "service", points: [[35, -30], [28.4, -30], [28.4, -35.2], [10, -35.2], [-12, -35.2], [-30, -35.2]], width: 2.4, surface: "concrete", users: ["workers", "residents"] }),
  route({ id: "kw-ledger-lane", name: "Ledger Lane", kind: "lane", hierarchy: "pedestrian", points: [[-4.5, 16], [-4.5, 31], [-4.5, 43.5]], width: 3, surface: "concrete", users: ["residents", "workers"] }),
  route({ id: "kw-tank-alley", name: "Tank Alley", kind: "alley", hierarchy: "pedestrian", points: [[17.5, 16], [17.5, 31], [17.5, 43.5]], width: 2.6, surface: "concrete", users: ["residents", "workers"] }),
  route({ id: "kw-back-court-west", name: "West Back Court", kind: "alley", hierarchy: "pedestrian", points: [[-34, 31], [-4.5, 31]], width: 2.6, surface: "concrete", users: ["residents"] }),
  route({ id: "kw-back-court-east", name: "East Back Court", kind: "alley", hierarchy: "pedestrian", points: [[-4.5, 31], [17.5, 31], [32.6, 31]], width: 2.6, surface: "concrete", users: ["residents"] }),
  route({ id: "kw-courier-lane", name: "Courier Bay", kind: "lane", hierarchy: "secondary", points: [[-46, 16], [-46, 21.4]], width: 3.5, surface: "asphalt", users: ["messengers", "vehicles"] }),
  route({ id: "kw-herald-steps", name: "Signal Office Steps", kind: "path", hierarchy: "secondary", points: [[-46, 16], [-46, 6.6]], width: 3, surface: "concrete", users: ["messengers", "residents"] }),
  route({ id: "kw-quay-rail", name: "Quay Rail", kind: "rail", hierarchy: "service", points: [[46, 46.2], [20, 46.4], [-20, 46.4], [-42, 46.2]], width: 3.2, surface: "ballast", users: ["workers"] }),
  route({
    id: "kw-landing-stair",
    name: "Landing Stair",
    kind: "stair",
    hierarchy: "pedestrian",
    points: [[6, 43.5], [6, 48.6], [6, 53]],
    width: 2.4,
    surface: "steel-grate",
    grade: "elevated",
    deckY: [QUAY, QUAY, -0.4],
    users: ["residents", "workers"],
  }),
  route({ id: "kw-allotment-track", name: "Allotment Track", kind: "track", hierarchy: "service", points: [[-72, 16], [-96, 30], [-120, 36]], width: 2.4, surface: "packed-earth", users: ["residents", "workers"] }),
];

const destinations: BannerholdBlueprint["destinations"] = [
  { id: "gate", label: "Checkpoint", position: [-56, 16] },
  { id: "manor", label: "Charter hall portico", position: [-6, -17.2] },
  { id: "muster", label: "Representative's mark in the muster yard", position: [-3, 3.2] },
  { id: "residential", label: "Ledger Lane and the back courts", position: [-4.5, 31] },
  { id: "artisan", label: "Fabrication shed", position: [16.5, 9.6] },
  { id: "archive", label: "Ledger vault door", position: [20, -19] },
  { id: "herald", label: "Signal office door", position: [-46, 6] },
  { id: "ceremonial", label: "Honour terrace", position: [-6, -12.4] },
];

// --- Architecture ---------------------------------------------------------------

const deck: Building[] = [
  // A — The charter deck (+11 m): the charter hall (Banner Hall), the household block, the canteen,
  // the access-gate lodge and the unfinished annex frame.
  building({
    id: "kw-charter-hall",
    name: "The Charter Hall",
    district: "A",
    fn: "banner-hall",
    tradition: HERITAGE,
    masses: [
      mass({ id: "hall", role: "hall", at: [-6, -27], w: 22, d: 14, storeys: 3, eave: 13, ridge: 19.5, roof: "curved-ridge", axis: "x", roofMat: TILE, wallMat: BRICK }),
      mass({ id: "portico", role: "porch", at: [-6, -18.6], w: 11, d: 2.8, storeys: 1, eave: 6.4, ridge: 8.2, roof: "curved-ridge", axis: "x", roofMat: TILE, wallMat: STEEL }),
      mass({ id: "ledger-tower", role: "tower", at: [8, -31], w: 6, d: 6, storeys: 7, eave: 26, ridge: 31, roof: "setback-crown", roofMat: STEEL, wallMat: STEEL }),
      mass({ id: "flue", role: "chimney", at: [-15.6, -31.6], w: 1.6, d: 1.6, storeys: 1, eave: 23, ridge: 23.5, roof: "flat", roofMat: BRICK, wallMat: BRICK }),
    ],
    door: [-6, -17.2],
    facing: 180,
    foundation: { kind: "podium", plinth: 0.6, maxRelief: 1.5 },
    era: "predecessor",
    built: 90,
    condition: "worn",
    repairs: [
      { kind: "patched-roof", note: "Ridge tiles replaced in grey composite where the old glaze cracked; the patch shows from the yard.", mass: "hall" },
      { kind: "welded-plate", note: "The ledger tower's base wrapped in new steel plate after the earlier conflict.", mass: "ledger-tower" },
      { kind: "boarded-opening", note: "Two upper bays shuttered: the house cannot staff the whole floor.", mass: "hall" },
    ],
    quality: "noble",
    social: "lord",
    lod: "hero",
    kit: "kw.deck.charter-hall",
    landmark: "banner-hall",
    tags: ["banner-mount", "emblem", "house-sign", "ledger-display", "lattice-screens", "curved-eaves", "lanterns", "old-flue"],
    story: "The foundry company's old charter hall, kept by every holder since: soot-black brick under a tiled roof with upturned eaves and a steel ledger tower bolted to its flank. The banner's sign is new cyan glass over the portico; two upper bays stay shuttered.",
  }),
  building({
    id: "kw-lodging",
    name: "The Household Block",
    district: "A",
    fn: "manor-house",
    tradition: FERRO,
    masses: [
      mass({ id: "block", role: "block", at: [-30, -26], w: 13, d: 15, storeys: 5, eave: 17, ridge: 18.2, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE }),
      mass({ id: "roof-garden", role: "canopy", at: [-30, -26], w: 8, d: 6, storeys: 1, eave: 2.6, ridge: 2.8, roof: "open-frame", roofMat: LATTICE, wallMat: LATTICE, baseOffset: 17 }),
      mass({ id: "screens", role: "gallery", at: [-30, -18.1], w: 9, d: 0.8, storeys: 4, eave: 13.6, ridge: 13.6, roof: "flat", roofMat: LATTICE, wallMat: LATTICE, baseOffset: 3.2 }),
    ],
    door: [-30, -18.5],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.45, maxRelief: 1.5 },
    era: "recent",
    built: 22,
    condition: "sound",
    repairs: [{ kind: "fresh-render", note: "Deck face re-rendered for the founding; the north face still carries the previous holder's grime.", mass: "block" }],
    quality: "fine",
    social: "lord",
    lod: "hero",
    kit: "kw.deck.household-block",
    tags: ["roof-garden", "lattice-screens", "water-tank", "shutters"],
    story: "The household's apartments: five storeys of ferroconcrete behind lattice screens, a planted roof on top, warmer and newer than the hall it serves.",
  }),
  building({
    id: "kw-canteen",
    name: "Deck Canteen",
    district: "A",
    fn: "kitchen",
    tradition: FERRO,
    masses: [
      mass({ id: "block", role: "block", at: [-30, -39.8], w: 12, d: 6, storeys: 2, eave: 7, ridge: 7.8, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE }),
      mass({ id: "vent", role: "stack", at: [-25.4, -41.6], w: 1.2, d: 1.2, storeys: 1, eave: 10, ridge: 10.4, roof: "flat", roofMat: RUST, wallMat: RUST }),
    ],
    door: [-30, -36.8],
    facing: 180,
    era: "recent",
    built: 22,
    condition: "worn",
    quality: "common",
    social: "retainer",
    kit: "kw.deck.canteen",
    tags: ["steam-vent", "water-jars", "crates"],
    story: "The busiest door on the deck; its vent steams from before the first shift bell to after the last.",
  }),
  building({
    id: "kw-gate-lodge",
    name: "Deck Gate Lodge",
    district: "A",
    fn: "checkpoint",
    tradition: FERRO,
    masses: [mass({ id: "lodge", role: "house", at: [-16, -9.1], w: 3, d: 3, storeys: 1, eave: 3, ridge: 3.4, roof: "flat-parapet", roofMat: FELT, wallMat: GLASS })],
    door: [-14.5, -9.1],
    facing: 90,
    era: "founding",
    built: 2,
    condition: "sound",
    quality: "common",
    social: "martial",
    kit: "kw.deck.gate-lodge",
    tags: ["turnstile", "access-gate", "floodlight"],
    story: "A glass lodge and a turnstile at the head of the Deck Stair: the line between the yard and the deck, kept by one guard.",
  }),
  building({
    id: "kw-annex-tower",
    name: "Annex Frame (unfinished)",
    district: "A",
    fn: "office",
    tradition: FERRO,
    masses: [
      mass({ id: "frame", role: "block", at: [29, -40], w: 12, d: 6.4, storeys: 3, eave: 12, ridge: 12, roof: "open-frame", roofMat: RUST, wallMat: RUST }),
      mass({ id: "scaffold", role: "scaffold", at: [22.2, -40], w: 1.4, d: 6.4, storeys: 3, eave: 13, ridge: 13, roof: "open-frame", roofMat: RUST, wallMat: RUST }),
    ],
    door: [29, -36.8],
    facing: 180,
    era: "under-construction",
    built: 0,
    condition: "under-construction",
    quality: "fine",
    social: "lord",
    lod: "hero",
    kit: "kw.deck.annex-frame",
    tags: ["scaffold", "tower-crane", "steel-stack", "safety-netting"],
    story: "A steel frame three storeys high beside an idle tower crane: the banner's annex, raised one recognition at a time.",
    unfinished: { stage: "roof-frame", completesAtHallTier: 1, scaffold: true },
  }),
  // F — The ledger vault (War Record), joined to the charter hall by a glazed skybridge.
  building({
    id: "kw-ledger-vault",
    name: "The Ledger Vault",
    district: "F",
    fn: "archive",
    tradition: HERITAGE,
    masses: [
      mass({ id: "vault", role: "vault", at: [20, -26], w: 12, d: 14, storeys: 2, eave: 9, ridge: 12.5, roof: "barrel-vault", axis: "z", roofMat: COPPER, wallMat: CONCRETE }),
      mass({ id: "skybridge", role: "gallery", at: [9.5, -24], w: 9, d: 3, storeys: 1, eave: 3.2, ridge: 4.2, roof: "flat", roofMat: STEEL, wallMat: GLASS, baseOffset: 6 }),
    ],
    door: [20, -19],
    facing: 180,
    foundation: { kind: "plinth", plinth: 0.6, maxRelief: 1.5 },
    era: "predecessor",
    built: 80,
    condition: "weathered",
    repairs: [
      { kind: "iron-strapping", note: "Iron bands across a crack in the vault's south gable.", mass: "vault" },
      { kind: "replaced-gate", note: "Vault door re-hung on new steel hinges; the old door leans against the deck rail.", mass: "vault" },
    ],
    quality: "fine",
    social: "civic",
    lod: "hero",
    kit: "kw.record.ledger-vault",
    landmark: "war-record",
    tags: ["war-table", "ledgers", "index-drawers", "copper-vault", "skybridge", "index-clock"],
    story: "A concrete vault under a green copper roof: the previous charter holder's ledgers fill the lower drawers; the banner's War Record has begun in one cabinet by the door, and the table holds its markers.",
    overlap: ["kw-charter-hall"],
  }),
  building({
    id: "kw-record-gallery",
    name: "Record Gallery (development)",
    district: "F",
    fn: "archive",
    tradition: FERRO,
    masses: [mass({ id: "gallery", role: "wing", at: [16, -39.8], w: 10, d: 6, storeys: 2, eave: 8, ridge: 8.8, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE })],
    door: [16, -36.8],
    facing: 180,
    era: "recent",
    built: 0,
    condition: "new",
    quality: "fine",
    social: "civic",
    kit: "kw.record.gallery",
    tags: ["banner-mount", "honour-wall"],
    story: "Appears only when recognition reaches hall tier 2: a glazed gallery for honours and returned standards beside the vault.",
    tier: 2,
  }),
];

const yard: Building[] = [
  // B — The muster yard: a painted loading yard beneath the podium wall.
  building({
    id: "kw-muster-dock",
    name: "Muster Dock",
    district: "B",
    fn: "muster-platform",
    tradition: FERRO,
    masses: [mass({ id: "dock", role: "platform", at: [-3, -3.5], w: 14, d: 3.4, storeys: 1, eave: 1.2, ridge: 1.2, roof: "none", axis: "x", roofMat: CONCRETE, wallMat: STEEL })],
    door: [-3, -1.8],
    facing: 180,
    foundation: { kind: "flush", plinth: 0, maxRelief: 0.5 },
    era: "predecessor",
    built: 60,
    condition: "worn",
    repairs: [{ kind: "welded-plate", note: "Dock edge re-plated in steel where barrows chewed the concrete.", mass: "dock" }],
    quality: "common",
    social: "martial",
    lod: "hero",
    kit: "kw.muster.dock",
    landmark: "muster-grounds",
    tags: ["banner-mount", "file-marks", "standard-posts", "podium-wall"],
    story: "An old loading dock under the podium wall where the levy is named, the deck's parapet 8 m above it. The eight painted file marks before it belong to the formation, not the house.",
  }),
  building({
    id: "kw-armoury",
    name: "Container Armoury",
    district: "B",
    fn: "armoury",
    tradition: SHEETWORK,
    masses: [mass({ id: "store", role: "shed", at: [-30, 4], w: 6, d: 5, storeys: 1, eave: 3, ridge: 3.6, roof: "barrel-vault", axis: "x", roofMat: RUST, wallMat: RUST })],
    door: [-27, 4],
    facing: 90,
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "welded-plate", note: "Two cargo containers welded into one store, a hasp cut from a ship's plate.", mass: "store" }],
    quality: "common",
    social: "martial",
    kit: "kw.muster.armoury",
    tags: ["weapon-rack", "shields", "floodlight"],
    story: "More empty racks than staves: the house arms the few it can.",
  }),
  building({
    id: "kw-levy-dorm",
    name: "Levy Dormitory",
    district: "B",
    fn: "barracks",
    tradition: FERRO,
    masses: [
      mass({ id: "block", role: "block", at: [-30.8, 9.9], w: 7.6, d: 5.4, storeys: 3, eave: 9.6, ridge: 10.4, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE }),
      mass({ id: "stair", role: "stair-tower", at: [-26.4, 9.9], w: 1.2, d: 3, storeys: 3, eave: 9.6, ridge: 10.4, roof: "flat", roofMat: STEEL, wallMat: STEEL }),
    ],
    door: [-30.8, 12.6],
    facing: 180,
    era: "founding",
    built: 2,
    condition: "worn",
    repairs: [{ kind: "tarpaulin", note: "Tarpaulin weighted over a leaking roof light.", mass: "block" }],
    quality: "poor",
    social: "martial",
    kit: "kw.muster.levy-dorm",
    tags: ["external-stair", "laundry", "cooking-fire"],
    story: "A narrow three-storey dormitory where the levy sleeps when it is called: its back to the muster yard, its door on Charter Street.",
  }),
  // E — The checkpoint and the signal office (the Herald's Station) inside the west barrier.
  building({
    id: "kw-checkpoint",
    name: "Checkpoint",
    district: "E",
    fn: "gatehouse",
    tradition: FERRO,
    masses: [
      mass({ id: "gate", role: "gatehouse", at: [-56, 16], w: 8, d: 12, storeys: 2, eave: 8, ridge: 8.6, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE }),
      mass({ id: "booth", role: "annex", at: [-50.2, 20.6], w: 3.6, d: 2.4, storeys: 1, eave: 3, ridge: 3.4, roof: "flat", roofMat: STEEL, wallMat: GLASS }),
    ],
    door: [-52, 16],
    facing: 90,
    foundation: { kind: "plinth", plinth: 0.2, maxRelief: 1.8 },
    era: "predecessor",
    built: 50,
    condition: "worn",
    repairs: [{ kind: "replaced-gate", note: "Barrier arms and shutter replaced at the founding; the old shutter leans against the barrier, buckled.", mass: "gate" }],
    quality: "fine",
    social: "martial",
    lod: "hero",
    kit: "kw.fort.checkpoint",
    tags: ["banner-mount", "sign-gantry", "barrier-arms", "floodlights", "shutter"],
    story: "The only way in for road traffic: a concrete checkpoint under a sign gantry that carries the banner's mark beside the Zaibatsu's. Couriers and freight wait at its barrier arms.",
    overlap: ["kw-barrier", "kw-arterial", "kw-charter-street"],
  }),
  building({
    id: "kw-signal-office",
    name: "Signal Office",
    district: "E",
    fn: "herald-station",
    tradition: FERRO,
    masses: [
      mass({ id: "office", role: "block", at: [-46, 2], w: 8, d: 8, storeys: 3, eave: 10.5, ridge: 11.3, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE }),
      mass({ id: "mast", role: "mast", at: [-44.2, 0.2], w: 2, d: 2, storeys: 1, eave: 14, ridge: 16, roof: "open-frame", roofMat: STEEL, wallMat: STEEL, baseOffset: 10.5 }),
      mass({ id: "ledger-board", role: "canopy", at: [-46, 6.6], w: 7, d: 1.2, storeys: 1, eave: 3, ridge: 3, roof: "flat", roofMat: STEEL, wallMat: STEEL, baseOffset: 2.6 }),
    ],
    door: [-46, 6],
    facing: 180,
    era: "founding",
    built: 2,
    condition: "sound",
    repairs: [{ kind: "welded-plate", note: "The mast's lamp cage re-welded after a storm bent it.", mass: "mast" }],
    quality: "common",
    social: "civic",
    lod: "hero",
    kit: "kw.herald.signal-office",
    landmark: "heralds-station",
    tags: ["notice-board", "ledger-board", "signal-mast", "pneumatic-tube", "banner-mount", "floodlight"],
    story: "Summons, challenges and the Zaibatsu's notices arrive here first: by courier at the door, by pneumatic tube from the checkpoint and by lamp from the mast. The public ledger board over the door changes every shift.",
  }),
  building({
    id: "kw-courier-depot",
    name: "Courier Bay",
    district: "E",
    fn: "depot",
    tradition: SHEETWORK,
    masses: [mass({ id: "bay", role: "shed", at: [-46, 26], w: 8, d: 8, storeys: 1, eave: 4.5, ridge: 5.5, roof: "lean-to", axis: "x", roofMat: SHEET, wallMat: SHEET })],
    door: [-46, 22],
    facing: 0,
    era: "founding",
    built: 2,
    condition: "sound",
    quality: "common",
    social: "labourer",
    kit: "kw.herald.courier-bay",
    tags: ["steam-tricycles", "hand-cart", "fuel-drums"],
    story: "Two steam tricycles and a hand cart kept by obligation for the Zaibatsu's couriers.",
  }),
];

const works: Building[] = [
  // D — Works and stores along the service ramp and the quay.
  building({
    id: "kw-fab-shop",
    name: "Fabrication Shed",
    district: "D",
    fn: "fabrication",
    tradition: SHEETWORK,
    masses: [
      mass({ id: "shed", role: "hall", at: [16.5, 3], w: 17, d: 12, storeys: 1, eave: 7, ridge: 10, roof: "sawtooth", axis: "x", roofMat: SHEET, wallMat: BRICK }),
      mass({ id: "stack", role: "stack", at: [10, -1.6], w: 1.6, d: 1.6, storeys: 1, eave: 15, ridge: 15.5, roof: "flat", roofMat: RUST, wallMat: RUST }),
      mass({ id: "forge-bay", role: "canopy", at: [20, 10.4], w: 8, d: 2.8, storeys: 1, eave: 3.2, ridge: 3.8, roof: "lean-to", axis: "x", roofMat: SHEET, wallMat: STEEL }),
    ],
    door: [16.5, 9],
    facing: 180,
    era: "predecessor",
    built: 45,
    condition: "sound",
    repairs: [{ kind: "patched-roof", note: "New sheets on two teeth of the sawtooth, brighter than the rest.", mass: "shed" }],
    quality: "common",
    social: "artisan",
    lod: "hero",
    kit: "kw.works.fabrication-shed",
    tags: ["forge-glow", "power-hammer", "welding-sparks", "steam-vent", "sawtooth-glazing"],
    story: "The holding's fabrication shed: a power hammer inside, a welding bay under the street canopy, and a furnace whose glow shows through the sawtooth glazing at every shift.",
  }),
  building({
    id: "kw-freight-lift",
    name: "Freight Lift",
    district: "D",
    fn: "depot",
    tradition: SHEETWORK,
    masses: [mass({ id: "lift", role: "stair-tower", at: [28, -3.4], w: 4, d: 3.6, storeys: 4, eave: 15, ridge: 16, roof: "flat-parapet", roofMat: SHEET, wallMat: STEEL })],
    door: [28, -1.6],
    facing: 180,
    era: "predecessor",
    built: 40,
    condition: "worn",
    repairs: [{ kind: "iron-strapping", note: "Lift cage guides re-bolted; the winding house above is patched with sheet.", mass: "lift" }],
    quality: "common",
    social: "labourer",
    kit: "kw.works.freight-lift",
    tags: ["lift", "cage", "chains", "warning-lamp"],
    story: "A caged freight lift on the podium face, the only way crates reach the deck without the ramp; it clanks at every shift bell.",
  }),
  building({
    id: "kw-ration-depot",
    name: "Ration Depot",
    district: "D",
    fn: "storehouse",
    tradition: SHEETWORK,
    masses: [mass({ id: "store", role: "vault", at: [44, -20], w: 10, d: 16, storeys: 2, eave: 8, ridge: 11, roof: "barrel-vault", axis: "z", roofMat: SHEET, wallMat: BRICK })],
    door: [39, -20],
    facing: 270,
    era: "predecessor",
    built: 70,
    condition: "weathered",
    repairs: [{ kind: "welded-plate", note: "Rusted roof panels patched with welded sheet.", mass: "store" }],
    quality: "common",
    social: "labourer",
    kit: "kw.works.ration-depot",
    tags: ["loading-hoist", "crates", "seal-marks"],
    story: "Rations for the holding's people; the Zaibatsu's share leaves up the ramp every week, and the hoist beam is worn bright.",
  }),
  building({
    id: "kw-water-tower",
    name: "Water Tower",
    district: "D",
    fn: "cistern-house",
    tradition: SHEETWORK,
    masses: [
      mass({ id: "trestle", role: "platform", at: [44, -3], w: 8, d: 8, storeys: 1, eave: 10, ridge: 10, roof: "open-frame", roofMat: RUST, wallMat: RUST }),
      mass({ id: "tank", role: "silo", at: [44, -3], w: 8, d: 8, plan: "round", storeys: 1, eave: 5, ridge: 7.4, roof: "dome", roofMat: RUST, wallMat: RUST, baseOffset: 10 }),
    ],
    door: [40, -3],
    facing: 270,
    era: "predecessor",
    built: 60,
    condition: "worn",
    repairs: [{ kind: "iron-strapping", note: "Tank hoops re-tightened; rust tears weep down the legs.", mass: "tank" }],
    quality: "common",
    social: "civic",
    kit: "kw.works.water-tower",
    tags: ["riveted-tank", "ladder", "pipes", "ration-gauge"],
    story: "The holding's water: rain and condensate pumped into a riveted tank on legs and rationed by the hour.",
  }),
  building({
    id: "kw-substation",
    name: "Substation",
    district: "D",
    fn: "substation",
    tradition: FERRO,
    masses: [mass({ id: "house", role: "block", at: [44, 9], w: 9, d: 6, storeys: 1, eave: 5, ridge: 5.6, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE })],
    door: [39.5, 9],
    facing: 270,
    era: "recent",
    built: 15,
    condition: "sound",
    quality: "common",
    social: "labourer",
    kit: "kw.works.substation",
    tags: ["transformers", "cable-run", "warning-signs"],
    story: "Transformers humming behind a steel grille; cables from the expressway's mains feed the whole enclave.",
  }),
  building({
    id: "kw-warehouse",
    name: "Quay Warehouse",
    district: "D",
    fn: "warehouse",
    tradition: SHEETWORK,
    masses: [mass({ id: "store", role: "hall", at: [42, 30.25], w: 12, d: 21.5, storeys: 2, eave: 9, ridge: 12, roof: "gable", axis: "z", roofMat: SHEET, wallMat: BRICK })],
    door: [48, 30.25],
    facing: 90,
    era: "predecessor",
    built: 75,
    condition: "weathered",
    repairs: [{ kind: "boarded-opening", note: "Loading doors on the street side boarded; only the quay doors open.", mass: "store" }],
    quality: "common",
    social: "labourer",
    kit: "kw.works.warehouse",
    tags: ["loading-doors", "crane-hook", "pallets"],
    story: "A brick warehouse on the quay; most of what it holds belongs to the Zaibatsu, not the house.",
  }),
];

// C — Charter Street blocks: dwellings of every age and standing between Charter Street and the
// quay, split by Ledger Lane and Tank Alley, with back courts between the two rows.

interface Dwelling {
  id: string;
  name: string;
  fn: Building["function"];
  tradition: string;
  x0: number;
  x1: number;
  /** "street": fronts Charter Street (z 19.5–29.5); "quay": fronts Quay Road (z 32.5–41). */
  row: "street" | "quay";
  storeys: number;
  eave: number;
  ridge: number;
  roof: Building["masses"][number]["roof"]["form"];
  axis?: "x" | "z";
  roofMat: string;
  wallMat: string;
  extra?: Building["masses"][number][];
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

function dwelling(h: Dwelling): Building {
  const z0 = h.row === "street" ? 19.5 : 32.5;
  const z1 = h.row === "street" ? 29.5 : 41;
  const cx = round2((h.x0 + h.x1) / 2);
  const main = mass({ id: "main", role: "block", at: [cx, round2((z0 + z1) / 2)], w: round2(h.x1 - h.x0), d: round2(z1 - z0), storeys: h.storeys, eave: h.eave, ridge: h.ridge, roof: h.roof, axis: h.axis ?? "x", roofMat: h.roofMat, wallMat: h.wallMat });
  return building({
    id: h.id,
    name: h.name,
    district: "C",
    fn: h.fn,
    tradition: h.tradition,
    masses: [main].concat(h.extra ?? []),
    door: h.row === "street" ? [cx, z0] : [cx, z1],
    facing: h.row === "street" ? 0 : 180,
    foundation: { kind: "plinth", plinth: 0.35, maxRelief: 1.5 },
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

const blocks: Building[] = [
  dwelling({
    id: "kw-supervisor-house", name: "Supervisor's House", fn: "house", tradition: HERITAGE, x0: -33, x1: -25, row: "street", storeys: 3, eave: 10, ridge: 13.5, roof: "curved-ridge", roofMat: TILE, wallMat: BRICK,
    era: "predecessor", built: 70, condition: "sound", repairs: [{ kind: "fresh-render", note: "Street face repainted and the house mark renewed in the banner's colours.", mass: "main" }],
    quality: "fine", social: "retainer", lod: "hero", kit: "kw.house.supervisor", tags: ["tiled-roof", "lattice-screens", "lantern", "house-sign"],
    story: "The best house below the deck: the foundry company's old supervisor's house, kept by the reeve who served the previous charter holder and now serves this one.",
  }),
  dwelling({
    id: "kw-brick-row-west", name: "Brick Row (west)", fn: "house", tradition: HERITAGE, x0: -22.9, x1: -15.5, row: "street", storeys: 3, eave: 9.6, ridge: 11.8, roof: "gable", axis: "z", roofMat: SHEET, wallMat: BRICK,
    era: "predecessor", built: 85, condition: "worn", repairs: [{ kind: "patched-roof", note: "Half the roof re-sheeted in corrugated steel over the old tiles.", mass: "main" }],
    quality: "common", social: "commoner", kit: "kw.house.brick-row", tags: ["chimney", "window-boxes", "laundry"],
    story: "Gable-fronted brick houses from the foundry's day, two families to a floor now.",
  }),
  dwelling({
    id: "kw-brick-row-east", name: "Brick Row (east)", fn: "house", tradition: HERITAGE, x0: -15, x1: -7.6, row: "street", storeys: 3, eave: 10.4, ridge: 12.8, roof: "gable", axis: "z", roofMat: TILE, wallMat: BRICK,
    era: "predecessor", built: 85, condition: "weathered", repairs: [{ kind: "rebuilt-courses", note: "Ground storey refaced in mismatched brick after a cart struck it.", mass: "main" }],
    quality: "common", social: "artisan", kit: "kw.house.brick-row", tags: ["shop-front", "blade-sign", "chimney"],
    story: "A lantern-mender's shop on the ground floor, its blade sign the first light on the street at dusk.",
  }),
  dwelling({
    id: "kw-worker-block-a", name: "Charter Street Block", fn: "worker-block", tradition: FERRO, x0: -1.6, x1: 15.4, row: "street", storeys: 6, eave: 19.2, ridge: 20, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE,
    extra: [mass({ id: "tank", role: "silo", at: [12, 25], w: 3, d: 3, plan: "round", storeys: 1, eave: 2.4, ridge: 3, roof: "flat", roofMat: RUST, wallMat: RUST, baseOffset: 20 })],
    era: "recent", built: 18, condition: "sound",
    quality: "common", social: "labourer", kit: "kw.block.worker-gallery", tags: ["external-galleries", "laundry", "water-tank", "vents"],
    story: "Six storeys of ferroconcrete flats along Charter Street: laundry on every gallery, a water tank on the roof, a shift bell over the stair.",
  }),
  dwelling({
    id: "kw-old-tenement", name: "Old Tenement", fn: "tenement", tradition: FERRO, x0: 20, x1: 31, row: "street", storeys: 5, eave: 16, ridge: 16.8, roof: "flat-parapet", roofMat: FELT, wallMat: BRICK,
    era: "ancestral", built: 120, condition: "damaged",
    repairs: [{ kind: "buttress", note: "Steel props against the leaning street face.", mass: "main" }, { kind: "tarpaulin", note: "Tarpaulins over two broken upper windows.", mass: "main" }],
    quality: "poor", social: "labourer", kit: "kw.block.old-tenement", tags: ["steel-props", "laundry", "broken-windows"],
    story: "The oldest tenement in the enclave, older than the podium; its street face leans and is propped with steel.",
  }),
  dwelling({
    id: "kw-container-stack", name: "Container Stacks", fn: "house", tradition: SHEETWORK, x0: -33, x1: -21, row: "quay", storeys: 2, eave: 5.2, ridge: 5.2, roof: "flat", roofMat: RUST, wallMat: RUST,
    extra: [mass({ id: "upper", role: "shed", at: [-29, 36.75], w: 6, d: 8.5, storeys: 1, eave: 2.6, ridge: 2.6, roof: "flat", roofMat: RUST, wallMat: RUST, baseOffset: 5.2 })],
    era: "recent", built: 9, condition: "worn", repairs: [{ kind: "welded-plate", note: "Doors and windows cut and welded into old cargo containers.", mass: "main" }],
    quality: "poor", social: "labourer", kit: "kw.house.container-stack", tags: ["ladders", "laundry", "tarpaulin"],
    story: "Cargo containers stacked two and three high with doors cut into them: the cheapest housing in the holding, nearest the quay and the damp.",
  }),
  dwelling({
    id: "kw-quay-tenement", name: "Quay Tenement", fn: "tenement", tradition: FERRO, x0: -19, x1: -7, row: "quay", storeys: 5, eave: 15.5, ridge: 16.2, roof: "flat-parapet", roofMat: FELT, wallMat: CONCRETE,
    era: "predecessor", built: 60, condition: "weathered", repairs: [{ kind: "fresh-render", note: "Quay face re-rendered in patches of different grey.", mass: "main" }],
    quality: "common", social: "commoner", kit: "kw.block.quay-tenement", tags: ["balconies", "laundry", "vents"],
    story: "Five storeys over the quay road for the families who work the cranes and the fabrication shed.",
  }),
  dwelling({
    id: "kw-prefab-block", name: "Founding Prefab", fn: "worker-block", tradition: FERRO, x0: -1.6, x1: 8, row: "quay", storeys: 4, eave: 12.4, ridge: 13, roof: "flat", roofMat: FELT, wallMat: STEEL,
    era: "founding", built: 2, condition: "new",
    quality: "common", social: "labourer", kit: "kw.block.prefab", tags: ["clean-panels", "external-stair"],
    story: "A prefab block bolted together at the founding for the families who came with the banner; its panels are still clean.",
  }),
  dwelling({
    id: "kw-narrow-house", name: "Narrow House", fn: "house", tradition: HERITAGE, x0: 10, x1: 15.4, row: "quay", storeys: 3, eave: 9, ridge: 11.6, roof: "curved-ridge", axis: "z", roofMat: TILE, wallMat: BRICK,
    era: "predecessor", built: 95, condition: "worn",
    quality: "common", social: "artisan", kit: "kw.house.narrow", tags: ["tiled-roof", "lanterns", "workshop"],
    story: "A lantern-maker's narrow house with a tiled roof, squeezed between the blocks.",
  }),
  dwelling({
    id: "kw-burnt-store", name: "Burnt Store and Roof Shacks", fn: "worker-block", tradition: SHEETWORK, x0: 20, x1: 31, row: "quay", storeys: 2, eave: 6.4, ridge: 6.4, roof: "flat", roofMat: FELT, wallMat: BRICK,
    extra: [
      mass({ id: "shack-west", role: "shed", at: [23, 36], w: 4, d: 4, storeys: 1, eave: 2.4, ridge: 3.2, roof: "lean-to", axis: "x", roofMat: SHEET, wallMat: SHEET, baseOffset: 6.4 }),
      mass({ id: "shack-east", role: "shed", at: [28.4, 37.6], w: 3.6, d: 3.6, storeys: 1, eave: 2.2, ridge: 2.8, roof: "lean-to", axis: "x", roofMat: SHEET, wallMat: SHEET, baseOffset: 6.4 }),
    ],
    era: "predecessor", built: 70, condition: "damaged",
    repairs: [{ kind: "welded-plate", note: "Fire-blackened walls patched with sheet steel.", mass: "main" }, { kind: "tarpaulin", note: "Tarpaulin roofs over the shacks.", mass: "shack-west" }],
    quality: "poor", social: "labourer", kit: "kw.block.burnt-store", tags: ["scorch-marks", "ladder", "shacks", "laundry"],
    story: "A store gutted in the earlier conflict; families have built shacks of sheet and timber on its roof, reached by a ladder from the quay.",
  }),
];

const buildings: Building[] = deck.concat(yard, works, blocks);
const byId = (id: string): Building => {
  for (const b of buildings) if (b.id === id) return b;
  throw new Error(`kwind-09: unknown building ${id}`);
};
const floorOf = (id: string): number => resolveBuildingBase(T, byId(id)).floorY;

// --- Fortifications -----------------------------------------------------------------

const walls: BannerholdBlueprint["walls"] = [
  {
    id: "kw-barrier",
    name: "Charter Barrier",
    kind: "barrier",
    points: [[-56, 48.6], [-56, -46], [56, -46], [56, 0], [56, 48.6]],
    closed: false,
    height: 5,
    thickness: 0.8,
    walkway: true,
    material: CONCRETE,
    tradition: FERRO,
    segments: [
      { from: 0, to: 1, condition: "worn", note: "West barrier along the arterial; the checkpoint stretch is the best kept." },
      { from: 1, to: 2, condition: "weathered", note: "North barrier under the expressway: rust streaks from the viaduct drains, spalled concrete, cables pinned along the top." },
      { from: 2, to: 3, condition: "damaged", note: "The old breach in the east barrier, closed with welded sheet steel and never recast." },
      { from: 3, to: 4, condition: "sound", note: "South-east barrier recast at the founding." },
    ],
    allowOverlapWith: ["kw-checkpoint"],
  },
  {
    id: "kw-deck-parapet-west",
    name: "Deck Rail (west)",
    kind: "low-wall",
    points: [[-41.6, -6.3], [-13.7, -6.3]],
    closed: false,
    height: 1.1,
    thickness: 0.4,
    walkway: false,
    material: STEEL,
    tradition: FERRO,
    segments: [{ from: 0, to: 1, condition: "sound", note: "Steel balustrade over the muster yard." }],
  },
  {
    id: "kw-deck-parapet-east",
    name: "Deck Rail (east)",
    kind: "low-wall",
    points: [[-10.3, -6.3], [31.6, -6.3]],
    closed: false,
    height: 1.1,
    thickness: 0.4,
    walkway: false,
    material: STEEL,
    tradition: FERRO,
    segments: [{ from: 0, to: 1, condition: "worn", note: "Two balustrade panels replaced in mismatched steel." }],
  },
  {
    id: "kw-quay-edge",
    name: "Quay Rail",
    kind: "low-wall",
    points: [[-56, 48.6], [56, 48.6]],
    closed: false,
    height: 1,
    thickness: 0.3,
    walkway: false,
    material: RUST,
    tradition: SHEETWORK,
    segments: [{ from: 0, to: 1, condition: "weathered", note: "Rusted rail along the quay edge, bent where lighters have bumped it." }],
    allowOverlapWith: ["kw-barrier"],
  },
];

const towers: BannerholdBlueprint["towers"] = [
  {
    id: "kw-watchtower-repaired",
    name: "North-East Watch Tower",
    kind: "watchtower",
    center: [56, -46],
    shape: "square",
    width: 4,
    height: 18,
    roof: "flat",
    material: STEEL,
    wallId: "kw-barrier",
    condition: "sound",
    repairs: [
      { kind: "welded-plate", note: "Lower legs re-plated in unpainted steel after the earlier conflict; the seam is a clean line at half height." },
      { kind: "iron-strapping", note: "Cross-bracing bolted in where the old struts buckled." },
      { kind: "boarded-opening", note: "Two cab panes on the city side boarded." },
    ],
    storyRole: "repaired-watchtower",
    story: "The watch tower that held when the previous charter holder lost the enclave: its new steel is the first scar a traveller reads from the expressway.",
    allowOverlapWith: ["kw-barrier"],
  },
  { id: "kw-signal-tower", name: "North-West Signal Tower", kind: "signal-tower", center: [-56, -46], shape: "square", width: 3.6, height: 14, roof: "pyramid", material: STEEL, wallId: "kw-barrier", condition: "worn", repairs: [], story: "Signal tower at the north-west corner; its lamp answers the checkpoint and the signal office mast.", allowOverlapWith: ["kw-barrier"] },
  { id: "kw-harbour-light", name: "Harbour Light", kind: "beacon", center: [56, 48], shape: "round", width: 3, height: 11, roof: "conical", material: CONCRETE, wallId: "kw-barrier", condition: "weathered", repairs: [], story: "The quay's harbour light, its lamp long cold; boats steer by the expressway's lights now.", allowOverlapWith: ["kw-barrier", "kw-quay-edge"] },
];

const gates: BannerholdBlueprint["gates"] = [
  { id: "kw-gate-checkpoint", name: "Checkpoint", kind: "main-gate", position: [-56, 16], outwardBearingDeg: 270, width: 6, height: 5, wallId: "kw-barrier", routeId: "kw-arterial" },
  { id: "kw-gate-deck", name: "Deck Gate", kind: "inner-gate", position: [-12, -6.6], outwardBearingDeg: 180, width: 3.4, height: 3.2, wallId: "kw-deck-parapet-west", routeId: "kw-deck-stair" },
  { id: "kw-gate-landing", name: "Landing Gate", kind: "water-gate", position: [6, 48.6], outwardBearingDeg: 180, width: 2.4, height: 2.4, wallId: "kw-quay-edge", routeId: "kw-landing-stair" },
];

// --- Landmarks, muster, ceremony and state slots ---------------------------------

const HALL_FLOOR = floorOf("kw-charter-hall");
const RECORD_FLOOR = floorOf("kw-ledger-vault");
const HERALD_FLOOR = floorOf("kw-signal-office");
const DOCK_TOP = round2(floorOf("kw-muster-dock") + 1.2);
const GATE_FLOOR = floorOf("kw-checkpoint");

const landmarks: BannerholdBlueprint["landmarks"] = [
  { id: "banner-hall", label: "Banner Hall", buildingIds: ["kw-charter-hall", "kw-lodging", "kw-annex-tower"], anchor: [-6, round2(HALL_FLOOR + 23), -24], pickCenter: [-6, round2(HALL_FLOOR + 8), -27], pickRadius: 13, cameraId: "landmark:banner-hall" },
  { id: "muster-grounds", label: "Muster Grounds", buildingIds: ["kw-muster-dock", "kw-armoury", "kw-levy-dorm"], anchor: [-3, round2(DOCK_TOP + 4), -3.5], pickCenter: [-6, round2(QUAY + 1.6), 3], pickRadius: 11, cameraId: "landmark:muster-grounds" },
  { id: "war-record", label: "War Record", buildingIds: ["kw-ledger-vault"], anchor: [20, round2(RECORD_FLOOR + 16), -26], pickCenter: [20, round2(RECORD_FLOOR + 6), -26], pickRadius: 8, cameraId: "landmark:war-record" },
  { id: "heralds-station", label: "Herald's Station", buildingIds: ["kw-signal-office", "kw-checkpoint"], anchor: [-46, round2(HERALD_FLOOR + 14), 2], pickCenter: [-49, round2(HERALD_FLOOR + 6), 8], pickRadius: 8, cameraId: "landmark:heralds-station" },
];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const fileRow = poseRow(T, [-10, 0.6], [4, 0.6], 8, 180);

const muster: BannerholdBlueprint["muster"] = {
  pawnStand: G.facing(-3, 3.2, 180),
  fileMarkers: FILES.map((file, i) => ({ file, pose: fileRow[i] })),
  levySlots: [G.facing(-7, 5.4, 180), G.facing(-5, 5.4, 180), G.facing(-1, 5.4, 180), G.facing(1, 5.4, 180), G.facing(-6, 7, 180), G.facing(0, 7, 180)],
  drillSquare: { kind: "rect", center: [-17, 8], width: 14, depth: 6 },
  platformBuildingId: "kw-muster-dock",
};

const ceremonial: BannerholdBlueprint["ceremonial"] = {
  id: "kw-honour-terrace",
  name: "The Honour Terrace",
  shape: { kind: "rect", center: [-6, -12.4], width: 12, depth: 5.6 },
  centrepiece: [-6, -12.4],
  description:
    "A raised granite terrace before the charter hall's portico, its edge overlooking the muster yard 8 m below. Eight lamp plinths along its sides wait for honours and a bronze ledger plate at its centre stays blank: recognition lights them, never the scene.",
};

/** Eight lamp plinths: four on the terrace's west edge facing east, four on its east edge facing west. */
const plinth = (i: number) => {
  const west = i < 4;
  const x = west ? -11.4 : -0.6;
  const z = round2(-14.6 + (i % 4) * 1.45);
  return { position: [x, round2(DECK + 0.3 + 1.0), z] as Vec3, yawDeg: west ? 90 : -90 };
};

const tableTop = round2(RECORD_FLOOR + 0.95);
const recordMarkers = Array.from({ length: 12 }, (_, i) => ({ position: [round2(17.6 + (i % 4) * 0.6), tableTop, round2(-27.6 + Math.floor(i / 4) * 0.62)] as Vec3, yawDeg: 0 }));

const slots: BannerholdBlueprint["slots"] = {
  injuredRest: G.facing(-25.2, 10.4, 90, 0.3),
  captiveMarker: G.facing(-1.8, 3, 180),
  honourNiches: Array.from({ length: 8 }, (_, i) => plinth(i)),
  recordMarkers,
  noticeBoard: Array.from({ length: 6 }, (_, i) => ({ position: [round2(-48.2 + (i % 3) * 2.2), round2(HERALD_FLOOR + 3.4 + Math.floor(i / 3) * 0.7), 7.3] as Vec3, yawDeg: 0 })),
  heraldArrival: G.facing(-46, 10, 0),
  rivalCorrespondence: { position: [-43.2, round2(HERALD_FLOOR + 1.5), 6.3], yawDeg: 0 },
  alliedEnvoy: { position: [-44.2, round2(HERALD_FLOOR + 10.5 + 16), 0.2], yawDeg: 0 },
  bannerMounts: [
    { id: "kw-terrace-standard", kind: "standard", heraldry: "player", pose: G.facing(-6, -10.2, 180), height: 9, minHallTier: 0 },
    { id: "kw-hall-sign", kind: "emblem", heraldry: "player", pose: { position: [-6, round2(HALL_FLOOR + 7.2), -17.1], yawDeg: 0 }, height: 1.8, minHallTier: 0 },
    { id: "kw-checkpoint-shield", kind: "shield", heraldry: "player", pose: { position: [-60.1, round2(GATE_FLOOR + 6), 16], yawDeg: -90 }, height: 1.6, minHallTier: 0 },
    { id: "kw-dock-standard-w", kind: "standard", heraldry: "player", pose: { position: [-9.4, DOCK_TOP, -4.6], yawDeg: 0 }, height: 6, minHallTier: 0 },
    { id: "kw-dock-standard-e", kind: "standard", heraldry: "player", pose: { position: [3.4, DOCK_TOP, -4.6], yawDeg: 0 }, height: 6, minHallTier: 0 },
    { id: "kw-zaibatsu-signal", kind: "signal-flag", heraldry: "crown", pose: { position: [-48.6, round2(HERALD_FLOOR + 10.5), -1.2], yawDeg: 0 }, height: 3, minHallTier: 0 },
    { id: "kw-deck-shields", kind: "shield", heraldry: "player", pose: { position: [10, round2(DECK + 1.1), -6.3], yawDeg: 0 }, height: 1.1, minHallTier: 1 },
    { id: "kw-hall-hangings", kind: "tapestry", heraldry: "player", pose: { position: [-6, round2(HALL_FLOOR + 3), -19.9], yawDeg: 0 }, height: 4, minHallTier: 2 },
    { id: "kw-tower-pennant", kind: "pennant", heraldry: "player", pose: { position: [8, round2(HALL_FLOOR + 33), -31], yawDeg: 0 }, height: 3, minHallTier: 3 },
  ],
  hallTiers: [
    { tier: 1, buildings: ["kw-annex-tower"], expansionZones: [], dressing: ["kw-deck-shields", "terrace-plinth-lamps"] },
    { tier: 2, buildings: ["kw-record-gallery"], expansionZones: ["kw-exp-record-gallery"], dressing: ["kw-hall-hangings", "gallery-honours"] },
    { tier: 3, buildings: [], expansionZones: ["kw-exp-skybridge", "kw-exp-west-block"], dressing: ["kw-tower-pennant", "gilded-sign"] },
  ],
  foundingStandard: G.facing(-6, -10.2, 180),
};

// --- Storytelling, vegetation and dressing ------------------------------------------

const story: BannerholdBlueprint["story"] = [
  { id: "kw-story-watchtower", kind: "repaired-watchtower", position: [56, -46], refs: ["kw-watchtower-repaired"], description: "Unpainted steel plate on the watch tower's lower legs, a clean seam at half height: repaired after the earlier conflict, never hidden." },
  { id: "kw-story-north-barrier", kind: "weathered-fortification", position: [0, -46], refs: ["kw-barrier"], description: "The north barrier under the expressway: rust streaks from the viaduct drains, spalled concrete, cables pinned along the top." },
  { id: "kw-story-breach", kind: "weathered-fortification", position: [56, -23], refs: ["kw-barrier"], description: "The old breach in the east barrier, closed with welded sheet steel and never recast." },
  { id: "kw-story-muster", kind: "levy-yard-vs-noble-architecture", position: [-6, 4], refs: ["kw-muster-dock", "kw-levy-dorm", "kw-allied-exchange"], description: "A painted loading yard beneath an 8 m podium wall; above the expressway, the allied Great House's exchange spire among the towers of the capital." },
  { id: "kw-story-arterial", kind: "merchant-road", position: [-75, 0], refs: ["kw-arterial", "kw-gate-checkpoint", "kw-expressway"], description: "Freight, couriers and the Zaibatsu's riders: the arterial and the expressway's off-ramp meet at the checkpoint's barrier arms." },
  { id: "kw-story-annex", kind: "unfinished-structure", position: [29, -40], refs: ["kw-annex-tower", "kw-tower-crane"], description: "A three-storey steel frame beside an idle tower crane on the deck." },
  { id: "kw-story-terrace", kind: "ceremonial-place", position: [-6, -12.4], refs: ["kw-honour-terrace"], description: "Eight dark lamp plinths and a blank bronze plate waiting for recognised honours." },
  { id: "kw-story-pawn", kind: "empty-character-position", position: [-3, 3.2], refs: ["kw-muster-dock"], description: "The nominated representative's painted mark before the dock, occupied or empty according to real state." },
  { id: "kw-story-burnt-store", kind: "older-house-ruin", position: [25.5, 36.75], refs: ["kw-burnt-store"], description: "A store gutted in the earlier conflict, families' shacks on its roof." },
  { id: "kw-story-class", kind: "class-contrast", position: [-20, 26], refs: ["kw-supervisor-house", "kw-container-stack", "kw-lodging"], description: "A tiled heritage house for the reeve, welded containers by the damp quay, and the household block on the deck above both." },
  { id: "kw-story-charter-hall", kind: "ancestral-memory", position: [-6, -27], refs: ["kw-charter-hall"], description: "The foundry company's charter hall, older than the deck it stands on, kept by every charter holder since." },
  { id: "kw-story-harbour", kind: "water-memory", position: [6, 52], refs: ["kw-landing-stair", "kw-quay-crane"], description: "The old foundry harbour: still, oily water, a single landing pontoon and a crane that has outlived its foundry." },
  { id: "kw-story-boundary", kind: "boundary-dispute", position: [60, -30], refs: ["kw-charter-marker-a", "kw-charter-marker-b"], description: "Two charter boundary markers a metre apart by the neighbouring combine's yard, where the line is disputed." },
];

const vegetation: BannerholdBlueprint["vegetation"] = [
  { id: "kw-deck-planters", kind: "planter", shape: { kind: "rect", center: [-6, -8.4], width: 22, depth: 1.4 }, density: 20, species: "clipped box in steel troughs", seed: 51 },
  { id: "kw-honour-ginkgo", kind: "lone-tree", shape: { kind: "rect", center: [-13.2, -14.2], width: 2, depth: 2 }, density: 1, species: "old ginkgo in a cast-iron planter", seed: 52 },
  { id: "kw-court-pots", kind: "planter", shape: { kind: "rect", center: [6, 32.2], width: 22, depth: 0.6 }, density: 30, species: "pots of herbs and chillies", seed: 53 },
  { id: "kw-waste-weeds", kind: "scrub", shape: { kind: "polygon", points: [[-150, -36], [-92, -40], [-94, 20], [-150, 24]] }, density: 1.2, species: "buddleia and dock on slag", seed: 54 },
  { id: "kw-allotment-hedge", kind: "hedgerow", shape: { kind: "polygon", points: [[-98, 25], [-148, 21], [-148, 22.4], [-98, 26.4]] }, density: 40, species: "privet and wire", seed: 55 },
  { id: "kw-far-quay-weeds", kind: "scrub", shape: { kind: "polygon", points: [[-200, 150], [200, 150], [200, 200], [-200, 200]] }, density: 0.4, species: "weeds through broken concrete", seed: 56 },
  { id: "kw-quay-moss", kind: "moss-bank", shape: { kind: "rect", center: [0, 48.9], width: 112, depth: 0.4 }, density: 10, species: "moss and weed along the quay wall", seed: 57 },
];

const dressing: BannerholdBlueprint["dressing"] = [
  { id: "kw-pipe-rack", kind: "pipe-rack", position: [17, -4.6], yawDeg: 90, district: "D", note: "Steam pipes on brackets along the podium face behind the fabrication shed." },
  { id: "kw-shop-vent", kind: "vent-stack", position: [7, 10.8], yawDeg: 0, district: "D" },
  { id: "kw-cable-run", kind: "cable-run", position: [44, 13.4], yawDeg: 90, district: "D", note: "Cable bundles from the substation slung across Charter Street." },
  { id: "kw-ledger-signage", kind: "signage", position: [-46, 7.4], yawDeg: 0, district: "E", note: "The public ledger board: mechanical flaps listing notices, rations and summons." },
  { id: "kw-blade-sign-block", kind: "signage", position: [3, 19.2], yawDeg: 0, district: "C", note: "Vertical blade sign on the block's stair: sodium amber, not neon clutter." },
  { id: "kw-blade-sign-row", kind: "signage", position: [-11.3, 19.2], yawDeg: 0, district: "C", note: "The lantern-mender's blade sign." },
  { id: "kw-food-stall", kind: "market-stall", position: [-20, 12.2], yawDeg: 180, district: "B", note: "A noodle stall under an awning at the yard corner, busiest at the shift change." },
  { id: "kw-lamp-1", kind: "lamp-post", position: [-14, 12.4], yawDeg: 0, district: "B" },
  { id: "kw-lamp-2", kind: "lamp-post", position: [6, 12.4], yawDeg: 0, district: "D" },
  { id: "kw-lamp-3", kind: "lamp-post", position: [26, 19.2], yawDeg: 0, district: "C" },
  { id: "kw-lamp-4", kind: "lamp-post", position: [-40, 19.2], yawDeg: 0, district: "E" },
  { id: "kw-court-laundry-w", kind: "laundry-line", position: [-20, 31], yawDeg: 0, district: "C", note: "Laundry strung across the west back court between the rows." },
  { id: "kw-court-laundry-e", kind: "laundry-line", position: [6, 31], yawDeg: 0, district: "C" },
  { id: "kw-court-laundry-far", kind: "laundry-line", position: [24, 31], yawDeg: 0, district: "C" },
  { id: "kw-court-brazier", kind: "cooking-fire", position: [-14, 31.4], yawDeg: 0, district: "C", note: "A brazier and a stew pot shared by the back court." },
  { id: "kw-lamp-shrine", kind: "brazier", position: [-2.9, 32.1], yawDeg: 0, district: "C", note: "A lamp shrine of ribbons and tin lanterns at the lane corner." },
  { id: "kw-standpipe", kind: "well", position: [-24, 31.6], yawDeg: 0, district: "C", note: "Water standpipe with a ration gauge; there is always a queue." },
  { id: "kw-quay-crane", kind: "crane", position: [30, 47.2], yawDeg: 180, district: "G", note: "Quay crane on rails, its jib over the water." },
  { id: "kw-tower-crane", kind: "crane", position: [36.8, -40.2], yawDeg: 270, district: "A", note: "Idle tower crane beside the annex frame." },
  { id: "kw-annex-steel", kind: "scaffold-stack", position: [36.6, -36], yawDeg: 0, district: "A", note: "Steel sections waiting for the annex." },
  { id: "kw-depot-pallets", kind: "pallets", position: [38.2, -14], yawDeg: 0, district: "D" },
  { id: "kw-shop-barrels", kind: "barrels", position: [8, 10.6], yawDeg: 0, district: "D" },
  { id: "kw-dock-crates", kind: "crates", position: [-12.6, -1], yawDeg: 0, district: "B" },
  { id: "kw-weapon-rack", kind: "weapon-rack", position: [-26.4, 3.2], yawDeg: 90, district: "B" },
  { id: "kw-pells", kind: "practice-pell", position: [-11, 9.4], yawDeg: 0, district: "B" },
  { id: "kw-power-hammer", kind: "anvil", position: [18.4, 10.4], yawDeg: 0, district: "D", note: "Power hammer and anvil block under the welding canopy." },
  { id: "kw-quench-tank", kind: "quench-trough", position: [23.2, 10.6], yawDeg: 0, district: "D" },
  { id: "kw-charter-marker-a", kind: "boundary-stone", position: [60, -30], yawDeg: 0, district: "G" },
  { id: "kw-charter-marker-b", kind: "boundary-stone", position: [60.8, -31.2], yawDeg: 12, district: "G", note: "The marker the neighbouring combine says belongs a metre west." },
  { id: "kw-checkpoint-queue", kind: "cart", position: [-66, 18], yawDeg: 90, district: "G", note: "A freight cart waiting at the barrier arms." },
  { id: "kw-supervisor-planter", kind: "planter", position: [-29, 19], yawDeg: 0, district: "C" },
  { id: "kw-terrace-bench", kind: "bench", position: [-3, -9.2], yawDeg: 180, district: "A" },
];

const activitySites: BannerholdBlueprint["activitySites"] = [
  { id: "kw-site-forge", kind: "forge", position: G.ground(21.8, 10.2), district: "D" },
  { id: "kw-site-anvil", kind: "anvil", position: G.ground(18.4, 10.4), district: "D" },
  { id: "kw-site-quench", kind: "quench", position: G.ground(23.2, 10.6), district: "D" },
  { id: "kw-site-standpipe", kind: "well", position: G.ground(-24, 31), district: "C" },
  { id: "kw-site-drill", kind: "drill-square", position: G.ground(-17, 8), district: "B" },
  { id: "kw-site-ledger-board", kind: "notice-board", position: G.ground(-46, 7.6), district: "E" },
  { id: "kw-site-courier-bay", kind: "stable", position: G.ground(-46, 21.4), district: "E" },
  { id: "kw-site-lookout", kind: "lookout", position: [56, round2(T.height(56, -46) + 16), -46], district: "D" },
  { id: "kw-site-ledger-table", kind: "war-table", position: [19, tableTop, -26.4], district: "F" },
  { id: "kw-site-quay-crane", kind: "loading-bay", position: G.ground(30, 46.6), district: "D" },
  { id: "kw-site-laundry", kind: "laundry", position: G.ground(6, 31), district: "C" },
  { id: "kw-site-food-stall", kind: "market-stall", position: G.ground(-20, 12.8), district: "B" },
  { id: "kw-site-lift", kind: "loading-bay", position: G.ground(28, -1), district: "D" },
];

// --- Life: deterministic schedules ------------------------------------------------

const near = { fullRateWithin: 60, reducedRateWithin: 160, hiddenBeyond: 420 };
const far = { fullRateWithin: 0, reducedRateWithin: 600, hiddenBeyond: 1600 };

const npcs: NpcAgent[] = [
  {
    id: "kw-sentry-north", role: "sentry", label: "Sentry on the north barrier under the expressway", district: "A", count: 1,
    route: [[-54, -46], [54, -46]], heightMode: "wall-walk", wallId: "kw-barrier",
    steps: [{ kind: "walk", to: 1 }, { kind: "hold", seconds: 8, activity: "watch", faceBearingDeg: 0 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 8, activity: "watch", faceBearingDeg: 0 }],
    phaseSeconds: 0, speed: 0.9, lod: near, activitySiteIds: ["kw-site-lookout"],
  },
  {
    id: "kw-sentry-west", role: "sentry", label: "Sentry on the west barrier over the arterial", district: "E", count: 1,
    route: [[-56, 44], [-56, -44]], heightMode: "wall-walk", wallId: "kw-barrier",
    steps: [{ kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "watch", faceBearingDeg: 270 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 6, activity: "watch", faceBearingDeg: 270 }],
    phaseSeconds: 21, speed: 0.9, lod: near, activitySiteIds: [],
  },
  {
    id: "kw-checkpoint-guards", role: "guard", label: "Guards at the checkpoint's barrier arms", district: "E", count: 2, formation: [[0, 0], [6, 0]],
    route: [[-50.6, 13], [-50.6, 11.8]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 20, activity: "watch", faceBearingDeg: 270 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "inspect", faceBearingDeg: 270 }, { kind: "walk", to: 0 }],
    phaseSeconds: 5, speed: 0.6, lod: near, activitySiteIds: [],
  },
  {
    id: "kw-fabricator", role: "smith", label: "Fabricator at the welding bay and power hammer", district: "D", count: 1,
    route: [[21.8, 10.2], [18.4, 10.4], [23.2, 10.6]], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 5, activity: "bellows", faceBearingDeg: 0 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 9, activity: "forge-strike", faceBearingDeg: 0 },
      { kind: "walk", to: 2 }, { kind: "hold", seconds: 3, activity: "quench", faceBearingDeg: 0 }, { kind: "walk", to: 0 },
    ],
    phaseSeconds: 0, speed: 0.8, lod: near, activitySiteIds: ["kw-site-forge", "kw-site-anvil", "kw-site-quench"],
  },
  {
    id: "kw-courier", role: "messenger", label: "Zaibatsu courier coming down the arterial to the signal office", district: "E", count: 1,
    route: [[-86, -160], [-82, -80], [-78, -20], [-72, 16], [-56, 16], [-46, 16], [-46, 10]], heightMode: "terrain",
    steps: [
      { kind: "walk", to: 6, speed: 3.6 }, { kind: "hold", seconds: 10, activity: "post-notice", faceBearingDeg: 0 }, { kind: "hold", seconds: 8, activity: "tend-beast", faceBearingDeg: 90 },
      { kind: "walk", to: 0, speed: 3.6 }, { kind: "hold", seconds: 40, activity: "rest" },
    ],
    phaseSeconds: 20, speed: 3.6, lod: { fullRateWithin: 80, reducedRateWithin: 400, hiddenBeyond: 900 }, activitySiteIds: ["kw-site-ledger-board", "kw-site-courier-bay"],
  },
  {
    id: "kw-deck-guard", role: "guard", label: "Guard at the deck gate", district: "A", count: 1,
    route: [[-13.6, -8.2], [-13.6, -9.4]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 24, activity: "watch", faceBearingDeg: 180 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 8, activity: "inspect", faceBearingDeg: 90 }, { kind: "walk", to: 0 }],
    phaseSeconds: 12, speed: 0.6, lod: near, activitySiteIds: [],
  },
  {
    id: "kw-drill", role: "drill", label: "Levy drilling in the muster yard", district: "B", count: 4, formation: [[0, 0], [1.6, 0], [0, 1.6], [1.6, 1.6]],
    route: [[-22, 6.4], [-12.6, 6.4], [-12.6, 9.6], [-22, 9.6], [-22, 6.4]], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 12, activity: "drill", faceBearingDeg: 0 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 8, activity: "drill", faceBearingDeg: 0 },
      { kind: "walk", to: 2 }, { kind: "walk", to: 3 }, { kind: "hold", seconds: 6, activity: "salute", faceBearingDeg: 0 }, { kind: "walk", to: 4 },
    ],
    phaseSeconds: 0, speed: 1.1, lod: near, activitySiteIds: ["kw-site-drill"],
  },
  {
    id: "kw-herald", role: "herald", label: "Signal clerk at the ledger board", district: "E", count: 1,
    route: [[-47.4, 7.6], [-44.6, 7.6], [-44, 11.8]], heightMode: "terrain",
    steps: [
      { kind: "hold", seconds: 9, activity: "read-notice", faceBearingDeg: 0 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 6, activity: "write", faceBearingDeg: 0 },
      { kind: "walk", to: 2 }, { kind: "hold", seconds: 7, activity: "watch", faceBearingDeg: 270 }, { kind: "walk", to: 0 },
    ],
    phaseSeconds: 11, speed: 0.9, lod: near, activitySiteIds: ["kw-site-ledger-board"],
  },
  {
    id: "kw-clerk", role: "scribe", label: "Ledger clerk crossing from the vault to the charter hall", district: "F", count: 1,
    route: [[20, -18.6], [20, -13.5], [10, -13.5], [-6, -13.5], [-6, -16.8]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 4 }, { kind: "hold", seconds: 8, activity: "inspect", faceBearingDeg: 0 }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 22, activity: "write", faceBearingDeg: 0 }],
    phaseSeconds: 14, speed: 0.9, lod: near, activitySiteIds: ["kw-site-ledger-table"],
  },
  {
    id: "kw-shift-workers", role: "worker", label: "Shift crossing from the blocks to the fabrication shed", district: "C", count: 5, formation: [[0, 0], [1.4, 0.6], [-1.2, 0.9], [0.4, 1.8], [1.8, 2.2]],
    route: [[-4.5, 41], [-4.5, 16], [16, 13.8], [16.5, 10.4]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 3 }, { kind: "hold", seconds: 40, activity: "inspect" }, { kind: "walk", to: 0 }, { kind: "hold", seconds: 60, activity: "rest" }],
    phaseSeconds: 0, speed: 1.1, lod: near, activitySiteIds: [],
  },
  {
    id: "kw-laundress", role: "resident", label: "Laundress in the back court", district: "C", count: 1,
    route: [[6, 31], [-4.5, 31], [-4.5, 40.6]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 20, activity: "hang-laundry", faceBearingDeg: 0 }, { kind: "walk", to: 2 }, { kind: "hold", seconds: 12, activity: "chat", faceBearingDeg: 180 }, { kind: "walk", to: 0 }],
    phaseSeconds: 41, speed: 0.8, lod: near, activitySiteIds: ["kw-site-laundry"],
  },
  {
    id: "kw-stall-keeper", role: "resident", label: "Stall keeper at the shift-change noodle stall", district: "B", count: 1,
    route: [[-20, 12.8], [-18, 12.9]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 30, activity: "trade", faceBearingDeg: 180 }, { kind: "walk", to: 1 }, { kind: "hold", seconds: 12, activity: "cook", faceBearingDeg: 180 }, { kind: "walk", to: 0 }],
    phaseSeconds: 3, speed: 0.6, lod: near, activitySiteIds: ["kw-site-food-stall"],
  },
  {
    id: "kw-water-queue", role: "resident", label: "Resident carrying water from the standpipe", district: "C", count: 1,
    route: [[-24, 31], [-4.5, 31], [-4.5, 41.8], [3.2, 41.8]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 8, activity: "draw-water", faceBearingDeg: 0 }, { kind: "walk", to: 3 }, { kind: "hold", seconds: 6, activity: "carry", faceBearingDeg: 0 }, { kind: "walk", to: 0 }],
    phaseSeconds: 17, speed: 0.8, lod: near, activitySiteIds: ["kw-site-standpipe"],
  },
  {
    id: "kw-children", role: "child", label: "Children running in the west back court", district: "C", count: 2, formation: [[0, 0], [1.2, 0.8]],
    route: [[-32, 31], [-8, 31]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 1, speed: 2.0 }, { kind: "hold", seconds: 5, activity: "chat" }, { kind: "walk", to: 0, speed: 2.0 }, { kind: "hold", seconds: 8, activity: "chat" }],
    phaseSeconds: 8, speed: 2.0, lod: near, activitySiteIds: [],
  },
  {
    id: "kw-crane-hand", role: "worker", label: "Crane hand between the quay crane and the warehouse", district: "D", count: 1,
    route: [[30, 46.6], [40, 44], [50.8, 44], [50.8, 30.25]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 20, activity: "load", faceBearingDeg: 180 }, { kind: "walk", to: 3 }, { kind: "hold", seconds: 6, activity: "carry", faceBearingDeg: 270 }, { kind: "walk", to: 0 }],
    phaseSeconds: 27, speed: 0.85, lod: near, activitySiteIds: ["kw-site-quay-crane"],
  },
  {
    id: "kw-dock-carter", role: "carter", label: "Hand-cart carter between the warehouse and the courier bay", district: "D", count: 1,
    route: [[50.6, 30.25], [52, 30], [52, 16], [-40, 16], [-46, 16], [-46, 20.8]], heightMode: "terrain",
    steps: [{ kind: "hold", seconds: 15, activity: "load", faceBearingDeg: 270 }, { kind: "walk", to: 5 }, { kind: "hold", seconds: 12, activity: "tend-beast", faceBearingDeg: 0 }, { kind: "walk", to: 0 }],
    phaseSeconds: 31, speed: 0.9, lod: near, activitySiteIds: ["kw-site-courier-bay"],
  },
  {
    id: "kw-allotment-keepers", role: "farmer", label: "Allotment keepers on the reclaimed ground", district: "G", count: 2, formation: [[0, 0], [4, 2]],
    route: [[-104, 34], [-140, 32]], heightMode: "terrain",
    steps: [{ kind: "walk", to: 1, speed: 0.4 }, { kind: "hold", seconds: 24, activity: "carry" }, { kind: "walk", to: 0, speed: 0.4 }, { kind: "hold", seconds: 18, activity: "rest" }],
    phaseSeconds: 0, speed: 0.4, lod: far, activitySiteIds: [],
  },
];

// --- Outer Territory and the greater nation ---------------------------------------

const outer: BannerholdBlueprint["outer"] = {
  fields: [
    { id: "kw-allotments", crop: "allotment beds on reclaimed ground", polygon: [[-98, 26], [-148, 22], [-150, 46], [-100, 50]], furrowBearingDeg: 92, owner: "holding", condition: "tended" },
    { id: "kw-container-yard", crop: "container stacks of a neighbouring combine", polygon: [[64, -40], [150, -46], [154, 22], [66, 26]], furrowBearingDeg: 2, owner: "neighbour", condition: "tended" },
    { id: "kw-waste-lots", crop: "fenced waste lots", polygon: [[-150, -36], [-96, -40], [-98, -90], [-150, -92]], furrowBearingDeg: 0, owner: "crown", condition: "neglected" },
  ],
  outposts: [
    { id: "kw-relay-mast", name: "Relay mast on the far quay", kind: "relay-mast", position: [-30, 172], height: 46, owner: "crown", description: "The Zaibatsu's relay mast on the far quay, blinking red through the smog." },
    { id: "kw-pump-house", name: "Harbour pump house", kind: "pump-station", position: [120, 46], height: 9, owner: "other-banner", description: "The neighbouring combine's pump house that keeps the basin from silting." },
    { id: "kw-toll-gantry", name: "Expressway toll gantry", kind: "toll", position: [150, -138], height: 30, owner: "crown", description: "Toll gantry over the expressway, reading every vehicle that passes." },
    { id: "kw-survey-marker", name: "Charter survey marker", kind: "boundary-stone", position: [-62, -60], height: 1.2, owner: "holding", description: "Survey marker at the enclave's north-west corner." },
  ],
  places: [
    distantPlace({ id: "kw-allied-exchange", name: "Exchange tower of the allied Great House", kind: "allied-seat", bearingDeg: 20, distance: 3800, groundElevation: 6, silhouetteHeight: 260, radius: 120, stateSlot: "allied-house", description: "A trading exchange in the upper towers: the allied Great House's spire of glass and bronze above the expressway, lit cyan. The banner is filed there as a junior account." }),
    distantPlace({ id: "kw-frontier-korvenia", name: "Northern customs barrier", kind: "frontier", frontierNation: "korvenia", bearingDeg: 8, distance: 18000, groundElevation: 60, silhouetteHeight: 50, radius: 160, stateSlot: "rival-house", description: "Customs barrier and floodlit towers where the freight road leaves for Korvenia." }),
    distantPlace({ id: "kw-frontier-aethelgard", name: "North-eastern rail checkpoint", kind: "frontier", frontierNation: "aethelgard", bearingDeg: 46, distance: 22000, groundElevation: 40, silhouetteHeight: 44, radius: 150, stateSlot: "rival-house", description: "Rail checkpoint on the line toward Aethelgard, its signal lamps visible on clear nights." }),
    distantPlace({ id: "kw-frontier-solforiz", name: "Eastern pipeline gate", kind: "frontier", frontierNation: "solforiz", bearingDeg: 92, distance: 20000, groundElevation: 20, silhouetteHeight: 40, radius: 150, stateSlot: "rival-house", description: "Fortified pipeline gate on the eastern flats toward Solforiz." }),
    distantPlace({ id: "kw-neighbour-compound", name: "Compound of a neighbouring banner", kind: "neighbour-estate", bearingDeg: 150, distance: 900, groundElevation: 2.8, silhouetteHeight: 40, radius: 110, description: "Another banner's walled compound across the basin: newer towers, better lit." }),
    distantPlace({ id: "kw-foundry-docks", name: "The old foundry docks", kind: "port", bearingDeg: 210, distance: 1500, groundElevation: 2, silhouetteHeight: 70, radius: 400, description: "Gantry cranes and slipways along the far quays, half of them idle." }),
    distantPlace({ id: "kw-cooling-field", name: "Western cooling towers", kind: "industrial", bearingDeg: 280, distance: 2600, groundElevation: 2, silhouetteHeight: 160, radius: 600, description: "Cooling towers and smokestacks of the western foundries, steam lit orange from below." }),
    distantPlace({ id: "kw-arcology", name: "Arcology above the rail yards", kind: "arcology", bearingDeg: 70, distance: 7000, groundElevation: 10, silhouetteHeight: 380, radius: 500, description: "A stacked residential arcology on legs above the rail yards; its lower tiers stay in shadow all day." }),
    distantPlace({ id: "kw-lower-city", name: "Stacked worker districts", kind: "town", bearingDeg: 240, distance: 3000, groundElevation: 2, silhouetteHeight: 60, radius: 900, description: "Stacked worker housing of the lower city, laundry and steam between the blocks." }),
    distantPlace({ id: "kw-capital", name: "The capital", kind: "capital", bearingDeg: 34, distance: 14000, groundElevation: 20, silhouetteHeight: 640, radius: 4000, description: "A wall of corporate towers stacked over the old city, their crowns lost in smog and lit from below. Always called simply the capital." }),
  ],
  territories: [
    { id: "kw-terr-holding", name: "The charter enclave", owner: "holding", polygon: [[-60, -52], [60, -52], [60, 49], [-60, 49]] },
    { id: "kw-terr-allotments", name: "The holding's allotments", owner: "holding", polygon: [[-96, 20], [-152, 16], [-154, 52], [-96, 56]] },
    { id: "kw-terr-allied", name: "The upper towers (allied Great House)", owner: "allied-great-house", polygon: [[60, -52], [60, -200], [4000, -6000], [6000, -1000]] },
    { id: "kw-terr-crown", name: "Arterial and expressway corridor (crown)", owner: "crown", polygon: [[-60, -52], [60, -52], [60, -200], [-300, -400], [-300, 0], [-60, 0]] },
    { id: "kw-terr-neighbour", name: "Container yard of a neighbouring combine", owner: "other-banner", polygon: [[60, -52], [200, -52], [200, 49], [60, 49]] },
    { id: "kw-terr-harbour", name: "The harbour (crown)", owner: "crown", polygon: BASIN },
  ],
  skyline: [
    { id: "kw-sky-viaduct", kind: "viaduct", bearingFromDeg: 280, bearingToDeg: 80, distance: 70, height: 22, description: "The expressway on its piers north of the enclave, traffic lights moving along it." },
    { id: "kw-sky-capital", kind: "towers", bearingFromDeg: 22, bearingToDeg: 48, distance: 14000, height: 640, description: "The capital's wall of towers in the smog." },
    { id: "kw-sky-exchange", kind: "towers", bearingFromDeg: 18, bearingToDeg: 22, distance: 3800, height: 260, description: "The allied Great House's exchange spire, lit cyan." },
    { id: "kw-sky-cooling", kind: "smoke", bearingFromDeg: 270, bearingToDeg: 290, distance: 2600, height: 220, description: "Steam from the western cooling towers." },
    { id: "kw-sky-arcology", kind: "towers", bearingFromDeg: 66, bearingToDeg: 74, distance: 7000, height: 380, description: "The arcology's stacked tiers above the rail yards." },
    { id: "kw-sky-cranes", kind: "towers", bearingFromDeg: 195, bearingToDeg: 225, distance: 1500, height: 70, description: "Gantry cranes of the old foundry docks across the water." },
  ],
};

// --- View corridors and expansion ------------------------------------------------------

const ESTABLISHING_TARGET = [0, 12, -12] as const;
const establishingPos = cameraFrom(ESTABLISHING_TARGET, 200, 150, 40);

/** A point `length` metres along the sight line from `from` toward a distant place's silhouette top. */
function sightToward(from: readonly [number, number, number], placeId: string, length: number): readonly [number, number, number] {
  const place = outer.places.find((p) => p.id === placeId);
  if (!place) throw new Error(`kwind-09: unknown place ${placeId}`);
  const tx = place.position[0] - from[0];
  const ty = place.groundElevation + place.silhouetteHeight - from[1];
  const tz = place.position[1] - from[2];
  const k = length / Math.sqrt(tx * tx + ty * ty + tz * tz);
  return [round2(from[0] + tx * k), round2(from[1] + ty * k), round2(from[2] + tz * k)];
}

const TOWER_TOP = [8, round2(HALL_FLOOR + 31.6), -31] as const;

const viewCorridors: BannerholdBlueprint["viewCorridors"] = [
  { id: "kw-vc-stair", name: "Muster yard up the Deck Stair to the charter hall", from: [-22, round2(QUAY + 1.7), 12], to: [-6, round2(DECK + 6), -17.6], halfWidth: 1.5, halfWidthFar: 4, purpose: "From the levy's yard the eye climbs the Deck Stair, past the gate lodge, to the charter hall's portico and sign.", allow: ["kw-charter-hall"] },
  { id: "kw-vc-capital", name: "Harbour approach: the capital's towers beyond the expressway", from: establishingPos, to: sightToward(establishingPos, "kw-capital", 600), halfWidth: 3, halfWidthFar: 60, purpose: "From the harbour the capital's towers stand over the expressway and the deck; keep the line clear of tall additions.", allow: [] },
  { id: "kw-vc-allied", name: "Ledger tower to the allied exchange", from: TOWER_TOP, to: sightToward(TOWER_TOP, "kw-allied-exchange", 600), halfWidth: 2, halfWidthFar: 40, purpose: "From the top of the ledger tower the allied Great House's exchange spire rises over the expressway.", allow: ["kw-charter-hall"] },
  { id: "kw-vc-vault", name: "Ledger vault door to the charter hall portico", from: [20, round2(RECORD_FLOOR + 1.6), -18.4], to: [-1.6, round2(HALL_FLOOR + 3), -16.8], halfWidth: 0.8, halfWidthFar: 1.2, purpose: "The vault and the hall face each other across the deck promenade.", allow: ["kw-ledger-vault", "kw-charter-hall"] },
  { id: "kw-vc-gate", name: "Checkpoint to the ledger tower", from: [-50, round2(QUAY + 1.7), 16], to: [8, round2(HALL_FLOOR + 29), -31], halfWidth: 1.5, halfWidthFar: 4, purpose: "Through the checkpoint the first thing a courier sees is the ledger tower's crown above the deck.", allow: ["kw-charter-hall", "kw-checkpoint"] },
];

const expansion: BannerholdBlueprint["expansion"] = [
  { id: "kw-exp-record-gallery", name: "Record gallery plot", district: "F", polygon: [[10.5, -43.4], [21.2, -43.4], [21.2, -36.6], [10.5, -36.6]], intendedUse: "Glazed gallery for honours and returned standards beside the vault (hall tier 2).", unlocksAtHallTier: 2 },
  { id: "kw-exp-skybridge", name: "Expressway skybridge plot", district: "A", polygon: [[-20, -46.6], [0, -46.6], [0, -62], [-20, -62]], intendedUse: "A skybridge from the deck to an expressway service platform (hall tier 3).", unlocksAtHallTier: 3 },
  { id: "kw-exp-west-block", name: "West quay block plot", district: "C", polygon: [[-46, 32.5], [-36, 32.5], [-36, 41], [-46, 41]], intendedUse: "A new block for the levy's families on the quay's west end (hall tier 3).", unlocksAtHallTier: 3 },
  { id: "kw-exp-knight-suite", name: "Deck suite plot", district: "A", polygon: [[-41.4, -16], [-37.4, -16], [-37.4, -8], [-41.4, -8]], intendedUse: "Suite for a future Knight appointment on the deck's west end (reserved).", unlocksAtHallTier: null },
];

// --- Cameras, VR staging, atmosphere ---------------------------------------------

const hallTarget = [-6, round2(HALL_FLOOR + 12), -16] as const;
const musterTarget = [-6, round2(QUAY + 5), -3] as const;
const recordTarget = [20, round2(RECORD_FLOOR + 5), -16] as const;
const heraldTarget = [-46, round2(HERALD_FLOOR + 9), 8] as const;
const pawnY = muster.pawnStand.position[1];

const cameras: BannerholdBlueprint["cameras"] = [
  camera(
    "establishing",
    "Establishing — the enclave from across the harbour",
    establishingPos,
    ESTABLISHING_TARGET,
    40,
    { yawDeg: [-30, 30], pitchDeg: [8, 28], distance: [110, 200] },
    "Lower third: the still harbour, the quay with its crane, rail and landing stair, the worker blocks of every age behind the quay road; centre: the podium wall with the muster dock beneath it and the charter hall's tiled roof and steel ledger tower on the deck above; behind: the expressway on its piers; top: the capital's towers in the smog with the allied exchange spire among them. Last light from the west, signage coming on.",
    2.4,
  ),
  camera(
    "founding",
    "Founding — the standard raised over the muster yard",
    [-2, round2(QUAY + 1.8), 12],
    [-6, 15, -12],
    52,
    { yawDeg: [-12, 12], pitchDeg: [-23, -14], distance: [20, 28] },
    "From the muster yard, as the holding's people see it: the podium wall and the deck rail across the lower third, the new standard rising over the honour terrace against the charter hall's portico and sign, the ledger tower at the top right.",
    2.0,
  ),
  camera(
    "landmark:banner-hall",
    "Banner Hall",
    cameraFrom(hallTarget, 165, 46, 14),
    hallTarget,
    40,
    { yawDeg: [-35, 35], pitchDeg: [8, 34], distance: [30, 64] },
    "Over Charter Street and the yard: the charter hall's tiled roof and portico on the deck, the ledger tower and skybridge at the right, the household block at the left, the honour terrace and its lamp plinths before the door.",
  ),
  camera(
    "landmark:muster-grounds",
    "Muster Grounds",
    [-28, round2(QUAY + 29), 32],
    musterTarget,
    40,
    { yawDeg: [-12, 12], pitchDeg: [20, 40], distance: [36, 60] },
    "From over the west end of Charter Street, looking north-east into the yard: the levy dormitory's roof at the lower left, the deck stair climbing the podium wall, the steel dock with its two standards, the painted file marks and the representative's place before it, the deck rail and the charter hall with the raised standard above, the fabrication shed's sawtooth at the right.",
  ),
  camera(
    "landmark:war-record",
    "War Record",
    cameraFrom(recordTarget, 170, 34, 12),
    recordTarget,
    40,
    { yawDeg: [-30, 25], pitchDeg: [8, 34], distance: [22, 48] },
    "Over the fabrication shed: the ledger vault's copper roof and index clock on the deck, the glazed skybridge to the charter hall and the ledger tower at the left.",
  ),
  camera(
    "landmark:heralds-station",
    "Herald's Station",
    cameraFrom(heraldTarget, 100, 30, 10),
    heraldTarget,
    46,
    { yawDeg: [-25, 15], pitchDeg: [10, 34], distance: [22, 44] },
    "From over Charter Street: the signal office's ledger board and door, the mast and lamp above, the checkpoint gantry at the left where couriers arrive.",
  ),
  camera(
    "representative",
    "Representative close-up",
    [-3, round2(pawnY + 2.2), 10.8],
    [-3, round2(pawnY + 1.3), 3.2],
    32,
    { yawDeg: [-30, 30], pitchDeg: [2, 20], distance: [5, 10] },
    "Eye-level close-up of the nominated representative on their painted mark (or the empty mark and sealed message cylinder), the dock, its standards and the podium wall behind.",
    1.4,
  ),
];

const VR_SCALE = 0.008;
const DETAIL = { width: 124, depth: 112 };
const SEATED = { eyeHeight: 1.2, surfaceHeight: 0.74, viewerDistance: 0.82 };
const TOWER_TIP = round2(HALL_FLOOR + 31);

const vr: BannerholdBlueprint["vr"] = {
  displayScale: VR_SCALE,
  displayCenter: [0, 0],
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
    description: "Recentring re-places the gameplay anchor in front of the viewer; the miniature resets to its authored yaw (the viewer looks north from the harbour side toward the deck) and to the posture heights. The viewer is never moved or rotated.",
  },
  horizon: { ringRadius: 8, ringBaseHeight: -0.18, ringHeight: 1.4 },
  panelAnchors: { primary: [-0.74, 0.38, 0.24], dock: [0.64, 0.1, 0.36] },
  anchorConvention:
    "Assumed until gameplay confirms: the parent anchor's origin is the floor point beneath the viewer at recentre, -Z forward, no pitch or roll. The miniature's centre sits at (0, surfaceHeight, -viewerDistance).",
  comfortNotes: [
    `1:${Math.round(1 / VR_SCALE)} puts the ${DETAIL.width} × ${DETAIL.depth} m detail region on a ${(DETAIL.width * VR_SCALE).toFixed(2)} × ${(DETAIL.depth * VR_SCALE).toFixed(2)} m surface; the ledger tower's crown (${TOWER_TIP} m) rises ${(TOWER_TIP * VR_SCALE).toFixed(2)} m above the datum, below seated eye height.`,
    `Near edge ${(SEATED.viewerDistance - (DETAIL.depth * VR_SCALE) / 2).toFixed(2)} m from the eyes seated: the quay and the low blocks are nearest, the deck and its tower stand farthest, so nothing tall hides the yard.`,
    "The expressway and the towers beyond stand behind the far edge and on the horizon ring, never between the viewer and the enclave.",
    "No artificial viewer motion: focusLandmark raises the landmark's emphasis and label only.",
  ],
};

const atmosphere: BannerholdBlueprint["atmosphere"] = {
  timeOfDay: "Last light of the day shift: a smog-red sun low in the west, signage coming on, rain on the concrete",
  sun: { bearingDeg: 262, elevationDeg: 5, colour: "#e07a4f", intensity: 0.9, disc: "smog-disc" },
  sky: { zenith: "#1c2532", horizon: "#6b5f63", ground: "#1d1f23", ambientIntensity: 0.5 },
  fog: { colour: "#3b4654", near: 70, far: 1100, heightFalloff: 0.008 },
  wind: { towardBearingDeg: 120, speed: 3, gustiness: 0.25 },
  exposure: 1.1,
  accentLights: [
    { kind: "sodium", colour: "#ffb05c", note: "Street lamps along Charter Street and the quay road." },
    { kind: "fluorescent", colour: "#d9f4ff", note: "Galleries of the worker blocks, the checkpoint and the gate lodge." },
    { kind: "signal-lamp", colour: "#3fd2e2", note: "The banner's cyan sign over the portico and the lamp plinths of the honour terrace." },
    { kind: "furnace", colour: "#ff7a2a", note: "The fabrication shed's furnace through the sawtooth glazing." },
    { kind: "lantern", colour: "#ff8d4d", note: "The lamp shrine at the lane corner and the noodle stall." },
  ],
  palette: {
    concrete: "#6f7276",
    sootBrick: "#4a3832",
    steel: "#97a1ab",
    rust: "#8a4b2c",
    verdigris: "#4f8a7c",
    tile: "#2f3a44",
    signCyan: "#3fd2e2",
    sodium: "#ffb05c",
    wetAsphalt: "#1f2328",
    smog: "#3b4654",
    crownField: "#1b232e",
    crownBorder: "#3fd2e2",
  },
  notes: "Hierarchy by light: cyan glass and clean steel on the deck, sodium and fluorescent in the lower yard, furnace orange in the works. Signage is sparse and functional — no neon clutter; the towers beyond carry the brightest light. Rain darkens every horizontal surface.",
};

// --- Districts, traditions and the blueprint -------------------------------------

const districts: BannerholdBlueprint["districts"] = [
  { id: "A", name: "Charter Deck", role: "The charter hall and its ledger tower, the household block, the canteen, the gate lodge, the honour terrace and the unfinished annex frame, on the podium deck at +11 m.", polygon: [[-42, -44], [12, -44], [12, -22], [13, -22], [13, -14], [27, -14], [27, -36], [22, -36], [22, -44], [38, -44], [38, -34], [32, -34], [32, -6], [-42, -6]] },
  { id: "B", name: "Muster Yard", role: "The steel muster dock, the painted file marks and the representative's place, the drill square, the container armoury and the levy dormitory beneath the podium wall.", polygon: [[-36, -6], [5, -6], [5, 13], [-36, 13]] },
  { id: "C", name: "Charter Street Blocks", role: "Dwellings of every age and standing between Charter Street and the quay, Ledger Lane, Tank Alley and the back courts.", polygon: [[-34, 19], [34, 19], [34, 46], [-46, 46], [-46, 32], [-34, 32]] },
  { id: "D", name: "Works and Stores", role: "The fabrication shed and freight lift below the deck, the ration depot, water tower and substation along the service ramp, and the quay warehouse.", polygon: [[5, -6], [32, -6], [32, -34], [38, -34], [38, -46], [56, -46], [56, 46], [34, 46], [34, 13], [5, 13]] },
  { id: "E", name: "Checkpoint and Signal Office", role: "The checkpoint under its sign gantry, the signal office with its mast and ledger board, and the courier bay.", polygon: [[-61, -6], [-36, -6], [-36, 32], [-61, 32]] },
  { id: "F", name: "Ledger Vault", role: "The War Record: a concrete vault under a copper roof on the deck, joined to the charter hall by a glazed skybridge.", polygon: [[12, -44], [22, -44], [22, -36], [27, -36], [27, -14], [13, -14], [13, -22], [12, -22]] },
];

const traditions: BannerholdBlueprint["traditions"] = [
  { key: HERITAGE, name: "Charter-era heritage", description: "Soot-black brick on cast-iron frames, tiled roofs with upturned curved eaves, lattice screens and lanterns: the foundry company's buildings of standing, kept by each charter holder.", materials: [BRICK, TILE, COPPER, LATTICE, STEEL] },
  { key: FERRO, name: "Ferroconcrete", description: "Board-marked ferroconcrete: podium decks, stacked blocks with external galleries and stair cores, flat roofs crowded with tanks and vents; the common construction.", materials: [CONCRETE, FELT, STEEL, GLASS] },
  { key: SHEETWORK, name: "Sheet and girder", description: "Corrugated and plate steel on riveted frames: sawtooth sheds, vaulted stores, tanks on trestles, cargo containers and rooftop shacks.", materials: [SHEET, RUST, STEEL, BRICK] },
];

const settlementBoundary: Vec2[] = [
  [-57, 49.2], [-57, 24], [-61.2, 24], [-61.2, 8], [-57, 8], [-57, -47], [57, -47], [57, 49.2],
];

export const KWIND09_BLUEPRINT: BannerholdBlueprint = {
  schema: 1,
  nationId: "kwind-09",
  siteName: "The charter yard",
  status: "first-pass",
  summary:
    "A chartered enclave on a reclaimed foundry quay: the charter hall and ledger vault on a podium deck 8 m above the lower yard, the levy's painted muster yard beneath the podium wall, worker blocks of every age along Charter Street and the quay, a fabrication shed and stores along the service ramp, and a checkpoint where the arterial and the expressway's off-ramp meet. The expressway passes on its piers to the north; the capital's towers stand 14 km away in the smog.",
  terrain,
  settlementBoundary,
  coreReference: { width: 112, depth: 92 },
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
  unfinished: { buildingId: "kw-annex-tower", description: "The annex frame on the deck's north-east corner: three storeys of bare steel, scaffold and an idle tower crane; completes at hall tier 1." },
  slots,
  story,
  vegetation,
  dressing,
  activitySites,
  npcs,
  outer,
  viewCorridors,
  expansion,
  observation: { position: establishingPos, target: ESTABLISHING_TARGET, description: "From above the harbour south-south-west of the enclave, the way a lighter crew first sees it coming in across the basin." },
  cameras,
  vr,
  atmosphere,
};
