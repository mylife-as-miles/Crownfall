// Solforiz landmark and storytelling kits: the iwan hall with its glazed dome and great
// windcatcher, the niched War Record, the parade dais with its file posts and the
// representative's inlaid stone, the herald's signal tower and mirror, the Basin Gate and the
// manor portal, the covered market, the sulfur works and the unfinished cistern house.

import type { Building, BuildingMass } from "../../../blueprint";
import { bevelPrism, box, chamferBox, circleOutline, lathe, offsetPolygon, panel, prism, rectOutline } from "../../../kernel";
import type { P2 } from "../../../kernel";
import type { Face, MassFrame } from "../../architecture";
import type { KitContext } from "../../context";
import { bays, drawFileLetter, faceWall, facesOf, footing, frameOf, headPoints, headRise, inMass, massCollider, merlonRow, onFace, openingOutline, strip, beginBuilding, endBuilding } from "../variant";
import type { BuildingScope, Opening } from "../variant";
import { footprintCentre, sfDome, sfMats, SF } from "./common";
import { sfBoxMass, SF_CLOTHS } from "./mass";
import { gatePassage, sfBuilding, sfUnfinished } from "./buildings";
import { awning } from "./shapes";

/** Nested arch rings inside a deep portal reveal (a stepped half-vault). */
function portalRings(ctx: KitContext, s: BuildingScope, o: Opening, rings: number): void {
  const b = ctx.b;
  const outline = openingOutline(o, s.lod.arch);
  for (let r = 1; r <= rings; r++) {
    const z = -(o.depth * r) / (rings + 1);
    const inner = offsetPolygon(outline, -0.16 * r);
    b.material(ctx.mat(SF.plaster));
    const n = outline.length;
    for (let i = 1; i < n; i++) {
      const p = outline[i], q = outline[(i + 1) % n], pi = inner[i], qi = inner[(i + 1) % n];
      b.flatQuad(p[0], p[1], z, pi[0], pi[1], z, qi[0], qi[1], z, q[0], q[1], z);
    }
  }
}

/** Glazed tile frame (alfiz) and spandrel panels around a portal arch (face frame). */
function tileFrame(ctx: KitContext, s: BuildingScope, o: Opening, uL: number, uR: number, top: number): void {
  const b = ctx.b;
  b.material(ctx.mat(SF.tile));
  const band = 0.34;
  strip(b, uL + band / 2, 0.4, uL + band / 2, top, band, 0.05);
  strip(b, uR - band / 2, 0.4, uR - band / 2, top, band, 0.05);
  strip(b, uL, top - band / 2, uR, top - band / 2, band, 0.05);
  if (s.lod.ornament < 1) return;
  // Spandrels between the arch head and the frame.
  const ua = o.u - o.width / 2 - 0.3, ub = o.u + o.width / 2 + 0.3;
  const rise = headRise(o.shape, o.width + 0.6, o.archK);
  const spring = o.sill + o.height - headRise(o.shape, o.width, o.archK);
  const head = headPoints(o.shape, ua, ub, spring, s.lod.arch, o.archK);
  void rise;
  let mid = 0, best = Infinity;
  for (let i = 0; i < head.length; i++) {
    const d = Math.abs(head[i][0] - o.u);
    if (d < best) { best = d; mid = i; }
  }
  const t = top - band;
  const right = head.slice(0, mid + 1);
  const left = head.slice(mid).reverse();
  const prev = b.getColor();
  b.color(prev[0] * 0.8, prev[1] * 0.95, prev[2] * 1.05);
  panel(b, ([[uR - band, spring], [uR - band, t], [o.u, t]] as P2[]).concat(right.slice().reverse().filter((p) => p[1] < t)), [0, 0, 0.03], [1, 0, 0], [0, 1, 0]);
  panel(b, ([[uL + band, t], [uL + band, spring]] as P2[]).concat(left.filter((p) => p[1] < t), [[o.u, t]] as P2[]), [0, 0, 0.03], [1, 0, 0], [0, 1, 0]);
  b.color(prev[0], prev[1], prev[2]);
}

