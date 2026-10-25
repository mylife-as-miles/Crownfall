import type { RefObject } from "react";
import { HOME_CONTENT, type HomeContent, type HomeTileContent } from "./home-content";
import "./HomeGrid.css";

interface HomeGridProps {
  selected: number;
  onSelect: (index: number) => void;
  onActivate: (item: HomeTileContent, index: number) => void;
  tileRefs: RefObject<(HTMLButtonElement | null)[]>;
  items?: HomeContent;
}

export default function HomeGrid({
  selected,
  onSelect,
  onActivate,
  tileRefs,
  items = HOME_CONTENT,
}: HomeGridProps) {
  return (
    <section className="home-grid" aria-label="Home options">
      {items.map((item, index) => {
        const contentPending = !item.title || !item.imageSrc;
        const canActivate = !contentPending && Boolean(item.action);
        return (
          <button
            key={item.id}
            ref={(element) => {
              tileRefs.current[index] = element;
            }}
            type="button"
            className={`home-tile home-tile--${item.id}${selected === index ? " is-selected" : ""}${!item.imageSrc ? " has-no-art" : ""}`}
            data-home-slot={item.id}
            data-content-pending={contentPending}
            tabIndex={selected === index ? 0 : -1}
            aria-label={item.title || `Home tile ${index + 1}, content pending`}
            aria-pressed={selected === index}
            aria-disabled={!canActivate}
            onFocus={() => onSelect(index)}
            onPointerMove={(event) => {
              if (
                event.pointerType === "mouse" &&
                (event.movementX !== 0 || event.movementY !== 0)
              ) onSelect(index);
            }}
            onClick={() => {
              onSelect(index);
              if (canActivate) onActivate(item, index);
            }}
          >
            {item.imageSrc && (
              <img
                className="home-tile-art"
                src={item.imageSrc}
                style={{
                  objectFit: item.imageFit || "cover",
                  objectPosition: item.imagePosition || "50% 50%",
                }}
                alt=""
                draggable={false}
              />
            )}
            <span className="home-tile-shade" aria-hidden="true" />
            <span className="home-tile-heading">
              {(item.eyebrow || contentPending) && (
                <span className="home-tile-eyebrow">
                  {item.eyebrow || "Content pending"}
                </span>
              )}
              <span className="home-tile-title">
                {item.title || `Tile ${index + 1}`}
              </span>
            </span>
            {item.description && (
              <span className="home-tile-description">{item.description}</span>
            )}
          </button>
        );
      })}
    </section>
  );
}
