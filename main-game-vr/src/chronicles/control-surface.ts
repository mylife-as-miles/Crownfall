// The menu panel's pose while the archive is open (WORK_STATUS D6): the
// blueprint's control surface beside the monument, in the frame of the last
// recentred head pose. Pure numbers only, so Node tests check the same values
// the runtime applies.
//
// The blueprint sizes its control surface for a 0.86 m panel, at which the
// 1280-unit menu grid shows 16-unit text at about 0.62 degrees (see
// docs/chronicles/ARCHIVE_BLUEPRINT.md). The panel therefore keeps the
// blueprint's position and yaw but takes the scale at which 16-unit text
// subtends at least 1.0 degree, and never less than the scale that keeps the
// menu's own targets at their current angular size. That larger panel is
// lifted just enough to keep every drawn part of the Chronicles view clear of
// the monument's outline; the lifts are data, and quest-state.test.ts checks
// them against the blueprint monument.
import { ARCHIVE_BLUEPRINT, getArchiveVantage } from '../../../shared/chronicles/archive/blueprint';
import { RELIEF_ASPECT } from '../../../shared/chronicles/archive/relief';
import type { Vec3 } from '../../../shared/chronicles/archive/types';
import { QUEST_CHRONICLE_EXTENT, QUEST_UI_LAYOUT } from '../ui-contract.js';

const getArchiveMonument = () => ARCHIVE_BLUEPRINT.monument;

export type ChroniclesPosture = 'seated' | 'standing';
export type ChroniclesTextScale = 100 | 125 | 150;

export const CHRONICLES_PANEL = {
  /** One UIKit unit is a centimetre at scale 1. */
  unit: 0.01,
  /** The smallest body-text class shown in the Chronicles view, in UIKit units. */
  bodyUnits: 16,
  /** The record body, in UIKit units. */
  recordBodyUnits: 18,
  /** Readability floor for body text, in degrees. */
  bodyDegrees: 1.0,
  /** The menu pose the targets keep their angular size against: the default distance. */
  menuDistance: 1.5,
} as const;

/** Lift in metres above the blueprint's control-surface height, per posture and text scale. */
export const CHRONICLES_PANEL_LIFT: Readonly<Record<ChroniclesPosture, Readonly<Record<ChroniclesTextScale, number>>>> = Object.freeze({
  seated: Object.freeze({ 100: 0.07, 125: 0.15, 150: 0.25 }),
  standing: Object.freeze({ 100: 0.01, 125: 0.06, 150: 0.16 }),
});

export interface ChroniclesPanelPose {
  /** Panel centre relative to the recentred eye, in its yawed frame: +X right, +Y up, -Z forward. */
  position: Vec3;
  /** Rotation about +Y that turns the panel's face toward the eye. */
  yaw: number;
  /** Tilt back from upright (the blueprint's pitch). */
  pitch: number;
  scale: number;
  /** Panel width in metres. */
  width: number;
  lift: number;
  /** Distance from the nominal eye to the panel centre, in metres. */
  distance: number;
}

/** Degrees subtended by `units` of panel at `scale`, seen from `distance` metres. */
export function panelDegrees(units: number, scale: number, distance: number): number {
  return (2 * Math.atan((units * scale * CHRONICLES_PANEL.unit) / 2 / distance) * 180) / Math.PI;
}

/** The panel's pose and scale on the control surface for a posture and text scale. */
export function chroniclesPanelPose(posture: ChroniclesPosture, textScale: ChroniclesTextScale): ChroniclesPanelPose {
  const vantage = getArchiveVantage(posture), surface = vantage.controlSurface;
  const eye: Vec3 = [vantage.floor[0], vantage.floor[1] + vantage.eyeHeight, vantage.floor[2]];
  const lift = CHRONICLES_PANEL_LIFT[posture][textScale];
  const dx = surface.position[0] - eye[0], dy = surface.position[1] - eye[1], dz = surface.position[2] - eye[2];
  const distance = Math.hypot(dx, dy, dz);
  // The scale at which `bodyUnits` subtend the floor, and the scale that keeps
  // the menu's targets at their current angular size at this distance.
  const readable = (2 * distance * Math.tan(((CHRONICLES_PANEL.bodyDegrees / 2) * Math.PI) / 180)) / (CHRONICLES_PANEL.bodyUnits * CHRONICLES_PANEL.unit);
  const targets = (QUEST_UI_LAYOUT.authoredScale * distance) / CHRONICLES_PANEL.menuDistance;
  const scale = Math.max(readable, targets) * (textScale / 100);
  return {
    position: [dx, dy + lift, dz], yaw: surface.yaw, pitch: surface.pitch, scale,
    width: QUEST_UI_LAYOUT.width * scale * CHRONICLES_PANEL.unit, lift, distance,
  };
}

/**
 * The drawn parts of the Chronicles view as panel-space corners in metres at a
 * pose (x right and y up from the panel centre), for clearance checks.
 */
export function chroniclesPanelRegions(pose: ChroniclesPanelPose): readonly (readonly [x: number, y: number])[][] {
  const metres = pose.scale * CHRONICLES_PANEL.unit, cx = QUEST_UI_LAYOUT.width / 2, cy = QUEST_UI_LAYOUT.height / 2;
  return QUEST_CHRONICLE_EXTENT.map(({ x, y, width, height }) => [
    [(x - cx) * metres, (cy - y) * metres], [(x + width - cx) * metres, (cy - y) * metres],
    [(x + width - cx) * metres, (cy - y - height) * metres], [(x - cx) * metres, (cy - y - height) * metres],
  ]);
}

