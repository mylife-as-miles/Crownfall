// Archive contracts: the annotated spatial blueprint, its exhibits, artifacts,
// viewpoints, lights and budgets. Plain data only; no browser, renderer or
// framework dependencies, and ES2020-safe for the Quest typecheck.
//
// Units and conventions (also stated in docs/chronicles/ARCHIVE_BLUEPRINT.md):
// - Archive metres. +X is east, +Y is up and -Z is north. The origin is the
//   chamber centre on the main floor (y = 0).
// - `yaw` is a rotation about +Y in radians, as three.js applies it: 0 faces
//   north (-Z) and a positive yaw turns toward the west, counter-clockwise
//   seen from above. A yawed object's local -Z points at (-sin yaw, 0, -cos yaw).
// - `bearing` is a compass bearing in radians: 0 is north and a positive
//   bearing turns toward the east, clockwise seen from above. Its direction is
//   (sin bearing, 0, -cos bearing), so bearing = -yaw.
// - Angles of elevation and pitch are radians above the horizontal (negative
//   below it). Every angle in the data is radians; the generated document
//   prints degrees.

import type { ChronicleCollectionId } from "../types";

export type Vec2 = readonly [x: number, z: number];
export type Vec3 = readonly [x: number, y: number, z: number];

/** Tessellation and texture tiers: Quest, then the three desktop presets. */
export type ArchiveQuality = "quest" | "low" | "medium" | "high";
export type DesktopQuality = Exclude<ArchiveQuality, "quest">;

/** How an exhibit takes part in M1: selectable, framed by the camera only, or built but unlit and absent from navigation. */
export type ExhibitPresentation = "interactive" | "framed" | "dormant";

/**
 * Lighting zones. Every built vertex carries one, so a platform can emphasise a
 * collection with light (a gain per zone) without splitting merged geometry.
 */
export const ARCHIVE_ZONES = ["chamber", "atlas", "interregnum", "laws", "contested", "entrance", "mechanism", "expansion"] as const;
export type ArchiveZone = (typeof ARCHIVE_ZONES)[number];

/** Restrained orbit, tilt and zoom about an authored framing: offsets in radians, zoom as distance factors. */
export interface FramingLimits {
  /** Turn about the target's vertical axis, relative to the authored eye. */
  yaw: readonly [min: number, max: number];
  /** Change of the eye's elevation above the target, relative to the authored eye. */
  pitch: readonly [min: number, max: number];
  /** Eye-to-target distance as a factor of the authored distance; below 1 moves in. */
  zoom: readonly [min: number, max: number];
}

export interface DesktopFraming {
  eye: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
  limits: FramingLimits;
}

export interface ExhibitDefinition {
  id: string;
  collection: ChronicleCollectionId;
  presentation: ExhibitPresentation;
  /** The exhibit's reference point: its centre on its display surface. */
  anchor: Vec3;
  yaw: number;
  artifactIds: readonly string[];
  /** Desktop authored framing; the `collection:<id>` viewpoint repeats it. */
  framing: DesktopFraming;
  /** Quest presentation from the seated station: bearing (rad) and horizontal distance (m) to the anchor, its height and display scale. */
  station: { bearing: number; distance: number; height: number; scale: number };
  /** Selection proxy for rays, poke and the pointer, in archive space. */
  pick: { center: Vec3; radius: number };
  /** Occluder volumes that the framing sweep found between the desktop camera and this exhibit. */
  occluders?: readonly string[];
  zone: ArchiveZone;
}

export type ArtifactKind = "relief" | "ring" | "dial" | "dais" | "piece" | "seal" | "document" | "emblem" | "inscription" | "miniature" | "standard";

export interface ArtifactDefinition {
  id: string;
  collection: ChronicleCollectionId;
  kind: ArtifactKind;
  /**
   * A kernel builder id with optional parameters, or a GLB under
   * assets/chronicles that replaces it with no code change elsewhere. The
   * "relief" builder is the shared Living Atlas relief, which each platform
   * sculpts at its own monument scale; "ring-band" takes its ring from the
   * mechanism by the artifact id.
   */
  mesh: { builder: string; params?: BuilderParams } | { asset: string };
  /** Where it stands; rings and the relief take their place from the mechanism and the monument instead. */
  placement?: { position: Vec3; yaw: number };
  materialIds: readonly string[];
  /** Registry entries it presents (approved record ids in M1). */
  entryIds: readonly string[];
  /** Its own target, or part of its exhibit's proxy. */
  selectable: boolean;
  zone: ArchiveZone;
  occluder?: string;
}

