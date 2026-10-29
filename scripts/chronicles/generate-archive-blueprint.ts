// Generates docs/chronicles/ARCHIVE_BLUEPRINT.md and the plan and section
// drawings (SVG, rasterised to PNG with sharp) from the archive blueprint data.
//
//   cd main-game-vr && npx tsx ../scripts/chronicles/generate-archive-blueprint.ts          # write
//   cd main-game-vr && npx tsx ../scripts/chronicles/generate-archive-blueprint.ts --check  # compare, exit 1 on drift
//
// Never edit the outputs by hand: change shared/chronicles/archive/blueprint.ts
// and regenerate.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonClearance, framingSubject, overviewComposition, poolCoverage, questCheck, questEye, sweepFraming } from "../../shared/chronicles/archive/analysis.ts";
import { ARCHIVE_BLUEPRINT as B, ARCHIVE_GEOMETRY as G, pierPlan } from "../../shared/chronicles/archive/blueprint.ts";
import { RELIEF_ASPECT } from "../../shared/chronicles/archive/relief.ts";
import { DEG, ringPoint } from "../../shared/chronicles/archive/space.ts";
import { meridianAt, vaultMeridian } from "../../shared/chronicles/archive/kernel/vault-profile.ts";
import { ARCHIVE_GEOMETRY_BUDGET, buildArchive } from "../../shared/chronicles/archive/kernel/assemble.ts";
import type { FormGeometry } from "../../shared/chronicles/archive/kernel/forms.ts";
import { textureMemory } from "../../shared/chronicles/archive/materials.ts";
import type { ArchitecturalElement, DesktopViewpoint, Vec3 } from "../../shared/chronicles/archive/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromQuest = createRequire(join(root, "main-game-vr/package.json"));
const sharp = requireFromQuest("sharp") as typeof import("sharp");

const OUT = {
  doc: join(root, "docs/chronicles/ARCHIVE_BLUEPRINT.md"),
  planSvg: join(root, "docs/chronicles/blueprint/archive-plan.svg"),
  planPng: join(root, "docs/chronicles/blueprint/archive-plan.png"),
  sectionSvg: join(root, "docs/chronicles/blueprint/archive-section.svg"),
  sectionPng: join(root, "docs/chronicles/blueprint/archive-section.png"),
};

// ---------------------------------------------------------------------------
// Formatting

const f2 = (value: number) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
const f1 = (value: number) => (Math.abs(value) < 0.05 ? 0 : value).toFixed(1);
const deg = (radians: number) => `${f1(radians / DEG)}°`;
const v3 = (v: readonly number[]) => `(${v.map(f2).join(", ")})`;
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

// ---------------------------------------------------------------------------
// Plan drawing (top view, north up)

const INK = "#2f261c", PAPER = "#f5f0e6", STONE = "#e4d8c4", PIER = "#6a5642", BRONZE = "#9a6a2c", LIGHT = "#f2b84b", QUEST = "#2f6f9f", CAMERA = "#8a2f2f", OCCLUDER = "#b0412f";
const FONT = "DejaVu Sans, Inter, sans-serif";

