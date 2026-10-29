// Shader patches applied to three.js standard materials through onBeforeCompile:
// analytic height fog with sun in-scattering (replacing three's fog), landmark rim
// highlight from a per-vertex landmark id, wind on cloth and foliage, fire flicker
// and terrain splat detail. Uniforms are shared objects so one update reaches every
// material without recompiling.

import * as THREE from "three";

export interface SharedUniforms {
  uTime: { value: number };
  uWind: { value: THREE.Vector3 };
  uHighlight: { value: number };
  uHighlightColor: { value: THREE.Color };
  uFogColor: { value: THREE.Color };
  uFogSunColor: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  /** x density, y height falloff, z base height, w max opacity */
  uFogParams: { value: THREE.Vector4 };
  uMotionScale: { value: number };
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(1, 0, 0) },
    uHighlight: { value: 0 },
    uHighlightColor: { value: new THREE.Color(1.0, 0.78, 0.42) },
    uFogColor: { value: new THREE.Color(0.4, 0.37, 0.43) },
    uFogSunColor: { value: new THREE.Color(0.8, 0.75, 0.86) },
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    uFogParams: { value: new THREE.Vector4(0.0012, 0.012, 0, 0.96) },
    uMotionScale: { value: 1 },
  };
}

export interface PatchOptions {
  /** Cloth wave from motionWeight. */
  cloth?: { amplitude: number; frequency: number };
  /** Foliage sway by local height (instanced vegetation). */
  sway?: { amplitude: number; frequency: number };
  /** Emissive flicker from motionWeight phase. */
  flicker?: { rate: number; depth: number };
  /** Terrain splat detail textures (4 layers): luminance detail normalised by each set's mean. */
  splat?: { layers: (THREE.Texture | null)[]; scales: number[]; gains: number[] };
  /** Distance multiplier for fog (silhouettes and skyline read as layered planes). */
  fogDistanceScale?: number;
  /** Disable landmark highlight (sky, far terrain). */
  noHighlight?: boolean;
}

const FOG_CHUNK = /* glsl */ `
  {
    vec3 bhRay = vBhWorld - cameraPosition;
    float bhDist = length(bhRay) * BH_FOG_SCALE;
    vec3 bhDir = bhRay / max(length(bhRay), 1e-4);
    float bhA = uFogParams.x;
    float bhB = max(uFogParams.y, 1e-5);
    float bhCamH = cameraPosition.y - uFogParams.z;
    float bhRy = bhDir.y;
    float bhAmount;
    if (abs(bhRy) < 1e-3) bhAmount = bhA * exp(-bhB * bhCamH) * bhDist;
    else bhAmount = (bhA / bhB) * exp(-bhCamH * bhB) * (1.0 - exp(-bhDist * bhRy * bhB)) / bhRy;
    float bhFog = clamp(1.0 - exp(-max(bhAmount, 0.0)), 0.0, uFogParams.w);
    float bhSun = pow(max(dot(bhDir, uSunDir), 0.0), 6.0);
    vec3 bhFogCol = mix(uFogColor, uFogSunColor, bhSun * 0.85);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, bhFogCol, bhFog);
  }
`;

let patchSerial = 0;

/** Patches a MeshStandardMaterial (or Lambert/Basic) in place. */
export function patchMaterial(mat: THREE.Material, U: SharedUniforms, opts: PatchOptions = {}): void {
  const key = JSON.stringify({ c: !!opts.cloth, s: !!opts.sway, f: !!opts.flicker, t: !!opts.splat, d: opts.fogDistanceScale ?? 1, h: !opts.noHighlight, sl: opts.splat ? opts.splat.layers.map((l) => !!l) : null });
  const local: Record<string, { value: unknown }> = {};
  if (opts.cloth) {
    local.uClothAmp = { value: opts.cloth.amplitude };
    local.uClothFreq = { value: opts.cloth.frequency };
  }
  if (opts.sway) {
    local.uSwayAmp = { value: opts.sway.amplitude };
    local.uSwayFreq = { value: opts.sway.frequency };
  }
  if (opts.flicker) {
    local.uFlickerRate = { value: opts.flicker.rate };
    local.uFlickerDepth = { value: opts.flicker.depth };
  }
  if (opts.splat) {
    opts.splat.layers.forEach((t, i) => (local[`tSplat${i}`] = { value: t }));
    local.uSplatScale = { value: new THREE.Vector4(...(opts.splat.scales as [number, number, number, number])) };
    local.uSplatGain = { value: new THREE.Vector4(...(opts.splat.gains as [number, number, number, number])) };
  }
  mat.customProgramCacheKey = () => `bh:${key}`;
  mat.userData.bhPatch = ++patchSerial;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, local);
    const defines: string[] = [`#define BH_FOG_SCALE ${(opts.fogDistanceScale ?? 1).toFixed(4)}`];
    if (opts.cloth) defines.push("#define BH_CLOTH");
    if (opts.sway) defines.push("#define BH_SWAY");
    if (opts.flicker) defines.push("#define BH_FLICKER");
    if (opts.splat) defines.push("#define BH_SPLAT");
    if (!opts.noHighlight) defines.push("#define BH_HIGHLIGHT");
    const head = defines.join("\n") + `
uniform float uTime;
uniform vec3 uWind;
uniform float uHighlight;
uniform vec3 uHighlightColor;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform vec3 uSunDir;
uniform vec4 uFogParams;
uniform float uMotionScale;
varying vec3 vBhWorld;
varying float vBhLandmark;
varying float vBhMotion;
#ifdef BH_SPLAT
varying vec4 vBhSplat;
varying vec2 vBhUv;
#endif
`;
    shader.vertexShader = head + `
attribute float landmarkId;
attribute float motionWeight;
#ifdef BH_SPLAT
attribute vec4 splat;
#endif
#ifdef BH_CLOTH
uniform float uClothAmp;
uniform float uClothFreq;
#endif
#ifdef BH_SWAY
uniform float uSwayAmp;
uniform float uSwayFreq;
#endif
` + shader.vertexShader
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  vBhLandmark = landmarkId;
  vBhMotion = motionWeight;
