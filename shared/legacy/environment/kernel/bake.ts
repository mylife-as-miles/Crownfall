// Vertex-colour baking: contact darkening (AO near the ground), sky occlusion by
// normal, height grime / rising damp, low-frequency tint variation and an optional
// baked directional term for Quest's cheaper shading. Multiplies MeshBuffer.colors.

import type { MeshBuffer } from "./mesh";
import { noise2, noise3 } from "./noise";
import { clamp, smoothstep } from "./math";

export interface BakeOptions {
  /** Ground height at a plan point (bilinear terrain field). */
  ground: (x: number, z: number) => number;
  /** Darkening in the first metres above the ground. */
  contact?: { strength: number; height: number };
  /** Downward-facing surfaces darken by up to this fraction. */
  skyOcclusion?: number;
  /** Rising damp and dirt near the ground, broken by noise. */
  grime?: { strength: number; height: number; seed: number };
  /** Low-frequency tint variation in world space. */
  variation?: { amount: number; scale: number; seed: number; warm?: number };
  /** Baked directional light (Quest): colour *= ambient + strength * max(0, n·L). */
  directional?: { dir: readonly [number, number, number]; strength: number; ambient: number };
}

export function bakeMesh(mesh: MeshBuffer, o: BakeOptions): void {
  const P = mesh.positions, N = mesh.normals;
  let C = mesh.colors;
  if (!C) {
    C = new Float32Array(P.length).fill(1);
    mesh.colors = C;
  }
  const n = P.length / 3;
  let lx = 0, ly = 1, lz = 0;
  if (o.directional) {
    const d = o.directional.dir;
    const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
    lx = d[0] / l; ly = d[1] / l; lz = d[2] / l;
  }
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const ny = N[i * 3 + 1];
    let k = 1;
    let warm = 0;
    const above = y - o.ground(x, z);
    if (o.contact) {
      k *= 1 - o.contact.strength * (1 - smoothstep(0, o.contact.height, above));
    }
    if (o.skyOcclusion) {
      k *= 1 - o.skyOcclusion * clamp(-ny, 0, 1) - o.skyOcclusion * 0.35 * (1 - Math.abs(ny));
    }
    if (o.grime) {
      const g = o.grime;
      const breakup = 0.55 + 0.45 * noise3(x * 0.7, y * 0.35, z * 0.7, g.seed);
      k *= 1 - g.strength * (1 - smoothstep(0, g.height, above)) * breakup;
    }
    if (o.variation) {
      const v = o.variation;
      const t = noise2(x * v.scale, z * v.scale, v.seed) * 2 - 1;
      k *= 1 + v.amount * t;
      warm = (v.warm ?? 0) * (noise2(x * v.scale * 1.7 + 11.3, z * v.scale * 1.7 - 4.1, v.seed + 7) * 2 - 1);
    }
    let light = 1;
    if (o.directional) {
      const d = o.directional;
      const dot = N[i * 3] * lx + ny * ly + N[i * 3 + 2] * lz;
      light = d.ambient + d.strength * Math.max(0, dot);
    }
    C[i * 3] *= k * light * (1 + warm);
    C[i * 3 + 1] *= k * light;
    C[i * 3 + 2] *= k * light * (1 - warm);
  }
}
