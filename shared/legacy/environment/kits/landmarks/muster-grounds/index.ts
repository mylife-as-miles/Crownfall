// Muster Grounds kit (district B): the dais (moulded platform, steps of salvaged stone on
// the representative's axis, standard sockets and the officers' bench), the eight file
// stones a–h with bronze letters, the nominated representative's marked stand, the drill
// square's kerbs, the training ground (quintain, stave rack, cresset poles), sentry boxes,
// the armoury with its weapon store under a pentice, and the levy hall's infirmary awning
// over the injured representative's rest. Places only: who stands where is state.

import type { Building, BuildingMass } from "../../../blueprint";
import { bevelPrism, box, chamferBox, circleOutline, lathe, prism, rectOutline, Rng } from "../../../kernel";
import type { MeshBuilder, P2 } from "../../../kernel";
import type { KitContext } from "../../context";
import { buildArchitecture, massFrame } from "../../architecture";
import { traditionStyle } from "../../nations/style";
import { barAlong, buildGothicMass, enterFace, faceMaterials, landmarkLod, landmarkMaterials, massCollider, rectFaces, slopedRoof } from "../gothic";
import type { FaceOpening, LandmarkLod, LandmarkMaterials } from "../gothic";

/** Stroke glyphs for the chess file letters, in a box 0.6 wide, x-height 0.5, ascender 0.8. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function fileGlyph(letter: string): P2[][] {
  const d = Math.PI / 180;
  const bowl = (cx: number): P2[] => arc(cx, 0.24, 0.21, 0, 360 * d, 12);
  switch (letter) {
    case "a": return [bowl(-0.02), [[0.2, 0], [0.2, 0.48]]];
    case "b": return [[[-0.2, 0], [-0.2, 0.8]], bowl(0.02)];
    case "c": return [arc(0.02, 0.24, 0.21, 40 * d, 320 * d, 10)];
    case "d": return [[[0.2, 0], [0.2, 0.8]], bowl(-0.02)];
    case "e": return [arc(0, 0.24, 0.21, 0, 320 * d, 11), [[-0.21, 0.24], [0.21, 0.24]]];
    case "f": return [([[-0.04, 0], [-0.04, 0.6]] as P2[]).concat(arc(0.12, 0.6, 0.16, 180 * d, 30 * d, 5)), [[-0.2, 0.44], [0.14, 0.44]]];
    case "g": return [arc(-0.02, 0.3, 0.19, 0, 360 * d, 12), ([[0.17, 0.48], [0.17, -0.06]] as P2[]).concat(arc(-0.02, -0.06, 0.19, 0, -160 * d, 5))];
    case "h": return [[[-0.2, 0], [-0.2, 0.8]], ([[-0.2, 0.26]] as P2[]).concat(arc(0, 0.26, 0.2, 160 * d, 0, 5), [[0.2, 0]] as P2[])];
    default: return [];
  }
}

function fileStone(b: MeshBuilder, x: number, y: number, z: number, yaw: number, letter: string, lod: LandmarkLod, m: LandmarkMaterials, worn: number): void {
  b.push();
  b.transform(x, y, z, yaw);
  const prev = b.getColor();
  b.color(prev[0] * worn, prev[1] * worn, prev[2] * worn);
  b.material(m.ashlar);
  bevelPrism(b, rectOutline(0.56, 0.56), -0.3, 0.12, 0.04);
  chamferBox(b, 0, 0.12, 0, 0.38, 0.9, 0.38, 0.05);
  b.material(m.dressing);
  bevelPrism(b, rectOutline(0.46, 0.46), 1.02, 1.12, 0.03, { bottom: true });
  b.push();
  b.translate(0, 1.12, 0);
  lathe(b, [[0.3, 0], [0.02, 0.24]], 4, { smooth: false, phase: Math.PI / 4 });
  b.pop();
  b.color(prev[0], prev[1], prev[2]);
  // Iron plate with the file letter in bronze on the face toward the formation.
  b.material(m.iron);
  box(b, 0, 0.5, 0.2, 0.3, 0.42, 0.02);
  if (lod.ornament >= 1) {
    b.material(m.gilt);
    for (const stroke of fileGlyph(letter)) {
      const pts = stroke.map((p) => [p[0] * 0.36, 0.56 + p[1] * 0.36] as P2);
      barAlong(b, pts, 0.032, 0.21, 0.225, false);
    }
  }
  b.pop();
}

/** The dais: plinth, moulded cornice, paved top, salvaged-stone steps, sockets and the back bench. */
function dais(ctx: KitContext, building: Building, mass: BuildingMass, lod: LandmarkLod, m: LandmarkMaterials): void {
  const b = ctx.b;
  const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  const h = mass.eaveHeight;
  const salvaged = building.age.repairs.some((r) => r.kind === "salvaged-stone");
  const rng = Rng.fromKey(`dais:${building.id}`);
  b.push();
  b.transform(f.cx, f.y0, f.cz, f.yaw);
  b.uvMode = "world";
  b.material(m.ashlar);
  bevelPrism(b, rectOutline(f.w + 0.3, f.d + 0.3), f.footY, 0.18, 0.05);
  prism(b, rectOutline(f.w, f.d), 0.18, h - 0.2, { top: false });
  b.material(m.dressing);
  bevelPrism(b, rectOutline(f.w + 0.18, f.d + 0.18), h - 0.22, h - 0.04, 0.06, { bottom: true });
  b.material(m.flagstone);
  b.shadows(false, true);
  prism(b, rectOutline(f.w + 0.1, f.d + 0.1), h - 0.06, h, { top: true });
  b.shadows(true, true);
  // Steps on the front (+Z) face, on the axis of the representative's stand.
  const door = building.entrance.position;
  const sx = door[0] - f.cx;
  const steps = Math.max(2, Math.round(h / 0.27));
  const rise = h / steps;
  for (let i = 0; i < steps; i++) {
    const depth = (steps - i) * 0.3;
    const blocks = 4;
    for (let k = 0; k < blocks; k++) {
      const t = salvaged ? rng.next() : 0.5;
      const soot = salvaged && t < 0.35 ? 0.62 : salvaged && t > 0.8 ? 1.18 : 1;
      b.color(soot, soot * 0.98, soot * 0.96);
      b.material(t > 0.8 ? m.dressing : m.ashlar);
      const w = 3.2 / blocks;
      chamferBox(b, sx - 1.6 + w * (k + 0.5), -0.1, f.d / 2 + depth / 2, w - 0.02, (i + 1) * rise + 0.1, depth, 0.02);
    }
  }
  b.color(1, 1, 1);
  // Standard sockets at the dais standards, and the officers' bench along the back.
  b.material(m.ashlar);
  for (const mt of ctx.bp.slots.bannerMounts) {
    if (mt.kind !== "standard") continue;
    const dx = mt.pose.position[0] - f.cx, dz = mt.pose.position[2] - f.cz;
    if (Math.abs(dx) > f.w / 2 || Math.abs(dz) > f.d / 2) continue;
    bevelPrism(b, rectOutline(0.6, 0.6, dx, dz), h, h + 0.38, 0.05);
    b.material(m.iron);
    prism(b, circleOutline(0.14, 8, 0, dx, dz), h + 0.38, h + 0.5, { top: true });
    b.material(m.ashlar);
  }
  if (lod.detail >= 1) {
    b.material(m.ashlar);
    box(b, 0, h, -f.d / 2 + 0.3, f.w - 2.4, 0.45, 0.5);
    b.material(m.dressing);
    bevelPrism(b, rectOutline(f.w - 2.3, 0.6, 0, -f.d / 2 + 0.3), h + 0.45, h + 0.55, 0.03);
  }
  b.pop();
  massCollider(ctx, f, "muster-grounds", h + 0.6, false);
}

