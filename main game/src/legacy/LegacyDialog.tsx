import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { Direction } from "../settings-types";
import type { LegacyWagerTerms } from "../../../shared/legacy/content/copy";
import { WagerTerms } from "./LegacyTerms";

export interface LegacyDialogContent {
  title: string;
  body: string;
  note?: string;
  /** A readiness warning shown above the terms (for example, no Pawn has been named yet). */
  warning?: string;
  /** A challenge's wager as its stated terms. */
  terms?: { heading: string; terms: LegacyWagerTerms };
  confirmLabel: string;
  cancelLabel: string;
  /** An alternative to confirming, such as opening the Muster Grounds first. */
  alternate?: { label: string; onSelect(): void };
  /** Destructive confirmations start on Cancel. */
  destructive?: boolean;
}

export interface LegacyDialogHandle {
  move(direction: Direction | "first" | "last"): void;
  activate(): void;
}

interface LegacyDialogProps {
  content: LegacyDialogContent;
  onConfirm(): void;
  onCancel(): void;
  reducedMotion: boolean;
}

/**
 * Native modal confirmation in the shared menu dialog's visual language, with
 * Legacy content. Mounted only while a confirmation is open; closing it while
 * still attached lets the browser return focus to the control that opened it.
 */
export const LegacyDialog = forwardRef<LegacyDialogHandle, LegacyDialogProps>(function LegacyDialog({ content, onConfirm, onCancel, reducedMotion }, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const alternateRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pointerStartedOutside = useRef(false);
  const destructive = content.destructive === true;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    (destructive ? cancelRef.current : confirmRef.current)?.focus({ preventScroll: true });
    return () => { if (dialog.open) dialog.close(); };
  }, [destructive]);

  useImperativeHandle(ref, () => {
    const buttons = () => [confirmRef.current, alternateRef.current, cancelRef.current].filter((button): button is HTMLButtonElement => button !== null);
    return {
      move(direction) {
        const list = buttons();
        if (direction === "first" || direction === "last") {
          list[direction === "first" ? 0 : list.length - 1]?.focus({ preventScroll: true });
          return;
        }
        const index = list.indexOf(document.activeElement as HTMLButtonElement);
        const delta = direction === "left" || direction === "up" ? -1 : 1;
        list[Math.max(0, Math.min(list.length - 1, index < 0 ? 0 : index + delta))]?.focus({ preventScroll: true });
      },
      activate() {
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement && buttons().includes(active)) active.click();
        else (destructive ? cancelRef.current : confirmRef.current)?.click();
      },
    };
  }, [destructive]);

  return <dialog
    ref={dialogRef}
    className={`legacy-dialog${reducedMotion ? " legacy-dialog--still" : ""}`}
    aria-labelledby="legacy-dialog-title"
    aria-describedby="legacy-dialog-body"
    onCancel={(event) => { event.preventDefault(); onCancel(); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const first = confirmRef.current, last = cancelRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onPointerDown={(event) => { pointerStartedOutside.current = event.target === event.currentTarget; }}
    onClick={(event) => {
      const outside = event.target === event.currentTarget && pointerStartedOutside.current;
      pointerStartedOutside.current = false;
      if (outside) onCancel();
    }}
  >
    <div className="legacy-dialog-inner">
      <h2 id="legacy-dialog-title">{content.title}</h2>
      <p id="legacy-dialog-body">{content.body}</p>
      {content.warning && <p className="legacy-dialog-warning" role="note" data-dialog-warning>{content.warning}</p>}
      {content.terms && <WagerTerms heading={content.terms.heading} terms={content.terms.terms} level={3} />}
      {content.note && <p className="legacy-dialog-note">{content.note}</p>}
      <div className="legacy-dialog-actions">
        <button ref={confirmRef} type="button" className={content.destructive ? "is-destructive" : undefined} data-nav onClick={onConfirm}>
          <span className="legacy-key" aria-hidden="true">A</span>{content.confirmLabel}
        </button>
        {content.alternate && <button ref={alternateRef} type="button" className="is-alternate" data-nav data-dialog-alternate onClick={content.alternate.onSelect}>{content.alternate.label}</button>}
        <button ref={cancelRef} type="button" data-nav onClick={onCancel}>
          <span className="legacy-key" aria-hidden="true">B</span>{content.cancelLabel}
        </button>
      </div>
    </div>
  </dialog>;
});
