// Lighting and atmosphere from the blueprint: key light from the nation's light
// source (one bounded PCF-soft shadow map fitted to the settlement), hemisphere
// ambient, practical point lights, sky parameters and fog tuning.

import * as THREE from "three";
import type { AtmosphereDefinition } from "../../../../shared/legacy/environment/blueprint/types";
import type { Bounds3, LocalLight } from "../../../../shared/legacy/environment/kernel/mesh";
import type { SharedUniforms } from "./shaderPatches";
import type { SkyParams } from "./sky";

export function sunVector(a: AtmosphereDefinition): THREE.Vector3 {
  const b = (a.sun.bearingDeg * Math.PI) / 180;
  const e = (a.sun.elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)).normalize();
}

/** Same hue, scaled to a linear Rec. 709 luminance. */
function withLuminance(c: THREE.Color, target: number): THREE.Color {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l > 1e-5 ? c.clone().multiplyScalar(target / l) : new THREE.Color(target, target, target);
}

function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
}

export function skyParams(a: AtmosphereDefinition): SkyParams {
  return {
    zenith: a.sky.zenith,
    horizon: a.sky.horizon,
    ground: a.sky.ground,
    // Eclipse light leaks in all round the horizon as a warm band under the violet dark.
    band: a.sun.disc === "eclipse-corona" ? mixHex(a.sky.horizon, "#d39a7c", 0.55) : mixHex(a.sky.horizon, a.palette.corona ?? "#e8e0f0", 0.35),
    corona: a.palette.corona ?? a.sun.colour,
    sunDir: sunVector(a),
    disc: a.sun.disc,
    discRadiusDeg: a.sun.disc === "eclipse-corona" ? 2.2 : 1.2,
    intensity: 1.15,
  };
}

export interface LightRig {
  key: THREE.DirectionalLight;
  /** Weak shadowless fill from the opposite horizon (the warm band's bounce). */
  fill: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  points: { light: THREE.PointLight; base: number; flicker: number; seed: number }[];
  group: THREE.Group;
}

export function createLightRig(a: AtmosphereDefinition, bounds: Bounds3, lights: readonly LocalLight[], maxLights: number, shadowSize: number): LightRig {
  const group = new THREE.Group();
  group.name = "lights";
  const dir = sunVector(a);
  const key = new THREE.DirectionalLight(new THREE.Color(a.sun.colour), a.sun.intensity * 3.4);
  const cx = (bounds.min[0] + bounds.max[0]) / 2, cy = (bounds.min[1] + bounds.max[1]) / 2, cz = (bounds.min[2] + bounds.max[2]) / 2;
  const center = new THREE.Vector3(cx, cy, cz);
  key.position.copy(center).addScaledVector(dir, 400);
  key.target.position.copy(center);
  group.add(key, key.target);
  if (shadowSize > 0) {
    key.castShadow = true;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.04;
    // Fit the orthographic shadow camera to the settlement bounds in light space.
    const look = new THREE.Matrix4().lookAt(key.position, center, new THREE.Vector3(0, 1, 0));
    const inv = look.clone().invert();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? bounds.max[0] : bounds.min[0], i & 2 ? bounds.max[1] : bounds.min[1], i & 4 ? bounds.max[2] : bounds.min[2]);
      p.sub(key.position).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const cam = key.shadow.camera;
    cam.left = minX - 4;
    cam.right = maxX + 4;
    cam.bottom = minY - 4;
    cam.top = maxY + 4;
    cam.near = Math.max(1, -maxZ - 60);
    cam.far = -minZ + 260;
    cam.updateProjectionMatrix();
  }
  // Ambient: the sky's hue above and the ground's below, each normalised to a fixed
  // luminance so a dark authored sky still lights shadowed streets ("the ambient never
  // black"); the blueprint's ambientIntensity scales the result.
  const skyAmb = new THREE.Color(a.sky.horizon).lerp(new THREE.Color(a.sky.zenith), 0.35);
  const grey = (skyAmb.r + skyAmb.g + skyAmb.b) / 3;
  skyAmb.lerp(new THREE.Color(grey, grey, grey), 0.35);
  const hemi = new THREE.HemisphereLight(withLuminance(skyAmb, 0.42), withLuminance(new THREE.Color(a.sky.ground), 0.09), a.sky.ambientIntensity * 2);
  group.add(hemi);
  // Fill from the far horizon opposite the key: shadowed faces pick up the band's warmth.
  const fb = ((a.sun.bearingDeg + 180) * Math.PI) / 180;
  const fill = new THREE.DirectionalLight(new THREE.Color(a.sun.disc === "eclipse-corona" ? "#c08a78" : a.sky.horizon), a.sun.intensity * 0.45);
  fill.position.set(center.x + Math.sin(fb) * 300, center.y + 60, center.z - Math.cos(fb) * 300);
  fill.target.position.copy(center);
  group.add(fill, fill.target);
  const points: LightRig["points"] = [];
  for (let i = 0; i < Math.min(maxLights, lights.length); i++) {
    const l = lights[i];
    const pl = new THREE.PointLight(new THREE.Color(l.color), l.intensity * 1.6, l.range, 2);
    pl.position.set(l.position[0], l.position[1], l.position[2]);
    group.add(pl);
    points.push({ light: pl, base: l.intensity * 1.6, flicker: l.flicker, seed: i * 1.37 });
  }
  return { key, fill, hemi, points, group };
}

export function updateLights(rig: LightRig, time: number): void {
  for (const p of rig.points) {
    if (p.flicker <= 0) continue;
    const t = time * 7 + p.seed * 10;
    const n = Math.sin(t) * Math.sin(t * 1.71 + 1.3) * Math.sin(t * 0.53 + 4.1);
    p.light.intensity = p.base * (1 - p.flicker * 0.25 * (0.5 + 0.5 * n));
  }
}

export function applyFog(U: SharedUniforms, a: AtmosphereDefinition): void {
  const fog = new THREE.Color(a.fog.colour).lerp(new THREE.Color(a.sky.horizon), 0.2).multiplyScalar(0.92);
  U.uFogColor.value.copy(fog);
  U.uFogSunColor.value.copy(new THREE.Color(a.sky.horizon).lerp(new THREE.Color(a.sun.disc === "eclipse-corona" ? "#c99078" : a.palette.corona ?? a.sun.colour), 0.45));
  U.uSunDir.value.copy(sunVector(a));
  // Exponential height fog roughly reaching two thirds at the blueprint's far distance.
  U.uFogParams.value.set(1.1 / Math.max(a.fog.far, 300), Math.max(a.fog.heightFalloff, 0.002), 0, 0.97);
  const b = (a.wind.towardBearingDeg * Math.PI) / 180;
  U.uWind.value.set(Math.sin(b), 0, -Math.cos(b)).multiplyScalar(Math.min(1.5, a.wind.speed / 4));
}
