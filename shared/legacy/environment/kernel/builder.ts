// MeshBuilder: accumulates triangles into bins keyed by material, semantic part and
// render flags ("per-material per-part merging"), with a transform stack and
// optional world-scaled UV projection. finish() returns deterministic MeshBuffers.

import type { LandmarkId } from "../../types";
import { mat4, mat4Compose, mat4Multiply, normalMatrix } from "./math";
import type { Mat4 } from "./math";
import { boundsOfPositions } from "./mesh";
import type { MeshBuffer, MeshMotion, StateGate } from "./mesh";

class GrowF32 {
  a: Float32Array;
  n = 0;
  constructor(capacity: number) {
    this.a = new Float32Array(capacity);
  }
  reserve(extra: number): void {
    if (this.n + extra <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + extra) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.a.subarray(0, this.n));
    this.a = next;
  }
  trimmed(): Float32Array {
    return this.a.slice(0, this.n);
  }
}

class GrowU32 {
  a: Uint32Array;
  n = 0;
  constructor(capacity: number) {
    this.a = new Uint32Array(capacity);
  }
  reserve(extra: number): void {
    if (this.n + extra <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + extra) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.a.subarray(0, this.n));
    this.a = next;
  }
  trimmed(): Uint32Array {
    return this.a.slice(0, this.n);
  }
}

interface Bin {
  key: string;
  material: string;
  part: string;
  landmark: LandmarkId | null;
  castShadow: boolean;
  receiveShadow: boolean;
  lod: number;
  motion: MeshMotion | null;
  gate: StateGate | null;
  variant: string;
  vertexCount: number;
  positions: GrowF32;
  normals: GrowF32;
  uvs: GrowF32;
  colors: GrowF32;
  weights: GrowF32 | null;
  indices: GrowU32;
}

/** Local geometry that can be stamped many times with the current transform. */
export interface Piece {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array | null;
  indices: Uint32Array;
}

export type UvMode = "explicit" | "world";

export class MeshBuilder {
  private bins = new Map<string, Bin>();
  private bin: Bin | null = null;
  private stack: Float64Array[] = [];
  private matrix: Mat4 = mat4();
  private nmat = new Float64Array(9);
  private mirrored = false;
  private scratch = mat4();
  private scratch2 = mat4();

  private s = {
    material: "default",
    part: "settlement",
    landmark: null as LandmarkId | null,
    castShadow: true,
    receiveShadow: true,
    lod: 0,
    motion: null as MeshMotion | null,
    gate: null as StateGate | null,
    variant: "",
  };
  private r = 1;
  private g = 1;
  private b = 1;
  private weight = 0;
  uvMode: UvMode = "explicit";
  /** Offsets added to world-projected UVs (per element variation). */
  uvOffsetU = 0;
  uvOffsetV = 0;

  constructor() {
    normalMatrix(this.nmat, this.matrix);
  }

  // --- State ---------------------------------------------------------------

  material(key: string): this {
    if (this.s.material !== key) {
      this.s.material = key;
      this.bin = null;
    }
    return this;
  }

  get currentMaterial(): string {
    return this.s.material;
  }

  part(name: string, landmark: LandmarkId | null = null): this {
    if (this.s.part !== name || this.s.landmark !== landmark) {
      this.s.part = name;
      this.s.landmark = landmark;
      this.bin = null;
    }
    return this;
  }

  shadows(cast: boolean, receive = true): this {
    if (this.s.castShadow !== cast || this.s.receiveShadow !== receive) {
      this.s.castShadow = cast;
      this.s.receiveShadow = receive;
      this.bin = null;
    }
    return this;
  }

  lod(level: number): this {
    if (this.s.lod !== level) {
      this.s.lod = level;
      this.bin = null;
    }
    return this;
  }

  motion(m: MeshMotion | null): this {
    this.s.motion = m;
    this.bin = null;
    return this;
  }

  gate(g: StateGate | null): this {
    this.s.gate = g;
    this.bin = null;
    return this;
  }

  variant(v: string): this {
    if (this.s.variant !== v) {
      this.s.variant = v;
      this.bin = null;
    }
    return this;
  }

