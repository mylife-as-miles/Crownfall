import * as THREE from "three";
import type { ReliefMarker } from "../../../../shared/chronicles/archive/relief";

// Hotspot markers standing on the relief: a ring laid on the ground at each
// nation's place, with a small bronze diamond floating above it. At rest the
// ring stays thin and faint so the painted names beside it remain legible;
// focus, hover and an open record brighten it. `ringScale` sizes the drawn
// ring against the shared one: the brief's 6% minimum is for pinching on
// Quest, and a smaller ring keeps clear of the painted lettering on desktop.
// Picking still reaches past the drawn ring.

export interface AtlasMarkers {
  group: THREE.Group;
  /** The emphasised marker (or -1) and the marker whose record is open (or -1). */
  setState(emphasized: number, open: number): void;
  /** Eases each marker toward its state; returns true while anything is still changing. */
  update(delta: number, time: number, still: boolean): boolean;
  /** The ring's centre in world space. */
  ringCentre(index: number, out: THREE.Vector3): THREE.Vector3;
  /** The top of the floating diamond in world space. */
  pinTop(index: number, out: THREE.Vector3): THREE.Vector3;
  /** The nearest marker the ray touches (or -1); `hitDistance` holds its distance along the ray. */
  pick(origin: THREE.Vector3, direction: THREE.Vector3): number;
  readonly hitDistance: number;
  dispose(): void;
}

const RING_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;

// Radii are in ring units: the ring sits at 1 and the quad reaches 1.7. A
// dark band under the gold keeps it readable over bright paint.
const RING_FRAGMENT = /* glsl */ `
  uniform float uEmphasis;
  uniform float uOpen;
  uniform float uTime;
  uniform vec3 uGold;
  uniform vec3 uHot;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - .5) * 3.4;
    float width = mix(.045, .085, max(uEmphasis, uOpen));
    float aa = fwidth(r) * 1.2;
    float ring = 1. - smoothstep(width - aa, width + aa, abs(r - 1.));
    float shade = exp(-pow((r - 1.) * 5.5, 2.)) * .5;
    float halo = exp(-pow((r - 1.) * 3.2, 2.)) * max(uEmphasis, uOpen * .8);
    float pulse = uOpen * (.5 + .5 * sin(uTime * 2.4)) * exp(-pow((r - 1.32) * 9., 2.)) * .55;
    float fill = uOpen * (1. - smoothstep(.0, 1., r)) * .16;
    vec3 gold = mix(uGold, uHot, max(uEmphasis, uOpen));
    float glow = halo * .55 + pulse + fill;
    float alpha = max(ring * mix(.62, 1., max(uEmphasis, uOpen)), shade * (1. - ring) * .7);
    vec3 color = gold * ring + uHot * glow;
    gl_FragColor = vec4(color, clamp(alpha + glow, 0., 1.));
    #include <colorspace_fragment>
  }
`;

