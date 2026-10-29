// The Solforiz building kit: every sf.* blueprint building resolves here. Masses dispatch by
// role into the Solforiz grammar; unfinished structures build their tier-0 state and their
// completed form behind hall-tier gates; landmark and storytelling buildings add their own
// pieces (landmarks.ts).

import type { Building, BuildingMass } from "../../../blueprint";
import { box, circleOutline, prism } from "../../../kernel";
import type { MassFrame } from "../../architecture";
import type { KitContext } from "../../context";
import { beginBuilding, endBuilding, faceWall, facesOf, footing, frameOf, inMass, massCollider, onFace } from "../variant";
import type { BuildingScope, Opening, ScopeOptions } from "../variant";
import { doorAlong, footprintCentre, sfKind, sfMats, SF } from "./common";
import { sfArcade, sfBoxMass, sfChimney, sfRoundMass, sfScaffold, sfStack, sfWindcatcher } from "./mass";
import type { SfMassOptions } from "./mass";
import { barrelVault } from "./shapes";

export interface SfBuildOptions extends ScopeOptions {
  skipMass?: readonly string[];
  masses?: readonly BuildingMass[];
  mass?: (s: BuildingScope, f: MassFrame) => SfMassOptions | null;
  /** Called inside each mass frame after the mass is built. */
  after?: (s: BuildingScope, f: MassFrame) => void;
}

/** Builds one mass in its frame by role. */
export function sfMass(ctx: KitContext, s: BuildingScope, f: MassFrame, o: SfMassOptions): void {
  const m = f.mass;
  const building = s.building;
  switch (m.role) {
    case "windcatcher": sfWindcatcher(ctx, s, f); return;
    case "stack": sfStack(ctx, s, f, building.tags.indexOf("sulfur-heaps") >= 0); return;
    case "chimney": sfChimney(ctx, s, f); return;
    case "scaffold": sfScaffold(ctx, f); return;
    case "arcade": sfArcade(ctx, s, f); return;
    default: break;
  }
  if (f.round || f.octagon) {
    sfRoundMass(ctx, s, f);
    return;
  }
  if (m.role === "canopy" && m.roof.form === "barrel-vault") {
    const b = ctx.b;
    b.push();
    if (m.roof.ridgeAxis === "x") b.rotateY(Math.PI / 2);
    const w = m.roof.ridgeAxis === "x" ? f.d : f.w, len = m.roof.ridgeAxis === "x" ? f.w : f.d;
    barrelVault(ctx, b, w, len, m.eaveHeight, Math.max(0.6, m.ridgeHeight - m.eaveHeight), m.roof.material, s.lod.seg >> 1, s.lod.detail >= 1 ? Math.max(2, Math.round(len / 4.2)) : 0);
    b.pop();
    return;
  }
  if (m.role === "gatehouse") {
    sfBoxMass(ctx, s, f, { ...o, openingsOverride: (face, i) => gatePassage(ctx, s, f, face, i) });
    return;
  }
  sfBoxMass(ctx, s, f, o);
}

/** Through-passage of a gatehouse mass: an arch on the entrance face and its opposite. */
export function gatePassage(ctx: KitContext, s: BuildingScope, f: MassFrame, face: ReturnType<typeof facesOf>[number], i: number, width?: number, apex?: number): Opening[] | null {
  const faces = facesOf(f);
  let entry = -1;
  for (let k = 0; k < 4; k++) if (doorAlong(f, faces[k]) !== null) entry = k;
  if (entry < 0) return null;
  const opposite = entry === 0 ? 1 : entry === 1 ? 0 : entry === 2 ? 3 : 2;
  if (i !== entry && i !== opposite) return [];
  const depth = (i === 0 || i === 1 ? f.d : f.w) / 2;
  const w = width ?? Math.min(4.2, face.length * 0.6);
  const h = apex ?? Math.min(f.mass.eaveHeight - 1.6, w * 1.7);
  const along = i === entry ? doorAlong(f, face) ?? 0 : -(doorAlong(f, faces[entry]) ?? 0);
  return [{ u: along, width: w, sill: 0, height: h, shape: "pointed", depth, fill: i === entry ? "door" : "none", archK: 0.75, frame: s.lod.ornament >= 1 ? 0.3 : 0, proud: 0.08 }];
}

/** Generic Solforiz building. */
export function sfBuilding(ctx: KitContext, building: Building, opts: SfBuildOptions = {}): BuildingScope {
  const s = beginBuilding(ctx, building, opts);
  const shutters = { left: building.age.repairs.some((r) => r.kind === "boarded-opening") ? 2 : 0 };
  const masses = opts.masses ?? building.masses;
  for (const m of masses) {
    if (opts.skipMass && opts.skipMass.indexOf(m.id) >= 0) continue;
    const f = frameOf(ctx, building, m);
    const mo = (opts.mass ? opts.mass(s, f) : null) ?? { shutters };
    inMass(ctx, f, () => {
      sfMass(ctx, s, f, mo);
      if (opts.after) opts.after(s, f);
    });
    massCollider(ctx, s, f, m.ridgeHeight, m.role !== "chimney" && m.role !== "scaffold");
  }
  courtyardDetails(ctx, s);
  endBuilding(ctx);
  return s;
}