function planSvg(): string {
  const scale = 22, margin = 60, legendWidth = 380;
  const minX = -20, maxX = 20, minZ = -19, maxZ = 19;
  const width = Math.round((maxX - minX) * scale + margin * 2 + legendWidth), height = Math.round((maxZ - minZ) * scale + margin * 2);
  const X = (x: number) => +(margin + (x - minX) * scale).toFixed(1), Y = (z: number) => +(margin + (z - minZ) * scale).toFixed(1);
  const pts = (points: readonly (readonly number[])[]) => points.map(([x, z]) => `${X(x)},${Y(z)}`).join(" ");
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`);
  out.push(`<defs><radialGradient id="pool"><stop offset="0" stop-color="${LIGHT}" stop-opacity="0.8"/><stop offset="0.75" stop-color="${LIGHT}" stop-opacity="0.55"/><stop offset="1" stop-color="${LIGHT}" stop-opacity="0"/></radialGradient>`);
  out.push(`<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${INK}" stroke-width="1"/></pattern></defs>`);
  out.push(`<rect width="${width}" height="${height}" fill="${PAPER}"/>`);
  // Grid: 1 m faint, 5 m stronger.
  for (let x = minX; x <= maxX; x++) out.push(`<line x1="${X(x)}" y1="${Y(minZ)}" x2="${X(x)}" y2="${Y(maxZ)}" stroke="${INK}" stroke-opacity="${x % 5 === 0 ? 0.14 : 0.05}" stroke-width="1"/>`);
  for (let z = minZ; z <= maxZ; z++) out.push(`<line x1="${X(minX)}" y1="${Y(z)}" x2="${X(maxX)}" y2="${Y(z)}" stroke="${INK}" stroke-opacity="${z % 5 === 0 ? 0.14 : 0.05}" stroke-width="1"/>`);
  // Footprint and walls.
  out.push(`<polygon points="${pts(B.chamber.footprint)}" fill="${STONE}" stroke="${INK}" stroke-width="5" stroke-linejoin="miter"/>`);
  // Overhead lines: arcade wall faces, gallery balcony edge, vault ribs and the oculus.
  const ring = (radius: number) => Array.from({ length: G.sides }, (_, side) => { const b = (side * Math.PI * 2) / G.sides + Math.PI / G.sides; const r = radius / Math.cos(Math.PI / G.sides); return [Math.sin(b) * r, -Math.cos(b) * r]; });
  out.push(`<polygon points="${pts(ring(G.apothem - G.arch.wallInner))}" fill="none" stroke="${INK}" stroke-opacity="0.45" stroke-width="1.2" stroke-dasharray="8 5"/>`);
  out.push(`<polygon points="${pts(ring(G.apothem - G.arch.wallInner - 1.0))}" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="3 4"/>`);
  for (let vertex = 0; vertex < G.sides; vertex++) {
    const b = vertex * (Math.PI * 2) / G.sides + Math.PI / G.sides;
    out.push(`<line x1="${X(Math.sin(b) * (G.pierRadius - G.pier.inner))}" y1="${Y(-Math.cos(b) * (G.pierRadius - G.pier.inner))}" x2="${X(Math.sin(b) * B.chamber.oculus.radius)}" y2="${Y(-Math.cos(b) * B.chamber.oculus.radius)}" stroke="${INK}" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="10 3 2 3"/>`);
  }
  // Light pool on the relief plane, then the oculus above it.
  const key = B.lights.find((light) => light.kind === "key")!;
  out.push(`<circle cx="${X(key.target![0])}" cy="${Y(key.target![2])}" r="${(G.sun.poolRadius * 1.15 * scale).toFixed(1)}" fill="url(#pool)"/>`);
  out.push(`<circle cx="${X(0)}" cy="${Y(0)}" r="${(B.chamber.oculus.radius * scale).toFixed(1)}" fill="none" stroke="${INK}" stroke-opacity="0.55" stroke-width="1.5" stroke-dasharray="6 4"/>`);
  // Piers (exact plan), with the expansion niches hatched.
  const plan = pierPlan();
  for (let vertex = 0; vertex < G.sides; vertex++) {
    const b = vertex * (Math.PI * 2) / G.sides + Math.PI / G.sides;
    const vx = Math.sin(b) * G.pierRadius, vz = -Math.cos(b) * G.pierRadius;
    const yaw = -(b + Math.PI), c = Math.cos(yaw), s = Math.sin(yaw);
    const world = plan.map(([x, z]) => [vx + x * c + z * s, vz - x * s + z * c]);
    out.push(`<polygon points="${pts(world)}" fill="${PIER}" stroke="${INK}" stroke-width="1.5"/>`);
  }
  for (const point of B.expansion) {
    const c = Math.cos(point.yaw), s = Math.sin(point.yaw), hw = point.size[0] / 2, d = point.size[2];
    const corners = [[-hw, 0], [hw, 0], [hw, d], [-hw, d]].map(([x, z]) => [point.position[0] + x * c + z * s, point.position[2] - x * s + z * c]);
    out.push(`<polygon points="${pts(corners)}" fill="url(#hatch)" stroke="${INK}" stroke-width="1.5"/>`);
  }
  // Exhibit architecture: the dais, the dial base, the stelae, and lamps.
  for (const volume of B.occluders) {
    if (volume.kind === "box") {
      const c = Math.cos(volume.yaw), s = Math.sin(volume.yaw), hx = volume.size[0] / 2, hz = volume.size[2] / 2;
      const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => [volume.center[0] + x * c + z * s, volume.center[2] - x * s + z * c]);
      out.push(`<polygon points="${pts(corners)}" fill="${volume.id.startsWith("monument") ? "none" : "#cbb89b"}" stroke="${OCCLUDER}" stroke-width="1.2" stroke-dasharray="${volume.id.startsWith("monument") ? "5 3" : "none"}"/>`);
    } else if (volume.kind === "cylinder") {
      out.push(`<circle cx="${X(volume.center[0])}" cy="${Y(volume.center[2])}" r="${(volume.size[0] / 2 * scale).toFixed(1)}" fill="none" stroke="${OCCLUDER}" stroke-width="1.2"/>`);
    }
  }
  for (const light of B.lights.filter((item) => item.kind === "practical")) {
    const dynamic = light.desktop.medium === "dynamic";
    out.push(`<circle cx="${X(light.position[0])}" cy="${Y(light.position[2])}" r="${light.dormant ? 3 : 4.5}" fill="${light.dormant ? PAPER : LIGHT}" stroke="${light.dormant ? "#888" : BRONZE}" stroke-width="1.5"/>`);
    if (dynamic) out.push(`<circle cx="${X(light.position[0])}" cy="${Y(light.position[2])}" r="9" fill="none" stroke="${LIGHT}" stroke-width="1.5"/>`);
  }
  // The desktop monument: plinth and relief.
  const m = B.monument, w = m.desktop.reliefWidth, d = w * RELIEF_ASPECT, margin2 = m.plinth.margin;
  out.push(`<rect x="${X(-w / 2 - margin2)}" y="${Y(-d / 2 - margin2)}" width="${((w + 2 * margin2) * scale).toFixed(1)}" height="${((d + 2 * margin2) * scale).toFixed(1)}" fill="#b9a587" stroke="${INK}" stroke-width="1.5"/>`);
  out.push(`<rect x="${X(-w / 2)}" y="${Y(-d / 2)}" width="${(w * scale).toFixed(1)}" height="${(d * scale).toFixed(1)}" fill="#8f9b86" stroke="${BRONZE}" stroke-width="2.5"/>`);
  // The Quest monument, station and comfort cone (seated).
  const qw = m.quest.reliefWidth, qd = qw * RELIEF_ASPECT, qc = m.quest.center;
  out.push(`<rect x="${X(qc[0] - qw / 2)}" y="${Y(qc[2] - qd / 2)}" width="${(qw * scale).toFixed(1)}" height="${(qd * scale).toFixed(1)}" fill="none" stroke="${QUEST}" stroke-width="2" stroke-dasharray="4 3"/>`);
  const seated = B.viewpoints.quest[0], eye = questEye(seated), cone = seated.comfortHalfAngle, reach = 17;
  out.push(`<path d="M ${X(eye[0])} ${Y(eye[2])} L ${X(eye[0] + Math.sin(-cone) * reach)} ${Y(eye[2] - Math.cos(-cone) * reach)} A ${reach * scale} ${reach * scale} 0 0 1 ${X(eye[0] + Math.sin(cone) * reach)} ${Y(eye[2] - Math.cos(cone) * reach)} Z" fill="${QUEST}" fill-opacity="0.06" stroke="${QUEST}" stroke-opacity="0.5" stroke-width="1.2" stroke-dasharray="6 4"/>`);
  out.push(`<circle cx="${X(eye[0])}" cy="${Y(eye[2])}" r="5" fill="${QUEST}"/>`);
  const panel = seated.controlSurface, pc = Math.cos(panel.yaw), ps = Math.sin(panel.yaw), half = panel.width / 2;
  out.push(`<line x1="${X(panel.position[0] - half * pc)}" y1="${Y(panel.position[2] + half * ps)}" x2="${X(panel.position[0] + half * pc)}" y2="${Y(panel.position[2] - half * ps)}" stroke="${QUEST}" stroke-width="4"/>`);
  // The rings and their event bands, the rods as dots.
  for (const item of B.mechanism.rings) {
    const line = Array.from({ length: 97 }, (_, index) => { const p = ringPoint(item, (index / 96) * Math.PI * 2); return [p[0], p[2]]; });
    out.push(`<polyline points="${pts(line)}" fill="none" stroke="${BRONZE}" stroke-width="2.2"/>`);
    const [from, to] = item.eventBand;
    const band = Array.from({ length: 33 }, (_, index) => { const p = ringPoint(item, from + ((to - from) * index) / 32); return [p[0], p[2]]; });
    out.push(`<polyline points="${pts(band)}" fill="none" stroke="${BRONZE}" stroke-width="6" stroke-opacity="0.55" stroke-linecap="round"/>`);
    for (const rod of item.suspension) out.push(`<circle cx="${X(rod.anchor[0])}" cy="${Y(rod.anchor[2])}" r="3" fill="${INK}"/>`);
  }
  // Exhibit anchors and pick zones.
  for (const exhibit of B.exhibits) {
    const a = exhibit.collection === "atlas" ? [0, 0, 0] : exhibit.anchor;
    out.push(`<circle cx="${X(exhibit.pick.center[0])}" cy="${Y(exhibit.pick.center[2])}" r="${(exhibit.pick.radius * scale).toFixed(1)}" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 3"/>`);
    out.push(`<path d="M ${X(a[0])} ${Y(a[2]) - 7} l 7 7 l -7 7 l -7 -7 Z" fill="${exhibit.presentation === "dormant" ? PAPER : INK}" stroke="${INK}" stroke-width="1.5"/>`);
  }
  // Desktop viewpoints: horizontal field of view at 16:9 and a line to the target.
  for (const view of B.viewpoints.desktop) {
    const dx = view.target[0] - view.eye[0], dz = view.target[2] - view.eye[2], heading = Math.atan2(dx, -dz);
    const hfov = 2 * Math.atan(Math.tan((view.fov * DEG) / 2) * (16 / 9)), length = view.id.startsWith("nation") ? 1.6 : 3.2;
    const left = heading - hfov / 2, right = heading + hfov / 2;
    out.push(`<path d="M ${X(view.eye[0])} ${Y(view.eye[2])} L ${X(view.eye[0] + Math.sin(left) * length)} ${Y(view.eye[2] - Math.cos(left) * length)} L ${X(view.eye[0] + Math.sin(right) * length)} ${Y(view.eye[2] - Math.cos(right) * length)} Z" fill="${CAMERA}" fill-opacity="0.12" stroke="${CAMERA}" stroke-width="1"/>`);
    out.push(`<line x1="${X(view.eye[0])}" y1="${Y(view.eye[2])}" x2="${X(view.target[0])}" y2="${Y(view.target[2])}" stroke="${CAMERA}" stroke-opacity="0.4" stroke-width="1" stroke-dasharray="2 3"/>`);
    out.push(`<circle cx="${X(view.eye[0])}" cy="${Y(view.eye[2])}" r="3.5" fill="${CAMERA}"/>`);
  }
  // Labels.
  const label = (x: number, z: number, text: string, size = 13, anchor = "middle", weight = "normal", fill = INK) =>
    out.push(`<text x="${X(x)}" y="${Y(z)}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`);
  // Bay labels sit just beyond their back walls, outside the plan.
  const sideLabel = (side: number, text: string) => {
    const b = (side * Math.PI) / 4, reach = G.apothem + B.chamber.sides[side].depth + 1.2;
    const x = Math.sin(b) * reach, z = -Math.cos(b) * reach;
    label(x, z + (Math.cos(b) < -0.5 ? 0.6 : 0), text, 13, Math.abs(x) < 1 ? "middle" : x < 0 ? "end" : "start", "bold");
  };
  sideLabel(0, "Laws of the Gambit (framed)");
  sideLabel(7, "Interregnum (framed)");
  sideLabel(1, "Contested Record (dormant)");
  sideLabel(4, "Entrance vestibule");
  label(0, -2.45, "Living Atlas monument (interactive)", 11, "middle", "bold");
  label(-0.75, 3.35, "Quest table and station", 11, "end", "normal", QUEST);
  label(13.6, -4.6, "War Record niche", 11, "middle");
  label(-13.6, -4.6, "Future collection niche", 11, "middle");
  // Viewpoint labels sit beside each camera, on the side away from the axis.
  for (const view of B.viewpoints.desktop) {
    if (view.id.startsWith("nation")) continue;
    const x = view.eye[0], z = view.eye[2];
    if (Math.abs(x) < 0.6) label(x, z + 0.95, view.id, 10, "middle", "normal", CAMERA);
    else label(x + (x < 0 ? -0.4 : 0.4), z + 0.15, view.id, 10, x < 0 ? "end" : "start", "normal", CAMERA);
  }
  // Title, north arrow, scale bar and legend.
  const lx = Math.round((maxX - minX) * scale + margin * 2) + 10;
  const text = (x: number, y: number, value: string, size = 13, weight = "normal", fill = INK) => out.push(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(value)}</text>`);
  text(lx, 50, "Archive of Ash & Aether", 20, "bold");
  text(lx, 72, "Plan at floor level (y = 0), north up", 13);
  text(lx, 90, "Archive metres, +X east, -Z north", 12);
  const nx = lx + 330, ny = 120;
  out.push(`<path d="M ${nx} ${ny - 30} l 10 28 l -10 -8 l -10 8 Z" fill="${INK}"/><text x="${nx}" y="${ny + 14}" font-size="14" font-weight="bold" text-anchor="middle" fill="${INK}">N</text>`);
  out.push(`<line x1="${lx}" y1="130" x2="${lx + 5 * scale}" y2="130" stroke="${INK}" stroke-width="4"/>`);
  for (let index = 0; index <= 5; index++) out.push(`<line x1="${lx + index * scale}" y1="124" x2="${lx + index * scale}" y2="136" stroke="${INK}" stroke-width="1.5"/>`);
  text(lx, 152, "0      5 m", 12);
  const legend: [string, string][] = [
    [STONE, "floor footprint and walls"], [PIER, "piers (exact plan)"], ["#8f9b86", "desktop relief, 4.80 m wide, on its plinth"], [QUEST, "Quest relief (1.10 m), station and 60° comfort cone"],
    [BRONZE, "rings (plan projection); thick: event bands"], [INK, "suspension rod anchors"], [LIGHT, "light pool on the relief; lamps (ringed: dynamic)"],
    [CAMERA, "desktop viewpoints, 16:9 field of view"], [OCCLUDER, "occluder volumes"], ["#cbb89b", "dais, dial base, stelae"],
  ];
  legend.forEach(([color, name], index) => {
    const y = 190 + index * 26;
    out.push(`<rect x="${lx}" y="${y - 12}" width="18" height="14" fill="${color}" stroke="${INK}" stroke-width="0.8"/>`);
    text(lx + 28, y, name, 12);
  });
  const overlays = ["dashed: arcade wall face overhead", "dotted: gallery balcony edge", "dash-dot: vault ribs to the oculus", "circle: oculus, 6.40 m across", "hatched: empty expansion niches", "diamonds: exhibit anchors (open: dormant)"];
  overlays.forEach((value, index) => text(lx, 190 + legend.length * 26 + 14 + index * 20, value, 12));
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Section drawing (vertical plane x = 0, looking east: north on the left)

function sectionSvg(): string {
  const scale = 30, margin = 70;
  const minZ = -18, maxZ = 18, minY = -2, maxY = 20.5;
  const width = Math.round((maxZ - minZ) * scale + margin * 2 + 160), height = Math.round((maxY - minY) * scale + margin * 2);
  const X = (z: number) => +(margin + (z - minZ) * scale).toFixed(1), Y = (y: number) => +(margin + (maxY - y) * scale).toFixed(1);
  const pts = (points: readonly (readonly number[])[]) => points.map(([z, y]) => `${X(z)},${Y(y)}`).join(" ");
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`);
  out.push(`<rect width="${width}" height="${height}" fill="${PAPER}"/>`);
  for (let y = Math.ceil(minY); y <= maxY; y++) out.push(`<line x1="${X(minZ)}" y1="${Y(y)}" x2="${X(maxZ)}" y2="${Y(y)}" stroke="${INK}" stroke-opacity="${y % 5 === 0 ? 0.14 : 0.05}"/>`);
  const a = G.apothem, wi = G.arch.wallInner, wo = G.arch.wallOuter, L = G.levels;
  const cut = "#cdbfa8";
  // Light shaft: from the oculus rim down to the floor, displaced by the sun.
  const key = B.lights.find((light) => light.kind === "key")!;
  const sun = G.sun.vector, drop = (from: number, y: number) => from - (sun[2] / sun[1]) * (L.crown - y);
  out.push(`<polygon points="${pts([[-B.chamber.oculus.radius, L.crown], [B.chamber.oculus.radius, L.crown], [drop(B.chamber.oculus.radius, 0), 0], [drop(-B.chamber.oculus.radius, 0), 0]])}" fill="${LIGHT}" fill-opacity="0.22"/>`);
  // Beyond the cut, faint: the east arcade's arch and piers, and the piers flanking the north and south openings.
  const faint = `fill="#e9dfcd" stroke="${INK}" stroke-opacity="0.35" stroke-width="1"`;
  const archLine: number[][] = [];
  for (let index = 0; index <= 32; index++) {
    const s = -G.span / 2 + (G.span * index) / 32;
    const c = G.span / 2 - G.arch.radius, h = Math.sqrt(Math.max(0, G.arch.radius ** 2 - (Math.abs(s) - c) ** 2));
    archLine.push([s, L.springing + h]);
  }
  out.push(`<polyline points="${pts([[-G.span / 2, 0], [-G.span / 2, L.springing], ...archLine, [G.span / 2, 0]])}" fill="none" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.2"/>`);
  const pierWide = 1.55;
  for (const zc of [-G.sideLength / 2, G.sideLength / 2]) out.push(`<rect x="${X(zc - pierWide / 2)}" y="${Y(L.vault)}" width="${(pierWide * scale).toFixed(1)}" height="${(L.vault * scale).toFixed(1)}" ${faint}/>`);
  for (const sign of [-1, 1]) {
    const zc = sign * (G.pierRadius - G.pier.inner) * Math.cos(Math.PI / G.sides);
    out.push(`<rect x="${X(zc - 0.5)}" y="${Y(L.vault)}" width="${(1.0 * scale).toFixed(1)}" height="${(L.vault * scale).toFixed(1)}" ${faint}/>`);
    out.push(`<line x1="${X(zc - 0.65)}" y1="${Y(L.impost)}" x2="${X(zc + 0.65)}" y2="${Y(L.impost)}" stroke="${INK}" stroke-opacity="0.4" stroke-width="2"/>`);
  }
  // Floors: chamber, bays, vestibule steps and landing.
  const floor: number[][] = [[-(a + 6.4), 0], [a + G.entrance.start, 0]];
  for (let step = 1; step <= G.entrance.steps; step++) {
    const z = a + G.entrance.start + (step - 1) * G.entrance.run;
    floor.push([z, -(step - 1) * G.entrance.rise], [z, -step * G.entrance.rise]);
  }
  floor.push([a + 6.6, L.landing]);
  out.push(`<polyline points="${pts(floor)}" fill="none" stroke="${INK}" stroke-width="4"/>`);
  out.push(`<line x1="${X(-(a + 6.4))}" y1="${Y(0)}" x2="${X(-(a + 6.4))}" y2="${Y(L.arcadeCrown + 1.2)}" stroke="${INK}" stroke-width="5"/>`);
  out.push(`<line x1="${X(a + 6.6)}" y1="${Y(L.landing)}" x2="${X(a + 6.6)}" y2="${Y(L.arcadeCrown + 0.5)}" stroke="${INK}" stroke-width="5"/>`);
  // Bay vaults in section: their crown lines.
  for (const [start, end] of [[-(a + 6.4), -(a + wo)], [a + wo, a + 6.6]]) out.push(`<line x1="${X(start)}" y1="${Y(L.arcadeCrown)}" x2="${X(end)}" y2="${Y(L.arcadeCrown)}" stroke="${INK}" stroke-width="3"/>`);
  // Arcade walls cut on both sides: spandrel above the crown, string course, gallery and cornice.
  for (const sign of [-1, 1]) {
    const inner = sign * (a - wi), outer = sign * (a + wo);
    out.push(`<polygon points="${pts([[inner, L.arcadeCrown], [outer, L.arcadeCrown], [outer, L.string], [inner, L.string]])}" fill="${cut}" stroke="${INK}" stroke-width="1.5"/>`);
    out.push(`<polygon points="${pts([[inner - sign * 0.25, L.string], [outer, L.string], [outer, L.gallery], [inner - sign * 1.0, L.gallery], [inner - sign * 1.0, L.gallery - 0.25]])}" fill="${cut}" stroke="${INK}" stroke-width="1.5"/>`);
    out.push(`<line x1="${X(inner - sign * 1.0)}" y1="${Y(L.gallery)}" x2="${X(inner - sign * 1.0)}" y2="${Y(L.gallery + 0.95)}" stroke="${INK}" stroke-width="2"/>`);
    out.push(`<polygon points="${pts([[inner, L.gallery + 1.6], [outer, L.gallery + 1.6], [outer, L.cornice], [inner, L.cornice]])}" fill="${cut}" stroke="${INK}" stroke-width="1.5"/>`);
    out.push(`<polygon points="${pts([[inner, L.cornice], [outer + sign * 1.6, L.cornice], [outer + sign * 1.6, L.vault + 0.3], [sign * G.vault.springApothem, L.vault]])}" fill="${cut}" stroke="${INK}" stroke-width="1.5"/>`);
    out.push(`<line x1="${X(outer + sign * 1.6)}" y1="${Y(L.gallery)}" x2="${X(outer + sign * 1.6)}" y2="${Y(L.cornice)}" stroke="${INK}" stroke-width="3"/>`);
  }
  // The vault meridian on the north-south line (it rises along the side centres here).
  const meridian = vaultMeridian(G.vault);
  for (const sign of [-1, 1]) {
    const line = Array.from({ length: 41 }, (_, index) => { const [ap, y] = meridianAt(meridian, index / 40); return [sign * ap, y]; });
    out.push(`<polyline points="${pts(line)}" fill="none" stroke="${INK}" stroke-width="4"/>`);
  }
  // Oculus, tracery and sky.
  out.push(`<line x1="${X(-B.chamber.oculus.radius)}" y1="${Y(L.crown + 0.32)}" x2="${X(B.chamber.oculus.radius)}" y2="${Y(L.crown + 0.32)}" stroke="${INK}" stroke-width="1.5" stroke-dasharray="6 3"/>`);
  out.push(`<line x1="${X(-B.chamber.oculus.radius - 0.4)}" y1="${Y(L.crown + 1.1)}" x2="${X(B.chamber.oculus.radius + 0.4)}" y2="${Y(L.crown + 1.1)}" stroke="${LIGHT}" stroke-width="6"/>`);
  // Rings projected on the section plane, and their rods.
  for (const item of B.mechanism.rings) {
    const line = Array.from({ length: 97 }, (_, index) => { const p = ringPoint(item, (index / 96) * Math.PI * 2); return [p[2], p[1]]; });
    out.push(`<polyline points="${pts(line)}" fill="none" stroke="${BRONZE}" stroke-width="2.5"/>`);
    for (const rod of item.suspension) { const rim = ringPoint(item, rod.angle); out.push(`<line x1="${X(rim[2])}" y1="${Y(rim[1])}" x2="${X(rod.anchor[2])}" y2="${Y(rod.anchor[1])}" stroke="${BRONZE}" stroke-opacity="0.5" stroke-width="1"/>`); }
  }
  // Monuments.
  const m = B.monument, d = m.desktop.reliefWidth * RELIEF_ASPECT, plinthTop = m.desktop.reliefTop - 0.26;
  out.push(`<rect x="${X(-d / 2 - m.plinth.margin - m.plinth.step)}" y="${Y(m.plinth.stepHeight)}" width="${((d + 2 * (m.plinth.margin + m.plinth.step)) * scale).toFixed(1)}" height="${(m.plinth.stepHeight * scale).toFixed(1)}" fill="#8c7b64" stroke="${INK}"/>`);
  out.push(`<rect x="${X(-d / 2 - m.plinth.margin)}" y="${Y(plinthTop)}" width="${((d + 2 * m.plinth.margin) * scale).toFixed(1)}" height="${((plinthTop - m.plinth.stepHeight) * scale).toFixed(1)}" fill="#b9a587" stroke="${INK}"/>`);
  out.push(`<rect x="${X(-d / 2)}" y="${Y(m.desktop.reliefTop)}" width="${(d * scale).toFixed(1)}" height="${((m.desktop.reliefTop - plinthTop) * scale).toFixed(1)}" fill="#8f9b86" stroke="${BRONZE}" stroke-width="2"/>`);
  const qd = m.quest.reliefWidth * RELIEF_ASPECT, qz = m.quest.center[2];
  for (const posture of ["seated", "standing"] as const) {
    const top = m.quest.reliefTop[posture], vantage = B.viewpoints.quest.find((item) => item.posture === posture)!, eye = questEye(vantage);
    out.push(`<rect x="${X(qz - qd / 2)}" y="${Y(top)}" width="${(qd * scale).toFixed(1)}" height="${(top * scale).toFixed(1)}" fill="none" stroke="${QUEST}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    out.push(`<circle cx="${X(eye[2])}" cy="${Y(eye[1])}" r="4.5" fill="${QUEST}"/>`);
    // Sight line to the far rim, and the event band's 10-45 degree window toward the north.
    out.push(`<line x1="${X(eye[2])}" y1="${Y(eye[1])}" x2="${X(qz - qd / 2)}" y2="${Y(top)}" stroke="${QUEST}" stroke-width="1"/>`);
    if (posture === "seated") {
      const reach = 9;
      out.push(`<path d="M ${X(eye[2])} ${Y(eye[1])} L ${X(eye[2] - Math.cos(10 * DEG) * reach)} ${Y(eye[1] + Math.sin(10 * DEG) * reach)} L ${X(eye[2] - Math.cos(45 * DEG) * reach)} ${Y(eye[1] + Math.sin(45 * DEG) * reach)} Z" fill="${QUEST}" fill-opacity="0.08" stroke="${QUEST}" stroke-opacity="0.5" stroke-dasharray="5 4"/>`);
    }
  }
  // The overview camera and its vertical field of view.
  const overview = B.viewpoints.desktop.find((view) => view.id === "overview")!;
  const pitch = Math.atan2(overview.target[1] - overview.eye[1], Math.hypot(overview.target[0] - overview.eye[0], overview.target[2] - overview.eye[2]));
  const half = (overview.fov * DEG) / 2, reach = 14;
  out.push(`<path d="M ${X(overview.eye[2])} ${Y(overview.eye[1])} L ${X(overview.eye[2] - Math.cos(pitch + half) * reach)} ${Y(overview.eye[1] + Math.sin(pitch + half) * reach)} L ${X(overview.eye[2] - Math.cos(pitch - half) * reach)} ${Y(overview.eye[1] + Math.sin(pitch - half) * reach)} Z" fill="${CAMERA}" fill-opacity="0.07" stroke="${CAMERA}" stroke-opacity="0.6" stroke-width="1"/>`);
  out.push(`<circle cx="${X(overview.eye[2])}" cy="${Y(overview.eye[1])}" r="4.5" fill="${CAMERA}"/>`);
  // Levels.
  const levels: [string, number][] = [["landing", L.landing], ["floor", 0], ["impost", L.impost], ["arch springing", L.springing], ["arcade crown", L.arcadeCrown], ["string course", L.string], ["gallery", L.gallery], ["cornice", L.cornice], ["vault springing", L.vault], ["oculus", L.crown]];
  const lx = X(maxZ) + 12;
  // Labels from the top down, each at least 14 px below the one above.
  let previous = -Infinity;
  const placed = levels.map(([name, y]) => ({ name, y, at: Y(y) })).sort((p, q) => p.at - q.at).map((item) => {
    const at = Math.max(item.at + 4, previous + 14);
    previous = at;
    return { ...item, label: at };
  });
  for (const item of placed) {
    out.push(`<line x1="${X(maxZ) - 6}" y1="${item.at}" x2="${lx}" y2="${item.at}" stroke="${INK}" stroke-width="1"/>`);
    out.push(`<line x1="${lx}" y1="${item.at}" x2="${lx + 3}" y2="${item.label - 4}" stroke="${INK}" stroke-width="0.8"/>`);
    out.push(`<text x="${lx + 6}" y="${item.label}" font-size="11" fill="${INK}">${esc(`${item.name} ${f2(item.y)} m`)}</text>`);
  }
  const text = (x: number, y: number, value: string, size = 13, weight = "normal", fill = INK) => out.push(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(value)}</text>`);
  text(margin, 34, "Section on x = 0, looking east (north on the left)", 18, "bold");
  text(margin, 54, `Light shaft ${deg(G.sun.elevation)} above the horizon; rings in projection; Quest eyes at ${f2(B.viewpoints.quest[0].eyeHeight)} and ${f2(B.viewpoints.quest[1].eyeHeight)} m with the 10-45° event-band window`, 12);
  text(X(-(a + 3.2)) - 40, Y(-0.7), "Laws bay", 12, "bold");
  text(X(a + 2.2) - 30, Y(L.landing - 0.7), "Entrance vestibule", 12, "bold");
  text(X(-2.4), Y(-0.7), "monument", 12, "bold");
  text(X(overview.eye[2]) - 20, Y(overview.eye[1]) - 10, "overview", 11, "normal", CAMERA);
  void key;
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// The document

function elementRows(): string[][] {
  return B.elements.map((element: ArchitecturalElement) => {
    const mesh = "builder" in element.mesh ? `\`${element.mesh.builder}\`${Object.keys(element.mesh.params).length ? ` ${Object.entries(element.mesh.params).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}` : `GLB \`${element.mesh.asset}\``;
    const place = element.instances ? `${element.instances.length} instances` : `${v3(element.transform.position)}, yaw ${deg(element.transform.yaw)}`;
    const occluder = element.occluder === undefined ? "-" : typeof element.occluder === "string" ? element.occluder : `${element.occluder.length} (${element.occluder[0]}...)`;
    return [`\`${element.id}\``, mesh, place, element.materialIds.join(", "), occluder, element.zone];
  });
}

const limits = (view: DesktopViewpoint) => `yaw ${f2(view.limits.yaw[0])}..${f2(view.limits.yaw[1])}, pitch ${f2(view.limits.pitch[0])}..${f2(view.limits.pitch[1])}, zoom ${f2(view.limits.zoom[0])}..${f2(view.limits.zoom[1])}`;

function document(hashes: { plan: string; section: string }): string {
  const L = G.levels, m = B.monument;
  const composition = overviewComposition(B), coverage = poolCoverage(B), canon = canonClearance(B);
  const quest = [questCheck(B, "seated"), questCheck(B, "standing")];
  const sweeps = B.viewpoints.desktop.map((view) => sweepFraming(B, view));
  const footprint = B.chamber.footprint;
  const extent = (axis: 0 | 1) => [Math.min(...footprint.map((p) => p[axis])), Math.max(...footprint.map((p) => p[axis]))];
  const [x0, x1] = extent(0), [z0, z1] = extent(1);
  const lines: string[] = [];
  const push = (...items: string[]) => lines.push(...items);
  push(
    "# Archive blueprint",
    "",
    "*Generated from `shared/chronicles/archive/blueprint.ts` by `scripts/chronicles/generate-archive-blueprint.ts`. Do not edit by hand:*",
    "*change the data and run `cd main-game-vr && npx tsx ../scripts/chronicles/generate-archive-blueprint.ts` (add `--check` to compare).*",
    "",
    "The annotated spatial blueprint of the Archive of Ash & Aether (working presentation title) for M1. Both renderers build from",
    "this one description, and `shared/chronicles/archive/blueprint.test.ts` encodes its composition, comfort, occlusion and canon rules.",
    "It states design language only: where the archive is, who made it and why the visitor may enter stay unstated.",
    "",
    "**Units and conventions.** Archive metres. +X is east, +Y is up and -Z is north; the origin is the chamber centre on the main",
    "floor. A `yaw` is a rotation about +Y as three.js applies it: 0 faces north (-Z) and a positive yaw turns toward the west",
    "(counter-clockwise seen from above). A `bearing` is a compass bearing: 0 is north and positive turns toward the east",
    "(bearing = -yaw). Elevations and pitches are above the horizontal. The data holds radians; this document prints degrees.",
    "",
    "## Design rationale",
    "",
    ...B.notes.flatMap((note) => [`**${note.topic}.** ${note.text}`, ""]),
    "## Drawings",
    "",
    "![Plan of the archive at floor level](blueprint/archive-plan.png)",
    "",
    `*Plan: \`blueprint/archive-plan.svg\` (sha256 \`${hashes.plan.slice(0, 16)}\`), rasterised to PNG.*`,
    "",
    "![Section of the archive on x = 0](blueprint/archive-section.png)",
    "",
    `*Section: \`blueprint/archive-section.svg\` (sha256 \`${hashes.section.slice(0, 16)}\`), rasterised to PNG.*`,
    "",
    "## Chamber",
    "",
    table(["Quantity", "Value"], [
      ["Plan", `regular octagon, ${G.sides} piers on a ${f2(G.pierRadius)} m circle`],
      ["Arcade plane apothem / across", `${f2(G.apothem)} m / ${f2(G.apothem * 2)} m between opposite arcade planes`],
      ["Inner wall face across", `${f2((G.apothem - G.arch.wallInner) * 2)} m`],
      ["Side length / clear arch span", `${f2(G.sideLength)} m / ${f2(G.span)} m`],
      ["Pier plan", `kite ${f2(G.pier.width)} m wide at the arcade plane, ${f2(G.pier.inner + G.pier.outer)} m deep (${f2(G.pier.inner)} m inside the corner)`],
      ["Arcade arch", `stilted two-centred pointed, radius ${f2(G.arch.radius)} m (${G.arch.radiusFactor} x span), rise ${f2(G.arch.rise)} m, ${G.arch.voussoirs} voussoirs ${f2(G.arch.voussoirDepth)} m deep, wall ${f2(G.arch.wallInner + G.arch.wallOuter)} m thick`],
      ["Vault", `octagon-to-circle shell on a circular meridian: springs at ${f2(L.vault)} m (apothem ${f2(G.vault.springApothem)} m, tangent ${deg(G.vault.springAngle)}), ribs at the eight corners`],
      ["Oculus", `${f2(B.chamber.oculus.radius * 2)} m open disc at ${f2(B.chamber.crownY)} m; pierced screen with an open centre (${B.chamber.oculus.tracery.open} of the radius), ${B.chamber.oculus.tracery.bars} bars and a dappled outer band`],
      ["Footprint extent", `x ${f2(x0)}..${f2(x1)} m, z ${f2(z0)}..${f2(z1)} m (${footprint.length} corners)`],
    ]),
    "",
    table(["Level", "Height (m)"], B.chamber.levels.map((level) => [level.id, f2(level.y)])),
    "",
    table(["Side", "Bearing", "Opens to", "Depth (m)", "Width (m)", "Zone"], B.chamber.sides.map((side) => [side.side, deg(side.bearing), side.kind, f2(side.depth), f2(side.width), side.zone])),
    "",
    "## Architectural elements",
    "",
    "Every element is a kernel builder with parameters (or a Blender GLB under `assets/chronicles` that replaces it with no code change),",
    "placed once or as instances, with materials by slot and an occluder volume where it can hide an exhibit.",
    "",
    table(["Element", "Mesh", "Placement", "Materials", "Occluder", "Zone"], elementRows()),
    "",
    "## Monument",
    "",
    table(["", "Desktop", "Quest"], [
      ["Relief width x depth", `${f2(m.desktop.reliefWidth)} x ${f2(m.desktop.reliefWidth * RELIEF_ASPECT)} m`, `${f2(m.quest.reliefWidth)} x ${f2(m.quest.reliefWidth * RELIEF_ASPECT)} m`],
      ["Relief top (rim plane)", `${f2(m.desktop.reliefTop)} m`, `seated ${f2(m.quest.reliefTop.seated)} m, standing ${f2(m.quest.reliefTop.standing)} m`],
      ["Centre", v3(m.center), v3(m.quest.center)],
      ["Plinth", `\`${m.plinth.builder}\`, margin ${f2(m.plinth.margin)} m, step ${f2(m.plinth.step)} m x ${f2(m.plinth.stepHeight)} m`, "same builder, scaled to the relief"],
      ["Bronze frame", `band ${f2(m.frame.band)} m, rise ${f2(m.frame.rise)} m`, "baked, unlit"],
      ["Painting", "the creator's map, unmodified, as the relief albedo", "same file, mirrored"],
    ]),
    "",
    "## Mechanism",
    "",
    "Three still rings, concentric on the vertical axis, each with one pivot (the axis normal to its plane) and held at its rim by",
    "bronze rods hung from the vault. No hub, rod or anything else stands over the map centre. The event bands carry the Annals from M3.",
    "",
    table(["Ring", "Radius", "Centre", "Tilt (x, y, z)", "Section", "Event band", "Rods (rim angle -> vault anchor)"], B.mechanism.rings.map((item) => [
      `\`${item.id}\``, `${f2(item.radius)} m`, v3(item.center), item.tilt.map(deg).join(", "), `${f2(item.section.width)} x ${f2(item.section.thickness)} m`,
      `${deg(item.eventBand[0])} to ${deg(item.eventBand[1])}`, item.suspension.map((rod) => `${deg(rod.angle)} -> ${f2(rod.anchor[1])} m`).join("; "),
    ])),
    "",
    "## Exhibits (all four collections)",
    "",
    table(["Exhibit", "Collection", "M1", "Anchor", "Yaw", "Artifacts", "Quest station (bearing, distance, height, scale)", "Pick"], B.exhibits.map((exhibit) => [
      `\`${exhibit.id}\``, exhibit.collection, exhibit.presentation, v3(exhibit.anchor), deg(exhibit.yaw), exhibit.artifactIds.join(", "),
      `${deg(exhibit.station.bearing)}, ${f2(exhibit.station.distance)} m, ${f2(exhibit.station.height)} m, ${exhibit.station.scale}`, `${v3(exhibit.pick.center)} r ${f2(exhibit.pick.radius)} m`,
    ])),
    "",
    table(["Artifact", "Kind", "Mesh", "Placement", "Materials", "Presents"], B.artifacts.map((artifact) => [
      `\`${artifact.id}\``, artifact.kind, "builder" in artifact.mesh ? `\`${artifact.mesh.builder}\`` : `GLB \`${artifact.mesh.asset}\``,
      artifact.placement ? `${v3(artifact.placement.position)}, yaw ${deg(artifact.placement.yaw)}` : artifact.kind === "ring" ? "from the mechanism" : "the monument",
      artifact.materialIds.join(", "), artifact.entryIds.length ? artifact.entryIds.join(", ") : "-",
    ])),
    "",
    "## Desktop viewpoints and camera framings",
    "",
    "Restrained orbit and zoom about each authored framing; the renderer clamps to these limits (offsets in radians, zoom as distance factors).",
    "`review:contested` is for captures only: the dormant bay is absent from navigation.",
    "",
    table(["Viewpoint", "Eye", "Target", "FOV", "Limits"], B.viewpoints.desktop.map((view) => [`\`${view.id}\``, v3(view.eye), v3(view.target), `${view.fov}°`, limits(view)])),
    "",
    "### Navigation paths",
    "",
    "Flights take at most 1.2 s and the entrance settle at most 1.5 s; reduced motion cuts them. Quest has no camera paths: the viewer is never moved.",
    "",
    table(["From", "To", "Via", "Seconds"], B.paths.map((path) => [path.from, path.to, path.via.map(v3).join(" "), f2(path.seconds)])),
    "",
    "## Quest vantages",
    "",
    "One stationary station at the Quest monument's south edge, facing north. The floor is XR local-floor y = 0 (IWSDK's default",
    "reference space); the runtime places the room from the real head pose on entry and on recenter, under a fade.",
    "",
    table(["", "Seated", "Standing"], [
      ["Station (floor)", v3(B.viewpoints.quest[0].floor), v3(B.viewpoints.quest[1].floor)],
      ["Nominal eye height", `${f2(B.viewpoints.quest[0].eyeHeight)} m`, `${f2(B.viewpoints.quest[1].eyeHeight)} m`],
      ["Forward / comfort half-angle", `${deg(B.viewpoints.quest[0].forwardYaw)} / ${deg(B.viewpoints.quest[0].comfortHalfAngle)}`, `${deg(B.viewpoints.quest[1].forwardYaw)} / ${deg(B.viewpoints.quest[1].comfortHalfAngle)}`],
      ["Control surface (centre, yaw, pitch, width)", ...B.viewpoints.quest.map((vantage) => `${v3(vantage.controlSurface.position)}, ${deg(vantage.controlSurface.yaw)}, ${deg(vantage.controlSurface.pitch)}, ${f2(vantage.controlSurface.width)} m`)],
      ["Relief far edge below the eye (min 22° / 28°)", `${f1(quest[0].farEdge)}°`, `${f1(quest[1].farEdge)}°`],
      ["Relief near edge ahead (min 0.30 m)", `${f2(quest[0].nearEdge)} m`, `${f2(quest[1].nearEdge)} m`],
      ["Relief top (0.65-0.90 m)", `${f2(quest[0].reliefTop)} m`, `${f2(quest[1].reliefTop)} m`],
      ["Exhibits off forward (max 60°)", ...quest.map((check) => Object.entries(check.exhibits).map(([id, off]) => `${id} ${f1(off)}°`).join(", "))],
      ["Event band above the eye line (10-45°)", ...quest.map((check) => `${f1(check.eventBand.minElevation)}-${f1(check.eventBand.maxElevation)}°, at most ${f1(check.eventBand.maxOff)}° off forward`)],
      ["Control surface clear of the monument (pitch 0° / -20°)", ...quest.map((check) => `${f1(check.controlGap.upright)}° / ${f1(check.controlGap.tilted)}°`)],
      ["Markers (min 4 cm and 6% of the relief width)", `${f2(quest[0].markerSize * 100)} cm`, `${f2(quest[1].markerSize * 100)} cm`],
      ["16-unit body text at the control surface", `${f2(quest[0].bodyText)}°`, `${f2(quest[1].bodyText)}°`],
    ]),
    "",
    `The control surface pose leaves the monument and the event band clear. At this width the current 16-unit body class subtends about ${f2(quest[0].bodyText)}°; the Quest`,
    `integration's 1.0° target needs about ${Math.ceil(16 / quest[0].bodyText)} units at this pose, or a wider panel.`,
    "",
    "## Lights",
    "",
    table(["Light", "Kind", "Position", "Target", "Colour", "Intensity", "Range / cone", "Shadow", "Desktop low / medium / high", "Quest"], B.lights.map((light) => [
      `\`${light.id}\``, light.kind, v3(light.position), light.target ? v3(light.target) : "-", light.groundColor ? `${light.color} over ${light.groundColor}` : light.color, f2(light.intensity),
      light.cone ? `cone ${f2(light.cone.angle / DEG)}°, penumbra ${f2(light.cone.penumbra)}` : light.range ? `${f2(light.range)} m` : "-",
      light.castsShadow ? `yes${light.cookie ? `, cookie \`${light.cookie}\`` : ""}` : "no", `${light.desktop.low} / ${light.desktop.medium} / ${light.desktop.high}`, light.dormant ? "omitted (dormant)" : light.quest,
    ])),
    "",
    `The key stands ${f2(G.sun.elevation / DEG)}° above the horizon, leaning a few degrees to the north of straight overhead, and falls through the open oculus. Its fully lit cone covers`,
    `${f1(coverage.desktop * 100)}% of the desktop relief and ${f1(coverage.quest * 100)}% of the Quest relief; the oculus screen dapples the pool's outer band.`,
    "",
    "## Atmosphere",
    "",
    table(["Volume", "Kind", "Centre", "Size", "Density", "Axis", "Colour"], B.atmosphere.map((volume) => [`\`${volume.id}\``, volume.kind, v3(volume.center), v3(volume.size), f2(volume.density), volume.axis ? v3(volume.axis) : "-", volume.color])),
    "",
    "## Interaction zones",
    "",
    table(["Zone", "Kind", "Centre", "Radius"], B.zones.map((zone) => [`\`${zone.id}\``, zone.kind, v3(zone.center), `${f2(zone.radius)} m`])),
    "",
    "## Expansion points",
    "",
    table(["Point", "Reserved for", "Position", "Yaw", "Size"], B.expansion.map((point) => [`\`${point.id}\``, point.reservedFor, v3(point.position), deg(point.yaw), v3(point.size)])),
    "",
    "Both niches stay visibly empty until real content exists, and both lie inside the Quest comfort cone.",
    "",
    "## Occluders and occlusion analysis",
    "",
    table(["Occluder", "Kind", "Centre", "Size", "Yaw"], B.occluders.map((volume) => [`\`${volume.id}\``, volume.kind, v3(volume.center), v3(volume.size), deg(volume.yaw)])),
    "",
    "Each desktop framing's orbit, tilt and zoom range is sampled on a 5 x 5 x 3 grid. A sphere of radius 0.25 m is swept from the framing",
    "target and from the exhibit's centre to every sampled eye, against every occluder except the exhibit's own volumes.",
    "",
    table(["Framing", "Subject", "Samples", "Occluders hit", "Nearest solid to a sampled eye"], sweeps.map((sweep) => [`\`${sweep.viewId}\``, sweep.subject, sweep.samples, sweep.hits.length ? sweep.hits.join(", ") : "none", `${f2(sweep.minClearance)} m`])),
    "",
    sweeps.every((sweep) => !sweep.hits.length)
      ? "Every framing is clear, so the occlusion reveal (D8) is not in M1 scope. Rings and rods are thin and never hide more than a thin arc; they are not occluder volumes."
      : "Some framings can be hidden by architecture: those occluders are listed on their exhibits, which puts the occlusion reveal (D8) in scope.",
    "",
    "## Composition and canon checks",
    "",
    table(["Check", "Result"], [
      ["Overview at 16:9 holds the whole monument", composition.monumentInside ? "yes" : "no"],
      ["Share of the ring band in the overview (min 60%)", `${f1(composition.ringShare * 100)}%`],
      [`Light shaft in the overview, from the relief up to the ring band (${f2(composition.ringTop)} m)`, composition.shaftInside ? "yes" : "no"],
      ["Nearest element to the desktop map centre's vertical (min 0.40 m)", `${f2(canon.desktop)} m`],
      ["Nearest element to the Quest map centre's vertical (min 0.40 m)", `${f2(canon.quest)} m`],
      ["Above the crown", "only the oculus screen (open centre) and the sky disc"],
      ["Ornament", "abstract and astronomical; no text, names, emblems, heraldry or narrative scenes"],
    ]),
    "",
    "## Budgets",
    "",
    table(["Quality", "Draw calls", "Triangles", "Texture memory"], (Object.keys(B.budgets) as (keyof typeof B.budgets)[]).map((quality) => [quality, B.budgets[quality].drawCalls, B.budgets[quality].triangles.toLocaleString("en-US"), `${B.budgets[quality].textureMB} MB`])),
    "",
    "Quest and desktop medium carry the directive's limits; low and high follow the My Legacy performance standard. Measured counts are",
    "reported by the renderers and recorded with the M1 evidence.",
    "",
    "The kernel's own share, computed from this data (the architecture, mechanism and exhibits, before the relief and the plinth), and the",
    "texture estimate of the generated materials (4 bytes per texel, mipmaps counted, the map included):",
    "",
    table(["Quality", "Kernel triangles", "Kernel budget", "Static batches", "Instanced", "Texture estimate"], (["quest", "low", "medium", "high"] as const).map((quality) => {
      const build = buildArchive(B, G as unknown as FormGeometry, quality);
      const memory = quality === "quest" ? textureMemory("quest", "medium") : textureMemory("desktop", quality);
      return [
        quality,
        build.triangles.toLocaleString("en-US"),
        ARCHIVE_GEOMETRY_BUDGET[quality].toLocaleString("en-US"),
        build.batches.length,
        build.instanced.length ? build.instanced.map((item) => `${item.id} x ${item.count}`).join(", ") : "-",
        `${(memory.bytes / 1048576).toFixed(1)} MB (${memory.files.length} files)`,
      ];
    })),
    "",
    "## Framing subjects",
    "",
    table(["Viewpoint", "Keeps visible"], B.viewpoints.desktop.map((view) => [`\`${view.id}\``, framingSubject(B, view.id).id])),
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

async function rasterise(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 96 }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

async function pixels(png: Buffer): Promise<Buffer> {
  return sharp(png).ensureAlpha().raw().toBuffer();
}

async function main() {
  const check = process.argv.includes("--check");
  const plan = planSvg(), section = sectionSvg();
  const doc = document({ plan: sha(plan), section: sha(section) });
  const planPng = await rasterise(plan), sectionPng = await rasterise(section);
  const outputs: [string, string | Buffer][] = [[OUT.doc, doc], [OUT.planSvg, plan], [OUT.sectionSvg, section], [OUT.planPng, planPng], [OUT.sectionPng, sectionPng]];
  if (check) {
    const stale: string[] = [];
    for (const [path, content] of outputs) {
      const name = relative(root, path);
      if (!existsSync(path)) { stale.push(`${name} is missing`); continue; }
      if (typeof content === "string") {
        if (readFileSync(path, "utf8") !== content) stale.push(`${name} differs from a fresh generation`);
      } else if (!(await pixels(readFileSync(path))).equals(await pixels(content))) stale.push(`${name} differs from a fresh rasterisation`);
    }
    if (stale.length) {
      console.error(`FAIL archive blueprint outputs are stale:\n  ${stale.join("\n  ")}\nRun: cd main-game-vr && npx tsx ../scripts/chronicles/generate-archive-blueprint.ts`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS archive blueprint: ${outputs.length} outputs match the data (${relative(root, OUT.doc)})`);
    return;
  }
  mkdirSync(dirname(OUT.planSvg), { recursive: true });
  for (const [path, content] of outputs) writeFileSync(path, content);
  console.log(`Wrote ${outputs.map(([path]) => relative(root, path)).join(", ")}`);
}

await main();
