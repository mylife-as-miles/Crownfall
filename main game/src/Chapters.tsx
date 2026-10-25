import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { CHAPTERS, CHAPTER_COLUMNS, getNextChapter, type ChapterItem } from "./chapters-content";
import type { SettingsPageHandle } from "./settings-types";
import "./Chapters.css";

interface ChaptersProps {
  selected: number;
  onSelect(index: number): void;
  onPreview(chapter: ChapterItem): void;
  onBack(): void;
  reducedMotion: boolean;
}

function ChapterLock() {
  return <svg className="chapter-lock" viewBox="0 0 24 28" fill="none" aria-hidden="true">
    <path d="M7 12V8a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="3" />
    <rect x="4" y="12" width="16" height="13" rx="1.5" fill="currentColor" />
    <circle cx="12" cy="17.5" r="1.3" fill="#151510" /><path d="M12 18v3" stroke="#151510" strokeWidth="1.6" />
  </svg>;
}

export default forwardRef<SettingsPageHandle, ChaptersProps>(function Chapters({ selected, onSelect, onPreview, onBack, reducedMotion }, ref) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const preferredColumn = useRef(selected % CHAPTER_COLUMNS);
  const preserveFocusColumn = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState({ text: "", revision: 0 });
  const choose = (index: number, preserveColumn = false) => {
    const next = Math.max(0, Math.min(CHAPTERS.length - 1, index));
    if (!preserveColumn) preferredColumn.current = next % CHAPTER_COLUMNS;
    onSelect(next);
    preserveFocusColumn.current = preserveColumn ? next : null;
    buttons.current[next]?.focus({ preventScroll: true });
  };
  const activate = (index: number, preserveColumn = true) => {
    const chapter = CHAPTERS[index];
    if (!chapter) return;
    choose(index, preserveColumn);
    if (chapter.locked || !chapter.previewable) {
      setAnnouncement(previous => ({ text: `${chapter.title} is locked in this menu preview. Campaign progression is not connected.`, revision: previous.revision + 1 }));
      return;
    }
    onPreview(chapter);
  };

  useImperativeHandle(ref, () => ({
    move(direction) {
      const vertical = direction === "up" || direction === "down";
      choose(getNextChapter(selected, direction, preferredColumn.current), vertical);
    },
    edge(last) { choose(last ? CHAPTERS.length - 1 : 0); },
    activate() { activate(selected); },
    focus() { choose(selected, true); },
    reset() { /* Chapter slots do not represent editable campaign progress. */ },
    cancel() { return false; },
  }));

  return <section className={`chapters-screen${reducedMotion ? " chapters-screen--still" : ""}`} aria-label="Chapters">
    <p id="chapters-availability" className="chapters-visually-hidden">Chapter selection preview. Campaign gameplay and progression are not connected in this build.</p>
    <div className="chapters-grid" role="group" aria-label="Chapter selection">
      {CHAPTERS.map((chapter, index) => <button
        key={chapter.id}
        ref={(button) => { buttons.current[index] = button; }}
        className={`chapter-tile${selected === index ? " is-selected" : ""}${chapter.locked ? " is-locked" : ""}`}
        type="button"
        data-chapter-id={chapter.id}
        data-locked={chapter.locked}
        tabIndex={selected === index ? 0 : -1}
        aria-label={chapter.title}
        aria-pressed={selected === index}
        aria-disabled={chapter.locked}
        aria-describedby="chapters-availability"
        onFocus={() => {
          if (preserveFocusColumn.current === index) preserveFocusColumn.current = null;
          else preferredColumn.current = index % CHAPTER_COLUMNS;
          onSelect(index);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" && (event.movementX !== 0 || event.movementY !== 0)) choose(index);
        }}
        onClick={(event) => activate(index, event.detail === 0)}
      >
        <img className="chapter-art" src={chapter.imageSrc} style={{ objectPosition: chapter.imagePosition }} alt="" draggable={false} />
        <span className="chapter-shade" aria-hidden="true" />
        <span className="chapter-title">{chapter.title}</span>
        {chapter.locked && <ChapterLock />}
      </button>)}
    </div>
    <footer className="chapters-footer" aria-label="Chapter controls">
      <button className="chapters-back" type="button" aria-label="Back" onClick={onBack}><span className="controller-key" aria-hidden="true">B</span>Back</button>
    </footer>
    <p className="chapters-visually-hidden" role="status" aria-live="polite" aria-atomic="true"><span key={announcement.revision}>{announcement.text}</span></p>
  </section>;
});