export function createAtlasMarkers(markers: readonly ReliefMarker[], ringScale = 1): AtlasMarkers {
  const group = new THREE.Group();
  const quadGeometry = new THREE.PlaneGeometry(1, 1);
  quadGeometry.rotateX(-Math.PI / 2);
  const pinGeometry = new THREE.OctahedronGeometry(1, 0);
  const ringMaterials: THREE.ShaderMaterial[] = [];
  const pinMaterials: THREE.MeshStandardMaterial[] = [];
  const pins: THREE.Mesh[] = [];
  const emphasis = new Float32Array(markers.length);
  const opened = new Float32Array(markers.length);
  const goals = { emphasized: -1, open: -1 };
  const rings = markers.map((marker) => marker.ring * ringScale);
  const lift = rings.map((ring) => ring * 1.25);
  const pinSize = rings.map((ring) => ring * 0.36);
  let hitDistance = -1;
  const point = new THREE.Vector3();

  markers.forEach((marker, index) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      uniforms: {
        uEmphasis: { value: 0 }, uOpen: { value: 0 }, uTime: { value: 0 },
        uGold: { value: new THREE.Color("#c99a52") }, uHot: { value: new THREE.Color("#ffb453") },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(quadGeometry, material);
    ring.scale.setScalar(rings[index] * 3.4);
    ring.position.set(marker.x, marker.clearance + rings[index] * 0.06, marker.z);
    ring.renderOrder = 3;
    const pinMaterial = new THREE.MeshStandardMaterial({ color: "#c08a3e", roughness: 0.3, metalness: 0.7, emissive: "#f0901f", emissiveIntensity: 0.15 });
    const pin = new THREE.Mesh(pinGeometry, pinMaterial);
    pin.scale.set(pinSize[index], pinSize[index] * 1.75, pinSize[index]);
    pin.position.set(marker.x, marker.clearance + lift[index], marker.z);
    group.add(ring, pin);
    ringMaterials.push(material);
    pinMaterials.push(pinMaterial);
    pins.push(pin);
  });

  return {
    group,
    get hitDistance() { return hitDistance; },
    setState(emphasized, open) {
      goals.emphasized = emphasized;
      goals.open = open;
    },
    update(delta, time, still) {
      let changing = false;
      const rate = still ? 1 : 1 - Math.exp(-delta * 11);
      for (let index = 0; index < markers.length; index++) {
        const marker = markers[index];
        const emphasisGoal = goals.emphasized === index ? 1 : 0, openGoal = goals.open === index ? 1 : 0;
        emphasis[index] += (emphasisGoal - emphasis[index]) * rate;
        opened[index] += (openGoal - opened[index]) * rate;
        if (Math.abs(emphasis[index] - emphasisGoal) < 0.002) emphasis[index] = emphasisGoal;
        else changing = true;
        if (Math.abs(opened[index] - openGoal) < 0.002) opened[index] = openGoal;
        else changing = true;
        const strength = Math.max(emphasis[index], opened[index]);
        const uniforms = ringMaterials[index].uniforms;
        uniforms.uEmphasis.value = emphasis[index];
        uniforms.uOpen.value = opened[index];
        uniforms.uTime.value = time;
        pinMaterials[index].emissiveIntensity = 0.15 + strength * 0.9;
        const pin = pins[index];
        pin.position.y = marker.clearance + lift[index] * (1 + strength * 0.18) + (still ? 0 : Math.sin(time * 1.3 + index * 1.7) * rings[index] * 0.05);
        pin.rotation.y = still ? index * 0.4 : time * (0.45 + strength * 0.5) + index * 0.4;
      }
      return changing;
    },
    ringCentre(index, out) {
      const marker = markers[index];
      return out.set(marker.x, marker.clearance, marker.z);
    },
    pinTop(index, out) {
      const pin = pins[index];
      return out.set(pin.position.x, pin.position.y + pin.scale.y, pin.position.z);
    },
    pick(origin, direction) {
      let found = -1;
      hitDistance = -1;
      for (let index = 0; index < markers.length; index++) {
        const marker = markers[index];
        // The ring's plane, with a margin beyond the drawn ring.
        let distance = -1;
        if (Math.abs(direction.y) > 1e-6) {
          const t = (marker.clearance - origin.y) / direction.y;
          const x = origin.x + direction.x * t - marker.x, z = origin.z + direction.z * t - marker.z;
          if (t > 0 && x * x + z * z <= (rings[index] * 1.7) ** 2) distance = t;
        }
        // The floating diamond, as a sphere around it.
        point.copy(pins[index].position).sub(origin);
        const along = point.dot(direction);
        if (along > 0 && point.lengthSq() - along * along <= (pinSize[index] * 2.2) ** 2 && (distance < 0 || along < distance)) distance = along;
        if (distance >= 0 && (found < 0 || distance < hitDistance)) {
          found = index;
          hitDistance = distance;
        }
      }
      return found;
    },
    dispose() {
      quadGeometry.dispose();
      pinGeometry.dispose();
      for (const material of ringMaterials) material.dispose();
      for (const material of pinMaterials) material.dispose();
    },
  };
}
