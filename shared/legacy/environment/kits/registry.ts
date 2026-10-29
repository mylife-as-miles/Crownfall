// Kit registry: assembles kit packages so district owners can work in parallel
// without editing the same files. Building kits are looked up by the blueprint's
// `kit` id (exact, then without the nation prefix, then by family), falling back to
// the architecture kit; site kits run in order.

import type { Building } from "../blueprint";
import type { MeshBuffer } from "../kernel";
import { buildArchitecture } from "./architecture";
import type { KitContext } from "./context";

export type BuildingKit = (ctx: KitContext, building: Building) => void;

export interface SiteKit {
  id: string;
  /** Lower runs first. */
  order: number;
  /** May append to the context's builder and collectors, and/or return finished meshes. */
  build(ctx: KitContext): MeshBuffer[] | void;
}

export interface KitPackage {
  id: string;
  /** Keys: full kit ids ("kv.manor.banner-hall"), prefix-free ids ("manor.banner-hall") or families ("manor.*"). */
  buildingKits?: Readonly<Record<string, BuildingKit>>;
  siteKits?: readonly SiteKit[];
}

export class KitRegistry {
  private kits = new Map<string, BuildingKit>();
  private sites: SiteKit[] = [];
  readonly packages: readonly KitPackage[];

  constructor(packages: readonly KitPackage[]) {
    this.packages = packages;
    for (const p of packages) {
      if (p.buildingKits) for (const k of Object.keys(p.buildingKits)) this.kits.set(k, p.buildingKits[k]);
      if (p.siteKits) for (const s of p.siteKits) this.sites.push(s);
    }
    this.sites.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  }

  /** Resolves a blueprint kit id to a building kit. */
  buildingKit(kitId: string): BuildingKit {
    const exact = this.kits.get(kitId);
    if (exact) return exact;
    const dot = kitId.indexOf(".");
    const bare = dot >= 0 ? kitId.slice(dot + 1) : kitId;
    const byBare = this.kits.get(bare);
    if (byBare) return byBare;
    const family = bare.split(".")[0];
    const byFamily = this.kits.get(`${family}.*`);
    if (byFamily) return byFamily;
    return buildArchitecture;
  }

  /** Kit id that would build a building (for documentation and tests). */
  resolvedKey(kitId: string): string {
    if (this.kits.has(kitId)) return kitId;
    const dot = kitId.indexOf(".");
    const bare = dot >= 0 ? kitId.slice(dot + 1) : kitId;
    if (this.kits.has(bare)) return bare;
    const family = `${bare.split(".")[0]}.*`;
    if (this.kits.has(family)) return family;
    return "architecture";
  }

  siteKits(): readonly SiteKit[] {
    return this.sites;
  }
}
