// Pure analysis of the archive blueprint: clearances, framing sweeps, the
// overview's composition, the Quest comfort checks, the light pool's coverage
// and the canon distances. The blueprint tests assert on these numbers and the
// document generator prints them, so both always agree.

import { ARCHIVE_GEOMETRY as G } from "./blueprint";
import { buildReliefMesh, RELIEF_ASPECT, RELIEF_MARKER } from "./relief";
import {
  bearingOf, cameraFrame, convexHull, convexPolygonsOverlap, DEG, distanceToOccluder, distanceToPolygonEdge, distanceToRing, insideFrame, lookAngles,
  orbitEye, pointInPolygon, ringPoint, sweepHitsOccluder, wrapAngle,
} from "./space";
import type { ArchiveBlueprint, DesktopFraming, DesktopViewpoint, ExhibitDefinition, QuestVantage, Vec3 } from "./types";

/** Height of the arcade and bay intrados above the arch springing at offset `s` from the arch's centre line; NaN beyond the jambs. */
export function intradosHeight(s: number): number {
  const a = Math.abs(s);
  if (a > G.span / 2) return NaN;
  const centre = G.span / 2 - G.arch.radius;
  return Math.sqrt(Math.max(0, G.arch.radius * G.arch.radius - (a - centre) ** 2));
}

/** A plan point in a side's frame: `s` along the side toward increasing bearing, `d` outward from the arcade plane. */
export function sideFrame(side: number, x: number, z: number): { s: number; d: number } {
  const b = side * ((Math.PI * 2) / G.sides);
  const cx = Math.sin(b) * G.apothem, cz = -Math.cos(b) * G.apothem;
  const dx = x - cx, dz = z - cz;
  return { s: dx * Math.cos(b) + dz * Math.sin(b), d: dx * Math.sin(b) - dz * Math.cos(b) };
}

/** The octagon side whose sector holds a plan point. */
export function sectorOf(x: number, z: number): number {
  const step = (Math.PI * 2) / G.sides;
  return ((Math.round(bearingOf(x, z) / step) % G.sides) + G.sides) % G.sides;
}

/** Floor height under a plan point: the vestibule steps down to its landing, everything else is level. */
export function floorAt(x: number, z: number): number {
  const side = sectorOf(x, z);
  const { d } = sideFrame(side, x, z);
  if (G.sidePlan[side].kind !== "entrance" || d <= G.entrance.start) return 0;
  const step = Math.min(G.entrance.steps, Math.ceil((d - G.entrance.start) / G.entrance.run));
  return -step * G.entrance.rise;
}

/** Height of the solid overhead: an arch or bay intrados, the gallery balcony near the walls, or the vault springing. */
export function ceilingAt(x: number, z: number): number {
  const side = sectorOf(x, z);
  const { s, d } = sideFrame(side, x, z);
  const arch = G.levels.springing + intradosHeight(s);
  if (d > -G.arch.wallInner - 0.05) return Number.isFinite(arch) ? arch : G.levels.impost;
  return d > -G.arch.wallInner - 1.05 ? G.levels.gallery - 0.35 : G.levels.vault;
}

/**
 * Clearance from a point to the solids the blueprint describes (occluder
 * volumes, walls, floor, ceilings, ring bands and rods); -1 outside the footprint.
 */
export function clearance(blueprint: ArchiveBlueprint, point: Vec3, ignore: readonly string[] = []): number {
  if (!pointInPolygon(point[0], point[2], blueprint.chamber.footprint)) return -1;
  let best = distanceToPolygonEdge(point[0], point[2], blueprint.chamber.footprint);
  for (const volume of blueprint.occluders) if (!ignore.includes(volume.id)) best = Math.min(best, distanceToOccluder(volume, point));
  best = Math.min(best, point[1] - floorAt(point[0], point[2]), ceilingAt(point[0], point[2]) - point[1]);
  for (const ring of blueprint.mechanism.rings) {
    best = Math.min(best, distanceToRing(ring, point));
    for (const rod of ring.suspension) {
      const rim = ringPoint(ring, rod.angle);
      if (point[1] >= rim[1] && point[1] <= rod.anchor[1]) best = Math.min(best, Math.hypot(point[0] - rim[0], point[2] - rim[2]) - 0.03);
    }
  }
  return best;
}

/** The exhibit a desktop viewpoint frames: its collection's, or the Atlas for the entrance, overview and nations. */
export function framingSubject(blueprint: ArchiveBlueprint, viewId: string): ExhibitDefinition {
  const collection = viewId.startsWith("collection:") || viewId.startsWith("review:") ? viewId.split(":")[1] : "atlas";
  return blueprint.exhibits.find((exhibit) => exhibit.collection === collection)!;
}

