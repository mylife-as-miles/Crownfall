import * as THREE from "three";
import { RELIEF_ASPECT, RELIEF_DETAILS, RELIEF_LANDFORMS, reliefHeightAt, type ReliefLandform } from "../../../../shared/chronicles/archive/relief";
import type { Quality } from "../../settings-types";
import { surfacePoint } from "./atlas-set";

// Restrained living details placed from the shared relief data: sea shimmer,
// drifting mist, the eclipse corona, lava glow and sparks, the falls and the
// rivers, and dust in the lamplight. Every motion is a shader function of one
// shared time uniform, so a frame costs a single uniform write and reduced
// motion simply stops the clock.

export interface AtlasDetails {
  group: THREE.Group;
  /** Advances every motion; held still, the sparks and dust (which are only motion) are hidden. */
  update(time: number, still: boolean): void;
  /** Point sprites keep their world size: drawing-buffer height and vertical field of view in degrees. */
  resize(height: number, fov: number): void;
  dispose(): void;
}

const NOISE = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float value = 0., amplitude = .5;
    for (int octave = 0; octave < 4; octave++) {
      value += amplitude * noise(p);
      p = p * 2.03 + 17.1;
      amplitude *= .5;
    }
    return value;
  }
`;

const SURFACE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uLight;
  varying vec3 vWorld;
  ${NOISE}
  void main() {
    vec2 p = vWorld.xz * 52.;
    float a = noise(p + vec2(uTime * .23, uTime * .14));
    float b = noise(p * 1.9 + vec2(-uTime * .17, uTime * .25));
    vec3 normal = normalize(vec3((a - .5) * .9 + (b - .5) * .5, 1., (b - .5) * .9 - (a - .5) * .5));
    vec3 view = normalize(cameraPosition - vWorld);
    float spec = pow(max(dot(normal, normalize(uLight + view)), 0.), 120.);
    float fresnel = pow(1. - max(view.y, 0.), 3.);
    vec3 color = mix(vec3(.03, .075, .09), vec3(.3, .34, .36), fresnel) + vec3(1., .9, .74) * spec * 1.5;
    gl_FragColor = vec4(color, .16 + fresnel * .2 + min(spec, 1.) * .55);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const MIST_VERTEX = /* glsl */ `
  attribute vec2 aMist;
  varying vec2 vUv;
  varying vec2 vMist;
  void main() {
    vUv = uv;
    vMist = aMist;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
  }
`;

const MIST_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec2 vMist;
  ${NOISE}
  void main() {
    vec2 p = (vUv - .5) * 2.;
    float bank = 1. - smoothstep(.3, 1., length(p));
    float wisps = smoothstep(.36, .8, fbm(vUv * 3.4 + vMist.x * 9.7 + vec2(uTime * .011, uTime * .006)));
    float alpha = bank * wisps * vMist.y;
    if (alpha < .004) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GLOW_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aGlow;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vGlow;
  void main() {
    vUv = uv;
    vColor = aColor;
    vGlow = aGlow;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.);
  }
`;

// aGlow: seed, strength, flicker (0 holds steady) and shape (0 a pool of
// light, 1 the eclipse's ring corona, which breathes instead of flickering).
const GLOW_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec4 vGlow;
  void main() {
    float d = length(vUv - .5) * 2.;
    float pool = exp(-d * d * 5.);
    float corona = exp(-pow((d - .58) * 6.5, 2.)) + pool * .2;
    float glow = mix(pool, corona, vGlow.w) * (1. - smoothstep(.82, 1., d));
    float seed = vGlow.x * 61.;
    float flicker = 1. - vGlow.z * (.3 + .3 * sin(uTime * 6.3 + seed) * sin(uTime * 2.1 + seed * 1.7) + .15 * sin(uTime * 12.9 + seed * 3.1));
    float breath = mix(1., .8 + .2 * sin(uTime * .55), vGlow.w);
    gl_FragColor = vec4(vColor * glow * vGlow.y * flicker * breath, 1.);
    #include <colorspace_fragment>
  }
`;

const SPARK_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vLife;
  void main() {
    float life = fract(uTime * (.07 + aSeed * .06) + aSeed * 7.31);
    vec3 p = position;
    p.y += life * (.026 + aSeed * .03);
    p.x += sin(life * 5. + aSeed * 40.) * .004 + (aSeed - .5) * .01 * life;
    p.z += cos(life * 4.3 + aSeed * 23.) * .003;
    vLife = life;
    vec4 view = modelViewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * view;
    gl_PointSize = uScale * (.0014 + aSeed * .0012) * (1. - life * .6) / -view.z;
  }
`;

