import { forwardRef } from "react";
import { LEGACY_COPY } from "../../../shared/legacy/content/copy";
import type { LegacyPreviewListing } from "../../../shared/legacy/domain/fixtures";

interface RecoveryPanelProps {
  reason: string;
  error: string;
  onReplace(): void;
  onGuest(): void;
}

/** Shown when the stored banner cannot be read. Nothing here writes or removes the stored record. */
export const RecoveryPanel = forwardRef<HTMLElement, RecoveryPanelProps>(function RecoveryPanel({ reason, error, onReplace, onGuest }, ref) {
  const future = reason === "future-version";
  const copy = LEGACY_COPY.invalidSave;
  return <section ref={ref} className="legacy-card legacy-recovery" aria-labelledby="legacy-recovery-title" data-recovery={reason}>
    <header className="legacy-card-header">
      <p className="legacy-eyebrow">{LEGACY_COPY.title}</p>
      <h2 id="legacy-recovery-title">{future ? LEGACY_COPY.futureSave.title : copy.title}</h2>
      <p className="legacy-step-hint">{future ? LEGACY_COPY.futureSave.body : copy.body}</p>
    </header>
    <div className="legacy-card-body">
      <details className="legacy-details">
        <summary data-nav>{copy.details}</summary>
        <p className="legacy-muted">{error}</p>
      </details>
      <p className="legacy-fineprint">{future ? LEGACY_COPY.futureSave.replaceNote : copy.startNewNote}</p>
      <footer className="legacy-card-actions">
        <button type="button" className="legacy-button" data-nav data-nav-default onClick={onGuest}>{copy.guest}</button>
        <button type="button" className="legacy-button legacy-button--primary" data-nav onClick={onReplace}>{copy.startNew}</button>
      </footer>
    </div>
  </section>;
});

interface PreviewMissingPanelProps {
  error: string;
  previews: readonly LegacyPreviewListing[];
  onGuest(): void;
}

/** ?legacyPreview named no known fixture: list the real previews and offer a guest banner. */
export const PreviewMissingPanel = forwardRef<HTMLElement, PreviewMissingPanelProps>(function PreviewMissingPanel({ error, previews, onGuest }, ref) {
  return <section ref={ref} className="legacy-card legacy-recovery" aria-labelledby="legacy-preview-missing-title" data-preview-missing>
    <header className="legacy-card-header">
      <p className="legacy-eyebrow">{LEGACY_COPY.preview.label}</p>
      <h2 id="legacy-preview-missing-title">{LEGACY_COPY.preview.listTitle}</h2>
      <p className="legacy-step-hint">{error}</p>
    </header>
    <div className="legacy-card-body">
      <ul className="legacy-preview-list">
        {previews.map((preview) => <li key={preview.id}>
          <a href={`?legacyPreview=${encodeURIComponent(preview.id)}`} data-nav>{preview.title}</a>
          <span className="legacy-muted">{preview.description}</span>
        </li>)}
      </ul>
      <footer className="legacy-card-actions">
        <button type="button" className="legacy-button legacy-button--primary" data-nav data-nav-default onClick={onGuest}>{LEGACY_COPY.invalidSave.guest}</button>
      </footer>
    </div>
  </section>;
});
