// The annotated spatial blueprint of the archive as data: one octagonal
// ceremonial chamber with a strong vertical axis, the Living Atlas monument on
// its floor, the still rings of the future Annals mechanism hung from the
// vault, and bays to the north-west, north and north-east inside the Quest
// comfort cone, with the entrance to the south behind the viewer. Both
// renderers build from this one description; its tests carry the composition,
// comfort, occlusion and canon rules. Design language only, never lore.
//
// Units and conventions are in ./types.ts. Everything here is computed once,
// deterministically, from the parameters at the top.

import { getChronicleRecords } from "../content";
import {
  fitReliefDistance, getReliefViewPose, RELIEF_ASPECT, RELIEF_FOV, RELIEF_LEVELS, RELIEF_SLAB, RELIEF_VIEWS, type ReliefView,
} from "./relief";
import { atBearing, bearingDirection, bearingOf, DEG, ringPoint, wrapAngle, yawForBearing } from "./space";
import { vaultHeightAt, vaultMeridian, type VaultShape } from "./kernel/vault-profile";
import type {
  ArchiveBlueprint, ArchiveLight, ArchiveZone, ArtifactDefinition, ArchitecturalElement, AtmosphereVolume, CameraPath, DesktopFraming,
  DesktopViewpoint, ExhibitDefinition, ExpansionPoint, FramingLimits, InteractionZone, MechanismRing, OccluderVolume, QuestVantage, Vec2, Vec3,
} from "./types";
import type { ChronicleNationId } from "../types";

// ---------------------------------------------------------------------------
// Parameters

const SIDES = 8;
const STEP = (Math.PI * 2) / SIDES;
const HALF_STEP = STEP / 2;
/** Pier centres sit on the octagon's corners. */
const PIER_RADIUS = 11.2;
const APOTHEM = PIER_RADIUS * Math.cos(HALF_STEP);
const SIDE_LENGTH = 2 * PIER_RADIUS * Math.sin(HALF_STEP);
/** Pier plan: width along each side at the arcade plane, and how far its faces reach inside and outside the corner. */
const PIER = { width: 2.5, inner: 1.4, outer: 1.0 } as const;
const SPAN = SIDE_LENGTH - PIER.width;

const LEVEL = {
  floor: 0,
  /** Pier capitals carry the arcade at the impost. */
  impost: 4.8,
  /** The arcade arches stilt a little above the impost before they turn. */
  springing: 5.15,
  string: 10.1,
  gallery: 10.4,
  cornice: 12.9,
  vault: 13.5,
} as const;

/** Stilted two-centred pointed arcade arch: each half is an arc of radius factor x span. */
const ARCH = { radiusFactor: 0.72, wallInner: 0.6, wallOuter: 0.9, voussoirDepth: 0.62, voussoirs: 15 } as const;
const ARCH_RADIUS = ARCH.radiusFactor * SPAN;
const ARCH_RISE = Math.sqrt(ARCH_RADIUS * ARCH_RADIUS - (ARCH_RADIUS - SPAN / 2) ** 2);

/** The vault springs from the cornice's inner edge and rises on a circular meridian to the round oculus. */
const VAULT_SHAPE: VaultShape = {
  sides: SIDES,
  springApothem: APOTHEM - ARCH.wallInner - 0.45,
  springY: LEVEL.vault,
  springAngle: 62 * DEG,
  oculusRadius: 3.2,
  oculusAngle: 80 * DEG,
};
const VAULT = vaultMeridian(VAULT_SHAPE);
const CROWN = VAULT.crownY;

/** What opens off each octagon side: depth beyond the arcade plane, and the zone it lights. */
const SIDE_PLAN = [
  { kind: "bay", depth: 6.4, zone: "laws" },
  { kind: "bay", depth: 6.2, zone: "contested" },
  { kind: "recess", depth: 1.8, zone: "chamber" },
  { kind: "recess", depth: 1.8, zone: "chamber" },
  { kind: "entrance", depth: 6.6, zone: "entrance" },
  { kind: "recess", depth: 1.8, zone: "chamber" },
  { kind: "recess", depth: 1.8, zone: "chamber" },
  { kind: "bay", depth: 6.2, zone: "interregnum" },
] as const;

/** The vestibule descends to a landing below the chamber floor. */
const ENTRANCE = { steps: 7, rise: 0.15, run: 0.36, start: 1.0 } as const;
const LANDING_Y = -ENTRANCE.steps * ENTRANCE.rise;

/** Desktop monument: the relief about 4.8 m wide on a carved plinth at the chamber centre. */
const DESKTOP_RELIEF = { width: 4.8, top: 1.1 } as const;
/** Quest monument at reachable table scale, at the south edge of which the viewer sits or stands. */
const QUEST_RELIEF = { width: 1.1, top: { seated: 0.72, standing: 0.86 }, near: 0.32 } as const;
const QUEST_DEPTH = QUEST_RELIEF.width * RELIEF_ASPECT;
/** The station on the floor, chosen so the rings' event bands sit comfortably above the eye line. */
const STATION_Z = 2.9;
const QUEST_CENTER_Z = STATION_Z - QUEST_RELIEF.near - QUEST_DEPTH / 2;
const EYE = { seated: 1.2, standing: 1.6 } as const;
/** The Quest comfort cone's half-angle: 60 degrees, rounded down so it never exceeds it. */
const COMFORT = Math.floor(60 * DEG * 1e4) / 1e4;

/** The sun stands nearly overhead, leaning a few degrees to the north, so the pool covers the monument broadly. */
const SUN = { elevation: 87 * DEG, bearing: 352 * DEG, distance: 110 } as const;

// ---------------------------------------------------------------------------
// Derived plan helpers