type Angles = readonly [bearing: number, elevation: number];

/** Bearing (clockwise from forward) and elevation of a point seen from an eye, in radians. */
function look(eye: Vec3, point: Vec3): Angles {
  const dx = point[0] - eye[0], dy = point[1] - eye[1], dz = point[2] - eye[2];
  return [Math.atan2(dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
}

function hull(points: readonly Angles[]): Angles[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Angles, a: Angles, b: Angles) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list: Angles[]) => {
    const out: Angles[] = [];
    for (const point of list) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) out.pop(); out.push(point); }
    return out.slice(0, -1);
  };
  return build(sorted).concat(build(sorted.slice().reverse()));
}

function contains(polygon: readonly Angles[], point: Angles): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Smallest angular distance between two convex outlines, in degrees; negative when they overlap. */
function angularGap(a: readonly Angles[], b: readonly Angles[]): number {
  const edges = (polygon: readonly Angles[]) => polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]] as const);
  const distance = (p: Angles, [a0, a1]: readonly [Angles, Angles]) => {
    const dx = a1[0] - a0[0], dy = a1[1] - a0[1], t = Math.max(0, Math.min(1, ((p[0] - a0[0]) * dx + (p[1] - a0[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a0[0] - t * dx, p[1] - a0[1] - t * dy);
  };
  const crosses = ([p0, p1]: readonly [Angles, Angles], [q0, q1]: readonly [Angles, Angles]) => {
    const side = (o: Angles, s: Angles, p: Angles) => Math.sign((s[0] - o[0]) * (p[1] - o[1]) - (s[1] - o[1]) * (p[0] - o[0]));
    return side(p0, p1, q0) !== side(p0, p1, q1) && side(q0, q1, p0) !== side(q0, q1, p1);
  };
  if (a.some((point) => contains(b, point)) || b.some((point) => contains(a, point))) return -1;
  if (edges(a).some((edge) => edges(b).some((other) => crosses(edge, other)))) return -1;
  let best = Infinity;
  for (const point of a) for (const edge of edges(b)) best = Math.min(best, distance(point, edge));
  for (const point of b) for (const edge of edges(a)) best = Math.min(best, distance(point, edge));
  return (best * 180) / Math.PI;
}

export interface ControlSurfaceCheck {
  /** Clearance in degrees between the drawn Chronicles view and the Quest monument's outline, upright and tilted back 20 degrees. */
  upright: number;
  tilted: number;
  /** Highest drawn point above the eye line and furthest bearing off forward, in degrees. */
  top: number;
  bearing: number;
}

/**
 * The blueprint's clearance rule for the control surface (the monument's
 * projected outline from the nominal eye, at 0 and -20 degrees of panel pitch),
 * applied to the panel as Chronicles draws it. `peak` is the Quest relief's
 * highest terrain in metres, which the caller computes from the shared relief.
 */
export function controlSurfaceCheck(posture: ChroniclesPosture, textScale: ChroniclesTextScale, peak: number, liftOverride?: number): ControlSurfaceCheck {
  const blueprintVantage = getArchiveVantage(posture), monument = getArchiveMonument();
  const eye: Vec3 = [blueprintVantage.floor[0], blueprintVantage.floor[1] + blueprintVantage.eyeHeight, blueprintVantage.floor[2]];
  const width = monument.quest.reliefWidth, depth = width * RELIEF_ASPECT, centre = monument.quest.center, top = monument.quest.reliefTop[posture];
  const margin = monument.plinth.margin * (width / monument.desktop.reliefWidth) + 0.04;
  const outline: Angles[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    outline.push(look(eye, [centre[0] + sx * (width / 2 + margin), 0, centre[2] + sz * (depth / 2 + margin)]));
    outline.push(look(eye, [centre[0] + sx * (width / 2 + margin), top, centre[2] + sz * (depth / 2 + margin)]));
    outline.push(look(eye, [centre[0] + (sx * width) / 2, top + peak, centre[2] + (sz * depth) / 2]));
  }
  const monumentHull = hull(outline);
  const pose = chroniclesPanelPose(posture, textScale);
  const lift = liftOverride === undefined ? pose.lift : liftOverride;
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  let highest = -Infinity, furthest = 0;
  const gapAt = (pitch: number) => {
    let gap = Infinity;
    for (const region of chroniclesPanelRegions(pose)) {
      const corners = region.map(([x, y]): Angles => {
        const ly = y * Math.cos(pitch), lz = y * Math.sin(pitch);
        const point: Vec3 = [eye[0] + pose.position[0] + x * c + lz * s, eye[1] + pose.position[1] - pose.lift + lift + ly, eye[2] + pose.position[2] - x * s + lz * c];
        const angles = look(eye, point);
        highest = Math.max(highest, (angles[1] * 180) / Math.PI);
        furthest = Math.max(furthest, Math.abs((angles[0] * 180) / Math.PI));
        return angles;
      });
      gap = Math.min(gap, angularGap(hull(corners), monumentHull));
    }
    return gap;
  };
  const upright = gapAt(pose.pitch), tilted = gapAt(pose.pitch - (20 * Math.PI) / 180);
  return { upright, tilted, top: highest, bearing: furthest };
}
