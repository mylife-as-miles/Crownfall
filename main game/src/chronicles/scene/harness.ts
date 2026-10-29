import * as THREE from "three";
import { ARCHIVE_BLUEPRINT as B, ARCHIVE_GEOMETRY } from "../../../../shared/chronicles/archive/blueprint";
import { buildArchiveForm, buildPlinth, monumentPlinthSpec } from "../../../../shared/chronicles/archive/kernel/assemble";
import { balusterForm, type FormGeometry } from "../../../../shared/chronicles/archive/kernel/forms";
import { MeshWriter, type MeshBuffer } from "../../../../shared/chronicles/archive/kernel/mesh";
import { bevelBox, lathe } from "../../../../shared/chronicles/archive/kernel/primitives";
import { ProfileBuilder } from "../../../../shared/chronicles/archive/kernel/profiles";
import type { ArchiveQuality } from "../../../../shared/chronicles/archive/types";
import type { Quality } from "../../settings-types";
import { createArchiveEnvironment } from "./archive-environment";
import { kernelGeometry, triangleCount } from "./archive-geometry";
import { createArchiveMaterials, type ArchiveMaterials } from "./archive-materials";

// Development-only harness for the archive renderer (ARCHITECTURE §5.1). It is
// served by the dev server at /src/chronicles/scene/harness.html and never
// enters the production bundle. Sheets:
//   ?sheet=kernel&quality=medium     every kernel form alone, in clay tinted by material slot (&tess=quest for Quest tessellation)
//   ?sheet=materials&quality=medium  the material family on sample forms: desktop PBR, then Quest's unlit look
// The page sets window.__archiveHarness.ready once the frame is drawn, with per-cell stats.

interface HarnessCellStats { id: string; triangles: number; drawCalls: number }
interface HarnessState {
  ready: boolean;
  error: string | null;
  sheet: string;
  quality: string;
  cells: HarnessCellStats[];
  textures?: { count: number; bytes: number; questCount: number; questBytes: number };
  programs?: number;
}
declare global {
  interface Window { __archiveHarness?: HarnessState }
}

const WIDTH = 1920, HEIGHT = 1080;
const params = new URLSearchParams(location.search);
const sheet = params.get("sheet") ?? "kernel";
const quality = (["low", "medium", "high"].includes(params.get("quality") ?? "") ? params.get("quality") : "medium") as Quality;
/** Kernel tessellation: the preset's own, or ?tess=quest to preview Quest's. */
const kernelQuality: ArchiveQuality = params.get("tess") === "quest" ? "quest" : quality;
const G = ARCHIVE_GEOMETRY as unknown as FormGeometry;
const wire = params.get("wire") === "1" ? new THREE.MeshBasicMaterial({ color: "#101010", wireframe: true, transparent: true, opacity: 0.35, depthTest: true }) : null;
const state: HarnessState = { ready: false, error: null, sheet, quality, cells: [] };
window.__archiveHarness = state;

type Vec3 = [number, number, number];
interface View {
  /** Degrees: 0 looks north from the south, 90 looks west from the east. */
  azimuth?: number;
  elevation?: number;
  /** A target and distance in the form's frame, from its bounds; otherwise the whole form is fitted. */
  target?: (bounds: { min: Vec3; max: Vec3 }) => Vec3;
  distance?: number;
  fit?: number;
}
interface Cell {
  id: string;
  mesh: () => MeshBuffer;
  materials: readonly string[];
  view?: View;
  /** The cell's backdrop, for screens seen against the light. */
  backdrop?: string;
  platform?: "desktop" | "quest";
}

const stage = document.getElementById("stage")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
renderer.setScissorTest(true);
stage.appendChild(renderer.domElement);

