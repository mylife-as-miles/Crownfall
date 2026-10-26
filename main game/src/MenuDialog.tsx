import { forwardRef, useEffect, useRef, useState } from "react";
import "./MenuDialog.css";

export type MenuDialogProps = {
  title: string;
  description: string;
  note?: string;
  panel: string;
  onConfirm: () => void;
  onCancel: () => void;
  reducedMotion: boolean;
};

const MenuDialog = forwardRef<HTMLDialogElement, MenuDialogProps>(
  function MenuDialog(
    { title, description, note, panel, onConfirm, onCancel, reducedMotion },
    ref,
  ) {
    const pointerStartedOutside = useRef(false);
    const [systemReducedMotion, setSystemReducedMotion] = useState(() =>
      typeof window === "undefined"
        ? false
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );

    useEffect(() => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setSystemReducedMotion(query.matches);
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }, []);

    const still = reducedMotion || systemReducedMotion;

    return (
      <dialog
        ref={ref}
        className={`menu-dialog menu-dialog--reference${still ? " menu-dialog--still" : ""}`}
        data-panel={panel}
        aria-labelledby="dialog-heading"
        aria-describedby={
          note ? "dialog-description dialog-note" : "dialog-description"
        }
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
            ".dialog-actions button",
          );
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault();
            last.focus({ preventScroll: true });
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          onCancel();
        }}
        onPointerDown={(event) => {
          pointerStartedOutside.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          const outside =
            event.target === event.currentTarget &&
            pointerStartedOutside.current;
          pointerStartedOutside.current = false;
          if (outside) onCancel();
        }}
      >
        <div className="dialog-inner">
          <h1 id="dialog-heading">{title}</h1>
          <div className="dialog-copy">
            <p id="dialog-description" className="dialog-description">
              {description}
            </p>
            {note && (
              <p id="dialog-note" className="dialog-note">
                {note}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary-action"
              aria-label="Confirm"
              autoFocus
              onClick={onConfirm}
            >
              <span className="dialog-key" aria-hidden="true">A</span>
              Confirm
            </button>
            <button
              type="button"
              className="secondary-action"
              aria-label="Cancel"
              onClick={onCancel}
            >
              <span className="dialog-key" aria-hidden="true">B</span>
              Cancel
            </button>
          </div>
        </div>
      </dialog>
    );
  },
);

export default MenuDialog;