/** The iwan porch: a deep pointed portal in a tiled frame, the door and lattices at its back. */
function iwan(ctx: KitContext, s: BuildingScope, f: MassFrame): void {
  const b = ctx.b;
  const m = f.mass;
  const mats = sfMats(ctx, m.wallMaterial, "cut");
  const fresh = s.building.age.repairs.some((r) => r.kind === "fresh-render" && r.mass === m.id);
  const tint = b.getColor();
  if (fresh) b.color(tint[0] * 1.1, tint[1] * 1.08, tint[2] * 1.04);
  footing(b, f, ctx.mat(SF.sandstone), 0.4, 0.14, 0.1);
  const faces = facesOf(f);
  const arch: Opening = { u: 0, width: Math.min(4.8, f.w * 0.6), sill: 0, height: Math.min(7.4, m.eaveHeight - 5.2), shape: "pointed", depth: f.d - 0.15, fill: "none", archK: 0.8, frame: 0.28, proud: 0.1 };
  faces.forEach((face, i) => {
    onFace(b, face, () => {
      faceWall(b, { length: face.length, bottom: f.footY, top: m.eaveHeight, openings: i === 0 ? [arch] : [], mats, arch: s.lod.arch, detail: s.lod.detail, rows: [0.6, 1.8, 6] });
      if (i !== 0) return;
      if (s.lod.ornament >= 1) portalRings(ctx, s, arch, 2);
      tileFrame(ctx, s, arch, -f.w / 2 + 0.25, f.w / 2 - 0.25, arch.height + 1.0);
      // The back of the recess: the hall door and two tiers of lattice lights.
      b.push();
      b.translate(0, 0, -arch.depth);
      const ops: Opening[] = [
        { u: 0, width: 1.5, sill: 0, height: 2.7, shape: "round", depth: 0.5, fill: "door", frame: 0.18, proud: 0.05 },
        { u: -1.15, width: 0.75, sill: 3.5, height: 1.5, shape: "round", depth: 0.35, fill: s.lod.quest ? "dark" : "lattice" },
        { u: 1.15, width: 0.75, sill: 3.5, height: 1.5, shape: "round", depth: 0.35, fill: s.lod.quest ? "dark" : "lattice" },
      ];
      faceWall(b, { length: arch.width + 0.02, bottom: 0, top: arch.height, openings: ops, mats, arch: s.lod.arch, detail: s.lod.detail });
      b.pop();
    });
  });
  b.material(mats.wall);
  const ph = Math.max(0.6, m.ridgeHeight - m.eaveHeight);
  prism(b, rectOutline(f.w - 0.2, f.d - 0.2), m.eaveHeight - 0.2, m.eaveHeight, { top: true });
  faces.forEach((face) => onFace(b, face, () => {
    b.flatQuad(-face.length / 2, m.eaveHeight, 0, face.length / 2, m.eaveHeight, 0, face.length / 2, m.eaveHeight + ph, 0, -face.length / 2, m.eaveHeight + ph, 0);
    b.material(ctx.mat(SF.plaster));
    box(b, 0, m.eaveHeight + ph, -0.25, face.length + 0.1, 0.12, 0.55);
    b.material(mats.wall);
    if (s.lod.detail >= 1) merlonRow(b, "stepped", face.length - 0.2, m.eaveHeight + ph + 0.12, 0.5, 0.62, 0.68, 0.32);
  }));
  b.color(tint[0], tint[1], tint[2]);
}

/** Banner Hall: the hall, the iwan, the glazed dome on its drum and the great windcatcher. */
export function buildSfBannerHall(ctx: KitContext, building: Building): void {
  sfBuilding(ctx, building, {
    skipMass: ["iwan"],
    after: () => undefined,
  });
  const s = beginBuilding(ctx, building);
  const m = building.masses.find((x) => x.id === "iwan");
  if (m) {
    const f = frameOf(ctx, building, m);
    inMass(ctx, f, () => iwan(ctx, s, f));
    massCollider(ctx, s, f, m.ridgeHeight);
  }
  endBuilding(ctx);
}