const form = (id: string) => () => {
  const mesh = buildArchiveForm(B, G, kernelQuality, id);
  if (!mesh) throw new Error(`no kernel form for ${id}`);
  return mesh;
};
const elementMaterials = (id: string) => B.elements.find((item) => item.id === id)!.materialIds;
const artifactMaterials = (id: string) => B.artifacts.find((item) => item.id === id)!.materialIds;
const plinth = () => buildPlinth(G, kernelQuality, monumentPlinthSpec(B, "desktop"));
const PLINTH_MATERIALS = ["basalt", "limestone-carved", "bronze", "limestone-dressed"] as const;
const baluster = () => {
  const writer = new MeshWriter();
  balusterForm(writer, kernelQuality);
  return writer.build();
};
/** Close on a chamber moulding where it wraps the pier at the first octagon corner, seen from the chamber. */
const PIER_CORNER = Math.PI / G.sides;
const pierCorner = (bounds: { min: Vec3; max: Vec3 }): Vec3 => {
  const radius = G.pierRadius - G.pier.inner;
  return [Math.sin(PIER_CORNER) * radius, (bounds.min[1] + bounds.max[1]) / 2, -Math.cos(PIER_CORNER) * radius];
};
const FROM_CENTRE = -THREE.MathUtils.radToDeg(PIER_CORNER);

const KERNEL_CELLS: Cell[] = [
  { id: "piers", mesh: form("piers"), materials: elementMaterials("piers"), view: { azimuth: 200, elevation: 8 } },
  { id: "piers-niche", mesh: form("piers-niche"), materials: elementMaterials("piers-niche"), view: { azimuth: 160, elevation: 8 } },
  { id: "arcade", mesh: form("arcade"), materials: elementMaterials("arcade"), view: { azimuth: 200, elevation: 6 } },
  { id: "gallery", mesh: form("gallery"), materials: elementMaterials("gallery"), view: { azimuth: 200, elevation: 18 } },
  { id: "baluster", mesh: baluster, materials: [elementMaterials("gallery")[0]], view: { azimuth: 30, elevation: 8 } },
  { id: "string-course", mesh: form("string-course"), materials: elementMaterials("string-course"), view: { azimuth: FROM_CENTRE + 35, elevation: -14, target: pierCorner, distance: 3.2 } },
  { id: "cornice", mesh: form("cornice"), materials: elementMaterials("cornice"), view: { azimuth: FROM_CENTRE + 35, elevation: -18, target: pierCorner, distance: 4.2 } },
  { id: "vault-shell", mesh: form("vault-shell"), materials: elementMaterials("vault-shell"), view: { azimuth: 20, elevation: -38 } },
  { id: "vault-ribs", mesh: form("vault-ribs"), materials: elementMaterials("vault-ribs"), view: { azimuth: 20, elevation: -38 } },
  { id: "oculus-ring", mesh: form("oculus-ring"), materials: elementMaterials("oculus-ring"), view: { azimuth: 20, elevation: -32 } },
  { id: "oculus-tracery", mesh: form("oculus-tracery"), materials: elementMaterials("oculus-tracery"), view: { azimuth: 20, elevation: -62 }, backdrop: "#e9dfcf" },
  { id: "floor", mesh: form("floor"), materials: elementMaterials("floor"), view: { azimuth: 20, elevation: 55 } },
  { id: "bay-interregnum", mesh: form("bay-interregnum"), materials: elementMaterials("bay-interregnum"), view: { azimuth: 160, elevation: 10 } },
  { id: "bay-laws", mesh: form("bay-laws"), materials: elementMaterials("bay-laws"), view: { azimuth: 160, elevation: 10 } },
  { id: "bay-contested", mesh: form("bay-contested"), materials: elementMaterials("bay-contested"), view: { azimuth: 160, elevation: 10 } },
  { id: "vestibule", mesh: form("vestibule"), materials: elementMaterials("vestibule"), view: { azimuth: 160, elevation: 14 } },
  { id: "recess-2", mesh: form("recess-2"), materials: elementMaterials("recess-2"), view: { azimuth: 160, elevation: 8 } },
  { id: "lamp-stand", mesh: form("lamps-entrance"), materials: elementMaterials("lamps-entrance"), view: { azimuth: 30, elevation: 10 } },
  { id: "sconce", mesh: form("sconces"), materials: elementMaterials("sconces"), view: { azimuth: 150, elevation: 10 } },
  { id: "annals-dial", mesh: form("annals-dial"), materials: artifactMaterials("annals-dial"), view: { azimuth: 180, elevation: 6 } },
  { id: "ring-band (detail)", mesh: form("annals-ring-outer"), materials: artifactMaterials("annals-ring-outer"), view: { azimuth: 25, elevation: 18, target: (b) => [0, 0, b.min[2] + 0.1], distance: 1.4 } },
  { id: "laws-dais", mesh: form("laws-dais"), materials: artifactMaterials("laws-dais"), view: { azimuth: 30, elevation: 26 } },
  { id: "contested-stele", mesh: form("contested-stele-west"), materials: artifactMaterials("contested-stele-west"), view: { azimuth: 200, elevation: 8 } },
  { id: "plinth (desktop)", mesh: plinth, materials: PLINTH_MATERIALS, view: { azimuth: 30, elevation: 22 } },
];