function pawnStand(ctx: KitContext, m: LandmarkMaterials, lod: LandmarkLod): void {
  const b = ctx.b;
  const p = ctx.bp.muster.pawnStand.position;
  const seg = lod.ornament >= 1 ? 20 : 12;
  b.push();
  b.translate(p[0], p[1], p[2]);
  b.material(m.ashlar);
  prism(b, circleOutline(0.98, seg), -0.3, 0.06, { smooth: true, top: true });
  b.material(m.dressing);
  b.color(1.12, 1.1, 1.06);
  bevelPrism(b, circleOutline(0.78, seg), 0.06, 0.18, 0.04);
  b.color(1, 1, 1);
  b.material(m.bronze);
  lathe(b, [[0.62, 0.18], [0.66, 0.19], [0.62, 0.2]], seg, { smooth: true });
  if (lod.ornament >= 1) {
    // A pawn's silhouette inlaid at the stand's centre (the formation's mark, not the house's).
    lathe(b, [[0.16, 0.18], [0.14, 0.2]], 12, { smooth: true, capTop: true });
  }
  b.pop();
}

function drillKerbs(ctx: KitContext, m: LandmarkMaterials, lod: LandmarkLod): void {
  const b = ctx.b;
  const d = ctx.bp.muster.drillSquare;
  if (d.kind !== "rect") return;
  const hw = d.width / 2, hd = d.depth / 2;
  b.material(m.fieldstone);
  const n = lod.ornament >= 1 ? 12 : 6;
  for (const zz of [-hd, hd]) {
    for (let i = 0; i <= n; i++) {
      const x = d.center[0] - hw + (i / n) * d.width, z = d.center[1] + zz;
      b.push();
      b.translate(x, ctx.ground(x, z), z);
      chamferBox(b, 0, -0.2, 0, 0.34, 0.32, 0.26, 0.05);
      b.pop();
    }
  }
  for (const xx of [-hw, hw]) {
    for (let i = 1; i < 4; i++) {
      const x = d.center[0] + xx, z = d.center[1] - hd + (i / 4) * d.depth;
      b.push();
      b.translate(x, ctx.ground(x, z), z);
      chamferBox(b, 0, -0.2, 0, 0.26, 0.32, 0.34, 0.05);
      b.pop();
    }
  }
}

