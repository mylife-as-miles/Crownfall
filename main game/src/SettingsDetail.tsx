import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ControlsPanel } from "./ControlsPanel";
import { InputDiagram } from "./InputDiagram";
import { INITIAL_PREFERENCES, type Direction, type FrameLimit, type Preferences, type Quality, type SettingsCategory, type SettingsPageHandle } from "./settings-types";
import "./SettingsDetail.css";

export interface SettingsDetailProps {
  category: SettingsCategory;
  preferences: Preferences;
  onChange(preferences: Preferences): void;
  onBack(): void;
}

interface SettingsRow {
  id: string;
  label: string;
  value: string;
  description: string;
  section?: string;
  kind?: "toggle" | "choice" | "range" | "fullscreen";
  number?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string; disabled?: boolean }[];
  selectedValue?: string;
  change?(value: string | number | boolean): void;
  adjust?(direction: number): void;
}

function cycle<T>(values: readonly T[], current: T, direction: number): T {
  return values[(values.indexOf(current) + direction + values.length) % values.length];
}

const PreferencePage = forwardRef<SettingsPageHandle, SettingsDetailProps>(function PreferencePage({ category, preferences, onChange, onBack }, ref) {
  const [active, setActive] = useState(0);
  const [viewport, setViewport] = useState(() => `${window.innerWidth} × ${window.innerHeight}`);
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement);
  const [fullscreenError, setFullscreenError] = useState("");
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const p = preferences;
  const update = (patch: Partial<Preferences>) => onChange({ ...p, ...patch });

  useEffect(() => {
    const resize = () => setViewport(`${window.innerWidth} × ${window.innerHeight}`);
    const change = () => setFullscreen(!!document.fullscreenElement);
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", change);
    return () => { window.removeEventListener("resize", resize); document.removeEventListener("fullscreenchange", change); };
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled) await document.documentElement.requestFullscreen();
      else setFullscreenError("Fullscreen is unavailable in this browser.");
    } catch {
      setFullscreenError("The browser did not allow fullscreen. Try the on-screen button.");
    }
  };

  let rows: SettingsRow[];
  if (category === "general") {
    rows = [
      { id: "language", label: "Language", value: "English", description: "Crownfall’s menu is currently available in English. Additional translations are not included in this build." },
      { id: "ambient-motion", label: "Ambient Motion", value: p.motion ? "On" : "Off", kind: "toggle", change: () => update({ motion: !p.motion }), adjust: () => update({ motion: !p.motion }), description: "Animate the sorcerer and ambient particles. Your device’s reduced-motion preference always takes priority." },
      { id: "show-hints", label: "Control Hints", value: p.showHints ? "On" : "Off", kind: "toggle", change: () => update({ showHints: !p.showHints }), adjust: () => update({ showHints: !p.showHints }), description: "Show the control prompts along the bottom of the menu." },
      { id: "save-preferences", label: "Save Preferences", value: "Automatic", description: "Menu preferences are saved automatically on this device. Browser storage must be available to keep them between visits." },
    ];
  } else if (category === "video") {
    const qualityOptions = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];
    const isPreset = p.renderScale === { low: 75, medium: 90, high: 100 }[p.quality];
    const setQuality = (quality: Quality) => update({ quality, renderScale: { low: 75, medium: 90, high: 100 }[quality] });
    rows = [
      { id: "screen-resolution", label: "Screen Resolution", value: viewport, section: "General Settings", description: "The menu follows the size of your browser window. Change the window size or enter fullscreen to change the available display area." },
      { id: "window-mode", label: "Window Mode", value: fullscreen ? "Fullscreen" : "Windowed", kind: "fullscreen", change: () => { void toggleFullscreen(); }, adjust: () => { void toggleFullscreen(); }, description: fullscreenError || "Switch between the browser window and fullscreen. Browser permissions and a direct button press may be required." },
      { id: "resolution-scale", label: "Resolution Scale", value: `${p.renderScale}`, kind: "range", number: p.renderScale, min: 50, max: 100, step: 5, change: (value) => update({ renderScale: Number(value) }), adjust: (direction) => update({ renderScale: Math.max(50, Math.min(100, p.renderScale + direction * 5)) }), description: "Adjust the internal rendering resolution of the sorcerer and particles. Lower values can improve performance. Menu text and artwork stay sharp." },
      { id: "dynamic-resolution", label: "Dynamic Resolution", value: "Not used", description: "This menu uses the resolution scale you choose. Automatic resolution scaling is not implemented." },
      { id: "vertical-sync", label: "Vertical Sync", value: "Browser controlled", description: "Frame presentation is managed by your browser and display. A separate vertical-sync switch is unavailable." },
      { id: "frame-limit", label: "Frame Rate Limit", value: p.frameLimit === 0 ? "Unlimited" : String(p.frameLimit), kind: "choice", options: [{ value: "0", label: "Unlimited" }, { value: "30", label: "30" }, { value: "60", label: "60" }, { value: "120", label: "120" }], change: (value) => update({ frameLimit: Number(value) as FrameLimit }), adjust: (direction) => update({ frameLimit: cycle<FrameLimit>([0, 30, 60, 120], p.frameLimit, direction) }), description: "Limit scene updates to reduce rendering work. The actual frame rate also depends on your device and browser." },
      { id: "overall-quality", label: "Overall Quality", section: "Graphic Settings", value: isPreset ? p.quality[0].toUpperCase() + p.quality.slice(1) : "Custom", selectedValue: isPreset ? p.quality : "custom", kind: "choice", options: [...(!isPreset ? [{ value: "custom", label: "Custom", disabled: true }] : []), ...qualityOptions], change: (value) => setQuality(value as Quality), adjust: (direction) => setQuality(cycle<Quality>(["low", "medium", "high"], p.quality, direction)), description: "Choose a preset for particle density and scene resolution. Low uses 75% resolution, Medium 90%, and High 100%. Custom means you have adjusted these settings separately." },
      { id: "particle-quality", label: "Particle Quality", value: p.quality[0].toUpperCase() + p.quality.slice(1), kind: "choice", options: qualityOptions, change: (value) => update({ quality: value as Quality }), adjust: (direction) => update({ quality: cycle<Quality>(["low", "medium", "high"], p.quality, direction) }), description: "Set the density of ambient sparks, wisps, and floating particles. Reduced motion pauses their movement." },
      { id: "anti-aliasing", label: "Anti-Aliasing", value: "Enabled", description: "The scene renderer uses anti-aliasing. Changing this option would require recreating the renderer, so it is fixed for this build." },
      { id: "texture-quality", label: "Texture Quality", value: "Included textures", description: "The menu uses the supplied optimized textures. Alternate quality levels are not included." },
      { id: "shadow-quality", label: "Shadow Quality", value: "Not used", description: "The menu uses a composed lighting setup without a real-time shadow map. There is no shadow quality level to adjust." },
      { id: "foliage-quality", label: "Foliage Quality", value: "Not used", description: "Card environments are still artwork. This menu does not render a foliage system." },
      { id: "global-illumination", label: "Global Illumination", value: "Environment lighting", description: "The sorcerer uses environment and scene lighting. Real-time global illumination is not implemented." },
    ];
  } else if (category === "audio") {
    rows = [
      { id: "audio-device", label: "Audio Device", value: "System default", description: "Audio output is managed by your browser and operating system. This menu does not request access to your audio devices." },
      { id: "master-volume", label: "Master Volume", value: `${p.volume}`, kind: "range", number: p.volume, min: 0, max: 100, step: 1, change: (value) => update({ volume: Number(value) }), adjust: (direction) => update({ volume: Math.max(0, Math.min(100, p.volume + direction * 5)) }), description: "Save your preferred volume on this device. Audio playback is not connected in this menu yet, so this setting currently has no audible effect." },
      { id: "sfx-volume", label: "SFX Volume", value: "Unavailable", description: "Menu sound effects are not connected in this build." },
      { id: "music-volume", label: "Music Volume", value: "Unavailable", description: "A music track is not connected in this build." },
      { id: "dialogue-volume", label: "Dialogue Volume", value: "Unavailable", description: "This menu does not include dialogue playback." },
      { id: "music", label: "Music", value: "Unavailable", description: "Music playback is not connected in this build." },
    ];
  } else {
    rows = [
      { id: "project", label: "Project", value: "Crownfall", description: "Crownfall — King’s Gambit. A standalone main-menu preview for the Crownfall project." },
      { id: "artwork", label: "Artwork & Sorcerer", value: "Supplied assets", description: "The card artwork, Home artwork, and animated sorcerer were supplied for this project." },
      { id: "technology", label: "Built With", value: "React · TypeScript · Three.js", description: "The interface uses React and TypeScript. The sorcerer and particle scene use Three.js and custom shaders." },
      { id: "typeface", label: "Typefaces", value: "Barlow", description: "Barlow and Barlow Condensed. Distributed under the SIL Open Font License; the license is included with this build." },
      { id: "licenses", label: "Open Source", value: "License notices", description: "Project code is licensed under MIT. Bundled font and Draco decoder license notices are included with their assets." },
    ];
  }

  const selectRow = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setActive(next);
    rowRefs.current[next]?.focus({ preventScroll: true });
    rowRefs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };
  const reset = () => {
    if (category === "general") update({ motion: INITIAL_PREFERENCES.motion, showHints: INITIAL_PREFERENCES.showHints });
    if (category === "video") update({ quality: INITIAL_PREFERENCES.quality, renderScale: INITIAL_PREFERENCES.renderScale, frameLimit: INITIAL_PREFERENCES.frameLimit });
    if (category === "audio") update({ volume: INITIAL_PREFERENCES.volume });
  };
  useImperativeHandle(ref, () => ({
    edge(last: boolean) { selectRow(last ? rows.length - 1 : 0); },
    move(direction: Direction) {
      if (direction === "up" || direction === "down") selectRow(active + (direction === "up" ? -1 : 1));
      else rows[active]?.adjust?.(direction === "left" ? -1 : 1);
    },
    activate() { rows[active]?.adjust?.(1); },
    reset,
    focus() { selectRow(active); },
    cancel() { return false; },
  }));
  const current = rows[active] || rows[0];
  const mutable = category !== "credits";

  return <section className={`settings-detail settings-detail--${category}`} aria-label={`${category[0].toUpperCase() + category.slice(1)} settings`}>
    <div className="settings-detail-list" role="group" aria-label={`${category} options`}>
      {rows.map((row, index) => <div key={row.id}>
        {row.section && <h2 className="settings-section-heading">{row.section}</h2>}
        <div
          ref={(element) => { rowRefs.current[index] = element; }}
          className={`settings-row${active === index ? " is-selected" : ""}${!row.kind ? " is-readonly" : ""}`}
          tabIndex={active === index ? 0 : -1}
          onFocus={() => setActive(index)}
          onClick={(event) => { setActive(index); if (event.target === event.currentTarget) rowRefs.current[index]?.focus({ preventScroll: true }); }}
          aria-label={`${row.label}: ${row.value}${row.kind ? "" : ", read only"}`}
          aria-describedby={active === index ? "settings-description" : undefined}
          data-setting={row.id}
        >
          <span className="settings-row-label">{row.label}</span>
          <div className={`settings-value${row.kind ? " is-adjustable" : ""}`}>
            {row.kind === "choice" ? <>
              <button className="settings-step" type="button" aria-label={`Decrease ${row.label}`} onClick={() => row.adjust?.(-1)}>−</button>
              <select aria-label={row.label} id={row.id === "particle-quality" ? "effect-quality" : row.id} value={row.selectedValue || (row.id === "frame-limit" ? String(p.frameLimit) : p.quality)} onChange={(event) => row.change?.(event.target.value)}>
                {row.options?.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
              </select>
              <button className="settings-step" type="button" aria-label={`Increase ${row.label}`} onClick={() => row.adjust?.(1)}>+</button>
            </> : row.kind === "toggle" ? <>
              <button className="settings-step" type="button" aria-label={`Toggle ${row.label}`} onClick={() => row.adjust?.(-1)}>−</button>
              <button className="settings-toggle" id={row.id === "ambient-motion" ? "motion-toggle" : row.id} type="button" role="switch" aria-checked={row.value === "On"} aria-label={row.label} onClick={() => row.change?.(row.value !== "On")}>{row.value}</button>
              <button className="settings-step" type="button" aria-label={`Toggle ${row.label}`} onClick={() => row.adjust?.(1)}>+</button>
            </> : row.kind === "range" ? <>
              <output htmlFor={row.id === "master-volume" ? "ambient-volume" : row.id}>{row.value}</output>
              <input aria-label={row.label} id={row.id === "master-volume" ? "ambient-volume" : row.id} type="range" value={row.number} min={row.min} max={row.max} step={row.step} onChange={(event) => row.change?.(Number(event.target.value))} />
            </> : row.kind === "fullscreen" ? <button className="settings-fullscreen" type="button" aria-label="Change window mode" onClick={() => row.change?.(true)}>{row.value}<span aria-hidden="true">+</span></button> : <span className="settings-readonly-value">{row.value}</span>}
          </div>
        </div>
      </div>)}
    </div>
    <aside className="settings-detail-info" aria-live="polite">
      <h1 className="settings-description-title">{current.label}</h1>
      <p id="settings-description">{current.description}</p>
      {category === "general" && current.id === "language" && <div className="settings-language-list"><p>Available languages:</p><p>· English</p></div>}
    </aside>
    <footer className="settings-detail-footer">
      <button type="button" className="settings-footer-button" aria-label="Back" onClick={onBack}><span className="settings-prompt" aria-hidden="true">B</span>Back</button>
      {mutable && <button type="button" className="settings-footer-button" aria-label="Reset Defaults" onClick={reset}><span className="settings-prompt" aria-hidden="true">Y</span>Reset Defaults</button>}
      {mutable && <span className="settings-footer-hint"><span className="settings-direction" aria-hidden="true">← →</span>Adjust</span>}
    </footer>
  </section>;
});

export const SettingsDetail = forwardRef<SettingsPageHandle, SettingsDetailProps>(function SettingsDetail(props, ref) {
  if (props.category === "controls") return <ControlsPanel ref={ref} bindings={props.preferences.bindings} onChange={(bindings) => props.onChange({ ...props.preferences, bindings })} onBack={props.onBack} />;
  if (props.category === "input") return <InputDiagram ref={ref} onBack={props.onBack} />;
  return <PreferencePage key={props.category} ref={ref} {...props} />;
});

export default SettingsDetail;
