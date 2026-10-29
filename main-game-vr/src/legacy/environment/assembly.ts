// Quest scene assembly: wraps the worker's packed, render-ready buffers in super-three
// objects (no per-vertex work on the main thread). Static groups become meshes, instance
// sets become InstancedMeshes, and state-gated objects stay addressable for setState.

import { Box3, BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Mesh, Sphere, Vector3 } from '@iwsdk/core';
import type { Material, Object3D } from '@iwsdk/core';
import type { StateGate } from '../../../../shared/legacy/environment/kernel/mesh';
import type { InstanceKind, PackedGroup, PackedPrototype, QuestMiniature } from '../../../../shared/legacy/environment/vr/miniature';
import type { QuestMaterialFactory } from './materials';

export interface GatedObject {
  object: Object3D;
  gate: StateGate;
}

export interface ThinnedSet {
  meshes: InstancedMesh[];
  capacity: number;
  kind: InstanceKind;
  /** Hidden at the lowest quality (ground clutter). */
  optional: boolean;
}

/** An occluding mesh with its normal material and its precompiled reveal (dissolve) variant. */
export interface RevealPair {
  mesh: Mesh;
  normal: Material;
  reveal: Material;
}

export interface QuestAssembly {
  /** Blueprint-space container (child of the scaled, rotated miniature group). */
  content: Group;
  gated: GatedObject[];
  instanced: Map<string, InstancedMesh[]>;
  thinned: ThinnedSet[];
  geometries: BufferGeometry[];
  staticDraws: number;
  instanceDraws: number;
  revealPairs: RevealPair[];
}

function geometryOf(g: PackedGroup | PackedPrototype, bounds: { min: number[]; max: number[] } | null): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new BufferAttribute(g.normals, 3));
  geo.setAttribute('uv', new BufferAttribute(g.uvs, 2));
  geo.setAttribute('color', new BufferAttribute(g.colors, 3));
  if (g.motionWeights) geo.setAttribute('motionWeight', new BufferAttribute(g.motionWeights, 1));
  if (g.landmarkIds) geo.setAttribute('landmarkId', new BufferAttribute(g.landmarkIds, 1));
  geo.setIndex(new BufferAttribute(g.indices, 1));
  if (bounds) {
    geo.boundingBox = new Box3(new Vector3(bounds.min[0], bounds.min[1], bounds.min[2]), new Vector3(bounds.max[0], bounds.max[1], bounds.max[2]));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new Sphere());
  } else {
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
  return geo;
}

export function assembleMiniature(mini: QuestMiniature, factory: QuestMaterialFactory): QuestAssembly {
  const content = new Group();
  content.name = 'Bannerhold content (blueprint metres)';
  content.position.set(-mini.vr.displayCenter[0], -mini.vr.datumY, -mini.vr.displayCenter[1]);
  const gated: GatedObject[] = [];
  const geometries: BufferGeometry[] = [];
  const revealPairs: RevealPair[] = [];
  let staticDraws = 0;
  for (const g of mini.groups) {
    const geo = geometryOf(g, g.bounds);
    geometries.push(geo);
    const mesh = new Mesh(geo, factory.get(g.material, g.motion, null));
    mesh.name = g.key;
    if (factory.revealable(g.material)) revealPairs.push({ mesh, normal: mesh.material as Material, reveal: factory.get(g.material, g.motion, null, true) });
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    content.add(mesh);
    staticDraws++;
    if (g.gate) gated.push({ object: mesh, gate: g.gate });
  }
  const instanced = new Map<string, InstancedMesh[]>();
  const thinned: ThinnedSet[] = [];
  let instanceDraws = 0;
  for (const set of mini.instances) {
    const dynamic = set.kind === 'agents';
    const sway = set.motion && set.motion.kind === 'sway' ? { amplitude: set.motion.amplitude, frequency: set.motion.frequency } : null;
    const list: InstancedMesh[] = [];
    for (const p of set.prototypes) {
      const geo = geometryOf(p, null);
      geometries.push(geo);
      const mesh = new InstancedMesh(geo, factory.get(p.material, p.motion, sway), set.count);
      mesh.name = `${set.name}|${p.material}`;
      if (!dynamic && set.kind !== 'slot' && factory.revealable(p.material)) revealPairs.push({ mesh, normal: mesh.material as Material, reveal: factory.get(p.material, p.motion, sway, true) });
      mesh.instanceMatrix = new InstancedBufferAttribute(dynamic ? set.transforms.slice() : set.transforms, 16);
      if (dynamic) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      if (set.tints) mesh.instanceColor = new InstancedBufferAttribute(set.tints, 3);
      mesh.frustumCulled = !dynamic;
      if (!dynamic) mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      content.add(mesh);
      list.push(mesh);
      instanceDraws++;
      if (set.gate) gated.push({ object: mesh, gate: set.gate });
    }
    instanced.set(set.name, list);
    if (set.kind === 'vegetation' || set.kind === 'clutter' || set.kind === 'other') thinned.push({ meshes: list, capacity: set.count, kind: set.kind, optional: set.kind === 'clutter' });
  }
  return { content, gated, instanced, thinned, geometries, staticDraws, instanceDraws, revealPairs };
}

export function disposeAssembly(a: QuestAssembly): void {
  a.content.removeFromParent();
  for (const g of a.geometries) g.dispose();
  a.instanced.forEach((list) => list.forEach((m) => m.dispose()));
}
