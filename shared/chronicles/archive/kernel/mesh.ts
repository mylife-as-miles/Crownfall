// The kernel's mesh contract and writer. Builders emit typed arrays shaped like
// the relief's ReliefMesh: positions, normals, uvs (metres unless a builder says
// otherwise), optional colours, indices and one group per material slot. Each
// platform turns them into its own runtime objects; no runtime object is shared.

import { cross3, normalize3, rotateYaw, sub3, type Mutable3 } from "./math";

export interface MeshGroup {
  start: number;
  count: number;
  /** The builder's material slot; the blueprint element maps slots to material ids. */
  materialIndex: number;
}

export interface MeshBuffer {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors?: Float32Array;
  indices: Uint16Array | Uint32Array;
  groups: readonly MeshGroup[];
  vertexCount: number;
  triangleCount: number;
  /** Declared closed: every edge (by welded position) is shared by exactly two triangles. */
  watertight?: boolean;
}

type P3 = readonly [number, number, number] | readonly number[];

/**
 * Accumulates vertices and per-slot triangles. Vertices are shared across
 * slots; `build()` lays each slot's triangles out contiguously.
 */
export class MeshWriter {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private readonly slots: number[][] = [];
  private readonly scratchA: Mutable3 = [0, 0, 0];
  private readonly scratchB: Mutable3 = [0, 0, 0];
  private readonly scratchN: Mutable3 = [0, 0, 0];
  watertight = false;

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    let count = 0;
    for (const slot of this.slots) if (slot) count += slot.length / 3;
    return count;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    return this.positions.length / 3 - 1;
  }

  triangle(slot: number, a: number, b: number, c: number): void {
    (this.slots[slot] ||= []).push(a, b, c);
  }

  /** Two triangles a-b-c and a-c-d; corners run counter-clockwise seen from the front. */
  quad(slot: number, a: number, b: number, c: number, d: number): void {
    const list = (this.slots[slot] ||= []);
    list.push(a, b, c, a, c, d);
  }

  /** A triangle wound so its front faces the way its vertex normals point; skips a degenerate one. */
  orientTriangle(slot: number, a: number, b: number, c: number): void {
    const facing = this.facing(a, b, c, c);
    if (facing === 0) return;
    if (facing > 0) this.triangle(slot, a, b, c);
    else this.triangle(slot, a, c, b);
  }

  /** A quad wound so its front faces the way its vertex normals point. */
  orientQuad(slot: number, a: number, b: number, c: number, d: number): void {
    const facing = this.facing(a, b, c, d);
    if (facing >= 0) {
      this.orientTriangle(slot, a, b, c);
      this.orientTriangle(slot, a, c, d);
    } else {
      this.orientTriangle(slot, a, c, b);
      this.orientTriangle(slot, a, d, c);
    }
  }

  /** Sign of the geometric normal of a-b-c (or the quad a-b-c-d) against the summed vertex normals; 0 when degenerate. */
  private facing(a: number, b: number, c: number, d: number): number {
    const p = this.positions, n = this.normals;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    // Quad normal from its diagonals, triangle normal from two edges.
    const ux = (d === c ? p[b * 3] : p[c * 3]) - ax, uy = (d === c ? p[b * 3 + 1] : p[c * 3 + 1]) - ay, uz = (d === c ? p[b * 3 + 2] : p[c * 3 + 2]) - az;
    const vx = (d === c ? p[c * 3] - ax : p[d * 3] - p[b * 3]), vy = (d === c ? p[c * 3 + 1] - ay : p[d * 3 + 1] - p[b * 3 + 1]), vz = (d === c ? p[c * 3 + 2] - az : p[d * 3 + 2] - p[b * 3 + 2]);
    // For a quad, (c - a) x (d - b) points the same way as its triangles' normals.
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const area = Math.hypot(gx, gy, gz);
    if (area < 1e-12) return 0;
    const sx = n[a * 3] + n[b * 3] + n[c * 3] + (d === c ? 0 : n[d * 3]);
    const sy = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1] + (d === c ? 0 : n[d * 3 + 1]);
    const sz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2] + (d === c ? 0 : n[d * 3 + 2]);
    return gx * sx + gy * sy + gz * sz >= 0 ? 1 : -1;
  }

  /**
   * A flat quad with its own four vertices: the face normal from its corners
   * and planar UVs in metres along `uAxis` (unit vector) and the face's up.
   */
  flatQuad(slot: number, p0: P3, p1: P3, p2: P3, p3: P3, uvOrigin?: P3): void {
    const n = this.faceNormal(p0, p1, p3);
    this.planarFace(slot, [p0, p1, p2, p3], n, uvOrigin);
  }

  /** A flat polygon (fan from its first corner) with a given or computed normal. */
  flatPolygon(slot: number, points: readonly P3[], normal?: P3, uvOrigin?: P3): void {
    const n: Mutable3 = normal ? [normal[0], normal[1], normal[2]] : this.faceNormal(points[0], points[1], points[2]);
    this.planarFace(slot, points, n, uvOrigin);
  }

  private faceNormal(a: P3, b: P3, c: P3): Mutable3 {
    sub3(b as number[], a as number[], this.scratchA);
    sub3(c as number[], a as number[], this.scratchB);
    const n = cross3(this.scratchA, this.scratchB, [0, 0, 0]);
    return normalize3(n);
  }

  private planarFace(slot: number, points: readonly P3[], n: Mutable3, uvOrigin?: P3): void {
    // Planar mapping in metres: u runs horizontally across the face (or along x
    // for floors and ceilings) and v runs up the face (or along z).
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const ox = uvOrigin ? uvOrigin[0] : 0, oy = uvOrigin ? uvOrigin[1] : 0, oz = uvOrigin ? uvOrigin[2] : 0;
    const first = this.vertexCount;
    for (const p of points) {
      let u: number, v: number;
      if (ay >= ax && ay >= az) {
        u = p[0] - ox;
        v = n[1] > 0 ? -(p[2] - oz) : p[2] - oz;
      } else {
        // Horizontal tangent of the face, to the right seen from the front: (nz, 0, -nx) normalised.
        const length = Math.hypot(n[0], n[2]) || 1;
        u = ((p[0] - ox) * n[2] - (p[2] - oz) * n[0]) / length;
        v = p[1] - oy;
      }
      this.vertex(p[0], p[1], p[2], n[0], n[1], n[2], u, v);
    }
    for (let index = 1; index + 1 < points.length; index++) this.orientTriangle(slot, first, first + index, first + index + 1);
  }

  /**
   * Transforms the vertices written since `start` by a 3x3 matrix (row-major)
   * and a translation; normals follow the matrix (rigid rotations only).
   */
  transformFrom(start: number, m: readonly number[], t: readonly number[] = [0, 0, 0]): void {
    const p = this.positions, n = this.normals;
    for (let index = start * 3; index < p.length; index += 3) {
      const x = p[index], y = p[index + 1], z = p[index + 2];
      p[index] = m[0] * x + m[1] * y + m[2] * z + t[0];
      p[index + 1] = m[3] * x + m[4] * y + m[5] * z + t[1];
      p[index + 2] = m[6] * x + m[7] * y + m[8] * z + t[2];
      const nx = n[index], ny = n[index + 1], nz = n[index + 2];
      n[index] = m[0] * nx + m[1] * ny + m[2] * nz;
      n[index + 1] = m[3] * nx + m[4] * ny + m[5] * nz;
      n[index + 2] = m[6] * nx + m[7] * ny + m[8] * nz;
    }
  }

  /** Appends another buffer, moving its slots by `slotOffset` (or mapping them). */
  append(mesh: MeshBuffer, slotMap: (slot: number) => number = (slot) => slot): void {
    const base = this.vertexCount;
    for (let index = 0; index < mesh.positions.length; index++) this.positions.push(mesh.positions[index]);
    for (let index = 0; index < mesh.normals.length; index++) this.normals.push(mesh.normals[index]);
    for (let index = 0; index < mesh.uvs.length; index++) this.uvs.push(mesh.uvs[index]);
    for (const group of mesh.groups) {
      const list = (this.slots[slotMap(group.materialIndex)] ||= []);
      for (let index = group.start; index < group.start + group.count; index++) list.push(mesh.indices[index] + base);
    }
  }

  build(): MeshBuffer {
    const vertexCount = this.vertexCount;
    let total = 0;
    for (const slot of this.slots) if (slot) total += slot.length;
    const indices = vertexCount > 65535 ? new Uint32Array(total) : new Uint16Array(total);
    const groups: MeshGroup[] = [];
    let cursor = 0;
    this.slots.forEach((slot, materialIndex) => {
      if (!slot || !slot.length) return;
      indices.set(slot, cursor);
      groups.push({ start: cursor, count: slot.length, materialIndex });
      cursor += slot.length;
    });
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      uvs: Float32Array.from(this.uvs),
      indices,
      groups,
      vertexCount,
      triangleCount: total / 3,
      watertight: this.watertight || undefined,
    };
  }
}

