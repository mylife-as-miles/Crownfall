// Landmark picking on simplified proxies: the build's landmark colliders (oriented
// boxes) and each landmark's pick sphere, tested on pointer move only.

import * as THREE from "three";
import type { LandmarkId } from "../../../../shared/legacy/types";
import type { Collider } from "../../../../shared/legacy/environment/kernel/mesh";
import type { LandmarkBuild } from "../../../../shared/legacy/environment/build/buildBannerhold";

export class LandmarkPicker {
  private boxes: Collider[];
  private spheres: LandmarkBuild[];
  private ray = new THREE.Ray();
  private ndc = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();

  constructor(colliders: readonly Collider[], landmarks: readonly LandmarkBuild[]) {
    this.boxes = colliders.filter((c) => c.landmark !== null);
    this.spheres = landmarks.slice();
  }

  /** Landmark under a pointer position given in CSS pixels relative to the element. */
  pick(camera: THREE.Camera, x: number, y: number, width: number, height: number): LandmarkId | null {
    this.ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    this.ray.copy(this.raycaster.ray);
    const o = this.ray.origin, d = this.ray.direction;
    let best = Infinity;
    let hit: LandmarkId | null = null;
    for (const c of this.boxes) {
      const ox = o.x - c.center[0], oy = o.y - c.center[1], oz = o.z - c.center[2];
      const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
      const lx = ox * cs + oz * sn, lz = -ox * sn + oz * cs;
      const dx = d.x * cs + d.z * sn, dz = -d.x * sn + d.z * cs;
      let tmin = 0, tmax = Infinity;
      const he = c.halfExtents;
      const axes: [number, number, number][] = [[lx, dx, he[0]], [oy, d.y, he[1]], [lz, dz, he[2]]];
      let ok = true;
      for (const [p, v, e] of axes) {
        if (Math.abs(v) < 1e-8) {
          if (Math.abs(p) > e) { ok = false; break; }
          continue;
        }
        let t1 = (-e - p) / v, t2 = (e - p) / v;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
      if (ok && tmin < best) {
        best = tmin;
        hit = c.landmark;
      }
    }
    if (hit) return hit;
    // Fallback: generous pick spheres (empty yards such as the Muster Grounds).
    for (const l of this.spheres) {
      const cx = l.pickCenter[0] - o.x, cy = l.pickCenter[1] - o.y, cz = l.pickCenter[2] - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z;
      if (t < 0) continue;
      const px = cx - d.x * t, py = cy - d.y * t, pz = cz - d.z * t;
      if (px * px + py * py + pz * pz <= l.pickRadius * l.pickRadius && t < best) {
        best = t;
        hit = l.id;
      }
    }
    return hit;
  }
}
