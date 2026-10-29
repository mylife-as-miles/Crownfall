// heraldryShapes: Heraldry → layered vector shapes in unit space for three
// aspects. Width is always 1; height depends on the aspect. Layers are listed
// in paint order and clipped to the aspect's bounding box; mask them with
// `outline` (the raster and SVG emitters already do).

import { TINCTURE_SRGB } from "../environment-contract";
import { chargeLiesOnOrdinary, chargeNeedsFimbriation, tinctureClass } from "../content/heraldry";
import type { HeraldicCharge, HeraldicDivision, HeraldicOrdinary, Heraldry, Tincture } from "../types";
import { chargeRings } from "./charges";
import { clipRingToBox, cubicTo, hole, insetRing, outer, rectPoints, rotateRing, transformRing } from "./geometry";
import type { Ring } from "./geometry";

export type HeraldryAspect = "banner" | "shield" | "pennant";

export interface HeraldryShapeOptions {
  /** Banner only: cut a swallowtail into the fly. */
  swallowtail?: boolean;
}

export type HeraldryLayerRole = "field" | "division" | "ordinary" | "charge" | "border";

export interface HeraldryLayer {
  role: HeraldryLayerRole;
  /** The tincture painted, or null for the neutral cloth border. */
  tincture: Tincture | null;
  /** sRGB hex colour (from TINCTURE_SRGB for tinctures). */
  color: string;
  opacity: number;
  /** Oriented rings; fill with the nonzero rule. */
  rings: Ring[];
}

export interface HeraldryShapes {
  aspect: HeraldryAspect;
  width: 1;
  height: number;
  /** The silhouette (banner cloth, shield or pennant) that masks every layer. */
  outline: Ring[];
  layers: HeraldryLayer[];
  /**
   * Fimbriation (a thin outline) for a charge that breaks the rule of tincture:
   * argent around a colour, sable around a metal. Null when the charge reads on its own.
   * `width` is the full stroke width in unit space, centred on the charge edge.
   */
  fimbriation: { color: string; width: number } | null;
}

interface AspectLayout {
  height: number;
  cx: number;
  cy: number;
  chargeSize: number;
  band: number;
  /** Band width when the ordinary carries the charge. */
  chargedBand: number;
  chief: number;
  bordure: number;
  border: number;
  chevronApex: number;
  chevronChargeY: number;
  chevronChargeSize: number;
}

const LAYOUTS: Readonly<Record<HeraldryAspect, AspectLayout>> = {
  banner: { height: 1.5, cx: 0.5, cy: 0.68, chargeSize: 0.64, band: 0.26, chargedBand: 0.38, chief: 0.36, bordure: 0.11, border: 0.022, chevronApex: 0.8, chevronChargeY: 0.4, chevronChargeSize: 0.5 },
  shield: { height: 1.2, cx: 0.5, cy: 0.5, chargeSize: 0.58, band: 0.27, chargedBand: 0.36, chief: 0.33, bordure: 0.1, border: 0.026, chevronApex: 0.62, chevronChargeY: 0.31, chevronChargeSize: 0.42 },
  pennant: { height: 0.5, cx: 0.32, cy: 0.25, chargeSize: 0.3, band: 0.12, chargedBand: 0.2, chief: 0.15, bordure: 0.05, border: 0.012, chevronApex: 0.29, chevronChargeY: 0.12, chevronChargeSize: 0.14 },
};

export const HERALDRY_ASPECT_HEIGHT: Readonly<Record<HeraldryAspect, number>> = {
  banner: LAYOUTS.banner.height,
  shield: LAYOUTS.shield.height,
  pennant: LAYOUTS.pennant.height,
};

/** Pixel height that keeps a raster of `width` pixels at the aspect's natural proportions. */
export function heraldryPixelHeight(aspect: HeraldryAspect, width: number): number {
  return Math.max(1, Math.round(width * HERALDRY_ASPECT_HEIGHT[aspect]));
}

function outlineFor(aspect: HeraldryAspect, swallowtail: boolean): Ring {
  if (aspect === "banner") {
    const h = LAYOUTS.banner.height;
    return swallowtail ? outer([0, 0, 1, 0, 1, h, 0.5, h - 0.24, 0, h]) : outer(rectPoints(0, 0, 1, h));
  }
  if (aspect === "pennant") return outer([0, 0, 1, 0.2, 1, 0.3, 0, 0.5]);
  const points: number[] = [0, 0, 1, 0, 1, 0.55];
  cubicTo(points, 1, 0.9, 0.78, 1.08, 0.5, 1.2, 20);
  cubicTo(points, 0.22, 1.08, 0, 0.9, 0, 0.55, 20);
  return outer(points);
}

