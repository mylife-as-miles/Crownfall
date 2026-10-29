import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { Direction } from "../settings-types";

export interface LegacyDialogContent {
  title: string;
  body: string;
  note?: string;
  /** Prominent text such as a challenge's wager, shown in a bordered terms block. */
  terms?: { heading: string; text: string };
  confirmLabel: string;
  cancelLabel: string;
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

  useImperativeHandle(ref, () => ({
    move(direction) {
      const first = direction === "left" || direction === "up" || direction === "first";
      (first ? confirmRef.current : cancelRef.current)?.focus({ preventScroll: true });
    },
    activate() {
      const active = document.activeElement;
      if (active === cancelRef.current) onCancel();
      else onConfirm();
    },
  }), [onCancel, onConfirm]);

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
      {content.terms && <section className="legacy-terms" aria-label={content.terms.heading}>
        <h3>{content.terms.heading}</h3>
        <p>{content.terms.text}</p>
      </section>}
      {content.note && <p className="legacy-dialog-note">{content.note}</p>}
      <div className="legacy-dialog-actions">
        <button ref={confirmRef} type="button" className={content.destructive ? "is-destructive" : undefined} data-nav onClick={onConfirm}>
          <span className="legacy-key" aria-hidden="true">A</span>{content.confirmLabel}
        </button>
        <button ref={cancelRef} type="button" data-nav onClick={onCancel}>
          <span className="legacy-key" aria-hidden="true">B</span>{content.cancelLabel}
        </button>
      </div>
    </div>
  </dialog>;
});