#ifdef BH_SPLAT
  vBhSplat = splat;
  vBhUv = uv;
#endif
#ifdef BH_CLOTH
  {
    float ph = dot(position, vec3(0.9, 0.35, 0.7));
    float w = motionWeight * uMotionScale;
    float wave = sin(uTime * uClothFreq * 6.2831 + ph * 2.1) * 0.7 + sin(uTime * uClothFreq * 9.7 + ph * 3.3) * 0.3;
    transformed += normal * wave * uClothAmp * w;
    transformed.y += cos(uTime * uClothFreq * 4.0 + ph) * uClothAmp * 0.25 * w;
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
    transformed.xz += uWind.xz * s * uSwayAmp * h * h * 3.0 * uMotionScale;
  }
#endif`)
      .replace("#include <project_vertex>", `#include <project_vertex>
  {
    vec4 bhW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
    bhW = instanceMatrix * bhW;
#endif
    vBhWorld = (modelMatrix * bhW).xyz;
  }`);
    let frag = head + (opts.splat ? `
uniform sampler2D tSplat0;
uniform sampler2D tSplat1;
uniform sampler2D tSplat2;
uniform sampler2D tSplat3;
uniform vec4 uSplatScale;
uniform vec4 uSplatGain;
vec3 bhDetail(vec3 t, float gain) {
  float l = dot(t, vec3(0.2126, 0.7152, 0.0722)) * gain;
  return clamp(mix(vec3(l), t * gain, 0.18), 0.0, 2.5);
}
` : "") + (opts.flicker ? `
uniform float uFlickerRate;
uniform float uFlickerDepth;
` : "") + shader.fragmentShader;
    if (opts.splat) {
      const has = opts.splat.layers.map((l) => !!l);
      const c = ["x", "y", "z", "w"];
      const sample = (i: number) => (has[i] ? `bhDetail(texture2D(tSplat${i}, vBhUv / uSplatScale.${c[i]}).rgb, uSplatGain.${c[i]})` : "vec3(1.0)");
      frag = frag.replace("#include <map_fragment>", `#include <map_fragment>
  {
    vec3 bhD = ${sample(0)} * vBhSplat.x + ${sample(1)} * vBhSplat.y + ${sample(2)} * vBhSplat.z + ${sample(3)} * vBhSplat.w;
    diffuseColor.rgb *= bhD;
  }`);
    }
    if (opts.flicker) {
      frag = frag.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  {
    float t = uTime * uFlickerRate + vBhMotion * 17.0;
    float f = 1.0 - uFlickerDepth * (0.5 + 0.5 * sin(t) * sin(t * 1.73 + 1.3) * sin(t * 0.61 + 4.1));
    totalEmissiveRadiance *= f;
  }`);
    }
    frag = frag.replace("#include <opaque_fragment>", `
#ifdef BH_HIGHLIGHT
  if (uHighlight > 0.5 && abs(vBhLandmark - uHighlight) < 0.5) {
    float rim = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
    outgoingLight += uHighlightColor * (0.06 + rim * 0.55);
  }
#endif
#include <opaque_fragment>`);
    // Fog in linear HDR before tone mapping (three applies its own fog after it).
    frag = frag.replace("#include <tonemapping_fragment>", FOG_CHUNK + "\n#include <tonemapping_fragment>");
    frag = frag.replace("#include <fog_fragment>", "");
    shader.fragmentShader = frag;
  };
  mat.needsUpdate = true;
}