export type BuilderParams = Readonly<Record<string, number | string | boolean>>;

export interface ArchitecturalElement {
  id: string;
  /** A kernel builder with its parameters, or a Blender GLB under assets/chronicles. */
  mesh: { builder: string; params: BuilderParams } | { asset: string };
  transform: { position: Vec3; yaw: number; scale?: Vec3 };
  /** Repeats of the same mesh; when present they replace the single transform's placement. */
  instances?: readonly { position: Vec3; yaw: number }[];
  /** Material ids by the builder's material slots, in slot order. */
  materialIds: readonly string[];
  /** Its occluder volume id (or ids, one per instance), if it can hide an exhibit. */
  occluder?: string | readonly string[];
  zone: ArchiveZone;
  /** Casts into the desktop key light's shadow map. */
  castShadow?: boolean;
}

export interface OculusDefinition {
  center: Vec3;
  /** Radius of the open disc in metres. */
  radius: number;
  /** The pierced screen: an open centre, a dappled outer band and radial bars. All lengths are fractions of the radius. */
  tracery: { open: number; band: readonly [inner: number, outer: number]; bars: number; barWidth: number; holes: number; holeRadius: number; seed: number };
}

export interface ChamberLevel {
  id: string;
  y: number;
}

export interface ChamberDefinition {
  /** The floor outline of every walkable and framed space (chamber, bays, vestibule, recesses), by increasing bearing (clockwise seen from above). */
  footprint: readonly Vec2[];
  floorY: number;
  /** Vault springing above the main cornice. */
  springingY: number;
  /** The oculus ring, the highest point of the vault shell. */
  crownY: number;
  oculus: OculusDefinition;
  /** The octagonal core: pier centres on a circle of `pierRadius`, one face per side. */
  octagon: { sides: number; pierRadius: number; apothem: number; pierWidth: number; pierDepth: number; span: number };
  levels: readonly ChamberLevel[];
  /** What opens off each side of the octagon, side 0 facing north and continuing clockwise. */
  sides: readonly { side: number; bearing: number; kind: "bay" | "entrance" | "recess"; depth: number; width: number; zone: ArchiveZone }[];
}

export interface MonumentDefinition {
  center: Vec3;
  yaw: number;
  /** Desktop relief, about 4.5-5 m wide; `reliefTop` is the height of its rim plane. */
  desktop: { reliefWidth: number; reliefTop: number };
  /** Quest relief at reachable table scale; the station sits at its south edge. */
  quest: { reliefWidth: number; reliefTop: Readonly<Record<"seated" | "standing", number>>; center: Vec3 };
  /** Parametric carved plinth around the relief: margin beyond the slab and the step around its foot. */
  plinth: { builder: string; margin: number; step: number; stepHeight: number };
  /** Bronze frame around the slab's foot, in metres at desktop scale. */
  frame: { band: number; rise: number };
}

export interface MechanismRing {
  id: string;
  /** The ring's own centre; its pivot is the axis through it, normal to the ring. */
  center: Vec3;
  radius: number;
  /** Euler angles in radians (three.js order "XYZ") that turn a horizontal ring into place; +X raises its north side, +Z its east side. */
  tilt: Vec3;
  /** Band cross-section: radial width and thickness in metres. */
  section: { width: number; thickness: number };
  /** The arc that will carry events from M3, as ring angles in radians (0 at the ring's local north, positive toward its local east). */
  eventBand: readonly [from: number, to: number];
  /** Rods that hold the ring at its rim: the rim angle and the anchor point on the vault. */
  suspension: readonly { angle: number; anchor: Vec3 }[];
}

export interface DesktopViewpoint extends DesktopFraming {
  /** "entrance", "overview", "collection:<id>", "nation:<id>" or "review:<id>" (captures only). */
  id: string;
}

