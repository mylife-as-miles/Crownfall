// Simple primitives for the gameplay stand-in Bannerhold. Deliberately plain:
// a neutral ground and one recognisable marker per landmark that reflects the
// scene state (banner colours, hall tier, representative, records, notices).
// Every geometry, material and texture is registered for disposal.

import * as THREE from "three";
import { LEGACY_LANDMARKS } from "../../../../shared/legacy/environment-contract";
import type { LandmarkId } from "../../../../shared/legacy/types";
import { REPRESENTATIVE_OFFSET, STAND_IN_LANDMARKS } from "./layout";

export const BANNER_TEXTURE_WIDTH = 96;
export const BANNER_TEXTURE_HEIGHT = 144;
export const MAX_RECORD_STONES = 24;
const LEVY_SLOTS = 3;

export class Disposables {
  private readonly items = new Set<{ dispose(): void }>();
  add<T extends { dispose(): void }>(item: T): T {
    this.items.add(item);
    return item;
  }
  get geometryCount(): number {
    let count = 0;
    for (const item of this.items) if (item instanceof THREE.BufferGeometry) count++;
    return count;
  }
  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.clear();
  }
}

export interface StandInParts {
  root: THREE.Group;
  groundMaterial: THREE.MeshLambertMaterial;
  plazaMaterial: THREE.MeshLambertMaterial;
  stoneMaterial: THREE.MeshLambertMaterial;
  roofMaterial: THREE.MeshLambertMaterial;
  metalMaterial: THREE.MeshLambertMaterial;
  rings: Record<LandmarkId, THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;
  accents: Record<LandmarkId, THREE.MeshLambertMaterial>;
  bannerTexture: THREE.DataTexture;
  bannerPixels: Uint8ClampedArray;
  bannerMaterial: THREE.MeshLambertMaterial;
  hallTower: THREE.Mesh;
  hallSpire: THREE.Mesh;
  representative: THREE.Group;
  representativeMaterial: THREE.MeshLambertMaterial;
  crown: THREE.Mesh;
  emptyPlace: THREE.Mesh;
  restingTent: THREE.Mesh;
  levy: THREE.Mesh[];
  levyMaterial: THREE.MeshLambertMaterial;
  stones: THREE.InstancedMesh;
  lanternMaterial: THREE.MeshLambertMaterial;
  /** Invisible pick volumes, kept out of the rendered scene and raycast only on pointer moves. */
  proxies: THREE.Mesh[];
}

const PAWN_PROFILE: readonly [number, number][] = [
  [0, 0], [0.32, 0], [0.32, 0.06], [0.26, 0.1], [0.2, 0.16], [0.13, 0.5], [0.2, 0.56], [0.2, 0.6],
  [0.11, 0.64], [0.16, 0.74], [0.17, 0.82], [0.14, 0.92], [0.08, 0.98], [0, 1],
];

// Lambert shading keeps the stand-in's few shader programs cheap to compile and draw.
function lambert(disposables: Disposables, color: string): THREE.MeshLambertMaterial {
  return disposables.add(new THREE.MeshLambertMaterial({ color }));
}

function place(mesh: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  mesh.position.set(x, y, z);
  return mesh;
}

