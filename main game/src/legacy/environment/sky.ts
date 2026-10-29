// Sky dome per nation: zenith-to-horizon gradient with a dusk band all round the
// horizon, an eclipse disc with a diamond ring and streamered corona (Korvenia), a
// plain or veiled sun for other nations, faint stars in the eclipse dark and thin
// corona-lit cirrus. Output is linear HDR and goes through the scene tone mapping.

import * as THREE from "three";

export interface SkyParams {
  zenith: string;
  horizon: string;
  ground: string;
  band: string;
  corona: string;
  sunDir: THREE.Vector3;
  disc: "eclipse-corona" | "sun" | "veiled-sun" | "smog-disc";
  discRadiusDeg: number;
  /** Overall sky radiance multiplier. */
  intensity: number;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uBand;
uniform vec3 uCorona;
uniform vec3 uSunDir;
uniform float uDisc;
uniform float uEclipse;
uniform float uTime;
uniform float uIntensity;
varying vec3 vDir;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += n2(p) * a; p *= 2.03; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  float t = 1.0 - exp(-max(e, 0.0) * 5.5);
  vec3 col = mix(uHorizon * 0.62, uZenith, t);
  // Dusk band all round the horizon (eclipse light leaking in from beyond the shadow).
  float band = exp(-max(e, 0.0) * 16.0);
  col = mix(col, uBand, band * 0.9);
  float cosA = dot(d, uSunDir);
  float ang = acos(clamp(cosA, -1.0, 1.0));
  // Broad glow toward the light source, strongest along the horizon. Under the eclipse
  // the sky stays dark round the corona: only a faint, tighter glow remains.
  float glowK = uEclipse > 0.5 ? 0.18 : 1.0;
  col += uBand * (pow(max(cosA, 0.0), uEclipse > 0.5 ? 8.0 : 4.0) * 0.9 + pow(max(cosA, 0.0), 24.0) * 1.2) * (0.35 + band) * glowK;
  // Thin cirrus lit from the corona side.
  if (e > 0.0) {
    vec2 cp = d.xz / (e + 0.12) * 1.6 + vec2(uTime * 0.0015, 0.0);
    float c = smoothstep(0.58, 0.86, fbm(cp * vec2(1.0, 3.2)));
    float lit = 0.35 + 1.4 * pow(max(cosA, 0.0), 3.0);
    col = mix(col, mix(uZenith * 0.8, uBand * 1.2, lit * 0.6), c * 0.55 * smoothstep(0.0, 0.08, e) * (1.0 - smoothstep(0.35, 0.8, e)));
  }
  // Stars in the eclipse dark near the zenith.
  if (uEclipse > 0.5 && e > 0.15) {
    vec2 sp = d.xz / (e + 1.0) * 220.0;
    vec2 cell = floor(sp);
    float s = h21(cell);
    vec2 off = vec2(h21(cell + 7.1), h21(cell + 3.3)) - 0.5;
    float star = smoothstep(0.995, 1.0, s) * smoothstep(0.32, 0.0, length(fract(sp) - 0.5 - off * 0.6));
    col += vec3(0.9, 0.88, 1.0) * star * 1.6 * smoothstep(0.15, 0.5, e) * smoothstep(0.3, 0.6, ang);
  }
  if (uEclipse > 0.5) {
    vec3 sx = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
    vec3 sy = cross(sx, uSunDir);
    float phi = atan(dot(d, sy), dot(d, sx));
    float r = uDisc;
    float x = max(ang - r, 0.0);
    float streamers = 0.55 + 0.45 * n2(vec2(phi * 5.0, x * 30.0 - uTime * 0.01)) + 0.5 * pow(abs(sin(phi * 2.0 + 0.7)), 8.0) + 0.3 * pow(abs(sin(phi * 5.0 + 2.1)), 12.0);
    // Bright inner corona, long faint streamers and only a trace of wide halo, so the
    // disc reads as a black hole ringed with light rather than a washed-out sky.
    float corona = exp(-x / (r * 0.6)) * streamers * 2.0 + exp(-x / (r * 2.2)) * streamers * 0.32 + exp(-x / (r * 8.0)) * 0.05;
    float ring = exp(-abs(ang - r) / (r * 0.05)) * 3.5;
    float bead = exp(-length(vec2(phi - 2.4, (ang - r) / r * 6.0)) * 3.0) * 6.0;
    if (ang < r) {
      col = vec3(0.006, 0.005, 0.009) + uCorona * 0.015 * (1.0 - ang / r);
    } else {
      col += uCorona * (corona + ring + bead * step(ang, r * 1.25));
    }
  } else {
    float disc = smoothstep(uDisc, uDisc * 0.92, ang);
    col += uCorona * (disc * 8.0 + exp(-ang / (uDisc * 4.0)) * 0.6);
  }
  // Below the horizon: fade to the ground colour.
  if (e < 0.0) col = mix(mix(uBand, uHorizon, 0.5), uGround, clamp(-e * 7.0, 0.0, 1.0));
  gl_FragColor = vec4(col * uIntensity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(radius: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uBand: { value: new THREE.Color() },
        uCorona: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 0.3, -1) },
        uDisc: { value: 0.04 },
        uEclipse: { value: 1 },
        uTime: { value: 0 },
        uIntensity: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), this.material);
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  apply(p: SkyParams): void {
    const u = this.material.uniforms;
    (u.uZenith.value as THREE.Color).set(p.zenith);
    (u.uHorizon.value as THREE.Color).set(p.horizon);
    (u.uGround.value as THREE.Color).set(p.ground);
    (u.uBand.value as THREE.Color).set(p.band);
    (u.uCorona.value as THREE.Color).set(p.corona);
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir).normalize();
    u.uDisc.value = (p.discRadiusDeg * Math.PI) / 180;
    u.uEclipse.value = p.disc === "eclipse-corona" ? 1 : 0;
    u.uIntensity.value = p.intensity;
  }

  update(camera: THREE.Camera, time: number): void {
    this.mesh.position.copy(camera.position);
    this.mesh.updateMatrixWorld();
    this.material.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