/** Training ground: quintain, rack of practice staves, and cresset poles at the dais. */
function trainingGround(ctx: KitContext, m: LandmarkMaterials, lod: LandmarkLod): void {
  const b = ctx.b;
  const pells = ctx.bp.dressing.find((x) => x.kind === "practice-pell" && x.district === "B");
  const butts = ctx.bp.dressing.find((x) => x.kind === "archery-butt" && x.district === "B");
  // Quintain between the pells and the butts.
  if (pells && butts) {
    const qx = (pells.position[0] + butts.position[0]) / 2 - 2.2, qz = (pells.position[1] + butts.position[1]) / 2 + 0.4;
    const g = ctx.ground(qx, qz);
    b.push();
    b.translate(qx, g, qz);
    b.material(m.timberDark);
    box(b, 0, -0.3, 0, 0.24, 2.3, 0.24);
    b.material(m.timberRaw);
    b.push();
    b.transform(0, 1.95, 0, 0.6);
    box(b, 0, 0, 0, 2.6, 0.14, 0.14);
    b.material(m.timberDark);
    chamferBox(b, -1.2, -0.62, 0, 0.5, 0.62, 0.06, 0.08);
    b.material(m.hay);
    b.push();
    b.transform(1.25, -0.5, 0, 0, 0, 0.2);
    lathe(b, [[0.12, 0], [0.2, 0.25], [0.1, 0.5]], 6, { smooth: true, capTop: true, capBottom: true });
    b.pop();
    b.pop();
    b.pop();
    // Rack of practice staves and wooden blades beside the pells.
    const rx = pells.position[0] - 3.4, rz = pells.position[1] - 1.2;
    const gr = ctx.ground(rx, rz);
    b.push();
    b.translate(rx, gr, rz);
    b.material(m.timberDark);
    box(b, -0.9, 0, 0, 0.1, 1.4, 0.1);
    box(b, 0.9, 0, 0, 0.1, 1.4, 0.1);
    box(b, 0, 1.2, 0, 1.9, 0.08, 0.1);
    box(b, 0, 0.4, 0, 1.9, 0.08, 0.1);
    b.material(m.timberRaw);
    for (let i = 0; i < 6; i++) {
      b.push();
      b.transform(-0.7 + i * 0.28, 0.05, 0.08, 0, 0.06, 0);
      box(b, 0, 0, 0, 0.04, i % 2 ? 1.75 : 1.2, 0.04);
      b.pop();
    }
    b.pop();
  }
  // Cresset poles at the dais ends (fires lit for the muster).
  const dais = ctx.bp.buildings.find((x) => x.function === "muster-platform");
  if (dais) {
    const dm = dais.masses[0];
    for (const s of [-1, 1]) {
      const x = dm.center[0] + s * (dm.width / 2 + 0.9), z = dm.center[1] + dm.depth / 2 - 0.3;
      const g = ctx.ground(x, z);
      b.material(m.iron);
      box(b, x, g - 0.3, z, 0.1, 2.9, 0.1);
      b.push();
      b.translate(x, g + 2.5, z);
      lathe(b, [[0.06, 0], [0.32, 0.18], [0.36, 0.34]], 8, { smooth: false });
      b.pop();
      b.material(m.fire);
      b.motion({ kind: "flicker", rate: 7, depth: 0.35 });
      b.shadows(false, false);
      b.push();
      b.translate(x, g + 2.72, z);
      for (let i = 0; i < 3; i++) {
        b.push();
        b.rotateY((i / 3) * Math.PI);
        b.motionWeight(i / 3);
        lathe(b, [[0.18, 0], [0.11, 0.24], [0.01, 0.55]], 5, { smooth: false });
        b.pop();
      }
      b.pop();
      b.motion(null);
      b.motionWeight(0);
      b.shadows(true, true);
      ctx.fires.push({ id: `kv-muster-cresset-${s}`, position: [x, g + 2.72, z], size: 0.4, gate: null });
      ctx.lights.push({ name: `kv-muster-cresset-${s}`, position: [x, g + 3.1, z], color: "#ffad5c", intensity: 7, range: 11, flicker: 0.8, priority: 3, gate: null });
    }
  }
  void lod;
}