const SPARK_FRAGMENT = /* glsl */ `
  varying float vLife;
  void main() {
    float d = length(gl_PointCoord - .5) * 2.;
    float alpha = exp(-d * d * 4.) * smoothstep(1., .65, vLife) * smoothstep(0., .06, vLife);
    gl_FragColor = vec4(mix(vec3(1., .8, .4), vec3(.95, .25, .06), vLife) * alpha * 1.3, 1.);
    #include <colorspace_fragment>
  }
`;

const DUST_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * .07 + aSeed * 31.) * .022;
    p.y += sin(uTime * .05 + aSeed * 17.) * .012;
    p.z += cos(uTime * .06 + aSeed * 23.) * .02;
    vAlpha = .3 + .7 * (.5 + .5 * sin(uTime * (.35 + aSeed * .5) + aSeed * 60.));
    vec4 view = modelViewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * view;
    gl_PointSize = uScale * (.0016 + aSeed * .0018) / -view.z;
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - .5) * 2.;
    gl_FragColor = vec4(vec3(1., .86, .62) * exp(-d * d * 6.) * vAlpha * .2, 1.);
    #include <colorspace_fragment>
  }
`;

const FALLS_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float n = noise(vec2(vUv.x * 9., vUv.y * 2.4 - uTime * 1.3)) * .6 + noise(vec2(vUv.x * 23., vUv.y * 4.2 - uTime * 2.)) * .4;
    float edge = smoothstep(0., .3, vUv.x) * smoothstep(1., .7, vUv.x) * smoothstep(0., .12, vUv.y) * smoothstep(1., .72, vUv.y);
    gl_FragColor = vec4(vec3(.82, .9, .94) * smoothstep(.42, .86, n) * edge * .4, 1.);
    #include <colorspace_fragment>
  }
`;

const RIVER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float flow = noise(vec2(vUv.x * 1.4 - uTime * .85, vUv.y * 3.));
    float edge = smoothstep(0., .35, vUv.y) * smoothstep(1., .65, vUv.y);
    gl_FragColor = vec4(vec3(.76, .86, .92) * smoothstep(.6, .95, flow) * edge * .2, 1.);
    #include <colorspace_fragment>
  }
