// Quest staging: the height envelope of the miniature (in the authored viewer frame),
// comfortable panel anchors that clear it, and the QuestStagingInfo numbers published
// to gameplay. Pure TypeScript; the Quest worker solves the anchors once per build.
//
// Panel placement follows the gameplay Quest experience: a panel at anchor-space point p
// is turned to face the eyes (yaw atan2(-x, -z), pitch atan2(y, |xz|)); larger text grows
// the primary panel upward from a fixed bottom edge and the dock downward from a fixed top.

import type { LandmarkId } from "../../types";
import type { MiniatureFrame, VrPosture } from "./frame";
import { blueprintToAnchor } from "./frame";

type Vec3 = [number, number, number];

/** Max blueprint height per cell of the miniature, in the viewer frame it was prepared for. */
export interface HeightEnvelope {
  u0: number;
  v0: number;
  cell: number;
  cols: number;
  rows: number;
  /** Max blueprint y per cell; -1e9 where nothing stands. */
  heights: Float32Array;
}

export function createEnvelope(u0: number, v0: number, u1: number, v1: number, cell: number): HeightEnvelope {
  const cols = Math.max(1, Math.ceil((u1 - u0) / cell));
  const rows = Math.max(1, Math.ceil((v1 - v0) / cell));
  const heights = new Float32Array(cols * rows);
  heights.fill(-1e9);
  return { u0, v0, cell, cols, rows, heights };
}

/** Raises the envelope to `y` over a disc of `radius` around viewer-frame (u, v). */
export function raiseEnvelope(e: HeightEnvelope, u: number, v: number, y: number, radius = 0): void {
  const c0 = Math.max(0, Math.floor((u - radius - e.u0) / e.cell));
  const c1 = Math.min(e.cols - 1, Math.floor((u + radius - e.u0) / e.cell));
  const r0 = Math.max(0, Math.floor((v - radius - e.v0) / e.cell));
  const r1 = Math.min(e.rows - 1, Math.floor((v + radius - e.v0) / e.cell));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = r * e.cols + c;
      if (y > e.heights[k]) e.heights[k] = y;
    }
  }
}

/** Envelope height at viewer-frame (u, v), -1e9 outside the grid. */
export function envelopeAt(e: HeightEnvelope, u: number, v: number): number {
  const c = Math.floor((u - e.u0) / e.cell);
  const r = Math.floor((v - e.v0) / e.cell);
  if (c < 0 || r < 0 || c >= e.cols || r >= e.rows) return -1e9;
  return e.heights[r * e.cols + c];
}

export interface PanelSize {
  /** Metres at 100 % text size. */
  width: number;
  height: number;
}

/**
 * Gameplay's Quest Legacy panels (main-game-vr/src/legacy/legacy-ui-contract.ts on feat/my-legacy):
 * 720 × 490 and 720 × 98 UIKit units at the 0.15 authored scale, text size up to 150 %.
 */
export const QUEST_LEGACY_PANELS = {
  primary: { width: 1.08, height: 0.735 } as PanelSize,
  dock: { width: 1.08, height: 0.147 } as PanelSize,
  maxTextScale: 1.5,
} as const;

export interface PanelPlacement {
  position: Vec3;
  yawDeg: number;
  pitchDeg: number;
  distance: number;
  /** Smallest vertical gap (metres) between the panel and anything below it. */
  clearance: number;
}

export interface PanelLayout {
  primary: PanelPlacement;
  dock: PanelPlacement;
}

const MARGIN = 0.035;
/** Half-angle of the central view cone (degrees) that panels at 100 % text never cover. */
export const CLEAR_CONE_DEG = 14;

/** Lowest gap between a faced panel's lower edge (and body) and the envelope, or -1 when it intersects. */
function panelClearance(f: MiniatureFrame, env: HeightEnvelope, restCos: number, restSin: number, cx: number, cy: number, cz: number, width: number, bottomOffset: number, topOffset: number): number {
  const yaw = Math.atan2(-cx, -cz);
  const pitch = Math.atan2(cy, Math.sqrt(cx * cx + cz * cz));
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  // Panel local +Y after pitch then yaw (Euler YXZ).
  const ux = Math.sin(yaw) * Math.sin(pitch), uy = Math.cos(pitch), uz = Math.cos(yaw) * Math.sin(pitch);
  let worst = 10;
  for (let row = 0; row <= 2; row++) {
    const h = bottomOffset + ((topOffset - bottomOffset) * row) / 2;
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12 - 0.5) * width;
      const px = cx + rx * t + ux * h;
      const py = cy + uy * h;
      const pz = cz + rz * t + uz * h;
      // Anchor point → current viewer frame → rest viewer frame (undo the user rotation).
      const u = px / f.scale;
      const v = (pz + f.distance) / f.scale;
      const ur = u * restCos - v * restSin;
      const vr = u * restSin + v * restCos;
      const hy = envelopeAt(env, ur, vr);
      if (hy < -1e8) continue;
      const gap = py - (f.surfaceY + (hy - f.datumY) * f.scale);
      if (gap < worst) worst = gap;
    }
  }
  return worst;
}

