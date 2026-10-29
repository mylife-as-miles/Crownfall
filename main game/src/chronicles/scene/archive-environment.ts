import * as THREE from "three";

// Reflections for the archive's bronze and polished floor: a prefiltered
// environment made once from a tiny procedural interior (a bright opening
// overhead, warm stone around and a dark floor below), never from an image of
// any place. It costs one PMREM pass on open and one texture while shown.

export interface ArchiveEnvironment {
  texture: THREE.Texture;
  dispose(): void;
}

export interface ArchiveEnvironmentPalette {
  /** The opening overhead, in linear units (above 1 glows). */
  sky: number;
  /** Warm stone at mid height, and its colour. */
  stone: number;
  stoneColor: string;
  /** The dark floor below. */
  floor: number;
  floorColor: string;
}

const DEFAULT_PALETTE: ArchiveEnvironmentPalette = { sky: 9, stone: 0.62, stoneColor: "#d0b089", floor: 0.12, floorColor: "#5a4a3a" };

export function createArchiveEnvironment(renderer: THREE.WebGLRenderer, palette: Partial<ArchiveEnvironmentPalette> = {}): ArchiveEnvironment {
  const p = { ...DEFAULT_PALETTE, ...palette };
  const geometry = new THREE.SphereGeometry(1, 48, 24);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const stone = new THREE.Color(p.stoneColor), floor = new THREE.Color(p.floorColor), color = new THREE.Color();
  for (let index = 0; index < position.count; index++) {
    const y = position.getY(index);
    if (y > 0.93) color.setRGB(p.sky, p.sky * 0.97, p.sky * 0.9);
    else if (y > 0.75) color.copy(stone).multiplyScalar(p.stone * 1.6);
    else if (y > -0.1) color.copy(stone).multiplyScalar(p.stone * (0.75 + y * 0.5));
    else color.copy(floor).multiplyScalar(p.floor);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.035);
  generator.dispose();
  geometry.dispose();
  material.dispose();
  return { texture: target.texture, dispose: () => target.dispose() };
}
