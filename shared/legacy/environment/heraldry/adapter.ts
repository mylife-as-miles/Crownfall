// Heraldry raster adapter. The gameplay workflow owns shared/legacy/heraldry (exact
// rasteriser and shapes); until that module is synced into this branch the
// environment draws standards and shields from TINCTURE_SRGB field colours with this
// simplified fallback. Swap `defaultHeraldryRaster` for the gameplay rasteriser when it
// arrives: the interface matches rasterizeHeraldry(heraldry, { width, height, aspect }).
// Output: straight-alpha sRGB RGBA, row 0 at the top; transparent pixels carry the field colour.

import { TINCTURE_SRGB } from "../../environment-contract";
import type { Heraldry, Tincture } from "../../types";
import { atlasTile, HERALDRY_ATLAS_SIZE } from "./atlas";
import type { HeraldryAspectKind, HeraldrySlot } from "./atlas";

export interface HeraldryRasterRequest {
  width: number;
  height: number;
  aspect: HeraldryAspectKind;
}

export interface HeraldryRasterResult {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface HeraldryRasterSource {
  readonly id: string;
  rasterize(heraldry: Heraldry, request: HeraldryRasterRequest): HeraldryRasterResult;
}

function rgb(t: Tincture): [number, number, number] {
  const n = parseInt(TINCTURE_SRGB[t].slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Coverage of the silhouette at normalised (u, v) (v = 0 at the top). */
function silhouette(aspect: HeraldryAspectKind, u: number, v: number): number {
  if (aspect === "shield") {
    // Heater shield: straight top two thirds, curving to a point.
    if (v < 0.55) return u >= 0.02 && u <= 0.98 ? 1 : 0;
    const t = (v - 0.55) / 0.45;
    const half = 0.48 * Math.sqrt(Math.max(0, 1 - t * t * 0.96));
    return Math.abs(u - 0.5) <= half ? 1 : 0;
  }
  if (aspect === "pennant") {
    // Tapering pennant toward the fly.
    const half = 0.5 * (1 - u * 0.86);
    return Math.abs(v - 0.5) <= half ? 1 : 0;
  }
  // Banner with a shallow swallowtail at the bottom.
  if (v > 0.9) {
    const notch = (v - 0.9) / 0.1;
    return Math.abs(u - 0.5) > notch * 0.28 ? 1 : 0;
  }
  return 1;
}

function inDivision(h: Heraldry, u: number, v: number): boolean {
  switch (h.division) {
    case "per-pale": return u > 0.5;
    case "per-fess": return v > 0.5;
    case "per-bend": return u < v;
    case "per-chevron": return v > 0.62 - Math.abs(u - 0.5) * 0.9;
    case "quarterly": return (u > 0.5) !== (v > 0.5);
    case "per-saltire": return Math.abs(u - 0.5) > Math.abs(v - 0.5);
    default: return false;
  }
}

function inOrdinary(h: Heraldry, u: number, v: number): boolean {
  const band = 0.13;
  switch (h.ordinary) {
    case "chief": return v < 0.26;
    case "fess": return Math.abs(v - 0.5) < band;
    case "pale": return Math.abs(u - 0.5) < band;
    case "bend": return Math.abs(u - v) < band * 1.2;
    case "chevron": {
      const y = 0.75 - Math.abs(u - 0.5) * 1.1;
      return Math.abs(v - y) < band;
    }
    case "cross": return Math.abs(u - 0.5) < band * 0.8 || Math.abs(v - 0.45) < band * 0.8;
    case "saltire": return Math.abs(u - v) < band || Math.abs(u - (1 - v)) < band;
    case "bordure": return u < 0.09 || u > 0.91 || v < 0.07 || v > 0.93;
    default: return false;
  }
}

function inCharge(h: Heraldry, u: number, v: number, aspect: HeraldryAspectKind): boolean {
  if (h.charge === "none") return false;
  const cy = aspect === "banner" ? 0.55 : aspect === "pennant" ? 0.5 : 0.45;
  const cx = aspect === "pennant" ? 0.3 : 0.5;
  const s = aspect === "pennant" ? 0.16 : 0.2;
  const dx = (u - cx) / s;
  const dy = (v - cy) / s * (aspect === "banner" ? 1.5 : aspect === "shield" ? 1.2 : 0.5);
  const r = Math.sqrt(dx * dx + dy * dy);
  switch (h.charge) {
    case "eclipse": return r < 1 && Math.sqrt((dx - 0.35) ** 2 + (dy + 0.1) ** 2) > 0.82;
    case "sun": return r < 0.6 || (r < 1 && Math.cos(Math.atan2(dy, dx) * 8) > 0.55);
    case "mullet": {
      const a = Math.atan2(dy, dx);
      return r < 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(a * 2.5)), 3);
    }
    case "tower": return Math.abs(dx) < 0.55 && dy > -0.6 && dy < 0.9 && !(dy < -0.35 && Math.abs(dx) < 0.18);
    case "crown": return Math.abs(dx) < 0.8 && dy > -0.2 && dy < 0.5 && (dy > 0.1 || Math.cos(dx * 7.8) > 0.2);
    case "key": return (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.85) || (r > 0.25 && r < 0.45 && dy < -0.3) || (dy > 0.5 && dx > 0 && dx < 0.45 && dy < 0.75);
    case "sword": return (Math.abs(dx) < 0.1 && dy > -0.9 && dy < 0.6) || (Math.abs(dy - 0.45) < 0.08 && Math.abs(dx) < 0.45);
    case "flame": return r < 0.9 && dy > -0.9 + Math.abs(dx) * 1.2 - 0.2 * Math.cos(dx * 9);
    case "tree": return (Math.abs(dx) < 0.12 && dy > 0 && dy < 0.9) || Math.sqrt(dx * dx + (dy + 0.25) ** 2) < 0.62;
    case "cog": {
      const a = Math.atan2(dy, dx);
      return r < 0.75 + 0.18 * (Math.cos(a * 8) > 0 ? 1 : 0) && r > 0.28;
    }
    case "pawn": return Math.sqrt(dx * dx + (dy + 0.55) ** 2) < 0.28 || (Math.abs(dx) < 0.22 + Math.max(0, dy) * 0.5 && dy > -0.35 && dy < 0.85);
    default: return r < 0.7;
  }
}

/** Simplified rasteriser from tinctures (fallback until the gameplay rasteriser is synced). */
export const fallbackHeraldryRaster: HeraldryRasterSource = {
  id: "environment-fallback",
  rasterize(h: Heraldry, req: HeraldryRasterRequest): HeraldryRasterResult {
    const { width, height, aspect } = req;
    const data = new Uint8ClampedArray(width * height * 4);
    const f0 = rgb(h.field[0]);
    const f1 = rgb(h.field[1]);
    const ord = rgb(h.ordinaryTincture);
    const chg = rgb(h.chargeTincture);
    const SS = 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, bl = 0, cov = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const u = (x + (sx + 0.5) / SS) / width;
            const v = (y + (sy + 0.5) / SS) / height;
            let c = h.division !== "plain" && inDivision(h, u, v) ? f1 : f0;
            if (inOrdinary(h, u, v)) c = ord;
            if (inCharge(h, u, v, aspect)) c = chg;
            r += c[0]; g += c[1]; bl += c[2];
            cov += silhouette(aspect, u, v);
          }
        }
        const n = SS * SS;
        const o = (y * width + x) * 4;
        data[o] = r / n;
        data[o + 1] = g / n;
        data[o + 2] = bl / n;
        data[o + 3] = Math.round((cov / n) * 255);
      }
    }
    return { width, height, data };
  },
};

