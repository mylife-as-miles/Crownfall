// One shared shader patch for every Quest Bannerhold material (MeshBasicMaterial with
// baked vertex light). Uniform objects are shared, so a single write per frame reaches
// every material without recompiling. The look is self-contained: unlit, so the host
// scene's lights and IBL never change it, and tonemapped in-shader (toneMapped=false),
// so the host renderer's exposure never changes it either.

import { Color, Vector2, Vector3, Vector4 } from '@iwsdk/core';
import type { Material } from '@iwsdk/core';
import { VR_AHEAD_FADE, VR_SIDE_SOLID } from '../../../../shared/legacy/environment/vr/frame';

export interface QuestUniforms {
  uTime: { value: number };
  /** Motion scale: 1 normal, small under reduced motion, 0 when paused. */
  uMotion: { value: number };
  /** Wind toward (blueprint plan, unit) times gust strength. */
  uWind: { value: Vector3 };
  uHover: { value: number };
  uFocus: { value: number };
  uPulse: { value: number };
  uEmphasis: { value: Color };
  uFogColor: { value: Color };
  uHorizonColor: { value: Color };
  /** x max haze, y haze length (blueprint m), z/w distance band blending fog toward the horizon colour. */
  uHaze: { value: Vector4 };
  /** Blueprint metres from the eyes before haze begins (the holding itself stays crisp). */
  uHazeStart: { value: number };
  /** x depth below the datum where mist starts, y its range (blueprint m). */
  uMist: { value: Vector2 };
  uScaleInv: { value: number };
  /** Display centre x, z and cos/sin of the miniature yaw (viewer frame). */
  uFrame: { value: Vector4 };
  /** Detail half width, half depth, lateral and far skirt (blueprint m). */
  uExtent: { value: Vector4 };
  uDatum: { value: number };
  uExposure: { value: number };
  uSkyReflect: { value: Color };
  /** Sun direction in blueprint space (the miniature's content space) for the per-vertex relight. */
  uSunDir: { value: Vector3 };
  /** Relight: x ambient share, y sun share of n·L. */
  uRelight: { value: Vector2 };
  /** Unit-luminance tints of the ambient sky and of the key light. */
  uAmbTint: { value: Color };
  uSunTint: { value: Color };
  /** Occlusion reveal: the character's chest (content space). */
  uRevealA: { value: Vector3 };
  /** The viewer's head (content space). */
  uRevealB: { value: Vector3 };
  /** x radius (blueprint m), y strength 0–1, z noise amount, w rim. */
  uReveal: { value: Vector4 };
}

export function createQuestUniforms(): QuestUniforms {
  return {
    uTime: { value: 0 },
    uMotion: { value: 1 },
    uWind: { value: new Vector3(1, 0, 0) },
    uHover: { value: 0 },
    uFocus: { value: 0 },
    uPulse: { value: 0 },
    uEmphasis: { value: new Color(1.0, 0.72, 0.36) },
    uFogColor: { value: new Color(0.15, 0.13, 0.17) },
    uHorizonColor: { value: new Color(0.25, 0.2, 0.24) },
    uHaze: { value: new Vector4(0.86, 900, 700, 4200) },
    uHazeStart: { value: 150 },
    uMist: { value: new Vector2(6, 26) },
    uScaleInv: { value: 125 },
    uFrame: { value: new Vector4(0, 0, 1, 0) },
    uExtent: { value: new Vector4(60, 60, 70, 150) },
    uDatum: { value: 0 },
    uExposure: { value: 1 },
    uSkyReflect: { value: new Color(0.3, 0.28, 0.33) },
    uSunDir: { value: new Vector3(0, 0.5, -0.8).normalize() },
    uRelight: { value: new Vector2(0.78, 0.46) },
    uAmbTint: { value: new Color(1, 1, 1) },
    uSunTint: { value: new Color(1, 1, 1) },
    uRevealA: { value: new Vector3() },
    uRevealB: { value: new Vector3() },
    uReveal: { value: new Vector4(0.7, 0, 0.35, 1) },
  };
}

