// Development previews on demand. The fixture tapes and their runner arrive as
// a separate chunk, fetched only when the URL asks for ?legacyPreview=<id>, so
// an app that resolves its session here keeps them out of its production
// chunks. This module must never import ./fixtures statically.

import { LEGACY_COPY } from "../content/copy";
import { previewMissingSession, readSearchParam, requestsLegacyPreview, resolveLegacySession } from "./persistence";
import type { LegacyPreviewSource, LegacySession, LegacySessionOptions, LegacyStorageLike } from "./persistence";

/** Fetches the fixture-backed preview source. Bundlers split it into its own chunk. */
export function loadLegacyPreviewSource(): Promise<LegacyPreviewSource> {
  return import("./fixtures");
}

export interface LazyLegacySessionOptions extends LegacySessionOptions {
  /** Replaces loadLegacyPreviewSource (tests, custom preview catalogues). */
  loadPreviews?: () => Promise<LegacyPreviewSource>;
}

/**
 * resolveLegacySession, loading the previews first only when the URL asks for
 * one. Ordinary visits resolve without fetching anything. A preview source
 * that fails to load yields a "preview-missing" session; storage is never
 * touched on that path.
 */
export async function resolveLegacySessionLazily(
  search: string,
  storage: LegacyStorageLike | null,
  options: LazyLegacySessionOptions = {},
): Promise<LegacySession> {
  const { loadPreviews, ...sessionOptions } = options;
  if (!requestsLegacyPreview(search)) return resolveLegacySession(search, storage, sessionOptions);
  let previews: LegacyPreviewSource;
  try {
    previews = await (loadPreviews ?? loadLegacyPreviewSource)();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return previewMissingSession(readSearchParam(search, "legacyPreview") ?? "", `${LEGACY_COPY.preview.unavailable} ${detail}`, [], sessionOptions.at);
  }
  return resolveLegacySession(search, storage, { ...sessionOptions, previews });
}