  /** Linear rgb multiplier for subsequent vertices (tint × occlusion hint). */
  color(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  colorV(c: readonly [number, number, number], k = 1): this {
    this.r = c[0] * k;
    this.g = c[1] * k;
    this.b = c[2] * k;
    return this;
  }

  getColor(): [number, number, number] {
    return [this.r, this.g, this.b];
  }

  motionWeight(w: number): this {
    this.weight = w;
    return this;
  }

  // --- Transform stack -------------------------------------------------------

  push(): this {
    this.stack.push(Float64Array.from(this.matrix));
    return this;
  }

  pop(): this {
    const m = this.stack.pop();
    if (m) {
      this.matrix.set(m);
      this.refreshMatrix();
    }
    return this;
  }

  /** Post-multiplies the current matrix by T * Ry * Rx * Rz * S. */
  transform(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1): this {
    mat4Compose(this.scratch, x, y, z, yaw, pitch, roll, sx, sy, sz);
    mat4Multiply(this.scratch2, this.matrix, this.scratch);
    this.matrix.set(this.scratch2);
    this.refreshMatrix();
    return this;
  }

  translate(x: number, y: number, z: number): this {
    return this.transform(x, y, z);
  }

  rotateY(yaw: number): this {
    return this.transform(0, 0, 0, yaw);
  }

  resetTransform(): this {
    this.matrix.set(mat4());
    this.stack.length = 0;
    this.refreshMatrix();
    return this;
  }

  private refreshMatrix(): void {
    normalMatrix(this.nmat, this.matrix);
    const m = this.matrix;
    const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
    this.mirrored = det < 0;
  }

  // --- Emission --------------------------------------------------------------

  private currentBin(): Bin {
    if (this.bin) return this.bin;
    const s = this.s;
    const motionKey = s.motion ? s.motion.kind : "-";
    const gateKey = s.gate ? `${s.gate.minHallTier ?? "_"}:${s.gate.maxHallTier ?? "_"}:${s.gate.flag ?? "_"}` : "-";
    const key = `${s.part}|${s.landmark ?? "-"}|${s.material}|${s.castShadow ? 1 : 0}${s.receiveShadow ? 1 : 0}|${s.lod}|${motionKey}|${gateKey}|${s.variant}`;
    let bin = this.bins.get(key);
    if (!bin) {
      bin = {
        key,
        material: s.material,
        part: s.part,
        landmark: s.landmark,
        castShadow: s.castShadow,
        receiveShadow: s.receiveShadow,
        lod: s.lod,
        motion: s.motion,
        gate: s.gate,
        variant: s.variant,
        vertexCount: 0,
        positions: new GrowF32(3072),
        normals: new GrowF32(3072),
        uvs: new GrowF32(2048),
        colors: new GrowF32(3072),
        weights: s.motion ? new GrowF32(1024) : null,
        indices: new GrowU32(4096),
      };
      this.bins.set(key, bin);
    }
    this.bin = bin;
    return bin;
  }

  /** Emits one vertex in local coordinates; returns its index within the current bin. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    return this.vertexRGB(x, y, z, nx, ny, nz, u, v, this.r, this.g, this.b);
  }

  vertexRGB(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, r: number, g: number, b: number): number {
    const bin = this.currentBin();
    const m = this.matrix;
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const q = this.nmat;
    let tx = q[0] * nx + q[3] * ny + q[6] * nz;
    let ty = q[1] * nx + q[4] * ny + q[7] * nz;
    let tz = q[2] * nx + q[5] * ny + q[8] * nz;
    const len = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= len;
    ty /= len;
    tz /= len;
    if (this.uvMode === "world") {
      if (ty > 0.72 || ty < -0.72) {
        u = wx;
        v = wz;
      } else {
        const hl = Math.sqrt(tx * tx + tz * tz) || 1;
        u = (wx * tz - wz * tx) / hl;
        v = wy;
      }
      u += this.uvOffsetU;
      v += this.uvOffsetV;
    }
    bin.positions.reserve(3);
    bin.normals.reserve(3);
    bin.uvs.reserve(2);
    bin.colors.reserve(3);
    const p = bin.positions;
    p.a[p.n++] = wx;
    p.a[p.n++] = wy;
    p.a[p.n++] = wz;
    const nn = bin.normals;
    nn.a[nn.n++] = tx;
    nn.a[nn.n++] = ty;
    nn.a[nn.n++] = tz;
    const uv = bin.uvs;
    uv.a[uv.n++] = u;
    uv.a[uv.n++] = v;
    const c = bin.colors;
    c.a[c.n++] = r;
    c.a[c.n++] = g;
    c.a[c.n++] = b;
    if (bin.weights) {
      bin.weights.reserve(1);
      bin.weights.a[bin.weights.n++] = this.weight;
    }
    return bin.vertexCount++;
  }

  tri(a: number, b: number, c: number): this {
    const bin = this.currentBin();
    bin.indices.reserve(3);
    const ix = bin.indices;
    if (this.mirrored) {
      ix.a[ix.n++] = a;
      ix.a[ix.n++] = c;
      ix.a[ix.n++] = b;
    } else {
      ix.a[ix.n++] = a;
      ix.a[ix.n++] = b;
      ix.a[ix.n++] = c;
    }
    return this;
  }

  /** Quad a-b-c-d in counter-clockwise order (front face). */
  quad(a: number, b: number, c: number, d: number): this {
    return this.tri(a, b, c).tri(a, c, d);
  }

  /**
   * Flat quad from four local corners (counter-clockwise seen from the front), with
   * the face normal computed from the corners and UVs from the current uv mode.
   */
  flatQuad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    uvs?: readonly number[],
  ): this {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = dx - ax, vy = dy - ay, vz = dz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const t = uvs ?? [0, 0, 1, 0, 1, 1, 0, 1];
    const i0 = this.vertex(ax, ay, az, nx, ny, nz, t[0], t[1]);
    const i1 = this.vertex(bx, by, bz, nx, ny, nz, t[2], t[3]);
    const i2 = this.vertex(cx, cy, cz, nx, ny, nz, t[4], t[5]);
    const i3 = this.vertex(dx, dy, dz, nx, ny, nz, t[6], t[7]);
    return this.quad(i0, i1, i2, i3);
  }

