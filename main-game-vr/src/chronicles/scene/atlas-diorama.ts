import {
  AdditiveBlending, AssetManager, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Entity, Group, Hovered,
  IcosahedronGeometry, Mesh, MeshBasicMaterial, PokeInteractable, RayInteractable, RingGeometry, ShaderMaterial,
  SRGBColorSpace, Texture, Vector3,
} from '@iwsdk/core';
import type { World } from '@iwsdk/core';
import {
  RELIEF_ASPECT, RELIEF_DETAILS, RELIEF_LEVELS, RELIEF_SEGMENTS, RELIEF_SLAB, buildReliefMesh, getReliefMarkers,
  imageToRelief, intersectRelief, reliefHeightAt, reliefMeshSlices, reliefToImage,
} from '../../../../shared/chronicles/archive/relief';
import type { ReliefMarker, ReliefMesh } from '../../../../shared/chronicles/archive/relief';
import { MENU_THEME } from '../../../../shared/menu/theme';
import { QUEST_CHRONICLE_IDS } from '../../ui-contract.js';

/**
 * The Atlas as a table-scale relief: the shared heightfield sculpted at Quest
 * quality with the painting as its albedo, set on a cartographer's table in
 * front of and below a stationary viewer. Lighting is baked into vertex colours
 * and every surface is unlit, so the painting keeps its own shading.
 */
export const ATLAS_DIORAMA = {
  width: 0.95,
  /** Sea level below the eyes and the slab's near edge ahead of them, in metres. */
  seated: { drop: 0.5, near: 0.36 },
  standing: { drop: 0.64, near: 0.32 },
  /** The highest terrain stays this far below the panel's footer, in radians. */
  footerClearance: 0.035,
  /** Build work per frame on open, in milliseconds. */
  buildBudget: 3,
} as const;

export type AtlasPosture = 'seated' | 'standing';

export interface AtlasDioramaEvents {
  select(recordId: string): void;
  /** Bare ground under a ray, as map image fractions. */
  ground(x: number, y: number): void;
}

// Pure functions of the shared heightfield, kept for the session so later
// visits rebuild only the GPU objects.
let relief: ReliefMesh | null = null;
let proxy: ReliefMesh | null = null;
let baked: { shade: Float32Array; glow: Float32Array; rowPeaks: Float32Array } | null = null;

// The menu's warm key, from the upper left in front, as on the sorcerer.
const KEY = new Vector3(-0.45, 0.8, 0.4).normalize();
const linear = (hex: string, scale = 1): Color => new Color(hex).multiplyScalar(scale);
const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const paintedVertex = `
  attribute vec4 glow;
  uniform float uTime;
  uniform float uReveal;
  varying vec2 vUv;
  varying vec3 vShade;
  varying vec3 vGlow;
  void main() {
    vUv = uv;
    float phase = fract(glow.w) * 6.2831853;
    float flicker = .8 + .12 * sin(uTime * 2.1 + phase) + .08 * sin(uTime * 5.3 + phase * 3.);
    float breathe = .76 + .24 * sin(uTime * .55 + phase);
    vShade = color * uReveal;
    vGlow = glow.rgb * mix(flicker, breathe, step(1., glow.w)) * uReveal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;
const paintedFragment = `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vShade;
  varying vec3 vGlow;
  void main() {
    gl_FragColor = vec4(texture2D(uMap, vUv).rgb * vShade + vGlow, 1.);
    #include <colorspace_fragment>
  }