/** War Record: a niched archive under a glazed dome, joined to the hall by its arcade. */
export function buildSfWarRecord(ctx: KitContext, building: Building): void {
  sfBuilding(ctx, building, {
    mass: (s, f) => (f.mass.role !== "hall" ? null : {
      shutters: { left: 0 },
      openingsOverride: (face: Face) => {
        const out: Opening[] = [];
        const L = face.length;
        const door = building.entrance.position;
        // Two tiers of blind pointed niches; small lattice lights high in every other niche.
        const us = bays(L, s.lod.quest ? 3.2 : 2.2, 0.9);
        const doorFace = Math.abs(face.nx) > 0.5 && ((door[0] - f.cx) * Math.cos(f.yaw) - (door[1] - f.cz) * Math.sin(f.yaw)) * face.nx > 0;
        us.forEach((u, k) => {
          if (doorFace && Math.abs(u) < 1.6) return;
          out.push({ u, width: 1.2, sill: 0.9, height: 3.1, shape: "pointed", depth: 0.32, fill: "niche", archK: 0.78, frame: s.lod.ornament >= 1 ? 0.08 : 0, proud: 0.03 });
          out.push({ u, width: 1.0, sill: 5.0, height: 2.6, shape: "pointed", depth: 0.28, fill: k % 2 === 0 && !s.lod.quest ? "lattice" : "niche", archK: 0.78 });
        });
        if (doorFace) out.push({ u: 0, width: 1.6, sill: 0, height: 3.0, shape: "pointed", depth: 0.7, fill: "door", archK: 0.75, frame: s.lod.ornament >= 1 ? 0.26 : 0, proud: 0.08 });
        return out;
      },
    }),
  });
}

