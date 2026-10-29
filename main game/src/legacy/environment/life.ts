// Settlement life on desktop: NPC figures driven by the blueprint's deterministic
// schedules (instances packed per pose each frame, no per-frame allocation), chimney
// and forge smoke as soft rising billboards, and flickering practical lights.

import * as THREE from "three";
import type { AgentBinding, AgentPoseKey } from "../../../../shared/legacy/environment/kits/figures/slots";
import type { SmokeSource } from "../../../../shared/legacy/environment/kits/context";
import type { TerrainField } from "../../../../shared/legacy/environment/kernel/mesh";
import { sampleField } from "../../../../shared/legacy/environment/kernel/mesh";
import { compileSchedule, createAgentPose, sampleAgent } from "../../../../shared/legacy/environment/blueprint/schedule";
import type { AgentPose, CompiledSchedule } from "../../../../shared/legacy/environment/blueprint/schedule";
import type { SharedUniforms } from "./shaderPatches";

interface AgentRuntime {
  binding: AgentBinding;
  schedule: CompiledSchedule;
  pose: AgentPose;
  /** Cumulative arc length per route point (for elevated/wall-walk height interpolation). */
  arc: Float64Array;
}

const WORK = new Set(["forge-strike", "repair", "chop-wood", "bellows", "sweep", "quench"]);
const CARRY = new Set(["carry", "load", "draw-water", "hang-laundry", "trade"]);

export class AgentSystem {
  private agents: AgentRuntime[] = [];
  private sets = new Map<string, THREE.InstancedMesh[]>();
  private cursors = new Map<string, number>();
  private field: TerrainField;
  private camera: THREE.Camera;

  constructor(bindings: readonly AgentBinding[], instanced: Map<string, THREE.InstancedMesh[]>, field: TerrainField, camera: THREE.Camera) {
    this.field = field;
    this.camera = camera;
    for (const b of bindings) {
      const schedule = compileSchedule(b.npc);
      const arc = new Float64Array(b.npc.route.length);
      for (let i = 1; i < b.npc.route.length; i++) arc[i] = arc[i - 1] + Math.hypot(b.npc.route[i][0] - b.npc.route[i - 1][0], b.npc.route[i][1] - b.npc.route[i - 1][1]);
      this.agents.push({ binding: b, schedule, pose: createAgentPose(), arc });
      for (const k of Object.keys(b.poses) as AgentPoseKey[]) {
        const p = b.poses[k];
        if (p && !this.sets.has(p.set)) {
          const list = instanced.get(p.set);
          if (list) this.sets.set(p.set, list);
        }
      }
    }
  }

  private heightAt(a: AgentRuntime, x: number, z: number, s: number): number {
    const ry = a.binding.routeY;
    if (!ry) return sampleField(this.field, x, z);
    const arc = a.arc;
    let i = 1;
    while (i < arc.length - 1 && arc[i] < s) i++;
    const t = arc[i] > arc[i - 1] ? Math.min(1, Math.max(0, (s - arc[i - 1]) / (arc[i] - arc[i - 1]))) : 0;
    return ry[i - 1] + (ry[i] - ry[i - 1]) * t;
  }