export interface PatchOptions {
  highlight?: boolean;
  /** Per-vertex key-light relight on top of the bake (architecture, props, foliage, cloth). */
  relight?: boolean;
  /** The carved section: its foot dissolves fully into the mist below the datum. */
  section?: boolean;
  /** Occluder variant: dithered capsule dissolve between the representative and the viewer. */
  reveal?: boolean;
  cloth?: { amplitude: number; frequency: number };
  sway?: { amplitude: number; frequency: number };
  flicker?: { rate: number; depth: number };
  water?: boolean;
}

/** ACES filmic (three.js fit) applied in-shader; shared by the sky so fog and sky always match. */
export const TONEMAP_GLSL = /* glsl */ `
vec3 bhRRT(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 bhTonemap(vec3 c, float exposure) {
  c *= exposure / 0.6;
  c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * c;
  c = bhRRT(c);
  c = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * c;
  return clamp(c, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform vec3 uWind;
uniform float uHover;
uniform float uFocus;
uniform float uPulse;
uniform vec3 uEmphasis;
uniform vec3 uFogColor;
uniform vec3 uHorizonColor;
uniform vec4 uHaze;
uniform float uHazeStart;
uniform vec2 uMist;
uniform float uScaleInv;
uniform vec4 uFrame;
uniform vec4 uExtent;
uniform float uDatum;
uniform float uExposure;
uniform vec3 uSkyReflect;
uniform vec3 uSunDir;
uniform vec2 uRelight;
uniform vec3 uAmbTint;
uniform vec3 uSunTint;
uniform vec3 uRevealA;
uniform vec3 uRevealB;
uniform vec4 uReveal;
#ifdef BH_REVEAL
varying vec3 vBhBp;
#endif
varying float vBhFog;
varying float vBhSun;
varying float vBhFar;
varying float vBhLm;
varying float vBhMotion;
varying vec3 vBhN;
varying vec3 vBhV;
`;

const VERTEX_HEAD = /* glsl */ `
attribute float landmarkId;
attribute float motionWeight;
#ifdef BH_CLOTH
uniform float uClothAmp;
uniform float uClothFreq;
#endif
#ifdef BH_SWAY
uniform float uSwayAmp;
uniform float uSwayFreq;
#endif
// Same expression and constants as presence() in shared/legacy/environment/vr/frame.ts.
float bhPresence(vec2 p) {
  vec2 d = p - uFrame.xy;
  float u = d.x * uFrame.z + d.y * uFrame.w;
  float v = -d.x * uFrame.w + d.y * uFrame.z;
  float side = 1.0 - smoothstep(uExtent.x + ${VR_SIDE_SOLID.toFixed(3)} * uExtent.z, uExtent.x + uExtent.z, abs(u));
  float outer = -(uExtent.y + uExtent.w);
  float ahead = 1.0 - smoothstep(outer - ${VR_AHEAD_FADE.toFixed(1)}, outer, v);
  return max(side, ahead);
}
`;

const VERTEX_DISPLACE = /* glsl */ `
#include <begin_vertex>
vBhLm = landmarkId;
vBhMotion = motionWeight;
#ifdef BH_CLOTH
{
  float ph = dot(position, vec3(0.9, 0.35, 0.7));
  float w = motionWeight * uMotion;
  float wave = sin(uTime * uClothFreq * 6.2831 + ph * 2.1) * 0.7 + sin(uTime * uClothFreq * 9.7 + ph * 3.3) * 0.3;
  transformed += normal * wave * uClothAmp * w;
}
#endif
#ifdef BH_SWAY
{
  float h = max(position.y, 0.0) / 12.0;
  vec2 seed = vec2(0.0);
#ifdef USE_INSTANCING
  seed = instanceMatrix[3].xz;
#endif
  float s = sin(uTime * uSwayFreq * 6.2831 + seed.x * 0.37 + seed.y * 0.23) * 0.65 + sin(uTime * uSwayFreq * 13.1 + seed.y) * 0.35;
  transformed.xz += uWind.xz * s * uSwayAmp * h * h * 3.0 * uMotion;
}
#endif
`;