/** Parade dais, file posts a–h with bronze roundels, the representative's inlaid stone. */
export function buildSfMuster(ctx: KitContext, building: Building): void {
  const s = beginBuilding(ctx, building);
  const b = ctx.b;
  const bp = ctx.bp;
  const salvaged = building.age.repairs.some((r) => r.kind === "salvaged-stone");
  for (const m of building.masses) {
    const f = frameOf(ctx, building, m);
    inMass(ctx, f, () => {
      const h = m.eaveHeight;
      b.material(ctx.mat(SF.sandstone));
      bevelPrism(b, rectOutline(f.w + 0.3, f.d + 0.3), f.footY, 0.2, 0.06);
      prism(b, rectOutline(f.w, f.d), 0.2, h - 0.16, { top: false });
      b.material(ctx.mat(SF.plaster));
      bevelPrism(b, rectOutline(f.w + 0.16, f.d + 0.16), h - 0.18, h, 0.05, { bottom: true });
      // Two full-length steps along the front, salvaged blocks in mixed tones.
      const rng = ctx.rng(`sf-dais:${building.id}`);
      const steps = 2;
      for (let i = 0; i < steps; i++) {
        const depth = (steps - i) * 0.42;
        const n = Math.max(4, Math.round(f.w / 1.4));
        for (let k = 0; k < n; k++) {
          const t = salvaged ? rng.next() : 0.5;
          const tone = salvaged && t < 0.3 ? 0.78 : salvaged && t > 0.82 ? 1.16 : 1;
          b.material(ctx.mat(t > 0.82 ? SF.plaster : SF.sandstone)).color(s.tint[0] * tone, s.tint[1] * tone, s.tint[2] * tone);
          chamferBox(b, -f.w / 2 + (k + 0.5) * (f.w / n), -0.1, f.d / 2 + depth / 2, f.w / n - 0.03, ((i + 1) * h) / (steps + 1) + 0.1, depth, 0.02);
        }
      }
      b.color(s.tint[0], s.tint[1], s.tint[2]);
      // Standard sockets where the dais standards stand.
      b.material(ctx.mat(SF.sandstone));
      for (const mt of bp.slots.bannerMounts) {
        if (mt.kind !== "standard") continue;
        const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
        const dx = mt.pose.position[0] - f.cx, dz = mt.pose.position[2] - f.cz;
        const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
        if (Math.abs(lx) > f.w / 2 || Math.abs(lz) > f.d / 2) continue;
        bevelPrism(b, rectOutline(0.62, 0.62, lx, lz), h, h + 0.42, 0.05);
        b.material(ctx.mat("bronze"));
        prism(b, circleOutline(0.13, 8, 0, lx, lz), h + 0.42, h + 0.52, { top: true });
        b.material(ctx.mat(SF.sandstone));
      }
    });
    massCollider(ctx, s, f, m.eaveHeight + 0.5, false);
  }
  // File posts: carved sandstone with a stepped cap and a bronze roundel bearing the file letter.
  for (const fm of bp.muster.fileMarkers) {
    const [x, y, z] = fm.pose.position;
    b.push();
    b.transform(x, y, z, (fm.pose.yawDeg * Math.PI) / 180);
    b.material(ctx.mat(SF.sandstone));
    bevelPrism(b, rectOutline(0.6, 0.6), -0.3, 0.14, 0.04);
    chamferBox(b, 0, 0.14, 0, 0.36, 1.12, 0.36, 0.04);
    b.material(ctx.mat(SF.plaster));
    box(b, 0, 1.26, 0, 0.46, 0.1, 0.46);
    box(b, 0, 1.36, 0, 0.3, 0.12, 0.3);
    b.material(ctx.mat("bronze"));
    b.push();
    b.transform(0, 0.86, 0.185, 0, Math.PI / 2, 0);
    lathe(b, [[0.15, 0], [0.15, 0.025]], s.lod.quest ? 8 : 14, { smooth: true, capTop: true });
    b.pop();
    if (s.lod.ornament >= 1) {
      b.material(ctx.mat("iron"));
      drawFileLetter(b, fm.file, 0, 0.75, 0.2, 0.028, 0.214, 6);
    }
    b.pop();
  }
  // The representative's place: an inlaid disc of pale stone ringed with glazed tile.
  {
    const p = bp.muster.pawnStand.position;
    b.push();
    b.translate(p[0], p[1], p[2]);
    b.material(ctx.mat(SF.tile));
    prism(b, circleOutline(1.0, s.lod.seg), -0.25, 0.05, { smooth: true, top: true });
    b.material(ctx.mat(SF.plaster)).color(s.tint[0] * 1.08, s.tint[1] * 1.06, s.tint[2] * 1.02);
    bevelPrism(b, circleOutline(0.82, s.lod.seg), 0.02, 0.12, 0.03);
    b.color(s.tint[0], s.tint[1], s.tint[2]);
    b.pop();
  }
  // Kerb of the drill square.
  if (s.lod.detail >= 1) {
    const r = bp.muster.drillSquare;
    const yaw = ((r.rotationDeg ?? 0) * Math.PI) / 180;
    b.material(ctx.mat(SF.sandstone));
    b.push();
    b.transform(r.center[0], ctx.ground(r.center[0], r.center[1]), r.center[1], yaw);
    for (const [cx, cz, w, d] of [[0, r.depth / 2, r.width, 0.24], [0, -r.depth / 2, r.width, 0.24], [r.width / 2, 0, 0.24, r.depth], [-r.width / 2, 0, 0.24, r.depth]] as const) box(b, cx, -0.2, cz, w, 0.28, d);
    b.pop();
  }
  endBuilding(ctx);
}