/** Occluder volumes that belong to the exhibit itself. */
export function subjectVolumes(blueprint: ArchiveBlueprint, exhibit: ExhibitDefinition): string[] {
  const ids = exhibit.artifactIds.map((id) => blueprint.artifacts.find((artifact) => artifact.id === id)?.occluder).filter((id): id is string => !!id);
  if (exhibit.collection === "atlas") ids.push("monument-desktop");
  return ids;
}

/** Eyes over a framing's orbit, tilt and zoom range on a regular grid. */
export function framingSamples(framing: DesktopFraming, yaws = 5, pitches = 5, zooms = 3): Vec3[] {
  const eyes: Vec3[] = [];
  const at = (range: readonly [number, number], index: number, count: number) => range[0] + ((range[1] - range[0]) * index) / (count - 1);
  for (let y = 0; y < yaws; y++) for (let p = 0; p < pitches; p++) for (let z = 0; z < zooms; z++) {
    const eye = orbitEye(framing, at(framing.limits.yaw, y, yaws), at(framing.limits.pitch, p, pitches), at(framing.limits.zoom, z, zooms));
    eyes.push([eye[0], eye[1], eye[2]]);
  }
  return eyes;
}

export interface FramingSweep {
  viewId: string;
  subject: string;
  samples: number;
  /** Occluders a sphere of `radius` swept from the subject to a sampled eye touches. */
  hits: string[];
  /** The smallest clearance of any sampled eye from solid geometry (the subject's own volumes excepted). */
  minClearance: number;
  radius: number;
}

/** Sweeps a viewpoint's sampled eyes against the occluders, from the framing target and from the exhibit's centre. */
export function sweepFraming(blueprint: ArchiveBlueprint, view: DesktopViewpoint, radius = 0.25): FramingSweep {
  const subject = framingSubject(blueprint, view.id), own = subjectVolumes(blueprint, subject);
  const eyes = framingSamples(view);
  const hits = new Set<string>();
  let minClearance = Infinity;
  for (const eye of eyes) {
    minClearance = Math.min(minClearance, clearance(blueprint, eye, own));
    for (const volume of blueprint.occluders) {
      if (own.includes(volume.id)) continue;
      if (sweepHitsOccluder(volume, view.target, eye, radius) || sweepHitsOccluder(volume, subject.pick.center, eye, radius)) hits.add(volume.id);
    }
  }
  return { viewId: view.id, subject: subject.id, samples: eyes.length, hits: [...hits].sort(), minClearance, radius };
}

export interface Composition {
  monumentInside: boolean;
  ringShare: number;
  shaftInside: boolean;
  /** The highest ring point: the shaft is checked from the relief up to here. */
  ringTop: number;
}

/** What the overview holds at 16:9: the monument's bounds, the share of ring-band samples, and the light shaft from the relief up through the ring band. */
export function overviewComposition(blueprint: ArchiveBlueprint, aspect = 16 / 9): Composition {
  const overview = blueprint.viewpoints.desktop.find((view) => view.id === "overview")!;
  const frame = cameraFrame(overview.eye, overview.target, overview.fov, aspect);
  const monument = blueprint.occluders.find((volume) => volume.id === "monument-desktop")!;
  let monumentInside = true;
  for (let corner = 0; corner < 8; corner++) {
    monumentInside = monumentInside && insideFrame(frame, [
      monument.center[0] + (corner & 1 ? 0.5 : -0.5) * monument.size[0],
      monument.center[1] + (corner & 2 ? 0.5 : -0.5) * monument.size[1],
      monument.center[2] + (corner & 4 ? 0.5 : -0.5) * monument.size[2],
    ]);
  }
  let total = 0, inside = 0, ringTop = -Infinity;
  for (const ring of blueprint.mechanism.rings) {
    for (let index = 0; index < 96; index++) {
      const point = ringPoint(ring, (index / 96) * Math.PI * 2);
      total++;
      if (insideFrame(frame, [point[0], point[1], point[2]])) inside++;
      ringTop = Math.max(ringTop, point[1]);
    }
  }
  const shaft = blueprint.atmosphere.find((volume) => volume.kind === "shaft")!, axis = shaft.axis!, length = shaft.size[1];
  const top: Vec3 = [shaft.center[0] - (axis[0] * length) / 2, shaft.center[1] - (axis[1] * length) / 2, shaft.center[2] - (axis[2] * length) / 2];
  let shaftInside = true;
  for (let index = 0; index <= 24; index++) {
    const t = index / 24;
    const point: Vec3 = [top[0] + axis[0] * length * t, top[1] + axis[1] * length * t, top[2] + axis[2] * length * t];
    if (point[1] > ringTop || point[1] < blueprint.monument.desktop.reliefTop) continue;
    shaftInside = shaftInside && insideFrame(frame, point);
  }
  return { monumentInside, ringShare: inside / total, shaftInside, ringTop };
}

