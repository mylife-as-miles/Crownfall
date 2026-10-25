import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { SettingsPageHandle } from "./settings-types";
import "./Showcase.css";

export type ShowcaseView = "overview" | "battles" | "arenas" | "replays";
interface ShowcaseProps {
  view: ShowcaseView;
  onViewChange(view: ShowcaseView): void;
  onBackRoot(): void;
  reducedMotion: boolean;
}

const categories = [
  { id: "battles", title: "AI BATTLES", label: "AI Battles", status: "Cinematic library", description: "A front-row seat to the board.", art: "/assets/environments/card-new.webp" },
  { id: "arenas", title: "ARENAS", label: "Arenas", status: "Explore the artwork", description: "Discover the world around the board.", art: "/assets/environments/card-browse.webp" },
  { id: "replays", title: "MATCH REPLAYS", label: "Match Replays", status: "Future", description: "Every move. A story worth revisiting.", art: "" },
] as const;
const arenas = [
  { label: "Arena 01", source: "/assets/environments/card-new.webp", alt: "Luminous ruined landscape with a ferris wheel" },
  { label: "Arena 02", source: "/assets/environments/card-resume.webp", alt: "Blue gateway and floating architecture" },
  { label: "Arena 03", source: "/assets/environments/card-load.webp", alt: "Timber bridges and distant arches" },
  { label: "Arena 04", source: "/assets/environments/card-browse.webp", alt: "Crystal cliffs, dragons and towers" },
];