/** Ground disc; its rim dissolves into the scene fog (no per-vertex shading, to keep one shader variant). */
function buildGround(disposables: Disposables, material: THREE.MeshLambertMaterial): THREE.Mesh {
  const mesh = new THREE.Mesh(disposables.add(new THREE.CircleGeometry(48, 96)), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function buildPaths(disposables: Disposables, material: THREE.MeshLambertMaterial, group: THREE.Group): void {
  for (const id of LEGACY_LANDMARKS) {
    const [x, , z] = STAND_IN_LANDMARKS[id].position;
    const length = Math.hypot(x, z) - 2.6;
    if (length <= 0) continue;
    const path = new THREE.Mesh(disposables.add(new THREE.PlaneGeometry(1.4, length)), material);
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = Math.atan2(x, z);
    const mid = (length / 2 + 1.2) / Math.hypot(x, z);
    path.position.set(x * mid, 0.012, z * mid);
    group.add(path);
  }
}

type BannerHallParts = Pick<StandInParts, "hallTower" | "hallSpire" | "bannerTexture" | "bannerPixels" | "bannerMaterial">;
type MusterParts = Pick<StandInParts, "representative" | "representativeMaterial" | "crown" | "emptyPlace" | "restingTent" | "levy" | "levyMaterial">;

function buildBannerHall(d: Disposables, group: THREE.Group, stone: THREE.MeshLambertMaterial, roof: THREE.MeshLambertMaterial, metal: THREE.MeshLambertMaterial, accent: THREE.MeshLambertMaterial): BannerHallParts {
  group.add(place(new THREE.Mesh(d.add(new THREE.BoxGeometry(3.4, 2.3, 2.5)), stone), 0, 0.35 + 1.15, -0.2));
  const roofMesh = new THREE.Mesh(d.add(new THREE.ConeGeometry(2.6, 1.5, 4, 1)), roof);
  roofMesh.rotation.y = Math.PI / 4;
  roofMesh.scale.set(1, 1, 0.78);
  group.add(place(roofMesh, 0, 0.35 + 2.3 + 0.75, -0.2));
  group.add(place(new THREE.Mesh(d.add(new THREE.BoxGeometry(0.9, 1.4, 0.08)), accent), 0, 0.35 + 0.7, 1.06));
  const tower = new THREE.Mesh(d.add(new THREE.BoxGeometry(1.05, 3.2, 1.05)), stone);
  group.add(place(tower, -1.55, 0.35 + 1.6, -0.9));
  const spire = new THREE.Mesh(d.add(new THREE.ConeGeometry(0.8, 1.6, 4, 1)), roof);
  spire.rotation.y = Math.PI / 4;
  group.add(place(spire, -1.55, 0.35 + 3.2 + 0.8, -0.9));
  group.add(place(new THREE.Mesh(d.add(new THREE.CylinderGeometry(0.055, 0.07, 4.9, 8)), metal), 2.05, 0.35 + 2.45, 0.95));
  const pixels = new Uint8ClampedArray(BANNER_TEXTURE_WIDTH * BANNER_TEXTURE_HEIGHT * 4);
  const texture = d.add(new THREE.DataTexture(pixels, BANNER_TEXTURE_WIDTH, BANNER_TEXTURE_HEIGHT, THREE.RGBAFormat, THREE.UnsignedByteType));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  const bannerGeometry = d.add(new THREE.PlaneGeometry(1.2, 1.8));
  // Raster rows run top-down; flip the plane's v so the chief sits at the top.
  const uv = bannerGeometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index++) uv.setY(index, 1 - uv.getY(index));
  const bannerMaterial = d.add(new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide, alphaTest: 0.4 }));
  group.add(place(new THREE.Mesh(bannerGeometry, bannerMaterial), 2.05 - 0.64, 0.35 + 3.85, 0.95));
  return { hallTower: tower, hallSpire: spire, bannerTexture: texture, bannerPixels: pixels, bannerMaterial };
}

function pawn(geometry: THREE.LatheGeometry, material: THREE.Material, scale: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(scale);
  return mesh;
}

