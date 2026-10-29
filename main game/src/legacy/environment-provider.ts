// Discovers the environment workflow's Bannerhold renderer through the seam in
// docs/legacy/WORKFLOWS.md and falls back to the gameplay stand-in when that
// module is absent or fails to start. Both are loaded lazily, on entering My
// Legacy, so neither adds to the menu's startup bundle. The rest of the Legacy
// UI talks only to the DesktopLegacyEnvironment contract.

import type {
  CreateDesktopLegacyEnvironment, DesktopLegacyEnvironment, DesktopLegacyEnvironmentOptions,
} from "./environment-contract";

type EnvironmentModule = { createLegacyEnvironment: CreateDesktopLegacyEnvironment };

const environmentModules = import.meta.glob<EnvironmentModule>("./environment/createLegacyEnvironment.ts");

export type LegacyEnvironmentSource = "environment" | "stand-in";

export interface LoadedLegacyEnvironment {
  environment: DesktopLegacyEnvironment;
  source: LegacyEnvironmentSource;
  /** Why the environment module was not used, when the stand-in replaced it after a failure. */
  fallbackReason: string | null;
}

/** True when the environment workflow's module is present in this build. */
export function hasLegacyEnvironmentModule(): boolean {
  return Object.keys(environmentModules).length > 0;
}

/** `?legacyStandIn` forces the stand-in, so the gameplay flow can be checked against either renderer. */
function standInRequested(search: string): boolean {
  return new URLSearchParams(search).has("legacyStandIn");
}

/** Thrown when the caller aborted the load before a renderer was created. */
export class LegacyEnvironmentAborted extends Error {
  constructor() {
    super("The Legacy environment load was cancelled.");
    this.name = "LegacyEnvironmentAborted";
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new LegacyEnvironmentAborted();
}

/** Resolves once a frame has been produced, so the loading state is on screen before a long synchronous step. */
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function createStandIn(options: DesktopLegacyEnvironmentOptions, signal: AbortSignal | undefined): Promise<DesktopLegacyEnvironment> {
  const module = await import("./standin/createStandInEnvironment");
  await afterNextPaint();
  // Creating a WebGL context is the expensive step, so a cancelled entry never reaches it.
  throwIfAborted(signal);
  return module.createStandInEnvironment(options);
}

function createHost(container: HTMLElement): HTMLElement {
  const host = document.createElement("div");
  host.className = "legacy-environment-host";
  container.appendChild(host);
  return host;
}

/**
 * Creates the desktop Bannerhold environment inside `options.container`. Each
 * attempt renders into its own child element, so a failed environment can be
 * removed without touching anything else the caller placed in the container.
 */
export async function loadLegacyEnvironment(options: DesktopLegacyEnvironmentOptions, signal?: AbortSignal, search = window.location.search): Promise<LoadedLegacyEnvironment> {
  const loader = Object.values(environmentModules)[0];
  let fallbackReason: string | null = null;
  if (loader && !standInRequested(search)) {
    const module = await loader();
    await afterNextPaint();
    throwIfAborted(signal);
    const host = createHost(options.container);
    try {
      const environment = await module.createLegacyEnvironment({ ...options, container: host });
      return { environment, source: "environment", fallbackReason: null };
    } catch (error) {
      host.remove();
      throwIfAborted(signal);
      fallbackReason = error instanceof Error ? error.message : String(error);
      console.warn(`My Legacy: the Bannerhold environment could not start (${fallbackReason}). Using the stand-in.`);
    }
  }
  const host = createHost(options.container);
  try {
    const environment = await createStandIn({ ...options, container: host }, signal);
    return { environment, source: "stand-in", fallbackReason };
  } catch (error) {
    host.remove();
    throw error;
  }
}