  update(time: number): void {
    this.cursors.forEach((_, k) => this.cursors.set(k, 0));
    this.sets.forEach((_, k) => this.cursors.set(k, 0));
    const cam = this.camera.position;
    for (const a of this.agents) {
      const p = sampleAgent(a.schedule, time, a.pose);
      const npc = a.binding.npc;
      const dx = p.x - cam.x, dz = p.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > npc.lod.hiddenBeyond * npc.lod.hiddenBeyond) continue;
      let key: AgentPoseKey = "stand";
      if (p.activity === "walk") key = Math.floor(p.s / 0.62) % 2 === 0 ? "walkA" : "walkB";
      else if (WORK.has(p.activity)) key = a.binding.poses.work && Math.floor(time * 1.6 + a.binding.npcIndex) % 2 === 0 ? "work" : "stand";
      else if (CARRY.has(p.activity) && a.binding.poses.carry) key = "carry";
      else if ((p.activity === "salute" || p.activity === "drill") && a.binding.poses.salute) key = p.activity === "drill" && Math.floor(time * 0.5) % 2 === 1 ? "stand" : "salute";
      const slot = a.binding.poses[key] ?? a.binding.poses.stand;
      if (!slot) continue;
      const meshes = this.sets.get(slot.set);
      if (!meshes) continue;
      const yawDeg = 180 - p.bearingDeg;
      const yaw = (yawDeg * Math.PI) / 180;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const sc = a.binding.scale;
      const formation = npc.formation;
      for (let f = 0; f < a.binding.figures; f++) {
        let ox = 0, oz = 0;
        if (formation && formation[f]) {
          // Formation offsets: x right, z back relative to the leader's facing.
          const lx = -formation[f][0], lz = -formation[f][1];
          ox = lx * c + lz * s;
          oz = -lx * s + lz * c;
        }
        const x = p.x + ox, z = p.z + oz;
        const y = this.heightAt(a, x, z, p.s) + (p.activity === "walk" ? Math.abs(Math.sin(p.s * 5.07)) * 0.035 : 0);
        const cursor = this.cursors.get(slot.set) ?? 0;
        for (const mesh of meshes) {
          const arr = mesh.instanceMatrix.array as Float32Array;
          const o = cursor * 16;
          arr[o] = c * sc; arr[o + 1] = 0; arr[o + 2] = -s * sc; arr[o + 3] = 0;
          arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
          arr[o + 8] = s * sc; arr[o + 9] = 0; arr[o + 10] = c * sc; arr[o + 11] = 0;
          arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
        }
        this.cursors.set(slot.set, cursor + 1);
      }
    }
    this.sets.forEach((meshes, key) => {
      const n = this.cursors.get(key) ?? 0;
      for (const m of meshes) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
      }
    });
  }
}

const SMOKE_VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec2 aSeed;
uniform float uTime;
uniform vec3 uWind;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float rate = 0.045 + aSeed.y * 0.02;
  float age = fract(uTime * rate + aSeed.x);
  float strength = aBase.y > -9000.0 ? 1.0 : 0.0;
  vec3 p = aBase;
  float rise = age * (9.0 + aSeed.y * 6.0) * (0.6 + 0.4 * aSeed.y);
  p += vec3(uWind.x, 0.0, uWind.z) * age * age * 7.0;
  p.y += rise;
  p.x += sin(age * 6.0 + aSeed.x * 20.0) * 0.4 * age;
  float size = (0.9 + age * 4.2) * (0.7 + aSeed.y * 0.6);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = p + (camRight * position.x + camUp * position.y) * size;
  vWorld = wp;
  vUv = uv;
  vAlpha = smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.6) * strength;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const SMOKE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float puff = smoothstep(1.0, 0.15, r) * (0.75 + 0.25 * sin((q.x + q.y) * 9.0));
  float d = length(vWorld - cameraPosition);
  vec3 col = mix(uColor, uFogColor, clamp(d / 900.0, 0.0, 0.8));
  gl_FragColor = vec4(col, puff * vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SmokeSystem {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.InstancedBufferGeometry;

  constructor(sources: readonly SmokeSource[], U: SharedUniforms, color: THREE.Color) {
    const puffsPer = 9;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute("position", quad.getAttribute("position"));
    geo.setAttribute("uv", quad.getAttribute("uv"));
    const n = sources.length * puffsPer;
    const base = new Float32Array(n * 3);
    const seed = new Float32Array(n * 2);
    let k = 0;
    for (const s of sources) {
      const big = s.strength > 1.5;
      for (let i = 0; i < puffsPer; i++) {
        base[k * 3] = s.position[0];
        base[k * 3 + 1] = s.position[1];
        base[k * 3 + 2] = s.position[2];
        seed[k * 2] = i / puffsPer + (s.position[0] * 0.013) % 1;
        seed[k * 2 + 1] = big ? 1 : Math.min(1, 0.25 + s.strength * 0.6);
        k++;
      }
    }
    geo.setAttribute("aBase", new THREE.InstancedBufferAttribute(base, 3));
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 2));
    geo.instanceCount = n;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: U.uTime, uWind: U.uWind, uColor: { value: color }, uFogColor: U.uFogColor, uOpacity: { value: 0.42 } },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = "smoke";
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