const VERTEX_ATMOSPHERE = /* glsl */ `
#include <project_vertex>
{
  vec4 bhLocal = vec4(transformed, 1.0);
  vec3 bhNormal = normal;
#ifdef USE_INSTANCING
  bhLocal = instanceMatrix * bhLocal;
  bhNormal = mat3(instanceMatrix) * bhNormal;
#endif
  vec4 bhWorld = modelMatrix * bhLocal;
  float bhDist = length(bhWorld.xyz - cameraPosition) * uScaleInv;
  float bhHaze = uHaze.x * (1.0 - exp(-max(bhDist - uHazeStart, 0.0) / uHaze.y));
  float bhPres = bhPresence(bhLocal.xz);
  float bhMist = 1.0 - smoothstep(uDatum - uMist.x - uMist.y, uDatum - uMist.x, bhLocal.y);
#ifndef BH_SECTION
  // Low ground only takes a light valley mist; the carved section's foot dissolves fully.
  bhMist *= 0.35;
#endif
  vBhFog = 1.0 - (1.0 - bhHaze) * bhPres * (1.0 - bhMist);
  vBhFar = smoothstep(uHaze.z, uHaze.w, bhDist);
  vBhN = normalize(normalMatrix * bhNormal);
  vBhV = mvPosition.xyz;
  vBhSun = max(dot(normalize(bhNormal), uSunDir), 0.0);
#ifdef BH_REVEAL
  vBhBp = bhLocal.xyz;
#endif
}
`;

const FRAGMENT_HEAD = /* glsl */ `
#ifdef BH_REVEAL
float bhHash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float bhNoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bhHash3(i), bhHash3(i + vec3(1, 0, 0)), f.x), mix(bhHash3(i + vec3(0, 1, 0)), bhHash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(bhHash3(i + vec3(0, 0, 1)), bhHash3(i + vec3(1, 0, 1)), f.x), mix(bhHash3(i + vec3(0, 1, 1)), bhHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// 4x4 ordered-dither threshold in (0, 1), arithmetic only (no indexed constant arrays).
float bhBayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float bhBayer(vec2 p) {
  return bhBayer2(0.5 * p) * 0.25 + bhBayer2(p) + 0.03125;
}
#endif
#ifdef BH_FLICKER
uniform float uFlickerRate;
uniform float uFlickerDepth;
#endif
`;