function solveOne(f: MiniatureFrame, env: HeightEnvelope, envYaw: number, side: -1 | 1, size: PanelSize, maxScale: number, grows: "up" | "down", yRange: [number, number], pitchTarget: number): PanelPlacement {
  const userYaw = f.yaw - envYaw;
  const restCos = Math.cos(-userYaw), restSin = Math.sin(-userYaw);
  const width = size.width * maxScale;
  // Bottom/top offsets from the centre at the worst text scale (gameplay keeps the bottom edge
  // of the primary panel and the top edge of the dock fixed as text grows).
  const bottom = grows === "up" ? -size.height / 2 : -size.height / 2 - (maxScale - 1) * size.height;
  const top = grows === "up" ? size.height / 2 + (maxScale - 1) * size.height : size.height / 2;
  let best: PanelPlacement | null = null;
  let bestCost = Infinity;
  for (let yawDeg = 34; yawDeg <= 66; yawDeg += 2) {
    for (let d = 1.0; d <= 1.451; d += 0.05) {
      for (let y = yRange[0]; y <= yRange[1] + 1e-6; y += 0.02) {
        const a = (side * yawDeg * Math.PI) / 180;
        const cx = Math.sin(a) * d, cz = -Math.cos(a) * d;
        // Keep the central cone clear for the holding and its skyline at 100 % text size.
        const inner = yawDeg - (Math.atan2(size.width / 2, d) * 180) / Math.PI;
        if (inner < CLEAR_CONE_DEG) continue;
        const gap = panelClearance(f, env, restCos, restSin, cx, y, cz, width, bottom, top);
        if (gap < MARGIN) continue;
        const pitch = (Math.atan2(y, d) * 180) / Math.PI;
        const cost = Math.abs(yawDeg - 40) / 8 + Math.abs(d - 1.15) * 2.2 + Math.abs(pitch - pitchTarget) / 7;
        if (cost < bestCost) {
          bestCost = cost;
          best = { position: [cx, y, cz], yawDeg: side * yawDeg, pitchDeg: pitch, distance: d, clearance: Math.min(gap, 10) };
        }
      }
    }
  }
  if (best) return best;
  // Nothing clears (should not happen with the authored staging): lift the panel above the envelope.
  const a = (side * 60 * Math.PI) / 180;
  const cx = Math.sin(a) * 1.3, cz = -Math.cos(a) * 1.3;
  return { position: [cx, yRange[1], cz], yawDeg: side * 60, pitchDeg: (Math.atan2(yRange[1], 1.3) * 180) / Math.PI, distance: 1.3, clearance: panelClearance(f, env, restCos, restSin, cx, yRange[1], cz, width, bottom, top) };
}

/**
 * Comfortable, collision-free panel anchors for a posture and user rotation: the primary
 * panel to the left and the dock to the right of the miniature, as close to the line of
 * sight as the miniature's height envelope allows, so the holding and its backdrop stay
 * unobstructed in the middle of the view.
 */
export function solvePanelLayout(f: MiniatureFrame, env: HeightEnvelope, envYaw: number = f.restYaw): PanelLayout {
  const p = QUEST_LEGACY_PANELS;
  return {
    primary: solveOne(f, env, envYaw, -1, p.primary, p.maxTextScale, "up", [-0.12, 0.2], -2),
    dock: solveOne(f, env, envYaw, 1, p.dock, p.maxTextScale, "down", [-0.34, 0.06], -12),
  };
}

export interface QuestStagingNumbers {
  scale: number;
  footprint: readonly [number, number];
  surfaceCenter: Vec3;
  panelAnchors: { primary: Vec3; dock: Vec3 };
  landmarks: { id: LandmarkId; position: Vec3 }[];
}

/** QuestStagingInfo values for a frame (allocates; call on posture or rotation changes only). */
export function stagingNumbers(f: MiniatureFrame, layout: PanelLayout, landmarks: readonly { id: LandmarkId; pickCenter: readonly [number, number, number] }[], detail: { width: number; depth: number }): QuestStagingNumbers {
  return {
    scale: f.scale,
    footprint: [detail.width * f.scale, detail.depth * f.scale],
    surfaceCenter: [0, f.surfaceY, -f.distance],
    panelAnchors: { primary: [layout.primary.position[0], layout.primary.position[1], layout.primary.position[2]], dock: [layout.dock.position[0], layout.dock.position[1], layout.dock.position[2]] },
    landmarks: landmarks.map((l) => ({ id: l.id, position: blueprintToAnchor(f, l.pickCenter[0], l.pickCenter[1], l.pickCenter[2]) })),
  };
}

export const VR_USER_YAW_STEPS: readonly number[] = [-45, -30, -15, 0, 15, 30, 45];
export const VR_POSTURES: readonly VrPosture[] = ["seated", "standing"];
