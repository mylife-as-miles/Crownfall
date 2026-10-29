// Chess file letters a–h as stroke paths for the muster file markers of the variant nations
// (bronze inlay in Solforiz, carved in Aethelgard, stencilled paint in Kwind-09). These are
// the plain file letters of chess notation, readable without a caption. Box 0.6 wide, x-height
// 0.5, ascender 0.8, baseline at y = 0.

import type { MeshBuilder, P2 } from "../../../kernel";
import { strip } from "./face";

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

const D = Math.PI / 180;

export function fileLetterStrokes(letter: string, n = 10): P2[][] {
  const bowl = (cx: number): P2[] => arc(cx, 0.24, 0.21, 0, 360 * D, n);
  switch (letter) {
    case "a": return [bowl(-0.02), [[0.2, 0], [0.2, 0.48]]];
    case "b": return [[[-0.2, 0], [-0.2, 0.8]], bowl(0.02)];
    case "c": return [arc(0.02, 0.24, 0.21, 40 * D, 320 * D, n)];
    case "d": return [[[0.2, 0], [0.2, 0.8]], bowl(-0.02)];
    case "e": return [arc(0, 0.24, 0.21, 0, 320 * D, n), [[-0.21, 0.24], [0.21, 0.24]]];
    case "f": return [([[-0.04, 0], [-0.04, 0.6]] as P2[]).concat(arc(0.12, 0.6, 0.16, 180 * D, 30 * D, Math.max(3, n >> 1))), [[-0.2, 0.44], [0.14, 0.44]]];
    case "g": return [arc(-0.02, 0.3, 0.19, 0, 360 * D, n), ([[0.17, 0.48], [0.17, -0.06]] as P2[]).concat(arc(-0.02, -0.06, 0.19, 0, -160 * D, Math.max(3, n >> 1)))];
    case "h": return [[[-0.2, 0], [-0.2, 0.8]], ([[-0.2, 0.26]] as P2[]).concat(arc(0, 0.26, 0.2, 160 * D, 0, Math.max(3, n >> 1)), [[0.2, 0]] as P2[])];
    default: return [];
  }
}

/**
 * Draws a file letter as flat strips in the current face frame (u right, y up, facing +z),
 * centred on (u, y) with the given letter height and stroke width, at depth z.
 */
export function drawFileLetter(b: MeshBuilder, letter: string, u: number, y: number, size: number, stroke: number, z: number, n = 8): void {
  const k = size / 0.8;
  for (const s of fileLetterStrokes(letter, n)) {
    for (let i = 0; i < s.length - 1; i++) {
      const p = s[i], q = s[i + 1];
      strip(b, u + p[0] * k, y + p[1] * k, u + q[0] * k, y + q[1] * k, stroke, z);
    }
  }
}

/** Draws a file letter flat on the ground (plan x right, z toward the viewer), facing up. */
export function drawGroundLetter(b: MeshBuilder, letter: string, size: number, stroke: number, y: number, n = 8): void {
  b.push();
  b.transform(0, y, 0, 0, -Math.PI / 2, 0);
  drawFileLetter(b, letter, 0, -size * 0.45, size, stroke, 0, n);
  b.pop();
}
