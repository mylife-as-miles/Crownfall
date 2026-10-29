import { forwardRef, useCallback, useState } from "react";
import { LEGACY_COPY } from "../../../shared/legacy/content/copy";
import type { ChronicleEntry } from "../../../shared/legacy/types";
import { useScrollEdges } from "./scroll-edges";

interface AftermathCardProps {
  entries: readonly ChronicleEntry[];
  onDismiss(): void;
}

/** At most two prominent consequences, shown on return; every fact stays in the War Record. */
export const AftermathCard = forwardRef<HTMLElement, AftermathCardProps>(function AftermathCard({ entries, onDismiss }, ref) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const attach = useCallback((node: HTMLElement | null) => {
    setElement(node);
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  useScrollEdges(element);
  if (entries.length === 0) return null;
  return <aside ref={attach} className="legacy-aftermath legacy-scroll-fade" aria-labelledby="legacy-aftermath-title" data-aftermath-count={entries.length}>
    <p className="legacy-eyebrow" id="legacy-aftermath-title">{LEGACY_COPY.aftermath.title}</p>
    {entries.slice(0, 2).map((entry) => <article key={entry.id} className={`legacy-aftermath-entry legacy-aftermath-entry--${entry.kind}`} data-aftermath={entry.kind}>
      <p className="legacy-aftermath-heading">{LEGACY_COPY.aftermath.headings[entry.kind]}</p>
      <p className="legacy-entry-title">{entry.title}</p>
      <p className="legacy-muted">{entry.body}</p>
    </article>)}
    <p className="legacy-fineprint">{LEGACY_COPY.aftermath.allRecorded}</p>
    <button type="button" className="legacy-button legacy-button--primary" data-nav data-nav-default onClick={onDismiss}>{LEGACY_COPY.aftermath.dismiss}</button>
  </aside>;
});
