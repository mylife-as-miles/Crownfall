// Dressing kit: the blueprint's authored clusters (wells, fires, carts, barrels,
// pells, racks, troughs, braziers, cranes...) as small merged props, plus their
// fires and practical lights. Every cluster is placed exactly where the blueprint
// puts it; nothing is randomly scattered.

import type { DressingCluster } from "../../blueprint";
import { box, chamferBox, circleOutline, lathe, prism, rectOutline, bevelPrism } from "../../kernel";
import type { MeshBuilder } from "../../kernel";
import type { KitContext } from "../context";

function barrel(b: MeshBuilder, x: number, z: number, y: number, h = 0.95): void {
  b.push();
  b.translate(x, y, z);
  lathe(b, [[0.26, 0], [0.33, h * 0.5], [0.26, h]], 9, { smooth: true, capTop: true });
  b.pop();
}

function crate(b: MeshBuilder, x: number, z: number, y: number, s = 0.7, yaw = 0): void {
  b.push();
  b.transform(x, y, z, yaw);
  chamferBox(b, 0, 0, 0, s, s * 0.8, s, 0.03);
  b.pop();
}

export function fireAt(ctx: KitContext, id: string, x: number, y: number, z: number, size: number, light: { color: string; intensity: number; range: number; priority: number } | null): void {
  const b = ctx.b;
  const prevMat = b.currentMaterial;
  b.material(ctx.mat("fire"));
  b.motion({ kind: "flicker", rate: 7, depth: 0.35 });
  b.shadows(false, false);
  b.push();
  b.translate(x, y, z);
  for (let i = 0; i < 3; i++) {
    b.push();
    b.rotateY((i / 3) * Math.PI);
    b.motionWeight(i / 3);
    lathe(b, [[size * 0.45, 0], [size * 0.28, size * 0.6], [0.01, size * 1.3]], 5, { smooth: false });
    b.pop();
  }
  b.pop();
  b.motion(null);
  b.motionWeight(0);
  b.shadows(true, true);
  b.material(prevMat);
  ctx.fires.push({ id, position: [x, y, z], size, gate: null });
  if (light) ctx.lights.push({ name: id, position: [x, y + size * 0.9, z], color: light.color, intensity: light.intensity, range: light.range, flicker: 0.8, priority: light.priority, gate: null });
}

