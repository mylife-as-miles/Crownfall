import type { RefObject } from "react";
import type { SettingsCategory } from "./settings-types";
import { SETTINGS_CATEGORIES } from "../../shared/menu/content";
import "./SettingsGrid.css";
// Keep the existing desktop import path available for callers.
export { SETTINGS_CATEGORIES } from "../../shared/menu/content";

interface SettingsGridProps {
  selected: number;
  onSelect(index: number): void;
  onActivate(index: number): void;
  buttonRefs: RefObject<(HTMLButtonElement | null)[]>;
}

function Gear({ small = false, large = false }: { small?: boolean; large?: boolean }) {
  return <g transform={small ? "translate(69 28) scale(.44)" : `translate(48 51) scale(${large ? "1.1" : ".76"})`}>
    {Array.from({ length: 12 }, (_, index) => <rect key={index} x="-5.2" y="-42" width="10.4" height="17" rx="2" transform={`rotate(${index * 30})`} />)}
    <path fillRule="evenodd" d="M 0,-32 a32,32 0 1,1 0,64 a32,32 0 1,1 0,-64 M 0,-20 a20,20 0 1,0 0,40 a20,20 0 1,0 0,-40" />
  </g>;
}

function CategoryIcon({ category }: { category: SettingsCategory }) {
  return <svg className={`settings-tile-icon settings-tile-icon--${category}`} viewBox="0 0 100 100" aria-hidden="true">
    {category === "general" && <Gear large />}
    {category === "controls" && <><Gear /><Gear small /></>}
    {category === "input" && <>
      <path d="M28 30h44c12 0 18 12 22 35 3 16-7 22-16 11L66 63H34L22 76C13 87 3 81 6 65c4-23 10-35 22-35Z" />
      <path className="settings-icon-cutout" d="M26 39h7v9h9v7h-9v9h-7v-9h-9v-7h9z" />
      <circle className="settings-icon-cutout" cx="74" cy="44" r="4.5" /><circle className="settings-icon-cutout" cx="84" cy="54" r="4.5" />
    </>}
    {category === "video" && <>
      <rect x="8" y="26" width="84" height="50" rx="4" /><rect className="settings-icon-cutout" x="18" y="36" width="64" height="29" rx="3" />
      <circle cx="34" cy="50.5" r="11" /><circle cx="66" cy="50.5" r="11" /><path d="M34 41h32v19H34z" />
      <circle className="settings-icon-cutout" cx="34" cy="50.5" r="6.5" /><circle className="settings-icon-cutout" cx="66" cy="50.5" r="6.5" />
    </>}
    {category === "audio" && <>{[14, 28, 43, 57, 66, 57, 43, 28, 14].map((height, index) => <rect key={index} x={6 + index * 10} y={51 - height / 2} width="6.4" height={height} rx="2" />)}</>}
    {category === "credits" && <><rect x="7" y="34" width="21" height="33" /><rect x="35" y="23" width="30" height="55" /><rect x="72" y="34" width="21" height="33" /></>}
  </svg>;
}

export function SettingsGrid({ selected, onSelect, onActivate, buttonRefs }: SettingsGridProps) {
  return <section className="settings-grid" aria-label="Settings categories">
    {SETTINGS_CATEGORIES.map((category, index) => <button
      key={category}
      ref={(element) => { buttonRefs.current[index] = element; }}
      type="button"
      className={`settings-tile${selected === index ? " is-selected" : ""}`}
      tabIndex={selected === index ? 0 : -1}
      aria-label={category[0].toUpperCase() + category.slice(1)}
      onFocus={() => onSelect(index)}
      onPointerEnter={() => onSelect(index)}
      onClick={() => { onSelect(index); onActivate(index); }}
    >
      <span className="settings-tile-title">{category}</span>
      <CategoryIcon category={category} />
    </button>)}
  </section>;
}