/** A copy of a mesh moved by a yaw (three.js convention), a scale and a translation. */
export function transformMesh(mesh: MeshBuffer, position: readonly number[], yaw = 0, scale: readonly number[] = [1, 1, 1]): MeshBuffer {
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  const turned: [number, number] = [0, 0];
  const [sx, sy, sz] = scale;
  for (let index = 0; index < mesh.vertexCount; index++) {
    const i = index * 3;
    rotateYaw(mesh.positions[i] * sx, mesh.positions[i + 2] * sz, yaw, turned);
    positions[i] = turned[0] + position[0];
    positions[i + 1] = mesh.positions[i + 1] * sy + position[1];
    positions[i + 2] = turned[1] + position[2];
    // Normals transform by the inverse-transpose of the scale.
    let nx = mesh.normals[i] / sx, ny = mesh.normals[i + 1] / sy, nz = mesh.normals[i + 2] / sz;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    rotateYaw(nx, nz, yaw, turned);
    normals[i] = turned[0];
    normals[i + 1] = ny;
    normals[i + 2] = turned[1];
  }
  // A mirroring scale flips the winding.
  let indices = mesh.indices;
  if (sx * sy * sz < 0) {
    indices = mesh.indices.slice();
    for (let index = 0; index < indices.length; index += 3) {
      const swap = indices[index + 1];
      indices[index + 1] = indices[index + 2];
      indices[index + 2] = swap;
    }
  }
  return { ...mesh, positions, normals, uvs: mesh.uvs.slice(), colors: mesh.colors?.slice(), indices };
}

