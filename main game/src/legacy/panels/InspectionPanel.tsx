import { forwardRef, useCallback, useState } from "react";
import type { ReactNode } from "react";
import { LEGACY_COPY } from "../../../../shared/legacy/content/copy";
import { LEGACY_LANDMARKS } from "../../../../shared/legacy/environment-contract";
import type { LandmarkId } from "../../../../shared/legacy/types";
import { DESKTOP_LEGACY_COPY as UI } from "../desktop-copy";
import { useScrollEdges } from "../scroll-edges";

interface InspectionPanelProps {
  landmark: LandmarkId;
  onClose(): void;
  onCycle(delta: 1 | -1): void;
  children: ReactNode;
}

function neighbour(landmark: LandmarkId, delta: 1 | -1): LandmarkId {
  const index = LEGACY_LANDMARKS.indexOf(landmark);
  return LEGACY_LANDMARKS[(index + delta + LEGACY_LANDMARKS.length) % LEGACY_LANDMARKS.length];
}

/** The contextual inspection frame shared by the four landmarks. */
export const InspectionPanel = forwardRef<HTMLElement, InspectionPanelProps>(function InspectionPanel({ landmark, onClose, onCycle, children }, ref) {
  const copy = LEGACY_COPY.landmarks[landmark];
  const previous = neighbour(landmark, -1);
  const next = neighbour(landmark, 1);
  const [body, setBody] = useState<{ element: HTMLDivElement | null; phase: boolean }>({ element: null, phase: false });
  const bindBody = useCallback((element: HTMLDivElement | null) => {
    // A keyed body preserves the old scroll/input reset boundary. Ignore the
    // transient null ref, including StrictMode's detach/reattach of the same
    // node, and restart the same entry animation only for a genuinely new body.
    if (element) setBody((previous) => previous.element === element ? previous : { element, phase: !previous.phase });
  }, []);
  useScrollEdges(body.element);
  return <section ref={ref} className={`legacy-panel legacy-panel--${landmark}`} style={{ animationName: body.phase ? "legacy-panel-in" : "legacy-panel-in-alt" }} aria-labelledby="legacy-panel-title" data-landmark-panel={landmark}>
    <header className="legacy-panel-header">
      <p className="legacy-eyebrow">{UI.bannerhold}</p>
      <h2 id="legacy-panel-title">{copy.title}</h2>
      <p className="legacy-panel-lede">{copy.description}</p>
      <button type="button" className="legacy-panel-close" aria-label={UI.close} onClick={onClose}><span aria-hidden="true">×</span></button>
    </header>
    <div key={landmark} ref={bindBody} className="legacy-panel-body legacy-scroll-fade">{children}</div>
    <footer className="legacy-panel-footer">
      <button type="button" className="legacy-panel-cycle" onClick={() => onCycle(-1)}><span className="controller-key legacy-key" aria-hidden="true">LB</span><span className="legacy-panel-cycle-name">{LEGACY_COPY.landmarks[previous].title}</span></button>
      <button type="button" className="legacy-panel-cycle legacy-panel-cycle--next" onClick={() => onCycle(1)}><span className="legacy-panel-cycle-name">{LEGACY_COPY.landmarks[next].title}</span><span className="controller-key legacy-key" aria-hidden="true">RB</span></button>
    </footer>
  </section>;
});

/** A ledger-style key/value row. */
export function LedgerRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="legacy-ledger-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function PanelSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`legacy-section${className ? ` ${className}` : ""}`}>
    <h3 className="legacy-section-title">{title}</h3>
    {children}
  </section>;
}