const sideBearing = (side: number) => side * STEP;
const vertexBearing = (vertex: number) => vertex * STEP + HALF_STEP;
const sideCentre = (side: number): Vec2 => {
  const [x, z] = bearingDirection(sideBearing(side));
  return [x * APOTHEM, z * APOTHEM];
};
const vertexPoint = (vertex: number): Vec2 => {
  const [x, z] = bearingDirection(vertexBearing(vertex));
  return [x * PIER_RADIUS, z * PIER_RADIUS];
};
/** A point in a side's frame: `s` along the side (toward increasing bearing), `d` outward from the arcade plane, `y` up. */
const bayPoint = (side: number, s: number, d: number, y: number): [number, number, number] => {
  const b = sideBearing(side);
  const [cx, cz] = sideCentre(side);
  // Tangent toward increasing bearing and the outward normal.
  return [cx + Math.cos(b) * s + Math.sin(b) * d, y, cz + Math.sin(b) * s - Math.cos(b) * d];
};
/** Yaw that turns an object's local -Z toward the chamber centre from a side or vertex bearing. */
const facingCentre = (bearing: number) => wrapAngle(yawForBearing(bearing + Math.PI));
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
const r3 = (x: number, y: number, z: number): Vec3 => [round(x), round(y), round(z)];

function footprint(): Vec2[] {
  const points: Vec2[] = [];
  for (let side = 0; side < SIDES; side++) {
    const plan = SIDE_PLAN[side];
    const start = vertexPoint((side + SIDES - 1) % SIDES);
    points.push([round(start[0]), round(start[1])]);
    for (const [s, d] of [[-SPAN / 2, 0], [-SPAN / 2, plan.depth], [SPAN / 2, plan.depth], [SPAN / 2, 0]] as const) {
      const p = bayPoint(side, s, d, 0);
      points.push([round(p[0]), round(p[2])]);
    }
  }
  return points;
}

/**
 * The pier plan in its own frame (local -Z toward the centre, local +X toward
 * decreasing bearing): a kite whose inner face is PIER.inner inside the corner,
 * whose jamb faces stand square to the two arcade sides through the jamb
 * points, and whose outer face hides in the walls PIER.outer outside it.
 */
export function pierPlan(): Vec2[] {
  const jt = (PIER.width / 2) * Math.cos(HALF_STEP), jr = -(PIER.width / 2) * Math.sin(HALF_STEP);
  const along = (r: number) => jt + (Math.sin(HALF_STEP) * (r - jr)) / Math.cos(HALF_STEP);
  const inner = along(-PIER.inner), outer = along(PIER.outer);
  return [[inner, -PIER.inner], [outer, PIER.outer], [-outer, PIER.outer], [-inner, -PIER.inner]].map(([x, z]) => [round(x, 6), round(z, 6)] as Vec2);
}

/** The pier at a vertex as an exact prism occluder. */
function pierOccluder(vertex: number): OccluderVolume {
  const bearing = vertexBearing(vertex);
  const [vx, vz] = vertexPoint(vertex);
  const plan = pierPlan();
  const width = Math.max(...plan.map((point) => point[0])) * 2;
  return {
    id: `pier-${vertex}`,
    kind: "prism",
    center: r3(vx, LEVEL.vault / 2, vz),
    size: r3(width, LEVEL.vault, PIER.inner + PIER.outer),
    yaw: round(facingCentre(bearing)),
    plan,
  };
}

// ---------------------------------------------------------------------------
// The monument and its framings

const seaLevel = (width: number, top: number) => top - RELIEF_LEVELS.rim * width;

/** A relief view (map widths) as a framing in archive space for the desktop monument. */
function reliefFraming(view: ReliefView, limits: FramingLimits, distance = view.distance, fov = RELIEF_FOV): DesktopFraming {
  const pose = getReliefViewPose({ ...view, distance }, DESKTOP_RELIEF.width);
  const sea = seaLevel(DESKTOP_RELIEF.width, DESKTOP_RELIEF.top);
  return {
    eye: r3(pose.position[0], pose.position[1] + sea, pose.position[2]),
    target: r3(pose.target[0], pose.target[1] + sea, pose.target[2]),
    fov,
    limits,
  };
}

const NATIONS: readonly ChronicleNationId[] = ["korvenia", "solforiz", "aethelgard", "kwind-09"];
const NATION_LIMITS: FramingLimits = { yaw: [-0.3, 0.3], pitch: [-0.22, 0.22], zoom: [0.8, 1.45] };
const ATLAS_LIMITS: FramingLimits = { yaw: [-0.25, 0.25], pitch: [-0.2, 0.15], zoom: [0.75, 1.1] };
/**
 * The Atlas focus holds the whole slab at 16:9 like the relief's own overview,
 * with a slightly wider lens so the eye stays below the rings.
 */
const ATLAS_FOV = 42;
const ATLAS_DISTANCE = fitReliefDistance(RELIEF_VIEWS.overview, ATLAS_FOV, 16 / 9, 0.04);

// ---------------------------------------------------------------------------
// The mechanism: three still rings concentric on the vertical axis, each held
// at its rim by bronze rods hung from the vault, never from a hub.

function ring(id: string, radius: number, y: number, tilt: Vec3, eventBand: readonly [number, number], rods: readonly number[], section = { width: 0.42, thickness: 0.15 }): MechanismRing {
  const centre: Vec3 = [0, y, 0];
  const draft = { id, center: centre, radius, tilt, section, eventBand, suspension: [] as { angle: number; anchor: Vec3 }[] };
  for (const angle of rods) {
    // The rod hangs straight up from the rim point to the vault above it.
    const rim = ringPoint(draft, angle);
    const anchorY = vaultHeightAt(VAULT_SHAPE, VAULT, Math.hypot(rim[0], rim[2]), bearingOf(rim[0], rim[2]));
    draft.suspension.push({ angle: round(angle), anchor: r3(rim[0], anchorY, rim[2]) });
  }
  return draft;
}

const RINGS: readonly MechanismRing[] = [
  ring("annals-ring-outer", 5.6, 5.6, [-0.05, 0, 0], [-55 * DEG, 55 * DEG], [22.5 * DEG, 142.5 * DEG, 262.5 * DEG]),
  ring("annals-ring-middle", 4.6, 6.4, [0, 0, -0.14], [-30 * DEG, 70 * DEG], [82.5 * DEG, 202.5 * DEG, 322.5 * DEG]),
  ring("annals-ring-inner", 3.6, 7.2, [-0.18, 0, 0], [-45 * DEG, 45 * DEG], [52.5 * DEG, 172.5 * DEG, 292.5 * DEG], { width: 0.34, thickness: 0.13 }),
];

