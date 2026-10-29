// SVG and path-string emitters for UI previews (desktop founding, inspectors).
// Output matches rasterizeHeraldry: same shapes, nonzero fills, outline clip,
// cloth border and charge contour.

import { describeHeraldry } from "../content/heraldry";
import type { Heraldry } from "../types";
import type { Ring } from "./geometry";
import { heraldryShapes } from "./shapes";
import type { HeraldryAspect, HeraldryShapes } from "./shapes";

function num(value: number): string {
  const text = value.toFixed(4);
  return text.indexOf(".") === -1 ? text : text.replace(/0+$/, "").replace(/\.$/, "");
}

/** SVG path data ("M x y L ... Z") for oriented rings; render with fill-rule="nonzero". */
export function heraldryPathData(rings: readonly Ring[]): string {
  const parts: string[] = [];
  for (const ring of rings) {
    if (ring.length < 6) continue;
    let d = `M${num(ring[0])} ${num(ring[1])}`;
    for (let index = 2; index < ring.length; index += 2) d += `L${num(ring[index])} ${num(ring[index + 1])}`;
    parts.push(`${d}Z`);
  }
  return parts.join("");
}

export interface HeraldrySvgPaths {
  viewBox: string;
  outline: string;
  layers: { role: HeraldryShapes["layers"][number]["role"]; color: string; opacity: number; d: string }[];
  fimbriation: HeraldryShapes["fimbriation"];
}

/** Path strings per layer, for UI frameworks that prefer to build their own SVG elements. */
export function heraldrySvgPaths(heraldry: Heraldry, aspect: HeraldryAspect, options: { swallowtail?: boolean } = {}): HeraldrySvgPaths {
  const shapes = heraldryShapes(heraldry, aspect, options);
  return {
    viewBox: `0 0 1 ${num(shapes.height)}`,
    outline: heraldryPathData(shapes.outline),
    layers: shapes.layers.map((layer) => ({ role: layer.role, color: layer.color, opacity: layer.opacity, d: heraldryPathData(layer.rings) })),
    fimbriation: shapes.fimbriation,
  };
}

export interface HeraldrySvgOptions {
  aspect: HeraldryAspect;
  swallowtail?: boolean;
  /** Unique prefix for the clip-path id when several SVGs share a document. */
  idPrefix?: string;
  /** Pixel width attribute; height follows the aspect. Omit for a fluid SVG. */
  width?: number;
  border?: boolean;
  /** Fimbriate charges that break the rule of tincture (default true). */
  fimbriation?: boolean;
  /** Accessible label; defaults to the blazon. */
  title?: string;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A self-contained SVG document string for the heraldry. */
export function svgHeraldry(heraldry: Heraldry, options: HeraldrySvgOptions): string {
  const paths = heraldrySvgPaths(heraldry, options.aspect, { swallowtail: options.swallowtail });
  const id = `${(options.idPrefix ?? "heraldry").replace(/[^A-Za-z0-9_-]/g, "")}-clip`;
  const height = Number(paths.viewBox.split(" ")[3]);
  const size = options.width !== undefined ? ` width="${num(options.width)}" height="${num(options.width * height)}"` : "";
  const label = escapeXml(options.title ?? describeHeraldry(heraldry));
  let body = "";
  for (const layer of paths.layers) {
    if (layer.role === "border" && options.border === false) continue;
    const opacity = layer.opacity < 1 ? ` fill-opacity="${num(layer.opacity)}"` : "";
    const fimbriation = layer.role === "charge" && options.fimbriation !== false ? paths.fimbriation : null;
    const contour = fimbriation
      ? ` stroke="${fimbriation.color}" stroke-width="${num(fimbriation.width)}" stroke-linejoin="round" paint-order="stroke"`
      : "";
    body += `<path d="${layer.d}" fill="${layer.color}"${opacity}${contour}/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${paths.viewBox}"${size} role="img" aria-label="${label}">` +
    `<defs><clipPath id="${id}"><path d="${paths.outline}"/></clipPath></defs>` +
    `<g clip-path="url(#${id})" fill-rule="nonzero">${body}</g></svg>`;
}
