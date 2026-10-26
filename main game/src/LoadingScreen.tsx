import type { CSSProperties } from "react";
import "./LoadingScreen.css";

export interface LoadingScreenProps {
  /** Completed boot work, normalized to 0–1. Null means the total is unknown. */
  progress: number | null;
  status: string;
  ready: boolean;
  leaving: boolean;
  reducedMotion: boolean;
  typeReady?: boolean;
  degraded?: boolean;
  onRetry?(): void;
  onContinue?(): void;
}

const motes = [
  [7, 77, 11, -3], [16, 60, 14, -9], [29, 86, 13, -5], [42, 68, 15, -11],
  [51, 82, 12, -2], [58, 47, 16, -7], [64, 72, 13, -10], [71, 35, 17, -4],
  [76, 88, 15, -12], [83, 62, 12, -8], [89, 78, 16, -6], [94, 42, 14, -1],
];

function CrownSeal() {
  return <svg className="loading-crest" viewBox="0 0 160 160" fill="none" aria-hidden="true">
    <circle className="loading-crest-halo" cx="80" cy="80" r="58" />
    <circle className="loading-crest-dial" cx="80" cy="80" r="64" strokeDasharray="1 9.05" />
    <g className="loading-crest-orbit">
      <ellipse cx="80" cy="80" rx="75" ry="20" transform="rotate(-24 80 80)" />
      <path className="loading-crest-glint" d="m12.7 109 3.1 1.2 1.2 3.2 1.2-3.2 3.2-1.2-3.2-1.2-1.2-3.1-1.2 3.1-3.1 1.2Z" />
    </g>
    <path className="loading-crest-crown" d="m50 61 8 32h44l8-32-19 16-11-27-11 27-19-16Z" />
    <path className="loading-crest-base" d="M59 101h42M55 109h50" />
    <path className="loading-crest-axis" d="M80 6v10M80 144v10M6 80h10M144 80h10" />
    <path className="loading-crest-diamond" d="m80 16 3.5 5-3.5 5-3.5-5 3.5-5ZM80 134l3.5 5-3.5 5-3.5-5 3.5-5Z" />
  </svg>;
}

export default function LoadingScreen({ progress, status, ready, leaving, reducedMotion, typeReady = true, degraded = false, onRetry, onContinue }: LoadingScreenProps) {
  const value = progress === null || !Number.isFinite(progress) ? null : Math.min(1, Math.max(0, progress));
  const state = leaving ? "leaving" : degraded ? "degraded" : ready ? "ready" : "loading";

  return <section
    className={`loading-screen${reducedMotion ? " loading-screen--still" : ""}`}
    data-loading-state={state}
    role="region"
    aria-label="Crownfall loading screen"
    aria-busy={!ready && !degraded}
  >
    <img className="loading-art" src="/assets/environments/card-resume.webp" alt="" draggable={false} aria-hidden="true" />
    <div className="loading-art-shade" aria-hidden="true" />
    <div className="loading-motes" aria-hidden="true">
      {motes.map(([x, y, duration, delay], index) => <span key={index} style={{ "--mote-x": `${x}%`, "--mote-y": `${y}%`, animationDuration: `${duration}s`, animationDelay: `${delay}s` } as CSSProperties} />)}
    </div>

    <div className="loading-brand" data-type-ready={typeReady}>
      <CrownSeal />
      <h1 className="loading-wordmark">CROWNFALL</h1>
      <div className="loading-subtitle"><span aria-hidden="true" /><p>KING’S GAMBIT</p><span aria-hidden="true" /></div>
    </div>

    <div className="loading-lower">
      <div className="loading-status-line">
        <span className="loading-status-mark" aria-hidden="true" />
        <p role="status" aria-live="polite" aria-atomic="true">{status}</p>
      </div>
      <div
        className={`loading-progress${value === null ? " loading-progress--indeterminate" : ""}`}
        role="progressbar"
        aria-label="Preparing menu"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
        aria-valuetext={value === null ? "Preparing menu assets" : `${Math.round(value * 100)} percent of menu preparation complete`}
      >
        <span className="loading-progress-fill" style={{ transform: `scaleX(${value ?? 0.18})` }} />
        <span className="loading-progress-cap" aria-hidden="true" />
      </div>
      {(onRetry || onContinue) && <div className="loading-actions">
        {onRetry && <button className="loading-action" type="button" onClick={onRetry}>Retry loading</button>}
        {onContinue && <button className="loading-action loading-action--primary" type="button" onClick={onContinue}>Continue to menu <span aria-hidden="true">&gt;</span></button>}
      </div>}
    </div>
    <div className="loading-frame" aria-hidden="true"><i /><i /><i /><i /></div>
  </section>;
}