/** Herald's Station: the signal tower with its mirror frame, the post court and its lamps. */
export function buildSfHerald(ctx: KitContext, building: Building): void {
  const renewed = building.age.repairs.some((r) => r.kind === "new-timber");
  const s = sfBuilding(ctx, building, {
    after: (sc, f) => {
      const b = ctx.b;
      if (f.mass.role !== "tower") return;
      const deck = f.mass.eaveHeight;
      b.material(ctx.mat(SF.palm));
      const prev = b.getColor();
      if (renewed) b.color(prev[0] * 1.25, prev[1] * 1.2, prev[2] * 1.1);
      // A-frame on the roof deck carrying the signal mirror, turned down the causeway (+Z).
      for (const sx of [-0.9, 0.9]) {
        b.push();
        b.transform(sx, deck, 0.3, 0, -0.12, 0);
        box(b, 0, 0, 0, 0.16, 2.9, 0.16);
        b.pop();
      }
      box(b, 0, deck + 2.6, 0.62, 2.2, 0.14, 0.14);
      b.color(prev[0], prev[1], prev[2]);
      b.push();
      b.transform(0, deck + 1.75, 0.55, 0, Math.PI / 2 - 0.25, 0);
      b.material(ctx.mat(SF.palm));
      lathe(b, [[0.86, -0.06], [0.86, 0]], sc.lod.quest ? 10 : 18, { smooth: true, capBottom: true });
      b.material(ctx.mat("gilt"));
      lathe(b, [[0.78, 0], [0.78, 0.04]], sc.lod.quest ? 10 : 18, { smooth: true, capTop: true });
      b.pop();
    },
  });
  // Lamps at the post-court door.
  const door = building.entrance.position;
  const g = ctx.ground(door[0], door[1]);
  ctx.lights.push({ name: `${building.id}:lamp`, position: [door[0], g + 2.6, door[1]], color: "#ffc477", intensity: 6, range: 9, flicker: 0.4, priority: 2, gate: null });
  void s;
}

/** Basin Gate: two battered towers, the passage with its open iron leaves and a machicolation. */
export function buildSfGatehouse(ctx: KitContext, building: Building): void {
  const gate = ctx.bp.gates.find((g) => g.kind === "main-gate");
  sfBuilding(ctx, building, {
    mass: (s, f) => (f.mass.role !== "gatehouse" ? null : {
      shutters: { left: 0 },
      openingsOverride: (face, i) => gatePassage(ctx, s, f, face, i, gate ? gate.width : 4.2, gate ? gate.height : 6.5),
    }),
    after: (s, f) => {
      const b = ctx.b;
      if (f.mass.role === "tower") {
        // Battered skirt on the outer faces.
        b.material(ctx.mat(f.mass.wallMaterial));
        const lo = offsetPolygon(rectOutline(f.w, f.d), 0.35), hi = rectOutline(f.w + 0.02, f.d + 0.02);
        for (let k = 0; k < 4; k++) {
          const p = lo[k], q = lo[(k + 1) % 4], ph = hi[k], qh = hi[(k + 1) % 4];
          b.flatQuad(q[0], f.footY, q[1], p[0], f.footY, p[1], ph[0], 2.2, ph[1], qh[0], 2.2, qh[1]);
        }
        return;
      }
      if (f.mass.role !== "gatehouse") return;
      // Machicolation box on corbels over the outer arch, with slits.
      const faces = facesOf(f);
      const outer = faces[0];
      onFace(b, outer, () => {
        b.material(ctx.mat(f.mass.wallMaterial));
        for (const u of [-1.2, 0, 1.2]) {
          b.push();
          b.translate(u, f.mass.eaveHeight - 1.9, 0.35);
          lathe(b, [[0.06, -0.5], [0.3, 0]], 4, { smooth: false, phase: Math.PI / 4, capTop: true });
          b.pop();
        }
        box(b, 0, f.mass.eaveHeight - 1.9, 0.38, 3.4, 1.6, 0.76);
        b.material(ctx.mat("glass-dark"));
        for (const u of [-1, 0, 1]) box(b, u, f.mass.eaveHeight - 1.5, 0.77, 0.14, 0.8, 0.02);
        b.material(ctx.mat(f.mass.wallMaterial));
        if (s.lod.detail >= 1) merlonRow(b, "stepped", 3.3, f.mass.eaveHeight - 0.3, 0.3, 0.5, 0.5, 0.25);
      });
      // Open iron-sheathed leaves folded against the passage walls.
      const w = gate ? gate.width : 4.2;
      b.material(ctx.mat("iron"));
      for (const sx of [-1, 1]) box(b, sx * (w / 2 - 0.1), 0, f.d / 2 - 1.4, 0.12, Math.min(5.5, (gate ? gate.height : 6) - 1.2), 2.0);
    },
  });
  const door = building.entrance.position;
  const g = ctx.ground(door[0], door[1]);
  ctx.lights.push({ name: `${building.id}:lanterns`, position: [door[0], g + 4, door[1]], color: "#ffc477", intensity: 8, range: 12, flicker: 0.35, priority: 2, gate: null });
}