`;

// Positions in these shaders are relief metres; dividing by the map width keeps
// ripples and mist at the same size on the painting at any table scale.
const mapVertex = `
  uniform float uWidth;
  varying vec2 vMap;
  varying vec2 vLocal;
  attribute vec2 local;
  void main() {
    vMap = position.xz / uWidth;
    vLocal = local;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;
// Three slow swells; a glint shows only where all three crest together.
const waterFragment = `
  uniform float uTime;
  uniform float uReveal;
  uniform vec3 uDeep;
  uniform vec3 uGlint;
  varying vec2 vMap;
  varying vec2 vLocal;
  void main() {
    vec2 p = vMap * 95.;
    float swell = sin(p.x * 1.7 + p.y * .6 + uTime * 1.2) + sin(p.y * 1.9 - p.x * .8 + uTime * .85)
      + sin((p.x + p.y) * 1.13 - uTime * 1.55);
    float glint = smoothstep(2.15, 2.85, swell);
    float edge = 1. - smoothstep(.82, 1., max(abs(vLocal.x), abs(vLocal.y)));
    gl_FragColor = vec4(uDeep + uGlint * glint, (.14 + .46 * glint) * edge * uReveal);
    #include <colorspace_fragment>
  }
`;
const mistFragment = `
  uniform float uTime;
  uniform float uReveal;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vMap;
  varying vec2 vLocal;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
  }
  void main() {
    float bank = 1. - smoothstep(.2, 1., dot(vLocal, vLocal));
    vec2 q = vMap * 24. + vec2(uTime * .045, uTime * .018);
    float density = noise(q) * .62 + noise(q * 2.4 - vec2(uTime * .03, -uTime * .02)) * .38;
    gl_FragColor = vec4(uColor, bank * smoothstep(.28, .82, density) * uOpacity * uReveal);
    #include <colorspace_fragment>
  }
`;
// Camera-facing glows expanded in view space, so both eyes see round discs
// without any per-frame orientation work.
const glowVertex = `
  attribute vec2 corner;
  attribute float size;
  attribute vec3 tint;
  attribute float phase;
  uniform float uTime;
  uniform float uReveal;
  varying vec2 vCorner;
  varying vec3 vTint;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.);
    view.xy += corner * size;
    gl_Position = projectionMatrix * view;
    float p = fract(phase) * 6.2831853;
    float flicker = .74 + .16 * sin(uTime * 2.3 + p) + .1 * sin(uTime * 6.1 + p * 2.);
    float breathe = .7 + .3 * sin(uTime * .55 + p);
    vTint = tint * mix(flicker, breathe, step(1., phase)) * uReveal;
    vCorner = corner;
  }
`;
const glowFragment = `
  varying vec2 vCorner;
  varying vec3 vTint;
  void main() {
    float glow = exp(-dot(vCorner, vCorner) * 4.) - .0183;
    if (glow <= 0.) discard;
    gl_FragColor = vec4(vTint * glow, 1.);
    #include <colorspace_fragment>
  }
`;

/**
 * Bakes light into vertex colours a few rows at a time: a soft warm key with
 * deeper crevices on the painted surface, a vignette toward the rim, and the
 * additive violet of the eclipse and the glow of Solforiz's lava. The slab's
 * sides take the key on their chamfer and darken toward the underside.
 */
function* bake(mesh: ReliefMesh, rowsPerSlice = 12): Generator<void, NonNullable<typeof baked>, void> {
  const { columns, rows, width, depth, heights, normals, positions, vertexCount } = mesh;
  const stride = columns + 1, surface = stride * (rows + 1);
  const shade = new Float32Array(vertexCount * 3), glow = new Float32Array(vertexCount * 4), rowPeaks = new Float32Array(rows + 1);
  const grade = [1, 0.975, 0.935];
  for (let r = 0; r <= rows; r++) {
    let peak = -Infinity;
    for (let c = 0; c <= columns; c++) {
      const i = r * stride + c, h = heights[i];
      peak = Math.max(peak, h);
      const lit = 0.66 + 0.42 * Math.max(0, normals[i * 3] * KEY.x + normals[i * 3 + 1] * KEY.y + normals[i * 3 + 2] * KEY.z);
      // Crevices sit below their neighbours two cells out; ridges stand above them.
      const around = (heights[r * stride + Math.max(0, c - 2)] + heights[r * stride + Math.min(columns, c + 2)]
        + heights[Math.max(0, r - 2) * stride + c] + heights[Math.min(rows, r + 2) * stride + c]) / 4;
      const cavity = Math.max(0.84, Math.min(1.08, 1 + ((h - around) / width) * 45));
      const edge = Math.min(c / columns, 1 - c / columns, (r / rows) * RELIEF_ASPECT, (1 - r / rows) * RELIEF_ASPECT);
      const value = lit * cavity * (0.88 + 0.12 * smooth(0, 0.045, edge));
      for (let k = 0; k < 3; k++) shade[i * 3 + k] = value * grade[k];
    }
    rowPeaks[r] = peak;
    if (r % rowsPerSlice === rowsPerSlice - 1) yield;
  }
  const slab = RELIEF_SLAB.base * width, rim = RELIEF_LEVELS.rim * width;
  for (let i = surface; i < vertexCount; i++) {
    const lit = 0.5 + 0.55 * Math.max(0, normals[i * 3] * KEY.x + normals[i * 3 + 1] * KEY.y + normals[i * 3 + 2] * KEY.z);
    const value = lit * (0.55 + 0.45 * smooth(slab, rim, positions[i * 3 + 1]));
    for (let k = 0; k < 3; k++) shade[i * 3 + k] = value;
  }
  yield;
  const cellW = width / columns, cellD = depth / rows;
  // Additive light over a disc of the grid: colour, reach in metres, phase, and
  // an optional height and facing so the eclipse lights the slopes below it.
  const spill = (at: readonly [number, number], reach: number, color: Color, phase: number, lift?: number) => {
    const [x, z] = imageToRelief(at[0], at[1], width);
    const y = lift === undefined ? 0 : reliefHeightAt(at[0], at[1]) * width + lift;
    const c0 = Math.max(0, Math.floor((x - reach) / cellW + columns / 2)), c1 = Math.min(columns, Math.ceil((x + reach) / cellW + columns / 2));
    const r0 = Math.max(0, Math.floor((z - reach) / cellD + rows / 2)), r1 = Math.min(rows, Math.ceil((z + reach) / cellD + rows / 2));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * stride + c, dx = positions[i * 3] - x, dz = positions[i * 3 + 2] - z;
      let falloff = 1 - Math.hypot(dx, dz) / reach;
      if (falloff <= 0) continue;
      falloff *= falloff;
      if (lift !== undefined) {
        const dy = y - positions[i * 3 + 1], length = Math.hypot(dx, dy, dz) || 1;
        falloff *= 0.35 + 0.65 * Math.max(0, (-dx * normals[i * 3] + dy * normals[i * 3 + 1] - dz * normals[i * 3 + 2]) / length);
      }
      glow[i * 4] += color.r * falloff;
      glow[i * 4 + 1] += color.g * falloff;
      glow[i * 4 + 2] += color.b * falloff;
      glow[i * 4 + 3] = phase;
    }
  };
  const eclipse = RELIEF_DETAILS.eclipse;
  spill(eclipse.light, 0.3 * width, linear('#6b3fa8', 0.26), 1.2, eclipse.lift * width);
  spill(eclipse.at, eclipse.radius * 1.4 * width, linear('#8a55d6', 0.16), 1.6, 0.02 * width);
  eclipse.fires.forEach((fire, index) => spill(fire.at, fire.radius * 3 * width, linear('#ff8a2a', 0.5 * fire.strength), 0.31 + index * 0.27));
  RELIEF_DETAILS.embers.forEach((ember, index) => spill(ember.at, ember.radius * 2.2 * width, linear('#ff5a14', 0.42 * ember.strength), (index * 0.618) % 1));
  return { shade, glow, rowPeaks };
}