export const questEye = (vantage: QuestVantage): Vec3 => [vantage.floor[0], vantage.floor[1] + vantage.eyeHeight, vantage.floor[2]];

export interface QuestCheck {
  posture: "seated" | "standing";
  eye: Vec3;
  reliefTop: number;
  /** Degrees below the eye of the relief's far rim, and metres ahead of its near rim. */
  farEdge: number;
  nearEdge: number;
  /** Degrees off forward of each exhibit's anchor (the Quest monument for the Atlas). */
  exhibits: Record<string, number>;
  /** Event-band ranges over every ring: degrees above the eye line and off forward. */
  eventBand: { minElevation: number; maxElevation: number; maxOff: number };
  /** Angular clearance in degrees between the control surface and the monument's outline, at 0 and -20 degrees of panel pitch. */
  controlGap: { upright: number; tilted: number };
  /** Degrees subtended by a 16-unit line of body text on the control surface's 1280-unit design grid. */
  bodyText: number;
  markerSize: number;
  highestTerrain: number;
}

const reliefCache = new Map<number, number>();
function reliefPeak(width: number): number {
  if (!reliefCache.has(width)) reliefCache.set(width, buildReliefMesh(width, 64).maxHeight);
  return reliefCache.get(width)!;
}

/** The control surface's corners for a panel pitch, in archive space. */
export function controlSurfaceCorners(vantage: QuestVantage, pitch: number): Vec3[] {
  const panel = vantage.controlSurface, height = (panel.width * 720) / 1280;
  const c = Math.cos(panel.yaw), s = Math.sin(panel.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([px, py]): Vec3 => {
    const lx = (px * panel.width) / 2, ly0 = (py * height) / 2;
    const ly = ly0 * Math.cos(pitch), lz = ly0 * Math.sin(pitch);
    return [panel.position[0] + lx * c + lz * s, panel.position[1] + ly, panel.position[2] - lx * s + lz * c];
  });
}

/** Angular gap (radians) between two convex outlines; negative when they overlap. */
function angularGap(a: [number, number][], b: [number, number][]): number {
  if (convexPolygonsOverlap(a, b, 0)) return -1;
  let lo = 0, hi = Math.PI / 2;
  for (let step = 0; step < 30; step++) {
    const mid = (lo + hi) / 2;
    if (convexPolygonsOverlap(a, b, mid)) hi = mid;
    else lo = mid;
  }
  return lo;
}