/** Fountains and court palms in courtyard houses (tags fountain-court, date-palm). */
function courtyardDetails(ctx: KitContext, s: BuildingScope): void {
  const b = ctx.b;
  const building = s.building;
  if (building.masses.length < 3) return;
  const [cx, cz] = footprintCentre(building);
  const g = s.base.floorY;
  if (building.tags.indexOf("fountain-court") >= 0 && s.lod.detail >= 1) {
    b.push();
    b.translate(cx, g, cz);
    b.material(ctx.mat(SF.sandstone));
    prism(b, circleOutline(1.1, 8, Math.PI / 8), -0.2, 0.45, { top: false });
    prism(b, circleOutline(0.9, 8, Math.PI / 8), 0.3, 0.45, { top: false, inward: true });
    b.material(ctx.mat("water"));
    prism(b, circleOutline(0.92, 8, Math.PI / 8), 0.2, 0.36, { top: true });
    b.material(ctx.mat(SF.sandstone));
    box(b, 0, 0.3, 0, 0.22, 0.75, 0.22);
    b.pop();
  }
  if (building.tags.indexOf("date-palm") >= 0) addPalm(ctx, cx, g, cz, 7.5, ctx.rng(`sf-court-palm:${building.id}`).next() * 6.28);
}

/** Palm instance hook; the site kit defines the prototype (see site.ts). */
export const SF_PALM_PROTO = "sf:palm";
export function addPalm(ctx: KitContext, x: number, y: number, z: number, h: number, yaw: number): void {
  if (!ctx.instances.has(SF_PALM_PROTO)) return;
  ctx.instances.add(SF_PALM_PROTO, x, y, z, yaw, h / 9);
}

/** Unfinished structure: tier-0 shell and scaffold, then the completed form from its tier. */
export function sfUnfinished(ctx: KitContext, building: Building, completed: (m: BuildingMass) => BuildingMass | null): void {
  const tier = building.unfinished ? building.unfinished.completesAtHallTier : 1;
  const s = beginBuilding(ctx, building, { gate: { maxHallTier: (tier - 1) as 0 | 1 | 2 } });
  for (const m of building.masses) {
    const f = frameOf(ctx, building, m);
    inMass(ctx, f, () => (m.role === "scaffold" ? sfScaffold(ctx, f) : unfinishedShell(ctx, s, f)));
  }
  endBuilding(ctx);
  const done: BuildingMass[] = [];
  for (const m of building.masses) {
    const c = completed(m);
    if (c) done.push(c);
  }
  sfBuilding(ctx, building, { gate: { minHallTier: tier }, condition: "new", masses: done });
}

/** Walls raised to their stage with a stepped top of laid courses, cut blocks and palm beams. */
function unfinishedShell(ctx: KitContext, s: BuildingScope, f: MassFrame): void {
  const b = ctx.b;
  const m = f.mass;
  const kind = sfKind(s.building);
  const mats = sfMats(ctx, m.wallMaterial, kind);
  const rng = ctx.rng(`sf-unfinished:${s.building.id}:${m.id}`);
  footing(b, f, ctx.mat(SF.sandstone), 0.3, 0.1, 0.08);
  const top = m.eaveHeight - 0.6;
  for (const face of facesOf(f)) {
    const along = doorAlong(f, face);
    const ops: Opening[] = along !== null ? [{ u: along, width: 1.6, sill: 0, height: 2.4, shape: "round", depth: 0.6, fill: "void" }] : [];
    onFace(b, face, () => {
      faceWall(b, { length: face.length, bottom: f.footY, top, openings: ops, mats, arch: s.lod.arch, detail: s.lod.detail });
      b.material(mats.wall);
      const n = Math.max(2, Math.round(face.length / 0.9));
      for (let k = 0; k < n; k++) {
        const u = -face.length / 2 + (k + 0.5) * (face.length / n);
        if (along !== null && Math.abs(u - along) < 1.1) continue;
        const h = rng.chance(0.55) ? 0.6 : rng.chance(0.5) ? 0.3 : 0;
        if (h > 0) box(b, u, top, -0.3, face.length / n - 0.04, h, 0.6);
      }
    });
  }
  if (s.lod.detail >= 1) {
    b.material(ctx.mat(SF.palm));
    const n = Math.max(2, Math.round(f.d / 2.4));
    for (let k = 0; k < Math.ceil(n / 2); k++) box(b, 0, top + 0.05, -f.d / 2 + 0.6 + k * 2.4, f.w + 0.3, 0.2, 0.2);
  }
}