/** A sample of one material: a bevelled block, a turned column and the slab they stand on, UVs in metres. */
function swatch(): MeshBuffer {
  const writer = new MeshWriter();
  bevelBox(writer, 0, 0, 0.5, -0.25, 1.4, 1.0, 0.36, 0.03);
  const column = new ProfileBuilder(kernelQuality, 0.2, 0).up(0.04).torus(0.035).to(0.17, 0.15).up(0.6).torus(0.025).to(0.23, 0.86).up(0.08).to(0, 0.94).build();
  lathe(writer, 0, kernelQuality, column, { center: [0.42, 0, 0.32] });
  bevelBox(writer, 0, 0, -0.04, 0.05, 2.0, 0.08, 1.5, 0.01);
  return writer.build();
}
function slab(): MeshBuffer {
  const writer = new MeshWriter();
  bevelBox(writer, 0, 0, -0.05, 0, 3.2, 0.1, 3.2, 0.006);
  return writer.build();
}

function materialCells(platform: "desktop" | "quest"): Cell[] {
  const sample = (id: string): Cell => ({ id, mesh: swatch, materials: [id], view: { azimuth: 28, elevation: 16 }, platform });
  return [
    sample("limestone"),
    sample("limestone-dressed"),
    sample("limestone-carved"),
    { id: "floor-stone", mesh: slab, materials: ["floor-stone"], view: { azimuth: 20, elevation: 34, fit: 0.85 }, platform },
    sample("basalt"),
    sample("bronze"),
    { id: "bronze ring band", mesh: form("annals-ring-outer"), materials: ["bronze"], view: { azimuth: 25, elevation: 18, target: (b) => [0, 0, b.min[2] + 0.1], distance: 1.4 }, platform },
    { id: "tracery screen", mesh: form("oculus-tracery"), materials: elementMaterials("oculus-tracery"), view: { azimuth: 20, elevation: -62 }, backdrop: "#e9dfcf", platform },
    { id: "lamp stand", mesh: form("lamps-entrance"), materials: elementMaterials("lamps-entrance"), view: { azimuth: 30, elevation: 10 }, platform },
    { id: "plinth", mesh: plinth, materials: PLINTH_MATERIALS, view: { azimuth: 30, elevation: 22 }, platform },
  ];
}

const CLAY: Readonly<Record<string, string>> = {
  limestone: "#d6cec2", "limestone-dressed": "#ebe5db", "limestone-carved": "#e6d3c0", "floor-stone": "#6c6964", basalt: "#56524e",
  bronze: "#c39654", tracery: "#ebe5db", "lamp-core": "#ffd27a", sky: "#ffffff", painting: "#9fb4a0",
};

/**
 * Quest surfaces are unlit and take their light from the shared vertex bake in
 * the room. Isolated samples have no room to bake against, so the sheet gives
 * them a stand-in: a soft light from above with a little wrap.
 */