export interface QuestControlSurface {
  /** Centre of the panel. */
  position: Vec3;
  /** Rotation about +Y of the panel, which faces its local +Z (UIKit panels do); it turns the panel toward the viewer. */
  yaw: number;
  /** Tilt back from upright in radians (negative leans the top away from the viewer). */
  pitch: number;
  /** Panel width in metres; its height follows the 1280 x 720 design grid. */
  width: number;
}

export interface QuestVantage {
  posture: "seated" | "standing";
  /** The station on the floor; the floor is XR local-floor y = 0. */
  floor: Vec3;
  /** Nominal eye height; the runtime places the room from the real head pose. */
  eyeHeight: number;
  forwardYaw: number;
  /** At most 60 degrees, in radians. */
  comfortHalfAngle: number;
  controlSurface: QuestControlSurface;
}

export type LightTreatment = "dynamic" | "baked" | "omitted";

export interface ArchiveLight {
  id: string;
  kind: "key" | "fill" | "practical" | "emissive";
  position: Vec3;
  target?: Vec3;
  /** sRGB hex. */
  color: string;
  /** A hemisphere fill's ground colour (sRGB hex). */
  groundColor?: string;
  intensity: number;
  /** Falloff reach in metres for points and the key's cone length. */
  range?: number;
  /** Spot cone for the key: half-angle in radians and penumbra share. */
  cone?: { angle: number; penumbra: number };
  /** At most one light on desktop. */
  castsShadow: boolean;
  /** Light-pattern texture id, e.g. the oculus tracery for dappled light. */
  cookie?: string;
  desktop: Readonly<Record<DesktopQuality, LightTreatment>>;
  quest: "baked" | "omitted";
  zone: ArchiveZone;
  /** Built but unlit in M1 (the dormant bay). */
  dormant?: boolean;
}

export interface AtmosphereVolume {
  id: string;
  kind: "haze" | "shaft" | "dust";
  center: Vec3;
  /** Full extents; a shaft's y extent is its length along `axis`. */
  size: Vec3;
  density: number;
  /** Unit direction for shafts and dust columns, pointing down the light. */
  axis?: Vec3;
  color: string;
}

export interface InteractionZone {
  id: string;
  kind: "pick" | "reach" | "ray" | "camera-clearance" | "control";
  center: Vec3;
  radius: number;
}

export interface CameraPath {
  from: string;
  to: string;
  via: readonly Vec3[];
  seconds: number;
}

export interface ExpansionPoint {
  id: string;
  position: Vec3;
  yaw: number;
  size: Vec3;
  reservedFor: "collection" | "war-record" | "unassigned";
}

export interface OccluderVolume {
  id: string;
  kind: "box" | "cylinder" | "prism";
  /** Centre of the volume (a prism's plan is relative to it). */
  center: Vec3;
  /** Box: full extents in its yawed frame. Cylinder: [diameter, height, diameter] about a vertical axis. Prism: its plan's bounds and height. */
  size: Vec3;
  yaw: number;
  /** Prism only: a convex plan outline in the volume's yawed frame, [x, z] pairs. */
  plan?: readonly Vec2[];
}

export interface QualityBudget {
  drawCalls: number;
  triangles: number;
  textureMB: number;
}

export interface ArchiveBlueprint {
  schema: 1;
  chamber: ChamberDefinition;
  elements: readonly ArchitecturalElement[];
  monument: MonumentDefinition;
  /** Static in M1, one pivot per ring; each event band carries the Annals events from M3. */
  mechanism: { rings: readonly MechanismRing[] };
  /** One per collection. */
  exhibits: readonly ExhibitDefinition[];
  artifacts: readonly ArtifactDefinition[];
  viewpoints: { desktop: readonly DesktopViewpoint[]; quest: readonly QuestVantage[] };
  lights: readonly ArchiveLight[];
  atmosphere: readonly AtmosphereVolume[];
  zones: readonly InteractionZone[];
  /** Desktop camera moves; Quest has none. */
  paths: readonly CameraPath[];
  expansion: readonly ExpansionPoint[];
  occluders: readonly OccluderVolume[];
  budgets: Readonly<Record<ArchiveQuality, QualityBudget>>;
  /** Short design notes for the generated document: language and intent, never lore. */
  notes: readonly { topic: string; text: string }[];
}