function prop(ctx: KitContext, d: DressingCluster): void {
  const b = ctx.b;
  const x = d.position[0], z = d.position[1];
  const g = ctx.ground(x, z);
  const yaw = (d.yawDeg * Math.PI) / 180;
  const rng = ctx.rng(`dress:${d.id}`);
  b.push();
  b.transform(x, g, z, yaw);
  switch (d.kind) {
    case "well": {
      b.material(ctx.mat(ctx.style.keys.rubble));
      lathe(b, [[0.95, -0.3], [0.95, 0.85], [0.75, 0.85], [0.75, 0.2]], 12, { smooth: false });
      b.material(ctx.mat("timber-dark"));
      box(b, -0.85, 0.8, 0, 0.14, 1.9, 0.14);
      box(b, 0.85, 0.8, 0, 0.14, 1.9, 0.14);
      box(b, 0, 2.55, 0, 1.9, 0.14, 0.14);
      b.material(ctx.mat(ctx.style.keys.roof));
      b.push();
      b.translate(0, 2.7, 0);
      prism(b, [[-1.1, -0.7], [1.1, -0.7], [1.1, 0.7], [-1.1, 0.7]], 0, 0.12, { top: true, bottom: true });
      b.pop();
      break;
    }
    case "cooking-fire": {
      b.material(ctx.mat("stone-generic"));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        b.push();
        b.transform(Math.sin(a) * 0.55, 0, Math.cos(a) * 0.55, a);
        chamferBox(b, 0, -0.05, 0, 0.28, 0.22, 0.22, 0.04);
        b.pop();
      }
      b.material(ctx.mat("iron"));
      box(b, -0.6, 0, 0, 0.05, 1.1, 0.05);
      box(b, 0.6, 0, 0, 0.05, 1.1, 0.05);
      box(b, 0, 1.08, 0, 1.25, 0.04, 0.04);
      b.pop();
      fireAt(ctx, d.id, x, g + 0.05, z, 0.45, { color: "#ff9a4a", intensity: 6, range: 9, priority: 2 });
      return;
    }
    case "brazier": {
      b.material(ctx.mat("iron"));
      lathe(b, [[0.12, 0], [0.1, 0.9], [0.45, 1.05], [0.5, 1.25]], 8, { smooth: false });
      b.pop();
      fireAt(ctx, d.id, x, g + 1.12, z, 0.42, { color: "#ffad5c", intensity: 9, range: 12, priority: 5 });
      return;
    }
    case "woodpile":
    case "scaffold-stack": {
      b.material(ctx.mat(d.kind === "woodpile" ? "timber-dark" : "timber-raw"));
      const rows = d.kind === "woodpile" ? 4 : 3;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < 6 - r; i++) {
          b.push();
          b.transform((i - (5 - r) / 2) * 0.24, 0.12 + r * 0.21, 0, 0, Math.PI / 2, 0);
          lathe(b, [[0.11, -1.1], [0.11, 1.1]], 6, { smooth: false, capTop: true, capBottom: true });
          b.pop();
        }
      }
      break;
    }
    case "cart": {
      b.material(ctx.mat("timber-raw"));
      chamferBox(b, 0, 0.7, 0, 1.4, 0.12, 2.6, 0.02);
      box(b, -0.68, 0.82, 0, 0.06, 0.45, 2.6);
      box(b, 0.68, 0.82, 0, 0.06, 0.45, 2.6);
      box(b, 0, 0.82, -1.28, 1.4, 0.45, 0.06);
      box(b, -0.25, 0.62, 2.2, 0.08, 0.08, 2.2);
      box(b, 0.25, 0.62, 2.2, 0.08, 0.08, 2.2);
      b.material(ctx.mat("timber-dark"));
      for (const s of [1, -1]) {
        b.push();
        b.transform(s * 0.82, 0.62, 0.1, 0, 0, Math.PI / 2);
        lathe(b, [[0.6, -0.06], [0.6, 0.06]], 10, { smooth: false, capTop: true, capBottom: true });
        b.pop();
      }
      b.material(ctx.mat("hay"));
      if (rng.chance(0.6)) chamferBox(b, 0, 0.82, 0, 1.2, 0.5, 2.2, 0.2);
      break;
    }
    case "barrels": {
      b.material(ctx.mat("timber-raw"));
      for (let i = 0; i < 5; i++) barrel(b, (i % 3) * 0.7 - 0.7, Math.floor(i / 3) * 0.7, 0);
      break;
    }
    case "crates":
    case "pallets": {
      b.material(ctx.mat("timber-raw"));
      for (let i = 0; i < 4; i++) crate(b, (i % 2) * 0.8, Math.floor(i / 2) * 0.8, 0, 0.7, rng.jitter(0.2));
      crate(b, 0.4, 0.4, 0.56, 0.65, 0.3);
      break;
    }
    case "laundry-line": {
      b.material(ctx.mat("timber-dark"));
      box(b, -3, 0, 0, 0.1, 2.6, 0.1);
      box(b, 3, 0, 0, 0.1, 2.6, 0.1);
      box(b, 0, 2.5, 0, 6, 0.03, 0.03);
      b.material(ctx.mat("cloth-dyed"));
      b.motion({ kind: "cloth", amplitude: 0.12, frequency: 1.1 });
      for (let i = 0; i < 5; i++) {
        const cx = -2.3 + i * 1.15;
        const w = 0.7 + rng.next() * 0.3, h = 0.8 + rng.next() * 0.5;
        const k = 0.75 + rng.next() * 0.5;
        b.color(k * (rng.chance(0.5) ? 0.75 : 1.1), k * 0.85, k * (rng.chance(0.5) ? 1.15 : 0.8));
        b.motionWeight(0);
        const a = b.vertex(cx - w / 2, 2.5, 0, 0, 0, 1, 0, 1);
        const c = b.vertex(cx + w / 2, 2.5, 0, 0, 0, 1, 1, 1);
        b.motionWeight(1);
        const dd = b.vertex(cx + w / 2, 2.5 - h, 0, 0, 0, 1, 1, 0);
        const e = b.vertex(cx - w / 2, 2.5 - h, 0, 0, 0, 1, 0, 0);
        b.quad(e, dd, c, a);
      }
      b.motionWeight(0);
      b.motion(null);
      b.color(1, 1, 1);
      break;
    }
    case "practice-pell": {
      for (let i = 0; i < 4; i++) {
        b.material(ctx.mat("timber-raw"));
        b.push();
        b.translate(i * 1.6 - 2.4, 0, 0);
        if (i === 2) {
          box(b, 0, 0, 0, 0.26, 0.9, 0.26);
          b.transform(0.1, 0.9, 0, 0, 0, -0.35);
          box(b, 0, 0, 0, 0.2, 0.8, 0.22);
        } else box(b, 0, 0, 0, 0.26, 1.8, 0.26);
        b.pop();
      }
      break;
    }
    case "archery-butt": {
      b.material(ctx.mat("hay"));
      b.push();
      b.transform(0, 0.75, 0, 0, Math.PI / 2, 0);
      lathe(b, [[0.7, -0.25], [0.75, 0], [0.7, 0.25]], 10, { smooth: true, capTop: true, capBottom: true });
      b.pop();
      b.material(ctx.mat("timber-dark"));
      box(b, -0.5, 0, -0.35, 0.1, 1.2, 0.1);
      box(b, 0.5, 0, -0.35, 0.1, 1.2, 0.1);
      break;
    }
    case "weapon-rack": {
      b.material(ctx.mat("timber-dark"));
      box(b, -1.2, 0, 0, 0.12, 1.5, 0.12);
      box(b, 1.2, 0, 0, 0.12, 1.5, 0.12);
      box(b, 0, 1.3, 0, 2.5, 0.1, 0.12);
      box(b, 0, 0.35, 0, 2.5, 0.1, 0.12);
      b.material(ctx.mat("iron"));
      for (let i = 0; i < 4; i++) box(b, -0.9 + i * 0.6, 0.3, 0.1, 0.04, 2.0, 0.04);
      break;
    }
    case "hay": {
      b.material(ctx.mat("hay"));
      for (let i = 0; i < 3; i++) chamferBox(b, i * 1.25 - 1.25, 0, rng.jitter(0.2), 1.1, 0.55, 0.6, 0.08);
      chamferBox(b, -0.6, 0.55, 0, 1.1, 0.55, 0.6, 0.08);
      break;
    }
    case "anvil": {
      b.material(ctx.mat("timber-dark"));
      prism(b, circleOutline(0.32, 8), 0, 0.55, { top: true });
      b.material(ctx.mat("iron"));
      chamferBox(b, 0, 0.55, 0, 0.62, 0.26, 0.24, 0.03);
      break;
    }
    case "quench-trough":
    case "water-jars": {
      if (d.kind === "quench-trough") {
        b.material(ctx.mat(ctx.style.keys.rubble));
        prism(b, rectOutline(1.8, 0.8), 0, 0.7, { top: false });
        b.material(ctx.mat("water"));
        prism(b, rectOutline(1.6, 0.6), 0.55, 0.62, { top: true });
      } else {
        b.material(ctx.mat("plaster-lime"));
        for (let i = 0; i < 4; i++) {
          b.push();
          b.translate((i % 2) * 0.55, 0, Math.floor(i / 2) * 0.55);
          lathe(b, [[0.12, 0], [0.24, 0.3], [0.14, 0.62], [0.1, 0.7]], 8, { smooth: true });
          b.pop();
        }
      }
      break;
    }
    case "notice-board": {
      b.material(ctx.mat("timber-dark"));
      box(b, -0.9, 0, 0, 0.12, 2.3, 0.12);
      box(b, 0.9, 0, 0, 0.12, 2.3, 0.12);
      chamferBox(b, 0, 1.0, 0, 1.9, 1.2, 0.08, 0.02);
      b.material(ctx.mat(ctx.style.keys.roof));
      b.push();
      b.translate(0, 2.3, 0);
      prism(b, rectOutline(2.2, 0.5), 0, 0.1, { top: true, bottom: true });
      b.pop();
      break;
    }
    case "boundary-stone":
    case "standing-stone": {
      b.material(ctx.mat("stone-generic"));
      chamferBox(b, 0, -0.2, 0, 0.45, d.kind === "standing-stone" ? 2.4 : 1.4, 0.3, 0.08);
      break;
    }
    case "stone-pile": {
      b.material(ctx.mat(ctx.style.keys.ashlar));
      for (let i = 0; i < 7; i++) {
        const lvl = i < 4 ? 0 : i < 6 ? 1 : 2;
        b.push();
        b.transform((i % 4) * 0.95 - 1.4 + lvl * 0.45, lvl * 0.5, rng.jitter(0.15), rng.jitter(0.12));
        chamferBox(b, 0, 0, 0, 0.9, 0.5, 0.6, 0.04);
        b.pop();
      }
      break;
    }
    case "lamp-post": {
      b.material(ctx.mat("iron"));
      box(b, 0, 0, 0, 0.1, 3.2, 0.1);
      box(b, 0.3, 3.0, 0, 0.6, 0.06, 0.06);
      b.material(ctx.mat("glass-lit"));
      chamferBox(b, 0.55, 2.6, 0, 0.26, 0.38, 0.26, 0.04);
      b.pop();
      ctx.lights.push({ name: d.id, position: [x + Math.cos(yaw) * 0.55, g + 2.8, z - Math.sin(yaw) * 0.55], color: "#ffb870", intensity: 4, range: 9, flicker: 0.2, priority: 1, gate: null });
      return;
    }
    case "bench": {
      b.material(ctx.mat("timber-dark"));
      box(b, 0, 0.42, 0, 1.6, 0.07, 0.38);
      box(b, -0.65, 0, 0, 0.08, 0.42, 0.34);
      box(b, 0.65, 0, 0, 0.08, 0.42, 0.34);
      break;
    }
    case "crane": {
      // Treadwheel crane: wheel, frame and jib.
      b.material(ctx.mat("timber-raw"));
      box(b, -0.9, 0, -1.2, 0.2, 2.6, 0.2);
      box(b, 0.9, 0, -1.2, 0.2, 2.6, 0.2);
      box(b, -0.9, 0, 1.2, 0.2, 2.6, 0.2);
      box(b, 0.9, 0, 1.2, 0.2, 2.6, 0.2);
      b.push();
      b.transform(0, 2.2, 0, 0, 0, Math.PI / 2);
      lathe(b, [[2.0, -0.7], [2.0, 0.7]], 14, { smooth: false });
      lathe(b, [[1.85, 0.7], [1.85, -0.7]], 14, { smooth: false });
      b.pop();
      box(b, 0, 0, 0, 0.35, 6.5, 0.35);
      b.push();
      b.transform(0, 6.2, 0, 0, 0, -0.5);
      box(b, 2.2, 0, 0, 4.6, 0.26, 0.26);
      b.pop();
      break;
    }
    case "market-stall":
    case "awning": {
      b.material(ctx.mat("timber-dark"));
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) box(b, sx * 1.2, 0, sz * 0.8, 0.1, 2.2, 0.1);
      chamferBox(b, 0, 0.8, 0, 2.4, 0.1, 1.6, 0.02);
      b.material(ctx.mat("cloth-dyed"));
      prism(b, rectOutline(2.7, 1.9), 2.2, 2.26, { top: true, bottom: true });
      break;
    }
    case "grave-markers": {
      b.material(ctx.mat("stone-generic"));
      for (let i = 0; i < 5; i++) chamferBox(b, i * 0.9 - 1.8, -0.1, rng.jitter(0.2), 0.4, 0.8 + rng.next() * 0.3, 0.12, 0.04);
      break;
    }
    case "beast-tether": {
      b.material(ctx.mat("timber-dark"));
      box(b, 0, 0, 0, 0.14, 1.2, 0.14);
      break;
    }
    default: {
      b.material(ctx.mat("timber-raw"));
      chamferBox(b, 0, 0, 0, 0.8, 0.6, 0.8, 0.04);
    }
  }
  b.pop();
  void bevelPrism;
}

export function buildDressing(ctx: KitContext): void {
  const { bp, b } = ctx;
  b.part("dressing", null).gate(null).shadows(true, true);
  b.uvMode = "world";
  for (const d of bp.dressing) {
    if (!ctx.quality.dressing && d.kind !== "brazier" && d.kind !== "cooking-fire" && d.kind !== "crane" && d.kind !== "well") continue;
    b.color(1, 1, 1);
    prop(ctx, d);
  }
  b.color(1, 1, 1);
}