function standInBake(mesh: MeshBuffer): Float32Array {
  const colors = new Float32Array(mesh.vertexCount * 3);
  const lx = -0.35, ly = 0.85, lz = 0.4, length = Math.hypot(lx, ly, lz);
  for (let index = 0; index < mesh.vertexCount; index++) {
    const n = (mesh.normals[index * 3] * lx + mesh.normals[index * 3 + 1] * ly + mesh.normals[index * 3 + 2] * lz) / length;
    const light = 0.42 + 0.58 * Math.max(0, n * 0.8 + 0.2);
    colors[index * 3] = light;
    colors[index * 3 + 1] = light * 0.97;
    colors[index * 3 + 2] = light * 0.92;
  }
  return colors;
}

function cellCamera(geometry: THREE.BufferGeometry, view: View, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(28, aspect, 0.01, 400);
  const box = geometry.boundingBox!;
  const bounds = { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 };
  const azimuth = THREE.MathUtils.degToRad(view.azimuth ?? 30), elevation = THREE.MathUtils.degToRad(view.elevation ?? 18);
  const target = new THREE.Vector3();
  let distance: number;
  if (view.target) {
    target.fromArray(view.target(bounds));
    distance = view.distance ?? 2;
  } else {
    const sphere = geometry.boundingSphere!;
    target.copy(sphere.center);
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const fitHalf = aspect < 1 ? Math.atan(Math.tan(half) * aspect) : half;
    distance = (sphere.radius / Math.sin(fitHalf)) * (view.fit ?? 1.02);
  }
  camera.position.set(
    target.x + distance * Math.cos(elevation) * Math.sin(azimuth),
    target.y + distance * Math.sin(elevation),
    target.z + distance * Math.cos(elevation) * Math.cos(azimuth),
  );
  camera.near = Math.max(0.01, distance / 200);
  camera.far = distance * 4 + 50;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return camera;
}

function label(text: string, x: number, y: number) {
  const element = document.createElement("div");
  element.className = "harness-label";
  element.textContent = text;
  element.style.left = `${x + 6}px`;
  element.style.top = `${y + 6}px`;
  stage.appendChild(element);
}

async function drawSheet(cells: Cell[], columns: number, rows: number, materialFor: (cell: Cell, slot: number) => THREE.Material, lit: (cell: Cell) => boolean) {
  const cellWidth = WIDTH / columns, cellHeight = HEIGHT / rows;
  const scene = new THREE.Scene();
  const hemisphere = new THREE.HemisphereLight("#efe6d6", "#2a241e", 0.9);
  const key = new THREE.DirectionalLight("#fff0da", 2.6);
  key.position.set(-0.45, 1, 0.55);
  const fill = new THREE.DirectionalLight("#b9c6d6", 0.35);
  fill.position.set(0.6, 0.2, -0.7);
  scene.add(hemisphere, key, fill);
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    const buffer = cell.mesh();
    const geometry = kernelGeometry(buffer, cell.platform === "quest" ? standInBake(buffer) : undefined);
    const slots = Math.max(...buffer.groups.map((group) => group.materialIndex)) + 1;
    const bySlot = Array.from({ length: slots }, (_, slot) => materialFor(cell, slot));
    const mesh = new THREE.Mesh(geometry, bySlot);
    scene.add(mesh);
    const column = index % columns, row = Math.floor(index / columns);
    const x = column * cellWidth, y = row * cellHeight;
    const camera = cellCamera(geometry, cell.view ?? {}, cellWidth / cellHeight);
    // The key follows the camera (above and to the left of it), so faces turned down or inward still read.
    key.position.set(-0.55, 0.75, 0.35).applyQuaternion(camera.quaternion);
    fill.position.set(0.7, -0.3, 0.2).applyQuaternion(camera.quaternion);
    hemisphere.visible = key.visible = fill.visible = lit(cell);
    renderer.toneMapping = cell.platform === "quest" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.setViewport(x, HEIGHT - y - cellHeight, cellWidth, cellHeight);
    renderer.setScissor(x, HEIGHT - y - cellHeight, cellWidth, cellHeight);
    renderer.setClearColor(cell.backdrop ?? ((column + row) % 2 ? "#1c1d1f" : "#232427"), 1);
    renderer.clear();
    renderer.info.reset();
    renderer.render(scene, camera);
    if (wire) {
      // ?wire=1 overlays the triangle edges, to inspect tessellation.
      scene.overrideMaterial = wire;
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
    }
    state.cells.push({ id: cell.platform ? `${cell.platform}:${cell.id}` : cell.id, triangles: triangleCount(geometry), drawCalls: renderer.info.render.calls });
    label(`${cell.platform ? `${cell.platform} · ` : ""}${cell.id} · ${triangleCount(geometry).toLocaleString("en-US")} tris`, x, y);
    scene.remove(mesh);
    geometry.dispose();
    // Let the page breathe between cells on a shared software renderer.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  state.programs = renderer.info.programs?.length ?? 0;
}