type Ring = readonly (readonly [x: number, z: number])[];
interface Paint { color: Color; bottom?: Color; from?: number; to?: number; lift?: number }
const rect = (x0: number, x1: number, z0: number, z1: number): Ring => [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];

/** Flat-lit quads with baked colour; rings run counter-clockwise seen from above. */
class Shape {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly scratch = new Color();
  /** Side walls, bevels or flat bands between two rings. */
  loft(lower: Ring, y0: number, upper: Ring, y1: number, paint: Paint): this {
    for (let i = 0; i < lower.length; i++) {
      const j = (i + 1) % lower.length;
      this.quad([lower[i][0], y0, lower[i][1]], [lower[j][0], y0, lower[j][1]], [upper[j][0], y1, upper[j][1]], [upper[i][0], y1, upper[i][1]], paint);
    }
    return this;
  }
  cap(ring: Ring, y: number, paint: Paint): this {
    this.quad([ring[0][0], y, ring[0][1]], [ring[1][0], y, ring[1][1]], [ring[2][0], y, ring[2][1]], [ring[3][0], y, ring[3][1]], paint);
    return this;
  }
  /** A block whose top edge is bevelled by `bevel`. */
  block(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, bevel: number, paint: Paint, edge = paint): this {
    const outer = rect(x0, x1, z0, z1), inner = rect(x0 + bevel, x1 - bevel, z0 + bevel, z1 - bevel);
    return this.loft(outer, y0, outer, y1 - bevel, paint).loft(outer, y1 - bevel, inner, y1, edge).cap(inner, y1, paint);
  }
  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    return geometry;
  }
  private quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], paint: Paint): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz) || 1;
    const lit = 0.62 + 0.48 * Math.max(0, (nx * KEY.x + ny * KEY.y + nz * KEY.z) / length) + (paint.lift || 0);
    for (const point of [a, b, c, a, c, d]) {
      this.positions.push(point[0], point[1], point[2]);
      const color = paint.bottom === undefined ? this.scratch.copy(paint.color)
        : this.scratch.lerpColors(paint.bottom, paint.color, smooth(paint.from!, paint.to!, point[1]));
      this.colors.push(color.r * lit, color.g * lit, color.b * lit);
    }
  }
}