/** A copy of a mesh turned by a 3x3 rotation (row-major) and moved by `t`. */
export function rotateMesh(mesh: MeshBuffer, m: readonly number[], t: readonly number[] = [0, 0, 0]): MeshBuffer {
  const positions = new Float32Array(mesh.positions.length), normals = new Float32Array(mesh.normals.length);
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index], y = mesh.positions[index + 1], z = mesh.positions[index + 2];
    positions[index] = m[0] * x + m[1] * y + m[2] * z + t[0];
    positions[index + 1] = m[3] * x + m[4] * y + m[5] * z + t[1];
    positions[index + 2] = m[6] * x + m[7] * y + m[8] * z + t[2];
    const nx = mesh.normals[index], ny = mesh.normals[index + 1], nz = mesh.normals[index + 2];
    normals[index] = m[0] * nx + m[1] * ny + m[2] * nz;
    normals[index + 1] = m[3] * nx + m[4] * ny + m[5] * nz;
    normals[index + 2] = m[6] * nx + m[7] * ny + m[8] * nz;
  }
  return { ...mesh, positions, normals, uvs: mesh.uvs.slice(), colors: mesh.colors?.slice() };
}

/** The rotation matrix (row-major) of three.js Euler angles in order "XYZ". */
export function eulerMatrix(x: number, y: number, z: number): number[] {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
}

/** Axis-aligned bounds of a mesh's positions. */
export function meshBounds(mesh: MeshBuffer): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[index + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}