/** Manor Gate: a tall blank portal with a low pointed passage and new palm-timber leaves. */
export function buildSfManorGate(ctx: KitContext, building: Building): void {
  const gate = ctx.bp.gates.find((g) => g.kind === "inner-gate");
  const renewed = building.age.repairs.some((r) => r.kind === "replaced-gate");
  sfBuilding(ctx, building, {
    mass: (s, f) => ({ shutters: { left: 0 }, openingsOverride: (face, i) => gatePassage(ctx, s, f, face, i, gate ? gate.width : 3.6, 3.9) }),
    after: (s, f) => {
      if (!renewed || s.lod.detail < 1) return;
      const b = ctx.b;
      b.material(ctx.mat(SF.palm));
      const prev = b.getColor();
      b.color(prev[0] * 1.3, prev[1] * 1.22, prev[2] * 1.08);
      for (const u of [-0.9, 0, 0.9]) box(b, u, 0.1, f.d / 2 - f.d / 2 + 0.02, 0.06, 3.3, 0.04);
      b.color(prev[0], prev[1], prev[2]);
    },
  });
}

/** Covered market: shop fronts with awnings under the vaulted street. */
export function buildSfMarket(ctx: KitContext, building: Building): void {
  const vault = building.masses.find((m) => m.role === "canopy");
  const vx = vault ? vault.center[0] : footprintCentre(building)[0];
  const vz = vault ? vault.center[1] : footprintCentre(building)[1];
  sfBuilding(ctx, building, {
    mass: (s, f) => (f.mass.role !== "block" ? null : {
      shutters: { left: 0 },
      openingsOverride: (face: Face) => {
        const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
        const nx = face.nx * c + face.nz * sn, nz = -face.nx * sn + face.nz * c;
        const wx = f.cx + face.cx * c + face.cz * sn, wz = f.cz - face.cx * sn + face.cz * c;
        const toward = (vx - wx) * nx + (vz - wz) * nz;
        if (toward <= 0.5) return [];
        const rng = ctx.rng(`sf-shop:${building.id}:${f.mass.id}`);
        const out: Opening[] = [];
        for (const u of bays(face.length, 2.9, 0.4)) out.push({ u, width: 2.1, sill: 0, height: 2.6, shape: "segmental", depth: 0.7, fill: rng.chance(0.6) ? "lit" : "dark", light: 0.55 + rng.next() * 0.4 });
        for (const u of bays(face.length, 2.4, 0.6)) out.push({ u, width: 0.7, sill: 3.9, height: 1.2, shape: "round", depth: 0.4, fill: s.lod.quest ? "dark" : "lattice" });
        return out;
      },
    }),
    after: (s, f) => {
      if (f.mass.role !== "block" || s.lod.ornament < 1) return;
      const b = ctx.b;
      const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
      for (const face of facesOf(f)) {
        const nx = face.nx * c + face.nz * sn, nz = -face.nx * sn + face.nz * c;
        const wx = f.cx + face.cx * c + face.cz * sn, wz = f.cz - face.cx * sn + face.cz * c;
        if ((vx - wx) * nx + (vz - wz) * nz <= 0.5) continue;
        const rng = ctx.rng(`sf-awning:${building.id}:${f.mass.id}`);
        onFace(ctx.b, face, () => {
          for (const u of bays(face.length, 2.9, 0.4)) awning(ctx, b, u, 2.3, 3.0, 0.9, 0.45, SF_CLOTHS[rng.int(0, SF_CLOTHS.length - 1)]);
        });
      }
    },
  });
}