export function questCheck(blueprint: ArchiveBlueprint, posture: "seated" | "standing"): QuestCheck {
  const vantage = blueprint.viewpoints.quest.find((item) => item.posture === posture)!;
  const eye = questEye(vantage), forward = -vantage.forwardYaw;
  const width = blueprint.monument.quest.reliefWidth, depth = width * RELIEF_ASPECT, centre = blueprint.monument.quest.center;
  const top = blueprint.monument.quest.reliefTop[posture], peak = reliefPeak(width);
  const exhibits: Record<string, number> = {};
  for (const exhibit of blueprint.exhibits) {
    const anchor: Vec3 = exhibit.collection === "atlas" ? [centre[0], top, centre[2]] : exhibit.anchor;
    exhibits[exhibit.collection] = Math.abs(wrapAngle(lookAngles(eye, anchor).bearing - forward)) / DEG;
  }
  let minElevation = Infinity, maxElevation = -Infinity, maxOff = 0;
  for (const ring of blueprint.mechanism.rings) {
    const [from, to] = ring.eventBand;
    for (let index = 0; index <= 24; index++) {
      const point = ringPoint(ring, from + ((to - from) * index) / 24);
      const look = lookAngles(eye, [point[0], point[1], point[2]]);
      minElevation = Math.min(minElevation, look.elevation / DEG);
      maxElevation = Math.max(maxElevation, look.elevation / DEG);
      maxOff = Math.max(maxOff, Math.abs(wrapAngle(look.bearing - forward)) / DEG);
    }
  }
  const margin = blueprint.monument.plinth.margin * (width / blueprint.monument.desktop.reliefWidth) + 0.04;
  const outline: [number, number][] = [];
  const add = (x: number, y: number, z: number) => { const look = lookAngles(eye, [x, y, z]); outline.push([look.bearing, look.elevation]); };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(centre[0] + sx * (width / 2 + margin), 0, centre[2] + sz * (depth / 2 + margin));
    add(centre[0] + sx * (width / 2 + margin), top, centre[2] + sz * (depth / 2 + margin));
    add(centre[0] + (sx * width) / 2, top + peak, centre[2] + (sz * depth) / 2);
  }
  const hull = convexHull(outline);
  const gapAt = (pitch: number) => {
    const corners = controlSurfaceCorners(vantage, pitch).map((point) => { const look = lookAngles(eye, point); return [look.bearing, look.elevation] as [number, number]; });
    return angularGap(hull, convexHull(corners)) / DEG;
  };
  const panel = vantage.controlSurface;
  const distance = Math.hypot(panel.position[0] - eye[0], panel.position[1] - eye[1], panel.position[2] - eye[2]);
  return {
    posture, eye, reliefTop: top,
    farEdge: Math.atan2(eye[1] - top, eye[2] - (centre[2] - depth / 2)) / DEG,
    nearEdge: eye[2] - (centre[2] + depth / 2),
    exhibits,
    eventBand: { minElevation, maxElevation, maxOff },
    controlGap: { upright: gapAt(0), tilted: gapAt(-20 * DEG) },
    bodyText: (2 * Math.atan((16 * panel.width) / 1280 / 2 / distance)) / DEG,
    markerSize: RELIEF_MARKER.ring * 2 * width,
    highestTerrain: top + peak,
  };
}

/** Share of each relief's area inside the key light's fully lit cone (its penumbra's inner half). */
export function poolCoverage(blueprint: ArchiveBlueprint): { desktop: number; quest: number } {
  const key = blueprint.lights.find((light) => light.kind === "key")!;
  const p = key.position, t = key.target!, cone = key.cone!;
  const dir = [t[0] - p[0], t[1] - p[1], t[2] - p[2]], length = Math.hypot(dir[0], dir[1], dir[2]);
  const covered = (width: number, depth: number, cx: number, cz: number, y: number) => {
    let inside = 0, total = 0;
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const x = cx + (i / 20 - 0.5) * width, z = cz + (j / 20 - 0.5) * depth;
      const v = [x - p[0], y - p[1], z - p[2]], lv = Math.hypot(v[0], v[1], v[2]);
      const angle = Math.acos(Math.min(1, (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / (lv * length)));
      total++;
      if (angle <= cone.angle * (1 - cone.penumbra * 0.5)) inside++;
    }
    return inside / total;
  };
  const m = blueprint.monument;
  return {
    desktop: covered(m.desktop.reliefWidth, m.desktop.reliefWidth * RELIEF_ASPECT, m.center[0], m.center[2], m.desktop.reliefTop),
    quest: covered(m.quest.reliefWidth, m.quest.reliefWidth * RELIEF_ASPECT, m.quest.center[0], m.quest.center[2], m.quest.reliefTop.seated),
  };
}

/** The nearest approach of rings, rods and occluders to the vertical line above each map centre, between its relief and the vault springing. */
export function canonClearance(blueprint: ArchiveBlueprint): { desktop: number; quest: number } {
  const m = blueprint.monument;
  const measure = (cx: number, cz: number, top: number) => {
    let best = Infinity;
    for (const ring of blueprint.mechanism.rings) {
      for (let index = 0; index < 360; index++) {
        const point = ringPoint(ring, (index / 360) * Math.PI * 2);
        if (point[1] < top || point[1] > blueprint.chamber.springingY) continue;
        best = Math.min(best, Math.hypot(point[0] - cx, point[2] - cz) - Math.max(ring.section.width, ring.section.thickness) / 2);
      }
      for (const rod of ring.suspension) best = Math.min(best, Math.hypot(rod.anchor[0] - cx, rod.anchor[2] - cz) - 0.03);
    }
    for (const volume of blueprint.occluders) {
      if (volume.id === "monument-desktop") continue;
      best = Math.min(best, distanceToOccluder(volume, [cx, Math.max(top, Math.min(blueprint.chamber.springingY, volume.center[1])), cz]));
    }
    return best;
  };
  return { desktop: measure(m.center[0], m.center[2], m.desktop.reliefTop), quest: measure(m.quest.center[0], m.quest.center[2], m.quest.reliefTop.standing) };
}
