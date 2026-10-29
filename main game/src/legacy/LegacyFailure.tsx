import { Component, forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { DESKTOP_LEGACY_COPY as UI } from "./desktop-copy";
import type { LegacyScreenHandle } from "./legacy-handle";

const CHUNK_FAILURE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;
const CHUNK_URL = /(?:Failed to fetch dynamically imported module|error loading dynamically imported module):\s*(\S+)/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when the screen's code could not be downloaded, rather than failing while it ran. */
export function isChunkLoadFailure(error: unknown): boolean {
  return CHUNK_FAILURE.test(errorMessage(error));
}

/**
 * The module URL a failed dynamic import names, when the browser reports it
 * (Chromium and Firefox do; Safari does not). Browsers remember a failed
 * module fetch for the life of the page, so a retry must ask for a fresh URL.
 */
export function failedChunkUrl(error: unknown): string | null {
  const match = CHUNK_URL.exec(errorMessage(error));
  return match ? match[1] : null;
}

interface LegacyErrorBoundaryProps {
  children: ReactNode;
  fallback(error: unknown): ReactNode;
  onError(error: unknown): void;
}

interface LegacyErrorBoundaryState {
  failed: boolean;
  error: unknown;
}

/**
 * Keeps a failure inside My Legacy (a chunk that cannot be downloaded, or an
 * exception while a Legacy screen renders) from unmounting the menu around it.
 */
export class LegacyErrorBoundary extends Component<LegacyErrorBoundaryProps, LegacyErrorBoundaryState> {
  state: LegacyErrorBoundaryState = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): LegacyErrorBoundaryState {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn(`My Legacy could not open: ${errorMessage(error)}`, info.componentStack ?? "");
    this.props.onError(error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.state.error) : this.props.children;
  }
}

interface LegacyFailureProps {
  active: boolean;
  error: unknown;
  /** A retry already failed to download the screen: offer a page reload instead. */
  exhausted: boolean;
  onRetry(): void;
  onBack(): void;
}

/**
 * The honest failure state. It answers App's input handle like the Legacy
 * screen does, so keys and the controller reach its buttons, and Back always
 * returns Home. Styled from LegacyLayer.css, which ships with the menu bundle,
 * so it renders even when the Legacy chunk and its stylesheet never arrived.
 */
export const LegacyFailure = forwardRef<LegacyScreenHandle, LegacyFailureProps>(function LegacyFailure({ active, error, exhausted, onRetry, onBack }, ref) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const homeRef = useRef<HTMLButtonElement>(null);
  const retry = exhausted ? () => window.location.reload() : onRetry;

  useEffect(() => {
    if (active) primaryRef.current?.focus({ preventScroll: true });
  }, [active]);

  useImperativeHandle(ref, () => {
    const buttons = () => [primaryRef.current, homeRef.current].filter((button): button is HTMLButtonElement => button !== null);
    const step = (delta: number) => {
      const list = buttons();
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      list[Math.max(0, Math.min(list.length - 1, index < 0 ? 0 : index + delta))]?.focus({ preventScroll: true });
    };
    return {
      move(direction) { step(direction === "left" || direction === "up" ? -1 : 1); },
      edge(last) { step(last ? 2 : -2); },
      activate() {
        const focused = document.activeElement;
        if (focused instanceof HTMLButtonElement && buttons().includes(focused)) focused.click();
        else primaryRef.current?.click();
      },
      reset() { /* Nothing to reset. */ },
      focus() { primaryRef.current?.focus({ preventScroll: true }); },
      // Back always leaves for Home from here.
      cancel() { return false; },
      cycle() { /* No landmarks while My Legacy cannot open. */ },
      orbit() { /* No scene. */ },
    };
  }, []);

  return <section className="legacy-failure" role="alert" aria-labelledby="legacy-failure-title" data-legacy-failure={isChunkLoadFailure(error) ? "chunk" : "render"}>
    <p className="legacy-failure-eyebrow">{UI.screenLabel}</p>
    <h2 id="legacy-failure-title">{UI.failure.title}</h2>
    <p>{UI.failure.body}</p>
    {exhausted && <p className="legacy-failure-note">{UI.failure.reloadNote}</p>}
    <div className="legacy-failure-actions">
      <button ref={primaryRef} type="button" className="is-primary" data-failure-retry onClick={retry}>{exhausted ? UI.failure.reload : UI.failure.retry}</button>
      <button ref={homeRef} type="button" data-failure-home onClick={onBack}>{UI.failure.home}</button>
    </div>
    <details className="legacy-failure-details">
      <summary>{UI.failure.details}</summary>
      <p>{errorMessage(error)}</p>
    </details>
  </section>;
});
