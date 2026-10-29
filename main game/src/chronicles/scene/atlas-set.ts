import * as THREE from "three";
import { RELIEF_ASPECT, RELIEF_DETAILS, RELIEF_SLAB, reliefHeightAt, type ReliefMesh } from "../../../../shared/chronicles/archive/relief";
import type { Quality } from "../../settings-types";

// The Atlas set: the relief slab on a cartographer's table inside a bronze
// frame, lit like the menu (a warm key, a dim warm fill) with the eclipse's
// violet over Korvenia and the Solforiz fires. The map is one unit wide.

export interface AtlasSet {
  group: THREE.Group;
  terrain: THREE.Mesh;
  key: THREE.DirectionalLight;
  update(time: number, still: boolean): void;
  dispose(): void;
}

export const TABLE_COLOR = "#0b0806";
// The bronze inlay around the slab's foot: its gap, band, rise and bevel.
const FRAME = { gap: 0.003, band: 0.011, rise: 0.0012, bevel: 0.0016 };
/** How far the set reaches beyond the painted surface on every side, in map widths. */
export const SET_REACH = RELIEF_SLAB.chamfer + FRAME.gap + FRAME.band + FRAME.bevel;

// Dark walnut computed once per pixel: growth rings that wander along the
// grain, fine fibres and a little speckle, all periodic over the tile so it
// repeats without a seam.
function createWoodTexture(anisotropy: number): THREE.DataTexture {
  const size = 512, tau = Math.PI * 2;
  const data = new Uint8Array(size * size * 4);
  const wander = new Float32Array(size), ripple = new Float32Array(size), cross = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    const t = index / size;
    wander[index] = Math.sin(tau * (2 * t + 0.3));
    ripple[index] = Math.sin(tau * 5 * t);
    cross[index] = Math.sin(tau * 3 * t);
  }
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const ring = v * 14 + 0.6 * wander[x] + 0.35 * ripple[x] * cross[y];
      const line = (0.5 + 0.5 * Math.sin(tau * ring)) ** 3;
      const fibre = 0.5 + 0.5 * Math.sin(tau * (v * 150 + 2 * wander[x]));
      const speckle = (((x * 73856093) ^ (y * 19349663)) & 255) / 255;
      const shade = 1 - 0.2 * line - 0.08 * fibre + 0.06 * (speckle - 0.5);
      const at = (y * size + x) * 4;
      data[at] = 62 * shade;
      data[at + 1] = 41 * shade;
      data[at + 2] = 25 * shade;
      data[at + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

// The lamp's pool on the table, as a soft warm glow that leaves the painting's
// own lighting alone.
function createPoolTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const pool = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    pool.addColorStop(0, "#ffffff");
    pool.addColorStop(0.35, "#8a8a8a");
    pool.addColorStop(0.7, "#262626");
    pool.addColorStop(1, "#000000");
    context.fillStyle = pool;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A point on the painted surface: image fractions in, world units out. */
export function surfacePoint(at: readonly [number, number], lift: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(at[0] - 0.5, reliefHeightAt(at[0], at[1]) + lift, (at[1] - 0.5) * RELIEF_ASPECT);
}

export function createAtlasSet(mesh: ReliefMesh, painting: THREE.Texture, quality: Quality, anisotropy: number): AtlasSet {
  const group = new THREE.Group();
  const shadows = quality !== "low";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const wood = createWoodTexture(anisotropy);
  const carvedWood = wood.clone();
  carvedWood.repeat.set(2.2, 2.2);
  wood.repeat.set(10, 10);

  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  terrainGeometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  terrainGeometry.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  terrainGeometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  for (const { start, count, materialIndex } of mesh.groups) terrainGeometry.addGroup(start, count, materialIndex);
  // The slab's bounds are known, so skip a pass over every vertex.
  const edge = RELIEF_SLAB.chamfer * mesh.width;
  terrainGeometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-mesh.width / 2 - edge, RELIEF_SLAB.base * mesh.width, -mesh.depth / 2 - edge),
    new THREE.Vector3(mesh.width / 2 + edge, mesh.maxHeight, mesh.depth / 2 + edge),
  );
  terrainGeometry.boundingSphere = terrainGeometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const painted = new THREE.MeshStandardMaterial({ map: painting, roughness: 0.86, metalness: 0 });
  const carved = new THREE.MeshStandardMaterial({ map: carvedWood, color: "#b49a80", roughness: 0.72, metalness: 0 });
  const terrain = new THREE.Mesh(terrainGeometry, [painted, carved]);
  terrain.castShadow = shadows;
  terrain.receiveShadow = shadows;
  geometries.push(terrainGeometry);
  materials.push(painted, carved);

  const pool = createPoolTexture();
  const tableGeometry = new THREE.PlaneGeometry(9, 9);
  tableGeometry.rotateX(-Math.PI / 2);
  // The pool spans the middle of the table: its texture is stretched over a
  // fifth of the plane's width around the centre.
  pool.repeat.set(9 / 2.6, 9 / 2.2);
  pool.offset.set(0.5 - 9 / 5.2, 0.5 - 9 / 4.4);
  const tableMaterial = new THREE.MeshStandardMaterial({ map: wood, color: "#b8a48c", roughness: 0.58, metalness: 0, emissive: "#6a4524", emissiveMap: pool, emissiveIntensity: 0.32 });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.y = RELIEF_SLAB.base * mesh.width - 0.0006;
  table.receiveShadow = shadows;
  geometries.push(tableGeometry);
  materials.push(tableMaterial);

  // A low bronze frame holds the slab's foot; its bevel catches the key light.
  const { gap, band, rise, bevel } = FRAME;
  const innerX = mesh.width / 2 + edge + gap, innerZ = mesh.depth / 2 + edge + gap;
  const outline = new THREE.Shape()
    .moveTo(-innerX - band, -innerZ - band).lineTo(innerX + band, -innerZ - band)
    .lineTo(innerX + band, innerZ + band).lineTo(-innerX - band, innerZ + band).closePath();
  outline.holes.push(new THREE.Path()
    .moveTo(-innerX, -innerZ).lineTo(-innerX, innerZ).lineTo(innerX, innerZ).lineTo(innerX, -innerZ).closePath());
  const frameGeometry = new THREE.ExtrudeGeometry(outline, { depth: rise, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 1 });
  frameGeometry.rotateX(-Math.PI / 2);
  const bronze = new THREE.MeshStandardMaterial({ color: "#6e532f", roughness: 0.46, metalness: 0.35 });
  const frame = new THREE.Mesh(frameGeometry, bronze);
  frame.position.y = table.position.y + 0.003;
  frame.castShadow = shadows;
  frame.receiveShadow = shadows;
  geometries.push(frameGeometry);
  materials.push(bronze);

  // A warm key from the south-west keeps the painted south faces lit and
  // drops shadows behind the peaks; it stays gentle because the painting
  // already carries its own shading.
  const hemisphere = new THREE.HemisphereLight("#e3d5bd", "#2a1d10", 1.15);
  const key = new THREE.DirectionalLight("#ffe2bd", 1.9);
  key.position.set(-1.25, 2, 0.8);
  key.castShadow = shadows;
  if (shadows) {
    const size = quality === "high" ? 2048 : 1024;
    key.shadow.mapSize.set(size, size);
    const camera = key.shadow.camera;
    camera.left = -0.68;
    camera.right = 0.68;
    camera.top = 0.6;
    camera.bottom = -0.6;
    camera.near = 1.3;
    camera.far = 3.5;
    camera.updateProjectionMatrix();
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0014;
    key.shadow.radius = quality === "high" ? 4 : 3;
    key.shadow.intensity = 0.72;
  }
  const eclipse = new THREE.PointLight("#9b6cff", 0, 0.62, 2);
  surfacePoint(RELIEF_DETAILS.eclipse.light, RELIEF_DETAILS.eclipse.lift, eclipse.position);
  // Lit from above the Solforiz cone field, so the glow spreads across it.
  const embers = new THREE.PointLight("#ff6a22", 0, 0.62, 2);
  surfacePoint([0.76, 0.72], 0.2, embers.position);
  group.add(terrain, table, frame, hemisphere, key, eclipse, embers);

  return {
    group,
    terrain,
    key,
    update(time, still) {
      // The eclipse breathes slowly; the fires waver. Both hold still on request.
      const breath = still ? 0.5 : 0.5 + 0.5 * Math.sin(time * 0.55);
      eclipse.intensity = 0.009 + 0.004 * breath;
      const flicker = still ? 0.6 : 0.6 + 0.25 * Math.sin(time * 6.1) * Math.sin(time * 2.3 + 1.1) + 0.15 * Math.sin(time * 11.7);
      embers.intensity = 0.01 + 0.005 * flicker;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      wood.dispose();
      carvedWood.dispose();
      pool.dispose();
      key.shadow.dispose();
    },
  };
}