// ---------------------------------------------------------------------------
// Exhibits

const seatedEye: Vec3 = [0, EYE.seated, STATION_Z];

function station(anchor: Vec3, scale = 1) {
  const dx = anchor[0] - seatedEye[0], dz = anchor[2] - seatedEye[2];
  return { bearing: round(bearingOf(dx, dz)), distance: round(Math.hypot(dx, dz)), height: round(anchor[1]), scale: round(scale) };
}

const DIAL_ANCHOR = r3(...bayPoint(7, 0, SIDE_PLAN[7].depth - 0.32, 3.15));
const DAIS = { d: 3.55, width: 5.2, depth: 4.0, height: 0.45 } as const;
const DAIS_TOP = r3(...bayPoint(0, 0, DAIS.d, DAIS.height));
const STELE_ANCHOR = r3(...bayPoint(1, 0, 4.15, 1.15));

const EXHIBITS: readonly ExhibitDefinition[] = [
  {
    id: "exhibit-atlas",
    collection: "atlas",
    presentation: "interactive",
    anchor: [0, DESKTOP_RELIEF.top, 0],
    yaw: 0,
    artifactIds: ["atlas-relief"],
    framing: reliefFraming(RELIEF_VIEWS.overview, ATLAS_LIMITS, ATLAS_DISTANCE, ATLAS_FOV),
    station: station([0, QUEST_RELIEF.top.seated, QUEST_CENTER_Z], QUEST_RELIEF.width / DESKTOP_RELIEF.width),
    pick: { center: [0, DESKTOP_RELIEF.top, 0], radius: round(Math.hypot(DESKTOP_RELIEF.width, DESKTOP_RELIEF.width * RELIEF_ASPECT) / 2) },
    zone: "atlas",
  },
  {
    id: "exhibit-interregnum",
    collection: "interregnum",
    presentation: "framed",
    anchor: DIAL_ANCHOR,
    yaw: round(facingCentre(sideBearing(7))),
    artifactIds: ["annals-dial", "annals-ring-outer", "annals-ring-middle", "annals-ring-inner"],
    framing: {
      eye: r3(...bayPoint(7, 0.35, -3.6, 2.35)),
      target: r3(DIAL_ANCHOR[0], 2.85, DIAL_ANCHOR[2]),
      fov: 46,
      limits: { yaw: [-0.16, 0.16], pitch: [-0.08, 0.16], zoom: [0.78, 1.08] },
    },
    station: station(DIAL_ANCHOR),
    pick: { center: DIAL_ANCHOR, radius: 1.9 },
    zone: "interregnum",
  },
  {
    id: "exhibit-laws",
    collection: "laws",
    presentation: "framed",
    anchor: DAIS_TOP,
    yaw: round(facingCentre(sideBearing(0))),
    artifactIds: ["laws-dais"],
    framing: {
      eye: r3(...bayPoint(0, 0.5, -4.1, 3.1)),
      target: r3(DAIS_TOP[0], 1.15, DAIS_TOP[2]),
      fov: 46,
      limits: { yaw: [-0.17, 0.17], pitch: [-0.1, 0.14], zoom: [0.8, 1.08] },
    },
    station: station(DAIS_TOP),
    pick: { center: r3(DAIS_TOP[0], 1.0, DAIS_TOP[2]), radius: 2.9 },
    zone: "laws",
  },
  {
    id: "exhibit-contested",
    collection: "contested",
    presentation: "dormant",
    anchor: STELE_ANCHOR,
    yaw: round(facingCentre(sideBearing(1))),
    artifactIds: ["contested-stele-west", "contested-stele-centre", "contested-stele-east"],
    framing: {
      eye: r3(...bayPoint(1, -0.3, -3.8, 2.4)),
      target: r3(STELE_ANCHOR[0], 1.4, STELE_ANCHOR[2]),
      fov: 46,
      limits: { yaw: [-0.15, 0.15], pitch: [-0.08, 0.12], zoom: [0.82, 1.06] },
    },
    station: station(STELE_ANCHOR),
    pick: { center: r3(STELE_ANCHOR[0], 1.3, STELE_ANCHOR[2]), radius: 2.1 },
    zone: "contested",
  },
];

const steleAt = (s: number, d: number, id: string, occluder: string): ArtifactDefinition => {
  const p = bayPoint(1, s, d, 0);
  return {
    id, collection: "contested", kind: "document", mesh: { builder: "stele", params: { width: 0.9, height: 2.3, depth: 0.34 } },
    placement: { position: r3(p[0], 0, p[2]), yaw: round(facingCentre(sideBearing(1))) },
    materialIds: ["basalt", "bronze"], entryIds: [], selectable: false, zone: "contested", occluder,
  };
};

const ARTIFACTS: readonly ArtifactDefinition[] = [
  {
    id: "atlas-relief", collection: "atlas", kind: "relief", mesh: { builder: "relief" },
    materialIds: ["painting", "basalt"], entryIds: getChronicleRecords("atlas").map((record) => record.id), selectable: false, zone: "atlas",
  },
  {
    id: "annals-dial", collection: "interregnum", kind: "dial", mesh: { builder: "dial", params: { radius: 1.7, rings: 5, ticks: 72 } },
    placement: { position: DIAL_ANCHOR, yaw: round(facingCentre(sideBearing(7))) },
    materialIds: ["bronze", "basalt"], entryIds: getChronicleRecords("interregnum").map((record) => record.id), selectable: false, zone: "interregnum",
    occluder: "dial-base",
  },
  ...RINGS.map((item): ArtifactDefinition => ({
    id: item.id, collection: "interregnum", kind: "ring", mesh: { builder: "ring-band" },
    materialIds: ["bronze"], entryIds: [], selectable: false, zone: "mechanism",
  })),
  {
    id: "laws-dais", collection: "laws", kind: "dais",
    mesh: { builder: "dais", params: { width: DAIS.width, depth: DAIS.depth, height: DAIS.height, steps: 3, grid: 8 } },
    placement: { position: r3(...bayPoint(0, 0, DAIS.d, 0)), yaw: round(facingCentre(sideBearing(0))) },
    materialIds: ["basalt", "bronze", "floor-stone"], entryIds: getChronicleRecords("laws").map((record) => record.id), selectable: false, zone: "laws",
    occluder: "dais-laws",
  },
  steleAt(-1.55, 4.45, "contested-stele-west", "stele-west"),
  steleAt(0, 4.15, "contested-stele-centre", "stele-centre"),
  steleAt(1.55, 4.45, "contested-stele-east", "stele-east"),
];

