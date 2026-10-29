// Seam implementation (docs/legacy/WORKFLOWS.md): gameplay's environment provider
// discovers this module with import.meta.glob and calls createLegacyEnvironment.

import type { CreateDesktopLegacyEnvironment } from "../environment-contract";
import { BannerholdEnvironment } from "./environment";

export const createLegacyEnvironment: CreateDesktopLegacyEnvironment = async (options) => {
  const env = new BannerholdEnvironment(options);
  await env.init();
  return env;
};