/** Sulfur works: stained rubble kiln house with a furnace mouth, banded flue, sawtooth shed. */
export function buildSfSulfurWorks(ctx: KitContext, building: Building): void {
  sfBuilding(ctx, building, {
    after: (s, f) => {
      const b = ctx.b;
      if (f.mass.role === "stack" || f.mass.role === "chimney") return;
      // Yellow sulfur staining up the lower walls.
      b.material(ctx.mat(SF.sulfur));
      const prev = b.getColor();
      b.color(prev[0] * 0.9, prev[1] * 0.86, prev[2] * 0.7);
      for (const face of facesOf(f)) onFace(b, face, () => b.flatQuad(-face.length / 2, f.footY, 0.03, face.length / 2, f.footY, 0.03, face.length / 2, 0.9 + (face.long ? 0.4 : 0), 0.03, -face.length / 2, 1.1, 0.03));
      b.color(prev[0], prev[1], prev[2]);
    },
  });
  // Furnace glow at the kiln-house door.
  const door = building.entrance.position;
  const g = ctx.ground(door[0], door[1]);
  ctx.fires.push({ id: `${building.id}:furnace`, position: [door[0], g + 0.5, door[1]], size: 0.6, gate: null });
  ctx.lights.push({ name: `${building.id}:furnace`, position: [door[0], g + 1.2, door[1]], color: "#ff7a2a", intensity: 10, range: 10, flicker: 0.7, priority: 2, gate: null });
}

/** The unfinished cistern house and, from its hall tier, the completed vaulted cistern house. */
export function buildSfCisternHouse(ctx: KitContext, building: Building): void {
  sfUnfinished(ctx, building, (m: BuildingMass) => {
    if (m.role === "scaffold") return null;
    const eave = Math.max(5, m.eaveHeight + 1.6);
    return { ...m, role: "house", eaveHeight: eave, ridgeHeight: eave + 0.8, roof: { form: "flat-parapet", ridgeAxis: m.roof.ridgeAxis, material: SF.plaster } };
  });
  // A small glazed dome over the completed cistern (tier gate shared with the completed form).
  const tier = building.unfinished ? building.unfinished.completesAtHallTier : 1;
  const walls = building.masses.find((m) => m.role !== "scaffold");
  if (!walls) return;
  const s = beginBuilding(ctx, building, { gate: { minHallTier: tier }, condition: "new" });
  const f = frameOf(ctx, building, walls);
  inMass(ctx, f, () => {
    const eave = Math.max(5, walls.eaveHeight + 1.6);
    ctx.b.material(ctx.mat(SF.plaster));
    prism(ctx.b, circleOutline(2.0, s.lod.seg), eave, eave + 0.7, { smooth: true, top: false });
    sfDome(ctx, ctx.b, 2.05, eave + 0.68, eave + 3.1, SF.tile, s.lod);
  });
  endBuilding(ctx);
}

/** Oasis pump house with its water wheel on the reservoir side. */
export function buildSfPumpHouse(ctx: KitContext, building: Building): void {
  const s = sfBuilding(ctx, building);
  if (s.lod.detail < 1) return;
  const house = building.masses[0];
  const f = frameOf(ctx, building, house);
  const b = ctx.b;
  b.part(s.part, s.landmark).gate(null);
  inMass(ctx, f, () => {
    b.material(ctx.mat(SF.palm));
    b.push();
    b.translate(f.w / 2 + 0.6, 2.2, 0);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      b.push();
      b.transform(0, Math.sin(a) * 2.1, Math.cos(a) * 2.1, 0, -a, 0);
      box(b, -0.2, -0.06, 0, 0.4, 0.12, 1.15);
      b.pop();
      if (i % 3 === 0) {
        b.push();
        b.transform(0, 0, 0, 0, -a, 0);
        box(b, 0, -0.05, 1.0, 0.1, 0.1, 2.1);
        b.pop();
      }
    }
    b.pop();
  });
  endBuilding(ctx);
}