// ---------------------------------------------------------------------------
// Architecture

const LAMPS = {
  entrance: [bayPoint(4, -2.4, -1.65, 0), bayPoint(4, 2.4, -1.65, 0)],
  interregnum: [bayPoint(7, -2.05, 4.55, 0), bayPoint(7, 2.05, 4.55, 0)],
  laws: [bayPoint(0, -2.55, 5.55, 0), bayPoint(0, 2.55, 5.55, 0)],
  contested: [bayPoint(1, -2.15, 4.7, 0), bayPoint(1, 2.15, 4.7, 0)],
} as const;
const SCONCES = [bayPoint(2, -2.25, 1.62, 3.35), bayPoint(2, 2.25, 1.62, 3.35), bayPoint(6, -2.25, 1.62, 3.35), bayPoint(6, 2.25, 1.62, 3.35)];
const LAMP_HEIGHT = 2.15;
const lampSides = { entrance: 4, interregnum: 7, laws: 0, contested: 1 } as const;

function lampElement(zone: keyof typeof LAMPS): ArchitecturalElement {
  return {
    id: `lamps-${zone}`,
    mesh: { builder: "lamp-stand", params: { height: LAMP_HEIGHT } },
    transform: { position: [0, 0, 0], yaw: 0 },
    instances: LAMPS[zone].map((p) => ({ position: r3(p[0], 0, p[2]), yaw: round(facingCentre(sideBearing(lampSides[zone]))) })),
    materialIds: ["bronze", "lamp-core"],
    occluder: LAMPS[zone].map((_, index) => `lamp-${zone}-${index}`),
    zone: zone === "entrance" ? "entrance" : zone,
  };
}

function bayElement(id: string, side: number, back: string, floor: string, ribs: number): ArchitecturalElement {
  const [x, z] = sideCentre(side);
  return {
    id,
    mesh: { builder: "bay", params: { side, depth: SIDE_PLAN[side].depth, back, floor, ribs } },
    transform: { position: r3(x, 0, z), yaw: round(facingCentre(sideBearing(side))) },
    materialIds: ["limestone", "floor-stone", "limestone-carved", "basalt", "bronze", "limestone-dressed"],
    zone: SIDE_PLAN[side].zone as ArchiveZone,
  };
}

const sidesOf = (kinds: readonly string[]) => Array.from({ length: SIDES }, (_, side) => side).filter((side) => kinds.includes(SIDE_PLAN[side].kind));
const allSides = Array.from({ length: SIDES }, (_, side) => side);
const plainPiers = [0, 2, 3, 4, 5, 7];
const nichePiers = [1, 6];

const ELEMENTS: readonly ArchitecturalElement[] = [
  { id: "floor", mesh: { builder: "floor", params: {} }, transform: { position: [0, 0, 0], yaw: 0 }, materialIds: ["floor-stone", "basalt", "bronze"], zone: "chamber" },
  {
    id: "piers", mesh: { builder: "pier", params: { niche: false } }, transform: { position: [0, 0, 0], yaw: 0 },
    instances: plainPiers.map((vertex) => { const [x, z] = vertexPoint(vertex); return { position: r3(x, 0, z), yaw: round(facingCentre(vertexBearing(vertex))) }; }),
    materialIds: ["limestone", "limestone-dressed", "bronze", "basalt"], occluder: plainPiers.map((vertex) => `pier-${vertex}`), zone: "chamber",
  },
  {
    id: "piers-niche", mesh: { builder: "pier", params: { niche: true } }, transform: { position: [0, 0, 0], yaw: 0 },
    instances: nichePiers.map((vertex) => { const [x, z] = vertexPoint(vertex); return { position: r3(x, 0, z), yaw: round(facingCentre(vertexBearing(vertex))) }; }),
    materialIds: ["limestone", "limestone-dressed", "bronze", "basalt"], occluder: nichePiers.map((vertex) => `pier-${vertex}`), zone: "expansion",
  },
  {
    id: "arcade", mesh: { builder: "arcade-arch", params: {} }, transform: { position: [0, 0, 0], yaw: 0 },
    instances: allSides.map((side) => { const [x, z] = sideCentre(side); return { position: r3(x, 0, z), yaw: round(facingCentre(sideBearing(side))) }; }),
    materialIds: ["limestone", "basalt", "limestone-dressed"], zone: "chamber",
  },
  { id: "string-course", mesh: { builder: "octagon-moulding", params: { profile: "string", y: LEVEL.string, height: round(LEVEL.gallery - LEVEL.string) } }, transform: { position: [0, 0, 0], yaw: 0 }, materialIds: ["limestone-dressed"], zone: "chamber" },
  {
    id: "gallery", mesh: { builder: "gallery", params: {} }, transform: { position: [0, 0, 0], yaw: 0 },
    instances: allSides.map((side) => { const [x, z] = sideCentre(side); return { position: r3(x, 0, z), yaw: round(facingCentre(sideBearing(side))) }; }),
    materialIds: ["limestone", "basalt", "bronze", "limestone-dressed"], zone: "chamber",
  },
  { id: "cornice", mesh: { builder: "octagon-moulding", params: { profile: "cornice", y: LEVEL.cornice, height: round(LEVEL.vault - LEVEL.cornice) } }, transform: { position: [0, 0, 0], yaw: 0 }, materialIds: ["limestone-dressed"], zone: "chamber" },
  { id: "vault-shell", mesh: { builder: "vault-shell", params: {} }, transform: { position: [0, 0, 0], yaw: 0 }, materialIds: ["limestone", "limestone-carved", "limestone-dressed", "bronze"], zone: "chamber" },
  { id: "vault-ribs", mesh: { builder: "vault-ribs", params: {} }, transform: { position: [0, 0, 0], yaw: 0 }, materialIds: ["limestone-dressed", "bronze"], zone: "chamber" },
  { id: "oculus-ring", mesh: { builder: "oculus-ring", params: {} }, transform: { position: [0, CROWN, 0], yaw: 0 }, materialIds: ["limestone-dressed", "bronze"], zone: "chamber" },
  { id: "oculus-tracery", mesh: { builder: "oculus-tracery", params: {} }, transform: { position: [0, CROWN + 0.32, 0], yaw: 0 }, materialIds: ["tracery", "limestone-dressed"], zone: "chamber" },
  { id: "sky-disc", mesh: { builder: "sky-disc", params: {} }, transform: { position: [0, CROWN + 1.1, 0], yaw: 0 }, materialIds: ["sky"], zone: "chamber" },
  bayElement("bay-laws", 0, "panel", "flat", 2),
  bayElement("bay-contested", 1, "plain", "flat", 2),
  bayElement("bay-interregnum", 7, "dial-wall", "flat", 2),
  bayElement("vestibule", 4, "door", "steps-down", 2),
  ...sidesOf(["recess"]).map((side) => bayElement(`recess-${side}`, side, "roundel", "flat", 0)),
  lampElement("entrance"),
  lampElement("interregnum"),
  lampElement("laws"),
  lampElement("contested"),
  {
    id: "sconces", mesh: { builder: "lamp-sconce", params: {} }, transform: { position: [0, 0, 0], yaw: 0 },
    instances: SCONCES.map((p, index) => ({ position: r3(...p), yaw: round(facingCentre(sideBearing(index < 2 ? 2 : 6))) })),
    materialIds: ["bronze", "lamp-core"], zone: "chamber",
  },
  { id: "suspension-rods", mesh: { builder: "suspension-rods", params: { radius: 0.028 } }, transform: { position: [0, 0, 0], yaw: 0 }, materialIds: ["bronze"], zone: "mechanism", castShadow: true },
];