`;

type Cone = Extract<ReliefLandform, { kind: "cone" }>;

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function createAtlasDetails(quality: Quality, light: THREE.Vector3): AtlasDetails {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const time = { value: 0 };
  const kinetic: THREE.Object3D[] = [];
  const scale = { value: 600 };
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const random = seededRandom(2048);
  const additive = (fragmentShader: string, vertexShader = SURFACE_VERTEX, uniforms: Record<string, THREE.IUniform> = { uTime: time }) => {
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    materials.push(material);
    return material;
  };

  // One sheet just above sea level: the relief hides it everywhere but the seas.
  const waterGeometry = new THREE.PlaneGeometry(0.996, RELIEF_ASPECT * 0.996);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERTEX, fragmentShader: WATER_FRAGMENT,
    uniforms: { uTime: time, uLight: { value: light.clone().normalize() } },
    transparent: true, depthWrite: false,
  });
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.y = 0.0004;
  geometries.push(waterGeometry);
  materials.push(waterMaterial);

  // Each mist bank is a few soft sheets stacked through its lift band.
  const layers = quality === "low" ? 1 : 3;
  const sheet = new THREE.PlaneGeometry(1, 1);
  sheet.rotateX(-Math.PI / 2);
  const mistMaterial = new THREE.ShaderMaterial({
    vertexShader: MIST_VERTEX, fragmentShader: MIST_FRAGMENT,
    uniforms: { uTime: time, uColor: { value: new THREE.Color("#d8cfbf") } },
    transparent: true, depthWrite: false,
  });
  const mist = new THREE.InstancedMesh(sheet, mistMaterial, RELIEF_DETAILS.mist.length * layers);
  const mistData = new Float32Array(mist.count * 2);
  RELIEF_DETAILS.mist.forEach((bank, index) => {
    const ground = reliefHeightAt(bank.at[0], bank.at[1]);
    const x = bank.at[0] - 0.5, z = (bank.at[1] - 0.5) * RELIEF_ASPECT;
    for (let layer = 0; layer < layers; layer++) {
      const share = layers > 1 ? layer / (layers - 1) : 0.5;
      const slot = index * layers + layer;
      const height = ground + bank.lift[0] + (bank.lift[1] - bank.lift[0]) * share;
      const spread = 1.25 - share * 0.25;
      // Sheets stay over the slab, also as seen from the south: a raised sheet
      // near the north edge would otherwise hang out over the table.
      const halfX = Math.min(bank.reach[0] * spread, 0.5 - Math.abs(x) - 0.012);
      const halfZ = Math.min(bank.reach[1] * spread, z + RELIEF_ASPECT / 2 - height * 0.75 - 0.012, RELIEF_ASPECT / 2 - z - 0.012);
      const shown = halfX > 0.02 && halfZ > 0.015;
      matrix.makeScale(shown ? halfX * 2 : 0, 1, shown ? halfZ * 2 : 0).setPosition(x, height, z);
      mist.setMatrixAt(slot, matrix);
      mistData[slot * 2] = random();
      mistData[slot * 2 + 1] = shown ? (index === 0 ? 0.34 : 0.26) * (1 - share * 0.35) : 0;
    }
  });
  sheet.setAttribute("aMist", new THREE.InstancedBufferAttribute(mistData, 2));
  mist.frustumCulled = false;
  geometries.push(sheet);
  materials.push(mistMaterial);

  // Pools of light lying on the surface: Solforiz's lava, Korvenia's fires
  // and the corona around the painted eclipse.
  const glows = [
    ...RELIEF_DETAILS.embers.map((glow) => ({ ...glow, color: "#ff7a2c", flicker: 1, shape: 0, size: 2.6 })),
    ...RELIEF_DETAILS.eclipse.fires.map((glow) => ({ ...glow, color: "#ffa04a", flicker: 1, shape: 0, size: 2.2 })),
    { at: RELIEF_DETAILS.eclipse.at, radius: RELIEF_DETAILS.eclipse.radius, strength: 0.55, color: "#a879ff", flicker: 0, shape: 1, size: 2.4 },
  ];
  const disc = new THREE.PlaneGeometry(1, 1);
  disc.rotateX(-Math.PI / 2);
  const glowColors = new Float32Array(glows.length * 3);
  const glowData = new Float32Array(glows.length * 4);
  const glow = new THREE.InstancedMesh(disc, additive(GLOW_FRAGMENT, GLOW_VERTEX), glows.length);
  const color = new THREE.Color();
  glows.forEach((item, index) => {
    surfacePoint(item.at, 0.0018, point);
    const size = item.radius * item.size;
    matrix.makeScale(size, 1, size).setPosition(point);
    glow.setMatrixAt(index, matrix);
    color.set(item.color).toArray(glowColors, index * 3);
    glowData.set([random(), item.strength * (item.shape ? 0.7 : 0.42), item.flicker, item.shape], index * 4);
  });
  disc.setAttribute("aColor", new THREE.InstancedBufferAttribute(glowColors, 3));
  disc.setAttribute("aGlow", new THREE.InstancedBufferAttribute(glowData, 4));
  glow.frustumCulled = false;
  glow.renderOrder = 2;
  geometries.push(disc);

  group.add(water, mist, glow);

  if (quality !== "low") {
    // Sparks climb out of each lava crater.
    const cones = RELIEF_LANDFORMS.filter((form): form is Cone => form.kind === "cone" && form.fill === "lava");
    const perCone = quality === "high" ? 26 : 18;
    const sparkPositions = new Float32Array(cones.length * perCone * 3);
    const sparkSeeds = new Float32Array(cones.length * perCone);
    cones.forEach((cone, coneIndex) => {
      for (let index = 0; index < perCone; index++) {
        const slot = coneIndex * perCone + index;
        const angle = random() * Math.PI * 2, reach = Math.sqrt(random()) * cone.crater * 0.7;
        const x = cone.at[0] + Math.cos(angle) * reach, y = cone.at[1] + (Math.sin(angle) * reach) / RELIEF_ASPECT;
        surfacePoint([x, y], 0.002, point).toArray(sparkPositions, slot * 3);
        sparkSeeds[slot] = random();
      }
    });
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
    sparkGeometry.setAttribute("aSeed", new THREE.BufferAttribute(sparkSeeds, 1));
    const sparks = new THREE.Points(sparkGeometry, additive(SPARK_FRAGMENT, SPARK_VERTEX, { uTime: time, uScale: scale }));
    sparks.frustumCulled = false;
    geometries.push(sparkGeometry);

    // Dust drifting in the lamplight above the table.
    const motes = quality === "high" ? 110 : 72;
    const dustPositions = new Float32Array(motes * 3);
    const dustSeeds = new Float32Array(motes);
    for (let index = 0; index < motes; index++) {
      dustPositions.set([(random() - 0.5) * 0.88, 0.03 + random() * 0.15, (random() - 0.5) * 0.62], index * 3);
      dustSeeds[index] = random();
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    dustGeometry.setAttribute("aSeed", new THREE.BufferAttribute(dustSeeds, 1));
    const dust = new THREE.Points(dustGeometry, additive(DUST_FRAGMENT, DUST_VERTEX, { uTime: time, uScale: scale }));
    dust.frustumCulled = false;
    geometries.push(dustGeometry);

    // The two painted falls, each a sheet laid down its cliff face.
    const fallPositions: number[] = [], fallUvs: number[] = [], fallIndices: number[] = [];
    RELIEF_DETAILS.water.falls.forEach((fall, index) => {
      const top = surfacePoint(fall.top, 0.003, new THREE.Vector3());
      const bottom = surfacePoint(fall.bottom, 0.003, new THREE.Vector3());
      for (const [end, v] of [[top, 0], [bottom, 1]] as const) {
        for (const u of [0, 1]) {
          fallPositions.push(end.x + (u - 0.5) * fall.width, end.y, end.z + 0.004);
          fallUvs.push(u, v);
        }
      }
      const base = index * 4;
      fallIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    });
    const fallGeometry = new THREE.BufferGeometry();
    fallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fallPositions, 3));
    fallGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(fallUvs, 2));
    fallGeometry.setIndex(fallIndices);
    const falls = new THREE.Mesh(fallGeometry, additive(FALLS_FRAGMENT));
    geometries.push(fallGeometry);

    // Light running down the painted rivers, as ribbons just above their beds.
    const riverPositions: number[] = [], riverUvs: number[] = [], riverIndices: number[] = [];
    for (const river of RELIEF_DETAILS.water.rivers) {
      const curve = new THREE.CatmullRomCurve3(river.path.map(([x, y]) => new THREE.Vector3(x, 0, y)));
      const samples = curve.getSpacedPoints(Math.max(8, river.path.length * 7));
      let along = 0;
      samples.forEach((sample, index) => {
        const next = samples[Math.min(samples.length - 1, index + 1)], previous = samples[Math.max(0, index - 1)];
        const dx = (next.x - previous.x), dz = (next.z - previous.z) * RELIEF_ASPECT;
        const length = Math.hypot(dx, dz) || 1;
        if (index > 0) along += Math.hypot(sample.x - samples[index - 1].x, (sample.z - samples[index - 1].z) * RELIEF_ASPECT);
        const height = reliefHeightAt(sample.x, sample.z) + 0.0012;
        const width = river.width * 0.85;
        const base = riverPositions.length / 3;
        for (const side of [-1, 1]) {
          riverPositions.push(sample.x - 0.5 - (dz / length) * width * side, height, (sample.z - 0.5) * RELIEF_ASPECT + (dx / length) * width * side);
          riverUvs.push(along * 40, side < 0 ? 0 : 1);
        }
        if (index > 0) riverIndices.push(base - 2, base, base - 1, base - 1, base, base + 1);
      });
    }
    const riverGeometry = new THREE.BufferGeometry();
    riverGeometry.setAttribute("position", new THREE.Float32BufferAttribute(riverPositions, 3));
    riverGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(riverUvs, 2));
    riverGeometry.setIndex(riverIndices);
    const rivers = new THREE.Mesh(riverGeometry, additive(RIVER_FRAGMENT));
    geometries.push(riverGeometry);

    group.add(sparks, dust, falls, rivers);
    kinetic.push(sparks, dust);
  }

  return {
    group,
    update(seconds, still) {
      time.value = seconds;
      for (const object of kinetic) object.visible = !still;
    },
    resize(height, fov) {
      scale.value = height / (2 * Math.tan((fov * Math.PI) / 360));
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      mist.dispose();
      glow.dispose();
    },
  };
}
