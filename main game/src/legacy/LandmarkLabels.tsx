import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { LEGACY_COPY } from "../../../shared/legacy/content/copy";
import { LEGACY_LANDMARKS } from "../../../shared/legacy/environment-contract";
import type { LandmarkId } from "../../../shared/legacy/types";
import type { DesktopLegacyEnvironment } from "./environment-contract";

export interface LandmarkSummary {
  status: string;
  /** Small count badge (unread notices). */
  badge?: number;
}

export interface LandmarkLabelsHandle {
  /** Re-projects every label now, so directional selection never reads positions from an older frame. */
  sync(): void;
}

interface LandmarkLabelsProps {
  environment: DesktopLegacyEnvironment | null;
  /** Runs the per-frame anchor projection while the overview is visible. */
  tracking: boolean;
  hidden: boolean;
  selected: LandmarkId;
  hovered: LandmarkId | null;
  summaries: Readonly<Record<LandmarkId, LandmarkSummary>>;
  onSelect(id: LandmarkId): void;
  onHover(id: LandmarkId | null): void;
  onOpen(id: LandmarkId): void;
}

/**
 * Landmark labels are real buttons over the 3D scene, positioned each frame
 * from the environment's projectLandmark anchors through direct style writes
 * (no React state per frame), and written only when an anchor moves.
 */
export const LandmarkLabels = forwardRef<LandmarkLabelsHandle, LandmarkLabelsProps>(function LandmarkLabels({ environment, tracking, hidden, selected, hovered, summaries, onSelect, onHover, onOpen }, ref) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // Last written x, y and visibility per label; NaN forces the first write.
  const last = useRef(new Float64Array(LEGACY_LANDMARKS.length * 3).fill(Number.NaN));

  const project = useCallback(() => {
    if (!environment) return;
    const written = last.current;
    for (let index = 0; index < LEGACY_LANDMARKS.length; index++) {
      const button = buttons.current[index];
      if (!button) continue;
      const anchor = environment.projectLandmark(LEGACY_LANDMARKS[index]);
      const visible = anchor !== null && anchor.visible ? 1 : 0;
      const slot = index * 3;
      if (visible !== written[slot + 2]) {
        written[slot + 2] = visible;
        button.dataset.visible = visible ? "true" : "false";
      }
      if (!anchor || !visible) continue;
      const x = Math.round(anchor.x * 2) / 2;
      const y = Math.round(anchor.y * 2) / 2;
      if (x !== written[slot] || y !== written[slot + 1]) {
        written[slot] = x;
        written[slot + 1] = y;
        button.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
      }
    }
  }, [environment]);

  useImperativeHandle(ref, () => ({ sync: project }), [project]);

  useEffect(() => {
    if (!tracking || !environment) return;
    let frame = 0;
    const tick = () => {
      project();
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [tracking, environment, project]);

  return <div className={`legacy-labels${hidden ? " is-hidden" : ""}`} role="group" aria-label={LEGACY_COPY.title}>
    {LEGACY_LANDMARKS.map((id, index) => {
      const copy = LEGACY_COPY.landmarks[id];
      const summary = summaries[id];
      return <button
        key={id}
        ref={(element) => { buttons.current[index] = element; }}
        type="button"
        className={`legacy-label${selected === id ? " is-selected" : ""}${hovered === id ? " is-hovered" : ""}`}
        data-nav
        data-landmark={id}
        data-visible="false"
        tabIndex={selected === id ? 0 : -1}
        aria-label={`${copy.title}. ${summary.status}`}
        aria-description={copy.action}
        onFocus={() => onSelect(id)}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") onHover(id); }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") onHover(null); }}
        onClick={() => onOpen(id)}
      >
        <span className="legacy-label-heading">
          <span className="legacy-label-title">{copy.title}</span>
          {summary.badge ? <span className="legacy-label-badge" aria-hidden="true">{summary.badge}</span> : null}
        </span>
        <span className="legacy-label-status">{summary.status}</span>
      </button>;
    })}
  </div>;
});