function buildMusterGrounds(d: Disposables, group: THREE.Group, plaza: THREE.MeshLambertMaterial, roof: THREE.MeshLambertMaterial, metal: THREE.MeshLambertMaterial): MusterParts {
  group.add(place(new THREE.Mesh(d.add(new THREE.BoxGeometry(3.5, 0.08, 3.5)), plaza), 0, 0.39, 0));
  const lathe = d.add(new THREE.LatheGeometry(PAWN_PROFILE.map(([x, y]) => new THREE.Vector2(x, y)), 20));
  const representativeMaterial = d.add(new THREE.MeshLambertMaterial({ color: "#b9b2a4" }));
  const representative = new THREE.Group();
  representative.add(pawn(lathe, representativeMaterial, 1.05));
  const crown = new THREE.Mesh(d.add(new THREE.TorusGeometry(0.12, 0.035, 8, 20)), metal);
  crown.rotation.x = Math.PI / 2;
  crown.position.y = 1.08;
  representative.add(crown);
  representative.position.set(REPRESENTATIVE_OFFSET[0], REPRESENTATIVE_OFFSET[1], REPRESENTATIVE_OFFSET[2]);
  group.add(representative);
  const emptyPlace = new THREE.Mesh(d.add(new THREE.RingGeometry(0.3, 0.42, 32)), d.add(new THREE.MeshBasicMaterial({ color: "#151210", side: THREE.DoubleSide })));
  emptyPlace.rotation.x = -Math.PI / 2;
  group.add(place(emptyPlace, REPRESENTATIVE_OFFSET[0], 0.44, REPRESENTATIVE_OFFSET[2]));
  const tent = new THREE.Mesh(d.add(new THREE.ConeGeometry(0.62, 1.05, 6, 1)), roof);
  group.add(place(tent, 1.2, 0.43 + 0.52, -0.9));
  const levyMaterial = d.add(new THREE.MeshLambertMaterial({ color: "#8d877b" }));
  const levy: THREE.Mesh[] = [];
  for (let slot = 0; slot < LEVY_SLOTS; slot++) {
    const member = pawn(lathe, levyMaterial, 0.78);
    member.position.set(-1 + slot * 0.75, 0.43, -0.65);
    group.add(member);
    levy.push(member);
  }
  return { representative, representativeMaterial, crown, emptyPlace, restingTent: tent, levy, levyMaterial };
}

function buildWarRecord(d: Disposables, group: THREE.Group, stone: THREE.MeshLambertMaterial): THREE.InstancedMesh {
  group.add(place(new THREE.Mesh(d.add(new THREE.BoxGeometry(1.7, 0.85, 0.9)), stone), 0, 0.35 + 0.42, 0));
  group.add(place(new THREE.Mesh(d.add(new THREE.BoxGeometry(2.9, 0.14, 1.8)), d.add(new THREE.MeshLambertMaterial({ color: "#5a4630" }))), 0, 0.35 + 0.92, 0));
  const stones = new THREE.InstancedMesh(d.add(new THREE.SphereGeometry(0.11, 10, 8)), d.add(new THREE.MeshLambertMaterial()), MAX_RECORD_STONES);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < MAX_RECORD_STONES; index++) {
    const column = index % 8;
    const row = Math.floor(index / 8);
    matrix.makeTranslation(-1.12 + column * 0.32, 0.35 + 1.06, -0.45 + row * 0.42);
    stones.setMatrixAt(index, matrix);
    stones.setColorAt(index, new THREE.Color("#ffffff"));
  }
  stones.count = 0;
  group.add(stones);
  return stones;
}

function buildHeraldsStation(d: Disposables, group: THREE.Group, roof: THREE.MeshLambertMaterial, metal: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  const post = d.add(new THREE.CylinderGeometry(0.08, 0.1, 2.7, 8));
  group.add(place(new THREE.Mesh(post, roof), -0.85, 0.35 + 1.35, 0));
  group.add(place(new THREE.Mesh(post, roof), 0.85, 0.35 + 1.35, 0));
  group.add(place(new THREE.Mesh(d.add(new THREE.BoxGeometry(1.95, 1.15, 0.08)), d.add(new THREE.MeshLambertMaterial({ color: "#6f5a3e" }))), 0, 0.35 + 1.75, 0.06));
  group.add(place(new THREE.Mesh(d.add(new THREE.BoxGeometry(2.3, 0.1, 0.5)), roof), 0, 0.35 + 2.75, 0));
  const lanternMaterial = d.add(new THREE.MeshLambertMaterial({ color: "#3a2a14", emissive: "#f0a43c", emissiveIntensity: 0 }));
  group.add(place(new THREE.Mesh(d.add(new THREE.SphereGeometry(0.17, 14, 10)), lanternMaterial), 1.15, 0.35 + 2.35, 0.25));
  group.add(place(new THREE.Mesh(d.add(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6)), metal), 1.15, 0.35 + 2.6, 0.25));
  return lanternMaterial;
}