// ---------------------------------------------------------------------------
// Occluders

const lampOccluders: OccluderVolume[] = (Object.keys(LAMPS) as (keyof typeof LAMPS)[]).flatMap((zone) => LAMPS[zone].map((p, index): OccluderVolume => ({
  id: `lamp-${zone}-${index}`, kind: "cylinder", center: r3(p[0], LAMP_HEIGHT / 2, p[2]), size: [0.56, LAMP_HEIGHT, 0.56], yaw: 0,
})));

const desktopPlinth = {
  width: DESKTOP_RELIEF.width * (1 + 2 * RELIEF_SLAB.chamfer) + 2 * 0.42,
  depth: DESKTOP_RELIEF.width * (RELIEF_ASPECT + 2 * RELIEF_SLAB.chamfer) + 2 * 0.42,
};
const STEP_OUT = 0.34;

const OCCLUDERS: readonly OccluderVolume[] = [
  ...allSides.map(pierOccluder),
  {
    id: "monument-desktop", kind: "box", center: r3(0, (DESKTOP_RELIEF.top + 0.5) / 2, 0),
    size: r3(desktopPlinth.width + 2 * STEP_OUT, DESKTOP_RELIEF.top + 0.5, desktopPlinth.depth + 2 * STEP_OUT), yaw: 0,
  },
  {
    id: "dais-laws", kind: "box", center: r3(...bayPoint(0, 0, DAIS.d, DAIS.height / 2)),
    size: r3(DAIS.width + 0.9, DAIS.height, DAIS.depth + 0.9), yaw: round(facingCentre(sideBearing(0))),
  },
  {
    id: "dial-base", kind: "box", center: r3(...bayPoint(7, 0, SIDE_PLAN[7].depth - 0.55, 0.6)),
    size: [2.6, 1.2, 1.1], yaw: round(facingCentre(sideBearing(7))),
  },
  ...([["stele-west", -1.55, 4.45], ["stele-centre", 0, 4.15], ["stele-east", 1.55, 4.45]] as const).map(([id, s, d]): OccluderVolume => ({
    id, kind: "box", center: r3(...bayPoint(1, s, d, 1.25)), size: [1.15, 2.5, 0.7], yaw: round(facingCentre(sideBearing(1))),
  })),
  ...lampOccluders,
];

// ---------------------------------------------------------------------------
// Desktop viewpoints and paths

const VIEWPOINTS_DESKTOP: readonly DesktopViewpoint[] = [
  {
    id: "entrance",
    eye: r3(...bayPoint(4, 0, 5.35, LANDING_Y + 1.65)),
    target: [0, 2.7, 0],
    fov: 52,
    limits: { yaw: [-0.12, 0.12], pitch: [-0.06, 0.08], zoom: [0.94, 1.03] },
  },
  {
    // The first impression: from inside the entrance arch, the monument, the rings and the shaft together.
    id: "overview",
    eye: r3(...bayPoint(4, 1.2, 0.62, 3.4)),
    target: [0.3, 4.2, -2],
    fov: 56,
    limits: { yaw: [-0.06, 0.06], pitch: [-0.05, 0.05], zoom: [0.95, 1.03] },
  },
  ...EXHIBITS.filter((exhibit) => exhibit.presentation !== "dormant").map((exhibit): DesktopViewpoint => ({ id: `collection:${exhibit.collection}`, ...exhibit.framing })),
  ...NATIONS.map((nation): DesktopViewpoint => ({ id: `nation:${nation}`, ...reliefFraming(RELIEF_VIEWS[nation], NATION_LIMITS) })),
  { id: "review:contested", ...EXHIBITS[3].framing },
];

