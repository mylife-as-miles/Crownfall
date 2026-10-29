import { KitRegistry } from "../registry";
import { FIGURES_PACKAGE } from "./figures";
import { LANDMARKS_PACKAGE } from "./landmarks";
import { LANDSCAPE_PACKAGE } from "./landscape";
import { NATIONS_PACKAGE } from "./nations";
import { OUTER_PACKAGE } from "./outer";
import { SETTLEMENT_PACKAGE } from "./settlement";

export const DEFAULT_PACKAGES = [LANDSCAPE_PACKAGE, SETTLEMENT_PACKAGE, LANDMARKS_PACKAGE, OUTER_PACKAGE, FIGURES_PACKAGE, NATIONS_PACKAGE] as const;

export function createDefaultRegistry(): KitRegistry {
  return new KitRegistry(DEFAULT_PACKAGES);
}

export { FIGURES_PACKAGE, LANDMARKS_PACKAGE, LANDSCAPE_PACKAGE, NATIONS_PACKAGE, OUTER_PACKAGE, SETTLEMENT_PACKAGE };
