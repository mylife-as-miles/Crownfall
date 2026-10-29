// Occlusion sweep for the Quest representative reveal (pure, allocation-free): a sphere swept
// from the character's chest to the viewer's head, tested analytically against the blueprint's
// occluder boxes (oriented, yaw only). Returns the segment parameter of the nearest hit to the
// character, or -1 when the line of sight is clear. No per-triangle raycasts.

import type { Collider } from "../kernel/mesh";

/**
 * Segment a→b (blueprint metres) against boxes inflated by `radius`; `out[0..2]` receives the
 * nearest hit point. Returns t in [0, 1] or -1.
 */
export function sweepOccluders(colliders: readonly Collider[], ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number, out: Float64Array): number {
  let best = 2;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
    // Into the box frame: undo the yaw (three.js rotation.y convention) about the box centre.
    const px = ax - c.center[0], py = ay - c.center[1], pz = az - c.center[2];
    const qx = bx - c.center[0], qy = by - c.center[1], qz = bz - c.center[2];
    const lax = px * cos - pz * sin, laz = px * sin + pz * cos;
    const lbx = qx * cos - qz * sin, lbz = qx * sin + qz * cos;
    let t0 = 0, t1 = 1;
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      const p0 = k === 0 ? lax : k === 1 ? py : laz;
      const p1 = k === 0 ? lbx : k === 1 ? qy : lbz;
      const h = c.halfExtents[k] + radius;
      const d = p1 - p0;
      if (Math.abs(d) < 1e-9) {
        if (p0 < -h || p0 > h) ok = false;
        continue;
      }
      let e0 = (-h - p0) / d, e1 = (h - p0) / d;
      if (e0 > e1) { const t = e0; e0 = e1; e1 = t; }
      if (e0 > t0) t0 = e0;
      if (e1 < t1) t1 = e1;
      if (t0 > t1) ok = false;
    }
    if (ok && t0 < best) best = t0;
  }
  if (best > 1) return -1;
  out[0] = ax + (bx - ax) * best;
  out[1] = ay + (by - ay) * best;
  out[2] = az + (bz - az) * best;
  return best;
}