/** Sentry box: a narrow stone shelter with a pent roof and a lantern, facing `yaw`. */
function sentryBox(ctx: KitContext, m: LandmarkMaterials, x: number, z: number, yaw: number): void {
  const b = ctx.b;
  const g = ctx.ground(x, z);
  b.push();
  b.transform(x, g, z, yaw);
  b.material(m.rubble);
  box(b, 0, -0.3, -0.55, 1.5, 2.75, 0.2);
  box(b, -0.65, -0.3, 0, 0.2, 2.6, 1.1);
  box(b, 0.65, -0.3, 0, 0.2, 2.6, 1.1);
  b.material(m.slate);
  b.push();
  b.transform(0, 2.55, 0.05, 0, -0.32, 0);
  box(b, 0, 0, 0, 1.8, 0.08, 1.5);
  b.pop();
  b.material(m.timberDark);
  box(b, 0, 0.42, -0.35, 1.1, 0.06, 0.35);
  b.pop();
  ctx.collider([x, g + 1.2, z], [0.85, 1.4, 0.7], yaw, "muster-grounds", false);
}

/** The armoury: rubble with dressed quoins, an iron-strapped door, barred windows, and the weapon store under a pentice. */
export function buildArmouryKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  b.part("landmark:muster-grounds", "muster-grounds").gate(null).shadows(true, true);
  b.color(1, 1, 1);
  const mass = building.masses[0];
  const strapped = building.age.repairs.some((r) => r.kind === "iron-strapping");
  const door = building.entrance.position;
  const f0 = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
  // Face 2 (+X) looks onto the yard: u runs toward -Z.
  const doorU = -(door[1] - f0.cz);
  const barred = (u: number): FaceOpening => ({ u, width: 0.5, sill: 1.6, height: 0.7, shape: "rect", depth: 0.4, splay: 0.06, fill: "dark", tracery: "mullion" });
  const eave = mass.eaveHeight, ridge = mass.ridgeHeight;
  buildGothicMass({
    ctx, building, mass, landmark: "muster-grounds", lod, mats: faceMaterials(m, m.rubble, m.ashlar),
    faces: [
      { openings: [barred(0)], gable: { coping: false, finial: 0 }, quoins: true },
      { openings: [], gable: { coping: false, finial: 0 }, quoins: true },
      { openings: [{ u: doorU, width: 1.3, sill: 0, height: 2.3, shape: "segmental", depth: 0.35, splay: 0.1, fill: "door" }, barred(doorU + 2.4), barred(doorU - 2.4)], quoins: true },
      { openings: [barred(-1.8), barred(1.8)], quoins: true },
    ],
    plinth: { material: m.rubble, steps: [{ offset: 0.14, top: 0.25, bevel: 0.05 }] },
    wallBottom: -0.2,
    extra: (bb, f) => {
      slopedRoof(bb, { a: f.w / 2, length: f.d, eave, ridge, overhang: 0.42, verge: 0.32, thickness: 0.14, roof: m.slate, soffit: m.timberDark, ridgeCap: m.lead });
      // Iron straps across the door (melted-down old arms).
      const faces = rectFaces(f.w, f.d);
      enterFace(bb, faces[2]);
      if (strapped) {
        bb.material(m.iron);
        for (const y of [0.45, 1.15, 1.85]) box(bb, doorU, y, -0.3, 1.32, 0.08, 0.06);
      }
      // Lantern beside the door.
      bb.material(m.iron);
      box(bb, doorU + 1.0, 2.35, 0.2, 0.05, 0.05, 0.4);
      bb.material(m.glassLit);
      chamferBox(bb, doorU + 1.0, 1.85, 0.38, 0.22, 0.34, 0.22, 0.03);
      // Pentice over the weapon store along the yard face, clear of the door.
      if (lod.detail >= 1) {
        const u0 = doorU + 1.5, u1 = f.d / 2 - 0.3;
        if (u1 - u0 > 1.5) {
          const cu = (u0 + u1) / 2, len = u1 - u0;
          bb.material(m.timberDark);
          for (const u of [u0 + 0.1, u1 - 0.1]) box(bb, u, 0, 1.25, 0.14, 2.35, 0.14);
          box(bb, cu, 2.3, 1.25, len, 0.14, 0.14);
          bb.material(m.shingle);
          bb.push();
          bb.transform(cu, 2.62, 0.62, 0, 0.32, 0);
          box(bb, 0, 0, 0, len + 0.3, 0.07, 1.55);
          bb.pop();
          // Spear rack and shields on pegs (plain wood and iron: arms of the levy, not heraldry).
          bb.material(m.timberDark);
          box(bb, cu, 0.35, 0.18, len - 0.4, 0.07, 0.07);
          box(bb, cu, 1.35, 0.18, len - 0.4, 0.07, 0.07);
          const spears = Math.max(3, Math.floor((len - 0.6) / 0.3));
          for (let i = 0; i < spears; i++) {
            const u = u0 + 0.3 + (i * (len - 0.6)) / Math.max(1, spears - 1);
            bb.material(m.timberRaw);
            box(bb, u, 0.05, 0.24, 0.035, 2.0, 0.035);
            bb.material(m.iron);
            bb.push();
            bb.translate(u, 2.05, 0.24);
            lathe(bb, [[0.03, 0], [0.008, 0.2]], 4, { smooth: false });
            bb.pop();
          }
          for (let i = 0; i < 3; i++) {
            const u = u0 + 0.5 + (i * (len - 1.0)) / 2;
            bb.push();
            bb.transform(u, 1.75, 0.1, 0, Math.PI / 2, 0);
            bb.material(m.timberDark);
            lathe(bb, [[0.32, 0], [0.32, 0.04]], 10, { smooth: true, capTop: true });
            bb.material(m.iron);
            lathe(bb, [[0.07, 0.04], [0.02, 0.1]], 6, { smooth: true });
            bb.pop();
          }
        }
      }
      bb.pop();
    },
  });
  void prism;
}

