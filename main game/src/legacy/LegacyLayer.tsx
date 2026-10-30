import { forwardRef, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { DESKTOP_LEGACY_COPY } from "./desktop-copy";
import type { DesktopEnvironmentQuality } from "./environment-contract";
import type { LegacyScreenHandle } from "./legacy-handle";
import { failedChunkUrl, isChunkLoadFailure, LegacyErrorBoundary, LegacyFailure } from "./LegacyFailure";
import "./LegacyLayer.css";

type LegacyScreenModule = Awaited<ReturnType<typeof import("./LegacyScreen").loadLegacyScreen>>;

// The Legacy screen, shared domain and environment load on first entry only.
const importLegacyScreen = (): Promise<LegacyScreenModule> => import("./LegacyScreen").then((module) => module.loadLegacyScreen());

/**
 * A fresh lazy screen for each attempt. After a failed download the browser
 * keeps answering the same module URL with the same failure, so a retry asks
 * for that URL again with a query of its own.
 */
function lazyLegacyScreen(retryOf: string | null, attempt: number) {
  if (!retryOf) return lazy(importLegacyScreen);
  const url = new URL(retryOf, window.location.href);
  url.searchParams.set("legacyRetry", String(attempt));
  return lazy((): Promise<LegacyScreenModule> => import(/* @vite-ignore */ url.href).then((module) => module.loadLegacyScreen()));
}

/** Matches the layer's fade-out in LegacyLayer.css. */
const FADE_OUT_MS = 260;
/** Failed retries before the failure state offers a page reload instead. */
const MAX_RETRIES = 2;

interface LegacyLayerProps {
  active: boolean;
  reducedMotion: boolean;
  quality: DesktopEnvironmentQuality;
  onBack(): void;
  onPlay(): void;
}

interface Attempt {
  index: number;
  Screen: ReturnType<typeof lazyLegacyScreen>;
  /** Set once this attempt failed. */
  error: unknown;
  /** True when a retry also failed to download, so only a reload can help. */
  exhausted: boolean;
}

/**
 * Full-stage layer for My Legacy. It stays mounted after the first visit,
 * hidden, inert and with its renderer paused, so returning is instant and the
 * environment is never rebuilt on a Home round trip. Once it has faded out it
 * goes dormant (content-visibility: hidden), so the menu does no style or
 * layout work for the hidden screen. An error boundary keeps any Legacy
 * failure inside this layer: Home and Play keep working, and the layer offers
 * Retry and Return to Home.
 */
export const LegacyLayer = forwardRef<LegacyScreenHandle, LegacyLayerProps>(function LegacyLayer({ active, reducedMotion, quality, onBack, onPlay }, ref) {
  const [fadedOut, setFadedOut] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>(() => ({ index: 0, Screen: lazyLegacyScreen(null, 0), error: null, exhausted: false }));

  useEffect(() => {
    if (active) {
      setFadedOut(false);
      return;
    }
    const timer = setTimeout(() => setFadedOut(true), reducedMotion ? 0 : FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [active, reducedMotion]);

  const retry = useCallback(() => {
    setAttempt((failed) => {
      const index = failed.index + 1;
      const retryOf = isChunkLoadFailure(failed.error) ? failedChunkUrl(failed.error) : null;
      return { index, Screen: lazyLegacyScreen(retryOf, index), error: null, exhausted: false };
    });
  }, []);

  const fail = useCallback((error: unknown) => {
    // A download the browser gives no URL for cannot be retried in this page, and after two failed
    // retries the likeliest cause is a stale deployment: both need a reload.
    setAttempt((current) => ({ ...current, error, exhausted: isChunkLoadFailure(error) && (failedChunkUrl(error) === null || current.index >= MAX_RETRIES) }));
  }, []);

  // Coming back to My Legacy after a failure tries again.
  const wasActive = useRef(active);
  useEffect(() => {
    const entering = active && !wasActive.current;
    wasActive.current = active;
    if (entering && attempt.error !== null && !attempt.exhausted) retry();
  }, [active, attempt.error, attempt.exhausted, retry]);

  // Derived, so the layer is never dormant in the commit that activates it.
  const dormant = !active && fadedOut;
  const { Screen } = attempt;
  return <div className={`legacy-layer${active ? " is-active" : ""}${dormant ? " is-dormant" : ""}`} inert={!active} aria-hidden={active ? undefined : true} data-legacy-layer={active ? "active" : "hidden"} data-legacy-attempt={attempt.index}>
    <LegacyErrorBoundary
      key={attempt.index}
      onError={fail}
      fallback={(error) => <LegacyFailure ref={ref} active={active} error={error} exhausted={attempt.exhausted} onRetry={retry} onBack={onBack} />}
    >
      <Suspense fallback={<p className="legacy-layer-loading" role="status"><span className="legacy-loading-mark" aria-hidden="true" />{DESKTOP_LEGACY_COPY.preparing}</p>}>
        <Screen ref={ref} active={active} reducedMotion={reducedMotion} quality={quality} onBack={onBack} onPlay={onPlay} />
      </Suspense>
    </LegacyErrorBoundary>
  </div>;
});