function pathBetween(from: string, to: string, seconds: number, lift = 0.6): CameraPath {
  const a = VIEWPOINTS_DESKTOP.find((view) => view.id === from)!, b = VIEWPOINTS_DESKTOP.find((view) => view.id === to)!;
  const mid = r3((a.eye[0] + b.eye[0]) / 2, (a.eye[1] + b.eye[1]) / 2 + lift, (a.eye[2] + b.eye[2]) / 2);
  return { from, to, via: [mid], seconds };
}

const NAVIGABLE = ["overview", "collection:atlas", "collection:interregnum", "collection:laws"] as const;
const PATHS: readonly CameraPath[] = [
  pathBetween("entrance", "overview", 1.4, 0.3),
  ...NAVIGABLE.flatMap((from, index) => NAVIGABLE.slice(index + 1).flatMap((to) => [pathBetween(from, to, from === "overview" ? 1.1 : 1.2), pathBetween(to, from, from === "overview" ? 1.1 : 1.2)])),
  ...NATIONS.flatMap((nation) => [pathBetween("collection:atlas", `nation:${nation}`, 0.9, 0.2), pathBetween(`nation:${nation}`, "collection:atlas", 0.9, 0.2)]),
  ...NATIONS.flatMap((from) => NATIONS.filter((to) => to !== from).map((to) => pathBetween(`nation:${from}`, `nation:${to}`, 0.9, 0.3))),
  pathBetween("overview", "review:contested", 1.2),
];

// ---------------------------------------------------------------------------
// Quest vantages: the station at the Quest monument's south edge, facing north.

function controlSurface(eyeHeight: number, drop: number) {
  const bearing = 40 * DEG, distance = 1.0;
  const [dx, dz] = bearingDirection(bearing);
  // A panel faces its local +Z; this yaw turns that face back toward the eye.
  return { position: r3(dx * distance, eyeHeight - drop, STATION_Z + dz * distance), yaw: round(Math.atan2(-dx, -dz)), pitch: 0, width: 0.86 };
}

const VANTAGES: readonly QuestVantage[] = [
  { posture: "seated", floor: [0, 0, STATION_Z], eyeHeight: EYE.seated, forwardYaw: 0, comfortHalfAngle: COMFORT, controlSurface: controlSurface(EYE.seated, 0.04) },
  { posture: "standing", floor: [0, 0, STATION_Z], eyeHeight: EYE.standing, forwardYaw: 0, comfortHalfAngle: COMFORT, controlSurface: controlSurface(EYE.standing, 0.12) },
];

// ---------------------------------------------------------------------------
// Lights and atmosphere

const OCULUS_CENTRE: Vec3 = [0, round(CROWN), 0];
const sunVector: Vec3 = [Math.sin(SUN.bearing) * Math.cos(SUN.elevation), Math.sin(SUN.elevation), -Math.cos(SUN.bearing) * Math.cos(SUN.elevation)];
const poolAt = (y: number): Vec3 => {
  const t = (OCULUS_CENTRE[1] - y) / sunVector[1];
  return r3(OCULUS_CENTRE[0] - sunVector[0] * t, y, OCULUS_CENTRE[2] - sunVector[2] * t);
};
const KEY_POSITION = r3(OCULUS_CENTRE[0] + sunVector[0] * SUN.distance, OCULUS_CENTRE[1] + sunVector[1] * SUN.distance, OCULUS_CENTRE[2] + sunVector[2] * SUN.distance);
const POOL_RELIEF = poolAt(DESKTOP_RELIEF.top);
/** The pool's radius on the relief plane; the cone reaches a little past it for the penumbra. */
const POOL_RADIUS = 3.55;
const KEY_DISTANCE = Math.hypot(KEY_POSITION[0] - POOL_RELIEF[0], KEY_POSITION[1] - POOL_RELIEF[1], KEY_POSITION[2] - POOL_RELIEF[2]);

const practical = (id: string, p: readonly number[], zone: ArchiveZone, medium: "dynamic" | "baked", dormant = false, height = LAMP_HEIGHT - 0.22): ArchiveLight => ({
  id, kind: "practical", position: r3(p[0], height > 0 ? p[1] + height : p[1], p[2]), color: "#ffb36b", intensity: dormant ? 0 : 1.6, range: 7.5, castsShadow: false,
  desktop: { low: dormant ? "omitted" : "baked", medium: dormant ? "omitted" : medium, high: dormant ? "omitted" : medium }, quest: dormant ? "omitted" : "baked", zone, dormant: dormant || undefined,
});

const LIGHTS: readonly ArchiveLight[] = [
  {
    id: "key-oculus", kind: "key", position: KEY_POSITION, target: POOL_RELIEF, color: "#fff1d6", intensity: 7.5, range: round(KEY_DISTANCE + 25),
    cone: { angle: round(Math.atan2(POOL_RADIUS * 1.12, KEY_DISTANCE), 6), penumbra: 0.32 }, castsShadow: true, cookie: "oculus-cookie",
    desktop: { low: "dynamic", medium: "dynamic", high: "dynamic" }, quest: "baked", zone: "chamber",
  },
  {
    id: "fill-sky", kind: "fill", position: OCULUS_CENTRE, color: "#c9d4e2", groundColor: "#4b3a29", intensity: 0.55, castsShadow: false,
    desktop: { low: "dynamic", medium: "dynamic", high: "dynamic" }, quest: "baked", zone: "chamber",
  },
  {
    id: "fill-bounce", kind: "fill", position: r3(POOL_RELIEF[0], 1.7, POOL_RELIEF[2]), color: "#ffcf96", intensity: 2.2, range: 15, castsShadow: false,
    desktop: { low: "baked", medium: "baked", high: "baked" }, quest: "baked", zone: "chamber",
  },
  practical("lamp-entrance-0", LAMPS.entrance[0], "entrance", "baked"),
  practical("lamp-entrance-1", LAMPS.entrance[1], "entrance", "baked"),
  practical("lamp-interregnum-0", LAMPS.interregnum[0], "interregnum", "dynamic"),
  practical("lamp-interregnum-1", LAMPS.interregnum[1], "interregnum", "dynamic"),
  practical("lamp-laws-0", LAMPS.laws[0], "laws", "dynamic"),
  practical("lamp-laws-1", LAMPS.laws[1], "laws", "dynamic"),
  practical("lamp-contested-0", LAMPS.contested[0], "contested", "baked", true),
  practical("lamp-contested-1", LAMPS.contested[1], "contested", "baked", true),
  ...SCONCES.map((p, index) => practical(`sconce-${index}`, p, "chamber", "baked", false, 0.12)),
  { id: "emissive-sky", kind: "emissive", position: r3(0, CROWN + 1.1, 0), color: "#fff6e6", intensity: 3.2, castsShadow: false, desktop: { low: "dynamic", medium: "dynamic", high: "dynamic" }, quest: "baked", zone: "chamber" },
  { id: "emissive-lamp-cores", kind: "emissive", position: [0, LAMP_HEIGHT, 0], color: "#ffbf73", intensity: 4, castsShadow: false, desktop: { low: "dynamic", medium: "dynamic", high: "dynamic" }, quest: "baked", zone: "chamber" },
];

