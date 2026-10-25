import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  BINDING_LABELS, DEFAULT_BINDINGS, keyLabel,
  type BindingAction, type MenuBindings, type SettingsPageHandle,
} from "./settings-types";
import "./ControlsPanel.css";

interface ControlsPanelProps {
  bindings: MenuBindings;
  onChange(bindings: MenuBindings): void;
  onBack(): void;
}

const actions = Object.keys(DEFAULT_BINDINGS) as BindingAction[];
const descriptions: Record<BindingAction, string> = {
  left: "Move to the option on the left. In a settings list, decrease the selected value.",
  right: "Move to the option on the right. In a settings list, increase the selected value.",
  up: "Move to the option above, or the previous settings row.",
  down: "Move to the option below, or the next settings row.",
  select: "Open the selected card, settings category, or control. Enter and Space also activate focused buttons.",
  back: "Return to the previous menu. Escape always remains available as a way back.",
  previousTab: "Switch to the previous main menu tab.",
  nextTab: "Switch to the next main menu tab.",
  first: "Focus the first option in the current menu.",
  last: "Focus the last option in the current menu.",
};
const allowedCode = /^(Arrow(?:Left|Right|Up|Down)|Key[A-Z]|Digit[0-9]|Enter|Space|Escape|Home|End|Backspace|Delete|PageUp|PageDown)$/;

export const ControlsPanel = forwardRef<SettingsPageHandle, ControlsPanelProps>(function ControlsPanel({ bindings, onChange, onBack }, ref) {
  const [selected, setSelected] = useState(0);
  const [capturing, setCapturing] = useState<BindingAction | null>(null);
  const [message, setMessage] = useState("");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(actions.length - 1, index));
    setSelected(next);
    buttons.current[next]?.focus({ preventScroll: true });
    buttons.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };
  const reset = () => {
    onChange({ ...DEFAULT_BINDINGS });
    setCapturing(null);
    setMessage("Default menu controls restored.");
  };
  const beginCapture = (action: BindingAction) => {
    setCapturing(action);
    setMessage("Press a key. Escape cancels.");
    buttons.current[actions.indexOf(action)]?.focus({ preventScroll: true });
  };
  useImperativeHandle(ref, () => ({
    move(direction) {
      if (capturing) return;
      focusRow(selected + (direction === "up" ? -1 : direction === "down" ? 1 : 0));
    },
    activate() { if (!capturing) beginCapture(actions[selected]); },
    reset,
    focus() { focusRow(selected); },
    edge(last) { if (!capturing) focusRow(last ? actions.length - 1 : 0); },
    cancel() {
      if (!capturing) return false;
      setCapturing(null);
      setMessage("Binding unchanged.");
      return true;
    },
  }));

  return (
    <section
      className="settings-detail controls-detail"
      aria-label="Menu controls"
      onKeyDownCapture={(event) => {
        if (!capturing) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.code === "Escape") {
          setCapturing(null);
          setMessage("Binding unchanged.");
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || !allowedCode.test(event.code)) {
          setMessage("Choose a letter, number, arrow, or navigation key. Tab is reserved for focus.");
          return;
        }
        const conflict = actions.find((action) => action !== capturing && bindings[action] === event.code);
        if (conflict) {
          setMessage(`${keyLabel(event.code)} is already assigned to ${BINDING_LABELS[conflict].toLowerCase()}. Choose another key.`);
          return;
        }
        onChange({ ...bindings, [capturing]: event.code });
        setMessage(`${BINDING_LABELS[capturing]} assigned to ${keyLabel(event.code)}.`);
        setCapturing(null);
      }}
    >
      <div className="settings-detail-list controls-binding-list" aria-label="Keyboard bindings">
        {actions.map((action, index) => (
          <button
            key={action}
            ref={(button) => { buttons.current[index] = button; }}
            type="button"
            className={`settings-row controls-binding-row${selected === index ? " is-selected" : ""}${capturing === action ? " is-capturing" : ""}`}
            tabIndex={selected === index ? 0 : -1}
            aria-label={`${BINDING_LABELS[action]}: ${capturing === action ? "press a key" : keyLabel(bindings[action])}. Change binding`}
            aria-describedby="controls-row-description controls-binding-status"
            onFocus={() => setSelected(index)}
            onClick={() => { setSelected(index); beginCapture(action); }}
          >
            <span>{BINDING_LABELS[action]}</span>
            <span className="settings-value controls-binding-value">{capturing === action ? "..." : keyLabel(bindings[action])}</span>
          </button>
        ))}
      </div>
      <aside className="settings-detail-info">
        <h1 className="settings-description-title">{BINDING_LABELS[actions[selected]]}</h1>
        <p id="controls-row-description">{descriptions[actions[selected]]}</p>
        <p className="controls-binding-instructions">Select a binding, then press its new key. These controls apply to the Crownfall menu.</p>
        <p id="controls-binding-status" className="controls-binding-status" role="status" aria-live="polite">{message}</p>
      </aside>
      <footer className="settings-detail-footer">
        <button type="button" className="settings-footer-button" aria-label="Back" onClick={() => {
          if (capturing) { setCapturing(null); setMessage("Binding unchanged."); }
          else onBack();
        }}><span className="settings-footer-key" aria-hidden="true">B</span> Back</button>
        <button type="button" className="settings-footer-button" aria-label="Reset Defaults" onClick={reset}><span className="settings-footer-key" aria-hidden="true">Y</span> Reset Defaults</button>
        <span className="settings-footer-hint">Select a binding to change it</span>
      </footer>
    </section>
  );
});