/** One kernel form at full frame: ?sheet=form&id=arcade&az=200&el=6 (any element or artifact id, or "baluster" / "plinth"). */
async function formSheet() {
  const id = params.get("id") ?? "arcade";
  const cell = KERNEL_CELLS.find((item) => item.id === id || item.id.startsWith(`${id} `))
    ?? { id, mesh: form(id), materials: B.elements.find((item) => item.id === id)?.materialIds ?? B.artifacts.find((item) => item.id === id)?.materialIds ?? ["limestone"] };
  const view: View = { ...cell.view };
  if (params.has("az")) view.azimuth = Number(params.get("az"));
  if (params.has("el")) view.elevation = Number(params.get("el"));
  if (params.has("fit")) view.fit = Number(params.get("fit"));
  if (params.has("ty")) {
    // An explicit target (tx, ty, tz in the form's frame) and distance.
    const target: Vec3 = [Number(params.get("tx") ?? 0), Number(params.get("ty")), Number(params.get("tz") ?? 0)];
    view.target = () => target;
    view.distance = Number(params.get("dist") ?? 4);
  }
  await kernelSheetOf([{ ...cell, view }], 1, 1);
}

async function kernelSheet() {
  await kernelSheetOf(KERNEL_CELLS, 6, 4);
}

async function kernelSheetOf(cells: Cell[], columns: number, rows: number) {
  renderer.info.autoReset = false;
  const clay = new Map<string, THREE.Material>();
  const clayFor = (cell: Cell, slot: number) => {
    const id = cell.materials[slot] ?? cell.materials[0];
    let material = clay.get(id);
    if (!material) {
      const emissive = id === "lamp-core" || id === "sky";
      material = emissive ? new THREE.MeshBasicMaterial({ color: CLAY[id] ?? "#ffffff" }) : new THREE.MeshStandardMaterial({ color: CLAY[id] ?? "#d8d2c8", roughness: 0.88, metalness: 0 });
      clay.set(id, material);
    }
    return material;
  };
  await drawSheet(cells, columns, rows, clayFor, () => true);
}

async function materialSheet() {
  renderer.info.autoReset = false;
  const environment = createArchiveEnvironment(renderer);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const desktop = createArchiveMaterials({ quality, anisotropy, environment: environment.texture });
  const quest = createArchiveMaterials({ quality, anisotropy, mode: "quest-preview", vertexColors: true });
  await Promise.all([desktop.load(), quest.load()]);
  const pick = (set: ArchiveMaterials) => (cell: Cell, slot: number) => set.get(cell.materials[slot] ?? cell.materials[0]);
  const desktopFor = pick(desktop), questFor = pick(quest);
  // Create every material, then upload every texture before drawing.
  for (const cell of materialCells("desktop")) for (const id of cell.materials) { desktop.get(id); quest.get(id); }
  desktop.upload(renderer);
  quest.upload(renderer);
  state.textures = { count: desktop.textureCount, bytes: desktop.textureBytes, questCount: quest.textureCount, questBytes: quest.textureBytes };
  await drawSheet([...materialCells("desktop"), ...materialCells("quest")], 5, 4, (cell, slot) => (cell.platform === "quest" ? questFor(cell, slot) : desktopFor(cell, slot)), (cell) => cell.platform !== "quest");
}

(async () => {
  try {
    if (sheet === "materials") await materialSheet();
    else if (sheet === "form") await formSheet();
    else await kernelSheet();
    state.ready = true;
  } catch (error) {
    state.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    console.error(error);
  }
})();