/**
 * The rasteriser renderers use by default. Point this at an adapter over the gameplay
 * workflow's rasterizeHeraldry once shared/legacy/heraldry is synced into this branch.
 */
export const defaultHeraldryRaster: HeraldryRasterSource = fallbackHeraldryRaster;

export interface AtlasHeraldry {
  player: Heraldry | null;
  ally: Heraldry | null;
  rival: Heraldry | null;
  /** National standard colours: field and border (working placeholder, no invented charge). */
  crown: { field: string; border: string };
  /** Undyed cloth shown for the player's mounts before a banner exists. */
  undyed: string;
  veil: { cloth: string; border: string };
}

function fillRect(atlas: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, hex: string, border: string | null, aspect: HeraldryAspectKind): void {
  const W = HERALDRY_ATLAS_SIZE.width;
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const bn = border ? parseInt(border.slice(1), 16) : 0;
  const bc = [(bn >> 16) & 255, (bn >> 8) & 255, bn & 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, v = (y + 0.5) / h;
      const edge = Math.min(u, 1 - u, v, 1 - v);
      const useBorder = border !== null && edge < 0.06;
      const col = useBorder ? bc : c;
      // Faint woven variation so plain cloth is never a flat fill.
      const weave = ((x * 7 + y * 13) % 5) - 2;
      const o = ((y0 + y) * W + x0 + x) * 4;
      atlas[o] = col[0] + weave;
      atlas[o + 1] = col[1] + weave;
      atlas[o + 2] = col[2] + weave;
      atlas[o + 3] = Math.round(silhouette(aspect, u, v) * 255);
    }
  }
}

function blit(atlas: Uint8ClampedArray, x0: number, y0: number, r: HeraldryRasterResult): void {
  const W = HERALDRY_ATLAS_SIZE.width;
  for (let y = 0; y < r.height; y++) {
    const src = y * r.width * 4;
    atlas.set(r.data.subarray(src, src + r.width * 4), ((y0 + y) * W + x0) * 4);
  }
}

/**
 * Fills the shared heraldry atlas (HERALDRY_ATLAS_SIZE RGBA, straight alpha, row 0 at
 * the top). Slots without heraldry get undyed cloth.
 */
export function fillHeraldryAtlas(atlas: Uint8ClampedArray, heraldry: AtlasHeraldry, raster: HeraldryRasterSource = defaultHeraldryRaster): void {
  const slots: [HeraldrySlot, Heraldry | null][] = [["player", heraldry.player], ["ally", heraldry.ally], ["rival", heraldry.rival]];
  const aspects: HeraldryAspectKind[] = ["banner", "shield", "pennant"];
  for (const [slot, h] of slots) {
    for (const aspect of aspects) {
      const t = atlasTile(slot, aspect);
      if (h) blit(atlas, t.x, t.y, raster.rasterize(h, { width: t.w, height: t.h, aspect }));
      else fillRect(atlas, t.x, t.y, t.w, t.h, heraldry.undyed, null, aspect);
    }
  }
  for (const aspect of aspects) {
    const t = atlasTile("crown", aspect);
    fillRect(atlas, t.x, t.y, t.w, t.h, heraldry.crown.field, heraldry.crown.border, aspect);
  }
  const v = atlasTile("veiled", "banner");
  fillRect(atlas, v.x, v.y, v.w, v.h, heraldry.veil.cloth, heraldry.veil.border, "banner");
}
