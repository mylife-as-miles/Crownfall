import { forwardRef, Fragment, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { Direction, FrameLimit, MenuBindings, Quality, SettingsPageHandle } from "./settings-types";
import {
  CHRONICLES_MAP, CHRONICLES_TITLE, CHRONICLE_EXHIBITS, CHRONICLE_LABELS, getChronicleRecord, getChronicleShortTitle, getHotspotRecords,
} from "../../shared/chronicles/content";
import { getChronicleEntry, getCollectionEntries } from "../../shared/chronicles/registry";
import { CHRONICLES_CONTENT_POLICY, getCanonMarker } from "../../shared/chronicles/status";
import type { ChronicleCollectionId, ChronicleEntry } from "../../shared/chronicles/types";
import { cycleCollection, hotspotIndexOf, isTypingTarget, moveOnAtlas, stepList } from "./chronicles/input";
import { createChroniclesStage, type ChroniclesStage, type ChroniclesStageTarget } from "./chronicles/stage";
import { useChroniclesScene } from "./chronicles/useChroniclesScene";
import "./Chronicles.css";

/** The menu's page handle plus the collection cycle that LB/RB and Q/E call while Chronicles is open. */
export interface ChroniclesHandle extends SettingsPageHandle {
  cycle(step: 1 | -1): void;
}

interface ChroniclesProps {
  onBack(): void;
  reducedMotion: boolean;
  quality: Quality;
  renderScale: number;
  frameLimit: FrameLimit;
  /** The menu's key bindings: Backspace also goes back here unless a binding claims it. */
  bindings?: MenuBindings;
}

// Focus sits on the collection tabs or inside the shown collection. Up from the
// top of a collection reaches the tabs; down from the tabs returns.
type Zone = "tabs" | "content";
type Cursor = Record<ChronicleCollectionId, number>;

const POLICY = CHRONICLES_CONTENT_POLICY;
const hotspots = getHotspotRecords();
const START_CURSOR: Cursor = { atlas: 0, interregnum: 0, laws: 0, contested: 0 };
const collectionTitle = (collection: ChronicleCollectionId) => CHRONICLE_EXHIBITS.find((exhibit) => exhibit.id === collection)?.title ?? "";
// A title's text before its em dash (a nation, or a stop's years), as the approved records split it.
const shortTitle = (entry: ChronicleEntry) => {
  const record = getChronicleRecord(entry.id);
  return record ? getChronicleShortTitle(record) : entry.title;
};
const restTitle = (entry: ChronicleEntry) => entry.title.slice(shortTitle(entry).length).replace(/^ — /, "");
const moved = (event: PointerEvent) => event.pointerType === "mouse" && (event.movementX !== 0 || event.movementY !== 0);
const focusKey = (focus: { kind: string; nation?: string }) => (focus.kind === "nation" ? `nation:${focus.nation}` : focus.kind);

function EntryLabel({ entry }: { entry: ChronicleEntry }) {
  if (!entry.label) return null;
  const label = CHRONICLE_LABELS[entry.label];
  return <p className={`chronicles-label chronicles-label--${entry.label}`}>
    <span className="chronicles-label-mark" aria-hidden="true" />
    <span className="chronicles-label-name">{label.name}</span>
    <span className="chronicles-label-meaning">{label.meaning}</span>
  </p>;
}

// Unapproved words stand beside their marker; approved entries carry none.
function CanonMarker({ entry }: { entry: ChronicleEntry }) {
  const marker = getCanonMarker(entry.canonStatus, POLICY);
  return marker ? <p className="chronicles-canon-marker">{marker}</p> : null;
}

export default forwardRef<ChroniclesHandle, ChroniclesProps>(function Chronicles({ onBack, reducedMotion, quality, renderScale, frameLimit, bindings }, ref) {
  const { state, entry, collections, send, unwind } = useChroniclesScene();
  const { collection, focus, load } = state;
  const [zone, setZone] = useState<Zone>("content");
  const [cursor, setCursor] = useState<Cursor>(START_CURSOR);
  const [stage, setStage] = useState<ChroniclesStage | null>(null);
  const screenRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const recordSlotRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<ChronicleCollectionId, HTMLButtonElement | null>>>({});
  const itemRefs = useRef<Record<ChronicleCollectionId, (HTMLButtonElement | null)[]>>({ atlas: [], interregnum: [], laws: [], contested: [] });
  const markerRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const shiftHeld = useRef(false);
  const pendingFocus = useRef<{ target: ChronicleCollectionId; position: number } | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  const handlers = useRef({ target(_target: ChroniclesStageTarget | null) { /* set below */ }, activate(_target: ChroniclesStageTarget) { /* set below */ } });
  const flat = load === "flat" || load === "failed";
  const entries = collection === "atlas" ? [] : getCollectionEntries(collection, POLICY);
  const count = collection === "atlas" ? hotspots.length : entries.length;
  const index = Math.max(0, Math.min(count - 1, cursor[collection]));
  reducedMotionRef.current = reducedMotion;

  const itemId = (target: ChronicleCollectionId, position: number) =>
    target === "atlas" ? hotspots[position]?.id : getCollectionEntries(target, POLICY)[position]?.id;
  const focusItem = (target: ChronicleCollectionId, position: number) => {
    setZone("content");
    setCursor((current) => (current[target] === position ? current : { ...current, [target]: position }));
    // A collection that is being switched to is still hidden: focus it once it shows.
    if (target === collection) itemRefs.current[target][position]?.focus({ preventScroll: true });
    else pendingFocus.current = { target, position };
  };
  const focusTab = (target: ChronicleCollectionId) => {
    setZone("tabs");
    tabRefs.current[target]?.focus({ preventScroll: true });
  };
  const showCollection = (target: ChronicleCollectionId, toZone: Zone) => {
    send({ type: "collection", collection: target });
    if (toZone === "tabs") focusTab(target);
    else focusItem(target, Math.max(0, cursor[target]));
  };
  // Opening an item's entry. In the Atlas this also brings its nation into focus.
  const openItem = (target: ChronicleCollectionId, position: number) => {
    const id = itemId(target, position);
    focusItem(target, position);
    if (id) send({ type: "entry", id });
  };
  const moveContent = (direction: Direction) => {
    if (collection === "atlas") {
      // Shift turns and tilts the view instead of moving between nations.
      if (shiftHeld.current && stage) { stage.orbit(direction); return; }
      const move = moveOnAtlas(state, index, direction);
      if (move.toTabs) { focusTab(collection); return; }
      if (move.event) send(move.event);
      focusItem("atlas", move.cursor);
      return;
    }
    // The timeline is one row, so up leaves it for the tabs; the articles leave from the first.
    if (direction === "up" && (collection === "interregnum" || index === 0)) { focusTab(collection); return; }
    if (collection === "interregnum" && direction === "down") return;
    const next = stepList(count, index, direction);
    // With an entry open, moving browses: the neighbour's entry opens in its place.
    if (state.entryId !== null && next !== index) openItem(collection, next);
    else focusItem(collection, next);
  };
  const cycle = (step: 1 | -1) => {
    const target = cycleCollection(collections, collection, step);
    if (target !== collection) showCollection(target, zone);
  };
  const activate = () => {
    if (zone === "tabs") focusItem(collection, index);
    else openItem(collection, index);
  };
  // Showcase's pointer rule: moving onto a marker highlights and focuses it; a
  // resting pointer never takes focus back, and only a click opens an entry.
  handlers.current = {
    target(target) { if (target?.kind === "marker" && collection === "atlas") focusItem("atlas", target.index); },
    activate(target) { if (target.kind === "marker" && collection === "atlas") openItem("atlas", target.index); },
  };

  useImperativeHandle(ref, () => ({
    move(direction) {
      if (zone === "content") moveContent(direction);
      else if (direction === "down") focusItem(collection, index);
      else if (direction === "left" || direction === "right") {
        const position = collections.indexOf(collection) + (direction === "left" ? -1 : 1);
        if (position >= 0 && position < collections.length) showCollection(collections[position], "tabs");
      }
    },
    edge(last) {
      if (zone === "tabs") { showCollection(collections[last ? collections.length - 1 : 0], "tabs"); return; }
      const next = last ? count - 1 : 0;
      if (collection === "atlas") {
        const move = state.entryId !== null ? { type: "entry", id: hotspots[next].id } as const
          : focus.kind === "nation" ? { type: "focus", focus: { kind: "nation", nation: hotspots[next].nation } } as const : null;
        if (move) send(move);
        focusItem("atlas", next);
      } else if (state.entryId !== null && next !== index) openItem(collection, next);
      else focusItem(collection, next);
    },
    activate,
    focus() {
      if (zone === "tabs") focusTab(collection);
      else focusItem(collection, index);
    },
    reset() { /* Chronicles contains no resettable preferences. */ },
    cancel() {
      if (!unwind()) return false;
      if (zone === "tabs") focusTab(collection);
      else focusItem(collection, index);
      return true;
    },
    cycle,
  }));

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || pending.target !== collection) return;
    pendingFocus.current = null;
    itemRefs.current[pending.target][pending.position]?.focus({ preventScroll: true });
  });

  // The stage is created after the screen mounts, from its own lazily loaded
  // chunk. Any failure, now or later, leaves the flat painting with the same entries.
  useEffect(() => {
    let cancelled = false;
    let created: ChroniclesStage | null = null;
    const host = stageRef.current;
    const progress = (share: number) => {
      const element = loadingRef.current;
      if (!element || cancelled) return;
      const value = Math.max(0, Math.min(1, share));
      element.style.setProperty("--chronicles-progress", value.toFixed(3));
      element.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    };
    const fallBack = () => {
      created?.dispose();
      created = null;
      if (cancelled) return;
      setStage(null);
      send({ type: "loaded", result: "flat" });
    };
    if (!host) return;
    createChroniclesStage({
      host, quality, renderScale, frameLimit,
      reducedMotion: reducedMotionRef.current,
      onProgress: progress,
      onReady: () => { if (!cancelled) send({ type: "loaded", result: "ready" }); },
      onFailure: fallBack,
      onPointerTarget: (target) => handlers.current.target(target),
      onActivateTarget: (target) => handlers.current.activate(target),
    }).then((value) => {
      if (cancelled) { value.dispose(); return; }
      created = value;
      value.setLabels(markerRefs.current);
      setStage(value);
    }, fallBack);
    return () => {
      cancelled = true;
      created?.dispose();
      created = null;
    };
  }, [quality, renderScale, frameLimit, send]);

  // The stage follows the scene state: the collection, the focus, the highlight and the open entry.
  const open = collection === "atlas" ? hotspotIndexOf(state.entryId) : -1;
  const emphasized = collection === "atlas" && zone === "content" ? index : -1;
  useEffect(() => {
    if (!stage) return;
    stage.setActive(true);
    stage.setReducedMotion(reducedMotion);
    stage.setView({ collection, focus, emphasized, open });
  }, [stage, reducedMotion, collection, focus, emphasized, open]);

  // The view frames itself in the stage the header, footer and record leave clear.
  useLayoutEffect(() => {
    const screen = screenRef.current, header = headerRef.current, footer = footerRef.current, slot = recordSlotRef.current;
    if (!stage || !screen || !header || !footer || !slot) return;
    const measure = () => {
      const width = screen.clientWidth, height = screen.clientHeight;
      const gap = height * 0.012, side = width * 0.035;
      const top = header.offsetTop + header.offsetHeight + gap, bottom = Math.max(0, height - footer.offsetTop + gap);
      stage.setInsets({ top, bottom, left: side, right: side }, { top, bottom, left: side, right: Math.max(side, width - slot.offsetLeft + gap) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(screen);
    return () => observer.disconnect();
  }, [stage]);

  // Shift turns the view from the keyboard, plus and minus zoom it, and
  // Backspace goes back unless the menu's bindings already claim it.
  useEffect(() => {
    const backspaceFree = !bindings || !Object.values(bindings).includes("Backspace");
    const track = (event: KeyboardEvent) => { shiftHeld.current = event.shiftKey; };
    const onKeyDown = (event: KeyboardEvent) => {
      track(event);
      if (event.code === "Backspace" && backspaceFree && !isTypingTarget(event.target) && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        if (!event.repeat) onBack();
        return;
      }
      const steps = event.code === "Equal" || event.code === "NumpadAdd" ? 1 : event.code === "Minus" || event.code === "NumpadSubtract" ? -1 : 0;
      if (!steps || !stage || isTypingTarget(event.target)) return;
      event.preventDefault();
      stage.zoom(steps);
    };
    const release = () => { shiftHeld.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", track);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", track);
      window.removeEventListener("blur", release);
    };
  }, [stage, bindings, onBack]);

  const panel = (id: ChronicleCollectionId) => ({
    id: `chronicles-panel-${id}`,
    className: `chronicles-collection chronicles-collection--${id}`,
    role: "tabpanel",
    "aria-labelledby": `chronicles-tab-${id}`,
    hidden: collection !== id,
  });
  const focusedNation = focus.kind === "nation" ? focus.nation : null;
  const hotspotLayer = <div className={`chronicles-hotspots${flat ? " chronicles-hotspots--flat" : ""}`}>
    {hotspots.map((record, position) => {
      const item = getChronicleEntry(record.id, POLICY);
      if (!item) return null;
      const place = flat ? { left: `${record.hotspot.x * 100}%`, top: `${record.hotspot.y * 100}%` } : undefined;
      const isOpen = state.entryId === record.id;
      const current = cursor.atlas === position;
      const selected = (current && zone === "content" && collection === "atlas") || isOpen || focusedNation === record.nation;
      return <Fragment key={record.id}>
        <button
          ref={(element) => { itemRefs.current.atlas[position] = element; }}
          className={`chronicles-hotspot${selected ? " is-selected" : ""}${isOpen ? " is-open" : ""}`}
          style={place}
          type="button"
          data-nation={record.nation}
          aria-label={item.title}
          aria-pressed={current}
          aria-expanded={isOpen}
          aria-controls={isOpen ? "chronicles-record" : undefined}
          tabIndex={current ? 0 : -1}
          onFocus={() => { setZone("content"); setCursor((current) => (current.atlas === position ? current : { ...current, atlas: position })); }}
          onPointerMove={(event) => { if (moved(event)) focusItem("atlas", position); }}
          onClick={() => openItem("atlas", position)}
        />
        <span
          ref={(element) => { markerRefs.current[position] = element; }}
          className={`chronicles-marker${selected ? " is-selected" : ""}`}
          style={place}
          data-nation={record.nation}
          data-caption={record.hotspot.x < 0.5 ? "east" : "west"}
          aria-hidden="true"
        ><span className="chronicles-marker-caption">{shortTitle(item)}</span></span>
      </Fragment>;
    })}
  </div>;
  const list = (target: Exclude<ChronicleCollectionId, "atlas">) => getCollectionEntries(target, POLICY).map((item, position) => {
    const isOpen = state.entryId === item.id;
    const current = collection === target && cursor[target] === position;
    return <button
      key={item.id}
      ref={(element) => { itemRefs.current[target][position] = element; }}
      className={`chronicles-item chronicles-item--${target}${current ? " is-selected" : ""}${isOpen ? " is-open" : ""}`}
      type="button"
      data-record={item.id}
      aria-label={item.title}
      aria-pressed={current}
      aria-expanded={isOpen}
      aria-controls={isOpen ? "chronicles-record" : undefined}
      tabIndex={current ? 0 : -1}
      onFocus={() => { setZone("content"); setCursor((value) => (value[target] === position ? value : { ...value, [target]: position })); }}
      onPointerMove={(event) => { if (moved(event)) focusItem(target, position); }}
      onClick={() => openItem(target, position)}
    >
      {target === "interregnum" ? <>
        <span className="chronicles-stop-label">{shortTitle(item)}</span>
        <span className="chronicles-stop-rail" aria-hidden="true"><span className="chronicles-stop-node" /></span>
        <span className="chronicles-stop-era">{restTitle(item)}</span>
      </> : <>
        <span className="chronicles-article-mark" aria-hidden="true" />
        <span className="chronicles-article-title">{item.title}</span>
      </>}
    </button>;
  });

  return <section
    ref={screenRef}
    className={`chronicles-screen${reducedMotion ? " chronicles-screen--still" : ""}`}
    aria-label={CHRONICLES_TITLE}
    aria-busy={load === "loading" || undefined}
    data-collection={collection}
    data-focus={focusKey(focus)}
    data-entry={state.entryId ?? ""}
    data-load={load}
    data-chronicles-zone={zone}
  >
    <div
      ref={stageRef}
      className="chronicles-stage"
      role="img"
      aria-label={CHRONICLES_MAP.alt}
      aria-hidden={flat || collection !== "atlas" || undefined}
      // Pressing the stage never moves keyboard focus off the highlighted item.
      onMouseDown={(event) => event.preventDefault()}
    />
    <div className="chronicles-shade" aria-hidden="true" />
    <div
      ref={loadingRef}
      className="chronicles-loading"
      role="progressbar"
      aria-label={CHRONICLES_TITLE}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      aria-hidden={load !== "loading" || undefined}
    >
      <span className="chronicles-loading-orbit" aria-hidden="true">
        <span className="chronicles-loading-ring chronicles-loading-ring--outer" />
        <span className="chronicles-loading-ring chronicles-loading-ring--inner" />
        <span className="chronicles-loading-core" />
      </span>
      <span className="chronicles-loading-track" aria-hidden="true"><span className="chronicles-loading-fill" /></span>
    </div>
    <header ref={headerRef} className="chronicles-header">
      <h1 id="chronicles-heading" className="chronicles-title">{CHRONICLES_TITLE}</h1>
      <span className="chronicles-header-rule" aria-hidden="true" />
      {/* Pointer shortcuts for LB/RB; the tabs carry the same choice for the keyboard and screen readers. */}
      <span className="chronicles-shoulder" aria-hidden="true" onMouseDown={(event) => event.preventDefault()} onClick={() => cycle(-1)}><span>LB</span></span>
      <div className="chronicles-tabs" role="tablist" aria-labelledby="chronicles-heading">
        {collections.map((item) => <button
          key={item}
          ref={(element) => { tabRefs.current[item] = element; }}
          id={`chronicles-tab-${item}`}
          className={`chronicles-tab${collection === item ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={collection === item}
          aria-controls={`chronicles-panel-${item}`}
          tabIndex={collection === item ? 0 : -1}
          onFocus={() => setZone("tabs")}
          onClick={(event) => {
            // Enter or Space on the shown collection's tab enters it, as A does.
            if (event.detail === 0 && item === collection) focusItem(collection, index);
            else showCollection(item, "tabs");
          }}
        >{collectionTitle(item)}</button>)}
      </div>
      <span className="chronicles-shoulder" aria-hidden="true" onMouseDown={(event) => event.preventDefault()} onClick={() => cycle(1)}><span>RB</span></span>
    </header>

    <div {...panel("atlas")}>
      {flat ? <div className="chronicles-flat" onMouseDown={(event) => { if (!(event.target instanceof HTMLButtonElement)) event.preventDefault(); }}>
        <img className="chronicles-flat-image" src={CHRONICLES_MAP.src} width={CHRONICLES_MAP.width} height={CHRONICLES_MAP.height} alt={CHRONICLES_MAP.alt} draggable={false} />
        {hotspotLayer}
      </div> : hotspotLayer}
    </div>
    <div {...panel("interregnum")}>
      <div className="chronicles-timeline" role="group" aria-labelledby="chronicles-tab-interregnum">{list("interregnum")}</div>
    </div>
    <div {...panel("laws")}>
      <div className="chronicles-articles" role="group" aria-labelledby="chronicles-tab-laws">{list("laws")}</div>
    </div>

    <div ref={recordSlotRef} className="chronicles-record-slot" aria-live="polite">
      {entry && <article key={entry.id} id="chronicles-record" className="chronicles-record" data-record={entry.id} aria-labelledby="chronicles-record-title">
        <CanonMarker entry={entry} />
        <EntryLabel entry={entry} />
        <h2 id="chronicles-record-title">{entry.title}</h2>
        <span className="chronicles-record-rule" aria-hidden="true" />
        <p className="chronicles-body">{entry.body}</p>
      </article>}
    </div>

    <footer ref={footerRef} className="chronicles-footer" aria-label="Menu controls">
      <button className="chronicles-footer-button" type="button" aria-label="Select" onClick={activate}><span className="controller-key" aria-hidden="true">A</span>Select</button>
      <button className="chronicles-footer-button" type="button" aria-label="Back" onClick={onBack}><span className="controller-key" aria-hidden="true">B</span>Back</button>
    </footer>
  </section>;
});
