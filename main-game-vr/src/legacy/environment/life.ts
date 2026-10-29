// Settlement life on Quest: NPC figures follow the blueprint's deterministic schedules
// (instances packed per pose each frame with no allocation), and chimney and forge smoke
// rise as soft billboards in blueprint metres inside the miniature.

import { Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial } from '@iwsdk/core';
import type { InstancedMesh } from '@iwsdk/core';
import type { AgentBinding, AgentPoseKey } from '../../../../shared/legacy/environment/kits/figures/slots';
import type { SmokeSource } from '../../../../shared/legacy/environment/kits/context';
import type { StateGate, TerrainField } from '../../../../shared/legacy/environment/kernel/mesh';
import { sampleField } from '../../../../shared/legacy/environment/kernel/mesh';
import { compileSchedule, createAgentPose, sampleAgent } from '../../../../shared/legacy/environment/blueprint/schedule';
import type { AgentPose, CompiledSchedule } from '../../../../shared/legacy/environment/blueprint/schedule';
import { TONEMAP_GLSL } from './shaderPatch';
import type { QuestUniforms } from './shaderPatch';

const WORK = new Set(['forge-strike', 'repair', 'chop-wood', 'bellows', 'sweep', 'quench']);
const CARRY = new Set(['carry', 'load', 'draw-water', 'hang-laundry', 'trade']);
const POSE_KEYS: readonly AgentPoseKey[] = ['stand', 'walkA', 'walkB', 'work', 'carry', 'salute', 'guard', 'herald'];

interface PoseSet {
  meshes: InstancedMesh[];
  cursor: number;
}

interface AgentRuntime {
  binding: AgentBinding;
  schedule: CompiledSchedule;
  pose: AgentPose;
  arc: Float64Array;
  /** Pose set index per POSE_KEYS entry (-1 when the binding has no such pose). */
  sets: Int16Array;
}

/** Allocation-free NPC update: every frame writes instance matrices into existing arrays. */
export class QuestAgents {
  private readonly agents: AgentRuntime[] = [];
  private readonly sets: PoseSet[] = [];
  private readonly field: TerrainField;
  private active: number;

  constructor(bindings: readonly AgentBinding[], instanced: Map<string, InstancedMesh[]>, field: TerrainField, active: number) {
    this.field = field;
    this.active = active;
    const index = new Map<string, number>();
    for (const b of bindings) {
      const arc = new Float64Array(b.npc.route.length);
      for (let i = 1; i < b.npc.route.length; i++) arc[i] = arc[i - 1] + Math.hypot(b.npc.route[i][0] - b.npc.route[i - 1][0], b.npc.route[i][1] - b.npc.route[i - 1][1]);
      const sets = new Int16Array(POSE_KEYS.length).fill(-1);
      POSE_KEYS.forEach((k, ki) => {
        const p = b.poses[k];
        if (!p) return;
        let si = index.get(p.set);
        if (si === undefined) {
          const meshes = instanced.get(p.set);
          if (!meshes) return;
          si = this.sets.length;
          this.sets.push({ meshes, cursor: 0 });
          index.set(p.set, si);
        }
        sets[ki] = si;
      });
      this.agents.push({ binding: b, schedule: compileSchedule(b.npc), pose: createAgentPose(), arc, sets });
    }
  }

  setActive(n: number): void {
    this.active = n;
  }

