import { forwardRef, Fragment, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { Direction, FrameLimit, Quality, SettingsPageHandle } from "./settings-types";
import {
  CHRONICLES_MAP, CHRONICLES_TITLE, CHRONICLE_EXHIBITS, CHRONICLE_LABELS,
  getChronicleRecords, getChronicleShortTitle, getHotspotRecords, getNationAccounts,
  getNextArticle, getNextHotspot, getNextTimelineStop,
} from "../../shared/chronicles/content";
import type { ChronicleExhibitId, ChronicleRecord } from "../../shared/chronicles/types";
import type { AtlasScene } from "./chronicles/scene/AtlasScene";
import "./Chronicles.css";

interface ChroniclesProps {
  onBack(): void;
  reducedMotion: boolean;
  quality: Quality;
  renderScale: number;
  frameLimit: FrameLimit;
}

// Focus sits on the exhibit tabs or inside the shown exhibit. Up from the top of
// an exhibit reaches the tabs; down from the tabs returns to the exhibit.
type Zone = "tabs" | "content";
// The Atlas is a real-time relief; "flat" is the painting with the same
// hotspots, shown when WebGL is unavailable or lost.
type AtlasState = "loading" | "ready" | "flat";

const hotspots = getHotspotRecords();
const stops = getChronicleRecords("interregnum");
const articles = getChronicleRecords("laws");
const clamp = (index: number, count: number) => Math.max(0, Math.min(count - 1, index));
// The rest of a stop's title after its years, cut where getChronicleShortTitle cuts.
const getEraTitle = (record: ChronicleRecord) => record.title.slice(getChronicleShortTitle(record).length).replace(/^ — /, "");
const moved = (event: PointerEvent) => event.pointerType === "mouse" && (event.movementX !== 0 || event.movementY !== 0);

function ChronicleLabel({ record }: { record: ChronicleRecord }) {
  const label = CHRONICLE_LABELS[record.label];
  return <p className={`chronicles-label chronicles-label--${record.label}`}>
    <span className="chronicles-label-mark" aria-hidden="true" />
    <span className="chronicles-label-name">{label.name}</span>
    <span className="chronicles-label-meaning">{label.meaning}</span>
  </p>;
}

function ChronicleEmblem({ kind }: { kind: "interregnum" | "laws" }) {
  return <span className="chronicles-emblem" aria-hidden="true">
    <svg className="chronicles-emblem-icon" viewBox="0 0 64 64" fill="none">
      {kind === "interregnum" && <>
        <path d="M17 7h30M17 57h30M22 7c0 13 8 18 8 25s-8 12-8 25M42 7c0 13-8 18-8 25s8 12 8 25" />
        <path d="M26 17h12l-6 8-6-8ZM25 53c2-4 4-6 7-6s5 2 7 6H25Z" className="chronicles-emblem-accent" />
      </>}
      {kind === "laws" && <>
        <circle cx="32" cy="14" r="6" />
        <path d="M25 24h14M28 24c0 8-2 14-6 21h20c-4-7-6-13-6-21M18 45h28v5H18v-5Z" />
        <path d="M14 56h36" className="chronicles-emblem-accent" />
      </>}
    </svg>
    <span className="chronicles-emblem-rule" />
  </span>;
}

export default forwardRef<SettingsPageHandle, ChroniclesProps>(function Chronicles({ onBack, reducedMotion, quality, renderScale, frameLimit }, ref) {
  const [exhibit, setExhibit] = useState(0);
  const [zone, setZone] = useState<Zone>("content");
  const [hotspot, setHotspot] = useState(0);
  const [openRecord, setOpenRecord] = useState<string | null>(null);
  const [stop, setStop] = useState(0);
  const [article, setArticle] = useState(0);
  const [atlas, setAtlas] = useState<AtlasState>("loading");
  const [scene, setScene] = useState<AtlasScene | null>(null);
  const screenRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const recordSlotRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hotspotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const markerRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const stopRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const articleRefs = useRef<(HTMLElement | null)[]>([]);
  const shiftHeld = useRef(false);
  const reducedMotionRef = useRef(reducedMotion);
  const pointerHandlers = useRef({ marker(_index: number) { /* set below */ }, activate(_index: number) { /* set below */ } });
  const exhibitId: ChronicleExhibitId = CHRONICLE_EXHIBITS[exhibit].id;
  const flat = atlas === "flat";
  reducedMotionRef.current = reducedMotion;

  const focusTab = (index: number) => {
    setZone("tabs");
    tabRefs.current[index]?.focus({ preventScroll: true });
  };
  const chooseExhibit = (index: number) => {
    const next = clamp(index, CHRONICLE_EXHIBITS.length);
    if (next !== exhibit) setOpenRecord(null);
    setExhibit(next);
    focusTab(next);
  };
  const chooseHotspot = (index: number) => {
    const next = clamp(index, hotspots.length);
    setHotspot(next);
    setZone("content");
    hotspotRefs.current[next]?.focus({ preventScroll: true });
  };
  const openHotspot = (index: number) => {
    const next = clamp(index, hotspots.length);
    chooseHotspot(next);
    setOpenRecord(hotspots[next].id);
  };
  const chooseStop = (index: number) => {
    const next = clamp(index, stops.length);
    setStop(next);
    stopRefs.current[next]?.focus({ preventScroll: true });
  };
  const chooseArticle = (index: number) => {
    const next = clamp(index, articles.length);
    setArticle(next);
    articleRefs.current[next]?.focus({ preventScroll: true });
    articleRefs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  };
  const focusContent = () => {
    setZone("content");
    if (exhibitId === "atlas") chooseHotspot(hotspot);
    else if (exhibitId === "interregnum") chooseStop(stop);
    else chooseArticle(article);
  };
  const moveContent = (direction: Direction) => {
    if (exhibitId === "atlas") {
      // Shift turns and tilts the relief instead of moving between nations.
      if (shiftHeld.current && scene) {
        scene.orbit(direction);
        return;
      }
      const next = getNextHotspot(hotspot, direction);
      if (direction === "up" && next === hotspot) focusTab(exhibit);
      else chooseHotspot(next);
    } else if (exhibitId === "interregnum") {
      // The timeline is a single row, so up always leaves it for the tabs.
      if (direction === "up") focusTab(exhibit);
      else if (direction !== "down") chooseStop(getNextTimelineStop(stop, direction));
    } else if (direction === "up" && article === 0) focusTab(exhibit);
    else chooseArticle(getNextArticle(article, direction));
  };
  const activate = () => {
    if (zone === "tabs") focusContent();
    else if (exhibitId === "atlas") openHotspot(hotspot);
  };
  // Showcase's pointer rule: moving onto a marker selects and focuses it; a
  // resting pointer never takes focus back, and only a click opens a record.
  pointerHandlers.current = {
    marker(index) { if (exhibitId === "atlas") chooseHotspot(index); },
    activate(index) { if (exhibitId === "atlas") openHotspot(index); },
  };

  useImperativeHandle(ref, () => ({
    move(direction) {
      if (zone === "content") moveContent(direction);
      else if (direction === "down") focusContent();
      else if (direction !== "up") chooseExhibit(exhibit + (direction === "left" ? -1 : 1));
    },
    edge(last) {
      if (zone === "tabs") chooseExhibit(last ? CHRONICLE_EXHIBITS.length - 1 : 0);
      else if (exhibitId === "atlas") chooseHotspot(last ? hotspots.length - 1 : 0);
      else if (exhibitId === "interregnum") chooseStop(last ? stops.length - 1 : 0);
      else chooseArticle(last ? articles.length - 1 : 0);
    },
    activate,
    focus() {
      if (zone === "tabs") focusTab(exhibit);
      else focusContent();
    },
    reset() { /* Chronicles contains no resettable preferences. */ },
    cancel() {
      if (!openRecord) return false;
      setOpenRecord(null);
      if (zone === "tabs") focusTab(exhibit);
      else chooseHotspot(hotspot);
      return true;
    },
  }));

  // The relief is created after the screen mounts, from its own lazily loaded
  // module; any WebGL failure leaves the flat painting with the same hotspots.
  useEffect(() => {
    let cancelled = false;
    let created: AtlasScene | null = null;
    const fallBack = () => {
      created?.dispose();
      created = null;
      if (cancelled) return;
      setScene(null);
      setAtlas("flat");
    };
    import("./chronicles/scene/AtlasScene").then(({ createAtlasScene }) => {
      const host = stageRef.current;
      if (cancelled || !host) return;
      try {
        created = createAtlasScene({
          host, quality, renderScale, frameLimit,
          reducedMotion: reducedMotionRef.current,
          onReady: () => { if (!cancelled) setAtlas("ready"); },
          onFailure: fallBack,
          onPointerMarker: (index) => pointerHandlers.current.marker(index),
          onActivateMarker: (index) => pointerHandlers.current.activate(index),
        });
        created.setLabels(markerRefs.current);
        setScene(created);
      } catch {
        fallBack();
      }
    }, fallBack);
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [quality, renderScale, frameLimit]);

  const openIndex = hotspots.findIndex((item) => item.id === openRecord);
  useEffect(() => {
    if (!scene) return;
    scene.setActive(exhibitId === "atlas");
    scene.setReducedMotion(reducedMotion);
    scene.setSelection(exhibitId === "atlas" && zone === "content" ? hotspot : -1, openIndex);
  });

  // The map frames itself in the stage the header, footer and record leave clear.
  useLayoutEffect(() => {
    const screen = screenRef.current, header = headerRef.current, footer = footerRef.current, slot = recordSlotRef.current;
    if (!scene || !screen || !header || !footer || !slot) return;
    const measure = () => {
      const width = screen.clientWidth, height = screen.clientHeight;
      const gap = height * 0.012, side = width * 0.035;
      const top = header.offsetTop + header.offsetHeight + gap, bottom = Math.max(0, height - footer.offsetTop + gap);
      scene.setInsets({ top, bottom, left: side, right: side }, { top, bottom, left: side, right: Math.max(side, width - slot.offsetLeft + gap) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(screen);
    return () => observer.disconnect();
  }, [scene]);

  // Shift is tracked for turning the relief from the keyboard; plus and minus zoom it.
  useEffect(() => {
    const track = (event: KeyboardEvent) => { shiftHeld.current = event.shiftKey; };
    const onKeyDown = (event: KeyboardEvent) => {
      track(event);
      const steps = event.code === "Equal" || event.code === "NumpadAdd" ? 1 : event.code === "Minus" || event.code === "NumpadSubtract" ? -1 : 0;
      if (!steps || !scene || exhibitId !== "atlas") return;
      event.preventDefault();
      scene.zoom(steps);
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
  }, [scene, exhibitId]);

  const record = hotspots.find((item) => item.id === openRecord);
  const accounts = record ? getNationAccounts(record.nation) : [];
  const selectedStop = stops[stop];
  const panel = (id: ChronicleExhibitId) => ({
    id: `chronicles-panel-${id}`,
    className: `chronicles-exhibit chronicles-exhibit--${id}`,
    role: "tabpanel",
    "aria-labelledby": `chronicles-tab-${id}`,
    hidden: exhibitId !== id,
  });
  const hotspotLayer = <div className={`chronicles-hotspots${flat ? " chronicles-hotspots--flat" : ""}`}>
    {hotspots.map((item, index) => {
      const place = flat ? { left: `${item.hotspot.x * 100}%`, top: `${item.hotspot.y * 100}%` } : undefined;
      const selected = hotspot === index && (zone === "content" || openRecord === item.id);
      return <Fragment key={item.id}>
        <button
          ref={(element) => { hotspotRefs.current[index] = element; }}
          className={`chronicles-hotspot${selected ? " is-selected" : ""}${openRecord === item.id ? " is-open" : ""}`}
          style={place}
          type="button"
          data-nation={item.nation}
          aria-label={item.title}
          aria-pressed={hotspot === index}
          aria-expanded={openRecord === item.id}
          aria-controls={openRecord === item.id ? "chronicles-record" : undefined}
          tabIndex={hotspot === index ? 0 : -1}
          onFocus={() => { setZone("content"); setHotspot(index); }}
          onPointerMove={(event) => { if (moved(event)) chooseHotspot(index); }}
          onClick={() => openHotspot(index)}
        />
        <span
          ref={(element) => { markerRefs.current[index] = element; }}
          className={`chronicles-marker${selected ? " is-selected" : ""}`}
          style={place}
          data-nation={item.nation}
          data-caption={item.hotspot.x < 0.5 ? "east" : "west"}
          aria-hidden="true"
        ><span className="chronicles-marker-caption">{getChronicleShortTitle(item)}</span></span>
      </Fragment>;
    })}
  </div>;

  return <section
    ref={screenRef}
    className={`chronicles-screen${reducedMotion ? " chronicles-screen--still" : ""}`}
    aria-label={CHRONICLES_TITLE}
    data-chronicles-exhibit={exhibitId}
    data-chronicles-zone={zone}
    data-atlas={atlas}
  >
    {/* The relief is every exhibit's backdrop; it draws only while the Atlas is shown. */}
    <div
      ref={stageRef}
      className="chronicles-stage"
      role="img"
      aria-label={CHRONICLES_MAP.alt}
      aria-hidden={flat || exhibitId !== "atlas" || undefined}
      // Pressing the map never moves keyboard focus off the selected nation.
      onMouseDown={(event) => event.preventDefault()}
    />
    <div className="chronicles-shade" aria-hidden="true" />
    <header ref={headerRef} className="chronicles-header">
      <h1 id="chronicles-heading" className="chronicles-title">{CHRONICLES_TITLE}</h1>
      <span className="chronicles-header-rule" aria-hidden="true" />
      <div className="chronicles-tabs" role="tablist" aria-labelledby="chronicles-heading">
        {CHRONICLE_EXHIBITS.map((item, index) => <button
          key={item.id}
          ref={(element) => { tabRefs.current[index] = element; }}
          id={`chronicles-tab-${item.id}`}
          className={`chronicles-tab${exhibit === index ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={exhibit === index}
          aria-controls={`chronicles-panel-${item.id}`}
          tabIndex={exhibit === index ? 0 : -1}
          onFocus={() => setZone("tabs")}
          onClick={(event) => {
            // Enter or Space on the shown exhibit's tab enters it, as A does.
            if (event.detail === 0 && index === exhibit) focusContent();
            else chooseExhibit(index);
          }}
        >{item.title}</button>)}
      </div>
    </header>

    <div {...panel("atlas")}>
      {flat ? <div className="chronicles-flat" onMouseDown={(event) => { if (!(event.target instanceof HTMLButtonElement)) event.preventDefault(); }}>
        <img className="chronicles-flat-image" src={CHRONICLES_MAP.src} width={CHRONICLES_MAP.width} height={CHRONICLES_MAP.height} alt={CHRONICLES_MAP.alt} draggable={false} />
        {hotspotLayer}
      </div> : hotspotLayer}
      <div ref={recordSlotRef} className="chronicles-record-slot" aria-live="polite">
        {record && <article key={record.id} id="chronicles-record" className="chronicles-record" data-record={record.id} aria-labelledby="chronicles-record-title">
          <ChronicleLabel record={record} />
          <h2 id="chronicles-record-title">{record.title}</h2>
          <span className="chronicles-record-rule" aria-hidden="true" />
          <p className="chronicles-body">{record.body}</p>
          {accounts.length > 0 && <div className="chronicles-accounts">
            {accounts.map((account) => <article key={account.id} className="chronicles-account" data-record={account.id}>
              <ChronicleLabel record={account} />
              <h3>{account.title}</h3>
              <p className="chronicles-body">{account.body}</p>
            </article>)}
          </div>}
        </article>}
      </div>
    </div>

    <div {...panel("interregnum")}>
      <div className="chronicles-panel chronicles-interregnum">
        <div className="chronicles-timeline" role="group" aria-labelledby="chronicles-tab-interregnum">
          {stops.map((item, index) => <button
            key={item.id}
            ref={(element) => { stopRefs.current[index] = element; }}
            className={`chronicles-stop${stop === index ? " is-selected" : ""}`}
            type="button"
            data-record={item.id}
            aria-label={item.title}
            aria-pressed={stop === index}
            aria-controls="chronicles-stop-detail"
            tabIndex={stop === index ? 0 : -1}
            onFocus={() => { setZone("content"); setStop(index); }}
            onPointerMove={(event) => { if (moved(event)) chooseStop(index); }}
            onClick={() => chooseStop(index)}
          >
            <span className="chronicles-stop-label">{getChronicleShortTitle(item)}</span>
            <span className="chronicles-stop-rail" aria-hidden="true"><span className="chronicles-stop-node" /></span>
            <span className="chronicles-stop-era">{getEraTitle(item)}</span>
          </button>)}
        </div>
        <div className="chronicles-interregnum-body">
          <div id="chronicles-stop-detail" className="chronicles-stop-detail" aria-live="polite">
            <article key={selectedStop.id} className="chronicles-entry" data-record={selectedStop.id}>
              <ChronicleLabel record={selectedStop} />
              <h2>{selectedStop.title}</h2>
              <p className="chronicles-body">{selectedStop.body}</p>
            </article>
          </div>
          <ChronicleEmblem kind="interregnum" />
        </div>
      </div>
    </div>

    <div {...panel("laws")}>
      <div className="chronicles-panel chronicles-laws">
        <div className="chronicles-articles">
          {articles.map((item, index) => <article
            key={item.id}
            ref={(element) => { articleRefs.current[index] = element; }}
            className={`chronicles-article${article === index ? " is-selected" : ""}`}
            data-record={item.id}
            aria-labelledby={`chronicles-article-${item.id}`}
            aria-current={article === index || undefined}
            tabIndex={article === index ? 0 : -1}
            onFocus={() => { setZone("content"); setArticle(index); }}
            onPointerMove={(event) => { if (moved(event)) chooseArticle(index); }}
            onClick={() => chooseArticle(index)}
          >
            <ChronicleLabel record={item} />
            <h2 id={`chronicles-article-${item.id}`}>{item.title}</h2>
            <p className="chronicles-body">{item.body}</p>
          </article>)}
        </div>
        <ChronicleEmblem kind="laws" />
      </div>
    </div>

    <footer ref={footerRef} className="chronicles-footer" aria-label="Menu controls">
      {exhibitId === "atlas" && <button className="chronicles-footer-button" type="button" aria-label="Select" onClick={activate}><span className="controller-key" aria-hidden="true">A</span>Select</button>}
      <button className="chronicles-footer-button" type="button" aria-label="Back" onClick={onBack}><span className="controller-key" aria-hidden="true">B</span>Back</button>
    </footer>
  </section>;
});
