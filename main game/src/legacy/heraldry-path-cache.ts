// Inspector replacement remounts emblems. Keep their exact shared SVG paths
// across those mounts, bounded so editing many designs cannot grow forever.
// SVG instance IDs remain in HeraldryEmblem, outside this design-only cache.
import { heraldrySvgPaths } from "../../../shared/legacy/heraldry/svg";
import type { HeraldrySvgPaths } from "../../../shared/legacy/heraldry/svg";
import type { HeraldryAspect } from "../../../shared/legacy/heraldry/shapes";
import type { Heraldry } from "../../../shared/legacy/types";

const pathsByDesign = new Map<string, HeraldrySvgPaths>();
const MAX_DESIGNS = 32;

export function cachedHeraldryPaths(heraldry: Heraldry, aspect: HeraldryAspect, swallowtail: boolean): HeraldrySvgPaths {
  const key = `${aspect}|${swallowtail ? 1 : 0}|${heraldry.division}|${heraldry.field[0]}|${heraldry.field[1]}|${heraldry.ordinary}|${heraldry.ordinaryTincture}|${heraldry.charge}|${heraldry.chargeTincture}`;
  const cached = pathsByDesign.get(key);
  if (cached) {
    pathsByDesign.delete(key);
    pathsByDesign.set(key, cached);
    return cached;
  }
  const paths = heraldrySvgPaths(heraldry, aspect, { swallowtail });
  pathsByDesign.set(key, paths);
  if (pathsByDesign.size > MAX_DESIGNS) {
    const oldest = pathsByDesign.keys().next().value;
    if (oldest !== undefined) pathsByDesign.delete(oldest);
  }
  return paths;
}
