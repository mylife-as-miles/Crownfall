// Scene assembly: converts the shared EnvironmentBuild (typed arrays) into three.js
// objects. Static meshes merge by material, shadow flags, motion and state gate
// (landmark identity survives as a per-vertex attribute for highlight), instance
// sets become InstancedMeshes, and state-driven slots stay addressable.

import * as THREE from "three";
import { LEGACY_LANDMARKS } from "../../../../shared/legacy/environment-contract";
import type { EnvironmentBuild } from "../../../../shared/legacy/environment/build/buildBannerhold";
import type { InstanceSet, MeshBuffer, StateGate } from "../../../../shared/legacy/environment/kernel/mesh";
import type { MaterialFactory, MotionHint } from "./materials";

export interface GatedObject {
  object: THREE.Object3D;
  gate: StateGate;
}

export interface AssembledScene {
  root: THREE.Group;
  gated: GatedObject[];
  /** Instanced meshes by instance-set name (one per prototype mesh). */
  instanced: Map<string, THREE.InstancedMesh[]>;
  geometries: THREE.BufferGeometry[];
  staticDrawables: number;
}

function motionHint(m: MeshBuffer["motion"]): MotionHint {
  if (!m) return { kind: null };
  switch (m.kind) {
    case "cloth":
    case "sway":
      return { kind: m.kind, amplitude: m.amplitude, frequency: m.frequency };
    case "flicker":
      return { kind: "flicker", rate: m.rate, depth: m.depth };
    default:
      return { kind: m.kind };
  }
}

function gateKey(g: StateGate | null): string {
  return g ? `${g.minHallTier ?? "_"}:${g.maxHallTier ?? "_"}:${g.flag ?? "_"}` : "-";
}

function mergeGroup(meshes: MeshBuffer[]): THREE.BufferGeometry {
  let vc = 0, ic = 0;
  for (const m of meshes) {
    vc += m.positions.length / 3;
    ic += m.indices.length;
  }
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), col = new Float32Array(vc * 3);
  const hasSplat = meshes.some((m) => m.splat);
  const hasMotion = meshes.some((m) => m.motionWeights);
  const hasLandmark = meshes.some((m) => m.landmark);
  const splat = hasSplat ? new Float32Array(vc * 4) : null;
  const motion = hasMotion ? new Float32Array(vc) : null;
  const lm = hasLandmark ? new Float32Array(vc) : null;
  const index = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const m of meshes) {
    const n = m.positions.length / 3;
    pos.set(m.positions, vo * 3);
    nrm.set(m.normals, vo * 3);
    uv.set(m.uvs, vo * 2);
    if (m.colors) col.set(m.colors, vo * 3);
    else col.fill(1, vo * 3, (vo + n) * 3);
    if (splat && m.splat) splat.set(m.splat, vo * 4);
    if (motion && m.motionWeights) motion.set(m.motionWeights, vo);
    if (lm && m.landmark) lm.fill(LEGACY_LANDMARKS.indexOf(m.landmark) + 1, vo, vo + n);
    for (let i = 0; i < m.indices.length; i++) index[io + i] = m.indices[i] + vo;
    vo += n;
    io += m.indices.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (splat) g.setAttribute("splat", new THREE.BufferAttribute(splat, 4));
  if (motion) g.setAttribute("motionWeight", new THREE.BufferAttribute(motion, 1));
  if (lm) g.setAttribute("landmarkId", new THREE.BufferAttribute(lm, 1));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function prototypeGeometry(p: MeshBuffer): THREE.BufferGeometry {
  return mergeGroup([p]);
}

export function assembleScene(build: EnvironmentBuild, factory: MaterialFactory, shadows: boolean): AssembledScene {
  const root = new THREE.Group();
  root.name = "bannerhold";
  const gated: GatedObject[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  // Group static meshes by render key.
  const groups = new Map<string, MeshBuffer[]>();
  for (const m of build.meshes) {
    const big = m.part === "terrain" || m.part === "far-terrain";
    const key = `${m.material}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.motion ? JSON.stringify(m.motion) : "-"}|${gateKey(m.gate)}|${big ? m.part : "*"}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(m);
  }
  let staticDrawables = 0;
  const keys = Array.from(groups.keys()).sort();
  for (const key of keys) {
    const list = groups.get(key);
    if (!list || list.length === 0) continue;
    const first = list[0];
    const geometry = mergeGroup(list);
    geometries.push(geometry);
    const material = factory.get(first.material, motionHint(first.motion));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = key;
    mesh.castShadow = shadows && first.castShadow;
    mesh.receiveShadow = shadows && first.receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (first.part === "far-terrain" || first.part === "skyline") mesh.renderOrder = -1;
    root.add(mesh);
    staticDrawables++;
    if (first.gate) gated.push({ object: mesh, gate: first.gate });
  }
  const instanced = new Map<string, THREE.InstancedMesh[]>();
  for (const set of build.instances) instanced.set(set.name, instanceSet(set, factory, shadows, root, geometries, gated));
  return { root, gated, instanced, geometries, staticDrawables };
}

function instanceSet(set: InstanceSet, factory: MaterialFactory, shadows: boolean, root: THREE.Group, geometries: THREE.BufferGeometry[], gated: GatedObject[]): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  const dynamic = set.motion?.kind === "agents";
  for (const p of set.prototypes) {
    const geometry = prototypeGeometry(p);
    geometries.push(geometry);
    const motion: MotionHint = set.motion?.kind === "sway" ? { kind: "sway", amplitude: set.motion.amplitude, frequency: set.motion.frequency } : motionHint(p.motion);
    const material = factory.get(p.material, motion, true);
    const mesh = new THREE.InstancedMesh(geometry, material, set.count);
    mesh.name = `${set.name}|${p.material}`;
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(set.transforms.slice(), 16);
    if (dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (set.tints) mesh.instanceColor = new THREE.InstancedBufferAttribute(set.tints.slice(), 3);
    mesh.castShadow = shadows && set.castShadow;
    mesh.receiveShadow = shadows && set.receiveShadow;
    mesh.frustumCulled = !dynamic;
    if (!dynamic) mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    if (set.gate) gated.push({ object: mesh, gate: set.gate });
    out.push(mesh);
  }
  return out;
}

export function disposeAssembled(a: AssembledScene): void {
  a.root.removeFromParent();
  for (const g of a.geometries) g.dispose();
  a.instanced.forEach((list) => list.forEach((m) => m.dispose()));
}