const FRAGMENT_FINISH = /* glsl */ `
#ifdef BH_REVEAL
if (uReveal.y > 0.001) {
  // Capsule from the character's chest to the viewer's head, widening toward the head, with a
  // world-space noise edge (stable, no screen-space swimming) and dithered discard.
  vec3 ba = uRevealB - uRevealA;
  vec3 pa = vBhBp - uRevealA;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float d = length(pa - ba * h);
  float r = uReveal.x * (0.8 + 1.6 * h);
  // The noise moves the edge by at most half of uReveal.z * r: fragments beyond that skip the
  // noise, the dither and the rim entirely (most of the screen).
  if (d < r * (1.0 + 0.5 * uReveal.z) && h > 0.03) {
    float n = (bhNoise3(vBhBp * 0.55) - 0.5) * uReveal.z * r;
    float inside = (1.0 - smoothstep(r * 0.55, r, d + n)) * smoothstep(0.03, 0.09, h);
    float mask = inside * uReveal.y;
    if (mask > bhBayer(gl_FragCoord.xy)) discard;
    // Warm rim on the surviving fragments along the hole's edge only: mask is 0 outside the
    // capsule, so everything else keeps exactly the look of the plain material.
    float rim = smoothstep(0.0, 0.06, mask) * (1.0 - smoothstep(0.3, 0.55, mask)) * uReveal.w;
    outgoingLight += vec3(1.0, 0.62, 0.3) * rim * 0.2;
  }
}
#endif
#ifdef BH_RELIGHT
outgoingLight *= uAmbTint * uRelight.x + uSunTint * (uRelight.y * vBhSun);
#endif
#ifdef BH_FLICKER
{
  float t = uTime * uFlickerRate + vBhMotion * 17.0;
  outgoingLight *= 1.0 - uFlickerDepth * (0.5 + 0.5 * sin(t) * sin(t * 1.73 + 1.3) * sin(t * 0.61 + 4.1));
}
#endif
#ifdef BH_WATER
{
  vec3 n = normalize(vBhN);
  vec3 vd = normalize(-vBhV);
  float fr = pow(1.0 - clamp(dot(n, vd), 0.0, 1.0), 3.0);
  outgoingLight = mix(outgoingLight, uSkyReflect, 0.3 + 0.55 * fr);
}
#endif
#ifdef BH_HIGHLIGHT
if (vBhLm > 0.5) {
  float hov = 1.0 - step(0.5, abs(vBhLm - uHover));
  float foc = 1.0 - step(0.5, abs(vBhLm - uFocus));
  float k = max(hov * 0.65, foc * (0.8 + 0.2 * uPulse));
  if (k > 0.0) {
    vec3 n = normalize(vBhN);
    vec3 vd = normalize(-vBhV);
    float rim = pow(1.0 - clamp(abs(dot(n, vd)), 0.0, 1.0), 2.0);
    outgoingLight = outgoingLight * (1.0 + 0.5 * k) + uEmphasis * (0.05 + rim * 0.55) * k;
  }
}
#endif
{
  vec3 bhFogCol = mix(uFogColor, uHorizonColor, vBhFar);
  outgoingLight = mix(outgoingLight, bhFogCol, clamp(vBhFog, 0.0, 1.0));
  outgoingLight = bhTonemap(outgoingLight, uExposure);
}
#include <opaque_fragment>
`;

let serial = 0;

/** Patches a MeshBasicMaterial in place with the shared Bannerhold chunk. */
export function patchQuestMaterial(mat: Material, U: QuestUniforms, opts: PatchOptions = {}): void {
  const local: Record<string, { value: unknown }> = {};
  const defines: string[] = [];
  if (opts.highlight) defines.push('#define BH_HIGHLIGHT');
  if (opts.cloth) {
    defines.push('#define BH_CLOTH');
    local.uClothAmp = { value: opts.cloth.amplitude };
    local.uClothFreq = { value: opts.cloth.frequency };
  }
  if (opts.sway) {
    defines.push('#define BH_SWAY');
    local.uSwayAmp = { value: opts.sway.amplitude };
    local.uSwayFreq = { value: opts.sway.frequency };
  }
  if (opts.flicker) {
    defines.push('#define BH_FLICKER');
    local.uFlickerRate = { value: opts.flicker.rate };
    local.uFlickerDepth = { value: opts.flicker.depth };
  }
  if (opts.water) defines.push('#define BH_WATER');
  if (opts.relight) defines.push('#define BH_RELIGHT');
  if (opts.section) defines.push('#define BH_SECTION');
  if (opts.reveal) defines.push('#define BH_REVEAL');
  const key = `bhq:${defines.join(',')}`;
  mat.toneMapped = false;
  mat.customProgramCacheKey = () => key;
  mat.userData.bhPatch = ++serial;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, local);
    const head = defines.join('\n') + '\n' + COMMON;
    shader.vertexShader = head + VERTEX_HEAD + shader.vertexShader
      .replace('#include <begin_vertex>', VERTEX_DISPLACE)
      .replace('#include <project_vertex>', VERTEX_ATMOSPHERE);
    shader.fragmentShader = head + TONEMAP_GLSL + FRAGMENT_HEAD + shader.fragmentShader
      .replace('#include <opaque_fragment>', FRAGMENT_FINISH);
  };
  mat.needsUpdate = true;
}
