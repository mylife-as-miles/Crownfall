// Bannerhold spatial blueprint: the single source of truth for layout, used by
// the desktop renderer, the Quest renderer, the map generator and the tests.
// Pure data types only (no three, IWSDK, React, DOM, clock or randomness).
//
// COORDINATE SYSTEM (BLUEPRINT_COORDINATES in coordinates.ts; TECHNICAL_SPEC.md §2)
//   Right-handed, Y-up, metres. +X = east, +Y = up, +Z = south, -Z = north.
//   This matches three.js: an unrotated camera looks north (-Z).
//   Origin (0, 0, 0) = the settlement datum: the centre of the holding's core
//   rectangle at elevation 0, which every nation places near its main circulation
//   spine. Plan positions are written [x, z]. Compass bearings are degrees
//   clockwise from north (0 = north, 90 = east). rotationDeg is a yaw about +Y in
//   degrees, three.js convention: positive turns counter-clockwise seen from above.

import type { FileLetter, LandmarkId, NationId } from "../../types";

/** Plan position [x, z] in blueprint metres. */
export type Vec2 = readonly [number, number];
/** World position [x, y, z] in blueprint metres. */
export type Vec3 = readonly [number, number, number];

export type DistrictId = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export const DISTRICT_NAMES: Readonly<Record<DistrictId, string>> = {
  A: "Central Manor and Banner Hall",
  B: "Muster Grounds",
  C: "Residential Quarter",
  D: "Artisan and Supply Quarter",
  E: "Herald's Station and Main Gate",
  F: "War Record",
  G: "Outer Territory",
};

export interface DistrictDefinition {
  id: DistrictId;
  /** Nation-specific name (for example "Upper Ward"). */
  name: string;
  role: string;
  /** Closed plan polygon, counter-clockwise or clockwise. District G has none (it is everything outside). */
  polygon: readonly Vec2[];
}