function ShowcaseIcon({ kind }: { kind: "battles" | "arenas" | "replays" }) {
  return <svg className={`showcase-icon showcase-icon--${kind}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    {kind === "battles" && <>
      <path d="M17 13 47 51M47 13 17 51M14 41l9 9M41 50l9-9M13 10l8 3-5 5-3-8ZM51 10l-8 3 5 5 3-8Z" />
      <path d="m32 5 4 7-4 7-4-7 4-7Z" className="showcase-icon-accent" />
    </>}
    {kind === "arenas" && <><path d="m8 46 15-28 12 20 8-12 13 20H8ZM15 51h34" /><path d="m23 18 2 14-9-1M43 26v12l-6-3" /><circle cx="45" cy="13" r="4" /></>}
    {kind === "replays" && <><path d="M14 13h36v39H14V13ZM22 13V7h20v6M14 24h36M24 32h16M24 39h16M24 46h10" /><path d="m44 52 4 5 9-11" className="showcase-icon-accent" /></>}
  </svg>;
}

function ArchiveArt() {
  return <span className="showcase-archive-art" aria-hidden="true">
    <span className="showcase-board-pattern" />
    <svg viewBox="0 0 160 160" className="showcase-archive-seal" fill="none">
      <path d="M80 18 123 43v50l-43 25-43-25V43l43-25Z" />
      <path d="m54 57 9 26h34l9-26-17 12-9-20-9 20-17-12ZM64 91h32M59 100h42" />
      <circle cx="80" cy="73" r="64" strokeDasharray="2 7" />
      <path d="M30 136h100M55 144h50" />
    </svg>
  </span>;
}

export default forwardRef<SettingsPageHandle, ShowcaseProps>(function Showcase({ view, onViewChange, onBackRoot, reducedMotion }, ref) {
  const [selected, setSelected] = useState(0);
  const [selectedArena, setSelectedArena] = useState(0);
  const [detailSelected, setDetailSelected] = useState(0);
  const overviewRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const arenaRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const exploreRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const clamp = (index: number, count: number) => Math.max(0, Math.min(count - 1, index));
  const chooseOverview = (index: number, focus = true) => {
    const next = clamp(index, categories.length);
    setSelected(next);
    if (focus) overviewRefs.current[next]?.focus({ preventScroll: true });
  };
  const chooseArena = (index: number, focus = true) => {
    const next = clamp(index, arenas.length);
    setSelectedArena(next);
    if (focus) arenaRefs.current[next]?.focus({ preventScroll: true });
  };
  const chooseDetail = (index: number) => {
    const next = clamp(index, 2);
    setDetailSelected(next);
    (next ? backRef.current : exploreRef.current)?.focus({ preventScroll: true });
  };
  const activate = () => {
    if (view === "overview") {
      setDetailSelected(0);
      onViewChange(categories[selected].id);
    }
    else if (view === "arenas") chooseArena(selectedArena);
    else if (detailSelected === 0) onViewChange("arenas");
    else onBackRoot();
  };
  useImperativeHandle(ref, () => ({
    move(direction) {
      const delta = direction === "left" || direction === "up" ? -1 : 1;
      if (view === "overview") chooseOverview(selected + delta);
      else if (view === "arenas") chooseArena(selectedArena + delta);
      else chooseDetail(detailSelected + delta);
    },
    edge(last) {
      if (view === "overview") chooseOverview(last ? categories.length - 1 : 0);
      else if (view === "arenas") chooseArena(last ? arenas.length - 1 : 0);
      else chooseDetail(last ? 1 : 0);
    },
    activate,
    focus() {
      if (view === "overview") chooseOverview(selected);
      else if (view === "arenas") chooseArena(selectedArena);
      else chooseDetail(detailSelected);
    },
    reset() { /* Showcase contains no resettable preferences. */ },
    cancel() { return false; },
  }));

  const isBattles = view === "battles";
  return <section className={`showcase-screen${reducedMotion ? " showcase-screen--still" : ""}`} aria-label="Showcase" data-showcase-view={view}>
    {view === "overview" && <section className="showcase-overview" aria-label="Showcase options">
      {categories.map((category, index) => <button
        key={category.id}
        ref={(element) => { overviewRefs.current[index] = element; }}
        className={`showcase-tile showcase-tile--${category.id}${selected === index ? " is-selected" : ""}`}
        type="button"
        aria-label={category.label}
        aria-pressed={selected === index}
        tabIndex={selected === index ? 0 : -1}
        onFocus={() => setSelected(index)}
        onPointerMove={(event) => { if (event.pointerType === "mouse" && (event.movementX || event.movementY)) chooseOverview(index); }}
        onClick={() => { chooseOverview(index); setDetailSelected(0); onViewChange(category.id); }}
      >
        {category.art ? <img className="showcase-tile-art" src={category.art} alt="" draggable={false} /> : <ArchiveArt />}
        <span className="showcase-tile-shade" aria-hidden="true" />
        <span className="showcase-tile-heading"><span className="showcase-eyebrow">{category.status}</span><span className="showcase-title">{category.title}</span></span>
        <ShowcaseIcon kind={category.id} />
        <span className="showcase-tile-foot"><span>{category.description}</span><span className="showcase-tile-arrow" aria-hidden="true">&gt;</span></span>
      </button>)}
    </section>}

    {view === "arenas" && <section className="showcase-gallery" aria-label="Arena gallery">
      <div className="showcase-arena-frame">
        <div className="showcase-arena-images">
          {arenas.map((arena, index) => <img key={arena.source} className={`showcase-arena-image${selectedArena === index ? " is-current" : ""}`} src={arena.source} alt={selectedArena === index ? arena.alt : ""} aria-hidden={selectedArena !== index} draggable={false} />)}
        </div>
        <div className="showcase-arena-caption"><h1>{arenas[selectedArena].label}</h1><span>Environment artwork preview</span><span className="showcase-arena-counter">0{selectedArena + 1}<span>/ 04</span></span></div>
      </div>
      <div className="showcase-arena-selectors" role="group" aria-label="Choose an arena">
        {arenas.map((arena, index) => <button
          type="button"
          key={arena.source}
          ref={(element) => { arenaRefs.current[index] = element; }}
          className={`showcase-arena-option${selectedArena === index ? " is-selected" : ""}`}
          aria-label={arena.label}
          aria-pressed={selectedArena === index}
          tabIndex={selectedArena === index ? 0 : -1}
          onFocus={() => setSelectedArena(index)}
          onClick={() => chooseArena(index)}
        ><img src={arena.source} alt="" draggable={false} /><span>{arena.label}</span></button>)}
      </div>
    </section>}

    {(view === "battles" || view === "replays") && <section className={`showcase-library showcase-library--${view}`} aria-label={isBattles ? "Cinematic AI battle library" : "Future replay archive"}>
      <div className="showcase-library-art" aria-hidden="true">{isBattles ? <img src="/assets/environments/card-new.webp" alt="" draggable={false} /> : <ArchiveArt />}</div>
      <div className="showcase-library-content">
        <span className="showcase-status"><span aria-hidden="true" />{isBattles ? "Cinematic library · Coming soon" : "Replay archive · Future"}</span>
        <h1>{isBattles ? "AI Battles" : "Match Replays"}</h1>
        <p className="showcase-library-intro">{isBattles ? "Witness the battle. Read every move." : "Every sacrifice. Every turning point."}</p>
        <p>{isBattles ? "Cinematic AI battle playback is not connected in this build." : "Match replays are planned for a future update."}</p>
        <button ref={exploreRef} className="showcase-primary-action" type="button" onFocus={() => setDetailSelected(0)} onClick={() => onViewChange("arenas")}>Explore Arenas <span aria-hidden="true">&gt;</span></button>
      </div>
      <div className="showcase-library-emblem" aria-hidden="true"><ShowcaseIcon kind={isBattles ? "battles" : "replays"} /><span>{isBattles ? "BATTLE LIBRARY" : "REPLAY ARCHIVE"}</span><span className="showcase-emblem-rule" /></div>
    </section>}

    <footer className="showcase-footer" aria-label="Showcase controls">
      {view === "overview" && <button className="showcase-footer-button" type="button" aria-label="Select" onClick={activate}><span className="controller-key" aria-hidden="true">A</span>Select</button>}
      <button ref={backRef} className="showcase-footer-button" type="button" aria-label="Back" onFocus={() => { if (view === "battles" || view === "replays") setDetailSelected(1); }} onClick={onBackRoot}><span className="controller-key" aria-hidden="true">B</span>Back</button>
      {view === "arenas" && <span className="showcase-footer-note">Choose an environment · Artwork preview</span>}
    </footer>
  </section>;
});