/** The levy hall (architecture kit) plus its infirmary awning over the injured rest and the spliced corner post. */
export function buildLevyHallKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  buildArchitecture(ctx, building, { landmark: "muster-grounds" });
  b.part("landmark:muster-grounds", "muster-grounds").gate(null).shadows(true, true);
  b.uvMode = "world";
  const rest = ctx.bp.slots.injuredRest;
  if (building.tags.indexOf("infirmary-awning") >= 0) {
    const [x, , z] = rest.position;
    const yaw = (rest.yawDeg * Math.PI) / 180;
    const g = ctx.ground(x, z);
    b.push();
    b.transform(x, g, z, yaw);
    // The cot lies along local +Z from the wall; the awning spans it.
    b.material(m.timberDark);
    for (const sx of [-1.2, 1.2]) box(b, sx, -0.2, 2.2, 0.1, 2.45, 0.1);
    box(b, 0, 2.15, 2.2, 2.5, 0.1, 0.1);
    b.material(ctx.mat("cloth-dyed"));
    b.motion({ kind: "cloth", amplitude: 0.12, frequency: 1.1 });
    // Weathered undyed linen: it sags between the wall batten and the front bar, droops between
    // the side poles and ends in a short valance; darker and soiled toward the hanging edge.
    const cols = lod.detail >= 1 ? 6 : 4, rows = lod.detail >= 1 ? 4 : 3;
    const idx: number[] = [];
    const sheet = (u: number, t: number): [number, number, number] => {
      const across = 1 - Math.pow(u / 1.25, 2);
      return [u, 2.7 - t * 0.55 - Math.sin(t * Math.PI) * 0.2 - across * 0.12 * Math.sin(t * Math.PI * 0.5), -0.6 + t * 2.85];
    };
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const u = -1.25 + (2.5 * c) / cols;
        const t = r / rows;
        const p = sheet(u, t);
        b.motionWeight(t * 0.8);
        const k = 0.8 - t * 0.12;
        b.color(k, k * 0.95, k * 0.86);
        idx.push(b.vertex(p[0], p[1], p[2], 0, 1, 0, c / cols, t));
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = idx[r * (cols + 1) + c], d = idx[r * (cols + 1) + c + 1];
        const e = idx[(r + 1) * (cols + 1) + c], f = idx[(r + 1) * (cols + 1) + c + 1];
        b.quad(a, e, f, d);
      }
    }
    // Valance: a hanging strip along the front edge (the cloth material is double-sided).
    const top: number[] = [], bot: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const u = -1.25 + (2.5 * c) / cols;
      const p = sheet(u, 1);
      b.motionWeight(0.9);
      b.color(0.62, 0.58, 0.52);
      top.push(b.vertex(p[0], p[1], p[2] + 0.01, 0, 0, 1, c / cols, 0));
      b.motionWeight(1);
      bot.push(b.vertex(p[0], p[1] - (c % 2 === 0 ? 0.3 : 0.22), p[2] + 0.03, 0, 0, 1, c / cols, 0.12));
    }
    for (let c = 0; c < cols; c++) b.quad(bot[c], bot[c + 1], top[c + 1], top[c]);
    b.motion(null);
    b.motionWeight(0);
    b.color(1, 1, 1);
    b.pop();
  }
  // Spliced corner post: pale new timber scarfed onto the old post at the yard corner.
  if (building.age.repairs.some((r) => r.kind === "spliced-post") && lod.detail >= 1) {
    const mass = building.masses[0];
    const f = massFrame(building, mass, ctx.base(building), traditionStyle(ctx.style, building.tradition));
    const cx = f.cx + f.w / 2 - 0.02, cz = f.cz + f.d / 2 - 0.02;
    b.material(m.timberRaw);
    b.color(1.3, 1.22, 1.08);
    box(b, cx, f.y0 - 0.1, cz, 0.24, 1.3, 0.24);
    b.color(1, 1, 1);
    b.material(m.iron);
    box(b, cx, f.y0 + 1.05, cz, 0.27, 0.06, 0.27);
  }
}