const L = 4;

function halfPlaneBelowLine(cx: number, cy: number, dx: number, dy: number): number[] {
  // Region to the right of direction (dx, dy) through (cx, cy) in y-down space.
  const nx = -dy;
  const ny = dx;
  return [cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L, cx + dx * L + nx * L, cy + dy * L + ny * L, cx - dx * L + nx * L, cy - dy * L + ny * L];
}

function bandAlong(cx: number, cy: number, dx: number, dy: number, width: number): number[] {
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const nx = (-uy * width) / 2;
  const ny = (ux * width) / 2;
  return [cx - ux * L + nx, cy - uy * L + ny, cx + ux * L + nx, cy + uy * L + ny, cx + ux * L - nx, cy + uy * L - ny, cx - ux * L - nx, cy - uy * L - ny];
}

function divisionRings(division: HeraldicDivision, layout: AspectLayout): number[][] {
  const { cx, cy, height } = layout;
  switch (division) {
    case "plain": return [];
    case "per-pale": return [rectPoints(cx, -1, 2, height + 1)];
    case "per-fess": return [rectPoints(-1, cy, 2, height + 1)];
    case "per-bend": return [halfPlaneBelowLine(cx, cy, 1, 1)];
    case "per-chevron": {
      const apex = layout.chevronApex - layout.band / 2;
      return [[cx, apex, cx + L, apex + L, cx + L, height + L, cx - L, height + L, cx - L, apex + L]];
    }
    case "quarterly": return [rectPoints(cx, -1, 2, cy), rectPoints(-1, cy, cx, height + 1)];
    case "per-saltire": return [[cx, cy, cx - L, cy - L, cx - L, cy + L], [cx, cy, cx + L, cy + L, cx + L, cy - L]];
  }
}

function ordinaryRings(ordinary: HeraldicOrdinary, layout: AspectLayout, outline: Ring, band: number): Ring[] {
  const { cx, cy, height } = layout;
  switch (ordinary) {
    case "none": return [];
    case "chief": return [outer(rectPoints(-1, -1, 2, layout.chief))];
    case "fess": return [outer(rectPoints(-1, cy - band / 2, 2, cy + band / 2))];
    case "pale": return [outer(rectPoints(cx - band / 2, -1, cx + band / 2, height + 1))];
    case "bend": return [outer(bandAlong(cx, cy, 1, 1, band))];
    case "chevron": {
      const apex = layout.chevronApex - band / 2;
      const thick = band * Math.SQRT2;
      return [outer([cx, apex, cx + L, apex + L, cx + L, apex + L + thick, cx, apex + thick, cx - L, apex + L + thick, cx - L, apex + L])];
    }
    case "cross": return [outer(rectPoints(cx - band / 2, -1, cx + band / 2, height + 1)), outer(rectPoints(-1, cy - band / 2, 2, cy + band / 2))];
    case "saltire": return [outer(bandAlong(cx, cy, 1, 1, band)), outer(bandAlong(cx, cy, 1, -1, band))];
    case "bordure": return [outer(Array.from(outline)), hole(Array.from(insetRing(outline, layout.bordure)))];
  }
}

/** Elongated charges that follow a bend's diagonal instead of standing upright on it. */
const BENDWISE_CHARGES: readonly HeraldicCharge[] = ["sword", "key"];

/** Band width of an ordinary that carries the charge. */
function chargedBandFor(ordinary: HeraldicOrdinary, layout: AspectLayout): number {
  return ordinary === "cross" || ordinary === "saltire" ? layout.chargedBand * 0.84 : layout.chargedBand;
}