/** The cartographer's table under a slab `width` by `depth`: a bevelled walnut top with a brass inlay, an apron and a plinth that falls into the dark. */
function tableGeometry(width: number, depth: number): BufferGeometry {
  const chamfer = RELIEF_SLAB.chamfer * width, top = RELIEF_SLAB.base * width;
  const hx = width / 2 + chamfer + 0.05, hz = depth / 2 + chamfer + 0.05;
  const wood = { color: linear(MENU_THEME.colors.surface, 0.62) }, edge = { color: linear(MENU_THEME.colors.surface, 0.95) };
  const brass = { color: linear(MENU_THEME.colors.accent, 0.62) }, apron = { color: linear(MENU_THEME.colors.surface, 0.42) };
  const shadow = linear(MENU_THEME.colors.background, 0.8), foot = top - 0.087 - 0.95;
  const plinth = { color: linear(MENU_THEME.colors.surface, 0.38), bottom: shadow, from: foot, to: top - 0.087 };
  const inlay = 0.018, line = 0.0035;
  return new Shape()
    .block(-hx, hx, -hz, hz, top - 0.032, top, 0.008, wood, edge)
    .loft(rect(-hx + inlay, hx - inlay, -hz + inlay, hz - inlay), top + 0.0005, rect(-hx + inlay + line, hx - inlay - line, -hz + inlay + line, hz - inlay - line), top + 0.0005, brass)
    .loft(rect(-hx + 0.028, hx - 0.028, -hz + 0.028, hz - 0.028), top - 0.087, rect(-hx + 0.028, hx - 0.028, -hz + 0.028, hz - 0.028), top - 0.032, apron)
    .loft(rect(-hx + 0.13, hx - 0.13, -hz + 0.13, hz - 0.13), foot, rect(-hx + 0.13, hx - 0.13, -hz + 0.13, hz - 0.13), top - 0.087, plinth)
    .build();
}

/** Gathers primitives into one non-indexed geometry, each lit by its own normals in one colour. */
function merge(parts: readonly { geometry: BufferGeometry; color: Color; y: number }[]): BufferGeometry {
  const positions: number[] = [], colors: number[] = [];
  for (const { geometry, color, y } of parts) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    flat.computeVertexNormals();
    const p = flat.getAttribute('position'), n = flat.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const lit = 0.58 + 0.62 * Math.max(0, n.getX(i) * KEY.x + n.getY(i) * KEY.y + n.getZ(i) * KEY.z);
      positions.push(p.getX(i), p.getY(i) + y, p.getZ(i));
      colors.push(color.r * lit, color.g * lit, color.b * lit);
    }
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  return geometry;
}

/** A brass map pin standing in a thin ring that lies flat on its terrace; local y = 0 is the terrace. */
function markerGeometry(width: number): BufferGeometry {
  const ring = new RingGeometry(0.0266 * width, 0.03 * width, 72, 1).rotateX(-Math.PI / 2);
  const socket = new CylinderGeometry(0.0046 * width, 0.0058 * width, 0.0026 * width, 18);
  const stem = new CylinderGeometry(0.0014 * width, 0.0014 * width, 0.044 * width, 8, 1, true);
  const gem = new IcosahedronGeometry(0.0088 * width, 0);
  return merge([
    { geometry: ring, color: linear(MENU_THEME.colors.accent, 0.72), y: 0.0012 * width },
    { geometry: socket, color: linear(MENU_THEME.colors.accent, 0.7), y: 0.0012 * width },
    { geometry: stem, color: linear(MENU_THEME.colors.focus, 0.85), y: 0.024 * width },
    { geometry: gem, color: linear(MENU_THEME.colors.focus), y: 0.052 * width },
  ]);
}