/** A pose on the ground or on a structure. yawDeg follows the rotationDeg convention (0 = facing south, +Z). */
export interface Pose {
  position: Vec3;
  yawDeg: number;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export type TerrainSurface =
  | "grass" | "meadow" | "heath" | "earth" | "mud" | "rock" | "scree" | "moss" | "forest-floor"
  | "sand" | "dune" | "sulfur-crust" | "salt-flat" | "gravel" | "paving" | "cobble" | "field"
  | "concrete" | "asphalt" | "slag" | "snow";

export interface RectShape {
  kind: "rect";
  center: Vec2;
  width: number;
  depth: number;
  rotationDeg?: number;
}

export interface PolygonShape {
  kind: "polygon";
  points: readonly Vec2[];
}

export type PlanShape = RectShape | PolygonShape;

/**
 * Elevation features, evaluated by terrain.ts in this fixed order:
 * slope → mounds → ridges → noise → channels → platforms and ramps (array order, blended).
 */
export type TerrainFeature =
  /** Global tilt: elevation += gx * x + gz * z. */
  | { kind: "slope"; gradient: Vec2 }
  /** Elliptical cosine bump (negative height makes a hollow). */
  | { kind: "mound"; id: string; center: Vec2; radiusX: number; radiusZ: number; rotationDeg?: number; height: number; surface?: TerrainSurface }
  /** Ridge or embankment along a polyline with a cosine cross-profile. */
  | { kind: "ridge"; id: string; points: readonly Vec2[]; width: number; height: number; surface?: TerrainSurface }
  /**
   * Deterministic value noise (seeded). Platforms override it where they blend.
   * "ridged" folds the noise into sharp crests (crags, lava ridges); a region limits
   * the noise to a plan shape, fading out over regionFalloff metres.
   */
  | {
      kind: "noise";
      seed: number;
      amplitude: number;
      wavelength: number;
      octaves: number;
      style?: "smooth" | "ridged";
      region?: PlanShape;
      regionFalloff?: number;
    }
  /** Carved channel (ravine, wadi, ditch, canal bed). Bed elevation is relative carving depth. */
  | { kind: "channel"; id: string; points: readonly Vec2[]; width: number; depth: number; bankWidth: number; surface?: TerrainSurface }
  /**
   * Levelled ground: courtyards, terraces, building pads, rock shelves. Inside the
   * shape elevation becomes `elevation`; outside it blends back over `falloff` metres.
   * edge tells the kits what to build where the blend is steep.
   */
  | {
      kind: "platform";
      id: string;
      shape: PlanShape;
      elevation: number;
      falloff: number;
      surface: TerrainSurface;
      edge: "slope" | "retaining-wall" | "cliff" | "embankment" | "steps";
    }
  /**
   * Graded ground along a polyline (ramps, cut roads, embankments). Elevation runs
   * linearly by arc length from startElevation to endElevation; blended like a platform
   * and evaluated in array order together with platforms.
   */
  | {
      kind: "ramp";
      id: string;
      points: readonly Vec2[];
      width: number;
      startElevation: number;
      endElevation: number;
      falloff: number;
      surface: TerrainSurface;
    };

export type WaterKind = "stream" | "river" | "pond" | "cistern" | "reservoir" | "canal" | "moat" | "rill" | "spring" | "trough";

export interface WaterBody {
  id: string;
  kind: WaterKind;
  /** Area water uses a polygon; linear water uses a polyline with width. */
  shape: { kind: "area"; points: readonly Vec2[] } | { kind: "line"; points: readonly Vec2[]; width: number };
  /** Absolute water-surface elevation for area water (and the mean level of line water). */
  level: number;
  /** Line water only: surface elevation at each polyline point (interpolated between points). */
  pointLevels?: readonly number[];
  /** Surface flow in metres/second along the polyline, 0 for still water. */
  flow: number;
  note: string;
}

export interface SurfaceZone {
  id: string;
  surface: TerrainSurface;
  shape: PlanShape;
}

export interface TerrainExtents {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface TerrainModel {
  /** Locally modelled terrain mesh extents. Beyond them the far-terrain skirt and skyline take over. */
  extents: TerrainExtents;
  baseElevation: number;
  baseSurface: TerrainSurface;
  features: readonly TerrainFeature[];
  water: readonly WaterBody[];
  surfaces: readonly SurfaceZone[];
  /** Short description of the terrain logic for documentation. */
  logic: string;
}

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

export type RoofForm =
  | "gable" | "steep-gable" | "hip" | "half-hip" | "pyramid" | "spire" | "conical" | "lean-to"
  | "flat" | "flat-parapet" | "terrace" | "dome" | "barrel-vault" | "sod-gable" | "curved-ridge"
  | "sawtooth" | "setback-crown" | "open-frame" | "none";

export type ConditionGrade = "new" | "sound" | "worn" | "weathered" | "damaged" | "ruinous" | "under-construction";
/** Material quality expresses class and the house's limited wealth. */
export type MaterialQuality = "noble" | "fine" | "common" | "poor";
export type SocialClass = "lord" | "retainer" | "martial" | "civic" | "sacred" | "artisan" | "commoner" | "labourer";
export type FoundationKind = "flush" | "plinth" | "undercroft" | "terrace-cut" | "stilts" | "podium" | "rock-cut";
export type BuildingEra = "ancestral" | "predecessor" | "founding" | "recent" | "under-construction";

export type MassRole =
  | "hall" | "keep" | "tower" | "wing" | "house" | "annex" | "porch" | "lean-to" | "gatehouse"
  | "chimney" | "stair-tower" | "gallery" | "platform" | "shed" | "silo" | "mast" | "arcade"
  | "block" | "podium" | "windcatcher" | "vault" | "canopy" | "stack" | "scaffold";

export interface RoofSpec {
  form: RoofForm;
  /** Local axis the ridge runs along ("x" = width axis, "z" = depth axis). */
  ridgeAxis: "x" | "z";
  /** Material library key (see TECHNICAL_SPEC.md material library). */
  material: string;
}

/** Plan outline of a mass: rectangles by default; round and octagonal masses use width as the diameter (depth must equal width). */
export type MassPlan = "rect" | "round" | "octagon";

/** One volume of a building. Local +X is the width axis, local +Z the depth axis (the front at rotationDeg 0 faces south). */
export interface BuildingMass {
  id: string;
  role: MassRole;
  center: Vec2;
  width: number;
  depth: number;
  rotationDeg: number;
  plan?: MassPlan;
  storeys: number;
  /** Eave (or parapet) height above the building floor, metres. */
  eaveHeight: number;
  /** Ridge, apex, spire tip or parapet top above the building floor, metres. Always ≥ eaveHeight. */
  ridgeHeight: number;
  /** Height above the building floor where this mass begins (bridges, galleries, jettied upper volumes). */
  baseOffset?: number;
  /** Lean-to roofs rise toward local -Z (ridgeAxis "x") or local -X (ridgeAxis "z"). */
  roof: RoofSpec;
  /** Wall material key. */
  wallMaterial: string;
}

export type RepairKind =
  | "rebuilt-courses" | "patched-roof" | "new-timber" | "buttress" | "boarded-opening" | "replaced-gate"
  | "fresh-render" | "iron-strapping" | "salvaged-stone" | "tarpaulin" | "welded-plate" | "lime-wash"
  | "re-thatched" | "re-shingled" | "new-lintel" | "spliced-post";

export interface Repair {
  kind: RepairKind;
  note: string;
  /** Mass id the repair is visible on. */
  mass?: string;
}

export type BuildingFunction =
  | "banner-hall" | "manor-house" | "keep" | "lodging" | "kitchen" | "chapel" | "archive" | "war-room"
  | "ceremonial" | "gatehouse" | "muster-platform" | "armoury" | "guardhouse" | "barracks" | "stable"
  | "house" | "tenement" | "cottage" | "longhouse" | "pit-house" | "courtyard-house" | "worker-block"
  | "forge" | "workshop" | "granary" | "storehouse" | "bakehouse" | "brewhouse" | "smokehouse" | "tannery"
  | "mill" | "market" | "covered-market" | "herald-station" | "dovecote" | "infirmary" | "shrine"
  | "cistern-house" | "windcatcher" | "beast-pen" | "substation" | "cooling-tower" | "depot" | "fabrication"
  | "checkpoint" | "office" | "warehouse" | "well-house" | "outpost" | "barn";

export interface BuildingAge {
  era: BuildingEra;
  builtYearsAgo: number;
  condition: ConditionGrade;
  repairs: readonly Repair[];
}

export interface Building {
  id: string;
  name: string;
  district: DistrictId;
  function: BuildingFunction;
  /** Construction tradition key from the nation sheet (for example "kv-ashlar-gothic"). */
  tradition: string;
  masses: readonly BuildingMass[];
  /** Main door plan position and the compass bearing it faces. */
  entrance: { position: Vec2; facingBearingDeg: number };
  foundation: {
    kind: FoundationKind;
    /** Plinth height above the highest ground under the footprint (resolved floor = that + plinth). */
    plinth: number;
    /** Largest allowed ground relief under the footprint before the foundation type is implausible. */
    maxRelief: number;
  };
  /** Explicit floor elevation; omit to resolve from the terrain (see buildings.ts). */
  floorY?: number;
  age: BuildingAge;
  quality: MaterialQuality;
  social: SocialClass;
  /** Rendering priority: hero assets get bespoke detail; background assets may be simplified. */
  lod: "hero" | "mid" | "background";
  /** Kit/prefab id hint for the pipeline (see TECHNICAL_SPEC.md kit registry). */
  kit: string;
  landmark?: LandmarkId;
  /** Dressing and storytelling tags (chimney, banner-mount, well, laundry, scaffold, cooking-fire, ...). */
  tags: readonly string[];
  story: string;
  /** Ids of buildings, walls, towers or routes this building intentionally touches or spans. */
  allowOverlapWith?: readonly string[];
  /** Present on the unfinished structure: what stage it is at and which hall tier completes it. */
  unfinished?: { stage: "foundations" | "walls" | "roof-frame" | "fitting-out"; completesAtHallTier: 1 | 2 | 3; scaffold: boolean };
  /** Development buildings appear only at or above this hall tier (gameplay-driven, never faked). */
  appearsAtHallTier?: 1 | 2 | 3;
}

// ---------------------------------------------------------------------------
// Fortifications
// ---------------------------------------------------------------------------

export type WallKind =
  | "curtain" | "town-wall" | "palisade" | "rampart" | "low-wall" | "retaining" | "fence" | "hedge"
  | "security-fence" | "barrier" | "dry-stone";

export interface WallSegmentCondition {
  /** Segment index range [from, to) into points (segment i runs points[i] → points[i+1]). */
  from: number;
  to: number;
  condition: ConditionGrade;
  note: string;
}

export interface WallRun {
  id: string;
  name: string;
  kind: WallKind;
  points: readonly Vec2[];
  closed: boolean;
  /** Height above local ground, metres. */
  height: number;
  thickness: number;
  walkway: boolean;
  material: string;
  tradition: string;
  segments: readonly WallSegmentCondition[];
  allowOverlapWith?: readonly string[];
}

export interface Tower {
  id: string;
  name: string;
  kind: "watchtower" | "wall-tower" | "gate-tower" | "signal-tower" | "beacon" | "horn-tower" | "mast";
  center: Vec2;
  shape: "round" | "square" | "polygonal";
  width: number;
  height: number;
  roof: RoofForm;
  material: string;
  wallId: string | null;
  condition: ConditionGrade;
  repairs: readonly Repair[];
  /** "repaired-watchtower" marks the brief's storytelling tower. */
  storyRole?: "repaired-watchtower";
  story: string;
  allowOverlapWith?: readonly string[];
}

export interface GateDefinition {
  id: string;
  name: string;
  kind: "main-gate" | "inner-gate" | "postern" | "checkpoint" | "water-gate";
  position: Vec2;
  /** Bearing a traveller faces when leaving through the gate. */
  outwardBearingDeg: number;
  width: number;
  height: number;
  wallId: string;
  routeId: string;
}

// ---------------------------------------------------------------------------
// Circulation
// ---------------------------------------------------------------------------

export type RouteKind =
  | "road" | "street" | "lane" | "alley" | "path" | "track" | "stair" | "ramp" | "bridge" | "causeway"
  | "covered-street" | "elevated-road" | "service-corridor" | "skybridge" | "rail";

export type RouteSurface =
  | "cobble" | "flagstone" | "setts" | "packed-earth" | "gravel" | "timber" | "sand" | "sandstone-paving"
  | "log-corduroy" | "turf" | "asphalt" | "concrete" | "steel-grate" | "ballast";

export type RouteUser = "merchants" | "messengers" | "residents" | "soldiers" | "carts" | "beasts" | "vehicles" | "nobility" | "workers";

export interface Route {
  id: string;
  name: string;
  kind: RouteKind;
  hierarchy: "national" | "primary" | "secondary" | "pedestrian" | "service";
  points: readonly Vec2[];
  width: number;
  surface: RouteSurface;
  /** "elevated" routes (bridges over roads, viaducts, skybridges) only connect at their own endpoints to stairs/ramps or elevated routes. */
  grade: "ground" | "elevated";
  /** Explicit deck elevation per point for elevated routes. Ground routes follow the terrain. */
  deckY?: readonly number[];
  covered: boolean;
  users: readonly RouteUser[];
  /** Outer-territory routes may extend beyond the terrain extents toward the greater nation. */
  outer: boolean;
}

/** Named destinations the circulation network must reach from the main gate. */
export interface Destination {
  id: "gate" | "manor" | "muster" | "residential" | "artisan" | "archive" | "herald" | "ceremonial";
  label: string;
  position: Vec2;
}

// ---------------------------------------------------------------------------
// Landmarks, muster and state slots
// ---------------------------------------------------------------------------

export interface LandmarkAnchor {
  id: LandmarkId;
  label: string;
  buildingIds: readonly string[];
  /** Label/focus anchor published through LandmarkDescriptor.position. */
  anchor: Vec3;
  /** Selection sphere centre and radius in blueprint metres (scaled by the VR display scale on Quest). */
  pickCenter: Vec3;
  pickRadius: number;
  /** Desktop framing id used by focusLandmark. */
  cameraId: CameraId;
}

export interface FileMarker {
  file: FileLetter;
  pose: Pose;
}

export interface MusterLayout {
  /** The stone/marked place of the nominated representative (empty when captive). */
  pawnStand: Pose;
  /** Eight file markers a–h in order along the muster line. */
  fileMarkers: readonly FileMarker[];
  /** Where levy members stand (BannerholdPresentation.levy), up to the slot count. */
  levySlots: readonly Pose[];
  /** Drill positions used by the drilling squad when present. */
  drillSquare: RectShape;
  platformBuildingId: string;
}

export interface BannerMount {
  id: string;
  kind: "standard" | "shield" | "pennant" | "emblem" | "tapestry" | "veiled-standard" | "signal-flag";
  /** Whose heraldry the mount carries: the player's banner, the allied/rival house, the crown, or a veiled national standard. */
  heraldry: "player" | "ally" | "rival" | "crown" | "veiled";
  pose: Pose;
  /** Height of the cloth's top edge above pose.position.y. */
  height: number;
  minHallTier: 0 | 1 | 2 | 3;
}

export interface HallTierDevelopment {
  tier: 1 | 2 | 3;
  /** Buildings that appear (appearsAtHallTier) or complete (unfinished.completesAtHallTier) at this tier. */
  buildings: readonly string[];
  expansionZones: readonly string[];
  dressing: readonly string[];
}

/**
 * Spatial slots the LegacySceneState adapter fills. Every slot is a place, never a
 * result: gameplay supplies which slots are occupied (see TECHNICAL_SPEC.md mapping).
 */
export interface StateSlots {
  /** Where an injured representative recovers (only when an injury is recorded). */
  injuredRest: Pose;
  /** Indication at the empty stand of which rival holds a captive (sealed writ, captor's colours). */
  captiveMarker: Pose;
  /** Honour niches at the ceremonial place (LegacyHonour[] in order). */
  honourNiches: readonly Pose[];
  /** Match markers on the War Record table (matchMarkers in order). */
  recordMarkers: readonly Pose[];
  /** Notice positions at the Herald's Station board (noticeKinds / unreadNotices). */
  noticeBoard: readonly Pose[];
  /** Where an arriving messenger dismounts / stops. */
  heraldArrival: Pose;
  /** Rival correspondence (sealed challenge) display when a rival challenge is open. */
  rivalCorrespondence: Pose;
  /** Envoy pennant of the allied Great House at the Herald's Station. */
  alliedEnvoy: Pose;
  bannerMounts: readonly BannerMount[];
  hallTiers: readonly HallTierDevelopment[];
  /** Founding ceremony focus (draft heraldry raised here). */
  foundingStandard: Pose;
}

export interface CeremonialPlace {
  id: string;
  name: string;
  shape: RectShape;
  centrepiece: Vec2;
  description: string;
}

export interface UnfinishedStructureRef {
  buildingId: string;
  description: string;
}

export type StoryKind =
  | "repaired-watchtower" | "weathered-fortification" | "levy-yard-vs-noble-architecture" | "merchant-road"
  | "unfinished-structure" | "ceremonial-place" | "empty-character-position" | "older-house-ruin"
  | "boundary-dispute" | "class-contrast" | "water-memory" | "ancestral-memory";

export interface StoryLocation {
  id: string;
  kind: StoryKind;
  position: Vec2;
  refs: readonly string[];
  description: string;
}

// ---------------------------------------------------------------------------
// Life: activity sites and deterministic NPC schedules
// ---------------------------------------------------------------------------

export type ActivityKind =
  | "patrol" | "watch" | "forge-strike" | "quench" | "bellows" | "carry" | "drill" | "salute" | "read-notice"
  | "post-notice" | "draw-water" | "cook" | "chat" | "sweep" | "hang-laundry" | "chop-wood" | "tend-beast"
  | "trade" | "pray" | "inspect" | "rest" | "ride" | "load" | "repair" | "write";

export interface ActivitySite {
  id: string;
  kind: "forge" | "anvil" | "quench" | "well" | "cooking-fire" | "drill-square" | "notice-board" | "market-stall"
    | "laundry" | "woodpile" | "stable" | "shrine" | "trough" | "workbench" | "loading-bay" | "lookout" | "war-table";
  position: Vec3;
  district: DistrictId;
}

export type ScheduleStep =
  /** Walk along the route waypoints from the current index to `to` (forward or backward). */
  | { kind: "walk"; to: number; speed?: number }
  /** Stay at the current waypoint performing an activity. */
  | { kind: "hold"; seconds: number; activity: ActivityKind; faceBearingDeg?: number };

export interface NpcAgent {
  id: string;
  role: "sentry" | "smith" | "messenger" | "drill" | "resident" | "herald" | "carter" | "farmer" | "worker" | "beast-handler" | "guard" | "scribe" | "child" | "priest";
  label: string;
  district: DistrictId;
  /** Figures moving together (drill squads, carts). Offsets are local to the leader (x right, z back). */
  count: number;
  formation?: readonly Vec2[];
  route: readonly Vec2[];
  /** "terrain" follows the ground; "wall-walk" follows wallId's walkway; "elevated" uses routeDeckY. */
  heightMode: "terrain" | "wall-walk" | "elevated";
  wallId?: string;
  routeDeckY?: readonly number[];
  /** Steps run in order from waypoint 0 and must end back at waypoint 0 so the loop is seamless. */
  steps: readonly ScheduleStep[];
  /** Offset into the loop so agents sharing a pattern never move in lockstep. */
  phaseSeconds: number;
  /** Default walking speed, metres/second. */
  speed: number;
  /** Distance-based update rates (from the camera in blueprint metres). */
  lod: { fullRateWithin: number; reducedRateWithin: number; hiddenBeyond: number };
  activitySiteIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Outer territory and the greater nation
// ---------------------------------------------------------------------------

export interface FieldPlot {
  id: string;
  crop: string;
  polygon: readonly Vec2[];
  /** Furrow/row bearing in degrees. */
  furrowBearingDeg: number;
  owner: "holding" | "neighbour" | "crown";
  condition: "tended" | "fallow" | "harvested" | "neglected";
}

export interface Outpost {
  id: string;
  name: string;
  kind: "border-tower" | "waystation" | "shrine" | "mill" | "beacon" | "toll" | "relay-mast" | "cairn" | "boundary-stone" | "pump-station";
  position: Vec2;
  height: number;
  owner: "holding" | "allied-great-house" | "rival-house" | "crown" | "other-banner";
  description: string;
}

export interface DistantPlace {
  id: string;
  name: string;
  kind:
    | "allied-seat" | "frontier" | "neighbour-estate" | "village" | "town" | "monastery" | "necropolis" | "capital"
    | "industrial" | "citadel" | "arcology" | "port";
  /** Authored as bearing + distance from the origin; position is derived from them. */
  bearingDeg: number;
  distance: number;
  position: Vec2;
  /** Ground elevation at the place and the height of its tallest silhouette above that ground. */
  groundElevation: number;
  silhouetteHeight: number;
  /** Rough radius of the place's built extent. */
  radius: number;
  /**
   * Heraldry the place may fly, filled from LegacySceneState: the allied Great House's seat, or
   * the frontier toward the rival house's nation (the adapter lights the frontier whose
   * frontierNation equals rivalHouse.nationId; the others stay unflagged).
   */
  stateSlot?: "allied-house" | "rival-house";
  /** Frontier places only: the neighbouring nation that lies beyond this march. */
  frontierNation?: NationId;
  description: string;
}

export interface Territory {
  id: string;
  name: string;
  owner: "holding" | "allied-great-house" | "rival-house" | "crown" | "other-banner" | "wilderness" | "church";
  polygon: readonly Vec2[];
}

export interface SkylineLayer {
  id: string;
  kind: "mountains" | "ridge" | "spires" | "towers" | "mesa" | "forest" | "smoke" | "glacier" | "dunes" | "viaduct";
  bearingFromDeg: number;
  bearingToDeg: number;
  distance: number;
  height: number;
  description: string;
}

export interface OuterTerritory {
  fields: readonly FieldPlot[];
  outposts: readonly Outpost[];
  places: readonly DistantPlace[];
  territories: readonly Territory[];
  skyline: readonly SkylineLayer[];
}

export interface ViewCorridor {
  id: string;
  name: string;
  from: Vec3;
  to: Vec3;
  /** Half-width of the corridor in metres at the near end; it widens linearly to halfWidthFar. */
  halfWidth: number;
  halfWidthFar: number;
  purpose: string;
  /** Building/tower ids allowed inside the corridor (its framing elements). */
  allow: readonly string[];
}

export interface ExpansionZone {
  id: string;
  name: string;
  district: DistrictId;
  polygon: readonly Vec2[];
  intendedUse: string;
  /** Hall tier at which development may begin to appear; null = reserved beyond v1. */
  unlocksAtHallTier: 1 | 2 | 3 | null;
}

// ---------------------------------------------------------------------------
// Vegetation and authored dressing clusters
// ---------------------------------------------------------------------------

export interface VegetationZone {
  id: string;
  kind: "woodland" | "forest" | "orchard" | "hedgerow" | "scrub" | "heath" | "palm-grove" | "reeds" | "garden" | "lone-tree" | "planter" | "vine-terrace" | "moss-bank";
  shape: PlanShape;
  /** Instances per 100 m² (lone-tree zones use 1 instance at the centre). */
  density: number;
  species: string;
  /** Seed for deterministic placement inside the zone (pipeline uses shared seeded PRNGs). */
  seed: number;
}

export type DressingKind =
  | "well" | "cooking-fire" | "woodpile" | "cart" | "barrels" | "crates" | "laundry-line" | "practice-pell"
  | "archery-butt" | "weapon-rack" | "hay" | "anvil" | "quench-trough" | "market-stall" | "notice-board"
  | "brazier" | "grave-markers" | "boundary-stone" | "scaffold-stack" | "stone-pile" | "water-jars"
  | "awning" | "beast-tether" | "cable-run" | "vent-stack" | "pallets" | "lamp-post" | "bench" | "planter"
  | "crane" | "standing-stone" | "bones" | "canal-lock" | "pipe-rack" | "signage";

export interface DressingCluster {
  id: string;
  kind: DressingKind;
  position: Vec2;
  yawDeg: number;
  district: DistrictId;
  note?: string;
}

// ---------------------------------------------------------------------------
// Cameras, VR staging and atmosphere
// ---------------------------------------------------------------------------

export type CameraId = "establishing" | "founding" | `landmark:${LandmarkId}` | "representative";

export interface CameraFraming {
  id: CameraId;
  label: string;
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees (16:9 reference frame). */
  fovDeg: number;
  /**
   * Restrained orbit about the target. yaw is relative to the authored azimuth;
   * pitch is the camera's elevation angle above the target (degrees, positive looks down);
   * distance is absolute metres from the target.
   */
  orbit: { yawDeg: readonly [number, number]; pitchDeg: readonly [number, number]; distance: readonly [number, number] };
  transitionSeconds: number;
  composition: string;
}

export interface VrPostureStaging {
  /** Typical eye height above the floor, metres. */
  eyeHeight: number;
  /** Height above the floor where the blueprint datum (datumY) sits. */
  surfaceHeight: number;
  /** Horizontal distance from the viewer's eyes to the diorama centre, metres. */
  viewerDistance: number;
}

export interface VrStaging {
  /** Physical metres per blueprint metre (the miniature scale). */
  displayScale: number;
  /** Blueprint plan point placed at the diorama centre. */
  displayCenter: Vec2;
  /** Blueprint elevation placed at the posture's surfaceHeight. */
  datumY: number;
  /** Region rendered at full miniature detail (blueprint metres, centred on displayCenter). */
  detailExtent: { width: number; depth: number };
  /** Terrain skirt beyond the detail region (blueprint metres), fading at its rim; never toward the viewer. */
  skirtMargins: { far: number; lateral: number; near: number };
  /** The blueprint compass bearing that points away from the viewer at rest. */
  viewerFacingBearingDeg: number;
  seated: VrPostureStaging;
  standing: VrPostureStaging;
  rotation: { userRotatable: boolean; yawLimitDeg: number; snapStepDeg: number; resetsOnRecentre: boolean };
  /** Physical metres. */
  reach: { pokeMax: number; rayMax: number; minTargetRadius: number };
  recentre: { keepsScale: boolean; keepsYaw: boolean; description: string };
  /** Distant silhouettes on a ring at room scale (physical metres from the viewer). */
  horizon: { ringRadius: number; ringBaseHeight: number; ringHeight: number };
  /** Physical metres relative to the diorama surface centre (x right, y up, -z away from the viewer). */
  panelAnchors: { primary: Vec3; dock: Vec3 };
  anchorConvention: string;
  comfortNotes: readonly string[];
}

export interface AtmosphereDefinition {
  timeOfDay: string;
  /** Compass bearing toward the light source and its elevation above the horizon. */
  sun: { bearingDeg: number; elevationDeg: number; colour: string; intensity: number; disc: "eclipse-corona" | "sun" | "veiled-sun" | "smog-disc" };
  sky: { zenith: string; horizon: string; ground: string; ambientIntensity: number };
  fog: { colour: string; near: number; far: number; heightFalloff: number };
  /** Bearing the wind blows toward, used by banners, smoke and foliage. */
  wind: { towardBearingDeg: number; speed: number; gustiness: number };
  exposure: number;
  accentLights: readonly { kind: "torch" | "brazier" | "lantern" | "ritual-candle" | "furnace" | "sodium" | "fluorescent" | "signal-lamp"; colour: string; note: string }[];
  palette: Readonly<Record<string, string>>;
  notes: string;
}

export interface ConstructionTradition {
  key: string;
  name: string;
  description: string;
  materials: readonly string[];
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface BannerholdBlueprint {
  schema: 1;
  nationId: NationId;
  siteName: string;
  /** Korvenia is the reversible production default; the others are first-pass layouts. */
  status: "production-default" | "first-pass";
  summary: string;
  terrain: TerrainModel;
  /** The holding proper; districts A–F lie inside it. */
  settlementBoundary: readonly Vec2[];
  /** The brief's reference core (≈100 × 80 m) that this layout realises. */
  coreReference: { width: number; depth: number };
  traditions: readonly ConstructionTradition[];
  districts: readonly DistrictDefinition[];
  buildings: readonly Building[];
  walls: readonly WallRun[];
  towers: readonly Tower[];
  gates: readonly GateDefinition[];
  routes: readonly Route[];
  destinations: readonly Destination[];
  landmarks: readonly LandmarkAnchor[];
  muster: MusterLayout;
  ceremonial: CeremonialPlace;
  unfinished: UnfinishedStructureRef;
  slots: StateSlots;
  story: readonly StoryLocation[];
  vegetation: readonly VegetationZone[];
  dressing: readonly DressingCluster[];
  activitySites: readonly ActivitySite[];
  npcs: readonly NpcAgent[];
  outer: OuterTerritory;
  viewCorridors: readonly ViewCorridor[];
  expansion: readonly ExpansionZone[];
  /** The player's initial observation position (desktop establishing camera). */
  observation: { position: Vec3; target: Vec3; description: string };
  cameras: readonly CameraFraming[];
  vr: VrStaging;
  atmosphere: AtmosphereDefinition;
}
