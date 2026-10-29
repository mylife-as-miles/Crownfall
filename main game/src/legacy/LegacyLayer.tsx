import { forwardRef, lazy, Suspense, useEffect, useState } from "react";
import { DESKTOP_LEGACY_COPY } from "./desktop-copy";
import type { DesktopEnvironmentQuality } from "./environment-contract";
import type { LegacyScreenHandle } from "./legacy-handle";
import "./LegacyLayer.css";

// The Legacy screen, shared domain and environment load on first entry only.
const LegacyScreen = lazy(() => import("./LegacyScreen"));

/** Matches the layer's fade-out in LegacyLayer.css. */
const FADE_OUT_MS = 260;

interface LegacyLayerProps {
  active: boolean;
  reducedMotion: boolean;
  quality: DesktopEnvironmentQuality;
  onBack(): void;
}

/**
 * Full-stage layer for My Legacy. It stays mounted after the first visit,
 * hidden, inert and with its renderer paused, so returning is instant and the
 * environment is never rebuilt on a Home round trip. Once it has faded out it
 * goes dormant (content-visibility: hidden), so the menu does no style or
 * layout work for the hidden screen.
 */
export const LegacyLayer = forwardRef<LegacyScreenHandle, LegacyLayerProps>(function LegacyLayer({ active, reducedMotion, quality, onBack }, ref) {
  const [fadedOut, setFadedOut] = useState(false);
  useEffect(() => {
    if (active) {
      setFadedOut(false);
      return;
    }
    const timer = setTimeout(() => setFadedOut(true), reducedMotion ? 0 : FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [active, reducedMotion]);
  // Derived, so the layer is never dormant in the commit that activates it.
  const dormant = !active && fadedOut;
  return <div className={`legacy-layer${active ? " is-active" : ""}${dormant ? " is-dormant" : ""}`} inert={!active} aria-hidden={active ? undefined : true} data-legacy-layer={active ? "active" : "hidden"}>
    <Suspense fallback={<p className="legacy-layer-loading" role="status"><span className="legacy-loading-mark" aria-hidden="true" />{DESKTOP_LEGACY_COPY.preparing}</p>}>
      <LegacyScreen ref={ref} active={active} reducedMotion={reducedMotion} quality={quality} onBack={onBack} />
    </Suspense>
  </div>;
});
