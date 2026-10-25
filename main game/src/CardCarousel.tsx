import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import "./CardCarousel.css";

export type CarouselCard = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
};

export type CardCarouselHandle = {
  reveal(index: number): void;
};

type CardCarouselProps = {
  items: readonly CarouselCard[];
  selected: number;
  onSelect(index: number): void;
  onActivate(index: number): void;
  cardRefs: RefObject<(HTMLButtonElement | null)[]>;
  reducedMotion: boolean;
};

type ScrollState = {
  first: number;
  atStart: boolean;
  atEnd: boolean;
};

const visibleCount = 3;
const edgeTolerance = 1.5;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const CardCarousel = forwardRef<CardCarouselHandle, CardCarouselProps>(
  function CardCarousel(
    { items, selected, onSelect, onActivate, cardRefs, reducedMotion },
    forwardedRef,
  ) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const previousSize = useRef({ maximum: 0, left: 0 });
    const id = useId();
    const viewportId = `play-options-${id}`;
    const instructionsId = `play-options-help-${id}`;
    const [systemReducedMotion, setSystemReducedMotion] = useState(() =>
      typeof window === "undefined"
        ? false
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    const [scrollState, setScrollState] = useState<ScrollState>({
      first: 0,
      atStart: true,
      atEnd: items.length <= visibleCount,
    });
    const still = reducedMotion || systemReducedMotion;

    useEffect(() => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setSystemReducedMotion(query.matches);
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }, []);

    const readScrollState = useCallback(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const left = clamp(viewport.scrollLeft, 0, maximum);
      const firstCard = cardRefs.current[0];
      const secondCard = cardRefs.current[1];
      const stride =
        firstCard && secondCard
          ? secondCard.offsetLeft - firstCard.offsetLeft
          : viewport.clientWidth;
      const first = clamp(
        Math.round(left / Math.max(1, stride)),
        0,
        Math.max(0, items.length - visibleCount),
      );
      const next = {
        first,
        atStart: left <= edgeTolerance,
        atEnd: maximum - left <= edgeTolerance,
      };
      previousSize.current = { maximum, left };
      setScrollState((current) =>
        current.first === next.first &&
        current.atStart === next.atStart &&
        current.atEnd === next.atEnd
          ? current
          : next,
      );
    }, [cardRefs, items.length]);

    const revealCard = useCallback(
      (index: number, behavior: ScrollBehavior) => {
        const viewport = viewportRef.current;
        const safeIndex = clamp(index, 0, items.length - 1);
        const card = cardRefs.current[safeIndex];
        if (!viewport || !card) return;
        const gutter =
          parseFloat(getComputedStyle(viewport).scrollPaddingLeft) || 0;
        const cardStart = card.offsetLeft;
        const cardEnd = cardStart + card.offsetWidth;
        const visibleStart = viewport.scrollLeft + gutter;
        const visibleEnd = viewport.scrollLeft + viewport.clientWidth - gutter;
        let target = viewport.scrollLeft;
        if (cardStart < visibleStart - edgeTolerance) {
          target = cardStart - gutter;
        } else if (cardEnd > visibleEnd + edgeTolerance) {
          target = cardEnd - viewport.clientWidth + gutter;
        }
        const maximum = Math.max(
          0,
          viewport.scrollWidth - viewport.clientWidth,
        );
        target = clamp(target, 0, maximum);
        // Calling this even when the card is visible cancels a previous scroll
        // toward a different card during quick keyboard changes.
        viewport.scrollTo({ left: target, behavior });
      },
      [cardRefs, items.length],
    );

    const reveal = useCallback(
      (index: number) => revealCard(index, still ? "instant" : "smooth"),
      [revealCard, still],
    );
    useImperativeHandle(forwardedRef, () => ({ reveal }), [reveal]);

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      let frame = 0;
      const onResize = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const before = previousSize.current;
          const maximum = Math.max(
            0,
            viewport.scrollWidth - viewport.clientWidth,
          );
          const wasAtEnd =
            before.maximum > edgeTolerance &&
            before.maximum - before.left <= edgeTolerance;
          const target = wasAtEnd
            ? maximum
            : before.left <= edgeTolerance
              ? 0
              : before.maximum > 0
                ? (before.left / before.maximum) * maximum
                : 0;
          viewport.scrollTo({
            left: clamp(target, 0, maximum),
            behavior: "instant",
          });
          const focused = cardRefs.current.findIndex(
            (card) => card === document.activeElement,
          );
          if (focused !== -1) revealCard(focused, "instant");
          readScrollState();
        });
      };
      const observer = new ResizeObserver(onResize);
      observer.observe(viewport);
      for (const card of cardRefs.current) if (card) observer.observe(card);
      readScrollState();
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }, [cardRefs, items.length, readScrollState, revealCard]);

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const onWheel = (event: WheelEvent) => {
        if (!event.shiftKey || Math.abs(event.deltaX) > 0.1 || !event.deltaY)
          return;
        const maximum = Math.max(
          0,
          viewport.scrollWidth - viewport.clientWidth,
        );
        if (!maximum) return;
        const unit =
          event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? viewport.clientWidth
              : 1;
        const delta = event.deltaY * unit;
        if (
          (delta < 0 && viewport.scrollLeft <= edgeTolerance) ||
          (delta > 0 && maximum - viewport.scrollLeft <= edgeTolerance)
        )
          return;
        event.preventDefault();
        viewport.scrollBy({ left: delta, behavior: "instant" });
      };
      viewport.addEventListener("wheel", onWheel, { passive: false });
      return () => viewport.removeEventListener("wheel", onWheel);
    }, []);

    const moveWindow = (direction: -1 | 1) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      if (
        (direction < 0 && viewport.scrollLeft <= edgeTolerance) ||
        (direction > 0 && maximum - viewport.scrollLeft <= edgeTolerance)
      )
        return;
      const first = cardRefs.current[0];
      const second = cardRefs.current[1];
      const stride =
        first && second
          ? second.offsetLeft - first.offsetLeft
          : viewport.clientWidth;
      viewport.scrollTo({
        left: clamp(viewport.scrollLeft + direction * stride, 0, maximum),
        behavior: still ? "instant" : "smooth",
      });
    };

    return (
      <section className="card-carousel" aria-label="Play options">
        <p id={instructionsId} className="carousel-screenreader-only">
          Use Left and Right to choose a card. Swipe or scroll horizontally to
          see more options.
        </p>
        <div
          ref={viewportRef}
          id={viewportId}
          className="game-cards carousel-viewport"
          aria-describedby={instructionsId}
          onScroll={readScrollState}
        >
          {items.map((card, index) => (
            <button
              key={card.id}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              type="button"
              tabIndex={selected === index ? 0 : -1}
              className={`game-card card-${card.id} ${selected === index ? "is-selected" : ""}`}
              aria-label={
                card.title === "LOAD GAME"
                  ? "Load game"
                  : card.title.charAt(0) + card.title.slice(1).toLowerCase()
              }
              aria-pressed={selected === index}
              onPointerMove={(event) => {
                if (
                  event.pointerType === "mouse" &&
                  (event.movementX !== 0 || event.movementY !== 0)
                )
                  onSelect(index);
              }}
              onFocus={() => {
                onSelect(index);
                reveal(index);
              }}
              onClick={() => onActivate(index)}
            >
              <span className="card-art" aria-hidden="true" />
              <span className="card-shade" aria-hidden="true" />
              <span className="card-heading">
                <span className="card-title">{card.title}</span>
                <span className="card-subtitle">{card.subtitle}</span>
              </span>
              <span className="card-description">{card.description}</span>
            </button>
          ))}
        </div>
        <div className="carousel-controls" aria-label="Browse play options">
          <button
            type="button"
            className="carousel-arrow carousel-previous"
            aria-label="Previous cards"
            aria-controls={viewportId}
            aria-disabled={scrollState.atStart}
            onClick={() => moveWindow(-1)}
          >
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="m11 4-5 5 5 5" />
            </svg>
          </button>
          <span
            className="carousel-range"
            aria-live="polite"
            aria-atomic="true"
          >
            {items.length ? scrollState.first + 1 : 0}–
            {Math.min(items.length, scrollState.first + visibleCount)}
            <span className="carousel-range-divider">/</span>
            {items.length}
          </span>
          <button
            type="button"
            className="carousel-arrow carousel-next"
            aria-label="Next cards"
            aria-controls={viewportId}
            aria-disabled={scrollState.atEnd}
            onClick={() => moveWindow(1)}
          >
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="m7 4 5 5-5 5" />
            </svg>
          </button>
        </div>
      </section>
    );
  },
);

export default CardCarousel;
