import { useEffect, useEffectEvent, useRef } from "react";
import type { ReactNode } from "react";

/** Dispatched on a focused cycler by the Legacy input handle (keys, D-pad) with detail ±1. */
export const CYCLE_EVENT = "legacycycle";

export interface CyclerOption<T extends string> {
  value: T;
  label: string;
  /** Secondary words after the label (a tincture's plain colour); hidden in compact layouts, always spoken. */
  aside?: string;
  /** Optional colour swatch shown with the value (tinctures). */
  swatch?: string;
}

interface CyclerProps<T extends string> {
  id: string;
  label: string;
  options: readonly CyclerOption<T>[];
  value: T | null;
  /** Shown when `value` matches no option (for example, custom arms in the preset row). */
  fallbackLabel?: string;
  onChange(value: T): void;
  /** Mouse shortcut: a strip of every option's swatch. */
  showSwatches?: boolean;
  note?: ReactNode;
}

/**
 * A settings-style value row: left/right (keys, D-pad, the arrow buttons)
 * steps through the options; it is one navigation stop, like the Settings
 * detail rows, and exposes itself to assistive technology as a slider.
 */
export function Cycler<T extends string>({ id, label, options, value, fallbackLabel, onChange, showSwatches = false, note }: CyclerProps<T>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const index = options.findIndex((option) => option.value === value);
  const current = index >= 0 ? options[index] : null;
  const step = (delta: number) => {
    if (options.length === 0) return;
    const start = index >= 0 ? index : delta > 0 ? -1 : 0;
    const next = options[(start + delta + options.length) % options.length];
    onChange(next.value);
  };
  const onCycle = useEffectEvent((delta: number) => step(delta));

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const listener = (event: Event) => {
      onCycle(event instanceof CustomEvent && typeof event.detail === "number" ? event.detail : 1);
    };
    row.addEventListener(CYCLE_EVENT, listener);
    return () => row.removeEventListener(CYCLE_EVENT, listener);
  }, []);

  const text = current ? current.label : fallbackLabel ?? "";
  const spoken = current?.aside ? `${text}, ${current.aside}` : text;
  return <div className={`legacy-cycler${showSwatches ? " has-swatches" : ""}`}>
    <div
      ref={rowRef}
      id={id}
      className="legacy-cycler-row"
      role="slider"
      tabIndex={0}
      data-nav
      data-cycler
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, options.length - 1)}
      aria-valuenow={Math.max(0, index)}
      aria-valuetext={spoken}
    >
      <span className="legacy-cycler-label">{label}</span>
      <span className="legacy-cycler-control">
        <button type="button" tabIndex={-1} className="legacy-cycler-step" aria-label={`Previous ${label.toLowerCase()}`} onClick={() => step(-1)}>‹</button>
        <span className="legacy-cycler-value">
          {current?.swatch && <span className="legacy-swatch" style={{ background: current.swatch }} aria-hidden="true" />}
          <span>{text}{current?.aside && <span className="legacy-cycler-aside"> · {current.aside}</span>}</span>
        </span>
        <button type="button" tabIndex={-1} className="legacy-cycler-step" aria-label={`Next ${label.toLowerCase()}`} onClick={() => step(1)}>›</button>
      </span>
    </div>
    {showSwatches && <div className="legacy-swatch-strip" aria-hidden="true">
      {options.map((option) => <button
        key={option.value}
        type="button"
        tabIndex={-1}
        className={`legacy-swatch-pick${option.value === value ? " is-current" : ""}`}
        style={{ background: option.swatch }}
        title={option.aside ? `${option.label} · ${option.aside}` : option.label}
        onClick={() => onChange(option.value)}
      />)}
    </div>}
    {note && <p className="legacy-cycler-note">{note}</p>}
  </div>;
}