const SHAFT_TOP = OCULUS_CENTRE, SHAFT_BOTTOM = poolAt(0);
const lightAxis = r3(-sunVector[0], -sunVector[1], -sunVector[2]);
const ATMOSPHERE: readonly AtmosphereVolume[] = [
  { id: "haze-chamber", kind: "haze", center: [0, 7, -1.5], size: [20.6, 16, 30], density: 0.032, color: "#b8a587" },
  {
    id: "shaft-oculus", kind: "shaft", center: r3((SHAFT_TOP[0] + SHAFT_BOTTOM[0]) / 2, (SHAFT_TOP[1] + SHAFT_BOTTOM[1]) / 2, (SHAFT_TOP[2] + SHAFT_BOTTOM[2]) / 2),
    size: r3(VAULT_SHAPE.oculusRadius * 2, Math.hypot(SHAFT_TOP[0] - SHAFT_BOTTOM[0], SHAFT_TOP[1] - SHAFT_BOTTOM[1], SHAFT_TOP[2] - SHAFT_BOTTOM[2]), VAULT_SHAPE.oculusRadius * 2),
    density: 0.42, axis: lightAxis, color: "#ffe6bd",
  },
  { id: "dust-shaft", kind: "dust", center: r3(poolAt(5.2)[0], 5.2, poolAt(5.2)[2]), size: [5.6, 8, 5.6], density: 1.4, axis: lightAxis, color: "#ffe2b0" },
];

// ---------------------------------------------------------------------------
// Interaction zones and expansion points

const ZONES: readonly InteractionZone[] = [
  ...EXHIBITS.map((exhibit): InteractionZone => ({ id: `pick-${exhibit.collection}`, kind: "pick", center: exhibit.pick.center, radius: exhibit.pick.radius })),
  ...VANTAGES.map((vantage): InteractionZone => ({ id: `reach-${vantage.posture}`, kind: "reach", center: r3(0, vantage.eyeHeight - 0.25, STATION_Z - 0.3), radius: 0.75 })),
  ...VANTAGES.map((vantage): InteractionZone => ({ id: `ray-${vantage.posture}`, kind: "ray", center: r3(0, vantage.eyeHeight, STATION_Z), radius: 20 })),
  ...VANTAGES.map((vantage): InteractionZone => ({ id: `control-${vantage.posture}`, kind: "control", center: vantage.controlSurface.position, radius: round(vantage.controlSurface.width / 2) })),
  ...VIEWPOINTS_DESKTOP.map((view): InteractionZone => ({ id: `clearance-${view.id}`, kind: "camera-clearance", center: view.eye, radius: 0.3 })),
];

const nicheAt = (vertex: number): Vec3 => r3(...atBearing([0, 0], vertexBearing(vertex), PIER_RADIUS - PIER.inner, 1.85));
const EXPANSION: readonly ExpansionPoint[] = [
  { id: "expansion-war-record", position: nicheAt(1), yaw: round(facingCentre(vertexBearing(1))), size: [1.1, 2.5, 0.42], reservedFor: "war-record" },
  { id: "expansion-collection", position: nicheAt(6), yaw: round(facingCentre(vertexBearing(6))), size: [1.1, 2.5, 0.42], reservedFor: "collection" },
];

// ---------------------------------------------------------------------------
// Notes for the generated document (design language and intent, never lore)

const NOTES = [
  { topic: "Composition", text: "One octagonal chamber with a strong vertical axis. Eight massive piers carry stilted pointed arches; engaged shafts rise from their inner faces through a gallery level into the eight ribs of a vault that converges on a high oculus. The monument lies on the floor under it, the three rings hang between them, and the light falls through the oculus across the relief. The first settled frame, from inside the entrance arch, holds all three." },
  { topic: "Bays", text: "The three bays open to the north-west, north and north-east, inside the comfort cone of the stationary viewer at the monument's south edge. The entrance vestibule lies to the south, behind that viewer, and descends seven steps, so the desktop camera rises into the light. The east, west, south-east and south-west sides are shallow blind recesses carrying abstract astronomical roundels." },
  { topic: "Light", text: "A single high key falls almost vertically through the oculus. Its pierced screen breaks the outer band of the pool into dappled light while the open centre covers the monument broadly; nothing is aimed at the map's centre. Warm lamps in the bays answer the cool high light, and the bays stay darker than the pool so the monument leads." },
  { topic: "Materials", text: "Warm limestone ashlar for the structure, dark polished floor stone worn along the paths, basalt for the plinth, voussoir bands and steps, and patinated bronze for the rings, rods, frame and dial. Ornament is abstract and astronomical: graduations, concentric bands, star-pierced tracery, and a coffered vault whose coffers diminish toward the oculus, each holding a small bronze star boss. No inscriptions, names, emblems, heraldry or narrative scenes, and shelving is never the motif." },
  { topic: "Canon", text: "Nothing marks the map centre: no element stands within 0.4 m of the vertical line above it up to the vault springing, and the rings are held at their rims. The oculus shows only sky and light. Where the archive is, who made it and why the visitor may enter stay unstated." },
  { topic: "Expansion", text: "Two empty niches in the piers flanking the outer bays stay visibly unoccupied: the east one is reserved for exhibits fed by the War Record, the west one for a future collection." },
];

