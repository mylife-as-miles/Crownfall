// The nation's sky around the Quest miniature: an infinitely distant dome (stereo at
// infinity, pinned to the far plane, drawn after opaque geometry so covered pixels are
// never shaded) with the blueprint atmosphere's sun treatment, a dusk band, and a sea of
// mist below the horizon into which the miniature's rim and the far land dissolve. It
// shares the fog, horizon and exposure uniforms with every material, so they always match.

import { BackSide, Color, IcosahedronGeometry, Mesh, ShaderMaterial, Vector3 } from '@iwsdk/core';
import type { AtmosphereDefinition } from '../../../../shared/legacy/environment/blueprint/types';
import { TONEMAP_GLSL } from './shaderPatch';
import type { QuestUniforms } from './shaderPatch';

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec3 d = normalize(mat3(modelMatrix) * position);
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * d, 1.0);
  clip.z = clip.w * 0.999999;
  gl_Position = clip;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizonColor;
uniform vec3 uFogColor;
uniform vec3 uGround;
uniform vec3 uBand;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uDisc;
uniform float uExposure;
varying vec3 vDir;
${TONEMAP_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 sky = mix(uHorizonColor, uZenith, pow(clamp(y, 0.0, 1.0), 0.38));
  sky += uBand * exp(-max(y, 0.0) * 16.0);
  vec3 below = mix(uHorizonColor, uFogColor, smoothstep(0.0, 0.16, -y));
  below = mix(below, uGround, smoothstep(0.3, 1.0, -y));
  vec3 col = y >= 0.0 ? sky : below;
  vec3 s = normalize(uSunDir);
  float mu = clamp(dot(d, s), -1.0, 1.0);
  float ang = acos(mu);
  vec3 sunCol = uSunColor * uSunIntensity;
  if (uDisc < 0.5) {
    // A low sun under broken cloud: a bright disc, a tight glow and a broad warm halo.
    col += sunCol * (smoothstep(0.034, 0.026, ang) * 5.0 + exp(-ang * 9.0) * 0.9 + exp(-ang * 2.2) * 0.22);
  } else if (uDisc < 1.5) {
    // Eclipse: a black disc, a thin diamond-ring limb and a streamered corona.
    float r = ang / 0.04;
    vec3 t1 = normalize(cross(s, abs(s.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(s, t1);
    float phi = atan(dot(d, t2), dot(d, t1));
    float streak = 0.55 + 0.3 * sin(phi * 7.0 + sin(phi * 3.0) * 1.7) + 0.15 * sin(phi * 19.0);
    float corona = r > 1.0 ? exp(-(r - 1.0) * (1.25 + 0.8 * (1.0 - streak))) * streak : 0.0;
    float ring = exp(-pow((r - 1.0) * 14.0, 2.0));
    col += sunCol * (corona * 1.1 + ring * 2.6 + exp(-ang * 2.4) * 0.12);
    col = mix(col, vec3(0.012, 0.01, 0.016), smoothstep(1.0, 0.96, r));
  } else if (uDisc < 2.5) {
    // Veiled sun in mineral haze: no crisp disc, a broad bright veil.
    col += sunCol * (exp(-ang * 4.5) * 1.3 + exp(-ang * 1.4) * 0.3 + smoothstep(0.06, 0.03, ang) * 1.2);
  } else {
    // Smog disc: a flat, soft-edged disc the eye can rest on, little glow.
    col += sunCol * (smoothstep(0.05, 0.042, ang) * 2.4 + exp(-ang * 5.0) * 0.45);
  }
  gl_FragColor = vec4(bhTonemap(col, uExposure), 1.0);
  #include <colorspace_fragment>
}
`;

function discCode(disc: AtmosphereDefinition['sun']['disc']): number {
  return disc === 'sun' ? 0 : disc === 'eclipse-corona' ? 1 : disc === 'veiled-sun' ? 2 : 3;
}

export class QuestSky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly geometry = new IcosahedronGeometry(1, 3);

  constructor(U: QuestUniforms) {
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: BackSide,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      uniforms: {
        uZenith: { value: new Color() },
        uHorizonColor: U.uHorizonColor,
        uFogColor: U.uFogColor,
        uGround: { value: new Color() },
        uBand: { value: new Color() },
        uSunDir: { value: new Vector3(0, 0.3, -1) },
        uSunColor: { value: new Color() },
        uSunIntensity: { value: 1 },
        uDisc: { value: 1 },
        uExposure: U.uExposure,
      },
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'Bannerhold sky';
    this.mesh.frustumCulled = false;
    // Opaque but drawn last among opaques: depth-tested at the far plane, so only uncovered pixels shade.
    this.mesh.renderOrder = 1e6;
  }

  /** Applies a nation's atmosphere; the dome's local frame is the blueprint frame. */
  apply(a: AtmosphereDefinition): void {
    const u = this.material.uniforms;
    (u.uZenith.value as Color).set(a.sky.zenith);
    (u.uGround.value as Color).set(a.sky.ground).lerp(new Color(a.fog.colour), 0.35);
    const sun = new Color(a.sun.colour);
    const band = a.sun.disc === 'eclipse-corona' ? new Color('#b8879a').multiplyScalar(0.22) : sun.clone().multiplyScalar(0.18);
    (u.uBand.value as Color).copy(band);
    (u.uSunColor.value as Color).copy(sun);
    u.uSunIntensity.value = a.sun.intensity * 0.55;
    u.uDisc.value = discCode(a.sun.disc);
    const b = (a.sun.bearingDeg * Math.PI) / 180, e = (a.sun.elevationDeg * Math.PI) / 180;
    (u.uSunDir.value as Vector3).set(Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