function chargePlacement(heraldry: Heraldry, layout: AspectLayout): { x: number; y: number; size: number; angle: number } {
  const { cx, cy, chargeSize } = layout;
  if (chargeLiesOnOrdinary(heraldry.ordinary)) {
    // Long charges on a bend lie bendwise along it; others stay upright and shrink to the band.
    // The crossing of a cross or saltire gives a little more room.
    const band = chargedBandFor(heraldry.ordinary, layout);
    if (heraldry.ordinary === "bend") {
      const bendwise = BENDWISE_CHARGES.indexOf(heraldry.charge) !== -1;
      return { x: cx, y: cy, size: band * (bendwise ? 0.94 : 0.84), angle: bendwise ? Math.PI / 4 : 0 };
    }
    const crossing = heraldry.ordinary === "cross" || heraldry.ordinary === "saltire";
    return { x: cx, y: cy, size: band * (crossing ? 1.12 : 0.94), angle: 0 };
  }
  switch (heraldry.ordinary) {
    case "chief": {
      const size = chargeSize * 0.88;
      return { x: cx, y: Math.max(cy, layout.chief + size / 2 + 0.03), size, angle: 0 };
    }
    case "bordure": return { x: cx, y: cy, size: chargeSize * 0.82, angle: 0 };
    case "chevron": return { x: cx, y: layout.chevronChargeY, size: layout.chevronChargeSize, angle: 0 };
    default: return { x: cx, y: cy, size: chargeSize, angle: 0 };
  }
}

function clipAll(rings: readonly Ring[], height: number): Ring[] {
  const out: Ring[] = [];
  for (const ring of rings) {
    const clipped = clipRingToBox(ring, 0, 0, 1, height);
    if (clipped) out.push(clipped);
  }
  return out;
}

function layer(role: HeraldryLayerRole, tincture: Tincture, rings: Ring[]): HeraldryLayer {
  return { role, tincture, color: TINCTURE_SRGB[tincture], opacity: 1, rings };
}

/** Neutral shade for the cloth border, applied at low opacity over whatever lies beneath. */
export const HERALDRY_BORDER_COLOR = "#0d0b0a";
export const HERALDRY_BORDER_OPACITY = 0.24;
/** Full fimbriation stroke width in unit space (the raster keeps at least ~1.6 px). */
export const HERALDRY_FIMBRIATION_WIDTH = 0.014;

/** Vector shapes for heraldry on a banner, shield or pennant. Deterministic and allocation-only (no caching of results). */
export function heraldryShapes(heraldry: Heraldry, aspect: HeraldryAspect, options: HeraldryShapeOptions = {}): HeraldryShapes {
  const layout = LAYOUTS[aspect];
  const height = layout.height;
  const outline = outlineFor(aspect, aspect === "banner" && options.swallowtail === true);
  const layers: HeraldryLayer[] = [layer("field", heraldry.field[0], [outer(rectPoints(0, 0, 1, height))])];
  if (heraldry.division !== "plain" && heraldry.field[1] !== heraldry.field[0]) {
    const rings = clipAll(divisionRings(heraldry.division, layout).map((points) => outer(points)), height);
    if (rings.length > 0) layers.push(layer("division", heraldry.field[1], rings));
  }
  if (heraldry.ordinary !== "none") {
    const band = heraldry.charge !== "none" && chargeLiesOnOrdinary(heraldry.ordinary) ? chargedBandFor(heraldry.ordinary, layout) : layout.band;
    const rings = clipAll(ordinaryRings(heraldry.ordinary, layout, outline, band), height);
    if (rings.length > 0) layers.push(layer("ordinary", heraldry.ordinaryTincture, rings));
  }
  if (heraldry.charge !== "none") {
    const place = chargePlacement(heraldry, layout);
    const scale = place.size / 2;
    const rings = clipAll(chargeRings(heraldry.charge).map((ring) =>
      place.angle === 0 ? transformRing(ring, scale, place.x, place.y) : rotateRing(ring, scale, place.angle, place.x, place.y)), height);
    if (rings.length > 0) layers.push(layer("charge", heraldry.chargeTincture, rings));
  }
  layers.push({
    role: "border",
    tincture: null,
    color: HERALDRY_BORDER_COLOR,
    opacity: HERALDRY_BORDER_OPACITY,
    rings: [outer(Array.from(outline)), hole(Array.from(insetRing(outline, layout.border)))],
  });
  const fimbriation = chargeNeedsFimbriation(heraldry)
    ? { color: tinctureClass(heraldry.chargeTincture) === "metal" ? TINCTURE_SRGB.sable : TINCTURE_SRGB.argent, width: HERALDRY_FIMBRIATION_WIDTH }
    : null;
  return { aspect, width: 1, height, outline: [outline], layers, fimbriation };
}