  /** Flat triangle from three local corners (counter-clockwise from the front). */
  flatTri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, uvs?: readonly number[]): this {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const t = uvs ?? [0, 0, 1, 0, 0.5, 1];
    const i0 = this.vertex(ax, ay, az, nx, ny, nz, t[0], t[1]);
    const i1 = this.vertex(bx, by, bz, nx, ny, nz, t[2], t[3]);
    const i2 = this.vertex(cx, cy, cz, nx, ny, nz, t[4], t[5]);
    return this.tri(i0, i1, i2);
  }

  /** Stamps local geometry with the current transform, colour multiplier and uv mode. */
  stamp(piece: Piece): this {
    const n = piece.positions.length / 3;
    const base = this.currentBin().vertexCount;
    const P = piece.positions, N = piece.normals, U = piece.uvs, C = piece.colors;
    for (let i = 0; i < n; i++) {
      const r = C ? C[i * 3] * this.r : this.r;
      const g = C ? C[i * 3 + 1] * this.g : this.g;
      const b = C ? C[i * 3 + 2] * this.b : this.b;
      this.vertexRGB(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], U[i * 2], U[i * 2 + 1], r, g, b);
    }
    const I = piece.indices;
    for (let i = 0; i < I.length; i += 3) this.tri(base + I[i], base + I[i + 1], base + I[i + 2]);
    return this;
  }

  /** Total triangles emitted so far (all bins). */
  triangleCount(): number {
    let t = 0;
    this.bins.forEach((b) => (t += b.indices.n / 3));
    return t;
  }

  /** Returns every non-empty bin as a MeshBuffer, ordered by bin key for determinism. */
  finish(): MeshBuffer[] {
    const keys = Array.from(this.bins.keys()).sort();
    const out: MeshBuffer[] = [];
    for (const key of keys) {
      const b = this.bins.get(key);
      if (!b || b.indices.n === 0) continue;
      const positions = b.positions.trimmed();
      out.push({
        name: key,
        part: b.part,
        material: b.material,
        positions,
        normals: b.normals.trimmed(),
        uvs: b.uvs.trimmed(),
        colors: b.colors.trimmed(),
        splat: null,
        motionWeights: b.weights ? b.weights.trimmed() : null,
        landmarkIds: null,
        indices: b.indices.trimmed(),
        castShadow: b.castShadow,
        receiveShadow: b.receiveShadow,
        lod: b.lod,
        landmark: b.landmark,
        motion: b.motion,
        gate: b.gate,
        bounds: boundsOfPositions(positions),
      });
    }
    this.bins.clear();
    this.bin = null;
    return out;
  }
}

/** Builds a Piece (local geometry) with a scratch builder; the material state is ignored. */
export function makePiece(build: (b: MeshBuilder) => void): Piece {
  const b = new MeshBuilder();
  b.material("piece");
  build(b);
  const meshes = b.finish();
  if (meshes.length === 0) return { positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), colors: null, indices: new Uint32Array(0) };
  // Merge all bins (a piece is single-material by construction).
  let vc = 0;
  let ic = 0;
  for (const m of meshes) {
    vc += m.positions.length / 3;
    ic += m.indices.length;
  }
  const positions = new Float32Array(vc * 3);
  const normals = new Float32Array(vc * 3);
  const uvs = new Float32Array(vc * 2);
  const colors = new Float32Array(vc * 3);
  const indices = new Uint32Array(ic);
  let vo = 0;
  let io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo * 3);
    normals.set(m.normals, vo * 3);
    uvs.set(m.uvs, vo * 2);
    if (m.colors) colors.set(m.colors, vo * 3);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return { positions, normals, uvs, colors, indices };
}