/** Builds the stand-in scene graph. Colours are neutral placeholders until applyPalette runs. */
export function buildStandInScene(d: Disposables): StandInParts {
  const root = new THREE.Group();
  const groundMaterial = lambert(d, "#3a342b");
  const plazaMaterial = lambert(d, "#5a5245");
  const stoneMaterial = lambert(d, "#6a6358");
  const roofMaterial = lambert(d, "#3b3044");
  const metalMaterial = lambert(d, "#b7954a");
  root.add(buildGround(d, groundMaterial));
  const plaza = new THREE.Mesh(d.add(new THREE.CircleGeometry(4.2, 48)), plazaMaterial);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.014;
  root.add(plaza);
  const paths = new THREE.Group();
  buildPaths(d, plazaMaterial, paths);
  root.add(paths);

  const plinthGeometry = d.add(new THREE.CylinderGeometry(2.15, 2.35, 0.35, 40));
  const ringGeometry = d.add(new THREE.RingGeometry(2.55, 2.85, 64));
  const proxyGeometry = d.add(new THREE.CylinderGeometry(2.7, 2.7, 5.6, 12));
  const proxyMaterial = d.add(new THREE.MeshBasicMaterial());
  const rings = {} as Record<LandmarkId, THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;
  const accents = {} as Record<LandmarkId, THREE.MeshLambertMaterial>;
  const proxies: THREE.Mesh[] = [];
  let hall: BannerHallParts | null = null;
  let muster: MusterParts | null = null;
  let stones: THREE.InstancedMesh | null = null;
  let lanternMaterial: THREE.MeshLambertMaterial | null = null;
  for (const id of LEGACY_LANDMARKS) {
    const layout = STAND_IN_LANDMARKS[id];
    const group = new THREE.Group();
    group.position.set(layout.position[0], layout.position[1], layout.position[2]);
    group.add(place(new THREE.Mesh(plinthGeometry, stoneMaterial), 0, 0.175, 0));
    const ring = new THREE.Mesh(ringGeometry, d.add(new THREE.MeshBasicMaterial({ color: "#e08a2c", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.visible = false;
    group.add(ring);
    rings[id] = ring;
    const accent = d.add(new THREE.MeshLambertMaterial({ color: "#4b3462", emissive: "#e08a2c", emissiveIntensity: 0 }));
    accents[id] = accent;
    if (id === "banner-hall") hall = buildBannerHall(d, group, stoneMaterial, roofMaterial, metalMaterial, accent);
    else if (id === "muster-grounds") muster = buildMusterGrounds(d, group, plazaMaterial, roofMaterial, metalMaterial);
    else if (id === "war-record") stones = buildWarRecord(d, group, stoneMaterial);
    else lanternMaterial = buildHeraldsStation(d, group, roofMaterial, metalMaterial);
    if (id !== "banner-hall") {
      // A small accent stone on each plinth carries the hover/selection glow.
      group.add(place(new THREE.Mesh(d.add(new THREE.CylinderGeometry(0.22, 0.26, 0.1, 16)), accent), 0, 0.4, 1.9));
    }
    root.add(group);
    const proxy = new THREE.Mesh(proxyGeometry, proxyMaterial);
    proxy.position.set(layout.position[0], 2.8, layout.position[2]);
    proxy.userData.landmark = id;
    proxy.updateMatrixWorld(true);
    proxies.push(proxy);
  }
  if (!hall || !muster || !stones || !lanternMaterial) throw new Error("The stand-in Bannerhold is missing a landmark.");
  return {
    ...hall,
    ...muster,
    stones,
    lanternMaterial,
    root,
    groundMaterial,
    plazaMaterial,
    stoneMaterial,
    roofMaterial,
    metalMaterial,
    rings,
    accents,
    proxies,
  };
}