// ---------------------------------------------------------------------------

/** Plain numbers the kernel builders need, shared so the blueprint and the geometry never disagree. */
export const ARCHIVE_GEOMETRY = deepFreeze({
  sides: SIDES,
  pierRadius: PIER_RADIUS,
  apothem: round(APOTHEM, 6),
  sideLength: round(SIDE_LENGTH, 6),
  span: round(SPAN, 6),
  pier: { ...PIER },
  levels: { ...LEVEL, arcadeCrown: round(LEVEL.springing + ARCH_RISE, 6), crown: round(CROWN, 6), landing: LANDING_Y },
  arch: { ...ARCH, radius: round(ARCH_RADIUS, 6), rise: round(ARCH_RISE, 6), stilt: round(LEVEL.springing - LEVEL.impost, 6) },
  vault: { ...VAULT_SHAPE },
  entrance: { ...ENTRANCE },
  sidePlan: SIDE_PLAN.map((plan, side) => ({ side, bearing: round(sideBearing(side), 6), kind: plan.kind, depth: plan.depth, zone: plan.zone })),
  desktopRelief: { ...DESKTOP_RELIEF },
  questRelief: { width: QUEST_RELIEF.width, top: { ...QUEST_RELIEF.top }, near: QUEST_RELIEF.near, center: r3(0, 0, QUEST_CENTER_Z) },
  plinth: { margin: 0.42, step: STEP_OUT, stepHeight: 0.14 },
  sun: { elevation: SUN.elevation, bearing: SUN.bearing, vector: r3(...sunVector), poolRadius: POOL_RADIUS },
  lampHeight: LAMP_HEIGHT,
});

/** Builds the blueprint; pure and deterministic, so two calls are deeply equal. */
export function createArchiveBlueprint(): ArchiveBlueprint {
  const levels = [
    { id: "landing", y: LANDING_Y },
    { id: "floor", y: LEVEL.floor },
    { id: "impost", y: LEVEL.impost },
    { id: "arch-springing", y: LEVEL.springing },
    { id: "arcade-crown", y: round(LEVEL.springing + ARCH_RISE) },
    { id: "string-course", y: LEVEL.string },
    { id: "gallery", y: LEVEL.gallery },
    { id: "cornice", y: LEVEL.cornice },
    { id: "vault-springing", y: LEVEL.vault },
    { id: "oculus", y: round(CROWN) },
  ];
  return deepFreeze(JSON.parse(JSON.stringify({
    schema: 1,
    chamber: {
      footprint: footprint(),
      floorY: LEVEL.floor,
      springingY: LEVEL.vault,
      crownY: round(CROWN),
      oculus: {
        center: OCULUS_CENTRE,
        radius: VAULT_SHAPE.oculusRadius,
        tracery: { open: 0.46, band: [0.7, 1], bars: 16, barWidth: 0.035, holes: 96, holeRadius: 0.034, seed: 1931 },
      },
      octagon: { sides: SIDES, pierRadius: PIER_RADIUS, apothem: round(APOTHEM), pierWidth: PIER.width, pierDepth: PIER.inner + PIER.outer, span: round(SPAN) },
      levels,
      sides: SIDE_PLAN.map((plan, side) => ({ side, bearing: round(sideBearing(side)), kind: plan.kind, depth: plan.depth, width: round(SPAN), zone: plan.zone })),
    },
    elements: ELEMENTS,
    monument: {
      center: [0, 0, 0],
      yaw: 0,
      desktop: { reliefWidth: DESKTOP_RELIEF.width, reliefTop: DESKTOP_RELIEF.top },
      quest: { reliefWidth: QUEST_RELIEF.width, reliefTop: { ...QUEST_RELIEF.top }, center: r3(0, 0, QUEST_CENTER_Z) },
      plinth: { builder: "plinth", margin: 0.42, step: STEP_OUT, stepHeight: 0.14 },
      frame: { band: 0.06, rise: 0.012 },
    },
    mechanism: { rings: RINGS },
    exhibits: EXHIBITS,
    artifacts: ARTIFACTS,
    viewpoints: { desktop: VIEWPOINTS_DESKTOP, quest: VANTAGES },
    lights: LIGHTS,
    atmosphere: ATMOSPHERE,
    zones: ZONES,
    paths: PATHS,
    expansion: EXPANSION,
    occluders: OCCLUDERS,
    budgets: {
      quest: { drawCalls: 120, triangles: 250000, textureMB: 64 },
      low: { drawCalls: 120, triangles: 300000, textureMB: 96 },
      medium: { drawCalls: 250, triangles: 1000000, textureMB: 192 },
      high: { drawCalls: 400, triangles: 1500000, textureMB: 320 },
    },
    notes: NOTES,
  })) as ArchiveBlueprint);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

/** The archive blueprint both platforms build from. */
export const ARCHIVE_BLUEPRINT: ArchiveBlueprint = createArchiveBlueprint();

/** The viewpoint with an id, or undefined. */
export function getArchiveViewpoint(id: string): DesktopViewpoint | undefined {
  return ARCHIVE_BLUEPRINT.viewpoints.desktop.find((view) => view.id === id);
}

/** The Quest vantage for a posture. */
export function getArchiveVantage(posture: "seated" | "standing"): QuestVantage {
  return ARCHIVE_BLUEPRINT.viewpoints.quest.find((vantage) => vantage.posture === posture)!;
}

/** Sea level of a platform's relief in archive metres; relief space y = 0 sits here. */
export function monumentSeaLevel(platform: "desktop" | "quest", posture: "seated" | "standing" = "seated"): number {
  const monument = ARCHIVE_BLUEPRINT.monument;
  return platform === "desktop"
    ? seaLevel(monument.desktop.reliefWidth, monument.desktop.reliefTop)
    : seaLevel(monument.quest.reliefWidth, monument.quest.reliefTop[posture]);
}
