import * as THREE from "three";
import type { ArchiveInstanced } from "../../../../shared/chronicles/archive/kernel/assemble";
import type { MeshGroup } from "../../../../shared/chronicles/archive/kernel/mesh";

// Kernel output as three.js geometry. The kernel emits typed arrays (positions,
// normals, metre UVs, optional colours, indices and material groups); these
// wrap them without copying, so a build's arrays become GPU buffers directly.

/** The typed arrays a kernel mesh or a merged batch carries. */
export interface KernelArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  groups?: readonly MeshGroup[];
}

/** A kernel mesh or batch as a BufferGeometry, with an optional colour attribute (the baked light). */
export function kernelGeometry(mesh: KernelArrays, colors?: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  if (colors) geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  for (const group of mesh.groups ?? []) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const scratch = new THREE.Object3D();

/**
 * A prototype drawn once per placement (x, y, z and yaw per instance), as one
 * InstancedMesh. Its matrices are written once; nothing updates per frame.
 */
export function kernelInstances(item: ArchiveInstanced, material: THREE.Material | THREE.Material[]): THREE.InstancedMesh {
  const geometry = kernelGeometry(item.prototype);
  const mesh = new THREE.InstancedMesh(geometry, material, item.count);
  for (let index = 0; index < item.count; index++) {
    const p = index * 4;
    scratch.position.set(item.placements[p], item.placements[p + 1], item.placements[p + 2]);
    scratch.rotation.set(0, item.placements[p + 3], 0);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Triangles a geometry draws (indexed or not), for stats. */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
}