export function buildMusterGroundsKit(ctx: KitContext, building: Building): void {
  const lod = landmarkLod(ctx);
  const m = landmarkMaterials(ctx);
  const b = ctx.b;
  b.part("landmark:muster-grounds", "muster-grounds").gate(null).shadows(true, true);
  b.color(1, 1, 1);
  const platform = building.masses.find((mm) => mm.role === "platform");
  if (platform) dais(ctx, building, platform, lod, m);
  else buildArchitecture(ctx, building, { landmark: "muster-grounds" });
  b.part("landmark:muster-grounds", "muster-grounds").gate(null).shadows(true, true);
  const rng = Rng.fromKey(`files:${building.id}`);
  for (const fm of ctx.bp.muster.fileMarkers) {
    const [x, y, z] = fm.pose.position;
    fileStone(b, x, y, z, (fm.pose.yawDeg * Math.PI) / 180, fm.file, lod, m, 0.88 + rng.next() * 0.2);
  }
  pawnStand(ctx, m, lod);
  drillKerbs(ctx, m, lod);
  if (lod.detail >= 1 || lod.quest) trainingGround(ctx, m, lod);
  // Sentry boxes: at the foot of the Muster Stair and where the Muster Walk enters the yard.
  const stair = ctx.bp.routes.find((r) => r.id.indexOf("muster-stair") >= 0);
  if (stair && lod.detail >= 1) {
    const p0 = stair.points[0];
    sentryBox(ctx, m, p0[0] - 2.6, p0[1] + 2.2, Math.PI / 2);
  }
  const walk = ctx.bp.routes.find((r) => r.id.indexOf("muster-walk") >= 0);
  if (walk && lod.detail >= 1) {
    const p0 = walk.points[0];
    sentryBox(ctx, m, p0[0] - 2.4, p0[1] - 4.6, Math.PI / 2);
  }
  b.gate(null);
  b.color(1, 1, 1);
}