/** A soft additive band around the ring, brightest at its radius; alpha rides in the vertex colour. */
function haloGeometry(width: number): BufferGeometry {
  const geometry = new RingGeometry(0.014 * width, 0.0436 * width, 72, 2).rotateX(-Math.PI / 2).translate(0, 0.0016 * width, 0);
  const radius = geometry.getAttribute('position'), colors = new Float32Array(radius.count * 4);
  for (let i = 0; i < radius.count; i++) {
    const r = Math.hypot(radius.getX(i), radius.getZ(i)) / width;
    colors.set([1, 1, 1, Math.abs(r - 0.0288) < 0.002 ? 1 : 0], i * 4);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  return geometry;
}

interface MarkerView {
  marker: ReliefMarker;
  entity: Entity;
  group: Group;
  material: MeshBasicMaterial;
  halo: Mesh;
  haloMaterial: MeshBasicMaterial;
  level: number;
  onClick: () => void;
}
interface GroundEvent { point: Vector3; pointerPosition: Vector3 }

/**
 * Owns the diorama's entities and GPU objects while Chronicles is open. It
 * builds within a small budget per frame, reveals itself from darkness, stops
 * all updates while hidden and releases everything on close.
 */
export class AtlasDiorama {
  private builder: Generator<void, void, void> | null = null;
  private texture: Texture | null = null;
  private loading: Promise<void> | null = null;
  private root: Group | null = null;
  private rootEntity: Entity | null = null;
  private groundEntity: Entity | null = null;
  private readonly markers: MarkerView[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly shaders: ShaderMaterial[] = [];
  private tableMaterial: MeshBasicMaterial | null = null;
  private slabMaterial: MeshBasicMaterial | null = null;
  private visible = false;
  private selected: string | null = null;
  private markersActive = true;
  private reveal = 0;
  private time = 0;
  private alive = true;
  private buildFailed = false;
  private generation = 0;
  private placement = { posture: 'seated' as AtlasPosture, footer: -0.57, distance: 1.5 };
  private readonly rest = new Color(0.96, 0.96, 0.96);
  private readonly hover = new Color(1.3, 1.14, 0.96);
  private readonly chosen = new Color(1.6, 1.28, 0.86);
  private readonly slabColor = linear(MENU_THEME.colors.surface, 0.9);
  private readonly origin = new Vector3();
  private readonly point = new Vector3();
  private readonly onGround = (event: GroundEvent) => this.selectGround(event);

  constructor(private readonly world: World, private readonly parent: Entity, private readonly events: AtlasDioramaEvents) {}

  get ready(): boolean { return !!this.root && !this.builder && !this.buildFailed; }
  get failed(): boolean { return this.buildFailed; }
  get object(): Group | null { return this.root; }

  /** Starts the sliced build, or keeps what an earlier open built. */
  open(): void {
    if (!this.alive || this.builder || this.root) return;
    this.buildFailed = false;
    this.builder = this.build(++this.generation);
  }

  /** Releases entities and GPU objects; the shared relief stays cached for the next visit. */
  close(): void {
    // Invalidate a pending load even when no GPU objects have been created.
    this.generation++;
    this.builder = null;
    this.loading = null;
    for (const view of this.markers) {
      view.group.removeEventListener('click', view.onClick);
      view.entity.dispose();
    }
    this.markers.length = 0;
    if (this.groundEntity) {
      this.groundEntity.object3D?.removeEventListener('click', this.onGround);
      this.groundEntity.dispose();
    }
    this.rootEntity?.dispose();
    for (const item of this.owned) item.dispose();
    this.owned.length = 0;
    this.shaders.length = 0;
    // The painting stays cached by AssetManager; only its GPU copy is released.
    this.texture?.dispose();
    this.texture = null;
    this.root = null; this.rootEntity = null; this.groundEntity = null;
    this.tableMaterial = null; this.slabMaterial = null;
    this.reveal = 0;
  }

  dispose(): void { this.alive = false; this.close(); }

  private fail(): void {
    this.close();
    this.buildFailed = true;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.root) this.root.visible = visible;
  }

  /** The open record lights its marker; markers only show and answer on the Atlas. */
  setSelection(record: string | null, markersActive: boolean): void {
    this.selected = record;
    this.markersActive = markersActive;
    for (const view of this.markers) view.group.visible = markersActive;
  }

  /** Sea level and distance follow posture, and the terrain stays clear below the panel's footer. */
  place(posture: AtlasPosture, footer: number, distance: number): void {
    this.placement.posture = posture; this.placement.footer = footer; this.placement.distance = distance;
    this.applyPlacement();
  }

  update(delta: number, motion: boolean): void {
    if (this.builder) {
      const start = performance.now();
      try {
        while (this.builder && performance.now() - start < ATLAS_DIORAMA.buildBudget) {
          if (this.builder.next().done) this.builder = null;
        }
      } catch { this.fail(); }
    }
    if (!this.root || !this.visible) return;
    if (motion) this.time += delta;
    this.reveal = motion ? Math.min(1, this.reveal + delta / 0.7) : 1;
    const reveal = this.reveal * this.reveal * (3 - 2 * this.reveal);
    for (let i = 0; i < this.shaders.length; i++) {
      const uniforms = this.shaders[i].uniforms;
      uniforms.uTime.value = this.time;
      uniforms.uReveal.value = reveal;
    }
    this.tableMaterial!.color.setScalar(reveal);
    this.slabMaterial!.color.copy(this.slabColor).multiplyScalar(reveal);
    const ease = motion ? 1 - Math.exp(-delta * 12) : 1;
    for (let i = 0; i < this.markers.length; i++) {
      const view = this.markers[i];
      const target = view.marker.record.id === this.selected ? 1 : this.markersActive && view.entity.hasComponent(Hovered) ? 0.62 : 0;
      view.level += (target - view.level) * ease;
      const level = view.level;
      if (level <= 0.62) view.material.color.lerpColors(this.rest, this.hover, level / 0.62);
      else view.material.color.lerpColors(this.hover, this.chosen, (level - 0.62) / 0.38);
      view.material.color.multiplyScalar(reveal);
      view.haloMaterial.opacity = Math.min(1, level * 1.15) * reveal;
      view.halo.visible = view.haloMaterial.opacity > 0.01;
    }
  }

  private applyPlacement(): void {
    if (!this.root || !baked || !relief) return;
    const { posture, footer, distance } = this.placement, { drop, near } = ATLAS_DIORAMA[posture];
    const depth = relief.depth, rows = relief.rows;
    // Every row of terrain, from the far edge in, must sit below the line from
    // the eyes past the footer's lower edge.
    const slope = Math.tan(Math.atan2(-footer, distance) + ATLAS_DIORAMA.footerClearance);
    let sea = -drop;
    for (let r = 0; r <= rows; r++) sea = Math.min(sea, -(near + depth * (1 - r / rows)) * slope - baked.rowPeaks[r]);
    this.root.position.set(0, sea, -(near + depth / 2));
  }

  private *build(generation: number): Generator<void, void, void> {
    const width = ATLAS_DIORAMA.width;
    this.loading ||= AssetManager.loadTextureById(QUEST_CHRONICLE_IDS.mapAsset).then(texture => {
      // A late result belongs to AssetManager, never to a closed or newer visit.
      if (!this.alive || generation !== this.generation) return;
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = Math.min(4, this.world.renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
      this.texture = texture;
    }).catch(() => {
      if (this.alive && generation === this.generation) this.fail();
    });
    if (!relief) {
      // Small slices keep the cold first frames short; the budget loop packs several per frame once warm.
      const slices = reliefMeshSlices(width, RELIEF_SEGMENTS.quest, 4);
      for (let step = slices.next(); ; step = slices.next()) { if (step.done) { relief = step.value; break; } yield; }
    }
    if (!baked) {
      const steps = bake(relief);
      for (let step = steps.next(); ; step = steps.next()) { if (step.done) { baked = step.value; break; } yield; }
    }
    if (!proxy) { proxy = buildReliefMesh(width, 24); yield; }
    while (!this.texture) {
      // A failed load leaves the panel's own controls; the next visit retries.
      if (!this.loading) return;
      yield;
    }
    if (!this.alive) return;
    yield* this.assemble(relief, baked);
    yield;
    this.world.renderer.initTexture(this.texture);
  }

  /** Builds the GPU objects a part per frame, then places the finished diorama and its entities together. */
  private *assemble(mesh: ReliefMesh, light: NonNullable<typeof baked>): Generator<void, void, void> {
    const width = mesh.width, root = new Group();
    root.name = QUEST_CHRONICLE_IDS.diorama;
    root.visible = this.visible;
    const own = <T extends { dispose(): void }>(item: T): T => { this.owned.push(item); return item; };
    const shader = (parameters: ConstructorParameters<typeof ShaderMaterial>[0]): ShaderMaterial => {
      const material = own(new ShaderMaterial({ toneMapped: false, ...parameters }));
      this.shaders.push(material);
      return material;
    };

    const terrain = own(new BufferGeometry());
    terrain.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    terrain.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
    terrain.setAttribute('color', new BufferAttribute(light.shade, 3));
    terrain.setAttribute('glow', new BufferAttribute(light.glow, 4));
    terrain.setIndex(new BufferAttribute(mesh.indices, 1));
    for (const group of mesh.groups) terrain.addGroup(group.start, group.count, group.materialIndex);
    const painted = shader({ uniforms: { uMap: { value: this.texture }, uTime: { value: 0 }, uReveal: { value: 0 } }, vertexShader: paintedVertex, fragmentShader: paintedFragment, vertexColors: true });
    this.slabMaterial = own(new MeshBasicMaterial({ color: 0, vertexColors: true, toneMapped: false }));
    const surface = new Mesh(terrain, [painted, this.slabMaterial]);
    surface.name = 'Atlas Relief';
    this.tableMaterial = own(new MeshBasicMaterial({ color: 0, vertexColors: true, toneMapped: false }));
    const table = new Mesh(own(tableGeometry(width, mesh.depth)), this.tableMaterial);
    table.name = 'Atlas Table';
    root.add(surface, table);
    yield;

    // Water sits just above sea level over each coast, so it only shows where the relief dips below it.
    const quads = (items: readonly { x0: number; x1: number; y0: number; y1: number; height: number }[]): BufferGeometry => {
      const positions = new Float32Array(items.length * 12), local = new Float32Array(items.length * 8), index: number[] = [];
      items.forEach((item, n) => {
        const [x0, z0] = imageToRelief(item.x0, item.y0, width), [x1, z1] = imageToRelief(item.x1, item.y1, width);
        positions.set([x0, item.height, z1, x1, item.height, z1, x1, item.height, z0, x0, item.height, z0], n * 12);
        local.set([-1, -1, 1, -1, 1, 1, -1, 1], n * 8);
        index.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
      });
      const geometry = own(new BufferGeometry());
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('local', new BufferAttribute(local, 2));
      geometry.setIndex(index);
      return geometry;
    };
    const seas = RELIEF_DETAILS.water.seas.map(coast => {
      const xs = coast.map(point => point[0]), ys = coast.map(point => point[1]);
      return { x0: Math.max(0, Math.min(...xs)), x1: Math.min(1, Math.max(...xs)), y0: Math.max(0, Math.min(...ys)), y1: Math.min(1, Math.max(...ys)), height: 0.0005 * width };
    });
    const water = new Mesh(quads(seas), shader({
      uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uWidth: { value: width }, uDeep: { value: linear('#1d3a44', 0.42) }, uGlint: { value: linear('#d8e6dc', 0.85) } },
      vertexShader: mapVertex, fragmentShader: waterFragment, transparent: true, depthWrite: false,
    }));
    water.name = 'Atlas Water'; water.renderOrder = 1;
    // Two layers per bank, low and high in its band, drifting at their own pace.
    const banks = RELIEF_DETAILS.mist.flatMap(bank => bank.lift.map(lift => ({
      x0: bank.at[0] - bank.reach[0], x1: bank.at[0] + bank.reach[0],
      y0: bank.at[1] - bank.reach[1] / RELIEF_ASPECT, y1: bank.at[1] + bank.reach[1] / RELIEF_ASPECT,
      height: (reliefHeightAt(bank.at[0], bank.at[1]) + lift) * width,
    })));
    const mist = new Mesh(quads(banks), shader({
      uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uWidth: { value: width }, uColor: { value: linear('#b9b2a4', 0.72) }, uOpacity: { value: 0.27 } },
      vertexShader: mapVertex, fragmentShader: mistFragment, transparent: true, depthWrite: false,
    }));
    mist.name = 'Atlas Mist'; mist.renderOrder = 3;
    const glows = new Mesh(this.glowGeometry(width, own), shader({
      uniforms: { uTime: { value: 0 }, uReveal: { value: 0 } },
      vertexShader: glowVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    glows.name = 'Atlas Glows'; glows.renderOrder = 4; glows.frustumCulled = false;
    root.add(water, mist, glows);
    yield;
    const markers = this.prepareMarkers(mesh, own);
    yield;
    const ground = this.prepareGround(width, mesh.depth, own);
    yield;
    this.root = root;
    this.rootEntity = this.world.createTransformEntity(root, { parent: this.parent });
    this.applyPlacement();
    for (const view of markers) {
      const entity = this.world.createTransformEntity(view.group, { parent: this.rootEntity });
      entity.addComponent(RayInteractable);
      entity.addComponent(PokeInteractable);
      this.markers.push({ ...view, entity });
    }
    this.groundEntity = this.world.createTransformEntity(ground, { parent: this.rootEntity });
    this.groundEntity.addComponent(RayInteractable);
    this.setSelection(this.selected, this.markersActive);
  }

  /** The eclipse's violet light and halo breathe; the city fires and Solforiz's embers flicker. */
  private glowGeometry(width: number, own: <T extends { dispose(): void }>(item: T) => T): BufferGeometry {
    const eclipse = RELIEF_DETAILS.eclipse;
    const glows = [
      { at: eclipse.light, lift: eclipse.lift, size: 0.22, tint: linear('#7d4ad0', 0.03), phase: 1.2 },
      { at: eclipse.at, lift: 0.012, size: eclipse.radius * 1.45, tint: linear('#9a63ea', 0.24), phase: 1.6 },
      ...eclipse.fires.map((fire, index) => ({ at: fire.at, lift: fire.radius * 0.7, size: fire.radius * 1.6, tint: linear('#ffa040', 0.34 * fire.strength), phase: 0.31 + index * 0.27 })),
      ...RELIEF_DETAILS.embers.map((ember, index) => ({ at: ember.at, lift: ember.radius * 0.8, size: ember.radius * 1.9, tint: linear('#ff6a1c', 0.5 * ember.strength), phase: (index * 0.618) % 1 })),
    ];
    const count = glows.length, position = new Float32Array(count * 12), corner = new Float32Array(count * 8);
    const size = new Float32Array(count * 4), tint = new Float32Array(count * 12), phase = new Float32Array(count * 4), index: number[] = [];
    glows.forEach((glow, n) => {
      const [x, z] = imageToRelief(glow.at[0], glow.at[1], width), y = (reliefHeightAt(glow.at[0], glow.at[1]) + glow.lift) * width;
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], n * 8);
      for (let k = 0; k < 4; k++) {
        position.set([x, y, z], (n * 4 + k) * 3);
        size[n * 4 + k] = glow.size * width;
        tint.set([glow.tint.r, glow.tint.g, glow.tint.b], (n * 4 + k) * 3);
        phase[n * 4 + k] = glow.phase;
      }
      index.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
    });
    const geometry = own(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('corner', new BufferAttribute(corner, 2));
    geometry.setAttribute('size', new BufferAttribute(size, 1));
    geometry.setAttribute('tint', new BufferAttribute(tint, 3));
    geometry.setAttribute('phase', new BufferAttribute(phase, 1));
    geometry.setIndex(index);
    return geometry;
  }

  /** A marker per hotspot whose invisible pick volume is RELIEF_MARKER.radius across the terrace; entities come when the diorama is placed. */
  private prepareMarkers(mesh: ReliefMesh, own: <T extends { dispose(): void }>(item: T) => T): Omit<MarkerView, 'entity'>[] {
    const width = mesh.width, visual = own(markerGeometry(width)), halo = own(haloGeometry(width));
    const markers = getReliefMarkers(mesh), height = 0.075 * width;
    const hit = own(new CylinderGeometry(markers[0].radius, markers[0].radius, height, 16).translate(0, height / 2 - 0.01 * width, 0));
    const hidden = own(new MeshBasicMaterial({ visible: false }));
    return markers.map((marker) => {
      const group = new Group();
      group.name = QUEST_CHRONICLE_IDS.marker(marker.record);
      group.position.set(marker.x, marker.clearance, marker.z);
      const material = own(new MeshBasicMaterial({ color: 0, vertexColors: true, toneMapped: false }));
      const haloMaterial = own(new MeshBasicMaterial({ color: MENU_THEME.colors.activeTab, vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      const pin = new Mesh(visual, material), ring = new Mesh(halo, haloMaterial), volume = new Mesh(hit, hidden);
      pin.name = `${group.name}_Pin`; ring.name = `${group.name}_Halo`; volume.name = `${group.name}_Hit`;
      ring.renderOrder = 2; ring.visible = false;
      group.add(pin, ring, volume);
      const onClick = () => { if (this.markersActive) this.events.select(marker.record.id); };
      group.addEventListener('click', onClick);
      return { marker, group, material, halo: ring, haloMaterial, level: 0, onClick };
    });
  }

  /** An invisible stand-in for the slab and table stops rays here, so a pinch on bare ground never reaches the panel behind. */
  private prepareGround(width: number, depth: number, own: <T extends { dispose(): void }>(item: T) => T): Group {
    const stand = proxy!, geometry = own(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(stand.positions, 3));
    geometry.setIndex(new BufferAttribute(stand.indices, 1));
    const hidden = own(new MeshBasicMaterial({ visible: false }));
    // The table top and apron as one block under the slab.
    const table = own(new BoxGeometry(width + 0.11, 0.12, depth + 0.11).translate(0, RELIEF_SLAB.base * width - 0.06, 0));
    const group = new Group(), surface = new Mesh(geometry, hidden), block = new Mesh(table, hidden);
    group.name = QUEST_CHRONICLE_IDS.ground;
    group.add(surface, block);
    group.addEventListener('click', this.onGround);
    return group;
  }

  private selectGround(event: GroundEvent): void {
    if (!this.root || !relief) return;
    // Refine the stand-in's hit against the drawn surface in relief space.
    this.root.worldToLocal(this.origin.copy(event.pointerPosition));
    this.root.worldToLocal(this.point.copy(event.point)).sub(this.origin);
    const t = intersectRelief(relief, this.origin.x, this.origin.y, this.origin.z, this.point.x, this.point.y, this.point.z);
    if (t < 0) return;
    const [x, y] = reliefToImage(this.origin.x + this.point.x * t, this.origin.z + this.point.z * t, relief.width);
    this.events.ground(x, y);
  }
}