  get count(): number {
    return Math.min(this.active, this.agents.length);
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
    const sets = this.sets;
    for (let i = 0; i < sets.length; i++) sets[i].cursor = 0;
    const n = this.count;
    for (let ai = 0; ai < n; ai++) {
      const a = this.agents[ai];
      const p = sampleAgent(a.schedule, time, a.pose);
      // 0 stand, 1 walkA, 2 walkB, 3 work, 4 carry, 5 salute (POSE_KEYS order).
      let key = 0;
      // One walk pose on Quest: the alternate stride is invisible on 1.4 cm figures and would cost draws.
      if (p.activity === 'walk') key = 1;
      else if (WORK.has(p.activity)) key = a.sets[3] >= 0 && Math.floor(time * 1.6 + a.binding.npcIndex) % 2 === 0 ? 3 : 0;
      else if (CARRY.has(p.activity) && a.sets[4] >= 0) key = 4;
      else if ((p.activity === 'salute' || p.activity === 'drill') && a.sets[5] >= 0) key = p.activity === 'drill' && Math.floor(time * 0.5) % 2 === 1 ? 0 : 5;
      let si = a.sets[key];
      if (si < 0) si = a.sets[0];
      if (si < 0) continue;
      const set = sets[si];
      const yaw = ((180 - p.bearingDeg) * Math.PI) / 180;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const sc = a.binding.scale;
      const formation = a.binding.npc.formation;
      for (let f = 0; f < a.binding.figures; f++) {
        let ox = 0, oz = 0;
        if (formation && formation[f]) {
          const lx = -formation[f][0], lz = -formation[f][1];
          ox = lx * c + lz * s;
          oz = -lx * s + lz * c;
        }
        const x = p.x + ox, z = p.z + oz;
        const y = this.heightAt(a, x, z, p.s) + (p.activity === 'walk' ? Math.abs(Math.sin(p.s * 5.07)) * 0.035 : 0);
        const o = set.cursor * 16;
        for (let mi = 0; mi < set.meshes.length; mi++) {
          const arr = set.meshes[mi].instanceMatrix.array as Float32Array;
          if (o + 16 > arr.length) continue;
          arr[o] = c * sc; arr[o + 1] = 0; arr[o + 2] = -s * sc; arr[o + 3] = 0;
          arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
          arr[o + 8] = s * sc; arr[o + 9] = 0; arr[o + 10] = c * sc; arr[o + 11] = 0;
          arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
        }
        set.cursor++;
      }
    }
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      for (let mi = 0; mi < set.meshes.length; mi++) {
        const m = set.meshes[mi];
        const cap = m.instanceMatrix.count;
        m.count = set.cursor < cap ? set.cursor : cap;
        m.visible = m.count > 0;
        m.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

const SMOKE_VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec2 aSeed;
attribute vec3 aColor;
uniform float uTime;
uniform float uSmokeRate;
uniform vec3 uWind;
uniform float uWorldScale;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float rate = (0.045 + aSeed.y * 0.02) * uSmokeRate;
  float age = fract(uTime * rate + aSeed.x);
  float on = aBase.y > -9000.0 ? 1.0 : 0.0;
  vec3 p = aBase;
  p += vec3(uWind.x, 0.0, uWind.z) * age * age * 7.0;
  p.y += age * (9.0 + aSeed.y * 6.0) * (0.6 + 0.4 * aSeed.y);
  p.x += sin(age * 6.0 + aSeed.x * 20.0) * 0.4 * age;
  float size = (0.9 + age * 4.2) * (0.7 + aSeed.y * 0.6) * uWorldScale;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz + (camRight * position.x + camUp * position.y) * size;
  vUv = uv;
  vColor = aColor;
  vAlpha = smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.6) * on;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SMOKE_FRAG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uExposure;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vColor;
${TONEMAP_GLSL}
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float puff = smoothstep(1.0, 0.15, r) * (0.75 + 0.25 * sin((q.x + q.y) * 9.0));
  vec3 col = mix(vColor, uFogColor, 0.35);
  gl_FragColor = vec4(bhTonemap(col, uExposure), puff * vAlpha * uOpacity);
  #include <colorspace_fragment>
}
`;

/** Soft rising smoke: one instanced draw for every chimney and forge in the miniature. */
export class QuestSmoke {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly quad = new PlaneGeometry(1, 1);
  private readonly base: Float32Array;
  private readonly heights: Float32Array;
  private readonly gates: (StateGate | null)[] = [];
  private readonly baseAttribute: InstancedBufferAttribute;
  private static readonly PUFFS = 7;

  constructor(sources: readonly SmokeSource[], U: QuestUniforms, worldScale: number) {
    const per = QuestSmoke.PUFFS;
    const n = sources.length * per;
    this.base = new Float32Array(n * 3);
    this.heights = new Float32Array(n);
    const seed = new Float32Array(n * 2);
    const color = new Float32Array(n * 3);
    const c = new Color();
    let k = 0;
    for (const s of sources) {
      c.set(s.color);
      for (let i = 0; i < per; i++) {
        this.base[k * 3] = s.position[0];
        this.base[k * 3 + 1] = s.position[1];
        this.base[k * 3 + 2] = s.position[2];
        this.heights[k] = s.position[1];
        seed[k * 2] = i / per + ((Math.abs(s.position[0]) * 0.013) % 1);
        seed[k * 2 + 1] = s.strength > 1.5 ? 1 : Math.min(1, 0.25 + s.strength * 0.6);
        color[k * 3] = c.r; color[k * 3 + 1] = c.g; color[k * 3 + 2] = c.b;
        this.gates.push(s.gate);
        k++;
      }
    }
    const geo = new InstancedBufferGeometry();
    geo.index = this.quad.index;
    geo.setAttribute('position', this.quad.getAttribute('position'));
    geo.setAttribute('uv', this.quad.getAttribute('uv'));
    this.baseAttribute = new InstancedBufferAttribute(this.base, 3);
    geo.setAttribute('aBase', this.baseAttribute);
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 2));
    geo.setAttribute('aColor', new InstancedBufferAttribute(color, 3));
    geo.instanceCount = n;
    this.geometry = geo;
    this.material = new ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: { uTime: U.uTime, uWind: U.uWind, uFogColor: U.uFogColor, uExposure: U.uExposure, uSmokeRate: { value: 1 }, uWorldScale: { value: worldScale }, uOpacity: { value: 0.5 } },
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = 'Bannerhold smoke';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Hides puffs whose source gate is closed (state changes only, never per frame). */
  applyGates(visible: (gate: StateGate | null) => boolean): void {
    for (let k = 0; k < this.gates.length; k++) this.base[k * 3 + 1] = visible(this.gates[k]) ? this.heights[k] : -1e5;
    this.baseAttribute.needsUpdate = true;
  }

  setRate(rate: number): void {
    this.material.uniforms.uSmokeRate.value = rate;
  }

  dispose(): void {
    this.geometry.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}
